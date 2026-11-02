from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from backend.tests.test_cheats import tester
from backend.tests.test_recharge import setup
from backend.tests.test_staking_rewards import WALLET,CONTRACT,hash_
from chain.server.recharge_indexer import RechargeReader

@pytest.fixture
def treasury(tester,monkeypatch):
    c,store,_=setup(tester)
    info=dict(address=CONTRACT,chainId=31337,deploymentId=hash_(99),treasury=WALLET)
    calls=[]
    monkeypatch.setattr(RechargeReader,'public_config',lambda _:dict(info))
    def read(_,account):
        calls.append(account)
        return dict(info,balanceWei='12300000000000000',blockNumber=20,account=account,isAdmin=True,canManageAdmins=account.lower()==info['treasury'].lower(),admins=[WALLET])
    monkeypatch.setattr(RechargeReader,'treasury_status',read)
    return c,store,info,calls

def test_bound_chain_admin_reads_management_without_server_mutations(treasury):
    c,store,info,calls=treasury
    result=c.get('/api/chain/recharge/treasury')
    assert result.status_code==200,result.text
    assert result.json()['isAdmin'] and result.json()['canManageAdmins']
    assert result.headers['cache-control']=='no-store' and calls==[WALLET.lower()]
    assert c.post('/api/chain/recharge/treasury',json={'withdraw':1,'addAdmin':WALLET}).status_code==405
    assert c.get('/api/state').json()['player']['coins']==0

@pytest.mark.parametrize('change',['unbound','logged_out'])
def test_unverified_identity_is_denied_before_rpc(treasury,change):
    c,store,_,calls=treasury
    if change=='unbound':
        with store.connection() as db:db.execute('DELETE FROM wallet_bindings')
    else:c.post('/api/account/logout')
    result=c.get('/api/chain/recharge/treasury?role=tester&wallet='+WALLET)
    assert result.status_code in (401,403),result.text
    assert not calls

def test_delegated_wallet_does_not_require_a_game_cheat_role(treasury):
    c,store,info,calls=treasury
    with store.connection() as db:db.execute("UPDATE accounts SET role='player'")
    info['treasury']=CONTRACT
    result=c.get('/api/chain/recharge/treasury?wallet='+CONTRACT)
    assert result.status_code==200,result.text
    assert result.json()['isAdmin'] and not result.json()['canManageAdmins']
    assert calls==[WALLET.lower()] # Query strings cannot select a different caller.

def test_revocation_is_rechecked_not_cached_even_for_tester(treasury,monkeypatch):
    c,_,_,_=treasury
    assert c.get('/api/chain/recharge/treasury').status_code==200
    def revoked(_,account):raise HTTPException(403,'当前钱包不是充值合约管理员，或权限已被移除。')
    monkeypatch.setattr(RechargeReader,'treasury_status',revoked)
    result=c.get('/api/chain/recharge/treasury')
    assert result.status_code==403 and 'balanceWei' not in result.json()

def test_unavailable_contract_does_not_return_a_stale_balance(treasury,monkeypatch):
    c,_,_,_=treasury
    def fail(_,account):raise HTTPException(503,'充值合约余额暂时无法读取，请稍后重试。')
    monkeypatch.setattr(RechargeReader,'treasury_status',fail)
    response=c.get('/api/chain/recharge/treasury')
    assert response.status_code==503 and 'balanceWei' not in response.json()

@pytest.mark.parametrize('role',['root','delegate','revoked','rpc_failure'])
def test_reader_uses_live_permission_and_a_single_block(monkeypatch,role):
    info=dict(address=CONTRACT,chainId=31337,deploymentId=hash_(99),treasury=WALLET)
    caller=WALLET if role=='root' else '0x'+'12'*20
    seen=[]
    def call(name,value):
        def at(*,block_identifier):
            seen.append((name,block_identifier))
            if role=='rpc_failure':raise OSError('RPC is unavailable')
            return value
        return SimpleNamespace(call=at)
    def is_admin(address):
        assert address.lower()==caller.lower()
        return call('permission',role not in ['revoked'])
    functions=SimpleNamespace(isAdmin=is_admin,getAdmins=lambda:call('list',[WALLET,caller]))
    def balance(address,*,block_identifier):
        assert address==CONTRACT;seen.append(('balance',block_identifier));return 100
    w3=SimpleNamespace(eth=SimpleNamespace(get_block=lambda _:dict(number=45),get_balance=balance))
    monkeypatch.setattr(RechargeReader,'connect',lambda _:(info,w3,SimpleNamespace(functions=functions)))
    reader=RechargeReader.__new__(RechargeReader)
    if role in ['revoked','rpc_failure']:
        with pytest.raises(HTTPException) as error:reader.treasury_status(caller)
        assert error.value.status_code==(403 if role=='revoked' else 503)
        assert seen==[('permission',45)]
    else:
        result=reader.treasury_status(caller)
        assert result['isAdmin'] and result['canManageAdmins']==(role=='root')
        assert result['admins']==([WALLET,caller] if role=='root' else [])
        assert all(block==45 for _,block in seen)
