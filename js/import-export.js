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
                        <input type="file" id="import-file-input" accept=".csv,.txt,.xls,.xlsx" style="display:none;" onchange="ImportExport._handleFileSelect(event)">

                        <div id="import-preview" style="margin-top:16px;display:none;"></div>
                        <div id="import-mapping" style="margin-top:16px;display:none;"></div>
                        <div id="import-result" style="margin-top:16px;display:none;"></div>

                        <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0">

                        <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;border-radius:8px;padding:16px;">
                            <h4 style="margin:0 0 8px;font-size:0.95rem;">🏢 Importer depuis Acceo Avantage</h4>
                            <p style="margin:0 0 12px;font-size:0.8rem;color:#92400e;">
                                Importez votre liste de clients depuis le fichier Excel exporté d'Avantage (format multi-lignes, 4 lignes/client).
                            </p>
                            <div id="avantage-dropzone"
                                ondragover="event.preventDefault();this.style.borderColor='#f59e0b';this.style.background='#fefce8';"
                                ondragleave="this.style.borderColor='#fbbf24';this.style.background='#fffbeb';"
                                ondrop="event.preventDefault();this.style.borderColor='#fbbf24';this.style.background='#fffbeb';ImportExport._handleAvantageDrop(event);"
                                onclick="document.getElementById('avantage-file-input').click();"
                                style="border:2px dashed #fbbf24;border-radius:8px;padding:20px 12px;text-align:center;cursor:pointer;background:#fffbeb;transition:.2s;">
                                <div style="font-size:1.5rem;margin-bottom:4px;">📊</div>
                                <p style="margin:0;font-weight:600;font-size:0.85rem;">Glissez le fichier .XLS / .XLSX ici</p>
                                <p style="margin:4px 0 0;color:#92400e;font-size:0.75rem;">Liste générale des clients.XLS</p>
                            </div>
                            <input type="file" id="avantage-file-input" accept=".xls,.xlsx" style="display:none;" onchange="ImportExport._handleAvantageFile(event)">
                            <div id="avantage-progress" style="display:none;margin-top:12px;"></div>
                            <div id="avantage-result" style="display:none;margin-top:12px;"></div>
                        </div>

                        <div style="background:linear-gradient(135deg,#dbeafe,#bfdbfe);border:1px solid #3b82f6;border-radius:8px;padding:16px;margin-top:16px;">
                            <h4 style="margin:0 0 8px;font-size:0.95rem;">🔧 Importer depuis Mec-inov</h4>
                            <p style="margin:0 0 12px;font-size:0.8rem;color:#1e40af;">
                                Importez les 379 clients de votre base Mec-inov (Clients.mdb) avec emails, téléphones, adresses et # client.
                            </p>
                            <div id="mecinov-dropzone"
                                ondragover="event.preventDefault();this.style.borderColor='#3b82f6';this.style.background='#eff6ff';"
                                ondragleave="this.style.borderColor='#60a5fa';this.style.background='#dbeafe';"
                                ondrop="event.preventDefault();this.style.borderColor='#60a5fa';this.style.background='#dbeafe';ImportExport._handleMecinovDrop(event);"
                                onclick="document.getElementById('mecinov-file-input').click();"
                                style="border:2px dashed #60a5fa;border-radius:8px;padding:20px 12px;text-align:center;cursor:pointer;background:#dbeafe;transition:.2s;">
                                <div style="font-size:1.5rem;margin-bottom:4px;">🗄️</div>
                                <p style="margin:0;font-weight:600;font-size:0.85rem;">Glissez le fichier Clients.mdb ici</p>
                                <p style="margin:4px 0 0;color:#1e40af;font-size:0.75rem;">P:\\Mec-Inov\\Clients\\Clients.mdb</p>
                            </div>
                            <input type="file" id="mecinov-file-input" accept=".mdb" style="display:none;" onchange="ImportExport._handleMecinovFile(event)">
                            <div style="margin-top:8px;text-align:center">
                                <span style="font-size:12px;color:#64748b">— ou —</span>
                            </div>
                            <button class="btn btn-sm btn-primary" style="width:100%;margin-top:4px;" onclick="ImportExport._loadMecinovFromJSON()">
                                📥 Charger automatiquement depuis le serveur
                            </button>
                            <div id="mecinov-progress" style="display:none;margin-top:12px;"></div>
                            <div id="mecinov-result" style="display:none;margin-top:12px;"></div>
                        </div>
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

    // ===== ACCEO AVANTAGE IMPORT =====

    function _handleAvantageDrop(event) {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) _processAvantageFile(files[0]);
    }

    function _handleAvantageFile(event) {
        const files = event.target?.files;
        if (files && files.length > 0) _processAvantageFile(files[0]);
    }

    function _processAvantageFile(file) {
        const progressEl = document.getElementById('avantage-progress');
        const resultEl = document.getElementById('avantage-result');
        if (!progressEl || !resultEl) return;

        progressEl.style.display = 'block';
        resultEl.style.display = 'none';
        progressEl.innerHTML = `<div style="text-align:center;padding:12px;"><div style="font-size:1.5rem;animation:spin 1s linear infinite">⏳</div><p style="margin:4px 0 0;font-size:13px;font-weight:600">Lecture du fichier... (${(file.size / 1024 / 1024).toFixed(1)} MB)</p></div>`;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                progressEl.innerHTML = '<div style="text-align:center;padding:8px;font-size:13px;font-weight:600">⚙️ Traitement des données Avantage...</div>';

                // Use SheetJS if available, otherwise parse raw
                if (typeof XLSX !== 'undefined') {
                    const wb = XLSX.read(e.target.result, { type: 'array' });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                    _parseAvantageRows(rows, progressEl, resultEl);
                } else {
                    // Load SheetJS dynamically
                    progressEl.innerHTML = '<div style="text-align:center;padding:8px;font-size:13px">📦 Chargement de la librairie Excel...</div>';
                    const script = document.createElement('script');
                    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
                    script.onload = () => {
                        const wb = XLSX.read(e.target.result, { type: 'array' });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                        _parseAvantageRows(rows, progressEl, resultEl);
                    };
                    script.onerror = () => {
                        progressEl.innerHTML = '<div style="color:red;font-size:13px">❌ Impossible de charger la librairie Excel. Vérifiez votre connexion.</div>';
                    };
                    document.head.appendChild(script);
                }
            } catch (err) {
                progressEl.innerHTML = `<div style="color:red;font-size:13px">❌ Erreur: ${err.message}</div>`;
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function _parseAvantageRows(rows, progressEl, resultEl) {
        // Avantage format: 4 rows per client + blank separator
        // Row 1: client#, Name, Street address, Tel.1
        // Row 2: (cont), (empty), City/Province/Postal, Fax
        // Row 3: (cont), (empty), Country, Tel.2
        // Row 4: (cont), (empty), (empty), Cell.

        const clients = [];
        let headerSkip = 0;

        // Find first data row (skip headers - look for first row starting with digits)
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const val = String(rows[i]?.[0] || '').replace(/\x00/g, '').trim();
            if (/^\d{5,}/.test(val)) {
                headerSkip = i;
                break;
            }
        }

        // Clean cell values - remove null chars
        const clean = (v) => String(v || '').replace(/\x00/g, '').trim();

        let i = headerSkip;
        while (i < rows.length - 3) {
            const r1 = rows[i];
            const r2 = rows[i + 1];
            const r3 = rows[i + 2];
            const r4 = rows[i + 3];

            const numero = clean(r1?.[0]);
            const name = clean(r1?.[1]);

            // Skip blank or non-data rows
            if (!numero || !/\d/.test(numero)) {
                i++;
                continue;
            }

            const street = clean(r1?.[2]);
            const cityLine = clean(r2?.[2]);
            const country = clean(r3?.[2]);

            const tel1 = clean(r1?.[3]);
            const fax = clean(r2?.[3]);
            const tel2 = clean(r3?.[3]);
            const cell = clean(r4?.[3]);

            // Build full address
            let address = street;
            if (cityLine) address += (address ? ', ' : '') + cityLine;

            // Parse name into first/last
            const nameParts = name.split(/\s+/);
            let lastName = '', firstName = '';
            if (nameParts.length >= 2) {
                lastName = nameParts[0];
                firstName = nameParts.slice(1).join(' ');
            } else {
                lastName = name;
            }

            // Format name nicely (Title Case)
            const titleCase = (s) => s.toLowerCase().replace(/(?:^|\s|[-'])\S/g, c => c.toUpperCase());

            clients.push({
                numero: numero,
                name: titleCase(name),
                firstName: titleCase(firstName),
                lastName: titleCase(lastName),
                address: address,
                phone: tel1 || tel2 || cell || '',
                phone2: tel2 || '',
                cell: cell || '',
                fax: fax || '',
            });

            // Jump to next client block (4 rows + possible blank)
            i += 4;
            // Skip blank separator rows
            while (i < rows.length && !clean(rows[i]?.[0]) && !clean(rows[i]?.[1])) {
                i++;
            }
        }

        progressEl.style.display = 'none';
        resultEl.style.display = 'block';

        if (clients.length === 0) {
            resultEl.innerHTML = '<div style="color:red;padding:8px;font-size:13px">❌ Aucun client trouvé dans le fichier. Vérifiez le format.</div>';
            return;
        }

        // Show preview + import button
        const sample = clients.slice(0, 8);
        resultEl.innerHTML = `
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;">
                <div style="font-weight:700;color:#15803d;font-size:14px;margin-bottom:8px">
                    ✅ ${clients.length.toLocaleString()} clients détectés dans Avantage
                </div>
                <div style="font-size:12px;color:#166534;margin-bottom:12px">
                    Aperçu (${sample.length} premiers) :
                </div>
                <div style="max-height:200px;overflow-y:auto;border:1px solid #d1fae5;border-radius:6px;background:#fff">
                    <table style="width:100%;font-size:11px;border-collapse:collapse">
                        <thead>
                            <tr style="background:#ecfdf5;position:sticky;top:0">
                                <th style="padding:4px 8px;text-align:left;border-bottom:1px solid #d1fae5">#</th>
                                <th style="padding:4px 8px;text-align:left;border-bottom:1px solid #d1fae5">Nom</th>
                                <th style="padding:4px 8px;text-align:left;border-bottom:1px solid #d1fae5">Adresse</th>
                                <th style="padding:4px 8px;text-align:left;border-bottom:1px solid #d1fae5">Tél.</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sample.map(c => `
                                <tr>
                                    <td style="padding:3px 8px;border-bottom:1px solid #f0fdf4;font-family:monospace;font-size:10px">${c.numero}</td>
                                    <td style="padding:3px 8px;border-bottom:1px solid #f0fdf4;font-weight:500">${c.name}</td>
                                    <td style="padding:3px 8px;border-bottom:1px solid #f0fdf4">${c.address.substring(0, 50)}</td>
                                    <td style="padding:3px 8px;border-bottom:1px solid #f0fdf4">${c.phone}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
                    <button class="btn btn-sm btn-primary" id="btn-avantage-import"
                        onclick="ImportExport._runAvantageImport()">
                        📥 Importer les ${clients.length.toLocaleString()} clients comme contacts
                    </button>
                    <label style="font-size:12px;display:flex;align-items:center;gap:4px">
                        <input type="checkbox" id="avantage-skip-existing" checked>
                        Ignorer les doublons
                    </label>
                </div>
            </div>
        `;

        // Store parsed data for import
        ImportExport._avantageClients = clients;
    }

    function _runAvantageImport() {
        const clients = ImportExport._avantageClients;
        if (!clients || clients.length === 0) return;

        const skipExisting = document.getElementById('avantage-skip-existing')?.checked !== false;
        const btn = document.getElementById('btn-avantage-import');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Import en cours...'; }

        // Use Contacts module if available
        const useContacts = typeof Contacts !== 'undefined';
        let created = 0, skipped = 0, errors = 0;

        const existingContacts = useContacts ? Contacts.getAll() : [];
        const existingNames = new Set(existingContacts.map(c => (c.name || '').toLowerCase()));

        // Process in chunks to avoid blocking UI
        let index = 0;
        const batchSize = 200;

        function processBatch() {
            const end = Math.min(index + batchSize, clients.length);

            for (let i = index; i < end; i++) {
                const c = clients[i];

                // Skip duplicates by name
                if (skipExisting && existingNames.has(c.name.toLowerCase())) {
                    skipped++;
                    continue;
                }

                try {
                    if (useContacts) {
                        Contacts.save({
                            name: c.name,
                            type: 'person',
                            phone: c.phone,
                            phone2: c.cell || c.phone2 || '',
                            address: c.address,
                            source: 'avantage',
                            tags: ['Avantage'],
                            notes: `# Avantage ${c.numero}${c.fax ? ' | Fax: ' + c.fax : ''}`,
                            avantageId: c.numero,
                        });
                    } else {
                        // Fallback: save directly to localStorage
                        const contacts = JSON.parse(localStorage.getItem('crm_contacts') || '[]');
                        contacts.push({
                            id: 'av_' + c.numero,
                            name: c.name,
                            type: 'person',
                            phone: c.phone,
                            phone2: c.cell || c.phone2 || '',
                            address: c.address,
                            source: 'avantage',
                            tags: ['Avantage'],
                            notes: `# Avantage ${c.numero}`,
                            avantageId: c.numero,
                            createdAt: new Date().toISOString(),
                        });
                        localStorage.setItem('crm_contacts', JSON.stringify(contacts));
                    }
                    created++;
                    existingNames.add(c.name.toLowerCase());
                } catch (e) {
                    errors++;
                }
            }

            index = end;

            // Update progress
            if (btn) btn.textContent = `⏳ ${index.toLocaleString()} / ${clients.length.toLocaleString()}...`;

            if (index < clients.length) {
                setTimeout(processBatch, 10); // Yield to UI
            } else {
                // Done!
                if (btn) { btn.disabled = false; btn.textContent = '📥 Import terminé!'; }

                const resultEl = document.getElementById('avantage-result');
                if (resultEl) {
                    resultEl.style.display = 'block';
                    resultEl.innerHTML = `
                        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-top:8px">
                            <div style="font-weight:700;color:#15803d;font-size:14px">
                                🎉 Import Avantage terminé!
                            </div>
                            <div style="font-size:13px;margin-top:6px;color:#166534">
                                ✅ <strong>${created.toLocaleString()}</strong> contacts créés<br>
                                ${skipped > 0 ? `⏭️ ${skipped.toLocaleString()} doublons ignorés<br>` : ''}
                                ${errors > 0 ? `❌ ${errors} erreurs<br>` : ''}
                            </div>
                        </div>
                    `;
                }

                App.showToast(`${created.toLocaleString()} clients Avantage importés!`, 'success');
                // Refresh contacts view if visible
                if (typeof Contacts !== 'undefined' && typeof Contacts.render === 'function') {
                    Contacts.render();
                }
            }
        }

        processBatch();
    }

    // ===== MEC-INOV IMPORT =====

    function _handleMecinovDrop(event) {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) _processMecinovMDB(files[0]);
    }

    function _handleMecinovFile(event) {
        const files = event.target?.files;
        if (files && files.length > 0) _processMecinovMDB(files[0]);
    }

    function _processMecinovMDB(file) {
        // MDB parsing in browser is complex - redirect to JSON method
        const progressEl = document.getElementById('mecinov-progress');
        if (progressEl) {
            progressEl.style.display = 'block';
            progressEl.innerHTML = `
                <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px;font-size:12px;color:#92400e;">
                    ⚠️ Les fichiers .mdb ne peuvent pas être lus directement dans le navigateur.
                    Utilisez le bouton <strong>"Charger automatiquement"</strong> ci-dessous, qui utilise le fichier pré-converti.
                </div>
            `;
        }
    }

    function _loadMecinovFromJSON() {
        const progressEl = document.getElementById('mecinov-progress');
        const resultEl = document.getElementById('mecinov-result');
        if (!progressEl || !resultEl) return;

        progressEl.style.display = 'block';
        resultEl.style.display = 'none';
        progressEl.innerHTML = '<div style="text-align:center;padding:8px;font-size:13px;font-weight:600">⏳ Chargement des clients Mec-inov...</div>';

        fetch('data/mecinov-clients.json')
            .then(r => {
                if (!r.ok) throw new Error('Fichier non trouvé (data/mecinov-clients.json)');
                return r.json();
            })
            .then(clients => {
                progressEl.style.display = 'none';
                _showMecinovPreview(clients, resultEl);
            })
            .catch(err => {
                progressEl.innerHTML = `<div style="color:red;font-size:13px;padding:8px">❌ ${err.message}</div>`;
            });
    }

    function _showMecinovPreview(clients, resultEl) {
        // Clean up data
        const titleCase = (s) => (s || '').toLowerCase().replace(/(?:^|\s|[-'])\S/g, c => c.toUpperCase());

        const cleaned = clients.filter(c => {
            const name = (c.CNOM || c.CCOMPAGNIE || '').trim();
            return name && name !== '' && !/^(COMPAGNIE TEST|CLIENT TEST)$/i.test(name);
        }).map(c => ({
            mecId: c.CMEC || '',
            bbxId: c.CBBX || '',
            company: titleCase(c.CCOMPAGNIE || ''),
            name: titleCase(c.CNOM || ''),
            address: [c.CADRESSE1, c.CADRESSE2, c.CADRESSE3, c.CCODEP].filter(Boolean).join(', ').replace(/Qu\ufffd?bec/g, 'Québec').replace(/L\ufffd?vis/g, 'Lévis'),
            phone: c.TEL1 || '',
            phone2: c.TEL2 || '',
            fax: c.FAX1 || '',
            email: c.CEMAIL || '',
            type: c.CTYPEBBX || '',
            terms: c.CTERMEBBX || '',
            notes: c.NOTES || '',
            created: c.CCREA || '',
        }));

        // Store for import
        _mecinovClientsData = cleaned;

        const sample = cleaned.slice(0, 8);
        const withEmail = cleaned.filter(c => c.email).length;
        const withPhone = cleaned.filter(c => c.phone).length;

        resultEl.style.display = 'block';
        resultEl.innerHTML = `
            <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px;">
                <div style="font-weight:700;color:#1d4ed8;font-size:14px;margin-bottom:4px">
                    ✅ ${cleaned.length} clients Mec-inov chargés
                </div>
                <div style="font-size:12px;color:#1e40af;margin-bottom:12px">
                    📧 ${withEmail} avec courriel &nbsp;|&nbsp; 📞 ${withPhone} avec téléphone
                </div>
                <div style="max-height:200px;overflow-y:auto;border:1px solid #bfdbfe;border-radius:6px;background:#fff">
                    <table style="width:100%;font-size:11px;border-collapse:collapse">
                        <thead>
                            <tr style="background:#dbeafe;position:sticky;top:0">
                                <th style="padding:4px 6px;text-align:left;border-bottom:1px solid #bfdbfe"># Mec</th>
                                <th style="padding:4px 6px;text-align:left;border-bottom:1px solid #bfdbfe">Nom</th>
                                <th style="padding:4px 6px;text-align:left;border-bottom:1px solid #bfdbfe">Tél.</th>
                                <th style="padding:4px 6px;text-align:left;border-bottom:1px solid #bfdbfe">Courriel</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sample.map(c => `
                                <tr>
                                    <td style="padding:3px 6px;border-bottom:1px solid #eff6ff;font-family:monospace;font-size:10px">${c.mecId}</td>
                                    <td style="padding:3px 6px;border-bottom:1px solid #eff6ff;font-weight:500">${c.name || c.company}</td>
                                    <td style="padding:3px 6px;border-bottom:1px solid #eff6ff">${c.phone}</td>
                                    <td style="padding:3px 6px;border-bottom:1px solid #eff6ff;font-size:10px">${c.email || '—'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
                    <button class="btn btn-sm btn-primary" id="btn-mecinov-import"
                        onclick="ImportExport._runMecinovImport()">
                        📥 Importer les ${cleaned.length} clients comme contacts
                    </button>
                    <label style="font-size:12px;display:flex;align-items:center;gap:4px">
                        <input type="checkbox" id="mecinov-skip-existing" checked>
                        Ignorer les doublons
                    </label>
                </div>
            </div>
        `;
    }

    function _runMecinovImport() {
        const clients = _mecinovClientsData;
        if (!clients || clients.length === 0) return;

        const skipExisting = document.getElementById('mecinov-skip-existing')?.checked !== false;
        const btn = document.getElementById('btn-mecinov-import');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Import en cours...'; }

        const useContacts = typeof Contacts !== 'undefined';
        let created = 0, skipped = 0, errors = 0;

        const existingContacts = useContacts ? Contacts.getAll() : [];
        const existingNames = new Set(existingContacts.map(c => (c.name || '').toLowerCase()));

        let index = 0;
        const batchSize = 100;

        function processBatch() {
            const end = Math.min(index + batchSize, clients.length);
            for (let i = index; i < end; i++) {
                const c = clients[i];
                const contactName = c.name || c.company;
                if (skipExisting && existingNames.has(contactName.toLowerCase())) {
                    skipped++;
                    continue;
                }
                try {
                    if (useContacts) {
                        Contacts.save({
                            name: contactName,
                            organization: c.company !== c.name ? c.company : '',
                            type: c.type === 'Particulier' ? 'person' : (c.company && c.company !== c.name ? 'organization' : 'person'),
                            phone: c.phone,
                            phone2: c.phone2,
                            email: c.email,
                            address: c.address,
                            source: 'mecinov',
                            tags: ['Mec-inov'],
                            notes: `# Mec-inov: ${c.mecId}${c.bbxId ? ' | Avantage: ' + c.bbxId : ''}${c.terms ? ' | Termes: ' + c.terms : ''}${c.notes ? '\n' + c.notes : ''}`,
                            mecinovId: c.mecId,
                            avantageId: c.bbxId || '',
                        });
                    }
                    created++;
                    existingNames.add(contactName.toLowerCase());
                } catch (e) { errors++; }
            }
            index = end;
            if (btn) btn.textContent = `⏳ ${index} / ${clients.length}...`;

            if (index < clients.length) {
                setTimeout(processBatch, 10);
            } else {
                if (btn) { btn.disabled = false; btn.textContent = '📥 Import terminé!'; }
                const resultEl = document.getElementById('mecinov-result');
                if (resultEl) {
                    resultEl.style.display = 'block';
                    resultEl.innerHTML = `
                        <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px;margin-top:8px">
                            <div style="font-weight:700;color:#1d4ed8;font-size:14px">🎉 Import Mec-inov terminé!</div>
                            <div style="font-size:13px;margin-top:6px;color:#1e40af">
                                ✅ <strong>${created}</strong> contacts créés<br>
                                ${skipped > 0 ? `⏭️ ${skipped} doublons ignorés<br>` : ''}
                                ${errors > 0 ? `❌ ${errors} erreurs<br>` : ''}
                            </div>
                        </div>
                    `;
                }
                App.showToast(`${created} clients Mec-inov importés!`, 'success');
                // Refresh contacts view if visible
                if (typeof Contacts !== 'undefined' && typeof Contacts.render === 'function') {
                    Contacts.render();
                }
            }
        }
        processBatch();
    }

    // Store parsed clients temporarily
    let _avantageClientsData = null;
    let _mecinovClientsData = null;

    // Public API
    const publicAPI = {
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
        _exportContacts,
        _handleAvantageDrop,
        _handleAvantageFile,
        _runAvantageImport,
        _handleMecinovDrop,
        _handleMecinovFile,
        _loadMecinovFromJSON,
        _runMecinovImport,
        get _avantageClients() { return _avantageClientsData; },
        set _avantageClients(v) { _avantageClientsData = v; },
    };

    return publicAPI;
})();
