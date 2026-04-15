const printer = {
    generateColumns(count) {
        const perCol = Math.ceil(count / 3);

        // Espacio disponible en la hoja para las burbujas (mm):
        // inner=253mm − header≈22 − examInfo≈14 − studentBox≈22 − gaps≈12 − footer≈10 = 173mm
        const availableMM = 173;
        const rowMM   = Math.min(10.5, Math.max(5.5, availableMM / perCol));
        const bubblePx = Math.round(Math.min(17, Math.max(13, rowMM * 5.5)));
        const fontPx   = Math.round(Math.min(10, Math.max(7,  rowMM * 3.2)));
        const numPx    = Math.round(Math.min(12, Math.max(8,  rowMM * 3.8)));

        let html = '';
        for (let c = 0; c < 3; c++) {
            html += `<div style="display:flex;flex-direction:column;">`;
            for (let i = 1; i <= perCol; i++) {
                const qNum = c * perCol + i;
                if (qNum > count) break;
                html += `
                <div style="display:flex;align-items:center;gap:3px;height:${rowMM}mm;font-size:${fontPx}px;">
                    <span style="width:${numPx * 1.8}px;text-align:right;font-weight:700;font-size:${numPx}px;">${qNum}</span>
                    ${'ABCDE'.split('').map(l =>
                        `<div style="width:${bubblePx}px;height:${bubblePx}px;border:1.5px solid #333;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${fontPx}px;font-weight:700;flex-shrink:0;">${l}</div>`
                    ).join('')}
                </div>`;
            }
            html += '</div>';
        }
        return html;
    },

    buildSheetHTML(exam, student) {
        return `
        <div class="page-wrapper">
            <div class="page">
                <!-- Marcadores Fiduciales -->
                <div class="corner tl"></div>
                <div class="corner tr"></div>
                <div class="corner bl"></div>
                <div class="corner br"></div>

                <!-- Contenido -->
                <div class="inner">
                <div class="header-img">
                    <img src="https://i.postimg.cc/VN6nHMHm/Imagen1.jpg" alt="Membrete">
                </div>

                <div class="exam-info">
                    <div>
                        <div class="exam-title">HOJA DE RESPUESTAS</div>
                        <div class="exam-sub">Seguimiento de Competencias · Castellano ICFES</div>
                    </div>
                    <div class="exam-meta">
                        <b>Examen:</b> ${exam.name}<br>
                        <b>Fecha:</b> ${new Date(exam.date).toLocaleDateString()}
                    </div>
                </div>

                <div class="student-box">
                    <div>
                        <div class="std-name"><b>Estudiante:</b> ${student.name}</div>
                        <div class="std-info">
                            <span><b>Grado:</b> ${student.grade}</span>
                            <span class="std-id">ID: ${student.id}</span>
                        </div>
                    </div>
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=ZC|${encodeURIComponent(student.id)}|${encodeURIComponent(exam.id)}"
                         style="width:70px;height:70px;border:2px solid #333;border-radius:4px;background:white;"
                         title="QR Identificador">
                </div>

                <div class="bubbles-grid" style="flex:1;">
                    ${this.generateColumns(exam.questions.length)}
                </div>

                <div class="footer">
                    INSTRUCCIÓN: Marque con oscura (X) las burbujas. No raye los 4 cuadritos esquineros.
                </div>

                </div><!-- /inner -->
            </div><!-- /page -->
        </div><!-- /page-wrapper -->`;
    },

    async printBatch(exam, studentsList) {
        const css = `
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Outfit', sans-serif; background: #e2e8f0; }
            
            .sheet {
                width: 215.9mm;  /* Carta */
                height: 279.4mm; /* Carta */
                background: white;
                margin: 20px auto;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                display: flex;
                flex-wrap: wrap;
                page-break-after: always;
                align-content: flex-start;
            }

            .page-wrapper {
                width: 107.95mm; /* Mitad de ancho Carta */
                height: 139.7mm; /* Mitad de alto Carta */
                position: relative;
                overflow: hidden;
                box-sizing: border-box;
                border-right: 1px dashed #cbd5e1;
                border-bottom: 1px dashed #cbd5e1;
            }

            .page {
                position: absolute;
                top: 0; left: 0;
                width: 215.9mm;
                height: 279.4mm;
                background: white;
                /* El secreto para meterlo perfecto en un cuarto de hoja */
                transform: scale(0.5);
                transform-origin: top left;
            }
            .inner {
                position: absolute;
                top: 22mm; left: 22mm; right: 22mm; bottom: 22mm;
                display: flex; flex-direction: column;
            }
            .corner {
                position: absolute; width: 14mm; height: 14mm; background: black !important;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            .tl { top: 4mm;  left: 4mm; }
            .tr { top: 4mm;  right: 4mm; }
            .bl { bottom: 4mm; left: 4mm; }
            .br { bottom: 4mm; right: 4mm; }

            .header-img { text-align: center; border-bottom: 3px solid #1e1b4b; padding-bottom: 8px; margin-bottom: 10px; }
            .header-img img { width: 100%; max-height: 75px; object-fit: contain; }

            .exam-info { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; font-size: 11px; }
            .exam-title { font-size: 18px; font-weight: 800; color: #1e1b4b; }
            .exam-sub { font-size: 10px; color: #666; }
            .exam-meta { text-align: right; line-height: 1.6; }

            .student-box {
                background: #f8fafc; border: 2px solid #94a3b8; border-radius: 6px;
                padding: 8px 12px; margin-bottom: 18px; display: flex;
                justify-content: space-between; align-items: center;
            }
            .std-name { font-size: 14px; font-weight: 700; margin-bottom:4px; }
            .std-info { font-size: 11px; display: flex; gap: 20px; align-items: center; }
            .std-id { font-size: 14px; font-weight: 800; border: 2px solid #1e1b4b; padding: 3px 10px; border-radius: 4px; background: white; color: #1e1b4b; }

            .bubbles-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 24px; }
            .col { display: flex; flex-direction: column; gap: 3px; }
            .qrow { display: flex; align-items: center; gap: 5px; height: 20px; font-size: 11px; }
            .qnum { width: 22px; text-align: right; font-weight: 700; }
            .bubble { width: 17px; height: 17px; border: 1.5px solid #333; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 600; }

            .footer { position: absolute; bottom: 15mm; left: 15mm; right: 15mm; border-top: 1px dashed #ccc; padding-top: 8px; font-size: 10px; color: #888; text-align: center; }

            @media print {
                @page { size: letter portrait; margin: 0; }
                html, body { background: white; margin: 0; padding: 0; }
                .sheet { margin: 0 !important; box-shadow: none !important; border:none; }
                .page-wrapper { border: none !important; } /* Ocultar las líneas para no gastar tanta tinta o si la imp ya recorta */
                .page-wrapper:nth-child(odd) { border-right: 1px dashed #e2e8f0 !important; }
                .page-wrapper:not(:nth-last-child(-n+2)) { border-bottom: 1px dashed #e2e8f0 !important; }
                .no-print { display: none !important; }
            }
            @media screen { body { padding-top: 52px; padding-bottom: 52px; } }
        `;

        const allWrappers = studentsList.map(s => this.buildSheetHTML(exam, s));
        let sheetsHTML = '';
        for (let i = 0; i < allWrappers.length; i += 4) {
            sheetsHTML += '<div class="sheet">' + allWrappers.slice(i, i+4).join('') + '</div>';
        }

        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Hojas - 4 por página - ${exam.name}</title>
    <style>${css}</style>
</head>
<body>
    <div class="no-print" style="position:fixed;top:0;left:0;right:0;background:#1e1b4b;color:white;padding:12px;text-align:center;z-index:9999;font-family:sans-serif;">
        📄 ${studentsList.length} exámenes formatados a <strong>4 por Hoja Carta</strong> (Total: ${Math.ceil(studentsList.length/4)} hojas) · 
        <button onclick="window.print()" style="background:#6366f1;color:white;border:none;padding:6px 18px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:10px;">⬇️ Imprimir</button>
        <button onclick="window.close()" style="background:transparent;color:white;border:1px solid white;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:8px;">✖</button>
    </div>
    <div>${sheetsHTML}</div>
</body>
</html>`);
        win.document.close();
    }
};
