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

    const scopes = [
        'User.Read',
        'Sites.ReadWrite.All',
        'Mail.ReadWrite',
        'Mail.Send',
        'Calendars.ReadWrite'
    ];

    // Équipe LGC
    const demoUsers = [
        { id: 'charles',  name: 'Charles Maltais',     email: 'charles.maltais@pflgc.com', emails: ['charles.maltais@pflgc.com','soumission@pflgc.com','lgc@pflgc.com'], role: 'directeur',    initials: 'CM' },
        { id: 'olivier',  name: 'Olivier Maltais',     email: 'olivier.maltais@pflgc.com',  role: 'directeur',    initials: 'OM' },
        { id: 'keven',    name: 'Keven Gaudreault',    email: 'keven.gaudreault@pflgc.com', role: 'directeur',    initials: 'KG' },
        { id: 'sabra',    name: 'Sabra Msellem',       email: 'sabra@pflgc.com',            emails: ['sabra@pflgc.com','comptabilite@pflgc.com'], role: 'directeur', initials: 'SM' },
        { id: 'sylvain',  name: 'Sylvain Fillion',     email: 'sylvain.fillion@pflgc.com',  role: 'vendeur',      initials: 'SF' },
        { id: 'fabien',   name: 'Fabien Duchossoy',    email: 'fabien@pflgc.com',           role: 'vendeur',      initials: 'FD' },
        { id: 'claude',   name: 'Claude Amiot',        email: 'claude.amiot@pflgc.com',     role: 'vendeur',      initials: 'CA' },
        { id: 'nathalie', name: 'Nathalie Tremblay',   email: 'nathalie.tremblay@pflgc.com',role: 'vendeur',      initials: 'NT' },
        { id: 'alain',    name: 'Alain Verreault',     email: 'alain.verreault@pflgc.com',  role: 'directeur_usine', initials: 'AV' },
        { id: 'noel',     name: 'Noël',                email: 'reception@pflgc.com',        role: 'reception',    initials: 'NO' },
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
                // Check cached accounts
                const accounts = msalInstance.getAllAccounts();
                if (accounts.length > 0) {
                    msalInstance.setActiveAccount(accounts[0]);
                    return await silentLogin();
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
            const response = await msalInstance.loginPopup({ scopes });
            msalInstance.setActiveAccount(response.account);
            currentUser = await getUserProfile(response.accessToken);
            return currentUser;
        } catch (e) {
            console.error('Login failed:', e);
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

    function logout() {
        if (msalInstance && !isDemo) {
            msalInstance.logoutPopup();
        }
        currentUser = null;
        isDemo = false;
    }

    function getUser() { return currentUser; }
    function isAuthenticated() { return currentUser !== null; }
    function isDemoMode() { return isDemo; }
    function isDirector() { return currentUser && currentUser.role === 'directeur'; }

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
        getTeamMembers,
        saveTeam,
        addTeamMember,
        updateTeamMember,
        removeTeamMember,
        saveSettings
    };
})();
