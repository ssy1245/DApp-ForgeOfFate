import base64
import hashlib
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from web3 import Web3

from .accounts import normalize_username, hash_password, verify_password
from .game import BALANCE, probabilities, recycle_price, strike, weapon_name, SWORD_BRANCHES

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / '.local'
TYPES = {'Voucher': [
    {'name': 'weaponId', 'type': 'bytes32'}, {'name': 'recipient', 'type': 'address'},
    {'name': 'level', 'type': 'uint256'}, {'name': 'uri', 'type': 'string'},
    {'name': 'deadline', 'type': 'uint256'}, {'name': 'deploymentId', 'type': 'bytes32'}]}

class AddressBody(BaseModel):
    address: str

class LoginBody(BaseModel):
    challenge_id: str
    signature: str

class StrikeBody(BaseModel):
    shield: bool = False
    expected_level: int
    expected_strikes: int
    expected_protected_left: int

class BranchChoice(BaseModel):
    branch: Literal['longsword','rapier']

class Credentials(BaseModel):
    username: str = Field(min_length=3,max_length=24)
    password: str = Field(min_length=8,max_length=128)

class CheatResources(BaseModel):
    resource: Literal['ap','materials','shields','coins','all']
    amount: int = Field(ge=1,le=1_000_000,strict=True)

class CheatWeapons(BaseModel):
    count: int = Field(default=1,ge=1,le=100,strict=True)
    level: int = Field(default=0,ge=0,le=BALANCE['max_level'],strict=True)
    quality: Literal['普通','精良'] = '普通'

class CheatWeaponEdit(BaseModel):
    level: int | None = Field(default=None,ge=0,le=BALANCE['max_level'],strict=True)
    heated: bool | None = None
    protected_left: int | None = Field(default=None,ge=0,le=100,strict=True)

class Store:
    def __init__(self, path):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS players(address TEXT PRIMARY KEY,ap INTEGER DEFAULT 0,materials INTEGER DEFAULT 0,shields INTEGER DEFAULT 0,coins INTEGER DEFAULT 0,claim_day TEXT,demo_claimed INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,address TEXT,message TEXT,expires INTEGER);
            CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,address TEXT,expires INTEGER);
            CREATE TABLE IF NOT EXISTS weapons(id TEXT PRIMARY KEY,owner TEXT,level INTEGER DEFAULT 0,status TEXT DEFAULT 'active',strikes INTEGER DEFAULT 0,protected_left INTEGER DEFAULT 0,demo INTEGER DEFAULT 0,created INTEGER);
            CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,game_address TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS operations(address TEXT,key TEXT,fingerprint TEXT,response TEXT,PRIMARY KEY(address,key));
            ''')
            for table,column,definition in [('accounts','role',"TEXT NOT NULL DEFAULT 'player'"),('weapons','heat_ready_at','REAL DEFAULT 0'),('weapons','heat_charges','INTEGER DEFAULT 0'),('players','practice','INTEGER DEFAULT 0'),('players','guest','INTEGER DEFAULT 0'),('challenges','guest_owner','TEXT'),('players','sword_day','TEXT'),('weapons','quality',"TEXT DEFAULT '普通'"),('weapons','source',"TEXT DEFAULT 'forge'"),('weapons','branch',"TEXT NOT NULL DEFAULT 'longsword'")]:
                if column not in {row['name'] for row in db.execute(f'PRAGMA table_info({table})')}:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')
    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA busy_timeout=15000')
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


def chain():
    file = LOCAL / 'deployment.json'
    if not file.exists():
        raise HTTPException(503, '本地合约尚未部署，请先启动测试链并部署。')
    info = json.loads(file.read_text())
    w3 = Web3(Web3.HTTPProvider(os.getenv('LOCAL_RPC_URL', 'http://127.0.0.1:8545'), request_kwargs={'timeout': 3}))
    try:
        contract = w3.eth.contract(address=info['address'], abi=info['abi'])
        if w3.eth.chain_id != info['chainId'] or Web3.to_hex(contract.functions.deploymentId().call()) != info['deploymentId']:
            raise ValueError('deployment mismatch')
    except Exception:
        raise HTTPException(503, '本地链不可用或已重置，请重新部署并刷新页面。')
    return info, w3, contract


def metadata(weapon):
    image = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#181713"/><text x="256" y="245" text-anchor="middle" fill="#e8ac5c" font-size="36">FORGE OF FATE</text><text x="256" y="310" text-anchor="middle" fill="white" font-size="48">+' + str(weapon['level']) + '</text></svg>'
    data = {'name': f"{'[DEMO] ' if weapon['demo'] else ''}{weapon_name(weapon['level'], weapon.get('branch', 'longsword'))} +{weapon['level']}",
            'description': 'Sealed Forge of Fate collectible. Attributes are permanently fixed.',
            'image': 'data:image/svg+xml;base64,' + base64.b64encode(image.encode()).decode(),
            'attributes': [{'trait_type': 'Level', 'value': weapon['level']}, {'trait_type': 'Demo', 'value': bool(weapon['demo'])}, {'trait_type': 'Weapon Type', 'value': weapon.get('branch', 'longsword')}]}
    return 'data:application/json;base64,' + base64.b64encode(json.dumps(data, ensure_ascii=False).encode()).decode()


def create_app(db_path=None, demo=None):
    app = FastAPI(title='Forge of Fate', version='0.1.0')
    store = Store(db_path or str(LOCAL / 'game.sqlite3'))
    demo_enabled = os.getenv('DEMO_MODE', '0') == '1' if demo is None else demo
    app.state.store = store
    app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'], allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key'])

    @app.middleware('http')
    async def cookie_session(request: Request, call_next):
        token = request.cookies.get('forge_session')
        if token and not request.headers.get('authorization'):
            request.scope['headers'].append((b'authorization', ('Bearer '+token).encode('ascii',errors='ignore')))
        return await call_next(request)

    @app.post('/api/session')
    def open_session(request: Request, response: Response):
        token=request.cookies.get('forge_session')
        with store.connection() as db:
            if token:
                row=db.execute('SELECT p.address,p.guest FROM sessions s JOIN players p ON s.address=p.address WHERE s.token=? AND s.expires>?',(hashlib.sha256(token.encode()).hexdigest(),int(time.time()))).fetchone()
                if row:
                    account=db.execute('SELECT username,role FROM accounts WHERE game_address=?',(row['address'],)).fetchone()
                    return {'address':row['address'],'guest':bool(row['guest']),'username':account['username'] if account else None,'role':account['role'] if account else 'player'}
            address=Account.create().address
            token=secrets.token_urlsafe(32)
            db.execute('INSERT INTO players(address,guest) VALUES(?,1)',(address,))
            db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),address,int(time.time())+2592000))
        response.set_cookie('forge_session',token,httponly=True,samesite='lax',max_age=2592000)
        return {'address':address,'guest':True}

    def authenticated(authorization):
        if not authorization or not authorization.startswith('Bearer '):
            raise HTTPException(401, '游戏会话已失效，请刷新页面或登录账号。')
        digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
        with store.connection() as db:
            row = db.execute('SELECT address FROM sessions WHERE token=? AND expires>?', (digest, int(time.time()))).fetchone()
        if not row:
            raise HTTPException(401, '登录已过期，请重新登录。')
        return row['address']

    def mutate(address, key, action, payload, operation):
        if not key or not 8 <= len(key) <= 128:
            raise HTTPException(400, '缺少有效的请求标识。')
        fingerprint = hashlib.sha256(json.dumps([action, payload], sort_keys=True).encode()).hexdigest()
        with store.connection() as db:
            prior = db.execute('SELECT * FROM operations WHERE address=? AND key=?', (address, key)).fetchone()
            if prior:
                if prior['fingerprint'] != fingerprint:
                    raise HTTPException(409, '请求标识已用于另一项操作。')
                return json.loads(prior['response'])
            result = operation(db)
            db.execute('INSERT INTO operations VALUES(?,?,?,?)', (address, key, fingerprint, json.dumps(result)))
            return result

    def owned(db, address, wid, status='active'):
        weapon = db.execute('SELECT * FROM weapons WHERE id=? AND owner=?', (wid, address)).fetchone()
        if not weapon:
            raise HTTPException(404, '找不到属于当前账号的武器。')
        if weapon['status'] != status:
            raise HTTPException(409, '武器状态已变化，请刷新。')
        return dict(weapon)

    def charge(db, address, ap=0, materials=0, shields=0, coins=0):
        cursor = db.execute('UPDATE players SET ap=ap-?,materials=materials-?,shields=shields-?,coins=coins-? WHERE address=? AND ap>=? AND materials>=? AND shields>=? AND coins>=?', (ap, materials, shields, coins, address, ap, materials, shields, coins))
        if cursor.rowcount != 1:
            raise HTTPException(409, '资源不足，请领取资源或回收武器。')

    def new_weapon(db, address, level=0, demo_flag=0):
        wid = '0x' + secrets.token_hex(32)
        db.execute('INSERT INTO weapons(id,owner,level,demo,created) VALUES(?,?,?,?,?)', (wid, address, level, demo_flag, time.time_ns()))
        return wid

    @app.post('/api/account/register')
    def register(body: Credentials, response: Response, authorization: str | None = Header(default=None)):
        try:name=normalize_username(body.username)
        except ValueError as e:raise HTTPException(400,str(e))
        password_hash=hash_password(body.password)
        try:address=authenticated(authorization)
        except HTTPException:address=None
        with store.connection() as db:
            if db.execute('SELECT 1 FROM accounts WHERE username=?',(name,)).fetchone():
                raise HTTPException(409,'用户名已存在。')
            if address and db.execute('SELECT 1 FROM accounts WHERE game_address=?',(address,)).fetchone():
                raise HTTPException(409,'当前档案已经注册账号，请先退出再注册新账号。')
            if not address:
                address=Account.create().address
                db.execute('INSERT INTO players(address,guest) VALUES(?,1)',(address,))
            db.execute('INSERT INTO accounts(id,username,password_hash,game_address,created) VALUES(?,?,?,?,?)',(str(uuid.uuid4()),name,password_hash,address,int(time.time())))
            token=secrets.token_urlsafe(32)
            db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),address,int(time.time())+2592000))
            guest=bool(db.execute('SELECT guest FROM players WHERE address=?',(address,)).fetchone()[0])
        response.set_cookie('forge_session',token,httponly=True,samesite='lax',max_age=2592000)
        return {'address':address,'guest':guest,'username':name,'role':'player'}

    @app.post('/api/account/login')
    def account_login(body: Credentials,response:Response):
        try:name=normalize_username(body.username)
        except ValueError:raise HTTPException(401,'用户名或密码不正确。')
        with store.connection() as db:
            account=db.execute('SELECT * FROM accounts WHERE username=?',(name,)).fetchone()
        if not account or not verify_password(body.password,account['password_hash']):
            raise HTTPException(401,'用户名或密码不正确。')
        token=secrets.token_urlsafe(32)
        with store.connection() as db:
            row=db.execute('SELECT guest FROM players WHERE address=?',(account['game_address'],)).fetchone()
            db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),account['game_address'],int(time.time())+2592000))
        response.set_cookie('forge_session',token,httponly=True,samesite='lax',max_age=2592000)
        return {'address':account['game_address'],'guest':bool(row[0]),'username':name,'role':account['role']}

    @app.post('/api/account/logout')
    def logout(request:Request,response:Response,authorization: str | None = Header(default=None)):
        token=authorization[7:] if authorization and authorization.startswith('Bearer ') else request.cookies.get('forge_session')
        if token:
            with store.connection() as db:db.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),))
        response.delete_cookie('forge_session')
        return {'message':'已退出账号。'}

    @app.get('/api/health')
    def health():
        return {'ok': True}

    @app.get('/api/config')
    def config():
        result = {'balance': BALANCE, 'demo_mode': demo_enabled, 'chain': None, 'chain_error': None}
        try:
            info, _, _ = chain()
            result['chain'] = {k: info[k] for k in ['address', 'chainId', 'deploymentId', 'abi']}
        except HTTPException as e:
            result['chain_error'] = e.detail
        return result

    @app.post('/api/auth/challenge')
    def challenge(body: AddressBody, authorization: str | None = Header(default=None)):
        if not Web3.is_address(body.address):
            raise HTTPException(400, '钱包地址无效。')
        address = Web3.to_checksum_address(body.address)
        cid = str(uuid.uuid4())
        expiry = int(time.time()) + 300
        message = f'Forge of Fate — Local development login\nDomain: localhost\nAddress: {address}\nNonce: {cid}\nExpires: {expiry}\nSign in only. No transaction or payment.'
        guest_owner=None
        try:
            candidate=authenticated(authorization)
            with store.connection() as check:
                if check.execute('SELECT guest FROM players WHERE address=?',(candidate,)).fetchone()[0]:guest_owner=candidate
        except HTTPException:
            pass
        if guest_owner:message+=f'\nLink game progress {guest_owner} to wallet {address}. This does not mint or transfer an NFT.'
        with store.connection() as db:
            db.execute('DELETE FROM challenges WHERE expires<?', (int(time.time()),))
            db.execute('INSERT INTO challenges(id,address,message,expires,guest_owner) VALUES(?,?,?,?,?)', (cid,address,message,expiry,guest_owner))
        return {'challenge_id': cid, 'message': message}

    @app.post('/api/auth/login')
    def login(body: LoginBody, response: Response):
        with store.connection() as db:
            row = db.execute('SELECT * FROM challenges WHERE id=? AND expires>?', (body.challenge_id, int(time.time()))).fetchone()
            if not row:
                raise HTTPException(401, '登录挑战已过期或已使用。')
            try:
                signer = Account.recover_message(encode_defunct(text=row['message']), signature=body.signature)
            except Exception:
                raise HTTPException(401, '签名无效。')
            if signer.lower() != row['address'].lower():
                raise HTTPException(401, '签名与钱包不一致。')
            db.execute('DELETE FROM challenges WHERE id=?', (body.challenge_id,))
            db.execute('INSERT OR IGNORE INTO players(address) VALUES(?)', (row['address'],))
            if row['guest_owner']:
                guest=db.execute('SELECT * FROM players WHERE address=? AND guest=1',(row['guest_owner'],)).fetchone()
                if not guest:raise HTTPException(409,'此档案已经绑定，请刷新后重新签名。')
                if db.execute('SELECT 1 FROM accounts WHERE game_address=?',(row['address'],)).fetchone():
                    raise HTTPException(409,'此钱包已绑定其他账号，请使用该账号登录。')
                db.execute('UPDATE accounts SET game_address=? WHERE game_address=?',(row['address'],row['guest_owner']))
                db.execute('UPDATE weapons SET owner=? WHERE owner=?',(row['address'],row['guest_owner']))
                db.execute("UPDATE players SET ap=ap+?,materials=materials+?,shields=shields+?,coins=coins+?,sword_day=MAX(COALESCE(sword_day,''),COALESCE(?,'')),claim_day=MAX(COALESCE(claim_day,''),COALESCE(?,'')) WHERE address=?",(guest['ap'],guest['materials'],guest['shields'],guest['coins'],guest['sword_day'],guest['claim_day'],row['address']))
                db.execute('DELETE FROM sessions WHERE address=?',(row['guest_owner'],))
                db.execute('DELETE FROM players WHERE address=?',(row['guest_owner'],))
            token = secrets.token_urlsafe(32)
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), row['address'], int(time.time()) + 86400))
        response.set_cookie('forge_session',token,httponly=True,samesite='lax',max_age=86400)
        with store.connection() as db:account=db.execute('SELECT username,role FROM accounts WHERE game_address=?',(row['address'],)).fetchone()
        return {'token': token, 'address': row['address'],'guest':False,'username':account['username'] if account else None,'role':account['role'] if account else 'player'}

    @app.get('/api/state')
    def state(authorization: str | None = Header(default=None)):
        address = authenticated(authorization)
        with store.connection() as db:
            player = dict(db.execute('SELECT * FROM players WHERE address=?', (address,)).fetchone())
            day=datetime.now(timezone.utc).date().isoformat()
            if player['sword_day']!=day:
                for i in range(BALANCE['daily_swords']):
                    wid=new_weapon(db,address)
                    db.execute("UPDATE weapons SET source='daily' WHERE id=?",(wid,))
                db.execute('UPDATE players SET sword_day=? WHERE address=?',(day,address))
                player['sword_day']=day
            account=db.execute('SELECT username,created,role FROM accounts WHERE game_address=?',(address,)).fetchone()
            player['username']=account['username'] if account else None
            player['registered_at']=account['created'] if account else None
            player['role']=account['role'] if account else 'player'
            player['can_cheat']=demo_enabled and player['role']=='tester'
            weapons = [dict(w) for w in db.execute("SELECT * FROM weapons WHERE owner=? AND status NOT IN ('destroyed','recycled') ORDER BY created DESC", (address,)).fetchall()]
        player['can_claim'] = player['claim_day'] != datetime.now(timezone.utc).date().isoformat()
        for w in weapons:
            w['name'] = weapon_name(w['level'], w['branch'])
            w['probabilities'] = probabilities(w['level'], w['protected_left'] > 0)
            w['recycle_price'] = recycle_price(w['level'])
        return {'player': player, 'weapons': weapons,'can_rescue':demo_enabled and not any(w['status']=='active' for w in weapons)}

    @app.post('/api/claim')
    def claim(authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        def run(db):
            day = datetime.now(timezone.utc).date().isoformat()
            row = db.execute('SELECT claim_day FROM players WHERE address=?', (address,)).fetchone()
            if row['claim_day'] == day:
                raise HTTPException(409, '今天已领取，资源按 UTC 零点重置。')
            db.execute('UPDATE players SET ap=ap+?,materials=materials+?,shields=shields+?,claim_day=? WHERE address=?', (BALANCE['daily_ap'], BALANCE['daily_materials'], BALANCE['daily_shields'], day, address))
            return {'message': '每日资源已领取。'}
        return mutate(address, idempotency_key, 'claim', {}, run)

    @app.post('/api/forge')
    def forge(authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        def run(db):
            charge(db, address, BALANCE['forge_ap'], BALANCE['forge_materials'])
            return {'weapon_id': new_weapon(db, address), 'message': '余烬长剑锻造完成。'}
        return mutate(address, idempotency_key, 'forge', {}, run)

    def require_tester(db,address):
        if not demo_enabled:
            raise HTTPException(404,'作弊菜单仅在本地测试模式开放。')
        account=db.execute('SELECT role FROM accounts WHERE game_address=?',(address,)).fetchone()
        if not account or account['role']!='tester':
            raise HTTPException(403,'仅测试账号可以使用作弊菜单。')

    @app.post('/api/cheats/daily')
    def cheat_daily(authorization: str | None = Header(default=None),idempotency_key: str | None = Header(default=None)):
        address=authenticated(authorization)
        def run(db):
            require_tester(db,address)
            ids=[]
            for _ in range(BALANCE['daily_swords']):
                wid=new_weapon(db,address,demo_flag=1);ids.append(wid)
                db.execute("UPDATE weapons SET source='cheat' WHERE id=?",(wid,))
            db.execute('UPDATE players SET ap=MIN(ap+?,1000000000),materials=MIN(materials+?,1000000000),shields=MIN(shields+?,1000000000) WHERE address=?',(BALANCE['daily_ap'],BALANCE['daily_materials'],BALANCE['daily_shields'],address))
            return {'weapon_id':ids[0],'message':f"测试补给：已添加 {len(ids)} 把基础剑和一份每日资源，可重复领取。"}
        with store.connection() as db:require_tester(db,address)
        return mutate(address,idempotency_key,'cheat_daily',{},run)

    @app.post('/api/cheats/resources')
    def cheat_resources(body:CheatResources,authorization: str | None = Header(default=None),idempotency_key: str | None = Header(default=None)):
        address=authenticated(authorization)
        def run(db):
            require_tester(db,address)
            fields=['ap','materials','shields','coins'] if body.resource=='all' else [body.resource]
            for field in fields:
                db.execute(f'UPDATE players SET {field}=MIN({field}+?,1000000000) WHERE address=?',(body.amount,address))
            return {'message':f'测试资源已添加：+{body.amount}。'}
        with store.connection() as db:require_tester(db,address)
        return mutate(address,idempotency_key,'cheat_resources',body.model_dump(),run)

    @app.post('/api/cheats/weapons')
    def cheat_weapons(body:CheatWeapons,authorization: str | None = Header(default=None),idempotency_key: str | None = Header(default=None)):
        address=authenticated(authorization)
        def run(db):
            require_tester(db,address)
            ids=[]
            for _ in range(body.count):
                wid=new_weapon(db,address,body.level,1);ids.append(wid)
                db.execute("UPDATE weapons SET quality=?,source='cheat' WHERE id=?",(body.quality,wid))
            return {'weapon_id':ids[0],'message':f'已刷出 {body.count} 把 +{body.level} {body.quality}剑。'}
        with store.connection() as db:require_tester(db,address)
        return mutate(address,idempotency_key,'cheat_weapons',body.model_dump(),run)

    @app.post('/api/cheats/weapons/{wid}')
    def cheat_edit(wid:str,body:CheatWeaponEdit,authorization: str | None = Header(default=None),idempotency_key: str | None = Header(default=None)):
        address=authenticated(authorization)
        def run(db):
            require_tester(db,address)
            owned(db,address,wid)
            fields={k:v for k,v in body.model_dump().items() if v is not None}
            if not fields:raise HTTPException(400,'请选择要调整的属性。')
            if body.level is not None:db.execute('UPDATE weapons SET level=? WHERE id=?',(body.level,wid))
            if body.protected_left is not None:db.execute('UPDATE weapons SET protected_left=? WHERE id=?',(body.protected_left,wid))
            if body.heated is not None:db.execute('UPDATE weapons SET heat_ready_at=0,heat_charges=? WHERE id=?',(BALANCE['heat_strikes'] if body.heated else 0,wid))
            db.execute("UPDATE weapons SET demo=1,source='cheat' WHERE id=?",(wid,))
            return {'weapon_id':wid,'message':'测试属性已更新。'}
        with store.connection() as db:require_tester(db,address)
        return mutate(address,idempotency_key,'cheat_edit:'+wid,body.model_dump(),run)

    @app.post('/api/test/supply')
    def test_supply(authorization: str | None = Header(default=None),idempotency_key: str | None = Header(default=None)):
        address=authenticated(authorization)
        if not demo_enabled:raise HTTPException(404,'测试补给未启用。')
        def run(db):
            if db.execute("SELECT 1 FROM weapons WHERE owner=? AND status='active'",(address,)).fetchone():
                raise HTTPException(409,'背包仍有可强化的剑，请先使用已有武器。')
            wid=new_weapon(db,address,demo_flag=1)
            db.execute("UPDATE weapons SET source='test_supply' WHERE id=?",(wid,))
            db.execute('UPDATE players SET ap=MAX(ap,?),materials=MAX(materials,?) WHERE address=?',(BALANCE['test_supply_ap'],BALANCE['test_supply_materials'],address))
            return {'weapon_id':wid,'message':'已领取一把 +0 普通测试剑，并补足基础锻造资源。'}
        return mutate(address,idempotency_key,'test_supply',{},run)

    @app.post('/api/shop/sword')
    def coin_sword(authorization: str | None = Header(default=None),idempotency_key: str | None = Header(default=None)):
        address=authenticated(authorization)
        def run(db):
            charge(db,address,coins=BALANCE['coin_sword_price'])
            wid=new_weapon(db,address,level=BALANCE['coin_sword_level'])
            db.execute("UPDATE weapons SET quality='精良',source='coin_shop' WHERE id=?",(wid,))
            return {'weapon_id':wid,'message':f"已购买 +{BALANCE['coin_sword_level']} 精良长剑。"}
        return mutate(address,idempotency_key,'coin_sword',{},run)

    @app.post('/api/materials')
    def materials(authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        def run(db):
            charge(db, address, coins=BALANCE['material_pack_price'])
            db.execute('UPDATE players SET materials=materials+? WHERE address=?', (BALANCE['material_pack_size'], address))
            return {'message': '材料已补充。'}
        return mutate(address, idempotency_key, 'materials', {}, run)

    @app.post('/api/weapons/{wid}/branch')
    def choose_branch(wid: str, body: BranchChoice, authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        def run(db):
            w = owned(db, address, wid)
            branch = next(b for b in SWORD_BRANCHES if b['id'] == body.branch)
            if w['level'] < branch['unlock_level']:
                raise HTTPException(409, f"强化至 +{branch['unlock_level']} 后可选择突变路线。")
            db.execute('UPDATE weapons SET branch=? WHERE id=?', (body.branch, wid))
            return {'weapon_id': wid, 'branch': body.branch, 'message': f"已选择{branch['name']}路线。"}
        return mutate(address, idempotency_key, 'branch/' + wid, body.model_dump(), run)

    @app.post('/api/weapons/{wid}/heat')
    def heat(wid: str, authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        def run(db):
            w = owned(db,address,wid)
            if w['heat_charges'] > 0:
                raise HTTPException(409, '武器正在加热或尚有热量，请先完成本轮敲击。')
            materials = db.execute('SELECT materials FROM players WHERE address=?', (address,)).fetchone()['materials']
            if materials < BALANCE['heat_materials']:
                raise HTTPException(409, f"加热需要 {BALANCE['heat_materials']} 材料，当前剩余 {materials}。请领取每日补给或补充材料。")
            charge(db,address,materials=BALANCE['heat_materials'])
            ready = time.time()+BALANCE['heat_seconds']
            db.execute('UPDATE weapons SET heat_ready_at=?,heat_charges=? WHERE id=?',(ready,BALANCE['heat_strikes'],wid))
            return {'message':f"已放入熔炉，加热 {BALANCE['heat_seconds']} 秒后可敲击 {BALANCE['heat_strikes']} 次。",'heat_ready_at':ready}
        return mutate(address,idempotency_key,'heat/'+wid,{},run)

    @app.post('/api/weapons/{wid}/strike')
    def hit(wid: str, body: StrikeBody, authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        def run(db):
            w = owned(db, address, wid)
            if (w['level'], w['strikes'], w['protected_left']) != (body.expected_level, body.expected_strikes, body.expected_protected_left):
                raise HTTPException(409, '武器已被其他操作改变，请刷新后查看当前概率。')
            if w['level'] >= BALANCE['max_level']:
                raise HTTPException(409, '已达到当前最高等级。')
            if w['heat_charges'] <= 0 or w['heat_ready_at'] > time.time():
                raise HTTPException(409, '请先在熔炉完成加热，再进行敲击。')
            result = strike(w, secrets.randbelow(1_000_000) / 1_000_000, body.shield)
            charge(db, address, BALANCE['strike_ap'], BALANCE['strike_materials'], int(result['shield_used']))
            db.execute('UPDATE weapons SET level=?,strikes=?,protected_left=?,status=?,heat_charges=heat_charges-1 WHERE id=?', (result['level'], result['strikes'], result['protected_left'], result['status'], wid))
            result['heat_charges'] = w['heat_charges']-1
            return result
        return mutate(address, idempotency_key, 'strike/' + wid, body.model_dump(), run)

    @app.post('/api/weapons/{wid}/recycle')
    def recycle(wid: str, authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        def run(db):
            w = owned(db, address, wid)
            if w['level'] < BALANCE['recycle_level']:
                raise HTTPException(409, '尚未达到回收等级。')
            value = recycle_price(w['level'])
            db.execute("UPDATE weapons SET status='recycled' WHERE id=?", (wid,))
            db.execute('UPDATE players SET coins=coins+? WHERE address=?', (value, address))
            return {'message': f'武器已回收，获得 {value} 金币。'}
        return mutate(address, idempotency_key, 'recycle/' + wid, {}, run)

    @app.post('/api/weapons/{wid}/seal')
    def seal(wid: str, authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        def run(db):
            w = owned(db, address, wid)
            if w['level'] < BALANCE['mint_level']:
                raise HTTPException(409, '尚未达到上链门槛。')
            db.execute("UPDATE weapons SET status='sealed' WHERE id=?", (wid,))
            return {'message': '武器已永久封存，可以铸造 NFT。'}
        return mutate(address, idempotency_key, 'seal/' + wid, {}, run)

    @app.post('/api/weapons/{wid}/voucher')
    def voucher(wid: str, authorization: str | None = Header(default=None)):
        address = authenticated(authorization)
        with store.connection() as db:
            w = owned(db, address, wid, 'sealed')
            if db.execute('SELECT guest FROM players WHERE address=?',(address,)).fetchone()[0]:
                raise HTTPException(403, '铭刻 NFT 前请连接钱包并签名绑定当前游戏档案。')
            if w['level'] < BALANCE['mint_level']:
                raise HTTPException(409, f"当前铭刻门槛为 +{BALANCE['mint_level']}。")
        info, _, contract = chain()
        if contract.functions.exists(int(wid, 16)).call():
            raise HTTPException(409, '这把武器已铸造，请刷新链上收藏。')
        keyfile = LOCAL / 'mint-key'
        if not keyfile.exists():
            raise HTTPException(503, '缺少本地铸造授权配置，请重新部署。')
        data = {'weaponId': wid, 'recipient': address, 'level': w['level'], 'uri': metadata(w), 'deadline': int(time.time()) + 600, 'deploymentId': info['deploymentId']}
        domain = {'name': 'ForgeOfFate', 'version': '1', 'chainId': info['chainId'], 'verifyingContract': info['address']}
        signed = Account.sign_message(encode_typed_data(domain, TYPES, data), keyfile.read_text().strip())
        return {'voucher': data, 'signature': Web3.to_hex(signed.signature)}

    @app.post('/api/demo/seed')
    def seed(authorization: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)):
        address = authenticated(authorization)
        if not demo_enabled:
            raise HTTPException(404, '演示数据入口未启用。')
        with store.connection() as db:require_tester(db,address)
        info, _, _ = chain()
        if info['chainId'] != 31337:
            raise HTTPException(403, '演示数据仅限本地测试链。')
        def run(db):
            require_tester(db,address)
            if db.execute('SELECT demo_claimed FROM players WHERE address=?', (address,)).fetchone()[0]:
                raise HTTPException(409, '此账号已领取演示数据。')
            db.execute('UPDATE players SET demo_claimed=1,ap=ap+100,materials=materials+200 WHERE address=?', (address,))
            return {'weapon_id': new_weapon(db, address, BALANCE['mint_level'], 1), 'message': '已添加标记为 DEMO 的达标武器。'}
        return mutate(address, idempotency_key, 'demo', {}, run)

    return app

app = create_app()
