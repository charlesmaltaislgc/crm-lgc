// ===== CRM LGC - Automations Module =====
// Automation engine: triggers, conditions, actions, execution log

const Automations = (() => {
    const STORAGE_KEY = 'crm_automations';
    const LOG_KEY = 'crm_automation_log';
    let rules = [];
    let log = [];
    let checkInterval = null;

    // ===== TRIGGER DEFINITIONS =====
    const TRIGGERS = [
        { id: 'stage_change', label: 'Changement d\'étape', icon: '🔄', desc: 'Quand un deal change d\'étape' },
        { id: 'deal_created', label: 'Nouveau deal', icon: '🆕', desc: 'Quand un deal est créé' },
        { id: 'deal_won', label: 'Deal gagné', icon: '🏆', desc: 'Quand un deal est marqué gagné' },
        { id: 'deal_lost', label: 'Deal perdu', icon: '❌', desc: 'Quand un deal est marqué perdu' },
        { id: 'inactivity', label: 'Inactivité', icon: '⏰', desc: 'Quand un deal est inactif depuis X jours' },
        { id: 'date_field', label: 'Date approche', icon: '📅', desc: 'X jours avant une date spécifique' },
    ];

    const ACTION_TYPES = [
        { id: 'send_email', label: 'Envoyer un courriel', icon: '📧' },
        { id: 'create_activity', label: 'Créer une activité', icon: '📋' },
        { id: 'change_stage', label: 'Changer l\'étape', icon: '➡️' },
        { id: 'notify', label: 'Envoyer une notification', icon: '🔔' },
        { id: 'add_note', label: 'Ajouter une note', icon: '📝' },
    ];

    // ===== PRE-BUILT TEMPLATES =====
    const TEMPLATES = [
        {
            name: 'Relance auto après soumission',
            trigger: 'inactivity',
            conditions: { stageId: 5, inactivityDays: 5 },
            actions: [{ type: 'send_email', params: { subject: 'Suivi de votre soumission', body: 'Bonjour, nous souhaitons faire un suivi concernant la soumission envoyée. N\'hésitez pas à nous contacter.' } }],
            description: 'Envoie un courriel si aucun mouvement 5 jours après soumission envoyée'
        },
        {
            name: 'Notification deal gagné',
            trigger: 'deal_won',
            conditions: {},
            actions: [{ type: 'notify', params: { message: 'Un deal vient d\'être gagné!' } }],
            description: 'Notifie l\'équipe quand un deal est gagné'
        },
        {
            name: 'Créer activité de suivi',
            trigger: 'stage_change',
            conditions: { toStage: 5 },
            actions: [{ type: 'create_activity', params: { title: 'Suivi soumission', description: 'Faire un suivi avec le client suite à l\'envoi de la soumission', daysFromNow: 3 } }],
            description: 'Crée une activité de suivi quand un deal passe à Soumission envoyée'
        },
        {
            name: 'Alerte inactivité 7 jours',
            trigger: 'inactivity',
            conditions: { inactivityDays: 7 },
            actions: [
                { type: 'add_note', params: { text: '⚠️ Ce deal est inactif depuis 7 jours' } },
                { type: 'notify', params: { message: 'Deal inactif depuis 7 jours - action requise' } }
            ],
            description: 'Ajoute une note et notifie si aucune activité depuis 7 jours'
        },
        {
            name: 'Rappel signature contrat',
            trigger: 'inactivity',
            conditions: { stageId: 8, inactivityDays: 5 },
            actions: [{ type: 'create_activity', params: { title: 'Relancer pour signature', description: 'Le client n\'a pas encore signé le contrat', daysFromNow: 0 } }],
            description: 'Crée un rappel si le contrat n\'est pas signé après 5 jours'
        },
        {
            name: 'Note automatique nouveau lead',
            trigger: 'deal_created',
            conditions: {},
            actions: [{ type: 'add_note', params: { text: '📌 Nouveau lead créé - Contacter dans les 24h' } }],
            description: 'Ajoute une note de rappel lors de la création d\'un lead'
        },
        {
            name: 'Relance acompte',
            trigger: 'inactivity',
            conditions: { stageId: 9, inactivityDays: 7 },
            actions: [{ type: 'send_email', params: { subject: 'Rappel - Acompte en attente', body: 'Bonjour, nous vous rappelons que l\'acompte est requis pour procéder à votre commande.' } }],
            description: 'Envoie un rappel si l\'acompte n\'est pas reçu après 7 jours'
        },
        {
            name: 'Avancer après acompte reçu',
            trigger: 'stage_change',
            conditions: { toStage: 10 },
            actions: [{ type: 'create_activity', params: { title: 'Placer commande fournisseur', description: 'Acompte reçu - placer la commande auprès du fournisseur', daysFromNow: 1 } }],
            description: 'Crée une activité quand un deal passe à Commande fournisseur'
        },
    ];

    // ===== DATA =====
    function loadRules() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            rules = saved ? JSON.parse(saved) : [];
        } catch (e) {
            rules = [];
        }
    }

    function saveRules() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    }

    function loadLog() {
        try {
            const saved = localStorage.getItem(LOG_KEY);
            log = saved ? JSON.parse(saved) : [];
        } catch (e) {
            log = [];
        }
    }

    function saveLog() {
        // Keep only last 200 entries
        if (log.length > 200) log = log.slice(-200);
        localStorage.setItem(LOG_KEY, JSON.stringify(log));
    }

    function addLogEntry(rule, deal, actionType, result) {
        log.push({
            date: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            dealId: deal ? deal.id : null,
            dealName: deal ? deal.name : '',
            actionType,
            result
        });
        saveLog();
    }

    // ===== CRUD =====
    function getAll() {
        loadRules();
        return [...rules];
    }

    function getLog() {
        loadLog();
        return [...log].reverse();
    }

    function save(rule) {
        loadRules();
        if (!rule.id) {
            rule.id = 'auto_' + Date.now();
            rule.createdDate = new Date().toISOString();
            rule.lastRunDate = null;
            rule.runCount = 0;
            rule.active = true;
            rules.push(rule);
        } else {
            const idx = rules.findIndex(r => r.id === rule.id);
            if (idx >= 0) rules[idx] = { ...rules[idx], ...rule };
        }
        saveRules();
        return rule;
    }

    function remove(id) {
        loadRules();
        rules = rules.filter(r => r.id !== id);
        saveRules();
    }

    function toggle(id) {
        loadRules();
        const rule = rules.find(r => r.id === id);
        if (rule) {
            rule.active = !rule.active;
            saveRules();
        }
        return rule;
    }

    // ===== TRIGGER ENGINE =====
    function checkTriggers() {
        loadRules();
        loadLog();
        const deals = typeof Deals !== 'undefined' ? Deals.getAll() : [];
        const now = new Date();

        rules.filter(r => r.active).forEach(rule => {
            try {
                if (rule.trigger === 'inactivity') {
                    deals.forEach(deal => {
                        if (deal.status === 'lost') return;
                        if (rule.conditions.stageId && deal.stageId !== rule.conditions.stageId) return;

                        const lastActivity = deal.lastActivityDate || deal.createdDate || deal.date;
                        if (!lastActivity) return;
                        const daysSince = Math.floor((now - new Date(lastActivity)) / (1000 * 60 * 60 * 24));
                        const threshold = rule.conditions.inactivityDays || 7;

                        if (daysSince >= threshold) {
                            // Don't fire twice in same day for same deal
                            const alreadyFired = log.some(l =>
                                l.ruleId === rule.id &&
                                l.dealId === deal.id &&
                                l.date.substring(0, 10) === now.toISOString().substring(0, 10)
                            );
                            if (!alreadyFired) {
                                executeRule(rule, deal);
                            }
                        }
                    });
                }
            } catch (e) {
                console.error('Erreur automatisation:', rule.name, e);
            }
        });
    }

    function executeRule(rule, deal) {
        if (!rule.actions || !rule.actions.length) return;

        rule.actions.forEach(action => {
            try {
                switch (action.type) {
                    case 'send_email':
                        addLogEntry(rule, deal, 'send_email', `Courriel préparé: ${action.params.subject || 'Sans sujet'}`);
                        App.showToast(`📧 Auto: Courriel préparé pour ${deal.name || 'deal'}`, 'info');
                        break;

                    case 'create_activity':
                        if (typeof App !== 'undefined' && App.addActivity) {
                            const dueDate = new Date();
                            dueDate.setDate(dueDate.getDate() + (action.params.daysFromNow || 1));
                            App.addActivity({
                                dealId: deal.id,
                                type: 'task',
                                description: action.params.title || 'Suivi automatique',
                                notes: action.params.description || '',
                                dueDate: dueDate.toISOString().split('T')[0],
                                assignedTo: deal.vendeur || '',
                                completed: false,
                                createdDate: new Date().toISOString()
                            });
                        }
                        addLogEntry(rule, deal, 'create_activity', `Activité créée: ${action.params.title || 'Suivi'}`);
                        break;

                    case 'change_stage':
                        if (action.params.toStage && typeof Deals !== 'undefined') {
                            Deals.update(deal.id, { stageId: action.params.toStage });
                        }
                        addLogEntry(rule, deal, 'change_stage', `Étape changée vers ${action.params.toStage}`);
                        break;

                    case 'notify':
                        App.showToast(`🔔 ${action.params.message || 'Notification automatique'}`, 'info');
                        addLogEntry(rule, deal, 'notify', action.params.message || 'Notification');
                        break;

                    case 'add_note':
                        if (typeof Deals !== 'undefined' && deal.id) {
                            const current = Deals.getById(deal.id);
                            if (current) {
                                const notes = current.notes || '';
                                const stamp = new Date().toLocaleDateString('fr-CA');
                                Deals.update(deal.id, { notes: notes + `\n[${stamp} AUTO] ${action.params.text || ''}` });
                            }
                        }
                        addLogEntry(rule, deal, 'add_note', action.params.text || 'Note ajoutée');
                        break;
                }
            } catch (e) {
                addLogEntry(rule, deal, action.type, `ERREUR: ${e.message}`);
            }
        });

        rule.runCount = (rule.runCount || 0) + 1;
        rule.lastRunDate = new Date().toISOString();
        saveRules();
    }

    // Public trigger for external calls (e.g., from Deals module)
    function fireTrigger(triggerType, data) {
        loadRules();
        loadLog();
        const now = new Date();

        rules.filter(r => r.active && r.trigger === triggerType).forEach(rule => {
            try {
                let shouldFire = false;

                switch (triggerType) {
                    case 'deal_created':
                    case 'deal_won':
                    case 'deal_lost':
                        shouldFire = true;
                        break;
                    case 'stage_change':
                        if (rule.conditions.fromStage && data.fromStage !== rule.conditions.fromStage) break;
                        if (rule.conditions.toStage && data.toStage !== rule.conditions.toStage) break;
                        shouldFire = true;
                        break;
                }

                if (shouldFire && data.deal) {
                    executeRule(rule, data.deal);
                }
            } catch (e) {
                console.error('Erreur trigger:', e);
            }
        });
    }

    // ===== RENDER =====
    function render() {
        loadRules();
        loadLog();
        const stages = typeof Deals !== 'undefined' ? Deals.STAGES : [];

        const content = document.getElementById('automations-content') || document.getElementById('main-content');
        if (!content) return;

        const activeCount = rules.filter(r => r.active).length;
        const totalRuns = rules.reduce((sum, r) => sum + (r.runCount || 0), 0);

        content.innerHTML = `
            <div style="max-width:1100px;margin:0 auto;padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
                    <div>
                        <h2 style="margin:0;font-size:1.5rem;">⚡ Automatisations</h2>
                        <p style="margin:4px 0 0;color:#64748b;font-size:0.9rem;">
                            ${rules.length} règle${rules.length !== 1 ? 's' : ''} &bull; ${activeCount} active${activeCount !== 1 ? 's' : ''} &bull; ${totalRuns} exécution${totalRuns !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-sm" onclick="Automations._showTemplates()" style="background:#f1f5f9;border:1px solid #e2e8f0;">
                            📦 Modèles
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="Automations._openBuilder()">
                            + Nouvelle automatisation
                        </button>
                    </div>
                </div>

                <div id="auto-rules-list">
                    ${rules.length === 0 ? `
                        <div style="text-align:center;padding:60px 20px;color:#94a3b8;">
                            <div style="font-size:3rem;margin-bottom:12px;">⚡</div>
                            <p style="font-size:1.1rem;margin:0;">Aucune automatisation configurée</p>
                            <p style="margin:8px 0 16px;font-size:0.9rem;">Commencez par un modèle ou créez votre propre règle</p>
                            <button class="btn btn-primary btn-sm" onclick="Automations._showTemplates()">Voir les modèles</button>
                        </div>
                    ` : rules.map(rule => renderRuleCard(rule, stages)).join('')}
                </div>

                <div style="margin-top:32px;">
                    <h3 style="margin:0 0 12px;font-size:1.1rem;">📜 Journal d'exécution</h3>
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                        ${log.length === 0 ? `
                            <div style="padding:24px;text-align:center;color:#94a3b8;font-size:0.9rem;">
                                Aucune exécution enregistrée
                            </div>
                        ` : `
                            <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                                <thead>
                                    <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                                        <th style="padding:8px 12px;text-align:left;">Date</th>
                                        <th style="padding:8px 12px;text-align:left;">Règle</th>
                                        <th style="padding:8px 12px;text-align:left;">Deal</th>
                                        <th style="padding:8px 12px;text-align:left;">Action</th>
                                        <th style="padding:8px 12px;text-align:left;">Résultat</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${log.slice(-20).reverse().map(entry => `
                                        <tr style="border-bottom:1px solid #f1f5f9;">
                                            <td style="padding:6px 12px;white-space:nowrap;">${new Date(entry.date).toLocaleString('fr-CA')}</td>
                                            <td style="padding:6px 12px;">${entry.ruleName || '-'}</td>
                                            <td style="padding:6px 12px;">${entry.dealName || '-'}</td>
                                            <td style="padding:6px 12px;">${getActionLabel(entry.actionType)}</td>
                                            <td style="padding:6px 12px;color:${entry.result.startsWith('ERREUR') ? '#ef4444' : '#10b981'};">${entry.result}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        `}
                    </div>
                </div>
            </div>
        `;
    }

    function renderRuleCard(rule, stages) {
        const trigger = TRIGGERS.find(t => t.id === rule.trigger) || { icon: '⚡', label: rule.trigger };
        const actionSummary = (rule.actions || []).map(a => {
            const at = ACTION_TYPES.find(t => t.id === a.type);
            return at ? at.icon : '⚙️';
        }).join(' ');

        return `
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:10px;display:flex;align-items:center;gap:16px;${!rule.active ? 'opacity:0.5;' : ''}">
                <div style="font-size:1.5rem;width:40px;text-align:center;">${trigger.icon}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.95rem;">${rule.name || 'Sans nom'}</div>
                    <div style="color:#64748b;font-size:0.8rem;margin-top:2px;">
                        ${trigger.label} → ${actionSummary}
                        ${rule.runCount ? ` &bull; ${rule.runCount} exécution${rule.runCount > 1 ? 's' : ''}` : ''}
                        ${rule.lastRunDate ? ` &bull; Dernière: ${new Date(rule.lastRunDate).toLocaleDateString('fr-CA')}` : ''}
                    </div>
                </div>
                <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;">
                    <input type="checkbox" ${rule.active ? 'checked' : ''} onchange="Automations.toggle('${rule.id}');Automations.render()"
                        style="opacity:0;width:0;height:0;">
                    <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:${rule.active ? '#22c55e' : '#cbd5e1'};border-radius:12px;transition:.3s;"></span>
                    <span style="position:absolute;top:2px;left:${rule.active ? '22px' : '2px'};width:20px;height:20px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.2);"></span>
                </label>
                <button class="btn btn-sm" onclick="Automations.remove('${rule.id}');Automations.render()" style="background:none;border:none;color:#ef4444;font-size:1rem;cursor:pointer;" title="Supprimer">🗑️</button>
            </div>
        `;
    }

    function getActionLabel(type) {
        const at = ACTION_TYPES.find(t => t.id === type);
        return at ? `${at.icon} ${at.label}` : type;
    }

    // ===== BUILDER WIZARD =====
    function _openBuilder(template) {
        const stages = typeof Deals !== 'undefined' ? Deals.STAGES : [];
        const draft = template ? { ...template, id: null } : { name: '', trigger: '', conditions: {}, actions: [] };
        let step = 1;

        const overlay = document.createElement('div');
        overlay.id = 'auto-builder-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

        function renderStep() {
            let stepHTML = '';

            if (step === 1) {
                stepHTML = `
                    <h3 style="margin:0 0 16px;">Étape 1: Déclencheur</h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        ${TRIGGERS.map(t => `
                            <div onclick="document.querySelector('[data-trigger]').value='${t.id}';this.parentNode.querySelectorAll('div').forEach(d=>d.style.borderColor='#e2e8f0');this.style.borderColor='#3b82f6';"
                                style="padding:14px;border:2px solid ${draft.trigger === t.id ? '#3b82f6' : '#e2e8f0'};border-radius:8px;cursor:pointer;text-align:center;">
                                <div style="font-size:1.5rem;">${t.icon}</div>
                                <div style="font-weight:600;font-size:0.9rem;margin-top:4px;">${t.label}</div>
                                <div style="color:#94a3b8;font-size:0.75rem;margin-top:2px;">${t.desc}</div>
                            </div>
                        `).join('')}
                    </div>
                    <input type="hidden" data-trigger value="${draft.trigger}">
                `;
            } else if (step === 2) {
                const showStage = ['stage_change', 'inactivity'].includes(draft.trigger);
                const showInactivity = draft.trigger === 'inactivity';
                const showFromTo = draft.trigger === 'stage_change';
                stepHTML = `
                    <h3 style="margin:0 0 16px;">Étape 2: Conditions</h3>
                    ${showFromTo ? `
                        <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">De l'étape (optionnel)</label>
                        <select data-from-stage class="input-sm" style="width:100%;margin-bottom:12px;padding:8px;">
                            <option value="">Toutes les étapes</option>
                            ${stages.map(s => `<option value="${s.id}" ${draft.conditions.fromStage == s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                        </select>
                        <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Vers l'étape (optionnel)</label>
                        <select data-to-stage class="input-sm" style="width:100%;margin-bottom:12px;padding:8px;">
                            <option value="">Toutes les étapes</option>
                            ${stages.map(s => `<option value="${s.id}" ${draft.conditions.toStage == s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                        </select>
                    ` : ''}
                    ${showStage && !showFromTo ? `
                        <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Étape concernée (optionnel)</label>
                        <select data-stage-id class="input-sm" style="width:100%;margin-bottom:12px;padding:8px;">
                            <option value="">Toutes les étapes</option>
                            ${stages.map(s => `<option value="${s.id}" ${draft.conditions.stageId == s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                        </select>
                    ` : ''}
                    ${showInactivity ? `
                        <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Jours d'inactivité</label>
                        <input type="number" data-inactivity-days class="input-sm" value="${draft.conditions.inactivityDays || 7}" min="1" max="90" style="width:100%;padding:8px;">
                    ` : ''}
                    ${!showStage && !showInactivity ? `
                        <p style="color:#64748b;font-size:0.9rem;">Aucune condition supplémentaire pour ce déclencheur.</p>
                    ` : ''}
                `;
            } else if (step === 3) {
                stepHTML = `
                    <h3 style="margin:0 0 16px;">Étape 3: Actions</h3>
                    <div style="display:grid;gap:10px;">
                        ${ACTION_TYPES.map(a => `
                            <label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;">
                                <input type="checkbox" data-action="${a.id}" ${draft.actions.some(da => da.type === a.id) ? 'checked' : ''}>
                                <span style="font-size:1.2rem;">${a.icon}</span>
                                <span style="font-weight:500;">${a.label}</span>
                            </label>
                        `).join('')}
                    </div>
                `;
            } else if (step === 4) {
                stepHTML = `
                    <h3 style="margin:0 0 16px;">Étape 4: Nom et activation</h3>
                    <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Nom de la règle</label>
                    <input type="text" data-rule-name class="input-sm" value="${draft.name}" placeholder="Ex: Relance automatique..." style="width:100%;padding:8px;margin-bottom:16px;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" data-active checked>
                        <span>Activer immédiatement</span>
                    </label>
                `;
            }

            overlay.innerHTML = `
                <div style="background:#fff;border-radius:12px;padding:24px;width:520px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <div style="display:flex;gap:6px;">
                            ${[1,2,3,4].map(s => `<div style="width:32px;height:4px;border-radius:2px;background:${s <= step ? '#3b82f6' : '#e2e8f0'};"></div>`).join('')}
                        </div>
                        <button onclick="document.getElementById('auto-builder-overlay').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;">✕</button>
                    </div>
                    ${stepHTML}
                    <div style="display:flex;justify-content:space-between;margin-top:20px;">
                        <button class="btn btn-sm" onclick="${step > 1 ? 'Automations._builderNav(-1)' : 'document.getElementById(\'auto-builder-overlay\').remove()'}" style="background:#f1f5f9;border:1px solid #e2e8f0;">
                            ${step > 1 ? '← Précédent' : 'Annuler'}
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="Automations._builderNav(1)">
                            ${step < 4 ? 'Suivant →' : '✓ Créer'}
                        </button>
                    </div>
                </div>
            `;
        }

        // Store state on window for navigation
        window._autoDraft = draft;
        window._autoStep = step;
        window._autoOverlay = overlay;

        renderStep();
        document.body.appendChild(overlay);
    }

    function _builderNav(dir) {
        const overlay = document.getElementById('auto-builder-overlay');
        if (!overlay) return;
        const draft = window._autoDraft;
        let step = window._autoStep;

        // Save current step data
        if (step === 1) {
            const triggerInput = overlay.querySelector('[data-trigger]');
            if (triggerInput) draft.trigger = triggerInput.value;
            if (!draft.trigger && dir > 0) { App.showToast('Choisissez un déclencheur', 'warning'); return; }
        } else if (step === 2) {
            const fromStage = overlay.querySelector('[data-from-stage]');
            const toStage = overlay.querySelector('[data-to-stage]');
            const stageId = overlay.querySelector('[data-stage-id]');
            const inactDays = overlay.querySelector('[data-inactivity-days]');
            draft.conditions = {};
            if (fromStage && fromStage.value) draft.conditions.fromStage = parseInt(fromStage.value);
            if (toStage && toStage.value) draft.conditions.toStage = parseInt(toStage.value);
            if (stageId && stageId.value) draft.conditions.stageId = parseInt(stageId.value);
            if (inactDays && inactDays.value) draft.conditions.inactivityDays = parseInt(inactDays.value);
        } else if (step === 3) {
            const checked = overlay.querySelectorAll('[data-action]:checked');
            draft.actions = Array.from(checked).map(cb => ({ type: cb.dataset.action, params: {} }));
            if (draft.actions.length === 0 && dir > 0) { App.showToast('Choisissez au moins une action', 'warning'); return; }
        } else if (step === 4 && dir > 0) {
            const nameInput = overlay.querySelector('[data-rule-name]');
            const activeInput = overlay.querySelector('[data-active]');
            draft.name = nameInput ? nameInput.value.trim() : '';
            if (!draft.name) { App.showToast('Donnez un nom à la règle', 'warning'); return; }
            draft.active = activeInput ? activeInput.checked : true;

            // Save rule
            save(draft);
            overlay.remove();
            App.showToast('Automatisation créée!', 'success');
            render();
            return;
        }

        step += dir;
        if (step < 1) step = 1;
        if (step > 4) step = 4;
        window._autoStep = step;

        // Re-render
        _openBuilder.__renderStep = true;
        // Rebuild overlay content
        const stages = typeof Deals !== 'undefined' ? Deals.STAGES : [];
        let stepHTML = '';

        if (step === 1) {
            stepHTML = `
                <h3 style="margin:0 0 16px;">Étape 1: Déclencheur</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    ${TRIGGERS.map(t => `
                        <div onclick="document.querySelector('[data-trigger]').value='${t.id}';this.parentNode.querySelectorAll('div').forEach(d=>d.style.borderColor='#e2e8f0');this.style.borderColor='#3b82f6';"
                            style="padding:14px;border:2px solid ${draft.trigger === t.id ? '#3b82f6' : '#e2e8f0'};border-radius:8px;cursor:pointer;text-align:center;">
                            <div style="font-size:1.5rem;">${t.icon}</div>
                            <div style="font-weight:600;font-size:0.9rem;margin-top:4px;">${t.label}</div>
                            <div style="color:#94a3b8;font-size:0.75rem;margin-top:2px;">${t.desc}</div>
                        </div>
                    `).join('')}
                </div>
                <input type="hidden" data-trigger value="${draft.trigger}">
            `;
        } else if (step === 2) {
            const showStage = ['stage_change', 'inactivity'].includes(draft.trigger);
            const showInactivity = draft.trigger === 'inactivity';
            const showFromTo = draft.trigger === 'stage_change';
            stepHTML = `
                <h3 style="margin:0 0 16px;">Étape 2: Conditions</h3>
                ${showFromTo ? `
                    <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">De l'étape (optionnel)</label>
                    <select data-from-stage class="input-sm" style="width:100%;margin-bottom:12px;padding:8px;">
                        <option value="">Toutes les étapes</option>
                        ${stages.map(s => `<option value="${s.id}" ${draft.conditions.fromStage == s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>
                    <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Vers l'étape (optionnel)</label>
                    <select data-to-stage class="input-sm" style="width:100%;margin-bottom:12px;padding:8px;">
                        <option value="">Toutes les étapes</option>
                        ${stages.map(s => `<option value="${s.id}" ${draft.conditions.toStage == s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>
                ` : ''}
                ${showStage && !showFromTo ? `
                    <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Étape concernée (optionnel)</label>
                    <select data-stage-id class="input-sm" style="width:100%;margin-bottom:12px;padding:8px;">
                        <option value="">Toutes les étapes</option>
                        ${stages.map(s => `<option value="${s.id}" ${draft.conditions.stageId == s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>
                ` : ''}
                ${showInactivity ? `
                    <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Jours d'inactivité</label>
                    <input type="number" data-inactivity-days class="input-sm" value="${draft.conditions.inactivityDays || 7}" min="1" max="90" style="width:100%;padding:8px;">
                ` : ''}
                ${!showStage && !showInactivity ? `<p style="color:#64748b;font-size:0.9rem;">Aucune condition supplémentaire pour ce déclencheur.</p>` : ''}
            `;
        } else if (step === 3) {
            stepHTML = `
                <h3 style="margin:0 0 16px;">Étape 3: Actions</h3>
                <div style="display:grid;gap:10px;">
                    ${ACTION_TYPES.map(a => `
                        <label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;">
                            <input type="checkbox" data-action="${a.id}" ${draft.actions.some(da => da.type === a.id) ? 'checked' : ''}>
                            <span style="font-size:1.2rem;">${a.icon}</span>
                            <span style="font-weight:500;">${a.label}</span>
                        </label>
                    `).join('')}
                </div>
            `;
        } else if (step === 4) {
            stepHTML = `
                <h3 style="margin:0 0 16px;">Étape 4: Nom et activation</h3>
                <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Nom de la règle</label>
                <input type="text" data-rule-name class="input-sm" value="${draft.name}" placeholder="Ex: Relance automatique..." style="width:100%;padding:8px;margin-bottom:16px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" data-active checked>
                    <span>Activer immédiatement</span>
                </label>
            `;
        }

        overlay.innerHTML = `
            <div style="background:#fff;border-radius:12px;padding:24px;width:520px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div style="display:flex;gap:6px;">
                        ${[1,2,3,4].map(s => `<div style="width:32px;height:4px;border-radius:2px;background:${s <= step ? '#3b82f6' : '#e2e8f0'};"></div>`).join('')}
                    </div>
                    <button onclick="document.getElementById('auto-builder-overlay').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;">✕</button>
                </div>
                ${stepHTML}
                <div style="display:flex;justify-content:space-between;margin-top:20px;">
                    <button class="btn btn-sm" onclick="${step > 1 ? 'Automations._builderNav(-1)' : 'document.getElementById(\'auto-builder-overlay\').remove()'}" style="background:#f1f5f9;border:1px solid #e2e8f0;">
                        ${step > 1 ? '← Précédent' : 'Annuler'}
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="Automations._builderNav(1)">
                        ${step < 4 ? 'Suivant →' : '✓ Créer'}
                    </button>
                </div>
            </div>
        `;
    }

    // ===== TEMPLATES MODAL =====
    function _showTemplates() {
        const overlay = document.createElement('div');
        overlay.id = 'auto-templates-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

        overlay.innerHTML = `
            <div style="background:#fff;border-radius:12px;padding:24px;width:600px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 style="margin:0;">📦 Modèles d'automatisation</h3>
                    <button onclick="document.getElementById('auto-templates-overlay').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;">✕</button>
                </div>
                <div style="display:grid;gap:10px;">
                    ${TEMPLATES.map((t, i) => {
                        const trigger = TRIGGERS.find(tr => tr.id === t.trigger) || { icon: '⚡' };
                        return `
                            <div style="padding:14px;border:1px solid #e2e8f0;border-radius:8px;display:flex;align-items:center;gap:12px;">
                                <div style="font-size:1.3rem;">${trigger.icon}</div>
                                <div style="flex:1;">
                                    <div style="font-weight:600;font-size:0.9rem;">${t.name}</div>
                                    <div style="color:#64748b;font-size:0.8rem;margin-top:2px;">${t.description}</div>
                                </div>
                                <button class="btn btn-primary btn-sm" onclick="document.getElementById('auto-templates-overlay').remove();Automations._useTemplate(${i})">
                                    Utiliser
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    function _useTemplate(index) {
        const template = TEMPLATES[index];
        if (!template) return;

        const rule = {
            name: template.name,
            trigger: template.trigger,
            conditions: { ...template.conditions },
            actions: template.actions.map(a => ({ ...a, params: { ...a.params } }))
        };

        save(rule);
        App.showToast(`Automatisation "${rule.name}" créée!`, 'success');
        render();
    }

    // ===== INIT =====
    function startPeriodicCheck() {
        if (checkInterval) clearInterval(checkInterval);
        checkInterval = setInterval(checkTriggers, 5 * 60 * 1000); // Check every 5 minutes
    }

    return {
        getAll,
        save,
        remove,
        toggle,
        checkTriggers,
        fireTrigger,
        render,
        getLog,
        startPeriodicCheck,
        _openBuilder,
        _builderNav,
        _showTemplates,
        _useTemplate
    };
})();
