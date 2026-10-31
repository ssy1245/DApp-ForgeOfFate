import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.storage import Store
from backend.market import settle_sales, record_sale
from backend.mailbox import deliver_reward, deliver_notice
from backend.tests.test_cheats import tester
from backend.tests.test_game import post
from backend.tests.test_accounts_supply import credentials
from chain.tests.test_indexer import FakeSource, catch_up, A, B, TOKEN
from chain.server.indexer import Indexer, IndexFailure

WID = '0x' + format(int(TOKEN),'064x')
PRICE = str(10**25+1)


def prepare(tester, verified=True):
    client, owner, _ = tester
    store = client.app.state.store
    with store.connection() as db:
        db.execute('INSERT INTO wallet_bindings(account_id,wallet_address,verified_at) SELECT id,?,? FROM accounts WHERE game_address=?', (A,1 if verified else None,owner))
        db.execute("INSERT INTO weapons(id,owner,level,status,created) VALUES(?,?,70,'sealed',1)", (WID,owner))
    source = FakeSource()
    source.add('Transfer',{'tokenId':TOKEN,'from':'0x'+'00'*20,'to':A})
    source.add('Listed',{'tokenId':TOKEN,'seller':A,'price':PRICE},block=4)
    source.add('Transfer',{'tokenId':TOKEN,'from':A,'to':B},block=6)
    source.add('Purchased',{'tokenId':TOKEN,'seller':A,'buyer':B,'price':PRICE},block=6,index=1)
    return client,owner,store,source


def status(store):
    with store.connection() as db:
        return db.execute('SELECT status FROM weapons WHERE id=?',(WID,)).fetchone()[0]


def test_only_finalized_sale_archives_seller_and_delivers_notice(tester):
    c,owner,store,source=prepare(tester)
    source.confirmed=4;catch_up(Indexer(store,source))
    assert status(store)=='sealed' and c.get('/api/mail').json()['total']==0
    source.confirmed=8;catch_up(Indexer(Store(store.path),source))
    assert status(store)=='sold'
    state=c.get('/api/state').json()
    assert state['weapons']==[] and state['player']['mail_notice_count']==1 and state['player']['coins']==0
    mail=c.get('/api/mail').json()
    assert mail['total']==mail['unread']==1 and mail['totalCoins']=='0'
    item=mail['items'][0]
    assert item['kind']=='trade_sold' and item['trade']['token_id']==TOKEN and item['trade']['price_wei']==PRICE
    with store.connection() as db:
        assert db.execute('SELECT owner FROM chain_nfts').fetchone()[0]==B
        assert db.execute('SELECT COUNT(*) FROM reward_mail_claims').fetchone()[0]==0


def test_restart_replay_and_deleted_notification_never_redeliver(tester):
    c,_,store,source=prepare(tester);catch_up(Indexer(store,source))
    mail=c.get('/api/mail').json()['items'][0]
    assert post(c,f"/mail/{mail['id']}/read",{}).status_code==200
    assert post(c,f"/mail/{mail['id']}/claim",{}).status_code==404
    assert post(c,'/mail/claim-all',{}).json()['coinsAdded']==0
    assert c.get('/api/mail').json()['total']==1
    for _ in range(3):assert post(c,f"/mail/{mail['id']}/dismiss",{}).status_code==200
    with store.connection() as db:
        db.execute("UPDATE chain_events SET processed=0 WHERE name='Purchased'")
        db.execute('UPDATE market_sales SET notified_owner=NULL')
    catch_up(Indexer(Store(store.path),source))
    assert c.get('/api/mail').json()['total']==0
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM notice_mail').fetchone()[0]==1
        assert db.execute('SELECT COUNT(*) FROM market_sales').fetchone()[0]==1


@pytest.mark.parametrize('failure',['mail','delivery_marker'])
def test_crash_rolls_back_archival_mail_and_delivery_and_recovers(tester,failure):
    c,_,store,source=prepare(tester)
    table='notice_mail' if failure=='mail' else 'market_sales'
    action='INSERT' if failure=='mail' else 'UPDATE'
    with store.connection() as db:
        db.execute(f"CREATE TRIGGER fail BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'crash'); END")
    with pytest.raises(IndexFailure):Indexer(store,source).tick()
    assert status(store)=='sealed' and c.get('/api/mail').json()['total']==0
    with store.connection() as db:db.execute('DROP TRIGGER fail')
    catch_up(Indexer(Store(store.path),source))
    assert status(store)=='sold' and c.get('/api/mail').json()['total']==1


def test_unverified_or_late_bound_seller_is_not_lost(tester):
    c,_,store,source=prepare(tester,verified=False);catch_up(Indexer(store,source))
    assert c.get('/api/mail').json()['total']==0 and status(store)=='sealed'
    with store.connection() as db:db.execute('UPDATE wallet_bindings SET verified_at=1')
    catch_up(Indexer(Store(store.path),source))
    assert c.get('/api/mail').json()['total']==1 and status(store)=='sold'


def test_upgrade_backfills_old_processed_sales(tester):
    c,_,store,source=prepare(tester);catch_up(Indexer(store,source))
    with store.connection() as db:
        db.execute('DELETE FROM market_sales');db.execute('DELETE FROM notice_mail')
        db.execute("UPDATE weapons SET status='sealed'")
    catch_up(Indexer(Store(store.path),source))
    assert c.get('/api/mail').json()['total']==1 and status(store)=='sold'


def test_wallet_transfer_is_not_a_sale_and_does_not_send_mail(tester):
    c,_,store,source=prepare(tester)
    source.events=[e for e in source.events if e['name']!='Purchased']
    catch_up(Indexer(store,source))
    assert c.get('/api/mail').json()['total']==0 and status(store)=='sealed'


def test_mixed_rewards_notifications_isolation_and_pagination(tester):
    c,owner,store,source=prepare(tester);catch_up(Indexer(store,source))
    notice=c.get('/api/mail').json()['items'][0]
    with store.connection() as db:deliver_reward(db,owner,kind='test',reward_day='2026-10-31',source_key='test',coins=123)
    assert c.get('/api/mail?limit=1').json()['total']==2
    assert len(c.get('/api/mail?offset=1&limit=1').json()['items'])==1
    other=TestClient(create_app(store.path,demo=True));other.post('/api/session');other.post('/api/account/register',json=credentials())
    for endpoint in ('read','dismiss','claim'):
        assert post(other,f"/mail/{notice['id']}/{endpoint}",{}).status_code==404
    assert post(c,'/mail/claim-all',{}).json()['coinsAdded']==123
    assert c.get('/api/mail').json()['total']==1
    assert c.get('/api/state').json()['player']['coins']==123


def test_concurrent_delivery_and_conflicting_payload_are_safe(tester):
    c,owner,store,source=prepare(tester);catch_up(Indexer(store,source))
    def deliver(_):
        with store.connection() as db:
            db.execute('UPDATE market_sales SET notified_owner=NULL')
            settle_sales(db)
    with ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(deliver,range(18)))
    assert c.get('/api/mail').json()['total']==1
    with store.connection() as db:
        event=dict(db.execute("SELECT * FROM chain_events WHERE name='Purchased'").fetchone())
        args=json.loads(event['args']);args['price']='2';event['args']=json.dumps(args)
        with pytest.raises(ValueError):record_sale(db,event)
        notice=dict(db.execute('SELECT * FROM notice_mail').fetchone())
        with pytest.raises(ValueError):deliver_notice(db,owner,source_key=notice['source_key'],payload={},created_at=1)


def test_resale_notifies_the_new_seller_without_restoring_game_weapon(tester):
    c,_,store,source=prepare(tester);catch_up(Indexer(store,source))
    buyer=TestClient(create_app(store.path,demo=True));buyer.post('/api/session')
    second=buyer.post('/api/account/register',json=credentials()).json()['address']
    with store.connection() as db:
        db.execute('INSERT INTO wallet_bindings(account_id,wallet_address,verified_at) SELECT id,?,1 FROM accounts WHERE game_address=?',(B,second))
    source.head=source.confirmed=10
    source.add('Transfer',{'tokenId':TOKEN,'from':B,'to':A},block=9)
    source.add('Purchased',{'tokenId':TOKEN,'seller':B,'buyer':A,'price':'123'},block=9,index=1)
    catch_up(Indexer(store,source))
    assert c.get('/api/mail').json()['total']==buyer.get('/api/mail').json()['total']==1
    assert status(store)=='sold'
