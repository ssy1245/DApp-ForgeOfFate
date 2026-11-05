"""Cross-process NFT purchase reservations; callers hold Store.connection().

Only preparation leases expire. Once wallet submission starts, an unknown or
expired transaction task is not proof of failure and must not unlock the NFT.
"""
import secrets
import time

from fastapi import HTTPException

PREPARATION_SECONDS = 300


def migrate_purchase_locks(db):
    db.execute('''CREATE TABLE IF NOT EXISTS nft_purchase_locks(
        id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, contract TEXT NOT NULL,
        deployment TEXT NOT NULL, token_id TEXT NOT NULL, buyer TEXT NOT NULL,
        seller TEXT NOT NULL, price_wei TEXT NOT NULL, state TEXT NOT NULL,
        expires_at REAL NOT NULL, task_id TEXT, tx_hash TEXT,
        validated INTEGER NOT NULL DEFAULT 0)''')
    db.execute('''CREATE UNIQUE INDEX IF NOT EXISTS nft_purchase_active
        ON nft_purchase_locks(chain_id,contract,deployment,token_id)
        WHERE state IN ('reserved','submitting','pending')''')
    db.execute('''CREATE UNIQUE INDEX IF NOT EXISTS nft_purchase_task
        ON nft_purchase_locks(task_id) WHERE task_id IS NOT NULL''')


def reserve(db, info, token_id, buyer, seller, price, now=None):
    now = time.time() if now is None else now
    db.execute("UPDATE nft_purchase_locks SET state='expired' WHERE state='reserved' AND expires_at<=?", (now,))
    scope = (info['chainId'], info['address'].lower(), info['deploymentId'].lower(), token_id)
    if db.execute('''SELECT 1 FROM nft_purchase_locks WHERE chain_id=? AND contract=? AND deployment=?
        AND token_id=? AND state IN ('reserved','submitting','pending')''', scope).fetchone():
        raise HTTPException(409, '该 NFT 正在被购买，请等待交易完成后刷新。')
    lock_id, expires = secrets.token_hex(32), now + PREPARATION_SECONDS
    db.execute('''INSERT INTO nft_purchase_locks(id,chain_id,contract,deployment,token_id,buyer,
        seller,price_wei,state,expires_at) VALUES(?,?,?,?,?,?,?,?,'reserved',?)''',
        (lock_id, *scope, buyer.lower(), seller.lower(), price, expires))
    return {'id': lock_id, 'expiresAt': expires}


def owned_lock(db, lock_id, info, buyer):
    row = db.execute('''SELECT * FROM nft_purchase_locks WHERE id=? AND chain_id=? AND contract=?
        AND deployment=? AND buyer=?''',
        (lock_id, info['chainId'], info['address'].lower(), info['deploymentId'].lower(), buyer.lower())).fetchone()
    if row is None:
        raise HTTPException(404, '找不到属于当前钱包和部署的购买锁。')
    return dict(row)


def begin(db, row, now=None):
    now = time.time() if now is None else now
    if row['state'] != 'reserved' or row['expires_at'] <= now:
        raise HTTPException(409, '购买预留已失效，请刷新后重新购买。')
    db.execute("UPDATE nft_purchase_locks SET state='submitting' WHERE id=?", (row['id'],))


def release(db, row):
    # Frontend calls this only before send, or after explicit wallet rejection.
    if row['tx_hash']:
        raise HTTPException(409, '购买交易已提交，请等待最终确认。')
    db.execute("UPDATE nft_purchase_locks SET state='released' WHERE id=? AND state IN ('reserved','submitting')", (row['id'],))


def attach(db, row, tx_hash, task_id):
    if row['tx_hash'] == tx_hash and row['task_id'] == task_id:
        return
    if row['state'] != 'submitting' or row['tx_hash']:
        raise HTTPException(409, '购买锁状态已变化，请核对原交易。')
    if db.execute('SELECT 1 FROM nft_purchase_locks WHERE task_id=? AND id!=?', (task_id, row['id'])).fetchone():
        raise HTTPException(409, '交易与购买预留不匹配，请核对原交易。')
    db.execute("UPDATE nft_purchase_locks SET state='pending',tx_hash=?,task_id=? WHERE id=?",
               (tx_hash, task_id, row['id']))
    # A hash may already have a completed legacy task. Recheck this new
    # reservation's calldata before allowing that result to release its lock.
    db.execute("UPDATE chain_tasks SET state='pending' WHERE id=? AND state='done'", (task_id,))


def finish(db, task_id):
    """Only a finalized, validated transaction task may release its reservation."""
    db.execute("UPDATE nft_purchase_locks SET state='released' WHERE task_id=? AND state='pending' AND validated=1", (task_id,))
