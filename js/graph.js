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

    // Outlook emails
    async function getEmails(top = 50, filter = '') {
        let url = `/me/messages?$top=${top}&$orderby=receivedDateTime desc`;
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
        await graphFetch('/me/sendMail', {
            method: 'POST',
            body: JSON.stringify({ message })
        });
    }

    // Calendar
    async function createEvent(subject, start, end, attendees = []) {
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
    }

    return {
        ensureLists,
        getListItems,
        createListItem,
        updateListItem,
        deleteListItem,
        getEmails,
        sendEmail,
        createEvent,
        graphFetch
    };
})();
