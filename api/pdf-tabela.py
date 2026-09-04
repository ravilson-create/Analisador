# ═══════════════════════════════════════════════════════════════════════════
#  Função serverless (Vercel, runtime Python) — extrai a planilha de medição
#  de um PDF (Orçamento Sintético + Planilha Orçamentária Analítica, no
#  padrão "SAGA/MP-MA") em tabelas estruturadas, para o endpoint Node
#  /api/analise-automatica remontar como um .xlsx e reaproveitar o parser
#  já existente (lib/analise.js).
#
#  Só extrai e devolve dados — não decide nada sobre conformidade. Protegida
#  por uma chave compartilhada (mesma AUTOMACAO_API_KEY do endpoint Node) para
#  não ficar aberta como conversor público de PDF na internet.
# ═══════════════════════════════════════════════════════════════════════════
import json
import base64
import io
import os
import re
from http.server import BaseHTTPRequestHandler

import pdfplumber

# Linhas "banner" repetidas em toda página (razão social, CNPJ, cabeçalho
# Obra/Bancos/BDI/Reajuste/Deságio/Encargos Sociais sem linhas de grade
# internas) viram UMA célula só na extração por tabela, com quase tudo em
# branco ao redor. Isso as distingue de uma linha de dado real, que sempre
# tem várias colunas preenchidas.
MIN_CELULAS_PREENCHIDAS = 3


def _celulas_preenchidas(row):
    return sum(1 for c in row if c not in (None, ""))


def _linha_e_dado(row):
    return _celulas_preenchidas(row) >= MIN_CELULAS_PREENCHIDAS


def _extrair_metadados_cabecalho(page, limite_top):
    """
    Lê B.D.I., Reajuste e Deságio da faixa de cabeçalho (acima ou dentro do
    início da tabela) usando posição das palavras, já que esse bloco não tem
    linhas de grade internas e a extração por tabela o devolve como um único
    texto corrido. Cada rótulo (ex.: "B.D.I.") fica numa linha de texto e o
    valor correspondente (ex.: "28,0%") na linha imediatamente abaixo, quase
    na mesma posição horizontal — é assim que o layout SAGA alinha colunas
    sem desenhar grade nessa área.
    """
    palavras = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    cabecalho = [w for w in palavras if w["top"] < limite_top]
    if not cabecalho:
        return {}

    # Agrupa por linha (mesmo "top", com tolerância) preservando a ordem.
    linhas = []
    for w in sorted(cabecalho, key=lambda w: (round(w["top"]), w["x0"])):
        if linhas and abs(linhas[-1][0] - w["top"]) < 3:
            linhas[-1][1].append(w)
        else:
            linhas.append([w["top"], [w]])

    def valor_perto_de(x0_alvo, linha_valores, tolerancia=40):
        # Pega o mais PRÓXIMO dentro da tolerância, não o primeiro que couber
        # nela — rótulos vizinhos (ex.: "Reajuste" e "Deságio") ficam perto o
        # bastante um do outro para que a tolerância dos dois se sobreponha.
        candidatos = [w for w in linha_valores if abs(w["x0"] - x0_alvo) <= tolerancia]
        if not candidatos:
            return None
        mais_proximo = min(candidatos, key=lambda w: abs(w["x0"] - x0_alvo))
        return mais_proximo["text"]

    rotulos = {
        "bdi": re.compile(r"^B\.?D\.?I\.?$", re.IGNORECASE),
        "reajuste": re.compile(r"^Reajuste$", re.IGNORECASE),
        "desagio": re.compile(r"^Des[aá]gi[ol]$", re.IGNORECASE),
    }
    achados = {}
    for i, (top, palavras_linha) in enumerate(linhas[:-1]):
        for chave, rx in rotulos.items():
            if chave in achados:
                continue
            for w in palavras_linha:
                if rx.match(w["text"]):
                    prox_top, prox_palavras = linhas[i + 1]
                    val = valor_perto_de(w["x0"], prox_palavras)
                    if val:
                        achados[chave] = val
    return achados


def _percentual_para_fracao(txt):
    if txt is None:
        return None
    s = str(txt).replace("%", "").strip().replace(".", "").replace(",", ".")
    try:
        n = float(s)
    except ValueError:
        return None
    return n / 100 if n > 1 else n


def _numero_brasileiro(txt):
    if txt is None:
        return None
    s = str(txt).replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


def extrair_pdf(pdf_bytes):
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        if not pdf.pages:
            raise ValueError("PDF sem páginas.")

        pagina1 = pdf.pages[0]
        tabelas_p1 = pagina1.extract_tables()
        if not tabelas_p1:
            raise ValueError(
                "Nenhuma tabela encontrada na primeira página do PDF. "
                "Este conversor espera um PDF gerado a partir de planilha "
                "(texto real com linhas de grade), não uma imagem escaneada."
            )
        tabela_sintetico = tabelas_p1[0]

        # Cabeçalho de metadados: acima do início da tabela detectada.
        tables_obj = pagina1.find_tables()
        limite_top = tables_obj[0].bbox[1] + 25 if tables_obj else 140
        metadados_raw = _extrair_metadados_cabecalho(pagina1, limite_top)
        metadados = {
            "bdi": _percentual_para_fracao(metadados_raw.get("bdi")),
            "reajuste": _numero_brasileiro(metadados_raw.get("reajuste")),
            "desagio": _percentual_para_fracao(metadados_raw.get("desagio")),
        }

        # Linha de cabeçalho real da tabela sintética ("Item Código Banco
        # Descrição ..."). É a primeira linha de dado de verdade — a linha
        # 0 é o blob de metadados (Obra/Bancos/BDI/...) e é descartada aqui
        # porque os metadados já foram extraídos à parte, com mais precisão.
        linhas_uteis_sint = [r for r in tabela_sintetico if _linha_e_dado(r)]

        # Páginas seguintes: "Planilha Orçamentária Analítica", uma ou mais
        # páginas de continuação do mesmo quadro. Concatenadas em ordem para
        # que o parser (que anda pelas linhas mantendo o "item atual") veja
        # uma sequência contínua, igual a uma aba .xlsx de verdade.
        linhas_analitico = []
        for page in pdf.pages[1:]:
            tabelas = page.extract_tables()
            for tabela in tabelas:
                linhas_analitico.extend(r for r in tabela if _linha_e_dado(r))

        return {
            "metadados": metadados,
            "sintetico": linhas_uteis_sint,
            "analitico": linhas_analitico,
            "paginas": len(pdf.pages),
        }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            chave_esperada = os.environ.get("AUTOMACAO_API_KEY")
            chave_recebida = self.headers.get("x-api-key")
            if not chave_esperada or chave_recebida != chave_esperada:
                self._responder(401, {"erro": "Não autenticado."})
                return

            tamanho = int(self.headers.get("Content-Length", 0))
            corpo = self.rfile.read(tamanho)
            dados = json.loads(corpo or b"{}")
            pdf_base64 = dados.get("pdf_base64")
            if not pdf_base64:
                self._responder(400, {"erro": "Campo 'pdf_base64' é obrigatório."})
                return

            pdf_bytes = base64.b64decode(pdf_base64)
            resultado = extrair_pdf(pdf_bytes)
            self._responder(200, resultado)
        except Exception as e:  # noqa: BLE001 — resposta de erro genérica de propósito
            self._responder(500, {"erro": str(e)})

    def _responder(self, status, payload):
        corpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)
