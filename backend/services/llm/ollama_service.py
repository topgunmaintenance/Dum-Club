"""
LLM service using Ollama (local model).
Default model: llama3  —  swap to mistral, phi3, etc. via env var.
"""
import os
import ollama
from typing import AsyncIterator

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_HOST  = os.getenv("OLLAMA_HOST",  "http://localhost:11434")

_client = ollama.AsyncClient(host=OLLAMA_HOST)


async def chat_with_context(
    user_query: str,
    context_chunks: list[dict],
    system_prompt: str | None = None,
) -> str:
    """
    RAG-style generation: inject retrieved chunks then ask the LLM.
    """
    context_text = "\n\n---\n\n".join(
        c["chunk_text"] for c in context_chunks
    )

    system = system_prompt or (
        "You are a helpful assistant for DUM Club, a Solana-powered social media platform. "
        "Use the provided context to answer questions about creators and their content. "
        "If the context doesn't contain the answer, say so honestly."
    )

    messages = [
        {"role": "system", "content": system},
    ]

    if context_text:
        messages.append({
            "role": "user",
            "content": f"Context from creator content:\n\n{context_text}",
        })
        messages.append({
            "role": "assistant",
            "content": "Got it — I have the context. What's your question?",
        })

    messages.append({"role": "user", "content": user_query})

    response = await _client.chat(model=OLLAMA_MODEL, messages=messages)
    return response["message"]["content"]


async def stream_chat(
    user_query: str,
    context_chunks: list[dict],
) -> AsyncIterator[str]:
    """Streaming version for real-time UI updates."""
    context_text = "\n\n---\n\n".join(c["chunk_text"] for c in context_chunks)

    messages = [
        {"role": "system", "content": "You are a DUM Club AI assistant."},
    ]
    if context_text:
        messages.append({"role": "user", "content": f"Context:\n{context_text}"})
        messages.append({"role": "assistant", "content": "Understood."})
    messages.append({"role": "user", "content": user_query})

    async for chunk in await _client.chat(
        model=OLLAMA_MODEL, messages=messages, stream=True
    ):
        yield chunk["message"]["content"]


async def list_available_models() -> list[str]:
    result = await _client.list()
    return [m["name"] for m in result.get("models", [])]
