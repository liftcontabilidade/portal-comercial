/* ==========================================================================
   FUNIS — dados dos funis do RD Station CRM (Funil Comercial, Prospecção Ativa)
   --------------------------------------------------------------------------
   O RD Station CRM não deixa o site ler a API direto do navegador (CORS).
   Por isso a leitura passa por um "conector" (Google Apps Script) criado na
   conta Google da LIFT: ele guarda o token do RD e devolve as negociações.
   O endereço do conector e a chave ficam no banco (config/integracaoCRM).

   Para cada funil e período (mês ou semana, pela data de criação da
   negociação): negociações em aberto por etapa (orgânico × tráfego pago),
   perdas na etapa em que foram perdidas, ganhos e conversão.
   ========================================================================== */
const CRM_STORAGE_LOCAL = 'lift_comercial_crm';
const CRM_INTERVALO = 5 * 60 * 1000;

const Funis = {
    cfg: null, cfgRecebida: false, funis: null, dados: new Map(), carregando: new Set(),
    erro: '', ultima: null, timer: null, abertos: new Set(), _teste: null
};

const crmNuvem = () => !!window.LIFT_FIREBASE_CONFIG && location.protocol !== 'file:';
const crmConectado = () => !!(Funis.cfg && Funis.cfg.url && Funis.cfg.chave);

/* ---------- Código do conector (Google Apps Script) ---------- */
function crmCodigoConector(chave, token) {
    return `/**
 * Conector RD Station CRM -> Portal Comercial LIFT
 * 1) Confira o token do RD Station CRM na linha TOKEN_RD.
 * 2) Escolha a função "autorizar" ao lado de Depuração e clique em Executar (autorize).
 * 3) Implantar > Nova implantação > App da Web
 *    Executar como: Eu | Quem pode acessar: Qualquer pessoa
 */
const TOKEN_RD = '${(token || '').replace(/[^A-Za-z0-9_-]/g, '') || 'COLE_AQUI_O_TOKEN_DO_RD_STATION_CRM'}';
const CHAVE = '${chave}';
const API = 'https://crm.rdstation.com/api/v1/';

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.chave !== CHAVE) return resposta({ erro: 'Chave inválida.' });
    if (TOKEN_RD.indexOf('COLE_AQUI') === 0) return resposta({ erro: 'O token do RD Station CRM não foi colado no conector.' });
    if (p.acao === 'funis') return resposta({ funis: listarFunis() });
    if (p.acao === 'negociacoes') return resposta({ negociacoes: listarNegociacoes(p.funil, p.inicio, p.fim, p.por) });
    return resposta({ ok: true });
  } catch (err) {
    return resposta({ erro: String((err && err.message) || err) });
  }
}

function rd(caminho, params, tentativa) {
  const q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  const url = API + caminho + '?token=' + encodeURIComponent(TOKEN_RD) + (q ? '&' + q : '');
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = r.getResponseCode();
  if (code === 401 || code === 403) throw new Error('Token do RD Station CRM inválido ou sem permissão.');
  if (code === 429 && (tentativa || 0) < 3) { Utilities.sleep(2000); return rd(caminho, params, (tentativa || 0) + 1); }
  if (code >= 400) throw new Error('RD Station CRM respondeu ' + code + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}

function listarFunis() {
  const d = rd('deal_pipelines', {});
  const lista = Array.isArray(d) ? d : (d.deal_pipelines || []);
  return lista.map(function (f) {
    return {
      id: f.id || f._id, nome: f.name,
      etapas: (f.deal_stages || []).map(function (s) { return { id: s.id || s._id, nome: s.name, ordem: s.order }; })
    };
  });
}

function listarNegociacoes(funil, inicio, fim, por) {
  // por = 'fechamento': negociações GANHAS com data de venda no período; senão, criadas no período
  const cache = CacheService.getScriptCache();
  const chaveCache = ['n', funil, inicio, fim, por || ''].join('|');
  const salvo = cache.get(chaveCache);
  if (salvo) return JSON.parse(salvo);
  const todas = [];
  for (var pagina = 1; pagina <= 60; pagina++) {
    const filtro = { deal_pipeline_id: funil, start_date: inicio + 'T00:00:00', end_date: fim + 'T23:59:59', limit: 200, page: pagina };
    if (por === 'fechamento') { filtro.win = 'true'; filtro.closed_at_period = 'true'; } else { filtro.created_at_period = 'true'; }
    const d = rd('deals', filtro);
    const lista = d.deals || [];
    lista.forEach(function (n) {
      todas.push({
        id: n.id || n._id, nome: n.name, criada: n.created_at, fechada: n.closed_at, ganha: n.win, pausada: n.hold,
        etapa: n.deal_stage ? (n.deal_stage.id || n.deal_stage._id) : null, etapaNome: n.deal_stage ? n.deal_stage.name : '',
        fonte: n.deal_source ? n.deal_source.name : '', campanha: n.campaign ? n.campaign.name : '',
        motivoPerda: n.deal_lost_reason ? n.deal_lost_reason.name : '', responsavel: n.user ? n.user.name : ''
      });
    });
    if (!d.has_more || !lista.length) break;
  }
  try { cache.put(chaveCache, JSON.stringify(todas), 60); } catch (e) { }
  return todas;
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Rode esta função uma vez pelo botão Executar para autorizar o acesso ao RD Station CRM
function autorizar() {
  const funis = listarFunis();
  Logger.log('Conexão OK: ' + funis.length + ' funis encontrados no RD Station CRM.');
}
`;
}

function crmGerarChave() {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 28);
}

/* ---------- Configuração ---------- */
function crmCarregarLocal() {
    if (crmNuvem()) return;
    try { Funis.cfg = JSON.parse(localStorage.getItem(CRM_STORAGE_LOCAL)) || null; } catch (e) { Funis.cfg = null; }
    Funis.cfgRecebida = true;
}

async function crmSalvarConfig(cfg) {
    if (crmNuvem()) {
        if (!(window.LiftCloud && window.LiftCloud.salvarConfigCRM)) throw new Error('sem conexão com o banco');
        await window.LiftCloud.salvarConfigCRM(cfg);
    } else {
        try { cfg ? localStorage.setItem(CRM_STORAGE_LOCAL, JSON.stringify(cfg)) : localStorage.removeItem(CRM_STORAGE_LOCAL); } catch (e) { /* ignora */ }
    }
    Funis.cfg = cfg;
}

window.aplicarConfigCRM = function (cfg) {
    const antes = Funis.cfg ? Funis.cfg.url + Funis.cfg.chave : '';
    Funis.cfg = cfg;
    Funis.cfgRecebida = true;
    if (antes !== (cfg ? cfg.url + cfg.chave : '')) { Funis.funis = null; Funis.dados.clear(); }
    if (AppState.currentView === 'funis') renderFunisView();
    crmAgendar(1500);
};

/* ---------- Chamadas ao conector ---------- */
async function crmChamar(params, cfg = Funis.cfg) {
    const url = new URL(cfg.url);
    Object.entries({ ...params, chave: cfg.chave }).forEach(([k, v]) => url.searchParams.set(k, v));
    let json;
    try {
        const r = await fetch(url.toString(), { redirect: 'follow' });
        json = await r.json();
    } catch (e) {
        throw new Error('Não foi possível falar com o conector. Confira o endereço e se a implantação está como "Qualquer pessoa".');
    }
    if (json.erro) throw new Error(json.erro);
    return json;
}

const crmChaveJanela = (funilId, j) => `${funilId}|${j.ini}|${j.fim}`;

async function crmCarregarJanela(j, forcar = false, alvo = null) {
    if (!crmConectado()) return;
    let buscou = false;
    const erroAntes = Funis.erro;
    try {
        if (!Funis.funis || forcar) {
            // No portal, "relacionamento" aparece como "Networking"
            Funis.funis = ((await crmChamar({ acao: 'funis' })).funis || []).map(f => ({ ...f, nome: trocarRelacionamento(f.nome), etapas: (f.etapas || []).map(e => ({ ...e, nome: trocarRelacionamento(e.nome) })) }));
            buscou = true;
        }
        const escolhidos = alvo ? alvo() : crmFunisEscolhidos();
        await Promise.all(escolhidos.map(async f => {
            const k = crmChaveJanela(f.id, j);
            if (Funis.carregando.has(k)) return;
            const atual = Funis.dados.get(k);
            if (atual && !forcar && Date.now() - atual.em < CRM_INTERVALO) return;
            Funis.carregando.add(k);
            buscou = true;
            if (AppState.currentView === 'funis') crmRenderStatus();
            try {
                const [r, vendas] = await Promise.all([
                    crmChamar({ acao: 'negociacoes', funil: f.id, inicio: j.ini, fim: j.fim }),
                    crmVendasDoFunil(f, forcar)
                ]);
                // Ganho: vendas cuja data (do cadastro do portal, quando o cliente existe lá) cai no período
                const naJanela = (n) => { const d = crmDataVenda(n); return d >= j.ini && d <= j.fim; };
                Funis.dados.set(k, { em: Date.now(), lista: (r.negociacoes || []).map(crmRotular), ganhas: vendas.filter(naJanela) });
            } finally { Funis.carregando.delete(k); }
        }));
        if (buscou) { Funis.erro = ''; Funis.ultima = new Date(); }
    } catch (e) {
        Funis.erro = e.message || String(e);
    }
    // Só redesenha quando algo foi buscado (evita repetir sem parar enquanto carrega)
    if ((buscou || Funis.erro !== erroAntes) && AppState.currentView === 'funis') renderFunisView();
    if ((buscou || Funis.erro !== erroAntes) && AppState.currentView === 'trafego' && AppState.trafegoAba === 'canais') renderCanaisView();
    if ((buscou || Funis.erro !== erroAntes) && AppState.currentView === 'prospeccao' && typeof renderProspeccaoView === 'function') renderProspeccaoView();
    if ((buscou || Funis.erro !== erroAntes) && AppState.currentView === 'oportunidades' && typeof renderOportunidadesView === 'function') renderOportunidadesView();
}

const crmRotular = (n) => ({ ...n, fonte: trocarRelacionamento(n.fonte), etapaNome: trocarRelacionamento(n.etapaNome), campanha: trocarRelacionamento(n.campanha) });

// Todas as vendas (negociações ganhas) do funil, de qualquer data — usadas para achar o mês certo de cada uma
async function crmVendasDoFunil(f, forcar = false) {
    if (!Funis.vendas) Funis.vendas = new Map();
    const atual = Funis.vendas.get(String(f.id));
    if (atual && !forcar && Date.now() - atual.em < CRM_INTERVALO) return atual.lista;
    if (atual && atual.promessa) return atual.promessa;
    const promessa = crmChamar({ acao: 'negociacoes', funil: f.id, inicio: '2015-01-01', fim: trIso(new Date()), por: 'fechamento' })
        .then(g => {
            // Conector antigo ignora "por=fechamento" e devolve as negociações criadas (com abertas no meio)
            Funis.conectorAntigo = (g.negociacoes || []).some(n => n.ganha !== true);
            const lista = (g.negociacoes || []).filter(n => n.ganha === true).map(crmRotular);
            Funis.vendas.set(String(f.id), { em: Date.now(), lista });
            return lista;
        })
        .catch(e => { Funis.vendas.delete(String(f.id)); throw e; });
    Funis.vendas.set(String(f.id), { ...(atual || {}), em: atual ? atual.em : 0, promessa, lista: atual ? atual.lista : [] });
    return promessa;
}

/* Nome comparável (sem acento, sem LTDA/ME/EPP etc.) para achar o cliente do portal */
function crmNomeComparavel(nome) {
    return crmSemAcento(nome).replace(/\b(ltda|me|epp|eireli|s ?a|ss|mei|cia)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
// Busca pelo nome: exato; senão, um nome que comece com o outro (ex.: "Fillum Gestão" ↔ "Fillum Gestão CE")
function crmAcharPorNome(mapa, chave) {
    if (!chave) return null;
    if (mapa.has(chave)) return mapa.get(chave);
    let melhor = null, tam = 0;
    for (const [k, v] of mapa) {
        if (k.length < 6) continue;
        if ((chave.startsWith(k + ' ') || k.startsWith(chave + ' ')) && k.length > tam) { melhor = v; tam = k.length; }
    }
    return melhor;
}
function crmMapaClientesPortal() {
    if (Funis._mapaCli && Date.now() - Funis._mapaCli.em < 1500) return Funis._mapaCli.mapa;
    const mapa = new Map();
    (AppState.clientes || []).forEach(c => { const k = crmNomeComparavel(c.nome); if (k) mapa.set(k, c); });
    Funis._mapaCli = { em: Date.now(), mapa };
    return mapa;
}
const crmDataCliente = (c) => {
    if (c.dataEntrada && /^\d{4}-\d{2}-\d{2}/.test(c.dataEntrada)) return c.dataEntrada.slice(0, 10);
    const m = String(c.mesEntrada || '').match(/^(\d{2})\/(\d{4})$/);
    return m ? `${m[2]}-${m[1]}-01` : '';
};
// Data da venda: a data de entrada do cliente no portal (aba Clientes) quando ele está cadastrado lá;
// senão, a data em que a negociação foi marcada como ganha no RD.
// (Ex.: clientes antigos importados no RD de uma vez só aparecem todos com a mesma data de venda.)
function crmDataVenda(n) {
    const c = crmAcharPorNome(crmMapaClientesPortal(), crmNomeComparavel(n.nome));
    return (c && crmDataCliente(c)) || String(n.fechada || '').slice(0, 10);
}

function crmAgendar(atraso = 0) {
    clearTimeout(Funis.timer);
    if (!crmConectado()) return;
    Funis.timer = setTimeout(async () => {
        await crmCarregarJanela(funisJanelaAtual(), true);
        crmAgendar(CRM_INTERVALO);
    }, atraso);
}

/* ---------- Cálculo do funil ---------- */
function crmFunisEscolhidos() {
    const todos = Funis.funis || [];
    const ids = Funis.cfg && Array.isArray(Funis.cfg.funis) && Funis.cfg.funis.length ? Funis.cfg.funis : null;
    if (ids) return todos.filter(f => ids.includes(String(f.id)));
    const padrao = todos.filter(f => /funil comercial|prospec/i.test(f.nome || ''));
    return padrao.length ? padrao : todos;
}

function crmSeparaOrigem(f) {
    const lista = Funis.cfg && Funis.cfg.separar;
    if (Array.isArray(lista)) return lista.includes(String(f.id));
    return !/prospec/i.test(f.nome || '');
}

// Regra da LIFT: Tráfego Pago = negociação com Fonte "Anúncio"; todo o resto é Orgânico
const crmSemAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function crmEhPago(n) {
    return /anuncio/.test(crmSemAcento(n.fonte));
}

// Ganho = vendas com data de venda no período (mesmo que a negociação tenha sido criada antes)
function crmMontarFunil(f, lista, ganhas = []) {
    const ehGanho = (nome) => /^ganh/i.test(String(nome || '').trim());
    // "Ganho" vira a linha de vendas; a etapa "Perca" não é etapa do funil (as perdas ficam na coluna Perca)
    const ehPerca = (nome) => /^(perca|perda|perdid)/i.test(String(nome || '').trim());
    const etapas = (f.etapas || []).slice().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).filter(e => !ehGanho(e.nome) && !ehPerca(e.nome));
    const linhas = etapas.map(e => ({ id: String(e.id), nome: e.nome, organico: 0, pago: 0, perca: 0, negocios: [] }));
    const porId = new Map(linhas.map(l => [l.id, l]));
    const ganho = { id: '__ganho__', nome: 'Ganho', organico: 0, pago: 0, perca: 0, negocios: [], ganho: true };
    ganhas.forEach(n => {
        ganho[crmEhPago(n) ? 'pago' : 'organico']++;
        ganho.negocios.push({ ...n, situacao: 'ganha' });
    });
    lista.forEach(n => {
        if (n.ganha === true) return; // entra no Ganho do período em que foi vendida
        let linha = porId.get(String(n.etapa));
        if (!linha && ehGanho(n.etapaNome)) linha = null;
        if (!linha) {
            // Etapa que não está mais no funil: cria a linha para não perder a contagem
            linha = { id: String(n.etapa), nome: n.etapaNome || 'Sem etapa', organico: 0, pago: 0, perca: 0, negocios: [] };
            porId.set(linha.id, linha); linhas.push(linha);
        }
        if (n.ganha === false) { linha.perca++; linha.negocios.push({ ...n, situacao: 'perdida' }); }
        else { linha[crmEhPago(n) ? 'pago' : 'organico']++; linha.negocios.push({ ...n, situacao: n.pausada ? 'pausada' : 'aberta' }); }
    });
    linhas.push(ganho);
    linhas.forEach(l => { l.total = l.organico + l.pago + l.perca; });
    const totalGeral = linhas.reduce((s, l) => s + l.total, 0);
    ganho.conversao = totalGeral ? (ganho.total / totalGeral) * 100 : 0;
    return { linhas, totalGeral, ganhos: ganho.total, perdas: linhas.reduce((s, l) => s + l.perca, 0) };
}

/* ---------- Tela ---------- */
function funisJanelaAtual() {
    const tipo = AppState.funisTipo || 'mes';
    if (!AppState.funisRef) AppState.funisRef = trIso(new Date());
    return trJanela(tipo, AppState.funisRef);
}

function renderFunisView() {
    const box = document.getElementById('fn-conteudo');
    if (!box) return;
    const tipo = AppState.funisTipo || 'mes';
    const j = funisJanelaAtual();
    document.querySelectorAll('#fn-tipos button').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
    const lbl = document.getElementById('fn-periodo-label');
    if (lbl) lbl.textContent = tipo === 'mes' ? j.label : `Semana de ${trCompleta(j.ini)} a ${trCompleta(j.fim)}`;
    crmRenderStatus();

    if (!Funis.cfgRecebida) { box.innerHTML = '<div class="home-empty">Carregando…</div>'; return; }
    if (!crmConectado()) {
        box.innerHTML = `<div class="opp-card fn-vazio"><h3>Conecte o RD Station CRM</h3>
            <p>Os funis são puxados direto do RD Station CRM. A conexão é feita uma vez só, por um conector gratuito na conta Google da LIFT.</p>
            <button type="button" class="btn-lift-action" data-fn-config>Conectar RD Station CRM</button></div>`;
        return;
    }
    if (!Funis.funis) {
        box.innerHTML = Funis.erro ? `<div class="tri-erro">${escHtml(Funis.erro)}</div>` : '<div class="home-empty">Buscando os funis no RD Station CRM…</div>';
        crmCarregarJanela(j);
        return;
    }
    const escolhidos = crmFunisEscolhidos();
    const faltam = escolhidos.some(f => !Funis.dados.has(crmChaveJanela(f.id, j)));
    if (faltam) crmCarregarJanela(j);
    const aviso = Funis.conectorAntigo ? '<div class="tri-erro">O conector está com o código antigo: o Ganho ainda conta pela data de criação. Em ⚙ Configurar, copie o código novo, cole no Apps Script e implante uma <b>Nova versão</b>.</div>' : '';
    box.innerHTML = aviso + (Funis.erro ? `<div class="tri-erro">${escHtml(Funis.erro)}</div>` : '') + escolhidos.map(f => {
        const d = Funis.dados.get(crmChaveJanela(f.id, j));
        const titulo = `${escHtml(f.nome)} — ${tipo === 'mes' ? escHtml(j.label) : `${trCurta(j.ini)} a ${trCompleta(j.fim)}`}`;
        if (!d) return `<div class="opp-card fn-card"><div class="opp-card-head"><span class="dash-section-title">${titulo}</span></div><div class="home-empty">Carregando…</div></div>`;
        const r = crmMontarFunil(f, d.lista, d.ganhas || []);
        const separa = crmSeparaOrigem(f);
        const cab = separa ? '<th>Orgânico</th><th>Tráfego Pago</th>' : `<th>${escHtml(f.nome)}</th>`;
        const linhas = r.linhas.map(l => {
            const k = f.id + '|' + l.id;
            const aberto = Funis.abertos.has(k);
            const nums = separa ? `<td>${l.organico}</td><td>${l.pago}</td>` : `<td>${l.organico + l.pago}</td>`;
            const conv = l.ganho ? formatPct(l.conversao, 2) : '—';
            const det = aberto ? `<tr class="fn-det"><td colspan="${separa ? 6 : 5}">${crmListaNegocios(l.negocios)}</td></tr>` : '';
            return `<tr class="fn-linha ${l.ganho ? 'ganho' : ''} ${aberto ? 'aberto' : ''}" data-fn-linha="${escHtml(k)}"><td class="fn-etapa"><span class="ind-seta">›</span>${escHtml(l.nome)}</td>${nums}<td class="fn-perca">${l.perca}</td><td class="fn-total">${l.total}</td><td>${conv}</td></tr>${det}`;
        }).join('');
        return `<div class="opp-card fn-card">
            <div class="opp-card-head fn-head"><span class="dash-section-title">${titulo}</span>
                <span class="fn-resumo"><b>${r.totalGeral}</b> negociações · <b class="fn-verde">${r.ganhos}</b> ganhas · <b class="fn-vermelho">${r.perdas}</b> perdidas</span></div>
            <div class="tr-tabela-wrap"><table class="tr-tabela fn-tabela">
                <thead><tr><th class="tr-metrica">Etapa</th>${cab}<th class="fn-perca-th">Perca</th><th>Total</th><th>Conversão Fechamento (%)</th></tr></thead>
                <tbody>${linhas}</tbody></table></div>
            <div class="tr-legenda">A coluna Perca não é uma etapa do funil: indica quantas negociações foram perdidas em cada etapa. Clique numa etapa para ver as negociações.</div>
        </div>`;
    }).join('');
}

// Lista das negociações de uma etapa: uma embaixo da outra, com a origem ao lado.
// Laranja = veio de anúncio · Azul = orgânico · Vermelho = perdida
function crmListaNegocios(negocios, semLegenda = false) {
    if (!negocios.length) return '<div class="fn-neg-vazio">Nenhuma negociação nesta etapa.</div>';
    const ordem = { ganha: 0, aberta: 1, pausada: 1, perdida: 2 };
    const lista = negocios.slice().sort((a, b) => (ordem[a.situacao] ?? 1) - (ordem[b.situacao] ?? 1) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    return `<div class="fn-lista">${lista.map(n => {
        const perdida = n.situacao === 'perdida';
        const pago = crmEhPago(n);
        const cls = perdida ? 'perdida' : pago ? 'anuncio' : 'organico';
        const origem = n.fonte || 'Sem origem';
        const extra = perdida ? `Perdida${n.motivoPerda ? ' · ' + n.motivoPerda : ''}` : n.situacao === 'pausada' ? 'Pausada' : n.situacao === 'ganha' ? 'Ganha' : '';
        return `<div class="fn-item ${cls}">
            <span class="fn-item-nome">${escHtml(n.nome || 'Sem nome')}${n.responsavel ? `<small>${escHtml(n.responsavel)}</small>` : ''}</span>
            ${extra ? `<span class="fn-item-sit">${escHtml(extra)}</span>` : '<span></span>'}
            <span class="fn-item-origem">${escHtml(origem)}${!perdida ? `<small>${pago ? 'Tráfego Pago' : 'Orgânico'}</small>` : ''}</span>
        </div>`;
    }).join('')}</div>
    ${semLegenda ? '' : `<div class="fn-legenda"><span class="anuncio">Anúncio</span><span class="organico">Orgânico</span><span class="perdida">Perdida</span></div>`}`;
}

function crmRenderStatus() {
    const st = document.getElementById('fn-status');
    if (!st) return;
    if (!crmConectado()) { st.innerHTML = ''; return; }
    const carregando = Funis.carregando.size > 0;
    const txt = carregando ? 'Buscando no RD Station CRM…' : Funis.erro ? Funis.erro
        : Funis.ultima ? `Ao vivo com o RD Station CRM · atualizado às ${Funis.ultima.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'RD Station CRM conectado';
    const cls = carregando ? 'aviso' : Funis.erro ? 'erro' : 'ok';
    st.innerHTML = `<span class="tr-meta-pill ${cls}" title="${escHtml(txt)}"><i></i><span>${escHtml(txt)}</span></span>
        <button type="button" class="tr-btn-icone" data-fn-sync title="Atualizar agora">↻</button>
        <button type="button" class="tr-btn-icone" data-fn-config title="Configurar conexão">⚙</button>`;
}

/* ---------- Janela de configuração ---------- */
function crmAbrirConfig() {
    const cfg = Funis.cfg || {};
    const chave = cfg.chave || crmGerarChave();
    document.getElementById('crm-url').value = cfg.url || '';
    document.getElementById('crm-chave').value = chave;
    document.getElementById('crm-token').value = '';
    document.getElementById('crm-codigo').value = crmCodigoConector(chave);
    document.getElementById('crm-info').innerHTML = '';
    document.getElementById('crm-opcoes').innerHTML = '';
    document.getElementById('crm-salvar').disabled = true;
    document.getElementById('crm-desconectar').classList.toggle('oculto', !crmConectado());
    Funis._teste = null;
    document.getElementById('modal-crm-config').classList.add('active');
    if (crmConectado()) crmTestar();
}

async function crmTestar() {
    const info = document.getElementById('crm-info');
    const opc = document.getElementById('crm-opcoes');
    const cfg = { url: document.getElementById('crm-url').value.trim(), chave: document.getElementById('crm-chave').value.trim() };
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(cfg.url)) { info.innerHTML = '<span class="tr-txt-ruim">Cole o endereço do App da Web do conector (começa com https://script.google.com/macros/s/…/exec).</span>'; return; }
    info.textContent = 'Testando…';
    opc.innerHTML = '';
    try {
        const funis = (await crmChamar({ acao: 'funis' }, cfg)).funis || [];
        if (!funis.length) throw new Error('O conector respondeu, mas nenhum funil foi encontrado no RD Station CRM.');
        // Fontes e campanhas usadas nos últimos 90 dias (para escolher o que é tráfego pago)
        const hoje = trIso(new Date()); const ini = trIso(new Date(Date.now() - 90 * 86400000));
        const atuais = Funis.cfg && Array.isArray(Funis.cfg.funis) ? Funis.cfg.funis : funis.filter(f => /funil comercial|prospec/i.test(f.nome)).map(f => String(f.id));
        const fontes = new Map();
        for (const f of funis.filter(x => atuais.includes(String(x.id)) || !atuais.length)) {
            const negs = (await crmChamar({ acao: 'negociacoes', funil: f.id, inicio: ini, fim: hoje }, cfg)).negociacoes || [];
            negs.forEach(n => { if (n.fonte) fontes.set(n.fonte, (fontes.get(n.fonte) || 0) + 1); });
        }
        Funis._teste = { ...cfg, funisLista: funis };
        const separar = Funis.cfg && Array.isArray(Funis.cfg.separar) ? Funis.cfg.separar : funis.filter(f => !/prospec/i.test(f.nome)).map(f => String(f.id));
        info.innerHTML = `<span class="tr-txt-bom">Conexão OK:</span> ${funis.length} ${funis.length === 1 ? 'funil encontrado' : 'funis encontrados'} no RD Station CRM.`;
        opc.innerHTML = `
            <div class="crm-bloco"><div class="ct-secao">Funis que aparecem no portal</div>
                ${funis.map(f => `<label class="crm-op"><input type="checkbox" name="crm-funil" value="${escHtml(f.id)}" ${(!atuais.length || atuais.includes(String(f.id))) ? 'checked' : ''}> <b>${escHtml(f.nome)}</b> <small>${(f.etapas || []).length} etapas</small>
                    <span class="crm-sep"><input type="checkbox" name="crm-separar" value="${escHtml(f.id)}" ${separar.includes(String(f.id)) ? 'checked' : ''}> separar Orgânico × Tráfego Pago</span></label>`).join('')}
            </div>
            <div class="crm-bloco"><div class="ct-secao">Orgânico × Tráfego Pago</div>
                <p class="tr-form-dica">Conta como <b>Tráfego Pago</b> a negociação com <b>Fonte = Anúncio</b>; todas as outras contam como <b>Orgânico</b>.</p>
                ${fontes.size ? [...fontes.entries()].sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => `<div class="crm-op">${/anuncio/.test(crmSemAcento(nome)) ? '<span class="tr-txt-bom">Tráfego Pago</span>' : '<span class="tr-txt-neutro">Orgânico</span>'} · ${escHtml(nome)} <small>${qtd} negociações em 90 dias</small></div>`).join('') : ''}
            </div>`;
        document.getElementById('crm-salvar').disabled = false;
    } catch (e) {
        info.innerHTML = `<span class="tr-txt-ruim">${escHtml(e.message)}</span>`;
    }
}

async function crmSalvarDaTela() {
    const t = Funis._teste;
    if (!t) return showToast('Clique em "Testar conexão" antes de salvar.');
    const marcados = (nome) => [...document.querySelectorAll(`#crm-opcoes input[name="${nome}"]:checked`)].map(i => i.value);
    const cfg = {
        url: t.url, chave: t.chave, funis: marcados('crm-funil'), separar: marcados('crm-separar'),
        atualizadoPor: (document.getElementById('cloud-user') || {}).textContent || '', atualizadoEm: new Date().toISOString()
    };
    if (!cfg.funis.length) return showToast('Escolha pelo menos um funil.');
    try { await crmSalvarConfig(cfg); } catch (e) { return showToast('Não foi possível salvar: ' + (e.message || e)); }
    Funis.funis = t.funisLista; Funis.dados.clear(); Funis.erro = '';
    document.getElementById('modal-crm-config').classList.remove('active');
    showToast('RD Station CRM conectado. Buscando os funis…');
    renderFunisView();
    crmAgendar(CRM_INTERVALO);
}

async function crmDesconectar() {
    if (!confirm('Desconectar o RD Station CRM do portal?')) return;
    try { await crmSalvarConfig(null); } catch (e) { return showToast('Não foi possível desconectar: ' + (e.message || e)); }
    Funis.funis = null; Funis.dados.clear(); clearTimeout(Funis.timer);
    document.getElementById('modal-crm-config').classList.remove('active');
    renderFunisView();
}

function setupFunis() {
    const painel = document.getElementById('panel-funis');
    if (!painel) return;
    crmCarregarLocal();
    painel.addEventListener('click', (e) => {
        if (e.target.closest('[data-fn-config]')) return crmAbrirConfig();
        if (e.target.closest('[data-fn-sync]')) { crmCarregarJanela(funisJanelaAtual(), true); return renderFunisView(); }
        const linha = e.target.closest('[data-fn-linha]');
        if (linha) { const k = linha.dataset.fnLinha; Funis.abertos.has(k) ? Funis.abertos.delete(k) : Funis.abertos.add(k); renderFunisView(); }
    });
    document.querySelectorAll('#fn-tipos button').forEach(b => b.addEventListener('click', () => {
        const j = funisJanelaAtual();
        AppState.funisTipo = b.dataset.tipo;
        AppState.funisRef = (j.ini <= trIso(new Date()) && j.fim >= trIso(new Date())) ? trIso(new Date()) : j.ini;
        renderFunisView();
    }));
    document.getElementById('fn-ant').addEventListener('click', () => { AppState.funisRef = trDeslocar(AppState.funisTipo || 'mes', funisJanelaAtual(), -1).ini; renderFunisView(); });
    document.getElementById('fn-prox').addEventListener('click', () => { AppState.funisRef = trDeslocar(AppState.funisTipo || 'mes', funisJanelaAtual(), 1).ini; renderFunisView(); });
    document.getElementById('crm-testar').addEventListener('click', crmTestar);
    document.getElementById('crm-desconectar').addEventListener('click', crmDesconectar);
    document.getElementById('crm-form').addEventListener('submit', (e) => { e.preventDefault(); crmSalvarDaTela(); });
    document.getElementById('crm-nova-chave').addEventListener('click', () => {
        if (!confirm('Gerar uma chave nova? Depois será preciso colar o código atualizado no conector e implantar de novo.')) return;
        const k = crmGerarChave();
        document.getElementById('crm-chave').value = k;
        document.getElementById('crm-codigo').value = crmCodigoConector(k, document.getElementById('crm-token').value.trim());
    });
    // Token do RD: entra direto no código do conector (não fica salvo no portal)
    document.getElementById('crm-token').addEventListener('input', (e) => {
        document.getElementById('crm-codigo').value = crmCodigoConector(document.getElementById('crm-chave').value, e.target.value.trim());
    });
    document.getElementById('crm-copiar').addEventListener('click', async () => {
        const ta = document.getElementById('crm-codigo');
        try { await navigator.clipboard.writeText(ta.value); } catch (e) { ta.select(); document.execCommand('copy'); }
        showToast('Código do conector copiado.');
    });
    const aoVoltar = () => {
        if (document.visibilityState === 'visible' && AppState.currentView === 'funis' && crmConectado()) crmCarregarJanela(funisJanelaAtual());
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    crmAgendar(3000);
}
document.addEventListener('DOMContentLoaded', setupFunis);


/* ==========================================================================
   CANAIS DE AQUISIÇÃO (aba Tráfego Pago → "Canais de aquisição")
   Quantos leads e quantos clientes vieram de cada canal (Fonte da negociação
   no RD Station CRM), por semana ou por mês.
   Leads = negociações criadas no período · Clientes = vendas (ganhas) com
   data de venda no período.
   ========================================================================== */
function canaisJanela() {
    const tipo = AppState.canaisTipo || 'mes';
    if (!AppState.canaisRef) AppState.canaisRef = trIso(new Date());
    return trJanela(tipo, AppState.canaisRef);
}

function canaisFunis() {
    const todos = Funis.funis || [];
    const sel = AppState.canaisFunil || 'comercial';
    if (sel === 'todos') return todos;
    if (sel === 'comercial') { const c = todos.filter(f => /comercial/i.test(f.nome || '')); return c.length ? c : todos; }
    return todos.filter(f => String(f.id) === sel);
}

function canaisDados(j) {
    const funis = canaisFunis();
    if (!funis.length) return null;
    const leads = [], vendasRD = [];
    for (const f of funis) {
        const d = Funis.dados.get(crmChaveJanela(f.id, j));
        if (!d) return null;
        leads.push(...d.lista);
        vendasRD.push(...((Funis.vendas && Funis.vendas.get(String(f.id)) || {}).lista || []));
    }
    // Clientes = cadastrados na aba Clientes do portal com entrada no período.
    // Canal = Fonte da negociação ganha no RD (achada pelo nome); se não achar, a Origem do cadastro no portal.
    const fontePorNome = new Map(vendasRD.map(n => [crmNomeComparavel(n.nome), n]));
    const clientes = (AppState.clientes || []).filter(c => { const d = crmDataCliente(c); return d && d >= j.ini && d <= j.fim; }).map(c => {
        const rd = crmAcharPorNome(fontePorNome, crmNomeComparavel(c.nome));
        return { id: c.id, nome: c.nome, fonte: (rd && rd.fonte) || trocarRelacionamento(c.origemCliente) || '', responsavel: c.vendedor || (rd && rd.responsavel) || '', situacao: 'ganha', ganha: true, fechada: crmDataCliente(c) };
    });
    // Leads = tudo que chegou no período: negociações criadas no RD + os clientes que fecharam (sem contar duas vezes).
    // Negociação do RD de um cliente já cadastrado no portal entra no mês de entrada dele (aba Clientes), junto com o Ganho.
    const mapaPortal = crmMapaClientesPortal();
    const leadsRD = leads.filter(n => !crmAcharPorNome(mapaPortal, crmNomeComparavel(n.nome)));
    leads.length = 0;
    leads.push(...leadsRD, ...clientes);
    const canais = new Map();
    const pega = (nome) => {
        const k = (nome || '').trim() || 'Sem origem';
        if (!canais.has(k)) canais.set(k, { nome: k, leads: 0, clientes: 0, listaClientes: [], listaLeads: [] });
        return canais.get(k);
    };
    leads.forEach(n => { const c = pega(n.fonte); c.leads++; c.listaLeads.push(n); });
    clientes.forEach(n => { const c = pega(n.fonte); c.clientes++; c.listaClientes.push(n); });
    const lista = [...canais.values()].sort((a, b) => b.clientes - a.clientes || b.leads - a.leads || a.nome.localeCompare(b.nome, 'pt-BR'));
    return { lista, totalLeads: leads.length, totalClientes: clientes.length };
}

function renderCanaisView() {
    const box = document.getElementById('cn-conteudo');
    if (!box) return;
    const tipo = AppState.canaisTipo || 'mes';
    const j = canaisJanela();
    document.querySelectorAll('#cn-tipos button').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
    const lbl = document.getElementById('cn-periodo-label');
    if (lbl) lbl.textContent = tipo === 'mes' ? j.label : `Semana de ${trCompleta(j.ini)} a ${trCompleta(j.fim)}`;
    const sel = document.getElementById('cn-funil');
    if (sel && Funis.funis) {
        const atual = AppState.canaisFunil || 'comercial';
        sel.innerHTML = '<option value="comercial">Funil Comercial</option><option value="todos">Todos os funis</option>' +
            Funis.funis.filter(f => !/comercial/i.test(f.nome || '')).map(f => `<option value="${escHtml(f.id)}">${escHtml(f.nome)}</option>`).join('');
        sel.value = atual;
    }
    if (!Funis.cfgRecebida) { box.innerHTML = '<div class="home-empty">Carregando…</div>'; return; }
    if (!crmConectado()) {
        box.innerHTML = `<div class="opp-card fn-vazio"><h3>Conecte o RD Station CRM</h3><p>Os canais de aquisição vêm da <b>Fonte</b> das negociações no RD Station CRM. Faça a conexão na aba <b>Funis</b>.</p><button type="button" class="btn-lift-action" onclick="switchView('funis')">Ir para Funis</button></div>`;
        return;
    }
    if (!Funis.funis) { box.innerHTML = '<div class="home-empty">Buscando no RD Station CRM…</div>'; crmCarregarJanela(j, false, canaisFunis); return; }

    // Meses do ano do período escolhido (gráfico de evolução), até o mês atual
    const ano = trData(j.ini).getFullYear();
    const hojeIso = trIso(new Date());
    const meses = Array.from({ length: 12 }, (_, i) => trJanela('mes', `${ano}-${String(i + 1).padStart(2, '0')}-01`));
    meses.filter(p => p.ini <= hojeIso).forEach(p => { if (!canaisDados(p)) crmCarregarJanela(p, false, canaisFunis); });
    if (!canaisDados(j)) crmCarregarJanela(j, false, canaisFunis);
    const d = canaisDados(j);
    if (!d) { box.innerHTML = (Funis.erro ? `<div class="tri-erro">${escHtml(Funis.erro)}</div>` : '') + '<div class="home-empty">Buscando no RD Station CRM…</div>'; return; }

    const top = d.lista.find(c => c.clientes > 0);
    const conv = d.totalLeads ? (d.totalClientes / d.totalLeads) * 100 : null;
    const maxCli = Math.max(1, ...d.lista.map(c => c.clientes));
    const maxLeads = Math.max(1, ...d.lista.map(c => c.leads));
    if (!AppState._canaisAbertos) AppState._canaisAbertos = new Set();
    const abertos = AppState._canaisAbertos;
    const ehAnuncio = (nome) => /anuncio/.test(crmSemAcento(nome));

    const linhas = d.lista.map(c => {
        const aberto = abertos.has(c.nome);
        const pct = d.totalClientes ? (c.clientes / d.totalClientes) * 100 : 0;
        const cv = c.leads ? formatPct((c.clientes / c.leads) * 100, 0) : '—';
        return `<button type="button" class="opp-row cn-row ${ehAnuncio(c.nome) ? 'anuncio' : ''} ${aberto ? 'aberto' : ''}" data-cn="${escHtml(c.nome)}">
                <span class="or-nome"><span class="ind-seta">›</span>${escHtml(c.nome)}</span>
                <span class="or-barra-cell"><span class="or-barra cn-leads"><i style="width:${(c.leads / maxLeads) * 100}%"></i></span><b>${c.leads}</b></span>
                <span class="or-barra-cell"><span class="or-barra"><i style="width:${(c.clientes / maxCli) * 100}%"></i></span><b>${c.clientes}</b></span>
                <span class="center">${cv}</span>
                <span class="center">${d.totalClientes ? formatPct(pct, 0) : '—'}</span>
            </button>
            ${aberto ? `<div class="cn-detalhe">${c.listaClientes.length ? `<div class="cn-det-tit">Clientes (vendas no período)</div>${crmListaNegocios(c.listaClientes.map(n => ({ ...n, situacao: 'ganha' })), true)}` : '<div class="fn-neg-vazio">Nenhuma venda deste canal no período.</div>'}
                ${c.listaLeads.length ? `<div class="cn-det-tit">Leads que entraram no período (${c.listaLeads.length})</div>${crmListaNegocios(c.listaLeads.map(n => ({ ...n, situacao: n.ganha === true ? 'ganha' : n.ganha === false ? 'perdida' : n.pausada ? 'pausada' : 'aberta' })))}` : ''}</div>` : ''}`;
    }).join('');

    const grafico = canaisGraficoAno(meses, ano, hojeIso);

    box.innerHTML = (Funis.erro ? `<div class="tri-erro">${escHtml(Funis.erro)}</div>` : '') + `
        <div class="opp-kpi-grid">
            <div class="opp-kpi-card accent-blue"><div><span class="opp-kpi-label">Leads no período</span><span class="opp-kpi-value">${d.totalLeads}</span><span class="opp-kpi-sub">total que chegou (inclui os que fecharam)</span></div></div>
            <div class="opp-kpi-card accent-orange"><div><span class="opp-kpi-label">Clientes (vendas)</span><span class="opp-kpi-value orange">${d.totalClientes}</span><span class="opp-kpi-sub">pela entrada na aba Clientes</span></div></div>
            <div class="opp-kpi-card accent-blue"><div><span class="opp-kpi-label">Conversão</span><span class="opp-kpi-value">${conv !== null ? formatPct(conv, 1) : '—'}</span><span class="opp-kpi-sub">clientes ÷ leads</span></div></div>
            <div class="opp-kpi-card accent-blue"><div><span class="opp-kpi-label">Canal que mais trouxe clientes</span><span class="opp-kpi-value or-kpi-nome">${top ? escHtml(top.nome) : '—'}</span><span class="opp-kpi-sub">${top ? `${top.clientes} ${top.clientes === 1 ? 'cliente' : 'clientes'}` : 'nenhuma venda no período'}</span></div></div>
        </div>
        <div class="opp-card tr-bloco">
            <div class="opp-card-head"><span class="dash-section-title">CLIENTES POR CANAL DE AQUISIÇÃO</span></div>
            <div class="opp-table">
                <div class="opp-row cn-row opp-row-head"><span>Canal (fonte no RD)</span><span>Leads</span><span>Ganho</span><span class="center">Conversão</span><span class="center">% dos clientes</span></div>
                ${linhas || '<div class="home-empty">Nenhuma negociação no período.</div>'}
            </div>
            <div class="tr-legenda">Clique num canal para ver os clientes e os leads. "Sem origem" = negociação sem Fonte preenchida no RD.</div>
        </div>
        <div class="opp-card tr-bloco">
            <div class="opp-card-head cn-graf-head"><span class="dash-section-title">EVOLUÇÃO NO ANO — ${ano}</span>
                <div class="tr-tipos" id="cn-metrica"><button type="button" data-m="clientes" class="${(AppState.canaisMetrica || 'clientes') === 'clientes' ? 'active' : ''}">Clientes</button><button type="button" data-m="leads" class="${AppState.canaisMetrica === 'leads' ? 'active' : ''}">Leads</button></div></div>
            ${grafico}
        </div>`;
    box.querySelectorAll('[data-cn]').forEach(b => b.onclick = () => {
        const k = b.dataset.cn; abertos.has(k) ? abertos.delete(k) : abertos.add(k); renderCanaisView();
    });
    box.querySelectorAll('#cn-metrica button').forEach(b => b.onclick = () => { AppState.canaisMetrica = b.dataset.m; renderCanaisView(); });
    canaisLigarGrafico(box);
}

// Cores fixas por canal (Anúncio sempre laranja)
const CN_CORES = ['#0B2545', '#2563EB', '#00A3E0', '#22C55E', '#8B5CF6', '#14B8A6', '#EAB308'];
function canaisCor(nome, idx) {
    if (/anuncio/.test(crmSemAcento(nome))) return '#F36F21';
    if (nome === 'Sem origem') return '#CBD5E1';
    if (nome === 'Outros') return '#94A3B8';
    return CN_CORES[idx % CN_CORES.length];
}

// Gráfico de barras empilhadas: um mês por barra, cada cor um canal
function canaisGraficoAno(meses, ano, hojeIso) {
    const met = AppState.canaisMetrica || 'clientes';
    const dados = meses.map(p => p.ini <= hojeIso ? canaisDados(p) : 'futuro');
    const totais = new Map();
    dados.forEach(x => { if (x && x !== 'futuro') x.lista.forEach(c => totais.set(c.nome, (totais.get(c.nome) || 0) + c[met])); });
    let nomes = [...totais.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([n]) => n);
    // Até 7 canais com cor própria; o resto vira "Outros"
    const principais = nomes.slice(0, 7);
    const temOutros = nomes.length > 7;
    if (temOutros) principais.push('Outros');
    const cores = new Map(); let ci = 0;
    principais.forEach(n => { const c = canaisCor(n, ci); if (c !== '#F36F21' && c !== '#CBD5E1' && c !== '#94A3B8') ci++; cores.set(n, c); });
    const valor = (x, nome) => {
        if (!x || x === 'futuro') return 0;
        if (nome === 'Outros') return x.lista.filter(c => !principais.includes(c.nome)).reduce((s, c) => s + c[met], 0);
        const c = x.lista.find(y => y.nome === nome); return c ? c[met] : 0;
    };
    const somas = dados.map(x => principais.reduce((s, n) => s + valor(x, n), 0));
    const max = Math.max(1, ...somas);
    const passo = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : Math.ceil(max / 5 / 50) * 50;
    const topo = Math.ceil(max / passo) * passo;
    const W = 1000, H = 300, pl = 36, pr = 10, pt = 22, pb = 30;
    const cw = W - pl - pr, ch = H - pt - pb, bw = cw / 12;
    const y = (v) => pt + ch - (v / topo) * ch;
    const carregando = dados.some(x => !x);
    let svg = '';
    for (let v = 0; v <= topo; v += passo) svg += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="cn-g-grade"/><text x="${pl - 6}" y="${y(v) + 4}" class="cn-g-eixo" text-anchor="end">${v}</text>`;
    meses.forEach((p, i) => {
        const x0 = pl + i * bw + bw * 0.18, w = bw * 0.64;
        const d = dados[i];
        let acc = 0;
        let barras = '';
        if (d && d !== 'futuro') principais.forEach(n => {
            const v = valor(d, n); if (!v) return;
            const y1 = y(acc + v), y0 = y(acc);
            barras += `<rect x="${x0}" y="${y1}" width="${w}" height="${Math.max(0, y0 - y1)}" fill="${cores.get(n)}"/>`;
            acc += v;
        });
        const rot = MESES_TR[i].slice(0, 3);
        svg += `<g class="cn-g-mes ${d === 'futuro' ? 'futuro' : ''}" data-mes="${i}"><rect x="${pl + i * bw}" y="${pt}" width="${bw}" height="${ch}" class="cn-g-alvo"/>${barras}
            ${d && d !== 'futuro' ? `<text x="${x0 + w / 2}" y="${y(acc) - 6}" class="cn-g-total" text-anchor="middle">${acc}</text>` : !d ? `<text x="${x0 + w / 2}" y="${y(0) - 6}" class="cn-g-eixo" text-anchor="middle">…</text>` : ''}
            <text x="${x0 + w / 2}" y="${H - 10}" class="cn-g-mes-rot" text-anchor="middle">${rot}</text></g>`;
    });
    const legenda = principais.map(n => `<span><i style="background:${cores.get(n)}"></i>${escHtml(n)} <b>${n === 'Outros' ? nomes.slice(7).reduce((s, x) => s + totais.get(x), 0) : totais.get(n)}</b></span>`).join('');
    // Dados para o balão ao passar o mouse
    Funis._grafico = { meses, dados, principais, cores, valor, met, ano };
    return `<div class="cn-graf">
        <div class="cn-graf-area"><svg viewBox="0 0 ${W} ${H}" class="cn-svg" role="img" aria-label="${met === 'clientes' ? 'Clientes' : 'Leads'} por canal de aquisição em ${ano}">${svg}</svg><div class="cn-graf-tip" id="cn-graf-tip"></div></div>
        <div class="cn-graf-legenda">${legenda || '<span class="fn-neg-vazio">Sem dados no ano.</span>'}</div>
        <div class="tr-legenda">${met === 'clientes' ? 'Clientes = entrada do cliente na aba Clientes do portal; o canal vem da Fonte no RD.' : 'Leads = tudo que chegou no mês (negociações criadas no RD + os que fecharam).'} Passe o mouse num mês para ver por canal; clique para abrir o mês.${carregando ? ' Carregando os meses…' : ''}</div>
    </div>`;
}

function canaisLigarGrafico(box) {
    const tip = box.querySelector('#cn-graf-tip');
    const g = Funis._grafico;
    if (!tip || !g) return;
    box.querySelectorAll('.cn-g-mes:not(.futuro)').forEach(el => {
        const i = Number(el.dataset.mes);
        el.addEventListener('mouseenter', () => {
            const d = g.dados[i];
            if (!d || d === 'futuro') return;
            const linhas = g.principais.map(n => [n, g.valor(d, n)]).filter(([, v]) => v > 0);
            const total = linhas.reduce((s, [, v]) => s + v, 0);
            tip.innerHTML = `<b>${MESES_TR[i][0].toUpperCase() + MESES_TR[i].slice(1)} ${g.ano}</b>` +
                (linhas.length ? linhas.map(([n, v]) => `<div><i style="background:${g.cores.get(n)}"></i>${escHtml(n)}<span>${v}</span></div>`).join('') : '<div>Nenhum</div>') +
                `<div class="tot">Total<span>${total} ${g.met}</span></div>`;
            const r = el.getBoundingClientRect(), pr = tip.parentElement.getBoundingClientRect();
            let left = r.left - pr.left + r.width / 2 - 100;
            left = Math.max(0, Math.min(left, pr.width - 210));
            tip.style.left = left + 'px';
            tip.classList.add('visivel');
        });
        el.addEventListener('mouseleave', () => tip.classList.remove('visivel'));
        el.addEventListener('click', () => {
            AppState.canaisTipo = 'mes';
            AppState.canaisRef = g.meses[i].ini;
            renderCanaisView();
        });
    });
}

function trocarAbaTrafego(aba) {
    AppState.trafegoAba = aba;
    try { localStorage.setItem('lift_trafego_aba', aba); } catch (e) { /* ignora */ }
    document.querySelectorAll('#tr-abas button').forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
    document.getElementById('tr-aba-anuncios').classList.toggle('oculto', aba !== 'anuncios');
    document.getElementById('tr-aba-canais').classList.toggle('oculto', aba !== 'canais');
    if (aba === 'canais') renderCanaisView(); else renderTrafegoView();
}

function setupCanais() {
    const abas = document.getElementById('tr-abas');
    if (!abas) return;
    try { AppState.trafegoAba = localStorage.getItem('lift_trafego_aba') === 'canais' ? 'canais' : 'anuncios'; } catch (e) { AppState.trafegoAba = 'anuncios'; }
    abas.querySelectorAll('button').forEach(b => b.addEventListener('click', () => trocarAbaTrafego(b.dataset.aba)));
    document.querySelectorAll('#cn-tipos button').forEach(b => b.addEventListener('click', () => {
        const j = canaisJanela();
        AppState.canaisTipo = b.dataset.tipo;
        const hoje = trIso(new Date());
        AppState.canaisRef = (j.ini <= hoje && j.fim >= hoje) ? hoje : j.ini;
        renderCanaisView();
    }));
    document.getElementById('cn-ant').addEventListener('click', () => { AppState.canaisRef = trDeslocar(AppState.canaisTipo || 'mes', canaisJanela(), -1).ini; renderCanaisView(); });
    document.getElementById('cn-prox').addEventListener('click', () => { AppState.canaisRef = trDeslocar(AppState.canaisTipo || 'mes', canaisJanela(), 1).ini; renderCanaisView(); });
    document.getElementById('cn-funil').addEventListener('change', (e) => { AppState.canaisFunil = e.target.value; renderCanaisView(); });
    document.getElementById('cn-atualizar').addEventListener('click', () => {
        [...Funis.dados.keys()].forEach(k => Funis.dados.get(k).em = 0);
        renderCanaisView();
    });
    trocarAbaTrafego(AppState.trafegoAba);
}
document.addEventListener('DOMContentLoaded', setupCanais);


/* ==========================================================================
   OPORTUNIDADES — Oportunidades e Propostas por mês, do Funil Comercial do RD
   Oportunidade = chegou à etapa "Qualificação" (ou além); Proposta = chegou à
   etapa "Proposta enviada" (ou além, inclusive vendida). Mês = data de entrada
   do cliente na aba Clientes (quando ele está cadastrado), senão a data de criação no RD.
   ========================================================================== */
function oppFunisComerciais() { return (Funis.funis || []).filter(f => /comercial/i.test(f.nome || '')); }

// Devolve { porMes: {'01': {oport, prop}}, inicio: 'AAAA-MM' } ou null enquanto carrega / sem RD
function oppDadosRD(ano) {
    if (typeof crmConectado !== 'function' || !crmConectado()) return null;
    const j = { ini: `${ano}-01-01`, fim: `${ano}-12-31`, label: String(ano) };
    if (!Funis.funis) { crmCarregarJanela(j, false, oppFunisComerciais); return { carregando: true }; }
    const funis = oppFunisComerciais();
    if (!funis.length) return null;
    const porMes = {};
    let inicio = '';
    for (const f of funis) {
        const d = Funis.dados.get(crmChaveJanela(f.id, j));
        if (!d) { crmCarregarJanela(j, false, oppFunisComerciais); return { carregando: true }; }
        const etapas = [...(f.etapas || [])].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
        const pos = (re) => etapas.findIndex(e => re.test(crmSemAcento(e.nome)));
        const iQualif = pos(/qualifica/);
        let iProp = pos(/proposta enviada/);
        if (iProp < 0) iProp = pos(/^proposta/);
        const iPerca = pos(/^(perca|perda|perdid)/);
        d.lista.forEach(n => {
            const criada = String(n.criada || '').slice(0, 10);
            if (criada && (!inicio || criada < inicio)) inicio = criada;
            const i = etapas.findIndex(e => String(e.id) === String(n.etapa));
            const ganha = n.ganha === true;
            const naPerca = i >= 0 && i === iPerca;
            const oport = ganha || (!naPerca && iQualif >= 0 && i >= iQualif);
            const prop = ganha || (!naPerca && iProp >= 0 && i >= iProp);
            if (!oport && !prop) return;
            const data = (typeof crmDataVenda === 'function' ? crmDataVenda(n) : '') || criada;
            if (data.slice(0, 4) !== String(ano)) return;
            const m = data.slice(5, 7);
            porMes[m] = porMes[m] || { oport: 0, prop: 0 };
            if (oport) porMes[m].oport++;
            if (prop) porMes[m].prop++;
        });
    }
    return { porMes, inicio: inicio.slice(0, 7) };
}
