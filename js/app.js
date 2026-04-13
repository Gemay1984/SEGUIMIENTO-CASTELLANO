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

    async pushStudentsToSheet(studentsList) {
        if (!settings.apiUrl) return;
        try {
            await fetch(settings.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'saveStudents', students: studentsList })
            });
            app.toast('✅ Estudiantes guardados en Sheets');
        } catch (err) {
            app.toast('⚠️ No se pudo sincronizar estudiantes', true);
            console.error('pushStudents failed', err);
        }
    },

    async importFromSheet() {
        if (!settings.apiUrl) return alert("Configura la URL de API primero en ⚙️");
        try {
            const res = await fetch(settings.apiUrl);
            const data = await res.json();
            
            if (data.students) {
                students.list = data.students;
                students.save();
                students.render();
            }
            if (data.exams) {
                exams.list = data.exams;
                localStorage.setItem('zc_exams', JSON.stringify(data.exams));
                exams.renderList();
            }
            
            alert(`¡Sincronización Total Exitosa!`);
        } catch (err) {
            alert("Error al importar desde Sheets. Revisa la URL.");
        }
    },

    async pushExamsToSheet() {
        if (!settings.apiUrl) return;
        try {
            await fetch(settings.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'saveExams', exams: exams.list })
            });
            app.toast('✅ Examen guardado en Sheets');
        } catch (err) {
            app.toast('⚠️ No se pudo sincronizar el examen', true);
            console.error('pushExams failed', err);
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
            lastExam.innerText = exams.list[exams.list.length - 1].name;
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
        container.innerHTML = this.list.map(e => `
            <div class="glass-card p-4" style="padding: 20px;">
                <h4>${e.name}</h4>
                <p class="text-muted">${e.grade} - ${e.questions.length} preguntas</p>
                <div style="margin-top: 15px; display: flex; gap: 8px;">
                    <button class="btn" style="padding: 6px 12px; font-size: 0.8rem;" onclick="exams.showPrintDialog('${e.id}')">Imprimir Hojas</button>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="app.navigate('scanner')">Calificar</button>
                </div>
            </div>
        `).join('');
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
        const defaultUrl = 'https://script.google.com/macros/s/AKfycbxLttjxgGKRECkD94Rpl6M8MQh4SoRiGaDmMabFGylZmjV-_neZ7lEjwuSZVVthSlL0qA/exec';
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
        status.innerText = "Probando...";
        try {
            const res = await fetch(this.apiUrl, { method: 'POST', body: JSON.stringify({ action: 'ping' }) });
            status.innerText = "¡Conexión exitosa!";
            status.style.color = "var(--accent)";
        } catch (err) {
            status.innerText = "Error de conexión. Verifica la URL y los permisos CORS.";
            status.style.color = "var(--secondary)";
        }
    }
};

const stats = {
    charts: {},
    update() {
        // Mock data aggregation for demo
        this.renderCompetencyChart();
        this.renderGroupChart();
        this.renderHistoryChart();
    },
    renderCompetencyChart() {
        const ctx = document.getElementById('competency-chart');
        if (!ctx) return;
        if (this.charts.comp) this.charts.comp.destroy();
        this.charts.comp = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: ['Semántica', 'Sintáctica', 'Pragmática', 'Enciclopédica'],
                datasets: [{
                    label: 'Promedio General',
                    data: [85, 70, 60, 40], // Mock
                    backgroundColor: 'rgba(99, 102, 241, 0.2)',
                    borderColor: 'var(--primary)',
                    pointBackgroundColor: 'var(--primary)'
                }]
            },
            options: { scales: { r: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' } } } }
        });
    },
    renderGroupChart() {
        const ctx = document.getElementById('group-chart');
        if (!ctx) return;
        if (this.charts.group) this.charts.group.destroy();
        this.charts.group = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['11-01', '11-02', '11-03'],
                datasets: [{
                    label: 'Puntaje Promedio',
                    data: [78, 82, 74],
                    backgroundColor: ['var(--primary)', 'var(--secondary)', 'var(--accent)']
                }]
            }
        });
    },
    renderHistoryChart() {
        const ctx = document.getElementById('history-chart');
        if (!ctx) return;
        if (this.charts.history) this.charts.history.destroy();
        this.charts.history = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Ene', 'Feb', 'Mar', 'Abr'],
                datasets: [{
                    label: 'Evolución',
                    data: [65, 72, 68, 80],
                    borderColor: 'var(--accent)',
                    tension: 0.4
                }]
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
