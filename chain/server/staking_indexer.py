"""Finalized staking log adapter. No signing, wall-clock accrual or NFT inference."""
import hashlib
import json
import os
import time

from web3 import Web3

from backend.staking_rewards import register_source, apply_finalized_batch, settle_source
from .rpc import ChainReader
from .indexer import RpcSource, IndexFailure, IndexHalt, deployment_details, hex_value

# Pin the entire reward-affecting event surface; never filter using a user-edited ABI.
STAKING_ABI = [
    {'type': 'function', 'name': name, 'stateMutability': 'view', 'inputs': [],
     'outputs': [{'name': '', 'type': output}]} for name, output in [('nft', 'address'), ('deploymentId', 'bytes32')]]
for name, field in [('Staked', 'startedAt'), ('Unstaked', 'endedAt')]:
    STAKING_ABI.append({'type': 'event', 'name': name, 'anonymous': False, 'inputs': [
        {'name': 'positionId', 'type': 'uint256', 'indexed': True},
        {'name': 'staker', 'type': 'address', 'indexed': True},
        {'name': 'tokenId', 'type': 'uint256', 'indexed': True},
        {'name': field, 'type': 'uint256', 'indexed': False}]})


class RpcStakingSource(RpcSource):
    def open(self):
        file = self.settings.directory / 'staking-deployment.json'
        if not file.exists():
            return None
        nft, self.w3, _ = ChainReader(self.settings).connect()
        info = json.loads(file.read_text())
        required = ['deploymentTransaction', 'deploymentBlock', 'deploymentBlockHash', 'genesisHash', 'runtimeCodeHash']
        if (info.get('manifestVersion') != 2 or info.get('chainId') != nft['chainId']
                or str(info.get('nftAddress', '')).lower() != nft['address'].lower()
                or info.get('nftDeploymentId') != nft['deploymentId']
                or type(info.get('deploymentBlock')) is not int or info['deploymentBlock'] < 1
                or any(key not in info for key in required)):
            raise IndexHalt('质押部署配置与当前 NFT 环境不一致，已停止奖励结算。')
        self.contract = self.w3.eth.contract(address=info['address'], abi=STAKING_ABI)
        if (self.contract.functions.nft().call().lower() != nft['address'].lower()
                or hex_value(self.contract.functions.deploymentId().call()) != info['deploymentId']):
            raise IndexHalt('质押合约的收藏集合或部署身份不匹配。')
        receipt = self.w3.eth.get_transaction_receipt(info['deploymentTransaction'])
        actual = deployment_details(info, self.w3, receipt)
        if any(actual[key] != info[key] for key in required):
            raise IndexHalt('质押部署回执或代码与保存的记录不匹配。')
        self.info = info
        self.topics = [hex_value(Web3.keccak(text=f"{event['name']}(uint256,address,uint256,uint256)"))
                       for event in STAKING_ABI if event['type'] == 'event']
        return {key: info[key] for key in ['address', 'chainId', 'deploymentId', 'nftAddress', 'nftDeploymentId', *required]}

    def block(self, number):
        block = self.w3.eth.get_block(number)
        return {'number': int(block['number']), 'hash': hex_value(block['hash']), 'timestamp': int(block['timestamp'])}


class StakingIndexer:
    def __init__(self, store, source, batch_size=500, daily_coins=None):
        if not 1 <= batch_size <= 2000:
            raise ValueError('Invalid staking batch size')
        self.store, self.source, self.batch_size = store, source, batch_size
        self.daily_coins = daily_coins

    def status(self, state, message=''):
        with self.store.connection() as db:
            db.execute('UPDATE staking_listener SET state=?,message=?,updated_at=? WHERE id=1', (state, message, int(time.time())))

    def tick(self):
        try:
            return self.advance()
        except IndexHalt as error:
            self.status('halted', str(error))
            raise
        except Exception:
            message = '质押监听或结算暂时失败，原进度已保留，将重试。'
            self.status('error', message)
            raise IndexFailure(message) from None

    def advance(self):
        with self.store.connection() as db:
            listener = db.execute('SELECT * FROM staking_listener WHERE id=1').fetchone()
        if listener and listener['state'] == 'halted':
            raise IndexHalt(listener['message'])
        manifest = self.source.open()
        if manifest is None:
            if listener:
                raise IndexHalt('已登记质押来源的部署文件缺失，不能继续奖励结算。')
            return True
        fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
        if listener and listener['fingerprint'] != fingerprint:
            raise IndexHalt('质押部署已改变，请使用对应的独立存档，不能覆盖旧进度。')
        head, confirmed = self.source.boundary()
        if not 0 <= confirmed <= head:
            raise IndexFailure('Invalid finalized boundary')
        if not listener and confirmed < manifest['deploymentBlock']:
            return True  # Deployment must finalize before creating reward-bearing state.
        anchor = self.source.block(manifest['deploymentBlock'] - 1)
        with self.store.connection() as db:
            rate = self.daily_coins if self.daily_coins is not None else int(os.getenv('FORGE_STAKING_COINS_PER_DAY', '0'))
            source_id = register_source(db, chain_id=manifest['chainId'], contract=manifest['address'],
                deployment=manifest['deploymentId'], start_block=anchor['number'], start_hash=anchor['hash'],
                start_time=anchor['timestamp'], daily_coins=rate)
            db.execute("INSERT OR IGNORE INTO staking_listener VALUES(1,?,?,'syncing','',?)", (fingerprint, source_id, int(time.time())))
            current_listener = db.execute('SELECT * FROM staking_listener WHERE id=1').fetchone()
            if current_listener['fingerprint'] != fingerprint or current_listener['source'] != source_id:
                raise IndexHalt('质押环境在读取期间发生变化。')
            saved = dict(db.execute('SELECT * FROM staking_sources WHERE source=?', (source_id,)).fetchone())
        if (confirmed < saved['scanned_block'] or self.source.block_hash(saved['scanned_block']) != saved['scanned_hash']):
            raise IndexHalt('已确认的质押区块发生变化，已暂停结算；请核对节点和备份。')
        start = saved['scanned_block'] + 1
        end = min(confirmed, start + self.batch_size - 1)
        if start <= end:
            while True:
                boundary = self.source.block(end)
                try:
                    logs = self.source.logs(start, end)
                    break
                except Exception:
                    if start == end:
                        raise IndexFailure('Staking log query failed') from None
                    end = start + (end - start) // 2
            seen, blocks, normalized = {}, {}, []
            for item in logs:
                block = item['block_number']
                if not start <= block <= end or item['contract_address'].lower() != manifest['address'].lower():
                    raise IndexFailure('Unexpected staking event')
                if block not in blocks:
                    blocks[block] = self.source.block(block)
                header = blocks[block]
                if item['block_hash'] != header['hash']:
                    raise IndexFailure('Staking block changed while reading')
                identity = (block, item['log_index'])
                if identity in seen:
                    if seen[identity] != item:
                        raise IndexFailure('Conflicting staking logs')
                    continue
                seen[identity] = item
                args = item['args']; kind = {'Staked': 'stake', 'Unstaked': 'unstake'}.get(item['name'])
                field = 'startedAt' if kind == 'stake' else 'endedAt'
                if not kind or int(args[field]) != header['timestamp']:
                    raise IndexFailure('Staking event timestamp mismatch')
                normalized.append({'kind': kind, 'block': block, 'log_index': item['log_index'],
                    'timestamp': header['timestamp'], 'position_id': str(args['positionId']),
                    'token_id': str(args['tokenId']), 'wallet': args['staker']})
            if (self.source.block_hash(end) != boundary['hash']
                    or self.source.block_hash(saved['scanned_block']) != saved['scanned_hash']):
                raise IndexFailure('Staking boundary changed while reading')
            normalized.sort(key=lambda e: (e['block'], e['log_index']))
            with self.store.connection() as db:
                current = db.execute('SELECT scanned_block FROM staking_sources WHERE source=?', (source_id,)).fetchone()
                if current['scanned_block'] != saved['scanned_block']:
                    raise IndexFailure('Staking progress updated by another worker')
                apply_finalized_batch(db, source_id, start_block=start, parent_hash=saved['scanned_hash'],
                    end_block=end, end_hash=boundary['hash'], end_time=boundary['timestamp'], events=normalized)
        with self.store.connection() as db:
            result = settle_source(db, source_id)
            ready = (start > confirmed or end == confirmed) and result['caught_up']
            db.execute("UPDATE staking_listener SET state=?,message='',updated_at=? WHERE id=1",
                       ('ready' if ready else 'syncing', int(time.time())))
        return ready
