# ORÇA VALIDA — MPMA (projeto standalone)

*(nome interno do repositório/projeto na Vercel continua
`analise-automatica-sinapi-mpma` — só o nome exibido no app e neste
README virou ORÇA VALIDA.)*

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
- **Acesso**: login individual por e-mail/senha, restrito ao domínio
  `@mpma.mp.br` (ver "Login e papéis de acesso", abaixo). A única chave
  que ainda existe (`AUTOMACAO_API_KEY`) protege apenas a chamada interna
  servidor-a-servidor para a função Python de extração de PDF
  (`api/pdf-tabela.py`); ela nunca aparece em tela nem precisa ser
  digitada por ninguém — é diferente do login, que é de cada pessoa.

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
  que continua chamando `/api/analise-automatica` sem sessão de
  navegador, exatamente como hoje.
- `AUTH_SECRET` — outro valor aleatório longo (≥32 caracteres, mesmo
  comando acima). Assina o cookie de sessão do login; sem ele, ninguém
  consegue entrar. **Nunca reaproveite o mesmo valor do fiscal-sinapi-local
  nem de outro projeto** — são segredos independentes, cada um só vale
  para o próprio deploy.

(`DATABASE_URL` já foi preenchida sozinha no passo 3.)

### 5. Deploy

Faça o deploy (a Vercel já dispara um automaticamente ao conectar o
repositório). Confirme que a função Python foi reconhecida: em
**Deployments → (deploy mais recente) → Functions**, deve aparecer
`api/pdf-tabela.py` na lista.

### 6. Criar a conta de administrador e importar as bases SINAPI/ORSE

Abra a URL do projeto (`https://SEU-PROJETO.vercel.app`) — ela vai
redirecionar para `/entrar`. Crie sua conta com um e-mail do domínio
permitido (`@mpma.mp.br`, por padrão): como é a primeira conta do banco,
ela já vira administrador automaticamente. Logado, use o cartão "📚 Bases
de referência" para importar o SINAPI unificado (.xlsx) e, se usar, o
ORSE. Sem bases importadas, a análise automática roda mas todo item fica
sem referência de preço (o resultado avisa isso explicitamente). Veja
"Login e papéis de acesso", mais abaixo, para o cadastro dos demais
usuários (entram como usuário comum, só ativam/desativam bases).

Dentro do mesmo cartão tem a "🌐 Busca online — ORSE (CEHOP/SE)": consulta
direta e gratuita em `orse.cehop.se.gov.br` (rota `GET
/api/orse?termo=texto`, porta fiel do `api/orse/route.js` do
fiscal-sinapi-local, sem a exigência de login que existia lá — este app
não tem autenticação). Tenta o mês corrente e volta até 12 meses até achar
publicação com resultado. Cada resultado tem um botão "+ Adicionar à
base", que grava o item (ação `"item"` de `POST /api/bases`, em
`app/api/bases/route.js`) numa base "ORSE" — cria a base na hora se ainda
não existir, e só acrescenta/atualiza o item pelo código, sem nunca apagar
os itens que a base já tinha (diferente da ação `"base"`, usada só na
importação completa de planilha, que regrava os itens do zero). Um item
salvo assim passa a valer também para a busca assistida normal
(`/api/bases/buscar`) e para a análise automática, como qualquer outro
item de base importada.

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
para o mesmo Neon de desenvolvimento), `AUTOMACAO_API_KEY` e `AUTH_SECRET`.
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
cada `payload`). A busca assistida (usada tanto no modo `"codigo"` quanto
ao adicionar insumo numa composição própria) consulta `GET
/api/bases/buscar?q=texto` (mín. 3 letras), que pontua e retorna até 20
candidatos das bases SINAPI/ORSE ativas, ordenados por relevância (código
exato → código começa com → descrição começa com → descrição contém o
texto inteiro → descrição contém todas as palavras digitadas, mesmo fora
de ordem). A rota `/corrigir` reprocessa o item com a mesma `analisarItem`
do resto do pipeline e regrava o `resumo` da análise — não existe
endpoint de "desfazer tudo": para reverter uma correção de código ou
composição própria, aplique uma nova correção por cima (ex.: corrigir o
código de volta para o original).

**Memória de composições próprias**: diferente do app antigo, aqui toda
composição própria criada/corrigida pelo fiscal (ação `"composicao"`) é
gravada em `dados_compartilhados.composicoes` (mesmo campo já usado só de
leitura antes) via `salvarComposicaoMemoria` (`lib/basesServer.js`), com
deduplicação por código/descrição normalizados. Em análises futuras — a
mesma análise recém-corrigida ou uma nova análise de outra OS —,
`analisarItem` (`lib/analise.js`) consulta essa memória para qualquer item
`proprio` **antes** de desistir de referência: se o mesmo serviço já foi
validado antes por algum fiscal, o preço calculado é comparado contra o
que já foi validado (status conforme/atenção/não conforme + excedente a
glosar, igual ao fluxo normal com SINAPI/ORSE); só cai na mensagem antiga
("sem código de tabela pública") quando não há nenhum match na memória.
Não há UI nova para isso — é automático e silencioso quando não há match.

## Login e papéis de acesso

Cada pessoa tem sua própria conta (e-mail + senha) — a tela inicial (`/`)
exige login e redireciona para `/entrar` se não houver sessão válida.

- **Cadastro** é aberto em `/entrar` ("Ainda não tenho conta"), mas só
  aceita e-mails do domínio institucional (`DOMINIO_PERMITIDO` em
  `lib/db.js`, hoje `@mpma.mp.br`) — mude essa constante se o domínio for
  outro.
- **A primeira conta criada** (banco de usuários vazio) vira
  **administrador** automaticamente. As contas seguintes entram como
  usuário comum. Não há tela de gestão de usuários — para promover
  alguém a admin depois, rode no Neon (**Storage → seu banco → Query**):
  ```sql
  UPDATE usuarios SET perfil = 'admin' WHERE email = 'fulano@mpma.mp.br';
  ```
- **Bases de referência são compartilhadas** entre todos os usuários.
  Só o **administrador** importa (.xlsx), exclui uma base ou usa a busca
  online do ORSE para adicionar itens. Qualquer usuário comum pode
  ativar/desativar uma base já importada.
- **Análises são privadas de cada usuário** — quem sobe um PDF pela tela
  só vê (e só pode excluir/corrigir) as próprias análises. As análises
  disparadas automaticamente pelo Apps Script do Tá na Mão (sem sessão de
  navegador) ficam **públicas**, visíveis para qualquer usuário logado. O
  **administrador vê e pode excluir as análises de todo mundo**
  (supervisão).
- A senha é validada com `pgcrypto` (`crypt()`/`gen_salt('bf')`) e o
  login tem bloqueio temporário após tentativas erradas seguidas — mesmo
  padrão já usado no fiscal-sinapi-local.
- Se, além do login individual, for preciso restringir quem consegue
  sequer **abrir a URL** do projeto (ex.: durante homologação), some isso
  com a proteção da própria Vercel (**Settings → Deployment Protection**)
  — não precisa mexer no código deste projeto para isso.

## O que ainda vale revisar

- **Amostras de outras empresas**: a extração foi validada com um PDF da
  SAGA Engenharia. Teste com PDFs de outras contratadas antes de confiar
  no pipeline para todas as OS — se o software usado para gerar o PDF for
  diferente, o layout de tabela pode não ter as mesmas linhas de grade
  que este extrator espera.
- **Memória de medições** (`dados_compartilhados.memoria.medicoes` —
  diferente da memória de composições próprias, essa sim implementada, ver
  seção acima): continua sem nada gravando nela. Os alertas de tendência
  de preço entre medições (`historico` em `analisarItem`) só apareceriam
  depois que algum fluxo passasse a escrever nesse campo — não é o caso
  hoje.
- **Busca online do ORSE**: o scraping de `orse.cehop.se.gov.br`
  (`api/orse/route.js`) é uma cópia fiel do que já roda em produção no
  fiscal-sinapi-local, mas não pôde ser testado ponta a ponta durante o
  desenvolvimento (ambiente sem acesso a esse domínio) — vale um teste
  manual logo após o primeiro deploy, e reparar se o site mudou o HTML
  (`td.CorpoTabela`) desde a última vez que essa rota foi escrita.
- **Onde o AppSheet guarda o PDF no Drive**: o Apps Script ainda precisa
  confirmar isso na prática (ver observação no README de automação).
