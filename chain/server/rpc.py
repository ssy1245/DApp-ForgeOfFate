"""Read-only chain access. RPC credentials never form part of a public response."""
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException
from web3 import Web3
from web3.exceptions import TransactionNotFound

ROOT = Path(__file__).resolve().parents[2]
NETWORKS = {
    'local': {'chainId': 31337, 'chainName': 'Forge Local', 'rpcUrls': ['http://127.0.0.1:8545'], 'blockExplorerUrls': []},
    # The wallet already knows Sepolia. Our private provider URL stays on the server.
    'sepolia': {'chainId': 11155111, 'chainName': 'Ethereum Sepolia', 'rpcUrls': [], 'blockExplorerUrls': ['https://sepolia.etherscan.io']},
}


@dataclass(frozen=True)
class ChainSettings:
    network: str
    directory: Path
    rpc: str

    @classmethod
    def from_env(cls):
        network = os.getenv('FORGE_NETWORK', 'local')
        if network not in NETWORKS:
            raise ValueError('FORGE_NETWORK must be local or sepolia')
        default_dir = ROOT / '.local' / 'sepolia' if network == 'sepolia' else ROOT / '.local'
        directory = Path(os.getenv('FORGE_LOCAL_DIR', str(default_dir))).resolve()
        if network == 'sepolia' and directory == (ROOT / '.local').resolve():
            raise ValueError('Sepolia requires a separate data directory')
        rpc = os.getenv('FORGE_RPC_URL') or (os.getenv('LOCAL_RPC_URL', 'http://127.0.0.1:8545') if network == 'local' else '')
        return cls(network, directory, rpc)

    def public(self):
        result = {'name': self.network, **NETWORKS[self.network]}
        if self.network == 'local':
            url = urlsplit(self.rpc)
            safe_local = (url.scheme in ('http', 'https') and url.hostname in ('127.0.0.1', 'localhost', '::1')
                          and not url.username and not url.password and not url.query and not url.fragment and url.path in ('', '/'))
            result['rpcUrls'] = [self.rpc] if safe_local else []
        return result


class ChainReader:
    def __init__(self, settings):
        self.settings = settings

    def connect(self):
        file = self.settings.directory / 'deployment.json'
        if not file.exists():
            raise HTTPException(503, '当前环境尚未配置合约部署信息。')
        if not self.settings.rpc:
            raise HTTPException(503, '当前环境缺少节点连接配置。')
        try:
            info = json.loads(file.read_text())
            if info['chainId'] != NETWORKS[self.settings.network]['chainId']:
                raise ValueError('wrong network')
            w3 = Web3(Web3.HTTPProvider(self.settings.rpc, request_kwargs={'timeout': 5}))
            contract = w3.eth.contract(address=info['address'], abi=info['abi'])
            if (w3.eth.chain_id != info['chainId'] or not w3.eth.get_code(info['address'])
                    or Web3.to_hex(contract.functions.deploymentId().call()) != info['deploymentId']
                    or contract.functions.mintSigner().call().lower() != info['mintSigner'].lower()):
                raise ValueError('deployment mismatch')
        except Exception:
            raise HTTPException(503, '节点不可用或部署信息不匹配，请检查当前环境配置。') from None
        return info, w3, contract

    def nfts(self, account=None, offset=0, limit=50, block=None):
        if account and not Web3.is_address(account):
            raise HTTPException(400, '钱包地址无效。')
        info, w3, contract = self.connect()
        try:
            height = w3.eth.block_number if block is None else block
            ids = contract.functions.allTokens().call(block_identifier=height)
            items = []
            for token in ids[offset:offset + limit]:
                seller, price = contract.functions.listings(token).call(block_identifier=height)
                items.append({'id': str(token), 'owner': contract.functions.ownerOf(token).call(block_identifier=height),
                              'seller': seller, 'price': str(price),
                              'level': contract.functions.levels(token).call(block_identifier=height),
                              'uri': contract.functions.tokenURI(token).call(block_identifier=height)})
            proceeds = contract.functions.proceeds(Web3.to_checksum_address(account)).call(block_identifier=height) if account else 0
            return {'items': items, 'total': len(ids), 'blockNumber': height, 'proceeds': str(proceeds),
                    'chainId': info['chainId'], 'deploymentId': info['deploymentId']}
        except Exception:
            raise HTTPException(503, '链上数据暂时无法读取，请稍后重试。') from None

    def receipt(self, tx_hash):
        if not re.fullmatch(r'0x[0-9a-fA-F]{64}', tx_hash):
            raise HTTPException(400, '交易哈希格式无效。')
        info, w3, _ = self.connect()
        envelope = {'chainId': info['chainId'], 'deploymentId': info['deploymentId'],
                    'confirmationPolicy': 'finalized' if self.settings.network == 'sepolia' else 'local-latest'}
        try:
            try:
                receipt = w3.eth.get_transaction_receipt(tx_hash)
            except TransactionNotFound:
                return {**envelope, 'receipt': None, 'state': 'pending'}
            if not receipt['to'] or receipt['to'].lower() != info['address'].lower():
                raise HTTPException(400, '交易不属于当前合约。')
            height = receipt['blockNumber']
            head = w3.eth.block_number
            boundary = w3.eth.get_block('finalized')['number'] if self.settings.network == 'sepolia' else head
            if not 0 <= boundary <= head or receipt['status'] not in (0, 1):
                raise ValueError('invalid chain response')
            # A receipt can outlive its block during a reorg. Never turn it into a final result.
            if height > head or w3.eth.get_block(height)['hash'] != receipt['blockHash']:
                return {**envelope, 'receipt': None, 'state': 'pending'}
            finalized = height <= boundary
            state = ('confirmed' if receipt['status'] == 1 else 'failed') if finalized else 'confirming'
            return {**envelope, 'state': state,
                    'receipt': {'hash': tx_hash, 'status': receipt['status'], 'blockNumber': height,
                                'blockHash': Web3.to_hex(receipt['blockHash']), 'from': receipt['from'],
                                'confirmations': head - height + 1, 'finalized': finalized}}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, '交易状态暂时无法读取，请稍后重试。') from None
