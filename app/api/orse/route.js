import * as cheerio from "cheerio";

// ═══════════════════════════════════════════════════════════════════════════
//  BUSCA ONLINE — ORSE Sergipe (CEHOP), a mesma fonte pública e gratuita já
//  usada no fiscal-sinapi-local (app/api/orse/route.js de lá). Só a consulta
//  foi trazida para cá — sem a exigência de sessão/login que o app antigo
//  tinha, porque o ORÇA VALIDA não tem autenticação nenhuma (ver README).
//
//  GET /api/orse?termo=texto
//    → { termo, periodo, resultados: [{codigo,descricao,unidade,custoUnit,link}] }
// ═══════════════════════════════════════════════════════════════════════════

async function buscarPeriodo(termo, periodo) {
  const params = new URLSearchParams({
    sltFonte: "0",
    sltPeriodo: periodo,
    sltGrupoServico: "0",
    rdbCriterio: "1",
    txtDescricao: termo,
    Submit: "Consultar",
  });

  const response = await fetch(`https://orse.cehop.se.gov.br/servicosargumento.asp?tarefa=consultar`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const buffer = await response.arrayBuffer();
  const html = new TextDecoder("iso-8859-1").decode(buffer);
  const $ = cheerio.load(html);
  const resultados = [];

  $("tr").each((i, tr) => {
    const tds = $(tr).find("td.CorpoTabela");
    if (tds.length === 4) {
      const linkEl = $(tds[0]).find("a");
      resultados.push({
        codigo: linkEl.text().trim(),
        descricao: $(tds[1]).text().trim(),
        unidade: $(tds[2]).text().trim(),
        custoUnit: $(tds[3]).text().trim(),
        link: linkEl.attr("href") || null,
      });
    }
  });

  return resultados;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const termo = (searchParams.get("termo") || "").trim();

  if (!termo) {
    return Response.json({ erro: 'Parâmetro "termo" é obrigatório.' }, { status: 400 });
  }

  const hoje = new Date();
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth() + 1;

  // Tenta o mês atual e volta até 12 meses, pois o ORSE pode estar com a
  // publicação atrasada em relação ao calendário.
  for (let tentativa = 0; tentativa < 12; tentativa++) {
    const periodo = `${ano}-${mes}-1`;
    try {
      const resultados = await buscarPeriodo(termo, periodo);
      if (resultados.length > 0) {
        return Response.json({ termo, periodo, resultados });
      }
    } catch (e) {
      // ignora e tenta o mês anterior
    }
    mes--;
    if (mes === 0) { mes = 12; ano--; }
  }

  return Response.json({ termo, periodo: null, resultados: [] });
}
