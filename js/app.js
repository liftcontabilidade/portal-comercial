/**
 * app.js - Aplicação Principal do Portal Comercial LIFT
 * Gerenciamento de Estado Reativo, Cálculos Automáticos de Métricas e Interações de UI
 */

// Estado Global da Aplicação
const AppState = {
    clientes: [],
    saidas: [],
    oportunidadesLeads: {},
    currentView: 'overview',
    selectedYearClientes: 2026,
    activeClientesTab: 'fechados', // 'fechados' ou 'saidas'
    selectedYearDados: 2026,
    selectedYearOportunidades: 2026,
    selectedMonthOverview: '11/2026',
    searchQueryClientes: '',
    searchQuerySaidas: '',
    filterSegmento: '',
    filterOrigem: '', // '' = todas, '__vazio__' = sem origem informada
    filterMesClientes: '', // '' = todos os meses, '01'..'12' = mês específico
    metaFechamentoMes: 10 // Padrão: 100% = 10 clientes fechados no mês
};

// Inicialização da Aplicação
document.addEventListener('DOMContentLoaded', () => {
    initStorage();
    setupNavigation();
    setupEventListeners();
    setupModals();
    setupGoogleSheetsSync();
    renderAll();

    // Redimensionamento de janela atualiza os gráficos Canvas
    // Se os dados forem alterados em outra aba do portal, atualiza tudo aqui também
    window.addEventListener('storage', (ev) => {
        if (ev.key && ev.key.startsWith('lift_comercial_2026_oficial_')) {
            initStorage(null);
            renderAll();
        }
    });

    // Ao voltar para esta aba, recarrega os dados salvos (outra aba pode ter alterado)
    const recarregarSeMudou = () => {
        if (document.visibilityState !== 'visible') return;
        if (lerAssinaturaStorage() !== AppState._assinaturaStorage) {
            initStorage(null);
            renderAll();
        }
    };
    document.addEventListener('visibilitychange', recarregarSeMudou);
    window.addEventListener('focus', recarregarSeMudou);

    window.addEventListener('resize', debounce(() => {
        if (AppState.currentView === 'overview') {
            renderOverviewGauge();
        } else if (AppState.currentView === 'dashboard') {
            renderDashboardChart();
        }
    }, 150));
});

/**
 * Inicializa os dados a partir do LocalStorage ou carrega o Seed Padrão (data.js)
 */
function initStorage(motivoBackup = 'Ao abrir o portal') {
    carregarMetas();
    carregarTrafego();
    const STORAGE_KEY_CLIENTES = 'lift_comercial_2026_oficial_clientes';
    const STORAGE_KEY_SAIDAS = 'lift_comercial_2026_oficial_saidas';
    const STORAGE_KEY_LEADS = 'lift_comercial_2026_oficial_leads';

    const savedClientes = localStorage.getItem(STORAGE_KEY_CLIENTES);
    const savedSaidas = localStorage.getItem(STORAGE_KEY_SAIDAS);
    const savedLeads = localStorage.getItem(STORAGE_KEY_LEADS);

    if (savedClientes) {
        try {
            AppState.clientes = JSON.parse(savedClientes);
        } catch (e) {
            AppState.clientes = [...DEFAULT_CLIENTES];
        }
    } else {
        AppState.clientes = [...DEFAULT_CLIENTES];
        saveStorage();
    }

    if (savedSaidas) {
        try {
            AppState.saidas = JSON.parse(savedSaidas);
        } catch (e) {
            AppState.saidas = [...DEFAULT_SAIDAS];
        }
    } else {
        AppState.saidas = [...DEFAULT_SAIDAS];
        saveStorage();
    }

    if (savedLeads) {
        try {
            AppState.oportunidadesLeads = JSON.parse(savedLeads);
        } catch (e) {
            AppState.oportunidadesLeads = JSON.parse(JSON.stringify(DEFAULT_OPORTUNIDADES_ANO));
        }
    } else {
        AppState.oportunidadesLeads = JSON.parse(JSON.stringify(DEFAULT_OPORTUNIDADES_ANO));
        saveStorage();
    }

    AppState._assinaturaStorage = lerAssinaturaStorage();
    if (motivoBackup) criarBackupAutomatico(true, motivoBackup);
}

function saveStorage() {
    // Proteção: se outra aba gravou dados diferentes desde a última leitura desta aba,
    // guarda uma cópia do que estava salvo antes de sobrescrever.
    if (AppState._assinaturaStorage && lerAssinaturaStorage() !== AppState._assinaturaStorage) {
        criarBackupAutomatico(true, 'Antes de gravar de outra aba');
    }
    localStorage.setItem('lift_comercial_2026_oficial_clientes', JSON.stringify(AppState.clientes));
    localStorage.setItem('lift_comercial_2026_oficial_saidas', JSON.stringify(AppState.saidas));
    localStorage.setItem('lift_comercial_2026_oficial_leads', JSON.stringify(AppState.oportunidadesLeads));
    AppState._assinaturaStorage = lerAssinaturaStorage();
    criarBackupAutomatico(false);
    // Banco de dados (Firebase): grava só o que mudou
    if (window.LiftCloud && window.LiftCloud.ativo()) {
        window.LiftCloud.salvar({
            clientes: AppState.clientes,
            saidas: AppState.saidas,
            leads: AppState.oportunidadesLeads,
            segmentos: getSegmentosSalvos(),
            metas: AppState.metas,
            trafego: AppState.trafego
        });
    }
    syncToGoogleSheets(); // Sincronização automática com a planilha do Google
}

/* ---------- Ponte com o Firebase (js/firebase-sync.js) ---------- */
// Dados que estão salvos neste computador (usados na primeira migração para o banco)
window.lerDadosLocais = function () {
    const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch (e) { return padrao; } };
    return {
        clientes: ler('lift_comercial_2026_oficial_clientes', []),
        saidas: ler('lift_comercial_2026_oficial_saidas', []),
        leads: ler('lift_comercial_2026_oficial_leads', {}),
        segmentos: ler(STORAGE_KEY_SEGMENTOS, []),
        metas: ler(STORAGE_KEY_METAS, null),
        trafego: ler(STORAGE_KEY_TRAFEGO, [])
    };
};

// Recebe os dados do banco (na abertura e sempre que alguém altera algo)
let _renderNuvemPendente = null;
window.aplicarDadosDaNuvem = function ({ clientes, saidas, leads }) {
    const novoCli = JSON.stringify(clientes);
    const novaSai = JSON.stringify(saidas);
    const novosLeads = leads ? JSON.stringify(leads) : null;
    const mudou = novoCli !== JSON.stringify(AppState.clientes)
        || novaSai !== JSON.stringify(AppState.saidas)
        || (novosLeads && novosLeads !== JSON.stringify(AppState.oportunidadesLeads));
    if (!mudou) return;

    AppState.clientes = clientes;
    AppState.saidas = saidas;
    if (leads) AppState.oportunidadesLeads = leads;
    // Mantém uma cópia neste computador (funciona offline e alimenta os backups)
    try {
        localStorage.setItem('lift_comercial_2026_oficial_clientes', novoCli);
        localStorage.setItem('lift_comercial_2026_oficial_saidas', novaSai);
        localStorage.setItem('lift_comercial_2026_oficial_leads', JSON.stringify(AppState.oportunidadesLeads));
    } catch (e) { /* ignora */ }
    AppState._assinaturaStorage = lerAssinaturaStorage();
    criarBackupAutomatico(false);

    // Não redesenha enquanto alguém digita num campo (ex.: leads); redesenha ao sair dele
    clearTimeout(_renderNuvemPendente);
    const redesenhar = () => {
        const ativoEl = document.activeElement;
        if (ativoEl && ativoEl.matches && ativoEl.matches('input, textarea, select') && document.querySelector('.modal-backdrop.active, #opp-rows :focus')) {
            _renderNuvemPendente = setTimeout(redesenhar, 800);
            return;
        }
        renderAll();
    };
    _renderNuvemPendente = setTimeout(redesenhar, 50);
};

window.aplicarSegmentosDaNuvem = function (lista) {
    try { localStorage.setItem(STORAGE_KEY_SEGMENTOS, JSON.stringify(lista || [])); } catch (e) { /* ignora */ }
};

/* ---------- Backups automáticos (ficam no próprio navegador) ---------- */
const STORAGE_KEY_BACKUPS = 'lift_comercial_backups';
const MAX_BACKUPS = 30;

function lerAssinaturaStorage() {
    try {
        return [
            localStorage.getItem('lift_comercial_2026_oficial_clientes') || '',
            localStorage.getItem('lift_comercial_2026_oficial_saidas') || '',
            localStorage.getItem('lift_comercial_2026_oficial_leads') || '',
            localStorage.getItem('lift_comercial_2026_oficial_trafego') || ''
        ].join('|');
    } catch (e) { return ''; }
}

function getBackups() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_BACKUPS)) || []; } catch (e) { return []; }
}

// Guarda uma cópia dos dados salvos, só se algo mudou desde a última cópia.
function criarBackupAutomatico(forcar = false, motivo = 'Automático') {
    try {
        const dados = {
            clientes: localStorage.getItem('lift_comercial_2026_oficial_clientes'),
            saidas: localStorage.getItem('lift_comercial_2026_oficial_saidas'),
            leads: localStorage.getItem('lift_comercial_2026_oficial_leads'),
            trafego: localStorage.getItem('lift_comercial_2026_oficial_trafego')
        };
        if (!dados.clientes) return;
        const assinatura = [dados.clientes, dados.saidas, dados.leads, dados.trafego || ''].join('|');
        const lista = getBackups();
        const ultimo = lista[0];
        if (ultimo && ultimo.assinatura === assinatura) return;
        // Sem "forcar": no máximo uma cópia a cada 20 minutos (mantém a mais antiga do período)
        if (!forcar && ultimo && (Date.now() - ultimo.ts) < 20 * 60 * 1000) return;
        const cli = JSON.parse(dados.clientes || '[]');
        const sai = JSON.parse(dados.saidas || '[]');
        lista.unshift({ ts: Date.now(), motivo, assinatura, qtdClientes: cli.length, qtdSaidas: sai.length, ...dados });
        localStorage.setItem(STORAGE_KEY_BACKUPS, JSON.stringify(lista.slice(0, MAX_BACKUPS)));
    } catch (e) { /* sem espaço ou bloqueado: ignora */ }
}

/* ---------- Arquivo de dados (exportar / importar) ---------- */
function exportarDados() {
    const dados = {
        app: 'portal-comercial-lift',
        versao: 1,
        geradoEm: new Date().toISOString(),
        clientes: AppState.clientes,
        saidas: AppState.saidas,
        leads: AppState.oportunidadesLeads,
        segmentos: getSegmentosSalvos(),
        metas: AppState.metas,
        trafego: AppState.trafego || []
    };
    const hoje = new Date().toISOString().slice(0, 10);
    baixarArquivo(JSON.stringify(dados, null, 2), `portal-comercial-dados-${hoje}.json`, 'application/json');
    showToast(`Arquivo baixado: ${dados.clientes.length} clientes e ${dados.saidas.length} saídas.`);
}

// Importação que só ACRESCENTA clientes (não apaga nem altera os existentes).
// Ignora quem já está no portal (mesmo id, mesmo CNPJ/CPF ou mesmo nome).
function importarAdicionando(dados) {
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const ids = new Set(AppState.clientes.map(c => String(c.id)));
    const docs = new Set(AppState.clientes.map(c => String(c.inscricao || '').replace(/\D/g, '')).filter(Boolean));
    const nomes = new Set(AppState.clientes.map(c => norm(c.nome)));
    const novos = (dados.clientes || []).filter(c => {
        const doc = String(c.inscricao || '').replace(/\D/g, '');
        return !ids.has(String(c.id)) && !(doc && docs.has(doc)) && !nomes.has(norm(c.nome));
    });
    const repetidos = (dados.clientes || []).length - novos.length;
    if (!novos.length) {
        alert(`Nenhum cliente novo para adicionar: os ${dados.clientes.length} do arquivo já estão no portal.`);
        return;
    }
    const titulo = dados.descricao || 'clientes';
    if (!confirm(`Adicionar ${novos.length} clientes ao portal (${titulo})?${repetidos ? `\n\n${repetidos} já estavam cadastrados e serão ignorados.` : ''}\n\nNada do que já existe será apagado ou alterado.`)) return;
    criarBackupAutomatico(true, 'Antes de adicionar clientes');
    AppState.clientes = AppState.clientes.concat(novos);
    saveStorage();
    renderAll();
    document.getElementById('modal-backups').classList.remove('active');
    showToast(`${novos.length} clientes adicionados ao portal!`);
}

function importarDados(arquivo) {
    const leitor = new FileReader();
    leitor.onload = () => {
        let dados;
        try { dados = JSON.parse(leitor.result); } catch (e) { alert('Arquivo inválido: não é um arquivo de dados do portal.'); return; }
        if (!dados || !Array.isArray(dados.clientes) || !Array.isArray(dados.saidas)) {
            alert('Arquivo inválido: não é um arquivo de dados do portal.');
            return;
        }
        if (dados.modo === 'adicionar') { importarAdicionando(dados); return; }
        const quando = dados.geradoEm ? new Date(dados.geradoEm).toLocaleString('pt-BR') : 'data desconhecida';
        if (!confirm(`Importar este arquivo (gerado em ${quando})?\n\n• ${dados.clientes.length} clientes\n• ${dados.saidas.length} saídas\n\nOs dados atuais do portal serão substituídos (uma cópia deles fica guardada antes).`)) return;
        criarBackupAutomatico(true, 'Antes de importar arquivo');
        AppState.clientes = dados.clientes;
        AppState.saidas = dados.saidas;
        if (dados.leads) AppState.oportunidadesLeads = dados.leads;
        if (Array.isArray(dados.trafego)) { AppState.trafego = dados.trafego; salvarTrafegoLocal(); }
        if (dados.metas && dados.metas.porAno) { AppState.metas = dados.metas; try { localStorage.setItem(STORAGE_KEY_METAS, JSON.stringify(dados.metas)); } catch (e) { /* ignora */ } }
        if (Array.isArray(dados.segmentos)) {
            try { localStorage.setItem(STORAGE_KEY_SEGMENTOS, JSON.stringify(dados.segmentos)); } catch (e) { /* ignora */ }
        }
        saveStorage(); // grava neste navegador e, se estiver conectado, no banco de dados
        renderAll();
        document.getElementById('modal-backups').classList.remove('active');
        showToast('Dados importados com sucesso!');
    };
    leitor.readAsText(arquivo);
}
// (abrirBackups é global: o firebase-sync.js chama window.abrirBackups)

function abrirBackups() {
    const lista = getBackups();
    const box = document.getElementById('backup-lista');
    if (box) {
        box.innerHTML = lista.length ? lista.map((b, i) => {
            const d = new Date(b.ts);
            const quando = d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="bk-item">
                    <div class="bk-info">
                        <strong>${quando}</strong>
                        <span>${b.qtdClientes} clientes · ${b.qtdSaidas} saídas${b.motivo && b.motivo !== 'Automático' ? ' · ' + b.motivo : ''}</span>
                    </div>
                    <div class="bk-actions">
                        <button type="button" class="btn-secondary bk-ver" data-i="${i}">Ver clientes</button>
                        <button type="button" class="btn-lift-action bk-restaurar" data-i="${i}">Restaurar</button>
                    </div>
                    <div class="bk-detalhe" id="bk-detalhe-${i}"></div>
                </div>`;
        }).join('') : '<div class="home-empty">Ainda não há cópias. Elas são criadas automaticamente enquanto você usa o portal.</div>';

        box.querySelectorAll('.bk-ver').forEach(btn => btn.onclick = () => {
            const b = lista[+btn.dataset.i];
            const det = document.getElementById(`bk-detalhe-${btn.dataset.i}`);
            if (det.innerHTML) { det.innerHTML = ''; return; }
            const cli = JSON.parse(b.clientes || '[]').slice().sort((x, y) => String(y.dataEntrada).localeCompare(String(x.dataEntrada)));
            det.innerHTML = '<div class="bk-cli">' + cli.slice(0, 15).map(c => `<span>${c.mesEntrada} · ${c.nome}</span>`).join('') + (cli.length > 15 ? `<span>… e mais ${cli.length - 15}</span>` : '') + '</div>';
        });
        box.querySelectorAll('.bk-restaurar').forEach(btn => btn.onclick = () => {
            const b = lista[+btn.dataset.i];
            if (!confirm('Restaurar esta cópia? Os dados atuais serão substituídos (uma cópia deles fica guardada antes).')) return;
            criarBackupAutomatico(true, 'Antes de restaurar');
            localStorage.setItem('lift_comercial_2026_oficial_clientes', b.clientes);
            localStorage.setItem('lift_comercial_2026_oficial_saidas', b.saidas);
            if (b.leads) localStorage.setItem('lift_comercial_2026_oficial_leads', b.leads);
            if (b.trafego) localStorage.setItem('lift_comercial_2026_oficial_trafego', b.trafego);
            initStorage(null);
            saveStorage();
            renderAll();
            document.getElementById('modal-backups').classList.remove('active');
            showToast('Cópia restaurada com sucesso!');
        });
    }
    document.getElementById('modal-backups').classList.add('active');
}

/**
 * Configuração das Abas Laterais e Navegação
 */
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = item.getAttribute('data-view');
            switchView(targetView);
        });
    });

    // Sub-abas de Clientes: Fechados vs Saídas
    const subTabBtns = document.querySelectorAll('.sub-tab-btn[data-subtab]');
    subTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            subTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.activeClientesTab = btn.getAttribute('data-subtab');
            renderClientesView();
        });
    });
}

/**
 * Alterna a visualização ativa na tela
 */
function switchView(viewName) {
    AppState.currentView = viewName;

    // Atualiza classes ativas na Sidebar
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        if (item.getAttribute('data-view') === viewName) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Exibe o painel correspondente
    document.querySelectorAll('.view-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    const targetPanel = document.getElementById(`panel-${viewName}`);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }

    // Renderiza a tela específica
    if (viewName === 'overview') {
        renderOverview();
        const hc = document.getElementById('homeCanvas');
        if (hc && hc._liftMonthly) LiftCharts.renderMonthlyChart('homeCanvas', hc._liftMonthly.serie, hc._liftMonthly.options);
    } else if (viewName === 'clientes') {
        renderClientesView();
    } else if (viewName === 'dados') {
        renderDadosView();
    } else if (viewName === 'dashboard') {
        renderDashboardView();
    } else if (viewName === 'oportunidades') {
        renderOportunidadesView();
    } else if (viewName === 'receita') {
        renderReceitaView();
    } else if (viewName === 'churn') {
        renderChurnView();
    } else if (viewName === 'origens') {
        renderOrigensView();
    } else if (viewName === 'vendedores') {
        renderVendedoresView();
    } else if (viewName === 'metas') {
        renderMetasView();
    } else if (viewName === 'trafego') {
        renderTrafegoView();
    }
}

/**
 * Renderiza tudo (chamado após adições, edições ou deleções)
 */
function renderAll() {
    renderOverview();
    renderClientesView();
    renderDadosView();
    renderDashboardView();
    renderOportunidadesView();
    renderReceitaView();
    renderChurnView();
    renderOrigensView();
    if (typeof renderVendedoresView === 'function') renderVendedoresView();
    renderMetasView();
    if (typeof renderTrafegoView === 'function') renderTrafegoView();
}

/* ==========================================================================
   1. PÁGINA PRINCIPAL: VISÃO GERAL (INSPIRADA NA IMAGEM 1)
   ========================================================================== */

const MONTH_NAMES_BR = {
    '01': { short: 'JAN', full: 'Janeiro' },
    '02': { short: 'FEV', full: 'Fevereiro' },
    '03': { short: 'MAR', full: 'Março' },
    '04': { short: 'ABR', full: 'Abril' },
    '05': { short: 'MAI', full: 'Maio' },
    '06': { short: 'JUN', full: 'Junho' },
    '07': { short: 'JUL', full: 'Julho' },
    '08': { short: 'AGO', full: 'Agosto' },
    '09': { short: 'SET', full: 'Setembro' },
    '10': { short: 'OUT', full: 'Outubro' },
    '11': { short: 'NOV', full: 'Novembro' },
    '12': { short: 'DEZ', full: 'Dezembro' }
};

// Ordem fixa dos meses (as chaves '10', '11', '12' não podem vir antes de '01')
const MESES_ORDEM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function getMonthLabel(mesAno) {
    if (!mesAno) return '';
    const [mes, ano] = mesAno.split('/');
    const m = MONTH_NAMES_BR[mes];
    return `${m ? m.short : mes}/${ano}`;
}

function getMonthNameFull(mesAno) {
    if (!mesAno) return '';
    const [mes, ano] = mesAno.split('/');
    const m = MONTH_NAMES_BR[mes];
    return `${m ? m.full : mes} de ${ano}`;
}

function navigateMonth(direction) {
    const [mesStr, anoStr] = AppState.selectedMonthOverview.split('/');
    let mes = parseInt(mesStr, 10);
    let ano = parseInt(anoStr, 10);

    mes += direction;
    if (mes < 1) {
        mes = 12;
        ano -= 1;
    } else if (mes > 12) {
        mes = 1;
        ano += 1;
    }

    AppState.selectedMonthOverview = `${String(mes).padStart(2, '0')}/${ano}`;
    renderOverview();
}

function renderOverview() {
    const mesAtual = AppState.selectedMonthOverview; // ex: '01/2026', '06/2026', '11/2026'
    
    const [mesSel, anoSel] = mesAtual.split('/');
    const anoNum = parseInt(anoSel, 10);
    const fechAno = getFechamentosDoAno(anoNum);
    const fechadosNoMes = fechAno[mesSel] || 0;
    const meta = getMetaClientesMes(anoNum);
    const restantes = Math.max(0, meta - fechadosNoMes);
    const percentMeta = Math.round((fechadosNoMes / meta) * 100);

    // Nome do mês exibido entre as setas
    const elMesLabel = document.getElementById('perf-month-label');
    if (elMesLabel) elMesLabel.textContent = `${MONTH_NAMES_BR[mesSel].full} ${anoNum}`;

    // (seletor antigo, se existir)
    const selectMonth = document.getElementById('select-overview-month');
    if (selectMonth) {
        selectMonth.innerHTML = MESES_ORDEM.map(m => {
            const v = `${m}/${anoNum}`;
            return `<option value="${v}" ${v === mesAtual ? 'selected' : ''}>${MONTH_NAMES_BR[m].full} ${anoNum}</option>`;
        }).join('');
    }

    // Números principais
    const setTxt = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    setTxt('metric-fechados-count', fechadosNoMes);
    setTxt('perf-meta-mes', meta);
    setTxt('perf-meta-texto', `${meta} novos clientes`);
    setTxt('metric-restantes-count', restantes);

    const elPct = document.getElementById('gauge-percent-display');
    if (elPct) {
        elPct.textContent = fechadosNoMes >= meta ? `Meta batida · ${percentMeta}%` : `${percentMeta}% da meta`;
        elPct.classList.toggle('done', fechadosNoMes >= meta);
    }

    // Comparativos: mês anterior e média do ano (meses até o selecionado)
    const idxMes = parseInt(mesSel, 10);
    let mesAnteriorQtd;
    if (idxMes > 1) mesAnteriorQtd = fechAno[String(idxMes - 1).padStart(2, '0')] || 0;
    else mesAnteriorQtd = (getFechamentosDoAno(anoNum - 1)['12']) || 0;
    const mesesAteAgora = MESES_ORDEM.filter(m => parseInt(m, 10) <= idxMes);
    const somaAno = mesesAteAgora.reduce((acc, m) => acc + (fechAno[m] || 0), 0);
    setTxt('perf-mes-anterior', mesAnteriorQtd);
    setTxt('perf-media-ano', (somaAno / mesesAteAgora.length).toFixed(1).replace('.', ','));

    // Projeção do mês (ritmo até hoje)
    const proj = calcularProjecaoMes(mesAtual, fechadosNoMes, meta);
    setTxt('perf-proj-label', proj.label);
    setTxt('perf-proj-value', proj.valor);
    setTxt('perf-proj-note', proj.nota);
    const elProj = document.getElementById('perf-proj-value');
    if (elProj) elProj.className = `perf-stat-value ${proj.classe || ''}`;

    // Blocos da meta (1 bloco por cliente da meta)
    renderOverviewGauge(fechadosNoMes, meta);

    // Card 1: Progresso Atual — prévia da aba Oportunidades (mesmos números e cálculo)
    const [mesStr, anoStr] = mesAtual.split('/');
    const oppMes = calcularOportunidades(parseInt(anoStr, 10)).linhas.find(l => l.key === mesStr)
        || { leads: 0, fechamentos: 0, conv: null };

    const leadsDoMes = oppMes.leads;
    const ganhos = oppMes.fechamentos;
    const perdas = Math.max(0, leadsDoMes - ganhos);
    const taxaConversao = oppMes.conv === null ? '—' : formatPct(oppMes.conv);

    const elGeradas = document.getElementById('kpi-oportunidades-geradas');
    const elGanhos = document.getElementById('kpi-ganhos');
    const elPercas = document.getElementById('kpi-percas');
    const elConversao = document.getElementById('kpi-taxa-conversao');

    if (elGeradas) elGeradas.textContent = `${leadsDoMes}`;
    if (elGanhos) elGanhos.textContent = `${ganhos}`;
    if (elPercas) elPercas.textContent = `${perdas}`;
    if (elConversao) elConversao.textContent = `${taxaConversao}`;

    // Card 3: Visão da Carteira
    // Total da carteira = mesmo "Total de Clientes" da aba Dados no mês selecionado
    // (base anterior + entradas - saídas, acumulado mês a mês)
    const linhaDados = calculateMonthlyDataForYear(parseInt(anoStr, 10)).rows.find(r => r.competencia === mesAtual);
    const totalAtivos = linhaDados ? linhaDados.totalClientes : AppState.clientes.filter(c => c.status !== 'Cancelado').length;
    const aguardandoAssinatura = AppState.clientes.filter(c => c.assinado === 'Não' && c.status !== 'Cancelado').length;
    
    const elTotalAtivos = document.getElementById('pipe-total-ativos');
    const elAguardandoAssinatura = document.getElementById('pipe-aguardando-assinatura');

    if (elTotalAtivos) elTotalAtivos.textContent = `${totalAtivos}`;
    if (elAguardandoAssinatura) elAguardandoAssinatura.textContent = `${aguardandoAssinatura}`;

    // Tabela dos clientes fechados no mês selecionado
    renderOverviewMonthClients(mesAtual);

    // Blocos do resumo (KPIs, funil, últimos 6 meses, segmentos)
    renderHomeResumo(mesAtual);
}

/* ---------- Página inicial: resumo do mês ---------- */
function formatMoneyCurto(v) {
    return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
}

function deltaHtml(diff, sufixo, inverter = false) {
    if (diff === 0) return `<span class="flat">= ${sufixo}</span>`;
    const bom = inverter ? diff < 0 : diff > 0;
    return `<span class="${bom ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toLocaleString('pt-BR')}</span> ${sufixo}`;
}

function renderHomeResumo(mesAtual) {
    const [mm, aaaa] = mesAtual.split('/');
    const ano = parseInt(aaaa, 10);
    const idx = ano * 12 + parseInt(mm, 10) - 1;
    const anterior = indexToMesAno(idx - 1);
    const [mmAnt, aaaaAnt] = anterior.split('/');
    const nomeMes = MONTH_NAMES_BR[mm].full;
    const nomeAnt = MONTH_NAMES_BR[mmAnt].full.toLowerCase();
    const set = (id, v, html = false) => { const el = document.getElementById(id); if (el) el[html ? 'innerHTML' : 'textContent'] = v; };

    set('home-month-title', `${nomeMes} ${ano}`);

    // Série única (mesma do Dashboard)
    const serie = getDashboardMonthlySeries();
    const ponto = (m) => serie.find(d => d.mesAno === m) || { entradas: (getFechamentosDoAno(parseInt(m.split('/')[1], 10))[m.split('/')[0]] || 0), saidas: AppState.saidas.filter(s => getMesSaida(s) === m).length };
    const atual = ponto(mesAtual);
    const prev = ponto(anterior);

    // 1) Clientes fechados
    set('home-kpi-fechados', atual.entradas);
    set('home-kpi-fechados-delta', deltaHtml(atual.entradas - prev.entradas, `vs. ${nomeAnt}`), true);

    // 2) Receita nova (soma das mensalidades dos clientes cadastrados no mês)
    const receitaDe = (m) => AppState.clientes.filter(c => getMesCliente(c) === m).reduce((acc, c) => acc + (Number(c.valorMensal) || 0), 0);
    const temCadastro = ano >= ANO_INICIO_CADASTRO_PORTAL;
    if (temCadastro) {
        const rec = receitaDe(mesAtual), recAnt = receitaDe(anterior);
        const qtd = AppState.clientes.filter(c => getMesCliente(c) === mesAtual).length;
        set('home-kpi-receita', formatMoneyCurto(rec));
        const metaRec = getMetaReceitaMes(ano);
        set('home-kpi-receita-delta', (metaRec ? `<span class="${rec >= metaRec ? 'up' : 'down'}">${Math.round((rec / metaRec) * 100)}% da meta</span> (${formatMoneyCurto(metaRec)}) · ` : '')
            + (qtd ? `ticket médio ${formatMoneyCurto(rec / qtd)}` : `${nomeAnt}: ${formatMoneyCurto(recAnt)}`), true);
    } else {
        set('home-kpi-receita', '—');
        set('home-kpi-receita-delta', 'sem cadastros neste ano');
    }

    // 3) Saídas / churn
    set('home-kpi-saidas', atual.saidas);
    const linhas = temCadastro ? calculateMonthlyDataForYear(ano).rows : [];
    const linha = linhas.find(r => r.competencia === mesAtual);
    const metaChurn = getMetaChurnMes(ano);
    const dentroMeta = atual.saidas <= metaChurn;
    set('home-kpi-saidas-delta',
        `${linha && linha.churn ? 'churn ' + String(linha.churn).replace('-', '') + ' · ' : ''}<span class="${dentroMeta ? 'up' : 'down'}">${dentroMeta ? 'dentro da meta' : 'acima da meta'} (até ${metaChurn})</span>`, true);

    // 4) Carteira total (mesmo "Total de Clientes" da aba Dados)
    if (temCadastro && linha) {
        set('pipe-total-ativos', linha.totalClientes);
        set('home-kpi-carteira-delta', deltaHtml(atual.entradas - atual.saidas, 'no mês'), true);
    } else {
        set('pipe-total-ativos', '—');
        set('home-kpi-carteira-delta', 'sem cadastros neste ano');
    }

    // Funil: conversão do ano
    const opp = calcularOportunidades(ano);
    set('home-conv-ano', opp.convGeral === null ? '—' : formatPct(opp.convGeral));

    // Mini gráfico: 6 meses terminando no mês selecionado
    const seis = [];
    for (let i = idx - 5; i <= idx; i++) {
        const m = indexToMesAno(i);
        const [m1, a1] = m.split('/');
        const p = ponto(m);
        seis.push({
            mesAno: m,
            label: `${MONTH_NAMES_BR[m1].full.slice(0, 3)}/${a1.slice(2)}`,
            labelLongo: `${MONTH_NAMES_BR[m1].full.slice(0, 3)}/${a1}`,
            entradas: p.entradas, saidas: p.saidas,
            metaClientes: getMetaClientesMes(parseInt(a1, 10)),
            metaChurn: getMetaChurnMes(parseInt(a1, 10))
        });
    }
    if (AppState.currentView === 'overview' || !document.getElementById('homeCanvas')._liftMonthly) {
        LiftCharts.renderMonthlyChart('homeCanvas', seis, { tooltipId: 'homeTooltip', compact: true, onBarClick: abrirClientesDoMes });
    } else {
        document.getElementById('homeCanvas')._liftMonthly.serie = seis;
    }

    // Segmentos do mês
    const porSeg = {};
    AppState.clientes.filter(c => getMesCliente(c) === mesAtual).forEach(c => {
        const k = c.segmento || 'Sem segmento';
        porSeg[k] = (porSeg[k] || 0) + 1;
    });
    const lista = Object.entries(porSeg).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).slice(0, 6);
    const max = lista.length ? lista[0][1] : 1;
    set('home-seg-sub', `${atual.entradas} ${atual.entradas === 1 ? 'cliente fechado' : 'clientes fechados'}`);
    set('home-segs', lista.length
        ? lista.map(([nome, q]) => `
            <div class="home-seg">
                <span class="home-seg-name">${nome}</span>
                <span class="home-seg-bar"><i style="width:${(q / max) * 100}%"></i></span>
                <span class="home-seg-qtd">${q}</span>
            </div>`).join('')
        : `<div class="home-empty">Nenhum cliente fechado em ${nomeMes.toLowerCase()}.</div>`, true);
}

/* ---------- Projeção do mês: fechados ÷ dias passados × dias do mês ---------- */
function calcularProjecaoMes(mesAno, fechados, meta) {
    const [m, a] = mesAno.split('/').map(Number);
    const hoje = new Date();
    const idxSel = a * 12 + m - 1;
    const idxHoje = hoje.getFullYear() * 12 + hoje.getMonth();
    if (idxSel < idxHoje) {
        return { label: 'Resultado do mês', valor: `${fechados} de ${meta}`, nota: fechados >= meta ? 'meta batida' : `faltaram ${meta - fechados}`, classe: fechados >= meta ? '' : 'orange' };
    }
    if (idxSel > idxHoje) {
        return { label: 'Projeção do mês', valor: '—', nota: 'mês ainda não começou' };
    }
    const diasNoMes = new Date(a, m, 0).getDate();
    const diasPassados = hoje.getDate();
    const projecao = Math.round((fechados / diasPassados) * diasNoMes);
    const valor = Math.max(projecao, fechados);
    return {
        label: 'Projeção do mês',
        valor: `≈ ${valor} de ${meta}`,
        nota: `no ritmo de ${diasPassados} de ${diasNoMes} dias`,
        classe: valor >= meta ? '' : 'orange',
        projecao: valor, diasPassados, diasNoMes
    };
}

/* ---------- Relatório do mês (PDF e Excel) ---------- */
function getResumoMes(mesAno) {
    const [mm, aaaa] = mesAno.split('/');
    const ano = parseInt(aaaa, 10);
    const idx = ano * 12 + parseInt(mm, 10) - 1;
    const anterior = indexToMesAno(idx - 1);
    const fech = getFechamentosDoAno(ano)[mm] || 0;
    const fechAnt = getFechamentosDoAno(parseInt(anterior.split('/')[1], 10))[anterior.split('/')[0]] || 0;
    const meta = getMetaClientesMes(parseInt(aaaa, 10));
    const contratos = AppState.clientes.filter(c => getMesCliente(c) === mesAno)
        .sort((x, y) => String(x.dataEntrada).localeCompare(String(y.dataEntrada)));
    const saidas = AppState.saidas.filter(s => getMesSaida(s) === mesAno)
        .sort((x, y) => String(x.dataSaida).localeCompare(String(y.dataSaida)));
    const receita = contratos.reduce((acc, c) => acc + (Number(c.valorMensal) || 0), 0);
    const linhaDados = ano >= ANO_INICIO_CADASTRO_PORTAL ? calculateMonthlyDataForYear(ano).rows.find(r => r.competencia === mesAno) : null;
    const opp = calcularOportunidades(ano).linhas.find(l => l.key === mm) || { leads: 0, fechamentos: 0, conv: null };
    const segs = {};
    contratos.forEach(c => { const k = c.segmento || 'Sem segmento'; segs[k] = (segs[k] || 0) + 1; });
    const perdida = saidas.reduce((acc, s) => acc + (getValorSaida(s) || 0), 0);
    return {
        mesAno, titulo: `${MONTH_NAMES_BR[mm].full} de ${aaaa}`,
        fechados: fech, fechadosAnterior: fechAnt, nomeAnterior: MONTH_NAMES_BR[anterior.split('/')[0]].full.toLowerCase(),
        meta, pctMeta: Math.round((fech / meta) * 100),
        projecao: calcularProjecaoMes(mesAno, fech, meta),
        receita, ticket: contratos.length ? receita / contratos.length : 0,
        saidas: saidas.length, churn: linhaDados ? String(linhaDados.churn).replace('-', '') : '—',
        carteira: linhaDados ? linhaDados.totalClientes : null,
        saldo: fech - saidas.length, receitaPerdida: perdida,
        leads: opp.leads, conversao: opp.conv === null ? '—' : formatPct(opp.conv),
        segmentos: Object.entries(segs).sort((a, b) => b[1] - a[1]),
        contratos, listaSaidas: saidas
    };
}

function abrirRelatorioMes() {
    const r = getResumoMes(AppState.selectedMonthOverview);
    document.getElementById('relatorio-titulo').textContent = `Relatório — ${r.titulo}`;
    document.getElementById('modal-relatorio').classList.add('active');
}

function escHtml(t) {
    return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function gerarRelatorioPDF() {
    const r = getResumoMes(AppState.selectedMonthOverview);
    const hoje = new Date().toLocaleDateString('pt-BR');
    const kpi = (label, valor, sub = '') => `<div class="k"><span>${label}</span><b>${valor}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório Comercial LIFT - ${escHtml(r.titulo)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1E293B; margin: 0; font-size: 12px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #F36F21; padding-bottom: 10px; margin-bottom: 16px; }
  header h1 { margin: 0; font-size: 22px; color: #0B2545; }
  header h1 span { color: #F36F21; }
  header p { margin: 2px 0 0; color: #64748B; }
  .brand { text-align: right; color: #0B2545; font-weight: 800; font-size: 14px; }
  .brand small { display: block; color: #64748B; font-weight: 500; font-size: 11px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .k { border: 1px solid #E2E8F0; border-top: 3px solid #0B2545; border-radius: 8px; padding: 10px; }
  .k span { display: block; color: #64748B; font-size: 10.5px; font-weight: 600; }
  .k b { display: block; font-size: 19px; color: #0B2545; margin-top: 2px; }
  .k small { color: #64748B; font-size: 10px; }
  h2 { font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: #F36F21; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; background: #0B2545; color: #fff; font-size: 10.5px; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #E2E8F0; }
  td.n, th.n { text-align: right; }
  .empty { color: #94A3B8; padding: 8px 0; }
  footer { margin-top: 20px; color: #94A3B8; font-size: 10px; text-align: center; }
</style></head><body>
<header>
  <div><h1>Relatório Comercial — <span>${escHtml(r.titulo)}</span></h1><p>Gerado em ${hoje}</p></div>
  <div class="brand">LIFT Contabilidade<small>Portal Comercial</small></div>
</header>
<div class="grid">
  ${kpi('Clientes fechados', `${r.fechados} / ${r.meta}`, `${r.pctMeta}% da meta · ${r.nomeAnterior}: ${r.fechadosAnterior}`)}
  ${kpi(r.projecao.label, r.projecao.valor, r.projecao.nota)}
  ${kpi('Receita nova', formatBRL(r.receita), r.contratos.length ? `ticket médio ${formatBRL(r.ticket)}` : '')}
  ${kpi('Saídas', r.saidas, `churn ${r.churn}`)}
  ${kpi('Carteira total', r.carteira ?? '—', `saldo do mês ${r.saldo >= 0 ? '+' : ''}${r.saldo}`)}
  ${kpi('Leads', r.leads)}
  ${kpi('Conversão', r.conversao)}
  ${kpi('Receita perdida', r.receitaPerdida ? formatBRL(r.receitaPerdida) : '—', 'mensalidades das saídas')}
</div>
<h2>Contratos fechados (${r.contratos.length})</h2>
${r.contratos.length ? `<table><thead><tr><th>Cliente</th><th>Segmento</th><th>Data</th><th>Assinado</th><th class="n">Mensalidade</th></tr></thead><tbody>
${r.contratos.map(c => `<tr><td>${escHtml(c.nome)}</td><td>${escHtml(c.segmento)}</td><td>${formatDateBR(c.dataEntrada)}</td><td>${c.assinado === 'Sim' ? 'Sim' : 'Pendente'}</td><td class="n">${formatBRL(c.valorMensal)}</td></tr>`).join('')}
<tr><td colspan="4"><b>Total</b></td><td class="n"><b>${formatBRL(r.receita)}</b></td></tr></tbody></table>` : '<div class="empty">Nenhum contrato fechado no mês.</div>'}
<h2>Saídas (${r.listaSaidas.length})</h2>
${r.listaSaidas.length ? `<table><thead><tr><th>Cliente</th><th>Data do aviso</th><th>Data da saída</th><th>Motivo</th></tr></thead><tbody>
${r.listaSaidas.map(s => `<tr><td>${escHtml(s.nome)}</td><td>${escHtml(s.dataAviso || '—')}</td><td>${formatDateBR(s.dataSaida)}</td><td>${escHtml(s.motivo)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhuma saída no mês.</div>'}
<h2>Segmentos</h2>
${r.segmentos.length ? `<table><thead><tr><th>Segmento</th><th class="n">Clientes</th></tr></thead><tbody>${r.segmentos.map(([n, q]) => `<tr><td>${escHtml(n)}</td><td class="n">${q}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Sem fechamentos no mês.</div>'}
<footer>Portal Comercial LIFT · ${escHtml(r.titulo)}</footer>
</body></html>`;

    let frame = document.getElementById('relatorio-print-frame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'relatorio-print-frame';
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const tituloOriginal = document.title;
    document.title = `Relatório Comercial LIFT - ${r.titulo}`;
    setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => { document.title = tituloOriginal; }, 1000);
    }, 300);
    document.getElementById('modal-relatorio').classList.remove('active');
}

function carregarSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        sc.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX indisponível'));
        sc.onerror = () => reject(new Error('Sem conexão para carregar o gerador de Excel'));
        document.head.appendChild(sc);
    });
}

function baixarArquivo(conteudo, nome, tipo) {
    const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

async function gerarRelatorioExcel() {
    const r = getResumoMes(AppState.selectedMonthOverview);
    const nomeArq = `Relatorio_Comercial_LIFT_${r.mesAno.replace('/', '-')}`;
    const resumo = [
        ['Relatório Comercial LIFT', r.titulo],
        [],
        ['Indicador', 'Valor', 'Observação'],
        ['Clientes fechados', r.fechados, `${r.pctMeta}% da meta de ${r.meta}`],
        [`Clientes fechados em ${r.nomeAnterior}`, r.fechadosAnterior, ''],
        [r.projecao.label, r.projecao.valor, r.projecao.nota],
        ['Receita nova (mensalidades)', r.receita, r.contratos.length ? `ticket médio ${formatBRL(r.ticket)}` : ''],
        ['Saídas', r.saidas, `churn ${r.churn}`],
        ['Receita perdida (mensalidades)', r.receitaPerdida, ''],
        ['Carteira total', r.carteira ?? '—', `saldo do mês ${r.saldo >= 0 ? '+' : ''}${r.saldo}`],
        ['Leads', r.leads, ''],
        ['Conversão', r.conversao, '']
    ];
    const contratos = [['Contrato', 'Cliente', 'Segmento', 'Origem', 'Data de entrada', 'Contrato assinado', 'Mensalidade (R$)'],
        ...r.contratos.map(c => [c.contrato || '', c.nome, c.segmento || '', c.origemCliente || '', formatDateBR(c.dataEntrada), c.assinado === 'Sim' ? 'Sim' : 'Pendente', Number(c.valorMensal) || 0])];
    if (r.contratos.length) contratos.push(['', 'Total', '', '', '', '', r.receita]);
    const saidas = [['Cliente', 'Data do aviso', 'Data da saída', 'Motivo'],
        ...r.listaSaidas.map(s => [s.nome, s.dataAviso || '', formatDateBR(s.dataSaida), s.motivo || ''])];
    const segmentos = [['Segmento', 'Clientes'], ...r.segmentos];

    try {
        const XLSX = await carregarSheetJS();
        const wb = XLSX.utils.book_new();
        const add = (dados, nome, larguras) => {
            const ws = XLSX.utils.aoa_to_sheet(dados);
            ws['!cols'] = larguras.map(w => ({ wch: w }));
            XLSX.utils.book_append_sheet(wb, ws, nome);
        };
        add(resumo, 'Resumo', [32, 22, 36]);
        add(contratos, 'Contratos', [14, 44, 22, 18, 16, 18, 18]);
        add(saidas, 'Saídas', [44, 16, 16, 30]);
        add(segmentos, 'Segmentos', [30, 12]);
        XLSX.writeFile(wb, `${nomeArq}.xlsx`);
        showToast('Relatório em Excel gerado.');
    } catch (e) {
        // Sem internet: gera um CSV que o Excel abre direto
        const linhas = [...resumo, [], ['CONTRATOS FECHADOS'], ...contratos, [], ['SAÍDAS'], ...saidas, [], ['SEGMENTOS'], ...segmentos];
        const csv = '﻿' + linhas.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
        baixarArquivo(csv, `${nomeArq}.csv`, 'text/csv;charset=utf-8');
        showToast('Sem internet: relatório baixado em CSV (abre no Excel).');
    }
    document.getElementById('modal-relatorio').classList.remove('active');
}

function renderOverviewGauge(fechados, meta) {
    const box = document.getElementById('perf-segments');
    if (!box) return;
    if (fechados === undefined) {
        const [m, a] = AppState.selectedMonthOverview.split('/');
        fechados = getFechamentosDoAno(parseInt(a, 10))[m] || 0;
        meta = getMetaClientesMes(parseInt(a, 10));
    }
    const extra = Math.max(0, fechados - meta);
    let html = '';
    for (let i = 0; i < meta; i++) {
        html += `<span class="perf-seg ${i < fechados ? (fechados >= meta ? 'done' : 'on') : ''}"></span>`;
    }
    if (extra > 0) html += `<span class="perf-seg-extra">+${extra}</span>`;
    box.innerHTML = html;
}

function renderOverviewMonthClients(mesAtual) {
    const container = document.getElementById('recent-clients-tbody');
    const titleEl = document.getElementById('overview-table-title');
    if (!container) return;

    const clientesDoMes = AppState.clientes
        .filter(c => c.mesEntrada === mesAtual)
        .sort((a, b) => new Date(b.dataEntrada) - new Date(a.dataEntrada));

    if (titleEl) {
        titleEl.innerHTML = `Contratos Fechados em <strong>${getMonthNameFull(mesAtual)}</strong> (${clientesDoMes.length} fechamentos)`;
    }

    if (clientesDoMes.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">
                    Nenhum cliente fechado registrado para <strong>${getMonthNameFull(mesAtual)}</strong>.<br>
                    <small>Clique em <strong>"+ Adicionar Cliente"</strong> para registrar novos fechamentos neste mês.</small>
                </td>
            </tr>
        `;
        return;
    }

    container.innerHTML = clientesDoMes.map(c => `
        <tr>
            <td>${c.contrato ? `<strong>${c.contrato}</strong>` : '<span style="color: var(--text-muted);">—</span>'}</td>
            <td><strong>${c.nome}</strong></td>
            <td>${c.segmento ? `<span class="tag-segmento">${c.segmento}</span>` : '<span style="color: var(--text-muted);">—</span>'}</td>
            <td>${formatDateBR(c.dataEntrada)}</td>
            <td>
                ${c.assinado ? `<span class="status-pill ${c.assinado === 'Sim' ? 'assinado-sim' : 'assinado-nao'}">
                    ${c.assinado === 'Sim' ? '✓ Assinado' : '⏳ Pendente'}
                </span>` : '<span style="color: var(--text-muted);">—</span>'}
            </td>
            <td>${temValor(c.valorMensal) ? `<strong>${formatMoney(c.valorMensal)}</strong>` : '<span style="color: var(--text-muted);">—</span>'}</td>
        </tr>
    `).join('');
}

/* ==========================================================================
   2. 1° CAMPO: CLIENTES (ABAS FECHADOS / SAÍDAS E SELEÇÃO DE ANO)
   ========================================================================== */
/* ---------- Segmentos: lista dinâmica (cresce quando um novo é digitado) ---------- */
const STORAGE_KEY_SEGMENTOS = 'lift_comercial_segmentos';
const SEGMENTOS_PADRAO = [
    'Advocacia', 'Agência', 'Alimentação', 'Comércio', 'Comércio/Serviço', 'Consultoria',
    'Desenvolvedores', 'Educação', 'Financeiro', 'Gateway de pagamento', 'Holding', 'Indústria',
    'Infoprodutores', 'Logística', 'Marketing Digital', 'MEI', 'Outros', 'Saúde', 'Serviço',
    'Serviços', 'Sucata', 'Tecnologia', 'Turismo'
];

function getSegmentosSalvos() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SEGMENTOS)) || []; } catch (e) { return []; }
}

function getListaSegmentos() {
    const mapa = new Map();
    const add = (seg) => {
        const v = (seg || '').trim();
        if (v && !mapa.has(v.toLocaleLowerCase('pt-BR'))) mapa.set(v.toLocaleLowerCase('pt-BR'), v);
    };
    SEGMENTOS_PADRAO.forEach(add);
    getSegmentosSalvos().forEach(add);
    AppState.clientes.forEach(c => add(c.segmento));
    AppState.saidas.forEach(x => add(x.segmento));
    return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Normaliza o texto digitado: reaproveita a grafia de um segmento já existente
// (ignorando maiúsculas/minúsculas) ou registra o novo segmento na lista.
function registrarSegmento(texto) {
    const v = (texto || '').trim().replace(/\s+/g, ' ');
    if (!v) return '';
    const existente = getListaSegmentos().find(x => x.toLocaleLowerCase('pt-BR') === v.toLocaleLowerCase('pt-BR'));
    if (existente) return existente;
    const salvos = getSegmentosSalvos();
    salvos.push(v);
    try { localStorage.setItem(STORAGE_KEY_SEGMENTOS, JSON.stringify(salvos)); } catch (e) { /* ignora */ }
    return v;
}

/* ---------- Origem do cliente (de onde veio) ---------- */
const ORIGENS_PADRAO = ['Indicação', 'Instagram', 'Google', 'Site', 'WhatsApp', 'Facebook', 'LinkedIn', 'Evento', 'Parceiro', 'Prospecção ativa', 'Tráfego pago', 'Outros'];

function getListaOrigens() {
    const mapa = new Map();
    const add = (o) => {
        const v = (o || '').trim();
        if (v && !mapa.has(v.toLocaleLowerCase('pt-BR'))) mapa.set(v.toLocaleLowerCase('pt-BR'), v);
    };
    ORIGENS_PADRAO.forEach(add);
    AppState.clientes.forEach(c => add(c.origemCliente));
    return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Reaproveita a grafia de uma origem já existente (ignorando maiúsculas/minúsculas)
function normalizarOrigem(texto) {
    const v = (texto || '').trim().replace(/\s+/g, ' ');
    if (!v) return '';
    const existente = getListaOrigens().find(x => x.toLocaleLowerCase('pt-BR') === v.toLocaleLowerCase('pt-BR'));
    return existente || v;
}

function renderListasOrigens() {
    const lista = getListaOrigens();
    const dl = document.getElementById('lista-origens');
    if (dl) dl.innerHTML = lista.map(o => `<option value="${escHtml(o)}"></option>`).join('');
    const filtro = document.getElementById('filter-origem-select');
    if (filtro) {
        const usadas = new Set(AppState.clientes.map(c => (c.origemCliente || '').trim()).filter(Boolean));
        const atual = AppState.filterOrigem;
        filtro.innerHTML = '<option value="">Todas as Origens</option>'
            + [...usadas].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(o => `<option value="${escHtml(o)}" ${o === atual ? 'selected' : ''}>${escHtml(o)}</option>`).join('')
            + `<option value="__vazio__" ${atual === '__vazio__' ? 'selected' : ''}>Sem origem informada</option>`;
    }
}

function renderListasSegmentos() {
    renderListasOrigens();
    const lista = getListaSegmentos();

    const datalist = document.getElementById('lista-segmentos');
    if (datalist) datalist.innerHTML = lista.map(seg => `<option value="${seg}"></option>`).join('');

    const filtro = document.getElementById('filter-segmento-select');
    if (filtro) {
        const atual = AppState.filterSegmento;
        filtro.innerHTML = '<option value="">Todos os Segmentos</option>' +
            lista.map(seg => `<option value="${seg}" ${seg === atual ? 'selected' : ''}>${seg}</option>`).join('');
    }
}

function renderClientesView() {
    const ano = AppState.selectedYearClientes;
    const tab = AppState.activeClientesTab;

    renderListasSegmentos();

    // Mantém os botões das sub-abas (Fechados / Saídas) iguais à aba ativa
    document.querySelectorAll('.sub-tab-btn[data-subtab]').forEach(b => b.classList.toggle('active', b.getAttribute('data-subtab') === tab));

    // Atualiza o botão/lista de anos
    renderYearDropdown('clientes');

    // Filtra por ano e (opcionalmente) pelo mês selecionado
    const mesFiltro = AppState.filterMesClientes;
    const clientesAno = AppState.clientes.filter(c => c.ano === ano && (!mesFiltro || getMesCliente(c).startsWith(mesFiltro + '/')));
    const saidasAno = AppState.saidas.filter(s => s.ano === ano && (!mesFiltro || getMesSaida(s).startsWith(mesFiltro + '/')));

    const countFechados = document.getElementById('count-tab-fechados');
    const countSaidas = document.getElementById('count-tab-saidas');
    // O número da aba acompanha os filtros de segmento e origem
    const qtdFechados = clientesAno.filter(c =>
        (!AppState.filterSegmento || c.segmento === AppState.filterSegmento) &&
        (!AppState.filterOrigem || (AppState.filterOrigem === '__vazio__' ? !(c.origemCliente || '').trim() : (c.origemCliente || '') === AppState.filterOrigem))
    ).length;
    if (countFechados) countFechados.textContent = `${qtdFechados}`;
    if (countSaidas) countSaidas.textContent = `${saidasAno.length}`;

    const wrapperFechados = document.getElementById('wrapper-tab-fechados');
    const wrapperSaidas = document.getElementById('wrapper-tab-saidas');

    renderTabelaClientesFechados(clientesAno);
    renderTabelaSaidas(saidasAno);

    if (tab === 'fechados') {
        if (wrapperFechados) wrapperFechados.style.display = 'block';
        if (wrapperSaidas) wrapperSaidas.style.display = 'none';
    } else {
        if (wrapperFechados) wrapperFechados.style.display = 'none';
        if (wrapperSaidas) wrapperSaidas.style.display = 'block';
    }
}

/* ---------- Clientes: seletor de ano, mês e ordenação por mês ---------- */
function getMesCliente(c) {
    if (c.mesEntrada) return c.mesEntrada;
    if (c.dataEntrada) { const [a, m] = c.dataEntrada.split('-'); return `${m}/${a}`; }
    return '';
}

function getMesSaida(s) {
    if (s.mesSaida) return s.mesSaida;
    if (s.dataSaida) { const [a, m] = s.dataSaida.split('-'); return `${m}/${a}`; }
    return '';
}

function chaveOrdenacao(mesAno, data) {
    const [m, a] = (mesAno || '00/0000').split('/');
    return `${a}-${m}|${data || ''}`;
}

function ordenarPorMes(lista, getMes, campoData) {
    return [...lista].sort((x, y) => {
        const kx = chaveOrdenacao(getMes(x), x[campoData]);
        const ky = chaveOrdenacao(getMes(y), y[campoData]);
        return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
}

function linhaGrupoMes(mesAno, qtd, singular, plural) {
    const [m, a] = mesAno.split('/');
    const nome = MONTH_NAMES_BR[m] ? MONTH_NAMES_BR[m].full : mesAno;
    return `
        <tr class="month-group-row">
            <td colspan="9">
                <span class="month-group-name">${nome} de ${a}</span>
                <span class="month-group-count">${qtd} ${qtd === 1 ? singular : plural}</span>
            </td>
        </tr>`;
}

// Anos que aparecem nos botões de seleção de ano de todas as abas
const ANO_MINIMO_SELECAO = 2012;
const ANO_MAXIMO_SELECAO = 2030;

function getAnosDisponiveisClientes() {
    const anos = new Set([new Date().getFullYear(), AppState.selectedYearClientes]);
    for (let a = ANO_MINIMO_SELECAO; a <= ANO_MAXIMO_SELECAO; a++) anos.add(a);
    AppState.clientes.forEach(c => { if (c.ano) anos.add(Number(c.ano)); });
    AppState.saidas.forEach(s => { if (s.ano) anos.add(Number(s.ano)); });
    return [...anos].filter(Boolean).sort((a, b) => b - a);
}

/**
 * Botão de ano com lista suspensa (usado em Clientes e Dados)
 * prefixo: 'clientes' | 'dados' -> usa #<prefixo>-year-dropdown/-btn/-label/-menu
 */
const YEAR_DROPDOWNS = {
    clientes: { get: () => AppState.selectedYearClientes, set: (a) => { AppState.selectedYearClientes = a; }, render: () => renderClientesView() },
    dados:    { get: () => AppState.selectedYearDados,    set: (a) => { AppState.selectedYearDados = a; },    render: () => renderDadosView() },
    oportunidades: { get: () => AppState.selectedYearOportunidades || 2026, set: (a) => { AppState.selectedYearOportunidades = a; }, render: () => renderOportunidadesView() },
    receita:  { get: () => AppState.selectedYearReceita || new Date().getFullYear(), set: (a) => { AppState.selectedYearReceita = a; }, render: () => renderReceitaView() },
    churn:    { get: () => AppState.selectedYearChurn || new Date().getFullYear(), set: (a) => { AppState.selectedYearChurn = a; }, render: () => renderChurnView() },
    origens:  { get: () => AppState.selectedYearOrigens || new Date().getFullYear(), set: (a) => { AppState.selectedYearOrigens = a; }, render: () => renderOrigensView() },
    vendedores: { get: () => AppState.selectedYearVendedores || new Date().getFullYear(), set: (a) => { AppState.selectedYearVendedores = a; }, render: () => renderVendedoresView() }
};

function renderYearDropdown(prefixo) {
    const cfg = YEAR_DROPDOWNS[prefixo];
    const atual = cfg.get();
    const label = document.getElementById(`${prefixo}-year-label`);
    const menu = document.getElementById(`${prefixo}-year-menu`);
    if (label) label.textContent = atual;
    if (!menu) return;
    menu.innerHTML = getAnosDisponiveisClientes().map(ano => `
        <button type="button" class="year-dropdown-item ${ano === atual ? 'active' : ''}" data-year="${ano}" role="option">
            <span>${ano}</span>
            ${ano === atual ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
        </button>`).join('');
}

function setupYearDropdown(prefixo) {
    const cfg = YEAR_DROPDOWNS[prefixo];
    const wrap = document.getElementById(`${prefixo}-year-dropdown`);
    const btn = document.getElementById(`${prefixo}-year-btn`);
    const menu = document.getElementById(`${prefixo}-year-menu`);
    if (!wrap || !btn || !menu) return;

    const fechar = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const abrir = !wrap.classList.contains('open');
        renderYearDropdown(prefixo);
        wrap.classList.toggle('open', abrir);
        btn.setAttribute('aria-expanded', String(abrir));
        if (abrir) {
            const ativo = menu.querySelector('.year-dropdown-item.active');
            if (ativo) menu.scrollTop = ativo.offsetTop - menu.clientHeight / 2 + ativo.offsetHeight / 2;
        }
    });

    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.year-dropdown-item');
        if (!item) return;
        cfg.set(parseInt(item.getAttribute('data-year')));
        fechar();
        cfg.render();
    });

    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) fechar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
}

function renderTabelaClientesFechados(lista) {
    const tbody = document.getElementById('tabela-clientes-tbody');
    if (!tbody) return;

    let filtrados = lista;
    if (AppState.searchQueryClientes) {
        const q = AppState.searchQueryClientes.toLowerCase();
        filtrados = filtrados.filter(c =>
            (c.contrato || '').toLowerCase().includes(q) ||
            (c.nome || '').toLowerCase().includes(q) ||
            (c.segmento || '').toLowerCase().includes(q) ||
            (c.origemCliente || '').toLowerCase().includes(q) ||
            (c.indicadoPor || '').toLowerCase().includes(q) ||
            (c.vendedor || '').toLowerCase().includes(q)
        );
    }

    if (AppState.filterSegmento) {
        filtrados = filtrados.filter(c => c.segmento === AppState.filterSegmento);
    }

    if (AppState.filterOrigem) {
        filtrados = filtrados.filter(c => AppState.filterOrigem === '__vazio__'
            ? !(c.origemCliente || '').trim()
            : (c.origemCliente || '') === AppState.filterOrigem);
    }

    if (filtrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">
                    Nenhum cliente fechado encontrado para ${AppState.filterMesClientes ? MONTH_NAMES_BR[AppState.filterMesClientes].full + ' de ' : 'o ano de '}${AppState.selectedYearClientes}.
                </td>
            </tr>
        `;
        return;
    }

    // Ordena por mês/data de entrada e agrupa com um cabeçalho por mês
    filtrados = ordenarPorMes(filtrados, getMesCliente, 'dataEntrada');
    const qtdPorMes = {};
    filtrados.forEach(c => { const m = getMesCliente(c); qtdPorMes[m] = (qtdPorMes[m] || 0) + 1; });
    let mesAnterior = null;

    tbody.innerHTML = filtrados.map(c => {
        const mesAtual = getMesCliente(c);
        const cabecalho = mesAtual !== mesAnterior ? linhaGrupoMes(mesAtual, qtdPorMes[mesAtual], 'cliente', 'clientes') : '';
        mesAnterior = mesAtual;
        return cabecalho + `
        <tr>
            <td>${c.contrato ? `<strong>${c.contrato}</strong>` : '<span style="color: var(--text-muted);">—</span>'}</td>
            <td>
                <div style="font-weight: 600; color: var(--lift-blue);">${c.nome}</div>
                ${c.status === 'Cancelado' ? `<span class="tag-saiu">Saiu${c.mesSaida ? ' em ' + c.mesSaida : ''}</span>` : ''}
            </td>
            <td>${c.segmento ? `<span class="tag-segmento">${c.segmento}</span>` : '<span style="color: var(--text-muted);">—</span>'}</td>
            <td>${c.origemCliente ? `<span class="tag-origem">${escHtml(c.origemCliente)}</span>${c.indicadoPor ? `<small class="tag-indicador">por ${escHtml(c.indicadoPor)}</small>` : ''}` : '<span style="color: var(--text-muted);">—</span>'}</td>
            <td><strong>${c.mesEntrada}</strong></td>
            <td>${formatDateBR(c.dataEntrada)}</td>
            <td>
                ${c.assinado ? `<span class="status-pill ${c.assinado === 'Sim' ? 'assinado-sim' : 'assinado-nao'}">
                    ${c.assinado === 'Sim' ? 'Sim' : 'Pendente'}
                </span>` : '<span style="color: var(--text-muted);">—</span>'}
            </td>
            <td>${temValor(c.valorMensal) ? formatMoney(c.valorMensal) : '<span style="color: var(--text-muted);">—</span>'}</td>
            <td>
                <div class="table-actions">
                    <button class="btn-action-icon" title="Editar Cliente" onclick="openEditClienteModal('${c.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-action-icon" title="Registrar Saída (Churn)" onclick="openRegistrarSaidaModal('${c.id}')" ${c.status === 'Cancelado' ? 'disabled style="opacity:.35;cursor:not-allowed"' : ''}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    </button>
                    <button class="btn-action-icon danger" title="Excluir" onclick="confirmDeleteCliente('${c.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

/* ---------- Mensalidade nas saídas (campo na lista) ---------- */
function setupValorSaidas() {
    const tbody = document.getElementById('tabela-saidas-tbody');
    if (!tbody || tbody._valorBound) return;
    tbody._valorBound = true;
    const salvarCampo = (inp) => {
        const s = AppState.saidas.find(x => String(x.id) === inp.dataset.id);
        if (!s) return;
        const texto = inp.value.trim();
        if (!texto) {
            if (s.valorMensal === undefined) return;
            delete s.valorMensal;
        } else {
            const v = parseValorBR(texto);
            if (isNaN(v)) {
                inp.classList.add('erro');
                showToast('Valor inválido. Use por exemplo 697 ou 697,50.');
                return;
            }
            if (Number(s.valorMensal) === v) { inp.value = formatValorInput(v); return; }
            s.valorMensal = v;
            inp.value = formatValorInput(v);
        }
        inp.classList.remove('erro');
        inp.classList.add('salvo');
        setTimeout(() => inp.classList.remove('salvo'), 900);
        saveStorage();
        renderChurnView();
    };
    tbody.addEventListener('change', (e) => { if (e.target.classList.contains('saida-valor-input')) salvarCampo(e.target); });
    tbody.addEventListener('keydown', (e) => {
        if (!e.target.classList.contains('saida-valor-input') || e.key !== 'Enter') return;
        e.preventDefault();
        const inputs = [...tbody.querySelectorAll('.saida-valor-input')];
        const prox = inputs[inputs.indexOf(e.target) + 1];
        e.target.blur();
        if (prox) { prox.focus(); prox.select(); }
    });
    tbody.addEventListener('focusin', (e) => { if (e.target.classList.contains('saida-valor-input')) e.target.select(); });
}

function renderTabelaSaidas(lista) {
    const tbody = document.getElementById('tabela-saidas-tbody');
    if (!tbody) return;

    let filtrados = lista;
    if (AppState.searchQuerySaidas) {
        const q = AppState.searchQuerySaidas.toLowerCase();
        filtrados = filtrados.filter(s => 
            (s.nome || '').toLowerCase().includes(q) ||
            (s.motivo || '').toLowerCase().includes(q) ||
            (s.segmento || '').toLowerCase().includes(q)
        );
    }

    if (filtrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">
                    Nenhuma saída (churn) registrada para ${AppState.filterMesClientes ? MONTH_NAMES_BR[AppState.filterMesClientes].full + ' de ' : 'o ano de '}${AppState.selectedYearClientes}.
                </td>
            </tr>
        `;
        return;
    }

    filtrados = ordenarPorMes(filtrados, getMesSaida, 'dataSaida');
    const qtdPorMes = {};
    filtrados.forEach(x => { const m = getMesSaida(x); qtdPorMes[m] = (qtdPorMes[m] || 0) + 1; });
    let mesAnterior = null;

    tbody.innerHTML = filtrados.map(s => {
        const mesAtual = getMesSaida(s);
        const cabecalho = mesAtual !== mesAnterior ? linhaGrupoMes(mesAtual, qtdPorMes[mesAtual], 'saída', 'saídas') : '';
        mesAnterior = mesAtual;
        return cabecalho + `
        <tr>
            <td><div style="font-weight: 600; color: #991B1B;">${s.nome}</div></td>
            <td>${s.dataAviso || '-'}</td>
            <td><strong style="color: #DC2626;">${formatDateBR(s.dataSaida)}</strong></td>
            <td>${s.motivo || 'Não informado'}</td>
            <td>
                <div class="saida-valor">
                    <span>R$</span>
                    <input type="text" inputmode="decimal" class="saida-valor-input" data-id="${s.id}"
                           value="${s.valorMensal !== undefined && s.valorMensal !== null && s.valorMensal !== '' ? formatValorInput(s.valorMensal) : ''}"
                           placeholder="${getValorSaida(s) ? formatValorInput(getValorSaida(s)) : '0,00'}" aria-label="Mensalidade de ${s.nome}">
                </div>
            </td>
            <td>
                <div class="table-actions">
                    <button class="btn-action-icon" title="Editar Saída" onclick="openEditarSaidaModal('${s.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-action-icon danger" title="Excluir Registro" onclick="confirmDeleteSaida('${s.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

/* ==========================================================================
   3. 2° CAMPO: DADOS (TABELA IDÊNTICA À PLANILHA DA IMAGEM 2)
   Cálculo Reativo Automático de Competências, Entradas, Saídas, Base, Churn, LTV
   ========================================================================== */
// Total de clientes no fim do ano anterior ao informado.
// 2025 fechou com INITIAL_BASE_CLIENTES_2025_END (194); anos anteriores são
// calculados para trás com o histórico oficial; anos seguintes, para frente.
function baseInicialDoAno(year) {
    const fim2025 = INITIAL_BASE_CLIENTES_2025_END;
    if (year === ANO_INICIO_CADASTRO_PORTAL) return fim2025;
    if (year < ANO_INICIO_CADASTRO_PORTAL) {
        let base = fim2025;
        Object.entries(HISTORICO_MENSAL_BASE).forEach(([mesAno, [e, s]]) => {
            const a = parseInt(mesAno.split('/')[1], 10);
            if (a >= year && a < ANO_INICIO_CADASTRO_PORTAL) base -= (e - s);
        });
        return base;
    }
    const anterior = calculateMonthlyDataForYear(year - 1, true).rows;
    return anterior.length ? anterior[anterior.length - 1].totalClientes : fim2025;
}

function calculateMonthlyDataForYear(year, _semAnoAnterior = false) {
    const meses = [
        '01', '02', '03', '04', '05', '06', 
        '07', '08', '09', '10', '11', '12'
    ];

    // Base inicial (total de clientes no fim do ano anterior)
    let currentBase = baseInicialDoAno(year);
    const usaHistorico = year < ANO_INICIO_CADASTRO_PORTAL;

    const rows = [];
    let somaEntradas = 0;
    let somaSaidas = 0;

    meses.forEach((mStr, idx) => {
        const competencia = `${mStr}/${year}`;
        
        // Contagem dinâmica de entradas naquele mês/ano (todos os contratos fechados na competência)
        const hist = HISTORICO_MENSAL_BASE[competencia];
        const entradasNoMes = usaHistorico
            ? (hist ? hist[0] : 0)
            : AppState.clientes.filter(c => c.mesEntrada === competencia).length;

        // Contagem dinâmica de saídas naquele mês/ano
        const saidasNoMes = usaHistorico
            ? (hist ? hist[1] : 0)
            : AppState.saidas.filter(s => s.mesSaida === competencia).length;

        const previousBase = currentBase;
        // Total de clientes acumula: Base Anterior + Entradas - Saídas
        currentBase = currentBase + entradasNoMes - saidasNoMes;

        somaEntradas += entradasNoMes;
        somaSaidas += saidasNoMes;

        // Churn (%) = -(Saídas / Base Anterior)
        let churnPercent = 0;
        let churnFormatted = '0,0%';
        if (saidasNoMes > 0 && previousBase > 0) {
            churnPercent = -((saidasNoMes / previousBase) * 100);
            churnFormatted = churnPercent.toFixed(1).replace('.', ',') + '%';
        }

        // LTV/meses = 1 / Churn rate (Base anterior ÷ Saídas).
        // Mês sem saída não tem churn: o LTV não é calculável (não é zero), então
        // aparece "—" e não puxa a média para baixo.
        const hojeComp = new Date();
        const mesFuturo = year > hojeComp.getFullYear() || (year === hojeComp.getFullYear() && idx > hojeComp.getMonth());
        let ltvRaw = null;
        if (saidasNoMes > 0 && previousBase > 0) ltvRaw = previousBase / saidasNoMes;
        const ltvMeses = ltvRaw !== null ? Math.round(ltvRaw) : (mesFuturo ? '' : '—');

        // LTV méd = (LTV/meses do mês anterior + LTV/meses do mês) / 2
        // (mesma fórmula da planilha: =SOMA(F3:F4)/2), usando só os meses com saída.
        // Se nenhum dos dois meses teve saída, repete a última média calculada.
        let ltvAnteriorRaw = null;
        let ltvMedioAnterior = null;
        if (idx > 0) {
            ltvAnteriorRaw = rows[idx - 1].ltvRaw;
            ltvMedioAnterior = rows[idx - 1].ltvMedioRaw;
        } else if (!_semAnoAnterior) {
            const anoAnterior = calculateMonthlyDataForYear(year - 1, true);
            const ult = anoAnterior.rows[11];
            ltvAnteriorRaw = ult ? ult.ltvRaw : null;
            ltvMedioAnterior = ult ? ult.ltvMedioRaw : null;
        }
        const validos = [ltvAnteriorRaw, ltvRaw].filter(v => v !== null);
        const ltvMedioRaw = validos.length ? validos.reduce((a, b) => a + b, 0) / validos.length : ltvMedioAnterior;
        const ltvMedio = mesFuturo ? '' : (ltvMedioRaw !== null ? Math.round(ltvMedioRaw) : '—');

        // Se for um mês futuro com zero movimentações, mantém consistente
        const hasData = entradasNoMes > 0 || saidasNoMes > 0 || (idx <= 10 && year === 2026);

        rows.push({
            competencia: competencia,
            entradas: entradasNoMes,
            saidas: saidasNoMes === 0 ? (hasData ? 0 : '') : -saidasNoMes,
            totalClientes: currentBase,
            churn: churnFormatted,
            churnRaw: churnPercent,
            ltvMeses: ltvMeses,
            ltvMedio: ltvMedio,
            ltvRaw: ltvRaw,
            ltvMedioRaw: ltvMedioRaw,
            hasData: hasData
        });
    });

    return {
        rows,
        somaEntradas,
        somaSaidas,
        baseFinal: currentBase
    };
}

function renderDadosView() {
    const ano = AppState.selectedYearDados;

    // Atualiza o botão/lista de anos na tela de Dados
    renderYearDropdown('dados');

    const dataReport = calculateMonthlyDataForYear(ano);
    const tbody = document.getElementById('tabela-dados-tbody');
    const tfoot = document.getElementById('tabela-dados-tfoot');
    if (!tbody) return;

    tbody.innerHTML = dataReport.rows.map(r => `
        <tr>
            <td style="font-weight: 700; color: var(--lift-blue);">${r.competencia}</td>
            <td style="font-weight: 600; color: #047857;">${r.entradas !== '' ? r.entradas : ''}</td>
            <td style="font-weight: 600; color: ${r.saidas < 0 ? '#DC2626' : 'inherit'};">${r.saidas}</td>
            <td style="font-weight: 700; color: var(--lift-blue);">${r.totalClientes}</td>
            <td class="${r.churnRaw < 0 ? 'churn-negative' : 'churn-neutral'}">${r.churn}</td>
            <td>${r.ltvMeses}</td>
            <td style="font-weight: 600;">${r.ltvMedio}</td>
        </tr>
    `).join('');

    // Linha de Totais Anuais no Rodapé
    if (tfoot) {
        const saldoLiquido = dataReport.somaEntradas - dataReport.somaSaidas;
        tfoot.innerHTML = `
            <tr class="total-row">
                <td>TOTAL ANUAL / SALDO</td>
                <td style="color: #047857;">+${dataReport.somaEntradas} Entradas</td>
                <td style="color: #DC2626;">-${dataReport.somaSaidas} Saídas</td>
                <td></td>
                <td colspan="3" style="text-align: right; color: var(--lift-blue);">
                    Saldo Líquido: <strong>${saldoLiquido >= 0 ? '+' : ''}${saldoLiquido} clientes</strong>
                </td>
            </tr>
        `;
    }
}

/* ==========================================================================
   4. 3° CAMPO: DASHBOARD (HISTÓRICO 24 MESES EM GRÁFICO)
   ========================================================================== */
function renderDashboardView() {
    const serie = getDashboardMonthlySeries();

    // Totais por ano
    const porAno = {};
    serie.forEach(d => {
        const ano = d.mesAno.split('/')[1];
        if (!porAno[ano]) porAno[ano] = { entradas: 0, saidas: 0 };
        porAno[ano].entradas += d.entradas;
        porAno[ano].saidas += d.saidas;
    });
    const anos = Object.keys(porAno).sort();
    const anosLista = (campo) => anos.map(ano => `
        <div class="dash-year-row"><span>${ano}:</span><strong>${porAno[ano][campo]}</strong></div>`).join('');

    const elEnt = document.getElementById('dash-entradas-anos');
    const elSai = document.getElementById('dash-saidas-anos');
    if (elEnt) elEnt.innerHTML = anosLista('entradas');
    if (elSai) elSai.innerHTML = anosLista('saidas');

    // Recorde de entradas e pior mês de churn (primeira ocorrência do maior valor)
    let recorde = null, pior = null;
    serie.forEach(d => {
        if (!recorde || d.entradas > recorde.entradas) recorde = d;
        if (!pior || d.saidas > pior.saidas) pior = d;
    });
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setText('dash-recorde-valor', recorde ? recorde.entradas : 0);
    setText('dash-recorde-mes', recorde ? recorde.labelLongo : '-');
    setText('dash-pior-valor', pior ? pior.saidas : 0);
    setText('dash-pior-mes', pior ? pior.labelLongo : '-');

    // Meta anual de novos clientes (ano corrente)
    const anoAtual = String(new Date().getFullYear());
    const metaMes = getMetaClientesMes(parseInt(anoAtual, 10));
    const metaAno = metaMes * 12;
    const realizadoAno = porAno[anoAtual] ? porAno[anoAtual].entradas : 0;
    setText('dash-meta-title', `META DE NOVOS CLIENTES (${anoAtual})`);
    setText('dash-meta-value', `${realizadoAno} / ${metaAno}`);
    const fill = document.getElementById('dash-meta-fill');
    if (fill) fill.style.width = `${Math.min(100, (realizadoAno / metaAno) * 100).toFixed(1)}%`;

    renderDashboardChart();
}

/* --------------------------------------------------------------------------
   Série mensal do Dashboard
   - De ANO_INICIO_CADASTRO_PORTAL (2026) em diante: conta exatamente os clientes
     e saídas cadastrados na aba Clientes (o gráfico bate com a lista).
   - Anos anteriores (sem cadastro no portal): usa o HISTORICO_MENSAL_BASE e soma
     qualquer cliente/saída que venha a ser cadastrado nesses meses.
   -------------------------------------------------------------------------- */
function contarCadastrosPorMes() {
    const ent = {}, sai = {};
    AppState.clientes.forEach(c => { const m = getMesCliente(c); if (m) ent[m] = (ent[m] || 0) + 1; });
    AppState.saidas.forEach(s => { const m = getMesSaida(s); if (m) sai[m] = (sai[m] || 0) + 1; });
    return { ent, sai };
}

function mesAnoToIndex(mesAno) {
    const [m, a] = mesAno.split('/').map(Number);
    return a * 12 + (m - 1);
}

function indexToMesAno(idx) {
    const a = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    return `${String(m).padStart(2, '0')}/${a}`;
}

function getDashboardMonthlySeries() {
    const base = HISTORICO_MENSAL_BASE;
    const { ent, sai } = contarCadastrosPorMes();

    const mesesBase = Object.keys(base).map(mesAnoToIndex);
    const inicio = Math.min(...mesesBase);
    const fimBase = Math.max(...mesesBase);

    // Vai até o mês atual (ou até o último mês com cadastro, se for posterior)
    const hoje = new Date();
    let fim = Math.max(fimBase, hoje.getFullYear() * 12 + hoje.getMonth());
    Object.keys(ent).concat(Object.keys(sai)).forEach(m => {
        if (/^\d{2}\/\d{4}$/.test(m)) fim = Math.max(fim, mesAnoToIndex(m));
    });

    const serie = [];
    for (let idx = inicio; idx <= fim; idx++) {
        const mesAno = indexToMesAno(idx);
        const [mm, aaaa] = mesAno.split('/');
        let entradas, saidas;
        if (Number(aaaa) >= ANO_INICIO_CADASTRO_PORTAL || !base[mesAno]) {
            entradas = ent[mesAno] || 0;
            saidas = sai[mesAno] || 0;
        } else {
            // Anos anteriores ao portal: só o histórico oficial (a carteira importada
            // contém apenas quem continua ativo, não todas as entradas do período)
            entradas = base[mesAno][0];
            saidas = base[mesAno][1];
        }
        const nomeMes = MONTH_NAMES_BR[mm].full.slice(0, 3);
        serie.push({
            mesAno,
            label: `${nomeMes}/${aaaa.slice(2)}`,
            labelLongo: `${nomeMes}/${aaaa}`,
            entradas: Math.max(0, entradas),
            saidas: Math.max(0, saidas),
            metaClientes: getMetaClientesMes(parseInt(aaaa, 10)),
            metaChurn: getMetaChurnMes(parseInt(aaaa, 10))
        });
    }
    return serie;
}

/* ---------- Abre a aba Clientes já filtrada num mês (entradas ou saídas) ---------- */
function abrirClientesDoMes(mesAno, tipo = 'entrada') {
    const [m, a] = mesAno.split('/');
    const ano = parseInt(a, 10);
    AppState.selectedYearClientes = ano;
    AppState.filterMesClientes = m;
    AppState.filterSegmento = '';
    AppState.filterOrigem = '';
    AppState.searchQueryClientes = '';
    AppState.searchQuerySaidas = '';
    AppState.activeClientesTab = tipo === 'saida' ? 'saidas' : 'fechados';
    const selMes = document.getElementById('filter-mes-select');
    if (selMes) selMes.value = m;
    ['search-clientes-input', 'search-saidas-input'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    switchView('clientes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (ano < ANO_INICIO_CADASTRO_PORTAL) {
        showToast(`${MONTH_NAMES_BR[m].full} de ${ano} usa o histórico oficial: os clientes desse mês não estão cadastrados no portal.`);
    }
}

function renderDashboardChart() {
    LiftCharts.renderMonthlyChart('historyCanvas', getDashboardMonthlySeries(), { tooltipId: 'historyTooltip', onBarClick: abrirClientesDoMes });
}

/* ==========================================================================
   5. 4° CAMPO: OPORTUNIDADES & CONVERSÃO (LEADS E FECHAMENTOS)
   ========================================================================== */
const MESES_OPORTUNIDADES = [
    { key: '01', nome: 'Janeiro' },
    { key: '02', nome: 'Fevereiro' },
    { key: '03', nome: 'Março' },
    { key: '04', nome: 'Abril' },
    { key: '05', nome: 'Maio' },
    { key: '06', nome: 'Junho' },
    { key: '07', nome: 'Julho' },
    { key: '08', nome: 'Agosto' },
    { key: '09', nome: 'Setembro' },
    { key: '10', nome: 'Outubro' },
    { key: '11', nome: 'Novembro' },
    { key: '12', nome: 'Dezembro' }
];

function getLeadsDoAno(ano) {
    if (!AppState.oportunidadesLeads[ano]) {
        AppState.oportunidadesLeads[ano] = (DEFAULT_OPORTUNIDADES_ANO && DEFAULT_OPORTUNIDADES_ANO[ano])
            ? JSON.parse(JSON.stringify(DEFAULT_OPORTUNIDADES_ANO[ano]))
            : { '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0, '07': 0, '08': 0, '09': 0, '10': 0, '11': 0, '12': 0 };
    }
    return AppState.oportunidadesLeads[ano];
}

// Fechamentos por mês = mesma fonte do Dashboard (cadastros da aba Clientes;
// para anos sem cadastro no portal, o histórico mensal oficial).
function getFechamentosDoAno(ano) {
    const porMes = {};
    getDashboardMonthlySeries().forEach(d => {
        const [m, a] = d.mesAno.split('/');
        if (Number(a) === ano) porMes[m] = d.entradas;
    });
    if (ano >= ANO_INICIO_CADASTRO_PORTAL) {
        // garante contagem direta dos cadastros mesmo fora do intervalo do gráfico
        MESES_OPORTUNIDADES.forEach(m => {
            if (porMes[m.key] === undefined) {
                porMes[m.key] = AppState.clientes.filter(c => getMesCliente(c) === `${m.key}/${ano}`).length;
            }
        });
    }
    MESES_OPORTUNIDADES.forEach(m => { if (porMes[m.key] === undefined) porMes[m.key] = 0; });
    return porMes;
}

function formatPct(v, casas = 1) {
    return v.toFixed(casas).replace('.', ',') + '%';
}

function calcularOportunidades(ano) {
    const leadsAno = getLeadsDoAno(ano);
    const fech = getFechamentosDoAno(ano);
    let totalLeads = 0, totalFech = 0, melhor = null;
    const linhas = MESES_OPORTUNIDADES.map(m => {
        const leads = parseInt(leadsAno[m.key] || 0, 10) || 0;
        const fechamentos = fech[m.key] || 0;
        totalLeads += leads;
        totalFech += fechamentos;
        const conv = leads > 0 ? (fechamentos / leads) * 100 : null;
        if (conv !== null && fechamentos > 0 && (!melhor || conv > melhor.conv)) melhor = { nome: m.nome, conv };
        return { ...m, leads, fechamentos, conv };
    });
    const convGeral = totalLeads > 0 ? (totalFech / totalLeads) * 100 : null;
    return { linhas, totalLeads, totalFech, convGeral, melhor };
}

function htmlConversao(conv, fechamentos) {
    if (conv === null) {
        return fechamentos > 0
            ? '<span class="opp-conv-empty" title="Informe os leads do mês para calcular">sem leads</span>'
            : '<span class="opp-conv-empty">—</span>';
    }
    const nivel = conv >= 15 ? 'high' : 'low';
    return `<span class="opp-conv-pill ${nivel}">${formatPct(conv)}</span>`;
}

function renderOportunidadesView() {
    const ano = AppState.selectedYearOportunidades || 2026;
    renderYearDropdown('oportunidades');

    const titulo = document.getElementById('opp-card-title');
    if (titulo) titulo.textContent = `LEADS E CLIENTES ALCANÇADOS — ${ano}`;

    const r = calcularOportunidades(ano);
    const rows = document.getElementById('opp-rows');
    if (rows) {
        rows.innerHTML = r.linhas.map(l => `
            <div class="opp-row" data-mes="${l.key}">
                <span class="opp-mes">${l.nome}</span>
                <span class="center">
                    <input type="text" inputmode="numeric" class="opp-input" value="${l.leads}"
                           data-mes="${l.key}" aria-label="Leads de ${l.nome}">
                </span>
                <span class="center opp-fech ${l.fechamentos ? '' : 'zero'}">${l.fechamentos}</span>
                <span class="opp-conv-cell">${htmlConversao(l.conv, l.fechamentos)}</span>
            </div>`).join('');
    }
    atualizarResumoOportunidades(r);
}

function atualizarResumoOportunidades(r) {
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('total-leads-sum', r.totalLeads);
    set('total-fechamentos-sum', r.totalFech);
    set('total-conversao-sum', r.convGeral === null ? '—' : formatPct(r.convGeral, 2));
    set('kpi-total-leads', r.totalLeads);
    set('kpi-total-fechamentos', r.totalFech);
    set('kpi-conversao-geral', r.convGeral === null ? '—' : formatPct(r.convGeral, 2));
    set('kpi-melhor-mes', r.melhor ? `${r.melhor.nome} (${formatPct(r.melhor.conv)})` : '—');
}

// Atualiza leads sem redesenhar a tabela (o campo não perde o foco enquanto digita)
function handleLeadChange(ano, mes, novoValor, finalizar = false) {
    const valorNum = Math.max(0, parseInt(String(novoValor).replace(/\D/g, '') || '0', 10));
    getLeadsDoAno(ano)[mes] = valorNum;

    const r = calcularOportunidades(ano);
    const linha = r.linhas.find(l => l.key === mes);
    const row = document.querySelector(`#opp-rows .opp-row[data-mes="${mes}"] .opp-conv-cell`);
    if (row && linha) row.innerHTML = htmlConversao(linha.conv, linha.fechamentos);
    atualizarResumoOportunidades(r);
    renderOverview(); // prévia na Visão Geral acompanha em tempo real

    if (finalizar) {
        saveStorage();
    }
}

function setupOportunidadesInputs() {
    const rows = document.getElementById('opp-rows');
    if (!rows) return;
    const ano = () => AppState.selectedYearOportunidades || 2026;
    rows.addEventListener('input', (e) => {
        if (!e.target.classList.contains('opp-input')) return;
        e.target.value = e.target.value.replace(/\D/g, '');
        handleLeadChange(ano(), e.target.dataset.mes, e.target.value);
    });
    rows.addEventListener('change', (e) => {
        if (!e.target.classList.contains('opp-input')) return;
        if (e.target.value === '') e.target.value = '0';
        handleLeadChange(ano(), e.target.dataset.mes, e.target.value, true);
    });
    rows.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('opp-input') && e.key === 'Enter') {
            const inputs = [...rows.querySelectorAll('.opp-input')];
            const prox = inputs[inputs.indexOf(e.target) + 1];
            e.target.blur();
            if (prox) { prox.focus(); prox.select(); }
        }
    });
    rows.addEventListener('focusin', (e) => { if (e.target.classList.contains('opp-input')) e.target.select(); });
}

/* ==========================================================================
   RECEITA DE FECHAMENTO — soma das mensalidades dos contratos fechados
   (inclui clientes que depois saíram: a venda foi fechada naquele mês)
   ========================================================================== */
function getReceitaDoAno(ano) {
    const meses = MESES_ORDEM.map(m => ({ key: m, nome: MONTH_NAMES_BR[m].full, contratos: 0, valor: 0 }));
    AppState.clientes.forEach(c => {
        const mesAno = getMesCliente(c);
        if (!mesAno) return;
        const [m, a] = mesAno.split('/');
        if (parseInt(a, 10) !== ano) return;
        const linha = meses.find(x => x.key === m);
        if (!linha) return;
        if (!temValor(c.valorMensal)) return; // sem mensalidade informada (ex.: carteira importada)
        linha.contratos += 1;
        linha.valor += Number(c.valorMensal) || 0;
    });
    const contratos = meses.reduce((s, m) => s + m.contratos, 0);
    const valor = meses.reduce((s, m) => s + m.valor, 0);
    return { meses, contratos, valor };
}

function formatBRL(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function renderReceitaView() {
    const ano = AppState.selectedYearReceita || new Date().getFullYear();
    if (!document.getElementById('panel-receita')) return;
    renderYearDropdown('receita');

    const set = (id, v, html = false) => { const el = document.getElementById(id); if (el) el[html ? 'innerHTML' : 'textContent'] = v; };
    const r = getReceitaDoAno(ano);
    set('rec-card-title', `RECEITA POR MÊS — ${ano}`);

    // KPIs do ano
    set('rec-kpi-total', formatMoneyCurto(r.valor));
    const metaRecMes = getMetaReceitaMes(ano);
    set('rec-kpi-total-sub', metaRecMes ? `${Math.round((r.valor / (metaRecMes * 12)) * 100)}% da meta do ano (${formatMoneyCurto(metaRecMes * 12)})` : 'sem meta de receita definida');
    set('rec-kpi-contratos', r.contratos);
    set('rec-kpi-ticket', r.contratos ? formatMoneyCurto(r.valor / r.contratos) : '—');
    const melhor = r.meses.reduce((best, m) => (m.valor > (best ? best.valor : 0) ? m : best), null);
    set('rec-kpi-melhor', melhor ? `${melhor.nome} (${formatMoneyCurto(melhor.valor)})` : '—');

    // Tabela mês a mês
    let acumulado = 0;
    set('rec-rows', r.meses.map(m => {
        acumulado += m.valor;
        const vazio = m.contratos === 0;
        return `
            <div class="opp-row rec-row">
                <span class="opp-mes">${m.nome}</span>
                <span class="center opp-fech ${vazio ? 'zero' : ''}">${m.contratos}</span>
                <span class="right rec-valor ${vazio ? 'zero' : ''}">${vazio ? '—' : formatBRL(m.valor)}</span>
                <span class="right rec-sec">${vazio ? '—' : formatBRL(m.valor / m.contratos)}</span>
                <span class="right rec-sec">${acumulado ? formatBRL(acumulado) : '—'}</span>
            </div>`;
    }).join(''), true);
    set('rec-total-contratos', r.contratos);
    set('rec-total-valor', formatBRL(r.valor));
    set('rec-total-ticket', r.contratos ? formatBRL(r.valor / r.contratos) : '—');

    // Comparativo por ano
    const anos = getAnosDisponiveisClientes().sort((a, b) => a - b);
    const porAno = anos.map(a => ({ ano: a, ...getReceitaDoAno(a) }))
        .filter(x => x.contratos > 0 || x.ano === ano || x.ano === new Date().getFullYear());
    const max = Math.max(1, ...porAno.map(x => x.valor));
    set('rec-years', porAno.slice().reverse().map((x, i, arr) => {
        const anterior = porAno.find(p => p.ano === x.ano - 1);
        let variacao = '';
        if (anterior && anterior.valor > 0 && x.valor > 0) {
            const pct = ((x.valor - anterior.valor) / anterior.valor) * 100;
            variacao = `<span class="rec-var ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs. ${x.ano - 1}</span>`;
        }
        return `
            <button type="button" class="rec-year ${x.ano === ano ? 'active' : ''}" data-ano="${x.ano}">
                <div class="rec-year-top">
                    <span class="rec-year-ano">${x.ano}</span>
                    <span class="rec-year-valor">${x.valor ? formatBRL(x.valor) : '—'}</span>
                </div>
                <div class="rec-year-bar"><i style="width:${(x.valor / max) * 100}%"></i></div>
                <div class="rec-year-meta">
                    <span>${x.contratos ? `${x.contratos} contratos · ticket ${formatMoneyCurto(x.valor / x.contratos)}` : 'sem contratos cadastrados no portal'}</span>
                    ${variacao}
                </div>
            </button>`;
    }).join(''), true);
    document.querySelectorAll('#rec-years .rec-year').forEach(btn => {
        btn.onclick = () => { AppState.selectedYearReceita = parseInt(btn.dataset.ano, 10); renderReceitaView(); };
    });
}

/* ==========================================================================
   ANÁLISE DE CHURN — motivos, tempo de casa e receita perdida
   ========================================================================== */
// Agrupa motivos escritos de formas diferentes (ex.: "Inadimplente" e "Inadimplência")
function normalizarMotivo(m) {
    const t = (m || '').trim();
    const l = t.toLocaleLowerCase('pt-BR');
    if (!t) return 'Não informado';
    if (/inadimpl/.test(l)) return 'Inadimplência';
    if (/pre[çc]o/.test(l)) return 'Preço';
    if (/baixa|encerramento/.test(l)) return 'Baixa / encerramento da empresa';
    if (/troca de contador|contador da regi|contador interno|migra[çc]/.test(l)) return 'Troca de contador';
    if (/sem movimento|pouca movimenta/.test(l)) return 'Sem movimento';
    if (/custo|financeir/.test(l)) return 'Questões financeiras';
    return t.charAt(0).toUpperCase() + t.slice(1);
}

// Mensalidade do cliente que saiu (gravada na saída ou buscada no cadastro)
function getValorSaida(s) {
    if (s.valorMensal !== undefined && s.valorMensal !== null && s.valorMensal !== '') return Number(s.valorMensal) || 0;
    const c = AppState.clientes.find(x => (s.clienteId && x.id === s.clienteId) || (s.contrato && x.contrato === s.contrato));
    return c ? (Number(c.valorMensal) || 0) : null;
}

function getSaidasDoAno(ano) {
    return AppState.saidas.filter(s => {
        const m = getMesSaida(s);
        return m && parseInt(m.split('/')[1], 10) === ano;
    });
}

function renderChurnView() {
    const ano = AppState.selectedYearChurn || new Date().getFullYear();
    if (!document.getElementById('panel-churn')) return;
    renderYearDropdown('churn');
    const set = (id, v, html = false) => { const el = document.getElementById(id); if (el) el[html ? 'innerHTML' : 'textContent'] = v; };
    const saidas = getSaidasDoAno(ano);
    set('ch-motivos-title', `MOTIVOS DE SAÍDA — ${ano}`);

    // KPIs
    set('ch-kpi-saidas', saidas.length);
    const linhas = ano >= ANO_INICIO_CADASTRO_PORTAL ? calculateMonthlyDataForYear(ano).rows.filter(r => r.hasData) : [];
    const churns = linhas.map(r => Math.abs(r.churnRaw || 0));
    set('ch-kpi-churn', churns.length ? formatPct(churns.reduce((a, b) => a + b, 0) / churns.length) : '—');
    const tempos = saidas.map(s => Number(s.mesesAtivos) || 0).filter(v => v > 0);
    const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
    set('ch-kpi-tempo', tempoMedio === null ? '—' : `${tempoMedio.toFixed(0)} meses`);
    const comValor = saidas.map(s => ({ s, v: getValorSaida(s) })).filter(x => x.v !== null);
    const perdida = comValor.reduce((a, x) => a + x.v, 0);
    set('ch-kpi-receita', comValor.length ? formatMoneyCurto(perdida) : '—');
    const semValorQtd = saidas.length - comValor.length;
    set('ch-kpi-receita-sub', !saidas.length ? '' : semValorQtd
        ? `${semValorQtd} de ${saidas.length} saídas sem mensalidade`
        : `${formatMoneyCurto(perdida * 12)} por ano`);

    // Ranking de motivos
    const porMotivo = {};
    saidas.forEach(s => {
        const k = normalizarMotivo(s.motivo);
        if (!porMotivo[k]) porMotivo[k] = { qtd: 0, valor: 0, lista: [] };
        porMotivo[k].qtd += 1;
        porMotivo[k].valor += getValorSaida(s) || 0;
        porMotivo[k].lista.push(s);
    });
    const ranking = Object.entries(porMotivo).sort((a, b) => b[1].qtd - a[1].qtd || a[0].localeCompare(b[0], 'pt-BR'));
    const max = ranking.length ? ranking[0][1].qtd : 1;
    const abertos = AppState._motivosAbertos || (AppState._motivosAbertos = new Set());
    set('ch-motivos', ranking.length ? ranking.map(([nome, d], i) => {
        const clientes = d.lista.slice().sort((x, y) => String(y.dataSaida || '').localeCompare(String(x.dataSaida || '')));
        const aberto = abertos.has(nome);
        return `
        <div class="ch-motivo-wrap ${aberto ? 'aberto' : ''}">
            <button type="button" class="ch-motivo" data-motivo="${escHtml(nome)}" aria-expanded="${aberto}">
                <span class="ch-pos ${i === 0 ? 'top' : ''}">${i + 1}º</span>
                <div class="ch-motivo-body">
                    <div class="ch-motivo-top">
                        <span class="ch-motivo-nome">${escHtml(nome)}</span>
                        <span class="ch-motivo-qtd">${d.qtd} ${d.qtd === 1 ? 'saída' : 'saídas'} · ${formatPct((d.qtd / saidas.length) * 100, 0)}${d.valor ? ` · <b>${formatBRL(d.valor)}/mês</b>` : ''}</span>
                    </div>
                    <div class="ch-motivo-bar"><i style="width:${(d.qtd / max) * 100}%"></i></div>
                </div>
                <svg class="ch-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <div class="ch-clientes">
                ${clientes.map(c => `
                    <div class="ch-cliente">
                        <span class="ch-cliente-nome">${escHtml(c.nome)}</span>
                        <span class="ch-cliente-motivo">${escHtml(c.motivo || '')}</span>
                        <span class="ch-cliente-valor">${getValorSaida(c) !== null ? formatBRL(getValorSaida(c)) : '<i>sem valor</i>'}</span>
                        <span class="ch-cliente-data">${c.dataSaida ? formatDateBR(c.dataSaida) : (c.mesSaida || '—')}</span>
                    </div>`).join('')}
            </div>
        </div>`;
    }).join('') : `<div class="home-empty">Nenhuma saída registrada em ${ano}.</div>`, true);

    document.querySelectorAll('#ch-motivos .ch-motivo').forEach(btn => {
        btn.onclick = () => {
            const nome = btn.dataset.motivo;
            const wrap = btn.parentElement;
            const abrir = !wrap.classList.contains('aberto');
            wrap.classList.toggle('aberto', abrir);
            btn.setAttribute('aria-expanded', String(abrir));
            if (abrir) abertos.add(nome); else abertos.delete(nome);
        };
    });

    // Tempo de casa por faixa
    const faixas = [
        { nome: 'Até 6 meses', min: 1, max: 6 },
        { nome: '7 a 12 meses', min: 7, max: 12 },
        { nome: '13 a 24 meses', min: 13, max: 24 },
        { nome: 'Mais de 2 anos', min: 25, max: Infinity }
    ].map(f => ({ ...f, qtd: tempos.filter(t => t >= f.min && t <= f.max).length }));
    const semTempo = saidas.length - tempos.length;
    const maxF = Math.max(1, ...faixas.map(f => f.qtd));
    set('ch-tempo', (tempos.length ? faixas.map(f => `
        <div class="home-seg">
            <span class="home-seg-name">${f.nome}</span>
            <span class="home-seg-bar ch-blue"><i style="width:${(f.qtd / maxF) * 100}%"></i></span>
            <span class="home-seg-qtd">${f.qtd}</span>
        </div>`).join('') : '<div class="home-empty">Sem tempo de casa informado.</div>')
        + (semTempo > 0 ? `<div class="ch-note">${semTempo} ${semTempo === 1 ? 'saída sem' : 'saídas sem'} data de entrada (não entram no cálculo).</div>` : ''), true);


}

/* ==========================================================================
   METAS POR ANO (editáveis na aba Metas; salvas no navegador e no Firebase)
   Ano sem meta definida usa a do ano anterior mais próximo.
   ========================================================================== */
const STORAGE_KEY_METAS = 'lift_comercial_metas';
const CAMPOS_META = { clientesMes: 10, churnMes: 2, receitaMes: null };

function metasPadrao() {
    const porAno = {};
    Object.entries(typeof META_CLIENTES_MES_POR_ANO !== 'undefined' ? META_CLIENTES_MES_POR_ANO : {}).forEach(([a, v]) => {
        porAno[a] = { clientesMes: v, churnMes: typeof META_CHURN_MES !== 'undefined' ? META_CHURN_MES : 2 };
    });
    return { porAno };
}

function carregarMetas() {
    try {
        const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY_METAS));
        if (salvo && salvo.porAno) { AppState.metas = salvo; return; }
    } catch (e) { /* usa o padrão */ }
    AppState.metas = metasPadrao();
}

function salvarMetas() {
    try { localStorage.setItem(STORAGE_KEY_METAS, JSON.stringify(AppState.metas)); } catch (e) { /* ignora */ }
    saveStorage();
}

// Valor da meta do ano; se o ano não tiver, usa o ano anterior mais próximo
function getMetaInfo(ano, campo) {
    if (!AppState.metas) carregarMetas();
    const porAno = AppState.metas.porAno || {};
    const definido = (a) => porAno[a] && porAno[a][campo] !== undefined && porAno[a][campo] !== null && porAno[a][campo] !== '';
    if (definido(ano)) return { valor: Number(porAno[ano][campo]), origem: ano, herdada: false };
    const anos = Object.keys(porAno).map(Number).filter(a => definido(a));
    // Só herda de anos anteriores (um ano passado nunca copia a meta de um ano futuro)
    const de = anos.filter(a => a < ano).sort((a, b) => b - a)[0];
    if (de !== undefined) return { valor: Number(porAno[de][campo]), origem: de, herdada: true };
    return { valor: CAMPOS_META[campo], origem: null, herdada: true };
}
function getMetaClientesMes(ano) { return getMetaInfo(ano, 'clientesMes').valor || 10; }
function getMetaChurnMes(ano) { const v = getMetaInfo(ano, 'churnMes').valor; return v === null || isNaN(v) ? 2 : v; }
function getMetaReceitaMes(ano) { const v = getMetaInfo(ano, 'receitaMes').valor; return v === null || isNaN(v) ? null : v; }

// Recebe as metas do banco de dados (firebase-sync.js)
window.aplicarMetasDaNuvem = function (metas) {
    if (!metas || !metas.porAno) return;
    if (JSON.stringify(metas) === JSON.stringify(AppState.metas)) return;
    AppState.metas = metas;
    try { localStorage.setItem(STORAGE_KEY_METAS, JSON.stringify(metas)); } catch (e) { /* ignora */ }
    renderAll();
};

function renderMetasView() {
    const box = document.getElementById('metas-rows');
    if (!box) return;
    const anoAtual = new Date().getFullYear();
    const anos = [];
    for (let a = 2024; a <= ANO_MAXIMO_SELECAO; a++) anos.push(a);
    const campo = (ano, nome, tipo) => {
        const info = getMetaInfo(ano, nome);
        const proprio = !info.herdada;
        let valor = '', dica = '';
        const fmt = (v) => tipo === 'dinheiro' ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(v);
        if (proprio) valor = fmt(info.valor);
        else if (info.valor !== null && !isNaN(info.valor)) dica = fmt(info.valor);
        return `<span class="meta-input-wrap">${tipo === 'dinheiro' ? '<span class="meta-prefixo">R$</span>' : ''}<input type="text" inputmode="decimal" class="meta-input ${proprio ? '' : 'herdada'}"
                    data-ano="${ano}" data-campo="${nome}" data-tipo="${tipo}" value="${valor}" placeholder="${dica || '—'}"
                    title="${proprio ? '' : (info.origem ? 'Usando a meta de ' + info.origem + ' (digite para definir uma meta própria)' : 'Sem meta definida')}"></span>`;
    };
    box.innerHTML = anos.map(ano => {
        const cli = getMetaClientesMes(ano);
        const rec = getMetaReceitaMes(ano);
        const herdou = ['clientesMes', 'churnMes', 'receitaMes'].every(c => getMetaInfo(ano, c).herdada);
        const origem = getMetaInfo(ano, 'clientesMes').origem;
        return `
            <div class="opp-row meta-row ${ano === anoAtual ? 'atual' : ''}">
                <span class="opp-mes">${ano}${ano === anoAtual ? ' <span class="meta-badge">atual</span>' : ''}${herdou && origem ? `<small class="meta-herdada">usa as metas de ${origem}</small>` : ''}</span>
                <span class="center">${campo(ano, 'clientesMes', 'inteiro')}</span>
                <span class="center meta-calc">${cli * 12}</span>
                <span class="center">${campo(ano, 'churnMes', 'inteiro')}</span>
                <span class="center">${campo(ano, 'receitaMes', 'dinheiro')}</span>
                <span class="center meta-calc">${rec ? formatBRL(rec * 12) : '—'}</span>
            </div>`;
    }).join('');
}

function setupMetasInputs() {
    const box = document.getElementById('metas-rows');
    if (!box || box._bound) return;
    box._bound = true;
    box.addEventListener('change', (e) => {
        const inp = e.target;
        if (!inp.classList.contains('meta-input')) return;
        const ano = inp.dataset.ano, nome = inp.dataset.campo, tipo = inp.dataset.tipo;
        const texto = inp.value.trim();
        if (!AppState.metas) carregarMetas();
        const porAno = AppState.metas.porAno;
        if (!texto) {
            if (porAno[ano]) { delete porAno[ano][nome]; if (!Object.keys(porAno[ano]).length) delete porAno[ano]; }
        } else {
            let v = tipo === 'dinheiro' ? parseValorBR(texto) : parseInt(texto.replace(/\D/g, ''), 10);
            if (isNaN(v) || v < 0 || (nome === 'clientesMes' && v === 0)) {
                inp.classList.add('erro');
                showToast(nome === 'clientesMes' ? 'A meta de clientes precisa ser um número maior que zero.' : 'Valor inválido.');
                return;
            }
            if (!porAno[ano]) porAno[ano] = {};
            porAno[ano][nome] = v;
        }
        salvarMetas();
        renderMetasView();
        renderAll();
        showToast(`Meta de ${ano} atualizada.`);
    });
    box.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('meta-input') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    box.addEventListener('focusin', (e) => { if (e.target.classList.contains('meta-input')) e.target.select(); });
}

/* ==========================================================================
   ANÁLISE POR ORIGEM — clientes, receita, ticket médio e saídas por canal
   ========================================================================== */
function calcularOrigens(ano) {
    const clientes = AppState.clientes.filter(c => Number(c.ano) === ano);
    const grupos = {};
    clientes.forEach(c => {
        const k = (c.origemCliente || '').trim() || 'Sem origem informada';
        if (!grupos[k]) grupos[k] = { nome: k, clientes: 0, comValor: 0, receita: 0, sairam: 0, semOrigem: !(c.origemCliente || '').trim() };
        const g = grupos[k];
        g.clientes += 1;
        if (temValor(c.valorMensal)) { g.comValor += 1; g.receita += Number(c.valorMensal); }
        if (c.status === 'Cancelado') g.sairam += 1;
    });
    const lista = Object.values(grupos).map(g => ({
        ...g,
        ticket: g.comValor ? g.receita / g.comValor : null,
        taxaSaida: g.clientes ? (g.sairam / g.clientes) * 100 : 0
    }));
    return { total: clientes.length, lista };
}

function renderOrigensView() {
    const ano = AppState.selectedYearOrigens || new Date().getFullYear();
    if (!document.getElementById('panel-origens')) return;
    renderYearDropdown('origens');
    const set = (id, v, html = false) => { const el = document.getElementById(id); if (el) el[html ? 'innerHTML' : 'textContent'] = v; };
    const { total, lista } = calcularOrigens(ano);
    const comOrigem = lista.filter(g => !g.semOrigem);
    const melhor = (fn) => comOrigem.slice().sort(fn)[0];

    const topCli = melhor((a, b) => b.clientes - a.clientes);
    const topRec = melhor((a, b) => b.receita - a.receita);
    const topTicket = comOrigem.filter(g => g.ticket !== null).sort((a, b) => b.ticket - a.ticket)[0];
    const topSaida = comOrigem.filter(g => g.sairam > 0).sort((a, b) => b.taxaSaida - a.taxaSaida || b.sairam - a.sairam)[0];
    set('or-kpi-clientes', topCli ? topCli.nome : '—');
    set('or-kpi-clientes-sub', topCli ? `${topCli.clientes} ${topCli.clientes === 1 ? 'cliente' : 'clientes'}` : 'nenhuma origem informada');
    set('or-kpi-receita', topRec && topRec.receita ? topRec.nome : '—');
    set('or-kpi-receita-sub', topRec && topRec.receita ? `${formatBRL(topRec.receita)}/mês` : '');
    set('or-kpi-ticket', topTicket ? topTicket.nome : '—');
    set('or-kpi-ticket-sub', topTicket ? `${formatBRL(topTicket.ticket)} de ticket médio` : '');
    set('or-kpi-saida', topSaida ? topSaida.nome : '—');
    set('or-kpi-saida-sub', topSaida ? `${topSaida.sairam} de ${topSaida.clientes} saíram (${formatPct(topSaida.taxaSaida, 0)})` : 'nenhuma saída de clientes com origem');
    set('or-titulo', `CLIENTES POR ORIGEM — ${ano}`);

    const semOrigem = lista.find(g => g.semOrigem);
    set('or-aviso', semOrigem && total
        ? `${semOrigem.clientes} de ${total} clientes de ${ano} estão sem origem informada. Preencha pelo ✏️ na aba Clientes para a análise ficar completa.`
        : '');

    const ordenada = lista.sort((a, b) => (a.semOrigem - b.semOrigem) || (b.clientes - a.clientes) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const maxCli = Math.max(1, ...ordenada.map(g => g.clientes));
    set('or-rows', ordenada.length ? ordenada.map(g => `
        <button type="button" class="opp-row or-row ${g.semOrigem ? 'sem' : ''}" data-origem="${g.semOrigem ? '__vazio__' : escHtml(g.nome)}" title="Ver estes clientes na aba Clientes">
            <span class="or-nome">${escHtml(g.nome)}</span>
            <span class="or-barra-cell"><span class="or-barra"><i style="width:${(g.clientes / maxCli) * 100}%"></i></span><b>${g.clientes}</b><small>${formatPct((g.clientes / total) * 100, 0)}</small></span>
            <span class="right">${g.receita ? formatBRL(g.receita) : '—'}</span>
            <span class="right">${g.ticket !== null ? formatBRL(g.ticket) : '—'}</span>
        </button>`).join('') : `<div class="home-empty">Nenhum cliente cadastrado em ${ano}.</div>`, true);

    renderIndicacoes(ano);

    document.querySelectorAll('#or-rows .or-row').forEach(btn => btn.onclick = () => {
        AppState.selectedYearClientes = ano;
        AppState.filterMesClientes = '';
        AppState.filterSegmento = '';
        AppState.filterOrigem = btn.dataset.origem;
        AppState.activeClientesTab = 'fechados';
        const selMes = document.getElementById('filter-mes-select');
        if (selMes) selMes.value = '';
        switchView('clientes');
    });
}

/* ==========================================================================
   INDICAÇÕES — quem indicou clientes que fecharam
   ========================================================================== */
const ehIndicacao = (origem) => /indica/i.test(String(origem || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

function atualizarCampoIndicador(pre) {
    const grupo = document.getElementById(pre + '-indicador-grupo');
    const input = document.getElementById(pre + '-indicador');
    if (!grupo || !input) return;
    const mostrar = ehIndicacao(document.getElementById(pre + '-origem').value);
    grupo.classList.toggle('oculto', !mostrar);
    input.required = mostrar;
    if (mostrar) {
        const dl = document.getElementById('lista-clientes-nomes');
        if (dl) {
            const nomes = new Map();
            AppState.clientes.forEach(c => { const n = (c.nome || '').trim(); if (n) nomes.set(n.toLocaleLowerCase('pt-BR'), n); });
            AppState.clientes.forEach(c => { const n = (c.indicadoPor || '').trim(); if (n && !nomes.has(n.toLocaleLowerCase('pt-BR'))) nomes.set(n.toLocaleLowerCase('pt-BR'), n); });
            dl.innerHTML = [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(n => `<option value="${escHtml(n)}"></option>`).join('');
        }
    }
}

// Lê o "Quem indicou?": '' se não for indicação; false se faltar o nome
function lerIndicador(pre, idProprio) {
    if (!ehIndicacao(document.getElementById(pre + '-origem').value)) return '';
    const v = document.getElementById(pre + '-indicador').value.trim().replace(/\s+/g, ' ');
    if (!v) { alert('Informe o nome do cliente que fez a indicação.'); return false; }
    const chave = v.toLocaleLowerCase('pt-BR');
    // Usa a grafia já cadastrada (cliente ou indicador anterior) para somar certo no ranking
    const cad = AppState.clientes.find(c => c.id !== idProprio && (c.nome || '').trim().toLocaleLowerCase('pt-BR') === chave);
    if (cad) return cad.nome.trim();
    const ant = AppState.clientes.find(c => c.id !== idProprio && (c.indicadoPor || '').trim().toLocaleLowerCase('pt-BR') === chave);
    return ant ? ant.indicadoPor.trim() : v;
}

function calcularIndicacoes(ano) {
    const todos = AppState.indicacoesEscopo === 'todos';
    const base = AppState.clientes.filter(c => todos || Number(c.ano) === ano);
    const grupos = new Map();
    base.forEach(c => {
        const nome = (c.indicadoPor || '').trim();
        if (!nome) return;
        const k = nome.toLocaleLowerCase('pt-BR');
        if (!grupos.has(k)) grupos.set(k, { nome, clientes: [], receita: 0, sairam: 0 });
        const g = grupos.get(k);
        g.clientes.push(c);
        if (temValor(c.valorMensal) && c.status !== 'Cancelado') g.receita += Number(c.valorMensal);
        if (c.status === 'Cancelado') g.sairam += 1;
    });
    const lista = [...grupos.values()].sort((a, b) => b.clientes.length - a.clientes.length || b.receita - a.receita || a.nome.localeCompare(b.nome, 'pt-BR'));
    const semNome = base.filter(c => ehIndicacao(c.origemCliente) && !(c.indicadoPor || '').trim()).length;
    return { lista, semNome, todos };
}

function renderIndicacoes(ano) {
    const box = document.getElementById('ind-rows');
    if (!box) return;
    const { lista, semNome, todos } = calcularIndicacoes(ano);
    document.querySelectorAll('#ind-escopo button').forEach(b => b.classList.toggle('active', b.dataset.escopo === (todos ? 'todos' : 'ano')));
    const titulo = document.getElementById('ind-titulo');
    if (titulo) titulo.textContent = `QUEM MAIS INDICOU — ${todos ? 'TODOS OS ANOS' : ano}`;
    const max = Math.max(1, ...lista.map(g => g.clientes.length));
    if (!AppState._indAbertos) AppState._indAbertos = new Set();
    const abertos = AppState._indAbertos;
    box.innerHTML = lista.length ? lista.map((g, i) => {
        const nomes = g.clientes.slice().sort((a, b) => String(b.dataEntrada).localeCompare(String(a.dataEntrada)));
        const chave = g.nome.toLocaleLowerCase('pt-BR');
        const aberto = abertos.has(chave);
        return `
        <button type="button" class="opp-row ind-row ${aberto ? 'aberto' : ''}" data-ind="${escHtml(chave)}" title="Ver os clientes indicados">
            <span class="ind-pos ${i < 3 ? 'top' : ''}">${i + 1}º</span>
            <span class="or-nome"><span class="ind-seta">›</span>${escHtml(g.nome)}</span>
            <span class="or-barra-cell"><span class="or-barra"><i style="width:${(g.clientes.length / max) * 100}%"></i></span><b>${g.clientes.length}</b></span>
            <span class="right">${g.receita ? formatBRL(g.receita) : '—'}</span>
        </button>
        ${aberto ? `<div class="ind-clientes">${nomes.map(c => `<span class="${c.status === 'Cancelado' ? 'saiu' : ''}">${escHtml(c.nome)}${c.mesEntrada ? ` <small>${escHtml(c.mesEntrada)}</small>` : ''}${c.status === 'Cancelado' ? ' <small>· saiu</small>' : ''}</span>`).join('')}</div>` : ''}`;
    }).join('') : `<div class="home-empty">Nenhuma indicação com o nome de quem indicou ${todos ? 'ainda' : 'em ' + ano}. Ao cadastrar um cliente com origem <b>Indicação</b>, informe quem indicou.</div>`;
    box.querySelectorAll('.ind-row[data-ind]').forEach(btn => btn.onclick = () => {
        const k = btn.dataset.ind;
        if (abertos.has(k)) abertos.delete(k); else abertos.add(k);
        renderIndicacoes(ano);
    });
    const aviso = document.getElementById('ind-aviso');
    if (aviso) aviso.textContent = semNome
        ? `${semNome} ${semNome === 1 ? 'cliente com origem Indicação está' : 'clientes com origem Indicação estão'} sem o nome de quem indicou. Preencha pelo ✏️ na aba Clientes para entrar no ranking.`
        : '';
}

/* ==========================================================================
   6. OPERAÇÕES DE CLIENTES (CRUD E AÇÕES)
   ========================================================================== */
function setupModals() {
    // Abrir Modal Novo Cliente
    const btnNovoCliente = document.getElementById('btn-open-novo-cliente');
    const btnNovoClienteTop = document.getElementById('btn-top-novo-cliente');
    const modalNovoCliente = document.getElementById('modal-novo-cliente');
    const closeBtns = document.querySelectorAll('.modal-close-btn, .btn-modal-cancel');

    if (btnNovoCliente) {
        btnNovoCliente.addEventListener('click', () => openNovoClienteModal());
    }
    if (btnNovoClienteTop) {
        btnNovoClienteTop.addEventListener('click', () => openNovoClienteModal());
    }

    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
        });
    });

    // Form Submits
    const formNovoCliente = document.getElementById('form-novo-cliente');
    if (formNovoCliente) {
        formNovoCliente.addEventListener('submit', (e) => {
            e.preventDefault();
            handleNovoClienteSubmit();
        });
    }

    const formEditarCliente = document.getElementById('form-editar-cliente');
    if (formEditarCliente) {
        formEditarCliente.addEventListener('submit', (e) => {
            e.preventDefault();
            handleEditClienteSubmit();
        });
    }

    // Campo "Quem indicou?" só aparece quando a origem é Indicação
    ['input-cliente', 'edit-cliente'].forEach(pre => {
        const origem = document.getElementById(pre + '-origem');
        if (origem) ['input', 'change'].forEach(ev => origem.addEventListener(ev, () => atualizarCampoIndicador(pre)));
    });
    document.querySelectorAll('#ind-escopo button').forEach(b => b.addEventListener('click', () => {
        AppState.indicacoesEscopo = b.dataset.escopo;
        renderOrigensView();
    }));

    // Nova Saída (botão na aba Clientes)
    const btnNovaSaida = document.getElementById('btn-open-nova-saida');
    if (btnNovaSaida) btnNovaSaida.addEventListener('click', () => openNovaSaidaModal());
    const formNovaSaida = document.getElementById('form-nova-saida');
    if (formNovaSaida) {
        formNovaSaida.addEventListener('submit', (e) => {
            e.preventDefault();
            const idEdicao = document.getElementById('ns-id').value;
            if (idEdicao) handleEditarSaidaSubmit(idEdicao); else handleNovaSaidaSubmit();
        });
    }

    const formRegistrarSaida = document.getElementById('form-registrar-saida');
    if (formRegistrarSaida) {
        formRegistrarSaida.addEventListener('submit', (e) => {
            e.preventDefault();
            handleRegistrarSaidaSubmit();
        });
    }
}

/* ---------- Valor da mensalidade: aceita qualquer número (697 / 697,50 / 1.234,56) ---------- */
function temValor(v) {
    return v !== undefined && v !== null && v !== '' && !isNaN(Number(v));
}

function parseValorBR(texto) {
    let v = String(texto || '').replace(/R\$|\s/g, '');
    if (!v) return NaN;
    if (v.includes(',')) {
        v = v.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(v)) {
        v = v.replace(/\./g, '');
    }
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : NaN;
}

function formatValorInput(n) {
    const num = Number(n) || 0;
    return Number.isInteger(num) ? String(num) : num.toFixed(2).replace('.', ',');
}

function openNovoClienteModal() {
    document.getElementById('input-cliente-contrato').value = '';
    document.getElementById('input-cliente-nome').value = '';
    renderListasSegmentos();
    document.getElementById('input-cliente-segmento').value = '';
    document.getElementById('input-cliente-origem').value = '';
    document.getElementById('input-cliente-indicador').value = '';
    preencherListaVendedores({ 'input-cliente-vendedor': '' });
    atualizarCampoIndicador('input-cliente');
    document.getElementById('input-cliente-data').value = new Date().toISOString().split('T')[0];
    document.getElementById('input-cliente-assinado').value = 'Sim';
    document.getElementById('input-cliente-ticket').value = '2500';

    document.getElementById('modal-novo-cliente').classList.add('active');
}

function handleNovoClienteSubmit() {
    const contrato = document.getElementById('input-cliente-contrato').value.trim();
    const nome = document.getElementById('input-cliente-nome').value.trim();
    const segmentoDigitado = document.getElementById('input-cliente-segmento').value.trim();
    const dataEntrada = document.getElementById('input-cliente-data').value;
    const assinado = document.getElementById('input-cliente-assinado').value;
    const ticket = parseValorBR(document.getElementById('input-cliente-ticket').value);

    if (!nome) {
        alert('Por favor, informe o nome ou razão social do cliente.');
        return;
    }

    if (!segmentoDigitado) {
        alert('Por favor, informe o segmento do cliente.');
        return;
    }
    if (isNaN(ticket)) {
        alert('Por favor, informe um valor de mensalidade válido (ex: 697 ou 697,50).');
        return;
    }
    const indicadoPor = lerIndicador('input-cliente');
    if (indicadoPor === false) return;
    const segmento = registrarSegmento(segmentoDigitado);

    const dateParts = dataEntrada.split('-');
    const ano = parseInt(dateParts[0]);
    const mes = dateParts[1];
    const mesEntrada = `${mes}/${ano}`;

    const novoCliente = {
        id: 'cli-' + Date.now(),
        contrato: contrato,
        nome: nome,
        segmento: segmento,
        origemCliente: normalizarOrigem(document.getElementById('input-cliente-origem').value),
        mesEntrada: mesEntrada,
        dataEntrada: dataEntrada,
        assinado: assinado,
        valorMensal: ticket,
        ano: ano,
        status: 'Ativo'
    };
    if (indicadoPor) novoCliente.indicadoPor = indicadoPor;
    const vendedorNovo = lerVendedor('input-cliente');
    if (vendedorNovo) novoCliente.vendedor = vendedorNovo;

    AppState.clientes.unshift(novoCliente);
    saveStorage();
    document.getElementById('modal-novo-cliente').classList.remove('active');
    
    showToast(`Cliente ${nome} adicionado com sucesso!`);
    renderAll();
}

function openEditClienteModal(clienteId) {
    const cliente = AppState.clientes.find(c => c.id === clienteId);
    if (!cliente) return;

    document.getElementById('edit-cliente-id').value = cliente.id;
    document.getElementById('edit-cliente-contrato').value = cliente.contrato || '';
    document.getElementById('edit-cliente-nome').value = cliente.nome;
    renderListasSegmentos();
    document.getElementById('edit-cliente-segmento').value = cliente.segmento || '';
    document.getElementById('edit-cliente-origem').value = cliente.origemCliente || '';
    document.getElementById('edit-cliente-indicador').value = cliente.indicadoPor || '';
    preencherListaVendedores({ 'edit-cliente-vendedor': cliente.vendedor || '' });
    atualizarCampoIndicador('edit-cliente');
    document.getElementById('edit-cliente-data').value = cliente.dataEntrada;
    document.getElementById('edit-cliente-assinado').value = cliente.assinado || '';
    document.getElementById('edit-cliente-ticket').value = temValor(cliente.valorMensal) ? formatValorInput(cliente.valorMensal) : '';

    document.getElementById('modal-editar-cliente').classList.add('active');
}

function handleEditClienteSubmit() {
    const clienteId = document.getElementById('edit-cliente-id').value;
    const cliente = AppState.clientes.find(c => c.id === clienteId);
    if (!cliente) return;

    const valorTexto = document.getElementById('edit-cliente-ticket').value.trim();
    const valorEditado = valorTexto ? parseValorBR(valorTexto) : null;
    if (valorTexto && isNaN(valorEditado)) {
        alert('Por favor, informe um valor de mensalidade válido (ex: 697 ou 697,50).');
        return;
    }

    const indicadoPor = lerIndicador('edit-cliente', cliente.id);
    if (indicadoPor === false) return;

    const dataEntrada = document.getElementById('edit-cliente-data').value;
    const dateParts = dataEntrada.split('-');
    const ano = parseInt(dateParts[0]);
    const mes = dateParts[1];

    cliente.contrato = document.getElementById('edit-cliente-contrato').value.trim();
    cliente.nome = document.getElementById('edit-cliente-nome').value.trim();
    const segmentoEditado = document.getElementById('edit-cliente-segmento').value.trim();
    cliente.segmento = segmentoEditado ? registrarSegmento(segmentoEditado) : '';
    cliente.origemCliente = normalizarOrigem(document.getElementById('edit-cliente-origem').value);
    if (indicadoPor) cliente.indicadoPor = indicadoPor; else delete cliente.indicadoPor;
    const vendedorEd = lerVendedor('edit-cliente');
    if (vendedorEd) cliente.vendedor = vendedorEd; else delete cliente.vendedor;
    cliente.dataEntrada = dataEntrada;
    cliente.mesEntrada = `${mes}/${ano}`;
    cliente.ano = ano;
    cliente.assinado = document.getElementById('edit-cliente-assinado').value;
    if (valorEditado === null) delete cliente.valorMensal; else cliente.valorMensal = valorEditado;

    saveStorage();
    document.getElementById('modal-editar-cliente').classList.remove('active');

    showToast(`Dados do cliente ${cliente.nome} atualizados com sucesso!`);
    renderAll();
}

/* ---------- Nova Saída: registra saída de qualquer cliente ---------- */
const MOTIVOS_SAIDA_PADRAO = [
    'Inadimplência', 'Preço da mensalidade', 'Troca de contador', 'Baixa da empresa',
    'Encerramento de atividades', 'Redução de custos', 'Sem movimento', 'Razões particulares', 'Outro motivo'
];

function getClientesAtivos() {
    return AppState.clientes.filter(c => c.status !== 'Cancelado');
}

function openNovaSaidaModal() {
    document.getElementById('ns-id').value = '';
    document.getElementById('ns-titulo').textContent = 'Registrar Nova Saída';
    document.getElementById('ns-botao').textContent = 'Salvar Saída';
    preencherMotivosSaida();
    ['ns-nome', 'ns-aviso', 'ns-motivo', 'ns-valor'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('ns-saida').value = new Date().toISOString().split('T')[0];
    document.getElementById('modal-nova-saida').classList.add('active');
    setTimeout(() => document.getElementById('ns-nome').focus(), 50);
}

// Editar uma saída já registrada (abre a mesma janela da Nova Saída, preenchida)
function openEditarSaidaModal(saidaId) {
    const s = AppState.saidas.find(x => String(x.id) === String(saidaId));
    if (!s) return;
    preencherMotivosSaida();
    document.getElementById('ns-id').value = s.id;
    document.getElementById('ns-titulo').textContent = 'Editar Saída';
    document.getElementById('ns-botao').textContent = 'Salvar Alterações';
    document.getElementById('ns-nome').value = s.nome || '';
    const av = String(s.dataAviso || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    document.getElementById('ns-aviso').value = av ? `${av[3]}-${av[2]}-${av[1]}` : (/^\d{4}-\d{2}-\d{2}$/.test(s.dataAviso || '') ? s.dataAviso : '');
    document.getElementById('ns-saida').value = s.dataSaida || '';
    document.getElementById('ns-motivo').value = s.motivo || '';
    document.getElementById('ns-valor').value = temValor(s.valorMensal) ? formatValorInput(s.valorMensal) : '';
    document.getElementById('modal-nova-saida').classList.add('active');
    setTimeout(() => document.getElementById('ns-nome').focus(), 50);
}

function handleEditarSaidaSubmit(saidaId) {
    const s = AppState.saidas.find(x => String(x.id) === String(saidaId));
    if (!s) return;
    const nome = document.getElementById('ns-nome').value.trim();
    const dataSaida = document.getElementById('ns-saida').value;
    const motivo = document.getElementById('ns-motivo').value.trim();
    if (!nome || !dataSaida || !motivo) {
        alert('Preencha o cliente, a data da saída e o motivo.');
        return;
    }
    const valorTxt = document.getElementById('ns-valor').value.trim();
    const valor = valorTxt ? parseValorBR(valorTxt) : null;
    if (valorTxt && isNaN(valor)) {
        alert('Valor da mensalidade inválido. Use por exemplo 697 ou 697,50.');
        return;
    }
    const aviso = document.getElementById('ns-aviso').value;
    const [aS, mS] = dataSaida.split('-');
    s.nome = nome;
    s.dataAviso = aviso ? formatDateBR(aviso) : 'N/D';
    s.dataSaida = dataSaida;
    s.mesSaida = `${mS}/${aS}`;
    s.ano = parseInt(aS, 10);
    s.motivo = motivo;
    if (valor === null) delete s.valorMensal; else s.valorMensal = valor;
    // Mantém o cliente ligado a esta saída com o mês de saída atualizado
    const cliente = AppState.clientes.find(c => (s.clienteId && c.id === s.clienteId) || (c.saidaId && c.saidaId === s.id));
    if (cliente) {
        cliente.mesSaida = s.mesSaida;
        if (cliente.dataEntrada) s.mesesAtivos = Math.max(1, Math.round((new Date(dataSaida) - new Date(cliente.dataEntrada)) / (1000 * 60 * 60 * 24 * 30.4)));
    }
    saveStorage();
    document.getElementById('modal-nova-saida').classList.remove('active');
    AppState.selectedYearClientes = s.ano;
    AppState.activeClientesTab = 'saidas';
    showToast(`Saída de ${s.nome} atualizada.`);
    renderAll();
}

function preencherMotivosSaida() {
    const motivos = new Map();
    [...MOTIVOS_SAIDA_PADRAO, ...AppState.saidas.map(s => s.motivo)].forEach(m => {
        const v = (m || '').trim();
        if (v && !motivos.has(v.toLowerCase())) motivos.set(v.toLowerCase(), v);
    });
    const dlMotivos = document.getElementById('lista-motivos-saida');
    if (dlMotivos) dlMotivos.innerHTML = [...motivos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(m => `<option value="${m}"></option>`).join('');
}

function encontrarClienteAtivoPorNome(nome) {
    const v = (nome || '').trim().toLocaleLowerCase('pt-BR');
    if (!v) return null;
    return getClientesAtivos().find(c => c.nome.trim().toLocaleLowerCase('pt-BR') === v) || null;
}

function handleNovaSaidaSubmit() {
    const nome = document.getElementById('ns-nome').value.trim();
    const dataSaida = document.getElementById('ns-saida').value;
    const motivo = document.getElementById('ns-motivo').value.trim();
    if (!nome || !dataSaida || !motivo) {
        alert('Preencha o cliente, a data da saída e o motivo.');
        return;
    }

    const valorTxt = document.getElementById('ns-valor').value.trim();
    const valorInformado = valorTxt ? parseValorBR(valorTxt) : null;
    if (valorTxt && isNaN(valorInformado)) {
        alert('Valor da mensalidade inválido. Use por exemplo 697 ou 697,50.');
        return;
    }

    // Se o nome for de um cliente ativo cadastrado no portal, a saída fica ligada a ele
    const cliente = encontrarClienteAtivoPorNome(nome);
    const dataAvisoRaw = document.getElementById('ns-aviso').value;
    const [aS, mS] = dataSaida.split('-');
    const mesSaida = `${mS}/${aS}`;
    const mesesAtivos = cliente && cliente.dataEntrada
        ? Math.max(1, Math.round((new Date(dataSaida) - new Date(cliente.dataEntrada)) / (1000 * 60 * 60 * 24 * 30.4)))
        : 0;

    const registro = {
        id: 'sai-' + Date.now(),
        contrato: cliente ? cliente.contrato : '',
        nome: cliente ? cliente.nome : nome,
        segmento: cliente ? cliente.segmento : '',
        dataEntrada: cliente ? cliente.dataEntrada : undefined,
        dataAviso: dataAvisoRaw ? formatDateBR(dataAvisoRaw) : 'N/D',
        mesSaida,
        dataSaida,
        motivo,
        mesesAtivos,
        ano: parseInt(aS, 10)
    };

    if (cliente) {
        registro.clienteId = cliente.id;
        registro.mesEntrada = cliente.mesEntrada;
        registro.valorMensal = cliente.valorMensal;
        registro.assinado = cliente.assinado;
        cliente.status = 'Cancelado';
        cliente.saidaId = registro.id;
        cliente.mesSaida = mesSaida;
    }

    if (valorInformado !== null) registro.valorMensal = valorInformado;

    AppState.saidas.unshift(registro);
    saveStorage();
    document.getElementById('modal-nova-saida').classList.remove('active');

    // Mostra a saída na aba de Saídas do ano correspondente
    AppState.selectedYearClientes = registro.ano;
    AppState.activeClientesTab = 'saidas';
    showToast(`Saída de ${registro.nome} registrada em ${mesSaida}.`);
    renderAll();
}

function openRegistrarSaidaModal(clienteId) {
    const cliente = AppState.clientes.find(c => c.id === clienteId);
    if (!cliente) return;

    document.getElementById('saida-cliente-id').value = cliente.id;
    document.getElementById('saida-cliente-info').textContent = `${cliente.contrato} - ${cliente.nome}`;
    document.getElementById('input-saida-aviso').value = new Date().toISOString().split('T')[0];
    document.getElementById('input-saida-data').value = new Date().toISOString().split('T')[0];
    document.getElementById('input-saida-motivo').value = 'Redução de custos';

    document.getElementById('modal-registrar-saida').classList.add('active');
}

function handleRegistrarSaidaSubmit() {
    const clienteId = document.getElementById('saida-cliente-id').value;
    const dataAvisoRaw = document.getElementById('input-saida-aviso').value;
    const dataSaida = document.getElementById('input-saida-data').value;
    const motivo = document.getElementById('input-saida-motivo').value;

    const clienteIndex = AppState.clientes.findIndex(c => c.id === clienteId);
    if (clienteIndex === -1) return;

    const cliente = AppState.clientes[clienteIndex];

    if (!dataSaida) {
        alert('Por favor, informe a data da saída.');
        return;
    }
    if (cliente.status === 'Cancelado') {
        alert(`A saída do cliente ${cliente.nome} já foi registrada.`);
        return;
    }

    const dateParts = dataSaida.split('-');
    const anoSaida = parseInt(dateParts[0]);
    const mesSaida = `${dateParts[1]}/${anoSaida}`;

    // Calcula meses ativos
    const dEntrada = new Date(cliente.dataEntrada);
    const dSaida = new Date(dataSaida);
    const mesesAtivos = Math.max(1, Math.round((dSaida - dEntrada) / (1000 * 60 * 60 * 24 * 30.4)));

    const novoRegistroSaida = {
        id: 'sai-' + Date.now(),
        contrato: cliente.contrato,
        nome: cliente.nome,
        segmento: cliente.segmento,
        dataEntrada: cliente.dataEntrada,
        dataAviso: formatDateBR(dataAvisoRaw),
        mesSaida: mesSaida,
        dataSaida: dataSaida,
        motivo: motivo,
        mesesAtivos: mesesAtivos,
        ano: anoSaida,
        // Dados guardados para uma eventual reativação
        clienteId: cliente.id,
        mesEntrada: cliente.mesEntrada,
        valorMensal: cliente.valorMensal,
        assinado: cliente.assinado
    };

    // O cliente continua na lista de fechados (a entrada dele aconteceu),
    // apenas marcado como Cancelado. A saída vai para a lista de churn.
    cliente.status = 'Cancelado';
    cliente.saidaId = novoRegistroSaida.id;
    cliente.mesSaida = mesSaida;
    AppState.saidas.unshift(novoRegistroSaida);

    saveStorage();
    document.getElementById('modal-registrar-saida').classList.remove('active');

    showToast(`Saída do cliente ${cliente.nome} registrada com sucesso.`);
    renderAll();
}

function getClienteVinculadoSaida(s) {
    return AppState.clientes.find(c => (s.clienteId && c.id === s.clienteId) || c.saidaId === s.id)
        || AppState.clientes.find(c => c.status === 'Cancelado' && c.contrato && c.contrato === s.contrato);
}

function reativarCliente(saidaId) {
    const saidaIndex = AppState.saidas.findIndex(s => s.id === saidaId);
    if (saidaIndex === -1) return;

    const s = AppState.saidas[saidaIndex];
    if (confirm(`Deseja reativar o cliente "${s.nome}" de volta para a carteira ativa?`)) {
        const vinculado = getClienteVinculadoSaida(s);
        if (vinculado) {
            vinculado.status = 'Ativo';
            delete vinculado.saidaId;
            delete vinculado.mesSaida;
        } else if (s.dataEntrada && parseInt(s.dataEntrada.split('-')[0], 10) < ANO_INICIO_CADASTRO_PORTAL) {
            // Cliente antigo (não cadastrado no portal): só desfaz a saída,
            // sem criar uma entrada nova num ano que usa o histórico oficial.
        } else {
            const dataEntrada = s.dataEntrada || new Date().toISOString().split('T')[0];
            const [aE, mE] = dataEntrada.split('-');
            AppState.clientes.push({
                id: 'cli-' + Date.now(),
                contrato: s.contrato,
                nome: s.nome,
                segmento: s.segmento,
                mesEntrada: s.mesEntrada || `${mE}/${aE}`,
                dataEntrada: dataEntrada,
                assinado: s.assinado || 'Sim',
                valorMensal: s.valorMensal ?? 2500,
                ano: parseInt(aE),
                status: 'Ativo'
            });
        }

        AppState.saidas.splice(saidaIndex, 1);
        saveStorage();
        showToast(`Cliente ${s.nome} reativado com sucesso!`);
        renderAll();
    }
}

function confirmDeleteCliente(clienteId) {
    const cliente = AppState.clientes.find(c => c.id === clienteId);
    if (!cliente) return;

    if (confirm(`Atenção: Tem certeza que deseja remover o cliente "${cliente.nome}" do sistema?`)) {
        AppState.clientes = AppState.clientes.filter(c => c.id !== clienteId);
        saveStorage();
        showToast(`Cliente ${cliente.nome} removido.`);
        renderAll();
    }
}

function confirmDeleteSaida(saidaId) {
    if (confirm('Deseja excluir este registro de saída do histórico?')) {
        const registro = AppState.saidas.find(s => s.id === saidaId);
        const vinculado = registro ? getClienteVinculadoSaida(registro) : null;
        if (vinculado) {
            vinculado.status = 'Ativo';
            delete vinculado.saidaId;
            delete vinculado.mesSaida;
        }
        AppState.saidas = AppState.saidas.filter(s => s.id !== saidaId);
        saveStorage();
        showToast('Registro de saída removido.');
        renderAll();
    }
}

/* ==========================================================================
   6. EVENT LISTENERS E CONTROLES DE FILTRO
   ========================================================================== */
function setupEventListeners() {
    // Seletor de Ano nos Clientes (botão com lista de anos)
    setupYearDropdown('clientes');

    // Filtro de Mês nos Clientes
    const filterMesSelect = document.getElementById('filter-mes-select');
    if (filterMesSelect) {
        filterMesSelect.addEventListener('change', (e) => {
            AppState.filterMesClientes = e.target.value;
            renderClientesView();
        });
    }

    // Seletor de Ano nos Dados
    setupYearDropdown('dados');

    // Navegação entre Meses na Visão Geral (Botões ← e → e Seletor)
    const btnPrevMonth = document.getElementById('btn-prev-month');
    if (btnPrevMonth) {
        btnPrevMonth.addEventListener('click', () => navigateMonth(-1));
    }

    const btnNextMonth = document.getElementById('btn-next-month');
    if (btnNextMonth) {
        btnNextMonth.addEventListener('click', () => navigateMonth(1));
    }

    const btnResetMonth = document.getElementById('btn-reset-current-month');
    if (btnResetMonth) {
        btnResetMonth.addEventListener('click', () => {
            const hoje = new Date();
            AppState.selectedMonthOverview = `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
            renderOverview();
        });
    }

    const btnBackups = document.getElementById('btn-abrir-backups');
    if (btnBackups) btnBackups.addEventListener('click', () => abrirBackups());
    const btnExportar = document.getElementById('btn-exportar-dados');
    if (btnExportar) btnExportar.addEventListener('click', () => exportarDados());
    const btnImportar = document.getElementById('btn-importar-dados');
    const inputImportar = document.getElementById('input-importar-dados');
    if (btnImportar && inputImportar) {
        btnImportar.addEventListener('click', () => { inputImportar.value = ''; inputImportar.click(); });
        inputImportar.addEventListener('change', () => { if (inputImportar.files[0]) importarDados(inputImportar.files[0]); });
    }

    const btnRelatorio = document.getElementById('btn-relatorio-mes');
    if (btnRelatorio) btnRelatorio.addEventListener('click', () => abrirRelatorioMes());
    const btnRelPdf = document.getElementById('btn-relatorio-pdf');
    if (btnRelPdf) btnRelPdf.addEventListener('click', () => gerarRelatorioPDF());
    const btnRelXls = document.getElementById('btn-relatorio-excel');
    if (btnRelXls) btnRelXls.addEventListener('click', () => gerarRelatorioExcel());

    const linkVerContratos = document.getElementById('perf-ver-contratos');
    if (linkVerContratos) {
        linkVerContratos.addEventListener('click', (e) => {
            e.preventDefault();
            const [m, a] = AppState.selectedMonthOverview.split('/');
            AppState.selectedYearClientes = parseInt(a, 10);
            AppState.filterMesClientes = m;
            AppState.activeClientesTab = 'fechados';
            const sel = document.getElementById('filter-mes-select');
            if (sel) sel.value = m;
            switchView('clientes');
        });
    }

    const selectMonthOverview = document.getElementById('select-overview-month');
    if (selectMonthOverview) {
        selectMonthOverview.addEventListener('change', (e) => {
            AppState.selectedMonthOverview = e.target.value;
            renderOverview();
        });
    }

    // Busca Global no Topo
    const globalSearchInput = document.getElementById('global-search-input');
    if (globalSearchInput) {
        globalSearchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            AppState.searchQueryClientes = query;
            AppState.searchQuerySaidas = query;
            if (AppState.currentView !== 'clientes') {
                switchView('clientes');
            } else {
                renderClientesView();
            }
        });
    }

    // Busca na Tabela de Clientes
    const searchClientesInput = document.getElementById('search-clientes-input');
    if (searchClientesInput) {
        searchClientesInput.addEventListener('input', (e) => {
            AppState.searchQueryClientes = e.target.value;
            renderClientesView();
        });
    }

    // Filtro de Origem
    const filterOrigemSelect = document.getElementById('filter-origem-select');
    if (filterOrigemSelect) {
        filterOrigemSelect.addEventListener('change', (e) => {
            AppState.filterOrigem = e.target.value;
            renderClientesView();
        });
    }

    // Filtro de Segmento
    const filterSegmentoSelect = document.getElementById('filter-segmento-select');
    if (filterSegmentoSelect) {
        filterSegmentoSelect.addEventListener('change', (e) => {
            AppState.filterSegmento = e.target.value;
            renderClientesView();
        });
    }

    // Busca na Tabela de Saídas
    const searchSaidasInput = document.getElementById('search-saidas-input');
    if (searchSaidasInput) {
        searchSaidasInput.addEventListener('input', (e) => {
            AppState.searchQuerySaidas = e.target.value;
            renderClientesView();
        });
    }

    // Seletor de Ano nas Oportunidades
    setupYearDropdown('oportunidades');
    setupYearDropdown('receita');
    setupYearDropdown('churn');
    setupYearDropdown('origens');
    setupYearDropdown('vendedores');
    setupMetasInputs();
    setupValorSaidas();
    setupOportunidadesInputs();

    // Botão Restaurar Padrão de Leads
    const btnResetLeadsYear = document.getElementById('btn-reset-leads-year');
    if (btnResetLeadsYear) {
        btnResetLeadsYear.addEventListener('click', () => {
            const ano = AppState.selectedYearOportunidades;
            if (confirm(`Deseja restaurar a quantidade original de leads para o ano de ${ano}?`)) {
                if (DEFAULT_OPORTUNIDADES_ANO && DEFAULT_OPORTUNIDADES_ANO[ano]) {
                    AppState.oportunidadesLeads[ano] = JSON.parse(JSON.stringify(DEFAULT_OPORTUNIDADES_ANO[ano]));
                }
                saveStorage();
                renderOportunidadesView();
                renderOverview();
                showToast(`✓ Leads de ${ano} restaurados com sucesso!`);
            }
        });
    }

    // Exportar Tabela de Dados para CSV
    const btnExportarDadosCSV = document.getElementById('btn-export-dados-csv');
    if (btnExportarDadosCSV) {
        btnExportarDadosCSV.addEventListener('click', () => exportDadosToCSV());
    }

    // Resetar Dados Padrão (Demo)
    const btnResetDemo = document.getElementById('btn-reset-demo-data');
    if (btnResetDemo) {
        btnResetDemo.addEventListener('click', () => {
            if (confirm('Deseja restaurar os dados originais de demonstração da LIFT?')) {
                AppState.clientes = [...DEFAULT_CLIENTES];
                AppState.saidas = [...DEFAULT_SAIDAS];
                AppState.oportunidadesLeads = JSON.parse(JSON.stringify(DEFAULT_OPORTUNIDADES_ANO));
                saveStorage();
                showToast('✓ Dados restaurados com sucesso!');
                renderAll();
            }
        });
    }
}

/**
 * Exportação dos Dados Mensais para formato CSV (Excel)
 */
function exportDadosToCSV() {
    const ano = AppState.selectedYearDados;
    const report = calculateMonthlyDataForYear(ano);

    let csv = `Competência;Entradas;Saídas;Total clientes;Churn;LTV/meses;LTV méd\r\n`;
    report.rows.forEach(r => {
        csv += `${r.competencia};${r.entradas};${r.saidas};${r.totalClientes};${r.churn};${r.ltvMeses};${r.ltvMedio}\r\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `LIFT_Dados_Comerciais_${ano}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Planilha exportada com sucesso!');
}

/* ==========================================================================
   SINCRONIZAÇÃO E BACKUP NO GOOGLE SHEETS
   ========================================================================== */
const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbw5F-u7zIIa3m2MpAqjTAcW2WJJhCgmXKcBQs1aYTXo0L42JuXPUwYxFAMK5hE7L2Fk1Q/exec';

function setupGoogleSheetsSync() {
    const btnOpenModal = document.getElementById('btn-open-google-sheets-modal');
    const modal = document.getElementById('modal-google-sheets');
    const inputUrl = document.getElementById('input-sheets-webhook-url');
    const btnSyncNow = document.getElementById('btn-sync-webhook-now');

    const savedUrl = localStorage.getItem('lift_comercial_webhook_url') || DEFAULT_WEBHOOK_URL;
    if (inputUrl) {
        inputUrl.value = savedUrl;
    }
    if (!localStorage.getItem('lift_comercial_webhook_url')) {
        localStorage.setItem('lift_comercial_webhook_url', DEFAULT_WEBHOOK_URL);
    }

    if (btnOpenModal && modal) {
        btnOpenModal.addEventListener('click', () => {
            modal.classList.add('active');
        });
    }

    if (btnSyncNow) {
        btnSyncNow.addEventListener('click', () => {
            const url = inputUrl ? inputUrl.value.trim() : '';
            if (!url) {
                alert('Por favor, informe a URL do Webhook do Google Apps Script.\nConsulte o arquivo COMO_SINCRONIZAR_GOOGLE_SHEETS.md para o passo a passo.');
                return;
            }
            localStorage.setItem('lift_comercial_webhook_url', url);
            syncToGoogleSheets(url, true);
        });
    }
}

function syncToGoogleSheets(customUrl = null, showExplicitToast = false) {
    const webhookUrl = customUrl || localStorage.getItem('lift_comercial_webhook_url') || DEFAULT_WEBHOOK_URL;
    if (!webhookUrl) return;

    // Constrói payload completo com tudo do portal
    const ano = 2026;
    const reportDados = calculateMonthlyDataForYear(ano);
    const leadsAno = (AppState.oportunidadesLeads && AppState.oportunidadesLeads[ano]) || (DEFAULT_OPORTUNIDADES_ANO && DEFAULT_OPORTUNIDADES_ANO[2026]) || {};

    const oportunidadesList = MESES_OPORTUNIDADES.map(m => {
        const competencia = `${m.key}/${ano}`;
        const leadsMes = parseInt(leadsAno[m.key] !== undefined ? leadsAno[m.key] : 0, 10);
        const fechamentosMes = AppState.clientes.filter(c => c.mesEntrada === competencia).length;
        const conversaoFormatted = leadsMes > 0 ? ((fechamentosMes / leadsMes) * 100).toFixed(1).replace('.', ',') + '%' : '0,0%';
        return {
            mes: m.key,
            nome: m.nome,
            leads: leadsMes,
            fechamentos: fechamentosMes,
            conversao: conversaoFormatted
        };
    });

    const payload = {
        timestamp: new Date().toISOString(),
        clientes: AppState.clientes,
        saidas: AppState.saidas,
        dadosMensais: reportDados.rows,
        oportunidades: oportunidadesList
    };

    fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
    })
    .then(() => {
        if (showExplicitToast) {
            showToast('Sincronizado com o Google Sheets com sucesso!');
        }
    })
    .catch((err) => {
        console.warn('Erro ao sincronizar com Google Sheets:', err);
    });
}

function copyTableDataToClipboard(tipo) {
    let tsv = '';
    const ano = 2026;

    if (tipo === 'clientes') {
        tsv = "Número do Contrato\tNome / Razão Social\tSegmento\tMês da Entrada\tData da Entrada\tContrato Assinado\tTicket Mensal (R$)\r\n";
        AppState.clientes.forEach(c => {
            tsv += `${c.contrato}\t${c.nome}\t${c.segmento}\t${c.mesEntrada}\t${formatDateBR(c.dataEntrada)}\t${c.assinado}\t${c.valorMensal || 2500}\r\n`;
        });
        showToast('Clientes copiados! Basta colar na sua planilha.');
    } else if (tipo === 'saidas') {
        tsv = "Número do Contrato\tNome\tSegmento\tData do Aviso\tData da Saída\tMotivo da Saída\tTempo de Casa (Meses)\r\n";
        AppState.saidas.forEach(s => {
            tsv += `${s.contrato}\t${s.nome}\t${s.segmento}\t${s.dataAviso || '-'}\t${formatDateBR(s.dataSaida)}\t${s.motivo || '-'}\t${s.mesesAtivos || 0}\r\n`;
        });
        showToast('Saídas copiadas! Basta colar na sua planilha.');
    } else if (tipo === 'dados') {
        const report = calculateMonthlyDataForYear(ano);
        tsv = "Competência\tEntradas\tSaídas\tTotal de Clientes\tChurn\tLTV/meses\tLTV méd\r\n";
        report.rows.forEach(r => {
            tsv += `${r.competencia}\t${r.entradas}\t${r.saidas}\t${r.totalClientes}\t${r.churn}\t${r.ltvMeses}\t${r.ltvMedio}\r\n`;
        });
        showToast('Dados mensais copiados! Basta colar na sua planilha.');
    } else if (tipo === 'oportunidades') {
        const leadsAno = (AppState.oportunidadesLeads && AppState.oportunidadesLeads[ano]) || (DEFAULT_OPORTUNIDADES_ANO && DEFAULT_OPORTUNIDADES_ANO[2026]) || {};
        tsv = "Mês\tTotal de Leads\tFechamentos\tTaxa de Conversão\r\n";
        MESES_OPORTUNIDADES.forEach(m => {
            const comp = `${m.key}/${ano}`;
            const leads = leadsAno[m.key] || 0;
            const fech = AppState.clientes.filter(c => c.mesEntrada === comp).length;
            const conv = leads > 0 ? ((fech / leads) * 100).toFixed(1).replace('.', ',') + '%' : '0,0%';
            tsv += `${m.nome}\t${leads}\t${fech}\t${conv}\r\n`;
        });
        showToast('Leads e Conversão copiados! Basta colar na sua planilha.');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv);
    } else {
        const tempArea = document.createElement('textarea');
        tempArea.value = tsv;
        document.body.appendChild(tempArea);
        tempArea.select();
        document.execCommand('copy');
        document.body.removeChild(tempArea);
    }
}

/* ==========================================================================
   UTILITÁRIOS
   ========================================================================== */
function formatDateBR(dateString) {
    if (!dateString) return '-';
    const parts = dateString.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateString;
}

function formatMoney(val) {
    return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function showToast(msg) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${msg}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
