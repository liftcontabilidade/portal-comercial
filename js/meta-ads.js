/* ==========================================================================
   INTEGRAÇÃO META ADS — puxa os números direto da conta de anúncios
   --------------------------------------------------------------------------
   Usa a API de Marketing do Meta (Graph API) com um token de "usuário do
   sistema" (somente leitura: ads_read). O token fica guardado no banco do
   portal (portalComercial/dados/config/integracaoMeta), que só os e-mails
   autorizados conseguem ler — nunca no código do site.

   Ao abrir o portal (e a cada 1 hora com ele aberto) busca os números por
   anúncio e por dia e grava como lançamentos de tráfego (fonte: 'api').
   O alcance de cada período é buscado à parte, porque pessoas alcançadas
   não se somam dia a dia.
   ========================================================================== */
const META_GRAPH = 'https://graph.facebook.com/v24.0/';
const META_STORAGE_LOCAL = 'lift_comercial_meta_ads';
const META_INTERVALO_SYNC = 5 * 60 * 1000; // com o portal aberto, busca no Meta a cada 5 minutos
const META_ACOES = {
    'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas por mensagem (WhatsApp/Direct)',
    'onsite_conversion.messaging_first_reply': 'Novas conversas por mensagem',
    'lead': 'Leads (todos)',
    'onsite_conversion.lead_grouped': 'Leads em formulário instantâneo',
    'offsite_conversion.fb_pixel_lead': 'Leads no site (pixel)',
    'contact_total': 'Contatos',
    'offsite_conversion.fb_pixel_contact': 'Contatos no site (pixel)',
    'complete_registration': 'Cadastros concluídos',
    'offsite_conversion.fb_pixel_complete_registration': 'Cadastros no site (pixel)',
    'landing_page_view': 'Visualizações da página de destino',
    'link_click': 'Cliques no link',
    'onsite_conversion.post_save': 'Publicações salvas',
    'post_engagement': 'Engajamento com a publicação'
};
const META_PREFERENCIA = ['onsite_conversion.messaging_conversation_started_7d', 'lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'contact_total'];

const MetaAds = {
    cfg: null,          // { contaId, token, resultado, desde, nomeConta, ultimaSync, ultimaSyncData }
    cfgRecebida: false,
    sincronizando: false,
    erro: '',
    alcance: new Map(), // "ini|fim" -> { total, porAd: {adId: reach} } | 'carregando' | 'erro'
    timer: null
};

// Com o portal no link da web a configuração fica no banco; aberto direto no computador, fica no navegador
const metaNuvem = () => !!window.LIFT_FIREBASE_CONFIG && location.protocol !== 'file:';
const metaConectado = () => !!(MetaAds.cfg && MetaAds.cfg.contaId && MetaAds.cfg.token);

/* ---------- Configuração ---------- */
function metaCarregarLocal() {
    if (metaNuvem()) return;
    try { MetaAds.cfg = JSON.parse(localStorage.getItem(META_STORAGE_LOCAL)) || null; } catch (e) { MetaAds.cfg = null; }
    MetaAds.cfgRecebida = true;
}

async function metaSalvarConfig(cfg) {
    MetaAds.cfg = cfg;
    if (metaNuvem()) {
        if (!(window.LiftCloud && window.LiftCloud.salvarConfigMeta)) throw new Error('sem conexão com o banco');
        await window.LiftCloud.salvarConfigMeta(cfg);
    } else {
        try { cfg ? localStorage.setItem(META_STORAGE_LOCAL, JSON.stringify(cfg)) : localStorage.removeItem(META_STORAGE_LOCAL); } catch (e) { /* ignora */ }
    }
}

// Recebe a configuração do banco (firebase-sync.js)
window.aplicarConfigMetaAds = function (cfg) {
    const antes = MetaAds.cfg ? MetaAds.cfg.token + '|' + MetaAds.cfg.contaId + '|' + MetaAds.cfg.resultado : '';
    MetaAds.cfg = cfg;
    MetaAds.cfgRecebida = true;
    const depois = cfg ? cfg.token + '|' + cfg.contaId + '|' + cfg.resultado : '';
    if (antes !== depois) MetaAds.alcance.clear();
    metaRenderStatus();
    metaAgendar(4000);
};

/* ---------- Chamadas à API ---------- */
function metaErroAmigavel(err) {
    const e = err && err.error ? err.error : err;
    const code = e && e.code;
    if (code === 190) return 'O token de acesso do Meta expirou ou é inválido. Gere um novo token e salve em "Configurar".';
    if (code === 100 && /act_|account/i.test(e.message || '')) return 'Conta de anúncios não encontrada. Confira o ID da conta (só os números, sem "act_").';
    if (code === 10 || code === 200 || code === 294) return 'O token não tem permissão para ler esta conta. O usuário do sistema precisa ter a conta de anúncios atribuída e a permissão ads_read.';
    if (code === 17 || code === 4 || code === 80004) return 'O Meta limitou as consultas por alguns minutos. O portal tenta de novo mais tarde.';
    return (e && e.message) ? 'Meta: ' + e.message : 'Não foi possível falar com o Meta. Verifique a internet.';
}

async function metaGet(caminho, params = {}, token) {
    const url = new URL(caminho.startsWith('http') ? caminho : META_GRAPH + caminho);
    if (!caminho.startsWith('http')) {
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v));
        url.searchParams.set('access_token', token || MetaAds.cfg.token);
    }
    let resp, json;
    try {
        resp = await fetch(url.toString());
        json = await resp.json();
    } catch (e) {
        throw new Error('Não foi possível falar com o Meta. Verifique a internet.');
    }
    if (json.error) { const er = new Error(metaErroAmigavel(json)); er.meta = json.error; throw er; }
    return json;
}

async function metaGetTodos(caminho, params, token) {
    let pagina = await metaGet(caminho, params, token);
    const dados = [...(pagina.data || [])];
    let guarda = 0;
    while (pagina.paging && pagina.paging.next && guarda++ < 200) {
        pagina = await metaGet(pagina.paging.next);
        dados.push(...(pagina.data || []));
    }
    return dados;
}

const metaConta = (id) => 'act_' + String(id || '').replace(/\D/g, '');
const metaValorAcao = (lista, tipo) => {
    const a = (lista || []).find(x => x.action_type === tipo);
    return a ? Number(a.value) || 0 : 0;
};

/* ---------- Sincronização ---------- */
function metaAddDias(iso, n) { const d = trData(iso); d.setDate(d.getDate() + n); return trIso(d); }

async function metaSincronizar(manual = false) {
    if (!metaConectado() || MetaAds.sincronizando) return;
    MetaAds.sincronizando = true;
    MetaAds.erro = '';
    metaRenderStatus();
    try {
        const cfg = MetaAds.cfg;
        const hoje = trIso(new Date());
        const inicioPadrao = cfg.desde || metaAddDias(hoje, -180);
        // Reconsulta os últimos 7 dias: o Meta ainda ajusta os resultados desses dias
        let desde = cfg.ultimaSyncData ? metaAddDias(cfg.ultimaSyncData, -7) : inicioPadrao;
        if (desde < inicioPadrao) desde = inicioPadrao;
        if (manual && cfg.ultimaSyncData) desde = [metaAddDias(hoje, -30), inicioPadrao].sort().pop();

        const linhas = [];
        // Busca em blocos de 30 dias (o Meta recusa pedidos muito grandes)
        for (let ini = desde; ini <= hoje; ini = metaAddDias(ini, 30)) {
            const fim = [metaAddDias(ini, 29), hoje].sort()[0];
            const parte = await metaGetTodos(metaConta(cfg.contaId) + '/insights', {
                level: 'ad',
                fields: 'ad_id,ad_name,campaign_name,impressions,reach,inline_link_clicks,spend,actions',
                time_increment: 1,
                time_range: { since: ini, until: fim },
                limit: 500
            });
            linhas.push(...parte);
        }

        const novos = linhas.map(r => ({
            id: `meta-${r.ad_id}-${r.date_start}`,
            plataforma: 'Meta',
            fonte: 'api',
            adId: String(r.ad_id),
            anuncio: String(r.ad_name || '').trim() || 'Anúncio ' + r.ad_id,
            campanha: r.campaign_name || '',
            inicio: r.date_start,
            fim: r.date_stop,
            alcance: Number(r.reach) || 0,
            impressoes: Number(r.impressions) || 0,
            cliques: Number(r.inline_link_clicks) || 0,
            investimento: Math.round((Number(r.spend) || 0) * 100) / 100,
            resultados: Math.round(metaValorAcao(r.actions, cfg.resultado))
        }));

        // Troca os dados do Meta no intervalo consultado pelos que vieram agora.
        // Lançamentos do Meta feitos à mão/importados nesse intervalo saem (evita contar em dobro).
        const dentro = (l) => l.inicio >= desde && l.fim <= hoje;
        const antes = AppState.trafego || [];
        const mantidos = antes.filter(l => !((l.plataforma || 'Meta') === 'Meta' && dentro(l)));
        const removidosManuais = antes.filter(l => (l.plataforma || 'Meta') === 'Meta' && l.fonte !== 'api' && dentro(l)).length;
        const porId = new Map(antes.map(l => [l.id, l]));
        const final = mantidos.concat(novos.map(n => {
            const velho = porId.get(n.id);
            return velho && JSON.stringify({ ...velho, criadoEm: undefined }) === JSON.stringify({ ...n, criadoEm: undefined }) ? velho : { ...n, criadoEm: new Date().toISOString() };
        }));
        const mudou = JSON.stringify(final.map(x => x.id).sort()) !== JSON.stringify(antes.map(x => x.id).sort())
            || final.some(x => porId.get(x.id) !== x);
        if (mudou) {
            AppState.trafego = final;
            salvarTrafego();
        }
        MetaAds.alcance.clear();
        await metaSalvarConfig({ ...cfg, ultimaSync: new Date().toISOString(), ultimaSyncData: hoje });
        renderTrafegoView();
        if (manual) showToast(`Meta Ads atualizado: ${novos.length} ${novos.length === 1 ? 'registro' : 'registros'} de ${trCompleta(desde)} até hoje${removidosManuais ? ` (${removidosManuais} lançamento(s) manual(is) do Meta substituído(s))` : ''}.`);
    } catch (e) {
        MetaAds.erro = e.message || String(e);
        if (manual) showToast(MetaAds.erro);
    } finally {
        MetaAds.sincronizando = false;
        metaRenderStatus();
    }
}

function metaAgendar(atraso = 0) {
    clearTimeout(MetaAds.timer);
    if (!metaConectado()) return;
    const ultima = MetaAds.cfg.ultimaSync ? new Date(MetaAds.cfg.ultimaSync).getTime() : 0;
    const falta = Math.max(atraso, ultima + META_INTERVALO_SYNC - Date.now());
    MetaAds.timer = setTimeout(async () => {
        await metaSincronizar(false);
        metaAgendar(META_INTERVALO_SYNC);
    }, falta);
}

/* ---------- Alcance real do período (pessoas únicas) ---------- */
// Devolve o alcance do período se já tiver sido buscado; senão busca e redesenha a tela depois.
function metaAlcanceDoPeriodo(j) {
    if (!metaConectado()) return null;
    const chave = j.ini + '|' + j.fim;
    const v = MetaAds.alcance.get(chave);
    if (v && typeof v === 'object') return v;
    if (v) return null; // carregando ou erro
    const temApi = (AppState.trafego || []).some(l => l.fonte === 'api' && trMeioDoPeriodo(l) >= j.ini && trMeioDoPeriodo(l) <= j.fim);
    if (!temApi) return null;
    MetaAds.alcance.set(chave, 'carregando');
    const conta = metaConta(MetaAds.cfg.contaId) + '/insights';
    const time_range = { since: j.ini, until: [j.fim, trIso(new Date())].sort()[0] };
    Promise.all([
        metaGetTodos(conta, { level: 'ad', fields: 'ad_id,reach', time_range, limit: 500 }),
        metaGet(conta, { level: 'account', fields: 'reach', time_range })
    ]).then(([porAnuncio, conta]) => {
        const porAd = {};
        porAnuncio.forEach(r => { porAd[String(r.ad_id)] = Number(r.reach) || 0; });
        const total = conta.data && conta.data[0] ? Number(conta.data[0].reach) || 0 : null;
        MetaAds.alcance.set(chave, { porAd, total });
        if (AppState.currentView === 'trafego') renderTrafegoView();
    }).catch(() => MetaAds.alcance.set(chave, 'erro'));
    return null;
}

/* ---------- Status na tela ---------- */
function metaRenderStatus() {
    const box = document.getElementById('tr-meta-status');
    if (!box) return;
    if (!MetaAds.cfgRecebida) { box.innerHTML = ''; return; }
    // Conectado ao Meta: os números entram sozinhos, então os botões de importar/lançar saem da tela
    const conectado = metaConectado();
    ['tr-btn-importar', 'tr-btn-lancar'].forEach(id => { const b = document.getElementById(id); if (b) b.classList.toggle('oculto', conectado); });
    if (!conectado) {
        box.innerHTML = `<button type="button" class="tr-meta-conectar" id="tr-meta-config">Conectar Meta Ads</button>`;
        return;
    }
    let txt, cls = 'ok';
    if (MetaAds.sincronizando) { txt = 'Buscando dados no Meta…'; cls = 'aviso'; }
    else if (MetaAds.erro) { txt = MetaAds.erro; cls = 'erro'; }
    else if (MetaAds.cfg.ultimaSync) {
        const d = new Date(MetaAds.cfg.ultimaSync);
        const hoje = trIso(new Date()) === trIso(d);
        txt = `Ao vivo com o Meta Ads · atualizado ${hoje ? 'hoje' : 'em ' + d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } else { txt = 'Meta Ads conectado · aguardando a primeira atualização'; cls = 'aviso'; }
    box.innerHTML = `<span class="tr-meta-pill ${cls}" title="${escHtml(txt)}"><i></i><span>${escHtml(txt)}</span></span>
        <button type="button" class="tr-btn-icone" id="tr-meta-sync" title="Atualizar agora" ${MetaAds.sincronizando ? 'disabled' : ''}>↻</button>
        <button type="button" class="tr-btn-icone" id="tr-meta-config" title="Configurar integração">⚙</button>`;
}

/* ---------- Janela de configuração ---------- */
function metaAbrirConfig() {
    const cfg = MetaAds.cfg || {};
    document.getElementById('mc-conta').value = cfg.contaId ? String(cfg.contaId).replace(/\D/g, '') : '';
    const tk = document.getElementById('mc-token');
    tk.value = '';
    tk.placeholder = cfg.token ? 'Token já salvo — deixe em branco para manter' : 'Cole aqui o token do usuário do sistema';
    document.getElementById('mc-desde').value = cfg.desde || metaAddDias(trIso(new Date()), -180);
    const sel = document.getElementById('mc-resultado');
    sel.innerHTML = cfg.resultado ? `<option value="${escHtml(cfg.resultado)}">${escHtml(META_ACOES[cfg.resultado] || cfg.resultado)}</option>` : '<option value="">Clique em "Testar conexão" para listar</option>';
    document.getElementById('mc-info').innerHTML = cfg.nomeConta ? `Conectado à conta <b>${escHtml(cfg.nomeConta)}</b>.` : '';
    document.getElementById('mc-desconectar').classList.toggle('oculto', !metaConectado());
    document.getElementById('mc-salvar').disabled = !metaConectado();
    MetaAds._teste = null;
    document.getElementById('modal-meta-config').classList.add('active');
}

async function metaTestar() {
    const info = document.getElementById('mc-info');
    const conta = document.getElementById('mc-conta').value.replace(/\D/g, '');
    const token = document.getElementById('mc-token').value.trim() || (MetaAds.cfg && MetaAds.cfg.token) || '';
    if (!conta || !token) { info.innerHTML = '<span class="tr-txt-ruim">Preencha o ID da conta e o token.</span>'; return; }
    info.innerHTML = 'Testando…';
    document.getElementById('mc-salvar').disabled = true;
    try {
        const c = await metaGet(metaConta(conta), { fields: 'name,currency,account_status' }, token);
        const ins = await metaGet(metaConta(conta) + '/insights', { fields: 'actions', date_preset: 'last_90d' }, token);
        const acoes = (ins.data && ins.data[0] && ins.data[0].actions) || [];
        const sel = document.getElementById('mc-resultado');
        const atual = (MetaAds.cfg && MetaAds.cfg.resultado) || '';
        const rank = (t) => { const i = META_PREFERENCIA.indexOf(t); return i >= 0 ? i : (META_ACOES[t] ? 50 : 99); };
        const tipos = acoes.slice().sort((a, b) => rank(a.action_type) - rank(b.action_type) || Number(b.value) - Number(a.value));
        if (atual && !tipos.some(t => t.action_type === atual)) tipos.unshift({ action_type: atual, value: 0 });
        sel.innerHTML = tipos.length
            ? tipos.map(t => `<option value="${escHtml(t.action_type)}">${escHtml(META_ACOES[t.action_type] || t.action_type)} — ${Number(t.value).toLocaleString('pt-BR')} nos últimos 90 dias</option>`).join('')
            : '<option value="onsite_conversion.messaging_conversation_started_7d">Conversas iniciadas por mensagem (sem dados nos últimos 90 dias)</option>';
        const pref = atual || META_PREFERENCIA.find(p => tipos.some(t => t.action_type === p));
        if (pref) sel.value = pref;
        MetaAds._teste = { contaId: conta, token, nomeConta: c.name };
        info.innerHTML = `<span class="tr-txt-bom">Conexão OK:</span> conta <b>${escHtml(c.name)}</b> (${escHtml(c.currency || '')}).${c.account_status !== 1 ? ' <span class="tr-txt-ruim">Atenção: a conta não está ativa.</span>' : ''} Confira abaixo o que conta como "Resultado" e clique em Salvar.`;
        document.getElementById('mc-salvar').disabled = false;
    } catch (e) {
        info.innerHTML = `<span class="tr-txt-ruim">${escHtml(e.message)}</span><div class="mc-diag">Verificando o token…</div>`;
        info.querySelector('.mc-diag').innerHTML = await metaDiagnostico(token, conta, e);
        info.querySelectorAll('[data-mc-conta]').forEach(b => b.onclick = () => {
            document.getElementById('mc-conta').value = b.dataset.mcConta;
            metaTestar();
        });
    }
}

// Quando o teste falha: mostra o que o token consegue ver, para achar o problema
async function metaDiagnostico(token, conta, erro) {
    const linhas = [];
    const meta = erro && erro.meta;
    if (meta) linhas.push(`<div class="mc-diag-orig">Resposta do Meta: ${escHtml(meta.message || '')} (código ${escHtml(meta.code)}${meta.error_subcode ? '/' + escHtml(meta.error_subcode) : ''})</div>`);
    try {
        const eu = await metaGet('me', { fields: 'id,name' }, token);
        linhas.push(`✔ O token é válido — pertence a <b>${escHtml(eu.name || eu.id)}</b>.`);
    } catch (e2) {
        linhas.push(`✖ O token não funciona: ${escHtml(e2.message)}`);
        return linhas.join('<br>');
    }
    try {
        const perms = await metaGet('me/permissions', {}, token);
        const ok = (perms.data || []).filter(x => x.status === 'granted').map(x => x.permission);
        linhas.push(ok.includes('ads_read') || ok.includes('ads_management')
            ? `✔ Permissões do token: ${escHtml(ok.join(', '))}.`
            : `✖ O token <b>não tem a permissão ads_read</b> (tem: ${escHtml(ok.join(', ') || 'nenhuma')}). Gere um token novo marcando <b>ads_read</b>.`);
    } catch (e3) { /* alguns tokens não listam permissões */ }
    try {
        const contas = await metaGetTodos('me/adaccounts', { fields: 'account_id,name,account_status', limit: 100 }, token);
        if (!contas.length) {
            linhas.push('✖ O token <b>não enxerga nenhuma conta de anúncios</b>. No Gerenciador de Negócios, abra o usuário do sistema → <b>Atribuir ativos → Contas de anúncios</b>, marque a conta e salve. Depois gere um <b>token novo</b>.');
        } else {
            const achou = contas.find(c => String(c.account_id) === String(conta));
            if (achou) {
                linhas.push(`✔ O token enxerga a conta <b>${escHtml(achou.name)}</b>, mas o Meta recusou a leitura. Confira se o app está ligado ao mesmo portfólio da conta e gere um token novo com <b>ads_read</b>.`);
            } else {
                linhas.push(`✖ O ID <b>${escHtml(conta)}</b> não está entre as contas que o token enxerga. Provavelmente é o ID do portfólio/empresa, e não da conta de anúncios. Contas disponíveis (clique para usar):`);
                linhas.push(contas.map(c => `<button type="button" class="mc-conta-op" data-mc-conta="${escHtml(c.account_id)}">${escHtml(c.name || 'Sem nome')} — ${escHtml(c.account_id)}</button>`).join(''));
            }
        }
    } catch (e4) {
        linhas.push(`Não foi possível listar as contas do token: ${escHtml(e4.message)}`);
    }
    return linhas.join('<br>');
}

async function metaSalvarDaTela() {
    const base = MetaAds._teste || (metaConectado() ? { contaId: MetaAds.cfg.contaId, token: MetaAds.cfg.token, nomeConta: MetaAds.cfg.nomeConta } : null);
    if (!base) return showToast('Clique em "Testar conexão" antes de salvar.');
    const resultado = document.getElementById('mc-resultado').value;
    const desde = document.getElementById('mc-desde').value || metaAddDias(trIso(new Date()), -180);
    const anterior = MetaAds.cfg || {};
    const mudouBase = anterior.contaId !== base.contaId || anterior.resultado !== resultado || anterior.desde !== desde;
    const cfg = { ...base, resultado, desde, ultimaSync: mudouBase ? null : (anterior.ultimaSync || null), ultimaSyncData: mudouBase ? null : (anterior.ultimaSyncData || null), atualizadoPor: (document.getElementById('cloud-user') || {}).textContent || '' };
    try {
        await metaSalvarConfig(cfg);
    } catch (e) {
        return showToast('Não foi possível salvar a configuração: ' + (e.message || e));
    }
    MetaAds.alcance.clear();
    document.getElementById('modal-meta-config').classList.remove('active');
    metaRenderStatus();
    showToast('Meta Ads conectado. Buscando os dados…');
    await metaSincronizar(true);
    metaAgendar(META_INTERVALO_SYNC);
}

async function metaDesconectar() {
    if (!confirm('Desconectar o Meta Ads? Os números já puxados continuam no portal, mas não serão mais atualizados.')) return;
    await metaSalvarConfig(null);
    clearTimeout(MetaAds.timer);
    MetaAds.alcance.clear();
    document.getElementById('modal-meta-config').classList.remove('active');
    metaRenderStatus();
    showToast('Meta Ads desconectado.');
}

function setupMetaAds() {
    metaCarregarLocal();
    metaRenderStatus();
    metaAgendar(2000);
    // Ao voltar para a aba do portal, busca de novo se já passou mais de 2 minutos
    const aoVoltar = () => {
        if (document.visibilityState !== 'visible' || !metaConectado() || MetaAds.sincronizando) return;
        const ultima = MetaAds.cfg.ultimaSync ? new Date(MetaAds.cfg.ultimaSync).getTime() : 0;
        if (Date.now() - ultima > 2 * 60 * 1000) metaSincronizar(false).then(() => metaAgendar(META_INTERVALO_SYNC));
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    const box = document.getElementById('tr-meta-status');
    if (box) box.addEventListener('click', (e) => {
        if (e.target.closest('#tr-meta-config')) metaAbrirConfig();
        if (e.target.closest('#tr-meta-sync')) metaSincronizar(true);
    });
    document.getElementById('mc-testar').addEventListener('click', metaTestar);
    document.getElementById('mc-desconectar').addEventListener('click', metaDesconectar);
    document.getElementById('form-meta-config').addEventListener('submit', (e) => { e.preventDefault(); metaSalvarDaTela(); });
    ['mc-conta', 'mc-token'].forEach(id => document.getElementById(id).addEventListener('input', () => { MetaAds._teste = null; document.getElementById('mc-salvar').disabled = true; }));
}
document.addEventListener('DOMContentLoaded', setupMetaAds);
