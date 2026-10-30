import copy
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from backend.storage import Store
from chain.server.indexer import Indexer, IndexFailure, IndexHalt, RpcSource
from chain.server.rpc import ChainSettings
from chain.server.store import index_status, event_history
from backend.app import create_app
from web3 import Web3
from hexbytes import HexBytes

A, B = '0x' + '11' * 20, '0x' + '22' * 20
TOKEN = str(2**255 + 17)


class FakeSource:
    def __init__(self):
        self.head = self.confirmed = 8
        self.hashes = {n: '0x' + hashlib.sha256(str(n).encode()).hexdigest() for n in range(30)}
        self.manifest = {'address': A, 'deploymentId': 'epoch', 'deploymentBlock': 2, 'network': 'local', 'chainId': 31337}
        self.events = []
        self.calls = []

    def open(self): return copy.deepcopy(self.manifest)
    def block_hash(self, number): return self.hashes[number]
    def boundary(self): return self.head, self.confirmed
    def logs(self, start, end):
        self.calls.append((start, end))
        return [copy.deepcopy(e) for e in self.events if start <= e['block_number'] <= end]

    def add(self, name, args, block=3, index=0):
        self.events.append({'name': name, 'args': args, 'block_number': block, 'block_hash': self.hashes[block],
                            'log_index': index, 'transaction_index': 0, 'transaction_hash': '0x' + f'{block:064x}', 'contract_address': A})


@pytest.fixture
def setup(tmp_path):
    store, source = Store(tmp_path / 'game.sqlite3'), FakeSource()
    source.add('Transfer', {'tokenId': TOKEN, 'from': '0x'+'00'*20, 'to': A})
    source.add('Forged', {'tokenId': TOKEN, 'level': '50', 'recipient': A}, index=1)
    source.add('Listed', {'tokenId': TOKEN, 'seller': A, 'price': str(10**25 + 1)}, block=5)
    return store, source, Indexer(store, source, batch_size=3)


def catch_up(indexer):
    for _ in range(20):
        if indexer.tick(): return
    raise AssertionError('Indexer did not catch up')


def nft(store):
    with store.connection() as db:
        return dict(db.execute('SELECT * FROM chain_nfts').fetchone())


def test_restart_duplicate_scan_and_empty_blocks(setup):
    store, source, indexer = setup
    assert not indexer.tick()
    assert index_status(store)['scannedBlock'] == 4
    catch_up(Indexer(store, source, 2))
    assert index_status(store)['scannedBlock'] == 8
    assert index_status(store)['processedBlock'] == 8
    assert nft(store)['price_wei'] == str(10**25 + 1)
    count = index_status(store)['eventCount']
    source.head = source.confirmed = 12
    source.add('Transfer', {'tokenId': TOKEN, 'from': A, 'to': B}, block=10)
    catch_up(Indexer(store, source))
    assert nft(store)['owner'] == B and nft(store)['price_wei'] == '0'
    assert index_status(store)['eventCount'] == count + 1
    catch_up(Indexer(Store(store.path), source))
    assert index_status(store)['eventCount'] == count + 1
    assert not index_status(store)['fundingReady']


def test_unconfirmed_events_wait_for_finality(setup):
    store, source, indexer = setup
    source.confirmed = 3
    catch_up(indexer)
    assert index_status(store)['headBlock'] == 8
    assert index_status(store)['eventCount'] == 2
    assert nft(store)['price_wei'] == '0'
    source.confirmed = 8; catch_up(indexer)
    assert nft(store)['price_wei'] != '0'


def test_new_deployment_ahead_of_finality_waits_without_halting(setup):
    store, source, indexer = setup
    source.manifest['deploymentBlock'] = 8; source.confirmed = 3; source.events = []
    assert indexer.tick()
    assert index_status(store)['state'] == 'waiting'
    assert not index_status(store)['caughtUp']
    source.confirmed = 8
    assert indexer.tick()
    assert index_status(store)['caughtUp']


def test_rpc_log_range_limit_shrinks_and_does_not_skip(setup):
    store, source, indexer = setup
    original = source.logs
    def restricted(start, end):
        if end > start: raise RuntimeError('provider range limit')
        return original(start, end)
    source.logs = restricted
    catch_up(indexer)
    assert index_status(store)['eventCount'] == 3
    assert source.calls == [(n, n) for n in range(2, 9)]


def test_rpc_failure_keeps_cursor_and_never_leaks_credentials(setup):
    store, source, indexer = setup
    source.logs = Mock(side_effect=RuntimeError('https://rpc.invalid/secret-api-key'))
    with pytest.raises(IndexFailure): indexer.tick()
    status = index_status(store)
    assert status['scannedBlock'] == 1 and status['eventCount'] == 0
    assert not status['rpcAvailable'] and 'secret-api-key' not in json.dumps(status)


def test_projection_crash_rolls_back_but_saved_events_resume(setup):
    store, source, indexer = setup
    apply = indexer.apply_event
    def crash(db, event):
        apply(db, event)
        raise RuntimeError('simulated crash after projection write')
    indexer.apply_event = crash
    with pytest.raises(IndexFailure): indexer.tick()
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM chain_nfts').fetchone()[0] == 0
    assert index_status(store)['scannedBlock'] == 4
    assert index_status(store)['pendingEvents'] == 2
    catch_up(Indexer(store, source))
    assert index_status(store)['pendingEvents'] == 0
    assert nft(store)['owner'] == A


@pytest.mark.parametrize('change', ['hash', 'head', 'deployment'])
def test_changed_saved_chain_halts_without_deleting_evidence(setup, change):
    store, source, indexer = setup; catch_up(indexer)
    before = event_history(store)
    if change == 'hash': source.hashes[8] = '0x' + 'ff'*32
    elif change == 'head': source.head = source.confirmed = 7
    else: source.manifest['deploymentId'] = 'another-deployment'
    with pytest.raises(IndexHalt): indexer.tick()
    assert index_status(store)['state'] == 'halted'
    assert event_history(store) == before
    # A process restart must not silently dismiss the audit condition.
    with pytest.raises(IndexHalt): Indexer(store, FakeSource()).tick()


def test_inconsistent_batch_has_no_partial_events_or_progress(setup):
    store, source, indexer = setup
    source.events[1]['block_hash'] = '0x' + 'ff'*32
    with pytest.raises(IndexFailure): indexer.tick()
    assert index_status(store)['scannedBlock'] == 1
    assert index_status(store)['eventCount'] == 0


def test_duplicate_rpc_log_is_saved_once(setup):
    store, source, indexer = setup
    source.events.append(copy.deepcopy(source.events[0]))
    catch_up(indexer)
    assert index_status(store)['eventCount'] == 3


def test_receiver_callback_transfer_and_relisting_are_not_overwritten(setup):
    store, source, indexer = setup
    source.events = []
    source.add('Transfer', {'tokenId': TOKEN, 'to': A}, index=0)
    source.add('Transfer', {'tokenId': TOKEN, 'to': B}, index=1)
    source.add('Forged', {'tokenId': TOKEN, 'recipient': A, 'level': '90'}, index=2)
    source.add('Listed', {'tokenId': TOKEN, 'seller': B, 'price': '100'}, index=3)
    source.add('Purchased', {'tokenId': TOKEN, 'buyer': A, 'seller': B, 'price': '50'}, index=4)
    catch_up(indexer)
    assert nft(store)['owner'] == B
    assert nft(store)['seller'] == B and nft(store)['price_wei'] == '100'
    assert nft(store)['level'] == '90'


def test_sepolia_does_not_fall_back_to_latest_when_finality_is_unavailable(tmp_path):
    source = RpcSource(ChainSettings('sepolia', tmp_path, 'https://example.invalid'))
    get_block = Mock(side_effect=RuntimeError('finalized unsupported'))
    source.w3 = SimpleNamespace(eth=SimpleNamespace(block_number=50, get_block=get_block))
    with pytest.raises(RuntimeError): source.boundary()
    get_block.assert_called_once_with('finalized')


def test_rpc_decodes_real_web3_hexbytes_topics_and_preserves_uint256(tmp_path):
    abi = [{'type':'event','name':'Transfer','anonymous':False,'inputs':[
        {'name':'from','type':'address','indexed':True}, {'name':'to','type':'address','indexed':True},
        {'name':'tokenId','type':'uint256','indexed':True}]}]
    signature = Web3.keccak(text='Transfer(address,address,uint256)')
    source = RpcSource(ChainSettings('local', tmp_path, 'http://127.0.0.1:1'))
    source.info = {'address': A}; source.topics = [Web3.to_hex(signature)]
    source.contract = Web3().eth.contract(address=A, abi=abi)
    log = {'address': A, 'blockNumber': 2, 'blockHash': HexBytes('0x'+'55'*32), 'transactionIndex':0,
           'transactionHash': HexBytes('0x'+'66'*32), 'logIndex':0, 'data': HexBytes('0x'),
           'topics':[signature, HexBytes('0x'+'00'*12+'11'*20), HexBytes('0x'+'00'*12+'22'*20), HexBytes(int(TOKEN).to_bytes(32,'big'))]}
    source.w3 = SimpleNamespace(eth=SimpleNamespace(get_logs=Mock(return_value=[log])))
    decoded = source.logs(1, 3)
    assert decoded[0]['args']['tokenId'] == TOKEN
    assert decoded[0]['args']['to'] == B
    log['address'] = B
    with pytest.raises(IndexFailure): source.logs(1, 3)


def test_api_status_history_pagination_and_legacy_save_migration(setup):
    store, source, indexer = setup
    with store.connection() as db:
        db.execute('INSERT INTO players(address,coins) VALUES(?,123)', (A,))
    catch_up(indexer)
    client = TestClient(create_app(store.path))
    assert client.get('/api/health').json() == {'ok': True}
    assert client.get('/api/chain/status').json()['eventCount'] == 3
    page = client.get('/api/chain/events?limit=1').json()
    assert len(page['items']) == 1 and page['items'][0]['name'] == 'Listed'
    assert client.get('/api/chain/events?limit=101').status_code == 422
    assert client.get('/api/chain/indexed-nfts').json()['items'][0]['token_id'] == TOKEN
    with Store(store.path).connection() as db:
        assert db.execute('SELECT coins FROM players WHERE address=?', (A,)).fetchone()[0] == 123
        assert db.execute('SELECT COUNT(*) FROM schema_migrations').fetchone()[0] == 1
