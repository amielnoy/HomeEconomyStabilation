from __future__ import annotations

from os import environ

from cryptography.fernet import Fernet, InvalidToken


def _key(env: dict[str, str] | None) -> bytes | None:
    values = env if env is not None else environ
    raw = values.get("OPEN_BANKING_TOKEN_ENCRYPTION_KEY")
    return raw.encode() if raw else None


def encrypt_token(plaintext: str, env: dict[str, str] | None = None) -> str | None:
    """None when no key is configured — a caller that ignores this return value stores
    nothing, which is the point: there is no code path that writes a refresh token to
    Supabase unencrypted."""
    key = _key(env)
    if not key:
        return None
    return Fernet(key).encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str, env: dict[str, str] | None = None) -> str | None:
    key = _key(env)
    if not key:
        return None
    try:
        return Fernet(key).decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        return None
