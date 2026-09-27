"""
Carrega e valida a configuração da API da Amazon (SP-API).

Não importa de onde vêm os valores — variável de ambiente do sistema,
arquivo .env local, ou Secret do GitHub Actions — tudo chega aqui do
mesmo jeito, via os.environ. Isso é o que faz o mesmo script funcionar
tanto rodando na mão (chat) quanto agendado (GitHub Actions).

Uso:
    from config import load_config
    cfg = load_config()          # levanta erro claro se faltar algo
    print(cfg.marketplace_id)
"""
from __future__ import annotations

import os
from dataclasses import dataclass

# Carrega um .env local se existir (não faz nada em produção/CI,
# onde as variáveis já vêm setadas pelo ambiente).
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

REGIOES = {
    "NA": "https://sellingpartnerapi-na.amazon.com",
    "EU": "https://sellingpartnerapi-eu.amazon.com",
    "FE": "https://sellingpartnerapi-fe.amazon.com",
}

_VARS_OBRIGATORIAS = [
    "SPAPI_LWA_CLIENT_ID",
    "SPAPI_LWA_CLIENT_SECRET",
    "SPAPI_REFRESH_TOKEN",
    "SPAPI_MARKETPLACE_ID",
]


@dataclass(frozen=True)
class SPAPIConfig:
    lwa_client_id: str
    lwa_client_secret: str
    refresh_token: str
    marketplace_id: str
    endpoint: str


def load_config() -> SPAPIConfig:
    faltando = [v for v in _VARS_OBRIGATORIAS if not os.environ.get(v)]
    if faltando:
        raise RuntimeError(
            "Faltam variáveis de configuração da SP-API: "
            + ", ".join(faltando)
            + ".\nDefina-as no arquivo .env (veja .env.example) ou como "
            "Secrets do GitHub Actions com esses mesmos nomes."
        )

    regiao = os.environ.get("SPAPI_REGION", "NA").upper()
    if regiao not in REGIOES:
        raise RuntimeError(
            f"SPAPI_REGION inválida: '{regiao}'. Use uma de: {', '.join(REGIOES)}"
        )

    return SPAPIConfig(
        lwa_client_id=os.environ["SPAPI_LWA_CLIENT_ID"],
        lwa_client_secret=os.environ["SPAPI_LWA_CLIENT_SECRET"],
        refresh_token=os.environ["SPAPI_REFRESH_TOKEN"],
        marketplace_id=os.environ["SPAPI_MARKETPLACE_ID"],
        endpoint=REGIOES[regiao],
    )
