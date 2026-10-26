"""Official bilingual names match the supplied naming sheets at every stage."""
import base64
import json

import pytest

from backend.app import metadata
from backend.game import SWORD_BRANCHES, SWORD_CATALOG, weapon_name, weapon_tier
from backend.tests.test_game import client, login, forge, weapon


OFFICIAL_NAMES = [
    ('longsword', 0, '余烬长剑', 'Ember Longsword'),
    ('longsword', 10, '精铁骑士剑', "Knight's Iron Sword"),
    ('longsword', 20, '银誓长剑', 'Silver Oath'),
    ('longsword', 30, '王国卫剑', 'Kingdom Guardian'),
    ('longsword', 40, '荣耀骑士剑', 'Blade of Valor'),
    ('longsword', 50, '王庭圣剑', 'Royal Court Blade'),
    ('longsword', 60, '王庭誓约', 'Royal Oathblade'),
    ('longsword', 70, '黄金誓约', 'Golden Oath'),
    ('longsword', 80, '最后的黎明', 'The Last Dawn'),
    ('rapier', 5, '精铁刺剑', 'Iron Rapier'),
    ('rapier', 10, '银锋刺剑', 'Silverthorn'),
    ('rapier', 20, '宫廷细剑', 'Courtly Rapier'),
    ('rapier', 30, '鸢尾刺剑', 'Fleur-de-Lis'),
    ('rapier', 40, '王室誓剑', 'Royal Vow'),
    ('rapier', 50, '绯冠刺剑', 'Crimson Crown'),
    ('rapier', 60, '赤蔷誓约', 'Scarlet Oath'),
    ('rapier', 70, '炽翼天使', "Seraph's Wing"),
    ('greatsword', 10, '铁匠大剑', "Blacksmith's Greatsword"),
    ('greatsword', 20, '烬炉大剑', 'Emberforged Greatsword'),
    ('greatsword', 30, '渊角龙骸', 'Abyssal Dragonbone'),
    ('greatsword', 40, '熔脉龙骸', 'Moltenvein Dragonbone'),
    ('greatsword', 50, '深渊炉心', 'Abyssal Furnace'),
    ('greatsword', 60, '余烬君王', 'Sovereign of Ash'),
]


@pytest.mark.parametrize('branch,level,zh,en', OFFICIAL_NAMES)
def test_official_name_pair_and_new_metadata(branch, level, zh, en):
    assert weapon_name(level, branch) == zh
    assert weapon_name(level, branch, 'en') == en
    assert weapon_name(level, branch, 'zh') == zh
    for demo in [0, 1]:
        data = json.loads(base64.b64decode(metadata({'level': level, 'branch': branch, 'demo': demo}).split(',')[1]))
        prefix = '[DEMO] ' if demo else ''
        assert data['name'] == f'{prefix}{zh} +{level}'
        assert data['name_en'] == f'{prefix}{en} +{level}'
        assert data['tier_id'] == weapon_tier(level, branch)['id']


def test_state_exposes_both_names_without_changing_weapon_progress(client):
    h, *_ = login(client)
    wid = forge(client, h)
    before = weapon(client, h)
    for branch, level, zh, en in OFFICIAL_NAMES:
        with client.app.state.store.connection() as db:
            db.execute('UPDATE weapons SET branch=?,level=? WHERE id=?', (branch, level, wid))
        current = weapon(client, h)
        assert (current['name'], current['name_en']) == (zh, en)
        assert current['tier_id'] == weapon_tier(level, branch)['id']
        for key in ['id', 'owner', 'status', 'strikes', 'protected_left', 'demo', 'quality', 'source', 'heat_ready_at', 'heat_charges']:
            assert current[key] == before[key]


def test_both_languages_follow_same_fallbacks_and_final_stages():
    assert len(SWORD_CATALOG) == len(OFFICIAL_NAMES)
    for route in SWORD_BRANCHES:
        branch = route['id']
        for level in range(route['max_level'] + 1):
            tier = weapon_tier(level, branch)
            assert weapon_name(level, branch) == tier['name']
            assert weapon_name(level, branch, 'en') == tier['name_en']
        if branch != 'longsword':
            for level in range(route['unlock_level']):
                assert weapon_name(level, branch, 'en') == 'Ember Longsword'
    assert weapon_name(60, 'greatsword', 'en') == 'Sovereign of Ash'
    assert weapon_name(80, 'rapier', 'en') == "Seraph's Wing"
