# Topgun AI — Architecture

Topgun AI is a source-first maintenance intelligence system for aviation
teams. It ingests aircraft manuals, maintenance records, parts catalogs, and
scanned paperwork, and turns them into a queryable knowledge layer that
returns structured, cited answers.

This document describes the target architecture that the MVP is scaffolded
against. Some modules are stubbed but the boundaries and contracts are real.

## System shape

```
┌─────────────────────────────────────────────────────────────┐
│                       Frontend (Next.js)                    │
│  Landing · Dashboard · Query Workspace · Library · Insights │
│                          · Admin ·                          │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST (JSON)
┌───────────────────────────▼─────────────────────────────────┐
│                      Backend (FastAPI)                      │
│                                                              │
│  api/          — HTTP layer                                  │
│  services/     — business orchestration                     │
│  ingestion/    — parsing, OCR, classification, chunking     │
│  retrieval/    — vector + metadata search                   │
│  query/        — 4-lane query engine + citation synthesis   │
│  core/         — config, logging, demo store                │
│                                                              │
│  pluggable AI provider (stub | openai | anthropic)          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────┐
              │  Postgres + pgvector (future)│
              │  In-memory demo store (MVP)  │
              └──────────────────────────────┘
```

## Core principles

1. **Source-first, answer-second.** Every answer is traceable to a document,
   page, and chunk. If retrieval finds nothing, the answer says so.
2. **Never invent part numbers, torque values, or procedural steps.** The
   answer formatter refuses to hallucinate structured values.
3. **Pluggable providers.** Ingestion, retrieval, and generation all sit
   behind abstractions so OpenAI, Anthropic, or a local model can be dropped
   in without touching the API layer.
4. **Confidence is a first-class field.** The UI always renders an evidence
   strength indicator; the backend always returns a confidence score.
5. **Modular and testable.** Each ingestion stage, retrieval lane, and query
   sub-component is a small, independently testable unit.

## Backend package map

```
backend/app/
├── main.py                FastAPI app factory and middleware
├── core/
│   ├── config.py          Pydantic settings, env loading
│   ├── logging.py         Structured logging helpers
│   └── demo_store.py      In-memory store seeded from sample_data/
├── api/
│   ├── router.py          Top-level router assembly
│   ├── health.py          /api/health
│   ├── documents.py       /api/documents  (list, upload, get, ingest)
│   ├── query.py           /api/query      (ask, chunks)
│   ├── insights.py        /api/insights   (trends, clusters)
│   ├── system.py          /api/system     (status, logs)
│   └── auth.py            /api/auth       (placeholder)
├── schemas/               Pydantic request/response models
├── models/                Domain entities
├── services/              Business logic orchestration
├── ingestion/             Ingestion pipeline stages
├── retrieval/             Vector and metadata search
├── query/                 4-lane query engine + answer formatter
└── utils/                 Shared helpers
```

## Ingestion pipeline

See [ingestion-pipeline.md](ingestion-pipeline.md) for stage-by-stage details.

```
upload → pdf_parser ──┐
                      ├─→ document_classifier → field_extractor → chunker → embedder → indexer
       ocr_processor ─┘
```

Every stage returns a typed payload and writes to the `documents`,
`doc_chunks`, and `extracted_fields` tables (or in-memory equivalents during
demo mode).

## Query engine

See [query-system.md](query-system.md). The engine runs four retrieval lanes
in parallel:

1. **Manual lane** — procedures, limits, torque values, inspection intervals.
2. **History lane** — maintenance records, write-ups, work orders, logbook.
3. **Parts lane** — part numbers, effectivity, supersedure chains.
4. **Pattern lane** — recurring faults, cluster hits, ATA code trends.

Results are merged by a rank-fusion step and passed to `answer_formatter`,
which asks the configured AI provider to synthesize a structured response
with inline citations. `citation_builder` attaches chunk-level provenance.

## Data model (target)

- `documents` — id, title, type, aircraft, source, status, uploaded_by, hash.
- `doc_chunks` — id, document_id, page, position, text, embedding (vector).
- `extracted_fields` — id, document_id, key, value, confidence, page.
- `parts` — id, part_number, description, aircraft, notes.
- `part_events` — id, part_id, event_type, document_id, occurred_at.
- `queries` — id, question, answer, confidence, lanes, created_at.
- `citations` — id, query_id, chunk_id, score.
- `ingestion_jobs` — id, document_id, stage, status, started_at, finished_at.
- `audit_log` — id, actor, action, target, metadata, created_at.

The MVP keeps an in-memory analogue of `documents`, `doc_chunks`, `queries`,
and `insights` seeded from `sample_data/`.

## Frontend architecture

- **Next.js 14 App Router** with TypeScript.
- **Tailwind** with a custom dark theme (`gunmetal`, `slate`, `cyan`, `amber`).
- Route groups:
  - `/` — landing page
  - `/dashboard` — logged-in shell
  - `/query` — query workspace
  - `/library` — document library
  - `/insights` — maintenance insights
  - `/admin` — system health
- A shared `AppShell` wraps logged-in routes with sidebar + top bar.
- Data comes from `lib/api.ts` which hits the FastAPI backend; in demo mode
  the same shapes are also available from `lib/demoData.ts` so the UI never
  looks empty even without the backend running.

## Deployment shape (future)

- Frontend: Vercel or container behind a CDN.
- Backend: container (Uvicorn/Gunicorn) behind an HTTPS load balancer.
- Database: managed Postgres with `pgvector` enabled.
- Object storage: S3-compatible bucket for uploaded PDFs and scans.
- Queue: Redis or SQS for ingestion jobs when volume grows.
