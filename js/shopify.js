// ===== CRM LGC - Shopify Integration Module =====
// Pull payments from Shopify, track counter sales
// Supports: Cloudflare Worker proxy, SharePoint persistence, auto-sync

/*
 * ===== CLOUDFLARE WORKER PROXY =====
 * Deploy this code as a Cloudflare Worker to bypass CORS restrictions.
 * Then set localStorage item 'crm_shopifyProxy' to your worker URL
 * (e.g. https://shopify-proxy.your-domain.workers.dev)
 *
 * --- worker.js ---
 *
 * export default {
 *   async fetch(request, env) {
 *     const url = new URL(request.url);
 *
 *     // CORS preflight
 *     if (request.method === 'OPTIONS') {
 *       return new Response(null, {
 *         headers: {
 *           'Access-Control-Allow-Origin': '*',
 *           'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
 *           'Access-Control-Allow-Headers': 'Content-Type, X-Shopify-Store, X-Shopify-Token',
 *           'Access-Control-Max-Age': '86400',
 *         }
 *       });
 *     }
 *
 *     const store = request.headers.get('X-Shopify-Store');
 *     const token = request.headers.get('X-Shopify-Token');
 *
 *     if (!store || !token) {
 *       return new Response(JSON.stringify({ error: 'Missing store or token headers' }), {
 *         status: 400,
 *         headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
 *       });
 *     }
 *
 *     // Forward the request path to Shopify Admin API
 *     const shopifyPath = url.pathname === '/' ? '/admin/api/2024-01/orders.json?status=any&limit=50' : url.pathname + url.search;
 *     const shopifyUrl = `https://${store}${shopifyPath}`;
 *
 *     try {
 *       const shopifyResponse = await fetch(shopifyUrl, {
 *         method: request.method,
 *         headers: {
 *           'X-Shopify-Access-Token': token,
 *           'Content-Type': 'application/json',
 *         },
 *         body: request.method !== 'GET' ? await request.text() : undefined,
 *       });
 *
 *       const data = await shopifyResponse.text();
 *       return new Response(data, {
 *         status: shopifyResponse.status,
 *         headers: {
 *           'Content-Type': 'application/json',
 *           'Access-Control-Allow-Origin': '*',
 *         }
 *       });
 *     } catch (e) {
 *       return new Response(JSON.stringify({ error: e.message }), {
 *         status: 502,
 *         headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
 *       });
 *     }
 *   }
 * };
 *
 * --- end worker.js ---
 */

const Shopify = (() => {
    const STORAGE_KEY = 'crm_shopify_orders';
    const SP_LIST = 'CRM_ShopifyOrders';
    let orders = [];
    let syncInterval = null;

    // ===== LOAD / SAVE =====

    async function loadOrders() {
        if (Auth.useLocalStorage()) {
            // localStorage-only mode: load from cache or generate demo data
            const saved = localStorage.getItem(STORAGE_KEY);
            orders = saved ? JSON.parse(saved) : generateDemoOrders();
            if (!saved) saveLocal();
        } else {
            // SharePoint mode: load from SharePoint, fallback to localStorage
            try {
                const spItems = await Graph.getListItems(SP_LIST);
                orders = spItems.map(item => mapFromSharePoint(item));
                // Write-through to localStorage as cache
                saveLocal();
            } catch (e) {
                console.error('Erreur chargement SharePoint Shopify, fallback localStorage:', e);
                const saved = localStorage.getItem(STORAGE_KEY);
                orders = saved ? JSON.parse(saved) : generateDemoOrders();
                if (!saved) saveLocal();
            }
        }
        // Auto-link orders to deals after loading
        autoLinkOrders();
        return orders;
    }

    function saveLocal() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    }

    // ===== SHAREPOINT MAPPING =====

    function mapFromSharePoint(item) {
        return {
            id: item.OrderId || item.id,
            _spId: item.id,
            orderNumber: item.OrderNumber || '',
            customerName: item.CustomerName || '',
            customerEmail: item.CustomerEmail || '',
            amount: parseFloat(item.Amount) || 0,
            currency: item.Currency || 'CAD',
            status: item.Status || '',
            date: item.OrderDate || '',
            items: item.Items || '',
            isCounterSale: item.IsCounterSale === true || item.IsCounterSale === 'true',
            linkedDealId: item.LinkedDealId || null,
        };
    }

    function mapToSharePoint(order) {
        return {
            OrderId: order.id,
            OrderNumber: order.orderNumber || '',
            CustomerName: order.customerName || '',
            CustomerEmail: order.customerEmail || '',
            Amount: order.amount || 0,
            Currency: order.currency || 'CAD',
            Status: order.status || '',
            OrderDate: order.date || '',
            Items: (order.items || '').substring(0, 255),
            IsCounterSale: !!order.isCounterSale,
            LinkedDealId: order.linkedDealId || '',
        };
    }

    async function saveToSharePoint(order) {
        if (Auth.useLocalStorage()) return;
        try {
            if (order._spId) {
                await Graph.updateListItem(SP_LIST, order._spId, mapToSharePoint(order));
            } else {
                const created = await Graph.createListItem(SP_LIST, mapToSharePoint(order));
                if (created) order._spId = created.id;
            }
        } catch (e) {
            console.error('Erreur sauvegarde SharePoint Shopify:', e);
        }
    }

    // ===== SHOPIFY API (via proxy or direct) =====

    function getProxyUrl() {
        return localStorage.getItem('crm_shopifyProxy') || '';
    }

    async function fetchFromShopify() {
        const storeUrl = localStorage.getItem('crm_shopifyStore');
        const token = localStorage.getItem('crm_shopifyToken');

        if (!storeUrl || !token) {
            console.warn('Shopify non configuré');
            return;
        }

        const proxyUrl = getProxyUrl();

        try {
            let response;

            if (proxyUrl) {
                // Use Cloudflare Worker proxy
                response = await fetch(`${proxyUrl}/admin/api/2024-01/orders.json?status=any&limit=50`, {
                    headers: {
                        'X-Shopify-Store': storeUrl,
                        'X-Shopify-Token': token,
                        'Content-Type': 'application/json',
                    }
                });
            } else {
                // Direct call (will be CORS-blocked in browser, but works server-side)
                response = await fetch(`https://${storeUrl}/admin/api/2024-01/orders.json?status=any&limit=50`, {
                    headers: {
                        'X-Shopify-Access-Token': token,
                        'Content-Type': 'application/json',
                    }
                });
            }

            if (response.ok) {
                const data = await response.json();
                const fetchedOrders = data.orders.map(order => ({
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

                // Merge: preserve existing linkedDealId and _spId
                const existingMap = {};
                orders.forEach(o => { existingMap[o.id] = o; });

                for (const fetched of fetchedOrders) {
                    const existing = existingMap[fetched.id];
                    if (existing) {
                        fetched.linkedDealId = existing.linkedDealId;
                        fetched._spId = existing._spId;
                    }
                }

                orders = fetchedOrders;
                autoLinkOrders();

                // Persist
                saveLocal();
                if (!Auth.useLocalStorage()) {
                    for (const order of orders) {
                        await saveToSharePoint(order);
                    }
                }

                console.log(`Shopify sync: ${orders.length} commandes chargées`);
            }
        } catch (e) {
            console.warn('Shopify fetch échoué' + (proxyUrl ? '' : ' (CORS attendu en navigateur)') + ':', e.message);
        }
    }

    // ===== AUTO-SYNC =====

    function startAutoSync() {
        stopAutoSync();
        // Sync every 5 minutes when tab is active
        syncInterval = setInterval(() => {
            if (!document.hidden) {
                refreshOrders();
            }
        }, 5 * 60 * 1000);
    }

    function stopAutoSync() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    }

    async function refreshOrders() {
        const storeUrl = localStorage.getItem('crm_shopifyStore');
        const token = localStorage.getItem('crm_shopifyToken');
        if (storeUrl && token) {
            await fetchFromShopify();
            if (typeof App !== 'undefined' && App.showToast) {
                App.showToast('Commandes Shopify synchronisées', 'success');
            }
        }
        return orders;
    }

    // ===== AUTO-LINK ORDERS TO DEALS =====

    function autoLinkOrders() {
        if (typeof Deals === 'undefined' || !Deals.getAll) return;
        const allDeals = Deals.getAll();
        if (!allDeals || allDeals.length === 0) return;

        let linked = 0;
        for (const order of orders) {
            if (order.linkedDealId || order.isCounterSale) continue;

            // Try to match by email first
            if (order.customerEmail) {
                const emailMatch = allDeals.find(d =>
                    d.clientEmail && d.clientEmail.toLowerCase() === order.customerEmail.toLowerCase()
                );
                if (emailMatch) {
                    order.linkedDealId = emailMatch.id;
                    linked++;
                    continue;
                }
            }

            // Try to match by customer name
            if (order.customerName && order.customerName !== 'Client comptoir') {
                const nameLower = order.customerName.toLowerCase().trim();
                const nameMatch = allDeals.find(d =>
                    d.clientName && d.clientName.toLowerCase().trim() === nameLower
                );
                if (nameMatch) {
                    order.linkedDealId = nameMatch.id;
                    linked++;
                }
            }
        }

        if (linked > 0) {
            saveLocal();
            console.log(`Auto-link: ${linked} commande(s) liée(s) à des deals`);
        }
    }

    // ===== CONNECTION TEST =====

    async function testConnection() {
        const storeUrl = localStorage.getItem('crm_shopifyStore');
        const token = localStorage.getItem('crm_shopifyToken');

        if (!storeUrl || !token) {
            App.showToast('Entrez l\'URL du store et le token API', 'error');
            return false;
        }

        const proxyUrl = getProxyUrl();

        try {
            let response;

            if (proxyUrl) {
                response = await fetch(`${proxyUrl}/admin/api/2024-01/shop.json`, {
                    headers: {
                        'X-Shopify-Store': storeUrl,
                        'X-Shopify-Token': token,
                    }
                });
            } else {
                response = await fetch(`https://${storeUrl}/admin/api/2024-01/shop.json`, {
                    headers: { 'X-Shopify-Access-Token': token }
                });
            }

            if (response.ok) {
                App.showToast('Connexion Shopify réussie!', 'success');
                startAutoSync();
                return true;
            }
            App.showToast('Connexion échouée - vérifiez les identifiants', 'error');
            return false;
        } catch (e) {
            if (proxyUrl) {
                App.showToast('Erreur de connexion au proxy Shopify', 'error');
            } else {
                App.showToast('Erreur de connexion (CORS) - configurez un proxy dans Paramètres', 'warning');
            }
            return false;
        }
    }

    // ===== DEAL LINKING =====

    function linkToDeal(orderId, dealId) {
        const idx = orders.findIndex(o => o.id === orderId);
        if (idx !== -1) {
            orders[idx].linkedDealId = dealId;
            saveLocal();
            saveToSharePoint(orders[idx]);
            App.showToast('Paiement Shopify lié au deal', 'success');
        }
    }

    function getOrdersForDeal(dealId) {
        return orders.filter(o => o.linkedDealId === dealId);
    }

    // ===== STATS =====

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

    function getOrderStats() {
        const paidOrders = orders.filter(o => o.status === 'paid');
        const counterSales = paidOrders.filter(o => o.isCounterSale);
        const projectSales = paidOrders.filter(o => !o.isCounterSale);

        const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
        const counterSalesRevenue = counterSales.reduce((sum, o) => sum + (o.amount || 0), 0);
        const projectRevenue = projectSales.reduce((sum, o) => sum + (o.amount || 0), 0);
        const orderCount = paidOrders.length;
        const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

        return {
            totalRevenue,
            counterSalesRevenue,
            projectRevenue,
            avgOrderValue,
            orderCount,
        };
    }

    // ===== RENDER =====

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

        // Sync button
        let html = `
            <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
                <button onclick="Shopify.refreshOrders().then(() => { if(typeof Payments !== 'undefined' && Payments.render) Payments.render(); })"
                    style="padding:6px 14px;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg-card);cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;color:var(--text-primary)">
                    &#x21bb; Sync Shopify
                </button>
            </div>
        `;

        // Weekly summary
        const weeks = getWeeklyTotals();
        html += `
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

    // ===== DEMO DATA =====

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
        generateDemoOrders,
        refreshOrders,
        getOrderStats,
        saveToSharePoint,
        startAutoSync,
        stopAutoSync,
    };
})();
