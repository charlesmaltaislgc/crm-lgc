// ===== CRM LGC - Agent IA Always-On Module =====
// Autonomous AI agent with learning, proactive alerts, action execution
// Upgrade from basic chatbot — retains all original functionality

const Chatbot = (() => {
    const HISTORY_KEY = 'crm_chat_history';
    const MEMORY_KEY = 'crm_agent_memory';
    const MODE_KEY = 'crm_agent_mode';
    const ALERTS_KEY = 'crm_agent_alerts';

    let chatHistory = [];
    let isOpen = false;
    let isProcessing = false;
    let agentMode = 'agent'; // 'assistant' | 'agent'
    let proactiveAlerts = [];
    let backgroundInterval = null;
    let agentMemory = { patterns: [], decisions: [], feedback: [] };

    // ===== INITIALIZATION =====
    function init() {
        loadMemory();
        loadHistory();
        agentMode = localStorage.getItem(MODE_KEY) || 'agent';
        createChatWidget();
        startBackgroundChecks();
    }

    // ===== MEMORY SYSTEM =====
    function loadMemory() {
        try {
            const saved = localStorage.getItem(MEMORY_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                agentMemory = {
                    patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
                    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
                    feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
                };
            }
        } catch (e) {
            console.warn('Agent memory load failed:', e);
            agentMemory = { patterns: [], decisions: [], feedback: [] };
        }
    }

    function saveMemory() {
        // Trim old entries to prevent unbounded growth
        if (agentMemory.patterns.length > 200) agentMemory.patterns = agentMemory.patterns.slice(-200);
        if (agentMemory.decisions.length > 500) agentMemory.decisions = agentMemory.decisions.slice(-500);
        if (agentMemory.feedback.length > 200) agentMemory.feedback = agentMemory.feedback.slice(-200);
        localStorage.setItem(MEMORY_KEY, JSON.stringify(agentMemory));
        syncMemoryToSharePoint();
    }

    function addPattern(pattern) {
        agentMemory.patterns.push({
            ...pattern,
            timestamp: new Date().toISOString(),
        });
        saveMemory();
    }

    function addDecision(decision) {
        agentMemory.decisions.push({
            ...decision,
            timestamp: new Date().toISOString(),
            outcome: null, // will be updated later
        });
        saveMemory();
    }

    function addFeedback(type, context) {
        agentMemory.feedback.push({
            type, // 'positive' | 'negative'
            context,
            timestamp: new Date().toISOString(),
        });
        saveMemory();
        // Also update the most recent decision outcome if applicable
        if (agentMemory.decisions.length > 0) {
            const last = agentMemory.decisions[agentMemory.decisions.length - 1];
            if (!last.outcome) {
                last.outcome = type;
                saveMemory();
            }
        }
    }

    function detectFeedback(text) {
        const lower = text.toLowerCase();
        const positivePhrases = ['bon conseil', 'bonne suggestion', 'merci', 'parfait', 'excellent', 'bravo', 'super', 'exactement', 'good'];
        const negativePhrases = ['mauvais conseil', 'mauvaise suggestion', 'non merci', 'pas bon', 'incorrect', 'faux', 'erreur', 'bad'];
        for (const phrase of positivePhrases) {
            if (lower.includes(phrase)) {
                addFeedback('positive', text);
                return 'positive';
            }
        }
        for (const phrase of negativePhrases) {
            if (lower.includes(phrase)) {
                addFeedback('negative', text);
                return 'negative';
            }
        }
        return null;
    }

    async function syncMemoryToSharePoint() {
        if (typeof Auth === 'undefined' || Auth.useLocalStorage()) return;
        try {
            const existing = await Graph.getListItems('CRM_AgentMemory');
            const payload = {
                Title: 'agent_memory',
                MemoryData: JSON.stringify(agentMemory),
                UpdatedAt: new Date().toISOString(),
            };
            if (existing && existing.length > 0) {
                await Graph.updateListItem('CRM_AgentMemory', existing[0].id, payload);
            } else {
                await Graph.createListItem('CRM_AgentMemory', payload);
            }
        } catch (e) {
            // SharePoint list may not exist yet — silent fail, localStorage is primary
            console.debug('Agent memory SharePoint sync skipped:', e.message);
        }
    }

    // ===== SMART ANALYTICS =====
    function getVendorWorkload() {
        const team = (typeof Auth !== 'undefined') ? Auth.getTeamMembers() : [];
        const vendors = team.filter(m => m.role === 'vendeur' || m.role === 'directeur');
        const deals = (typeof Deals !== 'undefined') ? Deals.getAll() : [];
        const active = deals.filter(d => d.status === 'active');

        return vendors.map(v => {
            const vDeals = active.filter(d => d.assignedTo === v.id);
            const won = deals.filter(d => d.assignedTo === v.id && d.status === 'won');
            const lost = deals.filter(d => d.assignedTo === v.id && d.status === 'lost');
            const total = won.length + lost.length;
            const conversionRate = total > 0 ? Math.round((won.length / total) * 100) : 0;
            const totalRevenue = won.reduce((sum, d) => sum + (d.contractAmount || d.quoteAmount || 0), 0);
            return {
                id: v.id,
                name: v.name,
                role: v.role,
                activeDeals: vDeals.length,
                activeValue: vDeals.reduce((sum, d) => sum + (d.quoteAmount || d.contractAmount || 0), 0),
                wonCount: won.length,
                lostCount: lost.length,
                conversionRate,
                totalRevenue,
            };
        }).sort((a, b) => a.activeDeals - b.activeDeals); // least busy first
    }

    function getBestVendorForAssignment(clientType, dealValue) {
        const workload = getVendorWorkload();
        if (workload.length === 0) return null;

        // Scoring: lower active deals = better, higher conversion = better, revenue bonus
        let best = null;
        let bestScore = -Infinity;

        for (const v of workload) {
            let score = 0;
            // Fewer active deals is better (capacity)
            score += (10 - Math.min(10, v.activeDeals)) * 3;
            // Higher conversion rate is better
            score += v.conversionRate * 0.5;
            // If deal is high value (>15k), prefer experienced vendors
            if (dealValue > 15000 && v.totalRevenue > 50000) score += 10;
            // If entrepreneur client, prefer vendors with more wins
            if (clientType === 'entrepreneur' && v.wonCount > 5) score += 8;
            // Check memory for vendor-specific patterns
            const vendorFeedback = agentMemory.feedback.filter(f =>
                f.context && f.context.toLowerCase().includes(v.name.toLowerCase())
            );
            const posFeedback = vendorFeedback.filter(f => f.type === 'positive').length;
            const negFeedback = vendorFeedback.filter(f => f.type === 'negative').length;
            score += (posFeedback - negFeedback) * 2;

            if (score > bestScore) {
                bestScore = score;
                best = v;
            }
        }
        return best;
    }

    function getFollowUpInsights() {
        const deals = (typeof Deals !== 'undefined') ? Deals.getAll() : [];
        const won = deals.filter(d => d.status === 'won');
        // Analyze follow-up timing for wins
        let quickFollowUpWins = 0;
        let slowFollowUpWins = 0;
        for (const d of won) {
            if (d.quoteSentDate && d.lastFollowUp) {
                const daysBetween = Math.floor(
                    (new Date(d.lastFollowUp) - new Date(d.quoteSentDate)) / (1000 * 60 * 60 * 24)
                );
                if (daysBetween <= 3) quickFollowUpWins++;
                else slowFollowUpWins++;
            }
        }
        return { quickFollowUpWins, slowFollowUpWins };
    }

    // ===== PROACTIVE BACKGROUND CHECKS =====
    function startBackgroundChecks() {
        // Run immediately once, then every 60 seconds
        runBackgroundCheck();
        backgroundInterval = setInterval(runBackgroundCheck, 60000);
    }

    function stopBackgroundChecks() {
        if (backgroundInterval) {
            clearInterval(backgroundInterval);
            backgroundInterval = null;
        }
    }

    function runBackgroundCheck() {
        if (typeof Deals === 'undefined') return;

        const alerts = [];
        const deals = Deals.getAll();
        const active = deals.filter(d => d.status === 'active');
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // 1. Deals without follow-up > 3 days
        for (const deal of active) {
            const lastActivity = deal.lastFollowUp || deal.quoteSentDate || deal.leadDate;
            if (lastActivity) {
                const daysSince = Math.floor((now - new Date(lastActivity)) / (1000 * 60 * 60 * 24));
                if (daysSince > 3 && deal.stage >= 5 && deal.stage <= 8) {
                    alerts.push({
                        id: 'followup_' + deal.id,
                        type: 'followup_overdue',
                        severity: daysSince > 7 ? 'high' : 'medium',
                        title: `Relance en retard: ${deal.clientName}`,
                        description: `${daysSince} jours sans suivi (${Deals.getStageName(deal.stage)})`,
                        dealId: deal.id,
                        action: { type: 'navigate', params: { dealId: deal.id } },
                        actionLabel: 'Ouvrir le deal',
                        timestamp: now.toISOString(),
                    });
                }
            }
        }

        // 2. Approaching deadlines (installation dates, measurement dates)
        for (const deal of active) {
            const checkDates = [
                { field: 'installDate', label: 'Installation' },
                { field: 'measurementDate', label: 'Mesures' },
            ];
            for (const { field, label } of checkDates) {
                if (deal[field]) {
                    const daysUntil = Math.floor((new Date(deal[field]) - now) / (1000 * 60 * 60 * 24));
                    if (daysUntil >= 0 && daysUntil <= 3) {
                        alerts.push({
                            id: `deadline_${field}_${deal.id}`,
                            type: 'approaching_deadline',
                            severity: daysUntil === 0 ? 'high' : 'medium',
                            title: `${label} ${daysUntil === 0 ? "aujourd'hui" : `dans ${daysUntil}j`}: ${deal.clientName}`,
                            description: `${label} prevue le ${deal[field]}`,
                            dealId: deal.id,
                            action: { type: 'navigate', params: { dealId: deal.id } },
                            actionLabel: 'Voir le deal',
                            timestamp: now.toISOString(),
                        });
                    }
                }
            }
        }

        // 3. New leads not assigned (stage 1, no assignedTo)
        const unassigned = active.filter(d => d.stage === 1 && !d.assignedTo);
        for (const deal of unassigned) {
            const daysSinceLead = deal.leadDate ? Math.floor((now - new Date(deal.leadDate)) / (1000 * 60 * 60 * 24)) : 0;
            if (daysSinceLead >= 1) {
                const bestVendor = getBestVendorForAssignment(deal.clientType, deal.quoteAmount || 0);
                alerts.push({
                    id: 'unassigned_' + deal.id,
                    type: 'unassigned_lead',
                    severity: daysSinceLead > 2 ? 'high' : 'medium',
                    title: `Lead non assigné: ${deal.clientName}`,
                    description: `Depuis ${daysSinceLead}j${bestVendor ? ` — Suggestion: ${bestVendor.name}` : ''}`,
                    dealId: deal.id,
                    action: bestVendor ? {
                        type: 'assign_deal',
                        params: { dealId: deal.id, vendeur: bestVendor.id }
                    } : { type: 'navigate', params: { dealId: deal.id } },
                    actionLabel: bestVendor ? `Assigner a ${bestVendor.name}` : 'Ouvrir le deal',
                    timestamp: now.toISOString(),
                });
            }
        }

        // 4. High-value deals stuck (> 10 days in same stage)
        for (const deal of active) {
            if ((deal.quoteAmount || deal.contractAmount || 0) > 10000) {
                const lastUpdate = deal.updatedAt || deal.leadDate;
                if (lastUpdate) {
                    const daysSinceUpdate = Math.floor((now - new Date(lastUpdate)) / (1000 * 60 * 60 * 24));
                    if (daysSinceUpdate > 10 && deal.stage >= 3 && deal.stage <= 9) {
                        alerts.push({
                            id: 'stuck_' + deal.id,
                            type: 'stuck_deal',
                            severity: 'medium',
                            title: `Deal bloque: ${deal.clientName}`,
                            description: `${Deals.formatMoney(deal.quoteAmount || deal.contractAmount)} — ${daysSinceUpdate}j sans progression`,
                            dealId: deal.id,
                            action: { type: 'navigate', params: { dealId: deal.id } },
                            actionLabel: 'Analyser le deal',
                            timestamp: now.toISOString(),
                        });
                    }
                }
            }
        }

        // 5. Deals won pattern detection — learn from wins
        const recentWins = deals.filter(d => d.status === 'won' && d.completedDate);
        for (const win of recentWins.slice(-5)) {
            if (win.quoteSentDate && win.lastFollowUp) {
                const followUpDelay = Math.floor(
                    (new Date(win.lastFollowUp) - new Date(win.quoteSentDate)) / (1000 * 60 * 60 * 24)
                );
                const existingPattern = agentMemory.patterns.find(p =>
                    p.type === 'followup_timing' && p.dealId === win.id
                );
                if (!existingPattern) {
                    addPattern({
                        type: 'followup_timing',
                        dealId: win.id,
                        vendeur: win.assignedTo,
                        followUpDelay,
                        result: 'won',
                        value: win.contractAmount || win.quoteAmount || 0,
                    });
                }
            }
        }

        // Deduplicate alerts by id
        const seen = new Set();
        proactiveAlerts = alerts.filter(a => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
        }).sort((a, b) => {
            const sev = { high: 3, medium: 2, low: 1 };
            return (sev[b.severity] || 0) - (sev[a.severity] || 0);
        });

        localStorage.setItem(ALERTS_KEY, JSON.stringify(proactiveAlerts));
        updateBadge();
    }

    function updateBadge() {
        const badge = document.getElementById('chatbot-badge');
        const count = proactiveAlerts.length;
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 9 ? '9+' : count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
        // Pulse effect on toggle button
        const btn = document.getElementById('chatbot-toggle');
        if (btn) {
            if (count > 0 && !isOpen) {
                btn.classList.add('chatbot-has-alerts');
            } else {
                btn.classList.remove('chatbot-has-alerts');
            }
        }
    }

    // ===== HISTORY =====
    function loadHistory() {
        const saved = localStorage.getItem(HISTORY_KEY);
        chatHistory = saved ? JSON.parse(saved) : [];
        // Keep last 50 messages
        if (chatHistory.length > 50) chatHistory = chatHistory.slice(-50);
    }

    function saveHistory() {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory));
    }

    // ===== CRM DATA CONTEXT =====
    function getCRMContext() {
        const deals = Deals.getAll();
        const user = Auth.getUser();
        const team = Auth.getTeamMembers();
        const savStats = (typeof SAV !== 'undefined') ? SAV.getStats() : {};
        const savTickets = (typeof SAV !== 'undefined') ? SAV.getTickets() : [];

        const active = deals.filter(d => d.status === 'active');
        const won = deals.filter(d => d.status === 'won');
        const lost = deals.filter(d => d.status === 'lost');

        // Pipeline summary by stage
        const stages = {};
        active.forEach(d => {
            const name = Deals.getStageName(d.stage);
            if (!stages[name]) stages[name] = { count: 0, value: 0 };
            stages[name].count++;
            stages[name].value += d.quoteAmount || d.contractAmount || 0;
        });

        // Recent activity
        const recentDeals = deals.slice(0, 20).map(d => ({
            id: d.id,
            client: d.clientName,
            stage: Deals.getStageName(d.stage),
            status: d.status,
            montant: d.quoteAmount || d.contractAmount || 0,
            vendeur: d.assignedTo,
            lastUpdate: d.updatedAt || d.leadDate,
        }));

        // Overdue / alerts
        const overdue = active.filter(d => {
            if (!d.quoteSentDate && d.leadDate) {
                const days = Math.floor((new Date() - new Date(d.leadDate)) / (1000*60*60*24));
                return days > 5;
            }
            return false;
        });

        const today = new Date().toISOString().split('T')[0];

        // Vendor workload for smart suggestions
        const vendorWorkload = getVendorWorkload();
        const followUpInsights = getFollowUpInsights();

        // Memory summary
        const recentDecisions = agentMemory.decisions.slice(-10);
        const positiveCount = agentMemory.feedback.filter(f => f.type === 'positive').length;
        const negativeCount = agentMemory.feedback.filter(f => f.type === 'negative').length;
        const patterns = agentMemory.patterns.slice(-10);

        return `
CONTEXTE CRM LGC — ${today}
Utilisateur: ${user?.name} (${user?.role})
Equipe: ${team.map(m => `${m.name} (${m.role})`).join(', ')}

PIPELINE:
- Deals actifs: ${active.length} (valeur: ${active.reduce((s,d) => s + (d.quoteAmount||d.contractAmount||0), 0).toLocaleString('fr-CA')}$)
- Deals gagnes: ${won.length}
- Deals perdus: ${lost.length}
${Object.entries(stages).map(([name, data]) => `  * ${name}: ${data.count} deals (${data.value.toLocaleString('fr-CA')}$)`).join('\n')}

CHARGE DE TRAVAIL VENDEURS:
${vendorWorkload.map(v => `  * ${v.name}: ${v.activeDeals} deals actifs (${v.activeValue.toLocaleString('fr-CA')}$), taux conversion: ${v.conversionRate}%, revenu total: ${v.totalRevenue.toLocaleString('fr-CA')}$`).join('\n')}

INSIGHTS RELANCE:
- Relances rapides (<=3j) ayant mene a des ventes: ${followUpInsights.quickFollowUpWins}
- Relances lentes (>3j) ayant mene a des ventes: ${followUpInsights.slowFollowUpWins}

ALERTES PROACTIVES EN COURS (${proactiveAlerts.length}):
${proactiveAlerts.slice(0, 10).map(a => `  * [${a.severity.toUpperCase()}] ${a.title} — ${a.description}`).join('\n')}

ALERTES PIPELINE:
- ${overdue.length} deals en retard (soumission > 5 jours)
${overdue.slice(0, 5).map(d => `  * ${d.clientName} — lead du ${d.leadDate}, pas de soumission`).join('\n')}

SAV:
- Tickets ouverts: ${savStats.open || 0}
- Resolus: ${savStats.resolved || 0}
- Delai moyen: ${savStats.avgResolution || 0} jours
${savTickets.filter(t => !['resolved','closed'].includes(t.status)).slice(0, 5).map(t => `  * ${t.id}: ${t.clientName} — ${t.problemType} (${t.status})`).join('\n')}

DEALS RECENTS:
${recentDeals.map(d => `  ${d.status === 'active' ? '[ACTIF]' : d.status === 'won' ? '[GAGNE]' : '[PERDU]'} ${d.client} — ${d.stage} — ${d.montant.toLocaleString('fr-CA')}$ — vendeur: ${d.vendeur || 'non-assigne'}`).join('\n')}

MEMOIRE AGENT:
- Decisions recentes: ${recentDecisions.length} (${positiveCount} retours positifs, ${negativeCount} negatifs)
- Patterns appris: ${patterns.length}
${patterns.slice(-5).map(p => `  * ${p.type}: ${JSON.stringify(p)}`).join('\n')}
`.trim();
    }

    // ===== ENHANCED SYSTEM PROMPT =====
    function getSystemPrompt(context) {
        const modeInstruction = agentMode === 'agent'
            ? `Tu es en MODE AGENT: tu es proactif, tu sugges des actions concretes, tu crees des deals, assignes des taches, et navigues dans le CRM quand c'est pertinent. N'hesite pas a proposer des actions.`
            : `Tu es en MODE ASSISTANT: tu reponds aux questions de facon informative et concise. Tu ne prends pas d'actions sauf si on te le demande explicitement.`;

        return `Tu es l'Agent IA du CRM de Portes et Fenetres LGC, une entreprise de portes et fenetres au Quebec.
Tu parles en francais quebecois professionnel. Tu as acces aux donnees du CRM ci-dessous.

${modeInstruction}

CAPACITES D'ACTION:
Quand tu veux suggerer ou executer une action, utilise EXACTEMENT ce format dans ta reponse:
[ACTION:create_deal:{"clientName":"Nom","clientPhone":"tel","clientEmail":"email","leadSource":"courriel","clientType":"regulier","products":"fenetres","description":"details"}]
[ACTION:assign_deal:{"dealId":"D123","vendeur":"sylvain"}]
[ACTION:create_task:{"description":"Description tache","assignedTo":"vendeur_id","deadline":"2026-04-10","dealId":"D123","priority":"normal"}]
[ACTION:navigate:{"view":"pipeline"}] ou [ACTION:navigate:{"dealId":"D123"}]
[ACTION:send_reminder:{"dealId":"D123","message":"texte du rappel"}]
[ACTION:send_email:{"to":"email@example.com","subject":"Sujet","body":"Corps du courriel"}]
[ACTION:move_stage:{"dealId":"D123","stage":5}]
[ACTION:suggest_next:{"dealId":"D123","suggestion":"Envoyer la soumission cette semaine"}]

REGLES IMPORTANTES:
- Chaque action doit etre sur sa propre ligne
- Les parametres doivent etre du JSON valide
- Tu peux mettre plusieurs actions dans une meme reponse
- Explique toujours POURQUOI tu suggeres chaque action
- Considere la charge de travail des vendeurs pour les assignations
- Priorise les deals a haute valeur
- Les relances rapides (<=3 jours) ont un meilleur taux de conversion — recommande-les
- Apprends des retours de l'utilisateur (memoire agent ci-dessous)

VENDEURS DISPONIBLES (IDs pour assignation): sylvain, fabien, claude, nathalie, keven, charles, olivier, sabra

${context}`;
    }

    // ===== COMMAND EXECUTION (original + enhanced) =====
    function executeCommand(text) {
        const lower = text.toLowerCase();

        // Send email to client
        if ((lower.includes('envoie') || lower.includes('envoyer')) && (lower.includes('courriel') || lower.includes('email') || lower.includes('contrat'))) {
            const nameMatch = text.match(/(?:a|a)\s+(.+?)(?:\s*$|\s+le|\s+un)/i);
            if (nameMatch) {
                const clientName = nameMatch[1].trim();
                const deals = Deals.getAll();
                const match = deals.find(d => d.clientName.toLowerCase().includes(clientName.toLowerCase()));
                if (match) {
                    if (lower.includes('contrat')) {
                        App.navigate('contracts');
                        setTimeout(() => {
                            Contracts.openCreateContract();
                            setTimeout(() => Contracts.selectContractDeal(match.id), 200);
                        }, 300);
                        return { type: 'action', message: `J'ouvre la creation de contrat pour ${match.clientName}.` };
                    } else {
                        App.openEmailCompose(match.id);
                        return { type: 'action', message: `J'ouvre le courriel pour ${match.clientName} (${match.clientEmail}).` };
                    }
                }
                return { type: 'info', message: `Je n'ai pas trouve de client "${clientName}". Verifiez le nom dans le pipeline.` };
            }
        }

        // Create SAV ticket
        if (lower.includes('ticket') || lower.includes('sav') || lower.includes('service apres') || lower.includes('probleme')) {
            if (lower.includes('creer') || lower.includes('ouvrir') || lower.includes('nouveau')) {
                App.navigate('sav');
                setTimeout(() => SAV.openNewTicket(), 300);
                return { type: 'action', message: "J'ouvre la creation de ticket SAV." };
            }
            App.navigate('sav');
            return { type: 'navigate', message: 'Voici la page SAV.' };
        }

        // Create task
        if ((lower.includes('creer') || lower.includes('ajouter')) && (lower.includes('tache') || lower.includes('task'))) {
            return { type: 'action', action: 'create_task', message: 'Je peux creer une tache. Dites-moi: pour qui, la description, et la date limite.' };
        }

        // Navigate
        if (lower.includes('pipeline') || lower.includes('kanban')) { App.navigate('pipeline'); return { type: 'navigate', message: 'Voici le pipeline.' }; }
        if (lower.includes('tableau de bord') || lower.includes('dashboard')) { App.navigate('dashboard'); return { type: 'navigate', message: 'Voici le tableau de bord.' }; }
        if (lower.includes('installation')) { App.navigate('installations'); return { type: 'navigate', message: 'Voici le calendrier des installations.' }; }
        if (lower.includes('repertoire') || lower.includes('contact') || lower.includes('annuaire')) { App.navigate('directory'); return { type: 'navigate', message: 'Voici le repertoire des contacts.' }; }
        if (lower.includes('rapport')) { App.navigate('reports'); return { type: 'navigate', message: 'Voici les rapports.' }; }
        if (lower.includes('contrat')) { App.navigate('contracts'); return { type: 'navigate', message: 'Voici les contrats.' }; }
        if (lower.includes('courriel') || lower.includes('email') || lower.includes('lead')) { App.navigate('emails'); return { type: 'navigate', message: 'Voici les courriels / leads.' }; }
        if (lower.includes('paiement')) { App.navigate('payments'); return { type: 'navigate', message: 'Voici les paiements.' }; }
        if (lower.includes('client')) { App.navigate('clients'); return { type: 'navigate', message: 'Voici les clients.' }; }

        // Open specific deal
        if (lower.includes('ouvrir') || lower.includes('chercher') || lower.includes('trouver')) {
            const nameMatch = text.match(/(?:ouvrir|chercher|trouver)\s+(.+)/i);
            if (nameMatch) {
                const search = nameMatch[1].trim().toLowerCase();
                const deal = Deals.getAll().find(d => d.clientName.toLowerCase().includes(search));
                if (deal) {
                    App.openDeal(deal.id);
                    return { type: 'action', message: `J'ouvre le deal de ${deal.clientName} — ${Deals.getStageName(deal.stage)}.` };
                }
                return { type: 'info', message: `Aucun deal trouve pour "${nameMatch[1]}".` };
            }
        }

        return null; // No command detected, use AI
    }

    // ===== ACTION EXECUTION FROM AI RESPONSE =====
    function parseActions(text) {
        const actionRegex = /\[ACTION:(\w+):([\s\S]*?)\]/g;
        const actions = [];
        let match;
        while ((match = actionRegex.exec(text)) !== null) {
            try {
                const type = match[1];
                const params = JSON.parse(match[2]);
                actions.push({ type, params, raw: match[0] });
            } catch (e) {
                console.warn('Failed to parse action:', match[0], e);
            }
        }
        return actions;
    }

    async function executeAction(action) {
        const { type, params } = action;
        let result = { success: false, message: '' };

        try {
            switch (type) {
                case 'create_deal': {
                    const dealData = {
                        clientName: params.clientName || 'Nouveau client',
                        clientPhone: params.clientPhone || params.phone || '',
                        clientEmail: params.clientEmail || params.email || '',
                        leadSource: params.leadSource || params.source || 'courriel',
                        clientType: params.clientType || 'regulier',
                        products: params.products || 'les-deux',
                        description: params.description || '',
                        assignedTo: params.assignedTo || params.vendeur || '',
                        leadDate: new Date().toISOString().split('T')[0],
                    };
                    const deal = await Deals.create(dealData);
                    addDecision({
                        type: 'create_deal',
                        params: dealData,
                        dealId: deal.id,
                    });
                    result = { success: true, message: `Deal cree: ${deal.clientName} (${deal.id})` };
                    if (typeof App !== 'undefined') App.showToast(result.message, 'success');
                    break;
                }

                case 'assign_deal': {
                    const deal = Deals.getById(params.dealId);
                    if (!deal) { result = { success: false, message: `Deal ${params.dealId} introuvable` }; break; }
                    await Deals.update(params.dealId, { assignedTo: params.vendeur });
                    const vendorName = Auth.getTeamMembers().find(m => m.id === params.vendeur)?.name || params.vendeur;
                    addDecision({
                        type: 'assign_deal',
                        dealId: params.dealId,
                        vendeur: params.vendeur,
                    });
                    result = { success: true, message: `${deal.clientName} assigne a ${vendorName}` };
                    if (typeof App !== 'undefined') App.showToast(result.message, 'success');
                    break;
                }

                case 'create_task': {
                    // Store task in localStorage (CRM_Tasks pattern)
                    const tasks = JSON.parse(localStorage.getItem('crm_tasks') || '[]');
                    const task = {
                        id: 'T' + Date.now(),
                        description: params.description,
                        assignedTo: params.assignedTo || '',
                        dealId: params.dealId || '',
                        deadline: params.deadline || '',
                        priority: params.priority || 'normal',
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                        createdBy: Auth.getUser()?.name || 'Agent IA',
                    };
                    tasks.push(task);
                    localStorage.setItem('crm_tasks', JSON.stringify(tasks));
                    // Also try SharePoint
                    if (!Auth.useLocalStorage()) {
                        try {
                            await Graph.createListItem('CRM_Tasks', {
                                DealId: task.dealId,
                                AssignedTo: task.assignedTo,
                                TaskDescription: task.description,
                                Deadline: task.deadline,
                                Priority: task.priority,
                                TaskStatus: 'pending',
                            });
                        } catch (e) { console.debug('Task SP sync failed:', e.message); }
                    }
                    // Add note on deal if linked
                    if (task.dealId && typeof Deals !== 'undefined') {
                        await Deals.addNote(task.dealId, `Tache creee par l'Agent IA: ${task.description}`, { type: 'task', icon: 'clipboard' });
                    }
                    addDecision({ type: 'create_task', params });
                    result = { success: true, message: `Tache creee: ${task.description}` };
                    if (typeof App !== 'undefined') App.showToast(result.message, 'success');
                    break;
                }

                case 'navigate': {
                    if (params.dealId) {
                        App.openDeal(params.dealId);
                        result = { success: true, message: `Deal ouvert: ${params.dealId}` };
                    } else if (params.view) {
                        App.navigate(params.view);
                        result = { success: true, message: `Navigation: ${params.view}` };
                    }
                    break;
                }

                case 'send_email': {
                    if (typeof App !== 'undefined' && App.openComposeEmail) {
                        App.openComposeEmail();
                        // Pre-fill would require DOM manipulation after modal opens
                        result = { success: true, message: `Composition de courriel ouverte pour ${params.to}` };
                    } else {
                        result = { success: false, message: 'Fonction courriel non disponible' };
                    }
                    break;
                }

                case 'send_reminder': {
                    const deal = Deals.getById(params.dealId);
                    if (!deal) { result = { success: false, message: `Deal ${params.dealId} introuvable` }; break; }
                    // Add a note as reminder
                    await Deals.addNote(params.dealId, `Rappel Agent IA: ${params.message}`, { type: 'reminder', icon: 'bell' });
                    await Deals.update(params.dealId, { lastFollowUp: new Date().toISOString().split('T')[0] });
                    addDecision({ type: 'send_reminder', dealId: params.dealId });
                    result = { success: true, message: `Rappel ajoute pour ${deal.clientName}` };
                    if (typeof App !== 'undefined') App.showToast(result.message, 'info');
                    break;
                }

                case 'move_stage': {
                    const deal = Deals.getById(params.dealId);
                    if (!deal) { result = { success: false, message: `Deal ${params.dealId} introuvable` }; break; }
                    const oldStage = deal.stage;
                    await Deals.update(params.dealId, { stage: parseInt(params.stage) });
                    addDecision({ type: 'move_stage', dealId: params.dealId, from: oldStage, to: params.stage });
                    result = { success: true, message: `${deal.clientName}: ${Deals.getStageName(oldStage)} -> ${Deals.getStageName(params.stage)}` };
                    if (typeof App !== 'undefined') App.showToast(result.message, 'success');
                    break;
                }

                case 'suggest_next': {
                    // Log suggestion as a decision for learning
                    addDecision({ type: 'suggest_next', dealId: params.dealId, suggestion: params.suggestion });
                    result = { success: true, message: params.suggestion };
                    break;
                }

                default:
                    result = { success: false, message: `Action inconnue: ${type}` };
            }
        } catch (e) {
            console.error('Action execution error:', e);
            result = { success: false, message: `Erreur: ${e.message}` };
        }

        return result;
    }

    // ===== AI RESPONSE =====
    async function getAIResponse(userMessage) {
        const apiKey = localStorage.getItem('crm_ai_apikey') || '';
        const provider = localStorage.getItem('crm_ai_provider') || 'anthropic';
        const model = localStorage.getItem('crm_ai_model') || 'claude-sonnet-4-20250514';

        if (!apiKey) {
            return `Aucune cle API configuree. Allez dans **Parametres -> Intelligence artificielle** pour ajouter votre cle API.

En attendant, voici ce que je peux faire sans IA:
* Tapez **"pipeline"** -> voir le pipeline
* Tapez **"dashboard"** -> tableau de bord
* Tapez **"installations"** -> calendrier
* Tapez **"sav"** -> service apres-vente
* Tapez **"contacts"** -> repertoire
* Tapez **"rapports"** -> rapports

Pour des questions sur vos donnees, ajoutez une cle API Claude ou OpenAI.`;
        }

        const context = getCRMContext();
        const systemPrompt = getSystemPrompt(context);

        try {
            if (provider === 'anthropic') {
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'anthropic-dangerous-direct-browser-access': 'true',
                    },
                    body: JSON.stringify({
                        model: model,
                        max_tokens: 2048,
                        system: systemPrompt,
                        messages: [
                            ...chatHistory.slice(-8).map(m => ({ role: m.role, content: m.content })),
                            { role: 'user', content: userMessage }
                        ],
                    }),
                });

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error?.message || `API error ${response.status}`);
                }

                const data = await response.json();
                return data.content?.[0]?.text || 'Desole, je n\'ai pas pu generer de reponse.';
            } else {
                // OpenAI
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: model || 'gpt-4o',
                        max_tokens: 2048,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...chatHistory.slice(-8).map(m => ({ role: m.role, content: m.content })),
                            { role: 'user', content: userMessage },
                        ],
                    }),
                });

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error?.message || `API error ${response.status}`);
                }

                const data = await response.json();
                return data.choices?.[0]?.message?.content || 'Desole, je n\'ai pas pu generer de reponse.';
            }
        } catch (e) {
            console.error('AI error:', e);
            return `Erreur API: ${e.message}\n\nVerifiez votre cle API dans Parametres -> IA.`;
        }
    }

    // ===== SEND MESSAGE =====
    async function sendMessage(text) {
        if (!text?.trim() || isProcessing) return;

        // Detect feedback in user message
        detectFeedback(text);

        // Add user message
        chatHistory.push({ role: 'user', content: text, time: new Date().toISOString() });
        renderMessages();
        saveHistory();

        isProcessing = true;
        renderTypingIndicator();

        try {
            // Check for direct commands first
            const cmd = executeCommand(text);
            let response;

            if (cmd) {
                response = cmd.message;
                if (cmd.action === 'create_sav') {
                    App.navigate('sav');
                    setTimeout(() => SAV.openNewTicket(), 300);
                }
            } else {
                // Use AI
                response = await getAIResponse(text);
            }

            // Parse and handle actions in the response
            const actions = parseActions(response);
            // Clean the response text (remove raw action tags, we'll render buttons)
            let cleanResponse = response;
            for (const action of actions) {
                cleanResponse = cleanResponse.replace(action.raw, '');
            }
            cleanResponse = cleanResponse.trim();

            // Store the full response with action metadata
            const msgData = {
                role: 'assistant',
                content: cleanResponse,
                time: new Date().toISOString(),
            };
            if (actions.length > 0) {
                msgData.actions = actions;
            }

            chatHistory.push(msgData);
            saveHistory();
        } catch (e) {
            chatHistory.push({ role: 'assistant', content: `Erreur: ${e.message}`, time: new Date().toISOString() });
        }

        isProcessing = false;
        renderMessages();
        scrollToBottom();
    }

    // ===== UI =====
    function createChatWidget() {
        // Floating button with badge
        const btn = document.createElement('button');
        btn.id = 'chatbot-toggle';
        btn.className = 'chatbot-toggle';
        btn.innerHTML = '<span class="chatbot-toggle-icon">&#x1F916;</span><span id="chatbot-badge" class="chatbot-badge" style="display:none">0</span>';
        btn.title = 'Agent IA CRM';
        btn.onclick = toggleChat;
        document.body.appendChild(btn);

        // Chat panel
        const panel = document.createElement('div');
        panel.id = 'chatbot-panel';
        panel.className = 'chatbot-panel hidden';
        panel.innerHTML = `
            <div class="chatbot-header">
                <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:20px">&#x1F916;</span>
                    <div>
                        <div style="font-weight:700;font-size:14px">Agent IA CRM</div>
                        <div id="chatbot-mode-label" style="font-size:11px;opacity:.7">${agentMode === 'agent' ? 'Mode Agent — Proactif' : 'Mode Assistant'}</div>
                    </div>
                </div>
                <div style="display:flex;gap:4px;align-items:center">
                    <button class="chatbot-header-btn chatbot-mode-toggle" id="chatbot-mode-btn" onclick="Chatbot.toggleMode()" title="Basculer le mode">
                        <span id="chatbot-mode-icon">${agentMode === 'agent' ? '&#x1F9E0;' : '&#x1F4AC;'}</span>
                    </button>
                    <button class="chatbot-header-btn" onclick="Chatbot.clearHistory()" title="Effacer l'historique">&#x1F5D1;&#xFE0F;</button>
                    <button class="chatbot-header-btn" onclick="Chatbot.toggleChat()" title="Fermer">&#x2715;</button>
                </div>
            </div>
            <div id="chatbot-quick-actions" class="chatbot-quick-actions">
                <button onclick="Chatbot.sendMessage('Resume du pipeline et suggestions')" title="Resume pipeline">&#x1F4CA; Pipeline</button>
                <button onclick="Chatbot.sendMessage('Quels deals necessitent attention?')" title="Deals urgents">&#x26A0;&#xFE0F; Urgents</button>
                <button onclick="Chatbot.sendMessage('Assigne les leads non-assignes')" title="Assigner leads">&#x1F465; Assigner</button>
                <button onclick="Chatbot.sendMessage('Analyse la performance des vendeurs')" title="Performance">&#x1F3C6; Vendeurs</button>
            </div>
            <div id="chatbot-alerts-bar" class="chatbot-alerts-bar" style="display:none"></div>
            <div class="chatbot-messages" id="chatbot-messages">
                <div class="chatbot-welcome">
                    <p style="font-size:24px">&#x1F916;</p>
                    <p><strong>Bonjour! Je suis l'Agent IA du CRM LGC.</strong></p>
                    <p style="font-size:13px;color:var(--text-muted)">Je surveille votre pipeline en continu et je peux agir pour vous.</p>
                    <div class="chatbot-suggestions">
                        <button onclick="Chatbot.sendMessage('Combien de deals actifs?')">&#x1F4CA; Deals actifs</button>
                        <button onclick="Chatbot.sendMessage('Quels deals sont en retard?')">&#x26A0;&#xFE0F; Deals en retard</button>
                        <button onclick="Chatbot.sendMessage('Resume du pipeline')">&#x1F504; Pipeline</button>
                        <button onclick="Chatbot.sendMessage('Tickets SAV ouverts')">&#x1F527; SAV ouvert</button>
                        <button onclick="Chatbot.sendMessage('Cree un nouveau deal pour un client')">&#x2795; Nouveau deal</button>
                        <button onclick="Chatbot.sendMessage('Quelles actions je devrais prendre aujourd hui?')">&#x1F4A1; Actions du jour</button>
                    </div>
                </div>
            </div>
            <div class="chatbot-input-area">
                <input type="text" id="chatbot-input" class="chatbot-input" placeholder="Posez une question ou donnez une instruction..." autocomplete="off">
                <button id="chatbot-send" class="chatbot-send" onclick="Chatbot.handleSend()">&#x27A4;</button>
            </div>
        `;
        document.body.appendChild(panel);

        // Enter key handler
        panel.querySelector('#chatbot-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') Chatbot.handleSend();
        });

        // Inject CSS for new features
        injectAgentStyles();
    }

    function injectAgentStyles() {
        if (document.getElementById('chatbot-agent-styles')) return;
        const style = document.createElement('style');
        style.id = 'chatbot-agent-styles';
        style.textContent = `
            /* Badge */
            .chatbot-badge {
                position: absolute;
                top: -4px;
                right: -4px;
                background: #ef4444;
                color: white;
                font-size: 11px;
                font-weight: 700;
                min-width: 18px;
                height: 18px;
                border-radius: 9px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0 4px;
                box-shadow: 0 2px 6px rgba(239,68,68,.4);
                z-index: 10;
            }

            /* Pulsing alert indicator */
            .chatbot-has-alerts {
                animation: chatbot-pulse 2s ease-in-out infinite;
            }
            @keyframes chatbot-pulse {
                0%, 100% { box-shadow: 0 4px 15px rgba(178, 34, 52, 0.3); }
                50% { box-shadow: 0 4px 25px rgba(239, 68, 68, 0.6), 0 0 0 8px rgba(239, 68, 68, 0.1); }
            }

            /* Quick actions bar */
            .chatbot-quick-actions {
                display: flex;
                gap: 4px;
                padding: 6px 10px;
                background: var(--bg-secondary, #f8fafc);
                border-bottom: 1px solid var(--border, #e2e8f0);
                overflow-x: auto;
                flex-shrink: 0;
            }
            .chatbot-quick-actions button {
                background: var(--bg-primary, white);
                border: 1px solid var(--border, #e2e8f0);
                border-radius: 14px;
                padding: 4px 10px;
                font-size: 11px;
                white-space: nowrap;
                cursor: pointer;
                color: var(--text-primary, #1e293b);
                transition: all .15s;
            }
            .chatbot-quick-actions button:hover {
                background: var(--accent, #B22234);
                color: white;
                border-color: var(--accent, #B22234);
            }

            /* Alerts bar */
            .chatbot-alerts-bar {
                background: linear-gradient(135deg, #fef3c7, #fde68a);
                border-bottom: 1px solid #f59e0b;
                padding: 8px 12px;
                font-size: 12px;
                cursor: pointer;
                flex-shrink: 0;
                max-height: 120px;
                overflow-y: auto;
            }
            .chatbot-alerts-bar .alert-item {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 0;
                border-bottom: 1px solid rgba(245, 158, 11, 0.2);
            }
            .chatbot-alerts-bar .alert-item:last-child { border-bottom: none; }
            .chatbot-alerts-bar .alert-severity-high { color: #dc2626; font-weight: 600; }
            .chatbot-alerts-bar .alert-severity-medium { color: #d97706; }
            .chatbot-alerts-bar .alert-action-btn {
                margin-left: auto;
                background: #f59e0b;
                color: white;
                border: none;
                border-radius: 10px;
                padding: 2px 8px;
                font-size: 10px;
                font-weight: 600;
                cursor: pointer;
                white-space: nowrap;
            }
            .chatbot-alerts-bar .alert-action-btn:hover {
                background: #d97706;
            }

            /* Mode toggle */
            .chatbot-mode-toggle {
                font-size: 16px !important;
                transition: transform .2s;
            }
            .chatbot-mode-toggle:hover { transform: scale(1.15); }

            /* Action buttons in messages */
            .chatbot-action-card {
                background: var(--bg-secondary, #f0f9ff);
                border: 1px solid var(--border, #bae6fd);
                border-radius: 8px;
                padding: 8px 12px;
                margin-top: 8px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .chatbot-action-card .action-desc {
                flex: 1;
                font-size: 12px;
                color: var(--text-secondary, #475569);
            }
            .chatbot-action-btn-exec {
                background: #22c55e;
                color: white;
                border: none;
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                white-space: nowrap;
                transition: background .15s;
            }
            .chatbot-action-btn-exec:hover { background: #16a34a; }
            .chatbot-action-btn-exec:disabled {
                background: #94a3b8;
                cursor: not-allowed;
            }
            .chatbot-action-btn-exec.executed {
                background: #64748b;
            }

            /* Suggestion cards */
            .chatbot-suggestion-card {
                background: linear-gradient(135deg, var(--bg-secondary, #f8fafc), var(--bg-primary, white));
                border: 1px solid var(--border, #e2e8f0);
                border-left: 3px solid var(--accent, #B22234);
                border-radius: 6px;
                padding: 10px 12px;
                margin-top: 6px;
                font-size: 13px;
            }
            .chatbot-suggestion-card .suggestion-title {
                font-weight: 600;
                font-size: 12px;
                color: var(--accent, #B22234);
                margin-bottom: 4px;
            }

            /* Toggle icon positioning */
            .chatbot-toggle { position: relative; }
            .chatbot-toggle-icon { font-size: 24px; line-height: 1; }
        `;
        document.head.appendChild(style);
    }

    function toggleChat() {
        isOpen = !isOpen;
        const panel = document.getElementById('chatbot-panel');
        const btn = document.getElementById('chatbot-toggle');
        if (isOpen) {
            panel?.classList.remove('hidden');
            btn?.classList.add('active');
            document.getElementById('chatbot-input')?.focus();
            renderAlertBar();
            renderMessages();
            scrollToBottom();
            // Clear badge glow when opened
            btn?.classList.remove('chatbot-has-alerts');
        } else {
            panel?.classList.add('hidden');
            btn?.classList.remove('active');
        }
    }

    function toggleMode() {
        agentMode = agentMode === 'agent' ? 'assistant' : 'agent';
        localStorage.setItem(MODE_KEY, agentMode);
        const label = document.getElementById('chatbot-mode-label');
        const icon = document.getElementById('chatbot-mode-icon');
        if (label) label.textContent = agentMode === 'agent' ? 'Mode Agent — Proactif' : 'Mode Assistant';
        if (icon) icon.innerHTML = agentMode === 'agent' ? '&#x1F9E0;' : '&#x1F4AC;';
        if (typeof App !== 'undefined') {
            App.showToast(agentMode === 'agent' ? 'Mode Agent actif — suggestions proactives' : 'Mode Assistant actif — repond aux questions', 'info');
        }
    }

    function handleSend() {
        const input = document.getElementById('chatbot-input');
        const text = input?.value?.trim();
        if (text) {
            input.value = '';
            sendMessage(text);
        }
    }

    function renderAlertBar() {
        const bar = document.getElementById('chatbot-alerts-bar');
        if (!bar) return;

        if (proactiveAlerts.length === 0 || agentMode !== 'agent') {
            bar.style.display = 'none';
            return;
        }

        bar.style.display = 'block';
        const top5 = proactiveAlerts.slice(0, 5);
        bar.innerHTML = `
            <div style="font-weight:600;font-size:11px;color:#92400e;margin-bottom:4px">
                &#x1F514; ${proactiveAlerts.length} alerte(s) proactive(s)
            </div>
            ${top5.map((a, idx) => `
                <div class="alert-item">
                    <span class="alert-severity-${a.severity}">${a.severity === 'high' ? '&#x1F534;' : '&#x1F7E0;'}</span>
                    <span style="flex:1;font-size:11px">${escapeHTML(a.title)}</span>
                    <button class="alert-action-btn" onclick="Chatbot.executeAlertAction(${idx})">${escapeHTML(a.actionLabel)}</button>
                </div>
            `).join('')}
        `;
    }

    function executeAlertAction(index) {
        const alert = proactiveAlerts[index];
        if (!alert || !alert.action) return;

        const fakeAction = { type: alert.action.type, params: alert.action.params };
        executeAction(fakeAction).then(result => {
            if (result.success && typeof App !== 'undefined') {
                App.showToast(result.message, 'success');
            }
            // Remove this alert after execution
            proactiveAlerts.splice(index, 1);
            updateBadge();
            renderAlertBar();
        });
    }

    function renderMessages() {
        const container = document.getElementById('chatbot-messages');
        if (!container) return;

        if (chatHistory.length === 0) return; // Keep welcome screen

        container.innerHTML = chatHistory.map((msg, msgIdx) => {
            const isUser = msg.role === 'user';
            const time = msg.time ? new Date(msg.time).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '';

            let actionsHTML = '';
            if (msg.actions && msg.actions.length > 0) {
                actionsHTML = msg.actions.map((action, actionIdx) => {
                    const desc = getActionDescription(action);
                    const executed = action.executed;
                    return `
                        <div class="chatbot-action-card">
                            <div class="action-desc">${escapeHTML(desc)}</div>
                            <button class="chatbot-action-btn-exec ${executed ? 'executed' : ''}"
                                    ${executed ? 'disabled' : ''}
                                    onclick="Chatbot.executeMessageAction(${msgIdx}, ${actionIdx})">
                                ${executed ? '&#x2705; Fait' : '&#x25B6;&#xFE0F; Executer'}
                            </button>
                        </div>
                    `;
                }).join('');
            }

            return `
                <div class="chatbot-msg ${isUser ? 'chatbot-msg-user' : 'chatbot-msg-bot'}">
                    <div class="chatbot-msg-content">${formatMessage(msg.content)}</div>
                    ${actionsHTML}
                    <div class="chatbot-msg-time">${time}</div>
                </div>
            `;
        }).join('');
    }

    function getActionDescription(action) {
        const { type, params } = action;
        switch (type) {
            case 'create_deal': return `Creer un deal: ${params.clientName || 'nouveau client'}`;
            case 'assign_deal': {
                const vendorName = (typeof Auth !== 'undefined')
                    ? (Auth.getTeamMembers().find(m => m.id === params.vendeur)?.name || params.vendeur)
                    : params.vendeur;
                return `Assigner ${params.dealId} a ${vendorName}`;
            }
            case 'create_task': return `Creer tache: ${params.description || ''}`;
            case 'navigate': return params.dealId ? `Ouvrir deal ${params.dealId}` : `Naviguer: ${params.view}`;
            case 'send_email': return `Envoyer courriel a ${params.to}`;
            case 'send_reminder': return `Rappel pour deal ${params.dealId}`;
            case 'move_stage': return `Deplacer ${params.dealId} a l'etape ${params.stage}`;
            case 'suggest_next': return `Suggestion: ${params.suggestion || ''}`;
            default: return `Action: ${type}`;
        }
    }

    async function executeMessageAction(msgIdx, actionIdx) {
        const msg = chatHistory[msgIdx];
        if (!msg || !msg.actions || !msg.actions[actionIdx]) return;

        const action = msg.actions[actionIdx];
        if (action.executed) return;

        const result = await executeAction(action);

        // Mark as executed
        action.executed = true;
        action.result = result;
        saveHistory();
        renderMessages();
        scrollToBottom();

        // Post execution feedback in chat
        if (result.success) {
            chatHistory.push({
                role: 'assistant',
                content: `Action executee: ${result.message}`,
                time: new Date().toISOString(),
            });
        } else {
            chatHistory.push({
                role: 'assistant',
                content: `Echec de l'action: ${result.message}`,
                time: new Date().toISOString(),
            });
        }
        saveHistory();
        renderMessages();
        scrollToBottom();
    }

    function renderTypingIndicator() {
        const container = document.getElementById('chatbot-messages');
        if (!container) return;
        const existing = container.querySelector('.chatbot-typing');
        if (existing) return;
        const div = document.createElement('div');
        div.className = 'chatbot-msg chatbot-msg-bot chatbot-typing';
        div.innerHTML = '<div class="chatbot-msg-content"><span class="chatbot-dots">&#x25CF;&#x25CF;&#x25CF;</span></div>';
        container.appendChild(div);
        scrollToBottom();
    }

    function scrollToBottom() {
        const container = document.getElementById('chatbot-messages');
        if (container) container.scrollTop = container.scrollHeight;
    }

    function formatMessage(text) {
        if (!text) return '';
        // Basic markdown-like formatting
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>')
            .replace(/• /g, '&bull; ')
            .replace(/^- /gm, '&bull; ');
    }

    function escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function clearHistory() {
        chatHistory = [];
        saveHistory();
        const container = document.getElementById('chatbot-messages');
        if (container) {
            container.innerHTML = `
                <div class="chatbot-welcome">
                    <p style="font-size:20px">&#x1F916;</p>
                    <p><strong>Historique efface.</strong></p>
                    <p style="font-size:13px;color:var(--text-muted)">Posez-moi une nouvelle question!</p>
                </div>
            `;
        }
    }

    function clearMemory() {
        agentMemory = { patterns: [], decisions: [], feedback: [] };
        saveMemory();
        if (typeof App !== 'undefined') App.showToast('Memoire de l\'agent effacee', 'info');
    }

    // ===== PUBLIC API =====
    return {
        init,
        toggleChat,
        toggleMode,
        sendMessage,
        handleSend,
        clearHistory,
        clearMemory,
        executeMessageAction,
        executeAlertAction,
        // Expose for external integrations
        getProactiveAlerts: () => proactiveAlerts,
        getAgentMemory: () => agentMemory,
        getVendorWorkload,
        runBackgroundCheck,
        addPattern,
        addFeedback,
    };
})();
