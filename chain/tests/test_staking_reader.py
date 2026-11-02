"""Staking availability is based on ownership and listing state at one block."""
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from chain.server.staking_reader import StakingReader

WALLET = '0x' + '12' * 20
OTHER = '0x' + '34' * 20
STAKING = '0x' + '56' * 20
NFT = '0x' + '78' * 20
ZERO = '0x' + '00' * 20


@pytest.fixture
def reader(tmp_path):
    (tmp_path / 'deployment.json').write_text(json.dumps({'address': NFT, 'abi': []}))
    state = {'owners': {1: WALLET, 2: WALLET, 3: OTHER, 4: STAKING},
             'prices': {1: 10, 2: 0}, 'fail_listings': False}

    def query(name, *args):
        if name == 'allTokens':
            return list(state['owners'])
        if name == 'ownerOf':
            return state['owners'][args[0]]
        if name == 'listings':
            if state['fail_listings']:
                raise RuntimeError('private provider error')
            price = state['prices'][args[0]]
            return (WALLET if price else ZERO, price)
        if name == 'getApproved':
            return STAKING
        if name == 'activePosition':
            return 7
        if name == 'positions':
            return (WALLET, 4, 12345, 0)
        raise AssertionError(name)

    class Functions:
        def __getattr__(self, name):
            def method(*args):
                def call(*, block_identifier):
                    assert block_identifier == 100
                    return query(name, *args)
                return SimpleNamespace(call=call)
            return method

    contract = SimpleNamespace(functions=Functions())
    w3 = SimpleNamespace(eth=SimpleNamespace(block_number=100, contract=lambda **_: contract))
    instance = StakingReader(SimpleNamespace(directory=tmp_path))
    instance.connect = lambda: ({'address': STAKING, 'chainId': 31337, 'deploymentId': 'epoch'}, w3, contract)
    return instance, state


def test_listed_and_sold_nfts_are_excluded_without_hiding_active_positions(reader):
    instance, state = reader
    result = instance.holdings(WALLET)
    assert result['available'] == [{'tokenId': '2', 'approved': True}]
    assert result['positions'] == [{'positionId': '7', 'tokenId': '4', 'startedAt': 12345}]
    state['prices'][1] = 0
    assert [item['tokenId'] for item in instance.holdings(WALLET)['available']] == ['1', '2']
    state['owners'][2] = OTHER
    assert [item['tokenId'] for item in instance.holdings(WALLET)['available']] == ['1']


def test_unreadable_listing_does_not_present_the_nft_as_safe_to_stake(reader):
    instance, state = reader
    state['fail_listings'] = True
    with pytest.raises(HTTPException) as error:
        instance.holdings(WALLET)
    assert error.value.status_code == 503
    assert 'private' not in error.value.detail
