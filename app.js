/* ============================================================================
   GRUPO START — INTELIGÊNCIA VENDOR CENTRAL
   Estrutura deste arquivo:
     1. Formatadores e constantes
     2. Carregamento de dados + índices derivados (catálogo, meses, etc.)
     3. Estado global e construção dos filtros
     4. Agregação por período (funções puras: state -> dados agregados)
     5. Diagnósticos (analise.diagnosticos, agregados entre contas)
     6. Catálogo de produtos (busca/ordenação)
     7. Renderização — uma função por seção do dashboard
     8. Exportação (Excel)
     9. Inicialização
   ============================================================================ */

let CONTAS = null;

async function iniciarDashboard() {
  const resp = await fetch('dados_vendor.json');
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ao buscar dados_vendor.json');
  CONTAS = await resp.json();

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

  const PALETTE = ['#17868C','#9C6510','#2C7A57','#A32E2A','#5F7378','#0D2B34'];

  /* ------------------------------------------------------------------------
     2. ÍNDICES DERIVADOS
     ------------------------------------------------------------------------ */
  const CONTA_KEYS = Object.keys(CONTAS);
  const CONTA_NOME = {};
  CONTA_KEYS.forEach(k => CONTA_NOME[k] = CONTAS[k].nome || k);

  const ALL_MONTHS = Array.from(new Set(
    CONTA_KEYS.flatMap(k => Object.keys(CONTAS[k].aggVendas || {}))
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
    CONTA_KEYS.flatMap(k => Object.keys(CONTAS[k].previsaoMes || {}))
  )).sort();

  // meses disponíveis em sellinMes, por conta (cobertura pode não bater com ALL_MONTHS)
  const SELLIN_MONTHS = Array.from(new Set(
    CONTA_KEYS.flatMap(k => Object.keys(CONTAS[k].sellinMes || {}))
  )).sort();

  /* ------------------------------------------------------------------------
     3. ESTADO E FILTROS
     ------------------------------------------------------------------------ */
  let state = {
    contas: [...CONTA_KEYS],
    de: ALL_MONTHS[0],
    ate: ALL_MONTHS[ALL_MONTHS.length-1],
    catBusca: '',
    catOrdenar: 'rev_desc',
    qualBusca: '',
    qualFiltroGrau: '',
    qualOrdenar: 'score_asc'
  };

  const pillsEl = document.getElementById('pillsContas');
  CONTA_KEYS.forEach(k => {
    const b = document.createElement('button');
    b.className = 'pill on';
    b.textContent = CONTA_NOME[k];
    b.dataset.k = k;
    b.onclick = () => {
      if (state.contas.includes(k)) {
        if (state.contas.length === 1) return; // manter ao menos uma conta
        state.contas = state.contas.filter(x => x !== k);
        b.classList.remove('on');
      } else {
        state.contas.push(k);
        b.classList.add('on');
      }
      render();
    };
    pillsEl.appendChild(b);
  });

  const selDe = document.getElementById('selDe');
  const selAte = document.getElementById('selAte');
  ALL_MONTHS.forEach(m => {
    const o1 = document.createElement('option'); o1.value = m; o1.textContent = MESLABEL(m);
    const o2 = document.createElement('option'); o2.value = m; o2.textContent = MESLABEL(m);
    selDe.appendChild(o1); selAte.appendChild(o2);
  });
  selDe.value = state.de; selAte.value = state.ate;
  selDe.onchange = () => { state.de = selDe.value; if (state.de > state.ate) { state.ate = state.de; selAte.value = state.ate; } render(); };
  selAte.onchange = () => { state.ate = selAte.value; if (state.ate < state.de) { state.de = state.ate; selDe.value = state.de; } render(); };

  const catBusca = document.getElementById('catBusca');
  const catOrdenar = document.getElementById('catOrdenar');
  catBusca.oninput = () => { state.catBusca = catBusca.value.trim().toLowerCase(); renderCatalogo(agregarPeriodo()); };
  catOrdenar.onchange = () => { state.catOrdenar = catOrdenar.value; renderCatalogo(agregarPeriodo()); };

  const qualBusca = document.getElementById('qualBusca');
  const qualFiltroGrau = document.getElementById('qualFiltroGrau');
  const qualOrdenar = document.getElementById('qualOrdenar');
  qualBusca.oninput = () => { state.qualBusca = qualBusca.value.trim().toLowerCase(); renderQualidade(); };
  qualFiltroGrau.onchange = () => { state.qualFiltroGrau = qualFiltroGrau.value; renderQualidade(); };
  qualOrdenar.onchange = () => { state.qualOrdenar = qualOrdenar.value; renderQualidade(); };

  // abas da seção de retenção
  document.querySelectorAll('#retTabs .tabbtn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#retTabs .tabbtn').forEach(b => b.classList.remove('on'));
      document.querySelectorAll('.tabpanel').forEach(p => p.classList.remove('on'));
      btn.classList.add('on');
      document.getElementById('tab' + btn.dataset.tab[0].toUpperCase() + btn.dataset.tab.slice(1)).classList.add('on');
    };
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
            <div><div class="prodname">${esc(info.nome)}</div><div class="asincode">${esc(it.asin)} · <span class="contatag" style="margin:0">${esc(CONTA_NOME[it.contaKey])}</span></div></div>
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

    tbody.innerHTML = linhas.map(l => `<tr>
      <td><div class="prodcell">
        ${l.imagem ? `<img class="thumb" src="${esc(l.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
        <div><div class="prodname">${esc(l.nome)}</div><div class="asincode">${esc(l.asin)}</div></div>
      </div></td>
      <td><span class="tag muted">${esc(CONTA_NOME[l.contaKey])}</span></td>
      <td>${bsrHTML(l.bsr)}</td>
      <td class="num">${MOEDA2(l.rev)}</td>
      <td class="num">${l.sellable==null ? '—' : MOEDA(l.sellable)}</td>
      <td class="num">${DIAS(l.cobertura)}</td>
    </tr>`).join('');
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
    else tbAlerta.innerHTML = alertas.map(a => `<tr>
      <td><div class="prodcell">
        ${a.imagem ? `<img class="thumb" src="${esc(a.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
        <div><div class="prodname">${esc(a.nome)}</div><div class="asincode">${esc(a.asin)}</div></div>
      </div></td>
      <td><span class="tag muted">${esc(CONTA_NOME[a.contaKey])}</span></td>
      <td>${a.compsD.map(ck => `<span class="tag bad" style="margin-right:3px">${esc(COMP_LABEL[ck] || ck)}</span>`).join('')}</td>
      <td class="num">${NUM2(a.score)}</td>
      <td>${gradeTag(a.grau)}</td>
    </tr>`).join('');

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

    tbody.innerHTML = linhas.map(l => `<tr>
      <td><div class="prodcell">
        ${l.imagem ? `<img class="thumb" src="${esc(l.imagem)}" loading="lazy" alt="">` : '<div class="thumb"></div>'}
        <div><div class="prodname">${esc(l.nome)}</div><div class="asincode">${esc(l.asin)}</div></div>
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
    </tr>`).join('');
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
    // sell-in (custo de compra) x sell-out (custo do vendido), por mês de sellinMes disponível nas contas selecionadas
    const mesesSell = SELLIN_MONTHS;
    const sellinPorMes = {}, sellOutPorMes = {};
    mesesSell.forEach(m => { sellinPorMes[m] = 0; sellOutPorMes[m] = 0; });

    let totPOs = 0, totConf = 0, totRej = 0;
    const linhasConta = [];
    state.contas.forEach(k => {
      const c = CONTAS[k];
      const sm = c.sellinMes || {};
      let confConta = 0, rejConta = 0;
      Object.keys(sm).forEach(m => {
        if (sellinPorMes[m] == null) return;
        sellinPorMes[m] += sm[m].custo || 0;
        confConta += sm[m].conf || 0;
        rejConta += sm[m].rej || 0;
      });
      totConf += confConta; totRej += rejConta; totPOs += c.totalPOs || 0;
      linhasConta.push({ k, pos:c.totalPOs||0, conf:confConta, rej:rejConta });

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
      destroyChart('sellGap');
      const ctx = document.getElementById('chSellGap');
      ctx.getContext('2d').clearRect(0,0,ctx.width,ctx.height);
    } else {
      charts.sellGap = new Chart(document.getElementById('chSellGap'), {
        type:'bar',
        data:{ labels: mesesSell.map(MESLABEL),
          datasets:[
            {label:'Sell-in (compra)', data: mesesSell.map(m=>sellinPorMes[m]), backgroundColor:'#17868C', borderRadius:4},
            {label:'Sell-out (venda, custo)', data: mesesSell.map(m=>sellOutPorMes[m]), backgroundColor:'#9C6510', borderRadius:4}
          ] },
        options: baseGridOpts()
      });
    }

    const rejPct = (totConf+totRej) > 0 ? totRej/(totConf+totRej) : null;
    document.getElementById('poKpisBox').innerHTML = `
      <div class="kpis" style="grid-template-columns:1fr 1fr;height:100%">
        <div class="kpi"><div class="lab">POs no período das contas</div><div class="val">${NUM(totPOs)}</div></div>
        <div class="kpi"><div class="lab">Taxa de rejeição</div><div class="val">${PCT(rejPct)}</div></div>
      </div>`;

    const tbody = document.querySelector('#tblSellin tbody');
    if (!linhasConta.some(l => l.pos || l.conf || l.rej)) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Sem dados de sell-in para as contas selecionadas.</td></tr>';
    } else {
      tbody.innerHTML = linhasConta.map(l => `<tr>
        <td>${esc(CONTA_NOME[l.k])}</td><td class="num">${NUM(l.pos)}</td><td class="num">${NUM(l.conf)}</td><td class="num">${NUM(l.rej)}</td>
      </tr>`).join('');
    }
  }

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
      <td><div class="prodname">${esc(l.nome)}</div><div class="asincode">${esc(l.asin)} · ${esc(CONTA_NOME[l.contaKey])}</div></td>
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
        <div><div class="prodname">${esc(info.nome)}</div><div class="asincode">${esc(a.asin)}</div></div></div></td>
        <td>${esc(a.contas)}</td><td class="num">${MOEDA2(a.rev)}</td><td class="num">${PCT(a.cumPct)}</td></tr>`;
    }).join('');
  }

  function renderEmptyRow(tbody, colspan, msg){ tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty">${esc(msg)}</td></tr>`; }

  function renderRetencao(){
    // recompra & não atendidos
    const linhasRec = [];
    state.contas.forEach(k => {
      const c = CONTAS[k];
      const asins = new Set([...Object.keys(c.repetidos||{}), ...Object.keys(c.naoAtendidos||{})]);
      asins.forEach(asin => {
        const info = catalogInfo(k, asin);
        linhasRec.push({ nome:info.nome, asin, contaKey:k, rec:(c.repetidos||{})[asin]||0, na:(c.naoAtendidos||{})[asin]||0 });
      });
    });
    const tbRec = document.querySelector('#tblRecompra tbody');
    if (!linhasRec.length) renderEmptyRow(tbRec, 4, 'Sem dados de recompra/pedidos não atendidos para as contas selecionadas.');
    else tbRec.innerHTML = linhasRec.sort((a,b)=>b.rec-a.rec).slice(0,50).map(l => `<tr>
      <td><div class="prodname">${esc(l.nome)}</div><div class="asincode">${esc(l.asin)}</div></td>
      <td><span class="tag muted">${esc(CONTA_NOME[l.contaKey])}</span></td>
      <td class="num">${NUM(l.rec)}</td><td class="num">${NUM(l.na)}</td>
    </tr>`).join('');

    // cesta de compras
    const linhasCesta = [];
    state.contas.forEach(k => {
      const arr = ((CONTAS[k].extras||{}).cestaCompras) || [];
      arr.forEach(item => {
        const info = catalogInfo(k, item.asin);
        const infoCom = catalogInfo(k, item.com);
        linhasCesta.push({ nome:info.nome, comNome: infoCom.nome || item.com, rank:item.rank, pct:item.pct });
      });
    });
    const tbCesta = document.querySelector('#tblCesta tbody');
    if (!linhasCesta.length) renderEmptyRow(tbCesta, 4, 'Sem dados de cesta de compras capturados ainda.');
    else tbCesta.innerHTML = linhasCesta.map(l => `<tr><td>${esc(l.nome)}</td><td>${esc(l.comNome)}</td><td class="num">${NUM(l.rank)}</td><td class="num">${PCT(l.pct)}</td></tr>`).join('');

    // termos de busca — formato bruto ainda não confirmado; exibição defensiva
    const linhasTermos = [];
    state.contas.forEach(k => {
      const arr = ((CONTAS[k].extras||{}).termosBusca) || [];
      arr.forEach(item => {
        const termo = item.searchTerm || item.termo || item.termoBusca || JSON.stringify(item);
        linhasTermos.push({ termo, contaKey:k });
      });
    });
    const tbTermos = document.querySelector('#tblTermos tbody');
    if (!linhasTermos.length) renderEmptyRow(tbTermos, 2, 'Sem dados de termos de busca capturados ainda.');
    else tbTermos.innerHTML = linhasTermos.map(l => `<tr><td>${esc(l.termo)}</td><td>${esc(CONTA_NOME[l.contaKey])}</td></tr>`).join('');
  }

  function renderTempoReal(){
    const disponiveis = state.contas.filter(k => CONTAS[k].tempoReal);
    const box = document.getElementById('tempoRealChartBox');
    const emptyEl = document.getElementById('tempoRealEmpty');
    if (!disponiveis.length) {
      box.style.display = 'none';
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'Ainda não incorporado ao dados_vendor.json — assim que o formato bruto (vendas/tráfego/estoque hora a hora) for confirmado, esta seção passa a exibir as últimas 24h automaticamente.';
      return;
    }
    // Formato esperado (provisório, a confirmar contra o dado bruto real):
    // CONTAS[<conta>].tempoReal = { "<asin>": { "<HH:mm ou timestamp ISO>": { vendas, trafego, estoque } } }
    // ou um bloco agregado por conta/hora. Ajustar assim que houver amostra real.
    destroyChart('tempoReal');
    box.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'Bloco tempoReal encontrado no JSON, mas o formato ainda não foi mapeado neste gráfico — confirme comigo a estrutura para eu conectar os campos corretos.';
  }

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

  function render(){
    const agregado = agregarPeriodo();
    const { meses, porConta, porMes, tot } = agregado;
    const diagGrupos = agregarDiagnosticos();

    renderKPIs(tot, meses, diagGrupos);
    renderDiagnosticos();
    renderFaturamento(porConta, meses);
    renderEstoque(porMes, meses);
    renderSellIn(meses);
    renderMargemMarkup(porMes, meses);
    renderPrevisao();
    renderCatalogo(agregado);
    renderProdutosConcentracao(meses);
    renderABC(meses);
    renderRetencao();
    renderTempoReal();
    renderDetalhePorConta(porConta, meses);
    renderQualidade();
  }

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

    const nomeArquivo = `grupo-start-vendor-central_${state.de}_a_${state.ate}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
  }

  document.getElementById('btnXLSX').onclick = exportXLSX;
  document.getElementById('btnPDF').onclick = () => window.print();

  /* ------------------------------------------------------------------------
     9. INICIALIZAÇÃO
     ------------------------------------------------------------------------ */
  render();
}

iniciarDashboard().catch(err => {
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#900;max-width:600px;margin:0 auto"><h2>Erro ao carregar os dados</h2><p>' + err.message + '</p><p>Verifique se <code>dados_vendor.json</code> está na mesma pasta deste arquivo (ou publicado no mesmo domínio/GitHub Pages) e acessível via HTTP. Abrir este HTML direto do disco (file://) costuma bloquear o fetch por CORS — use um servidor local (ex: <code>python3 -m http.server</code>) ou acesse via GitHub Pages.</p></div>';
  console.error(err);
});
