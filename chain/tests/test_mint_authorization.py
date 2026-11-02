from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from fastapi import HTTPException

from chain.server.nft import TYPES, mint_authorization


@pytest.fixture
def mint_setup(tmp_path):
    signer, recipient = Account.create(), Account.create().address
    (tmp_path / 'mint-key').write_text(signer.key.hex())
    info = {'mintSigner': signer.address, 'chainId': 11155111, 'address': Account.create().address,
            'deploymentId': '0x'+'aa'*32}
    contract = Mock()
    contract.functions.exists.return_value.call.return_value = False
    weapon = {'id': '0x'+'bb'*32, 'level': 80, 'branch': 'longsword', 'demo': 0}
    return SimpleNamespace(directory=tmp_path), info, contract, weapon, recipient


def test_authorization_is_for_the_fixed_wallet_snapshot_and_expires_in_ten_minutes(mint_setup, monkeypatch):
    settings, info, _, weapon, recipient = mint_setup
    monkeypatch.setattr('chain.server.nft.time.time', lambda: 1000000)
    signed = mint_authorization(*mint_setup)
    voucher = signed['voucher']
    assert voucher['recipient'] == recipient
    assert voucher['weaponId'] == weapon['id'] and voucher['level'] == weapon['level']
    assert voucher['deadline'] == 1000600 and voucher['deploymentId'] == info['deploymentId']
    domain = {'name': 'ForgeOfFate', 'version': '1', 'chainId': info['chainId'], 'verifyingContract': info['address']}
    assert Account.recover_message(encode_typed_data(domain, TYPES, voucher), signature=signed['signature']) == info['mintSigner']
    assert 'mint-key' not in str(signed)


@pytest.mark.parametrize('failure,code', [('already_minted',409),('rpc',503),('missing_key',503),('wrong_key',503),('invalid_key',503)])
def test_mint_authorization_fails_closed_without_replacing_keys(mint_setup, failure, code):
    settings, _, contract, _, _ = mint_setup
    keyfile = settings.directory / 'mint-key'
    if failure == 'already_minted': contract.functions.exists.return_value.call.return_value = True
    if failure == 'rpc': contract.functions.exists.return_value.call.side_effect = RuntimeError('private-rpc-secret')
    if failure == 'missing_key': keyfile.unlink()
    if failure == 'wrong_key': keyfile.write_text(Account.create().key.hex())
    if failure == 'invalid_key': keyfile.write_text('invalid-private-secret')
    before = keyfile.read_bytes() if keyfile.exists() else None
    with pytest.raises(HTTPException) as error: mint_authorization(*mint_setup)
    assert error.value.status_code == code and 'secret' not in error.value.detail
    assert (keyfile.read_bytes() if keyfile.exists() else None) == before


@pytest.mark.parametrize('branch,level', [('longsword',79),('rapier',69),('greatsword',59),('longsword',91),('rapier',81),('greatsword',71),('unknown',80)])
def test_signer_itself_rejects_ineligible_weapons_before_rpc_or_signing(mint_setup, branch, level):
    _, _, contract, weapon, _ = mint_setup
    weapon.update(branch=branch,level=level)
    with pytest.raises(HTTPException) as error:
        mint_authorization(*mint_setup)
    assert error.value.status_code==409
    contract.functions.exists.assert_not_called()
