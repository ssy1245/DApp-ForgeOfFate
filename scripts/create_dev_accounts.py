"""Provision explicit local fixtures without changing existing accounts or passwords."""
import argparse
import os
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from eth_account import Account
from web3 import Web3
from backend.storage import Store
from backend.chain import ChainSettings
from backend.accounts import hash_password


def provision(store, username, password, role):
    encoded=hash_password(password)
    with store.connection() as db:
        prior=db.execute('SELECT role FROM accounts WHERE username=?',(username,)).fetchone()
        if prior:
            if prior['role']!=role:raise RuntimeError(f'{username}: existing account has a different role; no changes made')
            return False
        address=Account.create().address
        if db.execute('SELECT 1 FROM accounts WHERE game_address=?',(address,)).fetchone():
            raise RuntimeError('This game archive already has an account; no changes made')
        db.execute('INSERT OR IGNORE INTO players(address,guest) VALUES(?,?)',(address,1))
        db.execute('INSERT INTO accounts(id,username,password_hash,game_address,created,role) VALUES(?,?,?,?,?,?)',
                   (str(uuid.uuid4()),username,encoded,address,int(time.time()),role))
        return True


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo-wallet',help='Mark an already verified account as tester for the local two-wallet demo')
    parser.add_argument('--network', choices=['local', 'sepolia'], help='Choose the account data environment')
    args=parser.parse_args()
    if args.network:
        os.environ['FORGE_NETWORK'] = args.network
    settings = ChainSettings.from_env()
    LOCAL = settings.directory
    store=Store(str(LOCAL/'game.sqlite3'), network=settings.network)
    if args.demo_wallet:
        if not Web3.is_address(args.demo_wallet):raise ValueError('Invalid wallet address')
        if settings.network != 'local':raise ValueError('Demo-wallet fixtures are restricted to the isolated local network')
        with store.connection() as db:
            row=db.execute('SELECT account_id FROM wallet_bindings WHERE wallet_address=? COLLATE NOCASE AND verified_at IS NOT NULL',(args.demo_wallet,)).fetchone()
            if not row:raise ValueError('Register a game account and prove wallet control first')
            db.execute("UPDATE accounts SET role='tester' WHERE id=?",(row['account_id'],))
        print('Verified local demo account marked as tester.')
        return
    fixtures=[('forge_test','ForgeTest2026!','tester'),('forge_player','ForgePlayer2026!','player')]
    created=[]
    for name,password,role in fixtures:
        if provision(store,name,password,role):created.append(name)
    path=LOCAL/'test-accounts.md'
    if not path.exists():
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:
            f.write('# 本地测试账号\n\n仅用于本机测试。已有同名账号不会重置密码或权限。\n\n| 用途 | 用户名 | 初始密码 |\n|---|---|---|\n')
            for name,password,role in fixtures:
                shown=password if name in created else '沿用已有密码（未重置）'
                f.write(f"| {'测试（作弊菜单）' if role=='tester' else '普通玩家'} | {name} | {shown} |\n")
    print('Created: '+(', '.join(created) or 'none; existing accounts preserved'))
    print('Local credentials: '+str(path))

if __name__=='__main__':main()
