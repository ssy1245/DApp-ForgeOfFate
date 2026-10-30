"""Account-bound wallet proof. Game archive keys never change during binding."""
import hashlib
import secrets
import time
from urllib.parse import urlsplit

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException
from web3 import Web3


def migrate_wallets(db):
    # Reserve historical account-wallet links, but require a fresh proof before
    # using them: old fixtures could have been created from an address alone.
    existed = db.execute("SELECT 1 FROM sqlite_master WHERE name='wallet_bindings' AND type='table'").fetchone()
    db.execute('''CREATE TABLE IF NOT EXISTS wallet_bindings(
        account_id TEXT PRIMARY KEY REFERENCES accounts(id),
        wallet_address TEXT COLLATE NOCASE NOT NULL UNIQUE,
        verified_at INTEGER)''')
    db.execute('''CREATE TABLE IF NOT EXISTS wallet_challenges(
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, session_token TEXT NOT NULL,
        wallet_address TEXT NOT NULL, origin TEXT NOT NULL, chain_id INTEGER NOT NULL,
        message TEXT NOT NULL, expires INTEGER NOT NULL)''')
    if not existed:
        for row in db.execute('SELECT a.id,a.game_address FROM accounts a JOIN players p ON p.address=a.game_address WHERE p.guest=0').fetchall():
            if Web3.is_address(row['game_address']):
                # Do not silently resolve conflicting legacy records.
                db.execute('INSERT INTO wallet_bindings VALUES(?,?,NULL)', (row['id'], Web3.to_checksum_address(row['game_address'])))


def identity(db, address):
    account = db.execute('''SELECT a.*,w.wallet_address,w.verified_at FROM accounts a
        LEFT JOIN wallet_bindings w ON w.account_id=a.id WHERE a.game_address=?''', (address,)).fetchone()
    verified = bool(account and account['verified_at'] is not None)
    return {'address': address, 'player_id': account['id'] if account else None,
            'username': account['username'] if account else None,
            'role': account['role'] if account else 'player',
            'wallet_address': account['wallet_address'] if account else None,
            'wallet_verified': verified, 'guest': not verified}


def session_account(db, authorization):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, '请先登录游戏账号，再绑定钱包。')
    digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
    account = db.execute('''SELECT a.* FROM sessions s JOIN accounts a ON a.game_address=s.address
        WHERE s.token=? AND s.expires>?''', (digest, int(time.time()))).fetchone()
    if not account:
        raise HTTPException(401, '请先登录游戏账号，再绑定钱包。')
    return account, digest


def check_available(db, account_id, address):
    own = db.execute('SELECT wallet_address FROM wallet_bindings WHERE account_id=?', (account_id,)).fetchone()
    if own and own['wallet_address'].lower() != address.lower():
        raise HTTPException(409, '此账号已绑定其他钱包，请切回原钱包。当前不支持换绑。')
    other = db.execute('SELECT account_id FROM wallet_bindings WHERE wallet_address=? COLLATE NOCASE', (address,)).fetchone()
    if other and other['account_id'] != account_id:
        raise HTTPException(409, '此钱包已绑定其他账号，请使用该账号登录。')


def create_challenge(db, authorization, address, origin, chain_id):
    if not Web3.is_address(address) or int(address, 16) == 0:
        raise HTTPException(400, '钱包地址无效。')
    account, digest = session_account(db, authorization)
    address = Web3.to_checksum_address(address)
    check_available(db, account['id'], address)
    nonce, now = secrets.token_hex(16), int(time.time())
    expires = now + 300
    message = (f'Forge of Fate — Bind wallet to game account\n'
               f'Domain: {urlsplit(origin).netloc}\nURI: {origin}\nChain ID: {chain_id}\n'
               f'Account: {account["username"]}\nPlayer ID: {account["id"]}\n'
               f'Wallet: {address}\nNonce: {nonce}\nIssued At: {now}\nExpires: {expires}\n'
               'Purpose: bind this wallet to this game account only.\n'
               'No transaction, payment, token approval or transfer of game progress.')
    db.execute('DELETE FROM wallet_challenges WHERE expires<=?', (now,))
    db.execute('INSERT INTO wallet_challenges VALUES(?,?,?,?,?,?,?,?)',
               (nonce, account['id'], digest, address, origin, chain_id, message, expires))
    return {'challenge_id': nonce, 'message': message, 'expires_at': expires}


def bind_wallet(db, authorization, challenge_id, signature, origin, chain_id):
    account, digest = session_account(db, authorization)
    row = db.execute('SELECT * FROM wallet_challenges WHERE id=?', (challenge_id,)).fetchone()
    if not row or row['expires'] <= int(time.time()):
        raise HTTPException(409, '钱包验证已过期或已使用，请重新发起绑定。')
    if (row['account_id'] != account['id'] or row['session_token'] != digest
            or row['origin'] != origin or row['chain_id'] != chain_id):
        raise HTTPException(409, '钱包验证与当前账号、会话或网络不一致，请重新发起绑定。')
    try:
        signer = Account.recover_message(encode_defunct(text=row['message']), signature=signature)
    except Exception:
        raise HTTPException(400, '签名无效。') from None
    if signer.lower() != row['wallet_address'].lower():
        raise HTTPException(400, '签名与钱包不一致。')
    check_available(db, account['id'], signer)
    db.execute('''INSERT INTO wallet_bindings VALUES(?,?,?) ON CONFLICT(account_id)
        DO UPDATE SET verified_at=excluded.verified_at''', (account['id'], Web3.to_checksum_address(signer), int(time.time())))
    db.execute('DELETE FROM wallet_challenges WHERE id=?', (challenge_id,))
    return identity(db, account['game_address'])
