# Deploiement du Worker CRM LGC

Guide de deploiement du backend proxy Cloudflare Worker pour le CRM LGC.

## Prerequis

- Node.js v18+ installe
- Un compte Cloudflare (plan gratuit suffisant)
- Les cles API Shopify et DocuSign en main

## Etapes de deploiement

### 1. Installer Wrangler (CLI Cloudflare)

```bash
npm install -g wrangler
```

### 2. Se connecter a Cloudflare

```bash
wrangler login
```

Un navigateur s'ouvrira pour autoriser l'acces.

### 3. Creer le namespace KV

```bash
wrangler kv namespace create "CRM_DATA"
```

Copier l'identifiant retourne et le coller dans `wrangler.toml` a la ligne `id = "REMPLACER_PAR_VOTRE_KV_NAMESPACE_ID"`.

### 4. Configurer les secrets

Les secrets ne doivent jamais etre dans le code ou dans `wrangler.toml`. Les ajouter via la CLI :

```bash
wrangler secret put SHOPIFY_TOKEN
wrangler secret put DOCUSIGN_CLIENT_ID
wrangler secret put DOCUSIGN_CLIENT_SECRET
```

Chaque commande demandera de saisir la valeur de maniere securisee.

### 5. Ajuster les variables d'environnement

Dans `wrangler.toml`, modifier les valeurs sous `[vars]` :

| Variable | Description |
|---|---|
| `ALLOWED_ORIGIN` | Domaine autorise pour CORS (ex: `https://votre-crm.com`) ou `*` |
| `SHOPIFY_STORE` | Nom de la boutique Shopify (sans `.myshopify.com`) |
| `DOCUSIGN_BASE_URL` | `https://account-d.docusign.com` (demo) ou `https://account.docusign.com` (production) |

### 6. Deployer

```bash
wrangler deploy
```

Le terminal affichera l'URL du worker, par exemple :
`https://crm-lgc-api.<votre-compte>.workers.dev`

### 7. Configurer l'URL dans le CRM

Dans le CRM LGC, aller dans **Parametres** puis **Proxy URL** et entrer l'URL du worker.

## Verification

Tester que le worker repond correctement :

```bash
curl https://crm-lgc-api.<votre-compte>.workers.dev/api/health
```

Reponse attendue :

```json
{
  "status": "ok",
  "version": "1.0",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Endpoints disponibles

| Methode | Chemin | Description |
|---|---|---|
| GET | `/api/health` | Verification de l'etat du worker |
| GET | `/api/shopify/orders` | Proxy vers Shopify - liste des commandes |
| GET | `/api/shopify/shop` | Proxy vers Shopify - infos de la boutique |
| POST | `/api/docusign/token` | Echange d'un code d'autorisation DocuSign |
| POST | `/api/docusign/refresh` | Rafraichissement d'un token DocuSign expire |
| OPTIONS | `/api/*` | Preflight CORS |

## Mise a jour

Pour deployer une nouvelle version apres modification du code :

```bash
wrangler deploy
```

## Logs en temps reel

Pour surveiller les logs du worker (utile pour le debogage) :

```bash
wrangler tail
```
