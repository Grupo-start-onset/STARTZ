"""
contas_config.py
=================
Configuração ÚNICA das contas Amazon Vendor Central do projeto START
Vendor Analytics. Todos os outros scripts em scripts/ importam este
arquivo — para adicionar, remover ou corrigir uma conta, edite SÓ AQUI.

Antes (no notebook do Colab) cada célula de captura mantinha sua própria
cópia de CONTAS_CONFIG, e era fácil uma ficar desatualizada (foi o que
aconteceu com a ALFA JF usando o secret genérico errado, e com
buscar_asins_por_marca.py / capturar_catalogo.py ficando sem Jolitex,
Balboa e Rio Master por um tempo). Esse arquivo existe pra isso não
acontecer de novo.

Segredos: o valor de cada refresh token NUNCA fica neste arquivo — só o
NOME da variável de ambiente onde ele deve estar. Configure as variáveis
de ambiente no ambiente de nuvem (Claude Code) antes de rodar qualquer
script de captura.
"""

import os

# ---------------------------------------------------------------------------
# Credenciais compartilhadas (mesmo client LWA para todas as contas)
# ---------------------------------------------------------------------------

LWA_CLIENT_ID_ENV = "SP_API_LWA_CLIENT_ID"
LWA_CLIENT_SECRET_ENV = "SP_API_LWA_CLIENT_SECRET"
GITHUB_TOKEN_ENV = "GITHUB_TOKEN"  # só usado por publicar_github.py, se o git local não tiver credencial própria

# ---------------------------------------------------------------------------
# As 7 contas
# ---------------------------------------------------------------------------
# chave        : identificador interno — é o MESMO usado como chave em
#                dados_vendor.json e reconhecido pelo dashboard. Não renomear
#                chaves existentes sem atualizar dashboard_base.html/app.js.
# nome          : nome de exibição no dashboard
# pasta         : subpasta de dados_raw/ onde ficam os JSONs brutos da conta
# secret        : nome da variável de ambiente com o refresh token SP-API
# seller_id     : vendorCode da conta (visível no Vendor Central). Serve de
#                 fallback quando ainda não existe nenhum status_pedidos_*.json
#                 pra descobrir o vendorCode automaticamente. Pode ficar None.
# marcas        : nomes de marca EXATOS (campo "Marca" da ficha de produto)
#                 usados por buscar_asins_por_marca.py. Lista vazia = essa
#                 conta é pulada por aquele script até alguém preencher.

CONTAS = {
    "alfa_jf": {
        "nome": "ALFA JF",
        "pasta": "alfa_jf/raw",
        "secret": "SP_API_REFRESH_TOKEN_ALFAJF",
        "seller_id": None,
        "marcas": ["Tree Liss Profissional"],
    },
    "blidshop": {
        "nome": "Blid Shop",
        "pasta": "blidshop/raw",
        "secret": "SP_API_REFRESH_TOKEN_BLIDSHOP",
        "seller_id": None,
        "marcas": ["BlidShop"],
    },
    # chave "conta3": é assim que dados_vendor.json e o dashboard identificam
    # a Petclean BR historicamente — mantido por compatibilidade, não renomear.
    "conta3": {
        "nome": "Petclean BR",
        "pasta": "petclean/raw",
        "secret": "SP_API_REFRESH_TOKEN_PETCLEAN",
        "seller_id": None,
        "marcas": ["Pet Clean"],
    },
    "ozitp": {
        "nome": "OZITP",
        "pasta": "ozitp/raw",
        "secret": "SP_API_REFRESH_TOKEN_OZITP",
        "seller_id": None,
        "marcas": ["KastKing", "Mar Negro Fishing"],
    },
    "jolitex": {
        "nome": "Jolitex",
        "pasta": "jolitex/raw",
        "secret": "SP_API_REFRESH_TOKEN_JOLITEX",
        "seller_id": "R88OM",
        "marcas": ["Jolitex", "MEK", "HomePet"],
    },
    "balboa": {
        "nome": "Balboa",
        "pasta": "balboa/raw",
        "secret": "SP_API_REFRESH_TOKEN_BALBOA",
        "seller_id": "6R8TT",
        "marcas": ["LIGGA SPORTS"],
    },
    "riomaster": {
        "nome": "BR - Rio Master",
        "pasta": "riomaster/raw",
        "secret": "SP_API_REFRESH_TOKEN_RIOMASTER",
        "seller_id": "RD8QP",
        # <<< preencher com a marca exata da Rio Master antes de rodar
        # buscar_asins_por_marca.py (até lá, esse script pula a conta).
        "marcas": [],
    },
}

# ---------------------------------------------------------------------------
# Pasta local onde ficam os dados brutos capturados (uma subpasta por conta).
# Configurável via variável de ambiente VENDOR_DATA_DIR; por padrão fica em
# dados_raw/ na raiz do repositório (fora do controle de versão — ver
# .gitignore). Só dados_vendor.json (já transformado) é versionado.
# ---------------------------------------------------------------------------

BASE_DIR = os.environ.get("VENDOR_DATA_DIR", "dados_raw")


def pasta_raw(chave):
    """Caminho absoluto/relativo da pasta raw/ de uma conta."""
    return os.path.join(BASE_DIR, CONTAS[chave]["pasta"])


def contas_selecionadas(somente=None):
    """Devolve o dict CONTAS filtrado por uma lista de chaves (ou tudo, se
    somente for None/vazio). Usado pelo argumento --contas de cada script,
    pra rodar só uma conta nova sem re-tocar as outras."""
    if not somente:
        return dict(CONTAS)
    invalidas = [c for c in somente if c not in CONTAS]
    if invalidas:
        raise ValueError(f"conta(s) desconhecida(s): {invalidas}. Válidas: {list(CONTAS)}")
    return {k: v for k, v in CONTAS.items() if k in somente}


def refresh_token(chave):
    """Lê o refresh token da conta a partir da variável de ambiente
    configurada em CONTAS[chave]['secret']. Nunca imprime nem grava o valor."""
    cfg = CONTAS[chave]
    token = os.environ.get(cfg["secret"])
    if not token:
        raise RuntimeError(
            f'Variável de ambiente "{cfg["secret"]}" não configurada '
            f'(necessária para a conta "{chave}" / {cfg["nome"]}).'
        )
    return token


def credenciais_lwa():
    client_id = os.environ.get(LWA_CLIENT_ID_ENV)
    client_secret = os.environ.get(LWA_CLIENT_SECRET_ENV)
    if not client_id or not client_secret:
        raise RuntimeError(
            f"Configure as variáveis de ambiente {LWA_CLIENT_ID_ENV} e "
            f"{LWA_CLIENT_SECRET_ENV} (credenciais do app LWA, compartilhadas "
            f"por todas as contas)."
        )
    return client_id, client_secret


def credenciais_sp_api(chave):
    """Dict pronto para os construtores da biblioteca python-amazon-sp-api
    (Reports, ListingsItems, CatalogItems, AplusContent, ...)."""
    client_id, client_secret = credenciais_lwa()
    return dict(
        refresh_token=refresh_token(chave),
        lwa_app_id=client_id,
        lwa_client_secret=client_secret,
    )


def argparser_contas(parser):
    """Adiciona a opção --contas (lista separada por vírgula) a um argparse
    já existente. Usado por todo script de captura, pra permitir rodar só
    uma conta nova sem re-tocar as outras."""
    parser.add_argument(
        "--contas",
        default=None,
        help=(
            "Lista de chaves de conta separadas por vírgula (ex.: riomaster ou "
            "jolitex,balboa). Padrão: todas as contas em CONTAS_CONFIG."
        ),
    )
    return parser


def resolver_contas_cli(args_contas):
    if not args_contas:
        return contas_selecionadas(None)
    chaves = [c.strip() for c in args_contas.split(",") if c.strip()]
    return contas_selecionadas(chaves)
