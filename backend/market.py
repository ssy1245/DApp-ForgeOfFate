"""Confirmed NFT sales: durable processing and seller notifications, never payments."""
import json
import time
from .mailbox import deliver_notice


def migrate_market(db):
    db.execute('''CREATE TABLE IF NOT EXISTS market_sales(
        block_hash TEXT NOT NULL, log_index INTEGER NOT NULL, token_id TEXT NOT NULL,
        seller TEXT NOT NULL, buyer TEXT NOT NULL, price_wei TEXT NOT NULL,
        transaction_hash TEXT NOT NULL, block_number INTEGER NOT NULL,
        created_at INTEGER NOT NULL, notified_owner TEXT,
        PRIMARY KEY(block_hash,log_index))''')
    db.execute('CREATE INDEX IF NOT EXISTS chain_events_sales ON chain_events(name,processed,block_number)')
    db.execute('CREATE INDEX IF NOT EXISTS market_sales_delivery ON market_sales(notified_owner)')


def record_sale(db, event):
    args = json.loads(event['args'])
    token, price = int(args['tokenId']), int(args['price'])
    if not 0 <= token < 2**256 or not 0 < price < 2**256:
        raise ValueError('Invalid confirmed sale')
    values = (str(token), args['seller'], args['buyer'], str(price),
              event['transaction_hash'], event['block_number'])
    prior = db.execute('SELECT * FROM market_sales WHERE block_hash=? AND log_index=?',
                       (event['block_hash'], event['log_index'])).fetchone()
    if prior:
        if tuple(prior[key] for key in ('token_id','seller','buyer','price_wei','transaction_hash','block_number')) != values:
            raise ValueError('Conflicting sale event')
        return
    db.execute('''INSERT INTO market_sales(block_hash,log_index,token_id,seller,buyer,price_wei,
                  transaction_hash,block_number,created_at) VALUES(?,?,?,?,?,?,?,?,?)''',
               (event['block_hash'], event['log_index'], *values, int(time.time())))


def settle_sales(db):
    """Caller commits archival, mail, and delivery marker in one transaction.

    Also backfill already indexed Purchased events after an application upgrade.
    Never infer a sale from Transfer: staking and wallet transfers are not sales.
    """
    events = db.execute('''SELECT e.* FROM chain_events e LEFT JOIN market_sales s
        ON s.block_hash=e.block_hash AND s.log_index=e.log_index
        WHERE e.name='Purchased' AND e.processed=1 AND s.block_hash IS NULL
        ORDER BY e.block_number,e.transaction_index,e.log_index LIMIT 1000''').fetchall()
    for event in events:
        record_sale(db, event)
    # Join only verified bindings. Unknown sellers remain pending until they bind.
    rows = db.execute('''SELECT s.*,a.game_address FROM market_sales s
        JOIN wallet_bindings w ON w.wallet_address=s.seller COLLATE NOCASE AND w.verified_at IS NOT NULL
        JOIN accounts a ON a.id=w.account_id WHERE s.notified_owner IS NULL
        ORDER BY s.block_number,s.log_index LIMIT 1000''').fetchall()
    for sale in rows:
        owner = sale['game_address']
        weapon_id = '0x' + format(int(sale['token_id']), '064x')
        db.execute("UPDATE weapons SET status='sold' WHERE id=? AND owner=? AND status='sealed'", (weapon_id, owner))
        environment = db.execute('SELECT manifest,fingerprint FROM chain_environment WHERE id=1').fetchone()
        manifest = json.loads(environment['manifest'])
        payload = {key: sale[key] for key in ('token_id','seller','buyer','price_wei','transaction_hash','block_number')}
        payload.update(chain_id=manifest['chainId'], contract=manifest['address'])
        deliver_notice(db, owner, source_key=f"{environment['fingerprint']}:{sale['block_hash']}:{sale['log_index']}",
                       payload=payload, created_at=sale['created_at'])
        db.execute('UPDATE market_sales SET notified_owner=? WHERE block_hash=? AND log_index=?',
                   (owner, sale['block_hash'], sale['log_index']))
