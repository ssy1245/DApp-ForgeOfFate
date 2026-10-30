from concurrent.futures import ThreadPoolExecutor
import sqlite3
import time
import uuid

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.storage import Store


@pytest.fixture
def app(tmp_path):
    return create_app(tmp_path / 'wallets.sqlite3')


def player(app):
    c = TestClient(app)
    credentials = {'username': 'p_' + uuid.uuid4().hex[:10], 'password': 'test-password-2026'}
    response = c.post('/api/account/register', json=credentials)
    assert response.status_code == 200
    return c, credentials, response.json()


def proof(c, wallet, headers=None):
    r = c.post('/api/wallet/challenge', json={'address': wallet.address}, headers=headers or {})
    assert r.status_code == 200, r.text
    challenge = r.json()
    return {'challenge_id': challenge['challenge_id'], 'signature': Account.sign_message(
        encode_defunct(text=challenge['message']), wallet.key).signature.hex()}, challenge


def bind(c, body, headers=None):
    return c.post('/api/wallet/bind', json=body, headers=headers or {})


def test_requires_registered_session_and_retires_wallet_login(app):
    c = TestClient(app)
    wallet = Account.create()
    for _ in range(2):
        assert c.post('/api/wallet/challenge', json={'address': wallet.address}).status_code == 401
        c.post('/api/session')
    for route in ['/api/auth/challenge', '/api/auth/login']:
        assert c.post(route, json={'address': wallet.address}).status_code == 410
    assert c.get('/api/state').json()['player']['wallet_address'] is None


def test_bind_preserves_identity_resources_weapons_and_restart(app):
    c, credentials, account = player(app)
    key = str(uuid.uuid4())
    c.post('/api/claim', headers={'Idempotency-Key': key})
    c.post('/api/supply/sword', headers={'Idempotency-Key': str(uuid.uuid4())})
    before = c.get('/api/state').json()
    wallet = Account.create()
    body, challenge = proof(c, wallet)
    for value in [account['player_id'], credentials['username'], wallet.address, '31337', 'http://127.0.0.1:5173', 'Nonce:', 'Expires:', 'No transaction']:
        assert value in challenge['message']
    assert c.get('/api/state').json()['player']['wallet_address'] is None  # no binding before proof
    r = bind(c, body)
    assert r.status_code == 200
    assert r.json()['wallet_verified'] and r.json()['wallet_address'] == wallet.address
    assert r.json()['player_id'] == account['player_id'] and r.json()['address'] == account['address']
    after = c.get('/api/state').json()
    assert after['weapons'] == before['weapons']
    for field in ['coins', 'materials', 'shields', 'daily_swords_remaining', 'workshop_weapon_id', 'workshop_revision']:
        assert after['player'][field] == before['player'][field]
    assert c.post('/api/claim', headers={'Idempotency-Key': key}).status_code == 200
    # Retry an already consumed message fails; a fresh proof of the same wallet succeeds.
    assert bind(c, body).status_code == 409
    assert bind(c, proof(c, wallet)[0]).status_code == 200
    reopened = TestClient(create_app(app.state.store.path))
    login = reopened.post('/api/account/login', json=credentials).json()
    assert login['wallet_address'] == wallet.address and login['wallet_verified']
    assert reopened.get('/api/state').json() == after


@pytest.mark.parametrize('kind', ['wrong_wallet', 'tampered_message', 'expired'])
def test_bad_proof_does_not_bind_or_change_game_session(app, kind):
    c, _, account = player(app)
    wallet = Account.create()
    body, challenge = proof(c, wallet)
    if kind == 'expired':
        with app.state.store.connection() as db:
            db.execute('UPDATE wallet_challenges SET expires=?', (int(time.time()) - 1,))
    else:
        message = challenge['message'] + (' tampered' if kind == 'tampered_message' else '')
        key = wallet.key if kind == 'tampered_message' else Account.create().key
        body['signature'] = Account.sign_message(encode_defunct(text=message), key).signature.hex()
    assert bind(c, body).status_code in (400, 409)
    current = c.post('/api/session').json()
    assert current['player_id'] == account['player_id'] and current['wallet_address'] is None


def test_cannot_use_proof_from_other_account_or_other_session(app):
    a, credentials, _ = player(app)
    b, _, _ = player(app)
    body, _ = proof(a, Account.create())
    assert bind(b, body).status_code == 409
    other_session = TestClient(app)
    other_session.post('/api/account/login', json=credentials)
    assert bind(other_session, body).status_code == 409
    assert bind(a, body).status_code == 200


def test_logout_invalidates_outstanding_proof(app):
    c, credentials, _ = player(app)
    body, _ = proof(c, Account.create())
    token = c.cookies.get('forge_session')
    c.post('/api/account/logout')
    assert bind(c, body, {'Authorization': 'Bearer ' + token}).status_code == 401
    c.post('/api/account/login', json=credentials)
    assert bind(c, body).status_code == 409


def test_origin_and_network_are_part_of_proof(app):
    c, _, _ = player(app)
    wallet = Account.create()
    assert c.post('/api/wallet/challenge', json={'address': wallet.address}, headers={'Origin': 'https://attacker.invalid'}).status_code == 403
    body, _ = proof(c, wallet)
    assert bind(c, body, {'Origin': 'https://attacker.invalid'}).status_code == 403
    assert bind(c, body, {'Origin': 'http://localhost:5173'}).status_code == 409
    with app.state.store.connection() as db:
        db.execute('UPDATE wallet_challenges SET chain_id=11155111')
    assert bind(c, body).status_code == 409


@pytest.mark.parametrize('same_account', [True, False])
def test_concurrent_bindings_enforce_both_unique_constraints(app, same_account):
    a, _, _ = player(app)
    b = a if same_account else player(app)[0]
    wa = Account.create()
    wb = Account.create() if same_account else wa
    pa, _ = proof(a, wa)
    pb, _ = proof(b, wb)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(bind, c, body) for c, body in [(a, pa), (b, pb)]]
        assert sorted(f.result().status_code for f in futures) == [200, 409]
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM wallet_bindings').fetchone()[0] == 1


def test_database_prevents_case_variant_duplicates_and_second_wallet(app):
    a, _, aa = player(app)
    _, _, ab = player(app)
    wa = Account.create()
    assert bind(a, proof(a, wa)[0]).status_code == 200
    with pytest.raises(sqlite3.IntegrityError), app.state.store.connection() as db:
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)', (ab['player_id'], wa.address.lower(), int(time.time())))
    with pytest.raises(sqlite3.IntegrityError), app.state.store.connection() as db:
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)', (aa['player_id'], Account.create().address, int(time.time())))
    assert a.post('/api/wallet/challenge', json={'address': Account.create().address}).status_code == 409
    assert a.post('/api/wallet/challenge', json={'address': wa.address.lower()}).status_code == 200


def test_legacy_migration_reserves_wallet_requires_proof_and_preserves_save(app):
    c, credentials, account = player(app)
    wallet = Account.create()
    # Recreate the previous schema's account->wallet archive arrangement.
    with app.state.store.connection() as db:
        db.execute('DROP TABLE wallet_bindings')
        db.execute('UPDATE players SET address=?,guest=0,coins=123 WHERE address=?', (wallet.address, account['address']))
        db.execute('UPDATE accounts SET game_address=? WHERE id=?', (wallet.address, account['player_id']))
        db.execute('UPDATE sessions SET address=? WHERE address=?', (wallet.address, account['address']))
    reopened = create_app(app.state.store.path)
    client = TestClient(reopened)
    data = client.post('/api/account/login', json=credentials).json()
    assert data['wallet_address'] == wallet.address and not data['wallet_verified']
    assert data['player_id'] == account['player_id']
    other = player(reopened)[0]
    assert other.post('/api/wallet/challenge', json={'address': wallet.address}).status_code == 409
    assert bind(client, proof(client, wallet)[0]).status_code == 200
    assert client.get('/api/state').json()['player']['coins'] == 123
    with Store(app.state.store.path).connection() as db:
        assert db.execute('SELECT verified_at FROM wallet_bindings').fetchone()[0] is not None


def test_legacy_conflicts_roll_back_migration_without_merging(app):
    _, _, a = player(app)
    _, _, b = player(app)
    wallet = Account.create()
    with app.state.store.connection() as db:
        db.execute('DROP TABLE wallet_bindings')
        for who, address in [(a, wallet.address), (b, wallet.address.lower())]:
            db.execute('UPDATE players SET address=?,guest=0 WHERE address=?', (address, who['address']))
            db.execute('UPDATE accounts SET game_address=? WHERE id=?', (address, who['player_id']))
    with pytest.raises(sqlite3.IntegrityError):
        Store(app.state.store.path)
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 2
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='wallet_bindings'").fetchone()


@pytest.mark.parametrize('already_bound', [False, True])
def test_register_historical_wallet_only_save_never_merges(app, already_bound):
    wallet = Account.create()
    if already_bound:
        other, _, _ = player(app)
        assert bind(other, proof(other, wallet)[0]).status_code == 200
    c = TestClient(app)
    archive = c.post('/api/session').json()['address']
    with app.state.store.connection() as db:
        db.execute('UPDATE players SET address=?,guest=0,coins=51 WHERE address=?', (wallet.address, archive))
        db.execute('UPDATE sessions SET address=? WHERE address=?', (wallet.address, archive))
    r = c.post('/api/account/register', json={'username':'historical_player','password':'test-password-2026'})
    assert r.status_code == (409 if already_bound else 200)
    assert c.get('/api/state').json()['player']['coins'] == 51
    if not already_bound:
        assert r.json()['wallet_address'] == wallet.address and not r.json()['wallet_verified']
        assert bind(c, proof(c, wallet)[0]).status_code == 200
    else:
        with app.state.store.connection() as db:
            assert not db.execute("SELECT 1 FROM accounts WHERE username='historical_player'").fetchone()
