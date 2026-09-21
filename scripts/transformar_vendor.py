"""
transformar_vendor.py
======================
Passo 2 do fluxo de atualização do dashboard.

Lê os JSONs brutos de cada conta em dados_raw/<conta>/raw/*.json e gera
um único arquivo dados_vendor.json (na raiz do repositório) no formato do
objeto CONTAS — ver a seção "Formato do dados_vendor.json" em CLAUDE.md —
pronto para ser consumido via fetch() pelo dashboard_base.html, sem
precisar embutir o dado no HTML.

Uso:
  python scripts/transformar_vendor.py

Rodar depois de todas as células/scripts de captura (capturar_mensal.py,
capturar_complementar.py, capturar_catalogo.py, calcular_qualidade_catalogo.py)
e ANTES da célula do CDQ (enriquecer_qualidade_cdq.py) e de publicar_github.py.
Requer apenas biblioteca padrão (json, glob, os, collections, datetime).
"""

import glob
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta

from contas_config import CONTAS, pasta_raw

SAIDA = os.environ.get("VENDOR_OUTPUT_FILE", "dados_vendor.json")  # salvo na raiz do repositório


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def amount(v):
    """Extrai .amount de campos monetários {"amount":X,"currencyCode":"BRL"}."""
    if isinstance(v, dict):
        return v.get("amount", 0) or 0
    return v or 0


def n(v, padrao=0):
    return padrao if v is None else v


# ---------------------------------------------------------------------------
# Etapa 1 — transforma os relatórios raw de UMA conta no bloco CONTAS[conta]
# ---------------------------------------------------------------------------

def processar_conta(pasta):
    vendas, estoque, trafego, margem = (defaultdict(dict), defaultdict(dict), defaultdict(dict), defaultdict(dict))
    agg_vendas, agg_estoque, agg_trafego, agg_margem = {}, {}, {}, {}

    # --- Vendas ---
    for arq in sorted(glob.glob(f"{pasta}/vendas_mes_*.json")):
        d = json.load(open(arq))
        for r in d.get("salesByAsin", []):
            mes = r["startDate"][:7]
            vendas[r["asin"]][mes] = {
                "orderedRevenue": amount(r.get("orderedRevenue")), "orderedUnits": n(r.get("orderedUnits")),
                "shippedRevenue": amount(r.get("shippedRevenue")), "shippedUnits": n(r.get("shippedUnits")),
                "customerReturns": n(r.get("customerReturns")), "shippedCogs": amount(r.get("shippedCogs")),
            }
        for r in d.get("salesAggregate", []):
            mes = r["startDate"][:7]
            agg_vendas[mes] = {
                "orderedRevenue": amount(r.get("orderedRevenue")), "orderedUnits": n(r.get("orderedUnits")),
                "shippedRevenue": amount(r.get("shippedRevenue")), "shippedUnits": n(r.get("shippedUnits")),
                "customerReturns": n(r.get("customerReturns")), "shippedCogs": amount(r.get("shippedCogs")),
            }

    # --- Estoque ---
    for arq in sorted(glob.glob(f"{pasta}/estoque_mes_*.json")):
        d = json.load(open(arq))
        for r in d.get("inventoryByAsin", []):
            mes = r["startDate"][:7]
            estoque[r["asin"]][mes] = {
                "sellableUnits": n(r.get("sellableOnHandInventoryUnits")),
                "sellableCost": amount(r.get("sellableOnHandInventoryCost")),
                "aged90Units": n(r.get("aged90PlusDaysSellableInventoryUnits")),
                "unhealthyUnits": n(r.get("unhealthyInventoryUnits")),
                "unhealthyCost": amount(r.get("unhealthyInventoryCost")),
                "openPO": n(r.get("openPurchaseOrderUnits")), "sellThrough": n(r.get("sellThroughRate")),
                "oosRate": n(r.get("procurableProductOutOfStockRate")),
                "receiveFillRate": n(r.get("receiveFillRate")),
                "leadTime": n(r.get("averageVendorLeadTimeDays")),
                "unfilledUnits": n(r.get("unfilledCustomerOrderedUnits")),
                "temInfo": r.get("sellableOnHandInventoryUnits") is not None,
            }
        for r in d.get("inventoryAggregate", []):
            mes = r["startDate"][:7]
            agg_estoque[mes] = {
                "sellableUnits": n(r.get("sellableOnHandInventoryUnits")),
                "sellableCost": amount(r.get("sellableOnHandInventoryCost")),
                "unhealthyCost": amount(r.get("unhealthyInventoryCost")),
                "unhealthyUnits": n(r.get("unhealthyInventoryUnits")),
                "oosRate": n(r.get("procurableProductOutOfStockRate")),
                "receiveFillRate": n(r.get("receiveFillRate")),
                "leadTime": n(r.get("averageVendorLeadTimeDays")),
                "openPO": n(r.get("openPurchaseOrderUnits")), "sellThrough": n(r.get("sellThroughRate")),
            }

    # --- Tráfego ---
    for arq in sorted(glob.glob(f"{pasta}/trafego_mes_*.json")):
        d = json.load(open(arq))
        for r in d.get("trafficByAsin", []):
            mes = r["startDate"][:7]
            trafego[r["asin"]][mes] = {"glanceViews": n(r.get("glanceViews"))}
        for r in d.get("trafficAggregate", []):
            mes = r["startDate"][:7]
            agg_trafego[mes] = {"glanceViews": n(r.get("glanceViews"))}

    # --- Margem ---
    for arq in sorted(glob.glob(f"{pasta}/margem_mes_*.json")):
        d = json.load(open(arq))
        for r in d.get("netPureProductMarginByAsin", []):
            mes = r["startDate"][:7]
            margem[r["asin"]][mes] = {"npm": r.get("netPureProductMargin")}
        for r in d.get("netPureProductMarginAggregate", []):
            mes = r["startDate"][:7]
            agg_margem[mes] = {"npm": r.get("netPureProductMargin")}

    # --- Sell-in (purchase orders) -> sellin, sellinMes, repetidos, naoAtendidos, markupMes/Geral ---
    # AVISO: purchase_orders_60dias.json não é gerado por nenhum script do
    # fluxo recorrente atual (capturar_mensal / capturar_complementar) --
    # só existe se alguém rodou uma captura manual de Sell-in/POs no
    # passado. Ver "Lacuna conhecida: Sell-in e Previsão" em CLAUDE.md.
    po_arq = f"{pasta}/purchase_orders_60dias.json"
    sellin, sellin_mes, repetidos, nao_atendidos, markup_mes = {}, {}, {}, {}, {}
    total_pos, markup_geral = 0, 0
    if os.path.exists(po_arq):
        pedidos = json.load(open(po_arq))
        total_pos = len(set(p.get("purchaseOrderNumber") for p in pedidos))
        acc_asin = defaultdict(lambda: {"conf": 0.0, "rej": 0.0, "custo": 0.0, "pos": set()})
        acc_mes = defaultdict(lambda: {"custo": 0.0, "conf": 0.0, "rej": 0.0, "pos": set()})
        mk_mes = defaultdict(list)
        mk_all = []
        po_asin = defaultdict(set)
        for po in pedidos:
            pnum = po.get("purchaseOrderNumber")
            dmes = po.get("purchaseOrderDate", "")[:7]
            for it in po.get("itemStatus", []):
                a = it.get("buyerProductIdentifier")
                if not a:
                    continue
                po_asin[a].add(pnum)
                ack = it.get("acknowledgementStatus", {})
                ac = float(ack.get("acceptedQuantity", {}).get("amount", 0) or 0)
                rj = float(ack.get("rejectedQuantity", {}).get("amount", 0) or 0)
                cu = float(it.get("netCost", {}).get("amount", 0) or 0)
                lp = float(it.get("listPrice", {}).get("amount", 0) or 0)
                x = acc_asin[a]
                x["conf"] += ac; x["rej"] += rj; x["custo"] += ac * cu; x["pos"].add(pnum)
                y = acc_mes[dmes]
                y["custo"] += ac * cu; y["conf"] += ac; y["rej"] += rj; y["pos"].add(pnum)
                if rj > 0:
                    nao_atendidos[a] = nao_atendidos.get(a, 0) + rj
                if cu > 0:
                    mk_mes[dmes].append((lp - cu) / cu)
                    mk_all.append((lp - cu) / cu)
        sellin = {a: {"conf": v["conf"], "rej": v["rej"], "custo": round(v["custo"], 2), "pos": len(v["pos"])}
                  for a, v in acc_asin.items()}
        sellin_mes = {m: {"custo": round(v["custo"], 2), "conf": v["conf"], "rej": v["rej"], "pos": len(v["pos"])}
                      for m, v in acc_mes.items()}
        repetidos = {a: len(p) for a, p in po_asin.items() if len(p) > 1}
        markup_mes = {m: (sum(v) / len(v) if v else 0) for m, v in mk_mes.items()}
        markup_geral = sum(mk_all) / len(mk_all) if mk_all else 0

    # --- custoMedio (ponderado por volume enviado) ---
    custo_medio = {}
    for a, ms in vendas.items():
        tc = sum(v["shippedCogs"] for v in ms.values())
        tu = sum(v["shippedUnits"] for v in ms.values())
        if tu > 0:
            custo_medio[a] = tc / tu

    # --- Previsão (forecast) — mesma ressalva do Sell-in acima ---
    prev_arq = f"{pasta}/previsao_60dias.json"
    previsao, previsao_mes = {}, {}
    if os.path.exists(prev_arq):
        d = json.load(open(prev_arq))
        pa = d.get("forecastByAsin", [])
        if pa:
            g = datetime.strptime(pa[0]["forecastGenerationDate"], "%Y-%m-%d")
            lim = g + timedelta(days=60)
            pacc = defaultdict(lambda: {"mean": 0.0, "p70": 0.0, "p80": 0.0, "p90": 0.0})
            pmes = defaultdict(lambda: {"mean": 0.0, "p70": 0.0, "p80": 0.0, "p90": 0.0, "valor": 0.0})
            for r in pa:
                if datetime.strptime(r["startDate"], "%Y-%m-%d") > lim:
                    continue
                a = r["asin"]
                mu = n(r.get("meanForecastUnits"))
                x = pacc[a]
                x["mean"] += mu; x["p70"] += n(r.get("p70ForecastUnits"))
                x["p80"] += n(r.get("p80ForecastUnits")); x["p90"] += n(r.get("p90ForecastUnits"))
                y = pmes[r["startDate"][:7]]
                y["mean"] += mu; y["p70"] += n(r.get("p70ForecastUnits"))
                y["p80"] += n(r.get("p80ForecastUnits")); y["p90"] += n(r.get("p90ForecastUnits"))
                if a in custo_medio:
                    y["valor"] += mu * custo_medio[a]
            previsao = dict(pacc)
            previsao_mes = dict(pmes)

    # --- Curva ABC ---
    tot_rec = {}
    for a, ms in vendas.items():
        r = sum(v["orderedRevenue"] for v in ms.values())
        if r > 0:
            tot_rec[a] = r
    ordenado = sorted(tot_rec.items(), key=lambda x: -x[1])
    soma = sum(v for _, v in ordenado) or 1
    abc = {}
    ac = 0
    for a, v in ordenado:
        ac += v
        p = ac / soma
        abc[a] = {"valor": v, "classe": "A" if p <= .8 else ("B" if p <= .95 else "C"), "pct": v / soma}

    # --- ticket / markupVarejo por mês ---
    ticket_markup = {}
    for m, ag in agg_vendas.items():
        ticket_markup[m] = {
            "ticket": ag["shippedRevenue"] / ag["shippedUnits"] if ag["shippedUnits"] > 0 else 0,
            "markupVarejo": (ag["shippedRevenue"] - ag["shippedCogs"]) / ag["shippedCogs"] if ag["shippedCogs"] > 0 else 0,
        }

    todos_asins = set(vendas) | set(estoque)
    nunca = sorted(todos_asins - set(sellin))

    # --- catalogo (nome do produto, imagem, BSR) -- gerado por capturar_catalogo.py.
    # Se ainda não rodou pra essa conta, fica vazio e o dashboard cai no fallback (só ASIN).
    catalogo_arq = f"{pasta}/catalogo.json"
    catalogo = {}
    if os.path.exists(catalogo_arq):
        try:
            catalogo = json.load(open(catalogo_arq, encoding="utf-8"))
        except Exception:
            catalogo = {}

    # --- qualidade (aproximação própria do CDQ) -- gerada por
    # calcular_qualidade_catalogo.py a partir das 5 capturas de
    # capturar_qualidade_completa.py. Formato:
    # {"asins": {"<asin>": {...score_geral, grau_geral, componentes...}},
    #  "nao_pertence_a_conta": [...]}
    # Se o arquivo não existir ainda, fica vazio e o dashboard não mostra a
    # aba de qualidade pra essa conta.
    qualidade_arq = f"{pasta}/qualidade_catalogo.json"
    qualidade = {"asins": {}, "nao_pertence_a_conta": []}
    if os.path.exists(qualidade_arq):
        try:
            qualidade = json.load(open(qualidade_arq, encoding="utf-8"))
        except Exception:
            qualidade = {"asins": {}, "nao_pertence_a_conta": []}

    return {
        "vendas": dict(vendas), "estoque": dict(estoque), "trafego": dict(trafego), "margem": dict(margem),
        "aggVendas": agg_vendas, "aggEstoque": agg_estoque, "aggTrafego": agg_trafego, "aggMargem": agg_margem,
        "sellin": sellin, "sellinMes": sellin_mes, "repetidos": repetidos, "naoAtendidos": nao_atendidos,
        "nuncaComprados": nunca, "abc": abc, "ticketMarkup": ticket_markup, "markupMes": markup_mes,
        "markupGeral": markup_geral, "totalPOs": total_pos, "previsao": previsao, "previsaoMes": previsao_mes,
        "custoMedio": custo_medio, "catalogo": catalogo, "qualidade": qualidade,
    }


# ---------------------------------------------------------------------------
# Etapa 2 — gera o bloco `analise` (diagnósticos automáticos) para UMA conta
# ---------------------------------------------------------------------------

def analisar(d):
    V, E, T, M = d["vendas"], d["estoque"], d["trafego"], d["margem"]
    AV, AE, AT, AM = d["aggVendas"], d["aggEstoque"], d["aggTrafego"], d["aggMargem"]
    meses = sorted(set(list(AV) + list(AE) + list(AT) + list(AM)))
    ult = next((m for m in reversed(meses) if AV.get(m, {}).get("orderedUnits", 0) > 0), None)
    if not ult:
        return None

    tv = sum(AT.get(m, {}).get("glanceViews", 0) for m in meses)
    tu = sum(AV.get(m, {}).get("orderedUnits", 0) for m in meses)
    conv_geral = tu / tv if tv > 0 else 0
    ticket = d["ticketMarkup"].get(ult, {}).get("ticket", 0)
    npm = AM.get(ult, {}).get("npm")

    perfil = {}
    for a in set(V) | set(E) | set(T) | set(M):
        v = V.get(a, {}).get(ult, {}); e = E.get(a, {}).get(ult, {})
        t = T.get(a, {}).get(ult, {}); mg = M.get(a, {}).get(ult, {}); s = d["sellin"].get(a, {})
        views = t.get("glanceViews", 0); ped = v.get("orderedUnits", 0)
        perfil[a] = {
            "views": views, "ped": ped, "env": v.get("shippedUnits", 0), "rec": v.get("orderedRevenue", 0),
            "cogs": v.get("shippedCogs", 0), "dev": v.get("customerReturns", 0),
            "est": e.get("sellableUnits", 0), "parado": e.get("unhealthyUnits", 0),
            "a90": e.get("aged90Units", 0), "giro": e.get("sellThrough", 0), "openPO": e.get("openPO", 0),
            "temInfoEst": e.get("temInfo", False),
            "conv": (ped / views) if views > 0 else None, "npm": mg.get("npm"),
            "siConf": s.get("conf", 0), "siCusto": s.get("custo", 0),
        }

    views_list = sorted([p["views"] for p in perfil.values() if p["views"] > 0])
    v_med = views_list[len(views_list) // 2] if views_list else 0

    diags = []

    perdidos = [{"asin": a, "views": p["views"], "un": p["views"] * conv_geral, "rs": p["views"] * conv_geral * ticket}
                for a, p in perfil.items() if p["views"] > 0 and p["temInfoEst"] and p["est"] == 0 and p["ped"] == 0]
    perdidos.sort(key=lambda x: -x["rs"])
    if perdidos:
        diags.append({"tipo": "perdidos", "titulo": "Ruptura em produtos com procura",
            "impacto": sum(x["rs"] for x in perdidos), "qtd": len(perdidos),
            "explica": "Produtos que tiveram visitas na página mas estavam sem estoque. A estimativa usa a taxa de conversão média da conta aplicada às visitas perdidas.",
            "acao": "Cobrar reposição junto ao comprador da Amazon e revisar o ponto de pedido destes itens.",
            "itens": perdidos[:12]})

    baixa = [{"asin": a, "views": p["views"], "conv": p["conv"], "ped": p["ped"], "est": p["est"],
              "rs": (conv_geral - p["conv"]) * p["views"] * ticket}
             for a, p in perfil.items()
             if p["views"] >= max(v_med, 10) and p["conv"] is not None and p["conv"] < conv_geral * 0.5]
    baixa.sort(key=lambda x: -x["rs"])
    if baixa:
        diags.append({"tipo": "conversao", "titulo": "Tráfego alto convertendo mal",
            "impacto": sum(x["rs"] for x in baixa), "qtd": len(baixa),
            "explica": "Produtos bem acima da mediana de visitas, mas com conversão menor que metade da média da conta. O valor é quanto renderiam se convertessem na média.",
            "acao": "Revisar preço, imagens, título, bullets e avaliações. O cliente chega mas não compra.",
            "itens": baixa[:12]})

    parado = [{"asin": a, "parado": p["parado"], "est": p["est"], "a90": p["a90"], "giro": p["giro"]}
              for a, p in perfil.items() if p["parado"] > 0]
    parado.sort(key=lambda x: -x["parado"])
    total_parado_rs = AE.get(ult, {}).get("unhealthyCost", 0)
    if parado:
        diags.append({"tipo": "parado", "titulo": "Capital imobilizado em estoque parado",
            "impacto": total_parado_rs, "qtd": len(parado),
            "explica": "Estoque classificado pela Amazon como excedente frente à demanda prevista. É dinheiro que já saiu do seu caixa e não está girando.",
            "acao": "Negociar promoção, ação de liquidação ou reduzir o próximo pedido destes itens.",
            "itens": parado[:12]})

    vaz = []
    if npm:
        vaz = [{"asin": a, "npm": p["npm"], "rec": p["rec"], "rs": p["rec"] * (npm - p["npm"])}
               for a, p in perfil.items() if p["npm"] is not None and p["rec"] > 0 and p["npm"] < npm * 0.7]
        vaz.sort(key=lambda x: -x["rs"])
    if vaz:
        diags.append({"tipo": "margem", "titulo": "Produtos puxando a margem para baixo",
            "impacto": sum(x["rs"] for x in vaz), "qtd": len(vaz),
            "explica": f"Produtos com margem líquida abaixo de 70% da média da conta ({npm*100:.1f}%). O valor é quanto a mais renderiam na margem média.",
            "acao": "Renegociar custo com a Amazon ou revisar o preço de tabela destes itens.",
            "itens": vaz[:12]})

    op = [{"asin": a, "views": p["views"], "conv": p["conv"], "rec": p["rec"],
           "rs": (v_med - p["views"]) * p["conv"] * ticket}
          for a, p in perfil.items()
          if p["conv"] is not None and p["conv"] > conv_geral * 1.5 and 0 < p["views"] < v_med]
    op.sort(key=lambda x: -x["rs"])
    if op:
        diags.append({"tipo": "oportunidade", "titulo": "Produtos que convertem bem mas pouca gente vê",
            "impacto": sum(x["rs"] for x in op), "qtd": len(op),
            "explica": "Conversão acima de 1,5x a média com visitas abaixo da mediana. O valor estima o ganho se atingissem a visibilidade mediana.",
            "acao": "Investir em mídia, cupom ou melhorar posicionamento de busca. Aqui o produto já provou que vende.",
            "itens": op[:12]})

    diags.sort(key=lambda x: -x["impacto"])

    receitas = sorted([p["rec"] for p in perfil.values() if p["rec"] > 0], reverse=True)
    tot = sum(receitas) or 1

    serie_gap = {m: {"si": d["sellinMes"].get(m, {}).get("custo"), "so": AV.get(m, {}).get("shippedCogs")} for m in meses}
    cobertura = {}
    for m in meses:
        av = AV.get(m, {}); ae = AE.get(m, {})
        vd = av.get("shippedUnits", 0) / 30 if av.get("shippedUnits", 0) > 0 else 0
        cobertura[m] = ae.get("sellableUnits", 0) / vd if vd > 0 else None
    conversao = {m: (AV.get(m, {}).get("orderedUnits", 0) / AT[m]["glanceViews"]
                      if AT.get(m, {}).get("glanceViews", 0) > 0 else None) for m in meses}

    scatter = [{"a": a, "x": p["views"], "y": round((p["conv"] or 0) * 100, 2), "r": round(p["rec"], 2)}
               for a, p in perfil.items() if p["views"] > 0]

    top = sorted([(a, p["rec"]) for a, p in perfil.items() if p["rec"] > 0], key=lambda x: -x[1])[:12]

    return {
        "ultimoMes": ult, "convGeral": conv_geral, "ticket": ticket, "npm": npm, "viewsMediana": v_med,
        "diagnosticos": diags, "perfil": perfil,
        "concentracao": {"top5": sum(receitas[:5]) / tot, "nAsins": len(receitas)},
        "serieGap": serie_gap, "cobertura": cobertura, "conversao": conversao,
        "scatter": scatter, "topAsins": [{"a": a, "v": v} for a, v in top],
    }


# ---------------------------------------------------------------------------
# Etapa 3 — roda para todas as contas e salva dados_vendor.json
# ---------------------------------------------------------------------------

def main():
    contas_final = {}
    for chave, cfg in CONTAS.items():
        pasta = pasta_raw(chave)
        if not os.path.isdir(pasta):
            print(f'[aviso] pasta não encontrada para "{chave}": {pasta} — pulando')
            continue
        d = processar_conta(pasta)

        # trava de segurança: avisa (não impede) se faltar relatório essencial,
        # pra não gerar silenciosamente uma conta "zerada" no dashboard
        essenciais = {"vendas": d["vendas"], "estoque": d["estoque"], "trafego": d["trafego"], "margem": d["margem"]}
        faltando = [k for k, v in essenciais.items() if not v]
        if faltando:
            print(f'[ATENÇÃO] "{chave}" ({cfg["nome"]}) está SEM dados de: {", ".join(faltando)}. '
                  f"Verifique a pasta {pasta} antes de publicar o dashboard com esta conta.")
        if not d.get("sellin"):
            print(f'[aviso] "{chave}" ({cfg["nome"]}) sem purchase_orders_60dias.json (Sell-in) — '
                  f"ver 'Lacuna conhecida: Sell-in e Previsão' em CLAUDE.md.")
        if not d.get("catalogo"):
            print(f'[aviso] "{chave}" ({cfg["nome"]}) sem catalogo.json (nome/imagem/BSR por ASIN) — '
                  f"rode capturar_catalogo.py se quiser essa informação no dashboard.")
        if not d.get("qualidade", {}).get("asins"):
            print(f'[aviso] "{chave}" ({cfg["nome"]}) sem qualidade_catalogo.json (índice de qualidade) — '
                  f"rode calcular_qualidade_catalogo.py se quiser a aba de qualidade no dashboard.")

        d["nome"] = cfg["nome"]
        d["nota"] = cfg.get("nota", "")
        r = analisar(d)
        if r:
            d["analise"] = r
        d["extras"] = d.get("extras", {"cestaCompras": [], "termosBusca": [], "recompra": []})
        contas_final[chave] = d
        print(f"=== {cfg['nome']} ===")
        if r:
            for dg in r["diagnosticos"]:
                print(f"  [{dg['impacto']:>12,.2f}] {dg['titulo']} ({dg['qtd']} itens)")
        else:
            print("  (sem dados suficientes para diagnóstico)")

    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(contas_final, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nSalvo: {SAIDA} ({os.path.getsize(SAIDA):,} bytes)")
    print("Contas processadas:", list(contas_final.keys()))


if __name__ == "__main__":
    main()
