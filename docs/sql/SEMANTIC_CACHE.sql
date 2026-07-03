-- ─────────────────────────────────────────────────────────────────────────────
-- Hermes Intelligence Layer (HIL) — tabela semantic_cache
--
-- FUNDAÇÃO (Fase 2). Esta DDL é DOCUMENTAÇÃO/CANDIDATA. NÃO é aplicada
-- automaticamente pela aplicação e não altera o comportamento atual. Aplique
-- manualmente (com revisão) quando o Semantic Cache for implementado.
--
-- Propósito: reutilizar respostas equivalentes mesmo quando o texto da pergunta
-- muda. Nesta fundação a chave (`semantic_key`) é LÉXICA (intenção + parâmetros
-- ou tokens canônicos). A coluna `embedding` fica preparada para a fase com
-- pgvector — mantida como comentário até a extensão estar habilitada.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS semantic_cache (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  semantic_key         TEXT        NOT NULL,
  intent               TEXT,
  normalized_question  TEXT,
  parameter_signature  TEXT        NOT NULL DEFAULT '',
  -- embedding         VECTOR(1536),  -- requer extensão pgvector (fase futura)
  response             TEXT        NOT NULL,
  model                TEXT,
  version              TEXT        NOT NULL DEFAULT 'v1',
  quality_score        NUMERIC     NOT NULL DEFAULT 0,
  usage_count          BIGINT      NOT NULL DEFAULT 0,
  hit_count            BIGINT      NOT NULL DEFAULT 0,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup exato pela chave semântica (fundação léxica).
CREATE UNIQUE INDEX IF NOT EXISTS uq_semantic_cache_key
  ON semantic_cache (semantic_key, version);

CREATE INDEX IF NOT EXISTS ix_semantic_cache_intent
  ON semantic_cache (intent);
CREATE INDEX IF NOT EXISTS ix_semantic_cache_expires_at
  ON semantic_cache (expires_at);

-- Fase futura (busca por similaridade de embeddings), quando pgvector existir:
--   CREATE INDEX ix_semantic_cache_embedding
--     ON semantic_cache USING ivfflat (embedding vector_cosine_ops);
