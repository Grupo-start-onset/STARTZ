"""
capturar_mensal.py
===================
Passo 1 do fluxo de atualização do dashboard.

Captura os 4 relatórios mensais (Vendas, Estoque, Tráfego, Margem) via
SP-API Reports, para todas as contas em contas_config.CONTAS (ou só as
indicadas em --contas), do início do ano até hoje, em blocos mensais.

Tem cache por arquivo: rodar de novo só baixa os blocos que ainda não
existem (útil se um bloco falhar por cota — é só rodar o script de novo).

Uso:
  python scripts/capturar_mensal.py                  # todas as contas
  python scripts/capturar_mensal.py --contas riomaster   # só uma conta (ex.: recém-cadastrada)

Rodar ANTES de capturar_complementar.py / capturar_qualidade_completa.py
e de transformar_vendor.py.
"""

import argparse
import os
import time
from datetime import datetime, timedelta

from contas_config import argparser_contas, credenciais_sp_api, pasta_raw, resolver_contas_cli
from sp_api_utils import MARKETPLACE, MARKETPLACE_ID_BR, com_retry

try:
    from sp_api.api import Reports
    from sp_api.base import ReportType
except ImportError:
    os.system("pip install -q python-amazon-sp-api")
    from sp_api.api import Reports
    from sp_api.base import ReportType

DATA_INICIO = datetime(2026, 1, 1)  # ajustar só se alguma conta começou depois


def blocos_mensais(inicio, fim):
    blocos, atual = [], inicio.replace(day=1)
    while atual <= fim:
        prox = atual.replace(year=atual.year + 1, month=1) if atual.month == 12 else atual.replace(month=atual.month + 1)
        blocos.append((atual, min(prox - timedelta(days=1), fim)))
        atual = prox
    return blocos


def caminho(pasta, prefixo, ini, fim):
    return f"{pasta}/{prefixo}_{ini.strftime('%Y-%m-%d')}_a_{fim.strftime('%Y-%m-%d')}.json"


def baixar_relatorio(reports_api, pasta, report_type, ini, fim, opts, prefixo, timeout_min=15):
    alvo = caminho(pasta, prefixo, ini, fim)
    if os.path.exists(alvo):
        print(f"  [em cache] {prefixo} {ini.date()} a {fim.date()}")
        return "cache"

    try:
        resp = com_retry(
            reports_api.create_report,
            reportType=report_type,
            marketplaceIds=[MARKETPLACE_ID_BR],
            dataStartTime=f"{ini.strftime('%Y-%m-%d')}T00:00:00Z",
            dataEndTime=f"{fim.strftime('%Y-%m-%d')}T23:59:59Z",
            reportOptions=opts,
        )
        rid = resp.payload["reportId"]
    except Exception as e:
        print(f"  [ERRO solicitar] {prefixo} {ini.date()}: {e}")
        return None

    t0, doc_id, st = time.time(), None, None
    while True:
        try:
            sr = reports_api.get_report(rid)
            st = sr.payload.get("processingStatus")
        except Exception:
            time.sleep(20)
            continue
        if st == "DONE":
            doc_id = sr.payload["reportDocumentId"]
            break
        if st in ("CANCELLED", "FATAL"):
            print(f"  [FALHOU {st}] {prefixo} {ini.date()} a {fim.date()}")
            return None
        if time.time() - t0 > timeout_min * 60:
            print(f"  [TIMEOUT] {prefixo} {ini.date()}")
            return None
        time.sleep(20)

    try:
        dr = reports_api.get_report_document(doc_id, download=True)
        with open(alvo, "w", encoding="utf-8") as f:
            f.write(dr.payload["document"])
        print(f"  [OK] {prefixo} {ini.date()} a {fim.date()}")
        return "ok"
    except Exception as e:
        print(f"  [ERRO baixar] {prefixo} {ini.date()}: {e}")
        return None


def opts_completo(p):
    return {"reportPeriod": p, "distributorView": "MANUFACTURING", "sellingProgram": "RETAIL"}


def opts_simples(p):
    return {"reportPeriod": p}


TAREFAS = [
    ("VENDAS mensal", ReportType.GET_VENDOR_SALES_REPORT, "vendas_mes", opts_completo("MONTH")),
    ("ESTOQUE mensal", ReportType.GET_VENDOR_INVENTORY_REPORT, "estoque_mes", opts_completo("MONTH")),
    ("TRAFEGO mensal", ReportType.GET_VENDOR_TRAFFIC_REPORT, "trafego_mes", opts_simples("MONTH")),
    ("MARGEM mensal", ReportType.GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT, "margem_mes", opts_simples("MONTH")),
]


def main():
    parser = argparser_contas(argparse.ArgumentParser(description=__doc__))
    contas = resolver_contas_cli(parser.parse_args().contas)

    data_fim = datetime.today()
    bmes = blocos_mensais(DATA_INICIO, data_fim)
    print(f"Período: {DATA_INICIO.date()} a {data_fim.date()} ({len(bmes)} blocos mensais)")
    print(f"Contas nesta execução: {[c['nome'] for c in contas.values()]}\n")

    resumo_geral = {}
    for chave, cfg in contas.items():
        nome = cfg["nome"]
        pasta = pasta_raw(chave)
        os.makedirs(pasta, exist_ok=True)

        print(f"\n{'#' * 60}\n# CONTA: {nome}\n{'#' * 60}")
        reports_api = Reports(credentials=credenciais_sp_api(chave), marketplace=MARKETPLACE)

        resumo_conta = {}
        for rotulo, tipo, prefixo, opts in TAREFAS:
            print(f"\n=== {rotulo} ({len(bmes)} blocos) ===")
            ok, falhas, pulados = 0, 0, 0
            for ini, fim in bmes:
                resultado = baixar_relatorio(reports_api, pasta, tipo, ini, fim, opts, prefixo)
                if resultado == "ok":
                    ok += 1
                elif resultado == "cache":
                    pulados += 1
                else:
                    falhas += 1
                time.sleep(15)  # pausa entre cada bloco
            resumo_conta[rotulo] = f"{ok} baixados, {pulados} já em cache, {falhas} falhas"
            time.sleep(30)  # pausa maior entre um tipo de relatório e o próximo

        resumo_geral[nome] = resumo_conta

    print(f"\n\n{'=' * 60}\n=== RESUMO GERAL ===\n{'=' * 60}")
    for nome, resumo in resumo_geral.items():
        print(f"\n{nome}:")
        for rotulo, status in resumo.items():
            print(f"  {rotulo}: {status}")

    print("\nSe aparecer [FALHOU] ou [TIMEOUT] em algum bloco, rode o script de novo --")
    print("os blocos que já deram [OK] ficam em cache e não são pedidos de novo.")


if __name__ == "__main__":
    main()
