/**
 * ZIPCASTELLANO SCANNER v9.4 — Geometría por Diagonal (QR + Anchor)
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

    // Auto-Captura Inteligente — estabilidad del QR
    consecutiveStableFrames: 0,
    lastStableQRLocation: null,
    STABLE_THRESHOLD_PX: 8,      // máx movimiento en px para considerar "estable"
    STABLE_FRAMES_REQUIRED: 20,   // 20 detecciones reales @ ~8Hz = ~2.5s de estabilidad
    autoCaptureEnabled: true,

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

    QR_CONTENT_MM: 32,
    QR_SHEET_MM: { x: 38, y: 38 }, // Centro del QR (22mm offset + 16mm radio QR)

    // Umbral de detección: ajustados para robustez de la marca
    BUBBLE_DARK_THRESH: 185,
    BUBBLE_MIN_CONTRAST: 0.12,

    // Cache de posiciones medidas desde el DOM (Opción C)
    _measuredPositions: null,
    _measuredForNumQ: 0,

    // Estado de detección y estabilidad
    qrLocation: null,
    anchorLocations: { tl: null, tr: null, bl: null, br: null },
    lastStableQRLocation: null,
    lastStableAnchors: { tl: null, tr: null, bl: null, br: null },

    // Calibración Avanzada (ajuste fino sobre posiciones medidas)
    GRID_DY_ADJUST: 0,
    GRID_DX_ADJUST: 0,
    GRID_SCALE_X: 1.0,

    /* ═══════════════════════════════════════════════════════════
     * INICIALIZACIÓN
     * ═══════════════════════════════════════════════════════════ */

    init() {
        this.populateExamSelect();
        document.getElementById('scan-exam-select')
            ?.addEventListener('change', () => this.updateExamInfo());

        // Inicializar sliders de calibración
        this.initSlider('calibrate-dy', 'zc_dy_adjust', 'GRID_DY_ADJUST', 0, v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' mm');
        this.initSlider('calibrate-dx', 'zc_dx_adjust', 'GRID_DX_ADJUST', 0, v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' mm');
        this.initSlider('calibrate-sx', 'zc_sx_adjust', 'GRID_SCALE_X', 1.0, v => v.toFixed(2) + 'x');
    },

    initSlider(id, storageKey, prop, defaultVal, formatFn) {
        const slider = document.getElementById(id);
        if (!slider) return;
        const saved = parseFloat(localStorage.getItem(storageKey));
        const val = isNaN(saved) ? defaultVal : saved;
        
        slider.value = val;
        this[prop] = val;
        
        const label = document.getElementById(id + '-label');
        if (label) label.textContent = formatFn(val);

        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            this[prop] = v;
            localStorage.setItem(storageKey, v);
            if (label) label.textContent = formatFn(v);
        });
    },

    resetCalibration() {
        localStorage.removeItem('zc_dy_adjust');
        localStorage.removeItem('zc_dx_adjust');
        localStorage.removeItem('zc_sx_adjust');
        this.GRID_DY_ADJUST = 0;
        this.GRID_DX_ADJUST = 0;
        this.GRID_SCALE_X = 1.0;
        this.initSlider('calibrate-dy', 'zc_dy_adjust', 'GRID_DY_ADJUST', 0, v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' mm');
        this.initSlider('calibrate-dx', 'zc_dx_adjust', 'GRID_DX_ADJUST', 0, v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' mm');
        this.initSlider('calibrate-sx', 'zc_sx_adjust', 'GRID_SCALE_X', 1.0, v => v.toFixed(2) + 'x');
    },

    populateExamSelect() {
        const sel = document.getElementById('scan-exam-select');
        if (!sel) return;
        const cur = sel.value;
        const list = (typeof exams !== 'undefined' && exams.list) ? exams.list : [];
        
        if (list.length === 0) {
            sel.innerHTML = '<option value="">⚠️ No hay exámenes. Créalos en "Exámenes"</option>';
            sel.disabled = true;
        } else {
            sel.innerHTML = '<option value="">(Auto-detect por QR) Selecciona...</option>' +
                list.map(e =>
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
        this.consecutiveStableFrames = 0;
        this.lastStableQRLocation = null;
        this.lastCorners = null;
        this.cornerFrames = 0;
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
     * LOOP DE FRAMES — Auto-Captura Inteligente
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

                // ── Auto-Captura Inteligente ──
                if (this.autoCaptureEnabled &&
                    this.currentStudent && this.currentExam &&
                    this.consecutiveStableFrames >= this.STABLE_FRAMES_REQUIRED) {

                    this.cooldown = true;
                    this.consecutiveStableFrames = 0;

                    // Flash blanco de confirmación
                    this.ctx.fillStyle = 'rgba(255,255,255,0.6)';
                    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

                    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);

                    // Beep agudo de captura
                    try {
                        const actx = new (window.AudioContext || window.webkitAudioContext)();
                        const osc = actx.createOscillator();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(1200, actx.currentTime);
                        osc.connect(actx.destination);
                        osc.start();
                        osc.stop(actx.currentTime + 0.1);
                    } catch (_) {}

                    this.setStatus(`📸 ¡Capturado! Calificando a ${this.currentStudent.name}…`, '#22c55e');
                    setTimeout(() => this.gradeSheet(), 200);
                }
            } else {
                // Sigue dibujando el overlay sin intentar auto-calificar
                this.drawOverlay();
            }
        }
        requestAnimationFrame(() => this.loop());
    },

    /** Evalúa si el QR y los anclajes están estables. */
    evaluateStability(newQRLoc, newAnchors) {
        if (newQRLoc && this.lastStableQRLocation) {
            const qrDist = this._qrCornerDistance(this.lastStableQRLocation, newQRLoc);
            
            // Contar cuántos anclajes nuevos coinciden con los anteriores
            let anchorDistSum = 0;
            let anchorsCount = 0;
            ['tl','tr','bl','br'].forEach(k => {
                if (newAnchors[k] && this.lastStableAnchors[k]) {
                    anchorDistSum += Math.hypot(this.lastStableAnchors[k].x - newAnchors[k].x, this.lastStableAnchors[k].y - newAnchors[k].y);
                    anchorsCount++;
                }
            });

            const avgAnchorDist = anchorsCount > 0 ? anchorDistSum / anchorsCount : 999;

            // Umbral estricto (requiere mínimo 2 anclajes confirmados)
            if (qrDist < this.STABLE_THRESHOLD_PX && anchorsCount >= 2 && avgAnchorDist < this.STABLE_THRESHOLD_PX) {
                this.consecutiveStableFrames++;
            } else {
                this.consecutiveStableFrames = 0;
            }
        } else {
            this.consecutiveStableFrames = 0;
        }

        // Guardar posiciones actuales
        if (newQRLoc) {
            this.lastStableQRLocation = {
                topLeftCorner:     { ...newQRLoc.topLeftCorner },
                topRightCorner:    { ...newQRLoc.topRightCorner },
                bottomLeftCorner:  { ...newQRLoc.bottomLeftCorner },
                bottomRightCorner: { ...newQRLoc.bottomRightCorner }
            };
        }
        this.lastStableAnchors = { ...newAnchors };
    },

    /** Distancia Euclidiana promedio entre las 4 esquinas del QR de dos frames. */
    _qrCornerDistance(a, b) {
        const d = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
        return (
            d(a.topLeftCorner,     b.topLeftCorner) +
            d(a.topRightCorner,    b.topRightCorner) +
            d(a.bottomLeftCorner,  b.bottomLeftCorner) +
            d(a.bottomRightCorner, b.bottomRightCorner)
        ) / 4;
    },

    detectQR() {
        const now = Date.now();
        // Scans a ~8 veces por segundo
        if (now - this.lastQRCheck < 120) return; 
        this.lastQRCheck = now;

        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const qr = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'attemptBoth'
        });

        if (qr && qr.data && qr.data.startsWith('ZC|')) {
            this.qrLocation = qr.location;
            this.qrVersion  = qr.version || this._guessVersion(qr.data);

            // ── NUEVO: Buscar 4 Anchors usando el QR para predecir su posición ──
            const tl = qr.location.topLeftCorner;
            const br = qr.location.bottomRightCorner;
            const tr = qr.location.topRightCorner;
            const bl = qr.location.bottomLeftCorner;
            
            const qrCX = (tl.x + br.x) / 2;
            const qrCY = (tl.y + br.y) / 2;
            const localPxPerMm = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(bl.x - tl.x, bl.y - tl.y)) / 2 / this.QR_CONTENT_MM;
            const localAngle   = Math.atan2(tr.y - tl.y, tr.x - tl.x);

            const numQ = this.currentExam ? this.currentExam.questions.length : 30;
            const measured = this.getMeasuredPositions(numQ);
            
            this.anchorLocations = { tl: null, tr: null, bl: null, br: null };
            
            if (measured && measured.anchors) {
                ['tl','tr','bl','br'].forEach(key => {
                    const am = measured.anchors[key];
                    const dxMM = am.x - this.QR_SHEET_MM.x;
                    const dyMM = am.y - this.QR_SHEET_MM.y;
                    const pred = this.mmToPixel(dxMM, dyMM, qrCX, qrCY, localAngle, localPxPerMm);
                    // Búsqueda local de los cuadros negros (radio generoso para compensar distorsión)
                    this.anchorLocations[key] = this.findDarkCentroid(this.ctx, pred.x, pred.y, 22 * localPxPerMm, this.canvas.width, this.canvas.height);
                });
            }

            // Evaluar estabilidad
            this.evaluateStability(qr.location, this.anchorLocations);

            if (qr.data !== this.lastQR) {
                this.lastQR = qr.data;
                this.qrData = qr.data;
                this.onQRDetected(qr.data);
            }
        } else {
            // QR perdido — resetear estabilidad
            this.qrLocation = null;
            this.anchorLocations = { tl: null, tr: null, bl: null, br: null };
            this.consecutiveStableFrames = 0;
            this.lastStableQRLocation = null;
            this.lastStableAnchors = { tl: null, tr: null, bl: null, br: null };
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
     * GEOMETRÍA — Posiciones medidas desde el DOM (Opción C)
     *
     * En lugar de calcular posiciones con aritmética manual,
     * renderizamos una hoja virtual con los mismos estilos CSS
     * y medimos dónde el navegador colocó cada burbuja.
     * ═══════════════════════════════════════════════════════════ */

    /** Obtiene posiciones medidas, con cache por numQ. */
    getMeasuredPositions(numQ) {
        if (!this._measuredPositions || this._measuredForNumQ !== numQ) {
            this._measuredPositions = printer.measureBubblePositions(numQ);
            this._measuredForNumQ = numQ;
            console.log('[Scanner] Posiciones DOM cacheadas para', numQ, 'preguntas');
        }
        return this._measuredPositions;
    },

    /** Layout mínimo: solo lo necesario para radio de burbuja y overlay. */
    getLayout(numQ) {
        const PX_TO_MM = 0.2646;
        const perCol = Math.ceil(numQ / 3);
        const availableMM = 173;
        const rowMM = Math.min(10.5, Math.max(5.5, availableMM / perCol));
        const bubblePx = Math.round(Math.min(22, Math.max(15, rowMM * 2.2)));
        const bubbleDiamMM = bubblePx * PX_TO_MM;

        return {
            numQ,
            cols: 3,
            rowsPerCol: perCol,
            rowMM,
            bubbleRadius: bubbleDiamMM / 2,
        };
    },

    /** Posición absoluta en hoja (mm desde TL) usando posiciones DOM medidas. */
    bubbleSheetMM(q, opt, L) {
        const measured = this.getMeasuredPositions(L.numQ);
        const pos = measured.positions[q]?.[opt];
        if (!pos) return { x: 0, y: 0 };
        return {
            x: pos.x + this.GRID_DX_ADJUST,
            y: pos.y + this.GRID_DY_ADJUST
        };
    },

    /** Posición relativa al centro del QR (fallback sin homografía). */
    bubbleMM(q, opt, L) {
        const s  = this.bubbleSheetMM(q, opt, L);
        return {
            x: s.x - this.QR_SHEET_MM.x,
            y: s.y - this.QR_SHEET_MM.y
        };
    },

    /** Transforma offset mm (desde centro del QR) a píxeles en canvas. */
    mmToPixel(dx, dy, cx, cy, angle, pxPerMm) {
        return {
            x: cx + (dx * Math.cos(angle) - dy * Math.sin(angle)) * pxPerMm,
            y: cy + (dx * Math.sin(angle) + dy * Math.cos(angle)) * pxPerMm
        };
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
                if (br < 70) { 
                    sumX += x0 + px; 
                    sumY += y0 + py; 
                    count++; 
                }
            }
        }
        if (count < 40) return null; // cuadro oscuro no detectado
        return { x: sumX/count, y: sumY/count };
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
            inversionAttempts: 'attemptBoth'
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
        const br = qrLoc.bottomRightCorner;
        const tr = qrLoc.topRightCorner;
        const bl = qrLoc.bottomLeftCorner;

        const qrCX    = (tl.x + br.x) / 2;
        const qrCY    = (tl.y + br.y) / 2;
        const topEdge = Math.hypot(tr.x - tl.x, tr.y - tl.y);
        const lefEdge = Math.hypot(bl.x - tl.x, bl.y - tl.y);
        const localQrSizePx = (topEdge + lefEdge) / 2;
        const localAngle   = Math.atan2(tr.y - tl.y, tr.x - tl.x);
        const localPxPerMm = localQrSizePx / this.QR_CONTENT_MM;

        const numQ  = exam.questions.length;
        const L     = this.getLayout(numQ);
        const OPTS  = ['A','B','C','D','E'];

        const measured = this.getMeasuredPositions(numQ);
        const mAnchors = measured.anchors || {};

        // ── DETECCIÓN DE ANCLAJES ──
        const foundAnchors = [];
        const srcPoints = [];
        const dstPoints = [];

        ['tl','tr','bl','br'].forEach(key => {
            const am = mAnchors[key];
            if (!am) return;
            const dxMM = am.x - this.QR_SHEET_MM.x;
            const dyMM = am.y - this.QR_SHEET_MM.y;
            const pred = this.mmToPixel(dxMM, dyMM, qrCX, qrCY, localAngle, localPxPerMm);
            const real = this.findDarkCentroid(ctx, pred.x, pred.y, 22 * localPxPerMm, canvas.width, canvas.height);
            
            if (real) {
                foundAnchors.push(key);
                srcPoints.push({ x: am.x, y: am.y });
                dstPoints.push({ x: real.x, y: real.y });
            }
        });

        let bubblePosFn;
        let globalPxPerMm = localPxPerMm;

        if (foundAnchors.length === 4) {
            // OPCIÓN A: Perspectiva completa (Homografía)
            const h = this.getHomography(srcPoints, dstPoints);
            bubblePosFn = (q, o, L_) => {
                const mm = this.bubbleSheetMM(q, o, L_);
                return this.applyHomography(h, mm.x, mm.y);
            };
            this._lastMethod = 'Perspectiva (4 esquinas) 🚀';
        } else if (foundAnchors.length >= 2) {
            // OPCIÓN B: Afín (basada en los 2 puntos más lejanos encontrados)
            let p1Idx = 0, p2Idx = 1, maxDist = 0;
            for (let i = 0; i < srcPoints.length; i++) {
                for (let j = i + 1; j < srcPoints.length; j++) {
                    const d = Math.hypot(srcPoints[i].x - srcPoints[j].x, srcPoints[i].y - srcPoints[j].y);
                    if (d > maxDist) { maxDist = d; p1Idx = i; p2Idx = j; }
                }
            }
            const s1 = srcPoints[p1Idx], s2 = srcPoints[p2Idx];
            const d1 = dstPoints[p1Idx], d2 = dstPoints[p2Idx];

            const distMM = Math.hypot(s2.x - s1.x, s2.y - s1.y);
            const distPX = Math.hypot(d2.x - d1.x, d2.y - d1.y);
            globalPxPerMm = distPX / distMM;

            const angleMM = Math.atan2(s2.y - s1.y, s2.x - s1.x);
            const anglePX = Math.atan2(d2.y - d1.y, d2.x - d1.x);
            const gAngle = anglePX - angleMM;

            bubblePosFn = (q, o, L_) => {
                const mm = this.bubbleSheetMM(q, o, L_);
                const dx = mm.x - s1.x;
                const dy = mm.y - s1.y;
                return {
                    x: d1.x + (dx * Math.cos(gAngle) - dy * Math.sin(gAngle)) * globalPxPerMm,
                    y: d1.y + (dx * Math.sin(gAngle) + dy * Math.cos(gAngle)) * globalPxPerMm
                };
            };
            this._lastMethod = `Afín (${foundAnchors.length} puntos) ⚖️`;
        } else {
            // FALLBACK: Solo QR
            bubblePosFn = (q, o, L_) => {
                const mm = this.bubbleMM(q, o, L_);
                return this.mmToPixel(mm.x, mm.y, qrCX, qrCY, localAngle, localPxPerMm);
            };
            this._lastMethod = 'Solo QR (Fallback) ⚠️';
            app.toast('⚠️ No se detectaron suficientes marcas; precisión reducida.', true);
        }

        console.log('[Scanner] Método calibración:', this._lastMethod);

        // Radio de muestreo
        const sampleR = L.bubbleRadius * 0.55 * globalPxPerMm;
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

            // ── Progreso de estabilidad (0.0 a 1.0) ──
            const progress = Math.min(1, this.consecutiveStableFrames / this.STABLE_FRAMES_REQUIRED);
            const isStable = progress >= 0.5;

            // Color del recuadro QR: amarillo → verde según estabilidad
            const qrR = Math.round(250 - progress * 216);  // 250→34
            const qrG = Math.round(204 + progress * (197 - 204)); // 204→197 (approx verde)
            const qrB = Math.round(21 + progress * (94 - 21));  // 21→94
            const qrColor = `rgb(${qrR},${qrG},${qrB})`;

            // ── Resaltar QR con color dinámico ──
            ctx.beginPath();
            ctx.moveTo(loc.topLeftCorner.x,     loc.topLeftCorner.y);
            ctx.lineTo(loc.topRightCorner.x,    loc.topRightCorner.y);
            ctx.lineTo(loc.bottomRightCorner.x, loc.bottomRightCorner.y);
            ctx.lineTo(loc.bottomLeftCorner.x,  loc.bottomLeftCorner.y);
            ctx.closePath();
            ctx.strokeStyle = qrColor;
            ctx.lineWidth   = 4;
            ctx.stroke();
            ctx.fillStyle = `rgba(${qrR},${qrG},${qrB},0.15)`;
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
            const localPxPerMm = ((topEdge + lefEdge) / 2) / this.QR_CONTENT_MM;
            const localAngle   = Math.atan2(tr.y - tl.y, tr.x - tl.x);

            const numQ = this.currentExam.questions.length;
            const L    = this.getLayout(numQ);
            
            const measured = this.getMeasuredPositions(numQ);
            const mAnchors = measured.anchors || {};

            // Detección de anclajes para el overlay
            const srcPoints = [];
            const dstPoints = [];
            const foundKeys = [];

            ['tl','tr','bl','br'].forEach(key => {
                const am = mAnchors[key];
                if (!am) return;
                const dxMM = am.x - this.QR_SHEET_MM.x;
                const dyMM = am.y - this.QR_SHEET_MM.y;
                const pred = this.mmToPixel(dxMM, dyMM, qrCX, qrCY, localAngle, localPxPerMm);
                const real = this.findDarkCentroid(ctx, pred.x, pred.y, 22 * localPxPerMm, W, H);
                
                if (real) {
                    foundKeys.push(key);
                    srcPoints.push({ x: am.x, y: am.y });
                    dstPoints.push({ x: real.x, y: real.y });

                    // Dibujar marca donde detectó cada anchor
                    ctx.beginPath();
                    ctx.arc(real.x, real.y, 6, 0, Math.PI * 2);
                    ctx.strokeStyle = '#f59e0b'; // ambar
                    ctx.lineWidth = 2.5;
                    ctx.stroke();
                }
            });

            let overlayPosFn;
            let currentGlobalPxPerMm = localPxPerMm;

            if (foundKeys.length === 4) {
                const h = this.getHomography(srcPoints, dstPoints);
                overlayPosFn = (q, o, L_) => {
                    const mm = this.bubbleSheetMM(q, o, L_);
                    return this.applyHomography(h, mm.x, mm.y);
                };
            } else if (foundKeys.length >= 2) {
                let p1Idx = 0, p2Idx = 1, maxDist = 0;
                for (let i = 0; i < srcPoints.length; i++) {
                    for (let j = i + 1; j < srcPoints.length; j++) {
                        const d = Math.hypot(srcPoints[i].x - srcPoints[j].x, srcPoints[i].y - srcPoints[j].y);
                        if (d > maxDist) { maxDist = d; p1Idx = i; p2Idx = j; }
                    }
                }
                const s1 = srcPoints[p1Idx], s2 = srcPoints[p2Idx];
                const d1 = dstPoints[p1Idx], d2 = dstPoints[p2Idx];
                const distMM = Math.hypot(s2.x - s1.x, s2.y - s1.y);
                const distPX = Math.hypot(d2.x - d1.x, d2.y - d1.y);
                currentGlobalPxPerMm = distPX / distMM;
                const angleMM = Math.atan2(s2.y - s1.y, s2.x - s1.x);
                const anglePX = Math.atan2(d2.y - d1.y, d2.x - d1.x);
                const gAngle = anglePX - angleMM;

                overlayPosFn = (q, o, L_) => {
                    const mm = this.bubbleSheetMM(q, o, L_);
                    const dx = mm.x - s1.x;
                    const dy = mm.y - s1.y;
                    return {
                        x: d1.x + (dx * Math.cos(gAngle) - dy * Math.sin(gAngle)) * currentGlobalPxPerMm,
                        y: d1.y + (dx * Math.sin(gAngle) + dy * Math.cos(gAngle)) * currentGlobalPxPerMm
                    };
                };
            } else {
                overlayPosFn = (q, o, L_) => {
                    const mm = this.bubbleMM(q, o, L_);
                    return this.mmToPixel(mm.x, mm.y, qrCX, qrCY, localAngle, localPxPerMm);
                };
            }

            const r = Math.max(3, L.bubbleRadius * currentGlobalPxPerMm * 0.7);

            // Color de burbujas: transición suave con estabilidad
            const bubbleAlpha = 0.5 + progress * 0.4;
            const bubbleColor = isStable
                ? `rgba(34,197,94,${bubbleAlpha})`    // verde
                : `rgba(99,230,255,${bubbleAlpha})`;  // cyan

            for (let q = 0; q < numQ; q++) {
                for (let o = 0; o < 5; o++) {
                    const px = overlayPosFn(q, o, L);
                    ctx.beginPath();
                    ctx.arc(px.x, px.y, r, 0, Math.PI * 2);
                    ctx.strokeStyle = bubbleColor;
                    ctx.lineWidth   = isStable ? 2 : 1.5;
                    ctx.stroke();
                }
            }

            // ── Barra de progreso de estabilidad (superior) ──
            if (this.autoCaptureEnabled && progress > 0) {
                const barH = 6;
                // Fondo
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.fillRect(0, 0, W, barH);
                // Progreso
                const barColor = isStable ? '#22c55e' : '#facc15';
                ctx.fillStyle = barColor;
                ctx.fillRect(0, 0, W * progress, barH);
            }

            // ── Banner inferior: nombre + estado ──
            const bannerH = Math.round(H * 0.10);
            ctx.fillStyle = 'rgba(0,0,0,0.72)';
            ctx.fillRect(0, H - bannerH, W, bannerH);

            ctx.fillStyle    = isStable ? '#22c55e' : '#facc15';
            ctx.font         = `bold ${Math.round(bannerH * 0.38)}px sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`✅ ${this.currentStudent.name}`, W / 2, H - bannerH * 0.68);

            // Mensaje de estado según progreso
            let statusMsg;
            if (progress < 0.3) {
                statusMsg = '🟡 Mantén quieto para auto-captura…';
            } else if (progress < 0.7) {
                statusMsg = '🟠 Enfocando… no muevas';
            } else if (progress < 1) {
                statusMsg = '🟢 ¡Casi listo! Mantén…';
            } else {
                statusMsg = '📸 ¡CAPTURANDO!';
            }
            
            const hasCorners = (foundKeys.length === 4) ? ' (4 esquinas ✅)' : ` (${foundKeys.length} marcas)`;

            ctx.fillStyle = isStable ? '#99ffcc' : '#fde68a';
            ctx.font      = `${Math.round(bannerH * 0.26)}px sans-serif`;
            ctx.fillText(statusMsg + hasCorners, W / 2, H - bannerH * 0.28);

        } else {
            // ── Guía de encuadre: busca el QR ──
            const size = Math.min(W, H) * 0.5;
            const x = (W - size) / 2;
            const y = (H - size) / 2;

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
    },

    /* ═══════════════════════════════════════════════════════════
     * MATEMÁTICAS — Homografía / Perspectiva
     * ═══════════════════════════════════════════════════════════ */

    /**
     * Calcula la matriz de homografía 3x3 para mapear 4 puntos de origen a 4 de destino.
     * Basado en la implementación estándar de perspectiva.
     */
    getHomography(src, dst) {
        const matrix = Array(8).fill(0).map(() => Array(9).fill(0));
        for (let i = 0; i < 4; i++) {
            const { x, y } = src[i];
            const { x: u, y: v } = dst[i];
            matrix[2 * i]     = [x, y, 1, 0, 0, 0, -u * x, -u * y, u];
            matrix[2 * i + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y, v];
        }

        // Resolución por eliminación Gaussiana
        for (let i = 0; i < 8; i++) {
            let pivot = i;
            for (let j = i + 1; j < 8; j++) {
                if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
            }
            [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
            
            const div = matrix[i][i];
            if (Math.abs(div) < 1e-10) continue;
            for (let j = i; j < 9; j++) matrix[i][j] /= div;

            for (let j = 0; j < 8; j++) {
                if (j !== i) {
                    const mult = matrix[j][i];
                    for (let k = i; k < 9; k++) matrix[j][k] -= mult * matrix[i][k];
                }
            }
        }
        const h = matrix.map(row => row[8]);
        return [...h, 1]; // Añadimos h22 = 1
    },

    applyHomography(h, x, y) {
        const w = h[6] * x + h[7] * y + h[8];
        return {
            x: (h[0] * x + h[1] * y + h[2]) / w,
            y: (h[3] * x + h[4] * y + h[5]) / w
        };
    }
};
