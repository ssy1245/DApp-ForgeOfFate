import copy

import pytest

from backend.tests.test_cheats import tester
from backend.tests.test_staking_rewards import BASE, DAY, WALLET, CONTRACT, hash_, rows
from chain.server.indexer import IndexFailure, IndexHalt
from chain.server.staking_indexer import StakingIndexer


class Source:
    def __init__(self):
        self.manifest = dict(address=CONTRACT,chainId=31337,deploymentId='epoch',deploymentBlock=1)
        self.head = self.confirmed = 4
        self.blocks = {i: dict(number=i,hash=hash_(i),timestamp=BASE+i*DAY//2) for i in range(8)}
        self.events = []
        self.calls=[]
    def open(self):return copy.deepcopy(self.manifest)
    def boundary(self):return self.head,self.confirmed
    def block(self,n):return self.blocks[n].copy()
    def block_hash(self,n):return self.blocks[n]['hash']
    def logs(self,start,end):
        self.calls.append((start,end))
        return copy.deepcopy([e for e in self.events if start<=e['block_number']<=end])
    def add(self,name,block=1,position='1',token='17',index=0):
        field='startedAt' if name=='Staked' else 'endedAt'
        self.events.append(dict(block_number=block,block_hash=self.block_hash(block),log_index=index,
            transaction_index=0,transaction_hash=hash_(block),contract_address=CONTRACT,
            name=name,args=dict(positionId=position,tokenId=token,staker=WALLET,**{field:self.blocks[block]['timestamp']})))


@pytest.fixture
def index(tester):
    client,owner,_=tester
    store=client.app.state.store
    with store.connection() as db:
        account=db.execute('SELECT id FROM accounts WHERE game_address=?',(owner,)).fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,WALLET,BASE))
    source=Source();source.add('Staked');source.add('Unstaked',3)
    return store,source,StakingIndexer(store,source,2,daily_coins=100)


def catch_up(indexer):
    for _ in range(20):
        if indexer.tick():return
    raise AssertionError('Did not catch up')


def test_finalized_stake_and_withdrawal_make_daily_mail_and_restart_no_duplicate(index):
    store,source,indexer=index
    assert not indexer.tick()
    assert [r['coins'] for r in rows(store,'reward_mail')]==[50]
    assert indexer.tick()
    assert [r['coins'] for r in rows(store,'reward_mail')]==[50,50]
    catch_up(StakingIndexer(store,source,daily_coins=100))
    assert len(rows(store,'reward_mail'))==2
    assert rows(store,'staking_listener')[0]['state']=='ready'


def test_only_finalized_history_counts_and_no_finality_fallback(index):
    store,source,indexer=index
    source.confirmed=1
    catch_up(indexer)
    assert not rows(store,'reward_mail')
    source.confirmed=4
    source.boundary=lambda: (_ for _ in ()).throw(RuntimeError('secret rpc url'))
    with pytest.raises(IndexFailure) as error:indexer.tick()
    assert 'secret' not in str(error.value)
    assert not rows(store,'reward_mail')
    assert rows(store,'staking_sources')[0]['scanned_block']==1


def test_waits_for_deployment_finality_and_no_config_is_noop(index):
    store,source,indexer=index
    source.confirmed=0
    assert indexer.tick() and not rows(store,'staking_sources')
    source.manifest=None
    assert indexer.tick() and not rows(store,'staking_sources')


@pytest.mark.parametrize('change',['hash','boundary','manifest','missing'])
def test_saved_chain_or_configuration_conflicts_halt_and_persist(index,change):
    store,source,indexer=index;catch_up(indexer)
    if change=='hash':source.blocks[4]['hash']=hash_(999)
    if change=='boundary':source.confirmed=3
    if change=='manifest':source.manifest['deploymentId']='other'
    if change=='missing':source.manifest=None
    with pytest.raises(IndexHalt):indexer.tick()
    assert rows(store,'staking_listener')[0]['state']=='halted'
    assert len(rows(store,'reward_mail'))==2
    with pytest.raises(IndexHalt):StakingIndexer(store,source,daily_coins=100).tick()


@pytest.mark.parametrize('change',['timestamp','contract','hash','unknown','duplicate_conflict'])
def test_bad_rpc_log_never_advances_or_issues_rewards(index,change):
    store,source,indexer=index
    if change=='timestamp':source.events[0]['args']['startedAt']+=1
    if change=='contract':source.events[0]['contract_address']=WALLET
    if change=='hash':source.events[0]['block_hash']=hash_(99)
    if change=='unknown':source.events[0]['name']='Transfer'
    if change=='duplicate_conflict':
        item=copy.deepcopy(source.events[0]);item['args']['tokenId']='99';source.events.append(item)
    with pytest.raises(IndexFailure):indexer.tick()
    assert not rows(store,'staking_positions') and not rows(store,'reward_mail')
    assert rows(store,'staking_sources')[0]['scanned_block']==0


def test_duplicate_rpc_log_and_provider_range_limits(index):
    store,source,indexer=index
    source.events.append(copy.deepcopy(source.events[0]))
    original=source.logs
    def limited(start,end):
        if end>start:raise RuntimeError('range limit')
        return original(start,end)
    source.logs=limited
    catch_up(indexer)
    assert len(rows(store,'staking_positions'))==1
    assert [r['coins'] for r in rows(store,'reward_mail')]==[50,50]


def test_invalid_rate_cannot_overwrite_prior_settlement(index):
    store,source,indexer=index;catch_up(indexer)
    with pytest.raises(IndexFailure):StakingIndexer(store,source,daily_coins=101).tick()
    assert rows(store,'staking_sources')[0]['daily_coins']==100
    assert sum(r['coins'] for r in rows(store,'reward_mail'))==100
