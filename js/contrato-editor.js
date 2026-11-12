/* ==========================================================================
   CONTRATOS — aba "Editar cláusulas"
   --------------------------------------------------------------------------
   Mostra o texto inteiro do contrato para editar à mão. Os campos que o
   gerador preenche aparecem como etiquetas (não editáveis) e podem ser
   movidos, apagados ou inseridos pelo botão "Inserir campo".
   O texto salvo vale para todos (fica no banco: config/contratoModelo);
   "Restaurar original" volta ao modelo do Word.
   ========================================================================== */
const CT_MODELO_LOCAL = 'lift_comercial_contrato_modelo';
const CT_ROTULOS_EXTRA = {
    valorExtenso: 'Valor por extenso', valorTotal: 'Total c/ endereço fiscal', dataExtenso: 'Data por extenso',
    p8a: 'nº parágrafo (auto)', p8b: 'nº parágrafo (auto)', p8c: 'nº parágrafo (auto)',
    p8d: 'nº parágrafo (auto)', p8e: 'nº parágrafo (auto)', p8f: 'nº parágrafo (auto)'
};
const CT_CAMPOS_INSERIR = ['razao', 'cnpj', 'contrato', 'socio', 'cpf', 'endereco', 'email', 'telefone', 'plano', 'valor',
    'valorExtenso', 'vencimento', 'primeiroVenc', 'competencia', 'valorEF', 'valorTotal', 'porte', 'regime',
    'faturamento', 'funcionarios', 'dataExtenso', 'nomeEmpresa'];

const ctRotuloCampo = (k) => CT_ROTULOS_EXTRA[k] || CT_ROTULOS[k] || k;
const ctCorpoAtual = () => (Contratos.modelo && Contratos.modelo.corpo) || CONTRATO_MODELO_CORPO;
// Texto da capa (abaixo da foto)
const CT_CAPA_PADRAO = '<p>{{razao}}</p><p>CNPJ: {{cnpj}}</p><p>Contrato {{contrato}}</p><p>Serviços Contábeis</p>';
const ctCapaAtual = () => (Contratos.modelo && Contratos.modelo.capa) || CT_CAPA_PADRAO;

/* ---------- Modelo salvo ---------- */
function ctCarregarModeloLocal() {
    if (metaNuvemContrato()) return;
    try { Contratos.modelo = JSON.parse(localStorage.getItem(CT_MODELO_LOCAL)) || null; } catch (e) { Contratos.modelo = null; }
}
function metaNuvemContrato() { return !!window.LIFT_FIREBASE_CONFIG && location.protocol !== 'file:'; }

async function ctSalvarModelo(modelo) {
    if (metaNuvemContrato()) {
        if (!(window.LiftCloud && window.LiftCloud.salvarModeloContrato)) throw new Error('sem conexão com o banco');
        await window.LiftCloud.salvarModeloContrato(modelo);
    } else {
        try { modelo ? localStorage.setItem(CT_MODELO_LOCAL, JSON.stringify(modelo)) : localStorage.removeItem(CT_MODELO_LOCAL); } catch (e) { /* ignora */ }
    }
    Contratos.modelo = modelo;
}

window.aplicarModeloContratoDaNuvem = function (m) {
    const antes = ctCorpoAtual() + ctCapaAtual();
    Contratos.modelo = m && m.corpo ? m : null;
    if (!Contratos.editorSujo) ctEditorCarregar();
    ctEditorStatus();
    if (antes !== ctCorpoAtual() + ctCapaAtual() && typeof ctAtualizarPreview === 'function') ctAtualizarPreview();
};

/* ---------- Conversão texto do modelo <-> editor ---------- */
function ctParaEditor(corpo) {
    const chip = (k) => `<span class="ct-chip${/^p8/.test(k) ? ' auto' : ''}" contenteditable="false" data-k="${k}">${escHtml(ctRotuloCampo(k))}</span>`;
    const bloco = (n, rotulo, conteudo) => `<div class="ct-ef" contenteditable="false" data-ef="${n}"><div class="ct-ef-rot">${rotulo}</div><div class="ct-ef-corpo" contenteditable="true">${conteudo}</div></div>`;
    return corpo
        .replace(/<!--EF1-->([\s\S]*?)<!--\/EF1-->/, (m, c) => bloco(1, 'Entra só com a Opção 1 — com cobrança de endereço fiscal', c))
        .replace(/<!--EF2-->([\s\S]*?)<!--\/EF2-->/, (m, c) => bloco(2, 'Entra só com a Opção 2 — endereço fiscal sem cobrança (brinde)', c))
        .replace(/\{\{(\w+)\}\}/g, (m, k) => chip(k));
}

function ctDoEditor(el) {
    const copia = el.cloneNode(true);
    copia.querySelectorAll('.ct-chip').forEach(c => c.replaceWith(document.createTextNode(`{{${c.dataset.k}}}`)));
    copia.querySelectorAll('.ct-ef').forEach(b => {
        const n = b.dataset.ef;
        const corpo = b.querySelector('.ct-ef-corpo');
        const marca = document.createElement('template');
        marca.innerHTML = `<!--EF${n}-->${corpo ? corpo.innerHTML : ''}<!--/EF${n}-->`;
        b.replaceWith(marca.content);
    });
    copia.querySelectorAll('[contenteditable]').forEach(x => x.removeAttribute('contenteditable'));
    // Parágrafos novos criados com Enter herdam o estilo; divs soltas viram parágrafos
    copia.querySelectorAll('div:not([class])').forEach(d => { const p = document.createElement('p'); p.innerHTML = d.innerHTML; p.setAttribute('style', 'margin:0pt 0pt 10pt 0pt;line-height:1.15;text-align:justify;'); d.replaceWith(p); });
    return copia.innerHTML.replace(/​/g, '').trim();
}

/* ---------- Tela ---------- */
function ctEditorCarregar() {
    const ed = document.getElementById('ct-editor');
    if (!ed) return;
    ed.innerHTML = ctParaEditor(ctCorpoAtual());
    const capa = document.getElementById('ct-editor-capa');
    if (capa) capa.innerHTML = ctParaEditor(ctCapaAtual());
    Contratos.editorSujo = false;
    ctEditorStatus();
}

function ctEditorStatus() {
    const st = document.getElementById('ct-editor-status');
    const salvar = document.getElementById('ct-ed-salvar');
    const descartar = document.getElementById('ct-ed-descartar');
    const restaurar = document.getElementById('ct-ed-restaurar');
    if (salvar) salvar.disabled = !Contratos.editorSujo;
    if (descartar) descartar.disabled = !Contratos.editorSujo;
    if (restaurar) restaurar.disabled = !Contratos.modelo;
    if (!st) return;
    if (Contratos.editorSujo) { st.innerHTML = '<span class="ct-st-aviso">Alterações não salvas</span>'; return; }
    if (Contratos.modelo) {
        const d = Contratos.modelo.atualizadoEm ? new Date(Contratos.modelo.atualizadoEm) : null;
        st.innerHTML = `Modelo personalizado${d ? ` · salvo em ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}${Contratos.modelo.por ? ` por ${escHtml(Contratos.modelo.por)}` : ''}`;
    } else st.textContent = 'Modelo original (Word oficial 2026)';
}

function ctTrocarAba(aba) {
    if (aba === Contratos.aba) return;
    if (Contratos.aba === 'editar' && Contratos.editorSujo && !confirm('Há alterações não salvas nas cláusulas. Sair sem salvar?')) return;
    if (Contratos.aba === 'editar' && Contratos.editorSujo) ctEditorCarregar();
    Contratos.aba = aba;
    document.querySelectorAll('#ct-abas button').forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
    document.getElementById('ct-aba-gerar').classList.toggle('oculto', aba !== 'gerar');
    document.getElementById('ct-aba-editar').classList.toggle('oculto', aba !== 'editar');
    if (aba === 'editar' && !Contratos.editorSujo) ctEditorCarregar();
    if (aba === 'gerar') ctAtualizarPreview();
}

async function ctEditorSalvar() {
    const ed = document.getElementById('ct-editor');
    const corpo = ctDoEditor(ed);
    const capa = ctDoEditor(document.getElementById('ct-editor-capa'));
    if (corpo.replace(/<[^>]+>|&nbsp;|\s/g, '').length < 50) return showToast('O contrato ficou praticamente vazio. Confira antes de salvar.');
    const faltam = ['razao', 'cnpj', 'valor', 'dataExtenso'].filter(k => !corpo.includes(`{{${k}}}`));
    if (faltam.length && !confirm(`Estes campos não aparecem mais no texto: ${faltam.map(ctRotuloCampo).join(', ')}.\nSalvar mesmo assim?`)) return;
    const modelo = { corpo, capa, atualizadoEm: new Date().toISOString(), por: (document.getElementById('cloud-user') || {}).textContent || '' };
    try {
        await ctSalvarModelo(modelo);
    } catch (e) {
        return showToast('Não foi possível salvar: ' + (e.message || e));
    }
    Contratos.editorSujo = false;
    ctEditorStatus();
    ctAtualizarPreview();
    showToast('Cláusulas salvas. Os próximos contratos já saem com o texto novo.');
}

async function ctEditorRestaurar() {
    if (!confirm('Voltar ao texto original do contrato (Word oficial 2026)? As alterações feitas aqui serão perdidas.')) return;
    try { await ctSalvarModelo(null); } catch (e) { return showToast('Não foi possível restaurar: ' + (e.message || e)); }
    ctEditorCarregar();
    ctAtualizarPreview();
    showToast('Modelo original restaurado.');
}

function ctEditorComando(cmd, valor) {
    const s = window.getSelection();
    const dentro = s.rangeCount && ctEditorDe(s.anchorNode);
    if (!dentro) document.getElementById('ct-editor').focus();
    document.execCommand(cmd, false, valor);
    ctEditorMudou();
}

function ctEditorMudou() {
    if (!Contratos.editorSujo) { Contratos.editorSujo = true; ctEditorStatus(); }
}

function ctInserirCampo(k) {
    if (!k) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !ctEditorDe(sel.anchorNode)) { showToast('Clique no texto onde o campo deve entrar e escolha de novo.'); return; }
    const chip = `<span class="ct-chip" contenteditable="false" data-k="${k}">${escHtml(ctRotuloCampo(k))}</span>&#8203;`;
    document.execCommand('insertHTML', false, chip);
    ctEditorMudou();
}

// Qual área editável (capa ou corpo) contém o nó
function ctEditorDe(no) {
    return ['ct-editor', 'ct-editor-capa'].map(id => document.getElementById(id)).find(el => el && el.contains(no)) || null;
}

function setupContratoEditor() {
    const ed = document.getElementById('ct-editor');
    if (!ed) return;
    ctCarregarModeloLocal();
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.querySelectorAll('#ct-abas button').forEach(b => b.addEventListener('click', () => ctTrocarAba(b.dataset.aba)));
    [ed, document.getElementById('ct-editor-capa')].forEach(area => {
        area.addEventListener('input', ctEditorMudou);
        // Colar sempre como texto simples (sem a formatação de outros programas)
        area.addEventListener('paste', (e) => {
            e.preventDefault();
            const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, txt);
        });
    });
    document.querySelectorAll('[data-ct-cmd]').forEach(b => b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        ctEditorComando(b.dataset.ctCmd);
    }));
    const ins = document.getElementById('ct-ed-campo');
    ins.innerHTML = '<option value="">Inserir campo…</option>' + CT_CAMPOS_INSERIR.map(k => `<option value="${k}">${escHtml(ctRotuloCampo(k))}</option>`).join('');
    // Guarda onde estava o cursor antes de abrir a lista
    let faixa = null;
    ins.addEventListener('mousedown', () => { const s = window.getSelection(); faixa = s.rangeCount && ctEditorDe(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; });
    ins.addEventListener('change', () => {
        if (faixa) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(faixa); }
        ctInserirCampo(ins.value);
        ins.value = '';
    });
    document.getElementById('ct-ed-salvar').addEventListener('click', ctEditorSalvar);
    document.getElementById('ct-ed-descartar').addEventListener('click', () => { if (confirm('Descartar as alterações não salvas?')) ctEditorCarregar(); });
    document.getElementById('ct-ed-restaurar').addEventListener('click', ctEditorRestaurar);
    window.addEventListener('beforeunload', (e) => { if (Contratos.editorSujo) { e.preventDefault(); e.returnValue = ''; } });
    Contratos.aba = 'gerar';
    ctEditorCarregar();
}
document.addEventListener('DOMContentLoaded', setupContratoEditor);
