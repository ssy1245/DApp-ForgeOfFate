from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.game import weapon_can_mint, weapon_mint_level
from backend.tests.test_game import login, forge, post


@pytest.fixture
def client(tmp_path, monkeypatch):
    connection = Mock(return_value=({},None,object()))
    monkeypatch.setattr('backend.app.ChainReader.connect',connection)
    app = create_app(str(tmp_path/'game.sqlite3'),demo=False)
    app.state.test_chain = connection
    return TestClient(app)


@pytest.mark.parametrize('branch,minimum,maximum', [('longsword',80,90),('rapier',70,80),('greatsword',60,70)])
@pytest.mark.parametrize('point', ['below','threshold','above','cap','over_cap'])
@pytest.mark.parametrize('demo', [0,1])
def test_final_form_gates_seal_and_voucher_even_for_old_sealed_records(client, monkeypatch, branch, minimum, maximum, point, demo):
    h, *_ = login(client)
    wid = forge(client,h)
    level = {'below':minimum-1,'threshold':minimum,'above':minimum+1,'cap':maximum,'over_cap':maximum+1}[point]
    eligible = point not in ('below','over_cap')
    assert weapon_mint_level(branch) == minimum
    assert weapon_can_mint(level,branch) == eligible
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=?,demo=? WHERE id=?',(branch,level,demo,wid))
    item = next(w for w in client.get('/api/state',headers=h).json()['weapons'] if w['id']==wid)
    assert item['mint_level']==minimum and item['can_mint']==eligible
    result = post(client,f'/weapons/{wid}/seal',h)
    assert result.status_code == (200 if eligible else 409)
    if not eligible:
        with client.app.state.store.connection() as db:
            assert db.execute('SELECT status FROM weapons WHERE id=?',(wid,)).fetchone()[0]=='active'
            # Legacy sealed rows and direct API calls must also obey the new gate.
            db.execute("UPDATE weapons SET status='sealed' WHERE id=?",(wid,))
    chain = client.app.state.test_chain
    chain.reset_mock()
    signing = Mock(return_value={'voucher':{'level':level}})
    monkeypatch.setattr('backend.app.mint_authorization',signing)
    result = post(client,f'/weapons/{wid}/voucher',h)
    assert result.status_code == (200 if eligible else 409)
    assert signing.call_count == int(eligible) and chain.call_count == int(eligible)


@pytest.mark.parametrize('branch,level', [('longsword',79),('rapier',69),('greatsword',59)])
def test_below_final_form_can_still_recycle_exactly_once(client, branch, level):
    h, *_ = login(client)
    wid = forge(client,h)
    with client.app.state.store.connection() as db:
        db.execute('UPDATE weapons SET branch=?,level=? WHERE id=?',(branch,level,wid))
    before=client.get('/api/state',headers=h).json()
    value=next(w['recycle_price'] for w in before['weapons'] if w['id']==wid)
    assert post(client,f'/weapons/{wid}/seal',h).status_code==409
    assert post(client,f'/weapons/{wid}/recycle',h).status_code==200
    assert post(client,f'/weapons/{wid}/recycle',h).status_code==409
    assert client.get('/api/state',headers=h).json()['player']['coins']==before['player']['coins']+value
