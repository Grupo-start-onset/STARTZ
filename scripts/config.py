"""
Carrega e valida a configuração da API da Amazon (SP-API).

Não importa de onde vêm os valores — variável de ambiente do sistema,
arquivo .env local, ou Secret do GitHub Actions — tudo chega aqui do
mesmo jeito, via os.environ. Isso é o que faz o mesmo script funcionar
tanto rodando na mão (chat) quanto agendado (GitHub Actions).

Há um client id/secret (o app) compartilhado entre todas as contas, e
um refresh token por conta (cada conta autorizou o app separadamente).

Uso:
    from config import load_config, load_contas
    cfg = load_config()               # client id/secret/marketplace/endpoint
    contas = load_contas()            # {"alfa_jf": ContaSPAPI(...), ...}
"""
from __future__ import annotations

import os
from dataclasses import dataclass

# Carrega um .env local se existir (não faz nada em produção/CI,
# onde as variáveis já vêm setadas pelo ambiente).
# override=True: o .env sempre vence sobre uma variável de ambiente já
# existente no shell. Sem isso, um export antigo/errado no ambiente
# fica "grudado" e o .env novo é ignorado silenciosamente.
try:
    from dotenv import load_dotenv

    load_dotenv(override=True)
except ImportError:
    pass

REGIOES = {
    "NA": "https://sellingpartnerapi-na.amazon.com",
    "EU": "https://sellingpartnerapi-eu.amazon.com",
    "FE": "https://sellingpartnerapi-fe.amazon.com",
}

# chave usada no repo (dados/*.json, tempo_real/*.json) -> sufixo da
# variável de ambiente SP_API_REFRESH_TOKEN_<sufixo>
CONTAS = {
    "alfa_jf": "ALFAJF",
    "blidshop": "BLIDSHOP",
    "conta3": "PETCLEAN",  # nome de exibição: "Petclean BR"
    "ozitp": "OZITP",
    "jolitex": "JOLITEX",
    "balboa": "BALBOA",
    "riomaster": "RIOMASTER",
}

_VARS_OBRIGATORIAS = ["SP_API_LWA_CLIENT_ID", "SP_API_LWA_CLIENT_SECRET"]


@dataclass(frozen=True)
class SPAPIConfig:
    lwa_client_id: str
    lwa_client_secret: str
    marketplace_id: str
    endpoint: str


@dataclass(frozen=True)
class ContaSPAPI:
    chave: str  # ex.: "alfa_jf"
    refresh_token: str


def load_config() -> SPAPIConfig:
    faltando = [v for v in _VARS_OBRIGATORIAS if not os.environ.get(v)]
    if faltando:
        raise RuntimeError(
            "Faltam variáveis de configuração da SP-API: "
            + ", ".join(faltando)
            + ".\nDefina-as no arquivo .env (veja .env.example) ou como "
            "Secrets do GitHub Actions com esses mesmos nomes."
        )

    regiao = os.environ.get("SP_API_REGION", "NA").upper()
    if regiao not in REGIOES:
        raise RuntimeError(
            f"SP_API_REGION inválida: '{regiao}'. Use uma de: {', '.join(REGIOES)}"
        )

    return SPAPIConfig(
        lwa_client_id=os.environ["SP_API_LWA_CLIENT_ID"],
        lwa_client_secret=os.environ["SP_API_LWA_CLIENT_SECRET"],
        marketplace_id=os.environ.get("SP_API_MARKETPLACE_ID", "A2Q3Y263D00KWC"),
        endpoint=REGIOES[regiao],
    )


def load_contas() -> dict[str, ContaSPAPI]:
    """Retorna só as contas cujo refresh token está configurado.
    As que faltarem ficam de fora (não levanta erro) — use
    `contas_faltando()` para saber quais são."""
    encontradas: dict[str, ContaSPAPI] = {}
    for chave, sufixo in CONTAS.items():
        token = os.environ.get(f"SP_API_REFRESH_TOKEN_{sufixo}")
        if token:
            encontradas[chave] = ContaSPAPI(chave=chave, refresh_token=token)
    return encontradas


def contas_faltando() -> list[str]:
    presentes = load_contas().keys()
    return [c for c in CONTAS if c not in presentes]
