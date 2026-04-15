/**
 * ZIPCASTELLANO SCANNER v4 — QR-Anchored Grading
 *
 * Mejoras sobre v3:
 *  - Usa la posición del QR detectado como punto de anclaje para TODAS las
 *    posiciones de burbujas. Ya NO necesita alinear 4 esquinas.
 *  - Corrige un error de ~12mm en el cálculo de la posición de la grilla
 *    que causaba calificaciones incorrectas.
 *  - Maneja rotación del papel automáticamente.
 *  - Mejor muestreo de brillo (circular, ponderado por luminancia).
 *  - Guardado robusto con confirmación.
 */

const scanner = {
    video: null,
    canvas: null,
    ctx: null,
    stream: null,
    isActive: false,

    // QR state
    lastQR: null,
    qrData: null,
    qrLocation: null,
    qrVersion: 2,

    // Grading state
    currentStudent: null,
    currentExam: null,
    currentResult: null,
    cooldown: false,
    clickBound: null,
    gradedImageDataUrl: null,

    /* ═══════════════════════════════════════════════════════════
     * CONSTANTES FÍSICAS DEL LAYOUT (derivadas de printer.js)
     * Todas las distancias en milímetros.
     * 1 CSS px = 0.2646 mm  (1/96 pulgada)
     * ═══════════════════════════════════════════════════════════ */

    // QR image: 130px CSS total (box-sizing: border-box, border 3px)
    // Contenido: 124px = 32.8mm en la página impresa
    QR_CONTENT_MM: 32.8,

    // Centro del QR relativo al inner top-left de la hoja (mm)
    // X: innerWidth(171.9) - border(0.53) - padding(4.23) - half_qr(17.20) = 149.94
    // Y: header(25.40) + examInfo(~14.3) + studentBox_top(0.53+3.17) + qr_offset(17.20) ≈ 60.6
    QR_CENTER: { x: 149.94, y: 60.6 },

    // Top-left de la grilla de burbujas relativo al centro del QR (mm)
    // gridY = header(25.40) + examInfo(14.3) + studentBox(41.8) + margin(5.82) = 87.3
    // dY = 87.3 - 60.6 = 26.7
    // dX = 0 - 149.94 = -149.94
    GRID_OFFSET: { x: -149.94, y: 26.7 },

    /* ═══════════════════════════════════════════════════════════
     * INICIALIZACIÓN
     * ═══════════════════════════════════════════════════════════ */

    init() {
        this.populateExamSelect();
        document.getElementById('scan-exam-select')
            ?.addEventListener('change', () => this.updateExamInfo());
    },

    populateExamSelect() {
        const sel = document.getElementById('scan-exam-select');
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">Selecciona un examen...</option>' +
            exams.list.map(e =>
                `<option value="${e.id}" ${e.id === cur ? 'selected' : ''}>${e.name} · ${e.grade}</option>`
            ).join('');
    },

    updateExamInfo() {
        const sel = document.getElementById('scan-exam-select');
        const exam = exams.list.find(e => e.id === sel?.value);
        const info = document.getElementById('scan-exam-info');
        if (exam && info) info.textContent = `${exam.questions.length} preguntas · ${exam.grade}`;
    },

    getActiveExam() {
        const sel = document.getElementById('scan-exam-select');
        return exams.list.find(e => e.id === sel?.value) || null;
    },

    /* ═══════════════════════════════════════════════════════════
     * CÁMARA
     * ═══════════════════════════════════════════════════════════ */

    async start() {
        const exam = this.getActiveExam();
        if (!exam) { alert('Selecciona un examen activo antes de escanear.'); return; }

        this.video  = document.getElementById('video');
        this.canvas = document.getElementById('overlay');
        this.ctx    = this.canvas.getContext('2d', { willReadFrequently: true });

        try {
            // Bajamos a 720p para mejorar el rendimiento. jsQR es lento a 1080p a 60fps.
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            this.video.srcObject = this.stream;
            await this.video.play();
            this.isActive = true;
            this.currentStudent = null;
            this.currentExam = exam;
            this.lastQR = null;
            this.qrLocation = null;
            this.lastQRCheck = 0; // Para el throttle

            if (!this.clickBound) {
                this.clickBound = this.onTap.bind(this);
                this.canvas.addEventListener('click', this.clickBound);
            }

            this.setStatus('📷 Enfoca el código QR de la hoja...', 'var(--accent)');
            this.loop();
        } catch (err) {
            console.error(err);
            alert('No se pudo acceder a la cámara. Verifica los permisos.');
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

    /* ═══════════════════════════════════════════════════════════
     * TAP PARA CAPTURAR
     * ═══════════════════════════════════════════════════════════ */

    onTap(e) {
        e.stopPropagation();
        e.preventDefault();
        if (!this.isActive || this.cooldown) return;

        if (!this.currentStudent || !this.currentExam) {
            app.toast('⚠️ Enfoca el QR primero para identificar al estudiante.', true);
            return;
        }

        this.cooldown = true;
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        this.setStatus(`⏳ Calificando ${this.currentStudent.name}...`, '#f59e0b');

        setTimeout(() => this.gradeSheet(), 250);
    },

    /* ═══════════════════════════════════════════════════════════
     * LOOP DE FRAMES
     * ═══════════════════════════════════════════════════════════ */

    loop() {
        if (!this.isActive) return;
        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            this.canvas.width  = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.ctx.drawImage(this.video, 0, 0);

            if (!this.cooldown) this.detectQR();
            this.drawOverlay();
        }
        requestAnimationFrame(() => this.loop());
    },

    detectQR() {
        // Reducimos la frecuencia de jsQR a max ~3 veces por segundo para evitar "lag" visual de la cámara
        const now = Date.now();
        if (now - this.lastQRCheck < 300) return;
        this.lastQRCheck = now;

        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const qr = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'dontInvert'
        });

        if (qr && qr.data && qr.data.startsWith('ZC|')) {
            this.qrLocation = qr.location;
            this.qrVersion = qr.version || this._guessVersion(qr.data);

            if (qr.data !== this.lastQR) {
                this.lastQR = qr.data;
                this.qrData = qr.data;
                this.onQRDetected(qr.data);
            }
        }
    },

    _guessVersion(data) {
        const n = data.length;
        if (n <= 17) return 1;
        if (n <= 32) return 2;
        if (n <= 53) return 3;
        return 4;
    },

    /* ═══════════════════════════════════════════════════════════
     * QR DETECTADO
     * ═══════════════════════════════════════════════════════════ */

    onQRDetected(data) {
        const parts = data.split('|');
        if (parts.length < 3) return;

        const studentId = decodeURIComponent(parts[1]);
        const examId    = decodeURIComponent(parts[2]);

        const student = students.list.find(s => String(s.id) === String(studentId));
        const exam    = exams.list.find(e => e.id === examId);

        if (!student) {
            this.setStatus(`⚠️ Estudiante "${studentId}" no encontrado`, 'orange');
            return;
        }

        if (exam) this.currentExam = exam; // auto-select exam from QR
        this.currentStudent = student;

        // Feedback
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        try {
            const actx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = actx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, actx.currentTime);
            osc.connect(actx.destination);
            osc.start();
            osc.stop(actx.currentTime + 0.15);
        } catch (e) { /* ignore audio errors */ }

        this.setStatus(`✅ ${student.name} — ¡TOCA LA PANTALLA!`, '#10b981');
    },

    /* ═══════════════════════════════════════════════════════════
     * CÁLCULO DEL LAYOUT (espeja printer.js)
     * ═══════════════════════════════════════════════════════════ */

    /**
     * Calcula los parámetros geométricos de la grilla de burbujas
     * para un número dado de preguntas. Replica exactamente la
     * lógica de printer.js.
     */
    getLayout(numQ) {
        const PX = 0.2646; // mm por CSS px
        const cols = 3;
        const rowsPerCol = Math.ceil(numQ / cols);
        const rowMM = Math.min(10.5, Math.max(5.5, 173 / rowsPerCol));

        const bubblePx = Math.round(Math.min(22, Math.max(15, rowMM * 2.2)));
        const fontPx   = Math.round(bubblePx * 0.7);
        const numPx    = Math.round(fontPx * 1.3);

        const colGap = 24 * PX;  // gap entre columnas del grid (24px)
        const rowGap = 4 * PX;   // gap entre filas del col (4px)
        const innerW = 171.9;    // ancho del inner
        const colW   = (innerW - 2 * colGap) / cols;

        const qnumW   = numPx * 2.8 * PX; // ancho del número
        const gap      = 5 * PX;           // gap del flexbox qrow
        const bDiam    = bubblePx * PX;    // diámetro de la burbuja

        return {
            cols, rowsPerCol, rowMM, rowGap,
            colW, colGap,
            bubbleStartX: qnumW + gap + bDiam / 2,
            bubbleSpacing: bDiam + gap,
            bubbleRadius: bDiam / 2,
        };
    },

    /**
     * Devuelve la posición (mm) del centro de una burbuja
     * RELATIVA al centro del QR.
     * @param {number} q - Índice de pregunta (0-based)
     * @param {number} opt - Índice de opción (0=A, 1=B, 2=C, 3=D, 4=E)
     */
    bubbleMM(q, opt, L) {
        const col = Math.floor(q / L.rowsPerCol);
        const row = q % L.rowsPerCol;

        return {
            x: this.GRID_OFFSET.x + col * (L.colW + L.colGap) + L.bubbleStartX + opt * L.bubbleSpacing,
            y: this.GRID_OFFSET.y + row * (L.rowMM + L.rowGap) + L.rowMM / 2
        };
    },

    /**
     * Transforma un offset en mm (desde el centro del QR)
     * a coordenadas de píxeles en la cámara.
     * Maneja rotación automáticamente.
     */
    mmToPixel(dx, dy, cx, cy, angle, scale) {
        return {
            x: cx + (dx * Math.cos(angle) - dy * Math.sin(angle)) * scale,
            y: cy + (dx * Math.sin(angle) + dy * Math.cos(angle)) * scale
        };
    },

    /* ═══════════════════════════════════════════════════════════
     * CALIFICACIÓN
     * ═══════════════════════════════════════════════════════════ */

    gradeSheet() {
        const student = this.currentStudent;
        const exam    = this.currentExam;

        // Capturar frame del video
        const snap = document.createElement('canvas');
        snap.width  = this.video.videoWidth;
        snap.height = this.video.videoHeight;
        const sCtx = snap.getContext('2d');
        sCtx.drawImage(this.video, 0, 0);

        // Re-detectar QR en la captura para posición precisa
        const imgData = sCtx.getImageData(0, 0, snap.width, snap.height);
        const qr = jsQR(imgData.data, snap.width, snap.height, {
            inversionAttempts: 'dontInvert'
        });

        let qrLoc, qrVer;
        if (qr && qr.data && qr.data.startsWith('ZC|')) {
            qrLoc = qr.location;
            qrVer = qr.version || this.qrVersion;
            console.log('[Scanner] QR detectado en captura, versión:', qrVer);
        } else if (this.qrLocation) {
            qrLoc = this.qrLocation;
            qrVer = this.qrVersion;
            console.warn('[Scanner] QR no visible en captura, usando última posición');
            app.toast('⚠️ QR no visible en captura; usando última posición.', true);
        } else {
            app.toast('❌ No se detectó el QR. Intenta de nuevo.', true);
            this.cooldown = false;
            return;
        }

        const result = this.analyzeBubbles(sCtx, snap, exam, qrLoc, qrVer);
        this.generateGradedImage(sCtx, snap, exam, result);
        this.showResult(student, exam, result);
    },

    /**
     * Analiza todas las burbujas usando coordenadas ancladas al QR.
     * Devuelve { answers: string[], bubbleData: object[] }
     */
    analyzeBubbles(ctx, canvas, exam, qrLoc, version) {
        // ── Geometría del QR ──
        const tl = qrLoc.topLeftCorner;
        const tr = qrLoc.topRightCorner;
        const bl = qrLoc.bottomLeftCorner;
        const br = qrLoc.bottomRightCorner;

        // Centro del QR (punto medio de la diagonal)
        const qrCX = (tl.x + br.x) / 2;
        const qrCY = (tl.y + br.y) / 2;

        // Tamaño del QR en px de cámara (promedio de bordes sup e izq)
        const topEdge  = Math.hypot(tr.x - tl.x, tr.y - tl.y);
        const leftEdge = Math.hypot(bl.x - tl.x, bl.y - tl.y);
        const qrSizePx = (topEdge + leftEdge) / 2;

        // Ángulo de rotación del papel
        const angle = Math.atan2(tr.y - tl.y, tr.x - tl.x);

        // ── Escala (px por mm) ──
        // El área de datos del QR depende de la versión
        const qrModules = 4 * version + 17;
        // La imagen renderizada del QR tiene (qrModules + 8) módulos
        // (zona silenciosa de 4 módulos por lado)
        // El content area es 32.8mm físico
        const dataAreaMM = qrModules * this.QR_CONTENT_MM / (qrModules + 8);
        const pxPerMm = qrSizePx / dataAreaMM;

        console.log(`[Scanner] v${version}: ${qrModules}mod, data=${dataAreaMM.toFixed(1)}mm, ` +
                     `scale=${pxPerMm.toFixed(2)}px/mm, angle=${(angle * 180 / Math.PI).toFixed(1)}°`);

        // ── Análisis de burbujas ──
        const numQ = exam.questions.length;
        const L = this.getLayout(numQ);
        const OPTS = ['A', 'B', 'C', 'D', 'E'];
        const answers   = [];
        const bubbleData = [];

        // Radio de muestreo un poco mayor que el radio físico para tolerancia
        const sampleR = L.bubbleRadius * 1.4 * pxPerMm;

        for (let q = 0; q < numQ; q++) {
            const brights = [];
            const positions = [];

            for (let o = 0; o < 5; o++) {
                const mm = this.bubbleMM(q, o, L);
                const px = this.mmToPixel(mm.x, mm.y, qrCX, qrCY, angle, pxPerMm);
                const brightness = this.sampleBrightness(
                    ctx, px.x, px.y, sampleR, canvas.width, canvas.height
                );
                brights.push(brightness);
                positions.push({ x: px.x, y: px.y, brightness, option: OPTS[o] });
            }

            // Encontrar la opción más oscura
            let minB = Infinity, minI = 0;
            brights.forEach((b, i) => { if (b < minB) { minB = b; minI = i; } });

            // Confianza: la más oscura debe ser notablemente más oscura que la mediana
            const sorted = [...brights].sort((a, b) => a - b);
            const median  = sorted[2];
            const contrast = median > 0 ? (median - minB) / median : 0;

            const detected = OPTS[minI];
            const correct  = exam.questions[q].ans;

            answers.push(detected);
            bubbleData.push({
                qNum: q + 1,
                detected, correct,
                isCorrect: detected === correct,
                contrast,
                positions
            });
        }

        return { answers, bubbleData };
    },

    /**
     * Muestrea el brillo promedio en una región circular.
     * Usa ponderación perceptual de luminancia (ITU-R 601).
     */
    sampleBrightness(ctx, cx, cy, radius, maxW, maxH) {
        const r  = Math.ceil(radius);
        const x0 = Math.max(0, Math.round(cx) - r);
        const y0 = Math.max(0, Math.round(cy) - r);
        const x1 = Math.min(maxW, Math.round(cx) + r);
        const y1 = Math.min(maxH, Math.round(cy) + r);
        const w  = x1 - x0;
        const h  = y1 - y0;

        if (w <= 0 || h <= 0) return 255;

        const data = ctx.getImageData(x0, y0, w, h).data;
        let sum = 0, count = 0;
        const rSq = radius * radius;

        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const dx = (x0 + px) - cx;
                const dy = (y0 + py) - cy;
                if (dx * dx + dy * dy <= rSq) {
                    const i = (py * w + px) * 4;
                    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    count++;
                }
            }
        }

        return count > 0 ? sum / count : 255;
    },

    /* ═══════════════════════════════════════════════════════════
     * GENERACIÓN DE IMAGEN CALIFICADA
     * ═══════════════════════════════════════════════════════════ */

    generateGradedImage(snapCtx, snapCanvas, exam, result) {
        const gc = document.getElementById('graded-canvas');
        gc.width  = snapCanvas.width;
        gc.height = snapCanvas.height;
        const g = gc.getContext('2d');
        g.drawImage(snapCanvas, 0, 0);

        const { bubbleData } = result;
        const minDim = Math.min(gc.width, gc.height);

        bubbleData.forEach(q => {
            q.positions.forEach(p => {
                const r = Math.max(8, minDim * 0.012);

                if (p.option === q.detected) {
                    if (q.isCorrect) {
                        // ✓ VERDE — respuesta correcta
                        g.beginPath();
                        g.arc(p.x, p.y, r, 0, Math.PI * 2);
                        g.strokeStyle = '#22c55e';
                        g.lineWidth = 3;
                        g.stroke();
                        g.fillStyle = '#22c55e';
                        g.font = `bold ${r * 1.3}px sans-serif`;
                        g.textAlign = 'center';
                        g.textBaseline = 'middle';
                        g.fillText('✓', p.x, p.y);
                    } else {
                        // ✕ ROJA — respuesta incorrecta
                        g.beginPath();
                        g.arc(p.x, p.y, r, 0, Math.PI * 2);
                        g.strokeStyle = '#ef4444';
                        g.lineWidth = 3;
                        g.stroke();
                        const s = r * 0.6;
                        g.beginPath();
                        g.moveTo(p.x - s, p.y - s);
                        g.lineTo(p.x + s, p.y + s);
                        g.moveTo(p.x + s, p.y - s);
                        g.lineTo(p.x - s, p.y + s);
                        g.strokeStyle = '#ef4444';
                        g.lineWidth = 2.5;
                        g.stroke();
                    }
                }

                // Amarillo sobre la respuesta correcta (cuando el estudiante erró)
                if (!q.isCorrect && p.option === q.correct) {
                    g.beginPath();
                    g.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
                    g.strokeStyle = '#facc15';
                    g.lineWidth = 2.5;
                    g.stroke();
                }
            });
        });

        // Banner de puntaje
        const correctN = bubbleData.filter(q => q.isCorrect).length;
        const totalN   = bubbleData.length;
        const pctStr   = ((correctN / totalN) * 100).toFixed(1);

        const hdrH = gc.height * 0.05;
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillRect(0, 0, gc.width, hdrH);
        g.fillStyle = '#fff';
        g.font = `bold ${hdrH * 0.55}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(
            `${this.currentStudent?.name || ''} — ${correctN}/${totalN} = ${pctStr}%`,
            gc.width / 2, hdrH / 2
        );

        // Leyenda inferior
        const legH = gc.height * 0.03;
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(0, gc.height - legH, gc.width, legH);
        g.font = `${legH * 0.5}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const ly = gc.height - legH / 2;
        g.fillStyle = '#22c55e'; g.fillText('● Correcta', gc.width * 0.2, ly);
        g.fillStyle = '#ef4444'; g.fillText('✕ Incorrecta', gc.width * 0.5, ly);
        g.fillStyle = '#facc15'; g.fillText('○ Resp. Correcta', gc.width * 0.8, ly);

        this.gradedImageDataUrl = gc.toDataURL('image/jpeg', 0.85);
    },

    /* ═══════════════════════════════════════════════════════════
     * MOSTRAR RESULTADOS
     * ═══════════════════════════════════════════════════════════ */

    showResult(student, exam, result) {
        const { answers, bubbleData } = result;
        let correct = 0;
        const compMap = {};

        exam.questions.forEach((q, i) => {
            const ok = answers[i] === q.ans;
            if (ok) correct++;
            if (!compMap[q.comp]) compMap[q.comp] = { correct: 0, total: 0 };
            compMap[q.comp].total++;
            if (ok) compMap[q.comp].correct++;
        });

        const pct = Math.round((correct / exam.questions.length) * 100);

        this.currentResult = {
            student, exam,
            detectedAnswers: answers,
            score: pct, correct, pct,
            competencyMap: compMap
        };

        // Llenar panel
        document.getElementById('res-name').textContent  = student.name;
        document.getElementById('res-grade').textContent = student.grade;
        document.getElementById('res-id').textContent    = student.id;

        const scoreEl = document.getElementById('res-score');
        scoreEl.textContent = `${correct}/${exam.questions.length}`;
        scoreEl.style.color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';

        // Detalle pregunta por pregunta
        const detail = document.getElementById('res-answers-detail');
        if (detail) {
            detail.innerHTML =
                '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(65px,1fr));gap:4px;font-size:.78rem">' +
                bubbleData.map(b => {
                    const bg = b.isCorrect ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
                    const bd = b.isCorrect ? '#22c55e' : '#ef4444';
                    const ic = b.isCorrect ? '✓' : '✕';
                    return `<div style="background:${bg};border:1px solid ${bd};border-radius:5px;padding:3px;text-align:center">
                        <b>${b.qNum}</b>${ic}<br>
                        <span style="opacity:.7;font-size:.65rem">${b.detected}${!b.isCorrect ? '→' + b.correct : ''}</span>
                    </div>`;
                }).join('') + '</div>';
        }

        // Badges de competencias
        const colors = { c1: '#6366f1', c2: '#f59e0b', c3: '#10b981', c4: '#ef4444' };
        const names  = { c1: 'Semántica', c2: 'Sintáctica', c3: 'Pragmática', c4: 'Enciclopédica' };
        document.getElementById('res-competencies').innerHTML = Object.keys(compMap).map(c => {
            const p = Math.round((compMap[c].correct / compMap[c].total) * 100);
            return `<div style="background:${colors[c]}22;border:1.5px solid ${colors[c]};color:${colors[c]};border-radius:6px;padding:8px 12px;font-size:.85rem">
                <b>${names[c]}</b><br>${p}% (${compMap[c].correct}/${compMap[c].total})</div>`;
        }).join('');

        document.getElementById('result-panel').style.display = 'block';
        document.getElementById('result-panel').scrollIntoView({ behavior: 'smooth' });
        this.setStatus('📋 Revisa y confirma el resultado.', 'var(--accent)');
    },

    /* ═══════════════════════════════════════════════════════════
     * GUARDAR Y DESCARGAR
     * ═══════════════════════════════════════════════════════════ */

    async saveResult() {
        if (!this.currentResult) {
            app.toast('⚠️ No hay resultado para guardar.', true);
            return;
        }

        try {
            const { student, exam, correct, pct, competencyMap } = this.currentResult;

            const obj = {
                date: new Date().toISOString(),
                studentId: student.id,
                studentName: student.name,
                grade: student.grade,
                examName: exam.name,
                examId: exam.id,
                score: `${correct}/${exam.questions.length}`,
                pct,
                competencies: competencyMap
            };

            // ── Guardado local ──
            const history = JSON.parse(localStorage.getItem('zc_results') || '[]');
            history.push(obj);
            localStorage.setItem('zc_results', JSON.stringify(history));
            console.log('[Scanner] Resultado guardado localmente. Total:', history.length);

            // ── Confirmación visible ──
            app.toast(`✅ ${student.name}: ${correct}/${exam.questions.length} — Guardado ✓`);

            // ── Sync nube (no bloqueante) ──
            if (settings.apiUrl) {
                app.pushResultToSheet(obj).catch(e => {
                    console.warn('[Scanner] Cloud sync failed:', e);
                });
            }

            this.discardResult();
            app.updateDashboard();
        } catch (err) {
            console.error('[Scanner] Save error:', err);
            app.toast('❌ Error al guardar: ' + err.message, true);
        }
    },

    downloadGradedImage() {
        if (!this.gradedImageDataUrl) {
            app.toast('⚠️ No hay imagen para descargar.', true);
            return;
        }
        const name = `${this.currentResult?.student?.name || 'examen'}_${Date.now()}.jpg`
            .replace(/[^a-zA-Z0-9áéíóúñ._-]/gi, '_');
        const a = document.createElement('a');
        a.download = name;
        a.href = this.gradedImageDataUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        app.toast('📥 Imagen descargada');
    },

    discardResult() {
        this.currentResult = null;
        this.lastQR = null;
        this.cooldown = false;
        this.gradedImageDataUrl = null;
        document.getElementById('result-panel').style.display = 'none';
        this.setStatus('🔍 Apunta al QR de la siguiente hoja...', 'var(--accent)');
    },

    /* ═══════════════════════════════════════════════════════════
     * HELPERS DE UI
     * ═══════════════════════════════════════════════════════════ */

    setStatus(msg, color = 'var(--accent)') {
        const el = document.getElementById('scan-status');
        if (el) { el.textContent = msg; el.style.color = color; }
    },

    drawOverlay() {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;

        if (this.qrLocation && this.currentStudent) {
            // ── QR encontrado: resaltar con verde ──
            const loc = this.qrLocation;

            ctx.beginPath();
            ctx.moveTo(loc.topLeftCorner.x, loc.topLeftCorner.y);
            ctx.lineTo(loc.topRightCorner.x, loc.topRightCorner.y);
            ctx.lineTo(loc.bottomRightCorner.x, loc.bottomRightCorner.y);
            ctx.lineTo(loc.bottomLeftCorner.x, loc.bottomLeftCorner.y);
            ctx.closePath();
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.fillStyle = 'rgba(34,197,94,0.12)';
            ctx.fill();

            // Banner "Toca para calificar"
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, H / 2 - 35, W, 70);
            ctx.fillStyle = '#22c55e';
            ctx.font = `bold ${Math.max(20, W * 0.04)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('👆 TOCA PARA CALIFICAR', W / 2, H / 2 - 8);
            ctx.fillStyle = '#fff';
            ctx.font = `${Math.max(14, W * 0.028)}px sans-serif`;
            ctx.fillText(this.currentStudent.name, W / 2, H / 2 + 18);
        } else {
            // ── Buscando QR ──
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(0, 0, W, 50);
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(16, W * 0.03)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📷 Enfoca el código QR de la hoja', W / 2, 25);

            // Indicador sutil de zona esperada del QR
            const tgtX = W * 0.72;
            const tgtY = H * 0.3;
            const tgtS = Math.min(W, H) * 0.15;
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 6]);
            ctx.strokeRect(tgtX - tgtS / 2, tgtY - tgtS / 2, tgtS, tgtS);
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = `${Math.max(11, W * 0.02)}px sans-serif`;
            ctx.fillText('QR aquí', tgtX, tgtY);
        }
    }
};

/* ─── Eventos ─── */
document.getElementById('start-scan')?.addEventListener('click', () => scanner.start());
document.getElementById('stop-scan')?.addEventListener('click',  () => scanner.stop());
window.addEventListener('DOMContentLoaded', () => scanner.init());
