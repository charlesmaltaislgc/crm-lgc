// ===== CRM LGC - Team Management Module =====
// Director view: assign leads, tasks, monitor performance

const Team = (() => {
    const TASKS_KEY = 'crm_tasks';
    let tasks = [];

    async function loadTasks() {
        if (Auth.useLocalStorage()) {
            const saved = localStorage.getItem(TASKS_KEY);
            tasks = saved ? JSON.parse(saved) : generateDemoTasks();
            if (!saved) saveTasks();
        } else {
            tasks = await Graph.getListItems('CRM_Tasks') || [];
        }
        return tasks;
    }

    function saveTasks() {
        localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    }

    async function createTask(taskData) {
        const task = {
            id: Auth.useLocalStorage() ? 'T' + Date.now() : null,
            ...taskData,
            taskStatus: 'pending',
            createdAt: new Date().toISOString(),
            createdBy: Auth.getUser().name,
        };

        if (Auth.useLocalStorage()) {
            tasks.push(task);
            saveTasks();
        } else {
            const created = await Graph.createListItem('CRM_Tasks', task);
            if (created) task.id = created.id;
            tasks.push(task);
        }

        App.showToast(`Tâche assignée à ${getTeamMemberName(task.assignedTo)}`, 'success');
        return task;
    }

    async function updateTask(id, updates) {
        const idx = tasks.findIndex(t => t.id === id);
        if (idx === -1) return;
        tasks[idx] = { ...tasks[idx], ...updates };

        if (Auth.useLocalStorage()) {
            saveTasks();
        } else {
            await Graph.updateListItem('CRM_Tasks', id, updates);
        }
    }

    async function completeTask(id) {
        await updateTask(id, { taskStatus: 'completed', completedAt: new Date().toISOString() });
        App.showToast('Tâche complétée', 'success');
    }

    function getTeamMemberName(id) {
        const member = Auth.getTeamMembers().find(m => m.id === id);
        return member ? member.name : 'Inconnu';
    }

    function getTasksForMember(memberId) {
        return tasks.filter(t => t.assignedTo === memberId && t.taskStatus !== 'completed');
    }

    function getOverdueTasks() {
        const today = new Date().toISOString().split('T')[0];
        return tasks.filter(t => t.taskStatus !== 'completed' && t.deadline && t.deadline < today);
    }

    function render() {
        renderTeamGrid();
        renderTasksList();
    }

    function renderTeamGrid() {
        const container = document.getElementById('team-grid');
        if (!container) return;

        const team = Auth.getTeamMembers().filter(m => ['vendeur', 'directeur', 'directeur_usine'].includes(m.role));

        container.innerHTML = team.map(member => {
            const memberDeals = Deals.getByVendeur(member.id);
            const activeDeals = memberDeals.filter(d => d.status === 'active');
            const wonDeals = memberDeals.filter(d => d.status === 'won');
            const pipelineValue = activeDeals.reduce((sum, d) => sum + (d.quoteAmount || 0), 0);
            const overdueDeals = activeDeals.filter(d => Deals.isOverdue(d)).length;
            const memberTasks = getTasksForMember(member.id);

            // Avg delay lead→soumission
            const delays = activeDeals
                .map(d => Deals.getLeadToQuoteDelay(d))
                .filter(d => d !== null && d >= 0);
            const avgDelay = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : '--';

            const bgColor = member.role === 'directeur' ? 'var(--primary)' : 'var(--info)';

            return `
                <div class="team-card">
                    <div class="team-card-header">
                        <div class="avatar" style="background:${bgColor}">${member.initials}</div>
                        <div>
                            <div class="team-card-name">${member.name}</div>
                            <div class="team-card-role">${member.role}</div>
                        </div>
                    </div>
                    <div class="team-card-stats">
                        <div class="team-stat">
                            <div class="team-stat-value">${activeDeals.length}</div>
                            <div class="team-stat-label">Deals actifs</div>
                        </div>
                        <div class="team-stat">
                            <div class="team-stat-value">${Deals.formatMoney(pipelineValue)}</div>
                            <div class="team-stat-label">Pipeline</div>
                        </div>
                        <div class="team-stat">
                            <div class="team-stat-value" style="color:${overdueDeals > 0 ? 'var(--danger)' : 'var(--success)'}">${overdueDeals}</div>
                            <div class="team-stat-label">En retard</div>
                        </div>
                        <div class="team-stat">
                            <div class="team-stat-value">${avgDelay}j</div>
                            <div class="team-stat-label">Délai moy.</div>
                        </div>
                        <div class="team-stat">
                            <div class="team-stat-value">${wonDeals.length}</div>
                            <div class="team-stat-label">Gagnés</div>
                        </div>
                        <div class="team-stat">
                            <div class="team-stat-value">${memberTasks.length}</div>
                            <div class="team-stat-label">Tâches</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderTasksList() {
        const container = document.getElementById('team-tasks-list');
        if (!container) return;

        const today = new Date().toISOString().split('T')[0];
        const pendingTasks = tasks.filter(t => t.taskStatus !== 'completed')
            .sort((a, b) => {
                // Overdue first, then by deadline
                const aOverdue = a.deadline && a.deadline < today;
                const bOverdue = b.deadline && b.deadline < today;
                if (aOverdue && !bOverdue) return -1;
                if (!aOverdue && bOverdue) return 1;
                return (a.deadline || '').localeCompare(b.deadline || '');
            });

        if (pendingTasks.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Aucune tâche en cours</div>';
            return;
        }

        container.innerHTML = pendingTasks.map(task => {
            const isOverdue = task.deadline && task.deadline < today;
            const deal = task.dealId ? Deals.getById(task.dealId) : null;

            return `
                <div class="task-item ${isOverdue ? 'overdue' : ''}">
                    <div class="task-checkbox ${task.taskStatus === 'completed' ? 'checked' : ''}"
                         onclick="Team.completeTask('${task.id}'); Team.render();">
                        ${task.taskStatus === 'completed' ? '✓' : ''}
                    </div>
                    <div class="task-info">
                        <div class="task-description">${task.taskDescription}</div>
                        <div class="task-meta">
                            Assigné à: ${getTeamMemberName(task.assignedTo)}
                            ${deal ? ` | Deal: ${deal.clientName}` : ''}
                            ${task.priority === 'urgent' ? ' | <strong style="color:var(--danger)">URGENT</strong>' : ''}
                            ${task.priority === 'high' ? ' | <strong style="color:var(--warning)">Priorité haute</strong>' : ''}
                        </div>
                    </div>
                    <div class="task-deadline ${isOverdue ? 'overdue' : ''}">
                        ${task.deadline ? Deals.formatDate(task.deadline) : 'Pas de date'}
                        ${isOverdue ? ' (EN RETARD)' : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function populateTaskForm() {
        const assigneeSelect = document.getElementById('task-assignee-select');
        if (assigneeSelect) {
            assigneeSelect.innerHTML = '<option value="">Sélectionner...</option>';
            Auth.getTeamMembers().forEach(m => {
                assigneeSelect.innerHTML += `<option value="${m.id}">${m.name} (${m.role})</option>`;
            });
        }

        const dealSelect = document.getElementById('task-deal-select');
        if (dealSelect) {
            dealSelect.innerHTML = '<option value="">Aucun</option>';
            Deals.getActive().forEach(d => {
                dealSelect.innerHTML += `<option value="${d.id}">${d.clientName}</option>`;
            });
        }
    }

    function generateDemoTasks() {
        return [
            { id: 'T1', taskDescription: 'Prendre les mesures chez Tremblay', assignedTo: 'alain', dealId: 'D1000', deadline: '2026-03-24', priority: 'high', taskStatus: 'pending', createdBy: 'Charles Maltais', createdAt: '2026-03-20T10:00:00Z' },
            { id: 'T2', taskDescription: 'Relancer Mme Gagnon pour la soumission', assignedTo: 'sylvain', dealId: 'D1001', deadline: '2026-03-26', priority: 'normal', taskStatus: 'pending', createdBy: 'Charles Maltais', createdAt: '2026-03-22T14:00:00Z' },
            { id: 'T3', taskDescription: 'Envoyer contrat électronique à M. Roy', assignedTo: 'fabien', dealId: 'D1002', deadline: '2026-03-27', priority: 'urgent', taskStatus: 'pending', createdBy: 'Charles Maltais', createdAt: '2026-03-25T09:00:00Z' },
            { id: 'T4', taskDescription: 'Vérifier acompte Construction ABC', assignedTo: 'sabra', dealId: 'D1020', deadline: '2026-03-25', priority: 'high', taskStatus: 'pending', createdBy: 'Charles Maltais', createdAt: '2026-03-23T11:00:00Z' },
            { id: 'T5', taskDescription: 'Entrer soumission Côté dans Mec-inov', assignedTo: 'nathalie', dealId: 'D1004', deadline: '2026-03-27', priority: 'normal', taskStatus: 'pending', createdBy: 'Charles Maltais', createdAt: '2026-03-25T10:00:00Z' },
            { id: 'T6', taskDescription: 'Vérifier production commande Gauthier', assignedTo: 'keven', dealId: 'D1008', deadline: '2026-03-28', priority: 'normal', taskStatus: 'pending', createdBy: 'Charles Maltais', createdAt: '2026-03-25T11:00:00Z' },
        ];
    }

    return {
        loadTasks,
        createTask,
        updateTask,
        completeTask,
        getTasksForMember,
        getOverdueTasks,
        render,
        renderTeamGrid,
        renderTasksList,
        populateTaskForm,
    };
})();
