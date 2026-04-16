/**
 * ZIPCASTELLANO SCANNER v5 — QR-Anchored Grading (Clean Rewrite)
 *
 * Cambios sobre v4:
 *  - Eliminadas todas las constantes duplicadas
 *  - Geometría derivada directamente de los valores reales del printer.js
 *  - Sistema de mapeo con rotación y escala basado en el QR detectado
 *  - Sin errores de sintaxis
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
    lastQRCheck: 0,

    // Grading state
    currentStudent: null,
    currentExam: null,
    currentResult: null,
    cooldown: false,
    clickBound: null,
    gradedImageDataUrl: null,

    /* ═══════════════════════════════════════════════════════════
     * CONSTANTES FÍSICAS DEL LAYOUT
     * Derivadas directamente de printer.js y CSS del sheet
     * 1 CSS px = 0.2646 mm  (96dpi → mm)
     *
     * La hoja tiene:
     *  - .inner: top:22mm left:22mm right:22mm
     *  - innerWidth = 215.9mm - 22mm*2 = 171.9mm
     *
     * El QR (.student-box img):
     *  - CSS: width:130px height:130px border:3px
     *  - Total box = 130px = 34.4mm
     *  - Border = 3px = 0.79mm cada lado → contenido = 130-6 = 124px = 32.8mm
     *  - Está al final del .student-box, alineado a la derecha
     *
     * Centro X del QR desde el borde izquierdo del .inner:
     *  = innerWidth - (qrTotalWidth/2)
     *  = 171.9 - (34.4/2) = 171.9 - 17.2 = 154.7mm
     *
     * Centro Y del QR desde el borde superior del .inner:
     *  - header-img: ~75px max-height + 8px padding-bottom + 10px margin-bottom = ~93px ≈ 24.6mm
     *    (usamos ~25mm en la práctica real impresa)
     *  - exam-info: font-size 13px, dos líneas + margin 12px ≈ ~14mm
     *  - student-box: padding 12px top + border 2px + std-name 16px + gap + std-info + padding 12px bottom
     *    → total ≈ 12+2+21+6+13+2+12 = 68px ≈ 18mm, centrado = 9mm desde top
     *  - Y_center ≈ 25 + 14 + 9 = 48mm  (ajustado empíricamente a 52mm)
     *
     * La grilla de burbujas empieza después del student-box:
     *  top del .student-box: 25+14 = 39mm
     *  height del .student-box: ~18mm
     *  margin-bottom del .student-box: 22px = 5.82mm
     *  → Y top de la grilla desde top del .inner: 39 + 18 + 5.82 = 62.82mm
     *
     * GRID_OFFSET = (grilla) - (centro QR)
     *  dx = 0 (left of .inner) - 154.7 = -154.7mm
     *  dy = 62.82 - 52 = 10.82mm
     * ═══════════════════════════════════════════════════════════ */

    // Tamaño del contenido del QR (sin borde) en mm
    QR_CONTENT_MM: 32.8,

    // Offset del top-left de la grilla RELATIVO AL CENTRO DEL QR (mm)
    // Ajustar dy si la grilla aparece arriba/abajo de donde debe
    GRID_OFFSET: { x: -154.7, y: 10.82 },

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
        if (exams.list.length === 0) {
            sel.innerHTML = '<option value="">⚠️ No hay exámenes. Créalos en "Exámenes"</option>';
            sel.disabled = true;
        } else {
            sel.innerHTML = '<option value="">(Auto-detect por QR) Selecciona...</option>' +
                exams.list.map(e =>
                    `<option value="${e.id}" ${e.id === cur ? 'selected' : ''}>${e.name} · ${e.grade}</option>`
                ).join('');
            sel.disabled = false;
        }
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
        if (exams.list.length === 0) {
            alert('🛑 No tienes exámenes guardados.\n\nVe a "Exámenes" → "Nuevo Examen" y configura las respuestas correctas primero.');
            return;
        }

        const exam = this.getActiveExam();

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
            this.qrLocation = null;
            this.lastQRCheck = 0;

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

        if (!this.currentStudent) {
            app.toast('⚠️ Enfoca el QR primero para identificar al estudiante.', true);
            return;
        }
        if (!this.currentExam) {
            app.toast('⚠️ El examen de esta hoja no está guardado. Créalo en "Exámenes".', true);
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
        // Throttle a ~3 veces/segundo para que la cámara no se sienta lenta
        const now = Date.now();
        if (now - this.lastQRCheck < 300) return;
        this.lastQRCheck = now;

        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const qr = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'dontInvert'
        });

        if (qr && qr.data && qr.data.startsWith('ZC|')) {
            this.qrLocation = qr.location;
            this.qrVersion  = qr.version || this._guessVersion(qr.data);

            if (qr.data !== this.lastQR) {
                this.lastQR  = qr.data;
                this.qrData  = qr.data;
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

        if (exam) this.currentExam = exam;
        this.currentStudent = student;

        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        try {
            const actx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = actx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, actx.currentTime);
            osc.connect(actx.destination);
            osc.start();
            osc.stop(actx.currentTime + 0.15);
        } catch (e) { /* ignore */ }

        this.setStatus(`✅ ${student.name} — ¡TOCA LA PANTALLA!`, '#10b981');
    },

    /* ═══════════════════════════════════════════════════════════
     * CÁLCULO DEL LAYOUT (espeja printer.js)
     * ═══════════════════════════════════════════════════════════ */

    getLayout(numQ) {
        const PX = 0.2646; // mm por CSS px
        const cols = 3;
        const rowsPerCol = Math.ceil(numQ / cols);
        const rowMM = Math.min(10.5, Math.max(5.5, 173 / rowsPerCol));

        const bubblePx = Math.round(Math.min(22, Math.max(15, rowMM * 2.2)));
        const fontPx   = Math.round(bubblePx * 0.7);
        const numPx    = Math.round(fontPx * 1.3);

        const colGap = 24 * PX;  // gap entre columnas (24px CSS)
        const rowGap = 4 * PX;   // gap entre filas (4px CSS)
        const innerW = 171.9;    // ancho del .inner en mm
        const colW   = (innerW - 2 * colGap) / cols;

        const qnumW = numPx * 2.8 * PX; // ancho del span .qnum
        const gap   = 5 * PX;           // gap del flexbox .qrow
        const bDiam = bubblePx * PX;    // diámetro de la burbuja

        return {
            cols, rowsPerCol, rowMM, rowGap,
            colW, colGap,
            bubbleStartX: qnumW + gap + bDiam / 2,
            bubbleSpacing: bDiam + gap,
            bubbleRadius: bDiam / 2,
        };
    },

    /**
     * Posición (mm) del centro de una burbuja RELATIVA AL CENTRO DEL QR.
     * q = 0-based question index, opt = 0-4 (A-E)
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
     * a coordenadas de píxeles, compensando rotación y escala.
     */
    mmToPixel(dx, dy, cx, cy, angle, pxPerMm) {
        return {
            x: cx + (dx * Math.cos(angle) - dy * Math.sin(angle)) * pxPerMm,
            y: cy + (dx * Math.sin(angle) + dy * Math.cos(angle)) * pxPerMm
        };
    },

    /* ═══════════════════════════════════════════════════════════
     * CALIFICACIÓN
     * ═══════════════════════════════════════════════════════════ */

    gradeSheet() {
        const student = this.currentStudent;
        const exam    = this.currentExam;

        // Capturar frame congelado
        const snap = document.createElement('canvas');
        snap.width  = this.video.videoWidth;
        snap.height = this.video.videoHeight;
        const sCtx = snap.getContext('2d');
        sCtx.drawImage(this.video, 0, 0);

        // Re-detectar QR en la captura para posición exacta
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
            console.warn('[Scanner] QR no visible en captura, usando última posición conocida');
            app.toast('⚠️ QR no visible en captura; usando última posición.', true);
        } else {
            app.toast('❌ No se detectó el QR. Mueve el papel y toca de nuevo.', true);
            this.cooldown = false;
            return;
        }

        const result = this.analyzeBubbles(sCtx, snap, exam, qrLoc, qrVer);
        this.generateGradedImage(sCtx, snap, exam, result);
        this.showResult(student, exam, result);
    },

    analyzeBubbles(ctx, canvas, exam, qrLoc, version) {
        // ── Geometría del QR ──
        const tl = qrLoc.topLeftCorner;
        const tr = qrLoc.topRightCorner;
        const bl = qrLoc.bottomLeftCorner;
        const br = qrLoc.bottomRightCorner;

        // Centro del QR
        const qrCX = (tl.x + br.x) / 2;
        const qrCY = (tl.y + br.y) / 2;

        // Tamaño del QR en píxeles (promedio de los dos lados medibles)
        const topEdge  = Math.hypot(tr.x - tl.x, tr.y - tl.y);
        const leftEdge = Math.hypot(bl.x - tl.x, bl.y - tl.y);
        const qrSizePx = (topEdge + leftEdge) / 2;

        // Ángulo de rotación del papel
        const angle = Math.atan2(tr.y - tl.y, tr.x - tl.x);

        // ── Escala (píxeles por mm) ──
        // El QR en la hoja impresa: 130px CSS total, 6px de borde → 124px contenido = 32.8mm
        // jsQR detecta el área de datos (sin quiet zone).
        // La quiet zone varía: la API qrserver.com usa margin=0 por defecto (0 módulos).
        // Entonces jsQR.location devuelve el boundary del área de datos directamente.
        // → El tamaño detectado en px corresponde a los 32.8mm exactos.
        const pxPerMm = qrSizePx / this.QR_CONTENT_MM;

        console.log(`[Scanner] v${version}: QR=${qrSizePx.toFixed(0)}px, ` +
                    `scale=${pxPerMm.toFixed(2)}px/mm, ` +
                    `angle=${(angle * 180 / Math.PI).toFixed(1)}°`);

        // ── Análisis de burbujas ──
        const numQ = exam.questions.length;
        const L    = this.getLayout(numQ);
        const OPTS = ['A', 'B', 'C', 'D', 'E'];
        const answers    = [];
        const bubbleData = [];

        // Radio de muestreo ligeramente mayor que el radio real para tolerancia
        const sampleR = L.bubbleRadius * 1.4 * pxPerMm;

        for (let q = 0; q < numQ; q++) {
            const brights   = [];
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

            // La burbuja más oscura es la marcada
            let minB = Infinity, minI = 0;
            brights.forEach((b, i) => { if (b < minB) { minB = b; minI = i; } });

            const sorted   = [...brights].sort((a, b) => a - b);
            const median   = sorted[2];
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
     * Brillo promedio dentro de un círculo (luminancia ITU-R 601).
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
                        // Verde: correcta
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
                        // Roja: incorrecta
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

                // Amarillo: la respuesta correcta cuando el estudiante erró
                if (!q.isCorrect && p.option === q.correct) {
                    g.beginPath();
                    g.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
                    g.strokeStyle = '#facc15';
                    g.lineWidth = 2.5;
                    g.stroke();
                }
            });
        });

        // Banner superior con puntaje
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

        document.getElementById('res-name').textContent  = student.name;
        document.getElementById('res-grade').textContent = student.grade;
        document.getElementById('res-id').textContent    = student.id;

        const scoreEl = document.getElementById('res-score');
        scoreEl.textContent = `${correct}/${exam.questions.length}`;
        scoreEl.style.color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';

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

            // Guardado local primero
            const history = JSON.parse(localStorage.getItem('zc_results') || '[]');
            history.push(obj);
            localStorage.setItem('zc_results', JSON.stringify(history));
            console.log('[Scanner] Guardado local. Total:', history.length);

            app.toast(`✅ ${student.name}: ${correct}/${exam.questions.length} — Guardado`);

            // Sync nube (no bloqueante)
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

            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, H / 2 - 35, W, 70);
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.round(H * 0.045)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`✅ ${this.currentStudent.name}`, W / 2, H / 2 - 10);
            ctx.font = `${Math.round(H * 0.03)}px sans-serif`;
            ctx.fillStyle = '#facc15';
            ctx.fillText('TOCA LA PANTALLA PARA CALIFICAR', W / 2, H / 2 + 18);

        } else {
            // Guía de alineación
            const size = Math.min(W, H) * 0.55;
            const x = (W - size) / 2;
            const y = (H - size) / 2;
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 5]);
            ctx.strokeRect(x, y, size, size);
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, H * 0.78, W, H * 0.12);
            ctx.fillStyle = '#fff';
            ctx.font = `${Math.round(H * 0.035)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Centra el código QR en el recuadro', W / 2, H * 0.84);
        }
    }
};
