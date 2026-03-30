// ===== CRM LGC - Email Lead Detection Module =====
// Scans Outlook emails, detects leads, matches existing clients

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

    // ===== CLIENT MATCHING =====
    // Check if the email sender matches an existing client in the CRM
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

        // Sort by score descending, return best matches
        return matches.sort((a, b) => b.score - a.score);
    }

    async function scanEmails() {
        scanning = true;
        detectedLeads = [];
        updateUI('scanning');

        try {
            let emails;
            if (Auth.isDemoMode()) {
                emails = generateDemoEmails();
            } else {
                const token = await Auth.getToken();
                if (!token || token === 'demo-token') {
                    App.showToast('Connexion M365 requise pour scanner les courriels.', 'error');
                    scanning = false;
                    updateUI('no-auth');
                    return;
                }

                // Check service status - mailbox might not be available
                const status = Graph.getServiceStatus();
                if (status.outlook?.status === 'no-mailbox') {
                    const sharedMailbox = localStorage.getItem('crm_sharedMailbox') || '';
                    if (!sharedMailbox) {
                        App.showToast('Votre compte n\'a pas de boîte Outlook. Configurez une boîte partagée dans Paramètres → M365.', 'warning');
                        scanning = false;
                        updateUI('no-mailbox');
                        return;
                    }
                }

                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                emails = await Graph.getEmails(50, `receivedDateTime ge ${weekAgo.toISOString()}`);
                if (!emails || emails.length === 0) {
                    App.showToast('Aucun courriel trouvé dans les 7 derniers jours', 'info');
                }
            }

            for (const email of emails) {
                const fromEmail = (email.from?.emailAddress?.address || email.fromEmail || '').toLowerCase();
                const fromName = email.from?.emailAddress?.name || email.fromName || 'Inconnu';

                // === FILTER 1: Skip internal/system senders ===
                if (isExcludedSender(fromEmail, fromName)) continue;

                // === FILTER 2: Analyze content ===
                const score = analyzeEmail(email);

                // === FILTER 3: Require minimum confidence of 2 (at least 2 keywords or strong signal) ===
                if (score.confidence < 2) continue;

                // Check if client already exists
                const existingMatches = findExistingClient(fromEmail, fromName, score.phone);
                const bestMatch = existingMatches.length > 0 ? existingMatches[0] : null;

                detectedLeads.push({
                    id: email.id || 'E' + Math.random().toString(36).substr(2, 9),
                    from: fromName,
                    fromEmail: fromEmail,
                    subject: email.subject || '',
                    preview: (email.bodyPreview || email.preview || '').substring(0, 200),
                    date: email.receivedDateTime || email.date || new Date().toISOString(),
                    confidence: score.confidence,
                    matchedKeywords: score.keywords,
                    phone: score.phone,
                    // Client matching
                    existingDeal: bestMatch ? bestMatch.deal : null,
                    matchReason: bestMatch ? bestMatch.reason : null,
                    matchScore: bestMatch ? bestMatch.score : 0,
                    allMatches: existingMatches,
                });
            }

            // Sort: existing clients first (they need attention), then by confidence
            detectedLeads.sort((a, b) => {
                // Existing clients with high match first
                if (a.existingDeal && !b.existingDeal) return -1;
                if (!a.existingDeal && b.existingDeal) return 1;
                return b.confidence - a.confidence;
            });

        } catch (e) {
            console.error('Email scan failed:', e);
            App.showToast('Erreur lors du scan des courriels', 'error');
        }

        scanning = false;
        updateUI('results');
        updateBadge();
    }

    function isExcludedSender(email, name) {
        if (!email) return true;
        const emailLower = email.toLowerCase();
        const nameLower = (name || '').toLowerCase();

        // Check excluded sender patterns
        for (const pattern of EXCLUDE_SENDERS) {
            if (emailLower.includes(pattern) || nameLower.includes(pattern)) return true;
        }

        // Check internal company domains
        const domain = emailLower.split('@')[1] || '';
        for (const internalDomain of INTERNAL_DOMAINS) {
            if (domain === internalDomain || domain.endsWith('.' + internalDomain)) return true;
        }

        // Skip common free email auto-senders (e.g. Google Calendar, PayPal, etc.)
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

        if (detectedLeads.length === 0) {
            container.innerHTML = `
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

        let html = `
            <div style="display:flex;gap:16px;margin-bottom:16px;padding:12px;background:var(--bg);border-radius:var(--radius);font-size:13px">
                <span><strong>${detectedLeads.length}</strong> courriels détectés</span>
                ${existingCount > 0 ? `<span style="color:var(--info)">📋 <strong>${existingCount}</strong> clients existants</span>` : ''}
                ${newCount > 0 ? `<span style="color:var(--success)">🆕 <strong>${newCount}</strong> nouveaux leads potentiels</span>` : ''}
            </div>
        `;

        html += detectedLeads.map(lead => {
            const confClass = lead.confidence >= 3 ? 'high' : lead.confidence >= 2 ? 'medium' : 'low';
            const confText = lead.confidence >= 3 ? 'Élevée' : lead.confidence >= 2 ? 'Moyenne' : 'Faible';
            const isExisting = lead.existingDeal !== null;

            return `
                <div class="email-lead-card" style="${isExisting ? 'border-left:4px solid var(--info)' : ''}">
                    <span class="email-confidence ${confClass}">${confText}</span>
                    <div class="email-content">
                        ${isExisting ? `
                            <div style="background:var(--info-light);color:var(--info);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:6px;display:inline-block">
                                📋 CLIENT EXISTANT: ${lead.existingDeal.clientName} (${lead.matchReason})
                                — Étape: ${Deals.getStageName(lead.existingDeal.stage)}
                            </div>
                        ` : ''}
                        <div class="email-from">${lead.from} &lt;${lead.fromEmail}&gt;</div>
                        <div class="email-subject">${lead.subject}</div>
                        <div class="email-preview">${lead.preview}...</div>
                        <div class="email-date">${Deals.formatDate(lead.date)}
                            ${lead.phone ? ` | Tél: ${lead.phone}` : ''}
                            | Mots-clés: ${lead.matchedKeywords.slice(0, 5).join(', ')}
                        </div>
                    </div>
                    <div class="email-actions" style="display:flex;flex-direction:column;gap:6px">
                        ${isExisting ? `
                            <button class="btn btn-sm btn-primary" onclick="EmailScanner.openExistingDeal('${lead.id}')">
                                Ouvrir le deal
                            </button>
                            <button class="btn btn-sm btn-outline" onclick="EmailScanner.addNoteFromEmail('${lead.id}')">
                                Ajouter note
                            </button>
                            ${lead.allMatches.length > 1 ? `
                                <button class="btn btn-sm btn-outline" onclick="EmailScanner.showAllMatches('${lead.id}')">
                                    ${lead.allMatches.length} deals liés
                                </button>
                            ` : ''}
                        ` : `
                            <button class="btn btn-sm btn-primary" onclick="EmailScanner.createDealFromEmail('${lead.id}')">
                                Créer deal
                            </button>
                            <button class="btn btn-sm btn-outline" onclick="EmailScanner.linkToExistingDeal('${lead.id}')">
                                Rattacher à un lead
                            </button>
                        `}
                        <button class="btn btn-sm btn-outline" onclick="EmailScanner.dismiss('${lead.id}')">
                            Ignorer
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    }

    function openExistingDeal(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead || !lead.existingDeal) return;
        App.openDeal(lead.existingDeal.id);
    }

    function linkToExistingDeal(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead) return;

        const allDeals = Deals.getAll().filter(d => d.status === 'active' || d.status === 'won');
        if (allDeals.length === 0) {
            App.showToast('Aucun deal actif pour rattacher ce courriel', 'warning');
            return;
        }

        // Create a simple picker modal
        let modal = document.getElementById('modal-link-email');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-link-email';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-link-email').classList.add('hidden')"></div>
            <div class="modal-content" style="z-index:2;max-width:500px">
                <div class="modal-header">
                    <h3>🔗 Rattacher à un deal existant</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-link-email').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
                        Courriel de <strong>${lead.from}</strong>: "${lead.subject}"
                    </p>
                    <input type="text" id="link-deal-search" class="input-sm" style="width:100%;margin-bottom:12px" placeholder="🔍 Rechercher un client..." oninput="EmailScanner._filterLinkDeals(this.value)">
                    <div id="link-deal-list" style="max-height:300px;overflow-y:auto">
                        ${allDeals.slice(0, 20).map(d => `
                            <div class="dir-card" style="margin-bottom:4px;cursor:pointer" onclick="EmailScanner._doLink('${emailId}','${d.id}')">
                                <div style="flex:1">
                                    <div style="font-weight:600">${d.clientName}</div>
                                    <div style="font-size:12px;color:var(--text-muted)">${Deals.getStageName(d.stage)} — ${Deals.formatMoney(d.quoteAmount || d.contractAmount || 0)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    function _filterLinkDeals(search) {
        const allDeals = Deals.getAll().filter(d => d.status === 'active' || d.status === 'won');
        const filtered = search
            ? allDeals.filter(d => d.clientName.toLowerCase().includes(search.toLowerCase()))
            : allDeals.slice(0, 20);
        const list = document.getElementById('link-deal-list');
        if (!list) return;
        list.innerHTML = filtered.map(d => `
            <div class="dir-card" style="margin-bottom:4px;cursor:pointer" onclick="EmailScanner._doLink('${list.closest('.modal')?.id ? '' : ''}','${d.id}')">
                <div style="flex:1">
                    <div style="font-weight:600">${d.clientName}</div>
                    <div style="font-size:12px;color:var(--text-muted)">${Deals.getStageName(d.stage)} — ${Deals.formatMoney(d.quoteAmount || d.contractAmount || 0)}</div>
                </div>
            </div>
        `).join('');
    }

    async function _doLink(emailId, dealId) {
        // Find the lead from the current emailId context
        let lead = detectedLeads.find(l => l.id === emailId);
        if (!lead) {
            // Try to get from the modal context
            const modal = document.getElementById('modal-link-email');
            const allLeads = detectedLeads;
            lead = allLeads[allLeads.length - 1]; // fallback
        }
        if (!lead) return;

        const noteText = `📧 Courriel rattaché de ${lead.from} (${lead.fromEmail})\nSujet: ${lead.subject}\n---\n${lead.preview}`;
        await Deals.addNote(dealId, noteText);
        const deal = Deals.getById(dealId);
        App.showToast(`Courriel rattaché au deal de ${deal?.clientName || dealId}`, 'success');
        document.getElementById('modal-link-email')?.classList.add('hidden');
        dismiss(lead.id);
    }

    async function addNoteFromEmail(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead || !lead.existingDeal) return;

        const noteText = `📧 Courriel reçu de ${lead.from} (${lead.fromEmail})\nSujet: ${lead.subject}\n---\n${lead.preview}`;
        await Deals.addNote(lead.existingDeal.id, noteText);
        App.showToast(`Note ajoutée au deal de ${lead.existingDeal.clientName}`, 'success');
        dismiss(emailId);
    }

    function showAllMatches(emailId) {
        const lead = detectedLeads.find(l => l.id === emailId);
        if (!lead) return;

        const matchList = lead.allMatches.map(m =>
            `- ${m.deal.clientName} (${m.reason}, étape: ${Deals.getStageName(m.deal.stage)})`
        ).join('\n');

        alert(`Deals possiblement liés:\n\n${matchList}\n\nCliquez "Ouvrir le deal" pour voir le meilleur match.`);
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
            description: `Lead détecté par courriel: "${lead.subject}"`,
        };

        App.openNewDeal(dealData);
        dismiss(emailId);
        App.showToast('Deal pré-rempli depuis le courriel', 'info');
    }

    function dismiss(emailId) {
        detectedLeads = detectedLeads.filter(l => l.id !== emailId);
        updateUI('results');
        updateBadge();
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

    function generateDemoEmails() {
        return [
            {
                // This one matches existing demo deal "Gagnon, Sophie" by name
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
                // This matches "Construction ABC" by company name
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
                // Matches "Tremblay, Martin" by last name
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

    return {
        scanEmails,
        createDealFromEmail,
        openExistingDeal,
        addNoteFromEmail,
        showAllMatches,
        linkToExistingDeal,
        _filterLinkDeals,
        _doLink,
        dismiss,
        getDetectedLeads: () => detectedLeads,
    };
})();
