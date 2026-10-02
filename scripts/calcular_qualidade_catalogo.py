"""
calcular_qualidade_catalogo.py
================================
Calcula o Índice de Qualidade de Catálogo (aproximação própria do CDQ),
combinando as fontes já capturadas por capturar_qualidade_completa.py:
  - listings_issues.json      (issues reportados pela Amazon)
  - listings_attributes.json  (bullet points + attributes completo)
  - imagens_completas.json    (lista completa de imagens)
  - relationships.json        (família de variação)
  - aplus_content_massa.json  (A+ Content da própria conta)

IMPORTANTE: isso NÃO é o CDQ oficial da Amazon. É uma aproximação própria,
seguindo as MESMAS REGRAS descritas no guia oficial ("Guia Completo de
Qualidade de Catálogo") sempre que a regra é objetiva e verificável via
API. Onde a regra depende de avaliação por IA da Amazon (ex.: "correção"
de atributo, detecção de logo em imagem), usamos um proxy mais simples, e
isso fica marcado no resultado.

100% local — não faz nenhuma chamada de API.
Salva em: dados_raw/<conta>/raw/qualidade_catalogo.json

Uso:
  python scripts/calcular_qualidade_catalogo.py
  python scripts/calcular_qualidade_catalogo.py --contas riomaster
"""

import argparse
import json
import os
import re

from contas_config import argparser_contas, pasta_raw, resolver_contas_cli

# Pesos oficiais do CDQ (guia PDF, seção 2)
PESOS = {"titulo": 25, "atributos": 30, "variacoes": 20, "imagens": 15, "bullets": 5, "aplus": 5}

FRASES_PROIBIDAS = [
    "frete gratis", "frete grátis", "melhor preco", "melhor preço",
    "promocao", "promoção", "oferta", "compre agora", "imperdivel",
    "imperdível", "desconto", "liquidacao", "liquidação",
]


def normalizar(txt):
    return (txt or "").lower()


# ------------------------------------------------------------------
# COMPONENTE: TITULO (25%)
# ------------------------------------------------------------------
def avaliar_titulo(item_name):
    if not item_name:
        return {"grau": "D", "score": 0, "motivo": "sem título"}

    texto_norm = normalizar(item_name)
    comprimento = len(item_name)

    frase_proibida = next((f for f in FRASES_PROIBIDAS if f in texto_norm), None)
    todo_maiusculo = item_name.isupper() and any(c.isalpha() for c in item_name)

    if frase_proibida:
        return {"grau": "D", "score": 0, "motivo": f'frase restrita: "{frase_proibida}"', "comprimento": comprimento}
    if todo_maiusculo:
        return {"grau": "D", "score": 0, "motivo": "título em caixa alta", "comprimento": comprimento}
    if comprimento < 10 or comprimento > 200:
        return {"grau": "D", "score": 0, "motivo": f"comprimento fora do padrão ({comprimento} caracteres)", "comprimento": comprimento}

    palavras = re.findall(r"\b\w{4,}\b", texto_norm)
    contagem = {}
    for p in palavras:
        contagem[p] = contagem.get(p, 0) + 1
    stuffing = any(c > 2 for c in contagem.values())

    if stuffing or comprimento > 170:
        return {"grau": "C", "score": 40, "motivo": "possível keyword stuffing ou muito longo", "comprimento": comprimento}
    if comprimento <= 75:
        return {"grau": "A", "score": 100, "motivo": "dentro do ideal", "comprimento": comprimento}
    return {"grau": "B", "score": 80, "motivo": "completo mas acima do ideal modular", "comprimento": comprimento}


# ------------------------------------------------------------------
# COMPONENTE: BULLET POINTS (5%)
# ------------------------------------------------------------------
def avaliar_bullets(bullet_points):
    qtd = len([b for b in (bullet_points or []) if b])
    if qtd >= 3:
        return {"grau": "A", "score": 100, "quantidade": qtd}
    if qtd >= 1:
        return {"grau": "C", "score": 50, "quantidade": qtd}
    return {"grau": "D", "score": 0, "quantidade": qtd}


# ------------------------------------------------------------------
# COMPONENTE: IMAGENS (15%)
# ------------------------------------------------------------------
def avaliar_imagens(lista_imagens):
    if not isinstance(lista_imagens, list):
        return {"grau": "D", "score": 0, "quantidade": 0, "motivo": "dado ausente"}

    qtd = len(lista_imagens)
    tem_alta_resolucao = any(
        max(img.get("height", 0), img.get("width", 0)) >= 1000 for img in lista_imagens
    ) if lista_imagens else False

    if qtd >= 4 and tem_alta_resolucao:
        return {"grau": "A", "score": 100, "quantidade": qtd, "alta_resolucao": True}
    if qtd < 4 and tem_alta_resolucao:
        return {"grau": "C", "score": 60, "quantidade": qtd, "alta_resolucao": True}
    if qtd >= 4 and not tem_alta_resolucao:
        return {"grau": "C", "score": 40, "quantidade": qtd, "alta_resolucao": False}
    return {"grau": "D", "score": 0, "quantidade": qtd, "alta_resolucao": False}


# ------------------------------------------------------------------
# COMPONENTE: VARIACOES (20%) -- None se não aplicável (ASIN órfão)
# ------------------------------------------------------------------
def avaliar_variacoes(relationships_wrapper, tema_por_parent):
    rel_list = (relationships_wrapper or {}).get("relationships", [])
    inner = rel_list[0].get("relationships", []) if rel_list else []

    if not inner:
        return None  # não aplicável -- ASIN sem família de variação

    rel = inner[0]
    parent = (rel.get("parentAsins") or [None])[0]
    tema = (rel.get("variationTheme") or {}).get("theme")

    temas_da_familia = tema_por_parent.get(parent, set())
    consistente = len(temas_da_familia) <= 1

    if consistente:
        return {"grau": "A", "score": 100, "tema": tema, "parent_asin": parent}
    return {"grau": "C", "score": 50, "tema": tema, "parent_asin": parent,
            "motivo": f"temas inconsistentes na família: {temas_da_familia}"}


# ------------------------------------------------------------------
# COMPONENTE: ATRIBUTOS ESTRUTURADOS (30%) -- proxy via issues[]
# ------------------------------------------------------------------
def avaliar_atributos(issues):
    issues = issues or []
    if not issues:
        return {"grau": "A", "score": 100, "issues_count": 0,
                "obs": "nenhum issue reportado pela Amazon (não confirma 100% dos atributos RAI)"}

    severidades = [str(i.get("severity", "")).upper() for i in issues]
    if "ERROR" in severidades:
        return {"grau": "D", "score": 0, "issues_count": len(issues), "obs": "issue(s) de severidade ERROR"}
    return {"grau": "C", "score": 50, "issues_count": len(issues), "obs": "issue(s) reportado(s), sem ERROR"}


# ------------------------------------------------------------------
# COMPONENTE: A+ CONTENT (5%)
# ------------------------------------------------------------------
def avaliar_aplus(asin, asins_com_aplus_aprovado):
    if asin in asins_com_aplus_aprovado:
        return {"grau": "A", "score": 100, "presente": True}
    return {"grau": "D", "score": 0, "presente": False,
            "obs": "só detecta A+ criado por esta conta Vendor; pode existir A+ de terceiro não detectado"}


def grau_geral_de(score):
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 1:
        return "C"
    return "D"


def calcular_conta(chave, pasta):
    def carregar(nome, default):
        caminho = f"{pasta}/{nome}"
        if os.path.exists(caminho):
            try:
                return json.load(open(caminho, encoding="utf-8"))
            except Exception:
                return default
        return default

    listings_issues = carregar("listings_issues.json", {})
    listings_attrs = carregar("listings_attributes.json", {})
    imagens = carregar("imagens_completas.json", {})
    relationships = carregar("relationships.json", {})
    aplus_massa = carregar("aplus_content_massa.json", {"documentos": [], "asins_com_aplus": []})

    asins_aplus_aprovado = set()
    for doc in aplus_massa.get("documentos", []):
        if doc.get("status") == "APPROVED":
            asins_aplus_aprovado |= set(doc.get("asins", []))

    tema_por_parent = {}
    for asin, wrapper in relationships.items():
        rel_list = (wrapper or {}).get("relationships", [])
        inner = rel_list[0].get("relationships", []) if rel_list else []
        if inner:
            rel = inner[0]
            parent = (rel.get("parentAsins") or [None])[0]
            tema = (rel.get("variationTheme") or {}).get("theme")
            tema_por_parent.setdefault(parent, set()).add(tema)

    todos_asins = set(listings_issues) | set(listings_attrs) | set(imagens) | set(relationships)

    resultado = {}
    nao_pertence = []
    contagem_graus = {"A": 0, "B": 0, "C": 0, "D": 0}

    for asin in todos_asins:
        li = listings_issues.get(asin, {})
        la = listings_attrs.get(asin, {})

        # ASIN não encontrado via search_listings_items (sellerId filtrado) --
        # provavelmente veio de asins_catalogo_completo.json (busca por
        # marca, sem filtro de vendedor) e não pertence de fato a esta
        # conta. Não é problema de qualidade de cadastro. Excluído da nota.
        if li.get("encontrado") is False or la.get("encontrado") is False:
            nao_pertence.append(asin)
            continue

        titulo = avaliar_titulo(li.get("itemName"))
        bullets = avaliar_bullets(la.get("bullet_points"))
        imgs = avaliar_imagens(imagens.get(asin))
        variacoes = avaliar_variacoes(relationships.get(asin), tema_por_parent)
        atributos = avaliar_atributos(li.get("issues"))
        aplus = avaliar_aplus(asin, asins_aplus_aprovado)

        pesos_efetivos = dict(PESOS)
        if variacoes is None:
            peso_variacoes = pesos_efetivos.pop("variacoes")
            soma_restante = sum(pesos_efetivos.values())
            for k in pesos_efetivos:
                pesos_efetivos[k] += peso_variacoes * (pesos_efetivos[k] / soma_restante)

        componentes = {"titulo": titulo, "bullets": bullets, "imagens": imgs, "atributos": atributos, "aplus": aplus}
        if variacoes is not None:
            componentes["variacoes"] = variacoes

        score_geral = sum(componentes[k]["score"] * (pesos_efetivos.get(k, 0) / 100) for k in componentes)
        grau_geral = grau_geral_de(score_geral)
        contagem_graus[grau_geral] += 1

        resultado[asin] = {
            "score_geral": round(score_geral, 1), "grau_geral": grau_geral,
            "componentes": componentes, "variacao_aplicavel": variacoes is not None,
        }

    saida = {"asins": resultado, "nao_pertence_a_conta": sorted(nao_pertence)}
    caminho_saida = f"{pasta}/qualidade_catalogo.json"
    json.dump(saida, open(caminho_saida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f'\n=== {chave} — {len(resultado)} ASINs calculados, '
          f'{len(nao_pertence)} excluídos (não pertence à conta) ===')
    print(f'  Graus: A={contagem_graus["A"]} B={contagem_graus["B"]} '
          f'C={contagem_graus["C"]} D={contagem_graus["D"]}')
    print(f'  Salvo: {caminho_saida}')


def main():
    parser = argparser_contas(argparse.ArgumentParser(description=__doc__))
    contas = resolver_contas_cli(parser.parse_args().contas)

    print("=== Calculando Índice de Qualidade de Catálogo (aproximação própria) ===")
    print("(NÃO é o CDQ oficial da Amazon -- ver comentário no topo do script)")
    for chave in contas:
        pasta = pasta_raw(chave)
        if not os.path.isdir(pasta):
            print(f'[aviso] pasta não encontrada para "{chave}": {pasta} — pulando')
            continue
        calcular_conta(chave, pasta)
    print("\n\nConcluído.")


if __name__ == "__main__":
    main()
