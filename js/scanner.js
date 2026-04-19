/**
 * ZIPCASTELLANO SCANNER v2.1 — Dynamic Geometry & Robust Pipeline
 * 
 * Enfoque v2.1:
 * - Detección dinámica de filas y burbujas (Computer Vision).
 * - Rectificación por homografía obligatoria.
 * - Tolerancia a errores de impresión y perspectiva.
 */

var scanner = {
    video: null,
    canvas: null,
    ctx: null,
    stream: null,
    isActive: false,

    // State
    lastQR: null,
    qrLocation: null,
    currentStudent: null,
    currentExam: null,
    currentNumOptions: 5,
    cooldown: false,
    
    // Pipeline Progress
    statusMsg: '🔍 Buscando hoja...',
    
    // Stability
    consecutiveStableFrames: 0,
    STABLE_FRAMES_REQUIRED: 20,
    _stableRequired: 20,

    // Constants v2.1
    QR_SIZE_MM: 36,
    ANCHOR_SIZE_MM: 8,
    SHEET_W_MM: 215.9,
    SHEET_H_MM: 279.4,

    init() {
        this.populateExamSelect();
        document.getElementById('scan-exam-select')?.addEventListener('change', () => this.updateExamInfo());
    },

    populateExamSelect() {
        const sel = document.getElementById('scan-exam-select');
        if (!sel) return;
        const list = (typeof exams !== 'undefined' && exams.list) ? exams.list : [];
        if (list.length === 0) {
            sel.innerHTML = '<option value="">⚠️ No hay exámenes.</option>';
            sel.disabled = true;
        } else {
            sel.innerHTML = '<option value="">(Auto-detect) Selecciona...</option>' +
                list.map(e => `<option value="${e.id}">${e.name} · ${e.grade}</option>`).join('');
            sel.disabled = false;
        }
    },

    updateExamInfo() {
        const sel  = document.getElementById('scan-exam-select');
        const exam = exams.list.find(e => e.id === sel?.value);
        const info = document.getElementById('scan-exam-info');
        if (exam && info) info.textContent = `${exam.questions.length} preguntas · Opc:${exam.numOptions || 5}`;
    },

    async start() {
        this.video  = document.getElementById('video');
        this.canvas = document.getElementById('overlay');
        this.ctx    = this.canvas.getContext('2d', { willReadFrequently: true });

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            this.video.srcObject = this.stream;
            await this.video.play();
            this.isActive = true;
            this.loop();
            document.getElementById('start-scan').disabled = true;
            document.getElementById('stop-scan').disabled  = false;
        } catch (err) { alert('Cámara: ' + err.message); }
    },

    stop() {
        this.isActive = false;
        this.stream?.getTracks().forEach(t => t.stop());
        document.getElementById('start-scan').disabled = false;
        document.getElementById('stop-scan').disabled  = true;
    },

    setStatus(msg, color = 'var(--accent)') {
        this.statusMsg = msg;
        const el = document.getElementById('scan-status');
        if (el) { el.textContent = msg; el.style.color = color; }
    },

    loop() {
        if (!this.isActive) return;
        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            this.canvas.width  = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.ctx.drawImage(this.video, 0, 0);

            if (!this.cooldown) {
                this.processFrame();
                this.drawOverlay();
                
                const required = this._stableRequired || this.STABLE_FRAMES_REQUIRED;
                if (this.currentStudent && this.consecutiveStableFrames >= required) {
                    this.capture();
                }
            }
        }
        requestAnimationFrame(() => this.loop());
    },

    capture() {
        this.cooldown = true;
        this.consecutiveStableFrames = 0;
        if (navigator.vibrate) navigator.vibrate(100);
        this.setStatus('📸 ¡CAPTURANDO!', '#22c55e');
        setTimeout(() => this.gradeSheet(), 100);
    },

    processFrame() {
        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const qr = jsQR(imgData.data, imgData.width, imgData.height);

        if (qr && qr.data.startsWith('ZC|')) {
            this.qrLocation = qr.location;
            if (qr.data !== this.lastQR) {
                this.lastQR = qr.data;
                this.onQRDetected(qr.data);
            }
            this.consecutiveStableFrames++;
            this.setStatus('🟢 Hoja alineada. Mantén quieto...', '#22c55e');
        } else {
            this.consecutiveStableFrames = Math.max(0, this.consecutiveStableFrames - 1);
            this.setStatus('🔍 Buscando QR y anclajes...', 'var(--accent)');
        }
    },

    onQRDetected(data) {
        const p = data.split('|');
        if (p.length < 3) return;
        const std = students.list.find(s => s.id === decodeURIComponent(p[1]));
        const ex  = exams.list.find(e => e.id === decodeURIComponent(p[2]));
        this.currentStudent = std;
        this.currentExam = ex;
        this.currentNumOptions = parseInt(p[3]) || 5;
    },

    /**
     * PIPELINE DINÁMICO v2.1
     */
    gradeSheet() {
        const W = this.video.videoWidth, H = this.video.videoHeight;
        const snap = document.createElement('canvas'); snap.width = W; snap.height = H;
        const sCtx = snap.getContext('2d'); sCtx.drawImage(this.video, 0, 0);

        // 1. Detectar Anclajes Reales
        this.setStatus('⚙️ Detectando anclajes...', '#f59e0b');
        const anchors = this.detectAnchors(sCtx, W, H);
        
        if (Object.keys(anchors).length < 2) {
            app.toast('❌ No se detectaron suficientes anclajes.', true);
            this.cooldown = false; return;
        }

        // 2. Rectificar Imagen (Homografía)
        this.setStatus('📐 Rectificando perspectiva...', '#f59e0b');
        const rectified = this.rectify(sCtx, anchors);

        // 3. Procesar OMR Dinámico
        this.setStatus('📑 Analizando burbujas...', '#f59e0b');
        const result = this.analyzeDynamic(rectified);

        this.generateGradedImage(sCtx, snap, this.currentExam, result);
        this.showResult(this.currentStudent, this.currentExam, result);
    },

    detectAnchors(ctx, W, H) {
        // En v2.1 buscamos los 4 puntos basados en el QR y refinamos por oscuridad
        // Usamos el fallback de getMeasuredPositions para predecir y findDarkCentroid para refinar
        const L = printer.getLayout(this.currentExam.questions.length, this.currentNumOptions);
        const measured = printer.measureBubblePositions(this.currentExam.questions.length, this.currentNumOptions);
        
        const tl = this.qrLocation.topLeftCorner, tr = this.qrLocation.topRightCorner;
        const pxMm = Math.hypot(tr.x - tl.x, tr.y - tl.y) / this.QR_SIZE_MM;
        const angle = Math.atan2(tr.y - tl.y, tr.x - tl.x);
        
        const found = {};
        ['tl','tr','bl','br'].forEach(k => {
            const am = measured.anchors[k];
            const dx = am.x - 40, dy = am.y - 40; // Offset relativo al QR (40,40)
            const predX = tl.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) * pxMm;
            const predY = tl.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) * pxMm;
            const real = this.findDarkCentroid(ctx, predX, predY, 25 * pxMm, W, H);
            if (real) found[k] = real;
        });
        return found;
    },

    rectify(ctx, anchors) {
        // Mapeamos los anclajes detectados a sus posiciones teóricas en mm
        const src = [], dst = [];
        const L = printer.getLayout(this.currentExam.questions.length, this.currentNumOptions);
        const measured = printer.measureBubblePositions(this.currentExam.questions.length, this.currentNumOptions);
        
        ['tl','tr','bl','br'].forEach(k => {
            if (anchors[k]) {
                src.push(anchors[k]);
                dst.push({ x: measured.anchors[k].x, y: measured.anchors[k].y });
            }
        });

        const h = this.getHomography(dst, src); // Inversa para proyectar de mm a px
        
        // Creamos un canvas rectificado de alta resolución (p.ej. 10px per mm)
        const scale = 5; 
        const rw = Math.round(this.SHEET_W_MM * scale), rh = Math.round(this.SHEET_H_MM * scale);
        const rCanvas = document.createElement('canvas'); rCanvas.width = rw; rCanvas.height = rh;
        const rCtx = rCanvas.getContext('2d');
        
        // Muestreamos la imagen original
        for (let y = 0; y < rh; y += 2) {
            for (let x = 0; x < rw; x += 2) {
                const px = this.applyHomography(h, x / scale, y / scale);
                const data = ctx.getImageData(px.x, px.y, 1, 1).data;
                rCtx.fillStyle = `rgb(${data[0]},${data[1]},${data[2]})`;
                rCtx.fillRect(x, y, 2, 2);
            }
        }
        return { canvas: rCanvas, scale };
    },

    analyzeDynamic(rect) {
        const { canvas, scale } = rect;
        const ctx = canvas.getContext('2d');
        const numQ = this.currentExam.questions.length;
        const numOpts = this.currentNumOptions;
        const L = printer.getLayout(numQ, numOpts);
        const measured = printer.measureBubblePositions(numQ, numOpts);

        const bubbleData = [];
        const answers = [];

        for (let q = 0; q < numQ; q++) {
            const rowAnswers = [];
            const positions = [];
            for (let o = 0; o < numOpts; o++) {
                const mm = measured.positions[q][o];
                const x = mm.x * scale, y = mm.y * scale;
                const br = this.sampleBrightness(ctx, x, y, L.bubbleRadius * scale * 0.8, canvas.width, canvas.height);
                rowAnswers.push(br);
                // Proyectar de vuelta a la imagen original para el graded image
                positions.push({ x: mm.x, y: mm.y, brightness: br, option: 'ABCDE'[o] });
            }

            const minB = Math.min(...rowAnswers);
            const minI = rowAnswers.indexOf(minB);
            const sorted = [...rowAnswers].sort((a,b) => a-b);
            const contrast = (sorted[1] - sorted[0]) / 255;
            
            const detected = (minB < 185 && contrast > 0.08) ? 'ABCDE'[minI] : '?';
            bubbleData.push({ qNum: q+1, detected, correct: this.currentExam.questions[q].ans, isCorrect: detected === this.currentExam.questions[q].ans, positions });
            answers.push(detected);
        }

        return { answers, bubbleData };
    },

    sampleBrightness(ctx, cx, cy, r, W, H) {
        const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r);
        const w = r * 2, h = r * 2;
        const data = ctx.getImageData(x0, y0, w, h).data;
        let sum = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            sum += data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
            count++;
        }
        return count > 0 ? sum / count : 255;
    },

    findDarkCentroid(ctx, cx, cy, r, W, H) {
        const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r);
        const w = r * 2, h = r * 2;
        if (w <= 0 || h <= 0) return null;
        const data = ctx.getImageData(x0, y0, w, h).data;
        let sx = 0, sy = 0, c = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const b = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
                if (b < 80) { sx += x0 + x; sy += y0 + y; c++; }
            }
        }
        return c > 20 ? { x: sx/c, y: sy/c } : null;
    },

    getHomography(src, dst) {
        const matrix = Array(8).fill(0).map(() => Array(9).fill(0));
        for (let i = 0; i < 4; i++) {
            const { x, y } = src[i], { x: u, y: v } = dst[i];
            matrix[2*i] = [x, y, 1, 0, 0, 0, -u*x, -u*y, u];
            matrix[2*i+1] = [0, 0, 0, x, y, 1, -v*x, -v*y, v];
        }
        for (let i = 0; i < 8; i++) {
            let p = i; for (let j = i+1; j < 8; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[p][i])) p = j;
            [matrix[i], matrix[p]] = [matrix[p], matrix[i]];
            const div = matrix[i][i]; if (Math.abs(div) < 1e-10) continue;
            for (let j = i; j < 9; j++) matrix[i][j] /= div;
            for (let j = 0; j < 8; j++) if (j !== i) {
                const m = matrix[j][i]; for (let k = i; k < 9; k++) matrix[j][k] -= m * matrix[i][k];
            }
        }
        return [...matrix.map(r => r[8]), 1];
    },

    applyHomography(h, x, y) {
        const w = h[6]*x + h[7]*y + h[8];
        return { x: (h[0]*x + h[1]*y + h[2])/w, y: (h[3]*x + h[4]*y + h[5])/w };
    },

    generateGradedImage(sCtx, snap, exam, result) {
        const gc = document.getElementById('graded-canvas');
        gc.width = snap.width; gc.height = snap.height;
        const g = gc.getContext('2d'); g.drawImage(snap, 0, 0);
        
        // Necesitamos proyectar de mm a la imagen original de captura
        const anchors = this.detectAnchors(sCtx, snap.width, snap.height);
        const measured = printer.measureBubblePositions(exam.questions.length, exam.numOptions || 5);
        const src = [], dst = [];
        ['tl','tr','bl','br'].forEach(k => { if(anchors[k]) { src.push(anchors[k]); dst.push({x:measured.anchors[k].x, y:measured.anchors[k].y}); }});
        const h = this.getHomography(dst, src);

        result.bubbleData.forEach(q => {
            q.positions.forEach(p => {
                const real = this.applyHomography(h, p.x, p.y);
                const r = Math.max(8, snap.width * 0.012);
                if (p.option === q.detected) {
                    g.beginPath(); g.arc(real.x, real.y, r, 0, Math.PI*2);
                    g.strokeStyle = q.isCorrect ? '#22c55e' : '#ef4444';
                    g.lineWidth = 3; g.stroke();
                    g.fillStyle = q.isCorrect ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.2)'; g.fill();
                }
                if (!q.isCorrect && p.option === q.correct) {
                    g.beginPath(); g.arc(real.x, real.y, r + 2, 0, Math.PI*2);
                    g.strokeStyle = '#facc15'; g.lineWidth = 2.5; g.stroke();
                }
            });
        });

        const correctN = result.bubbleData.filter(q => q.isCorrect).length;
        const hdrH = Math.max(32, gc.height * 0.05);
        g.fillStyle = 'rgba(0,0,0,0.78)'; g.fillRect(0, 0, gc.width, hdrH);
        g.fillStyle = '#fff'; g.font = `bold ${Math.round(hdrH * 0.5)}px sans-serif`; g.textAlign = 'center';
        g.fillText(`${this.currentStudent?.name || ''} — ${correctN}/${result.bubbleData.length}`, gc.width/2, hdrH/2 + 5);
        this.gradedImageDataUrl = gc.toDataURL('image/jpeg', 0.88);
    },

    showResult(student, exam, result) {
        const { answers, bubbleData } = result;
        let correct = 0; const compMap = {};
        exam.questions.forEach((q, i) => {
            const ok = answers[i] === q.ans; if (ok) correct++;
            if (!compMap[q.comp]) compMap[q.comp] = { correct: 0, total: 0 };
            compMap[q.comp].total++; if (ok) compMap[q.comp].correct++;
        });
        const pct = Math.round((correct / exam.questions.length) * 100);
        this.currentResult = { student, exam, detectedAnswers: answers, score: pct, correct, pct, competencyMap: compMap };

        document.getElementById('res-name').textContent = student.name;
        document.getElementById('res-score').textContent = `${correct}/${exam.questions.length}`;
        document.getElementById('res-score').style.color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
        
        const detail = document.getElementById('res-answers-detail');
        if (detail) detail.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(65px,1fr));gap:4px;font-size:.78rem">' +
            bubbleData.map(b => `<div style="background:${b.isCorrect?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'};border:1px solid ${b.isCorrect?'#22c55e':'#ef4444'};border-radius:5px;padding:3px;text-align:center"><b>${b.qNum}</b>${b.isCorrect?'✓':'✕'}<br><span style="opacity:.7;font-size:.65rem">${b.detected}${!b.isCorrect?'→'+b.correct:''}</span></div>`).join('') + '</div>';

        document.getElementById('result-panel').style.display = 'block';
        document.getElementById('result-panel').scrollIntoView({ behavior: 'smooth' });
        this.setStatus('📋 Revisa el resultado.', 'var(--accent)');
    },

    async saveResult() {
        if (!this.currentResult) return;
        const { student, exam, correct, pct, competencyMap } = this.currentResult;
        const obj = { date: new Date().toISOString(), studentId: student.id, studentName: student.name, grade: student.grade, examName: exam.name, examId: exam.id, score: `${correct}/${exam.questions.length}`, pct, competencies: competencyMap };
        const history = JSON.parse(localStorage.getItem('zc_results') || '[]');
        history.push(obj); localStorage.setItem('zc_results', JSON.stringify(history));
        if (settings.apiUrl) app.pushResultToSheet(obj).catch(console.error);
        this.discardResult(); app.updateDashboard();
    },

    discardResult() {
        this.currentResult = null; this.lastQR = null; this.cooldown = false;
        document.getElementById('result-panel').style.display = 'none';
        this.setStatus('🔍 Siguiente hoja…', 'var(--accent)');
    },

    drawOverlay() {
        const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
        if (this.qrLocation && this.currentStudent && this.currentExam && !this.cooldown) {
            const loc = this.qrLocation;
            const required = this._stableRequired || this.STABLE_FRAMES_REQUIRED;
            const progress = Math.min(1, this.consecutiveStableFrames / required);
            
            ctx.beginPath(); ctx.moveTo(loc.topLeftCorner.x, loc.topLeftCorner.y); ctx.lineTo(loc.topRightCorner.x, loc.topRightCorner.y);
            ctx.lineTo(loc.bottomRightCorner.x, loc.bottomRightCorner.y); ctx.lineTo(loc.bottomLeftCorner.x, loc.bottomLeftCorner.y); ctx.closePath();
            ctx.strokeStyle = progress >= 0.5 ? '#22c55e' : '#facc15'; ctx.lineWidth = 4; ctx.stroke();
            
            // Progress Bar
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, W, 10);
            ctx.fillStyle = progress >= 0.5 ? '#22c55e' : '#facc15'; ctx.fillRect(0, 0, W * progress, 10);
        }
    }
};
