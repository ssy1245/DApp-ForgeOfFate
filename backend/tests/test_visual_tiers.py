"""Appearance transitions must follow authoritative levels, including downgrades."""
import base64
import json
from pathlib import Path

import pytest
from backend.game import BALANCE, SWORD_CATALOG, SWORD_TIERS, probabilities, strike, weapon_name, weapon_tier
from backend.app import metadata

@pytest.mark.parametrize('level,model', [
    (0,'sword'),(3,'sword'),(9,'sword'),
    (10,'knight sword/l0-sword-upgraded'),(19,'knight sword/l0-sword-upgraded'),
    (20,'knight sword/l1-nobel+knight+sword+3d+model'),(29,'knight sword/l1-nobel+knight+sword+3d+model'),
    (30,'knight sword/l2-fantasy+sword+3d+model'),(39,'knight sword/l2-fantasy+sword+3d+model'),
    (40,'knight sword/l3-fantasy+sword+model'),(49,'knight sword/l3-fantasy+sword+model'),
    (50,'knight sword/best+fantasy+sword+3d+model'),(100,'knight sword/best+fantasy+sword+3d+model')])
def test_appearance_boundaries(level, model):
    assert weapon_tier(level)['model'] == model


@pytest.mark.parametrize('branch,nodes',[
    ('longsword',[0,10,20,30,40,50]),
    ('rapier',[0,5,10,20,30,40,50])])
def test_route_nodes_and_final_appearance(branch,nodes):
    assert sorted({weapon_tier(level,branch)['min_level'] for level in range(51)}) == nodes
    final=weapon_tier(50,branch)
    for level in range(51,BALANCE['max_level']+1):
        assert weapon_tier(level,branch) == final

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


def test_every_supplied_sword_is_connected():
    assets=Path(__file__).resolve().parents[2]/'assets/3d'
    supplied={path.relative_to(assets).as_posix() for path in assets.rglob('*.glb')} - {'hammer.glb','anvil.glb'}
    configured={f"{tier['model']}.glb" for tier in SWORD_CATALOG}
    assert configured==supplied
    assert all(tier.get('model_status')!='placeholder' for tier in SWORD_CATALOG)
