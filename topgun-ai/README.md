# Topgun AI

**AI Maintenance Intelligence for Aviation Teams**

Topgun AI turns aircraft manuals, maintenance records, parts catalogs, service
bulletins, work cards, and scanned paperwork into a single, source-cited
intelligence layer. Mechanics, planners, and operators ask a question and get
a structured answer grounded in the documents they uploaded — with citations,
extracted entities, and a visible confidence signal.

> Search manuals, records, and parts context instantly.
> Every answer backed by source evidence.
> From documents to decisions.

This repository contains a standalone MVP: a Next.js (App Router, TypeScript,
Tailwind) frontend and a Python FastAPI backend, wired together with a
modular ingestion + retrieval + query architecture designed for future
Postgres/pgvector and multi-provider AI deployments.

> Topgun AI is a separate product. It does not share code, naming, or
> architecture with anything else in this repository.

---

## Architecture at a glance

```
topgun-ai/
├── frontend/         Next.js 14 App Router, TypeScript, Tailwind
├── backend/          FastAPI, modular services, ingestion + query layers
├── docs/             Architecture, ingestion, query, roadmap
├── sample_data/      Realistic aviation demo data (documents, queries, insights)
├── scripts/          Dev helpers and demo seeding
└── .env.example      Shared environment template
```

Full architecture write-up lives in [`docs/architecture.md`](docs/architecture.md).
Pipeline and query layer details are in
[`docs/ingestion-pipeline.md`](docs/ingestion-pipeline.md) and
[`docs/query-system.md`](docs/query-system.md). The product roadmap is in
[`docs/product-roadmap.md`](docs/product-roadmap.md).

---

## What this MVP gives you

- A world-class landing page that communicates the product in under five seconds.
- A full dashboard shell with sidebar, top command bar, upload card, recent
  queries, recent documents, and system status cards.
- A premium **Query Workspace** with answer panel, citations, extracted
  entities, related documents, confidence badge, and follow-up prompts.
- A **Document Library** with type badges, aircraft tags, source tags, and
  ingestion status.
- A **Maintenance Insights** page with recurring issue clusters, ATA trends,
  and fleet intelligence widgets (seeded with realistic demo data).
- An **Admin / System Health** page showing ingestion queue, OCR, embeddings,
  vector index, API health, and recent processing logs.
- A FastAPI backend with routes for health, documents, query, insights, and
  system status, backed by a modular ingestion and query layer ready to be
  wired to real extractors, vector stores, and AI providers.

---

## Prerequisites

- Node.js 18.17+ (tested on Node 20 LTS)
- Python 3.11+
- pip / venv

Optional (for full ingestion later):
- Tesseract (`tesseract-ocr`) for OCR fallback
- Postgres 15+ with `pgvector` extension

---

## Local setup

Clone and enter the project:

```bash
cd topgun-ai
cp .env.example .env
```

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Interactive docs live at
`http://localhost:8000/docs`. Health check: `http://localhost:8000/api/health`.

### Frontend

In a second terminal:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

The app runs at `http://localhost:3000`. By default it talks to the backend at
`http://localhost:8000`. Change `NEXT_PUBLIC_API_BASE_URL` in
`frontend/.env.local` to point elsewhere.

### Tests

```bash
cd backend
pytest -q
```

---

## Environment variables

See [`.env.example`](.env.example) for the full list. The defaults let you run
the MVP end-to-end with no external services — the backend uses an in-memory
demo store seeded from `sample_data/`.

Keys you'll eventually want to set:

| Variable                     | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `DATABASE_URL`               | Postgres connection string (future)         |
| `VECTOR_BACKEND`             | `memory` (default) or `pgvector`            |
| `AI_PROVIDER`                | `stub` (default), `openai`, or `anthropic`  |
| `OPENAI_API_KEY`             | Embeddings + optional generation            |
| `ANTHROPIC_API_KEY`          | Structured extraction and answer synthesis  |
| `NEXT_PUBLIC_API_BASE_URL`   | Backend base URL the frontend talks to      |

---

## Roadmap

Short version:

1. **MVP scaffold** (this repo) — end-to-end product shell, demo data, stub AI.
2. **Real ingestion** — PyMuPDF, pdfplumber, pytesseract OCR, field extraction.
3. **Vector retrieval** — Postgres + pgvector, OpenAI embeddings, ranker.
4. **Grounded synthesis** — Anthropic for structured answers with citations.
5. **Fleet intelligence** — recurring fault clustering and parts stocking signals.
6. **Scan ingestion** — camera capture of part tags and labels on mobile.

Full roadmap: [`docs/product-roadmap.md`](docs/product-roadmap.md).

---

## License

Proprietary. All rights reserved. Topgun AI is a commercial product.
