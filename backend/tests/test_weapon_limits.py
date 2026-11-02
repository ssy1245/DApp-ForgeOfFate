"""Each route enforces its own ceiling without consuming resources at the cap."""
import uuid

import pytest

from backend.game import probabilities, strike, weapon_max_level
from backend.tests.test_game import client, login, forge, post, weapon


@pytest.mark.parametrize('branch,limit',[('longsword',90),('greatsword',70),('rapier',80)])
@pytest.mark.parametrize('outcome',['up','double'])
def test_reinforcement_stops_at_route_cap(client,monkeypatch,branch,limit,outcome):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=?,heat_ready_at=0,heat_charges=5 WHERE id=?',(branch,limit-1,wid))
    roll=0 if outcome=='up' else int((probabilities(limit-1)['up']+0.06)*1_000_000)
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:roll)
    key=str(uuid.uuid4())
    body={'expected_level':limit-1,'expected_strikes':0,'expected_protected_left':0}
    result=post(client,f'/weapons/{wid}/strike',h,body,key)
    assert result.status_code==200
    assert result.json()['result']==outcome and result.json()['level']==limit
    assert result.json()['branch']==branch
    assert post(client,f'/weapons/{wid}/strike',h,body,key).json()==result.json()
    w=weapon(client,h)
    assert w['level']==limit and w['max_level']==limit
    before=client.get('/api/state',headers=h).json()
    body={'expected_level':limit,'expected_strikes':w['strikes'],'expected_protected_left':w['protected_left']}
    blocked=post(client,f'/weapons/{wid}/strike',h,body)
    assert blocked.status_code==409 and f'+{limit}' in blocked.json()['detail']
    assert post(client,f'/weapons/{wid}/heat',h).status_code==409
    assert client.get('/api/state',headers=h).json()==before


@pytest.mark.parametrize('source,level,target',[
    ('longsword',71,'greatsword'),('longsword',80,'greatsword'),('longsword',81,'rapier'),
])
def test_high_level_knight_sword_cannot_manually_switch(client,source,level,target):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=? WHERE id=?',(source,level,wid))
    before=weapon(client,h)
    response=post(client,f'/weapons/{wid}/branch',h,{'branch':target})
    assert response.status_code==409
    assert weapon(client,h)==before


def test_switching_at_target_cap_is_disabled(client):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:db.execute("UPDATE weapons SET branch='greatsword',level=70 WHERE id=?",(wid,))
    before=weapon(client,h)
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==409
    assert weapon(client,h)==before


def test_pure_strikes_retain_the_route_between_turns():
    w={'branch':'greatsword','level':69,'strikes':0,'protected_left':0}
    result=strike(w,0,False)
    assert result['level']==70 and result['branch']=='greatsword'
    assert strike(result,0,False)['level']==70


@pytest.mark.parametrize('level,outcome,target', [(80,'up',81),(88,'double',90)])
def test_last_dawn_keeps_its_model_while_strengthening_to_ninety(client,monkeypatch,level,outcome,target):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute("UPDATE weapons SET branch='longsword',level=?,heat_ready_at=0,heat_charges=5 WHERE id=?",(level,wid))
    before=client.get('/api/state',headers=h).json()
    roll=0 if outcome=='up' else int((probabilities(level)['up']+0.06)*1_000_000)
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:roll)
    response=post(client,f'/weapons/{wid}/strike',h,{'expected_level':level,'expected_strikes':0,'expected_protected_left':0})
    assert response.status_code==200 and response.json()['level']==target
    w=weapon(client,h)
    assert w['name']=='最后的黎明' and w['tier_id']=='last-dawn' and w['max_level']==90
    assert w['recycle_price']==(100000000 if target==90 else 64000000)
    after=client.get('/api/state',headers=h).json()
    assert after['player']['materials']==before['player']['materials']-4
