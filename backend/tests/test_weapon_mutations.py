import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.game import probabilities, strike_material_cost
from backend.tests.test_game import client, login, forge, post, weapon
from backend.tests.test_cheats import tester


def prepare(client, level=4, checked=0, branch='longsword'):
    h,*_=login(client);wid=forge(client,h)
    set_level(client,wid,level,branch=branch,checked=checked)
    return h,wid


def set_level(client,wid,level,branch=None,checked=None):
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET level=?,heat_charges=5,heat_ready_at=0 WHERE id=?',(level,wid))
        db.execute('UPDATE players SET materials=10000 WHERE address=(SELECT owner FROM weapons WHERE id=?)',(wid,))
        if branch is not None:db.execute('UPDATE weapons SET branch=? WHERE id=?',(branch,wid))
        if checked is not None:db.execute('UPDATE weapons SET mutation_checked_level=? WHERE id=?',(checked,wid))


def body(client,h):
    w=weapon(client,h)
    return dict(expected_level=w['level'],expected_strikes=w['strikes'],expected_protected_left=w['protected_left'])


def rolls(monkeypatch,values):
    calls=[];values=iter(values)
    def draw(limit):
        assert limit==1_000_000
        value=next(values);calls.append(value);return value
    monkeypatch.setattr('backend.app.secrets.randbelow',draw)
    return calls


@pytest.mark.parametrize('start,checked,target,milestone',[(4,0,'rapier',5),(9,5,'greatsword',10)])
@pytest.mark.parametrize('double',[False,True])
@pytest.mark.parametrize('mutation_roll,changed',[(0,True),(299999,True),(300000,False),(999999,False)])
def test_milestones_exact_probability_boundary_jump_and_atomic_retry(client,monkeypatch,start,checked,target,milestone,double,mutation_roll,changed):
    h,wid=prepare(client,start,checked)
    before=client.get('/api/state',headers=h).json()
    first_roll=int((probabilities(start)['up']+0.06)*1_000_000) if double else 0
    calls=rolls(monkeypatch,[first_roll,mutation_roll]);payload=body(client,h);key=str(uuid.uuid4())
    response=post(client,f'/weapons/{wid}/strike',h,payload,key);assert response.status_code==200
    result=response.json();reached=start+(2 if double else 1)
    assert result['mutation']==dict(branch=target,level=milestone,chance=.3,changed=changed,reached_level=reached)
    assert result['branch']==(target if changed else 'longsword')
    assert result['level']==(milestone if changed else reached)
    assert result['mutation_checked_level']==milestone
    assert post(client,f'/weapons/{wid}/strike',h,payload,key).json()==result
    assert post(client,f'/weapons/{wid}/strike',h,payload).status_code==409
    after=client.get('/api/state',headers=h).json()
    assert after['player']['materials']==before['player']['materials']-strike_material_cost(start)
    assert after['weapons'][0]['heat_charges']==4 and len(calls)==2
    restored=TestClient(create_app(client.app.state.store.path,demo=False))
    assert post(restored,f'/weapons/{wid}/strike',h,payload,key).json()==result
    assert weapon(restored,h)['mutation_checked_level']==milestone and len(calls)==2


@pytest.mark.parametrize('branch',['rapier','greatsword'])
@pytest.mark.parametrize('start',[0,4,9,19,59])
def test_mutated_sword_never_checks_again_even_at_ten_or_after_downgrade(client,monkeypatch,branch,start):
    h,wid=prepare(client,start,0,branch)  # Even a legacy row without its marker stays locked.
    calls=rolls(monkeypatch,[0])
    assert weapon(client,h)['next_mutation'] is None
    result=post(client,f'/weapons/{wid}/strike',h,body(client,h)).json()
    assert result['mutation'] is None and result['branch']==branch and len(calls)==1
    assert result['level']==start+1


def test_failed_rapier_cannot_reroll_but_still_has_one_greatsword_check(client,monkeypatch):
    h,wid=prepare(client);rolls(monkeypatch,[0,900000])
    assert not post(client,f'/weapons/{wid}/strike',h,body(client,h)).json()['mutation']['changed']
    set_level(client,wid,4);restored=TestClient(create_app(client.app.state.store.path,demo=False))
    calls=rolls(monkeypatch,[0]);result=post(restored,f'/weapons/{wid}/strike',h,body(restored,h)).json()
    assert result['mutation'] is None and result['branch']=='longsword' and len(calls)==1
    assert weapon(restored,h)['next_mutation']['branch']=='greatsword'
    set_level(restored,wid,9);rolls(monkeypatch,[0,0])
    result=post(restored,f'/weapons/{wid}/strike',h,body(restored,h)).json()
    assert result['branch']=='greatsword' and result['mutation']['changed']


def test_both_failures_remain_knight_after_downgrading_past_both_milestones(client,monkeypatch):
    h,wid=prepare(client,9,5);rolls(monkeypatch,[0,999999])
    assert not post(client,f'/weapons/{wid}/strike',h,body(client,h)).json()['mutation']['changed']
    for level in [4,9]:
        set_level(client,wid,level);calls=rolls(monkeypatch,[0])
        result=post(client,f'/weapons/{wid}/strike',h,body(client,h)).json()
        assert result['mutation'] is None and result['branch']=='longsword' and len(calls)==1
        assert weapon(client,h)['next_mutation'] is None


@pytest.mark.parametrize('same_key',[True,False])
def test_concurrent_milestone_strikes_draw_once(client,monkeypatch,same_key):
    h,wid=prepare(client);payload=body(client,h);calls=rolls(monkeypatch,[0,0]);key=str(uuid.uuid4())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda i:post(client,f'/weapons/{wid}/strike',h,payload,key if same_key or i==0 else str(uuid.uuid4())),range(2)))
    assert sorted(r.status_code for r in results)==([200,200] if same_key else [200,409])
    assert len(calls)==2 and weapon(client,h)['heat_charges']==4 and weapon(client,h)['branch']=='rapier'


@pytest.mark.parametrize('failure',['materials','heat','stale'])
def test_rejected_strike_never_consumes_the_mutation_check(client,monkeypatch,failure):
    h,wid=prepare(client);payload=body(client,h)
    with client.app.state.store.connection() as db:
        if failure=='materials':db.execute('UPDATE players SET materials=0')
        elif failure=='heat':db.execute('UPDATE weapons SET heat_charges=0 WHERE id=?',(wid,))
        else:payload['expected_level']=3
    calls=rolls(monkeypatch,[])
    assert post(client,f'/weapons/{wid}/strike',h,payload).status_code==409
    assert weapon(client,h)['mutation_checked_level']==0 and calls==[]


@pytest.mark.parametrize('roll',[900000,999999])
def test_downgrade_or_destroy_does_not_roll_mutation(client,monkeypatch,roll):
    h,wid=prepare(client);calls=rolls(monkeypatch,[roll])
    result=post(client,f'/weapons/{wid}/strike',h,body(client,h)).json()
    assert result['mutation'] is None and result['mutation_checked_level']==0 and len(calls)==1


def test_database_migration_preserves_old_routes_and_consumes_passed_milestones(client):
    h,wid=prepare(client,20)
    with client.app.state.store.connection() as db:db.execute('ALTER TABLE weapons DROP COLUMN mutation_checked_level')
    restored=TestClient(create_app(client.app.state.store.path,demo=False))
    w=weapon(restored,h)
    assert w['level']==20 and w['branch']=='longsword' and w['mutation_checked_level']==10
    set_level(restored,wid,4)
    again=TestClient(create_app(client.app.state.store.path,demo=False))
    assert weapon(again,h)['mutation_checked_level']==10 and weapon(again,h)['next_mutation'] is None


def test_cheat_high_level_then_lower_cannot_rearm_milestones(tester):
    c,_,_=tester
    wid=post(c,'/cheats/weapons',{},dict(count=1,level=20)).json()['weapon_id']
    assert post(c,f'/cheats/weapons/{wid}',{},dict(level=4)).status_code==200
    w=next(w for w in c.get('/api/state').json()['weapons'] if w['id']==wid)
    assert w['mutation_checked_level']==10 and w['next_mutation'] is None


@pytest.mark.parametrize('level',[4,5,10,60,90])
def test_manual_conversion_cannot_bypass_randomness(client,level):
    h,wid=prepare(client,level);before=weapon(client,h)
    for branch in ['rapier','greatsword','longsword']:
        assert post(client,f'/weapons/{wid}/branch',h,dict(branch=branch)).status_code==409
    assert weapon(client,h)==before
