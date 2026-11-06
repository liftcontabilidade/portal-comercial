/**
 * data.js - Banco de Dados Oficial da LIFT Contabilidade (Entradas e Saídas Reais de 2026)
 */

const INITIAL_BASE_CLIENTES_2025_END = 194; // Base ao final de 2025

// Base de clientes cadastrados (Entradas Reais de 2026 fornecidas pelo usuário)
const DEFAULT_CLIENTES = []; // dados ficam no Firebase (não publicados no GitHub)

// Base Oficial de Saídas (Churn) de 2026 fornecida pelo usuário
const DEFAULT_SAIDAS = []; // dados ficam no Firebase (não publicados no GitHub)

// Histórico consolidado dos 24 meses (Nov/2024 a Nov/2026)
const HISTORICO_24_MESES = [
    { mesAno: '11/2024', label: 'Nov/24', entradas: 6, saidas: 2, saldo: 4, totalClientes: 154, churn: 1.3 },
    { mesAno: '12/2024', label: 'Dez/24', entradas: 8, saidas: 1, saldo: 7, totalClientes: 161, churn: 0.6 },
    { mesAno: '01/2025', label: 'Jan/25', entradas: 7, saidas: 2, saldo: 5, totalClientes: 166, churn: 1.2 },
    { mesAno: '02/2025', label: 'Fev/25', entradas: 5, saidas: 1, saldo: 4, totalClientes: 170, churn: 0.6 },
    { mesAno: '03/2025', label: 'Mar/25', entradas: 8, saidas: 3, saldo: 5, totalClientes: 175, churn: 1.8 },
    { mesAno: '04/2025', label: 'Abr/25', entradas: 6, saidas: 2, saldo: 4, totalClientes: 179, churn: 1.1 },
    { mesAno: '05/2025', label: 'Mai/25', entradas: 7, saidas: 1, saldo: 6, totalClientes: 185, churn: 0.6 },
    { mesAno: '06/2025', label: 'Jun/25', entradas: 4, saidas: 2, saldo: 2, totalClientes: 187, churn: 1.1 },
    { mesAno: '07/2025', label: 'Jul/25', entradas: 6, saidas: 1, saldo: 5, totalClientes: 192, churn: 0.5 },
    { mesAno: '08/2025', label: 'Ago/25', entradas: 5, saidas: 2, saldo: 3, totalClientes: 195, churn: 1.0 },
    { mesAno: '09/2025', label: 'Set/25', entradas: 4, saidas: 3, saldo: 1, totalClientes: 196, churn: 1.5 },
    { mesAno: '10/2025', label: 'Out/25', entradas: 5, saidas: 2, saldo: 3, totalClientes: 199, churn: 1.0 },
    { mesAno: '11/2025', label: 'Nov/25', entradas: 6, saidas: 1, saldo: 5, totalClientes: 204, churn: 0.5 },
    { mesAno: '12/2025', label: 'Dez/25', entradas: 4, saidas: 2, saldo: 2, totalClientes: 194, churn: 1.0 },
    
    // 2026 Alimentado com dados reais
    { mesAno: '01/2026', label: 'Jan/26', entradas: 8, saidas: 2, saldo: 6, totalClientes: 200, churn: 0.0, ltvMeses: 0, ltvMed: 0 },
    { mesAno: '02/2026', label: 'Fev/26', entradas: 7, saidas: 1, saldo: 6, totalClientes: 206, churn: -0.5, ltvMeses: 200, ltvMed: 100 },
    { mesAno: '03/2026', label: 'Mar/26', entradas: 7, saidas: 3, saldo: 4, totalClientes: 210, churn: -1.5, ltvMeses: 69, ltvMed: 90 },
    { mesAno: '04/2026', label: 'Abr/26', entradas: 6, saidas: 4, saldo: 2, totalClientes: 212, churn: -1.9, ltvMeses: 53, ltvMed: 80 },
    { mesAno: '05/2026', label: 'Mai/26', entradas: 2, saidas: 2, saldo: 0, totalClientes: 212, churn: -0.9, ltvMeses: 106, ltvMed: 85 },
    { mesAno: '06/2026', label: 'Jun/26', entradas: 8, saidas: 1, saldo: 7, totalClientes: 219, churn: -0.5, ltvMeses: 212, ltvMed: 124 },
    { mesAno: '07/2026', label: 'Jul/26', entradas: 7, saidas: 2, saldo: 5, totalClientes: 224, churn: -0.9, ltvMeses: 110, ltvMed: 120 },
    { mesAno: '08/2026', label: 'Ago/26', entradas: 3, saidas: 3, saldo: 0, totalClientes: 224, churn: -1.3, ltvMeses: 75, ltvMed: 92 },
    { mesAno: '09/2026', label: 'Set/26', entradas: 4, saidas: 3, saldo: 1, totalClientes: 225, churn: -1.3, ltvMeses: 75, ltvMed: 137 },
    { mesAno: '10/2026', label: 'Out/26', entradas: 2, saidas: 0, saldo: 2, totalClientes: 227, churn: 0.0, ltvMeses: 0, ltvMed: 102 },
    { mesAno: '11/2026', label: 'Nov/26', entradas: 4, saidas: 0, saldo: 4, totalClientes: 231, churn: 0.0, ltvMeses: 0, ltvMed: 51 }
];

// Oportunidades / Leads cadastrados por ano (Dados oficiais da planilha Leads - 2026)
const DEFAULT_OPORTUNIDADES_ANO = {
    2026: {
        '01': 40,
        '02': 23,
        '03': 18,
        '04': 25,
        '05': 18,
        '06': 16,
        '07': 32,
        '08': 16,
        '09': 39,
        '10': 36,
        '11': 5,
        '12': 0
    },
    2025: {
        '01': 35,
        '02': 28,
        '03': 30,
        '04': 26,
        '05': 29,
        '06': 22,
        '07': 27,
        '08': 25,
        '09': 24,
        '10': 28,
        '11': 30,
        '12': 20
    }
};


/* ==========================================================================
   HISTÓRICO MENSAL OFICIAL (Dashboard) - Mai/2024 a Out/2026
   Valores de referência de Entradas e Saídas por mês.
   O gráfico parte destes números e soma/subtrai automaticamente
   qualquer cliente ou saída que for cadastrado, editado ou removido no portal.
   Formato: 'MM/AAAA': [entradas, saídas]
   ========================================================================== */
const HISTORICO_MENSAL_BASE = {
    '05/2024': [2, 1],  '06/2024': [5, 1],  '07/2024': [1, 2],  '08/2024': [3, 2],
    '09/2024': [4, 0],  '10/2024': [3, 2],  '11/2024': [4, 0],  '12/2024': [2, 0],

    '01/2025': [6, 4],  '02/2025': [3, 1],  '03/2025': [4, 2],  '04/2025': [7, 2],
    '05/2025': [3, 1],  '06/2025': [6, 3],  '07/2025': [4, 0],  '08/2025': [10, 1],
    '09/2025': [3, 4],  '10/2025': [3, 0],  '11/2025': [3, 2],  '12/2025': [5, 3],

    '01/2026': [8, 2],  '02/2026': [7, 1],  '03/2026': [7, 3],  '04/2026': [6, 4],
    '05/2026': [2, 2],  '06/2026': [8, 1],  '07/2026': [7, 2],  '08/2026': [3, 3],
    '09/2026': [4, 3],  '10/2026': [2, 1]
};

// A partir deste ano o Dashboard usa SOMENTE os clientes e saídas cadastrados no portal
// (aba Clientes). Anos anteriores usam o HISTORICO_MENSAL_BASE acima.
const ANO_INICIO_CADASTRO_PORTAL = 2026;

// Meta mensal de novos clientes por ano (linha roxa do gráfico)
const META_CLIENTES_MES_POR_ANO = { 2024: 5, 2025: 5, 2026: 10 };

// Meta máxima de churn por mês (linha laranja do gráfico)
const META_CHURN_MES = 2;
