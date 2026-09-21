"""
enriquecer_qualidade_cdq.py
=============================
Passo 3 do fluxo de atualização do dashboard.

Lê o dados_vendor.json (gerado por transformar_vendor.py) e, pra cada
conta com bloco `qualidade.asins`, adiciona:
  - `acoes_pendentes`: lista de pendências legíveis por ASIN, derivadas
    dos componentes do índice de qualidade (título, bullets, imagens,
    atributos, A+, variações).
  - `qualidade.score_geral_conta`: média do score_geral de todos os ASINs
    da conta.

Sobrescreve o próprio dados_vendor.json.

Uso:
  python scripts/enriquecer_qualidade_cdq.py

Rodar DEPOIS de transformar_vendor.py e ANTES de publicar_github.py.
"""

import json
import os

ARQUIVO = os.environ.get("VENDOR_OUTPUT_FILE", "dados_vendor.json")


def acoes_pendentes(asin_data):
    componentes = asin_data.get("componentes", {})
    acoes = []

    titulo = componentes.get("titulo", {})
    grau_titulo = titulo.get("grau")
    if grau_titulo != "A":
        motivo = titulo.get("motivo", "sem detalhe")
        comprimento = titulo.get("comprimento", "?")
        texto = "Titulo (" + str(grau_titulo) + "): " + str(motivo) + " (" + str(comprimento) + " caracteres)"
        acoes.append(texto)

    bullets = componentes.get("bullets", {})
    grau_bullets = bullets.get("grau")
    if grau_bullets != "A":
        quantidade = bullets.get("quantidade", "?")
        texto = "Bullet points (" + str(grau_bullets) + "): apenas " + str(quantidade)
        acoes.append(texto)

    imagens = componentes.get("imagens", {})
    grau_imagens = imagens.get("grau")
    if grau_imagens != "A":
        detalhes = []
        qtd = imagens.get("quantidade")
        if qtd is not None and qtd < 4:
            detalhes.append(str(qtd) + " foto(s), minimo recomendado 4")
        if imagens.get("alta_resolucao") is False:
            detalhes.append("resolucao abaixo de 1000px")
        corpo = "; ".join(detalhes) if detalhes else "ver detalhes no cadastro"
        texto = "Imagens (" + str(grau_imagens) + "): " + corpo
        acoes.append(texto)

    atributos = componentes.get("atributos", {})
    grau_atributos = atributos.get("grau")
    if grau_atributos != "A":
        issues_count = atributos.get("issues_count", "?")
        obs = atributos.get("obs", "")
        texto = "Atributos (" + str(grau_atributos) + "): " + str(issues_count) + " issue(s) - " + str(obs)
        acoes.append(texto)

    aplus = componentes.get("aplus", {})
    grau_aplus = aplus.get("grau")
    if grau_aplus != "A":
        estado = aplus.get("obs", "sem detalhe") if aplus.get("presente") else "ausente"
        texto = "A+ Content (" + str(grau_aplus) + "): " + str(estado)
        acoes.append(texto)

    variacao_aplicavel = asin_data.get("variacao_aplicavel")
    if variacao_aplicavel and "variacoes" in componentes:
        variacoes = componentes["variacoes"]
        if variacoes.get("grau") != "A":
            tema = variacoes.get("tema", "?")
            parent_asin = variacoes.get("parent_asin", "?")
            texto = ("Variacoes (" + str(variacoes.get("grau")) + "): tema " + str(tema) +
                     " inconsistente na familia (parent " + str(parent_asin) + ")")
            acoes.append(texto)

    if not acoes:
        acoes.append("Sem pendencias relevantes")

    return acoes


def main():
    with open(ARQUIVO, encoding="utf-8") as f:
        contas = json.load(f)

    for chave, d in contas.items():
        qualidade = d.get("qualidade")
        if not qualidade or not qualidade.get("asins"):
            print("[aviso]", chave, "sem bloco qualidade.asins - pulando")
            continue

        asins = qualidade["asins"]
        for asin, dados in asins.items():
            dados["acoes_pendentes"] = acoes_pendentes(dados)

        soma = sum(a["score_geral"] for a in asins.values())
        qualidade["score_geral_conta"] = round(soma / len(asins), 1)
        print(chave, "- score_geral_conta:", qualidade["score_geral_conta"], "(", len(asins), "ASINs )")

    with open(ARQUIVO, "w", encoding="utf-8") as f:
        json.dump(contas, f, ensure_ascii=False, separators=(",", ":"))

    print("Salvo:", ARQUIVO)


if __name__ == "__main__":
    main()
