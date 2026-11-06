/* ==========================================================================
   SINCRONIZAÇÃO COM O FIREBASE (Firestore + login com Google)
   --------------------------------------------------------------------------
   Estrutura no Firestore (tudo dentro de "portalComercial", separado de
   outros sistemas do mesmo projeto):
     portalComercial/dados/clientes/{id}   → um documento por cliente
     portalComercial/dados/saidas/{id}     → um documento por saída
     portalComercial/dados/config/leads    → leads por ano/mês
     portalComercial/dados/config/segmentos→ segmentos digitados

   Cada alteração grava só o registro que mudou, e todos que estão com o
   portal aberto recebem a mudança na hora (tempo real).
   ========================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, onSnapshot, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const config = window.LIFT_FIREBASE_CONFIG;
const overlay = document.getElementById('login-overlay');

if (!config || location.protocol === 'file:') {
    if (overlay) overlay.remove();
} else {
    iniciar();
}

function iniciar() {
    const app = initializeApp(config);
    const auth = getAuth(app);
    const db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });

    const colClientes = collection(db, 'portalComercial', 'dados', 'clientes');
    const colSaidas = collection(db, 'portalComercial', 'dados', 'saidas');
    const docLeads = doc(db, 'portalComercial', 'dados', 'config', 'leads');
    const docSegmentos = doc(db, 'portalComercial', 'dados', 'config', 'segmentos');

    // Último estado recebido/gravado no banco (para gravar só o que mudou)
    const sincronizado = { clientes: new Map(), saidas: new Map(), leads: null, segmentos: null };
    const recebido = { clientes: false, saidas: false, leads: false };
    let cancelar = [];
    let migracaoVerificada = false;
    let ativo = false;

    const limpo = (obj) => JSON.parse(JSON.stringify(obj ?? null)); // Firestore não aceita undefined
    const assinatura = (obj) => JSON.stringify(limpo(obj));

    /* ---------- Tela de login ---------- */
    const btnLogin = document.getElementById('btn-login-google');
    const msgLogin = document.getElementById('login-msg');
    const mostrarLogin = (msg = '', tipo = '') => {
        overlay.classList.add('active');
        msgLogin.textContent = msg;
        msgLogin.className = `login-msg ${tipo}`;
        btnLogin.disabled = false;
    };
    btnLogin.addEventListener('click', async () => {
        btnLogin.disabled = true;
        msgLogin.textContent = 'Abrindo o login do Google…';
        msgLogin.className = 'login-msg';
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
            await signInWithPopup(auth, provider);
        } catch (e) {
            if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
                await signInWithRedirect(auth, provider);
            } else if (e.code === 'auth/unauthorized-domain') {
                mostrarLogin(`Este endereço (${location.hostname || 'arquivo local'}) ainda não está autorizado no Firebase. Abra o portal pelo link do GitHub Pages.`, 'erro');
            } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
                mostrarLogin('Não foi possível entrar: ' + (e.message || e.code), 'erro');
            } else {
                mostrarLogin();
            }
        }
    });

    /* ---------- Indicador na barra lateral ---------- */
    const status = (texto, tipo = 'ok') => {
        const el = document.getElementById('cloud-status');
        if (!el) return;
        el.className = `cloud-status ${tipo}`;
        el.querySelector('.cloud-status-text').textContent = texto;
    };
    const btnSair = document.getElementById('btn-logout');
    if (btnSair) btnSair.addEventListener('click', () => { if (confirm('Sair do portal?')) signOut(auth); });

    /* ---------- Recebe dados do banco ---------- */
    const aplicar = () => {
        if (!(recebido.clientes && recebido.saidas && recebido.leads)) return;
        window.aplicarDadosDaNuvem({
            clientes: [...sincronizado.clientes.values()].map(v => JSON.parse(v)),
            saidas: [...sincronizado.saidas.values()].map(v => JSON.parse(v)),
            leads: sincronizado.leads ? JSON.parse(sincronizado.leads) : null,
            segmentos: sincronizado.segmentos ? JSON.parse(sincronizado.segmentos) : null
        });
    };

    const erroPermissao = (e) => {
        console.error('[Firebase]', e);
        if (e.code === 'permission-denied') {
            const email = auth.currentUser ? auth.currentUser.email : '';
            pararOuvintes();
            signOut(auth);
            mostrarLogin(`O e-mail ${email} não tem acesso ao portal. Peça para incluírem você na lista de acesso.`, 'erro');
        } else {
            status('Sem conexão com o banco', 'erro');
        }
    };

    function ouvirBanco() {
        pararOuvintes();
        cancelar.push(onSnapshot(colClientes, { includeMetadataChanges: true }, (snap) => {
            sincronizado.clientes = new Map(snap.docs.map(d => [d.id, assinatura(d.data())]));
            recebido.clientes = true;
            status(snap.metadata.fromCache ? 'Offline · salvo neste computador' : 'Sincronizado', snap.metadata.fromCache ? 'aviso' : 'ok');
            verificarMigracao(snap);
            aplicar();
        }, erroPermissao));
        cancelar.push(onSnapshot(colSaidas, (snap) => {
            sincronizado.saidas = new Map(snap.docs.map(d => [d.id, assinatura(d.data())]));
            recebido.saidas = true;
            aplicar();
        }, erroPermissao));
        cancelar.push(onSnapshot(docLeads, (snap) => {
            sincronizado.leads = snap.exists() ? assinatura(snap.data().porAno || {}) : null;
            recebido.leads = true;
            aplicar();
        }, erroPermissao));
        cancelar.push(onSnapshot(docSegmentos, (snap) => {
            sincronizado.segmentos = snap.exists() ? assinatura(snap.data().lista || []) : null;
            if (sincronizado.segmentos) window.aplicarSegmentosDaNuvem(JSON.parse(sincronizado.segmentos));
        }, () => {}));
    }

    function pararOuvintes() {
        cancelar.forEach(fn => fn());
        cancelar = [];
        recebido.clientes = recebido.saidas = recebido.leads = false;
    }

    /* ---------- Primeira vez: envia os dados deste computador ---------- */
    async function verificarMigracao(snap) {
        if (migracaoVerificada || snap.metadata.fromCache) return;
        migracaoVerificada = true;
        if (!snap.empty) return;
        const local = window.lerDadosLocais();
        if (!local.clientes.length && !local.saidas.length) {
            alert('O banco de dados do portal ainda está vazio.\n\nPara trazer os dados, clique em "Importar arquivo" e escolha o arquivo baixado no portal antigo (portal-comercial-dados-....json).');
            window.abrirBackups && window.abrirBackups();
            return;
        }
        const ok = confirm(
            `O banco de dados do portal ainda está vazio.\n\n` +
            `Enviar os dados deste computador para o banco?\n` +
            `• ${local.clientes.length} clientes\n• ${local.saidas.length} saídas\n• leads e segmentos\n\n` +
            `Depois disso, todos que entrarem no portal verão os mesmos dados.`
        );
        if (!ok) return;
        try {
            status('Enviando dados…', 'aviso');
            await gravarTudo(local);
            status('Sincronizado', 'ok');
            window.showToast && window.showToast('Dados enviados para o banco com sucesso!');
        } catch (e) {
            erroPermissao(e);
        }
    }

    async function gravarTudo(dados) {
        // Firestore aceita até 500 operações por lote
        const ops = [];
        dados.clientes.forEach(c => ops.push(['set', doc(colClientes, String(c.id)), limpo(c)]));
        dados.saidas.forEach(s => ops.push(['set', doc(colSaidas, String(s.id)), limpo(s)]));
        ops.push(['set', docLeads, { porAno: limpo(dados.leads || {}) }]);
        if (dados.segmentos) ops.push(['set', docSegmentos, { lista: limpo(dados.segmentos) }]);
        for (let i = 0; i < ops.length; i += 400) {
            const lote = writeBatch(db);
            ops.slice(i, i + 400).forEach(([, ref, val]) => lote.set(ref, val));
            await lote.commit();
        }
    }

    /* ---------- Grava só o que mudou ---------- */
    async function salvar(estado) {
        if (!ativo || !(recebido.clientes && recebido.saidas && recebido.leads)) return;
        const ops = [];
        const lote = { set: (ref, v) => ops.push(['set', ref, v]), delete: (ref) => ops.push(['del', ref]) };
        let n = 0;
        const diff = (lista, mapa, col) => {
            const atuais = new Map();
            lista.forEach(item => {
                if (!item.id) item.id = (col === colClientes ? 'cli-' : 'sai-') + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
                atuais.set(String(item.id), assinatura(item));
            });
            atuais.forEach((sig, id) => {
                if (mapa.get(id) !== sig) { lote.set(doc(col, id), JSON.parse(sig)); n++; }
            });
            mapa.forEach((_, id) => {
                if (!atuais.has(id)) { lote.delete(doc(col, id)); n++; }
            });
            return atuais;
        };
        const novosCli = diff(estado.clientes, sincronizado.clientes, colClientes);
        const novasSai = diff(estado.saidas, sincronizado.saidas, colSaidas);
        const sigLeads = assinatura(estado.leads || {});
        if (sigLeads !== sincronizado.leads) { lote.set(docLeads, { porAno: JSON.parse(sigLeads) }); n++; }
        const sigSeg = assinatura(estado.segmentos || []);
        if (estado.segmentos && sigSeg !== sincronizado.segmentos) { lote.set(docSegmentos, { lista: JSON.parse(sigSeg) }); n++; }
        if (!n) return;
        // Atualiza o estado conhecido já (o retorno do banco confirma em seguida)
        sincronizado.clientes = novosCli;
        sincronizado.saidas = novasSai;
        sincronizado.leads = sigLeads;
        if (estado.segmentos) sincronizado.segmentos = sigSeg;
        try {
            status('Salvando…', 'aviso');
            for (let i = 0; i < ops.length; i += 400) {
                const b = writeBatch(db);
                ops.slice(i, i + 400).forEach(([t, ref, v]) => (t === 'set' ? b.set(ref, v) : b.delete(ref)));
                await b.commit();
            }
            status('Sincronizado', 'ok');
        } catch (e) {
            erroPermissao(e);
        }
    }

    window.LiftCloud = { salvar, ativo: () => ativo };

    /* ---------- Entrou / saiu ---------- */
    onAuthStateChanged(auth, (user) => {
        if (user) {
            ativo = true;
            overlay.classList.remove('active');
            const el = document.getElementById('cloud-user');
            if (el) el.textContent = user.email;
            document.body.classList.add('cloud-on');
            status('Conectando…', 'aviso');
            migracaoVerificada = false;
            ouvirBanco();
        } else {
            ativo = false;
            pararOuvintes();
            document.body.classList.remove('cloud-on');
            mostrarLogin();
        }
    });
}
