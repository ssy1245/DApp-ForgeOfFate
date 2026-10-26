"""Route costs, actual payouts and permanent branch selection share server rules."""
from concurrent.futures import ThreadPoolExecutor
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.game import BALANCE, probabilities, recycle_price, strike_material_cost, weapon_route_tiers, weapon_max_level
from backend.tests.test_game import client, login, forge, post, weapon


@pytest.mark.parametrize('branch,level,cost', [
    ('longsword',0,2),('longsword',9,2),('longsword',10,4),('longsword',79,4),
    ('rapier',4,2),('rapier',5,3),('rapier',79,3),
    ('greatsword',9,2),('greatsword',10,7),('greatsword',59,7),
])
def test_basic_and_route_cost_boundaries(branch,level,cost):
    assert strike_material_cost(level,branch)==cost


@pytest.mark.parametrize('branch,cost', [('longsword',4),('rapier',3),('greatsword',7)])
@pytest.mark.parametrize('outcome', ['up','double','down','destroy','saved','stage'])
def test_each_outcome_charges_route_cost_once(client,monkeypatch,branch,cost,outcome):
    h,*_=login(client);wid=forge(client,h)
    protected=outcome=='stage'
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=20,heat_charges=5,heat_ready_at=0,protected_left=? WHERE id=?',(branch,int(protected),wid))
    before=client.get('/api/state',headers=h).json()
    assert before['weapons'][0]['strike_materials']==cost
    probs=probabilities(20)
    rolls={'up':0,'double':probs['up']+probs['double']/2,'down':probs['up']+probs['double']+probs['down']/2}
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:int(rolls.get(outcome,0.999999)*1_000_000))
    body={'expected_level':20,'expected_strikes':0,'expected_protected_left':int(protected),'shield':outcome=='saved','strike_materials':0}
    key=str(uuid.uuid4())
    response=post(client,f'/weapons/{wid}/strike',h,body,key)
    assert response.status_code==200
    assert response.json()['result']==('saved' if protected else outcome)
    assert post(client,f'/weapons/{wid}/strike',h,body,key).json()==response.json()
    after=client.get('/api/state',headers=h).json()['player']
    assert after['materials']==before['player']['materials']-cost
    assert 'ap' not in after
    assert after['shields']==before['player']['shields']-int(outcome=='saved')


@pytest.mark.parametrize('branch,cost', [('longsword',4),('rapier',3),('greatsword',7)])
def test_insufficient_iron_preserves_weapon_heat_and_all_resources(client,branch,cost):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=20,heat_charges=5,heat_ready_at=0 WHERE id=?',(branch,wid))
        db.execute('UPDATE players SET materials=?',(cost-1,))
    before=client.get('/api/state',headers=h).json()
    response=post(client,f'/weapons/{wid}/strike',h,{'expected_level':20,'expected_strikes':0,'expected_protected_left':0,'shield':True})
    assert response.status_code==409 and f'{cost} 铁块' in response.json()['detail']
    assert client.get('/api/state',headers=h).json()==before


@pytest.mark.parametrize('branch,level,price', [('greatsword',70,300000000),('greatsword',40,11000000),('greatsword',50,20000000),('greatsword',60,100000000),('greatsword',61,120000000),('greatsword',69,280000000),('longsword',70,30000000),('longsword',80,60000000),('longsword',71,33000000),('longsword',79,57000000),('longsword',81,64000000),('longsword',89,96000000),('longsword',90,100000000),('rapier',80,80000000),('rapier',71,30500000),('rapier',79,74500000)])
def test_displayed_and_credited_recycle_price_match(client,branch,level,price):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=? WHERE id=?',(branch,level,wid))
    before=client.get('/api/state',headers=h).json()
    assert before['weapons'][0]['recycle_price']==price==recycle_price(level,branch)
    key=str(uuid.uuid4())
    response=post(client,f'/weapons/{wid}/recycle',h,key=key)
    assert response.status_code==200
    assert post(client,f'/weapons/{wid}/recycle',h,key=key).json()==response.json()
    assert client.get('/api/state',headers=h).json()['player']['coins']==before['player']['coins']+price


@pytest.mark.parametrize('branch', ['longsword','greatsword','rapier'])
def test_every_reinforcement_level_increases_price_and_hits_configured_anchors(branch):
    assert recycle_price(0,branch)==1000
    limit=weapon_max_level(branch)
    prices=BALANCE['weapon_economy'][branch]['recycle_by_level']
    assert max(map(int,prices))==limit
    for level in range(1,limit+1):
        assert isinstance(recycle_price(level,branch),int)
        assert recycle_price(level,branch)>recycle_price(level-1,branch)
    for level,price in prices.items():
        assert recycle_price(int(level),branch)==price


def test_final_prices_and_late_greatsword_increases_reflect_route_identity():
    assert recycle_price(70,'greatsword')==3*recycle_price(90,'longsword')
    assert recycle_price(90,'longsword')>recycle_price(80,'rapier')==80000000
    assert recycle_price(70,'greatsword')-recycle_price(69,'greatsword')==20000000
    assert recycle_price(90,'longsword')-recycle_price(89,'longsword')==4000000


def test_greatsword_extra_ten_levels_halve_the_dragonbone_price_increments():
    assert recycle_price(30,'greatsword')==2000000
    assert recycle_price(40,'greatsword')==11000000
    assert recycle_price(50,'greatsword')==20000000
    for level in range(31,51):
        assert recycle_price(level,'greatsword')-recycle_price(level-1,'greatsword')==900000


@pytest.mark.parametrize('branch,unlock', [('greatsword',10),('rapier',5)])
def test_common_basic_sword_prices_match_before_branch_selection(branch,unlock):
    for level in range(unlock+1):
        assert recycle_price(level,branch)==recycle_price(level,'longsword')


def test_knight_curve_reaches_one_hundred_million_without_a_new_model():
    expected={0:1000,10:5000,20:20000,30:100000,40:500000,50:2000000,60:6000000,70:30000000,80:60000000,90:100000000}
    nodes=[tier['min_level'] for tier in weapon_route_tiers('longsword')]
    assert nodes==list(expected)[:-1]
    for level in range(91):
        if level in expected:
            assert recycle_price(level,'longsword')==expected[level]
        if level>0:
            assert recycle_price(level,'longsword')>recycle_price(level-1,'longsword')


def test_knight_config_interpolates_between_adjacent_anchors(monkeypatch):
    monkeypatch.setitem(BALANCE['weapon_economy']['longsword']['recycle_by_level'],'70',32000000)
    assert recycle_price(60,'longsword')==6000000
    assert recycle_price(69,'longsword')==29400000
    assert recycle_price(70,'longsword')==32000000
    assert recycle_price(79,'longsword')==57200000
    assert recycle_price(80,'longsword')==60000000
    assert recycle_price(90,'longsword')==100000000


def test_basic_sword_cannot_be_forged_from_bought_iron_for_free_profit():
    iron_cost=BALANCE['forge_materials']*BALANCE['material_pack_price']/BALANCE['material_pack_size']
    assert iron_cost>recycle_price(0)


def test_shop_sword_cannot_be_bought_and_recycled_for_free_profit(client):
    h,*_=login(client)
    initial=BALANCE['coin_sword_price']
    with client.app.state.store.connection() as db:
        db.execute('UPDATE players SET coins=?',(initial,))
    bought=post(client,'/shop/sword',h)
    assert bought.status_code==200
    wid=bought.json()['weapon_id']
    key=str(uuid.uuid4())
    sold=post(client,f'/weapons/{wid}/recycle',h,key=key)
    assert sold.status_code==200
    assert post(client,f'/weapons/{wid}/recycle',h,key=key).json()==sold.json()
    assert client.get('/api/state',headers=h).json()['player']['coins']==recycle_price(BALANCE['coin_sword_level'])<initial


@pytest.mark.parametrize('source,target', [('rapier','longsword'),('rapier','greatsword'),('greatsword','longsword'),('greatsword','rapier')])
@pytest.mark.parametrize('level', [0,20,60])
def test_selected_route_stays_locked_after_downgrades_and_restart(client,source,target,level):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=? WHERE id=?',(source,level,wid))
    restored=TestClient(create_app(client.app.state.store.path,demo=False))
    before=restored.get('/api/state',headers=h).json()
    assert before['weapons'][0]['branch_locked']
    response=post(restored,f'/weapons/{wid}/branch',h,{'branch':target})
    assert response.status_code==409 and '无法再更换' in response.json()['detail']
    assert restored.get('/api/state',headers=h).json()==before


def test_competing_route_choices_only_commit_one(client):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET level=10 WHERE id=?',(wid,))
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(lambda branch:post(client,f'/weapons/{wid}/branch',h,{'branch':branch}).status_code,['rapier','greatsword']))
    assert sorted(codes)==[200,409]
    assert weapon(client,h)['branch_locked']


def test_economy_config_drives_display_and_deduction(client,monkeypatch):
    monkeypatch.setitem(BALANCE['weapon_economy'],'greatsword',{'strike_materials':9,'recycle_by_level':{'10':40000,'20':80000,'70':300000000}})
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute("UPDATE weapons SET branch='greatsword',level=20,heat_charges=5,heat_ready_at=0 WHERE id=?",(wid,))
    before=client.get('/api/state',headers=h).json()
    assert before['weapons'][0]['strike_materials']==9
    assert before['weapons'][0]['recycle_price']==80000
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:0)
    response=post(client,f'/weapons/{wid}/strike',h,{'expected_level':20,'expected_strikes':0,'expected_protected_left':0})
    assert response.status_code==200
    assert client.get('/api/state',headers=h).json()['player']['materials']==before['player']['materials']-9
