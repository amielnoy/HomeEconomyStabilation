from cryptography.fernet import Fernet

from server.open_banking_crypto import decrypt_token, encrypt_token


def test_round_trips_a_token_through_encryption() -> None:
    key = Fernet.generate_key().decode()
    env = {"OPEN_BANKING_TOKEN_ENCRYPTION_KEY": key}

    ciphertext = encrypt_token("refresh-token-value", env)

    assert ciphertext is not None
    assert "refresh-token-value" not in ciphertext
    assert decrypt_token(ciphertext, env) == "refresh-token-value"


def test_encryption_without_a_configured_key_fails_closed() -> None:
    assert encrypt_token("refresh-token-value", {}) is None


def test_decryption_with_the_wrong_key_fails_closed_rather_than_raising() -> None:
    first_key = Fernet.generate_key().decode()
    second_key = Fernet.generate_key().decode()
    ciphertext = encrypt_token("refresh-token-value", {"OPEN_BANKING_TOKEN_ENCRYPTION_KEY": first_key})

    assert decrypt_token(ciphertext, {"OPEN_BANKING_TOKEN_ENCRYPTION_KEY": second_key}) is None  # type: ignore[arg-type]
