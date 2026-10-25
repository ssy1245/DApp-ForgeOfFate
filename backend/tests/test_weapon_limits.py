"""Each route enforces its own ceiling without consuming resources at the cap."""
import uuid

import pytest

from backend.game import probabilities, strike, weapon_max_level
from backend.tests.test_game import client, login, forge, post, weapon


@pytest.mark.parametrize('branch,limit',[('longsword',80),('greatsword',60),('rapier',80)])
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
    ('longsword',61,'greatsword'),('longsword',80,'greatsword'),('rapier',81,'longsword'),
])
def test_switching_to_lower_cap_does_not_erase_levels(client,source,level,target):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=? WHERE id=?',(source,level,wid))
    before=weapon(client,h)
    response=post(client,f'/weapons/{wid}/branch',h,{'branch':target})
    assert response.status_code==409 and f'+{weapon_max_level(target)}' in response.json()['detail']
    assert weapon(client,h)==before


def test_switching_at_target_cap_is_allowed(client):
    h,*_=login(client);wid=forge(client,h)
    with client.app.state.store.connection() as db:db.execute('UPDATE weapons SET level=60 WHERE id=?',(wid,))
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'greatsword'}).status_code==200
    assert weapon(client,h)['max_level']==60
    assert post(client,f'/weapons/{wid}/branch',h,{'branch':'longsword'}).status_code==200
    assert weapon(client,h)['level']==60 and weapon(client,h)['max_level']==80


def test_pure_strikes_retain_the_route_between_turns():
    w={'branch':'greatsword','level':59,'strikes':0,'protected_left':0}
    result=strike(w,0,False)
    assert result['level']==60 and result['branch']=='greatsword'
    assert strike(result,0,False)['level']==60
