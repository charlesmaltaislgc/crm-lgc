// ===== CRM LGC - Reports Module =====
// Pipeline stats, conversion rates, vendor performance

const Reports = (() => {

    function render(period = 'month') {
        const container = document.getElementById('reports-grid');
        if (!container) return;

        const stats = Deals.getStats();
        const stageStats = Deals.getStageStats();
        const allDeals = Deals.getAll();

        // Filter by period
        const now = new Date();
        let periodStart;
        switch (period) {
            case 'month':
                periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                break;
            case 'quarter':
                const q = Math.floor(now.getMonth() / 3) * 3;
                periodStart = new Date(now.getFullYear(), q, 1).toISOString().split('T')[0];
                break;
            case 'year':
                periodStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
                break;
            default:
                periodStart = '2000-01-01';
        }

        const periodDeals = allDeals.filter(d => d.leadDate >= periodStart);
        const periodWon = periodDeals.filter(d => d.status === 'won');
        const periodLost = periodDeals.filter(d => d.status === 'lost');
        const periodClosed = periodWon.length + periodLost.length;
        const periodConversion = periodClosed > 0 ? Math.round((periodWon.length / periodClosed) * 100) : 0;
        const periodRevenue = periodWon.reduce((sum, d) => sum + (d.contractAmount || d.quoteAmount || 0), 0);

        // Pipeline by stage
        const maxStageValue = Math.max(...stageStats.map(s => s.value), 1);

        // Vendor performance
        const team = Auth.getTeamMembers().filter(m => ['vendeur', 'directeur', 'directeur_usine'].includes(m.role));
        const vendorStats = team.map(member => {
            const memberDeals = periodDeals.filter(d => d.assignedTo === member.id);
            const memberWon = memberDeals.filter(d => d.status === 'won');
            const memberLost = memberDeals.filter(d => d.status === 'lost');
            const memberClosed = memberWon.length + memberLost.length;
            const revenue = memberWon.reduce((sum, d) => sum + (d.contractAmount || d.quoteAmount || 0), 0);
            const active = memberDeals.filter(d => d.status === 'active');
            const delays = active
                .map(d => Deals.getLeadToQuoteDelay(d))
                .filter(d => d !== null && d >= 0);
            const avgDelay = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;

            return {
                name: member.name,
                initials: member.initials,
                activeDeals: active.length,
                wonDeals: memberWon.length,
                lostDeals: memberLost.length,
                conversion: memberClosed > 0 ? Math.round((memberWon.length / memberClosed) * 100) : 0,
                revenue,
                pipeline: active.reduce((sum, d) => sum + (d.quoteAmount || 0), 0),
                avgDelay,
            };
        });

        const maxVendorRevenue = Math.max(...vendorStats.map(v => v.revenue), 1);

        // Lead sources
        const sourceCount = {};
        periodDeals.forEach(d => {
            const src = d.leadSource || 'inconnu';
            sourceCount[src] = (sourceCount[src] || 0) + 1;
        });
        const maxSourceCount = Math.max(...Object.values(sourceCount), 1);

        // Delay distribution
        const delayBuckets = { '0-7j': 0, '8-14j': 0, '15-21j': 0, '22-30j': 0, '30j+': 0 };
        periodDeals.forEach(d => {
            const delay = Deals.getLeadToQuoteDelay(d);
            if (delay === null) return;
            if (delay <= 7) delayBuckets['0-7j']++;
            else if (delay <= 14) delayBuckets['8-14j']++;
            else if (delay <= 21) delayBuckets['15-21j']++;
            else if (delay <= 30) delayBuckets['22-30j']++;
            else delayBuckets['30j+']++;
        });
        const maxBucket = Math.max(...Object.values(delayBuckets), 1);

        container.innerHTML = `
            <!-- Summary -->
            <div class="report-card" style="grid-column: 1 / -1">
                <h4>Résumé de la période</h4>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px">
                    <div style="text-align:center">
                        <div style="font-size:28px;font-weight:800">${periodDeals.length}</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Leads totaux</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:28px;font-weight:800;color:var(--success)">${periodWon.length}</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Gagnés</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:28px;font-weight:800;color:var(--danger)">${periodLost.length}</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Perdus</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:28px;font-weight:800;color:var(--primary)">${periodConversion}%</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Conversion</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:28px;font-weight:800;color:var(--success)">${Deals.formatMoney(periodRevenue)}</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Revenus</div>
                    </div>
                    <div style="text-align:center">
                        <div style="font-size:28px;font-weight:800">${stats.avgDelay}j</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Délai moy. L→S</div>
                    </div>
                </div>
            </div>

            <!-- Pipeline by stage -->
            <div class="report-card">
                <h4>Pipeline par étape ($ actif)</h4>
                ${stageStats.filter(s => s.count > 0).map(stage => `
                    <div class="report-bar">
                        <span class="report-bar-label">${stage.name}</span>
                        <div class="report-bar-fill" style="width:${(stage.value / maxStageValue) * 100}%;background:${stage.color}"></div>
                        <span class="report-bar-value">${stage.count} deals - ${Deals.formatMoney(stage.value)}</span>
                    </div>
                `).join('')}
            </div>

            <!-- Vendor performance -->
            <div class="report-card">
                <h4>Performance par vendeur</h4>
                ${vendorStats.map(v => `
                    <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                            <strong>${v.name}</strong>
                            <span style="color:var(--success);font-weight:700">${Deals.formatMoney(v.revenue)}</span>
                        </div>
                        <div style="display:flex;gap:16px;font-size:12px;color:var(--text-secondary)">
                            <span>Actifs: <strong>${v.activeDeals}</strong></span>
                            <span>Gagnés: <strong style="color:var(--success)">${v.wonDeals}</strong></span>
                            <span>Perdus: <strong style="color:var(--danger)">${v.lostDeals}</strong></span>
                            <span>Conv: <strong>${v.conversion}%</strong></span>
                            <span>Délai: <strong>${v.avgDelay}j</strong></span>
                        </div>
                        <div class="report-bar" style="margin-top:6px;margin-bottom:0">
                            <div class="report-bar-fill" style="width:${(v.revenue / maxVendorRevenue) * 100}%;height:16px;background:var(--primary)"></div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <!-- Source leads -->
            <div class="report-card">
                <h4>Sources des leads</h4>
                ${Object.entries(sourceCount).sort((a,b) => b[1] - a[1]).map(([source, count]) => {
                    const labels = {telephone:'Téléphone', courriel:'Courriel', 'en-personne':'En personne', reference:'Référence', web:'Web', shopify:'Shopify'};
                    return `
                        <div class="report-bar">
                            <span class="report-bar-label">${labels[source] || source}</span>
                            <div class="report-bar-fill" style="width:${(count / maxSourceCount) * 100}%;background:var(--info)"></div>
                            <span class="report-bar-value">${count} leads</span>
                        </div>
                    `;
                }).join('')}
            </div>

            <!-- Delay distribution -->
            <div class="report-card">
                <h4>Distribution délai Lead → Soumission</h4>
                ${Object.entries(delayBuckets).map(([bucket, count]) => `
                    <div class="report-bar">
                        <span class="report-bar-label">${bucket}</span>
                        <div class="report-bar-fill" style="width:${(count / maxBucket) * 100}%;background:${bucket === '30j+' ? 'var(--danger)' : bucket.startsWith('22') ? 'var(--warning)' : 'var(--success)'}"></div>
                        <span class="report-bar-value">${count} deals</span>
                    </div>
                `).join('')}
            </div>

            <!-- Shopify revenue -->
            <div class="report-card">
                <h4>Revenus Shopify (4 dernières semaines)</h4>
                ${(() => {
                    const weeks = Shopify.getWeeklyTotals();
                    const maxWeek = Math.max(...weeks.map(w => w.total), 1);
                    return weeks.map(w => `
                        <div class="report-bar">
                            <span class="report-bar-label">${w.label}</span>
                            <div class="report-bar-fill" style="width:${(w.total / maxWeek) * 100}%;background:var(--success)"></div>
                            <span class="report-bar-value">${Deals.formatMoney(w.total)} (${w.count})</span>
                        </div>
                    `).join('');
                })()}
            </div>
        `;
    }

    return { render };
})();
