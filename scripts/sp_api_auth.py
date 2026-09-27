"""
Autenticação com a Amazon SP-API via LWA (Login With Amazon).

Desde 2023 a SP-API não exige mais assinatura AWS SigV4 para a
maioria das operações (incluindo os relatórios de Vendor usados aqui):
basta trocar o refresh token por um access token de curta duração (1h)
e mandar esse token no header 'x-amz-access-token' de cada chamada.

Uso:
    from config import load_config
    from sp_api_auth import get_access_token

    cfg = load_config()
    token = get_access_token(cfg)
"""
from __future__ import annotations

import time

import requests

from config import SPAPIConfig

_TOKEN_URL = "https://api.amazon.com/auth/o2/token"

# cache simples em memória (evita pedir um token novo a cada chamada
# dentro da mesma execução do script)
_cache: dict[str, tuple[str, float]] = {}


def get_access_token(cfg: SPAPIConfig) -> str:
    cache_key = cfg.refresh_token
    cached = _cache.get(cache_key)
    if cached and cached[1] > time.time():
        return cached[0]

    resp = requests.post(
        _TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": cfg.refresh_token,
            "client_id": cfg.lwa_client_id,
            "client_secret": cfg.lwa_client_secret,
        },
        timeout=30,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            "Falha ao autenticar na SP-API "
            f"(HTTP {resp.status_code}): {resp.text}\n"
            "Verifique SPAPI_LWA_CLIENT_ID, SPAPI_LWA_CLIENT_SECRET e "
            "SPAPI_REFRESH_TOKEN."
        )

    dados = resp.json()
    token = dados["access_token"]
    expira_em = time.time() + dados.get("expires_in", 3600) - 60  # margem de 60s
    _cache[cache_key] = (token, expira_em)
    return token
