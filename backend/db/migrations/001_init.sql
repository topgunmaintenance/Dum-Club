-- Run this in your Supabase SQL editor

-- ── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users / Creators ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address TEXT UNIQUE NOT NULL,
    username      TEXT UNIQUE,
    display_name  TEXT,
    bio           TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Content Posts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title         TEXT,
    body          TEXT,
    media_url     TEXT,
    media_type    TEXT CHECK (media_type IN ('video','audio','image','text')),
    is_gated      BOOLEAN DEFAULT FALSE,
    min_vault_sol NUMERIC DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Vault (SOL staking to creators) ──────────────────────────
CREATE TABLE IF NOT EXISTS vaults (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supporter_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
    creator_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
    amount_sol    NUMERIC NOT NULL,
    tx_signature  TEXT UNIQUE NOT NULL,
    status        TEXT CHECK (status IN ('active','withdrawn')) DEFAULT 'active',
    vaulted_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (supporter_id, creator_id)
);

-- ── Content Embeddings (pgvector) ─────────────────────────────
CREATE TABLE IF NOT EXISTS content_embeddings (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
    chunk_text    TEXT NOT NULL,
    embedding     vector(384),          -- matches all-MiniLM-L6-v2 dims
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for fast ANN search
CREATE INDEX IF NOT EXISTS idx_content_embeddings_vec
    ON content_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ── Transcripts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transcripts (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
    raw_text      TEXT,
    language      TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS Policies ──────────────────────────────────────────────
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaults             ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts        ENABLE ROW LEVEL SECURITY;

-- Public read on profiles/posts
CREATE POLICY "public_read_profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "public_read_posts"    ON posts    FOR SELECT USING (true);

-- Only owner can insert/update their own profile
CREATE POLICY "owner_write_profile" ON profiles
    FOR ALL USING (auth.uid() = id);

-- Match function for similarity search
CREATE OR REPLACE FUNCTION match_content_embeddings(
    query_embedding vector(384),
    match_count     INT DEFAULT 5,
    match_threshold FLOAT DEFAULT 0.75
)
RETURNS TABLE (
    id         UUID,
    post_id    UUID,
    chunk_text TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.id,
    ce.post_id,
    ce.chunk_text,
    1 - (ce.embedding <=> query_embedding) AS similarity
  FROM content_embeddings ce
  WHERE 1 - (ce.embedding <=> query_embedding) > match_threshold
  ORDER BY ce.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
