"""Pure game rules. All balance values are provisional and centrally configured."""
import json
from pathlib import Path

BALANCE = json.loads(Path(__file__).with_name('balance.json').read_text())
SWORD_CATALOG = json.loads((Path(__file__).resolve().parents[1] / 'assets/3d/sword-tiers.json').read_text())
SWORD_TIERS = [tier for tier in SWORD_CATALOG if tier.get('branch', 'longsword') == 'longsword']
BALANCE['visual_tiers'] = SWORD_TIERS
SWORD_BRANCHES = json.loads((Path(__file__).resolve().parents[1] / 'assets/3d/sword-branches.json').read_text())
BALANCE['sword_branches'] = SWORD_BRANCHES

def weapon_max_level(branch='longsword'):
    route=next((b for b in SWORD_BRANCHES if b['id']==branch),SWORD_BRANCHES[0])
    return min(BALANCE['max_level'],route['max_level'])

def probabilities(level, protected=False):
    destroy = min(BALANCE['destroy_base'] + level * BALANCE['destroy_per_level'], BALANCE['destroy_cap'])
    down = min(0.12 + level * 0.002, 0.22)
    double = 0.12
    return {'up': round(1 - destroy - down - double, 6), 'double': double,
            'down': round(down, 6), 'destroy': 0 if protected else round(destroy, 6),
            'saved': round(destroy, 6) if protected else 0}

def strike(weapon, roll, shield):
    stage = weapon['protected_left'] > 0
    protected = stage or shield
    probs = probabilities(weapon['level'], protected)
    edge = 0
    result = 'saved'
    for outcome, probability in probs.items():
        edge += probability
        if roll < edge:
            result = outcome
            break
    level = weapon['level']
    if result == 'up': level += 1
    elif result == 'double': level += 2
    elif result == 'down': level -= 1
    level = max(0, min(level, weapon_max_level(weapon.get('branch','longsword'))))
    count, left = weapon['strikes'], weapon['protected_left']
    if stage:
        left -= 1
    elif result != 'destroy':
        count += 1
        if count >= BALANCE['protection_trigger']:
            count = 0
            left = BALANCE['protection_duration']
    return {'level': level, 'strikes': count, 'protected_left': left,
            'branch':weapon.get('branch','longsword'),
            'status': 'destroyed' if result == 'destroy' else 'active',
            'result': result, 'shield_used': bool(shield and not stage)}

def recycle_price(level):
    return BALANCE['recycle_base'] + level * BALANCE['recycle_per_level']


def weapon_tier(level, branch='longsword'):
    route = next((b for b in SWORD_BRANCHES if b['id'] == branch), SWORD_BRANCHES[0])
    branch_tiers = route['tiers'] or [tier for tier in SWORD_CATALOG if tier.get('branch', 'longsword') == route['id']]
    tiers = [SWORD_TIERS[0], *branch_tiers] if route['id'] != 'longsword' else branch_tiers
    return next(tier for tier in reversed(tiers) if level >= tier['min_level'])


def weapon_name(level, branch='longsword', locale='zh'):
    tier = weapon_tier(level, branch)
    return tier['name_en'] if locale == 'en' else tier['name']
