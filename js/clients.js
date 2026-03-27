// ===== CRM LGC - Client Database Module =====
// Centralized client directory with search/autocomplete

const Clients = (() => {
    const STORAGE_KEY = 'crm_clients';
    let clients = [];

    function loadClients() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            clients = JSON.parse(saved);
        } else {
            // Build from existing deals
            buildFromDeals();
        }
        return clients;
    }

    function saveClients() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
    }

    // Build client list from existing deal data (first load)
    function buildFromDeals() {
        const deals = Deals.getAll();
        const seen = {};

        deals.forEach(deal => {
            const key = (deal.clientPhone || deal.clientName || '').toLowerCase().trim();
            if (!key || seen[key]) return;
            seen[key] = true;

            clients.push({
                id: 'CL-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                name: deal.clientName || '',
                phone: deal.clientPhone || '',
                email: deal.clientEmail || '',
                address: deal.clientAddress || '',
                accountNumber: deal.accountNumber || '',
                clientType: deal.clientType || 'regulier',
                notes: '',
                createdAt: deal.createdAt || new Date().toISOString(),
            });
        });

        saveClients();
    }

    function getAll() {
        if (clients.length === 0) loadClients();
        return clients;
    }

    function getById(id) {
        return clients.find(c => c.id === id);
    }

    function search(query) {
        if (!query || query.length < 2) return [];
        const q = query.toLowerCase().trim();
        return clients.filter(c =>
            (c.name && c.name.toLowerCase().includes(q)) ||
            (c.phone && c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, ''))) ||
            (c.email && c.email.toLowerCase().includes(q)) ||
            (c.accountNumber && c.accountNumber.toLowerCase().includes(q))
        ).slice(0, 8);
    }

    function create(data) {
        const client = {
            id: 'CL-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            name: data.name || '',
            phone: data.phone || '',
            email: data.email || '',
            address: data.address || '',
            accountNumber: data.accountNumber || '',
            clientType: data.clientType || 'regulier',
            notes: data.notes || '',
            createdAt: new Date().toISOString(),
        };
        clients.push(client);
        saveClients();
        return client;
    }

    function update(id, updates) {
        const idx = clients.findIndex(c => c.id === id);
        if (idx === -1) return null;
        clients[idx] = { ...clients[idx], ...updates };
        saveClients();
        return clients[idx];
    }

    function remove(id) {
        clients = clients.filter(c => c.id !== id);
        saveClients();
    }

    // Save/update client when a deal is saved
    function syncFromDeal(dealData) {
        if (!dealData.clientName) return;

        // Find existing by phone or name
        const existing = clients.find(c =>
            (c.phone && dealData.clientPhone && c.phone.replace(/\D/g, '') === dealData.clientPhone.replace(/\D/g, '')) ||
            (c.name && c.name.toLowerCase() === dealData.clientName.toLowerCase())
        );

        if (existing) {
            // Update with latest info
            if (dealData.clientName) existing.name = dealData.clientName;
            if (dealData.clientPhone) existing.phone = dealData.clientPhone;
            if (dealData.clientEmail) existing.email = dealData.clientEmail;
            if (dealData.clientAddress) existing.address = dealData.clientAddress;
            if (dealData.accountNumber) existing.accountNumber = dealData.accountNumber;
            if (dealData.clientType) existing.clientType = dealData.clientType;
            saveClients();
            return existing;
        } else {
            return create({
                name: dealData.clientName,
                phone: dealData.clientPhone,
                email: dealData.clientEmail,
                address: dealData.clientAddress,
                accountNumber: dealData.accountNumber,
                clientType: dealData.clientType,
            });
        }
    }

    // Get deal history for a client
    function getClientDeals(clientId) {
        const client = getById(clientId);
        if (!client) return [];
        const deals = Deals.getAll();
        return deals.filter(d =>
            (d.clientPhone && client.phone && d.clientPhone.replace(/\D/g, '') === client.phone.replace(/\D/g, '')) ||
            (d.clientName && d.clientName.toLowerCase() === client.name.toLowerCase())
        );
    }

    // =========================================
    // RENDER: Client Directory Page
    // =========================================

    function render() {
        const container = document.getElementById('clients-content');
        if (!container) return;

        loadClients();

        const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        const reguliers = sorted.filter(c => c.clientType !== 'entrepreneur');
        const entrepreneurs = sorted.filter(c => c.clientType === 'entrepreneur');

        container.innerHTML = `
            <div class="clients-toolbar">
                <div class="clients-search-box">
                    <input type="text" id="clients-search" placeholder="🔍 Rechercher un client (nom, téléphone, courriel, # compte)..." class="input-lg" autocomplete="off">
                </div>
                <button class="btn btn-primary" onclick="Clients.openNewClient()">+ Nouveau client</button>
            </div>

            <div class="clients-stats">
                <span class="clients-stat"><strong>${clients.length}</strong> clients</span>
                <span class="clients-stat"><strong>${reguliers.length}</strong> réguliers</span>
                <span class="clients-stat"><strong>${entrepreneurs.length}</strong> entrepreneurs</span>
            </div>

            <div id="clients-list" class="clients-list">
                ${sorted.map(c => renderClientRow(c)).join('')}
            </div>
        `;

        // Search filter
        document.getElementById('clients-search')?.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('.client-row').forEach(row => {
                row.style.display = q.length < 2 || row.dataset.search.includes(q) ? '' : 'none';
            });
        });
    }

    function renderClientRow(c) {
        const deals = getClientDeals(c.id);
        const activeDeals = deals.filter(d => d.status === 'active');
        const totalValue = deals.reduce((sum, d) => sum + (d.quoteAmount || 0), 0);
        const searchStr = `${c.name} ${c.phone} ${c.email} ${c.accountNumber} ${c.address}`.toLowerCase();

        return `
            <div class="client-row" data-search="${searchStr}" onclick="Clients.openClient('${c.id}')">
                <div class="client-row-avatar">
                    <span class="client-avatar ${c.clientType}">${c.name ? c.name.charAt(0).toUpperCase() : '?'}</span>
                </div>
                <div class="client-row-info">
                    <div class="client-row-name">
                        ${c.name}
                        <span class="card-type-badge ${c.clientType}">${c.clientType === 'entrepreneur' ? 'ENTR' : 'RÉG'}</span>
                    </div>
                    <div class="client-row-details">
                        ${c.phone ? `<span>📞 ${c.phone}</span>` : ''}
                        ${c.email ? `<span>✉️ ${c.email}</span>` : ''}
                        ${c.accountNumber ? `<span>📋 ${c.accountNumber}</span>` : ''}
                    </div>
                    ${c.address ? `<div class="client-row-address">📍 ${c.address}</div>` : ''}
                </div>
                <div class="client-row-stats">
                    ${activeDeals.length > 0 ? `<span class="client-deals-badge">${activeDeals.length} deal${activeDeals.length > 1 ? 's' : ''} actif${activeDeals.length > 1 ? 's' : ''}</span>` : '<span class="client-no-deals">Aucun deal actif</span>'}
                    ${totalValue > 0 ? `<span class="client-total-value">${Deals.formatMoney(totalValue)}</span>` : ''}
                </div>
            </div>
        `;
    }

    // =========================================
    // CLIENT DETAIL MODAL
    // =========================================

    let selectedClientId = null;

    function openClient(clientId) {
        const client = getById(clientId);
        if (!client) return;

        selectedClientId = clientId;
        const modal = document.getElementById('modal-client');
        if (!modal) return;

        modal.classList.remove('hidden');
        document.getElementById('modal-client-title').textContent = client.name;

        document.getElementById('client-name').value = client.name || '';
        document.getElementById('client-phone').value = client.phone || '';
        document.getElementById('client-email').value = client.email || '';
        document.getElementById('client-address').value = client.address || '';
        document.getElementById('client-account').value = client.accountNumber || '';
        document.getElementById('client-type').value = client.clientType || 'regulier';
        document.getElementById('client-notes').value = client.notes || '';
        document.getElementById('btn-delete-client').classList.remove('hidden');

        // Render deal history
        renderClientDeals(clientId);
    }

    function openNewClient() {
        selectedClientId = null;
        const modal = document.getElementById('modal-client');
        if (!modal) return;

        modal.classList.remove('hidden');
        document.getElementById('modal-client-title').textContent = 'Nouveau client';
        document.getElementById('client-form').reset();
        document.getElementById('client-type').value = 'regulier';
        document.getElementById('btn-delete-client').classList.add('hidden');
        document.getElementById('client-deal-history').innerHTML = '';
    }

    function saveClient() {
        const data = {
            name: document.getElementById('client-name').value.trim(),
            phone: document.getElementById('client-phone').value.trim(),
            email: document.getElementById('client-email').value.trim(),
            address: document.getElementById('client-address').value.trim(),
            accountNumber: document.getElementById('client-account').value.trim(),
            clientType: document.getElementById('client-type').value,
            notes: document.getElementById('client-notes').value.trim(),
        };

        if (!data.name) {
            App.showToast('Le nom est requis', 'danger');
            return;
        }

        if (selectedClientId) {
            update(selectedClientId, data);
        } else {
            create(data);
        }

        document.getElementById('modal-client').classList.add('hidden');
        render();
        App.showToast(selectedClientId ? 'Client mis à jour' : 'Client créé', 'success');
    }

    function deleteClient() {
        if (!selectedClientId) return;
        const c = getById(selectedClientId);
        if (!confirm(`Supprimer le client ${c?.name}?`)) return;

        remove(selectedClientId);
        document.getElementById('modal-client').classList.add('hidden');
        render();
        App.showToast('Client supprimé', 'info');
    }

    function renderClientDeals(clientId) {
        const container = document.getElementById('client-deal-history');
        if (!container) return;

        const deals = getClientDeals(clientId);

        if (deals.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">Aucun deal pour ce client</p>';
            return;
        }

        container.innerHTML = `
            <h4 style="margin:12px 0 8px;font-size:13px;color:var(--text-secondary)">📋 Historique deals (${deals.length})</h4>
            ${deals.map(d => `
                <div class="client-deal-item" onclick="event.stopPropagation();document.getElementById('modal-client').classList.add('hidden');App.openDeal('${d.id}')">
                    <span class="stage-badge" style="background:${Deals.getStageColor(d.stage)}20;color:${Deals.getStageColor(d.stage)};font-size:11px;padding:2px 8px">
                        ${Deals.getStageName(d.stage)}
                    </span>
                    <span style="font-weight:600">${Deals.formatMoney(d.quoteAmount)}</span>
                    <span style="color:var(--text-muted);font-size:12px">${d.products || ''}</span>
                    <span class="client-deal-status ${d.status}">${d.status === 'active' ? '🟢' : d.status === 'won' ? '✅' : '❌'}</span>
                </div>
            `).join('')}
            <button class="btn btn-sm btn-outline" style="margin-top:8px" onclick="event.stopPropagation();document.getElementById('modal-client').classList.add('hidden');Clients.createDealForClient('${clientId}')">
                + Nouveau deal pour ce client
            </button>
        `;
    }

    // Create a deal pre-filled with client info
    function createDealForClient(clientId) {
        const client = getById(clientId);
        if (!client) return;

        App.openNewDeal({
            clientName: client.name,
            clientPhone: client.phone,
            clientEmail: client.email,
            clientAddress: client.address,
            accountNumber: client.accountNumber,
            clientType: client.clientType,
        });
    }

    // =========================================
    // AUTOCOMPLETE for deal form
    // =========================================

    function setupAutocomplete(inputEl, onSelect) {
        let dropdown = null;

        function createDropdown() {
            if (dropdown) dropdown.remove();
            dropdown = document.createElement('div');
            dropdown.className = 'client-autocomplete-dropdown';
            inputEl.parentElement.style.position = 'relative';
            inputEl.parentElement.appendChild(dropdown);
            return dropdown;
        }

        function hideDropdown() {
            if (dropdown) {
                dropdown.remove();
                dropdown = null;
            }
        }

        inputEl.addEventListener('input', () => {
            const q = inputEl.value;
            if (q.length < 2) { hideDropdown(); return; }

            const results = search(q);
            if (results.length === 0) { hideDropdown(); return; }

            const dd = createDropdown();
            dd.innerHTML = results.map(c => `
                <div class="client-autocomplete-item" data-id="${c.id}">
                    <strong>${c.name}</strong>
                    <span class="card-type-badge ${c.clientType}" style="font-size:9px;padding:1px 5px">${c.clientType === 'entrepreneur' ? 'ENTR' : 'RÉG'}</span>
                    <br>
                    <small style="color:var(--text-muted)">
                        ${c.phone ? `📞 ${c.phone}` : ''} ${c.accountNumber ? `| 📋 ${c.accountNumber}` : ''}
                    </small>
                </div>
            `).join('');

            dd.querySelectorAll('.client-autocomplete-item').forEach(item => {
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const client = getById(item.dataset.id);
                    if (client && onSelect) onSelect(client);
                    hideDropdown();
                });
            });
        });

        inputEl.addEventListener('blur', () => {
            setTimeout(hideDropdown, 200);
        });
    }

    return {
        loadClients,
        getAll,
        getById,
        search,
        create,
        update,
        remove,
        syncFromDeal,
        getClientDeals,
        render,
        openClient,
        openNewClient,
        saveClient,
        deleteClient,
        createDealForClient,
        setupAutocomplete,
    };
})();
