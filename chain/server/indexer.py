"""Independent, restartable NFT event indexer. Never signs a transaction."""
import argparse
import fcntl
import hashlib
import json
import os
import signal
import threading
import time

from web3 import Web3
from .rpc import ChainReader, ChainSettings
from backend.storage import Store
from backend.staking_rewards import settle_all
from backend.market import record_sale, settle_sales


class IndexFailure(Exception):
    pass


class IndexHalt(IndexFailure):
    pass


def hex_value(value):
    return Web3.to_hex(value).lower()


def json_value(value):
    if isinstance(value, bytes):
        return hex_value(value)
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return str(value)  # uint256 never becomes an imprecise JavaScript number.
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    return value


def deployment_details(info, w3, receipt):
    if (receipt['status'] != 1 or not receipt['contractAddress']
            or receipt['contractAddress'].lower() != info['address'].lower()):
        raise IndexHalt('部署交易与当前合约不匹配，监听已暂停。')
    block = w3.eth.get_block(receipt['blockNumber'])
    if block['hash'] != receipt['blockHash']:
        raise IndexHalt('部署区块已变化，监听已暂停。')
    return {**info, 'manifestVersion': 2,
            'deploymentTransaction': hex_value(receipt['transactionHash']),
            'deploymentBlock': int(receipt['blockNumber']), 'deploymentBlockHash': hex_value(block['hash']),
            'genesisHash': hex_value(w3.eth.get_block(0)['hash']),
            'runtimeCodeHash': hex_value(Web3.keccak(w3.eth.get_code(info['address'])))}


def record_local_deployment(settings):
    """Upgrade a legacy LOCAL manifest through read-only RPC, without redeploying."""
    if settings.network != 'local':
        raise IndexFailure('旧部署清单自动补全仅适用于本地链；Sepolia 必须保存真实部署回执。')
    info, w3, _ = ChainReader(settings).connect()
    if info.get('manifestVersion') == 2:
        RpcSource(settings).open()
        return
    left, right = 0, w3.eth.block_number
    while left < right:
        middle = (left + right) // 2
        if w3.eth.get_code(info['address'], block_identifier=middle):
            right = middle
        else:
            left = middle + 1
    block = w3.eth.get_block(left)
    for tx in block['transactions']:
        receipt = w3.eth.get_transaction_receipt(tx)
        if receipt['contractAddress'] and receipt['contractAddress'].lower() == info['address'].lower():
            info = deployment_details(info, w3, receipt)
            temporary = settings.directory / 'deployment.json.tmp'
            with open(temporary, 'w') as file:
                json.dump(info, file, indent=2)
                file.flush(); os.fsync(file.fileno())
            os.replace(temporary, settings.directory / 'deployment.json')
            return
    raise IndexFailure('未找到合约的创建交易，原部署清单保持不变。')


class RpcSource:
    def __init__(self, settings):
        self.settings = settings

    def open(self):
        info, self.w3, self.contract = ChainReader(self.settings).connect()
        required = ['deploymentTransaction', 'deploymentBlock', 'deploymentBlockHash', 'genesisHash', 'runtimeCodeHash']
        if info.get('manifestVersion') != 2 or any(key not in info for key in required):
            raise IndexFailure('部署清单缺少区块记录；本地旧部署请先运行 npm run chain:record。')
        if type(info['deploymentBlock']) is not int or info['deploymentBlock'] < 1:
            raise IndexHalt('部署起点无效，监听已暂停。')
        receipt = self.w3.eth.get_transaction_receipt(info['deploymentTransaction'])
        actual = deployment_details(info, self.w3, receipt)
        if any(actual[key] != info[key] for key in required):
            raise IndexHalt('链上部署身份或代码与清单不一致，监听已暂停。')
        self.info = info
        self.topics = [hex_value(Web3.keccak(text=f"{event['name']}({','.join(item['type'] for item in event['inputs'])})"))
                       for event in info['abi'] if event['type'] == 'event']
        if not self.topics:
            raise IndexHalt('合约清单没有事件定义，监听已暂停。')
        return {key: info[key] for key in ['address', 'chainId', 'deploymentId', 'mintSigner', *required]} | {
            'network': self.settings.network, 'abiHash': hashlib.sha256(json.dumps(info['abi'], sort_keys=True).encode()).hexdigest(),
            'confirmationPolicy': 'finalized' if self.settings.network == 'sepolia' else 'local-latest'}

    def block_hash(self, number):
        return hex_value(self.w3.eth.get_block(number)['hash'])

    def boundary(self):
        head = self.w3.eth.block_number
        # No fallback to latest if the public provider cannot supply finality.
        confirmed = self.w3.eth.get_block('finalized')['number'] if self.settings.network == 'sepolia' else head
        return head, int(confirmed)

    def logs(self, start, end):
        result = []
        raw_logs = self.w3.eth.get_logs({'address': self.info['address'], 'fromBlock': start,
                                        'toBlock': end, 'topics': [self.topics]})
        for log in raw_logs:
            if (log.get('removed', False) or not start <= log['blockNumber'] <= end
                    or log['address'].lower() != self.info['address'].lower()):
                raise IndexFailure('节点返回了不匹配的事件，本批次未保存。')
            decoded = self.contract.get_event_by_topic(hex_value(log['topics'][0]))().process_log(log)
            result.append({'block_hash': hex_value(log['blockHash']), 'log_index': int(log['logIndex']),
                           'block_number': int(log['blockNumber']), 'transaction_hash': hex_value(log['transactionHash']),
                           'transaction_index': int(log['transactionIndex']), 'contract_address': log['address'].lower(),
                           'name': decoded['event'], 'args': json_value(dict(decoded['args']))})
        return result


class Indexer:
    def __init__(self, store, source, batch_size=500, staking=None, recharge=None):
        if not 1 <= batch_size <= 2000:
            raise ValueError('FORGE_INDEX_BATCH must be between 1 and 2000')
        self.store, self.source, self.batch_size = store, source, batch_size
        self.staking = staking
        self.recharge = recharge

    def status(self, state, message='', **fields):
        with self.store.connection() as db:
            db.execute("INSERT OR IGNORE INTO chain_scan(id,scanned_block,scanned_hash,processed_block,state) VALUES(1,-1,'',-1,'starting')")
            changes = {'state': state, 'message': message, 'updated_at': time.time(), **fields}
            db.execute(f"UPDATE chain_scan SET {','.join(key+'=?' for key in changes)} WHERE id=1", tuple(changes.values()))

    def initialize(self, manifest):
        self.start_block = manifest['deploymentBlock']
        fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
        start = manifest['deploymentBlock'] - 1
        anchor = self.source.block_hash(start)
        with self.store.connection() as db:
            saved = db.execute('SELECT fingerprint FROM chain_environment WHERE id=1').fetchone()
            if saved and saved['fingerprint'] != fingerprint:
                raise IndexHalt('数据库已绑定另一份部署；请使用对应环境，不能覆盖扫描进度。')
            if not saved:
                db.execute('INSERT INTO chain_environment VALUES(1,?,?)', (fingerprint, json.dumps(manifest)))
                db.execute('''INSERT OR REPLACE INTO chain_scan(id,scanned_block,scanned_hash,processed_block,state,updated_at)
                              VALUES(1,?,?,?,'starting',?)''', (start, anchor, start, time.time()))
                db.execute('INSERT INTO chain_checkpoints VALUES(?,?)', (start, anchor))

    def scan(self):
        with self.store.connection() as db:
            checkpoint = dict(db.execute('SELECT * FROM chain_scan WHERE id=1').fetchone())
        head, confirmed = self.source.boundary()
        if not 0 <= confirmed <= head:
            raise IndexFailure('节点确认边界无效，本次扫描未推进。')
        if (head < checkpoint['scanned_block'] or (confirmed < checkpoint['scanned_block'] and checkpoint['scanned_block'] >= self.start_block)
                or self.source.block_hash(checkpoint['scanned_block']) != checkpoint['scanned_hash']):
            raise IndexHalt('已保存的确认区块发生变化，监听已暂停；请核对节点或恢复匹配的备份。')
        start = checkpoint['scanned_block'] + 1
        if start > confirmed:
            self.status('syncing', head_block=head, confirmed_block=confirmed, rpc_ok=1)
            return
        end = min(confirmed, start + self.batch_size - 1)
        while True:
            boundary_hash = self.source.block_hash(end)
            try:
                logs = self.source.logs(start, end)
                break
            except Exception:
                if end == start:
                    raise IndexFailure('节点事件查询失败，本批次未推进，稍后会从原位置重试。') from None
                end = start + (end - start) // 2
        seen = {}
        block_hashes = {}
        for event in logs:
            if not start <= event['block_number'] <= end:
                raise IndexFailure('事件区块超出查询范围，本批次未保存。')
            number = event['block_number']
            if number not in block_hashes:
                block_hashes[number] = self.source.block_hash(number)
            if event['block_hash'] != block_hashes[number]:
                raise IndexFailure('读取期间链上区块变化，本批次未保存。')
            key = event['block_hash'], event['log_index']
            if key in seen and seen[key] != event:
                raise IndexFailure('节点返回冲突事件，本批次未保存。')
            seen[key] = event
        if (self.source.block_hash(end) != boundary_hash
                or self.source.block_hash(checkpoint['scanned_block']) != checkpoint['scanned_hash']):
            raise IndexFailure('读取期间链上区块变化，本批次未保存。')
        with self.store.connection() as db:
            current = db.execute('SELECT * FROM chain_scan WHERE id=1').fetchone()
            if current['scanned_block'] != checkpoint['scanned_block'] or current['state'] == 'halted':
                raise IndexFailure('扫描进度已被其他进程更新，本次读取未提交。')
            for event in sorted(seen.values(), key=lambda item: (item['block_number'], item['transaction_index'], item['log_index'])):
                values = [event[key] for key in ['block_hash', 'log_index', 'block_number', 'transaction_hash',
                                               'transaction_index', 'contract_address', 'name']]
                db.execute('''INSERT INTO chain_events(block_hash,log_index,block_number,transaction_hash,
                              transaction_index,contract_address,name,args) VALUES(?,?,?,?,?,?,?,?)''', (*values, json.dumps(event['args'])))
            db.execute('INSERT INTO chain_checkpoints VALUES(?,?)', (end, boundary_hash))
            db.execute("UPDATE chain_scan SET scanned_block=?,scanned_hash=?,head_block=?,confirmed_block=?,state='syncing',message='',updated_at=?,rpc_ok=1 WHERE id=1",
                       (end, boundary_hash, head, confirmed, time.time()))

    def apply_event(self, db, event):
        args = json.loads(event['args']); name = event['name']
        token = str(args.get('tokenId', ''))
        block, tx = event['block_number'], event['transaction_hash']
        if name == 'Transfer':
            db.execute('''INSERT INTO chain_nfts(token_id,owner,updated_block,updated_transaction) VALUES(?,?,?,?)
                          ON CONFLICT(token_id) DO UPDATE SET owner=excluded.owner,seller=NULL,price_wei='0',
                          updated_block=excluded.updated_block,updated_transaction=excluded.updated_transaction''',
                       (token, args['to'], block, tx))
        elif name == 'Forged':
            # ERC721 receiver callbacks can transfer before Forged is emitted.
            db.execute('UPDATE chain_nfts SET level=? WHERE token_id=?', (str(args['level']), token))
        elif name == 'Listed':
            db.execute('UPDATE chain_nfts SET seller=?,price_wei=?,updated_block=?,updated_transaction=? WHERE token_id=?',
                       (args['seller'], str(args['price']), block, tx, token))
        elif name == 'Unlisted':
            db.execute("UPDATE chain_nfts SET seller=NULL,price_wei='0',updated_block=?,updated_transaction=? WHERE token_id=?", (block, tx, token))
        elif name == 'Purchased':
            # Notify the seller without overwriting callback transfers/relistings.
            record_sale(db, event)

    def process(self):
        with self.store.connection() as db:
            events = db.execute('SELECT * FROM chain_events WHERE processed=0 ORDER BY block_number,transaction_index,log_index LIMIT 1000').fetchall()
            for event in events:
                self.apply_event(db, event)
                db.execute('UPDATE chain_events SET processed=1 WHERE block_hash=? AND log_index=?', (event['block_hash'], event['log_index']))
            settle_sales(db)
            scan = db.execute('SELECT * FROM chain_scan WHERE id=1').fetchone()
            pending = db.execute('SELECT MIN(block_number) FROM chain_events WHERE processed=0').fetchone()[0]
            processed = pending - 1 if pending is not None else scan['scanned_block']
            state = 'waiting' if scan['confirmed_block'] < self.start_block else 'ready' if processed >= scan['confirmed_block'] else 'syncing'
            db.execute("UPDATE chain_scan SET processed_block=?,state=?,message='',last_success=?,updated_at=? WHERE id=1",
                       (processed, state, time.time(), time.time()))
            return state in ('ready', 'waiting')

    def tick(self):
        try:
            with self.store.connection() as db:
                saved = db.execute('SELECT state,message FROM chain_scan WHERE id=1').fetchone()
                if saved and saved['state'] == 'halted':
                    raise IndexHalt(saved['message'])
            self.initialize(self.source.open())
            self.scan()
            indexed = self.process()
            rewards = self.staking.tick() if self.staking is not None else settle_all(self.store)
            deposits = self.recharge.tick() if self.recharge is not None else True
            return indexed and rewards and deposits
        except IndexHalt as error:
            self.status('halted', str(error), rpc_ok=0)
            raise
        except Exception as error:
            message = str(error) if isinstance(error, IndexFailure) else '链上监听暂时失败，扫描进度已保留，将自动重试。'
            self.status('error', message, rpc_ok=0)
            raise IndexFailure(message) from None


def main():
    parser = argparse.ArgumentParser(description='Read-only, persistent blockchain event listener')
    parser.add_argument('--once', action='store_true', help='Catch up to the confirmed boundary and exit')
    parser.add_argument('--record-deployment', action='store_true', help='Add receipt metadata to a legacy local deployment')
    args = parser.parse_args()
    settings = ChainSettings.from_env()
    if args.record_deployment:
        record_local_deployment(settings)
        print('本地部署区块记录已核验并保存；未发送交易。')
        return
    settings.directory.mkdir(parents=True, exist_ok=True)
    with open(settings.directory / 'indexer.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise IndexFailure('这个环境已有监听进程在运行。') from None
        from .staking_indexer import StakingIndexer, RpcStakingSource
        from .recharge_indexer import RechargeIndexer, RpcRechargeSource
        store = Store(settings.directory / 'game.sqlite3', settings.network)
        batch_size = int(os.getenv('FORGE_INDEX_BATCH', '500'))
        staking = StakingIndexer(store, RpcStakingSource(settings), batch_size)
        recharge = RechargeIndexer(store, RpcRechargeSource(settings), batch_size)
        indexer = Indexer(store, RpcSource(settings), batch_size, staking=staking, recharge=recharge)
        stopping = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: stopping.set())
        try:
            if not args.once:
                from .tasks import TaskWorker
                # Use the canonical module types even when this file is run
                # with -m; task error classification must share IndexHalt.
                from .indexer import Indexer as NftIndexer, RpcSource as NftSource
                from .staking_reader import StakingReader
                from .recharge_indexer import RechargeReader
                worker = TaskWorker(store, settings,
                    {'nft': NftIndexer(store, NftSource(settings), batch_size), 'staking': staking, 'recharge': recharge},
                    {'nft': ChainReader(settings), 'staking': StakingReader(settings), 'recharge': RechargeReader(settings)})
                print('按需同步已启动：有任务时每 30 秒检查，空闲时不访问 RPC。', flush=True)
                while not stopping.is_set():
                    worker.tick()
                    stopping.wait(1)  # Local queue + UTC clock only; no idle RPC.
                return
            while not stopping.is_set():
                try:
                    caught_up = indexer.tick()
                    if args.once and caught_up:
                        print('已完成当前确认边界的事件补扫和 NFT 索引。')
                        return
                    if not caught_up:
                        continue
                except IndexHalt:
                    raise
                except IndexFailure as error:
                    if args.once:
                        raise
                    print(str(error), flush=True)
                stopping.wait(30)
        finally:
            with indexer.store.connection() as db:
                db.execute('UPDATE chain_worker SET running=0,heartbeat=? WHERE id=1', (time.time(),))
                db.execute("UPDATE chain_scan SET state='stopped',updated_at=? WHERE id=1 AND state!='halted'", (time.time(),))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, IndexFailure) else '监听启动失败，请检查配置和节点。连接凭据不会输出。')
        raise SystemExit(1) from None
