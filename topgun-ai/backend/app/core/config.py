"""Runtime configuration for the Topgun AI backend.

All settings are read from environment variables (prefixed ``TOPGUN_``
where sensible) with safe development defaults. We use pydantic-settings
so the same shape can drive local dev, tests, and production.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend settings.

    The defaults are deliberately chosen so ``uvicorn app.main:app`` runs
    with zero configuration against the seeded demo data.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Runtime ---------------------------------------------------------
    env: Literal["development", "staging", "production"] = Field(
        default="development", alias="TOPGUN_ENV"
    )
    log_level: str = Field(default="info", alias="TOPGUN_LOG_LEVEL")
    api_host: str = Field(default="0.0.0.0", alias="TOPGUN_API_HOST")
    api_port: int = Field(default=8000, alias="TOPGUN_API_PORT")
    cors_origins: str = Field(
        default="http://localhost:3000", alias="TOPGUN_CORS_ORIGINS"
    )

    # --- Demo mode -------------------------------------------------------
    demo_mode: bool = Field(default=True, alias="TOPGUN_DEMO_MODE")

    # --- Database (future) ----------------------------------------------
    database_url: str = Field(
        default="postgresql+psycopg://topgun:topgun@localhost:5432/topgun",
        alias="DATABASE_URL",
    )
    vector_backend: Literal["memory", "pgvector"] = Field(
        default="memory", alias="VECTOR_BACKEND"
    )

    # --- AI providers ----------------------------------------------------
    ai_provider: Literal["stub", "openai", "anthropic"] = Field(
        default="stub", alias="AI_PROVIDER"
    )
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")

    embedding_model: str = Field(
        default="text-embedding-3-small", alias="EMBEDDING_MODEL"
    )
    embedding_dimensions: int = Field(default=1536, alias="EMBEDDING_DIMENSIONS")

    # --- Ingestion -------------------------------------------------------
    upload_dir: Path = Field(
        default=Path("./storage/uploads"), alias="INGESTION_UPLOAD_DIR"
    )
    ingestion_max_mb: int = Field(default=50, alias="INGESTION_MAX_MB")

    # ---------------------------------------------------------------------
    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sample_data_dir(self) -> Path:
        """Location of seeded demo data.

        Resolved relative to the repo root (``topgun-ai/sample_data``).
        """
        return (Path(__file__).resolve().parents[3] / "sample_data").resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
