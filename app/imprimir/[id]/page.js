"use client";
import { useEffect, useState } from "react";
import { statusEfetivo } from "@/lib/analise";

// ═══════════════════════════════════════════════════════════════════════════
//  PARECER IMPRIMÍVEL — /imprimir/<id da análise>
//
//  Busca a análise já gravada (GET /api/analise-automatica?id=) e monta um
//  relatório enxuto para impressão/"Salvar como PDF" pelo próprio navegador:
//  cabeçalho da OS, resumo, e a tabela item a item com o que a empresa
//  enviou, a referência usada e qualquer correção/aceite do fiscal. Sem
//  dependência extra (sem biblioteca de PDF) — window.print() já entrega
//  "Salvar como PDF" em qualquer navegador.
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_LABEL = {
  conforme: "Conforme",
  "atenção": "Atenção",
  nao_conforme: "Não conforme",
  aceito_ressalva: "Aceito com ressalva",
  correcao_fiscal: "Corrigido pelo fiscal",
};

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Imprimir({ params }) {
  const { id } = params;
  const [analise, setAnalise] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch(`/api/analise-automatica?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => { if (d.erro) setErro(d.erro); else setAnalise(d.analise); })
      .catch((e) => setErro(e.message));
  }, [id]);

  if (erro) return <main style={{ padding: 24, fontFamily: "sans-serif" }}>⚠ {erro}</main>;
  if (!analise) return <main style={{ padding: 24, fontFamily: "sans-serif", color: "#888" }}>Carregando parecer…</main>;

  const meta = analise.metadados_pdf || {};
  const resumo = analise.resumo || {};
  const itens = analise.itens || [];

  return (
    <>
      <style>{`
        body { margin: 0; }
        .folha { max-width: 900px; margin: 0 auto; padding: 28px 24px; font-family: 'Inter','Segoe UI',sans-serif; color: #1A202C; font-size: 12.5px; }
        .barra-acoes { text-align: center; padding: 10px; background: #F4F6FA; border-bottom: 1px solid #E2E8F0; }
        .btn-imprimir { background: #1B3A8C; color: #fff; border: none; border-radius: 6px; padding: 9px 20px; font-size: 13px; font-weight: 700; cursor: pointer; }
        h1 { font-size: 17px; color: #1B3A8C; margin: 0 0 2px; }
        .subtitulo { font-size: 11.5px; color: #666; margin: 0 0 18px; }
        .grade-cabecalho { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
        .campo-cab { border: 1px solid #E2E8F0; border-radius: 6px; padding: 8px 10px; }
        .campo-cab .rotulo { font-size: 9.5px; color: #888; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }
        .campo-cab .valor { font-size: 13px; font-weight: 700; }
        .resumo { display: flex; gap: 18px; flex-wrap: wrap; background: #EFF6FF; border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; font-size: 12px; }
        .resumo b { font-size: 13px; }
        table { width: 100%; border-collapse: collapse; font-size: 10.8px; }
        th { text-align: left; color: #666; font-weight: 700; padding: 6px 6px; border-bottom: 2px solid #1A202C22; text-transform: uppercase; font-size: 9px; letter-spacing: 0.3px; }
        td { padding: 6px; border-top: 1px solid #E2E8F0; vertical-align: top; }
        tr { break-inside: avoid; }
        .selo { font-weight: 700; font-size: 9.5px; padding: 2px 6px; border-radius: 99px; white-space: nowrap; display: inline-block; }
        .selo-conforme { background: #DCFCE7; color: #0D7A3E; }
        .selo-atencao { background: #FEF3C7; color: #92500A; }
        .selo-nao_conforme { background: #FEE2E2; color: #991B1B; }
        .selo-correcao_fiscal { background: #DCFCE7; color: #0D7A3E; }
        .selo-aceito_ressalva { background: #FEF9C3; color: #854D0E; }
        .obs-correcao { margin-top: 3px; font-size: 10px; color: #854D0E; background: #FEF9C3; border-radius: 4px; padding: 3px 6px; }
        .alerta { font-size: 10px; color: #991B1B; margin-bottom: 2px; }
        .rodape { margin-top: 30px; padding-top: 14px; border-top: 1px solid #E2E8F0; font-size: 10px; color: #888; text-align: center; }
        .assinatura { margin-top: 50px; display: flex; justify-content: space-around; }
        .linha-assinatura { border-top: 1px solid #333; width: 260px; text-align: center; padding-top: 4px; font-size: 11px; color: #555; }
        @media print {
          .barra-acoes { display: none; }
          .folha { padding: 0; max-width: none; }
          @page { margin: 14mm; }
        }
      `}</style>

      <div className="barra-acoes">
        <button className="btn-imprimir" onClick={() => window.print()}>🖨 Imprimir / Salvar como PDF</button>
      </div>

      <div className="folha">
        <h1>Parecer de Análise Automática de Orçamento</h1>
        <p className="subtitulo">Análise Automática SINAPI — MPMA · Verificação de conformidade SINAPI/ORSE do orçamento enviado no Tá na Mão.</p>

        <div className="grade-cabecalho">
          <div className="campo-cab"><div className="rotulo">Nº da análise</div><div className="valor">{analise.id}</div></div>
          <div className="campo-cab"><div className="rotulo">OS</div><div className="valor">{analise.os_id || "—"}</div></div>
          <div className="campo-cab"><div className="rotulo">Arquivo</div><div className="valor" style={{ fontSize: 11 }}>{analise.arquivo_nome || "—"}</div></div>
          <div className="campo-cab"><div className="rotulo">Data da análise</div><div className="valor">{new Date(analise.criado_em).toLocaleString("pt-BR")}</div></div>
        </div>

        <div className="grade-cabecalho">
          <div className="campo-cab"><div className="rotulo">BDI</div><div className="valor">{meta.bdi != null ? `${(meta.bdi * 100).toFixed(1)}%` : "—"}</div></div>
          <div className="campo-cab"><div className="rotulo">Reajuste</div><div className="valor">{meta.reajuste ?? "—"}</div></div>
          <div className="campo-cab"><div className="rotulo">Deságio</div><div className="valor">{meta.desagio != null ? `${(meta.desagio * 100).toFixed(1)}%` : "—"}</div></div>
          <div className="campo-cab"><div className="rotulo">Itens analisados</div><div className="valor">{resumo.totalItens}</div></div>
        </div>

        <div className="resumo">
          <span>Conformes: <b>{resumo.conformes}</b></span>
          <span>Atenção: <b>{resumo.atencao}</b></span>
          <span>Não conformes: <b>{resumo.naoConformes}</b></span>
          {resumo.resolvidos > 0 && <span>Resolvidos pelo fiscal: <b>{resumo.resolvidos}</b></span>}
          <span>Valor total medido: <b>R$ {fmt(resumo.valorTotalMedido)}</b></span>
          {resumo.valorExcedente > 0 && <span>Excedente a glosar: <b style={{ color: "#991B1B" }}>R$ {fmt(resumo.valorExcedente)}</b></span>}
          {resumo.valorJustificado > 0 && <span>Justificado/corrigido: <b>R$ {fmt(resumo.valorJustificado)}</b></span>}
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th><th>Código</th><th>Descrição</th><th>Qtd.</th>
              <th>Preço enviado</th><th>Referência</th><th>Total</th><th>Status</th><th>Observações</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it, i) => {
              const efetivo = statusEfetivo(it);
              return (
                <tr key={i}>
                  <td>{it.item}</td>
                  <td>{it.codigo || "—"}</td>
                  <td style={{ maxWidth: 220 }}>{it.descricao}</td>
                  <td>{it.quantidadeFiscal != null ? `${it.quantidadeFiscal} ${it.unidade} (campo)` : `${it.quantidade} ${it.unidade}`}</td>
                  <td>R$ {fmt(it.preco)}</td>
                  <td>{it.ref?.preco != null ? `R$ ${fmt(it.ref.preco)}` : "—"}</td>
                  <td>R$ {fmt(it.totalItem)}</td>
                  <td><span className={`selo selo-${efetivo}`}>{STATUS_LABEL[efetivo] || efetivo}</span></td>
                  <td style={{ minWidth: 160 }}>
                    {(it.alertas || []).map((a, j) => <div key={j} className="alerta">{a}</div>)}
                    {it._aceite && (
                      <div className="obs-correcao">
                        {it._aceite.tipo === "correcao_fiscal" ? "Corrigido: " : "Aceito com ressalva: "}
                        {it._aceite.justificativa} — {it._aceite.fiscal || "fiscal"} em {it._aceite.data}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="assinatura">
          <div className="linha-assinatura">Fiscal do contrato</div>
          <div className="linha-assinatura">COEA/PGJ-MA</div>
        </div>

        <div className="rodape">
          Gerado automaticamente pela Análise Automática SINAPI — MPMA em {new Date().toLocaleString("pt-BR")}. Documento de apoio à fiscalização; não substitui o parecer técnico formal do fiscal do contrato.
        </div>
      </div>
    </>
  );
}
