import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from eth_account import Account
from eth_account.messages import encode_defunct

from backend.app import create_app
from backend.storage import Store
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
    assert len(state['weapons'])==0
    assert state['player']['daily_swords_remaining']==3
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
    assert len(state['weapons'])==BALANCE['daily_swords']*2
    assert state['player']['daily_swords_remaining']==before['player']['daily_swords_remaining']==3
    assert 'ap' not in state['player']
    assert state['player']['materials']==2*BALANCE['daily_materials']
    assert state['player']['shields']==2*BALANCE['daily_shields']
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
    assert all(state['player'][field]==1000 for field in ['materials','shields','coins'])
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
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':80,'heated':False,'protected_left':0}).status_code==200
    assert post(c,f'/weapons/{wid}/seal',{}).status_code==200
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':99}).status_code==409
    # Even a tester may only edit their own active swords.
    c.post('/api/account/logout');c.post('/api/session')
    other=c.post('/api/account/register',json=credentials()).json()['address']
    with c.app.state.store.connection() as db:db.execute("UPDATE accounts SET role='tester' WHERE game_address=?",(other,))
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':10}).status_code==404


@pytest.mark.parametrize('body',[{'count':0},{'count':101},{'count':1,'level':101},{'count':1,'level':-1},{'count':1.5},{'quality':'unknown'},{'branch':'unknown'},{'branch':'rapier','level':1.5}])
def test_invalid_spawn_rejected(tester,body):
    c,_,_=tester
    before=c.get('/api/state').json()['weapons']
    assert post(c,'/cheats/weapons',{},body).status_code==422
    assert c.get('/api/state').json()['weapons']==before


def test_invalid_resource_fields_and_empty_edit(tester):
    c,_,_=tester
    for body in [{'resource':'ap','amount':1},{'resource':'role','amount':1},{'resource':'coins','amount':-1},{'resource':'all','amount':1000001}]:
        assert post(c,'/cheats/resources',{},body).status_code==422
    assert post(c,'/supply/sword',{}).status_code==200
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
    challenge=c.post('/api/wallet/challenge',json={'address':wallet.address}).json()
    signature=Account.sign_message(encode_defunct(text=challenge['message']),wallet.key).signature.hex()
    r=c.post('/api/wallet/bind',json={'challenge_id':challenge['challenge_id'],'signature':signature})
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


def test_setup_defaults_to_one_account_and_preserves_its_verified_wallet(tmp_path, monkeypatch):
    from scripts.create_dev_accounts import main
    monkeypatch.setenv('FORGE_LOCAL_DIR', str(tmp_path))
    monkeypatch.setattr('sys.argv', ['create_dev_accounts.py', '--network', 'local'])
    main()
    store = Store(tmp_path / 'game.sqlite3')
    wallet = Account.create().address
    with store.connection() as db:
        account = dict(db.execute('SELECT * FROM accounts').fetchone())
        assert account['username'] == 'forge_test' and account['role'] == 'tester'
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)', (account['id'], wallet, 123))
        db.execute('UPDATE players SET coins=12345 WHERE address=?', (account['game_address'],))
    main()
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 1
        assert dict(db.execute('SELECT * FROM accounts').fetchone()) == account
        assert tuple(db.execute('SELECT * FROM wallet_bindings').fetchone()) == (account['id'], wallet, 123)
        assert db.execute('SELECT coins FROM players').fetchone()[0] == 12345
    monkeypatch.setattr('sys.argv', ['create_dev_accounts.py', '--network', 'local', '--with-player'])
    main()
    with store.connection() as db:
        assert db.execute("SELECT role FROM accounts WHERE username='forge_player'").fetchone()[0] == 'player'
    assert '| forge_player |' in (tmp_path / 'test-accounts.md').read_text()


def test_cheat_levels_respect_weapon_route_caps(tester):
    c,_,_=tester
    assert post(c,'/cheats/weapons',{}, {'count':1,'level':91}).status_code==422
    spawned=post(c,'/cheats/weapons',{}, {'count':1,'level':90})
    assert spawned.status_code==200
    wid=spawned.json()['weapon_id']
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':91}).status_code==409
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':60}).status_code==200
    assert post(c,f'/weapons/{wid}/branch',{}, {'branch':'greatsword'}).status_code==200
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':71}).status_code==409
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':70}).status_code==200
    assert post(c,f'/weapons/{wid}/branch',{}, {'branch':'rapier'}).status_code==409
    wid=post(c,'/cheats/weapons',{}, {'count':1,'level':60}).json()['weapon_id']
    assert post(c,f'/weapons/{wid}/branch',{}, {'branch':'rapier'}).status_code==200
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':80}).status_code==200
    assert post(c,f'/cheats/weapons/{wid}',{}, {'level':81}).status_code==409


@pytest.mark.parametrize('branch,limit',[('longsword',90),('rapier',80),('greatsword',70)])
def test_batch_spawn_route_cap_and_idempotency(tester,branch,limit):
    c,_,_=tester
    before=c.get('/api/state').json()
    rejected=post(c,'/cheats/weapons',{}, {'count':3,'branch':branch,'level':limit+1})
    assert rejected.status_code==422 and f'+{limit}' in rejected.json()['detail']
    assert c.get('/api/state').json()==before
    body={'count':3,'branch':branch,'level':limit};key=str(uuid.uuid4())
    result=post(c,'/cheats/weapons',{},body,key)
    assert result.status_code==200
    assert post(c,'/cheats/weapons',{},body,key).json()==result.json()
    weapons=c.get('/api/state').json()['weapons']
    assert len(weapons)==3
    assert all(w['branch']==branch and w['level']==limit and w['max_level']==limit
               and w['demo']==1 and w['source']=='cheat' for w in weapons)
    other='rapier' if branch=='longsword' else 'longsword'
    assert post(c,'/cheats/weapons',{}, {**body,'branch':other},key).status_code==409
    assert c.get('/api/state').json()['weapons']==weapons


@pytest.mark.parametrize('branch,limit',[('longsword',90),('rapier',80),('greatsword',70)])
def test_low_level_spawn_keeps_selected_route(tester,branch,limit):
    c,_,_=tester
    result=post(c,'/cheats/weapons',{}, {'count':1,'branch':branch,'level':0})
    assert result.status_code==200
    w=c.get('/api/state').json()['weapons'][0]
    assert w['branch']==branch and w['level']==0 and w['max_level']==limit
    assert post(c,f"/cheats/weapons/{w['id']}",{}, {'level':limit+1}).status_code==409
