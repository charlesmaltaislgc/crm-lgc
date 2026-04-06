// ===== CRM LGC - Electronic Contracts Module =====
// DocuSign integration for all contract signatures
// Native canvas signature removed — DocuSign is the only signature method

const Contracts = (() => {
    const STORAGE_KEY = 'crm_contracts';
    let contracts = [];

    // DocuSign polling interval reference
    let _docusignPollInterval = null;

    // ===== DOCUSIGN HELPERS =====

    function isDocuSignConfigured() {
        return localStorage.getItem('crm_docusign_enabled') === 'true'
            && !!localStorage.getItem('crm_docusign_integration_key')
            && !!localStorage.getItem('crm_docusign_account_id');
    }

    function getDocuSignAccessToken() {
        return sessionStorage.getItem('crm_docusign_access_token') || null;
    }

    function isDocuSignConnected() {
        return isDocuSignConfigured() && !!getDocuSignAccessToken();
    }

    function getDocuSignBaseUrl() {
        return localStorage.getItem('crm_docusign_base_url') || 'https://demo.docusign.net';
    }

    function getDocuSignApiBase() {
        const base = getDocuSignBaseUrl().replace(/\/+$/, '');
        const accountId = localStorage.getItem('crm_docusign_account_id');
        return `${base}/restapi/v2.1/accounts/${accountId}`;
    }

    async function docuSignFetch(endpoint, options = {}) {
        const token = getDocuSignAccessToken();
        if (!token) throw new Error('DocuSign non connecté. Veuillez vous authentifier dans Paramètres.');
        const url = `${getDocuSignApiBase()}${endpoint}`;
        const resp = await fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });
        if (resp.status === 401) {
            sessionStorage.removeItem('crm_docusign_access_token');
            throw new Error('Session DocuSign expirée. Reconnectez-vous dans Paramètres.');
        }
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.message || `DocuSign erreur ${resp.status}`);
        }
        return resp.json();
    }

    // ===== DOCUSIGN OAUTH (Implicit Grant) =====

    function startDocuSignOAuth() {
        const clientId = localStorage.getItem('crm_docusign_integration_key');
        const redirectUri = localStorage.getItem('crm_docusign_redirect_uri') || window.location.origin + window.location.pathname;
        const base = getDocuSignBaseUrl().replace('demo.docusign.net', 'account-d.docusign.com').replace('www.docusign.net', 'account.docusign.com');
        const authUrl = `${base}/oauth/auth?` + new URLSearchParams({
            response_type: 'token',
            scope: 'signature',
            client_id: clientId,
            redirect_uri: redirectUri,
            state: 'docusign_oauth',
        }).toString();
        window.location.href = authUrl;
    }

    function handleOAuthCallback() {
        // Check for DocuSign implicit grant token in URL hash
        const hash = window.location.hash;
        if (!hash || !hash.includes('access_token')) return false;
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get('access_token');
        const state = params.get('state');
        if (token && state === 'docusign_oauth') {
            sessionStorage.setItem('crm_docusign_access_token', token);
            // Clean hash from URL
            history.replaceState(null, '', window.location.pathname + window.location.search);
            App.showToast('DocuSign connecté avec succès!', 'success');
            return true;
        }
        return false;
    }

    // ===== DOCUSIGN ENVELOPE CREATION =====

    async function sendViaDocuSign(contractId, pdfBase64, pdfName) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract) throw new Error('Contrat introuvable');

        if (!isDocuSignConnected()) {
            throw new Error('DocuSign non connecté. Configurez et connectez DocuSign dans Paramètres.');
        }

        const deal = Deals.getById(contract.dealId);
        const signerEmail = contract.clientEmail;
        const signerName = contract.clientName;

        if (!signerEmail) {
            throw new Error('Le courriel du client est requis pour DocuSign.');
        }

        const ccEmail = Auth.getUser()?.email || '';
        const ccName = Auth.getUser()?.name || 'Vendeur LGC';

        // Build envelope definition
        const envelopeDefinition = {
            emailSubject: `Contrat à signer — ${signerName} — Portes et Fenêtres LGC`,
            emailBlurb: `Bonjour ${signerName},\n\nVeuillez signer le contrat ci-joint pour ${contract.description}.\n\nMerci de votre confiance,\nPortes et Fenêtres LGC`,
            documents: [{
                documentBase64: pdfBase64,
                name: pdfName || `Contrat_${signerName.replace(/\s/g, '_')}.pdf`,
                fileExtension: 'pdf',
                documentId: '1',
            }],
            recipients: {
                signers: [{
                    email: signerEmail,
                    name: signerName,
                    recipientId: '1',
                    routingOrder: '1',
                    tabs: {
                        signHereTabs: [{
                            anchorString: '/sn1/',
                            anchorUnits: 'pixels',
                            anchorXOffset: '0',
                            anchorYOffset: '0',
                        }, {
                            // Fallback: place at bottom of last page
                            documentId: '1',
                            pageNumber: '1',
                            xPosition: '100',
                            yPosition: '600',
                        }],
                        dateSignedTabs: [{
                            documentId: '1',
                            pageNumber: '1',
                            xPosition: '300',
                            yPosition: '650',
                        }],
                        fullNameTabs: [{
                            documentId: '1',
                            pageNumber: '1',
                            xPosition: '100',
                            yPosition: '650',
                        }],
                    },
                }],
                carbonCopies: ccEmail ? [{
                    email: ccEmail,
                    name: ccName,
                    recipientId: '2',
                    routingOrder: '2',
                }] : [],
            },
            status: 'sent',
        };

        const result = await docuSignFetch('/envelopes', {
            method: 'POST',
            body: JSON.stringify(envelopeDefinition),
        });

        // Update contract record with DocuSign info
        const idx = contracts.findIndex(c => c.id === contractId);
        if (idx !== -1) {
            contracts[idx] = {
                ...contracts[idx],
                signMethod: 'docusign',
                docusignEnvelopeId: result.envelopeId,
                docusignStatus: 'sent',
                docusignSentAt: new Date().toISOString(),
                docusignSignedAt: null,
                docusignDocumentUrl: null,
            };
            await _saveContract(contracts[idx]);
        }

        App.showToast(`Contrat envoyé via DocuSign à ${signerEmail}`, 'success');
        App.addActivity('contract', `Contrat envoyé via DocuSign à ${signerEmail}`, contract.dealId);

        // Start polling for this contract
        startDocuSignPolling();

        return result;
    }

    // ===== DOCUSIGN STATUS CHECKING =====

    async function checkDocuSignStatus(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract || !contract.docusignEnvelopeId) return null;
        if (!isDocuSignConnected()) return null;

        try {
            const result = await docuSignFetch(`/envelopes/${contract.docusignEnvelopeId}`);
            const newStatus = result.status; // sent, delivered, viewed, completed, declined, voided

            const idx = contracts.findIndex(c => c.id === contractId);
            if (idx === -1) return null;

            // Map DocuSign status
            const statusMap = {
                sent: 'sent',
                delivered: 'delivered',
                viewed: 'viewed', // not in original spec but useful
                completed: 'signed',
                declined: 'declined',
                voided: 'voided',
            };
            const mappedStatus = statusMap[newStatus] || newStatus;

            contracts[idx].docusignStatus = mappedStatus;

            if (newStatus === 'completed' && !contracts[idx].signed) {
                contracts[idx].signed = true;
                contracts[idx].signDate = result.completedDateTime || new Date().toISOString();
                contracts[idx].docusignSignedAt = result.completedDateTime || new Date().toISOString();
                contracts[idx].signerName = contract.clientName;
                contracts[idx].signMethod = 'docusign';

                // Try to download the signed document
                try {
                    const docResult = await docuSignFetch(`/envelopes/${contract.docusignEnvelopeId}/documents/1`, {
                        headers: { 'Accept': 'application/pdf' },
                    });
                    // docResult would be the PDF - store a reference
                    contracts[idx].docusignDocumentUrl = `${getDocuSignApiBase()}/envelopes/${contract.docusignEnvelopeId}/documents/1`;
                } catch (e) {
                    // Non-blocking: document download is optional
                    console.warn('DocuSign document download failed:', e);
                }

                await _saveContract(contracts[idx]);

                // Update deal stage
                const deal = Deals.getById(contracts[idx].dealId);
                if (deal) {
                    const updates = { contractSignDate: new Date().toISOString().split('T')[0] };
                    if (deal.stage === 8) updates.stage = 9;
                    await Deals.update(deal.id, updates);
                }

                App.showToast(`Contrat signé via DocuSign: ${contract.clientName}`, 'success');
                App.addActivity('contract', `Contrat signé via DocuSign par ${contract.clientName}`, contract.dealId);
                render('pending');
            } else {
                await _saveContract(contracts[idx]);
            }

            return mappedStatus;
        } catch (e) {
            console.warn('DocuSign status check failed:', e.message);
            return null;
        }
    }

    async function checkAllPendingDocuSign() {
        const pendingDS = contracts.filter(c =>
            c.signMethod === 'docusign'
            && !c.signed
            && c.docusignEnvelopeId
            && c.docusignStatus !== 'declined'
            && c.docusignStatus !== 'voided'
        );
        for (const contract of pendingDS) {
            await checkDocuSignStatus(contract.id);
        }
    }

    function startDocuSignPolling() {
        if (_docusignPollInterval) return; // Already polling
        if (!isDocuSignConnected()) return;

        const hasPending = contracts.some(c =>
            c.signMethod === 'docusign'
            && !c.signed
            && c.docusignEnvelopeId
            && c.docusignStatus !== 'declined'
            && c.docusignStatus !== 'voided'
        );
        if (!hasPending) return;

        _docusignPollInterval = setInterval(async () => {
            await checkAllPendingDocuSign();
            // Stop polling if no more pending
            const stillPending = contracts.some(c =>
                c.signMethod === 'docusign' && !c.signed && c.docusignEnvelopeId
                && c.docusignStatus !== 'declined' && c.docusignStatus !== 'voided'
            );
            if (!stillPending) {
                clearInterval(_docusignPollInterval);
                _docusignPollInterval = null;
            }
        }, 120000); // Every 2 minutes
    }

    function stopDocuSignPolling() {
        if (_docusignPollInterval) {
            clearInterval(_docusignPollInterval);
            _docusignPollInterval = null;
        }
    }

    // ===== INTERNAL SAVE HELPER =====

    async function _saveContract(contract) {
        if (Auth.useLocalStorage()) {
            saveLocal();
        } else {
            await Graph.updateListItem('CRM_Contracts', contract.id, {
                Signed: contract.signed,
                SignDate: contract.signDate,
                SignerName: contract.signerName,
                SignMethod: contract.signMethod || 'docusign',
                DocuSignEnvelopeId: contract.docusignEnvelopeId || '',
                DocuSignStatus: contract.docusignStatus || '',
                DocuSignSentAt: contract.docusignSentAt || '',
                DocuSignSignedAt: contract.docusignSignedAt || '',
                DocuSignDocumentUrl: contract.docusignDocumentUrl || '',
            });
        }
    }

    // ===== DOCUSIGN STATUS LABEL HELPERS =====

    function getDocuSignStatusLabel(status) {
        const labels = {
            sent: 'Envoyé',
            delivered: 'Livré',
            viewed: 'Consulté',
            signed: 'Signé',
            declined: 'Refusé',
            voided: 'Annulé',
        };
        return labels[status] || status || '';
    }

    function getDocuSignStatusColor(status) {
        const colors = {
            sent: '#3b82f6',
            delivered: '#8b5cf6',
            viewed: '#f59e0b',
            signed: '#10b981',
            declined: '#ef4444',
            voided: '#6b7280',
        };
        return colors[status] || '#6b7280';
    }

    // ===== LOAD / SAVE =====

    async function loadContracts() {
        if (Auth.useLocalStorage()) {
            const saved = localStorage.getItem(STORAGE_KEY);
            contracts = saved ? JSON.parse(saved) : [];
        } else {
            contracts = await Graph.getListItems('CRM_Contracts') || [];
        }
        // Check for externally signed contracts (signed via the standalone page)
        checkForNewSignatures();

        // Handle DocuSign OAuth callback if present
        handleOAuthCallback();

        // Start DocuSign polling if needed
        if (isDocuSignConnected()) {
            startDocuSignPolling();
        }

        return contracts;
    }

    function checkForNewSignatures() {
        let changed = false;
        contracts.forEach(contract => {
            if (!contract.signed) {
                // Re-read from localStorage in case the signing page updated it
                const fresh = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
                const freshContract = fresh.find(c => c.signToken === contract.signToken);
                if (freshContract?.signed) {
                    contract.signed = true;
                    contract.signDate = freshContract.signDate;
                    contract.signerName = freshContract.signerName;
                    contract.signatureImage = freshContract.signatureImage;
                    contract.signerIP = freshContract.signerIP;
                    changed = true;

                    // Auto-update deal stage to "Contrat signé"
                    const deal = Deals.getById(contract.dealId);
                    if (deal && deal.stage === 8) {
                        Deals.update(deal.id, { stage: 9, contractSignDate: new Date().toISOString().split('T')[0] });
                    }
                }
            }
        });
        if (changed) saveLocal();
    }

    function saveLocal() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
    }

    async function createContract(dealId) {
        const deal = Deals.getById(dealId);
        if (!deal) return null;

        const token = generateToken();
        const signUrl = `${window.location.origin}${window.location.pathname}?sign=${token}`;

        const contract = {
            id: Auth.useLocalStorage() ? 'C' + Date.now() : null,
            dealId,
            clientName: deal.clientName,
            clientEmail: deal.clientEmail,
            clientPhone: deal.clientPhone,
            contractUrl: '',
            signToken: token,
            signUrl: signUrl,
            signed: false,
            signDate: null,
            signerName: null,
            signerIP: null,
            signatureImage: null,
            attachedFiles: [], // IDs of attached files from deal
            createdAt: new Date().toISOString(),
            createdBy: Auth.getUser()?.name || '',
            amount: deal.contractAmount || deal.quoteAmount || 0,
            description: `Contrat pour ${deal.products === 'les-deux' ? 'portes et fenêtres' : deal.products || 'travaux'} - ${deal.clientAddress || ''}`,
            // DocuSign fields
            signMethod: 'docusign',
            docusignEnvelopeId: null,
            docusignStatus: null,
            docusignSentAt: null,
            docusignSignedAt: null,
            docusignDocumentUrl: null,
        };

        if (Auth.useLocalStorage()) {
            contracts.push(contract);
            saveLocal();
        } else {
            const created = await Graph.createListItem('CRM_Contracts', contract);
            if (created) contract.id = created.id;
            contracts.push(contract);
        }

        // Move deal to signature stage if not already past it
        if (deal.stage < 8) {
            await Deals.update(dealId, { stage: 8 });
        }

        App.showToast('Contrat créé - prêt à envoyer pour signature', 'success');
        App.addActivity('contract', `Contrat créé pour ${deal.clientName}`, dealId);
        return contract;
    }

    async function markSigned(contractId, signerName, signatureImage) {
        const idx = contracts.findIndex(c => c.id === contractId);
        if (idx === -1) return;

        contracts[idx] = {
            ...contracts[idx],
            signed: true,
            signDate: new Date().toISOString(),
            signerName: signerName,
            signerIP: 'N/A',
            signatureImage: signatureImage || null,
            signMethod: contracts[idx].signMethod || 'docusign',
        };

        if (Auth.useLocalStorage()) {
            saveLocal();
        } else {
            await Graph.updateListItem('CRM_Contracts', contractId, {
                Signed: true,
                SignDate: new Date().toISOString(),
                SignerName: signerName,
                SignMethod: contracts[idx].signMethod || 'docusign',
            });
        }

        // Update deal
        const deal = Deals.getById(contracts[idx].dealId);
        if (deal) {
            const updates = { contractSignDate: new Date().toISOString().split('T')[0] };
            if (deal.stage === 8) updates.stage = 9;
            await Deals.update(deal.id, updates);
        }

        App.showToast('Contrat signé!', 'success');
        App.showToast('Le deal peut maintenant être marqué comme GAGNÉ dans le pipeline', 'info');
        App.addActivity('contract', `Contrat signé par ${signerName} - ${contracts[idx].clientName}`, contracts[idx].dealId);
    }

    function getContractsForDeal(dealId) {
        return contracts.filter(c => c.dealId === dealId);
    }

    function getPendingContracts() {
        return contracts.filter(c => !c.signed);
    }

    function getSignedContracts() {
        return contracts.filter(c => c.signed);
    }

    // ===== RENDERING =====
    function render(tab = 'pending') {
        const container = document.getElementById('contracts-list');
        if (!container) return;

        let filtered;
        if (tab === 'pending') filtered = getPendingContracts();
        else if (tab === 'signed') filtered = getSignedContracts();
        else filtered = contracts;

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Aucun contrat dans cette catégorie</div>';
            return;
        }

        // Add create button before list
        let headerHtml = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="btn btn-primary" onclick="Contracts.openCreateContract()">+ Créer un contrat</button></div>';
        container.innerHTML = headerHtml + filtered.map(contract => {
            const deal = Deals.getById(contract.dealId);
            const isDocuSign = contract.signMethod === 'docusign';

            // DocuSign status badge
            const statusColor = getDocuSignStatusColor(contract.docusignStatus);
            const statusLabel = getDocuSignStatusLabel(contract.docusignStatus);
            const docuSignBadge = contract.docusignEnvelopeId ? `
                <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44">
                    DocuSign: ${statusLabel}
                </span>
            ` : '';

            return `
                <div class="task-item" style="cursor:pointer">
                    <div style="width:36px;height:36px;border-radius:50%;background:${contract.signed ? 'var(--success-light)' : 'var(--warning-light)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">
                        ${contract.signed ? '✅' : '✍️'}
                    </div>
                    <div class="task-info" onclick="App.openDeal('${contract.dealId}')">
                        <div class="task-description">
                            ${contract.clientName}
                            ${docuSignBadge}
                        </div>
                        <div class="task-meta">
                            ${Deals.formatMoney(contract.amount)}
                            | ${contract.description || ''}
                            ${contract.signed
                                ? ` | Signé le ${Deals.formatDate(contract.signDate)} par ${contract.signerName} (DocuSign)`
                                : ` | Créé le ${Deals.formatDate(contract.createdAt)} par ${contract.createdBy}`
                            }
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;flex-direction:column">
                        ${!contract.signed ? `
                            ${!contract.docusignEnvelopeId ? `
                                <button class="btn btn-sm btn-primary" style="background:#4e46e5" onclick="event.stopPropagation(); Contracts.openDocuSignSendModal('${contract.id}')">
                                    Envoyer via DocuSign
                                </button>
                            ` : `
                                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Contracts.refreshDocuSignStatus('${contract.id}')">
                                    Rafraichir statut
                                </button>
                            `}
                            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Contracts.sendSignEmail('${contract.id}')">
                                Envoyer courriel
                            </button>
                        ` : `
                            ${contract.docusignDocumentUrl ? `
                                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Contracts.downloadDocuSignDocument('${contract.id}')">
                                    Document signe
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Contracts.downloadProof('${contract.id}')">
                                Preuve PDF
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ===== SIGNATURE MODAL (DocuSign only) =====
    function openSignModal(contractId) {
        // Redirect to DocuSign send modal — native signature removed
        openDocuSignSendModal(contractId);
    }

    function _populateDocuSignFileSelect(contract) {
        const container = document.getElementById('docusign-file-select');
        if (!container) return;
        const deal = Deals.getById(contract.dealId);
        const attachments = deal ? App.getAttachments(deal.id) : [];
        const pdfs = attachments.filter(a => a.name && a.name.toLowerCase().endsWith('.pdf'));

        if (pdfs.length === 0) {
            container.innerHTML = `<div style="padding:12px;background:var(--warning-light);border-radius:var(--radius);font-size:13px">
                Aucun PDF trouvé dans ce deal. Ajoutez un PDF dans l'onglet Fichiers du deal avant d'envoyer via DocuSign.
            </div>`;
        } else {
            container.innerHTML = `
                <label style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--text-secondary);display:block;margin-bottom:6px">
                    Document PDF à envoyer
                </label>
                ${pdfs.map(att => `
                    <label class="contract-file-option" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:4px;cursor:pointer">
                        <input type="radio" name="docusign-attachment" value="${att.id}">
                        <span style="flex:1">
                            <span style="font-weight:500">📄 ${att.name}</span>
                            <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${(att.size / 1024).toFixed(0)} Ko</span>
                        </span>
                    </label>
                `).join('')}
            `;
            // Select first by default
            const first = container.querySelector('input[type=radio]');
            if (first) first.checked = true;
        }
    }

    async function confirmSendDocuSign(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract) return;

        if (!contract.clientEmail) {
            App.showToast('Courriel du client requis pour DocuSign', 'error');
            return;
        }

        // Get selected PDF attachment
        const selectedRadio = document.querySelector('input[name="docusign-attachment"]:checked');
        if (!selectedRadio) {
            App.showToast('Sélectionnez un document PDF', 'error');
            return;
        }

        const deal = Deals.getById(contract.dealId);
        const attachments = deal ? App.getAttachments(deal.id) : [];
        const att = attachments.find(a => a.id === selectedRadio.value);

        if (!att || !att.dataUrl) {
            App.showToast('Fichier PDF invalide', 'error');
            return;
        }

        const btn = document.getElementById('btn-send-docusign');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Envoi en cours...';
        }

        try {
            // Extract base64 from dataUrl
            const base64 = att.dataUrl.includes(',') ? att.dataUrl.split(',')[1] : att.dataUrl;

            if (Auth.isDemoMode()) {
                // Demo mode simulation
                await new Promise(r => setTimeout(r, 1000));
                const idx = contracts.findIndex(c => c.id === contractId);
                if (idx !== -1) {
                    contracts[idx] = {
                        ...contracts[idx],
                        signMethod: 'docusign',
                        docusignEnvelopeId: 'DEMO-' + Date.now(),
                        docusignStatus: 'sent',
                        docusignSentAt: new Date().toISOString(),
                    };
                    saveLocal();
                }
                App.showToast(`(Démo) Contrat envoyé via DocuSign à ${contract.clientEmail}`, 'success');
                App.addActivity('contract', `Contrat envoyé via DocuSign à ${contract.clientEmail} (démo)`, contract.dealId);
            } else {
                await sendViaDocuSign(contractId, base64, att.name);
            }

            document.getElementById('modal-confirm').classList.add('hidden');
            document.getElementById('btn-confirm-action').classList.remove('hidden');
            render('pending');
        } catch (e) {
            App.showToast('Erreur DocuSign: ' + e.message, 'error');
        }

        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Envoyer via DocuSign';
        }
    }

    // ===== DOCUSIGN SEND MODAL (from contract list button) =====

    function openDocuSignSendModal(contractId) {
        // Reuse the sign modal but switch to DocuSign tab directly
        openSignModal(contractId);
        setTimeout(() => {
            const dsRadio = document.querySelector('input[name="sign-method"][value="docusign"]');
            if (dsRadio) {
                dsRadio.checked = true;
                toggleSignMethod('docusign');
            }
        }, 100);
    }

    async function refreshDocuSignStatus(contractId) {
        App.showToast('Vérification du statut DocuSign...', 'info');
        const status = await checkDocuSignStatus(contractId);
        if (status) {
            App.showToast(`Statut DocuSign: ${getDocuSignStatusLabel(status)}`, 'info');
            render('pending');
        } else {
            App.showToast('Impossible de vérifier le statut DocuSign', 'warning');
        }
    }

    async function downloadDocuSignDocument(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract || !contract.docusignDocumentUrl) {
            App.showToast('Document DocuSign non disponible', 'warning');
            return;
        }
        // Open DocuSign document URL in new tab (requires valid token)
        if (isDocuSignConnected()) {
            try {
                const token = getDocuSignAccessToken();
                const resp = await fetch(contract.docusignDocumentUrl, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/pdf' },
                });
                if (resp.ok) {
                    const blob = await resp.blob();
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `Contrat_signe_${contract.clientName.replace(/\s/g, '_')}.pdf`;
                    link.click();
                    URL.revokeObjectURL(url);
                    App.showToast('Document DocuSign téléchargé', 'success');
                    return;
                }
            } catch (e) {
                console.warn('DocuSign document download error:', e);
            }
        }
        App.showToast('Reconnectez DocuSign pour télécharger le document', 'warning');
    }

    // ===== DOCUSIGN TEST CONNECTION =====

    async function testDocuSignConnection() {
        if (!isDocuSignConfigured()) {
            return { success: false, message: 'DocuSign non configuré. Remplissez tous les champs.' };
        }
        const token = getDocuSignAccessToken();
        if (!token) {
            return { success: false, message: 'Non connecté. Cliquez "Connecter DocuSign" d\'abord.' };
        }
        try {
            const result = await docuSignFetch('/users');
            return { success: true, message: `Connecté. ${result.resultSetSize || 0} utilisateur(s) trouvé(s).` };
        } catch (e) {
            return { success: false, message: 'Erreur: ' + e.message };
        }
    }

    // Native signature pad removed — all signatures go through DocuSign

    function downloadProof(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract) return;

        const deal = Deals.getById(contract.dealId);
        const isDocuSign = contract.signMethod === 'docusign';

        // Generate a proof of signature as downloadable HTML (printable)
        const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Preuve de signature - ${contract.clientName}</title>
<style>
body{font-family:system-ui;max-width:700px;margin:40px auto;padding:20px;color:#1e293b}
h1{font-size:22px;border-bottom:2px solid #c0392b;padding-bottom:8px}
.info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0;font-size:14px}
.info strong{color:#64748b;font-size:12px;text-transform:uppercase}
.sig-box{border:2px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;margin:24px 0}
.legal{font-size:11px;color:#94a3b8;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0}
.docusign-badge{display:inline-block;padding:4px 12px;background:#4e46e522;color:#4e46e5;border-radius:12px;font-size:12px;font-weight:600;margin-top:8px}
@media print{body{margin:0;padding:20px}}
</style></head><body>
<h1>Portes et Fen&ecirc;tres LGC - Preuve de signature &eacute;lectronique</h1>
<div class="info">
<div><strong>Client</strong><br>${contract.clientName}</div>
<div><strong>Montant</strong><br>${Deals.formatMoney(contract.amount)}</div>
<div><strong>Courriel</strong><br>${contract.clientEmail || 'N/A'}</div>
<div><strong>T&eacute;l&eacute;phone</strong><br>${contract.clientPhone || 'N/A'}</div>
<div><strong>Description</strong><br>${contract.description}</div>
${deal ? `<div><strong>Adresse</strong><br>${deal.clientAddress || 'N/A'}</div>` : ''}
${deal && deal.accountNumber ? `<div><strong># Compte Avantage</strong><br>${deal.accountNumber}</div>` : ''}
${deal && deal.mecinovQuoteNum ? `<div><strong># Soumission Mec-inov</strong><br>${deal.mecinovQuoteNum}</div>` : ''}
<div><strong>M&eacute;thode de signature</strong><br>${isDocuSign ? 'DocuSign' : 'Signature locale'}</div>
</div>
<div class="sig-box">
<p><strong>Sign&eacute; par:</strong> ${contract.signerName}</p>
<p><strong>Date:</strong> ${new Date(contract.signDate).toLocaleString('fr-CA')}</p>
${contract.signatureImage ? `<img src="${contract.signatureImage}" style="max-width:300px;margin:12px 0">` : '<p>(Signature &eacute;lectronique)</p>'}
${isDocuSign ? `
<div class="docusign-badge">Sign&eacute; via DocuSign</div>
<p style="font-size:12px;color:#64748b;margin-top:8px">Envelope ID: ${contract.docusignEnvelopeId || 'N/A'}</p>
${contract.docusignSentAt ? `<p style="font-size:12px;color:#64748b">Envoy&eacute;: ${new Date(contract.docusignSentAt).toLocaleString('fr-CA')}</p>` : ''}
${contract.docusignSignedAt ? `<p style="font-size:12px;color:#64748b">Sign&eacute;: ${new Date(contract.docusignSignedAt).toLocaleString('fr-CA')}</p>` : ''}
` : `<p><strong>Token:</strong> ${contract.signToken}</p>`}
</div>
<div class="legal">
Ce document constitue une preuve de signature &eacute;lectronique. Le signataire a confirm&eacute; avoir lu et accept&eacute;
les termes du contrat. Contrat cr&eacute;&eacute; le ${Deals.formatDate(contract.createdAt)} par ${contract.createdBy}.
${isDocuSign ? 'Signature certifi&eacute;e par DocuSign.' : ''}
Document g&eacute;n&eacute;r&eacute; par CRM LGC - Portes et Fen&ecirc;tres.
</div>
</body></html>`;

        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Preuve_signature_${contract.clientName.replace(/\s/g, '_')}.html`;
        link.click();
        URL.revokeObjectURL(url);
        App.showToast('Preuve de signature téléchargée', 'success');
    }

    function copySignLink(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract) return;
        const link = contract.signUrl || `Lien: ${contract.signToken}`;
        navigator.clipboard.writeText(link).then(() => {
            App.showToast('Lien de signature copié!', 'success');
        }).catch(() => {
            App.showToast('Lien: ' + link, 'info');
        });
    }

    // Contrat courant ouvert dans le modal d'envoi
    let sendingContractId = null;
    let selectedAttachmentId = null;

    function sendSignEmail(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract) return;

        sendingContractId = contractId;
        selectedAttachmentId = null;

        const modal = document.getElementById('modal-send-contract');
        if (!modal) return;

        // Pré-remplir les champs
        document.getElementById('send-contract-to').value = contract.clientEmail || '';
        document.getElementById('send-contract-cc').value = Auth.getUser()?.email || '';
        document.getElementById('send-contract-subject').value = `Contrat à signer — ${contract.clientName} — Portes et Fenêtres LGC`;
        document.getElementById('send-contract-message').value =
`Bonjour ${contract.clientName},

Veuillez trouver ci-joint votre contrat pour signature.

Description : ${contract.description}
Montant : ${Deals.formatMoney(contract.amount)}

Vous pouvez le signer et nous le retourner par courriel, ou nous contacter pour le signer en personne.

Merci de votre confiance,
Portes et Fenêtres LGC`;

        document.getElementById('send-contract-preview').classList.add('hidden');

        // Charger les fichiers du deal
        const deal = Deals.getById(contract.dealId);
        const filesEl = document.getElementById('send-contract-files');
        const attachments = deal ? App.getAttachments(deal.id) : [];
        const pdfs = attachments.filter(a => a.name && a.name.toLowerCase().endsWith('.pdf'));

        if (pdfs.length === 0) {
            filesEl.innerHTML = `<div class="contract-files-empty">
                <p>Aucun PDF trouvé dans ce deal.</p>
                <p style="font-size:12px;color:var(--text-muted)">Ouvrez le deal → onglet Fichiers → glissez le PDF du contrat Mec-inov.</p>
            </div>`;
        } else {
            filesEl.innerHTML = pdfs.map(att => `
                <label class="contract-file-option">
                    <input type="radio" name="contract-attachment" value="${att.id}" onchange="Contracts.selectAttachment('${att.id}')">
                    <span class="contract-file-label">
                        <span>📄 ${att.name}</span>
                        <span style="color:var(--text-muted);font-size:11px">${(att.size/1024).toFixed(0)} Ko — ${Deals.formatDate(att.uploadedAt)}</span>
                    </span>
                </label>
            `).join('');
            // Sélectionner le premier par défaut
            if (pdfs.length === 1) {
                filesEl.querySelector('input[type=radio]').checked = true;
                selectedAttachmentId = pdfs[0].id;
            }
        }

        modal.classList.remove('hidden');
    }

    function selectAttachment(attId) {
        selectedAttachmentId = attId;
    }

    function previewContractEmail() {
        const message = document.getElementById('send-contract-message').value;
        const to = document.getElementById('send-contract-to').value;
        const subject = document.getElementById('send-contract-subject').value;
        const previewEl = document.getElementById('send-contract-preview');
        const previewBody = document.getElementById('send-contract-preview-body');

        previewBody.innerHTML = buildEmailBody(message);
        previewEl.classList.remove('hidden');
    }

    function buildEmailBody(message) {
        const lines = message.split('\n').map(l => `<p style="margin:4px 0">${l || '&nbsp;'}</p>`).join('');
        return `
        <div style="font-family:system-ui;max-width:560px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
            <div style="background:#c0392b;color:white;padding:16px 20px;display:flex;align-items:center;gap:12px">
                <strong style="font-size:16px">Portes et Fenêtres LGC</strong>
            </div>
            <div style="padding:20px;font-size:14px;color:#1e293b;line-height:1.6">
                ${lines}
                <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
                <p style="font-size:11px;color:#94a3b8">Portes et Fenêtres LGC — Fabricant depuis 1994 — Saguenay, Québec</p>
            </div>
        </div>`;
    }

    async function doSendContractEmail() {
        const to = document.getElementById('send-contract-to').value.trim();
        const cc = document.getElementById('send-contract-cc').value.trim();
        const subject = document.getElementById('send-contract-subject').value.trim();
        const message = document.getElementById('send-contract-message').value.trim();

        if (!to) { App.showToast('Courriel destinataire requis', 'error'); return; }
        if (!subject) { App.showToast('Sujet requis', 'error'); return; }
        if (!selectedAttachmentId) { App.showToast('Sélectionnez un fichier PDF à joindre', 'warning'); return; }

        const contract = contracts.find(c => c.id === sendingContractId);
        const deal = contract ? Deals.getById(contract.dealId) : null;
        const attachments = deal ? App.getAttachments(deal.id) : [];
        const att = attachments.find(a => a.id === selectedAttachmentId);

        const btn = document.getElementById('btn-send-contract-email');
        btn.disabled = true;
        btn.textContent = '📤 Envoi...';

        if (Auth.isDemoMode()) {
            await new Promise(r => setTimeout(r, 800));
            App.showToast(`(Démo) Courriel envoyé à ${to} avec ${att?.name || 'le contrat'} en PJ`, 'success');
            document.getElementById('modal-send-contract').classList.add('hidden');
            btn.disabled = false;
            btn.textContent = '📤 Envoyer';
            if (contract) App.addActivity('contract', `Contrat envoyé par courriel à ${to}`, contract.dealId);
            return;
        }

        try {
            const body = buildEmailBody(message);
            const emailAtt = [];
            if (att?.dataUrl && att.dataUrl.includes(',')) {
                emailAtt.push({
                    name: att.name,
                    contentType: 'application/pdf',
                    contentBytes: att.dataUrl.split(',')[1],
                });
            } else if (att) {
                App.showToast('Fichier joint invalide — envoi sans pièce jointe', 'warning');
            }
            await Graph.sendEmail(to, subject, body, cc || null, emailAtt);
            App.showToast('Courriel envoyé avec le contrat en PJ!', 'success');
            document.getElementById('modal-send-contract').classList.add('hidden');
            if (contract) App.addActivity('contract', `Contrat envoyé par courriel à ${to}`, contract.dealId);
        } catch (e) {
            App.showToast('Erreur: ' + e.message, 'error');
        }

        btn.disabled = false;
        btn.textContent = '📤 Envoyer';
    }

    function generateToken() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let token = '';
        for (let i = 0; i < 24; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    // ===== CREATE CONTRACT MODAL =====
    function openCreateContract() {
        const allDeals = Deals.getAll().filter(d => d.status === 'active' && d.stage >= 5);

        let modal = document.getElementById('modal-create-contract');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-create-contract';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-create-contract').classList.add('hidden')"></div>
            <div class="modal-content modal-lg" style="z-index:1;max-height:90vh;overflow-y:auto">
                <div class="modal-header">
                    <h3>📝 Créer un contrat</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-create-contract').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Rechercher le client / deal *</label>
                        <input type="text" id="contract-search-client" class="input-sm" style="width:100%" placeholder="🔍 Tapez le nom du client..." oninput="Contracts.filterContractDeals(this.value)">
                        <div id="contract-deals-list" style="max-height:200px;overflow-y:auto;margin-top:8px">
                            ${allDeals.slice(0, 10).map(d => `
                                <div class="dir-card" style="margin-bottom:4px;cursor:pointer" onclick="Contracts.selectContractDeal('${d.id}')">
                                    <div style="flex:1">
                                        <div style="font-weight:600">${d.clientName}</div>
                                        <div style="font-size:12px;color:var(--text-muted)">${Deals.getStageName(d.stage)} — ${Deals.formatMoney(d.quoteAmount || d.contractAmount || 0)}${d.mecinovQuoteNum ? ' — Mec-inov #' + d.mecinovQuoteNum : ''}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div id="contract-deal-details" class="hidden" style="margin-top:16px">
                        <div style="background:var(--bg);padding:16px;border-radius:var(--radius);margin-bottom:16px">
                            <h4 id="contract-deal-name" style="margin-bottom:8px"></h4>
                            <div id="contract-deal-info" style="font-size:13px"></div>
                        </div>

                        <div class="form-group">
                            <label>Éléments Mec-inov à inclure au contrat</label>
                            <div id="contract-mecinov-items" style="font-size:13px">
                                <p style="color:var(--text-muted)">Les éléments de la soumission Mec-inov seront listés ici</p>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Montant du contrat ($)</label>
                            <input type="number" id="contract-amount" class="input-sm" style="width:200px">
                        </div>

                        <div class="form-group">
                            <label>Notes / Annexe au contrat</label>
                            <textarea id="contract-annexe" rows="4" placeholder="Conditions particulières, modifications, éléments spéciaux..."></textarea>
                        </div>

                        <div class="form-group">
                            <label>Description</label>
                            <input type="text" id="contract-description" class="input-sm" style="width:100%" placeholder="Ex: Remplacement 12 fenêtres + 2 portes">
                        </div>

                        <div class="form-group" style="margin-top:12px;padding:12px;background:#4e46e510;border:1px solid #4e46e533;border-radius:var(--radius)">
                            <div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#4e46e5">
                                <span style="font-size:16px">&#9993;</span>
                                Le contrat sera envoyé via DocuSign pour signature
                            </div>
                            <p style="font-size:12px;color:var(--text-muted);margin-top:4px;margin-left:24px">
                                Apres la creation, vous pourrez selectionner le PDF et l'envoyer au client.
                            </p>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="document.getElementById('modal-create-contract').classList.add('hidden')">Annuler</button>
                    <button class="btn btn-primary" id="btn-create-contract-confirm" onclick="Contracts.confirmCreateContract()">📝 Créer le contrat</button>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    }

    let _selectedContractDealId = null;

    function filterContractDeals(search) {
        const allDeals = Deals.getAll().filter(d => d.status === 'active' && d.stage >= 5);
        const filtered = search
            ? allDeals.filter(d => d.clientName?.toLowerCase().includes(search.toLowerCase()))
            : allDeals.slice(0, 10);
        const list = document.getElementById('contract-deals-list');
        if (!list) return;
        list.innerHTML = filtered.map(d => `
            <div class="dir-card" style="margin-bottom:4px;cursor:pointer" onclick="Contracts.selectContractDeal('${d.id}')">
                <div style="flex:1">
                    <div style="font-weight:600">${d.clientName}</div>
                    <div style="font-size:12px;color:var(--text-muted)">${Deals.getStageName(d.stage)} — ${Deals.formatMoney(d.quoteAmount || d.contractAmount || 0)}${d.mecinovQuoteNum ? ' — Mec-inov #' + d.mecinovQuoteNum : ''}</div>
                </div>
            </div>
        `).join('');
    }

    function selectContractDeal(dealId) {
        const deal = Deals.getById(dealId);
        if (!deal) return;
        _selectedContractDealId = dealId;

        document.getElementById('contract-deal-details')?.classList.remove('hidden');
        document.getElementById('contract-deal-name').textContent = deal.clientName;
        document.getElementById('contract-deal-info').innerHTML = `
            <div>📧 ${deal.clientEmail || 'N/A'} | 📞 ${deal.clientPhone || 'N/A'}</div>
            <div>📍 ${deal.clientAddress || 'N/A'}</div>
            <div>Étape: ${Deals.getStageName(deal.stage)} | Vendeur: ${deal.assignedTo || 'N/A'}</div>
            ${deal.mecinovQuoteNum ? `<div>📋 Soumission Mec-inov #${deal.mecinovQuoteNum}</div>` : ''}
            ${deal.accountNumber ? `<div># Compte Avantage: ${deal.accountNumber}</div>` : ''}
        `;
        document.getElementById('contract-amount').value = deal.contractAmount || deal.quoteAmount || '';
        document.getElementById('contract-description').value = `Contrat pour ${deal.products === 'les-deux' ? 'portes et fenêtres' : deal.products || 'travaux'} - ${deal.clientAddress || ''}`;

        // Mec-inov items (from deal custom fields if available)
        const itemsEl = document.getElementById('contract-mecinov-items');
        if (deal.mecinovItems && deal.mecinovItems.length > 0) {
            itemsEl.innerHTML = deal.mecinovItems.map((item, idx) => `
                <label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
                    <input type="checkbox" class="contract-item-check" checked data-index="${idx}">
                    <span>${item.description || item} ${item.qty ? '(x'+item.qty+')' : ''} ${item.price ? '— ' + Deals.formatMoney(item.price) : ''}</span>
                </label>
            `).join('');
        } else {
            itemsEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px">
                Aucun élément Mec-inov trouvé pour ce deal.<br>
                Les éléments seront disponibles quand le # de soumission Mec-inov est renseigné dans le deal.
            </div>`;
        }
    }

    async function confirmCreateContract() {
        if (!_selectedContractDealId) {
            App.showToast('Sélectionnez un deal d\'abord', 'error');
            return;
        }

        const deal = Deals.getById(_selectedContractDealId);
        if (!deal) return;

        // Update deal with contract amount and description if changed
        const amount = parseFloat(document.getElementById('contract-amount')?.value) || 0;
        const annexe = document.getElementById('contract-annexe')?.value || '';
        const description = document.getElementById('contract-description')?.value || '';
        if (amount) await Deals.update(_selectedContractDealId, { contractAmount: amount });

        const contract = await createContract(_selectedContractDealId);
        if (contract && annexe) {
            contract.annexe = annexe;
            contract.description = description;
            saveLocal();
        }

        document.getElementById('modal-create-contract')?.classList.add('hidden');

        // Always open DocuSign send modal after creation
        if (contract) {
            setTimeout(() => openDocuSignSendModal(contract.id), 300);
        }

        render('pending');
    }

    return {
        loadContracts,
        createContract,
        markSigned,
        getContractsForDeal,
        getPendingContracts,
        getSignedContracts,
        render,
        openSignModal,
        downloadProof,
        copySignLink,
        sendSignEmail,
        selectAttachment,
        previewContractEmail,
        doSendContractEmail,
        openCreateContract,
        filterContractDeals,
        selectContractDeal,
        confirmCreateContract,
        // DocuSign API
        confirmSendDocuSign,
        openDocuSignSendModal,
        refreshDocuSignStatus,
        downloadDocuSignDocument,
        sendViaDocuSign,
        checkDocuSignStatus,
        checkAllPendingDocuSign,
        startDocuSignPolling,
        stopDocuSignPolling,
        testDocuSignConnection,
        startDocuSignOAuth,
        handleOAuthCallback,
        isDocuSignConfigured,
        isDocuSignConnected,
    };
})();
