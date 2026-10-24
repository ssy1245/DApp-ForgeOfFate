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
    set_level(client,wid,3)
    key=str(uuid.uuid4())
    first=post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'},key)
    assert first.status_code==200
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'rapier'},key).json()==first.json()
    assert weapon(client,h)['name']=='轻型刺剑'
    set_level(client,wid,2)
    assert weapon(client,h)['branch']=='rapier'
    assert weapon(client,h)['name']=='余烬长剑'
    set_level(client,wid,50)
    w=weapon(client,h)
    assert w['name']=='加冕刺剑'
    data=json.loads(base64.b64decode(metadata(w).split(',')[1]))
    assert '加冕刺剑' in data['name']
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


@pytest.mark.parametrize('level,name',[
    (3,'轻型刺剑'),(9,'轻型刺剑'),
    (10,'银徽刺剑'),(24,'银徽刺剑'),
    (25,'摄政刺剑'),(49,'摄政刺剑'),
    (50,'加冕刺剑'),(100,'加冕刺剑')])
def test_rapier_does_not_turn_into_high_tier_longsword(level,name):
    assert weapon_tier(level,'rapier')['model']=='medieval+sword+model'
    assert weapon_name(level,'rapier')==name
