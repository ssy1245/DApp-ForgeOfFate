import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest

from backend.storage import Store
from backend.staking_rewards import (DAY, register_source, apply_finalized_batch, settle_source, settle_all)
from backend.tests.test_cheats import tester
from backend.tests.test_game import post

BASE = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp())
WALLET = '0x' + 'ab' * 20
CONTRACT = '0x' + 'cd' * 20


def hash_(i):
    return '0x' + f'{i:064x}'


def setup(tester, rate=100, bound=True):
    c, owner, _ = tester
    store = c.app.state.store
    with store.connection() as db:
        if bound:
            account = db.execute('SELECT id FROM accounts WHERE game_address=?', (owner,)).fetchone()[0]
            db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)', (account, WALLET, BASE))
        source = register_source(db, chain_id=11155111, contract=CONTRACT, deployment='v1',
                                 start_block=0, start_hash=hash_(0), start_time=BASE, daily_coins=rate)
    return c, store, source


def event(kind='stake', position='p1', token='1', at=0, block=1, log=0, wallet=WALLET):
    return dict(kind=kind, position_id=position, token_id=token, timestamp=BASE+at,
                block=block, log_index=log, wallet=wallet)


def batch(store, source, end, at, events=(), start=None):
    with store.connection() as db:
        previous = db.execute('SELECT scanned_block,scanned_hash FROM staking_sources WHERE source=?', (source,)).fetchone()
        apply_finalized_batch(db, source, start_block=start or previous['scanned_block']+1,
                              parent_hash=previous['scanned_hash'], end_block=end,
                              end_hash=hash_(end), end_time=BASE+at, events=list(events))


def rows(store, table):
    with store.connection() as db:
        return [dict(r) for r in db.execute('SELECT * FROM '+table)]


def test_offline_catchup_prorates_and_stops_at_withdrawal(tester):
    c, store, source = setup(tester)
    batch(store, source, 1, DAY//2, [event(at=DAY//2)])
    assert settle_all(store) and not rows(store, 'reward_mail')
    # Restart after several days: first ingest withdrawal, THEN settle finalized history.
    store = Store(store.path)
    batch(store, source, 3, 5*DAY, [event('unstake', at=2*DAY+DAY//2, block=2)])
    assert settle_all(store)
    mails = rows(store, 'reward_mail')
    assert [m['coins'] for m in mails] == [50,100,50]
    assert [m['reward_day'] for m in mails] == ['2026-10-01','2026-10-02','2026-10-03']
    assert c.get('/api/state').json()['player']['coins'] == 0
    assert post(c, '/mail/claim-all', {}).json()['coinsAdded'] == 200
    for _ in range(3):
        assert settle_all(Store(store.path))
    assert len(rows(store, 'reward_mail')) == 3
    assert post(c, '/mail/claim-all', {}).json()['coinsAdded'] == 0
    position = rows(store, 'staking_positions')[0]
    assert position['settled_until'] == BASE+2*DAY+DAY//2
    assert position['total_coins'] == '200' and position['last_reward_at'] is not None


def test_rounding_remainder_and_finalized_boundary_not_server_clock(tester):
    _, store, source = setup(tester, rate=1)
    batch(store, source, 1, DAY-1, [event(at=DAY//2)])
    settle_all(store)
    assert not rows(store, 'reward_mail')
    batch(store, source, 2, DAY)
    settle_all(store)
    assert not rows(store, 'reward_mail')
    assert rows(store, 'staking_positions')[0]['remainder'] == DAY//2
    batch(store, source, 3, 2*DAY)
    settle_all(store)
    assert [r['coins'] for r in rows(store, 'reward_mail')] == [1]
    batch(store, source, 4, 2*DAY+DAY//2, [event('unstake', at=2*DAY+DAY//2, block=4)])
    settle_all(store)
    assert len(rows(store, 'reward_mail')) == 1  # final partial day still open
    batch(store, source, 5, 3*DAY)
    settle_all(store)
    assert [r['coins'] for r in rows(store, 'reward_mail')] == [1,1]
    assert rows(store, 'staking_positions')[0]['remainder'] == 0


@pytest.mark.parametrize('begin,end,expected', [
    (0,DAY,[('2026-10-01',1000)]),
    (DAY,2*DAY,[('2026-10-02',1000)]),
    (DAY-1,DAY+1,[]),
    (DAY-87,DAY+87,[('2026-10-01',1),('2026-10-02',1)]),
    (0,0,[]),
    (DAY-1,2*DAY,[('2026-10-02',1000)]),
])
def test_utc_midnight_and_one_coin_boundaries_at_live_rate(tester,begin,end,expected):
    _,store,source=setup(tester,rate=1000)
    batch(store,source,2,3*DAY,[event(at=begin),event('unstake',at=end,block=2)])
    assert settle_all(store)
    assert sorted((r['reward_day'],r['coins']) for r in rows(store,'reward_mail'))==expected
    position=rows(store,'staking_positions')[0]
    assert int(position['total_coins'])*DAY+position['remainder']==(end-begin)*1000
    assert position['settled_until']==BASE+end
    assert settle_all(Store(store.path))
    assert sorted((r['reward_day'],r['coins']) for r in rows(store,'reward_mail'))==expected


def test_same_nft_restaked_by_new_owner_pays_each_wallet_only_its_own_time(tester):
    c,store,source=setup(tester,rate=1000)
    other_wallet='0x'+'ef'*20
    with store.connection() as db:
        db.execute("INSERT INTO players(address) VALUES('second-owner')")
        db.execute("INSERT INTO accounts VALUES('second-account','second-name','unused-hash','second-owner',0,'player')")
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',('second-account',other_wallet,BASE))
    token=str(2**255+123)
    batch(store,source,4,3*DAY,[event(token=token),
        event('unstake',token=token,at=DAY//2,block=2),
        event(position='p2',token=token,wallet=other_wallet,at=DAY//2,block=3),
        event('unstake',position='p2',token=token,wallet=other_wallet,at=DAY+DAY//2,block=4)])
    assert settle_all(store)
    rewards=rows(store,'staking_daily_rewards')
    assert sorted((r['wallet'],r['reward_day'],r['coins']) for r in rewards)==sorted([
        (WALLET,'2026-10-01',500),(other_wallet,'2026-10-01',500),(other_wallet,'2026-10-02',500)])
    foreign_mail=next(r['mail_id'] for r in rewards if r['wallet']==other_wallet)
    assert post(c,f'/mail/{foreign_mail}/claim',{}).status_code==404
    assert post(c,'/mail/claim-all',{}).json()['coinsAdded']==500
    assert settle_all(Store(store.path))
    assert post(c,'/mail/claim-all',{}).json()['coinsAdded']==0
    assert len(rows(store,'reward_mail'))==3
    assert all(r['token_id']==token for r in rows(store,'staking_positions'))


def test_multiple_positions_aggregate_and_restaking_has_new_identity(tester):
    _, store, source = setup(tester, rate=100)
    batch(store, source, 4, 2*DAY, [event(),event(position='p2',token='2',log=1),
        event('unstake',at=DAY//2,block=2),event(position='p3',at=DAY,block=3)])
    settle_all(store)
    assert [r['coins'] for r in rows(store, 'reward_mail')] == [150,200]
    assert len(rows(store, 'staking_positions')) == 3


def test_unbound_and_unverified_wallets_keep_rewards_until_verified(tester):
    c, store, source = setup(tester, bound=False)
    batch(store, source, 1, 2*DAY, [event()]); settle_all(store)
    assert not rows(store, 'reward_mail')
    assert len(rows(store, 'staking_daily_rewards')) == 2
    with store.connection() as db:
        account = db.execute('SELECT id FROM accounts').fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,NULL)', (account,WALLET.upper().replace('0X','0x')))
    settle_all(store); assert not rows(store, 'reward_mail')
    with store.connection() as db:
        db.execute('UPDATE wallet_bindings SET verified_at=?', (BASE,))
    settle_all(store); settle_all(store)
    assert len(rows(store, 'reward_mail')) == 2
    assert post(c,'/mail/claim-all',{}).json()['coinsAdded'] == 200


def test_replay_conflicts_gaps_and_atomic_bad_batch(tester):
    _, store, source = setup(tester)
    kwargs = dict(start_block=1,parent_hash=hash_(0),end_block=1,end_hash=hash_(1),end_time=BASE+DAY,events=[event()])
    with store.connection() as db:
        apply_finalized_batch(db, source, **kwargs)
        apply_finalized_batch(db, source, **kwargs)
    assert len(rows(store,'staking_positions')) == 1
    for changes in [dict(end_time=BASE+2*DAY),dict(events=[])]:
        with pytest.raises(ValueError), store.connection() as db:
            apply_finalized_batch(db, source, **(kwargs|changes))
    with pytest.raises(ValueError):
        batch(store,source,3,2*DAY,start=3)
    with pytest.raises(ValueError):
        batch(store,source,2,2*DAY,[event(position='p2',token='2',at=DAY,block=2),
                                  event('unstake',position='missing',at=DAY,block=2,log=1)])
    assert len(rows(store,'staking_positions')) == 1
    assert rows(store,'staking_sources')[0]['scanned_block'] == 1


@pytest.mark.parametrize('table',['staking_positions','staking_daily_rewards','reward_mail','staking_sources'])
def test_settlement_failure_rolls_back_mail_and_progress(tester,table):
    _, store, source = setup(tester)
    batch(store, source, 1, 2*DAY, [event()])
    operation = 'UPDATE' if table in ('staking_positions','staking_sources') else 'INSERT'
    with store.connection() as db:
        db.execute(f"CREATE TRIGGER fail BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT,'test failure'); END")
    with pytest.raises(sqlite3.IntegrityError):
        settle_all(store)
    assert not rows(store,'reward_mail') and not rows(store,'staking_daily_rewards')
    assert rows(store,'staking_sources')[0]['settled_until'] == BASE
    assert rows(store,'staking_positions')[0]['total_coins'] == '0'
    with store.connection() as db: db.execute('DROP TRIGGER fail')
    settle_all(store)
    assert sum(m['coins'] for m in rows(store,'reward_mail')) == 200


def test_concurrent_workers_and_long_downtime_bounded_catchup(tester):
    _, store, source = setup(tester)
    batch(store,source,1,95*DAY,[event()])
    assert not settle_all(store)
    assert len(rows(store,'reward_mail')) == 30
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: settle_all(store), range(16)))
    assert len(rows(store,'reward_mail')) == 95
    assert sum(m['coins'] for m in rows(store,'reward_mail')) == 9500
    assert rows(store,'staking_sources')[0]['settled_until'] == BASE+95*DAY


def test_config_required_immutable_and_other_deployment_isolated(tester,monkeypatch):
    _,store,source=setup(tester)
    args=dict(chain_id=11155111,contract=CONTRACT,deployment='v1',start_block=0,start_hash=hash_(0),start_time=BASE)
    with store.connection() as db:
        assert register_source(db,**args,daily_coins=100)==source
    with pytest.raises(ValueError),store.connection() as db:
        register_source(db,**args,daily_coins=101)
    monkeypatch.delenv('FORGE_STAKING_COINS_PER_DAY',raising=False)
    with pytest.raises(ValueError),store.connection() as db:
        register_source(db,**(args|{'deployment':'v2'}))
    monkeypatch.setenv('FORGE_STAKING_COINS_PER_DAY','77')
    with store.connection() as db:
        other=register_source(db,**(args|{'deployment':'v2'}))
    assert other != source
    batch(store,source,1,DAY,[event()]);batch(store,other,1,DAY,[event()])
    settle_all(store)
    assert sorted(r['coins'] for r in rows(store,'reward_mail')) == [77,100]


def test_fractional_exit_keeps_auditable_remainder_and_zero_length_pays_nothing(tester):
    _,store,source=setup(tester,rate=1)
    batch(store,source,3,2*DAY,[event(),event('unstake',at=DAY//2,block=2),
        event(position='p2',at=DAY,block=3),event('unstake',position='p2',at=DAY,block=3,log=1)])
    settle_all(store)
    assert not rows(store,'reward_mail')
    assert [r['remainder'] for r in rows(store,'staking_positions')] == [DAY//2,0]


@pytest.mark.parametrize('change',[
    {'block':0}, {'timestamp':BASE-1}, {'timestamp':BASE+DAY+1},
    {'wallet':'0x123'}, {'kind':'transfer'}, {'position_id':''}, {'log_index':True},
])
def test_bad_event_does_not_advance_checkpoint(tester,change):
    _,store,source=setup(tester)
    with pytest.raises(ValueError):
        batch(store,source,1,DAY,[event()|change])
    assert rows(store,'staking_sources')[0]['scanned_block']==0
    assert not rows(store,'staking_positions')


def test_wrong_owner_duplicate_token_or_position_rolls_back(tester):
    _,store,source=setup(tester)
    batch(store,source,1,0,[event()])
    for item in [event('unstake',block=2,wallet='0x'+'ee'*20),
                 event(position='p2',block=2),event(token='2',block=2)]:
        with pytest.raises((ValueError,sqlite3.IntegrityError)):
            batch(store,source,2,DAY,[item])
    assert rows(store,'staking_sources')[0]['scanned_block']==1
    assert len(rows(store,'staking_positions'))==1


def test_daily_aggregate_overflow_preserves_progress(tester):
    from backend.mailbox import MAX_SAFE_COINS
    _,store,source=setup(tester,rate=MAX_SAFE_COINS)
    batch(store,source,1,DAY,[event(),event(position='p2',token='2',log=1)])
    with pytest.raises(ValueError):settle_all(store)
    assert rows(store,'staking_sources')[0]['settled_until']==BASE
    assert not rows(store,'reward_mail')
    assert all(r['total_coins']=='0' for r in rows(store,'staking_positions'))


def test_chunking_and_restart_match_single_pass_and_integer_reference(tmp_path):
    import random
    rng=random.Random(456)
    cases=[(rng.randrange(0,4*DAY),rng.randrange(4*DAY,9*DAY)) for _ in range(30)]
    events=[]
    for i,(begin,end) in enumerate(cases):
        events.extend([event(position=str(i),token=str(i),at=begin),
                       event('unstake',position=str(i),token=str(i),at=end)])
    events.sort(key=lambda e:e['timestamp'])
    for i,item in enumerate(events):item['block']=i+1
    def run(chunked):
        store=Store(str(tmp_path/('chunked.sqlite3' if chunked else 'once.sqlite3')))
        with store.connection() as db:
            db.execute("INSERT INTO players(address) VALUES('owner')")
            db.execute("INSERT INTO accounts VALUES('account','name','hash','owner',0,'player')")
            db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',('account',WALLET,BASE))
            source=register_source(db,chain_id=1,contract=CONTRACT,deployment='v1',start_block=0,
                                   start_hash=hash_(0),start_time=BASE,daily_coins=137)
        if chunked:
            for item in events:
                batch(store,source,item['block'],item['timestamp']-BASE,[item])
                settle_all(store)
                store=Store(store.path)
        else:
            batch(store,source,len(events),events[-1]['timestamp']-BASE,events)
        batch(store,source,len(events)+1,10*DAY)
        settle_all(store)
        return sorted((r['reward_day'],r['coins']) for r in rows(store,'reward_mail')),rows(store,'staking_positions')
    incremental,positions=run(True)
    once,_=run(False)
    assert incremental==once
    assert sum(coins for _,coins in once)==sum((end-begin)*137//DAY for begin,end in cases)
    assert all(int(p['total_coins'])*DAY+p['remainder']==(p['ended_at']-p['started_at'])*137 for p in positions)


def test_indexer_tick_automatically_catches_up_registered_rewards(tester):
    from chain.tests.test_indexer import FakeSource
    from chain.server.indexer import Indexer, IndexFailure
    _,store,source=setup(tester)
    batch(store,source,1,65*DAY,[event()])
    reader=FakeSource()
    indexer=Indexer(store,reader)
    # A failed chain read must not optimistically accrue to the machine clock.
    original=reader.boundary
    reader.boundary=lambda: (_ for _ in ()).throw(RuntimeError('offline'))
    with pytest.raises(IndexFailure):indexer.tick()
    assert not rows(store,'reward_mail')
    reader.boundary=original
    assert not indexer.tick()  # 30 days
    assert not indexer.tick()  # 30 more
    assert indexer.tick()      # last 5
    assert len(rows(store,'reward_mail'))==65
    assert indexer.tick()
    assert len(rows(store,'reward_mail'))==65
