// ===== CRM LGC - Authentication Module =====
// Handles M365 login via MSAL.js and demo mode

const Auth = (() => {
    let msalInstance = null;
    let currentUser = null;
    let isDemo = false;

    // MSAL config - Portes et Fenêtres LGC Azure AD App
    const getConfig = () => {
        const clientId = localStorage.getItem('crm_clientId') || '1f609af8-79c7-410d-8540-050efc9e08cc';
        const tenantId = localStorage.getItem('crm_tenantId') || '287a70f9-e3d2-4102-bb0e-3296726fcb3a';
        return {
            auth: {
                clientId: clientId,
                authority: `https://login.microsoftonline.com/${tenantId || 'common'}`,
                redirectUri: window.location.origin + window.location.pathname,
            },
            cache: {
                cacheLocation: 'localStorage',
                storeAuthStateInCookie: false,
            }
        };
    };

    // All scopes including shared mailbox (admin consent granted 2026-04-05)
    const scopes = [
        'User.Read',
        'Sites.ReadWrite.All',
        'Mail.ReadWrite',
        'Mail.ReadWrite.Shared',
        'Mail.Send',
        'Mail.Send.Shared',
        'Calendars.ReadWrite'
    ];

    // Équipe LGC
    const demoUsers = [
        { id: 'charles',  name: 'Charles Maltais',     email: 'charles.maltais@pflgc.com', emails: ['charles.maltais@pflgc.com','soumission@pflgc.com','lgc@pflgc.com'], role: 'directeur',    initials: 'CM', phone: '(418) 549-7837 p.221', phone2: '(418) 590-9529' },
        { id: 'olivier',  name: 'Olivier Maltais',     email: 'olivier.maltais@pflgc.com',  role: 'directeur',    initials: 'OM', phone: '(418) 549-7837 p.222', phone2: '' },
        { id: 'keven',    name: 'Keven Gaudreault',    email: 'keven.gaudreault@pflgc.com', role: 'directeur',    initials: 'KG', phone: '(418) 549-7837 p.223', phone2: '' },
        { id: 'sabra',    name: 'Sabra Msellem',       email: 'sabra@pflgc.com',            emails: ['sabra@pflgc.com','comptabilite@pflgc.com'], role: 'directeur', initials: 'SM', phone: '(418) 549-7837 p.224', phone2: '' },
        { id: 'sylvain',  name: 'Sylvain Fillion',     email: 'sylvain.fillion@pflgc.com',  role: 'vendeur',      initials: 'SF', phone: '(418) 549-7837 p.225', phone2: '' },
        { id: 'fabien',   name: 'Fabien Duchossoy',    email: 'fabien@pflgc.com',           role: 'vendeur',      initials: 'FD', phone: '(418) 549-7837 p.226', phone2: '' },
        { id: 'claude',   name: 'Claude Amiot',        email: 'claude.amiot@pflgc.com',     role: 'vendeur',      initials: 'CA', phone: '(418) 549-7837 p.227', phone2: '' },
        { id: 'nathalie', name: 'Nathalie Tremblay',   email: 'nathalie.tremblay@pflgc.com',role: 'vendeur',      initials: 'NT', phone: '(418) 549-7837 p.228', phone2: '' },
        { id: 'alain',    name: 'Alain Verreault',     email: 'alain.verreault@pflgc.com',  role: 'directeur_usine', initials: 'AV', phone: '(418) 549-7837 p.230', phone2: '' },
        { id: 'noel',     name: 'Noël',                email: 'reception@pflgc.com',        role: 'reception',    initials: 'NO', phone: '(418) 549-7837 p.0', phone2: '' },
    ];

    async function init() {
        const config = getConfig();
        if (config.auth.clientId) {
            try {
                msalInstance = new msal.PublicClientApplication(config);
                await msalInstance.initialize();
                // Check for redirect response
                const response = await msalInstance.handleRedirectPromise();
                if (response) {
                    currentUser = await getUserProfile(response.accessToken);
                    return currentUser;
                }
                // Check cached accounts — auto-login only if ONE account cached
                const accounts = msalInstance.getAllAccounts();
                if (accounts.length === 1) {
                    msalInstance.setActiveAccount(accounts[0]);
                    return await silentLogin();
                } else if (accounts.length > 1) {
                    // Multiple accounts cached — don't auto-pick, let user choose
                    console.log('Multiple M365 accounts cached, showing login screen');
                }
                // Show "change account" button if any accounts are cached
                if (accounts.length > 0) {
                    const clearBtn = document.getElementById('btn-clear-account');
                    if (clearBtn) {
                        clearBtn.style.display = 'inline-block';
                        clearBtn.textContent = `🔄 Changer de compte (actuellement: ${accounts[0].username})`;
                    }
                }
            } catch (e) {
                console.warn('MSAL init failed, demo mode available:', e);
            }
        }
        return null;
    }

    async function login() {
        if (!msalInstance) {
            console.error('MSAL not initialized. Set Client ID in settings.');
            return null;
        }
        try {
            const response = await msalInstance.loginPopup({
                scopes,
                prompt: 'select_account', // TOUJOURS demander quel compte utiliser
            });
            msalInstance.setActiveAccount(response.account);
            currentUser = await getUserProfile(response.accessToken);
            return currentUser;
        } catch (e) {
            console.error('Login failed:', e);

            // Handle stuck interaction state
            if (e.errorCode === 'interaction_in_progress') {
                // Clear stuck state and retry once
                const accounts = msalInstance.getAllAccounts();
                if (accounts.length > 0) {
                    // Already logged in from a previous session
                    msalInstance.setActiveAccount(accounts[0]);
                    return await silentLogin();
                }
                // Clear browser interaction state
                sessionStorage.removeItem('msal.interaction.status');
                // Clear all MSAL interaction keys
                for (const key of Object.keys(sessionStorage)) {
                    if (key.includes('msal') && key.includes('interaction')) {
                        sessionStorage.removeItem(key);
                    }
                }
                throw new Error('Session bloquée. Cliquez à nouveau sur Connexion.');
            }

            // Handle admin consent required
            if (e.errorCode === 'consent_required' || e.errorCode === 'interaction_required' ||
                (e.message && (e.message.includes('AADSTS65001') || e.message.includes('AADSTS650052') ||
                 e.message.includes('admin') || e.message.includes('consent')))) {
                const tenantId = localStorage.getItem('crm_tenantId') || '287a70f9-e3d2-4102-bb0e-3296726fcb3a';
                const clientId = localStorage.getItem('crm_clientId') || '1f609af8-79c7-410d-8540-050efc9e08cc';
                throw new Error(`ADMIN_CONSENT_NEEDED|${tenantId}|${clientId}`);
            }

            throw e;
        }
    }

    async function silentLogin() {
        try {
            const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
            if (!account) return null;
            const response = await msalInstance.acquireTokenSilent({ scopes, account });
            currentUser = await getUserProfile(response.accessToken);
            return currentUser;
        } catch (e) {
            console.warn('Silent login failed:', e);
            return null;
        }
    }

    async function getToken() {
        if (isDemo) return 'demo-token';
        if (!msalInstance) return null;
        try {
            const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
            const response = await msalInstance.acquireTokenSilent({ scopes, account });
            return response.accessToken;
        } catch (e) {
            // Token expired, try interactive
            try {
                const response = await msalInstance.acquireTokenPopup({ scopes });
                return response.accessToken;
            } catch (e2) {
                console.error('Token acquisition failed:', e2);
                return null;
            }
        }
    }

    async function getUserProfile(token) {
        try {
            const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            const email = (data.mail || data.userPrincipalName || '').toLowerCase();
            const name = data.displayName || '';

            // Match against known team members to get role
            const team = getTeamMembers();
            const match = team.find(u =>
                u.email.toLowerCase() === email ||
                (u.emails && u.emails.some(e => e.toLowerCase() === email)) ||
                u.name.toLowerCase() === name.toLowerCase()
            );

            return {
                id: match?.id || data.id,
                name: name,
                email: email,
                role: match?.role || 'vendeur',
                initials: (name || '??').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
            };
        } catch (e) {
            console.error('Failed to get user profile:', e);
            return null;
        }
    }

    function loginDemo() {
        isDemo = true;
        currentUser = demoUsers.find(u => u.id === 'charles') || demoUsers[0]; // Login as Charles Maltais
        // Save demo team
        if (!localStorage.getItem('crm_team')) {
            localStorage.setItem('crm_team', JSON.stringify(demoUsers));
        }
        return currentUser;
    }

    async function logout() {
        if (msalInstance && !isDemo) {
            // Try proper MSAL logout (clears server-side session too)
            try {
                const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
                if (account) {
                    await msalInstance.logoutPopup({
                        account: account,
                        postLogoutRedirectUri: window.location.origin + window.location.pathname,
                    });
                }
            } catch (e) {
                console.warn('MSAL logoutPopup failed, clearing cache manually:', e);
            }
            // Clear ALL cached MSAL accounts
            msalInstance.setActiveAccount(null);
            // Clear MSAL cache from localStorage
            const lsKeys = Object.keys(localStorage);
            for (const key of lsKeys) {
                if (key.startsWith('msal.') || key.includes('msal')) {
                    localStorage.removeItem(key);
                }
            }
            const ssKeys = Object.keys(sessionStorage);
            for (const key of ssKeys) {
                if (key.startsWith('msal.') || key.includes('msal')) {
                    sessionStorage.removeItem(key);
                }
            }
            // Also clear M365 service status cache
            localStorage.removeItem('crm_m365_status');
        }
        currentUser = null;
        isDemo = false;
    }

    function getUser() { return currentUser; }
    function isAuthenticated() { return currentUser !== null; }
    function isDemoMode() { return isDemo; }
    function isDirector() { return currentUser && currentUser.role === 'directeur'; }

    // Use localStorage for data storage (always, unless SharePoint is explicitly configured)
    function useLocalStorage() {
        if (isDemo) return true;
        const spSite = localStorage.getItem('crm_spSite');
        return !spSite || spSite.trim() === '';
    }

    function getTeamMembers() {
        if (isDemo) return demoUsers;
        const saved = localStorage.getItem('crm_team');
        return saved ? JSON.parse(saved) : [currentUser];
    }

    function saveSettings(clientId, tenantId, spSite) {
        localStorage.setItem('crm_clientId', clientId);
        localStorage.setItem('crm_tenantId', tenantId);
        localStorage.setItem('crm_spSite', spSite);
    }

    function saveTeam(members) {
        localStorage.setItem('crm_team', JSON.stringify(members));
    }

    function addTeamMember(member) {
        const team = getTeamMembers();
        member.id = member.id || member.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        member.initials = member.initials || (member.name || '??').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        team.push(member);
        saveTeam(team);
        return member;
    }

    function updateTeamMember(memberId, updates) {
        const team = getTeamMembers();
        const idx = team.findIndex(m => m.id === memberId);
        if (idx >= 0) {
            Object.assign(team[idx], updates);
            if (updates.name) {
                team[idx].initials = updates.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
            }
            saveTeam(team);
        }
    }

    function removeTeamMember(memberId) {
        const team = getTeamMembers().filter(m => m.id !== memberId);
        saveTeam(team);
    }

    return {
        init,
        login,
        loginDemo,
        logout,
        getToken,
        getUser,
        isAuthenticated,
        isDemoMode,
        isDirector,
        useLocalStorage,
        getTeamMembers,
        saveTeam,
        addTeamMember,
        updateTeamMember,
        removeTeamMember,
        saveSettings
    };
})();
