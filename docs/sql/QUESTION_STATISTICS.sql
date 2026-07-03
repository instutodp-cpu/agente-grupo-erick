-- ─────────────────────────────────────────────────────────────────────────────
-- Hermes Intelligence Layer (HIL) — tabela question_statistics
--
-- FUNDAÇÃO (Fase 2). Esta DDL é DOCUMENTAÇÃO/CANDIDATA. NÃO é aplicada
-- automaticamente pela aplicação e não altera o comportamento atual. Aplique
-- manualmente (com revisão) quando a camada de aprendizado for implementada.
--
-- Propósito: registrar, por pergunta respondida, qual caminho a HIL recomendaria
-- e qual caminho foi de fato usado (SQL Template, cache, Claude), com custo,
-- latência e sucesso — para medir como o sistema é usado e calibrar as decisões
-- da HIL no futuro. Não guarda o texto livre da resposta nem dados sensíveis.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS question_statistics (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent               TEXT,
  normalized_question  TEXT,
  recommended_path     TEXT,
  complexity           TEXT,
  estimated_cost       NUMERIC,
  estimated_latency    INTEGER,
  used_sql_template    BOOLEAN     NOT NULL DEFAULT FALSE,
  used_cache           BOOLEAN     NOT NULL DEFAULT FALSE,
  used_claude          BOOLEAN     NOT NULL DEFAULT FALSE,
  response_time_ms     INTEGER,
  success              BOOLEAN,
  error_type           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agregações por intenção e por caminho recomendado/efetivo.
CREATE INDEX IF NOT EXISTS ix_question_statistics_intent
  ON question_statistics (intent);
CREATE INDEX IF NOT EXISTS ix_question_statistics_recommended_path
  ON question_statistics (recommended_path);
CREATE INDEX IF NOT EXISTS ix_question_statistics_created_at
  ON question_statistics (created_at);

-- Apoio a "mais fallback Claude" e "mais cache hit".
CREATE INDEX IF NOT EXISTS ix_question_statistics_used_claude
  ON question_statistics (used_claude);
CREATE INDEX IF NOT EXISTS ix_question_statistics_used_cache
  ON question_statistics (used_cache);
