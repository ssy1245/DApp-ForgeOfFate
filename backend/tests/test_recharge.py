from concurrent.futures import ThreadPoolExecutor
import pytest
from backend.recharge import register_source, record_deposit, credit_pending, rate
from backend.storage import Store
from backend.mailbox import MAX_SAFE_COINS
from backend.tests.test_cheats import tester
from backend.tests.test_staking_rewards import WALLET, CONTRACT, hash_, rows, BASE

MANIFEST=dict(chainId=31337,address=CONTRACT,deploymentId=hash_(99),deploymentBlock=1)

def setup(tester,bound=True):
    c,owner,_=tester;store=c.app.state.store
    with store.connection() as db:
        if bound:
            account=db.execute('SELECT id FROM accounts WHERE game_address=?',(owner,)).fetchone()[0]
            db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,WALLET,BASE))
        source=register_source(db,MANIFEST,dict(number=0,hash=hash_(0)),(10**16,10000))
    return c,store,source

def event(i=1,amount=10**16,wallet=WALLET):
    return dict(deposit_id=str(i),amount_wei=str(amount),wallet=wallet,tx_hash=hash_(i),block_number=i,block_hash=hash_(i),log_index=0)

def apply(store,source,*events):
    with store.connection() as db:
        for e in events: record_deposit(db,source,e)
        return credit_pending(db,source)

def balance(c):return c.get('/api/state').json()['player']['coins']

def test_rate_and_replay_across_restart_and_threads(tester):
    c,store,source=setup(tester)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results=list(pool.map(lambda _:apply(Store(store.path),source,event()),range(12)))
    assert sum(results)==1 and balance(c)==10000
    assert len(rows(store,'recharge_deposits'))==1
    assert not apply(Store(store.path),source,event())
    receipt=rows(store,'recharge_deposits')[0]
    assert receipt['balance_before']==0 and receipt['balance_after']==10000

def test_fraction_carry_is_per_wallet_and_survives_restart(tester):
    c,store,source=setup(tester)
    apply(store,source,event(amount=5*10**11))
    assert balance(c)==0
    apply(Store(store.path),source,event(2,5*10**11,CONTRACT))
    assert balance(c)==0
    apply(Store(store.path),source,event(3,5*10**11))
    assert balance(c)==1
    apply(store,source,event(4,10**16))
    assert balance(c)==10001

def test_unbound_wallet_is_preserved_and_credited_only_after_verified_binding(tester):
    c,store,source=setup(tester,bound=False);apply(store,source,event())
    assert balance(c)==0 and rows(store,'recharge_deposits')[0]['credited_at'] is None
    with store.connection() as db:
        account=db.execute('SELECT id FROM accounts').fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,WALLET,BASE))
    assert apply(store,source)==1 and balance(c)==10000

def test_conflicting_identity_and_failed_transaction_roll_back_all_credit(tester):
    c,store,source=setup(tester)
    with pytest.raises(ValueError):apply(store,source,event(),event(amount=2*10**16))
    assert balance(c)==0 and not rows(store,'recharge_deposits') and not rows(store,'recharge_remainders')
    apply(store,source,event());assert balance(c)==10000
    with pytest.raises(RuntimeError):
        with store.connection() as db:
            record_deposit(db,source,event(2));credit_pending(db,source);raise RuntimeError('crash before commit')
    assert balance(c)==10000 and len(rows(store,'recharge_deposits'))==1
    apply(store,source,event(2));assert balance(c)==20000

def test_balance_overflow_retains_receipt_without_blocking_small_deposit(tester):
    c,store,source=setup(tester)
    with store.connection() as db:db.execute('UPDATE players SET coins=?',(MAX_SAFE_COINS-1,))
    apply(store,source,event(),event(2,10**12))
    assert balance(c)==MAX_SAFE_COINS
    assert rows(store,'recharge_deposits')[0]['credited_at'] is None
    with store.connection() as db:db.execute('UPDATE players SET coins=0')
    assert apply(store,source)==1 and balance(c)==10000

@pytest.mark.parametrize('amount',[0,-1,2**256])
def test_invalid_amounts_never_credit(tester,amount):
    c,store,source=setup(tester)
    with pytest.raises(ValueError):apply(store,source,event(amount=amount))
    assert balance(c)==0 and not rows(store,'recharge_deposits')

@pytest.mark.parametrize('change',['rate','deployment','fingerprint'])
def test_source_or_rate_change_cannot_reprice_history(tester,change):
    _,store,_=setup(tester);manifest=MANIFEST.copy();conversion=(10**16,10000)
    if change=='rate':conversion=(10**16,20000)
    if change=='deployment':manifest['deploymentId']=hash_(100)
    if change=='fingerprint':manifest['deploymentBlock']=2
    with pytest.raises(ValueError):
        with store.connection() as db:register_source(db,manifest,dict(number=0,hash=hash_(0)),conversion)

def test_history_is_scoped_to_bound_account_and_cannot_credit_by_http(tester):
    c,store,source=setup(tester);apply(store,source,event(),event(2,wallet=CONTRACT))
    response=c.get('/api/chain/recharge?wallet='+CONTRACT)
    assert response.status_code==200,response.text
    data=response.json();assert data['account']==WALLET and data['total']==1
    assert data['items'][0]['coins']=='10000'
    assert c.post('/api/chain/recharge',json={'amount':'100000'}).status_code==405
    assert c.get('/api/chain/recharge?limit=101').status_code==422
    c.post('/api/account/logout')
    assert c.get('/api/chain/recharge').status_code in (401,403)

def test_invalid_backend_rate_fails_closed(monkeypatch):
    monkeypatch.setenv('FORGE_RECHARGE_COINS_PER_UNIT','0')
    with pytest.raises(ValueError):rate()

@pytest.mark.parametrize('case',['credited','uncredited','confirming','other_epoch','other_wallet','withdrawal'])
def test_receipt_reports_only_matching_finalized_credit(tester,monkeypatch,case):
    from chain.server.recharge_indexer import RechargeReader
    c,store,source=setup(tester,bound=case!='uncredited')
    apply(store,source,event())
    response=dict(chainId=31337,deploymentId=MANIFEST['deploymentId'],state='confirmed',
                  receipt=dict(status=1,from_=WALLET))
    response['receipt']['from']=response['receipt'].pop('from_')
    if case=='confirming':response['state']='confirming'
    if case=='other_epoch':response['deploymentId']=hash_(999)
    if case=='other_wallet':response['receipt']['from']=CONTRACT
    monkeypatch.setattr(RechargeReader,'receipt',lambda self,tx:response)
    result=c.get('/api/chain/recharge/receipts/'+hash_(2 if case=='withdrawal' else 1))
    assert result.status_code==200,result.text
    credit=result.json()['credit']
    if case in ('credited','uncredited'):
        assert credit['coins']=='10000'
        assert credit['state']==('credited' if case=='credited' else 'pending')
    else:assert credit is None
