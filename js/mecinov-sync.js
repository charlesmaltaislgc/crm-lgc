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
            // Match if all name parts appear in client name/company
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

    // Stats
    function getStats() {
        const quotes = quotesData || [];
        const total = quotes.reduce((s, q) => s + (q.total || 0), 0);
        const thisMonth = quotes.filter(q => q.date && q.date.startsWith(new Date().toISOString().slice(0, 7)));
        const thisMonthTotal = thisMonth.reduce((s, q) => s + (q.total || 0), 0);
        return {
            count: quotes.length,
            totalValue: total,
            thisMonthCount: thisMonth.length,
            thisMonthValue: thisMonthTotal,
            avgValue: quotes.length > 0 ? total / quotes.length : 0,
        };
    }

    // Render Mec-inov quotes panel for deal detail
    function renderForDeal(dealId, containerEl) {
        if (!containerEl) return;

        const deal = typeof Deals !== 'undefined' ? Deals.getById(dealId) : null;
        const linked = getLinkedQuotes(dealId);
        const suggested = deal ? findForDeal(deal) : [];

        // Remove already linked from suggestions
        const linkedNums = new Set(linked.map(q => q.quoteNumber));
        const unlinked = suggested.filter(q => !linkedNums.has(q.quoteNumber));

        containerEl.innerHTML = `
            <div style="margin-top:12px;">
                <h4 style="margin:0 0 8px;font-size:14px;display:flex;align-items:center;gap:6px;">
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
        const optionsPreview = (q.options || []).filter(o => o && !o.startsWith('Energy star')).slice(0, 3).join(' | ');
        return `
            <div style="background:${isLinked ? '#f0f9ff' : '#fff'};border:1px solid ${isLinked ? '#93c5fd' : '#e5e7eb'};border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:13px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div style="flex:1;">
                        <div style="font-weight:700;color:#1e3a5f;">
                            📋 ${q.quoteNumber}
                            <span style="font-weight:400;color:#6b7280;font-size:12px;margin-left:6px;">${q.date || ''}</span>
                            ${q.type ? `<span style="font-size:10px;background:#e0e7ff;color:#4338ca;padding:1px 6px;border-radius:4px;margin-left:4px;">${q.type}</span>` : ''}
                        </div>
                        <div style="color:#374151;margin-top:2px;">
                            ${q.clientName || 'Client inconnu'}
                            ${q.clientCompany && q.clientCompany !== q.clientName ? ` <span style="color:#9ca3af;">— ${q.clientCompany}</span>` : ''}
                        </div>
                        <div style="font-size:20px;font-weight:800;color:#059669;margin-top:4px;">
                            ${q.total ? q.total.toLocaleString('fr-CA', {style: 'currency', currency: 'CAD'}) : '—'}
                        </div>
                        ${optionsPreview ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;line-height:1.4;">${optionsPreview}</div>` : ''}
                        ${q.productCount > 0 ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${q.productCount} produit${q.productCount > 1 ? 's' : ''}</div>` : ''}
                    </div>
                    <div style="flex-shrink:0;margin-left:8px;">
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
                    </div>
                </div>
            </div>
        `;
    }

    // Render full quotes browser page
    function render() {
        const container = document.getElementById('mecinov-quotes-content');
        if (!container) return;

        const quotes = quotesData || [];
        const stats = getStats();
        const links = JSON.parse(localStorage.getItem('crm_mecinov_links') || '{}');
        const linkedQuoteNums = new Set();
        Object.values(links).forEach(nums => nums.forEach(n => linkedQuoteNums.add(n)));

        container.innerHTML = `
            <div style="padding:20px;max-width:1200px;margin:0 auto;">
                <h2 style="margin:0 0 20px;font-size:1.5rem;">🔧 Soumissions Mec-inov</h2>

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
                        <div style="font-size:24px;font-weight:800;color:#1d4ed8;">${linkedQuoteNums.size}</div>
                        <div style="font-size:12px;color:#64748b;">Liées à un deal</div>
                    </div>
                </div>

                <!-- Search -->
                <div style="margin-bottom:16px;">
                    <input type="text" id="mecinov-search" class="input-sm" placeholder="Rechercher par client, numéro, montant..."
                        oninput="MecinovSync._filterQuotes(this.value)"
                        style="width:100%;max-width:400px;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;">
                </div>

                <!-- Table -->
                <div id="mecinov-quotes-table" style="background:white;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
                    ${_renderTable(quotes, linkedQuoteNums)}
                </div>
            </div>
        `;
    }

    function _renderTable(quotes, linkedNums) {
        return `
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                        <th style="text-align:left;padding:10px 14px;font-weight:600;">Soumission</th>
                        <th style="text-align:left;padding:10px 14px;font-weight:600;">Date</th>
                        <th style="text-align:left;padding:10px 14px;font-weight:600;">Client</th>
                        <th style="text-align:right;padding:10px 14px;font-weight:600;">Montant</th>
                        <th style="text-align:center;padding:10px 14px;font-weight:600;">Type</th>
                        <th style="text-align:center;padding:10px 14px;font-weight:600;">Produits</th>
                        <th style="text-align:center;padding:10px 14px;font-weight:600;">CRM</th>
                    </tr>
                </thead>
                <tbody>
                    ${quotes.slice(0, 100).map(q => {
                        const isLinked = linkedNums && linkedNums.has(q.quoteNumber);
                        return `
                            <tr style="border-bottom:1px solid #f3f4f6;cursor:pointer;${isLinked ? 'background:#f0f9ff;' : ''}"
                                onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='${isLinked ? '#f0f9ff' : ''}'">
                                <td style="padding:8px 14px;font-weight:600;font-family:monospace;">${q.quoteNumber}</td>
                                <td style="padding:8px 14px;">${q.date || ''}</td>
                                <td style="padding:8px 14px;">
                                    <div style="font-weight:500;">${q.clientName || '—'}</div>
                                    ${q.clientEmail ? `<div style="font-size:11px;color:#6b7280;">${q.clientEmail}</div>` : ''}
                                </td>
                                <td style="padding:8px 14px;text-align:right;font-weight:700;color:#059669;">
                                    ${q.total ? q.total.toLocaleString('fr-CA', {style:'currency', currency:'CAD'}) : '—'}
                                </td>
                                <td style="padding:8px 14px;text-align:center;">
                                    <span style="font-size:11px;background:${q.type && q.type.includes('neuve') ? '#dbeafe' : '#f3e8ff'};color:${q.type && q.type.includes('neuve') ? '#1d4ed8' : '#7c3aed'};padding:2px 8px;border-radius:4px;">
                                        ${q.type || '—'}
                                    </span>
                                </td>
                                <td style="padding:8px 14px;text-align:center;color:#6b7280;">${q.productCount || 0}</td>
                                <td style="padding:8px 14px;text-align:center;">
                                    ${isLinked ? '<span style="color:#059669;">✅</span>' : '<span style="color:#d1d5db;">—</span>'}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            ${quotes.length > 100 ? `<div style="text-align:center;padding:12px;color:#6b7280;font-size:12px;">Affichage limité aux 100 premières soumissions</div>` : ''}
        `;
    }

    function _filterQuotes(query) {
        const tableEl = document.getElementById('mecinov-quotes-table');
        if (!tableEl) return;
        const links = JSON.parse(localStorage.getItem('crm_mecinov_links') || '{}');
        const linkedNums = new Set();
        Object.values(links).forEach(nums => nums.forEach(n => linkedNums.add(n)));

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
        tableEl.innerHTML = _renderTable(filtered, linkedNums);
    }

    // Auto-suggest: create deals from unlinked quotes
    function createDealFromQuote(quoteNumber) {
        const q = getByQuoteNumber(quoteNumber);
        if (!q || typeof Deals === 'undefined') return;

        const titleCase = (s) => s.toLowerCase().replace(/(?:^|\s|[-'])\S/g, c => c.toUpperCase());
        const deal = {
            clientName: titleCase(q.clientName || q.clientCompany || 'Client Mec-inov'),
            clientEmail: q.clientEmail || '',
            clientPhone: q.clientPhone || '',
            quoteAmount: q.subtotal || q.total || 0,
            contractAmount: q.total || 0,
            stage: 'Soumission envoyée',
            source: 'mecinov',
            notes: `Soumission Mec-inov ${q.quoteNumber}\nType: ${q.type || ''}\nDate: ${q.date || ''}\nProduits: ${(q.options || []).join(', ')}`,
        };

        const saved = Deals.save(deal);
        if (saved && saved.id) {
            linkToDeal(quoteNumber, saved.id);
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
        renderForDeal,
        render,
        createDealFromQuote,
        _filterQuotes,
    };
})();
