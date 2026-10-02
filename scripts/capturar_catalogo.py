"""
capturar_catalogo.py
======================
Captura nome do produto, marca, imagem principal e BSR (Best Sellers
Rank) via Catalog Items API, para preencher a coluna "produto" no
dashboard (sem isso, o dashboard mostra só o ASIN cru).

Fonte de ASINs, em ordem de preferência:
  1) asins_catalogo_completo.json (gerado por buscar_asins_por_marca.py) --
     lista completa, inclui ASINs sem venda/estoque no período.
  2) vendas_mes_*.json + estoque_mes_*.json -- fallback parcial, só pega
     ASINs que tiveram movimento no período já capturado.

Tem cache por ASIN -- rodar de novo sem problema, só busca o que falta ou
falhou antes (com retry/backoff em cota estourada).

Uso:
  python scripts/capturar_catalogo.py
  python scripts/capturar_catalogo.py --contas riomaster

Rodar DEPOIS da captura normal de vendas/estoque/tráfego/margem
(capturar_mensal.py) e ANTES de transformar_vendor.py.
"""

import argparse
import glob
import json
import os
import time

from contas_config import argparser_contas, credenciais_sp_api, pasta_raw, resolver_contas_cli
from sp_api_utils import MARKETPLACE, com_retry

try:
    from sp_api.api import CatalogItems
except ImportError:
    os.system("pip install -q python-amazon-sp-api")
    from sp_api.api import CatalogItems

INTERVALO = 0.6  # ~1,6 req/s -- mais conservador que os 5 req/s documentados


def asins_da_conta(pasta):
    caminho_completo = f"{pasta}/asins_catalogo_completo.json"
    if os.path.exists(caminho_completo):
        try:
            lista = json.load(open(caminho_completo, encoding="utf-8"))
            if lista:
                return set(lista)
        except Exception:
            pass  # cai no fallback abaixo se o arquivo estiver corrompido/vazio

    asins = set()
    for arq in glob.glob(f"{pasta}/vendas_mes_*.json"):
        try:
            d = json.load(open(arq))
        except Exception:
            continue
        for r in d.get("salesByAsin", []):
            a = r.get("asin")
            if a:
                asins.add(a)
    for arq in glob.glob(f"{pasta}/estoque_mes_*.json"):
        try:
            d = json.load(open(arq))
        except Exception:
            continue
        for r in d.get("inventoryByAsin", []):
            a = r.get("asin")
            if a:
                asins.add(a)
    return asins


def extrair_info(payload):
    """Extrai só o que interessa da resposta bruta da Catalog Items API."""
    info = {"nome": None, "marca": None, "imagem": None, "bsr": []}

    summaries = payload.get("summaries", [])
    if summaries:
        info["nome"] = summaries[0].get("itemName")
        info["marca"] = summaries[0].get("brand")

    images = payload.get("images", [])
    if images and images[0].get("images"):
        info["imagem"] = images[0]["images"][0].get("link")

    for sr in payload.get("salesRanks", []):
        for r in sr.get("ranks", []):
            info["bsr"].append({"categoria": r.get("title"), "rank": r.get("rank")})

    return info


def capturar_conta(chave, cfg, pasta):
    asins = asins_da_conta(pasta)
    print(f"\n=== {chave} — {len(asins)} ASINs únicos encontrados ===")
    if not asins:
        print("  nenhum ASIN encontrado (vendas_mes_*.json ausente?) — pulando")
        return

    caminho_saida = f"{pasta}/catalogo.json"
    catalogo = json.load(open(caminho_saida, encoding="utf-8")) if os.path.exists(caminho_saida) else {}
    if catalogo:
        print(f"  {len(catalogo)} já em cache de execução anterior")

    catalog_api = CatalogItems(credentials=credenciais_sp_api(chave), marketplace=MARKETPLACE)

    faltando = sorted(a for a in asins if a not in catalogo or catalogo[a].get("erro"))
    print(f"  {len(faltando)} a buscar agora (inclui falhas de execuções anteriores)")

    ok, falhas = 0, 0
    for i, asin in enumerate(faltando, 1):
        try:
            resp = com_retry(
                catalog_api.get_catalog_item,
                asin=asin, marketplaceIds=[MARKETPLACE.marketplace_id],
                includedData=["images", "salesRanks", "summaries"],
            )
            catalogo[asin] = extrair_info(resp.payload)
            ok += 1
        except Exception as e:
            erro_str = str(e)
            catalogo[asin] = {"nome": None, "marca": None, "imagem": None, "bsr": [], "erro": erro_str}
            falhas += 1
            if "NOT_FOUND" in erro_str:
                print(f"  [NOT_FOUND definitivo] {asin}")
            else:
                print(f"  [ERRO definitivo] {asin}: {erro_str[:80]}")
        if i % 20 == 0 or i == len(faltando):
            print(f"  [{i}/{len(faltando)}] ok={ok} falhas={falhas}")
            json.dump(catalogo, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        time.sleep(INTERVALO)

    json.dump(catalogo, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  Salvo: {caminho_saida} ({len(catalogo)} ASINs, {ok} novos ok, {falhas} falhas)")


def main():
    parser = argparser_contas(argparse.ArgumentParser(description=__doc__))
    contas = resolver_contas_cli(parser.parse_args().contas)

    for chave, cfg in contas.items():
        pasta = pasta_raw(chave)
        if not os.path.isdir(pasta):
            print(f'[aviso] pasta não encontrada para "{chave}": {pasta} — pulando (rode capturar_mensal.py antes)')
            continue
        capturar_conta(chave, cfg, pasta)

    print("\n\nConcluído. Rode o transformar_vendor.py em seguida.")


if __name__ == "__main__":
    main()
