// ==UserScript==
// @name         ML — Painel de Atendimento
// @namespace    empresa-ml-chat
// @version      3.3
// @description  Painel de ações no chat do cliente ML
// @match        https://www.mercadolivre.com.br/vendas/*/mensagens*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/refs/heads/main/tampermonkey/ml-chat.js
// @downloadURL  https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/refs/heads/main/tampermonkey/ml-chat.js
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // ⚙️ CONFIGURAÇÃO — edite aqui sem precisar mexer no resto
    // ============================================================

    const BOARD_ID = "oCfs01Yk";

    // Listas de destino fixas
    const LISTA_EXPORTANDO      = "EXPORTANDO!";
    const LISTA_EXPORTADO       = "EXPORTADO";
    const LISTA_DESENVOLVIMENTO = "EM DESENVOLVIMENTO";
    const LISTA_ACOES           = "AÇÕES";
    const LISTA_FALTA_INFO      = "FALTA INFORMAÇÕES";
    const LISTA_RECLAMACOES     = "PROBLEMAS/RECLAMAÇÕES";
    const LISTA_AGUARDANDO      = "AGUARDANDO APROVAÇÃO";
    const LISTA_AGUARDANDO_ALT  = "AGUARDANDO APROVAÇÃO DA ALTERAÇÃO";
    const LISTA_CORRECAO        = "CORREÇÃO";
    const LISTA_CONFERINDO      = "CONFERINDO";       // v3.2
    const LISTA_FINALIZADO      = "FINALIZADO";        // v3.2

    // Nomes das etiquetas no Trello (case insensitive)
    const ETIQUETA_SEM_LOGO     = "sem logo";
    const ETIQUETA_MAIS_COMPRAS = "mais compras";

    // ── Listas consideradas "INICIAL" ──
    const LISTAS_INICIAL = [
        "INICIAL",
        "FALTA INFORMAÇÕES",
    ];

    // ── Listas consideradas "EM DESENVOLVIMENTO" ──
    const LISTAS_DESENVOLVIMENTO = [
        "EM DESENVOLVIMENTO",
        "AÇÕES",
        "DESENVOLVIMENTO MAÍSA",
        "DESENVOLVIMENTO FELIPE",
        "DESENVOLVIMENTO LARIANY",
        "DESENVOLVIMENTO TATI",
        "DESENVOLVIMENTO SIANNE",
        "DESENVOLVIMENTO RODRIGO",
        ...Array.from({ length: 20 }, (_, i) => `Desenvolvimento ${i + 1}`),
        ...Array.from({ length: 20 }, (_, i) => `DESENVOLVIMENTO ${i + 1}`),
    ];

    // ── Listas consideradas "EM ALTERAÇÃO" ──
    const LISTAS_ALTERACAO = [
        "ALTERAÇÕES",
        "ALTERAÇÕES 4",
        "ALTERAÇÕES 5",
        "ALTERAÇÃO VITOR",
        "CORREÇÃO",
        ...Array.from({ length: 20 }, (_, i) => `Alterações ${i + 1}`),
        ...Array.from({ length: 20 }, (_, i) => `ALTERAÇÕES ${i + 1}`),
    ];

    // ── Listas consideradas "AGUARDANDO APROVAÇÃO" ──
    const LISTAS_AGUARDANDO = [
        "AGUARDANDO APROVAÇÃO",
        "AGUARDANDO APROVAÇÃO DA ALTERAÇÃO",
    ];

    // ── Listas consideradas "EXPORTANDO" ──
    const LISTAS_EXPORTANDO = [
        "EXPORTANDO!",
        "EXPORTANDO 02",
        "EXPORTANDO RODRIGO",
        "EXPORTANDO TATI",
    ];

    // ── Listas consideradas "FAZENDO CROQUI" ──
    const LISTAS_FAZENDO_CROQUI = [
        "FAZENDO CROQUI VITO",
        "FAZENDO CROQUI SOPHIE",
        "FAZENDO CROQUI TATI",
        "CROQUI PRONTO",
        "CROQUI PRONTO ( TATI )",
        ...Array.from({ length: 10 }, (_, i) => `FAZENDO CROQUI ${i + 1}`),
    ];

    // ── Listas consideradas "CONFERINDO" ──
    const LISTAS_CONFERINDO = [
        "CONFERINDO",
    ];

    // ── Listas consideradas "FINALIZADO" ──
    const LISTAS_FINALIZADO = [
        "FINALIZADO",
        "FINALIZADO ✅🎨",
    ];

    // ============================================================
    // FIM DA CONFIGURAÇÃO
    // ============================================================

    const CHAVE_CREDS     = { key: "trello_key", token: "trello_token" };
    const CHAVE_LISTA_ALT = "ml_chat_lista_alteracao";

    function norm(nome) { return (nome || "").trim().toUpperCase(); }
    function listaEm(nome, lista) { return lista.some(l => norm(l) === norm(nome)); }

    function getKey()   { return localStorage.getItem(CHAVE_CREDS.key); }
    function getToken() { return localStorage.getItem(CHAVE_CREDS.token); }

    function garantirCredenciais() {
        if (getKey() && getToken()) return true;
        const key   = prompt("Digite sua API KEY do Trello:");
        const token = prompt("Digite seu TOKEN do Trello:");
        if (!key || !token) { alert("❌ Credenciais obrigatórias."); return false; }
        localStorage.setItem(CHAVE_CREDS.key, key);
        localStorage.setItem(CHAVE_CREDS.token, token);
        return true;
    }

    function api(method, path, body) {
        return new Promise((resolve, reject) => {
            const sep = path.includes("?") ? "&" : "?";
            GM_xmlhttpRequest({
                method,
                url: `https://api.trello.com/1${path}${sep}key=${getKey()}&token=${getToken()}`,
                headers: { "Content-Type": "application/json" },
                data: body ? JSON.stringify(body) : undefined,
                onload: r => { try { resolve(JSON.parse(r.responseText)); } catch(e) { reject(e); } },
                onerror: reject
            });
        });
    }

    function getVendaId() {
        const m = location.href.match(/mensagens\/(\d+)/);
        return m ? m[1] : null;
    }

    async function buscarCard(vendaId) {
        const cards = await api("GET", `/boards/${BOARD_ID}/cards?fields=name,desc,idList,url,idLabels`);
        return cards.find(c => (c.desc || "").includes(vendaId)) || null;
    }

    async function buscarTodosCards() {
        return await api("GET", `/boards/${BOARD_ID}/cards?fields=name,idList,idLabels`);
    }

    async function buscarListas() {
        return await api("GET", `/boards/${BOARD_ID}/lists?fields=name`);
    }

    async function buscarEtiquetas() {
        return await api("GET", `/boards/${BOARD_ID}/labels`);
    }

    function encontrarLista(listas, nome) {
        return listas.find(l => norm(l.name) === norm(nome));
    }

    function encontrarListasAlteracao(listas) {
        return listas.filter(l => listaEm(l.name, LISTAS_ALTERACAO));
    }

    async function moverCard(cardId, listId) {
        return await api("PUT", `/cards/${cardId}`, { idList: listId });
    }

    async function adicionarEtiqueta(cardId, labelId) {
        return await api("POST", `/cards/${cardId}/idLabels`, { value: labelId });
    }

    async function removerEtiqueta(cardId, labelId) {
        return await api("DELETE", `/cards/${cardId}/idLabels/${labelId}`);
    }

    function confirmar(titulo, mensagem) {
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            Object.assign(overlay.style, {
                position: "fixed", inset: "0", background: "rgba(0,0,0,0.75)",
                zIndex: "99999999", display: "flex", alignItems: "center", justifyContent: "center"
            });
            overlay.innerHTML = `
            <div style="background:#1a1a1a;border:1px solid #ef6c00;border-radius:12px;
                padding:20px 24px;max-width:300px;font-family:'IBM Plex Mono',monospace;color:#fff;font-size:12px">
                <div style="color:#ef6c00;font-weight:bold;margin-bottom:10px;font-size:13px">${titulo}</div>
                <div style="color:#ccc;margin-bottom:16px;line-height:1.5">${mensagem}</div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button id="conf-cancelar" style="background:#1e1e1e;border:2px solid #aaa;border-radius:6px;
                        padding:7px 16px;color:#fff;cursor:pointer;font-family:inherit;font-size:12px">✕ Cancelar</button>
                    <button id="conf-ok" style="background:#b71c1c;border:1px solid #ef5350;border-radius:6px;
                        padding:7px 16px;color:#fff;cursor:pointer;font-family:inherit;font-size:12px">Confirmar</button>
                </div>
            </div>`;
            document.body.appendChild(overlay);
            setTimeout(() => document.getElementById("conf-cancelar")?.focus(), 50);
            document.getElementById("conf-cancelar").onclick = () => { overlay.remove(); resolve(false); };
            document.getElementById("conf-ok").onclick       = () => { overlay.remove(); resolve(true); };
            overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
        });
    }

    function toast(msg, tipo = "ok") {
        const t = document.createElement("div");
        Object.assign(t.style, {
            position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
            background: tipo === "ok" ? "#2e7d32" : tipo === "erro" ? "#b71c1c" : "#f9a825",
            color: "#fff", padding: "10px 20px", borderRadius: "8px", fontFamily: "monospace",
            fontSize: "13px", zIndex: "9999999", boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            transition: "opacity 0.4s ease", opacity: "1"
        });
        t.innerText = msg;
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 400); }, 3000);
    }

    async function criarPainel() {
        if (document.getElementById("ml-painel-atendimento")) return;
        if (!garantirCredenciais()) return;
        const vendaId = getVendaId();
        if (!vendaId) return;

        const painel = document.createElement("div");
        painel.id = "ml-painel-atendimento";
        const pos = JSON.parse(localStorage.getItem("ml_painel_pos") || "null");
        Object.assign(painel.style, {
            position: "fixed",
            top:  (pos ? pos.top  : 60) + "px",
            left: (pos ? pos.left : window.innerWidth - 256) + "px",
            width: "240px", background: "#111", border: "1px solid #333",
            borderRadius: "12px", padding: "16px", zIndex: "999999", color: "#fff",
            fontFamily: "'IBM Plex Mono', monospace, sans-serif", fontSize: "12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)", userSelect: "none"
        });

        painel.innerHTML = `
            <div id="ml-drag" style="display:flex;justify-content:space-between;align-items:center;
                margin-bottom:12px;cursor:grab;padding-bottom:8px;border-bottom:1px solid #222">
                <span style="color:#f9a825;font-weight:bold;font-size:13px;letter-spacing:1px">🔧 ATENDIMENTO</span>
                <button id="ml-fechar" style="background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0;line-height:1">✕</button>
            </div>
            <div id="ml-status" style="color:#ccc;font-size:11px;margin-bottom:12px">🔍 Buscando card...</div>
            <div id="ml-mais-compras" style="display:none;margin-bottom:10px"></div>
            <div id="ml-acoes" style="display:none;flex-direction:column;gap:8px"></div>
        `;
        document.body.appendChild(painel);
        document.getElementById("ml-fechar").onclick = () => painel.remove();

        // Drag
        const drag = document.getElementById("ml-drag");
        let dragging = false, sx, sy, sl, st;
        drag.addEventListener("mousedown", e => {
            if (e.target.id === "ml-fechar") return;
            dragging = true; sx = e.clientX; sy = e.clientY;
            sl = parseInt(painel.style.left) || 0; st = parseInt(painel.style.top) || 0;
            drag.style.cursor = "grabbing"; e.preventDefault();
        });
        document.addEventListener("mousemove", e => {
            if (!dragging) return;
            painel.style.left = Math.max(0, Math.min(window.innerWidth  - painel.offsetWidth,  sl + e.clientX - sx)) + "px";
            painel.style.top  = Math.max(0, Math.min(window.innerHeight - painel.offsetHeight, st + e.clientY - sy)) + "px";
        });
        document.addEventListener("mouseup", () => {
            if (!dragging) return;
            dragging = false; drag.style.cursor = "grab";
            localStorage.setItem("ml_painel_pos", JSON.stringify({
                top: parseInt(painel.style.top), left: parseInt(painel.style.left)
            }));
        });

        let card, listas, etiquetas, todosCards;
        try {
            [card, listas, etiquetas, todosCards] = await Promise.all([
                buscarCard(vendaId), buscarListas(), buscarEtiquetas(), buscarTodosCards()
            ]);
        } catch {
            document.getElementById("ml-status").innerText = "❌ Erro ao buscar dados.";
            return;
        }

        const statusEl       = document.getElementById("ml-status");
        const maisComprasEl  = document.getElementById("ml-mais-compras");
        const acoesEl        = document.getElementById("ml-acoes");

        if (!card) {
            statusEl.innerHTML = `<span style="color:#ef5350">❌ Card não encontrado</span><br><span style="color:#888">ID: ${vendaId}</span>`;
            return;
        }

        const listaAtual     = listas.find(l => l.id === card.idList);
        const listaAtualNome = listaAtual?.name || "—";

        const modoInicial    = listaEm(listaAtualNome, LISTAS_INICIAL);
        const modoDesenv     = listaEm(listaAtualNome, LISTAS_DESENVOLVIMENTO);
        const modoAlteracao  = listaEm(listaAtualNome, LISTAS_ALTERACAO);
        const modoAguardando = listaEm(listaAtualNome, LISTAS_AGUARDANDO);
        const modoExportando = listaEm(listaAtualNome, LISTAS_EXPORTANDO);
        const modoFazCroqui  = listaEm(listaAtualNome, LISTAS_FAZENDO_CROQUI);
        const modoConferindo = listaEm(listaAtualNome, LISTAS_CONFERINDO);
        const modoFinalizado = listaEm(listaAtualNome, LISTAS_FINALIZADO);

        const listaExportando_    = encontrarLista(listas, LISTA_EXPORTANDO);
        const listaExportado_     = encontrarLista(listas, LISTA_EXPORTADO);
        const listaDesenv_        = encontrarLista(listas, LISTA_DESENVOLVIMENTO);
        const listaAcoes_         = encontrarLista(listas, LISTA_ACOES);
        const listaFaltaInfo_     = encontrarLista(listas, LISTA_FALTA_INFO);
        const listaReclamacoes_   = encontrarLista(listas, LISTA_RECLAMACOES);
        const listaAguardando_    = encontrarLista(listas, LISTA_AGUARDANDO);
        const listaAguardandoAlt_ = encontrarLista(listas, LISTA_AGUARDANDO_ALT);
        const listaCorrecao_      = encontrarLista(listas, LISTA_CORRECAO);
        const listaConferindo_    = encontrarLista(listas, LISTA_CONFERINDO);  // v3.2
        const listaFinalizado_    = encontrarLista(listas, LISTA_FINALIZADO);  // v3.2
        const listasAlt           = encontrarListasAlteracao(listas);

        const etqSemLogo     = etiquetas.find(e => (e.name || "").toLowerCase().includes(ETIQUETA_SEM_LOGO));
        const etqMaisCompras = etiquetas.find(e => (e.name || "").toLowerCase().includes(ETIQUETA_MAIS_COMPRAS));
        const cardTemSemLogo = etqSemLogo && (card.idLabels || []).includes(etqSemLogo.id);

        // ── v3.2: Detectar mais compras automaticamente ──
        const partes = card.name.split(" - ");
        const nomeCliente = (partes.length > 1
            ? partes.slice(1).join(" - ").trim()
            : card.name.trim()).toLowerCase();

        const outrosCards = todosCards.filter(c =>
            c.id !== card.id && c.name.toLowerCase().includes(nomeCliente) && nomeCliente.length >= 4
        );

        if (outrosCards.length > 0) {
            maisComprasEl.style.display = "inline-block";
            maisComprasEl.innerHTML = `
                <span style="background:#0047b3;border-radius:10px;
                    padding:2px 8px;font-size:10px;color:#b3d4ff;white-space:nowrap">
                    🔁 ${outrosCards.length} outro(s) pedido(s)
                </span>
            `;
        }

        statusEl.innerHTML = `
            <div style="color:#eee;margin-bottom:4px;word-break:break-word;font-size:11px">${card.name}</div>
            <div style="color:#aaa;font-size:11px">📋 ${listaAtualNome}</div>
        `;

        function btn(label, cor, fn) {
            const b = document.createElement("button");
            b.innerText = label;
            Object.assign(b.style, {
                background: "#1e1e1e", border: `1px solid ${cor}`, borderRadius: "8px",
                padding: "8px 10px", cursor: "pointer", color: "#eee", fontFamily: "inherit",
                fontSize: "12px", textAlign: "left", transition: "background 0.15s", width: "100%"
            });
            b.onmouseenter = () => b.style.background = "#2a2a2a";
            b.onmouseleave = () => b.style.background = "#1e1e1e";
            b.onclick = fn;
            return b;
        }

        // Mover sem confirmação
        async function mover(listaId, listaNome) {
            try {
                await moverCard(card.id, listaId);
                statusEl.innerHTML = `<span style="color:#ccc">✅ ${listaNome}</span>`;
                toast(`✅ ${listaNome}`);
            } catch { toast("❌ Erro ao mover card", "erro"); }
        }

        // Mover com confirmação obrigatória
        async function moverConfirmar(listaId, listaNome, titulo, msg) {
            const ok = await confirmar(titulo, msg || `Mover para<br><strong>${listaNome}</strong>?`);
            if (!ok) return;
            await mover(listaId, listaNome);
        }

        // Botão etiqueta sem logo
        function btnEtiquetaSemLogo() {
            return btn(
                cardTemSemLogo ? "🏷️ Remover etiqueta sem logo" : "🏷️ Adicionar etiqueta sem logo",
                "#546e7a", async () => {
                    try {
                        cardTemSemLogo
                            ? await removerEtiqueta(card.id, etqSemLogo.id)
                            : await adicionarEtiqueta(card.id, etqSemLogo.id);
                        toast(`🏷️ Etiqueta ${cardTemSemLogo ? "removida" : "adicionada"}`);
                        statusEl.innerHTML = `<span style="color:#90a4ae">🏷️ Etiqueta atualizada</span>`;
                    } catch { toast("❌ Erro", "erro"); }
                }
            );
        }

        // Select de listas de alteração
        function selectAlteracao(comConfirmacao) {
            const div = document.createElement("div");
            div.style.cssText = "display:flex;flex-direction:column;gap:4px";
            const savedAlt = localStorage.getItem(CHAVE_LISTA_ALT);
            const sel = document.createElement("select");
            Object.assign(sel.style, {
                background: "#1e1e1e", border: "1px solid #ef6c00", borderRadius: "8px",
                padding: "7px 10px", color: "#eee", fontFamily: "inherit",
                fontSize: "12px", width: "100%", cursor: "pointer"
            });
            listasAlt.forEach(l => {
                const opt = document.createElement("option");
                opt.value = l.id; opt.text = l.name;
                if (l.id === savedAlt) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.onchange = () => localStorage.setItem(CHAVE_LISTA_ALT, sel.value);
            const b = btn("🔄 Pediu alteração", "#ef6c00", async () => {
                const listId   = sel.value;
                const listNome = sel.options[sel.selectedIndex].text;
                localStorage.setItem(CHAVE_LISTA_ALT, listId);
                if (comConfirmacao) {
                    await moverConfirmar(listId, listNome, "⚠️ Fora do fluxo",
                        `Card está em <strong>${listaAtualNome}</strong>.<br>Confirma mover para <strong>${listNome}</strong>?`);
                } else {
                    await mover(listId, listNome);
                }
            });
            div.appendChild(sel); div.appendChild(b);
            return div;
        }

        acoesEl.style.display = "flex";

        // ── INICIAL ──
        if (modoInicial) {
            if (listaDesenv_)  acoesEl.appendChild(btn("📋 Desenvolvimento", "#6a1b9a", () => mover(listaDesenv_.id, LISTA_DESENVOLVIMENTO)));
            if (listaAcoes_)   acoesEl.appendChild(btn("♻️ Ações", "#00695c",           () => mover(listaAcoes_.id, LISTA_ACOES)));
        }

        // ── DESENVOLVIMENTO ──
        else if (modoDesenv) {
            if (listaAguardando_) acoesEl.appendChild(btn("⏳ Aguardando Aprovação", "#f9a825",  () => mover(listaAguardando_.id, LISTA_AGUARDANDO)));
            if (listaFaltaInfo_)  acoesEl.appendChild(btn("❓ Falta Informações", "#546e7a",     () => mover(listaFaltaInfo_.id, LISTA_FALTA_INFO)));
            if (listaAcoes_)      acoesEl.appendChild(btn("♻️ Ações", "#00695c", () =>
                moverConfirmar(listaAcoes_.id, LISTA_ACOES, "⚠️ Mover para Ações",
                    `Mover card para <strong>${LISTA_ACOES}</strong>?`)));
        }

        // ── AGUARDANDO APROVAÇÃO (normal ou da alteração) ──
        else if (modoAguardando) {
            if (listaExportando_) {
                acoesEl.appendChild(btn("✅ Aprovado", "#2e7d32", () => mover(listaExportando_.id, LISTA_EXPORTANDO)));
                acoesEl.appendChild(btn("✅ Aprovado sem logo", "#1565c0", async () => {
                    await mover(listaExportando_.id, LISTA_EXPORTANDO);
                    if (etqSemLogo) await adicionarEtiqueta(card.id, etqSemLogo.id);
                }));
            }
            if (etqSemLogo) acoesEl.appendChild(btnEtiquetaSemLogo());
            if (listasAlt.length > 0) acoesEl.appendChild(selectAlteracao(false));
        }

        // ── ALTERAÇÃO ──
        else if (modoAlteracao) {
            if (listaAguardandoAlt_) acoesEl.appendChild(btn("⏳ Aguardando Ap. Alteração", "#f9a825", () => mover(listaAguardandoAlt_.id, LISTA_AGUARDANDO_ALT)));
        }

        // ── EXPORTANDO ──
        else if (modoExportando) {
            if (listaExportado_)  acoesEl.appendChild(btn("📦 Exportado", "#2e7d32",   () => mover(listaExportado_.id, LISTA_EXPORTADO)));
            if (listaCorrecao_)   acoesEl.appendChild(btn("🔧 Correção", "#ef6c00",    () => mover(listaCorrecao_.id, LISTA_CORRECAO)));
        }

        // ── FAZENDO CROQUI ──
        else if (modoFazCroqui) {
            if (listaConferindo_) acoesEl.appendChild(btn("🔍 Conferindo", "#0288d1",   () => mover(listaConferindo_.id, LISTA_CONFERINDO)));
            if (listaCorrecao_)   acoesEl.appendChild(btn("🔧 Correção", "#ef6c00",     () => mover(listaCorrecao_.id, LISTA_CORRECAO)));
            if (listaExportando_) acoesEl.appendChild(btn("🖨️ Exportando", "#7b1fa2",  () =>
                moverConfirmar(listaExportando_.id, LISTA_EXPORTANDO, "⚠️ Voltar para Exportando",
                    `Mover card para <strong>${LISTA_EXPORTANDO}</strong>?`)));
        }

        // ── CONFERINDO ──
        else if (modoConferindo) {
            if (listaFinalizado_) acoesEl.appendChild(btn("✅ Finalizado", "#2e7d32",  () => mover(listaFinalizado_.id, LISTA_FINALIZADO)));
            if (listaCorrecao_)   acoesEl.appendChild(btn("🔧 Correção", "#ef6c00",    () => mover(listaCorrecao_.id, LISTA_CORRECAO)));
        }

        // ── FINALIZADO ──
        else if (modoFinalizado) {
            // Sem ações diretas — card já concluído
        }

        // ── OUTRAS LISTAS — mostra tudo com confirmação ──
        else {
            if (listaExportando_) {
                acoesEl.appendChild(btn("✅ Aprovado", "#2e7d32", () =>
                    moverConfirmar(listaExportando_.id, LISTA_EXPORTANDO, "⚠️ Fora do fluxo",
                        `Card em <strong>${listaAtualNome}</strong>.<br>Mover para <strong>${LISTA_EXPORTANDO}</strong>?`)));
                acoesEl.appendChild(btn("✅ Aprovado sem logo", "#1565c0", async () => {
                    const ok = await confirmar("⚠️ Fora do fluxo",
                        `Card em <strong>${listaAtualNome}</strong>.<br>Mover para <strong>${LISTA_EXPORTANDO}</strong>?`);
                    if (!ok) return;
                    await mover(listaExportando_.id, LISTA_EXPORTANDO);
                    if (etqSemLogo) await adicionarEtiqueta(card.id, etqSemLogo.id);
                }));
            }
            if (etqSemLogo) acoesEl.appendChild(btnEtiquetaSemLogo());
            if (listasAlt.length > 0) acoesEl.appendChild(selectAlteracao(true));
            if (listaAguardando_) acoesEl.appendChild(btn("⏳ Aguardando Aprovação", "#f9a825", () =>
                moverConfirmar(listaAguardando_.id, LISTA_AGUARDANDO, "⚠️ Fora do fluxo",
                    `Card em <strong>${listaAtualNome}</strong>.<br>Mover para <strong>${LISTA_AGUARDANDO}</strong>?`)));
            if (listaDesenv_) acoesEl.appendChild(btn("📋 Desenvolvimento", "#6a1b9a", () =>
                moverConfirmar(listaDesenv_.id, LISTA_DESENVOLVIMENTO, "⚠️ Fora do fluxo",
                    `Card em <strong>${listaAtualNome}</strong>.<br>Mover para <strong>${LISTA_DESENVOLVIMENTO}</strong>?`)));
            if (listaCorrecao_) acoesEl.appendChild(btn("🔧 Correção", "#ef6c00", () =>
                moverConfirmar(listaCorrecao_.id, LISTA_CORRECAO, "⚠️ Fora do fluxo",
                    `Card em <strong>${listaAtualNome}</strong>.<br>Mover para <strong>${LISTA_CORRECAO}</strong>?`)));
            if (listaConferindo_) acoesEl.appendChild(btn("🔍 Conferindo", "#0288d1", () =>
                moverConfirmar(listaConferindo_.id, LISTA_CONFERINDO, "⚠️ Fora do fluxo",
                    `Card em <strong>${listaAtualNome}</strong>.<br>Mover para <strong>${LISTA_CONFERINDO}</strong>?`)));
            if (listaFinalizado_) acoesEl.appendChild(btn("✅ Finalizado", "#2e7d32", () =>
                moverConfirmar(listaFinalizado_.id, LISTA_FINALIZADO, "⚠️ Fora do fluxo",
                    `Card em <strong>${listaAtualNome}</strong>.<br>Mover para <strong>${LISTA_FINALIZADO}</strong>?`)));
        }

        // ── RECLAMAÇÃO — sempre aparece, sempre pede confirmação ──
        if (listaReclamacoes_) {
            acoesEl.appendChild(btn("🚨 Abriu reclamação", "#b71c1c", () =>
                moverConfirmar(listaReclamacoes_.id, LISTA_RECLAMACOES, "⚠️ Abriu reclamação",
                    `Mover card para<br><strong>${LISTA_RECLAMACOES}</strong>?`)));
        }

        // ── RASTREAR MAIS COMPRAS — sempre aparece ──
        if (etqMaisCompras) {
            acoesEl.appendChild(btn("🔎 Rastrear mais compras", "#7b1fa2", async () => {
                try {
                    if (nomeCliente.length < 4) { toast("⚠️ Nome muito curto", "info"); return; }
                    const iguais = todosCards.filter(c => c.id !== card.id && c.name.toLowerCase().includes(nomeCliente));
                    if (iguais.length === 0) { toast("✅ Nenhum outro card com mesmo nome", "info"); return; }
                    const todos = [card, ...iguais];
                    await Promise.all(todos.map(c => {
                        if (!(c.idLabels || []).includes(etqMaisCompras.id))
                            return adicionarEtiqueta(c.id, etqMaisCompras.id);
                    }));
                    statusEl.innerHTML = `<span style="color:#ce93d8">🏷️ Mais compras: ${todos.length} card(s)</span>`;
                    toast(`🏷️ Etiqueta em ${todos.length} card(s)`);
                } catch { toast("❌ Erro ao rastrear", "erro"); }
            }));
        }
    }

    function init() {
        const iv = setInterval(() => {
            const chat = document.querySelector(".message-list, .buyer-name, [class*='messages']");
            if (chat) { clearInterval(iv); criarPainel(); }
        }, 800);
        setTimeout(() => { clearInterval(iv); if (!document.getElementById("ml-painel-atendimento")) criarPainel(); }, 4000);
    }

    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const old = document.getElementById("ml-painel-atendimento");
            if (old) old.remove();
            if (location.href.includes("/mensagens")) init();
        }
    }).observe(document.body, { subtree: true, childList: true });

    init();

})();