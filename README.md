# Análise Automática SINAPI — MPMA (projeto standalone)

Serviço independente — **projeto novo na Vercel, banco Neon próprio** —
que recebe o PDF da "Planilha de Orçamento" anexada a uma OS no Tá na Mão
e roda a mesma análise de conformidade SINAPI/ORSE que existe no
fiscal-sinapi-local, sem alterar nem depender daquele projeto/banco em
nada. Pensado para ser disparado pelo Apps Script da planilha do Tá na
Mão (ver `automacao/` — mesmo script documentado no fiscal-sinapi-local,
só muda a URL de destino para a deste projeto).

**Escopo deste app, de propósito, é só isto**: bases de referência
(SINAPI/ORSE) + análise de PDF de orçamento contra essas bases. Não tem
"memória de cálculo" nem módulo de "orçamento" (montagem de planilha) —
esses módulos existem só no app antigo (fiscal-sinapi-local) e não foram
trazidos para cá, porque a única função deste projeto é verificar os
orçamentos enviados em PDF pelas empresas no Tá na Mão.

## Como isto se relaciona com o fiscal-sinapi-local

- **Código**: `lib/analise.js` e `lib/pdfParaXlsx.js` são os mesmos
  (extração de tabela do PDF, parser e motor de comparação SINAPI/ORSE).
  Nenhum arquivo do projeto antigo foi alterado.
- **Banco**: totalmente separado. As bases SINAPI/ORSE precisam ser
  importadas aqui de novo (seção abaixo) — não há nenhuma sincronização
  automática com o Neon do fiscal-sinapi-local.
- **Acesso**: este projeto não tem login nem chave para usar o app — quem
  abrir a URL usa direto, sem precisar digitar nada. A única chave que
  ainda existe (`AUTOMACAO_API_KEY`) protege apenas a chamada interna
  servidor-a-servidor para a função Python de extração de PDF
  (`api/pdf-tabela.py`); ela nunca aparece em tela nem precisa ser
  digitada por ninguém. Se for preciso restringir quem consegue **abrir a
  URL** do app (não só quem consegue chamar as rotas), veja "Como
  restringir quem acessa este app", mais abaixo.

## Passo a passo para colocar no ar

### 1. Repositório

Suba esta pasta como um repositório novo no GitHub (ou GitLab/Bitbucket).
Se preferir pular o Git, dá para fazer deploy direto desta pasta com a
Vercel CLI (`npx vercel`) — mas ter o código num repositório facilita
atualizações futuras.

### 2. Criar o projeto na Vercel

- **Add New → Project** → importe o repositório criado no passo 1.
- Framework detectado automaticamente como Next.js — não precisa mudar nada.

### 3. Banco de dados — Neon exclusivo deste projeto

- Dentro do projeto na Vercel: **Storage → Create Database → Neon**.
- Siga o assistente (nome do banco, região — escolha uma perto do Brasil,
  ex. `sa-east-1`, se disponível). A Vercel cria o banco e injeta
  `DATABASE_URL` automaticamente nas variáveis de ambiente do projeto —
  não precisa copiar/colar nada.
- Esse banco é próprio deste projeto: não é o mesmo Neon usado pelo
  fiscal-sinapi-local, mesmo que ambos apareçam na mesma conta Vercel.

### 4. Variáveis de ambiente

Em **Settings → Environment Variables**, adicione:

- `AUTOMACAO_API_KEY` — um valor aleatório longo (ex.: gere com
  `openssl rand -hex 32` no terminal). É de uso **interno**: só protege a
  chamada servidor-a-servidor que a rota `/api/analise-automatica` faz
  para a função Python de extração (`api/pdf-tabela.py`). Não aparece em
  nenhum campo da tela nem precisa ser digitada — nem pelo Apps Script,
  que também não precisa mais dela para chamar `/api/analise-automatica`
  (a rota está aberta; veja a nota de segurança acima).

(`DATABASE_URL` já foi preenchida sozinha no passo 3.)

### 5. Deploy

Faça o deploy (a Vercel já dispara um automaticamente ao conectar o
repositório). Confirme que a função Python foi reconhecida: em
**Deployments → (deploy mais recente) → Functions**, deve aparecer
`api/pdf-tabela.py` na lista.

### 6. Importar as bases SINAPI/ORSE

Abra a URL do projeto (`https://SEU-PROJETO.vercel.app`) e use direto o
cartão "📚 Bases de referência" para importar o SINAPI unificado (.xlsx)
e, se usar, o ORSE — não precisa de nenhuma chave. Sem bases importadas,
a análise automática roda mas todo item fica sem referência de preço (o
resultado avisa isso explicitamente).

### 7. Testar

Ainda na página inicial, use o cartão "📄 Análise de Orçamento (PDF)" para
subir um PDF de exemplo e conferir o resultado item a item (mesma tabela
que aparece quando o Apps Script dispara a análise de verdade) antes de
ligar a automação em produção. Clicando num item, além de ver a composição
do preço, dá para corrigir a quantidade medida, corrigir o código de
referência (com busca assistida por descrição, sem precisar já saber o
código de cor), criar uma composição própria com insumos, ou aceitar um
preço divergente com justificativa — cada ação já recalcula o item (mesma
fórmula do fiscal-sinapi-local) e grava a correção junto do registro da
análise (rota `POST /api/analise-automatica/corrigir`). O botão "🖨
Imprimir parecer" (no resultado e em cada linha de "📋 Análises
recentes") abre `/imprimir/<id>`, uma página só com o parecer completo
(cabeçalho da OS, resumo e tabela item a item com as correções/aceites
aplicados) pronta para "Salvar como PDF" pelo próprio navegador.

### 8. Apontar o Apps Script para este projeto

No `automacao/AppsScript.gs` (documentado no fiscal-sinapi-local — copie
para cá se preferir manter tudo junto), ajuste:

```js
urlAnalise: "https://SEU-PROJETO.vercel.app/api/analise-automatica",
```

e configure `AUTOMACAO_API_KEY` nas Propriedades do Script com o mesmo
valor definido aqui na Vercel.

## Rodar localmente (opcional)

```
npm install
```
Crie um `.env` (copie de `.env.example`) com `DATABASE_URL` (pode apontar
para o mesmo Neon de desenvolvimento) e `AUTOMACAO_API_KEY`.
```
npm run dev
```
Abra `http://localhost:3000`. A função Python (`api/pdf-tabela.py`) só
roda de verdade no ambiente da Vercel — para testar a extração do PDF
localmente sem subir para produção, use `vercel dev` no lugar de
`next dev` (ele emula as funções serverless, inclusive as em Python).

## Corrigir um item depois da análise

Diferente do fiscal-sinapi-local (onde as correções ficam só na sessão do
navegador, em `localStorage`), aqui cada correção é persistida direto no
registro da análise em `analises_automaticas` via `POST
/api/analise-automatica/corrigir`. Corpo: `{ analiseId, itemIndex, acao,
payload }`, com `acao` em `"quantidade"`, `"codigo"`, `"composicao"` ou
`"aceite"` (ver o comentário no topo de
`app/api/analise-automatica/corrigir/route.js` para o formato exato de
cada `payload`). A busca assistida de código usada no modo `"codigo"`
consulta `GET /api/bases/buscar?q=texto` (mín. 3 letras), que pontua e
retorna até 20 candidatos das bases SINAPI/ORSE ativas, ordenados por
relevância (código exato → código começa com → descrição começa com →
contém). A rota `/corrigir` reprocessa o item com a mesma `analisarItem`
do resto do pipeline e regrava o `resumo` da análise — não existe
endpoint de "desfazer tudo": para reverter uma correção de código ou
composição própria, aplique uma nova correção por cima (ex.: corrigir o
código de volta para o original).

Não implementado (diferença consciente do app antigo): não há uma
"memória" que lembre correções feitas numa análise para sugerir nas
próximas — cada análise é corrigida isoladamente.

## Como restringir quem acessa este app

Como não existe mais nenhuma chave nem login na tela inicial, qualquer
pessoa com a URL do projeto consegue abrir e usar o app. Se isso for um
problema (por exemplo, se a URL puder vazar antes de ir para produção, ou
se só a equipe da fiscalização puder acessar), use a proteção da própria
Vercel em vez de reintroduzir um campo dentro do app:

- **Settings → Deployment Protection** no projeto na Vercel. As opções
  mais simples são "Vercel Authentication" (exige login com conta Vercel
  de quem tiver acesso ao time) ou uma senha simples na frente do site
  inteiro ("Password Protection", disponível em alguns planos). Qualquer
  uma delas protege a URL toda — inclusive `/imprimir/<id>` — sem afetar
  a chamada interna do Apps Script (que pode ser adicionada à lista de
  exceções/bypass, se a proteção escolhida tiver essa opção) nem exigir
  nenhuma mudança no código deste projeto.

## O que ainda vale revisar

- **Amostras de outras empresas**: a extração foi validada com um PDF da
  SAGA Engenharia. Teste com PDFs de outras contratadas antes de confiar
  no pipeline para todas as OS — se o software usado para gerar o PDF for
  diferente, o layout de tabela pode não ter as mesmas linhas de grade
  que este extrator espera.
- **Memória de medições**: como o banco é novo, a "memória" de medições
  anteriores começa vazia — os alertas de tendência de preço entre
  medições só aparecem depois que este projeto acumular seu próprio
  histórico (ou de alguma forma futura de importar o histórico existente
  do fiscal-sinapi-local, se fizer sentido).
- **Onde o AppSheet guarda o PDF no Drive**: o Apps Script ainda precisa
  confirmar isso na prática (ver observação no README de automação).
