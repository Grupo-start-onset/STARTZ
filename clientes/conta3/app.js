/* ============================================================================
   GRUPO START — INTELIGÊNCIA VENDOR CENTRAL
   Estrutura deste arquivo:
     1. Formatadores e constantes
     2. Carregamento de dados + índices derivados (catálogo, meses, etc.)
     3. Estado global, filtros (conta em lista suspensa, período) e paginação de tabelas
     4. Agregação por período (funções puras: state -> dados agregados)
     5. Diagnósticos (analise.diagnosticos, agregados entre contas)
     6. Catálogo de produtos (busca/ordenação)
     6b. Qualidade de Catálogo (estimativa própria de CDQ, bloco `qualidade`)
     6c. Saúde dos Listings (status/erros/avisos reais da Amazon, bloco `qualidadeListings`)
     7. Renderização — uma função por seção do dashboard
     7b. Páginas e navegação (uma página por bloco; só a página aberta é desenhada)
     7c. Mês em andamento por semana (bloco semanas)
     7d. Tempo real por hora (tempo_real/<conta>.json)
     8. Exportação (Excel)
     9. Inicialização
   Carregamento de dados: dados/index.json + dados/<conta>.json sob demanda (rápido);
   se o índice não existir (pastas de cliente, ou antes da 1ª publicação com o novo
   publicar_github.py), cai para o dados_vendor.json completo.
   ============================================================================ */

let CONTAS = null;
let INDICE = null; // índice do modo por conta: { geradoEm, contas: { <id>: {nome, meses, futuros, sellin, pedidos} } }

async function iniciarDashboard() {
  // modo rápido: só o índice (poucos KB); cada conta é baixada quando escolhida
  try {
    const ri = await fetch('dados/index.json');
    if (ri.ok) { const idx = await ri.json(); if (idx && idx.contas && Object.keys(idx.contas).length) INDICE = idx; }
  } catch (e) { /* sem índice: usa o arquivo completo */ }

  if (INDICE) {
    CONTAS = {};
  } else {
    const resp = await fetch('dados_vendor.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ao buscar dados_vendor.json');
    CONTAS = await resp.json();
  }

  /* ------------------------------------------------------------------------
     1. FORMATADORES E CONSTANTES
     ------------------------------------------------------------------------ */
  const MOEDA  = v => (v==null||isNaN(v)) ? '—' : v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
  const MOEDA2 = v => (v==null||isNaN(v)) ? '—' : v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2});
  const PCT    = v => (v==null||isNaN(v)) ? '—' : (v*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
  const PCTRAW = v => (v==null||isNaN(v)) ? '—' : v.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'; // v já em pontos percentuais (0-100)
  const NUM    = v => (v==null||isNaN(v)) ? '—' : v.toLocaleString('pt-BR',{maximumFractionDigits:0});
  const NUM2   = v => (v==null||isNaN(v)) ? '—' : v.toLocaleString('pt-BR',{maximumFractionDigits:2});
  const DIAS   = v => (v==null||isNaN(v)||!isFinite(v)) ? '—' : NUM(v)+' d';
  const MESLABEL = m => { const [y,mo]=m.split('-'); const nomes=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']; return nomes[parseInt(mo,10)-1]+'/'+y.slice(2); };
  const esc = s => (s==null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // link do ASIN para a página do produto na Amazon Brasil (abre em nova aba)
  const linkAsin = a => a ? `<a href="https://www.amazon.com.br/dp/${encodeURIComponent(a)}" target="_blank" rel="noopener noreferrer" title="Abrir na Amazon">${esc(a)}</a>` : '';

  const PALETTE = ['#17868C','#9C6510','#2C7A57','#A32E2A','#5F7378','#0D2B34'];
  const LIM_PASSO = 100; // linhas mostradas por vez nas tabelas grandes (botão "Mostrar mais")

  /* ------------------------------------------------------------------------
     2. ÍNDICES DERIVADOS
     ------------------------------------------------------------------------ */
  // META: nome e listas de meses de cada conta. Vem do índice (sem baixar a conta) ou, no
  // modo arquivo completo, é calculado dos próprios dados.
  function metaDe(c){
    return {
      nome: c.nome,
      meses: Object.keys(c.aggVendas || {}),
      futuros: Object.keys(c.previsaoMes || {}),
      sellin: [...Object.keys(c.sellinMes || {}), ...Object.keys(c.sellinRecebidoMes || {})],
      pedidos: (c.pedidos || []).map(p => (p.data || '').slice(0,7)).filter(Boolean)
    };
  }
  const META = INDICE ? INDICE.contas : Object.fromEntries(Object.keys(CONTAS).map(k => [k, metaDe(CONTAS[k])]));
  const CONTA_KEYS = Object.keys(META);
  const CONTA_NOME = {};
  CONTA_KEYS.forEach(k => CONTA_NOME[k] = META[k].nome || k);

  const ALL_MONTHS = Array.from(new Set(
    CONTA_KEYS.flatMap(k => META[k].meses || [])
  )).sort();

  // catálogo: nome/imagem/marca/bsr de um ASIN numa conta, com fallback seguro
  function catalogInfo(k, asin){
    const c = (CONTAS[k].catalogo || {})[asin];
    if (!c) return { nome: asin, imagem: null, marca: null, bsr: [] };
    return { nome: c.nome || asin, imagem: c.imagem || null, marca: c.marca || null, bsr: c.bsr || [] };
  }
  function bestBSR(bsrArr){
    if (!bsrArr || !bsrArr.length) return null;
    return bsrArr.reduce((best,b) => (best==null || b.rank < best.rank) ? b : best, null);
  }
  function bsrHTML(bsrArr){
    if (!bsrArr || !bsrArr.length) return '<span class="empty" style="padding:0">—</span>';
    return '<div class="bsrlist">' + bsrArr.slice(0,2).map(b =>
      `<span class="b">${esc(b.categoria)}: <b>#${NUM(b.rank)}</b></span>`
    ).join('') + '</div>';
  }

  // meses futuros disponíveis em previsaoMes, por conta
  const FUTURE_MONTHS = Array.from(new Set(
    CONTA_KEYS.flatMap(k => META[k].futuros || [])
  )).sort();

  // meses com dado de sell-in (criação do PO em sellinMes ou recebimento em sellinRecebidoMes),
  // por conta (cobertura pode não bater com ALL_MONTHS)
  const SELLIN_MONTHS = Array.from(new Set(
    CONTA_KEYS.flatMap(k => META[k].sellin || [])
  )).sort();

  /* ------------------------------------------------------------------------
     2b. CARREGAMENTO SOB DEMANDA DAS CONTAS (modo por conta)
     ------------------------------------------------------------------------ */
  const CHAVE_CONTA = 'startz_conta'; // conta escolhida por último, lembrada neste navegador
  let reqId = 0;

  // garante que as contas pedidas estão em CONTAS; devolve true se prontas, false se falhou
  // ou se uma escolha mais nova passou na frente (meu !== reqId)
  async function carregarContas(alvo, meu){
    const faltam = alvo.filter(k => !CONTAS[k]);
    if (!faltam.length) return true;
    const load = document.getElementById('loading');
    load.className = 'loading';
    load.textContent = 'Carregando ' + (faltam.length > 1 ? faltam.length + ' contas' : CONTA_NOME[faltam[0]]) + '…';
    load.hidden = false;
    try {
      await Promise.all(faltam.map(async k => {
        const r = await fetch('dados/' + k + '.json');
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ao buscar dados/' + k + '.json');
        CONTAS[k] = await r.json();
      }));
    } catch (e) {
      console.error(e);
      if (meu === reqId) { load.className = 'loading err'; load.textContent = 'Não foi possível carregar os dados: ' + e.message; }
      return false;
    }
    if (meu !== reqId) return false;
    load.hidden = true;
    return true;
  }

  // conta inicial: no modo por conta, a última escolhida (ou a primeira), para baixar pouco;
  // no modo arquivo completo, todas (como sempre foi)
  let contaInicial = '__todas';
  if (INDICE) {
    let salva = null;
    try { salva = localStorage.getItem(CHAVE_CONTA); } catch (e) {}
    contaInicial = (salva === '__todas' || (salva && META[salva])) ? salva : CONTA_KEYS[0];
  }
  const contasIniciais = contaInicial === '__todas' ? [...CONTA_KEYS] : [contaInicial];

  /* ------------------------------------------------------------------------
     3. ESTADO E FILTROS
     ------------------------------------------------------------------------ */
  let state = {
    contas: contasIniciais,
    de: ALL_MONTHS[0],
    ate: ALL_MONTHS[ALL_MONTHS.length-1],
    catBusca: '',
    catOrdenar: 'rev_desc',
    qualBusca: '',
    qualFiltroGrau: '',
    qualOrdenar: 'score_asc',
    listBusca: '',
    listOrdenar: 'erros_desc',
    avisoBusca: '',
    avisoOrdenar: 'avisos_desc',
    pedBusca: '',
    pedStatus: '',
    pedMes: '',
    pedAbertos: new Set(),
    lim: {},
    pagina: 'inicio',
    trTab: 'vendas'
  };

  // ---- paginação de tabelas: mostra LIM_PASSO linhas e um botão "Mostrar mais" ----
  function resetLim(){ state.lim = {}; }
  function limite(k){ return state.lim[k] || LIM_PASSO; }
  function maisRow(k, colspan, restantes){
    return `<tr class="maisrow"><td colspan="${colspan}"><button class="pill maisbtn" data-mais="${k}">Mostrar mais ${NUM(Math.min(LIM_PASSO, restantes))} (restam ${NUM(restantes)})</button></td></tr>`;
  }
  function tbodyHTML(key, linhas, colspan, fn){
    const vis = linhas.slice(0, limite(key));
    const resto = linhas.length - vis.length;
    return vis.map(fn).join('') + (resto > 0 ? maisRow(key, colspan, resto) : '');
  }

  // ---- seleção de conta (lista suspensa: "Todas as contas" ou uma conta) ----
  const selConta = document.getElementById('selConta');
  const optTodas = document.createElement('option');
  optTodas.value = '__todas'; optTodas.textContent = 'Todas as contas';
  selConta.appendChild(optTodas);
  CONTA_KEYS.forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = CONTA_NOME[k];
    selConta.appendChild(o);
  });
  if (CONTA_KEYS.length <= 1) document.getElementById('fgConta').style.display = 'none'; // dashboard de cliente: conta única
  selConta.value = contaInicial;
  let contaSelecionada = contaInicial;
  selConta.onchange = async () => {
    const escolha = selConta.value;
    const alvo = escolha === '__todas' ? [...CONTA_KEYS] : [escolha];
    const meu = ++reqId;
    const ok = await carregarContas(alvo, meu);
    if (meu !== reqId) return;               // uma escolha mais nova passou na frente
    if (!ok) { selConta.value = contaSelecionada; return; }
    contaSelecionada = escolha;
    state.contas = alvo;
    try { localStorage.setItem(CHAVE_CONTA, escolha); } catch (e) {}
    resetLim();
    renderPagina();
  };

  const selDe = document.getElementById('selDe');
  const selAte = document.getElementById('selAte');
  ALL_MONTHS.forEach(m => {
    const o1 = document.createElement('option'); o1.value = m; o1.textContent = MESLABEL(m);
    const o2 = document.createElement('option'); o2.value = m; o2.textContent = MESLABEL(m);
    selDe.appendChild(o1); selAte.appendChild(o2);
  });
  selDe.value = state.de; selAte.value = state.ate;
  selDe.onchange = () => { state.de = selDe.value; if (state.de > state.ate) { state.ate = state.de; selAte.value = state.ate; } resetLim(); renderPagina(); };
  selAte.onchange = () => { state.ate = selAte.value; if (state.ate < state.de) { state.de = state.ate; selDe.value = state.de; } resetLim(); renderPagina(); };

  const catBusca = document.getElementById('catBusca');
  const catOrdenar = document.getElementById('catOrdenar');
  catBusca.oninput = () => { state.catBusca = catBusca.value.trim().toLowerCase(); resetLim(); renderCatalogo(agregarPeriodo()); };
  catOrdenar.onchange = () => { state.catOrdenar = catOrdenar.value; resetLim(); renderCatalogo(agregarPeriodo()); };

  const qualBusca = document.getElementById('qualBusca');
  const qualFiltroGrau = document.getElementById('qualFiltroGrau');
  const qualOrdenar = document.getElementById('qualOrdenar');
  qualBusca.oninput = () => { state.qualBusca = qualBusca.value.trim().toLowerCase(); resetLim(); renderQualidade(); };
  qualFiltroGrau.onchange = () => { state.qualFiltroGrau = qualFiltroGrau.value; resetLim(); renderQualidade(); };
  qualOrdenar.onchange = () => { state.qualOrdenar = qualOrdenar.value; resetLim(); renderQualidade(); };

  // filtros da seção Saúde dos Listings (qualidadeListings)
  const listBusca = document.getElementById('listBusca');
  const listOrdenar = document.getElementById('listOrdenar');
  const avisoBusca = document.getElementById('avisoBusca');
  const avisoOrdenar = document.getElementById('avisoOrdenar');
  listBusca.oninput = () => { state.listBusca = listBusca.value.trim().toLowerCase(); resetLim(); renderListingsSuprimidos(montarListings()); };
  listOrdenar.onchange = () => { state.listOrdenar = listOrdenar.value; resetLim(); renderListingsSuprimidos(montarListings()); };
  avisoBusca.oninput = () => { state.avisoBusca = avisoBusca.value.trim().toLowerCase(); resetLim(); renderListingsAvisos(montarListings()); };
  avisoOrdenar.onchange = () => { state.avisoOrdenar = avisoOrdenar.value; resetLim(); renderListingsAvisos(montarListings()); };

  // filtros da seção de pedidos de compra
  const PED_MESES = Array.from(new Set(
    CONTA_KEYS.flatMap(k => META[k].pedidos || [])
  )).sort().reverse();
  const pedMesEl = document.getElementById('pedMes');
  PED_MESES.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = MESLABEL(m); pedMesEl.appendChild(o); });
  document.getElementById('pedBusca').oninput = e => { state.pedBusca = e.target.value.trim().toLowerCase(); resetLim(); renderPedidos(); };
  document.getElementById('pedStatus').onchange = e => { state.pedStatus = e.target.value; resetLim(); renderPedidos(); };
  pedMesEl.onchange = e => { state.pedMes = e.target.value; resetLim(); renderPedidos(); };
  document.querySelector('#tblPedidos tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr.pedrow');
    if (!tr) return;
    const chave = tr.dataset.chave;
    if (state.pedAbertos.has(chave)) state.pedAbertos.delete(chave); else state.pedAbertos.add(chave);
    renderPedidos();
  });

  // abas (Retenção e Tempo real): cada botão aponta para o painel por data-panel;
  // na página Tempo real, trocar de aba redesenha (gráfico não desenha dentro de painel oculto)
  document.querySelectorAll('.tabs').forEach(tabs => {
    tabs.querySelectorAll('.tabbtn').forEach(btn => {
      btn.onclick = () => {
        const raiz = tabs.parentElement;
        tabs.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('on'));
        Array.from(raiz.children).filter(el => el.classList.contains('tabpanel')).forEach(pn => pn.classList.remove('on'));
        btn.classList.add('on');
        const alvo = document.getElementById(btn.dataset.panel);
        if (alvo) alvo.classList.add('on');
        if (btn.dataset.tab) { state.trTab = btn.dataset.tab; renderTempoReal(); }
      };
    });
  });

  // botão "Mostrar mais": aumenta o limite daquela tabela e redesenha só ela
  const REDESENHAR_TABELA = {
    catalogo:   () => renderCatalogo(agregarPeriodo()),
    suprimidos: () => renderListingsSuprimidos(montarListings()),
    avisos:     () => renderListingsAvisos(montarListings()),
    qualidade:  () => renderQualidade(),
    qualAlerta: () => renderQualidade(),
    pedidos:    () => renderPedidos(),
    alertas:    () => renderAlertas(),
    recompra:   () => renderRetencao(),
    cesta:      () => renderRetencao(),
    termos:     () => renderRetencao(),
    semTop:     () => renderSemanas(),
    trVendas:   () => renderTempoReal(),
    trTrafego:  () => renderTempoReal(),
    trEstoque:  () => renderTempoReal()
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-mais]');
    if (!b) return;
    const k = b.dataset.mais;
    state.lim[k] = limite(k) + LIM_PASSO;
    if (REDESENHAR_TABELA[k]) REDESENHAR_TABELA[k]();
  });

  /* ------------------------------------------------------------------------
     4. AGREGAÇÃO POR PERÍODO
     ------------------------------------------------------------------------ */
  function mesesNoRange(){
    return ALL_MONTHS.filter(m => m >= state.de && m <= state.ate);
  }

  function agregarPeriodo(){
    const meses = mesesNoRange();
    const porConta = {};
    const porMes = {};
    meses.forEach(m => porMes[m] = {
      shippedRevenue:0, shippedUnits:0, glanceViews:0, sellableCost:0, unhealthyCost:0, sellableUnits:0,
      shippedUnitsReal:0, oosNum:0, oosDen:0,
      npmNum:0, npmDen:0, markupNum:0, markupDen:0, shippedCogs:0
    });

    let tot = {shippedRevenue:0, shippedUnits:0, glanceViews:0, npmNum:0, npmDen:0, sellableCost:0, unhealthyCost:0};

    state.contas.forEach(k => {
      const c = CONTAS[k];
      let cr = {shippedRevenue:0, shippedUnits:0, glanceViews:0, npmNum:0, sellableCost:0, unhealthyCost:0, sellableUnits:0, shippedUnitsReal:0};
      meses.forEach(m => {
        const v = (c.aggVendas||{})[m] || {};
        const t = (c.aggTrafego||{})[m] || {};
        const e = (c.aggEstoque||{})[m] || {};
        const mg = (c.aggMargem||{})[m] || {};
        const tm = (c.ticketMarkup||{})[m] || {};
        const rev = v.orderedRevenue || 0;
        const un = v.orderedUnits || 0;
        const gv = t.glanceViews || 0;
        const shipUn = v.shippedUnits || 0;
        const cogs = v.shippedCogs || 0;

        cr.shippedRevenue += rev; cr.shippedUnits += un; cr.glanceViews += gv;
        cr.npmNum += (mg.npm||0) * rev;
        cr.sellableCost += (e.sellableCost||0); cr.unhealthyCost += (e.unhealthyCost||0);
        cr.sellableUnits += (e.sellableUnits||0); cr.shippedUnitsReal += shipUn;

        tot.shippedRevenue += rev; tot.shippedUnits += un; tot.glanceViews += gv;
        tot.npmNum += (mg.npm||0) * rev; tot.npmDen += rev;
        tot.sellableCost += (e.sellableCost||0); tot.unhealthyCost += (e.unhealthyCost||0);

        porMes[m].shippedRevenue += rev;
        porMes[m].shippedUnits += un;
        porMes[m].glanceViews += gv;
        porMes[m].sellableCost += (e.sellableCost||0);
        porMes[m].unhealthyCost += (e.unhealthyCost||0);
        porMes[m].sellableUnits += (e.sellableUnits||0);
        porMes[m].shippedUnitsReal += shipUn;
        porMes[m].shippedCogs += cogs;

        if (e.oosRate != null) { porMes[m].oosNum += e.oosRate * ((e.sellableCost||0) || 1); porMes[m].oosDen += ((e.sellableCost||0) || 1); }
        porMes[m].npmNum += (mg.npm||0) * rev;
        porMes[m].npmDen += rev;
        if (tm.markupVarejo != null) { porMes[m].markupNum += tm.markupVarejo * rev; porMes[m].markupDen += rev; }
      });
      porConta[k] = cr;
    });

    return {meses, porConta, porMes, tot};
  }

  function topAsinsPeriodo(meses){
    const soma = {}; // asin -> {rev, contas:Set, contaKey (primeira conta em que aparece)}
    state.contas.forEach(k => {
      const vendas = CONTAS[k].vendas || {};
      Object.keys(vendas).forEach(asin => {
        let rev = 0;
        meses.forEach(m => { rev += (vendas[asin][m] && vendas[asin][m].orderedRevenue) || 0; });
        if (rev !== 0) {
          const key = asin;
          if (!soma[key]) soma[key] = {asin, rev:0, contas:new Set(), contaKey:k};
          soma[key].rev += rev;
          soma[key].contas.add(CONTA_NOME[k]);
        }
      });
    });
    return Object.values(soma).map(d => ({asin:d.asin, rev:d.rev, contas:[...d.contas].join(', '), contaKey:d.contaKey}))
      .sort((a,b)=>b.rev-a.rev);
  }

  function computeABC(meses){
    const positivos = topAsinsPeriodo(meses).filter(a => a.rev > 0);
    const total = positivos.reduce((s,a)=>s+a.rev,0);
    let acc = 0;
    return positivos.map((a,i) => {
      acc += a.rev;
      const cumPct = total>0 ? acc/total : 0;
      const classe = cumPct <= 0.8 ? 'A' : (cumPct <= 0.95 ? 'B' : 'C');
      return {...a, rank:i+1, cumPct, classe};
    });
  }

  /* ------------------------------------------------------------------------
     5. DIAGNÓSTICOS
     ------------------------------------------------------------------------ */
  const TIPO_META = {
    perdidos:    { dot:'bad',  impactoLabel:'perda estimada' },
    parado:      { dot:'warn', impactoLabel:'capital parado' },
    conversao:   { dot:'warn', impactoLabel:'receita perdida' },
    margem:      { dot:'bad',  impactoLabel:'margem perdida' },
    oportunidade:{ dot:'good', impactoLabel:'potencial de ganho' }
  };

  const ITEM_COLS = {
    parado:    [ {h:'Parado (un)', get:it=>it.parado, fmt:NUM}, {h:'Estoque', get:it=>it.est, fmt:NUM}, {h:'90+ dias', get:it=>it.a90, fmt:NUM}, {h:'Giro', get:it=>it.giro, fmt:NUM2} ],
    conversao: [ {h:'Visitas', get:it=>it.views, fmt:NUM}, {h:'Conversão', get:it=>it.conv, fmt:PCT}, {h:'Pedidos', get:it=>it.ped, fmt:NUM}, {h:'Impacto', get:it=>it.rs, fmt:MOEDA2} ],
    oportunidade: [ {h:'Visitas', get:it=>it.views, fmt:NUM}, {h:'Conversão', get:it=>it.conv, fmt:PCT}, {h:'Receita atual', get:it=>it.rec, fmt:MOEDA2}, {h:'Potencial', get:it=>it.rs, fmt:MOEDA2} ],
    margem:    [ {h:'Margem (NPM)', get:it=>it.npm, fmt:PCT}, {h:'Receita', get:it=>it.rec, fmt:MOEDA2}, {h:'Potencial', get:it=>it.rs, fmt:MOEDA2} ],
    perdidos:  [ {h:'Visitas', get:it=>it.views, fmt:NUM}, {h:'Unid. perdidas (est.)', get:it=>it.un, fmt:NUM2}, {h:'Impacto', get:it=>it.rs, fmt:MOEDA2} ]
  };

  function agregarDiagnosticos(){
    const porTipo = {}; // tipo -> {impacto, qtd, titulo, explica, acao, itens:[{...item, contaKey}]}
    state.contas.forEach(k => {
      const diags = ((CONTAS[k].analise || {}).diagnosticos) || [];
      diags.forEach(d => {
        if (!porTipo[d.tipo]) porTipo[d.tipo] = { tipo:d.tipo, impacto:0, qtd:0, titulo:d.titulo, explica:d.explica, acao:d.acao, itens:[], contasEnvolvidas:new Set() };
        const bucket = porTipo[d.tipo];
        bucket.impacto += d.impacto || 0;
        bucket.qtd += d.qtd || 0;
        bucket.contasEnvolvidas.add(k);
        (d.itens||[]).forEach(it => bucket.itens.push({...it, contaKey:k}));
      });
    });
    return Object.values(porTipo).sort((a,b) => Math.abs(b.impacto) - Math.abs(a.impacto));
  }

  function renderDiagnosticos(){
    const wrap = document.getElementById('diagWrap');
    const grupos = agregarDiagnosticos();
    if (!grupos.length) { wrap.innerHTML = '<div class="empty">Sem diagnósticos disponíveis para as contas selecionadas.</div>'; return; }

    wrap.innerHTML = grupos.map((g, gi) => {
      const meta = TIPO_META[g.tipo] || { dot:'muted', impactoLabel:'impacto' };
      const cols = ITEM_COLS[g.tipo] || [];
      const sortKey = it => Math.abs((it.rs != null ? it.rs : (it.parado != null ? it.parado : 0)));
      const itensOrdenados = [...g.itens].sort((a,b) => sortKey(b) - sortKey(a));
      const top = itensOrdenados.slice(0, 8);
      const resto = itensOrdenados.length - top.length;

      const linhasItens = top.map(it => {
        const info = catalogInfo(it.contaKey, it.asin);
        const cellsCols = cols.map(c => `<td class="num">${c.fmt(c.get(it))}</td>`).join('');
        return `<tr>
          <td><div class="prodcell">
            ${info.imagem ? `<img class="thumb" src="${esc(info.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
            <div><div class="prodname">${esc(info.nome)}</div><div class="asincode">${linkAsin(it.asin)} · <span class="contatag" style="margin:0">${esc(CONTA_NOME[it.contaKey])}</span></div></div>
          </div></td>
          ${cellsCols}
        </tr>`;
      }).join('');

      return `<div class="diagcard${gi===0 ? ' open' : ''}" data-idx="${gi}">
        <div class="diaghead" onclick="this.closest('.diagcard').classList.toggle('open')">
          <span class="dot ${meta.dot}"></span>
          <div class="txt">
            <div class="ttl">${esc(g.titulo)}</div>
            <div class="sub">${NUM(g.qtd)} item(ns) · ${[...g.contasEnvolvidas].map(k=>esc(CONTA_NOME[k])).join(', ')}</div>
          </div>
          <div class="impact"><div class="v">${MOEDA(g.impacto)}</div><div class="l">${meta.impactoLabel}</div></div>
          <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="diagbody"><div class="diagbody-in">
          <p class="desc" style="margin:12px 0 0">${esc(g.explica)}</p>
          <div class="acao">➜ ${esc(g.acao)}</div>
          <table class="tbl"><thead><tr><th>Produto</th>${cols.map(c=>`<th class="num">${c.h}</th>`).join('')}</tr></thead>
          <tbody>${linhasItens}</tbody></table>
          ${resto > 0 ? `<p class="desc" style="margin-top:8px">+ ${resto} outro(s) item(ns) não exibido(s)</p>` : ''}
        </div></div>
      </div>`;
    }).join('');
  }

  /* ------------------------------------------------------------------------
     6. CATÁLOGO DE PRODUTOS
     ------------------------------------------------------------------------ */
  function montarCatalogoPeriodo(meses){
    const linhas = [];
    state.contas.forEach(k => {
      const c = CONTAS[k];
      const vendas = c.vendas || {};
      const ultimoMes = meses[meses.length - 1];
      Object.keys(vendas).forEach(asin => {
        let rev = 0;
        meses.forEach(m => { rev += (vendas[asin][m] && vendas[asin][m].orderedRevenue) || 0; });
        if (rev === 0) return;
        const info = catalogInfo(k, asin);
        const estUlt = ultimoMes ? ((c.estoque||{})[asin]||{})[ultimoMes] : null;
        const sellable = estUlt ? Math.max(0, (estUlt.sellableCost||0) - (estUlt.unhealthyCost||0)) : null;
        let cobertura = null;
        if (estUlt && estUlt.sellableUnits != null) {
          const vUlt = ((vendas[asin]||{})[ultimoMes]) || {};
          const veloc = (vUlt.shippedUnits||0) / 30;
          cobertura = veloc > 0 ? estUlt.sellableUnits / veloc : null;
        }
        linhas.push({ asin, contaKey:k, nome:info.nome, imagem:info.imagem, bsr:info.bsr, rev, sellable, cobertura });
      });
    });
    return linhas;
  }

  function renderCatalogo(agregado){
    const { meses } = agregado;
    let linhas = montarCatalogoPeriodo(meses);

    if (state.catBusca) {
      linhas = linhas.filter(l => l.nome.toLowerCase().includes(state.catBusca) || l.asin.toLowerCase().includes(state.catBusca));
    }
    const ord = state.catOrdenar;
    linhas.sort((a,b) => {
      if (ord === 'rev_desc') return b.rev - a.rev;
      if (ord === 'rev_asc') return a.rev - b.rev;
      if (ord === 'nome_asc') return a.nome.localeCompare(b.nome, 'pt-BR');
      if (ord === 'bsr_asc') {
        const ba = bestBSR(a.bsr); const bb = bestBSR(b.bsr);
        const ra = ba ? ba.rank : Infinity, rb = bb ? bb.rank : Infinity;
        return ra - rb;
      }
      return 0;
    });

    document.getElementById('catCount').textContent = linhas.length + ' produto(s)';
    const tbody = document.querySelector('#tblCatalogo tbody');
    if (!linhas.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">Nenhum produto encontrado.</td></tr>'; return; }

    tbody.innerHTML = tbodyHTML('catalogo', linhas, 6, l => `<tr>
      <td><div class="prodcell">
        ${l.imagem ? `<img class="thumb" src="${esc(l.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
        <div><div class="prodname">${esc(l.nome)}</div><div class="asincode">${linkAsin(l.asin)}</div></div>
      </div></td>
      <td><span class="tag muted">${esc(CONTA_NOME[l.contaKey])}</span></td>
      <td>${bsrHTML(l.bsr)}</td>
      <td class="num">${MOEDA2(l.rev)}</td>
      <td class="num">${l.sellable==null ? '—' : MOEDA(l.sellable)}</td>
      <td class="num">${DIAS(l.cobertura)}</td>
    </tr>`);
  }

  /* ------------------------------------------------------------------------
     6b. QUALIDADE DE CATÁLOGO (estimativa própria de CDQ)
     ------------------------------------------------------------------------ */
  const COMP_LABEL = { titulo:'Título', bullets:'Bullets', imagens:'Imagens', atributos:'Atributos', aplus:'A+', variacoes:'Variações' };

  function gradeTagClass(g){
    if (g === 'A') return 'good';
    if (g === 'B') return 'info';
    if (g === 'C') return 'warn';
    if (g === 'D') return 'bad';
    return 'muted';
  }
  function gradeTag(g){ return g ? `<span class="tag ${gradeTagClass(g)}">${esc(g)}</span>` : '<span class="tag muted">—</span>'; }
  function compTooltip(comp){
    if (!comp) return '';
    const partes = ['Score ' + (comp.score != null ? NUM(comp.score) : '—')];
    if (comp.motivo) partes.push(comp.motivo);
    if (comp.obs) partes.push(comp.obs);
    if (comp.comprimento != null) partes.push(comp.comprimento + ' caracteres');
    if (comp.quantidade != null) partes.push(comp.quantidade + ' itens');
    if (comp.alta_resolucao != null) partes.push(comp.alta_resolucao ? 'alta resolução' : 'resolução baixa');
    if (comp.issues_count != null) partes.push(comp.issues_count + ' problema(s)');
    if (comp.presente != null) partes.push(comp.presente ? 'presente' : 'ausente');
    if (comp.tema) partes.push('tema: ' + comp.tema);
    return partes.join(' · ');
  }
  function compBadge(comp){
    if (!comp) return '<span class="tag muted">—</span>';
    return `<span class="tag ${gradeTagClass(comp.grau)}" title="${esc(compTooltip(comp))}">${esc(comp.grau)}</span>`;
  }

  // uma linha por ASIN de qualidade, nas contas selecionadas, excluindo nao_pertence_a_conta
  function montarQualidadePeriodo(){
    const linhas = [];
    state.contas.forEach(k => {
      const q = CONTAS[k].qualidade || {};
      const asins = q.asins || {};
      const excluir = new Set(q.nao_pertence_a_conta || []);
      Object.keys(asins).forEach(asin => {
        if (excluir.has(asin)) return;
        const a = asins[asin] || {};
        const info = catalogInfo(k, asin);
        linhas.push({
          asin, contaKey:k, nome:info.nome, imagem:info.imagem,
          score: a.score_geral, grau: a.grau_geral,
          variacaoAplicavel: !!a.variacao_aplicavel,
          comp: a.componentes || {}
        });
      });
    });
    return linhas;
  }

  function montarAlertasQualidade(linhas){
    const alerts = [];
    linhas.forEach(l => {
      const compsD = Object.keys(l.comp).filter(ck => l.comp[ck] && l.comp[ck].grau === 'D');
      if (compsD.length) alerts.push({...l, compsD});
    });
    return alerts.sort((a,b) => (a.score ?? 0) - (b.score ?? 0));
  }

  // nota CDQ (estimativa) da conta: média simples de score_geral entre os ASINs avaliados
  function renderQualidadeKPIs(linhasTodas){
    const wrap = document.getElementById('qualKpiRow');
    if (!linhasTodas.length) { wrap.innerHTML = '<div class="empty">Sem dados de qualidade ainda para as contas selecionadas.</div>'; return; }

    const porConta = {};
    state.contas.forEach(k => porConta[k] = {soma:0, n:0});
    linhasTodas.forEach(l => {
      if (porConta[l.contaKey] && l.score != null) { porConta[l.contaKey].soma += l.score; porConta[l.contaKey].n++; }
    });

    const cardsConta = state.contas.map(k => {
      const d = porConta[k];
      const media = d.n > 0 ? d.soma / d.n : null;
      return `<div class="kpi"><div class="lab">Nota CDQ (estim.) · ${esc(CONTA_NOME[k])}</div><div class="val">${media == null ? '—' : NUM(media)}</div><div class="hint">${d.n} ASIN(s) avaliado(s)</div></div>`;
    });

    let cardCombinada = '';
    if (state.contas.length > 1) {
      const nTotal = linhasTodas.length;
      const somaTotal = linhasTodas.reduce((s,l) => s + (l.score || 0), 0);
      cardCombinada = `<div class="kpi"><div class="lab">Nota CDQ (estim.) · combinada</div><div class="val">${nTotal > 0 ? NUM(somaTotal / nTotal) : '—'}</div><div class="hint">${nTotal} ASIN(s) · ${state.contas.length} conta(s)</div></div>`;
    }

    wrap.innerHTML = cardCombinada + cardsConta.join('');
  }

  function renderQualidade(){
    const linhasTodas = montarQualidadePeriodo();

    renderQualidadeKPIs(linhasTodas);

    // ---- distribuição de graus, por conta ----
    const porContaGrau = {};
    state.contas.forEach(k => porContaGrau[k] = {A:0,B:0,C:0,D:0});
    linhasTodas.forEach(l => { if (porContaGrau[l.contaKey] && porContaGrau[l.contaKey][l.grau] != null) porContaGrau[l.contaKey][l.grau]++; });

    destroyChart('qualidadeGraus');
    charts.qualidadeGraus = new Chart(document.getElementById('chQualidadeGraus'), {
      type:'bar',
      data:{ labels: state.contas.map(k=>CONTA_NOME[k]),
        datasets:[
          {label:'A', data: state.contas.map(k=>porContaGrau[k].A), backgroundColor:'#2C7A57', borderRadius:4, stack:'s'},
          {label:'B', data: state.contas.map(k=>porContaGrau[k].B), backgroundColor:'#17868C', borderRadius:4, stack:'s'},
          {label:'C', data: state.contas.map(k=>porContaGrau[k].C), backgroundColor:'#9C6510', borderRadius:4, stack:'s'},
          {label:'D', data: state.contas.map(k=>porContaGrau[k].D), backgroundColor:'#A32E2A', borderRadius:4, stack:'s'}
        ] },
      options: { ...baseGridOpts(), scales:{ x:{...baseGridOpts().scales.x, stacked:true}, y:{...baseGridOpts().scales.y, stacked:true} } }
    });

    // ---- alerta de defeitos críticos (Grau D em qualquer componente) ----
    const alertas = montarAlertasQualidade(linhasTodas);
    const tbAlerta = document.querySelector('#tblQualidadeAlerta tbody');
    if (!linhasTodas.length) renderEmptyRow(tbAlerta, 5, 'Sem dados de qualidade ainda para as contas selecionadas.');
    else if (!alertas.length) renderEmptyRow(tbAlerta, 5, 'Nenhum defeito crítico (Grau D) encontrado nas contas selecionadas.');
    else tbAlerta.innerHTML = tbodyHTML('qualAlerta', alertas, 5, a => `<tr>
      <td><div class="prodcell">
        ${a.imagem ? `<img class="thumb" src="${esc(a.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
        <div><div class="prodname">${esc(a.nome)}</div><div class="asincode">${linkAsin(a.asin)}</div></div>
      </div></td>
      <td><span class="tag muted">${esc(CONTA_NOME[a.contaKey])}</span></td>
      <td>${a.compsD.map(ck => `<span class="tag bad" style="margin-right:3px">${esc(COMP_LABEL[ck] || ck)}</span>`).join('')}</td>
      <td class="num">${NUM2(a.score)}</td>
      <td>${gradeTag(a.grau)}</td>
    </tr>`);

    // ---- tabela principal: busca, filtro por grau, ordenação ----
    let linhas = linhasTodas;
    if (state.qualBusca) linhas = linhas.filter(l => l.nome.toLowerCase().includes(state.qualBusca) || l.asin.toLowerCase().includes(state.qualBusca));
    if (state.qualFiltroGrau) linhas = linhas.filter(l => l.grau === state.qualFiltroGrau);

    const piorComponenteScore = l => {
      const scores = Object.values(l.comp).map(c => (c && c.score != null) ? c.score : 100);
      return scores.length ? Math.min(...scores) : 100;
    };
    const ord = state.qualOrdenar;
    linhas = [...linhas].sort((a,b) => {
      if (ord === 'score_asc') return (a.score ?? 0) - (b.score ?? 0);
      if (ord === 'score_desc') return (b.score ?? 0) - (a.score ?? 0);
      if (ord === 'pior_componente') return piorComponenteScore(a) - piorComponenteScore(b);
      if (ord === 'nome_asc') return a.nome.localeCompare(b.nome, 'pt-BR');
      return 0;
    });

    document.getElementById('qualCount').textContent = linhas.length + ' produto(s)';
    const tbody = document.querySelector('#tblQualidade tbody');
    if (!linhas.length) { renderEmptyRow(tbody, 10, linhasTodas.length ? 'Nenhum produto encontrado.' : 'Sem dados de qualidade ainda para as contas selecionadas.'); return; }

    tbody.innerHTML = tbodyHTML('qualidade', linhas, 10, l => `<tr>
      <td><div class="prodcell">
        ${l.imagem ? `<img class="thumb" src="${esc(l.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
        <div><div class="prodname">${esc(l.nome)}</div><div class="asincode">${linkAsin(l.asin)}</div></div>
      </div></td>
      <td><span class="tag muted">${esc(CONTA_NOME[l.contaKey])}</span></td>
      <td class="num">${NUM2(l.score)}</td>
      <td>${gradeTag(l.grau)}</td>
      <td>${compBadge(l.comp.titulo)}</td>
      <td>${compBadge(l.comp.bullets)}</td>
      <td>${compBadge(l.comp.imagens)}</td>
      <td>${compBadge(l.comp.atributos)}</td>
      <td>${compBadge(l.comp.aplus)}</td>
      <td>${l.variacaoAplicavel ? compBadge(l.comp.variacoes) : '<span class="tag muted">N/A</span>'}</td>
    </tr>`);
  }

  /* ------------------------------------------------------------------------
     6c. SAÚDE DOS LISTINGS (bloco `qualidadeListings`: status/erros/avisos reais da Amazon)
     Fonte independente do bloco `qualidade` (CDQ estimado) da seção 6b: não misturar os dois.
     Último snapshot de cada conta, não depende do filtro de período.
     ------------------------------------------------------------------------ */

  // uma linha por ASIN, nas contas selecionadas
  function montarListings(){
    const linhas = [];
    state.contas.forEach(k => {
      const ql = CONTAS[k].qualidadeListings || {};
      const asins = ql.asins || {};
      const suprSet = new Set(ql.listaSuprimidos || []);
      const chaves = new Set([...Object.keys(asins), ...suprSet]);
      chaves.forEach(asin => {
        const a = asins[asin] || {};
        const erros = a.erros || [];
        const avisos = a.avisos || [];
        const info = catalogInfo(k, asin);
        linhas.push({
          asin, contaKey:k, nome:info.nome, imagem:info.imagem,
          sku: a.sku || '',
          suprimido: !!a.suprimido || suprSet.has(asin),
          erros, avisos,
          qtdErros: a.qtdErros != null ? a.qtdErros : erros.length,
          qtdAvisos: a.qtdAvisos != null ? a.qtdAvisos : avisos.length
        });
      });
    });
    return linhas;
  }

  // texto pesquisável de uma linha (nome, ASIN, SKU e mensagens)
  function alvoBuscaListing(l, campo){
    const msgs = (campo === 'avisos' ? l.avisos : l.erros).map(i => (i.codigo || '') + ' ' + (i.mensagem || ''));
    return [l.nome, l.asin, l.sku, ...msgs].join(' ').toLowerCase();
  }

  function ordenarListings(linhas, ord, campoQtd){
    return [...linhas].sort((a,b) => {
      if (ord === 'erros_desc') return (b.qtdErros - a.qtdErros) || a.nome.localeCompare(b.nome, 'pt-BR');
      if (ord === 'avisos_desc') return (b.qtdAvisos - a.qtdAvisos) || a.nome.localeCompare(b.nome, 'pt-BR');
      if (ord === 'nome_asc') return a.nome.localeCompare(b.nome, 'pt-BR');
      if (ord === 'conta_asc') return CONTA_NOME[a.contaKey].localeCompare(CONTA_NOME[b.contaKey], 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR');
      if (ord === 'sku_asc') return String(a.sku).localeCompare(String(b.sku), 'pt-BR', {numeric:true});
      return 0;
    });
  }

  // lista de issues (erros ou avisos) de um ASIN, com código e mensagem
  function issuesHTML(lista, tipo){
    if (!lista.length) return '<span class="empty" style="padding:0">—</span>';
    const cls = tipo === 'erro' ? 'bad' : 'warn';
    return '<div class="lst-issues">' + lista.map(i => {
      const attrs = (i.atributos && i.atributos.length) ? ` <span class="lst-attrs">(atributos: ${esc(i.atributos.join(', '))})</span>` : '';
      return `<div class="lst-issue"><span class="tag ${cls}">${esc(i.codigo || (tipo === 'erro' ? 'erro' : 'aviso'))}</span><span>${esc(i.mensagem || 'Sem mensagem')}${attrs}</span></div>`;
    }).join('') + '</div>';
  }

  function celulaProdutoListing(l){
    return `<td><div class="prodcell">
      ${l.imagem ? `<img class="thumb" src="${esc(l.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
      <div><div class="prodname">${esc(l.nome)}</div><div class="asincode">${linkAsin(l.asin)}</div></div>
    </div></td>`;
  }

  function renderListingsKPIs(){
    const wrap = document.getElementById('listKpiRow');
    // resumo por conta: usa o `resumo` do bloco; se faltar, recalcula a partir dos ASINs
    const resumos = [];
    state.contas.forEach(k => {
      const ql = CONTAS[k].qualidadeListings || {};
      let r = ql.resumo;
      if (!r || !r.totalAsins) {
        const asins = Object.values(ql.asins || {});
        if (!asins.length) return;
        const saud = asins.filter(a => !(a.qtdErros > 0) && !(a.qtdAvisos > 0)).length;
        r = { totalAsins: asins.length, suprimidos: asins.filter(a => a.suprimido).length,
              comErro: asins.filter(a => a.qtdErros > 0).length, comAviso: asins.filter(a => a.qtdAvisos > 0).length,
              saudaveis: saud, pctSaudaveis: 100 * saud / asins.length };
      }
      resumos.push({ k, r });
    });
    if (!resumos.length) { wrap.innerHTML = '<div class="empty">Sem dados de saúde de listings para as contas selecionadas (rode capturar_qualidade_listings.py e o transformar_vendor.py).</div>'; return; }

    const cardHTML = (titulo, r) => `<div class="kpi${r.suprimidos > 0 ? ' alert' : ''}">
      <div class="lab">${esc(titulo)}</div>
      <div class="val">${PCTRAW(r.pctSaudaveis)}</div>
      <div class="hint">saudáveis (sem erro nem aviso): ${NUM(r.saudaveis)} de ${NUM(r.totalAsins)} ASINs</div>
      <div class="hint"><b>${NUM(r.suprimidos)}</b> suprimidos · ${NUM(r.comErro)} com erro · ${NUM(r.comAviso)} com aviso</div>
    </div>`;

    let combinado = '';
    if (resumos.length > 1) {
      const t = resumos.reduce((s, x) => ({
        totalAsins: s.totalAsins + (x.r.totalAsins||0), suprimidos: s.suprimidos + (x.r.suprimidos||0),
        comErro: s.comErro + (x.r.comErro||0), comAviso: s.comAviso + (x.r.comAviso||0), saudaveis: s.saudaveis + (x.r.saudaveis||0)
      }), {totalAsins:0, suprimidos:0, comErro:0, comAviso:0, saudaveis:0});
      t.pctSaudaveis = t.totalAsins > 0 ? 100 * t.saudaveis / t.totalAsins : null;
      combinado = cardHTML('Saúde do catálogo · combinada', t);
    }
    wrap.innerHTML = combinado + resumos.map(x => cardHTML('Saúde do catálogo · ' + CONTA_NOME[x.k], x.r)).join('');
  }

  function renderListingsSuprimidos(todas){
    const temDado = todas.length > 0;
    let linhas = todas.filter(l => l.suprimido);
    const totalSupr = linhas.length;
    if (state.listBusca) linhas = linhas.filter(l => alvoBuscaListing(l, 'erros').includes(state.listBusca));
    linhas = ordenarListings(linhas, state.listOrdenar);

    document.getElementById('listCount').textContent = linhas.length + (linhas.length !== totalSupr ? ' de ' + totalSupr : '') + ' ASIN(s) suprimido(s)';
    const tbody = document.querySelector('#tblListSuprimidos tbody');
    if (!temDado) { renderEmptyRow(tbody, 5, 'Sem dados de saúde de listings para as contas selecionadas.'); return; }
    if (!linhas.length) { renderEmptyRow(tbody, 5, totalSupr ? 'Nenhum ASIN encontrado com essa busca.' : 'Nenhum ASIN suprimido nas contas selecionadas.'); return; }

    tbody.innerHTML = tbodyHTML('suprimidos', linhas, 5, l => `<tr>
      ${celulaProdutoListing(l)}
      <td><span class="tag muted">${esc(CONTA_NOME[l.contaKey])}</span></td>
      <td>${esc(l.sku) || '—'}</td>
      <td>${issuesHTML(l.erros, 'erro')}</td>
      <td class="num">${NUM(l.qtdAvisos)}</td>
    </tr>`);
  }

  function renderListingsAvisos(todas){
    const temDado = todas.length > 0;
    // só avisos, sem supressão (suprimidos já aparecem na lista acima)
    let linhas = todas.filter(l => !l.suprimido && l.qtdAvisos > 0);
    const totalAv = linhas.length;
    if (state.avisoBusca) linhas = linhas.filter(l => alvoBuscaListing(l, 'avisos').includes(state.avisoBusca));
    linhas = ordenarListings(linhas, state.avisoOrdenar);

    document.getElementById('avisoCount').textContent = linhas.length + (linhas.length !== totalAv ? ' de ' + totalAv : '') + ' ASIN(s) com aviso';
    const tbody = document.querySelector('#tblListAvisos tbody');
    if (!temDado) { renderEmptyRow(tbody, 5, 'Sem dados de saúde de listings para as contas selecionadas.'); return; }
    if (!linhas.length) { renderEmptyRow(tbody, 5, totalAv ? 'Nenhum ASIN encontrado com essa busca.' : 'Nenhum ASIN com aviso (fora os suprimidos) nas contas selecionadas.'); return; }

    tbody.innerHTML = tbodyHTML('avisos', linhas, 5, l => `<tr>
      ${celulaProdutoListing(l)}
      <td><span class="tag muted">${esc(CONTA_NOME[l.contaKey])}</span></td>
      <td>${esc(l.sku) || '—'}</td>
      <td>${issuesHTML(l.avisos, 'aviso')}</td>
      <td>${l.qtdErros > 0 ? issuesHTML(l.erros, 'erro') : '<span class="empty" style="padding:0">—</span>'}</td>
    </tr>`);
  }

  function renderListings(){
    const todas = montarListings();
    renderListingsKPIs();
    renderListingsSuprimidos(todas);
    renderListingsAvisos(todas);
  }

  /* ------------------------------------------------------------------------
     7. RENDERIZAÇÃO — GRÁFICOS E SEÇÕES
     ------------------------------------------------------------------------ */
  let charts = {};
  function destroyChart(id){ if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
  function baseGridOpts(){
    return {
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{boxWidth:10,boxHeight:10,font:{size:11}}}},
      scales:{
        x:{grid:{display:false}, ticks:{font:{size:10}}},
        y:{grid:{color:'#EEF2F2'}, ticks:{font:{size:10}}}
      }
    };
  }

  function renderKPIs(tot, meses, diagGrupos){
    const npmBlend = tot.npmDen>0 ? tot.npmNum/tot.npmDen : null;
    const conv = tot.glanceViews>0 ? tot.shippedUnits/tot.glanceViews : null;
    const ticket = tot.shippedUnits>0 ? tot.shippedRevenue/tot.shippedUnits : null;
    const skusAtivos = topAsinsPeriodo(meses).length;
    const impactoTotal = diagGrupos.reduce((s,g) => s + (g.tipo === 'oportunidade' ? 0 : g.impacto), 0);

    document.getElementById('kpiRow').innerHTML = `
      <div class="kpi"><div class="lab">Faturamento</div><div class="val">${MOEDA(tot.shippedRevenue)}</div><div class="hint">${meses.length} mês(es) · ${state.contas.length} conta(s)</div></div>
      <div class="kpi"><div class="lab">Unidades pedidas</div><div class="val">${NUM(tot.shippedUnits)}</div><div class="hint">receita pedida (ordered)</div></div>
      <div class="kpi"><div class="lab">Ticket médio</div><div class="val">${MOEDA2(ticket)}</div><div class="hint">receita ÷ unidades</div></div>
      <div class="kpi"><div class="lab">Margem líquida (NPM)</div><div class="val">${PCT(npmBlend)}</div><div class="hint">ponderada por faturamento</div></div>
      <div class="kpi"><div class="lab">Conversão</div><div class="val">${PCT(conv)}</div><div class="hint">${NUM(tot.glanceViews)} visitas</div></div>
      <div class="kpi alert"><div class="lab">Impacto de problemas</div><div class="val">${MOEDA(impactoTotal)}</div><div class="hint">soma dos diagnósticos (exceto oportunidades)</div></div>
    `;
  }

  function renderFaturamento(porConta, meses){
    destroyChart('fatConta');
    charts.fatConta = new Chart(document.getElementById('chFatConta'), {
      type:'bar',
      data:{ labels: state.contas.map(k=>CONTA_NOME[k]),
        datasets:[{ label:'Faturamento', data: state.contas.map(k=>porConta[k].shippedRevenue), backgroundColor:'#17868C', borderRadius:5 }] },
      options: { ...baseGridOpts(), plugins:{legend:{display:false}} }
    });

    destroyChart('fatMes');
    charts.fatMes = new Chart(document.getElementById('chFatMes'), {
      type:'line',
      data:{ labels: meses.map(MESLABEL),
        datasets: state.contas.map((k,i)=>({
          label: CONTA_NOME[k],
          data: meses.map(m => ((CONTAS[k].aggVendas||{})[m]||{}).shippedRevenue || 0),
          borderColor: PALETTE[i%PALETTE.length], backgroundColor:'transparent', tension:.3, pointRadius:2
        })) },
      options: baseGridOpts()
    });
  }

  function renderEstoque(porMes, meses){
    destroyChart('estoque');
    charts.estoque = new Chart(document.getElementById('chEstoque'), {
      type:'bar',
      data:{ labels: meses.map(MESLABEL),
        datasets:[
          {label:'Saudável', data: meses.map(m=>Math.max(0,(porMes[m].sellableCost||0)-(porMes[m].unhealthyCost||0))), backgroundColor:'#2C7A57', borderRadius:4, stack:'s'},
          {label:'Não saudável', data: meses.map(m=>porMes[m].unhealthyCost||0), backgroundColor:'#A32E2A', borderRadius:4, stack:'s'}
        ] },
      options: { ...baseGridOpts(), scales:{ x:{...baseGridOpts().scales.x, stacked:true}, y:{...baseGridOpts().scales.y, stacked:true} } }
    });

    destroyChart('conv');
    charts.conv = new Chart(document.getElementById('chConv'), {
      type:'line',
      data:{ labels: meses.map(MESLABEL),
        datasets:[{ label:'Conversão', data: meses.map(m => porMes[m].glanceViews>0 ? porMes[m].shippedUnits/porMes[m].glanceViews : null),
          borderColor:'#17868C', backgroundColor:'#DCEEEF', fill:true, tension:.3, pointRadius:2 }] },
      options: { ...baseGridOpts(), plugins:{legend:{display:false}},
        scales:{ ...baseGridOpts().scales, y:{...baseGridOpts().scales.y, ticks:{callback:v=>(v*100).toFixed(0)+'%'}} } }
    });

    destroyChart('cobertura');
    charts.cobertura = new Chart(document.getElementById('chCobertura'), {
      type:'line',
      data:{ labels: meses.map(MESLABEL),
        datasets:[{ label:'Dias de cobertura',
          data: meses.map(m => {
            const velocidadeDiaria = porMes[m].shippedUnitsReal / 30;
            return velocidadeDiaria > 0 ? porMes[m].sellableUnits / velocidadeDiaria : null;
          }),
          borderColor:'#9C6510', backgroundColor:'transparent', tension:.3, pointRadius:2 }] },
      options: { ...baseGridOpts(), plugins:{legend:{display:false}} }
    });

    destroyChart('ruptura');
    charts.ruptura = new Chart(document.getElementById('chRuptura'), {
      type:'line',
      data:{ labels: meses.map(MESLABEL),
        datasets:[{ label:'Ruptura (OOS)', data: meses.map(m => porMes[m].oosDen>0 ? porMes[m].oosNum/porMes[m].oosDen : null),
          borderColor:'#A32E2A', backgroundColor:'#F6E0DE', fill:true, tension:.3, pointRadius:2 }] },
      options: { ...baseGridOpts(), plugins:{legend:{display:false}},
        scales:{ ...baseGridOpts().scales, y:{...baseGridOpts().scales.y, min:0, max:1, ticks:{callback:v=>(v*100).toFixed(0)+'%'}} } }
    });
  }

  function renderSellIn(meses){
    // Respeita o filtro de período (state.de..state.ate).
    // Gráfico: sell-in = custo do que a Amazon RECEBEU, pelo mês do último recebimento
    //   (sellinRecebidoMes.custoRecebido), contra sell-out = custo do vendido (vendas.shippedCogs).
    // KPIs e tabela: POs CRIADOS no período (sellinMes), somando .pos mês a mês
    //   (totalPOs cobre o arquivo inteiro e não serve para período).
    const noPeriodo = m => m >= state.de && m <= state.ate;
    const mesesSell = SELLIN_MONTHS.filter(noPeriodo);
    const sellinPorMes = {}, sellOutPorMes = {}, recPoPorMes = {}, recPoJaRecebido = {};   // recPoPorMes: valor TOTAL (confirmado) dos POs que já receberam algo, no mês de CRIAÇÃO do PO; recPoJaRecebido: quanto disso já foi recebido
    mesesSell.forEach(m => { sellinPorMes[m] = 0; sellOutPorMes[m] = 0; recPoPorMes[m] = 0; recPoJaRecebido[m] = 0; });

    let totPOs = 0, totConf = 0, totRej = 0, totRec = 0;
    const linhasConta = [];
    state.contas.forEach(k => {
      const c = CONTAS[k];
      const sm = c.sellinMes || {};
      const srm = c.sellinRecebidoMes || {};
      Object.keys(srm).forEach(m => {
        if (sellinPorMes[m] == null) return;
        sellinPorMes[m] += srm[m].custoRecebido || 0;
      });
      let posConta = 0, confConta = 0, rejConta = 0, recConta = 0;
      Object.keys(sm).forEach(m => {
        if (!noPeriodo(m)) return;
        posConta += sm[m].pos || 0;
        confConta += sm[m].conf || 0;
        rejConta += sm[m].rej || 0;
        recConta += sm[m].recebido || 0;
      });
      totPOs += posConta; totConf += confConta; totRej += rejConta; totRec += recConta;
      linhasConta.push({ k, pos:posConta, conf:confConta, rej:rejConta, rec:recConta });

      (c.pedidos || []).forEach(po => {
        const m = (po.data || '').slice(0, 7), t = po.tot || {};
        if (recPoPorMes[m] == null || !(t.recebido > 0)) return;
        recPoPorMes[m] += t.custo || 0; recPoJaRecebido[m] += t.custoRecebido || 0;
      });

      const vendas = c.vendas || {};
      Object.keys(vendas).forEach(asin => {
        Object.keys(vendas[asin]).forEach(m => {
          if (sellOutPorMes[m] == null) return;
          sellOutPorMes[m] += vendas[asin][m].shippedCogs || 0;
        });
      });
    });

    destroyChart('sellGap');
    if (!mesesSell.length) {
      const ctx = document.getElementById('chSellGap');
      ctx.getContext('2d').clearRect(0,0,ctx.width,ctx.height);
    } else {
      charts.sellGap = new Chart(document.getElementById('chSellGap'), {
        type:'bar',
        data:{ labels: mesesSell.map(MESLABEL),
          datasets:[
            {label:'Sell-in (recebido, custo)', data: mesesSell.map(m=>sellinPorMes[m]), backgroundColor:'#17868C', borderRadius:4},
            {label:'POs recebidas (valor total, pelo mês do PO)', data: mesesSell.map(m=>recPoPorMes[m]), backgroundColor:'#2C7A57', borderRadius:4},
            {label:'Sell-out (venda, custo)', data: mesesSell.map(m=>sellOutPorMes[m]), backgroundColor:'#9C6510', borderRadius:4}
          ] },
        options: { ...baseGridOpts(), plugins: { ...(baseGridOpts().plugins || {}), tooltip: { callbacks: {
          label: c => c.dataset.label + ': ' + MOEDA2(c.raw),
          afterLabel: c => c.datasetIndex === 1 ? ['Já recebido: ' + MOEDA2(recPoJaRecebido[mesesSell[c.dataIndex]]), 'A receber: ' + MOEDA2(c.raw - recPoJaRecebido[mesesSell[c.dataIndex]])] : []
        } } } }
      });
    }

    const rejPct = (totConf+totRej) > 0 ? totRej/(totConf+totRej) : null;
    document.getElementById('poKpisBox').innerHTML = `
      <div class="kpis" style="grid-template-columns:1fr 1fr;height:100%">
        <div class="kpi"><div class="lab">POs criados no período</div><div class="val">${NUM(totPOs)}</div></div>
        <div class="kpi"><div class="lab">Taxa de rejeição</div><div class="val">${PCT(rejPct)}</div></div>
      </div>`;

    const tbody = document.querySelector('#tblSellin tbody');
    if (!linhasConta.some(l => l.pos || l.conf || l.rej || l.rec)) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">Sem dados de sell-in para as contas e o período selecionados.</td></tr>';
    } else {
      tbody.innerHTML = linhasConta.map(l => `<tr>
        <td>${esc(CONTA_NOME[l.k])}</td><td class="num">${NUM(l.pos)}</td><td class="num">${NUM(l.conf)}</td><td class="num">${NUM(l.rej)}</td><td class="num">${NUM(l.rec)}</td>
      </tr>`).join('');
    }
  }

  /* ---- Pedidos de compra (lista por PO, com itens) ---- */
  const DATA_BR = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'}); };
  const DATA_CURTA = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit'}); };
  function statusPedidoTag(p){
    if (p.status === 'SEM_STATUS') return '<span class="tag warn">Sem status</span>';
    if (p.atrasado) return `<span class="tag bad">Atrasado ${NUM(p.diasAtraso)} d</span>`;
    if (p.status === 'OPEN') return '<span class="tag info">Aberto</span>';
    if (p.status === 'CLOSED') return '<span class="tag muted">Fechado</span>';
    return `<span class="tag muted">${esc(p.status || '—')}</span>`;
  }
  function statusItemTag(i){
    if (i.statusRec == null) return '<span class="tag muted">—</span>';
    if (i.atrasado) return '<span class="tag bad">Atrasado</span>';
    const mapa = { RECEIVED:['good','Recebido'], PARTIALLY_RECEIVED:['warn','Parcial'], NOT_RECEIVED:['muted','Não recebido'] };
    const [cls, txt] = mapa[i.statusRec] || ['muted', i.statusRec];
    return `<span class="tag ${cls}">${esc(txt)}</span>`;
  }
  function pedidosFiltrados(){
    const busca = state.pedBusca;
    const linhas = [];
    state.contas.forEach(k => (CONTAS[k].pedidos || []).forEach(p => {
      if (state.pedMes && (p.data || '').slice(0,7) !== state.pedMes) return;
      if (state.pedStatus === 'ATRASADO' && !p.atrasado) return;
      if (state.pedStatus && state.pedStatus !== 'ATRASADO' && p.status !== state.pedStatus) return;
      if (busca) {
        const alvo = [p.po, ...(p.itens || []).flatMap(i => [i.asin, i.ean, catalogInfo(k, i.asin).nome])]
          .filter(Boolean).join(' ').toLowerCase();
        if (!alvo.includes(busca)) return;
      }
      linhas.push({ ...p, k });
    }));
    return linhas.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  }
  function renderPedidos(){
    const tbody = document.querySelector('#tblPedidos tbody');
    const temDado = state.contas.some(k => (CONTAS[k].pedidos || []).length);
    const linhas = pedidosFiltrados();
    const tot = linhas.reduce((a, p) => { const t = p.tot || {}; a.conf += t.conf||0; a.custo += t.custo||0; a.rec += t.custoRecebido||0; return a; }, {conf:0, custo:0, rec:0});
    document.getElementById('pedCount').textContent = `${NUM(linhas.length)} pedido(s) · ${NUM(tot.conf)} un. confirmadas · ${MOEDA(tot.custo)} confirmado · ${MOEDA(tot.rec)} recebido`;
    const infos = state.contas.map(k => (CONTAS[k].sellinInfo || {}).statusAtualizadoAte).filter(Boolean).sort();
    document.getElementById('pedRodape').textContent = infos.length
      ? `Status de recebimento conforme a última captura (mais recente: ${DATA_BR(infos[infos.length-1])}). Atrasado = pedido aberto, janela de entrega vencida e quantidade confirmada ainda não recebida.`
      : '';
    if (!temDado) { renderEmptyRow(tbody, 13, 'Sem pedidos no dados_vendor.json para as contas selecionadas (rode o transformar_vendor.py atualizado).'); return; }
    if (!linhas.length) { renderEmptyRow(tbody, 13, 'Nenhum pedido com esses filtros.'); return; }

    tbody.innerHTML = tbodyHTML('pedidos', linhas, 13, p => {
      const t = p.tot || {};
      const chave = p.k + '|' + p.po;
      const aberto = state.pedAbertos.has(chave);
      const janela = p.janelaIni || p.janelaFim ? `${DATA_CURTA(p.janelaIni)} a ${DATA_BR(p.janelaFim)}` : '—';
      let html = `<tr class="pedrow${aberto ? ' aberto' : ''}" data-chave="${esc(chave)}">
        <td><span class="caret">▶</span></td>
        <td>${DATA_BR(p.data)}</td>
        <td><span class="ponum">${esc(p.po)}</span></td>
        <td><span class="tag muted">${esc(CONTA_NOME[p.k])}</span></td>
        <td>${statusPedidoTag(p)}</td>
        <td>${janela}</td>
        <td class="num">${NUM(t.itens)}</td><td class="num">${NUM(t.pedido)}</td><td class="num">${NUM(t.conf)}</td>
        <td class="num">${NUM(t.rej)}</td><td class="num">${NUM(t.recebido)}</td>
        <td class="num">${MOEDA2(t.custo)}</td><td class="num">${MOEDA2(t.custoRecebido)}</td>
      </tr>`;
      if (aberto) {
        const itens = (p.itens || []).map(i => {
          const info = catalogInfo(p.k, i.asin);
          return `<tr>
            <td><div class="prodcell">${info.imagem ? `<img class="thumb" src="${esc(info.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
              <div><div class="prodname">${esc(info.nome)}</div><div class="asincode">${linkAsin(i.asin)}${i.ean ? ' · EAN ' + esc(i.ean) : ''}</div></div></div></td>
            <td class="num">${NUM(i.pedido)}</td><td class="num">${NUM(i.cancelado)}</td><td class="num">${NUM(i.conf)}</td>
            <td class="num">${NUM(i.rej)}</td><td class="num">${NUM(i.recebido)}</td>
            <td>${statusItemTag(i)}</td><td>${DATA_BR(i.dataReceb)}</td>
            <td class="num">${MOEDA2(i.custoUn)}</td><td class="num">${MOEDA2(i.precoLista)}</td>
            <td class="num">${MOEDA2((i.confValido ?? i.conf ?? i.pedido ?? 0) * (i.custoUn || 0))}</td>
          </tr>`;
        }).join('');
        html += `<tr class="peddet"><td colspan="13">
          <div class="pedmeta">Última atualização do status: ${DATA_BR(p.atualizado)}${p.estado ? ' · Estado: ' + esc(p.estado) : ''}${p.tipo ? ' · Tipo: ' + esc(p.tipo) : ''}${p.destino ? ' · Destino: ' + esc(p.destino) : ''}</div>
          <table class="tbl itens"><thead><tr>
            <th>Produto</th><th class="num">Pedido</th><th class="num">Cancelado</th><th class="num">Confirmado</th><th class="num">Rejeitado</th>
            <th class="num">Recebido</th><th>Recebimento</th><th>Últ. recebimento</th><th class="num">Custo un.</th><th class="num">Preço de lista</th><th class="num">Total</th>
          </tr></thead><tbody>${itens || '<tr><td colspan="11" class="empty">Pedido sem itens no arquivo capturado.</td></tr>'}</tbody></table>
        </td></tr>`;
      }
      return html;
    });
  }
  function linhasItensPedidos(lista){
    const rows = [['Data do pedido','Nº do pedido','Conta','Status do pedido','Atrasado (dias)','Início janela','Fim janela','ASIN','EAN','Produto',
                   'Pedido','Cancelado','Confirmado','Rejeitado','Recebido','Status recebimento','Últ. recebimento','Custo un.','Preço de lista','Total confirmado']];
    const dt = iso => iso ? DATA_BR(iso) : '';
    const stPed = p => p.status === 'SEM_STATUS' ? 'Sem status' : p.status === 'OPEN' ? 'Aberto' : p.status === 'CLOSED' ? 'Fechado' : (p.status || '');
    const stRec = s => ({RECEIVED:'Recebido', PARTIALLY_RECEIVED:'Parcial', NOT_RECEIVED:'Não recebido'}[s] || s || '');
    lista.forEach(p => (p.itens || []).forEach(i => rows.push([
      dt(p.data), p.po, CONTA_NOME[p.k], stPed(p), p.atrasado ? p.diasAtraso : '', dt(p.janelaIni), dt(p.janelaFim),
      i.asin, i.ean || '', catalogInfo(p.k, i.asin).nome, i.pedido, i.cancelado, i.conf, i.rej, i.recebido, stRec(i.statusRec), dt(i.dataReceb),
      i.custoUn, i.precoLista, (i.confValido ?? i.conf ?? i.pedido ?? 0) * (i.custoUn || 0)
    ])));
    return rows;
  }
  document.getElementById('btnPedXLSX').onclick = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhasItensPedidos(pedidosFiltrados())), 'Pedidos (itens)');
    XLSX.writeFile(wb, `pedidos-de-compra_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  function renderMargemMarkup(porMes, meses){
    destroyChart('margemMarkup');
    charts.margemMarkup = new Chart(document.getElementById('chMargemMarkup'), {
      type:'line',
      data:{ labels: meses.map(MESLABEL),
        datasets:[
          { label:'Margem líquida (NPM)', data: meses.map(m => porMes[m].npmDen>0 ? porMes[m].npmNum/porMes[m].npmDen : null),
            borderColor:'#17868C', backgroundColor:'transparent', tension:.3, pointRadius:2 },
          { label:'Markup varejo', data: meses.map(m => porMes[m].markupDen>0 ? porMes[m].markupNum/porMes[m].markupDen : null),
            borderColor:'#9C6510', backgroundColor:'transparent', tension:.3, pointRadius:2, borderDash:[5,3] }
        ] },
      options: { ...baseGridOpts(),
        scales:{ ...baseGridOpts().scales, y:{...baseGridOpts().scales.y, ticks:{callback:v=>(v*100).toFixed(0)+'%'}} } }
    });
  }

  function renderPrevisao(){
    const somaMes = {};
    FUTURE_MONTHS.forEach(m => somaMes[m] = {mean:0,p70:0,p80:0,p90:0,valor:0,temDado:false});
    state.contas.forEach(k => {
      const pm = CONTAS[k].previsaoMes || {};
      Object.keys(pm).forEach(m => {
        if (!somaMes[m]) return;
        somaMes[m].mean += pm[m].mean||0; somaMes[m].p70 += pm[m].p70||0;
        somaMes[m].p80 += pm[m].p80||0; somaMes[m].p90 += pm[m].p90||0;
        somaMes[m].valor += pm[m].valor||0; somaMes[m].temDado = true;
      });
    });
    const mesesComDado = FUTURE_MONTHS.filter(m => somaMes[m].temDado);

    destroyChart('previsao');
    if (mesesComDado.length) {
      charts.previsao = new Chart(document.getElementById('chPrevisao'), {
        type:'line',
        data:{ labels: mesesComDado.map(MESLABEL),
          datasets:[
            {label:'Previsão (R$)', data: mesesComDado.map(m=>somaMes[m].valor), borderColor:'#17868C', backgroundColor:'#DCEEEF', fill:true, tension:.3, pointRadius:2},
            {label:'p90 (unid.)', data: mesesComDado.map(m=>somaMes[m].p90), borderColor:'#9C6510', backgroundColor:'transparent', borderDash:[5,3], tension:.3, pointRadius:2, yAxisID:'y1'},
            {label:'Média (unid.)', data: mesesComDado.map(m=>somaMes[m].mean), borderColor:'#5F7378', backgroundColor:'transparent', borderDash:[2,2], tension:.3, pointRadius:2, yAxisID:'y1'}
          ] },
        options: { ...baseGridOpts(),
          scales:{ x:{grid:{display:false},ticks:{font:{size:10}}},
            y:{grid:{color:'#EEF2F2'},ticks:{font:{size:10}}},
            y1:{position:'right',grid:{display:false},ticks:{font:{size:10}}} } }
      });
    }

    // top produtos por demanda prevista (snapshot, não filtrado por período)
    const linhas = [];
    state.contas.forEach(k => {
      const prev = CONTAS[k].previsao || {};
      Object.keys(prev).forEach(asin => {
        const info = catalogInfo(k, asin);
        linhas.push({ asin, contaKey:k, nome:info.nome, mean:prev[asin].mean, p90:prev[asin].p90 });
      });
    });
    linhas.sort((a,b)=>(b.mean||0)-(a.mean||0));
    const tbody = document.querySelector('#tblPrevisaoTop tbody');
    if (!linhas.length) { tbody.innerHTML = '<tr><td colspan="3" class="empty">Sem previsão disponível.</td></tr>'; }
    else tbody.innerHTML = linhas.slice(0,8).map(l => `<tr>
      <td><div class="prodname">${esc(l.nome)}</div><div class="asincode">${linkAsin(l.asin)} · ${esc(CONTA_NOME[l.contaKey])}</div></td>
      <td class="num">${NUM2(l.mean)}</td><td class="num">${NUM2(l.p90)}</td>
    </tr>`).join('');
  }

  function renderProdutosConcentracao(meses){
    const top = topAsinsPeriodo(meses).slice(0,10);
    destroyChart('topAsins');
    charts.topAsins = new Chart(document.getElementById('chTopAsins'), {
      type:'bar',
      data:{ labels: top.map(t => { const n = catalogInfo(t.contaKey, t.asin).nome; return n.length>34 ? n.slice(0,34)+'…' : n; }),
        datasets:[{ label:'Faturamento', data: top.map(t=>t.rev), backgroundColor:'#17868C', borderRadius:4 }] },
      options: { indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}, tooltip:{callbacks:{
          title:(items)=>catalogInfo(top[items[0].dataIndex].contaKey, top[items[0].dataIndex].asin).nome,
          afterLabel:(ctx)=>top[ctx.dataIndex].asin+' · '+top[ctx.dataIndex].contas
        }}},
        scales:{ x:{grid:{color:'#EEF2F2'},ticks:{font:{size:10}}}, y:{grid:{display:false},ticks:{font:{size:10}}} } }
    });

    const allSorted = topAsinsPeriodo(meses);
    const totalRev = allSorted.reduce((s,a)=>s+Math.max(a.rev,0),0);
    const top5Rev = allSorted.slice(0,5).reduce((s,a)=>s+Math.max(a.rev,0),0);
    const share = totalRev>0 ? top5Rev/totalRev : 0;
    destroyChart('concentracao');
    charts.concentracao = new Chart(document.getElementById('chConcentracao'), {
      type:'doughnut',
      data:{ labels:['Top 5 ASINs','Demais '+(allSorted.length-5>0?allSorted.length-5:0)+' ASINs'],
        datasets:[{ data:[top5Rev, Math.max(totalRev-top5Rev,0)], backgroundColor:['#17868C','#D3DDDD'], borderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false, cutout:'68%',
        plugins:{ legend:{position:'bottom',labels:{boxWidth:10,boxHeight:10,font:{size:11}}},
          tooltip:{callbacks:{label:(ctx)=>MOEDA(ctx.raw)}} } },
      plugins:[{
        id:'centerText',
        afterDraw(chart){
          const {ctx, chartArea:{width,height,left,top}} = chart;
          ctx.save();
          ctx.font='700 20px Archivo, sans-serif'; ctx.fillStyle='#0D2B34'; ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(PCT(share), left+width/2, top+height/2);
          ctx.restore();
        }
      }]
    });

    // scatter: visitas x conversão x receita (snapshot do último mês capturado de cada conta, vindo de analise.scatter)
    const pontos = [];
    let maxR = 0;
    state.contas.forEach(k => {
      const arr = ((CONTAS[k].analise||{}).scatter) || [];
      arr.forEach(p => { maxR = Math.max(maxR, p.r||0); pontos.push({...p, contaKey:k}); });
    });
    destroyChart('scatter');
    charts.scatter = new Chart(document.getElementById('chScatter'), {
      type:'bubble',
      data:{ datasets:[{
        label:'Produtos',
        data: pontos.map(p => ({ x:p.x, y:p.y, r: maxR>0 ? 4 + 22*Math.sqrt((p.r||0)/maxR) : 4, _p:p })),
        backgroundColor:'rgba(23,134,140,.45)', borderColor:'#17868C', borderWidth:1
      }] },
      options: { responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{
          label:(ctx)=>{ const p = ctx.raw._p; const info = catalogInfo(p.contaKey, p.a); return `${info.nome} — ${NUM(p.x)} visitas, ${PCTRAW(p.y)} conv., ${MOEDA(p.r)}`; }
        }} },
        scales:{ x:{title:{display:true,text:'Visitas',font:{size:10}},grid:{color:'#EEF2F2'},ticks:{font:{size:10}}},
          y:{title:{display:true,text:'Conversão (%)',font:{size:10}},grid:{color:'#EEF2F2'},ticks:{font:{size:10}}} } }
    });
  }

  function renderABC(meses){
    const abc = computeABC(meses);
    const totalABC = abc.reduce((s,a)=>s+a.rev,0);
    destroyChart('abc');
    charts.abc = new Chart(document.getElementById('chABC'), {
      type:'line',
      data:{ labels: abc.map(a=>a.rank),
        datasets:[{ label:'% acumulado do faturamento', data: abc.map(a=>a.cumPct),
          borderColor:'#17868C', backgroundColor:'#DCEEEF', fill:true, tension:0, pointRadius:0, borderWidth:2 }] },
      options: { ...baseGridOpts(), plugins:{legend:{display:false},
          tooltip:{callbacks:{title:(items)=>'Produto #'+items[0].label, label:(ctx)=>PCT(ctx.raw)+' acumulado'}}},
        scales:{ x:{grid:{display:false}, ticks:{font:{size:10}, maxTicksLimit:10}, title:{display:true,text:'Produtos, ordenados por faturamento',font:{size:10}}},
          y:{grid:{color:'#EEF2F2'}, min:0, max:1, ticks:{font:{size:10}, callback:v=>(v*100).toFixed(0)+'%'}} } }
    });

    const resumoABC = ['A','B','C'].map(classe => {
      const itens = abc.filter(a=>a.classe===classe);
      const rev = itens.reduce((s,a)=>s+a.rev,0);
      return {classe, n:itens.length, rev, pct: totalABC>0 ? rev/totalABC : 0};
    });
    document.querySelector('#tblABCResumo tbody').innerHTML = resumoABC.map(r => `
      <tr><td><span class="tag ${r.classe==='A'?'good':(r.classe==='B'?'warn':'muted')}">${r.classe}</span></td>
        <td class="num">${NUM(r.n)}</td><td class="num">${MOEDA(r.rev)}</td><td class="num">${PCT(r.pct)}</td></tr>
    `).join('');

    const classeA = abc.filter(a=>a.classe==='A');
    document.querySelector('#tblABCDetalhe tbody').innerHTML = classeA.map(a => {
      const info = catalogInfo(a.contaKey, a.asin);
      return `<tr><td>${a.rank}</td>
        <td><div class="prodcell">${info.imagem?`<img class="thumb" src="${esc(info.imagem)}" loading="lazy" alt="">`:'<div class="thumb"></div>'}
        <div><div class="prodname">${esc(info.nome)}</div><div class="asincode">${linkAsin(a.asin)}</div></div></div></td>
        <td>${esc(a.contas)}</td><td class="num">${MOEDA2(a.rev)}</td><td class="num">${PCT(a.cumPct)}</td></tr>`;
    }).join('');
  }

  function renderEmptyRow(tbody, colspan, msg){ tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty">${esc(msg)}</td></tr>`; }

  function renderRetencao(){
    const semanas = new Set();
    // recompra & não atendidos (sell-in) + recompra de clientes (Brand Analytics)
    const linhasRec = [];
    state.contas.forEach(k => {
      const c = CONTAS[k], ex = c.extras || {};
      const ba = {}; (ex.recompra || []).forEach(r => { ba[r.asin] = r; });
      if (ex.semanaBrand && ex.semanaBrand.recompra) semanas.add(ex.semanaBrand.recompra);
      const asins = new Set([...Object.keys(c.repetidos||{}), ...Object.keys(c.naoAtendidos||{}), ...Object.keys(ba)]);
      asins.forEach(asin => {
        const info = catalogInfo(k, asin), r = ba[asin];
        linhasRec.push({ nome:info.nome, asin, contaKey:k, rec:(c.repetidos||{})[asin]||0, na:(c.naoAtendidos||{})[asin]||0,
                         pctRec: r ? r.pctRec : null, receitaRec: r ? r.receitaRec : null });
      });
    });
    const tbRec = document.querySelector('#tblRecompra tbody');
    if (!linhasRec.length) renderEmptyRow(tbRec, 6, 'Sem dados de recompra/pedidos não atendidos para as contas selecionadas.');
    else tbRec.innerHTML = tbodyHTML('recompra', linhasRec.sort((a,b)=> (b.receitaRec||0)-(a.receitaRec||0) || b.rec-a.rec), 6, l => `<tr>
      <td><div class="prodname">${esc(l.nome)}</div><div class="asincode">${linkAsin(l.asin)}</div></td>
      <td><span class="tag muted">${esc(CONTA_NOME[l.contaKey])}</span></td>
      <td class="num">${NUM(l.rec)}</td><td class="num">${NUM(l.na)}</td>
      <td class="num">${l.pctRec == null ? '—' : PCT(l.pctRec)}</td><td class="num">${l.receitaRec == null ? '—' : MOEDA2(l.receitaRec)}</td>
    </tr>`);

    // cesta de compras
    const linhasCesta = [];
    state.contas.forEach(k => {
      const ex = CONTAS[k].extras || {};
      if (ex.semanaBrand && ex.semanaBrand.cestaCompras) semanas.add(ex.semanaBrand.cestaCompras);
      (ex.cestaCompras || []).forEach(item => {
        const info = catalogInfo(k, item.asin);
        const infoCom = catalogInfo(k, item.com);
        linhasCesta.push({ nome:info.nome, comNome: infoCom.nome || item.com, rank:item.rank, pct:item.pct });
      });
    });
    const tbCesta = document.querySelector('#tblCesta tbody');
    if (!linhasCesta.length) renderEmptyRow(tbCesta, 4, 'Sem dados de cesta de compras capturados ainda.');
    else tbCesta.innerHTML = tbodyHTML('cesta', linhasCesta, 4, l => `<tr><td>${esc(l.nome)}</td><td>${esc(l.comNome)}</td><td class="num">${NUM(l.rank)}</td><td class="num">${PCT(l.pct)}</td></tr>`);

    // termos de busca (linhas do relatório cujo produto clicado é da conta; ranking 1 = termo mais buscado)
    const linhasTermos = [];
    state.contas.forEach(k => {
      const ex = CONTAS[k].extras || {};
      if (ex.semanaBrand && ex.semanaBrand.termosBusca) semanas.add(ex.semanaBrand.termosBusca);
      (ex.termosBusca || []).forEach(item => {
        const termo = item.termo || item.searchTerm || item.termoBusca || JSON.stringify(item);
        const info = item.asin ? catalogInfo(k, item.asin) : null;
        linhasTermos.push({ termo, contaKey:k, asin:item.asin, nome: info ? info.nome : '', freq:item.freq, click:item.click, conv:item.conv });
      });
    });
    linhasTermos.sort((a,b) => (a.freq ?? 1e12) - (b.freq ?? 1e12));
    const tbTermos = document.querySelector('#tblTermos tbody');
    if (!linhasTermos.length) renderEmptyRow(tbTermos, 6, 'Sem dados de termos de busca capturados ainda.');
    else tbTermos.innerHTML = tbodyHTML('termos', linhasTermos, 6, l => `<tr><td>${esc(l.termo)}</td>
      <td><div class="prodname">${esc(l.nome || l.asin || '')}</div>${l.asin ? `<div class="asincode">${linkAsin(l.asin)}</div>` : ''}</td>
      <td>${esc(CONTA_NOME[l.contaKey])}</td><td class="num">${l.freq == null ? '—' : NUM(l.freq)}</td>
      <td class="num">${l.click == null ? '—' : PCT(l.click)}</td><td class="num">${l.conv == null ? '—' : PCT(l.conv)}</td></tr>`);

    const desc = document.getElementById('retDesc');
    if (desc) desc.textContent = 'Brand Analytics, semana fechada' + (semanas.size ? ' (' + [...semanas].join('; ') + ')' : '') +
      '. Termos de busca: só os termos em que um produto da conta está entre os mais clicados. Onde não houver dado, a aba mostra vazio';
  }

  /* ===================================================================
     7e. OFERTA EM DESTAQUE (Buy Box), Data Kiosk Vendor Analytics
     Por ASIN e semana: glanceViews (visualizações em que a Amazon GANHA o destaque) e
     lostFeaturedOffer (fração das visualizações em que o destaque é de outro vendedor).
     Visualizações totais = glanceViews / (1 - lostFeaturedOffer); perdidas = totais - glanceViews.
     =================================================================== */
  const DEST_LIM_GANHANDO = 0.10;    // até 10% perdidas = Ganhando
  const DEST_LIM_PERDENDO = 0.50;    // acima de 50% = Perdendo (entre os dois = Disputado)
  const DEST_MIN_VISITAS  = 10;      // abaixo disso, a porcentagem é ruído: "Poucas visitas"
  const DEST_PIORA_PP     = 0.10;    // piora de 10 pontos percentuais ou mais

  function destStatus(gv, lost){
    if (lost == null || gv == null) return ['Sem dado', 'muted', 4];
    if (lost >= 1) return ['Perdendo', 'bad', 0];
    if (gv / (1 - lost) < DEST_MIN_VISITAS) return ['Poucas visitas', 'muted', 3];
    if (lost > DEST_LIM_PERDENDO) return ['Perdendo', 'bad', 0];
    if (lost > DEST_LIM_GANHANDO) return ['Disputado', 'warn', 1];
    return ['Ganhando', 'good', 2];
  }
  const destPerdidas = (gv, lost) => (gv == null || lost == null || lost >= 1) ? null : gv * lost / (1 - lost);

  function renderDestaque(){
    const contas = state.contas.filter(k => CONTAS[k].ofertaDestaque);
    const sem = state.contas.filter(k => !CONTAS[k].ofertaDestaque).map(k => CONTA_NOME[k]);
    const st = document.getElementById('destStatus');
    document.getElementById('destDesc').textContent =
      'Porcentagem das visualizações da página do produto em que a oferta em destaque não é da Amazon. Situação: Ganhando (até ' +
      Math.round(DEST_LIM_GANHANDO * 100) + '% perdidas), Disputado (até ' + Math.round(DEST_LIM_PERDENDO * 100) + '%) e Perdendo (acima). ' +
      'Não informa qual vendedor ganha nem o motivo. Valores em "est." são estimativas.';
    const tb = document.querySelector('#tblDestaque tbody');
    if (!contas.length) {
      st.hidden = false; st.className = 'trstatus warn';
      st.innerHTML = 'Ainda não há dados de oferta em destaque para as contas selecionadas. Rode o <code>capturar_data_kiosk.py</code> (cada consulta leva cerca de 15 a 20 minutos) e depois o <code>transformar_destaque.py</code>.';
      document.getElementById('destKpi').innerHTML = '';
      destroyChart('destaque'); document.getElementById('destGrafDesc').textContent = '';
      renderEmptyRow(tb, 9, 'Sem dados de oferta em destaque.');
      return;
    }
    if (sem.length) { st.hidden = false; st.className = 'trstatus'; st.innerHTML = 'Sem dados de oferta em destaque: ' + esc(sem.join(', ')) + ' (a conta pode não ter acesso ou ainda não foi capturada).'; }
    else st.hidden = true;

    // semana mais recente entre as contas e a anterior a ela
    const ids = [...new Set(contas.flatMap(k => CONTAS[k].ofertaDestaque.semanas.map(s => s.id)))].sort();
    const atual = ids[ids.length - 1], anterior = ids[ids.length - 2] || null;
    const fimDe = id => { for (const k of contas) { const s = CONTAS[k].ofertaDestaque.semanas.find(x => x.id === id); if (s) return s.fim; } return id; };

    // ---- linhas por produto (semana atual)
    const linhas = [];
    contas.forEach(k => {
      const od = CONTAS[k].ofertaDestaque, psem = CONTAS[k].porAsinSem || {};
      Object.keys(od.porAsin).forEach(asin => {
        const v = od.porAsin[asin][atual]; if (!v) return;
        const [gv, lost] = v, ant = anterior ? (od.porAsin[asin][anterior] || [null, null]) : [null, null];
        const receita = ((psem[asin] || {})[atual] || {}).r, estoque = ((psem[asin] || {})[atual] || {}).e;
        const perd = destPerdidas(gv, lost);
        linhas.push({ k, asin, gv, lost, sit: destStatus(gv, lost), delta: (lost != null && ant[1] != null) ? lost - ant[1] : null,
                      estoque, perd, risco: (receita > 0 && lost != null && lost < 1) ? receita * lost / (1 - lost) : null });
      });
    });

    // ---- KPIs
    const conta = s => linhas.filter(l => l.sit[0] === s).length;
    const soma = f => linhas.reduce((t, l) => t + (f(l) || 0), 0);
    const totV = (id) => { let gv = 0, tot = 0; contas.forEach(k => { const t = CONTAS[k].ofertaDestaque.totais[id]; if (t && t[0] != null && t[1] != null && t[1] < 1) { gv += t[0]; tot += t[0] / (1 - t[1]); } }); return tot > 0 ? 1 - gv / tot : null; };
    const pAtual = totV(atual), pAnt = anterior ? totV(anterior) : null;
    const dPP = (pAtual != null && pAnt != null) ? (pAtual - pAnt) * 100 : null;
    const dTxt = dPP == null ? '' : ` · ${dPP > 0 ? '+' : ''}${dPP.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pontos vs. semana anterior`;
    const risco = soma(l => l.risco);
    document.getElementById('destKpi').innerHTML =
      kpiHTML('Visualizações perdidas', pAtual == null ? '—' : PCT(pAtual), 'semana ' + DM(atual) + ' a ' + DM(fimDe(atual)) + dTxt, dPP != null && dPP >= DEST_PIORA_PP * 100) +
      kpiHTML('Ganhando', NUM(conta('Ganhando')), 'produtos com até ' + Math.round(DEST_LIM_GANHANDO * 100) + '% perdidas') +
      kpiHTML('Disputado', NUM(conta('Disputado')), 'entre ' + Math.round(DEST_LIM_GANHANDO * 100) + '% e ' + Math.round(DEST_LIM_PERDENDO * 100) + '%') +
      kpiHTML('Perdendo', NUM(conta('Perdendo')), 'mais de ' + Math.round(DEST_LIM_PERDENDO * 100) + '% perdidas', conta('Perdendo') > 0) +
      kpiHTML('Receita em risco (est.)', MOEDA(risco), 'receita pedida na semana × perdidas ÷ (1 − perdidas); estimativa, o real tende a ser menor') +
      kpiHTML('Sem leitura', NUM(conta('Poucas visitas') + conta('Sem dado')), 'poucas visitas ou sem dado na semana');

    // ---- gráfico: % perdidas por semana, uma linha por conta
    destroyChart('destaque');
    const cores = ['#17868C', '#9C6510', '#2C7A57', '#7A4FA0', '#B04A4A', '#3A6EA5', '#6B7B3A'];
    const datasets = contas.map((k, i) => {
      const t = CONTAS[k].ofertaDestaque.totais;
      return { label: CONTA_NOME[k], data: ids.map(id => (t[id] && t[id][1] != null) ? +(t[id][1] * 100).toFixed(1) : null),
               borderColor: cores[i % cores.length], backgroundColor: 'transparent', tension: .25, pointRadius: 3, spanGaps: true };
    });
    document.getElementById('destGrafDesc').textContent = 'Porcentagem por semana (domingo a sábado). Quanto menor, melhor.';
    charts.destaque = new Chart(document.getElementById('chDestaque'), {
      type: 'line', data: { labels: ids.map(id => DM(id) + ' a ' + DM(fimDe(id))), datasets },
      options: { ...baseGridOpts(), plugins: { legend: { labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + (c.raw == null ? 'sem dado' : c.raw + '% perdidas') } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { min: 0, max: 100, grid: { color: '#EEF2F2' }, ticks: { font: { size: 10 }, callback: v => v + '%' } } } }
    });

    // ---- tabela
    const filtro = document.getElementById('destFiltro').value;
    const vis = linhas.filter(l => !filtro || (filtro === 'piorou' ? (l.delta != null && l.delta >= DEST_PIORA_PP) : l.sit[0] === filtro))
      .sort((a, b) => a.sit[2] - b.sit[2] || (b.risco || 0) - (a.risco || 0) || (b.perd || 0) - (a.perd || 0) || (b.gv || 0) - (a.gv || 0));
    if (!vis.length) renderEmptyRow(tb, 9, 'Nenhum produto nessa situação.');
    else tb.innerHTML = tbodyHTML('destaque', vis, 9, l => {
      const d = l.delta == null ? '—' : `<span style="color:var(--${l.delta > 0.005 ? 'bad' : (l.delta < -0.005 ? 'good' : 'muted')})">${l.delta > 0 ? '+' : ''}${(l.delta * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pp</span>`;
      return `<tr>${celulaProd(l.k, l.asin)}
        <td><span class="tag ${l.sit[1]}">${l.sit[0]}</span></td>
        <td class="num">${l.estoque == null ? '—' : NUM(l.estoque)}</td>
        <td class="num">${l.lost == null ? '—' : PCT(l.lost)}</td><td class="num">${d}</td>
        <td class="num">${l.gv == null ? '—' : NUM(l.gv)}</td>
        <td class="num">${l.perd == null ? (l.lost >= 1 ? 'n/d' : '—') : NUM(Math.round(l.perd))}</td>
        <td class="num">${l.risco == null ? '—' : MOEDA2(l.risco)}</td></tr>`;
    });
  }
  const _destF = document.getElementById('destFiltro');
  if (_destF) _destF.addEventListener('change', () => { if (state.pagina === 'destaque') renderDestaque(); });

  function renderDetalhePorConta(porConta, meses){
    const ultimoMes = meses[meses.length-1];
    const tbody = document.querySelector('#tblContas tbody');
    tbody.innerHTML = state.contas.map(k=>{
      const cr = porConta[k];
      const npm = cr.shippedRevenue>0 ? cr.npmNum/cr.shippedRevenue : null;
      const tk = cr.shippedUnits>0 ? cr.shippedRevenue/cr.shippedUnits : null;
      const cv = cr.glanceViews>0 ? cr.shippedUnits/cr.glanceViews : null;
      const estUlt = ultimoMes ? ((CONTAS[k].aggEstoque||{})[ultimoMes]||{}) : {};
      const vendUlt = ultimoMes ? ((CONTAS[k].aggVendas||{})[ultimoMes]||{}) : {};
      const veloc = (vendUlt.shippedUnits||0) / 30;
      const cobertura = veloc > 0 ? (estUlt.sellableUnits||0) / veloc : null;
      return `<tr>
        <td>${esc(CONTA_NOME[k])}</td>
        <td class="num">${MOEDA(cr.shippedRevenue)}</td>
        <td class="num">${NUM(cr.shippedUnits)}</td>
        <td class="num">${MOEDA2(tk)}</td>
        <td class="num">${PCT(npm)}</td>
        <td class="num">${NUM(cr.glanceViews)}</td>
        <td class="num">${PCT(cv)}</td>
        <td class="num">${DIAS(cobertura)}</td>
      </tr>`;
    }).join('');
  }

  /* ------------------------------------------------------------------------
     7c. MÊS EM ANDAMENTO, POR SEMANA (blocos semanas / aggSem / porAsinSem)
     O relatório mensal da Amazon só existe com o mês fechado. O mês em andamento
     aparece por semanas fechadas (domingo a sábado), como no painel Análise de Varejo.
     Fica SEPARADO dos totais mensais: a semana que cruza a virada do mês inclui dias
     que já estão no mês anterior.
     ------------------------------------------------------------------------ */
  const MESES_LONGOS = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const DM = d => d.slice(8,10) + '/' + d.slice(5,7);   // 'YYYY-MM-DD' -> 'dd/mm'
  const DELTA = v => (v==null||!isFinite(v)) ? '—' : (v>=0?'+':'') + (v*100).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%';
  const deltaCls = v => (v==null||!isFinite(v)||v===0) ? '' : (v>0 ? ' style="color:var(--good)"' : ' style="color:var(--bad)"');
  const varPct = (a,b) => b>0 ? (a-b)/b : null;

  // semanas das contas selecionadas; 'semanas' = as do mês da última semana fechada
  function semanasDoMes(){
    const mapa = {};
    state.contas.forEach(k => ((CONTAS[k]||{}).semanas || []).forEach(s => { mapa[s.id] = s; }));
    const todas = Object.values(mapa).sort((a,b) => a.id.localeCompare(b.id));
    if (!todas.length) return { semanas:[], todas:[], mes:null };
    const mes = todas[todas.length-1].fim.slice(0,7);
    return { semanas: todas.filter(s => s.fim >= mes + '-01'), todas, mes };
  }

  function somaSemana(id){
    const t = { rev:0, un:0, env:0, views:0, npmNum:0, npmDen:0, est:0, oosNum:0, oosDen:0, tem:false };
    state.contas.forEach(k => {
      const a = ((CONTAS[k]||{}).aggSem || {})[id];
      if (!a) return;
      t.tem = true;
      const rev = a.orderedRevenue || 0;
      t.rev += rev; t.un += a.orderedUnits || 0; t.env += a.shippedRevenue || 0; t.views += a.glanceViews || 0;
      if (a.npm != null) { const peso = Math.max(rev, 0); t.npmNum += a.npm * peso; t.npmDen += peso; }   // peso nunca negativo (semana com mais cancelamento que pedido)
      t.est += a.sellableUnits || 0;
      if (a.oosRate != null) { const w = (a.sellableCost || 0) || 1; t.oosNum += a.oosRate * w; t.oosDen += w; }
    });
    return t;
  }

  function renderSemanas(){
    const { semanas, todas, mes } = semanasDoMes();
    const vazio = document.getElementById('semVazio'), cont = document.getElementById('semConteudo');
    const titulo = document.getElementById('semTitulo'), desc = document.getElementById('semDesc');
    if (!semanas.length) {
      titulo.textContent = 'Mês em andamento, por semana';
      desc.textContent = '';
      cont.hidden = true; vazio.hidden = false;
      vazio.textContent = 'Sem dados semanais para as contas selecionadas. Rode o capturar_semanal.py, o transformar_vendor.py e o transformar_semanas.py.';
      destroyChart('semanas');
      return;
    }
    vazio.hidden = true; cont.hidden = false;

    const nomeMes = MESES_LONGOS[parseInt(mes.slice(5,7),10) - 1];
    titulo.textContent = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1) + ' de ' + mes.slice(0,4) + ', por semana';
    const primeira = semanas[0];
    const cruza = primeira.ini < mes + '-01';
    desc.textContent = 'O mês ainda não fechou, e a Amazon só libera o relatório mensal com o mês inteiro; por isso ele aparece por semanas fechadas (domingo a sábado), como no painel Análise de Varejo. ' +
      'Semanas mostradas: ' + semanas.map(s => 'S' + s.num).join(', ') + '. ' +
      (cruza ? `A semana ${primeira.num} começa em ${DM(primeira.ini)} e inclui dias do mês anterior, que já estão nos totais mensais; por isso estas semanas não entram nas somas dos outros blocos. ` : '') +
      'Não usa o filtro de período.';

    // ---- linhas: cada semana com a anterior (que pode estar fora do mês) para a variação ----
    const idxTodas = Object.fromEntries(todas.map((s,i) => [s.id, i]));
    const linhas = semanas.map(s => {
      const i = idxTodas[s.id];
      const t = somaSemana(s.id), ant = i > 0 ? somaSemana(todas[i-1].id) : null;
      return { s, t, dv: ant && ant.tem ? varPct(t.rev, ant.rev) : null };
    });
    const tot = linhas.reduce((a,l) => { a.rev += l.t.rev; a.un += l.t.un; a.views += l.t.views; a.npmNum += l.t.npmNum; a.npmDen += l.t.npmDen; return a; }, { rev:0, un:0, views:0, npmNum:0, npmDen:0 });
    const ult = linhas[linhas.length-1].t;
    document.getElementById('semTabDesc').textContent = 'Estoque e ruptura são a posição de cada semana; a linha de total soma receita, unidades e visitas' +
      (linhas.some(l => l.t.rev < 0 || l.t.un < 0) ? '. Receita ou unidades negativas: na semana, os cancelamentos superaram os pedidos novos (a Amazon ajusta os pedidos por cancelamento)' : '');

    const conv = t => t.views > 0 ? t.un / t.views : null;
    const npm = t => t.npmDen > 0 ? t.npmNum / t.npmDen : null;
    const oos = t => t.oosDen > 0 ? t.oosNum / t.oosDen : null;
    document.querySelector('#tblSemanas tbody').innerHTML = linhas.map(l => `<tr>
      <td><b>Sem ${l.s.num}</b> <span class="asincode">${DM(l.s.ini)} a ${DM(l.s.fim)}</span></td>
      <td class="num">${MOEDA(l.t.rev)}</td><td class="num"${deltaCls(l.dv)}>${DELTA(l.dv)}</td>
      <td class="num">${NUM(l.t.un)}</td><td class="num">${NUM(l.t.views)}</td><td class="num">${PCT(conv(l.t))}</td>
      <td class="num">${PCT(npm(l.t))}</td><td class="num">${NUM(l.t.est)}</td><td class="num">${PCT(oos(l.t))}</td>
    </tr>`).join('') + `<tr style="font-weight:700"><td>Total mostrado</td><td class="num">${MOEDA(tot.rev)}</td><td class="num">—</td>
      <td class="num">${NUM(tot.un)}</td><td class="num">${NUM(tot.views)}</td><td class="num">${PCT(conv(tot))}</td><td class="num">${PCT(npm(tot))}</td>
      <td class="num">${NUM(ult.est)}</td><td class="num">${PCT(oos(ult))}</td></tr>`;

    destroyChart('semanas');
    charts.semanas = new Chart(document.getElementById('chSemanas'), {
      type:'bar',
      data:{ labels: linhas.map(l => 'Sem ' + l.s.num),
        datasets:[{ label:'Receita pedida', data: linhas.map(l => l.t.rev), backgroundColor:'#17868C', borderRadius:5 }] },
      options: { ...baseGridOpts(), plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ title: items => { const s = linhas[items[0].dataIndex].s; return `Semana ${s.num} (${DM(s.ini)} a ${DM(s.fim)})`; },
                              label: ctx => MOEDA(ctx.raw) } } } }
    });

    // ---- produtos: soma das semanas mostradas ----
    const ids = new Set(semanas.map(s => s.id)), ultimoId = semanas[semanas.length-1].id;
    const prod = [];
    state.contas.forEach(k => {
      const p = (CONTAS[k]||{}).porAsinSem || {};
      Object.keys(p).forEach(asin => {
        let r = 0, u = 0, v = 0, e = null;
        Object.keys(p[asin]).forEach(id => {
          if (!ids.has(id)) return;
          const x = p[asin][id];
          r += x.r || 0; u += x.u || 0; v += x.v || 0;
          if (id === ultimoId && x.e != null) e = x.e;
        });
        if (r || u || v) { const info = catalogInfo(k, asin); prod.push({ k, asin, nome:info.nome, imagem:info.imagem, r, u, v, e }); }
      });
    });
    prod.sort((a,b) => b.r - a.r);
    const tb = document.querySelector('#tblSemTop tbody');
    if (!prod.length) renderEmptyRow(tb, 7, 'Sem produtos com venda ou visita nas semanas mostradas.');
    else tb.innerHTML = tbodyHTML('semTop', prod, 7, l => `<tr>
      <td><div class="prodcell">
        ${l.imagem ? `<img class="thumb" src="${esc(l.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
        <div><div class="prodname">${esc(l.nome)}</div><div class="asincode">${linkAsin(l.asin)}</div></div>
      </div></td>
      <td><span class="tag muted">${esc(CONTA_NOME[l.k])}</span></td>
      <td class="num">${MOEDA2(l.r)}</td><td class="num">${NUM(l.u)}</td><td class="num">${NUM(l.v)}</td>
      <td class="num">${PCT(l.v > 0 ? l.u / l.v : null)}</td><td class="num">${l.e == null ? '—' : NUM(l.e)}</td>
    </tr>`);
  }

  /* ------------------------------------------------------------------------
     7d. TEMPO REAL (tempo_real/<conta>.json, gerado pelo capturar_tempo_real.py)
     Uma linha por ASIN por hora: u = unidades, r = receita, v = visitas.
     Horário de Brasília = UTC-3 fixo (o Brasil não tem horário de verão desde 2019).
     ------------------------------------------------------------------------ */
  const TR_BASE = location.pathname.includes('/clientes/') ? '../../tempo_real/' : 'tempo_real/';
  const TR = {};            // conta -> objeto do arquivo, ou null (sem arquivo publicado)
  const TR_T = {};          // conta -> quando foi baixado
  const TR_TTL = 10 * 60 * 1000;
  let trReq = 0;
  const BRT = h => new Date(Date.parse(h) - 3 * 3600 * 1000).toISOString();
  const diaBRT = h => BRT(h).slice(0,10);
  const horaBRT = h => parseInt(BRT(h).slice(11,13), 10);
  const H2 = n => String(n).padStart(2, '0');
  const diaAnterior = d => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0,10); };
  const COB = h => h == null ? '—' : (h >= 48 ? NUM(h / 24) + ' d' : NUM(h) + ' h');
  const kpiHTML = (lab, val, hint, alerta) => `<div class="kpi${alerta ? ' alert' : ''}"><div class="lab">${lab}</div><div class="val">${val}</div><div class="hint">${hint || ''}</div></div>`;
  const horasDia = Array.from({length:24}, (_, i) => H2(i) + 'h');

  async function carregarTR(contas){
    await Promise.all(contas.filter(k => !(k in TR) || Date.now() - (TR_T[k] || 0) > TR_TTL).map(async k => {
      try {
        const r = await fetch(TR_BASE + k + '.json?t=' + Date.now(), { cache:'no-store' });
        TR[k] = r.ok ? await r.json() : null;
      } catch (e) { TR[k] = null; }
      TR_T[k] = Date.now();
    }));
  }

  // agrega as contas selecionadas que têm arquivo; null se não há nada
  function trAgregar(){
    const contas = state.contas.filter(k => TR[k]);
    if (!contas.length) return null;
    const horas = [], falhas = [];
    let ultima = '', atualizado = '';
    contas.forEach(k => {
      const d = TR[k];
      (d.horas || []).forEach(x => horas.push({ k, asin:x.asin, h:x.h, u:x.u || 0, r:x.r || 0, v:x.v || 0, temV: x.v != null }));
      if ((d.ultima_hora || '') > ultima) ultima = d.ultima_hora;
      if ((d.atualizado_em || '') > atualizado) atualizado = d.atualizado_em;
      if ((d.falhas || []).length) falhas.push(CONTA_NOME[k] + ': ' + d.falhas.join(', '));
    });
    if (!ultima) return null;

    const hoje = diaBRT(ultima), ate = horaBRT(ultima), ontem = diaAnterior(hoje);
    const zero = () => ({ u:0, r:0, v:0 });
    const horaHoje = Array.from({length:24}, zero), horaOntem = Array.from({length:24}, zero);
    const tot = { hoje:zero(), ontem:zero() };
    // Tráfego chega com mais atraso que vendas (a Amazon exige folga maior): visitas e conversão são
    // comparadas só até a última hora que TEM tráfego, senão a conversão de hoje sairia inflada.
    const ultimaV = horas.reduce((m, x) => x.temV && x.h > m ? x.h : m, '');
    const ateV = ultimaV && diaBRT(ultimaV) === hoje ? horaBRT(ultimaV) : -1;
    const totV = { hoje:zero(), ontem:zero() };
    const porAsin = {};
    const t24 = Date.parse(ultima) - 23 * 3600 * 1000;   // últimas 24h: até a hora 'ultima'
    horas.forEach(x => {
      const dia = diaBRT(x.h), hr = horaBRT(x.h);
      const p = porAsin[x.k + '|' + x.asin] || (porAsin[x.k + '|' + x.asin] = { k:x.k, asin:x.asin, hoje:zero(), ontem:zero(), tv:{ hoje:zero(), ontem:zero() }, u24:0, r24:0 });
      if (Date.parse(x.h) >= t24) { p.u24 += x.u; p.r24 += x.r; }
      const soma = (o) => { o.u += x.u; o.r += x.r; o.v += x.v; };
      const somaV = (o) => { o.u += x.u; o.v += x.v; };
      if (dia === hoje && hr <= ateV) { somaV(totV.hoje); somaV(p.tv.hoje); }
      else if (dia === ontem && hr <= ateV) { somaV(totV.ontem); somaV(p.tv.ontem); }
      if (dia === hoje && hr <= ate) { soma(horaHoje[hr]); soma(tot.hoje); soma(p.hoje); }
      else if (dia === ontem) {
        soma(horaOntem[hr]);                                   // gráfico: ontem inteiro
        if (hr <= ate) { soma(tot.ontem); soma(p.ontem); }     // comparação: só até a mesma hora
      }
    });

    let estAgora = 0, comEst = 0, semEst = 0;
    const estMap = {}, serie = {};
    contas.forEach(k => {
      const e = TR[k].estoque;
      if (e && e.itens) Object.keys(e.itens).forEach(asin => {
        const q = e.itens[asin] || 0;
        estMap[k + '|' + asin] = q; estAgora += q;
        if (q > 0) comEst++; else semEst++;
      });
      Object.keys(TR[k].estoque_total || {}).forEach(h => { serie[h] = (serie[h] || 0) + TR[k].estoque_total[h]; });
    });
    return { contas, ultima, ultimaV, ateV, totV, atualizado, hoje, ate, ontem, horaHoje, horaOntem, tot, porAsin, estAgora, comEst, semEst, estMap, serie, falhas };
  }

  function trStatus(a){
    const el = document.getElementById('trStatus');
    const sem = state.contas.filter(k => !TR[k]).map(k => CONTA_NOME[k]);
    if (!a) {
      el.className = 'trstatus warn';
      el.innerHTML = 'Ainda não há dados de tempo real para as contas selecionadas. Rode o <code>capturar_tempo_real.py</code> no Colab: a primeira publicação cria a pasta <code>tempo_real/</code> e esta página passa a mostrar as últimas 48h.';
      return;
    }
    const atraso = (Date.now() - Date.parse(a.ultima)) / 3600000;
    const cap = new Date(a.atualizado).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    el.className = 'trstatus' + (atraso > 8 ? ' warn' : '');
    el.innerHTML = `Última hora capturada: <b>${DM(a.hoje)}, ${H2(a.ate)}h a ${H2((a.ate + 1) % 24)}h</b> (Brasília) · captura feita em ${cap}` +
      (atraso > 8 ? ` · <b>dados com ${NUM(atraso)}h de atraso: rode o capturar_tempo_real.py de novo</b>` : '') +
      (a.falhas.length ? ` · relatórios com falha na última captura (dado anterior mantido): ${esc(a.falhas.join('; '))}` : '') +
      (sem.length ? ` · sem dados: ${esc(sem.join(', '))}` : '');
  }

  function trLimpar(){
    ['trKpiVendas','trKpiTrafego','trKpiEstoque'].forEach(id => { document.getElementById(id).innerHTML = ''; });
    ['tblTrVendas','tblTrTrafego','tblTrEstoque'].forEach(id => { document.querySelector('#' + id + ' tbody').innerHTML = ''; });
    ['trVendas','trTrafego','trEstoque'].forEach(destroyChart);
  }

  const celulaProd = (k, asin) => {
    const info = catalogInfo(k, asin);
    return `<td><div class="prodcell">
      ${info.imagem ? `<img class="thumb" src="${esc(info.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
      <div><div class="prodname">${esc(info.nome)}</div><div class="asincode">${linkAsin(asin)}</div></div>
    </div></td><td><span class="tag muted">${esc(CONTA_NOME[k])}</span></td>`;
  };

  // gráfico hoje x ontem por hora do dia
  function trGraficoDia(id, canvasId, a, campo, fmt, ateLim){
    const lim = ateLim == null ? a.ate : ateLim;
    destroyChart(id);
    charts[id] = new Chart(document.getElementById(canvasId), {
      type:'line',
      data:{ labels: horasDia, datasets:[
        { label:'Hoje (' + DM(a.hoje) + ')', data: a.horaHoje.map((x, i) => i <= lim ? x[campo] : null), borderColor:'#17868C', backgroundColor:'#DCEEEF', fill:true, tension:.25, pointRadius:2 },
        { label:'Ontem (' + DM(a.ontem) + ')', data: a.horaOntem.map(x => x[campo]), borderColor:'#9C6510', backgroundColor:'transparent', borderDash:[5,3], tension:.25, pointRadius:0 }
      ] },
      options: { ...baseGridOpts(), interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{ labels:{ boxWidth:10, boxHeight:10, font:{size:11} } }, tooltip:{ callbacks:{ label: c => c.dataset.label + ': ' + fmt(c.raw) } } } }
    });
  }

  function trVendas(a){
    const h = a.tot.hoje, o = a.tot.ontem;
    const dRev = varPct(h.r, o.r), dUn = varPct(h.u, o.u);
    const ontemDia = a.horaOntem.reduce((s, x) => s + x.r, 0);
    const r24 = Object.values(a.porAsin).reduce((s, p) => s + p.r24, 0);
    document.getElementById('trKpiVendas').innerHTML =
      kpiHTML('Receita hoje', MOEDA(h.r), `ontem no mesmo período: ${MOEDA(o.r)} (<span${deltaCls(dRev)}>${DELTA(dRev)}</span>)`) +
      kpiHTML('Unidades hoje', NUM(h.u), `ontem no mesmo período: ${NUM(o.u)} (<span${deltaCls(dUn)}>${DELTA(dUn)}</span>)`) +
      kpiHTML('Ticket médio hoje', h.u > 0 ? MOEDA2(h.r / h.u) : '—', 'receita ÷ unidades') +
      kpiHTML('Últimas 24h', MOEDA(r24), 'receita pedida') +
      kpiHTML('Ontem (dia inteiro)', MOEDA(ontemDia), DM(a.ontem));
    document.getElementById('trDescVendas').textContent = 'Receita pedida por hora do dia, em Brasília. Hoje vai até a última hora capturada.';
    trGraficoDia('trVendas', 'chTrVendas', a, 'r', MOEDA2);

    const linhas = Object.values(a.porAsin).filter(p => p.hoje.r || p.hoje.u).sort((x, y) => y.hoje.r - x.hoje.r);
    const tb = document.querySelector('#tblTrVendas tbody');
    if (!linhas.length) renderEmptyRow(tb, 6, 'Sem vendas hoje até a última hora capturada.');
    else tb.innerHTML = tbodyHTML('trVendas', linhas, 6, p => { const d = varPct(p.hoje.r, p.ontem.r); return `<tr>${celulaProd(p.k, p.asin)}
      <td class="num">${MOEDA2(p.hoje.r)}</td><td class="num">${NUM(p.hoje.u)}</td><td class="num">${MOEDA2(p.ontem.r)}</td><td class="num"${deltaCls(d)}>${DELTA(d)}</td></tr>`; });
  }

  function trTrafego(a){
    const h = a.totV.hoje, o = a.totV.ontem;      // só até a última hora com tráfego (chega com atraso)
    const dV = varPct(h.v, o.v);
    const cH = h.v > 0 ? h.u / h.v : null, cO = o.v > 0 ? o.u / o.v : null;
    let pico = -1, vPico = 0;
    a.horaHoje.forEach((x, i) => { if (i <= a.ateV && x.v > vPico) { vPico = x.v; pico = i; } });
    document.getElementById('trKpiTrafego').innerHTML =
      kpiHTML('Visitas hoje', NUM(h.v), `ontem no mesmo período: ${NUM(o.v)} (<span${deltaCls(dV)}>${DELTA(dV)}</span>)`) +
      kpiHTML('Conversão hoje', PCT(cH), a.ateV >= 0 ? `unidades ÷ visitas, até ${H2(a.ateV)}h (o tráfego chega ~3h depois das vendas)` : 'unidades ÷ visitas') +
      kpiHTML('Conversão ontem', PCT(cO), 'mesmo período') +
      kpiHTML('Hora de pico hoje', pico >= 0 ? H2(pico) + 'h' : '—', pico >= 0 ? NUM(vPico) + ' visitas' : '');
    trGraficoDia('trTrafego', 'chTrTrafego', a, 'v', NUM, a.ateV);

    const linhas = Object.values(a.porAsin).filter(p => p.tv.hoje.v).sort((x, y) => y.tv.hoje.v - x.tv.hoje.v);
    const tb = document.querySelector('#tblTrTrafego tbody');
    if (!linhas.length) renderEmptyRow(tb, 7, 'Sem visitas hoje até a última hora capturada (ou o relatório de tráfego falhou na captura).');
    else tb.innerHTML = tbodyHTML('trTrafego', linhas, 7, p => { const d = varPct(p.tv.hoje.v, p.tv.ontem.v); return `<tr>${celulaProd(p.k, p.asin)}
      <td class="num">${NUM(p.tv.hoje.v)}</td><td class="num">${NUM(p.tv.hoje.u)}</td><td class="num">${PCT(p.tv.hoje.v > 0 ? p.tv.hoje.u / p.tv.hoje.v : null)}</td>
      <td class="num">${NUM(p.tv.ontem.v)}</td><td class="num"${deltaCls(d)}>${DELTA(d)}</td></tr>`; });
  }

  function trEstoque(a){
    // risco: vendeu nas últimas 24h; cobertura em horas = estoque ÷ (unidades 24h ÷ 24)
    const linhas = Object.values(a.porAsin).filter(p => p.u24 > 0).map(p => {
      const est = (p.k + '|' + p.asin) in a.estMap ? a.estMap[p.k + '|' + p.asin] : null;
      const cob = est != null && p.u24 > 0 ? est / (p.u24 / 24) : null;
      let sit = ['Sem informação', 'muted', 3];
      if (est === 0) sit = ['Sem estoque', 'bad', 0];
      else if (cob != null && cob < 12) sit = ['Menos de 12h', 'bad', 1];
      else if (cob != null && cob < 48) sit = ['Menos de 2 dias', 'warn', 2];
      else if (cob != null) sit = ['Ok', 'good', 4];
      return { ...p, est, cob, sit };
    }).sort((x, y) => x.sit[2] - y.sit[2] || (x.cob ?? 1e9) - (y.cob ?? 1e9) || y.r24 - x.r24);
    const risco = linhas.filter(l => l.sit[2] <= 1).length;
    const u24 = linhas.reduce((s, l) => s + l.u24, 0);
    document.getElementById('trKpiEstoque').innerHTML =
      kpiHTML('Estoque disponível agora', NUM(a.estAgora), 'unidades à venda no site') +
      kpiHTML('Produtos com estoque', NUM(a.comEst), 'entre os produtos informados pela Amazon') +
      kpiHTML('Produtos sem estoque', NUM(a.semEst), 'entre os produtos informados pela Amazon') +
      kpiHTML('Vendendo e em risco', NUM(risco), 'sem estoque ou menos de 12h de cobertura', risco > 0) +
      kpiHTML('Cobertura geral', u24 > 0 ? COB(a.estAgora / (u24 / 24)) : '—', 'estoque ÷ venda média por hora (24h)');

    const chaves = Object.keys(a.serie).sort();
    destroyChart('trEstoque');
    charts.trEstoque = new Chart(document.getElementById('chTrEstoque'), {
      type:'line',
      data:{ labels: chaves.map(h => DM(diaBRT(h)) + ' ' + H2(horaBRT(h)) + 'h'),
        datasets:[{ label:'Estoque disponível (un)', data: chaves.map(h => a.serie[h]), borderColor:'#2C7A57', backgroundColor:'#DDEDE4', fill:true, tension:.25, pointRadius:1 }] },
      options: { ...baseGridOpts(), plugins:{ legend:{ display:false } },
        scales:{ x:{ grid:{display:false}, ticks:{ font:{size:10}, maxTicksLimit:12 } }, y:{ grid:{color:'#EEF2F2'}, ticks:{ font:{size:10} } } } }
    });

    const tb = document.querySelector('#tblTrEstoque tbody');
    if (!linhas.length) renderEmptyRow(tb, 6, 'Nenhum produto vendeu nas últimas 24h (ou o relatório de vendas falhou na captura).');
    else tb.innerHTML = tbodyHTML('trEstoque', linhas, 6, l => `<tr>${celulaProd(l.k, l.asin)}
      <td><span class="tag ${l.sit[1]}">${l.sit[0]}</span></td>
      <td class="num">${l.est == null ? '—' : NUM(l.est)}</td><td class="num">${NUM(l.u24)}</td><td class="num">${COB(l.cob)}</td></tr>`);
  }

  async function renderTempoReal(){
    const meu = ++trReq;
    const el = document.getElementById('trStatus');
    if (state.contas.some(k => !(k in TR) || Date.now() - (TR_T[k] || 0) > TR_TTL)) {
      el.className = 'trstatus'; el.textContent = 'Carregando dados de tempo real…';
      await carregarTR(state.contas);
      if (meu !== trReq || state.pagina !== 'tempo-real') return;   // trocou de conta/página enquanto carregava
    }
    const a = trAgregar();
    trStatus(a);
    if (!a) { trLimpar(); return; }
    ({ vendas:trVendas, trafego:trTrafego, estoque:trEstoque }[state.trTab] || trVendas)(a);
  }


  /* ------------------------------------------------------------------------
     7a. ALERTAS: o que exige ação agora, por prioridade
     Cruza dados que o dashboard já tem (semana fechada mais recente contra a anterior):
       destaque perdido (Data Kiosk), queda de vendas, queda de conversão, cobertura baixa
       (porAsinSem: r receita, u unidades, v visitas, e estoque vendável)
       e listings suprimidos ou com erro (qualidadeListings).
     Limites ajustáveis nas constantes abaixo.
     ------------------------------------------------------------------------ */
  const ALR_QUEDA_VENDAS   = 0.30;   // queda de 30% ou mais na receita pedida (semana contra semana)
  const ALR_QUEDA_VENDAS_C = 0.60;   // 60% ou mais = crítico
  const ALR_MIN_RECEITA    = 300;    // R$ da semana anterior para a queda de vendas contar
  const ALR_QUEDA_CONV     = 0.30;   // queda de 30% ou mais na conversão
  const ALR_MIN_VISITAS    = 30;     // visitas mínimas nas duas semanas para a conversão contar
  const ALR_MIN_UN_ANT     = 3;      // unidades mínimas na semana anterior
  const ALR_COB_DIAS       = 15;     // cobertura abaixo disso = alerta
  const ALR_COB_CRIT       = 7;      // cobertura abaixo disso (ou zero) = crítico
  const ALR_MIN_UN_COB     = 3;      // unidades vendidas na semana para calcular cobertura
  const ALR_TIPOS = {
    destaque: 'Oferta em destaque perdida',
    vendas:   'Queda de vendas',
    conversao:'Queda de conversão',
    cobertura:'Cobertura baixa',
    listing:  'Listing com problema'
  };

  function montarAlertas(){
    const out = [];
    const add = (tipo, sev, k, asin, detalhe, impacto) => out.push({ tipo, sev, k, asin, detalhe, impacto: impacto == null ? null : impacto });
    const semanasRef = {};
    state.contas.forEach(k => {
      const c = CONTAS[k] || {};
      const sems = (c.semanas || []).map(s => s.id).sort();
      const atual = sems[sems.length - 1], ant = sems[sems.length - 2];
      if (atual) semanasRef[k] = { atual, ant, fim: ((c.semanas || []).find(s => s.id === atual) || {}).fim };
      const psem = c.porAsinSem || {};

      // destaque
      const od = c.ofertaDestaque;
      if (od && atual) {
        const idD = (od.semanas || []).map(s => s.id).sort().pop();
        Object.keys(od.porAsin || {}).forEach(asin => {
          const v = od.porAsin[asin][idD]; if (!v) return;
          const st = destStatus(v[0], v[1]);
          if (st[0] !== 'Perdendo') return;
          const r = ((psem[asin] || {})[idD] || {}).r;
          const risco = (r > 0 && v[1] != null && v[1] < 1) ? r * v[1] / (1 - v[1]) : null;
          add('destaque', 0, k, asin, PCT(v[1]) + ' das visualizações perdidas', risco);
        });
      }

      // vendas, conversão e cobertura (semana fechada mais recente contra a anterior)
      if (atual) Object.keys(psem).forEach(asin => {
        const a = psem[asin][atual] || {}, b = ant ? (psem[asin][ant] || {}) : {};
        const ra = a.r || 0, rb = b.r || 0;
        if (ant && rb >= ALR_MIN_RECEITA && ra <= rb * (1 - ALR_QUEDA_VENDAS)) {
          const q = (rb - ra) / rb;
          add('vendas', q >= ALR_QUEDA_VENDAS_C ? 0 : 1, k, asin, 'Receita pedida ' + MOEDA(rb) + ' → ' + MOEDA(ra) + ' (' + DELTA(-q) + ')', rb - ra);
        }
        const va = a.v || 0, vb = b.v || 0, ua = a.u || 0, ub = b.u || 0;
        if (ant && va >= ALR_MIN_VISITAS && vb >= ALR_MIN_VISITAS && ub >= ALR_MIN_UN_ANT) {
          const ca = ua / va, cb = ub / vb;
          if (ca <= cb * (1 - ALR_QUEDA_CONV)) {
            const ticket = rb > 0 && ub > 0 ? rb / ub : null;
            add('conversao', 1, k, asin, 'Conversão ' + PCT(cb) + ' → ' + PCT(ca) + ' com ' + NUM(va) + ' visitas', ticket == null ? null : (cb - ca) * va * ticket);
          }
        }
        if (a.e != null && ua >= ALR_MIN_UN_COB) {
          const dias = a.e / (ua / 7);
          if (dias < ALR_COB_DIAS) {
            add('cobertura', (a.e <= 0 || dias < ALR_COB_CRIT) ? 0 : 1, k, asin,
                NUM(a.e) + ' un. em estoque, ' + NUM(ua) + ' vendidas na semana (' + (a.e <= 0 ? 'sem estoque' : DIAS(dias)) + ')', ra > 0 ? ra : null);
          }
        }
      });

      // listings: suprimidos um a um (críticos); erros sem supressão viram uma linha-resumo por conta
      const la = ((c.qualidadeListings || {}).asins) || {};
      let comErro = 0;
      Object.keys(la).forEach(asin => {
        const l = la[asin];
        if (l.suprimido) add('listing', 0, k, asin, 'Suprimido' + (l.qtdErros ? ' · ' + NUM(l.qtdErros) + ' erro(s)' : ''), null);
        else if (l.qtdErros > 0) comErro++;
      });
      if (comErro) add('listing', 1, k, null, NUM(comErro) + ' produto(s) com erro, sem supressão. Detalhe na página Saúde dos Listings', null);
    });
    out.sort((a, b) => a.sev - b.sev || (b.impacto || 0) - (a.impacto || 0));
    return { alertas: out, semanasRef };
  }

  function renderAlertas(){
    const { alertas, semanasRef } = montarAlertas();
    const ref = Object.values(semanasRef)[0];
    document.getElementById('alrDesc').textContent =
      'Semana fechada mais recente' + (ref ? ' (' + DM(ref.atual) + ' a ' + DM(ref.fim) + ')' : '') + ' contra a anterior. ' +
      'Crítico: queda de vendas de ' + Math.round(ALR_QUEDA_VENDAS_C * 100) + '% ou mais, cobertura abaixo de ' + ALR_COB_CRIT + ' dias, destaque perdido, listing suprimido. ' +
      'Os valores de impacto são estimativas e não devem ser somados entre alertas, porque o mesmo produto pode aparecer em mais de um.';
    const conta = t => alertas.filter(a => a.tipo === t).length;
    const crit = alertas.filter(a => a.sev === 0).length;
    document.getElementById('alrKpi').innerHTML =
      kpiHTML('Alertas críticos', NUM(crit), 'exigem ação primeiro', crit > 0) +
      kpiHTML('Total de alertas', NUM(alertas.length), 'todos os tipos') +
      Object.keys(ALR_TIPOS).map(t => kpiHTML(ALR_TIPOS[t], NUM(conta(t)), '')).join('');
    const filtro = document.getElementById('alrFiltro').value;
    const vis = alertas.filter(a => !filtro || (filtro === 'critico' ? a.sev === 0 : a.tipo === filtro));
    const tb = document.querySelector('#tblAlertas tbody');
    if (!vis.length) { renderEmptyRow(tb, 6, alertas.length ? 'Nenhum alerta neste filtro.' : 'Nenhum alerta para as contas selecionadas.'); return; }
    tb.innerHTML = tbodyHTML('alertas', vis, 6, a => `<tr>
      <td><span class="tag ${a.sev === 0 ? 'bad' : 'warn'}">${a.sev === 0 ? 'Crítico' : 'Atenção'}</span></td>
      <td>${esc(ALR_TIPOS[a.tipo])}</td>
      ${a.asin ? celulaProd(a.k, a.asin) : `<td>Vários produtos</td><td><span class="tag muted">${esc(CONTA_NOME[a.k])}</span></td>`}
      <td>${esc(a.detalhe)}</td>
      <td class="num">${a.impacto == null ? '—' : MOEDA(a.impacto)}</td></tr>`);
  }
  const _alrF = document.getElementById('alrFiltro');
  if (_alrF) _alrF.addEventListener('change', () => { if (state.pagina === 'alertas') { resetLim(); renderAlertas(); } });

  /* ------------------------------------------------------------------------
     7b. PÁGINAS E NAVEGAÇÃO
     Cada bloco do dashboard é uma página (menu lateral, rota por hash: #/vendas).
     Só a página aberta é desenhada, e filtros (conta, período) redesenham só ela.
     ------------------------------------------------------------------------ */
  const PAGINAS = {
    inicio:    { titulo:'Início', sub:'Visão geral, mês em andamento por semana, diagnósticos e detalhe por conta', periodo:true,
                 render: ag => { renderKPIs(ag.tot, ag.meses, agregarDiagnosticos()); renderSemanas(); renderDiagnosticos(); renderDetalhePorConta(ag.porConta, ag.meses); } },
    alertas:   { titulo:'Alertas', sub:'O que exige ação agora, por prioridade (semana fechada contra a anterior; não usa o filtro de período)', periodo:false,
                 render: () => renderAlertas() },
    vendas:    { titulo:'Vendas e margem', sub:'Faturamento e margem no período', periodo:true,
                 render: ag => { renderFaturamento(ag.porConta, ag.meses); renderMargemMarkup(ag.porMes, ag.meses); } },
    estoque:   { titulo:'Estoque', sub:'Composição, conversão, cobertura e ruptura', periodo:true,
                 render: ag => renderEstoque(ag.porMes, ag.meses) },
    compras:   { titulo:'Compras e pedidos', sub:'Sell-in vs. sell-out e pedidos de compra (POs)', periodo:true,
                 render: ag => { renderSellIn(ag.meses); renderPedidos(); } },
    previsao:  { titulo:'Previsão de demanda', sub:'Projeção da Amazon para os próximos meses (não usa o filtro de período)', periodo:false,
                 render: () => renderPrevisao() },
    produtos:  { titulo:'Produtos', sub:'Catálogo, concentração de receita e curva ABC', periodo:true,
                 render: ag => { renderCatalogo(ag); renderProdutosConcentracao(ag.meses); renderABC(ag.meses); } },
    'tempo-real': { titulo:'Tempo real', sub:'Vendas, tráfego e estoque por hora, horário de Brasília', periodo:false,
                 render: () => renderTempoReal() },
    destaque:  { titulo:'Oferta em destaque', sub:'Quanto a Amazon ganha ou perde o Buy Box, por produto e por semana (não usa o filtro de período)', periodo:false,
                 render: () => renderDestaque() },
    retencao:  { titulo:'Retenção', sub:'Recompra, cesta de compras e termos de busca', periodo:false,
                 render: () => renderRetencao() },
    listings:  { titulo:'Saúde dos Listings', sub:'Status, erros e avisos reais da Amazon (última captura)', periodo:false,
                 render: () => renderListings() },
    qualidade: { titulo:'Qualidade de catálogo (CDQ)', sub:'Estimativa própria; fonte diferente de Saúde dos Listings', periodo:false,
                 render: () => renderQualidade() }
  };

  function paginaDoHash(){
    const h = (location.hash || '').replace(/^#\/?/, '');
    return PAGINAS[h] ? h : 'inicio';
  }

  // desenha a página aberta com os filtros atuais
  function renderPagina(){
    const p = PAGINAS[state.pagina];
    p.render(p.periodo ? agregarPeriodo() : null);
  }

  // abre uma página: mostra só ela, marca o menu, ajusta título e filtros, e desenha
  function irPara(id){
    state.pagina = id;
    const p = PAGINAS[id];
    document.querySelectorAll('.page').forEach(el => { el.hidden = (el.id !== 'page-' + id); });
    document.querySelectorAll('#sideNav a').forEach(a => a.classList.toggle('on', a.dataset.pagina === id));
    document.getElementById('pageTitle').textContent = p.titulo;
    document.getElementById('pageSub').textContent = p.sub;
    ['fgDe','fgAte'].forEach(fid => { document.getElementById(fid).style.display = p.periodo ? '' : 'none'; });
    document.title = p.titulo + ' · Grupo START — Vendor Central';
    resetLim();
    renderPagina();
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  window.addEventListener('hashchange', () => irPara(paginaDoHash()));

  /* ------------------------------------------------------------------------
     8. EXPORTAÇÃO
     ------------------------------------------------------------------------ */
  function exportXLSX(){
    const meses = mesesNoRange();
    const {porConta, porMes, tot} = agregarPeriodo();
    const abc = computeABC(meses);
    const top = topAsinsPeriodo(meses);
    const npmBlend = tot.npmDen>0 ? tot.npmNum/tot.npmDen : null;
    const conv = tot.glanceViews>0 ? tot.shippedUnits/tot.glanceViews : null;
    const ticket = tot.shippedUnits>0 ? tot.shippedRevenue/tot.shippedUnits : null;

    const wb = XLSX.utils.book_new();

    const wsResumo = XLSX.utils.aoa_to_sheet([
      ['Grupo START — Inteligência Vendor Central'],
      ['Período', MESLABEL(state.de)+' a '+MESLABEL(state.ate)],
      ['Contas incluídas', state.contas.map(k=>CONTA_NOME[k]).join(', ')],
      [],
      ['Faturamento (ordered)', tot.shippedRevenue],
      ['Unidades pedidas', tot.shippedUnits],
      ['Ticket médio', ticket],
      ['Margem líquida (NPM)', npmBlend],
      ['Conversão', conv],
      ['Visitas', tot.glanceViews],
    ]);
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    const contaRows = [['Conta','Faturamento','Unidades','Ticket médio','Margem líq.','Visitas','Conversão']];
    state.contas.forEach(k=>{
      const cr = porConta[k];
      const npm = cr.shippedRevenue>0 ? cr.npmNum/cr.shippedRevenue : null;
      const tk = cr.shippedUnits>0 ? cr.shippedRevenue/cr.shippedUnits : null;
      const cv = cr.glanceViews>0 ? cr.shippedUnits/cr.glanceViews : null;
      contaRows.push([CONTA_NOME[k], cr.shippedRevenue, cr.shippedUnits, tk, npm, cr.glanceViews, cv]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(contaRows), 'Por conta');

    const mensalRows = [['Mês','Faturamento','Unidades pedidas','Unidades enviadas','Visitas','Estoque saudável (R$)','Estoque não saudável (R$)','Ruptura (OOS)','Cobertura (dias)','Margem líquida','Markup varejo']];
    meses.forEach(m => {
      const pm = porMes[m];
      const velocidadeDiaria = pm.shippedUnitsReal/30;
      const cobertura = velocidadeDiaria>0 ? pm.sellableUnits/velocidadeDiaria : null;
      mensalRows.push([
        MESLABEL(m), pm.shippedRevenue, pm.shippedUnits, pm.shippedUnitsReal, pm.glanceViews,
        Math.max(0,pm.sellableCost-pm.unhealthyCost), pm.unhealthyCost,
        pm.oosDen>0 ? pm.oosNum/pm.oosDen : null, cobertura,
        pm.npmDen>0 ? pm.npmNum/pm.npmDen : null,
        pm.markupDen>0 ? pm.markupNum/pm.markupDen : null
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mensalRows), 'Mensal');

    const topRows = [['ASIN','Produto','Conta(s)','Faturamento']];
    top.forEach(t => topRows.push([t.asin, catalogInfo(t.contaKey, t.asin).nome, t.contas, t.rev]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(topRows), 'Top ASINs');

    const abcRows = [['Ranking','ASIN','Produto','Conta(s)','Faturamento','% acumulado','Classe']];
    abc.forEach(a => abcRows.push([a.rank, a.asin, catalogInfo(a.contaKey, a.asin).nome, a.contas, a.rev, a.cumPct, a.classe]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(abcRows), 'Curva ABC');

    const diagRows = [['Tipo','Título','Impacto (R$)','Qtd. itens','Contas']];
    agregarDiagnosticos().forEach(g => diagRows.push([g.tipo, g.titulo, g.impacto, g.qtd, [...g.contasEnvolvidas].map(k=>CONTA_NOME[k]).join(', ')]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(diagRows), 'Diagnósticos');

    // Saúde dos Listings (fonte: qualidadeListings, dado da Amazon). Uma linha por ASIN com pendência.
    const listRows = [['Conta','ASIN','SKU','Produto','Suprimido','Qtd. erros','Qtd. avisos','Erros','Avisos']];
    montarListings()
      .filter(l => l.suprimido || l.qtdErros > 0 || l.qtdAvisos > 0)
      .sort((a,b) => (Number(b.suprimido) - Number(a.suprimido)) || (b.qtdErros - a.qtdErros))
      .forEach(l => listRows.push([
        CONTA_NOME[l.contaKey], l.asin, l.sku, l.nome, l.suprimido ? 'Sim' : 'Não', l.qtdErros, l.qtdAvisos,
        l.erros.map(i => `[${i.codigo || ''}] ${i.mensagem || ''}`).join(' | '),
        l.avisos.map(i => `[${i.codigo || ''}] ${i.mensagem || ''}`).join(' | ')
      ]));
    if (listRows.length > 1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(listRows), 'Saúde dos Listings');

    const sm = semanasDoMes();
    if (sm.semanas.length) {
      const linhasSem = [['Semana','Início','Fim','Receita pedida','Unidades pedidas','Receita enviada','Visitas','Conversão','Margem líq.','Estoque (un)','Ruptura']];
      sm.semanas.forEach(s => {
        const t = somaSemana(s.id);
        linhasSem.push(['Sem ' + s.num, s.ini, s.fim, t.rev, t.un, t.env, t.views, t.views > 0 ? t.un / t.views : null,
          t.npmDen > 0 ? t.npmNum / t.npmDen : null, t.est, t.oosDen > 0 ? t.oosNum / t.oosDen : null]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhasSem), 'Mês em andamento (semanas)');
    }

    const todosPedidos = state.contas.flatMap(k => (CONTAS[k].pedidos || []).map(p => ({...p, k})))
      .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    if (todosPedidos.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhasItensPedidos(todosPedidos)), 'Pedidos (itens)');

    const nomeArquivo = `grupo-start-vendor-central_${state.de}_a_${state.ate}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
  }

  document.getElementById('btnXLSX').onclick = exportXLSX;
  document.getElementById('btnPDF').onclick = () => window.print();

  /* ------------------------------------------------------------------------
     9. INICIALIZAÇÃO
     ------------------------------------------------------------------------ */
  if (INDICE) {
    const el = document.getElementById('geradoEm');
    const d = new Date(INDICE.geradoEm);
    if (el && !isNaN(d)) el.textContent = 'Dados de ' + d.toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
  }
  if (!(await carregarContas(state.contas, ++reqId))) return; // mensagem de erro já está na tela
  document.getElementById('loading').hidden = true;
  irPara(paginaDoHash());
}

iniciarDashboard().catch(err => {
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#900;max-width:600px;margin:0 auto"><h2>Erro ao carregar os dados</h2><p>' + err.message + '</p><p>Verifique se <code>dados_vendor.json</code> está na mesma pasta deste arquivo (ou publicado no mesmo domínio/GitHub Pages) e acessível via HTTP. Abrir este HTML direto do disco (file://) costuma bloquear o fetch por CORS — use um servidor local (ex: <code>python3 -m http.server</code>) ou acesse via GitHub Pages.</p></div>';
  console.error(err);
});
