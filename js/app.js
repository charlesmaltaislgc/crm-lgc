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
        // Check if this is a contract signing page (standalone, no login required)
        const urlParams = new URLSearchParams(window.location.search);
        const signToken = urlParams.get('sign');
        if (signToken) {
            showSigningPage(signToken);
            return;
        }

        // Check for demo mode or M365 auth
        const user = await Auth.init();

        if (user) {
            showApp(user);
        } else {
            showLogin();
        }

        setupEventListeners();
    }

    // ===== STANDALONE SIGNING PAGE =====
    function showSigningPage(token) {
        // Find contract by token
        const contracts = JSON.parse(localStorage.getItem('crm_contracts') || '[]');
        const contract = contracts.find(c => c.signToken === token);

        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;min-height:100vh;display:flex;justify-content:center;padding:24px';

        if (!contract) {
            document.body.innerHTML = `
                <div style="max-width:560px;width:100%;text-align:center;padding:60px 24px">
                    <img src="assets/logo.png" style="height:60px;margin-bottom:24px" alt="LGC">
                    <h1 style="color:#B22234;font-size:24px">Lien invalide ou expiré</h1>
                    <p style="color:#64748b;margin-top:12px">Ce lien de signature n'est pas valide. Contactez Portes et Fenêtres LGC pour obtenir un nouveau lien.</p>
                    <p style="margin-top:24px"><a href="tel:4188320330" style="color:#B22234;font-weight:600">📞 (418) 549-7837</a></p>
                </div>`;
            return;
        }

        if (contract.signed) {
            document.body.innerHTML = `
                <div style="max-width:560px;width:100%;text-align:center;padding:60px 24px">
                    <img src="assets/logo.png" style="height:60px;margin-bottom:24px" alt="LGC">
                    <h1 style="color:#10b981;font-size:24px">✅ Contrat déjà signé</h1>
                    <p style="color:#64748b;margin-top:12px">Ce contrat a été signé le ${new Date(contract.signDate).toLocaleDateString('fr-CA')} par ${contract.signerName}.</p>
                    <p style="margin-top:12px;color:#64748b">Merci de votre confiance!</p>
                </div>`;
            return;
        }

        document.body.innerHTML = `
            <div style="max-width:640px;width:100%">
                <div style="text-align:center;margin-bottom:24px">
                    <img src="assets/logo.png" style="height:50px" alt="Portes et Fenêtres LGC">
                </div>
                <div style="background:white;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);overflow:hidden">
                    <div style="background:#B22234;color:white;padding:20px 24px">
                        <h1 style="font-size:20px;margin:0">Contrat à signer</h1>
                        <p style="opacity:.8;font-size:13px;margin:4px 0 0">Portes et Fenêtres LGC</p>
                    </div>
                    <div style="padding:24px">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:14px">
                            <div><strong style="color:#64748b;font-size:11px;text-transform:uppercase">Client</strong><br>${contract.clientName}</div>
                            <div><strong style="color:#64748b;font-size:11px;text-transform:uppercase">Montant</strong><br>${Number(contract.amount).toLocaleString('fr-CA', {style:'currency',currency:'CAD'})}</div>
                            <div style="grid-column:1/-1"><strong style="color:#64748b;font-size:11px;text-transform:uppercase">Description</strong><br>${contract.description || 'Travaux de portes et fenêtres'}</div>
                            ${contract.annexe ? `<div style="grid-column:1/-1"><strong style="color:#64748b;font-size:11px;text-transform:uppercase">Conditions particulières</strong><br>${contract.annexe}</div>` : ''}
                        </div>

                        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">

                        <div style="margin-bottom:16px">
                            <label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase">Nom complet du signataire *</label>
                            <input type="text" id="ext-sign-name" value="${contract.clientName}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:15px;box-sizing:border-box">
                        </div>

                        <div style="margin-bottom:16px">
                            <label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase">Votre signature (dessinez avec le doigt ou la souris) *</label>
                            <canvas id="ext-sign-canvas" width="560" height="160" style="border:2px solid #e2e8f0;border-radius:8px;cursor:crosshair;width:100%;background:white;touch-action:none"></canvas>
                            <button onclick="document.getElementById('ext-sign-canvas').getContext('2d').clearRect(0,0,560,160)" style="margin-top:6px;background:none;border:1px solid #cbd5e1;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px;color:#64748b">Effacer</button>
                        </div>

                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:20px;font-size:13px;color:#475569">
                            <input type="checkbox" id="ext-sign-accept" style="margin-top:3px">
                            <span>J'ai lu et j'accepte les termes de ce contrat. Je confirme que la signature ci-dessus est la mienne et qu'elle a la même valeur légale qu'une signature manuscrite.</span>
                        </label>

                        <button id="ext-sign-btn" onclick="App._handleExternalSign('${token}')" style="width:100%;padding:14px;background:#B22234;color:white;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer">
                            ✍️ Signer le contrat
                        </button>

                        <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px">
                            En signant, vous acceptez les conditions du contrat.<br>
                            Portes et Fenêtres LGC — (418) 549-7837 — pflgc.com
                        </p>
                    </div>
                </div>
            </div>
        `;

        // Init signature canvas
        setTimeout(() => {
            const canvas = document.getElementById('ext-sign-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            let drawing = false;

            const getPos = (e) => {
                const r = canvas.getBoundingClientRect();
                const sx = canvas.width / r.width;
                const sy = canvas.height / r.height;
                const cx = e.touches ? e.touches[0].clientX : e.clientX;
                const cy = e.touches ? e.touches[0].clientY : e.clientY;
                return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
            };
            const start = (e) => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
            const draw = (e) => { if (!drawing) return; e.preventDefault(); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
            const stop = () => { drawing = false; };

            canvas.addEventListener('mousedown', start);
            canvas.addEventListener('mousemove', draw);
            canvas.addEventListener('mouseup', stop);
            canvas.addEventListener('mouseleave', stop);
            canvas.addEventListener('touchstart', start, { passive: false });
            canvas.addEventListener('touchmove', draw, { passive: false });
            canvas.addEventListener('touchend', stop);
        }, 50);
    }

    function _handleExternalSign(token) {
        const name = document.getElementById('ext-sign-name')?.value?.trim();
        const checkbox = document.getElementById('ext-sign-accept')?.checked;
        const canvas = document.getElementById('ext-sign-canvas');

        if (!name) { alert('Veuillez entrer votre nom complet.'); return; }
        if (!checkbox) { alert('Veuillez accepter les termes du contrat.'); return; }

        // Check signature not empty
        const ctx = canvas?.getContext('2d');
        const data = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
        let hasSignature = false;
        if (data) { for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) { hasSignature = true; break; } } }
        if (!hasSignature) { alert('Veuillez dessiner votre signature.'); return; }

        const signatureImage = canvas.toDataURL('image/png');

        // Save signature in localStorage
        const contracts = JSON.parse(localStorage.getItem('crm_contracts') || '[]');
        const idx = contracts.findIndex(c => c.signToken === token);
        if (idx === -1) { alert('Contrat non trouvé.'); return; }

        contracts[idx].signed = true;
        contracts[idx].signDate = new Date().toISOString();
        contracts[idx].signerName = name;
        contracts[idx].signerIP = 'Web';
        contracts[idx].signatureImage = signatureImage;
        localStorage.setItem('crm_contracts', JSON.stringify(contracts));

        // Show success
        document.body.innerHTML = `
            <div style="max-width:560px;width:100%;text-align:center;padding:60px 24px">
                <img src="assets/logo.png" style="height:60px;margin-bottom:24px" alt="LGC">
                <div style="font-size:60px;margin-bottom:16px">✅</div>
                <h1 style="color:#10b981;font-size:28px">Contrat signé!</h1>
                <p style="color:#64748b;margin-top:12px;font-size:16px">Merci ${name}!</p>
                <p style="color:#64748b;margin-top:8px">Votre contrat a été signé avec succès le ${new Date().toLocaleDateString('fr-CA')} à ${new Date().toLocaleTimeString('fr-CA')}.</p>
                <p style="color:#64748b;margin-top:16px">L'équipe de Portes et Fenêtres LGC vous contactera pour la suite des étapes.</p>
                <div style="margin-top:32px;padding:16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#166534">
                    <strong>Prochaines étapes:</strong><br>
                    1. Confirmation de réception par courriel<br>
                    2. Planification de la prise de mesures<br>
                    3. Commande des matériaux<br>
                    4. Planification de l'installation
                </div>
                <p style="margin-top:24px"><a href="tel:4188320330" style="color:#B22234;font-weight:600;text-decoration:none">📞 (418) 549-7837</a> | <a href="https://www.pflgc.com" style="color:#B22234;text-decoration:none">pflgc.com</a></p>
            </div>`;
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

        // Init email templates
        initEmailTemplates();

        // Load SAV data
        SAV.loadTickets();

        // Update SAV badge
        updateSAVBadge();

        // Init chatbot
        if (typeof Chatbot !== 'undefined') Chatbot.init();

        // Init new modules
        if (typeof Activities !== 'undefined' && Activities.getOverdue) updateActivityBadge();
        if (typeof Automations !== 'undefined' && Automations.startPeriodicCheck) Automations.startPeriodicCheck();

        // Initial render
        renderCurrentView();
        Alerts.refresh();

        // Show daily summary banner
        showDailyBanner(user);

        // Auto-detect M365 services (background, don't block)
        if (!Auth.isDemoMode()) {
            Graph.detectServices().then(status => {
                renderM365Status(status);
                // If SharePoint detected and not configured, show hint
                if (status.sharepoint?.status === 'detected' && status.sharepoint.recommended) {
                    const spInput = document.getElementById('setting-sp-site');
                    if (spInput && !spInput.value) {
                        spInput.value = status.sharepoint.recommended;
                    }
                }
            }).catch(() => {});
        }
    }

    // ===== NAVIGATION =====
    function navigate(view) {
        currentView = view;

        // Close mobile sidebar when navigating
        document.body.classList.remove('sidebar-open');

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
            sav: 'Service après-vente',
            directory: 'Répertoire des contacts',
            contacts: 'Contacts',
            activities: 'Activités',
            automations: 'Automatisations',
            'import-export': 'Import / Export',
            settings: 'Paramètres',
        };
        const pageTitleEl = document.getElementById('page-title');
        if (pageTitleEl) pageTitleEl.textContent = titles[view] || view;

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
            case 'sav':
                SAV.render();
                break;
            case 'directory':
                Directory.render();
                break;
            case 'contacts':
                if (typeof Contacts !== 'undefined') Contacts.render();
                break;
            case 'activities':
                if (typeof Activities !== 'undefined') Activities.render();
                break;
            case 'automations':
                if (typeof Automations !== 'undefined') Automations.render();
                break;
            case 'import-export':
                if (typeof ImportExport !== 'undefined') ImportExport.render();
                break;
            case 'settings':
                if (typeof CustomFields !== 'undefined') CustomFields.render();
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

        // Monthly Objective Progress Bar
        renderMonthlyObjective();

        // Money at Risk Widget (directors only)
        if (Auth.isDirector()) {
            renderMoneyAtRisk();
            renderLeaderboard();
        }

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

    // ===== DAILY BANNER =====
    function showDailyBanner(user) {
        const existing = document.getElementById('daily-banner');
        if (existing) existing.remove();

        const allDeals = Deals.getAll();
        const userId = user.id;
        const isDir = Auth.isDirector();
        const myDeals = isDir ? allDeals : allDeals.filter(d => d.assignedTo === userId);
        const activeDeals = myDeals.filter(d => d.status === 'active');

        // Overdue follow-ups (deals with followUpDueDate in the past)
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        let overdueFollowUps = 0;
        activeDeals.forEach(d => {
            if (d.followUpDueDate && d.followUpDueDate < todayStr) overdueFollowUps++;
        });

        // Deals inactive 5+ days
        let inactiveDeals = 0;
        activeDeals.forEach(d => {
            const daysSince = Deals.getDaysSince(d.updatedAt);
            if (daysSince >= 5) inactiveDeals++;
        });

        // Tasks assigned to user
        let taskCount = 0;
        if (typeof Team !== 'undefined' && Team.getTasksForUser) {
            taskCount = Team.getTasksForUser(userId).filter(t => t.status !== 'done').length;
        }

        // Also count overdue stage alerts
        const overdueAlerts = activeDeals.filter(d => Deals.isOverdue(d)).length;
        overdueFollowUps = Math.max(overdueFollowUps, overdueAlerts);

        const firstName = user.name.split(' ')[0];
        const banner = document.createElement('div');
        banner.id = 'daily-banner';
        banner.className = 'daily-banner';
        banner.innerHTML = `
            <div class="daily-banner-text">
                <span class="greeting">Bonjour ${firstName}! 🔥</span>
                <div class="daily-banner-stats">
                    ${overdueFollowUps > 0 ? `<span class="daily-banner-stat">🔴 ${overdueFollowUps} relance${overdueFollowUps > 1 ? 's' : ''} en retard</span>` : ''}
                    ${inactiveDeals > 0 ? `<span class="daily-banner-stat">⏳ ${inactiveDeals} deal${inactiveDeals > 1 ? 's' : ''} inactif${inactiveDeals > 1 ? 's' : ''}</span>` : ''}
                    ${taskCount > 0 ? `<span class="daily-banner-stat">📋 ${taskCount} tache${taskCount > 1 ? 's' : ''}</span>` : ''}
                    ${overdueFollowUps === 0 && inactiveDeals === 0 && taskCount === 0 ? '<span class="daily-banner-stat">✅ Tout est sous controle!</span>' : ''}
                </div>
            </div>
            <button class="daily-banner-close" onclick="document.getElementById('daily-banner').remove()">✕</button>
        `;

        const viewDashboard = document.getElementById('view-dashboard');
        if (viewDashboard) {
            viewDashboard.insertBefore(banner, viewDashboard.firstChild);
        }
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
            'clientName', 'clientPhone', 'clientPhone2', 'clientEmail', 'clientEmail2', 'clientAddress',
            'accountNumber', 'clientType', 'leadSource', 'projectType', 'products', 'description',
            'quoteAmount', 'contractAmount', 'stage', 'assignedTo',
            'mecinovQuoteNum', 'mecinovOrderNum', 'mecinovInvoiceNum',
            'avantageInvoiceNum', 'shopifyOrderNum',
            'depositRequired', 'depositReceived', 'paymentStatus',
            'leadDate', 'assignDate', 'quoteDueDate', 'quoteSentDate',
            'lastFollowUp', 'followUpDueDate',
            'contractSignDate', 'depositDate', 'supplierOrderDate',
            'measurementDate', 'installDate', 'completedDate',
            'probability',
        ];

        fields.forEach(field => {
            const input = form.querySelector(`[name="${field}"]`);
            if (input && deal[field] !== undefined) {
                input.value = deal[field] || '';
            }
        });

        // Update probability display
        const probInput = document.getElementById('deal-probability');
        const probValue = document.getElementById('deal-probability-value');
        if (probInput) {
            probInput.value = deal.probability || 50;
            if (probValue) probValue.textContent = (deal.probability || 50) + '%';
        }

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

        // Timeline
        renderDealTimeline(dealId);

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

    function openGoogleMaps() {
        const address = document.getElementById('deal-client-address')?.value?.trim();
        if (!address) { showToast('Entrez une adresse d\'abord', 'warning'); return; }
        window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address), '_blank');
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
            } else if (key === 'probability') {
                data[key] = value ? parseInt(value, 10) : 50;
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
            // Detect stage change for auto-follow-ups and stage logging
            const oldDeal = Deals.getById(editingDealId);
            const oldStage = oldDeal ? oldDeal.stage : null;
            const newStage = data.stage;

            await Deals.update(editingDealId, data);
            Clients.syncFromDeal(data);
            if (noteText) {
                await Deals.addNote(editingDealId, noteText);
                form.querySelector('[name="newNote"]').value = '';
            }

            // Auto-log stage change as timeline entry
            if (oldStage && newStage && oldStage !== newStage) {
                await Deals.addNote(editingDealId,
                    `Etape changee: ${Deals.getStageName(oldStage)} → ${Deals.getStageName(newStage)}`,
                    { type: 'stage', icon: '🔄' }
                );
            }

            // Auto-scheduled follow-ups: stage 5 → +2 days
            if (newStage === 5 && oldStage !== 5) {
                const followDate = skipWeekends(new Date(), 2);
                const followDateStr = followDate.toISOString().split('T')[0];
                await Deals.update(editingDealId, { followUpDueDate: followDateStr });
                await Deals.addNote(editingDealId,
                    `📋 Relance automatique programmee pour ${Deals.formatDate(followDateStr)}`,
                    { type: 'auto', icon: '📋' }
                );
            }

            // Auto-scheduled follow-ups: stage 6 → +3 days
            if (newStage === 6 && oldStage !== 6) {
                const followDate = skipWeekends(new Date(), 3);
                const followDateStr = followDate.toISOString().split('T')[0];
                await Deals.update(editingDealId, { followUpDueDate: followDateStr });
                const currentDeal = Deals.getById(editingDealId);
                if (currentDeal && (currentDeal.followUpCount || 0) >= 3) {
                    await Deals.addNote(editingDealId,
                        `⚠️ 3e relance - Relance automatique programmee pour ${Deals.formatDate(followDateStr)}`,
                        { type: 'auto', icon: '⚠️' }
                    );
                } else {
                    await Deals.addNote(editingDealId,
                        `📋 Relance automatique programmee pour ${Deals.formatDate(followDateStr)}`,
                        { type: 'auto', icon: '📋' }
                    );
                }
            }

            // Confetti on deal completed (stage 14 or won)
            if ((newStage === 14 && oldStage !== 14) || (data.status === 'won')) {
                triggerConfetti();
            }
        } else {
            if (!data.clientName || !data.clientPhone || !data.clientEmail) {
                showToast('Nom, téléphone et courriel sont requis', 'error');
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

        const typeIcons = {
            note: '📝',
            call: '📞',
            email: '📧',
            noreply: '❌',
            stage: '🔄',
            auto: '⚙️',
        };

        container.innerHTML = `<div class="activity-timeline">` + notes.map(note => {
            const nType = note.noteType || 'note';
            const icon = note.noteIcon || typeIcons[nType] || '📝';
            return `
                <div class="timeline-entry type-${nType}">
                    <span class="timeline-icon">${icon}</span>
                    <span class="timeline-author">${note.author}</span>
                    <div class="timeline-text">${note.noteText}</div>
                    <span class="timeline-date">${Deals.formatDate(note.noteDate)}</span>
                </div>
            `;
        }).join('') + `</div>`;
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

        // Shared mailbox
        const sharedMailbox = localStorage.getItem('crm_sharedMailbox') || '';
        const el9 = document.getElementById('setting-shared-mailbox');
        if (el9) el9.value = sharedMailbox;

        // Show cached M365 status
        try {
            const cached = localStorage.getItem('crm_m365_status');
            if (cached) renderM365Status(JSON.parse(cached));
        } catch (e) { /* ignore */ }

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

        // Team members editor
        renderTeamSettings();

        // Install teams config
        if (typeof Installations !== 'undefined' && Installations.renderTeamConfig) {
            Installations.renderTeamConfig();
        }

        // Email templates list in settings
        showEmailTemplatesManager();

        // Shopify settings
        const shopifyStore = localStorage.getItem('crm_shopifyStore') || '';
        const shopifyToken = localStorage.getItem('crm_shopifyToken') || '';
        const el7 = document.getElementById('setting-shopify-store');
        const el8 = document.getElementById('setting-shopify-token');
        if (el7) el7.value = shopifyStore;
        if (el8) el8.value = shopifyToken;

        // Email signature settings
        loadSignatureSettings();
    }

    function loadSignatureSettings() {
        const sig = JSON.parse(localStorage.getItem('crm_emailSignature') || '{}');
        const user = Auth.getUser();
        const elName = document.getElementById('setting-sig-name');
        const elTitle = document.getElementById('setting-sig-title');
        const elPhone = document.getElementById('setting-sig-phone');
        const elDirect = document.getElementById('setting-sig-direct');
        const elAddr = document.getElementById('setting-sig-address');
        const elWeb = document.getElementById('setting-sig-website');
        const elLogo = document.getElementById('setting-sig-logo');
        if (elName) elName.value = sig.name || user?.name || '';
        if (elTitle) elTitle.value = sig.title || '';
        if (elPhone) elPhone.value = sig.phone || '(418) 549-7837';
        if (elDirect) elDirect.value = sig.direct || '';
        if (elAddr) elAddr.value = sig.address || '1292, boul. Saint-Paul, Chicoutimi, QC G7J 3C5';
        if (elWeb) elWeb.value = sig.website || 'www.pflgc.com';
        if (elLogo) elLogo.value = sig.logoUrl || '';

        // Render preview
        renderSignaturePreview();
    }

    function saveSignatureSettings() {
        const sig = {
            name: document.getElementById('setting-sig-name')?.value || '',
            title: document.getElementById('setting-sig-title')?.value || '',
            phone: document.getElementById('setting-sig-phone')?.value || '(418) 549-7837',
            direct: document.getElementById('setting-sig-direct')?.value || '',
            address: document.getElementById('setting-sig-address')?.value || '',
            website: document.getElementById('setting-sig-website')?.value || 'www.pflgc.com',
            logoUrl: document.getElementById('setting-sig-logo')?.value || '',
        };
        localStorage.setItem('crm_emailSignature', JSON.stringify(sig));
        // Force refresh templates to remove old cached versions with inline signatures
        localStorage.removeItem('crm_emailTemplates');
        showToast('Signature sauvegardée!', 'success');
        renderSignaturePreview();
    }

    function renderSignaturePreview() {
        const preview = document.getElementById('sig-preview');
        if (!preview) return;
        const user = Auth.getUser();
        const html = getEmailSignature(user?.name || 'Votre nom', user?.email || 'votre@pflgc.com');
        preview.innerHTML = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;font-weight:700">APERÇU DE LA SIGNATURE:</div>' + html;
    }

    function saveSettings() {
        const el1 = document.getElementById('setting-relance-delay');
        const el2 = document.getElementById('setting-lead-delay');
        const el3 = document.getElementById('setting-net30-delay');
        if (el1) localStorage.setItem('crm_relanceDelay', el1.value);
        if (el2) localStorage.setItem('crm_leadDelay', el2.value);
        if (el3) localStorage.setItem('crm_net30Delay', el3.value);
    }

    // ===== M365 CONNECTION TEST =====
    async function testM365Connections() {
        const btn = document.getElementById('btn-test-m365');
        if (btn) btn.textContent = '⏳ Test en cours...';

        if (Auth.isDemoMode()) {
            renderM365Status({ sharepoint: 'no-auth', outlook: 'no-auth', calendar: 'no-auth' });
            if (btn) btn.textContent = '🔄 Tester les connexions';
            showToast('Connectez-vous avec M365 pour tester', 'warning');
            return;
        }

        try {
            const status = await Graph.detectServices();
            renderM365Status(status);

            // Auto-fill SharePoint site if detected
            if (status.sharepoint?.status === 'detected' && status.sharepoint.recommended) {
                const spInput = document.getElementById('setting-sp-site');
                const sugDiv = document.getElementById('sp-site-suggestions');
                if (spInput && !spInput.value) {
                    spInput.value = status.sharepoint.recommended;
                }
                if (sugDiv && status.sharepoint.sites) {
                    sugDiv.innerHTML = '<strong>Sites détectés:</strong> ' +
                        status.sharepoint.sites.map(s =>
                            `<a href="#" onclick="document.getElementById('setting-sp-site').value='${s.url}';return false;" style="color:var(--primary);text-decoration:underline;margin:0 4px">${s.name}</a>`
                        ).join(' | ');
                }
            }

            // Summary toast
            const connected = [
                status.sharepoint?.status === 'connected' ? 'SharePoint' : null,
                status.outlook?.status === 'connected' || status.outlook?.status === 'shared' ? 'Outlook' : null,
                status.calendar?.status === 'connected' ? 'Calendrier' : null,
            ].filter(Boolean);
            if (connected.length > 0) {
                showToast(`Connecté: ${connected.join(', ')}`, 'success');
            } else {
                showToast('Aucun service M365 connecté — voir les détails', 'warning');
            }
        } catch (e) {
            showToast('Erreur test M365: ' + e.message, 'error');
        }

        if (btn) btn.textContent = '🔄 Tester les connexions';
    }

    function renderM365Status(status) {
        const labels = {
            connected: 'Connecté',
            shared: 'Boîte partagée',
            detected: 'Détecté',
            'not-configured': 'Non configuré',
            'no-mailbox': 'Pas de boîte',
            'no-auth': 'Non connecté',
            error: 'Erreur',
            unknown: 'Non testé',
        };

        const connectedState = (s) => {
            if (!s || typeof s === 'string') return s || 'unknown';
            return s.status || 'unknown';
        };

        const cardState = (s) => {
            const st = connectedState(s);
            if (st === 'connected') return 'true';
            if (st === 'shared' || st === 'detected') return 'warning';
            if (st === 'error' || st === 'no-mailbox') return 'error';
            return '';
        };

        // SharePoint
        const spCard = document.getElementById('m365-sp-status');
        if (spCard) {
            const st = connectedState(status.sharepoint);
            spCard.dataset.connected = cardState(status.sharepoint);
            spCard.querySelector('.m365-status-badge').dataset.status = st;
            spCard.querySelector('.m365-status-badge').textContent = labels[st] || st;
        }

        // Outlook
        const mailCard = document.getElementById('m365-mail-status');
        if (mailCard) {
            const st = connectedState(status.outlook);
            mailCard.dataset.connected = cardState(status.outlook);
            const badge = mailCard.querySelector('.m365-status-badge');
            badge.dataset.status = st;
            badge.textContent = labels[st] || st;
            if (st === 'shared' && status.outlook?.mailbox) {
                badge.textContent = `Via ${status.outlook.mailbox}`;
            }
        }

        // Calendar
        const calCard = document.getElementById('m365-cal-status');
        if (calCard) {
            const st = connectedState(status.calendar);
            calCard.dataset.connected = cardState(status.calendar);
            calCard.querySelector('.m365-status-badge').dataset.status = st;
            calCard.querySelector('.m365-status-badge').textContent = labels[st] || st;
        }

        // Details
        const details = document.getElementById('m365-status-details');
        if (details) {
            const msgs = [];
            if (status.outlook?.status === 'no-mailbox') {
                msgs.push('⚠️ Votre compte M365 n\'a pas de boîte Outlook. Configurez une boîte partagée ci-dessous (ex: soumission@pflgc.com).');
            }
            if (status.calendar?.status === 'no-mailbox') {
                msgs.push('⚠️ Calendrier non disponible — lié à la boîte Outlook manquante. Utilisez un compte avec boîte mail.');
            }
            if (status.sharepoint?.status === 'detected') {
                msgs.push('ℹ️ SharePoint détecté mais pas encore configuré. Cliquez sur un site suggéré et sauvegardez.');
            }
            if (status.sharepoint?.status === 'error') {
                msgs.push('❌ SharePoint: ' + (status.sharepoint.message || 'erreur inconnue'));
            }
            details.innerHTML = msgs.map(m => `<p style="margin:4px 0">${m}</p>`).join('');
        }
    }

    // ===== TEAM SETTINGS EDITOR =====
    function renderTeamSettings() {
        const container = document.getElementById('team-settings');
        if (!container) return;

        const team = Auth.getTeamMembers();
        const roles = [
            { value: 'directeur', label: 'Directeur' },
            { value: 'vendeur', label: 'Vendeur' },
            { value: 'directeur_usine', label: 'Directeur usine' },
            { value: 'reception', label: 'Réception' },
            { value: 'installateur', label: 'Installateur' },
            { value: 'admin', label: 'Admin' },
        ];

        container.innerHTML = `
            <div class="team-members-list">
                ${team.map(m => `
                    <div class="team-member-row" data-id="${m.id}">
                        <span class="team-member-avatar" style="background:var(--primary);color:#fff;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600">${m.initials}</span>
                        <input type="text" class="input-sm team-edit-name" value="${m.name}" placeholder="Nom" style="flex:2;min-width:120px">
                        <input type="email" class="input-sm team-edit-email" value="${m.email}" placeholder="Courriel" style="flex:2;min-width:150px">
                        <select class="input-sm team-edit-role" style="flex:1;min-width:100px">
                            ${roles.map(r => `<option value="${r.value}" ${m.role === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
                        </select>
                        <button class="btn btn-sm btn-outline btn-save-member" data-id="${m.id}" title="Sauvegarder">💾</button>
                        <button class="btn btn-sm btn-outline btn-delete-member" data-id="${m.id}" title="Supprimer" style="color:#B22234">✕</button>
                    </div>
                `).join('')}
            </div>
        `;

        // Save member buttons
        container.querySelectorAll('.btn-save-member').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.team-member-row');
                const id = btn.dataset.id;
                Auth.updateTeamMember(id, {
                    name: row.querySelector('.team-edit-name').value,
                    email: row.querySelector('.team-edit-email').value,
                    role: row.querySelector('.team-edit-role').value,
                });
                showToast('Membre mis à jour', 'success');
                renderTeamSettings();
            });
        });

        // Delete member buttons
        container.querySelectorAll('.btn-delete-member').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Supprimer ce membre de l\'équipe?')) {
                    Auth.removeTeamMember(btn.dataset.id);
                    showToast('Membre supprimé', 'success');
                    renderTeamSettings();
                }
            });
        });
    }

    function addTeamMember() {
        const name = prompt('Nom complet du nouveau membre:');
        if (!name) return;
        const email = prompt('Courriel (@pflgc.com):');
        if (!email) return;
        const role = prompt('Rôle (directeur, vendeur, installateur, reception):') || 'vendeur';
        Auth.addTeamMember({ name, email, role });
        showToast(`${name} ajouté à l'équipe`, 'success');
        renderTeamSettings();
    }

    // ===== EMAIL COMPOSE =====
    function openEmailCompose(dealId, template) {
        const deal = dealId ? Deals.getById(dealId) : null;
        const user = Auth.getUser();

        // Default values
        let to = deal?.clientEmail || '';
        let subject = '';
        let body = '';

        if (template === 'soumission') {
            subject = `Soumission - Portes et Fenêtres LGC - ${deal?.clientName || ''}`;
            body = `Bonjour ${deal?.clientName || ''},\n\nVeuillez trouver ci-joint notre soumission pour votre projet.\n\nN'hésitez pas à nous contacter pour toute question.`;
        } else if (template === 'relance') {
            subject = `Suivi de votre soumission - Portes et Fenêtres LGC`;
            body = `Bonjour ${deal?.clientName || ''},\n\nJe fais suite à la soumission que nous vous avons envoyée. Avez-vous eu le temps de la consulter?\n\nJe reste disponible pour en discuter ou apporter des modifications.`;
        } else if (template === 'contrat') {
            subject = `Contrat à signer - Portes et Fenêtres LGC - ${deal?.clientName || ''}`;
            body = `Bonjour ${deal?.clientName || ''},\n\nVeuillez trouver ci-joint votre contrat. Merci de le signer et nous le retourner.`;
        }

        const modal = document.getElementById('modal-email-compose');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.getElementById('email-compose-to').value = to;
        document.getElementById('email-compose-subject').value = subject;
        document.getElementById('email-compose-body').value = body;
        modal.dataset.dealId = dealId || '';

        // Show attachments from deal
        const attachContainer = document.getElementById('email-compose-attachments');
        if (attachContainer && deal) {
            const attachments = getAttachments(dealId);
            if (attachments.length > 0) {
                attachContainer.innerHTML = '<label style="font-size:12px;color:var(--text-muted)">Pièces jointes du deal:</label>' +
                    attachments.map(a => `
                        <label class="email-attach-option" style="display:flex;align-items:center;gap:6px;font-size:13px;padding:4px 0">
                            <input type="checkbox" class="email-attach-check" data-id="${a.id}" data-name="${a.name}" data-content="${a.content || ''}">
                            ${getFileIcon(a.name).icon} ${a.name}
                        </label>
                    `).join('');
            } else {
                attachContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Aucun fichier attaché au deal</span>';
            }
        }
    }

    async function sendComposedEmail() {
        const to = document.getElementById('email-compose-to')?.value;
        const subject = document.getElementById('email-compose-subject')?.value;
        const bodyRaw = document.getElementById('email-compose-body')?.value;

        if (!to || !subject) {
            showToast('Remplir le destinataire et l\'objet', 'error');
            return;
        }

        if (Auth.isDemoMode()) {
            // Demo: simulate send
            const dealId = document.getElementById('modal-email-compose')?.dataset.dealId;
            if (dealId) {
                addActivity('Courriel envoyé', `À: ${to} — ${subject}`, dealId);
                await Deals.addNote(dealId, '📧 Courriel envoyé à ' + to + ': ' + subject, { type: 'email', icon: '📧' });
            }
            document.getElementById('modal-email-compose')?.classList.add('hidden');
            showToast('Courriel simulé (mode démo)', 'success');
            return;
        }

        // Check mailbox availability
        const mailStatus = Graph.getServiceStatus().outlook;
        if (mailStatus?.status === 'no-mailbox') {
            const sharedMailbox = localStorage.getItem('crm_sharedMailbox') || '';
            if (!sharedMailbox) {
                showToast('Votre compte n\'a pas de boîte Outlook. Configurez une boîte partagée dans Paramètres → M365.', 'warning');
                return;
            }
        }

        const sendBtn = document.getElementById('btn-send-composed-email');
        if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ Envoi...'; }

        try {
            // Collect checked attachments
            const attachments = [];
            document.querySelectorAll('.email-attach-check:checked').forEach(cb => {
                if (cb.dataset.content) {
                    attachments.push({
                        name: cb.dataset.name,
                        contentBytes: cb.dataset.content,
                    });
                }
            });

            // Build HTML body with signature
            const user = Auth.getUser();
            const signature = getEmailSignature(user?.name, user?.email);
            const htmlBody = bodyRaw.replace(/\n/g, '<br>') + signature;

            await Graph.sendEmail(to, subject, htmlBody, null, attachments);
            showToast('Courriel envoyé avec signature!', 'success');
            document.getElementById('modal-email-compose')?.classList.add('hidden');

            // Log activity
            const dealId = document.getElementById('modal-email-compose')?.dataset.dealId;
            if (dealId) {
                addActivity('Courriel envoyé', `À: ${to} — ${subject}`, dealId);
                await Deals.addNote(dealId, '📧 Courriel envoyé à ' + to + ': ' + subject, { type: 'email', icon: '📧' });
            }
        } catch (e) {
            showToast('Erreur envoi: ' + e.message, 'error');
        } finally {
            if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 Envoyer'; }
        }
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

    // ===== MONTHLY OBJECTIVE =====
    function renderMonthlyObjective() {
        let container = document.getElementById('monthly-objective-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'monthly-objective-container';
            const dashView = document.getElementById('view-dashboard');
            const banner = document.getElementById('daily-banner');
            const alertsSection = document.getElementById('alerts-section');
            const insertBefore = alertsSection || dashView?.firstChild;
            if (banner && banner.nextSibling) {
                dashView.insertBefore(container, banner.nextSibling);
            } else if (insertBefore) {
                dashView.insertBefore(container, insertBefore);
            }
        }

        const objective = parseInt(localStorage.getItem('crm_monthlyObjective') || '150000');
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const wonThisMonth = Deals.getAll()
            .filter(d => d.status === 'won' && d.completedDate && d.completedDate >= monthStart);
        const revenue = wonThisMonth.reduce((sum, d) => sum + (d.contractAmount || d.quoteAmount || 0), 0);
        const pct = Math.min(100, Math.round((revenue / objective) * 100));
        const colorClass = pct >= 75 ? 'green' : pct >= 50 ? 'yellow' : 'red';

        container.innerHTML = `
            <div class="monthly-objective">
                <div class="monthly-objective-header">
                    <span class="monthly-objective-title">🎯 Objectif mensuel</span>
                    <span class="monthly-objective-values">
                        ${Deals.formatMoney(revenue)} / ${Deals.formatMoney(objective)}
                        <button class="monthly-objective-edit" onclick="App.editMonthlyObjective()">modifier</button>
                    </span>
                </div>
                <div class="monthly-objective-bar">
                    <div class="monthly-objective-fill ${colorClass}" style="width: ${Math.max(pct, 5)}%">
                        ${pct}%
                    </div>
                </div>
            </div>
        `;
    }

    function editMonthlyObjective() {
        const current = localStorage.getItem('crm_monthlyObjective') || '150000';
        const newVal = prompt('Nouvel objectif mensuel ($):', current);
        if (newVal && !isNaN(parseInt(newVal))) {
            localStorage.setItem('crm_monthlyObjective', parseInt(newVal).toString());
            renderMonthlyObjective();
            showToast('Objectif mis a jour', 'success');
        }
    }

    // ===== MONEY AT RISK WIDGET =====
    function renderMoneyAtRisk() {
        let container = document.getElementById('money-risk-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'money-risk-container';
            const kpiGrid = document.querySelector('#view-dashboard .kpi-grid');
            if (kpiGrid) kpiGrid.parentNode.insertBefore(container, kpiGrid.nextSibling);
        }

        const allDeals = Deals.getAll();
        const active = allDeals.filter(d => d.status === 'active');
        const pipelineTotal = active.reduce((sum, d) => sum + (d.quoteAmount || 0), 0);

        // At risk: active deals with > 10 days since update
        const atRiskDeals = active.filter(d => Deals.getDaysSince(d.updatedAt) > 10);
        const atRiskValue = atRiskDeals.reduce((sum, d) => sum + (d.quoteAmount || 0), 0);

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const wonThisMonth = allDeals.filter(d => d.status === 'won' && d.completedDate && d.completedDate >= monthStart);
        const wonValue = wonThisMonth.reduce((sum, d) => sum + (d.contractAmount || d.quoteAmount || 0), 0);

        const lostThisMonth = allDeals.filter(d => d.status === 'lost' && d.completedDate && d.completedDate >= monthStart);
        const lostValue = lostThisMonth.reduce((sum, d) => sum + (d.quoteAmount || 0), 0);

        container.innerHTML = `
            <div class="money-risk-widget">
                <h3 class="section-title">💰 Argent en jeu</h3>
                <div class="money-risk-grid">
                    <div class="money-risk-item active">
                        <div class="money-risk-value">${Deals.formatMoney(pipelineTotal)}</div>
                        <div class="money-risk-label">Pipeline actif</div>
                    </div>
                    <div class="money-risk-item risk">
                        <div class="money-risk-value">${Deals.formatMoney(atRiskValue)}</div>
                        <div class="money-risk-label">🔥 A risque >10j (${atRiskDeals.length} deals)</div>
                    </div>
                    <div class="money-risk-item won">
                        <div class="money-risk-value">${Deals.formatMoney(wonValue)}</div>
                        <div class="money-risk-label">✅ Ferme ce mois</div>
                    </div>
                    <div class="money-risk-item lost">
                        <div class="money-risk-value">${Deals.formatMoney(lostValue)}</div>
                        <div class="money-risk-label">📉 Perdu ce mois</div>
                    </div>
                </div>
            </div>
        `;
    }

    // ===== VENDOR LEADERBOARD =====
    function renderLeaderboard() {
        let container = document.getElementById('leaderboard-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'leaderboard-container';
            const recentActivity = document.querySelector('#view-dashboard .recent-activity');
            if (recentActivity) recentActivity.parentNode.insertBefore(container, recentActivity);
        }

        const team = Auth.getTeamMembers();
        const allDeals = Deals.getAll();
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

        const vendors = team.filter(m => ['vendeur', 'directeur', 'directeur_usine'].includes(m.role));
        const vendorStats = vendors.map(v => {
            const myDeals = allDeals.filter(d => d.assignedTo === v.id);
            const wonThisMonth = myDeals.filter(d => d.status === 'won' && d.completedDate && d.completedDate >= monthStart);
            const revenue = wonThisMonth.reduce((sum, d) => sum + (d.contractAmount || d.quoteAmount || 0), 0);

            // Calculate streak: consecutive wins from most recent
            const sorted = myDeals.filter(d => d.status === 'won' || d.status === 'lost')
                .sort((a, b) => new Date(b.completedDate || b.updatedAt) - new Date(a.completedDate || a.updatedAt));
            let streak = 0;
            for (const d of sorted) {
                if (d.status === 'won') streak++;
                else break;
            }

            return { ...v, wonCount: wonThisMonth.length, revenue, streak };
        }).sort((a, b) => b.revenue - a.revenue);

        if (vendorStats.length === 0) {
            container.innerHTML = '';
            return;
        }

        const rows = vendorStats.map((v, idx) => {
            const isLeader = idx === 0 && v.revenue > 0;
            const rankEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
            return `
                <tr class="${isLeader ? 'leader' : ''}">
                    <td class="leaderboard-rank">${rankEmoji}</td>
                    <td class="leaderboard-name">${v.name}</td>
                    <td>${v.wonCount}</td>
                    <td><strong>${Deals.formatMoney(v.revenue)}</strong></td>
                    <td>${v.streak > 0 ? `<span class="leaderboard-streak">🔥 ${v.streak}</span>` : '-'}</td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="leaderboard-section">
                <h3 class="section-title">🏆 Classement vendeurs (ce mois)</h3>
                <table class="leaderboard-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Vendeur</th>
                            <th>Deals fermes</th>
                            <th>Revenue</th>
                            <th>Streak</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    // ===== CONFETTI ANIMATION =====
    function triggerConfetti() {
        const canvas = document.createElement('canvas');
        canvas.id = 'confetti-canvas';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = [];
        const colors = ['#ff0', '#f00', '#0f0', '#c0392b', '#f0f', '#0ff', '#ff8c00', '#22c55e', '#a93226'];
        for (let i = 0; i < 150; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                w: Math.random() * 10 + 5,
                h: Math.random() * 6 + 3,
                color: colors[Math.floor(Math.random() * colors.length)],
                vx: (Math.random() - 0.5) * 4,
                vy: Math.random() * 3 + 2,
                rot: Math.random() * 360,
                rotSpeed: (Math.random() - 0.5) * 10,
            });
        }

        let frame = 0;
        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.rotSpeed;
                p.vy += 0.05;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rot * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            });
            frame++;
            if (frame < 180) {
                requestAnimationFrame(animate);
            } else {
                canvas.remove();
            }
        }
        animate();
    }

    // ===== SKIP WEEKENDS HELPER =====
    function skipWeekends(fromDate, addDays) {
        const d = new Date(fromDate);
        let added = 0;
        while (added < addDays) {
            d.setDate(d.getDate() + 1);
            if (d.getDay() !== 0 && d.getDay() !== 6) added++;
        }
        return d;
    }

    // ===== SAV BADGE =====
    function updateSAVBadge() {
        const badge = document.getElementById('badge-sav');
        if (badge && typeof SAV !== 'undefined') {
            const stats = SAV.getStats();
            if (stats.open > 0) {
                badge.textContent = stats.open;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    // ===== EMAIL SIGNATURE =====
    // Build absolute URL to logo, works on both localhost and Azure
    const LOGO_URL = (() => {
        const base = window.location.origin + window.location.pathname;
        // Remove trailing filename if any (e.g., index.html)
        const dir = base.endsWith('/') ? base : base.substring(0, base.lastIndexOf('/') + 1);
        return dir + 'assets/logo.png';
    })();

    function getEmailSignature(vendorName, vendorEmail) {
        const sigSettings = JSON.parse(localStorage.getItem('crm_emailSignature') || '{}');
        const displayName = sigSettings.name || vendorName || '';
        const displayTitle = sigSettings.title || '';
        const phone = sigSettings.phone || '(418) 549-7837';
        const direct = sigSettings.direct || '';
        const address = sigSettings.address || '1292, boul. Saint-Paul, Chicoutimi, QC G7J 3C5';
        const website = sigSettings.website || 'www.pflgc.com';
        const logoUrl = sigSettings.logoUrl || LOGO_URL;

        return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,sans-serif;font-size:13px;color:#333;margin-top:20px;border-top:2px solid #c0392b;padding-top:14px">
  <tr>
    <td style="padding-right:16px;vertical-align:top">
      <img src="${logoUrl}" alt="Portes et Fenêtres LGC" style="width:120px;height:auto" />
    </td>
    <td style="vertical-align:top;line-height:1.5">
      <strong style="font-size:14px;color:#c0392b">${displayName}</strong>${displayTitle ? `<br><span style="color:#888;font-size:12px">${displayTitle}</span>` : ''}<br>
      <span style="color:#666">${vendorEmail ? vendorEmail + '<br>' : ''}Portes et Fenêtres LGC</span><br>
      <span style="color:#666">📞 ${phone}</span>${direct ? `<br><span style="color:#666">📱 ${direct}</span>` : ''}<br>
      <span style="color:#666">📍 ${address}</span><br>
      <a href="https://${website}" style="color:#c0392b;text-decoration:none">🌐 ${website}</a>
    </td>
  </tr>
</table>`;
    }

    // ===== EMAIL TEMPLATES =====
    const DEFAULT_TEMPLATES = [
        {
            id: 'tpl_soumission',
            name: 'Envoi de soumission',
            subject: 'Votre soumission - Portes et Fenêtres LGC',
            body: 'Bonjour {clientName},\n\nVeuillez trouver ci-joint notre soumission pour un montant de {amount}.\n\nN\'hésitez pas à nous contacter pour toute question.',
        },
        {
            id: 'tpl_relance1',
            name: 'Relance #1 — Suivi soumission',
            subject: 'Suivi de notre soumission - Portes et Fenêtres LGC',
            body: 'Bonjour {clientName},\n\nJe fais suite à la soumission que nous vous avons envoyée récemment pour un montant de {amount}.\n\nAvez-vous eu la chance de la consulter? Je suis disponible pour répondre à vos questions.',
        },
        {
            id: 'tpl_relance2',
            name: 'Relance #2 — Dernière chance',
            subject: 'Dernière chance - Votre projet de portes et fenêtres',
            body: 'Bonjour {clientName},\n\nJe souhaitais vous relancer une dernière fois concernant votre projet.\n\nNotre soumission de {amount} reste valide pour une durée limitée. Si vous avez des questions ou souhaitez modifier le projet, n\'hésitez pas.',
        },
        {
            id: 'tpl_rdv',
            name: 'Confirmation de RDV',
            subject: 'Confirmation de votre rendez-vous - Portes et Fenêtres LGC',
            body: 'Bonjour {clientName},\n\nCeci est pour confirmer notre rendez-vous.\n\nN\'hésitez pas à me contacter si vous avez besoin de reporter.',
        },
        {
            id: 'tpl_acompte',
            name: 'Acompte reçu — Merci!',
            subject: 'Confirmation de réception de votre acompte - LGC',
            body: 'Bonjour {clientName},\n\nNous accusons réception de votre acompte. Merci!\n\nVotre commande est maintenant en cours de traitement. Nous vous tiendrons informé de la suite.',
        },
    ];

    function initEmailTemplates() {
        const saved = localStorage.getItem('crm_emailTemplates');
        if (!saved) {
            localStorage.setItem('crm_emailTemplates', JSON.stringify(DEFAULT_TEMPLATES));
        }
    }

    function getEmailTemplates() {
        const saved = localStorage.getItem('crm_emailTemplates');
        return saved ? JSON.parse(saved) : DEFAULT_TEMPLATES;
    }

    function openComposeEmail(dealId) {
        const deal = Deals.getById(dealId);
        if (!deal) return;

        const templates = getEmailTemplates();
        const user = Auth.getUser();
        const team = Auth.getTeamMembers();
        const vendor = team.find(t => t.id === deal.assignedTo) || user;

        // Create compose modal if not exist
        let modal = document.getElementById('modal-compose-email');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-compose-email';
            modal.className = 'modal hidden';
            modal.innerHTML = `
                <div class="modal-overlay" onclick="document.getElementById('modal-compose-email').classList.add('hidden')"></div>
                <div class="modal-content modal-lg" style="z-index:1">
                    <div class="modal-header">
                        <h3>📧 Envoyer un courriel</h3>
                        <button class="modal-close" onclick="document.getElementById('modal-compose-email').classList.add('hidden')">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>Modele</label>
                            <div id="compose-templates" class="compose-template-select"></div>
                        </div>
                        <div class="form-group">
                            <label>A</label>
                            <input type="email" id="compose-to" class="input-sm" style="width:100%">
                        </div>
                        <div class="form-group">
                            <label>Sujet</label>
                            <input type="text" id="compose-subject" class="input-sm" style="width:100%">
                        </div>
                        <div class="form-group">
                            <label>Message</label>
                            <textarea id="compose-body" rows="8" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);font-family:inherit;font-size:13px"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="document.getElementById('modal-compose-email').classList.add('hidden')">Annuler</button>
                        <button class="btn btn-primary" id="btn-send-compose">📤 Envoyer</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Populate
        document.getElementById('compose-to').value = deal.clientEmail || '';
        const templatesDiv = document.getElementById('compose-templates');
        templatesDiv.innerHTML = templates.map(tpl => `
            <div class="compose-template-option" data-tpl-id="${tpl.id}">
                ${tpl.name}
            </div>
        `).join('');

        // Template click handlers
        templatesDiv.querySelectorAll('.compose-template-option').forEach(opt => {
            opt.addEventListener('click', () => {
                templatesDiv.querySelectorAll('.compose-template-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                const tpl = templates.find(t => t.id === opt.dataset.tplId);
                if (tpl) {
                    const vars = {
                        '{clientName}': deal.clientName || '',
                        '{amount}': Deals.formatMoney(deal.quoteAmount || deal.contractAmount || 0),
                        '{vendorName}': vendor.name || '',
                        '{companyPhone}': '(418) 549-7837',
                    };
                    let body = tpl.body;
                    let subject = tpl.subject;
                    for (const [k, v] of Object.entries(vars)) {
                        body = body.split(k).join(v);
                        subject = subject.split(k).join(v);
                    }
                    document.getElementById('compose-subject').value = subject;
                    document.getElementById('compose-body').value = body;
                }
            });
        });

        // Send button
        const sendBtn = document.getElementById('btn-send-compose');
        sendBtn.onclick = async () => {
            const to = document.getElementById('compose-to').value;
            const subject = document.getElementById('compose-subject').value;
            const body = document.getElementById('compose-body').value;

            if (!to || !subject) {
                showToast('Remplir le destinataire et l\'objet', 'error');
                return;
            }

            sendBtn.disabled = true;
            sendBtn.textContent = '⏳ Envoi...';

            try {
                if (Auth.isDemoMode()) {
                    // Demo: simulate send and log note
                    addActivity('Courriel envoyé', `À: ${to} — ${subject}`, dealId);
                    await Deals.addNote(dealId, '📧 Courriel envoyé à ' + to + ': ' + subject, { type: 'email', icon: '📧' });
                    document.getElementById('modal-compose-email').classList.add('hidden');
                    showToast('Courriel simulé (mode démo)', 'success');
                } else {
                    // Build HTML body with signature
                    const sigUser = Auth.getUser();
                    const signature = getEmailSignature(sigUser?.name, sigUser?.email);
                    const htmlBody = body.replace(/\n/g, '<br>') + signature;
                    await Graph.sendEmail(to, subject, htmlBody);
                    await Deals.addNote(dealId, '📧 Courriel envoyé à ' + to + ': ' + subject, { type: 'email', icon: '📧' });
                    document.getElementById('modal-compose-email').classList.add('hidden');
                    showToast('Courriel envoyé via Outlook!', 'success');
                }
            } catch (e) {
                showToast('Erreur envoi: ' + e.message, 'error');
            } finally {
                sendBtn.disabled = false;
                sendBtn.textContent = '📤 Envoyer';
            }
        };

        modal.classList.remove('hidden');
    }

    function showEmailTemplatesManager() {
        const templates = getEmailTemplates();
        const container = document.getElementById('email-templates-list');
        if (!container) return;

        container.innerHTML = templates.map((tpl, idx) => `
            <div class="email-template-card" style="background:var(--bg-card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:12px 16px;margin-bottom:8px;cursor:pointer;transition:all .15s"
                 onclick="App._editTemplate('${tpl.id}')" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border,#e2e8f0)'">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-weight:600;font-size:14px">${tpl.name}</div>
                        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Sujet: ${tpl.subject}</div>
                        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px">${(tpl.body || '').substring(0, 80)}...</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();App._editTemplate('${tpl.id}')" title="Modifier">✏️</button>
                        <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:transparent" onclick="event.stopPropagation();App._deleteTemplate('${tpl.id}')" title="Supprimer">🗑️</button>
                    </div>
                </div>
            </div>
        `).join('');

        container.innerHTML += `
            <button class="btn btn-sm btn-primary" style="margin-top:8px" onclick="App._editTemplate(null)">+ Nouveau modèle</button>
            <button class="btn btn-sm btn-outline" style="margin-top:8px;margin-left:8px" onclick="if(confirm('Réinitialiser les modèles par défaut?')){localStorage.removeItem('crm_emailTemplates');App.showEmailTemplatesManager();App.showToast('Modèles réinitialisés','success')}">🔄 Réinitialiser</button>
        `;
    }

    function _editTemplate(tplId) {
        const templates = getEmailTemplates();
        const tpl = tplId ? templates.find(t => t.id === tplId) : { id: '', name: '', subject: '', body: '' };
        if (!tpl) return;

        let modal = document.getElementById('modal-edit-template');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-edit-template';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-edit-template').classList.add('hidden')"></div>
            <div class="modal-content" style="z-index:1;max-width:600px">
                <div class="modal-header">
                    <h3>${tplId ? '✏️ Modifier le modèle' : '➕ Nouveau modèle'}</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-edit-template').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body" style="padding:20px">
                    <div style="margin-bottom:16px">
                        <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Nom du modèle</label>
                        <input type="text" id="tpl-edit-name" class="input-sm" style="width:100%" value="${tpl.name}" placeholder="Ex: Relance soumission">
                    </div>
                    <div style="margin-bottom:16px">
                        <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Sujet du courriel</label>
                        <input type="text" id="tpl-edit-subject" class="input-sm" style="width:100%" value="${tpl.subject}" placeholder="Ex: Suivi de votre soumission - LGC">
                    </div>
                    <div style="margin-bottom:12px">
                        <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Corps du message</label>
                        <textarea id="tpl-edit-body" rows="10" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);font-family:inherit;font-size:13px;line-height:1.5">${tpl.body}</textarea>
                    </div>
                    <div style="background:var(--bg-secondary,#f7f8fa);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text-muted)">
                        <strong>Variables disponibles :</strong><br>
                        <code>{clientName}</code> — Nom du client &nbsp;|&nbsp;
                        <code>{amount}</code> — Montant &nbsp;|&nbsp;
                        <code>{vendorName}</code> — Nom du vendeur &nbsp;|&nbsp;
                        <code>{companyPhone}</code> — Téléphone LGC
                    </div>
                </div>
                <div class="modal-footer" style="padding:12px 20px;display:flex;justify-content:flex-end;gap:8px">
                    <button class="btn btn-outline" onclick="document.getElementById('modal-edit-template').classList.add('hidden')">Annuler</button>
                    <button class="btn btn-primary" id="btn-save-template">💾 Sauvegarder</button>
                </div>
            </div>
        `;

        modal.classList.remove('hidden');

        document.getElementById('btn-save-template').onclick = () => {
            const name = document.getElementById('tpl-edit-name').value.trim();
            const subject = document.getElementById('tpl-edit-subject').value.trim();
            const body = document.getElementById('tpl-edit-body').value;

            if (!name || !subject) {
                showToast('Le nom et le sujet sont requis', 'error');
                return;
            }

            const allTemplates = getEmailTemplates();
            if (tplId) {
                const idx = allTemplates.findIndex(t => t.id === tplId);
                if (idx >= 0) {
                    allTemplates[idx].name = name;
                    allTemplates[idx].subject = subject;
                    allTemplates[idx].body = body;
                }
            } else {
                allTemplates.push({
                    id: 'tpl_' + Date.now(),
                    name,
                    subject,
                    body,
                });
            }

            localStorage.setItem('crm_emailTemplates', JSON.stringify(allTemplates));
            modal.classList.add('hidden');
            showEmailTemplatesManager();
            showToast(tplId ? 'Modèle modifié' : 'Modèle créé', 'success');
        };
    }

    function _deleteTemplate(tplId) {
        if (!confirm('Supprimer ce modèle de courriel?')) return;
        const templates = getEmailTemplates().filter(t => t.id !== tplId);
        localStorage.setItem('crm_emailTemplates', JSON.stringify(templates));
        showEmailTemplatesManager();
        showToast('Modèle supprimé', 'success');
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
            const btn = document.getElementById('btn-login');
            btn.disabled = true;
            btn.innerHTML = '<img src="https://learn.microsoft.com/en-us/entra/identity-platform/media/howto-add-branding-in-apps/ms-symbollockup_mssymbol_19.svg" style="height:16px;margin-right:8px"> Connexion en cours...';
            try {
                const user = await Auth.login();
                if (user) showApp(user);
            } catch (e) {
                const msg = e.message || '';
                if (msg.startsWith('ADMIN_CONSENT_NEEDED|')) {
                    // Show admin consent link
                    const parts = msg.split('|');
                    const tenantId = parts[1];
                    const clientId = parts[2];
                    const consentUrl = `https://login.microsoftonline.com/${tenantId}/adminconsent?client_id=${clientId}&redirect_uri=${encodeURIComponent(window.location.origin + window.location.pathname)}`;
                    const loginHint = document.getElementById('login-hint');
                    if (loginHint) {
                        loginHint.innerHTML = `
                            <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin-top:16px;text-align:left;max-width:400px;margin-left:auto;margin-right:auto">
                                <p style="margin:0 0 8px;font-weight:700;color:#856404">⚠️ Approbation administrateur requise</p>
                                <p style="margin:0 0 12px;font-size:13px;color:#856404">
                                    Un administrateur M365 doit approuver les permissions du CRM une seule fois.
                                    Connectez-vous avec votre compte admin (charles.admin@pflgc.com).
                                </p>
                                <a href="${consentUrl}" class="btn btn-primary" style="display:inline-block;font-size:13px" target="_blank">
                                    🔓 Approuver les permissions (admin)
                                </a>
                                <p style="margin:8px 0 0;font-size:11px;color:#856404">
                                    Après approbation, revenez ici et reconnectez-vous.
                                </p>
                            </div>
                        `;
                    }
                } else if (msg.includes('Session bloquée')) {
                    showToast(msg, 'warning');
                } else {
                    showToast('Connexion échouée: ' + (msg || 'Vérifiez les paramètres Azure AD.'), 'error');
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<img src="https://learn.microsoft.com/en-us/entra/identity-platform/media/howto-add-branding-in-apps/ms-symbollockup_mssymbol_19.svg" style="height:16px;margin-right:8px"> Connexion avec votre compte LGC';
            }
        });

        document.getElementById('btn-demo').addEventListener('click', () => {
            const pwd = prompt('Mot de passe pour le mode essai:');
            if (pwd !== 'pflgc') {
                showToast('Mot de passe incorrect', 'error');
                return;
            }
            const user = Auth.loginDemo();
            showApp(user);
        });

        // Clear cached M365 account (change account)
        document.getElementById('btn-clear-account')?.addEventListener('click', () => {
            // Clear all MSAL cache
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith('msal.') || key.includes('msal')) {
                    localStorage.removeItem(key);
                }
            }
            for (const key of Object.keys(sessionStorage)) {
                if (key.startsWith('msal.') || key.includes('msal')) {
                    sessionStorage.removeItem(key);
                }
            }
            localStorage.removeItem('crm_m365_status');
            showToast('Cache M365 vidé. Cliquez sur Connexion pour choisir un autre compte.', 'success');
            document.getElementById('btn-clear-account').style.display = 'none';
            // Reinit MSAL
            window.location.reload();
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
                const view = btn.dataset.pipelineView;
                const kanbanEl = document.getElementById('kanban-board');
                const listEl = document.getElementById('list-view');
                const forecastEl = document.getElementById('forecast-view');
                if (view === 'forecast') {
                    if (kanbanEl) kanbanEl.classList.add('hidden');
                    if (listEl) listEl.classList.add('hidden');
                    if (forecastEl) forecastEl.classList.remove('hidden');
                    renderForecast();
                } else {
                    if (forecastEl) forecastEl.classList.add('hidden');
                    Pipeline.setView(view);
                }
            });
        });

        // Search - enhanced with dropdown
        document.getElementById('global-search')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('search-results-dropdown')?.classList.add('hidden');
                handleSearch(e.target.value);
            }
            if (e.key === 'Escape') {
                document.getElementById('search-results-dropdown')?.classList.add('hidden');
            }
        });
        document.getElementById('global-search')?.addEventListener('input', (e) => {
            handleEnhancedSearch(e.target.value);
        });
        // Close search dropdown on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-box')) {
                document.getElementById('search-results-dropdown')?.classList.add('hidden');
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
            // Save shared mailbox
            const sharedMailbox = document.getElementById('setting-shared-mailbox')?.value || '';
            localStorage.setItem('crm_sharedMailbox', sharedMailbox);
            showToast('Paramètres M365 sauvegardés. Rechargez la page pour appliquer.', 'success');
        });

        // Settings: test M365 connections
        document.getElementById('btn-test-m365')?.addEventListener('click', testM365Connections);

        // Settings: save email signature
        document.getElementById('btn-save-signature')?.addEventListener('click', saveSignatureSettings);

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

        // Team member add
        document.getElementById('btn-add-member')?.addEventListener('click', addTeamMember);

        // Logout
        document.getElementById('btn-logout')?.addEventListener('click', async () => {
            if (confirm('Se déconnecter du CRM?')) {
                await Auth.logout();
                window.location.reload();
            }
        });

        // Email compose
        document.getElementById('btn-send-composed-email')?.addEventListener('click', sendComposedEmail);

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

    // ===== ACTIVITY BADGE =====
    function updateActivityBadge() {
        const badge = document.getElementById('badge-activities');
        if (!badge) return;
        try {
            const overdue = (typeof Activities !== 'undefined' && Activities.getOverdue) ? Activities.getOverdue() : [];
            if (overdue.length > 0) {
                badge.textContent = overdue.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        } catch (e) {
            badge.classList.add('hidden');
        }
    }

    // ===== FORECAST VIEW =====
    function renderForecast() {
        const container = document.getElementById('forecast-view');
        if (!container) return;

        const allDeals = Deals.getAll().filter(d => d.status === 'active');
        const now = new Date();
        const months = [];
        for (let i = 0; i < 4; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            months.push({
                key: d.toISOString().slice(0, 7),
                label: d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' }),
                deals: [],
                weightedTotal: 0
            });
        }

        const stageColors = [
            '#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e','#ef4444',
            '#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#14b8a6','#06b6d4'
        ];

        allDeals.forEach(deal => {
            const closeDate = deal.expectedCloseDate || deal.installDate || deal.completedDate || '';
            const dealMonth = closeDate ? closeDate.slice(0, 7) : now.toISOString().slice(0, 7);
            const prob = (deal.probability || 50) / 100;
            const amount = deal.contractAmount || deal.quoteAmount || 0;
            const weighted = amount * prob;

            const monthObj = months.find(m => m.key === dealMonth);
            if (monthObj) {
                monthObj.deals.push({ ...deal, weighted });
                monthObj.weightedTotal += weighted;
            } else if (dealMonth >= months[0].key) {
                // Future beyond 4 months - add to last column
                months[3].deals.push({ ...deal, weighted });
                months[3].weightedTotal += weighted;
            }
        });

        container.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:16px 0">
                ${months.map(m => `
                    <div style="background:var(--bg-card,white);border-radius:var(--radius,8px);border:1px solid var(--border);overflow:hidden">
                        <div style="padding:12px 16px;background:var(--primary-light,#fef2f2);border-bottom:1px solid var(--border)">
                            <div style="font-weight:700;font-size:14px;text-transform:capitalize">${m.label}</div>
                            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${m.deals.length} deal${m.deals.length !== 1 ? 's' : ''}</div>
                            <div style="font-weight:700;font-size:18px;color:var(--primary);margin-top:4px">${Deals.formatMoney(m.weightedTotal)}</div>
                            <div style="font-size:11px;color:var(--text-muted)">pondéré (montant x probabilité)</div>
                        </div>
                        <div style="padding:8px;max-height:300px;overflow-y:auto">
                            ${m.deals.length === 0 ? '<div style="padding:12px;color:var(--text-muted);font-size:13px;text-align:center">Aucun deal</div>' :
                            m.deals.map(d => `
                                <div onclick="App.openDeal('${d.id}')" style="padding:8px 10px;border-radius:6px;border-left:3px solid ${stageColors[(d.stage || 1) - 1]};margin-bottom:6px;cursor:pointer;background:var(--bg,#f8fafc);font-size:13px" class="hover-lift">
                                    <div style="font-weight:600">${d.clientName || 'Sans nom'}</div>
                                    <div style="display:flex;justify-content:space-between;margin-top:4px;color:var(--text-muted);font-size:11px">
                                        <span>${Deals.formatMoney(d.contractAmount || d.quoteAmount || 0)}</span>
                                        <span>${d.probability || 50}%</span>
                                    </div>
                                    <div style="font-size:11px;color:var(--text-muted)">${Deals.getStageName(d.stage)}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ===== ENHANCED SEARCH =====
    function handleEnhancedSearch(query) {
        const dropdown = document.getElementById('search-results-dropdown');
        if (!dropdown) return handleSearch(query);

        if (!query || query.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }

        const q = query.toLowerCase();
        const results = [];

        // Search deals
        Deals.getAll().forEach(d => {
            if ((d.clientName || '').toLowerCase().includes(q) ||
                (d.description || '').toLowerCase().includes(q) ||
                (d.clientPhone || '').includes(q) ||
                (d.clientEmail || '').toLowerCase().includes(q) ||
                (d.mecinovQuoteNum || '').toLowerCase().includes(q)) {
                results.push({ type: 'deal', label: d.clientName, sub: Deals.getStageName(d.stage) + ' - ' + Deals.formatMoney(d.quoteAmount || 0), id: d.id });
            }
        });

        // Search contacts
        if (typeof Contacts !== 'undefined' && Contacts.getAll) {
            try {
                Contacts.getAll().forEach(c => {
                    if ((c.name || '').toLowerCase().includes(q) ||
                        (c.email || '').toLowerCase().includes(q) ||
                        (c.phone || '').includes(q) ||
                        (c.organization || '').toLowerCase().includes(q)) {
                        results.push({ type: 'contact', label: c.name, sub: c.organization || c.email || '', id: c.id });
                    }
                });
            } catch (e) {}
        }

        // Search activities
        if (typeof Activities !== 'undefined' && Activities.getAll) {
            try {
                Activities.getAll().forEach(a => {
                    if ((a.subject || '').toLowerCase().includes(q)) {
                        results.push({ type: 'activity', label: a.subject, sub: a.type || '', id: a.id });
                    }
                });
            } catch (e) {}
        }

        if (results.length === 0) {
            dropdown.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px;text-align:center">Aucun résultat</div>';
            dropdown.classList.remove('hidden');
            return;
        }

        const typeLabels = { deal: '📋 Deals', contact: '👤 Contacts', activity: '📌 Activités' };
        const grouped = {};
        results.forEach(r => {
            if (!grouped[r.type]) grouped[r.type] = [];
            grouped[r.type].push(r);
        });

        let html = '';
        Object.entries(grouped).forEach(([type, items]) => {
            html += `<div style="padding:6px 12px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;background:var(--bg,#f8fafc)">${typeLabels[type] || type}</div>`;
            items.slice(0, 5).forEach(item => {
                html += `<div class="search-result-item" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px"
                    onmouseover="this.style.background='var(--primary-light,#fef2f2)'"
                    onmouseout="this.style.background=''"
                    onclick="document.getElementById('search-results-dropdown').classList.add('hidden');${
                        type === 'deal' ? `App.openDeal('${item.id}')` :
                        type === 'contact' ? `App.navigate('contacts')` :
                        `App.navigate('activities')`
                    }">
                    <div style="font-weight:600">${item.label}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${item.sub}</div>
                </div>`;
            });
        });

        dropdown.innerHTML = html;
        dropdown.classList.remove('hidden');
    }

    // ===== DEAL TIMELINE (Unified) =====
    function renderDealTimeline(dealId) {
        const container = document.getElementById('deal-timeline-unified');
        if (!container) return;

        const items = [];

        // Notes from the deal
        const notes = Deals.getNotesForDeal(dealId);
        notes.forEach(n => {
            items.push({
                date: n.noteDate,
                icon: n.noteIcon || '📝',
                type: n.noteType || 'note',
                text: n.noteText,
                author: n.author
            });
        });

        // Activities from Activities module
        if (typeof Activities !== 'undefined' && Activities.getForDeal) {
            try {
                const acts = Activities.getForDeal(dealId);
                acts.forEach(a => {
                    items.push({
                        date: a.date || a.createdAt,
                        icon: a.type === 'call' ? '📞' : a.type === 'email' ? '📧' : a.type === 'meeting' ? '📅' : '📌',
                        type: 'activity',
                        text: a.subject || a.description || 'Activité',
                        author: a.assignedTo || 'Système'
                    });
                });
            } catch (e) {}
        }

        // Sort by date descending
        items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        if (items.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px 0;text-align:center">Aucun historique pour ce deal</div>';
            return;
        }

        container.innerHTML = `<div class="activity-timeline">` + items.map(item => `
            <div class="timeline-entry type-${item.type}" style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                <span style="font-size:16px;flex-shrink:0">${item.icon}</span>
                <div style="flex:1;min-width:0">
                    <div style="font-size:13px">${item.text}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                        ${item.author || ''} ${item.date ? '- ' + Deals.formatDate(item.date) : ''}
                    </div>
                </div>
            </div>
        `).join('') + `</div>`;
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
        handleEnhancedSearch,
        updateActivityBadge,
        renderForecast,
        renderDealTimeline,
        downloadAttachment,
        deleteAttachment,
        removePendingFile,
        updateQuoteDeadlineAlert,
        getDeadlineStatus,
        openGoogleMaps,
        getAttachments,
        editMonthlyObjective,
        openComposeEmail,
        openEmailCompose,
        sendComposedEmail,
        getEmailSignature,
        addTeamMember,
        renderTeamSettings,
        testM365Connections,
        renderM365Status,
        triggerConfetti,
        showEmailTemplatesManager,
        _editTemplate,
        _deleteTemplate,
        _handleExternalSign,
        get _editingDealId() { return editingDealId; },
    };
})();

// Start the app
document.addEventListener('DOMContentLoaded', App.init);
