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
const PA_METAS_PADRAO = { leadsSemana: 500, atendeu: 10, proposta: 30, fechou: 20 };
const Prospeccao = { checks: {}, metas: { ...PA_METAS_PADRAO }, recebida: false };

window.aplicarProspeccaoDaNuvem = function (dados) {
    Prospeccao.checks = (dados && dados.checks) || {};
    Prospeccao.metas = { ...PA_METAS_PADRAO, ...((dados && dados.metas) || {}) };
    Prospeccao.recebida = true;
    if (AppState.currentView === 'prospeccao') renderProspeccaoView();
};

function paSemanaDe(iso) { return trJanela('semana', iso).ini; } // segunda-feira
// Período escolhido no topo: Semana, Mês ou Ano (AppState.paRef = uma data dentro do período)
function paTipo() { return AppState.paTipo || 'semana'; }
function paRef() { return AppState.paRef || (AppState.paRef = trIso(new Date())); }
function paSemanaAtual() { return paSemanaDe(paRef()); }
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
    const tipo = paTipo();
    // Semana: os leads importados no fim de semana anterior entram na semana em que serão contatados (sábado a sexta)
    if (tipo === 'semana') { const sx = paDiaIso(semana, 4); return { ini: paDiaIso(semana, -2), fim: sx, label: `Semana de ${trCurta(semana)} a ${trCurta(sx)}/${sx.slice(0, 4)}`, tipo }; }
    if (tipo === 'ano') { const a = paRef().slice(0, 4); return { ini: `${a}-01-01`, fim: `${a}-12-31`, label: `Ano de ${a}`, tipo }; }
    return { ...trJanela('mes', paRef()), tipo };
}

// Primeira semana de prospecção: a mais antiga entre o primeiro lead do funil no RD e a primeira tarefa marcada
function paInicio(j) {
    let ini = Object.keys(Prospeccao.checks).sort()[0] || '';
    for (const f of paFunis()) {
        const d = Funis.dados.get(crmChaveJanela(f.id, j));
        (d ? d.lista : []).forEach(n => { const c = String(n.criada || '').slice(0, 10); if (c && (!ini || c < ini)) ini = c; });
    }
    return ini ? paSemanaDe(ini) : paSemanaDe(trIso(new Date()));
}
// Semanas de prospecção do período. Cada semana pertence ao mês da sua quarta-feira
// (assim todo mês tem 4 ou 5 semanas). No Ano, conta a partir do início da prospecção.
function paSemanasLista(j) {
    if (j.tipo === 'semana') return [paSemanaDe(paDiaIso(j.fim, -4))];
    const inicio = j.tipo === 'ano' ? paInicio(j) : '', lista = [];
    for (let s = paSemanaDe(paDiaIso(j.ini, -6)); s <= j.fim; s = paDiaIso(s, 7)) {
        const quarta = paDiaIso(s, 2);
        if (quarta >= j.ini && quarta <= j.fim && s >= inicio) lista.push(s);
    }
    return lista;
}
function paSemanasNoPeriodo(j) { return paSemanasLista(j).length; }

// Quantos leads (criados no período) chegaram a cada etapa
function paConversao(j) {
    const funis = paFunis();
    if (!funis.length) return null;
    let total = 0, atendeu = 0, proposta = 0, fechou = 0;
    const porEtapa = new Map();
    for (const f of funis) {
        const d = Funis.dados.get(crmChaveJanela(f.id, j));
        if (!d) return null;
        const etapas = [...(f.etapas || [])].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
        const pos = (re) => { const i = etapas.findIndex(e => re.test(crmSemAcento(e.nome))); return i < 0 ? Infinity : i; };
        const iAtendeu = pos(/^contatad/), iProposta = pos(/proposta/);
        etapas.forEach(e => { if (!porEtapa.has(e.nome)) porEtapa.set(e.nome, 0); });
        d.lista.forEach(n => {
            total++;
            const nomeEt = n.ganha === true ? 'Ganho' : n.ganha === false ? 'Perdidos' : (n.etapaNome || 'Sem etapa');
            porEtapa.set(nomeEt, (porEtapa.get(nomeEt) || 0) + 1);
            const i = n.ganha === true ? Infinity : etapas.findIndex(e => String(e.id) === String(n.etapa));
            if (n.ganha === true || i >= iAtendeu) atendeu++;
            if (n.ganha === true || i >= iProposta) proposta++;
            if (n.ganha === true) fechou++;
        });
    }
    return { total, atendeu, proposta, fechou, porEtapa };
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
            const semanas = paSemanasNoPeriodo(j);
            const base = m.leadsSemana * semanas; // 500 leads por semana a contatar
            const alvo = { atendeu: base * m.atendeu / 100 };
            alvo.proposta = alvo.atendeu * m.proposta / 100;
            alvo.fechou = alvo.proposta * m.fechou / 100;
            const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
            const etapas = [
                { k: 'atendeu', nome: 'Atenderam', qtd: c.atendeu, base, baseNome: `dos ${base} leads`, sub: 'chegaram a "Contatado" ou além' },
                { k: 'proposta', nome: 'Receberam proposta', qtd: c.proposta, base: c.atendeu, baseNome: 'de quem atendeu', sub: 'chegaram a "Proposta feita" ou além' },
                { k: 'fechou', nome: 'Fecharam', qtd: c.fechou, base: c.proposta, baseNome: 'de quem recebeu proposta', sub: 'negociações ganhas' }
            ];
            corpo = `<div class="pa-funil">
                <div class="pa-etapa pa-etapa-total"><span class="pa-etapa-nome">Leads a contatar</span><b class="pa-etapa-num">${base}</b>
                    <span class="pa-etapa-meta">${editar ? `<input type="number" min="1" step="1" data-meta="leadsSemana" value="${m.leadsSemana}">` : m.leadsSemana} por semana${semanas !== 1 ? ` × ${semanas} semanas` : ''}</span>
                    <span class="pa-etapa-sub">${c.total} importados no RD no período</span></div>
                ${etapas.map(e => {
                    const p = pct(e.qtd, e.base), meta = m[e.k];
                    const ok = p !== null && p >= meta;
                    const larg = p === null ? 0 : Math.min(100, p / (meta * 2) * 100);
                    return `<div class="pa-etapa ${p === null ? '' : ok ? 'bateu' : 'abaixo'}">
                        <span class="pa-etapa-nome">${e.nome}</span>
                        <b class="pa-etapa-num">${e.qtd}</b>
                        <span class="pa-etapa-taxa">${p === null ? '—' : p.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'} <small>${e.baseNome}</small></span>
                        <span class="pa-meta-barra"><i style="width:${larg}%"></i><em style="left:50%"></em></span>
                        <span class="pa-etapa-meta">Meta ${editar ? `<input type="number" min="1" max="100" step="1" data-meta="${e.k}" value="${meta}">` : meta}% <small>(${fmt(alvo[e.k])})</small>${p === null ? '' : ok ? ' · <b class="tr-txt-bom">bateu</b>' : ' · <b class="pa-txt-ruim">abaixo</b>'}</span>
                        <span class="pa-etapa-sub">${e.sub}</span>
                    </div>`;
                }).join('')}
            </div>
            <div class="pa-onde"><b>Onde estão os ${c.total} leads importados no período:</b> ${[...c.porEtapa.entries()].filter(([, q]) => q).map(([n, q]) => `<span>${escHtml(n)} <b>${q}</b></span>`).join('') || '—'}</div>
            ${c.total && !c.atendeu ? `<p class="pa-metas-aviso">Nenhum lead que entrou nesse período saiu de "Tentando contato" ainda. Quando o card for movido para "Contatado" (ou além) no RD, ele passa a contar aqui.</p>` : ''}`;
        }
    }
    return `<div class="opp-card pa-metas">${topo}${corpo}
        <div class="pa-metas-rodape">Com ${m.leadsSemana} leads por semana e as metas atuais (${m.atendeu}% → ${m.proposta}% → ${m.fechou}%): <b>${(m.leadsSemana * m.atendeu / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} atendimentos</b>, <b>${(m.leadsSemana * m.atendeu * m.proposta / 10000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} propostas</b> e <b>${(m.leadsSemana * m.atendeu * m.proposta * m.fechou / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} clientes</b> por semana (cerca de ${leadsPorCliente} leads para cada cliente).</div></div>`;
}

const paGrupos = (txt) => txt.split('').map(g => `<span class="pa-g pa-g-${g}">${g}</span>`).join('');

function paDetalhe(dia, i, tarefa) {
    if (tarefa.k === 'email') return `Grupos ${paGrupos(dia.email)} <small>(todos os leads)</small>`;
    if (tarefa.k === 'lig') return `Grupo ${paGrupos(dia.lig)}`;
    if (tarefa.k === 'wpp') return `Grupos ${paGrupos(dia.wpp)}${i > 0 ? ' <small>+ quem não respondeu ontem</small>' : ''}`;
    return '<small>Retornos e contatos pendentes</small>';
}

// Mês/Ano: quanto de cada tarefa e de cada dia foi feito no período
function paHtmlResumo(semanas, nomePeriodo) {
    if (!semanas.length) return `<div class="opp-card pa-resumo"><p class="pa-metas-aviso">Nenhuma semana desse período começou ainda.</p></div>`;
    const n = semanas.length;
    const barra = (f, t) => { const p = t ? Math.round(f / t * 100) : 0; return `<span class="pa-sem-barra"><i style="width:${p}%"></i></span><b>${f}/${t}</b><span class="pa-res-pct">${p}%</span>`; };
    const porTarefa = PA_TAREFAS.map(t => { const f = semanas.reduce((a, w) => a + PA_DIAS.filter(d => (Prospeccao.checks[w] || {})[d.k + '-' + t.k]).length, 0); return `<div class="pa-res-linha"><span>${t.nome}</span>${barra(f, n * PA_DIAS.length)}</div>`; }).join('');
    const porDia = PA_DIAS.map(d => { const f = semanas.reduce((a, w) => a + PA_TAREFAS.filter(t => (Prospeccao.checks[w] || {})[d.k + '-' + t.k]).length, 0); return `<div class="pa-res-linha"><span>${d.nome}</span>${barra(f, n * PA_TAREFAS.length)}</div>`; }).join('');
    const completas = semanas.filter(w => paFeitas(w) === PA_TOTAL_SEMANA).length;
    return `<div class="pa-resumo-grid">
        <div class="opp-card pa-resumo"><h3>Por tarefa ${nomePeriodo}</h3>${porTarefa}</div>
        <div class="opp-card pa-resumo"><h3>Por dia da semana</h3>${porDia}</div>
    </div>
    <p class="pa-metas-aviso">${completas} de ${n} semana${n === 1 ? '' : 's'} com a cadência 100% feita. Para marcar as tarefas, escolha <b>Semana</b> no topo.</p>`;
}

function renderProspeccaoView() {
    const box = document.getElementById('pa-conteudo');
    if (!box) return;
    const semana = paSemanaAtual();
    const tipo = paTipo();
    const hoje = trIso(new Date());
    const fimSemana = paDiaIso(semana, 4);
    const jan = paJanelaMetas(semana);
    document.querySelectorAll('#pa-tipos button').forEach(b => b.classList.toggle('active', b.dataset.t === tipo));
    const lbl = document.getElementById('pa-periodo-label');
    if (lbl) lbl.textContent = tipo === 'semana' ? `Semana de ${trCurta(semana)} a ${trCurta(fimSemana)}/${fimSemana.slice(0, 4)}` : jan.label;
    const hojeBtn = document.getElementById('pa-hoje');
    if (hojeBtn) hojeBtn.textContent = tipo === 'semana' ? 'Esta semana' : tipo === 'mes' ? 'Este mês' : 'Este ano';
    const marc = Prospeccao.checks[semana] || {};
    // Semanas do período (até a semana atual) — no Mês/Ano as tarefas são somadas
    const semanasPeriodo = paSemanasLista(jan);
    const totalTarefas = semanasPeriodo.length * PA_TOTAL_SEMANA;
    const feitas = semanasPeriodo.reduce((t, w) => t + paFeitas(w), 0);
    const pct = totalTarefas ? Math.round(feitas / totalTarefas * 100) : 0;
    const nomePeriodo = tipo === 'semana' ? 'na semana' : tipo === 'mes' ? 'no mês' : 'no ano';

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

    box.innerHTML = `
        <div class="opp-kpi-row pa-kpis">
            <div class="opp-kpi-card accent-orange"><div><span class="opp-kpi-label">Feito ${nomePeriodo}</span><span class="opp-kpi-value orange">${pct}%</span><span class="opp-kpi-sub">${feitas} de ${totalTarefas} tarefas${tipo !== 'semana' ? ` · ${semanasPeriodo.length} semana${semanasPeriodo.length === 1 ? '' : 's'}` : ''}</span></div></div>
            <div class="pa-grupos-card">
                <span class="opp-kpi-label">Grupos de leads <small>(os ${Prospeccao.metas.leadsSemana} importados da semana)</small></span>
                <div class="pa-grupos">${PA_GRUPOS.map(x => `<span>${paGrupos(x.g)} leads ${x.faixa}</span>`).join('')}</div>
            </div>
        </div>
        <div class="pa-barra-semana"><i style="width:${pct}%"></i></div>
        ${paHtmlMetas(semana)}
        ${tipo === 'semana' ? `<div class="pa-dias">${dias}</div>` : paHtmlResumo(semanasPeriodo, nomePeriodo)}
`;

    box.querySelectorAll('input[data-ch]').forEach(inp => inp.addEventListener('change', () => paMarcar(semana, inp.dataset.ch, inp.checked)));
    document.getElementById('pa-meta-editar')?.addEventListener('click', () => {
        if (AppState.paEditarMetas) {
            const novas = { ...Prospeccao.metas };
            box.querySelectorAll('input[data-meta]').forEach(i => { const v = Math.round(Number(i.value)); if (v >= 1 && (v <= 100 || i.dataset.meta === 'leadsSemana')) novas[i.dataset.meta] = v; });
            Prospeccao.metas = novas;
            AppState.paEditarMetas = false;
            paSalvar();
        } else AppState.paEditarMetas = true;
        renderProspeccaoView();
    });
}

function setupProspeccao() {
    try { if (!Prospeccao.recebida) { const l = JSON.parse(localStorage.getItem('lift_prospeccao') || 'null'); if (l && l.checks) Prospeccao.checks = l.checks; if (l && l.metas) Prospeccao.metas = { ...PA_METAS_PADRAO, ...l.metas }; } } catch (e) { /* sem armazenamento */ }
    const mover = (n) => {
        const t = paTipo(), r = trData(paRef());
        if (t === 'semana') r.setDate(r.getDate() + 7 * n);
        else if (t === 'mes') { r.setDate(1); r.setMonth(r.getMonth() + n); }
        else { r.setMonth(0, 1); r.setFullYear(r.getFullYear() + n); }
        AppState.paRef = trIso(r); renderProspeccaoView();
    };
    document.getElementById('pa-ant')?.addEventListener('click', () => mover(-1));
    document.getElementById('pa-prox')?.addEventListener('click', () => mover(1));
    document.getElementById('pa-hoje')?.addEventListener('click', () => { AppState.paRef = trIso(new Date()); renderProspeccaoView(); });
    document.querySelectorAll('#pa-tipos button').forEach(b => b.addEventListener('click', () => {
        AppState.paTipo = b.dataset.t;
        // Ao trocar, fica no período de hoje se ele estiver dentro do que estava aberto
        renderProspeccaoView();
    }));
}
document.addEventListener('DOMContentLoaded', setupProspeccao);
