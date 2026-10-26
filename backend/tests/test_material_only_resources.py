"""Removing energy must preserve progress and keep material spending atomic."""
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.game import BALANCE
from backend.tests.test_game import client, login, post, warm, weapon


def test_public_state_and_config_no_longer_expose_action_points(client):
    headers, *_ = login(client)
    assert 'ap' not in client.get('/api/state', headers=headers).json()['player']
    balance = client.get('/api/config').json()['balance']
    assert not any(key.endswith('_ap') for key in balance)
    with client.app.state.store.connection() as db:
        assert 'ap' not in {row['name'] for row in db.execute('PRAGMA table_info(players)')}


def test_iron_alone_can_pay_for_forging_heating_and_striking(client, monkeypatch):
    headers, *_ = login(client)
    total = BALANCE['forge_materials'] + BALANCE['heat_materials'] + BALANCE['strike_materials']
    with client.app.state.store.connection() as db:
        db.execute('UPDATE players SET materials=?', (total,))
    forged = post(client, '/forge', headers)
    assert forged.status_code == 200
    wid = forged.json()['weapon_id']
    assert post(client, f'/weapons/{wid}/heat', headers).status_code == 200
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET heat_ready_at=0 WHERE id=?', (wid,))
    monkeypatch.setattr('backend.app.secrets.randbelow', lambda _: 0)
    hit = post(client, f'/weapons/{wid}/strike', headers, {
        'expected_level': 0, 'expected_strikes': 0, 'expected_protected_left': 0,
    })
    assert hit.status_code == 200 and hit.json()['level'] == 1
    player = client.get('/api/state', headers=headers).json()['player']
    assert player['materials'] == player['coins'] == player['shields'] == 0


def test_retiring_old_ap_column_preserves_accounts_sessions_and_progress(client):
    client.post('/api/session')
    registered = client.post('/api/account/register', json={
        'username': 'migration_player', 'password': 'migration_password_123',
    })
    assert registered.status_code == 200
    assert post(client, '/claim', {}).status_code == 200
    assert post(client, '/forge', {}).status_code == 200
    before = client.get('/api/state').json()
    tables = ['accounts', 'players', 'weapons', 'sessions', 'challenges', 'operations']
    with client.app.state.store.connection() as db:
        snapshot = {table: [dict(row) for row in db.execute(f'SELECT * FROM {table}')] for table in tables}
        db.execute('ALTER TABLE players ADD COLUMN ap INTEGER DEFAULT 0')
        db.execute('UPDATE players SET ap=450')
    for _ in range(2):
        # Reopening twice checks both the upgrade and its idempotence.
        restored = TestClient(create_app(client.app.state.store.path, demo=False))
        restored.cookies.update(client.cookies)
        assert restored.get('/api/state').json() == before
        with restored.app.state.store.connection() as db:
            for table in tables:
                assert [dict(row) for row in db.execute(f'SELECT * FROM {table}')] == snapshot[table]


def test_more_than_one_hundred_strikes_only_require_iron_and_heat(client, monkeypatch):
    headers, *_ = login(client)
    strikes = 105
    heat_count = (strikes + BALANCE['heat_strikes'] - 1) // BALANCE['heat_strikes']
    materials = BALANCE['forge_materials'] + heat_count * BALANCE['heat_materials'] + strikes * BALANCE['strike_materials']
    with client.app.state.store.connection() as db:
        db.execute('UPDATE players SET materials=?', (materials,))
    forged = post(client, '/forge', headers)
    assert forged.status_code == 200
    wid = forged.json()['weapon_id']
    # Downgrades at +0 keep the same weapon and route cost for this endurance check.
    monkeypatch.setattr('backend.app.secrets.randbelow', lambda _: 900000)
    for _ in range(strikes):
        current = weapon(client, headers)
        if not current['heat_charges']:
            warm(client, headers, wid)
        hit = post(client, f'/weapons/{wid}/strike', headers, {
            'expected_level': current['level'], 'expected_strikes': current['strikes'],
            'expected_protected_left': current['protected_left'],
        })
        assert hit.status_code == 200 and hit.json()['status'] == 'active'
    state = client.get('/api/state', headers=headers).json()
    assert state['player']['materials'] == 0 and 'ap' not in state['player']
    assert weapon(client, headers)['heat_charges'] == 0
