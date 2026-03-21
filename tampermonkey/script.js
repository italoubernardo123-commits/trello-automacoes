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
    
    Object.assign(btn.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 999999,
        padding: "12px",
        borderRadius: "50%",
        background: "#111",
        color: "#fff",
        fontSize: "18px",
        cursor: "pointer"
    });

    btn.onclick = abrirMenu;
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


function executarMetricasShopee() {

    /************ CONFIG ************/


    const LISTAS = {
        SEM_INFO: ["INICIAL 🟢","FALTA INFORMAÇÕES"],
        DESENVOLVIMENTO: [
            "AÇÕES","DESENVOLVIMENTO  🔶","Desenvolvimento 1",
            "Desenvolvimento 2","Desenvolvimento 3","Desenvolvimento 4","Desenvolvimento 5","Desenvolvimento 6","Desenvolvimento 7","Desenvolvimento 8","Desenvolvimento 9","Desenvolvimento 10","Desenvolvimento 11","Desenvolvimento 12","Desenvolvimento 13","Desenvolvimento 14","Desenvolvimento 15"
        ],
        AGUARDANDO: [
            "AGUARDANDO APROVAÇÃO ⚫",
            "AGUARDANDO APROVAÇÃO DA ALTERAÇÃO ⚫"
        ],
        ALTERACAO: [
            "ALTERAÇÃO 2","ALTERAÇÃO  VITOR","ALTERAÇÕES 1","CORREÇÃO"
        ]
    };
    /********************************/

    const DIAS_SEMANA = ["DOMINGO","SEGUNDA","TERÇA","QUARTA","QUINTA","SEXTA","SÁBADO"];

    function request(url) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                onload: r => resolve(JSON.parse(r.responseText))
            });
        });
    }

    function dataLocalISO(dateUTC) {
        const d = new Date(dateUTC);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate())
            .toISOString().slice(0,10);
    }

    function formatarDataBR(iso) {
        const [a,m,d] = iso.split("-");
        return `${d}/${m}`;
    }

    function gerarDias() {
        const hoje = new Date();
        hoje.setHours(0,0,0,0);

        return [...Array(7)].map((_,i)=>{
            const d = new Date(hoje);
            d.setDate(hoje.getDate()+i);
            return {
                dataISO: d.toISOString().slice(0,10),
                nome: DIAS_SEMANA[d.getDay()],
                index: i
            };
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
        if (total >= 30) return "dia-laranja";
        if (total >= 5) return "dia-amarelo";
        if (total >= 1) return "dia-amarelinho";
        return "dia-verde";
    }

    async function gerarMetricas() {
        const boardId = location.pathname.split("/")[2];
        const lists = await request(`https://api.trello.com/1/boards/${boardId}/lists?key=${API_KEY}&token=${API_TOKEN}`);
        const cards = await request(`https://api.trello.com/1/boards/${boardId}/cards?key=${API_KEY}&token=${API_TOKEN}`);

        const listMap = {};
        lists.forEach(l => listMap[l.id] = l.name.toUpperCase());

        let tabela = {};
        cards.forEach(c => {
            if (!c.due) return;

            const data = dataLocalISO(c.due);
            const l = listMap[c.idList] || "";

            let tipo = null;
            if (LISTAS.SEM_INFO.includes(l)) tipo="semInfo";
            else if (LISTAS.DESENVOLVIMENTO.includes(l)) tipo="desenvolvimento";
            else if (LISTAS.ALTERACAO.includes(l)) tipo="alteracao";
            else if (LISTAS.AGUARDANDO.includes(l)) tipo="aguardando";
            else return;

            tabela[data] ??= {semInfo:0,desenvolvimento:0,alteracao:0,aguardando:0};
            tabela[data][tipo]++;
        });

        abrirAba(tabela);
    }

    function abrirAba(tabela) {
        const dias = gerarDias();
        const w = window.open("","_blank");

        let tg={t:0,s:0,d:0,a:0,g:0};

        let html = `
<html><head><style>
body{background:#0f0f0f;color:#fff;font-family:Arial;padding:20px}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #444;padding:10px;text-align:center}
th{background:#1c1c1c}

.col-dia{font-weight:bold}

.dia-preto{background:#000}
.dia-verde{background:#90ee30;color:#000}
.dia-amarelinho{background:#ffde21;color:#000}
.dia-amarelo{background:#f9a825;color:#000}
.dia-laranja{background:#ef6c00}
.dia-vermelho{background:#c62828}

.total{background:#1b5e20;font-weight:bold}
.total:hover{background:#597d35;cursor:pointer;transition:0.25s}

h1{color:#ff9800}
</style></head><body>

<h1>📊 MÉTRICAS SHOPEE</h1>

<table>
<tr>
<th>DIA</th>
<th>TOTAL</th>
<th>SEM INFO</th>
<th>EM DESENV.</th>
<th>ALTERAÇÃO</th>
<th>AGUARDANDO</th>
</tr>`;

        dias.forEach(d=>{
            const v=tabela[d.dataISO]||{semInfo:0,desenvolvimento:0,alteracao:0,aguardando:0};
            const total=v.semInfo+v.desenvolvimento+v.alteracao+v.aguardando;
            const cls=classePorDia(d.index,total);

            tg.t+=total; tg.s+=v.semInfo; tg.d+=v.desenvolvimento; tg.a+=v.alteracao; tg.g+=v.aguardando;

            html+=`
<tr class="${cls}">
<td class="col-dia">${d.nome} ${formatarDataBR(d.dataISO)}</td>
<td>${total}</td>
<td>${v.semInfo}</td>
<td>${v.desenvolvimento}</td>
<td>${v.alteracao}</td>
<td>${v.aguardando}</td>
</tr>`;
        });

        html+=`
<tr class="total">
<td>🧮 TOTAL GERAL</td>
<td>${tg.t}</td>
<td>${tg.s}</td>
<td>${tg.d}</td>
<td>${tg.a}</td>
<td>${tg.g}</td>
</tr>
</table>
</body></html>`;

        w.document.write(html);
        w.document.close();
    }

    function addButton() {
        if (document.getElementById("btn-metricas-shopee")) return;

        const btn = document.createElement("button");
        btn.id = "btn-metricas-shopee";
        btn.textContent = "📊 MÉTRICAS SHOPEE";
        Object.assign(btn.style,{
            position:"fixed",
            top:"3px",
            left:"150px",
            zIndex:999999,
            padding:"10px 14px",
            background:"#ff9800",
            border:"none",
            borderRadius:"6px",
            fontWeight:"bold",
            color:"#000",
            cursor:"pointer"
        });

        btn.onclick = gerarMetricas;
        document.body.appendChild(btn);
    }

    setInterval(addButton,1500);
}
})();