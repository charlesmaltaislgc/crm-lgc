// ===== CRM LGC - Module de suivi des erreurs =====
// Capture les erreurs non gérées, les log dans localStorage et optionnellement dans SharePoint

const ErrorTracker = (() => {
    const STORAGE_KEY = 'crm_error_log';
    const MAX_ERRORS = 100;
    const DISPLAY_LIMIT = 50;
    const SHAREPOINT_LIST = 'CRM_ErrorLog';

    let initialized = false;
    let originalConsoleError = null;

    // ===== INITIALISATION =====
    function init() {
        if (initialized) return;
        initialized = true;

        // Intercepter console.error
        originalConsoleError = console.error.bind(console);
        console.error = (...args) => {
            originalConsoleError(...args);
            const message = args.map(a => {
                try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                catch { return String(a); }
            }).join(' ');
            logError({ message, source: 'console.error' });
        };

        // Erreurs globales non gérées
        window.onerror = (message, url, line, col, error) => {
            logError({
                message: String(message),
                stack: error?.stack || '',
                url: url || '',
                line: line || 0,
                col: col || 0,
                source: 'window.onerror'
            });
        };

        // Promesses rejetées non gérées
        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            logError({
                message: reason?.message || String(reason),
                stack: reason?.stack || '',
                source: 'unhandledrejection'
            });
        });

        console.log('[ErrorTracker] Module initialisé');
    }

    // ===== ENREGISTRER UNE ERREUR =====
    function logError(info) {
        try {
            const entry = {
                timestamp: new Date().toISOString(),
                message: info.message || 'Erreur inconnue',
                stack: info.stack || '',
                url: info.url || window.location.href,
                line: info.line || 0,
                col: info.col || 0,
                userAgent: navigator.userAgent,
                user: _getUser(),
                view: _getCurrentView(),
                source: info.source || 'unknown'
            };

            // Sauvegarder dans localStorage
            const errors = getErrors();
            errors.push(entry);
            // Garder seulement les dernières MAX_ERRORS entrées
            while (errors.length > MAX_ERRORS) errors.shift();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(errors));

            // Mettre à jour le badge
            updateBadge();

            // Auto-report vers SharePoint si disponible
            _reportToSharePoint(entry);
        } catch (e) {
            // Éviter les boucles infinies
            if (originalConsoleError) originalConsoleError('[ErrorTracker] Erreur lors du logging:', e);
        }
    }

    // ===== RÉCUPÉRER LES ERREURS =====
    function getErrors() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch {
            return [];
        }
    }

    // ===== ERREURS DES DERNIÈRES 24H =====
    function getRecentErrors() {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        return getErrors().filter(e => e.timestamp > cutoff);
    }

    // ===== METTRE À JOUR LE BADGE PARAMÈTRES =====
    function updateBadge() {
        const recentCount = getRecentErrors().length;
        const settingsLink = document.querySelector('[data-view="settings"]');
        if (!settingsLink) return;

        let badge = settingsLink.querySelector('.badge-errors');
        if (recentCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'badge badge-danger badge-errors';
                badge.style.cssText = 'background:#ef4444;color:#fff;border-radius:50%;font-size:10px;min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;margin-left:4px;';
                settingsLink.appendChild(badge);
            }
            badge.textContent = recentCount > 99 ? '99+' : recentCount;
            badge.classList.remove('hidden');
        } else if (badge) {
            badge.classList.add('hidden');
        }
    }

    // ===== EFFACER LES ERREURS =====
    function clearErrors() {
        localStorage.removeItem(STORAGE_KEY);
        updateBadge();
    }

    // ===== EXPORTER EN JSON =====
    function exportErrors() {
        const errors = getErrors();
        const blob = new Blob([JSON.stringify(errors, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crm-errors-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ===== PANNEAU UI DANS PARAMÈTRES =====
    function renderPanel() {
        const errors = getErrors().slice(-DISPLAY_LIMIT).reverse();
        const recentCount = getRecentErrors().length;

        return `
            <div class="card" style="margin-top:20px;">
                <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;">🐛 Journal des erreurs ${recentCount > 0 ? `<span style="color:#ef4444;font-size:13px;">(${recentCount} dans les dernières 24h)</span>` : ''}</h3>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-sm btn-outline" onclick="ErrorTracker.exportErrors()">📥 Exporter JSON</button>
                        <button class="btn btn-sm btn-danger" onclick="ErrorTracker.clearErrors(); App.navigateTo('settings');">🗑️ Effacer tout</button>
                    </div>
                </div>
                <div class="card-body" style="max-height:500px;overflow-y:auto;">
                    ${errors.length === 0 ? '<p style="color:#64748b;text-align:center;padding:20px;">Aucune erreur enregistrée ✅</p>' : ''}
                    ${errors.map(e => `
                        <div style="border-bottom:1px solid #e2e8f0;padding:10px 0;font-size:13px;">
                            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                                <strong style="color:#ef4444;">${_escapeHtml(e.message?.substring(0, 120))}</strong>
                                <span style="color:#94a3b8;font-size:11px;white-space:nowrap;margin-left:8px;">${_formatDate(e.timestamp)}</span>
                            </div>
                            <div style="color:#64748b;font-size:11px;">
                                <span>👤 ${_escapeHtml(e.user || 'N/A')}</span> |
                                <span>📍 ${_escapeHtml(e.view || 'N/A')}</span> |
                                <span>📄 ${_escapeHtml(e.source || 'N/A')}</span>
                                ${e.line ? ` | <span>L${e.line}:${e.col}</span>` : ''}
                            </div>
                            ${e.stack ? `<details style="margin-top:4px;"><summary style="cursor:pointer;color:#94a3b8;font-size:11px;">Stack trace</summary><pre style="font-size:10px;background:#1e293b;color:#e2e8f0;padding:8px;border-radius:4px;overflow-x:auto;margin-top:4px;">${_escapeHtml(e.stack)}</pre></details>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // ===== HELPERS PRIVÉS =====

    function _getUser() {
        try {
            return typeof Auth !== 'undefined' && Auth.getUser ? Auth.getUser()?.name || '' : '';
        } catch { return ''; }
    }

    function _getCurrentView() {
        try {
            return typeof App !== 'undefined' && App.getCurrentView ? App.getCurrentView() : '';
        } catch { return ''; }
    }

    function _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function _formatDate(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('fr-CA') + ' ' + d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
        } catch { return iso; }
    }

    async function _reportToSharePoint(entry) {
        try {
            // Vérifier si Graph API disponible et pas en mode démo
            if (typeof Graph === 'undefined' || !Graph.isConnected || !Graph.isConnected()) return;
            if (typeof Auth !== 'undefined' && Auth.isDemo && Auth.isDemo()) return;

            const siteId = typeof Graph !== 'undefined' && Graph.getSiteId ? Graph.getSiteId() : null;
            if (!siteId) return;

            // Créer l'entrée dans la liste SharePoint
            await Graph.request(`/sites/${siteId}/lists/${SHAREPOINT_LIST}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fields: {
                        Title: entry.message.substring(0, 255),
                        Timestamp: entry.timestamp,
                        Message: entry.message.substring(0, 1000),
                        Stack: (entry.stack || '').substring(0, 2000),
                        User: entry.user || '',
                        View: entry.view || ''
                    }
                })
            });
        } catch {
            // Silencieux - ne pas créer de boucle d'erreurs
        }
    }

    // ===== API PUBLIQUE =====
    return {
        init,
        logError,
        getErrors,
        getRecentErrors,
        clearErrors,
        exportErrors,
        renderPanel,
        updateBadge
    };
})();
