import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from web3.exceptions import TransactionNotFound

from backend.app import Store, create_app
from backend.chain import ChainReader, ChainSettings

ADDRESS = '0x' + '11' * 20
AUTHORITY = '0x' + '22' * 20
EPOCH = '0x' + '33' * 32
TX = '0x' + '44' * 32


def test_network_defaults_and_separate_sepolia_storage(monkeypatch):
    monkeypatch.delenv('FORGE_LOCAL_DIR')
    local = ChainSettings.from_env()
    monkeypatch.setenv('FORGE_NETWORK', 'sepolia')
    remote = ChainSettings.from_env()
    assert local.directory != remote.directory
    assert remote.directory == local.directory / 'sepolia'
    assert remote.rpc == ''  # Never inherit LOCAL_RPC_URL for a public chain.
    monkeypatch.setenv('FORGE_LOCAL_DIR', str(local.directory))
    with pytest.raises(ValueError):
        ChainSettings.from_env()


def test_unknown_network_is_rejected(monkeypatch):
    monkeypatch.setenv('FORGE_NETWORK', 'mainnet')
    with pytest.raises(ValueError):
        ChainSettings.from_env()


def test_network_mismatch_does_not_change_saved_progress(tmp_path):
    file = tmp_path / 'game.sqlite3'
    store = Store(file)
    with store.connection() as db:
        db.execute('INSERT INTO players(address,coins,materials) VALUES(?,12345,99)', (ADDRESS,))
    with pytest.raises(ValueError):
        Store(file, network='sepolia')
    with Store(file).connection() as db:
        assert tuple(db.execute('SELECT coins,materials FROM players').fetchone()) == (12345, 99)
        assert db.execute('SELECT network FROM runtime_environment').fetchone()[0] == 'local'


def test_sepolia_config_is_public_and_no_automatic_deployment(tmp_path, monkeypatch):
    monkeypatch.setenv('FORGE_NETWORK', 'sepolia')
    monkeypatch.setenv('FORGE_LOCAL_DIR', str(tmp_path))
    monkeypatch.setenv('FORGE_RPC_URL', 'https://example.invalid/secret-credential')
    client = TestClient(create_app())
    response = client.get('/api/config')
    assert response.status_code == 200
    config = response.json()
    assert config['network']['chainId'] == 11155111
    assert config['network']['rpcUrls'] == []
    assert config['chain'] is None
    assert 'secret-credential' not in response.text
    assert not (tmp_path / 'deployment.json').exists()
    assert not (tmp_path / 'mint-key').exists()
    assert client.get('/api/health').json() == {'ok': True}


@pytest.fixture
def reader(tmp_path):
    info = {'address': ADDRESS, 'chainId': 31337, 'deploymentId': EPOCH, 'mintSigner': AUTHORITY, 'abi': []}
    settings = ChainSettings('local', tmp_path, 'https://example.invalid/credential')
    result = ChainReader(settings)
    return result, info


def test_missing_deployment_and_invalid_receipt_need_no_rpc(reader):
    result, _ = reader
    with pytest.raises(HTTPException) as error:
        result.connect()
    assert error.value.status_code == 503
    with pytest.raises(HTTPException) as error:
        result.receipt('bad hash')
    assert error.value.status_code == 400


@pytest.mark.parametrize('change', ['network', 'empty_code', 'epoch', 'authority', 'rpc_failure'])
def test_wrong_chain_or_contract_fails_closed_without_leaking_rpc(reader, monkeypatch, change):
    result, info = reader
    (result.settings.directory / 'deployment.json').write_text(json.dumps(info))
    contract = Mock()
    contract.functions.deploymentId.return_value.call.return_value = bytes.fromhex('33' * 32)
    contract.functions.mintSigner.return_value.call.return_value = AUTHORITY
    eth = SimpleNamespace(chain_id=31337, contract=Mock(return_value=contract), get_code=Mock(return_value=b'code'))
    if change == 'network': eth.chain_id = 11155111
    if change == 'empty_code': eth.get_code.return_value = b''
    if change == 'epoch': contract.functions.deploymentId.return_value.call.return_value = bytes(32)
    if change == 'authority': contract.functions.mintSigner.return_value.call.return_value = ADDRESS
    if change == 'rpc_failure': eth.get_code.side_effect = ValueError('https://example.invalid/credential')
    import backend.chain as module
    factory = Mock(return_value=SimpleNamespace(eth=eth))
    factory.HTTPProvider = Mock()
    factory.to_hex = lambda value: '0x' + value.hex()
    monkeypatch.setattr(module, 'Web3', factory)
    with pytest.raises(HTTPException) as error:
        result.connect()
    assert error.value.status_code == 503
    assert 'credential' not in error.value.detail


def test_nft_snapshot_pins_block_and_keeps_large_numbers_as_strings(reader):
    result, info = reader
    token = 2**255 + 1
    price = 10**20 + 1
    contract = Mock()
    contract.functions.allTokens.return_value.call.return_value = [token, token + 1]
    contract.functions.listings.return_value.call.return_value = (ADDRESS, price)
    contract.functions.ownerOf.return_value.call.return_value = ADDRESS
    contract.functions.levels.return_value.call.return_value = 50
    contract.functions.tokenURI.return_value.call.return_value = 'data:application/json;base64,e30='
    contract.functions.proceeds.return_value.call.return_value = price
    result.connect = Mock(return_value=(info, SimpleNamespace(eth=SimpleNamespace(block_number=123)), contract))
    data = result.nfts(ADDRESS, offset=1, limit=1)
    assert data['total'] == 2 and len(data['items']) == 1
    assert data['items'][0]['id'] == str(token + 1)
    assert data['items'][0]['price'] == data['proceeds'] == str(price)
    for method in ['allTokens', 'listings', 'ownerOf', 'levels', 'tokenURI', 'proceeds']:
        getattr(contract.functions, method).return_value.call.assert_called_once_with(block_identifier=123)


def test_pending_receipt_and_foreign_contract(reader):
    result, info = reader
    eth = Mock()
    result.connect = Mock(return_value=(info, SimpleNamespace(eth=eth), Mock()))
    eth.get_transaction_receipt.side_effect = TransactionNotFound('not found')
    assert result.receipt(TX)['receipt'] is None
    eth.get_transaction_receipt.side_effect = None
    eth.get_transaction_receipt.return_value = {'to': AUTHORITY, 'status': 1, 'blockNumber': 20}
    with pytest.raises(HTTPException) as error:
        result.receipt(TX)
    assert error.value.status_code == 400
    eth.get_transaction_receipt.return_value['to'] = ADDRESS
    assert result.receipt(TX)['receipt']['status'] == 1


@pytest.mark.parametrize('query', ['offset=-1', 'limit=101', 'limit=0', 'block=-1'])
def test_nft_query_limits(tmp_path, query):
    client = TestClient(create_app(tmp_path / 'game.sqlite3'))
    assert client.get('/api/chain/nfts?' + query).status_code == 422


def test_old_tab_cannot_spend_from_the_new_cookie_account(tmp_path):
    client = TestClient(create_app(tmp_path / 'game.sqlite3'))
    first = client.post('/api/account/register', json={'username': 'first_user', 'password': 'test-password-123'}).json()
    client.post('/api/account/logout')
    second = client.post('/api/account/register', json={'username': 'second_user', 'password': 'test-password-123'}).json()
    headers = {'X-Forge-Player': first['address'], 'Idempotency-Key': 'old-tab-action'}
    assert client.post('/api/claim', headers=headers).status_code == 409
    with client.app.state.store.connection() as db:
        assert all(row['materials'] == 0 for row in db.execute('SELECT materials FROM players'))
    headers['X-Forge-Player'] = second['address']
    assert client.post('/api/claim', headers=headers).status_code == 200


def test_only_credential_free_loopback_rpc_is_disclosed_to_local_wallet(tmp_path):
    assert ChainSettings('local', tmp_path, 'http://127.0.0.1:12345').public()['rpcUrls'] == ['http://127.0.0.1:12345']
    for url in ['https://example.com/private-key', 'http://127.0.0.1:12345/?key=secret', 'http://user:secret@localhost:12345', 'http://localhost:12345/secret']:
        assert ChainSettings('local', tmp_path, url).public()['rpcUrls'] == []
    assert ChainSettings('sepolia', tmp_path, 'https://example.com/private-key').public()['rpcUrls'] == []
