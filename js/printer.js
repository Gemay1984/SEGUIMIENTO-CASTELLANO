/**
 * ZIPCASTELLANO PRINTER v3 — Hoja Rediseñada
 *
 * Cambios clave vs v2:
 * - SIN marcadores de esquina (se recortaban al imprimir)
 * - QR más grande: 32mm × 32mm (mejor detección desde cámara)
 * - Marca de anclaje (■ 8mm) en esquina inferior-derecha de la grilla
 * - Borde negro grueso alrededor de la grilla de burbujas
 * - El scanner solo necesita: QR (posición/escala/rotación) + posiciones DOM medidas
 */
const printer = {

    generateColumns(count) {
        const perCol = Math.ceil(count / 3);
        const availableMM = 173;
        const rowMM    = Math.min(10.5, Math.max(5.5, availableMM / perCol));
        const bubblePx = Math.round(Math.min(22, Math.max(15, rowMM * 2.2)));
        const fontPx   = Math.round(bubblePx * 0.7);
        const numPx    = Math.round(fontPx * 1.3);

        let html = '';
        for (let c = 0; c < 3; c++) {
            html += `<div class="col">`;
            for (let i = 1; i <= perCol; i++) {
                const qNum = c * perCol + i;
                if (qNum > count) break;
                html += `
                <div class="qrow" style="height:${rowMM}mm;">
                    <span class="qnum" style="width:${numPx * 2.8}px; font-size:${numPx}px;">${qNum}</span>
                    ${'ABCDE'.split('').map(l =>
                        `<div class="bubble" style="width:${bubblePx}px;height:${bubblePx}px;font-size:${fontPx}px;">${l}</div>`
                    ).join('')}
                </div>`;
            }
            html += '</div>';
        }
        return html;
    },

    buildSheetHTML(exam, student) {
        // QR URL con margin=0, tamaño 32mm para mejor detección
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=0&data=ZC|${encodeURIComponent(student.id)}|${encodeURIComponent(exam.id)}`;

        return `
        <div class="sheet">
            <div class="inner">

                <!-- ══ HEADER ROW ══ -->
                <div class="header-row">
                    <!-- QR CODE — 32mm -->
                    <div class="qr-wrapper">
                        <img src="${qrUrl}" class="qr-img" title="QR Identificador" alt="QR">
                        <div class="qr-label">ID: ${student.id}</div>
                    </div>

                    <!-- Membrete central -->
                    <div class="header-center">
                        <img src="https://i.postimg.cc/VN6nHMHm/Imagen1.jpg" alt="Membrete" class="header-logo">
                        <div class="exam-title">HOJA DE RESPUESTAS</div>
                        <div class="exam-sub">Seguimiento de Competencias · Castellano ICFES</div>
                    </div>

                    <!-- Meta del examen -->
                    <div class="exam-meta">
                        <b>Examen:</b> ${exam.name}<br>
                        <b>Fecha:</b> ${new Date(exam.date).toLocaleDateString()}<br>
                        <b>Grado:</b> ${exam.grade}
                    </div>
                </div>

                <!-- ══ STUDENT BOX ══ -->
                <div class="student-box">
                    <div class="std-name"><b>Estudiante:</b> ${student.name}</div>
                    <div class="std-info">
                        <span><b>Grado:</b> ${student.grade}</span>
                        <span class="std-id">ID: ${student.id}</span>
                    </div>
                </div>

                <!-- ══ GRILLA DE BURBUJAS con borde y marcadores de esquina ══ -->
                <div class="grid-container">
                    <div class="bubbles-grid">
                        ${this.generateColumns(exam.questions.length)}
                    </div>
                    <!-- Marcadores de esquina para calibración de perspectiva -->
                    <div class="anchor-mark tl"></div>
                    <div class="anchor-mark tr"></div>
                    <div class="anchor-mark bl"></div>
                    <div class="anchor-mark br"></div>
                </div>

                <div class="footer">
                    INSTRUCCIÓN: Rellene con X bien oscura la opción correcta.
                </div>

            </div><!-- /inner -->
        </div><!-- /sheet -->`;
    },

    /**
     * OPCIÓN C: Medir posiciones REALES de las burbujas + 4 anclajes desde el DOM.
     * Crea un div oculto con los mismos estilos CSS que la hoja impresa,
     * renderiza la grilla de burbujas, y usa getBoundingClientRect() para
     * obtener las coordenadas exactas en mm de cada burbuja.
     * 
     * Retorna: { positions: [q][opt] = {x, y}, anchors: {tl, tr, bl, br} }
     */
    measureBubblePositions(numQ) {
        const perCol = Math.ceil(numQ / 3);
        const availableMM = 173;
        const rowMM = Math.min(10.5, Math.max(5.5, availableMM / perCol));
        const bubblePx = Math.round(Math.min(22, Math.max(15, rowMM * 2.2)));
        const fontPx = Math.round(bubblePx * 0.7);
        const numPx = Math.round(fontPx * 1.3);

        const gridHTML = this.generateColumns(numQ);

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;z-index:-1;';
        container.innerHTML = `
            <style>
                .m-sheet * { box-sizing: border-box; margin: 0; padding: 0; }
                .m-sheet {
                    width: 215.9mm; height: 279.4mm;
                    position: relative; font-family: 'Outfit', sans-serif;
                }
                .m-inner {
                    position: absolute;
                    top: 22mm; left: 22mm; right: 22mm; bottom: 22mm;
                    display: flex; flex-direction: column;
                }
                .m-header {
                    display: flex; gap: 8px; align-items: stretch;
                    min-height: 34mm; max-height: 34mm;
                    padding-bottom: 6px; margin-bottom: 6px;
                }
                .m-student {
                    min-height: 17mm; max-height: 17mm;
                    padding: 6px 12px; margin-bottom: 6px;
                    border: 2px solid #94a3b8; border-radius: 6px;
                }
                .m-grid-container {
                    flex: 1; position: relative;
                    border: 3px solid #000; padding: 7mm;
                }
                .m-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr;
                    gap: 0 24px;
                }
                .m-grid .col { display: flex; flex-direction: column; gap: 4px; }
                .m-grid .qrow {
                    display: flex; align-items: center; gap: 5px;
                    font-size: 13px; height: ${rowMM}mm;
                }
                .m-grid .qnum {
                    text-align: right; font-weight: 700; flex-shrink: 0;
                    width: ${numPx * 2.8}px; font-size: ${numPx}px;
                }
                .m-grid .bubble {
                    width: ${bubblePx}px; height: ${bubblePx}px;
                    border: 1.5px solid #333; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 600; flex-shrink: 0; font-size: ${fontPx}px;
                }
                .m-anchor {
                    position: absolute;
                    width: 5mm; height: 5mm; background: #000;
                }
                .m-anchor.tl { top: 1mm; left: 1mm; }
                .m-anchor.tr { top: 1mm; right: 1mm; }
                .m-anchor.bl { bottom: 1mm; left: 1mm; }
                .m-anchor.br { bottom: 1mm; right: 1mm; }
            </style>
            <div class="m-sheet">
                <div class="m-inner">
                    <div class="m-header"></div>
                    <div class="m-student"></div>
                    <div class="m-grid-container">
                        <div class="m-grid">${gridHTML}</div>
                        <div class="m-anchor tl"></div>
                        <div class="m-anchor tr"></div>
                        <div class="m-anchor bl"></div>
                        <div class="m-anchor br"></div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(container);
        container.offsetHeight; // forzar layout

        const sheet = container.querySelector('.m-sheet');
        const sheetRect = sheet.getBoundingClientRect();
        const pxToMmX = 215.9 / sheetRect.width;
        const pxToMmY = 279.4 / sheetRect.height;

        // Medir burbujas
        const bubbles = container.querySelectorAll('.bubble');
        const rawPositions = [];
        bubbles.forEach(b => {
            const r = b.getBoundingClientRect();
            rawPositions.push({
                x: (r.left + r.width / 2 - sheetRect.left) * pxToMmX,
                y: (r.top  + r.height / 2 - sheetRect.top)  * pxToMmY
            });
        });

        // Medir marcas de anclaje
        const anchors = {};
        ['tl','tr','bl','br'].forEach(key => {
            const el = container.querySelector('.m-anchor.' + key);
            const r = el.getBoundingClientRect();
            anchors[key] = {
                x: (r.left + r.width / 2 - sheetRect.left) * pxToMmX,
                y: (r.top  + r.height / 2 - sheetRect.top)  * pxToMmY
            };
        });

        document.body.removeChild(container);

        // Mapear DOM order → [questionIndex][optionIndex]
        const positions = [];
        for (let q = 0; q < numQ; q++) positions[q] = [];

        let bIdx = 0;
        for (let col = 0; col < 3; col++) {
            for (let row = 0; row < perCol; row++) {
                const qIdx = col * perCol + row;
                if (qIdx >= numQ) break;
                for (let o = 0; o < 5; o++) {
                    positions[qIdx][o] = rawPositions[bIdx++];
                }
            }
        }

        console.log('[Printer] Posiciones medidas para', numQ, 'preguntas (4 anclajes).');
        return { positions, anchors };
    },

    async printBatch(exam, studentsList) {
        const css = `
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Outfit', sans-serif; background: #e2e8f0; }

            .sheet {
                width: 215.9mm;
                height: 279.4mm;
                background: white;
                margin: 20px auto;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                position: relative;
                page-break-after: always;
                overflow: hidden;
            }

            /* .inner: posición exacta usada por el escáner para calcular offsets */
            .inner {
                position: absolute;
                top: 22mm; left: 22mm; right: 22mm; bottom: 22mm;
                display: flex; flex-direction: column;
            }\n
            /* ── HEADER ROW ── */
            .header-row {
                display: flex;
                align-items: stretch;
                gap: 8px;
                border-bottom: 3px solid #1e1b4b;
                padding-bottom: 6px;
                margin-bottom: 6px;
                min-height: 34mm;
                max-height: 34mm;
            }

            /* QR: 32mm para mejor detección */
            .qr-wrapper {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                flex-shrink: 0;
                width: 32mm;
            }
            .qr-img {
                width: 32mm;
                height: 32mm;
                display: block;
                image-rendering: pixelated;
                background: white;
            }
            .qr-label {
                font-size: 6px;
                text-align: center;
                color: #555;
                margin-top: 1px;
                max-width: 32mm;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .header-center {
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
                gap: 3px;
                overflow: hidden;
            }
            .header-logo {
                max-height: 12mm;
                max-width: 100%;
                object-fit: contain;
            }
            .exam-title { font-size: 17px; font-weight: 800; color: #1e1b4b; line-height: 1.1; }
            .exam-sub   { font-size: 9px; color: #666; }

            .exam-meta {
                font-size: 10px;
                line-height: 1.7;
                text-align: right;
                align-self: center;
                flex-shrink: 0;
                min-width: 42mm;
                max-width: 50mm;
            }

            /* ── STUDENT BOX ── */
            .student-box {
                background: #f8fafc;
                border: 2px solid #94a3b8;
                border-radius: 6px;
                padding: 6px 12px;
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                min-height: 17mm;
                max-height: 17mm;
                overflow: hidden;
            }
            .std-name { font-size: 13px; font-weight: 700; }
            .std-info  { font-size: 10px; display: flex; gap: 14px; align-items: center; }
            .std-id    {
                font-size: 12px; font-weight: 800;
                border: 2px solid #1e1b4b; padding: 2px 9px;
                border-radius: 4px; background: white; color: #1e1b4b;
            }

            /* ── GRILLA DE BURBUJAS (con borde y anclaje) ── */
            .grid-container {
                flex: 1;
                position: relative;
                border: 3px solid #000;
                padding: 7mm;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .bubbles-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 24px; }
            .col   { display: flex; flex-direction: column; gap: 4px; }
            .qrow  { display: flex; align-items: center; gap: 5px; font-size: 13px; }
            .qnum  { text-align: right; font-weight: 700; flex-shrink: 0; }
            .bubble {
                border: 1.5px solid #333; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-weight: 600; flex-shrink: 0;
            }

            /* Marcadores de esquina: cuadro negro en las 4 esquinas de la grilla */
            .anchor-mark {
                position: absolute;
                width: 5mm; height: 5mm;
                background: #000 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
                z-index: 10;
            }
            .anchor-mark.tl { top: 1mm; left: 1mm; }
            .anchor-mark.tr { top: 1mm; right: 1mm; }
            .anchor-mark.bl { bottom: 1mm; left: 1mm; }
            .anchor-mark.br { bottom: 1mm; right: 1mm; }

            /* Footer */
            .footer {
                margin-top: auto;
                border-top: 2px dashed #ccc;
                padding-top: 6px;
                font-size: 11px;
                color: #666;
                text-align: center;
            }

            @media print {
                @page { size: letter portrait; margin: 0; }
                html, body { background: white; margin: 0; padding: 0; }
                .sheet { margin: 0 !important; box-shadow: none !important; border: none; }
                .no-print { display: none !important; }
            }
            @media screen { body { padding-top: 52px; padding-bottom: 52px; } }
        `;

        const sheetsHTML = studentsList.map(s => this.buildSheetHTML(exam, s)).join('');

        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Impresión — ${exam.name}</title>
    <style>${css}</style>
</head>
<body>
    <div class="no-print" style="position:fixed;top:0;left:0;right:0;background:#1e1b4b;color:white;padding:12px;text-align:center;z-index:9999;font-family:sans-serif;">
        📄 ${studentsList.length} exámenes — <strong>1 por Hoja Carta</strong>
        <button onclick="window.print()" style="background:#6366f1;color:white;border:none;padding:6px 18px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:10px;">⬇️ Imprimir</button>
        <button onclick="window.close()" style="background:transparent;color:white;border:1px solid white;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:8px;">✖</button>
    </div>
    <div>${sheetsHTML}</div>
</body>
</html>`);
        win.document.close();
    }
};
