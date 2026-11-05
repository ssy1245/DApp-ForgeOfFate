"""Durable, on-demand chain work. Idle workers only read local state.

Requests are hints, never evidence of payment or staking. Existing finalized
event scanners remain the only path that can credit gold or deliver rewards.
"""
import hashlib
import json
import re
import time

from fastapi import HTTPException

INTERVAL = 30
DAY = 86400
FILES = {'nft': 'deployment.json', 'staking': 'staking-deployment.json',
         'recharge': 'recharge-deployment.json'}


def migrate_tasks(db):
    db.execute('''CREATE TABLE IF NOT EXISTS chain_tasks(
        id TEXT PRIMARY KEY, target TEXT NOT NULL, kind TEXT NOT NULL,
        chain_id INTEGER NOT NULL, deployment TEXT NOT NULL, contract TEXT NOT NULL,
        tx_hash TEXT, wallet TEXT, until_time INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'pending', created_at REAL NOT NULL,
        updated_at REAL NOT NULL, expires_at REAL, result TEXT, error TEXT NOT NULL DEFAULT '')''')
    db.execute('CREATE INDEX IF NOT EXISTS chain_tasks_pending ON chain_tasks(target,state)')
    db.execute('''CREATE TABLE IF NOT EXISTS chain_task_targets(
        target TEXT PRIMARY KEY, next_check REAL NOT NULL DEFAULT 0)''')
    db.execute('''CREATE TABLE IF NOT EXISTS chain_worker(
        id INTEGER PRIMARY KEY CHECK(id=1), heartbeat REAL NOT NULL, running INTEGER NOT NULL)''')


def manifest(settings, target):
    from .rpc import NETWORKS
    try:
        info = json.loads((settings.directory / FILES[target]).read_text())
        if (info['chainId'] != NETWORKS[settings.network]['chainId']
                or not re.fullmatch(r'0x[0-9a-fA-F]{40}', info['address'])
                or not re.fullmatch(r'0x[0-9a-fA-F]{64}', info['deploymentId'])):
            raise ValueError()
        return info
    except Exception:
        raise HTTPException(503, '当前合约部署配置不可用。') from None


def enqueue(db, target, info, *, kind='sync', tx_hash=None, wallet=None, until_time=0, now=None):
    now = time.time() if now is None else now
    if tx_hash is not None and not re.fullmatch(r'0x[0-9a-fA-F]{64}', tx_hash):
        raise HTTPException(400, '交易哈希格式无效。')
    tx_hash = tx_hash.lower() if tx_hash else None
    wallet = wallet.lower() if wallet else None
    identity = [target, info['chainId'], info['address'].lower(), info['deploymentId'].lower(), kind,
                tx_hash or str(until_time)]
    key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
    old = db.execute('SELECT * FROM chain_tasks WHERE id=?', (key,)).fetchone()
    if old:
        if tx_hash and old['wallet'] != wallet:
            raise HTTPException(409, '该交易已由另一钱包提交检查。')
        # A page refresh never restarts the confirmation timer or resurrects an
        # expired transaction. A manual sync can still discover its later logs.
        if kind == 'sync' and old['state'] == 'done' and now - old['updated_at'] >= INTERVAL:
            db.execute("UPDATE chain_tasks SET state='pending',updated_at=?,error='' WHERE id=?", (now, key))
        return key
    if tx_hash and db.execute("SELECT COUNT(*) FROM chain_tasks WHERE wallet=? AND state='pending' AND kind='transaction'",
                              (wallet,)).fetchone()[0] >= 10:
        raise HTTPException(429, '待确认交易过多，请先处理已有交易。')
    db.execute('''INSERT INTO chain_tasks(id,target,kind,chain_id,deployment,contract,tx_hash,wallet,
        until_time,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
        (key,target,kind,info['chainId'],info['deploymentId'],info['address'].lower(),tx_hash,wallet,
         until_time,now,now,now + DAY if tx_hash else None))
    return key


def task_receipt(store, settings, target, tx_hash):
    """None means a legacy/unregistered request; otherwise no RPC is needed."""
    with store.connection() as db:
        rows = db.execute('SELECT * FROM chain_tasks WHERE target=? AND tx_hash=?', (target,tx_hash.lower())).fetchall()
    if not rows:
        return None
    info = manifest(settings, target)
    row = next((r for r in rows if (r['chain_id'],r['deployment'],r['contract']) ==
                (info['chainId'],info['deploymentId'],info['address'].lower())), None)
    if row is None:
        raise HTTPException(409, '交易所属部署已变化，请核对原部署记录。')
    if row['state'] in ('rejected', 'halted'):
        raise HTTPException(409, row['error'])
    result = json.loads(row['result']) if row['result'] else {
        'chainId': info['chainId'], 'deploymentId': info['deploymentId'], 'state': 'pending', 'receipt': None,
        'confirmationPolicy': 'finalized' if settings.network == 'sepolia' else 'local-latest'}
    return {**result, 'taskState': row['state'], 'checkInterval': INTERVAL,
            'taskMessage': row['error']}


def worker_status(db, now=None):
    now = time.time() if now is None else now
    worker = db.execute('SELECT * FROM chain_worker WHERE id=1').fetchone()
    pending = db.execute("SELECT COUNT(*) FROM chain_tasks WHERE state='pending'").fetchone()[0]
    return {'mode': 'on-demand', 'checkInterval': INTERVAL, 'pendingTasks': pending,
            'running': bool(worker and worker['running'] and now - worker['heartbeat'] < 90)}


class TaskWorker:
    def __init__(self, store, settings, indexers, readers, clock=time.time):
        self.store, self.settings, self.indexers, self.readers, self.clock = store, settings, indexers, readers, clock

    def schedule(self, now):
        # Bootstrap each deployment once, including manifests saved while the
        # process is running. Restarts do not create another bootstrap request.
        for target in FILES:
            if not (self.settings.directory / FILES[target]).exists():
                continue
            try:
                info = manifest(self.settings, target)
            except HTTPException:
                continue
            with self.store.connection() as db:
                enqueue(db, target, info, kind='bootstrap', now=now)
        day = int(now) // DAY * DAY
        with self.store.connection() as db:
            sources = db.execute('''SELECT DISTINCT s.* FROM staking_sources s JOIN staking_positions p ON p.source=s.source
                WHERE p.started_at<? AND (p.ended_at IS NULL OR p.ended_at>p.settled_until)
                AND s.settled_until<?''', (day, day)).fetchall()
            for source in sources:
                info = {'chainId':source['chain_id'], 'address':source['contract'], 'deploymentId':source['deployment']}
                enqueue(db, 'staking', info, kind='daily', until_time=day, now=now)

    def finish(self, job, state='done', error=''):
        from backend.purchase_locks import finish as finish_purchase
        with self.store.connection() as db:
            if state == 'done' and db.execute("SELECT 1 FROM nft_purchase_locks WHERE task_id=? AND state='pending' AND validated=0", (job['id'],)).fetchone():
                # A reservation can attach while this worker is reading a
                # previously registered hash. Validate it on the next tick.
                return
            db.execute('UPDATE chain_tasks SET state=?,updated_at=?,error=? WHERE id=?',
                       (state,self.clock(),error,job['id']))
            if state == 'done' and job['tx_hash']:
                finish_purchase(db, job['id'])

    def tick(self):
        now = self.clock()
        self.schedule(now)
        with self.store.connection() as db:
            db.execute('INSERT OR REPLACE INTO chain_worker VALUES(1,?,1)', (now,))
            db.execute("UPDATE chain_tasks SET state='expired',updated_at=?,error=? WHERE state='pending' AND expires_at<=?",
                       (now,'自动检查已暂停；请核对钱包交易，并用刷新状态补同步，不要重复付款。',now))
        for target in FILES:
            with self.store.connection() as db:
                jobs = [dict(row) for row in db.execute("SELECT * FROM chain_tasks WHERE target=? AND state='pending' ORDER BY created_at", (target,))]
                if not jobs:
                    continue
                db.execute('INSERT OR IGNORE INTO chain_task_targets(target) VALUES(?)', (target,))
                due = db.execute('SELECT next_check FROM chain_task_targets WHERE target=?', (target,)).fetchone()[0]
                if now < due:
                    continue
                # Reserve before any network call; a process restart and more
                # HTTP requests cannot bypass the persisted 30-second limit.
                db.execute('UPDATE chain_task_targets SET next_check=? WHERE target=?', (now + INTERVAL,target))
            self.process(target, jobs)

    def process(self, target, jobs):
        from .indexer import IndexHalt
        try:
            info = manifest(self.settings, target)
            eligible = []
            for job in jobs:
                if (job['chain_id'],job['deployment'],job['contract']) != (info['chainId'],info['deploymentId'],info['address'].lower()):
                    self.finish(job, 'halted', '任务属于另一份部署，已保留记录并停止检查。')
                    continue
                if not job['tx_hash']:
                    eligible.append(job)
                    continue
                try:
                    if target == 'nft':
                        with self.store.connection() as db:
                            purchase = db.execute("SELECT * FROM nft_purchase_locks WHERE task_id=? AND state='pending' AND validated=0", (job['id'],)).fetchone()
                        if purchase:
                            # Register the hash durably before doing RPC. A
                            # closed browser or temporarily invisible mempool
                            # transaction cannot strand an untracked purchase.
                            self.readers[target].validate_purchase(job['tx_hash'], dict(purchase))
                            with self.store.connection() as db:
                                db.execute('UPDATE nft_purchase_locks SET validated=1 WHERE id=?', (purchase['id'],))
                    result = json.loads(job['result']) if job['result'] else None
                    if not result or result['state'] not in ('confirmed','failed'):
                        result = self.readers[target].receipt(job['tx_hash'])
                    if result['chainId'] != job['chain_id'] or result['deploymentId'] != job['deployment']:
                        raise IndexHalt('交易回执所属部署不匹配。')
                    receipt = result.get('receipt')
                    if receipt and receipt['from'].lower() != job['wallet']:
                        self.finish(job, 'rejected', '交易发送钱包与绑定钱包不一致。')
                        continue
                    with self.store.connection() as db:
                        db.execute('UPDATE chain_tasks SET result=?,updated_at=?,error=\'\' WHERE id=?',
                                   (json.dumps(result),self.clock(),job['id']))
                    if result['state'] == 'failed':
                        self.finish(job)
                    elif result['state'] == 'confirmed':
                        eligible.append(job)
                except HTTPException as error:
                    if error.status_code in (400, 409):
                        self.finish(job, 'rejected', error.detail)
                    else:
                        raise
            if not eligible:
                return
            # Catch up through saved block ranges. These are historical pages,
            # not repeated polling for a new receipt. Bound work per wake-up.
            caught_up = False
            for _ in range(20):
                if self.indexers[target].tick():
                    caught_up = True
                    break
            if not caught_up:
                return
            with self.store.connection() as db:
                if target == 'nft':
                    scan = db.execute('SELECT confirmed_block FROM chain_scan WHERE id=1').fetchone()
                    ready = bool(scan and scan[0] is not None and scan[0] >= info['deploymentBlock'])
                    settled = 0
                elif target == 'staking':
                    source = db.execute('SELECT settled_until FROM staking_sources WHERE chain_id=? AND contract=? COLLATE NOCASE AND deployment=?',
                                        (info['chainId'],info['address'],info['deploymentId'])).fetchone()
                    ready, settled = bool(source), source[0] if source else 0
                else:
                    ready = bool(db.execute("SELECT 1 FROM recharge_sources WHERE state='ready' AND chain_id=? AND contract=? COLLATE NOCASE AND deployment=?",
                                           (info['chainId'],info['address'],info['deploymentId'])).fetchone())
                    settled = 0
            if ready:
                for job in eligible:
                    if job['kind'] != 'daily' or settled >= job['until_time']:
                        self.finish(job)
        except Exception as error:
            halted = isinstance(error, IndexHalt)
            message = str(error) if halted else '链上检查暂时失败，进度已保存，30 秒后重试。'
            with self.store.connection() as db:
                db.execute("UPDATE chain_tasks SET state=?,error=?,updated_at=? WHERE target=? AND state='pending'",
                           ('halted' if halted else 'pending',message,self.clock(),target))
