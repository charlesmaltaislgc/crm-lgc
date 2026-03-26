// ===== CRM LGC - Shopify Integration Module =====
// Pull payments from Shopify, track counter sales

const Shopify = (() => {
    const STORAGE_KEY = 'crm_shopify_orders';
    let orders = [];

    async function loadOrders() {
        if (Auth.isDemoMode()) {
            const saved = localStorage.getItem(STORAGE_KEY);
            orders = saved ? JSON.parse(saved) : generateDemoOrders();
            if (!saved) saveLocal();
        } else {
            await fetchFromShopify();
        }
        return orders;
    }

    function saveLocal() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    }

    async function fetchFromShopify() {
        const storeUrl = localStorage.getItem('crm_shopifyStore');
        const token = localStorage.getItem('crm_shopifyToken');

        if (!storeUrl || !token) {
            console.warn('Shopify not configured');
            return;
        }

        // Note: Shopify Admin API requires server-side proxy for CORS
        // In production, this would call a proxy endpoint
        // For now, this shows the intended integration pattern
        try {
            const response = await fetch(`https://${storeUrl}/admin/api/2024-01/orders.json?status=any&limit=50`, {
                headers: {
                    'X-Shopify-Access-Token': token,
                    'Content-Type': 'application/json',
                }
            });

            if (response.ok) {
                const data = await response.json();
                orders = data.orders.map(order => ({
                    id: order.id.toString(),
                    orderNumber: `#${order.order_number}`,
                    customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Client comptoir',
                    customerEmail: order.customer?.email || '',
                    amount: parseFloat(order.total_price),
                    currency: order.currency,
                    status: order.financial_status,
                    date: order.created_at,
                    items: order.line_items.map(li => li.title).join(', '),
                    isCounterSale: !order.customer?.email,
                    linkedDealId: null,
                }));
            }
        } catch (e) {
            console.warn('Shopify fetch failed (CORS expected in browser):', e.message);
        }
    }

    async function testConnection() {
        const storeUrl = localStorage.getItem('crm_shopifyStore');
        const token = localStorage.getItem('crm_shopifyToken');

        if (!storeUrl || !token) {
            App.showToast('Entrez l\'URL du store et le token API', 'error');
            return false;
        }

        try {
            const response = await fetch(`https://${storeUrl}/admin/api/2024-01/shop.json`, {
                headers: { 'X-Shopify-Access-Token': token }
            });
            if (response.ok) {
                App.showToast('Connexion Shopify réussie!', 'success');
                return true;
            }
            App.showToast('Connexion échouée - vérifiez les identifiants', 'error');
            return false;
        } catch (e) {
            App.showToast('Erreur de connexion (CORS) - un proxy serveur sera nécessaire', 'warning');
            return false;
        }
    }

    function linkToDeal(orderId, dealId) {
        const idx = orders.findIndex(o => o.id === orderId);
        if (idx !== -1) {
            orders[idx].linkedDealId = dealId;
            if (Auth.isDemoMode()) saveLocal();
            App.showToast('Paiement Shopify lié au deal', 'success');
        }
    }

    function getOrdersForDeal(dealId) {
        return orders.filter(o => o.linkedDealId === dealId);
    }

    function getMonthlyTotal() {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        return orders
            .filter(o => o.date >= monthStart && o.status === 'paid')
            .reduce((sum, o) => sum + (o.amount || 0), 0);
    }

    function getWeeklyTotals() {
        const weeks = [];
        const now = new Date();
        for (let i = 3; i >= 0; i--) {
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - (i * 7 + now.getDay()));
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);

            const startStr = weekStart.toISOString().split('T')[0];
            const endStr = weekEnd.toISOString().split('T')[0];

            const weekOrders = orders.filter(o =>
                o.date.split('T')[0] >= startStr && o.date.split('T')[0] <= endStr
            );
            const total = weekOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
            weeks.push({
                label: `${weekStart.getDate()}/${weekStart.getMonth() + 1} - ${weekEnd.getDate()}/${weekEnd.getMonth() + 1}`,
                total,
                count: weekOrders.length,
            });
        }
        return weeks;
    }

    function renderInPayments(container) {
        // Update shopify stat
        const shopifyStat = document.getElementById('pay-shopify');
        if (shopifyStat) shopifyStat.textContent = Deals.formatMoney(getMonthlyTotal());

        if (orders.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;padding:40px;color:var(--text-muted)">
                    <p>Aucune commande Shopify chargée.</p>
                    <p style="font-size:12px;margin-top:8px">Configurez Shopify dans Paramètres pour voir les paiements.</p>
                </div>
            `;
            return;
        }

        // Weekly summary
        const weeks = getWeeklyTotals();
        let html = `
            <div style="display:flex;gap:12px;margin-bottom:20px">
                ${weeks.map(w => `
                    <div style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center">
                        <div style="font-size:18px;font-weight:800">${Deals.formatMoney(w.total)}</div>
                        <div style="font-size:11px;color:var(--text-secondary)">${w.label}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${w.count} commandes</div>
                    </div>
                `).join('')}
            </div>
        `;

        // Recent orders
        html += orders.slice(0, 20).map(order => {
            const linkedDeal = order.linkedDealId ? Deals.getById(order.linkedDealId) : null;
            return `
                <div class="task-item">
                    <div style="width:32px;height:32px;border-radius:50%;background:${order.isCounterSale ? 'var(--warning-light)' : 'var(--success-light)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px">
                        ${order.isCounterSale ? '🏪' : '🛒'}
                    </div>
                    <div class="task-info">
                        <div class="task-description">
                            ${order.orderNumber} - ${order.customerName}
                            ${order.isCounterSale ? '<span style="font-size:10px;color:var(--warning);font-weight:700;margin-left:4px">COMPTOIR</span>' : ''}
                        </div>
                        <div class="task-meta">
                            ${order.items.substring(0, 60)}${order.items.length > 60 ? '...' : ''}
                            | ${Deals.formatDate(order.date)}
                            ${linkedDeal ? ` | Lié à: ${linkedDeal.clientName}` : ''}
                        </div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-weight:800;color:var(--success)">${Deals.formatMoney(order.amount)}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${order.status === 'paid' ? 'Payé' : order.status}</div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    }

    function generateDemoOrders() {
        const now = new Date();
        return [
            { id: 'SH1', orderNumber: '#1234', customerName: 'Martin Roy', customerEmail: 'martin@email.com', amount: 1250, currency: 'CAD', status: 'paid', date: new Date(now - 86400000 * 1).toISOString(), items: 'Poignée porte patio, Joint étanchéité x3', isCounterSale: false, linkedDealId: null },
            { id: 'SH2', orderNumber: '#1235', customerName: 'Client comptoir', customerEmail: '', amount: 85, currency: 'CAD', status: 'paid', date: new Date(now - 86400000 * 1).toISOString(), items: 'Moustiquaire remplacement 36x48', isCounterSale: true, linkedDealId: null },
            { id: 'SH3', orderNumber: '#1236', customerName: 'Sophie Lavoie', customerEmail: 'sophie@email.com', amount: 4500, currency: 'CAD', status: 'paid', date: new Date(now - 86400000 * 2).toISOString(), items: 'Acompte - Projet fenêtres (8 unités)', isCounterSale: false, linkedDealId: 'D1001' },
            { id: 'SH4', orderNumber: '#1237', customerName: 'Client comptoir', customerEmail: '', amount: 45, currency: 'CAD', status: 'paid', date: new Date(now - 86400000 * 3).toISOString(), items: 'Quincaillerie porte entrée', isCounterSale: true, linkedDealId: null },
            { id: 'SH5', orderNumber: '#1238', customerName: 'André Bouchard', customerEmail: 'andre@email.com', amount: 8900, currency: 'CAD', status: 'paid', date: new Date(now - 86400000 * 4).toISOString(), items: 'Acompte 50% - Porte entrée + 4 fenêtres', isCounterSale: false, linkedDealId: 'D1003' },
            { id: 'SH6', orderNumber: '#1239', customerName: 'Client comptoir', customerEmail: '', amount: 120, currency: 'CAD', status: 'paid', date: new Date(now - 86400000 * 5).toISOString(), items: 'Vitre thermos remplacement', isCounterSale: true, linkedDealId: null },
            { id: 'SH7', orderNumber: '#1240', customerName: 'Luc Fortin', customerEmail: 'luc@email.com', amount: 3200, currency: 'CAD', status: 'paid', date: new Date(now - 86400000 * 7).toISOString(), items: 'Paiement final - 2 portes patio', isCounterSale: false, linkedDealId: null },
            { id: 'SH8', orderNumber: '#1241', customerName: 'Client comptoir', customerEmail: '', amount: 65, currency: 'CAD', status: 'paid', date: new Date(now - 86400000 * 8).toISOString(), items: 'Pièces diverses', isCounterSale: true, linkedDealId: null },
        ];
    }

    return {
        loadOrders,
        testConnection,
        linkToDeal,
        getOrdersForDeal,
        getMonthlyTotal,
        getWeeklyTotals,
        renderInPayments,
    };
})();
