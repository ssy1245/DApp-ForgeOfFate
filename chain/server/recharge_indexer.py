"""Independent finalized recharge cursor; event, conversion and credit commit together."""
import json
import time

from fastapi import HTTPException
from web3 import Web3

from backend.recharge import register_source, record_deposit, credit_pending, rate
from .rpc import ChainReader, NETWORKS
from .indexer import RpcSource, IndexFailure, IndexHalt, deployment_details, hex_value

ABI = [
    {'type':'function','name':name,'stateMutability':'view','inputs':[],
     'outputs':[{'name':'','type':kind}]} for name,kind in [('deploymentId','bytes32'),('treasury','address')]]
ABI += [{'type':'function','name':'deposit','stateMutability':'payable','inputs':[],
         'outputs':[{'name':'depositId','type':'uint256'}]},
        {'type':'function','name':'withdraw','stateMutability':'nonpayable',
         'inputs':[{'name':'amount','type':'uint256'}],'outputs':[]},
        {'type':'event','name':'Deposited','anonymous':False,'inputs':[
            {'name':'depositId','type':'uint256','indexed':True},
            {'name':'payer','type':'address','indexed':True},
            {'name':'amount','type':'uint256','indexed':False}]}]
ABI += [{'type':'function','name':'isAdmin','stateMutability':'view',
         'inputs':[{'name':'admin','type':'address'}],'outputs':[{'name':'','type':'bool'}]},
        {'type':'function','name':'getAdmins','stateMutability':'view','inputs':[],
         'outputs':[{'name':'','type':'address[]'}]}]
ABI += [{'type':'function','name':name,'stateMutability':'nonpayable',
         'inputs':[{'name':'admin','type':'address'}],'outputs':[]} for name in ['addAdmin','removeAdmin']]


def manifest_info(settings):
    file=settings.directory/'recharge-deployment.json'
    if not file.exists(): return None
    info=json.loads(file.read_text())
    if (info.get('manifestVersion')!=2 or info.get('module')!='forge-recharge'
            or info.get('chainId')!=NETWORKS[settings.network]['chainId']
            or not Web3.is_address(info.get('address','')) or not Web3.is_address(info.get('treasury',''))
            or len(bytes.fromhex(info.get('deploymentId','')[2:]))!=32
            or type(info.get('deploymentBlock')) is not int or info['deploymentBlock']<1):
        raise IndexHalt('充值部署配置无效，已停止入账。')
    return info


class RpcRechargeSource(RpcSource):
    def open(self):
        info=manifest_info(self.settings)
        if info is None: return None
        if not self.settings.rpc: raise IndexFailure('充值节点未配置。')
        self.w3=Web3(Web3.HTTPProvider(self.settings.rpc,request_kwargs={'timeout':5}))
        self.contract=self.w3.eth.contract(address=info['address'],abi=ABI)
        if (self.w3.eth.chain_id!=info['chainId']
                or hex_value(self.contract.functions.deploymentId().call())!=info['deploymentId']
                or self.contract.functions.treasury().call().lower()!=info['treasury'].lower()):
            raise IndexHalt('充值合约部署身份或收款钱包不匹配。')
        receipt=self.w3.eth.get_transaction_receipt(info['deploymentTransaction'])
        actual=deployment_details(info,self.w3,receipt)
        required=['deploymentTransaction','deploymentBlock','deploymentBlockHash','genesisHash','runtimeCodeHash']
        if any(actual[k]!=info[k] for k in required):
            raise IndexHalt('充值部署回执或合约代码不匹配。')
        self.info=info
        self.topics=[hex_value(Web3.keccak(text='Deposited(uint256,address,uint256)'))]
        return {k:info[k] for k in ['address','chainId','deploymentId','treasury',*required]}

    def block(self, number):
        b=self.w3.eth.get_block(number)
        return {'number':int(b['number']),'hash':hex_value(b['hash'])}


class RechargeReader(ChainReader):
    def treasury_status(self, account):
        info,w3,contract=self.connect()
        try:
            block=w3.eth.get_block('latest')
            account=Web3.to_checksum_address(account)
            if not contract.functions.isAdmin(account).call(block_identifier=block['number']):
                raise HTTPException(403,'当前钱包不是充值合约管理员，或权限已被移除。')
            can_manage=account.lower()==info['treasury'].lower()
            admins=contract.functions.getAdmins().call(block_identifier=block['number']) if can_manage else []
            balance=w3.eth.get_balance(info['address'],block_identifier=block['number'])
            return {k:info[k] for k in ['address','chainId','deploymentId','treasury']}|{
                'balanceWei':str(balance),'blockNumber':block['number'],'account':account,
                'isAdmin':True,'canManageAdmins':can_manage,'admins':admins}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503,'充值合约余额暂时无法读取，请稍后重试。') from None

    def public_config(self):
        try:
            info=manifest_info(self.settings)
            return ({k:info[k] for k in ['address','chainId','deploymentId','treasury']}|{'abi':ABI}) if info else None
        except Exception:
            raise HTTPException(503,'充值部署配置无效，请检查本机部署记录。') from None

    def connect(self):
        try:
            source=RpcRechargeSource(self.settings)
            if source.open() is None: raise ValueError()
            return source.info,source.w3,source.contract
        except Exception:
            raise HTTPException(503,'充值合约暂时无法核验，请检查节点或部署配置。') from None


class RechargeIndexer:
    def __init__(self,store,source,batch_size=500,conversion=None):
        if not 1<=batch_size<=2000: raise ValueError('Invalid batch size')
        self.store,self.source,self.batch_size,self.conversion=store,source,batch_size,conversion

    def tick(self):
        try: return self.advance()
        except Exception as error:
            halt=isinstance(error,(IndexHalt,ValueError))
            message='充值配置或已确认记录发生冲突，已暂停入账。' if halt else '充值监听暂时失败，进度已保留，将自动重试。'
            with self.store.connection() as db:
                db.execute('UPDATE recharge_sources SET state=?,message=?,updated_at=?',('halted' if halt else 'error',message,int(time.time())))
            raise (IndexHalt if halt else IndexFailure)(message) from None

    def advance(self):
        with self.store.connection() as db:
            prior=db.execute('SELECT * FROM recharge_sources LIMIT 1').fetchone()
            if prior and prior['state']=='halted': raise IndexHalt(prior['message'])
        manifest=self.source.open()
        if manifest is None:
            if prior: raise IndexHalt('Missing recharge deployment')
            return True
        try:
            conversion=self.conversion or rate()
            wei,coins=conversion
            if not 0<wei<2**256 or not 0<coins<=2**53-1: raise ValueError()
        except (ValueError,TypeError):
            raise IndexFailure('Invalid recharge rate configuration') from None
        if prior and (int(prior['wei_per_unit']),prior['coins_per_unit'])!=conversion:
            # Restoring the original backend settings may safely resume. Never reprice history.
            raise IndexFailure('Restore the original recharge rate')
        head,confirmed=self.source.boundary()
        if not 0<=confirmed<=head: raise IndexFailure('Invalid recharge finality')
        if not prior and confirmed<manifest['deploymentBlock']: return True
        anchor=self.source.block(manifest['deploymentBlock']-1)
        with self.store.connection() as db:
            source=register_source(db,manifest,anchor,conversion)
            saved=dict(db.execute('SELECT * FROM recharge_sources WHERE source=?',(source,)).fetchone())
        if confirmed<saved['scanned_block'] or self.source.block_hash(saved['scanned_block'])!=saved['scanned_hash']:
            raise IndexHalt('Finalized recharge history changed')
        start=saved['scanned_block']+1;end=min(confirmed,start+self.batch_size-1)
        if start<=end:
            while True:
                boundary=self.source.block(end)
                try: logs=self.source.logs(start,end);break
                except Exception:
                    if start==end: raise IndexFailure('Recharge logs unavailable') from None
                    end=start+(end-start)//2
            events=[];seen={};blocks={}
            for item in sorted(logs,key=lambda e:(e['block_number'],e['log_index'])):
                block=item['block_number'];identity=(block,item['log_index'])
                if (not start<=block<=end or item['contract_address'].lower()!=manifest['address'].lower()
                        or item['name']!='Deposited'): raise IndexFailure('Unexpected recharge log')
                if block not in blocks: blocks[block]=self.source.block_hash(block)
                if item['block_hash']!=blocks[block]: raise IndexFailure('Recharge block changed')
                if identity in seen:
                    if seen[identity]!=item: raise IndexFailure('Conflicting recharge log')
                    continue
                seen[identity]=item;args=item['args']
                events.append({'deposit_id':str(args['depositId']),'amount_wei':str(args['amount']),
                    'wallet':args['payer'],'tx_hash':item['transaction_hash'],'block_number':block,
                    'block_hash':item['block_hash'],'log_index':item['log_index']})
            if (self.source.block_hash(end)!=boundary['hash']
                    or self.source.block_hash(saved['scanned_block'])!=saved['scanned_hash']):
                raise IndexFailure('Recharge boundary changed')
            with self.store.connection() as db:
                current=db.execute('SELECT scanned_block FROM recharge_sources WHERE source=?',(source,)).fetchone()[0]
                if current!=saved['scanned_block']: raise IndexFailure('Recharge cursor updated by another worker')
                for event in events: record_deposit(db,source,event)
                credit_pending(db,source)
                db.execute('UPDATE recharge_sources SET scanned_block=?,scanned_hash=? WHERE source=?',(end,boundary['hash'],source))
        with self.store.connection() as db:
            delivered=credit_pending(db,source)
            ready=(start>confirmed or end==confirmed) and delivered<500
            db.execute("UPDATE recharge_sources SET state=?,message='',updated_at=? WHERE source=?",('ready' if ready else 'syncing',int(time.time()),source))
        return ready
