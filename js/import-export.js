// ===== CRM LGC - Import / Export Module =====
// CSV import with column mapping, CSV export with filters

const ImportExport = (() => {
    const BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility

    // CRM field definitions for mapping
    const DEAL_FIELDS = [
        { id: 'name', label: 'Nom du deal', required: true },
        { id: 'clientName', label: 'Nom du client' },
        { id: 'phone', label: 'Téléphone' },
        { id: 'email', label: 'Courriel' },
        { id: 'address', label: 'Adresse' },
        { id: 'city', label: 'Ville' },
        { id: 'value', label: 'Valeur ($)' },
        { id: 'stageId', label: 'Étape (ID)' },
        { id: 'vendeur', label: 'Vendeur' },
        { id: 'source', label: 'Source' },
        { id: 'notes', label: 'Notes' },
        { id: 'date', label: 'Date de création' },
    ];

    const CONTACT_FIELDS = [
        { id: 'name', label: 'Nom', required: true },
        { id: 'phone', label: 'Téléphone' },
        { id: 'email', label: 'Courriel' },
        { id: 'address', label: 'Adresse' },
        { id: 'city', label: 'Ville' },
        { id: 'company', label: 'Entreprise' },
        { id: 'notes', label: 'Notes' },
    ];

    let importedData = null;
    let importMapping = {};
    let importType = 'deals';

    // ===== CSV PARSING =====
    function parseCSV(text) {
        const lines = [];
        let current = '';
        let inQuotes = false;
        let row = [];

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const next = text[i + 1];

            if (inQuotes) {
                if (ch === '"' && next === '"') {
                    current += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',' || ch === ';') {
                    row.push(current.trim());
                    current = '';
                } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
                    row.push(current.trim());
                    if (row.some(cell => cell !== '')) lines.push(row);
                    row = [];
                    current = '';
                    if (ch === '\r') i++;
                } else {
                    current += ch;
                }
            }
        }
        // Last row
        if (current || row.length > 0) {
            row.push(current.trim());
            if (row.some(cell => cell !== '')) lines.push(row);
        }

        return lines;
    }

    function generateCSV(data, columns) {
        if (!data || data.length === 0) return '';

        const headers = columns.map(c => escapeCSV(c.label));
        const rows = data.map(item =>
            columns.map(c => escapeCSV(String(item[c.id] || '')))
        );

        return BOM + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    }

    function escapeCSV(value) {
        if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes(';')) {
            return '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
    }

    function downloadCSV(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // ===== COLUMN MAPPING =====
    function mapColumns(headers) {
        const mapping = {};
        const normalize = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

        headers.forEach((h, i) => {
            const hn = normalize(h);
            const allFields = importType === 'deals' ? DEAL_FIELDS : CONTACT_FIELDS;
            const match = allFields.find(f => {
                const fn = normalize(f.label);
                const fi = normalize(f.id);
                return hn === fn || hn === fi || hn.includes(fi) || fn.includes(hn);
            });
            if (match) mapping[i] = match.id;
        });

        return mapping;
    }

    // ===== EXPORT FUNCTIONS =====
    function exportDeals(options = {}) {
        try {
            let deals = typeof Deals !== 'undefined' ? Deals.getAll() : [];

            // Date range filter
            if (options.dateFrom) {
                deals = deals.filter(d => d.date >= options.dateFrom);
            }
            if (options.dateTo) {
                deals = deals.filter(d => d.date <= options.dateTo);
            }

            // Status filter
            if (options.status) {
                deals = deals.filter(d => d.status === options.status);
            }

            const columns = options.columns || DEAL_FIELDS;
            const csv = generateCSV(deals, columns);
            const date = new Date().toISOString().split('T')[0];
            downloadCSV(csv, `deals_lgc_${date}.csv`);
            App.showToast(`${deals.length} deal${deals.length !== 1 ? 's' : ''} exporté${deals.length !== 1 ? 's' : ''}`, 'success');
        } catch (e) {
            App.showToast('Erreur lors de l\'exportation: ' + e.message, 'error');
        }
    }

    function exportContacts(options = {}) {
        try {
            const deals = typeof Deals !== 'undefined' ? Deals.getAll() : [];
            // Extract unique contacts from deals
            const contactMap = {};
            deals.forEach(d => {
                const key = (d.email || d.phone || d.clientName || '').toLowerCase();
                if (key && !contactMap[key]) {
                    contactMap[key] = {
                        name: d.clientName || d.name || '',
                        phone: d.phone || '',
                        email: d.email || '',
                        address: d.address || '',
                        city: d.city || '',
                        company: d.company || '',
                        notes: ''
                    };
                }
            });

            const contacts = Object.values(contactMap);
            const columns = options.columns || CONTACT_FIELDS;
            const csv = generateCSV(contacts, columns);
            const date = new Date().toISOString().split('T')[0];
            downloadCSV(csv, `contacts_lgc_${date}.csv`);
            App.showToast(`${contacts.length} contact${contacts.length !== 1 ? 's' : ''} exporté${contacts.length !== 1 ? 's' : ''}`, 'success');
        } catch (e) {
            App.showToast('Erreur lors de l\'exportation: ' + e.message, 'error');
        }
    }

    // ===== IMPORT FUNCTIONS =====
    function importDeals(rows, mapping) {
        if (!rows || rows.length === 0) return { created: 0, errors: [] };

        const errors = [];
        let created = 0;

        rows.forEach((row, i) => {
            try {
                const deal = {};
                Object.entries(mapping).forEach(([colIdx, fieldId]) => {
                    deal[fieldId] = row[parseInt(colIdx)] || '';
                });

                if (!deal.name && !deal.clientName) {
                    errors.push(`Ligne ${i + 2}: Nom manquant`);
                    return;
                }

                // Convert value to number
                if (deal.value) deal.value = parseFloat(deal.value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
                if (deal.stageId) deal.stageId = parseInt(deal.stageId) || 1;
                else deal.stageId = 1;

                if (!deal.date) deal.date = new Date().toISOString().split('T')[0];
                if (!deal.name) deal.name = deal.clientName;

                if (typeof Deals !== 'undefined') {
                    Deals.create(deal);
                    created++;
                }
            } catch (e) {
                errors.push(`Ligne ${i + 2}: ${e.message}`);
            }
        });

        return { created, errors };
    }

    function importContacts(rows, mapping) {
        // Contacts are stored as deals in simplified form
        if (!rows || rows.length === 0) return { created: 0, errors: [] };

        const errors = [];
        let created = 0;
        const existing = typeof Deals !== 'undefined' ? Deals.getAll() : [];

        rows.forEach((row, i) => {
            try {
                const contact = {};
                Object.entries(mapping).forEach(([colIdx, fieldId]) => {
                    contact[fieldId] = row[parseInt(colIdx)] || '';
                });

                if (!contact.name) {
                    errors.push(`Ligne ${i + 2}: Nom manquant`);
                    return;
                }

                // Duplicate check
                const isDuplicate = existing.some(d =>
                    (contact.email && d.email && d.email.toLowerCase() === contact.email.toLowerCase()) ||
                    (contact.phone && d.phone && d.phone.replace(/\D/g, '') === contact.phone.replace(/\D/g, ''))
                );

                if (isDuplicate) {
                    errors.push(`Ligne ${i + 2}: Doublon détecté (${contact.name})`);
                    return;
                }

                if (typeof Deals !== 'undefined') {
                    Deals.create({
                        name: contact.name,
                        clientName: contact.name,
                        phone: contact.phone || '',
                        email: contact.email || '',
                        address: contact.address || '',
                        city: contact.city || '',
                        company: contact.company || '',
                        notes: contact.notes || '',
                        stageId: 1,
                        value: 0,
                        date: new Date().toISOString().split('T')[0]
                    });
                    created++;
                }
            } catch (e) {
                errors.push(`Ligne ${i + 2}: ${e.message}`);
            }
        });

        return { created, errors };
    }

    function importCSV(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    let text = e.target.result;
                    // Remove BOM if present
                    if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
                    const rows = parseCSV(text);
                    resolve(rows);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
            reader.readAsText(file, 'UTF-8');
        });
    }

    // ===== RENDER =====
    function render() {
        const content = document.getElementById('import-export-content') || document.getElementById('main-content');
        if (!content) return;

        const dealCount = typeof Deals !== 'undefined' ? Deals.getAll().length : 0;

        content.innerHTML = `
            <div style="max-width:1100px;margin:0 auto;padding:20px;">
                <h2 style="margin:0 0 24px;font-size:1.5rem;">📁 Import / Export</h2>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                    <!-- IMPORT -->
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
                        <h3 style="margin:0 0 16px;font-size:1.1rem;">📥 Importer des données</h3>

                        <label style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;">Type de données</label>
                        <select id="import-type" class="input-sm" style="width:100%;padding:8px;margin-bottom:16px;" onchange="ImportExport._setImportType(this.value)">
                            <option value="deals">Deals / Soumissions</option>
                            <option value="contacts">Contacts</option>
                        </select>

                        <div id="import-dropzone"
                            ondragover="event.preventDefault();this.style.borderColor='#3b82f6';this.style.background='#eff6ff';"
                            ondragleave="this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';"
                            ondrop="event.preventDefault();this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';ImportExport._handleDrop(event);"
                            onclick="document.getElementById('import-file-input').click();"
                            style="border:2px dashed #cbd5e1;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#f8fafc;transition:.2s;">
                            <div style="font-size:2rem;margin-bottom:8px;">📂</div>
                            <p style="margin:0;font-weight:600;font-size:0.95rem;">Glissez un fichier CSV ici</p>
                            <p style="margin:4px 0 0;color:#94a3b8;font-size:0.8rem;">ou cliquez pour sélectionner</p>
                        </div>
                        <input type="file" id="import-file-input" accept=".csv,.txt" style="display:none;" onchange="ImportExport._handleFileSelect(event)">

                        <div id="import-preview" style="margin-top:16px;display:none;"></div>
                        <div id="import-mapping" style="margin-top:16px;display:none;"></div>
                        <div id="import-result" style="margin-top:16px;display:none;"></div>
                    </div>

                    <!-- EXPORT -->
                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
                        <h3 style="margin:0 0 16px;font-size:1.1rem;">📤 Exporter des données</h3>

                        <p style="color:#64748b;font-size:0.85rem;margin:0 0 16px;">${dealCount} deal${dealCount !== 1 ? 's' : ''} dans le CRM</p>

                        <!-- Export deals -->
                        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;">
                            <div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;">🏷️ Exporter les deals</div>

                            <label style="display:block;margin-bottom:6px;font-size:0.8rem;font-weight:600;">Période</label>
                            <div style="display:flex;gap:8px;margin-bottom:10px;">
                                <input type="date" id="export-date-from" class="input-sm" style="flex:1;padding:6px;">
                                <input type="date" id="export-date-to" class="input-sm" style="flex:1;padding:6px;">
                            </div>

                            <label style="display:block;margin-bottom:6px;font-size:0.8rem;font-weight:600;">Colonnes</label>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:12px;font-size:0.8rem;">
                                ${DEAL_FIELDS.map(f => `
                                    <label style="display:flex;align-items:center;gap:4px;">
                                        <input type="checkbox" data-export-col="${f.id}" checked> ${f.label}
                                    </label>
                                `).join('')}
                            </div>

                            <button class="btn btn-primary btn-sm" onclick="ImportExport._exportDeals()" style="width:100%;">
                                Télécharger CSV
                            </button>
                        </div>

                        <!-- Export contacts -->
                        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;">
                            <div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;">👥 Exporter les contacts</div>
                            <p style="color:#94a3b8;font-size:0.8rem;margin:0 0 12px;">Extrait les contacts uniques des deals</p>
                            <button class="btn btn-sm" onclick="ImportExport._exportContacts()" style="width:100%;background:#f1f5f9;border:1px solid #e2e8f0;">
                                Télécharger CSV
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ===== EVENT HANDLERS =====
    function _setImportType(type) {
        importType = type;
        importedData = null;
        importMapping = {};
        const preview = document.getElementById('import-preview');
        const mapping = document.getElementById('import-mapping');
        const result = document.getElementById('import-result');
        if (preview) preview.style.display = 'none';
        if (mapping) mapping.style.display = 'none';
        if (result) result.style.display = 'none';
    }

    function _handleDrop(event) {
        const files = event.dataTransfer.files;
        if (files.length > 0) _processFile(files[0]);
    }

    function _handleFileSelect(event) {
        const files = event.target.files;
        if (files.length > 0) _processFile(files[0]);
    }

    async function _processFile(file) {
        if (!file.name.match(/\.(csv|txt)$/i)) {
            App.showToast('Format non supporté. Utilisez un fichier CSV.', 'error');
            return;
        }

        try {
            const rows = await importCSV(file);
            if (rows.length < 2) {
                App.showToast('Le fichier semble vide ou n\'a qu\'un en-tête', 'warning');
                return;
            }

            importedData = { headers: rows[0], rows: rows.slice(1) };
            importMapping = mapColumns(importedData.headers);

            _renderPreview();
            _renderMapping();
        } catch (e) {
            App.showToast('Erreur de lecture: ' + e.message, 'error');
        }
    }

    function _renderPreview() {
        const el = document.getElementById('import-preview');
        if (!el || !importedData) return;

        const previewRows = importedData.rows.slice(0, 5);
        el.style.display = 'block';
        el.innerHTML = `
            <div style="font-weight:600;font-size:0.85rem;margin-bottom:8px;">Aperçu (${importedData.rows.length} lignes)</div>
            <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:6px;">
                <table style="width:100%;border-collapse:collapse;font-size:0.75rem;white-space:nowrap;">
                    <thead>
                        <tr style="background:#f8fafc;">
                            ${importedData.headers.map(h => `<th style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left;">${h}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${previewRows.map(row => `
                            <tr>
                                ${importedData.headers.map((_, i) => `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;">${row[i] || ''}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function _renderMapping() {
        const el = document.getElementById('import-mapping');
        if (!el || !importedData) return;

        const fields = importType === 'deals' ? DEAL_FIELDS : CONTACT_FIELDS;

        el.style.display = 'block';
        el.innerHTML = `
            <div style="font-weight:600;font-size:0.85rem;margin-bottom:8px;">Correspondance des colonnes</div>
            <div style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
                    <thead>
                        <tr style="background:#f8fafc;">
                            <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">Colonne CSV</th>
                            <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">→ Champ CRM</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${importedData.headers.map((h, i) => `
                            <tr style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:6px 8px;font-weight:500;">${h}</td>
                                <td style="padding:4px 8px;">
                                    <select data-map-col="${i}" class="input-sm" style="width:100%;padding:4px;" onchange="ImportExport._updateMapping(${i}, this.value)">
                                        <option value="">-- Ignorer --</option>
                                        ${fields.map(f => `<option value="${f.id}" ${importMapping[i] === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
                                    </select>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <button class="btn btn-primary btn-sm" onclick="ImportExport._runImport()" style="width:100%;margin-top:12px;">
                📥 Importer ${importedData.rows.length} ligne${importedData.rows.length > 1 ? 's' : ''}
            </button>
        `;
    }

    function _updateMapping(colIndex, fieldId) {
        if (fieldId) {
            importMapping[colIndex] = fieldId;
        } else {
            delete importMapping[colIndex];
        }
    }

    function _runImport() {
        if (!importedData || importedData.rows.length === 0) {
            App.showToast('Aucune donnée à importer', 'warning');
            return;
        }

        if (Object.keys(importMapping).length === 0) {
            App.showToast('Mappez au moins une colonne', 'warning');
            return;
        }

        let result;
        if (importType === 'deals') {
            result = importDeals(importedData.rows, importMapping);
        } else {
            result = importContacts(importedData.rows, importMapping);
        }

        const el = document.getElementById('import-result');
        if (el) {
            el.style.display = 'block';
            el.innerHTML = `
                <div style="padding:14px;border-radius:8px;background:${result.errors.length === 0 ? '#f0fdf4' : '#fefce8'};border:1px solid ${result.errors.length === 0 ? '#bbf7d0' : '#fde68a'};">
                    <div style="font-weight:600;font-size:0.9rem;color:${result.errors.length === 0 ? '#15803d' : '#a16207'};">
                        ${result.errors.length === 0 ? '✅' : '⚠️'} ${result.created} élément${result.created > 1 ? 's' : ''} importé${result.created > 1 ? 's' : ''}
                    </div>
                    ${result.errors.length > 0 ? `
                        <div style="margin-top:8px;font-size:0.8rem;color:#92400e;">
                            ${result.errors.slice(0, 10).map(e => `<div>• ${e}</div>`).join('')}
                            ${result.errors.length > 10 ? `<div>... et ${result.errors.length - 10} autres erreurs</div>` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        }

        if (result.created > 0) {
            App.showToast(`${result.created} élément${result.created > 1 ? 's' : ''} importé${result.created > 1 ? 's' : ''}!`, 'success');
        }
    }

    function _exportDeals() {
        const dateFrom = document.getElementById('export-date-from')?.value || '';
        const dateTo = document.getElementById('export-date-to')?.value || '';

        const checkedBoxes = document.querySelectorAll('[data-export-col]:checked');
        const selectedColumns = Array.from(checkedBoxes).map(cb => {
            const id = cb.dataset.exportCol;
            return DEAL_FIELDS.find(f => f.id === id);
        }).filter(Boolean);

        exportDeals({
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            columns: selectedColumns.length > 0 ? selectedColumns : DEAL_FIELDS
        });
    }

    function _exportContacts() {
        exportContacts({});
    }

    return {
        render,
        exportDeals,
        exportContacts,
        importCSV,
        _setImportType,
        _handleDrop,
        _handleFileSelect,
        _updateMapping,
        _runImport,
        _exportDeals,
        _exportContacts
    };
})();
