// ==UserScript==
// @name         Script Empresa (Base)
// @namespace    empresa
// @version      1.0
// @match        https://trello.com/b/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    criarBotaoFlutuante();

    const API_KEY = localStorage.getItem("trello_key");
const API_TOKEN = localStorage.getItem("trello_token");

if (!API_KEY || !API_TOKEN) {
    const key = prompt("Digite sua API KEY do Trello:");
    const token = prompt("Digite seu TOKEN do Trello:");

    if (!key || !token) {
        alert("❌ API KEY e TOKEN são obrigatórios.");
        return;
    }

    localStorage.setItem("trello_key", key);
    localStorage.setItem("trello_token", token);

    alert("✅ Salvo! Recarregue a página.");
    location.reload();
}

    const ML_REGEX = /https?:\/\/[^\s"']*mercadolivre[^\s"']*/gi;

    // =========================
    // MENU UI
    // =========================

    function criarBotaoFlutuante() {
        if (document.getElementById("btn-empresa")) return;

        const btn = document.createElement("button");
        btn.id = "btn-empresa";
        btn.innerText = "⚙️";

        btn.style.position = "fixed";
        btn.style.bottom = "20px";
        btn.style.right = "20px";
        btn.style.zIndex = "999999";
        btn.style.padding = "10px";
        btn.style.borderRadius = "50%";
        btn.style.border = "none";
        btn.style.background = "#111";
        btn.style.color = "#fff";
        btn.style.cursor = "pointer";

        btn.onclick = toggleMenu;

        document.body.appendChild(btn);
    }

    function toggleMenu() {

        let menu = document.getElementById("menu-empresa");

        if (menu) {
            menu.remove();
            return;
        }

        menu = document.createElement("div");
        menu.id = "menu-empresa";

        menu.style.position = "fixed";
        menu.style.bottom = "70px";
        menu.style.right = "20px";
        menu.style.background = "#111";
        menu.style.padding = "15px";
        menu.style.borderRadius = "10px";
        menu.style.zIndex = "999999";
        menu.style.color = "#fff";

        menu.innerHTML = `
            <button id="btn-ml">🔗 Abrir Chats ML</button>
        `;

        document.body.appendChild(menu);

        document.getElementById("btn-ml").onclick = start;
    }

    // =========================
    // SUA LÓGICA ORIGINAL (INTACTA)
    // =========================

    async function start() {
        const listName = prompt("Nome exato da lista:", "INICIAL");
        if (!listName) return;

        const startAfter = prompt(
            "Cole o ID do card (ex: ijZucRDK) ou deixe vazio para começar do topo:"
        )?.trim();

        const limit = parseInt(prompt("Quantos links deseja abrir?"), 10);
        if (!limit || limit <= 0) return;

        const boardId = window.location.pathname.split("/")[2];

        const lists = await api(`/boards/${boardId}/lists`);
        const list = lists.find(
            l => l.name.trim().toUpperCase() === listName.trim().toUpperCase()
        );

        if (!list) {
            alert("❌ Lista não encontrada.");
            return;
        }

        const cards = await api(`/lists/${list.id}/cards`);
        if (!cards.length) {
            alert("❌ Nenhum card na lista.");
            return;
        }

        let opened = 0;
        let canStart = !startAfter;

        for (const card of cards) {

            if (!canStart) {
                if (card.shortLink === startAfter) {
                    canStart = true;
                }
                continue;
            }

            if (opened >= limit) break;
            if (!card.desc) continue;

            const links = card.desc.match(ML_REGEX) || [];
            for (const link of links) {
                if (opened >= limit) break;
                window.open(link, "_blank");
                opened++;
            }
        }

        alert(`✅ Finalizado — ${opened} links abertos`);
    }

    function api(path) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `https://api.trello.com/1${path}?key=${API_KEY}&token=${API_TOKEN}`,
                onload: res => resolve(JSON.parse(res.responseText)),
                onerror: reject
            });
        });
    }

})();