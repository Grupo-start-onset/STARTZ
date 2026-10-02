"""
publicar_github.py
====================
Passo 4 (último) do fluxo de atualização do dashboard.

Publica o dados_vendor.json (gerado por transformar_vendor.py e
enriquecido por enriquecer_qualidade_cdq.py) no repositório GitHub Pages
Grupo-start-onset/STARTZ — além do arquivo geral (todas as contas), gera
e publica automaticamente uma cópia isolada — só com os dados daquela
conta — para cada conta que já tenha uma pasta clientes/<conta_id>/ no
repositório (dashboards individuais enviados a clientes). Para isolar uma
conta nova, basta criar a pasta clientes/<conta_id>/ no repo (com
dashboard_base.html, styles.css, app.js dentro) uma única vez — a partir
da próxima publicação, o dados_vendor.json dessa pasta passa a ser
mantido automaticamente por este script.

Dois modos de uso:
  1) Rodando de DENTRO de um checkout git do STARTZ (é o caso normal numa
     sessão do Claude Code já aberta neste repositório): o script detecta
     o repositório pelo caminho do próprio scripts/, faz `git pull`,
     copia o dados_vendor.json pra lá (se já não estiver lá), e faz
     commit + push.
  2) Rodando de fora de um checkout (ex.: outra máquina/CI): defina
     VENDOR_REPO_DIR (pasta onde clonar/já clonado) e GITHUB_TOKEN
     (Personal Access Token do GitHub) como variáveis de ambiente; o
     script clona o repositório ali se ainda não existir.

Uso:
  python scripts/publicar_github.py

Rodar SEMPRE por último, depois de enriquecer_qualidade_cdq.py ter
atualizado o dados_vendor.json.
"""

import json
import os
import shutil
import subprocess
from datetime import datetime

GITHUB_USUARIO = "Grupo-start-onset"
GITHUB_REPO = "STARTZ"

SAIDA = os.environ.get("VENDOR_OUTPUT_FILE", "dados_vendor.json")
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_RAIZ_LOCAL = os.path.dirname(SCRIPTS_DIR)  # pasta pai de scripts/


def rodar(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.stdout.strip():
        print(r.stdout)
    if r.returncode != 0 and r.stderr.strip():
        print(r.stderr)
    return r


def resolver_pasta_repo():
    """Se scripts/ já está dentro de um checkout git do STARTZ, usa esse
    checkout direto. Senão, clona (ou reaproveita) em VENDOR_REPO_DIR."""
    if os.path.isdir(os.path.join(REPO_RAIZ_LOCAL, ".git")):
        rodar(["git", "pull"], cwd=REPO_RAIZ_LOCAL)
        return REPO_RAIZ_LOCAL

    pasta_repo = os.environ.get("VENDOR_REPO_DIR", os.path.join(os.getcwd(), GITHUB_REPO))
    if os.path.isdir(os.path.join(pasta_repo, ".git")):
        rodar(["git", "pull"], cwd=pasta_repo)
        return pasta_repo

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError(
            f"{REPO_RAIZ_LOCAL} não é um checkout git do STARTZ, e {pasta_repo} "
            f"também não existe ainda. Configure GITHUB_TOKEN (Personal Access "
            f"Token) para eu poder clonar o repositório, ou rode este script de "
            f"dentro de um checkout já existente."
        )
    repo_url = f"https://{token}@github.com/{GITHUB_USUARIO}/{GITHUB_REPO}.git"
    rodar(["git", "clone", repo_url, pasta_repo])
    return pasta_repo


def main():
    pasta_repo = resolver_pasta_repo()

    assert os.path.exists(SAIDA), (
        f'"{SAIDA}" não encontrado -- rode transformar_vendor.py '
        f"(e enriquecer_qualidade_cdq.py) primeiro, na mesma pasta de trabalho."
    )

    destino = os.path.join(pasta_repo, "dados_vendor.json")
    if os.path.abspath(SAIDA) != os.path.abspath(destino):
        shutil.copy(SAIDA, destino)
        print(f"Copiado: {SAIDA} -> {destino} ({os.path.getsize(destino):,} bytes)")

    # Identidade do git (necessária para o commit), só nesse repositório local
    rodar(["git", "config", "user.email", "vendor-analytics@startgrupo.com"], cwd=pasta_repo)
    rodar(["git", "config", "user.name", "START Vendor Analytics"], cwd=pasta_repo)

    # Gera uma cópia isolada do JSON para cada conta que já tenha uma
    # pasta clientes/<conta_id>/ publicada no repo (dashboard individual)
    with open(destino, encoding="utf-8") as f:
        CONTAS = json.load(f)

    pasta_clientes = os.path.join(pasta_repo, "clientes")
    contas_isoladas = []
    if os.path.isdir(pasta_clientes):
        for conta_id in sorted(CONTAS.keys()):
            pasta_conta = os.path.join(pasta_clientes, conta_id)
            if os.path.isdir(pasta_conta):
                destino_conta = os.path.join(pasta_conta, "dados_vendor.json")
                with open(destino_conta, "w", encoding="utf-8") as f:
                    json.dump({conta_id: CONTAS[conta_id]}, f, ensure_ascii=False)
                contas_isoladas.append(conta_id)
                print(f"Cópia isolada atualizada: clientes/{conta_id}/dados_vendor.json "
                      f"({os.path.getsize(destino_conta):,} bytes)")

    if not contas_isoladas:
        print("Nenhuma pasta clientes/<conta>/ encontrada no repo — nada a isolar desta vez.")

    rodar(["git", "add", "dados_vendor.json"], cwd=pasta_repo)
    for conta_id in contas_isoladas:
        rodar(["git", "add", f"clientes/{conta_id}/dados_vendor.json"], cwd=pasta_repo)

    if contas_isoladas:
        msg = (f'Atualiza dados_vendor.json (geral + isolados: {", ".join(contas_isoladas)}) '
               f'— {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    else:
        msg = f'Atualiza dados_vendor.json — {datetime.now().strftime("%Y-%m-%d %H:%M")}'

    r = subprocess.run(["git", "commit", "-m", msg], cwd=pasta_repo, capture_output=True, text=True)
    if "nothing to commit" in (r.stdout + r.stderr):
        print("Nada mudou desde a última publicação -- nada a enviar.")
        return

    print(r.stdout)
    rodar(["git", "push"], cwd=pasta_repo)
    print("\nPublicado! Em 1-2 minutos os links devem refletir os dados novos:")
    print(f"https://{GITHUB_USUARIO.lower()}.github.io/{GITHUB_REPO}/dashboard_base.html")
    for conta_id in contas_isoladas:
        print(f"https://{GITHUB_USUARIO.lower()}.github.io/{GITHUB_REPO}/clientes/{conta_id}/dashboard_base.html")


if __name__ == "__main__":
    main()
