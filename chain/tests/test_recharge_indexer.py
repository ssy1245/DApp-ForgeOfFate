import copy
import pytest
from backend.storage import Store
from backend.tests.test_cheats import tester
from backend.tests.test_recharge import setup, balance
from backend.tests.test_staking_rewards import WALLET, CONTRACT, rows, hash_
from chain.tests.test_staking_indexer import Source, catch_up
from chain.server.recharge_indexer import RechargeIndexer
from chain.server.indexer import IndexFailure, IndexHalt

def index(tester):
    c,store,_=setup(tester)
    with store.connection() as db:db.execute('DELETE FROM recharge_sources')
    source=Source()
    source.events=[dict(block_number=b,block_hash=hash_(b),log_index=0,transaction_hash=hash_(b),
        contract_address=CONTRACT,name='Deposited',args=dict(depositId=b,payer=WALLET,amount=10**16)) for b in [1,3]]
    return c,store,source,RechargeIndexer(store,source,2,(10**16,10000))

def test_finalized_only_then_offline_catchup_restart_dedup(tester):
    c,store,source,worker=index(tester);source.confirmed=1
    catch_up(worker);assert balance(c)==10000
    source.confirmed=4
    catch_up(RechargeIndexer(Store(store.path),source,2,(10**16,10000)))
    assert balance(c)==20000
    catch_up(worker);assert balance(c)==20000 and len(rows(store,'recharge_deposits'))==2

def test_duplicate_provider_logs_and_range_retry(tester):
    c,store,source,worker=index(tester)
    source.events.append(copy.deepcopy(source.events[0]));original=source.logs
    def limited(a,b):
        if b>a:raise RuntimeError('range limit')
        return original(a,b)
    source.logs=limited;catch_up(worker)
    assert balance(c)==20000 and rows(store,'recharge_sources')[0]['scanned_block']==4

@pytest.mark.parametrize('change',['hash','boundary','manifest','missing'])
def test_conflicts_halt_without_recrediting(tester,change):
    c,store,source,worker=index(tester);catch_up(worker)
    if change=='hash':source.blocks[4]['hash']=hash_(999)
    if change=='boundary':source.confirmed=3
    if change=='manifest':source.manifest['deploymentId']='other'
    if change=='missing':source.manifest=None
    with pytest.raises(IndexHalt):worker.tick()
    assert rows(store,'recharge_sources')[0]['state']=='halted' and balance(c)==20000
    with pytest.raises(IndexHalt):worker.tick()

def test_restore_original_rate_resumes_without_repricing_offline_payment(tester):
    c,store,source,worker=index(tester);source.confirmed=1;catch_up(worker)
    source.confirmed=4;worker.conversion=(10**16,20000)
    with pytest.raises(IndexFailure):worker.tick()
    assert balance(c)==10000 and rows(store,'recharge_sources')[0]['scanned_block']==1
    worker.conversion=(10**16,10000);catch_up(worker)
    assert balance(c)==20000 and rows(store,'recharge_sources')[0]['state']=='ready'

@pytest.mark.parametrize('change',['contract','hash','kind','duplicate','unavailable'])
def test_bad_or_unavailable_rpc_preserves_cursor_and_balance(tester,change):
    c,store,source,worker=index(tester)
    if change=='contract':source.events[0]['contract_address']=WALLET
    if change=='hash':source.events[0]['block_hash']=hash_(999)
    if change=='kind':source.events[0]['name']='Withdrawn'
    if change=='duplicate':
        e=copy.deepcopy(source.events[0]);e['args']['amount']=99;source.events.append(e)
    if change=='unavailable':source.logs=lambda a,b:(_ for _ in ()).throw(RuntimeError('private RPC secret'))
    with pytest.raises(IndexFailure) as err:worker.tick()
    assert 'secret' not in str(err.value)
    assert balance(c)==0 and not rows(store,'recharge_deposits')
    assert rows(store,'recharge_sources')[0]['scanned_block']==0

def test_unfinalized_deployment_and_missing_manifest_are_noop(tester):
    c,store,source,worker=index(tester);source.confirmed=0
    assert worker.tick() and not rows(store,'recharge_sources')
    source.manifest=None
    assert worker.tick() and balance(c)==0

def test_finality_failure_never_falls_back_to_head(tester):
    c,store,source,worker=index(tester)
    source.boundary=lambda:(_ for _ in ()).throw(RuntimeError('no finalized'))
    with pytest.raises(IndexFailure):worker.tick()
    assert balance(c)==0 and not rows(store,'recharge_sources')
