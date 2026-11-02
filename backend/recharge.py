"""Finalized test-ETH receipts, integer conversion, and atomic account credit."""
import hashlib
import json
import os
import time

from .mailbox import MAX_SAFE_COINS
from .staking_rewards import address, block_hash, integer


def rate():
    wei = int(os.getenv('FORGE_RECHARGE_WEI_PER_UNIT', '10000000000000000'))
    coins = int(os.getenv('FORGE_RECHARGE_COINS_PER_UNIT', '10000'))
    if not 0 < wei < 2**256 or not 0 < coins <= MAX_SAFE_COINS:
        raise ValueError('Invalid recharge rate')
    return wei, coins


def migrate_recharge(db):
    db.execute('''CREATE TABLE IF NOT EXISTS recharge_sources(
        source TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, chain_id INTEGER NOT NULL,
        contract TEXT NOT NULL, deployment TEXT NOT NULL, wei_per_unit TEXT NOT NULL,
        coins_per_unit INTEGER NOT NULL, scanned_block INTEGER NOT NULL, scanned_hash TEXT NOT NULL,
        state TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS recharge_deposits(
        source TEXT NOT NULL, deposit_id TEXT NOT NULL, wallet TEXT NOT NULL,
        amount_wei TEXT NOT NULL, coins TEXT NOT NULL, remainder TEXT NOT NULL,
        tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL, block_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL, owner TEXT, credited_at INTEGER,
        balance_before INTEGER, balance_after INTEGER, PRIMARY KEY(source,deposit_id),
        UNIQUE(source,block_hash,log_index))''')
    db.execute('''CREATE TABLE IF NOT EXISTS recharge_remainders(
        source TEXT NOT NULL, wallet TEXT NOT NULL, remainder TEXT NOT NULL,
        PRIMARY KEY(source,wallet))''')


def register_source(db, manifest, anchor, conversion=None):
    wei,coins = conversion or rate()
    if not 0 < wei < 2**256 or not 0 < coins <= MAX_SAFE_COINS:
        raise ValueError('Invalid recharge rate')
    fingerprint=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()
    source=hashlib.sha256(json.dumps([manifest['chainId'],manifest['address'].lower(),manifest['deploymentId']]).encode()).hexdigest()
    rows=db.execute('SELECT * FROM recharge_sources').fetchall()
    if rows:
        old=next((r for r in rows if r['source']==source),None)
        if not old or old['fingerprint']!=fingerprint or (int(old['wei_per_unit']),old['coins_per_unit'])!=(wei,coins):
            raise ValueError('Recharge deployment or conversion rate changed; preserve history')
        return source
    db.execute('INSERT INTO recharge_sources VALUES(?,?,?,?,?,?,?,?,?,\'syncing\',\'\',?)',
        (source,fingerprint,manifest['chainId'],address(manifest['address']),manifest['deploymentId'],
         str(wei),coins,anchor['number'],block_hash(anchor['hash']),int(time.time())))
    return source


def record_deposit(db, source, event):
    saved=db.execute('SELECT * FROM recharge_sources WHERE source=?',(source,)).fetchone()
    if not saved: raise ValueError('Unknown recharge source')
    deposit_id,amount=int(event['deposit_id']),int(event['amount_wei'])
    if not 0 < deposit_id < 2**256 or not 0 < amount < 2**256:
        raise ValueError('Invalid recharge amount or identity')
    wallet=address(event['wallet']);tx=block_hash(event['tx_hash']);block=integer(event['block_number']);log=integer(event['log_index'])
    canonical=block_hash(event['block_hash'])
    prior=db.execute('SELECT * FROM recharge_deposits WHERE source=? AND deposit_id=?',(source,str(deposit_id))).fetchone()
    identity=(wallet,str(amount),tx,block,canonical,log)
    if prior:
        if tuple(prior[k] for k in ['wallet','amount_wei','tx_hash','block_number','block_hash','log_index'])!=identity:
            raise ValueError('Conflicting recharge event')
        return
    # Carry sub-coin fractions per wallet, independent of request splitting or restarts.
    old=db.execute('SELECT remainder FROM recharge_remainders WHERE source=? AND wallet=?',(source,wallet)).fetchone()
    coins,remainder=divmod(amount*saved['coins_per_unit']+(int(old['remainder']) if old else 0),int(saved['wei_per_unit']))
    db.execute('INSERT INTO recharge_deposits VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)',
        (source,str(deposit_id),wallet,str(amount),str(coins),str(remainder),tx,block,canonical,log))
    db.execute('INSERT INTO recharge_remainders VALUES(?,?,?) ON CONFLICT(source,wallet) DO UPDATE SET remainder=excluded.remainder',
        (source,wallet,str(remainder)))


def credit_pending(db, source, limit=500):
    rows=db.execute('''SELECT d.*,a.game_address FROM recharge_deposits d
        JOIN wallet_bindings w ON w.wallet_address=d.wallet COLLATE NOCASE AND w.verified_at IS NOT NULL
        JOIN accounts a ON a.id=w.account_id JOIN players p ON p.address=a.game_address
        WHERE d.source=? AND d.credited_at IS NULL AND length(d.coins)<=16
        AND typeof(p.coins)='integer' AND p.coins>=0 AND CAST(d.coins AS INTEGER)<=?-p.coins
        ORDER BY d.block_number,d.log_index LIMIT ?''',(source,MAX_SAFE_COINS,limit)).fetchall()
    credited=0
    for row in rows:
        owner=row['game_address'];coins=int(row['coins'])
        before=db.execute('SELECT coins FROM players WHERE address=?',(owner,)).fetchone()['coins']
        if type(before) is not int or before < 0 or before+coins > MAX_SAFE_COINS:
            continue  # Receipt is retained; a later tick retries after the balance decreases.
        db.execute('UPDATE players SET coins=? WHERE address=?',(before+coins,owner))
        db.execute('''UPDATE recharge_deposits SET owner=?,credited_at=?,balance_before=?,balance_after=?
            WHERE source=? AND deposit_id=? AND credited_at IS NULL''',
            (owner,int(time.time()),before,before+coins,source,row['deposit_id']))
        credited+=1
    return credited
