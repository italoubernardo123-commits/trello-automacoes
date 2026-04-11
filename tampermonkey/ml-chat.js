// ==UserScript==
// @name         ML — Painel de Atendimento
// @namespace    empresa-ml-chat
// @version      2.0
// @description  Painel de ações no chat do cliente ML
// @match        https://www.mercadolivre.com.br/vendas/*/mensagens*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/refs/heads/main/tampermonkey/ml-chat.js
// @downloadURL  https://raw.githubusercontent.com/italoubernardo123-commits/trello-automacoes/refs/heads/main/tampermonkey/ml-chat.js
// ==/UserScript==

(function () {
    'use strict';

    const BOARD_ID = "oCfs01Yk";
    const LISTA_EXPORTANDO      = "EXPORTANDO!";
    const LISTA_DESENVOLVIMENTO = "EM DESENVOLVIMENTO";
    const LISTA_ACOES           = "AÇÕES";
    const LISTA_RECLAMACOES     = "PROBLEMAS/RECLAMAÇÕES";
    const LISTA_AGUARDANDO_ALT  = "AGUARDANDO APROVAÇÃO DA ALTERAÇÃO";
    const ETIQUETA_SEM_LOGO     = "sem logo";
    const ETIQUETA_MAIS_COMPRAS = "mais compras";
    const CHAVE_CREDS     = { key: "trello_key", token: "trello_token" };
    const CHAVE_LISTA_ALT = "ml_chat_lista_alteracao";

    // Fluxo esperado por ação
    const FLUXO = {
        aprovado:        ["AGUARDANDO APROVAÇÃO", "AGUARDANDO APROVAÇÃO DA ALTERAÇÃO"],
        alteracao:       ["AGUARDANDO APROVAÇÃO", "AGUARDANDO APROVAÇÃO DA ALTERAÇÃO"],
        aguardandoAlt:   ["ALTERAÇ", "CORREÇÃO"],
        desenvolvimento: ["INICIAL", "FALTA INFORMAÇÕES", "PROBLEMAS/RECLAMAÇÕES"],
        acoes:           ["INICIAL", "FALTA INFORMAÇÕES"],
    };

    function listaNoFluxo(listaAtualNome, chave) {
        const nome = (listaAtualNome || "").toUpperCase();
        return (FLUXO[chave] || []).some(p => nome.includes(p.toUpperCase()));
    }

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
        return listas.find(l => l.name.trim().toUpperCase() === nome.trim().toUpperCase());
    }

    function encontrarListasAlteracao(listas) {
        return listas.filter(l =>
            l.name.toUpperCase().includes("ALTERAÇ") ||
            l.name.toUpperCase().includes("ALTERAC") ||
            l.name.toUpperCase().includes("CORREÇÃO")
        );
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

    function confirmarForaDoFluxo(acao, listaAtual) {
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            Object.assign(overlay.style, {
                position: "fixed", inset: "0", background: "rgba(0,0,0,0.7)",
                zIndex: "99999999", display: "flex", alignItems: "center", justifyContent: "center"
            });
            overlay.innerHTML = `
            <div style="background:#1a1a1a;border:1px solid #ef6c00;border-radius:12px;
                padding:20px 24px;max-width:300px;font-family:'IBM Plex Mono',monospace;color:#fff;font-size:12px">
                <div style="color:#ef6c00;font-weight:bold;margin-bottom:10px;font-size:13px">⚠️ Fora do fluxo</div>
                <div style="color:#aaa;margin-bottom:16px">
                    Card está em <strong style="color:#fff">${listaAtual}</strong>.<br><br>
                    Tem certeza que quer executar:<br>
                    <strong style="color:#f9a825">${acao}</strong>?
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button id="conf-cancelar" style="background:#1e1e1e;border:2px solid #555;border-radius:6px;
                        padding:7px 16px;color:#fff;cursor:pointer;font-family:inherit;font-size:12px">
                        ✕ Cancelar
                    </button>
                    <button id="conf-confirmar" style="background:#b71c1c;border:1px solid #ef5350;border-radius:6px;
                        padding:7px 16px;color:#fff;cursor:pointer;font-family:inherit;font-size:12px">
                        Confirmar
                    </button>
                </div>
            </div>`;
            document.body.appendChild(overlay);
            setTimeout(() => document.getElementById("conf-cancelar")?.focus(), 50);
            document.getElementById("conf-cancelar").onclick  = () => { overlay.remove(); resolve(false); };
            document.getElementById("conf-confirmar").onclick = () => { overlay.remove(); resolve(true); };
            overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
        });
    }

    async function executarComFluxo(chave, label, listaAtualNome, fn) {
        if (!listaNoFluxo(listaAtualNome, chave)) {
            const ok = await confirmarForaDoFluxo(label, listaAtualNome);
            if (!ok) return;
        }
        await fn();
    }

    function toast(msg, tipo = "ok") {
        const t = document.createElement("div");
        const cor = tipo === "ok" ? "#2e7d32" : tipo === "erro" ? "#b71c1c" : "#f9a825";
        Object.assign(t.style, {
            position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
            background: cor, color: "#fff", padding: "10px 20px", borderRadius: "8px",
            fontFamily: "monospace", fontSize: "13px", zIndex: "9999999",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)", transition: "opacity 0.4s ease", opacity: "1"
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
        const posSalva = JSON.parse(localStorage.getItem("ml_painel_pos") || "null");
        const posTop   = posSalva ? posSalva.top  : 60;
        const posLeft  = posSalva ? posSalva.left : (window.innerWidth - 256);

        Object.assign(painel.style, {
            position: "fixed", top: posTop + "px", left: posLeft + "px",
            width: "240px", background: "#111", border: "1px solid #333",
            borderRadius: "12px", padding: "16px", zIndex: "999999", color: "#fff",
            fontFamily: "'IBM Plex Mono', monospace, sans-serif", fontSize: "12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)", userSelect: "none"
        });

        painel.innerHTML = `
            <div id="ml-painel-drag" style="display:flex;justify-content:space-between;align-items:center;
                margin-bottom:12px;cursor:grab;padding-bottom:8px;border-bottom:1px solid #222">
                <span style="color:#f9a825;font-weight:bold;font-size:13px;letter-spacing:1px">🔧 ATENDIMENTO</span>
                <button id="ml-painel-fechar" style="background:none;border:none;color:#555;cursor:pointer;font-size:16px;padding:0;line-height:1">✕</button>
            </div>
            <div id="ml-painel-status" style="color:#aaa;font-size:11px;margin-bottom:12px">🔍 Buscando card...</div>
            <div id="ml-painel-acoes" style="display:none;flex-direction:column;gap:8px"></div>
        `;

        document.body.appendChild(painel);
        document.getElementById("ml-painel-fechar").onclick = () => painel.remove();

        // Drag
        const dragHandle = document.getElementById("ml-painel-drag");
        let isDragging = false, startX, startY, startLeft, startTop;
        dragHandle.addEventListener("mousedown", e => {
            if (e.target.id === "ml-painel-fechar") return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            startLeft = parseInt(painel.style.left) || 0;
            startTop  = parseInt(painel.style.top)  || 0;
            dragHandle.style.cursor = "grabbing";
            e.preventDefault();
        });
        document.addEventListener("mousemove", e => {
            if (!isDragging) return;
            painel.style.left = Math.max(0, Math.min(window.innerWidth  - painel.offsetWidth,  startLeft + e.clientX - startX)) + "px";
            painel.style.top  = Math.max(0, Math.min(window.innerHeight - painel.offsetHeight, startTop  + e.clientY - startY)) + "px";
        });
        document.addEventListener("mouseup", () => {
            if (!isDragging) return;
            isDragging = false;
            dragHandle.style.cursor = "grab";
            localStorage.setItem("ml_painel_pos", JSON.stringify({
                top: parseInt(painel.style.top), left: parseInt(painel.style.left)
            }));
        });

        // Buscar dados
        let card, listas, etiquetas, todosCards;
        try {
            [card, listas, etiquetas, todosCards] = await Promise.all([
                buscarCard(vendaId), buscarListas(), buscarEtiquetas(), buscarTodosCards()
            ]);
        } catch {
            document.getElementById("ml-painel-status").innerText = "❌ Erro ao buscar dados.";
            return;
        }

        const statusEl = document.getElementById("ml-painel-status");
        const acoesEl  = document.getElementById("ml-painel-acoes");

        if (!card) {
            statusEl.innerHTML = `<span style="color:#ef5350">❌ Card não encontrado</span><br><span style="color:#555">ID: ${vendaId}</span>`;
            return;
        }

        const listaAtual     = listas.find(l => l.id === card.idList);
        const listaAtualNome = listaAtual?.name || "—";
        const listaExportando    = encontrarLista(listas, LISTA_EXPORTANDO);
        const listaDesenv        = encontrarLista(listas, LISTA_DESENVOLVIMENTO);
        const listaAcoes_        = encontrarLista(listas, LISTA_ACOES);
        const listaReclamacoes   = encontrarLista(listas, LISTA_RECLAMACOES);
        const listaAguardandoAlt = encontrarLista(listas, LISTA_AGUARDANDO_ALT);
        const listasAlteracao    = encontrarListasAlteracao(listas);
        const etqSemLogo     = etiquetas.find(e => (e.name || "").toLowerCase().includes(ETIQUETA_SEM_LOGO));
        const etqMaisCompras = etiquetas.find(e => (e.name || "").toLowerCase().includes(ETIQUETA_MAIS_COMPRAS));
        const cardTemSemLogo = etqSemLogo && (card.idLabels || []).includes(etqSemLogo.id);
        const estaEmAlteracao = listasAlteracao.some(l => l.id === card.idList);

        statusEl.innerHTML = `
            <div style="color:#ddd;margin-bottom:4px;word-break:break-word;font-size:11px">${card.name}</div>
            <div style="color:#888;font-size:11px">📋 ${listaAtualNome}</div>
        `;

        function btnAcao(label, cor, fn) {
            const b = document.createElement("button");
            b.innerText = label;
            Object.assign(b.style, {
                background: "#1e1e1e", border: `1px solid ${cor}`, borderRadius: "8px",
                padding: "8px 10px", cursor: "pointer", color: "#fff",
                fontFamily: "inherit", fontSize: "12px", textAlign: "left",
                transition: "background 0.15s", width: "100%"
            });
            b.onmouseenter = () => b.style.background = "#2a2a2a";
            b.onmouseleave = () => b.style.background = "#1e1e1e";
            b.onclick = fn;
            return b;
        }

        acoesEl.style.display = "flex";

        if (estaEmAlteracao) {
            // Modo alteração — só aguardando e reclamação
            if (listaAguardandoAlt) {
                acoesEl.appendChild(btnAcao("⏳ Aguardando Ap. Alteração", "#f9a825", async () => {
                    await executarComFluxo("aguardandoAlt", "Aguardando Ap. Alteração", listaAtualNome, async () => {
                        try {
                            await moverCard(card.id, listaAguardandoAlt.id);
                            statusEl.innerHTML = `<span style="color:#f9a825">⏳ Aguardando Ap. Alteração</span>`;
                            toast("⏳ Aguardando Aprovação da Alteração");
                        } catch { toast("❌ Erro ao mover card", "erro"); }
                    });
                }));
            }
            if (listaReclamacoes) {
                acoesEl.appendChild(btnAcao("🚨 Abriu reclamação", "#b71c1c", async () => {
                    try {
                        await moverCard(card.id, listaReclamacoes.id);
                        statusEl.innerHTML = `<span style="color:#ef9a9a">🚨 ${LISTA_RECLAMACOES}</span>`;
                        toast(`🚨 Movido para ${LISTA_RECLAMACOES}`);
                    } catch { toast("❌ Erro ao mover card", "erro"); }
                }));
            }

        } else {
            // Modo normal
            if (listaExportando) {
                acoesEl.appendChild(btnAcao("✅ Aprovado", "#2e7d32", async () => {
                    await executarComFluxo("aprovado", "Aprovado", listaAtualNome, async () => {
                        try {
                            await moverCard(card.id, listaExportando.id);
                            statusEl.innerHTML = `<span style="color:#66bb6a">✅ ${LISTA_EXPORTANDO}</span>`;
                            toast(`✅ Movido para ${LISTA_EXPORTANDO}`);
                        } catch { toast("❌ Erro ao mover card", "erro"); }
                    });
                }));

                acoesEl.appendChild(btnAcao("✅ Aprovado sem logo", "#1565c0", async () => {
                    await executarComFluxo("aprovado", "Aprovado sem logo", listaAtualNome, async () => {
                        try {
                            await moverCard(card.id, listaExportando.id);
                            if (etqSemLogo) await adicionarEtiqueta(card.id, etqSemLogo.id);
                            statusEl.innerHTML = `<span style="color:#64b5f6">✅ Exportando + sem logo</span>`;
                            toast("✅ Aprovado sem logo");
                        } catch { toast("❌ Erro ao executar ação", "erro"); }
                    });
                }));
            }

            if (etqSemLogo) {
                acoesEl.appendChild(btnAcao(
                    cardTemSemLogo ? "🏷️ Remover etiqueta sem logo" : "🏷️ Adicionar etiqueta sem logo",
                    "#546e7a",
                    async () => {
                        try {
                            if (cardTemSemLogo) {
                                await removerEtiqueta(card.id, etqSemLogo.id);
                                toast("🏷️ Etiqueta sem logo removida");
                            } else {
                                await adicionarEtiqueta(card.id, etqSemLogo.id);
                                toast("🏷️ Etiqueta sem logo adicionada");
                            }
                            statusEl.innerHTML = `<span style="color:#90a4ae">🏷️ Etiqueta atualizada</span>`;
                        } catch { toast("❌ Erro ao atualizar etiqueta", "erro"); }
                    }
                ));
            }

            if (listasAlteracao.length > 0) {
                const divAlt = document.createElement("div");
                divAlt.style.cssText = "display:flex;flex-direction:column;gap:4px";
                const savedAlt = localStorage.getItem(CHAVE_LISTA_ALT);
                const select = document.createElement("select");
                Object.assign(select.style, {
                    background: "#1e1e1e", border: "1px solid #ef6c00", borderRadius: "8px",
                    padding: "7px 10px", color: "#fff", fontFamily: "inherit",
                    fontSize: "12px", width: "100%", cursor: "pointer"
                });
                listasAlteracao.forEach(l => {
                    const opt = document.createElement("option");
                    opt.value = l.id; opt.text = l.name;
                    if (l.id === savedAlt) opt.selected = true;
                    select.appendChild(opt);
                });
                select.onchange = () => localStorage.setItem(CHAVE_LISTA_ALT, select.value);
                const btnAlt = btnAcao("🔄 Pediu alteração", "#ef6c00", async () => {
                    const listId   = select.value;
                    const listNome = select.options[select.selectedIndex].text;
                    localStorage.setItem(CHAVE_LISTA_ALT, listId);
                    await executarComFluxo("alteracao", "Pediu alteração", listaAtualNome, async () => {
                        try {
                            await moverCard(card.id, listId);
                            statusEl.innerHTML = `<span style="color:#ffa726">🔄 ${listNome}</span>`;
                            toast(`🔄 Movido para ${listNome}`);
                        } catch { toast("❌ Erro ao mover card", "erro"); }
                    });
                });
                divAlt.appendChild(select);
                divAlt.appendChild(btnAlt);
                acoesEl.appendChild(divAlt);
            }

            if (listaDesenv) {
                acoesEl.appendChild(btnAcao("📋 Mandou informações", "#6a1b9a", async () => {
                    await executarComFluxo("desenvolvimento", "Mandou informações", listaAtualNome, async () => {
                        try {
                            await moverCard(card.id, listaDesenv.id);
                            statusEl.innerHTML = `<span style="color:#ce93d8">📋 ${LISTA_DESENVOLVIMENTO}</span>`;
                            toast(`📋 Movido para ${LISTA_DESENVOLVIMENTO}`);
                        } catch { toast("❌ Erro ao mover card", "erro"); }
                    });
                }));
            }

            if (listaAcoes_) {
                acoesEl.appendChild(btnAcao("♻️ Mesma arte anterior", "#00695c", async () => {
                    await executarComFluxo("acoes", "Mesma arte anterior", listaAtualNome, async () => {
                        try {
                            await moverCard(card.id, listaAcoes_.id);
                            statusEl.innerHTML = `<span style="color:#80cbc4">♻️ ${LISTA_ACOES}</span>`;
                            toast(`♻️ Movido para ${LISTA_ACOES}`);
                        } catch { toast("❌ Erro ao mover card", "erro"); }
                    });
                }));
            }

            if (listaReclamacoes) {
                acoesEl.appendChild(btnAcao("🚨 Abriu reclamação", "#b71c1c", async () => {
                    try {
                        await moverCard(card.id, listaReclamacoes.id);
                        statusEl.innerHTML = `<span style="color:#ef9a9a">🚨 ${LISTA_RECLAMACOES}</span>`;
                        toast(`🚨 Movido para ${LISTA_RECLAMACOES}`);
                    } catch { toast("❌ Erro ao mover card", "erro"); }
                }));
            }
        }

        // 🔎 RASTREAR MAIS COMPRAS
        if (etqMaisCompras) {
            acoesEl.appendChild(btnAcao("🔎 Rastrear mais compras", "#7b1fa2", async () => {
                try {
                    const partes = card.name.split(" - ");
                    const nomeCliente = (partes.length > 1
                        ? partes.slice(1).join(" - ").trim()
                        : card.name.trim()).toLowerCase();

                    if (nomeCliente.length < 4) {
                        toast("⚠️ Nome muito curto para rastrear", "info");
                        return;
                    }

                    const iguais = todosCards.filter(c =>
                        c.id !== card.id &&
                        c.name.toLowerCase().includes(nomeCliente)
                    );

                    if (iguais.length === 0) {
                        toast("✅ Nenhum outro card com mesmo nome", "info");
                        return;
                    }

                    const todos = [card, ...iguais];
                    await Promise.all(todos.map(c => {
                        if (!(c.idLabels || []).includes(etqMaisCompras.id)) {
                            return adicionarEtiqueta(c.id, etqMaisCompras.id);
                        }
                    }));

                    statusEl.innerHTML = `<span style="color:#ce93d8">🏷️ Mais compras: ${todos.length} card(s) marcados</span>`;
                    toast(`🏷️ Etiqueta adicionada em ${todos.length} card(s)`);
                } catch { toast("❌ Erro ao rastrear cards", "erro"); }
            }));
        }
    }

    function init() {
        const interval = setInterval(() => {
            const chatArea = document.querySelector(".message-list, .buyer-name, [class*='messages']");
            if (chatArea) { clearInterval(interval); criarPainel(); }
        }, 800);
        setTimeout(() => {
            clearInterval(interval);
            if (!document.getElementById("ml-painel-atendimento")) criarPainel();
        }, 4000);
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