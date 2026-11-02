"""Persistent weapon type is independent of reinforcement level."""
import base64
import json
import uuid
import pytest
from backend.app import create_app
from chain.server.nft import metadata
from fastapi.testclient import TestClient
from backend.game import BALANCE, weapon_tier, weapon_name
from backend.tests.test_game import client, login, forge, post, weapon


def set_level(client, wid, level, status='active'):
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET level=?,status=? WHERE id=?',(level,status,wid))




def test_branch_authorization_and_sealing(client):
    h,*_=login(client);wid=forge(client,h);set_level(client,wid,50)
    h2,*_=login(client)
    assert post(client,f'/weapons/{wid}/branch',h2,{'branch':'rapier'}).status_code==404
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'voxel'}).status_code==422
    set_level(client,wid,50,'sealed')
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'}).status_code==409


@pytest.mark.parametrize('level,name,model',[
    (0,'余烬长剑','sword'),(4,'余烬长剑','sword'),
    (5,'精铁刺剑','rapier/+5rapier'),(9,'精铁刺剑','rapier/+5rapier'),
    (10,'银锋刺剑','rapier/+10rapier'),(19,'银锋刺剑','rapier/+10rapier'),
    (20,'宫廷细剑','rapier/+20rapier'),(29,'宫廷细剑','rapier/+20rapier'),
    (30,'鸢尾刺剑','rapier/+30rapier'),(39,'鸢尾刺剑','rapier/+30rapier'),
    (40,'王室誓剑','rapier/+40rapier'),(49,'王室誓剑','rapier/+40rapier'),
    (50,'绯冠刺剑','rapier/+50rapier'),(59,'绯冠刺剑','rapier/+50rapier'),
    (60,'赤蔷誓约','rapier/+60rapier'),(69,'赤蔷誓约','rapier/+60rapier'),
    (70,'炽翼天使','rapier/+70rapier'),(79,'炽翼天使','rapier/+70rapier'),(80,'炽翼天使','rapier/+70rapier')])
def test_rapier_uses_its_own_stage_model(level,name,model):
    assert weapon_tier(level,'rapier')['model']==model
    assert weapon_name(level,'rapier')==name


@pytest.mark.parametrize('branch,level',[('longsword',39),('rapier',70),('greatsword',50)])
@pytest.mark.parametrize('materials',[0,1])
def test_new_models_heat_after_materials_are_replenished(client,branch,level,materials):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET level=?,branch=? WHERE id=?',(level,branch,wid))
        db.execute('UPDATE players SET materials=?',(materials,))
    response=post(client,f'/weapons/{wid}/heat',h)
    assert response.status_code==409
    assert f"加热需要 {BALANCE['heat_materials']} 铁块，当前剩余 {materials}" in response.json()['detail']
    assert weapon(client,h)['heat_charges']==0
    with client.app.state.store.connection() as db:
        db.execute('UPDATE players SET materials=?',(BALANCE['heat_materials'],))
    assert post(client,f'/weapons/{wid}/heat',h).status_code==200
    heated=weapon(client,h)
    assert heated['level']==level and heated['branch']==branch
    assert heated['heat_charges']==BALANCE['heat_strikes']
    assert client.get('/api/state',headers=h).json()['player']['materials']==0


@pytest.mark.parametrize('level,name,model',[
    (0,'余烬长剑','sword'),(5,'余烬长剑','sword'),(9,'余烬长剑','sword'),
    (10,'铁匠大剑','GreatSword/+10GreatSword'),(19,'铁匠大剑','GreatSword/+10GreatSword'),
    (20,'烬炉大剑','GreatSword/+20GreatSword'),(29,'烬炉大剑','GreatSword/+20GreatSword'),
    (30,'渊角龙骸','GreatSword/+30GreatSword'),(39,'渊角龙骸','GreatSword/+30GreatSword'),
    (40,'熔脉龙骸','GreatSword/+40GreatSword'),(49,'熔脉龙骸','GreatSword/+40GreatSword'),
    (50,'深渊炉心','GreatSword/+50GreatSword'),(59,'深渊炉心','GreatSword/+50GreatSword'),
    (60,'余烬君王','GreatSword/+60GreatSword'),(69,'余烬君王','GreatSword/+60GreatSword'),(70,'余烬君王','GreatSword/+60GreatSword'),(100,'余烬君王','GreatSword/+60GreatSword'),
])
def test_greatsword_uses_its_own_stage_model(level,name,model):
    assert weapon_tier(level,'greatsword')['model']==model
    assert weapon_name(level,'greatsword')==name


@pytest.mark.parametrize('branch,level,name', [('rapier',70,'炽翼天使'),('greatsword',60,'余烬君王')])
def test_mutated_route_persists_through_downgrades_restart_and_sealing(client,branch,level,name):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=?,mutation_checked_level=10 WHERE id=?',(branch,level,wid))
    restored=TestClient(create_app(client.app.state.store.path,demo=False))
    assert weapon(restored,h)['name']==name and weapon(restored,h)['next_mutation'] is None
    set_level(restored,wid,0)
    assert weapon(restored,h)['branch']==branch and weapon(restored,h)['name']=='余烬长剑'
    assert post(restored,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==409
    set_level(restored,wid,level)
    assert post(restored,f'/weapons/{wid}/seal',h).status_code==200
    data=json.loads(base64.b64decode(metadata(weapon(restored,h)).split(',')[1]))
    assert name in data['name'] and {'trait_type':'Weapon Type','value':branch} in data['attributes']
