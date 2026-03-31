// ===== CRM LGC - Custom Fields Module =====
// User-defined custom fields for deals, contacts, and activities

const CustomFields = (() => {
    const STORAGE_KEY = 'crm_custom_fields';
    const VALUES_KEY = 'crm_custom_values';

    const FIELD_TYPES = [
        { id: 'text', label: 'Texte', icon: '\u{1f4dd}' },
        { id: 'number', label: 'Nombre', icon: '#\ufe0f\u20e3' },
        { id: 'date', label: 'Date', icon: '\u{1f4c5}' },
        { id: 'select', label: 'Liste', icon: '\u{1f4cb}' },
        { id: 'checkbox', label: 'Case \u00e0 cocher', icon: '\u2611\ufe0f' },
        { id: 'url', label: 'URL', icon: '\u{1f517}' },
        { id: 'phone', label: 'T\u00e9l\u00e9phone', icon: '\u{1f4de}' },
        { id: 'email', label: 'Courriel', icon: '\u{1f4e7}' },
    ];

    const ENTITY_TABS = [
        { id: 'deal', label: 'Deals' },
        { id: 'contact', label: 'Contacts' },
        { id: 'activity', label: 'Activit\u00e9s' },
    ];

    let activeTab = 'deal';
    let editingFieldId = null;

    // ===== DATA =====
    function loadFields() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    }

    function saveFields(fields) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
    }

    function loadValues() {
        try {
            const saved = localStorage.getItem(VALUES_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    }

    function saveValues(values) {
        localStorage.setItem(VALUES_KEY, JSON.stringify(values));
    }

    // ===== FIELD CRUD =====
    function getFields(entity) {
        const fields = loadFields();
        return fields
            .filter(f => f.entity === entity)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    function saveField(field) {
        const fields = loadFields();

        if (!field.id) {
            field.id = 'cf_' + Date.now();
            field.order = fields.filter(f => f.entity === field.entity).length;
            fields.push(field);
        } else {
            const idx = fields.findIndex(f => f.id === field.id);
            if (idx >= 0) {
                fields[idx] = { ...fields[idx], ...field };
            }
        }

        saveFields(fields);
        return field;
    }

    function removeField(fieldId) {
        let fields = loadFields();
        fields = fields.filter(f => f.id !== fieldId);
        saveFields(fields);

        // Also remove all values for this field
        const values = loadValues();
        Object.keys(values).forEach(key => {
            if (key.endsWith('_' + fieldId)) {
                delete values[key];
            }
        });
        saveValues(values);
    }

    // ===== VALUES CRUD =====
    function _makeKey(entityType, entityId, fieldId) {
        return `${entityType}_${entityId}_${fieldId}`;
    }

    function getValue(entityType, entityId, fieldId) {
        const values = loadValues();
        return values[_makeKey(entityType, entityId, fieldId)] || null;
    }

    function setValue(entityType, entityId, fieldId, value) {
        const values = loadValues();
        values[_makeKey(entityType, entityId, fieldId)] = value;
        saveValues(values);
    }

    function getValues(entityType, entityId) {
        const fields = getFields(entityType);
        const values = loadValues();
        const result = {};

        fields.forEach(field => {
            const key = _makeKey(entityType, entityId, field.id);
            result[field.id] = {
                field,
                value: values[key] !== undefined ? values[key] : (field.defaultValue || null)
            };
        });

        return result;
    }

    // ===== RENDER FIELDS IN FORMS =====
    function renderFields(entityType, entityId, container, editable = true) {
        const fields = getFields(entityType);
        if (!container) return;

        if (fields.length === 0) {
            container.innerHTML = '<p style="color:#94a3b8;font-size:0.8rem;margin:8px 0;">Aucun champ personnalis\u00e9</p>';
            return;
        }

        const values = loadValues();
        let currentGroup = '';

        container.innerHTML = fields.map(field => {
            const key = _makeKey(entityType, entityId, field.id);
            const val = values[key] !== undefined ? values[key] : (field.defaultValue || '');
            const typeInfo = FIELD_TYPES.find(t => t.id === field.type) || { icon: '\u2699\ufe0f' };

            let groupHeader = '';
            if (field.group && field.group !== currentGroup) {
                currentGroup = field.group;
                groupHeader = `<div style="font-weight:600;font-size:0.8rem;color:#64748b;margin:12px 0 4px;text-transform:uppercase;letter-spacing:.5px;">${field.group}</div>`;
            }

            let input = '';
            const baseStyle = 'width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:0.85rem;';
            const changeHandler = editable ? `onchange="CustomFields.setValue('${entityType}','${entityId}','${field.id}',this.${field.type === 'checkbox' ? 'checked' : 'value'})"` : 'disabled';

            switch (field.type) {
                case 'text':
                    input = `<input type="text" value="${(val + '').replace(/"/g, '&quot;')}" ${changeHandler} style="${baseStyle}" ${!editable ? 'disabled' : ''}>`;
                    break;
                case 'number':
                    input = `<input type="number" value="${val}" ${changeHandler} style="${baseStyle}" ${!editable ? 'disabled' : ''}>`;
                    break;
                case 'date':
                    input = `<input type="date" value="${val}" ${changeHandler} style="${baseStyle}" ${!editable ? 'disabled' : ''}>`;
                    break;
                case 'select':
                    const options = (field.options || []);
                    input = `<select ${changeHandler} style="${baseStyle}" ${!editable ? 'disabled' : ''}>
                        <option value="">-- Choisir --</option>
                        ${options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
                    </select>`;
                    break;
                case 'checkbox':
                    input = `<label style="display:flex;align-items:center;gap:6px;cursor:${editable ? 'pointer' : 'default'};">
                        <input type="checkbox" ${val ? 'checked' : ''} ${changeHandler} ${!editable ? 'disabled' : ''}>
                        <span style="font-size:0.85rem;">${field.name}</span>
                    </label>`;
                    break;
                case 'url':
                    input = `<input type="url" value="${(val + '').replace(/"/g, '&quot;')}" ${changeHandler} placeholder="https://..." style="${baseStyle}" ${!editable ? 'disabled' : ''}>`;
                    break;
                case 'phone':
                    input = `<input type="tel" value="${(val + '').replace(/"/g, '&quot;')}" ${changeHandler} placeholder="(555) 123-4567" style="${baseStyle}" ${!editable ? 'disabled' : ''}>`;
                    break;
                case 'email':
                    input = `<input type="email" value="${(val + '').replace(/"/g, '&quot;')}" ${changeHandler} placeholder="courriel@exemple.com" style="${baseStyle}" ${!editable ? 'disabled' : ''}>`;
                    break;
                default:
                    input = `<input type="text" value="${(val + '').replace(/"/g, '&quot;')}" ${changeHandler} style="${baseStyle}" ${!editable ? 'disabled' : ''}>`;
            }

            return `
                ${groupHeader}
                <div style="margin-bottom:10px;">
                    ${field.type !== 'checkbox' ? `
                        <label style="display:block;font-size:0.8rem;font-weight:500;margin-bottom:3px;">
                            ${typeInfo.icon} ${field.name}
                            ${field.required ? '<span style="color:#ef4444;">*</span>' : ''}
                        </label>
                    ` : ''}
                    ${input}
                </div>
            `;
        }).join('');
    }

    function renderFieldsReadonly(entityType, entityId, container) {
        const fields = getFields(entityType);
        if (!container) return;

        if (fields.length === 0) {
            container.innerHTML = '';
            return;
        }

        const values = loadValues();

        container.innerHTML = fields.map(field => {
            const key = _makeKey(entityType, entityId, field.id);
            const val = values[key] !== undefined ? values[key] : (field.defaultValue || '');
            const typeInfo = FIELD_TYPES.find(t => t.id === field.type) || { icon: '\u2699\ufe0f' };

            if (!val && val !== 0 && val !== false) return '';

            let display = val;
            if (field.type === 'checkbox') display = val ? 'Oui' : 'Non';
            if (field.type === 'url' && val) display = `<a href="${val}" target="_blank" style="color:#3b82f6;text-decoration:none;">${val}</a>`;
            if (field.type === 'email' && val) display = `<a href="mailto:${val}" style="color:#3b82f6;text-decoration:none;">${val}</a>`;

            return `
                <div style="display:flex;gap:8px;margin-bottom:6px;font-size:0.85rem;">
                    <span style="color:#64748b;min-width:120px;">${typeInfo.icon} ${field.name}:</span>
                    <span style="font-weight:500;">${display}</span>
                </div>
            `;
        }).filter(Boolean).join('');
    }

    // ===== SETTINGS PAGE =====
    function render() {
        const content = document.getElementById('custom-fields-settings');
        if (!content) return;

        const fields = getFields(activeTab);
        const allFields = loadFields();
        const totalCount = allFields.length;

        content.innerHTML = `
            <div style="max-width:900px;margin:0 auto;padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
                    <div>
                        <h2 style="margin:0;font-size:1.5rem;">\u2699\ufe0f Champs personnalis\u00e9s</h2>
                        <p style="margin:4px 0 0;color:#64748b;font-size:0.9rem;">${totalCount} champ${totalCount !== 1 ? 's' : ''} personnalis\u00e9${totalCount !== 1 ? 's' : ''}</p>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="CustomFields._openFieldForm()">
                        + Ajouter un champ
                    </button>
                </div>

                <!-- Tabs -->
                <div style="display:flex;gap:4px;margin-bottom:20px;border-bottom:2px solid #e2e8f0;padding-bottom:0;">
                    ${ENTITY_TABS.map(tab => `
                        <button onclick="CustomFields._switchTab('${tab.id}')"
                            style="padding:8px 20px;border:none;background:${activeTab === tab.id ? '#fff' : 'transparent'};
                            border-bottom:2px solid ${activeTab === tab.id ? '#3b82f6' : 'transparent'};
                            margin-bottom:-2px;cursor:pointer;font-weight:${activeTab === tab.id ? '600' : '400'};
                            color:${activeTab === tab.id ? '#1e293b' : '#64748b'};font-size:0.9rem;">
                            ${tab.label}
                            <span style="background:${activeTab === tab.id ? '#dbeafe' : '#f1f5f9'};color:${activeTab === tab.id ? '#2563eb' : '#94a3b8'};
                                font-size:0.7rem;padding:1px 6px;border-radius:10px;margin-left:4px;">
                                ${loadFields().filter(f => f.entity === tab.id).length}
                            </span>
                        </button>
                    `).join('')}
                </div>

                <!-- Field list -->
                <div id="cf-field-list">
                    ${fields.length === 0 ? `
                        <div style="text-align:center;padding:60px 20px;color:#94a3b8;">
                            <div style="font-size:3rem;margin-bottom:12px;">\u2699\ufe0f</div>
                            <p style="font-size:1.1rem;margin:0;">Aucun champ personnalis\u00e9 pour ${ENTITY_TABS.find(t => t.id === activeTab)?.label || activeTab}</p>
                            <p style="margin:8px 0 16px;font-size:0.9rem;">Ajoutez des champs pour enrichir vos donn\u00e9es</p>
                            <button class="btn btn-primary btn-sm" onclick="CustomFields._openFieldForm()">+ Ajouter un champ</button>
                        </div>
                    ` : fields.map((field, i) => renderFieldRow(field, i, fields.length)).join('')}
                </div>
            </div>
        `;
    }

    function renderFieldRow(field, index, total) {
        const typeInfo = FIELD_TYPES.find(t => t.id === field.type) || { icon: '\u2699\ufe0f', label: field.type };

        return `
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:6px;display:flex;align-items:center;gap:12px;">
                <div style="display:flex;flex-direction:column;gap:2px;cursor:grab;color:#cbd5e1;font-size:0.7rem;user-select:none;" title="R\u00e9ordonner">
                    ${index > 0 ? `<button onclick="CustomFields._reorder('${field.id}',-1)" style="background:none;border:none;cursor:pointer;padding:0;font-size:0.8rem;color:#94a3b8;" title="Monter">\u25b2</button>` : '<span style="visibility:hidden;">\u25b2</span>'}
                    ${index < total - 1 ? `<button onclick="CustomFields._reorder('${field.id}',1)" style="background:none;border:none;cursor:pointer;padding:0;font-size:0.8rem;color:#94a3b8;" title="Descendre">\u25bc</button>` : '<span style="visibility:hidden;">\u25bc</span>'}
                </div>
                <div style="font-size:1.3rem;width:32px;text-align:center;">${typeInfo.icon}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.9rem;">${field.name}</div>
                    <div style="color:#94a3b8;font-size:0.75rem;margin-top:1px;">
                        ${typeInfo.label}
                        ${field.required ? ' \u2022 <span style="color:#ef4444;">Requis</span>' : ''}
                        ${field.group ? ` \u2022 Groupe: ${field.group}` : ''}
                        ${field.type === 'select' && field.options ? ` \u2022 ${field.options.length} option${field.options.length > 1 ? 's' : ''}` : ''}
                    </div>
                </div>
                <button class="btn btn-sm" onclick="CustomFields._openFieldForm('${field.id}')" style="background:none;border:none;cursor:pointer;font-size:1rem;" title="Modifier">\u270f\ufe0f</button>
                <button class="btn btn-sm" onclick="CustomFields._confirmRemove('${field.id}','${field.name.replace(/'/g, "\\'")}')" style="background:none;border:none;cursor:pointer;font-size:1rem;color:#ef4444;" title="Supprimer">\u{1f5d1}\ufe0f</button>
            </div>
        `;
    }

    // ===== FIELD FORM MODAL =====
    function _openFieldForm(fieldId) {
        const existing = fieldId ? loadFields().find(f => f.id === fieldId) : null;
        editingFieldId = fieldId || null;

        const overlay = document.createElement('div');
        overlay.id = 'cf-form-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

        overlay.innerHTML = `
            <div style="background:#fff;border-radius:12px;padding:24px;width:480px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                    <h3 style="margin:0;">${existing ? 'Modifier le champ' : 'Nouveau champ personnalis\u00e9'}</h3>
                    <button onclick="document.getElementById('cf-form-overlay').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;">\u2715</button>
                </div>

                <label style="display:block;margin-bottom:4px;font-size:0.85rem;font-weight:600;">Entit\u00e9</label>
                <select id="cf-entity" class="input-sm" style="width:100%;padding:8px;margin-bottom:12px;" ${existing ? 'disabled' : ''}>
                    ${ENTITY_TABS.map(t => `<option value="${t.id}" ${(existing?.entity || activeTab) === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
                </select>

                <label style="display:block;margin-bottom:4px;font-size:0.85rem;font-weight:600;">Nom du champ</label>
                <input type="text" id="cf-name" class="input-sm" value="${existing?.name || ''}" placeholder="Ex: Num\u00e9ro de commande" style="width:100%;padding:8px;margin-bottom:12px;">

                <label style="display:block;margin-bottom:4px;font-size:0.85rem;font-weight:600;">Type</label>
                <select id="cf-type" class="input-sm" style="width:100%;padding:8px;margin-bottom:12px;" onchange="CustomFields._toggleOptions(this.value)">
                    ${FIELD_TYPES.map(t => `<option value="${t.id}" ${existing?.type === t.id ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
                </select>

                <div id="cf-options-section" style="display:${existing?.type === 'select' ? 'block' : 'none'};margin-bottom:12px;">
                    <label style="display:block;margin-bottom:4px;font-size:0.85rem;font-weight:600;">Options (une par ligne)</label>
                    <textarea id="cf-options" class="input-sm" rows="4" placeholder="Option 1\nOption 2\nOption 3" style="width:100%;padding:8px;resize:vertical;">${(existing?.options || []).join('\n')}</textarea>
                </div>

                <label style="display:block;margin-bottom:4px;font-size:0.85rem;font-weight:600;">Groupe (optionnel)</label>
                <input type="text" id="cf-group" class="input-sm" value="${existing?.group || ''}" placeholder="Ex: Infos techniques" style="width:100%;padding:8px;margin-bottom:12px;">

                <label style="display:block;margin-bottom:4px;font-size:0.85rem;font-weight:600;">Valeur par d\u00e9faut (optionnel)</label>
                <input type="text" id="cf-default" class="input-sm" value="${existing?.defaultValue || ''}" style="width:100%;padding:8px;margin-bottom:12px;">

                <label style="display:flex;align-items:center;gap:8px;margin-bottom:20px;cursor:pointer;">
                    <input type="checkbox" id="cf-required" ${existing?.required ? 'checked' : ''}>
                    <span style="font-size:0.9rem;">Champ requis</span>
                </label>

                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-sm" onclick="document.getElementById('cf-form-overlay').remove()" style="background:#f1f5f9;border:1px solid #e2e8f0;">Annuler</button>
                    <button class="btn btn-primary btn-sm" onclick="CustomFields._saveFieldForm()">${existing ? 'Modifier' : 'Cr\u00e9er'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    function _toggleOptions(type) {
        const section = document.getElementById('cf-options-section');
        if (section) section.style.display = type === 'select' ? 'block' : 'none';
    }

    function _saveFieldForm() {
        const name = document.getElementById('cf-name')?.value.trim();
        const entity = document.getElementById('cf-entity')?.value;
        const type = document.getElementById('cf-type')?.value;
        const group = document.getElementById('cf-group')?.value.trim();
        const defaultValue = document.getElementById('cf-default')?.value.trim();
        const required = document.getElementById('cf-required')?.checked || false;
        const optionsText = document.getElementById('cf-options')?.value || '';

        if (!name) {
            App.showToast('Le nom du champ est requis', 'warning');
            return;
        }

        const field = {
            id: editingFieldId || null,
            entity,
            name,
            type,
            group: group || '',
            defaultValue: defaultValue || '',
            required,
            options: type === 'select' ? optionsText.split('\n').map(o => o.trim()).filter(Boolean) : []
        };

        saveField(field);
        document.getElementById('cf-form-overlay')?.remove();
        App.showToast(editingFieldId ? 'Champ modifi\u00e9!' : 'Champ cr\u00e9\u00e9!', 'success');
        editingFieldId = null;
        render();
    }

    function _confirmRemove(fieldId, fieldName) {
        if (confirm(`Supprimer le champ "${fieldName}" et toutes ses valeurs?`)) {
            removeField(fieldId);
            App.showToast('Champ supprim\u00e9', 'success');
            render();
        }
    }

    function _switchTab(tab) {
        activeTab = tab;
        render();
    }

    function _reorder(fieldId, direction) {
        const fields = loadFields();
        const entityFields = fields.filter(f => f.entity === activeTab).sort((a, b) => (a.order || 0) - (b.order || 0));
        const idx = entityFields.findIndex(f => f.id === fieldId);

        if (idx < 0) return;
        const swapIdx = idx + direction;
        if (swapIdx < 0 || swapIdx >= entityFields.length) return;

        // Swap order values
        const tempOrder = entityFields[idx].order;
        entityFields[idx].order = entityFields[swapIdx].order;
        entityFields[swapIdx].order = tempOrder;

        // If orders were equal, assign sequential
        if (entityFields[idx].order === entityFields[swapIdx].order) {
            entityFields[idx].order = swapIdx;
            entityFields[swapIdx].order = idx;
        }

        // Write back
        entityFields.forEach(ef => {
            const mainIdx = fields.findIndex(f => f.id === ef.id);
            if (mainIdx >= 0) fields[mainIdx] = ef;
        });

        saveFields(fields);
        render();
    }

    return {
        getFields,
        saveField,
        removeField,
        getValue,
        setValue,
        getValues,
        renderFields,
        renderFieldsReadonly,
        render,
        _openFieldForm,
        _toggleOptions,
        _saveFieldForm,
        _confirmRemove,
        _switchTab,
        _reorder
    };
})();
