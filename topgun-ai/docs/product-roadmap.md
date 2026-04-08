# Topgun AI — Product Roadmap

A sequenced plan from MVP scaffold to a full fleet-intelligence platform.

## Phase 0 — Scaffold (this repo)

- Next.js App Router frontend with premium dark theme.
- FastAPI backend with modular ingestion, retrieval, and query packages.
- Demo store seeded with realistic aviation documents, queries, and insights.
- Landing, Dashboard, Query Workspace, Library, Insights, and Admin pages.
- API routes for health, documents, query, insights, and system status.
- Pluggable AI provider abstraction (stub | openai | anthropic).

**Done when:** the app runs end-to-end against the stub provider and every
page renders meaningful, source-cited content.

## Phase 1 — Real document ingestion

- Wire `pdf_parser` to PyMuPDF with layout-aware text extraction.
- Wire `ocr_processor` to pytesseract with the OCR threshold policy.
- Implement `document_classifier` keyword rules for AMM / IPC / SB / WO.
- Implement `field_extractor` for tail number, ATA, date, signoff, PNs.
- Implement token-based `chunker` with overlap and page anchors.
- Store documents and chunks in Postgres; make `VECTOR_BACKEND=pgvector`
  the default for self-hosted installs.
- Add a background ingestion worker.

**Done when:** a real AMM PDF can be uploaded and queried end-to-end.

## Phase 2 — Grounded retrieval and synthesis

- OpenAI `text-embedding-3-small` embeddings.
- pgvector similarity with a metadata pre-filter.
- Reciprocal rank fusion across the four lanes.
- Anthropic-backed `answer_formatter` returning strict JSON.
- Hard rules against inventing PNs, torque values, or procedural steps.
- Confidence score surfaced on every answer.

**Done when:** answers are consistently cited and refuse to speculate.

## Phase 3 — Scan ingestion for mobile mechanics

- Camera capture of part tags, labels, and sign-off sheets.
- OCR + layout analysis for 8130 tags and removal tags.
- Parts lifecycle events auto-created from scans.
- Offline-friendly upload queue for hangar environments.

## Phase 4 — Fleet intelligence

- Recurring-fault clustering across tail numbers.
- ATA chapter hot spots and trend timelines.
- Parts stocking suggestions based on historical usage.
- Dispatch-risk panel driven by deferred items and inspection due dates.

## Phase 5 — Collaboration and auditability

- Per-user audit log for every query and ingestion action.
- Review workflow for low-confidence extracted fields.
- Shareable answer snapshots with stable citation URLs.
- Role-based access (mechanic / planner / inspector / admin).

## Phase 6 — Enterprise readiness

- SSO (OIDC / SAML) and SCIM provisioning.
- Customer-managed KMS keys for document encryption at rest.
- Region-pinned deployments.
- Data export and retention controls.

---

Non-goals (explicit): Topgun AI is not a general-purpose chatbot, not a
consumer product, and not an e-commerce or social platform. Every feature
must serve maintenance intelligence for aviation teams.
