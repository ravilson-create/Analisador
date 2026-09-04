import { sql } from "@/lib/db";

// Bases ativas (SINAPI/ORSE), no formato que lib/analise.js espera: cada
// item ganha `tabela` = nome da base importada. Compartilhado entre a rota
// de análise automática e a de correções (ambas precisam montar o mesmo
// índice de referência para reprocessar um item).
export async function carregarBasesAtivas() {
  const metas = await sql`SELECT id, nome FROM bases_referencia WHERE ativa = true`;
  const baseSinapi = [];
  const baseOrse = [];
  for (const m of metas) {
    const chunks = await sql`SELECT itens FROM bases_itens WHERE base_id = ${m.id} ORDER BY ordem ASC`;
    const alvo = m.nome.toUpperCase().includes("SINAPI") ? baseSinapi : baseOrse;
    for (const c of chunks) {
      if (!Array.isArray(c.itens)) continue;
      for (const it of c.itens) alvo.push({ ...it, tabela: m.nome });
    }
  }
  return { baseSinapi, baseOrse };
}

// Memória de medições/composições próprias compartilhadas deste projeto.
// Banco novo — começa vazio; a análise funciona normalmente sem histórico,
// só sem os alertas de tendência de preço entre medições até essa tabela
// ganhar uso.
let tabelaDadosPronta = null;
function garantirTabelaDados() {
  if (!tabelaDadosPronta) {
    tabelaDadosPronta = sql`
      CREATE TABLE IF NOT EXISTS dados_compartilhados (
        id            INTEGER PRIMARY KEY DEFAULT 1,
        memoria       JSONB DEFAULT '{"medicoes":[]}'::jsonb,
        composicoes   JSONB DEFAULT '[]'::jsonb,
        atualizado_em TIMESTAMPTZ DEFAULT now()
      )
    `.catch((e) => { tabelaDadosPronta = null; throw e; });
  }
  return tabelaDadosPronta;
}
export async function carregarComposicoesEHistorico() {
  await garantirTabelaDados();
  const r = await sql`SELECT memoria, composicoes FROM dados_compartilhados WHERE id = 1`;
  const memoria = r[0]?.memoria ?? { medicoes: [] };
  const composicoes = r[0]?.composicoes ?? [];
  const historico = (memoria.medicoes || []).flatMap((m) => m.itens || []);
  return { composicoes, historico };
}
