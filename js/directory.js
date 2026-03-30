// ===== CRM LGC - Répertoire des contacts (Employés + Installateurs) =====

const Directory = (() => {
    const STORAGE_KEY = 'crm_directory';

    function getContacts() {
        // Merge team members from Auth + install teams + custom directory
        const team = Auth.getTeamMembers();
        const installTeams = (typeof Installations !== 'undefined' && Installations.getTeams) ? Installations.getTeams() : [];
        const custom = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

        const contacts = [];

        // Office team
        team.forEach(m => {
            contacts.push({
                id: m.id || m.email,
                name: m.name,
                email: m.email,
                emails: m.emails || [],
                phone: m.phone || '',
                phone2: m.phone2 || '',
                role: m.role,
                department: 'bureau',
                initials: m.initials || (m.name || '??').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
            });
        });

        // Install teams
        installTeams.forEach(t => {
            if (t.members) {
                const members = t.members.split(',').map(s => s.trim()).filter(Boolean);
                members.forEach((name, idx) => {
                    const existingIdx = contacts.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
                    if (existingIdx === -1) {
                        contacts.push({
                            id: `inst-${t.id}-${idx}`,
                            name: name,
                            email: '',
                            phone: '',
                            role: 'installateur',
                            department: 'installation',
                            team: t.name,
                            teamColor: t.color || '#3b82f6',
                            initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
                        });
                    } else {
                        contacts[existingIdx].team = t.name;
                        contacts[existingIdx].teamColor = t.color || '#3b82f6';
                        if (!contacts[existingIdx].department.includes('installation')) {
                            contacts[existingIdx].department += ', installation';
                        }
                    }
                });
            }
        });

        // Custom contacts
        custom.forEach(c => {
            const existingIdx = contacts.findIndex(ex => ex.id === c.id);
            if (existingIdx >= 0) {
                // Merge phone/details from custom into existing
                if (c.phone) contacts[existingIdx].phone = c.phone;
                if (c.phone2) contacts[existingIdx].phone2 = c.phone2;
                if (c.email && !contacts[existingIdx].email) contacts[existingIdx].email = c.email;
                if (c.notes) contacts[existingIdx].notes = c.notes;
            } else {
                contacts.push(c);
            }
        });

        return contacts;
    }

    function saveContact(contact) {
        const custom = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const idx = custom.findIndex(c => c.id === contact.id);
        if (idx >= 0) {
            custom[idx] = { ...custom[idx], ...contact };
        } else {
            custom.push(contact);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    }

    function render() {
        const container = document.getElementById('directory-content');
        if (!container) return;

        const contacts = getContacts();
        const search = container.dataset.search || '';
        const filterDept = container.dataset.dept || 'all';

        let filtered = contacts;
        if (search) {
            const s = search.toLowerCase();
            filtered = filtered.filter(c =>
                c.name.toLowerCase().includes(s) ||
                (c.email && c.email.toLowerCase().includes(s)) ||
                (c.phone && c.phone.includes(s)) ||
                (c.role && c.role.toLowerCase().includes(s)) ||
                (c.team && c.team.toLowerCase().includes(s))
            );
        }
        if (filterDept !== 'all') {
            filtered = filtered.filter(c => c.department.includes(filterDept));
        }

        // Group by department
        const bureau = filtered.filter(c => c.department.includes('bureau'));
        const installation = filtered.filter(c => c.department.includes('installation'));
        const other = filtered.filter(c => !c.department.includes('bureau') && !c.department.includes('installation'));

        const roleLabels = {
            directeur: 'Directeur',
            vendeur: 'Vendeur',
            directeur_usine: 'Directeur usine',
            reception: 'Réception',
            installateur: 'Installateur',
            comptabilite: 'Comptabilité',
        };

        function renderContactCard(c) {
            const roleLabel = roleLabels[c.role] || c.role || '';
            return `
                <div class="dir-card" onclick="Directory.editContact('${c.id}')">
                    <div class="dir-avatar" style="${c.teamColor ? `background:${c.teamColor}` : ''}">${c.initials}</div>
                    <div class="dir-info">
                        <div class="dir-name">${c.name}</div>
                        <div class="dir-role">${roleLabel}${c.team ? ` — ${c.team}` : ''}</div>
                        ${c.phone ? `<div class="dir-contact"><a href="tel:${c.phone}">📞 ${c.phone}</a></div>` : ''}
                        ${c.phone2 ? `<div class="dir-contact"><a href="tel:${c.phone2}">📱 ${c.phone2}</a></div>` : ''}
                        ${c.email ? `<div class="dir-contact"><a href="mailto:${c.email}">📧 ${c.email}</a></div>` : ''}
                        ${c.notes ? `<div class="dir-notes">${c.notes}</div>` : ''}
                    </div>
                    <div class="dir-actions">
                        ${c.phone ? `<a href="tel:${c.phone}" class="btn btn-sm btn-outline" onclick="event.stopPropagation()" title="Appeler">📞</a>` : ''}
                        ${c.email ? `<a href="mailto:${c.email}" class="btn btn-sm btn-outline" onclick="event.stopPropagation()" title="Courriel">📧</a>` : ''}
                    </div>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="dir-toolbar">
                <input type="text" class="input-sm dir-search" placeholder="🔍 Rechercher un contact..." value="${search}" oninput="Directory.setSearch(this.value)">
                <div class="dir-filters">
                    <button class="btn btn-sm ${filterDept === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="Directory.setDept('all')">Tous (${contacts.length})</button>
                    <button class="btn btn-sm ${filterDept === 'bureau' ? 'btn-primary' : 'btn-outline'}" onclick="Directory.setDept('bureau')">Bureau (${contacts.filter(c=>c.department.includes('bureau')).length})</button>
                    <button class="btn btn-sm ${filterDept === 'installation' ? 'btn-primary' : 'btn-outline'}" onclick="Directory.setDept('installation')">Installation (${contacts.filter(c=>c.department.includes('installation')).length})</button>
                </div>
                <button class="btn btn-primary btn-sm" onclick="Directory.addContact()">+ Ajouter un contact</button>
            </div>

            ${bureau.length > 0 && (filterDept === 'all' || filterDept === 'bureau') ? `
                <h4 class="dir-section-title">🏢 Équipe bureau</h4>
                <div class="dir-grid">${bureau.map(renderContactCard).join('')}</div>
            ` : ''}

            ${installation.length > 0 && (filterDept === 'all' || filterDept === 'installation') ? `
                <h4 class="dir-section-title">🏗️ Équipes d'installation</h4>
                <div class="dir-grid">${installation.map(renderContactCard).join('')}</div>
            ` : ''}

            ${other.length > 0 ? `
                <h4 class="dir-section-title">📋 Autres contacts</h4>
                <div class="dir-grid">${other.map(renderContactCard).join('')}</div>
            ` : ''}

            ${filtered.length === 0 ? '<div class="sav-empty">Aucun contact trouvé</div>' : ''}
        `;
    }

    function setSearch(val) {
        const container = document.getElementById('directory-content');
        if (container) container.dataset.search = val;
        render();
    }

    function setDept(dept) {
        const container = document.getElementById('directory-content');
        if (container) container.dataset.dept = dept;
        render();
    }

    function editContact(contactId) {
        const contacts = getContacts();
        const contact = contacts.find(c => c.id === contactId);
        if (!contact) return;

        let modal = document.getElementById('modal-directory');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-directory';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-directory').classList.add('hidden')"></div>
            <div class="modal-content" style="z-index:1;max-width:500px">
                <div class="modal-header">
                    <h3>📇 ${contact.name}</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-directory').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-row">
                        <div class="form-group"><label>Nom</label><input type="text" id="dir-edit-name" value="${contact.name}" class="input-sm"></div>
                        <div class="form-group"><label>Rôle</label><input type="text" id="dir-edit-role" value="${contact.role || ''}" class="input-sm"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Téléphone principal</label><input type="tel" id="dir-edit-phone" value="${contact.phone || ''}" class="input-sm" placeholder="(418) 555-0000"></div>
                        <div class="form-group"><label>Téléphone 2 / Cell</label><input type="tel" id="dir-edit-phone2" value="${contact.phone2 || ''}" class="input-sm" placeholder="(418) 555-0000"></div>
                    </div>
                    <div class="form-group"><label>Courriel</label><input type="email" id="dir-edit-email" value="${contact.email || ''}" class="input-sm"></div>
                    <div class="form-group"><label>Notes</label><textarea id="dir-edit-notes" rows="2" class="input-sm" style="width:100%">${contact.notes || ''}</textarea></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="document.getElementById('modal-directory').classList.add('hidden')">Annuler</button>
                    <button class="btn btn-primary" onclick="Directory.saveEdit('${contactId}')">💾 Sauvegarder</button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function saveEdit(contactId) {
        saveContact({
            id: contactId,
            name: document.getElementById('dir-edit-name')?.value || '',
            role: document.getElementById('dir-edit-role')?.value || '',
            phone: document.getElementById('dir-edit-phone')?.value || '',
            phone2: document.getElementById('dir-edit-phone2')?.value || '',
            email: document.getElementById('dir-edit-email')?.value || '',
            notes: document.getElementById('dir-edit-notes')?.value || '',
        });
        document.getElementById('modal-directory')?.classList.add('hidden');
        App.showToast('Contact sauvegardé', 'success');
        render();
    }

    function addContact() {
        const name = prompt('Nom du contact:');
        if (!name) return;
        const id = 'custom-' + Date.now();
        saveContact({
            id,
            name,
            phone: '',
            phone2: '',
            email: '',
            role: '',
            department: 'autre',
            initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
            notes: '',
        });
        render();
        editContact(id);
    }

    return {
        render,
        setSearch,
        setDept,
        editContact,
        saveEdit,
        addContact,
        getContacts,
    };
})();
