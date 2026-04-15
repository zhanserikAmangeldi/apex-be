from cryptography.fernet import Fernet
from app.config import settings
import json
import base64

def get_cipher():
    key = settings.ENCRYPTION_KEY.encode()
    if len(key) != 44:
        key = base64.urlsafe_b64encode(key.ljust(32)[:32])
    return Fernet(key)

def encrypt_data(data) -> str:
    cipher = get_cipher()
    json_data = json.dumps(data)
    encrypted = cipher.encrypt(json_data.encode())
    return encrypted.decode()

def decrypt_data(encrypted_str: str):
    cipher = get_cipher()
    decrypted = cipher.decrypt(encrypted_str.encode())
    return json.loads(decrypted.decode())
