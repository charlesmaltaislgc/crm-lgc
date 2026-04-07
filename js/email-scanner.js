// ===== CRM LGC - Email Lead Detection Module =====
// Scans Outlook emails, detects leads, matches existing clients
// Auto-sync enabled: scans every 2 minutes when active

const EmailScanner = (() => {
    const LEAD_KEYWORDS = [
        'fenêtre', 'fenetre', 'porte', 'vitre', 'vitrage', 'moustiquaire',
        'porte-patio', 'porte patio', 'porte d\'entrée', 'porte entree',
        'soumission', 'estimation', 'prix', 'coût', 'cout', 'devis',
        'remplacer', 'remplacement', 'changer', 'installer', 'installation',
        'rénover', 'renover', 'rénovation', 'renovation',
        'intéressé', 'interesse', 'j\'aimerais', 'jaimerais', 'je voudrais',
        'combien', 'disponible', 'rendez-vous', 'rencontrer', 'visite',
        'mesure', 'mesures', 'dimensions',
        'construction', 'neuf', 'agrandissement', 'projet', 'chantier',
    ];

    const EXCLUDE_KEYWORDS = [
        'facture', 'invoice', 'paiement', 'payment', 'reçu', 'receipt',
        'newsletter', 'unsubscribe', 'désabonner', 'promotion', 'publicité',
        'livraison', 'tracking', 'suivi colis', 'confirmation de commande',
        'microsoft', 'office 365', 'teams', 'sharepoint', 'zoom', 'calendly',
        'password reset', 'mot de passe', 'vérification', 'verification',
        'abonnement', 'subscription', 'notification', 'rappel automatique',
        'out of office', 'absence du bureau', 'automatique',
    ];

    // Senders to always ignore (automated, internal, system)
    const EXCLUDE_SENDERS = [
        'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply',
        'notifications@', 'notification@', 'alert@', 'alerts@',
        'mailer-daemon', 'postmaster', 'support@microsoft',
        'calendar-notification', 'sharepoint@', 'onmicrosoft.com',
        'mec-inov', 'mecinov', 'quickbooks', 'intuit',
    ];

    // Internal company domains to skip (not leads)
    const INTERNAL_DOMAINS = [
        'pflgc.com', 'porteslgc.com', 'lgcportes.com',
    ];

    let detectedLeads = [];
    let scanning = false;
    let lastScanTime = null;
    let autoSyncInterval = null;
    let lastUpdateTimerInterval = null;
    const AUTO_SYNC_DELAY = 120000; // 2 minutes
    const DISMISSED_KEY = 'crm_dismissed_emails';
    const PROCESSED_KEY = 'crm_processed_emails';

    // ===== AUTO-SYNC =====

    function init() {
        // Immediately start a scan, then set up auto-sync
        scanEmails(true);
        startAutoSync();
    }

    function startAutoSync() {
        stopAutoSync();
        autoSyncInterval = setInterval(() => {
            // Only auto-scan if not already scanning and document is visible
            if (!scanning && !document.hidden) {
                scanEmails(true); // background=true
            }
        }, AUTO_SYNC_DELAY);

        // Update the "last updated" timer every 30 seconds
        lastUpdateTimerInterval = setInterval(() => {
            updateLastScanDisplay();
        }, 30000);

        // When navigating to Emails view, refresh immediately
        document.addEventListener('visibilitychange', _onVisibilityChange);
    }

    function stopAutoSync() {
        if (autoSyncInterval) {
            clearInterval(autoSyncInterval);
            autoSyncInterval = null;
        }
        if (lastUpdateTimerInterval) {
            clearInterval(lastUpdateTimerInterval);
            lastUpdateTimerInterval = null;
        }
        document.removeEventListener('visibilitychange', _onVisibilityChange);
    }

    function _onVisibilityChange() {
        if (!document.hidden && !scanning) {
            scanEmails(true);
        }
    }

    // Called externally when user navigates to Emails tab
    function onNavigateToEmails() {
        if (!scanning) {
            scanEmails(true);
        }
    }

    // ===== PERSISTENCE =====

    function getDismissed() {
        try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { return []; }
    }
    function saveDismissed(list) {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.slice(-500)));
    }
    function getProcessed() {
        try { return JSON.parse(localStorage.getItem(PROCESSED_KEY) || '[]'); } catch { return []; }
    }
    function saveProcessed(list) {
        localStorage.setItem(PROCESSED_KEY, JSON.stringify(list.slice(-500)));
    }
    function markProcessed(emailId, action, detail) {
        const processed = getProcessed();
        processed.push({ id: emailId, action, detail, date: new Date().toISOString() });
        saveProcessed(processed);
    }

    // ===== CLIENT MATCHING =====
    function findExistingClient(fromEmail, fromName, phone) {
        const allDeals = Deals.getAll();
        const matches = [];

        const emailLower = (fromEmail || '').toLowerCase().trim();
        const nameLower = (fromName || '').toLowerCase().trim();
        const phoneClean = (phone || '').replace(/\D/g, '');

        for (const deal of allDeals) {
            let score = 0;
            let reason = '';

            // Exact email match = strongest signal
            if (emailLower && deal.clientEmail && deal.clientEmail.toLowerCase().trim() === emailLower) {
                score = 100;
                reason = 'Courriel identique';
            }

            // Phone match (cleaned digits)
            if (!score && phoneClean.length >= 10 && deal.clientPhone) {
                const dealPhone = deal.clientPhone.replace(/\D/g, '');
                if (dealPhone === phoneClean || dealPhone.endsWith(phoneClean.slice(-10))) {
                    score = 90;
                    reason = 'Téléphone identique';
                }
            }

            // Name match (fuzzy - contains both first and last name parts)
            if (!score && nameLower.length > 3 && deal.clientName) {
                const dealName = deal.clientName.toLowerCase();
                const nameParts = nameLower.split(/[\s,]+/).filter(p => p.length > 2);
                const dealParts = dealName.split(/[\s,]+/).filter(p => p.length > 2);
                const matchingParts = nameParts.filter(p => dealParts.some(dp => dp.includes(p) || p.includes(dp)));
                if (matchingParts.length >= 2) {
                    score = 80;
                    reason = 'Nom similaire';
                } else if (matchingParts.length === 1 && nameParts.length <= 2) {
                    score = 50;
                    reason = 'Nom partiel';
                }
            }

            // Email domain match for businesses (same company)
            if (!score && emailLower && deal.clientEmail) {
                const fromDomain = emailLower.split('@')[1];
                const dealDomain = deal.clientEmail.toLowerCase().split('@')[1];
                if (fromDomain && dealDomain && fromDomain === dealDomain
                    && !['gmail.com','outlook.com','hotmail.com','yahoo.com','videotron.ca','bell.net','sympatico.ca','icloud.com'].includes(fromDomain)) {
                    score = 60;
                    reason = 'Même entreprise';
                }
            }

            if (score > 0) {
                matches.push({ deal, score, reason });
            }
        }

        return matches.sort((a, b) => b.score - a.score);
    }

    // ===== SCANNING =====

    async function scanEmails(background = false) {
        if (scanning) return;
        scanning = true;

        // For background refreshes, show subtle spinner instead of full scanning UI
        if (background && detectedLeads.length > 0) {
            showBackgroundSpinner(true);
        } else {
            updateUI('scanning');
        }

        const dismissed = getDismissed();
        const processed = getProcessed();
        const handledIds = new Set([...dismissed, ...processed.map(p => p.id)]);

        try {
            let emails;
            if (Auth.isDemoMode()) {
                emails = generateDemoEmails();
            } else {
                const token = await Auth.getToken();
                if (!token || token === 'demo-token') {
                    if (!background) App.showToast('Connexion M365 requise pour scanner les courriels.', 'error');
                    scanning = false;
                    showBackgroundSpinner(false);
                    if (!background) updateUI('no-auth');
                    return;
                }

                // Check service status
                const status = Graph.getServiceStatus();
                if (status.outlook?.status === 'no-mailbox') {
                    const sharedMailbox = localStorage.getItem('crm_sharedMailbox') || '';
                    if (!sharedMailbox) {
                        if (!background) App.showToast('Votre compte n\'a pas de boîte Outlook. Configurez une boîte partagée dans Paramètres.', 'warning');
                        scanning = false;
                        showBackgroundSpinner(false);
                        if (!background) updateUI('no-mailbox');
                        return;
                    }
                }

                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                const dateFilter = `receivedDateTime ge ${weekAgo.toISOString()}`;

                emails = await Graph.getEmails(50, dateFilter);

                const sharedMailbox = localStorage.getItem('crm_sharedMailbox') || 'soumission@pflgc.com';
                if (sharedMailbox) {
                    try {
                        const sharedEmails = await Graph.getSharedMailboxEmails(sharedMailbox, 30, dateFilter);
                        if (sharedEmails?.length > 0) {
                            sharedEmails.forEach(e => { e._fromShared = sharedMailbox; });
                            emails = [...(emails || []), ...sharedEmails];
                        }
                    } catch (e) {
                        console.warn('Could not scan shared mailbox for leads:', e.message);
                    }
                }

                if (!emails || emails.length === 0) {
                    if (!background) App.showToast('Aucun courriel trouvé dans les 7 derniers jours', 'info');
                }
            }

            // Reset leads for fresh scan
            detectedLeads = [];

            for (const email of (emails || [])) {
                const emailId = email.id || 'E' + Math.random().toString(36).substr(2, 9);
                const fromEmail = (email.from?.emailAddress?.address || email.fromEmail || '').toLowerCase();
                const fromName = email.from?.emailAddress?.name || email.fromName || 'Inconnu';

                if (handledIds.has(emailId)) continue;
                if (isExcludedSender(fromEmail, fromName)) continue;

                const score = analyzeEmail(email);
                if (score.confidence < 2) continue;

                const existingMatches = findExistingClient(fromEmail, fromName, score.phone);
                const bestMatch = existingMatches.length > 0 ? existingMatches[0] : null;

                detectedLeads.push({
                    id: emailId,
                    from: fromName,
                    fromEmail: fromEmail,
                    subject: email.subject || '',
                    preview: (email.bodyPreview || email.preview || '').substring(0, 200),
                    date: email.receivedDateTime || email.date || new Date().toISOString(),
                    confidence: score.confidence,
                    matchedKeywords: score.keywords,
                    phone: score.phone,
                    existingDeal: bestMatch ? bestMatch.deal : null,
                    matchReason: bestMatch ? bestMatch.reason : null,
                    matchScore: bestMatch ? bestMatch.score : 0,
                    allMatches: existingMatches,
                });
            }

            // Sort: existing clients first, then by confidence
            detectedLeads.sort((a, b) => {
                if (a.existingDeal && !b.existingDeal) return -1;
                if (!a.existingDeal && b.existingDeal) return 1;
                return b.confidence - a.confidence;
            });

        } catch (e) {
            console.error('Email scan failed:', e);
            if (!background) App.showToast('Erreur lors du scan des courriels', 'error');
        }

        scanning = false;
        lastScanTime = new Date();
        showBackgroundSpinner(false);
        updateUI('results');
        updateBadge();
    }

    // ===== HELPERS =====

    function isExcludedSender(email, name) {
        if (!email) return true;
        const emailLower = email.toLowerCase();
        const nameLower = (name || '').toLowerCase();

        for (const pattern of EXCLUDE_SENDERS) {
            if (emailLower.includes(pattern) || nameLower.includes(pattern)) return true;
        }

        const domain = emailLower.split('@')[1] || '';
        for (const internalDomain of INTERNAL_DOMAINS) {
            if (domain === internalDomain || domain.endsWith('.' + internalDomain)) return true;
        }

        const autoSenderDomains = [
            'facebookmail.com', 'linkedin.com', 'twitter.com', 'x.com',
            'paypal.com', 'shopify.com', 'wix.com', 'squarespace.com',
            'canva.com', 'dropbox.com', 'google.com', 'apple.com',
            'amazon.com', 'amazon.ca', 'ebay.com',
        ];
        if (autoSenderDomains.includes(domain)) return true;

        return false;
    }

    function analyzeEmail(email) {
        const subject = (email.subject || '').toLowerCase();
        const body = (email.bodyPreview || email.preview || '').toLowerCase();
        const text = subject + ' ' + body;

        for (const kw of EXCLUDE_KEYWORDS) {
            if (text.includes(kw.toLowerCase())) {
                return { confidence: 0, keywords: [], phone: null };
            }
        }

        const matched = [];
        for (const kw of LEAD_KEYWORDS) {
            if (text.includes(kw.toLowerCase())) {
                matched.push(kw);
            }
        }

        const phoneRegex = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
        const phoneMatch = text.match(phoneRegex);

        let confidence = 0;
        if (matched.length >= 4) confidence = 3;
        else if (matched.length >= 2) confidence = 2;
        else if (matched.length >= 1) confidence = 1;

        const subjectMatches = matched.filter(kw => subject.includes(kw.toLowerCase()));
        if (subjectMatches.length >= 1) confidence = Math.min(3, confidence + 1);
        if (phoneMatch) confidence = Math.min(3, confidence + 1);

        return {
            confidence,
            keywords: matched,
            phone: phoneMatch ? phoneMatch[0] : null,
        };
    }

    // ===== RELATIVE DATE FORMATTING =====

    function formatRelativeDate(dateStr) {
        const now = new Date();
        const date = new Date(dateStr);
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / 60000);
        const diffH = Math.floor(diffMs / 3600000);
        const diffD = Math.floor(diffMs / 86400000);

        if (diffMin < 1) return 'à l\'instant';
        if (diffMin < 60) return `il y a ${diffMin} min`;
        if (diffH < 24) return `il y a ${diffH}h`;
        if (diffD === 1) return 'hier';
        if (diffD < 7) return `il y a ${diffD} jours`;
        return date.toLocaleDateString('fr-CA');
    }

    function formatLastScan() {
        if (!lastScanTime) return '';
        return formatRelativeDate(lastScanTime.toISOString());
    }

    // ===== UI =====

    function showBackgroundSpinner(show) {
        const spinner = document.getElementById('email-scan-spinner');
        if (spinner) {
            spinner.style.display = show ? 'inline-flex' : 'none';
        }
    }

    function updateLastScanDisplay() {
        const el = document.getElementById('email-last-scan');
        if (el && lastScanTime) {
            el.textContent = `Dernière mise à jour: ${formatLastScan()}`;
        }
    }

    function updateUI(state) {
        const container = document.getElementById('email-leads-list');
        if (!container) return;

        if (state === 'scanning') {
            container.innerHTML = `
                <div class="email-placeholder">
                    <p style="font-size:24px">🔍</p>
                    <p>Analyse des courriels en cours...</p>
                    <p style="font-size:12px;color:var(--text-muted)">Vérification des clients existants...</p>
                </div>
            `;
            return;
        }

        if (state === 'no-auth') {
            container.innerHTML = `
                <div class="email-placeholder">
                    <p style="font-size:24px">🔒</p>
                    <p><strong>Connexion Microsoft 365 requise</strong></p>
                    <p style="font-size:13px;color:var(--text-muted);margin-top:8px">
                        Pour scanner vos courriels Outlook, vous devez être connecté avec votre compte M365.<br>
                        En mode démo, des courriels fictifs sont utilisés.
                    </p>
                    <p style="font-size:12px;color:var(--text-muted);margin-top:12px">
                        Allez dans ⚙️ Paramètres → M365 pour configurer la connexion.
                    </p>
                </div>
            `;
            return;
        }

        if (state === 'no-mailbox') {
            container.innerHTML = `
                <div class="email-placeholder">
                    <p style="font-size:24px">📭</p>
                    <p><strong>Boîte Outlook non disponible</strong></p>
                    <p style="font-size:13px;color:var(--text-muted);margin-top:8px">
                        Votre compte M365 (${Auth.getUser()?.email || ''}) n'a pas de boîte de courriel Outlook.<br>
                        C'est normal pour les comptes administrateurs.
                    </p>
                    <p style="font-size:13px;color:var(--text-secondary);margin-top:8px">
                        <strong>Solution:</strong> Allez dans ⚙️ Paramètres → Connexion M365 et entrez une <strong>boîte partagée</strong><br>
                        (ex: soumission@pflgc.com ou charles.maltais@pflgc.com)
                    </p>
                </div>
            `;
            return;
        }

        // ===== HEADER BAR: last scan + spinner + refresh button =====
        let headerHtml = `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:8px 12px;background:var(--bg);border-radius:var(--radius);font-size:12px;color:var(--text-muted)">
                <span id="email-last-scan">${lastScanTime ? `Dernière mise à jour: ${formatLastScan()}` : ''}</span>
                <span id="email-scan-spinner" style="display:none;align-items:center;gap:4px;color:var(--primary)">
                    <svg width="14" height="14" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31 31" stroke-linecap="round"/></svg>
                    Actualisation...
                </span>
                <button class="btn btn-sm btn-outline" onclick="EmailScanner.scanEmails()" style="margin-left:auto;font-size:11px" title="Actualiser maintenant">
                    🔄 Actualiser
                </button>
            </div>
            <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        `;

        if (detectedLeads.length === 0) {
            container.innerHTML = headerHtml + `
                <div class="email-placeholder">
                    <p style="font-size:24px">✅</p>
                    <p><strong>Aucun lead potentiel détecté</strong></p>
                    <p style="font-size:12px;margin-top:8px;color:var(--text-muted)">
                        Les courriels des 7 derniers jours ont été analysés et filtrés.<br>
                        Courriels internes (@pflgc.com), notifications automatiques et messages sans lien avec des demandes de clients ont été exclus.
                    </p>
                </div>
            `;
            return;
        }

        // Count existing vs new
        const existingCount = detectedLeads.filter(l => l.existingDeal).length;
        const newCount = detectedLeads.length - existingCount;
        const processedCount = getProcessed().length;
        const dismissedCount = getDismissed().length;

        let html = headerHtml + `
            <div style="display:flex;gap:16px;margin-bottom:16px;padding:12px;background:var(--bg);border-radius:var(--radius);font-size:13px;flex-wrap:wrap;align-items:center">
                <span><strong>${detectedLeads.length}</strong> courriels à traiter</span>
                ${existingCount > 0 ? `<span style="color:var(--info)">📋 <strong>${existingCount}</strong> clients existants</span>` : ''}
                ${newCount > 0 ? `<span style="color:var(--success)">🆕 <strong>${newCount}</strong> nouveaux leads</span>` : ''}
                <span style="color:var(--text-muted)">✅ ${processedCount} traités | 🚫 ${dismissedCount} ignorés</span>
                ${processedCount + dismissedCount > 0 ? `<button class="btn btn-sm btn-outline" onclick="EmailScanner.resetHistory()" style="margin-left:auto" title="Réinitialiser pour revoir les courriels déjà traités">🔄 Réinitialiser</button>` : ''}
            </div>
        `;

        html += detectedLeads.map(lead => renderLeadCard(lead)).join('');

        container.innerHTML = html;
    }

    function renderLeadCard(lead) {
        const confClass = lead.confidence >= 3 ? 'high' : lead.confidence >= 2 ? 'medium' : 'low';
        const confLabel = lead.confidence >= 3 ? 'Élevée' : lead.confidence >= 2 ? 'Moyenne' : 'Faible';
        const isExisting = lead.existingDeal !== null;
        const relDate = formatRelativeDate(lead.date);

        // Escape single quotes in IDs for onclick handlers
        const safeId = lead.id.replace(/'/g, "\\'");

        return `
            <div class="email-lead-card" style="${isExisting ? 'border-left:4px solid var(--info)' : 'border-left:4px solid var(--success)'}">
                <div style="flex:1;min-width:0">
                    ${isExisting ? `
                        <div style="background:var(--info-light, #e8f4fd);color:var(--info);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:8px;display:inline-block">
                            📋 CLIENT EXISTANT: ${_esc(lead.existingDeal.clientName)} (${lead.matchReason})
                            — Étape: ${Deals.getStageName(lead.existingDeal.stage)}
                        </div>
                    ` : `
                        <div style="background:var(--success-light, #e8fde8);color:var(--success);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:8px;display:inline-block">
                            🆕 NOUVEAU LEAD
                        </div>
                    `}
                    <div style="font-size:14px;margin-bottom:4px">
                        <strong>${_esc(lead.from)}</strong>
                        <span style="color:var(--text-muted);font-size:12px;margin-left:4px">&lt;${_esc(lead.fromEmail)}&gt;</span>
                    </div>
                    <div style="font-weight:700;font-size:13px;margin-bottom:4px">${_esc(lead.subject)}</div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;line-height:1.4;max-width:600px;overflow:hidden;text-overflow:ellipsis">${_esc(lead.preview.substring(0, 150))}${lead.preview.length > 150 ? '...' : ''}</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:11px;color:var(--text-muted)">
                        <span>🕐 ${relDate}</span>
                        ${lead.phone ? `<span style="color:var(--primary);font-weight:600">📞 ${lead.phone}</span>` : ''}
                        <span>🔑 ${lead.matchedKeywords.slice(0, 5).map(k => `<em>${k}</em>`).join(', ')}</span>
                        <span class="email-confidence ${confClass}" style="font-size:10px;padding:2px 6px">${confLabel}</span>
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;min-width:180px">
                    ${isExisting ? `
                        <button class="btn btn-sm btn-primary" onclick="EmailScanner.openExistingDeal('${safeId}')" style="white-space:nowrap">
                            📋 Ouvrir deal de ${_esc(_truncate(lead.existingDeal.clientName, 15))}
                        </button>
                        <button class="btn btn-sm btn-outline" onclick="EmailScanner.addNoteFromEmail('${safeId}')" style="white-space:nowrap">
                            📝 Ajouter note au deal
                        </button>
                        <button class="btn btn-sm btn-outline" onclick="EmailScanner.createDealFromEmail('${safeId}')" style="white-space:nowrap">
                            🆕 Nouveau deal quand même
                        </button>
                        ${lead.allMatches.length > 1 ? `
                            <button class="btn btn-sm btn-outline" onclick="EmailScanner.showAllMatches('${safeId}')" style="white-space:nowrap">
                                📋 ${lead.allMatches.length} deals liés
                            </button>
                        ` : ''}
                        <button class="btn btn-sm btn-outline" style="color:var(--text-muted);white-space:nowrap" onclick="EmailScanner.dismiss('${safeId}')">
                            🚫 Ignorer
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-primary" onclick="EmailScanner.createDealFromEmail('${safeId}')" style="background:var(--success);border-color:var(--success);white-space:nowrap">
                            🆕 Nouveau deal
                        </button>
                        <button class="btn btn-sm btn-outline" onclick="EmailScanner.linkToExistingDeal('${safeId}')" style="white-space:nowrap">
                            🔗 Rattacher à un deal
                        </button>
                        <button class="btn btn-sm btn-outline" style="color:var(--text-muted);white-space:nowrap" onclick="EmailScanner.dismiss('${safeId}')">
                            🚫 Ignorer
                        </button>
                    `}
                </div>
            </div>
        `;
    }

    // Escape HTML to prevent XSS
    function _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function _truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    // ===== ACTIONS =====

    function openExistingDeal(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead || !lead.existingDeal) return;
        App.openDeal(lead.existingDeal.id);
    }

    async function createDealFromEmail(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead) return;

        const dealData = {
            clientName: lead.from,
            clientEmail: lead.fromEmail,
            clientPhone: lead.phone || '',
            clientType: 'regulier',
            leadSource: 'courriel',
            leadDate: new Date(lead.date).toISOString().split('T')[0],
            description: `Lead courriel: "${lead.subject}"`,
        };

        try {
            // Actually create the deal
            const deal = await Deals.create(dealData);

            if (deal) {
                // Add the email as a note
                await Deals.addNote(deal.id, `📧 Courriel initial de ${lead.from} (${lead.fromEmail})\nSujet: ${lead.subject}\n---\n${lead.preview}`);
                markProcessed(lead.id, 'deal_created', lead.from);
                App.showToast(`Deal créé pour ${lead.from}`, 'success');
                // Remove from list
                detectedLeads = detectedLeads.filter(l => l.id !== emailId);
                updateUI('results');
                updateBadge();
                // Open the deal
                App.openDeal(deal.id);
            } else {
                // Fallback: if Deals.create doesn't return the deal, open form pre-filled
                App.openNewDeal(dealData);
                markProcessed(emailId, 'deal_created', lead.from);
                _dismissSilent(emailId);
                App.showToast('Deal pré-rempli depuis le courriel', 'info');
            }
        } catch (e) {
            console.error('Error creating deal from email:', e);
            // Fallback to opening the new deal form pre-filled
            App.openNewDeal(dealData);
            markProcessed(emailId, 'deal_created', lead.from);
            _dismissSilent(emailId);
            App.showToast('Deal pré-rempli depuis le courriel (création auto échouée)', 'warning');
        }
    }

    async function addNoteFromEmail(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead || !lead.existingDeal) return;

        const noteText = `📧 Courriel reçu de ${lead.from} (${lead.fromEmail})\nSujet: ${lead.subject}\n---\n${lead.preview}`;
        await Deals.addNote(lead.existingDeal.id, noteText);
        markProcessed(emailId, 'note_added', lead.existingDeal.clientName);
        App.showToast(`Note ajoutée au deal de ${lead.existingDeal.clientName}`, 'success');
        _dismissSilent(emailId);
        detectedLeads = detectedLeads.filter(l => l.id !== emailId);
        updateUI('results');
        updateBadge();
    }

    function linkToExistingDeal(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead) return;

        const allDeals = Deals.getAll().filter(d => d.status === 'active' || d.status === 'won');
        if (allDeals.length === 0) {
            App.showToast('Aucun deal actif pour rattacher ce courriel', 'warning');
            return;
        }

        let modal = document.getElementById('modal-link-email');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-link-email';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.dataset.emailId = emailId;
        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-link-email').classList.add('hidden')"></div>
            <div class="modal-content" style="z-index:2;max-width:500px">
                <div class="modal-header">
                    <h3>🔗 Rattacher à un deal existant</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-link-email').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
                        Courriel de <strong>${_esc(lead.from)}</strong>: "${_esc(lead.subject)}"
                    </p>
                    <input type="text" id="link-deal-search" class="input-sm" style="width:100%;margin-bottom:12px;padding:8px;border:1px solid var(--border);border-radius:var(--radius)" placeholder="🔍 Rechercher un client..." oninput="EmailScanner._filterLinkDeals(this.value)">
                    <div id="link-deal-list" style="max-height:300px;overflow-y:auto">
                        ${_renderDealPickerList(allDeals.slice(0, 20), emailId)}
                    </div>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');

        // Auto-focus search field
        setTimeout(() => {
            const input = document.getElementById('link-deal-search');
            if (input) input.focus();
        }, 100);
    }

    function _renderDealPickerList(deals, emailId) {
        if (deals.length === 0) {
            return '<p style="text-align:center;color:var(--text-muted);padding:16px;font-size:13px">Aucun deal trouvé</p>';
        }
        return deals.map(d => `
            <div class="dir-card" style="margin-bottom:4px;cursor:pointer;padding:10px;border:1px solid var(--border);border-radius:var(--radius);transition:background 0.15s"
                 onmouseenter="this.style.background='var(--bg-hover, #f5f5f5)'" onmouseleave="this.style.background=''"
                 onclick="EmailScanner._doLink('${emailId}','${d.id}')">
                <div style="flex:1">
                    <div style="font-weight:600;font-size:13px">${_esc(d.clientName)}</div>
                    <div style="font-size:12px;color:var(--text-muted)">${Deals.getStageName(d.stage)} — ${Deals.formatMoney(d.quoteAmount || d.contractAmount || 0)}</div>
                </div>
            </div>
        `).join('');
    }

    function _filterLinkDeals(search) {
        const allDeals = Deals.getAll().filter(d => d.status === 'active' || d.status === 'won');
        const filtered = search
            ? allDeals.filter(d => d.clientName.toLowerCase().includes(search.toLowerCase()))
            : allDeals.slice(0, 20);
        const list = document.getElementById('link-deal-list');
        if (!list) return;
        const modal = document.getElementById('modal-link-email');
        const emailId = modal?.dataset.emailId || '';
        list.innerHTML = _renderDealPickerList(filtered, emailId);
    }

    async function _doLink(emailId, dealId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead) return;

        const noteText = `📧 Courriel rattaché de ${lead.from} (${lead.fromEmail})\nSujet: ${lead.subject}\n---\n${lead.preview}`;
        await Deals.addNote(dealId, noteText);
        const deal = Deals.getById(dealId);
        markProcessed(lead.id, 'linked_to_deal', deal?.clientName || dealId);
        App.showToast(`Courriel rattaché au deal de ${deal?.clientName || dealId}`, 'success');

        // Close modal
        document.getElementById('modal-link-email')?.classList.add('hidden');

        // Remove from detected leads
        detectedLeads = detectedLeads.filter(l => l.id !== emailId);
        _dismissSilent(emailId);
        updateUI('results');
        updateBadge();
    }

    function showAllMatches(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead) return;

        const matchList = lead.allMatches.map(m =>
            `- ${m.deal.clientName} (${m.reason}, étape: ${Deals.getStageName(m.deal.stage)})`
        ).join('\n');

        alert(`Deals possiblement liés:\n\n${matchList}\n\nCliquez "Ouvrir deal" pour voir le meilleur match.`);
    }

    function dismiss(emailId) {
        _dismissSilent(emailId);
        detectedLeads = detectedLeads.filter(l => l.id !== emailId);
        updateUI('results');
        updateBadge();
    }

    // Persist dismissal without updating UI (used internally before another UI update)
    function _dismissSilent(emailId) {
        const dismissed = getDismissed();
        if (!dismissed.includes(emailId)) {
            dismissed.push(emailId);
            saveDismissed(dismissed);
        }
    }

    function updateBadge() {
        const badge = document.getElementById('badge-emails');
        if (badge) {
            if (detectedLeads.length > 0) {
                badge.textContent = detectedLeads.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    function getNewLeadCount() {
        return detectedLeads.length;
    }

    // ===== DEMO DATA =====

    function generateDemoEmails() {
        return [
            {
                id: 'E001', fromName: 'Sophie Gagnon', fromEmail: 'sophie.gagnon@gmail.com',
                subject: 'Re: Soumission fenêtres - question sur le vitrage',
                preview: 'Bonjour, je fais suite à notre discussion. J\'aimerais savoir si le vitrage triple est disponible pour les fenêtres de la soumission que vous m\'avez envoyée. Aussi, est-ce que le prix change beaucoup? Merci!',
                date: new Date(Date.now() - 86400000).toISOString(),
            },
            {
                id: 'E002', fromName: 'Robert Simard', fromEmail: 'robert.simard@gmail.com',
                subject: 'Remplacement de fenêtres - demande de soumission',
                preview: 'Bonjour, nous aimerions avoir une soumission pour le remplacement de 8 fenêtres dans notre maison. La maison date de 1985 et les fenêtres sont d\'origine. Pouvez-vous venir prendre les mesures? Mon téléphone est (418) 555-3421.',
                date: new Date(Date.now() - 86400000).toISOString(),
            },
            {
                id: 'E003', fromName: 'Jean Dupont', fromEmail: 'jean@constructionabc.com',
                subject: 'Projet 12 unités - mise à jour des specs',
                preview: 'Bonjour, suite à notre rencontre, nous avons modifié les plans. Les dimensions des fenêtres du 3e étage ont changé. Pouvez-vous réviser la soumission? Merci',
                date: new Date(Date.now() - 172800000).toISOString(),
            },
            {
                id: 'E004', fromName: 'Marie-Claude Fortier', fromEmail: 'mc.fortier@outlook.com',
                subject: 'Prix pour porte d\'entrée et porte patio',
                preview: 'Bonjour, je suis intéressée par une nouvelle porte d\'entrée et une porte patio pour ma maison à Québec. Combien ça coûte environ? Merci',
                date: new Date(Date.now() - 172800000).toISOString(),
            },
            {
                id: 'E005', fromName: 'Martin Tremblay', fromEmail: 'martin.tremblay@videotron.ca',
                subject: 'Re: Installation - question date',
                preview: 'Bonjour, je voulais savoir quand est prévue l\'installation de mes fenêtres? J\'ai hâte! Pouvez-vous me confirmer la date? Mon numéro est (418) 555-7890',
                date: new Date(Date.now() - 259200000).toISOString(),
            },
            {
                id: 'E006', fromName: 'Microsoft 365', fromEmail: 'noreply@microsoft.com',
                subject: 'Votre abonnement Microsoft 365 a été renouvelé',
                preview: 'Votre abonnement Microsoft 365 Business a été renouvelé automatiquement. Montant: 22.00$/mois.',
                date: new Date(Date.now() - 86400000).toISOString(),
            },
            {
                id: 'E007', fromName: 'Fournisseur ABC', fromEmail: 'factures@fournisseurabc.com',
                subject: 'Facture #12345 - Livraison de matériaux',
                preview: 'Veuillez trouver ci-joint la facture pour la livraison de matériaux du 20 mars. Paiement net 30 jours.',
                date: new Date(Date.now() - 172800000).toISOString(),
            },
        ];
    }

    function resetHistory() {
        if (confirm('Réinitialiser l\'historique des courriels traités? Les courriels déjà ignorés ou traités réapparaîtront au prochain scan.')) {
            localStorage.removeItem(DISMISSED_KEY);
            localStorage.removeItem(PROCESSED_KEY);
            App.showToast('Historique réinitialisé. Relancez le scan.', 'info');
        }
    }

    // ===== PUBLIC API =====
    return {
        // Auto-sync
        init,
        startAutoSync,
        stopAutoSync,
        onNavigateToEmails,
        // Scanning
        scanEmails,
        // Actions
        createDealFromEmail,
        openExistingDeal,
        addNoteFromEmail,
        showAllMatches,
        linkToExistingDeal,
        _filterLinkDeals,
        _doLink,
        dismiss,
        resetHistory,
        // Data access
        getDetectedLeads: () => detectedLeads,
        getNewLeadCount,
    };
})();
