// ===== CRM LGC - Main Application Module =====
// Routing, navigation, event handlers, orchestration

const App = (() => {
    const ACTIVITY_KEY = 'crm_activity';
    let activities = [];
    let currentView = 'dashboard';
    let editingDealId = null;
    let pendingFiles = []; // fichiers en attente pour les nouveaux deals

    // ===== INITIALIZATION =====
    async function init() {
        // Check for demo mode or M365 auth
        const user = await Auth.init();

        if (user) {
            showApp(user);
        } else {
            showLogin();
        }

        setupEventListeners();
    }

    function showLogin() {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
    }

    async function showApp(user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');

        // Update user display
        document.getElementById('user-name').textContent = user.name;
        document.getElementById('user-role').textContent = user.role === 'directeur' ? 'Directeur' : user.role === 'vendeur' ? 'Vendeur' : user.role;
        document.getElementById('user-avatar').textContent = user.initials;

        // Show/hide director-only items
        document.querySelectorAll('.director-only').forEach(el => {
            el.style.display = Auth.isDirector() ? '' : 'none';
        });

        // Load data
        await Deals.loadDeals();
        await Team.loadTasks();
        await Contracts.loadContracts();
        await Shopify.loadOrders();
        await Calendar.loadUpcoming();
        Notifications.loadSentLog();
        PlanReader.loadAnalyses();

        // Load activities
        const saved = localStorage.getItem(ACTIVITY_KEY);
        activities = saved ? JSON.parse(saved) : [];

        // Apply theme
        applyTheme(localStorage.getItem('crm_theme') || 'light');

        // Register service worker for PWA
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }

        // Load client database
        Clients.loadClients();

        // Populate filters and dropdowns
        Pipeline.populateFilters();

        // Load settings
        loadSettingsUI();

        // Setup client autocomplete on deal form
        const clientNameInput = document.getElementById('deal-client-name');
        if (clientNameInput) {
            Clients.setupAutocomplete(clientNameInput, (client) => {
                const form = document.getElementById('deal-form');
                if (!form) return;
                clientNameInput.value = client.name;
                const phoneEl = form.querySelector('[name="clientPhone"]');
                const emailEl = form.querySelector('[name="clientEmail"]');
                const addressEl = form.querySelector('[name="clientAddress"]');
                const accountEl = form.querySelector('[name="accountNumber"]');
                const typeEl = form.querySelector('[name="clientType"]');
                if (phoneEl && client.phone) phoneEl.value = client.phone;
                if (emailEl && client.email) emailEl.value = client.email;
                if (addressEl && client.address) addressEl.value = client.address;
                if (accountEl && client.accountNumber) accountEl.value = client.accountNumber;
                if (typeEl && client.clientType) typeEl.value = client.clientType;
            });
        }

        // Initial render
        renderCurrentView();
        Alerts.refresh();
    }

    // ===== NAVIGATION =====
    function navigate(view) {
        currentView = view;

        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.view === view);
        });

        // Show/hide views
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const viewEl = document.getElementById(`view-${view}`);
        if (viewEl) viewEl.classList.add('active');

        // Update page title
        const titles = {
            dashboard: 'Tableau de bord',
            pipeline: 'Pipeline',
            deals: 'Tous les deals',
            emails: 'Courriels / Leads',
            contracts: 'Contrats',
            payments: 'Paiements',
            team: 'Équipe',
            reports: 'Rapports',
            clients: 'Clients',
            installations: 'Installations',
            plans: 'Lecteur de plans IA',
            settings: 'Paramètres',
        };
        document.getElementById('page-title').textContent = titles[view] || view;

        renderCurrentView();
    }

    function renderCurrentView() {
        switch (currentView) {
            case 'dashboard':
                renderDashboard();
                break;
            case 'pipeline':
                Pipeline.render();
                break;
            case 'clients':
                Clients.render();
                break;
            case 'deals':
                Pipeline.renderList();
                break;
            case 'emails':
                // Rendered on demand
                break;
            case 'contracts':
                Contracts.render('pending');
                break;
            case 'payments':
                Payments.render('acomptes');
                break;
            case 'team':
                Team.render();
                break;
            case 'reports':
                Reports.render('month');
                break;
            case 'installations':
                Installations.render();
                break;
            case 'plans':
                PlanReader.renderUI();
                break;
        }
    }

    function renderDashboard() {
        // Vendeurs voient leurs stats, directeurs voient tout
        const user = Auth.getUser();
        const filterUser = (user && !Auth.isDirector()) ? user.id : null;
        const stats = filterUser ? getFilteredStats(filterUser) : Deals.getStats();

        document.getElementById('kpi-active-deals').textContent = stats.activeDeals;
        document.getElementById('kpi-pipeline-value').textContent = Deals.formatMoney(stats.pipelineValue);
        document.getElementById('kpi-conversion').textContent = stats.conversionRate + '%';
        document.getElementById('kpi-avg-delay').textContent = stats.avgDelay + 'j';
        document.getElementById('kpi-overdue').textContent = stats.overdue;
        document.getElementById('kpi-overdue').style.color = stats.overdue > 0 ? 'var(--danger)' : 'var(--success)';
        document.getElementById('kpi-monthly-revenue').textContent = Deals.formatMoney(stats.monthlyRevenue);

        Pipeline.renderMiniPipeline();
        Alerts.refresh();
        Calendar.renderUpcoming();
        renderActivityFeed();
    }

    // ===== ACTIVITY FEED =====
    function addActivity(type, text, dealId = null) {
        activities.unshift({
            type,
            text,
            dealId,
            date: new Date().toISOString(),
            user: Auth.getUser()?.name || 'Système',
        });
        // Keep last 50
        activities = activities.slice(0, 50);
        localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activities));
    }

    function renderActivityFeed() {
        const container = document.getElementById('activity-feed');
        if (!container) return;

        if (activities.length === 0) {
            container.innerHTML = '<div class="activity-placeholder">Aucune activité récente</div>';
            return;
        }

        const icons = {
            new_deal: '🆕',
            stage_change: '🔄',
            deal_won: '🎉',
            deal_lost: '❌',
            note: '📝',
            task: '📋',
            contract: '✍️',
            payment: '💰',
        };

        container.innerHTML = activities.slice(0, 15).map(a => `
            <div class="activity-item" ${a.dealId ? `onclick="App.openDeal('${a.dealId}')" style="cursor:pointer"` : ''}>
                <div class="activity-icon">${icons[a.type] || '📌'}</div>
                <div class="activity-text">
                    <strong>${a.user}</strong> - ${a.text}
                </div>
                <span class="activity-time">${timeAgo(a.date)}</span>
            </div>
        `).join('');
    }

    // ===== DEAL MODAL =====
    function openDeal(dealId) {
        editingDealId = dealId;
        const deal = Deals.getById(dealId);
        if (!deal) return;

        const modal = document.getElementById('modal-deal');
        document.getElementById('modal-deal-title').textContent = deal.clientName;

        const form = document.getElementById('deal-form');
        // Populate form fields
        const fields = [
            'clientName', 'clientPhone', 'clientEmail', 'clientAddress',
            'accountNumber', 'clientType', 'leadSource', 'projectType', 'products', 'description',
            'quoteAmount', 'contractAmount', 'stage', 'assignedTo',
            'mecinovQuoteNum', 'mecinovOrderNum', 'mecinovInvoiceNum',
            'avantageInvoiceNum', 'shopifyOrderNum',
            'depositRequired', 'depositReceived', 'paymentStatus',
            'leadDate', 'assignDate', 'quoteDueDate', 'quoteSentDate',
            'lastFollowUp', 'followUpDueDate',
            'contractSignDate', 'depositDate', 'supplierOrderDate',
            'measurementDate', 'installDate', 'completedDate',
        ];

        fields.forEach(field => {
            const input = form.querySelector(`[name="${field}"]`);
            if (input && deal[field] !== undefined) {
                input.value = deal[field] || '';
            }
        });

        // Show/hide lost button
        const lostBtn = document.getElementById('btn-deal-lost');
        if (deal.status === 'active') {
            lostBtn.classList.remove('hidden');
        } else {
            lostBtn.classList.add('hidden');
        }

        // Status indicator
        const statusEl = document.getElementById('deal-status-indicator');
        if (deal.status === 'won') statusEl.innerHTML = '<span style="color:var(--success);font-weight:700">GAGNÉ</span>';
        else if (deal.status === 'lost') statusEl.innerHTML = '<span style="color:var(--danger);font-weight:700">PERDU</span>';
        else statusEl.innerHTML = `<span style="color:var(--primary)">Étape ${deal.stage}/14 - ${Deals.getStageName(deal.stage)}</span>`;

        // Delay indicator
        updateDelayIndicator();

        // Quote deadline alert
        updateQuoteDeadlineAlert();

        // Notes
        renderDealNotes(dealId);

        // Attachments
        renderAttachments(dealId);

        // Show first tab
        showFormTab('client');

        modal.classList.remove('hidden');
    }

    function openNewDeal(prefill = {}) {
        editingDealId = null;
        pendingFiles = []; // réinitialiser les fichiers en attente
        const modal = document.getElementById('modal-deal');
        document.getElementById('modal-deal-title').textContent = 'Nouveau deal';

        const form = document.getElementById('deal-form');
        form.reset();

        // Set defaults
        const today = new Date();
        form.querySelector('[name="leadDate"]').value = today.toISOString().split('T')[0];
        form.querySelector('[name="assignDate"]').value = today.toISOString().split('T')[0];
        form.querySelector('[name="stage"]').value = '1';
        form.querySelector('[name="clientType"]').value = 'regulier';

        // Auto-assigner au vendeur connecté
        const user = Auth.getUser();
        if (user) {
            const vendorSelect = form.querySelector('[name="assignedTo"]');
            if (vendorSelect) vendorSelect.value = user.id;
        }

        // Règle LGC: soumission max 48h après création du lead
        const deadline48h = new Date(today);
        deadline48h.setDate(deadline48h.getDate() + 2);
        // Si le deadline tombe un samedi → lundi, dimanche → lundi
        if (deadline48h.getDay() === 6) deadline48h.setDate(deadline48h.getDate() + 2);
        if (deadline48h.getDay() === 0) deadline48h.setDate(deadline48h.getDate() + 1);
        form.querySelector('[name="quoteDueDate"]').value = deadline48h.toISOString().split('T')[0];

        // Apply prefill
        Object.entries(prefill).forEach(([key, value]) => {
            const input = form.querySelector(`[name="${key}"]`);
            if (input) input.value = value;
        });

        document.getElementById('btn-deal-lost').classList.add('hidden');
        document.getElementById('deal-status-indicator').innerHTML = '<span style="color:var(--info)">Nouveau deal</span>';
        document.getElementById('deal-notes-timeline').innerHTML = '';
        document.getElementById('attachments-list').innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">Aucune pièce jointe</div>';

        // Déclencher l'alerte 48h dès l'ouverture
        updateQuoteDeadlineAlert();

        showFormTab('client');
        modal.classList.remove('hidden');
    }

    function closeDealModal() {
        document.getElementById('modal-deal').classList.add('hidden');
        editingDealId = null;
        pendingFiles = [];
    }

    async function saveDeal() {
        const saveBtn = document.getElementById('btn-save-deal');
        const form = document.getElementById('deal-form');
        const formData = new FormData(form);
        const data = {};

        for (const [key, value] of formData.entries()) {
            if (key === 'newNote') continue;
            if (key === 'stage') {
                data[key] = parseInt(value, 10) || 1;
            } else if (key === 'quoteAmount' || key === 'contractAmount' || key === 'depositRequired') {
                data[key] = value ? parseFloat(value) : 0;
            } else {
                data[key] = value;
            }
        }

        // Add note if present
        const noteText = form.querySelector('[name="newNote"]').value.trim();

        // Animation bouton
        saveBtn.classList.add('saving');
        saveBtn.innerHTML = '🚀 Envoi...';

        if (editingDealId) {
            await Deals.update(editingDealId, data);
            Clients.syncFromDeal(data);
            if (noteText) {
                await Deals.addNote(editingDealId, noteText);
                form.querySelector('[name="newNote"]').value = '';
            }
        } else {
            if (!data.clientName || !data.clientPhone) {
                showToast('Nom et téléphone requis', 'error');
                saveBtn.classList.remove('saving');
                saveBtn.innerHTML = '🚀 Envoyer';
                return;
            }
            const newDeal = await Deals.create(data);
            if (newDeal) {
                if (noteText) await Deals.addNote(newDeal.id, noteText);
                pendingFiles.forEach(f => saveAttachment(newDeal.id, f));
                pendingFiles = [];
                // Sync client to database
                Clients.syncFromDeal(data);
            }
        }

        // Animation succès
        const wasNew = !editingDealId;
        saveBtn.classList.add('saved');
        saveBtn.innerHTML = '✅ Sauvegardé!';
        showToast(wasNew ? 'Nouveau deal créé! 🚀' : 'Deal mis à jour 🎯', 'success');

        setTimeout(() => {
            saveBtn.classList.remove('saving', 'saved');
            saveBtn.innerHTML = '🚀 Envoyer';
            closeDealModal();

            // Après création d'un nouveau deal → aller au pipeline pour le voir
            if (wasNew) {
                navigate('pipeline');
            } else {
                renderCurrentView();
            }
            Alerts.refresh();
        }, 600);
    }

    async function markDealLost() {
        if (!editingDealId) return;
        const deal = Deals.getById(editingDealId);
        if (!deal) return;

        if (confirm(`Marquer "${deal.clientName}" comme PERDU?`)) {
            await Deals.markLost(editingDealId);
            closeDealModal();
            renderCurrentView();
            Alerts.refresh();
            showToast('Deal marqué comme perdu', 'warning');
        }
    }

    function renderDealNotes(dealId) {
        const container = document.getElementById('deal-notes-timeline');
        if (!container) return;

        const notes = Deals.getNotesForDeal(dealId);
        if (notes.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Aucune note pour ce deal</div>';
            return;
        }

        container.innerHTML = notes.map(note => `
            <div class="note-item">
                <div class="note-header">
                    <span class="note-author">${note.author}</span>
                    <span class="note-date">${Deals.formatDate(note.noteDate)}</span>
                </div>
                <div class="note-text">${note.noteText}</div>
            </div>
        `).join('');
    }

    function updateDelayIndicator() {
        const form = document.getElementById('deal-form');
        const leadDate = form.querySelector('[name="leadDate"]').value;
        const quoteSentDate = form.querySelector('[name="quoteSentDate"]').value;
        const indicator = document.getElementById('delay-value');

        if (indicator && leadDate && quoteSentDate) {
            const delay = Math.round((new Date(quoteSentDate) - new Date(leadDate)) / (1000 * 60 * 60 * 24));
            indicator.textContent = `${delay} jours`;
            indicator.className = delay > 14 ? 'overdue' : '';
        } else if (indicator && leadDate) {
            const daysSince = Math.round((new Date() - new Date(leadDate)) / (1000 * 60 * 60 * 24));
            indicator.textContent = `${daysSince} jours depuis le lead (soumission pas encore envoyée)`;
            indicator.className = daysSince > 14 ? 'overdue' : '';
        } else if (indicator) {
            indicator.textContent = '--';
        }
    }

    function showFormTab(tabName) {
        document.querySelectorAll('.form-tab').forEach(t => t.classList.toggle('active', t.dataset.formTab === tabName));
        document.querySelectorAll('.form-tab-content').forEach(c => c.classList.toggle('active', c.dataset.formTabContent === tabName));
    }

    // ===== TASK MODAL =====
    function openTaskModal() {
        Team.populateTaskForm();
        document.getElementById('task-form').reset();
        document.getElementById('task-form').querySelector('[name="taskDeadline"]').value = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
        document.getElementById('modal-task').classList.remove('hidden');
    }

    async function saveTask() {
        const form = document.getElementById('task-form');
        const formData = new FormData(form);
        const data = {};
        for (const [key, value] of formData.entries()) {
            data[key] = value;
        }

        if (!data.taskDescription || !data.taskAssignee) {
            showToast('Description et assigné requis', 'error');
            return;
        }

        await Team.createTask(data);
        document.getElementById('modal-task').classList.add('hidden');
        Team.render();
    }

    // ===== SEARCH =====
    function handleSearch(query) {
        if (!query || query.length < 2) return;
        const q = query.toLowerCase();

        const results = Deals.getAll().filter(d =>
            (d.clientName || '').toLowerCase().includes(q) ||
            (d.clientPhone || '').includes(q) ||
            (d.clientEmail || '').toLowerCase().includes(q) ||
            (d.mecinovQuoteNum || '').toLowerCase().includes(q)
        );

        if (results.length === 1) {
            openDeal(results[0].id);
        } else if (results.length > 1) {
            // Show in deals list view
            navigate('deals');
            document.getElementById('deals-search').value = query;
            // Filter the table
            const tbody = document.getElementById('deals-tbody');
            if (tbody) {
                tbody.querySelectorAll('tr').forEach(tr => {
                    const text = tr.textContent.toLowerCase();
                    tr.style.display = text.includes(q) ? '' : 'none';
                });
            }
        } else {
            showToast('Aucun résultat', 'info');
        }
    }

    // ===== TOASTS =====
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ===== SETTINGS =====
    function loadSettingsUI() {
        const relanceDelay = localStorage.getItem('crm_relanceDelay') || '5';
        const leadDelay = localStorage.getItem('crm_leadDelay') || '14';
        const net30Delay = localStorage.getItem('crm_net30Delay') || '30';

        const el1 = document.getElementById('setting-relance-delay');
        const el2 = document.getElementById('setting-lead-delay');
        const el3 = document.getElementById('setting-net30-delay');
        if (el1) el1.value = relanceDelay;
        if (el2) el2.value = leadDelay;
        if (el3) el3.value = net30Delay;

        // Azure AD settings
        const clientId = localStorage.getItem('crm_clientId') || '';
        const tenantId = localStorage.getItem('crm_tenantId') || '';
        const spSite = localStorage.getItem('crm_spSite') || '';
        const el4 = document.getElementById('setting-client-id');
        const el5 = document.getElementById('setting-tenant-id');
        const el6 = document.getElementById('setting-sp-site');
        if (el4) el4.value = clientId;
        if (el5) el5.value = tenantId;
        if (el6) el6.value = spSite;

        // AI settings
        const aiProvider = localStorage.getItem('crm_ai_provider') || 'anthropic';
        const aiApiKey = localStorage.getItem('crm_ai_apikey') || '';
        const aiModel = localStorage.getItem('crm_ai_model') || 'claude-sonnet-4-20250514';
        const elprov = document.getElementById('setting-ai-provider');
        const elkey = document.getElementById('setting-ai-apikey');
        const elmod = document.getElementById('setting-ai-model');
        if (elprov) elprov.value = aiProvider;
        if (elkey) elkey.value = aiApiKey;
        if (elmod) elmod.value = aiModel;

        // Theme
        const theme = localStorage.getItem('crm_theme') || 'light';
        const eltheme = document.getElementById('setting-theme');
        if (eltheme) eltheme.value = theme;

        // Shopify settings
        const shopifyStore = localStorage.getItem('crm_shopifyStore') || '';
        const shopifyToken = localStorage.getItem('crm_shopifyToken') || '';
        const el7 = document.getElementById('setting-shopify-store');
        const el8 = document.getElementById('setting-shopify-token');
        if (el7) el7.value = shopifyStore;
        if (el8) el8.value = shopifyToken;
    }

    function saveSettings() {
        const el1 = document.getElementById('setting-relance-delay');
        const el2 = document.getElementById('setting-lead-delay');
        const el3 = document.getElementById('setting-net30-delay');
        if (el1) localStorage.setItem('crm_relanceDelay', el1.value);
        if (el2) localStorage.setItem('crm_leadDelay', el2.value);
        if (el3) localStorage.setItem('crm_net30Delay', el3.value);
    }

    // ===== ATTACHMENTS =====
    const ATTACHMENTS_KEY = 'crm_attachments';

    function getAttachments(dealId) {
        const all = JSON.parse(localStorage.getItem(ATTACHMENTS_KEY) || '{}');
        return all[dealId] || [];
    }

    function saveAttachment(dealId, fileInfo) {
        const all = JSON.parse(localStorage.getItem(ATTACHMENTS_KEY) || '{}');
        if (!all[dealId]) all[dealId] = [];
        all[dealId].push(fileInfo);
        localStorage.setItem(ATTACHMENTS_KEY, JSON.stringify(all));
    }

    function removeAttachment(dealId, attachmentId) {
        const all = JSON.parse(localStorage.getItem(ATTACHMENTS_KEY) || '{}');
        if (all[dealId]) {
            all[dealId] = all[dealId].filter(a => a.id !== attachmentId);
            localStorage.setItem(ATTACHMENTS_KEY, JSON.stringify(all));
        }
    }

    function getFileIcon(filename) {
        const ext = (filename || '').split('.').pop().toLowerCase();
        if (['pdf'].includes(ext)) return { icon: '📄', cls: 'pdf' };
        if (['doc', 'docx'].includes(ext)) return { icon: '📝', cls: 'doc' };
        if (['xls', 'xlsx', 'csv'].includes(ext)) return { icon: '📊', cls: 'xls' };
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(ext)) return { icon: '🖼️', cls: 'img' };
        if (['msg', 'eml'].includes(ext)) return { icon: '📧', cls: 'other' };
        return { icon: '📎', cls: 'other' };
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' o';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
        return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
    }

    function renderAttachments(dealId) {
        const container = document.getElementById('attachments-list');
        if (!container) return;

        const attachments = getAttachments(dealId);

        if (attachments.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">Aucune pièce jointe</div>';
            return;
        }

        container.innerHTML = attachments.map(att => {
            const fi = getFileIcon(att.name);
            return `
                <div class="attachment-item">
                    <div class="attachment-icon ${fi.cls}">${fi.icon}</div>
                    <div class="attachment-info">
                        <div class="attachment-name" title="${att.name}">${att.name}</div>
                        <div class="attachment-meta">${formatFileSize(att.size)} - ${Deals.formatDate(att.uploadedAt)} par ${att.uploadedBy}</div>
                    </div>
                    <div class="attachment-actions">
                        ${att.dataUrl ? `<button class="btn-icon-sm" title="Télécharger" onclick="App.downloadAttachment('${dealId}','${att.id}')">⬇️</button>` : ''}
                        <button class="btn-icon-sm" title="Supprimer" onclick="App.deleteAttachment('${dealId}','${att.id}')">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function handleFileUpload(dealId, files) {
        const maxSize = 25 * 1024 * 1024; // 25 MB

        for (const file of files) {
            if (file.size > maxSize) {
                showToast(`${file.name} dépasse 25 Mo`, 'error');
                continue;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const fileInfo = {
                    id: 'F' + Date.now() + Math.random().toString(36).substr(2, 5),
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    dataUrl: e.target.result,
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: Auth.getUser()?.name || 'Inconnu',
                };

                if (dealId) {
                    // Deal existant — sauvegarder directement
                    saveAttachment(dealId, fileInfo);
                    renderAttachments(dealId);
                } else {
                    // Nouveau deal — stocker en mémoire temporaire
                    pendingFiles.push(fileInfo);
                    renderPendingAttachments();
                }
                showToast(`${file.name} ajouté`, 'success');
            };
            reader.readAsDataURL(file);
        }
    }

    function renderPendingAttachments() {
        const container = document.getElementById('attachments-list');
        if (!container) return;
        if (pendingFiles.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">Aucune pièce jointe</div>';
            return;
        }
        container.innerHTML = pendingFiles.map((att, idx) => {
            const fi = getFileIcon(att.name);
            return `
                <div class="attachment-item">
                    <div class="attachment-icon ${fi.cls}">${fi.icon}</div>
                    <div class="attachment-info">
                        <div class="attachment-name" title="${att.name}">${att.name}</div>
                        <div class="attachment-meta">${formatFileSize(att.size)} — sera attaché à la sauvegarde</div>
                    </div>
                    <div class="attachment-actions">
                        <button class="btn-icon-sm" title="Retirer" onclick="App.removePendingFile(${idx})">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function downloadAttachment(dealId, attachmentId) {
        const attachments = getAttachments(dealId);
        const att = attachments.find(a => a.id === attachmentId);
        if (!att || !att.dataUrl) return;

        const link = document.createElement('a');
        link.href = att.dataUrl;
        link.download = att.name;
        link.click();
    }

    function deleteAttachment(dealId, attachmentId) {
        if (confirm('Supprimer cette pièce jointe?')) {
            removeAttachment(dealId, attachmentId);
            renderAttachments(dealId);
            showToast('Pièce jointe supprimée', 'info');
        }
    }

    // ===== FILTERED STATS (for non-directors) =====
    function getFilteredStats(vendeurId) {
        const allDeals = Deals.getAll().filter(d => d.assignedTo === vendeurId);
        const active = allDeals.filter(d => d.status === 'active');
        const won = allDeals.filter(d => d.status === 'won');
        const lost = allDeals.filter(d => d.status === 'lost');
        const total = won.length + lost.length;

        const pipelineValue = active.reduce((sum, d) => sum + (d.quoteAmount || 0), 0);
        const conversionRate = total > 0 ? Math.round((won.length / total) * 100) : 0;

        const delays = active.filter(d => d.leadDate && d.quoteSentDate)
            .map(d => Deals.getLeadToQuoteDelay(d))
            .filter(d => d !== null && d >= 0);
        const avgDelay = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;

        const overdue = active.filter(d => Deals.isOverdue(d)).length;

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const monthlyRevenue = won
            .filter(d => d.contractSignDate && d.contractSignDate >= monthStart)
            .reduce((sum, d) => sum + (d.contractAmount || d.quoteAmount || 0), 0);

        return { activeDeals: active.length, pipelineValue, conversionRate, avgDelay, overdue, monthlyRevenue };
    }

    // ===== DARK MODE =====
    function applyTheme(theme) {
        if (theme === 'auto') {
            theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', theme);
    }

    // ===== HELPERS =====
    function timeAgo(dateStr) {
        const seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
        if (seconds < 60) return 'à l\'instant';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `il y a ${minutes}min`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `il y a ${hours}h`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `il y a ${days}j`;
        return Deals.formatDate(dateStr);
    }

    // ===== EVENT LISTENERS =====
    function setupEventListeners() {
        // Login buttons
        document.getElementById('btn-login').addEventListener('click', async () => {
            try {
                const user = await Auth.login();
                if (user) showApp(user);
            } catch (e) {
                showToast('Connexion échouée. Vérifiez les paramètres Azure AD.', 'error');
            }
        });

        document.getElementById('btn-demo').addEventListener('click', () => {
            const user = Auth.loginDemo();
            showApp(user);
        });

        // Sidebar navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navigate(link.dataset.view);
            });
        });

        // Sidebar toggle
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('collapsed');
        });

        // New deal button
        document.getElementById('btn-new-deal').addEventListener('click', () => openNewDeal());

        // Save deal
        document.getElementById('btn-save-deal').addEventListener('click', saveDeal);

        // Quote deadline alert - live update when dates change
        document.getElementById('quote-due-date')?.addEventListener('change', updateQuoteDeadlineAlert);
        document.getElementById('quote-sent-date')?.addEventListener('change', updateQuoteDeadlineAlert);

        // Règle 48h: si la date du lead change, recalculer le deadline soumission
        document.querySelector('[name="leadDate"]')?.addEventListener('change', (e) => {
            const leadDate = new Date(e.target.value);
            if (isNaN(leadDate)) return;
            const deadline = new Date(leadDate);
            deadline.setDate(deadline.getDate() + 2);
            if (deadline.getDay() === 6) deadline.setDate(deadline.getDate() + 2);
            if (deadline.getDay() === 0) deadline.setDate(deadline.getDate() + 1);
            const dueInput = document.getElementById('quote-due-date');
            // Mettre à jour seulement si pas déjà une date manuelle ou si nouveau deal
            if (dueInput && (!dueInput.value || !editingDealId)) {
                dueInput.value = deadline.toISOString().split('T')[0];
                updateQuoteDeadlineAlert();
            }
        });

        // Mark deal lost
        document.getElementById('btn-deal-lost').addEventListener('click', markDealLost);

        // Modal close buttons
        document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
            el.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal') || document.getElementById(e.target.dataset.modal);
                if (modal) modal.classList.add('hidden');
            });
        });

        document.querySelectorAll('[data-modal]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = document.getElementById(btn.dataset.modal);
                if (modal) modal.classList.add('hidden');
            });
        });

        // Form tabs
        document.querySelectorAll('.form-tab').forEach(tab => {
            tab.addEventListener('click', () => showFormTab(tab.dataset.formTab));
        });

        // Date fields → update delay indicator
        const leadDateInput = document.querySelector('[name="leadDate"]');
        const quoteSentInput = document.querySelector('[name="quoteSentDate"]');
        if (leadDateInput) leadDateInput.addEventListener('change', updateDelayIndicator);
        if (quoteSentInput) quoteSentInput.addEventListener('change', updateDelayIndicator);

        // Pipeline filters
        document.getElementById('filter-vendeur')?.addEventListener('change', (e) => {
            Pipeline.setFilter(e.target.value, document.getElementById('filter-type-client')?.value);
        });
        document.getElementById('filter-type-client')?.addEventListener('change', (e) => {
            Pipeline.setFilter(document.getElementById('filter-vendeur')?.value, e.target.value);
        });

        // Pipeline view toggle
        document.querySelectorAll('[data-pipeline-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-pipeline-view]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Pipeline.setView(btn.dataset.pipelineView);
            });
        });

        // Search
        document.getElementById('global-search')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleSearch(e.target.value);
            }
        });

        // Email scan
        document.getElementById('btn-scan-emails')?.addEventListener('click', () => EmailScanner.scanEmails());

        // Contracts tabs
        document.querySelectorAll('#view-contracts .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#view-contracts .tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Contracts.render(btn.dataset.tab);
            });
        });

        // Payments tabs
        document.querySelectorAll('#view-payments .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#view-payments .tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Payments.render(btn.dataset.tab);
            });
        });

        // Team: assign task
        document.getElementById('btn-assign-task')?.addEventListener('click', openTaskModal);
        document.getElementById('btn-save-task')?.addEventListener('click', saveTask);

        // Reports period
        document.getElementById('report-period')?.addEventListener('change', (e) => {
            Reports.render(e.target.value);
        });

        // Settings: save delays on change
        ['setting-relance-delay', 'setting-lead-delay', 'setting-net30-delay'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', saveSettings);
        });

        // Settings: save Azure AD
        document.getElementById('btn-save-azure')?.addEventListener('click', () => {
            Auth.saveSettings(
                document.getElementById('setting-client-id').value,
                document.getElementById('setting-tenant-id').value,
                document.getElementById('setting-sp-site').value
            );
            showToast('Paramètres Azure AD sauvegardés. Rechargez la page pour appliquer.', 'success');
        });

        // Settings: Shopify
        document.getElementById('setting-shopify-store')?.addEventListener('change', (e) => {
            localStorage.setItem('crm_shopifyStore', e.target.value);
        });
        document.getElementById('setting-shopify-token')?.addEventListener('change', (e) => {
            localStorage.setItem('crm_shopifyToken', e.target.value);
        });
        document.getElementById('btn-test-shopify')?.addEventListener('click', () => Shopify.testConnection());

        // AI settings
        document.getElementById('btn-save-ai')?.addEventListener('click', () => {
            localStorage.setItem('crm_ai_provider', document.getElementById('setting-ai-provider')?.value || 'anthropic');
            localStorage.setItem('crm_ai_apikey', document.getElementById('setting-ai-apikey')?.value || '');
            localStorage.setItem('crm_ai_model', document.getElementById('setting-ai-model')?.value || '');
            App.showToast('Paramètres IA sauvegardés', 'success');
        });

        // Theme
        document.getElementById('setting-theme')?.addEventListener('change', (e) => {
            localStorage.setItem('crm_theme', e.target.value);
            applyTheme(e.target.value);
        });

        // Deals list search
        document.getElementById('deals-search')?.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#deals-tbody tr').forEach(tr => {
                tr.style.display = q.length < 2 || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        });

        // File upload
        const fileInput = document.getElementById('file-upload');
        const uploadZone = document.getElementById('upload-zone');

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    handleFileUpload(editingDealId, e.target.files);
                    e.target.value = ''; // reset
                }
            });
        }

        if (uploadZone) {
            uploadZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadZone.classList.add('drag-over');
            });
            uploadZone.addEventListener('dragleave', () => {
                uploadZone.classList.remove('drag-over');
            });
            uploadZone.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadZone.classList.remove('drag-over');
                if (e.dataTransfer.files.length > 0) {
                    handleFileUpload(editingDealId, e.dataTransfer.files);
                }
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
            }
            // Ctrl+N = new deal
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                openNewDeal();
            }
            // Ctrl+K = search
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                document.getElementById('global-search')?.focus();
            }
        });
    }

    function removePendingFile(idx) {
        pendingFiles.splice(idx, 1);
        renderPendingAttachments();
    }

    // ===== Quote Deadline Alert System =====
    function updateQuoteDeadlineAlert() {
        const alertEl = document.getElementById('quote-deadline-alert');
        if (!alertEl) return;

        const dueDate = document.getElementById('quote-due-date')?.value;
        const sentDate = document.getElementById('quote-sent-date')?.value;

        if (!dueDate) {
            alertEl.classList.add('hidden');
            return;
        }

        alertEl.classList.remove('hidden');
        const due = new Date(dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);

        if (sentDate) {
            // Soumission déjà envoyée
            const sent = new Date(sentDate);
            sent.setHours(0, 0, 0, 0);
            const diff = Math.round((sent - due) / (1000 * 60 * 60 * 24));
            if (diff <= 0) {
                alertEl.className = 'deadline-alert completed';
                alertEl.innerHTML = `✅ Soumission envoyée à temps (${Math.abs(diff)} jour(s) d'avance)`;
            } else {
                alertEl.className = 'deadline-alert completed';
                alertEl.innerHTML = `📨 Soumission envoyée (${diff} jour(s) après la date souhaitée)`;
            }
            return;
        }

        const daysLeft = Math.round((due - today) / (1000 * 60 * 60 * 24));

        if (daysLeft < 0) {
            alertEl.className = 'deadline-alert overdue';
            alertEl.innerHTML = `🚨 EN RETARD de ${Math.abs(daysLeft)} jour(s) — soumission devait être envoyée le ${due.toLocaleDateString('fr-CA')}`;
        } else if (daysLeft <= 2) {
            alertEl.className = 'deadline-alert due-soon';
            alertEl.innerHTML = `⚠️ Soumission due ${daysLeft === 0 ? "AUJOURD'HUI" : `dans ${daysLeft} jour(s)`}`;
        } else {
            alertEl.className = 'deadline-alert on-time';
            alertEl.innerHTML = `✅ Soumission due dans ${daysLeft} jours (${due.toLocaleDateString('fr-CA')})`;
        }
    }

    // Get deadline status for pipeline cards
    function getDeadlineStatus(deal) {
        if (!deal.quoteDueDate || deal.quoteSentDate) return null;
        const due = new Date(deal.quoteDueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);
        const daysLeft = Math.round((due - today) / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) return { status: 'overdue', days: Math.abs(daysLeft), label: `${Math.abs(daysLeft)}j retard` };
        if (daysLeft <= 2) return { status: 'due-soon', days: daysLeft, label: daysLeft === 0 ? "Aujourd'hui" : `${daysLeft}j restant` };
        return null;
    }

    return {
        init,
        navigate,
        openDeal,
        openNewDeal,
        showToast,
        addActivity,
        handleSearch,
        downloadAttachment,
        deleteAttachment,
        removePendingFile,
        updateQuoteDeadlineAlert,
        getDeadlineStatus,
        get _editingDealId() { return editingDealId; },
    };
})();

// Start the app
document.addEventListener('DOMContentLoaded', App.init);
