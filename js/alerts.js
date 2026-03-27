// ===== CRM LGC - Alerts Module =====
// "À faire aujourd'hui" system

const Alerts = (() => {
    let alerts = [];

    function refresh() {
        alerts = [];
        let active = Deals.getActive();
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // Vendeurs: seulement leurs alertes. Directeurs: tout.
        const user = Auth.getUser();
        if (user && !Auth.isDirector()) {
            active = active.filter(d => d.assignedTo === user.id);
        }

        active.forEach(deal => {
            const daysSinceUpdate = Deals.getDaysSince(deal.updatedAt);
            const stage = Deals.STAGES.find(s => s.id === deal.stage);

            // 1. Leads non assignés
            if (deal.stage === 1 && !deal.assignedTo) {
                alerts.push({
                    type: 'urgent',
                    category: 'LEAD NON ASSIGNÉ',
                    text: `${deal.clientName} - Nouveau lead sans vendeur assigné`,
                    dealId: deal.id,
                    priority: 1,
                });
            }

            // 2. Soumissions à relancer (stage 6)
            if (deal.stage === 6) {
                const daysSinceQuote = deal.quoteSentDate ? Deals.getDaysSince(deal.quoteSentDate) : daysSinceUpdate;
                const relanceDelay = parseInt(localStorage.getItem('crm_relanceDelay') || '5');
                if (daysSinceQuote >= relanceDelay) {
                    alerts.push({
                        type: 'urgent',
                        category: 'RELANCE REQUISE',
                        text: `${deal.clientName} - Soumission envoyée il y a ${daysSinceQuote} jours sans réponse`,
                        dealId: deal.id,
                        delay: `${daysSinceQuote}j`,
                        priority: 2,
                    });
                }
            }

            // 3. Soumission envoyée mais pas de relance programmée (stage 5)
            if (deal.stage === 5 && daysSinceUpdate > 2) {
                alerts.push({
                    type: 'warning',
                    category: 'SUIVI SOUMISSION',
                    text: `${deal.clientName} - Soumission envoyée, passer en relance?`,
                    dealId: deal.id,
                    delay: `${daysSinceUpdate}j`,
                    priority: 3,
                });
            }

            // 4. Délai lead → soumission trop long
            if (deal.stage >= 1 && deal.stage <= 4 && deal.leadDate) {
                const leadDelay = parseInt(localStorage.getItem('crm_leadDelay') || '14');
                const daysSinceLead = Deals.getDaysSince(deal.leadDate);
                if (daysSinceLead > leadDelay) {
                    alerts.push({
                        type: 'warning',
                        category: 'SOUMISSION EN RETARD',
                        text: `${deal.clientName} - Lead depuis ${daysSinceLead} jours, soumission pas encore envoyée`,
                        dealId: deal.id,
                        delay: `${daysSinceLead}j`,
                        priority: 2,
                    });
                }
            }

            // 5. Contrat à faire signer (stage 8)
            if (deal.stage === 8 && daysSinceUpdate > 5) {
                alerts.push({
                    type: 'warning',
                    category: 'CONTRAT À SIGNER',
                    text: `${deal.clientName} - Contrat en attente de signature depuis ${daysSinceUpdate} jours`,
                    dealId: deal.id,
                    delay: `${daysSinceUpdate}j`,
                    priority: 3,
                });
            }

            // 6. Acompte non reçu pour client régulier (stage 9+)
            if (deal.clientType === 'regulier' && deal.stage >= 9 && deal.depositReceived === 'non') {
                const daysSinceStage = daysSinceUpdate;
                alerts.push({
                    type: 'urgent',
                    category: 'ACOMPTE REQUIS',
                    text: `${deal.clientName} - Client régulier, acompte non reçu! Ne pas expédier.`,
                    dealId: deal.id,
                    delay: `${daysSinceStage}j`,
                    priority: 1,
                });
            }

            // 7. Entrepreneur en retard de paiement
            if (deal.clientType === 'entrepreneur' && deal.stage >= 13 && deal.paymentStatus !== 'paid') {
                const net30Delay = parseInt(localStorage.getItem('crm_net30Delay') || '30');
                if (deal.completedDate || deal.installDate) {
                    const daysSinceInstall = Deals.getDaysSince(deal.installDate || deal.completedDate);
                    if (daysSinceInstall > net30Delay) {
                        alerts.push({
                            type: 'urgent',
                            category: 'PAIEMENT EN RETARD',
                            text: `${deal.clientName} (entrepreneur) - Net 30 dépassé de ${daysSinceInstall - net30Delay} jours`,
                            dealId: deal.id,
                            delay: `${daysSinceInstall}j`,
                            priority: 1,
                        });
                    }
                }
            }

            // 8. Mesures installation en retard (stage 11)
            if (deal.stage === 11 && daysSinceUpdate > 5) {
                alerts.push({
                    type: 'warning',
                    category: 'MESURES EN RETARD',
                    text: `${deal.clientName} - Mesures installation à prendre depuis ${daysSinceUpdate} jours`,
                    dealId: deal.id,
                    delay: `${daysSinceUpdate}j`,
                    priority: 3,
                });
            }

            // 9. Generic overdue for any stage with alertDays
            if (stage && stage.alertDays && daysSinceUpdate > stage.alertDays
                && ![1, 5, 6, 8, 9, 11].includes(deal.stage)) {
                alerts.push({
                    type: 'info',
                    category: 'RETARD',
                    text: `${deal.clientName} - "${stage.name}" depuis ${daysSinceUpdate} jours`,
                    dealId: deal.id,
                    delay: `${daysSinceUpdate}j`,
                    priority: 4,
                });
            }
        });

        // 10. Mesures installation: alerte si installation proche et mesures pas faites
        if (typeof Installations !== 'undefined' && Installations.getMesureAlerts) {
            const mesureAlerts = Installations.getMesureAlerts();
            mesureAlerts.forEach(a => alerts.push(a));
        }

        // Sort by priority
        alerts.sort((a, b) => a.priority - b.priority);

        renderAlerts();
        updateBadges();
    }

    function renderAlerts() {
        const container = document.getElementById('alerts-list');
        const section = document.getElementById('alerts-section');
        if (!container || !section) return;

        if (alerts.length === 0) {
            section.classList.add('empty');
            section.querySelector('.section-title').textContent = 'Tout est sous contrôle!';
            container.innerHTML = '<div class="alert-placeholder">Aucun deal en retard - bon travail!</div>';
            return;
        }

        section.classList.remove('empty');
        section.querySelector('.section-title').textContent = `🔴 À faire aujourd'hui (${alerts.length})`;

        container.innerHTML = alerts.slice(0, 12).map(alert => {
            const clickAction = alert.mesureId
                ? `App.navigate('installations');setTimeout(()=>Installations.switchTab('mesures'),100)`
                : `App.openDeal('${alert.dealId}')`;
            return `
            <div class="alert-item ${alert.type === 'warning' ? 'warning' : alert.type === 'info' ? 'info' : ''}"
                 onclick="${clickAction}">
                <span class="alert-type">${alert.category}</span>
                <span class="alert-text">${alert.text}</span>
                ${alert.delay ? `<span class="alert-delay">${alert.delay}</span>` : ''}
            </div>`;
        }).join('');

        if (alerts.length > 10) {
            container.innerHTML += `<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:12px">
                + ${alerts.length - 10} autres alertes...
            </div>`;
        }
    }

    function updateBadges() {
        const badge = document.getElementById('badge-alerts');
        const notifDot = document.getElementById('notif-dot');

        if (badge) {
            if (alerts.length > 0) {
                badge.textContent = alerts.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        if (notifDot) {
            if (alerts.length > 0) notifDot.classList.remove('hidden');
            else notifDot.classList.add('hidden');
        }
    }

    function getAlerts() { return alerts; }
    function getUrgentCount() { return alerts.filter(a => a.type === 'urgent').length; }

    return {
        refresh,
        renderAlerts,
        getAlerts,
        getUrgentCount,
    };
})();
