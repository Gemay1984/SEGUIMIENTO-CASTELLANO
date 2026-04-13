/**
 * ZIPCASTELLANO SCANNER v2
 * Flujo:
 *  1. Profesor selecciona el examen activo.
 *  2. Activa la cámara trasera.
 *  3. Apunta al QR de la hoja → se detecta automáticamente (jsQR).
 *  4. El QR devuelve: "ZC|studentId|examId"
 *  5. Se identifica al estudiante y se analizan las burbujas.
 *  6. Se muestra el resultado y el profesor confirma para guardarlo.
 */

const scanner = {
    video: null,
    canvas: null,
    ctx: null,
    stream: null,
    isActive: false,
    lastQR: null,
    currentResult: null,
    cooldown: false,

    /* ─── Inicialización ─── */
    init() {
        this.populateExamSelect();
        document.getElementById('scan-exam-select')
            ?.addEventListener('change', () => this.updateExamInfo());
    },

    populateExamSelect() {
        const sel = document.getElementById('scan-exam-select');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">Selecciona un examen...</option>' +
            exams.list.map(e => `<option value="${e.id}" ${e.id === current ? 'selected' : ''}>${e.name} · ${e.grade}</option>`).join('');
    },

    updateExamInfo() {
        const sel = document.getElementById('scan-exam-select');
        const exam = exams.list.find(e => e.id === sel?.value);
        const info = document.getElementById('scan-exam-info');
        if (exam && info) {
            info.textContent = `${exam.questions.length} preguntas · ${exam.grade}`;
        }
    },

    getActiveExam() {
        const sel = document.getElementById('scan-exam-select');
        return exams.list.find(e => e.id === sel?.value) || null;
    },

    /* ─── Cámara ─── */
    async start() {
        const exam = this.getActiveExam();
        if (!exam) {
            alert('Selecciona un examen activo antes de escanear.');
            return;
        }
        this.video  = document.getElementById('video');
        this.canvas = document.getElementById('overlay');
        this.ctx    = this.canvas.getContext('2d', { willReadFrequently: true });

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            this.video.srcObject = this.stream;
            await this.video.play();
            this.isActive = true;
            this.setStatus('🔍 Busca el código QR de la hoja...', 'var(--accent)');
            this.loop();
        } catch (err) {
            console.error(err);
            alert('No se pudo acceder a la cámara. Verifica los permisos del navegador.');
        }
    },

    stop() {
        this.isActive = false;
        this.stream?.getTracks().forEach(t => t.stop());
        this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    },

    /* ─── Loop de procesamiento ─── */
    loop() {
        if (!this.isActive) return;

        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            this.canvas.width  = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.ctx.drawImage(this.video, 0, 0);
            this.processFrame();
        }
        requestAnimationFrame(() => this.loop());
    },

    processFrame() {
        if (this.cooldown) { this.drawOverlay(false); return; }

        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
        });

        if (qr && qr.data.startsWith('ZC|')) {
            this.drawOverlay(true, qr.location);
            if (qr.data !== this.lastQR) {
                this.lastQR = qr.data;
                this.onQRDetected(qr.data);
            }
        } else {
            this.drawOverlay(false);
        }
    },

    /* ─── QR detectado ─── */
    onQRDetected(data) {
        const parts = data.split('|');
        // Format: ZC|studentId|examId
        if (parts.length < 3) {
            this.setStatus('⚠️ QR no reconocido', 'orange');
            return;
        }
        const studentId = decodeURIComponent(parts[1]);
        const examId    = decodeURIComponent(parts[2]);

        const exam    = exams.list.find(e => e.id === examId);
        const student = students.list.find(s => String(s.id) === String(studentId));

        if (!exam) {
            this.setStatus('⚠️ Examen no encontrado en la app. ¿Sincronizaste?', 'orange');
            return;
        }
        if (!student) {
            this.setStatus(`⚠️ Estudiante ID "${studentId}" no encontrado`, 'orange');
            return;
        }

        // Congelar escáner y calificar
        this.cooldown = true;
        this.setStatus(`✅ Detectado: ${student.name} — Analizando burbujas...`, 'var(--accent)');
        this.gradeSheet(student, exam);
    },

    /* ─── Calificación de burbujas ─── */
    gradeSheet(student, exam) {
        // Captura el frame actual como imagen para análisis
        const snapCanvas = document.createElement('canvas');
        snapCanvas.width  = this.canvas.width;
        snapCanvas.height = this.canvas.height;
        const snapCtx = snapCanvas.getContext('2d');
        snapCtx.drawImage(this.video, 0, 0);

        const result = this.analyzeBubbles(snapCtx, snapCanvas, exam);
        this.showResult(student, exam, result);
    },

    analyzeBubbles(ctx, canvas, exam) {
        /**
         * ANÁLISIS DE BURBUJAS
         * Estrategia: 
         *  - Convertir a escala de grises
         *  - Dividir la zona de preguntas en filas y columnas
         *  - Para cada pregunta, determinar qué burbuja (A–E) tiene más pixeles oscuros
         * 
         * Nota: Para máxima precisión, el QR debe estar centrado y la hoja nivelada.
         * La zona de burbujas se estima en el 40-90% vertical de la imagen,
         * y en el 10-90% horizontal.
         */
        const W = canvas.width;
        const H = canvas.height;

        // Zona estimada de burbujas (puede ajustarse con calibración)
        const zoneX = Math.floor(W * 0.08);
        const zoneY = Math.floor(H * 0.42);
        const zoneW = Math.floor(W * 0.84);
        const zoneH = Math.floor(H * 0.46);

        const numQ   = exam.questions.length;
        const cols   = 3;
        const rows   = Math.ceil(numQ / cols);
        const colW   = zoneW / cols;
        const rowH   = zoneH / rows;
        const options = ['A', 'B', 'C', 'D', 'E'];

        const answers = [];

        for (let q = 0; q < numQ; q++) {
            const col = Math.floor(q / rows);
            const row = q % rows;

            const qX = zoneX + col * colW;
            const qY = zoneY + row * rowH;

            // Cada opción ocupa 1/5 del ancho de la celda de la pregunta
            const optW = colW * 0.7 / 5;
            const optStartX = qX + colW * 0.18; // dejar espacio para el número

            let darkestOption = null;
            let darkestScore  = Infinity;

            options.forEach((opt, oi) => {
                const ox = optStartX + oi * optW;
                const oy = qY + rowH * 0.1;
                const ow = optW * 0.8;
                const oh = rowH * 0.8;

                const imgData = ctx.getImageData(
                    Math.max(0, Math.floor(ox)),
                    Math.max(0, Math.floor(oy)),
                    Math.max(1, Math.floor(ow)),
                    Math.max(1, Math.floor(oh))
                );

                let brightness = 0;
                for (let p = 0; p < imgData.data.length; p += 4) {
                    brightness += (imgData.data[p] + imgData.data[p+1] + imgData.data[p+2]) / 3;
                }
                brightness /= (imgData.data.length / 4);

                if (brightness < darkestScore) {
                    darkestScore  = brightness;
                    darkestOption = opt;
                }
            });

            answers.push(darkestOption || 'A');
        }

        return answers;
    },

    /* ─── Mostrar resultado ─── */
    showResult(student, exam, detectedAnswers) {
        let correct = 0;
        const competencyMap = {};

        exam.questions.forEach((q, i) => {
            const isCorrect = detectedAnswers[i] === q.ans;
            if (isCorrect) correct++;
            if (!competencyMap[q.comp]) competencyMap[q.comp] = { correct: 0, total: 0 };
            competencyMap[q.comp].total++;
            if (isCorrect) competencyMap[q.comp].correct++;
        });

        const score    = Math.round((correct / exam.questions.length) * 100);
        const scoreStr = `${correct}/${exam.questions.length}`;

        // Guardar para confirmar luego
        this.currentResult = { student, exam, detectedAnswers, score, correct, pct: score, competencyMap };

        // Llenar el panel
        document.getElementById('res-name').textContent  = student.name;
        document.getElementById('res-grade').textContent = student.grade;
        document.getElementById('res-id').textContent    = student.id;
        document.getElementById('res-score').textContent = scoreStr;

        const compColors = { c1: '#6366f1', c2: '#f59e0b', c3: '#10b981', c4: '#ef4444' };
        const compNames  = { c1: 'Semántica', c2: 'Sintáctica', c3: 'Pragmática', c4: 'Enciclopédica' };
        document.getElementById('res-competencies').innerHTML = Object.keys(competencyMap).map(c => {
            const pct = Math.round((competencyMap[c].correct / competencyMap[c].total) * 100);
            return `<div style="background:${compColors[c]}22; border:1.5px solid ${compColors[c]}; color:${compColors[c]}; border-radius:6px; padding:8px 14px; font-size:0.85rem;">
                <b>${compNames[c]}</b><br>${pct}% (${competencyMap[c].correct}/${competencyMap[c].total})
            </div>`;
        }).join('');

        document.getElementById('result-panel').style.display = 'block';
        this.setStatus('📋 Revisa el resultado y confirma.', 'var(--accent)');
    },

    /* ─── Guardar resultado ─── */
    async saveResult() {
        if (!this.currentResult) return;
        const { student, exam, score, correct, pct, competencyMap } = this.currentResult;

        // Guardar localmente
        const resultObj = {
            date: new Date().toISOString(),
            studentId: student.id,
            studentName: student.name,
            grade: student.grade,
            examName: exam.name,
            examId: exam.id,
            score: `${correct}/${exam.questions.length}`,
            pct: pct,
            competencies: competencyMap
        };
        
        const history = JSON.parse(localStorage.getItem('zc_results') || '[]');
        history.push(resultObj);
        localStorage.setItem('zc_results', JSON.stringify(history));

        // Sincronizar con Sheets usando el nuevo método robusto (POST)
        if (settings.apiUrl) {
            app.toast('⏳ Sincronizando en la nube...');
            await app.pushResultToSheet(resultObj);
        }

        app.toast(`✅ ¡Evaluación de ${student.name} guardada!`);
        this.discardResult();
        app.updateDashboard();
    },

    discardResult() {
        this.currentResult = null;
        this.lastQR = null;
        this.cooldown = false;
        document.getElementById('result-panel').style.display = 'none';
        this.setStatus('🔍 Listo. Apunta al QR de la siguiente hoja...', 'var(--accent)');
    },

    /* ─── Helpers UI ─── */
    setStatus(msg, color = 'var(--accent)') {
        const el = document.getElementById('scan-status');
        if (el) { el.textContent = msg; el.style.color = color; }
    },

    drawOverlay(found, location) {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);

        if (found && location) {
            // Highlight QR polygon
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth   = 4;
            ctx.beginPath();
            ctx.moveTo(location.topLeftCorner.x,     location.topLeftCorner.y);
            ctx.lineTo(location.topRightCorner.x,    location.topRightCorner.y);
            ctx.lineTo(location.bottomRightCorner.x, location.bottomRightCorner.y);
            ctx.lineTo(location.bottomLeftCorner.x,  location.bottomLeftCorner.y);
            ctx.closePath();
            ctx.stroke();
        } else {
            // Guide corners
            const s = 60;
            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth   = 3;
            [[50, 50], [W - 50 - s, 50], [50, H - 50 - s], [W - 50 - s, H - 50 - s]]
                .forEach(([x, y]) => ctx.strokeRect(x, y, s, s));
            ctx.fillStyle = 'rgba(99,102,241,0.7)';
            ctx.font = '18px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Centra el QR de la hoja en la cámara', W / 2, 35);
        }
    }
};

/* ─── eventos ─── */
document.getElementById('start-scan')?.addEventListener('click', () => scanner.start());
document.getElementById('stop-scan')?.addEventListener('click',  () => scanner.stop());
window.addEventListener('DOMContentLoaded', () => scanner.init());
