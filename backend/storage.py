"""Shared SQLite storage; importing this module does not open a database."""
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from .game import BALANCE
from chain.server.store import migrate_chain
from chain.server.wallets import migrate_wallets


class Store:
    def __init__(self, path, network='local'):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            # Bind a database to one network before running any schema upgrades.
            db.execute('CREATE TABLE IF NOT EXISTS runtime_environment(id INTEGER PRIMARY KEY CHECK(id=1),network TEXT NOT NULL)')
            row = db.execute('SELECT network FROM runtime_environment WHERE id=1').fetchone()
            legacy = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='players'").fetchone()
            if (row and row['network'] != network) or (not row and legacy and network != 'local'):
                raise ValueError('数据库属于其他网络，请使用独立环境目录。')
            db.execute('INSERT OR IGNORE INTO runtime_environment VALUES(1,?)', (network,))
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS players(address TEXT PRIMARY KEY,materials INTEGER DEFAULT 0,shields INTEGER DEFAULT 0,coins INTEGER DEFAULT 0,claim_day TEXT,demo_claimed INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,address TEXT,message TEXT,expires INTEGER);
            CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,address TEXT,expires INTEGER);
            CREATE TABLE IF NOT EXISTS weapons(id TEXT PRIMARY KEY,owner TEXT,level INTEGER DEFAULT 0,status TEXT DEFAULT 'active',strikes INTEGER DEFAULT 0,protected_left INTEGER DEFAULT 0,demo INTEGER DEFAULT 0,created INTEGER);
            CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,game_address TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS operations(address TEXT,key TEXT,fingerprint TEXT,response TEXT,PRIMARY KEY(address,key));
            ''')
            for table,column,definition in [('accounts','role',"TEXT NOT NULL DEFAULT 'player'"),('weapons','heat_ready_at','REAL DEFAULT 0'),('weapons','heat_charges','INTEGER DEFAULT 0'),('players','guest','INTEGER DEFAULT 0'),('challenges','guest_owner','TEXT'),('players','sword_day','TEXT'),('weapons','quality',"TEXT DEFAULT '普通'"),('weapons','source',"TEXT DEFAULT 'forge'"),('weapons','branch',"TEXT NOT NULL DEFAULT 'longsword'")]:
                if column not in {row['name'] for row in db.execute(f'PRAGMA table_info({table})')}:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')
            if 'daily_swords_claimed' not in {row['name'] for row in db.execute('PRAGMA table_info(players)')}:
                db.execute('ALTER TABLE players ADD COLUMN daily_swords_claimed INTEGER NOT NULL DEFAULT 0')
                # Earlier versions delivered the entire allowance when state was read.
                db.execute('UPDATE players SET daily_swords_claimed=? WHERE sword_day IS NOT NULL', (BALANCE['daily_swords'],))
            # Retire the old energy resource without resetting any other progress.
            if 'ap' in {row['name'] for row in db.execute('PRAGMA table_info(players)')}:
                db.execute('ALTER TABLE players DROP COLUMN ap')
            # Existing saves start with an empty workshop; all their weapons remain in storage.
            for column, definition in [('workshop_weapon_id', 'TEXT'), ('workshop_revision', 'INTEGER NOT NULL DEFAULT 0')]:
                if column not in {row['name'] for row in db.execute('PRAGMA table_info(players)')}:
                    db.execute(f'ALTER TABLE players ADD COLUMN {column} {definition}')
            migrate_chain(db)
            migrate_wallets(db)
    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA busy_timeout=15000')
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

