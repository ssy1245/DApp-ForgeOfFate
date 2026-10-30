"""Browser-test helper: verify exported NFT files against the owned rehearsal chain."""
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
directory = Path(sys.argv[1]).resolve()
assert directory.is_relative_to(root / '.local' / 'deploy-console')
assert directory.name == 'game'
sys.path.insert(0, str(root))
os.environ.update(FORGE_NETWORK='local', FORGE_LOCAL_DIR=str(directory), FORGE_RPC_URL=sys.argv[2])

from chain.server.rpc import ChainSettings, NETWORKS
# Deliberately isolated from the game's supported networks; never change production config.
NETWORKS['local']['chainId'] = 31338
from backend.app import create_app
from chain.server.indexer import RpcSource, Indexer
from fastapi.testclient import TestClient

app = create_app()
with TestClient(app) as client:
    info = json.loads((directory / 'deployment.json').read_text())
    config = client.get('/api/config').json()
    assert config['chain']['address'] == info['address']
    assert config['chain']['deploymentId'] == info['deploymentId']
    source = RpcSource(ChainSettings.from_env())
    indexer = Indexer(app.state.store, source)
    indexer.initialize(source.open())
    assert indexer.tick()
    items = client.get('/api/chain/nfts').json()['items']
    assert len(items) == 1 and items[0]['id'] == sys.argv[3]
    with app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM chain_nfts').fetchone()[0] == 1
        assert db.execute('SELECT token_id FROM chain_nfts').fetchone()[0] == sys.argv[3]
print(json.dumps({'connected': True, 'indexed': True, 'nftCount': len(items)}))
