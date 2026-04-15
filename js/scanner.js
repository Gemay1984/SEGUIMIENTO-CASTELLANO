/**
 * ZIPCASTELLANO SCANNER v3
 * Flujo:
 *  1. Profesor selecciona el examen activo.
 *  2. Activa la cámara trasera.
 *  3. Apunta al QR de la hoja → se detecta automáticamente (jsQR).
 *  4. El QR devuelve: "ZC|studentId|examId"
 *  5. Se identifica al estudiante y se analizan las burbujas.
 *  6. Se muestra el resultado CON IMAGEN CALIFICADA y el profesor confirma para guardarlo.
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
    gradedImageDataUrl: null,

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
    onAppTap(e) {
        // Prevenir que el click se propague
        e.stopPropagation();
        e.preventDefault();
        
        if (!this.isActive || this.cooldown) return;
        
        if (!this.currentStudent || !this.currentExam) {
            app.toast('⚠️ Primero enfoca el código QR para identificar al estudiante.', true);
            return;
        }

        this.cooldown = true;
        this.setStatus(`✅ Calificando examen de ${this.currentStudent.name}...`, 'var(--accent)');
        
        // Feedback háptico
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        
        setTimeout(() => {
            this.gradeSheet(this.currentStudent, this.currentExam);
        }, 200); // Pequeño retraso para evitar fotos movidas
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
        if (this.cooldown) { this.drawOverlay(); return; }

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

        // Feedback sonoro y háptico
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        try {
            const actx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = actx.createOscillator();
            osc.type = 'sine'; osc.frequency.setValueAtTime(880, actx.currentTime);
            osc.connect(actx.destination);
            osc.start(); osc.stop(actx.currentTime + 0.15);
        } catch (e) {}

        this.setStatus(`✅ Estudiante: ${student.name} — ¡TOCA LA PANTALLA PARA CALIFICAR!`, '#10b981');
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
        
        // Generar imagen calificada con marcas visuales
        this.generateGradedImage(snapCtx, snapCanvas, exam, result);
        
        this.showResult(student, exam, result);
    },

    analyzeBubbles(ctx, canvas, exam) {
        const W = canvas.width;
        const H = canvas.height;

        // Guía estricta para el bounding box de CUADROS NEGROS (1.305)
        // Lógicos: Ancho = 207.9mm, Alto = 271.4mm -> Ratio = 1.3054
        const margin = 20;
        let pW, pH;
        if (H > W) {
            pW = W - margin * 2;
            pH = pW * 1.3054;
            if (pH > H - margin * 2) {
                pH = H - margin * 2;
                pW = pH / 1.3054;
            }
        } else {
            pH = H - margin * 2;
            pW = pH / 1.3054;
        }
        const pX = (W - pW) / 2;
        const pY = (H - pH) / 2;

        // --- MAPA MILIMÉTRICO LÓGICO ---
        const logicW = 207.9;
        const logicH = 271.4;
        const mmToPx = pW / logicW;

        const innerLeftLogic = 18;
        const innerTopLogic  = 18;
        
        // Elementos antes de la grilla de burbujas:
        // imgHeader(96) + examInfo(52) + studentBox(134) = 282px / 3.78 = 74.6mm
        const gridTopLogic = innerTopLogic + 74.6; 
        
        const zoneX = pX + (innerLeftLogic * mmToPx);
        const zoneY = pY + (gridTopLogic * mmToPx);
        const zoneW = pW * (171.9 / logicW);
        const zoneH = pH * ((logicH - gridTopLogic - 18) / logicH);

        const numQ   = exam.questions.length;
        const cols   = 3;
        const rows   = Math.ceil(numQ / cols);
        const colW   = zoneW / cols;
        
        const rowMMLogic = Math.min(10.5, Math.max(5.5, 173 / Math.ceil(numQ / 3)));
        const rowH   = rowMMLogic * mmToPx; 
        const options = ['A', 'B', 'C', 'D', 'E'];
        const answers = [];
        const bubblePositions = []; // Guardar posiciones para dibujar marcas

        for (let q = 0; q < numQ; q++) {
            const col = Math.floor(q / rows);
            const row = q % rows;

            const qX = zoneX + col * colW;
            const qY = zoneY + row * rowH;

            const optW = (colW * 0.6) / 5;
            const optStartX = qX + colW * 0.25;

            let darkestOption = 'A';
            let darkestScore  = Infinity;
            const qBubbles = [];

            options.forEach((opt, oi) => {
                const ox = optStartX + oi * optW;
                const oy = qY + rowH * 0.15;
                const ow = optW * 0.8;
                const oh = rowH * 0.7;

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

                qBubbles.push({
                    option: opt,
                    x: ox, y: oy, w: ow, h: oh,
                    brightness
                });

                if (brightness < darkestScore) {
                    darkestScore  = brightness;
                    darkestOption = opt;
                }
            });

            answers.push(darkestOption);
            bubblePositions.push({
                qNum: q + 1,
                detected: darkestOption,
                correct: exam.questions[q].ans,
                isCorrect: darkestOption === exam.questions[q].ans,
                bubbles: qBubbles,
                x: qX, y: qY
            });
        }

        return { answers, bubblePositions };
    },

    /* ─── Generar imagen calificada con marcas ─── */
    generateGradedImage(snapCtx, snapCanvas, exam, result) {
        const gradedCanvas = document.getElementById('graded-canvas');
        gradedCanvas.width = snapCanvas.width;
        gradedCanvas.height = snapCanvas.height;
        const gCtx = gradedCanvas.getContext('2d');
        
        // Dibujar la foto capturada como fondo
        gCtx.drawImage(snapCanvas, 0, 0);
        
        const { bubblePositions } = result;
        
        bubblePositions.forEach(q => {
            const isCorrect = q.isCorrect;
            
            // Dibujar indicador de pregunta (número con fondo)
            const labelSize = Math.max(16, snapCanvas.width * 0.018);
            
            q.bubbles.forEach(b => {
                const centerX = b.x + b.w / 2;
                const centerY = b.y + b.h / 2;
                const radius = Math.min(b.w, b.h) / 2;
                
                if (b.option === q.detected) {
                    // Esta es la respuesta que marcó el estudiante
                    if (isCorrect) {
                        // CORRECTA → Círculo verde
                        gCtx.beginPath();
                        gCtx.arc(centerX, centerY, radius + 3, 0, Math.PI * 2);
                        gCtx.strokeStyle = '#22c55e';
                        gCtx.lineWidth = 4;
                        gCtx.stroke();
                        
                        // ✓ checkmark
                        gCtx.fillStyle = '#22c55e';
                        gCtx.font = `bold ${labelSize}px sans-serif`;
                        gCtx.textAlign = 'center';
                        gCtx.textBaseline = 'middle';
                        gCtx.fillText('✓', centerX, centerY);
                    } else {
                        // INCORRECTA → X roja
                        gCtx.beginPath();
                        gCtx.arc(centerX, centerY, radius + 3, 0, Math.PI * 2);
                        gCtx.strokeStyle = '#ef4444';
                        gCtx.lineWidth = 4;
                        gCtx.stroke();
                        
                        // X
                        const s = radius * 0.7;
                        gCtx.beginPath();
                        gCtx.moveTo(centerX - s, centerY - s);
                        gCtx.lineTo(centerX + s, centerY + s);
                        gCtx.moveTo(centerX + s, centerY - s);
                        gCtx.lineTo(centerX - s, centerY + s);
                        gCtx.strokeStyle = '#ef4444';
                        gCtx.lineWidth = 3;
                        gCtx.stroke();
                    }
                }
                
                // Si la respuesta fue incorrecta, marcar cuál era la correcta
                if (!isCorrect && b.option === q.correct) {
                    gCtx.beginPath();
                    gCtx.arc(centerX, centerY, radius + 3, 0, Math.PI * 2);
                    gCtx.strokeStyle = '#facc15'; // Amarillo para la correcta
                    gCtx.lineWidth = 3;
                    gCtx.stroke();
                }
            });

            // Indicador lateral: punto de color al lado del número
            const indicatorSize = Math.max(8, snapCanvas.width * 0.008);
            gCtx.beginPath();
            gCtx.arc(q.x - indicatorSize * 2, q.y + (q.bubbles[0]?.h || 20) / 2 + 4, indicatorSize, 0, Math.PI * 2);
            gCtx.fillStyle = isCorrect ? '#22c55e' : '#ef4444';
            gCtx.fill();
        });

        // Header con puntaje en la parte superior de la imagen
        const headerH = snapCanvas.height * 0.06;
        gCtx.fillStyle = 'rgba(0,0,0,0.75)';
        gCtx.fillRect(0, 0, snapCanvas.width, headerH);
        
        const correctCount = bubblePositions.filter(q => q.isCorrect).length;
        const totalQ = bubblePositions.length;
        const pct = ((correctCount / totalQ) * 100).toFixed(1);
        
        gCtx.fillStyle = '#ffffff';
        gCtx.font = `bold ${headerH * 0.5}px sans-serif`;
        gCtx.textAlign = 'center';
        gCtx.textBaseline = 'middle';
        gCtx.fillText(
            `${this.currentStudent?.name || 'Estudiante'} — ${correctCount}/${totalQ} = ${pct}%`,
            snapCanvas.width / 2, headerH / 2
        );

        // Leyenda abajo
        const legendH = snapCanvas.height * 0.035;
        const legendY = snapCanvas.height - legendH;
        gCtx.fillStyle = 'rgba(0,0,0,0.7)';
        gCtx.fillRect(0, legendY, snapCanvas.width, legendH);
        
        const legendFont = legendH * 0.5;
        gCtx.font = `${legendFont}px sans-serif`;
        gCtx.textAlign = 'center';
        gCtx.textBaseline = 'middle';
        
        // Verde = correcta, Rojo = incorrecta, Amarillo = respuesta correcta
        gCtx.fillStyle = '#22c55e';
        gCtx.fillText('● Correcta', snapCanvas.width * 0.2, legendY + legendH / 2);
        gCtx.fillStyle = '#ef4444';
        gCtx.fillText('✕ Incorrecta', snapCanvas.width * 0.5, legendY + legendH / 2);
        gCtx.fillStyle = '#facc15';
        gCtx.fillText('○ Resp. Correcta', snapCanvas.width * 0.8, legendY + legendH / 2);

        // Guardar como imagen data URL
        this.gradedImageDataUrl = gradedCanvas.toDataURL('image/png');
    },

    /* ─── Mostrar resultado ─── */
    showResult(student, exam, result) {
        const { answers, bubblePositions } = result;
        let correct = 0;
        const competencyMap = {};

        exam.questions.forEach((q, i) => {
            const isCorrect = answers[i] === q.ans;
            if (isCorrect) correct++;
            if (!competencyMap[q.comp]) competencyMap[q.comp] = { correct: 0, total: 0 };
            competencyMap[q.comp].total++;
            if (isCorrect) competencyMap[q.comp].correct++;
        });

        const score    = Math.round((correct / exam.questions.length) * 100);
        const scoreStr = `${correct}/${exam.questions.length}`;

        // Guardar para confirmar luego
        this.currentResult = { student, exam, detectedAnswers: answers, score, correct, pct: score, competencyMap };

        // Llenar el panel
        document.getElementById('res-name').textContent  = student.name;
        document.getElementById('res-grade').textContent = student.grade;
        document.getElementById('res-id').textContent    = student.id;
        document.getElementById('res-score').textContent = scoreStr;

        // Color del puntaje según rendimiento
        const scoreEl = document.getElementById('res-score');
        if (score >= 70) scoreEl.style.color = '#22c55e';
        else if (score >= 40) scoreEl.style.color = '#f59e0b';
        else scoreEl.style.color = '#ef4444';

        // Detalle pregunta por pregunta
        const detailContainer = document.getElementById('res-answers-detail');
        if (detailContainer) {
            let detailHTML = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(70px, 1fr)); gap:6px; font-size:0.8rem;">';
            bubblePositions.forEach(bp => {
                const bg = bp.isCorrect ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
                const border = bp.isCorrect ? '#22c55e' : '#ef4444';
                const icon = bp.isCorrect ? '✓' : '✕';
                detailHTML += `<div style="background:${bg}; border:1px solid ${border}; border-radius:6px; padding:4px 6px; text-align:center;">
                    <span style="font-weight:700;">${bp.qNum}</span> ${icon}<br>
                    <span style="font-size:0.7rem; opacity:0.7;">${bp.detected}${!bp.isCorrect ? '→'+bp.correct : ''}</span>
                </div>`;
            });
            detailHTML += '</div>';
            detailContainer.innerHTML = detailHTML;
        }

        const compColors = { c1: '#6366f1', c2: '#f59e0b', c3: '#10b981', c4: '#ef4444' };
        const compNames  = { c1: 'Semántica', c2: 'Sintáctica', c3: 'Pragmática', c4: 'Enciclopédica' };
        document.getElementById('res-competencies').innerHTML = Object.keys(competencyMap).map(c => {
            const pct = Math.round((competencyMap[c].correct / competencyMap[c].total) * 100);
            return `<div style="background:${compColors[c]}22; border:1.5px solid ${compColors[c]}; color:${compColors[c]}; border-radius:6px; padding:8px 14px; font-size:0.85rem;">
                <b>${compNames[c]}</b><br>${pct}% (${competencyMap[c].correct}/${competencyMap[c].total})
            </div>`;
        }).join('');

        document.getElementById('result-panel').style.display = 'block';
        
        // Scroll al resultado
        document.getElementById('result-panel').scrollIntoView({ behavior: 'smooth' });
        
        this.setStatus('📋 Revisa el resultado y confirma.', 'var(--accent)');
    },

    /* ─── Descargar imagen calificada ─── */
    downloadGradedImage() {
        if (!this.gradedImageDataUrl) {
            app.toast('⚠️ No hay imagen calificada disponible.', true);
            return;
        }

        const student = this.currentResult?.student;
        const exam = this.currentResult?.exam;
        const filename = `${student?.name || 'examen'}_${exam?.name || 'resultado'}_${new Date().toISOString().slice(0,10)}.png`;

        const link = document.createElement('a');
        link.download = filename.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ_\-\.]/g, '_');
        link.href = this.gradedImageDataUrl;
        link.click();

        app.toast('📥 Imagen descargada');
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

        // Intentar guardar imagen automáticamente en el dispositivo
        this.downloadGradedImage();

        app.toast(`✅ ¡Evaluación de ${student.name} guardada!`);
        this.discardResult();
        app.updateDashboard();
    },

    discardResult() {
        this.currentResult = null;
        this.lastQR = null;
        this.cooldown = false;
        this.gradedImageDataUrl = null;
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

        // Re-dibujar video
        ctx.drawImage(this.video, 0, 0);

        // Guía estricta de CUADROS NEGROS (1.305)
        const margin = 20;
        let pW, pH;
        if (H > W) {
            pW = W - margin * 2;
            pH = pW * 1.3054;
            if (pH > H - margin * 2) {
                pH = H - margin * 2;
                pW = pH / 1.3054;
            }
        } else {
            pH = H - margin * 2;
            pW = pH / 1.3054;
        }
        
        const pX = (W - pW) / 2;
        const pY = (H - pH) / 2;

        const s = Math.min(W, H) * 0.1; // Tamaño de la esquina
        
        // Si ya reconoció al estudiante, las guías se ponen VERDES, si no, ROJAS.
        ctx.strokeStyle = this.currentStudent ? '#10b981' : '#ef4444';
        ctx.lineWidth = 4;

        // Dibujar 4 esquinas simulando los cuadros negros
        [[pX, pY], [pX + pW - s, pY], [pX, pY + pH - s], [pX + pW - s, pY + pH - s]]
            .forEach(([x, y]) => ctx.strokeRect(x, y, s, s));

        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';

        if (this.currentStudent) {
            // Fondo semi-transparente para el texto
            const textY = pY + pH / 2;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(pX, textY - 35, pW, 75);
            
            ctx.fillStyle = '#10b981';
            ctx.fillText(`👆 TOCA PARA CALIFICAR`, W / 2, textY);
            ctx.font = 'bold 15px sans-serif';
            ctx.fillStyle = '#fff';
            ctx.fillText(`Estudiante: ${this.currentStudent.name}`, W / 2, textY + 25);
        } else {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, 0, W, 50);
            ctx.fillStyle = 'white';
            ctx.fillText('1º Acércate al QR del examen', W / 2, 30);
        }
    }
};

/* ─── eventos ─── */
document.getElementById('start-scan')?.addEventListener('click', () => scanner.start());
document.getElementById('stop-scan')?.addEventListener('click',  () => scanner.stop());
window.addEventListener('DOMContentLoaded', () => scanner.init());
