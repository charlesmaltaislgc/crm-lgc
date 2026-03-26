// ===== CRM LGC - AI Plan Reader Module =====
// Reads architectural plans, extracts doors/windows with dimensions, quantities, locations
// Uses AI vision (Claude API or OpenAI) to analyze uploaded plan images/PDFs

const PlanReader = (() => {
    const STORAGE_KEY = 'crm_plan_analyses';
    let analyses = [];
    let currentAnalysis = null;
    let processing = false;

    // AI API configuration
    function getApiConfig() {
        return {
            provider: localStorage.getItem('crm_ai_provider') || 'anthropic', // 'anthropic' or 'openai'
            apiKey: localStorage.getItem('crm_ai_apikey') || '',
            model: localStorage.getItem('crm_ai_model') || 'claude-sonnet-4-20250514',
        };
    }

    function loadAnalyses() {
        const saved = localStorage.getItem(STORAGE_KEY);
        analyses = saved ? JSON.parse(saved) : [];
        return analyses;
    }

    function saveAnalyses() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(analyses));
    }

    // ===== ANALYSIS PROMPT =====
    const EXTRACTION_PROMPT = `Tu es un expert en lecture de plans architecturaux pour une entreprise de portes et fenêtres au Québec.

Analyse ce plan architectural et extrais TOUTES les portes et fenêtres visibles.

Pour CHAQUE ouverture trouvée, donne:
1. **Type**: Porte d'entrée, Porte patio, Porte intérieure, Porte de garage, Fenêtre fixe, Fenêtre coulissante, Fenêtre à battant, Fenêtre auvent, Baie vitrée, Puits de lumière, etc.
2. **Dimensions**: Largeur x Hauteur en pouces ou pieds-pouces (comme indiqué sur le plan)
3. **Quantité**: Combien de cette même ouverture
4. **Localisation**: Pièce ou façade (ex: "Cuisine - mur nord", "Façade avant", "Salon", etc.)
5. **Notes**: Tout détail pertinent (vitrage triple, oscillo-battant, avec moustiquaire, couleur mentionnée, etc.)
6. **Extérieur**: Oui/Non - est-ce une ouverture donnant sur l'extérieur?

IMPORTANT:
- Concentre-toi sur les portes et fenêtres EXTÉRIEURES en priorité
- Inclus les codes/symboles du plan si visibles (ex: "F-1", "P-2", "W-01")
- Si les dimensions ne sont pas lisibles, indique "À mesurer sur place"
- Donne un résumé total à la fin

Réponds en JSON structuré avec ce format:
{
    "planDescription": "Description générale du plan (type de bâtiment, étage, etc.)",
    "openings": [
        {
            "id": "1",
            "type": "Fenêtre coulissante",
            "dimensions": "48\\" x 36\\"",
            "quantity": 2,
            "location": "Salon - façade avant",
            "exterior": true,
            "code": "F-1",
            "notes": "Double vitrage"
        }
    ],
    "summary": {
        "totalWindows": 0,
        "totalExteriorDoors": 0,
        "totalInteriorDoors": 0,
        "totalOpenings": 0,
        "estimatedMeasurementTime": "30 min"
    },
    "warnings": ["Dimensions illisibles pour fenêtre du sous-sol", "..."]
}`;

    // ===== PROCESS IMAGE WITH AI =====
    async function analyzeImage(imageDataUrl, filename, dealId = null) {
        const config = getApiConfig();
        if (!config.apiKey) {
            App.showToast('Configurez la clé API IA dans Paramètres', 'error');
            return null;
        }

        processing = true;
        renderUI();

        try {
            let result;

            if (config.provider === 'anthropic') {
                result = await callClaude(config, imageDataUrl);
            } else {
                result = await callOpenAI(config, imageDataUrl);
            }

            // Parse the JSON response
            let parsed;
            try {
                // Extract JSON from the response (might be wrapped in markdown code blocks)
                const jsonMatch = result.match(/\{[\s\S]*\}/);
                parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(result);
            } catch (e) {
                // If JSON parsing fails, store raw text
                parsed = {
                    planDescription: 'Analyse brute (format non structuré)',
                    openings: [],
                    rawText: result,
                    summary: { totalOpenings: 0 },
                    warnings: ['Le format de réponse n\'était pas structuré - voir le texte brut']
                };
            }

            const analysis = {
                id: 'PA' + Date.now(),
                dealId,
                filename,
                imagePreview: imageDataUrl.substring(0, 200) + '...', // Don't store full image in localStorage
                result: parsed,
                analyzedAt: new Date().toISOString(),
                analyzedBy: Auth.getUser()?.name || 'Inconnu',
            };

            analyses.unshift(analysis);
            saveAnalyses();
            currentAnalysis = analysis;

            processing = false;
            renderUI();
            App.showToast(`Plan analysé: ${parsed.summary?.totalOpenings || 0} ouvertures trouvées!`, 'success');

            if (dealId) {
                // Add note to deal with summary
                const noteText = `📐 Analyse de plan: ${filename}\n` +
                    `Fenêtres ext.: ${parsed.summary?.totalWindows || '?'}\n` +
                    `Portes ext.: ${parsed.summary?.totalExteriorDoors || '?'}\n` +
                    `Total ouvertures: ${parsed.summary?.totalOpenings || '?'}\n` +
                    `Temps mesure estimé: ${parsed.summary?.estimatedMeasurementTime || '?'}`;
                await Deals.addNote(dealId, noteText);
            }

            return analysis;

        } catch (e) {
            console.error('AI analysis failed:', e);
            processing = false;
            renderUI();
            App.showToast('Erreur d\'analyse: ' + e.message, 'error');
            return null;
        }
    }

    async function callClaude(config, imageDataUrl) {
        // Extract base64 and media type
        const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) throw new Error('Format d\'image non supporté');

        const mediaType = match[1];
        const base64Data = match[2];

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: config.model || 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Data,
                            }
                        },
                        {
                            type: 'text',
                            text: EXTRACTION_PROMPT
                        }
                    ]
                }]
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `API error ${response.status}`);
        }

        const data = await response.json();
        return data.content[0].text;
    }

    async function callOpenAI(config, imageDataUrl) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model || 'gpt-4o',
                max_tokens: 4096,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: imageDataUrl } },
                        { type: 'text', text: EXTRACTION_PROMPT }
                    ]
                }]
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `API error ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    // ===== UI RENDERING =====
    function renderUI() {
        const container = document.getElementById('plan-reader-content');
        if (!container) return;

        if (processing) {
            container.innerHTML = `
                <div style="text-align:center;padding:60px 20px">
                    <div style="font-size:48px;margin-bottom:16px;animation:pulse 1.5s infinite">🔍</div>
                    <h3>Analyse du plan en cours...</h3>
                    <p style="color:var(--text-secondary);margin-top:8px">L'IA examine chaque porte et fenêtre du plan.</p>
                    <p style="color:var(--text-muted);font-size:12px;margin-top:4px">Ça peut prendre 15-30 secondes</p>
                    <style>@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}</style>
                </div>
            `;
            return;
        }

        let html = `
            <!-- Upload Zone -->
            <div style="margin-bottom:24px">
                <label id="plan-upload-zone" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;border:2px dashed var(--border);border-radius:var(--radius-lg);cursor:pointer;transition:all 0.15s;text-align:center">
                    <input type="file" id="plan-file-input" accept="image/*,.pdf" style="display:none">
                    <div style="font-size:48px;margin-bottom:12px">📐</div>
                    <div style="font-size:16px;font-weight:700">Déposez un plan architectural ici</div>
                    <div style="color:var(--text-secondary);margin-top:4px">ou cliquez pour choisir un fichier</div>
                    <div style="color:var(--text-muted);font-size:12px;margin-top:8px">
                        Images (JPG, PNG) ou PDF - L'IA va extraire toutes les portes et fenêtres
                    </div>
                    <div style="margin-top:12px;display:flex;gap:8px">
                        <span style="background:var(--success-light);color:var(--success);padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700">Dimensions</span>
                        <span style="background:var(--info-light);color:var(--info);padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700">Quantités</span>
                        <span style="background:var(--warning-light);color:#b45309;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700">Localisations</span>
                        <span style="background:var(--primary-light);color:var(--primary);padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700">Types</span>
                    </div>
                </label>
            </div>

            <!-- Link to deal (optional) -->
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:24px">
                <label style="font-size:12px;font-weight:600;color:var(--text-secondary);white-space:nowrap">Lier à un deal:</label>
                <select id="plan-deal-select" class="input-sm" style="flex:1">
                    <option value="">Aucun (analyse libre)</option>
                </select>
            </div>
        `;

        // Current analysis results
        if (currentAnalysis && currentAnalysis.result) {
            html += renderAnalysisResult(currentAnalysis);
        }

        // Previous analyses
        if (analyses.length > 0) {
            html += `
                <div style="margin-top:32px">
                    <h3 class="section-title">Analyses précédentes</h3>
                    <div style="display:flex;flex-direction:column;gap:8px">
                        ${analyses.slice(0, 10).map(a => `
                            <div class="task-item" style="cursor:pointer" onclick="PlanReader.showAnalysis('${a.id}')">
                                <div style="width:36px;height:36px;border-radius:8px;background:var(--primary-light);display:flex;align-items:center;justify-content:center;flex-shrink:0">📐</div>
                                <div class="task-info">
                                    <div class="task-description">${a.filename}</div>
                                    <div class="task-meta">
                                        ${a.result.summary?.totalOpenings || '?'} ouvertures
                                        | ${Deals.formatDate(a.analyzedAt)}
                                        | Par ${a.analyzedBy}
                                        ${a.dealId ? ` | Deal: ${Deals.getById(a.dealId)?.clientName || a.dealId}` : ''}
                                    </div>
                                </div>
                                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); PlanReader.exportToCSV('${a.id}')">
                                    Exporter CSV
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;

        // Populate deal select
        const dealSelect = document.getElementById('plan-deal-select');
        if (dealSelect) {
            Deals.getActive().forEach(d => {
                dealSelect.innerHTML += `<option value="${d.id}">${d.clientName} - ${Deals.getStageName(d.stage)}</option>`;
            });
        }

        // Setup upload events
        setupUploadEvents();
    }

    function renderAnalysisResult(analysis) {
        const r = analysis.result;

        if (r.rawText && !r.openings?.length) {
            return `
                <div class="report-card" style="margin-top:24px">
                    <h4>Résultat d'analyse - ${analysis.filename}</h4>
                    <pre style="white-space:pre-wrap;font-size:13px;max-height:400px;overflow-y:auto;background:var(--bg);padding:16px;border-radius:var(--radius)">${r.rawText}</pre>
                </div>
            `;
        }

        let html = `
            <div style="margin-top:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 class="section-title" style="margin:0">Résultat: ${analysis.filename}</h3>
                    <div style="display:flex;gap:8px">
                        <button class="btn btn-sm btn-primary" onclick="PlanReader.exportToCSV('${analysis.id}')">Exporter CSV</button>
                        <button class="btn btn-sm btn-outline" onclick="PlanReader.copyToClipboard('${analysis.id}')">Copier</button>
                        ${analysis.dealId ? `<button class="btn btn-sm btn-outline" onclick="PlanReader.addToDeal('${analysis.id}')">Ajouter au deal</button>` : ''}
                    </div>
                </div>

                <!-- Plan description -->
                <div style="padding:12px 16px;background:var(--info-light);border-radius:var(--radius);margin-bottom:16px;font-size:13px">
                    📋 ${r.planDescription || 'Plan analysé'}
                </div>

                <!-- Summary cards -->
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
                    <div style="text-align:center;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius)">
                        <div style="font-size:28px;font-weight:800;color:var(--primary)">${r.summary?.totalWindows || 0}</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Fenêtres ext.</div>
                    </div>
                    <div style="text-align:center;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius)">
                        <div style="font-size:28px;font-weight:800;color:var(--success)">${r.summary?.totalExteriorDoors || 0}</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Portes ext.</div>
                    </div>
                    <div style="text-align:center;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius)">
                        <div style="font-size:28px;font-weight:800">${r.summary?.totalOpenings || 0}</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">Total ouvertures</div>
                    </div>
                    <div style="text-align:center;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius)">
                        <div style="font-size:28px;font-weight:800;color:var(--warning)">⏱️</div>
                        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase">${r.summary?.estimatedMeasurementTime || '?'}</div>
                    </div>
                </div>

                <!-- Warnings -->
                ${r.warnings?.length ? `
                    <div style="padding:10px 16px;background:var(--warning-light);border-radius:var(--radius);margin-bottom:16px;font-size:12px;color:#b45309">
                        ⚠️ ${r.warnings.join(' | ')}
                    </div>
                ` : ''}

                <!-- Openings table -->
                <div style="overflow-x:auto">
                    <table class="deals-table">
                        <thead>
                            <tr>
                                <th>Code</th>
                                <th>Type</th>
                                <th>Dimensions</th>
                                <th>Qté</th>
                                <th>Localisation</th>
                                <th>Ext.</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(r.openings || []).map(o => `
                                <tr>
                                    <td><strong>${o.code || '-'}</strong></td>
                                    <td>
                                        <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;
                                            background:${o.type?.toLowerCase().includes('porte') ? 'var(--success-light);color:var(--success)' : 'var(--primary-light);color:var(--primary)'}">
                                            ${o.type || '?'}
                                        </span>
                                    </td>
                                    <td style="font-weight:700;font-family:monospace">${o.dimensions || 'À mesurer'}</td>
                                    <td style="text-align:center;font-weight:700">${o.quantity || 1}</td>
                                    <td>${o.location || '-'}</td>
                                    <td style="text-align:center">${o.exterior ? '✅' : '❌'}</td>
                                    <td style="font-size:12px;color:var(--text-secondary)">${o.notes || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        return html;
    }

    function setupUploadEvents() {
        const fileInput = document.getElementById('plan-file-input');
        const uploadZone = document.getElementById('plan-upload-zone');

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) handlePlanUpload(e.target.files[0]);
            });
        }

        if (uploadZone) {
            uploadZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadZone.style.borderColor = 'var(--primary)';
                uploadZone.style.background = 'var(--primary-light)';
            });
            uploadZone.addEventListener('dragleave', () => {
                uploadZone.style.borderColor = '';
                uploadZone.style.background = '';
            });
            uploadZone.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadZone.style.borderColor = '';
                uploadZone.style.background = '';
                if (e.dataTransfer.files.length > 0) handlePlanUpload(e.dataTransfer.files[0]);
            });
        }
    }

    function handlePlanUpload(file) {
        if (!file) return;

        const maxSize = 20 * 1024 * 1024;
        if (file.size > maxSize) {
            App.showToast('Fichier trop gros (max 20 Mo)', 'error');
            return;
        }

        const dealSelect = document.getElementById('plan-deal-select');
        const dealId = dealSelect ? dealSelect.value || null : null;

        const reader = new FileReader();
        reader.onload = (e) => {
            analyzeImage(e.target.result, file.name, dealId);
        };
        reader.readAsDataURL(file);
    }

    function showAnalysis(analysisId) {
        const a = analyses.find(x => x.id === analysisId);
        if (a) {
            currentAnalysis = a;
            renderUI();
        }
    }

    // ===== EXPORT =====
    function exportToCSV(analysisId) {
        const a = analyses.find(x => x.id === analysisId);
        if (!a || !a.result.openings) return;

        const headers = ['Code', 'Type', 'Dimensions', 'Quantité', 'Localisation', 'Extérieur', 'Notes'];
        const rows = a.result.openings.map(o => [
            o.code || '', o.type || '', o.dimensions || '', o.quantity || 1,
            o.location || '', o.exterior ? 'Oui' : 'Non', o.notes || ''
        ]);

        let csv = '\uFEFF'; // BOM for Excel UTF-8
        csv += headers.join(';') + '\n';
        rows.forEach(row => {
            csv += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';') + '\n';
        });

        // Add summary
        csv += '\n"RÉSUMÉ"\n';
        csv += `"Fenêtres extérieures";"${a.result.summary?.totalWindows || 0}"\n`;
        csv += `"Portes extérieures";"${a.result.summary?.totalExteriorDoors || 0}"\n`;
        csv += `"Total ouvertures";"${a.result.summary?.totalOpenings || 0}"\n`;

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Plan_${a.filename.replace(/\.\w+$/, '')}_ouvertures.csv`;
        link.click();
        URL.revokeObjectURL(url);
        App.showToast('CSV exporté - ouvrez-le dans Excel', 'success');
    }

    function copyToClipboard(analysisId) {
        const a = analyses.find(x => x.id === analysisId);
        if (!a || !a.result.openings) return;

        let text = `ANALYSE DE PLAN: ${a.filename}\n`;
        text += `Date: ${Deals.formatDate(a.analyzedAt)}\n`;
        text += `${a.result.planDescription || ''}\n\n`;

        a.result.openings.forEach((o, i) => {
            text += `${i + 1}. ${o.type || '?'} ${o.code ? `(${o.code})` : ''}\n`;
            text += `   Dimensions: ${o.dimensions || 'À mesurer'}\n`;
            text += `   Quantité: ${o.quantity || 1}\n`;
            text += `   Localisation: ${o.location || '-'}\n`;
            if (o.notes) text += `   Notes: ${o.notes}\n`;
            text += '\n';
        });

        text += `TOTAL: ${a.result.summary?.totalOpenings || 0} ouvertures\n`;

        navigator.clipboard.writeText(text).then(() => {
            App.showToast('Copié dans le presse-papiers!', 'success');
        });
    }

    async function addToDeal(analysisId) {
        const a = analyses.find(x => x.id === analysisId);
        if (!a || !a.dealId) return;

        let noteText = `📐 ANALYSE DE PLAN: ${a.filename}\n\n`;
        (a.result.openings || []).forEach((o, i) => {
            noteText += `${i + 1}. ${o.type} ${o.dimensions || ''} x${o.quantity || 1} - ${o.location || ''}\n`;
        });
        noteText += `\nTotal: ${a.result.summary?.totalOpenings || 0} ouvertures`;

        await Deals.addNote(a.dealId, noteText);
        App.showToast('Analyse ajoutée au deal comme note', 'success');
    }

    return {
        loadAnalyses,
        analyzeImage,
        renderUI,
        showAnalysis,
        exportToCSV,
        copyToClipboard,
        addToDeal,
        getApiConfig,
    };
})();
