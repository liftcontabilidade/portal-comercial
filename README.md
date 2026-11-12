# Portal Comercial — LIFT Contabilidade

Painel do time comercial: clientes fechados, saídas (churn), dados mensais, dashboard,
oportunidades, receita de fechamento e análise de churn.

Os dados ficam no **Firebase (Firestore)** e o acesso é feito com **login Google**.
O site é publicado pelo **GitHub Pages**.

## Estrutura

| Arquivo | O que é |
|---|---|
| `index.html` | Página do portal |
| `css/styles.css` | Visual |
| `js/data.js` | Histórico oficial (2024–2025), metas e dados iniciais |
| `js/app.js` | Telas e cálculos |
| `js/trafego.js` | Aba Tráfego Pago (lançamentos, importação e análise) |
| `js/contratos.js` / `js/contrato-modelo.js` | Aba Contratos: gera o contrato padrão preenchido em PDF |
| `js/meta-ads.js` | Busca automática dos números na conta de anúncios do Meta (Marketing API) |
| `js/charts.js` | Gráficos |
| `js/firebase-config.js` | Configuração do projeto Firebase |
| `js/firebase-sync.js` | Login Google e sincronização com o Firestore |
| `firestore.rules` | Regras de acesso ao banco (quem pode ler/gravar) |

## Dados no Firestore

```
portalComercial/dados/clientes/{id}     um documento por cliente
portalComercial/dados/saidas/{id}       um documento por saída
portalComercial/dados/trafego/{id}      um lançamento de anúncio (tráfego pago)
portalComercial/dados/config/leads      leads por ano e mês
portalComercial/dados/config/segmentos  segmentos digitados
portalComercial/dados/config/integracaoMeta  conta e token do Meta Ads (nunca vai para o GitHub)
```

Cada alteração grava só o registro que mudou, e quem estiver com o portal aberto
recebe a mudança na hora.

## Publicar (GitHub Pages)

1. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, pasta `/ (root)` → **Save**.
2. Depois de 1–2 minutos o site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.
3. No Firebase: **Authentication → Settings → Authorized domains → Add domain** e adicione
   `SEU-USUARIO.github.io`.

## Dar acesso a alguém

Edite a lista de e-mails em `firestore.rules`, cole o conteúdo no Console do Firebase
(**Firestore Database → Regras**) e clique em **Publicar**.

## Abrir sem internet

Abrindo o `index.html` direto no computador (ou pelo `abrir-portal.bat`) o portal funciona
sem login, usando apenas os dados guardados naquele navegador — sem sincronizar com o banco.
