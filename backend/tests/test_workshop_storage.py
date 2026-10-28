from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import uuid

import pytest
from fastapi.testclient import TestClient
from eth_account import Account
from eth_account.messages import encode_defunct

from backend.app import create_app, Store
from test_game import login, post


@pytest.fixture
def setup(tmp_path):
    client = TestClient(create_app(tmp_path / 'game.sqlite3', demo=False))
    headers, wallet, *_ = login(client)
    post(client, '/claim', headers)
    a = post(client, '/forge', headers).json()['weapon_id']
    b = post(client, '/forge', headers).json()['weapon_id']
    return client, headers, wallet.address, a, b


def state(client, headers):
    return client.get('/api/state', headers=headers).json()


def select(client, headers, wid, revision=None, key=None, route='equip'):
    revision = state(client, headers)['player']['workshop_revision'] if revision is None else revision
    return post(client, '/workshop/' + route, headers, {'weapon_id': wid, 'expected_revision': revision}, key)


def test_store_swap_and_restart_preserve_all_weapon_progress(setup):
    c, h, address, a, b = setup
    with c.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET level=17,strikes=3,protected_left=2,heat_charges=4,heat_ready_at=123 WHERE id=?', (a,))
    initial = state(c, h)
    assert initial['player']['workshop_weapon_id'] == a
    assert select(c, h, b).status_code == 200
    assert state(c, h)['player']['workshop_weapon_id'] == b
    assert select(c, h, b, route='store').status_code == 200
    empty = state(c, h)
    assert empty['player']['workshop_weapon_id'] is None
    assert empty['weapons'] == initial['weapons']
    for field in ['coins','materials','shields']:
        assert empty['player'][field] == initial['player'][field]
    restored = TestClient(create_app(c.app.state.store.path))
    assert state(restored, h)['player']['workshop_weapon_id'] is None
    assert select(restored, h, a).status_code == 200
    assert state(restored, h)['player']['workshop_weapon_id'] == a


def test_new_weapon_does_not_replace_an_occupied_workshop(setup):
    c, h, _, a, b = setup
    assert state(c, h)['player']['workshop_weapon_id'] == a
    assert b in [w['id'] for w in state(c, h)['weapons']]


def test_retry_and_stale_selection_do_not_overwrite_newer_choice(setup):
    c, h, _, a, b = setup
    revision = state(c, h)['player']['workshop_revision']
    key = str(uuid.uuid4())
    first = select(c, h, b, revision, key)
    assert first.status_code == 200
    assert select(c, h, b, revision, key).json() == first.json()
    assert select(c, h, a, revision).status_code == 409
    assert select(c, h, a, revision, route='store').status_code == 409
    assert state(c, h)['player']['workshop_weapon_id'] == b


def test_concurrent_choices_have_one_winner(setup):
    c, h, _, a, b = setup
    select(c, h, a, route='store')
    revision = state(c, h)['player']['workshop_revision']
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda wid: select(c, h, wid, revision), [a, b]))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert state(c, h)['player']['workshop_revision'] == revision + 1


@pytest.mark.parametrize('change', ['delete','sealed','destroyed','recycled','transferred','owner'])
def test_external_changes_remove_invalid_current_without_selecting_a_replacement(setup, change):
    c, h, _, a, b = setup
    before = state(c, h)['player']['workshop_revision']
    with c.app.state.store.connection() as db:
        if change == 'delete': db.execute('DELETE FROM weapons WHERE id=?', (a,))
        elif change == 'owner': db.execute('UPDATE weapons SET owner=? WHERE id=?', ('0x'+'22'*20, a))
        else: db.execute('UPDATE weapons SET status=? WHERE id=?', (change, a))
    data = state(c, h)
    assert data['player']['workshop_weapon_id'] is None
    assert data['player']['workshop_revision'] == before + 1
    assert state(c, h)['player']['workshop_revision'] == before + 1
    assert b in [w['id'] for w in data['weapons']]
    if change != 'sealed': assert a not in [w['id'] for w in data['weapons']]
    assert post(c, '/weapons/' + a + '/heat', h).status_code in (404, 409)


def test_stored_or_foreign_weapons_cannot_be_used_for_striking(setup):
    c, h, address, a, b = setup
    before = state(c, h)['player']['materials']
    with c.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET heat_charges=5,heat_ready_at=0 WHERE id=?', (b,))
    assert post(c, '/weapons/'+b+'/heat', h).status_code == 409
    assert post(c, '/weapons/'+b+'/strike', h, {'expected_level':0,'expected_strikes':0,'expected_protected_left':0}).status_code == 409
    other, *_ = login(c)
    assert select(c, other, a).status_code == 404
    assert state(c, h)['player']['materials'] == before


@pytest.mark.parametrize('endpoint', ['seal','recycle'])
def test_terminal_action_clears_current_in_same_transaction(setup, endpoint):
    c, h, address, a, _ = setup
    with c.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET level=50 WHERE id=?', (a,))
    assert post(c, f'/weapons/{a}/{endpoint}', h).status_code == 200
    with c.app.state.store.connection() as db:
        assert db.execute('SELECT workshop_weapon_id FROM players WHERE address=?', (address,)).fetchone()[0] is None


def test_destroyed_weapon_clears_workshop_without_equiping_next(setup, monkeypatch):
    c, h, address, a, b = setup
    with c.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET heat_charges=5,heat_ready_at=0 WHERE id=?', (a,))
    monkeypatch.setattr('backend.app.secrets.randbelow', lambda _: 999999)
    assert post(c, f'/weapons/{a}/strike', h, {'expected_level':0,'expected_strikes':0,'expected_protected_left':0}).json()['result'] == 'destroy'
    with c.app.state.store.connection() as db:
        assert db.execute('SELECT workshop_weapon_id FROM players WHERE address=?', (address,)).fetchone()[0] is None
    assert state(c, h)['weapons'][0]['id'] == b


def test_stale_heat_after_store_and_take_back_does_not_spend(setup):
    c, h, _, a, _ = setup
    revision = state(c, h)['player']['workshop_revision']
    select(c, h, a, route='store'); select(c, h, a)
    before = state(c, h)['player']['materials']
    assert post(c, f'/weapons/{a}/heat', {**h, 'X-Forge-Workshop-Revision': str(revision)}).status_code == 409
    assert state(c, h)['player']['materials'] == before


def test_old_save_upgrade_preserves_weapons_and_starts_empty(tmp_path):
    file = tmp_path / 'game.sqlite3'
    store = Store(file)
    with store.connection() as db:
        db.execute("INSERT INTO players(address,coins) VALUES('old-player',99)")
        db.execute("INSERT INTO weapons(id,owner,level) VALUES('old-sword','old-player',40)")
        db.execute('ALTER TABLE players DROP COLUMN workshop_weapon_id')
        db.execute('ALTER TABLE players DROP COLUMN workshop_revision')
    with Store(file).connection() as db:
        player = dict(db.execute('SELECT * FROM players').fetchone())
        assert player['coins'] == 99 and player['workshop_weapon_id'] is None
        assert db.execute('SELECT level FROM weapons').fetchone()[0] == 40


def test_wallet_binding_preserves_workshop_selection(tmp_path):
    c = TestClient(create_app(tmp_path / 'game.sqlite3'))
    c.post('/api/session')
    post(c, '/claim', {})
    wid = post(c, '/forge', {}).json()['weapon_id']
    wallet = Account.create()
    challenge = c.post('/api/auth/challenge', json={'address': wallet.address}).json()
    signature = Account.sign_message(encode_defunct(text=challenge['message']), wallet.key).signature.hex()
    assert c.post('/api/auth/login', json={'challenge_id': challenge['challenge_id'], 'signature': signature}).status_code == 200
    data = state(c, {})
    assert data['player']['workshop_weapon_id'] == wid
    assert data['weapons'][0]['owner'] == wallet.address
