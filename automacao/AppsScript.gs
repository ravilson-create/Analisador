/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUTOMAÇÃO — Tá na Mão → Analisador de Medição SINAPI
 *
 *  Roda DENTRO do Google Sheets que serve de fonte de dados ao app
 *  AppSheet "Tá na mão - MPMA" (Extensões → Apps Script, colado direto
 *  no editor vinculado à planilha — não é um projeto avulso).
 *
 *  O que faz, a cada execução (gatilho por tempo, ex.: a cada 10 min):
 *   1. Percorre a aba de Orçamentos de OS.
 *   2. Para cada linha cuja "Planilha de Orçamento" é nova ou mudou desde
 *      a última vez, baixa o PDF do Drive e manda para
 *      POST /api/analise-automatica no fiscal-sinapi-local.
 *   3. Escreve o resultado (resumo + link de conferência) de volta na
 *      mesma linha.
 *
 *  ⚠ PRECISA DE AJUSTE ANTES DE USAR — três pontos que não dá pra
 *  confirmar sem acesso ao editor do AppSheet / ao Drive real:
 *   (a) Nome exato da aba e das colunas (CONFIG abaixo).
 *   (b) Onde o AppSheet guarda o arquivo do campo "Planilha de Orçamento"
 *       no Drive — a função resolverArquivoAnexo() tenta alguns caminhos
 *       prováveis e cai para uma busca por nome de arquivo se não achar;
 *       teste com uma linha real e ajuste CONFIG.pastaAnexos se precisar.
 *   (c) A URL final do fiscal-sinapi-local e a chave AUTOMACAO_API_KEY
 *       (a mesma configurada nas variáveis de ambiente da Vercel).
 * ═══════════════════════════════════════════════════════════════════════
 */

const CONFIG = {
  // Nome exato da aba (confira no rodapé do Google Sheets)
  nomeAba: "Orçamentos de OS",

  // Nomes das colunas, como aparecem na linha de cabeçalho da aba.
  // Ajuste para bater com os nomes reais.
  colunas: {
    osId: "OS",                                   // identificador da OS
    arquivo: "Planilha de Orçamento",              // campo do tipo arquivo
    status: "Status",                              // ex.: "Em análise"
    resultadoResumo: "Resultado Análise Automática",   // criada se não existir
    resultadoData: "Data Análise Automática",          // criada se não existir
    ultimoArquivoProcessado: "_ultimo_arquivo_analisado", // controle interno; pode ficar oculta
  },

  // Só processa linhas nesse(s) status. Deixe [] para processar todas.
  statusElegveis: ["Em análise"],

  // Caminho(s) de pasta no Drive onde o AppSheet guarda os anexos desse
  // campo, relativos à pasta que contém a própria planilha. Baseado no
  // padrão visto na URL de download do AppSheet
  // (".../planilhas_orcamento/<arquivo>"), mas CONFIRME olhando o Drive:
  // clique com o botão direito na planilha → "Gerenciar versões"/"Localizar
  // arquivo" para achar a pasta-mãe, e veja se existe uma subpasta
  // "planilhas_orcamento" nela ou uma pasta irmã com nome do app.
  pastaAnexos: ["planilhas_orcamento"],

  urlAnalise: "https://SEU-PROJETO-NOVO.vercel.app/api/analise-automatica", // troque pela URL deste projeto novo
  // O app não exige mais chave nenhuma para chamar /api/analise-automatica
  // (AUTOMACAO_API_KEY hoje só protege uma chamada interna do próprio
  // servidor da Vercel, nunca algo chamado de fora). Este campo é mantido
  // só por compatibilidade — pode ficar vazio ou ser removido junto com o
  // header abaixo em processarLinha(). Se o projeto usar Vercel Deployment
  // Protection (ver README) para restringir quem abre a URL, é lá que se
  // configura o "Protection Bypass for Automation", não aqui.
  chaveApi: PropertiesService.getScriptProperties().getProperty("AUTOMACAO_API_KEY"),
};

function verificarNovasPlanilhas() {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.nomeAba);
  if (!aba) throw new Error(`Aba "${CONFIG.nomeAba}" não encontrada — ajuste CONFIG.nomeAba.`);

  const dados = aba.getDataRange().getValues();
  const cabecalho = dados[0];
  const idx = {};
  for (const [chave, nomeColuna] of Object.entries(CONFIG.colunas)) {
    idx[chave] = cabecalho.indexOf(nomeColuna);
  }
  if (idx.osId === -1 || idx.arquivo === -1) {
    throw new Error("Colunas obrigatórias não encontradas — confira CONFIG.colunas contra o cabeçalho real da aba.");
  }
  // Cria as colunas de resultado/controle se ainda não existirem.
  ["resultadoResumo", "resultadoData", "ultimoArquivoProcessado"].forEach((chave) => {
    if (idx[chave] === -1) {
      aba.getRange(1, cabecalho.length + 1).setValue(CONFIG.colunas[chave]);
      idx[chave] = cabecalho.length;
      cabecalho.push(CONFIG.colunas[chave]);
    }
  });

  for (let linha = 1; linha < dados.length; linha++) {
    const row = dados[linha];
    const osId = row[idx.osId];
    const arquivo = row[idx.arquivo];
    const statusAtual = idx.status >= 0 ? row[idx.status] : null;
    const jaProcessado = row[idx.ultimoArquivoProcessado];

    if (!arquivo) continue;
    if (CONFIG.statusElegveis.length && !CONFIG.statusElegveis.includes(statusAtual)) continue;
    if (arquivo === jaProcessado) continue; // sem mudança desde a última vez

    try {
      const resultado = processarLinha(osId, arquivo);
      escreverResultado(aba, linha + 1, idx, resultado, arquivo);
    } catch (e) {
      escreverResultado(aba, linha + 1, idx, { erro: e.message }, arquivo);
    }
    // Evita estourar o tempo de execução do Apps Script (6 min) e a cota
    // de chamadas simultâneas de UrlFetch quando há muitas linhas novas.
    Utilities.sleep(500);
  }
}

function processarLinha(osId, caminhoArquivo) {
  const arquivo = resolverArquivoAnexo(caminhoArquivo);
  if (!arquivo) {
    throw new Error(`Arquivo não localizado no Drive para "${caminhoArquivo}" — confira CONFIG.pastaAnexos.`);
  }
  const pdfBase64 = Utilities.base64Encode(arquivo.getBlob().getBytes());

  const resposta = UrlFetchApp.fetch(CONFIG.urlAnalise, {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": CONFIG.chaveApi },
    payload: JSON.stringify({ osId: String(osId), arquivoNome: arquivo.getName(), pdfBase64 }),
    muteHttpExceptions: true,
  });

  const corpo = JSON.parse(resposta.getContentText());
  if (resposta.getResponseCode() >= 300) {
    throw new Error(corpo.erro || `Falha HTTP ${resposta.getResponseCode()}`);
  }
  return corpo;
}

function escreverResultado(aba, numeroLinha, idx, resultado, arquivoProcessado) {
  if (resultado.erro) {
    aba.getRange(numeroLinha, idx.resultadoResumo + 1).setValue(`⚠ Erro: ${resultado.erro}`);
  } else {
    const r = resultado.resumo;
    const texto =
      `Conformes: ${r.conformes}/${r.totalItens} · Atenção: ${r.atencao} · Não conf.: ${r.naoConformes}\n` +
      `Valor medido: R$ ${r.valorTotalMedido.toFixed(2)}` +
      (r.valorExcedente > 0.01 ? ` · Excedente a glosar: R$ ${r.valorExcedente.toFixed(2)}` : "") +
      `\n(análise nº ${resultado.analiseId})`;
    aba.getRange(numeroLinha, idx.resultadoResumo + 1).setValue(texto);
  }
  aba.getRange(numeroLinha, idx.resultadoData + 1).setValue(new Date());
  // Só marca como "processado" quando não deu erro, para que uma falha
  // temporária (ex.: PDF corrompido no upload) seja tentada de novo na
  // próxima execução em vez de ficar presa silenciosamente.
  if (!resultado.erro) {
    aba.getRange(numeroLinha, idx.ultimoArquivoProcessado + 1).setValue(arquivoProcessado);
  }
}

/**
 * Tenta localizar, no Drive, o arquivo referente ao valor gravado no campo
 * "Planilha de Orçamento" da planilha (normalmente um caminho relativo do
 * tipo "planilhas_orcamento/e7fa1db6.excel.181058.pdf").
 *
 * Estratégia (nessa ordem):
 *  1. Procura, dentro das pastas-mãe da própria planilha, uma subpasta com
 *     o nome configurado em CONFIG.pastaAnexos e o arquivo dentro dela.
 *  2. Se não achar, cai para uma busca por nome de arquivo em todo o Drive
 *     acessível a esta conta — mais lenta, mas tolerante a estrutura de
 *     pastas diferente da esperada.
 */
function resolverArquivoAnexo(caminhoRelativo) {
  const nomeArquivo = caminhoRelativo.split("/").pop();
  const idPlanilha = SpreadsheetApp.getActiveSpreadsheet().getId();
  const pastasMae = DriveApp.getFileById(idPlanilha).getParents();

  while (pastasMae.hasNext()) {
    const pastaMae = pastasMae.next();
    for (const nomePasta of CONFIG.pastaAnexos) {
      const subpastas = pastaMae.getFoldersByName(nomePasta);
      while (subpastas.hasNext()) {
        const arquivos = subpastas.next().getFilesByName(nomeArquivo);
        if (arquivos.hasNext()) return arquivos.next();
      }
    }
  }

  // Fallback: busca por nome em todo o Drive.
  const busca = DriveApp.getFilesByName(nomeArquivo);
  if (busca.hasNext()) return busca.next();
  return null;
}

/**
 * Rode esta função UMA VEZ manualmente (Executar → criarGatilho) para
 * agendar a verificação periódica. Depois disso o gatilho fica registrado
 * em Extensões → Apps Script → Gatilhos, sem precisar rodar de novo.
 */
function criarGatilho() {
  ScriptApp.newTrigger("verificarNovasPlanilhas")
    .timeBased()
    .everyMinutes(10)
    .create();
}
