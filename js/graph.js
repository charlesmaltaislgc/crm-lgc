// ===== CRM LGC - Microsoft Graph API Module =====
// Handles SharePoint Lists CRUD and Outlook/Calendar operations

const Graph = (() => {
    const GRAPH_URL = 'https://graph.microsoft.com/v1.0';
    let siteId = null;

    // SharePoint List schemas
    const LIST_SCHEMAS = {
        CRM_Deals: {
            displayName: 'CRM_Deals',
            columns: [
                { name: 'ClientName', text: {} },
                { name: 'ClientPhone', text: {} },
                { name: 'ClientEmail', text: {} },
                { name: 'ClientAddress', text: {} },
                { name: 'AccountNumber', text: {} },
                { name: 'ClientType', choice: { choices: ['regulier', 'entrepreneur'] } },
                { name: 'LeadSource', choice: { choices: ['telephone', 'courriel', 'en-personne', 'reference', 'web', 'shopify'] } },
                { name: 'ProjectType', choice: { choices: ['renovation', 'neuf', 'commercial'] } },
                { name: 'Products', choice: { choices: ['fenetres', 'portes', 'les-deux', 'autre'] } },
                { name: 'Description', text: { allowMultipleLines: true } },
                { name: 'QuoteAmount', number: {} },
                { name: 'ContractAmount', number: {} },
                { name: 'Stage', number: {} },
                { name: 'Status', choice: { choices: ['active', 'won', 'lost', 'cancelled'] } },
                { name: 'AssignedTo', text: {} },
                { name: 'MecinovQuoteNum', text: {} },
                { name: 'MecinovOrderNum', text: {} },
                { name: 'MecinovInvoiceNum', text: {} },
                { name: 'AvantageInvoiceNum', text: {} },
                { name: 'ShopifyOrderNum', text: {} },
                { name: 'DepositRequired', number: {} },
                { name: 'DepositReceived', choice: { choices: ['oui', 'non', 'na'] } },
                { name: 'PaymentStatus', choice: { choices: ['pending', 'partial', 'paid', 'overdue'] } },
                { name: 'LeadDate', dateTime: { format: 'dateOnly' } },
                { name: 'AssignDate', dateTime: { format: 'dateOnly' } },
                { name: 'QuoteSentDate', dateTime: { format: 'dateOnly' } },
                { name: 'LastFollowUp', dateTime: { format: 'dateOnly' } },
                { name: 'ContractSignDate', dateTime: { format: 'dateOnly' } },
                { name: 'DepositDate', dateTime: { format: 'dateOnly' } },
                { name: 'SupplierOrderDate', dateTime: { format: 'dateOnly' } },
                { name: 'MeasurementDate', dateTime: { format: 'dateOnly' } },
                { name: 'InstallDate', dateTime: { format: 'dateOnly' } },
                { name: 'CompletedDate', dateTime: { format: 'dateOnly' } },
            ]
        },
        CRM_Notes: {
            displayName: 'CRM_Notes',
            columns: [
                { name: 'DealId', text: {} },
                { name: 'Author', text: {} },
                { name: 'NoteText', text: { allowMultipleLines: true } },
                { name: 'NoteDate', dateTime: {} },
            ]
        },
        CRM_Tasks: {
            displayName: 'CRM_Tasks',
            columns: [
                { name: 'DealId', text: {} },
                { name: 'AssignedTo', text: {} },
                { name: 'TaskDescription', text: {} },
                { name: 'Deadline', dateTime: { format: 'dateOnly' } },
                { name: 'Priority', choice: { choices: ['normal', 'high', 'urgent'] } },
                { name: 'TaskStatus', choice: { choices: ['pending', 'in_progress', 'completed'] } },
            ]
        },
        CRM_Contracts: {
            displayName: 'CRM_Contracts',
            columns: [
                { name: 'DealId', text: {} },
                { name: 'ContractUrl', text: {} },
                { name: 'SignToken', text: {} },
                { name: 'Signed', boolean: {} },
                { name: 'SignDate', dateTime: {} },
                { name: 'SignerName', text: {} },
                { name: 'SignerIP', text: {} },
            ]
        }
    };

    async function graphFetch(endpoint, options = {}) {
        const token = await Auth.getToken();
        if (!token || token === 'demo-token') return null;

        const response = await fetch(`${GRAPH_URL}${endpoint}`, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...options.headers,
            }
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error('Graph API error:', response.status, err);
            throw new Error(err.error?.message || `Graph API error ${response.status}`);
        }

        if (response.status === 204) return null;
        return response.json();
    }

    async function getSiteId() {
        if (siteId) return siteId;
        const spSite = localStorage.getItem('crm_spSite') || '';
        if (!spSite) return null;

        try {
            // Parse the SharePoint URL
            const url = new URL(spSite);
            const hostname = url.hostname;
            const sitePath = url.pathname;
            const data = await graphFetch(`/sites/${hostname}:${sitePath}`);
            siteId = data.id;
            return siteId;
        } catch (e) {
            console.error('Failed to get SharePoint site:', e);
            return null;
        }
    }

    async function ensureLists() {
        const site = await getSiteId();
        if (!site) return false;

        for (const [listName, schema] of Object.entries(LIST_SCHEMAS)) {
            try {
                await graphFetch(`/sites/${site}/lists/${listName}`);
            } catch (e) {
                // List doesn't exist, create it
                try {
                    await graphFetch(`/sites/${site}/lists`, {
                        method: 'POST',
                        body: JSON.stringify({
                            displayName: schema.displayName,
                            list: { template: 'genericList' }
                        })
                    });
                    // Add columns
                    for (const col of schema.columns) {
                        await graphFetch(`/sites/${site}/lists/${listName}/columns`, {
                            method: 'POST',
                            body: JSON.stringify(col)
                        });
                    }
                } catch (e2) {
                    console.error(`Failed to create list ${listName}:`, e2);
                }
            }
        }
        return true;
    }

    // Generic CRUD for SharePoint Lists
    async function getListItems(listName, filter = '', orderBy = '', top = 500) {
        const site = await getSiteId();
        if (!site) return [];
        let url = `/sites/${site}/lists/${listName}/items?$expand=fields&$top=${top}`;
        if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
        if (orderBy) url += `&$orderby=${encodeURIComponent(orderBy)}`;
        const data = await graphFetch(url);
        return data?.value?.map(item => ({ id: item.id, ...item.fields })) || [];
    }

    async function createListItem(listName, fields) {
        const site = await getSiteId();
        if (!site) return null;
        const data = await graphFetch(`/sites/${site}/lists/${listName}/items`, {
            method: 'POST',
            body: JSON.stringify({ fields })
        });
        return data ? { id: data.id, ...data.fields } : null;
    }

    async function updateListItem(listName, itemId, fields) {
        const site = await getSiteId();
        if (!site) return null;
        await graphFetch(`/sites/${site}/lists/${listName}/items/${itemId}/fields`, {
            method: 'PATCH',
            body: JSON.stringify(fields)
        });
        return true;
    }

    async function deleteListItem(listName, itemId) {
        const site = await getSiteId();
        if (!site) return false;
        await graphFetch(`/sites/${site}/lists/${listName}/items/${itemId}`, {
            method: 'DELETE'
        });
        return true;
    }

    // ===== SERVICE DETECTION =====
    // Test which M365 services are available for the logged-in account
    let serviceStatus = { sharepoint: null, outlook: null, calendar: null };

    async function detectServices() {
        const token = await Auth.getToken();
        if (!token || token === 'demo-token') {
            serviceStatus = { sharepoint: 'no-auth', outlook: 'no-auth', calendar: 'no-auth' };
            return serviceStatus;
        }

        // Test all three in parallel
        const [sp, mail, cal] = await Promise.allSettled([
            testSharePoint(),
            testOutlook(),
            testCalendar()
        ]);

        serviceStatus.sharepoint = sp.status === 'fulfilled' ? sp.value : 'error';
        serviceStatus.outlook = mail.status === 'fulfilled' ? mail.value : 'error';
        serviceStatus.calendar = cal.status === 'fulfilled' ? cal.value : 'error';

        // Save status for other modules
        localStorage.setItem('crm_m365_status', JSON.stringify(serviceStatus));
        return serviceStatus;
    }

    async function testSharePoint() {
        const spSite = localStorage.getItem('crm_spSite') || '';
        if (!spSite) {
            // Try to auto-detect SharePoint site
            try {
                const data = await graphFetch('/sites?search=LGC&$top=5');
                if (data?.value?.length > 0) {
                    // Find the best site (prefer SoumissionsCRM or LGC)
                    const sites = data.value;
                    const crmSite = sites.find(s => s.displayName?.includes('CRM') || s.name?.includes('CRM'));
                    const lgcSite = sites.find(s => s.displayName?.includes('LGC') || s.name?.includes('LGC'));
                    const bestSite = crmSite || lgcSite || sites[0];
                    return { status: 'detected', sites: sites.map(s => ({ name: s.displayName, url: s.webUrl, id: s.id })), recommended: bestSite?.webUrl };
                }
            } catch (e) { /* continue */ }
            return { status: 'not-configured' };
        }
        try {
            const site = await getSiteId();
            return site ? { status: 'connected', siteId: site } : { status: 'error', message: 'Site introuvable' };
        } catch (e) {
            return { status: 'error', message: e.message };
        }
    }

    async function testOutlook() {
        try {
            // Test if the account has a mailbox
            const data = await graphFetch('/me/messages?$top=1&$select=id');
            return { status: 'connected', hasMailbox: true };
        } catch (e) {
            const msg = e.message || '';
            if (msg.includes('MailboxNotEnabledForRESTAPI') || msg.includes('MailboxNotFound')) {
                // Account has no mailbox - check for shared mailbox config
                const sharedMailbox = localStorage.getItem('crm_sharedMailbox') || '';
                if (sharedMailbox) {
                    try {
                        await graphFetch(`/users/${sharedMailbox}/messages?$top=1&$select=id`);
                        return { status: 'shared', mailbox: sharedMailbox };
                    } catch (e2) {
                        return { status: 'no-mailbox', sharedError: e2.message };
                    }
                }
                return { status: 'no-mailbox' };
            }
            return { status: 'error', message: msg };
        }
    }

    async function testCalendar() {
        try {
            const now = new Date().toISOString();
            const tomorrow = new Date(Date.now() + 86400000).toISOString();
            await graphFetch(`/me/calendarView?startDateTime=${now}&endDateTime=${tomorrow}&$top=1&$select=id`);
            return { status: 'connected' };
        } catch (e) {
            const msg = e.message || '';
            if (msg.includes('MailboxNotEnabledForRESTAPI') || msg.includes('MailboxNotFound')) {
                return { status: 'no-mailbox' };
            }
            return { status: 'error', message: msg };
        }
    }

    function getServiceStatus() {
        if (serviceStatus.sharepoint === null) {
            // Load cached status
            try {
                const cached = localStorage.getItem('crm_m365_status');
                if (cached) serviceStatus = JSON.parse(cached);
            } catch (e) { /* ignore */ }
        }
        return serviceStatus;
    }

    // ===== OUTLOOK EMAILS =====
    // Supports both personal mailbox and shared mailbox
    function getMailboxEndpoint() {
        const status = getServiceStatus();
        const sharedMailbox = localStorage.getItem('crm_sharedMailbox') || '';
        if (status.outlook?.status === 'shared' && sharedMailbox) {
            return `/users/${sharedMailbox}`;
        }
        return '/me';
    }

    async function getEmails(top = 50, filter = '') {
        const endpoint = getMailboxEndpoint();
        let url = `${endpoint}/messages?$top=${top}&$orderby=receivedDateTime desc`;
        if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
        const data = await graphFetch(url);
        return data?.value || [];
    }

    async function sendEmail(to, subject, body, cc = null, attachments = []) {
        const message = {
            subject,
            body: { contentType: 'HTML', content: body },
            toRecipients: [{ emailAddress: { address: to } }],
        };
        if (cc) message.ccRecipients = [{ emailAddress: { address: cc } }];
        if (attachments.length > 0) {
            message.attachments = attachments.map(a => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: a.name,
                contentType: a.contentType || 'application/octet-stream',
                contentBytes: a.contentBytes,
            }));
        }

        const endpoint = getMailboxEndpoint();
        await graphFetch(`${endpoint}/sendMail`, {
            method: 'POST',
            body: JSON.stringify({ message })
        });
    }

    // Calendar
    async function createEvent(subject, start, end, attendees = []) {
        try {
            const event = {
                subject,
                start: { dateTime: start, timeZone: 'Eastern Standard Time' },
                end: { dateTime: end, timeZone: 'Eastern Standard Time' },
                attendees: attendees.map(a => ({
                    emailAddress: { address: a },
                    type: 'required'
                }))
            };
            return await graphFetch('/me/events', {
                method: 'POST',
                body: JSON.stringify(event)
            });
        } catch (e) {
            console.error('Failed to create calendar event:', e);
            throw e;
        }
    }

    // Calendar view
    async function getCalendarView(start, end, top = 20) {
        try {
            const data = await graphFetch(
                `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=${top}`
            );
            return data?.value || [];
        } catch (e) {
            console.warn('Calendar fetch failed:', e.message);
            return [];
        }
    }

    // ===== SHARED MAILBOX (soumission@pflgc.com) =====
    // Uses delegated permissions (Mail.ReadWrite.Shared) to read shared mailbox
    async function getSharedMailboxEmails(mailbox, top = 50, filter = '') {
        const fields = 'id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments';
        let url = `/users/${encodeURIComponent(mailbox)}/messages?$top=${top}&$orderby=receivedDateTime desc&$select=${fields}`;
        if (filter) url += `&$filter=${encodeURIComponent(filter)}`;

        try {
            const data = await graphFetch(url);
            return data?.value || [];
        } catch (e) {
            const msg = e.message || '';
            console.warn('Shared mailbox direct access failed:', msg);

            // Fallback: try via /me with shared mailbox header (some M365 configs need this)
            if (msg.includes('Access') || msg.includes('403') || msg.includes('401') || msg.includes('ErrorAccessDenied')) {
                console.log('Trying shared mailbox via /me with X-AnchorMailbox...');
                try {
                    const token = await Auth.getToken();
                    if (!token) return [];
                    let fallbackUrl = `${GRAPH_URL}/me/messages?$top=${top}&$orderby=receivedDateTime desc&$select=${fields}`;
                    // Filter to emails where soumission@pflgc.com is in To or CC
                    const sharedFilter = `(toRecipients/any(r:r/emailAddress/address eq '${mailbox}') or ccRecipients/any(r:r/emailAddress/address eq '${mailbox}'))`;
                    const combinedFilter = filter ? `${filter} and ${sharedFilter}` : sharedFilter;
                    fallbackUrl += `&$filter=${encodeURIComponent(combinedFilter)}`;

                    const response = await fetch(fallbackUrl, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                            'X-AnchorMailbox': mailbox,
                        }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        return data?.value || [];
                    }
                } catch (e2) {
                    console.warn('Fallback shared mailbox also failed:', e2.message);
                }
            }

            // Re-throw original error if all fallbacks fail
            throw e;
        }
    }

    async function getEmailAttachments(mailbox, emailId) {
        const endpoint = mailbox
            ? `/users/${encodeURIComponent(mailbox)}/messages/${emailId}/attachments`
            : `/me/messages/${emailId}/attachments`;
        const data = await graphFetch(endpoint);
        return data?.value || [];
    }

    return {
        ensureLists,
        getListItems,
        createListItem,
        updateListItem,
        deleteListItem,
        getEmails,
        getSharedMailboxEmails,
        getEmailAttachments,
        sendEmail,
        createEvent,
        getCalendarView,
        graphFetch,
        detectServices,
        getServiceStatus,
        getSiteId,
    };
})();
