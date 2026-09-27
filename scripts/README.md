# Scripts de coleta de dados (Amazon SP-API)

Objetivo: eliminar o fluxo Colab (falar no chat → rodar no Colab → puxar
resultado → voltar ao chat). Os scripts aqui rodam **direto no ambiente
do Claude**, geram os JSONs que o dashboard consome (`dados/*.json`,
`tempo_real/*.json`) e o commit/push para o GitHub é feito na mesma
conversa.

## Arquivos

| Arquivo | Papel |
|---|---|
| `config.py` | Lê e valida os secrets (`.env` local ou Secrets do GitHub Actions) |
| `sp_api_auth.py` | Troca o refresh token por um access token da SP-API |
| `test_conexao.py` | Valida secrets + autenticação, sem baixar dados |
| *(a vir)* `coletar_*.py` | Puxa os relatórios de Vendor por conta e gera os JSONs |

## Configuração dos secrets (passo que travou da última vez)

Os nomes de variável são sempre os mesmos, só muda **onde** ficam:

1. **Para eu rodar agora, nesta conversa:** você me passa os 3 valores
   (client id, client secret, refresh token) e eu crio o `.env` local
   nesta sessão — ele nunca é commitado (está no `.gitignore`).
2. **Para automação agendada (GitHub Actions), sem depender de chat aberto:**
   cadastre os mesmos nomes em *Settings → Secrets and variables →
   Actions* do repositório:
   - `SPAPI_LWA_CLIENT_ID`
   - `SPAPI_LWA_CLIENT_SECRET`
   - `SPAPI_REFRESH_TOKEN`
   - `SPAPI_MARKETPLACE_ID` (padrão Brasil: `A2Q3Y263D00KWC`)
   - `SPAPI_REGION` (padrão: `NA`)

Veja `.env.example` na raiz do repo para a lista completa comentada.

## Como testar

```bash
pip install -r requirements.txt
cp .env.example .env      # depois preencha os valores reais
python scripts/test_conexao.py
```

Saída esperada: `✅ Configuração e autenticação funcionando.`
Se algo faltar, o erro já diz exatamente qual variável está ausente ou
qual credencial está errada — não trava em silêncio.

## Próximo passo

Assim que a conexão estiver validada, entram os scripts de coleta
(`coletar_sellin.py`, `coletar_tempo_real.py` etc.) que chamam os
relatórios de Vendor (Retail Analytics / Sales) e escrevem nos formatos
que `dados/*.json` e `tempo_real/*.json` já usam hoje. Você vai enviar o
código atual do Colab para eu aproveitar a lógica de transformação.
