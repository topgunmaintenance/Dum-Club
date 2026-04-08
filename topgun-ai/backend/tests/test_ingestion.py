from pathlib import Path

from app.ingestion.chunker import Chunker, ChunkerConfig
from app.ingestion.document_classifier import DocumentClassifier
from app.ingestion.field_extractor import FieldExtractor
from app.ingestion.pipeline import IngestionContext, IngestionPipeline
from app.retrieval.vector_store import MemoryVectorStore


def _ctx(tmp_path: Path, text: str) -> IngestionContext:
    src = tmp_path / "sample.txt"
    src.write_text(text)
    return IngestionContext(
        doc_id="doc_test",
        source_path=src,
        title="Sample",
    )


def test_chunker_respects_target_size(tmp_path: Path) -> None:
    text = "word " * 3000
    ctx = _ctx(tmp_path, text)
    ctx.pages = [text]
    chunker = Chunker(ChunkerConfig(target_tokens=100, overlap_tokens=20))
    chunker.run(ctx)
    assert ctx.chunks, "chunker should produce at least one chunk"
    for chunk in ctx.chunks:
        assert len(chunk["text"]) <= 100 * 4


def test_field_extractor_finds_tail_and_ata(tmp_path: Path) -> None:
    text = "Write-up on N123XL, ATA 29 hydraulic power system. Dated 2026-04-01."
    ctx = _ctx(tmp_path, text)
    ctx.pages = [text]
    FieldExtractor().run(ctx)
    assert "N123XL" in ctx.extracted_fields["tail_numbers"]
    assert "29" in ctx.extracted_fields["ata_chapters"]
    assert "2026-04-01" in ctx.extracted_fields["dates"]


def test_document_classifier_heuristic(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path, "Service Bulletin SB-42-01 revised inspection interval.")
    ctx.pages = ["Service Bulletin SB-42-01 revised inspection interval."]
    DocumentClassifier().run(ctx)
    assert ctx.classified_type == "SB"


def test_full_pipeline_indexes_chunks(tmp_path: Path) -> None:
    src = tmp_path / "amm_chapter.txt"
    src.write_text(
        "Aircraft Maintenance Manual — Chapter 29 Hydraulic Power.\n"
        "Tail: N123XL. ATA 29. Pump case drain flow limits listed below."
    )
    pipeline = IngestionPipeline.default()
    result = pipeline.run(
        doc_id="doc_pipeline_test",
        source_path=src,
        title="Test AMM",
    )
    assert result.indexed is True
    assert result.classified_type == "AMM"
    assert result.chunk_count >= 1


def test_memory_vector_store_similarity() -> None:
    store = MemoryVectorStore()
    store.upsert(
        document_id="docA",
        chunks=[
            {
                "id": "docA_p1_c0",
                "document_id": "docA",
                "text": "hydraulic pressure fluctuation",
                "page_start": 1,
                "page_end": 1,
                "position": 0,
            }
        ],
        embeddings=[[0.1, 0.2, 0.3]],
        metadata={"type": "AMM", "title": "Test AMM"},
    )
    hits = store.similarity_search(embedding=[0.1, 0.2, 0.3], top_k=5)
    assert hits and hits[0][0].document_id == "docA"
