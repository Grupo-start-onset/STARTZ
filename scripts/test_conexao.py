"""
Teste isolado de configuração + autenticação da SP-API.

Não baixa nenhum dado de vendas — só confirma que os secrets estão
corretos e que dá para trocar o refresh token por um access token.
Rode este script sempre que configurar/trocar secrets, antes de partir
para os scripts de coleta de dados.

Uso:
    python scripts/test_conexao.py
"""
from __future__ import annotations

import sys

from config import load_config
from sp_api_auth import get_access_token


def main() -> int:
    print("1/2 - Lendo configuração (.env / variáveis de ambiente)...")
    try:
        cfg = load_config()
    except RuntimeError as e:
        print(f"❌ {e}")
        return 1
    print(f"    OK - marketplace={cfg.marketplace_id} endpoint={cfg.endpoint}")

    print("2/2 - Autenticando na SP-API (LWA)...")
    try:
        token = get_access_token(cfg)
    except RuntimeError as e:
        print(f"❌ {e}")
        return 1
    print(f"    OK - access_token obtido (início: {token[:12]}...)")

    print("\n✅ Configuração e autenticação funcionando.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
