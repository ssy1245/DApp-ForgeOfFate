from concurrent.futures import ThreadPoolExecutor
import uuid

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.game import BALANCE, probabilities, strike

@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(str(tmp_path / 'game.sqlite3'), demo=False))

def login(client):
    client.cookies.clear()
    assert client.post('/api/account/register',json={'username':'u_'+uuid.uuid4().hex[:12],'password':'test-password-2026'}).status_code==200
    wallet = Account.create()
    c = client.post('/api/wallet/challenge', json={'address': wallet.address}).json()
    sig = Account.sign_message(encode_defunct(text=c['message']), wallet.key).signature.hex()
    r = client.post('/api/wallet/bind', json={'challenge_id': c['challenge_id'], 'signature': sig})
    assert r.status_code == 200
    return {'Authorization': 'Bearer ' + client.cookies.get('forge_session')}, wallet, c, sig

def post(client, path, headers, body=None, key=None):
    return client.post('/api' + path, headers={**headers, 'Idempotency-Key': key or str(uuid.uuid4())}, **({'json': body} if body is not None else {}))

def forge(client, headers):
    assert post(client, '/claim', headers).status_code == 200
    return post(client, '/forge', headers).json()['weapon_id']

def warm(client,headers,wid):
    response=post(client,f'/weapons/{wid}/heat',headers)
    assert response.status_code==200
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET heat_ready_at=0 WHERE id=?',(wid,))

def weapon(client, headers):
    return next(w for w in client.get('/api/state', headers=headers).json()['weapons'] if w['source']=='forge')

def test_login_replay_and_expiry(client):
    h, _, c, sig = login(client)
    assert client.get('/api/state', headers=h).status_code == 200
    assert client.post('/api/wallet/bind', json={'challenge_id': c['challenge_id'], 'signature': sig}).status_code == 409
    client.cookies.clear()
    assert client.get('/api/state').status_code == 401
    assert client.post('/api/wallet/challenge', json={'address': 'fake'}).status_code == 400

def test_wrong_signature(client):
    client.cookies.clear()
    assert client.post('/api/account/register',json={'username':'u_'+uuid.uuid4().hex[:12],'password':'test-password-2026'}).status_code==200
    wallet = Account.create()
    c = client.post('/api/wallet/challenge', json={'address': wallet.address}).json()
    signature = Account.sign_message(encode_defunct(text=c['message']), Account.create().key).signature.hex()
    assert client.post('/api/wallet/bind', json={'challenge_id': c['challenge_id'], 'signature': signature}).status_code == 400

def test_claim_and_idempotency(client):
    h, *_ = login(client)
    key = str(uuid.uuid4())
    a = post(client, '/claim', h, key=key)
    assert a.status_code == 200
    assert post(client, '/claim', h, key=key).json() == a.json()
    assert post(client, '/claim', h).status_code == 409
    assert client.get('/api/state', headers=h).json()['player']['materials'] == BALANCE['daily_materials']
    assert post(client, '/forge', h, key=key).status_code == 409

def test_forge_resource_cost_and_foreign_access(client):
    h, *_ = login(client)
    wid = forge(client, h)
    p = client.get('/api/state', headers=h).json()['player']
    assert p['materials'] == BALANCE['daily_materials'] - BALANCE['forge_materials']
    h2, *_ = login(client)
    assert post(client, f'/weapons/{wid}/recycle', h2).status_code == 404
    assert post(client, f'/weapons/{wid}/voucher', h2).status_code == 404

def test_recycle_is_atomic_and_terminal(client):
    h, *_ = login(client)
    wid = forge(client, h)
    key = str(uuid.uuid4())
    assert post(client, f'/weapons/{wid}/recycle', h, key=key).status_code == 200
    assert post(client, f'/weapons/{wid}/recycle', h, key=key).status_code == 200
    assert post(client, f'/weapons/{wid}/recycle', h).status_code == 409
    state = client.get('/api/state', headers=h).json()
    assert wid not in [w['id'] for w in state['weapons']]
    assert state['player']['coins'] == BALANCE['recycle_base']

def test_insufficient_resources_rollback(client):
    h, *_ = login(client)
    assert post(client, '/forge', h).status_code == 409
    assert len(client.get('/api/state', headers=h).json()['weapons']) == 0

def test_strike_retry_and_stale_state(client, monkeypatch):
    h, *_ = login(client)
    wid = forge(client, h)
    warm(client,h,wid)
    monkeypatch.setattr('backend.app.secrets.randbelow', lambda _: 0)
    body = {'expected_level': 0, 'expected_strikes': 0, 'expected_protected_left': 0}
    key = str(uuid.uuid4())
    a = post(client, f'/weapons/{wid}/strike', h, body, key)
    assert a.json()['level'] == 1
    assert post(client, f'/weapons/{wid}/strike', h, body, key).json() == a.json()
    assert post(client, f'/weapons/{wid}/strike', h, body).status_code == 409
    assert weapon(client, h)['level'] == 1

def test_destruction_and_shield(client, monkeypatch):
    h, *_ = login(client)
    wid = forge(client, h)
    warm(client,h,wid)
    monkeypatch.setattr('backend.app.secrets.randbelow', lambda _: 999999)
    body = {'expected_level': 0, 'expected_strikes': 0, 'expected_protected_left': 0, 'shield': True}
    assert post(client, f'/weapons/{wid}/strike', h, body).json()['result'] == 'saved'
    body.update(expected_strikes=1, shield=False)
    assert post(client, f'/weapons/{wid}/strike', h, body).json()['result'] == 'destroy'
    assert wid not in [w['id'] for w in client.get('/api/state', headers=h).json()['weapons']]
    assert post(client, f'/weapons/{wid}/recycle', h).status_code == 409

def test_seal_threshold(client):
    h, *_ = login(client)
    wid = forge(client, h)
    assert post(client, f'/weapons/{wid}/seal', h).status_code == 409
    assert post(client, '/demo/seed', h).status_code == 404
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET level=? WHERE id=?', (BALANCE['mint_level'], wid))
    assert post(client, f'/weapons/{wid}/seal', h).status_code == 200
    assert post(client, f'/weapons/{wid}/recycle', h).status_code == 409

def test_concurrent_recycle_credits_once(client):
    h, *_ = login(client)
    wid = forge(client, h)
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda _: post(client, f'/weapons/{wid}/recycle', h).status_code, range(2)))
    assert sorted(codes) == [200, 409]
    assert client.get('/api/state', headers=h).json()['player']['coins'] == BALANCE['recycle_base']

def test_protection_cycle_and_downside():
    w = {'level': 5, 'strikes': BALANCE['protection_trigger'] - 1, 'protected_left': 0}
    result = strike(w, 0, False)
    assert result['protected_left'] == BALANCE['protection_duration']
    assert result['strikes'] == 0
    for _ in range(BALANCE['protection_duration']):
        result = strike(result, 0.999999, True)
        assert result['result'] == 'saved'
        assert not result['shield_used']
        assert result['strikes'] == 0
    assert result['protected_left'] == 0
    assert strike(result, 0.999999, False)['status'] == 'destroyed'
    assert strike({'level':5,'strikes':0,'protected_left':1},0.9,False)['result'] == 'down'

def test_triggering_strike_is_not_protected():
    w = {'level': 5, 'strikes': BALANCE['protection_trigger'] - 1, 'protected_left': 0}
    result = strike(w, 0.999999, False)
    assert result['status'] == 'destroyed'
    assert result['protected_left'] == 0

@pytest.mark.parametrize('level', [0, 5, 20, 50])
def test_probability_distribution(level):
    normal, protected = probabilities(level), probabilities(level, True)
    assert sum(normal.values()) == pytest.approx(1)
    assert sum(protected.values()) == pytest.approx(1)
    assert normal['up'] == protected['up']
    assert normal['double'] == protected['double']
    assert protected['destroy'] == 0
    assert protected['saved'] == normal['destroy']


def test_heat_required_waiting_and_consumption(client,monkeypatch):
    h,*_=login(client)
    wid=forge(client,h)
    body={'expected_level':0,'expected_strikes':0,'expected_protected_left':0}
    assert post(client,f'/weapons/{wid}/strike',h,body).status_code==409
    key=str(uuid.uuid4())
    heating=post(client,f'/weapons/{wid}/heat',h,key=key)
    assert heating.status_code==200
    assert post(client,f'/weapons/{wid}/heat',h,key=key).json()==heating.json()
    assert post(client,f'/weapons/{wid}/heat',h).status_code==409
    assert post(client,f'/weapons/{wid}/strike',h,body).status_code==409
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET heat_ready_at=0 WHERE id=?',(wid,))
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:0)
    for i in range(BALANCE['heat_strikes']):
        result=post(client,f'/weapons/{wid}/strike',h,{'expected_level':i,'expected_strikes':i,'expected_protected_left':0})
        assert result.status_code==200
        assert result.json()['heat_charges']==BALANCE['heat_strikes']-i-1
    w=weapon(client,h)
    assert post(client,f'/weapons/{wid}/strike',h,{'expected_level':w['level'],'expected_strikes':w['strikes'],'expected_protected_left':w['protected_left']}).status_code==409
    assert post(client,f'/weapons/{wid}/heat',h).status_code==200

def test_concurrent_strikes_consume_once(client,monkeypatch):
    h,*_=login(client);wid=forge(client,h);warm(client,h,wid)
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:0)
    body={'expected_level':0,'expected_strikes':0,'expected_protected_left':0}
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(lambda _:post(client,f'/weapons/{wid}/strike',h,body).status_code,range(2)))
    assert sorted(codes)==[200,409]
    assert weapon(client,h)['heat_charges']==BALANCE['heat_strikes']-1

@pytest.mark.parametrize('roll,expected,level',[(0,'up',1),(800000,'double',2),(900000,'down',0),(999999,'destroy',0)])
def test_all_strike_outcomes(client,monkeypatch,roll,expected,level):
    h,*_=login(client);wid=forge(client,h);warm(client,h,wid)
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:roll)
    response=post(client,f'/weapons/{wid}/strike',h,{'expected_level':0,'expected_strikes':0,'expected_protected_left':0})
    assert response.json()['result']==expected
    assert response.json()['level']==level

def test_guest_progress_persists_and_binds_at_mint(tmp_path):
    c=TestClient(create_app(str(tmp_path/'guest.sqlite3'),demo=False))
    guest=c.post('/api/session').json()
    assert guest['guest']
    old_token=c.cookies.get('forge_session')
    assert c.post('/api/session').json()['address']==guest['address']
    wid=forge(c,{})
    assert weapon(c,{})['demo']==0
    with c.app.state.store.connection() as db:
        db.execute("UPDATE weapons SET level=?,status='sealed' WHERE id=?",(BALANCE['mint_level'],wid))
    assert post(c,f'/weapons/{wid}/voucher',{}).status_code==403
    registered=c.post('/api/account/register',json={'username':'bound_player','password':'test-password-2026'}).json()
    wallet=Account.create()
    challenge=c.post('/api/wallet/challenge',json={'address':wallet.address}).json()
    assert registered['player_id'] in challenge['message']
    signature=Account.sign_message(encode_defunct(text=challenge['message']),wallet.key).signature.hex()
    logged=c.post('/api/wallet/bind',json={'challenge_id':challenge['challenge_id'],'signature':signature})
    assert logged.status_code==200
    assert not logged.json()['guest']
    assert c.post('/api/session').json()['address']==guest['address']
    state=c.get('/api/state').json()
    assert next(w for w in state['weapons'] if w['id']==wid)['level']==BALANCE['mint_level']
    assert 'ap' not in state['player']
    assert c.get('/api/state',headers={'Authorization':'Bearer '+old_token}).status_code==200

def test_legacy_database_migration(tmp_path):
    import sqlite3
    path=tmp_path/'legacy.sqlite3'
    db=sqlite3.connect(path)
    db.execute("CREATE TABLE weapons(id TEXT PRIMARY KEY,owner TEXT,level INTEGER DEFAULT 0,status TEXT DEFAULT 'active',strikes INTEGER DEFAULT 0,protected_left INTEGER DEFAULT 0,demo INTEGER DEFAULT 0,created INTEGER)")
    db.execute("INSERT INTO weapons(id,owner,level) VALUES('old','owner',7)")
    db.commit();db.close()
    c=TestClient(create_app(str(path)))
    with c.app.state.store.connection() as db:
        row=db.execute("SELECT * FROM weapons WHERE id='old'").fetchone()
        assert row['level']==7 and row['heat_charges']==0


def test_current_schema_has_no_retired_practice_field(client):
    with client.app.state.store.connection() as db:
        assert 'practice' not in {row['name'] for row in db.execute('PRAGMA table_info(players)')}
