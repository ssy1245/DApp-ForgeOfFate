"""Trusted finalized-event adapter and restartable UTC staking reward settlement.

No HTTP ingress. The future staking log decoder must verify chain/deployment,
canonical hashes and finality before calling apply_finalized_batch. Caller owns
one Store.connection transaction for each batch. NFT ownership is not staking.
"""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone

from .mailbox import MAX_SAFE_COINS, deliver_reward

DAY = 86400


def migrate_staking(db):
    statements = [
        '''CREATE TABLE IF NOT EXISTS staking_listener(
            id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL, source TEXT NOT NULL,
            state TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS staking_sources(
            source TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, contract TEXT NOT NULL,
            deployment TEXT NOT NULL, daily_coins INTEGER NOT NULL,
            scanned_block INTEGER NOT NULL, scanned_hash TEXT NOT NULL, confirmed_at INTEGER NOT NULL,
            settled_until INTEGER NOT NULL, last_reward_at INTEGER)''',
        '''CREATE TABLE IF NOT EXISTS staking_batches(
            source TEXT NOT NULL, end_block INTEGER NOT NULL, digest TEXT NOT NULL,
            PRIMARY KEY(source,end_block))''',
        '''CREATE TABLE IF NOT EXISTS staking_positions(
            source TEXT NOT NULL, position_id TEXT NOT NULL, token_id TEXT NOT NULL,
            wallet TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
            daily_coins INTEGER NOT NULL, settled_until INTEGER NOT NULL,
            remainder INTEGER NOT NULL DEFAULT 0, total_coins TEXT NOT NULL DEFAULT '0',
            last_reward_at INTEGER, PRIMARY KEY(source,position_id))''',
        '''CREATE UNIQUE INDEX IF NOT EXISTS staking_active_token
            ON staking_positions(source,token_id) WHERE ended_at IS NULL''',
        '''CREATE TABLE IF NOT EXISTS staking_daily_rewards(
            source TEXT NOT NULL, wallet TEXT NOT NULL, reward_day TEXT NOT NULL,
            coins INTEGER NOT NULL, owner TEXT, mail_id TEXT, created_at INTEGER NOT NULL,
            PRIMARY KEY(source,wallet,reward_day))''',
    ]
    for statement in statements:
        db.execute(statement)


def integer(value, minimum=0):
    if type(value) is not int or not minimum <= value <= MAX_SAFE_COINS:
        raise ValueError('Invalid staking integer')
    return value


def address(value):
    if not isinstance(value, str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', value) or int(value, 16) == 0:
        raise ValueError('Invalid staking address')
    return value.lower()


def identifier(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        raise ValueError('Invalid staking identifier')
    return value


def block_hash(value):
    if not isinstance(value, str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', value):
        raise ValueError('Invalid block hash')
    return value.lower()


def register_source(db, *, chain_id, contract, deployment, start_block, start_hash, start_time, daily_coins=None):
    """Anchor at the verified block BEFORE deployment; immutable reward rule v1.

    No default economic rate: the operator must explicitly configure it. Existing
    sources reject changed rates, so a restart cannot reprice offline earnings.
    """
    integer(chain_id, 1); contract = address(contract); identifier(deployment)
    integer(start_block); start_hash = block_hash(start_hash); integer(start_time)
    if daily_coins is None:
        daily_coins = int(os.environ.get('FORGE_STAKING_COINS_PER_DAY', '0'))
    integer(daily_coins, 1)
    source = hashlib.sha256(json.dumps([chain_id, contract, deployment]).encode()).hexdigest()
    old = db.execute('SELECT * FROM staking_sources WHERE source=?', (source,)).fetchone()
    if old:
        if old['daily_coins'] != daily_coins:
            raise ValueError('Existing staking reward rate is immutable; do not reprice history')
        return source
    db.execute('INSERT INTO staking_sources VALUES(?,?,?,?,?,?,?,?,?,NULL)',
               (source, chain_id, contract, deployment, daily_coins, start_block, start_hash,
                start_time, start_time // DAY * DAY))
    return source


def apply_finalized_batch(db, source, *, start_block, parent_hash, end_block, end_hash, end_time, events):
    """Persist a contiguous COMPLETE finalized log range, including empty ranges.

    events: kind(stake/unstake), block, log_index, timestamp, position_id,
    wallet; stake additionally token_id. IDs must identify each locking session.
    A decoder must never advance this boundary before decoding ALL staking logs.
    """
    integer(start_block); integer(end_block); integer(end_time)
    parent_hash = block_hash(parent_hash); end_hash = block_hash(end_hash)
    payload = [start_block, parent_hash, end_block, end_hash, end_time, events]
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    prior = db.execute('SELECT digest FROM staking_batches WHERE source=? AND end_block=?', (source, end_block)).fetchone()
    if prior:
        if prior['digest'] != digest:
            raise ValueError('Conflicting finalized staking batch')
        return
    saved = db.execute('SELECT * FROM staking_sources WHERE source=?', (source,)).fetchone()
    if not saved or start_block != saved['scanned_block'] + 1 or parent_hash != saved['scanned_hash']:
        raise ValueError('Missing or conflicting staking history')
    if end_block < start_block or end_time < saved['confirmed_at']:
        raise ValueError('Staking boundary moved backwards')
    previous_order, previous_time = (-1, -1), saved['confirmed_at']
    for event in events:
        block, log = integer(event['block']), integer(event['log_index'])
        timestamp = integer(event['timestamp']); position = identifier(event['position_id'])
        wallet = address(event['wallet'])
        if not start_block <= block <= end_block or (block, log) <= previous_order or not previous_time <= timestamp <= end_time:
            raise ValueError('Unordered or out-of-range staking event')
        previous_order, previous_time = (block, log), timestamp
        if event['kind'] == 'stake':
            token = identifier(event['token_id'])
            db.execute('''INSERT INTO staking_positions(source,position_id,token_id,wallet,started_at,daily_coins,settled_until)
                          VALUES(?,?,?,?,?,?,?)''', (source, position, token, wallet, timestamp, saved['daily_coins'], timestamp))
        elif event['kind'] == 'unstake':
            row = db.execute('SELECT * FROM staking_positions WHERE source=? AND position_id=?', (source, position)).fetchone()
            if (not row or row['wallet'] != wallet or row['ended_at'] is not None or timestamp < row['started_at']
                    or ('token_id' in event and event['token_id'] != row['token_id'])):
                raise ValueError('Unknown, duplicate or invalid staking withdrawal')
            db.execute('UPDATE staking_positions SET ended_at=? WHERE source=? AND position_id=?', (timestamp, source, position))
        else:
            raise ValueError('Unknown staking event')
    db.execute('INSERT INTO staking_batches VALUES(?,?,?)', (source, end_block, digest))
    db.execute('UPDATE staking_sources SET scanned_block=?,scanned_hash=?,confirmed_at=? WHERE source=?',
               (end_block, end_hash, end_time, source))


def deliver_pending(db, source, limit=500):
    # The binding is immutable today. Unbound wallets remain durable pending rows.
    rows = db.execute('''SELECT r.*,a.game_address FROM staking_daily_rewards r
        JOIN wallet_bindings w ON w.wallet_address=r.wallet COLLATE NOCASE AND w.verified_at IS NOT NULL
        JOIN accounts a ON a.id=w.account_id
        WHERE r.source=? AND r.mail_id IS NULL ORDER BY r.reward_day,r.wallet LIMIT ?''', (source, limit)).fetchall()
    for row in rows:
        mail = deliver_reward(db, row['game_address'], kind='staking_daily', reward_day=row['reward_day'],
                              source_key='staking:' + source, coins=row['coins'])
        db.execute('UPDATE staking_daily_rewards SET owner=?,mail_id=? WHERE source=? AND wallet=? AND reward_day=?',
                   (row['game_address'], mail, source, row['wallet'], row['reward_day']))
    return len(rows)


def settle_source(db, source, max_days=30):
    """Integer, prorated UTC days; mail + progress share caller's transaction.

    Only complete UTC days at/before the fully ingested finalized boundary are
    eligible. Partial coin remainders persist for each position, including after
    exit for audit (not paid or transferred to a different locking session).
    """
    integer(max_days, 1)
    saved = db.execute('SELECT * FROM staking_sources WHERE source=?', (source,)).fetchone()
    if not saved:
        raise ValueError('Unknown staking source')
    boundary = saved['confirmed_at'] // DAY * DAY
    day = saved['settled_until']; processed = 0
    now = int(time.time())
    while day < boundary and processed < max_days:
        end = day + DAY
        positions = db.execute('''SELECT * FROM staking_positions WHERE source=? AND started_at<?
            AND settled_until<? AND (ended_at IS NULL OR ended_at>settled_until)''', (source, end, end)).fetchall()
        amounts = {}
        for position in positions:
            begin = max(day, position['started_at'], position['settled_until'])
            stop = min(end, position['ended_at'] if position['ended_at'] is not None else end)
            seconds = max(0, stop - begin)
            coins, remainder = divmod(seconds * position['daily_coins'] + position['remainder'], DAY)
            wallet = position['wallet']; amounts[wallet] = amounts.get(wallet, 0) + coins
            if amounts[wallet] > MAX_SAFE_COINS:
                raise ValueError('Daily staking reward exceeds safe coin range; progress retained')
            db.execute('''UPDATE staking_positions SET settled_until=?,remainder=?,total_coins=?,
                last_reward_at=CASE WHEN ?>0 THEN ? ELSE last_reward_at END WHERE source=? AND position_id=?''',
                (stop, remainder, str(int(position['total_coins']) + coins), coins, now, source, position['position_id']))
        reward_day = datetime.fromtimestamp(day, timezone.utc).date().isoformat()
        for wallet, coins in amounts.items():
            if coins:
                db.execute('INSERT INTO staking_daily_rewards VALUES(?,?,?,?,NULL,NULL,?)', (source, wallet, reward_day, coins, now))
        deliver_pending(db, source)
        db.execute('''UPDATE staking_sources SET settled_until=?,
            last_reward_at=CASE WHEN ? THEN ? ELSE last_reward_at END WHERE source=?''',
            (end, any(amounts.values()), now, source))
        day = end; processed += 1
    delivered = deliver_pending(db, source)
    return {'days': processed, 'settled_until': day, 'caught_up': day >= boundary and delivered < 500}


def settle_all(store):
    # Small transactions let account operations run between catch-up batches.
    with store.connection() as db:
        sources = [row['source'] for row in db.execute('SELECT source FROM staking_sources')]
    caught_up = True
    for source in sources:
        with store.connection() as db:
            result = settle_source(db, source)
            caught_up = result['caught_up'] and caught_up
    return caught_up
