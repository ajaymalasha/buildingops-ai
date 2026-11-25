"""Application settings, read from the environment (and the repository `.env` in development)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

# Passwords that ship in `.env.example` and the bootstrap script. Refused in production.
_DEV_ONLY_PASSWORDS = frozenset({"buildingops_app", "buildingops_owner"})


def _env_files() -> tuple[Path, ...]:
    """The repository root `.env` when running from a checkout; nothing inside a container."""
    here = Path(__file__).resolve()
    candidates = [parent / ".env" for parent in here.parents if (parent / ".git").exists()]
    return tuple(path for path in candidates if path.is_file())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_files(), extra="ignore", case_sensitive=False)

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_format: Literal["console", "json"] = "console"
    docs_enabled: bool = True

    # The API connects as the app role (row-level security applies). Migrations and the seed
    # command connect as the owner role.
    database_url: str = (
        "postgresql+psycopg://buildingops_app:buildingops_app@localhost:5432/buildingops"
    )
    database_admin_url: str = (
        "postgresql+psycopg://buildingops_owner:buildingops_owner@localhost:5432/buildingops"
    )
    database_pool_size: int = Field(default=10, ge=1)
    database_max_overflow: int = Field(default=10, ge=0)
    database_statement_timeout_ms: int = Field(default=15_000, ge=0)

    # Sessions: revoked server-side on sign-out; expire when idle or at the absolute limit.
    session_idle_timeout_minutes: int = Field(default=60 * 24 * 7, ge=1)
    session_absolute_timeout_minutes: int = Field(default=60 * 24 * 30, ge=1)

    # Sign-in throttling, counted over a sliding window.
    login_failure_window_minutes: int = Field(default=15, ge=1)
    login_max_failures_per_email: int = Field(default=5, ge=1)
    login_max_failures_per_ip: int = Field(default=30, ge=1)

    # Argon2id cost. Defaults follow the library's recommended profile; tests lower them.
    password_hash_time_cost: int = Field(default=3, ge=1)
    # Argon2 needs at least 8 KiB per lane, and the hasher uses 4 lanes.
    password_hash_memory_kib: int = Field(default=65_536, ge=32)
    password_min_length: int = Field(default=10, ge=8)

    # Browsers talk to the Next.js server, which calls this API server-side, so no
    # cross-origin access is needed by default.
    cors_allowed_origins: list[str] = Field(default_factory=list)

    # Password given to the seeded demo accounts. Public by design: it only ever protects
    # fictional local data, and `buildingops seed` refuses to run in production.
    seed_demo_password: str = "BuildingOps-Demo-2026"  # noqa: S105

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def database_app_role(self) -> str:
        return make_url(self.database_url).username or ""

    @property
    def database_owner_role(self) -> str:
        return make_url(self.database_admin_url).username or ""

    @model_validator(mode="after")
    def _refuse_dev_credentials_in_production(self) -> Self:
        if not self.is_production:
            return self
        for name in ("database_url", "database_admin_url"):
            if make_url(getattr(self, name)).password in _DEV_ONLY_PASSWORDS:
                raise ValueError(f"{name.upper()} uses a development-only password in production")
        if self.database_app_role == self.database_owner_role:
            raise ValueError(
                "DATABASE_URL and DATABASE_ADMIN_URL must use different roles in production: "
                "the table owner bypasses row-level security"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
