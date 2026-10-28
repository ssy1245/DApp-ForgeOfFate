"""Keep even the module-level ASGI app away from the user's active save."""
import atexit
import os
import tempfile

_directory = tempfile.TemporaryDirectory(prefix='forge-backend-tests-')
atexit.register(_directory.cleanup)
os.environ['FORGE_NETWORK'] = 'local'
os.environ['FORGE_LOCAL_DIR'] = _directory.name
os.environ.pop('FORGE_RPC_URL', None)

