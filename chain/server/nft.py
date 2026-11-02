"""NFT metadata and server mint authorization; game eligibility is checked by the API."""
import base64
import json
import time
from pathlib import Path

from eth_account import Account
from eth_account.messages import encode_typed_data
from fastapi import HTTPException
from web3 import Web3

from backend.game import weapon_tier, weapon_can_mint

ROOT = Path(__file__).resolve().parents[2]
NFT_IMAGES = json.loads((ROOT / 'assets/NFT_Pic/manifest.json').read_text(encoding='utf-8'))['images']
TYPES = {'Voucher': [
    {'name': 'weaponId', 'type': 'bytes32'}, {'name': 'recipient', 'type': 'address'},
    {'name': 'level', 'type': 'uint256'}, {'name': 'uri', 'type': 'string'},
    {'name': 'deadline', 'type': 'uint256'}, {'name': 'deploymentId', 'type': 'bytes32'}]}


def metadata(weapon):
    branch = weapon.get('branch', 'longsword')
    tier = weapon_tier(weapon['level'], branch)
    prefix = '[DEMO] ' if weapon['demo'] else ''
    data = {'name': f"{prefix}{tier['name']} +{weapon['level']}",
            'name_en': f"{prefix}{tier['name_en']} +{weapon['level']}",
            'tier_id': tier['id'],
            'description': 'Sealed Forge of Fate collectible. Attributes are permanently fixed.',
            'image': NFT_IMAGES[branch],
            'attributes': [{'trait_type': 'Level', 'value': weapon['level']}, {'trait_type': 'Demo', 'value': bool(weapon['demo'])}, {'trait_type': 'Weapon Type', 'value': weapon.get('branch', 'longsword')}]}
    return 'data:application/json;base64,' + base64.b64encode(json.dumps(data, ensure_ascii=False).encode()).decode()


def mint_authorization(settings, info, contract, weapon, recipient):
    wid, w = weapon['id'], weapon
    if not weapon_can_mint(w['level'], w.get('branch', 'longsword')):
        raise HTTPException(409, '只有达到本路线最终形态且未超过等级上限的武器才能铭刻 NFT。')
    try:
        already_minted = contract.functions.exists(int(wid, 16)).call()
    except Exception:
        raise HTTPException(503, '链上数据暂时无法读取，请稍后重试。') from None
    if already_minted:
        raise HTTPException(409, '这把武器已铸造，请刷新链上收藏。')
    keyfile = settings.directory / 'mint-key'
    if not keyfile.exists():
        raise HTTPException(503, '缺少当前环境的铸造授权密钥，请恢复原配置。')
    try:
        signing_key = keyfile.read_text().strip()
        if Account.from_key(signing_key).address.lower() != info['mintSigner'].lower():
            raise ValueError('wrong authority')
    except Exception:
        raise HTTPException(503, '铸造授权配置与当前合约不匹配。') from None
    data = {'weaponId': wid, 'recipient': recipient, 'level': w['level'], 'uri': metadata(w), 'deadline': int(time.time()) + 600, 'deploymentId': info['deploymentId']}
    domain = {'name': 'ForgeOfFate', 'version': '1', 'chainId': info['chainId'], 'verifyingContract': info['address']}
    signed = Account.sign_message(encode_typed_data(domain, TYPES, data), signing_key)
    return {'voucher': data, 'signature': Web3.to_hex(signed.signature)}
