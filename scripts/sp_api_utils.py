"""
sp_api_utils.py
================
Helpers compartilhados pelos scripts de captura: marketplace fixo (Brasil),
autenticação manual (para as chamadas que usam requests direto, fora da
biblioteca python-amazon-sp-api) e retry com backoff pra falha de cota
(QuotaExceeded / throttling), que é o "problema conhecido" de captura
parcial (já aconteceu com a Petclean) — antes só existia num script
(capturar_catalogo.py); agora é uma função só, usada em todos.
"""

import time

import requests

from contas_config import credenciais_lwa, refresh_token

try:
    from sp_api.base import Marketplaces

    MARKETPLACE = Marketplaces.BR
except ImportError:  # biblioteca ainda não instalada — ver requirements.txt
    MARKETPLACE = None

MARKETPLACE_ID_BR = "A2Q3Y263D00KWC"
LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
SPAPI_ENDPOINT = "https://sellingpartnerapi-na.amazon.com"

# Textos que aparecem em erros transitórios (cota estourada, throttling,
# instabilidade momentânea do lado da Amazon) — vale tentar de novo depois
# de esperar. Qualquer outro erro (ex.: NOT_FOUND, InvalidInput) é definitivo
# e não deve ser re-tentado.
ERROS_TRANSITORIOS = ("QuotaExceeded", "Throttl", "429", "503", "Timeout", "ConnectionError")


def com_retry(func, *args, max_tentativas=5, espera_base=10, **kwargs):
    """Chama func(*args, **kwargs); se falhar com um erro que parece
    transitório (cota/throttling), espera com backoff crescente
    (espera_base * tentativa segundos) e tenta de novo. Erros permanentes
    (ex.: NOT_FOUND) são relançados na primeira tentativa."""
    ultimo_erro = None
    for tentativa in range(1, max_tentativas + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            ultimo_erro = e
            texto = str(e)
            transitorio = any(s in texto for s in ERROS_TRANSITORIOS)
            if not transitorio or tentativa == max_tentativas:
                raise
            espera = espera_base * tentativa
            print(f"    [retry {tentativa}/{max_tentativas}] {texto[:150]} — aguardando {espera}s")
            time.sleep(espera)
    raise ultimo_erro  # nunca deveria chegar aqui


def obter_access_token(chave):
    """Autentica manualmente (fora da biblioteca) — usado pelas chamadas
    feitas via requests direto (ex.: relationships da Catalog Items API,
    que tem bug conhecido na biblioteca; e capturar_complementar.py, que é
    100% requests)."""
    client_id, client_secret = credenciais_lwa()
    resp = requests.post(
        LWA_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token(chave),
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def headers_access_token(token):
    return {"x-amz-access-token": token, "content-type": "application/json"}
