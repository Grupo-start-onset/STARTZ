"""
Teste isolado de configuração + autenticação da SP-API, para todas as
contas configuradas.

Não baixa nenhum dado de vendas — só confirma que os secrets estão
corretos e que dá para trocar cada refresh token por um access token.
Rode este script sempre que configurar/trocar secrets, antes de partir
para os scripts de coleta de dados.

Uso:
    python scripts/test_conexao.py
"""
from __future__ import annotations

import sys

from config import CONTAS, contas_faltando, load_config, load_contas
from sp_api_auth import get_access_token


def main() -> int:
    print("1/2 - Lendo configuração compartilhada (client id/secret)...")
    try:
        cfg = load_config()
    except RuntimeError as e:
        print(f"❌ {e}")
        return 1
    print(f"    OK - marketplace={cfg.marketplace_id} endpoint={cfg.endpoint}")

    contas = load_contas()
    faltando = contas_faltando()
    if not contas:
        print(
            "❌ Nenhuma conta configurada. Defina ao menos uma "
            "SP_API_REFRESH_TOKEN_<CONTA> (veja .env.example)."
        )
        return 1

    print(f"\n2/2 - Autenticando {len(contas)}/{len(CONTAS)} conta(s) configurada(s)...")
    ok, falhas = [], []
    for chave, conta in contas.items():
        try:
            token = get_access_token(cfg, conta.refresh_token)
            print(f"    ✅ {chave} - access_token obtido (início: {token[:12]}...)")
            ok.append(chave)
        except RuntimeError as e:
            print(f"    ❌ {chave} - {e}")
            falhas.append(chave)

    print()
    if faltando:
        print(f"⚠️  Sem refresh token configurado ainda: {', '.join(faltando)}")
    if falhas:
        print(f"❌ Falharam na autenticação: {', '.join(falhas)}")
    if ok and not falhas:
        print(f"✅ {len(ok)} conta(s) autenticada(s) com sucesso: {', '.join(ok)}")

    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
