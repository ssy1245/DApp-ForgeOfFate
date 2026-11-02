"""Versioned chain-index schema and safe, read-only status queries."""
import json
import time


def migrate_chain(db):
    # Legacy schema setup used executescript; explicitly restore an atomic migration.
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    db.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
    if db.execute("SELECT 1 FROM schema_migrations WHERE version='chain-index-v1'").fetchone():
        return
    statements = [
        '''CREATE TABLE chain_environment(id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL,
           manifest TEXT NOT NULL)''',
        '''CREATE TABLE chain_scan(id INTEGER PRIMARY KEY CHECK(id=1), scanned_block INTEGER NOT NULL,
           scanned_hash TEXT NOT NULL, processed_block INTEGER NOT NULL, head_block INTEGER,
           confirmed_block INTEGER, state TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
           updated_at REAL NOT NULL DEFAULT 0, last_success REAL, rpc_ok INTEGER NOT NULL DEFAULT 0)''',
        '''CREATE TABLE chain_checkpoints(number INTEGER PRIMARY KEY, hash TEXT NOT NULL)''',
        '''CREATE TABLE chain_events(block_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
           block_number INTEGER NOT NULL, transaction_hash TEXT NOT NULL, transaction_index INTEGER NOT NULL,
           contract_address TEXT NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL,
           processed INTEGER NOT NULL DEFAULT 0 CHECK(processed IN (0,1)),
           PRIMARY KEY(block_hash,log_index))''',
        'CREATE INDEX chain_events_pending ON chain_events(processed,block_number,transaction_index,log_index)',
        '''CREATE TABLE chain_nfts(token_id TEXT PRIMARY KEY, owner TEXT NOT NULL,
           level TEXT, seller TEXT, price_wei TEXT NOT NULL DEFAULT '0',
           updated_block INTEGER NOT NULL, updated_transaction TEXT NOT NULL)''',
    ]
    for statement in statements:
        db.execute(statement)
    db.execute('INSERT INTO schema_migrations VALUES(?,?)', ('chain-index-v1', int(time.time())))


def index_status(store):
    from .tasks import worker_status
    with store.connection() as db:
        scan = db.execute('SELECT * FROM chain_scan WHERE id=1').fetchone()
        environment = db.execute('SELECT manifest FROM chain_environment WHERE id=1').fetchone()
        pending = db.execute('SELECT COUNT(*) FROM chain_events WHERE processed=0').fetchone()[0]
        total = db.execute('SELECT COUNT(*) FROM chain_events').fetchone()[0]
        worker = worker_status(db)
        has_worker = bool(db.execute('SELECT 1 FROM chain_worker WHERE id=1').fetchone())
    if scan is None:
        return {**worker, 'state': 'starting' if worker['running'] else 'not_started', 'running': worker['running'], 'caughtUp': False, 'rpcAvailable': False,
                'fundingReady': False, 'message': '链上监听尚未启动。', 'pendingEvents': 0, 'eventCount': 0}
    scan = dict(scan)
    manifest = json.loads(environment['manifest']) if environment else None
    running = (worker['running'] if has_worker else time.time() - scan['updated_at'] < 60) and scan['state'] not in ('halted',)
    if not has_worker and scan['state'] == 'stopped':
        running = False
    caught_up = (scan['state'] != 'halted' and scan['confirmed_block'] is not None and scan['processed_block'] >= scan['confirmed_block']
                 and manifest is not None and scan['confirmed_block'] >= manifest['deploymentBlock'])
    state = 'idle' if has_worker and running and worker['pendingTasks'] == 0 and scan['state'] not in ('halted','error') else scan['state']
    if has_worker and running and state == 'stopped':
        state = 'syncing'
    return {**worker, 'state': state if running or scan['state'] == 'halted' else 'stopped',
            'running': running, 'caughtUp': caught_up,
            'rpcAvailable': bool(scan['rpc_ok']) and running,
            # Module readiness is exposed separately through /api/config.
            'fundingReady': False, 'message': scan['message'],
            'headBlock': scan['head_block'], 'confirmedBlock': scan['confirmed_block'],
            'scannedBlock': scan['scanned_block'], 'processedBlock': scan['processed_block'],
            'lastSuccess': scan['last_success'], 'pendingEvents': pending, 'eventCount': total,
            'deployment': manifest}


def event_history(store, offset=0, limit=25):
    with store.connection() as db:
        rows = db.execute('''SELECT * FROM chain_events ORDER BY block_number DESC,
                          transaction_index DESC,log_index DESC LIMIT ? OFFSET ?''', (limit, offset)).fetchall()
    return [{**dict(row), 'args': json.loads(row['args']), 'processed': bool(row['processed'])} for row in rows]
