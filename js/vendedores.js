/* ==========================================================================
   VENDEDORES — quem fechou mais clientes (campo "Vendedor" do cadastro)
   ========================================================================== */
const chaveVendedor = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

function listaVendedores() {
    const nomes = new Map();
    AppState.clientes.forEach(c => { const n = String(c.vendedor || '').trim(); if (n && !nomes.has(chaveVendedor(n))) nomes.set(chaveVendedor(n), n); });
    return [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function preencherListaVendedores() {
    const dl = document.getElementById('lista-vendedores');
    if (dl) dl.innerHTML = listaVendedores().map(n => `<option value="${escHtml(n)}"></option>`).join('');
}

// Lê o vendedor digitado, usando a grafia já cadastrada (para somar certo no ranking)
function lerVendedor(pre) {
    const el = document.getElementById(pre + '-vendedor');
    const v = el ? el.value.trim().replace(/\s+/g, ' ') : '';
    if (!v) return '';
    return listaVendedores().find(n => chaveVendedor(n) === chaveVendedor(v)) || v;
}

function calcularVendedores(ano) {
    const doAno = AppState.clientes.filter(c => Number(c.ano) === ano);
    const grupos = new Map();
    doAno.forEach(c => {
        const nome = String(c.vendedor || '').trim();
        if (!nome) return;
        const k = chaveVendedor(nome);
        if (!grupos.has(k)) grupos.set(k, { chave: k, nome, clientes: [], receita: 0, comValor: 0 });
        const g = grupos.get(k);
        g.clientes.push(c);
        if (temValor(c.valorMensal)) { g.receita += Number(c.valorMensal); g.comValor++; }
    });
    const lista = [...grupos.values()].map(g => ({ ...g, ticket: g.comValor ? g.receita / g.comValor : null }))
        .sort((a, b) => b.clientes.length - a.clientes.length || b.receita - a.receita || a.nome.localeCompare(b.nome, 'pt-BR'));
    const comVendedor = lista.reduce((s, g) => s + g.clientes.length, 0);
    return { lista, comVendedor, semVendedor: doAno.length - comVendedor, totalAno: doAno.length };
}

function renderVendedoresView() {
    const box = document.getElementById('vd-rows');
    if (!box) return;
    const ano = AppState.selectedYearVendedores || new Date().getFullYear();
    renderYearDropdown('vendedores');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const { lista, comVendedor, semVendedor } = calcularVendedores(ano);
    const receitaTotal = lista.reduce((s, g) => s + g.receita, 0);

    const top = lista[0];
    const topRec = lista.slice().sort((a, b) => b.receita - a.receita)[0];
    set('vd-kpi-top', top ? top.nome : '—');
    set('vd-kpi-top-sub', top ? `${top.clientes.length} ${top.clientes.length === 1 ? 'cliente fechado' : 'clientes fechados'}` : 'nenhum vendedor informado');
    set('vd-kpi-receita', topRec && topRec.receita ? topRec.nome : '—');
    set('vd-kpi-receita-sub', topRec && topRec.receita ? `${formatBRL(topRec.receita)}/mês` : '');
    set('vd-kpi-total', comVendedor);
    set('vd-kpi-total-sub', `${lista.length} ${lista.length === 1 ? 'vendedor' : 'vendedores'} em ${ano}`);
    set('vd-kpi-receita-total', receitaTotal ? formatBRL(receitaTotal) : '—');
    set('vd-kpi-receita-total-sub', comVendedor ? 'soma das mensalidades fechadas' : '');
    set('vd-titulo', `RANKING DE VENDEDORES — ${ano}`);

    if (!AppState._vdAbertos) AppState._vdAbertos = new Set();
    const abertos = AppState._vdAbertos;
    const max = Math.max(1, ...lista.map(g => g.clientes.length));
    box.innerHTML = lista.length ? lista.map((g, i) => {
        const aberto = abertos.has(g.chave);
        const clientes = g.clientes.slice().sort((a, b) => String(b.dataEntrada || '').localeCompare(String(a.dataEntrada || '')));
        return `
        <button type="button" class="opp-row vd-row ${aberto ? 'aberto' : ''}" data-vd="${escHtml(g.chave)}" title="Ver os clientes fechados">
            <span class="ind-pos ${i < 3 ? 'top' : ''}">${i + 1}º</span>
            <span class="or-nome"><span class="ind-seta">›</span>${escHtml(g.nome)}</span>
            <span class="or-barra-cell"><span class="or-barra"><i style="width:${(g.clientes.length / max) * 100}%"></i></span><b>${g.clientes.length}</b></span>
            <span class="right">${g.receita ? formatBRL(g.receita) : '—'}</span>
            <span class="right">${g.ticket !== null ? formatBRL(g.ticket) : '—'}</span>
            <span class="center">${comVendedor ? formatPct((g.clientes.length / comVendedor) * 100, 0) : '—'}</span>
        </button>
        ${aberto ? `<div class="vd-detalhe">
            <div class="vd-cli vd-cli-head"><span>Cliente</span><span>Entrada</span><span>Origem</span><span class="right">Mensalidade</span></div>
            ${clientes.map(c => `<div class="vd-cli ${c.status === 'Cancelado' ? 'saiu' : ''}">
                <span class="vd-cli-nome">${escHtml(c.nome || '—')}${c.status === 'Cancelado' ? ' <small>· saiu</small>' : ''}</span>
                <span>${escHtml(c.dataEntrada ? formatDateBR(c.dataEntrada) : (c.mesEntrada || '—'))}</span>
                <span>${escHtml(c.origemCliente || '—')}</span>
                <span class="right">${temValor(c.valorMensal) ? formatBRL(Number(c.valorMensal)) : '—'}</span>
            </div>`).join('')}
        </div>` : ''}`;
    }).join('') : `<div class="home-empty">Nenhum cliente de ${ano} com vendedor informado. Ao cadastrar um cliente, preencha o campo <b>Vendedor</b>.</div>`;

    box.querySelectorAll('.vd-row[data-vd]').forEach(btn => btn.onclick = () => {
        const k = btn.dataset.vd;
        if (abertos.has(k)) abertos.delete(k); else abertos.add(k);
        renderVendedoresView();
    });
    set('vd-aviso', semVendedor
        ? `${semVendedor} ${semVendedor === 1 ? 'cliente fechado' : 'clientes fechados'} em ${ano} ${semVendedor === 1 ? 'está' : 'estão'} sem vendedor informado. Preencha pelo ✏️ na aba Clientes para entrar no ranking.`
        : '');
}
