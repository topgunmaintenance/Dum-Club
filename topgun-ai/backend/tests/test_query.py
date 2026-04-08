from fastapi.testclient import TestClient

from app.query.answer_formatter import AnswerFormatter


def test_query_demo_hit(client: TestClient) -> None:
    response = client.post(
        "/api/query",
        json={"question": "What are the likely causes of hydraulic pressure fluctuation?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["confidence"]["label"] in {"high", "medium"}
    assert body["citations"]
    assert body["related_documents"]
    assert body["answer"]


def test_formatter_refuses_without_chunks() -> None:
    formatter = AnswerFormatter()
    result = formatter.format(question="anything", chunks=[])
    assert result["confidence"]["label"] == "insufficient"
    assert result["confidence"]["score"] == 0.0
    assert result["related_documents"] == []
    assert "could not find evidence" in result["answer"].lower()


def test_formatter_produces_sections_with_chunks() -> None:
    chunks = [
        {
            "id": "c1",
            "document_id": "doc1",
            "document_title": "Sample AMM",
            "document_type": "AMM",
            "page": 7,
            "snippet": "Pump case drain flow limits listed below.",
            "score": 0.9,
        },
    ]
    result = AnswerFormatter().format(question="pump case drain?", chunks=chunks)
    assert result["confidence"]["label"] in {"high", "medium", "low"}
    assert result["related_documents"][0]["id"] == "doc1"
    assert result["sections"][0]["heading"] == "Retrieved evidence"


def test_recent_queries(client: TestClient) -> None:
    response = client.get("/api/query/recent?limit=2")
    assert response.status_code == 200
    assert len(response.json()) <= 2
