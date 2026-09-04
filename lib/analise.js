// ═══════════════════════════════════════════════════════════════════════════
//  MOTOR DE ANÁLISE — extraído de app/AppCliente.jsx
//
//  Este arquivo é uma CÓPIA das funções puras de leitura e comparação que já
//  rodam no navegador (parseMedicao, parseAnalitico, analisarItem etc.).
//  Foi deliberadamente DUPLICADO em vez de importado de volta pelo
//  AppCliente.jsx, para não arriscar nada no fluxo que a equipe já usa em
//  produção. Qualquer ajuste feito aqui (ex.: nova regra de conformidade)
//  precisa ser replicado manualmente em AppCliente.jsx até que os dois
//  sejam unificados — deixamos essa unificação como um passo futuro,
//  depois que o pipeline automático estiver validado em produção.
//
//  Usado por: app/api/analise-automatica/route.js (análise automática
//  disparada a partir do PDF enviado pela empresa contratada).
// ═══════════════════════════════════════════════════════════════════════════
import * as XLSX from "xlsx";

export const BDI_PADRAO = 0.2247;
const UF_IDX_INSUMO = 14, UF_IDX_COMP = 22;

// ── Helpers ──────────────────────────────────────────────────────────────
export const norm = (s = "") => s.toString().trim().toUpperCase().replace(/\s+/g, " ");
export const normSA = (s = "") => norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const normUnidade = (s = "") => norm(s)
  .replace(/²/g, "2").replace(/³/g, "3")
  .replace(/[.\-_]/g, "");
export const fmt = (v = 0) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPct = (v) => (v * 100).toFixed(1) + "%";
export const parseFlt = (s) => {
  if (typeof s === "number") return s;
  if (s == null) return 0;
  return parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0;
};

// Similaridade Jaccard de trigramas (detecta código ≠ descrição)
export function similaridade(a, b) {
  const tri = s => { const t = new Set(); const x = norm(s); for (let i = 0; i < x.length - 2; i++) t.add(x.slice(i, i + 3)); return t; };
  const ta = tri(a), tb = tri(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0; ta.forEach(x => { if (tb.has(x)) inter++; });
  return inter / (ta.size + tb.size - inter);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PARSERS DE BASE DE REFERÊNCIA (idênticos aos de AppCliente.jsx)
// ═══════════════════════════════════════════════════════════════════════════
export function parseSINAPI(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const nomes = wb.SheetNames, itens = [], vistos = new Set();
  const extrairCod = v => {
    if (typeof v === "number") return String(v);
    const s = String(v ?? "").trim();
    const m = s.match(/,(\d+)\)\s*$/);
    return m ? m[1] : s;
  };
  const temOficial = nomes.includes("ISD") || nomes.includes("ICD") || nomes.includes("CSD") || nomes.includes("CCD");
  if (temOficial) {
    const abaI = nomes.includes("ISD") ? "ISD" : nomes.includes("ICD") ? "ICD" : null;
    if (abaI && wb.Sheets[abaI]) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[abaI], { defval: null, raw: true, header: 1 });
      for (let r = 10; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[1] || !row[2]) continue;
        const cod = String(row[1]).trim(), desc = String(row[2]).trim(), un = String(row[3] ?? "").trim();
        const preco = typeof row[UF_IDX_INSUMO] === "number" ? row[UF_IDX_INSUMO] : null;
        if (!preco || preco <= 0) continue;
        const k = `I-${cod}`; if (vistos.has(k)) continue; vistos.add(k);
        itens.push({ codigo: cod, descricao: desc, unidade: un, preco, tipo: "insumo" });
      }
    }
    const abaC = nomes.includes("CSD") ? "CSD" : nomes.includes("CCD") ? "CCD" : null;
    if (abaC && wb.Sheets[abaC]) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[abaC], { defval: null, raw: true, header: 1 });
      for (let r = 11; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[1] || !row[2]) continue;
        const cod = extrairCod(row[1]), desc = String(row[2]).trim(), un = String(row[3] ?? "").trim();
        const preco = typeof row[UF_IDX_COMP] === "number" ? row[UF_IDX_COMP] : null;
        if (!preco || preco <= 0) continue;
        const k = `C-${cod}`; if (vistos.has(k)) continue; vistos.add(k);
        itens.push({ codigo: cod, descricao: desc, unidade: un, preco, tipo: "composicao" });
      }
    }
    if (itens.length) return itens;
  }
  return parseGenerico(buffer);
}

export function parseGenerico(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const itens = [], vistos = new Set();
  for (const sn of wb.SheetNames) {
    if (normSA(sn) === "VINCULOS") continue;
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true, header: 1 });
    if (rows.length < 2) continue;
    let hi = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const s = rows[i].map(c => normSA(String(c ?? ""))).join("|");
      if (s.includes("CODIGO") || s.includes("DESCRI")) { hi = i; break; }
    }
    if (hi === -1) continue;
    const hd = rows[hi].map(c => normSA(String(c ?? "")));
    const ci = ns => { for (const n of ns) { const i = hd.findIndex(h => h.includes(n)); if (i >= 0) return i; } return -1; };
    const iC = ci(["CODIGO", "CÓDIGO", "COD"]), iD = ci(["DESCRICAO", "DESCRIÇÃO", "DESCRI"]), iU = ci(["UNIDADE", "UNID", "UN"]), iP = ci(["CUSTO", "PRECO", "PREÇO", "VALOR"]);
    if (iD === -1) continue;
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      const cod = String(row[iC] ?? "").trim(), desc = String(row[iD] ?? "").trim(), un = String(row[iU] ?? "").trim();
      const raw = row[iP] ?? ""; const preco = typeof raw === "number" ? raw : parseFlt(raw);
      if (!desc) continue; if (!preco || preco <= 0) continue;
      const k = cod || desc.substring(0, 30); if (vistos.has(k)) continue; vistos.add(k);
      const codU = cod.toUpperCase();
      const tipo = codU.startsWith("I") ? "insumo" : codU.startsWith("C") ? "composicao" : (cod && cod.length < 8 ? "composicao" : "insumo");
      itens.push({ codigo: cod, descricao: desc, unidade: un, preco, tipo });
    }
  }
  return itens;
}

export function parseVinculos(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const abaV = wb.SheetNames.find(sn => normSA(sn) === "VINCULOS");
  if (!abaV) return {};
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[abaV], { defval: "", raw: true, header: 1 });
  if (rows.length < 2) return {};
  const hd = rows[0].map(c => normSA(String(c ?? "")));
  const ci = ns => { for (const n of ns) { const i = hd.findIndex(h => h.includes(n)); if (i >= 0) return i; } return -1; };
  const iComp = ci(["COMPOSICAO"]), iCod = ci(["INSUMO_CODIGO", "INSUMOCODIGO"]), iDesc = ci(["INSUMO_DESCRICAO", "INSUMODESCRICAO"]),
    iUn = ci(["INSUMO_UNIDADE", "INSUMOUNIDADE"]), iCl = ci(["CLASSE"]), iCo = ci(["COEFICIENTE"]), iPr = ci(["PRECO", "PREÇO"]);
  if (iComp === -1 || iCod === -1) return {};
  const map = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const compCod = String(row[iComp] ?? "").trim(); if (!compCod) continue;
    const insumo = {
      codigo: String(row[iCod] ?? "").trim(),
      descricao: String(row[iDesc] ?? "").trim(),
      unidade: String(row[iUn] ?? "").trim(),
      classe: String(row[iCl] ?? "MAT").trim(),
      coeficiente: typeof row[iCo] === "number" ? row[iCo] : parseFlt(row[iCo]),
      preco: typeof row[iPr] === "number" ? row[iPr] : parseFlt(row[iPr]),
    };
    if (!map[compCod]) map[compCod] = [];
    map[compCod].push(insumo);
  }
  return map;
}

export function parseBase(buffer, nomeTabela) {
  const itens = norm(nomeTabela).includes("SINAPI") ? parseSINAPI(buffer) : parseGenerico(buffer);
  const vinculos = parseVinculos(buffer);
  if (Object.keys(vinculos).length) {
    return itens.map(it => vinculos[it.codigo] ? { ...it, insumos: vinculos[it.codigo] } : it);
  }
  return itens;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PARSER DE MEDIÇÃO (formato SAGA/MP-MA + genérico) — idêntico ao original
// ═══════════════════════════════════════════════════════════════════════════
export function parseMedicao(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const nomes = wb.SheetNames;

  const analitico = parseAnalitico(wb);

  const abaSin = nomes.find(n => n.toLowerCase().includes("sint")) || nomes[0];
  const ws = wb.Sheets[abaSin];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, header: 1 });

  let hi = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const s = rows[i].map(c => normSA(String(c ?? ""))).join("|");
    if (s.includes("BANCO") && s.includes("DESCRI") && s.includes("COD")) { hi = i; break; }
  }

  if (hi !== -1) {
    const hd = rows[hi].map(c => normSA(String(c ?? "")));
    const iIt = hd.findIndex(h => h.includes("ITEM"));
    const iCo = hd.findIndex(h => h.includes("COD"));
    const iBa = hd.findIndex(h => h.includes("BANCO"));
    const iDe = hd.findIndex(h => h.includes("DESC"));
    const iUn = hd.findIndex(h => h === "UND" || h === "UN" || h.startsWith("UNID"));
    const iQt = hd.findIndex(h => h.includes("QUANT"));
    const iVu = hd.findIndex(h => h.includes("VALOR UNIT"));

    let bdi = null, reajuste = 1, desagio = 0;

    const linhaRotulos = rows[0] || [];
    let colBdi = -1, colReaj = -1, colDes = -1;
    linhaRotulos.forEach((v, idx) => {
      const s = normSA(String(v ?? "")).replace(/[.\-_/]/g, "");
      if (colBdi === -1 && (s.includes("BDI") || s.includes("B D I"))) colBdi = idx;
      if (colReaj === -1 && s.includes("REAJUST")) colReaj = idx;
      if (colDes === -1 && (s.includes("DESAGIO") || s.includes("DESAGIL") || s.includes("DESCONTO"))) colDes = idx;
    });

    const lerPercentual = (v) => {
      if (v == null || v === "") return null;
      if (typeof v === "number") return v > 1 ? v / 100 : v;
      const n = parseFlt(String(v).replace("%", ""));
      if (!n) return null;
      return n > 1 ? n / 100 : n;
    };

    if (colBdi >= 0) {
      for (const r of rows.slice(1, 4)) { const p = lerPercentual(r?.[colBdi]); if (p != null && p > 0 && p < 1) { bdi = p; break; } }
    }
    if (bdi === null) {
      for (const r of rows.slice(0, 3)) {
        if (!r) continue;
        for (let idx = 0; idx < r.length; idx++) {
          const s = normSA(String(r[idx] ?? "")).replace(/[.\-_/:]/g, "");
          if (s === "BDI" || s === "BDIPCT") {
            const p = lerPercentual(r[idx + 1]);
            if (p != null && p >= 0 && p < 1) { bdi = p; break; }
          }
        }
        if (bdi !== null) break;
      }
    }
    if (colReaj >= 0) {
      for (const r of rows.slice(1, 4)) { const v = r?.[colReaj]; if (typeof v === "number" && v > 0) { reajuste = v; break; } }
    }
    if (colDes >= 0) {
      for (const r of rows.slice(1, 4)) { const v = r?.[colDes]; if (typeof v === "number" && v >= 0 && v < 1) { desagio = v; break; } }
    }

    if (bdi === null) {
      for (const r of rows.slice(0, 3)) {
        if (!r) continue;
        r.forEach((v) => {
          if (typeof v === "string" && v.includes("%")) {
            const n = parseFlt(v.replace("%", ""));
            if (n > 5 && n < 60 && bdi === null) bdi = n / 100;
          }
        });
      }
    }
    if (reajuste === 1 && typeof rows[1]?.[7] === "number") reajuste = rows[1][7];
    if (desagio === 0 && typeof rows[1]?.[8] === "number") desagio = rows[1][8];

    const itens = [];
    let grupoAtual = "";
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r]; if (!row || row.every(c => c === null)) continue;
      const itemStr = String(row[iIt] ?? "").trim();
      if (!itemStr) continue;
      if (/^\s*\d+\s*$/.test(itemStr)) { grupoAtual = String(row[iDe] ?? "").trim(); continue; }
      if (!/\d+\.\d+/.test(itemStr)) continue;

      const codigo = String(row[iCo] ?? "").trim();
      const banco = String(row[iBa] ?? "").trim();
      const descricao = String(row[iDe] ?? "").trim();
      const unidade = String(row[iUn] ?? "").trim();
      const qtd = typeof row[iQt] === "number" ? row[iQt] : parseFlt(row[iQt]);
      const precoBase = typeof row[iVu] === "number" ? row[iVu] : parseFlt(row[iVu]);
      if (!descricao && !codigo) continue;

      const bancoU = banco.toUpperCase();
      itens.push({
        item: itemStr, codigo, banco, descricao, unidade,
        quantidade: qtd || 0, preco: precoBase, bdi, reajuste, desagio,
        os: grupoAtual,
        sinApiModificada: bancoU.includes("MODIF"),
        proprio: bancoU === "PRÓPRIO" || bancoU === "PROPRIO",
        insumos: analitico[itemStr] || analitico[codigo] || [],
      });
    }
    if (itens.length > 0) return { itens, bdi, reajuste, desagio, fonte: abaSin };
  }

  const wsG = wb.Sheets[nomes[0]];
  const rowsG = XLSX.utils.sheet_to_json(wsG, { defval: "", raw: true });
  const itensG = rowsG.map(r => {
    const keys = Object.keys(r).map(k => k.toUpperCase());
    const get = (...ns) => { for (const n of ns) { const k = keys.find(k => k.includes(n)); if (k) return r[Object.keys(r)[keys.indexOf(k)]]; } return ""; };
    return {
      codigo: String(get("COD", "CÓDIGO", "ITEM")).trim(),
      banco: String(get("BANCO", "TABELA")).trim() || "—",
      descricao: String(get("DESC", "SERVIÇO", "SERVI")).trim(),
      unidade: String(get("UN", "UND", "UNID")).trim(),
      quantidade: parseFlt(get("QUANT", "QTD", "QTE")),
      preco: parseFlt(get("UNIT", "PRECO", "PREÇO", "VALOR UN")),
      bdi: parseFlt(String(get("BDI")).replace("%", "")) / 100 || null,
      reajuste: 1, desagio: 0, os: "", insumos: [],
      sinApiModificada: false, proprio: false,
    };
  }).filter(r => r.descricao || r.codigo);
  return { itens: itensG, bdi: null, reajuste: 1, desagio: 0, fonte: nomes[0] };
}

export function parseAnalitico(wb) {
  const abaAna = wb.SheetNames.find(n => n.toLowerCase().includes("anal"));
  if (!abaAna) return {};
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[abaAna], { defval: null, raw: true, header: 1 });
  const map = {};
  let itemAtual = null;
  let codItemAtual = null;
  let primeiraComp = true;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const col0 = String(row[0] ?? "").trim();

    if (/^\s*\d+\.\d+\s*$/.test(col0)) {
      itemAtual = col0.trim();
      codItemAtual = null;
      primeiraComp = true;
      if (!map[itemAtual]) map[itemAtual] = [];
      continue;
    }

    if (itemAtual && String(row[1] ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "").startsWith("COD")) {
      primeiraComp = true;
      continue;
    }

    if (!itemAtual) continue;
    const tipo = col0;
    if (!["Composição", "Composição Auxiliar", "Insumo"].includes(tipo)) continue;

    const cod = String(row[1] ?? "").trim();
    const banco = String(row[2] ?? "").trim();
    const desc = String(row[3] ?? "").trim();
    const cls = String(row[4] ?? "").trim();
    const und = String(row[6] ?? "").trim();
    const qtd = typeof row[7] === "number" ? row[7] : parseFlt(row[7]);
    const vUnit = typeof row[8] === "number" ? row[8] : parseFlt(row[8]);

    if (tipo === "Composição" && primeiraComp) {
      codItemAtual = cod;
      primeiraComp = false;
      continue;
    }
    primeiraComp = false;

    if (!(cod || desc)) continue;
    map[itemAtual].push({
      tipoLinha: tipo, codigo: cod, banco, descricao: desc,
      classe: cls, unidade: und, coeficiente: qtd || 0, preco: vUnit || 0,
    });
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BUSCA NAS BASES
// ═══════════════════════════════════════════════════════════════════════════
export function buscarPorCodigo(codigo, ...bases) {
  const cN = norm(codigo);
  if (!cN) return null;
  for (const base of bases) { const r = base?.find(s => norm(s.codigo) === cN); if (r) return r; }
  return null;
}

export function montarIndiceBases(baseSinapi, baseOrse, composicoes) {
  const entradas = [];
  for (const base of [baseSinapi || [], baseOrse || [], composicoes || []]) {
    for (const s of base) entradas.push({ s, cod: norm(s.codigo), desc: norm(s.descricao) });
  }
  const porCodigo = new Map();
  for (let i = entradas.length - 1; i >= 0; i--) {
    if (entradas[i].cod) porCodigo.set(entradas[i].cod, entradas[i].s);
  }
  return { entradas, porCodigo, temSinapi: (baseSinapi || []).length > 0, temOrse: (baseOrse || []).length > 0 };
}

export function refPorCodigoIndice(codigo, idx) {
  const cN = norm(codigo);
  return cN ? (idx.porCodigo.get(cN) || null) : null;
}

export function refPorDescricaoIndice(codigo, descricao, idx) {
  const cN = norm(codigo), dN = norm(descricao);
  if (cN) { const r = idx.porCodigo.get(cN); if (r) return r; }
  if (dN.length > 8) {
    const prefixo = dN.substring(0, 24);
    for (const e of idx.entradas) { if (e.desc.includes(prefixo)) return e.s; }
    const palavras = dN.split(/\s+/).filter(p => p.length > 3).slice(0, 4);
    if (palavras.length >= 2) {
      for (const e of idx.entradas) { if (palavras.every(p => e.desc.includes(p))) return e.s; }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANÁLISE DE ITEM (idêntica à de AppCliente.jsx)
// ═══════════════════════════════════════════════════════════════════════════
export function analisarItem(item, indiceBases, historico = []) {
  const alertas = [], alertasMem = [], infos = [];
  let status = "conforme";
  let ref = null, origemRef = null;

  if (item.os) infos.push(`O.S.: ${item.os}`);

  const precoComAjuste = item.preco * (item.reajuste || 1) * (1 - (item.desagio || 0));
  const precoComBdi = precoComAjuste * (1 + (item.bdi || BDI_PADRAO));
  const totalItem = precoComBdi * (item.quantidade || 0);

  let excedenteQuantidade = 0;
  if (item.quantidadeFiscal != null) {
    const diffQtd = (item.quantidade || 0) - item.quantidadeFiscal;
    if (Math.abs(diffQtd) > 0.001) {
      if (diffQtd > 0) {
        excedenteQuantidade = diffQtd * precoComBdi;
        alertas.push(
          `QUANTIDADE DIVERGENTE: empresa informou ${item.quantidade} ${item.unidade || ""}, fiscal levantou em campo ${item.quantidadeFiscal} ${item.unidade || ""} ` +
          `— excedente de ${diffQtd.toFixed(2)} ${item.unidade || ""} (R$ ${fmt(excedenteQuantidade)} a glosar).`
        );
        status = "nao_conforme";
      } else {
        alertas.push(
          `Quantidade levantada em campo (${item.quantidadeFiscal} ${item.unidade || ""}) é maior que a informada pela empresa ` +
          `(${item.quantidade} ${item.unidade || ""}) — conferir se não há erro de lançamento.`
        );
        status = "atenção";
      }
    }
  }

  if (item.proprio) {
    alertas.push(`Item declarado como "Próprio" — sem código de tabela pública. Exige composição analítica com insumos justificados${item.insumos?.length ? ` (${item.insumos.length} insumos no analítico).` : "."}`);
    if (!item.quantidade || item.quantidade <= 0) alertas.push("Quantidade zerada ou ausente.");
    return {
      ...item, ref: null, origemRef: null, alertas, alertasMem, infos,
      status: status === "nao_conforme" ? status : "atenção",
      ocorrencias: [], tendencia: null, precoComAjuste, precoComBdi, totalItem,
      excedenteItem: excedenteQuantidade, excedentePreco: 0, excedenteQuantidade
    };
  }

  const refPorCod = item.codigo ? refPorCodigoIndice(item.codigo, indiceBases) : null;
  const refPorDesc = refPorCod ? null : refPorDescricaoIndice(item.codigo, item.descricao, indiceBases);
  ref = refPorCod || refPorDesc;
  if (ref) origemRef = ref.tabela || "SINAPI";

  const fatorReaj = item.reajuste || 1;
  const fatorDes = 1 - (item.desagio || 0);
  const fatorBdi = 1 + (item.bdi || BDI_PADRAO);

  const insumosFinal = item.insumos?.length ? item.insumos : (ref?.insumos || []);

  if (refPorCod && item.descricao) {
    const sim = similaridade(item.descricao, refPorCod.descricao);
    if (sim < 0.18) {
      alertas.push(`CÓDIGO ${item.codigo} NA TABELA CORRESPONDE A "${refPorCod.descricao}" — descrição enviada diverge fortemente. Verificar se o código está correto.`);
      status = "nao_conforme";
    } else if (sim < 0.30) {
      alertas.push(`Descrição do item difere parcialmente da tabela: "${refPorCod.descricao}". Conferir se o código corresponde ao serviço executado.`);
      if (status === "conforme") status = "atenção";
    }
  }

  if (item.sinApiModificada) {
    infos.push(`Declarado "SINAPI Modificada" — composição adaptada${item.insumos?.length ? ` com ${item.insumos.length} insumos no analítico` : ""}. Verificar coeficientes e insumos.`);
    if (status === "conforme") status = "atenção";
  }

  if (!ref) {
    alertas.push(!indiceBases.temSinapi && !indiceBases.temOrse
      ? "Nenhuma base de referência ativa (SINAPI ou ORSE)."
      : `Código "${item.codigo || "—"}" não localizado no SINAPI${indiceBases.temOrse ? " nem no ORSE" : ""}. Item deve ser justificado ou composição própria criada.`);
    if (status === "conforme") status = "atenção";
  } else {
    const diff = item.preco - ref.preco;
    if (Math.abs(diff) > 0.01) {
      const pct = (diff / ref.preco) * 100;
      const excedenteUnit = diff * fatorReaj * fatorDes * fatorBdi;
      const excedenteTotal = excedenteUnit * (item.quantidade || 0);
      alertas.push(
        `PREÇO BASE DIVERGENTE: enviado R$ ${fmt(item.preco)} vs. ${origemRef} R$ ${fmt(ref.preco)} ` +
        `(${pct > 0 ? "+" : ""}${pct.toFixed(2)}%). Preço é fixo pela data-base do contrato.` +
        (pct > 0 ? ` Excedente com fatores contratuais: R$ ${fmt(excedenteTotal)}.` : "")
      );
      status = pct > 0 ? "nao_conforme" : "atenção";
    }
    if (item.unidade && ref.unidade && normUnidade(item.unidade) !== normUnidade(ref.unidade)) {
      alertas.push(`Unidade "${item.unidade}" diverge da referência "${ref.unidade}" (${origemRef}).`);
      if (status === "conforme") status = "nao_conforme";
    }
  }

  if (item.bdi) {
    const b = parseFloat(item.bdi);
    if (b && (b < 0.18 || b > 0.28)) { alertas.push(`BDI ${fmtPct(b)} fora da faixa 18–28% (Lei 14133).`); if (status === "conforme") status = "atenção"; }
  }
  if (!item.quantidade || item.quantidade <= 0) { alertas.push("Quantidade zerada ou ausente."); status = "nao_conforme"; }

  const ocs = historico.filter(h => (norm(h.codigo) && norm(h.codigo) === norm(item.codigo)) || norm(h.descricao).substring(0, 22) === norm(item.descricao).substring(0, 22));
  let tendencia = null;
  if (ocs.length > 0) {
    const ps = ocs.map(o => o.preco), media = ps.reduce((a, b) => a + b, 0) / ps.length;
    tendencia = { media, total: ocs.length };
    const precoAnt = ocs[ocs.length - 1].preco;
    if (Math.abs(item.preco - precoAnt) > 0.01) {
      alertasMem.push(`Preço base difere da última medição: anterior R$ ${fmt(precoAnt)}, atual R$ ${fmt(item.preco)} (${((item.preco - precoAnt) / precoAnt * 100).toFixed(2)}%). Preço deve ser fixo.`);
      if (status === "conforme") status = "atenção";
    }
    const ul = ocs[ocs.length - 1];
    if (ul?.medicaoId) alertasMem.push(`Cobrado na ${ul.medicaoId} (${ul.data}): ${ul.quantidade} ${ul.unidade} · R$ ${fmt(ul.preco)}.`);
    const uns = [...new Set(ocs.map(o => norm(o.unidade)))];
    if (uns.length > 1) { alertasMem.push(`Unidade variou entre medições: ${uns.join(" / ")}.`); if (status === "conforme") status = "atenção"; }
  }

  const excedentePreco = (ref && item.preco > ref.preco)
    ? (item.preco - ref.preco) * fatorReaj * fatorDes * fatorBdi * (item.quantidade || 0) : 0;
  const totalReferencia = ref ? ref.preco * fatorReaj * fatorDes * fatorBdi * (item.quantidade || 0) : 0;
  const excedenteItem = excedentePreco + excedenteQuantidade;

  return {
    ...item, ref, origemRef, alertas, alertasMem, infos, status, ocorrencias: ocs, tendencia,
    precoComAjuste, precoComBdi, totalItem, insumos: insumosFinal,
    excedenteItem, excedentePreco, excedenteQuantidade, totalReferencia
  };
}

// Um item corrigido/aceito pelo fiscal (ver rota /api/analise-automatica/corrigir)
// carrega um campo "_aceite" que não existe na análise automática original —
// essa função decide o status exibido, igual à regra do app original
// (statusEfetivo): a correção/aceite manda, sem apagar o status calculado.
export function statusEfetivo(item) {
  if (!item._aceite) return item.status;
  return item._aceite.tipo === "correcao_fiscal" ? "correcao_fiscal" : "aceito_ressalva";
}

// Monta o resumo agregado — replica o painel "Resumo" da tela, para o
// registro que fica salvo no banco e o que volta na resposta da API.
// Itens aceitos/corrigidos pelo fiscal saem do excedente a glosar (mas
// continuam contados em valorJustificado, para rastreabilidade).
export function montarResumo(itensAnalisados) {
  const ef = (i) => statusEfetivo(i);
  const conf = itensAnalisados.filter(i => ef(i) === "conforme").length;
  const aten = itensAnalisados.filter(i => ef(i) === "atenção").length;
  const naoC = itensAnalisados.filter(i => ef(i) === "nao_conforme").length;
  const resolvidos = itensAnalisados.filter(i => ["aceito_ressalva", "correcao_fiscal"].includes(ef(i))).length;
  const comAlertaMem = itensAnalisados.filter(i => i.alertasMem?.length > 0).length;
  const valorTotalMedido = itensAnalisados.reduce((s, i) => s + (i.totalItem || 0), 0);
  const valorExcedente = itensAnalisados.reduce((s, i) => s + (i._aceite ? 0 : (i.excedenteItem || 0)), 0);
  const valorJustificado = itensAnalisados.reduce((s, i) => s + (i._aceite ? (i.excedenteItem || 0) : 0), 0);
  return {
    totalItens: itensAnalisados.length,
    conformes: conf,
    atencao: aten,
    naoConformes: naoC,
    resolvidos,
    comAlertaMemoria: comAlertaMem,
    valorTotalMedido,
    valorExcedente,
    valorJustificado,
    valorALiberar: valorTotalMedido - valorExcedente,
  };
}

// Campos "de entrada" de um item (os mesmos que parseMedicao produz e que
// analisarItem consome) — extraídos de um item JÁ analisado (que carrega
// esses campos + os calculados, por causa do `...item` em analisarItem)
// para permitir reprocessar o item depois de uma correção do fiscal, sem
// precisar guardar uma cópia "crua" separada no banco.
const CAMPOS_BRUTOS = [
  "item", "codigo", "banco", "descricao", "unidade", "quantidade", "preco",
  "bdi", "reajuste", "desagio", "os", "sinApiModificada", "proprio", "insumos",
  "quantidadeFiscal",
];
export function extrairBruto(item) {
  const bruto = {};
  for (const k of CAMPOS_BRUTOS) {
    if (item[k] !== undefined) bruto[k] = item[k];
  }
  return bruto;
}
