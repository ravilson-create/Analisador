"use client";
import { useEffect, useState, useCallback, Fragment } from "react";
import { parseBase, statusEfetivo } from "@/lib/analise";

const CHUNK_ITENS = 1500;
const C = { azul: "#1B3A8C", azulBg: "#EFF6FF", verde: "#0D7A3E", verdeBg: "#DCFCE7",
  vermelho: "#991B1B", vermelhoBg: "#FEE2E2", amarelo: "#92500A", amareloBg: "#FEF3C7",
  borda: "#E2E8F0", cinza: "#F4F6FA" };

const STATUS_CFG = {
  conforme:        { label: "Conforme",          cor: C.verde,    bg: C.verdeBg },
  "atenção":       { label: "Atenção",           cor: C.amarelo,  bg: C.amareloBg },
  nao_conforme:    { label: "Não conforme",      cor: C.vermelho, bg: C.vermelhoBg },
  aceito_ressalva: { label: "Aceito c/ ressalva", cor: "#854D0E", bg: "#FEF9C3" },
  correcao_fiscal: { label: "Corrigido",          cor: C.verde,   bg: C.verdeBg },
};
function Selo({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.atenção;
  return (
    <span style={{ background: cfg.bg, color: cfg.cor, fontWeight: 700, fontSize: 11,
      padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap" }}>{cfg.label}</span>
  );
}

const fmt = (n) => Number(n || 0).toFixed(2);

const botaoAcaoEstilo = { background: "#fff", border: `1px solid ${C.borda}`, color: "#333", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" };
const formBoxEstilo = { background: "#fff", border: `1px solid ${C.borda}`, borderRadius: 6, padding: "8px 10px", marginTop: 8, fontSize: 11.5 };
const inputEstiloPeq = { border: `1px solid ${C.borda}`, borderRadius: 5, padding: "5px 8px", fontSize: 11.5, boxSizing: "border-box" };
const linkEstilo = { background: "none", border: "none", color: "#999", fontSize: 10.5, cursor: "pointer", textDecoration: "underline" };

// Formulário de composição própria: descrição/unidade + lista de insumos
// (código, descrição, unidade, coeficiente, preço) editável linha a linha —
// equivalente ao modo "composição" do ModalCorrecao do app original.
function FormComposicao({ inicial, salvando, onSalvar }) {
  const [descricao, setDescricao] = useState(inicial.descricao || "");
  const [unidade, setUnidade] = useState(inicial.unidade || "");
  const [insumos, setInsumos] = useState(
    inicial.insumos?.length ? inicial.insumos.map((i) => ({ ...i })) : [{ codigo: "", descricao: "", unidade: "", coeficiente: "", preco: "" }]
  );
  const atualizar = (i, campo, valor) => setInsumos((arr) => arr.map((row, k) => (k === i ? { ...row, [campo]: valor } : row)));
  const adicionar = () => setInsumos((arr) => [...arr, { codigo: "", descricao: "", unidade: "", coeficiente: "", preco: "" }]);
  const remover = (i) => setInsumos((arr) => arr.filter((_, k) => k !== i));
  const total = insumos.reduce((s, i) => s + (Number(i.coeficiente) || 0) * (Number(i.preco) || 0), 0);
  const valido = descricao.trim() && insumos.some((i) => i.descricao.trim() && Number(i.coeficiente) > 0);

  return (
    <div style={formBoxEstilo}>
      <div style={{ fontWeight: 700, color: "#555", marginBottom: 6 }}>Composição própria — insumos</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição da composição própria"
          style={{ ...inputEstiloPeq, flex: 2, minWidth: 200 }} />
        <input value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="Unidade" style={{ ...inputEstiloPeq, maxWidth: 90 }} />
      </div>
      {insumos.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
          <input value={row.codigo} onChange={(e) => atualizar(i, "codigo", e.target.value)} placeholder="Código" style={{ ...inputEstiloPeq, width: 80 }} />
          <input value={row.descricao} onChange={(e) => atualizar(i, "descricao", e.target.value)} placeholder="Descrição do insumo" style={{ ...inputEstiloPeq, flex: 1, minWidth: 140 }} />
          <input value={row.unidade} onChange={(e) => atualizar(i, "unidade", e.target.value)} placeholder="Und" style={{ ...inputEstiloPeq, width: 55 }} />
          <input value={row.coeficiente} onChange={(e) => atualizar(i, "coeficiente", e.target.value)} placeholder="Coef." style={{ ...inputEstiloPeq, width: 60 }} />
          <input value={row.preco} onChange={(e) => atualizar(i, "preco", e.target.value)} placeholder="Preço" style={{ ...inputEstiloPeq, width: 80 }} />
          <button onClick={() => remover(i)} title="Remover insumo" style={{ border: "none", background: "none", color: C.vermelho, cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
      ))}
      <button onClick={adicionar} style={{ ...botaoAcaoEstilo, marginTop: 4 }}>+ Adicionar insumo</button>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ color: "#555" }}>Custo direto calculado: <b>R$ {fmt(total)}</b></span>
        <Botao onClick={() => onSalvar({ descricao, unidade, insumos })} disabled={salvando || !valido} style={{ fontSize: 11, padding: "5px 12px" }}>
          Salvar composição
        </Botao>
      </div>
    </div>
  );
}

// Busca assistida de código: o fiscal digita um trecho da descrição (ou do
// código) e escolhe entre os candidatos das bases ativas, em vez de ter
// que já saber de cor o código certo — consulta GET /api/bases/buscar.
function BuscaCodigo({ onEscolher }) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (termo.trim().length < 3) { setResultados([]); setAviso(""); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/bases/buscar?q=${encodeURIComponent(termo.trim())}`);
        const d = await r.json();
        setResultados(d.resultados || []);
        setAviso(d.resultados?.length === 0 ? "Nenhum resultado nas bases ativas." : "");
      } catch { setAviso("Falha na busca."); }
      finally { setBuscando(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [termo]);

  return (
    <div>
      <input value={termo} onChange={(e) => setTermo(e.target.value)}
        placeholder="Digite parte da descrição ou do código (mín. 3 letras)"
        style={{ ...inputEstiloPeq, width: "100%", marginBottom: 6 }} />
      {buscando && <div style={{ color: "#888" }}>Buscando...</div>}
      {aviso && <div style={{ color: "#888" }}>{aviso}</div>}
      {resultados.length > 0 && (
        <div style={{ border: `1px solid ${C.borda}`, borderRadius: 6, maxHeight: 220, overflowY: "auto" }}>
          {resultados.map((r, i) => (
            <div key={i} onClick={() => onEscolher(r)}
              style={{ padding: "6px 8px", borderTop: i > 0 ? `1px solid ${C.borda}` : "none", cursor: "pointer" }}
              onMouseDown={(e) => e.preventDefault()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontFamily: "monospace", color: "#555" }}>{r.codigo}</span>
                <span style={{ fontWeight: 700 }}>R$ {fmt(r.preco)}</span>
              </div>
              <div style={{ color: "#333" }}>{r.descricao}</div>
              <div style={{ color: "#888", fontSize: 10 }}>{r.unidade} · {r.banco}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Linha da tabela de itens: clicar abre a composição do preço (igual ao
// app original) — reajuste/deságio/BDI aplicados, os insumos da planilha
// analítica, e as ações do fiscal (corrigir quantidade, corrigir código,
// criar composição própria, aceitar com justificativa) — equivalentes ao
// que o ItemCard + ModalCorrecao faziam no app original, só que aqui cada
// ação já grava a correção direto no registro da análise no banco.
function LinhaItem({ it, idx, analiseId, onAtualizar }) {
  const [aberto, setAberto] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(null); // "quantidade" | "codigo" | "composicao" | "aceite" | null
  const [qtdInput, setQtdInput] = useState(it.quantidadeFiscal ?? "");
  const [codigoInput, setCodigoInput] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const efetivo = statusEfetivo(it);
  const temAjuste = (it.reajuste && it.reajuste !== 1) || (it.desagio && it.desagio !== 0);
  const temComposicao = temAjuste || it.ref || it.insumos?.length > 0;
  const temDivergenciaPreco = (it.alertas || []).some((a) => a.includes("PREÇO BASE DIVERGENTE"));
  const resolvido = efetivo === "aceito_ressalva" || efetivo === "correcao_fiscal";

  const enviarCorrecao = async (acao, payload) => {
    setSalvando(true); setErro("");
    try {
      const r = await fetch("/api/analise-automatica/corrigir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analiseId, itemIndex: idx, acao, payload }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);
      onAtualizar(idx, d.item, d.resumo);
      setMostrarForm(null);
      setJustificativa("");
    } catch (e) { setErro(e.message); }
    finally { setSalvando(false); }
  };

  return (
    <Fragment>
      <tr
        onClick={() => setAberto((a) => !a)}
        style={{ borderTop: `1px solid ${C.borda}`, verticalAlign: "top", cursor: "pointer" }}
      >
        <td style={{ padding: "7px 8px 7px 0" }}>
          <span style={{ color: "#bbb", fontSize: 10, marginRight: 4 }}>{aberto ? "▲" : "▼"}</span>
          {it.item}
        </td>
        <td style={{ padding: "7px 8px" }}>{it.codigo || "—"}</td>
        <td style={{ padding: "7px 8px", maxWidth: 260 }}>{it.descricao}</td>
        <td style={{ padding: "7px 8px" }}>{it.quantidadeFiscal != null ? `${it.quantidadeFiscal} *` : it.quantidade}</td>
        <td style={{ padding: "7px 8px" }}>R$ {fmt(it.preco)}</td>
        <td style={{ padding: "7px 8px" }}>{it.ref?.preco != null ? `R$ ${fmt(it.ref.preco)}` : "—"}</td>
        <td style={{ padding: "7px 8px" }}><Selo status={efetivo} /></td>
        <td style={{ padding: "7px 0", color: "#555" }}>
          {(it.alertas || []).length > 0
            ? it.alertas.map((a, j) => <div key={j} style={{ marginBottom: 2 }}>{a}</div>)
            : "—"}
        </td>
      </tr>

      {aberto && (
        <tr>
          <td colSpan={8} style={{ padding: "0 0 12px", borderTop: "none" }}>
            <div style={{ background: C.cinza, border: `1px solid ${C.borda}`, borderRadius: 6, padding: "10px 12px", fontSize: 11 }}>
              {temComposicao && (
                <>
                  <div style={{ fontWeight: 700, color: "#555", marginBottom: 6 }}>Composição do preço cobrado</div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "#555" }}>
                    <span>Base <b>R$ {fmt(it.preco)}</b></span>
                    {it.reajuste !== 1 && <span>× Reaj. {((it.reajuste - 1) * 100).toFixed(2)}%</span>}
                    {it.desagio !== 0 && <span>− Deságio {(it.desagio * 100).toFixed(0)}%</span>}
                    {it.precoComAjuste != null && <span>= <b>R$ {fmt(it.precoComAjuste)}</b></span>}
                    {it.precoComBdi != null && <span>+ BDI = <b style={{ color: C.azul }}>R$ {fmt(it.precoComBdi)}</b></span>}
                    {it.totalItem != null && <span style={{ color: "#888" }}>Total: <b>R$ {fmt(it.totalItem)}</b></span>}
                  </div>
                </>
              )}

              {it.ref && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.borda}` }}>
                  <b>Ref.:</b> {it.ref.descricao} — {it.ref.unidade} — <b>R$ {fmt(it.ref.preco)}</b>
                  {it.excedenteItem > 0.01 && (
                    <span style={{ marginLeft: 8, color: C.vermelho, fontWeight: 700 }}>
                      Excedente a glosar: R$ {fmt(it.excedenteItem)}
                    </span>
                  )}
                </div>
              )}

              {it.insumos?.length > 0 ? (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.borda}` }}>
                  <div style={{ fontWeight: 700, color: "#555", marginBottom: 6 }}>Composição analítica ({it.insumos.length} insumos)</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, minWidth: 480 }}>
                      <thead><tr style={{ textAlign: "left", color: "#888", textTransform: "uppercase" }}>
                        <th style={{ padding: "0 8px 4px 0" }}>Código</th>
                        <th style={{ padding: "0 8px 4px 0" }}>Descrição</th>
                        <th style={{ padding: "0 8px 4px 0" }}>Und</th>
                        <th style={{ padding: "0 8px 4px 0" }}>Coef.</th>
                        <th style={{ padding: "0 0 4px 0", textAlign: "right" }}>Preço</th>
                      </tr></thead>
                      <tbody>
                        {it.insumos.map((ins, k) => (
                          <tr key={k} style={{ borderTop: "1px solid #fff" }}>
                            <td style={{ padding: "3px 8px 3px 0", fontFamily: "monospace", color: "#888" }}>{ins.codigo}</td>
                            <td style={{ padding: "3px 8px" }}>{ins.descricao}</td>
                            <td style={{ padding: "3px 8px" }}>{ins.unidade}</td>
                            <td style={{ padding: "3px 8px" }}>{ins.coeficiente}</td>
                            <td style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace" }}>R$ {fmt(ins.preco)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.borda}`, color: "#888" }}>
                  Sem composição analítica detalhada disponível para este item.
                </div>
              )}

              {/* ── Ações do fiscal: corrigir quantidade/código, criar composição própria, aceitar ── */}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.borda}` }} onClick={(e) => e.stopPropagation()}>
                {it._aceite && (
                  <div style={{ background: "#FEF9C3", border: "1px solid #CA8A0444", borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: "#854D0E", marginBottom: 3 }}>
                      {it._aceite.tipo === "correcao_fiscal" ? "✓ Corrigido pelo fiscal" : "✔ Aceito com ressalva"}
                    </div>
                    <div style={{ color: "#78350F" }}>{it._aceite.justificativa}</div>
                    <div style={{ color: "#92400E", marginTop: 3, fontSize: 10 }}>{it._aceite.fiscal || "fiscal"} em {it._aceite.data}</div>
                    <button onClick={() => enviarCorrecao("aceite", null)} disabled={salvando}
                      style={{ marginTop: 6, background: "none", border: "1px solid #92400E44", color: "#92400E", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>
                      ✕ Desfazer
                    </button>
                  </div>
                )}

                {erro && <p style={{ color: C.vermelho, marginBottom: 6 }}>⚠ {erro}</p>}

                {!resolvido && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => setMostrarForm((f) => (f === "quantidade" ? null : "quantidade"))} style={botaoAcaoEstilo}>✏ Corrigir quantidade</button>
                    <button onClick={() => setMostrarForm((f) => (f === "codigo" ? null : "codigo"))} style={botaoAcaoEstilo}>🔍 Corrigir código</button>
                    <button onClick={() => setMostrarForm((f) => (f === "composicao" ? null : "composicao"))} style={botaoAcaoEstilo}>🔧 Criar composição própria</button>
                    {temDivergenciaPreco && (
                      <button onClick={() => setMostrarForm((f) => (f === "aceite" ? null : "aceite"))} style={{ ...botaoAcaoEstilo, color: "#854D0E", borderColor: "#CA8A0444" }}>
                        ✔ Aceitar com justificativa
                      </button>
                    )}
                  </div>
                )}

                {mostrarForm === "quantidade" && (
                  <div style={formBoxEstilo}>
                    <div style={{ marginBottom: 6 }}>Quantidade informada pela empresa: <b>{it.quantidade} {it.unidade}</b></div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="text" value={qtdInput} onChange={(e) => setQtdInput(e.target.value)}
                        placeholder="Quantidade levantada em campo" style={{ ...inputEstiloPeq, maxWidth: 160 }} />
                      <Botao onClick={() => enviarCorrecao("quantidade", { quantidadeFiscal: qtdInput })} disabled={salvando} style={{ fontSize: 11, padding: "5px 10px" }}>
                        Salvar
                      </Botao>
                      {it.quantidadeFiscal != null && (
                        <button onClick={() => { setQtdInput(""); enviarCorrecao("quantidade", { quantidadeFiscal: null }); }} disabled={salvando} style={linkEstilo}>
                          restaurar valor da empresa
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {mostrarForm === "codigo" && (
                  <div style={formBoxEstilo}>
                    <div style={{ marginBottom: 8 }}>Código atual: <b>{it.codigo || "—"}</b>{!it.ref && " (não localizado na base ativa)"}</div>

                    <div style={{ fontWeight: 700, color: "#555", marginBottom: 4 }}>Busca assistida</div>
                    <BuscaCodigo onEscolher={(r) => setCodigoInput(r.codigo)} />

                    <div style={{ fontWeight: 700, color: "#555", margin: "10px 0 4px" }}>Ou digite o código direto</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input value={codigoInput} onChange={(e) => setCodigoInput(e.target.value)} placeholder="Código (ex: 88316)"
                        style={{ ...inputEstiloPeq, maxWidth: 200 }} />
                      <Botao onClick={() => enviarCorrecao("codigo", { codigo: codigoInput })} disabled={salvando || !codigoInput.trim()} style={{ fontSize: 11, padding: "5px 10px" }}>
                        Aplicar {codigoInput ? `"${codigoInput}"` : ""}
                      </Botao>
                    </div>
                  </div>
                )}

                {mostrarForm === "composicao" && (
                  <FormComposicao
                    inicial={{ descricao: it.descricao, unidade: it.unidade, insumos: it.insumos }}
                    salvando={salvando}
                    onSalvar={(dados) => enviarCorrecao("composicao", dados)}
                  />
                )}

                {mostrarForm === "aceite" && (
                  <div style={formBoxEstilo}>
                    <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
                      placeholder="Justificativa para aceitar o preço divergente"
                      style={{ ...inputEstiloPeq, width: "100%", minHeight: 60 }} />
                    <div style={{ marginTop: 6 }}>
                      <Botao onClick={() => enviarCorrecao("aceite", { justificativa })} disabled={salvando || !justificativa.trim()} style={{ fontSize: 11, padding: "5px 12px" }}>
                        Confirmar aceite
                      </Botao>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Cartao({ titulo, subtitulo, children }) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${C.borda}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: C.azul, margin: "0 0 2px" }}>{titulo}</h2>
      {subtitulo && <p style={{ fontSize: 12, color: "#666", margin: "0 0 14px" }}>{subtitulo}</p>}
      {children}
    </section>
  );
}
function Botao({ children, onClick, disabled, cor = C.azul }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: cor, color: "#fff", border: "none", borderRadius: 6, padding: "9px 16px",
        fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}
const inputEstilo = { border: `1px solid ${C.borda}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" };

export default function Home() {
  // ── Bases ──
  const [bases, setBases] = useState([]);
  const [carregandoBases, setCarregandoBases] = useState(false);
  const carregarBases = useCallback(async () => {
    setCarregandoBases(true);
    try {
      const r = await fetch("/api/bases");
      const d = await r.json();
      setBases(d.bases || []);
    } finally { setCarregandoBases(false); }
  }, []);
  useEffect(() => { carregarBases(); }, [carregarBases]);

  const [nomeBase, setNomeBase] = useState("");
  const [competenciaBase, setCompetenciaBase] = useState("");
  const [importando, setImportando] = useState("");
  const importarBase = async (e) => {
    const file = e.target.files?.[0]; if (!file || !nomeBase) return;
    setImportando("Lendo arquivo...");
    const buffer = await file.arrayBuffer();
    const itens = parseBase(buffer, nomeBase);
    if (!itens.length) { setImportando("Nenhum item reconhecido nesse arquivo."); return; }

    const id = `${nomeBase}-${competenciaBase || "s-comp"}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    setImportando(`Enviando metadados...`);
    await fetch("/api/bases", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "base", meta: { id, nome: nomeBase, competencia: competenciaBase, arquivo: file.name, dataImport: new Date().toLocaleDateString("pt-BR"), ativa: true } }) });

    let ordem = 0;
    for (let i = 0; i < itens.length; i += CHUNK_ITENS) {
      setImportando(`Enviando itens ${i}/${itens.length}...`);
      await fetch("/api/bases", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "chunk", baseId: id, ordem, itens: itens.slice(i, i + CHUNK_ITENS) }) });
      ordem++;
    }
    setImportando(`Concluído: ${itens.length} itens importados.`);
    e.target.value = "";
    carregarBases();
  };
  const alternarBase = async (id, ativa) => {
    await fetch("/api/bases", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "toggle", id, ativa }) });
    carregarBases();
  };
  const excluirBase = async (id) => {
    await fetch(`/api/bases?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    carregarBases();
  };

  // ── Teste de análise automática ──
  const [osIdTeste, setOsIdTeste] = useState("");
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erroTeste, setErroTeste] = useState("");
  const testarAnalise = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setRodando(true); setErroTeste(""); setResultado(null);
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""));
      const r = await fetch("/api/analise-automatica", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ osId: osIdTeste || null, arquivoNome: file.name, pdfBase64: b64 }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);
      setResultado(d);
      carregarAnalises();
    } catch (err) { setErroTeste(err.message); }
    finally { setRodando(false); e.target.value = ""; }
  };

  // Aplica, no estado local, a correção que a rota /corrigir já gravou no
  // banco — evita ter que recarregar a análise inteira a cada clique.
  const aplicarCorrecao = useCallback((idx, novoItem, novoResumo) => {
    setResultado((r) => {
      if (!r) return r;
      const itens = [...r.itens];
      itens[idx] = novoItem;
      return { ...r, itens, resumo: novoResumo };
    });
  }, []);

  // ── Análises recentes ──
  const [analises, setAnalises] = useState([]);
  const carregarAnalises = useCallback(async () => {
    const r = await fetch("/api/analises");
    const d = await r.json();
    setAnalises(d.analises || []);
  }, []);
  useEffect(() => { carregarAnalises(); }, [carregarAnalises]);

  // Exclusão manual, para não deixar a tabela de análises crescer sem
  // limite — não há limpeza automática por idade/quantidade.
  const excluirAnalise = async (id) => {
    if (!window.confirm("Excluir esta análise? Essa ação não pode ser desfeita.")) return;
    await fetch(`/api/analises?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    carregarAnalises();
  };

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: C.azul, marginBottom: 2 }}>🤖 Análise Automática SINAPI — MPMA</h1>
      <p style={{ fontSize: 13, color: "#555", marginBottom: 20 }}>
        Confere orçamentos em PDF do Tá na Mão contra as bases SINAPI/ORSE. Importe as bases e envie um PDF para analisar.
      </p>

      <Cartao titulo="📚 Bases de referência" subtitulo="Importe o SINAPI/ORSE (.xlsx) usado na comparação.">
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input placeholder="Nome (ex: SINAPI)" value={nomeBase} onChange={(e) => setNomeBase(e.target.value)} style={{ ...inputEstilo, maxWidth: 220 }} />
          <input placeholder="Competência (ex: 04/2026)" value={competenciaBase} onChange={(e) => setCompetenciaBase(e.target.value)} style={{ ...inputEstilo, maxWidth: 180 }} />
          <label style={{ ...inputEstilo, maxWidth: 220, background: C.cinza, cursor: "pointer", textAlign: "center" }}>
            Selecionar .xlsx
            <input type="file" accept=".xlsx" onChange={importarBase} style={{ display: "none" }} disabled={!nomeBase} />
          </label>
        </div>
        {importando && <p style={{ fontSize: 12, color: C.azul }}>{importando}</p>}

        {carregandoBases ? <p style={{ fontSize: 12, color: "#888" }}>Carregando...</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: "left", color: "#666" }}>
              <th>Nome</th><th>Competência</th><th>Itens</th><th>Ativa</th><th></th>
            </tr></thead>
            <tbody>
              {bases.map((b) => (
                <tr key={b.id} style={{ borderTop: `1px solid ${C.borda}` }}>
                  <td style={{ padding: "6px 0" }}>{b.nome}</td>
                  <td>{b.competencia || "—"}</td>
                  <td>{b.totalitens ?? b.totalItens ?? 0}</td>
                  <td>
                    <button onClick={() => alternarBase(b.id, !b.ativa)}
                      style={{ border: "none", background: "none", cursor: "pointer", color: b.ativa ? C.verde : "#999", fontWeight: 700 }}>
                      {b.ativa ? "● Ativa" : "○ Inativa"}
                    </button>
                  </td>
                  <td><button onClick={() => excluirBase(b.id)} style={{ border: "none", background: "none", color: C.vermelho, cursor: "pointer" }}>Excluir</button></td>
                </tr>
              ))}
              {bases.length === 0 && <tr><td colSpan={5} style={{ padding: "10px 0", color: "#888" }}>Nenhuma base importada ainda.</td></tr>}
            </tbody>
          </table>
        )}
      </Cartao>

      <Cartao titulo="📄 Análise de Orçamento (PDF)" subtitulo="Envie o PDF do orçamento para comparar com as bases.">
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input placeholder="OS (opcional)" value={osIdTeste} onChange={(e) => setOsIdTeste(e.target.value)} style={{ ...inputEstilo, maxWidth: 220 }} />
          <label style={{ ...inputEstilo, maxWidth: 220, background: C.cinza, cursor: "pointer", textAlign: "center" }}>
            {rodando ? "Analisando..." : "Selecionar PDF"}
            <input type="file" accept=".pdf" onChange={testarAnalise} style={{ display: "none" }} disabled={rodando} />
          </label>
        </div>
        {erroTeste && <p style={{ fontSize: 12.5, color: C.vermelho, background: C.vermelhoBg, padding: 8, borderRadius: 6 }}>⚠ {erroTeste}</p>}
        {resultado && (
          <>
            <div style={{ background: C.azulBg, borderRadius: 8, padding: 12, fontSize: 13, marginBottom: 14 }}>
              <p style={{ margin: "0 0 6px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <span><b>Análise nº {resultado.analiseId}</b> · BDI {(resultado.bdi * 100).toFixed(1)}% · Reajuste {resultado.reajuste} · Deságio {(resultado.desagio * 100).toFixed(1)}%</span>
                <button onClick={() => window.open(`/imprimir/${resultado.analiseId}`, "_blank")} style={{ ...botaoAcaoEstilo, background: C.azul, color: "#fff", borderColor: C.azul }}>
                  🖨 Imprimir parecer
                </button>
              </p>
              <p style={{ margin: "0 0 6px" }}>
                Conformes: {resultado.resumo.conformes}/{resultado.resumo.totalItens} · Atenção: {resultado.resumo.atencao} · Não conf.: {resultado.resumo.naoConformes}
                {resultado.resumo.resolvidos > 0 && <> · Resolvidos pelo fiscal: {resultado.resumo.resolvidos}</>}
              </p>
              <p style={{ margin: 0 }}>
                Valor total medido: R$ {resultado.resumo.valorTotalMedido.toFixed(2)}
                {resultado.resumo.valorExcedente > 0 && (
                  <> · Excedente a glosar: <b style={{ color: C.vermelho }}>R$ {resultado.resumo.valorExcedente.toFixed(2)}</b></>
                )}
                {resultado.resumo.valorJustificado > 0 && (
                  <> · Justificado/corrigido: R$ {resultado.resumo.valorJustificado.toFixed(2)}</>
                )}
              </p>
              {resultado.avisoBases && <p style={{ margin: "6px 0 0", color: C.amarelo }}>⚠ {resultado.avisoBases}</p>}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
                <thead><tr style={{ textAlign: "left", color: "#666" }}>
                  <th style={{ padding: "0 8px 6px 0" }}>Item</th>
                  <th style={{ padding: "0 8px 6px 0" }}>Código</th>
                  <th style={{ padding: "0 8px 6px 0" }}>Descrição</th>
                  <th style={{ padding: "0 8px 6px 0" }}>Qtd.</th>
                  <th style={{ padding: "0 8px 6px 0" }}>Preço enviado</th>
                  <th style={{ padding: "0 8px 6px 0" }}>Referência</th>
                  <th style={{ padding: "0 8px 6px 0" }}>Status</th>
                  <th style={{ padding: "0 0 6px 0" }}>Alertas</th>
                </tr></thead>
                <tbody>
                  {(resultado.itens || []).map((it, i) => (
                    <LinhaItem key={i} it={it} idx={i} analiseId={resultado.analiseId} onAtualizar={aplicarCorrecao} />
                  ))}
                  {(resultado.itens || []).length === 0 && (
                    <tr><td colSpan={8} style={{ padding: "10px 0", color: "#888" }}>Nenhum item retornado pela análise.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: "#888", marginTop: 8 }}>Clique num item para ver a composição do preço e corrigir quantidade, código ou criar uma composição própria.</p>
          </>
        )}
      </Cartao>

      <Cartao titulo="📋 Análises recentes">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr style={{ textAlign: "left", color: "#666" }}>
            <th>#</th><th>OS</th><th>Arquivo</th><th>Resumo</th><th>Quando</th><th></th><th></th>
          </tr></thead>
          <tbody>
            {analises.map((a) => (
              <tr key={a.id} style={{ borderTop: `1px solid ${C.borda}` }}>
                <td style={{ padding: "6px 0" }}>{a.id}</td>
                <td>{a.os_id || "—"}</td>
                <td>{a.arquivo_nome || "—"}</td>
                <td>{a.resumo.conformes}/{a.resumo.totalItens} conf. · R$ {a.resumo.valorTotalMedido.toFixed(2)}</td>
                <td>{new Date(a.criado_em).toLocaleString("pt-BR")}</td>
                <td>
                  <button onClick={() => window.open(`/imprimir/${a.id}`, "_blank")} style={{ border: "none", background: "none", color: C.azul, cursor: "pointer", fontWeight: 700 }}>
                    🖨 Imprimir
                  </button>
                </td>
                <td>
                  <button onClick={() => excluirAnalise(a.id)} style={{ border: "none", background: "none", color: C.vermelho, cursor: "pointer" }}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {analises.length === 0 && <tr><td colSpan={7} style={{ padding: "10px 0", color: "#888" }}>Nenhuma análise registrada ainda.</td></tr>}
          </tbody>
        </table>
      </Cartao>
    </main>
  );
}
