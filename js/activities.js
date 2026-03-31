// ===== CRM LGC - Activities Module =====
// Calls, meetings, tasks, emails, deadlines - linked to deals and contacts

const Activities = (() => {
    const STORAGE_KEY = 'crm_activities';

    const TYPES = [
        { id: 'call', label: 'Appel', icon: '\uD83D\uDCDE', color: '#3b82f6' },
        { id: 'meeting', label: 'Rendez-vous', icon: '\uD83D\uDCC5', color: '#8b5cf6' },
        { id: 'task', label: 'Tache', icon: '\u2705', color: '#22c55e' },
        { id: 'email', label: 'Courriel', icon: '\uD83D\uDCE7', color: '#f59e0b' },
        { id: 'deadline', label: 'Echeance', icon: '\u23F0', color: '#ef4444' },
    ];

    const TYPE_MAP = {};
    TYPES.forEach(t => TYPE_MAP[t.id] = t);

    const PRIORITIES = [
        { id: 'normal', label: 'Normale', color: '#6b7280' },
        { id: 'high', label: 'Haute', color: '#f59e0b' },
        { id: 'urgent', label: 'Urgente', color: '#ef4444' },
    ];

    let currentView = 'list'; // 'list' | 'calendar'
    let currentFilter = 'todo'; // 'todo' | 'overdue' | 'today' | 'week' | 'all'
    let currentTypeFilter = 'all';
    let currentUserFilter = 'all';
    let calendarMonth = new Date().getMonth();
    let calendarYear = new Date().getFullYear();

    // ===== DATA =====
    function loadActivities() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
        // Generate demo data on first load
        const demo = generateDemoActivities();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
        return demo;
    }

    function saveActivities(activities) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(activities));
    }

    function getAll() {
        return loadActivities();
    }

    function getById(id) {
        return loadActivities().find(a => a.id === id) || null;
    }

    function save(activity) {
        const activities = loadActivities();
        const now = new Date().toISOString();

        if (activity.id) {
            const idx = activities.findIndex(a => a.id === activity.id);
            if (idx >= 0) {
                activities[idx] = { ...activities[idx], ...activity, updatedDate: now };
            } else {
                activity.createdDate = activity.createdDate || now;
                activity.updatedDate = now;
                activities.push(activity);
            }
        } else {
            activity.id = 'ACT-' + Date.now().toString(36).toUpperCase();
            activity.createdDate = now;
            activity.updatedDate = now;
            activity.done = false;
            activity.doneDate = null;
            activity.createdBy = activity.createdBy || (Auth.getUser()?.name || 'Systeme');
            activities.push(activity);
        }

        saveActivities(activities);
        return activity;
    }

    function remove(id) {
        const activities = loadActivities().filter(a => a.id !== id);
        saveActivities(activities);
    }

    function markDone(id) {
        const activities = loadActivities();
        const idx = activities.findIndex(a => a.id === id);
        if (idx === -1) return;
        activities[idx].done = !activities[idx].done;
        activities[idx].doneDate = activities[idx].done ? new Date().toISOString() : null;
        activities[idx].updatedDate = new Date().toISOString();
        saveActivities(activities);
        return activities[idx];
    }

    function getForDeal(dealId) {
        return getAll().filter(a => a.dealId === dealId);
    }

    function getForContact(contactId) {
        return getAll().filter(a => a.contactId === contactId);
    }

    function getUpcoming(days) {
        days = days || 7;
        const now = new Date();
        const limit = new Date();
        limit.setDate(limit.getDate() + days);
        return getAll().filter(a => {
            if (a.done) return false;
            if (!a.dueDate) return false;
            const d = new Date(a.dueDate);
            return d >= now && d <= limit;
        }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    }

    function getOverdue() {
        const today = new Date().toISOString().split('T')[0];
        return getAll().filter(a => !a.done && a.dueDate && a.dueDate < today)
            .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    }

    function getTodayCount() {
        const today = new Date().toISOString().split('T')[0];
        return getAll().filter(a => !a.done && a.dueDate === today).length;
    }

    function getThisWeekCount() {
        const now = new Date();
        const endOfWeek = new Date();
        endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
        const todayStr = now.toISOString().split('T')[0];
        const endStr = endOfWeek.toISOString().split('T')[0];
        return getAll().filter(a => !a.done && a.dueDate && a.dueDate >= todayStr && a.dueDate <= endStr).length;
    }

    function getStats(period) {
        const activities = getAll();
        let filtered = activities;

        if (period) {
            const now = new Date();
            let start;
            if (period === 'week') {
                start = new Date();
                start.setDate(start.getDate() - 7);
            } else if (period === 'month') {
                start = new Date(now.getFullYear(), now.getMonth(), 1);
            } else if (period === 'year') {
                start = new Date(now.getFullYear(), 0, 1);
            }
            if (start) {
                const startStr = start.toISOString().split('T')[0];
                filtered = activities.filter(a => (a.doneDate || a.createdDate) >= startStr);
            }
        }

        const completed = filtered.filter(a => a.done).length;
        const byType = {};
        TYPES.forEach(t => byType[t.id] = 0);
        filtered.forEach(a => { if (a.type && byType[a.type] !== undefined) byType[a.type]++; });

        const byUser = {};
        filtered.forEach(a => {
            const u = a.assignedTo || 'Non assigne';
            byUser[u] = (byUser[u] || 0) + 1;
        });

        return { total: filtered.length, completed, pending: filtered.length - completed, byType, byUser };
    }

    // ===== DEMO DATA =====
    function generateDemoActivities() {
        const deals = Deals.getAll();
        if (deals.length === 0) return [];

        const now = new Date();
        const team = Auth.getTeamMembers ? Auth.getTeamMembers() : [];
        const names = team.length > 0 ? team.map(t => t.name) : ['Demo User'];
        const demo = [];

        const subjects = {
            call: ['Appel de suivi', 'Relance client', 'Confirmation mesures', 'Appel devis', 'Suivi apres-vente'],
            meeting: ['Visite client', 'Prise de mesures', 'Presentation soumission', 'Reunion equipe', 'Rendez-vous chantier'],
            task: ['Preparer soumission', 'Envoyer contrat', 'Commander materiaux', 'Verifier inventaire', 'Mettre a jour dossier'],
            email: ['Envoyer soumission', 'Confirmation rendez-vous', 'Suivi paiement', 'Documents requis', 'Reponse demande info'],
            deadline: ['Date limite contrat', 'Echeance paiement', 'Fin garantie', 'Livraison prevue', 'Debut installation'],
        };

        const typeIds = ['call', 'meeting', 'task', 'email', 'deadline'];
        const priorities = ['normal', 'normal', 'normal', 'high', 'urgent'];

        for (let i = 0; i < 18; i++) {
            const typeId = typeIds[i % typeIds.length];
            const deal = deals[i % deals.length];
            const dayOffset = Math.floor(Math.random() * 21) - 7; // -7 to +14 days
            const dueDate = new Date(now);
            dueDate.setDate(dueDate.getDate() + dayOffset);
            const isDone = dayOffset < -2 ? Math.random() > 0.3 : false;
            const subs = subjects[typeId];

            demo.push({
                id: 'ACT-DEMO-' + (i + 1),
                type: typeId,
                subject: subs[i % subs.length],
                description: '',
                dueDate: dueDate.toISOString().split('T')[0],
                dueTime: (8 + Math.floor(Math.random() * 9)).toString().padStart(2, '0') + ':' + (Math.random() > 0.5 ? '00' : '30'),
                duration: [15, 30, 30, 60, 60, 90][Math.floor(Math.random() * 6)],
                dealId: deal.id,
                contactId: '',
                assignedTo: names[i % names.length],
                createdBy: 'Systeme',
                done: isDone,
                doneDate: isDone ? new Date(dueDate.getTime() + 86400000).toISOString() : null,
                priority: priorities[i % priorities.length],
                createdDate: new Date(now.getTime() - 86400000 * 14).toISOString(),
                updatedDate: new Date().toISOString(),
            });
        }

        return demo;
    }

    // ===== RENDER MAIN PAGE =====
    function render() {
        const container = document.getElementById('activities-content');
        if (!container) return;

        const allActivities = getAll();
        const overdue = getOverdue();
        const today = new Date().toISOString().split('T')[0];
        const endOfWeek = new Date();
        endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
        const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

        // Apply filters
        let filtered = allActivities;
        if (currentFilter === 'todo') {
            filtered = filtered.filter(a => !a.done);
        } else if (currentFilter === 'overdue') {
            filtered = filtered.filter(a => !a.done && a.dueDate && a.dueDate < today);
        } else if (currentFilter === 'today') {
            filtered = filtered.filter(a => a.dueDate === today);
        } else if (currentFilter === 'week') {
            filtered = filtered.filter(a => a.dueDate && a.dueDate >= today && a.dueDate <= endOfWeekStr);
        }

        if (currentTypeFilter !== 'all') {
            filtered = filtered.filter(a => a.type === currentTypeFilter);
        }
        if (currentUserFilter !== 'all') {
            filtered = filtered.filter(a => a.assignedTo === currentUserFilter);
        }

        // Get unique assigned users
        const users = [...new Set(allActivities.map(a => a.assignedTo).filter(Boolean))];

        container.innerHTML = `
            <div style="padding:20px;">
                <!-- Header -->
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
                    <!-- View toggle -->
                    <div style="display:flex;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">
                        <button onclick="Activities.setView('list')" style="padding:6px 14px;border:none;cursor:pointer;font-size:13px;
                            background:${currentView === 'list' ? '#2563eb' : 'white'};color:${currentView === 'list' ? 'white' : '#374151'};">Liste</button>
                        <button onclick="Activities.setView('calendar')" style="padding:6px 14px;border:none;cursor:pointer;font-size:13px;
                            background:${currentView === 'calendar' ? '#2563eb' : 'white'};color:${currentView === 'calendar' ? 'white' : '#374151'};">Calendrier</button>
                    </div>

                    <!-- Filter buttons -->
                    <div style="display:flex;gap:4px;">
                        ${[
                            { id: 'todo', label: 'A faire' },
                            { id: 'overdue', label: 'En retard (' + overdue.length + ')' },
                            { id: 'today', label: "Aujourd'hui" },
                            { id: 'week', label: 'Cette semaine' },
                            { id: 'all', label: 'Tout' },
                        ].map(f => `
                            <button class="btn btn-sm ${currentFilter === f.id ? 'btn-primary' : 'btn-outline'}"
                                onclick="Activities.setFilterType('${f.id}')"
                                ${f.id === 'overdue' && overdue.length > 0 ? 'style="color:' + (currentFilter === 'overdue' ? 'white' : '#ef4444') + ';"' : ''}>
                                ${f.label}
                            </button>
                        `).join('')}
                    </div>

                    <!-- Type filter -->
                    <select class="input-sm" onchange="Activities.setTypeFilter(this.value)" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;">
                        <option value="all" ${currentTypeFilter === 'all' ? 'selected' : ''}>Tous les types</option>
                        ${TYPES.map(t => `<option value="${t.id}" ${currentTypeFilter === t.id ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
                    </select>

                    <!-- User filter -->
                    <select class="input-sm" onchange="Activities.setUserFilter(this.value)" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;">
                        <option value="all" ${currentUserFilter === 'all' ? 'selected' : ''}>Tous les membres</option>
                        ${users.map(u => `<option value="${u}" ${currentUserFilter === u ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>

                    <div style="flex:1;"></div>
                    <button class="btn btn-primary btn-sm" onclick="Activities.showCreateForm()">+ Nouvelle activite</button>
                </div>

                <!-- Content -->
                ${currentView === 'list' ? renderListView(filtered) : renderCalendarView(allActivities)}
            </div>
        `;
    }

    // ===== LIST VIEW =====
    function renderListView(activities) {
        if (activities.length === 0) {
            return '<div style="text-align:center;padding:40px;color:#9ca3af;">Aucune activite trouvee pour ces filtres.</div>';
        }

        // Sort by due date
        activities.sort((a, b) => {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return a.dueDate.localeCompare(b.dueDate) || (a.dueTime || '').localeCompare(b.dueTime || '');
        });

        // Group by date
        const groups = {};
        activities.forEach(a => {
            const key = a.dueDate || 'Sans date';
            if (!groups[key]) groups[key] = [];
            groups[key].push(a);
        });

        const today = new Date().toISOString().split('T')[0];

        let html = '';
        Object.keys(groups).sort().forEach(date => {
            const isOverdue = date < today && date !== 'Sans date';
            const isToday = date === today;
            const dateLabel = date === 'Sans date' ? 'Sans date' :
                isToday ? "Aujourd'hui - " + Deals.formatDate(date) :
                Deals.formatDate(date);

            html += `
                <div style="margin-bottom:20px;">
                    <div style="font-weight:700;font-size:14px;color:${isOverdue ? '#ef4444' : isToday ? '#2563eb' : '#374151'};
                        padding:6px 0;border-bottom:1px solid #e5e7eb;margin-bottom:8px;">
                        ${isOverdue ? '\u26A0\uFE0F ' : ''}${dateLabel}
                    </div>
                    ${groups[date].map(a => renderActivityItem(a)).join('')}
                </div>
            `;
        });

        return html;
    }

    function renderActivityItem(a) {
        const typeInfo = TYPE_MAP[a.type] || { icon: '\uD83D\uDCC5', color: '#6b7280', label: 'Activite' };
        const deal = a.dealId ? Deals.getById(a.dealId) : null;
        const today = new Date().toISOString().split('T')[0];
        const isOverdue = !a.done && a.dueDate && a.dueDate < today;
        const priorityColor = a.priority === 'urgent' ? '#ef4444' : a.priority === 'high' ? '#f59e0b' : 'transparent';

        return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:4px;
                border-left:4px solid ${typeInfo.color};background:${a.done ? '#f9fafb' : isOverdue ? '#fef2f2' : 'white'};
                border-radius:0 8px 8px 0;border:1px solid ${isOverdue ? '#fecaca' : '#e5e7eb'};border-left:4px solid ${typeInfo.color};
                cursor:pointer;transition:box-shadow 0.15s;"
                onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow=''"
                onclick="Activities.showEditForm('${a.id}')">
                <!-- Checkbox -->
                <input type="checkbox" ${a.done ? 'checked' : ''}
                    onclick="event.stopPropagation();Activities.toggleDone('${a.id}')"
                    style="width:18px;height:18px;cursor:pointer;accent-color:${typeInfo.color};flex-shrink:0;">
                <!-- Icon -->
                <span style="font-size:20px;flex-shrink:0;">${typeInfo.icon}</span>
                <!-- Content -->
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;color:${a.done ? '#9ca3af' : '#111827'};${a.done ? 'text-decoration:line-through;' : ''}">
                        ${a.subject || 'Sans sujet'}
                    </div>
                    <div style="font-size:12px;color:#6b7280;display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
                        ${deal ? `<span>Deal: ${deal.clientName}</span>` : ''}
                        ${a.assignedTo ? `<span>Assigne: ${a.assignedTo}</span>` : ''}
                        ${a.dueTime ? `<span>${a.dueTime}</span>` : ''}
                        ${a.duration ? `<span>${a.duration} min</span>` : ''}
                    </div>
                </div>
                <!-- Priority -->
                ${priorityColor !== 'transparent' ? `<span style="width:8px;height:8px;border-radius:50%;background:${priorityColor};flex-shrink:0;" title="${a.priority}"></span>` : ''}
                <!-- Actions -->
                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();Activities.confirmRemove('${a.id}')" style="color:#ef4444;border-color:#fca5a5;flex-shrink:0;" title="Supprimer">X</button>
            </div>
        `;
    }

    // ===== CALENDAR VIEW =====
    function renderCalendarView(allActivities) {
        const year = calendarYear;
        const month = calendarMonth;
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDayOfWeek = firstDay.getDay(); // 0=Sun
        const daysInMonth = lastDay.getDate();
        const today = new Date().toISOString().split('T')[0];

        const monthNames = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
            'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
        const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

        // Build activity map for this month
        const activityMap = {};
        allActivities.forEach(a => {
            if (!a.dueDate) return;
            const d = new Date(a.dueDate);
            if (d.getFullYear() === year && d.getMonth() === month) {
                const key = d.getDate();
                if (!activityMap[key]) activityMap[key] = [];
                activityMap[key].push(a);
            }
        });

        let html = `
            <div style="background:white;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                <!-- Month nav -->
                <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:#f9fafb;border-bottom:1px solid #e5e7eb;">
                    <button class="btn btn-sm btn-outline" onclick="Activities.prevMonth()">&lt; Prec.</button>
                    <h3 style="margin:0;font-size:18px;">${monthNames[month]} ${year}</h3>
                    <button class="btn btn-sm btn-outline" onclick="Activities.nextMonth()">Suiv. &gt;</button>
                </div>
                <!-- Day headers -->
                <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid #e5e7eb;">
                    ${dayNames.map(d => `<div style="padding:8px;text-align:center;font-weight:600;font-size:12px;color:#6b7280;background:#f9fafb;">${d}</div>`).join('')}
                </div>
                <!-- Days grid -->
                <div style="display:grid;grid-template-columns:repeat(7,1fr);">
        `;

        // Empty cells before first day
        for (let i = 0; i < startDayOfWeek; i++) {
            html += '<div style="min-height:90px;border:1px solid #f3f4f6;background:#fafafa;"></div>';
        }

        // Day cells
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === today;
            const dayActivities = activityMap[day] || [];
            const overdueCount = dayActivities.filter(a => !a.done && dateStr < today).length;

            html += `
                <div style="min-height:90px;border:1px solid #f3f4f6;padding:4px;cursor:pointer;position:relative;
                    ${isToday ? 'background:#eff6ff;' : ''}"
                    onclick="Activities.showCreateForm('${dateStr}')">
                    <div style="font-size:13px;font-weight:${isToday ? '700' : '400'};color:${isToday ? '#2563eb' : '#374151'};
                        ${isToday ? 'background:#2563eb;color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;' : 'padding:2px 4px;'}">
                        ${day}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:2px;margin-top:2px;">
                        ${dayActivities.slice(0, 3).map(a => {
                            const t = TYPE_MAP[a.type] || { icon: '', color: '#6b7280' };
                            return `<div onclick="event.stopPropagation();Activities.showEditForm('${a.id}')"
                                style="font-size:11px;padding:1px 4px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                                    background:${a.done ? '#f3f4f6' : t.color + '15'};color:${a.done ? '#9ca3af' : t.color};border-left:2px solid ${t.color};
                                    ${a.done ? 'text-decoration:line-through;' : ''}">
                                ${t.icon} ${a.subject || ''}
                            </div>`;
                        }).join('')}
                        ${dayActivities.length > 3 ? `<div style="font-size:10px;color:#6b7280;padding-left:4px;">+${dayActivities.length - 3} autres</div>` : ''}
                    </div>
                </div>
            `;
        }

        // Empty cells after last day
        const totalCells = startDayOfWeek + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 0; i < remaining; i++) {
            html += '<div style="min-height:90px;border:1px solid #f3f4f6;background:#fafafa;"></div>';
        }

        html += '</div></div>';
        return html;
    }

    // ===== CREATE / EDIT FORM =====
    function showCreateForm(prefillDate) {
        const deals = Deals.getAll();
        const contacts = (typeof Contacts !== 'undefined') ? Contacts.getAll() : [];
        const team = Auth.getTeamMembers ? Auth.getTeamMembers() : [];
        const today = prefillDate || new Date().toISOString().split('T')[0];

        showFormModal(null, {
            type: 'call',
            subject: '',
            description: '',
            dueDate: today,
            dueTime: '09:00',
            duration: 30,
            dealId: '',
            contactId: '',
            assignedTo: Auth.getUser()?.name || '',
            priority: 'normal',
        }, deals, contacts, team);
    }

    function showEditForm(activityId) {
        const activity = getById(activityId);
        if (!activity) return;
        const deals = Deals.getAll();
        const contacts = (typeof Contacts !== 'undefined') ? Contacts.getAll() : [];
        const team = Auth.getTeamMembers ? Auth.getTeamMembers() : [];

        showFormModal(activityId, activity, deals, contacts, team);
    }

    function showFormModal(activityId, data, deals, contacts, team) {
        const isEdit = !!activityId;

        let modal = document.getElementById('modal-activities');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-activities';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-activities').classList.add('hidden')"></div>
            <div class="modal-content" style="z-index:1;max-width:550px;max-height:90vh;overflow-y:auto;">
                <div class="modal-header">
                    <h3>${isEdit ? 'Modifier l\'activite' : 'Nouvelle activite'}</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-activities').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    <!-- Type selector -->
                    <div style="display:flex;gap:8px;margin-bottom:16px;">
                        ${TYPES.map(t => `
                            <button type="button" class="act-type-btn" data-type="${t.id}"
                                onclick="document.querySelectorAll('.act-type-btn').forEach(b=>b.style.background='white');this.style.background='${t.color}20';document.getElementById('act-type').value='${t.id}';"
                                style="flex:1;padding:10px 6px;border:2px solid ${t.color};border-radius:8px;cursor:pointer;text-align:center;
                                    background:${data.type === t.id ? t.color + '20' : 'white'};transition:all 0.15s;">
                                <div style="font-size:22px;">${t.icon}</div>
                                <div style="font-size:11px;font-weight:600;color:${t.color};margin-top:2px;">${t.label}</div>
                            </button>
                        `).join('')}
                    </div>
                    <input type="hidden" id="act-type" value="${data.type || 'call'}">

                    <div class="form-group"><label>Sujet *</label><input type="text" id="act-subject" value="${data.subject || ''}" class="input-sm" style="width:100%;" placeholder="Sujet de l'activite"></div>
                    <div class="form-group"><label>Description</label><textarea id="act-desc" rows="2" class="input-sm" style="width:100%;resize:vertical;">${data.description || ''}</textarea></div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group"><label>Date</label><input type="date" id="act-date" value="${data.dueDate || ''}" class="input-sm" style="width:100%;"></div>
                        <div class="form-group"><label>Heure</label><input type="time" id="act-time" value="${data.dueTime || ''}" class="input-sm" style="width:100%;"></div>
                        <div class="form-group"><label>Duree (min)</label><input type="number" id="act-duration" value="${data.duration || 30}" class="input-sm" style="width:100%;" min="5" step="5"></div>
                        <div class="form-group"><label>Priorite</label>
                            <select id="act-priority" class="input-sm" style="width:100%;">
                                ${PRIORITIES.map(p => `<option value="${p.id}" ${data.priority === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group"><label>Lier a un deal</label>
                            <select id="act-deal" class="input-sm" style="width:100%;">
                                <option value="">-- Aucun deal --</option>
                                ${deals.map(d => `<option value="${d.id}" ${data.dealId === d.id ? 'selected' : ''}>${d.clientName} (${Deals.getStageName(d.stage)})</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group"><label>Lier a un contact</label>
                            <select id="act-contact" class="input-sm" style="width:100%;">
                                <option value="">-- Aucun contact --</option>
                                ${contacts.map(c => `<option value="${c.id}" ${data.contactId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="form-group"><label>Assigne a</label>
                        <select id="act-assigned" class="input-sm" style="width:100%;">
                            <option value="">-- Non assigne --</option>
                            ${team.map(t => `<option value="${t.name}" ${data.assignedTo === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-outline" onclick="document.getElementById('modal-activities').classList.add('hidden')">Annuler</button>
                    <button class="btn btn-primary" onclick="Activities.doSave('${activityId || ''}')">${isEdit ? 'Sauvegarder' : 'Creer'}</button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function doSave(activityId) {
        const subject = document.getElementById('act-subject')?.value?.trim();
        if (!subject) { App.showToast('Le sujet est requis', 'error'); return; }

        const data = {
            type: document.getElementById('act-type')?.value || 'call',
            subject,
            description: document.getElementById('act-desc')?.value || '',
            dueDate: document.getElementById('act-date')?.value || '',
            dueTime: document.getElementById('act-time')?.value || '',
            duration: parseInt(document.getElementById('act-duration')?.value) || 30,
            dealId: document.getElementById('act-deal')?.value || '',
            contactId: document.getElementById('act-contact')?.value || '',
            assignedTo: document.getElementById('act-assigned')?.value || '',
            priority: document.getElementById('act-priority')?.value || 'normal',
        };

        if (activityId) {
            data.id = activityId;
        }

        save(data);
        document.getElementById('modal-activities')?.classList.add('hidden');
        App.showToast(activityId ? 'Activite modifiee' : 'Activite creee', 'success');
        render();
    }

    function toggleDone(id) {
        markDone(id);
        render();
    }

    function confirmRemove(id) {
        if (confirm('Supprimer cette activite ?')) {
            remove(id);
            App.showToast('Activite supprimee', 'success');
            render();
        }
    }

    // ===== RENDER FOR DEAL DETAIL =====
    function renderForDeal(dealId, container) {
        const activities = getForDeal(dealId);
        const upcoming = activities.filter(a => !a.done).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
        const done = activities.filter(a => a.done).sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || ''));
        const today = new Date().toISOString().split('T')[0];
        const next = upcoming[0];

        let html = '';

        // Prochaine activite prominently
        if (next) {
            const t = TYPE_MAP[next.type] || { icon: '\uD83D\uDCC5', color: '#3b82f6' };
            const isOverdue = next.dueDate && next.dueDate < today;
            html += `
                <div style="background:${isOverdue ? '#fef2f2' : '#eff6ff'};border:1px solid ${isOverdue ? '#fecaca' : '#bfdbfe'};
                    border-radius:8px;padding:12px;margin-bottom:12px;">
                    <div style="font-size:11px;font-weight:700;color:${isOverdue ? '#ef4444' : '#2563eb'};text-transform:uppercase;margin-bottom:4px;">
                        ${isOverdue ? '\u26A0\uFE0F En retard' : 'Prochaine activite'}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:20px;">${t.icon}</span>
                        <div style="flex:1;">
                            <div style="font-weight:600;">${next.subject}</div>
                            <div style="font-size:12px;color:#6b7280;">${Deals.formatDate(next.dueDate)} ${next.dueTime || ''} ${next.assignedTo ? '- ' + next.assignedTo : ''}</div>
                        </div>
                        <input type="checkbox" onclick="Activities.toggleDone('${next.id}')" style="width:18px;height:18px;cursor:pointer;">
                    </div>
                </div>
            `;
        }

        // Quick add button
        html += `<button class="btn btn-sm btn-primary" onclick="Activities.showCreateFormForDeal('${dealId}')" style="margin-bottom:12px;">+ Ajouter une activite</button>`;

        // Upcoming list
        if (upcoming.length > 1) {
            html += '<div style="margin-bottom:12px;">';
            upcoming.slice(1).forEach(a => {
                const t = TYPE_MAP[a.type] || { icon: '\uD83D\uDCC5', color: '#6b7280' };
                const isOverdue = a.dueDate && a.dueDate < today;
                html += `
                    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-left:3px solid ${t.color};
                        margin-bottom:4px;background:${isOverdue ? '#fef2f2' : '#f9fafb'};border-radius:0 4px 4px 0;cursor:pointer;"
                        onclick="Activities.showEditForm('${a.id}')">
                        <input type="checkbox" onclick="event.stopPropagation();Activities.toggleDone('${a.id}')" style="width:16px;height:16px;cursor:pointer;">
                        <span style="font-size:14px;">${t.icon}</span>
                        <div style="flex:1;font-size:13px;">
                            <span style="font-weight:600;">${a.subject}</span>
                            <span style="color:#6b7280;"> - ${Deals.formatDate(a.dueDate)}</span>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }

        // Done list (collapsed)
        if (done.length > 0) {
            html += `
                <details style="margin-top:8px;">
                    <summary style="cursor:pointer;font-size:13px;color:#6b7280;font-weight:600;">Completees (${done.length})</summary>
                    <div style="margin-top:6px;">
                        ${done.map(a => {
                            const t = TYPE_MAP[a.type] || { icon: '\uD83D\uDCC5', color: '#6b7280' };
                            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;margin-bottom:2px;color:#9ca3af;">
                                <input type="checkbox" checked onclick="Activities.toggleDone('${a.id}')" style="width:14px;height:14px;cursor:pointer;">
                                <span>${t.icon}</span>
                                <span style="text-decoration:line-through;font-size:13px;">${a.subject}</span>
                                <span style="font-size:11px;">${Deals.formatDate(a.doneDate)}</span>
                            </div>`;
                        }).join('')}
                    </div>
                </details>
            `;
        }

        if (activities.length === 0) {
            html = `
                <div style="text-align:center;padding:20px;color:#9ca3af;">
                    <p>Aucune activite pour ce deal.</p>
                    <button class="btn btn-sm btn-primary" onclick="Activities.showCreateFormForDeal('${dealId}')">+ Ajouter une activite</button>
                </div>
            `;
        }

        if (container) {
            if (typeof container === 'string') {
                const el = document.getElementById(container);
                if (el) el.innerHTML = html;
            } else {
                container.innerHTML = html;
            }
        }
        return html;
    }

    function showCreateFormForDeal(dealId) {
        const deals = Deals.getAll();
        const contacts = (typeof Contacts !== 'undefined') ? Contacts.getAll() : [];
        const team = Auth.getTeamMembers ? Auth.getTeamMembers() : [];
        const today = new Date().toISOString().split('T')[0];

        showFormModal(null, {
            type: 'call',
            subject: '',
            description: '',
            dueDate: today,
            dueTime: '09:00',
            duration: 30,
            dealId: dealId,
            contactId: '',
            assignedTo: Auth.getUser()?.name || '',
            priority: 'normal',
        }, deals, contacts, team);
    }

    // ===== MINI WIDGET FOR DASHBOARD =====
    function renderMini() {
        const today = new Date().toISOString().split('T')[0];
        const todayActivities = getAll().filter(a => a.dueDate === today && !a.done);
        const overdue = getOverdue();

        let html = `<div style="padding:12px;">`;

        if (overdue.length > 0) {
            html += `<div style="color:#ef4444;font-weight:700;font-size:13px;margin-bottom:8px;">\u26A0\uFE0F ${overdue.length} activite${overdue.length > 1 ? 's' : ''} en retard</div>`;
            overdue.slice(0, 3).forEach(a => {
                const t = TYPE_MAP[a.type] || { icon: '', color: '#ef4444' };
                html += `<div style="font-size:12px;padding:3px 0;color:#6b7280;" onclick="Activities.showEditForm('${a.id}')" class="cursor-pointer">
                    ${t.icon} ${a.subject} <span style="color:#ef4444;">(${Deals.formatDate(a.dueDate)})</span>
                </div>`;
            });
            if (overdue.length > 3) html += `<div style="font-size:11px;color:#9ca3af;">+${overdue.length - 3} autres</div>`;
            html += '<hr style="border:none;border-top:1px solid #e5e7eb;margin:8px 0;">';
        }

        html += `<div style="font-weight:700;font-size:13px;margin-bottom:8px;">Aujourd'hui (${todayActivities.length})</div>`;

        if (todayActivities.length === 0) {
            html += '<div style="font-size:13px;color:#9ca3af;">Aucune activite prevue.</div>';
        } else {
            todayActivities.forEach(a => {
                const t = TYPE_MAP[a.type] || { icon: '', color: '#3b82f6' };
                html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer;" onclick="Activities.showEditForm('${a.id}')">
                    <input type="checkbox" onclick="event.stopPropagation();Activities.toggleDone('${a.id}')" style="width:14px;height:14px;cursor:pointer;">
                    <span>${t.icon}</span>
                    <span style="flex:1;">${a.subject}</span>
                    <span style="color:#6b7280;font-size:11px;">${a.dueTime || ''}</span>
                </div>`;
            });
        }

        html += '</div>';
        return html;
    }

    // ===== NAVIGATION =====
    function setView(view) {
        currentView = view;
        render();
    }

    function setFilterType(filter) {
        currentFilter = filter;
        render();
    }

    function setTypeFilter(type) {
        currentTypeFilter = type;
        render();
    }

    function setUserFilter(user) {
        currentUserFilter = user;
        render();
    }

    function prevMonth() {
        calendarMonth--;
        if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
        render();
    }

    function nextMonth() {
        calendarMonth++;
        if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
        render();
    }

    return {
        getAll,
        getById,
        save,
        remove,
        markDone,
        getForDeal,
        getForContact,
        getUpcoming,
        getOverdue,
        getTodayCount,
        getThisWeekCount,
        render,
        renderForDeal,
        renderMini,
        getStats,
        // UI actions
        setView,
        setFilterType,
        setTypeFilter,
        setUserFilter,
        showCreateForm,
        showEditForm,
        showCreateFormForDeal,
        doSave,
        toggleDone,
        confirmRemove,
        prevMonth,
        nextMonth,
    };
})();
