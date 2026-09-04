// ═══════════════════════════════════════════════════════════════════════════
//  PONTE PDF → XLSX
//
//  A função serverless Python (api/pdf-tabela.py) extrai as tabelas do PDF
//  enviado pela empresa (linhas de grade reais, texto nativo — não é OCR).
//  Esta função remonta esse resultado como um workbook .xlsx EM MEMÓRIA,
//  com o mesmo layout de colunas que uma planilha SAGA/MP-MA de verdade
//  teria — para poder alimentar lib/analise.js#parseMedicao() sem precisar
//  duplicar nenhuma regra de leitura.
//
//  Por que reconstruir um xlsx em vez de ensinar parseMedicao a ler o JSON
//  do PDF diretamente: assim o motor de análise continua tendo UMA entrada
//  só (buffer de xlsx), igual à tela de upload manual — reduz o risco de
//  os dois caminhos (upload manual e análise automática) divergirem.
// ═══════════════════════════════════════════════════════════════════════════
import * as XLSX from "xlsx";

// Achata quebras de linha dentro de uma célula (comuns em texto de PDF que
// deu "word wrap" na célula original) para não atrapalhar comparações de
// texto feitas linha a linha pelo parser.
function limparCelula(v) {
  if (v == null) return null;
  return String(v).replace(/\s*\n\s*/g, " ").trim();
}

function limparLinha(row) {
  return (row || []).map(limparCelula);
}

/**
 * @param {object} extraido - resultado de api/pdf-tabela.py:
 *   { metadados:{bdi,reajuste,desagio}, sintetico:[[...]], analitico:[[...]] }
 * @returns {Buffer} buffer .xlsx com abas "Orçamento Sintético" e
 *   "Planilha Orçamentária Analítica"
 */
export function construirXlsxDoPdf(extraido) {
  const { metadados = {}, sintetico = [], analitico = [] } = extraido;

  if (!sintetico.length) {
    throw new Error("PDF não trouxe nenhuma linha reconhecível na tabela de orçamento sintético.");
  }

  // ── Aba "Orçamento Sintético" ──
  // Linha 0: rótulos (usados só para localizar as colunas de BDI/Reajuste/
  // Deságio — ver lib/analise.js#parseMedicao, que varre `rows[0]`).
  // Linha 1: valores já numéricos, extraídos com precisão pela função
  // Python (via posição de texto, não pela tabela de grade — ver
  // api/pdf-tabela.py) em vez de tentar reaproveitar o texto corrido do
  // PDF, que nessa faixa não tem linhas de grade separando as colunas.
  const linhaRotulos = ["Obra", "Bancos", "B.D.I.", "Reajuste", "Deságio", "", "", "Encargos Sociais"];
  const linhaValores = [
    "Planilha recebida via análise automática",
    "",
    metadados.bdi ?? "",
    metadados.reajuste ?? "",
    metadados.desagio ?? "",
    "", "", "",
  ];

  // sintetico[0] já é o cabeçalho real da tabela ("Item Código Banco
  // Descrição ..."), como confirmado pelo teste contra o PDF de amostra;
  // sintetico[1..] são as linhas de item/grupo.
  const linhasSintetico = [linhaRotulos, linhaValores, ...sintetico.map(limparLinha)];
  const wsSintetico = XLSX.utils.aoa_to_sheet(linhasSintetico);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSintetico, "Orçamento Sintético");

  // ── Aba "Planilha Orçamentária Analítica" ──
  // Só é criada se o PDF trouxe alguma linha analítica — nem toda medição
  // tem itens "SINAPI Modificada"/"Próprio" que exijam analítico; sem essa
  // aba, parseAnalitico() simplesmente devolve {} e cada item usa insumos
  // vindos da própria base de referência, se houver.
  if (analitico.length) {
    const wsAnalitico = XLSX.utils.aoa_to_sheet(analitico.map(limparLinha));
    XLSX.utils.book_append_sheet(wb, wsAnalitico, "Planilha Orçamentária Analítica");
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
