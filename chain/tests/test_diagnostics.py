import json
from unittest.mock import Mock

import pytest
from eth_account import Account
from fastapi.testclient import TestClient
from web3 import Web3

from backend.app import create_app
from backend.storage import Store
from chain.server.diagnostics import inspect_chain
from chain.server.rpc import ChainSettings

ADDRESS = '0x' + '11' * 20
EPOCH = '0x' + '22' * 32
TX = '0x' + '33' * 32
BLOCK_HASH = bytes.fromhex('44' * 32)
GENESIS = bytes.fromhex('55' * 32)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    signer = Account.create()
    (tmp_path / 'mint-key').write_text(signer.key.hex())
    code = b'contract-code'
    info = dict(manifestVersion=2, address=ADDRESS, abi=[], chainId=11155111, deploymentId=EPOCH,
                mintSigner=signer.address, deploymentTransaction=TX, deploymentBlock=100,
                deploymentBlockHash=Web3.to_hex(BLOCK_HASH), genesisHash=Web3.to_hex(GENESIS),
                runtimeCodeHash=Web3.to_hex(Web3.keccak(code)))
    (tmp_path / 'deployment.json').write_text(json.dumps(info))
    w3 = Mock()
    w3.eth.chain_id = 11155111
    w3.eth.block_number = 150
    w3.eth.get_block.side_effect = lambda block: {'number': 120 if block == 'finalized' else block,
                                               'hash': GENESIS if block == 0 else BLOCK_HASH}
    w3.eth.get_code.return_value = code
    w3.eth.get_transaction_receipt.return_value = dict(status=1, contractAddress=ADDRESS, blockNumber=100, blockHash=BLOCK_HASH)
    functions = w3.eth.contract.return_value.functions
    functions.deploymentId.return_value.call.return_value = bytes.fromhex(EPOCH[2:])
    functions.mintSigner.return_value.call.return_value = signer.address
    factory = Mock(return_value=w3, to_hex=Web3.to_hex, keccak=Web3.keccak, to_checksum_address=Web3.to_checksum_address)
    monkeypatch.setattr('chain.server.diagnostics.Web3', factory)
    settings = ChainSettings('sepolia', tmp_path, 'https://provider.invalid/private-credential')
    store = Store(tmp_path / 'game.sqlite3', network='sepolia')
    return settings, store, w3, info


def test_verified_contract_is_read_only_and_does_not_expose_secrets(setup):
    settings, store, _, _ = setup
    before = {p.name: p.read_bytes() for p in settings.directory.glob('*.json')}
    key = (settings.directory / 'mint-key').read_text()
    result = inspect_chain(settings, store)
    assert result['network']['status'] == 'ok'
    assert result['contracts'][0]['status'] == 'ok'
    assert [c['status'] for c in result['contracts'][1:]] == ['disabled', 'disabled']
    assert result['indexer']['state'] == 'not_started'
    assert all(s not in json.dumps(result) for s in [settings.rpc, 'private-credential', key])
    assert before == {p.name: p.read_bytes() for p in settings.directory.glob('*.json')}
    assert (settings.directory / 'mint-key').read_text() == key


@pytest.mark.parametrize('failure', ['wrong_network', 'offline', 'no_finality', 'no_code', 'wrong_code', 'wrong_signer', 'wrong_epoch', 'bad_receipt'])
def test_failures_cannot_be_reported_as_healthy(setup, failure):
    settings, store, w3, _ = setup
    if failure == 'wrong_network': w3.eth.chain_id = 1
    elif failure == 'offline': w3.eth.get_block.side_effect = RuntimeError(settings.rpc)
    elif failure == 'no_finality':
        original = w3.eth.get_block.side_effect
        def blocks(block):
            if block == 'finalized': raise RuntimeError(settings.rpc)
            return original(block)
        w3.eth.get_block.side_effect = blocks
    elif failure == 'no_code': w3.eth.get_code.return_value = b''
    elif failure == 'wrong_code': w3.eth.get_code.return_value = b'other-code'
    elif failure == 'wrong_signer': w3.eth.contract.return_value.functions.mintSigner.return_value.call.return_value = ADDRESS
    elif failure == 'wrong_epoch': w3.eth.contract.return_value.functions.deploymentId.return_value.call.return_value = bytes(32)
    else: w3.eth.get_transaction_receipt.return_value['contractAddress'] = '0x' + '99' * 20
    result = inspect_chain(settings, store)
    assert result['contracts'][0]['status'] != 'ok'
    assert settings.rpc not in json.dumps(result)
    if failure == 'wrong_network': w3.eth.get_code.assert_not_called()


@pytest.mark.parametrize('kind', ['missing', 'wrong', 'invalid'])
def test_mint_key_problem_does_not_replace_key_or_hide_public_contract(setup, kind):
    settings, store, _, _ = setup
    key = settings.directory / 'mint-key'
    if kind == 'missing': key.unlink()
    elif kind == 'wrong': key.write_text(Account.create().key.hex())
    else: key.write_text('invalid-secret')
    before = key.read_bytes() if key.exists() else None
    nft = inspect_chain(settings, store)['contracts'][0]
    assert nft['address'] == ADDRESS
    assert nft['status'] == ('waiting' if kind == 'missing' else 'error')
    assert nft['mintMessage']
    assert (key.read_bytes() if key.exists() else None) == before
    assert 'invalid-secret' not in json.dumps(nft)


def test_console_pending_is_not_a_verified_contract_and_detects_handoff_wait(setup):
    settings, store, _, _ = setup
    (settings.directory / 'deployment.json').unlink()
    directory = settings.directory / 'deploy-console' / 'forge-of-fate'
    directory.mkdir(parents=True)
    (directory / 'plan.json').write_text(json.dumps({'deploymentId': EPOCH, 'network': {'chainId': 11155111}}))
    state = dict(deploymentId=EPOCH, phase='confirming', transactionHash=TX, deploymentBlock=130)
    (directory / 'state.json').write_text(json.dumps(state))
    result = inspect_chain(settings, store)['contracts'][0]
    assert result['status'] == 'waiting' and result['address'] is None
    assert '等待最终确认' in result['message']
    state['deploymentBlock'] = 100
    (directory / 'state.json').write_text(json.dumps(state))
    assert '尚未交接' in inspect_chain(settings, store)['contracts'][0]['message']
    assert not (settings.directory / 'deployment.json').exists()


def test_listener_for_another_deployment_is_identified(setup):
    settings, store, _, info = setup
    with store.connection() as db:
        db.execute('INSERT INTO chain_environment VALUES(1,?,?)', ('other', json.dumps({**info, 'deploymentId': 'other'})))
        db.execute("INSERT INTO chain_scan(id,scanned_block,scanned_hash,processed_block,state,message) VALUES(1,99,'hash',99,'halted',?)", (settings.rpc,))
    result = inspect_chain(settings, store)
    assert result['indexer']['deploymentMatches'] is False
    assert settings.rpc not in json.dumps(result)


@pytest.mark.parametrize('demo,role,logged_in,code', [(False, 'tester', True, 404), (True, 'player', True, 403),
    (True, 'tester', False, 401), (True, 'tester', True, 200)])
def test_endpoint_enforces_mode_and_account_before_any_rpc(tmp_path, monkeypatch, demo, role, logged_in, code):
    app = create_app(tmp_path / 'auth.sqlite3', demo=demo)
    client = TestClient(app)
    if logged_in:
        registration = client.post('/api/account/register', json={'username':'diagnostic_user','password':'test-password-2026'})
        assert registration.status_code == 200
        account = registration.json()
        with app.state.store.connection() as db:
            db.execute('UPDATE accounts SET role=? WHERE game_address=?', (role, account['address']))
    inspect = Mock(return_value={'checkedAt': 1})
    monkeypatch.setattr('backend.app.inspect_chain', inspect)
    response = client.get('/api/chain/diagnostics')
    assert response.status_code == code
    assert inspect.call_count == (1 if code == 200 else 0)
    if code == 200: assert response.headers['cache-control'] == 'no-store'


@pytest.mark.parametrize('state,age,expected',[('ready',0,'ok'),('ready',300,'waiting'),('syncing',0,'waiting'),('error',0,'error'),('halted',0,'error')])
def test_staking_diagnostics_uses_verified_contract_and_fresh_listener(setup,monkeypatch,state,age,expected):
    import time
    from backend.staking_rewards import register_source
    from chain.server.diagnostics import inspect_staking
    settings,store,_,_=setup
    (settings.directory/'staking-deployment.json').write_text('{}')
    fake=Mock()
    fake.open.return_value=dict(address=ADDRESS,chainId=11155111,deploymentId=EPOCH,deploymentTransaction=TX,deploymentBlock=100)
    fake.boundary.return_value=(150,120)
    monkeypatch.setattr('chain.server.staking_indexer.RpcStakingSource',Mock(return_value=fake))
    with store.connection() as db:
        source=register_source(db,chain_id=11155111,contract=ADDRESS,deployment=EPOCH,start_block=99,start_hash=Web3.to_hex(BLOCK_HASH),start_time=100,daily_coins=100)
        db.execute('INSERT INTO staking_listener VALUES(1,?,?,?,\'\',?)',('fingerprint',source,state,int(time.time())-age))
    result=inspect_staking(settings,store)
    assert result['status']==expected
    assert result['address']==ADDRESS


def test_staking_diagnostics_redacts_provider_failure(setup,monkeypatch):
    from chain.server.diagnostics import inspect_staking
    settings,store,_,_=setup
    (settings.directory/'staking-deployment.json').write_text('{}')
    fake=Mock();fake.open.side_effect=RuntimeError(settings.rpc)
    monkeypatch.setattr('chain.server.staking_indexer.RpcStakingSource',Mock(return_value=fake))
    result=inspect_staking(settings,store)
    assert result['status']=='error' and settings.rpc not in json.dumps(result)
