// ==UserScript==
// @name         Scripts Empresa (Unificado)
// @namespace    empresa
// @version      4.6
// @description  Automações Trello
// @match        https://trello.com/b/*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/refs/heads/main/tampermonkey/script.js
// @downloadURL  https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/refs/heads/main/tampermonkey/script.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================
    // CONFIG GLOBAL (SEGURA)
    // =========================

    let API_KEY = localStorage.getItem("trello_key");
    let API_TOKEN = localStorage.getItem("trello_token");

    if (!API_KEY || !API_TOKEN) {
        const key = prompt("Digite sua API KEY do Trello:");
        const token = prompt("Digite seu TOKEN do Trello:");
        if (!key || !token) { alert("❌ API KEY e TOKEN são obrigatórios."); return; }
        localStorage.setItem("trello_key", key);
        localStorage.setItem("trello_token", token);
        API_KEY = key; API_TOKEN = token;
        alert("✅ Credenciais salvas! Recarregue a página.");
        location.reload();
    }

    const ML_REGEX   = /https?:\/\/[^\s"']*mercadolivre[^\s"']*/gi;
    const LINK_REGEX = /https?:\/\/\S+/gi;
    const LIMITE_CARDS_LISTA = 60;

    // =========================
    // CONFIG LISTAS
    // =========================

    const LISTAS_SHOPEE = {
        SEM_INFO:     ["INICIAL 🟢", "FALTA INFORMAÇÕES"],
        DESENVOLVIMENTO: ["AÇÕES", "DESENVOLVIMENTO  🔶",
            ...Array.from({ length: 15 }, (_, i) => `Desenvolvimento ${i + 1}`)],
        AGUARDANDO:   ["AGUARDANDO APROVAÇÃO ⚫", "AGUARDANDO APROVAÇÃO DA ALTERAÇÃO ⚫"],
        ALTERACAO:    ["ALTERAÇÃO 2", "ALTERAÇÃO  VITOR", "ALTERAÇÕES 1", "CORREÇÃO"]
    };

    const LISTAS_ML = {
        SEM_INFO:     ["PROBLEMAS/RECLAMAÇÕES", "FALTA INFORMAÇÕES", "INICIAL"],
        DESENVOLVIMENTO: ["AÇÕES", "EM DESENVOLVIMENTO", "DESENVOLVIMENTO MAÍSA",
            "DESENVOLVIMENTO FELIPE", "DESENVOLVIMENTO LARIANY",
            "DESENVOLVIMENTO TATI", "DESENVOLVIMENTO SIANNE", "DESENVOLVIMENTO RODRIGO"],
        AGUARDANDO:   ["AGUARDANDO APROVAÇÃO", "AGUARDANDO APROVAÇÃO DA ALTERAÇÃO"],
        ALTERACAO:    ["ALTERAÇÕES", "ALTERAÇÕES 4", "ALTERAÇÃO VITOR", "ALTERAÇÕES 5", "CORREÇÃO"]
    };

    const DIAS_SEMANA = ["DOMINGO","SEGUNDA","TERÇA","QUARTA","QUINTA","SEXTA","SÁBADO"];

    // =========================
    // API
    // =========================

    function api(path) {
        return new Promise((resolve, reject) => {
            const sep = path.includes("?") ? "&" : "?";
            GM_xmlhttpRequest({
                method: "GET",
                url: `https://api.trello.com/1${path}${sep}key=${API_KEY}&token=${API_TOKEN}`,
                onload: res => { try { resolve(JSON.parse(res.responseText)); } catch(e) { reject(e); } },
                onerror: reject
            });
        });
    }

    // =========================
    // HELPERS DE DATA
    // =========================

    function dataLocalISO(dateUTC) {
        const d = new Date(dateUTC);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
    }

    function formatarDataBR(iso) {
        const [, m, d] = iso.split("-"); return `${d}/${m}`;
    }

    function gerarDias(qtd = 7) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        return [...Array(qtd)].map((_, i) => {
            const d = new Date(hoje); d.setDate(hoje.getDate() + i);
            return { dataISO: d.toISOString().slice(0, 10), nome: DIAS_SEMANA[d.getDay()], index: i };
        });
    }

    function classePorDia(index, total) {
        if (index === 0) return total === 0 ? "dia-preto" : "dia-vermelho";
        if (index === 1) return total === 0 ? "dia-verde" : "dia-vermelho";
        if (index === 2) {
            if (total === 0) return "dia-verde";
            if (total < 30) return "dia-amarelo";
            if (total < 100) return "dia-laranja";
            return "dia-vermelho";
        }
        if (total >= 100) return "dia-vermelho";
        if (total >= 30)  return "dia-laranja";
        if (total >= 5)   return "dia-amarelo";
        if (total >= 1)   return "dia-amarelinho";
        return "dia-verde";
    }

    // =========================
    // CSS MÉTRICAS
    // =========================

    const CSS_METRICAS = `
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0f0f; color: #fff; font-family: 'IBM Plex Mono', monospace; padding: 30px; }
        h1 { font-size: 1.5rem; margin-bottom: 4px; letter-spacing: 2px; }
        .sub { color: #555; font-size: 0.75rem; margin-bottom: 16px; }
        .toolbar { display: flex; gap: 10px; margin-bottom: 18px; align-items: center; flex-wrap: wrap; }
        .btn-csv {
            display: inline-block; padding: 7px 14px; border-radius: 6px;
            background: #2e7d32; color: #fff; font-weight: bold; font-size: 13px;
            font-family: 'IBM Plex Mono', monospace; text-decoration: none;
        }
        .btn-csv:hover { background: #388e3c; }
        table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
        th, td { border: 1px solid #333; padding: 10px 14px; text-align: center; }
        th { background: #1c1c1c; color: #aaa; letter-spacing: 1px; font-size: 0.78rem; }
        .col-dia { text-align: left; font-weight: bold; }
        .dia-preto      { background: #111; color: #555; }
        .dia-verde      { background: #90ee30; color: #000; }
        .dia-amarelinho { background: #ffde21; color: #000; }
        .dia-amarelo    { background: #f9a825; color: #000; }
        .dia-laranja    { background: #ef6c00; color: #fff; }
        .dia-vermelho   { background: #c62828; color: #fff; }
        .total { background: #1b5e20; font-weight: bold; }
        .total:hover { background: #2e7d32; }
        .separador td { background: #181818; color: #555; font-size: 0.72rem; letter-spacing: 1px; text-align: left; border-color: #222; }
        .legenda { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .leg-item { padding: 3px 10px; border-radius: 4px; font-size: 0.72rem; color: #fff; }
        .leg-item.dia-amarelinho, .leg-item.dia-amarelo { color: #000; }
    `;

    // =========================
    // BUSCAR TABELA DE MÉTRICAS
    // =========================

    async function buscarTabelaMetricas(listas) {
        const boardId = location.pathname.split("/")[2];
        const [lists, cards] = await Promise.all([
            api(`/boards/${boardId}/lists`),
            api(`/boards/${boardId}/cards`)
        ]);

        const listMap = {};
        lists.forEach(l => listMap[l.id] = l.name.trim().toUpperCase());

        const norm = {};
        for (const [tipo, nomes] of Object.entries(listas))
            norm[tipo] = nomes.map(n => n.trim().toUpperCase());

        const tabela = {};
        cards.forEach(c => {
            if (!c.due) return;
            const data = dataLocalISO(c.due);
            const nome = listMap[c.idList] || "";
            let tipo = null;
            if      (norm.SEM_INFO.includes(nome))      tipo = "semInfo";
            else if (norm.DESENVOLVIMENTO.includes(nome)) tipo = "desenvolvimento";
            else if (norm.ALTERACAO.includes(nome))      tipo = "alteracao";
            else if (norm.AGUARDANDO.includes(nome))     tipo = "aguardando";
            else return;
            tabela[data] ??= { semInfo: 0, desenvolvimento: 0, alteracao: 0, aguardando: 0 };
            tabela[data][tipo]++;
        });

        return tabela;
    }

    // =========================
    // CONSTRUIR LINHAS DA TABELA
    // =========================

    function construirTabelaHTML(tabela, qtdDias) {
        const dias = gerarDias(qtdDias);
        const tg = { t: 0, s: 0, d: 0, a: 0, g: 0 };
        let linhas = "";

        dias.forEach((d, idx) => {
            if (qtdDias === 14 && idx === 7)
                linhas += `<tr class="separador"><td colspan="6">── PRÓXIMA SEMANA ──</td></tr>`;

            const v = tabela[d.dataISO] || { semInfo: 0, desenvolvimento: 0, alteracao: 0, aguardando: 0 };
            const total = v.semInfo + v.desenvolvimento + v.alteracao + v.aguardando;
            const cls = classePorDia(d.index, total);
            tg.t += total; tg.s += v.semInfo; tg.d += v.desenvolvimento; tg.a += v.alteracao; tg.g += v.aguardando;

            const hoje = d.index === 0 ? 'style="outline:2px solid #fff"' : "";
            linhas += `<tr class="${cls}" ${hoje}>
    <td class="col-dia">${d.index === 0 ? "📌 " : ""}${d.nome} ${formatarDataBR(d.dataISO)}</td>
    <td><strong>${total}</strong></td>
    <td>${v.semInfo}</td><td>${v.desenvolvimento}</td><td>${v.alteracao}</td><td>${v.aguardando}</td>
</tr>`;
        });

        return { linhas, tg };
    }

    // =========================
    // GERAR CSV
    // =========================

    function gerarCSV(tabela, qtdDias) {
        const dias = gerarDias(qtdDias);
        const rows = [["Dia","Data","Total","Sem Info","Em Desenvolvimento","Alteracao","Aguardando"]];
        dias.forEach(d => {
            const v = tabela[d.dataISO] || { semInfo: 0, desenvolvimento: 0, alteracao: 0, aguardando: 0 };
            rows.push([d.nome, formatarDataBR(d.dataISO),
                v.semInfo+v.desenvolvimento+v.alteracao+v.aguardando,
                v.semInfo, v.desenvolvimento, v.alteracao, v.aguardando]);
        });
        return "\uFEFF" + rows.map(r => r.join(";")).join("\n");
    }

    // =========================
    // ABRIR JANELA DE MÉTRICAS
    // CSV via data URI — funciona sem restrições no about:blank
    // Atualizar = fechar e reabrir pelo menu (sem botão, sem cross-origin)
    // =========================

    function abrirJanelaMetricas(tabela, titulo, corTitulo, qtdDias) {
        const { linhas, tg } = construirTabelaHTML(tabela, qtdDias);
        const csvData = gerarCSV(tabela, qtdDias);
        const geradoEm = new Date().toLocaleString("pt-BR");
        const csvURI   = "data:text/csv;charset=utf-8," + encodeURIComponent(csvData);
        const nomeCSV  = titulo.replace(/\s+/g, "_") + "_" +
                         new Date().toLocaleDateString("pt-BR").replace(/\//g, "-") + ".csv";

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${titulo}</title>
<style>${CSS_METRICAS}</style>
</head>
<body>
<h1 style="color:${corTitulo}">📊 ${titulo}</h1>
<p class="sub">Gerado em: ${geradoEm} &nbsp;·&nbsp; Para atualizar, feche e reabra pelo menu ⚙️</p>

<div class="toolbar">
    <a class="btn-csv" href="${csvURI}" download="${nomeCSV}">📥 Exportar CSV</a>
    <span style="color:#555;font-size:0.72rem;margin-left:auto">Exibindo ${qtdDias} dias</span>
</div>

<div class="legenda">
    <span class="leg-item dia-preto">⬛ Hoje zerado</span>
    <span class="leg-item dia-verde">🟢 Zerado/OK</span>
    <span class="leg-item dia-amarelinho">🟡 1–4</span>
    <span class="leg-item dia-amarelo">🟠 5–29</span>
    <span class="leg-item dia-laranja">🔶 30–99</span>
    <span class="leg-item dia-vermelho">🔴 100+</span>
</div>

<table>
<thead><tr>
    <th>DIA</th><th>TOTAL</th><th>SEM INFO</th>
    <th>EM DESENV.</th><th>ALTERAÇÃO</th><th>AGUARDANDO</th>
</tr></thead>
<tbody>
${linhas}
<tr class="total">
    <td class="col-dia">🧮 TOTAL (${qtdDias} dias)</td>
    <td>${tg.t}</td><td>${tg.s}</td><td>${tg.d}</td><td>${tg.a}</td><td>${tg.g}</td>
</tr>
</tbody>
</table>
</body></html>`;

        const w = window.open("", "_blank");
        w.document.open();
        w.document.write(html);
        w.document.close();
    }

    // =========================
    // MÉTRICAS SHOPEE
    // =========================

    async function metricasShopee() {
        try {
            const tabela = await buscarTabelaMetricas(LISTAS_SHOPEE);
            abrirJanelaMetricas(tabela, "MÉTRICAS SHOPEE", "#ff9800", 7);
        } catch { alert("❌ Erro ao buscar dados. Verifique suas credenciais."); }
    }

    // =========================
    // MÉTRICAS SHOPEE — 14 DIAS
    // =========================

    async function metricasShopee14() {
        try {
            const tabela = await buscarTabelaMetricas(LISTAS_SHOPEE);
            abrirJanelaMetricas(tabela, "MÉTRICAS SHOPEE", "#ff9800", 14);
        } catch { alert("❌ Erro ao buscar dados. Verifique suas credenciais."); }
    }

    // =========================
    // MÉTRICAS ML
    // =========================

    async function metricasML() {
        try {
            const tabela = await buscarTabelaMetricas(LISTAS_ML);
            abrirJanelaMetricas(tabela, "MÉTRICAS MERCADO LIVRE", "#ffde21", 7);
        } catch { alert("❌ Erro ao buscar dados. Verifique suas credenciais."); }
    }

    // =========================
    // MÉTRICAS ML — 14 DIAS
    // =========================

    async function metricasML14() {
        try {
            const tabela = await buscarTabelaMetricas(LISTAS_ML);
            abrirJanelaMetricas(tabela, "MÉTRICAS MERCADO LIVRE", "#ffde21", 14);
        } catch { alert("❌ Erro ao buscar dados. Verifique suas credenciais."); }
    }

    // =========================
    // AUDITORIA
    // =========================

    // Detecta plataforma pelo nome do board e audita
    async function auditarAtual() {
        const boardId = location.pathname.split("/")[2];
        try {
            const board = await api(`/boards/${boardId}?fields=name`);
            const nome = (board.name || "").toLowerCase();
            let plataforma = "ML";
            if (nome.includes("shopee")) plataforma = "Shopee";
            auditar(plataforma);
        } catch {
            auditar("ML"); // fallback
        }
    }

    async function auditar(plataforma) {
        const boardId = location.pathname.split("/")[2];
        const w = window.open("", "_blank");
        w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="background:#0f0f0f;color:#fff;font-family:monospace;padding:30px">
<p>🔎 Analisando quadro...</p></body></html>`);

        try {
            const [cards, lists] = await Promise.all([
                api(`/boards/${boardId}/cards?fields=name,desc,url,idList,due,labels`),
                api(`/boards/${boardId}/lists?fields=name`)
            ]);

            const listMap = {};
            lists.forEach(l => listMap[l.id] = l.name);

            const titleMap = {}, linkMap = {}, semLink = [], semData = [];

            // Filtrar cards de controle (separadores/cabeçalhos de lista)
            const CTRL_RE = /^(──|==|--|🟢|🔶|⚫|🔴|🟡|•{2}|_{2}|\*{2}|#{2})/;
            const cardsReais = cards.filter(card => {
                const n = card.name.trim();
                return n.length > 0 && !CTRL_RE.test(n);
            });

            cardsReais.forEach(card => {
                const titulo = card.name.trim().toLowerCase();
                titleMap[titulo] ??= []; titleMap[titulo].push(card);

                const links = (card.desc || "").match(LINK_REGEX) || [];
                links.forEach(link => { linkMap[link] ??= []; linkMap[link].push(card); });

                if (links.length === 0) semLink.push(card);
                if (!card.due)          semData.push(card);
            });

            const titlesDup = Object.values(titleMap).filter(g => g.length > 1);
            const linksDup  = Object.entries(linkMap).filter(([, g]) => g.length > 1);

            renderAuditoria(w, plataforma, titlesDup, linksDup, semLink, semData, listMap);

        } catch (err) {
            w.document.body.innerHTML = `<p style="color:#ef5350;font-family:monospace;padding:30px">❌ Erro ao buscar dados.</p>`;
            console.error(err);
        }
    }

    function renderAuditoria(w, plataforma, titlesDup, linksDup, semLink, semData, listMap) {
        const cor = plataforma === "Shopee" ? "#ff9800" : "#ffde21";
        const geradoEm = new Date().toLocaleString("pt-BR");
        const total = titlesDup.length + linksDup.length + semLink.length + semData.length;

        function secao(icone, titulo, itens, colunas, renderLinha) {
            const badge = itens.length === 0
                ? `<span class="badge ok">✅ Nenhum problema</span>`
                : `<span class="badge erro">${itens.length} item(s)</span>`;
            const corpo = itens.length === 0 ? "" : `
<table><tr>${colunas.map(c=>`<th>${c}</th>`).join("")}</tr>
${itens.map(renderLinha).join("")}</table>`;
            return `<div class="secao ${itens.length===0?"limpa":""}"><h2>${icone} ${titulo} ${badge}</h2>${corpo}</div>`;
        }

        const s1 = secao("🔤","Títulos duplicados", titlesDup, ["Título","Lista","Etiqueta","Abrir"],
            g => g.map(c => {
                const temMaisCompras = (c.labels || []).some(l =>
                    (l.name || "").toLowerCase().includes("mais compras")
                );
                const badge = temMaisCompras
                    ? `<span style="background:#e040fb;color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;white-space:nowrap">🏷️ Mais compras</span>`
                    : "—";
                return `<tr>
                    <td>${c.name}</td>
                    <td class="lista">${listMap[c.idList]||"—"}</td>
                    <td>${badge}</td>
                    <td><a href="${c.url}" target="_blank">Abrir</a></td>
                </tr>`;
            }).join(""));

        const s2 = secao("🔗","Links duplicados", linksDup, ["Link","Card","Lista"],
            ([link,arr]) => arr.map(c=>`<tr>
                <td class="link-cell"><a href="${link}" target="_blank">${link.length>70?link.slice(0,67)+"...":link}</a></td>
                <td><a href="${c.url}" target="_blank">${c.name}</a></td>
                <td class="lista">${listMap[c.idList]||"—"}</td></tr>`).join(""));

        const s3 = secao("🚫","Cards sem link", semLink, ["Card","Lista","Abrir"],
            c=>`<tr><td>${c.name}</td><td class="lista">${listMap[c.idList]||"—"}</td><td><a href="${c.url}" target="_blank">Abrir</a></td></tr>`);

        const s4 = secao("📅","Cards sem data de vencimento", semData, ["Card","Lista","Abrir"],
            c=>`<tr><td>${c.name}</td><td class="lista">${listMap[c.idList]||"—"}</td><td><a href="${c.url}" target="_blank">Abrir</a></td></tr>`);

        const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Auditoria ${plataforma}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f0f;color:#fff;font-family:'IBM Plex Mono',monospace;padding:30px}
h1{color:${cor};font-size:1.5rem;letter-spacing:2px;margin-bottom:4px}
.sub{color:#555;font-size:.72rem;margin-bottom:24px}
.resumo{display:flex;gap:12px;margin-bottom:32px;flex-wrap:wrap}
.rc{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 18px;min-width:110px}
.rc .num{font-size:2rem;font-weight:bold;margin-top:4px}
.rc.prob .num{color:#ef5350} .rc.ok .num{color:#66bb6a}
.rc .lbl{color:#666;font-size:.72rem}
.secao{margin-bottom:36px}
.secao.limpa h2{color:#444}
h2{font-size:.95rem;margin-bottom:14px;display:flex;align-items:center;gap:10px}
.badge{font-size:.7rem;padding:3px 8px;border-radius:10px}
.badge.ok{background:#1b5e20;color:#a5d6a7} .badge.erro{background:#b71c1c;color:#ffcdd2}
table{width:100%;border-collapse:collapse;font-size:.82rem;margin-top:8px}
th,td{border:1px solid #222;padding:9px 12px;text-align:left}
th{background:#1c1c1c;color:#777;font-size:.72rem;letter-spacing:1px}
tr:hover td{background:#1a1a1a}
a{color:#64b5f6;text-decoration:none} a:hover{text-decoration:underline}
.lista{color:#666;font-size:.78rem} .link-cell{max-width:320px;word-break:break-all}
</style></head><body>
<h1>🔎 Auditoria — ${plataforma}</h1>
<p class="sub">Gerado em: ${geradoEm}</p>
<div class="resumo">
    <div class="rc ${total===0?"ok":"prob"}"><div class="lbl">Total</div><div class="num">${total}</div></div>
    <div class="rc ${titlesDup.length===0?"ok":"prob"}"><div class="lbl">Títulos duplic.</div><div class="num">${titlesDup.length}</div></div>
    <div class="rc ${linksDup.length===0?"ok":"prob"}"><div class="lbl">Links duplic.</div><div class="num">${linksDup.length}</div></div>
    <div class="rc ${semLink.length===0?"ok":"prob"}"><div class="lbl">Sem link</div><div class="num">${semLink.length}</div></div>
    <div class="rc ${semData.length===0?"ok":"prob"}"><div class="lbl">Sem data</div><div class="num">${semData.length}</div></div>
</div>
${s1}${s2}${s3}${s4}
</body></html>`;

        w.document.open(); w.document.write(html); w.document.close();
    }

    // =========================
    // ALERTA DE LISTAS LOTADAS
    // =========================

    async function alertaListasLotadas() {
        const boardId = location.pathname.split("/")[2];
        try {
            const [lists, cards] = await Promise.all([
                api(`/boards/${boardId}/lists`),
                api(`/boards/${boardId}/cards?fields=idList`)
            ]);

            const contagem = {};
            cards.forEach(c => { contagem[c.idList] = (contagem[c.idList] || 0) + 1; });

            const lotadas = lists
                .filter(l => (contagem[l.id] || 0) >= LIMITE_CARDS_LISTA)
                .map(l => ({ nome: l.name, qtd: contagem[l.id] }))
                .sort((a, b) => b.qtd - a.qtd);

            if (lotadas.length === 0) {
                alert(`✅ Nenhuma lista com ${LIMITE_CARDS_LISTA}+ cards.`);
            } else {
                const linhas = lotadas.map(l => `  ⚠️ ${l.nome}: ${l.qtd} cards`).join("\n");
                alert(`🚨 ${lotadas.length} lista(s) com ${LIMITE_CARDS_LISTA}+ cards:\n\n${linhas}`);
            }

            // Resetar botão após visualizar
            resetarBotao();

        } catch (err) {
            alert("❌ Erro ao verificar listas.");
            console.error(err);
        }
    }

    function resetarBotao() {
        const btn = document.getElementById("btn-empresa");
        if (!btn) return;
        btn.style.background   = "#111";
        btn.style.borderColor  = "#333";
        btn.style.opacity      = "1";
        btn.title = "Scripts Empresa";
    }

    // Verificação silenciosa ao carregar
    async function verificarAlertaAuto() {
        try {
            const boardId = location.pathname.split("/")[2];
            const [lists, cards] = await Promise.all([
                api(`/boards/${boardId}/lists`),
                api(`/boards/${boardId}/cards?fields=idList`)
            ]);
            const contagem = {};
            cards.forEach(c => { contagem[c.idList] = (contagem[c.idList] || 0) + 1; });
            const temLotada = lists.some(l => (contagem[l.id] || 0) >= LIMITE_CARDS_LISTA);
            if (!temLotada) return;

            const btn = document.getElementById("btn-empresa");
            if (!btn) return;
            btn.style.background  = "#b71c1c";
            btn.style.borderColor = "#ef5350";
            btn.title = `⚠️ Lista(s) com ${LIMITE_CARDS_LISTA}+ cards! Clique para ver.`;

            let piscadas = 0;
            const iv = setInterval(() => {
                btn.style.opacity = btn.style.opacity === "0.3" ? "1" : "0.3";
                if (++piscadas >= 6) { clearInterval(iv); btn.style.opacity = "1"; }
            }, 400);
        } catch { /* silencioso */ }
    }

    // =========================
    // ABRIR CHATS ML
    // =========================

    async function abrirML() {
        const listName = prompt("Nome da lista:", "INICIAL");
        if (!listName) return;

        const startAfter = prompt("ID do card para começar (opcional):")?.trim();
        const limit = parseInt(prompt("Quantidade máxima de links para abrir:"), 10);
        if (!limit || isNaN(limit)) return alert("❌ Número inválido.");
        if (limit > 20 && !confirm(`Você vai abrir até ${limit} links de uma vez.\n\nContinuar?`)) return;

        const boardId = location.pathname.split("/")[2];
        try {
            const lists = await api(`/boards/${boardId}/lists`);
            const list  = lists.find(l => l.name.trim().toUpperCase() === listName.trim().toUpperCase());
            if (!list) return alert(`❌ Lista "${listName}" não encontrada.`);

            const cards = await api(`/lists/${list.id}/cards`);
            let opened = 0, canStart = !startAfter;

            for (const card of cards) {
                if (!canStart) { if (card.shortLink === startAfter) canStart = true; continue; }
                if (opened >= limit) break;
                if (!card.desc) continue;
                const links = card.desc.match(ML_REGEX) || [];
                for (const link of links) {
                    if (opened >= limit) break;
                    window.open(link, "_blank"); opened++;
                }
            }
            alert(`✅ ${opened} link(s) aberto(s).`);
        } catch (err) {
            alert("❌ Erro ao buscar lista."); console.error(err);
        }
    }

    // =========================
    // ABRIR POR DATA
    // =========================

    async function abrirPorData() {
        const inputDate = prompt("Data (DD/MM/AAAA):", new Date().toLocaleDateString("pt-BR"));
        if (!inputDate) return;
        const [d, m, y] = inputDate.split("/");
        if (!d || !m || !y) return alert("❌ Formato inválido. Use DD/MM/AAAA.");

        const target = new Date(y, m - 1, d);
        const boardId = location.pathname.split("/")[2];
        try {
            const cards = await api(`/boards/${boardId}/cards`);
            let opened = 0;
            cards.forEach(card => {
                if (!card.due || !card.desc) return;
                const due = new Date(card.due);
                if (due.getFullYear() !== target.getFullYear() ||
                    due.getMonth()    !== target.getMonth()    ||
                    due.getDate()     !== target.getDate()) return;
                const links = card.desc.match(LINK_REGEX) || [];
                links.forEach(l => { window.open(l, "_blank"); opened++; });
            });
            alert(`✅ ${opened} link(s) aberto(s) para ${inputDate}.`);
        } catch (err) {
            alert("❌ Erro ao buscar cards."); console.error(err);
        }
    }

    // =========================
    // REDEFINIR CREDENCIAIS
    // =========================

    function limparCredenciais() {
        if (!confirm("Deseja redefinir suas credenciais do Trello?")) return;
        localStorage.removeItem("trello_key");
        localStorage.removeItem("trello_token");
        alert("✅ Credenciais removidas. Recarregando...");
        location.reload();
    }

    // =========================
    // BOTÃO FLUTUANTE
    // =========================

    function criarBotaoFlutuante() {
        if (document.getElementById("btn-empresa")) return;

        // Botão principal ⚙️ — circular
        const btn = document.createElement("button");
        btn.id = "btn-empresa"; btn.innerText = "⚙️"; btn.title = "Scripts Empresa v4.2 — Automações Trello";
        Object.assign(btn.style, {
            position: "fixed", bottom: "20px", right: "20px", zIndex: "999999",
            width: "46px", height: "46px", borderRadius: "50%",
            border: "2px solid #333", background: "#111", color: "#fff",
            cursor: "pointer", fontSize: "18px", display: "flex",
            alignItems: "center", justifyContent: "center", padding: "0",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            transition: "transform 0.15s, background 0.2s, border-color 0.2s"
        });
        btn.onmouseenter = () => btn.style.transform = "scale(1.1)";
        btn.onmouseleave = () => btn.style.transform = "scale(1)";
        btn.onclick = toggleMenu;
        document.body.appendChild(btn);

        verificarAlertaAuto();
    }

    // =========================
    // MENU
    // =========================

    function toggleMenu() {
        let menu = document.getElementById("menu-empresa");
        if (menu) { menu.remove(); return; }

        menu = document.createElement("div");
        menu.id = "menu-empresa";
        Object.assign(menu.style, {
            position: "fixed", bottom: "72px", right: "20px",
            background: "#111", border: "1px solid #333", padding: "12px",
            borderRadius: "12px", zIndex: "999999", color: "#fff",
            display: "flex", flexDirection: "column", gap: "6px",
            minWidth: "240px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)"
        });

        // Header do menu com botão de credenciais no canto superior direito
        const menuHeader = document.createElement("div");
        Object.assign(menuHeader.style, {
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: "4px", paddingBottom: "8px", borderBottom: "1px solid #222"
        });
        const menuTitulo = document.createElement("span");
        menuTitulo.innerText = "⚙️ Scripts Empresa";
        Object.assign(menuTitulo.style, { color: "#555", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase" });

        const btnCredMenu = document.createElement("button");
        btnCredMenu.innerText = "🔑";
        btnCredMenu.title = "Redefinir credenciais Trello";
        Object.assign(btnCredMenu.style, {
            background: "transparent", border: "1px solid #333", borderRadius: "50%",
            width: "24px", height: "24px", cursor: "pointer", fontSize: "11px",
            color: "#555", display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0", transition: "color 0.15s, border-color 0.15s"
        });
        btnCredMenu.onmouseenter = () => { btnCredMenu.style.color = "#f9a825"; btnCredMenu.style.borderColor = "#f9a825"; };
        btnCredMenu.onmouseleave = () => { btnCredMenu.style.color = "#555"; btnCredMenu.style.borderColor = "#333"; };
        btnCredMenu.onclick = () => { menu.remove(); limparCredenciais(); };

        menuHeader.appendChild(menuTitulo);
        menuHeader.appendChild(btnCredMenu);
        menu.appendChild(menuHeader);

        function sep(label) {
            const el = document.createElement("div");
            el.innerText = label;
            Object.assign(el.style, { color:"#555", fontSize:"10px", letterSpacing:"1.5px", padding:"8px 4px 2px", textTransform:"uppercase" });
            return el;
        }

        const grupos = [
            { label: "📨 Atendimento", itens: [
                { id:"btn-ml",   label:"🔗 Abrir Chats ML",  fn: abrirML },
                { id:"btn-data", label:"📅 Abrir por Data",   fn: abrirPorData },
            ]},
            { label: "📊 Métricas", itens: [
                { id:"btn-ml7",  label:"📊 ML — 7 dias",      fn: metricasML },
                { id:"btn-ml14", label:"📊 ML — 14 dias",     fn: metricasML14 },
                { id:"btn-ms7",  label:"📊 Shopee — 7 dias",  fn: metricasShopee },
                { id:"btn-ms14", label:"📊 Shopee — 14 dias", fn: metricasShopee14 },
            ]},
            { label: "🔎 Auditoria", itens: [
                { id:"btn-aud",   label:"🔎 Auditar quadro",  fn: auditarAtual },
                { id:"btn-listas", label:"🚨 Listas lotadas",  fn: alertaListasLotadas },
            ]},
        ];

        grupos.forEach(({ label, itens }) => {
            menu.appendChild(sep(label));
            itens.forEach(({ id, label, fn }) => {
                const b = document.createElement("button");
                b.id = id; b.innerText = label;
                Object.assign(b.style, {
                    background:"#1e1e1e", color:"#fff", border:"1px solid #2a2a2a",
                    borderRadius:"8px", padding:"9px 12px", cursor:"pointer",
                    fontSize:"13px", textAlign:"left", transition:"background 0.15s"
                });
                b.onmouseenter = () => b.style.background = "#2a2a2a";
                b.onmouseleave = () => b.style.background = "#1e1e1e";
                b.onclick = () => { menu.remove(); fn(); };
                menu.appendChild(b);
            });
        });

        document.body.appendChild(menu);
        setTimeout(() => {
            document.addEventListener("click", function fechar(e) {
                if (!menu.contains(e.target) && e.target.id !== "btn-empresa") {
                    menu.remove(); document.removeEventListener("click", fechar);
                }
            });
        }, 50);
    }

    // =========================
    // INIT
    // =========================

    criarBotaoFlutuante();

})();