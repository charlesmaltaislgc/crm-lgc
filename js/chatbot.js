// ===== CRM LGC - Chatbot IA Module =====
// AI assistant to query CRM data and assign tasks

const Chatbot = (() => {
    const HISTORY_KEY = 'crm_chat_history';
    let chatHistory = [];
    let isOpen = false;
    let isProcessing = false;

    function init() {
        createChatWidget();
        loadHistory();
    }

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

        return `
CONTEXTE CRM LGC — ${today}
Utilisateur: ${user?.name} (${user?.role})
Équipe: ${team.map(m => `${m.name} (${m.role})`).join(', ')}

PIPELINE:
- Deals actifs: ${active.length} (valeur: ${active.reduce((s,d) => s + (d.quoteAmount||d.contractAmount||0), 0).toLocaleString('fr-CA')}$)
- Deals gagnés: ${won.length}
- Deals perdus: ${lost.length}
${Object.entries(stages).map(([name, data]) => `  • ${name}: ${data.count} deals (${data.value.toLocaleString('fr-CA')}$)`).join('\n')}

ALERTES:
- ${overdue.length} deals en retard (soumission > 5 jours)
${overdue.slice(0, 5).map(d => `  ⚠️ ${d.clientName} — lead du ${d.leadDate}, pas de soumission`).join('\n')}

SAV:
- Tickets ouverts: ${savStats.open || 0}
- Résolus: ${savStats.resolved || 0}
- Délai moyen: ${savStats.avgResolution || 0} jours
${savTickets.filter(t => !['resolved','closed'].includes(t.status)).slice(0, 5).map(t => `  🔧 ${t.id}: ${t.clientName} — ${t.problemType} (${t.status})`).join('\n')}

DEALS RÉCENTS:
${recentDeals.map(d => `  ${d.status === 'active' ? '🔄' : d.status === 'won' ? '✅' : '❌'} ${d.client} — ${d.stage} — ${d.montant.toLocaleString('fr-CA')}$`).join('\n')}
`.trim();
    }

    // ===== COMMAND EXECUTION =====
    function executeCommand(text) {
        const lower = text.toLowerCase();

        // Create task
        if (lower.includes('créer') && (lower.includes('tâche') || lower.includes('task'))) {
            return { type: 'action', action: 'create_task', message: 'Je peux créer une tâche. Dites-moi: pour qui, la description, et la date limite.' };
        }

        // Create SAV ticket
        if (lower.includes('ticket') && (lower.includes('sav') || lower.includes('service') || lower.includes('problème') || lower.includes('plainte'))) {
            return { type: 'action', action: 'create_sav', message: 'Naviguer vers la page SAV pour créer un ticket.' };
        }

        // Navigate
        if (lower.includes('pipeline') || lower.includes('kanban')) {
            App.navigate('pipeline');
            return { type: 'navigate', message: 'Voici le pipeline.' };
        }
        if (lower.includes('tableau de bord') || lower.includes('dashboard')) {
            App.navigate('dashboard');
            return { type: 'navigate', message: 'Voici le tableau de bord.' };
        }
        if (lower.includes('installation')) {
            App.navigate('installations');
            return { type: 'navigate', message: 'Voici le calendrier des installations.' };
        }
        if (lower.includes('sav') || lower.includes('service après')) {
            App.navigate('sav');
            return { type: 'navigate', message: 'Voici la page SAV.' };
        }
        if (lower.includes('répertoire') || lower.includes('contact') || lower.includes('annuaire')) {
            App.navigate('directory');
            return { type: 'navigate', message: 'Voici le répertoire des contacts.' };
        }
        if (lower.includes('rapport')) {
            App.navigate('reports');
            return { type: 'navigate', message: 'Voici les rapports.' };
        }

        return null; // No command detected, use AI
    }

    // ===== AI RESPONSE =====
    async function getAIResponse(userMessage) {
        const apiKey = localStorage.getItem('crm_ai_apikey') || '';
        const provider = localStorage.getItem('crm_ai_provider') || 'anthropic';
        const model = localStorage.getItem('crm_ai_model') || 'claude-sonnet-4-20250514';

        if (!apiKey) {
            return `⚠️ Aucune clé API configurée. Allez dans **Paramètres → Intelligence artificielle** pour ajouter votre clé API.

En attendant, voici ce que je peux faire sans IA:
• Tapez **"pipeline"** → voir le pipeline
• Tapez **"dashboard"** → tableau de bord
• Tapez **"installations"** → calendrier
• Tapez **"sav"** → service après-vente
• Tapez **"contacts"** → répertoire
• Tapez **"rapports"** → rapports

Pour des questions sur vos données, ajoutez une clé API Claude ou OpenAI.`;
        }

        const context = getCRMContext();
        const recentChat = chatHistory.slice(-6).map(m => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`).join('\n');

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
                        max_tokens: 1024,
                        system: `Tu es l'assistant IA du CRM de Portes et Fenêtres LGC, une entreprise de portes et fenêtres au Québec. Tu parles en français québécois professionnel. Tu as accès aux données du CRM ci-dessous. Réponds de façon concise et utile. Si on te demande de faire une action (créer tâche, naviguer), indique comment le faire dans le CRM.\n\n${context}`,
                        messages: [
                            ...chatHistory.slice(-6).map(m => ({ role: m.role, content: m.content })),
                            { role: 'user', content: userMessage }
                        ],
                    }),
                });

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error?.message || `API error ${response.status}`);
                }

                const data = await response.json();
                return data.content?.[0]?.text || 'Désolé, je n\'ai pas pu générer de réponse.';
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
                        max_tokens: 1024,
                        messages: [
                            { role: 'system', content: `Tu es l'assistant IA du CRM de Portes et Fenêtres LGC, une entreprise de portes et fenêtres au Québec. Tu parles en français québécois professionnel. Tu as accès aux données du CRM ci-dessous. Réponds de façon concise et utile.\n\n${context}` },
                            ...chatHistory.slice(-6).map(m => ({ role: m.role, content: m.content })),
                            { role: 'user', content: userMessage },
                        ],
                    }),
                });

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error?.message || `API error ${response.status}`);
                }

                const data = await response.json();
                return data.choices?.[0]?.message?.content || 'Désolé, je n\'ai pas pu générer de réponse.';
            }
        } catch (e) {
            console.error('AI error:', e);
            return `❌ Erreur API: ${e.message}\n\nVérifiez votre clé API dans Paramètres → IA.`;
        }
    }

    // ===== SEND MESSAGE =====
    async function sendMessage(text) {
        if (!text?.trim() || isProcessing) return;

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

            chatHistory.push({ role: 'assistant', content: response, time: new Date().toISOString() });
            saveHistory();
        } catch (e) {
            chatHistory.push({ role: 'assistant', content: `❌ Erreur: ${e.message}`, time: new Date().toISOString() });
        }

        isProcessing = false;
        renderMessages();
        scrollToBottom();
    }

    // ===== UI =====
    function createChatWidget() {
        // Floating button
        const btn = document.createElement('button');
        btn.id = 'chatbot-toggle';
        btn.className = 'chatbot-toggle';
        btn.innerHTML = '🤖';
        btn.title = 'Assistant IA CRM';
        btn.onclick = toggleChat;
        document.body.appendChild(btn);

        // Chat panel
        const panel = document.createElement('div');
        panel.id = 'chatbot-panel';
        panel.className = 'chatbot-panel hidden';
        panel.innerHTML = `
            <div class="chatbot-header">
                <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:20px">🤖</span>
                    <div>
                        <div style="font-weight:700;font-size:14px">Assistant CRM</div>
                        <div style="font-size:11px;opacity:.7">Posez vos questions sur le CRM</div>
                    </div>
                </div>
                <div style="display:flex;gap:4px">
                    <button class="chatbot-header-btn" onclick="Chatbot.clearHistory()" title="Effacer l'historique">🗑️</button>
                    <button class="chatbot-header-btn" onclick="Chatbot.toggleChat()" title="Fermer">✕</button>
                </div>
            </div>
            <div class="chatbot-messages" id="chatbot-messages">
                <div class="chatbot-welcome">
                    <p style="font-size:20px">🤖</p>
                    <p><strong>Bonjour! Je suis l'assistant CRM LGC.</strong></p>
                    <p style="font-size:13px;color:var(--text-muted)">Posez-moi des questions sur vos deals, clients, pipeline, SAV, etc.</p>
                    <div class="chatbot-suggestions">
                        <button onclick="Chatbot.sendMessage('Combien de deals actifs?')">📊 Deals actifs</button>
                        <button onclick="Chatbot.sendMessage('Quels deals sont en retard?')">⚠️ Deals en retard</button>
                        <button onclick="Chatbot.sendMessage('Résumé du pipeline')">🔄 Pipeline</button>
                        <button onclick="Chatbot.sendMessage('Tickets SAV ouverts')">🔧 SAV ouvert</button>
                        <button onclick="Chatbot.sendMessage('Montre-moi les installations')">🏗️ Installations</button>
                    </div>
                </div>
            </div>
            <div class="chatbot-input-area">
                <input type="text" id="chatbot-input" class="chatbot-input" placeholder="Posez une question ou donnez une tâche..." autocomplete="off">
                <button id="chatbot-send" class="chatbot-send" onclick="Chatbot.handleSend()">➤</button>
            </div>
        `;
        document.body.appendChild(panel);

        // Enter key handler
        panel.querySelector('#chatbot-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') Chatbot.handleSend();
        });
    }

    function toggleChat() {
        isOpen = !isOpen;
        const panel = document.getElementById('chatbot-panel');
        const btn = document.getElementById('chatbot-toggle');
        if (isOpen) {
            panel?.classList.remove('hidden');
            btn?.classList.add('active');
            document.getElementById('chatbot-input')?.focus();
            renderMessages();
            scrollToBottom();
        } else {
            panel?.classList.add('hidden');
            btn?.classList.remove('active');
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

    function renderMessages() {
        const container = document.getElementById('chatbot-messages');
        if (!container) return;

        if (chatHistory.length === 0) return; // Keep welcome screen

        container.innerHTML = chatHistory.map(msg => {
            const isUser = msg.role === 'user';
            const time = msg.time ? new Date(msg.time).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '';
            return `
                <div class="chatbot-msg ${isUser ? 'chatbot-msg-user' : 'chatbot-msg-bot'}">
                    <div class="chatbot-msg-content">${formatMessage(msg.content)}</div>
                    <div class="chatbot-msg-time">${time}</div>
                </div>
            `;
        }).join('');
    }

    function renderTypingIndicator() {
        const container = document.getElementById('chatbot-messages');
        if (!container) return;
        // Add typing indicator
        const existing = container.querySelector('.chatbot-typing');
        if (existing) return;
        const div = document.createElement('div');
        div.className = 'chatbot-msg chatbot-msg-bot chatbot-typing';
        div.innerHTML = '<div class="chatbot-msg-content"><span class="chatbot-dots">●●●</span></div>';
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

    function clearHistory() {
        chatHistory = [];
        saveHistory();
        const container = document.getElementById('chatbot-messages');
        if (container) {
            container.innerHTML = `
                <div class="chatbot-welcome">
                    <p style="font-size:20px">🤖</p>
                    <p><strong>Historique effacé.</strong></p>
                    <p style="font-size:13px;color:var(--text-muted)">Posez-moi une nouvelle question!</p>
                </div>
            `;
        }
    }

    return {
        init,
        toggleChat,
        sendMessage,
        handleSend,
        clearHistory,
    };
})();
