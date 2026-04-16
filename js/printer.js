/**
 * ZIPCASTELLANO PRINTER v2
 *
 * Layout de la hoja rediseñado para máxima compatibilidad con el escáner:
 * - QR en esquina superior IZQUIERDA del .inner (posición fija y predecible)
 * - QR exactamente 28mm × 28mm (sin margen, sin borde)
 * - Header de altura fija 28mm + 6px gap = ~28.5mm total
 * - Student-box compacto (~17mm)
 * - Grilla de burbujas empieza en Y ≈ 28.5 + 6 + 17 + 6 = ~57.5mm desde top del .inner
 *
 * Esto permite al scanner.js calcular:
 *   GRID_OFFSET.x = +14mm (centro QR 14mm desde left → burbujas empiezan en x≈14mm → dx≈0)
 *   GRID_OFFSET.y = +57.5mm (distancia del centro del QR a la primera fila de burbujas)
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
        // QR URL con margin=0 para que jsQR detecte exactamente el área de datos (28mm)
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=0&data=ZC|${encodeURIComponent(student.id)}|${encodeURIComponent(exam.id)}`;

        return `
        <div class="sheet">
            <!-- Marcadores Fiduciales (14mm × 14mm, en las 4 esquinas) -->
            <div class="corner tl"></div>
            <div class="corner tr"></div>
            <div class="corner bl"></div>
            <div class="corner br"></div>

            <div class="inner">

                <!-- ══ HEADER ROW ══
                     El QR ocupa la columna izquierda (28mm fijos).
                     Su esquina TL coincide con el vértice TL del .inner.
                     El escáner calculará el offset a las burbujas desde el CENTRO del QR.
                -->
                <div class="header-row">
                    <!-- QR CODE — izquierda fija -->
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

                    <!-- Meta del examen (derecha) -->
                    <div class="exam-meta">
                        <b>Examen:</b> ${exam.name}<br>
                        <b>Fecha:</b> ${new Date(exam.date).toLocaleDateString()}<br>
                        <b>Grado:</b> ${exam.grade}
                    </div>
                </div>

                <!-- ══ STUDENT BOX (sin QR, solo texto) ══ -->
                <div class="student-box">
                    <div class="std-name"><b>Estudiante:</b> ${student.name}</div>
                    <div class="std-info">
                        <span><b>Grado:</b> ${student.grade}</span>
                        <span class="std-id">ID: ${student.id}</span>
                    </div>
                </div>

                <!-- ══ GRILLA DE BURBUJAS ══ -->
                <div class="bubbles-grid" style="flex:1;">
                    ${this.generateColumns(exam.questions.length)}
                </div>

                <div class="footer">
                    INSTRUCCIÓN: Marque con oscura (X) las burbujas. No raye los 4 cuadritos esquineros.
                </div>

            </div><!-- /inner -->
        </div><!-- /sheet -->`;
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
            }

            /* Marcadores de esquina */
            .corner {
                position: absolute; width: 14mm; height: 14mm; background: black !important;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            .tl { top: 4mm;  left: 4mm; }
            .tr { top: 4mm;  right: 4mm; }
            .bl { bottom: 4mm; left: 4mm; }
            .br { bottom: 4mm; right: 4mm; }

            /* ── HEADER ROW ── */
            .header-row {
                display: flex;
                align-items: stretch;
                gap: 8px;
                border-bottom: 3px solid #1e1b4b;
                padding-bottom: 6px;
                margin-bottom: 6px;
                /* Altura FIJA. Cambiar aquí = cambiar HEADER_MM en scanner.js */
                min-height: 28mm;
                max-height: 28mm;
            }

            /* QR: columna izquierda, 28mm exactos desde el borde del inner */
            .qr-wrapper {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                flex-shrink: 0;
                width: 28mm;
            }
            .qr-img {
                width: 28mm;
                height: 28mm;
                display: block;
                image-rendering: pixelated;
                background: white;
            }
            .qr-label {
                font-size: 6px;
                text-align: center;
                color: #555;
                margin-top: 1px;
                max-width: 28mm;
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
                /* ALTURA FIJA: el scanner.js depende de este valor exacto (17mm) */
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

            /* ── BURBUJAS ── */
            .bubbles-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 24px; }
            .col   { display: flex; flex-direction: column; gap: 4px; }
            .qrow  { display: flex; align-items: center; gap: 5px; font-size: 13px; }
            .qnum  { text-align: right; font-weight: 700; flex-shrink: 0; }
            .bubble {
                border: 1.5px solid #333; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-weight: 600; flex-shrink: 0;
            }

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
