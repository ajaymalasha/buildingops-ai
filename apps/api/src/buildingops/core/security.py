"""Password hashing and session tokens."""

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from buildingops.core.errors import ValidationFailedError

SESSION_TOKEN_BYTES = 32
PASSWORD_MAX_LENGTH = 128


class PasswordService:
    """Argon2id password hashing."""

    def __init__(self, *, time_cost: int, memory_kib: int, min_length: int) -> None:
        self._hasher = PasswordHasher(time_cost=time_cost, memory_cost=memory_kib)
        self._min_length = min_length
        # Verified when the account does not exist, so a sign-in attempt costs the same
        # whether or not the email is registered.
        self._decoy_hash = self._hasher.hash(secrets.token_urlsafe(16))

    def hash(self, password: str) -> str:
        return self._hasher.hash(password)

    def verify(self, password_hash: str | None, password: str) -> bool:
        try:
            self._hasher.verify(password_hash or self._decoy_hash, password)
        except VerificationError, InvalidHashError:
            return False
        return password_hash is not None

    def needs_rehash(self, password_hash: str) -> bool:
        return self._hasher.check_needs_rehash(password_hash)

    def validate_new_password(self, password: str, *, email: str, field: str = "password") -> None:
        if len(password) < self._min_length:
            raise ValidationFailedError.for_field(
                field, f"Use at least {self._min_length} characters.", "password_too_short"
            )
        if len(password) > PASSWORD_MAX_LENGTH:
            raise ValidationFailedError.for_field(
                field, f"Use at most {PASSWORD_MAX_LENGTH} characters.", "password_too_long"
            )
        if password.strip().lower() == email.strip().lower():
            raise ValidationFailedError.for_field(
                field, "The password cannot be the email address.", "password_matches_email"
            )


def generate_session_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def hash_session_token(token: str) -> str:
    """Only the hash is stored. The token is 256 random bits, so a fast hash is sufficient."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
