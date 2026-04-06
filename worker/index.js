/**
 * CRM LGC - Cloudflare Worker Backend Proxy
 *
 * Handles:
 *   - Shopify Admin API proxy (/api/shopify/*)
 *   - DocuSign OAuth token management (/api/docusign/*)
 *   - Health check (/api/health)
 *   - CORS preflight for all /api/* routes
 *   - Scheduled cron tasks (envelope status checks)
 */

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function corsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Shopify-Store, X-Shopify-Token',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(body, status = 200, env = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  });
}

function errorResponse(message, status = 400, env = {}) {
  return jsonResponse({ error: message }, status, env);
}

// ---------------------------------------------------------------------------
// Route: OPTIONS preflight
// ---------------------------------------------------------------------------

function handleOptions(env) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(env),
  });
}

// ---------------------------------------------------------------------------
// Route: GET /api/health
// ---------------------------------------------------------------------------

function handleHealth(env) {
  return jsonResponse({
    status: 'ok',
    version: '1.0',
    timestamp: new Date().toISOString(),
  }, 200, env);
}

// ---------------------------------------------------------------------------
// Route: Shopify proxy  /api/shopify/*
// ---------------------------------------------------------------------------

const SHOPIFY_ROUTE_MAP = {
  '/api/shopify/orders': '/admin/api/2024-01/orders.json',
  '/api/shopify/shop': '/admin/api/2024-01/shop.json',
};

async function handleShopify(request, env, pathname) {
  const shopifyPath = SHOPIFY_ROUTE_MAP[pathname];
  if (!shopifyPath) {
    return errorResponse(`Unknown Shopify endpoint: ${pathname}`, 404, env);
  }

  // Store & token can come from headers (per-request) or env vars (global)
  const store = request.headers.get('X-Shopify-Store') || env.SHOPIFY_STORE;
  const token = request.headers.get('X-Shopify-Token') || env.SHOPIFY_TOKEN;

  if (!store || !token) {
    return errorResponse(
      'Missing Shopify credentials. Provide X-Shopify-Store / X-Shopify-Token headers or configure env vars.',
      401,
      env,
    );
  }

  // Build upstream URL  (preserve incoming query string)
  const incomingUrl = new URL(request.url);
  const shopifyUrl = new URL(`https://${store}.myshopify.com${shopifyPath}`);
  shopifyUrl.search = incomingUrl.search; // forward ?status=open, ?limit=50, etc.

  try {
    const upstream = await fetch(shopifyUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(env),
      },
    });
  } catch (err) {
    return errorResponse(`Shopify request failed: ${err.message}`, 502, env);
  }
}

// ---------------------------------------------------------------------------
// Route: DocuSign token management  /api/docusign/*
// ---------------------------------------------------------------------------

async function handleDocuSignToken(request, env) {
  const { DOCUSIGN_CLIENT_ID, DOCUSIGN_CLIENT_SECRET, DOCUSIGN_BASE_URL } = env;

  if (!DOCUSIGN_CLIENT_ID || !DOCUSIGN_CLIENT_SECRET) {
    return errorResponse('DocuSign client credentials not configured on the worker.', 500, env);
  }

  const baseUrl = DOCUSIGN_BASE_URL || 'https://account-d.docusign.com'; // demo by default

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body.', 400, env);
  }

  const { code, redirect_uri } = body;

  if (!code) {
    return errorResponse('Missing "code" in request body.', 400, env);
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
  });
  if (redirect_uri) {
    params.set('redirect_uri', redirect_uri);
  }

  return doDocuSignTokenRequest(baseUrl, DOCUSIGN_CLIENT_ID, DOCUSIGN_CLIENT_SECRET, params, env);
}

async function handleDocuSignRefresh(request, env) {
  const { DOCUSIGN_CLIENT_ID, DOCUSIGN_CLIENT_SECRET, DOCUSIGN_BASE_URL } = env;

  if (!DOCUSIGN_CLIENT_ID || !DOCUSIGN_CLIENT_SECRET) {
    return errorResponse('DocuSign client credentials not configured on the worker.', 500, env);
  }

  const baseUrl = DOCUSIGN_BASE_URL || 'https://account-d.docusign.com';

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body.', 400, env);
  }

  const { refresh_token } = body;

  if (!refresh_token) {
    return errorResponse('Missing "refresh_token" in request body.', 400, env);
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token,
  });

  return doDocuSignTokenRequest(baseUrl, DOCUSIGN_CLIENT_ID, DOCUSIGN_CLIENT_SECRET, params, env);
}

async function doDocuSignTokenRequest(baseUrl, clientId, clientSecret, params, env) {
  const credentials = btoa(`${clientId}:${clientSecret}`);

  try {
    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return jsonResponse(
        { error: data.error || 'DocuSign token request failed', detail: data },
        response.status,
        env,
      );
    }

    // Return only the fields the CRM needs
    return jsonResponse({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type || 'Bearer',
    }, 200, env);
  } catch (err) {
    return errorResponse(`DocuSign request failed: ${err.message}`, 502, env);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return handleOptions(env);
  }

  // Health
  if (pathname === '/api/health' && method === 'GET') {
    return handleHealth(env);
  }

  // Shopify proxy
  if (pathname.startsWith('/api/shopify/') && method === 'GET') {
    return handleShopify(request, env, pathname);
  }

  // DocuSign
  if (pathname === '/api/docusign/token' && method === 'POST') {
    return handleDocuSignToken(request, env);
  }
  if (pathname === '/api/docusign/refresh' && method === 'POST') {
    return handleDocuSignRefresh(request, env);
  }

  // Fallback
  return errorResponse('Not found', 404, env);
}

// ---------------------------------------------------------------------------
// Scheduled (Cron Trigger)
// ---------------------------------------------------------------------------

async function handleScheduled(event, env, ctx) {
  const now = new Date().toISOString();
  console.log(`[cron] Scheduled task executed at ${now}`);

  // Future: check KV for pending DocuSign envelopes and update their status.
  // Example skeleton:
  //
  // const pendingList = await env.CRM_DATA.get('docusign:pending', { type: 'json' });
  // if (pendingList && pendingList.length) {
  //   for (const envelopeId of pendingList) {
  //     // call DocuSign API to check envelope status
  //     // update KV accordingly
  //   }
  // }

  console.log('[cron] Done. No pending tasks configured yet.');
}

// ---------------------------------------------------------------------------
// Export (ESM format for Cloudflare Workers)
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorResponse('Internal server error', 500, env);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  },
};
