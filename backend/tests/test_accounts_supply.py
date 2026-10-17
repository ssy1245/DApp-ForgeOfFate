"""Account persistence, daily grants and transactional test/shop inventory."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import uuid

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.game import BALANCE, probabilities
from backend.tests.test_game import post


def guest(tmp_path, demo=True):
    client=TestClient(create_app(str(tmp_path/'accounts.sqlite3'),demo=demo))
    address=client.post('/api/session').json()['address']
    return client,address


def credentials():
    return {'username':'tester_'+uuid.uuid4().hex[:8],'password':uuid.uuid4().hex}


def test_register_preserves_progress_and_login_restores(tmp_path):
    c,address=guest(tmp_path)
    original=c.get('/api/state').json()
    data=credentials()
    registered=c.post('/api/account/register',json=data)
    assert registered.status_code==200
    assert registered.json()['address']==address
    assert 'httponly' in registered.headers['set-cookie'].lower()
    with c.app.state.store.connection() as db:
        account=dict(db.execute('SELECT * FROM accounts').fetchone())
        assert account['password_hash'].startswith('pbkdf2_sha256$')
        assert data['password'] not in str(account)
    old_cookie=c.cookies.get('forge_session')
    assert c.post('/api/account/logout').status_code==200
    assert c.get('/api/state',headers={'Authorization':'Bearer '+old_cookie}).status_code==401
    c.post('/api/session')
    assert c.post('/api/account/login',json=data).json()['address']==address
    restored=c.get('/api/state').json()
    assert restored['weapons']==original['weapons']
    assert restored['player']['username']==data['username']
    assert c.post('/api/session').json()['username']==data['username']


def test_invalid_password_does_not_switch_archive(tmp_path):
    c,address=guest(tmp_path);data=credentials()
    c.post('/api/account/register',json=data)
    cookie=c.cookies.get('forge_session')
    wrong={**data,'password':uuid.uuid4().hex}
    assert c.post('/api/account/login',json=wrong).status_code==401
    assert c.cookies.get('forge_session')==cookie
    assert c.post('/api/session').json()['address']==address
    assert c.post('/api/account/register',json=credentials()).status_code==409


def test_normalized_username_uniqueness_and_validation(tmp_path):
    c,_=guest(tmp_path);data=credentials()
    assert c.post('/api/account/register',json=data).status_code==200
    c.post('/api/account/logout');c.post('/api/session')
    assert c.post('/api/account/register',json={**data,'username':data['username'].upper()}).status_code==409
    assert c.post('/api/account/register',json={**data,'username':'bad/name'}).status_code==400
    assert c.post('/api/account/register',json={**data,'password':'short'}).status_code==422


def test_daily_swords_concurrent_and_next_day(tmp_path):
    c,address=guest(tmp_path)
    with ThreadPoolExecutor(max_workers=3) as pool:
        states=list(pool.map(lambda _:c.get('/api/state').json(),range(3)))
    ids={w['id'] for w in states[0]['weapons']}
    assert len(ids)==BALANCE['daily_swords']==3
    for state in states:
        assert {w['id'] for w in state['weapons']}==ids
        assert all(w['level']==0 and w['quality']=='普通' and w['source']=='daily' for w in state['weapons'])
    with c.app.state.store.connection() as db:
        db.execute("UPDATE players SET sword_day='2000-01-01' WHERE address=?",(address,))
    state=c.get('/api/state').json()
    assert len(state['weapons'])==6
    assert state['player']['sword_day']==datetime.now(timezone.utc).date().isoformat()
    assert len(c.get('/api/state').json()['weapons'])==6


def test_test_supply_only_when_no_usable_sword_and_retry(tmp_path):
    c,address=guest(tmp_path)
    assert not c.get('/api/state').json()['can_rescue']
    assert post(c,'/test/supply',{}).status_code==409
    with c.app.state.store.connection() as db:
        db.execute("UPDATE weapons SET status='destroyed' WHERE owner=?",(address,))
    assert c.get('/api/state').json()['can_rescue']
    key=str(uuid.uuid4())
    response=post(c,'/test/supply',{},key=key)
    assert response.status_code==200
    assert post(c,'/test/supply',{},key=key).json()==response.json()
    assert post(c,'/test/supply',{}).status_code==409
    state=c.get('/api/state').json()
    assert len(state['weapons'])==1
    w=state['weapons'][0]
    assert w['level']==0 and w['demo']==1 and w['source']=='test_supply'
    assert state['player']['ap']==BALANCE['test_supply_ap']
    assert state['player']['materials']==BALANCE['test_supply_materials']
    # Sealed collectibles cannot be hammered; a new supply remains available.
    with c.app.state.store.connection() as db:
        db.execute("UPDATE weapons SET status='sealed' WHERE id=?",(w['id'],))
    assert c.get('/api/state').json()['can_rescue']
    assert post(c,'/test/supply',{}).status_code==200


def test_supply_disabled_outside_demo(tmp_path):
    c,_=guest(tmp_path,demo=False)
    assert post(c,'/test/supply',{}).status_code==404
    assert not c.get('/api/state').json()['can_rescue']


def test_coin_shop_cost_retry_and_insufficient_balance(tmp_path):
    c,address=guest(tmp_path)
    initial=c.get('/api/state').json()
    assert post(c,'/shop/sword',{}).status_code==409
    assert c.get('/api/state').json()['weapons']==initial['weapons']
    with c.app.state.store.connection() as db:
        db.execute('UPDATE players SET coins=? WHERE address=?',(BALANCE['coin_sword_price'],address))
    key=str(uuid.uuid4())
    response=post(c,'/shop/sword',{},key=key)
    assert response.status_code==200
    assert post(c,'/shop/sword',{},key=key).json()==response.json()
    assert post(c,'/shop/sword',{}).status_code==409
    state=c.get('/api/state').json()
    assert state['player']['coins']==0
    w=next(w for w in state['weapons'] if w['id']==response.json()['weapon_id'])
    assert w['quality']=='精良' and w['level']==BALANCE['coin_sword_level'] and w['source']=='coin_shop'
    assert len(state['weapons'])==4


def test_account_wallet_binding_preserves_daily_grant(tmp_path):
    c,address=guest(tmp_path);data=credentials()
    c.post('/api/account/register',json=data)
    before=c.get('/api/state').json()
    wallet=Account.create()
    challenge=c.post('/api/auth/challenge',json={'address':wallet.address}).json()
    signature=Account.sign_message(encode_defunct(text=challenge['message']),wallet.key).signature.hex()
    result=c.post('/api/auth/login',json={'challenge_id':challenge['challenge_id'],'signature':signature})
    assert result.status_code==200
    assert result.json()['username']==data['username'] and not result.json()['guest']
    after=c.get('/api/state').json()
    assert {w['id'] for w in after['weapons']}=={w['id'] for w in before['weapons']}
    c.post('/api/account/logout')
    assert c.post('/api/account/login',json=data).json()['address']==wallet.address
    assert c.get('/api/state').json()['player']['username']==data['username']


def test_reduced_destruction_curve():
    assert probabilities(0)['destroy']==0.01
    assert probabilities(10)['destroy']==0.03
    assert probabilities(50)['destroy']==0.11
    assert probabilities(100)['destroy']==0.15
