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


def test_branch_selection_persistence_and_retry(client):
    h,*_=login(client);wid=forge(client,h)
    assert weapon(client,h)['branch']=='longsword'
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'}).status_code==409
    set_level(client,wid,4)
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'}).status_code==409
    set_level(client,wid,5)
    key=str(uuid.uuid4())
    first=post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'},key)
    assert first.status_code==200
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'},key).json()==first.json()
    assert weapon(client,h)['name']=='精铁刺剑'
    set_level(client,wid,4)
    assert weapon(client,h)['branch']=='rapier'
    assert weapon(client,h)['name']=='余烬长剑'
    set_level(client,wid,5)
    assert weapon(client,h)['name']=='精铁刺剑'
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==409
    assert weapon(client,h)['name']=='精铁刺剑'
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'}).status_code==200
    set_level(client,wid,10)
    assert weapon(client,h)['name']=='银锋刺剑'
    set_level(client,wid,50)
    w=weapon(client,h)
    assert w['name']=='绯冠刺剑'
    data=json.loads(base64.b64decode(metadata(w).split(',')[1]))
    assert '绯冠刺剑' in data['name']
    assert {'trait_type':'Weapon Type','value':'rapier'} in data['attributes']
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==409
    assert weapon(client,h)['name']=='绯冠刺剑'


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


def test_greatsword_unlocks_at_ten_and_preserves_progress(client):
    h,*_=login(client);wid=forge(client,h)
    for level in [0,5,9]:
        set_level(client,wid,level)
        response=post(client,f'/weapons/{wid}/branch',h,{'branch':'greatsword'})
        assert response.status_code==409 and '+10' in response.json()['detail']
        assert weapon(client,h)['branch']=='longsword'
    set_level(client,wid,10)
    before=client.get('/api/state',headers=h).json()
    key=str(uuid.uuid4())
    result=post(client,f'/weapons/{wid}/branch',h,{'branch':'greatsword'},key)
    assert result.status_code==200 and result.json()['branch']=='greatsword'
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'greatsword'},key).json()==result.json()
    after=client.get('/api/state',headers=h).json()
    assert after['player']==before['player']
    w=weapon(client,h)
    assert w['name']=='铁匠大剑' and w['max_level']==70
    assert before['weapons'][0]['max_level']==90
    assert before['weapons'][0]['mint_level']==80 and w['mint_level']==60
    assert {k:v for k,v in w.items() if k not in ['branch','name','name_en','tier_id','max_level','mint_level','can_mint','strike_materials','recycle_price','branch_locked']}=={k:v for k,v in before['weapons'][0].items() if k not in ['branch','name','name_en','tier_id','max_level','mint_level','can_mint','strike_materials','recycle_price','branch_locked']}
    restored=TestClient(create_app(client.app.state.store.path,demo=False))
    assert next(w for w in restored.get('/api/state',headers=h).json()['weapons'] if w['id']==wid)['branch']=='greatsword'
    set_level(client,wid,9)
    assert weapon(client,h)['branch']=='greatsword' and weapon(client,h)['name']=='余烬长剑'
    set_level(client,wid,10)
    assert weapon(client,h)['name']=='铁匠大剑'
    set_level(client,wid,9)
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==409
    assert weapon(client,h)['branch']=='greatsword'
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'greatsword'}).status_code==409


def test_greatsword_authorization_sealing_and_metadata(client):
    h,*_=login(client);wid=forge(client,h);set_level(client,wid,60)
    other,*_=login(client)
    assert post(client,f'/weapons/{wid}/branch',other,{'branch':'greatsword'}).status_code==404
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'greatsword'}).status_code==200
    assert weapon(client,h)['level']==10
    assert post(client,f'/weapons/{wid}/seal',h).status_code==409
    set_level(client,wid,60)
    assert post(client,f'/weapons/{wid}/seal',h).status_code==200
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==409
    w=weapon(client,h)
    data=json.loads(base64.b64decode(metadata(w).split(',')[1]))
    assert w['status']=='sealed' and '余烬君王' in data['name']
    assert {'trait_type':'Weapon Type','value':'greatsword'} in data['attributes']


def test_rapier_final_stage_persists_and_seals_at_eighty(client):
    h,*_=login(client);wid=forge(client,h);set_level(client,wid,70)
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'}).status_code==200
    assert weapon(client,h)['level']==5
    set_level(client,wid,70)
    assert weapon(client,h)['name']=='炽翼天使'
    set_level(client,wid,69)
    assert weapon(client,h)['branch']=='rapier' and weapon(client,h)['name']=='赤蔷誓约'
    set_level(client,wid,80)
    w=weapon(client,h)
    assert w['name']=='炽翼天使' and w['max_level']==80
    restored=TestClient(create_app(client.app.state.store.path,demo=False))
    assert weapon(restored,h)['branch']=='rapier' and weapon(restored,h)['name']=='炽翼天使'
    assert post(client,f'/weapons/{wid}/seal',h).status_code==200
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==409
    data=json.loads(base64.b64decode(metadata(weapon(client,h)).split(',')[1]))
    assert '炽翼天使' in data['name']
    assert {'trait_type':'Weapon Type','value':'rapier'} in data['attributes']


@pytest.mark.parametrize('branch,start', [('rapier',5),('greatsword',10)])
@pytest.mark.parametrize('level', [10,60,70,80,90])
def test_switch_always_resets_level_and_cannot_skip_to_final_form(client, branch, start, level):
    h,*_=login(client);wid=forge(client,h);set_level(client,wid,level)
    before=client.get('/api/state',headers=h).json()['player']
    body={'branch':branch,'expected_level':level,'expected_branch':'longsword','level':80}
    key=str(uuid.uuid4())
    response=post(client,f'/weapons/{wid}/branch',h,body,key)
    assert response.status_code==200 and response.json()['level']==start
    assert weapon(client,h)['level']==start and not weapon(client,h)['can_mint']
    assert post(client,f'/weapons/{wid}/seal',h).status_code==409
    assert client.get('/api/state',headers=h).json()['player']==before
    # Neither an exact replay nor a fresh same-route request may undo later upgrades.
    set_level(client,wid,start+2)
    assert post(client,f'/weapons/{wid}/branch',h,body,key).json()==response.json()
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':branch}).status_code==200
    assert weapon(client,h)['level']==start+2
    for other in ('longsword','greatsword' if branch=='rapier' else 'rapier'):
        assert post(client,f'/weapons/{wid}/branch',h,{'branch':other}).status_code==409
    assert weapon(client,h)['level']==start+2


def test_stale_confirmation_cannot_reset_a_changed_weapon(client):
    h,*_=login(client);wid=forge(client,h);set_level(client,wid,61)
    r=post(client,f'/weapons/{wid}/branch',h,{'branch':'greatsword','expected_level':60,'expected_branch':'longsword'})
    assert r.status_code==409
    assert weapon(client,h)['level']==61 and weapon(client,h)['branch']=='longsword'


def test_concurrent_route_choices_only_apply_one_reset(client):
    from concurrent.futures import ThreadPoolExecutor
    h,*_=login(client);wid=forge(client,h);set_level(client,wid,90)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda branch:post(client,f'/weapons/{wid}/branch',h,{'branch':branch,'expected_level':90,'expected_branch':'longsword'}),['rapier','greatsword']))
    assert sorted(r.status_code for r in responses)==[200,409]
    w=weapon(client,h)
    assert w['level']==({'rapier':5,'greatsword':10}[w['branch']])
