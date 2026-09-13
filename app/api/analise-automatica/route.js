import { sql, sessaoValida, ehAdmin, garantirTabelasAuth } from "@/lib/db";
import { parseMedicao, montarIndiceBases, analisarItem, montarResumo } from "@/lib/analise";
import { construirXlsxDoPdf } from "@/lib/pdfParaXlsx";
import { carregarBasesAtivas, carregarComposicoesEHistorico } from "@/lib/basesServer";

// ═══════════════════════════════════════════════════════════════════════════
//  ANÁLISE AUTOMÁTICA — projeto standalone, banco Neon próprio.
//
//  Disparada externamente (Apps Script vinculado à planilha do Tá na Mão)
//  quando uma empresa contratada anexa uma nova "Planilha de Orçamento"
//  (PDF) a uma OS — SEM sessão de navegador, protegida só pela chave que
//  api/pdf-tabela.py exige (ver abaixo) — ou manualmente por um usuário
//  logado, pela própria tela inicial.
//
//  Dono da análise: se houver sessão válida (upload manual pela tela),
//  usuario_id = quem estava logado; se não houver (Apps Script), fica NULL
//  — análise "pública", visível para qualquer usuário logado (ver
//  app/api/analises e a checagem de visibilidade no GET abaixo).
//
//  A única chave que ainda existe (AUTOMACAO_API_KEY) protege só a chamada
//  interna servidor-a-servidor para api/pdf-tabela.py logo abaixo — nunca
//  aparece em tela nem precisa ser digitada por ninguém.
//
//  Fluxo: PDF (base64) → api/pdf-tabela.py extrai as tabelas → aqui viram
//  um .xlsx em memória → parseMedicao + analisarItem (lib/analise.js)
//  processam esse .xlsx contra as bases SINAPI/ORSE deste banco.
// ═══════════════════════════════════════════════════════════════════════════

let tabelaAuditoriaPronta = null;
function garantirTabelaAuditoria() {
  if (!tabelaAuditoriaPronta) {
    tabelaAuditoriaPronta = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS analises_automaticas (
          id             BIGSERIAL PRIMARY KEY,
          os_id          TEXT,
          arquivo_nome   TEXT,
          resumo         JSONB NOT NULL,
          itens          JSONB NOT NULL,
          metadados_pdf  JSONB,
          criado_em      TIMESTAMPTZ DEFAULT now()
        )
      `;
      // Garante usuarios/sessoes (para a FK) e a coluna usuario_id, não
      // importa a ordem em que as rotas rodem pela primeira vez.
      await garantirTabelasAuth();
    })().catch((e) => { tabelaAuditoriaPronta = null; throw e; });
  }
  return tabelaAuditoriaPronta;
}

// POST /api/analise-automatica  { osId, arquivoNome, pdfBase64 }
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ erro: "Corpo da requisição precisa ser JSON." }, { status: 400 });
  }

  const { osId, arquivoNome, pdfBase64 } = body || {};
  if (!pdfBase64) {
    return Response.json({ erro: "Campo 'pdfBase64' é obrigatório (PDF em base64)." }, { status: 400 });
  }

  try {
    await garantirTabelaAuditoria();
    // Sessão é OPCIONAL aqui de propósito — o Apps Script chama esta rota
    // sem navegador/cookie nenhum. Se houver sessão (upload manual pela
    // tela), a análise fica privada de quem estava logado.
    const usuario = await sessaoValida();

    const origem = new URL(request.url).origin;
    const respPdf = await fetch(`${origem}/api/pdf-tabela`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.AUTOMACAO_API_KEY },
      body: JSON.stringify({ pdf_base64: pdfBase64 }),
    });
    if (!respPdf.ok) {
      const erro = await respPdf.json().catch(() => ({}));
      return Response.json({ erro: `Falha ao ler o PDF (etapa de extração): ${erro.erro || respPdf.status}` }, { status: 422 });
    }
    const extraido = await respPdf.json();

    const bufferXlsx = construirXlsxDoPdf(extraido);
    const medData = parseMedicao(bufferXlsx);
    if (!medData.itens.length) {
      return Response.json(
        { erro: "PDF foi lido, mas nenhum item de medição foi reconhecido. Verifique se o layout é o padrão SAGA/MP-MA (abas Sintético + Analítico)." },
        { status: 422 }
      );
    }

    const [{ baseSinapi, baseOrse }, { composicoes, historico }] = await Promise.all([
      carregarBasesAtivas(),
      carregarComposicoesEHistorico(),
    ]);

    const indiceBases = montarIndiceBases(baseSinapi, baseOrse, composicoes);
    const itensAnalisados = medData.itens.map((i) => analisarItem(i, indiceBases, historico));
    const resumo = montarResumo(itensAnalisados);

    const registrado = await sql`
      INSERT INTO analises_automaticas (os_id, arquivo_nome, resumo, itens, metadados_pdf, usuario_id)
      VALUES (${osId || null}, ${arquivoNome || null}, ${JSON.stringify(resumo)}::jsonb,
              ${JSON.stringify(itensAnalisados)}::jsonb, ${JSON.stringify(extraido.metadados || {})}::jsonb,
              ${usuario?.id ?? null})
      RETURNING id, criado_em
    `;

    return Response.json({
      ok: true,
      analiseId: registrado[0].id,
      criadoEm: registrado[0].criado_em,
      resumo,
      bdi: medData.bdi,
      reajuste: medData.reajuste,
      desagio: medData.desagio,
      itens: itensAnalisados,
      avisoBases: (baseSinapi.length + baseOrse.length) === 0
        ? "Nenhuma base SINAPI/ORSE ativa neste banco — todos os itens ficaram sem referência de preço. Importe as bases em / antes de confiar no resultado."
        : null,
    });
  } catch (e) {
    console.error("[analise-automatica POST]", e);
    return Response.json({ erro: e.message || "Falha inesperada na análise automática." }, { status: 500 });
  }
}

// Análise pública (usuario_id NULL, disparada pelo Apps Script) é visível
// para qualquer usuário logado; análise privada só para quem a rodou ou
// para o administrador (supervisão).
function podeVer(analise, usuario) {
  return analise.usuario_id == null || analise.usuario_id === usuario.id || ehAdmin(usuario);
}

// GET /api/analise-automatica?id=123   ou   ?osId=xxx (traz a mais recente)
// Exige login — usada pela tela principal e pelo parecer imprimível.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const osId = searchParams.get("osId");
  try {
    await garantirTabelaAuditoria();
    const usuario = await sessaoValida();
    if (!usuario) return Response.json({ erro: "Você precisa entrar para ver esta análise." }, { status: 401 });

    if (id) {
      const r = await sql`SELECT * FROM analises_automaticas WHERE id = ${id}`;
      if (!r[0]) return Response.json({ erro: "Análise não encontrada." }, { status: 404 });
      if (!podeVer(r[0], usuario)) return Response.json({ erro: "Você não tem permissão para ver esta análise." }, { status: 403 });
      return Response.json({ analise: r[0] });
    }
    if (osId) {
      const r = await sql`SELECT * FROM analises_automaticas WHERE os_id = ${osId} ORDER BY criado_em DESC LIMIT 1`;
      if (!r[0]) return Response.json({ erro: "Nenhuma análise encontrada para essa OS." }, { status: 404 });
      if (!podeVer(r[0], usuario)) return Response.json({ erro: "Você não tem permissão para ver esta análise." }, { status: 403 });
      return Response.json({ analise: r[0] });
    }
    return Response.json({ erro: "Informe 'id' ou 'osId'." }, { status: 400 });
  } catch (e) {
    return Response.json({ erro: e.message }, { status: 500 });
  }
}
