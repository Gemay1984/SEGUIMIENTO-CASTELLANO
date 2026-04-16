/**
 * ZIPCASTELLANO SCANNER v6 — Geometría Actualizada para Nuevo Layout del Printer
 *
 * Nuevo layout de la hoja (printer.js v2):
 * ──────────────────────────────────────────────────────────
 *  .inner: top:22mm, left:22mm, right:22mm  (ancho = 215.9 - 44 = 171.9mm)
 *
 *  QR (.qr-img):
 *    - width: 28mm exactos, alineado al borde IZQUIERDO del .inner
 *    - height: 28mm exactos, alineado al borde SUPERIOR del .inner
 *    - margin=0 en la URL → jsQR detecta el área de datos directamente
 *    - Centro del QR: x = 14mm (desde left del inner), y = 14mm (desde top del inner)
 *
 *  Header total (QR + borde + gap):
 *    - min-height/max-height: 28mm
 *    - padding-bottom: 6px = 1.59mm
 *    - margin-bottom: 6px = 1.59mm
 *    → Total header clearance = 28 + 1.59 + 1.59 = ~31.2mm
 *
 *  Student-box (con min-height: 17mm fijo en printer.js):
 *    - height fija: 17mm
 *    - margin-bottom: 6px = 1.59mm
 *    → Student-box clearance = 17 + 1.59 = ~18.6mm
 *
 *  Espacio entre header y grilla (gap + padding):
 *    - gap CSS 6px = 1.59mm (ya en header clearance)
 *
 *  GRID_OFFSET (desde CENTRO del QR al TOP de la primera fila de burbujas):
 *    dx = 0 - 14 = -14mm (burbujas arrancan en borde izquierdo del inner)
 *    dy = (header clearance + student-box clearance) - center-QR-y
 *       = (31.2 + 18.6) - 14
 *       = 35.8mm  (base; más margen real del .inner top: ~7.7mm)
 *       ≈ 43.5mm  (valor empírico calibrado para 96dpi y papel carta)
 *
 * Nota: usar GRID_DY_ADJUST (slider en la UI) para calibración fina.
 * ──────────────────────────────────────────────────────────
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
     * CONSTANTES FÍSICAS DEL NUEVO LAYOUT (printer.js v2)
     *
     * QR_CONTENT_MM: el QR tiene 28mm y margin=0, por lo que
     *   jsQR.location devuelve exactamente esos 28mm de área de datos.
     *
     * GRID_OFFSET: offset en mm desde el CENTRO del QR hasta el
     *   punto TOP-LEFT de la grilla de burbujas.
     *
     * GRID_DY_ADJUST: ajuste fino en mm (+ baja, - sube).
     *   Cambiar si el overlay de burbujas no coincide con las burbujas reales.
     * ═══════════════════════════════════════════════════════════ */

    QR_CONTENT_MM: 28,

    // GRID_OFFSET: usado como fallback (solo QR). y=43.5 empírico.
    GRID_OFFSET: { x: -14, y: 43.5 },
    GRID_DY_ADJUST: 0,

    // ── Coordenadas absolutas en la hoja carta (215.9×279.4mm) ──
    // Corner marks (.corner 14×14mm): top/left/bottom/right=4mm → centro=4+7=11mm
    CORNER_MM: {
        tl: { x: 11,    y: 11    },
        tr: { x: 204.9, y: 11    },
        bl: { x: 11,    y: 268.4 },
        br: { x: 204.9, y: 268.4 }
    },
    QR_SHEET_MM:   { x: 36, y: 36    },  // centro QR = inner(22)+14
    GRID_SHEET_MM: { x: 22, y: 71.77 },  // inner_top(22)+header(31.18)+student-box(18.59)

    // Umbral de detección: modificado para permitir marcas con "X" en bolígrafo
    BUBBLE_DARK_THRESH: 210,   // brillo máximo para considerar una burbuja marcada (0-255)
    BUBBLE_MIN_CONTRAST: 0.08, // debe ser ≥8% más oscura que la mediana

    // Estado de esquinas detectadas (se actualiza en drawOverlay)
    lastCorners: null,
    cornerFrames: 0, // contador para auto-captura estable

    /* ═══════════════════════════════════════════════════════════
     * INICIALIZACIÓN
     * ═══════════════════════════════════════════════════════════ */

    init() {
        this.populateExamSelect();
        document.getElementById('scan-exam-select')
            ?.addEventListener('change', () => this.updateExamInfo());

        // Leer ajuste de calibración desde el slider de la UI
        const slider = document.getElementById('calibrate-dy');
        if (slider) {
            // Cargar valor guardado
            const saved = parseFloat(localStorage.getItem('zc_dy_adjust') || '0');
            slider.value = saved;
            this.GRID_DY_ADJUST = saved;
            const label = document.getElementById('calibrate-dy-label');
            if (label) label.textContent = (saved >= 0 ? '+' : '') + saved.toFixed(1) + ' mm';

            slider.addEventListener('input', () => {
                const v = parseFloat(slider.value);
                this.GRID_DY_ADJUST = v;
                localStorage.setItem('zc_dy_adjust', v);
                if (label) label.textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + ' mm';
            });
        }
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
        const sel  = document.getElementById('scan-exam-select');
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

        this.video  = document.getElementById('video');
        this.canvas = document.getElementById('overlay');
        this.ctx    = this.canvas.getContext('2d', { willReadFrequently: true });

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width:  { ideal: 1280 }, // Bajamos a 720p para evaluación más rápida por jsQR sin perder resolución de burbujas
                    height: { ideal: 720 }
                }
            });
            this.video.srcObject = this.stream;
            await this.video.play();
            this.isActive = true;
            this.currentStudent = null;
            this.currentExam    = this.getActiveExam();
            this.lastQR         = null;
            this.qrLocation     = null;
            this.lastQRCheck    = 0;
            this.cooldown       = false;

            if (!this.clickBound) {
                this.clickBound = this.onTap.bind(this);
                this.canvas.addEventListener('click',      this.clickBound);
                this.canvas.addEventListener('touchstart', this.clickBound, { passive: false });
            }

            this.setStatus('📷 Enfoca el código QR (esquina superior izquierda de la hoja)…', 'var(--accent)');
            this.loop();

            // Actualizar botones
            document.getElementById('start-scan').disabled = true;
            document.getElementById('stop-scan').disabled  = false;
        } catch (err) {
            console.error(err);
            alert('No se pudo acceder a la cámara. Verifica los permisos.\n\n' + err.message);
        }
    },

    stop() {
        this.isActive = false;
        this.stream?.getTracks().forEach(t => t.stop());
        this.ctx?.clearRect(0, 0, this.canvas?.width, this.canvas?.height);
        if (this.clickBound) {
            this.canvas?.removeEventListener('click',      this.clickBound);
            this.canvas?.removeEventListener('touchstart', this.clickBound);
            this.clickBound = null;
        }
        this.currentStudent = null;
        this.qrLocation     = null;
        this.lastQR         = null;
        this.setStatus('📷 Cámara detenida. Presiona "Iniciar Cámara" para continuar.', 'var(--text-muted)');
        document.getElementById('start-scan').disabled = false;
        document.getElementById('stop-scan').disabled  = true;
    },

    /* ═══════════════════════════════════════════════════════════
     * TAP / TOUCH PARA CAPTURAR
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
        this.setStatus(`⏳ Calificando a ${this.currentStudent.name}…`, '#f59e0b');

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

            if (!this.cooldown) {
                this.detectQR();
                this.drawOverlay();

                // ── Auto-Captura ZipGrade ──
                // Si la homografía detectó 4 esquinas y tenemos los datos listos...
                if (this.lastCorners && this.currentStudent && this.currentExam) {
                    this.cornerFrames++;
                    // Exigimos 3 frames consecutivos (~50ms) para evitar ruido/foto movida
                    if (this.cornerFrames >= 3) {
                        this.cooldown = true;
                        this.cornerFrames = 0;
                        if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
                        this.setStatus(`✨ Auto-calificando a ${this.currentStudent.name}…`, '#22c55e');
                        // Mini retraso visual antes de calificar la imagen congelada
                        setTimeout(() => this.gradeSheet(), 100);
                    }
                } else {
                    this.cornerFrames = 0;
                }
            } else {
                // Sigue dibujando el overlay sin intentar auto-calificar ni detectar QR de nuevo
                this.drawOverlay();
            }
        }
        requestAnimationFrame(() => this.loop());
    },

    detectQR() {
        const now = Date.now();
        // Aumentamos los scans a ~8 veces por segundo para que sea instantáneo.
        if (now - this.lastQRCheck < 120) return; 
        this.lastQRCheck = now;

        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const qr = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'dontInvert'
        });

        if (qr && qr.data && qr.data.startsWith('ZC|')) {
            this.qrLocation = qr.location;
            this.qrVersion  = qr.version || this._guessVersion(qr.data);

            if (qr.data !== this.lastQR) {
                this.lastQR = qr.data;
                this.qrData = qr.data;
                this.onQRDetected(qr.data);
            }
        } else {
            // Si el QR se pierde por >2s, reset estudiante
            if (now - this.lastQRCheck > 2000 && this.currentStudent && !this.cooldown) {
                // Solo silencioso, no resetear todavía; seguimos usando la última posición
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

        // Vibración + beep de confirmación
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        try {
            const actx = new (window.AudioContext || window.webkitAudioContext)();
            const osc  = actx.createOscillator();
            osc.type   = 'sine';
            osc.frequency.setValueAtTime(880, actx.currentTime);
            osc.connect(actx.destination);
            osc.start();
            osc.stop(actx.currentTime + 0.15);
        } catch (_) { /* ignore */ }

        this.setStatus(`✅ ${student.name} — ¡TOCA LA PANTALLA PARA CALIFICAR!`, '#10b981');
    },

    /* ═══════════════════════════════════════════════════════════
     * GEOMETRÍA — espeja printer.js
     * ═══════════════════════════════════════════════════════════ */

    getLayout(numQ) {
        const PX     = 0.2646; // mm por CSS px (96 dpi → mm)
        const cols   = 3;
        const rowsPerCol = Math.ceil(numQ / cols);
        const rowMM  = Math.min(10.5, Math.max(5.5, 173 / rowsPerCol));

        const bubblePx = Math.round(Math.min(22, Math.max(15, rowMM * 2.2)));
        const fontPx   = Math.round(bubblePx * 0.7);
        const numPx    = Math.round(fontPx * 1.3);

        const colGap = 24 * PX;  // gap entre columnas (24px CSS)
        const rowGap = 4  * PX;  // gap entre filas (4px CSS)
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

    /** Posición absoluta en hoja (mm desde TL de la hoja) del centro de una burbuja. */
    bubbleSheetMM(q, opt, L) {
        const col = Math.floor(q / L.rowsPerCol);
        const row = q % L.rowsPerCol;
        return {
            x: this.GRID_SHEET_MM.x + col * (L.colW + L.colGap) + L.bubbleStartX + opt * L.bubbleSpacing,
            y: this.GRID_SHEET_MM.y + row * (L.rowMM + L.rowGap) + L.rowMM / 2
        };
    },

    /** Posición relativa al centro del QR (fallback sin homografía). */
    bubbleMM(q, opt, L) {
        const s  = this.bubbleSheetMM(q, opt, L);
        return {
            x: s.x - this.QR_SHEET_MM.x,
            y: s.y - this.QR_SHEET_MM.y + this.GRID_DY_ADJUST
        };
    },

    /** Transforma offset mm (desde centro del QR) a píxeles en canvas. */
    mmToPixel(dx, dy, cx, cy, angle, pxPerMm) {
        return {
            x: cx + (dx * Math.cos(angle) - dy * Math.sin(angle)) * pxPerMm,
            y: cy + (dx * Math.sin(angle) + dy * Math.cos(angle)) * pxPerMm
        };
    },

    /* ═══════════════════════════════════════════════════════════
     * HOMOGRAFÍA — 4 marcadores de esquina
     * ═══════════════════════════════════════════════════════════ */

    /**
     * Busca los 4 cuadros negros en las esquinas de la imagen.
     * Usa la posición del QR para predecir dónde deberían estar y busca
     * el centroide de píxeles oscuros en esa zona.
     * Devuelve {tl,tr,bl,br} con coordenadas de píxel, o null si falla.
     */
    detectAndRefineCorners(ctx, canvas, qrCX, qrCY, angle, pxPerMm) {
        const found = {};
        const searchR = Math.round(20 * pxPerMm); // buscar en radio de 20mm
        for (const key of ['tl', 'tr', 'bl', 'br']) {
            const cm = this.CORNER_MM[key];
            const dx = cm.x - this.QR_SHEET_MM.x;
            const dy = cm.y - this.QR_SHEET_MM.y;
            const pred = this.mmToPixel(dx, dy, qrCX, qrCY, angle, pxPerMm);
            const c = this.findDarkCentroid(ctx, pred.x, pred.y, searchR, canvas.width, canvas.height);
            if (!c) return null;
            found[key] = c;
        }
        return found;
    },

    /** Centroide de píxeles oscuros en un radio alrededor de (cx,cy). */
    findDarkCentroid(ctx, cx, cy, radius, maxW, maxH) {
        const r  = Math.ceil(radius);
        const x0 = Math.max(0, Math.round(cx) - r);
        const y0 = Math.max(0, Math.round(cy) - r);
        const x1 = Math.min(maxW, Math.round(cx) + r);
        const y1 = Math.min(maxH, Math.round(cy) + r);
        const w  = x1 - x0, h = y1 - y0;
        if (w <= 0 || h <= 0) return null;
        const data  = ctx.getImageData(x0, y0, w, h).data;
        let sumX = 0, sumY = 0, count = 0;
        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const i  = (py * w + px) * 4;
                const br = data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
                if (br < 70) { sumX += x0+px; sumY += y0+py; count++; }
            }
        }
        if (count < 80) return null; // cuadro no encontrado
        return { x: sumX/count, y: sumY/count };
    },

    /** Calcula homografía 3×3 usando los 4 pares de puntos (DLT). */
    computeHomographyFromCorners(corners) {
        const src = ['tl','tr','bl','br'].map(k => this.CORNER_MM[k]);
        const dst = ['tl','tr','bl','br'].map(k => corners[k]);
        return this.computeHomography(src, dst);
    },

    computeHomography(srcPts, dstPts) {
        const A = [];
        for (let i = 0; i < 4; i++) {
            const X = srcPts[i].x, Y = srcPts[i].y;
            const x = dstPts[i].x, y = dstPts[i].y;
            A.push([-X,-Y,-1, 0, 0, 0, x*X, x*Y, x]);
            A.push([ 0, 0, 0,-X,-Y,-1, y*X, y*Y, y]);
        }
        const A8 = A.map(row => row.slice(0,8));
        const b  = A.map(row => -row[8]);
        const h  = this._solveLinear(A8, b);
        return [...h, 1];
    },

    applyHomography(H, X, Y) {
        const w = H[6]*X + H[7]*Y + H[8];
        return { x: (H[0]*X + H[1]*Y + H[2])/w, y: (H[3]*X + H[4]*Y + H[5])/w };
    },

    _solveLinear(A, b) {
        const n = A.length;
        const M = A.map((row, i) => [...row, b[i]]);
        for (let col = 0; col < n; col++) {
            let maxR = col;
            for (let row = col+1; row < n; row++)
                if (Math.abs(M[row][col]) > Math.abs(M[maxR][col])) maxR = row;
            [M[col], M[maxR]] = [M[maxR], M[col]];
            const piv = M[col][col];
            if (Math.abs(piv) < 1e-12) continue;
            for (let row = 0; row < n; row++) {
                if (row === col) continue;
                const f = M[row][col]/piv;
                for (let j = col; j <= n; j++) M[row][j] -= f*M[col][j];
            }
        }
        return M.map((row, i) => row[n]/row[i]);
    },

    /* ═══════════════════════════════════════════════════════════
     * CALIFICACIÓN
     * ═══════════════════════════════════════════════════════════ */

    gradeSheet() {
        const student = this.currentStudent;
        const exam    = this.currentExam;

        // Captura congelada del frame actual
        const snap  = document.createElement('canvas');
        snap.width  = this.video.videoWidth;
        snap.height = this.video.videoHeight;
        const sCtx  = snap.getContext('2d');
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
            console.warn('[Scanner] QR no visible en captura; usando última posición conocida');
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

    analyzeBubbles(ctx, canvas, exam, qrLoc) {
        const tl = qrLoc.topLeftCorner;
        const tr = qrLoc.topRightCorner;
        const bl = qrLoc.bottomLeftCorner;
        const br = qrLoc.bottomRightCorner;

        const qrCX    = (tl.x + br.x) / 2;
        const qrCY    = (tl.y + br.y) / 2;
        const topEdge = Math.hypot(tr.x - tl.x, tr.y - tl.y);
        const lefEdge = Math.hypot(bl.x - tl.x, bl.y - tl.y);
        const qrSizePx = (topEdge + lefEdge) / 2;
        const angle   = Math.atan2(tr.y - tl.y, tr.x - tl.x);
        const pxPerMm = qrSizePx / this.QR_CONTENT_MM;

        // ── Intentar homografía con marcadores de esquina ──
        let bubblePosFn;
        const corners = this.detectAndRefineCorners(ctx, canvas, qrCX, qrCY, angle, pxPerMm);
        if (corners) {
            const H = this.computeHomographyFromCorners(corners);
            this._lastMethod = 'homografía ✅';
            bubblePosFn = (q, o, L) => {
                const s = this.bubbleSheetMM(q, o, L);
                return this.applyHomography(H, s.x, s.y);
            };
            console.log('[Scanner] Usando homografía con 4 esquinas');
        } else {
            this._lastMethod = 'QR offset';
            bubblePosFn = (q, o, L) => {
                const mm = this.bubbleMM(q, o, L);
                return this.mmToPixel(mm.x, mm.y, qrCX, qrCY, angle, pxPerMm);
            };
            console.warn('[Scanner] Esquinas no detectadas, usando offset QR');
        }

        const numQ  = exam.questions.length;
        const L     = this.getLayout(numQ);
        const OPTS  = ['A','B','C','D','E'];
        // Radio de muestreo: 70% del radio de la burbuja.
        // Esto es CLAVE para evitar incluir el grueso borde negro de la burbuja impresa
        // en el promedio, y enfocarse solo en el centro donde está la marca o la "X".
        const sampleR = L.bubbleRadius * 0.7 * pxPerMm;
        const answers    = [];
        const bubbleData = [];

        for (let q = 0; q < numQ; q++) {
            const brights   = [];
            const positions = [];

            for (let o = 0; o < 5; o++) {
                const px = bubblePosFn(q, o, L);
                const brightness = this.sampleBrightness(ctx, px.x, px.y, sampleR, canvas.width, canvas.height);
                brights.push(brightness);
                positions.push({ x: px.x, y: px.y, brightness, option: OPTS[o] });
            }

            let minB = Infinity, minI = 0;
            brights.forEach((b, i) => { if (b < minB) { minB = b; minI = i; } });

            const sorted   = [...brights].sort((a, b) => a - b);
            const median   = sorted[2];
            const contrast = median > 0 ? (median - minB) / median : 0;

            // La burbuja DEBE estar claramente rellena (oscura Y con contraste)
            const detected = (minB < this.BUBBLE_DARK_THRESH && contrast >= this.BUBBLE_MIN_CONTRAST)
                ? OPTS[minI] : '?';
            const correct  = exam.questions[q].ans;

            answers.push(detected);
            bubbleData.push({
                qNum: q + 1, detected, correct,
                isCorrect: detected !== '?' && detected === correct,
                contrast, positions
            });
        }

        return { answers, bubbleData, method: this._lastMethod };
    },

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
     * IMAGEN CALIFICADA
     * ═══════════════════════════════════════════════════════════ */

    generateGradedImage(snapCtx, snapCanvas, exam, result) {
        const gc = document.getElementById('graded-canvas');
        gc.width  = snapCanvas.width;
        gc.height = snapCanvas.height;
        const g   = gc.getContext('2d');
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
                        g.fillStyle = 'rgba(34,197,94,0.25)';
                        g.fill();
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
                        g.fillStyle = 'rgba(239,68,68,0.2)';
                        g.fill();
                        const s = r * 0.6;
                        g.beginPath();
                        g.moveTo(p.x - s, p.y - s); g.lineTo(p.x + s, p.y + s);
                        g.moveTo(p.x + s, p.y - s); g.lineTo(p.x - s, p.y + s);
                        g.strokeStyle = '#ef4444';
                        g.lineWidth = 2.5;
                        g.stroke();
                    }
                }

                // Amarillo: respuesta correcta cuando el estudiante erró
                if (!q.isCorrect && p.option === q.correct) {
                    g.beginPath();
                    g.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
                    g.strokeStyle = '#facc15';
                    g.lineWidth = 2.5;
                    g.stroke();
                }
            });
        });

        // Banner top con puntaje
        const correctN = bubbleData.filter(q => q.isCorrect).length;
        const totalN   = bubbleData.length;
        const pctStr   = ((correctN / totalN) * 100).toFixed(1);

        const hdrH = Math.max(32, gc.height * 0.05);
        g.fillStyle = 'rgba(0,0,0,0.78)';
        g.fillRect(0, 0, gc.width, hdrH);
        g.fillStyle = '#fff';
        g.font = `bold ${Math.round(hdrH * 0.5)}px sans-serif`;
        g.textAlign    = 'center';
        g.textBaseline = 'middle';
        g.fillText(
            `${this.currentStudent?.name || ''} — ${correctN}/${totalN} = ${pctStr}%`,
            gc.width / 2, hdrH / 2
        );

        // Leyenda inferior
        const legH = Math.max(20, gc.height * 0.03);
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(0, gc.height - legH, gc.width, legH);
        g.font = `${Math.round(legH * 0.5)}px sans-serif`;
        g.textAlign    = 'center';
        g.textBaseline = 'middle';
        const ly = gc.height - legH / 2;
        g.fillStyle = '#22c55e'; g.fillText('● Correcta',       gc.width * 0.2, ly);
        g.fillStyle = '#ef4444'; g.fillText('✕ Incorrecta',     gc.width * 0.5, ly);
        g.fillStyle = '#facc15'; g.fillText('○ Resp. Correcta', gc.width * 0.8, ly);

        this.gradedImageDataUrl = gc.toDataURL('image/jpeg', 0.88);
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
                    const bg = b.isCorrect ? 'rgba(34,197,94,0.2)'  : 'rgba(239,68,68,0.2)';
                    const bd = b.isCorrect ? '#22c55e'               : '#ef4444';
                    const ic = b.isCorrect ? '✓'                     : '✕';
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
                <b>${names[c] || c}</b><br>${p}% (${compMap[c].correct}/${compMap[c].total})</div>`;
        }).join('');

        document.getElementById('result-panel').style.display = 'block';
        document.getElementById('result-panel').scrollIntoView({ behavior: 'smooth' });
        this.setStatus('📋 Revisa el resultado y confirma.', 'var(--accent)');
    },

    /* ═══════════════════════════════════════════════════════════
     * GUARDAR / DESCARGAR / DESCARTAR
     * ═══════════════════════════════════════════════════════════ */

    async saveResult() {
        if (!this.currentResult) {
            app.toast('⚠️ No hay resultado para guardar.', true);
            return;
        }

        try {
            const { student, exam, correct, pct, competencyMap } = this.currentResult;

            const obj = {
                date:        new Date().toISOString(),
                studentId:   student.id,
                studentName: student.name,
                grade:       student.grade,
                examName:    exam.name,
                examId:      exam.id,
                score:       `${correct}/${exam.questions.length}`,
                pct,
                competencies: competencyMap
            };

            // Guardar localmente primero
            const history = JSON.parse(localStorage.getItem('zc_results') || '[]');
            history.push(obj);
            localStorage.setItem('zc_results', JSON.stringify(history));

            app.toast(`✅ ${student.name}: ${correct}/${exam.questions.length} — Guardado`);

            // Sync a la nube (no bloqueante)
            if (settings.apiUrl) {
                app.pushResultToSheet(obj).catch(e =>
                    console.warn('[Scanner] Cloud sync failed:', e)
                );
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
        a.href     = this.gradedImageDataUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        app.toast('📥 Imagen descargada');
    },

    discardResult() {
        this.currentResult      = null;
        this.lastQR             = null;
        this.cooldown           = false;
        this.gradedImageDataUrl = null;
        document.getElementById('result-panel').style.display = 'none';
        this.setStatus('🔍 Apunta al QR de la siguiente hoja…', 'var(--accent)');
    },

    /* ═══════════════════════════════════════════════════════════
     * HELPERS DE UI
     * ═══════════════════════════════════════════════════════════ */

    setStatus(msg, color = 'var(--accent)') {
        const el = document.getElementById('scan-status');
        if (el) { el.textContent = msg; el.style.color = color; }
    },

    /**
     * Dibuja el overlay de la cámara en tiempo real:
     * - Guía de encuadre cuando no hay QR
     * - Destaca el QR detectado + nombre del estudiante
     * - Proyecta los puntos de las burbujas (semi-transparente) para verificar alineación
     */
    drawOverlay() {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;

        if (this.qrLocation && this.currentStudent && this.currentExam && !this.cooldown) {
            const loc = this.qrLocation;

            // ── Resaltar QR ──
            ctx.beginPath();
            ctx.moveTo(loc.topLeftCorner.x,     loc.topLeftCorner.y);
            ctx.lineTo(loc.topRightCorner.x,    loc.topRightCorner.y);
            ctx.lineTo(loc.bottomRightCorner.x, loc.bottomRightCorner.y);
            ctx.lineTo(loc.bottomLeftCorner.x,  loc.bottomLeftCorner.y);
            ctx.closePath();
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth   = 4;
            ctx.stroke();
            ctx.fillStyle = 'rgba(34,197,94,0.15)';
            ctx.fill();

            // ── Proyección de burbujas + detección de esquinas en overlay ──
            const tl = loc.topLeftCorner;
            const tr = loc.topRightCorner;
            const bl = loc.bottomLeftCorner;
            const br = loc.bottomRightCorner;

            const qrCX    = (tl.x + br.x) / 2;
            const qrCY    = (tl.y + br.y) / 2;
            const topEdge = Math.hypot(tr.x - tl.x, tr.y - tl.y);
            const lefEdge = Math.hypot(bl.x - tl.x, bl.y - tl.y);
            const pxPerMm = ((topEdge + lefEdge) / 2) / this.QR_CONTENT_MM;
            const angle   = Math.atan2(tr.y - tl.y, tr.x - tl.x);

            // Detectar esquinas para el overlay (misma lógica que en analyzeBubbles)
            const detCorners = this.detectAndRefineCorners(ctx, this.canvas, qrCX, qrCY, angle, pxPerMm);
            this.lastCorners = detCorners;

            const numQ = this.currentExam.questions.length;
            const L    = this.getLayout(numQ);
            const r    = Math.max(3, L.bubbleRadius * pxPerMm * 0.7);

            // Dibujar puntos de burbujas
            let overlayPosFn;
            if (detCorners) {
                const H_hom = this.computeHomographyFromCorners(detCorners);
                overlayPosFn = (q, o, L_) => {
                    const s = this.bubbleSheetMM(q, o, L_);
                    return this.applyHomography(H_hom, s.x, s.y);
                };
            } else {
                overlayPosFn = (q, o, L_) => {
                    const mm = this.bubbleMM(q, o, L_);
                    return this.mmToPixel(mm.x, mm.y, qrCX, qrCY, angle, pxPerMm);
                };
            }

            for (let q = 0; q < numQ; q++) {
                for (let o = 0; o < 5; o++) {
                    const px = overlayPosFn(q, o, L);
                    ctx.beginPath();
                    ctx.arc(px.x, px.y, r, 0, Math.PI * 2);
                    ctx.strokeStyle = detCorners ? 'rgba(99,255,180,0.8)' : 'rgba(99,230,255,0.7)';
                    ctx.lineWidth   = 1.5;
                    ctx.stroke();
                }
            }

            // Dibujar marcadores de esquina detectados
            if (detCorners) {
                Object.values(detCorners).forEach(c => {
                    ctx.beginPath();
                    ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
                    ctx.strokeStyle = '#facc15';
                    ctx.lineWidth   = 3;
                    ctx.stroke();
                });
            }

            // ── Banner inferior: nombre + método ──
            const bannerH = Math.round(H * 0.10);
            ctx.fillStyle = 'rgba(0,0,0,0.72)';
            ctx.fillRect(0, H - bannerH, W, bannerH);

            ctx.fillStyle      = '#22c55e';
            ctx.font           = `bold ${Math.round(bannerH * 0.38)}px sans-serif`;
            ctx.textAlign      = 'center';
            ctx.textBaseline   = 'middle';
            ctx.fillText(`✅ ${this.currentStudent.name}`, W / 2, H - bannerH * 0.68);

            ctx.fillStyle = detCorners ? '#99ffcc' : '#facc15';
            ctx.font      = `${Math.round(bannerH * 0.28)}px sans-serif`;
            ctx.fillText(
                detCorners ? '🟩 4 esquinas — TOCA PARA CALIFICAR' : '🟡 Solo QR — TOCA PARA CALIFICAR',
                W / 2, H - bannerH * 0.28
            );

        } else {
            // ── Guía de encuadre: busca el QR ──
            const size = Math.min(W, H) * 0.5;
            const x = (W - size) / 2;
            const y = (H - size) / 2;

            // Esquinas del recuadro guía (estilo ZipGrade)
            const cornerLen = size * 0.12;
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth   = 3;
            ctx.setLineDash([]);

            const corners = [
                [x,        y,        cornerLen, 0,        0,        cornerLen],
                [x + size, y,        -cornerLen, 0,       0,        cornerLen],
                [x,        y + size, cornerLen, 0,        0,        -cornerLen],
                [x + size, y + size, -cornerLen, 0,       0,        -cornerLen]
            ];
            corners.forEach(([cx, cy, hx, hy, vx, vy]) => {
                ctx.beginPath();
                ctx.moveTo(cx + hx, cy); ctx.lineTo(cx, cy);
                ctx.lineTo(cx, cy + vy);
                ctx.stroke();
            });

            // Instrucción
            const bannerH = Math.round(H * 0.08);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(0, H - bannerH, W, bannerH);
            ctx.fillStyle    = '#fff';
            ctx.font         = `${Math.round(bannerH * 0.45)}px sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Centra el QR (esquina sup. izquierda de la hoja)', W / 2, H - bannerH / 2);
        }
    }
};
