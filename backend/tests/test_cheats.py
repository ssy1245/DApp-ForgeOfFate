import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from eth_account import Account
from eth_account.messages import encode_defunct

from backend.app import create_app
from backend.game import BALANCE
from backend.tests.test_game import post
from backend.tests.test_accounts_supply import credentials
from scripts.create_dev_accounts import provision


@pytest.fixture
def tester(tmp_path):
    c=TestClient(create_app(str(tmp_path/'cheats.sqlite3'),demo=True))
    c.post('/api/session');data=credentials()
    registered=c.post('/api/account/register',json=data).json()
    address=registered['address']
    with c.app.state.store.connection() as db:
        db.execute("UPDATE accounts SET role='tester' WHERE game_address=?",(address,))
    return c,address,data


def test_new_accounts_cannot_self_assign_test_role(tmp_path):
    c=TestClient(create_app(str(tmp_path/'normal.sqlite3'),demo=True))
    c.post('/api/session')
    r=c.post('/api/account/register',json={**credentials(),'role':'tester','can_cheat':True})
    assert r.status_code==200 and r.json()['role']=='player'
    state=c.get('/api/state').json()
    assert not state['player']['can_cheat']
    assert len(state['weapons'])==3
    for path,body in [('/cheats/daily',{}),('/cheats/resources',{'resource':'all','amount':100}),('/cheats/weapons',{'count':1}),('/cheats/weapons/fake',{'level':50}),('/demo/seed',{})]:
        assert post(c,path,{},body).status_code==403
    c.post('/api/account/logout');c.post('/api/session')
    assert post(c,'/cheats/daily',{}).status_code==403


def test_tester_role_restored_after_login(tester):
    c,address,data=tester
    c.post('/api/account/logout')
    assert c.post('/api/account/login',json=data).json()['role']=='tester'
    assert c.post('/api/session').json()['role']=='tester'
    state=c.get('/api/state').json()
    assert state['player']['can_cheat'] and state['player']['address']==address


def test_unlimited_daily_grants_and_idempotency(tester):
    c,_,_=tester
    before=c.get('/api/state').json();key=str(uuid.uuid4())
    result=post(c,'/cheats/daily',{},key=key)
    assert result.status_code==200
    assert post(c,'/cheats/daily',{},key=key).json()==result.json()
    assert post(c,'/cheats/daily',{}).status_code==200
    state=c.get('/api/state').json()
    assert len(state['weapons'])==BALANCE['daily_swords']*3
    assert state['player']['ap']==2*BALANCE['daily_ap']
    assert state['player']['sword_day']==before['player']['sword_day']
    assert state['player']['claim_day']==before['player']['claim_day']
    assert state['player']['can_claim']
    assert sum(w['source']=='cheat' and w['demo']==1 for w in state['weapons'])==6


def test_resources_atomic_add_and_cap(tester):
    c,address,_=tester
    key=str(uuid.uuid4());body={'resource':'all','amount':1000}
    r=post(c,'/cheats/resources',{},body,key)
    assert r.status_code==200
    assert post(c,'/cheats/resources',{},body,key).json()==r.json()
    state=c.get('/api/state').json()
    assert all(state['player'][field]==1000 for field in ['ap','materials','shields','coins'])
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(lambda _:post(c,'/cheats/resources',{}, {'resource':'coins','amount':10}).status_code,range(2)))
    assert codes==[200,200]
    assert c.get('/api/state').json()['player']['coins']==1020
    with c.app.state.store.connection() as db:db.execute('UPDATE players SET coins=999999999 WHERE address=?',(address,))
    post(c,'/cheats/resources',{}, {'resource':'coins','amount':10})
    assert c.get('/api/state').json()['player']['coins']==1_000_000_000


def test_weapon_spawn_edit_seal_and_other_archive(tester):
    c,_,_=tester
    key=str(uuid.uuid4());body={'count':4,'level':50,'quality':'精良'}
    r=post(c,'/cheats/weapons',{},body,key)
    assert r.status_code==200
    assert post(c,'/cheats/weapons',{},body,key).json()==r.json()
    wid=r.json()['weapon_id']
    state=c.get('/api/state').json()
    cheats=[w for w in state['weapons'] if w['source']=='cheat']
    assert len(cheats)==4 and all(w['level']==50 and w['demo']==1 and w['quality']=='精良' for w in cheats)
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':10,'heated':True,'protected_left':100}).status_code==200
    w=next(w for w in c.get('/api/state').json()['weapons'] if w['id']==wid)
    assert w['level']==10 and w['heat_charges']==5 and w['heat_ready_at']==0 and w['protected_left']==100
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':50,'heated':False,'protected_left':0}).status_code==200
    assert post(c,f'/weapons/{wid}/seal',{}).status_code==200
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':99}).status_code==409
    # Even a tester may only edit their own active swords.
    c.post('/api/account/logout');c.post('/api/session')
    other=c.post('/api/account/register',json=credentials()).json()['address']
    with c.app.state.store.connection() as db:db.execute("UPDATE accounts SET role='tester' WHERE game_address=?",(other,))
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':10}).status_code==404


@pytest.mark.parametrize('body',[{'count':0},{'count':101},{'count':1,'level':101},{'count':1,'level':-1},{'count':1.5},{'quality':'unknown'}])
def test_invalid_spawn_rejected(tester,body):
    c,_,_=tester
    before=c.get('/api/state').json()['weapons']
    assert post(c,'/cheats/weapons',{},body).status_code==422
    assert c.get('/api/state').json()['weapons']==before


def test_invalid_resource_fields_and_empty_edit(tester):
    c,_,_=tester
    for body in [{'resource':'role','amount':1},{'resource':'coins','amount':-1},{'resource':'all','amount':1000001}]:
        assert post(c,'/cheats/resources',{},body).status_code==422
    wid=c.get('/api/state').json()['weapons'][0]['id']
    assert post(c,f'/cheats/weapons/{wid}',{},{}).status_code==400


def test_role_revocation_blocks_cached_request(tester):
    c,address,_=tester
    key=str(uuid.uuid4())
    assert post(c,'/cheats/daily',{},key=key).status_code==200
    with c.app.state.store.connection() as db:db.execute("UPDATE accounts SET role='player' WHERE game_address=?",(address,))
    assert post(c,'/cheats/daily',{},key=key).status_code==403
    assert not c.get('/api/state').json()['player']['can_cheat']


def test_cheats_disabled_in_normal_environment(tester):
    c,address,data=tester
    other=TestClient(create_app(c.app.state.store.path,demo=False))
    assert other.post('/api/account/login',json=data).status_code==200
    assert not other.get('/api/state').json()['player']['can_cheat']
    assert post(other,'/cheats/daily',{}).status_code==404


def test_wallet_binding_preserves_test_role(tester):
    c,address,data=tester
    wallet=Account.create()
    challenge=c.post('/api/auth/challenge',json={'address':wallet.address}).json()
    signature=Account.sign_message(encode_defunct(text=challenge['message']),wallet.key).signature.hex()
    r=c.post('/api/auth/login',json={'challenge_id':challenge['challenge_id'],'signature':signature})
    assert r.status_code==200 and r.json()['role']=='tester'
    assert c.get('/api/state').json()['player']['can_cheat']
    assert post(c,'/cheats/daily',{}).status_code==200


def test_local_account_setup_is_non_destructive(tmp_path):
    c=TestClient(create_app(str(tmp_path/'provision.sqlite3'),demo=True));store=c.app.state.store
    data=credentials()
    assert provision(store,data['username'],data['password'],'tester')
    with store.connection() as db:old=dict(db.execute('SELECT * FROM accounts').fetchone())
    assert not provision(store,data['username'],uuid.uuid4().hex,'tester')
    with store.connection() as db:assert dict(db.execute('SELECT * FROM accounts').fetchone())==old
    with pytest.raises(RuntimeError):provision(store,data['username'],data['password'],'player')
    assert c.post('/api/account/login',json=data).json()['role']=='tester'
