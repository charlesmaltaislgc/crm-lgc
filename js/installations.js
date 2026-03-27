// ===== CRM LGC - Installations & Mesures Module =====
// Calendar view for 4 installation teams + photo upload (before/after)
// + Measurement tracking with alerts

const Installations = (() => {
    const STORAGE_KEY = 'crm_installations';
    const PHOTOS_KEY = 'crm_install_photos';
    // 4 équipes d'installation
    const TEAMS = [
        { id: 'equipe-1', name: 'Équipe 1', color: '#3b82f6', icon: '🔵' },
        { id: 'equipe-2', name: 'Équipe 2', color: '#22c55e', icon: '🟢' },
        { id: 'equipe-3', name: 'Équipe 3', color: '#f59e0b', icon: '🟡' },
        { id: 'equipe-4', name: 'Équipe 4', color: '#ef4444', icon: '🔴' },
    ];

    let currentWeekStart = getMonday(new Date());
    let installations = [];
    let photos = {};
    let selectedInstallation = null;

    function getMonday(d) {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        date.setDate(diff);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function loadData() {
        const saved = localStorage.getItem(STORAGE_KEY);
        installations = saved ? JSON.parse(saved) : generateDemoInstallations();
        if (!saved) saveData();

        const savedPhotos = localStorage.getItem(PHOTOS_KEY);
        photos = savedPhotos ? JSON.parse(savedPhotos) : {};
    }

    function saveData() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(installations));
    }

    function savePhotos() {
        localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos));
    }

    // =========================================
    // DEMO DATA
    // =========================================

    function generateDemoInstallations() {
        const today = new Date();
        const monday = getMonday(today);
        const demo = [];
        const clients = [
            'Tremblay - Résidence', 'Lavoie - Condo', 'Gagnon - Maison neuve',
            'Bouchard - Rénovation', 'Côté - Duplex', 'Fortin - Commercial',
            'Roy - Bungalow', 'Pelletier - Cottage', 'Morin - Split-level',
            'Gauthier - Jumelé', 'Martin - Unifamiliale', 'Bergeron - Multiplex'
        ];
        const addresses = [
            '123 rue Principale, Québec', '456 boul. Laurier, Lévis',
            '789 av. Royale, Beauport', '321 rue du Pont, St-Nicolas',
            '654 ch. Ste-Foy, Québec', '987 rue Seigneuriale, Beauport',
            '147 boul. Hamel, Québec', '258 rue Dorchester, Québec',
            '369 av. Cartier, Québec', '741 rue St-Jean, Québec',
            '852 ch. Royal, Île d\'Orléans', '963 rue Maguire, Sillery'
        ];

        let idx = 0;
        for (let day = 0; day < 5; day++) {
            const numTeams = Math.min(2 + Math.floor(Math.random() * 3), 4);
            const shuffled = [...TEAMS].sort(() => Math.random() - 0.5);
            for (let t = 0; t < numTeams; t++) {
                const date = new Date(monday);
                date.setDate(date.getDate() + day);
                demo.push({
                    id: 'inst-' + Date.now() + '-' + idx,
                    teamId: shuffled[t].id,
                    date: date.toISOString().split('T')[0],
                    clientName: clients[idx % clients.length],
                    address: addresses[idx % addresses.length],
                    products: ['Fenêtres', 'Portes', 'Portes + Fenêtres'][idx % 3],
                    dealId: null,
                    status: day < 2 ? 'completed' : day < 4 ? 'scheduled' : 'scheduled',
                    notes: '',
                    estimatedHours: 4 + Math.floor(Math.random() * 5),
                });
                idx++;
            }
        }
        return demo;
    }

    // =========================================
    // MAIN RENDER
    // =========================================

    function render() {
        const container = document.getElementById('installations-content');
        if (!container) return;

        loadData();

        container.innerHTML = `
            <div class="install-calendar-nav">
                <button class="btn btn-sm btn-outline" onclick="Installations.prevWeek()">◀ Semaine préc.</button>
                <h3 class="install-week-title">${formatWeekTitle(currentWeekStart)}</h3>
                <button class="btn btn-sm btn-outline" onclick="Installations.nextWeek()">Semaine suiv. ▶</button>
                <button class="btn btn-sm btn-outline" onclick="Installations.goToday()" style="margin-left:8px">Aujourd'hui</button>
                <button class="btn btn-sm btn-primary" onclick="Installations.openNewInstall()" style="margin-left:auto">+ Planifier</button>
            </div>

            <div class="install-legend">
                ${TEAMS.map(t => `<span class="install-legend-item"><span class="install-dot" style="background:${t.color}"></span>${t.name}</span>`).join('')}
                <span class="install-legend-item"><span class="install-dot" style="background:#94a3b8"></span>Complété</span>
            </div>

            <div class="install-calendar">
                ${renderWeekHeader(currentWeekStart)}
                ${TEAMS.map(team => renderTeamRow(team)).join('')}
            </div>

            <div class="install-stats">
                ${renderStats()}
            </div>
        `;
    }

    function formatWeekTitle(weekStart) {
        const end = new Date(weekStart);
        end.setDate(end.getDate() + 4);
        const opts = { day: 'numeric', month: 'short' };
        return `${weekStart.toLocaleDateString('fr-CA', opts)} — ${end.toLocaleDateString('fr-CA', opts)} ${end.getFullYear()}`;
    }

    function renderWeekHeader(weekStart) {
        const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
        let html = '<div class="install-row install-header"><div class="install-team-cell">Équipe</div>';
        for (let i = 0; i < 5; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const isToday = date.toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
            html += `<div class="install-day-cell ${isToday ? 'today' : ''}">
                <span class="install-day-name">${days[i]}</span>
                <span class="install-day-date">${date.getDate()}</span>
            </div>`;
        }
        html += '</div>';
        return html;
    }

    function renderTeamRow(team) {
        let html = `<div class="install-row">
            <div class="install-team-cell">
                <span class="install-team-icon" style="background:${team.color}">${team.name.split(' ')[1]}</span>
                <span class="install-team-name">${team.name}</span>
            </div>`;

        for (let i = 0; i < 5; i++) {
            const date = new Date(currentWeekStart);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            const isToday = dateStr === new Date().toISOString().split('T')[0];
            const dayInstalls = installations.filter(inst => inst.teamId === team.id && inst.date === dateStr);

            html += `<div class="install-day-cell ${isToday ? 'today' : ''}"
                          ondragover="event.preventDefault();this.classList.add('drag-over')"
                          ondragleave="this.classList.remove('drag-over')"
                          ondrop="Installations.handleDrop(event,'${team.id}','${dateStr}')">`;

            if (dayInstalls.length === 0) {
                html += `<div class="install-empty" onclick="Installations.openNewInstall('${team.id}','${dateStr}')">+</div>`;
            } else {
                dayInstalls.forEach(inst => {
                    const hasPhotos = photos[inst.id] && (photos[inst.id].before || photos[inst.id].after);
                    html += `<div class="install-card ${inst.status}"
                                  draggable="true"
                                  ondragstart="Installations.handleDragStart(event,'${inst.id}')"
                                  style="border-left: 3px solid ${team.color}"
                                  onclick="Installations.openDetail('${inst.id}')">
                        <div class="install-card-client">${inst.clientName}</div>
                        <div class="install-card-products">${inst.products}</div>
                        <div class="install-card-meta">
                            ${inst.estimatedHours ? `<span>⏱ ${inst.estimatedHours}h</span>` : ''}
                            ${hasPhotos ? '<span>📸</span>' : ''}
                            ${inst.status === 'completed' ? '<span>✅</span>' : ''}
                        </div>
                    </div>`;
                });
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderStats() {
        const weekEnd = new Date(currentWeekStart);
        weekEnd.setDate(weekEnd.getDate() + 5);
        const weekStr = currentWeekStart.toISOString().split('T')[0];
        const weekEndStr = weekEnd.toISOString().split('T')[0];

        const weekInstalls = installations.filter(i => i.date >= weekStr && i.date < weekEndStr);
        const completed = weekInstalls.filter(i => i.status === 'completed').length;
        const totalHours = weekInstalls.reduce((sum, i) => sum + (i.estimatedHours || 0), 0);

        const teamCounts = {};
        TEAMS.forEach(t => teamCounts[t.id] = 0);
        weekInstalls.forEach(i => { if (teamCounts[i.teamId] !== undefined) teamCounts[i.teamId]++; });

        return `
            <div class="install-stat-card">
                <div class="install-stat-value">${weekInstalls.length}</div>
                <div class="install-stat-label">Installations cette semaine</div>
            </div>
            <div class="install-stat-card">
                <div class="install-stat-value">${completed}</div>
                <div class="install-stat-label">Complétées</div>
            </div>
            <div class="install-stat-card">
                <div class="install-stat-value">${totalHours}h</div>
                <div class="install-stat-label">Heures estimées</div>
            </div>
            ${TEAMS.map(t => `
                <div class="install-stat-card" style="border-top: 3px solid ${t.color}">
                    <div class="install-stat-value">${teamCounts[t.id]}</div>
                    <div class="install-stat-label">${t.name}</div>
                </div>
            `).join('')}
        `;
    }

    // (mesures tracking done via deal pipeline alerts — no separate tab)

    // =========================================
    // NAVIGATION
    // =========================================

    function prevWeek() {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        render();
    }

    function nextWeek() {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        render();
    }

    function goToday() {
        currentWeekStart = getMonday(new Date());
        render();
    }

    // =========================================
    // DRAG & DROP (installations)
    // =========================================

    let draggedInstId = null;

    function handleDragStart(e, instId) {
        draggedInstId = instId;
        e.dataTransfer.setData('text/plain', instId);
        e.dataTransfer.effectAllowed = 'move';
    }

    function handleDrop(e, teamId, dateStr) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        const instId = e.dataTransfer.getData('text/plain') || draggedInstId;
        if (!instId) return;

        const inst = installations.find(i => i.id === instId);
        if (inst) {
            inst.teamId = teamId;
            inst.date = dateStr;
            saveData();
            render();
            App.showToast('Installation déplacée', 'success');
        }
        draggedInstId = null;
    }

    // =========================================
    // INSTALLATION MODAL
    // =========================================

    function openNewInstall(teamId, dateStr) {
        selectedInstallation = null;
        const modal = document.getElementById('modal-installation');
        if (!modal) return;

        modal.classList.remove('hidden');
        document.getElementById('modal-install-title').textContent = 'Planifier une installation';

        document.getElementById('install-form').reset();
        document.getElementById('install-client').value = '';
        document.getElementById('install-address').value = '';
        document.getElementById('install-client-info').classList.add('hidden');

        if (teamId) document.getElementById('install-team').value = teamId;
        if (dateStr) document.getElementById('install-date').value = dateStr;
        else document.getElementById('install-date').value = new Date().toISOString().split('T')[0];

        document.getElementById('install-status').value = 'scheduled';
        document.getElementById('install-photos-section').innerHTML = '';
        document.getElementById('btn-delete-install').classList.add('hidden');

        populateDealSelect('install-deal', null);
    }

    function openDetail(instId) {
        const inst = installations.find(i => i.id === instId);
        if (!inst) return;

        selectedInstallation = inst;
        const modal = document.getElementById('modal-installation');
        if (!modal) return;

        modal.classList.remove('hidden');
        document.getElementById('modal-install-title').textContent = `Installation - ${inst.clientName}`;

        document.getElementById('install-client').value = inst.clientName || '';
        document.getElementById('install-address').value = inst.address || '';
        document.getElementById('install-team').value = inst.teamId || '';
        document.getElementById('install-date').value = inst.date || '';
        document.getElementById('install-mesure-date').value = inst.mesureDate || '';
        document.getElementById('install-products').value = inst.products || '';
        document.getElementById('install-hours').value = inst.estimatedHours || '';
        document.getElementById('install-status').value = inst.status || 'scheduled';
        document.getElementById('install-notes').value = inst.notes || '';

        document.getElementById('btn-delete-install').classList.remove('hidden');

        populateDealSelect('install-deal', inst.dealId || null);

        // Afficher info client si deal lié
        if (inst.clientName) {
            document.getElementById('install-client-name-display').textContent = '👤 ' + inst.clientName;
            document.getElementById('install-client-address-display').textContent = inst.address ? ' — 📍 ' + inst.address : '';
            const mapsLink = document.getElementById('install-client-maps-link');
            mapsLink.href = inst.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(inst.address) : '#';
            mapsLink.style.display = inst.address ? '' : 'none';
            document.getElementById('install-client-info').classList.remove('hidden');
        }

        renderPhotos(instId);
    }

    function populateDealSelect(selectId, currentDealId) {
        const select = document.getElementById(selectId);
        if (!select) return;
        const deals = (Deals.getAll ? Deals.getAll() : []).filter(d => d.status === 'active');
        select.innerHTML = '<option value="">— Chercher un lead/client... —</option>';
        // Trier par nom client
        deals.slice().sort((a, b) => a.clientName.localeCompare(b.clientName)).forEach(d => {
            const stage = Deals.getStageName ? Deals.getStageName(d.stage) : `Étape ${d.stage}`;
            select.innerHTML += `<option value="${d.id}" data-client="${d.clientName}" data-address="${d.clientAddress || ''}" data-products="${d.products || ''}">${d.clientName} — ${stage}</option>`;
        });
        if (currentDealId) select.value = currentDealId;
    }

    function onInstallDealChange() {
        const select = document.getElementById('install-deal');
        const opt = select.options[select.selectedIndex];
        const clientName = opt?.dataset?.client || '';
        const address = opt?.dataset?.address || '';
        const products = opt?.dataset?.products || '';

        document.getElementById('install-client').value = clientName;
        document.getElementById('install-address').value = address;
        if (products) document.getElementById('install-products').value = products;

        const infoEl = document.getElementById('install-client-info');
        if (clientName) {
            document.getElementById('install-client-name-display').textContent = '👤 ' + clientName;
            document.getElementById('install-client-address-display').textContent = address ? ' — 📍 ' + address : '';
            const mapsLink = document.getElementById('install-client-maps-link');
            mapsLink.href = address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : '#';
            mapsLink.style.display = address ? '' : 'none';
            infoEl.classList.remove('hidden');
        } else {
            infoEl.classList.add('hidden');
        }
    }

    function onMesureDealChange() {
        const select = document.getElementById('mesure-deal');
        const opt = select.options[select.selectedIndex];
        const clientName = opt?.dataset?.client || '';
        const address = opt?.dataset?.address || '';
        const products = opt?.dataset?.products || '';

        document.getElementById('mesure-client').value = clientName;
        document.getElementById('mesure-address').value = address;
        if (products) document.getElementById('mesure-products').value = products;

        const infoEl = document.getElementById('mesure-client-info');
        if (clientName) {
            document.getElementById('mesure-client-name-display').textContent = '👤 ' + clientName;
            document.getElementById('mesure-client-address-display').textContent = address ? ' — 📍 ' + address : '';
            const mapsLink = document.getElementById('mesure-client-maps-link');
            mapsLink.href = address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : '#';
            mapsLink.style.display = address ? '' : 'none';
            infoEl.classList.remove('hidden');
        } else {
            infoEl.classList.add('hidden');
        }
    }

    function saveInstallation() {
        const dealId = document.getElementById('install-deal').value || null;
        const data = {
            clientName: document.getElementById('install-client').value.trim(),
            address: document.getElementById('install-address').value.trim(),
            teamId: document.getElementById('install-team').value,
            date: document.getElementById('install-date').value,
            mesureDate: document.getElementById('install-mesure-date').value || null,
            products: document.getElementById('install-products').value.trim(),
            estimatedHours: parseInt(document.getElementById('install-hours').value) || 0,
            status: document.getElementById('install-status').value,
            notes: document.getElementById('install-notes').value.trim(),
            dealId,
        };

        if (!data.dealId && !data.clientName) {
            App.showToast('Sélectionnez un lead/client dans la liste', 'danger');
            return;
        }
        if (!data.teamId || !data.date) {
            App.showToast('Équipe et date d\'installation sont requis', 'danger');
            return;
        }

        if (selectedInstallation) {
            Object.assign(selectedInstallation, data);
            selectedInstallation.updatedAt = new Date().toISOString();
        } else {
            data.id = 'inst-' + Date.now();
            data.createdAt = new Date().toISOString();
            data.updatedAt = new Date().toISOString();
            installations.push(data);
        }

        saveData();
        document.getElementById('modal-installation').classList.add('hidden');
        render();
        App.showToast(selectedInstallation ? 'Installation mise à jour' : 'Installation planifiée', 'success');
    }

    function deleteInstallation() {
        if (!selectedInstallation) return;
        if (!confirm(`Supprimer l'installation de ${selectedInstallation.clientName}?`)) return;

        installations = installations.filter(i => i.id !== selectedInstallation.id);
        delete photos[selectedInstallation.id];
        saveData();
        savePhotos();
        document.getElementById('modal-installation').classList.add('hidden');
        render();
        App.showToast('Installation supprimée', 'info');
    }

    // =========================================
    // PHOTOS (before/after for installations)
    // =========================================

    function renderPhotos(instId) {
        const container = document.getElementById('install-photos-section');
        if (!container) return;

        const instPhotos = photos[instId] || { before: [], after: [] };

        container.innerHTML = `
            <div class="install-photos-grid">
                <div class="install-photos-col">
                    <h4>📷 Photos AVANT</h4>
                    <div class="install-photos-list" id="photos-before">
                        ${(instPhotos.before || []).map((p, i) => `
                            <div class="install-photo-thumb">
                                <img src="${p}" alt="Avant ${i + 1}">
                                <button class="photo-remove" onclick="event.stopPropagation();Installations.removePhoto('${instId}','before',${i})">×</button>
                            </div>
                        `).join('') || '<p class="text-muted" style="font-size:12px">Aucune photo</p>'}
                    </div>
                    <label class="install-photo-upload">
                        <input type="file" accept="image/*" multiple onchange="Installations.handlePhotoUpload(event,'${instId}','before')" hidden>
                        <span class="btn btn-sm btn-outline">📤 Ajouter photos avant</span>
                    </label>
                </div>
                <div class="install-photos-col">
                    <h4>📸 Photos APRÈS</h4>
                    <div class="install-photos-list" id="photos-after">
                        ${(instPhotos.after || []).map((p, i) => `
                            <div class="install-photo-thumb">
                                <img src="${p}" alt="Après ${i + 1}">
                                <button class="photo-remove" onclick="event.stopPropagation();Installations.removePhoto('${instId}','after',${i})">×</button>
                            </div>
                        `).join('') || '<p class="text-muted" style="font-size:12px">Aucune photo</p>'}
                    </div>
                    <label class="install-photo-upload">
                        <input type="file" accept="image/*" multiple onchange="Installations.handlePhotoUpload(event,'${instId}','after')" hidden>
                        <span class="btn btn-sm btn-outline">📤 Ajouter photos après</span>
                    </label>
                </div>
            </div>
        `;
    }

    function handlePhotoUpload(e, instId, type) {
        const files = e.target.files;
        if (!files.length) return;

        if (!photos[instId]) photos[instId] = { before: [], after: [] };

        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxW = 800;
                    const scale = Math.min(1, maxW / img.width);
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

                    if (!photos[instId][type]) photos[instId][type] = [];
                    photos[instId][type].push(dataUrl);
                    savePhotos();
                    renderPhotos(instId);
                    App.showToast('Photo ajoutée', 'success');
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function removePhoto(instId, type, index) {
        if (!photos[instId] || !photos[instId][type]) return;
        photos[instId][type].splice(index, 1);
        savePhotos();
        renderPhotos(instId);
    }

    // Mesure alerts from installation calendar data
    function getMesureAlerts() {
        loadData();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const alertList = [];

        // Check installations scheduled in the next 30 days
        // If they don't have a linked deal with measurementDate set → alert
        installations.forEach(inst => {
            if (inst.status === 'completed') return;
            const installDate = new Date(inst.date);
            const daysUntil = Math.round((installDate - today) / (1000 * 60 * 60 * 24));
            if (daysUntil < 0 || daysUntil > 30) return;

            // Check if linked deal has measurementDate
            let hasMesure = false;
            if (inst.dealId) {
                const deal = Deals.getById ? Deals.getById(inst.dealId) : null;
                if (deal && deal.measurementDate) hasMesure = true;
            }

            if (!hasMesure) {
                const type = daysUntil <= 14 ? 'urgent' : 'warning';
                const category = daysUntil <= 14 ? 'MESURES URGENTES' : 'MESURES À PLANIFIER';
                alertList.push({
                    type,
                    category,
                    text: `${inst.clientName} — Installation dans ${daysUntil}j, mesures pas faites!`,
                    delay: `${daysUntil}j`,
                    priority: type === 'urgent' ? 1 : 2,
                    mesureId: inst.id,
                });
            }
        });

        return alertList;
    }

    return {
        render,
        prevWeek,
        nextWeek,
        goToday,
        openNewInstall,
        openDetail,
        saveInstallation,
        deleteInstallation,
        handleDragStart,
        handleDrop,
        handlePhotoUpload,
        removePhoto,
        getMesureAlerts,
        onInstallDealChange,
        onMesureDealChange,
    };
})();
