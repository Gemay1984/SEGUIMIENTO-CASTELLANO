const printer = {
    generateColumns(count) {
        const perCol = Math.ceil(count / 3);

        // Espacio disponible en la hoja: 173mm
        const availableMM = 173;
        const rowMM   = Math.min(10.5, Math.max(5.5, availableMM / perCol));
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
        return `
        <div class="sheet">
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
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=ZC|${encodeURIComponent(student.id)}|${encodeURIComponent(exam.id)}"
                     style="width:130px;height:130px;border:3px solid #333;border-radius:6px;background:white;flex-shrink:0;"
                     title="QR Identificador">
            </div>

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

            .exam-info { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; font-size: 13px; }
            .exam-title { font-size: 22px; font-weight: 800; color: #1e1b4b; }
            .exam-sub { font-size: 12px; color: #666; }
            .exam-meta { text-align: right; line-height: 1.6; }

            .student-box {
                background: #f8fafc; border: 2px solid #94a3b8; border-radius: 6px;
                padding: 12px 16px; margin-bottom: 22px; display: flex;
                justify-content: space-between; align-items: center;
            }
            .std-name { font-size: 16px; font-weight: 700; margin-bottom:6px; }
            .std-info { font-size: 13px; display: flex; gap: 20px; align-items: center; }
            .std-id { font-size: 15px; font-weight: 800; border: 2px solid #1e1b4b; padding: 4px 12px; border-radius: 4px; background: white; color: #1e1b4b; }

            .bubbles-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 24px; }
            .col { display: flex; flex-direction: column; gap: 4px; }
            .qrow { display: flex; align-items: center; gap: 5px; height: 20px; font-size: 13px; }
            .qnum { width: 28px; text-align: right; font-weight: 700; }
            .bubble { width: 20px; height: 20px; border: 1.5px solid #333; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; }

            .footer { position: absolute; bottom: 15mm; left: 15mm; right: 15mm; border-top: 2px dashed #ccc; padding-top: 8px; font-size: 12px; color: #666; text-align: center; }

            @media print {
                @page { size: letter portrait; margin: 0; }
                html, body { background: white; margin: 0; padding: 0; }
                .sheet { margin: 0 !important; box-shadow: none !important; border:none; }
                .no-print { display: none !important; }
            }
            @media screen { body { padding-top: 52px; padding-bottom: 52px; } }
        `;

        const allWrappers = studentsList.map(s => this.buildSheetHTML(exam, s));
        const sheetsHTML = allWrappers.join('');

        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Impresión Individual - ${exam.name}</title>
    <style>${css}</style>
</head>
<body>
    <div class="no-print" style="position:fixed;top:0;left:0;right:0;background:#1e1b4b;color:white;padding:12px;text-align:center;z-index:9999;font-family:sans-serif;">
        📄 ${studentsList.length} exámenes formatados a <strong>1 por Hoja Carta (A tamaño REAL)</strong>
        <button onclick="window.print()" style="background:#6366f1;color:white;border:none;padding:6px 18px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:10px;">⬇️ Imprimir</button>
        <button onclick="window.close()" style="background:transparent;color:white;border:1px solid white;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:8px;">✖</button>
    </div>
    <div>${sheetsHTML}</div>
</body>
</html>`);
        win.document.close();
    }
};
