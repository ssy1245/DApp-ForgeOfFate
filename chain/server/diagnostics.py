"""Tester-only read diagnostics. Never return provider errors, URLs or key material."""
import json
import re
import time

from eth_account import Account
from web3 import Web3

from .rpc import NETWORKS
from .store import index_status


def public_hex(value, size):
    return value if isinstance(value, str) and re.fullmatch(r'0x[0-9a-fA-F]{' + str(size) + '}', value) else None


def read_object(file):
    value = json.loads(file.read_text())
    if not isinstance(value, dict):
        raise ValueError('Invalid record')
    return value


def inspect_chain(settings, store):
    expected = NETWORKS[settings.network]['chainId']
    network = dict(name=NETWORKS[settings.network]['chainName'], expectedChainId=expected,
                   actualChainId=None, headBlock=None, finalizedBlock=None, status='unknown',
                   finalityStatus='unknown', message='尚未检查节点。')
    nft = dict(id='nft-market', name='NFT / 市场合约', address=None, status='unknown',
               message='尚未检查合约。', checks=[], transactionHash=None, deploymentBlock=None)
    # Explicit allowlist: persisted manifests, arbitrary messages and credentials stay private.
    saved = index_status(store)
    sync = {k: saved.get(k) for k in ['state', 'running', 'caughtUp', 'scannedBlock', 'processedBlock',
                                     'pendingEvents', 'eventCount', 'lastSuccess']}
    sync['deploymentMatches'] = None
    result = dict(checkedAt=time.time(), network=network, contracts=[nft,
        inspect_staking(settings, store),
        dict(id='recharge', name='充值合约', status='disabled', message='充值暂缓，当前未启用。', checks=[])], indexer=sync)

    w3 = None
    if not settings.rpc:
        network.update(status='error', message='当前环境缺少节点连接配置。')
    else:
        try:
            w3 = Web3(Web3.HTTPProvider(settings.rpc, request_kwargs={'timeout': 3}, exception_retry_configuration=None))
            network['actualChainId'] = w3.eth.chain_id
            if network['actualChainId'] != expected:
                network.update(status='error', message='节点网络与游戏配置不匹配。')
            else:
                network.update(status='ok', message='节点网络与游戏配置一致。')
                network['headBlock'] = w3.eth.block_number
        except Exception:
            network.update(status='error', message='节点连接失败，请检查本机网络或 RPC 配置。')
        if network['status'] == 'ok':
            try:
                boundary = w3.eth.get_block('finalized' if settings.network == 'sepolia' else 'latest')
                height = boundary['number']
                if type(height) is not int or not 0 <= height <= network['headBlock'] or not boundary['hash']:
                    raise ValueError('Invalid boundary')
                network.update(finalizedBlock=height, finalityStatus='ok')
            except Exception:
                network['finalityStatus'] = 'error'

    manifest = settings.directory / 'deployment.json'
    if not manifest.exists():
        nft.update(status='waiting', message='尚未配置 NFT 合约，请先完成部署。')
        # Show the console's saved intent without treating it as a verified deployment.
        console = settings.directory / 'deploy-console' / 'forge-of-fate'
        try:
            plan = read_object(console / 'plan.json')
            state = read_object(console / 'state.json')
            if state.get('deploymentId') == plan.get('deploymentId') and plan.get('network', {}).get('chainId') == expected:
                nft['transactionHash'] = public_hex(state.get('transactionHash'), 64)
                block = state.get('deploymentBlock')
                nft['deploymentBlock'] = block if type(block) is int and block >= 0 else None
                nft['message'] = '部署记录尚未交接，请在部署工作台确认。'
                if state.get('phase') == 'confirming' and nft['deploymentBlock'] is not None:
                    final = network['finalizedBlock']
                    if final is not None and final < block:
                        nft['message'] = '交易已打包，等待最终确认后保存游戏配置。'
                elif state.get('phase') == 'failed':
                    nft.update(status='error', message='部署交易失败，请检查部署工作台。')
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        return result

    try:
        info = read_object(manifest)
        nft['address'] = public_hex(info.get('address'), 40)
        nft['transactionHash'] = public_hex(info.get('deploymentTransaction'), 64)
        block = info.get('deploymentBlock')
        nft['deploymentBlock'] = block if type(block) is int and block >= 0 else None
        if not nft['address'] or info.get('chainId') != expected or not isinstance(info.get('abi'), list):
            raise ValueError('Invalid configuration')
        if not public_hex(info.get('deploymentId'), 64) or not public_hex(info.get('mintSigner'), 40):
            raise ValueError('Invalid identity')
        if info.get('manifestVersion') == 2 and (not nft['transactionHash'] or nft['deploymentBlock'] is None
                or any(not public_hex(info.get(k), 64) for k in ['runtimeCodeHash', 'genesisHash', 'deploymentBlockHash'])):
            raise ValueError('Incomplete deployment record')
    except Exception:
        nft.update(status='error', message='NFT 部署配置无效，请核对原部署清单。')
        return result

    indexed = saved.get('deployment')
    if indexed:
        sync['deploymentMatches'] = (indexed.get('chainId') == expected
            and str(indexed.get('address', '')).lower() == nft['address'].lower()
            and indexed.get('deploymentId') == info['deploymentId'])
    if network['status'] != 'ok':
        nft.update(status='unknown', message='节点未就绪，合约状态尚未核验。')
        return result

    def check(label, ok):
        nft['checks'].append(dict(label=label, status='ok' if ok else 'error'))

    try:
        address = Web3.to_checksum_address(nft['address'])
        code = w3.eth.get_code(address)
        check('链上代码', bool(code))
        if not code:
            nft.update(status='error', message='该地址没有合约代码。')
            return result
        if info.get('runtimeCodeHash'):
            check('代码与部署记录', Web3.to_hex(Web3.keccak(code)).lower() == str(info['runtimeCodeHash']).lower())
        contract = w3.eth.contract(address=address, abi=info['abi'])
        check('部署身份', Web3.to_hex(contract.functions.deploymentId().call()).lower() == info['deploymentId'].lower())
        check('铸造授权地址', contract.functions.mintSigner().call().lower() == info['mintSigner'].lower())
        nft['mintSigner'] = info['mintSigner']
        if info.get('manifestVersion') == 2:
            if not nft['transactionHash'] or nft['deploymentBlock'] is None:
                raise ValueError('Incomplete deployment')
            receipt = w3.eth.get_transaction_receipt(nft['transactionHash'])
            canonical = w3.eth.get_block(receipt['blockNumber'])
            check('部署回执', receipt['status'] == 1 and str(receipt['contractAddress']).lower() == address.lower()
                  and receipt['blockNumber'] == nft['deploymentBlock']
                  and receipt['blockHash'] == canonical['hash']
                  and Web3.to_hex(receipt['blockHash']).lower() == str(info.get('deploymentBlockHash', '')).lower()
                  and Web3.to_hex(w3.eth.get_block(0)['hash']).lower() == str(info.get('genesisHash', '')).lower())
        else:
            nft['checks'].append(dict(label='部署回执', status='waiting'))
        finalized = network['finalizedBlock']
        nft['checks'].append(dict(label='部署最终确认', status='ok' if nft['deploymentBlock'] is not None
            and finalized is not None and finalized >= nft['deploymentBlock'] else 'waiting'))
    except Exception:
        nft.update(status='error', message='合约核验未完成，请检查节点或部署配置。')
        return result

    keyfile = settings.directory / 'mint-key'
    if not keyfile.exists():
        nft['checks'].append(dict(label='本机铸造权限', status='waiting'))
        nft['mintMessage'] = '本机无铸造授权密钥；可读取和交易，不能签发新 NFT。'
    else:
        try:
            matches = Account.from_key(keyfile.read_text().strip()).address.lower() == info['mintSigner'].lower()
            check('本机铸造权限', matches)
            if not matches:
                nft['mintMessage'] = '本机授权密钥与合约不匹配，不能铸造。'
        except Exception:
            check('本机铸造权限', False)
            nft['mintMessage'] = '本机授权密钥无法读取，不能铸造。'
    statuses = {c['status'] for c in nft['checks']}
    nft['status'] = 'error' if 'error' in statuses else 'waiting' if 'waiting' in statuses else 'ok'
    nft['message'] = {'ok': 'NFT 合约与当前配置匹配。', 'error': '存在不匹配项目，请核对部署配置。',
                      'waiting': '合约检查完成，仍有待准备项目。'}[nft['status']]
    return result


def inspect_staking(settings, store):
    result = dict(id='staking', name='NFT 质押合约', status='disabled',
                  message='尚未部署质押合约，不影响 NFT 交易。', checks=[])
    if not (settings.directory / 'staking-deployment.json').exists():
        return result
    result.update(status='unknown', message='质押配置已保存，等待核验。')
    try:
        from .staking_indexer import RpcStakingSource
        source = RpcStakingSource(settings)
        manifest = source.open()
        _, confirmed = source.boundary()
        result.update(address=manifest['address'], transactionHash=manifest['deploymentTransaction'],
                      deploymentBlock=manifest['deploymentBlock'])
        result['checks'].append(dict(label='部署身份', status='ok'))
        result['checks'].append(dict(label='部署最终确认', status='ok' if confirmed >= manifest['deploymentBlock'] else 'waiting'))
        with store.connection() as db:
            saved = db.execute('''SELECT l.state,l.updated_at,s.scanned_block,s.settled_until,s.daily_coins,
                s.chain_id,s.contract,s.deployment FROM staking_listener l
                JOIN staking_sources s ON s.source=l.source WHERE l.id=1''').fetchone()
        status = 'waiting'
        if saved:
            matches = (saved['chain_id'] == manifest['chainId'] and saved['contract'].lower() == manifest['address'].lower()
                       and saved['deployment'] == manifest['deploymentId'])
            status = ('error' if not matches or saved['state'] in ('halted','error') else 'ok'
                      if saved['state'] == 'ready' and time.time()-saved['updated_at'] <= 120 else 'waiting')
        result['checks'].append(dict(label='质押事件与奖励结算', status=status))
        statuses = {c['status'] for c in result['checks']}
        result['status'] = 'error' if 'error' in statuses else 'waiting' if 'waiting' in statuses else 'ok'
        result['message'] = ('质押合约与监听结算正常。' if result['status']=='ok' else
                             '质押已配置，请检查每日奖励设置和监听进度。')
    except Exception:
        result.update(status='error', message='质押核验失败，请检查部署配置和节点。')
    return result
