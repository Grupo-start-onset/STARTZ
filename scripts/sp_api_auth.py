"""
Autenticação com a Amazon SP-API via LWA (Login With Amazon).

Desde 2023 a SP-API não exige mais assinatura AWS SigV4 para a
maioria das operações (incluindo os relatórios de Vendor usados aqui):
basta trocar o refresh token por um access token de curta duração (1h)
e mandar esse token no header 'x-amz-access-token' de cada chamada.

Cada conta (alfa_jf, balboa, ...) tem seu próprio refresh token, mas
todas compartilham o mesmo client id/secret (o app cadastrado na
Amazon). Por isso o token de acesso é pedido por conta.

Uso:
    from config import load_config, load_contas
    from sp_api_auth import get_access_token

    cfg = load_config()
    contas = load_contas()
    token = get_access_token(cfg, contas["alfa_jf"].refresh_token)
"""
from __future__ import annotations

import time

import requests

from config import SPAPIConfig

_TOKEN_URL = "https://api.amazon.com/auth/o2/token"

# cache simples em memória, por refresh token (evita pedir um token
# novo a cada chamada dentro da mesma execução do script)
_cache: dict[str, tuple[str, float]] = {}


def get_access_token(cfg: SPAPIConfig, refresh_token: str) -> str:
    cached = _cache.get(refresh_token)
    if cached and cached[1] > time.time():
        return cached[0]

    resp = requests.post(
        _TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": cfg.lwa_client_id,
            "client_secret": cfg.lwa_client_secret,
        },
        timeout=30,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            "Falha ao autenticar na SP-API "
            f"(HTTP {resp.status_code}): {resp.text}\n"
            "Verifique SP_API_LWA_CLIENT_ID, SP_API_LWA_CLIENT_SECRET e "
            "o refresh token dessa conta."
        )

    dados = resp.json()
    token = dados["access_token"]
    expira_em = time.time() + dados.get("expires_in", 3600) - 60  # margem de 60s
    _cache[refresh_token] = (token, expira_em)
    return token
