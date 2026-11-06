/**
 * charts.js - Motores de renderização de gráficos Canvas/SVG nativos de alta performance
 * Desenvolvido especialmente para o Portal Comercial LIFT
 */

class LiftCharts {
    /**
     * Renderiza o medidor semicircular (Gauge) no estilo da Imagem 1
     * Meta: 100% = metaClientes (padrão 10 clientes)
     * @param {string} canvasId 
     * @param {number} fechados 
     * @param {number} meta 
     */
    static renderGauge(canvasId, fechados, meta = 10) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        
        // Ajusta resolução do canvas para telas Retina/High-DPI
        const rect = canvas.getBoundingClientRect();
        const width = rect.width || 320;
        const height = rect.height || 180;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        const centerX = width / 2;
        const centerY = height - 25;
        const radius = Math.min(centerX - 30, centerY - 15);
        const lineWidth = 24;

        const percent = Math.min(fechados / meta, 1.0);
        const startAngle = Math.PI; // 180° (esquerda)
        const endAngle = 2 * Math.PI; // 360° (direita)

        // 1. Arco de Fundo (cinza claro moderno)
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.stroke();

        // 2. Arco de Progresso (Gradiente LIFT: Laranja da marca para Verde Sucesso / Azul)
        if (percent > 0) {
            const currentAngle = startAngle + (percent * Math.PI);
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, currentAngle, false);

            const gradient = ctx.createLinearGradient(centerX - radius, centerY, centerX + radius, centerY);
            if (percent >= 1.0) {
                // Meta batida: degradê oficial LIFT (Azul Marinho para Laranja Vibrante)
                gradient.addColorStop(0, '#0B2545');
                gradient.addColorStop(0.5, '#F36F21');
                gradient.addColorStop(1, '#FF8A3D');
            } else {
                // Em progresso: degradê oficial LIFT
                gradient.addColorStop(0, '#0B2545');
                gradient.addColorStop(0.6, '#F36F21');
                gradient.addColorStop(1, '#FF9E59');
            }

            ctx.strokeStyle = gradient;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Ponto indicador moderno na ponta do arco
            const indicatorX = centerX + radius * Math.cos(currentAngle);
            const indicatorY = centerY + radius * Math.sin(currentAngle);
            
            ctx.beginPath();
            ctx.arc(indicatorX, indicatorY, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#FFFFFF';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
            ctx.shadowBlur = 6;
            ctx.fill();
            ctx.shadowBlur = 0; // reset
        }

        // 3. Marcações de Meta (0% e 100%)
        ctx.fillStyle = '#64748B';
        ctx.font = '600 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('0', centerX - radius, centerY + 20);
        ctx.fillText(`${meta}`, centerX + radius, centerY + 20);
    }

    /**
     * Renderiza o gráfico histórico interativo de 24 meses (Entradas vs Saídas e Saldo)
     * @param {string} canvasId 
     * @param {Array} dados 
     * @param {object} options 
     */
    static renderHistoryChart(canvasId, dados, options = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width || 800;
        const height = rect.height || 360;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        if (!dados || dados.length === 0) {
            ctx.fillStyle = '#64748B';
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Nenhum dado disponível para o período selecionado', width / 2, height / 2);
            return;
        }

        const padding = { top: 30, right: 60, bottom: 50, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Calcula limites dos dados
        let maxVal = 10;
        let maxTotal = 250;
        let minTotal = 140;

        dados.forEach(d => {
            const ent = d.entradas || 0;
            const sai = Math.abs(d.saidas || 0);
            if (ent > maxVal) maxVal = ent;
            if (sai > maxVal) maxVal = sai;
            if (d.totalClientes && d.totalClientes > maxTotal) maxTotal = d.totalClientes;
            if (d.totalClientes && d.totalClientes < minTotal) minTotal = d.totalClientes;
        });
        maxVal = Math.ceil(maxVal * 1.25);
        maxTotal = Math.ceil(maxTotal * 1.05);
        minTotal = Math.floor(minTotal * 0.95);

        const n = dados.length;
        const colWidth = chartWidth / n;
        const barWidth = Math.max(8, Math.min(colWidth * 0.32, 22));

        // 1. Linhas de Grade Horizontais
        const gridSteps = 5;
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#F1F5F9';
        ctx.fillStyle = '#94A3B8';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right';

        for (let i = 0; i <= gridSteps; i++) {
            const val = Math.round((maxVal / gridSteps) * i);
            const y = padding.top + chartHeight - (val / maxVal) * chartHeight;

            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();

            ctx.fillText(`${val}`, padding.left - 10, y + 4);
        }

        // Eixo Secundário da Direita (Total de Clientes)
        ctx.textAlign = 'left';
        ctx.fillStyle = '#0B2545';
        for (let i = 0; i <= gridSteps; i++) {
            const totalVal = Math.round(minTotal + ((maxTotal - minTotal) / gridSteps) * i);
            const y = padding.top + chartHeight - ((totalVal - minTotal) / (maxTotal - minTotal)) * chartHeight;
            ctx.fillText(`${totalVal}`, padding.left + chartWidth + 10, y + 4);
        }

        // 2. Desenho das Barras de Entradas e Saídas
        dados.forEach((d, index) => {
            const xCenter = padding.left + (index + 0.5) * colWidth;
            const ent = d.entradas || 0;
            const sai = Math.abs(d.saidas || 0);

            // Barra de Entradas (Azul LIFT / Esmeralda)
            if (ent > 0) {
                const barH = (ent / maxVal) * chartHeight;
                const barX = xCenter - barWidth - 1.5;
                const barY = padding.top + chartHeight - barH;

                ctx.fillStyle = '#0B2545'; // Azul Escuro da Lift
                ctx.beginPath();
                ctx.roundRect(barX, barY, barWidth, barH, [4, 4, 0, 0]);
                ctx.fill();

                // Valor no topo da barra
                ctx.fillStyle = '#0B2545';
                ctx.font = 'bold 10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`+${ent}`, barX + barWidth / 2, barY - 4);
            }

            // Barra de Saídas (Laranja LIFT / Vermelho suave)
            if (sai > 0) {
                const barH = (sai / maxVal) * chartHeight;
                const barX = xCenter + 1.5;
                const barY = padding.top + chartHeight - barH;

                ctx.fillStyle = '#F36F21'; // Laranja Marca LIFT
                ctx.beginPath();
                ctx.roundRect(barX, barY, barWidth, barH, [4, 4, 0, 0]);
                ctx.fill();

                // Valor no topo da barra de saída
                ctx.fillStyle = '#C2410C';
                ctx.font = 'bold 10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`-${sai}`, barX + barWidth / 2, barY - 4);
            }

            // Rótulo do Eixo X (Mês/Ano)
            ctx.fillStyle = '#475569';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.label || d.mesAno, xCenter, padding.top + chartHeight + 20);
        });

        // 3. Linha de Total de Clientes na Carteira (Curva cumulativa LIFT)
        ctx.beginPath();
        const points = [];
        dados.forEach((d, index) => {
            const xCenter = padding.left + (index + 0.5) * colWidth;
            const total = d.totalClientes || minTotal;
            const y = padding.top + chartHeight - ((total - minTotal) / (maxTotal - minTotal)) * chartHeight;
            points.push({ x: xCenter, y: y, total: total });
            if (index === 0) ctx.moveTo(xCenter, y);
            else ctx.lineTo(xCenter, y);
        });

        ctx.strokeStyle = '#00A3E0'; // Ciano / Azul Acento
        ctx.lineWidth = 3;
        ctx.stroke();

        // Pontos e círculos na linha
        points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = '#00A3E0';
            ctx.lineWidth = 2;
            ctx.fill();
            ctx.stroke();
        });

        // Eixo Base
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top + chartHeight);
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.stroke();
    }

    /**
     * Gráfico "Histórico Mensal" do Dashboard:
     * barras de Entradas (verde) e Saídas (vermelho), linha de Meta de Cliente (roxa)
     * e linha de Meta de Churn (laranja). Ao passar o mouse sobre uma barra ela muda
     * de cor e mostra os valores do mês; ao tirar o mouse a cor volta ao normal.
     * @param {string} canvasId
     * @param {Array<{mesAno:string,label:string,entradas:number,saidas:number,metaClientes:number,metaChurn:number}>} serie
     * @param {{tooltipId?:string}} options
     */
    static renderMonthlyChart(canvasId, serie, options = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        canvas._liftMonthly = { serie: serie || [], options, hover: null, bars: [] };

        if (!canvas._liftMonthlyBound) {
            canvas._liftMonthlyBound = true;

            if (window.ResizeObserver && canvas.parentElement) {
                let raf = null;
                new ResizeObserver(() => {
                    if (raf) cancelAnimationFrame(raf);
                    raf = requestAnimationFrame(() => {
                        if (canvas.parentElement.clientWidth > 0) LiftCharts._drawMonthly(canvas);
                    });
                }).observe(canvas.parentElement);
            }

            canvas.addEventListener('mousemove', (ev) => {
                const st = canvas._liftMonthly;
                if (!st) return;
                const r = canvas.getBoundingClientRect();
                const mx = ev.clientX - r.left;
                const my = ev.clientY - r.top;
                const hit = st.bars.find(b => mx >= b.x - 2 && mx <= b.x + b.w + 2 && my >= b.hitY && my <= b.y + b.h + 1) || null;
                const key = hit ? `${hit.index}-${hit.tipo}` : null;
                const prev = st.hover ? `${st.hover.index}-${st.hover.tipo}` : null;
                canvas.style.cursor = hit ? 'pointer' : 'default';
                if (key !== prev) {
                    st.hover = hit;
                    LiftCharts._drawMonthly(canvas);
                }
                LiftCharts._updateMonthlyTooltip(canvas, hit, mx, my);
            });

            canvas.addEventListener('mouseleave', () => {
                const st = canvas._liftMonthly;
                if (!st) return;
                canvas.style.cursor = 'default';
                if (st.hover) {
                    st.hover = null;
                    LiftCharts._drawMonthly(canvas);
                }
                LiftCharts._updateMonthlyTooltip(canvas, null);
            });
        }

        LiftCharts._drawMonthly(canvas);
        LiftCharts._updateMonthlyTooltip(canvas, null);
    }

    static _drawMonthly(canvas) {
        const st = canvas._liftMonthly;
        const serie = st.serie;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const holder = canvas.parentElement;
        const width = (holder && holder.clientWidth) || 900;
        const height = (holder && holder.clientHeight) || 420;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        st.bars = [];

        if (!serie.length) {
            ctx.fillStyle = '#64748B';
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Nenhum dado disponível', width / 2, height / 2);
            return;
        }

        // Paleta oficial do portal LIFT
        const COLORS = {
            entrada: '#0B2545', entradaBorda: '#0B2545', entradaHover: '#2B5C9E',
            saida: '#F36F21', saidaBorda: '#F36F21', saidaHover: '#B8460B',
            metaCliente: '#00A3E0', metaChurn: '#D85A10',
            eixo: '#64748B', valor: '#0B2545'
        };

        const compacto = !!st.options.compact;
        const pad = compacto ? { top: 22, right: 8, bottom: 30, left: 28 } : { top: 22, right: 12, bottom: 58, left: 36 };
        const cw = width - pad.left - pad.right;
        const ch = height - pad.top - pad.bottom;

        let maxVal = 0;
        serie.forEach(d => {
            maxVal = Math.max(maxVal, d.entradas || 0, d.saidas || 0, d.metaClientes || 0, d.metaChurn || 0);
        });
        const yMax = compacto ? Math.max(5, Math.ceil(maxVal * 1.25)) : Math.max(15, Math.ceil(maxVal + 2));
        const step = compacto ? Math.max(1, Math.ceil(yMax / 5)) : (yMax <= 20 ? 1 : (yMax <= 40 ? 2 : 5));
        const yOf = v => pad.top + ch - (v / yMax) * ch;

        const n = serie.length;
        const col = cw / n;
        const barW = Math.max(4, Math.min(col * (compacto ? 0.28 : 0.36), compacto ? 34 : 26));

        // Rótulos do eixo Y (sem linhas de grade)
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS.eixo;
        for (let v = 0; v <= yMax; v += step) {
            ctx.fillText(String(v), pad.left - 8, yOf(v) + 4);
        }

        // Barras
        serie.forEach((d, i) => {
            const cx = pad.left + (i + 0.5) * col;
            [['entrada', d.entradas || 0, cx - barW - 1], ['saida', d.saidas || 0, cx + 1]].forEach(([tipo, val, x]) => {
                const y = yOf(val);
                const h = pad.top + ch - y;
                const isHover = st.hover && st.hover.index === i && st.hover.tipo === tipo;
                if (h > 0) {
                    ctx.fillStyle = isHover ? COLORS[tipo + 'Hover'] : COLORS[tipo];
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(x, y, barW, h, [Math.min(4, h), Math.min(4, h), 0, 0]);
                    else ctx.rect(x, y, barW, h);
                    ctx.fill();
                }
                st.bars.push({ index: i, tipo, x, y, w: barW, h, hitY: Math.min(y, pad.top + ch - 8), valor: val });

                // Valor acima da barra
                ctx.fillStyle = isHover ? COLORS[tipo + 'Hover'] : COLORS.valor;
                ctx.font = `bold ${isHover ? 13 : 11}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(String(val), x + barW / 2, y - 7);
            });

            // Rótulo do eixo X (inclinado; reto no modo compacto)
            ctx.save();
            ctx.translate(compacto ? cx : cx + 4, pad.top + ch + (compacto ? 18 : 12));
            if (!compacto) ctx.rotate(-Math.PI / 4);
            ctx.fillStyle = st.hover && st.hover.index === i ? COLORS.valor : COLORS.eixo;
            ctx.font = `${st.hover && st.hover.index === i ? 'bold ' : ''}11px Inter, sans-serif`;
            ctx.textAlign = compacto ? 'center' : 'right';
            ctx.fillText(d.label, 0, 0);
            ctx.restore();
        });

        // Linhas de meta (desenhadas por cima das barras)
        const drawMeta = (key, color, lw, dash = []) => {
            ctx.setLineDash(dash);
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            serie.forEach((d, i) => {
                const y = yOf(d[key] || 0);
                const cx = pad.left + (i + 0.5) * col;
                if (i === 0) { ctx.moveTo(pad.left, y); ctx.lineTo(cx, y); }
                else ctx.lineTo(cx, y);
                if (i === n - 1) ctx.lineTo(pad.left + cw, y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
        };
        drawMeta('metaChurn', COLORS.metaChurn, 2, [6, 4]);
        drawMeta('metaClientes', COLORS.metaCliente, 3);

        // Eixo base
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, pad.top + ch + 0.5);
        ctx.lineTo(pad.left + cw, pad.top + ch + 0.5);
        ctx.stroke();
    }

    static _updateMonthlyTooltip(canvas, hit, mx, my) {
        const st = canvas._liftMonthly;
        const tip = st && st.options.tooltipId ? document.getElementById(st.options.tooltipId) : null;
        if (!tip) return;
        if (!hit) { tip.classList.remove('visible'); return; }

        const d = st.serie[hit.index];
        tip.innerHTML = `
            <div class="tt-title">${d.label}</div>
            <div class="tt-row ${hit.tipo === 'entrada' ? 'active' : ''}"><i class="tt-dot blue"></i>Entradas: <b>${d.entradas}</b></div>
            <div class="tt-row ${hit.tipo === 'saida' ? 'active' : ''}"><i class="tt-dot orange"></i>Saídas: <b>${d.saidas}</b></div>
            <div class="tt-row"><i class="tt-dot cyan"></i>Meta de Cliente: <b>${d.metaClientes}</b></div>
            <div class="tt-row"><i class="tt-dot dark-orange"></i>Meta de Churn: <b>${d.metaChurn}</b></div>`;
        tip.classList.add('visible');

        const box = canvas.getBoundingClientRect();
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let left = mx + 14;
        if (left + tw > box.width) left = mx - tw - 14;
        let top = my - th - 10;
        if (top < 0) top = my + 16;
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = `${top}px`;
    }
}
