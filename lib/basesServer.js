import { sql } from "@/lib/db";
import { normSA } from "@/lib/analise";

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

// Grava (ou atualiza) no MESMO campo `dados_compartilhados.composicoes` a
// composição própria validada pelo fiscal, para que ela sirva de referência
// em análises futuras de outros orçamentos onde o mesmo serviço apareça
// (ver analisarItem, ramo `item.proprio`, em lib/analise.js). Não cria
// tabela/campo novo — só passou a escrever no que já existia só de leitura.
//
// Deduplicação: uma nova entrada substitui qualquer entrada anterior com o
// mesmo código (quando informado) ou a mesma descrição normalizada, para a
// memória não crescer com duplicatas/versões desatualizadas do mesmo item.
export async function salvarComposicaoMemoria({ codigo, descricao, unidade, preco, insumos, analiseId, fiscal }) {
  const desc = String(descricao || "").trim();
  if (!desc) return;
  const cod = String(codigo || "").trim();
  const descN = normSA(desc);
  const codN = normSA(cod);

  await garantirTabelaDados();

  const entrada = {
    codigo: cod,
    descricao: desc,
    unidade: String(unidade || "").trim(),
    preco: Number(preco) || 0,
    insumos: Array.isArray(insumos) ? insumos : [],
    tabela: "Memória (fiscal)",
    origem: { analiseId: analiseId ?? null, fiscal: fiscal || "fiscal", data: new Date().toISOString() },
    // Chave já normalizada (mesma normSA usada no resto do app), gravada
    // junto da entrada para o UPDATE abaixo filtrar duplicatas sem precisar
    // reproduzir normSA em SQL puro.
    codN, descN,
  };

  // Garante a linha (id=1) sem tocar em `composicoes` se ela já existir.
  await sql`INSERT INTO dados_compartilhados (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

  // Filtra as duplicatas (mesmo código ou mesma descrição normalizada) e
  // acrescenta a nova entrada num único UPDATE atômico: a subquery lê
  // `composicoes` da mesma linha que este UPDATE está travando, então duas
  // gravações concorrentes (dois fiscais salvando ao mesmo tempo) ficam
  // serializadas pelo Postgres em vez de uma sobrescrever silenciosamente
  // o que a outra acabou de gravar (o risco do antigo "lê no app, grava
  // depois", com as duas etapas em consultas separadas).
  await sql`
    UPDATE dados_compartilhados
    SET composicoes = (
      SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(composicoes, '[]'::jsonb)) elem
      WHERE NOT (
        (${codN} <> '' AND elem->>'codN' = ${codN})
        OR elem->>'descN' = ${descN}
      )
    ) || ${JSON.stringify([entrada])}::jsonb,
    atualizado_em = now()
    WHERE id = 1
  `;
}
