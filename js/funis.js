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

async function crmCarregarJanela(j, forcar = false) {
    if (!crmConectado()) return;
    let buscou = false;
    const erroAntes = Funis.erro;
    try {
        if (!Funis.funis || forcar) { Funis.funis = (await crmChamar({ acao: 'funis' })).funis || []; buscou = true; }
        const escolhidos = crmFunisEscolhidos();
        await Promise.all(escolhidos.map(async f => {
            const k = crmChaveJanela(f.id, j);
            if (Funis.carregando.has(k)) return;
            const atual = Funis.dados.get(k);
            if (atual && !forcar && Date.now() - atual.em < CRM_INTERVALO) return;
            Funis.carregando.add(k);
            buscou = true;
            if (AppState.currentView === 'funis') crmRenderStatus();
            try {
                const [r, g] = await Promise.all([
                    crmChamar({ acao: 'negociacoes', funil: f.id, inicio: j.ini, fim: j.fim }),
                    crmChamar({ acao: 'negociacoes', funil: f.id, inicio: j.ini, fim: j.fim, por: 'fechamento' })
                ]);
                // Conector antigo ignora "por=fechamento" e devolve as negociações criadas (com abertas no meio)
                if ((g.negociacoes || []).some(n => n.ganha !== true)) Funis.conectorAntigo = true;
                // Ganho: vendida com data de venda dentro do período
                const naJanela = (n) => { const d = String(n.fechada || '').slice(0, 10); return d >= j.ini && d <= j.fim; };
                Funis.dados.set(k, { em: Date.now(), lista: r.negociacoes || [], ganhas: (g.negociacoes || []).filter(n => n.ganha === true && naJanela(n)) });
            } finally { Funis.carregando.delete(k); }
        }));
        if (buscou) { Funis.erro = ''; Funis.ultima = new Date(); }
    } catch (e) {
        Funis.erro = e.message || String(e);
    }
    // Só redesenha quando algo foi buscado (evita repetir sem parar enquanto carrega)
    if ((buscou || Funis.erro !== erroAntes) && AppState.currentView === 'funis') renderFunisView();
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
            const det = aberto ? `<tr class="fn-det"><td colspan="${separa ? 6 : 5}">${l.negocios.length ? l.negocios.map(n => `<span class="fn-neg ${n.situacao}" title="${escHtml([n.situacao === 'perdida' && n.motivoPerda ? 'Motivo: ' + n.motivoPerda : '', n.fonte ? 'Fonte: ' + n.fonte : '', n.responsavel ? 'Responsável: ' + n.responsavel : ''].filter(Boolean).join(' · '))}">${escHtml(n.nome || 'Sem nome')}${n.situacao === 'perdida' ? ' <small>perdida</small>' : n.situacao === 'pausada' ? ' <small>pausada</small>' : ''}</span>`).join('') : '<span class="fn-neg-vazio">Nenhuma negociação nesta etapa.</span>'}</td></tr>` : '';
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
