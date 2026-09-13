import { neon } from "@neondatabase/serverless";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { createHash } from "crypto";

// Este projeto é standalone: banco Neon próprio (provisionado direto pela
// integração nativa da Vercel — Storage → Create Database → Neon), sem
// nenhuma relação com o banco do fiscal-sinapi-local original.
export const sql = neon(process.env.DATABASE_URL);

// ═══════════════════════════════════════════════════════════════════════════
//  LOGIN INDIVIDUAL — cadastro aberto, mas restrito a e-mails do domínio
//  institucional; bases continuam compartilhadas, análises passam a ser
//  privadas de cada usuário (ver app/api/analises e app/api/
//  analise-automatica). Mesmo padrão (jose + pgcrypto + sessão revogável +
//  rate limit de login) já usado e testado no app irmão
//  fiscal-sinapi-local, só sem o conceito de organização/multi-tenant —
//  aqui é usuário único por conta.
// ═══════════════════════════════════════════════════════════════════════════
export const DOMINIO_PERMITIDO = "@mpma.mp.br";
export function emailPermitido(email) {
  return String(email || "").trim().toLowerCase().endsWith(DOMINIO_PERMITIDO);
}

// Sem valor padrão de propósito: um segredo fixo aqui estaria publicado
// junto com o código e permitiria forjar um cookie de sessão válido. Sem a
// variável, assinar/verificar sessão falha de forma visível, em vez de
// aceitar tokens forjados.
function segredoSessao() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "AUTH_SECRET ausente ou muito curta (mínimo 32 caracteres). Configure-a nas variáveis de ambiente do projeto na Vercel."
    );
  }
  return new TextEncoder().encode(s);
}
const COOKIE = "analisador_sessao";
const DURACAO_SESSAO_HORAS = 12;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function ehAdmin(usuario) {
  return usuario?.perfil === "admin";
}

let tabelasAuthProntas = null;
export function garantirTabelasAuth() {
  if (!tabelasAuthProntas) {
    tabelasAuthProntas = criarTabelasAuth().catch((e) => { tabelasAuthProntas = null; throw e; });
  }
  return tabelasAuthProntas;
}
async function criarTabelasAuth() {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await sql`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email      TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      nome       TEXT NOT NULL,
      perfil     TEXT NOT NULL DEFAULT 'usuario',
      ativo      BOOLEAN NOT NULL DEFAULT true,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sessoes (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      usuario_id  UUID NOT NULL REFERENCES usuarios(id),
      token_hash  TEXT NOT NULL,
      expira_em   TIMESTAMPTZ NOT NULL,
      revogada_em TIMESTAMPTZ,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tentativas_login (
      chave         TEXT PRIMARY KEY,
      falhas        INTEGER NOT NULL DEFAULT 0,
      bloqueado_ate TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE analises_automaticas ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES usuarios(id)`;
}

// Bloqueio de força bruta por e-mail: sem isso, uma senha podia ser
// adivinhada por tentativa e erro sem nenhum freio automático.
const LIMITE_TENTATIVAS_LOGIN = 5;
const BLOQUEIO_LOGIN_MINUTOS = 15;

export async function loginBloqueado(email) {
  await garantirTabelasAuth();
  const chave = email.toLowerCase();
  const r = await sql`SELECT bloqueado_ate FROM tentativas_login WHERE chave = ${chave}`;
  const ate = r[0]?.bloqueado_ate ? new Date(r[0].bloqueado_ate) : null;
  return ate && ate > new Date() ? ate : null;
}

export async function registrarTentativaFalha(email) {
  await garantirTabelasAuth();
  const chave = email.toLowerCase();
  const r = await sql`
    INSERT INTO tentativas_login (chave, falhas, atualizado_em)
    VALUES (${chave}, 1, now())
    ON CONFLICT (chave) DO UPDATE SET
      falhas = CASE
        WHEN tentativas_login.bloqueado_ate IS NOT NULL AND tentativas_login.bloqueado_ate < now()
        THEN 1 ELSE tentativas_login.falhas + 1
      END,
      atualizado_em = now()
    RETURNING falhas
  `;
  const falhas = r[0]?.falhas || 1;
  if (falhas >= LIMITE_TENTATIVAS_LOGIN) {
    const bloqueadoAte = new Date(Date.now() + BLOQUEIO_LOGIN_MINUTOS * 60000).toISOString();
    await sql`UPDATE tentativas_login SET bloqueado_ate = ${bloqueadoAte} WHERE chave = ${chave}`;
  }
}

export async function limparTentativasLogin(email) {
  await garantirTabelasAuth();
  await sql`DELETE FROM tentativas_login WHERE chave = ${email.toLowerCase()}`;
}

export async function verificarCredenciais(email, senha) {
  await garantirTabelasAuth();
  const r = await sql`
    SELECT id, email, nome, perfil
    FROM usuarios
    WHERE lower(email) = lower(${email})
      AND ativo = true
      AND senha_hash = crypt(${senha}, senha_hash)
  `;
  return r[0] || null;
}

export async function criarSessao(usuario) {
  const expiraEm = new Date(Date.now() + DURACAO_SESSAO_HORAS * 60 * 60 * 1000);
  const token = await new SignJWT({ email: usuario.email, nome: usuario.nome, perfil: usuario.perfil })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(usuario.id)
    .setExpirationTime(expiraEm)
    .sign(segredoSessao());

  await sql`
    INSERT INTO sessoes (usuario_id, token_hash, expira_em)
    VALUES (${usuario.id}, ${hashToken(token)}, ${expiraEm.toISOString()})
  `;

  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiraEm,
    path: "/",
  });
}

// Devolve os dados do usuário logado (id, email, nome, perfil) ou null.
export async function sessaoValida() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, segredoSessao()));
  } catch {
    return null;
  }
  const r = await sql`
    SELECT 1 FROM sessoes
    WHERE token_hash = ${hashToken(token)}
      AND revogada_em IS NULL
      AND expira_em > now()
  `;
  if (r.length === 0) return null;
  return { id: payload.sub, email: payload.email, nome: payload.nome, perfil: payload.perfil };
}

export async function encerrarSessao() {
  const token = cookies().get(COOKIE)?.value;
  if (token) {
    await sql`
      UPDATE sessoes SET revogada_em = now()
      WHERE token_hash = ${hashToken(token)} AND revogada_em IS NULL
    `;
  }
  cookies().delete(COOKIE);
}
