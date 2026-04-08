"""Domain model package.

The MVP does not yet persist through SQLAlchemy; the ``entities`` module
defines dataclasses so the ingestion and query layers have stable types to
pass around. Phase 1 will replace these with SQLAlchemy models sitting on
Postgres + pgvector.
"""
from app.models.entities import Chunk, Document, IngestionJob, Part

__all__ = ["Chunk", "Document", "IngestionJob", "Part"]
