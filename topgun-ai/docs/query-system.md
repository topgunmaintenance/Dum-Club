# Query System

Topgun AI's query system is a structured, source-grounded retrieval engine.
It is deliberately **not** a general-purpose chatbot. Every answer is a
structured object with evidence, entities, and a confidence signal.

## Request lifecycle

```
question  →  query_engine.handle()
                │
                ├── manual_search      (AMM, IPC, bulletins)
                ├── history_search     (work orders, logbook, troubleshooting)
                ├── parts_lookup       (parts catalog + lifecycle events)
                └── pattern_detector   (recurring issue clusters)
                │
                ▼
            rank_fusion
                │
                ▼
         citation_builder
                │
                ▼
         answer_formatter   →  AI provider (stub | openai | anthropic)
                │
                ▼
       QueryResponse (answer, sections, citations, entities,
                     confidence, followups)
```

## Response contract

```python
class QueryResponse(BaseModel):
    question: str
    answer: str                        # executive summary
    sections: list[AnswerSection]      # probable causes, actions, references…
    citations: list[Citation]          # chunk-level provenance
    related_documents: list[DocRef]    # whole-document suggestions
    entities: list[ExtractedEntity]    # part numbers, ATA codes, aircraft
    confidence: ConfidenceReport       # score + reasoning + lane breakdown
    followups: list[str]               # suggested next questions
    latency_ms: int
```

## Confidence model

`ConfidenceReport` has three fields:

- `score` — 0.0 to 1.0
- `label` — `high` | `medium` | `low` | `insufficient`
- `reason` — short human-readable string: "Found 4 corroborating chunks
  across 2 sources" or "Only OCR hits, text quality low"

The UI never hides a low-confidence answer; it marks it explicitly and
surfaces the missing-evidence reason in the Citations panel.

## Lanes

### Manual lane (`manual_search`)
Queries `doc_chunks` where the parent `document.type` is `AMM`, `IPC`,
`SB`, or `PARTS_CATALOG`. Optimized for procedures, limits, torque values,
and step references. Always prefers higher-ranked manuals when ties.

### History lane (`history_search`)
Queries `doc_chunks` where the parent `document.type` is `WORK_ORDER`,
`LOGBOOK`, or `TROUBLESHOOTING`. Supports filter by tail number and by
date range. Returns chunks plus the parent work order reference.

### Parts lane (`parts_lookup`)
Combines `parts` table lookups (exact + prefix match on part number) with
`part_events` history. Returns a part record plus its lifecycle timeline.

### Pattern lane (`pattern_detector`)
Answers "is this a recurring fault?" questions by clustering past
write-ups on text + ATA + aircraft type. Emits a cluster ID plus the
count and last occurrence.

## Rank fusion

The MVP uses a simple reciprocal rank fusion across lanes, weighted so that
manual hits outrank history hits for procedural questions, and history
hits outrank manuals for recurrence questions. The weight profile is
selected by a lightweight question classifier.

## Answer formatter

`answer_formatter` builds a prompt that:

1. Lists only the retrieved chunks (with citations).
2. Instructs the model to answer **only** from those chunks.
3. Requests a specific JSON shape matching `QueryResponse`.
4. Explicitly forbids inventing part numbers, torque values, or steps.

The AI provider is configurable via `AI_PROVIDER`:

- `stub` — returns a deterministic, shape-correct demo response (default;
  no API keys required).
- `openai` — calls OpenAI chat completions.
- `anthropic` — calls Anthropic Messages API for structured extraction.

## Citations

`citation_builder` attaches a `Citation` for every chunk the model used.
A Citation is:

```python
class Citation(BaseModel):
    document_id: str
    document_title: str
    document_type: str
    page: int
    snippet: str
    score: float
    lane: Literal["manual", "history", "parts", "pattern"]
```

The frontend renders citations in the Source Drawer with a deep link to
the originating page.
