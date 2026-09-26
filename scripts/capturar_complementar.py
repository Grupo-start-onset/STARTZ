"""
capturar_complementar.py
=========================
Cupons · Promoções · Status de Pedidos · Buy Box · Brand Analytics
(Cesta de compras, Termos de busca, Recompra).

Roda via requests direto (sem a biblioteca python-amazon-sp-api), pros
endpoints que ela não cobre bem. Cobre as 7 contas — antes ficava
desatualizado a cada conta nova (a versão do notebook chegou a ficar sem
Jolitex/Balboa/Rio Master por um tempo); agora usa contas_config.py.

Uso:
  python scripts/capturar_complementar.py
  python scripts/capturar_complementar.py --contas riomaster

Rodar depois de capturar_mensal.py (Buy Box usa os ASINs de vendas_mes_*.json
já baixados) e antes de transformar_vendor.py.
"""

import argparse
import glob
import gzip
import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests

from contas_config import argparser_contas, pasta_raw, resolver_contas_cli
from sp_api_utils import MARKETPLACE_ID_BR, SPAPI_ENDPOINT, com_retry, headers_access_token, obter_access_token


# --------------------------------------------------------------
# HELPER GENÉRICO DE REPORTS API (Brand Analytics + Performance)
# --------------------------------------------------------------
def _criar_relatorio(token, report_type, data_ini, data_fim, report_options):
    body = {
        "reportType": report_type,
        "marketplaceIds": [MARKETPLACE_ID_BR],
        "dataStartTime": data_ini.strftime("%Y-%m-%dT00:00:00Z"),
        "dataEndTime": data_fim.strftime("%Y-%m-%dT23:59:59Z"),
    }
    if report_options:
        body["reportOptions"] = report_options
    r = requests.post(f"{SPAPI_ENDPOINT}/reports/2021-06-30/reports", headers=headers_access_token(token), json=body)
    if r.status_code == 429 or r.status_code == 503:
        raise RuntimeError(f"QuotaExceeded/Throttling ao criar {report_type}: {r.status_code} {r.text[:200]}")
    if r.status_code != 202:
        print(f"    [FALHOU AO CRIAR] {report_type}: {r.status_code} {r.text[:400]}")
        return None
    return r.json()["reportId"]


def gerar_relatorio(token, report_type, data_ini, data_fim, report_options=None, minutos_espera=15):
    try:
        report_id = com_retry(_criar_relatorio, token, report_type, data_ini, data_fim, report_options)
    except Exception as e:
        print(f"    [FALHOU AO CRIAR] {report_type}: {e}")
        return None
    if report_id is None:
        return None
    print(f"    report_id={report_id}")

    doc_id, status = None, None
    tentativas = (minutos_espera * 60) // 10
    for _ in range(tentativas):
        time.sleep(10)
        r2 = requests.get(f"{SPAPI_ENDPOINT}/reports/2021-06-30/reports/{report_id}", headers=headers_access_token(token))
        resp = r2.json()
        status = resp.get("processingStatus")
        if status in ("DONE", "FATAL", "CANCELLED"):
            doc_id = resp.get("reportDocumentId")
            break
    else:
        print(f"    [PENDENTE] {report_type} ainda em fila. report_id={report_id} — pode consultar depois.")
        return None

    if status == "CANCELLED":
        print(f"    [CANCELADO] {report_type}")
        return None
    if not doc_id:
        print(f"    [{status}] {report_type}: sem documento de erro pra detalhar.")
        return None

    r3 = requests.get(f"{SPAPI_ENDPOINT}/reports/2021-06-30/documents/{doc_id}", headers=headers_access_token(token))
    doc = r3.json()
    conteudo = requests.get(doc["url"]).content
    if doc.get("compressionAlgorithm") == "GZIP":
        conteudo = gzip.decompress(conteudo)
    try:
        conteudo_lido = json.loads(conteudo)
    except json.JSONDecodeError:
        conteudo_lido = conteudo.decode("utf-8", errors="replace")

    if status == "FATAL":
        print(f"    [FALHOU FATAL] {report_type}: {json.dumps(conteudo_lido, ensure_ascii=False)[:400]}")
        return None
    return conteudo_lido


def salvar(pasta, nome_arquivo, dados):
    caminho = f"{pasta}/{nome_arquivo}"
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(dados if isinstance(dados, (dict, list)) else {"raw_text": dados}, f, ensure_ascii=False)
    print(f"    OK -> {caminho}")


# --------------------------------------------------------------
# CÁLCULO DA SEMANA FECHADA (domingo–sábado da mesma semana)
# --------------------------------------------------------------
def semana_fechada_anterior(hoje):
    dias_desde_sabado = (hoje.weekday() - 5) % 7
    if dias_desde_sabado == 0:
        dias_desde_sabado = 7
    sabado = hoje - timedelta(days=dias_desde_sabado)
    domingo = sabado - timedelta(days=6)
    return domingo, sabado


# --------------------------------------------------------------
# BRAND ANALYTICS — sem asinFocus (não é aceito por nenhum dos 3)
# --------------------------------------------------------------
def extrair_brand_analytics(token, pasta, hoje):
    domingo, sabado = semana_fechada_anterior(hoje)
    relatorios = {
        "cesta_compras": ("GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT", {"reportPeriod": "WEEK"}),
        "termos_busca": ("GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT", {"reportPeriod": "WEEK"}),
        "recompra": ("GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT", {"reportPeriod": "WEEK"}),
    }
    for nome, (tipo, opts) in relatorios.items():
        print(f"  Brand Analytics: {nome}...")
        dados = gerar_relatorio(token, tipo, domingo, sabado, opts)
        if dados is not None:
            salvar(pasta, f"brand_{nome}_{domingo.date()}_a_{sabado.date()}.json", dados)


# --------------------------------------------------------------
# PERFORMANCE — Cupons e Promoções
# --------------------------------------------------------------
def extrair_performance(token, pasta, data_ini, data_fim):
    fmt = lambda d: d.strftime("%Y-%m-%dT00:00:00Z")

    print("  Performance: cupons...")
    dados = gerar_relatorio(
        token, "GET_COUPON_PERFORMANCE_REPORT", data_ini, data_fim,
        report_options={"campaignStartDateFrom": fmt(data_ini), "campaignStartDateTo": fmt(data_fim)},
    )
    if dados is not None:
        salvar(pasta, f"perf_cupons_{data_ini.date()}_a_{data_fim.date()}.json", dados)

    print("  Performance: promocoes...")
    dados = gerar_relatorio(
        token, "GET_PROMOTION_PERFORMANCE_REPORT", data_ini, data_fim,
        report_options={"promotionStartDateFrom": fmt(data_ini), "promotionStartDateTo": fmt(data_fim)},
    )
    if dados is not None:
        salvar(pasta, f"perf_promocoes_{data_ini.date()}_a_{data_fim.date()}.json", dados)


# --------------------------------------------------------------
# STATUS DE PEDIDOS (Vendor Orders)
# --------------------------------------------------------------
def extrair_status_pedidos(token, pasta, data_ini, data_fim):
    print("  Vendor Orders: status de pedidos...")
    r = requests.get(
        f"{SPAPI_ENDPOINT}/vendor/orders/v1/purchaseOrdersStatus",
        headers=headers_access_token(token),
        params={
            "createdAfter": data_ini.strftime("%Y-%m-%dT00:00:00Z"),
            "createdBefore": data_fim.strftime("%Y-%m-%dT23:59:59Z"),
            "limit": 100,
        },
    )
    if r.status_code == 200:
        salvar(pasta, f"status_pedidos_{data_ini.date()}_a_{data_fim.date()}.json", r.json())
    else:
        print(f"    [FALHOU] {r.status_code}: {r.text[:400]}")


# --------------------------------------------------------------
# BUY BOX (Product Pricing API)
# --------------------------------------------------------------
def carregar_asins(pasta):
    asins = set()
    for arq in glob.glob(f"{pasta}/vendas_mes_*.json"):
        try:
            d = json.load(open(arq))
            asins.update(r["asin"] for r in d.get("salesByAsin", []))
        except Exception:
            pass
    if not asins:
        for arq in glob.glob(f"{pasta}/*.json"):
            try:
                d = json.load(open(arq))
            except Exception:
                continue
            for chave_lista in ("salesByAsin", "inventoryByAsin", "trafficByAsin"):
                for r in d.get(chave_lista, []):
                    if isinstance(r, dict) and r.get("asin"):
                        asins.add(r["asin"])
    return sorted(asins)


def _buybox_lote(token, lote):
    body = {
        "requests": [
            {
                "asin": asin, "marketplaceId": MARKETPLACE_ID_BR,
                "includedData": ["featuredBuyingOptions", "referencePrices", "lowestPricedOffers", "similarItems"],
            }
            for asin in lote
        ]
    }
    r = requests.post(
        f"{SPAPI_ENDPOINT}/batches/products/pricing/2022-05-01/items/competitiveSummary",
        headers=headers_access_token(token), json=body,
    )
    if r.status_code in (429, 503):
        raise RuntimeError(f"QuotaExceeded/Throttling Buy Box: {r.status_code}")
    return r


def extrair_buybox(token, pasta, asins):
    resultado = {}
    for i in range(0, len(asins), 20):
        lote = asins[i:i + 20]
        try:
            r = com_retry(_buybox_lote, token, lote)
        except Exception as e:
            print(f"    [FALHOU BUY BOX lote {i}] {e}")
            time.sleep(3)
            continue
        if r.status_code == 200:
            resp = r.json()
            for item in resp.get("responses", []):
                a = item.get("asin") or item.get("body", {}).get("asin")
                if a:
                    resultado[a] = item
        else:
            print(f"    [FALHOU BUY BOX lote {i}] {r.status_code}: {r.text[:400]}")
        time.sleep(3)
    salvar(pasta, "buybox_competitivo.json", resultado)
    print(f"    ({len(resultado)} ASINs com dado de Buy Box)")


def main():
    parser = argparser_contas(argparse.ArgumentParser(description=__doc__))
    contas = resolver_contas_cli(parser.parse_args().contas)

    hoje = datetime.now(timezone.utc)
    inicio_periodo = hoje - timedelta(days=90)

    for chave, cfg in contas.items():
        print(f'\n=== {cfg["nome"]} ===')
        token = obter_access_token(chave)
        pasta = pasta_raw(chave)
        os.makedirs(pasta, exist_ok=True)

        extrair_brand_analytics(token, pasta, hoje)
        extrair_performance(token, pasta, inicio_periodo, hoje)
        extrair_status_pedidos(token, pasta, inicio_periodo, hoje)

        asins = carregar_asins(pasta)
        print(f"  ASINs para Buy Box: {len(asins)}")
        if asins:
            extrair_buybox(token, pasta, asins)
        else:
            print("  [PULOU BUY BOX] nenhum ASIN encontrado nessa pasta.")

    print("\nConcluído. Próximo passo: capturar_qualidade_completa.py / "
          "calcular_qualidade_catalogo.py / transformar_vendor.py.")


if __name__ == "__main__":
    main()
