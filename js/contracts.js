// ===== CRM LGC - Electronic Contracts Module =====
// E-signature with signature pad, PDF preview, contract generation

const Contracts = (() => {
    const STORAGE_KEY = 'crm_contracts';
    let contracts = [];
    let signaturePadCanvas = null;
    let signatureCtx = null;
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    async function loadContracts() {
        if (Auth.useLocalStorage()) {
            const saved = localStorage.getItem(STORAGE_KEY);
            contracts = saved ? JSON.parse(saved) : [];
        } else {
            contracts = await Graph.getListItems('CRM_Contracts') || [];
        }
        // Check for externally signed contracts (signed via the standalone page)
        checkForNewSignatures();
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
        };

        if (Auth.useLocalStorage()) {
            saveLocal();
        } else {
            await Graph.updateListItem('CRM_Contracts', contractId, {
                Signed: true,
                SignDate: new Date().toISOString(),
                SignerName: signerName,
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
            return `
                <div class="task-item" style="cursor:pointer">
                    <div style="width:36px;height:36px;border-radius:50%;background:${contract.signed ? 'var(--success-light)' : 'var(--warning-light)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">
                        ${contract.signed ? '✅' : '✍️'}
                    </div>
                    <div class="task-info" onclick="App.openDeal('${contract.dealId}')">
                        <div class="task-description">${contract.clientName}</div>
                        <div class="task-meta">
                            ${Deals.formatMoney(contract.amount)}
                            | ${contract.description || ''}
                            ${contract.signed
                                ? ` | Signé le ${Deals.formatDate(contract.signDate)} par ${contract.signerName}`
                                : ` | Créé le ${Deals.formatDate(contract.createdAt)} par ${contract.createdBy}`
                            }
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;flex-direction:column">
                        ${!contract.signed ? `
                            <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); Contracts.openSignModal('${contract.id}')">
                                Signer maintenant
                            </button>
                            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Contracts.copySignLink('${contract.id}')">
                                Copier lien
                            </button>
                            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Contracts.sendSignEmail('${contract.id}')">
                                Envoyer courriel
                            </button>
                        ` : `
                            ${contract.signatureImage ? `
                                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Contracts.viewSignature('${contract.id}')">
                                    Voir signature
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

    // ===== SIGNATURE MODAL =====
    function openSignModal(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract) return;

        const deal = Deals.getById(contract.dealId);

        // Build modal content
        const modalBody = `
            <div class="sign-section">
                <h3 style="margin-bottom:16px">Signature électronique</h3>

                <div style="text-align:left;padding:16px;background:var(--bg);border-radius:var(--radius);margin-bottom:16px">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
                        <div><strong>Client:</strong> ${contract.clientName}</div>
                        <div><strong>Montant:</strong> ${Deals.formatMoney(contract.amount)}</div>
                        <div><strong>Courriel:</strong> ${contract.clientEmail || 'N/A'}</div>
                        <div><strong>Téléphone:</strong> ${contract.clientPhone || 'N/A'}</div>
                        <div style="grid-column:1/-1"><strong>Description:</strong> ${contract.description}</div>
                        ${deal ? `<div style="grid-column:1/-1"><strong>Adresse:</strong> ${deal.clientAddress || 'N/A'}</div>` : ''}
                        ${deal && deal.accountNumber ? `<div><strong># Compte Avantage:</strong> ${deal.accountNumber}</div>` : ''}
                        ${deal && deal.mecinovQuoteNum ? `<div><strong># Soumission Mec-inov:</strong> ${deal.mecinovQuoteNum}</div>` : ''}
                    </div>
                </div>

                <div style="margin-bottom:16px">
                    <label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase">
                        Nom du signataire *
                    </label>
                    <input type="text" id="sign-name-input" value="${contract.clientName}"
                           style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px">
                </div>

                <div class="sign-pad">
                    <label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase">
                        Signature (dessinez avec la souris ou le doigt)
                    </label>
                    <canvas id="signature-canvas" width="500" height="150" style="border:2px solid var(--border);border-radius:var(--radius);cursor:crosshair;width:100%;background:white"></canvas>
                    <div class="sign-pad-actions">
                        <button class="btn btn-sm btn-outline" onclick="Contracts.clearSignature()">Effacer</button>
                    </div>
                </div>

                <div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:var(--radius);font-size:12px;color:var(--text-secondary)">
                    <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
                        <input type="checkbox" id="sign-accept-checkbox" style="margin-top:2px">
                        <span>J'accepte les termes de ce contrat et confirme que la signature ci-dessus est la mienne.
                        Je comprends que cette signature électronique a la même valeur légale qu'une signature manuscrite.</span>
                    </label>
                </div>

                <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
                    <button class="btn btn-outline" onclick="document.getElementById('modal-confirm').classList.add('hidden')">Annuler</button>
                    <button class="btn btn-primary" id="btn-confirm-sign" onclick="Contracts.confirmSign('${contract.id}')">
                        Signer le contrat
                    </button>
                </div>
            </div>
        `;

        // Reuse confirm modal
        document.getElementById('confirm-title').textContent = 'Signature de contrat';
        document.getElementById('confirm-message').innerHTML = modalBody;
        document.getElementById('btn-confirm-action').classList.add('hidden');
        document.getElementById('modal-confirm').classList.remove('hidden');

        // Init signature pad after DOM update
        setTimeout(() => initSignaturePad(), 50);
    }

    function initSignaturePad() {
        signaturePadCanvas = document.getElementById('signature-canvas');
        if (!signaturePadCanvas) return;

        signatureCtx = signaturePadCanvas.getContext('2d');
        signatureCtx.strokeStyle = '#1e293b';
        signatureCtx.lineWidth = 2.5;
        signatureCtx.lineCap = 'round';
        signatureCtx.lineJoin = 'round';

        isDrawing = false;

        const getPos = (e) => {
            const rect = signaturePadCanvas.getBoundingClientRect();
            const scaleX = signaturePadCanvas.width / rect.width;
            const scaleY = signaturePadCanvas.height / rect.height;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY,
            };
        };

        const startDraw = (e) => {
            e.preventDefault();
            isDrawing = true;
            const pos = getPos(e);
            lastX = pos.x;
            lastY = pos.y;
            signatureCtx.beginPath();
            signatureCtx.moveTo(lastX, lastY);
        };

        const draw = (e) => {
            if (!isDrawing) return;
            e.preventDefault();
            const pos = getPos(e);
            signatureCtx.lineTo(pos.x, pos.y);
            signatureCtx.stroke();
            lastX = pos.x;
            lastY = pos.y;
        };

        const stopDraw = () => { isDrawing = false; };

        // Mouse events
        signaturePadCanvas.addEventListener('mousedown', startDraw);
        signaturePadCanvas.addEventListener('mousemove', draw);
        signaturePadCanvas.addEventListener('mouseup', stopDraw);
        signaturePadCanvas.addEventListener('mouseleave', stopDraw);

        // Touch events (mobile/tablet)
        signaturePadCanvas.addEventListener('touchstart', startDraw, { passive: false });
        signaturePadCanvas.addEventListener('touchmove', draw, { passive: false });
        signaturePadCanvas.addEventListener('touchend', stopDraw);
    }

    function clearSignature() {
        if (signatureCtx && signaturePadCanvas) {
            signatureCtx.clearRect(0, 0, signaturePadCanvas.width, signaturePadCanvas.height);
        }
    }

    function isSignatureEmpty() {
        if (!signaturePadCanvas) return true;
        const data = signatureCtx.getImageData(0, 0, signaturePadCanvas.width, signaturePadCanvas.height).data;
        // Check if any pixel has been drawn (non-transparent)
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0) return false;
        }
        return true;
    }

    async function confirmSign(contractId) {
        const nameInput = document.getElementById('sign-name-input');
        const checkbox = document.getElementById('sign-accept-checkbox');

        if (!nameInput || !nameInput.value.trim()) {
            App.showToast('Entrez le nom du signataire', 'error');
            return;
        }

        if (!checkbox || !checkbox.checked) {
            App.showToast('Vous devez accepter les termes', 'error');
            return;
        }

        if (isSignatureEmpty()) {
            App.showToast('Veuillez dessiner votre signature', 'error');
            return;
        }

        const signatureImage = signaturePadCanvas.toDataURL('image/png');
        const signerName = nameInput.value.trim();

        await markSigned(contractId, signerName, signatureImage);

        document.getElementById('modal-confirm').classList.add('hidden');
        document.getElementById('btn-confirm-action').classList.remove('hidden');
        render('pending');
    }

    function viewSignature(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract || !contract.signatureImage) return;

        const w = window.open('', '_blank', 'width=600,height=400');
        w.document.write(`
            <html><head><title>Signature - ${contract.clientName}</title>
            <style>body{font-family:system-ui;padding:24px;text-align:center}</style></head><body>
            <h2>Signature de ${contract.signerName}</h2>
            <p>Date: ${new Date(contract.signDate).toLocaleString('fr-CA')}</p>
            <p>Contrat: ${contract.clientName} - ${contract.description}</p>
            <img src="${contract.signatureImage}" style="border:1px solid #ccc;max-width:100%;margin-top:16px">
            </body></html>
        `);
    }

    function downloadProof(contractId) {
        const contract = contracts.find(c => c.id === contractId);
        if (!contract) return;

        const deal = Deals.getById(contract.dealId);

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
@media print{body{margin:0;padding:20px}}
</style></head><body>
<h1>Portes et Fenêtres LGC - Preuve de signature électronique</h1>
<div class="info">
<div><strong>Client</strong><br>${contract.clientName}</div>
<div><strong>Montant</strong><br>${Deals.formatMoney(contract.amount)}</div>
<div><strong>Courriel</strong><br>${contract.clientEmail || 'N/A'}</div>
<div><strong>Téléphone</strong><br>${contract.clientPhone || 'N/A'}</div>
<div><strong>Description</strong><br>${contract.description}</div>
${deal ? `<div><strong>Adresse</strong><br>${deal.clientAddress || 'N/A'}</div>` : ''}
${deal && deal.accountNumber ? `<div><strong># Compte Avantage</strong><br>${deal.accountNumber}</div>` : ''}
${deal && deal.mecinovQuoteNum ? `<div><strong># Soumission Mec-inov</strong><br>${deal.mecinovQuoteNum}</div>` : ''}
</div>
<div class="sig-box">
<p><strong>Signé par:</strong> ${contract.signerName}</p>
<p><strong>Date:</strong> ${new Date(contract.signDate).toLocaleString('fr-CA')}</p>
${contract.signatureImage ? `<img src="${contract.signatureImage}" style="max-width:300px;margin:12px 0">` : '<p>(Signature tapée)</p>'}
<p><strong>Token:</strong> ${contract.signToken}</p>
</div>
<div class="legal">
Ce document constitue une preuve de signature électronique. Le signataire a confirmé avoir lu et accepté
les termes du contrat. Contrat créé le ${Deals.formatDate(contract.createdAt)} par ${contract.createdBy}.
Document généré par CRM LGC - Portes et Fenêtres.
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
            const emailAtt = att?.dataUrl ? [{
                name: att.name,
                contentType: 'application/pdf',
                contentBytes: att.dataUrl.split(',')[1],
            }] : [];
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
        clearSignature,
        confirmSign,
        viewSignature,
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
    };
})();
