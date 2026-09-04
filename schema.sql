-- ════════════════════════════════════════════════════════════════
--  ESQUEMA — Análise Automática SINAPI (projeto standalone)
--  Banco Neon exclusivo deste projeto, provisionado direto pela
--  integração nativa da Vercel (Storage → Create Database → Neon).
--  Sem relação com o banco do fiscal-sinapi-local original.
--  Idempotente: seguro rodar de novo, mesmo com dados existentes.
--  (Todas as rotas já criam essas tabelas sozinhas na primeira
--  chamada — rode isto manualmente só se preferir deixar tudo
--  pronto antes do primeiro uso.)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bases_referencia (
  id           TEXT PRIMARY KEY,
  nome         TEXT NOT NULL,
  competencia  TEXT,
  arquivo      TEXT,
  data_import  TEXT,
  ativa        BOOLEAN DEFAULT true,
  criado_em    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bases_itens (
  base_id   TEXT NOT NULL,
  ordem     INTEGER NOT NULL,
  itens     JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (base_id, ordem)
);

CREATE TABLE IF NOT EXISTS dados_compartilhados (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  memoria       JSONB DEFAULT '{"medicoes":[]}'::jsonb,
  composicoes   JSONB DEFAULT '[]'::jsonb,
  atualizado_em TIMESTAMPTZ DEFAULT now()
);
INSERT INTO dados_compartilhados (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS analises_automaticas (
  id             BIGSERIAL PRIMARY KEY,
  os_id          TEXT,
  arquivo_nome   TEXT,
  resumo         JSONB NOT NULL,
  itens          JSONB NOT NULL,
  metadados_pdf  JSONB,
  criado_em      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analises_automaticas_os_id ON analises_automaticas (os_id);
