"""Public artwork URLs retain the individual weapon's immutable metadata."""
import base64
import json
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from chain.server.nft import metadata
from backend.game import BALANCE, SWORD_BRANCHES, weapon_tier, weapon_mint_level


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / 'assets/NFT_Pic/manifest.json').read_text())
FILES = {'longsword': 'sword.png', 'rapier': 'Rapier.png', 'greatsword': 'GS.png'}


def decode(uri):
    prefix, payload = uri.split(',', 1)
    assert prefix == 'data:application/json;base64'
    return json.loads(base64.b64decode(payload))


def test_public_manifest_is_complete_pinned_and_has_no_credentials():
    assert set(MANIFEST['images']) == {route['id'] for route in SWORD_BRANCHES}
    assert len(MANIFEST['commit']) == 40
    int(MANIFEST['commit'], 16)
    for branch, filename in FILES.items():
        url = urlsplit(MANIFEST['images'][branch])
        assert url.scheme == 'https'
        assert url.netloc == 'raw.githubusercontent.com'
        assert url.path == f"/{MANIFEST['repository']}/{MANIFEST['commit']}/Image_Dapp/{filename}"
        assert not (url.username or url.password or url.query or url.fragment)
        assert (ROOT / 'assets/NFT_Pic' / filename).is_file()


@pytest.mark.parametrize('route', SWORD_BRANCHES, ids=lambda route: route['id'])
@pytest.mark.parametrize('demo', [0, 1])
def test_each_mintable_level_uses_branch_art_and_preserves_its_attributes(route, demo):
    branch = route['id']
    for level in range(weapon_mint_level(branch), route['max_level'] + 1):
        weapon = {'branch': branch, 'level': level, 'demo': demo}
        data = decode(metadata(weapon))
        tier = weapon_tier(level, branch)
        prefix = '[DEMO] ' if demo else ''
        assert data['image'] == MANIFEST['images'][branch]
        assert data['name'] == f"{prefix}{tier['name']} +{level}"
        assert data['name_en'] == f"{prefix}{tier['name_en']} +{level}"
        assert data['tier_id'] == tier['id']
        assert data['attributes'] == [
            {'trait_type': 'Level', 'value': level},
            {'trait_type': 'Demo', 'value': bool(demo)},
            {'trait_type': 'Weapon Type', 'value': branch},
        ]
        assert weapon == {'branch': branch, 'level': level, 'demo': demo}


def test_legacy_weapon_without_branch_uses_longsword_art():
    data = decode(metadata({'level': 50, 'demo': 0}))
    assert data['image'] == MANIFEST['images']['longsword']
    assert {'trait_type': 'Weapon Type', 'value': 'longsword'} in data['attributes']


def test_unknown_branch_cannot_silently_mint_the_wrong_art():
    with pytest.raises(KeyError):
        metadata({'branch': 'unknown', 'level': 50, 'demo': 0})
