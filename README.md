# DUM Club — Full Stack

Solana-powered social media platform with AI features.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 + TypeScript |
| Backend | FastAPI (Python 3.11) |
| Database | Supabase + pgvector |
| Transcription | Whisper (local) |
| Embeddings | Sentence Transformers `all-MiniLM-L6-v2` |
| RAG Retrieval | LlamaIndex + Supabase vector store |
| LLM | Ollama (llama3 / mistral / phi3) |
| TTS | Piper (local, offline) |
| TTS Upgrade | Coqui XTTS v2 (voice cloning) |
| Wallet | Phantom / Solflare / Backpack |
| Chain | Solana (devnet → mainnet) |

---

## Quick Start

### 1. Clone + configure

```bash
git clone https://github.com/yourorg/dumclub
cd dumclub
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
```

### 2. Run Supabase migration

Paste `backend/db/migrations/001_init.sql` into your Supabase SQL editor and run it.  
This creates all tables and the `match_content_embeddings` similarity function.

### 3. Start all services

```bash
docker compose up --build
```

### 4. Pull the local LLM

```bash
chmod +x scripts/pull_model.sh
./scripts/pull_model.sh llama3
# or: ./scripts/pull_model.sh mistral
```

### 5. Open

- Frontend: http://localhost:3000
- Backend API docs: http://localhost:8000/docs
- Ollama: http://localhost:11434

---

## Architecture

```
Browser (Next.js)
    │
    ├── Solana wallet (Phantom/Solflare)
    │       └── on-chain SOL vault tx
    │
    └── REST API (FastAPI)
            ├── /api/vault       ← record vault after on-chain tx
            ├── /api/content     ← create posts, trigger embedding
            ├── /api/transcribe  ← Whisper → embed → pgvector
            ├── /api/chat        ← RAG: retrieve → Ollama → stream
            └── /api/speech      ← Piper TTS → audio bytes
                        │
                        ├── Supabase (Postgres + pgvector)
                        ├── Whisper (local GPU/CPU)
                        ├── Sentence Transformers (384-dim)
                        ├── LlamaIndex retrieval
                        └── Ollama (llama3 local)
```

---

## API Endpoints

### Vault
- `POST /api/vault/record` — save confirmed SOL vault tx
- `GET  /api/vault/creator/{wallet}` — total SOL + supporter count
- `GET  /api/vault/supporter/{wallet}` — all creators a wallet supports

### Content
- `POST /api/content/` — create post (auto-embeds text)
- `GET  /api/content/feed` — paginated feed

### AI
- `POST /api/transcribe/` — upload audio → transcript + embed
- `POST /api/chat/` — RAG chat (supports `stream: true`)
- `POST /api/speech/synthesize` — TTS (returns audio bytes)

### Users
- `POST /api/users/profile` — upsert profile
- `GET  /api/users/profile/{wallet}` — fetch profile

---

## Upgrade: Coqui TTS Voice Cloning

When ready to upgrade from Piper → Coqui XTTS v2:

1. `pip install TTS`
2. In `backend/services/speech/piper_service.py`, uncomment the `generate_speech_coqui()` function
3. Update `api/routes/speech.py` to call `generate_speech_coqui(text, speaker_wav="path/to/voice.wav")`
4. Collect a 5–30 second clean voice sample from the creator

---

## Changing the LLM

Edit `.env`:
```
OLLAMA_MODEL=mistral      # or phi3, llama3:70b, codellama, etc.
```

Then pull the model:
```bash
./scripts/pull_model.sh mistral
```

---

## GPU Support

If you have an NVIDIA GPU, the `docker-compose.yml` already configures the Ollama container with GPU access via the NVIDIA Container Toolkit.  
Whisper will also automatically use CUDA if available.
