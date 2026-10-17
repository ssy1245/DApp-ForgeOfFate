"""Password credentials are stored as salted, one-way PBKDF2 hashes."""
import hashlib
import secrets
import hmac
import re
import unicodedata

ITERATIONS = 600_000

def normalize_username(value):
    name=unicodedata.normalize('NFKC',value.strip()).casefold()
    if not re.fullmatch(r'[a-z0-9_\u4e00-\u9fff]{3,24}',name):
        raise ValueError('用户名需为 3–24 个汉字、字母、数字或下划线。')
    return name

def hash_password(password):
    salt=secrets.token_hex(16)
    digest=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),ITERATIONS).hex()
    return f'pbkdf2_sha256${ITERATIONS}${salt}${digest}'

def verify_password(password,encoded):
    try:
        algorithm,iterations,salt,digest=encoded.split('$')
        if algorithm!='pbkdf2_sha256':return False
        actual=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),int(iterations)).hex()
        return hmac.compare_digest(actual,digest)
    except (ValueError,TypeError):return False
