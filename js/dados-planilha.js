/* ==========================================================================
   DADOS ← PLANILHA (aba "Dashboard" do Google Sheets)
   A aba Dados mostra exatamente os números da planilha (Entradas, Saídas,
   Total clientes, Churn, Churn médio, LTV/meses), lidos ao vivo.
   O link da planilha fica só no banco (config/dadosPlanilha), nunca no código.
   ========================================================================== */

const DadosPlanilha = { cfg: null, linhas: null, erro: '', ultima: null, buscando: false, timer: null, editar: false };
const DP_INTERVALO = 2 * 60 * 1000;

window.aplicarConfigPlanilha = function (cfg) {
    const antes = DadosPlanilha.cfg && DadosPlanilha.cfg.url;
    DadosPlanilha.cfg = cfg && cfg.url ? cfg : null;
    if ((DadosPlanilha.cfg && DadosPlanilha.cfg.url) !== antes) { DadosPlanilha.linhas = null; DadosPlanilha.erro = ''; }
    if (DadosPlanilha.cfg) dpBuscar();
    if (AppState.currentView === 'dados') renderDadosView();
};

function dpConectada() { return !!(DadosPlanilha.cfg && DadosPlanilha.cfg.url); }

// Link "…/spreadsheets/d/ID/edit?gid=123#gid=123" → endereço do CSV da aba
function dpUrlCsv(url) {
    const id = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!id) return null;
    const gid = String(url).match(/[#&?]gid=(\d+)/);
    return `https://docs.google.com/spreadsheets/d/${id[1]}/export?format=csv${gid ? '&gid=' + gid[1] : ''}`;
}

function dpParseCsv(txt) {
    const linhas = []; let linha = [], campo = '', aspas = false;
    for (let i = 0; i < txt.length; i++) {
        const ch = txt[i];
        if (aspas) {
            if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
            else campo += ch;
        } else if (ch === '"') aspas = true;
        else if (ch === ',') { linha.push(campo); campo = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
        else campo += ch;
    }
    if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas;
}

// Acha a linha de cabeçalho (com "Entradas") e lê as competências MM/AAAA
function dpInterpretar(tabela) {
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const iCab = tabela.findIndex(l => l.some(c => norm(c) === 'entradas'));
    if (iCab < 0) throw new Error('não achei a linha de cabeçalho com "Entradas" nessa aba da planilha');
    const cab = tabela[iCab].map(norm);
    const col = (re) => cab.findIndex(c => re.test(c));
    const c = {
        ent: col(/^entradas/), sai: col(/^saidas/), total: col(/^total/),
        churn: col(/^churn$/), churnMedio: col(/^churn med/), ltv: col(/^ltv/)
    };
    const linhas = [];
    tabela.slice(iCab + 1).forEach(l => {
        const comp = l.map(x => String(x).trim()).find(x => /^\d{2}\/\d{4}$/.test(x));
        if (!comp) return;
        const v = (i) => (i >= 0 ? String(l[i] || '').trim() : '');
        linhas.push({ competencia: comp, entradas: v(c.ent), saidas: v(c.sai), total: v(c.total), churn: v(c.churn), churnMedio: v(c.churnMedio), ltv: v(c.ltv) });
    });
    if (!linhas.length) throw new Error('nenhuma linha com competência (MM/AAAA) encontrada');
    return linhas;
}

async function dpBuscar(forcar = false) {
    if (!dpConectada() || DadosPlanilha.buscando) return;
    if (!forcar && DadosPlanilha.ultima && Date.now() - DadosPlanilha.ultima < 30000) return;
    const url = dpUrlCsv(DadosPlanilha.cfg.url);
    if (!url) { DadosPlanilha.erro = 'Link da planilha inválido.'; return; }
    DadosPlanilha.buscando = true;
    try {
        const r = await fetch(url + '&t=' + Date.now(), { cache: 'no-store' });
        const txt = await r.text();
        if (!r.ok || /^\s*<!doctype html|<html/i.test(txt)) throw new Error('a planilha não está acessível. No Google Sheets, em Compartilhar, deixe "Qualquer pessoa com o link" como Leitor.');
        DadosPlanilha.linhas = dpInterpretar(dpParseCsv(txt));
        DadosPlanilha.erro = '';
        DadosPlanilha.ultima = Date.now();
    } catch (e) {
        DadosPlanilha.erro = 'Não consegui ler a planilha: ' + (e.message || e);
    } finally {
        DadosPlanilha.buscando = false;
        if (AppState.currentView === 'dados') renderDadosView();
    }
    clearTimeout(DadosPlanilha.timer);
    DadosPlanilha.timer = setTimeout(() => dpBuscar(true), DP_INTERVALO);
}

const dpAnos = () => [...new Set((DadosPlanilha.linhas || []).map(l => Number(l.competencia.slice(3))))];

// Barra de status/conexão da aba Dados
function dpRenderBarra() {
    const box = document.getElementById('dados-planilha-barra');
    if (!box) return;
    const editar = DadosPlanilha.editar || !dpConectada();
    const st = DadosPlanilha.buscando && !DadosPlanilha.linhas ? 'Lendo a planilha…'
        : DadosPlanilha.erro ? DadosPlanilha.erro
        : DadosPlanilha.ultima ? `Ao vivo da planilha · atualizado às ${new Date(DadosPlanilha.ultima).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
    const cls = DadosPlanilha.erro ? 'erro' : DadosPlanilha.buscando ? 'aviso' : 'ok';
    box.innerHTML = `${dpConectada() ? `<span class="tr-meta-pill ${cls}" title="${escHtml(st)}"><i></i><span>${escHtml(st || 'Planilha conectada')}</span></span>
        <button type="button" class="tr-btn-icone" id="dp-sync" title="Atualizar agora">↻</button>
        <button type="button" class="tr-btn-icone" id="dp-config" title="Trocar a planilha">⚙</button>` : ''}
        ${editar ? `<div class="dp-form">
            <span>${dpConectada() ? 'Trocar a planilha:' : 'Conecte a planilha (aba Dashboard) para a aba Dados mostrar os mesmos números:'}</span>
            <input type="url" class="form-input" id="dp-url" placeholder="Cole o link da aba Dashboard do Google Sheets" value="${escHtml((DadosPlanilha.cfg && DadosPlanilha.cfg.url) || '')}">
            <button type="button" class="btn-primary" id="dp-salvar">Conectar</button>
            ${dpConectada() ? '<button type="button" class="btn-secondary" id="dp-desconectar">Desconectar</button>' : ''}
        </div>` : ''}`;
    box.querySelector('#dp-sync')?.addEventListener('click', () => dpBuscar(true));
    box.querySelector('#dp-config')?.addEventListener('click', () => { DadosPlanilha.editar = !DadosPlanilha.editar; dpRenderBarra(); });
    box.querySelector('#dp-desconectar')?.addEventListener('click', async () => {
        try { await window.LiftCloud.salvarConfigPlanilha(null); DadosPlanilha.editar = false; } catch (e) { showToast('Não consegui salvar: ' + e.message, 'error'); }
    });
    box.querySelector('#dp-salvar')?.addEventListener('click', async () => {
        const url = box.querySelector('#dp-url').value.trim();
        if (!dpUrlCsv(url)) { showToast('Cole o link da planilha do Google Sheets (docs.google.com/spreadsheets/…).', 'error'); return; }
        if (!window.LiftCloud || !window.LiftCloud.salvarConfigPlanilha) { showToast('Entre no portal para salvar a conexão.', 'error'); return; }
        try {
            await window.LiftCloud.salvarConfigPlanilha({ url });
            DadosPlanilha.editar = false;
            showToast('Planilha conectada.');
        } catch (e) { showToast('Não consegui salvar: ' + e.message, 'error'); }
    });
}

// Desenha a tabela da aba Dados com os números da planilha. Devolve false se não há dados do ano.
function dpRenderTabela(ano) {
    if (!dpConectada()) return false;
    if (!DadosPlanilha.linhas) { dpBuscar(); return false; }
    const linhas = DadosPlanilha.linhas.filter(l => l.competencia.endsWith('/' + ano));
    if (!linhas.length) return false;
    const thead = document.querySelector('#panel-dados .table-dados-planilha thead');
    if (thead) thead.innerHTML = `<tr><th>Competência</th><th>Entradas</th><th>Saídas</th><th>Total de Clientes</th><th>Churn</th><th>Churn médio</th><th>LTV/meses</th></tr>`;
    const num = (t) => { const n = Number(String(t).replace(/\./g, '').replace(',', '.').replace('%', '')); return isNaN(n) ? 0 : n; };
    const negativo = (t) => num(t) < 0;
    document.getElementById('tabela-dados-tbody').innerHTML = linhas.map(r => `
        <tr>
            <td style="font-weight: 700; color: var(--lift-blue);">${escHtml(r.competencia)}</td>
            <td style="font-weight: 600; color: #047857;">${escHtml(r.entradas)}</td>
            <td style="font-weight: 600; color: ${negativo(r.saidas) ? '#DC2626' : 'inherit'};">${escHtml(r.saidas)}</td>
            <td style="font-weight: 700; color: var(--lift-blue);">${escHtml(r.total)}</td>
            <td class="${negativo(r.churn) ? 'churn-negative' : 'churn-neutral'}">${escHtml(r.churn)}</td>
            <td class="${negativo(r.churnMedio) ? 'churn-negative' : 'churn-neutral'}">${escHtml(r.churnMedio)}</td>
            <td style="font-weight: 600;">${escHtml(r.ltv)}</td>
        </tr>`).join('');
    const ent = linhas.reduce((s, r) => s + num(r.entradas), 0);
    const sai = linhas.reduce((s, r) => s + Math.abs(num(r.saidas)), 0);
    const tfoot = document.getElementById('tabela-dados-tfoot');
    if (tfoot) tfoot.innerHTML = `
        <tr class="total-row">
            <td>TOTAL ANUAL / SALDO</td>
            <td style="color: #047857;">+${ent} Entradas</td>
            <td style="color: #DC2626;">-${sai} Saídas</td>
            <td></td>
            <td colspan="3" style="text-align: right; color: var(--lift-blue);">
                Saldo Líquido: <strong>${ent - sai >= 0 ? '+' : ''}${ent - sai} clientes</strong>
            </td>
        </tr>`;
    return true;
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && AppState.currentView === 'dados') dpBuscar(); });
