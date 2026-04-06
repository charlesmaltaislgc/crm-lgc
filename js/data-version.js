// ===== CRM LGC - Module de versionnement des données =====
// Système de migrations pour maintenir la cohérence du schéma localStorage

const DataVersion = (() => {
    const VERSION_KEY = 'crm_schema_version';
    const CURRENT_VERSION = 2;

    // ===== DÉFINITION DES MIGRATIONS =====
    const migrations = [
        {
            version: 2,
            name: 'Ajout champs signMethod, DocuSign et Shopify étendu',
            migrate() {
                // Migration v1 → v2

                // 1. S'assurer que tous les deals ont le champ signMethod
                const deals = JSON.parse(localStorage.getItem('crm_deals') || '[]');
                let dealsModified = false;
                deals.forEach(deal => {
                    if (!deal.signMethod) {
                        deal.signMethod = 'manual'; // valeur par défaut
                        dealsModified = true;
                    }
                });
                if (dealsModified) {
                    localStorage.setItem('crm_deals', JSON.stringify(deals));
                    console.log('[DataVersion] Migration v2: signMethod ajouté à', deals.filter(d => d.signMethod === 'manual').length, 'deals');
                }

                // 2. S'assurer que tous les contrats ont les champs DocuSign
                const contracts = JSON.parse(localStorage.getItem('crm_contracts') || '[]');
                let contractsModified = false;
                contracts.forEach(contract => {
                    if (!contract.hasOwnProperty('docusignEnvelopeId')) {
                        contract.docusignEnvelopeId = null;
                        contractsModified = true;
                    }
                    if (!contract.hasOwnProperty('docusignStatus')) {
                        contract.docusignStatus = null;
                        contractsModified = true;
                    }
                    if (!contract.hasOwnProperty('docusignSentDate')) {
                        contract.docusignSentDate = null;
                        contractsModified = true;
                    }
                    if (!contract.hasOwnProperty('docusignSignedDate')) {
                        contract.docusignSignedDate = null;
                        contractsModified = true;
                    }
                });
                if (contractsModified) {
                    localStorage.setItem('crm_contracts', JSON.stringify(contracts));
                    console.log('[DataVersion] Migration v2: champs DocuSign ajoutés à', contracts.length, 'contrats');
                }

                // 3. S'assurer que les commandes Shopify ont tous les nouveaux champs
                const orders = JSON.parse(localStorage.getItem('crm_shopify_orders') || '[]');
                let ordersModified = false;
                orders.forEach(order => {
                    if (!order.hasOwnProperty('fulfillmentStatus')) {
                        order.fulfillmentStatus = null;
                        ordersModified = true;
                    }
                    if (!order.hasOwnProperty('trackingNumber')) {
                        order.trackingNumber = null;
                        ordersModified = true;
                    }
                    if (!order.hasOwnProperty('trackingUrl')) {
                        order.trackingUrl = null;
                        ordersModified = true;
                    }
                    if (!order.hasOwnProperty('tags')) {
                        order.tags = [];
                        ordersModified = true;
                    }
                    if (!order.hasOwnProperty('note')) {
                        order.note = '';
                        ordersModified = true;
                    }
                    if (!order.hasOwnProperty('linkedDealId')) {
                        order.linkedDealId = null;
                        ordersModified = true;
                    }
                });
                if (ordersModified) {
                    localStorage.setItem('crm_shopify_orders', JSON.stringify(orders));
                    console.log('[DataVersion] Migration v2: champs Shopify ajoutés à', orders.length, 'commandes');
                }
            }
        }
    ];

    // ===== INITIALISATION =====
    function init() {
        const currentVersion = parseInt(localStorage.getItem(VERSION_KEY) || '0', 10);

        if (currentVersion >= CURRENT_VERSION) {
            console.log(`[DataVersion] Schéma à jour (v${currentVersion})`);
            return;
        }

        console.log(`[DataVersion] Version actuelle: v${currentVersion}, cible: v${CURRENT_VERSION}`);

        // Exécuter les migrations nécessaires dans l'ordre
        const pendingMigrations = migrations
            .filter(m => m.version > currentVersion)
            .sort((a, b) => a.version - b.version);

        for (const migration of pendingMigrations) {
            console.log(`[DataVersion] Exécution migration v${migration.version}: ${migration.name}`);
            try {
                migration.migrate();
                console.log(`[DataVersion] Migration v${migration.version} complétée`);
            } catch (err) {
                console.error(`[DataVersion] Erreur migration v${migration.version}:`, err);
                // On continue quand même pour ne pas bloquer l'app
            }
        }

        // Mettre à jour la version
        localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION));
        console.log(`[DataVersion] Schéma mis à jour à v${CURRENT_VERSION}`);
    }

    // ===== API PUBLIQUE =====
    return {
        init,
        CURRENT_VERSION,
        getVersion: () => parseInt(localStorage.getItem(VERSION_KEY) || '0', 10)
    };
})();
