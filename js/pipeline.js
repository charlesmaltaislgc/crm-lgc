// ===== CRM LGC - Pipeline / Kanban Module =====

const Pipeline = (() => {
    let currentView = 'kanban';
    let draggedCard = null;
    let filterVendeur = '';
    let filterClientType = '';
    let autoFilterApplied = false;

    function render() {
        // Auto-filter: vendeurs voient LEURS deals par défaut, directeurs voient tout
        if (!autoFilterApplied) {
            autoFilterApplied = true;
            const user = Auth.getUser();
            if (user && !Auth.isDirector()) {
                filterVendeur = user.id;
                // Update the dropdown to match
                const select = document.getElementById('filter-vendeur');
                if (select) select.value = user.id;
            }
        }

        if (currentView === 'kanban') renderKanban();
        else renderList();
        renderMiniPipeline();
    }

    function renderKanban() {
        const board = document.getElementById('kanban-board');
        if (!board) return;

        const stages = Deals.getStages();
        board.innerHTML = '';

        stages.forEach(stage => {
            let stageDeals = Deals.getByStage(stage.id);

            // Apply filters
            if (filterVendeur) stageDeals = stageDeals.filter(d => d.assignedTo === filterVendeur);
            if (filterClientType) stageDeals = stageDeals.filter(d => d.clientType === filterClientType);

            const col = document.createElement('div');
            col.className = 'kanban-column';
            col.dataset.stage = stage.id;

            const stageValue = stageDeals.reduce((sum, d) => sum + (d.quoteAmount || 0), 0);
            const hasOverdue = stageDeals.some(d => App.getDeadlineStatus(d)?.status === 'overdue');

            col.innerHTML = `
                <div class="kanban-column-header" style="border-top: 3px solid ${stage.color}">
                    <div>
                        <span class="kanban-column-title">${stage.name}</span>
                        ${hasOverdue ? '<span style="color:#ef4444;margin-left:4px" title="Deals en retard">🔴</span>' : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <span class="kanban-column-count">${stageDeals.length}</span>
                        ${stageValue > 0 ? `<span style="font-size:11px;color:var(--text-muted)">${Deals.formatMoney(stageValue)}</span>` : ''}
                    </div>
                </div>
                <div class="kanban-column-body" data-stage="${stage.id}">
                    ${stageDeals.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Aucun deal</div>' : stageDeals.map(deal => renderCard(deal)).join('')}
                </div>
            `;

            board.appendChild(col);
        });

        // Setup drag & drop
        setupDragAndDrop();
    }

    function renderCard(deal) {
        const delay = Deals.getLeadToQuoteDelay(deal);
        const daysSinceUpdate = Deals.getDaysSince(deal.updatedAt);
        const overdue = Deals.isOverdue(deal);
        const deadline = App.getDeadlineStatus(deal);
        const team = Auth.getTeamMembers();
        const vendor = team.find(t => t.id === deal.assignedTo);
        const vendorInitials = vendor ? vendor.initials : '?';
        const vendorName = vendor ? vendor.name.split(' ')[0] : 'Non assigné';

        let cardClass = 'kanban-card';
        if (deadline?.status === 'overdue') cardClass += ' overdue';
        else if (deadline?.status === 'due-soon') cardClass += ' due-soon';
        else if (overdue) cardClass += ' overdue';

        return `
            <div class="${cardClass}"
                 draggable="true"
                 data-deal-id="${deal.id}"
                 onclick="App.openDeal('${deal.id}')">
                <div class="card-client">
                    ${deal.clientName}
                    ${deadline?.status === 'overdue' ? `<span class="overdue-badge">🚨 ${deadline.label}</span>` : ''}
                    ${deadline?.status === 'due-soon' ? `<span class="due-soon-badge">⚠️ ${deadline.label}</span>` : ''}
                </div>
                <div class="card-products">
                    <span class="card-type-badge ${deal.clientType}">${deal.clientType === 'entrepreneur' ? 'ENTR' : 'RÉG'}</span>
                    ${deal.products === 'les-deux' ? 'Portes + Fenêtres' : deal.products === 'fenetres' ? 'Fenêtres' : deal.products === 'portes' ? 'Portes' : deal.products || ''}
                </div>
                <div class="card-amount">${Deals.formatMoney(deal.quoteAmount)}</div>
                <div class="card-meta">
                    <span class="card-vendeur">
                        <span class="mini-avatar">${vendorInitials}</span>
                        ${vendorName}
                    </span>
                    ${delay !== null ? `<span class="card-delay">${delay}j lead→soum.</span>` : ''}
                    ${overdue && !deadline ? `<span class="card-delay">${daysSinceUpdate}j sans action</span>` : ''}
                </div>
            </div>
        `;
    }

    function setupDragAndDrop() {
        const cards = document.querySelectorAll('.kanban-card');
        const bodies = document.querySelectorAll('.kanban-column-body');

        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                draggedCard = card;
                card.classList.add('dragging');
                e.dataTransfer.setData('text/plain', card.dataset.dealId);
                e.dataTransfer.effectAllowed = 'move';
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                draggedCard = null;
                bodies.forEach(b => b.classList.remove('drag-over'));
            });
        });

        bodies.forEach(body => {
            body.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                body.classList.add('drag-over');
            });

            body.addEventListener('dragleave', () => {
                body.classList.remove('drag-over');
            });

            body.addEventListener('drop', async (e) => {
                e.preventDefault();
                body.classList.remove('drag-over');
                const dealId = e.dataTransfer.getData('text/plain');
                const newStage = parseInt(body.dataset.stage);

                if (dealId && newStage) {
                    await Deals.update(dealId, { stage: newStage });
                    render();
                    Alerts.refresh();
                    App.showToast(`Deal déplacé vers "${Deals.getStageName(newStage)}"`, 'success');
                }
            });
        });
    }

    function renderList() {
        const container = document.getElementById('deals-tbody');
        if (!container) return;

        let active = Deals.getActive();
        if (filterVendeur) active = active.filter(d => d.assignedTo === filterVendeur);
        if (filterClientType) active = active.filter(d => d.clientType === filterClientType);

        container.innerHTML = active.map(deal => {
            const delay = Deals.getLeadToQuoteDelay(deal);
            const overdue = Deals.isOverdue(deal);
            const team = Auth.getTeamMembers();
            const vendor = team.find(t => t.id === deal.assignedTo);

            return `
                <tr onclick="App.openDeal('${deal.id}')" style="cursor:pointer">
                    <td>
                        <strong>${deal.clientName}</strong>
                        <br><small style="color:var(--text-muted)">${deal.clientPhone}</small>
                    </td>
                    <td>
                        <span class="stage-badge" style="background:${Deals.getStageColor(deal.stage)}20; color:${Deals.getStageColor(deal.stage)}">
                            ${Deals.getStageName(deal.stage)}
                        </span>
                    </td>
                    <td><strong>${Deals.formatMoney(deal.quoteAmount)}</strong></td>
                    <td>${vendor ? vendor.name : 'Non assigné'}</td>
                    <td>${Deals.formatDate(deal.leadDate)}</td>
                    <td>
                        <span class="delay-badge ${overdue ? 'overdue' : 'ok'}">
                            ${delay !== null ? delay + 'j' : '--'}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); App.openDeal('${deal.id}')">Ouvrir</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderMiniPipeline() {
        const container = document.getElementById('pipeline-mini');
        if (!container) return;

        const stageStats = Deals.getStageStats();
        container.innerHTML = stageStats.map(stage => `
            <div class="pipeline-mini-item" style="border-top-color: ${stage.color}"
                 onclick="App.navigate('pipeline')">
                <div class="pipeline-mini-count">${stage.count}</div>
                <div class="pipeline-mini-label">${stage.name}</div>
                <div class="pipeline-mini-amount">${Deals.formatMoney(stage.value)}</div>
            </div>
        `).join('');
    }

    function setFilter(vendeur, clientType) {
        filterVendeur = vendeur || '';
        filterClientType = clientType || '';
        render();
    }

    function setView(view) {
        currentView = view;
        const kanbanEl = document.getElementById('kanban-board');
        const listEl = document.getElementById('list-view');
        const tableSection = document.getElementById('view-deals');

        if (view === 'kanban') {
            if (kanbanEl) kanbanEl.classList.remove('hidden');
            if (listEl) listEl.classList.add('hidden');
        } else {
            if (kanbanEl) kanbanEl.classList.add('hidden');
            if (listEl) listEl.classList.remove('hidden');
        }
        render();
    }

    // Populate vendor filter dropdowns
    function populateFilters() {
        const team = Auth.getTeamMembers();
        const user = Auth.getUser();
        const selects = document.querySelectorAll('#filter-vendeur, #deals-filter-vendeur');
        selects.forEach(select => {
            const current = select.value;
            select.innerHTML = '<option value="">Tous les vendeurs</option>';
            // Put "Mes deals" as first option for non-directors
            if (user && !Auth.isDirector()) {
                select.innerHTML += `<option value="${user.id}">⭐ Mes deals</option>`;
            }
            team.forEach(member => {
                if (['vendeur', 'directeur', 'directeur_usine'].includes(member.role)) {
                    if (member.id === user?.id && !Auth.isDirector()) return; // skip - already added above
                    select.innerHTML += `<option value="${member.id}">${member.name}</option>`;
                }
            });
            select.value = current;
        });

        // Populate stage filters
        const stageSelect = document.getElementById('deals-filter-stage');
        if (stageSelect) {
            stageSelect.innerHTML = '<option value="">Toutes les étapes</option>';
            Deals.STAGES.forEach(s => {
                stageSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
            });
        }

        // Populate deal form stage select
        const dealStageSelect = document.getElementById('deal-stage-select');
        if (dealStageSelect) {
            dealStageSelect.innerHTML = '';
            Deals.STAGES.forEach(s => {
                dealStageSelect.innerHTML += `<option value="${s.id}">${s.id}. ${s.name}</option>`;
            });
        }

        // Populate deal form vendor select
        const dealVendorSelect = document.getElementById('deal-vendor-select');
        if (dealVendorSelect) {
            dealVendorSelect.innerHTML = '<option value="">Non assigné</option>';
            team.forEach(member => {
                if (['vendeur', 'directeur', 'directeur_usine'].includes(member.role)) {
                    dealVendorSelect.innerHTML += `<option value="${member.id}">${member.name}</option>`;
                }
            });
        }
    }

    return {
        render,
        renderKanban,
        renderList,
        renderMiniPipeline,
        setFilter,
        setView,
        populateFilters,
    };
})();
