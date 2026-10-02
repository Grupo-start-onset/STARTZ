"""
buscar_asins_por_marca.py
===========================
Script AUXILIAR — não faz parte do ciclo mensal recorrente. Roda por
demanda (conta nova, ou quando o número de ASINs parecer incompleto)
para obter a lista COMPLETA de ASINs cadastrados na conta na Amazon
(searchCatalogItems por marca), incluindo os que nunca venderam/tiveram
estoque no período capturado por capturar_mensal.py.

IMPORTANTE: edite contas_config.CONTAS[<conta>]['marcas'] antes de rodar
para uma conta nova, com o nome da marca EXATAMENTE como aparece no campo
"Marca" da ficha de produto na Amazon (não é o nome da empresa).

LIMITAÇÃO CONHECIDA: brandNames sozinho não é aceito pela API -- precisa
vir junto com "keywords" (o parâmetro principal de busca). Isso significa
que a busca não é "me dá tudo dessa marca", é "busca por essa palavra-
chave, filtrando pra essa marca" -- pode não ser 100% exaustiva se algum
produto não tiver o nome da marca em campo buscável (foi o caso da
Balboa: só achou 91 de 445 produtos reais). Se o número não bater com o
Vendor Central, use o sellerId da conta diretamente com a Listings Items
API (script ad-hoc, não incluído aqui — ver histórico do notebook Colab,
célula "TESTE/PRODUCAO — searchListingsItems por sellerId").

Salva em: dados_raw/<conta>/raw/asins_catalogo_completo.json
(capturar_catalogo.py e capturar_qualidade_completa.py usam esse arquivo
como fonte adicional de ASINs, se existir)

Uso:
  python scripts/buscar_asins_por_marca.py
  python scripts/buscar_asins_por_marca.py --contas riomaster
"""

import argparse
import json
import os
import time

from contas_config import CONTAS, argparser_contas, credenciais_sp_api, pasta_raw, resolver_contas_cli
from sp_api_utils import MARKETPLACE, com_retry

try:
    from sp_api.api import CatalogItems
except ImportError:
    os.system("pip install -q python-amazon-sp-api")
    from sp_api.api import CatalogItems

INTERVALO = 0.6  # ~1,6 req/s, sob o limite de 2 req/s (burst 2) documentado


def buscar_por_marca(catalog_api, marca):
    asins = set()
    page_token = None
    pagina = 1
    MAX_PAGINAS = 105  # segurança -- doc confirma máx 1000 ASINs retornáveis via paginação
    while pagina <= MAX_PAGINAS:
        try:
            kwargs = dict(
                marketplaceIds=[MARKETPLACE.marketplace_id],
                keywords=[marca],  # obrigatório -- brandNames sozinho não é aceito
                brandNames=[marca],  # funciona como filtro sobre a busca por keywords
                # SEM pageSize -- bug conhecido da Amazon (GitHub issues #2789, #2377,
                # #2999): se pageSize é informado (mesmo =20), o nextToken some da
                # resposta mesmo tendo mais páginas. Sem esse parâmetro, usa o
                # padrão (10 por página) e a paginação volta a funcionar.
            )
            if page_token:
                kwargs["pageToken"] = page_token
            resp = com_retry(catalog_api.search_catalog_items, **kwargs)
        except Exception as e:
            print(f'    [ERRO] marca "{marca}", página {pagina}: {e}')
            break

        payload = resp.payload
        itens = payload.get("items", [])
        for it in itens:
            a = it.get("asin")
            if a:
                asins.add(a)

        total_estimado = payload.get("numberOfResults")
        print(f"    página {pagina}: +{len(itens)} ASINs (total estimado na busca: {total_estimado})")

        page_token = getattr(resp, "next_token", None)
        pagina += 1
        if not page_token:
            break
        time.sleep(INTERVALO)

    return asins


def processar_conta(chave, cfg, pasta):
    marcas = cfg.get("marcas") or []
    if not marcas:
        print(f"\n=== {chave} — sem marca configurada em contas_config.CONTAS, pulando ===")
        return

    print(f"\n=== {chave} — buscando marcas: {marcas} ===")
    catalog_api = CatalogItems(credentials=credenciais_sp_api(chave), marketplace=MARKETPLACE)

    todos_asins = set()
    for marca in marcas:
        print(f'  Marca "{marca}":')
        asins = buscar_por_marca(catalog_api, marca)
        print(f'  -> {len(asins)} ASINs únicos encontrados para "{marca}"')
        todos_asins |= asins

    os.makedirs(pasta, exist_ok=True)
    caminho = f"{pasta}/asins_catalogo_completo.json"
    json.dump(sorted(todos_asins), open(caminho, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  TOTAL {chave}: {len(todos_asins)} ASINs únicos -> salvo em {caminho}")
    print("  (compare esse número com o que você viu no Vendor Central)")


def main():
    parser = argparser_contas(argparse.ArgumentParser(description=__doc__))
    contas = resolver_contas_cli(parser.parse_args().contas)

    for chave, cfg in contas.items():
        processar_conta(chave, cfg, pasta_raw(chave))

    print("\n\nConcluído. Se o número bateu com o Vendor Central, rode o")
    print("capturar_catalogo.py de novo -- ele vai passar a usar essa lista")
    print("completa em vez de só vendas+estoque.")


if __name__ == "__main__":
    main()
