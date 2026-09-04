import { normSA } from "@/lib/analise";
import { carregarBasesAtivas } from "@/lib/basesServer";

// ═══════════════════════════════════════════════════════════════════════════
//  BUSCA ASSISTIDA DE CÓDIGO — usada pelo formulário "Corrigir código" na
//  tela de análise: em vez do fiscal ter que já saber o código certo de
//  cor, digita um trecho da descrição (ou do código) e escolhe entre os
//  candidatos encontrados nas bases ativas (SINAPI/ORSE).
//
//  GET /api/bases/buscar?q=texto  → { resultados: [{codigo,descricao,unidade,preco,banco}] }
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  if (q.length < 3) {
    return Response.json({ resultados: [], aviso: "Digite pelo menos 3 letras." });
  }

  try {
    const { baseSinapi, baseOrse } = await carregarBasesAtivas();
    const termo = normSA(q);
    const todas = [...baseSinapi, ...baseOrse];

    const pontuar = (item) => {
      const cod = normSA(item.codigo || "");
      const desc = normSA(item.descricao || "");
      if (cod === termo) return 0;
      if (cod.startsWith(termo)) return 1;
      if (desc.startsWith(termo)) return 2;
      if (cod.includes(termo)) return 3;
      if (desc.includes(termo)) return 4;
      return null;
    };

    const encontrados = [];
    for (const item of todas) {
      const p = pontuar(item);
      if (p !== null) encontrados.push({ p, item });
    }
    encontrados.sort((a, b) => a.p - b.p);

    const resultados = encontrados.slice(0, 20).map(({ item }) => ({
      codigo: item.codigo,
      descricao: item.descricao,
      unidade: item.unidade,
      preco: item.preco,
      banco: item.tabela,
    }));

    return Response.json({ resultados });
  } catch (e) {
    return Response.json({ erro: e.message || "Falha na busca." }, { status: 500 });
  }
}
