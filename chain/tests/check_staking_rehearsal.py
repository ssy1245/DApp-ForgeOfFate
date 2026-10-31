"""Child of isolated staking rehearsal; never touches .local user data."""
import os
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.app import create_app
from chain.server.rpc import ChainSettings
from chain.server.indexer import Indexer, RpcSource
from chain.server.staking_indexer import StakingIndexer, RpcStakingSource

settings=ChainSettings.from_env()
assert settings.network=='local' and settings.directory.name.startswith('forge-staking-')
client=TestClient(create_app(demo=True));store=client.app.state.store
stage=sys.argv[1]
if stage=='before':
    client.post('/api/session')
    response=client.post('/api/account/register',json={'username':'staking_rehearsal','password':'Rehearsal-only-123!'})
    assert response.status_code==200,response.text
    with store.connection() as db:
        account=db.execute("SELECT id FROM accounts WHERE username='staking_rehearsal'").fetchone()[0]
        db.execute('INSERT INTO wallet_bindings VALUES(?,?,?)',(account,os.environ['REHEARSAL_WALLET'],1))
else:
    response=client.post('/api/account/login',json={'username':'staking_rehearsal','password':'Rehearsal-only-123!'})
    assert response.status_code==200,response.text
staking=StakingIndexer(store,RpcStakingSource(settings),2)
indexer=Indexer(store,RpcSource(settings),2,staking=staking)
for _ in range(30):
    if indexer.tick():break
else:raise AssertionError('Failed to catch up')
config=client.get('/api/config').json()
assert config['staking']['dailyCoins']==100,config
holdings=client.get('/api/chain/staking')
assert holdings.status_code==200,holdings.text
holdings=holdings.json()
assert holdings['account'].lower()==os.environ['REHEARSAL_WALLET'].lower()
if stage=='before':
    assert len(holdings['positions'])==1 and holdings['positions'][0]['positionId']=='1'
    assert holdings['available']==[]
else:
    assert holdings['positions']==[] and len(holdings['available'])==1
    assert not holdings['available'][0]['approved']
source=RpcStakingSource(settings);manifest=source.open()
logs=source.logs(manifest['deploymentBlock'],source.w3.eth.block_number)
for event in logs:
    receipt=client.get('/api/chain/staking/receipts/'+event['transaction_hash'])
    assert receipt.status_code==200,receipt.text
    assert receipt.json()['state']=='confirmed' and receipt.json()['deploymentId']==manifest['deploymentId']
mail=client.get('/api/mail').json()
if stage=='before':
    assert mail['total']==0,mail
elif stage=='after':
    assert sorted(m['coins'] for m in mail['items'])==[50,50,100],mail
    assert client.get('/api/state').json()['player']['coins']==0
    response=client.post('/api/mail/claim-all',headers={'Idempotency-Key':'rehearsal-claim'})
    assert response.status_code==200,response.text
    assert response.json()['coinsAdded']==200,response.text
    repeated=client.post('/api/mail/claim-all',headers={'Idempotency-Key':'rehearsal-claim'})
    assert repeated.json()==response.json()
    assert client.post('/api/mail/claim-all',headers={'Idempotency-Key':'rehearsal-again'}).json()['coinsAdded']==0
else:
    assert mail['total']==0
    assert client.get('/api/state').json()['player']['coins']==200
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM reward_mail').fetchone()[0]==3
        assert db.execute('SELECT COUNT(*) FROM reward_mail_claims').fetchone()[0]==3
        assert db.execute('SELECT total_coins FROM staking_positions').fetchone()[0]=='200'
print(f'PASS isolated staking stage: {stage}')
