"""Appearance transitions must follow authoritative levels, including downgrades."""
import base64
import json
from pathlib import Path

import pytest
from backend.game import BALANCE, SWORD_CATALOG, SWORD_TIERS, probabilities, strike, weapon_name, weapon_tier
from backend.app import metadata

@pytest.mark.parametrize('level,model', [
    (0,'sword'),(2,'sword'),(3,'sword-upgraded'),(9,'sword-upgraded'),
    (10,'nobel+knight+sword+3d+model'),(24,'nobel+knight+sword+3d+model'),
    (25,'fantasy+sword+3d+model'),(49,'fantasy+sword+3d+model'),
    (50,'top+fantasy+sword+model'),(100,'top+fantasy+sword+model')])
def test_appearance_boundaries(level, model):
    assert weapon_tier(level)['model'] == model

@pytest.mark.parametrize('tier', [tier for tier in SWORD_CATALOG if tier['min_level'] > 0])
def test_strike_crosses_tiers_in_both_directions(tier):
    boundary=tier['min_level']
    branch=tier['branch']
    weapon={'level':boundary-1,'protected_left':0,'strikes':0}
    assert weapon_tier(strike(weapon,0,False)['level'],branch) == tier
    weapon['level']=boundary-2
    p=probabilities(weapon['level'])
    assert weapon_tier(strike(weapon,p['up']+p['double']/2,False)['level'],branch) == tier
    weapon['level']=boundary
    p=probabilities(boundary)
    lower=strike(weapon,p['up']+p['double']+p['down']/2,False)
    assert weapon_tier(lower['level'],branch) != tier


def test_catalog_assets_and_mint_metadata():
    levels=[t['min_level'] for t in SWORD_TIERS]
    assert levels[0]==0 and levels==sorted(set(levels))
    for tier in SWORD_CATALOG:
        asset=Path(__file__).resolve().parents[2]/'assets/3d'/f"{tier['model']}.glb"
        assert asset.read_bytes()[:4]==b'glTF'
    level=BALANCE['mint_level']
    uri=metadata({'level':level,'demo':0})
    data=json.loads(base64.b64decode(uri.split(',')[1]))
    assert weapon_name(level) in data['name']
