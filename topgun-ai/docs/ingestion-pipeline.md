# Ingestion Pipeline

The ingestion pipeline turns raw uploads into retrievable, citable
knowledge. It is intentionally broken into small stages so any individual
step can be swapped or improved without touching the others.

## Stages

```
upload
   │
   ▼
┌────────────────┐
│  pdf_parser    │  PyMuPDF text + layout (primary path)
└────────────────┘
   │
   ▼ (if empty or scanned)
┌────────────────┐
│ ocr_processor  │  pytesseract fallback on rasterized pages
└────────────────┘
   │
   ▼
┌─────────────────────┐
│ document_classifier │  AMM / IPC / Bulletin / Work Order / Logbook / …
└─────────────────────┘
   │
   ▼
┌─────────────────┐
│ field_extractor │  aircraft, ATA, part numbers, effectivity, sign-offs
└─────────────────┘
   │
   ▼
┌──────────┐
│ chunker  │  semantic chunks with overlap and page anchors
└──────────┘
   │
   ▼
┌──────────┐
│ embedder │  OpenAI text-embedding-3-small (pluggable)
└──────────┘
   │
   ▼
┌──────────┐
│ indexer  │  writes documents, doc_chunks, extracted_fields
└──────────┘
```

Each stage implements a minimal interface:

```python
class Stage(Protocol):
    name: str
    def run(self, ctx: IngestionContext) -> IngestionContext: ...
```

`IngestionContext` carries the document metadata, raw text, chunks,
embeddings, and extracted fields. Stages only write to their own keys; they
never reach across boundaries.

## Error handling

Any stage can raise `IngestionError(stage, reason, recoverable)`. The
pipeline records failures in `ingestion_jobs` with a stage tag. Recoverable
failures (e.g. OCR timeout) mark the job as `retryable`; non-recoverable
failures are marked `failed` and surfaced on the Admin page.

## Chunking strategy

Default configuration:

- target size: 800 tokens
- overlap: 120 tokens
- respects page boundaries; chunks never span pages
- stores `page_start`, `page_end`, `char_offset` on every chunk for deep
  linking in the Source Drawer

## Classification labels

The `document_classifier` assigns one of:

- `AMM` — Aircraft Maintenance Manual
- `IPC` — Illustrated Parts Catalog
- `SB` — Service Bulletin
- `WORK_ORDER`
- `LOGBOOK`
- `TROUBLESHOOTING`
- `PARTS_CATALOG`
- `INSPECTION_PROGRAM`
- `UNKNOWN`

Classification runs on the first N pages plus filename heuristics. In the
MVP this is stubbed out with keyword rules; the architecture supports a
swap to an LLM or fine-tuned classifier later.

## Field extraction

For every document the extractor attempts to pull:

- tail number / aircraft type
- ATA chapter (if present)
- date
- signoff name / inspector stamp
- part numbers and serial numbers
- effectivity ranges

Extracted fields are stored with a confidence score and page anchor so the
UI can highlight low-confidence values and let a user correct them.

## OCR policy

OCR is expensive. The pipeline only invokes `ocr_processor` when the
primary PyMuPDF pass returns fewer than a configurable threshold of
characters per page (default 40). OCR results are tagged `source: ocr` so
downstream retrieval can surface a quality warning on the citation.
