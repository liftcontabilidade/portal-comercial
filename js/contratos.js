/* ==========================================================================
   CONTRATOS — gera o contrato padrão LIFT preenchido, em PDF
   --------------------------------------------------------------------------
   O texto do contrato vem de js/contrato-modelo.js (convertido do Word).
   Os campos amarelos do modelo viram um formulário; ao clicar em "Gerar PDF"
   o portal monta o documento (capa, cabeçalho e rodapé em todas as páginas)
   e abre a janela de impressão do navegador para salvar como PDF.
   Se um cliente cadastrado for escolhido, os dados digitados ficam salvos
   nele (campo dadosContrato) para gerar de novo depois.
   ========================================================================== */
const CT_CAMPOS = ['razao', 'cnpj', 'contrato', 'socio', 'cpf', 'endereco', 'email', 'telefone',
    'plano', 'valor', 'vencimento', 'primeiroVenc', 'competencia', 'ef', 'valorEF',
    'porte', 'regime', 'faturamento', 'funcionarios', 'data', 'nomeEmpresa'];
const CT_ROTULOS = {
    razao: 'Razão social', cnpj: 'CNPJ', contrato: 'Contrato', socio: 'Nome do sócio(a)', cpf: 'CPF',
    endereco: 'Endereço', email: 'E-mail', telefone: 'Telefone', plano: 'Plano', valor: 'Valor',
    vencimento: 'Dia do vencimento', primeiroVenc: 'Primeiro vencimento', competencia: 'Competência inicial',
    valorEF: 'Valor do endereço fiscal', porte: 'Porte', regime: 'Regime', faturamento: 'Faturamento mensal',
    funcionarios: 'Funcionários', data: 'Data', nomeEmpresa: 'Nome da empresa (assinatura)'
};
const CT_ORDINAIS = ['Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Quinto', 'Sexto', 'Sétimo', 'Oitavo'];
const CT_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const Contratos = { clienteId: null, nomeEmpresaManual: false, timer: null };

/* ---------- Valor por extenso (reais e centavos) ---------- */
function ctExtensoInteiro(n) {
    const un = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const dez = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const cen = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
    const ate999 = (x) => {
        if (x === 0) return '';
        if (x === 100) return 'cem';
        const c = Math.floor(x / 100), r = x % 100, p = [];
        if (c) p.push(cen[c]);
        if (r) p.push(r < 20 ? un[r] : dez[Math.floor(r / 10)] + (r % 10 ? ' e ' + un[r % 10] : ''));
        return p.join(' e ');
    };
    if (n === 0) return 'zero';
    const grupos = [];
    let x = n;
    while (x > 0) { grupos.push(x % 1000); x = Math.floor(x / 1000); }
    const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
    const partes = [];
    for (let i = grupos.length - 1; i >= 0; i--) {
        const g = grupos[i];
        if (!g) continue;
        let txt = (i === 1 && g === 1) ? '' : ate999(g);
        if (i > 0) txt = (txt ? txt + ' ' : '') + nomes[i][g === 1 ? 0 : 1];
        partes.push({ txt, g, i });
    }
    // "e" entre grupos quando o último grupo é < 100 ou centena redonda
    return partes.map((p, k) => {
        if (k === 0) return p.txt;
        const usaE = p.i === 0 && (p.g < 100 || p.g % 100 === 0);
        return (usaE ? ' e ' : ' ') + p.txt;
    }).join('');
}

function ctValorPorExtenso(v) {
    if (v === null || isNaN(v)) return '';
    const total = Math.round(v * 100);
    const reais = Math.floor(total / 100), cent = total % 100;
    const partes = [];
    if (reais) {
        const ext = ctExtensoInteiro(reais);
        const deReais = reais >= 1000000 && reais % 1000000 === 0;
        partes.push(ext + (deReais ? ' de reais' : reais === 1 ? ' real' : ' reais'));
    }
    if (cent) partes.push(ctExtensoInteiro(cent) + (cent === 1 ? ' centavo' : ' centavos'));
    return partes.length ? partes.join(' e ') : 'zero reais';
}

/* ---------- Formatação dos campos ---------- */
const ctDigitos = (s) => String(s || '').replace(/\D/g, '');
function ctMascaraCNPJ(s) {
    const d = ctDigitos(s).slice(0, 14);
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}
function ctMascaraCPF(s) {
    const d = ctDigitos(s).slice(0, 11);
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
function ctMascaraTelefone(s) {
    const d = ctDigitos(s).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
const ctMoeda = (v) => (v === null || isNaN(v)) ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ctDataBR = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const ctDataExtenso = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${Number(m[3])} de ${CT_MESES[Number(m[2]) - 1]} de ${m[1]}` : ''; };
const ctCompetencia = (ym) => { const m = String(ym || '').match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}/${m[1]}` : ''; };
const ctNumero = (s) => { const t = String(s || '').trim(); if (!t) return null; const n = parseValorBR(t); return isNaN(n) ? NaN : n; };

/* ---------- Formulário ---------- */
const ctEl = (k) => document.getElementById('ct-' + k);

function ctLerFormulario() {
    const d = {};
    CT_CAMPOS.forEach(k => { const el = ctEl(k); d[k] = el ? String(el.value || '').trim() : ''; });
    return d;
}

function ctPreencherFormulario(d) {
    CT_CAMPOS.forEach(k => { const el = ctEl(k); if (el) el.value = d && d[k] != null ? d[k] : ''; });
    if (!ctEl('nomeEmpresa').value && d && d.razao) ctEl('nomeEmpresa').value = d.razao;
    Contratos.nomeEmpresaManual = !!(d && d.nomeEmpresa && d.razao && d.nomeEmpresa !== d.razao);
    ctAtualizarEF();
}

// Monta os valores que entram no texto do contrato
function ctValores(d, comEFTexto) {
    const valor = ctNumero(d.valor);
    const valorEF = ctNumero(d.valorEF);
    const fat = ctNumero(d.faturamento);
    // Opção escolhida com o texto apagado no editor conta como "sem parágrafo"
    const comEF = (d.ef === '1' || d.ef === '2') && comEFTexto !== false;
    // Com o parágrafo de endereço fiscal os demais começam no Segundo; sem ele, no Primeiro
    const ord = (i) => CT_ORDINAIS[i - 1 - (comEF ? 0 : 1)];
    return {
        razao: d.razao, cnpj: d.cnpj, contrato: d.contrato,
        socio: d.socio, cpf: d.cpf, endereco: d.endereco, email: d.email, telefone: d.telefone,
        plano: d.plano,
        valor: valor !== null && !isNaN(valor) ? ctMoeda(valor) : '',
        valorExtenso: valor !== null && !isNaN(valor) ? ctValorPorExtenso(valor) : '',
        vencimento: d.vencimento,
        primeiroVenc: ctDataBR(d.primeiroVenc),
        competencia: ctCompetencia(d.competencia),
        valorEF: valorEF !== null && !isNaN(valorEF) ? ctMoeda(valorEF) : '',
        valorTotal: (valor !== null && !isNaN(valor) && valorEF !== null && !isNaN(valorEF)) ? ctMoeda(valor + valorEF) : '',
        porte: d.porte, regime: d.regime,
        faturamento: fat !== null && !isNaN(fat) ? ctMoeda(fat) : '',
        funcionarios: d.funcionarios,
        dataExtenso: ctDataExtenso(d.data),
        nomeEmpresa: d.nomeEmpresa || d.razao,
        p8a: ord(2), p8b: ord(3), p8c: ord(4), p8d: ord(5), p8e: ord(6), p8f: ord(7)
    };
}

function ctFaltando(d) {
    const obrig = ['razao', 'cnpj', 'contrato', 'socio', 'cpf', 'endereco', 'email', 'telefone', 'plano', 'valor',
        'vencimento', 'primeiroVenc', 'competencia', 'porte', 'regime', 'faturamento', 'funcionarios', 'data'];
    if (d.ef === '1') obrig.push('valorEF');
    return obrig.filter(k => !d[k]).map(k => CT_ROTULOS[k]);
}

/* ---------- Documento ---------- */
function ctUrl(caminho) { return new URL(caminho, location.href).href; }

// o = textos vindos do editor (opcional): { corpo, capa, cab, rod }
function ctMontarHTML(d, paraTela, o = {}) {
    let corpo = o.corpo != null ? o.corpo : ctCorpoAtual();
    const blocoEF = d.ef === '1' || d.ef === '2' ? (corpo.match(new RegExp(`<!--EF${d.ef}-->([\\s\\S]*?)<!--\\/EF${d.ef}-->`)) || [])[1] : '';
    const efTemTexto = !!blocoEF && blocoEF.replace(/<[^>]+>|&nbsp;|\s/g, '').length > 0;
    const v = ctValores(d, efTemTexto);
    const campo = (k) => {
        const val = v[k];
        return val ? escHtml(val) : `<span class="vazio">${escHtml((CT_ROTULOS[k] || k).toUpperCase())}</span>`;
    };
    // Parágrafo do endereço fiscal: mantém só a opção escolhida
    corpo = corpo.replace(/<!--EF1-->([\s\S]*?)<!--\/EF1-->/, d.ef === '1' ? '$1' : '')
        .replace(/<!--EF2-->([\s\S]*?)<!--\/EF2-->/, d.ef === '2' ? '$1' : '');
    const preencher = (txt) => txt.replace(/\{\{(\w+)\}\}/g, (m, k) => {
        if (/^p8[a-f]$/.test(k)) return escHtml(v[k]);
        if (k === 'valorExtenso') return v.valorExtenso ? escHtml(v.valorExtenso) : '<span class="vazio">VALOR POR EXTENSO</span>';
        if (k === 'valorTotal') return v.valorTotal ? escHtml(v.valorTotal) : '<span class="vazio">TOTAL</span>';
        if (k === 'dataExtenso') return v.dataExtenso ? escHtml(v.dataExtenso) : '<span class="vazio">DATA</span>';
        return campo(k);
    });
    corpo = preencher(corpo);
    const titulo = `Contrato ${d.contrato || ''} - ${d.razao || 'LIFT'}`.trim();
    const capa = `
    <div class="capa">
        <div class="capa-foto"><img src="${ctUrl('assets/contrato/capa.jpg')}" alt=""><div class="capa-brilho"><img class="capa-logo" src="${ctUrl('assets/contrato/logo-azul.png')}" alt=""></div></div>
        <div class="capa-txt">${preencher(o.capa != null ? o.capa : ctCapaAtual())}</div>
    </div>`;
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escHtml(titulo)}</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Arial, 'Liberation Sans', Helvetica, sans-serif; font-size: 12pt; color: #002060; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cab { position: fixed; top: 0; left: 0; width: 210mm; height: 22mm; background: #195A7D; z-index: 2; }
.cab span { position: absolute; left: 19mm; right: 62mm; top: 6.3mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'Proxima Nova', 'Segoe UI', Calibri, Arial, sans-serif; font-size: 20pt; color: #FFFFFF; }
.cab img { position: absolute; right: 13mm; top: 3mm; height: 16mm; }
.rod { position: fixed; bottom: 0; left: 0; width: 210mm; height: 24mm; background: #EAF0F4; color: #4F81BD; font-size: 9pt; line-height: 1.35; text-align: center; padding-top: 5mm; z-index: 2; }
.rod b { font-weight: bold; }
.rod p, .cab span p { margin: 0; }
table.pg { width: 100%; border-collapse: collapse; }
table.pg > thead > tr > td { height: 30mm; padding: 0; }
table.pg > tfoot > tr > td { height: 30mm; padding: 0; }
table.pg > tbody > tr > td { padding: 0 19mm; vertical-align: top; }
p { margin: 0 0 10pt; orphans: 3; widows: 3; }
.mk { display: inline-block; width: 18pt; text-indent: 0; }
.titulo { margin-bottom: 14pt !important; }
table.tb { width: 100%; border-collapse: collapse; margin: 0 0 12pt; page-break-inside: avoid; }
table.tb td { border: 1px solid #8EA9C1; padding: 4pt 6pt; width: 50%; vertical-align: top; }
table.ass { width: 100%; border-collapse: collapse; margin-top: 20pt; page-break-inside: avoid; }
table.ass td { width: 50%; text-align: center; vertical-align: top; padding: 62pt 16pt 8pt; font-size: 11pt; }
table.ass .linha { border-top: 1px solid #002060; margin: 0 12pt 6pt; }
.capa { page-break-after: always; break-after: page; margin: -8mm -19mm 0; height: 236mm; display: flex; flex-direction: column; }
.capa-foto { position: relative; width: 210mm; height: 150mm; flex: none; overflow: hidden; }
.capa-foto > img:first-child { width: 100%; height: 100%; object-fit: cover; display: block; }
.capa-brilho { position: absolute; left: 4mm; bottom: -12mm; width: 84mm; height: 84mm; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.97) 0%, rgba(255,255,255,.8) 38%, rgba(255,255,255,0) 70%); display: flex; align-items: center; justify-content: center; }
.capa-logo { width: 44mm; height: auto; }
.capa-txt { flex: 1; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.capa-txt p { font-size: 20pt; font-weight: bold; margin: 0 0 9pt; }
.vazio { background: #FFF200; color: #002060; font-weight: bold; }
@media screen {
    html { background: #E5E7EB; }
    body { width: 210mm; margin: 0 auto; background: #FFFFFF; position: relative; min-height: 297mm; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
    .cab { position: absolute; }
    .rod { position: absolute; }
    table.pg > tfoot { display: none; }
    .capa { border-bottom: 10mm solid #E5E7EB; margin-bottom: 10mm; height: 246mm; }
    body { padding-bottom: 30mm; }
}
</style></head><body>
<div class="cab"><span>${preencher(o.cab != null ? o.cab : ctCabAtual())}</span><img src="${ctUrl('assets/contrato/logo-laranja.png')}" alt=""></div>
<div class="rod">${preencher(o.rod != null ? o.rod : ctRodAtual())}</div>
<table class="pg"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
${capa}
${corpo}
</td></tr></tbody></table>
</body></html>`;
}

/* ---------- Tela ---------- */
function ctAtualizarEF() {
    const ef = ctEl('ef');
    const grupo = document.getElementById('ct-grupo-valorEF');
    if (ef && grupo) grupo.classList.toggle('oculto', ef.value !== '1');
    const v = ctValores(ctLerFormulario());
    const ext = document.getElementById('ct-extenso');
    if (ext) ext.textContent = v.valorExtenso ? `(${v.valorExtenso})` : '';
    const tot = document.getElementById('ct-total');
    if (tot) tot.textContent = ef && ef.value === '1' && v.valorTotal ? `Total mensal: R$ ${v.valorTotal}` : '';
}

function ctAtualizarPreview() {
    clearTimeout(Contratos.timer);
    Contratos.timer = setTimeout(() => {
        const frame = document.getElementById('ct-preview');
        if (!frame) return;
        const d = ctLerFormulario();
        const y = frame.contentWindow ? frame.contentWindow.scrollY : 0;
        // Ajusta a folha (A4) à largura da coluna
        const wrap = document.getElementById('ct-preview-wrap');
        if (wrap && wrap.clientWidth) {
            const escala = Math.min(1, wrap.clientWidth / 860);
            frame.style.transform = `scale(${escala})`;
            frame.style.height = (wrap.clientHeight / escala) + 'px';
        }
        frame.srcdoc = ctMontarHTML(d, true);
        frame.onload = () => { try { frame.contentWindow.scrollTo(0, y); } catch (e) { /* ignora */ } };
        const falta = ctFaltando(d);
        const aviso = document.getElementById('ct-faltando');
        if (aviso) aviso.innerHTML = falta.length ? `Faltam <b>${falta.length}</b>: ${falta.map(escHtml).join(', ')}` : '<span class="ct-ok">Todos os campos preenchidos.</span>';
    }, 250);
}

function renderContratosView() {
    const dl = document.getElementById('ct-lista-clientes');
    if (dl) {
        const nomes = [...new Set(AppState.clientes.map(c => (c.nome || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        dl.innerHTML = nomes.map(n => `<option value="${escHtml(n)}"></option>`).join('');
    }
    if (!Contratos.iniciado) {
        Contratos.iniciado = true;
        ctPreencherFormulario({ data: new Date().toISOString().slice(0, 10), ef: '' });
    }
    ctAtualizarEF();
    ctAtualizarPreview();
}

function ctEscolherCliente(nome) {
    const c = AppState.clientes.find(x => (x.nome || '').trim().toLocaleLowerCase('pt-BR') === String(nome || '').trim().toLocaleLowerCase('pt-BR'));
    const info = document.getElementById('ct-cliente-info');
    if (!c) { Contratos.clienteId = null; if (info) info.textContent = nome ? 'Cliente não encontrado no cadastro — preencha os dados à mão.' : ''; return; }
    Contratos.clienteId = c.id;
    const salvo = c.dadosContrato || {};
    const mes = String(c.mesEntrada || '').match(/^(\d{2})\/(\d{4})$/);
    const base = {
        razao: c.nome || '',
        cnpj: c.inscricao ? ctMascaraCNPJ(c.inscricao) : '',
        contrato: c.contrato ? `${c.contrato}-${c.ano || new Date().getFullYear()}` : '',
        valor: temValor(c.valorMensal) ? ctMoeda(Number(c.valorMensal)) : '',
        competencia: mes ? `${mes[2]}-${mes[1]}` : '',
        data: new Date().toISOString().slice(0, 10),
        ef: ''
    };
    // O que já foi digitado para este cliente tem prioridade sobre o cadastro
    const dados = { ...base };
    Object.keys(salvo).forEach(k => { if (salvo[k] !== '' && salvo[k] != null) dados[k] = salvo[k]; });
    dados.data = new Date().toISOString().slice(0, 10);
    ctPreencherFormulario(dados);
    if (info) info.textContent = c.dadosContrato ? 'Dados do último contrato deste cliente carregados.' : 'Dados do cadastro carregados. Complete o restante.';
    ctAtualizarPreview();
}

function ctGerarPDF(o) {
    if (o && o.type) o = undefined; // chamado pelo clique do botão
    const d = ctLerFormulario();
    const falta = ctFaltando(d);
    if (falta.length && !confirm(`Ainda faltam ${falta.length} campo(s):\n• ${falta.join('\n• ')}\n\nGerar o contrato mesmo assim? (os campos vazios saem marcados em amarelo)`)) return;
    // Guarda os dados no cliente escolhido (para gerar de novo depois)
    if (Contratos.clienteId) {
        const c = AppState.clientes.find(x => x.id === Contratos.clienteId);
        if (c) { c.dadosContrato = { ...d }; delete c.dadosContrato.data; saveStorage(); }
    }
    let frame = document.getElementById('ct-print-frame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'ct-print-frame';
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open(); doc.write(ctMontarHTML(d, false, o || {})); doc.close();
    const tituloOriginal = document.title;
    document.title = `Contrato ${d.contrato || ''} - ${d.razao || 'LIFT'}`.replace(/\s+/g, ' ').trim();
    const imprimir = () => {
        if (!frame.contentWindow) return;
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => { document.title = tituloOriginal; }, 1500);
    };
    const imgs = [...doc.images];
    Promise.all(imgs.map(im => im.complete ? 1 : new Promise(r => { im.onload = im.onerror = r; })))
        .then(() => setTimeout(imprimir, 150));
}

function ctLimpar() {
    if (!confirm('Limpar todos os campos do contrato?')) return;
    Contratos.clienteId = null;
    document.getElementById('ct-cliente').value = '';
    document.getElementById('ct-cliente-info').textContent = '';
    ctPreencherFormulario({ data: new Date().toISOString().slice(0, 10), ef: '' });
    ctAtualizarPreview();
}

function setupContratos() {
    const painel = document.getElementById('panel-contratos');
    if (!painel) return;
    const form = document.getElementById('ct-form');
    form.addEventListener('input', (e) => {
        const id = e.target.id;
        if (id === 'ct-cnpj') e.target.value = ctMascaraCNPJ(e.target.value);
        if (id === 'ct-cpf') e.target.value = ctMascaraCPF(e.target.value);
        if (id === 'ct-telefone') e.target.value = ctMascaraTelefone(e.target.value);
        if (id === 'ct-vencimento') e.target.value = ctDigitos(e.target.value).slice(0, 2);
        if (id === 'ct-funcionarios') e.target.value = ctDigitos(e.target.value).slice(0, 5);
        if (id === 'ct-nomeEmpresa') Contratos.nomeEmpresaManual = !!e.target.value.trim();
        if (id === 'ct-razao' && !Contratos.nomeEmpresaManual) ctEl('nomeEmpresa').value = e.target.value;
        ctAtualizarEF();
        ctAtualizarPreview();
    });
    form.addEventListener('change', () => { ctAtualizarEF(); ctAtualizarPreview(); });
    ['ct-valor', 'ct-valorEF', 'ct-faturamento'].forEach(id => document.getElementById(id).addEventListener('blur', (e) => {
        const n = ctNumero(e.target.value);
        if (n !== null && !isNaN(n)) e.target.value = ctMoeda(n);
    }));
    const cli = document.getElementById('ct-cliente');
    cli.addEventListener('change', () => ctEscolherCliente(cli.value));
    document.getElementById('ct-limpar').addEventListener('click', ctLimpar);
    form.addEventListener('submit', (e) => { e.preventDefault(); ctGerarPDF(); });
}
document.addEventListener('DOMContentLoaded', setupContratos);
