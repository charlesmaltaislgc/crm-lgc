// ===== CRM LGC - Contacts Module =====
// Contact entity separate from deals - persons and organizations linked to multiple deals

const Contacts = (() => {
    const STORAGE_KEY = 'crm_contacts';

    const SOURCES = [
        { id: 'website', label: 'Site web' },
        { id: 'referral', label: 'Recommandation' },
        { id: 'phone', label: 'Appel entrant' },
        { id: 'walkin', label: 'Sans rendez-vous' },
        { id: 'facebook', label: 'Facebook' },
        { id: 'google', label: 'Google' },
        { id: 'shopify', label: 'Shopify' },
        { id: 'import', label: 'Import deals' },
        { id: 'mecinov', label: 'Mec-inov' },
        { id: 'avantage', label: 'Acceo Avantage' },
        { id: 'other', label: 'Autre' },
    ];

    const TAG_COLORS = [
        '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
        '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
    ];

    // ===== DATA =====
    function loadContacts() {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
    }

    function saveContacts(contacts) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
    }

    function getAll() {
        return loadContacts();
    }

    function getById(id) {
        return loadContacts().find(c => c.id === id) || null;
    }

    function save(contact) {
        const contacts = loadContacts();
        const now = new Date().toISOString();

        if (contact.id) {
            const idx = contacts.findIndex(c => c.id === contact.id);
            if (idx >= 0) {
                contacts[idx] = { ...contacts[idx], ...contact, updatedDate: now };
            } else {
                contact.createdDate = contact.createdDate || now;
                contact.updatedDate = now;
                contacts.push(contact);
            }
        } else {
            contact.id = 'CON-' + Date.now().toString(36).toUpperCase();
            contact.createdDate = now;
            contact.updatedDate = now;
            contact.linkedDealIds = contact.linkedDealIds || [];
            contact.tags = contact.tags || [];
            contact.createdBy = contact.createdBy || (Auth.getUser()?.name || 'Systeme');
            contacts.push(contact);
        }

        saveContacts(contacts);
        return contact;
    }

    function remove(id) {
        const contacts = loadContacts().filter(c => c.id !== id);
        saveContacts(contacts);
    }

    function search(query) {
        if (!query) return getAll();
        const q = query.toLowerCase();
        return getAll().filter(c =>
            (c.name && c.name.toLowerCase().includes(q)) ||
            (c.email && c.email.toLowerCase().includes(q)) ||
            (c.email2 && c.email2.toLowerCase().includes(q)) ||
            (c.phone && c.phone.includes(q)) ||
            (c.phone2 && c.phone2.includes(q)) ||
            (c.organization && c.organization.toLowerCase().includes(q)) ||
            (c.tags && c.tags.some(t => t.toLowerCase().includes(q))) ||
            (c.city && c.city.toLowerCase().includes(q))
        );
    }

    function getForDeal(dealId) {
        return getAll().filter(c => c.linkedDealIds && c.linkedDealIds.includes(dealId));
    }

    function linkToDeal(contactId, dealId) {
        const contacts = loadContacts();
        const idx = contacts.findIndex(c => c.id === contactId);
        if (idx === -1) return;
        if (!contacts[idx].linkedDealIds) contacts[idx].linkedDealIds = [];
        if (!contacts[idx].linkedDealIds.includes(dealId)) {
            contacts[idx].linkedDealIds.push(dealId);
            contacts[idx].updatedDate = new Date().toISOString();
            saveContacts(contacts);
        }
    }

    function unlinkFromDeal(contactId, dealId) {
        const contacts = loadContacts();
        const idx = contacts.findIndex(c => c.id === contactId);
        if (idx === -1) return;
        if (!contacts[idx].linkedDealIds) return;
        contacts[idx].linkedDealIds = contacts[idx].linkedDealIds.filter(id => id !== dealId);
        contacts[idx].updatedDate = new Date().toISOString();
        saveContacts(contacts);
    }

    function getDealsForContact(contactId) {
        const contact = getById(contactId);
        if (!contact || !contact.linkedDealIds) return [];
        return contact.linkedDealIds
            .map(id => Deals.getById(id))
            .filter(Boolean);
    }

    function importFromDeals() {
        const deals = Deals.getAll();
        const contacts = loadContacts();
        let imported = 0;

        deals.forEach(deal => {
            if (!deal.clientName) return;

            // Check if contact with same name+email already exists
            const existing = contacts.find(c =>
                c.name.toLowerCase() === deal.clientName.toLowerCase() ||
                (deal.clientEmail && c.email && c.email.toLowerCase() === deal.clientEmail.toLowerCase())
            );

            if (existing) {
                // Link deal if not already linked
                if (!existing.linkedDealIds) existing.linkedDealIds = [];
                if (!existing.linkedDealIds.includes(deal.id)) {
                    existing.linkedDealIds.push(deal.id);
                    existing.updatedDate = new Date().toISOString();
                }
            } else {
                const now = new Date().toISOString();
                contacts.push({
                    id: 'CON-' + Date.now().toString(36).toUpperCase() + '-' + imported,
                    type: 'person',
                    name: deal.clientName,
                    email: deal.clientEmail || '',
                    email2: '',
                    phone: deal.clientPhone || '',
                    phone2: '',
                    address: deal.address || '',
                    city: deal.city || '',
                    postalCode: '',
                    organization: deal.company || '',
                    notes: '',
                    tags: [],
                    source: 'import',
                    createdDate: now,
                    updatedDate: now,
                    createdBy: 'Import automatique',
                    linkedDealIds: [deal.id],
                });
                imported++;
            }
        });

        saveContacts(contacts);
        return imported;
    }

    function getStats() {
        const contacts = getAll();
        const persons = contacts.filter(c => c.type === 'person').length;
        const organizations = contacts.filter(c => c.type === 'organization').length;
        const bySrc = {};
        SOURCES.forEach(s => bySrc[s.id] = 0);
        contacts.forEach(c => {
            if (c.source && bySrc[c.source] !== undefined) bySrc[c.source]++;
        });
        return {
            total: contacts.length,
            persons,
            organizations,
            bySource: bySrc,
        };
    }

    function getInitials(name) {
        if (!name) return '??';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }

    function getTagColor(tag) {
        let hash = 0;
        for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
        return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
    }

    // ===== DUPLICATE DETECTION =====
    function findDuplicates() {
        const contacts = getAll();
        const dupes = [];
        for (let i = 0; i < contacts.length; i++) {
            for (let j = i + 1; j < contacts.length; j++) {
                const a = contacts[i];
                const b = contacts[j];
                let reason = '';
                if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
                    reason = 'Meme courriel: ' + a.email;
                } else if (a.name && b.name && a.name.toLowerCase() === b.name.toLowerCase()) {
                    reason = 'Meme nom';
                } else if (a.phone && b.phone && a.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, '') && a.phone.replace(/\D/g, '').length >= 7) {
                    reason = 'Meme telephone';
                } else if (a.name && b.name && levenshteinSimilar(a.name.toLowerCase(), b.name.toLowerCase())) {
                    reason = 'Noms similaires';
                }
                if (reason) {
                    dupes.push({ a, b, reason });
                }
            }
        }
        return dupes;
    }

    function levenshteinSimilar(s1, s2) {
        if (s1.length < 3 || s2.length < 3) return false;
        const len = Math.max(s1.length, s2.length);
        let dist = 0;
        const matrix = [];
        for (let i = 0; i <= s1.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= s2.length; j++) { matrix[0][j] = j; }
        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                const cost = s1[i-1] === s2[j-1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i-1][j] + 1,
                    matrix[i][j-1] + 1,
                    matrix[i-1][j-1] + cost
                );
            }
        }
        dist = matrix[s1.length][s2.length];
        return (dist / len) < 0.25; // 75% similar
    }

    function mergeContacts(keepId, removeId) {
        const contacts = loadContacts();
        const keepIdx = contacts.findIndex(c => c.id === keepId);
        const removeIdx = contacts.findIndex(c => c.id === removeId);
        if (keepIdx === -1 || removeIdx === -1) return;

        const keep = contacts[keepIdx];
        const rem = contacts[removeIdx];

        // Merge missing fields
        if (!keep.email && rem.email) keep.email = rem.email;
        if (!keep.email2 && rem.email2) keep.email2 = rem.email2;
        if (!keep.phone && rem.phone) keep.phone = rem.phone;
        if (!keep.phone2 && rem.phone2) keep.phone2 = rem.phone2;
        if (!keep.address && rem.address) keep.address = rem.address;
        if (!keep.city && rem.city) keep.city = rem.city;
        if (!keep.organization && rem.organization) keep.organization = rem.organization;
        if (!keep.notes && rem.notes) keep.notes = rem.notes;

        // Merge tags
        if (rem.tags) {
            if (!keep.tags) keep.tags = [];
            rem.tags.forEach(t => { if (!keep.tags.includes(t)) keep.tags.push(t); });
        }

        // Merge linked deals
        if (rem.linkedDealIds) {
            if (!keep.linkedDealIds) keep.linkedDealIds = [];
            rem.linkedDealIds.forEach(id => { if (!keep.linkedDealIds.includes(id)) keep.linkedDealIds.push(id); });
        }

        keep.updatedDate = new Date().toISOString();
        contacts[keepIdx] = keep;
        contacts.splice(removeIdx, 1);
        saveContacts(contacts);
    }

    // ===== RENDER =====
    let currentFilter = { search: '', type: 'all', source: 'all' };
    let currentTab = 'info'; // for detail modal

    function render() {
        const container = document.getElementById('contacts-content');
        if (!container) return;

        const allContacts = getAll();
        const stats = getStats();

        // Apply filters
        let filtered = allContacts;
        if (currentFilter.search) {
            filtered = search(currentFilter.search);
        }
        if (currentFilter.type !== 'all') {
            filtered = filtered.filter(c => c.type === currentFilter.type);
        }
        if (currentFilter.source !== 'all') {
            filtered = filtered.filter(c => c.source === currentFilter.source);
        }

        // Sort by name
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        container.innerHTML = `
            <div style="padding:20px;">
                <!-- Toolbar -->
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
                    <input type="text" class="input-sm" placeholder="Rechercher un contact..." value="${currentFilter.search}"
                        oninput="Contacts.setFilter('search', this.value)"
                        style="flex:1;min-width:200px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;">
                    <select class="input-sm" onchange="Contacts.setFilter('type', this.value)" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;">
                        <option value="all" ${currentFilter.type === 'all' ? 'selected' : ''}>Tous les types</option>
                        <option value="person" ${currentFilter.type === 'person' ? 'selected' : ''}>Personnes</option>
                        <option value="organization" ${currentFilter.type === 'organization' ? 'selected' : ''}>Organisations</option>
                    </select>
                    <select class="input-sm" onchange="Contacts.setFilter('source', this.value)" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;">
                        <option value="all" ${currentFilter.source === 'all' ? 'selected' : ''}>Toutes les sources</option>
                        ${SOURCES.map(s => `<option value="${s.id}" ${currentFilter.source === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
                    </select>
                    <button class="btn btn-primary btn-sm" onclick="Contacts.showCreateForm()">+ Nouveau contact</button>
                    <button class="btn btn-outline btn-sm" onclick="Contacts.doImportFromDeals()">Importer depuis les deals</button>
                    <button class="btn btn-outline btn-sm" onclick="Contacts.showDuplicates()" style="color:#f59e0b;">Fusionner les doublons</button>
                </div>

                <!-- Stats bar -->
                <div style="display:flex;gap:16px;margin-bottom:16px;">
                    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 18px;text-align:center;">
                        <div style="font-size:22px;font-weight:700;color:#0369a1;">${stats.total}</div>
                        <div style="font-size:12px;color:#64748b;">Total contacts</div>
                    </div>
                    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 18px;text-align:center;">
                        <div style="font-size:22px;font-weight:700;color:#15803d;">${stats.persons}</div>
                        <div style="font-size:12px;color:#64748b;">Personnes</div>
                    </div>
                    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px 18px;text-align:center;">
                        <div style="font-size:22px;font-weight:700;color:#a16207;">${stats.organizations}</div>
                        <div style="font-size:12px;color:#64748b;">Organisations</div>
                    </div>
                </div>

                <!-- Table -->
                <div style="background:white;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                    <table style="width:100%;border-collapse:collapse;font-size:14px;">
                        <thead>
                            <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                                <th style="text-align:left;padding:10px 14px;font-weight:600;color:#374151;">Nom</th>
                                <th style="text-align:left;padding:10px 14px;font-weight:600;color:#374151;">Organisation</th>
                                <th style="text-align:left;padding:10px 14px;font-weight:600;color:#374151;">Courriel</th>
                                <th style="text-align:left;padding:10px 14px;font-weight:600;color:#374151;">Telephone</th>
                                <th style="text-align:center;padding:10px 14px;font-weight:600;color:#374151;">Deals</th>
                                <th style="text-align:left;padding:10px 14px;font-weight:600;color:#374151;">Derniere activite</th>
                                <th style="text-align:center;padding:10px 14px;font-weight:600;color:#374151;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.length === 0 ? `
                                <tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af;">Aucun contact trouve. Cliquez "Nouveau contact" ou "Importer depuis les deals".</td></tr>
                            ` : filtered.map(c => renderContactRow(c)).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:8px;color:#9ca3af;font-size:12px;">${filtered.length} contact${filtered.length !== 1 ? 's' : ''} affiche${filtered.length !== 1 ? 's' : ''}</div>
            </div>
        `;
    }

    function renderContactRow(c) {
        const initials = getInitials(c.name);
        const dealCount = (c.linkedDealIds || []).length;
        const avatarBg = c.type === 'organization' ? '#f59e0b' : '#3b82f6';
        const avatarIcon = c.type === 'organization' ? 'ORG' : initials;
        const lastActivity = c.updatedDate ? Deals.formatDate(c.updatedDate) : '--';
        const tags = (c.tags || []).map(t =>
            `<span style="display:inline-block;background:${getTagColor(t)};color:white;padding:1px 7px;border-radius:10px;font-size:11px;margin-right:3px;">${t}</span>`
        ).join('');

        return `
            <tr style="border-bottom:1px solid #f3f4f6;cursor:pointer;transition:background 0.15s;"
                onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''"
                onclick="Contacts.showDetail('${c.id}')">
                <td style="padding:10px 14px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:36px;height:36px;border-radius:50%;background:${avatarBg};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">
                            ${avatarIcon}
                        </div>
                        <div>
                            <div style="font-weight:600;color:#111827;">${c.name || '--'}</div>
                            ${tags}
                        </div>
                    </div>
                </td>
                <td style="padding:10px 14px;color:#6b7280;">${c.organization || '--'}</td>
                <td style="padding:10px 14px;color:#6b7280;">${c.email || '--'}</td>
                <td style="padding:10px 14px;color:#6b7280;">${c.phone || '--'}</td>
                <td style="padding:10px 14px;text-align:center;">
                    ${dealCount > 0 ? `<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;">${dealCount}</span>` : '<span style="color:#d1d5db;">0</span>'}
                </td>
                <td style="padding:10px 14px;color:#9ca3af;font-size:13px;">${lastActivity}</td>
                <td style="padding:10px 14px;text-align:center;">
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();Contacts.showDetail('${c.id}')" title="Voir">Voir</button>
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();Contacts.confirmRemove('${c.id}')" title="Supprimer" style="color:#ef4444;border-color:#fca5a5;">X</button>
                </td>
            </tr>
        `;
    }

    // ===== DETAIL MODAL =====
    function showDetail(contactId) {
        const contact = getById(contactId);
        if (!contact) return;

        let modal = document.getElementById('modal-contacts');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-contacts';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        const deals = getDealsForContact(contactId);
        const activities = (typeof Activities !== 'undefined' && Activities.getForContact) ? Activities.getForContact(contactId) : [];

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-contacts').classList.add('hidden')"></div>
            <div class="modal-content" style="z-index:1;max-width:700px;max-height:90vh;overflow-y:auto;">
                <div class="modal-header" style="display:flex;align-items:center;gap:12px;">
                    <div style="width:48px;height:48px;border-radius:50%;background:${contact.type === 'organization' ? '#f59e0b' : '#3b82f6'};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;">
                        ${getInitials(contact.name)}
                    </div>
                    <div style="flex:1;">
                        <h3 style="margin:0;">${contact.name || 'Sans nom'}</h3>
                        <div style="font-size:13px;color:#6b7280;">${contact.type === 'organization' ? 'Organisation' : 'Personne'}${contact.organization ? ' - ' + contact.organization : ''}</div>
                    </div>
                    <button class="modal-close" onclick="document.getElementById('modal-contacts').classList.add('hidden')">&times;</button>
                </div>
                <!-- Tabs -->
                <div style="display:flex;border-bottom:2px solid #e5e7eb;margin:0 -20px;padding:0 20px;">
                    ${['info', 'deals', 'notes', 'historique'].map(tab => `
                        <button onclick="Contacts.switchTab('${tab}','${contactId}')"
                            style="padding:10px 20px;border:none;background:none;cursor:pointer;font-size:14px;font-weight:${currentTab === tab ? '600' : '400'};
                            color:${currentTab === tab ? '#2563eb' : '#6b7280'};border-bottom:${currentTab === tab ? '2px solid #2563eb' : '2px solid transparent'};margin-bottom:-2px;">
                            ${{info:'Infos',deals:'Deals',notes:'Notes',historique:'Historique'}[tab]}
                        </button>
                    `).join('')}
                </div>
                <div class="modal-body" style="padding:20px;">
                    ${renderDetailTab(contact, deals, activities)}
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function switchTab(tab, contactId) {
        currentTab = tab;
        showDetail(contactId);
    }

    function renderDetailTab(contact, deals, activities) {
        switch (currentTab) {
            case 'info': return renderInfoTab(contact);
            case 'deals': return renderDealsTab(contact, deals);
            case 'notes': return renderNotesTab(contact);
            case 'historique': return renderHistoriqueTab(contact, activities);
            default: return renderInfoTab(contact);
        }
    }

    function renderInfoTab(contact) {
        const tagList = (contact.tags || []).map(t =>
            `<span style="display:inline-block;background:${getTagColor(t)};color:white;padding:3px 10px;border-radius:12px;font-size:12px;margin:2px 4px 2px 0;">${t} <span style="cursor:pointer;margin-left:4px;" onclick="Contacts.removeTag('${contact.id}','${t}')">&times;</span></span>`
        ).join('');

        return `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group"><label>Type</label>
                    <select id="ct-type" class="input-sm" style="width:100%;">
                        <option value="person" ${contact.type === 'person' ? 'selected' : ''}>Personne</option>
                        <option value="organization" ${contact.type === 'organization' ? 'selected' : ''}>Organisation</option>
                    </select>
                </div>
                <div class="form-group"><label>Nom</label><input type="text" id="ct-name" value="${contact.name || ''}" class="input-sm" style="width:100%;"></div>
                <div class="form-group"><label>Courriel</label><input type="email" id="ct-email" value="${contact.email || ''}" class="input-sm" style="width:100%;"></div>
                <div class="form-group"><label>Courriel 2</label><input type="email" id="ct-email2" value="${contact.email2 || ''}" class="input-sm" style="width:100%;"></div>
                <div class="form-group"><label>Telephone</label><input type="tel" id="ct-phone" value="${contact.phone || ''}" class="input-sm" style="width:100%;" placeholder="(418) 555-0000"></div>
                <div class="form-group"><label>Telephone 2</label><input type="tel" id="ct-phone2" value="${contact.phone2 || ''}" class="input-sm" style="width:100%;" placeholder="(418) 555-0000"></div>
                <div class="form-group"><label>Organisation</label><input type="text" id="ct-org" value="${contact.organization || ''}" class="input-sm" style="width:100%;"></div>
                <div class="form-group"><label>Source</label>
                    <select id="ct-source" class="input-sm" style="width:100%;">
                        <option value="">--</option>
                        ${SOURCES.map(s => `<option value="${s.id}" ${contact.source === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Adresse</label><input type="text" id="ct-address" value="${contact.address || ''}" class="input-sm" style="width:100%;"></div>
                <div class="form-group"><label>Ville</label><input type="text" id="ct-city" value="${contact.city || ''}" class="input-sm" style="width:100%;"></div>
                <div class="form-group"><label>Code postal</label><input type="text" id="ct-postal" value="${contact.postalCode || ''}" class="input-sm" style="width:100%;"></div>
            </div>
            <div class="form-group" style="margin-top:12px;">
                <label>Tags</label>
                <div style="margin-bottom:6px;">${tagList || '<span style="color:#9ca3af;">Aucun tag</span>'}</div>
                <div style="display:flex;gap:6px;">
                    <input type="text" id="ct-new-tag" class="input-sm" placeholder="Ajouter un tag..." style="flex:1;">
                    <button class="btn btn-sm btn-outline" onclick="Contacts.addTag('${contact.id}')">Ajouter</button>
                </div>
            </div>
            <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn btn-outline" onclick="document.getElementById('modal-contacts').classList.add('hidden')">Annuler</button>
                <button class="btn btn-primary" onclick="Contacts.saveFromDetail('${contact.id}')">Sauvegarder</button>
            </div>
        `;
    }

    function renderDealsTab(contact, deals) {
        if (deals.length === 0) {
            return `
                <div style="text-align:center;padding:30px;color:#9ca3af;">
                    <p>Aucun deal lie a ce contact.</p>
                    <button class="btn btn-sm btn-primary" onclick="Contacts.showLinkDealForm('${contact.id}')">Lier un deal</button>
                </div>
            `;
        }
        return `
            <div style="margin-bottom:12px;">
                <button class="btn btn-sm btn-primary" onclick="Contacts.showLinkDealForm('${contact.id}')">+ Lier un deal</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${deals.map(d => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;">
                        <div style="width:10px;height:10px;border-radius:50%;background:${Deals.getStageColor(d.stage)};flex-shrink:0;"></div>
                        <div style="flex:1;">
                            <div style="font-weight:600;color:#111827;">${d.clientName || '--'}</div>
                            <div style="font-size:12px;color:#6b7280;">${Deals.getStageName(d.stage)} - ${Deals.formatMoney(d.quoteAmount || d.contractAmount)}</div>
                        </div>
                        <div style="font-size:12px;color:#9ca3af;">${Deals.formatDate(d.createdAt)}</div>
                        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();Contacts.unlinkDeal('${contact.id}','${d.id}')" style="color:#ef4444;" title="Delier">X</button>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderNotesTab(contact) {
        return `
            <div class="form-group">
                <label>Notes</label>
                <textarea id="ct-notes" rows="8" class="input-sm" style="width:100%;resize:vertical;">${contact.notes || ''}</textarea>
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:10px;">
                <button class="btn btn-primary btn-sm" onclick="Contacts.saveNotes('${contact.id}')">Sauvegarder les notes</button>
            </div>
        `;
    }

    function renderHistoriqueTab(contact, activities) {
        if (activities.length === 0) {
            return `<div style="text-align:center;padding:30px;color:#9ca3af;">Aucune activite enregistree pour ce contact.</div>`;
        }
        const typeIcons = { call: '\uD83D\uDCDE', meeting: '\uD83D\uDCC5', task: '\u2705', email: '\uD83D\uDCE7', deadline: '\u23F0' };
        return `
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${activities.sort((a, b) => new Date(b.createdDate || b.dueDate) - new Date(a.createdDate || a.dueDate)).map(a => `
                    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;border-left:3px solid ${a.done ? '#22c55e' : '#3b82f6'};background:#f9fafb;border-radius:0 6px 6px 0;">
                        <span style="font-size:18px;">${typeIcons[a.type] || '\uD83D\uDCC5'}</span>
                        <div style="flex:1;">
                            <div style="font-weight:600;${a.done ? 'text-decoration:line-through;color:#9ca3af;' : ''}">${a.subject || '--'}</div>
                            <div style="font-size:12px;color:#6b7280;">${Deals.formatDate(a.dueDate)} ${a.dueTime || ''}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ===== ACTIONS =====
    function setFilter(key, value) {
        currentFilter[key] = value;
        render();
    }

    function saveFromDetail(contactId) {
        save({
            id: contactId,
            type: document.getElementById('ct-type')?.value || 'person',
            name: document.getElementById('ct-name')?.value || '',
            email: document.getElementById('ct-email')?.value || '',
            email2: document.getElementById('ct-email2')?.value || '',
            phone: document.getElementById('ct-phone')?.value || '',
            phone2: document.getElementById('ct-phone2')?.value || '',
            organization: document.getElementById('ct-org')?.value || '',
            source: document.getElementById('ct-source')?.value || '',
            address: document.getElementById('ct-address')?.value || '',
            city: document.getElementById('ct-city')?.value || '',
            postalCode: document.getElementById('ct-postal')?.value || '',
        });
        App.showToast('Contact sauvegarde', 'success');
        document.getElementById('modal-contacts')?.classList.add('hidden');
        render();
    }

    function saveNotes(contactId) {
        const notes = document.getElementById('ct-notes')?.value || '';
        save({ id: contactId, notes });
        App.showToast('Notes sauvegardees', 'success');
    }

    function addTag(contactId) {
        const input = document.getElementById('ct-new-tag');
        const tag = (input?.value || '').trim();
        if (!tag) return;
        const contact = getById(contactId);
        if (!contact) return;
        if (!contact.tags) contact.tags = [];
        if (!contact.tags.includes(tag)) {
            contact.tags.push(tag);
            save(contact);
        }
        showDetail(contactId);
    }

    function removeTag(contactId, tag) {
        const contact = getById(contactId);
        if (!contact || !contact.tags) return;
        contact.tags = contact.tags.filter(t => t !== tag);
        save(contact);
        showDetail(contactId);
    }

    function confirmRemove(id) {
        const contact = getById(id);
        if (!contact) return;
        if (confirm(`Supprimer le contact "${contact.name}" ?`)) {
            remove(id);
            App.showToast('Contact supprime', 'success');
            render();
        }
    }

    function unlinkDeal(contactId, dealId) {
        unlinkFromDeal(contactId, dealId);
        App.showToast('Deal delie', 'success');
        showDetail(contactId);
    }

    // ===== CREATE FORM =====
    function showCreateForm() {
        let modal = document.getElementById('modal-contacts');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-contacts';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-contacts').classList.add('hidden')"></div>
            <div class="modal-content" style="z-index:1;max-width:550px;">
                <div class="modal-header">
                    <h3>Nouveau contact</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-contacts').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group"><label>Type</label>
                            <select id="ct-new-type" class="input-sm" style="width:100%;">
                                <option value="person">Personne</option>
                                <option value="organization">Organisation</option>
                            </select>
                        </div>
                        <div class="form-group"><label>Nom *</label><input type="text" id="ct-new-name" class="input-sm" style="width:100%;" placeholder="Nom complet"></div>
                        <div class="form-group"><label>Courriel</label><input type="email" id="ct-new-email" class="input-sm" style="width:100%;"></div>
                        <div class="form-group"><label>Telephone</label><input type="tel" id="ct-new-phone" class="input-sm" style="width:100%;" placeholder="(418) 555-0000"></div>
                        <div class="form-group"><label>Organisation</label><input type="text" id="ct-new-org" class="input-sm" style="width:100%;"></div>
                        <div class="form-group"><label>Source</label>
                            <select id="ct-new-source" class="input-sm" style="width:100%;">
                                <option value="">--</option>
                                ${SOURCES.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group"><label>Ville</label><input type="text" id="ct-new-city" class="input-sm" style="width:100%;"></div>
                        <div class="form-group"><label>Adresse</label><input type="text" id="ct-new-address" class="input-sm" style="width:100%;"></div>
                    </div>
                </div>
                <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-outline" onclick="document.getElementById('modal-contacts').classList.add('hidden')">Annuler</button>
                    <button class="btn btn-primary" onclick="Contacts.doCreate()">Creer le contact</button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function doCreate() {
        const name = document.getElementById('ct-new-name')?.value?.trim();
        if (!name) { App.showToast('Le nom est requis', 'error'); return; }

        const contact = save({
            type: document.getElementById('ct-new-type')?.value || 'person',
            name,
            email: document.getElementById('ct-new-email')?.value || '',
            email2: '',
            phone: document.getElementById('ct-new-phone')?.value || '',
            phone2: '',
            organization: document.getElementById('ct-new-org')?.value || '',
            source: document.getElementById('ct-new-source')?.value || '',
            address: document.getElementById('ct-new-address')?.value || '',
            city: document.getElementById('ct-new-city')?.value || '',
            postalCode: '',
            notes: '',
            tags: [],
            linkedDealIds: [],
        });

        document.getElementById('modal-contacts')?.classList.add('hidden');
        App.showToast('Contact cree', 'success');
        render();
    }

    function doImportFromDeals() {
        const count = importFromDeals();
        App.showToast(`${count} contact${count !== 1 ? 's' : ''} importe${count !== 1 ? 's' : ''} depuis les deals`, 'success');
        render();
    }

    // ===== LINK DEAL FORM =====
    function showLinkDealForm(contactId) {
        const allDeals = Deals.getAll();
        const contact = getById(contactId);
        if (!contact) return;
        const linkedIds = contact.linkedDealIds || [];

        const availableDeals = allDeals.filter(d => !linkedIds.includes(d.id));

        let html = `<div style="padding:12px;">
            <h4 style="margin:0 0 12px;">Lier un deal au contact</h4>
            <input type="text" id="ct-deal-search" class="input-sm" placeholder="Rechercher un deal..."
                style="width:100%;margin-bottom:10px;" oninput="Contacts.filterLinkDeals('${contactId}')">
            <div id="ct-deal-list" style="max-height:250px;overflow-y:auto;">
                ${availableDeals.slice(0, 20).map(d => `
                    <div style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #f3f4f6;cursor:pointer;"
                        onclick="Contacts.doLinkDeal('${contactId}','${d.id}')">
                        <div style="width:8px;height:8px;border-radius:50%;background:${Deals.getStageColor(d.stage)};"></div>
                        <div style="flex:1;">
                            <div style="font-weight:600;">${d.clientName}</div>
                            <div style="font-size:12px;color:#6b7280;">${Deals.getStageName(d.stage)} - ${Deals.formatMoney(d.quoteAmount || d.contractAmount)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;

        // Reuse the modal-body portion
        const body = document.querySelector('#modal-contacts .modal-body');
        if (body) body.innerHTML = html;
    }

    function doLinkDeal(contactId, dealId) {
        linkToDeal(contactId, dealId);
        App.showToast('Deal lie au contact', 'success');
        currentTab = 'deals';
        showDetail(contactId);
    }

    function filterLinkDeals(contactId) {
        // Lightweight re-filter for link deal form
        const q = (document.getElementById('ct-deal-search')?.value || '').toLowerCase();
        const contact = getById(contactId);
        const linkedIds = (contact?.linkedDealIds) || [];
        const allDeals = Deals.getAll().filter(d => !linkedIds.includes(d.id));
        const filtered = q ? allDeals.filter(d => (d.clientName || '').toLowerCase().includes(q)) : allDeals;
        const listEl = document.getElementById('ct-deal-list');
        if (!listEl) return;
        listEl.innerHTML = filtered.slice(0, 20).map(d => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #f3f4f6;cursor:pointer;"
                onclick="Contacts.doLinkDeal('${contactId}','${d.id}')">
                <div style="width:8px;height:8px;border-radius:50%;background:${Deals.getStageColor(d.stage)};"></div>
                <div style="flex:1;">
                    <div style="font-weight:600;">${d.clientName}</div>
                    <div style="font-size:12px;color:#6b7280;">${Deals.getStageName(d.stage)} - ${Deals.formatMoney(d.quoteAmount || d.contractAmount)}</div>
                </div>
            </div>
        `).join('');
    }

    // ===== DUPLICATES =====
    function showDuplicates() {
        const dupes = findDuplicates();

        let modal = document.getElementById('modal-contacts');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-contacts';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-contacts').classList.add('hidden')"></div>
            <div class="modal-content" style="z-index:1;max-width:650px;max-height:85vh;overflow-y:auto;">
                <div class="modal-header">
                    <h3>Fusionner les doublons</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-contacts').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    ${dupes.length === 0 ? `
                        <div style="text-align:center;padding:30px;color:#22c55e;font-weight:600;">Aucun doublon detecte !</div>
                    ` : `
                        <p style="color:#6b7280;margin-bottom:16px;">${dupes.length} doublon${dupes.length > 1 ? 's' : ''} detecte${dupes.length > 1 ? 's' : ''}:</p>
                        ${dupes.map((d, idx) => `
                            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:12px;">
                                <div style="font-size:12px;color:#f59e0b;font-weight:600;margin-bottom:8px;">Raison: ${d.reason}</div>
                                <div style="display:flex;gap:12px;align-items:center;">
                                    <div style="flex:1;background:#f0f9ff;padding:8px;border-radius:6px;">
                                        <div style="font-weight:600;">${d.a.name}</div>
                                        <div style="font-size:12px;color:#6b7280;">${d.a.email || ''} ${d.a.phone || ''}</div>
                                    </div>
                                    <div style="color:#9ca3af;">vs</div>
                                    <div style="flex:1;background:#fefce8;padding:8px;border-radius:6px;">
                                        <div style="font-weight:600;">${d.b.name}</div>
                                        <div style="font-size:12px;color:#6b7280;">${d.b.email || ''} ${d.b.phone || ''}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">
                                    <button class="btn btn-sm btn-primary" onclick="Contacts.doMerge('${d.a.id}','${d.b.id}')">Garder "${d.a.name}"</button>
                                    <button class="btn btn-sm btn-outline" onclick="Contacts.doMerge('${d.b.id}','${d.a.id}')">Garder "${d.b.name}"</button>
                                </div>
                            </div>
                        `).join('')}
                    `}
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function doMerge(keepId, removeId) {
        mergeContacts(keepId, removeId);
        App.showToast('Contacts fusionnes', 'success');
        showDuplicates(); // Refresh
    }

    // ===== CONTACT SELECT FOR DEALS =====
    function renderContactSelect(dealId) {
        const allContacts = getAll();
        const linked = getForDeal(dealId);
        const linkedIds = linked.map(c => c.id);

        return `
            <div style="margin-top:10px;">
                <label style="font-weight:600;font-size:13px;color:#374151;">Contacts lies</label>
                <div style="margin:6px 0;">
                    ${linked.length > 0 ? linked.map(c => `
                        <div style="display:inline-flex;align-items:center;gap:6px;background:#dbeafe;padding:4px 10px;border-radius:14px;margin:2px;font-size:13px;">
                            <span style="font-weight:600;">${c.name}</span>
                            <span style="cursor:pointer;color:#ef4444;" onclick="Contacts.unlinkFromDeal('${c.id}','${dealId}');this.closest('div').remove();">&times;</span>
                        </div>
                    `).join('') : '<span style="color:#9ca3af;font-size:13px;">Aucun contact lie</span>'}
                </div>
                <div style="display:flex;gap:6px;margin-top:6px;">
                    <select id="ct-select-${dealId}" class="input-sm" style="flex:1;">
                        <option value="">-- Lier un contact --</option>
                        ${allContacts.filter(c => !linkedIds.includes(c.id)).map(c => `<option value="${c.id}">${c.name}${c.organization ? ' (' + c.organization + ')' : ''}</option>`).join('')}
                    </select>
                    <button class="btn btn-sm btn-primary" onclick="Contacts.doLinkFromSelect('${dealId}')">Lier</button>
                    <button class="btn btn-sm btn-outline" onclick="Contacts.showCreateForm()">Nouveau</button>
                </div>
            </div>
        `;
    }

    function doLinkFromSelect(dealId) {
        const select = document.getElementById('ct-select-' + dealId);
        if (!select || !select.value) return;
        linkToDeal(select.value, dealId);
        App.showToast('Contact lie au deal', 'success');
        // Refresh if possible
        if (typeof Pipeline !== 'undefined' && Pipeline.render) {
            Pipeline.render();
        }
    }

    return {
        getAll,
        getById,
        save,
        remove,
        search,
        getForDeal,
        linkToDeal,
        unlinkFromDeal,
        getDealsForContact,
        importFromDeals,
        render,
        renderContactSelect,
        getStats,
        // UI actions
        setFilter,
        showDetail,
        switchTab,
        showCreateForm,
        doCreate,
        doImportFromDeals,
        saveFromDetail,
        saveNotes,
        addTag,
        removeTag,
        confirmRemove,
        unlinkDeal,
        showLinkDealForm,
        doLinkDeal,
        filterLinkDeals,
        showDuplicates,
        doMerge,
        doLinkFromSelect,
    };
})();
