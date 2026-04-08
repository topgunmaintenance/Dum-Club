"""Document endpoints.

The MVP exposes list, get, and a multipart upload that runs the ingestion
pipeline in stub mode. Real parsing is plugged in at ``ingestion/pipeline.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.schemas.documents import (
    DocumentDetail,
    DocumentListResponse,
    DocumentSummary,
    DocumentType,
)
from app.services.document_service import DocumentService, get_document_service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=DocumentListResponse)
def list_documents(
    q: str | None = None,
    type: str | None = None,
    aircraft: str | None = None,
    service: DocumentService = Depends(get_document_service),
) -> DocumentListResponse:
    items = service.list(q=q, doc_type=type, aircraft=aircraft)
    return DocumentListResponse(
        documents=[DocumentSummary(**d) for d in items],
        total=len(items),
    )


@router.get("/{doc_id}", response_model=DocumentDetail)
def get_document(
    doc_id: str,
    service: DocumentService = Depends(get_document_service),
) -> DocumentDetail:
    doc = service.get(doc_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="document not found"
        )
    return DocumentDetail(**doc)


@router.post(
    "/upload",
    response_model=DocumentDetail,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    type: DocumentType = Form(default="UNKNOWN"),
    aircraft: str | None = Form(default=None),
    source: str | None = Form(default=None),
    service: DocumentService = Depends(get_document_service),
) -> DocumentDetail:
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing filename")

    payload = await file.read()
    doc = service.ingest_upload(
        filename=file.filename,
        payload=payload,
        title=title,
        doc_type=type,
        aircraft=aircraft,
        source=source,
    )
    return DocumentDetail(**doc)
