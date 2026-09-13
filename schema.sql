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

-- ════════════════════════════════════════════════════════════════
--  LOGIN INDIVIDUAL — cadastro restrito a e-mails @mpma.mp.br (ver
--  DOMINIO_PERMITIDO em lib/db.js). A primeira conta criada (tabela
--  vazia) vira administrador automaticamente; as seguintes entram como
--  usuário comum. Só administrador sobe/exclui base; usuário comum só
--  ativa/desativa. Para promover alguém a admin manualmente depois:
--    UPDATE usuarios SET perfil = 'admin' WHERE email = 'fulano@mpma.mp.br';
-- ════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS usuarios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  nome       TEXT NOT NULL,
  perfil     TEXT NOT NULL DEFAULT 'usuario',
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id),
  token_hash  TEXT NOT NULL,
  expira_em   TIMESTAMPTZ NOT NULL,
  revogada_em TIMESTAMPTZ,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tentativas_login (
  chave         TEXT PRIMARY KEY,
  falhas        INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- usuario_id NULL = análise pública (disparada pelo Apps Script do Tá na
-- Mão, sem sessão de navegador) — visível para qualquer usuário logado.
-- Preenchido = análise privada de quem a rodou manualmente pela tela.
CREATE TABLE IF NOT EXISTS analises_automaticas (
  id             BIGSERIAL PRIMARY KEY,
  os_id          TEXT,
  arquivo_nome   TEXT,
  resumo         JSONB NOT NULL,
  itens          JSONB NOT NULL,
  metadados_pdf  JSONB,
  usuario_id     UUID REFERENCES usuarios(id),
  criado_em      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analises_automaticas_os_id ON analises_automaticas (os_id);
CREATE INDEX IF NOT EXISTS idx_analises_automaticas_usuario_id ON analises_automaticas (usuario_id);
