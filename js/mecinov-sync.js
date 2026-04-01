/**
 * Mec-inov Sync Module
 * Charge les soumissions Mec-inov et les lie aux deals/contacts du CRM
 */
const MecinovSync = (() => {
    'use strict';

    let quotesData = null;
    let isLoaded = false;

    // Load quotes from JSON
    async function loadQuotes() {
        if (isLoaded && quotesData) return quotesData;
        try {
            const r = await fetch('data/mecinov-quotes.json');
            if (!r.ok) throw new Error('Fichier non trouvé');
            quotesData = await r.json();
            isLoaded = true;
            return quotesData;
        } catch (e) {
            console.warn('MecinovSync: impossible de charger les soumissions', e);
            return [];
        }
    }

    function getAll() { return quotesData || []; }

    function getByQuoteNumber(num) {
        return (quotesData || []).find(q => q.quoteNumber === num);
    }

    function getByClientName(name) {
        if (!name || !quotesData) return [];
        const q = name.toLowerCase();
        return quotesData.filter(qt =>
            (qt.clientName && qt.clientName.toLowerCase().includes(q)) ||
            (qt.clientCompany && qt.clientCompany.toLowerCase().includes(q))
        );
    }

    function getByClientId(id) {
        if (!id || !quotesData) return [];
        return quotesData.filter(q => q.clientId === id);
    }

    // Find matching quotes for a deal (by client name fuzzy match)
    function findForDeal(deal) {
        if (!deal || !quotesData) return [];
        const name = (deal.clientName || '').toLowerCase().replace(/[,.\-]/g, ' ').trim();
        if (!name || name.length < 3) return [];

        const nameParts = name.split(/\s+/).filter(p => p.length > 2);

        return quotesData.filter(q => {
            const qName = (q.clientName || '').toLowerCase();
            const qComp = (q.clientCompany || '').toLowerCase();
            return nameParts.length > 0 && nameParts.every(p => qName.includes(p) || qComp.includes(p));
        }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }

    // Link a quote to a deal
    function linkToDeal(quoteNumber, dealId) {
        const links = JSON.parse(localStorage.getItem('crm_mecinov_links') || '{}');
        if (!links[dealId]) links[dealId] = [];
        if (!links[dealId].includes(quoteNumber)) {
            links[dealId].push(quoteNumber);
        }
        localStorage.setItem('crm_mecinov_links', JSON.stringify(links));

        // Also update the deal's mecinovQuoteNum field
        if (typeof Deals !== 'undefined') {
            const deal = Deals.getById(dealId);
            if (deal && !deal.mecinovQuoteNum) {
                deal.mecinovQuoteNum = quoteNumber;
                Deals.save(deal);
            }
        }
    }

    function unlinkFromDeal(quoteNumber, dealId) {
        const links = JSON.parse(localStorage.getItem('crm_mecinov_links') || '{}');
        if (links[dealId]) {
            links[dealId] = links[dealId].filter(q => q !== quoteNumber);
            localStorage.setItem('crm_mecinov_links', JSON.stringify(links));
        }
    }

    function getLinkedQuotes(dealId) {
        const links = JSON.parse(localStorage.getItem('crm_mecinov_links') || '{}');
        const nums = links[dealId] || [];
        return nums.map(n => getByQuoteNumber(n)).filter(Boolean);
    }

    function getLinkedDealId(quoteNumber) {
        const links = JSON.parse(localStorage.getItem('crm_mecinov_links') || '{}');
        for (const [dealId, nums] of Object.entries(links)) {
            if (nums.includes(quoteNumber)) return dealId;
        }
        return null;
    }

    // PDF management - stored in localStorage as base64
    function savePDF(quoteNumber, base64Data, fileName) {
        const pdfs = JSON.parse(localStorage.getItem('crm_mecinov_pdfs') || '{}');
        pdfs[quoteNumber] = { data: base64Data, fileName, uploadDate: new Date().toISOString() };
        localStorage.setItem('crm_mecinov_pdfs', JSON.stringify(pdfs));
    }

    function getPDF(quoteNumber) {
        const pdfs = JSON.parse(localStorage.getItem('crm_mecinov_pdfs') || '{}');
        return pdfs[quoteNumber] || null;
    }

    function hasPDF(quoteNumber) {
        const pdfs = JSON.parse(localStorage.getItem('crm_mecinov_pdfs') || '{}');
        return !!pdfs[quoteNumber];
    }

    function downloadPDF(quoteNumber) {
        const pdf = getPDF(quoteNumber);
        if (!pdf) {
            if (typeof App !== 'undefined') App.showToast('Aucun PDF pour cette soumission', 'error');
            return;
        }
        const link = document.createElement('a');
        link.href = pdf.data;
        link.download = pdf.fileName || `soumission-${quoteNumber}.pdf`;
        link.click();
    }

    function uploadPDF(quoteNumber) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 10 * 1024 * 1024) {
                App.showToast('Le fichier dépasse 10 Mo', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                savePDF(quoteNumber, reader.result, file.name);
                App.showToast('PDF uploadé pour ' + quoteNumber, 'success');
                // Refresh current view
                render();
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }

    // Stats
    function getStats() {
        const quotes = quotesData || [];
        const total = quotes.reduce((s, q) => s + (q.total || 0), 0);
        const thisMonth = quotes.filter(q => q.date && q.date.startsWith(new Date().toISOString().slice(0, 7)));
        const thisMonthTotal = thisMonth.reduce((s, q) => s + (q.total || 0), 0);
        const links = JSON.parse(localStorage.getItem('crm_mecinov_links') || '{}');
        const linkedNums = new Set();
        Object.values(links).forEach(nums => nums.forEach(n => linkedNums.add(n)));
        return {
            count: quotes.length,
            totalValue: total,
            thisMonthCount: thisMonth.length,
            thisMonthValue: thisMonthTotal,
            avgValue: quotes.length > 0 ? total / quotes.length : 0,
            linkedCount: linkedNums.size,
        };
    }

    // ===== RENDER: Quote detail modal =====
    function showQuoteDetail(quoteNumber) {
        const q = getByQuoteNumber(quoteNumber);
        if (!q) return;

        const linkedDealId = getLinkedDealId(quoteNumber);
        const linkedDeal = linkedDealId && typeof Deals !== 'undefined' ? Deals.getById(linkedDealId) : null;
        const pdf = getPDF(quoteNumber);

        let modal = document.getElementById('modal-mecinov-detail');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-mecinov-detail';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        const fmtMoney = (v) => v ? v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }) : '—';

        modal.innerHTML = `
            <div class="modal-overlay" onclick="document.getElementById('modal-mecinov-detail').classList.add('hidden')"></div>
            <div class="modal-content modal-lg" style="z-index:1;max-width:800px;">
                <div class="modal-header" style="background:#1e3a5f;color:white;">
                    <h3 style="color:white;margin:0;">🔧 Soumission ${q.quoteNumber}</h3>
                    <button class="modal-close" style="color:white" onclick="document.getElementById('modal-mecinov-detail').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body" style="padding:0;max-height:70vh;overflow-y:auto;">
                    <!-- Header info -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid var(--border,#e5e7eb);">
                        <div style="padding:16px 20px;border-right:1px solid var(--border,#e5e7eb);">
                            <div style="font-size:11px;text-transform:uppercase;color:#6b7280;font-weight:600;margin-bottom:4px;">Client</div>
                            <div style="font-size:16px;font-weight:700;">${q.clientName || '—'}</div>
                            ${q.clientCompany && q.clientCompany !== q.clientName ? `<div style="font-size:13px;color:#6b7280;">${q.clientCompany}</div>` : ''}
                            ${q.clientEmail ? `<div style="font-size:13px;margin-top:4px;"><a href="mailto:${q.clientEmail}" style="color:#2563eb;">${q.clientEmail}</a></div>` : ''}
                            ${q.clientPhone ? `<div style="font-size:13px;"><a href="tel:${q.clientPhone}" style="color:#2563eb;">${q.clientPhone}</a></div>` : ''}
                            ${q.clientAddress ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${q.clientAddress}</div>` : ''}
                        </div>
                        <div style="padding:16px 20px;">
                            <div style="font-size:11px;text-transform:uppercase;color:#6b7280;font-weight:600;margin-bottom:4px;">Détails</div>
                            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;">
                                <span style="color:#6b7280;">Date:</span><span style="font-weight:500;">${q.date || '—'}</span>
                                <span style="color:#6b7280;">Expiration:</span><span>${q.dateExpiry || '—'}</span>
                                <span style="color:#6b7280;">Livraison:</span><span>${q.dateDelivery || '—'}</span>
                                <span style="color:#6b7280;">Type:</span><span><span style="background:#e0e7ff;color:#4338ca;padding:1px 8px;border-radius:4px;font-size:11px;">${q.type || '—'}</span></span>
                            </div>
                        </div>
                    </div>

                    <!-- Totals -->
                    <div style="display:flex;gap:0;border-bottom:1px solid var(--border,#e5e7eb);">
                        <div style="flex:1;padding:12px 20px;text-align:center;border-right:1px solid var(--border,#e5e7eb);">
                            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Sous-total</div>
                            <div style="font-size:18px;font-weight:700;">${fmtMoney(q.subtotal)}</div>
                        </div>
                        <div style="flex:1;padding:12px 20px;text-align:center;border-right:1px solid var(--border,#e5e7eb);">
                            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Produits</div>
                            <div style="font-size:18px;font-weight:700;">${q.productCount || 0}</div>
                        </div>
                        <div style="flex:1;padding:12px 20px;text-align:center;background:#f0fdf4;">
                            <div style="font-size:11px;color:#059669;text-transform:uppercase;font-weight:600;">Total</div>
                            <div style="font-size:22px;font-weight:800;color:#059669;">${fmtMoney(q.total)}</div>
                        </div>
                    </div>

                    <!-- Products -->
                    ${q.products && q.products.length > 0 ? `
                        <div style="padding:16px 20px;">
                            <div style="font-size:13px;font-weight:700;margin-bottom:8px;">📦 Produits (${q.products.length})</div>
                            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                                <thead>
                                    <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                                        <th style="text-align:left;padding:6px 10px;font-weight:600;">#</th>
                                        <th style="text-align:left;padding:6px 10px;font-weight:600;">Description</th>
                                        <th style="text-align:center;padding:6px 10px;font-weight:600;">Qté</th>
                                        <th style="text-align:right;padding:6px 10px;font-weight:600;">Prix unit.</th>
                                        <th style="text-align:right;padding:6px 10px;font-weight:600;">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${q.products.map((p, i) => `
                                        <tr style="border-bottom:1px solid #f3f4f6;${i % 2 === 0 ? '' : 'background:#f9fafb;'}">
                                            <td style="padding:6px 10px;font-weight:600;">${p.line || i + 1}</td>
                                            <td style="padding:6px 10px;">${p.description || '—'}</td>
                                            <td style="padding:6px 10px;text-align:center;">${p.qty || 1}</td>
                                            <td style="padding:6px 10px;text-align:right;">${fmtMoney(p.price)}</td>
                                            <td style="padding:6px 10px;text-align:right;font-weight:600;">${fmtMoney((p.price || 0) * (p.qty || 1))}</td>
                                        </tr>
                                        ${p.options && p.options.length > 0 ? p.options.map(o => `
                                            <tr style="background:#fefce8;">
                                                <td></td>
                                                <td colspan="3" style="padding:3px 10px 3px 24px;font-size:11px;color:#92400e;">↳ ${o.description || ''}${o.price > 0 ? ` (+${fmtMoney(o.price)})` : ''}</td>
                                                <td></td>
                                            </tr>
                                        `).join('') : ''}
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : ''}

                    <!-- Options summary -->
                    ${q.options && q.options.length > 0 ? `
                        <div style="padding:0 20px 16px;">
                            <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px;">Options incluses:</div>
                            <div style="display:flex;flex-wrap:wrap;gap:4px;">
                                ${q.options.slice(0, 20).map(o => `<span style="font-size:11px;background:#f3e8ff;color:#7c3aed;padding:2px 8px;border-radius:4px;">${o}</span>`).join('')}
                                ${q.options.length > 20 ? `<span style="font-size:11px;color:#6b7280;">... +${q.options.length - 20} autres</span>` : ''}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Link status + PDF -->
                    <div style="padding:16px 20px;background:var(--bg-secondary,#f7f8fa);border-top:1px solid var(--border,#e5e7eb);">
                        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                            <!-- CRM Link -->
                            ${linkedDeal ? `
                                <div style="display:flex;align-items:center;gap:8px;background:#f0f9ff;border:1px solid #93c5fd;border-radius:8px;padding:8px 14px;">
                                    <span style="font-size:12px;">✅ Lié au deal:</span>
                                    <a href="#" onclick="document.getElementById('modal-mecinov-detail').classList.add('hidden');App.openDeal('${linkedDealId}');return false;" style="font-weight:600;color:#2563eb;font-size:13px;">${linkedDeal.clientName}</a>
                                    <button class="btn btn-sm" style="font-size:10px;color:#ef4444;border:1px solid #ef4444;background:transparent;padding:2px 8px;" onclick="MecinovSync.unlinkFromDeal('${q.quoteNumber}','${linkedDealId}');MecinovSync.showQuoteDetail('${q.quoteNumber}');">Délier</button>
                                </div>
                            ` : `
                                <div style="display:flex;gap:8px;">
                                    <button class="btn btn-sm btn-primary" onclick="MecinovSync._showLinkDealPicker('${q.quoteNumber}')">🔗 Lier à un deal existant</button>
                                    <button class="btn btn-sm" style="background:#059669;color:white;border:none;" onclick="MecinovSync.createDealFromQuote('${q.quoteNumber}').then(()=>{document.getElementById('modal-mecinov-detail').classList.add('hidden');MecinovSync.render();})">🚀 Créer un deal</button>
                                </div>
                            `}

                            <!-- PDF -->
                            <div style="margin-left:auto;display:flex;gap:8px;">
                                ${pdf ? `
                                    <button class="btn btn-sm" style="background:#dc2626;color:white;border:none;" onclick="MecinovSync.downloadPDF('${q.quoteNumber}')">📄 Télécharger PDF</button>
                                    <span style="font-size:11px;color:#6b7280;align-self:center;">Uploadé le ${new Date(pdf.uploadDate).toLocaleDateString('fr-CA')}</span>
                                ` : ''}
                                <button class="btn btn-sm btn-outline" onclick="MecinovSync.uploadPDF('${q.quoteNumber}')">📤 ${pdf ? 'Remplacer' : 'Uploader'} PDF</button>
                            </div>
                        </div>
                        <div id="mecinov-link-picker"></div>
                    </div>
                </div>
            </div>
        `;

        modal.classList.remove('hidden');
    }

    // Deal picker for linking
    function _showLinkDealPicker(quoteNumber) {
        const picker = document.getElementById('mecinov-link-picker');
        if (!picker) return;

        const deals = typeof Deals !== 'undefined' ? Deals.getAll() : [];
        const q = getByQuoteNumber(quoteNumber);
        const clientName = (q?.clientName || '').toLowerCase();

        // Sort: matching client names first
        const sorted = [...deals].sort((a, b) => {
            const aMatch = (a.clientName || '').toLowerCase().includes(clientName) || clientName.includes((a.clientName || '').toLowerCase());
            const bMatch = (b.clientName || '').toLowerCase().includes(clientName) || clientName.includes((b.clientName || '').toLowerCase());
            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
            return 0;
        });

        picker.innerHTML = `
            <div style="margin-top:12px;background:white;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:12px;">
                <div style="font-size:12px;font-weight:600;margin-bottom:8px;">Choisir un deal:</div>
                <input type="text" id="mecinov-deal-search" class="input-sm" placeholder="Rechercher un deal..."
                    style="width:100%;margin-bottom:8px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;"
                    oninput="MecinovSync._filterDealPicker(this.value, '${quoteNumber}')">
                <div id="mecinov-deal-list" style="max-height:200px;overflow-y:auto;">
                    ${sorted.slice(0, 20).map(d => `
                        <div style="padding:8px 10px;border-bottom:1px solid #f3f4f6;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"
                             onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background=''"
                             onclick="MecinovSync.linkToDeal('${quoteNumber}','${d.id}');App.showToast('Soumission liée!','success');MecinovSync.showQuoteDetail('${quoteNumber}');MecinovSync.render();">
                            <div>
                                <div style="font-weight:600;font-size:13px;">${d.clientName || '—'}</div>
                                <div style="font-size:11px;color:#6b7280;">${d.quoteAmount ? d.quoteAmount.toLocaleString('fr-CA', {style:'currency',currency:'CAD'}) : ''} — Étape ${d.stage || '?'}</div>
                            </div>
                            <span style="color:#2563eb;font-size:12px;font-weight:600;">+ Lier</span>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-sm btn-outline" style="margin-top:8px;" onclick="document.getElementById('mecinov-link-picker').innerHTML='';">Annuler</button>
            </div>
        `;
    }

    function _filterDealPicker(query, quoteNumber) {
        const list = document.getElementById('mecinov-deal-list');
        if (!list || typeof Deals === 'undefined') return;
        const deals = Deals.getAll();
        const q = query.toLowerCase();
        const filtered = q.length >= 2 ? deals.filter(d =>
            (d.clientName || '').toLowerCase().includes(q) ||
            (d.clientEmail || '').toLowerCase().includes(q) ||
            (d.clientPhone || '').includes(q)
        ) : deals;

        list.innerHTML = filtered.slice(0, 20).map(d => `
            <div style="padding:8px 10px;border-bottom:1px solid #f3f4f6;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"
                 onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background=''"
                 onclick="MecinovSync.linkToDeal('${quoteNumber}','${d.id}');App.showToast('Soumission liée!','success');MecinovSync.showQuoteDetail('${quoteNumber}');MecinovSync.render();">
                <div>
                    <div style="font-weight:600;font-size:13px;">${d.clientName || '—'}</div>
                    <div style="font-size:11px;color:#6b7280;">${d.quoteAmount ? d.quoteAmount.toLocaleString('fr-CA', {style:'currency',currency:'CAD'}) : ''} — Étape ${d.stage || '?'}</div>
                </div>
                <span style="color:#2563eb;font-size:12px;font-weight:600;">+ Lier</span>
            </div>
        `).join('');
    }

    // ===== RENDER: Mec-inov quotes panel for deal detail =====
    function renderForDeal(dealId, containerEl) {
        if (!containerEl) return;

        const deal = typeof Deals !== 'undefined' ? Deals.getById(dealId) : null;
        const linked = getLinkedQuotes(dealId);
        const suggested = deal ? findForDeal(deal) : [];

        const linkedNums = new Set(linked.map(q => q.quoteNumber));
        const unlinked = suggested.filter(q => !linkedNums.has(q.quoteNumber));

        const fmtMoney = (v) => v ? v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }) : '—';

        containerEl.innerHTML = `
            <div style="margin-top:8px;">
                <h4 style="margin:0 0 12px;font-size:14px;display:flex;align-items:center;gap:6px;">
                    🔧 Soumissions Mec-inov
                    <span style="font-size:11px;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:10px;">${linked.length} liée${linked.length !== 1 ? 's' : ''}</span>
                </h4>

                ${linked.length > 0 ? `
                    <div style="margin-bottom:12px;">
                        ${linked.map(q => _renderQuoteCard(q, dealId, true)).join('')}
                    </div>
                ` : ''}

                ${unlinked.length > 0 ? `
                    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;margin-bottom:8px;">
                        <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:8px;">
                            💡 ${unlinked.length} soumission${unlinked.length !== 1 ? 's' : ''} trouvée${unlinked.length !== 1 ? 's' : ''} pour ce client
                        </div>
                        ${unlinked.slice(0, 5).map(q => _renderQuoteCard(q, dealId, false)).join('')}
                        ${unlinked.length > 5 ? `<div style="font-size:11px;color:#92400e;margin-top:4px;">... et ${unlinked.length - 5} autres</div>` : ''}
                    </div>
                ` : ''}

                ${linked.length === 0 && unlinked.length === 0 ? `
                    <div style="text-align:center;padding:16px;color:#9ca3af;font-size:13px;">
                        Aucune soumission Mec-inov trouvée pour ce client
                    </div>
                ` : ''}
            </div>
        `;
    }

    function _renderQuoteCard(q, dealId, isLinked) {
        const fmtMoney = (v) => v ? v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }) : '—';
        const pdf = hasPDF(q.quoteNumber);
        return `
            <div style="background:${isLinked ? '#f0f9ff' : '#fff'};border:1px solid ${isLinked ? '#93c5fd' : '#e5e7eb'};border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:13px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div style="flex:1;cursor:pointer;" onclick="MecinovSync.showQuoteDetail('${q.quoteNumber}')">
                        <div style="font-weight:700;color:#1e3a5f;">
                            📋 ${q.quoteNumber}
                            <span style="font-weight:400;color:#6b7280;font-size:12px;margin-left:6px;">${q.date || ''}</span>
                            ${q.type ? `<span style="font-size:10px;background:#e0e7ff;color:#4338ca;padding:1px 6px;border-radius:4px;margin-left:4px;">${q.type}</span>` : ''}
                            ${pdf ? '<span style="font-size:10px;background:#fecaca;color:#dc2626;padding:1px 6px;border-radius:4px;margin-left:4px;">📄 PDF</span>' : ''}
                        </div>
                        <div style="color:#374151;margin-top:2px;">
                            ${q.clientName || 'Client inconnu'}
                            ${q.clientCompany && q.clientCompany !== q.clientName ? ` <span style="color:#9ca3af;">— ${q.clientCompany}</span>` : ''}
                        </div>
                        <div style="font-size:18px;font-weight:800;color:#059669;margin-top:4px;">
                            ${fmtMoney(q.total)}
                        </div>
                        ${q.productCount > 0 ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${q.productCount} produit${q.productCount > 1 ? 's' : ''}</div>` : ''}
                    </div>
                    <div style="flex-shrink:0;margin-left:8px;display:flex;flex-direction:column;gap:4px;">
                        <button class="btn btn-sm btn-outline" style="font-size:11px;" onclick="MecinovSync.showQuoteDetail('${q.quoteNumber}')">👁️ Détails</button>
                        ${isLinked ? `
                            <button class="btn btn-sm" style="color:#ef4444;border:1px solid #ef4444;background:transparent;font-size:11px;"
                                onclick="MecinovSync.unlinkFromDeal('${q.quoteNumber}','${dealId}');MecinovSync.renderForDeal('${dealId}', this.closest('[data-mecinov-container]'));">
                                Délier
                            </button>
                        ` : `
                            <button class="btn btn-sm btn-primary" style="font-size:11px;"
                                onclick="MecinovSync.linkToDeal('${q.quoteNumber}','${dealId}');MecinovSync.renderForDeal('${dealId}', this.closest('[data-mecinov-container]'));App.showToast('Soumission liée!','success');">
                                + Lier
                            </button>
                        `}
                        ${pdf ? `<button class="btn btn-sm" style="font-size:11px;background:#dc2626;color:white;border:none;" onclick="MecinovSync.downloadPDF('${q.quoteNumber}')">📄 PDF</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // ===== RENDER: Full quotes browser page =====
    function render() {
        const container = document.getElementById('mecinov-quotes-content');
        if (!container) return;

        const quotes = quotesData || [];
        const stats = getStats();

        container.innerHTML = `
            <div style="padding:20px;max-width:1200px;margin:0 auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                    <h2 style="margin:0;font-size:1.5rem;">🔧 Soumissions Mec-inov</h2>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-sm btn-outline" onclick="MecinovSync._autoLinkAll()">🔗 Auto-lier aux deals</button>
                    </div>
                </div>

                <!-- Stats -->
                <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">
                    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 20px;text-align:center;flex:1;min-width:140px;">
                        <div style="font-size:24px;font-weight:800;color:#0369a1;">${stats.count}</div>
                        <div style="font-size:12px;color:#64748b;">Soumissions</div>
                    </div>
                    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 20px;text-align:center;flex:1;min-width:140px;">
                        <div style="font-size:24px;font-weight:800;color:#059669;">${stats.totalValue.toLocaleString('fr-CA', {style:'currency', currency:'CAD', maximumFractionDigits:0})}</div>
                        <div style="font-size:12px;color:#64748b;">Valeur totale</div>
                    </div>
                    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 20px;text-align:center;flex:1;min-width:140px;">
                        <div style="font-size:24px;font-weight:800;color:#a16207;">${stats.avgValue.toLocaleString('fr-CA', {style:'currency', currency:'CAD', maximumFractionDigits:0})}</div>
                        <div style="font-size:12px;color:#64748b;">Moyenne / soum.</div>
                    </div>
                    <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px 20px;text-align:center;flex:1;min-width:140px;">
                        <div style="font-size:24px;font-weight:800;color:#1d4ed8;">${stats.linkedCount}</div>
                        <div style="font-size:12px;color:#64748b;">Liées à un deal</div>
                    </div>
                </div>

                <!-- Search -->
                <div style="margin-bottom:16px;">
                    <input type="text" id="mecinov-search" class="input-sm" placeholder="🔍 Rechercher par client, numéro, montant..."
                        oninput="MecinovSync._filterQuotes(this.value)"
                        style="width:100%;max-width:500px;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
                </div>

                <!-- Table -->
                <div id="mecinov-quotes-table" style="background:white;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                    ${_renderTable(quotes)}
                </div>
            </div>
        `;
    }

    function _renderTable(quotes) {
        const links = JSON.parse(localStorage.getItem('crm_mecinov_links') || '{}');
        const linkedNums = new Set();
        Object.values(links).forEach(nums => nums.forEach(n => linkedNums.add(n)));
        const pdfs = JSON.parse(localStorage.getItem('crm_mecinov_pdfs') || '{}');

        return `
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                        <th style="text-align:left;padding:10px 14px;font-weight:600;">Soumission</th>
                        <th style="text-align:left;padding:10px 14px;font-weight:600;">Date</th>
                        <th style="text-align:left;padding:10px 14px;font-weight:600;">Client</th>
                        <th style="text-align:right;padding:10px 14px;font-weight:600;">Montant</th>
                        <th style="text-align:center;padding:10px 14px;font-weight:600;">Produits</th>
                        <th style="text-align:center;padding:10px 14px;font-weight:600;">Statut</th>
                        <th style="text-align:center;padding:10px 14px;font-weight:600;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${quotes.slice(0, 100).map(q => {
                        const isLinked = linkedNums.has(q.quoteNumber);
                        const hasPdf = !!pdfs[q.quoteNumber];
                        const linkedDealId = isLinked ? getLinkedDealId(q.quoteNumber) : null;
                        return `
                            <tr style="border-bottom:1px solid #f3f4f6;${isLinked ? 'background:#f0f9ff;' : ''}"
                                onmouseover="this.style.background='#f5f7fa'" onmouseout="this.style.background='${isLinked ? '#f0f9ff' : ''}'">
                                <td style="padding:8px 14px;font-weight:600;font-family:monospace;cursor:pointer;color:#2563eb;"
                                    onclick="MecinovSync.showQuoteDetail('${q.quoteNumber}')">
                                    ${q.quoteNumber}
                                </td>
                                <td style="padding:8px 14px;font-size:12px;">${q.date || ''}</td>
                                <td style="padding:8px 14px;">
                                    <div style="font-weight:500;">${q.clientName || '—'}</div>
                                    ${q.clientEmail ? `<div style="font-size:11px;color:#6b7280;">${q.clientEmail}</div>` : ''}
                                </td>
                                <td style="padding:8px 14px;text-align:right;font-weight:700;color:#059669;">
                                    ${q.total ? q.total.toLocaleString('fr-CA', {style:'currency', currency:'CAD'}) : '—'}
                                </td>
                                <td style="padding:8px 14px;text-align:center;color:#6b7280;">${q.productCount || 0}</td>
                                <td style="padding:8px 14px;text-align:center;">
                                    ${isLinked
                                        ? `<span style="font-size:11px;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;cursor:pointer;" onclick="App.openDeal('${linkedDealId}')">✅ Deal lié</span>`
                                        : '<span style="font-size:11px;color:#d1d5db;">Non lié</span>'}
                                    ${hasPdf ? ' <span style="font-size:10px;">📄</span>' : ''}
                                </td>
                                <td style="padding:8px 14px;text-align:center;">
                                    <div style="display:flex;gap:4px;justify-content:center;">
                                        <button class="btn btn-sm btn-outline" style="font-size:11px;padding:3px 8px;" onclick="MecinovSync.showQuoteDetail('${q.quoteNumber}')" title="Voir détails">👁️</button>
                                        ${!isLinked ? `<button class="btn btn-sm btn-primary" style="font-size:11px;padding:3px 8px;" onclick="MecinovSync.createDealFromQuote('${q.quoteNumber}').then(()=>MecinovSync.render())" title="Créer un deal">🚀</button>` : ''}
                                        <button class="btn btn-sm btn-outline" style="font-size:11px;padding:3px 8px;" onclick="MecinovSync.uploadPDF('${q.quoteNumber}')" title="Uploader PDF">📤</button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            ${quotes.length > 100 ? `<div style="text-align:center;padding:12px;color:#6b7280;font-size:12px;">Affichage limité aux 100 premières soumissions. Utilisez la recherche pour trouver d'autres soumissions.</div>` : ''}
        `;
    }

    function _filterQuotes(query) {
        const tableEl = document.getElementById('mecinov-quotes-table');
        if (!tableEl) return;

        let filtered = quotesData || [];
        if (query && query.length >= 2) {
            const q = query.toLowerCase();
            filtered = filtered.filter(qt =>
                (qt.quoteNumber && qt.quoteNumber.toLowerCase().includes(q)) ||
                (qt.clientName && qt.clientName.toLowerCase().includes(q)) ||
                (qt.clientCompany && qt.clientCompany.toLowerCase().includes(q)) ||
                (qt.clientEmail && qt.clientEmail.toLowerCase().includes(q)) ||
                (qt.total && qt.total.toString().includes(q))
            );
        }
        tableEl.innerHTML = _renderTable(filtered);
    }

    // Auto-link quotes to deals by matching client names
    function _autoLinkAll() {
        if (typeof Deals === 'undefined' || !quotesData) return;
        const deals = Deals.getAll();
        let linked = 0;

        deals.forEach(deal => {
            const matches = findForDeal(deal);
            if (matches.length > 0) {
                matches.forEach(q => {
                    if (!getLinkedDealId(q.quoteNumber)) {
                        linkToDeal(q.quoteNumber, deal.id);
                        linked++;
                    }
                });
            }
        });

        if (typeof App !== 'undefined') {
            App.showToast(linked > 0 ? `${linked} soumission${linked > 1 ? 's' : ''} liée${linked > 1 ? 's' : ''} automatiquement` : 'Aucune nouvelle correspondance trouvée', linked > 0 ? 'success' : 'info');
        }
        render();
    }

    // Create deal from quote
    async function createDealFromQuote(quoteNumber) {
        const q = getByQuoteNumber(quoteNumber);
        if (!q || typeof Deals === 'undefined') return;

        const titleCase = (s) => s ? s.toLowerCase().replace(/(?:^|\s|[-'])\S/g, c => c.toUpperCase()) : '';
        const dealData = {
            clientName: titleCase(q.clientName || q.clientCompany || 'Client Mec-inov'),
            clientEmail: q.clientEmail || '',
            clientPhone: q.clientPhone || '',
            clientAddress: q.clientAddress || '',
            quoteAmount: q.subtotal || q.total || 0,
            contractAmount: q.total || 0,
            stage: 5,
            leadSource: 'mecinov',
            mecinovQuoteNum: q.quoteNumber,
            projectType: q.type && q.type.includes('neuve') ? 'neuf' : 'renovation',
            leadDate: q.date || new Date().toISOString().split('T')[0],
            quoteSentDate: q.date || '',
            description: `Soumission Mec-inov ${q.quoteNumber}\n${q.productCount || 0} produits\n${(q.options || []).slice(0, 5).join(', ')}`,
        };

        const saved = await Deals.create(dealData);
        if (saved && saved.id) {
            linkToDeal(quoteNumber, saved.id);
            if (typeof App !== 'undefined') {
                App.showToast('Deal créé: ' + dealData.clientName, 'success');
            }
        }
        return saved;
    }

    return {
        loadQuotes,
        getAll,
        getByQuoteNumber,
        getByClientName,
        getByClientId,
        findForDeal,
        linkToDeal,
        unlinkFromDeal,
        getLinkedQuotes,
        getLinkedDealId,
        getStats,
        savePDF,
        getPDF,
        hasPDF,
        downloadPDF,
        uploadPDF,
        showQuoteDetail,
        renderForDeal,
        render,
        createDealFromQuote,
        _filterQuotes,
        _showLinkDealPicker,
        _filterDealPicker,
        _autoLinkAll,
    };
})();
