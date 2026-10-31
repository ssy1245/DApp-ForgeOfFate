"""Account-owned reward mail. Call delivery only from trusted server code."""
import json
import time
import uuid
from datetime import date

from fastapi import HTTPException

# Existing game balances travel as JavaScript numbers. Never round or discard a reward.
MAX_SAFE_COINS = 2**53 - 1


def migrate_mailbox(db):
    db.execute('''CREATE TABLE IF NOT EXISTS reward_mail(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('staking_daily','test')),
        reward_day TEXT NOT NULL, source_key TEXT NOT NULL,
        coins INTEGER NOT NULL CHECK(typeof(coins)='integer' AND coins>0 AND coins<=9007199254740991),
        created_at INTEGER NOT NULL, read_at INTEGER, claimed_at INTEGER,
        UNIQUE(owner,kind,source_key,reward_day))''')
    db.execute('CREATE INDEX IF NOT EXISTS reward_mail_inbox ON reward_mail(owner,claimed_at,reward_day DESC,created_at DESC)')
    db.execute('''CREATE TABLE IF NOT EXISTS reward_mail_claims(
        mail_id TEXT PRIMARY KEY, owner TEXT NOT NULL, coins INTEGER NOT NULL,
        balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, claimed_at INTEGER NOT NULL)''')

    db.execute("""CREATE TABLE IF NOT EXISTS notice_mail(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, source_key TEXT NOT NULL,
        payload TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER, dismissed_at INTEGER,
        UNIQUE(owner,source_key))""")
    db.execute('CREATE INDEX IF NOT EXISTS notice_mail_inbox ON notice_mail(owner,dismissed_at,created_at DESC)')


def deliver_notice(db, owner, *, source_key, payload, created_at):
    require_account(db, owner)
    encoded = json.dumps(payload, sort_keys=True)
    prior = db.execute('SELECT id,payload FROM notice_mail WHERE owner=? AND source_key=?', (owner,source_key)).fetchone()
    if prior:
        if prior['payload'] != encoded:
            raise ValueError('Conflicting sale notification')
        return prior['id']
    mail_id = str(uuid.uuid4())
    db.execute('INSERT INTO notice_mail(id,owner,source_key,payload,created_at) VALUES(?,?,?,?,?)',
               (mail_id,owner,source_key,encoded,created_at))
    return mail_id


def dismiss_notice(db, owner, mail_id):
    require_account(db, owner)
    row = db.execute('SELECT id FROM notice_mail WHERE id=? AND owner=?', (mail_id,owner)).fetchone()
    if not row:
        raise HTTPException(404, '找不到属于当前账号的通知邮件。')
    db.execute('UPDATE notice_mail SET read_at=COALESCE(read_at,?),dismissed_at=COALESCE(dismissed_at,?) WHERE id=?',
               (int(time.time()),int(time.time()),mail_id))
    return {'message': '通知邮件已删除，成交记录仍保留。'}


def require_account(db, owner):
    if not db.execute('SELECT 1 FROM accounts WHERE game_address=?', (owner,)).fetchone():
        raise HTTPException(403, '请先登录游戏账号，再查看奖励邮箱。')


def deliver_reward(db, owner, *, kind, reward_day, source_key, coins):
    """One completed daily settlement per account/source/day; caller owns transaction.

    Staking workers must aggregate the day's finalized positions and commit
    their settlement cursor together with this call. A replay cannot change an amount,
    re-create a claimed mail, or credit coins. There is no public delivery API.
    """
    require_account(db, owner)
    if kind not in ('staking_daily', 'test') or type(coins) is not int or not 0 < coins <= MAX_SAFE_COINS:
        raise ValueError('Invalid reward')
    if not isinstance(source_key, str) or not 1 <= len(source_key) <= 256:
        raise ValueError('Invalid reward source')
    if not isinstance(reward_day, str) or date.fromisoformat(reward_day).isoformat() != reward_day:
        raise ValueError('Invalid reward day')
    prior = db.execute('SELECT id,coins FROM reward_mail WHERE owner=? AND kind=? AND source_key=? AND reward_day=?',
                       (owner, kind, source_key, reward_day)).fetchone()
    if prior:
        if prior['coins'] != coins:
            raise ValueError('Reward settlement conflicts with existing mail')
        return prior['id']
    mail_id = str(uuid.uuid4())
    db.execute('INSERT INTO reward_mail(id,owner,kind,reward_day,source_key,coins,created_at) VALUES(?,?,?,?,?,?,?)',
               (mail_id, owner, kind, reward_day, source_key, coins, int(time.time())))
    return mail_id


def counts(db, owner):
    rewards = db.execute("""SELECT COUNT(*) AS total,COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread
                        FROM reward_mail WHERE owner=? AND claimed_at IS NULL""", (owner,)).fetchone()
    notices = db.execute("""SELECT COUNT(*) AS total,COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread
                        FROM notice_mail WHERE owner=? AND dismissed_at IS NULL""", (owner,)).fetchone()
    return {'total': rewards['total']+notices['total'], 'unread': rewards['unread']+notices['unread'],
            'rewardCount': rewards['total'], 'noticeCount': notices['total']}


def inbox(db, owner, offset=0, limit=30):
    require_account(db, owner)
    rows = db.execute("""SELECT id,kind,reward_day,coins,created_at,read_at,NULL AS payload FROM reward_mail
                         WHERE owner=? AND claimed_at IS NULL
                         UNION ALL
                         SELECT id,'trade_sold',date(created_at,'unixepoch'),0,created_at,read_at,payload FROM notice_mail
                         WHERE owner=? AND dismissed_at IS NULL
                         ORDER BY reward_day DESC,created_at DESC,id DESC LIMIT ? OFFSET ?""", (owner,owner,limit,offset))
    items = []
    for row in rows:
        item = dict(row)
        payload = item.pop('payload')
        if payload is not None:
            item['trade'] = json.loads(payload)
        items.append(item)
    total_coins = sum(row['coins'] for row in db.execute('SELECT coins FROM reward_mail WHERE owner=? AND claimed_at IS NULL', (owner,)))
    return {'owner': owner, 'items': items, **counts(db, owner),
            'totalCoins': str(total_coins), 'offset': offset, 'limit': limit}


def owned_mail(db, owner, mail_id):
    row = db.execute('SELECT * FROM reward_mail WHERE id=? AND owner=?', (mail_id, owner)).fetchone()
    if not row:
        raise HTTPException(404, '找不到属于当前账号的奖励邮件。')
    return row


def read_mail(db, owner, mail_id):
    require_account(db, owner)
    notice = db.execute('SELECT id FROM notice_mail WHERE id=? AND owner=?', (mail_id,owner)).fetchone()
    if notice:
        db.execute('UPDATE notice_mail SET read_at=COALESCE(read_at,?) WHERE id=?', (int(time.time()),mail_id))
        return {'message': '交易通知已读。'}
    row = owned_mail(db, owner, mail_id)
    if row['claimed_at'] is None:
        db.execute('UPDATE reward_mail SET read_at=COALESCE(read_at,?) WHERE id=?', (int(time.time()), mail_id))
    return {'message': '邮件已读，奖励等待领取。' if row['claimed_at'] is None else '这封邮件的奖励已经领取。'}


def claim_rewards(db, owner, mail_id=None):
    require_account(db, owner)
    if mail_id is not None:
        row = owned_mail(db, owner, mail_id)
        rows = [row] if row['claimed_at'] is None else []
    else:
        rows = db.execute('SELECT * FROM reward_mail WHERE owner=? AND claimed_at IS NULL ORDER BY created_at,id', (owner,)).fetchall()
    total = sum(row['coins'] for row in rows)
    before = db.execute('SELECT coins FROM players WHERE address=?', (owner,)).fetchone()['coins']
    if type(before) is not int or before < 0 or before + total > MAX_SAFE_COINS:
        raise HTTPException(409, '金币余额暂时无法容纳这些奖励，邮件已保留，请先使用部分金币。')
    if rows:
        now, running = int(time.time()), before
        for row in rows:
            after = running + row['coins']
            db.execute('INSERT INTO reward_mail_claims VALUES(?,?,?,?,?,?)', (row['id'], owner, row['coins'], running, after, now))
            db.execute('UPDATE reward_mail SET read_at=COALESCE(read_at,?),claimed_at=? WHERE id=?', (now, now, row['id']))
            running = after
        db.execute('UPDATE players SET coins=? WHERE address=?', (running, owner))
    return {'claimedCount': len(rows), 'coinsAdded': total, 'balance': before + total,
            'message': f'已领取 {len(rows)} 封邮件，共获得 {total} 游戏金币。' if rows else '没有待领取的奖励邮件。'}
