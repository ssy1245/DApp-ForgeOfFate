"""Persistent weapon type is independent of reinforcement level."""
import base64
import json
import uuid
import pytest
from backend.app import metadata
from backend.game import weapon_tier, weapon_name
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
    assert weapon(client,h)['name']=='轻型刺剑'
    set_level(client,wid,4)
    assert weapon(client,h)['branch']=='rapier'
    assert weapon(client,h)['name']=='余烬长剑'
    set_level(client,wid,5)
    assert weapon(client,h)['name']=='轻型刺剑'
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==200
    assert weapon(client,h)['name']=='余烬长剑'
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'}).status_code==200
    set_level(client,wid,10)
    assert weapon(client,h)['name']=='银徽刺剑'
    set_level(client,wid,50)
    w=weapon(client,h)
    assert w['name']=='鎏金加冕刺剑'
    data=json.loads(base64.b64decode(metadata(w).split(',')[1]))
    assert '鎏金加冕刺剑' in data['name']
    assert {'trait_type':'Weapon Type','value':'rapier'} in data['attributes']
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==200
    assert weapon(client,h)['name']=='鎏金誓约圣剑'


def test_branch_authorization_and_sealing(client):
    h,*_=login(client);wid=forge(client,h);set_level(client,wid,50)
    h2,*_=login(client)
    assert post(client,f'/weapons/{wid}/branch',h2,{'branch':'rapier'}).status_code==404
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'voxel'}).status_code==422
    set_level(client,wid,50,'sealed')
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'}).status_code==409


@pytest.mark.parametrize('level,name,model',[
    (0,'余烬长剑','sword'),(4,'余烬长剑','sword'),
    (5,'轻型刺剑','rapier/l0-slim sowrd'),(9,'轻型刺剑','rapier/l0-slim sowrd'),
    (10,'银徽刺剑','rapier/l1-slim-sword+3d+model'),(19,'银徽刺剑','rapier/l1-slim-sword+3d+model'),
    (20,'月桂刺剑','rapier/l2-slim-sword+3d+model'),(29,'月桂刺剑','rapier/l2-slim-sword+3d+model'),
    (30,'摄政刺剑','rapier/l3-slim+sword+3d+model'),(39,'摄政刺剑','rapier/l3-slim+sword+3d+model'),
    (40,'加冕刺剑','rapier/l4-rapier+3d+model'),(49,'加冕刺剑','rapier/l4-rapier+3d+model'),
    (50,'鎏金加冕刺剑','rapier/l5-rapier+3d+model'),(60,'鎏金加冕刺剑','rapier/l5-rapier+3d+model'),
    (70,'鎏金加冕刺剑','rapier/l5-rapier+3d+model'),(100,'鎏金加冕刺剑','rapier/l5-rapier+3d+model')])
def test_rapier_uses_its_own_stage_model(level,name,model):
    assert weapon_tier(level,'rapier')['model']==model
    assert weapon_name(level,'rapier')==name
