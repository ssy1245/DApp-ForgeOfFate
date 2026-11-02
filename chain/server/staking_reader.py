"""Read-only current staking custody. Rewards still use finalized indexer events."""
import json
from fastapi import HTTPException
from web3 import Web3
from .rpc import ChainReader
from .staking_indexer import RpcStakingSource, STAKING_ABI

UI_ABI = [*STAKING_ABI,
    {'type':'function','name':'activePosition','stateMutability':'view','inputs':[{'name':'tokenId','type':'uint256'}],'outputs':[{'name':'','type':'uint256'}]},
    {'type':'function','name':'positions','stateMutability':'view','inputs':[{'name':'positionId','type':'uint256'}],
     'outputs':[{'name':name,'type':kind} for name,kind in [('staker','address'),('tokenId','uint256'),('startedAt','uint256'),('endedAt','uint256')]]},
    *[{'type':'function','name':name,'stateMutability':'nonpayable','inputs':[{'name':field,'type':'uint256'}],
       'outputs':([] if name=='unstake' else [{'name':'positionId','type':'uint256'}])} for name,field in [('stake','tokenId'),('unstake','positionId')]]]


class StakingReader(ChainReader):
    def public_config(self, nft):
        file = self.settings.directory / 'staking-deployment.json'
        if not file.exists():
            return None
        try:
            info = json.loads(file.read_text())
            if (info.get('manifestVersion') != 2 or info['chainId'] != nft['chainId']
                    or info['nftAddress'].lower() != nft['address'].lower()
                    or info['nftDeploymentId'] != nft['deploymentId']
                    or not Web3.is_address(info['address']) or len(bytes.fromhex(info['deploymentId'][2:])) != 32):
                raise ValueError()
            return {key:info[key] for key in ('address','chainId','deploymentId','nftAddress')} | {'abi':UI_ABI}
        except Exception:
            raise HTTPException(503, '质押配置与当前 NFT 不匹配，请检查部署记录。') from None

    def connect(self):
        source = RpcStakingSource(self.settings)
        try:
            manifest = source.open()
            if manifest is None:
                raise ValueError()
            return source.info, source.w3, source.w3.eth.contract(address=manifest['address'],abi=UI_ABI)
        except Exception:
            raise HTTPException(503, '质押合约暂时无法核验，请检查部署和节点。') from None

    def holdings(self, account):
        if not Web3.is_address(account):
            raise HTTPException(400, '钱包地址无效。')
        account = Web3.to_checksum_address(account)
        info,w3,staking = self.connect()
        try:
            nft_info=json.loads((self.settings.directory/'deployment.json').read_text())
            nft=w3.eth.contract(address=nft_info['address'],abi=nft_info['abi'])
            block=w3.eth.block_number
            tokens=nft.functions.allTokens().call(block_identifier=block)
            available,positions=[],[]
            for token in tokens:
                owner=nft.functions.ownerOf(token).call(block_identifier=block)
                if owner.lower()==account.lower():
                    _,price=nft.functions.listings(token).call(block_identifier=block)
                    if price>0:
                        continue  # Delist first; sale and staking are separate UI flows.
                    approved=(nft.functions.getApproved(token).call(block_identifier=block).lower()==info['address'].lower()
                              or nft.functions.isApprovedForAll(account,info['address']).call(block_identifier=block))
                    available.append({'tokenId':str(token),'approved':bool(approved)})
                elif owner.lower()==info['address'].lower():
                    position_id=staking.functions.activePosition(token).call(block_identifier=block)
                    if not position_id:
                        continue  # An accidental raw transfer is not a staking position.
                    staker,position_token,started,ended=staking.functions.positions(position_id).call(block_identifier=block)
                    if staker.lower()==account.lower() and position_token==token and ended==0:
                        positions.append({'positionId':str(position_id),'tokenId':str(token),'startedAt':int(started)})
            return {'account':account,'chainId':info['chainId'],'deploymentId':info['deploymentId'],
                    'blockNumber':block,'available':available,'positions':positions}
        except Exception:
            raise HTTPException(503, '质押状态暂时无法读取，请稍后重试。') from None
