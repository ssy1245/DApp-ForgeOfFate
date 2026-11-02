import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.storage import Store
from chain.server.tasks import TaskWorker, enqueue, task_receipt, INTERVAL, DAY
from chain.server.rpc import ChainSettings, ChainReader
from chain.server.indexer import Indexer
from chain.server.staking_indexer import StakingIndexer
from chain.server.store import index_status
from chain.tests.test_indexer import FakeSource, A, B
from chain.tests.test_staking_indexer import Source
from backend.tests.test_staking_rewards import BASE, WALLET, hash_, rows
from backend.tests.test_cheats import tester

TX, EPOCH = hash_(70), hash_(99)


def write_manifest(settings, target, info):
    from chain.server.tasks import FILES
    (settings.directory / FILES[target]).write_text(json.dumps(info))


@pytest.fixture
def env(tmp_path):
    store = Store(tmp_path/'game.sqlite3')
    settings = ChainSettings('local', tmp_path, 'http://127.0.0.1:1')
    source = FakeSource()
    source.manifest.update(deploymentId=EPOCH, abi=[])
    write_manifest(settings, 'nft', source.manifest)
    source.open = Mock(wraps=source.open)
    now = [BASE+100]
    reader = Mock()
    reader.receipt.return_value = {'chainId':31337,'deploymentId':EPOCH,'state':'pending','receipt':None}
    indexer = Indexer(store, source)
    def worker():
        return TaskWorker(Store(store.path), settings, {'nft':indexer}, {'nft':reader}, clock=lambda:now[0])
    w = worker(); w.tick()  # The one-time deployment bootstrap.
    source.open.reset_mock()
    def submit(kind='transaction', tx=TX, **kwargs):
        with store.connection() as db:
            return enqueue(db,'nft',source.manifest,kind=kind,tx_hash=tx if kind=='transaction' else None,
                           wallet=A,now=now[0],**kwargs)
    return SimpleNamespace(store=store,settings=settings,source=source,now=now,reader=reader,worker=worker,submit=submit)


def result(state='confirmed', wallet=A):
    return {'chainId':31337,'deploymentId':EPOCH,'state':state,
            'receipt':{'hash':TX,'from':wallet,'status':0 if state=='failed' else 1,
                       'finalized':state in ('confirmed','failed'),'blockNumber':5}}


def test_idle_and_idle_restart_make_zero_rpc_calls(env):
    for second in range(1,181):
        env.now[0] += 1
        env.worker().tick()
    env.source.open.assert_not_called()
    env.reader.receipt.assert_not_called()
    # An idle cursor is allowed to be old; worker liveness is separate.
    with env.store.connection() as db:
        db.execute("UPDATE chain_scan SET updated_at=0")
        db.execute('UPDATE chain_worker SET heartbeat=strftime(\'%s\',\'now\')')
    assert index_status(env.store)['state']=='idle'


def test_pending_checks_at_30_seconds_even_after_restart_and_duplicate_requests(env):
    env.submit(); env.worker().tick()
    assert env.reader.receipt.call_count==0  # Bootstrap reserved this target's interval.
    env.now[0]+=30; env.worker().tick()
    assert env.reader.receipt.call_count==1
    for _ in range(29):
        env.now[0]+=1; env.submit(); env.worker().tick()
        assert env.reader.receipt.call_count==1
    env.now[0]+=1; env.worker().tick()
    assert env.reader.receipt.call_count==2
    assert len([r for r in rows(env.store,'chain_tasks') if r['kind']=='transaction'])==1
    env.source.open.assert_not_called()  # No full scan while a receipt is still pending.


def test_browser_closed_confirmed_receipt_is_indexed_and_then_worker_sleeps(env):
    env.source.add('Transfer',{'tokenId':'17','to':B},block=9)
    env.source.head=env.source.confirmed=10
    env.submit(); env.reader.receipt.return_value=result()
    env.now[0]+=30; env.worker().tick()
    assert rows(env.store,'chain_nfts')[0]['owner']==B
    assert next(r for r in rows(env.store,'chain_tasks') if r['tx_hash'])['state']=='done'
    env.source.open.reset_mock(); env.reader.receipt.reset_mock()
    for _ in range(5):
        env.now[0]+=30; env.worker().tick()
        assert task_receipt(env.store,env.settings,'nft',TX)['state']=='confirmed'
    env.source.open.assert_not_called(); env.reader.receipt.assert_not_called()


@pytest.mark.parametrize('state,wallet,task_state',[('failed',A,'done'),('confirmed',B,'rejected')])
def test_failed_or_foreign_sender_does_not_trigger_business_scan(env,state,wallet,task_state):
    env.submit(); env.reader.receipt.return_value=result(state,wallet)
    env.now[0]+=30; env.worker().tick()
    assert next(r for r in rows(env.store,'chain_tasks') if r['tx_hash'])['state']==task_state
    env.source.open.assert_not_called()


def test_rpc_error_retains_job_and_retries_no_earlier_than_30_seconds(env):
    env.submit(); env.reader.receipt.side_effect=RuntimeError('secret-rpc-key')
    env.now[0]+=30; env.worker().tick()
    job=next(r for r in rows(env.store,'chain_tasks') if r['tx_hash'])
    assert job['state']=='pending' and 'secret' not in job['error']
    env.now[0]+=29; env.worker().tick(); assert env.reader.receipt.call_count==1
    env.reader.receipt.side_effect=None; env.reader.receipt.return_value=result()
    env.now[0]+=1; env.worker().tick(); assert env.reader.receipt.call_count==2


def test_lost_or_replaced_hash_stops_automatic_rpc_after_a_day(env):
    env.submit(); env.now[0]+=DAY; env.worker().tick()
    assert task_receipt(env.store,env.settings,'nft',TX)['taskState']=='expired'
    env.submit(); env.now[0]+=30; env.worker().tick()
    env.reader.receipt.assert_not_called()


def test_completed_receipt_survives_scanner_failure_and_is_not_requeried(env):
    env.submit(); env.reader.receipt.return_value=result()
    good=env.source.open; env.source.open=Mock(side_effect=RuntimeError('offline'))
    env.now[0]+=30; env.worker().tick()
    assert next(r for r in rows(env.store,'chain_tasks') if r['tx_hash'])['state']=='pending'
    env.source.open=good; env.now[0]+=30; env.worker().tick()
    assert env.reader.receipt.call_count==1
    assert next(r for r in rows(env.store,'chain_tasks') if r['tx_hash'])['state']=='done'


def test_one_bad_contract_task_does_not_drop_other_transactions(env):
    from fastapi import HTTPException
    env.submit(); env.submit(tx=hash_(71))
    env.reader.receipt.side_effect=[HTTPException(400,'交易不属于当前合约。'), result()]
    env.now[0]+=30; env.worker().tick()
    assert sorted(r['state'] for r in rows(env.store,'chain_tasks') if r['tx_hash'])==['done','rejected']


def test_manual_sync_catches_external_events_and_duplicate_refresh_is_coalesced(env):
    env.source.add('Transfer',{'tokenId':'22','to':B},block=9)
    env.source.head=env.source.confirmed=9
    for _ in range(50): env.submit(kind='sync')
    env.now[0]+=30; env.worker().tick()
    assert rows(env.store,'chain_nfts')[0]['owner']==B
    assert env.source.open.call_count==1
    for _ in range(20): env.submit(kind='sync'); env.worker().tick()
    assert env.source.open.call_count==1


def test_daily_rewards_wait_for_finality_then_recover_offline_unstake_without_duplicates(tester,tmp_path):
    c,owner,_=tester; store=c.app.state.store
    with store.connection() as db:
        account=db.execute('SELECT id FROM accounts WHERE game_address=?',(owner,)).fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,WALLET,BASE))
    settings=ChainSettings('local',tmp_path,'http://127.0.0.1:1')
    source=Source(); source.manifest['deploymentId']=EPOCH
    source.add('Staked'); source.add('Unstaked',3)
    source.head=source.confirmed=1
    write_manifest(settings,'staking',source.manifest)
    now=[BASE+DAY//2+10]
    reader=Mock()
    def run():
        TaskWorker(Store(store.path),settings,{'staking':StakingIndexer(store,source,daily_coins=1000)},
                   {'staking':reader},clock=lambda:now[0]).tick()
    run(); assert not rows(store,'reward_mail')
    calls=len(source.calls)
    now[0]+=100; run(); assert len(source.calls)==calls
    now[0]=BASE+DAY+10; run(); assert not rows(store,'reward_mail')
    assert any(r['state']=='pending' and r['kind']=='daily' for r in rows(store,'chain_tasks'))
    source.head=source.confirmed=2; now[0]+=30; run()
    assert [r['coins'] for r in rows(store,'reward_mail')]==[500]
    # No browser requests while the server is off. Withdrawal is discovered
    # before accrual, so the second day earns only half a day, not three days.
    now[0]=BASE+3*DAY+10; source.head=source.confirmed=6; run()
    assert [r['coins'] for r in rows(store,'reward_mail')]==[500,500]
    calls=len(source.calls)
    now[0]+=40*DAY; run(); run()
    assert len(source.calls)==calls
    assert len(rows(store,'reward_mail'))==2
    reader.receipt.assert_not_called()


def test_task_api_and_config_are_local_authenticated_and_keep_receipts_across_restart(tmp_path,monkeypatch):
    monkeypatch.setenv('FORGE_LOCAL_DIR',str(tmp_path))
    settings=ChainSettings.from_env()
    info=dict(chainId=31337,address=A,deploymentId=EPOCH,deploymentBlock=2,abi=[])
    write_manifest(settings,'nft',info)
    c=TestClient(create_app())
    connect=Mock(side_effect=AssertionError('Unexpected RPC'))
    monkeypatch.setattr(ChainReader,'connect',connect)
    assert c.get('/api/config').json()['chain']['address']==A
    body=dict(target='nft',chain_id=31337,deployment_id=EPOCH,tx_hash=TX)
    assert c.post('/api/chain/tasks',json=body).status_code in (401,403)
    account=c.post('/api/account/register',json={'username':'queued_user','password':'test-password-123'}).json()
    assert c.post('/api/chain/tasks',json=body).status_code==403
    with c.app.state.store.connection() as db:
        aid=db.execute('SELECT id FROM accounts WHERE game_address=?',(account['address'],)).fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(aid,A,BASE))
    assert c.post('/api/chain/tasks',json={**body,'deployment_id':hash_(22)}).status_code==409
    assert c.post('/api/chain/tasks',json={**body,'tx_hash':'bad'}).status_code==422
    for _ in range(3): assert c.post('/api/chain/tasks',json=body).status_code==200
    assert len(rows(c.app.state.store,'chain_tasks'))==1
    for _ in range(3): assert c.get('/api/chain/receipts/'+TX).json()['state']=='pending'
    c2=TestClient(create_app())
    assert c2.get('/api/chain/receipts/'+TX).json()['state']=='pending'
    connect.assert_not_called()
    # Browser recovery does not renew an expired task; the explicit check does.
    with c.app.state.store.connection() as db: db.execute("UPDATE chain_tasks SET state='expired'")
    assert c.post('/api/chain/tasks',json=body).json()['state']=='expired'
    assert c.post('/api/chain/tasks',json={**body,'retry':True}).json()['state']=='pending'


def test_deposit_task_survives_restart_and_credits_once_even_with_duplicate_submissions(tester,tmp_path):
    from chain.server.recharge_indexer import RechargeIndexer
    c,owner,_=tester; store=c.app.state.store
    with store.connection() as db:
        account=db.execute('SELECT id FROM accounts WHERE game_address=?',(owner,)).fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,WALLET,BASE))
    settings=ChainSettings('local',tmp_path,'http://127.0.0.1:1')
    source=Source(); source.manifest.update(deploymentId=EPOCH)
    source.head=source.confirmed=1
    write_manifest(settings,'recharge',source.manifest)
    reader=Mock(); reader.receipt.return_value=result(wallet=WALLET)
    now=[BASE+DAY]
    def run():
        TaskWorker(Store(store.path),settings,{'recharge':RechargeIndexer(store,source,conversion=(10**16,10000))},
                   {'recharge':reader},clock=lambda:now[0]).tick()
    run()
    # A payment happens after bootstrap, then the browser closes.
    source.head=source.confirmed=4
    source.events=[dict(block_number=3,block_hash=hash_(3),log_index=0,transaction_hash=TX,
        contract_address=source.manifest['address'],name='Deposited',args=dict(depositId=1,payer=WALLET,amount=10**16))]
    for _ in range(12):
        with store.connection() as db:
            enqueue(db,'recharge',source.manifest,kind='transaction',tx_hash=TX,wallet=WALLET,now=now[0])
    now[0]+=30; run()
    assert c.get('/api/state').json()['player']['coins']==10000
    assert len(rows(store,'recharge_deposits'))==1
    assert task_receipt(store,settings,'recharge',TX)['taskState']=='done'
    for _ in range(3): now[0]+=30; run()
    assert c.get('/api/state').json()['player']['coins']==10000
    assert reader.receipt.call_count==1
