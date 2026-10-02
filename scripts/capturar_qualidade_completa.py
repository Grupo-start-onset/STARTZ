"""
capturar_qualidade_completa.py
================================
Captura os 5 componentes usados no cálculo do Índice de Qualidade de
Catálogo (aproximação própria do CDQ): listings_issues, listings_attributes,
imagens_completas, relationships, aplus_content_massa.

Cada componente tem cache incremental por ASIN (rodar de novo só busca o
que falta ou falhou antes).

Uso:
  python scripts/capturar_qualidade_completa.py
  python scripts/capturar_qualidade_completa.py --contas riomaster

Rodar DEPOIS de capturar_mensal.py (usa vendas_mes_*.json e
status_pedidos_*.json já baixados) e ANTES de calcular_qualidade_catalogo.py.
"""

import argparse
import glob
import json
import os
import time

from contas_config import argparser_contas, credenciais_sp_api, pasta_raw, resolver_contas_cli, CONTAS
from sp_api_utils import MARKETPLACE, MARKETPLACE_ID_BR, com_retry, obter_access_token, headers_access_token, SPAPI_ENDPOINT

try:
    from sp_api.api import ListingsItems, CatalogItems, AplusContent
except ImportError:
    os.system("pip install -q python-amazon-sp-api")
    from sp_api.api import ListingsItems, CatalogItems, AplusContent

import requests


# ---------------------------------------------------------------------------
# Bypass manual para o campo "relationships" da Catalog Items API.
#
# BUG CONHECIDO: a biblioteca python-amazon-sp-api rejeita
# includedData=['relationships'] com InvalidInput mesmo sendo um parâmetro
# válido — confirmado comparando chamada via biblioteca (falha sempre) vs.
# chamada manual via requests direto no endpoint (funciona, HTTP 200).
# Outros campos (images, summaries, attributes, issues) funcionam
# normalmente pela biblioteca; SÓ relationships precisa desse contorno.
# ---------------------------------------------------------------------------

def buscar_relationships_manual(access_token, asin):
    url = f"{SPAPI_ENDPOINT}/catalog/2022-04-01/items/{asin}"
    params = {"marketplaceIds": MARKETPLACE_ID_BR, "includedData": "relationships"}
    resp = requests.get(url, params=params, headers=headers_access_token(access_token), timeout=30)
    resp.raise_for_status()
    return resp.json()


def asins_da_conta(pasta):
    """Combina vendas_mes_*.json (ASINs com venda) com
    asins_catalogo_completo.json (catálogo completo, se existir)."""
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

    caminho_completo = f"{pasta}/asins_catalogo_completo.json"
    if os.path.exists(caminho_completo):
        try:
            asins |= set(json.load(open(caminho_completo, encoding="utf-8")))
        except Exception as e:
            print(f"  [aviso] falha ao ler asins_catalogo_completo.json: {e}")

    return asins


def descobrir_seller_id(pasta, chave):
    """Lê qualquer status_pedidos_*.json existente e extrai o partyId de
    sellingParty — é o vendorCode/sellerId dessa conta. Se não encontrar
    (arquivo ausente ou sem pedido no período), cai no seller_id manual
    configurado em contas_config.CONTAS."""
    for arq in glob.glob(f"{pasta}/status_pedidos_*.json"):
        try:
            d = json.load(open(arq))
            for po in d.get("payload", {}).get("ordersStatus", []):
                party_id = po.get("sellingParty", {}).get("partyId")
                if party_id:
                    return party_id
        except Exception:
            continue
    return CONTAS[chave].get("seller_id")


# ---------------------------------------------------------------------------
# 1. listings_issues.json — issues, procurement, summaries (Listings Items API)
# ---------------------------------------------------------------------------

def _extrair_info_issues(payload):
    itens = payload.get("items", [])
    if not itens:
        return {"encontrado": False}
    item = itens[0]
    summary = (item.get("summaries") or [{}])[0]
    return {
        "encontrado": True, "sku": item.get("sku"), "status": summary.get("status"),
        "itemName": summary.get("itemName"), "issues": item.get("issues", []),
        "procurement": item.get("procurement", []),
    }


def capturar_conta_issues(chave, cfg, pasta, seller_id):
    asins = asins_da_conta(pasta)
    print(f"  {len(asins)} ASINs únicos encontrados")
    if not asins:
        return

    caminho_saida = f"{pasta}/listings_issues.json"
    resultado = json.load(open(caminho_saida, encoding="utf-8")) if os.path.exists(caminho_saida) else {}
    if resultado:
        print(f"  {len(resultado)} já em cache de execução anterior")

    api = ListingsItems(credentials=credenciais_sp_api(chave), marketplace=MARKETPLACE)
    faltando = sorted(a for a in asins if a not in resultado)
    print(f"  {len(faltando)} a buscar agora")

    ok, falhas, com_issue = 0, 0, 0
    for i, asin in enumerate(faltando, 1):
        try:
            resp = com_retry(
                api.search_listings_items,
                sellerId=seller_id, marketplaceIds=[MARKETPLACE_ID_BR],
                identifiers=[asin], identifiersType="ASIN",
                includedData=["issues", "summaries", "procurement"],
            )
            info = _extrair_info_issues(resp.payload)
            resultado[asin] = info
            ok += 1
            if info.get("issues"):
                com_issue += 1
            if i % 20 == 0 or i == len(faltando):
                print(f"  [{i}/{len(faltando)}] ok={ok} falhas={falhas} com_issue={com_issue}")
                json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        except Exception as e:
            falhas += 1
            resultado[asin] = {"encontrado": False, "erro": str(e)}
            print(f"  [ERRO] {asin}: {e}")
        time.sleep(0.25)  # 4 req/s -- sob o limite documentado de 5 req/s

    json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  Salvo: {caminho_saida}")
    print(f"  TOTAL {chave}: {len(resultado)} ASINs, {ok} novos ok, {falhas} falhas, {com_issue} com issue")


# ---------------------------------------------------------------------------
# 2. listings_attributes.json — attributes completo + bullet_point
# ---------------------------------------------------------------------------

def _extrair_info_attributes(payload):
    itens = payload.get("items", [])
    if not itens:
        return {"encontrado": False}
    item = itens[0]
    attrs = item.get("attributes", {})
    return {
        "encontrado": True, "sku": item.get("sku"),
        "bullet_points": [b.get("value") for b in attrs.get("bullet_point", [])],
        "attributes": attrs,
    }


def capturar_conta_attributes(chave, cfg, pasta, seller_id):
    asins = asins_da_conta(pasta)
    print(f"  {len(asins)} ASINs únicos encontrados")
    if not asins:
        return

    caminho_saida = f"{pasta}/listings_attributes.json"
    resultado = json.load(open(caminho_saida, encoding="utf-8")) if os.path.exists(caminho_saida) else {}
    if resultado:
        print(f"  {len(resultado)} já em cache de execução anterior")

    api = ListingsItems(credentials=credenciais_sp_api(chave), marketplace=MARKETPLACE)
    faltando = sorted(a for a in asins if a not in resultado)
    print(f"  {len(faltando)} a buscar agora")

    ok, falhas, sem_bullets = 0, 0, 0
    for i, asin in enumerate(faltando, 1):
        try:
            resp = com_retry(
                api.search_listings_items,
                sellerId=seller_id, marketplaceIds=[MARKETPLACE_ID_BR],
                identifiers=[asin], identifiersType="ASIN",
                includedData=["attributes", "summaries"],
            )
            info = _extrair_info_attributes(resp.payload)
            resultado[asin] = info
            ok += 1
            if not info.get("bullet_points"):
                sem_bullets += 1
            if i % 20 == 0 or i == len(faltando):
                print(f"  [{i}/{len(faltando)}] ok={ok} falhas={falhas} sem_bullets={sem_bullets}")
                json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        except Exception as e:
            falhas += 1
            resultado[asin] = {"encontrado": False, "erro": str(e)}
            print(f"  [ERRO] {asin}: {e}")
        time.sleep(0.25)

    json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  Salvo: {caminho_saida}")
    print(f"  TOTAL {chave}: {len(resultado)} ASINs, {ok} novos ok, {falhas} falhas, {sem_bullets} sem bullet points")


# ---------------------------------------------------------------------------
# 3. imagens_completas.json — lista completa de imagens (Catalog Items API)
# ---------------------------------------------------------------------------

def capturar_conta_imagens(chave, cfg, pasta, seller_id):
    asins = asins_da_conta(pasta)
    print(f"  {len(asins)} ASINs únicos encontrados")
    if not asins:
        return

    caminho_saida = f"{pasta}/imagens_completas.json"
    resultado = json.load(open(caminho_saida, encoding="utf-8")) if os.path.exists(caminho_saida) else {}
    if resultado:
        print(f"  {len(resultado)} já em cache de execução anterior")

    catalog_api = CatalogItems(credentials=credenciais_sp_api(chave), marketplace=MARKETPLACE)
    faltando = sorted(a for a in asins if a not in resultado)
    print(f"  {len(faltando)} a buscar agora")

    ok, falhas, menos_de_4 = 0, 0, 0
    for i, asin in enumerate(faltando, 1):
        try:
            resp = com_retry(
                catalog_api.get_catalog_item,
                asin=asin, marketplaceIds=[MARKETPLACE_ID_BR], includedData=["images"],
            )
            imagens_por_mkt = resp.payload.get("images", [])
            lista_imagens = imagens_por_mkt[0].get("images", []) if imagens_por_mkt else []
            resultado[asin] = lista_imagens
            ok += 1
            if len(lista_imagens) < 4:
                menos_de_4 += 1
            if i % 20 == 0 or i == len(faltando):
                print(f"  [{i}/{len(faltando)}] ok={ok} falhas={falhas} com_menos_de_4_imagens={menos_de_4}")
                json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        except Exception as e:
            falhas += 1
            resultado[asin] = {"erro": str(e)}
            print(f"  [ERRO] {asin}: {e}")
        time.sleep(0.6)  # ~1.6 req/s -- limite conservador, igual ao relationships

    json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  Salvo: {caminho_saida}")
    print(f"  TOTAL {chave}: {len(resultado)} ASINs, {ok} novos ok, {falhas} falhas, {menos_de_4} com menos de 4 imagens")


# ---------------------------------------------------------------------------
# 4. relationships.json — família de variações (Catalog Items API)
# ---------------------------------------------------------------------------

def capturar_conta_relationships(chave, cfg, pasta, seller_id):
    asins = asins_da_conta(pasta)
    print(f"  {len(asins)} ASINs únicos encontrados")
    if not asins:
        return

    caminho_saida = f"{pasta}/relationships.json"
    resultado = json.load(open(caminho_saida, encoding="utf-8")) if os.path.exists(caminho_saida) else {}
    if resultado:
        print(f"  {len(resultado)} já em cache de execução anterior")

    # reprocessa também os que falharam antes por causa do bug da biblioteca
    faltando = sorted(a for a in asins if a not in resultado or resultado[a].get("erro"))
    print(f"  {len(faltando)} a buscar agora (inclui falhas de execuções anteriores)")
    if not faltando:
        return

    access_token = obter_access_token(chave)
    token_obtido_em = time.time()

    ok, falhas, com_variacao = 0, 0, 0
    for i, asin in enumerate(faltando, 1):
        # access_token expira em ~1h -- renova por segurança a cada 50min
        if time.time() - token_obtido_em > 50 * 60:
            access_token = obter_access_token(chave)
            token_obtido_em = time.time()
        try:
            payload = com_retry(buscar_relationships_manual, access_token, asin)
            relationships = payload.get("relationships", [])
            resultado[asin] = {"relationships": relationships}
            ok += 1
            if relationships:
                com_variacao += 1
            if i % 20 == 0 or i == len(faltando):
                print(f"  [{i}/{len(faltando)}] ok={ok} falhas={falhas} com_variacao={com_variacao}")
                json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        except Exception as e:
            falhas += 1
            resultado[asin] = {"relationships": None, "erro": str(e)}
            print(f"  [ERRO] {asin}: {e}")
        time.sleep(0.6)  # ~1,6 req/s -- limite doc da Catalog Items API é 2 req/s

    json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  Salvo: {caminho_saida}")
    print(f"  TOTAL {chave}: {len(resultado)} ASINs, {ok} novos ok, {falhas} falhas, {com_variacao} com variação")


# ---------------------------------------------------------------------------
# 5. aplus_content_massa.json — A+ Content da própria conta Vendor
# ---------------------------------------------------------------------------

def _listar_todos_documentos(api):
    documentos, page_token = [], None
    while True:
        kwargs = dict(marketplaceId=MARKETPLACE_ID_BR)
        if page_token:
            kwargs["pageToken"] = page_token
        resp = com_retry(api.search_content_documents, **kwargs)
        payload = resp.payload
        documentos.extend(payload.get("contentMetadataRecords", []))
        page_token = payload.get("nextPageToken")
        time.sleep(0.15)
        if not page_token:
            break
    return documentos


def _listar_asins_do_documento(api, content_reference_key):
    asins, page_token = [], None
    while True:
        kwargs = dict(contentReferenceKey=content_reference_key, marketplaceId=MARKETPLACE_ID_BR)
        if page_token:
            kwargs["pageToken"] = page_token
        resp = com_retry(api.list_content_document_asin_relations, **kwargs)
        payload = resp.payload
        for item in payload.get("asinMetadataSet", []):
            a = item.get("asin")
            if a:
                asins.append(a)
        page_token = payload.get("nextPageToken")
        time.sleep(0.15)
        if not page_token:
            break
    return asins


def capturar_conta_aplus(chave, cfg, pasta, seller_id):
    api = AplusContent(credentials=credenciais_sp_api(chave), marketplace=MARKETPLACE)

    try:
        documentos_raw = _listar_todos_documentos(api)
    except Exception as e:
        print(f"  [ERRO ao listar documentos] {e}")
        return

    print(f"  {len(documentos_raw)} documento(s) A+ encontrado(s)")

    documentos = []
    asins_com_aplus = set()
    for doc in documentos_raw:
        key = doc.get("contentReferenceKey")
        meta = doc.get("contentMetadata", {})
        try:
            asins = _listar_asins_do_documento(api, key)
        except Exception as e:
            print(f"  [ERRO ao buscar ASINs do documento {key}] {e}")
            asins = []
        documentos.append({
            "contentReferenceKey": key, "name": meta.get("name"), "status": meta.get("status"),
            "badgeSet": meta.get("badgeSet"), "updateTime": meta.get("updateTime"), "asins": asins,
        })
        asins_com_aplus |= set(asins)
        print(f'    "{meta.get("name")}" (status={meta.get("status")}) -> {len(asins)} ASIN(s)')

    resultado = {"documentos": documentos, "asins_com_aplus": sorted(asins_com_aplus)}
    caminho_saida = f"{pasta}/aplus_content_massa.json"
    json.dump(resultado, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  Salvo: {caminho_saida}")
    print(f"  TOTAL {chave}: {len(documentos)} documento(s), {len(asins_com_aplus)} ASIN(s) único(s) com A+ vinculado")


# ---------------------------------------------------------------------------
# Orquestração — roda os 5 componentes, em sequência, para as contas escolhidas
# ---------------------------------------------------------------------------

ETAPAS = [
    ("1/5 — LISTINGS ISSUES", capturar_conta_issues, True),       # precisa de seller_id
    ("2/5 — LISTINGS ATTRIBUTES", capturar_conta_attributes, True),
    ("3/5 — IMAGENS COMPLETAS", capturar_conta_imagens, False),
    ("4/5 — RELATIONSHIPS", capturar_conta_relationships, False),
    ("5/5 — A+ CONTENT EM MASSA", capturar_conta_aplus, False),
]


def main():
    parser = argparser_contas(argparse.ArgumentParser(description=__doc__))
    contas = resolver_contas_cli(parser.parse_args().contas)

    for titulo, funcao, precisa_seller_id in ETAPAS:
        print(f"\n\n{'#' * 65}\n# {titulo}\n{'#' * 65}")
        for chave, cfg in contas.items():
            pasta = pasta_raw(chave)
            if not os.path.isdir(pasta):
                print(f'[aviso] pasta não encontrada para "{chave}": {pasta} — pulando (rode capturar_mensal.py antes)')
                continue

            print(f'\n=== {chave} ===')
            seller_id = None
            if precisa_seller_id:
                seller_id = descobrir_seller_id(pasta, chave)
                if not seller_id:
                    print(f'[aviso] não encontrei sellerId (vendorCode) pra "{chave}" — '
                          f'preciso de pelo menos 1 status_pedidos_*.json na pasta, ou de '
                          f'"seller_id" preenchido em contas_config.CONTAS. Pulando.')
                    continue
                print(f"  sellerId (vendorCode): {seller_id}")

            funcao(chave, cfg, pasta, seller_id)

    print("\n\nConcluído. Próximo passo: rodar calcular_qualidade_catalogo.py")
    print("pra gerar o qualidade_catalogo.json de cada conta a partir destes 5 arquivos.")


if __name__ == "__main__":
    main()
