// ===== CRM LGC - Auto Notifications Module =====
// Sends automated follow-up emails via Outlook Graph API

const Notifications = (() => {
    const SENT_KEY = 'crm_notif_sent';
    let sentLog = [];

    function loadSentLog() {
        sentLog = JSON.parse(localStorage.getItem(SENT_KEY) || '[]');
    }

    function saveSentLog() {
        localStorage.setItem(SENT_KEY, JSON.stringify(sentLog));
    }

    function wasSentRecently(dealId, type, withinDays = 3) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - withinDays);
        return sentLog.some(s =>
            s.dealId === dealId && s.type === type && new Date(s.sentAt) > cutoff
        );
    }

    function logSent(dealId, type, to) {
        sentLog.push({ dealId, type, to, sentAt: new Date().toISOString() });
        // Keep last 500
        if (sentLog.length > 500) sentLog = sentLog.slice(-500);
        saveSentLog();
    }

    // ===== AUTO FOLLOW-UP CHECK =====
    // Called periodically or on dashboard load
    async function checkAndSendReminders() {
        if (Auth.isDemoMode()) return; // Don't send real emails in demo

        const active = Deals.getActive();
        const today = new Date();
        let sentCount = 0;

        for (const deal of active) {
            // 1. Soumission envoyée > 5 jours, pas de relance récente
            if (deal.stage === 5 || deal.stage === 6) {
                const daysSinceQuote = deal.quoteSentDate ? Deals.getDaysSince(deal.quoteSentDate) : null;
                const relanceDelay = parseInt(localStorage.getItem('crm_relanceDelay') || '5');

                if (daysSinceQuote >= relanceDelay && deal.clientEmail && !wasSentRecently(deal.id, 'followup', 5)) {
                    await sendFollowUpEmail(deal);
                    logSent(deal.id, 'followup', deal.clientEmail);
                    sentCount++;
                }
            }

            // 2. Notify vendeur of overdue tasks
            if (Deals.isOverdue(deal) && deal.assignedTo) {
                const vendor = Auth.getTeamMembers().find(m => m.id === deal.assignedTo);
                if (vendor && vendor.email && !wasSentRecently(deal.id, 'vendeur_alert', 1)) {
                    await sendVendeurAlert(deal, vendor);
                    logSent(deal.id, 'vendeur_alert', vendor.email);
                    sentCount++;
                }
            }
        }

        if (sentCount > 0) {
            App.showToast(`${sentCount} notification(s) envoyée(s)`, 'info');
        }
    }

    async function sendFollowUpEmail(deal) {
        const body = `
            <div style="font-family:system-ui;max-width:600px;margin:0 auto">
                <div style="background:#c0392b;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center">
                    <h2 style="margin:0">Portes et Fenêtres LGC</h2>
                </div>
                <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                    <p>Bonjour ${deal.clientName.split(',')[0].split(' ').pop()},</p>
                    <p>Nous faisons suite à la soumission que nous vous avons envoyée récemment pour vos travaux de
                    ${deal.products === 'les-deux' ? 'portes et fenêtres' : deal.products === 'fenetres' ? 'fenêtres' : deal.products === 'portes' ? 'portes' : 'travaux'}.</p>
                    <p>Avez-vous eu la chance de la consulter? N'hésitez pas à nous contacter si vous avez des questions
                    ou si vous souhaitez des modifications.</p>
                    <p>Nous sommes disponibles par téléphone ou par courriel.</p>
                    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
                    <p>Cordialement,<br><strong>Portes et Fenêtres LGC</strong><br>
                    <a href="tel:+1XXXXXXXXXX">Téléphone</a> | <a href="mailto:soumission@pflgc.com">soumission@pflgc.com</a></p>
                </div>
            </div>
        `;

        try {
            await Graph.sendEmail(deal.clientEmail, 'Suivi de votre soumission - Portes et Fenêtres LGC', body);
            await Deals.addNote(deal.id, `📧 Relance automatique envoyée à ${deal.clientEmail}`);
            await Deals.update(deal.id, { lastFollowUp: new Date().toISOString().split('T')[0] });
        } catch (e) {
            console.error('Failed to send follow-up:', e);
        }
    }

    async function sendVendeurAlert(deal, vendor) {
        const stage = Deals.getStageName(deal.stage);
        const daysSince = Deals.getDaysSince(deal.updatedAt);

        const body = `
            <div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:24px">
                <h2 style="color:#dc2626">⚠️ Deal en retard - Action requise</h2>
                <div style="padding:16px;background:#fef2f2;border-radius:8px;margin:16px 0">
                    <p><strong>Client:</strong> ${deal.clientName}</p>
                    <p><strong>Étape:</strong> ${stage}</p>
                    <p><strong>En attente depuis:</strong> ${daysSince} jours</p>
                    <p><strong>Montant:</strong> ${Deals.formatMoney(deal.quoteAmount)}</p>
                </div>
                <p>Ce deal nécessite votre attention. Veuillez mettre à jour le CRM après avoir pris action.</p>
                <p style="color:#94a3b8;font-size:12px">- CRM LGC (notification automatique)</p>
            </div>
        `;

        try {
            await Graph.sendEmail(vendor.email, `⚠️ Deal en retard: ${deal.clientName} - ${stage}`, body);
        } catch (e) {
            console.error('Failed to send vendor alert:', e);
        }
    }

    // Manual notification to a specific person
    async function sendCustomNotification(to, subject, message) {
        if (Auth.isDemoMode()) {
            App.showToast(`(Démo) Notification à ${to}: ${subject}`, 'info');
            return;
        }

        const body = `
            <div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:24px">
                <div style="background:#c0392b;color:white;padding:16px;border-radius:8px 8px 0 0;text-align:center">
                    <h3 style="margin:0">CRM LGC - Notification</h3>
                </div>
                <div style="padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                    <p>${message}</p>
                    <p style="color:#94a3b8;font-size:12px;margin-top:16px">Envoyé par ${Auth.getUser()?.name || 'CRM LGC'}</p>
                </div>
            </div>
        `;

        try {
            await Graph.sendEmail(to, subject, body);
            App.showToast('Notification envoyée!', 'success');
        } catch (e) {
            App.showToast('Erreur d\'envoi: ' + e.message, 'error');
        }
    }

    return {
        loadSentLog,
        checkAndSendReminders,
        sendCustomNotification,
    };
})();
