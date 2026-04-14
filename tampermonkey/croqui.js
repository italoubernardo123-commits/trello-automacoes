// ==UserScript==
// @name         Trello — Gerador de Croqui
// @namespace    empresa-croqui
// @version      6.3
// @description  Gera folha de croqui a partir do card aberto no Trello
// @match        https://trello.com/b/*
// @match        https://trello.com/c/*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/refs/heads/main/tampermonkey/croqui.js
// @downloadURL  https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/refs/heads/main/tampermonkey/croqui.js
// ==/UserScript==

(function () {
    'use strict';

    function getKey()   { return localStorage.getItem("trello_key"); }
    function getToken() { return localStorage.getItem("trello_token"); }

    const SPECS_BASE = ["Completo", "Tecido"];

    function getDesigners() {
        try { return JSON.parse(localStorage.getItem("croqui_designers") || "[]"); }
        catch { return []; }
    }
    function saveDesigners(list) {
        localStorage.setItem("croqui_designers", JSON.stringify(list));
    }

    function hojeFormatado() {
        return new Date().toLocaleDateString("pt-BR");
    }

    function detectarPlataforma() {
        const title = document.title.toLowerCase();
        if (title.includes("shopee")) return "shopee";
        if (title.includes("trafego") || title.includes("tráfego")) return "trafego";
        return "ml";
    }

    // Rastreia shortLink continuamente — card fecha ao clicar fora
    let _lastShortLink = null;

    function rastrearURL() {
        const m = location.href.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
        if (m) _lastShortLink = m[1];
    }

    const _origPush    = history.pushState.bind(history);
    const _origReplace = history.replaceState.bind(history);
    history.pushState    = (...a) => { _origPush(...a);    rastrearURL(); };
    history.replaceState = (...a) => { _origReplace(...a); rastrearURL(); };
    window.addEventListener("popstate", rastrearURL);
    setInterval(rastrearURL, 300);

    // Atalhos de teclado
    document.addEventListener("keydown", function(e) {
        // Alt+C → abre formulário de croqui
        if (e.altKey && (e.key === "c" || e.key === "C")) {
            e.preventDefault();
            abrirFormulario();
        }
        // ESC → fecha qualquer overlay aberto
        if (e.key === "Escape") {
            const oc = document.getElementById("overlay-croqui");
            const od = document.getElementById("overlay-designers");
            if (oc) oc.remove();
            if (od) od.remove();
        }
    });

    function getShortLink() {
        const m = location.href.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
        return m ? m[1] : _lastShortLink;
    }

    function apiGet(path) {
        return new Promise((resolve, reject) => {
            const sep = path.includes("?") ? "&" : "?";
            GM_xmlhttpRequest({
                method: "GET",
                url: `https://api.trello.com/1${path}${sep}key=${getKey()}&token=${getToken()}`,
                onload: r => { try { resolve(JSON.parse(r.responseText)); } catch(e) { reject(e); } },
                onerror: reject
            });
        });
    }

    // =========================
    // PARSEAR DESCRIÇÃO DO CARD
    // =========================

    function parsearDescricao(desc) {
        if (!desc || !desc.trim()) return null;

        const resultado = {
            dataPedido: "",
            numeroPedido: "",
            itens: [],
            qtdTotal: 0,
            spec: "",
            doisMetros: false,
            alertas: []
        };

        // Data e hora
        // Tolerante a markdown bold (**Data:** ou Data:)
        const mData = desc.match(/Data[*\s:]+(\d{1,2}\s+\w+\s+\d{2}:\d{2})/i);
        if (mData) resultado.dataPedido = mData[1].trim();

        // Número do pedido — ML (#123456789) ou Shopee (alfanumérico ex: 260328AAS1BWF6)
        // Tolerante a markdown — "Pedido:" ou "**Pedido:**"
        const mPedidoML     = desc.match(/Pedido[*\s:]+(#?\d{10,})/i);
        // Shopee: "ID do Pedido:" ou "**ID do Pedido:**"
        const mPedidoShopee = desc.match(/ID[*\s]+do[*\s]+Pedido[*:\s]+([A-Z0-9]{8,})/i);
        if (mPedidoML)          resultado.numeroPedido = mPedidoML[1].trim();
        else if (mPedidoShopee) resultado.numeroPedido = mPedidoShopee[1].trim();

        // Palavras-chave que NÃO contêm banner para impressão
        // Verifica APENAS pelo SKU — nome do produto pode conter "base", "painel" etc sem ser acessório
        const SKU_SEM_BANNER = ["BASE", "PAINEL", "CAPA"];

        function temBanner(nomeItem, sku) {
            const skuUpper = sku.toUpperCase();
            return !SKU_SEM_BANNER.some(k => skuUpper.includes(k));
        }

        function detectarTipoItem(nomeItem, sku) {
            const skuUpper = sku.toUpperCase();
            if (SKU_SEM_BANNER.some(k => skuUpper.includes(k))) {
                if (skuUpper.includes("BASE"))   return "Base";
                if (skuUpper.includes("PAINEL")) return "Painel";
                if (skuUpper.includes("CAPA"))   return "Capa";
                return "Acessório";
            }
            const lower = nomeItem.toLowerCase();
            if (lower.includes("tecido"))   return "Tecido";
            if (lower.includes("completo")) return "Completo";
            return "Completo"; // padrão — se não tem tecido no nome, é completo
        }

        // Itens — pega linhas que começam com * ou bullet
        const linhasItens = desc.split("\n").filter(l => l.trim().match(/^[*•-]\s+(?!TOTAL)/i));
        let qtdBanners = 0;

        linhasItens.forEach(linha => {
            // Suporta ML: "| 1 unidade" e Shopee: "| x1"
            const mItem = linha.match(/[*•-]\s+(.+?)\s*\|\s*SKU:\s*([^\|]+)\s*\|\s*[xX]?(\d+)(?:\s*unidade)?/i);
            if (!mItem) return;

            const nomeItem = mItem[1].trim();
            const sku      = mItem[2].trim().replace(/[\[\]]/g, "").trim();
            const qtd      = parseInt(mItem[3]);
            const tipo     = detectarTipoItem(nomeItem, sku);
            const comBanner = temBanner(nomeItem, sku);

            // Só conta na quantidade se tiver banner
            if (comBanner) qtdBanners += qtd;

            // Detectar tamanho
            let tamanho = "";
            const mTamanho = nomeItem.match(/(\d+[,.]?\d*)\s*m(?:etros?)?/i);
            if (mTamanho) {
                const val = parseFloat(mTamanho[1].replace(",", "."));
                tamanho = val <= 2.1 ? "2m" : "2,80m";
            }

            resultado.itens.push({ nome: nomeItem, sku, qtd, tipo, tamanho, comBanner });
        });

        // Se não achou itens no formato ML/Shopee, tenta parser de tráfego (texto livre)
        if (resultado.itens.length === 0 && desc.trim().length > 0) {
            const lower = desc.toLowerCase();

            // Quantidade
            const mQtd = desc.match(/(\d+)\s*unidade/i) || desc.match(/^(\d+)\s/m);
            const qtd = mQtd ? parseInt(mQtd[1]) : 1;

            // Tipo
            let tipo = "Completo";
            if (lower.includes("tecido")) tipo = "Tecido";

            // Tamanho — 2m ou 2,80m
            let doisMetros = false;
            const mTam = desc.match(/(\d+[,.]?\d*)\s*m(?:etros?)?/i);
            if (mTam) {
                const val = parseFloat(mTam[1].replace(",", "."));
                if (val <= 2.1) doisMetros = true;
            }

            resultado.itens.push({ nome: desc.trim(), sku: "", qtd, tipo, tamanho: doisMetros ? "2m" : "2,80m", comBanner: true });
            qtdBanners = qtd;
            resultado.spec = tipo;
            resultado.doisMetros = doisMetros;
        }

        resultado.qtdTotal = qtdBanners;

        // Montar spec combinada
        if (resultado.itens.length > 0) {
            const grupos = {};
            resultado.itens.forEach(item => {
                grupos[item.tipo] = (grupos[item.tipo] || 0) + item.qtd;
            });

            const tiposUnicos = Object.keys(grupos);

            if (tiposUnicos.length === 1) {
                // Só um tipo — usa dropdown padrão se for Completo ou Tecido
                resultado.spec = tiposUnicos[0]; // ex: "Completo" ou "Tecido"
            } else {
                // Tipos diferentes — monta string combinada para campo custom
                const partes = Object.entries(grupos).map(([tipo, qtd]) =>
                    qtd > 1 ? `${qtd}x ${tipo}` : `1 ${tipo}`
                );
                resultado.spec = partes.join(" + ");
            }

            // Detectar se é kit 2m — só completo 2m sem outros banners maiores
            const itensComBanner = resultado.itens.filter(i => i.comBanner);
            const temCompleto2m  = itensComBanner.some(i => i.tipo === "Completo" && i.tamanho === "2m");
            const todosSao2m     = itensComBanner.every(i => i.tamanho === "2m");
            resultado.doisMetros = temCompleto2m && todosSao2m;
        }

        return resultado;
    }

    async function getDadosCard() {
        if (!getKey() || !getToken()) {
            alert("⚠️ Credenciais não encontradas. Use o script principal (⚙️) para cadastrá-las primeiro.");
            return null;
        }
        const shortLink = getShortLink();
        if (!shortLink) return { nome: "", dataEntrega: "", plataforma: detectarPlataforma(), descParsed: null };
        try {
            const card = await apiGet(`/cards/${shortLink}?fields=name,due,desc`);
            let dataEntrega = "";
            if (card.due) {
                const d = new Date(card.due);
                dataEntrega = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString("pt-BR");
            }
            const descParsed = parsearDescricao(card.desc || "");
            return {
                nome: (card.name || "").trim(),
                dataEntrega,
                plataforma: detectarPlataforma(),
                descParsed
            };
        } catch {
            return { nome: "", dataEntrega: "", plataforma: detectarPlataforma(), descParsed: null };
        }
    }

    // =========================
    // BOTÕES FLUTUANTES
    // =========================

    function criarBotoes() {
        if (document.getElementById("btn-croqui")) return;

        const btnCroqui = document.createElement("button");
        btnCroqui.id = "btn-croqui";
        btnCroqui.innerText = "📄 Croqui";
        btnCroqui.title = "Gerar Croqui (Alt+C) — v6.3";
        Object.assign(btnCroqui.style, {
            position: "fixed", bottom: "20px", right: "120px", zIndex: "999999",
            padding: "10px 14px", borderRadius: "8px", border: "2px solid #f9a825",
            background: "#111", color: "#f9a825", cursor: "pointer",
            fontSize: "13px", fontWeight: "bold",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)", transition: "transform 0.15s, background 0.15s"
        });
        btnCroqui.onmouseenter = () => { btnCroqui.style.background = "#1a1500"; btnCroqui.style.transform = "scale(1.05)"; };
        btnCroqui.onmouseleave = () => { btnCroqui.style.background = "#111"; btnCroqui.style.transform = "scale(1)"; };
        btnCroqui.onclick = abrirFormulario;
        document.body.appendChild(btnCroqui);

        const btnD = document.createElement("button");
        btnD.id = "btn-designers";
        btnD.innerText = "👤";
        btnD.title = "Gerenciar designers";
        Object.assign(btnD.style, {
            position: "fixed", bottom: "20px", right: "225px", zIndex: "999999",
            padding: "10px 12px", borderRadius: "8px", border: "1px solid #333",
            background: "#111", color: "#aaa", cursor: "pointer", fontSize: "14px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)", transition: "transform 0.15s"
        });
        btnD.onmouseenter = () => btnD.style.transform = "scale(1.1)";
        btnD.onmouseleave = () => btnD.style.transform = "scale(1)";
        btnD.onclick = abrirGerenciarDesigners;
        document.body.appendChild(btnD);
    }

    // =========================
    // FORMULÁRIO
    // =========================

    async function abrirFormulario() {
        if (document.getElementById("overlay-croqui")) return;

        const btn = document.getElementById("btn-croqui");
        btn.innerText = "⏳ Buscando...";
        btn.disabled = true;

        const dados = await getDadosCard();

        btn.innerText = "📄 Croqui";
        btn.disabled = false;
        if (!dados) return;

        const designers  = getDesigners();
        const overlay    = document.createElement("div");
        overlay.id       = "overlay-croqui";
        Object.assign(overlay.style, {
            position: "fixed", inset: "0", background: "rgba(0,0,0,0.78)",
            zIndex: "9999999", display: "flex", alignItems: "center", justifyContent: "center",
            overflowY: "auto", padding: "20px"
        });

        const dp = dados.descParsed;

        // Pré-preencher com dados da descrição
        const specDetectada = dp?.spec || "";
        const qtdDetectada  = dp?.qtdTotal || 1;
        const doisMetrosAuto = dp?.doisMetros || false;
        const dataPedido    = dp?.dataPedido || "";
        const numPedido     = dp?.numeroPedido || "";
        const alertas       = dp?.alertas || [];
        const semDescricao  = !dp || (!dp.numeroPedido && !dp.dataPedido && dp.itens.length === 0);

        const designerOptions = designers.length > 0
            ? designers.map(d => `<option value="${d}">${d}</option>`).join("")
            : `<option value="">— cadastre via botão 👤 —</option>`;

        const specEhPadrao = SPECS_BASE.includes(specDetectada);
        const specOptions = SPECS_BASE.map(s =>
            `<option value="${s}" ${specDetectada === s ? "selected" : ""}>${s}</option>`
        ).join("") + `<option value="__outro" ${!specEhPadrao && specDetectada ? "selected" : ""}>Outro (digitar)...</option>`;

        overlay.innerHTML = `
<div style="background:#111;border:1px solid #333;border-radius:14px;padding:28px 32px;
    min-width:360px;max-width:440px;width:90%;color:#fff;font-family:'IBM Plex Mono',monospace;
    box-shadow:0 16px 48px rgba(0,0,0,0.8);margin:auto">

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${semDescricao || alertas.length > 0 ? "12px" : "22px"}">
        <h2 style="font-size:1rem;letter-spacing:2px;color:#f9a825">📄 GERAR CROQUI</h2>
        <button id="fechar-croqui" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer">✕</button>
    </div>

    ${semDescricao ? `
    <div style="background:#2a1a00;border:1px solid #f9a825;border-radius:8px;padding:10px 14px;
        margin-bottom:16px;font-size:12px;color:#f9a825">
        ⚠️ Descrição do card sem especificações detectadas. Preencha os campos manualmente.
    </div>` : ""}

    ${alertas.map(a => `
    <div style="background:#2a0000;border:1px solid #ef5350;border-radius:8px;padding:10px 14px;
        margin-bottom:8px;font-size:12px;color:#ef5350">${a}</div>`).join("")}

    ${dataPedido || numPedido ? `
    <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:8px 14px;
        margin-bottom:12px;font-size:11px;color:#aaa;display:flex;gap:16px;flex-wrap:wrap">
        ${numPedido ? `<span>📦 <strong style="color:#fff">${numPedido}</strong></span>` : ""}
        ${dataPedido ? `<span>🕐 <strong style="color:#fff">${dataPedido}</strong></span>` : ""}
    </div>` : ""}

    <div style="display:flex;flex-direction:column;gap:13px">

        <div>
            <label style="font-size:11px;color:#888;letter-spacing:1px">CLIENTE</label>
            <input id="cq-nome" type="text" value="${dados.nome}"
                style="width:100%;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;margin-top:4px">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
                <label style="font-size:11px;color:#888;letter-spacing:1px">DATA LIBERADO</label>
                <input id="cq-liberado" type="text" value="${hojeFormatado()}" placeholder="DD/MM/AAAA"
                    style="width:100%;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                    padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;margin-top:4px">
            </div>
            <div>
                <label style="font-size:11px;color:#888;letter-spacing:1px">DATA ENTREGA</label>
                <input id="cq-entrega" type="text" value="${dados.dataEntrega}" placeholder="DD/MM/AAAA"
                    style="width:100%;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                    padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;margin-top:4px">
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
                <label style="font-size:11px;color:#888;letter-spacing:1px">DESIGNER</label>
                <select id="cq-designer"
                    style="width:100%;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                    padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;margin-top:4px">
                    ${designerOptions}
                </select>
            </div>
            <div>
                <label style="font-size:11px;color:#888;letter-spacing:1px">QUANTIDADE</label>
                <input id="cq-qtd" type="number" value="${qtdDetectada}" min="1"
                    style="width:100%;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                    padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;margin-top:4px">
            </div>
        </div>

        <div>
            <label style="font-size:11px;color:#888;letter-spacing:1px">ESPECIFICAÇÃO</label>
            <div style="display:flex;gap:8px;margin-top:4px">
                <select id="cq-spec-sel"
                    style="flex:1;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                    padding:9px 12px;color:#fff;font-family:inherit;font-size:13px">
                    ${specOptions}
                </select>
                <input id="cq-spec-custom" type="text" placeholder="descreva..."
                    value="${!specEhPadrao && specDetectada ? specDetectada : ""}"
                    style="flex:1;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                    padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;
                    display:${!specEhPadrao && specDetectada ? "block" : "none"}">
            </div>
        </div>

        <div>
            <label style="font-size:11px;color:#888;letter-spacing:1px">PLATAFORMA</label>
            <select id="cq-plat"
                style="width:100%;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;margin-top:4px">
                <option value="ml"     ${dados.plataforma === "ml"     ? "selected" : ""}>Mercado Livre</option>
                <option value="shopee" ${dados.plataforma === "shopee" ? "selected" : ""}>Shopee</option>
                <option value="trafego" ${dados.plataforma === "trafego" ? "selected" : ""}>Tráfego</option>
            </select>
        </div>

        <div style="background:#1e1e1e;border:1px solid #444;border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:center;gap:10px">
                <input type="checkbox" id="cq-sedex" style="width:16px;height:16px;cursor:pointer;accent-color:#ef5350">
                <label for="cq-sedex" style="font-size:13px;color:#ddd;cursor:pointer;user-select:none;letter-spacing:1px">
                    SEDEX (reenvio por problema)
                </label>
            </div>
            <input id="cq-sedex-motivo" type="text" placeholder="Descreva o motivo do sedex..."
                style="width:100%;background:#111;border:1px solid #555;border-radius:6px;
                padding:8px 12px;color:#fff;font-family:inherit;font-size:13px;display:none">
        </div>

        <div style="display:flex;align-items:center;gap:10px;background:#1e1e1e;
            border:1px solid #444;border-radius:8px;padding:10px 14px">
            <input type="checkbox" id="cq-2m" ${doisMetrosAuto ? "checked" : ""} style="width:16px;height:16px;cursor:pointer;accent-color:#f9a825">
            <label for="cq-2m" style="font-size:13px;color:#ddd;cursor:pointer;user-select:none">
                Banner 2 Metros ${doisMetrosAuto ? '<span style="color:#00ff01;font-size:10px">(detectado)</span>' : ""}
            </label>
        </div>

        <div id="cq-balcao-wrap" style="display:${dados.plataforma === 'trafego' ? 'flex' : 'none'};align-items:center;gap:10px;background:#1e1e1e;
            border:1px solid #4fc3f7;border-radius:8px;padding:10px 14px">
            <input type="checkbox" id="cq-balcao" style="width:16px;height:16px;cursor:pointer;accent-color:#4fc3f7">
            <label for="cq-balcao" style="font-size:13px;color:#ddd;cursor:pointer;user-select:none">Balcão</label>
        </div>

        <div>
            <label style="font-size:11px;color:#888;letter-spacing:1px">IMAGENS DO BANNER (opcional — múltiplas)</label>
            <div id="cq-drop-area"
                style="margin-top:4px;border:2px dashed #444;border-radius:8px;padding:14px;
                text-align:center;cursor:pointer;transition:border-color 0.2s;min-height:80px;
                display:flex;flex-direction:column;align-items:center;gap:8px">
                <div id="cq-drop-label" style="color:#666;font-size:12px;pointer-events:none">
                    Arraste os JPGs aqui ou clique para selecionar
                </div>
                <div id="cq-thumbs" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center"></div>
            </div>
            <input id="cq-file-input" type="file" accept="image/*" multiple style="display:none">
        </div>

        <button id="btn-gerar-croqui"
            style="background:#f9a825;color:#000;border:none;border-radius:8px;
            padding:12px;font-weight:bold;font-size:14px;cursor:pointer;
            font-family:inherit;margin-top:4px;letter-spacing:1px">
            GERAR FOLHA →
        </button>
    </div>
</div>`;

        document.body.appendChild(overlay);

        document.getElementById("cq-spec-sel").onchange = function () {
            const c = document.getElementById("cq-spec-custom");
            c.style.display = this.value === "__outro" ? "block" : "none";
            if (this.value === "__outro") c.focus();
        };

        document.getElementById("cq-sedex").onchange = function () {
            const m = document.getElementById("cq-sedex-motivo");
            m.style.display = this.checked ? "block" : "none";
            if (this.checked) m.focus();
        };

        // Drag/drop múltiplas imagens
        const dropArea  = document.getElementById("cq-drop-area");
        const fileInput = document.getElementById("cq-file-input");
        const dropLabel = document.getElementById("cq-drop-label");
        const thumbsEl  = document.getElementById("cq-thumbs");
        let _imagens = [];

        function lerArquivos(files) {
            Array.from(files).forEach(file => {
                if (!file.type.startsWith("image/")) return;
                const reader = new FileReader();
                reader.onload = e => { _imagens.push(e.target.result); renderThumbs(); };
                reader.readAsDataURL(file);
            });
        }

        function renderThumbs() {
            dropLabel.style.display = _imagens.length === 0 ? "block" : "none";
            thumbsEl.innerHTML = _imagens.map((src, i) => `
<div style="position:relative;display:inline-block">
    <img src="${src}" style="height:64px;width:64px;object-fit:cover;border-radius:4px;border:1px solid #555">
    <button data-i="${i}" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;
        background:#b71c1c;color:#fff;border:none;border-radius:50%;font-size:10px;cursor:pointer;
        display:flex;align-items:center;justify-content:center">✕</button>
</div>`).join("");
            thumbsEl.querySelectorAll("button[data-i]").forEach(btn => {
                btn.onclick = e => { e.stopPropagation(); _imagens.splice(parseInt(btn.dataset.i), 1); renderThumbs(); };
            });
        }

        dropArea.onclick     = e => { if (!e.target.closest("button")) fileInput.click(); };
        fileInput.onchange   = e => lerArquivos(e.target.files);
        dropArea.ondragover  = e => { e.preventDefault(); dropArea.style.borderColor = "#f9a825"; };
        dropArea.ondragleave = ()  => dropArea.style.borderColor = "#444";
        dropArea.ondrop      = e  => { e.preventDefault(); dropArea.style.borderColor = "#444"; lerArquivos(e.dataTransfer.files); };

        // Mostrar checkbox balcão só quando tráfego selecionado
        document.getElementById("cq-plat").onchange = function() {
            const wrap = document.getElementById("cq-balcao-wrap");
            if (wrap) wrap.style.display = this.value === "trafego" ? "flex" : "none";
            if (this.value !== "trafego") {
                const cb = document.getElementById("cq-balcao");
                if (cb) cb.checked = false;
            }
        };

        document.getElementById("fechar-croqui").onclick = () => overlay.remove();
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

        document.getElementById("btn-gerar-croqui").onclick = () => {
            const specSel    = document.getElementById("cq-spec-sel").value;
            const specCustom = document.getElementById("cq-spec-custom").value.trim();
            const spec       = specSel === "__outro" ? specCustom : specSel;
            const d = {
                nome:      document.getElementById("cq-nome").value.trim(),
                liberado:  document.getElementById("cq-liberado").value.trim(),
                entrega:   document.getElementById("cq-entrega").value.trim(),
                designer:  document.getElementById("cq-designer").value,
                qtd:       document.getElementById("cq-qtd").value,
                spec,
                plataforma: document.getElementById("cq-plat").value,
                doisMetros: document.getElementById("cq-2m").checked,
                balcao:     document.getElementById("cq-balcao")?.checked || false,
                sedex:      document.getElementById("cq-sedex").checked,
                sedexMotivo: document.getElementById("cq-sedex-motivo").value.trim(),
                imagens:   _imagens,
                numeroPedido: numPedido,
                dataPedido:   dataPedido
            };
            if (!d.nome)     return alert("❌ Informe o nome do cliente.");
            if (!d.designer) return alert("❌ Selecione um designer.");
            if (!d.spec)     return alert("❌ Informe a especificação.");
            overlay.remove();
            gerarCroqui(d);
        };
    }

    // =========================
    // GERAR FOLHA
    // =========================

    function gerarCroqui(d) {
        const isML      = d.plataforma === "ml";
        const isShopee  = d.plataforma === "shopee";
        const isTrafego = d.plataforma === "trafego";
        const is2m      = d.doisMetros;

        // Cores por combinação plataforma + modelo
        // ML 2,80m     → amarelo (#FFD600) + azul cliente
        // ML 2m        → verde  (#00ff01) + preto cliente
        // Shopee 2,80m → vermelho (#c0392b) + preto cliente
        // Shopee 2m    → roxo  (#ff00fe) + preto cliente
        // Tráfego      → azul claro (#4fc3f7) + preto cliente

        let corCab, corCabTxt, corCliente, corData, corDataTxt;

        if (isTrafego) {
            // Tráfego — azul claro e preto (2m ou 2,80m, mesma cor)
            corCab     = "#4fc3f7";  corCabTxt  = "#1a1a1a";
            corCliente = "#1a1a1a";
            corData    = "#4fc3f7";  corDataTxt = "#1a1a1a";
        } else if (isML && !is2m) {
            // ML 2,80m — amarelo e preto
            corCab     = "#FFD600";  corCabTxt  = "#1a1a1a";
            corCliente = "#1565c0";
            corData    = "#FFD600";  corDataTxt = "#1a1a1a";
        } else if (isML && is2m) {
            // ML 2m — verde e preto
            corCab     = "#00ff01";  corCabTxt  = "#1a1a1a";
            corCliente = "#1a1a1a";
            corData    = "#00ff01";  corDataTxt = "#1a1a1a";
        } else if (!isML && !is2m) {
            // Shopee 2,80m — vermelho e branco
            corCab     = "#c0392b";  corCabTxt  = "#fff";
            corCliente = "#1a1a1a";
            corData    = "#c0392b";  corDataTxt = "#fff";
        } else {
            // Shopee 2m — roxo claro e preto
            corCab     = "#ff00fe";  corCabTxt  = "#1a1a1a";
            corCliente = "#1a1a1a";
            corData    = "#ff00fe";  corDataTxt = "#1a1a1a";
        }

        // Tarja 2m
        const corTarja    = "#1a1a1a";
        const corTarjaTxt = isTrafego ? "#4fc3f7" : (isML ? "#00ff01" : "#ff00fe");
        const txtTarja    = "MODELO 2mts";

        // Logos SVG inline — sem dependência externa
        const logoML = `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZAAAABlCAYAAABjl7XSAAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAACfnklEQVR42uxdd3xdZfn/Pu97zrn73tzsNN0t3bRAGWWmyN6IBESGOFERt7iQEPfCgYqKiAtFCU5AkCENSyi0ZbSheydpdnJz5znnfZ/fH+dkNl1AFX7m5XM/IU1yxjue7zO/D+HNO8j71IiamqVYuhS6vr5ej/F7BoCKoqKZM6UsWhAIlARYyEWBQMQwhBVW5M4H03TDCEhJAZCUgDQgSIAgQURgEAgMYgazhssuoBVYuWBtw1EFpQmb2cmnmPQ6xy2khcKaQqEvWyj0ru7vX7sZQBcANfrhmJmWLr1JNjYuA9CoAbD/GR/jY3yMj+HyboToeCM+1Bt9CKCWamrmUePjX3LBu81hrLR04UwjULLAMkNzhDQXGUZ4qpSBainNImmEIA0LRAKABLGA1gSlARcAFIN54EP+5RkM9idKgAgAsQcwRCCpIQgwBIGIAGgAGhoOlCpAOXlopbpcN9emVG6Lq/Lr3by9ynF61nZ1vTAALMNWhFBz0o1GY2MTAw3sX3B8jI/x8T85amVtLdDQcI96I+qVbwYAEaipEXVLl+5mYQSDlVPi8alnmqHEgkAgvsiQ4dmWGSo3rRikCIAh4WoBx2XYjoajlFKKfZGsIKVG0NTCsjRZpoJpMkxDwzI1LINhCoCEBpEHIUoLuBpwXIJtExxXwLUlCo5A3pFsu8xKERMbgJAQgsmSUpimAcMEDOlCQEG5LmynH4VCptdRuTVaZZ7KZ7te6e/b8Wg+37Jj+DvW1dWJ+vplwrdOxsFkfIyP/xmLgz1t1RtmNBpNxBBD3sw7PT09feMAsldLo0YwL1NENAx2E1PLy+cvMqOlJ1pG6NSAEZllhWIhwwiDOICC6yJvMwo2K+VqNg2XgsE8JeNM5UU2lRbnUVnioqrERVFRHkXxPEqjLuJhRiyoYQQcSIthGBpSeJYFyJskxpBVopSE6xJcB3BsgXTeRF9GojttoDcVRE9PELu6DOzqMtDVa6Gtx+TulGQ7H2THNZhMQtCUMmgRmYYAkQPlZJErpLJOIbPBdguP5LNdT3S1v/Qi0Ld1uLuLaKkEGtW4m2t8jI//1+4qBoDS0sVnh2MT3yPNyKEBI1RmGDGRzmzp2Lrpb0cASA3/3f91ACGgVtTW1qKh4ZLBWIFlTZhVUjbzTCuYPC9gRY8JB8tihhmBC4aTN5AtsOu4DGHkKJnIi4mlTIdM6sX0SWlMm6AxsTKDimQWiahGMMgQwoXnm2JAe/POiqC19/G9VmAWQ6vCg94l76vwQhUEQJCAFAwIBUgAJLw/IEBrE4Wchb40oa0ngO1tUWxuFti6I4oN22No7rK4O2VodkJsWoyQZRhWgAHhQNt55HKd/QW792m7kPpzT9f6f+bzu7YNGra1tbKhAQAa9DiYjI/x8f/O8ohNmnz6XYnk7LMNMwmwC2aGkCGkUmvTm9b9fgqA7nEAAai2tlYM9/EFAonpxcWLzwuEEhcHAvEloUiZIUQYBZeQzWll24oDpisqS9I0a1qGDp2VwqEzMpg5IY/y0gwiIQcQAtAa2gWUS1AuoJnBEIA2fMuCAChAMDzooL1ODg83kPyhSQEsAO0BBw0gEBGYFIRQkAZgSoAkAEmAZvTnDbR3xrB5Zwgvbwlj1boibNoS4tbuKBccqYMmKBKSMmACWuWQzXXl8tnelZlMb0Nn+7P3ALnmgaesqTnJaGwcd3GNj/HxZh+eYtigJk09508lpYsu0uw6WrPwHCEOhAxRun9Lz6Z1f5gJoOd/GEDqRG1tEzU0NAxYG4HS6qNPjQemXGIE4hdFwiVRMkxkbYF8xlGuYiTjBTF3ZjcdPT+HI+elcMjUFCrjNoTlAorhOoDrSGjN0CxAJDBoR4iBl2Uw8YCR4P+/ALHw/n8MuNjb5BH7Di4a+hse9jMPTzzX1zBsgRAMw3IhTQ1ICW1baO+TWLctguVNpXh+dRBrNyW5KxXWpsEcCltGMKAAO49strs3X+h6OJdp+Vl7+3NPALCHbb7xwPv4GB9vTviQQINKFB92avWk4x+WRrEDnTMJ0pMvrNkDkPU9m9b9Ycb/KICMBo7iiRMmL3x3IFR1VTRUNsMMFMF2FPqzrqtcRZVFBbHo0D5aelQ3lsztw8RKG8FgHigouHYAtvIlMxGIgBEhkzfwGAAWzQCYIQSDTCBouoCUyNsWdrZaWN5UhH89n8Sq1Qnu7I5qYUiOxWCYJlDIp5DPdjTlsq13tex84c6BeMk4kIyP8fHmGzU1NUZjY6NbMen0H1eUH/lBZlfBK0PwhcYAgGz4nwQQUVtbOwgcwej048tK5l4dCZdfEoqUxLUMI5t2dTbLXBzvF0cuyNCpJ3Tj+IWdmFiRhSQF5CXyDkNpCUCAhPIC3f9PBrNnOTE0BGmETAEKOlA6gB27wnj6pTgefqoYzzcluTsV0+GwFrGIQaTySPe35dLZzjt7u164NZtteWEcSMbH+HizAUid0dhY706bedFt8aIF79M6777RAcT4T4CUF+NoUA0NDYjHZx+ZLJn1qWC47NJotBKOInSkTCW5h2ZPz4ozT+rEWcd0YfakDEg6UHmC3S+gIcEkYUJDSg0mF8Ty/9cOIgFBCoIFCAayDoNtAwYrTEqm8I4z+nDJae1Yvy1CD/47KR98ohLrtkQ0y5Aujk0MJeIT3xeNV1xdyHX8pnfXuh81NDQMB5LxYPv4GB9vhiGYCRrMQ4k7b9RxkAGkxgAa3YaGBhWNTp5XXHbYDeFIyaXhaJVwCya3ddoqHMzI04/ukG89rQ8nHt6FRCQNzgWQzbmANiAEgQTDgwrtS0D6/wcegB/IF2Dy0oalDyoAYLsEnQJI2JgzMYd5l/fhPRe0oPGFhPjLQ5XiyVWl3OEEdWm02oxHqt4TDJdfEU3Pvqejq6m+oaFhg6eoXCyBBvX//fgBtWMcu1dlib2e13oV3oFaMfaP/uPKgD8Ho5/nVT3H3t5rgIWB/7N746Df3y8IGH3vPcyfFgf3bNS0U82oHzQCQGO5/yz7LyMOEr7VCeBL2pubcNWkKTWfiEQqrwvHqgO2A/T2KhVNpOT5x3bibWd1YfGcHki2kc9LKMfw4gFC481XKP8fcXSBlQlmBWk6CIQIWpt4dm0xGh4ow4NPF3NfJqGKk8qwJJBON/dn06237tz28LcAdIN5eMn8/xvQqKmpEY2Nj7t7P/uDGWt7q6M50Gu9jtlvdaKmZplYtmx0/dMYu4CZli5dKhsbl2qg/mAIPYGaGlFbXs6vvQrae6/Gxx8fiz1it3mtq7tR1C9bJvC6zK1/732u56j7e8W7r7HeqlZ6ZQmX7nH+vELhJgIa1IALa/qsi26Lx+e9z1W2SzRcyWcWIkj9qQ09m9fvtwtL1NTUiGWNyxRhfwPEA3t7qQbq9X8SQAg1NRKNjS4AWV514nXRePUN8cSUEsUm+rqh4pFueU5NH646txXzZnYDjots1gJDQgjlp9dqeEUV/1mPC7GXejs0LcIX2drjw+LBkkIvBdjPvCIIELx0Xib2V/TggB/7GV8EgLSAYi+rLBpyAUPgpQ1F+O29E/HAsnJOFYK6qATS0Aqp1K6dqfTmz3c0P/nb4dbhmx05BtIeB74PBCqmxosnzw6EyyFhEUFzJtuH3tTGFiez8+Xhh3t3TWvkvwUSFVOLY9NnBwLlYAhSyuZMIYVM+pXNdn/nhlHP8FqsAsFelejwvy+OFR9ySDBQVGTICKAMuMggl+vNpXtfWQ2vBsDbt0Rgft2syxGxyiE5Ea6IFVdPCcqiIgSjLFmInHSf6dvW2LtnIVYnmG8a/V6BWPEhh3nvFQS7FimyuZDvQz7TudW2W7YCKIyc2wPTivf8HqEJ8eIZ8wPhShEIRAB2wxYCBVtnVKGQQja1qzWT2bJu9/sfsMUp6urqMIw5w7JiE6ZFoqVTgzIBwEUu35vr7Ry+jkzz5l1iNjU12DMOedutscTcD75GABkMHWDwISrnJkoOmWyYgcmGNEuVa08TMEDC2GIrW4GdNan+je251M7n9vf9X08pJwDSACORmLM4WbrgB9GiiccbMor+XnZBeXnm0hZ639tasWhmCsjbSOctCBIQ4o2iDDNcEISmwWJDAkFIBSEYYuAVSYK1V4DoMnn1JQRIZjAZYKkgoEEsDvrzDljHWntEj5EggUOMF9YmcXtDNR54sppZQidjllR2Br3pzQ92dT3/6UzPztX+3hNvUmtkcL8hmJxcXXLYR0KhylMMMzRLmvGwkKbvP2Yo5cK1U9p106szmd77drU8catXR1MnhjSsgf8vnlhRtfhj0UjJKaYZniWtRFiIgEdnwy6UtqGcfkc52Vdy2f6HOjqeu822Oze8+rkcAvJw0fxFJYnqc02j+FxphWZKaZYaIuK/qgNmF66yobXdqdz8Biefe6ovu/6Pqa51KwFo1NZKvHogI9TWCgwInED59Allc840jeIzTSs6S0hjghTBmKQAIBlEBjrbVn6ltXXZFweyh/YExpGiBQtLk5XnCRG/OBAoKWLCVEMGQPDqsZhdaLah3LzWytmunPwruVzPUz09TXcVCu2b9wz4e9b8B++dnH5ocXTuVZYVPkVawZnSiMaktCDIBMiAgIZmB0o5cN0MtM5vdezcy/ls+vFdfU/9AbnczgO7/9DvlZQsOjkam/wOIxA9WYrQVNMMS0IQgIbSWbgq3+nYfS+k+prv6u5cfoenCLCYPPXCPxWXHnqhqwqvEkCGeYCCwSlVJTXXRSLJ44QMLjasIksaFsiresZwflfvnPSAdf7FfDb1bG+m6eeprs3P7+39XycAGTwExoSJp302lph2QzRSGUgXXDfTr+Uxi9rpuit2omZhN9h1kMsSBFnQhg3B9F93VTEA1gTSgGEomEEXkAIggnIFCraBjCPh2AIuM4gASwIhSyFmaVDABVgDSkMXCAVXQjFBCI98kf5DlhSDPEJIuAiFJUgIPPZiEt+7cypWro5xIhLRwTDLdGpXvj+1rq5155Pf9l6/9k0WGxkU/MbEiad/KRqr+oAVmpAUwvSEEZTyFnWQOgAQJAVpQCtk07t6Uv2bvtjW8tSPUVcnUA8A9bpywkkfisen3RiITKggQWANaLiKGF7MjbQnzIWQggisXeSzbflMevuPm3c8eiOArG+26v0S2D7XUSQ5+9DSxJyvByPlZwdCRQSyfDYElz3mNgaYQBAACQIJQcQAK9j5PuRyrSv6U+s/392x5qFXCWSDYFxUNGthIjnnC1aw7LxAqCgkZdDzerIGQzOx0IB0mRyjo+XpW1pbH//EKAAhoI6Aeh2PzzqqpHTel6xQxRlmMElCCu9aGszMmqE8kGfhrRFBetKAoLULO9+eK+Tb/7Srfd3P8+kNj/vrvg93nbeXY7EJs0vLjvlyIFRxYSCUMAHpbQnWmjy+VABDHgciAYaUggAiDa0KKOT6ugv5tj+1djz9XTvdtXbf52To3iXlh98cDk8+xwyUevfwSFoV2PMiEIFAQoAE2M4ind7yaEv78g/Z/S3rp8w8/w9FyUMv1a7j4oABZPBsxCdPvuCzwUjZB0Lh4iRREJpdaLAi1jzkShw4IwQGkSAhBRlguCjkepxCtv33zZ2Pfd3u71o31vu/Vsk9aCZFo1PmlFQefXs8Me14UBBdfTlVWZSTH758B95+ZgtCwkYm7RX3kWAwaQgtgf9C3Qb5HGUaAqwYhmRYYQ0IQm+/gQ074li3OYy12yJobo8j1S+QykjkCwZc36oIGhrRcB7FcRvlZQpzJ/djxtQsZk3MoDKZB1kaKCgUCgSlPVp4SD0o1A4eZPrlklqBmRCOKeSdEH73YDl+dNdUdHWHVUmxIVnl0de9/onW1sevKhT6tr6JMrU84RicMWnapCPvisUnHw8Eodh2iV1BEISB5O7BvcWePPbyWrQhAoars+jrafrtzi0PXgUAk6ad8/uiotmXSRmEUo6rSQtAkmA/D4b0kMyHYoCYSWpBhkHM6O1du2bbzmfeBrtlne9/VXtfJK+CtXLiW24oSkz9fCA8IcDaAWvtetVMLHxZ6jMmwFNSABDkALAwkSGFkGTb3Uj1brxt5/Z/fhiAg/1P7xwAm3D1xNNvjicmv9cKVRjMDNbsAooAPTCnnk1H7BKR0dnyzPdGAQgRETMzJk49/cZYZNqNgVClVMh578VeOS95KDx0GHkQE/yqKGIiYkGmIQjIZtvRk9ryjfadj3wOgw7csd7NE3DFxUe/p6R87vej0UlRpRkatqvBwktPISKIoT8fuBxrv2kDNANMJFmQYRBpZDO70j2d6z7X0fHUj/YMIp4SnSw97LLi0kNvC8emRVnbGlpp7329KrWBW/qvywBpIslCCiOd2ta+c+u/j5s89cj3RWOzP+PorEugAwCQAQCbs6Ss6tA7Y/FDZoAlFOdcMAQNPoOvL4yeQh48LRpEWiBgCAFk+nekO9ubPt7T89zto13f9NoOMjNAXFqx+D3J5KHfj0YnRW3tunY+Ld9yTA998j1bcEhlFoV+hmIBKcmPJvCwvfuflVdMGoIF2AFgOQhGCZm0haeaSvDI08VYsSaJXR0J5GwNlwVYA8TK6/9Bri8XCAQDRCYYJiAYQipYpouSmMLsyV04alEGxx/ehbmTsggEC3BzAoWCAIghxYDWpTCcFuX1saUwuKcIBKUIJF2EYhKbWoP45u3T8WBjFUejlg4GIdN92/u6O1+6tqvrxd95Ab16vIFdWgIgHQxWTZowteaxWHzmDKVsB6wNGrGXaS/eWgazZiJTCUFGd9vK38KUKC0+7EqXtcPaNYgGkid5n0eEwQw2XMMwzUzf+k2tLfctSWcyneA9WgFUV1dH9fX11uRpZ/46kTz0EiKDtWJNpOXusnFP7zLwOxrMpIUwmYhlX+/LT2/duOwCcH/XfiRLCAA6GKyaXDlxyZ8SiTlHMsBaK02kB4TeqL0FMMglSKOj+anbd7U9/j4fQBTq6gj1309Mnlbzs6LiebVEgpVyNXnm227X2bsI4oFcASWkJTTnRU/Xqj80b330KtTW6t1ddZ7wLCk/9ILS8mP+GgxVQLm2Sx419h7mDvuaW2YWSkrTsO1udO169or29pW/2x1EvO9LKw6/tLh88R+CgQpo13VJaGPkNWkPLmiGZriGGTL6OtfsyBZ6U1VVS+ZrbevBNEz/eYQI7QFA/PcvWXBkcdnhT4RjU4Ja2S5DSxqslttXS5HRa6TBTK4hA4Zd6EZ398p37mp+5jeoqTH8OPerBZBBH5uYMOWUrxcnDr3eCMahdFblspDveVsrPvvBVwA3h0JPEFp5CbgkpLeU/61qcSKw0gAzQgmF3lQYf/1XJe5+pAIbtyahXQNKOICbAbOGETARCRsoTsaQiIURCFiQhgCzgmMzUqksunp60Z8poFDQgJYg0wRREFIDgXABc6b14vRj23H6sd2YVpUFuw4KGdPT6QT9R7x3GgS4jFBAwTXD+OPDSdxy5zT0ZWMqGDClKnSip/OVH7a0LPuYJ3CGxwbeMGPANWJOm37JM4ni2Ye5quAQyHx1+4lBMJSGkoALwQHNpMSrBW4GuYaIGL09zz+xddO9ZwK1hTHSNKmmpkY2NjaqSVPPuSdZevhFYNdmVubYGf/MzCNPOXk2CY21yiBhWwhbPX2rHtm88W9nehlAe7QqBYh0OBSqqqw847lYybxq5SqXyDX2pdQw4BKE0dn81G2tbU9cs3jxYnP69Om6oaFBT558+kPJsmNOVWQ7pLWx50oG/92GRJvY82HQIIRtgZzVvuuZH7a0PPGRUUJcAOBwuKyiatKpL8Vih5S4KsdEJMe+L2miUVyprIWnOOz+vMxaGTJEmfTmVOvOfx2STrd2Df2pd1aiRXNPqphw1COhyDQBN00CYtB43RM4DvMfDfwrC01UcFKwAtExxPOeAKSOgJs4EJgybdLkmmejiemljsooQULuGZjBvhni52H4Fu9Ya8CuFhTVjt1Obe1PXdTV/vLfB+b/VRRT1ErgVg2gfNLUC+8tLVt4uRBh1dvbQxYJEYqY2LgjjMZnEkinwyhNKpQUF2CFXAgGXOU1cPKek/ZSKHPgktXjsiLPSPasVX+HehlUSjEsCzDCBu5ZVonrb16Av/xrAlL9MTi6D4wMJlTEcPyJ81D7tuNwzXtOx7vfdQqufudSXHFFDS6pPRYXX3QMLr7oWFxcuwRvvfAonHfOMTjj1MVYNH8yysrDcFQBuXQKhXwOSgNtXcV4YkUl7n2iCFt2hlFaCkyoLiAQcKEdgqNouGQYDIrvrg3QfswSDYkz/3tmzwPBpOGCEDT7sfDoHCaWSzT+OyJcl9gKRnQkXLnENIpqUqkNDwCNaW+dm94w7qza2lrZ1HSrnjTp1K8Xlc59m6uFI6F88KBRwpwHDsfAhwlajJxXAqAFQSpig0G23F1wMpihQaSGbH72TxmNmHcCC4ZygoGKaZC6L5P655M1NTXGtm3b9PCzs23bP1TlhJO/V1J22LvAwgZry9uwepg1ysyQWgpDSGmSEAYJIYmEJEAQg11gNAkDAdBSMZxAuPgQaUTjz/777w+gtlaiqYnHBuNlgQmTz3wkUTJ/tuu6riA2dt9no/ciA4AmkMj273w+ndl2XyRysfnkk790qqpPri8pP/xdzOwQswkaSxgzg6QSwpBCmCTIIEEGAcTMrD1BNjIuSgA0a6EpoCwzcLShCw+kc8uaB/ZobW2taGpq0uXlx38vUbLgRFcXlByI0I8UnVoKU0hhCG/+SBAJIaUphDD9m/JupoIgEi6zMq2isFaZTH9qW6O/tlxXt5QaGxutyolLH03EZ5XAKTAJLZnkbndnQBOEIpIgIQVBakBohmbyKF2JibVpRHgogDdK6SGT7EJ3vqdr9S0A8l4YoVw0NV2iJ08++Z5Ycs58W+dcQdKg3S0LBkslpCmllCSEFAMfIknMUAxNnsVCwxQtizTykFZCSmGdls82/979wrn9aGw80DpHz/8VClVPrJhwwv3FJTMX5grKKRQy5nHHzcHadTvQsqMbphkGGSEwMcoSWRw+O40Tj2rHkgV9mFGVhzDzgA0UbAnXV/pIEEACBHewoO7A3DaDUwQe4JgiBQnhFSOCYUVc7Ggvwldum4gHn5yOYETByWcgpcAJxx2Ci847BscdNxclpZH9uNfYU5fPOVi/vgVPPr0WjzU2YfXq7cjm8wgEimBrC+FAP44/vBMXndyJ4xf1IJ7IAQVCoUBwle/akuylMpPwjxKPMoFpRDyHIf3KfAZYej1LmEGCYJoFWJYBGIzevgCefbkK9z1h4fmmSjh2BAVHI92fRSQed0xDmD0dTS+1bX3s3Dx6drxxguvecySTM+ZXVNW8ZIUrmbUjRmuL5LEtKyENSQQwKxAEGBKaXYZ2QSDa/WgOdzEM4ARpIgNCSuEFHLTP1C/ArlKeuTncBUnwAmoWZ/u29W5q/us8ZDJto10M8eLFp02oPuKfllmhmAtyuJDVA35uMgnQyOXa8q6d3q7sAoE0pBVmy4hPC4VLTAXB0DaIRpuxGkSW69g9RmvLU+f3dr10755cLpVVS79VPuGYT2sIh1iZY86JZyYoJmIBAcGCWGiXAdnV+sx3W1oe+wzAFC85/MiqyqOXB4LlijkvwHKw7IB8M0oTsUEmKVaw821gpTdp1loYhmWI4BQrWAKltWbKC9IWiPTos+0ahml0d774t+1b7rtweNwuHC6rrJp01sZIbEJYaxc0DF8JDA3JgkD5dIvrOtkHXW0/77quMoQBaZqlRNbSYKh4kWEVgbXNo/cJMykpLNHT+8ry7ZvuWTJUh9PoVlWf+NnSiiVfZ5auIGWMTuH3EhCEhhEQpAtw7X64ynaEkKZhxiBlGIptDVbCO+tyTFcbQ7MUIUqnNvRs8i2QgfhTedWSz1dUHvdVFgEH7Jo0OjzAYBKSwEAutytl211bWNNmQENII2kYyTnBUEklSxOkFAsaTi3rnQvNcA1hGF3tz9+/c8fD59bW1krjQMEjGp0yt2pCzd9jyekzM+mMqx3bvOnGS3Dl5Sdg+45ePPTwCvzzoRexevUOpAt5dPSG8fCzlXj42TKUxhTmzOrAMQt7cMyCfsydlEY0bnuqga3hOAylLGgivxOg3GcGE7OfUssMIoY0NcyAhjA8vLddIJ+TAEs0Pl+KL/5gBtq6SxAN55BNZ7H05AW45v1nYMlRM4eWyQ9AD5zt0V+HG6FeeNa/PxjBkMDCRVOwcNEUfOCDp+PFF7bivvufxz8eXIHmlnY4IoRHn5mMh5dPwLxJPTjhqB6ceFQnFk3NIB73Yyy2C9c14Sj2W5aIkW6/YTubiUHsQJAGhIBhOjBM8iNUhF2pGJpeiuCJVUk89WIZtu4IweEwDOSRzqdQErdw6qkL8eyz68z+LLullfMXShl6vLXlgRNyuYbmNwKIeC09gWj8kI8FwxXCVcql3bRbhiZTQyuZTW3tcJ3sU46T0UJIGIFYZSBQdpwVSMLlPIvdGNQG5lYBbHjTKg3h2N0o9LevdJzcFqVssoyoMMzQUYFoVbVEQDNrMSQrGCAirbSKRKuLy2NHvqM90/g932Xl1tXN4/p6yOKiqm8GAxXkui6RGK2FaDYQoEK2NZfONH+9o23V7wqF9m3DJUEkMnF+Mjn3g9HElA+awTKwdnnQePW9OcwuBQKlnCyaUtfb9dI/UDePvUyzAXdPg7Ji1YfEE1M+RjAUccEY2/oiZkEQUkhoQLsFaO0AmqUUQTC5uQERWRx/a30oVA6lC+wp9zxiuyoW2hCmyGV2pHLpHd/s7t5yXyazpcnHTStZNn9xJDz9M8mimeeRHHAnjhLExFJr5mC49PRodMqchoaGtfPm1VpNTQ12ND7l1GAoGWHNijDSdaNBmgSJ/t61a9pbn3t7JrNz9Vj7rKR80YUlZYt/FQpMiGnOweu9MKD5KwEOUMAMTweQIKI+gBUQK4uEqz8jhMVKFySPofgySQ2GyPVtWZfLtfwmm25ekdW5DQbMyYlIxVQrMPWKcKz8FMMMgzUzSPkW6b70e0Jj4zIViUTL47GpnxYixErbhnc0hsesFBsUokKu0+1Pb/x2V8dTt+YG05MHR1FVdc3V0ciMb4filYbSeRYwRsQCBbGhIVSsaNo5xZmZSxoaGp6hA9EA4/FpR5dWHX9/smh6aW+qV0UCpvzed9+Ft5w8H1oxhD/fSgMvvrQZDz/0ChqfegEbN7XCyTOkGQA4AM0CoZDC5OpeHDErjSMX9OHQmb2YWO4gGLS9VFRbwHbZa/TEQy6v4eoIESCFhmlqCMvrc97RK7FlewJrNgexqTmArS0JdPQasAsGOjpCgGEin0uhtCyJT1//Vrzt/CP8BBcXmuGn3tKrc6P5mtZAX3Uh4edbA20dKfz5T8/hT39/Cps2dsDSAmxG4GqJQMDG5Il9WDyrDwvnpDBnWhoTSxQSsSxMy/HzFWjAvPKVk2FEOUKAtYl8TqAjZWLbriiaNgfw0isJNG0qQktHFAUlIGUBcDSgC5g4KYlTTj0cb73gGBy6oBqPPvoiPvqpX6FgC1WUiMmens2bW7c/fnE2u23Vf7nocOA0hKfNunxLND69nFWeRwIIg0hqp9AlenvWfbm1+fFbAHQOv0hx+aGnFiXm/iYan1Wl2fYzY8aII2ipyYDIpLet7WzfcGNf94o/jQpExyuqT/pUSfHcLwqrRIFdSSOdJIpMKfq6m57etukvJwyvNE6UHHpKVfVJj1hGQjMcgeGWNoNJBLiQ2+a0tS8/o7dzbeOge4yGrOsBwRBPLrqkouKI34YilYbWLo2eDyaptJOT7S3Lzu3sfPH+gTUcKLysrj7l5yWVx7xXa+UHmrG7u4dM4do9yGbbn7Hd9CO5XGcXs72WnUCJKTFJJAp3tG1+qT2WnHPshOqTngpYpey9F+3mthLCRKZ/c6p153OnZLObVux+vrz3qp508k3JkqPqSAgN7A4iDOkSlNHZ9szHWpsf/8GUKe8Mbtv26/ykKef8KFly2Ac0KxdQxtDOYQhhcT63I7dlw0PHOU7b6sWL329Go+uGaWRLAQCNjfVu9ZQz6ktLFt+o4bgYyIBiAkixQIgK+dae1qbbp/eBegFGWcWx7yqfcOwdRJYi1nJ3kUEK0LK3q+lPO7bd/254XQR3G6XlSz5eUnHotwNWGVi7ArT7Fh1tgRCJHmaNyoknf7Gi/JgvaYYL0sZooUQU1IVCu+pof+7t3e0r/zKgDF988cUSAObNm8f19V7dSDR6yIlVE4/7UygyqYS5gJFBfIDBrhAho7dz5V+2b73vIuNAwKOi8vh/xpOHFHX3tKvyopj82c+uwaJFU+G6GtIgj01WK0gpccRh03HEYdPx0cLpWLlqK5Y1rsHTT63Fps3tyBRyyOYtrN9UhKZNpfjjAxrFiX5Mry7g0FkpLJrThdlTHFSV5xCNFPxOTMpPsGNAsDe3ykI6Z2DdjgheaEpieVMETZsSaOuMIZ034Gqvv7kUEmS4CEUE+tr6UHPyfHz9a5ejuioB1h6/FgkDcr/cZAPuJLE7wAxUiJMY/E2tvaB9RVkcH/zAKbjqquOx7F9r8Nf7n8fy5zagty+LXN7Exk1xrNtYirsfkIhE0igrzqKq1EFFaRqVJS5K4xqhsA3L1BDCa5JlFyR6MwZ2dZto6w6grTuA1o4AelJR5AoGiAGiHDT3grRAMh7B4sUzceaZh+OkmgUoKQp7gK8UTjllEX75i2vxgQ/8Uvb09LqJ5LTpDG5obTeX5robd/73Auu1whO+RywJBpJlpAt6aIJ9l5MgrZys6GpfdU17+/O3eTVxf5RAw8A10NBwySP96V1nTTXCT4VDk8Oac76mPDx/kTRJkzL9G9o3rXv4NKB7JzPTJZdcIgeuc889l6bamh+/kZUOllct+TSRoQAlB/32QgkwkWFGj0AwOam+vn6HpyVDFUWnXRawkqx0QY9IZQUDZGit+2VP9ysf6+1c2zhz5pmBjRsfdPyowfDNJxYvfr9cseK2u01TGxWBpb8zRFxr5AgwhxqjaZelVcSh2ITL0fni/bW15dzQgIHK7EQgUvVWLxyvRsV+GAytSURFun9da1/f2vd07nrhgTGXpsvb/4nItCuDgVJS7CgaJXAAhhAGu/le7tj18iXZ7KYVvtUw0Bp0wMMh6+qW6fp6+pIVKHp7PDF3ptKuO1qKErlaUEAZgehRAFBaepzatu3XkDJwvGEGpFIFCchhDiCGFAEUct0POk7b6nnzaq0VK26zRz5jI4B51uLF7ze3N7+8Uek8SBijVBhBLBRrIOomJ05Ez85eAAiFi680ZYhdVYBHLTgYl4aGowwRE6neNct2bLv/7UTCPeKIw80VK6Zrj3erloB2qqlZisbG+u+xoe2q8iU/EhT33Zv7VlgBBIKh0qtImAyVEyOmy0tR1pozsqf75eu721f+xd9XNjPzaLaBmTPPtDZufPCJrq7oByoDiT9JI6Q9Q4iHu4kloBAMTTglFCqZsC8AEaAGFQ6VVpWVH/eXWPEhRb093aqyNCp/ccd1mDtrApTSMAwxONFSGn5hnqeFBwMmjltyCI5bcgjytkbTK9vw9JPr8dS/m7Bu/S6kenvhMqMjFUJHKo5n1pRBGlMRjxVQVZrB7IkZTKnOozjpIhJ0EDAUbNtES3cQW5pDeGVLCM2tCaQyAWgwGA5YpWFCoTRZBK0ZkDmwCqKnrQ/vfl8NbvhcLaQgKOWB3f6sE/Oo2hv25JgQtNeQNgkxGBbVmhEJB3HOuYtxzrmLsWVrB554Yi0an3gJa5pa0NndB9txkE9b6M6EsWG7BdJV3pEUyhdR0lNqGGA2oEgDmkFaA+T6rrQ0iDTCoQAqSxNYuHARjj9hNo5ZMgOTJ5YOGbZKg4ggpYRSCkcdMRN3/PJ9eO/7fmr09vS7yaLpM2DrZZvzLSci96VWL4//P5viW1PTTo2NQCxSOs80IwTWahBAvBoCJSko+zPr/9Xe/vxtixe/31yx4jY1vC0y0ABfaL2YTjffHQlVvwsgFyOCxgwiUyuVll3dW74MdO+cOfPMABEVMFjT0QAM0VR8ORarviqWmFHhKjXcjURgZtOMhJKhKZN68j07mprudgEKBgLhk8kzJUccdGZowyDZ27tjffuu537pvUOPO8amIgBYseI27b/PH8LR6V8sKV40RytDE5HAEN2oBBRZVuQtAOINDQ2pgfTLkvJFJwfDxSVaa0UYrjcxwMRShFDIbWnZtfOp0zOZHWtqa++W7e0/psZGAChnoJ0AoK5uqa6vrxdWOLqUSAJcEBithjG5JISRybXel0qtechfH3v3lW5077vvSBMgJ5PqvDNRxF8WRnAMVc61hLRgGvEaAIFzz21xVqwAXLdzWW/XywUwpZjZHIiGa+2UQIDyduetQJ1oarrPz5xaJmpqPOtj2bKbFAlhr1jRhKpJZyyBDIHZBo2V9kpkKjcQ974vq7TM4sOZhZ/FNPxoKAgEyS50UVf36q8DcJkPN1esWOEAKzBsP6GxsZH8eflx2Cq7rLhk0XFaC0XYK2OsYDDi8XmLAoH4dMXukOY6LGgvRUCmerevbW95+hbf+rT3kJXHGzc+WPBjKn8OxyY9WVI87wQF9p9jYC4ksXa0FYzGk6VzL9gbgPgH5Tvl5ZU1jyRKZk7oS3WpkmRA3nH7RzFnVpUvgMWYPgfy647YSywHmBG0JI5YNA1HLJqGD197BrZu78aqVZux/Nl1ePmlHdja3IZM1oUqAL2OgZ7uEqxeX+rFNgRBkqffaNZQLoFYQFEBYBtC5xAIEqrLSzF//hwcdews3P/35/DS6maYwQhSPV34/BcuxDXvOx3MDKU1pKS95vprv2e6EDRWQskgMDAzhBD7yCAmSEmDQCIImDa1DNOmluGqK09EW3saq5u2Y/XLW7Fm9Q40t3RiV3sfMrkclHKgXMDV/sbUAwWZCiYRpCUhDRPJZAwV5TFMnVKGhQumYd68SZg9qwKJeHjYOykwawghR6ydByIuFs2fil/c9iG86123Gqn+PlVUNnXGJH3aIzu2/u24urq6/vr6+v8wiCwF0AghojMgDLAeXiPHABmsdQ7ZbOsfAaYV0aVj8vY0NbVrACJb6P2d7fa9yzSjQms1uPQMMASMXKYt1dux/PcAaOPGB+2xtkVTU5ME0J8v9D4aBb+DiIY1/iEwQ5kyYhhWaDaApwHSkeScmcKMT9WseEhLH6DLMbXStrALvbcDKKxYcds+Z6WpydMe2U3fodj+FkhoMA+LqhAxu2yYxeWJxMwZfX0bV81sDsmNgBsOVp4gjQhYKR4yGAZSV4Qi5Ri9fZu/msnsWDNz5pmBhoZLCmOl8tfX1+tAYOJ0YcZmKNYgjHEISJDrZpDLtd0O1IkVK5btMai5YsUKBYAcp/k3qb515xgiFmX26hOHXVCTMIRy+zoBmPX19QUAtHP74x/fRzonA8/6fsoVAKA9QGwEUT2A0ITKqmM+liia/l7ycv2NPdfgmAwAxcWTppqBRJGCYhpMGqABpUAZQsp0ruXpVPfah33h7exJR12xYh0DTNn+w7+dSEz/KxlReMl2tGflHkAsMeFYyyoT0NolCIMHExcATaxZK+HkO34PwG1vbzf2UQQDb06YnPxRP3LdmSdAml5yzrAcUWZmkhZbRuW5ewIQqqmpEfX19e6kKWf9prhk9rxcNusGpTRuvfX9mDNnOHjQvkovQF7l3KCwZQakIEydXIypk4vx1guORL6gsHVrG1av2YmXXtyMpqYdaNnVib5UAbmcBrsKBT81V7BXqxsISiQTScyYPg1HHz0dRx01C3Nml6GoKIb6r/wNL7y0EcFQMfp6u/DlL1+Gq95xIrSrQZJ8y2EPwOHX+Q7EdHp681i3fge2bu1Ae3sfTMPEpMnFmD27GofMqPDI7LRn7QkBj3Jir0DiJdpq30oTRKgoj6KifB5OWToPAFAouGhr60NfTxbdvWl0dKSQ6s8jX8h7NSqGhXA4gKJkCOWlCRTFQygui6OkOLZbiNgDDa8Oh4SA2IOzTkoDSrlYuGAyfvLTq/HOq2+TuZzjlpfNncdu4c76+vrzfA3lYFJuj4SPpTfpxsZ6MNxZXiwIwwK0BCIhnUIaijMrAWI01u7huTxm13yhfZNWdo5NEWIoHpbCpIlIKsfeBiDlJWWMXWDS0N7ua0f6edb6HbtnzDCIJCwrYA0Gv4OViwwzKqChMFifQAMtjoXtZtDX25YzI8lDwSEJcveeuMCGJDdvZ9NddlGRDTIsGpEV5qXnacOIyUC4dB76Nq6yrJiXkmHG5wgYUNAjgrUMzSwNI5fZlentXHMfAOG50cYaywQAHY1WHmsaMYtZK8/qGe2+krKQ6y2keja/sB8uUA0APT2bt/f0bD72gApxwMQM3HTTTdTUNJ82b+4RK1d+0GHWwxcmZMWqJ4aCEyJBYc62rMh0NsKTDcNcaBnhBYFQeRywALa9M72HW5lgygMIhIunSzMAwNUYUXPCAElmtlEodP8DALd7e2ZvolsBhK6uyY8nS7p3ReLxSq0HWFt3Q8LBL4YZPlEKC0oVRriavCatUjiFXpXJND8CgBoH6dr3+Rzc31vWmEj0ZgORqjBpxTzg7PW2uiAWBMM83hjbbeBljlROOOlrxSWHnuFo7eRyefPHP74aiw+fCaU0pDzQEpKBQnoaob1r7QXDgwGJObMnYM7sCbj4oqOhNdDVncaO5m60t/cim80hnc4jky4gYBlIFkdRWVWKmTPKUFYSG3GnG2+6G7fd8QjKy8rRn+rC175+OS6vPR5KOd5z77G2CVDahZQGIIEXX9qOu/74JJ56eh3advXA0cqPXXvZYdGIhYULZ+KqK4/H6acs9PgrXAVp8D6C8H56rsBwjWWYNUMIBAxMnlwCTC45YKE7AExEnuUkxP6vlQciCkcvnoNvfuMyXPeRXxiGVe4Ul88713X7vtjY2Pjl/2RQ/aabwPX1gNZOxZ4WTWvAzuyzpokBICxSPQDlGBQac4+CMwDc/cigYCLRvw/NafDAWlY0IaThZdmMEDQMZggpQqiaeNQPgcXYP4YGn22ADQ1hACPcDENSVQoTZqAoAgBlZfM0AEnCnEKDEYIh+CBAg6R0VX5tPt+z3U9F5LFlhKetRiLFIUMGwFA81tKASGjtbsnnd7X61zsAnjCxl0nQNDI1kfy6vVoB1Cvf7WiVlR17cihSfrRpGEuFDM8iGagShiWlCELKAISQ3pszoLWjAEeCxD5m3x1QBpcIsuCBFI+2vIRjZ2Hn0is9zX6fwpt9JogeR2WaAFHJXiRd7g1sDRmc4v8v8UhvChNJ4brZnp6etU3eUjfo/ZXV2WxHynWz7SGSU/WIYiseIKyBaYUSxlhB88bGBres7LDjksl5nyUj4Xbt2mZ88YaLcPbpR0C5BUjDen3Sa3y3zpAA1QMsZ5BSoKw0irLSKIDJe595reG4DiwrgO989wHc8at/obIqid7Obnz9a1fgstrjPPAQ5h6r4L37e+Cxs7UXP7zlXvztb88i70gEIwGwNMGuJ+RBAEkTBQU8vXwdnnzyFZx66mx89vq3Yeb0SmitfeF9IHMxAK40IuNm5FeM6XKj4UWZtHfrav9ARMJ1Fc4/5yhs29qJr3/7r0ZFZbVbVLygrlBIPdrT0/j0fzq9lyD2Clhk7l85ulJKAntyb9MoP/K+YmNa7lW+i+Hf6nmEABiFMbwrGgIWIqEJnuFAw4wI2v3rwM9AgCJXMLuANv1kEz3s2hpEJrRSswDg8ce/7AJISkI1ewkIIwPULCCgYNsZG9gfIhdAgGcJMqG0O+psaTAkgxmOyvcDsA+gwR7vRwrrHrmwgHDlpCmnXRsKF11imvFZhhkHkQFNHiUReamSirVipfVAorGAV7m9H6/tic2gGQ8J4cUPd58XQY6b5my2vW1/99OyZcsEAHbs/GZm9RbPAua9WWuGEFbUT9fZPf+LNGw376WnHkguKWsioqzSqgPQU4dSPwf2lQJDwJTR3dL3BGoBNMRKEkWH/D4Uq8Cu9u3iwvOPpA+87wwo5UJICweDf2N3AUojaiz2BEAgL/PLsgK4/Y5H8YMf3o+yiiJ0t6dxQ90luOzS46AcDWkYQ4R4o3JO2E9BJjLwl78+h69+qwFt7QUkk3E4/WnYuRzmzJmAubOqUVaagKscbN3WhRde3IbOdAaxeAD/emwDnlt+C66//nxc/vYlviXg+to/var5GErhHObzB40VV33dh5QCWmlc+6Gz8PJLm+nBh9dSWXm1TDizf97Ts+aw2lrohob/XD9mHqsyd/Co8wHM6+vIo7Ovaw3T9wxhWmNzIgmAXC+pgcUw5WFYtvZYX30RStrjZfN42jDMVz28kpiLRj62wB4S1Qe4sV/x3YdyUN3eQ2yKySpiEhir8G3oCVS3Z03edPD2i0dlr8rLl7w1kTzkp+FYdTkgwVpprQsaKAyoV6RIE8gzD8nTCJlgKBAJIhJa87Di3bECKt66M4niPfkyvEJG1ZfNbvfrLfat/TcObnW9dh9hRvLXJaQ1JmCQenoE55fnhCcacMnS/u79gXViqJ49yhhmEAXIGLkGXgOWiZNP+3K8aOaUVKrPnT6pxKi/8bIhH/pBbdJLIwFlkDFiz5wySrkwDAt/vOff+PJX70FxeRE6O7pw/adq8b6rl0IpF9IcUAd3v45yNQxDIp3J4ytfacDv//hvxBMxhIMSmb4MTjttIS677FgcdeQshIMji3V3Nvfib/cux69/3YhMtgAFF5/53G+xatVG3HRjLaKRgA+6cgyV99XMzX+O9p6IvFwhYnzlK1diddPXZFdP2k0WzZrnTj6lrqGh4YbRzZz+e+MNSCA8Cu80iJnUSKf24LNLn66dXeIxPVV7+erlGxHEiGnQBIAMl4lB0rRHH36G9p9kOGMxQbMEyHX2+zWF6YI8getdUwzXVJnYgiWjGz0N+2Bl8XngUVV13PuKSxfcJgPlUDrvgl1BHmW6GIpvamaw8grNSZAwhfDzKW27F/2Z1kI8XhUgCu1lV7kMAK7KT9VeTHf3slZiaIILj27kALU3q/tANM2hzkW7XQiSKL+fLtlhltAAyWZkPUCnM4YX5Q+03eYBArOhRWhoaFDFxXOPicVnvF9zUDn5rPziDZeitCzqZw69sVrMerEYC/c98CI+/4U/IFlchO62Hlx7zfm47trToJSCEAbGqhljAFp54LF2Qysue8cPcdcfn0ZRSQlSff2YM7Mcv7j9/fjpj9+LmhPmIxwU0NqFUhpKKTArTKwuwrUfOB1/uudTOPesI5DuLaCoJIS773kOl112MzZsboOUBrTzRmdI34N7grxAf3lZHDd8oRb5XFoyAioam/7ZeHzWUV6r09r/f83pDwrE6UH356hdOBi+ENIwyLD8j+l95L6+GsO+twY/hjQNKThoSMsQTPFXrcnt2zIU+7qO7fTP9yyaAwIP2stnN7dVWdnCE4qK598mA1XKVbYmwCAanhXGDJCSMkCmDEvJZMDJiUJ/m53t37a6q+vluzp2rbow3bf+c5IDABv70wKX9uCqJr+OIWpZJVUHOqdaF4r253gCsAncM2SbjkjkEL6CPQNA0rc+9usZysvne00LlFu5Z2WNwFwYalbiUy1QvGjuLZFIlWxtb1W1bz2WTj91IbRfL/FGOYreJHu++mWNa/HJT92OSCyCzs4UrryiBp/9zLnQSkEI6cfsxKgF8mIUQgr848FV+NwX7kIm7yIcjSGX6cLHrjsb137oTAQChpfBBA1Bpt/zRg9aM6w1tNaYVJ3ELd+/GscdOx1f+drfEY6YWLupE5dedjO+/c134ZSlc6H9jEmig+d2OiggIjxX1tlnLsZ5562iv963ChWlVbK4aPa3Uqn1J/v7ZnzsSyi4Lo1Jn81eMkU21+HmM+1/ltLoZzCN4AIZ2HL7+xWea4uF1pIMod30n33n9utuyWmlnaE/2922AgGGkGHfNcL1+7dZaLcYx/A6e619jZ94gCImEpv1zUCoCo7OsUEswTRoBDIIgiQx2zKdaW9Rha7ldj61ynXzT/flm7YUUqlNA9eumviW92oSYGGDeE/n1KP4MERgG0CHjzVxDIYQgUAwWpGwu7vgFQ027PWla3w3FrOas3faedJ+ICYF0m0gMcV3aI6cfWaYhnXAVt/dd9dqIkgoPWfInB7NAiLgqkEAqTHq6+vd0tJjLo3HJx2dzRdUWXFYfuyj546kzHij6HKaIYRE09pmfPhjt8MwYuju7sEF5y3BV750KTS7gJD+Y4/MaPHSjw1oZnz3u/fiRz95ALFYDMp1UV0Vx9e+8j4cv+QQzz2mvSr2kTEoMVy6Qgrh14sw3n7pSZgzdzo+/slfYNu2PtgO4/3X/Bif/9zFeM/VSwHWXudD8SaTfj63zic+eh4an1gv84WCihZNWVppH1ZTX1/f+ObraPjfQGJeJ0nB1cP7IREYmgUkkeukd2677x3YeyOq1+gD3RuC0Jgxwr04OnwnCTexVh4n226xOSYmQBiROACT9hhPGQvJOAJgwGeswIPdHp0hX36trK+vV8XFh50ajlYcp9hWAmzwCLJkZiEk27nWfG/Xhq/v2vXUj+HRoI941plnfjiw8cFdLrCLFTmQbI4pwP34u+HhutvlNxkcY9Y0mzJC0WBxPLWfL11efi0DjQgGiwJEJpjzY+v+zHJAEDl2n8N+KjYxYZACkYjAik0zEo6VTK3s79ra57dD2Gd6nze/0WJBwSnMCkwsaDQ4CcC1sx6AMC9TRGSF49VflMEIOlr78ImPnYEpk0s9TV6+kbwUQ4D6s589gv5UGuFIFGedeji+/c3L/LPpdT0cntGkWYHAkNLEjp09+GLdXXj0sVdQXJJET0cfzjxrAb7+lStRUhKBUjaEMCHF/kn6gawn5SoctnAiGv7waVx//S/wyGOvoKikFDfV/wGbNrfhphsvhmUIHwDfTFaIV0syfVoF3nHx8fjxz+5DVeVEhMLTbgJeeMu4FbLvYduZVtd1QMKi4XEHAkjB0TIQThQVHXnCjBlHPN3XFxDV1cWvG5A0NkLvh+A40GsC8JhdY2omhAj6dSjD45gkwIoFGbPD4ZkLskSr9q5seHQ5RUULFsaT0+4TMhgGK2IiRwrZx2BJkFlThFzXaX1206aGDwFAOF5+smXG2GXNowUdkaGV0y/bW1d+sLv7pd94NDcXy/b2dr8uooEB5urcS2ojGhV4aYUnvMdIMPAcVlkhdKvvmtvpMT6PthbI4583gwIyfBqARwYYFfYmuBsaLtEAwlLIt/is0CO5wDw8JpK0C0AGAFg5j0Or4+GX+w33YDGUMsxYIGxNvKAfW76NmqUCjfuyRmok0KiKy2YvDQQTMT1mfY/QxCRYZZ41gBqDiNyy4sPPjccmzc9llZo0ISKveMeJg7UE2G/v2X/GgSWE55vf0dKBQDAKZsa1156NcMgaXEge7D3s1UJIP1/gr39+Fl/79l/Q0VtALBFCf28XPvmJC/DRj5w1LK5ivqpnk4aAUgqlJWH8/OfX4stf/jPu+PVDKC4tw29/24jt27rwg+9fhZJkdJBG5U1igni6JjPeeeVJ+PNfn5S5Ql6Ho9VLi4vnHVVfX7983ArZ+yhke9Y5Th6BYEAwD2j6vhXCWptW3IhGi49cseK2xlE9xveK7bW1d9Pdd9dqL8Zwk9xd0DcN5P+/zie4UQNAPt+y3HH6nVAwbGg4o6x1gtZKBQLFRjxeuSSb3bhqgAZlD1aNAMDBcNnxyZKFkwaNNS/0UeH7H2CKKHo6U4MmgpCRI0EBIp0bjR+ahJDpTOf67u6XfldTU2c0NtbrsRM/lgJohCkDM6QwoZWzp6OQJ+rsAgDXKTyjXBtCBsTu7LlaMFmwrPj5AD7fuHSpxl4RpEYCjW68bNEJwWDFJNZqd987wEwarqs6AOQAIJPpWR0rykMYIQKrESdWQ5GQEYQjxacD9K3a8lpu2Meq+vU9HI2WnWtYcTg6z4LliPbQgMGsNdv59FOirm6pBoBAYsI1gVCU+1L9fMGFS1BZXuRnXok3mMve43ASgrBwwVT09fUjFAzgk5+5HX+4+2nsbO7yixNpsJq0s6sfjzy6GldefQs+/plfI50HoBRiYYmf/eQ6fPQjZ4HZgdY8JjXLgQhaKX0Lgxg31V2Mr375CqTT/YgXhfHUM+vx9rd/F6+sa/NrLfSbRgAK4dGwTJiYxPnnH4Pu3l4dDBcjXjTzfQBQW1s7jhJ72rHM1Nf38ibH6W4jYQ1L7qeBRmJSkMnBcOUngEj5smXL9iM5oVYC0A0Nlygir4d4Y2O9O/pzEEFdA0B/f8s2x0nt8npN7F4kyGCSRhjhaNXVAGRNzVLsCcz8n3EgGHsrQMxuwWW3wOzmmd2cZjenWdm26/Yrx8nfP6i4kSz2E/KHTqKXnMvEgO32dQOsly27Se0hHkDl5U0MICCs+FIvsWGoRmagEbcmDe3a1NfXJwAg279hpWv39oEMwVAjMs0JEMxKhyPVs0tK5tWgvl4Di/ekmZL/7iiKTf68aRVBw+XdufWYWSsU7L71A/uqq+uVh/L59h5BphxRLUYMgpBaOyoYrl4aTy66pKGhQWFe7V6K+BabjY2Pu+HwIYeFw5PfqllrAZIjK9wJLISwnT5KpVofMerr63UsNnV2OFx+sm0TiuLSeOuFSwYp2d6IujD5wuzaD52BlSs34fnntqOvP4DP3vBHlJdFMXlSCaLRAMCEbMbGrl3d2LUrBSYDZjCCbF8aZ55+OL5440WonpCEcjWElMOYfOg1PaEQALOAVg6uvPwkTJpcgk98/HdwTI0dzRlc9o6b8b2b342Tl87x0nyFAXpTeLS8eX/rhUvw+7uelrajEAiWvA3Rys83NFzSAfzn6kLeTGPq1KsDAHrtQs+DYPcqsFAYRqFOIFLKVaF49YQJk5f+mojOAkh5GvPoboKD7K1uvGzizKL44m+S1pUMlqYVWwsm5bmPhCYJUcjv3L5987L6g+FG8C2lvFPouQfsfBww9G7FiYB0Oa/C0elHV1Sd9KnGxvpv1tTUGcCyIYW8BpjXUS4aG+vtWGzB2cHwxNM0O5pGUOJ6GQdEhuE6vSKXaXl4mHKjx5YUXlqxQQECiG+6qW6sEn8xb16t0dDQYBeXHXZRNFI9XSsM64w4lLYjOCRdVWgG0Ftbe7dsaLikvWB3vRSKTDjBYeH3fh+4vQBzHqYZR1Hxgh92dTUdTViZOcIjytTD17O29lpuaLjErag45iOJ2OwarW1FI1oaDjxykJSbQiHXfj8AHHLIWRaQ7iwU2u+Nx6depSGVR2U/vMrHIdMsE6UVs29J2S8uQ1ND+0hyTM/qAJaisbHeARApr174k0CoIqZ1QWG3iK1QkoTI5FtX9ve//C/D8yFOems4UmV2d6fd006ea8yZVQW8Yf30BEGeICsrieHOX1+HW265H3+9dwU6ulNobunGth098Jp/erEQLxWcQJzGnGmT8aFrLsP5Fxzhu6yUXw3/+ka2iQASJpSrsfTE+fjDXR/HdR/9GTZuaINphvC+D9yKui/W4srLT/Qr8Okg19i8XlaIxry51Tj6qGm07OlNKhkvT1bEZ5/Tlt71qwEzfBwyRg7TbGMAyOa2/zRamPZOyyoWPIoojwiStFYlpbPPlAj8Y8f2P1/d2FjfPnb8oRHRokNOLC8++rfRokOmaD1oZBwzXFM0pYlCtusRT0jcJBsb8bquzQA9R3/fljsjsckfDwQrBO/eERaCWUCQSpbO/RoLyMbG+q+NvBDQBCCZnH5oSflhtwWDCT3snYZZclCGlCKVad3Q1bXqibo6FvX1pLVmZ6xMWpAWDOZQIDYLwIT6+voWrxdIFQPwWHiJdFNTg11SMvvIopKFPxVGVGtd8OU3D8YTQC4TK9Zu79MA1PLl9wcBqGx/529jMftESDEiS9sjYgkIxQUdjs2cN3n6Bfdv3/y32hUrbusY/aQNDY0or6z5eHHJ7JthSMWahaBhDeP9DplCskhnOzd3d6z6O8C0ceMlLgBkUlu+FYlOuiIQrBS7p0kIwTqvY9GpFTMmveOZ7q7VH2pouOTB3eNZjUhGpi9IVC7+ZTw+7Ui/5YAc06B2s5Tt6/ghgIIBAMFgyVkkAlBuH512ymF+CRBDvoHTTckHkXg8jBtuqMW73n0Knnp6I1au3IQt2zvR15tDLpuDYQrE4mFMm1KOtyydh1NPXYBQMDAotL04hMZBCfQQe3ERV2PWIWX4/Z2fwMc//hs8+sRLKCkpwudvuAs7tnfh85+70HPYau2z+u6LS+u/N7z0acLppx6GRxpfYWkkORQorgXwK4/eu3EcMUaN6uqcuvzyOlFfX/9MUXj2fcGyknMdF64EfPbUgWQPliBTF5fNOysUib+Uz3X+y3Z6HoTSWwGHAJOJcJgVKj01GCw7KxCuMlw76xK0YBCDBYO0F2w1TJ3tb0Zfz5bPekJi2UF4swblF5OuipfMvT8YqjpHK7gQbIANr5W8J8SIoaVplaC87IivxmOTLspl2551nfw6aAEYZiQYSB4eCCbOCYXLw1o7jBEtaTWYDUAwu4U+yqZ2fBaA/bvffSQAoMDsbtDQxw1vX+rNqyDFtg5GqpLVU876Q/O2B2pXrLitbUiG1CMcrl6ULJn7nnBi6rtDwfKIVvaoDo++24aIXLuf8qmuPwLAtm1bXQDU3r7uD7HExJuiidlVinNeW9DhGAYWGlonkvNqZs2Lv5DPdN6bt/ue0OzskNIwJIVODIRKzgtFJi42ZBia85LIGOWOE9BEWrNrZPqb7wHg1tQsNRobBxuErQnGZtxTGqq6hLV0iZTh1RbpwQtoJXQsOn2aacQeKCqa+5ht9zzp5vOdUIAIBSKBYOLYgFV8SjBYHtbs+DT/IwAUzEJJGTBSvZub2jq23F1XVyeMQKBiaiAYP7xQsFFSEhJHHz3bn9w3fq7pAIgwM6onFOOSi4/GJRcfDQDoT+dRKNiQUiIWC8EYFtvQSkNIMcxtdDDedWgPSoOglUZJcRC3/+J9+FL9n/Db3zYiWV6EW297CC3NvfjGN96BaNQaInyEeMPOOQAcu2QOipNBaRccMoPh44BoaX19fee4G2vs4WWpMXV2z/+4GUyeFoxMNrXKaS/IOIy7BFootlUwMqkiFJl4Gbv5y7S2vZ7skDAME5KCUMxQOsdE0hgg5/TAQwIkHMFOINW7/Yd9fWtXHEzGgIaGeQwQp7o2fTESqDwlEJpguJxlQXqYA8YHSXZAIqgjsRmLI5FJi72KeNc318MAKyhls9fnfbgAF2C4roGQ0ZN64d6Ojuf/jNpaubHhJQUAuXTb2lj8EPIaCKphNoCXx69ZcHHpohPDodKX87me5Uo5PZJCbFjWLMOMHB2OlJGGBR4Ej1EtYclVJuKyN71yZVvX8id80kPXTxzpT6e2fCEcmfBLoogLssVwjjOPm9sV0FKHg9MmRIKTr7F1/hrNeRAZECIMKQxozmvmgiAYuymzzOz19ejb2Nresv7bYKZGH50bGhqYmSkcnvzxSLBiaTQ2vcTVab83zHAkY6F0QZtWsbCCZScTF06GJjCU13qDwmBWUDqviUaxr5IGAywoyHa+Dam+NdcBrdn6+iYpoolpxwet0lgmk9EL5lXTtGnF0NqFZuWzur7xQUQI4fX4UApae33FY9EgSkviSBZFYEhAKwWltNfQUP7nhbPw60UsKfCVL1+Cz37+QvR396O4JIG/P/gcrnznD9CysxdSmlBKv6HnW2vGxElJzJxeQblcTpnB0qJE8eylvkd1vDJ9bAjRwCUilWra2Ne74f2O0y5IBphZ69GKBwFS6yy72naVsBTMkJZmRJMZ1C6Ea3NOaS4wsTmqwAsAyBGmNru61zzV0vzw9T546IP5XrW1F8u+vldW9ac2fkwha0AE3OEZQSOVKlcoldJaw9Ugl9lyWRsuuwWX2WYaw4/LDNcwwka6f+PWjvaV76+rqxNoaGCPehzo79/wm3x2V0aSQV7b0tF3dQmsdTgyvay47IhzyisXX1FSMffKRNHsY0LRKlJMCrowJhsIs9ZSWpTLbeF096b3A3C8FsVDFlhb23O/6u1de580yASEvbv+JAFAuJxhBwVXCFOZMqYNEdQg21WqoKGFGJOFmTWTYaFgt1Nf6pWrgNZO0CXDf1ETXSJyuR0tvR2rP1qwWyUZAQXWY0huEoDLWtlKa+Fqki6T5WptuEoVlDf/u9cuEGuALFdTzujrfaWuq6vpXzU1NQbQoEQoWHSUYVggZi4tTaK3NwshDBhS+o2UvMptpbyqay8FkUcFd94Ygk1K6ZEXshxBj84ASHrMv/+dMIN3zoXwGYOUxgfffxp+9P13wS3YCEUjeLlpOy674tt48eXtHqW6q+B1GPnvggmDvQZePoUL4GXAWZaBJUvmI58tcNCKIhQsOmooIDc+xmZ9blBAjbFr11O/6epc92670CmltARYux6p39B6EwwSLAyCksRaQLMgrYUADMCUflDPbxIJgBWzJMeQhpnqXPfKzi3PXEJE+YaGhv3v3cJij2zVe7dCGlRNTY3R3LzsZ53tL/1NkmuCgi6z1uxnMA1TpUAICAAGoA0tXEOTNliwMbJimQfoX1zDNI1U/7ZU866XLslmO3b5AlwD4NraWpnNdrb2Z7bdAipIEtLZPQ4jfUskzUrnlFLKdZXrujqvWBeYoCUgaXjQXAOsWbjSCAo33yF6u1a/u7Pv5RWj09UbGhq4rq5O7OhY+d5UzyuvSGlZTKYD1n5N30DjMwaRJMAwGFpqsNBgIVgYRBAgBrEAsc9BwATWcIUMwHF6RHfXy5/sbn/hEdSOlS7foIBa2dmz6g8d3Ws+7jp9JmSImKHANGpJiQiQXu90xwBcA6QNLwGAhrkNvedmJs0UdCVcs7Pt5b+17Hz8S7W1tbKx0QNvYZmR+VozYtEw/vXYyzjv/K/jw9fdjjt/9wReXr0T/f15CCEgpYDwacc8QFE+oLzhTu5AduRgKi9B+CRv/+2Ygk/bJglKOTjn3CPwm998CMWRAAgSu7pdXH7l9/Dgwy9AGtKnj//Pe4S8Pi0ulHJBzBDkrb/XSwXY0dyJp59ahy1bOxAMGgATrHDc79ex9CCt6gDXz5gfxoGw7BLGvhazf58DwNe9PdeYhm6jC9QYbS2P/bJz1/LzMqktuwxpGiwsYpYuWPKgCCM91OPc55IdiAkMeufZ0czkkgwTaZjd3S/dv2XzQycTulqYeQ80FmM9sx7mdtEHvOEaGxtVLWrlrp0Pva238+WbofsNKcNCw3SZHD264daAf17wWCeTWYNdQkgbImD0925Z39ny9Gm51JrnxhDgGqiVu3Y+fmNPxyv3Cm1ZLCylyFGjTDPA62kqQWwQkUFEQ8BByiOZZGhidoUAGcI08v3NnW27nr+qre25X3l9cHZzBer6+nog097W2vyP03q7XnmaWJswDFICLrNUwwMaBO0TevFAR5dhl3IBKPaImbWSRsTIZdqczo6VV7e3PP1d1NQY2KMr0geR5qe+39m6/LNOfpdtGKYEkdIDLzfCu75nglmvtRhpZkMZ0hDsZozujpdu3rXzwbfVYtCi9RpaaRjHapJgdkXBldjVk0PLQy/ivn++gEBQoroqidmzJmHx4TOw8NBJmDWrCkWJ8KjAqh7ENqI3T4X1fxPkBlrIHnn4DPzh9x/FtR+5DS81tcCKFeGDH7oNN3yxFu+56mS/0yHhYCfEDTX3It/yHMqg3NnSg9Wrt+OFF7Zg1aot2LS5Db09WUiLEIlYpJhAJOcDEF5my8EoSxcWCRNgPSLVxWOINom1Mg5g9oUg0ws907CLCQMM2u/rsGaThEm7W+MDlu6eVq3RBWplZ2fDfZ2drxw1cfJJX4nGJ19sBZMRQgCsHc1QfuspFqNqq9nPZwWREIKCgtkW+ez29lTPju+2tv7r2z4C7JEDiUhKEqYvR4ZR+7IACRMg8usVlh3QFmpAgwYY27fSp8rKlmwtKp7xhVCkutLr3aXBzArQzDza7+Y3u/O1PkFSSiajkN+F3sy2u3ZsfehjANr3UKzqF0oytm+jt7F2fhEvnnmlZSWhWYG1cjHQFmKwUdWI7Dc/d0oQJKSBoCBti0KmN9+fa/pLW9vT1+dy3Tv9e+8pi00DELlcrnnr5ntOqqg65YvxomnXBEPFlUIaYLhgjUGEGtmaYNi7w5SCAgTpSOX0oz+/9cFdu5Z/Ptu3bdVAP/t92IIKNTVGR2PjN23V81BJYvFPQtHJx0jL8lrcaqUAzeABo2QgTuU17vLmQhARSWFAsK2R6299pSf10lfbW1f+DszUQCP7JximFY2wdiEM0NTiFHZ1h9DvxEBkQbkK23fksHnratz/wPMIBw1UlJVg3vzJOOrI6TjqyGmYdcgkBALDAtRaeSmpvvuLRvFwjY8ha0RKAaVcTJlSit/d+Ulc/6nf4B8PrUBpaSluuuketDb34QufuxAC8Hm5Biz31xpm8IJ7Xqt69trwkhhs7pXqy2NN03Y888x6PLdyC9au34nenhQUBCzDgmESEIwh7wiYOi+kZ6VMBxAnol68joH0wR4SnNtiZ3cerpQaNLSZARKCXLs3b5Lb5/3rPN5HLEoXCp0OaxfMzqBWzwwIw4Dr9veOuO/egEjYHflsK2M3W4MIpMFu2t7rYfeE0s6d2/95dSw2/avx0rnXhQLJtwWs4gnSjAghjSEMGLBESXjuDc7Ddfrh5HvXZTOdf2tufuKHQG6nT3xHe/F9asfuzRSyuxJaOxjebE4zkZQEuOm2V6uHePeuEx0d9T/q6HjmjxMmnnx1KFj1NiMYOsayiqQQIf+eYqj7CPmuO6Wh3DQyhVSna6f+1tX78u393Ruf8S69V6YD/77s7thBV5VlDv9rLDnrI1YwcrxlFRsQAZAk30VHPvW8/2eawXCgdAF2Ng3Wuedtu/2+no4Nd/X3b1m/H/ceeahAqq310ZvaWvHjigk1V0ciVWcZRvAEK5AwSYZAIgA5rF0uMYOhwGxDuRnkCjv7bJX6Z7p/+51dbavuHbx/Y8P+pWA3espJX2fDqr7OjceVTDjynHh42rvNQOTUgFkUFTLsGV2D8z+gRGiwBljnUSj0aKeQey5nt9zeur3xtwAKqKsTvpU/0iE299APaUaMikty+P23XkKqj7FmbQIvrA9h7dY4drRGkcoacF0LhiCAcnB1FkozwqEgZkwqw+LFh+C4E2Zh8REzUFYSHQUm8F1f4yiyx53np+9qDdz0pXvwy18tQ0lFBB3tKZx/9pH4zreuRCRiefT0Urym3iJeYoT2eL6Grcm27V1Y/tx6PPHkOrz44lY0t3bCdRmmNGEEgnBAcAsmQDaiIYWpFRlMn5LBMy8kOWtHyck196xf+6sZ8IjqXk+/GwHg4uLiONmxCYXdfhyAlH35vr62rft7wUSiYppSiQBQGMMSy3dnMm3t+/kOFItNOITZHNNZlU7b24HW7D6uRbW1tWJYllSyuHzJ4mAwscQKBOewEodKMos0AdCaIGgThLvazvZtzWS7X+zrfuEJDL7IPgUdAeBQaGK1lOHY7u8fAFBAZXrblo3eD1/DOo58lnBiymHxyLRFZiAyHxDzDSMgoXWREKJPw2Wt3E7Xsbfks73Pd3UtfxJAFwD4GU/7G8chnzBQA0AyOWO+EZh4Uigcn0yESYKo1FO+vMaDSjmKBK3J5/sKtltYU+jvfCWb3fDiwMUO8N5Dz1BbK4a7muKBiTMD8eqFMhSdF7CK4szOfOlnOimllBRiTTbfV1DafqizddUmINfib8YBl86rCITWCeBLg67DUKi4OhKfe7xpxY6UUsw3jZBk5lJPEaJOx7VJu+5a18k+l7WbV6a7NzYNbZmL97ivaP7hH2fHjmDSxBbc850VKDK0x5tJBjI5QktnBOu2RrB6Yxgvrk1g444IevoiYJaeMoQClG1DGg6qypM44vDpWLp0AY4/fi4qyofaEGilh7VbHR9jCXYijyb5tl88jG98/X5Ekhb6ugs4anEVfvTDD6GqIg5XuTCkcUDXHnBPea6poUDhuvUteOKJtXjiiTV4ec12pHrTILJgWgZYBGC7Alo7iIQKmF7dj8Nm57Bwdh/mT8tiSnUPIGO46EPzeGtnOZm6u7tl9V3Te9DTh/FU3ldlkg40dBvjZ8PpJ+zR8qqm5iTDD2q+0eacUFMj8fjj7oEGS73ssXk8AAYHCl7Md+tX032SiHDSSScZjY2NrzWDhVBTI+uWLtX19Qf2Dt67D1ipr1X5qhUe2emBPQMRgS++WGJYvGPM3zv0iE9yrmBi9uRe3PnNFQi6GpoZWgCm0LAMBpkATEY+b2FXRxCvbAvi+ZfLsfKVMDa2RNCfiYJACMCB7drQsFFeGcfRR07H2WcejhOPX4BYNDDgN/Y4tiSGdS/bi0U85Cf8fz+YGaxdCGni/gdW4NPX/w4sJAq2g4kTYrj1B9dgwYKJUK6CNPZWPc/DGIjJb6vrjfUbOvCvx17CY8teRNMrLejvz0IYFoKWCRsGlC1hGQ4mVvRh4awCjlrYiYUzU5hSlUcsYnvlwAUCOwIpJXDF9UfwprZKMtGe2rLpgdnZ7LZdBwlA9tWS8UAOiNjHpuP/0rUGD31NTTuVl1/LDfdcqoZfoa7uRrFsGUQjlgEem6x+FfcQQB2A+tfzufdDI14mamqWwuedwt13360vueQSf/5q4dFrvOp32sN71vj3nM9eP45aDPXlqEV7+xoaolVZql8dYO3vcwDA0sGGTQOjvX0NDVtPxsFJvRRALXn7ymMQuOeeexQAXHzxxdJ7jgHG4P0HT1p4xMc5V7Awc1IKd33reQRZQQ/rAcJMg0kbQgCWwRCGAgIa2UwY23dGsHxdGE++FMcLa0vR0R0CIGAx4Lh5sChg+uQynHrKETj//MWYP2/ioANbaxeen5fG1MiHmkP7MZX/EVXUYwQWeO75Lfjwx36Grm4XhqERNIDv3fxenHzyPL/bohyZluxbGgwewfS7fWc3/vXYajzyyMt46aUtSKWyMC0T0gzBUQLaBYqiecya2YdjFnbj+Hl9mDUlh2QiD7ACbAMFF1DKk+GaCKbUyGmBSz99NG9rLSWSLbmWtcsOTRU2bgIOVuvS/9kxqtGGJ4zKy6/lhoaGPWmqVFt7917ArQENDa+boB4f/6sb89DDP8GOY6KqPIO7b34OMWlDawywhI6hJXuuWAAQ0oVlEaSpoGGiuSOIVU0JPLK8BMtfTqKjJwhiC0R52HYesbCJY4+bg8vefiKWLp0DATFYqyH8+hWl/GDxbk2G/UDyqCJAP1NlqO8VvbGBZuB9AQy+85gg4ipIQ2LLti5cd91PsXptO6LRCJxcCjfVXYHL3r4ErNRg4yytvC6LA0W86XQBTz71Cu6973k8u3wjOrv6IE0JYcbhKgFDOShN2lg4pxcnHdmJo+f1YmqlDTOUAxwJu6Dg2iY0CZBwIQa5gQgaGpZgdBZCqP3UkdzdXUSaOrvbd/xxWnd3d2rchXVwzuqoWMn4GB9vBAD5FCvXQDzej3tuXoGySAFK7UsQD5TaCDADDrwCfMt0YQQAkEBzZxD/fjGJB5+owoqmCHozYUiToO0cCAqHHz4D77m6BmedebhncYwSgFu3d6J5ZzdYa0yYWIxpU8tAIHitFPwKeebdq8qZoUb5+99QDU1GWVmeZTWWq459S0Siry+Lj37iV3j0sZdRXFKC7u4ufOTaM/HpT1wwzNvgzUPT2p34+30r8c+HV2LrtlYIHYRphZBnE1I5qCpN4cj5aZx8dBeOmteNqtICSLjggomco8FaQEBCCBcMCSa9G6m0ZoWgQdjaF8bbPnE4u4UicnVPT8vW385MpVLd4wByUCwQfz7DlWWVR5wYDCQXGDJ4mFtoeWxH81PfH2jGBC9CrEorjzopGZ/2SWZTA67Qg542DYEglNuvenvXfqynp2n7uMU4Pl7tMJgBNoB8VqK/30JVIg9X0W7ibDd32kAvA2JY8KodHddEwSYQaZRHC7j41GZceMourN2axANPFuEfj1diW0sIUsbx8otb8aHr1uG4JXPwkY+cg2OOmgkA+Oc/X8Kvfvs41m9oRjaXBxgIhQOYOb0SV15+As4790h4afDeM+QKBbS3p2AXGEWJEMrKYoPpqEPkhG8Ey0ODSGD79k587RsNOOvsI3HBuUdBe3nhELtxj3m1IlozEokwbvvpB3Djl/6IO+98EmVlxfjBLQ9hV2s3vvbVqwACHn10Jf785+fw9PJXkO23EbAiIFEJFy5K4904ZX4ObzmmG8cd2o6qEhuAgioQchkBZgMekYLwU/yUX+CkIQZTHofKHYgJJDT6+w3k8wKmwSDl4tUELcfHfoNH8cSpp34hFJx4tRVMFEsZhGHE0N6ePQTA95lvYq/+poaARkgKLIrGZ53PEKNa1TJABhy7F729rd8BsH1/+nWPj/ExJoAotmFIE+n+ELZ3hDFnahc47+Uq71mJ5N2+DpR7SOn9m+MS7N4ApChg3oQuLLiyF++6sBUPPFWKhgeqsHpDEoFgBM8+txXvuPxmfOjD5yOTKeD2nz4EGQjCUflBw6E/m0dvTwHPPL0BjY1r8NWvXI4NG5tx1x+ewvMvbER3dxauA0QiYUyqjuKEE+bgwvOPRfWEBLR2IITxX5/oARsol7Nx7z9ewN/uXY2t2zrw0WvPBpigtPJb6I6iwhYE1gzL0PjGly/DxMpifOe7f0OyJIl7/vIcWnf1o+A4eG75OhimBWEmADMKM5zFUbO34qwlnTjhyAymVPQC2oVjm8imaQg0xJ7WduC7UTXCxICWINPFzo4g8nkTgTh5Hdz6+sZP1OsOHnWEyE/LplUc8894ydzDFFsgpRVr7bpu3gDQO/Z+o5zrFhRIujyiRwQD5LLr2iQEnPEpHh+vDUCUy0FLUUFJbGmOAEd5binikfWSB3xhaGjDY9IsFAxwTiNhpHHlGVlcvLQFf3+6HD+/ezI2bksgHIrgR7fcD5ICkUQYRC7OrjkSCxdOAxGwevV2/OuxVVCBMP709+ewaWsXtm3bha6OHKRlwHZcAA7a27uxfZuJp57ejDt++Tg+9enzcdnFS3wOJxp5hgZoTug/k+kliMBaY/bsCfj5rR/Exz55B772zb+geUcKX66/GIGAgNLsFwuOkiJ+gypWCh++9gxUlBfhhpt+jUg0hudW7oTmPBJFFchlHcyo7MUpx7XizONTmD+tB1K6UDkDmX4CcwhSuJ61Q2MDxr5Fmgazhzwbd0RgFwIQAlDapr7xktHXd9TWCjTUq0llZ30tUbzoMKWcAiNjERnS28OGZKY9VJWyIIJkgIlGVZ4SMRGImcfXa3y8NgDRToF0OA4I4JWNQTBJj72f8NoK1sgnjCSAhAIJARcm7BRgkMKlJ7fgzCV9+MWfy3HnfTMQCMRQcFxEAga+8833oqZmzojrPfvs8fj4p36Nnj6JV9a2AhKQpkZVRRRz501ELBpCJpPH2nUt2N7SiXTWwac/+StkUlm8991v2aNbaaTQPpjnyYvvaK1x9tmHQfEV+OT1d+E3dzaivaML3/vOu5FMhgZ7pY8iXPDiOcJjHK6tPQaVExK47hN3AKwhzQjiwRTqP7IRNUe0oySioF0HhawFzRaEUJDCK54iJr9Xwqt8C5YAOWAlsHZTCKbp0d4pZdsAxptJvY46BxoaVCAwZWooXHaFZqXByhJkDKPjGA9bjI//ugXSnwVXhAMW+JWNCepKB5EQNtzdmsS/SqHJNMIZIiWgIJBOEYIig0+8dxvWbynCA89MQpj68ZWb34+amjlwXXewJwmzwjHHzMQ3vnEF3n/Nj2AYQZDW+PDHzsUltcehvCwxeMfO7jQa7lmOH996L6JFMXznu/ejvCoJu1DAxvWtkNLAhOpiHLZwKubPq4akgf4g/ylLREApB+edczRYC1z/ud/goUdX453v+SF+8sNrUF2dgOuDyG6z6TMOu8rBicfPwZ13XIerr/4B+vNAFoR5U3IoCRaQ7jVgiBBIKsjBdfTJG14jIwAzwTQY7akQ1m5IIhjQmtiUDLUZQIqZaTwW8nqMGgE06mi07ATTLA4wazXUpGfccBgfbxAAIeinSdOp4QDrLa2WXLcljOPmpWFnLRysthnCrykRRGhuNrFuUwLKzuCwJXNw+lsWQim/R/lg1TRBKRcnHT8bhx8+B8899wp+/9tP4OijpnvWjkfqBBChtDiCD77/LShORvC5G36FaCyGT3/6d8jbebiugABDkkAsZmDBodW45v1nY+mJc8Das5IO+iBASAmlHJx/3pFgoXH99X/Ayhd34B3v/C5+fMsHsGBeFZSrIY2xn0dKA67jYsH8SXjP+8/GN799D/L5BP78rwQ+f3UXtEFg4Q4D79dvaNYwAow1a8PY0RZCNAKGJjDzegBYuvQmOW6JvH5DSiMqyHwVhX1aM7MLIpd36zHhJf6NA/34eM2y3HYymxQrSKmQLwTw+MpikOkTjx0sGUqe8W0YjGxfBD05AagC5h5a5Rd28IgyEPIzf8DAwnnVqL/pMhx91HS4jgPNXlM3ISXI55NSSuHS2qOxZPGhKORdgAUkTBQnQihKBGCYCqm0jWeW78BV77oF3/3hP0BCYmQf5oN5tsRg46gLzjka3/7mpYgETWzd1o93vutmPPnUWr8VrvJZRHm30y/8DK23nDwPRdEIBExsb41BKwlLSRw0nn0G2DTxxPNJ2EoC0mvipez8Zu8Xlo2fqtcTsCUrHtbd7wD0lJA0ggYMGRQibEgR9D+mIaQlyZBSi5w5PsPj4zVZII7dv0brAjQFEQgSlj1dimveth1RaUNBDm8z/HrKIM+DSwwYLkh4LTnzeccPbI8y04k8gQkb7373qSgpDUFrDcMwRv4aABI0WDF91HGT8Nd7n8XZZ8/HVVecilmzJoBZYevWDvz1b6uw7PFVMMNRfPsb96GiOIbLLz9xkDPqtQ6lvboWMYbLiAa1SwHlujj/3GMANvDpz/4SqX4L13zgZ/jmN67EueccAeU6EHJ4rxfv3QaUx2g0jECQwKkCtCugBQAq+JU5r/O6MSFguOjoCeFfz1UgFPCi+0pn4RT6nwfgU0KMj9fXZj2Q0agBgJXzfDq16S4XikkPt61dFFx7Fms7TSq93bt+w/4USvFBeocDpI3x6DgG+s4sXQrd1NREfuMsvf/XGarmnzdvzeAzLFsG4VGbHFRakf8/AJJNtz7vJtNaBsMyEspj3bYInnihFBecsBOZlIQ8WA1KiaFcidJkHqWJNHq6E3j++Y3IFRQCppexNLDt2bdKBFmoqLAAqCEq4jH2JpFnrRxx2HR85LqzcVPdRQgGhpStuXOqcdaZh+Gvf1uEG+ruRKI4hFt+dD9OecvhqKyKelxdrzFWIP1n3xcgCUNAKRvnn7cYgMSnP3MHXBj42Cd/jd6+DK54x4nQSoNp6DrMgOsqmKaB1S9vQ3dPDpBFqCjNwJAMh+Vwlu7XTxvWDCMq8PhjpdiyM4TihAKxEI7dn+/t3b5muAAbH/89owUA2tuf+3d7+3P/PgCdbh8b5kbxKniifILIe9RrwA5RU1MjGj1CRg00+EqKp6kcgMJCQK3wSRY10KiHX2f0/A0Mj5F3mfDb5467/EYDSH//phWuPnZDSFizwXkNQ4p7HizD2ce2QcKFhgUJZ6h15uuoVrmuQDKRx+KFKWzYWoYtG5pxx88fwbUfPgOAlyEF8GB9xK62XpSXxSFIjiqOGrXjhAcgNSfMR80J8z2LwK90HwQkZlx4wRHY2dKOm7//T7R2pvDIv17EFZcfD631mEHs/T2HjlZ48on1mD6tHFMml/oV5dpTfHabRwEpLSilcf55hwF0OT716d/DtGK44Yu/Q2dnGh/7yFkjgJSIYJoGdu3qxXe/9xcYRhCOrXDsYSkv+kACTPz64QcTNDEkAVlX4s8PlkMaAl6yniFsO7OzUNjWQkRgr+fx+HiDnG8AJoY4zAcNZHg7JT/s3yyA9+LSqs+8iiOuPa4uBPxnGT0c7MYuPHQw6urqUF9fr31mXMRiU2dH4uWHgmLHhwMxJpIRR7uHMHEun2v9QkfLcy8Mq8gfNmolcI8CGhQRIZGomGpFp50UMJOHkQhMktClXtMdKCmNNbl8Wjlu9un+3o3P1dfXb/NAZe+05v/LG8wu5LpfiEbdWZqFToaEeGpVGR5/sQSnHLYT6bTwCvHoIMgFwXDzBt55XjPuf6QCBRTjhz/9O/KOi3dddTKKS8IACKlUHrfd8RAee3Q1Gho+hXDQArPYe39zGtKaiTCKQ4ugtUc8eNEFS/Dr3z6Ona15vLR6px860IPNZw5I9WOGIEJvdw7vfs8PUVQUw/dvvho1NfO8xADhVekPB5GR7iw16M761GduRyQRx83f+zvadnXjmvefhalTiwEQ+voy+NeytfjBj/6Cjl0pZJ04jl/YjJOP7EU+SxDidba7SUNrQjii8M/nE3j2xQokEhoOK20SC9dOPQ7Avvjii+U4V9N/e3h9OEorjzk7mZjybcXSAuughjL9Bk4MkkRuPpNObz2jo2PVxmCyanJF0RGPGUYiwuwwAC/q4mXhayFM4dpdD2/b+s+rfQ2d9wM8OFw0dVFF6fwPEYpOYzghBpPwaHcYZJB2+3pSff8+Znf+NO8d6uvrEYlMX5Asm3FhwCq6WBrxBZaVlEJIj0gU5JcLKLS3dj8I4AXULBNoHNz+A/1BFIBw1cTjLwwGJ18btKJHGFY0SDIMQcK/8YDCxadEtQul3Y8nk4dkXbf/4Wx/z1927Xr0HqAhs5/Npf6nAAROPvVXrfovZQoRCRdMArf/eQKOPawXhteX/aAkDgoCCgXG3Al9uOHadfjst2bDCCXxw5/+DX+/dzlmzZ0AIQib1ndh1YubcMIJc2FZBxb325P7aCDWUlIawYQJxdi5swctrZ0+2JBvsYgDiod4/eJtlBRH8clPnIe6L/8F7/vQ7ai/8W247NLjvRoPIfY4mcPdWa7WuP6zv0VxaTF+f/czuP+RlzB3TgVCZhA7d7Rj89Z2WMEYsnYRplZ04ssf3QKDc3DZHFEz+boYICAYDGSZcMc9h0CbGoJsCA4LR6XgOh13A0BDQ/t4ful/fXhrIIU1LRKbPU8J7dXuDGePIBOq0Id0ensFgI35ntYuUR7X8aL5FUrlRilODKIACpmdV0SjU76aTm9bO7aWP8ykBrisbOaMeMmSZZHY9CJiPZg+7oXuFEhEke55KdXd3W2PSP2uqTHQ2OBa1oTZVRMW3RAMVV9qhipMEgSGA2atNQuvOys0QKZizhmAzu0OYsRAPZdOOOrcouj0b4TCU+aTEQRYg9lRmgvMWozs0QpiQICEJQKRCeEQ0QXhSO6CUKT4i309mz7d3d3wFx9ExpmMB1Th3t7tz+ZzXVkhlCxAcTJCeOa5UvzjyTIE4wztHhyvBLEnrLNpiUvf0oLvfH4tSoK9UEhi8zYb992/Fn//WxO2N/egrCQBQ0qvJ/brCmIChrQAEAq2g5ytwDAgpYTwC/+YeT99tgpEXq/pD3/obFz7gaXoT7m44cbf4ae3PTbIbaVZg8ewERgEIUy4rsJFFxyFd1x6Ino7UygrL4KdA556sgWPNK7D+q0ZsEzCdRTOOGYb7vzWC5hR0gs3b3lklK+DtTiQ4MkAlCsRLMrj3kem4OmX4khEGLaWWhKJfD7V3Nr63JPebzeOa2ZvkMGsbO3YGq5tazej2c3x0CejXZ3VWloD7qNMPtf6c9ftZua8M/J38+yqPsewIjoWm3wqAELNsj36s2trawkAR2KHfTMan1GkVaEw4noqy0rZjnJTnM+1/RxAfunSpdL/Y4nGRres8viLpkw/dXmy7PArrHC5yXBdVrYmxSw0CYJrCGJDEBmAlkRSgv2c98bh4MHBCRPP+FlFyfH3huMz5rOAUiqnWRcY0JJABggSBEkEKYikIDaIlEHsCiibtWMrkOXGk/NmVE48+s+VE0/5BtCgUFe3r/40/xsAUldXJwqF7Vvy+e5GYoOFNpQmDSto4ce/qkZ7ykTAVNAHoaaA/WwrIYFsSuBtJ+7CXbeswscv34QTjmjH3EMUFs21kUx6LsidzR3o7s76Av21CklPQmayBbR3dCOeCGP79m5cXPstXHrJD3DTTffguRWbB9vxaj2yIG9su116cRYiaK1w4xcuw4XnL0DB1vjmt/+Cm3/wgMcezHrMxxe+ZSSER3N/4UXHIBw1kM05KIs5mDOtgClVBg6dkcFb37IFP6t/ET+qW43qeA7ZvAUyBuJ8r89aMQDWhKCRR0t3Arf8fgLCIcMnVBRaQ8POdz0AIFNTU2eMa2RvqKNNEFqApSASwqN9HvhIEpDCsIcOdX/3lnsL+T5FMA2finvw94mJhBESVrioBgDX+g2JxrppQ0ODCgQSU61A9CxWjiZoi4UcvBYTkZCWUSj0oLt758MA0NhYzrWolWhoUBMnvKWutPzQP4ViE+Ou67pgBwLaIILXy9mXGUOFMQOP4od4FqfJE+4cnjzt9L+VVSx6vzAjrlaOJn8y/EOKEdxGYP+/AdlE/mGEJFKGUjltWMWqrHzRZyZOOv0HqK/XNTU18n99lxlehgF0JtV8Rywx7Swpi0gpG+FIARubS/G9X8/C1z/2AuweBsuDB7lCEtJpwtRIDp+4chMKDqGvJ4BI0sFPfzcdP7xrLuzODjz19Dq89YIj4boODMMapXV59CT7w8A70D9k46ZOdHT1QZCJXW3d2LZNw5ASz6xci9/d9SzOOXM+brjxIpSWxP2MquH38mIeoyeFyEt5NQzg29++Cr09Dp5evh63/Og+OI6Nz37qArBS0Oz12RhrVpmBQFDACjC6+iTOPakDn/3gFmS7HSSiCrEoA0ohlxJwCBCGDdYmiNTrAiADlQfMGjJu4bvfnoIt7XFUFLlwXUAiKN1Cp5u3N/3YEwJN4+DxJh01NXVGY2P9WjvXtTIUqjpakasEhrWxZEhmginjJwPR0oaGhs6xtSm/ej4x9wwrkAwzKxcgY6RSIpSElIV863PZ7IaXPffVJWhAg6qccMwHk2WH3UQyrrTbL4ikcaB7eWZfmdhYX6+qJ5/+i2TJEae7bNiEnEW7UYYxmEmRB48CHv2fZmgmZuG1Sx1GJkQsWDkMRJyi0oUfcXSutbGx8Ruo9YDvf9iF1egyM3V3v/D3bHbXGpJKAKzZkShKKtz1jxL8Y9k0hBMacOjgBNMHdAghkNNAtkeAsxLxUAER2HjLcd0IhXphiiBuvfU+9PRkYRgWlOtCaw2tPY4oov2nbx9wSy177EW07OxGaUkcNSfMwznnHIr5c6sRME3AVPjT/f/GOy67Bdu3dw0y4/obyouP0FB21PDzJPyixmg4iB/+8J2YO6ccpmHiJz95EF/++p9BUgJMozxy7PNKKQhBePbfG9Df60JKoKo4h+JQD8qiLizSyPUp5NISJAgsJKAFiNzXzfoQIMBhRBKMPz1WhnsemoiKmAvXNcAklBBALt++sqOl6QWPlG88sPhmHc3Nz0oA7BQ671Aq7xEQ8UgmNtZKW8GSktLKQ+b5ziqxu/vqWgaAcLTqaCmjY7ppAbBSORTyqV8AUIcccpYFNKiiogU1ieIFt7IZcFlnhYCk0Sdj0G3BYM+MZwXyhD7gHcyNGx8slFed+O6S4oVv1yxs0rYlRiSAeQeWSGpDWpKYDdfJCsfOkFa2FCQMYRgCMNTAeSaW8LVnAgqGFCG3qHjWVxOJ+UvRcI/yYiL/wzEQoqUSgJ1L77hNK4dAptZgSNYIhSzc+JNqbGhOIBBWcF150KwQgoIggjAACI/1NZuxsOiQbpx9UisKhTB27OzG+z9wK7Zs7YQ0DAjhBbqllMjlNB555AWkM7lBLX6PLy48BerUU+bht7/6CP76p4/iN7/8EH7x0w/iTw0fw4++/x5MnZxEKBjF+q1tuO6jtyGdsQeDA6n+PJ56Zh0c10urVVqNcQ8BrRmlJVHc+qNrUFoSQzgcws9//k/c9KW/eJkkwqvpUEpDuRrMXn3HuvVt+NnPHoAVjiNk5nHi4h6oXBCuEmAtQNLwrHbyegR6i/L6pVo7WiMYVVizvQxf+9F0hMNBMBkgUiAItnWW0pn2XwzbP+PjTTo2bswpAOjq2vSPfL7dkRQ0hvtYvZZnjpZmBGGr+GzPatktYYIaGi5VACIB0zzNp/vdrdubENLI53pyfd3N9wHA4YfHXABmsmTWT4LBKkC5BDGShWdIPVMaBEVCkpSmkCIkpQhYUoRIE4IAkECiKJ6YeBOMoGbtGESjmByYWUhBtp0SvZ2vPNzZtvJD7S3PnNvV/Oyxu1qWX9XZtuKbqe4t24gdSSQ1WLDH+6L9mRCkdJYCoUqRLJ7+Y4Cprm4e/08DiB/8pLbWZ3+V69/RYggpmZTWTAgFCF29xbj+O9PQjyAsw4HSBw9CRrqCGCQYbobw2atbMGNOK3JOEV5cvROXXvZNfOPbf8Py5zdjzSvb8ec//xuXXvEdvO8DP0NHR2aElTHmnfyskMMOm4ELzluMkuIYmDU0u4hGAzjjjEX44+8+hQVzp8EMSqxc2Yxf3vEoBkzhxsYmnH7mTfjwdb9AZ1caUhhQiscEKqUUpk8txa23vheGYSAST+Dnv3wEX6y7G4WChmFISCkgDQlBBv7xz1W46j3fRzbtIp0hnHFcKw6fk4KdUxBS+dPEI9h6X0/novYJE/sLYVz/ncnoycUQsJyBfutaCimzqZ0721uf/KN34/Hg+Zt7lHNtba3M51uaHaf7ARCgIQbXlIlB2iRBJmSg5BQAaFy2bNSa1wqAkSxbeLhpJScxO3qI/HEACEgRBNtO7z9yuQ3NM2deF2hoaFAVFcd9IBafNldr192Neh6egiQhtBBhobUr85mOXH/vji39qS3PZPrWrcz0beyU5G4FgOjUo64Jh6dWa13QtNv9NZOwqL+/JbWr9Znztm790+ktLY/8pLNz+f3t3cuf6ep48rctOx/+7JZNf1jY2bn8k7bdJSAMKHJ5aC40iEiyCxWNT5tXVrb4bfX19fp/1QoxhkC+xgAaU+nUtm9EotW3gEwFKOEqgZK4wvKmCfjCdxzc/Pm1EGkFzRKCNA52IgIR4ChGSSiDO25ci+u/pfHUixVQvQI/+9mD+M2vl0FIA/l8DmADRUVF0PBqPHZ/NL+nt+bBfiCaFaDYo1MRAMEAM6BcF8XJEG7+zttxyaXfQ7fK4k9/eRZXXVWDRCKM446djTPPOBq/b/g3dja34wffey9mzij3iwZHKl5SEpSrcMTCKfjhD96FD1z7MyRLYrjz94144cWt+L/2zj3OzrK699/1PO+7r7P33CcJ5EJCwiUILQIWL2ViWwXBY2119LS14hVv7bGtVvux1iFWq1ZPe6yiVo+gR1utgwrSUkTRDIqAEO4kQK7kNpPJ3Gf29X2fZ50/3j2TmZDEiIQWMuvzmcx8dmbPft+9n2etZ/1+a/3WxRefzZIlbQwfmOYn/Q/x87u3EmSylEppzls7yIeu2E5c1dlxv8eLq26Ml8eIQ9Ihf/HR1Tz0SCftbUrstJF9hd7FlaBc3nUlMNFYNwviic9wa5Rgu3pp5FtxU+kVYoM5y8wjIkbVEaabz2htXbJ8TGTeKNzu7iHp74dcbslFYdiB19gLcx24YgjExRUpl/Z9E6C5ueYBky+e9AZsk6oviTwhi1aQwKuvm+mxLRtL5eF/mBx77LZqdXA/Bxshm5O1SFM61fUnGKv4+AnZj5WUVqvD5f2DD/xuaeL+DT0937JDfVdJPzNFAUPS3Q233nrr5L7dt/5DLaqUFy+64DPWthhN8PvketQCkZpUC9mm5e/kwMZre3vX6vr1J2wGAtAf09tr9u+/43Ol6V0PiUkFqsYJjjiGjjbH9368hI98fjWpokG8x6t9WurYrIVazbK0qcI1f/sYf3PFYyw/eQKbaaFUzTJRNkQ0U2zNMjI+xob+zcnJP3YNGEsb5w9tjLlNtKSSUbIWEwQN2RSZDVpBaIljx8oVHfzuy8+jVqszsH+KBx7YCUB7exOf+/SbeP5vrOSOjbt4w1v+kfsf2J00BLr4ECefZBdx7Fh30Zm8593/g6nxEq3tLWzeso9Pfurf+Yv3fpW/+/i1/PTnO3CmhVJZufSi3fzz326mOVvFxQpHINyfsgCigqgjLKRZ/9mV3Ny/gpaOGBcnjZWq4oy1QWly58P7B+74f729vWYheDxbLMkipwcevKleHhmzEsxR5DQgKqpxnE61NKWzp784ebx71n9sSDISE4bZVxpjEPVzRpYJ4L0hZau14X0HBh+9GXrNxo1fjNrazrwgle44F41VOCT7UAOIc75iDhy49592bPvOBUMDt/5rtTr4OEg14d4EkAlAOjqee24u3blUNVKZ69tUQK0TxUyN7fhSaeL+DatXX5Lu63uN66c/Tvi7Pgf9cX9/wgmfd94V4cjgXV+YGB+8MSFWJZ7N9hN1V4t3pDMtv5HNti1NshDMCRxAgPWbBHDjo1s/6Gr7MaQUFWLj0VjpbAu55rvL+eg1K8i2WKzW8b+oI/wp8WyCWKUWCyYu8bZX7+Tbn7qLqz6wkb96y6P85eu38TfvfITAlEml2/jS52/k/gcfJwwDRHyiFus9RgzGGO65dzvTUzXkCYd5eQLMpapc8Lw1pFOGajVi2/b9CUcQ1Vi0uJmrPn0FZ5zazo6dZd58xee5Y+NWrA0Sp/uEQGjx3nPZZRfQ2ZYnqtQoZPOkMs2YVJFMupVCc8jzztrH//nAQ/zTXz9Kl61Si2yj+uv4Qa1eFaMxmWLIR7+4jK/esJLWrjq+nkbUolJPhoJVxpic2PFuIFqfrJcFe3aY9vT02CmmRurR2PdERRVx8w8YijEhqXThlYD09MyW8xoR0XR6xfJUquUcj4M5wUAS9sMjkdYqQ/0wOrl69WgIkGta+pIwXZQkY7HzMg8FJxLaydEtNwzu+fG7e3tVkowXAzPNh8p55z03BDTT1HZpkMoljVbz97IaY2yluq88MbHz6rVre1KpVEG7u3uDI3zZ4eGaXbu2JzU9te/bLp4kaXue7x5UvU+lC7li66pzDw2oJxqENZPIup6eHtvX13d9Jtv1vc7F7a+IHbEggeKpUaezNeRLXzsd9Za/ecsOqhMO5wzW6HFvAkh474DyuJIP6lx8wRBcuD8pwMgrlUnPx645g+mwyuVv/gzveselvPqVF9DaWgBgarrKF774Q/7hH7/NV655Dxf/znOSjOQIg0+kMQmwo6NIJp1mvFKmWo0b3EaIc441q7v4p0+/mbe89fOMjla44m1f4HOfvYIXXXgaLnaJkm5jQzinBIFhfKJKJarifI72/Dgf+dPdTJY9xQysWjbB6mVVQlOjVLJAQIjDH6/MQxTnDYE4gmKO3i8s5cvfWkVnh+KjAJEaXgTFxkZMUJ7edtXIyL23NNbJAvfx7IOxqFcH/yWKT7nc2IyZ16ONWhWwYdtvQbG1r69vNIkPSfluS8tJL06FnWn1PhZMcLBySsEYU4+mpDI9+HVAUqlBBbBB8UVi0qgrCZpmNmYlOYSp1UfrYxObPwgq69e/Rg6X8b785S93GzduxJji872EohJJMjlztlPEi4itlCfuL5UefXDTpkeP5e2YeZ1rOzpPvypfKDR57/Rgm76geG9tk7Gm7XeAG7q7Tzw16uCJi6hP6e01ez9+zZ+lcx0vKhSXt/i44WVVwCutnZ4vfWMVtWnhyj/ZgVSqVOM0QTKB+WAb83FyeISeWAPc9MEWIJnyvLVngG0HUvTdsIqmJuUjH7uWr339hzznzNVks4b7H9rFzu3DGJtnYHAEVT1ypZYKikPVsH9wjEqljrWWXD49L6NwseO8c1fxj//wRt75rv9LqQJXvOOf+efPvpnffOHaOVmDEARCtV7nY5/6Br7uKNeFC84b5bKLd8J04/cioVq11DVsDPRS3K80XPjoBFPslFQQ49IZ/vpTK/iXG0+hozNG46CRtRtU1QcmH0xNPbp1586b3t8IHguiic9SGGtgYMud+eKa3fnCsmXORR6jJnHISTlvNt1c6Oxcs/bAgY0/hR7T04P29UE233ppKshS11JSsXcwv/VWMqZSndw2PLx/AygPP0wkIukgTK8WPKgVnV+G7q21plKd2lEa3/FQQl8e9sAiDfgob4JgldCYAj9/zIPxPsKYYM2KU17+NWOCY3RQjjgmDGwqbJQkyyGYL2IsqUyhmDywjsOo+55YAQTwrN9kYdeOifFH35zJdHzXpgoRvmYEQ2yTLuquNsP/+95KRsaa+Lv3PUZzboL6VApSetx5ETOj7WPnfpYGU6vyyXc9zuqTI66+djm1Wgc7dlXYuv1BHDEhGVo7iripcW7/2Rbe8LruI/e1SLKARCy3/exhokjJZS2rVy9KCPrG2cZa0+A21vLxj/8hf/7nXyEmxTvfdTV/97E/5sUXnU4qSFGtV3nwwb185nM3cu9d24hsB8sXDfLu1+6lOuyI6hksyYAmI8ypgj9e76cQx0pTVhmt5vjzvz+VH/1kBW1ddXyURqg3XlnVmLSvR4NMjG96K1Dq68Oy0HX+rISxuru7g/7+/slKZfQH+cLyNymhFz1ISKuqD1PZIJ1vu4QD3NbdvVb6+tbHQDoIW5+vmGTywpxDpBJ41Jl67cBNMFA+77y3hSJfjIC8EduRnOJmxszNjmnwqBjv4vsA3/OaPtuXqAgfydKBTRVRfYIUnIoXL0qxdXWHxb5O5RgSZ7WzvsF7j/rDNuhK4/9PB9iw4UoncmIx6UeYOtTnoDsYGeq/Lp1q/ceORb/+50oQgw/wFsRRV6WtE264fRF73yd86v07OX3pEKUJizHBHF7kePgZPdxhmghLUK7yJz3beNkLx/j3HxW47cHFDA5nqLuAUxdNsW+8TK1WoL9/E7fdvpUXPn81URQTBHMJaiVynlSQ4uHNe/n3/7yfVNqw5tSTecGFp8+unUTQLYG66vUKr7jsfMrliPUf/hZOs7znL7/MiqUt5DJZSqU6e/aN4OOASAt0te/jqg9u5aTmaaqVLKkgRp8maR1V8E5panFseryFP/vE6TyyrZ2OriouSoNU0ZkYITYWonBidPMnRvbfvyFxMH0LxPmzNQfp71JAKtV934zqK99kUk1GnJkrjiaYFKlU+0uAD848r63tvO4w3XpSTMULgZkr3ihGbFQb95XSo9cAbNz46Ox/Gkk7nZOlz9vjTon89CjA0NDDR90czc3Nam2+0fznGwGg0QiIQbygEmlE5PC/6PwjzO+D0eBwW1MaVZ3GpIITdb2Yo6WzPT09dt+eH753amzbzdbYwONi0wBUFIVIWdIMm7Yv4g/fexo33raKfJtiiIgdGHwCBcnTg3YEavBBQGk8ZGXrKO/+4z18/cN38+2//znXfvIOvvbJe/irN25PxtwG8L73X81Dm/c0yPakMkuSOm9SgWXHzhH+7C+uplKNaS6EDA2N8YEP/Sv33LeTOE5mmxtrsYEhlcqiCjYVIGLJpOpEcYH7Hq1w731DbN5eZjpqQUPDb1+0h29/YgtnrxxhumqwVg867OMSbhXFYzQg9mDx5Ns81926jD9+z3PY/ngH7W0OH1mEGLBJtaIPYhEbjo1s/sm+Pf1XNk6nC7zHs9oSldnRofturVRG9xgJjKrzc+EgJdYgLJ5ZLK5d3d9/pQPI5he9IpUqiKqbR9cpeCOB1Gqjm4aHtzVUC+auoUPwpvmZA3FcaTjnDb/gupsPzr3GHIIsaALH+gDx1gjeCHqUL28E1/jSRJlD1aPJ99mfEW9UvRU5YffE0SKn9vX1qaqqSOF1a0z+x7mWU86KXOQsak3jo695R7EglGtF3v7RLG97qIl3v34rTWGZ6ekQaz3Wp/By/A+tKj5R+A2gFqfw4x5rPM3ZCKtKbbzObz8v4n9e2sbXvrcc62Nef/lneNtbL+GlF5/FyUtaEbHsHxzjBxvu54tfuJGx0RgreYZHPTYT841v3M5137mbM89YzK/92qksXd5OKhUwsG+Yu+/dwb13byedyzE+afi9l+ygVk+zb9jSlII1K8b47QsneMHZE/hajXI5IGX8cc88rBochqpWKGZDJqIUH/78cv7lOyvJ5lIUmjzuEBUUDy4Ig2BqYtP2XTt/+FoRqfb395sF6OrZD2M1OK5atTr8g4Jf+UaRwJMMS06wJe/iVKqpkM22Xjw5KVcBks7mzxUJQJ3M5UAF40Xrplw+cDPg1q1bFzAPitKjZAGK/FKEqp/33HkLWi1YIyIiRp8qsVFvCEIQyS4EkCN8IiJXGpg+sGfvjy9ZKi+9N9tycoePq04kEVsTBOcgnVIyQYbPfmcFP9+U5YNX7OKC5wxTn4yoeSG08rT6HhGfjOPVIJEJQYEsUVn54Nu3Ml0yXPejk8ip52Of/BZf+nKRk09qAwMDg6MM75/GpFsoVwNe9pu7OffsMn3Xt7F7qJWKU+5+YIif37ubwDgExTmLBFkkbKM0McUbXjXAR9+xDaKIchQSBDGp0EFkKE8r3lgC83T4Y6GujpSNyBZS/OyBdj76heXc91gnHa0O0Qh3CLyrqs4GWVue3D4+sue+HigPqC4M0jlhcpC+5Pt0afcXW+unvjFItZpE1aEhh6uK2Jxmsi0vA65qa1pxhrVNFzjvtVH+dBC+Emsr1UFfnt719QQi6z9OC34C9f4IQcmBBtTKgyURO5YIrBwjKnIUcWsFF9bSVuPyloUAckRL2vQrlb49IyN3XtYVPP+mdNOSVhfXnMFYbRwQvE8mgy1p8zy8rYs/+kATb/r9Qd7++3tpKY5TmQxQCcAqorPTvzjukvriGoimTaYBKmTrNf7PX27mrNPKfPW6LgYPdDIwHLFnYBgkJrBZAttBW26Md/7+Ad722q3k8xGvuqiZH9zZxoY7m3l0eysHpjPEUQDeEKY8xUKF01Y8zh+9dITLundRGTc4I4Ti8JGhXDKocVgJsao44zD6VJaOCyox2sB/NbYYdTQ1O8amc/zv/7uCq687Ce+zLG5T6q5xypspTFRw4IIgsLXp3WP7D9xzyWR52z0LU9hOuBDiGkOefl5rO/+uVLrjglidE0j2e7LAJEgXXwRIqrjiZZlsR6iqsczxKao4awJbr5V+NDGx9d5kvvh6dzw2/cTEBB1LItVG87s0GIpGDh4bJJga3/LBgYGffL7h955KSCRKDq1ywmXnwbEuKOixo6N9PxdJXdxhnntTLrOsLfJVd7B7NHnv4thQaIqJXI6rvn4y/T8r8o7L93Lp84cIohqlSjA7DVDl6SCNk9cwM8tJIFKLlB3vfNXj/O6LDnDL3QXue6SZkbEc4i3NLfs5a02N3/mNQVYtLVGdhPKopT03yesvneR1lwi7h9Ps2FtgfCyFj5V8c41TTopZuaREKogoTYVYm7zBnkTTK2kGNI1HeIqDR6Pg1weotygx+VydKLRc/5OT+czXV7B5exsdzQ4TOCL3xF3swQU2bStTe0dHDtx7yeTopruSxq0F0vxEs3XrrrRAXCqP/KipuPQCmT3Wa7KLvHPpbHtzoXDqhalM+3nGpvFxdLBNQhu5iq9SrQzcArBhwwbDUzxtOUmYVURkUjXeg9g2TSq47Az65VGsDQhSTatAar29H4oapb8L9vQEkJkg0h2MjPTfBfHFHR36/XTxpDYf150cIrbvnBAS0dlu2LKvkz/9cIHrX9DFO167m/NPH8XXHJWqx0gKMXrsOeNT5GaNgBJQHa+xuFjj9ZdN8/pLB3BxUqEUBICNiMspKqMGMQESOJyzlCaSGSBLCxErztkPRpkNE3WlWjWUFQLjUMycEHZcYWtAcBpgnSObn0bCZu7e1MJV31zOhjs7CdMhHZ11fGzRw4g+KupsaG11Yu/oyMC9F49M3nf3gs7ViWv9/esVoFLa8m+12kl/mcp2WfUNokySw0oYNJHOdb43sLnnegzg7MG6HMUYa6vlwdro8KP/1oCvjovTfs1r+hL4w0ePGHXneNB5PIyqUQNiM7/V0Ef5JbZlj6F7SOgHumfenMb37pmf+x0nKDf4S5af9ceNIHJ3Ja689GRe8I188ZQ1sa9G4jVMtJqS9zESQZylkK1DNuSW25dw28YWXvHifVz+e0OctWICao5K1eJFsMY33GCAaNxYpE+9653RifYmxpAhijy1mqDisJLMbq5WQTSNGI8EJpnFjMGIEljw4qk5g5YDVE0DJrMYBDVJFddxGyQ/F1/WRiOlC0Fq5HJ1TGB4aOdJXPOdk/mPDe1U4hxtLTEqVXw9Nac6ZYaTUhTiwKaD8sTju/cP3vV7E5OPbFwIHie8OXp7zcT69fe2d53fn8kGL441dgfVcr1VH5BvWvb7YaoZ9Q6RecX7TsSaann8rlptaHsDvjouAWRo6CoBqEyP7SoUomQW1Jz5PIIYp95nsp1nFIvLnrt+/YeP8XDUa2C9mw0Yh/YI9i8skidRv9wfQ48tT/RtHJjY9sLOU195c7Hl7F9XcbFqZGd00hN4RnEqgKO12RPHOb5142r+89YlXPbiAV536SDPWTkJ3lMtB3gcIgpGn3J4Z3ZhN5a4aTh+BIyZyXosghCIzsmEkrJAmfN8ISHpk3Tdz3PGDTlG9LilHQmH5NTiVQlNRKZQR02ah7a087X/XMR/9HdSKqUpFi1Z2yDJCUD8bO06KqiKYtQZEwQTo4/cu39gw2Xl8vBAg/NYCB4nuHVv2GD6wZdqA99pciteLMgslT4DmRabVyXyExoxf4KfVRdXpFTZdy3AzOTT45MtJZpclcref4/qZ7w3SDUbtM5BPsTita6ZbKdtbz/n45OTu18icmus2h0cMoqgsTl6TE8P9PWtd21dZ1yYSZ/UiRNl3q4W9Z507Mup4ey+7/L447UTMQt5kg0wCScyTd+B6W3XveSUU9ynC61r/lBMTr1WvWAM85qDkkotEUdbq6EeZ/jGDau44UdL+K3nj/EHl+zlvDMnyIceX4qpRBliG2PFzKPCnh47lteTY3zsKQff8BqDN+SCGGmKKdcz/PT+It/4/lJ+fGc7UzVLMZ+mvSUm8olO2ROvMxG8NyYjqpVgcuzBa3Zuu/E9wNgCYb5gBx1zAjmNjT56SzF/Sj2bXxImG/lwR7J5j6kxJqhU9o8MDz3+r42/dhzX1Czpf0dr21lbi5mWU51XP6PIq6KJjpePXbHlzN8+eXn1m3t33fIm6C/N3bu9vR8y69d/2EOf6+uD9q7z3t616NzP27AN8YfUuatibIrp0g4qex5YVIIhDjvm99lt5lf50JKjuQzv3HnDHw0duON91eqQBjZtGqVA8wLIjAuMfDIUqbPVYWyO6390Mq//wLlc/tdr+cbNyxio58m3OJpyEUZjfGxQl1B4c9kRwfOsq3lQmZd6awPG815wTrAakc968kVhXy3F1286hTd+4Bxe/zfn8R+3LiEIAjqLllDqRH6OKJ0elKpHQTWMgyAwtfqgjhy45307t934JkTGkvWwEDwWbNZ8b2+vqU8Pbq7VJn+G2ARO+EXLWMUhqtXayC0weKCnp+e4S9+sW7fOArVqZdcnvKsKZHziH5LERzQEvI2Nda0d579m5epX39XV1f2WLNmTQUNQm0BsWmhr+7XnLV3xsq8sXnTB58NUlwccJkyqT0zgMMYRBDWM0bhe/XSpVBp6Ou7xWZSBHFxgqEp3d6/t71//yenKyF2LWs+5ulhcs9KLUe+dqmBkDpuRlGAbagJiYtpbBOcD7n54CXfc38nJS5bx4ueNcMnzxzjn9DGKxRpESrUaNrrbE8hJGwOhnk2fmRqHJrMLENeYVxIo2VwdAstkOc2dDxT5/m2t/PjnXezZnydMGQr5pMLLOyHyOgcDJinnnYHXVL1ICowEk+Nbd4yMPvSmiZGHN3R39wb9/evd8YIYFuyZa+sblVOV8vjVxWJ9nRg52gIGiTGSkrhekanS4HcAmVH5Pc7ZUkxvrxlYv/4r6fzJb2tuOft8F2ss4hIf1xh+Z9RbEF9sOf3MXNMpX2ppXzUVu/qI12qcMoV9XlkdpPInpdJFkgKvyMih94j3YrNhaWrX+PjohvXJPZ6Y4qJPhYaL9vevj6E7KI30b9g+8ugFS5e/9CP5lhVvT6cXi4/jGKnbGXnARhFgYxaHNPB5R1MTCCmGJzJ87foi//afyzjtlBLrzhvmhRcMc/bKaQpNNfBKVBPiyDZk/2VWhuQZGzhUUAX1ghUhCGOCJg9GmJ5K89PNbfx0YzM/uauLRx8vUIsN2ZzS2qoIDudn3kfm9NfMfQGvQuCMDYN6bZTSxLav7Np10/uBIbq7g+TzW7AFO6xn9gBT449uaGlZWsrml+e91lUOOwVIQY1KgK2V9g+O7d9yS/Lg0yR/sx5A4gPDm95sw+a7coWTQo0iJ1h7EK5IKFrv695aq0F+UUEwheRxs1pRnMbqvPMGtU+4TYnUkPVxbSIYn9z0zomJiTF6eiwn6GiDp1AELCHX4dqRPbtufkdr5Zzr25rXfDpfWH0aksf7mkOckVmd2blOTkiaSGOyoZJrMeBSbNlhue+RFr707VNYvXKU31hb4YVnj7F2zRSL26cwYsF74roSx5a4Iepp0EQOBw7hUGbc65xKpqPe01xJBD0CxKnzILrkFeUQR66zwgyzwYKk/smKEgaeIFAIIEYZHMnx8P15br9vEXduyrFtRzPlWoZ0LiKf9xTEo87gvD+C0Ls0/rpXMN7YjMXXg9LE5sfGRne8f2Rk43XJ77zasiCM+Aw2OYb//5UP/76n51u2r+81u+vR5LVZo5fjxB3WdwioGqeqQbU6dT1MDzey2/hXu49jjiAeemxpvO+B8VTLa0PRb2dyq2zkKrHBB/PfDzGqivrGrGY1qKgmWlhWDrYmzDzHozhvJYNz08GBkXv/enjf3d+EEzd4PMUBBBr4ufT09Ji+vr6bxg488Nwly37nT5sKy96Tyy3uUA2INXaCs4YGNi+HBBI1eE3grWxeaWpSnBO27OjioUcsX/1emUXtddauHufcMyf49dU1Vi2forO1TMYC6iEKiCLwHpwXPAajghFN9LJkpkdDGuNLGg5+Xo3F/AAw9/uhv6cHdTln4SLV5Bc9QsLm+QQ6tRCGQOBBLD4yDIxn2bqrwP1bs9y3qZVHtrUwOGKJXYZMxpPNOvJNtST4eMsMnScaHEaOXkEVxToxoTXibLm8d2pqcufnBvf8+CPA9EFRxAW+45mQoB7V9erReEydXQ/z9tkvWeHY13eVAFKt7Lu2UF95udisQPxEx68ejJioXvaTk3u/C0h//6ajXH8zKh4/sy/n7jEEo+ZJhJakwGdkqO86jScvaemsfrlQXLNMnVWvkUfUJACIBw1QMYKooDOHsQbNozP9Lj45iGngApsL6rVhxoe3vn9o4Kd/vzBU7SkPIMlnn7ypPRauLQ3s/uHHyfHVUxZf8oFMdtlbM9mutHpRr+IhNnMArdlFb2b9oMzqDeRzMYV8jPMB49MhP76jmR/81JHKxCxqrbFq6RSnrSxz5qoSpy2dYklnRKHJkQvrYGuJFlwkODV4B845HILxiZihU9NYNDJ/8x3DqS4JE4qapFfEWo9YkoFQgU+aDV1IrZ5mbFoY2JXlsT1NbN5R4JGdIbt2NzE0mqVSSxOGnnRaKBYUY2p4pUGimydmTfJEqEqxHivGSGCj8mitPL372oGB29fX68NbZrKOBTn2Z1D0cGLBOiM21rkV4yJOMGqMKR3+iSJALCJxMqNjzro2oiBy7NIbSaPc/n2b7ywW1kzkC6sKzqmTQxJtb5wLTM5Wqo8/Mjl2z82NC3W/IPeIRU0sIoo/SDeIBHGi5ftkSM5Z5YwfjI4+cv4pqy6+MpNb+rZM5iTrklkGTnGAF9E5dTkcPDUqXkUDbxBjrBr1BKXxnXvHpu5/x8j+B27o7u4O+voW9tFx1LFPshF6egx9fQM7t9/0p7nmFV/ubDv3r3LZztems4usEwHv4kQRmaN23nkvswxvKoB0McIAsTeMTBbYe3+eDRuTTCPfVKG1WOakzogVS8osX1Rj+aKYJZ1lCq1lWvPQkvKE6RibUiyanDrwjcg1Iw4lPGFUwdzMRGZOcxaHxUfgqpbhqmWsApOjWQaHm9i5P+DxwZDHB3LsO5BhYiJDqZzGowRWSKcs6VydfFOE4nFqk8zJHcv5S5OEQ4wzNgwsxtYqQ0yVh64fH9105cTElvsAGjitX8g6nmEgVaBjULPeq50tRQTwGmAEa4OdcFB6hIMATR0IFB8IOgd99ajUwXi8dfZY41jjtH2gUh27LpePLleNDqngVfAYr5NUK0PXAtrdvS7o7z+a5pSK9/UOAUlQgLlDqGoBYvC4X6nVAPqGdm7//juL7auubmtZ+4FUquPlqWxbaE2uAR80ppGoegQzw+2oiIg3xkeTlCsTOyulfV/bvfvmzwJD0LNwCHuKwcdf+DoNWCuZHdC+6vyu4pn/K5056Q8y+c7AqMVpPUadAURF5IjYviYnft8ocTUIIg4zo6+F4uKAKDZEMdQjxavHWEc68GTSSmshoiUfkS/UaSnEtDbFtDRFFLIxqTSk0koYxlibVDeJ8ckQptgSO6jHhqhuqVeF6bJlfDpkfDpgZDpgeirF1HSK8amASs1Q9wbnLBYhDIUwgDDwWOsQEVST60MtqjN37UDMLHNyWGhCZzCDUI0JLBJRKY+4WnnwuunRxz4+Mvno3Unc6LF9fX2NKTsL9kzbm+3tL2gK0sHLYh8tE7w2QkFDqCHwzvODsf23PcwhRN3y5S9qjZy9XFVs8tEb5qYg4Mr16t5/GR3dOsmx9S8IoLnc2sWtHaeuTcoED+kBkVDRKalM33/36OjosfzdoGvJhW8wNteMjw/RMDIqEvi4Xr7hwIGfbePJ91jM8z1hfunZHe1nPi8b5i/BZC4wYbrTGJuB0Ig6QEtRVMH5aKt3UX+lMvD94cE7bwWmkz+30Cf1XxFAZldFT8+3pK/vNQ4gn192Vmv7GW/JZrv+ZyZ78mITZvE+Bu9icCapR5UndVfSUJkVmeFWBPWC8+C84mKLd5KMq2xkOAlx4RHxqJnZcDPioYkco2ji9Gf6cY0kw2tEFCNBMv/EOqwVxAjGeIzMZgoNAl2eZPWxoooXjBdjLCYQ76rUK4MHquWh7w4f2PzP5fKuewAa0hEsBI4FW7DE9/T29nKInEoWci1NTZ3NqsESVTcKpf3l8gEBBuY6lJ6eV9tGqe7CPJz/wgDSsF7T28vcD7Ozo+sFrysUFr82nS0+L51aLJgQ1QhVH6P65INJko823L0eZFyMaxB3M012cw9wM5lOktHILDdykOCT2f4KmZMRJCC1+hmB4pmqLI48e/0XX3wj7BgvYmxSxeap1QepVibvqZaHvjS47yffSVLrmcABSUXKgj079mj3UaCmfn+EQ4LQfZTnPXkRQIGeX8DC/zKOtjuYFSk87HUe8f6edCChu9v0dL1L+/pe6450mSLCRRd9KEiKABYCx3+zAHLww+zu7jb9/QdFzZqb1/x6U8uqV2bSHa8K04XnpNLNICHqnap616iWsI36KZJ5JJ5EVf4okM/c29WZAt8E/pJGc4pysFpFn5i9zz5fZiABleTn2YRipoHPHxKUjvZWywwpiqifDVmAVxEVsYFIMmo2qo9Tq05uqVYP3DA5te/aqbGHbp/5KwtQ1YIt2JP2fwI9An2HVs4sBI3/5gFk3ilLdYObUxkStLWdfX62sPxV2VTruiBMn59KtyM2i0qM907RROIMYoOI+e9zO8cOSYFD1XjBqhfUiFgRI4JFfY16dZw4Kj9YjQ78sDo9cv3w8N13AeXGMQn01XbhhLRgC7ZgJ3IAOUxWcms81ycWi6efny8uvjCTbXuRlfy6MF1YFIZFxNqEgCZGvXck+gMkdRQcov3/X3W7c0q3ku4+TWRYjBgJrEiSSamLiaMp6rXJsdhVbqvWRjdUprbdMjHx+H3zkYmLgv7+dX4BplqwBVuwhQByxGvrle7uDab/1lvniDMC0NzSceY5udziC23Y+tzAZs4Pg+zqVKqIsSmMSSUK00n3aBJSVPzBMl1EDw54BmR2TsgvpdCocyAq0RmSfUbXXWeaCyX5pzFKISHj1dfxvkIUTeHi8pZ6VH3YxdP3VacHbh8dfXgjMPLEoNG1gMcu2IIt2EIA+eWt19C9wfR0delhuj+DXG712Zl856nZXPG0MMyuFEmdFdj0qdbk8hKk8yYIEQkQDBbFS4MD0TmqtfM8sx7FTx+cNJgQ8TPPNbP1WjPspGqMj+p4X6urq47HrrbNET0c18s76uXxx0r1fVvLE48/xCEzmnt7e836DRvMcSARF2zBFmzBTrQAcuh195ju7iGBdfT3fzg+grNvKxaXtYaZrrNTYWG5iKwNw1yLEp5lg0wTyCmhyWBsCmxAQlYbBDujFcKcIWtJ+a4CahLIDI8jAudQFxO5KoLu9HFtWokfjqOpcVXdVI/Ku6qlgS2l0u4BYPRwt9PT8292aOgqWcgyFmzBFuyZYv8f3/Q8ejdUtssAAAAASUVORK5CYII=" style="height:60px;width:auto;display:block;object-fit:contain">`;;;;;;;;

        const logoShopee = `<img src="data:image/png;base64,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" style="height:60px;width:auto;display:block;object-fit:contain">`;;;;;;;

        const logo = isTrafego
            ? `<div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:22px;
                color:${d.balcao ? "#1a1a1a" : "#4fc3f7"};letter-spacing:4px">${d.balcao ? "BALCÃO" : "TRÁFEGO"}</div>`
            : (isML ? logoML : logoShopee);

        // Grid de imagens — todas embutidas como base64, nunca vaza da área
        const bannerHTML = (() => {
            const imgs = d.imagens || [];
            if (imgs.length === 0) return `
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
    height:100%;color:#ccc;gap:8px">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
    </svg>
    <span style="font-family:Arial;font-size:12px">Sem imagem</span>
</div>`;
            const n    = imgs.length;
            const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
            const rows = Math.ceil(n / cols);
            return `<div style="
                position:absolute;inset:0;
                display:grid;
                grid-template-columns:repeat(${cols},1fr);
                grid-template-rows:repeat(${rows},1fr);
                gap:2px;padding:4px;box-sizing:border-box">
                ${imgs.map(src => `
                <div style="overflow:hidden;display:flex;align-items:center;
                    justify-content:center;min-width:0;min-height:0">
                    <img src="${src}" style="max-width:100%;max-height:100%;
                        object-fit:contain;display:block">
                </div>`).join("")}
            </div>`;
        })();

        // Tarja 2 metros


        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Croqui — ${d.nome}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,900;1,700;1,900&family=Oswald:wght@700&display=swap');
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    background: #ccc;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
    padding: 20px;
    font-family: 'Barlow Condensed', sans-serif;
}

.folha {
    background: #fff;
    width: 210mm;
    height: 297mm;
    padding: 4mm 6mm;
    display: flex;
    flex-direction: column;
    gap: 3px;
    box-shadow: 0 6px 32px rgba(0,0,0,0.3);
    overflow: hidden;
}

/* CABEÇALHO */
.cabecalho {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
}
.cab-esq {
    background: ${corCab};
    color: ${corCabTxt};
    padding: 5px 12px;
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
}
.cab-linha1 {
    display: flex;
    align-items: center;
    gap: 10px;
}
.cab-designer-rotulo {
    color: ${isML ? (is2m ? "#333" : "#555") : "rgba(255,255,255,0.6)"};
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 1px;
    white-space: nowrap;
}
.cab-designer-valor {
    font-weight: 700;
    font-size: 15px;
    line-height: 1.2;
}
.cab-separador {
    color: ${isML ? "#999" : "rgba(255,255,255,0.4)"};
    font-size: 11px;
}
.cab-data {
    font-size: 13px;
    font-weight: 700;
    opacity: 0.85;
    white-space: nowrap;
}
.cab-venda {
    font-size: 13px;
    font-weight: 700;
    opacity: 0.9;
    letter-spacing: 0.5px;
}
.cab-pasta {
    background: ${corCab};
    color: ${corCabTxt};
    padding: 5px 10px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Oswald', sans-serif;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: 3px;
    text-transform: uppercase;
}

/* NOME CLIENTE */
.cliente-bar {
    background: ${corCliente};
    border-radius: 5px;
    padding: 5px 14px;
    font-family: 'Oswald', sans-serif;
    font-weight: 700;
    font-size: 20px;
    color: #fff;
    text-align: center;
    letter-spacing: 1px;
}

/* QTD + LIBERADO */
.linha-info {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
}
.celula-info {
    border: 2px solid #1a1a1a;
    border-radius: 5px;
    padding: 4px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
}
.ci-label {
    font-weight: 900;
    font-style: italic;
    font-size: 20px;
    color: #1a1a1a;
    white-space: nowrap;
}
.ci-valor {
    font-size: 20px;
    font-weight: 700;
    background: #f0f0f0;
    border: 1.5px solid #ccc;
    border-radius: 3px;
    padding: 2px 14px;
    min-width: 80px;
    text-align: center;
    color: #222;
}

/* ESPECIFICAÇÃO */
.linha-spec {
    border: 2px solid #1a1a1a;
    border-radius: 5px;
    padding: 4px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
}
.spec-label {
    font-weight: 900;
    font-style: italic;
    font-size: 24px;
    color: #1a1a1a;
    white-space: nowrap;
}
.spec-valor {
    font-size: 24px;
    font-weight: 700;
    background: #f0f0f0;
    border: 1.5px solid #ccc;
    border-radius: 3px;
    padding: 2px 20px;
    color: #222;
}

/* ÁREA BANNER */
.banner-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: ${d.doisMetros ? "725px" : "750px"};
    overflow: hidden;
    gap: 2px;
}
.banner-area {
    flex: 1;
    border: 2px dashed #bbb;
    border-radius: 6px;
    background: #fafafa;
    position: relative;
    overflow: hidden;
    min-height: 0;
}

/* RODAPÉ */
.rodape {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 4px;
    flex-shrink: 0;
    gap: 6px;
}
.data-entrega-box {
    background: ${corData};
    border-radius: 6px;
    padding: 4px 14px;
    text-align: center;
    min-width: 130px;
}
.de-label {
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 2px;
    color: ${corDataTxt};
    opacity: 0.8;
}
.de-valor {
    font-family: 'Oswald', sans-serif;
    font-weight: 800;
    font-size: 40px;
    color: ${corDataTxt};
    line-height: 1;
    letter-spacing: 1px;
}

/* TARJA 2M */
.tarja-2m {
    background: ${corTarja};
    color: ${corTarjaTxt};
    text-align: center;
    padding: 20px 0;
    font-weight: 900;
    font-size: 52px;
    font-style: italic;
    letter-spacing: 8px;
    flex-shrink: 0;
    border-radius: 4px;
    margin: 2px 0;
}

@media print {
    body  { background: none; padding: 0; }
    .folha { box-shadow: none; }
}

/* Forçar impressão de cores de fundo em todos os navegadores */
* {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
}
</style>
</head>
<body>
<div class="folha">

    <div class="cabecalho">
        <div class="cab-esq">
            <div class="cab-linha1">
                <span class="cab-designer-rotulo">DESIGN:</span>
                <span class="cab-designer-valor">${d.designer.toUpperCase()}</span>
                ${d.dataPedido ? `<span class="cab-separador">·</span><span class="cab-data">${d.dataPedido}</span>` : ""}
            </div>
            <span class="cab-venda">Venda: ${d.numeroPedido || "—"}</span>
        </div>
        <div class="cab-pasta">PASTA DO CLIENTE</div>
    </div>

    <div class="cliente-bar">${d.nome}</div>

    <div class="linha-info">
        <div class="celula-info">
            <span class="ci-label">QUANTIDADE:</span>
            <span class="ci-valor">${d.qtd}</span>
        </div>
        <div class="celula-info">
            <span class="ci-label">LIBERADO:</span>
            <span class="ci-valor">${d.liberado}</span>
        </div>
    </div>

    <div class="linha-spec">
        <span class="spec-label">ESPECIFICAÇÃO:</span>
        <span class="spec-valor">${d.spec}</span>
    </div>

    <div class="banner-wrap">
        ${isTrafego ? `<div style="
            font-family:'Oswald',sans-serif;font-weight:900;font-size:52px;
            color:${d.balcao ? "#1a1a1a" : "#4fc3f7"};letter-spacing:6px;padding:4px 10px;
            text-align:left;line-height:1;flex-shrink:0">${d.balcao ? "BALCÃO" : "TRÁFEGO"}</div>` : ""}
        <div class="banner-area">${bannerHTML}</div>
        ${d.doisMetros ? `<div class="tarja-2m">${txtTarja}</div>` : ""}
    </div>

    <div class="rodape">
        <div>${logo}</div>
        ${d.sedex ? `<div style="
            background:#1a1a1a;color:#fff;border-radius:6px;
            padding:6px 12px;text-align:center;width:150px;flex-shrink:0">
            <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:18px;letter-spacing:2px">SEDEX</div>
            ${d.sedexMotivo ? `<div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;opacity:0.85;margin-top:1px;word-break:break-word">${d.sedexMotivo}</div>` : ""}
        </div>` : ""}
        <div class="data-entrega-box">
            <div class="de-label">DATA ENTREGA</div>
            <div class="de-valor">${d.entrega || "—"}</div>
        </div>
    </div>

</div>
</body>
</html>`;

        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 15000);
    }

    // =========================
    // GERENCIAR DESIGNERS
    // =========================

    function abrirGerenciarDesigners() {
        if (document.getElementById("overlay-designers")) return;

        const overlay = document.createElement("div");
        overlay.id = "overlay-designers";
        Object.assign(overlay.style, {
            position: "fixed", inset: "0", background: "rgba(0,0,0,0.78)",
            zIndex: "9999999", display: "flex", alignItems: "center", justifyContent: "center"
        });

        overlay.innerHTML = `
<div style="background:#111;border:1px solid #333;border-radius:14px;padding:28px 32px;
    min-width:320px;max-width:380px;width:90%;color:#fff;font-family:'IBM Plex Mono',monospace;
    box-shadow:0 16px 48px rgba(0,0,0,0.8)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h2 style="font-size:1rem;letter-spacing:2px;color:#f9a825">👤 DESIGNERS</h2>
        <button id="fechar-designers" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div id="lista-designers" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;min-height:40px"></div>
    <div style="display:flex;gap:8px">
        <input id="novo-designer" type="text" placeholder="Nome do designer..."
            style="flex:1;background:#1e1e1e;border:1px solid #444;border-radius:8px;
            padding:9px 12px;color:#fff;font-family:inherit;font-size:13px">
        <button id="btn-add-designer"
            style="background:#1565c0;color:#fff;border:none;border-radius:8px;
            padding:9px 16px;cursor:pointer;font-weight:bold;font-size:13px;font-family:inherit">
            + Add
        </button>
    </div>
</div>`;

        document.body.appendChild(overlay);

        const renderLista = () => {
            const lista = document.getElementById("lista-designers");
            const ds    = getDesigners();
            if (ds.length === 0) {
                lista.innerHTML = `<p style="color:#555;font-size:12px">Nenhum designer cadastrado ainda.</p>`;
                return;
            }
            lista.innerHTML = ds.map((d, i) => `
<div style="display:flex;justify-content:space-between;align-items:center;
    background:#1e1e1e;border:1px solid #333;border-radius:8px;padding:9px 14px">
    <span style="font-size:13px">${d}</span>
    <button data-i="${i}" style="background:#b71c1c;color:#fff;border:none;border-radius:4px;
        padding:3px 8px;cursor:pointer;font-size:11px">✕</button>
</div>`).join("");

            lista.querySelectorAll("button[data-i]").forEach(btn => {
                btn.onclick = () => {
                    const ds = getDesigners();
                    ds.splice(parseInt(btn.dataset.i), 1);
                    saveDesigners(ds);
                    renderLista();
                };
            });
        };

        renderLista();

        const adicionar = () => {
            const input = document.getElementById("novo-designer");
            const nome  = input.value.trim();
            if (!nome) return;
            const ds = getDesigners();
            if (!ds.includes(nome)) { ds.push(nome); saveDesigners(ds); }
            input.value = "";
            renderLista();
        };

        document.getElementById("fechar-designers").onclick = () => overlay.remove();
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        document.getElementById("btn-add-designer").onclick = adicionar;
        document.getElementById("novo-designer").onkeydown = e => { if (e.key === "Enter") adicionar(); };
    }

    // =========================
    // INIT
    // =========================

    setInterval(criarBotoes, 1500);

})();