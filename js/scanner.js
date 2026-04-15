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
    currentStudent: null,
    currentExam: null,
    currentResult: null,
    cooldown: false,
    clickBound: null,

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
            this.currentStudent = null;
            this.currentExam = exam;
            this.lastQR = null;
            
            if (!this.clickBound) {
                this.clickBound = this.onAppTap.bind(this);
                this.canvas.addEventListener('click', this.clickBound);
            }

            this.setStatus('🔍 Busca el QR y alinea la hoja...', 'var(--accent)');
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
        if (this.clickBound) {
            this.canvas.removeEventListener('click', this.clickBound);
            this.clickBound = null;
        }
    },

    /* ─── Tap to Capture ─── */
    onAppTap() {
        if (!this.isActive || this.cooldown) return;
        if (!this.currentStudent || !this.currentExam) {
            app.toast('⚠️ Primero enfoca el código QR para identificar al estudiante.', true);
            return;
        }
        
        // Tap para calificar!
        this.cooldown = true;
        this.setStatus(`✅ Capturando burbujas... ¡No te muevas!`, 'var(--accent)');
        
        // Timeout muy breve para dejar que la cámara capte el tap sin borrosidad
        setTimeout(() => {
            this.gradeSheet(this.currentStudent, this.currentExam);
        }, 300);
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
            if (qr.data !== this.lastQR) {
                this.lastQR = qr.data;
                this.onQRDetected(qr.data);
            }
        }
        
        this.drawOverlay();
    },

    /* ─── QR detectado ─── */
    onQRDetected(data) {
        const parts = data.split('|');
        if (parts.length < 3) return;
        
        const studentId = decodeURIComponent(parts[1]);
        const examId    = decodeURIComponent(parts[2]);

        const exam    = exams.list.find(e => e.id === examId);
        const student = students.list.find(s => String(s.id) === String(studentId));

        if (!exam || !student) {
            this.setStatus('⚠️ Datos no coincidentes. ¿Sincronizaste?', 'orange');
            return;
        }

        this.currentStudent = student;
        this.currentExam = exam;
        this.setStatus(`✅ ${student.name} - TOCA LA PANTALLA PARA CALIFICAR`, '#10b981');
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
        const W = canvas.width;
        const H = canvas.height;

        // Recuperar zona A4 que se pinta en la pantalla (las guías rojas)
        const margin = 20;
        let pW, pH;
        if (H > W) {
            pW = W - margin * 2;
            pH = pW * 1.414;
            if (pH > H - margin * 2) {
                pH = H - margin * 2;
                pW = pH / 1.414;
            }
        } else {
            pH = H - margin * 2;
            pW = pH / 1.414;
        }
        const pX = (W - pW) / 2;
        const pY = (H - pH) / 2;

        // Dentro del papel A4, la cuadricula de burbujas inicia ~26% hacia abajo y ~10% a la izquierda
        // Estas son proporciones basadas en printer.js:
        // top: 22mm + header(28mm) + info(15mm) + student(25mm) = 90mm. 90/297 = 0.30 (30% de la altura total ajustado visualmente)
        // izquierda: 22mm / 210mm = 0.104
        
        const zoneX = pX + (pW * 0.12);
        const zoneY = pY + (pH * 0.32);
        const zoneW = pW * 0.76;
        const zoneH = pH * 0.50; // El espacio donde caben todas

        const numQ   = exam.questions.length;
        const cols   = 3;
        const rows   = Math.ceil(numQ / cols);
        const colW   = zoneW / cols;
        // La altura de cada fila se calcula con printer (maximo 10.5mm / 297mm = 0.035)
        const rowH   = Math.min(pH * 0.035, zoneH / rows); 
        const options = ['A', 'B', 'C', 'D', 'E'];
        const answers = [];

        // Modo debug: pintar recuadro master del A4 en verde rápido
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2;
        ctx.strokeRect(zoneX, zoneY, zoneW, zoneH);

        for (let q = 0; q < numQ; q++) {
            const col = Math.floor(q / rows);
            const row = q % rows;

            const qX = zoneX + col * colW;
            const qY = zoneY + row * rowH;

            // En la celda, las esferitas ABCDE ocupan la derecha
            // Dejar 18% para el número y offset
            const optW = (colW * 0.6) / 5;
            const optStartX = qX + colW * 0.22;

            let darkestOption = 'A';
            let darkestScore  = Infinity;

            options.forEach((opt, oi) => {
                const ox = optStartX + oi * optW;
                const oy = qY + rowH * 0.1;
                const ow = optW * 0.8;
                const oh = rowH * 0.8;

                ctx.strokeRect(ox, oy, ow, oh); // feedback visual de qué procesa

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

            answers.push(darkestOption);
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

    drawOverlay() {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Guía A4 estricta para alinear
        const margin = 20;
        let pW, pH;
        if (H > W) {
            pW = W - margin * 2;
            pH = pW * 1.414;
            if (pH > H - margin * 2) {
                pH = H - margin * 2;
                pW = pH / 1.414;
            }
        } else {
            pH = H - margin * 2;
            pW = pH / 1.414;
        }
        
        const pX = (W - pW) / 2;
        const pY = (H - pH) / 2;

        const s = Math.min(W, H) * 0.1; // Tamaño de la esquina
        
        // Si ya reconoció al estudiante, las guías se ponen VERDES, si no, ROJAS.
        ctx.strokeStyle = this.currentStudent ? '#10b981' : '#ef4444';
        ctx.lineWidth = 4;

        // Dibujar 4 esquinas del A4
        [[pX, pY], [pX + pW - s, pY], [pX, pY + pH - s], [pX + pW - s, pY + pH - s]]
            .forEach(([x, y]) => ctx.strokeRect(x, y, s, s));

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';

        if (this.currentStudent) {
            ctx.fillStyle = '#10b981';
            ctx.fillText('¡TOCA LA PANTALLA!', W / 2, pY + pH / 2);
        } else {
            ctx.fillStyle = 'white';
            ctx.fillText('Alinea la hoja completa', W / 2, 40);
        }
    }
};

/* ─── eventos ─── */
document.getElementById('start-scan')?.addEventListener('click', () => scanner.start());
document.getElementById('stop-scan')?.addEventListener('click',  () => scanner.stop());
window.addEventListener('DOMContentLoaded', () => scanner.init());
