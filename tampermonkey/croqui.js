// ==UserScript==
// @name         Trello — Gerador de Croqui
// @namespace    empresa-croqui
// @version      3.5
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
        return document.title.toLowerCase().includes("shopee") ? "shopee" : "ml";
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

    async function getDadosCard() {
        if (!getKey() || !getToken()) {
            alert("⚠️ Credenciais não encontradas. Use o script principal (⚙️) para cadastrá-las primeiro.");
            return null;
        }
        const shortLink = getShortLink();
        if (!shortLink) return { nome: "", dataEntrega: "", plataforma: detectarPlataforma() };
        try {
            const card = await apiGet(`/cards/${shortLink}?fields=name,due`);
            let dataEntrega = "";
            if (card.due) {
                const d = new Date(card.due);
                dataEntrega = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString("pt-BR");
            }
            return { nome: (card.name || "").trim(), dataEntrega, plataforma: detectarPlataforma() };
        } catch {
            return { nome: "", dataEntrega: "", plataforma: detectarPlataforma() };
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
        btnCroqui.title = "Gerar Croqui (Alt+C) — v3.4";
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

        const designerOptions = designers.length > 0
            ? designers.map(d => `<option value="${d}">${d}</option>`).join("")
            : `<option value="">— cadastre via botão 👤 —</option>`;

        const specOptions = SPECS_BASE.map(s => `<option value="${s}">${s}</option>`).join("")
            + `<option value="__outro">Outro (digitar)...</option>`;

        overlay.innerHTML = `
<div style="background:#111;border:1px solid #333;border-radius:14px;padding:28px 32px;
    min-width:360px;max-width:440px;width:90%;color:#fff;font-family:'IBM Plex Mono',monospace;
    box-shadow:0 16px 48px rgba(0,0,0,0.8);margin:auto">

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px">
        <h2 style="font-size:1rem;letter-spacing:2px;color:#f9a825">📄 GERAR CROQUI</h2>
        <button id="fechar-croqui" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer">✕</button>
    </div>

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
                <input id="cq-qtd" type="number" value="1" min="1"
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
                    style="flex:1;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                    padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;display:none">
            </div>
        </div>

        <div>
            <label style="font-size:11px;color:#888;letter-spacing:1px">PLATAFORMA</label>
            <select id="cq-plat"
                style="width:100%;background:#1e1e1e;border:1px solid #444;border-radius:8px;
                padding:9px 12px;color:#fff;font-family:inherit;font-size:13px;margin-top:4px">
                <option value="ml"     ${dados.plataforma === "ml"     ? "selected" : ""}>Mercado Livre</option>
                <option value="shopee" ${dados.plataforma === "shopee" ? "selected" : ""}>Shopee</option>
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
            <input type="checkbox" id="cq-2m" style="width:16px;height:16px;cursor:pointer;accent-color:#f9a825">
            <label for="cq-2m" style="font-size:13px;color:#ddd;cursor:pointer;user-select:none">
                Banner 2 Metros
            </label>
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
                sedex:      document.getElementById("cq-sedex").checked,
                sedexMotivo: document.getElementById("cq-sedex-motivo").value.trim(),
                imagens:   _imagens
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
        const is2m      = d.doisMetros;

        // Cores por combinação plataforma + modelo
        // ML 2,80m    → amarelo (#FFD600) cabeçalho + azul cliente
        // ML 2m       → verde  (#00ff01) cabeçalho + preto cliente
        // Shopee 2,80m → vermelho (#c0392b) cabeçalho + preto cliente
        // Shopee 2m   → roxo  (#ff00fe) cabeçalho + preto cliente

        let corCab, corCabTxt, corCliente, corData, corDataTxt;

        if (isML && !is2m) {
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
        const corTarjaTxt = isML ? "#00ff01" : "#ff00fe";
        const txtTarja    = "MODELO 2mts";

        // Logos SVG inline — sem dependência externa
        const logoML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 60" style="height:56px;display:block">
  <rect width="220" height="60" rx="8" fill="#FFE600"/>
  <ellipse cx="38" cy="30" rx="20" ry="20" fill="none" stroke="#2d3277" stroke-width="3"/>
  <path d="M22 30 Q27 20 38 30 Q49 40 54 30" fill="none" stroke="#2d3277" stroke-width="3.5" stroke-linecap="round"/>
  <text x="130" y="22" font-family="Arial Black,Arial" font-weight="900" font-size="14" fill="#2d3277" text-anchor="middle">mercado</text>
  <text x="130" y="42" font-family="Arial Black,Arial" font-weight="900" font-size="14" fill="#2d3277" text-anchor="middle">livre</text>
</svg>`;

        const logoShopee = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 60" style="height:56px;display:block">
  <rect width="220" height="60" rx="8" fill="#EE4D2D"/>
  <path d="M 28,10 C 28,6 31,4 35,4 C 39,4 42,6 42,10 C 42,10 44,9 46,10 C 48,11 48,13 46,14 L 24,14 C 22,13 22,11 24,10 C 26,9 28,10 28,10 Z" fill="#fff" opacity="0.9"/>
  <rect x="22" y="15" width="26" height="30" rx="3" fill="#fff" opacity="0.15"/>
  <text x="22" y="28" font-family="Arial Black,Arial" font-weight="900" font-size="11" fill="#fff">shopee</text>
  <text x="60" y="38" font-family="Arial Black,Arial" font-weight="900" font-size="22" fill="#fff" text-anchor="start">shopee</text>
</svg>`;

        const logo = isML ? logoML : logoShopee;

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
.cab-design {
    background: ${corCab};
    color: ${corCabTxt};
    padding: 6px 14px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.cab-design .rotulo {
    color: ${isML ? (is2m ? "#444" : "#555") : "#ffd7d0"};
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 1px;
}
.cab-design .valor {
    font-weight: 700;
    font-size: 16px;
}
.cab-pasta {
    background: ${corCab};
    color: ${corCabTxt};
    padding: 6px 14px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Oswald', sans-serif;
    font-weight: 700;
    font-size: 22px;
    letter-spacing: 4px;
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
</style>
</head>
<body>
<div class="folha">

    <div class="cabecalho">
        <div class="cab-design">
            <span class="rotulo">DESIGN:</span>
            <span class="valor">${d.designer.toUpperCase()}</span>
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
        <div class="banner-area">${bannerHTML}</div>
        ${d.doisMetros ? `<div class="tarja-2m">${txtTarja}</div>` : ""}
    </div>

    <div class="rodape">
        <div>${logo}</div>
        ${d.sedex ? `<div style="
            background:#1a1a1a;color:#fff;border-radius:6px;
            padding:8px 20px;text-align:center;min-width:160px">
            <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:22px;letter-spacing:3px">SEDEX</div>
            ${d.sedexMotivo ? `<div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:600;opacity:0.85;margin-top:2px">${d.sedexMotivo}</div>` : ""}
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