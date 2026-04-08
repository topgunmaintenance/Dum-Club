"""Answer formatter.

Turns merged chunks + a question into a structured answer shape. The
formatter is **strict**: if there are no retrieved chunks, it refuses to
invent anything and returns an ``insufficient`` confidence response.

Phase 2 will call the configured AI provider with a tightly-bounded
prompt that lists only the retrieved chunks and enforces JSON output.
For now the implementation is deterministic so the UI always gets a
shape-correct response and tests stay hermetic.
"""
from __future__ import annotations

from typing import Any


class AnswerFormatter:
    def format(
        self, *, question: str, chunks: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if not chunks:
            return {
                "answer": (
                    "I could not find evidence for this question in the indexed "
                    "sources. Upload the relevant manual or maintenance record and "
                    "ask again."
                ),
                "sections": [
                    {
                        "heading": "What Topgun AI did",
                        "bullets": [
                            "Searched the manual, history, parts, and pattern lanes.",
                            "Found no chunks matching the question.",
                            "Refused to answer from model priors — source-first policy.",
                        ],
                    }
                ],
                "related_documents": [],
                "entities": [],
                "confidence": {
                    "score": 0.0,
                    "label": "insufficient",
                    "reason": "No chunks retrieved.",
                },
                "followups": [
                    "Upload the relevant manual chapter and retry.",
                    "Narrow the question to a specific aircraft or ATA chapter.",
                ],
            }

        top_snippets = [c["snippet"] for c in chunks[:3]]
        answer = (
            "Based on the retrieved sources, the most relevant evidence is:\n\n- "
            + "\n- ".join(top_snippets)
        )
        score = min(1.0, 0.4 + 0.1 * len(chunks))
        label = "high" if score >= 0.7 else "medium" if score >= 0.5 else "low"
        return {
            "answer": answer,
            "sections": [
                {
                    "heading": "Retrieved evidence",
                    "bullets": top_snippets,
                }
            ],
            "related_documents": _related(chunks),
            "entities": [],
            "confidence": {
                "score": score,
                "label": label,
                "reason": f"Fused {len(chunks)} chunks across lanes.",
            },
            "followups": [
                f"Show the full passage from {chunks[0]['document_title']}.",
                "List related maintenance write-ups.",
            ],
        }


def _related(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for c in chunks:
        doc_id = c["document_id"]
        if doc_id in seen:
            continue
        seen.add(doc_id)
        out.append(
            {
                "id": doc_id,
                "title": c.get("document_title", doc_id),
                "type": c.get("document_type", "UNKNOWN"),
            }
        )
        if len(out) >= 4:
            break
    return out
