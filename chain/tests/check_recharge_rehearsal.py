"""Isolated real RPC integration, invoked by recharge-rehearsal.cjs."""
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.app import create_app
from chain.server.rpc import ChainSettings
from chain.server.recharge_indexer import RechargeIndexer,RpcRechargeSource

settings=ChainSettings.from_env()
assert settings.network=='local' and settings.directory.name.startswith('forge-recharge-')
client=TestClient(create_app(demo=True));store=client.app.state.store;stage=sys.argv[1]
credentials=dict(username='recharge_rehearsal',password='Rehearsal-only-123!')
if stage=='before':
    client.post('/api/session')
    response=client.post('/api/account/register',json=credentials)
    assert response.status_code==200,response.text
    with store.connection() as db:
        account=db.execute('SELECT id FROM accounts WHERE username=?',(credentials['username'],)).fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,os.environ['REHEARSAL_WALLET'],1))
else:
    response=client.post('/api/account/login',json=credentials);assert response.status_code==200,response.text
source=RpcRechargeSource(settings);worker=RechargeIndexer(store,source,2)
for _ in range(30):
    if worker.tick():break
else:raise AssertionError('Failed to catch up')
config=client.get('/api/config').json()['recharge']
assert config['coinsPerUnit']==10000 and config['weiPerUnit']=='10000000000000000' and config['ready'],config
history=client.get('/api/chain/recharge').json()
assert history['account']==os.environ['REHEARSAL_WALLET'].lower()
assert history['total']==(1 if stage=='before' else 4),history
assert sum(int(row['coins']) for row in history['items'])==(10000 if stage=='before' else 15001)
assert all(row['credited_at'] is not None for row in history['items'])
assert client.get('/api/state').json()['player']['coins']==(10000 if stage=='before' else 15001)
for entry in history['items']:
    response=client.get('/api/chain/recharge/receipts/'+entry['tx_hash'])
    assert response.status_code==200,response.text
    assert response.json()['state']=='confirmed' and response.json()['deploymentId']==config['deploymentId']
    assert response.json()['credit']['state']=='credited'
    assert response.json()['credit']['coins']==entry['coins']
assert not client.get('/api/mail').json()['items'] # Recharge is immediate balance credit, not a staking reward.
assert client.get('/api/chain/recharge/treasury').status_code==403
assert any(entry.get('name')=='withdraw' for entry in config['abi'])
client.post('/api/account/logout');client.post('/api/session')
admin=dict(username='recharge_treasury',password='Rehearsal-only-123!')
if stage=='before':
    response=client.post('/api/account/register',json=admin);assert response.status_code==200,response.text
    with store.connection() as db:
        account=db.execute('SELECT id FROM accounts WHERE username=?',(admin['username'],)).fetchone()[0]
        db.execute("UPDATE accounts SET role='tester' WHERE id=?",(account,))
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,config['treasury'],1))
else:
    response=client.post('/api/account/login',json=admin);assert response.status_code==200,response.text
result=client.get('/api/chain/recharge/treasury');assert result.status_code==200,result.text
assert result.json()['balanceWei']==('10000000000000000' if stage=='before' else '0'),result.text
assert result.json()['treasury']==config['treasury']
assert result.json()['canManageAdmins'] and result.json()['isAdmin']
assert (os.environ['REHEARSAL_ADMIN'] in result.json()['admins'])==(stage!='after')
assert client.get('/api/state').json()['player']['coins']==0
client.post('/api/account/logout');client.post('/api/session')
delegate=dict(username='recharge_delegate',password='Rehearsal-only-123!')
if stage=='before':
    response=client.post('/api/account/register',json=delegate);assert response.status_code==200,response.text
    with store.connection() as db:
        account=db.execute('SELECT id FROM accounts WHERE username=?',(delegate['username'],)).fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,os.environ['REHEARSAL_ADMIN'],1))
else:
    response=client.post('/api/account/login',json=delegate);assert response.status_code==200,response.text
assert client.get('/api/state').json()['player']['role']=='player'
result=client.get('/api/chain/recharge/treasury')
assert result.status_code==(403 if stage=='after' else 200),result.text
if stage!='after':
    assert result.json()['isAdmin'] and not result.json()['canManageAdmins'] and result.json()['admins']==[]
    assert result.json()['treasury']==config['treasury']
assert client.get('/api/state').json()['player']['coins']==0
print('PASS isolated recharge stage:',stage)
