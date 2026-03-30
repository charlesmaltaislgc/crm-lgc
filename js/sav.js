// ===== CRM LGC - Service Après-Vente (SAV) Module =====
// Ticket management, problem tracking, warranty, statistics

const SAV = (() => {
    const STORAGE_KEY = 'crm_sav_tickets';
    let tickets = [];

    // Types de problèmes
    const PROBLEM_TYPES = [
        { id: 'install_fenetre', label: 'Installation fenêtre', icon: '🪟', category: 'installation' },
        { id: 'install_porte', label: 'Installation porte', icon: '🚪', category: 'installation' },
        { id: 'install_patio', label: 'Installation porte-patio', icon: '🏠', category: 'installation' },
        { id: 'thermos', label: 'Thermos / Vitrage scellé', icon: '🌡️', category: 'produit' },
        { id: 'vitre_brisee', label: 'Vitre brisée', icon: '💔', category: 'produit' },
        { id: 'moustiquaire', label: 'Moustiquaire', icon: '🪰', category: 'produit' },
        { id: 'quincaillerie', label: 'Quincaillerie / Poignée', icon: '🔩', category: 'produit' },
        { id: 'etancheite', label: 'Étanchéité / Infiltration', icon: '💧', category: 'installation' },
        { id: 'ajustement', label: 'Ajustement / Fermeture', icon: '🔧', category: 'installation' },
        { id: 'esthetique', label: 'Esthétique / Finition', icon: '🎨', category: 'installation' },
        { id: 'bruit', label: 'Bruit / Sifflement', icon: '🔊', category: 'produit' },
        { id: 'condensation', label: 'Condensation', icon: '💨', category: 'produit' },
        { id: 'mesure_erreur', label: 'Erreur de mesure', icon: '📏', category: 'erreur' },
        { id: 'commande_erreur', label: 'Erreur de commande', icon: '📦', category: 'erreur' },
        { id: 'delai', label: 'Délai / Retard', icon: '⏰', category: 'service' },
        { id: 'autre', label: 'Autre', icon: '❓', category: 'autre' },
    ];

    const STATUSES = [
        { id: 'new', label: 'Nouveau', color: '#3b82f6', icon: '🆕' },
        { id: 'in_progress', label: 'En cours', color: '#f59e0b', icon: '🔄' },
        { id: 'waiting_parts', label: 'En attente pièces', color: '#8b5cf6', icon: '📦' },
        { id: 'scheduled', label: 'Planifié', color: '#06b6d4', icon: '📅' },
        { id: 'resolved', label: 'Résolu', color: '#10b981', icon: '✅' },
        { id: 'closed', label: 'Fermé', color: '#6b7280', icon: '🔒' },
    ];

    const PRIORITIES = [
        { id: 'low', label: 'Basse', color: '#6b7280' },
        { id: 'normal', label: 'Normale', color: '#3b82f6' },
        { id: 'high', label: 'Haute', color: '#f59e0b' },
        { id: 'urgent', label: 'Urgente', color: '#ef4444' },
    ];

    // ===== DATA =====
    function loadTickets() {
        const saved = localStorage.getItem(STORAGE_KEY);
        tickets = saved ? JSON.parse(saved) : [];
    }

    function saveTickets() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
    }

    function createTicket(data) {
        const ticket = {
            id: 'SAV-' + Date.now().toString(36).toUpperCase(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: Auth.getUser()?.name || 'Système',
            // Client info
            clientName: data.clientName || '',
            clientPhone: data.clientPhone || '',
            clientEmail: data.clientEmail || '',
            clientAddress: data.clientAddress || '',
            dealId: data.dealId || '',
            // Problem
            problemType: data.problemType || 'autre',
            description: data.description || '',
            priority: data.priority || 'normal',
            // Coverage
            coveredByLGC: data.coveredByLGC !== false, // true by default
            warrantyNote: data.warrantyNote || '',
            // Status
            status: 'new',
            assignedTo: data.assignedTo || '',
            assignedTeam: data.assignedTeam || '',
            // Schedule
            scheduledDate: data.scheduledDate || '',
            completedDate: '',
            // Resolution
            resolution: '',
            notes: [],
            // Cost tracking
            costParts: 0,
            costLabor: 0,
        };
        tickets.push(ticket);
        saveTickets();
        return ticket;
    }

    function updateTicket(ticketId, updates) {
        const idx = tickets.findIndex(t => t.id === ticketId);
        if (idx === -1) return null;
        tickets[idx] = { ...tickets[idx], ...updates, updatedAt: new Date().toISOString() };
        saveTickets();
        return tickets[idx];
    }

    function addTicketNote(ticketId, text) {
        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket) return;
        ticket.notes.push({
            id: 'N' + Date.now(),
            text,
            author: Auth.getUser()?.name || '',
            date: new Date().toISOString(),
        });
        ticket.updatedAt = new Date().toISOString();
        saveTickets();
    }

    function getTickets(filter = {}) {
        let result = [...tickets];
        if (filter.status) result = result.filter(t => t.status === filter.status);
        if (filter.problemType) result = result.filter(t => t.problemType === filter.problemType);
        if (filter.coveredByLGC !== undefined) result = result.filter(t => t.coveredByLGC === filter.coveredByLGC);
        if (filter.assignedTo) result = result.filter(t => t.assignedTo === filter.assignedTo);
        return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    function getById(ticketId) {
        return tickets.find(t => t.id === ticketId);
    }

    // ===== STATS =====
    function getStats() {
        const open = tickets.filter(t => !['resolved', 'closed'].includes(t.status));
        const resolved = tickets.filter(t => t.status === 'resolved' || t.status === 'closed');
        const covered = tickets.filter(t => t.coveredByLGC);
        const notCovered = tickets.filter(t => !t.coveredByLGC);

        // By problem type
        const byType = {};
        PROBLEM_TYPES.forEach(pt => { byType[pt.id] = { ...pt, count: 0, open: 0 }; });
        tickets.forEach(t => {
            if (byType[t.problemType]) {
                byType[t.problemType].count++;
                if (!['resolved', 'closed'].includes(t.status)) byType[t.problemType].open++;
            }
        });

        // By category
        const byCategory = {};
        tickets.forEach(t => {
            const type = PROBLEM_TYPES.find(pt => pt.id === t.problemType);
            const cat = type?.category || 'autre';
            if (!byCategory[cat]) byCategory[cat] = { count: 0, open: 0 };
            byCategory[cat].count++;
            if (!['resolved', 'closed'].includes(t.status)) byCategory[cat].open++;
        });

        // Average resolution time (in days)
        const resolvedWithDates = resolved.filter(t => t.completedDate && t.createdAt);
        const avgResolution = resolvedWithDates.length > 0
            ? resolvedWithDates.reduce((sum, t) => {
                const days = (new Date(t.completedDate) - new Date(t.createdAt)) / (1000 * 60 * 60 * 24);
                return sum + days;
            }, 0) / resolvedWithDates.length
            : 0;

        // This month
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const thisMonth = tickets.filter(t => t.createdAt >= monthStart);
        const resolvedThisMonth = resolved.filter(t => t.completedDate && t.completedDate >= monthStart);

        // Total cost
        const totalCost = tickets.reduce((sum, t) => sum + (t.costParts || 0) + (t.costLabor || 0), 0);

        return {
            total: tickets.length,
            open: open.length,
            resolved: resolved.length,
            covered: covered.length,
            notCovered: notCovered.length,
            byType: Object.values(byType).filter(t => t.count > 0).sort((a, b) => b.count - a.count),
            byCategory,
            avgResolution: Math.round(avgResolution * 10) / 10,
            thisMonth: thisMonth.length,
            resolvedThisMonth: resolvedThisMonth.length,
            totalCost,
        };
    }

    // ===== RENDER =====
    function render() {
        const container = document.getElementById('sav-content');
        if (!container) return;

        loadTickets();
        const stats = getStats();
        const activeFilter = container.dataset.filter || 'all';
        const activeType = container.dataset.typeFilter || 'all';

        // Get filtered tickets
        let filtered = [...tickets];
        if (activeFilter === 'open') filtered = filtered.filter(t => !['resolved', 'closed'].includes(t.status));
        else if (activeFilter === 'resolved') filtered = filtered.filter(t => ['resolved', 'closed'].includes(t.status));
        else if (activeFilter === 'covered') filtered = filtered.filter(t => t.coveredByLGC);
        else if (activeFilter === 'not_covered') filtered = filtered.filter(t => !t.coveredByLGC);
        if (activeType !== 'all') filtered = filtered.filter(t => t.problemType === activeType);
        filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        container.innerHTML = `
            <!-- KPI Cards -->
            <div class="sav-kpis">
                <div class="sav-kpi"><div class="sav-kpi-num">${stats.total}</div><div class="sav-kpi-label">Total tickets</div></div>
                <div class="sav-kpi sav-kpi-warning"><div class="sav-kpi-num">${stats.open}</div><div class="sav-kpi-label">En cours</div></div>
                <div class="sav-kpi sav-kpi-success"><div class="sav-kpi-num">${stats.resolved}</div><div class="sav-kpi-label">Résolus</div></div>
                <div class="sav-kpi"><div class="sav-kpi-num">${stats.avgResolution}j</div><div class="sav-kpi-label">Délai moyen</div></div>
                <div class="sav-kpi"><div class="sav-kpi-num">${stats.thisMonth}</div><div class="sav-kpi-label">Ce mois</div></div>
            </div>

            <!-- Top problem types chart -->
            <div class="sav-chart-row">
                <div class="sav-chart-card">
                    <h4>Problèmes les plus fréquents</h4>
                    <div class="sav-bar-chart">
                        ${stats.byType.slice(0, 8).map(t => {
                            const pct = stats.total > 0 ? Math.round((t.count / stats.total) * 100) : 0;
                            return `<div class="sav-bar-row">
                                <span class="sav-bar-label">${t.icon} ${t.label}</span>
                                <div class="sav-bar-track"><div class="sav-bar-fill" style="width:${pct}%"></div></div>
                                <span class="sav-bar-val">${t.count} ${t.open > 0 ? `<small style="color:var(--warning)">(${t.open} ouvert${t.open > 1 ? 's' : ''})</small>` : ''}</span>
                            </div>`;
                        }).join('') || '<div style="color:var(--text-muted);padding:12px">Aucun ticket encore</div>'}
                    </div>
                </div>
                <div class="sav-chart-card">
                    <h4>Couverture garantie</h4>
                    <div style="display:flex;gap:24px;align-items:center;padding:16px 0">
                        <div style="text-align:center">
                            <div style="font-size:32px;font-weight:800;color:var(--success)">${stats.covered}</div>
                            <div style="font-size:12px;color:var(--text-muted)">Couverts LGC</div>
                        </div>
                        <div style="text-align:center">
                            <div style="font-size:32px;font-weight:800;color:var(--danger)">${stats.notCovered}</div>
                            <div style="font-size:12px;color:var(--text-muted)">Non couverts</div>
                        </div>
                        <div style="text-align:center">
                            <div style="font-size:32px;font-weight:800;color:var(--text-secondary)">${Deals.formatMoney(stats.totalCost)}</div>
                            <div style="font-size:12px;color:var(--text-muted)">Coût total SAV</div>
                        </div>
                    </div>
                    <h4 style="margin-top:12px">Par catégorie</h4>
                    ${Object.entries(stats.byCategory).map(([cat, data]) => {
                        const catLabels = { installation: '🏗️ Installation', produit: '📦 Produit', erreur: '⚠️ Erreur', service: '🕐 Service', autre: '❓ Autre' };
                        return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
                            <span>${catLabels[cat] || cat}</span>
                            <span><strong>${data.count}</strong> ${data.open > 0 ? `<small style="color:var(--warning)">(${data.open})</small>` : ''}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <!-- Filters + Action bar -->
            <div class="sav-toolbar">
                <div class="sav-filters">
                    <button class="btn btn-sm ${activeFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="SAV.setFilter('all')">Tous (${tickets.length})</button>
                    <button class="btn btn-sm ${activeFilter === 'open' ? 'btn-primary' : 'btn-outline'}" onclick="SAV.setFilter('open')">En cours (${stats.open})</button>
                    <button class="btn btn-sm ${activeFilter === 'resolved' ? 'btn-primary' : 'btn-outline'}" onclick="SAV.setFilter('resolved')">Résolus (${stats.resolved})</button>
                    <button class="btn btn-sm ${activeFilter === 'covered' ? 'btn-primary' : 'btn-outline'}" onclick="SAV.setFilter('covered')">Couverts (${stats.covered})</button>
                    <button class="btn btn-sm ${activeFilter === 'not_covered' ? 'btn-primary' : 'btn-outline'}" onclick="SAV.setFilter('not_covered')">Non couverts (${stats.notCovered})</button>
                    <select class="input-sm" style="margin-left:8px" onchange="SAV.setTypeFilter(this.value)">
                        <option value="all" ${activeType === 'all' ? 'selected' : ''}>Tous les types</option>
                        ${PROBLEM_TYPES.map(pt => `<option value="${pt.id}" ${activeType === pt.id ? 'selected' : ''}>${pt.icon} ${pt.label}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-primary" onclick="SAV.openNewTicket()">+ Nouveau ticket SAV</button>
            </div>

            <!-- Tickets List -->
            <div class="sav-tickets-list">
                ${filtered.length === 0 ? '<div class="sav-empty">Aucun ticket SAV trouvé</div>' : ''}
                ${filtered.map(ticket => {
                    const type = PROBLEM_TYPES.find(pt => pt.id === ticket.problemType) || PROBLEM_TYPES[PROBLEM_TYPES.length - 1];
                    const status = STATUSES.find(s => s.id === ticket.status) || STATUSES[0];
                    const priority = PRIORITIES.find(p => p.id === ticket.priority) || PRIORITIES[1];
                    const daysOpen = Math.floor((new Date() - new Date(ticket.createdAt)) / (1000 * 60 * 60 * 24));
                    const deal = ticket.dealId ? Deals.getById(ticket.dealId) : null;

                    return `
                        <div class="sav-ticket-card" onclick="SAV.openTicket('${ticket.id}')">
                            <div class="sav-ticket-header">
                                <span class="sav-ticket-id">${ticket.id}</span>
                                <span class="sav-ticket-status" style="background:${status.color}20;color:${status.color}">${status.icon} ${status.label}</span>
                                <span class="sav-ticket-priority" style="color:${priority.color}">● ${priority.label}</span>
                                ${ticket.coveredByLGC
                                    ? '<span class="sav-ticket-covered">✅ Couvert LGC</span>'
                                    : '<span class="sav-ticket-not-covered">❌ Non couvert</span>'}
                            </div>
                            <div class="sav-ticket-body">
                                <div class="sav-ticket-type">${type.icon} ${type.label}</div>
                                <div class="sav-ticket-client">
                                    <strong>${ticket.clientName}</strong>
                                    ${deal ? ` — <span style="color:var(--primary);cursor:pointer" onclick="event.stopPropagation();App.openDeal('${deal.id}')">Deal #${deal.id.slice(-6)}</span>` : ''}
                                </div>
                                <div class="sav-ticket-desc">${ticket.description.substring(0, 120)}${ticket.description.length > 120 ? '...' : ''}</div>
                            </div>
                            <div class="sav-ticket-footer">
                                <span>${Deals.formatDate(ticket.createdAt)} (${daysOpen}j)</span>
                                ${ticket.assignedTo ? `<span>👤 ${ticket.assignedTo}</span>` : ''}
                                ${ticket.scheduledDate ? `<span>📅 ${Deals.formatDate(ticket.scheduledDate)}</span>` : ''}
                                <span>${ticket.notes.length} note${ticket.notes.length !== 1 ? 's' : ''}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function setFilter(filter) {
        const container = document.getElementById('sav-content');
        if (container) container.dataset.filter = filter;
        render();
    }

    function setTypeFilter(type) {
        const container = document.getElementById('sav-content');
        if (container) container.dataset.typeFilter = type;
        render();
    }

    // ===== TICKET MODAL =====
    function openNewTicket(prefill = {}) {
        let modal = document.getElementById('modal-sav');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-sav';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        const teams = (typeof Installations !== 'undefined' && Installations.getTeams) ? Installations.getTeams() : [];
        const teamMembers = Auth.getTeamMembers();
        const allDeals = Deals.getAll().filter(d => d.status === 'active' || d.status === 'won');

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-sav').classList.add('hidden')"></div>
            <div class="modal-content modal-lg" style="z-index:1">
                <div class="modal-header">
                    <h3>🔧 Nouveau ticket SAV</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-sav').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Client *</label>
                            <input type="text" id="sav-client-name" value="${prefill.clientName || ''}" placeholder="Nom du client" required>
                        </div>
                        <div class="form-group">
                            <label>Téléphone</label>
                            <input type="tel" id="sav-client-phone" value="${prefill.clientPhone || ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Courriel</label>
                            <input type="email" id="sav-client-email" value="${prefill.clientEmail || ''}">
                        </div>
                        <div class="form-group">
                            <label>Adresse</label>
                            <input type="text" id="sav-client-address" value="${prefill.clientAddress || ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Rattacher à un deal</label>
                            <select id="sav-deal-id">
                                <option value="">— Aucun —</option>
                                ${allDeals.map(d => `<option value="${d.id}" ${prefill.dealId === d.id ? 'selected' : ''}>${d.clientName} — ${Deals.getStageName(d.stage)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Priorité</label>
                            <select id="sav-priority">
                                ${PRIORITIES.map(p => `<option value="${p.id}" ${p.id === 'normal' ? 'selected' : ''}>${p.label}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Type de problème *</label>
                        <div class="sav-type-grid" id="sav-type-grid">
                            ${PROBLEM_TYPES.map(pt => `
                                <div class="sav-type-option ${prefill.problemType === pt.id ? 'selected' : ''}" data-type="${pt.id}" onclick="SAV._selectType(this)">
                                    <span style="font-size:20px">${pt.icon}</span>
                                    <span style="font-size:11px">${pt.label}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Description du problème *</label>
                        <textarea id="sav-description" rows="3" placeholder="Décrivez le problème en détail...">${prefill.description || ''}</textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Couvert par LGC (garantie)?</label>
                            <select id="sav-covered">
                                <option value="true">✅ Oui — Couvert</option>
                                <option value="false">❌ Non — Pas couvert</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Note garantie</label>
                            <input type="text" id="sav-warranty-note" placeholder="Ex: Garantie 5 ans, installé en 2024">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Assigner à (employé)</label>
                            <select id="sav-assigned-to">
                                <option value="">— Non assigné —</option>
                                ${teamMembers.map(m => `<option value="${m.name}">${m.name} (${m.role})</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Équipe d'installation</label>
                            <select id="sav-assigned-team">
                                <option value="">— Aucune —</option>
                                ${teams.map(t => `<option value="${t.name}">${t.name}${t.members ? ' — ' + t.members : ''}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Date planifiée</label>
                        <input type="date" id="sav-scheduled-date">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="document.getElementById('modal-sav').classList.add('hidden')">Annuler</button>
                    <button class="btn btn-primary" onclick="SAV.saveNewTicket()">💾 Créer le ticket</button>
                </div>
            </div>
        `;

        // Auto-fill from deal selection
        const dealSelect = modal.querySelector('#sav-deal-id');
        dealSelect?.addEventListener('change', () => {
            const deal = Deals.getById(dealSelect.value);
            if (deal) {
                const nameEl = modal.querySelector('#sav-client-name');
                const phoneEl = modal.querySelector('#sav-client-phone');
                const emailEl = modal.querySelector('#sav-client-email');
                const addrEl = modal.querySelector('#sav-client-address');
                if (nameEl && !nameEl.value) nameEl.value = deal.clientName || '';
                if (phoneEl && !phoneEl.value) phoneEl.value = deal.clientPhone || '';
                if (emailEl && !emailEl.value) emailEl.value = deal.clientEmail || '';
                if (addrEl && !addrEl.value) addrEl.value = deal.clientAddress || '';
            }
        });

        modal.classList.remove('hidden');

        // Client search autocomplete
        const clientInput = modal.querySelector('#sav-client-name');
        if (clientInput) {
            clientInput.addEventListener('input', () => {
                const q = clientInput.value.toLowerCase();
                if (q.length < 2) { document.getElementById('sav-client-suggestions')?.remove(); return; }
                const allDeals2 = Deals.getAll();
                const matches = allDeals2.filter(d => d.clientName?.toLowerCase().includes(q) || d.clientEmail?.toLowerCase().includes(q) || d.clientPhone?.includes(q)).slice(0, 5);
                let suggestions = document.getElementById('sav-client-suggestions');
                if (!suggestions) {
                    suggestions = document.createElement('div');
                    suggestions.id = 'sav-client-suggestions';
                    suggestions.style.cssText = 'position:absolute;background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);max-height:200px;overflow-y:auto;z-index:10;width:100%;box-shadow:0 4px 12px rgba(0,0,0,.1)';
                    clientInput.parentNode.style.position = 'relative';
                    clientInput.parentNode.appendChild(suggestions);
                }
                suggestions.innerHTML = matches.map(d => `
                    <div style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)"
                         onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''"
                         onclick="document.getElementById('sav-client-name').value='${(d.clientName||'').replace(/'/g, "\\'")}';document.getElementById('sav-client-phone').value='${(d.clientPhone||'').replace(/'/g, "\\'")}';document.getElementById('sav-client-email').value='${(d.clientEmail||'').replace(/'/g, "\\'")}';document.getElementById('sav-client-address').value='${(d.clientAddress||'').replace(/'/g, "\\'")}';document.getElementById('sav-deal-id').value='${d.id}';document.getElementById('sav-client-suggestions')?.remove()">
                        <strong>${d.clientName}</strong> <span style="color:var(--text-muted)">${d.clientPhone || ''} — ${Deals.getStageName(d.stage)}</span>
                    </div>
                `).join('') || '<div style="padding:8px 12px;font-size:12px;color:var(--text-muted)">Aucun client trouvé</div>';
            });
        }
    }

    function _selectType(el) {
        document.querySelectorAll('.sav-type-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
    }

    function saveNewTicket() {
        const clientName = document.getElementById('sav-client-name')?.value;
        const selectedType = document.querySelector('.sav-type-option.selected')?.dataset.type;
        const description = document.getElementById('sav-description')?.value;

        if (!clientName || !selectedType || !description) {
            App.showToast('Remplir le client, le type de problème et la description', 'error');
            return;
        }

        const ticket = createTicket({
            clientName,
            clientPhone: document.getElementById('sav-client-phone')?.value || '',
            clientEmail: document.getElementById('sav-client-email')?.value || '',
            clientAddress: document.getElementById('sav-client-address')?.value || '',
            dealId: document.getElementById('sav-deal-id')?.value || '',
            problemType: selectedType,
            description,
            priority: document.getElementById('sav-priority')?.value || 'normal',
            coveredByLGC: document.getElementById('sav-covered')?.value === 'true',
            warrantyNote: document.getElementById('sav-warranty-note')?.value || '',
            assignedTo: document.getElementById('sav-assigned-to')?.value || '',
            assignedTeam: document.getElementById('sav-assigned-team')?.value || '',
            scheduledDate: document.getElementById('sav-scheduled-date')?.value || '',
        });

        document.getElementById('modal-sav')?.classList.add('hidden');
        App.showToast(`Ticket ${ticket.id} créé!`, 'success');
        render();
    }

    // ===== TICKET DETAIL =====
    function openTicket(ticketId) {
        const ticket = getById(ticketId);
        if (!ticket) return;

        const type = PROBLEM_TYPES.find(pt => pt.id === ticket.problemType) || PROBLEM_TYPES[PROBLEM_TYPES.length - 1];
        const status = STATUSES.find(s => s.id === ticket.status) || STATUSES[0];
        const deal = ticket.dealId ? Deals.getById(ticket.dealId) : null;

        let modal = document.getElementById('modal-sav-detail');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-sav-detail';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-sav-detail').classList.add('hidden')"></div>
            <div class="modal-content modal-lg" style="z-index:1;max-height:90vh;overflow-y:auto">
                <div class="modal-header">
                    <h3>${type.icon} ${ticket.id} — ${type.label}</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-sav-detail').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    <!-- Status bar -->
                    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
                        ${STATUSES.map(s => `
                            <button class="btn btn-sm ${ticket.status === s.id ? 'btn-primary' : 'btn-outline'}"
                                onclick="SAV.changeStatus('${ticketId}','${s.id}')"
                                style="${ticket.status === s.id ? `background:${s.color};border-color:${s.color}` : ''}">
                                ${s.icon} ${s.label}
                            </button>
                        `).join('')}
                    </div>

                    <div class="form-row">
                        <div class="form-group" style="flex:1">
                            <label>Client</label>
                            <div style="font-weight:600">${ticket.clientName}</div>
                            ${ticket.clientPhone ? `<div style="font-size:13px">📞 <a href="tel:${ticket.clientPhone}">${ticket.clientPhone}</a></div>` : ''}
                            ${ticket.clientEmail ? `<div style="font-size:13px">📧 ${ticket.clientEmail}</div>` : ''}
                            ${ticket.clientAddress ? `<div style="font-size:13px">📍 ${ticket.clientAddress}</div>` : ''}
                            ${deal ? `<div style="font-size:13px;margin-top:4px"><a href="#" onclick="App.openDeal('${deal.id}');document.getElementById('modal-sav-detail').classList.add('hidden')">📋 Voir le deal — ${Deals.getStageName(deal.stage)}</a></div>` : ''}
                        </div>
                        <div class="form-group" style="flex:1">
                            <label>Détails</label>
                            <div style="font-size:13px">
                                <div>Priorité: <strong style="color:${PRIORITIES.find(p => p.id === ticket.priority)?.color || '#333'}">${PRIORITIES.find(p => p.id === ticket.priority)?.label || ticket.priority}</strong></div>
                                <div>Garantie: ${ticket.coveredByLGC ? '✅ Couvert LGC' : '❌ Non couvert'} ${ticket.warrantyNote ? `(${ticket.warrantyNote})` : ''}</div>
                                ${ticket.assignedTo ? `<div>Assigné à: ${ticket.assignedTo}</div>` : ''}
                                ${ticket.assignedTeam ? `<div>Équipe: ${ticket.assignedTeam}</div>` : ''}
                                ${ticket.scheduledDate ? `<div>Planifié: ${Deals.formatDate(ticket.scheduledDate)}</div>` : ''}
                                <div>Créé: ${Deals.formatDate(ticket.createdAt)} par ${ticket.createdBy}</div>
                                ${ticket.costParts || ticket.costLabor ? `<div>Coûts: Pièces ${Deals.formatMoney(ticket.costParts)} + Main-d'oeuvre ${Deals.formatMoney(ticket.costLabor)}</div>` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Description</label>
                        <div style="background:var(--bg);padding:12px;border-radius:var(--radius);font-size:13px;white-space:pre-wrap">${ticket.description}</div>
                    </div>

                    ${ticket.resolution ? `
                        <div class="form-group">
                            <label>Résolution</label>
                            <div style="background:var(--success-light);padding:12px;border-radius:var(--radius);font-size:13px;white-space:pre-wrap">${ticket.resolution}</div>
                        </div>
                    ` : ''}

                    <!-- Costs -->
                    <div class="form-row" style="margin-top:12px">
                        <div class="form-group">
                            <label>Coût pièces ($)</label>
                            <input type="number" id="sav-cost-parts" value="${ticket.costParts || 0}" class="input-sm" onchange="SAV.updateCosts('${ticketId}')">
                        </div>
                        <div class="form-group">
                            <label>Coût main-d'oeuvre ($)</label>
                            <input type="number" id="sav-cost-labor" value="${ticket.costLabor || 0}" class="input-sm" onchange="SAV.updateCosts('${ticketId}')">
                        </div>
                    </div>

                    <!-- Resolution -->
                    <div class="form-group" style="margin-top:12px">
                        <label>Résolution / Commentaire de fermeture</label>
                        <textarea id="sav-resolution" rows="2" placeholder="Décrire la résolution...">${ticket.resolution || ''}</textarea>
                        <button class="btn btn-sm btn-outline" style="margin-top:6px" onclick="SAV.saveResolution('${ticketId}')">Sauvegarder la résolution</button>
                    </div>

                    <!-- Estimation coût (non couvert) -->
                    ${!ticket.coveredByLGC ? `
                    <div class="form-group" style="margin-top:12px;padding:12px;background:var(--warning-light,#fff8e1);border-radius:var(--radius)">
                        <label style="color:var(--warning,#f59e0b)">💰 Estimation coût (non couvert par garantie)</label>
                        <div style="font-size:13px;margin-top:4px">
                            Total estimé: <strong>${Deals.formatMoney((ticket.costParts || 0) + (ticket.costLabor || 0))}</strong>
                            (Pièces: ${Deals.formatMoney(ticket.costParts || 0)} + Main-d'oeuvre: ${Deals.formatMoney(ticket.costLabor || 0)})
                        </div>
                    </div>
                    ` : ''}

                    <!-- Send email to client -->
                    ${ticket.clientEmail ? `
                    <div style="margin-top:12px">
                        <button class="btn btn-sm btn-outline" onclick="SAV.sendTicketEmail('${ticketId}')">📧 Envoyer courriel au client</button>
                    </div>
                    ` : ''}

                    <!-- Photos -->
                    <div class="form-group" style="margin-top:12px">
                        <label>Photos (${ticket.photos?.length || 0})</label>
                        <div id="sav-photos-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px">
                            ${(ticket.photos || []).map((p, idx) => `
                                <div style="position:relative">
                                    <img src="${p.data}" style="width:100%;height:80px;object-fit:cover;border-radius:var(--radius);cursor:pointer" onclick="window.open('${p.data}')">
                                    <button style="position:absolute;top:2px;right:2px;background:red;color:white;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:10px" onclick="SAV.removePhoto('${ticketId}',${idx})">✕</button>
                                </div>
                            `).join('')}
                        </div>
                        <input type="file" id="sav-photo-input" accept="image/*" multiple style="margin-top:8px" onchange="SAV.handlePhotoUpload('${ticketId}', this.files)">
                    </div>

                    <!-- Notes -->
                    <div class="form-group" style="margin-top:16px">
                        <label>Notes (${ticket.notes.length})</label>
                        <div style="max-height:200px;overflow-y:auto">
                            ${ticket.notes.map(n => `
                                <div style="padding:8px;border-left:3px solid var(--primary);margin-bottom:8px;background:var(--bg);border-radius:0 var(--radius) var(--radius) 0;font-size:13px">
                                    <div style="font-weight:600">${n.author} <span style="font-weight:400;color:var(--text-muted)">${Deals.formatDate(n.date)}</span></div>
                                    <div>${n.text}</div>
                                </div>
                            `).join('') || '<div style="color:var(--text-muted);font-size:13px">Aucune note</div>'}
                        </div>
                        <div style="display:flex;gap:8px;margin-top:8px">
                            <input type="text" id="sav-new-note" class="input-sm" style="flex:1" placeholder="Ajouter une note...">
                            <button class="btn btn-sm btn-primary" onclick="SAV.addNote('${ticketId}')">Ajouter</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        modal.classList.remove('hidden');
    }

    function changeStatus(ticketId, newStatus) {
        const updates = { status: newStatus };
        if (newStatus === 'resolved' || newStatus === 'closed') {
            updates.completedDate = new Date().toISOString();
        }
        updateTicket(ticketId, updates);
        App.showToast('Statut mis à jour', 'success');
        openTicket(ticketId); // Refresh detail
        render(); // Refresh list
    }

    function updateCosts(ticketId) {
        const parts = parseFloat(document.getElementById('sav-cost-parts')?.value) || 0;
        const labor = parseFloat(document.getElementById('sav-cost-labor')?.value) || 0;
        updateTicket(ticketId, { costParts: parts, costLabor: labor });
    }

    function saveResolution(ticketId) {
        const resolution = document.getElementById('sav-resolution')?.value || '';
        updateTicket(ticketId, { resolution });
        App.showToast('Résolution sauvegardée', 'success');
    }

    function addNote(ticketId) {
        const input = document.getElementById('sav-new-note');
        const text = input?.value?.trim();
        if (!text) return;
        addTicketNote(ticketId, text);
        input.value = '';
        openTicket(ticketId); // Refresh
    }

    function handlePhotoUpload(ticketId, files) {
        const ticket = getById(ticketId);
        if (!ticket) return;
        if (!ticket.photos) ticket.photos = [];

        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                // Compress
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxW = 800;
                    const scale = Math.min(1, maxW / img.width);
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    ticket.photos.push({
                        data: canvas.toDataURL('image/jpeg', 0.7),
                        name: file.name,
                        date: new Date().toISOString(),
                    });
                    saveTickets();
                    openTicket(ticketId); // refresh
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function removePhoto(ticketId, index) {
        const ticket = getById(ticketId);
        if (!ticket || !ticket.photos) return;
        ticket.photos.splice(index, 1);
        saveTickets();
        openTicket(ticketId);
    }

    function sendTicketEmail(ticketId) {
        const ticket = getById(ticketId);
        if (!ticket || !ticket.clientEmail) {
            App.showToast('Pas de courriel client pour ce ticket', 'warning');
            return;
        }
        App.openEmailCompose(null, null);
        setTimeout(() => {
            const toEl = document.getElementById('email-compose-to');
            const subEl = document.getElementById('email-compose-subject');
            const bodyEl = document.getElementById('email-compose-body');
            if (toEl) toEl.value = ticket.clientEmail;
            if (subEl) subEl.value = `Suivi de votre demande ${ticket.id} — Portes et Fenêtres LGC`;
            if (bodyEl) bodyEl.value = `Bonjour ${ticket.clientName},\n\nNous faisons suite à votre demande ${ticket.id} concernant: ${ticket.description}\n\nMerci de votre patience.`;
        }, 100);
    }

    return {
        render,
        loadTickets,
        openNewTicket,
        saveNewTicket,
        openTicket,
        changeStatus,
        updateCosts,
        saveResolution,
        addNote,
        setFilter,
        setTypeFilter,
        getStats,
        getTickets,
        _selectType,
        handlePhotoUpload,
        removePhoto,
        sendTicketEmail,
        PROBLEM_TYPES,
        STATUSES,
    };
})();
