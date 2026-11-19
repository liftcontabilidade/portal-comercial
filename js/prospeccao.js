/* ==========================================================================
   PROSPECÇÃO ATIVA — fluxo de cadência semanal com checklist
   Os leads são divididos em 5 grupos (A = leads 1–100, B = 101–200 …).
   Cada dia da semana tem: Follow-ups, E-mails, Ligações e WhatsApp.
   As marcações ficam no banco (config/prospeccao).
   ========================================================================== */

const PA_GRUPOS = [
    { g: 'A', faixa: '1–100' }, { g: 'B', faixa: '101–200' }, { g: 'C', faixa: '201–300' },
    { g: 'D', faixa: '301–400' }, { g: 'E', faixa: '401–500' }
];
const PA_DIAS = [
    { k: 'seg', nome: 'Segunda', email: 'ABCDE', wpp: 'A',  lig: 'A' },
    { k: 'ter', nome: 'Terça',   email: 'ABCDE', wpp: 'AB', lig: 'B' },
    { k: 'qua', nome: 'Quarta',  email: 'ABCDE', wpp: 'BC', lig: 'C' },
    { k: 'qui', nome: 'Quinta',  email: 'ABCDE', wpp: 'CD', lig: 'D' },
    { k: 'sex', nome: 'Sexta',   email: 'ABCDE', wpp: 'DE', lig: 'E' }
];
// Ordem da rotina do dia
const PA_TAREFAS = [
    { k: 'follow', nome: 'Follow-ups', icone: '↻' },
    { k: 'email', nome: 'E-mails do dia', icone: '✉' },
    { k: 'lig', nome: 'Ligar para os do dia', icone: '☎' },
    { k: 'wpp', nome: 'WhatsApp do dia', icone: '💬' }
];
const PA_TOTAL_SEMANA = PA_DIAS.length * PA_TAREFAS.length;

// Metas de conversão (cada etapa sobre a anterior)
const PA_METAS_PADRAO = { atendeu: 10, proposta: 30, fechou: 20 };
const Prospeccao = { checks: {}, metas: { ...PA_METAS_PADRAO }, recebida: false };

window.aplicarProspeccaoDaNuvem = function (dados) {
    Prospeccao.checks = (dados && dados.checks) || {};
    Prospeccao.metas = { ...PA_METAS_PADRAO, ...((dados && dados.metas) || {}) };
    Prospeccao.recebida = true;
    if (AppState.currentView === 'prospeccao') renderProspeccaoView();
};

function paSemanaDe(iso) { return trJanela('semana', iso).ini; } // segunda-feira
function paSemanaAtual() { return AppState.paSemana || (AppState.paSemana = paSemanaDe(trIso(new Date()))); }
function paDiaIso(segunda, i) { const d = trData(segunda); d.setDate(d.getDate() + i); return trIso(d); }
function paFeitas(semana) { return Object.values(Prospeccao.checks[semana] || {}).filter(Boolean).length; }

async function paMarcar(semana, chave, valor) {
    const s = { ...(Prospeccao.checks[semana] || {}) };
    if (valor) s[chave] = true; else delete s[chave];
    const checks = { ...Prospeccao.checks };
    if (Object.keys(s).length) checks[semana] = s; else delete checks[semana];
    Prospeccao.checks = checks;
    renderProspeccaoView();
    await paSalvar();
}

async function paSalvar() {
    const dados = { checks: Prospeccao.checks, metas: Prospeccao.metas };
    try {
        if (window.LiftCloud && window.LiftCloud.salvarProspeccao) await window.LiftCloud.salvarProspeccao(dados);
        else localStorage.setItem('lift_prospeccao', JSON.stringify(dados));
    } catch (e) {
        if (typeof showToast === 'function') showToast('Não consegui salvar: ' + e.message, 'error');
    }
}

/* ---------- Metas de conversão (dados do funil "Prospecção ativa" no RD) ---------- */
function paFunis() { return (Funis.funis || []).filter(f => /prospec/i.test(f.nome || '')); }

function paJanelaMetas(semana) {
    const tipo = AppState.paMetaTipo || 'mes';
    if (tipo === 'semana') return { ...trJanela('semana', semana), tipo };
    if (tipo === 'ano') { const a = semana.slice(0, 4); return { ini: `${a}-01-01`, fim: `${a}-12-31`, label: `Ano de ${a}`, tipo }; }
    return { ...trJanela('mes', paDiaIso(semana, 2)), tipo };
}

// Quantos leads (criados no período) chegaram a cada etapa
function paConversao(j) {
    const funis = paFunis();
    if (!funis.length) return null;
    let total = 0, atendeu = 0, proposta = 0, fechou = 0;
    for (const f of funis) {
        const d = Funis.dados.get(crmChaveJanela(f.id, j));
        if (!d) return null;
        const etapas = [...(f.etapas || [])].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
        const pos = (re) => { const i = etapas.findIndex(e => re.test(crmSemAcento(e.nome))); return i < 0 ? Infinity : i; };
        const iAtendeu = pos(/^contatad/), iProposta = pos(/proposta/);
        d.lista.forEach(n => {
            total++;
            const i = n.ganha === true ? Infinity : etapas.findIndex(e => String(e.id) === String(n.etapa));
            if (n.ganha === true || i >= iAtendeu) atendeu++;
            if (n.ganha === true || i >= iProposta) proposta++;
            if (n.ganha === true) fechou++;
        });
    }
    return { total, atendeu, proposta, fechou };
}

function paHtmlMetas(semana) {
    const m = Prospeccao.metas;
    const j = paJanelaMetas(semana);
    const tipo = j.tipo;
    const leadsPorCliente = Math.ceil(100 / m.atendeu * 100 / m.proposta * 100 / m.fechou);
    const editar = AppState.paEditarMetas;
    const topo = `<div class="pa-metas-topo">
        <div><h3>Metas de conversão</h3><span>Funil Prospecção ativa (RD) · leads que entraram em: <b>${escHtml(j.label)}</b></span></div>
        <div class="pa-metas-acoes">
            <div class="tr-tipos" id="pa-meta-tipos">${[['semana', 'Semana'], ['mes', 'Mês'], ['ano', 'Ano']].map(([k, t]) => `<button type="button" data-t="${k}"${k === tipo ? ' class="active"' : ''}>${t}</button>`).join('')}</div>
            <button type="button" class="btn-secondary" id="pa-meta-editar">${editar ? 'Salvar metas' : '✎ Editar metas'}</button>
        </div></div>`;
    let corpo;
    if (typeof crmConectado !== 'function' || !crmConectado()) {
        corpo = `<p class="pa-metas-aviso">Conecte o RD Station CRM na aba <b>Funis</b> para comparar com as metas.</p>`;
    } else if (Funis.funis && !paFunis().length) {
        corpo = `<p class="pa-metas-aviso">Não achei no RD um funil com "Prospecção" no nome.</p>`;
    } else {
        const c = paConversao(j);
        if (!c) {
            crmCarregarJanela(j, false, paFunis);
            corpo = `<p class="pa-metas-aviso">Carregando dados do RD…</p>`;
        } else {
            const pct = (a, b) => b ? a / b * 100 : null;
            const etapas = [
                { k: 'atendeu', nome: 'Atenderam', qtd: c.atendeu, base: c.total, baseNome: 'dos leads', sub: 'chegaram a "Contatado" ou além' },
                { k: 'proposta', nome: 'Receberam proposta', qtd: c.proposta, base: c.atendeu, baseNome: 'de quem atendeu', sub: 'chegaram a "Proposta feita" ou além' },
                { k: 'fechou', nome: 'Fecharam', qtd: c.fechou, base: c.proposta, baseNome: 'de quem recebeu proposta', sub: 'negociações ganhas' }
            ];
            corpo = `<div class="pa-funil">
                <div class="pa-etapa pa-etapa-total"><span class="pa-etapa-nome">Leads</span><b class="pa-etapa-num">${c.total}</b><span class="pa-etapa-sub">entraram no período</span></div>
                ${etapas.map(e => {
                    const p = pct(e.qtd, e.base), meta = m[e.k];
                    const ok = p !== null && p >= meta;
                    const larg = p === null ? 0 : Math.min(100, p / (meta * 2) * 100);
                    return `<div class="pa-etapa ${p === null ? '' : ok ? 'bateu' : 'abaixo'}">
                        <span class="pa-etapa-nome">${e.nome}</span>
                        <b class="pa-etapa-num">${e.qtd}</b>
                        <span class="pa-etapa-taxa">${p === null ? '—' : p.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'} <small>${e.baseNome}</small></span>
                        <span class="pa-meta-barra"><i style="width:${larg}%"></i><em style="left:50%"></em></span>
                        <span class="pa-etapa-meta">Meta ${editar ? `<input type="number" min="1" max="100" step="1" data-meta="${e.k}" value="${meta}">` : meta}%${p === null ? '' : ok ? ' · <b class="tr-txt-bom">bateu</b>' : ' · <b class="pa-txt-ruim">abaixo</b>'}</span>
                        <span class="pa-etapa-sub">${e.sub}</span>
                    </div>`;
                }).join('')}
            </div>`;
        }
    }
    return `<div class="opp-card pa-metas">${topo}${corpo}
        <div class="pa-metas-rodape">Com as metas atuais (${m.atendeu}% → ${m.proposta}% → ${m.fechou}%), são precisos cerca de <b>${leadsPorCliente} leads</b> para fechar 1 cliente.</div></div>`;
}

const paGrupos = (txt) => txt.split('').map(g => `<span class="pa-g pa-g-${g}">${g}</span>`).join('');

function paDetalhe(dia, i, tarefa) {
    if (tarefa.k === 'email') return `Grupos ${paGrupos(dia.email)} <small>(todos os leads)</small>`;
    if (tarefa.k === 'lig') return `Grupo ${paGrupos(dia.lig)}`;
    if (tarefa.k === 'wpp') return `Grupos ${paGrupos(dia.wpp)}${i > 0 ? ' <small>+ quem não respondeu ontem</small>' : ''}`;
    return '<small>Retornos e contatos pendentes</small>';
}

function renderProspeccaoView() {
    const box = document.getElementById('pa-conteudo');
    if (!box) return;
    const semana = paSemanaAtual();
    const hoje = trIso(new Date());
    const fimSemana = paDiaIso(semana, 4);
    const lbl = document.getElementById('pa-periodo-label');
    if (lbl) lbl.textContent = `Semana de ${trCurta(semana)} a ${trCurta(fimSemana)}/${fimSemana.slice(0, 4)}`;
    const marc = Prospeccao.checks[semana] || {};
    const feitas = paFeitas(semana);
    const pct = Math.round(feitas / PA_TOTAL_SEMANA * 100);

    const dias = PA_DIAS.map((dia, i) => {
        const iso = paDiaIso(semana, i);
        const feitasDia = PA_TAREFAS.filter(t => marc[dia.k + '-' + t.k]).length;
        const completo = feitasDia === PA_TAREFAS.length;
        const atrasado = iso < hoje && !completo;
        return `<div class="pa-dia${iso === hoje ? ' hoje' : ''}${completo ? ' completo' : ''}">
            <div class="pa-dia-topo"><div><b>${dia.nome}</b><span>${trCurta(iso)}${iso === hoje ? ' · hoje' : ''}</span></div>
                <span class="pa-dia-cont${atrasado ? ' atrasado' : ''}">${completo ? '✓ Feito' : `${feitasDia}/${PA_TAREFAS.length}`}</span></div>
            ${PA_TAREFAS.map((t, n) => {
                const ch = dia.k + '-' + t.k, ok = !!marc[ch];
                return `<label class="pa-tarefa${ok ? ' ok' : ''}">
                    <input type="checkbox" data-ch="${ch}"${ok ? ' checked' : ''}>
                    <span class="pa-check"></span>
                    <span class="pa-txt"><b>${n + 1}. ${t.nome}</b><span>${paDetalhe(dia, i, t)}</span></span>
                </label>`;
            }).join('')}
        </div>`;
    }).join('');

    // Todas as semanas do ano (até a próxima), da mais recente para a mais antiga
    const ano = Number(semana.slice(0, 4));
    const semanas = [];
    let s = paSemanaDe(`${ano}-01-01`);
    const limite = paSemanaDe(paDiaIso(paSemanaDe(hoje), 7));
    Object.keys(Prospeccao.checks).forEach(k => { if (k.slice(0, 4) === String(ano) && !semanas.includes(k)) semanas.push(k); });
    while (s <= limite && s.slice(0, 4) <= String(ano)) { if (!semanas.includes(s) && paDiaIso(s, 4).slice(0, 4) === String(ano)) semanas.push(s); s = paDiaIso(s, 7); }
    if (!semanas.includes(semana)) semanas.push(semana);
    semanas.sort().reverse();
    const lista = semanas.map(w => {
        const f = paFeitas(w), p = Math.round(f / PA_TOTAL_SEMANA * 100);
        return `<button type="button" class="pa-sem${w === semana ? ' ativa' : ''}${w > hoje ? ' futura' : ''}" data-sem="${w}">
            <span>${trCurta(w)} a ${trCurta(paDiaIso(w, 4))}${w === paSemanaDe(hoje) ? ' <em>esta semana</em>' : ''}</span>
            <span class="pa-sem-barra"><i style="width:${p}%"></i></span>
            <b>${f}/${PA_TOTAL_SEMANA}</b>
        </button>`;
    }).join('');

    box.innerHTML = `
        <div class="opp-kpi-row pa-kpis">
            <div class="opp-kpi-card accent-orange"><div><span class="opp-kpi-label">Feito na semana</span><span class="opp-kpi-value orange">${pct}%</span><span class="opp-kpi-sub">${feitas} de ${PA_TOTAL_SEMANA} tarefas</span></div></div>
            <div class="pa-grupos-card">
                <span class="opp-kpi-label">Grupos de leads</span>
                <div class="pa-grupos">${PA_GRUPOS.map(x => `<span>${paGrupos(x.g)} leads ${x.faixa}</span>`).join('')}</div>
            </div>
        </div>
        <div class="pa-barra-semana"><i style="width:${pct}%"></i></div>
        ${paHtmlMetas(semana)}
        <div class="pa-dias">${dias}</div>
        <div class="opp-card pa-semanas">
            <h3>Todas as semanas de ${ano}</h3>
            <div class="pa-sem-lista">${lista}</div>
        </div>`;

    box.querySelectorAll('input[data-ch]').forEach(inp => inp.addEventListener('change', () => paMarcar(semana, inp.dataset.ch, inp.checked)));
    box.querySelectorAll('#pa-meta-tipos button').forEach(b => b.addEventListener('click', () => { AppState.paMetaTipo = b.dataset.t; renderProspeccaoView(); }));
    document.getElementById('pa-meta-editar')?.addEventListener('click', () => {
        if (AppState.paEditarMetas) {
            const novas = { ...Prospeccao.metas };
            box.querySelectorAll('input[data-meta]').forEach(i => { const v = Math.round(Number(i.value)); if (v >= 1 && v <= 100) novas[i.dataset.meta] = v; });
            Prospeccao.metas = novas;
            AppState.paEditarMetas = false;
            paSalvar();
        } else AppState.paEditarMetas = true;
        renderProspeccaoView();
    });
    box.querySelectorAll('.pa-sem').forEach(b => b.addEventListener('click', () => { AppState.paSemana = b.dataset.sem; renderProspeccaoView(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}

function setupProspeccao() {
    try { if (!Prospeccao.recebida) { const l = JSON.parse(localStorage.getItem('lift_prospeccao') || 'null'); if (l && l.checks) Prospeccao.checks = l.checks; if (l && l.metas) Prospeccao.metas = { ...PA_METAS_PADRAO, ...l.metas }; } } catch (e) { /* sem armazenamento */ }
    const mover = (n) => { AppState.paSemana = paDiaIso(paSemanaAtual(), 7 * n); renderProspeccaoView(); };
    document.getElementById('pa-ant')?.addEventListener('click', () => mover(-1));
    document.getElementById('pa-prox')?.addEventListener('click', () => mover(1));
    document.getElementById('pa-hoje')?.addEventListener('click', () => { AppState.paSemana = paSemanaDe(trIso(new Date())); renderProspeccaoView(); });
}
document.addEventListener('DOMContentLoaded', setupProspeccao);
