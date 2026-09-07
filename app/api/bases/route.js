import { sql } from "@/lib/db";
import { norm } from "@/lib/analise";

// ═══════════════════════════════════════════════════════════════════════════
//  BASES DE REFERÊNCIA (SINAPI/ORSE) — banco próprio deste projeto.
//
//  Como este projeto usa um Neon exclusivo (não o do fiscal-sinapi-local
//  original), as bases precisam ser importadas aqui também — não há
//  nenhum vínculo automático com as bases do app antigo. Use a página
//  inicial (/) para subir os arquivos .xlsx, ou chame esta rota
//  diretamente. Mesmo desenho em duas etapas do app original (metadados
//  primeiro, depois os itens em lotes) para não esbarrar no limite de
//  tamanho de requisição da Vercel com uma SINAPI inteira (dezenas de
//  milhares de itens).
// ═══════════════════════════════════════════════════════════════════════════

let tabelasProntas = null;
function garantirTabelas() {
  if (!tabelasProntas) {
    tabelasProntas = criarTabelas().catch((e) => { tabelasProntas = null; throw e; });
  }
  return tabelasProntas;
}

async function criarTabelas() {
  await sql`
    CREATE TABLE IF NOT EXISTS bases_referencia (
      id           TEXT PRIMARY KEY,
      nome         TEXT NOT NULL,
      competencia  TEXT,
      arquivo      TEXT,
      data_import  TEXT,
      ativa        BOOLEAN DEFAULT true,
      criado_em    TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bases_itens (
      base_id   TEXT NOT NULL,
      ordem     INTEGER NOT NULL,
      itens     JSONB NOT NULL DEFAULT '[]',
      PRIMARY KEY (base_id, ordem)
    )
  `;
}

export async function GET(request) {
  try {
    await garantirTabelas();
    const metas = await sql`
      SELECT id, nome, competencia, arquivo, data_import, ativa
      FROM bases_referencia ORDER BY criado_em ASC
    `;
    const bases = [];
    for (const m of metas) {
      const [{ total }] = await sql`
        SELECT COALESCE(SUM(jsonb_array_length(itens)), 0)::int AS total
        FROM bases_itens WHERE base_id = ${m.id}
      `;
      bases.push({ ...m, totalItens: total });
    }
    return Response.json({ bases });
  } catch (e) {
    return Response.json({ erro: e.message }, { status: 500 });
  }
}

// Ações: "base" (grava/atualiza metadados de UMA base — e REGRAVA os itens
// dela do zero, use só em importação completa), "chunk" (grava um lote de
// itens dentro de uma base já criada por "base"), "toggle" (ativa/inativa),
// "item" (acrescenta UM item avulso a uma base "de coleção" identificada só
// pelo nome — cria a base se não existir; NUNCA apaga os itens que já
// tinha, ao contrário de "base" — usada pela Busca online do ORSE).
export async function POST(request) {
  try {
    await garantirTabelas();
    const body = await request.json();
    const acao = body.acao;

    if (acao === "base") {
      const b = body.meta;
      if (!b?.id) return Response.json({ erro: "meta inválida" }, { status: 400 });
      await sql`DELETE FROM bases_itens WHERE base_id = ${b.id}`;
      await sql`
        INSERT INTO bases_referencia (id, nome, competencia, arquivo, data_import, ativa)
        VALUES (${b.id}, ${b.nome}, ${b.competencia || null}, ${b.arquivo || null}, ${b.dataImport || null}, ${b.ativa ?? true})
        ON CONFLICT (id) DO UPDATE SET
          nome = EXCLUDED.nome, competencia = EXCLUDED.competencia, arquivo = EXCLUDED.arquivo,
          data_import = EXCLUDED.data_import, ativa = EXCLUDED.ativa
      `;
      return Response.json({ ok: true, id: b.id });
    }

    if (acao === "chunk") {
      const { baseId, ordem, itens } = body;
      if (!baseId || ordem == null || !Array.isArray(itens)) {
        return Response.json({ erro: "chunk inválido" }, { status: 400 });
      }
      await sql`
        INSERT INTO bases_itens (base_id, ordem, itens)
        VALUES (${baseId}, ${ordem}, ${JSON.stringify(itens)})
        ON CONFLICT (base_id, ordem) DO UPDATE SET itens = EXCLUDED.itens
      `;
      return Response.json({ ok: true, baseId, ordem, gravados: itens.length });
    }

    if (acao === "toggle") {
      const { id, ativa } = body;
      if (!id) return Response.json({ erro: "id obrigatório" }, { status: 400 });
      await sql`UPDATE bases_referencia SET ativa = ${ativa ?? true} WHERE id = ${id}`;
      return Response.json({ ok: true });
    }

    if (acao === "item") {
      const { baseNome, competencia, arquivo, item } = body;
      const cod = String(item?.codigo || "").trim();
      const desc = String(item?.descricao || "").trim();
      if (!baseNome || !desc) {
        return Response.json({ erro: "baseNome e item.descricao são obrigatórios." }, { status: 400 });
      }
      const id = `online-${norm(baseNome)}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      // Garante só os METADADOS da base (cria se não existir; se já existir,
      // atualiza só os campos de exibição) — nunca apaga bases_itens, ao
      // contrário da ação "base" acima, porque aqui itens vão se acumulando
      // um a um ao longo do tempo.
      await sql`
        INSERT INTO bases_referencia (id, nome, competencia, arquivo, data_import, ativa)
        VALUES (${id}, ${baseNome}, ${competencia || null}, ${arquivo || null}, ${new Date().toLocaleDateString("pt-BR")}, true)
        ON CONFLICT (id) DO UPDATE SET
          competencia = EXCLUDED.competencia, arquivo = EXCLUDED.arquivo, data_import = EXCLUDED.data_import
      `;

      // Todos os itens adicionados assim ficam num único chunk (ordem 0).
      // codN vai gravado dentro do próprio item para o UPDATE abaixo achar
      // duplicata por código sem precisar reproduzir `norm` em SQL.
      const codN = norm(cod);
      const novoItem = {
        codigo: cod,
        descricao: desc,
        unidade: String(item?.unidade || "").trim(),
        preco: Number(item?.preco) || 0,
        tipo: "composicao",
        codN,
      };

      // Troca do item com o mesmo código (se houver) e acréscimo do novo
      // num único INSERT ... ON CONFLICT DO UPDATE: a cláusula SET lê
      // `bases_itens.itens` (o valor atual da MESMA linha que este upsert
      // está travando) — duas gravações concorrentes na mesma base ficam
      // serializadas pelo Postgres em vez da segunda sobrescrever o item
      // que a primeira acabou de acrescentar (o risco do antigo "lê no
      // app, grava depois", em consultas separadas).
      const [{ itens: gravados }] = await sql`
        INSERT INTO bases_itens (base_id, ordem, itens)
        VALUES (${id}, 0, ${JSON.stringify([novoItem])})
        ON CONFLICT (base_id, ordem) DO UPDATE SET itens = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements(bases_itens.itens) elem
          WHERE NOT (${codN} <> '' AND elem->>'codN' = ${codN})
        ) || EXCLUDED.itens
        RETURNING itens
      `;
      return Response.json({ ok: true, id, total: gravados.length });
    }

    return Response.json({ erro: "ação desconhecida" }, { status: 400 });
  } catch (e) {
    return Response.json({ erro: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    await garantirTabelas();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ erro: "id obrigatório" }, { status: 400 });
    await sql`DELETE FROM bases_itens WHERE base_id = ${id}`;
    await sql`DELETE FROM bases_referencia WHERE id = ${id}`;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e.message }, { status: 500 });
  }
}
