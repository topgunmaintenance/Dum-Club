"""Business logic for documents.

The service is the one place that knows how to:

- list documents (with demo-mode fallback)
- fetch a document by id
- accept an upload, persist bytes, and run the ingestion pipeline
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.demo_store import DemoStore, get_demo_store
from app.core.logging import get_logger
from app.ingestion.pipeline import IngestionPipeline

log = get_logger(__name__)


class DocumentService:
    def __init__(self, store: DemoStore, pipeline: IngestionPipeline) -> None:
        self._store = store
        self._pipeline = pipeline

    # ------------------------------------------------------------------
    def list(
        self,
        *,
        q: str | None = None,
        doc_type: str | None = None,
        aircraft: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._store.list_documents(q=q, doc_type=doc_type, aircraft=aircraft)

    def get(self, doc_id: str) -> dict[str, Any] | None:
        return self._store.get_document(doc_id)

    # ------------------------------------------------------------------
    def ingest_upload(
        self,
        *,
        filename: str,
        payload: bytes,
        title: str | None,
        doc_type: str,
        aircraft: str | None,
        source: str | None,
    ) -> dict[str, Any]:
        settings = get_settings()
        if len(payload) > settings.ingestion_max_mb * 1024 * 1024:
            raise ValueError(
                f"upload exceeds max size {settings.ingestion_max_mb} MB"
            )

        upload_dir: Path = settings.upload_dir
        upload_dir.mkdir(parents=True, exist_ok=True)

        digest = hashlib.sha256(payload).hexdigest()[:16]
        doc_id = f"doc_{digest}"
        dest = upload_dir / f"{doc_id}_{filename}"
        dest.write_bytes(payload)

        log.info("upload stored: %s (%d bytes)", dest, len(payload))

        result = self._pipeline.run(
            doc_id=doc_id,
            source_path=dest,
            title=title or filename,
            doc_type=doc_type,
            aircraft=aircraft,
            source=source,
        )

        doc = {
            "id": doc_id,
            "title": title or filename,
            "type": result.classified_type,
            "aircraft": aircraft,
            "source": source,
            "status": "indexed" if result.indexed else "processing",
            "pages": result.page_count,
            "size_mb": round(len(payload) / (1024 * 1024), 2),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "uploaded_by": "api_upload",
            "tags": ["uploaded"],
            "summary": result.summary,
        }
        self._store.add_document(doc)
        return doc


# ---------------------------------------------------------------------------
def get_document_service() -> DocumentService:
    return DocumentService(
        store=get_demo_store(),
        pipeline=IngestionPipeline.default(),
    )
