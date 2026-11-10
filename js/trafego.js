/* ==========================================================================
   TRÁFEGO PAGO — lançamentos por copy/anúncio (Meta Ads e Google Ads)
   --------------------------------------------------------------------------
   Cada lançamento guarda os números de um anúncio num período:
     { id, plataforma, anuncio, inicio, fim, alcance, impressoes, cliques,
       investimento, resultados, criadoEm }
   CTR = cliques ÷ impressões · CPC = investimento ÷ cliques
   Custo por resultado = investimento ÷ resultados
   Os filtros (semana, quinzena, mês) somam os lançamentos cujo período cai
   no intervalo (pela data do meio do período do lançamento).
   Salvo no navegador e no Firebase (portalComercial/dados/trafego/{id}).
   ========================================================================== */
const STORAGE_KEY_TRAFEGO = 'lift_comercial_2026_oficial_trafego';
const TIPOS_PERIODO_TRAFEGO = { semana: 'Semana', quinzena: 'Quinzena', mes: 'Mês' };
const REGEX_ORIGEM_PAGA = /tr[aá]fego\s*pago|an[uú]ncio|\bads\b|patrocinad|campanha paga/i;

function carregarTrafego() {
    try {
        const v = JSON.parse(localStorage.getItem(STORAGE_KEY_TRAFEGO));
        AppState.trafego = Array.isArray(v) ? v : [];
    } catch (e) { AppState.trafego = []; }
}

function salvarTrafegoLocal() {
    try { localStorage.setItem(STORAGE_KEY_TRAFEGO, JSON.stringify(AppState.trafego || [])); } catch (e) { /* ignora */ }
}

function salvarTrafego() {
    salvarTrafegoLocal();
    saveStorage();
}

// Recebe os lançamentos do banco de dados (firebase-sync.js)
window.aplicarTrafegoDaNuvem = function (lista) {
    if (!Array.isArray(lista)) return;
    const ordenar = (l) => JSON.stringify(l.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))));
    if (ordenar(lista) === ordenar(AppState.trafego || [])) return;
    AppState.trafego = lista;
    salvarTrafegoLocal();
    const ativo = document.activeElement;
    if (ativo && ativo.closest && ativo.closest('#modal-trafego-lanc')) return;
    renderTrafegoView();
};

/* ---------- Datas e períodos ---------- */
const trIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const trData = (iso) => { const [a, m, d] = String(iso).split('-').map(Number); return new Date(a, m - 1, d); };
const trCurta = (iso) => { const [a, m, d] = String(iso).split('-'); return `${d}/${m}`; };
const trCompleta = (iso) => { const [a, m, d] = String(iso).split('-'); return `${d}/${m}/${a}`; };
const MESES_TR = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function trMeioDoPeriodo(l) {
    const ini = trData(l.inicio || l.fim), fim = trData(l.fim || l.inicio);
    return trIso(new Date((ini.getTime() + fim.getTime()) / 2));
}

// Janela do tipo escolhido que contém a data "ref"
function trJanela(tipo, ref) {
    const d = trData(ref);
    let ini, fim, label;
    if (tipo === 'semana') {
        const dow = (d.getDay() + 6) % 7; // segunda = 0
        ini = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
        fim = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 6);
        label = `Semana de ${trCurta(trIso(ini))} a ${trCurta(trIso(fim))}/${fim.getFullYear()}`;
    } else if (tipo === 'quinzena') {
        const primeira = d.getDate() <= 15;
        ini = new Date(d.getFullYear(), d.getMonth(), primeira ? 1 : 16);
        fim = primeira ? new Date(d.getFullYear(), d.getMonth(), 15) : new Date(d.getFullYear(), d.getMonth() + 1, 0);
        label = `${primeira ? '1ª' : '2ª'} quinzena de ${MESES_TR[d.getMonth()]}/${d.getFullYear()} (${trCurta(trIso(ini))} a ${trCurta(trIso(fim))})`;
    } else {
        ini = new Date(d.getFullYear(), d.getMonth(), 1);
        fim = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        label = `${MESES_TR[d.getMonth()][0].toUpperCase() + MESES_TR[d.getMonth()].slice(1)} de ${d.getFullYear()}`;
    }
    return { ini: trIso(ini), fim: trIso(fim), label };
}

function trDeslocar(tipo, janela, passos) {
    const base = trData(passos < 0 ? janela.ini : janela.fim);
    base.setDate(base.getDate() + (passos < 0 ? -1 : 1));
    let j = trJanela(tipo, trIso(base));
    for (let i = 1; i < Math.abs(passos); i++) j = trDeslocar(tipo, j, Math.sign(passos));
    return j;
}

function trLancamentosDaJanela(j) {
    return (AppState.trafego || []).filter(l => { const m = trMeioDoPeriodo(l); return m >= j.ini && m <= j.fim; });
}

/* ---------- Cálculos ---------- */
function trSomar(lista) {
    const t = { alcance: 0, impressoes: 0, cliquesComImpr: 0, cliques: 0, investimento: 0, resultados: 0, investComCliques: 0, n: lista.length };
    lista.forEach(l => {
        t.alcance += Number(l.alcance) || 0;
        t.cliques += Number(l.cliques) || 0;
        t.investimento += Number(l.investimento) || 0;
        t.resultados += Number(l.resultados) || 0;
        if (Number(l.impressoes) > 0) { t.impressoes += Number(l.impressoes); t.cliquesComImpr += Number(l.cliques) || 0; }
    });
    t.ctr = t.impressoes > 0 ? (t.cliquesComImpr / t.impressoes) * 100 : null;
    t.cpc = t.cliques > 0 ? t.investimento / t.cliques : null;
    t.cpr = t.resultados > 0 ? t.investimento / t.resultados : null;
    return t;
}

function trPorCopy(lista) {
    const plataformas = new Set(lista.map(l => l.plataforma || 'Meta'));
    const grupos = new Map();
    lista.forEach(l => {
        const chave = (l.plataforma || 'Meta') + '|' + String(l.anuncio || '').trim().toLocaleLowerCase('pt-BR');
        if (!grupos.has(chave)) grupos.set(chave, { nome: String(l.anuncio || '').trim() || '(sem nome)', plataforma: l.plataforma || 'Meta', itens: [] });
        grupos.get(chave).itens.push(l);
    });
    return [...grupos.values()].map(g => ({ ...g, mostrarPlataforma: plataformas.size > 1, ...trSomar(g.itens) }))
        .sort((a, b) => b.alcance - a.alcance || b.investimento - a.investimento);
}

function trClientesPagos(j) {
    return (AppState.clientes || []).filter(c =>
        c.dataEntrada && c.dataEntrada >= j.ini && c.dataEntrada <= j.fim && REGEX_ORIGEM_PAGA.test(c.origemCliente || ''));
}

// Pessoas alcançadas não se somam dia a dia: usa o alcance do período informado pelo Meta
function trAplicarAlcanceReal(j, lista, copys, total) {
    if (typeof metaAlcanceDoPeriodo !== 'function') return;
    const api = lista.filter(l => l.fonte === 'api');
    if (!api.length) return;
    const r = metaAlcanceDoPeriodo(j);
    if (!r) return;
    const somaManual = lista.filter(l => l.fonte !== 'api').reduce((s, l) => s + (Number(l.alcance) || 0), 0);
    if (r.total !== null) total.alcance = r.total + somaManual;
    (copys || []).forEach(c => {
        const ads = [...new Set(c.itens.filter(l => l.fonte === 'api').map(l => l.adId))];
        if (!ads.length) return;
        const manual = c.itens.filter(l => l.fonte !== 'api').reduce((s, l) => s + (Number(l.alcance) || 0), 0);
        c.alcance = ads.reduce((s, id) => s + (r.porAd[id] || 0), 0) + manual;
    });
}

/* ---------- Formatação ---------- */
const trNum = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : Math.round(v).toLocaleString('pt-BR');
const trPct = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : v.toFixed(2).replace('.', ',') + '%';
const trMoeda = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : formatBRL(v);

function trVariacao(atual, anterior, menorMelhor = false) {
    if (atual === null || anterior === null || anterior === undefined || isNaN(atual) || isNaN(anterior)) return '<span class="tr-delta neutro">sem comparação</span>';
    if (anterior === 0) return atual === 0 ? '<span class="tr-delta neutro">igual ao período anterior</span>' : '<span class="tr-delta neutro">período anterior zerado</span>';
    const p = ((atual - anterior) / anterior) * 100;
    if (Math.abs(p) < 0.5) return '<span class="tr-delta neutro">igual ao período anterior</span>';
    const bom = menorMelhor ? p < 0 : p > 0;
    return `<span class="tr-delta ${bom ? 'bom' : 'ruim'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% vs período anterior</span>`;
}

/* ---------- Tela ---------- */
function trJanelaAtual() {
    const tipo = AppState.trafegoTipo || 'semana';
    if (!AppState.trafegoRef) {
        // Abre no período do lançamento mais recente (ou hoje, se não houver)
        const lista = AppState.trafego || [];
        AppState.trafegoRef = lista.length ? lista.map(trMeioDoPeriodo).sort().pop() : trIso(new Date());
    }
    return trJanela(tipo, AppState.trafegoRef);
}

function renderTrafegoView() {
    if (!document.getElementById('panel-trafego')) return;
    const tipo = AppState.trafegoTipo || 'semana';
    const j = trJanelaAtual();
    const ant = trDeslocar(tipo, j, -1);
    const lista = trLancamentosDaJanela(j);
    const t = trSomar(lista);
    const ta = trSomar(trLancamentosDaJanela(ant));
    const set = (id, v, html = false) => { const el = document.getElementById(id); if (el) el[html ? 'innerHTML' : 'textContent'] = v; };

    document.querySelectorAll('#tr-tipos button').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
    set('tr-periodo-label', j.label);

    // KPIs
    set('tr-kpi-invest', trMoeda(t.investimento));
    set('tr-kpi-invest-sub', trVariacao(t.investimento, ta.n ? ta.investimento : null), true);
    set('tr-kpi-res', trNum(t.resultados));
    set('tr-kpi-res-sub', trVariacao(t.resultados, ta.n ? ta.resultados : null), true);
    set('tr-kpi-cpr', trMoeda(t.cpr));
    set('tr-kpi-cpr-sub', trVariacao(t.cpr, ta.n ? ta.cpr : null, true), true);
    set('tr-kpi-ctr', trPct(t.ctr));
    set('tr-kpi-ctr-sub', trVariacao(t.ctr, ta.n ? ta.ctr : null), true);

    // Tabela por copy (copys nas colunas, como no relatório)
    const copys = trPorCopy(lista);
    // Alcance real (pessoas únicas no período) quando os dados vêm do Meta
    trAplicarAlcanceReal(j, lista, copys, t);
    copys.sort((a, b) => b.alcance - a.alcance || b.investimento - a.investimento);
    const tabela = document.getElementById('tr-tabela');
    if (tabela) {
        if (!copys.length) {
            tabela.innerHTML = `<tbody><tr><td class="tr-vazio">Nenhum lançamento neste período. Use <b>Importar relatório</b> ou <b>Lançar manualmente</b>.</td></tr></tbody>`;
        } else {
            const metricas = [
                { nome: 'Alcance (pessoas)', v: c => c.alcance, f: trNum, melhor: 'max' },
                { nome: 'Cliques no link', v: c => c.cliques, f: trNum, melhor: 'max' },
                { nome: 'CTR - Taxa de clique', v: c => c.ctr, f: trPct, melhor: 'max' },
                { nome: 'CPC - Custo por clique', v: c => c.cpc, f: trMoeda, melhor: 'min' },
                { nome: 'Resultado', v: c => c.resultados, f: trNum, melhor: 'max', destaque: true },
                { nome: 'Valor investido', v: c => c.investimento, f: trMoeda },
                { nome: 'Custo por resultado', v: c => c.cpr, f: trMoeda, melhor: 'min' }
            ];
            const head = `<thead><tr><th class="tr-metrica">Métrica</th>${copys.map(c => `<th>${escHtml(c.nome)}${c.mostrarPlataforma ? `<small class="tr-plat ${c.plataforma === 'Google' ? 'google' : ''}">${escHtml(c.plataforma)}</small>` : ''}</th>`).join('')}<th class="tr-total">Total</th></tr></thead>`;
            const corpo = metricas.map(m => {
                const vals = copys.map(m.v);
                const validos = vals.filter(v => v !== null && !isNaN(v) && (m.melhor !== 'max' || v > 0));
                const alvo = m.melhor && copys.length > 1 && validos.length ? (m.melhor === 'max' ? Math.max(...validos) : Math.min(...validos)) : null;
                return `<tr class="${m.destaque ? 'tr-linha-destaque' : ''}"><td class="tr-metrica">${m.nome}</td>${vals.map(v => `<td class="${alvo !== null && v === alvo ? 'tr-melhor' : ''}">${m.f(v)}</td>`).join('')}<td class="tr-total">${m.f(m.v(t))}</td></tr>`;
            }).join('');
            tabela.innerHTML = head + `<tbody>${corpo}</tbody>`;
        }
    }
    set('tr-tabela-titulo', `COPYS — ${j.label.toUpperCase()}`);

    // Análise automática
    set('tr-analise', trGerarAnalise(j, t, ta, copys), true);

    // Evolução dos últimos 6 períodos
    const evol = [];
    let jj = j;
    for (let i = 0; i < 6; i++) { evol.unshift(jj); jj = trDeslocar(tipo, jj, -1); }
    if (typeof metaRenderStatus === 'function') metaRenderStatus();
    const evolBox = document.getElementById('tr-evolucao');
    if (evolBox) {
        evolBox.innerHTML = evol.map(p => {
            const lp = trLancamentosDaJanela(p);
            const s = trSomar(lp);
            trAplicarAlcanceReal(p, lp, null, s);
            const atual = p.ini === j.ini;
            const rotulo = tipo === 'mes' ? p.label : `${trCurta(p.ini)} a ${trCurta(p.fim)}`;
            return `<div class="opp-row tr-ev-row ${atual ? 'atual' : ''} ${s.n ? '' : 'vazio'}" data-ref="${p.ini}">
                <span class="opp-mes">${rotulo}</span>
                <span class="right">${s.n ? trMoeda(s.investimento) : '—'}</span>
                <span class="center">${s.n ? trNum(s.alcance) : '—'}</span>
                <span class="center">${s.n ? trNum(s.cliques) : '—'}</span>
                <span class="center">${s.n ? trPct(s.ctr) : '—'}</span>
                <span class="center"><b>${s.n ? trNum(s.resultados) : '—'}</b></span>
                <span class="right">${s.n ? trMoeda(s.cpr) : '—'}</span>
            </div>`;
        }).join('');
    }

    // Lançamentos do período
    const lancBox = document.getElementById('tr-lancamentos');
    if (lancBox) {
        const ord = lista.slice().sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)) || String(a.anuncio).localeCompare(String(b.anuncio)));
        lancBox.innerHTML = ord.length ? ord.map(l => `
            <div class="opp-row tr-lanc-row">
                <span class="tr-lanc-periodo">${trCurta(l.inicio)} a ${trCompleta(l.fim)}</span>
                <span><small class="tr-plat ${l.plataforma === 'Google' ? 'google' : ''}">${escHtml(l.plataforma || 'Meta')}</small></span>
                <span class="tr-lanc-nome" title="${escHtml(l.anuncio)}">${escHtml(l.anuncio)}</span>
                <span class="center">${trNum(l.alcance)}</span>
                <span class="center">${trNum(l.cliques)}</span>
                <span class="right">${trMoeda(Number(l.investimento) || 0)}</span>
                <span class="center"><b>${trNum(l.resultados)}</b></span>
                <span class="tr-lanc-acoes">
                    <button type="button" class="tr-btn-icone" data-editar="${escHtml(l.id)}" title="Editar">✎</button>
                    <button type="button" class="tr-btn-icone excluir" data-excluir="${escHtml(l.id)}" title="Excluir">✕</button>
                </span>
            </div>`).join('') : '<div class="tr-vazio">Nenhum lançamento neste período.</div>';
    }
}

function trGerarAnalise(j, t, ta, copys) {
    if (!t.n) {
        return '<p class="tr-analise-vazio">Sem dados neste período. Importe o relatório do Gerenciador de Anúncios ou lance os números manualmente para ver a análise.</p>';
    }
    const itens = [];
    const comp = (atual, anterior, menorMelhor) => {
        if (atual === null || anterior === null || !anterior || isNaN(anterior)) return '';
        const p = ((atual - anterior) / anterior) * 100;
        if (Math.abs(p) < 0.5) return ' (igual ao período anterior)';
        const bom = menorMelhor ? p < 0 : p > 0;
        return ` (<span class="${bom ? 'tr-txt-bom' : 'tr-txt-ruim'}">${p > 0 ? 'subiu' : 'caiu'} ${Math.abs(p).toFixed(0)}%</span> em relação ao período anterior)`;
    };
    itens.push(`Foram investidos <b>${trMoeda(t.investimento)}</b> em <b>${copys.length}</b> ${copys.length === 1 ? 'copy' : 'copys'}, com <b>${trNum(t.resultados)}</b> ${t.resultados === 1 ? 'resultado' : 'resultados'}` +
        (t.cpr !== null ? ` — custo de <b>${trMoeda(t.cpr)}</b> por resultado${ta.n ? comp(t.cpr, ta.cpr, true) : ''}.` : '.'));

    const comRes = copys.filter(c => c.resultados > 0 && c.cpr !== null).sort((a, b) => a.cpr - b.cpr);
    if (comRes.length) {
        const m = comRes[0];
        itens.push(`<b>Melhor copy:</b> ${escHtml(m.nome)} — ${trNum(m.resultados)} ${m.resultados === 1 ? 'resultado' : 'resultados'} a <b>${trMoeda(m.cpr)}</b> cada${comRes.length > 1 ? `, contra ${trMoeda(comRes[comRes.length - 1].cpr)} da mais cara (${escHtml(comRes[comRes.length - 1].nome)})` : ''}. Vale direcionar mais verba para ela.`);
    }
    const semRes = copys.filter(c => c.investimento > 0 && !c.resultados);
    semRes.forEach(c => itens.push(`<span class="tr-txt-ruim">Atenção:</span> ${escHtml(c.nome)} gastou <b>${trMoeda(c.investimento)}</b> e não gerou resultado${c.cliques ? ` (${trNum(c.cliques)} cliques)` : ''} — avalie pausar ou trocar o criativo/oferta.`));

    const comCtr = copys.filter(c => c.ctr !== null);
    if (comCtr.length > 1) {
        const ord = comCtr.slice().sort((a, b) => b.ctr - a.ctr);
        itens.push(`<b>Maior taxa de clique:</b> ${escHtml(ord[0].nome)} (${trPct(ord[0].ctr)}). ` +
            (ord[ord.length - 1].ctr < 0.5 ? `${escHtml(ord[ord.length - 1].nome)} está com CTR baixo (${trPct(ord[ord.length - 1].ctr)}) — o anúncio chama pouca atenção.` : ''));
    }
    const comCpc = copys.filter(c => c.cpc !== null).sort((a, b) => b.cpc - a.cpc);
    if (comCpc.length > 1 && t.cpc && comCpc[0].cpc > t.cpc * 1.6) {
        itens.push(`${escHtml(comCpc[0].nome)} tem o clique mais caro (${trMoeda(comCpc[0].cpc)}, contra a média de ${trMoeda(t.cpc)}).`);
    }
    // Clique → resultado
    const conv = copys.filter(c => c.cliques >= 10).map(c => ({ ...c, taxa: (c.resultados / c.cliques) * 100 })).sort((a, b) => b.taxa - a.taxa);
    if (conv.length > 1 && conv[0].taxa > 0) {
        itens.push(`<b>Conversão do clique em resultado:</b> ${escHtml(conv[0].nome)} converte ${trPct(conv[0].taxa)} dos cliques; ${escHtml(conv[conv.length - 1].nome)}, ${trPct(conv[conv.length - 1].taxa)}.`);
    }

    // CAC com os clientes fechados de origem paga
    const pagos = trClientesPagos(j);
    if (pagos.length) {
        itens.push(`<b>Clientes fechados no período vindos de tráfego pago:</b> ${pagos.length} → <b>CAC de ${trMoeda(t.investimento / pagos.length)}</b> por cliente.`);
    } else {
        itens.push(`<span class="tr-txt-neutro">Nenhum cliente com origem de tráfego pago fechou neste período. Para o portal calcular o CAC, cadastre a origem do cliente como <b>Tráfego pago</b>.</span>`);
    }
    return '<ul class="tr-analise-lista">' + itens.map(i => `<li>${i}</li>`).join('') + '</ul>';
}

/* ---------- Lançamento manual ---------- */
function trNumeroCampo(id, inteiro = false) {
    const el = document.getElementById(id);
    const txt = (el ? el.value : '').trim();
    if (!txt) return null;
    if (inteiro) {
        const n = parseInt(txt.replace(/[.\s]/g, '').replace(/,.*/, ''), 10);
        return isNaN(n) ? NaN : n;
    }
    return parseValorBR(txt.replace('%', ''));
}

function abrirLancamentoTrafego(id) {
    const l = id ? (AppState.trafego || []).find(x => String(x.id) === String(id)) : null;
    const form = document.getElementById('form-trafego-lanc');
    form.reset();
    form.dataset.editando = l ? l.id : '';
    document.getElementById('tr-lanc-titulo').textContent = l ? 'Editar lançamento' : 'Lançar números de anúncio';
    const j = trJanelaAtual();
    const fmt = (v, casas = 2) => (v === null || v === undefined || v === '') ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
    document.getElementById('trl-plataforma').value = l ? (l.plataforma || 'Meta') : 'Meta';
    document.getElementById('trl-anuncio').value = l ? l.anuncio : '';
    document.getElementById('trl-inicio').value = l ? l.inicio : j.ini;
    document.getElementById('trl-fim').value = l ? l.fim : j.fim;
    document.getElementById('trl-alcance').value = l ? fmt(l.alcance, 0) : '';
    document.getElementById('trl-impressoes').value = l && l.impressoes ? fmt(l.impressoes, 0) : '';
    document.getElementById('trl-cliques').value = l ? fmt(l.cliques, 0) : '';
    document.getElementById('trl-ctr').value = '';
    document.getElementById('trl-investimento').value = l ? fmt(l.investimento) : '';
    document.getElementById('trl-cpc').value = '';
    document.getElementById('trl-resultados').value = l ? fmt(l.resultados, 0) : '';
    const dl = document.getElementById('lista-copys-trafego');
    if (dl) dl.innerHTML = [...new Set((AppState.trafego || []).map(x => x.anuncio).filter(Boolean))].sort().map(n => `<option value="${escHtml(n)}">`).join('');
    document.getElementById('modal-trafego-lanc').classList.add('active');
    document.getElementById('trl-anuncio').focus();
}

function salvarLancamentoTrafego() {
    const form = document.getElementById('form-trafego-lanc');
    const anuncio = document.getElementById('trl-anuncio').value.trim().replace(/\s+/g, ' ');
    const inicio = document.getElementById('trl-inicio').value;
    const fim = document.getElementById('trl-fim').value;
    if (!anuncio) return showToast('Informe o nome da copy/anúncio.');
    if (!inicio || !fim || fim < inicio) return showToast('Confira as datas: o fim não pode ser antes do início.');
    const alcance = trNumeroCampo('trl-alcance', true);
    let impressoes = trNumeroCampo('trl-impressoes', true);
    const cliques = trNumeroCampo('trl-cliques', true);
    const ctr = trNumeroCampo('trl-ctr');
    let investimento = trNumeroCampo('trl-investimento');
    const cpc = trNumeroCampo('trl-cpc');
    const resultados = trNumeroCampo('trl-resultados', true);
    if ([alcance, impressoes, cliques, ctr, investimento, cpc, resultados].some(v => v !== null && isNaN(v))) return showToast('Há um número inválido no formulário.');
    // Sem valor investido: calcula pelo CPC × cliques
    if (investimento === null && cpc !== null && cliques) investimento = Math.round(cpc * cliques * 100) / 100;
    // Sem impressões: calcula pelo CTR (cliques ÷ CTR)
    if (impressoes === null && ctr && cliques) impressoes = Math.round(cliques / (ctr / 100));
    if (investimento === null) return showToast('Informe o valor investido (ou o CPC, para o portal calcular).');

    const editando = form.dataset.editando;
    const reg = {
        id: editando || ('tr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
        plataforma: document.getElementById('trl-plataforma').value,
        anuncio, inicio, fim,
        alcance: alcance || 0, impressoes: impressoes || null, cliques: cliques || 0,
        investimento, resultados: resultados || 0,
        criadoEm: new Date().toISOString()
    };
    if (!AppState.trafego) AppState.trafego = [];
    const i = AppState.trafego.findIndex(x => String(x.id) === String(reg.id));
    if (i >= 0) AppState.trafego[i] = { ...AppState.trafego[i], ...reg }; else AppState.trafego.push(reg);
    salvarTrafego();
    document.getElementById('modal-trafego-lanc').classList.remove('active');
    AppState.trafegoRef = trMeioDoPeriodo(reg);
    renderTrafegoView();
    showToast(editando ? 'Lançamento atualizado.' : 'Lançamento salvo.');
}

function excluirLancamentoTrafego(id) {
    const l = (AppState.trafego || []).find(x => String(x.id) === String(id));
    if (!l) return;
    if (!confirm(`Excluir o lançamento de "${l.anuncio}" (${trCompleta(l.inicio)} a ${trCompleta(l.fim)})?`)) return;
    AppState.trafego = AppState.trafego.filter(x => String(x.id) !== String(id));
    salvarTrafego();
    renderTrafegoView();
    showToast('Lançamento excluído.');
}

/* ---------- Importar relatório (Meta Ads / Google Ads, CSV ou Excel) ---------- */
const trNormCab = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const TR_COLUNAS = {
    anuncio: ['nome do anuncio', 'anuncio', 'ad name', 'titulo 1', 'nome da campanha', 'campanha', 'campaign name', 'campaign', 'nome do conjunto de anuncios', 'ad set name'],
    alcance: ['alcance', 'reach'],
    impressoes: ['impressoes', 'impr.', 'impr', 'impressions'],
    cliques: ['cliques no link', 'link clicks', 'cliques (todos)', 'cliques', 'clicks', 'clicks (all)'],
    ctr: ['ctr (taxa de cliques no link)', 'ctr (link click-through rate)', 'ctr'],
    cpc: ['cpc (custo por clique no link) (brl)', 'cpc (custo por clique no link)', 'cpc (cost per link click) (brl)', 'cpc med.', 'cpc medio', 'avg. cpc', 'cpc'],
    investimento: ['valor usado (brl)', 'valor usado', 'amount spent (brl)', 'amount spent', 'custo', 'cost', 'gasto', 'investimento'],
    resultados: ['resultados', 'results', 'conversoes', 'conversions', 'leads', 'todas as conversoes', 'all conv.'],
    inicio: ['inicio dos relatorios', 'reporting starts', 'dia', 'day', 'data', 'date', 'inicio'],
    fim: ['termino dos relatorios', 'reporting ends', 'termino', 'fim']
};

function trAcharColuna(cabs, nomes) {
    for (const n of nomes) { const i = cabs.indexOf(n); if (i >= 0) return i; }
    for (const n of nomes) { const i = cabs.findIndex(c => c.startsWith(n + ' (') || c.startsWith(n + ' ')); if (i >= 0) return i; }
    return -1;
}

// Converte "1.234,56", "1234.56", "R$ 2,78", "0,73%" em número
function trParseNumero(v, inteiro = false) {
    if (typeof v === 'number') return v;
    let s = String(v ?? '').replace(/R\$|%|\s| /g, '').trim();
    if (!s || s === '-' || s === '--') return 0;
    const temV = s.includes(','), temP = s.includes('.');
    if (temV && temP) {
        s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (temV) {
        s = /^\d{1,3}(,\d{3})+$/.test(s) && inteiro ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (temP && (/^\d{1,3}(\.\d{3}){2,}$/.test(s) || (inteiro && /^\d{1,3}(\.\d{3})+$/.test(s)))) {
        s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return isFinite(n) ? n : 0;
}

function trParseData(v) {
    if (!v && v !== 0) return '';
    if (v instanceof Date && !isNaN(v)) return trIso(v);
    if (typeof v === 'number' && v > 20000 && v < 80000) return trIso(new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000));
    const s = String(v).trim();
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = trNormCab(s).match(/(\d{1,2}) de ([a-z]+)\.? de (\d{4})/);
    if (m) {
        const mi = MESES_TR.findIndex(n => trNormCab(n).startsWith(m[2].slice(0, 3)));
        if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return '';
}

function trParseCSV(texto) {
    texto = texto.replace(/^﻿/, '');
    const primeira = texto.split(/\r?\n/).find(l => /[,;\t]/.test(l)) || '';
    const delim = [';', '\t', ','].map(d => [d, primeira.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const linhas = [];
    let linha = [], campo = '', aspas = false;
    for (let i = 0; i < texto.length; i++) {
        const ch = texto[i];
        if (aspas) {
            if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
            else campo += ch;
        } else if (ch === '"') aspas = true;
        else if (ch === delim) { linha.push(campo); campo = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && texto[i + 1] === '\n') i++;
            linha.push(campo); linhas.push(linha); linha = []; campo = '';
        } else campo += ch;
    }
    if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas;
}

async function trLerArquivo(arquivo) {
    const nome = arquivo.name.toLowerCase();
    if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
        const buf = await arquivo.arrayBuffer();
        let txt = new TextDecoder('utf-8').decode(buf);
        if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf);
        if (/^﻿?\s*$/.test(txt.slice(0, 2)) || txt.charCodeAt(1) === 0) txt = new TextDecoder('utf-16le').decode(buf);
        return trParseCSV(txt);
    }
    const XLSX = await carregarSheetJS();
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

// Transforma as linhas do arquivo em lançamentos
function trInterpretar(linhas) {
    const idxCab = linhas.findIndex(l => {
        const c = l.map(trNormCab);
        return trAcharColuna(c, TR_COLUNAS.anuncio) >= 0 && (trAcharColuna(c, TR_COLUNAS.cliques) >= 0 || trAcharColuna(c, TR_COLUNAS.investimento) >= 0);
    });
    if (idxCab < 0) throw new Error('Não encontrei as colunas do relatório (nome do anúncio, cliques, valor usado…). Exporte o relatório em CSV ou Excel pelo Gerenciador de Anúncios.');
    const cabs = linhas[idxCab].map(trNormCab);
    const col = {};
    Object.keys(TR_COLUNAS).forEach(k => { col[k] = trAcharColuna(cabs, TR_COLUNAS[k]); });
    if (col.fim === col.inicio) col.fim = -1;
    const plataforma = cabs.some(c => c.startsWith('valor usado') || c.startsWith('amount spent') || c === 'alcance' || c === 'reach' || c.startsWith('inicio dos relatorios') || c.startsWith('reporting starts')) ? 'Meta'
        : (cabs.some(c => c.startsWith('impr') || c === 'custo' || c === 'cost' || c.startsWith('conversoes')) ? 'Google' : '');
    // Datas escritas nas linhas de título (relatórios do Google)
    const datasTitulo = linhas.slice(0, idxCab).flat().map(String).join(' ').split(/\s[-–]\s|\sa\s|\sto\s/).map(trParseData).filter(Boolean);
    const val = (l, k, inteiro) => col[k] >= 0 ? trParseNumero(l[col[k]], inteiro) : null;
    const itens = new Map();
    linhas.slice(idxCab + 1).forEach(l => {
        const nome = String(l[col.anuncio] ?? '').trim();
        if (!nome || /^total/i.test(trNormCab(nome)) || nome === '--') return;
        const alcance = val(l, 'alcance', true) || 0;
        const cliques = val(l, 'cliques', true) || 0;
        let investimento = val(l, 'investimento');
        let impressoes = val(l, 'impressoes', true);
        const ctr = val(l, 'ctr'), cpc = val(l, 'cpc');
        const resultados = val(l, 'resultados') || 0;
        if (investimento === null && cpc && cliques) investimento = cpc * cliques;
        if (!impressoes && ctr && cliques) impressoes = Math.round(cliques / (ctr / 100));
        if (!alcance && !cliques && !investimento && !resultados && !impressoes) return;
        const inicio = col.inicio >= 0 ? trParseData(l[col.inicio]) : '';
        const fim = col.fim >= 0 ? trParseData(l[col.fim]) : inicio;
        const chave = nome.toLocaleLowerCase('pt-BR') + '|' + inicio + '|' + fim;
        const atual = itens.get(chave) || { anuncio: nome, inicio, fim, alcance: 0, impressoes: 0, cliques: 0, investimento: 0, resultados: 0 };
        atual.alcance += alcance; atual.impressoes += impressoes || 0; atual.cliques += cliques;
        atual.investimento += investimento || 0; atual.resultados += Math.round(resultados);
        itens.set(chave, atual);
    });
    const lista = [...itens.values()].map(x => ({ ...x, investimento: Math.round(x.investimento * 100) / 100, impressoes: x.impressoes || null }));
    if (!lista.length) throw new Error('O arquivo não tem linhas de anúncios com números.');
    const temDatas = lista.every(x => x.inicio && x.fim);
    return { lista, plataforma, temDatas, datasTitulo: datasTitulo.length >= 2 ? [datasTitulo[0], datasTitulo[datasTitulo.length - 1]] : null };
}

function abrirImportarTrafego() {
    AppState._trImport = null;
    document.getElementById('form-trafego-import').reset();
    document.getElementById('tri-preview').innerHTML = '';
    document.getElementById('tri-datas').classList.add('oculto');
    document.getElementById('tri-confirmar').disabled = true;
    document.getElementById('modal-trafego-import').classList.add('active');
}

async function trArquivoEscolhido(arquivo) {
    const prev = document.getElementById('tri-preview');
    const btn = document.getElementById('tri-confirmar');
    btn.disabled = true;
    prev.innerHTML = '<div class="tr-vazio">Lendo o arquivo…</div>';
    try {
        const r = trInterpretar(await trLerArquivo(arquivo));
        AppState._trImport = r;
        if (r.plataforma) document.getElementById('tri-plataforma').value = r.plataforma;
        const boxDatas = document.getElementById('tri-datas');
        if (!r.temDatas) {
            boxDatas.classList.remove('oculto');
            const j = trJanelaAtual();
            document.getElementById('tri-inicio').value = r.datasTitulo ? r.datasTitulo[0] : j.ini;
            document.getElementById('tri-fim').value = r.datasTitulo ? r.datasTitulo[1] : j.fim;
        } else boxDatas.classList.add('oculto');
        const per = r.temDatas ? (() => { const i = r.lista.map(x => x.inicio).sort()[0], f = r.lista.map(x => x.fim).sort().pop(); return `${trCompleta(i)} a ${trCompleta(f)}`; })() : (r.datasTitulo ? 'confira o período abaixo' : 'informe o período abaixo');
        const tot = trSomar(r.lista);
        prev.innerHTML = `<div class="tri-resumo"><b>${r.lista.length}</b> ${r.lista.length === 1 ? 'anúncio encontrado' : 'linhas de anúncios encontradas'} · período: <b>${per}</b> · investido: <b>${trMoeda(tot.investimento)}</b> · resultados: <b>${trNum(tot.resultados)}</b></div>
            <div class="tri-lista">${r.lista.slice(0, 12).map(x => `<div><span>${escHtml(x.anuncio)}</span><span>${trNum(x.cliques)} cliques · ${trMoeda(x.investimento)} · ${trNum(x.resultados)} res.</span></div>`).join('')}${r.lista.length > 12 ? `<div><span>… e mais ${r.lista.length - 12}</span></div>` : ''}</div>`;
        btn.disabled = false;
    } catch (e) {
        AppState._trImport = null;
        prev.innerHTML = `<div class="tri-erro">${escHtml(e.message || 'Não foi possível ler o arquivo.')}</div>`;
    }
}

function confirmarImportTrafego() {
    const r = AppState._trImport;
    if (!r) return;
    const plataforma = document.getElementById('tri-plataforma').value;
    let ini = '', fim = '';
    if (!r.temDatas) {
        ini = document.getElementById('tri-inicio').value; fim = document.getElementById('tri-fim').value;
        if (!ini || !fim || fim < ini) return showToast('Informe o período do relatório (início e fim).');
    }
    if (!AppState.trafego) AppState.trafego = [];
    let novos = 0, atualizados = 0;
    r.lista.forEach((x, k) => {
        const reg = { ...x, plataforma, inicio: x.inicio || ini, fim: x.fim || fim, criadoEm: new Date().toISOString() };
        const chave = (l) => [l.plataforma, String(l.anuncio).toLocaleLowerCase('pt-BR'), l.inicio, l.fim].join('|');
        const i = AppState.trafego.findIndex(l => chave(l) === chave(reg));
        if (i >= 0) { AppState.trafego[i] = { ...AppState.trafego[i], ...reg, id: AppState.trafego[i].id }; atualizados++; }
        else { AppState.trafego.push({ id: 'tr-' + Date.now() + '-' + k + '-' + Math.random().toString(36).slice(2, 6), ...reg }); novos++; }
    });
    salvarTrafego();
    document.getElementById('modal-trafego-import').classList.remove('active');
    const ultimo = AppState.trafego.filter(l => r.lista.some(x => x.anuncio === l.anuncio)).map(trMeioDoPeriodo).sort().pop();
    if (ultimo) AppState.trafegoRef = ultimo;
    renderTrafegoView();
    showToast(`Relatório importado: ${novos} ${novos === 1 ? 'lançamento novo' : 'lançamentos novos'}${atualizados ? `, ${atualizados} atualizado(s)` : ''}.`);
}

/* ---------- Eventos ---------- */
function setupTrafego() {
    const painel = document.getElementById('panel-trafego');
    if (!painel || painel._bound) return;
    painel._bound = true;
    document.querySelectorAll('#tr-tipos button').forEach(b => b.addEventListener('click', () => {
        const j = trJanelaAtual();
        // Continua no mesmo momento: usa o lançamento mais recente do período atual (ou o início dele)
        const noPeriodo = trLancamentosDaJanela(j).map(trMeioDoPeriodo).sort().pop();
        AppState.trafegoTipo = b.dataset.tipo;
        AppState.trafegoRef = noPeriodo || j.ini;
        renderTrafegoView();
    }));
    document.getElementById('tr-ant').addEventListener('click', () => { AppState.trafegoRef = trDeslocar(AppState.trafegoTipo || 'semana', trJanelaAtual(), -1).ini; renderTrafegoView(); });
    document.getElementById('tr-prox').addEventListener('click', () => { AppState.trafegoRef = trDeslocar(AppState.trafegoTipo || 'semana', trJanelaAtual(), 1).ini; renderTrafegoView(); });
    document.getElementById('tr-btn-importar').addEventListener('click', abrirImportarTrafego);
    document.getElementById('tr-btn-lancar').addEventListener('click', () => abrirLancamentoTrafego());
    document.getElementById('tr-lancamentos').addEventListener('click', (e) => {
        const ed = e.target.closest('[data-editar]'), ex = e.target.closest('[data-excluir]');
        if (ed) abrirLancamentoTrafego(ed.dataset.editar);
        if (ex) excluirLancamentoTrafego(ex.dataset.excluir);
    });
    document.getElementById('tr-evolucao').addEventListener('click', (e) => {
        const row = e.target.closest('[data-ref]');
        if (row) { AppState.trafegoRef = row.dataset.ref; renderTrafegoView(); }
    });
    document.getElementById('form-trafego-lanc').addEventListener('submit', (e) => { e.preventDefault(); salvarLancamentoTrafego(); });
    document.getElementById('tri-arquivo').addEventListener('change', (e) => { if (e.target.files[0]) trArquivoEscolhido(e.target.files[0]); });
    document.getElementById('form-trafego-import').addEventListener('submit', (e) => { e.preventDefault(); confirmarImportTrafego(); });
}
document.addEventListener('DOMContentLoaded', setupTrafego);
