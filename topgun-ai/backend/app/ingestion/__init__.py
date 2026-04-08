"""Ingestion pipeline package.

Stages:
    pdf_parser → ocr_processor → document_classifier
        → field_extractor → chunker → embedder → indexer
"""
from app.ingestion.pipeline import IngestionContext, IngestionPipeline, IngestionResult

__all__ = ["IngestionContext", "IngestionPipeline", "IngestionResult"]
