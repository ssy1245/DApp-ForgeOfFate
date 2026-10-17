"""Pure game rules. All balance values are provisional and centrally configured."""
import json
from pathlib import Path

BALANCE = json.loads(Path(__file__).with_name('balance.json').read_text())

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
    level = max(0, min(level, BALANCE['max_level']))
    count, left = weapon['strikes'], weapon['protected_left']
    if stage:
        left -= 1
    elif result != 'destroy':
        count += 1
        if count >= BALANCE['protection_trigger']:
            count = 0
            left = BALANCE['protection_duration']
    return {'level': level, 'strikes': count, 'protected_left': left,
            'status': 'destroyed' if result == 'destroy' else 'active',
            'result': result, 'shield_used': bool(shield and not stage)}

def recycle_price(level):
    return BALANCE['recycle_base'] + level * BALANCE['recycle_per_level']


def weapon_name(level):
    return "淬火长剑" if level >= BALANCE["visual_upgrade_level"] else "余烬长剑"
