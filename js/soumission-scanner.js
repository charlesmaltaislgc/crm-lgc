// ===== CRM LGC - Soumission Scanner Module =====
// Scans soumission@pflgc.com, extracts client info + PDF, creates deals automatically

const SoumissionScanner = (() => {
    const MAILBOX = 'soumission@pflgc.com';
    const STORAGE_KEY = 'crm_soumission_processed';
    const SCAN_DAYS = 30;

    let lastResults = [];
    let scanning = false;

    // Team vendeurs emails for matching sender -> vendeur
    function getVendeurs() {
        try {
            const team = JSON.parse(localStorage.getItem('crm_team') || '[]');
            return team.length > 0 ? team : [
                { id: 'charles.maltais', name: 'Charles Maltais', email: 'charles.maltais@pflgc.com', role: 'directeur' },
                { id: 'olivier.maltais', name: 'Olivier Maltais', email: 'olivier.maltais@pflgc.com', role: 'directeur' },
                { id: 'keven.gaudreault', name: 'Keven Gaudreault', email: 'keven.gaudreault@pflgc.com', role: 'directeur' },
                { id: 'sylvain.fillion', name: 'Sylvain Fillion', email: 'sylvain.fillion@pflgc.com', role: 'vendeur' },
                { id: 'fabien', name: 'Fabien Duchossoy', email: 'fabien@pflgc.com', role: 'vendeur' },
                { id: 'claude.amiot', name: 'Claude Amiot', email: 'claude.amiot@pflgc.com', role: 'vendeur' },
                { id: 'nathalie.tremblay', name: 'Nathalie Tremblay', email: 'nathalie.tremblay@pflgc.com', role: 'vendeur' },
            ];
        } catch { return []; }
    }

    function getProcessed() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
    }
    function saveProcessed(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-500)));
    }

    // ===== CLIENT MATCHING WITH CONFIDENCE =====
    function matchClient(clientEmail, clientName, clientPhone) {
        const allClients = typeof Clients !== 'undefined' ? Clients.getAll() : [];
        const allDeals = typeof Deals !== 'undefined' ? Deals.getAll() : [];
        const matches = [];

        const emailLower = (clientEmail || '').toLowerCase().trim();
        const nameLower = (clientName || '').toLowerCase().trim();
        const phoneClean = (clientPhone || '').replace(/\D/g, '');
        const nameParts = nameLower.split(/[\s,]+/).filter(p => p.length > 2);

        // Search in clients database
        for (const client of allClients) {
            const result = scoreMatch(client, emailLower, nameLower, nameParts, phoneClean);
            if (result.score > 0) {
                matches.push({ type: 'client', data: client, ...result });
            }
        }

        // Search in deals too (some deals may not have a matching client entry)
        for (const deal of allDeals) {
            const asClient = {
                name: deal.clientName,
                email: deal.clientEmail,
                phone: deal.clientPhone,
                address: deal.clientAddress,
                id: deal.id
            };
            const result = scoreMatch(asClient, emailLower, nameLower, nameParts, phoneClean);
            if (result.score > 0) {
                // Avoid duplicates if already matched via client
                const isDupe = matches.some(m =>
                    m.data.email && asClient.email &&
                    m.data.email.toLowerCase() === asClient.email.toLowerCase()
                );
                if (!isDupe) {
                    matches.push({ type: 'deal', data: asClient, dealId: deal.id, ...result });
                }
            }
        }

        // Also check Mec-inov quotes
        if (typeof MecinovSync !== 'undefined') {
            const quotes = MecinovSync.getAll();
            for (const q of quotes) {
                const result = scoreMatch({
                    name: q.clientName,
                    email: q.clientEmail,
                    phone: q.clientPhone,
                }, emailLower, nameLower, nameParts, phoneClean);
                if (result.score > 0) {
                    const isDupe = matches.some(m =>
                        m.data.name && q.clientName &&
                        m.data.name.toLowerCase() === q.clientName.toLowerCase()
                    );
                    if (!isDupe) {
                        matches.push({ type: 'mecinov', data: q, quoteNumber: q.quoteNumber, ...result });
                    }
                }
            }
        }

        return matches.sort((a, b) => b.score - a.score);
    }

    function scoreMatch(record, emailLower, nameLower, nameParts, phoneClean) {
        const recEmail = (record.email || '').toLowerCase().trim();
        const recName = (record.name || '').toLowerCase().trim();
        const recPhone = (record.phone || '').replace(/\D/g, '');

        // Email exact match = highest confidence
        if (emailLower && recEmail && recEmail === emailLower) {
            return { score: 100, confidence: 'certain', reason: 'Courriel identique' };
        }

        // Phone match
        if (phoneClean.length >= 10 && recPhone.length >= 10) {
            if (recPhone === phoneClean || recPhone.endsWith(phoneClean.slice(-10)) || phoneClean.endsWith(recPhone.slice(-10))) {
                return { score: 90, confidence: 'fort', reason: 'Telephone identique' };
            }
        }

        // Full name match (both first + last)
        if (nameParts.length >= 2 && recName) {
            const recParts = recName.split(/[\s,]+/).filter(p => p.length > 2);
            const matching = nameParts.filter(p => recParts.some(rp => rp.includes(p) || p.includes(rp)));
            if (matching.length >= 2) {
                return { score: 85, confidence: 'fort', reason: 'Nom complet similaire' };
            }
        }

        // Last name only match
        if (nameParts.length >= 1 && recName) {
            const recParts = recName.split(/[\s,]+/).filter(p => p.length > 2);
            const matching = nameParts.filter(p => recParts.some(rp => rp === p));
            if (matching.length === 1 && nameParts.length <= 2) {
                return { score: 55, confidence: 'moyen', reason: 'Nom de famille similaire' };
            }
        }

        // Email domain match (business)
        const genericDomains = ['gmail.com','outlook.com','hotmail.com','yahoo.com','videotron.ca','bell.net','sympatico.ca','icloud.com','live.ca','live.com','cogeco.ca'];
        if (emailLower && recEmail) {
            const fromDomain = emailLower.split('@')[1];
            const recDomain = recEmail.split('@')[1];
            if (fromDomain && recDomain && fromDomain === recDomain && !genericDomains.includes(fromDomain)) {
                return { score: 65, confidence: 'moyen', reason: 'Meme entreprise (' + fromDomain + ')' };
            }
        }

        return { score: 0, confidence: 'aucun', reason: '' };
    }

    // ===== EXTRACT CLIENT INFO FROM EMAIL =====
    function extractClientFromEmail(email) {
        // The email was sent BY the vendeur TO the client, CC soumission@pflgc.com
        // So the client is in toRecipients (excluding pflgc.com addresses)
        const toRecipients = (email.toRecipients || [])
            .map(r => ({
                email: r.emailAddress?.address || '',
                name: r.emailAddress?.name || ''
            }))
            .filter(r => !r.email.toLowerCase().includes('pflgc.com') && !r.email.toLowerCase().includes('soumission'));

        // CC recipients (excluding soumission@ and pflgc internal)
        const ccRecipients = (email.ccRecipients || [])
            .map(r => ({
                email: r.emailAddress?.address || '',
                name: r.emailAddress?.name || ''
            }))
            .filter(r => !r.email.toLowerCase().includes('pflgc.com') && !r.email.toLowerCase().includes('soumission'));

        // Primary client = first external TO recipient
        const primaryClient = toRecipients[0] || ccRecipients[0] || null;

        // Try to extract phone from body
        const body = email.bodyPreview || email.body?.content || '';
        const phoneRegex = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
        const phoneMatch = phoneRegex.exec(body);
        const phone = phoneMatch ? `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}` : '';

        // Try to extract amount from subject/body
        const amountRegex = /(\d[\d\s]*[\d](?:[.,]\d{2})?)\s*\$/g;
        const amountMatch = amountRegex.exec(email.subject + ' ' + body);
        const amount = amountMatch ? parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.')) : 0;

        // Sender = vendeur
        const senderEmail = (email.from?.emailAddress?.address || '').toLowerCase();
        const senderName = email.from?.emailAddress?.name || '';

        // Match sender to team vendeur
        const vendeurs = getVendeurs();
        const vendeur = vendeurs.find(v =>
            v.email && v.email.toLowerCase() === senderEmail
        ) || { name: senderName, email: senderEmail };

        return {
            client: primaryClient,
            phone,
            amount,
            vendeur,
            allRecipients: [...toRecipients, ...ccRecipients],
            subject: email.subject || '',
            date: email.receivedDateTime || new Date().toISOString(),
            emailId: email.id,
            hasAttachments: email.hasAttachments || false,
        };
    }

    // ===== EXTRACT DATA FROM PDF ATTACHMENT =====
    function extractFromPdfName(fileName) {
        // Mec-inov PDFs often have quote number in name: "001-00123.pdf" or "Soumission_001-00123.pdf"
        const quoteMatch = fileName.match(/(\d{3}-\d{5})/);
        return {
            quoteNumber: quoteMatch ? quoteMatch[1] : null,
            fileName
        };
    }

    // ===== MAIN SCAN FUNCTION =====
    async function scan() {
        if (scanning) return;
        scanning = true;
        lastResults = [];

        try {
            if (Auth.isDemoMode()) {
                lastResults = generateDemoResults();
                scanning = false;
                return lastResults;
            }

            const token = await Auth.getToken();
            if (!token || token === 'demo-token') {
                App.showToast('Connexion M365 requise.', 'error');
                scanning = false;
                return [];
            }

            // Get emails from last N days
            const since = new Date();
            since.setDate(since.getDate() - SCAN_DAYS);
            const filter = `receivedDateTime ge ${since.toISOString()}`;

            App.showToast('Scan de soumission@pflgc.com...', 'info');
            const emails = await Graph.getSharedMailboxEmails(MAILBOX, 50, filter);

            if (!emails || emails.length === 0) {
                App.showToast('Aucun courriel dans soumission@pflgc.com', 'info');
                scanning = false;
                return [];
            }

            const processed = getProcessed();
            const processedIds = new Set(processed.map(p => p.id));

            for (const email of emails) {
                if (processedIds.has(email.id)) continue;

                const extracted = extractClientFromEmail(email);
                if (!extracted.client) continue; // No external recipient found

                // Get attachments if any
                let pdfAttachment = null;
                let quoteInfo = null;
                if (extracted.hasAttachments) {
                    try {
                        const attachments = await Graph.getEmailAttachments(MAILBOX, email.id);
                        pdfAttachment = attachments.find(a =>
                            a.contentType === 'application/pdf' ||
                            (a.name && a.name.toLowerCase().endsWith('.pdf'))
                        );
                        if (pdfAttachment) {
                            quoteInfo = extractFromPdfName(pdfAttachment.name);
                        }
                    } catch (e) {
                        console.warn('Could not fetch attachments:', e.message);
                    }
                }

                // Match to existing client
                const clientMatches = matchClient(
                    extracted.client.email,
                    extracted.client.name,
                    extracted.phone
                );
                const bestMatch = clientMatches.length > 0 ? clientMatches[0] : null;

                lastResults.push({
                    emailId: email.id,
                    date: extracted.date,
                    subject: extracted.subject,
                    vendeur: extracted.vendeur,
                    client: {
                        name: extracted.client.name || '',
                        email: extracted.client.email || '',
                        phone: extracted.phone || '',
                    },
                    amount: extracted.amount,
                    pdf: pdfAttachment ? {
                        name: pdfAttachment.name,
                        contentBytes: pdfAttachment.contentBytes,
                        size: pdfAttachment.size || 0,
                    } : null,
                    quoteNumber: quoteInfo?.quoteNumber || null,
                    match: bestMatch ? {
                        score: bestMatch.score,
                        confidence: bestMatch.confidence,
                        reason: bestMatch.reason,
                        clientName: bestMatch.data.name,
                        clientId: bestMatch.data.id,
                        type: bestMatch.type,
                    } : null,
                    status: 'pending', // pending, created, linked, skipped
                });
            }

            App.showToast(`${lastResults.length} soumission(s) detectee(s)`, 'success');
        } catch (e) {
            console.error('SoumissionScanner error:', e);
            App.showToast('Erreur scan: ' + e.message, 'error');
        }

        scanning = false;
        return lastResults;
    }

    // ===== AUTO-CREATE DEAL + CLIENT =====
    async function processEntry(index, action) {
        const entry = lastResults[index];
        if (!entry) return;

        if (action === 'skip') {
            entry.status = 'skipped';
            markProcessed(entry.emailId, 'skipped');
            return entry;
        }

        if (action === 'create' || action === 'link') {
            // Create or update client
            let client;
            if (action === 'link' && entry.match && entry.match.clientId) {
                client = Clients.getById(entry.match.clientId);
                // Update with any new info
                if (client) {
                    Clients.update(client.id, {
                        email: entry.client.email || client.email,
                        phone: entry.client.phone || client.phone,
                    });
                }
            }

            if (!client) {
                client = Clients.create({
                    name: entry.client.name || entry.subject,
                    email: entry.client.email,
                    phone: entry.client.phone,
                });
            }

            // Create deal
            const deal = await Deals.create({
                clientName: client.name,
                clientEmail: client.email,
                clientPhone: client.phone,
                clientAddress: client.address || '',
                leadSource: 'courriel',
                stage: 5, // Soumission envoyee
                quoteAmount: entry.amount || 0,
                assignedTo: entry.vendeur.id || entry.vendeur.name,
                quoteSentDate: entry.date.split('T')[0],
                description: `Soumission recue par courriel: ${entry.subject}`,
                mecinovQuoteNum: entry.quoteNumber || '',
            });

            // Save PDF to MecinovSync if available
            if (entry.pdf && entry.pdf.contentBytes && deal) {
                if (entry.quoteNumber && typeof MecinovSync !== 'undefined') {
                    MecinovSync.savePDF(entry.quoteNumber, entry.pdf.contentBytes, entry.pdf.name);
                    MecinovSync.linkToDeal(entry.quoteNumber, deal.id);
                }
                // Also store in deal notes
                await Deals.addNote(deal.id, `PDF soumission: ${entry.pdf.name}`, {
                    type: 'soumission-pdf',
                    fileName: entry.pdf.name,
                });
            }

            entry.status = 'created';
            entry.createdDealId = deal.id;
            entry.createdClientId = client.id;
            markProcessed(entry.emailId, 'created', { dealId: deal.id, clientId: client.id });
            return entry;
        }
    }

    // Process all pending entries automatically
    async function processAll() {
        let created = 0;
        let linked = 0;
        let skipped = 0;

        for (let i = 0; i < lastResults.length; i++) {
            const entry = lastResults[i];
            if (entry.status !== 'pending') continue;

            if (entry.match && entry.match.score >= 85) {
                // High confidence - auto-link
                await processEntry(i, 'link');
                linked++;
            } else if (entry.match && entry.match.score >= 55) {
                // Medium confidence - create but flag for review
                await processEntry(i, 'create');
                created++;
            } else {
                // New client - create from scratch
                await processEntry(i, 'create');
                created++;
            }
        }

        App.showToast(`${created} cree(s), ${linked} lie(s), ${skipped} ignore(s)`, 'success');
        return { created, linked, skipped };
    }

    function markProcessed(emailId, action, detail) {
        const processed = getProcessed();
        processed.push({ id: emailId, action, detail, date: new Date().toISOString() });
        saveProcessed(processed);
    }

    // ===== RENDER UI =====
    function render(container) {
        if (!container) return;

        const confidenceLabel = (score) => {
            if (score >= 85) return '<span style="color:#27ae60;font-weight:600">Certain</span>';
            if (score >= 65) return '<span style="color:#f39c12;font-weight:600">Fort</span>';
            if (score >= 55) return '<span style="color:#e67e22;font-weight:600">Moyen</span>';
            return '<span style="color:#e74c3c;font-weight:600">Nouveau</span>';
        };

        const confidenceBadge = (score) => {
            if (score >= 85) return 'background:#27ae60';
            if (score >= 65) return 'background:#f39c12';
            if (score >= 55) return 'background:#e67e22';
            return 'background:#e74c3c';
        };

        const statusBadge = (status) => {
            if (status === 'created') return '<span style="background:#27ae60;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">Cree</span>';
            if (status === 'linked') return '<span style="background:#3498db;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">Lie</span>';
            if (status === 'skipped') return '<span style="background:#95a5a6;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">Ignore</span>';
            return '<span style="background:#f39c12;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">En attente</span>';
        };

        let html = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <div>
                    <h3 style="margin:0">Scanner soumission@pflgc.com</h3>
                    <p style="color:var(--text-muted);font-size:13px;margin:4px 0 0">
                        Les vendeurs envoient leurs soumissions en CC. Le CRM extrait automatiquement les contacts et cree les deals.
                    </p>
                </div>
                <div style="display:flex;gap:8px">
                    <button onclick="SoumissionScanner.scanAndRender()" class="btn btn-primary" ${scanning ? 'disabled' : ''}>
                        ${scanning ? 'Scan en cours...' : 'Scanner la boite'}
                    </button>
                    ${lastResults.filter(r => r.status === 'pending').length > 0 ? `
                        <button onclick="SoumissionScanner.processAllAndRender()" class="btn" style="background:#27ae60;color:#fff">
                            Traiter tout automatiquement
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        if (lastResults.length === 0) {
            html += `
                <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
                    <div style="font-size:48px;margin-bottom:12px">📬</div>
                    <p>Cliquez sur "Scanner la boite" pour detecter les soumissions envoyees par vos vendeurs.</p>
                    <p style="font-size:13px">Les vendeurs n'ont qu'a mettre <strong>soumission@pflgc.com</strong> en CC quand ils envoient une soumission.</p>
                </div>
            `;
        } else {
            // Stats bar
            const pending = lastResults.filter(r => r.status === 'pending').length;
            const created = lastResults.filter(r => r.status === 'created').length;
            const highConf = lastResults.filter(r => r.match && r.match.score >= 85).length;
            const newClients = lastResults.filter(r => !r.match || r.match.score < 55).length;

            html += `
                <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
                    <div style="background:var(--bg-card);padding:12px 20px;border-radius:8px;flex:1;min-width:120px;text-align:center">
                        <div style="font-size:24px;font-weight:700">${lastResults.length}</div>
                        <div style="font-size:11px;color:var(--text-muted)">SOUMISSIONS</div>
                    </div>
                    <div style="background:var(--bg-card);padding:12px 20px;border-radius:8px;flex:1;min-width:120px;text-align:center">
                        <div style="font-size:24px;font-weight:700;color:#27ae60">${highConf}</div>
                        <div style="font-size:11px;color:var(--text-muted)">CLIENTS RECONNUS</div>
                    </div>
                    <div style="background:var(--bg-card);padding:12px 20px;border-radius:8px;flex:1;min-width:120px;text-align:center">
                        <div style="font-size:24px;font-weight:700;color:#e74c3c">${newClients}</div>
                        <div style="font-size:11px;color:var(--text-muted)">NOUVEAUX CLIENTS</div>
                    </div>
                    <div style="background:var(--bg-card);padding:12px 20px;border-radius:8px;flex:1;min-width:120px;text-align:center">
                        <div style="font-size:24px;font-weight:700;color:#f39c12">${pending}</div>
                        <div style="font-size:11px;color:var(--text-muted)">EN ATTENTE</div>
                    </div>
                    <div style="background:var(--bg-card);padding:12px 20px;border-radius:8px;flex:1;min-width:120px;text-align:center">
                        <div style="font-size:24px;font-weight:700;color:#3498db">${created}</div>
                        <div style="font-size:11px;color:var(--text-muted)">TRAITES</div>
                    </div>
                </div>
            `;

            // Results table
            html += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="background:var(--bg-card);border-bottom:2px solid var(--border)">
                        <th style="padding:10px;text-align:left">Date</th>
                        <th style="padding:10px;text-align:left">Vendeur</th>
                        <th style="padding:10px;text-align:left">Client (extrait)</th>
                        <th style="padding:10px;text-align:left">Objet</th>
                        <th style="padding:10px;text-align:center">PDF</th>
                        <th style="padding:10px;text-align:center">Montant</th>
                        <th style="padding:10px;text-align:center">Confiance</th>
                        <th style="padding:10px;text-align:left">Match</th>
                        <th style="padding:10px;text-align:center">Statut</th>
                        <th style="padding:10px;text-align:center">Actions</th>
                    </tr>
                </thead>
                <tbody>`;

            for (let i = 0; i < lastResults.length; i++) {
                const r = lastResults[i];
                const date = new Date(r.date).toLocaleDateString('fr-CA');
                const score = r.match ? r.match.score : 0;

                html += `
                    <tr style="border-bottom:1px solid var(--border);${r.status !== 'pending' ? 'opacity:0.6' : ''}">
                        <td style="padding:8px 10px">${date}</td>
                        <td style="padding:8px 10px">${r.vendeur.name || '-'}</td>
                        <td style="padding:8px 10px">
                            <strong>${r.client.name || 'Inconnu'}</strong><br>
                            <span style="font-size:11px;color:var(--text-muted)">${r.client.email}</span>
                            ${r.client.phone ? `<br><span style="font-size:11px">${r.client.phone}</span>` : ''}
                        </td>
                        <td style="padding:8px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.subject}</td>
                        <td style="padding:8px 10px;text-align:center">${r.pdf ? '📄' : '-'}</td>
                        <td style="padding:8px 10px;text-align:center;font-weight:600">${r.amount ? r.amount.toLocaleString('fr-CA') + ' $' : '-'}</td>
                        <td style="padding:8px 10px;text-align:center">
                            <div style="display:inline-block;padding:2px 10px;border-radius:12px;color:#fff;font-size:11px;${confidenceBadge(score)}">
                                ${score}%
                            </div>
                        </td>
                        <td style="padding:8px 10px;font-size:12px">
                            ${r.match ? `${r.match.clientName}<br><span style="color:var(--text-muted)">${r.match.reason}</span>` : '<em style="color:#e74c3c">Nouveau client</em>'}
                        </td>
                        <td style="padding:8px 10px;text-align:center">${statusBadge(r.status)}</td>
                        <td style="padding:8px 10px;text-align:center">
                            ${r.status === 'pending' ? `
                                <div style="display:flex;gap:4px;justify-content:center">
                                    <button onclick="SoumissionScanner.processAndRender(${i},'${r.match && r.match.score >= 55 ? 'link' : 'create'}')"
                                        style="background:#27ae60;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px">
                                        ${r.match && r.match.score >= 55 ? 'Lier' : 'Creer'}
                                    </button>
                                    <button onclick="SoumissionScanner.processAndRender(${i},'skip')"
                                        style="background:#95a5a6;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px">
                                        Ignorer
                                    </button>
                                </div>
                            ` : (r.createdDealId ? `<a href="#" onclick="App.openDeal('${r.createdDealId}');return false" style="font-size:11px">Voir deal</a>` : '-')}
                        </td>
                    </tr>`;
            }

            html += '</tbody></table></div>';
        }

        container.innerHTML = html;
    }

    // Convenience methods for onclick
    async function scanAndRender() {
        const container = document.getElementById('soumission-scanner-container');
        await scan();
        render(container);
    }

    async function processAndRender(index, action) {
        const container = document.getElementById('soumission-scanner-container');
        await processEntry(index, action);
        render(container);
    }

    async function processAllAndRender() {
        const container = document.getElementById('soumission-scanner-container');
        await processAll();
        render(container);
    }

    // ===== DEMO DATA =====
    function generateDemoResults() {
        return [
            {
                emailId: 'demo-1', date: '2026-04-02T14:30:00Z',
                subject: 'Soumission - Remplacement fenetres Tremblay',
                vendeur: { name: 'Sylvain Fillion', email: 'sylvain.fillion@pflgc.com', id: 'sylvain.fillion' },
                client: { name: 'Marc Tremblay', email: 'marc.tremblay@gmail.com', phone: '(418) 555-1234' },
                amount: 12500, pdf: { name: '001-00245.pdf', size: 245000 }, quoteNumber: '001-00245',
                match: { score: 85, confidence: 'fort', reason: 'Nom complet similaire', clientName: 'TREMBLAY FREDERIC', type: 'deal' },
                status: 'pending',
            },
            {
                emailId: 'demo-2', date: '2026-04-01T09:15:00Z',
                subject: 'Soumission porte-patio Gagnon',
                vendeur: { name: 'Charles Maltais', email: 'charles.maltais@pflgc.com', id: 'charles.maltais' },
                client: { name: 'Sophie Gagnon', email: 'sophie.gagnon@hotmail.com', phone: '' },
                amount: 4200, pdf: { name: 'Soumission_Gagnon.pdf', size: 180000 }, quoteNumber: null,
                match: { score: 55, confidence: 'moyen', reason: 'Nom de famille similaire', clientName: 'Gagnon - Maison neuve', type: 'deal' },
                status: 'pending',
            },
            {
                emailId: 'demo-3', date: '2026-03-31T16:45:00Z',
                subject: 'Estimation fenetres - nouveau client Lapointe',
                vendeur: { name: 'Keven Gaudreault', email: 'keven.gaudreault@pflgc.com', id: 'keven.gaudreault' },
                client: { name: 'Jean Lapointe', email: 'jlapointe@videotron.ca', phone: '(418) 555-9876' },
                amount: 8900, pdf: { name: '001-00251.pdf', size: 312000 }, quoteNumber: '001-00251',
                match: null,
                status: 'pending',
            },
            {
                emailId: 'demo-4', date: '2026-03-30T11:00:00Z',
                subject: 'RE: Soumission Bouchard renovation',
                vendeur: { name: 'Fabien Duchossoy', email: 'fabien@pflgc.com', id: 'fabien' },
                client: { name: 'Pierre Bouchard', email: 'p.bouchard@gmail.com', phone: '(418) 555-4567' },
                amount: 15800, pdf: null, quoteNumber: null,
                match: { score: 100, confidence: 'certain', reason: 'Courriel identique', clientName: 'Bouchard - Renovation', type: 'deal' },
                status: 'pending',
            },
        ];
    }

    function getResults() { return lastResults; }
    function isScanning() { return scanning; }

    return {
        scan,
        scanAndRender,
        processEntry,
        processAndRender,
        processAll,
        processAllAndRender,
        matchClient,
        render,
        getResults,
        isScanning,
    };
})();
