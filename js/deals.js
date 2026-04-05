// ===== CRM LGC - Deals Module =====
// CRUD operations for deals, local storage for demo mode

const Deals = (() => {
    const STORAGE_KEY = 'crm_deals';
    const NOTES_KEY = 'crm_notes';
    let deals = [];
    let notes = [];

    // Pipeline stages definition
    const STAGES = [
        { id: 1, name: 'Nouveau lead', color: '#3b82f6', alertDays: 0 },
        { id: 2, name: 'Réception mesures/plans', color: '#eab308', alertDays: 3 },
        { id: 3, name: 'Entrée Mec-inov', color: '#eab308', alertDays: 0 },
        { id: 4, name: 'Soumission fabriquée', color: '#f97316', alertDays: 0 },
        { id: 5, name: 'Soumission envoyée', color: '#f97316', alertDays: 0 },
        { id: 6, name: 'Relance client', color: '#ef4444', alertDays: 5 },
        { id: 7, name: 'Révision/modification', color: '#f97316', alertDays: 3 },
        { id: 8, name: 'Signature contrat', color: '#22c55e', alertDays: 5 },
        { id: 9, name: 'Acompte', color: '#22c55e', alertDays: 7 },
        { id: 10, name: 'Commande fournisseur', color: '#3b82f6', alertDays: 0 },
        { id: 11, name: 'Mesures installation', color: '#eab308', alertDays: 5 },
        { id: 12, name: 'Fabrication/livraison', color: '#3b82f6', alertDays: 0 },
        { id: 13, name: 'Installation', color: '#22c55e', alertDays: 0 },
        { id: 14, name: 'SAV / Complété', color: '#94a3b8', alertDays: 0 },
    ];

    const STAGE_MAP = {};
    STAGES.forEach(s => STAGE_MAP[s.id] = s);

    function getStages() { return STAGES; }
    function getStageName(id) { return STAGE_MAP[id]?.name || 'Inconnu'; }
    function getStageColor(id) { return STAGE_MAP[id]?.color || '#94a3b8'; }

    async function loadDeals() {
        if (Auth.useLocalStorage()) {
            const saved = localStorage.getItem(STORAGE_KEY);
            deals = saved ? JSON.parse(saved) : generateDemoDeals();
            if (!saved) saveLocal();
            const savedNotes = localStorage.getItem(NOTES_KEY);
            notes = savedNotes ? JSON.parse(savedNotes) : [];
        } else {
            try {
                const spDeals = await Graph.getListItems('CRM_Deals');
                deals = spDeals.map(item => mapFromSharePoint(item));
                const spNotes = await Graph.getListItems('CRM_Notes');
                notes = spNotes.map(item => {
                    return {
                        id: item.id,
                        _spId: item.id,
                        dealId: item.DealId || item.dealId,
                        author: item.Author || item.author,
                        noteText: item.NoteText || item.noteText,
                        noteDate: item.NoteDate || item.noteDate,
                        noteType: item.NoteType || item.noteType || 'note',
                        noteIcon: item.NoteIcon || item.noteIcon || '',
                    };
                });
                // Also keep a localStorage cache for offline/fallback
                saveLocal();
            } catch (e) {
                console.error('Failed to load deals from SharePoint, falling back to localStorage:', e);
                const saved = localStorage.getItem(STORAGE_KEY);
                deals = saved ? JSON.parse(saved) : generateDemoDeals();
                if (!saved) saveLocal();
                const savedNotes = localStorage.getItem(NOTES_KEY);
                notes = savedNotes ? JSON.parse(savedNotes) : [];
            }
        }
        return deals;
    }

    function saveLocal() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    }

    function getAll() { return deals; }

    function getById(id) {
        return deals.find(d => d.id === id);
    }

    function getByStage(stageId) {
        return deals.filter(d => d.stage === stageId && d.status === 'active');
    }

    function getActive() {
        return deals.filter(d => d.status === 'active');
    }

    function getByVendeur(vendeurId) {
        return deals.filter(d => d.assignedTo === vendeurId);
    }

    async function create(dealData) {
        const deal = {
            id: 'D' + Date.now(),
            ...dealData,
            stage: dealData.stage || 1,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        if (!Auth.useLocalStorage()) {
            try {
                const created = await Graph.createListItem('CRM_Deals', mapToSharePoint(deal));
                if (created) {
                    deal._spId = created.id;
                    deal.id = created.id; // Use SP id as canonical
                }
            } catch (e) {
                console.error('SharePoint create failed, saving locally:', e);
            }
        }

        deals.push(deal);
        saveLocal(); // Always cache locally

        App.addActivity('new_deal', `Nouveau deal: ${deal.clientName}`, deal.id);
        return deal;
    }

    async function update(id, updates) {
        const idx = deals.findIndex(d => d.id === id || d._spId === id);
        if (idx === -1) return null;

        const oldStage = deals[idx].stage;
        deals[idx] = { ...deals[idx], ...updates, updatedAt: new Date().toISOString() };

        if (!Auth.useLocalStorage()) {
            try {
                const spId = deals[idx]._spId || id;
                await Graph.updateListItem('CRM_Deals', spId, mapToSharePoint(updates));
            } catch (e) {
                console.error('SharePoint update failed, saved locally:', e);
            }
        }

        saveLocal(); // Always cache locally

        if (updates.stage && updates.stage !== oldStage) {
            App.addActivity('stage_change',
                `${deals[idx].clientName}: ${getStageName(oldStage)} → ${getStageName(updates.stage)}`,
                id
            );
        }

        return deals[idx];
    }

    async function markLost(id, reason = '') {
        const deal = getById(id);
        if (!deal) return;
        await update(id, { status: 'lost', lostReason: reason, completedDate: new Date().toISOString().split('T')[0] });
        App.addActivity('deal_lost', `Deal perdu: ${deal.clientName}`, id);
    }

    async function markWon(id) {
        const deal = getById(id);
        if (!deal) return;
        await update(id, { status: 'won', stage: 14, completedDate: new Date().toISOString().split('T')[0] });
        App.addActivity('deal_won', `Deal gagné: ${deal.clientName} - ${formatMoney(deal.contractAmount || deal.quoteAmount)}`, id);
    }

    async function addNote(dealId, text, meta = {}) {
        const user = Auth.getUser();
        const note = {
            id: 'N' + Date.now(),
            dealId,
            author: user.name,
            noteText: text,
            noteDate: new Date().toISOString(),
            noteType: meta.type || 'note',
            noteIcon: meta.icon || '',
        };

        if (!Auth.useLocalStorage()) {
            try {
                const spNote = {
                    DealId: dealId,
                    Author: note.author,
                    NoteText: text,
                    NoteDate: note.noteDate,
                    NoteType: note.noteType,
                };
                const created = await Graph.createListItem('CRM_Notes', spNote);
                if (created) { note._spId = created.id; note.id = created.id; }
            } catch (e) {
                console.error('SharePoint note create failed:', e);
            }
        }

        notes.push(note);
        saveLocal(); // Always cache
        return note;
    }

    function getNotesForDeal(dealId) {
        return notes.filter(n => n.dealId === dealId).sort((a, b) =>
            new Date(b.noteDate) - new Date(a.noteDate)
        );
    }

    // Calculate delay in days between lead date and quote sent date
    function getLeadToQuoteDelay(deal) {
        if (!deal.leadDate || !deal.quoteSentDate) return null;
        const lead = new Date(deal.leadDate);
        const quote = new Date(deal.quoteSentDate);
        return Math.round((quote - lead) / (1000 * 60 * 60 * 24));
    }

    // Get days since a date
    function getDaysSince(dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        const now = new Date();
        return Math.round((now - d) / (1000 * 60 * 60 * 24));
    }

    // Check if deal is overdue for its current stage
    function isOverdue(deal) {
        if (deal.status !== 'active') return false;
        const stage = STAGE_MAP[deal.stage];
        if (!stage || !stage.alertDays) return false;

        const daysSinceUpdate = getDaysSince(deal.updatedAt);
        return daysSinceUpdate > stage.alertDays;
    }

    // Field mapping: local camelCase ↔ SharePoint PascalCase
    const FIELD_MAP = {
        clientName: 'ClientName', clientPhone: 'ClientPhone', clientEmail: 'ClientEmail',
        clientAddress: 'ClientAddress', accountNumber: 'AccountNumber', clientType: 'ClientType', leadSource: 'LeadSource',
        projectType: 'ProjectType', products: 'Products', description: 'Description',
        quoteAmount: 'QuoteAmount', contractAmount: 'ContractAmount', stage: 'Stage',
        status: 'Status', assignedTo: 'AssignedTo', mecinovQuoteNum: 'MecinovQuoteNum',
        mecinovOrderNum: 'MecinovOrderNum', mecinovInvoiceNum: 'MecinovInvoiceNum',
        avantageInvoiceNum: 'AvantageInvoiceNum', shopifyOrderNum: 'ShopifyOrderNum',
        depositRequired: 'DepositRequired', depositReceived: 'DepositReceived',
        paymentStatus: 'PaymentStatus', leadDate: 'LeadDate', assignDate: 'AssignDate',
        quoteSentDate: 'QuoteSentDate', lastFollowUp: 'LastFollowUp',
        contractSignDate: 'ContractSignDate', depositDate: 'DepositDate',
        supplierOrderDate: 'SupplierOrderDate', measurementDate: 'MeasurementDate',
        installDate: 'InstallDate', completedDate: 'CompletedDate',
        followUpCount: 'FollowUpCount', lostReason: 'LostReason',
    };

    // Reverse map: SharePoint PascalCase → local camelCase
    const REVERSE_FIELD_MAP = {};
    for (const [local, sp] of Object.entries(FIELD_MAP)) {
        REVERSE_FIELD_MAP[sp] = local;
    }

    // Map deal fields to SharePoint column names
    function mapToSharePoint(deal) {
        const map = {};
        for (const [key, spKey] of Object.entries(FIELD_MAP)) {
            if (deal[key] !== undefined) map[spKey] = deal[key];
        }
        return map;
    }

    // Map SharePoint item back to local deal format
    function mapFromSharePoint(spItem) {
        const deal = { id: spItem.id, _spId: spItem.id };
        for (const [spKey, localKey] of Object.entries(REVERSE_FIELD_MAP)) {
            if (spItem[spKey] !== undefined && spItem[spKey] !== null) {
                deal[localKey] = spItem[spKey];
            }
        }
        // Preserve metadata fields
        deal.createdAt = spItem.Created || spItem.createdAt || '';
        deal.updatedAt = spItem.Modified || spItem.updatedAt || '';
        // Ensure numeric fields
        if (deal.stage) deal.stage = Number(deal.stage);
        if (deal.quoteAmount) deal.quoteAmount = Number(deal.quoteAmount);
        if (deal.contractAmount) deal.contractAmount = Number(deal.contractAmount);
        if (deal.depositRequired) deal.depositRequired = Number(deal.depositRequired);
        if (deal.followUpCount) deal.followUpCount = Number(deal.followUpCount);
        return deal;
    }

    // Stats helpers
    function getStats() {
        const active = getActive();
        const won = deals.filter(d => d.status === 'won');
        const lost = deals.filter(d => d.status === 'lost');
        const total = won.length + lost.length;

        const pipelineValue = active.reduce((sum, d) => sum + (d.quoteAmount || 0), 0);
        const conversionRate = total > 0 ? Math.round((won.length / total) * 100) : 0;

        // Average lead to quote delay
        const delays = active.filter(d => d.leadDate && d.quoteSentDate)
            .map(d => getLeadToQuoteDelay(d))
            .filter(d => d !== null && d >= 0);
        const avgDelay = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;

        const overdue = active.filter(d => isOverdue(d)).length;

        // Monthly revenue (contracts signed this month)
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const monthlyRevenue = won
            .filter(d => d.contractSignDate && d.contractSignDate >= monthStart)
            .reduce((sum, d) => sum + (d.contractAmount || d.quoteAmount || 0), 0);

        return {
            activeDeals: active.length,
            pipelineValue,
            conversionRate,
            avgDelay,
            overdue,
            monthlyRevenue,
            wonCount: won.length,
            lostCount: lost.length,
        };
    }

    function getStageStats() {
        return STAGES.map(stage => {
            const stageDeals = getByStage(stage.id);
            return {
                ...stage,
                count: stageDeals.length,
                value: stageDeals.reduce((sum, d) => sum + (d.quoteAmount || 0), 0),
            };
        });
    }

    // Generate demo data
    function generateDemoDeals() {
        const names = [
            'Tremblay, Martin', 'Gagnon, Sophie', 'Roy, Pierre', 'Bouchard, André',
            'Côté, Luc', 'Fortin, Marie', 'Lavoie, Jacques', 'Morin, Isabelle',
            'Gauthier, François', 'Ouellet, Nathalie', 'Pelletier, Robert', 'Bélanger, Julie',
            'Levesque, Denis', 'Bergeron, Chantal', 'Simard, Yves', 'Girard, Annie',
            'Carrier, Marc', 'Poulin, Sylvie', 'Dufour, Jean', 'Turcotte, Nicole',
            'Construction ABC', 'Rénovations Pro Inc.', 'Bâtiment XYZ Ltée', 'Maisons du Fleuve',
        ];
        const vendors = ['sylvain', 'fabien', 'claude', 'nathalie', 'keven', 'charles'];
        const today = new Date();
        const demoDeals = [];

        for (let i = 0; i < 24; i++) {
            const isEntrepreneur = i >= 20;
            const stage = Math.min(14, Math.floor(Math.random() * 14) + 1);
            const leadDaysAgo = Math.floor(Math.random() * 60) + 5;
            const leadDate = new Date(today);
            leadDate.setDate(leadDate.getDate() - leadDaysAgo);

            const quoteSentDaysAgo = stage >= 5 ? leadDaysAgo - Math.floor(Math.random() * 15) - 3 : null;
            const quoteSentDate = quoteSentDaysAgo ? new Date(today) : null;
            if (quoteSentDate) quoteSentDate.setDate(quoteSentDate.getDate() - quoteSentDaysAgo);

            const quoteAmount = Math.round((Math.random() * 25000 + 2000) / 100) * 100;

            const deal = {
                id: 'D' + (1000 + i),
                clientName: names[i],
                clientPhone: `(418) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
                clientEmail: names[i].split(',')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + '@example.com',
                clientAddress: `${Math.floor(Math.random() * 9000) + 100} rue ${['Principale', 'du Fleuve', 'des Érables', 'Sainte-Anne', 'Commerciale'][Math.floor(Math.random() * 5)]}`,
                accountNumber: 'AV-' + (10000 + Math.floor(Math.random() * 90000)),
                clientType: isEntrepreneur ? 'entrepreneur' : 'regulier',
                leadSource: ['telephone', 'courriel', 'en-personne', 'reference', 'web'][Math.floor(Math.random() * 5)],
                projectType: isEntrepreneur ? 'commercial' : ['renovation', 'neuf'][Math.floor(Math.random() * 2)],
                products: ['fenetres', 'portes', 'les-deux'][Math.floor(Math.random() * 3)],
                description: '',
                quoteAmount: quoteAmount,
                contractAmount: stage >= 8 ? quoteAmount - Math.round(Math.random() * 500) : 0,
                stage: stage,
                status: i < 20 ? 'active' : (i < 22 ? 'won' : 'active'),
                assignedTo: vendors[Math.floor(Math.random() * vendors.length)],
                leadDate: leadDate.toISOString().split('T')[0],
                quoteSentDate: quoteSentDate ? quoteSentDate.toISOString().split('T')[0] : '',
                depositReceived: stage >= 9 && !isEntrepreneur ? 'oui' : (isEntrepreneur ? 'na' : 'non'),
                depositRequired: !isEntrepreneur ? Math.round(quoteAmount * 0.5) : 0,
                paymentStatus: stage >= 14 ? 'paid' : 'pending',
                mecinovQuoteNum: stage >= 4 ? `S${10000 + i}` : '',
                followUpCount: stage >= 5 ? Math.floor(Math.random() * 4) : 0,
                createdAt: leadDate.toISOString(),
                updatedAt: new Date(today.getTime() - Math.random() * 7 * 86400000).toISOString(),
            };

            // Some deals should be overdue for demo
            if (i < 4) {
                deal.stage = 6; // Relance client
                deal.updatedAt = new Date(today.getTime() - 8 * 86400000).toISOString(); // 8 days ago
            }

            demoDeals.push(deal);
        }
        return demoDeals;
    }

    // Format helpers
    function formatMoney(amount) {
        if (!amount) return '0 $';
        return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(amount);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '--';
        return new Date(dateStr).toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // Quick action: log a follow-up action on a deal
    async function quickAction(dealId, actionType) {
        const deal = getById(dealId);
        if (!deal) return;

        const now = new Date().toISOString();
        const todayStr = now.split('T')[0];

        if (actionType === 'call') {
            deal.followUpCount = (deal.followUpCount || 0) + 1;
            deal.lastFollowUp = todayStr;
            deal.updatedAt = now;
            await addNote(dealId, 'Appel effectue', { type: 'call', icon: '' });
        } else if (actionType === 'email') {
            deal.lastFollowUp = todayStr;
            deal.updatedAt = now;
            await addNote(dealId, 'Courriel envoye', { type: 'email', icon: '' });
        } else if (actionType === 'noreply') {
            deal.followUpCount = (deal.followUpCount || 0) + 1;
            deal.updatedAt = now;
            await addNote(dealId, 'Pas de reponse', { type: 'noreply', icon: '' });
        }

        saveLocal(); // Always cache locally

        if (!Auth.useLocalStorage()) {
            try {
                const spId = deal._spId || dealId;
                await Graph.updateListItem('CRM_Deals', spId, mapToSharePoint({
                    followUpCount: deal.followUpCount,
                    lastFollowUp: deal.lastFollowUp,
                    updatedAt: deal.updatedAt,
                }));
            } catch (e) {
                console.error('SharePoint quickAction sync failed:', e);
            }
        }
    }

    // Export all deals for migration
    function getAllRaw() { return { deals, notes }; }

    return {
        loadDeals,
        getAll,
        getById,
        getByStage,
        getActive,
        getByVendeur,
        create,
        update,
        markLost,
        markWon,
        addNote,
        getNotesForDeal,
        quickAction,
        getStages,
        getStageName,
        getStageColor,
        getLeadToQuoteDelay,
        getDaysSince,
        isOverdue,
        getStats,
        getStageStats,
        formatMoney,
        formatDate,
        STAGES,
        getAllRaw,
        mapToSharePoint,
        mapFromSharePoint,
    };
})();
