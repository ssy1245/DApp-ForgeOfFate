import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.storage import Store
from backend import purchase_locks as locks
from chain.server.rpc import ChainReader
from chain.tests.test_on_demand_tasks import env, result, TX, EPOCH
from chain.tests.test_indexer import A, B

C = '0x' + '33' * 20
INFO = dict(chainId=31337, address=A, deploymentId=EPOCH, deploymentBlock=2, abi=[])
SCOPE = dict(chain_id=31337, deployment_id=EPOCH)
BODY = dict(**SCOPE, token_id=str(2**255 + 17), seller=A, price_wei=str(10**25 + 1))


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setenv('FORGE_LOCAL_DIR', str(tmp_path))
    (tmp_path / 'deployment.json').write_text(json.dumps(INFO))
    monkeypatch.setattr(ChainReader, 'purchase_listing', Mock(return_value=(INFO, A, BODY['price_wei'])))
    monkeypatch.setattr(ChainReader, 'validate_purchase', Mock())
    clients = []
    for i, wallet in enumerate((B, C)):
        client = TestClient(create_app())
        player = client.post('/api/account/register', json={'username': f'buyer_{i}', 'password': 'test-password'}).json()
        with client.app.state.store.connection() as db:
            db.execute('INSERT INTO wallet_bindings SELECT id,?,1 FROM accounts WHERE game_address=?', (wallet, player['address']))
        clients.append(client)
    return clients


def reserve(client, **changes):
    return client.post('/api/chain/purchases', json={**BODY, **changes})


def action(client, lock_id, name):
    return client.post(f'/api/chain/purchases/{lock_id}/{name}', json=SCOPE)


def submit(client, lock_id, **changes):
    return client.post('/api/chain/tasks', json=dict(**SCOPE, target='nft', tx_hash=TX, purchase_lock_id=lock_id) | changes)


def test_two_independent_servers_race_for_same_nft_and_only_one_wins(clients):
    barrier = Barrier(2)
    def purchase(client):
        barrier.wait()
        return reserve(client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(purchase, clients))
    assert sorted(r.status_code for r in responses) == [200, 409]
    winner = next(i for i, r in enumerate(responses) if r.status_code == 200)
    # Even the winner cannot submit a second purchase from another tab.
    assert reserve(clients[winner]).status_code == 409
    assert reserve(clients[1-winner], token_id='42').status_code == 200
    Store(clients[0].app.state.store.path)  # Restart/migrate without losing the lock.
    assert reserve(clients[1-winner]).status_code == 409


def test_owner_only_release_and_old_release_cannot_delete_new_lock(clients):
    first, second = clients
    lock_id = reserve(first).json()['id']
    assert action(second, lock_id, 'release').status_code == 404
    assert action(second, lock_id, 'begin').status_code == 404
    assert action(first, lock_id, 'release').status_code == 200
    new_id = reserve(second).json()['id']
    assert action(first, lock_id, 'release').status_code == 200
    assert reserve(first).status_code == 409
    assert action(second, new_id, 'begin').status_code == 200


def test_only_preparation_expires_and_pending_release_is_denied(clients):
    first, second = clients
    lock_id = reserve(first).json()['id']
    store = first.app.state.store
    with store.connection() as db:
        db.execute('UPDATE nft_purchase_locks SET expires_at=0')
    assert action(first, lock_id, 'begin').status_code == 409
    lock_id = reserve(second).json()['id']
    assert action(second, lock_id, 'begin').status_code == 200
    # Closing the page during a wallet request cannot safely expire this lock.
    with store.connection() as db:
        db.execute('UPDATE nft_purchase_locks SET expires_at=0')
    assert reserve(first).status_code == 409
    for _ in range(3):
        assert submit(second, lock_id).status_code == 200
    ChainReader.validate_purchase.assert_not_called()
    assert action(second, lock_id, 'release').status_code == 409
    assert submit(second, lock_id, tx_hash='0x' + '55'*32).status_code == 409
    assert reserve(first).status_code == 409


def test_task_submission_is_local_and_survives_unavailable_rpc(clients):
    first, second = clients
    lock_id = reserve(first).json()['id']
    assert action(first, lock_id, 'begin').status_code == 200
    ChainReader.validate_purchase.side_effect = HTTPException(503, 'offline')
    assert submit(first, lock_id).status_code == 200
    ChainReader.validate_purchase.assert_not_called()
    assert reserve(second).status_code == 409
    with first.app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM chain_tasks').fetchone()[0] == 1


def test_authentication_listing_and_input_checks_precede_lock_creation(clients):
    first, _ = clients
    anonymous = TestClient(first.app)
    assert reserve(anonymous).status_code == 401
    anonymous.post('/api/session')
    assert reserve(anonymous).status_code == 403
    for change, status in [({'token_id': '-1'}, 422), ({'token_id': str(2**256)}, 400),
                           ({'price_wei': '0'}, 422), ({'price_wei': '1'}, 409),
                           ({'seller': C}, 409), ({'deployment_id': TX}, 409), ({'chain_id': 1}, 409)]:
        assert reserve(first, **change).status_code == status
    ChainReader.purchase_listing.return_value = (INFO, B, BODY['price_wei'])
    assert reserve(first, seller=B).status_code == 409
    with first.app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM nft_purchase_locks').fetchone()[0] == 0


def attach_worker_lock(env):
    with env.store.connection() as db:
        lock_id = locks.reserve(db, env.source.manifest, '42', A, B, '123', now=env.now[0])['id']
        row = locks.owned_lock(db, lock_id, env.source.manifest, A)
        locks.begin(db, row, now=env.now[0])
    task = env.submit()
    with env.store.connection() as db:
        locks.attach(db, locks.owned_lock(db, lock_id, env.source.manifest, A), TX, task)
    return lock_id


def lock_state(env, lock_id):
    with env.store.connection() as db:
        return db.execute('SELECT state FROM nft_purchase_locks WHERE id=?', (lock_id,)).fetchone()[0]


@pytest.mark.parametrize('outcome', ['confirmed', 'failed'])
def test_worker_releases_only_after_finality_and_recovers_after_restart(env, outcome):
    lock_id = attach_worker_lock(env)
    env.reader.receipt.return_value = result('confirming')
    env.now[0] += 30; env.worker().tick()
    assert lock_state(env, lock_id) == 'pending'
    env.reader.receipt.return_value = result(outcome)
    if outcome == 'confirmed':
        good = env.source.open
        env.source.open = Mock(side_effect=RuntimeError('offline'))
        env.now[0] += 30; env.worker().tick()
        assert lock_state(env, lock_id) == 'pending'
        env.source.open = good
    env.now[0] += 30; env.worker().tick()
    assert lock_state(env, lock_id) == 'released'


def test_expired_check_and_foreign_receipt_never_unlock(env):
    lock_id = attach_worker_lock(env)
    env.reader.receipt.return_value = result(wallet=B)
    env.now[0] += 30; env.worker().tick()
    assert lock_state(env, lock_id) == 'pending'
    with env.store.connection() as db:
        db.execute("UPDATE chain_tasks SET state='pending'")
    env.now[0] += 86400; env.worker().tick()
    assert lock_state(env, lock_id) == 'pending'


@pytest.mark.parametrize('changed', ['token', 'seller', 'price', 'value', 'sender', 'contract', 'method', None])
def test_reader_checks_actual_buy_calldata(changed):
    reader = ChainReader(None)
    args = dict(tokenId=42, expectedSeller=A, expectedPrice=123)
    tx = dict(to=A, **{'from': B}, input='data', value=123)
    function = SimpleNamespace(fn_name='buy')
    lock = dict(chain_id=31337, contract=A, deployment=EPOCH, token_id='42', buyer=B, seller=A, price_wei='123')
    if changed == 'token': args['tokenId'] = 43
    if changed == 'seller': args['expectedSeller'] = B
    if changed == 'price': args['expectedPrice'] = 124
    if changed == 'value': tx['value'] = 124
    if changed == 'sender': tx['from'] = C
    if changed == 'contract': tx['to'] = C
    if changed == 'method': function.fn_name = 'list'
    w3, contract = Mock(), Mock()
    w3.eth.get_transaction.return_value = tx
    contract.decode_function_input.return_value = (function, args)
    reader.connect = Mock(return_value=(INFO, w3, contract))
    if changed:
        with pytest.raises(HTTPException) as error: reader.validate_purchase(TX, lock)
        assert error.value.status_code == 409
    else:
        reader.validate_purchase(TX, lock)


@pytest.mark.parametrize('status', [503, 409])
def test_worker_retries_unavailable_purchase_but_rejects_wrong_calldata(env, status):
    lock_id = attach_worker_lock(env)
    env.reader.validate_purchase.side_effect = HTTPException(status, 'not verified')
    env.reader.receipt.return_value = result()
    env.now[0] += 30; env.worker().tick()
    assert lock_state(env, lock_id) == 'pending'
    env.reader.receipt.assert_not_called()
    with env.store.connection() as db:
        job = db.execute('SELECT state FROM chain_tasks WHERE tx_hash=?', (TX,)).fetchone()[0]
        assert job == ('pending' if status == 503 else 'rejected')
    if status == 503:
        env.reader.validate_purchase.side_effect = None
        env.now[0] += 30; env.worker().tick()
        assert lock_state(env, lock_id) == 'released'


def test_attaching_while_worker_finishes_requires_validation_on_next_tick(env):
    lock_id = attach_worker_lock(env)
    with env.store.connection() as db:
        job = dict(db.execute('SELECT * FROM chain_tasks WHERE tx_hash=?', (TX,)).fetchone())
    # Simulate an already running worker that read the job before attachment.
    env.worker().finish(job)
    with env.store.connection() as db:
        assert db.execute('SELECT state FROM chain_tasks WHERE id=?', (job['id'],)).fetchone()[0] == 'pending'
    assert lock_state(env, lock_id) == 'pending'
    env.reader.receipt.return_value = result()
    env.now[0] += 30; env.worker().tick()
    env.reader.validate_purchase.assert_called_once()
    assert lock_state(env, lock_id) == 'released'


def test_one_transaction_cannot_be_reused_for_another_reservation(clients):
    first, _ = clients
    lock_id = reserve(first).json()['id']
    assert action(first, lock_id, 'begin').status_code == 200
    assert submit(first, lock_id).status_code == 200
    other_id = reserve(first, token_id='42').json()['id']
    assert action(first, other_id, 'begin').status_code == 200
    assert submit(first, other_id).status_code == 409
    assert action(first, other_id, 'release').status_code == 200
    assert action(first, lock_id, 'release').status_code == 409
