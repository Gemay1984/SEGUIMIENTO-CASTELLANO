// Main Application Logic
const app = {
    currentView: 'dashboard',
    
    init() {
        console.log("ZipCastellano Initialized");
        this.navigate(this.currentView);
        students.load();
        exams.load();
        settings.load();
        this.updateDashboard();
    },

    navigate(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const target = document.getElementById(`view-${viewId}`);
        if (target) {
            target.classList.add('active');
            this.currentView = viewId;
            
            // View specific init
            if (viewId === 'exam-editor') exams.renderEditor();
            if (viewId === 'scanner') scanner.populateExamSelect();
        }
    },

    async importFromSheet() {
        if (!settings.apiUrl) return alert("Configura la URL de API primero en ⚙️");
        try {
            app.toast('⏳ Sincronizando datos...');
            const data = await this.gasRequest();
            if (!data) return;
            
            if (data.students && data.students.length > 0) {
                students.list = data.students;
                students.save();
                students.render();
            }
            if (data.exams && data.exams.length > 0) {
                exams.list = data.exams;
                localStorage.setItem('zc_exams', JSON.stringify(data.exams));
                exams.renderList();
            }
            if (data.results && data.results.length > 0) {
                localStorage.setItem('zc_results', JSON.stringify(data.results));
            }
            
            app.updateDashboard();
            app.toast(`✅ Sincronización Exitosa`);
        } catch (err) {
            console.error(err);
            alert("Error al importar: Revisa la consola y asegúrate de que el script esté publicado correctamente.");
        }
    },

    // ─── Nueva Comunicación Robusta (GET/POST) ────────────────────────
    async gasRequest(payload = null) {
        if (!settings.apiUrl) {
            alert("No hay URL configurada. Ve a Configuración.");
            return null;
        }
        
        try {
            console.log("Enviando petición a GAS...", payload ? "POST" : "GET");
            const options = {
                method: payload ? 'POST' : 'GET',
                // Forzamos text/plain para evadir el preflight OPTIONS y usamos CORS normal
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }
            };
            
            if (payload) {
                options.body = JSON.stringify(payload);
            }

            const res = await fetch(settings.apiUrl, options);
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            
            // Si GAS captura su propio error y devuelve {success:false, error: ...}
            if (data && data.success === false && data.error) {
                throw new Error("Error interno del Script: " + data.error);
            }
            
            return data;
        } catch (err) {
            console.error('GAS Error de conexión o permisos:', err);
            throw new Error("CORS/Fetch error: Posiblemente el script no está implementado para 'Cualquiera' o la URL es incorrecta. " + err.message);
        }
    },

    async pushResultToSheet(result) {
        try {
            await this.gasRequest({ action: 'saveResult', ...result });
        } catch (err) {
            console.error('pushResult failed', err);
        }
    },

    async pushExamsToSheet() {
        app.toast('⏳ Sincronizando exámenes...');
        try {
            await this.gasRequest({ action: 'saveExams', exams: exams.list });
            app.toast('✅ Exámenes sincronizados con la nube');
        } catch (err) {
            alert('⚠️ Error crítico al sincronizar exámenes: ' + err.message + '\n\nRevisa los permisos del script web ("Cualquiera").');
            app.toast('⚠️ Error de conexión', true);
        }
    },

    async pushStudentsToSheet(studentsList) {
        app.toast('⏳ Sincronizando estudiantes...');
        try {
            await this.gasRequest({ action: 'saveStudents', students: studentsList });
            app.toast('✅ Estudiantes sincronizados con la nube');
        } catch (err) {
            alert('⚠️ Error crítico al sincronizar estudiantes: ' + err.message + '\n\nRevisa si tu script web de Google tiene acceso en "Cualquiera" y si la URL está bien.');
            app.toast('⚠️ Error de conexión', true);
        }
    },

    toast(msg, isError = false) {
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${isError ? '#ef4444' : '#10b981'};color:white;padding:12px 20px;border-radius:10px;font-size:0.9rem;font-family:Outfit,sans-serif;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.3);animation:fadeIn .3s ease;`;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3500);
    },

    updateDashboard() {
        const studentCount = document.getElementById('student-count');
        if (studentCount) studentCount.innerText = `${students.list.length} registrados`;
        
        const lastExam = document.getElementById('last-exam-name');
        if (lastExam && exams.list.length > 0) {
            const latest = exams.list[exams.list.length - 1];
            lastExam.innerText = latest.name;
        }

        const results = JSON.parse(localStorage.getItem('zc_results') || '[]');
        if (results.length > 0) {
            const avg = Math.round(results.reduce((acc, r) => acc + r.pct, 0) / results.length);
            const dashboardH1 = document.querySelector('#view-dashboard h1');
            if (dashboardH1) dashboardH1.innerHTML = `Panel de Control <span style="font-size:0.9rem; font-weight:400; background:var(--accent); padding:4px 10px; border-radius:12px; margin-left:10px;">Promedio: ${avg}%</span>`;
        }
    }
};

const students = {
    list: [],
    load() {
        const data = localStorage.getItem('zc_students');
        this.list = data ? JSON.parse(data) : [];
        this.updateFilterUI();
        this.render();
    },
    save() {
        localStorage.setItem('zc_students', JSON.stringify(this.list));
        this.updateFilterUI();
        app.updateDashboard();
    },
    updateFilterUI() {
        const filter = document.getElementById('filter-grade');
        if (!filter) return;
        
        const currentVal = filter.value;
        const grades = [...new Set(this.list.map(s => s.grade))].sort();
        
        filter.innerHTML = '<option value="">Todos los Grados</option>' + 
            grades.map(g => `<option value="${g}" ${g === currentVal ? 'selected' : ''}>${g}</option>`).join('');
    },
    add() {
        const name = document.getElementById('new-std-name').value;
        const grade = document.getElementById('new-std-grade').value;
        const id = document.getElementById('new-std-id').value;
        
        if (!name || !id) return alert("Nombre e ID son obligatorios");
        
        this.list.push({ name, grade, id });
        this.save();
        this.render();
        ui.hideModal('student-modal');
        
        // Clear inputs
        document.getElementById('new-std-name').value = '';
        document.getElementById('new-std-id').value = '';
    },
    importExcel(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            // SMART MAPPER: Buscar dinámicamente las columnas
            let map = { name: -1, grade: -1, id: -1, lastName: -1 };
            let startRow = 0;

            for (let i = 0; i < Math.min(json.length, 20); i++) {
                const row = json[i].map(c => String(c || "").toLowerCase().trim());
                
                // Buscar encabezados comunes con más variaciones
                if (map.name === -1) map.name = row.findIndex(c => c.includes("nomb") || c.includes("estudiante") || c.includes("alumno"));
                if (map.grade === -1) map.grade = row.findIndex(c => c.includes("grad") || c.includes("grup") || c.includes("curs") || c.includes("secc"));
                if (map.id === -1) map.id = row.findIndex(c => c.includes("id") || c.includes("codi") || c.includes("docu") || c.includes("nro") || c.includes("nu"));
                if (map.lastName === -1) map.lastName = row.findIndex(c => c.includes("apel"));

                // Si encontramos al menos 2 columnas, asumimos que los datos empiezan después
                if (map.name !== -1 || map.id !== -1) {
                    startRow = i + 1;
                    // Si el nombre y apellido están en la misma columna, lastName se queda en -1
                    break;
                }
            }

            // Fallback si no hay encabezados: Intentar mapeo clásico (C, D, E, I)
            if (map.name === -1) {
                map = { grade: 2, name: 3, lastName: 4, id: 8 };
                startRow = 1;
            }

            const imported = json.slice(startRow)
                .filter(row => row[map.name] || row[map.id]) // Validación mínima
                .map(row => ({
                    grade: row[map.grade] ? String(row[map.grade]) : 'S/G',
                    name: `${row[map.name] || ''} ${map.lastName !== -1 ? (row[map.lastName] || '') : ''}`.trim(),
                    id: row[map.id] ? String(row[map.id]) : 'S-' + Math.random().toString(36).substr(2, 5)
                }));

            if (imported.length > 0) {
                this.list = imported;
                this.save();
                this.render();
                alert(`¡Éxito! Se detectaron y cargaron ${imported.length} estudiantes.`);
                
                // PUSH TO CLOUD IMMEDIATELY
                app.pushStudentsToSheet(imported);
            } else {
                console.log("Debug Row Map:", map);
                alert("Error: No se pudo leer el archivo. Asegúrate de copiar tus datos en la plantilla 'listado_maestro.csv' que acabo de crear para ti.");
            }
        };
        reader.readAsArrayBuffer(file);
    },
    render() {
        const container = document.getElementById('student-list');
        const filter = document.getElementById('filter-grade');
        if (!container) return;
        
        const gradeFilter = filter ? filter.value : "";
        const filtered = gradeFilter ? this.list.filter(s => s.grade === gradeFilter) : this.list;
        
        container.innerHTML = filtered.map((s, idx) => `
            <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 12px;">${s.name}</td>
                <td style="padding: 12px;">${s.grade}</td>
                <td style="padding: 12px;">${s.id}</td>
                <td style="padding: 12px;">
                    <button class="btn" style="padding: 4px 8px;" onclick="students.remove(${this.list.indexOf(s)})">Eliminar</button>
                </td>
            </tr>
        `).join('');
    },
    remove(idx) {
        if (confirm("¿Eliminar estudiante?")) {
            this.list.splice(idx, 1);
            this.save();
            this.render();
        }
    }
};

const ui = {
    showModal(id) {
        document.getElementById(id).style.display = 'block';
    },
    hideModal(id) {
        document.getElementById(id).style.display = 'none';
    }
};

const exams = {
    list: [],
    categories: [
        { id: 'c1', name: 'Semántica (Local)', class: 'c1' },
        { id: 'c2', name: 'Sintáctica (Global)', class: 'c2' },
        { id: 'c3', name: 'Pragmática (Crítica)', class: 'c3' },
        { id: 'c4', name: 'Enciclopédica (Contexto)', class: 'c4' }
    ],

    load() {
        const data = localStorage.getItem('zc_exams');
        this.list = data ? JSON.parse(data) : [];
        this.renderList();
    },

    renderList() {
        const container = document.getElementById('exam-list');
        if (!container) return;
        if (this.list.length === 0) {
            container.innerHTML = `<div class="glass-card" style="padding:30px;text-align:center;color:var(--text-muted);grid-column:1/-1;">
                <p style="font-size:2rem;">📝</p>
                <p style="margin-top:8px;">No hay exámenes aún.</p>
                <button class="btn btn-primary" style="margin-top:16px;" onclick="app.navigate('exam-editor')">Crear primer examen</button>
            </div>`;
            return;
        }
        container.innerHTML = this.list.map(e => `
            <div class="glass-card" style="padding:20px; display:flex; flex-direction:column; gap:12px;">
                <div>
                    <h4 style="font-size:1.05rem;">${e.name}</h4>
                    <p style="color:var(--text-muted); font-size:0.85rem; margin-top:4px;">
                        📚 ${e.grade} &nbsp;·&nbsp; ❓ ${(e.questions || []).length} preguntas
                        &nbsp;·&nbsp; 📅 ${e.date ? new Date(e.date).toLocaleDateString() : 'S/F'}
                    </p>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn" style="padding:8px 12px; font-size:0.82rem; flex:1; min-width:100px;" 
                        onclick="exams.showPrintDialog('${e.id}')">🖨️ Imprimir</button>
                    <button class="btn btn-primary" style="padding:8px 12px; font-size:0.82rem; flex:1; min-width:100px;" 
                        onclick="app.navigate('scanner')">📷 Calificar</button>
                    <button class="btn" style="padding:8px 12px; font-size:0.82rem; flex:1; min-width:100px; background:#10b981; color:white;" 
                        onclick="exams.syncOne('${e.id}')">☁️ Guardar en Sheets</button>
                    <button class="btn" style="padding:8px 12px; font-size:0.82rem; background:#ef444422; color:#f87171; border:1px solid #ef4444;" 
                        onclick="exams.delete('${e.id}')">🗑️</button>
                </div>
            </div>
        `).join('');
    },

    async syncOne(examId) {
        const exam = this.list.find(e => e.id === examId);
        if (!exam) return;
        app.toast('⏳ Enviando a Nube...');
        try {
            await app.gasRequest({ action: 'saveExams', exams: this.list });
            app.toast(`✅ "${exam.name}" guardado`);
        } catch (err) {
            app.toast('⚠️ Error de sincronización', true);
            console.error('syncOne error:', err);
        }
    },

    delete(examId) {
        const exam = this.list.find(e => e.id === examId);
        if (!exam) return;
        if (!confirm(`¿Eliminar el examen "${exam.name}"?`)) return;
        this.list = this.list.filter(e => e.id !== examId);
        localStorage.setItem('zc_exams', JSON.stringify(this.list));
        this.renderList();
        app.toast('🗑️ Examen eliminado');
    },

    showPrintDialog(examId) {
        const exam = this.list.find(e => e.id === examId);
        if (!exam) return;
        
        const mode = prompt("Escribe 'TODO' para imprimir hojas para todos los estudiantes o 'ID' para un estudiante específico:");
        
        if (mode?.toUpperCase() === 'TODO') {
            const filtered = students.list.filter(s => s.grade === exam.grade);
            if (filtered.length === 0) return alert("No hay estudiantes registrados en el grado " + exam.grade);
            
            if (confirm(`Se generará un PDF con ${filtered.length} hojas para el grado ${exam.grade}. ¿Continuar?`)) {
                printer.printBatch(exam, filtered);
            }
        } else if (mode?.toUpperCase() === 'ID') {
            const sid = prompt("Ingresa el ID del estudiante:");
            const s = students.list.find(std => std.id === sid);
            if (s) printer.printBatch(exam, [s]);
            else alert("Estudiante no encontrado");
        }
    },

    renderEditor() {
        const container = document.getElementById('question-keys');
        const gradeSelect = document.getElementById('exam-grade');
        const qCountInput = document.getElementById('exam-q-count');
        if (!container) return;
        
        // Populate grade dropdown
        const grades = [...new Set(students.list.map(s => s.grade))].sort();
        if (gradeSelect) {
            const currentVal = gradeSelect.value;
            gradeSelect.innerHTML = '<option value="">Seleccionar Grado...</option>' + 
                grades.map(g => `<option value="${g}" ${g === currentVal ? 'selected' : ''}>${g}</option>`).join('');
        }

        const count = qCountInput ? parseInt(qCountInput.value) || 30 : 30;
        let html = '';
        for (let i = 1; i <= count; i++) {
            html += `
                <div style="display: grid; grid-template-columns: 50px 1fr 1fr; gap: 10px; align-items: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
                    <span style="font-weight: bold;">#${i}</span>
                    <select id="q-${i}-ans" class="input-modern" style="padding: 4px;">
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                        <option value="E">E</option>
                    </select>
                    <select id="q-${i}-comp" class="input-modern" style="padding: 4px;">
                        ${this.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                    </select>
                </div>
            `;
        }
        container.innerHTML = html;
    },

    save() {
        const name = document.getElementById('exam-name').value;
        const grade = document.getElementById('exam-grade').value;
        const qCountInput = document.getElementById('exam-q-count');
        const count = qCountInput ? parseInt(qCountInput.value) || 30 : 30;

        if (!name) return alert("El nombre es obligatorio");
        if (!grade) return alert("El grado es obligatorio");
        
        const questions = [];
        for (let i = 1; i <= count; i++) {
            questions.push({
                ans: document.getElementById(`q-${i}-ans`).value,
                comp: document.getElementById(`q-${i}-comp`).value
            });
        }
        
        const newExam = {
            id: Date.now().toString(),
            name,
            grade,
            questions,
            date: new Date().toISOString()
        };
        
        this.list.push(newExam);
        localStorage.setItem('zc_exams', JSON.stringify(this.list));
        this.renderList();
        
        // SYNC TO CLOUD
        app.pushExamsToSheet();
        
        app.navigate('exams');
        app.updateDashboard();
    }
};

const settings = {
    apiUrl: '',
    load() {
        const defaultUrl = 'https://script.google.com/macros/s/AKfycby0if64vpsAWakJMXOViner0A8E0wGucLPWdEyBJwVpFY01Fe3mHWBpNNS7AzIpBQ8Omg/exec';
        this.apiUrl = localStorage.getItem('zc_api_url') || defaultUrl;
        
        const input = document.getElementById('api-url');
        if (input) input.value = this.apiUrl;
        
        // Save default if not set
        if (!localStorage.getItem('zc_api_url')) {
            localStorage.setItem('zc_api_url', defaultUrl);
        }
    },
    save() {
        const val = document.getElementById('api-url').value;
        this.apiUrl = val;
        localStorage.setItem('zc_api_url', val);
        alert("Configuración guardada");
    },
    async testConnection() {
        if (!this.apiUrl) return alert("Ingresa una URL primero");
        const status = document.getElementById('settings-status');
        status.innerText = "⏳ Probando conexión real...";
        status.style.color = "white";
        
        try {
            // Un pre-chequeo forzando cors estricto para ver si Google responde JSON (exitoso) 
            // o HTML (CORS error de login = Permisos incorrectos)
            const res = await fetch(this.apiUrl, { method: 'GET', headers: { 'Content-Type': 'text/plain' } });
            if (!res.ok) throw new Error("HTTP Status " + res.status);
            
            const data = await res.json();
            console.log("Respuesta de Sheet:", data);
            
            if (data && (data.students || data.exams || data.results)) {
                status.innerText = "✅ ¡Conexión establecida perfectamente y datos leídos!";
                status.style.color = "var(--accent)";
                app.toast("Permisos correctos");
            } else {
                status.innerText = "⚠️ Conecta pero algo está raro con la respuesta.";
                status.style.color = "#f59e0b";
            }
        } catch (err) {
            status.innerHTML = "❌ Error detectado. Tu Script está bloqueando la app.<br><br><b>¿Cómo arreglarlo?</b><br>1. Ve a Google Sheets > Apps Script<br>2. Clic Implementar > Gestionar implementaciones, o Nueva implementación.<br>3. <b>Quién tiene acceso: Cualquiera (Everyone)</b> (NO 'Solo mi cuenta').<br>4. Re-copia la nueva URL que te den.";
            status.style.color = "#ef4444";
            console.error("Test connection failed REAL", err);
        }
    }
};

const stats = {
    charts: {},
    update() {
        const results = JSON.parse(localStorage.getItem('zc_results') || '[]');
        if (results.length === 0) {
            console.log("No hay resultados para estadísticas");
            return;
        }
        this.renderCompetencyChart(results);
        this.renderGroupChart(results);
        this.renderHistoryChart(results);
    },
    renderCompetencyChart(results) {
        const ctx = document.getElementById('competency-chart');
        if (!ctx) return;
        
        // Agregar porcentajes por competencias
        const comps = { c1:0, c2:0, c3:0, c4:0, count: { c1:0, c2:0, c3:0, c4:0 } };
        results.forEach(r => {
            if (!r.competencies) return;
            Object.keys(r.competencies).forEach(c => {
                const data = r.competencies[c];
                comps[c] += (data.correct / data.total) * 100;
                comps.count[c]++;
            });
        });

        const labels = ['Semántica', 'Sintáctica', 'Pragmática', 'Enciclopédica'];
        const values = ['c1', 'c2', 'c3', 'c4'].map(c => comps.count[c] > 0 ? Math.round(comps[c]/comps.count[c]) : 0);

        if (this.charts.comp) this.charts.comp.destroy();
        this.charts.comp = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Puntaje (%)',
                    data: values,
                    backgroundColor: 'rgba(99, 102, 241, 0.2)',
                    borderColor: 'var(--primary)',
                    pointBackgroundColor: 'var(--primary)'
                }]
            },
            options: { 
                scales: { r: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.1)' }, angleLines: { color: 'rgba(255,255,255,0.1)' } } },
                plugins: { legend: { display: false } }
            }
        });
    },
    renderGroupChart(results) {
        const ctx = document.getElementById('group-chart');
        if (!ctx) return;

        const groups = {};
        results.forEach(r => {
            // Buscamos el grado del estudiante si no viene en el resultado
            const std = students.list.find(s => s.id === r.studentId);
            const grade = std ? std.grade : (r.grade || 'N/A');
            if (!groups[grade]) groups[grade] = { sum: 0, count: 0 };
            groups[grade].sum += r.pct;
            groups[grade].count++;
        });

        const labels = Object.keys(groups).sort();
        const values = labels.map(l => Math.round(groups[l].sum / groups[l].count));

        if (this.charts.group) this.charts.group.destroy();
        this.charts.group = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Promedio (%)',
                    data: values,
                    backgroundColor: ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6'].slice(0, labels.length)
                }]
            },
            options: { 
                scales: { y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.1)' } } },
                plugins: { legend: { display: false } }
            }
        });
    },
    renderHistoryChart(results) {
        const ctx = document.getElementById('history-chart');
        if (!ctx) return;

        // Agrupar por fecha corto (YYYY-MM-DD)
        const daily = {};
        results.forEach(r => {
            const date = r.date.split('T')[0];
            if (!daily[date]) daily[date] = { sum: 0, count: 0 };
            daily[date].sum += r.pct;
            daily[date].count++;
        });

        const labels = Object.keys(daily).sort();
        const values = labels.map(l => Math.round(daily[l].sum / daily[l].count));

        if (this.charts.history) this.charts.history.destroy();
        this.charts.history = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Evolución',
                    data: values,
                    borderColor: 'var(--accent)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                scales: { y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.1)' } } },
                plugins: { legend: { display: false } }
            }
        });
    }
};

// Update navigation to trigger stats refresh
const originalNavigate = app.navigate.bind(app);
app.navigate = (viewId) => {
    originalNavigate(viewId);
    if (viewId === 'stats') setTimeout(() => stats.update(), 100);
};

// Initialize after DOM
window.addEventListener('DOMContentLoaded', () => app.init());
