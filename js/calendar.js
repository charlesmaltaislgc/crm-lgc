// ===== CRM LGC - Calendar Integration Module =====
// M365 Calendar: book appointments, view upcoming, link to deals

const Calendar = (() => {
    let upcomingEvents = [];

    async function loadUpcoming() {
        if (Auth.isDemoMode() || Auth.useLocalStorage()) {
            upcomingEvents = generateDemoEvents();
            return upcomingEvents;
        }

        try {
            const now = new Date().toISOString();
            const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
            const data = await Graph.graphFetch(
                `/me/calendarView?startDateTime=${now}&endDateTime=${nextWeek}&$orderby=start/dateTime&$top=20`
            );
            upcomingEvents = data?.value?.map(ev => ({
                id: ev.id,
                subject: ev.subject,
                start: ev.start.dateTime,
                end: ev.end.dateTime,
                location: ev.location?.displayName || '',
                attendees: ev.attendees?.map(a => a.emailAddress.name).join(', ') || '',
                isOnline: ev.isOnlineMeeting || false,
            })) || [];
        } catch (e) {
            console.warn('Failed to load calendar:', e);
            upcomingEvents = [];
        }
        return upcomingEvents;
    }

    async function createAppointment(deal, type, date, time, duration = 60, notes = '') {
        const types = {
            visite: { prefix: 'Visite', emoji: '🏠' },
            mesures: { prefix: 'Prise de mesures', emoji: '📏' },
            signature: { prefix: 'Signature contrat', emoji: '✍️' },
            installation: { prefix: 'Installation', emoji: '🔧' },
            suivi: { prefix: 'Suivi', emoji: '📞' },
            livraison: { prefix: 'Livraison', emoji: '🚚' },
        };

        const typeInfo = types[type] || { prefix: type, emoji: '📅' };
        const subject = `${typeInfo.emoji} ${typeInfo.prefix} - ${deal.clientName}`;

        const startDate = new Date(`${date}T${time || '09:00'}`);
        const endDate = new Date(startDate.getTime() + duration * 60000);

        const eventBody = [
            `Client: ${deal.clientName}`,
            `Téléphone: ${deal.clientPhone || 'N/A'}`,
            `Adresse: ${deal.clientAddress || 'N/A'}`,
            `Produits: ${deal.products || 'N/A'}`,
            deal.mecinovQuoteNum ? `# Soumission: ${deal.mecinovQuoteNum}` : '',
            notes ? `\nNotes: ${notes}` : '',
        ].filter(Boolean).join('\n');

        if (Auth.isDemoMode()) {
            upcomingEvents.push({
                id: 'EV' + Date.now(),
                subject,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                location: deal.clientAddress || '',
                attendees: '',
            });
            App.showToast(`(Démo) RDV créé: ${subject}`, 'success');

            // Add note to deal
            await Deals.addNote(deal.id, `📅 RDV ${typeInfo.prefix}: ${date} à ${time || '09:00'}`);
            return;
        }

        try {
            // Get assigned vendor email for attendee
            const vendor = Auth.getTeamMembers().find(m => m.id === deal.assignedTo);
            const attendees = vendor ? [vendor.email] : [];

            await Graph.createEvent(
                subject,
                startDate.toISOString(),
                endDate.toISOString(),
                attendees
            );

            await Deals.addNote(deal.id, `📅 RDV ${typeInfo.prefix}: ${date} à ${time || '09:00'}`);
            App.showToast('Rendez-vous créé dans le calendrier!', 'success');
            App.addActivity('calendar', `RDV ${typeInfo.prefix} planifié pour ${deal.clientName}`, deal.id);
        } catch (e) {
            App.showToast('Erreur calendrier: ' + e.message, 'error');
        }
    }

    function renderUpcoming() {
        const container = document.getElementById('upcoming-events');
        if (!container) return;

        if (upcomingEvents.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">Aucun rendez-vous cette semaine</div>';
            return;
        }

        container.innerHTML = upcomingEvents.slice(0, 5).map(ev => {
            const start = new Date(ev.start);
            const isToday = start.toDateString() === new Date().toDateString();
            const isTomorrow = start.toDateString() === new Date(Date.now() + 86400000).toDateString();
            const dayLabel = isToday ? "Aujourd'hui" : isTomorrow ? 'Demain' : start.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });

            return `
                <div class="task-item" style="border-left:3px solid ${isToday ? 'var(--primary)' : 'var(--border)'}">
                    <div style="min-width:70px;text-align:center">
                        <div style="font-size:11px;font-weight:700;color:${isToday ? 'var(--primary)' : 'var(--text-secondary)'};text-transform:uppercase">${dayLabel}</div>
                        <div style="font-size:15px;font-weight:800">${start.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div class="task-info">
                        <div class="task-description">${ev.subject}</div>
                        <div class="task-meta">
                            ${ev.location ? `📍 ${ev.location}` : ''}
                            ${ev.attendees ? ` | 👥 ${ev.attendees}` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Quick appointment modal for a deal
    function showBookingModal(dealId) {
        const deal = Deals.getById(dealId);
        if (!deal) return;

        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        const html = `
            <div style="padding:8px 0">
                <p style="margin-bottom:16px"><strong>${deal.clientName}</strong> - ${deal.clientAddress || 'Adresse non renseignée'}</p>

                <div class="form-group">
                    <label>Type de rendez-vous</label>
                    <select id="booking-type" class="input-sm" style="width:100%">
                        <option value="visite">🏠 Visite / Estimation</option>
                        <option value="mesures">📏 Prise de mesures</option>
                        <option value="signature">✍️ Signature contrat</option>
                        <option value="installation">🔧 Installation</option>
                        <option value="livraison">🚚 Livraison</option>
                        <option value="suivi">📞 Suivi / Appel</option>
                    </select>
                </div>
                <div style="display:flex;gap:12px">
                    <div class="form-group" style="flex:1">
                        <label>Date</label>
                        <input type="date" id="booking-date" class="input-sm" value="${tomorrow}" style="width:100%">
                    </div>
                    <div class="form-group" style="flex:1">
                        <label>Heure</label>
                        <input type="time" id="booking-time" class="input-sm" value="09:00" style="width:100%">
                    </div>
                    <div class="form-group" style="width:100px">
                        <label>Durée (min)</label>
                        <input type="number" id="booking-duration" class="input-sm" value="60" min="15" step="15" style="width:100%">
                    </div>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <input type="text" id="booking-notes" class="input-sm" placeholder="Notes pour le rendez-vous..." style="width:100%">
                </div>
            </div>
        `;

        document.getElementById('confirm-title').textContent = '📅 Planifier un rendez-vous';
        document.getElementById('confirm-message').innerHTML = html;
        document.getElementById('btn-confirm-action').textContent = 'Créer le RDV';
        document.getElementById('btn-confirm-action').classList.remove('hidden');
        document.getElementById('btn-confirm-action').onclick = async () => {
            const type = document.getElementById('booking-type').value;
            const date = document.getElementById('booking-date').value;
            const time = document.getElementById('booking-time').value;
            const duration = parseInt(document.getElementById('booking-duration').value) || 60;
            const notes = document.getElementById('booking-notes').value;

            await createAppointment(deal, type, date, time, duration, notes);
            document.getElementById('modal-confirm').classList.add('hidden');
        };
        document.getElementById('modal-confirm').classList.remove('hidden');
    }

    function generateDemoEvents() {
        const today = new Date();
        return [
            { id: 'EV1', subject: '🏠 Visite - Tremblay, Martin', start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30).toISOString(), end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 30).toISOString(), location: '123 rue Principale', attendees: 'Sylvain Fillion' },
            { id: 'EV2', subject: '📏 Prise de mesures - Roy, Pierre', start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 0).toISOString(), end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0).toISOString(), location: '456 rue du Fleuve', attendees: 'Fabien Duchossoy' },
            { id: 'EV3', subject: '✍️ Signature contrat - Bouchard, André', start: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 10, 0).toISOString(), end: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 10, 30).toISOString(), location: 'Bureau LGC', attendees: 'Charles Maltais' },
            { id: 'EV4', subject: '🔧 Installation - Côté, Luc', start: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2, 8, 0).toISOString(), end: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2, 16, 0).toISOString(), location: '789 rue des Érables', attendees: 'Alain Verreault' },
        ];
    }

    return {
        loadUpcoming,
        createAppointment,
        renderUpcoming,
        showBookingModal,
    };
})();
