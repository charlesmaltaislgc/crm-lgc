// ===== CRM LGC - Payments Module =====
// Track deposits, payments, client type rules

const Payments = (() => {

    function getPaymentSummary() {
        const active = Deals.getActive();

        // Total deposits due (regulier clients only)
        const depositsNeeded = active
            .filter(d => d.clientType === 'regulier' && d.depositReceived === 'non' && d.stage >= 9)
            .reduce((sum, d) => sum + (d.depositRequired || 0), 0);

        // Overdue payments (entrepreneur > 30 days, regulier not paid)
        const today = new Date();
        let overdueAmount = 0;
        active.forEach(d => {
            if (d.clientType === 'entrepreneur' && d.paymentStatus !== 'paid') {
                const refDate = d.installDate || d.completedDate;
                if (refDate) {
                    const days = Deals.getDaysSince(refDate);
                    const net30 = parseInt(localStorage.getItem('crm_net30Delay') || '30');
                    if (days > net30) {
                        overdueAmount += (d.contractAmount || d.quoteAmount || 0);
                    }
                }
            }
            if (d.clientType === 'regulier' && d.depositReceived === 'non' && d.stage >= 10) {
                overdueAmount += (d.depositRequired || 0);
            }
        });

        return { depositsNeeded, overdueAmount };
    }

    function getDealsNeedingDeposit() {
        return Deals.getActive().filter(d =>
            d.clientType === 'regulier' &&
            d.depositReceived === 'non' &&
            d.stage >= 8
        );
    }

    function getOverduePayments() {
        const result = [];
        const net30 = parseInt(localStorage.getItem('crm_net30Delay') || '30');

        Deals.getActive().forEach(d => {
            // Regulier: deposit not received but order placed
            if (d.clientType === 'regulier' && d.depositReceived === 'non' && d.stage >= 10) {
                result.push({
                    deal: d,
                    type: 'deposit',
                    reason: 'Acompte non reçu - commande en cours!',
                    amount: d.depositRequired || 0,
                    severity: 'urgent',
                });
            }

            // Entrepreneur: past net 30
            if (d.clientType === 'entrepreneur' && d.paymentStatus !== 'paid') {
                const refDate = d.installDate || d.completedDate;
                if (refDate) {
                    const days = Deals.getDaysSince(refDate);
                    if (days > net30) {
                        result.push({
                            deal: d,
                            type: 'net30',
                            reason: `Net 30 dépassé de ${days - net30} jours`,
                            amount: d.contractAmount || d.quoteAmount || 0,
                            days: days,
                            severity: days > net30 + 15 ? 'urgent' : 'warning',
                        });
                    }
                }
            }
        });

        return result.sort((a, b) => {
            if (a.severity === 'urgent' && b.severity !== 'urgent') return -1;
            if (a.severity !== 'urgent' && b.severity === 'urgent') return 1;
            return (b.amount || 0) - (a.amount || 0);
        });
    }

    function render(tab = 'acomptes') {
        const container = document.getElementById('payments-list');
        if (!container) return;

        // Update summary
        const summary = getPaymentSummary();
        const totalDueEl = document.getElementById('pay-total-due');
        const overdueEl = document.getElementById('pay-overdue');
        if (totalDueEl) totalDueEl.textContent = Deals.formatMoney(summary.depositsNeeded);
        if (overdueEl) {
            overdueEl.textContent = Deals.formatMoney(summary.overdueAmount);
            overdueEl.style.color = summary.overdueAmount > 0 ? 'var(--danger)' : 'var(--success)';
        }

        let items = [];

        if (tab === 'acomptes') {
            items = getDealsNeedingDeposit();
            container.innerHTML = items.length === 0
                ? '<div style="text-align:center;padding:40px;color:var(--text-muted)">Tous les acomptes sont reçus</div>'
                : items.map(deal => renderPaymentItem(deal, 'deposit')).join('');
        } else if (tab === 'overdue') {
            const overdue = getOverduePayments();
            container.innerHTML = overdue.length === 0
                ? '<div style="text-align:center;padding:40px;color:var(--text-muted)">Aucun paiement en retard</div>'
                : overdue.map(item => `
                    <div class="task-item ${item.severity === 'urgent' ? 'overdue' : ''}" style="cursor:pointer"
                         onclick="App.openDeal('${item.deal.id}')">
                        <div style="width:32px;height:32px;border-radius:50%;background:${item.severity === 'urgent' ? 'var(--danger-light)' : 'var(--warning-light)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            ${item.severity === 'urgent' ? '🚨' : '⚠️'}
                        </div>
                        <div class="task-info">
                            <div class="task-description">${item.deal.clientName}</div>
                            <div class="task-meta">
                                ${item.reason} |
                                <span class="card-type-badge ${item.deal.clientType}">${item.deal.clientType === 'entrepreneur' ? 'ENTR' : 'RÉG'}</span>
                            </div>
                        </div>
                        <div style="font-weight:800;color:var(--danger)">${Deals.formatMoney(item.amount)}</div>
                    </div>
                `).join('');
        } else if (tab === 'shopify') {
            Shopify.renderInPayments(container);
        } else {
            // All payments
            const allDeals = Deals.getActive().filter(d => d.stage >= 8);
            container.innerHTML = allDeals.length === 0
                ? '<div style="text-align:center;padding:40px;color:var(--text-muted)">Aucun deal au stade paiement</div>'
                : allDeals.map(deal => renderPaymentItem(deal, 'full')).join('');
        }

        // Update badge
        const badge = document.getElementById('badge-payments');
        const overdueList = getOverduePayments();
        if (badge) {
            if (overdueList.length > 0) {
                badge.textContent = overdueList.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    function renderPaymentItem(deal, mode) {
        const statusColors = {
            pending: 'var(--warning)',
            partial: 'var(--info)',
            paid: 'var(--success)',
            overdue: 'var(--danger)',
        };
        const statusLabels = {
            pending: 'En attente',
            partial: 'Partiel',
            paid: 'Payé',
            overdue: 'En retard',
        };

        return `
            <div class="task-item" style="cursor:pointer" onclick="App.openDeal('${deal.id}')">
                <div style="width:8px;height:40px;border-radius:4px;background:${statusColors[deal.paymentStatus] || 'var(--border)'};flex-shrink:0"></div>
                <div class="task-info">
                    <div class="task-description">
                        ${deal.clientName}
                        <span class="card-type-badge ${deal.clientType}" style="margin-left:8px">
                            ${deal.clientType === 'entrepreneur' ? 'ENTR - Net 30' : 'RÉG - Acompte requis'}
                        </span>
                    </div>
                    <div class="task-meta">
                        Soumission: ${Deals.formatMoney(deal.quoteAmount)}
                        ${deal.contractAmount ? ` | Contrat: ${Deals.formatMoney(deal.contractAmount)}` : ''}
                        | Acompte: ${deal.depositReceived === 'oui' ? '✅ Reçu' : deal.depositReceived === 'na' ? 'N/A' : '❌ Non reçu'}
                        ${deal.depositRequired ? ` (${Deals.formatMoney(deal.depositRequired)})` : ''}
                    </div>
                </div>
                <div style="text-align:right">
                    <div style="font-weight:700;color:${statusColors[deal.paymentStatus]}">${statusLabels[deal.paymentStatus] || 'N/A'}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${Deals.getStageName(deal.stage)}</div>
                </div>
            </div>
        `;
    }

    return {
        getPaymentSummary,
        getDealsNeedingDeposit,
        getOverduePayments,
        render,
    };
})();
