-- ─────────────────────────────────────────────────────────────────────────────
-- Hermes Intelligence Layer (HIL) — tabela response_library
--
-- FUNDAÇÃO (Fase 2). Esta DDL é DOCUMENTAÇÃO/CANDIDATA. NÃO é aplicada
-- automaticamente pela aplicação e não altera o comportamento atual. Aplique
-- manualmente (com revisão) quando a Response Library for implementada.
--
-- Propósito: guardar respostas já geradas e aprovadas para perguntas
-- recorrentes (mesma intenção + mesmos parâmetros), evitando refazer SQL/IA.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS response_library (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent               TEXT        NOT NULL,
  normalized_question  TEXT        NOT NULL,
  parameter_signature  TEXT        NOT NULL DEFAULT '',
  response             TEXT        NOT NULL,
  version              TEXT        NOT NULL DEFAULT 'v1',
  quality_score        NUMERIC     NOT NULL DEFAULT 0,
  usage_count          BIGINT      NOT NULL DEFAULT 0,
  estimated_cost       NUMERIC     NOT NULL DEFAULT 0,
  last_generated_at    TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup principal: por intenção + pergunta normalizada + assinatura de params.
CREATE UNIQUE INDEX IF NOT EXISTS uq_response_library_key
  ON response_library (intent, normalized_question, parameter_signature, version);

-- Apoio a expiração e ranking por qualidade/uso.
CREATE INDEX IF NOT EXISTS ix_response_library_expires_at
  ON response_library (expires_at);
CREATE INDEX IF NOT EXISTS ix_response_library_intent
  ON response_library (intent);
