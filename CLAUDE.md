# STARTZ — Vendor Dashboard (Grupo START)

Este repositório publica, via GitHub Pages, dashboards de inteligência
Amazon Vendor Central para 7 contas geridas pelo Grupo START. Os dados são
capturados via SP-API (Selling Partner API) e transformados em um único
`dados_vendor.json`, consumido via `fetch()` por `dashboard_base.html` /
`app.js` — sem nenhum dado embutido no HTML.

Histórico: esse fluxo nasceu e rodou por meses num notebook Google Colab
(`API_TREELISS.ipynb`, fora deste repositório). Este `CLAUDE.md` e a pasta
`scripts/` documentam a migração desse fluxo para rodar via Claude Code
(sem depender de Google Drive/Colab — as contas usam variáveis de
ambiente e disco local).

## Fluxo de atualização do dashboard (4 passos)

```
1. CAPTURA         scripts/capturar_mensal.py            (Vendas, Estoque, Tráfego, Margem — SEMPRE)
                    scripts/capturar_complementar.py      (Cupons, Promoções, Pedidos, Buy Box, Brand Analytics — recomendado)
                    scripts/capturar_catalogo.py          (nome/imagem/BSR por ASIN — recomendado)
                    scripts/capturar_qualidade_completa.py + scripts/calcular_qualidade_catalogo.py  (índice de qualidade — recomendado)
                        ↓
2. TRANSFORMAR      scripts/transformar_vendor.py         → gera dados_vendor.json
                        ↓
3. CDQ              scripts/enriquecer_qualidade_cdq.py   → adiciona score_geral_conta e acoes_pendentes
                        ↓
4. PUBLICAR         scripts/publicar_github.py            → commit + push (geral + cópias isoladas em clientes/<conta>/)
```

Rode tudo a partir da raiz do repositório:

```bash
pip install -r scripts/requirements.txt

python scripts/capturar_mensal.py
python scripts/capturar_complementar.py
python scripts/capturar_catalogo.py
python scripts/capturar_qualidade_completa.py
python scripts/calcular_qualidade_catalogo.py

python scripts/transformar_vendor.py
python scripts/enriquecer_qualidade_cdq.py
python scripts/publicar_github.py
```

Todo script de captura aceita `--contas <chave1>,<chave2>` pra rodar só
uma conta (útil pra conta nova, sem re-tocar as outras — substitui o
`SOMENTE = [...]` que antes era editado manualmente dentro de cada célula
do notebook). Sem `--contas`, roda as 7 contas.

`buscar_asins_por_marca.py` **não** faz parte do ciclo recorrente — é
auxiliar, rodado sob demanda (conta nova, ou contagem de ASINs
suspeita de incompleta). Ver docstring do script.

### Onde os dados ficam

- **Dados brutos** (por conta, um JSON por relatório/captura): pasta local
  `dados_raw/<conta>/raw/` (configurável via `VENDOR_DATA_DIR`). **Não é
  versionada** (`.gitignore`) — só o resultado final (`dados_vendor.json`)
  é commitado.
- **`dados_vendor.json`** (geral, todas as contas): raiz do repositório.
- **Cópias isoladas por cliente**: `clientes/<conta>/dados_vendor.json`,
  geradas automaticamente por `publicar_github.py` para cada conta que já
  tenha uma pasta `clientes/<conta>/` (hoje: `alfa_jf`, `blidshop` — para
  isolar uma conta nova, crie a pasta `clientes/<conta_id>/` com
  `dashboard_base.html`, `styles.css` e `app.js` dentro, uma única vez).

## As 7 contas e os secrets

Configuração única em `scripts/contas_config.py` — é o ÚNICO lugar que
precisa ser editado para adicionar/corrigir uma conta (antes, cada script
no notebook tinha sua própria cópia de `CONTAS_CONFIG`, e era fácil uma
ficar desatualizada — foi o que aconteceu com o secret da ALFA JF e com
Jolitex/Balboa/Rio Master faltando em dois scripts).

| chave       | nome            | variável de ambiente (refresh token) |
|-------------|-----------------|----------------------------------------|
| `alfa_jf`   | ALFA JF         | `SP_API_REFRESH_TOKEN_ALFAJF`          |
| `blidshop`  | Blid Shop       | `SP_API_REFRESH_TOKEN_BLIDSHOP`        |
| `conta3`    | Petclean BR     | `SP_API_REFRESH_TOKEN_PETCLEAN`        |
| `ozitp`     | OZITP           | `SP_API_REFRESH_TOKEN_OZITP`           |
| `jolitex`   | Jolitex         | `SP_API_REFRESH_TOKEN_JOLITEX`         |
| `balboa`    | Balboa (marca Ligga Sports) | `SP_API_REFRESH_TOKEN_BALBOA` |
| `riomaster` | BR - Rio Master | `SP_API_REFRESH_TOKEN_RIOMASTER`       |

Além disso, todas as contas compartilham:

- `SP_API_LWA_CLIENT_ID` / `SP_API_LWA_CLIENT_SECRET` — credenciais do app
  LWA (Login with Amazon), mesmas para as 7 contas.
- `GITHUB_TOKEN` — Personal Access Token do GitHub, usado por
  `publicar_github.py` **só** se o script não estiver rodando de dentro
  de um checkout git já autenticado (numa sessão do Claude Code já aberta
  neste repositório, normalmente não é necessário).

A chave `conta3` (Petclean BR) é histórica — é assim que
`dados_vendor.json` e o dashboard (`app.js`/`dashboard_base.html`)
identificam essa conta. Não renomear sem atualizar o front-end junto.

**Nenhum destes scripts imprime, grava ou loga o valor de um token** — só
os nomes das variáveis de ambiente. Configure os 7 refresh tokens + as 2
credenciais LWA como variáveis de ambiente no ambiente de nuvem antes de
rodar qualquer captura.

### Adicionando uma conta nova

1. Edite `scripts/contas_config.py`: adicione a conta em `CONTAS` (nome,
   pasta, secret, `seller_id` se já souber o vendorCode, `marcas` se já
   souber o nome exato da marca — pode deixar `[]` por enquanto).
2. Configure o secret `SP_API_REFRESH_TOKEN_<CONTA>` como variável de
   ambiente.
3. Rode o fluxo completo só para essa conta: `--contas <chave>` em cada
   script de captura, depois `transformar_vendor.py` (roda pra todas,
   mas só processa quem tem pasta) → `enriquecer_qualidade_cdq.py` →
   `publicar_github.py`.
4. Se quiser dashboard isolado pra essa conta, crie
   `clientes/<chave>/` com `dashboard_base.html`, `styles.css`, `app.js`
   (copiados dos da raiz) — a partir da próxima publicação,
   `clientes/<chave>/dados_vendor.json` passa a ser mantido sozinho.

## Problemas conhecidos / decisões tomadas nesta organização

- **Secret genérico da ALFA JF**: no notebook original, a célula
  multi-conta "grande" usava um secret genérico errado para a ALFA JF; as
  correções foram feitas em células isoladas e nunca voltaram pra célula
  principal. Nos scripts consolidados isso está corrigido (ALFA JF usa
  `SP_API_REFRESH_TOKEN_ALFAJF`) e não pode mais regredir, porque agora
  existe um único `contas_config.py`.
- **Jolitex/Balboa/Rio Master faltando**: `buscar_asins_por_marca.py` e
  `capturar_catalogo.py`, no notebook, ficaram um tempo cobrindo só 6
  contas (faltava Rio Master). Corrigido — as 7 contas estão em
  `contas_config.py`. A marca da Rio Master (`CONTAS['riomaster']['marcas']`)
  ainda está vazia — preencher com o nome exato do campo "Marca" antes de
  rodar `buscar_asins_por_marca.py` para essa conta (até lá, o script
  pula a conta em vez de dar erro).
- **`capturar_pedidos.py` não existe**: não faz parte do fluxo real.
  Havia células de teste no notebook para isso (Purchase Orders / VendorOrders,
  Forecasting), mas nunca viraram uma célula de captura recorrente — não
  foram portadas para `scripts/`.
- **Retry/backoff em falha de cota**: a Amazon já devolveu falha parcial
  por limite de cota em produção (aconteceu com a Petclean). Antes, só
  `capturar_catalogo.py` tinha retry com backoff; os outros scripts só
  tinham `time.sleep()` fixo entre chamadas, sem re-tentar de fato uma
  falha transitória. Agora todos os scripts de captura usam o mesmo
  helper `sp_api_utils.com_retry()` (backoff crescente, só para erros que
  parecem transitórios — QuotaExceeded, throttling, 429/503, timeout;
  erros permanentes como `NOT_FOUND` não são re-tentados).
- **Lacuna conhecida: Sell-in e Previsão**: `transformar_vendor.py` sabe
  ler `purchase_orders_60dias.json` (Sell-in / Purchase Orders) e
  `previsao_60dias.json` (Forecasting) se esses arquivos existirem na
  pasta raw da conta — e preenche `sellin`, `sellinMes`, `previsao`,
  `previsaoMes`, `markupMes/Geral`, `totalPOs` no `dados_vendor.json` a
  partir deles. **Mas nenhum script do fluxo recorrente atual gera esses
  dois arquivos** — os dados de Sell-in/Previsão hoje presentes no
  `dados_vendor.json` publicado vieram de uma captura manual feita uma
  vez, direto no notebook (fora do fluxo de 4 passos), e só continuam
  aparecendo enquanto ninguém apagar `purchase_orders_60dias.json` /
  `previsao_60dias.json` de `dados_raw/<conta>/raw/`. Pra manter essas
  seções atualizadas de verdade seria preciso portar essa captura pra
  `scripts/` como uma tarefa separada — não foi feito aqui porque não
  faz parte dos 9 scripts pedidos nesta organização.
- **`clientes/alfa_jf/` e `clientes/blidshop/` com `app.js`/`dashboard_base.html`
  desatualizados**: essas duas pastas têm cópias mais antigas do
  dashboard (sem a aba "Qualidade de Catálogo" que já existe na raiz).
  `publicar_github.py` só atualiza o `dados_vendor.json` de cada pasta
  isolada — nunca o HTML/CSS/JS. Ficou fora do escopo desta organização
  (que era só scripts + config); atualizar esses 3 arquivos nas duas
  pastas é uma tarefa separada.

## Formato do `dados_vendor.json`

> O notebook original referenciava um `schema_dadosx.md` guardado no
> Project Knowledge de um projeto Claude.ai — não está neste repositório
> nem foi encontrado em nenhum lugar acessível a partir daqui. A
> descrição abaixo foi reconstruída lendo `transformar_vendor.py` e
> conferindo campo a campo contra o `dados_vendor.json` real já publicado
> neste repo. Se você tiver o `schema_dadosx.md` original, cole o
> conteúdo numa conversa com o Claude Code pra reconciliar as duas
> versões.

Estrutura: um objeto JSON onde cada chave é o identificador de uma conta
(`alfa_jf`, `blidshop`, `conta3`, `ozitp`, `jolitex`, `balboa`,
`riomaster`), e o valor é um objeto com os campos abaixo.

```jsonc
{
  "alfa_jf": {
    "nome": "ALFA JF",
    "nota": "",

    // --- séries por ASIN × mês (chave do mês = "YYYY-MM") ---
    "vendas":  { "<asin>": { "<mes>": { "orderedRevenue", "orderedUnits", "shippedRevenue", "shippedUnits", "customerReturns", "shippedCogs" } } },
    "estoque": { "<asin>": { "<mes>": { "sellableUnits", "sellableCost", "aged90Units", "unhealthyUnits", "unhealthyCost", "openPO", "sellThrough", "oosRate", "receiveFillRate", "leadTime", "unfilledUnits", "temInfo" } } },
    "trafego": { "<asin>": { "<mes>": { "glanceViews" } } },
    "margem":  { "<asin>": { "<mes>": { "npm" } } },        // net pure product margin (fração 0-1)

    // --- as mesmas 4 séries, agregadas por mês (sem quebra por ASIN) ---
    "aggVendas": { "<mes>": { /* mesmos campos de vendas */ } },
    "aggEstoque": { "<mes>": { /* mesmos campos de estoque */ } },
    "aggTrafego": { "<mes>": { "glanceViews" } },
    "aggMargem": { "<mes>": { "npm" } },

    // --- Sell-in / Purchase Orders (ver "Lacuna conhecida" acima) ---
    "sellin": { "<asin>": { "conf": <unid. confirmadas>, "rej": <unid. rejeitadas>, "custo": <R$>, "pos": <nº de POs> } },
    "sellinMes": { "<mes>": { "custo", "conf", "rej", "pos" } },
    "repetidos": { "<asin>": <nº de POs em que o ASIN repetiu> },
    "naoAtendidos": { "<asin>": <unidades rejeitadas acumuladas> },
    "nuncaComprados": ["<asin>", ...],          // teve venda/estoque mas nunca apareceu em nenhum PO
    "markupMes": { "<mes>": <markup médio (listPrice-netCost)/netCost> },
    "markupGeral": <número>,
    "totalPOs": <número>,

    // --- Previsão (Forecasting) — mesma ressalva de Sell-in ---
    "previsao": { "<asin>": { "mean", "p70", "p80", "p90" } },       // soma dos próximos 60 dias
    "previsaoMes": { "<mes>": { "mean", "p70", "p80", "p90", "valor" } },  // valor = unidades × custoMedio do ASIN

    "custoMedio": { "<asin>": <custo unitário ponderado por volume enviado> },
    "abc": { "<asin>": { "valor": <receita acumulada>, "classe": "A"|"B"|"C", "pct": <fração da receita total> } },
    "ticketMarkup": { "<mes>": { "ticket": <receita/unidade enviada>, "markupVarejo": <(receita-cogs)/cogs> } },

    // --- catálogo (nome/imagem/BSR) — de capturar_catalogo.py ---
    "catalogo": { "<asin>": { "nome", "marca", "imagem": "<url>", "bsr": [{ "categoria", "rank" }] } },

    // --- qualidade de catálogo (aproximação própria do CDQ) ---
    "qualidade": {
      "asins": {
        "<asin>": {
          "score_geral": <0-100>, "grau_geral": "A"|"B"|"C"|"D",
          "componentes": {
            "titulo":    { "grau", "score", "motivo", "comprimento" },
            "bullets":   { "grau", "score", "quantidade" },
            "imagens":   { "grau", "score", "quantidade", "alta_resolucao" },
            "atributos": { "grau", "score", "issues_count", "obs" },
            "aplus":     { "grau", "score", "presente", "obs"? },
            "variacoes": { "grau", "score", "tema", "parent_asin" }   // só presente se variacao_aplicavel=true
          },
          "variacao_aplicavel": true|false,
          "acoes_pendentes": ["<texto legível>", ...]     // adicionado no passo 3 (enriquecer_qualidade_cdq.py)
        }
      },
      "nao_pertence_a_conta": ["<asin>", ...],   // ASIN encontrado no catálogo mas não pertence a esta conta Vendor
      "score_geral_conta": <média de score_geral entre os ASINs>   // adicionado no passo 3
    },

    // --- diagnósticos automáticos (calculados por transformar_vendor.py; ausente se não houver dados suficientes) ---
    "analise": {
      "ultimoMes": "<YYYY-MM>", "convGeral": <número>, "ticket": <R$>, "npm": <número|null>, "viewsMediana": <número>,
      "diagnosticos": [
        { "tipo": "perdidos|conversao|parado|margem|oportunidade", "titulo", "impacto": <R$>, "qtd", "explica", "acao", "itens": [...] }
      ],
      "perfil": { "<asin>": { "views", "ped", "env", "rec", "cogs", "dev", "est", "parado", "a90", "giro", "openPO", "temInfoEst", "conv", "npm", "siConf", "siCusto" } },
      "concentracao": { "top5": <fração da receita nos 5 maiores ASINs>, "nAsins": <número> },
      "serieGap": { "<mes>": { "si": <custo sell-in>, "so": <cogs sell-out> } },
      "cobertura": { "<mes>": <dias de estoque no ritmo de venda do mês> },
      "conversao": { "<mes>": <pedidos/views> },
      "scatter": [{ "a": "<asin>", "x": <views>, "y": <conversão %>, "r": <receita> }],
      "topAsins": [{ "a": "<asin>", "v": <receita> }]
    },

    "extras": { "cestaCompras": [], "termosBusca": [], "recompra": [] }   // reservado para Brand Analytics; hoje não populado por nenhum script
  }
}
```

Valores monetários chegam da SP-API como `{"amount": X, "currencyCode": "BRL"}`
— `transformar_vendor.py` já extrai só o `amount` (função `amount()`) em
todos os campos acima; no JSON final é sempre número puro em BRL.

O `dados_vendor.json` isolado por cliente (`clientes/<conta>/dados_vendor.json`)
tem o **mesmo formato**, mas com uma única chave (a da própria conta) —
ex.: `{"alfa_jf": { ... }}`.

## Estrutura de `scripts/`

| arquivo | o que faz | precisa de rede/API? |
|---|---|---|
| `contas_config.py` | config única das 7 contas (nome, pasta, secret, seller_id, marcas) | não |
| `sp_api_utils.py` | marketplace fixo (BR), autenticação manual, retry/backoff compartilhado | não |
| `capturar_mensal.py` | Vendas, Estoque, Tráfego, Margem (Reports API) | sim |
| `capturar_complementar.py` | Cupons, Promoções, Status de Pedidos, Buy Box, Brand Analytics | sim |
| `capturar_catalogo.py` | nome/imagem/BSR por ASIN (Catalog Items API) | sim |
| `capturar_qualidade_completa.py` | 5 componentes do índice de qualidade (Listings/Catalog/A+ Content API) | sim |
| `calcular_qualidade_catalogo.py` | calcula o índice de qualidade a partir do que `capturar_qualidade_completa.py` baixou | não (100% local) |
| `buscar_asins_por_marca.py` | lista completa de ASINs por marca (auxiliar, sob demanda) | sim |
| `transformar_vendor.py` | raw → `dados_vendor.json` | não (100% local) |
| `enriquecer_qualidade_cdq.py` | adiciona `score_geral_conta` e `acoes_pendentes` | não (100% local) |
| `publicar_github.py` | commit + push do `dados_vendor.json` (geral + isolados) | sim (git/GitHub) |

Todos os scripts de captura leem os refresh tokens e as credenciais LWA de
variáveis de ambiente (nunca de arquivo, nunca de argumento de linha de
comando) e escrevem em `dados_raw/<conta>/raw/` (configurável via
`VENDOR_DATA_DIR`).
