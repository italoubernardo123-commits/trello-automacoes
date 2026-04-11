// ==UserScript==
// @name         Vendas → Trello (ML + Shopee)
// @namespace    vendas-trello
// @version      1.1
// @match        https://www.mercadolivre.com.br/vendas/*
// @match        https://seller.shopee.com.br/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/main/tampermonkey/trello-sync.js
// @downloadURL  https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/main/tampermonkey/trello-sync.js
// ==/UserScript==

(function () {
  'use strict';

  // ─── Configuração ─────────────────────────────────────────────
  const API_KEY        = ""; // Insira sua API Key do Trello
  const API_TOKEN      = ""; // Insira seu API Token do Trello
  const LABEL_RECLAM   = "666b314804edc2598667f69c"; // Problema/Reclamação (red) — board ML
  const LABEL_MAIS     = "681901335bddd9432f359483"; // Mais compras (blue) — ambos boards

  const PLATAFORMA = location.hostname.includes('shopee') ? 'shopee' : 'ml';

  const CFG = {
    ml: {
      BOARD_ID:      'oCfs01Yk',
      FILTRO_LISTAS: l => l.name.toLowerCase().includes('comprou'),
      BTN_COR:       '#ffe000',
      BTN_TEXTO_COR: '#000',
      ACCENT:        '#ffe000',
      LABEL:         'ML → Trello',
    },
    shopee: {
      BOARD_ID:      'fvvPPcP3',
      FILTRO_LISTAS: l => ['comprou','entregar','entragar'].some(f => l.name.toLowerCase().includes(f)),
      BTN_COR:       '#ee4d2d',
      BTN_TEXTO_COR: '#fff',
      ACCENT:        '#ee4d2d',
      LABEL:         'Shopee → Trello',
      DIAS_ANTES:    2,
    },
  };

  const cfg = CFG[PLATAFORMA];
  const UI_ID  = '__vt_ui__';
  const BTN_ID = '__vt_btn__';

  // ─── Helpers UI ───────────────────────────────────────────────
  function rm() { document.getElementById(UI_ID)?.remove(); }

  function el(tag, styles = {}, text = '') {
    const e = document.createElement(tag);
    Object.assign(e.style, styles);
    if (text) e.textContent = text;
    return e;
  }

  function mkBtn(texto, css = {}) {
    return el('button', {
      width: '100%', padding: '11px', border: 'none', borderRadius: '7px',
      fontWeight: 'bold', cursor: 'pointer', fontFamily: 'monospace',
      fontSize: '13px', marginTop: '8px', ...css,
    }, texto);
  }

  function formatarData(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function criarUI() {
    rm();
    const ui = document.createElement('div');
    ui.id = UI_ID;
    Object.assign(ui.style, {
      position: 'fixed', bottom: '70px', left: '20px', zIndex: '99999',
      background: '#111', border: '1px solid #2a2a2a', borderRadius: '14px',
      padding: '20px 24px', width: '360px', fontFamily: 'monospace', fontSize: '13px',
      boxShadow: '0 8px 40px rgba(0,0,0,.8)', color: '#f0f0f0',
    });
    document.body.appendChild(ui);
    return ui;
  }

  function showLoading(msg) {
    const ui = criarUI();
    ui.appendChild(el('div', { color: cfg.ACCENT, fontWeight: 'bold', marginBottom: '8px' }, `⏳ ${msg}`));
    ui.appendChild(el('div', { color: '#555', fontSize: '12px' }, 'Aguarde...'));
  }

  function showMsg(titulo, msg, cor) {
    const ui = criarUI();
    ui.appendChild(el('div', { color: cor || cfg.ACCENT, fontWeight: 'bold', marginBottom: '8px' }, titulo));
    ui.appendChild(el('div', { color: '#666', fontSize: '12px', marginBottom: '14px' }, msg));
    const b = mkBtn('Fechar', { background: 'transparent', border: '1px solid #2a2a2a', color: '#555' });
    b.addEventListener('click', rm);
    ui.appendChild(b);
  }

  // ─── Trello API ───────────────────────────────────────────────
  async function getTrelloCards() {
    const res = await fetch(
      `https://api.trello.com/1/boards/${cfg.BOARD_ID}/cards?fields=name,desc&key=${API_KEY}&token=${API_TOKEN}`
    );
    return res.json();
  }

  // Retorna: { existentes: Set<string>, nomesPorCard: Map<nomeNorm, true> }
  async function getDadosExistentes() {
    const cards = await getTrelloCards();
    const existentes = new Set();
    const nomesExistentes = new Set();

    cards.forEach(c => {
      const txt = (c.name || '') + ' ' + (c.desc || '');
      // Links ML
      (txt.match(/https?:\/\/\S+/g) || []).forEach(l => existentes.add(l.trim()));
      // IDs alfanuméricos Shopee
      (txt.match(/[A-Z0-9]{10,}/g) || []).forEach(id => existentes.add(id));
      // Nome normalizado do comprador (para detectar mais compras)
      const nome = (c.name || '').trim().toLowerCase();
      if (nome) nomesExistentes.add(nome);
    });

    return { existentes, nomesExistentes };
  }

  async function getListas() {
    const res = await fetch(
      `https://api.trello.com/1/boards/${cfg.BOARD_ID}/lists?key=${API_KEY}&token=${API_TOKEN}`
    );
    const todas = await res.json();
    return todas.filter(cfg.FILTRO_LISTAS);
  }

  async function criarCard(p, listId) {
    const labels = [];
    if (p.isReclamacao && PLATAFORMA === 'ml') labels.push(LABEL_RECLAM);
    if (p.maisCompras) labels.push(LABEL_MAIS);

    const body = { name: p.nome, desc: p.desc, idList: listId };
    if (p.dueDate)     body.due      = p.dueDate;
    if (labels.length) body.idLabels = labels;

    const res = await fetch(
      `https://api.trello.com/1/cards?key=${API_KEY}&token=${API_TOKEN}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    return res.json();
  }

  // ─── ML: scrape ───────────────────────────────────────────────
  const MESES = { janeiro:1,fevereiro:2,março:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12 };
  const BOTOES_ML = ['já estou com o produto', 'já tenho os produtos'];

  function mlDueDate(card) {
    const textos = [...card.querySelectorAll('*')]
      .filter(e => e.children.length === 0 && e.innerText).map(e => e.innerText.trim());
    for (const t of textos) {
      const m = t.match(/até o dia\s+(\d{1,2})\s+de\s+(\w+)/i);
      if (m) {
        const dia = parseInt(m[1]), mes = MESES[m[2].toLowerCase()];
        if (!mes) continue;
        const ano = new Date().getFullYear();
        const d = new Date(ano, mes - 1, dia, 23, 59, 0);
        if (d < new Date()) d.setFullYear(ano + 1);
        return d.toISOString();
      }
    }
    return null;
  }

  function mlItens(card) {
    const labels   = [...card.querySelectorAll('.label')].map(l => l.innerText.trim());
    const skus     = [...card.querySelectorAll('.sku')].map(s => s.innerText.replace('SKU:', '').trim());
    const unidades = [...card.querySelectorAll('.unit')].map(u => u.innerText.trim());
    const isPacote = labels[0]?.toLowerCase().includes('pacote');

    if (isPacote) {
      const itens = [];
      for (let i = 1; i < labels.length; i++)
        itens.push({ titulo: labels[i] || '', sku: skus[i-1] || '', qtd: unidades[i] || '1 unidade' });
      return { itens, totalQtd: unidades[0] || `${itens.length} itens`, isPacote: true };
    }

    const itens = labels.map((titulo, i) => ({ titulo, sku: skus[i] || '', qtd: unidades[i] || '1 unidade' }));
    const totalNum = unidades.reduce((acc, u) => { const n = parseInt(u); return acc + (isNaN(n) ? 1 : n); }, 0);
    return { itens, totalQtd: `${totalNum} unidade${totalNum !== 1 ? 's' : ''}`, isPacote: false };
  }

  async function mlExpandirPacotes() {
    let n = 0;
    document.querySelectorAll('.row-card-container').forEach(card => {
      const labels = [...card.querySelectorAll('.label')].map(l => l.innerText.trim());
      if (!labels[0]?.toLowerCase().includes('pacote')) return;
      if (card.querySelectorAll('.sku').length > 0) return;
      const t = card.querySelector('.toggle-button');
      if (t) { t.click(); n++; }
    });
    if (n > 0) await new Promise(r => setTimeout(r, 600));
  }

  function mlScrape() {
    const mapa = new Map();
    document.querySelectorAll('.row-card-container').forEach(card => {
      const botoes = [...card.querySelectorAll('button, a')].map(b => b.innerText.trim().toLowerCase());
      const isPersonalizado = botoes.some(b => BOTOES_ML.some(p => b.includes(p)));
      const isReclamacao    = botoes.some(b => b.includes('atender reclamação'));
      if (!isPersonalizado && !isReclamacao) return;

      const nome    = card.querySelector('.buyer-name')?.innerText.trim();
      let   link    = card.querySelector('.right-column__messenger a')?.getAttribute('href');
      if (link) link = link.replace(/&amp;/g, '&');
      const data    = card.querySelector('.left-column__order-date')?.innerText.trim() || '';
      const orderId = card.querySelector('.left-column__pack-id')?.innerText.trim() || '';
      if (!nome || !link) return;

      const dueDate = mlDueDate(card);
      const { itens, totalQtd, isPacote } = mlItens(card);
      const desc = [
        isReclamacao ? '⚠️ RECLAMAÇÃO ABERTA' : '',
        `**Comprador:** ${nome}`,
        `**Data:** ${data}`,
        `**Pedido:** ${orderId}`,
        `**Chat ML:** ${link}`,
        '',
        '**ITENS:**',
        ...itens.map(it => `- ${it.titulo}${it.sku ? ` | SKU: ${it.sku}` : ''} | ${it.qtd}`),
        '',
        `**TOTAL:** ${totalQtd}`,
      ].filter(l => l !== '').join('\n');

      mapa.set(link, { nome, link, data, orderId, dueDate, itens, totalQtd, isPacote, isReclamacao, desc, _chave: link });
    });
    return [...mapa.values()];
  }

  // ─── Shopee: scrape ───────────────────────────────────────────
  function spDueDate(card) {
    const txt = card.querySelector('.status-description')?.innerText?.trim() || '';
    const m = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    const d = new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]), 23, 59, 0);
    d.setDate(d.getDate() - cfg.DIAS_ANTES);
    return d.toISOString();
  }

  function spItens(card) {
    const nomes = [...card.querySelectorAll('.item-name')].map(e => e.innerText.trim());
    const skus  = [...card.querySelectorAll('.item-description')].map(e => e.innerText.trim());
    const qtds  = [...card.querySelectorAll('.item-amount')].map(e => e.innerText.trim());
    const itens = nomes.map((titulo, i) => ({ titulo, sku: skus[i] || '', qtd: qtds[i] || 'x1' }));
    const totalNum = qtds.reduce((acc, q) => { const n = parseInt(q.replace('x','')); return acc + (isNaN(n) ? 1 : n); }, 0);
    return { itens, totalQtd: `${totalNum} unidade${totalNum !== 1 ? 's' : ''}` };
  }

  function spScrape() {
    const mapa = new Map();
    document.querySelectorAll('.order-card').forEach(card => {
      const sobEncomenda = [...card.querySelectorAll('*')]
        .some(e => e.children.length === 0 && e.innerText?.trim() === 'Sob encomenda');
      if (!sobEncomenda) return;

      const nome     = card.querySelector('.buyer-username')?.innerText?.trim();
      const snTexto  = card.querySelector('.order-sn')?.innerText?.trim() || '';
      const idMatch  = snTexto.match(/ID do Pedido\s+(\S+)/i);
      const pedidoId = idMatch ? idMatch[1] : null;
      if (!nome || !pedidoId) return;

      const dueDate = spDueDate(card);
      const { itens, totalQtd } = spItens(card);
      const desc = [
        `**Comprador:** ${nome}`,
        `**ID do Pedido:** ${pedidoId}`,
        '',
        '**ITENS:**',
        ...itens.map(it => `- ${it.titulo}${it.sku ? ` | SKU: ${it.sku}` : ''} | ${it.qtd}`),
        '',
        `**TOTAL:** ${totalQtd}`,
      ].join('\n');

      mapa.set(pedidoId, { nome, pedidoId, itens, totalQtd, dueDate, desc, _chave: pedidoId });
    });
    return [...mapa.values()];
  }

  // ─── UI: preview ──────────────────────────────────────────────
  function showPreview(novos, jaExistem, listas) {
    const ui = criarUI();

    const header = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' });
    header.appendChild(el('span', { color: cfg.ACCENT, fontWeight: 'bold' }, cfg.LABEL));
    header.appendChild(el('span', { color: '#555', fontSize: '11px' }, `${novos.length} novo(s) · ${jaExistem} já existe(m)`));
    ui.appendChild(header);

    const wrap = el('div', { maxHeight: '220px', overflowY: 'auto', marginBottom: '14px' });
    novos.forEach(p => {
      const item = el('div', { padding: '10px', background: '#1a1a1a', borderRadius: '7px', marginBottom: '6px' });

      const top = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' });
      top.appendChild(el('span', { color: '#fff', fontWeight: 'bold' }, p.nome));
      if (p.data) top.appendChild(el('span', { color: '#555', fontSize: '11px' }, p.data));
      item.appendChild(top);

      p.itens.forEach(it => {
        const linha = el('div', { fontSize: '11px', color: '#888', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
        linha.textContent = `• ${it.titulo}${it.sku ? ' | '+it.sku : ''} | ${it.qtd}`;
        item.appendChild(linha);
      });

      const chips = el('div', { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' });

      if (p.isReclamacao)
        chips.appendChild(el('div', { padding: '2px 8px', background: '#2a0000', border: '1px solid #7a0000', borderRadius: '4px', color: '#ff5c5c', fontSize: '11px', fontWeight: 'bold' }, '⚠️ Reclamação'));

      if (p.maisCompras)
        chips.appendChild(el('div', { padding: '2px 8px', background: '#001a3a', border: '1px solid #0047b3', borderRadius: '4px', color: '#7ab8ff', fontSize: '11px', fontWeight: 'bold' }, '🔁 Mais compras'));

      chips.appendChild(el('div', { padding: '2px 8px', background: '#1e2a1e', border: '1px solid #2a4a2a', borderRadius: '4px', color: '#34d399', fontSize: '11px' }, `📦 ${p.totalQtd}`));

      if (p.isPacote)
        chips.appendChild(el('div', { padding: '2px 8px', background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: '4px', color: '#7a9fff', fontSize: '11px' }, '🔀 Pacote'));
      else if (p.itens?.length > 1)
        chips.appendChild(el('div', { padding: '2px 8px', background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: '4px', color: '#7a9fff', fontSize: '11px' }, `🔀 ${p.itens.length} itens`));

      if (p.dueDate)
        chips.appendChild(el('div', { padding: '2px 8px', background: '#2a1a00', border: '1px solid #7a4400', borderRadius: '4px', color: '#ffaa00', fontSize: '11px' }, `📅 Vence ${formatarData(p.dueDate)}`));

      item.appendChild(chips);
      wrap.appendChild(item);
    });
    ui.appendChild(wrap);

    if (jaExistem > 0)
      ui.appendChild(el('div', { padding: '8px 10px', background: '#1a1a1a', borderRadius: '7px', marginBottom: '12px', color: '#666', fontSize: '11px', textAlign: 'center' }, `⏭ ${jaExistem} já existem no Trello`));

    ui.appendChild(el('div', { color: '#888', fontSize: '11px', marginBottom: '6px' }, 'ENVIAR PARA A LISTA:'));
    const sel = document.createElement('select');
    Object.assign(sel.style, { width: '100%', padding: '10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '7px', color: '#fff', fontFamily: 'monospace', fontSize: '13px', marginBottom: '10px', cursor: 'pointer' });
    listas.forEach(l => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; sel.appendChild(o); });
    ui.appendChild(sel);

    const bEnviar = mkBtn(`🚀 Criar ${novos.length} card(s) no Trello`, { background: PLATAFORMA === 'ml' ? '#0052cc' : cfg.ACCENT, color: '#fff' });
    bEnviar.addEventListener('click', async () => {
      showLoading('Criando cards...');
      let ok = 0, err = 0;
      for (const p of novos) {
        try { const c = await criarCard(p, sel.value); if (c.id) ok++; else err++; }
        catch { err++; }
        await new Promise(r => setTimeout(r, 250));
      }
      showFeito(ok, err, jaExistem);
    });
    ui.appendChild(bEnviar);

    const bFechar = mkBtn('Fechar', { background: 'transparent', border: '1px solid #2a2a2a', color: '#555' });
    bFechar.addEventListener('click', rm);
    ui.appendChild(bFechar);
  }

  function showFeito(ok, err, ignorados) {
    const ui = criarUI();
    ui.appendChild(el('div', { color: cfg.ACCENT, fontWeight: 'bold', marginBottom: '12px' }, cfg.LABEL));
    const box = el('div', { padding: '14px', background: '#1a1a1a', borderRadius: '7px', textAlign: 'center', marginBottom: '14px' });
    box.appendChild(el('div', { color: '#34d399', fontSize: '15px', marginBottom: '6px' }, `✔ ${ok} card(s) criado(s)`));
    if (ignorados > 0) box.appendChild(el('div', { color: '#888', fontSize: '12px', marginBottom: '4px' }, `⏭ ${ignorados} já existiam`));
    if (err) box.appendChild(el('div', { color: '#f87171' }, `✘ ${err} erro(s)`));
    ui.appendChild(box);
    const b = mkBtn('Fechar', { background: 'transparent', border: '1px solid #2a2a2a', color: '#555' });
    b.addEventListener('click', rm);
    ui.appendChild(b);
  }

  // ─── Roda ─────────────────────────────────────────────────────
  async function rodar() {
    if (PLATAFORMA === 'ml') {
      showLoading('Expandindo pacotes...');
      await mlExpandirPacotes();
    }

    const pedidos = PLATAFORMA === 'ml' ? mlScrape() : spScrape();
    if (!pedidos.length) {
      showMsg('⚠ Nenhum pedido encontrado', 'Role a página para carregar todos os pedidos e tente novamente.');
      return;
    }

    showLoading('Verificando duplicados no Trello...');
    Promise.all([getDadosExistentes(), getListas()])
      .then(([{ existentes, nomesExistentes }, listas]) => {
        const novos = pedidos
          .filter(p => !existentes.has(p._chave))
          .map(p => ({
            ...p,
            // Marca "mais compras" se o nome do comprador já existe em outro card
            maisCompras: nomesExistentes.has(p.nome.trim().toLowerCase()),
          }));

        const jaExistem = pedidos.length - novos.length;
        if (!novos.length) { showMsg('✔ Tudo já está no Trello!', 'Todos os pedidos já têm card criado.', '#34d399'); return; }
        showPreview(novos, jaExistem, listas);
      })
      .catch(e => { console.error(e); rm(); alert('Erro ao consultar o Trello.'); });
  }

  // ─── Botão ────────────────────────────────────────────────────
  function adicionarBotao() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = `📋 ${cfg.LABEL}`;
    Object.assign(btn.style, {
      position: 'fixed', bottom: '20px', left: '20px', zIndex: '99999',
      background: cfg.BTN_COR, color: cfg.BTN_TEXTO_COR,
      border: 'none', borderRadius: '10px', padding: '12px 18px',
      fontFamily: 'monospace', fontSize: '13px', fontWeight: 'bold',
      cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    });
    btn.addEventListener('click', rodar);
    document.body.appendChild(btn);
  }

  function init() {
    adicionarBotao();
    new MutationObserver(() => adicionarBotao()).observe(document.body, { childList: true, subtree: false });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();