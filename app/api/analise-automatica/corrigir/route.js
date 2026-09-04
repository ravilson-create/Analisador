import { sql } from "@/lib/db";
import { analisarItem, montarIndiceBases, montarResumo, extrairBruto, parseFlt } from "@/lib/analise";
import { carregarBasesAtivas, carregarComposicoesEHistorico } from "@/lib/basesServer";

// ═══════════════════════════════════════════════════════════════════════════
//  CORREÇÃO DE ITEM — equivalente ao que o app original fazia em memória
//  (corrigir quantidade, corrigir código, criar composição própria com
//  insumos, aceitar com justificativa), só que aqui persistido direto no
//  registro da análise em `analises_automaticas`.
//
//  Estratégia: em vez de guardar uma cópia "crua" separada do item, o
//  próprio item já analisado carrega todos os campos de entrada (porque
//  analisarItem devolve `{...item, ...calculados}`). Então, para reprocessar
//  um item corrigido, extraímos de volta só os campos de entrada
//  (extrairBruto), aplicamos a correção neles e rodamos analisarItem de
//  novo — exatamente como o app original refazia `itensAnalisados` a cada
//  mudança em `medData.itens`.
//
//  POST body: { analiseId, itemIndex, acao, payload }
//  acao:
//    "quantidade"  payload: { quantidadeFiscal: number|null }
//    "codigo"      payload: { codigo: string }
//    "composicao"  payload: { descricao, unidade, insumos:[{codigo,descricao,unidade,coeficiente,preco}] }
//    "aceite"      payload: { justificativa: string } | null (null desfaz)
// ═══════════════════════════════════════════════════════════════════════════

const hoje = () => new Date().toLocaleDateString("pt-BR");

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ erro: "Corpo da requisição precisa ser JSON." }, { status: 400 });
  }

  const { analiseId, itemIndex, acao, payload } = body || {};
  if (!analiseId || itemIndex == null || !acao) {
    return Response.json({ erro: "Campos obrigatórios: analiseId, itemIndex, acao." }, { status: 400 });
  }

  try {
    const linhas = await sql`SELECT itens FROM analises_automaticas WHERE id = ${analiseId}`;
    if (!linhas[0]) return Response.json({ erro: "Análise não encontrada." }, { status: 404 });

    const itens = linhas[0].itens;
    const atual = itens[itemIndex];
    if (!atual) return Response.json({ erro: `Item ${itemIndex} não encontrado nessa análise.` }, { status: 404 });

    const bruto = extrairBruto(atual);
    let aceite = atual._aceite || null;

    if (acao === "quantidade") {
      const q = payload?.quantidadeFiscal;
      if (q === null || q === undefined || q === "") delete bruto.quantidadeFiscal;
      else {
        const n = Number(q);
        if (Number.isNaN(n) || n < 0) return Response.json({ erro: "Quantidade inválida." }, { status: 400 });
        bruto.quantidadeFiscal = n;
      }
    } else if (acao === "codigo") {
      const codigo = String(payload?.codigo || "").trim();
      if (!codigo) return Response.json({ erro: "Informe o novo código." }, { status: 400 });
      bruto.codigo = codigo;
      bruto.proprio = false;
      aceite = {
        tipo: "correcao_fiscal",
        justificativa: `Código corrigido pelo fiscal para "${codigo}".`,
        data: hoje(),
        fiscal: payload?.fiscal || "fiscal",
      };
    } else if (acao === "composicao") {
      const insumosEntrada = Array.isArray(payload?.insumos) ? payload.insumos : [];
      const descricao = String(payload?.descricao || "").trim();
      if (!descricao || insumosEntrada.length === 0) {
        return Response.json({ erro: "Informe a descrição da composição e ao menos um insumo." }, { status: 400 });
      }
      const insumos = insumosEntrada.map((i) => ({
        codigo: String(i.codigo || "").trim(),
        descricao: String(i.descricao || "").trim(),
        banco: String(i.banco || "Próprio").trim(),
        unidade: String(i.unidade || "").trim(),
        coeficiente: parseFlt(i.coeficiente),
        preco: parseFlt(i.preco),
      }));
      const precoCalc = insumos.reduce((s, i) => s + i.coeficiente * i.preco, 0);
      bruto.descricao = descricao;
      bruto.unidade = String(payload?.unidade || bruto.unidade || "").trim();
      bruto.preco = precoCalc;
      bruto.insumos = insumos;
      bruto.proprio = true;
      aceite = {
        tipo: "correcao_fiscal",
        justificativa: `Composição própria criada pelo fiscal com ${insumos.length} insumo(s) — custo direto R$ ${precoCalc.toFixed(2)}.`,
        data: hoje(),
        fiscal: payload?.fiscal || "fiscal",
      };
    } else if (acao === "aceite") {
      if (payload && payload.justificativa) {
        aceite = {
          tipo: "aceito_ressalva",
          justificativa: String(payload.justificativa).trim(),
          data: hoje(),
          fiscal: payload.fiscal || "fiscal",
          precoAceito: atual.preco,
          precoRef: atual.ref?.preco ?? null,
        };
      } else {
        aceite = null;
      }
    } else {
      return Response.json({ erro: `Ação desconhecida: "${acao}".` }, { status: 400 });
    }

    const [{ baseSinapi, baseOrse }, { composicoes, historico }] = await Promise.all([
      carregarBasesAtivas(),
      carregarComposicoesEHistorico(),
    ]);
    const indiceBases = montarIndiceBases(baseSinapi, baseOrse, composicoes);
    const recomputado = analisarItem(bruto, indiceBases, historico);
    const novoItem = { ...recomputado, _aceite: aceite };
    itens[itemIndex] = novoItem;

    const resumo = montarResumo(itens);
    await sql`
      UPDATE analises_automaticas
      SET itens = ${JSON.stringify(itens)}::jsonb, resumo = ${JSON.stringify(resumo)}::jsonb
      WHERE id = ${analiseId}
    `;

    return Response.json({ ok: true, item: novoItem, resumo });
  } catch (e) {
    console.error("[analise-automatica/corrigir POST]", e);
    return Response.json({ erro: e.message || "Falha ao aplicar a correção." }, { status: 500 });
  }
}
