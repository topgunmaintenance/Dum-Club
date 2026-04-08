import io

from fastapi.testclient import TestClient


def test_list_documents(client: TestClient) -> None:
    response = client.get("/api/documents")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    # Demo store seeds known IDs.
    ids = {d["id"] for d in body["documents"]}
    assert "doc_amm_xls_29" in ids


def test_get_document(client: TestClient) -> None:
    response = client.get("/api/documents/doc_amm_xls_29")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "AMM"
    assert body["aircraft"] == "Citation XLS"


def test_upload_document_text_fixture(client: TestClient) -> None:
    payload = (
        "Aircraft Maintenance Manual — Chapter 29 Hydraulic Power\n"
        "Tail: N999ZZ\n"
        "ATA 29 — Hydraulic Power General\n"
        "Pump case drain flow shall be measured with reservoir full."
    )
    files = {
        "file": ("sample_amm.txt", io.BytesIO(payload.encode("utf-8")), "text/plain"),
    }
    response = client.post(
        "/api/documents/upload",
        files=files,
        data={"title": "Sample AMM", "type": "UNKNOWN"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["type"] == "AMM"  # classifier picked it up from the text
    assert body["pages"] >= 1
    assert body["status"] == "indexed"
