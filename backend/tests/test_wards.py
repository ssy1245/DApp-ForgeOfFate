import uuid

import pytest

from backend.game import strike
from test_game import client, login, forge, warm, post


@pytest.mark.parametrize('roll,outcome,used', [(0,'up',False),(0.8,'double',False),(0.9,'down',False),(0.999999,'saved',True)])
def test_ward_only_consumed_for_prevented_destruction(roll, outcome, used):
    weapon={'level':5,'strikes':0,'protected_left':0}
    result=strike(weapon,roll,True)
    assert result['result']==outcome and result['shield_used'] is used
    assert result['status']=='active'
    if used:assert result['level']==weapon['level']


def prepared(client):
    headers,*_=login(client)
    wid=forge(client,headers)
    warm(client,headers,wid)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET level=5 WHERE id=?',(wid,))
    return headers,wid


def body(client,headers,wid):
    w=next(w for w in client.get('/api/state',headers=headers).json()['weapons'] if w['id']==wid)
    return {'shield':True,'expected_level':w['level'],'expected_strikes':w['strikes'],'expected_protected_left':w['protected_left']}


def test_real_api_spends_once_when_saved_and_retry_is_idempotent(client,monkeypatch):
    headers,wid=prepared(client)
    before=client.get('/api/state',headers=headers).json()['player']['shields']
    for roll,expected in [(0,'up'),(800000,'double'),(900000,'down'),(999999,'saved')]:
        monkeypatch.setattr('backend.app.secrets.randbelow',lambda _,value=roll:value)
        request=body(client,headers,wid);key=str(uuid.uuid4())
        response=post(client,f'/weapons/{wid}/strike',headers,request,key)
        assert response.status_code==200
        assert response.json()['result']==expected
        assert post(client,f'/weapons/{wid}/strike',headers,request,key).json()==response.json()
        expected_count=before-(1 if expected=='saved' else 0)
        assert client.get('/api/state',headers=headers).json()['player']['shields']==expected_count


def test_no_wards_rejected_before_random_roll_and_spending(client,monkeypatch):
    headers,wid=prepared(client)
    with client.app.state.store.connection() as db:db.execute('UPDATE players SET shields=0')
    before=client.get('/api/state',headers=headers).json()
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:pytest.fail('Empty inventory must fail before a random roll'))
    response=post(client,f'/weapons/{wid}/strike',headers,body(client,headers,wid))
    assert response.status_code==409 and '保护符不足' in response.json()['detail']
    assert client.get('/api/state',headers=headers).json()==before


def test_stage_protection_never_spends_ward_even_with_empty_inventory(client,monkeypatch):
    headers,wid=prepared(client)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE players SET shields=0')
        db.execute('UPDATE weapons SET protected_left=1 WHERE id=?',(wid,))
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:999999)
    result=post(client,f'/weapons/{wid}/strike',headers,body(client,headers,wid)).json()
    assert result['result']=='saved' and not result['shield_used'] and result['protected_left']==0
    assert client.get('/api/state',headers=headers).json()['player']['shields']==0
    assert post(client,f'/weapons/{wid}/strike',headers,body(client,headers,wid)).status_code==409


def test_last_ward_cannot_protect_another_strike(client,monkeypatch):
    headers,wid=prepared(client)
    with client.app.state.store.connection() as db:db.execute('UPDATE players SET shields=1')
    monkeypatch.setattr('backend.app.secrets.randbelow',lambda _:999999)
    result=post(client,f'/weapons/{wid}/strike',headers,body(client,headers,wid)).json()
    assert result['shield_used'] and result['result']=='saved'
    after=client.get('/api/state',headers=headers).json()
    assert after['player']['shields']==0
    assert post(client,f'/weapons/{wid}/strike',headers,body(client,headers,wid)).status_code==409
    request=body(client,headers,wid);request['shield']=False
    assert post(client,f'/weapons/{wid}/strike',headers,request).json()['result']=='destroy'
