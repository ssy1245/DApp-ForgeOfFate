import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.mailbox import MAX_SAFE_COINS, deliver_reward
from backend.tests.test_cheats import tester
from backend.tests.test_game import post
from backend.tests.test_accounts_supply import credentials


def send(client, owner, coins=100, day='2026-10-30', source='staking-deployment-1', kind='staking_daily'):
    with client.app.state.store.connection() as db:
        return deliver_reward(db, owner, kind=kind, reward_day=day, source_key=source, coins=coins)


def balance(client):
    return client.get('/api/state').json()['player']['coins']


def audit(client):
    with client.app.state.store.connection() as db:
        return [dict(row) for row in db.execute('SELECT * FROM reward_mail_claims ORDER BY rowid')]


def test_delivery_and_reading_do_not_credit_coins(tester):
    c,owner,_=tester
    mail_id=send(c,owner,123)
    data=c.get('/api/mail').json()
    assert data['total']==data['unread']==1 and data['totalCoins']=='123'
    assert data['items'][0]['id']==mail_id and 'source_key' not in data['items'][0]
    assert balance(c)==0 and audit(c)==[]
    assert c.get('/api/mail').headers['cache-control']=='no-store'
    assert post(c,f'/mail/{mail_id}/read',{}).status_code==200
    assert post(c,f'/mail/{mail_id}/read',{}).status_code==200
    data=c.get('/api/mail').json()
    assert data['total']==1 and data['unread']==0 and data['items'][0]['read_at'] is not None
    assert balance(c)==0 and audit(c)==[]


def test_delivery_deduplicates_even_after_claim_and_rejects_changed_amount(tester):
    c,owner,_=tester
    mail_id=send(c,owner,123)
    assert send(c,owner,123)==mail_id
    with pytest.raises(ValueError):send(c,owner,124)
    assert post(c,f'/mail/{mail_id}/claim',{}).json()['coinsAdded']==123
    assert send(c,owner,123)==mail_id
    assert c.get('/api/mail').json()['items']==[]
    assert balance(c)==123 and len(audit(c))==1
    with pytest.raises(ValueError):send(c,owner,124)
    assert send(c,owner,123,day='2026-10-31')!=mail_id
    assert send(c,owner,123,source='staking-deployment-2')!=mail_id
    assert c.get('/api/mail').json()['total']==2


def test_concurrent_daily_delivery_only_creates_one_mail(tester):
    c,owner,_=tester
    with ThreadPoolExecutor(max_workers=12) as pool:
        ids=list(pool.map(lambda _:send(c,owner,77),range(36)))
    assert len(set(ids))==1
    assert c.get('/api/mail').json()['total']==1 and balance(c)==0


def test_single_claim_retries_with_same_or_new_keys_never_credit_twice(tester):
    c,owner,_=tester
    mail_id=send(c,owner,345);key=str(uuid.uuid4())
    first=post(c,f'/mail/{mail_id}/claim',{},key=key)
    assert first.status_code==200 and first.json()['coinsAdded']==345
    for _ in range(5):
        assert post(c,f'/mail/{mail_id}/claim',{},key=key).json()==first.json()
        assert post(c,f'/mail/{mail_id}/claim',{}).json()['coinsAdded']==0
    assert balance(c)==345 and c.get('/api/mail').json()['total']==0
    rows=audit(c)
    assert len(rows)==1 and rows[0]['balance_before']==0 and rows[0]['balance_after']==345


def test_bulk_claim_covers_unread_read_and_every_page(tester):
    c,owner,_=tester
    ids=[send(c,owner,i+1,source=f'day-{i}') for i in range(65)]
    post(c,f'/mail/{ids[0]}/read',{})
    assert len(c.get('/api/mail?limit=30').json()['items'])==30
    assert len(c.get('/api/mail?offset=60&limit=30').json()['items'])==5
    key=str(uuid.uuid4());r=post(c,'/mail/claim-all',{},key=key)
    assert r.json()['claimedCount']==65 and r.json()['coinsAdded']==sum(range(1,66))
    # A lost response retried after another delivery must not claim the new mail.
    send(c,owner,900,source='late-arrival')
    assert post(c,'/mail/claim-all',{},key=key).json()==r.json()
    assert c.get('/api/mail').json()['total']==1
    assert post(c,'/mail/claim-all',{}).json()['coinsAdded']==900
    assert post(c,'/mail/claim-all',{}).json()['coinsAdded']==0
    assert balance(c)==sum(range(1,66))+900 and len(audit(c))==66
    rows=audit(c)
    assert all(row['balance_after']-row['balance_before']==row['coins'] for row in rows)
    assert all(a['balance_after']==b['balance_before'] for a,b in zip(rows,rows[1:]))


def test_parallel_single_and_bulk_claims_preserve_exact_balance(tester):
    c,owner,_=tester
    ids=[send(c,owner,17,source=f'position-{i}') for i in range(20)]
    token=c.cookies.get('forge_session')
    def claim(i):
        endpoint='/mail/claim-all' if i%3==0 else f'/mail/{ids[i%20]}/claim'
        return post(c,endpoint,{'Authorization':'Bearer '+token}).json()['coinsAdded']
    with ThreadPoolExecutor(max_workers=12) as pool:
        paid=list(pool.map(claim,range(60)))
    assert sum(paid)==balance(c)==340
    rows=audit(c)
    assert len(rows)==20 and len({row['mail_id'] for row in rows})==20
    assert c.get('/api/mail').json()['items']==[]


def test_restart_preserves_unclaimed_mail_and_claim_deduplication(tester):
    c,owner,_=tester
    first=send(c,owner,10);second=send(c,owner,20,source='second')
    key=str(uuid.uuid4());original=post(c,f'/mail/{first}/claim',{},key=key).json()
    restarted=TestClient(create_app(c.app.state.store.path,demo=True));restarted.cookies.update(c.cookies)
    assert [m['id'] for m in restarted.get('/api/mail').json()['items']]==[second]
    assert send(restarted,owner,10)==first
    assert post(restarted,f'/mail/{first}/claim',{},key=key).json()==original
    assert post(restarted,'/mail/claim-all',{}).json()['coinsAdded']==20
    assert balance(restarted)==30 and len(audit(restarted))==2


@pytest.mark.parametrize('point',['ledger','mail','balance','response'])
def test_claim_failure_rolls_back_every_write_and_retry_is_safe(tester,point):
    c,owner,_=tester
    ids=[send(c,owner,10,source='a'),send(c,owner,20,source='b')]
    triggers={
        'ledger':"BEFORE INSERT ON reward_mail_claims WHEN (SELECT COUNT(*) FROM reward_mail_claims)=1",
        'mail':'BEFORE UPDATE OF claimed_at ON reward_mail',
        'balance':'BEFORE UPDATE OF coins ON players',
        'response':"BEFORE INSERT ON operations WHEN NEW.response LIKE '%claimedCount%'",
    }
    with c.app.state.store.connection() as db:
        db.execute(f"CREATE TRIGGER fail_claim {triggers[point]} BEGIN SELECT RAISE(ABORT,'injected failure'); END")
    key=str(uuid.uuid4())
    with pytest.raises(sqlite3.IntegrityError):post(c,'/mail/claim-all',{},key=key)
    assert balance(c)==0 and audit(c)==[]
    assert {m['id'] for m in c.get('/api/mail').json()['items']}==set(ids)
    with c.app.state.store.connection() as db:
        assert not db.execute('SELECT 1 FROM operations WHERE key=?',(key,)).fetchone()
        db.execute('DROP TRIGGER fail_claim')
    assert post(c,'/mail/claim-all',{},key=key).json()['coinsAdded']==30
    assert balance(c)==30 and len(audit(c))==2


def test_account_isolation_guest_and_client_amount_cannot_grant_rewards(tester):
    c,owner,_=tester;mail_id=send(c,owner,55)
    other=TestClient(c.app);other.post('/api/session')
    assert other.get('/api/mail').status_code==403
    assert post(other,'/mail/claim-all',{}).status_code==403
    other.post('/api/account/register',json=credentials())
    assert other.get('/api/mail').json()['items']==[]
    for suffix in ['read','claim']:
        assert post(other,f'/mail/{mail_id}/{suffix}',{}).status_code==404
    assert post(other,'/cheats/mail',{}, {'coins':100}).status_code==403
    assert other.post('/api/mail',json={'coins':99999,'owner':owner}).status_code==405
    assert post(c,f'/mail/{mail_id}/claim',{}, {'coins':99999,'owner':'someone-else'}).json()['coinsAdded']==55
    assert balance(c)==55 and balance(other)==0
    fresh=TestClient(c.app)
    assert fresh.get('/api/mail').status_code==401
    assert post(fresh,f'/mail/{mail_id}/claim',{}).status_code==401


def test_test_mail_requires_role_and_mode_and_request_retries_do_not_send_twice(tester):
    c,owner,_=tester;key=str(uuid.uuid4())
    response=post(c,'/cheats/mail',{}, {'coins':123},key)
    assert response.status_code==200
    assert post(c,'/cheats/mail',{}, {'coins':123},key).json()==response.json()
    assert c.get('/api/mail').json()['total']==1 and balance(c)==0
    assert c.get('/api/mail').json()['items'][0]['kind']=='test'
    assert post(c,'/cheats/mail',{}, {'coins':124},key).status_code==409
    for amount in [0,-1,1.2,True,1000001]:
        assert post(c,'/cheats/mail',{}, {'coins':amount}).status_code==422
    normal=TestClient(create_app(c.app.state.store.path,demo=False));normal.cookies.update(c.cookies)
    assert post(normal,'/cheats/mail',{}, {'coins':123},key).status_code==404
    with c.app.state.store.connection() as db:db.execute("UPDATE accounts SET role='player' WHERE game_address=?",(owner,))
    assert post(c,'/cheats/mail',{}, {'coins':123},key).status_code==403
    assert post(normal,'/mail/claim-all',{}).json()['coinsAdded']==123


def test_large_balance_and_bulk_totals_never_round_or_discard_mail(tester):
    c,owner,_=tester
    big=send(c,owner,MAX_SAFE_COINS,source='large')
    small=send(c,owner,1,source='small')
    assert c.get('/api/mail').json()['totalCoins']==str(MAX_SAFE_COINS+1)
    assert post(c,'/mail/claim-all',{}).status_code==409
    assert balance(c)==0 and c.get('/api/mail').json()['total']==2 and audit(c)==[]
    assert post(c,f'/mail/{big}/claim',{}).json()['coinsAdded']==MAX_SAFE_COINS
    assert post(c,f'/mail/{small}/claim',{}).status_code==409
    assert c.get('/api/mail').json()['total']==1 and balance(c)==MAX_SAFE_COINS


def test_request_identity_and_keys_are_checked(tester):
    c,owner,_=tester;mail_id=send(c,owner)
    assert c.post(f'/api/mail/{mail_id}/claim').status_code==400
    assert post(c,f'/mail/{mail_id}/claim',{'X-Forge-Player':'another-account'}).status_code==409
    key=str(uuid.uuid4())
    assert post(c,f'/mail/{mail_id}/read',{},key=key).status_code==200
    assert post(c,f'/mail/{mail_id}/claim',{},key=key).status_code==409
    assert balance(c)==0
