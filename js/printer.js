/**
 * ZIPCASTELLANO PRINTER v2.0 — Layout Adaptativo y OMR Optimizado
 * 
 * Geometría centralizada para impresión y escaneo.
 */
const printer = {

    /**
     * Función CENTRAL que calcula toda la geometría. 
     * Usada por generateColumns Y measureBubblePositions.
     */
    getLayout(numQ, numOptions = 5) {
        const OPTS = 'ABCDE'.slice(0, numOptions);
        // Regla de columnas: 1-25:1, 26-50:2, 51-90:3, 91-120:4, 121-150:5
        const cols = numQ <= 25 ? 1 : numQ <= 50 ? 2 : numQ <= 90 ? 3 : numQ <= 120 ? 4 : 5;
        const perCol = Math.ceil(numQ / cols);
        
        // Área disponible de la grilla (dentro del grid-container con padding 12mm para librar anclajes de 8mm)
        // .inner ancho = 215.9mm - 44mm = 171.9mm
        const gridWidthMM = 171.9 - 24; // inner - 2*padding = 147.9mm
        const colGapMM = 6;             // gap entre columnas
        const colWidthMM = (gridWidthMM - (cols - 1) * colGapMM) / cols;
        
        // Alto disponible por fila
        const gridHeightMM = 159;       // altura aproximada del grid-container
        const rowGapMM = 1.5;           // gap estimado (4px ≈ 1.058mm)
        const rowMM = Math.min(12, Math.max(5, (gridHeightMM - (perCol - 1) * rowGapMM) / perCol));
        
        // Tamaño de burbuja: el mínimo de dos restricciones (ancho y alto)
        const PX = 0.2646; // mm por px a 96dpi
        const bubbleFromWidth = Math.floor(colWidthMM / numOptions / PX * 0.62);
        const bubbleFromHeight = Math.floor(rowMM / PX * 0.80);
        
        // Clampeado final: 18-30px
        const bubblePx = Math.min(Math.max(18, bubbleFromWidth), Math.max(18, bubbleFromHeight), 30);
        
        const fontPx  = Math.round(bubblePx * 0.55);
        const numPx   = Math.round(bubblePx * 0.65);
        const numWidthPx = numPx * 2.5;
        
        return {
            cols, perCol, opts: OPTS,
            rowMM, rowGapMM, colWidthMM, colGapMM,
            bubblePx, fontPx, numPx, numWidthPx,
            gridWidthMM, gridHeightMM, bubbleRadius: (bubblePx * PX) / 2,
            numQ, numOptions,
            // Métricas proporcionales para el scanner v2.1
            paddingMM: 12,
            innerW: 171.9,
            innerH: 235.4 // Estimado 279.4 - 44
        };
    },

    generateColumns(numQ, numOptions = 5) {
        const L = this.getLayout(numQ, numOptions);
        let html = '';
        
        for (let c = 0; c < L.cols; c++) {
            html += `<div class="col">`;
            for (let r = 0; r < L.perCol; r++) {
                const i = c * L.perCol + r + 1;
                if (i > numQ) break;
                
                const isGroupSep = (i % 5 === 0 && i < numQ && numQ > 25);
                
                html += `
                <div class="qrow ${isGroupSep ? 'group-sep' : ''}" style="height:${L.rowMM}mm;">
                    <span class="qnum" style="width:${L.numWidthPx}px; font-size:${L.numPx}px;">${i}</span>
                    ${L.opts.split('').map(letter => 
                        `<div class="bubble" style="width:${L.bubblePx}px; height:${L.bubblePx}px; font-size:${L.fontPx}px;">${letter}</div>`
                    ).join('')}
                </div>`;
            }
            html += '</div>';
        }
        return html;
    },

    buildSheetHTML(exam, student) {
        const numQ = exam.questions.length;
        const numOptions = exam.numOptions || 5;
        const L = this.getLayout(numQ, numOptions);

        // QR URL incluye numOptions: ZC|studentId|examId|numOptions
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=450x450&margin=0&data=ZC|${encodeURIComponent(student.id)}|${encodeURIComponent(exam.id)}|${numOptions}`;

        return `
        <div class="sheet">
            <div class="inner">

                <!-- ══ HEADER ROW ══ -->
                <div class="header-row">
                    <!-- QR CODE — 36mm -->
                    <div class="qr-wrapper">
                        <img src="${qrUrl}" class="qr-img" title="QR Identificador" alt="QR">
                        <div class="qr-label">ID: ${student.id}</div>
                    </div>

                    <!-- Membrete central -->
                    <div class="header-center">
                        <img src="https://i.postimg.cc/VN6nHMHm/Imagen1.jpg" alt="Membrete" class="header-logo">
                        <div class="exam-title">HOJA DE RESPUESTAS</div>
                        <div class="exam-sub">Seguimiento de Competencias · ZipCastellano v2.0</div>
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

                <!-- ══ GRILLA DE BURBUJAS ══ -->
                <div class="grid-container">
                    <div class="bubbles-grid" style="grid-template-columns: repeat(${L.cols}, 1fr);">
                        ${this.generateColumns(numQ, numOptions)}
                    </div>
                    <!-- Marcadores de esquina (Anchors) de 8mm -->
                    <div class="anchor-mark tl"></div>
                    <div class="anchor-mark tr"></div>
                    <div class="anchor-mark bl"></div>
                    <div class="anchor-mark br"></div>
                </div>

                <div class="footer">
                    <span>P: ${numQ} | Opc: ${numOptions}</span>
                    <span>Instrucción: Rellene con una X oscura la opción correcta.</span>
                    <span>ZipCastellano v2.1</span>
                </div>

            </div><!-- /inner -->
        </div><!-- /sheet -->`;
    },

    /**
     * Medir posiciones REALES de las burbujas desde el DOM virtual.
     */
    measureBubblePositions(numQ, numOptions = 5) {
        const L = this.getLayout(numQ, numOptions);
        const gridHTML = this.generateColumns(numQ, numOptions);

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;z-index:-1;';
        
        // CSS idéntico al real de impresión para precisión máxima
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
                    min-height: 38mm; max-height: 38mm;
                    padding-bottom: 5px; margin-bottom: 6px;
                }
                .m-student {
                    min-height: 17mm; max-height: 17mm;
                    margin-bottom: 6px;
                }
                .m-grid-container {
                    flex: 1; position: relative;
                    border: 3px solid #000; padding: 12mm;
                }
                .m-grid {
                    display: grid;
                    grid-template-columns: repeat(${L.cols}, 1fr);
                    gap: 0 6mm;
                    height: 100%;
                }
                .m-col { display: flex; flex-direction: column; gap: 0; }
                .m-qrow {
                    display: flex; align-items: center; gap: 4px;
                    height: ${L.rowMM}mm;
                }
                .m-qnum {
                    text-align: right; font-weight: 800;
                    width: ${L.numWidthPx}px; font-size: ${L.numPx}px;
                }
                .m-bubble {
                    width: ${L.bubblePx}px; height: ${L.bubblePx}px;
                    border: 2px solid #1a1a1a; border-radius: 50%;
                    background: #ffffff;
                }
                .m-anchor {
                    position: absolute; width: 8mm; height: 8mm; background: #000;
                }
                .m-anchor.tl { top: 2mm; left: 2mm; }
                .m-anchor.tr { top: 2mm; right: 2mm; }
                .m-anchor.bl { bottom: 2mm; left: 2mm; }
                .m-anchor.br { bottom: 2mm; right: 2mm; }
            </style>
            <div class="m-sheet">
                <div class="m-inner">
                    <div class="m-header"></div>
                    <div class="m-student"></div>
                    <div class="m-grid-container">
                        <div class="m-grid">${gridHTML.replace(/col/g, 'm-col').replace(/qrow/g, 'm-qrow').replace(/qnum/g, 'm-qnum').replace(/bubble/g, 'm-bubble')}</div>
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
        const bubbles = container.querySelectorAll('.m-bubble');
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
        for (let col = 0; col < L.cols; col++) {
            for (let row = 0; row < L.perCol; row++) {
                const qIdx = col * L.perCol + row;
                if (qIdx >= numQ) break;
                for (let o = 0; o < numOptions; o++) {
                    positions[qIdx][o] = rawPositions[bIdx++];
                }
            }
        }

        return { positions, anchors };
    },

    async printBatch(exam, studentsList) {
        const css = `
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap');
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Outfit', sans-serif; background: #e2e8f0; }

            .sheet {
                width: 215.9mm; height: 279.4mm;
                background: white; margin: 20px auto;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                position: relative; page-break-after: always;
                overflow: hidden;
            }

            .inner {
                position: absolute;
                top: 22mm; left: 22mm; right: 22mm; bottom: 22mm;
                display: flex; flex-direction: column;
            }

            .header-row {
                display: flex; align-items: stretch; gap: 8px;
                border-bottom: 3px solid #1e1b4b;
                padding-bottom: 5px; margin-bottom: 6px;
                min-height: 38mm; max-height: 38mm;
            }

            .qr-wrapper { width: 36mm; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }
            .qr-img { width: 36mm; height: 36mm; display: block; image-rendering: pixelated; background: white; }
            .qr-label { font-size: 7px; text-align: center; color: #555; margin-top: 1px; }

            .header-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 3px; }
            .header-logo { max-height: 12mm; max-width: 100%; object-fit: contain; }
            .exam-title { font-size: 17px; font-weight: 800; color: #1e1b4b; line-height: 1.1; }
            .exam-sub { font-size: 9px; color: #666; }

            .exam-meta { font-size: 10px; line-height: 1.6; text-align: right; align-self: center; min-width: 45mm; }

            .student-box {
                background: #f8fafc; border: 2px solid #94a3b8; border-radius: 6px;
                padding: 6px 12px; margin-bottom: 6px;
                display: flex; justify-content: space-between; align-items: center;
                min-height: 17mm; max-height: 17mm;
            }
            .std-name { font-size: 13px; font-weight: 700; }
            .std-info { font-size: 10px; display: flex; gap: 14px; align-items: center; }
            .std-id { font-size: 12px; font-weight: 800; border: 2px solid #1e1b4b; padding: 2px 9px; border-radius: 4px; background: white; color: #1e1b4b; }

            .grid-container {
                flex: 1; position: relative;
                border: 3px solid #000; padding: 12mm;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            .bubbles-grid { display: grid; gap: 0 6mm; height: 100%; }

            .col { display: flex; flex-direction: column; gap: 0; }
            .col:not(:last-child) { border-right: 1px solid #ddd; padding-right: 3mm; }
            .col:not(:first-child) { padding-left: 3mm; }

            .qrow { display: flex; align-items: center; gap: 4px; }
            .qnum { text-align: right; font-weight: 800; color: #000; }
            
            .bubble {
                border: 2px solid #1a1a1a; border-radius: 50%;
                background: #ffffff !important;
                display: flex; align-items: center; justify-content: center;
                font-weight: 700; color: #333; flex-shrink: 0;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }

            .group-sep { border-bottom: 0.8px dashed #aaa !important; padding-bottom: 1px; margin-bottom: 1px; }

            .anchor-mark {
                position: absolute; width: 8mm; height: 8mm;
                background: #000000 !important;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
                z-index: 10;
            }
            .anchor-mark.tl { top: 2mm; left: 2mm; }
            .anchor-mark.tr { top: 2mm; right: 2mm; }
            .anchor-mark.bl { bottom: 2mm; left: 2mm; }
            .anchor-mark.br { bottom: 2mm; right: 2mm; }

            .footer {
                margin-top: 3px; border-top: 1px solid #bbb; padding-top: 3px;
                font-size: 9px; color: #555; text-align: center;
                display: flex; justify-content: space-between;
            }

            @media print {
                @page { size: letter portrait; margin: 0; }
                html, body { background: white; margin: 0; padding: 0; }
                .sheet { margin: 0 !important; box-shadow: none !important; border: none; }
                .no-print { display: none !important; }
            }
        `;

        const sheetsHTML = studentsList.map(s => this.buildSheetHTML(exam, s)).join('');

        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>ZipCastellano v2.0 — ${exam.name}</title>
    <style>${css}</style>
</head>
<body>
    <div class="no-print" style="position:fixed;top:0;left:0;right:0;background:#1e1b4b;color:white;padding:12px;text-align:center;z-index:9999;font-family:sans-serif;">
        📄 ${studentsList.length} exámenes — ZipCastellano v2.0
        <button onclick="window.print()" style="background:#10b981;color:white;border:none;padding:6px 18px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:10px;font-weight:700;">🖨️ Imprimir Todo</button>
        <button onclick="window.close()" style="background:transparent;color:white;border:1px solid white;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:8px;">✖ Cerrar</button>
    </div>
    <div>${sheetsHTML}</div>
</body>
</html>`);
        win.document.close();
    }
};
