# 🤖 Automações Trello e Marketplace

Scripts de automação para Trello e marketplaces, rodando via [Tampermonkey](https://www.tampermonkey.net/).

---

## 📦 Scripts

### `trello-sync.js` — Vendas → Trello (ML + Shopee)
Detecta automaticamente se você está no Mercado Livre ou na Shopee e cria cards no Trello com todas as informações do pedido.

**Funcionalidades:**
- Filtra automaticamente pedidos de **personalizado** (ML: botão "Já tenho os produtos" / Shopee: tag "Sob encomenda")
- Captura nome do comprador, produto, SKU, quantidade, data e link do chat
- Suporte a **pacotes** (expande automaticamente para ler os itens internos)
- Suporte a **múltiplos itens** no mesmo pedido (personalizado + pronta entrega)
- Define **due date** automaticamente (ML: data do prazo / Shopee: prazo de envio − 2 dias)
- Detecta **duplicados** — não cria card se o pedido já existe no Trello
- Detecta **mais compras** — adiciona etiqueta azul se o cliente já tem card no board
- Captura **reclamações abertas** e adiciona etiqueta vermelha automaticamente
- Dropdown para escolher a lista de destino no Trello
- Credenciais salvas localmente no Tampermonkey (nunca vão ao GitHub)
- Auto-update via GitHub

**Ativa em:**
- `https://www.mercadolivre.com.br/vendas/*`
- `https://seller.shopee.com.br/*`

---

### `script.js` — Painel de Ferramentas ML
Painel de utilidades para o dia a dia no Mercado Livre.

**Funcionalidades:**
- Métricas de vendas
- Abertura rápida de links
- Outras automações do fluxo operacional

**Ativa em:** `https://www.mercadolivre.com.br/*`

---

### `croqui.js` — Gerador de Croqui
Gera croquis/esboços de arte para os pedidos personalizados a partir dos dados do card do Trello.

**Ativa em:** `https://trello.com/*`

---

### `ml-chat.js` — Helper de Chat ML
Auxilia o atendimento no chat do Mercado Livre.

**Ativa em:** `https://www.mercadolivre.com.br/*`

---

## 🚀 Instalação

1. Instale a extensão [Tampermonkey](https://www.tampermonkey.net/) no seu browser
2. Abra o Tampermonkey → **Criar novo script**
3. Apague o conteúdo padrão e cole o conteúdo do script desejado
4. Salve com `Ctrl+S`
5. Na primeira execução do `trello-sync.js`, preencha suas credenciais na janela de configuração que vai aparecer

---

## ⚙️ Configuração do `trello-sync.js`

Na primeira vez que clicar no botão, uma janela de configuração vai abrir pedindo:

| Campo | O que colocar |
|---|---|
| Trello API Key | Chave de 32 caracteres — gere em [trello.com/power-ups/admin](https://trello.com/power-ups/admin) |
| Trello Token | Token de 64 caracteres — gerado na mesma página |
| Board ID — Mercado Livre | Só o ID curto da URL do quadro: `trello.com/x/****/nome` |
| Board ID — Shopee | Só o ID curto da URL do quadro: `trello.com/y/****/nome` |
| ID Etiqueta Reclamação | ID hexadecimal da etiqueta (não o nome) — opcional |
| ID Etiqueta Mais Compras | ID hexadecimal da etiqueta (não o nome) — opcional |

> Para reabrir a configuração depois, clique no botão **⚙️** ao lado do botão principal.

---

## 🔄 Auto-update

O `trello-sync.js` verifica atualizações automaticamente via GitHub.

**Para ativar no Tampermonkey:**
1. Tampermonkey → **Painel** → aba **Configurações**
2. Em **Atualizações**, defina verificar a cada `1 dia`
3. Escolha `Sempre atualizar` ou `Notificar` conforme preferir

Sempre que uma nova versão for publicada no GitHub (com o `@version` incrementado), o Tampermonkey vai atualizar automaticamente.

---

## 📁 Estrutura do repositório

```
tampermonkey/
├── trello-sync.js   # ML + Shopee → Trello
├── script.js        # Painel de ferramentas ML
├── croqui.js        # Gerador de croqui
├── ml-chat.js       # Helper de chat ML
└── assets/          # Recursos estáticos (logos, imagens)
```

---

## ⚠️ Segurança

As credenciais do Trello (API Key e Token) **nunca são commitadas no repositório**. Elas ficam salvas localmente no seu Tampermonkey usando `GM_setValue` e `GM_getValue`. Cada membro da equipe preenche as próprias credenciais na primeira vez que usar o script.
