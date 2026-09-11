/**
 * HTTP server for Smart Inventory Control.
 *
 * Node's built-in http module. No framework, no dependencies, no build step.
 *
 * This module is deliberately thin: it turns a request into a path and a query,
 * hands them to route(), and writes back what it gets. All the decisions live
 * in router.js, which is why they can be tested without a socket.
 *
 * Everything on screen comes from PostgreSQL, from the inventory_control schema
 * of the configured database. The connection is checked once at startup so a
 * misconfigured deployment fails here, with something readable, rather than on
 * the first page a member of staff opens.
 *
 * Start with:  npm start        (or: node inventory/server.js)
 */

import { createServer } from 'node:http';

import { route, routeForm } from './router.js';
import { renderNotFoundPage } from './render.js';
import { checkConnection, closePool } from './db.js';

/** Port used when INVENTORY_PORT is not set. */
export const DEFAULT_PORT = 3000;

/**
 * Largest form body accepted, in bytes.
 *
 * The forms in this system are a handful of short fields; a request larger than
 * this is not one of them. The limit is enforced as the body arrives rather
 * than after it, so nothing unbounded is ever held in memory.
 */
export const MAX_BODY_BYTES = 16 * 1024;

/**
 * Read and decode a posted form body.
 *
 * Only application/x-www-form-urlencoded is accepted - that is what a plain
 * HTML form sends, and this system has no other kind of client. Anything else
 * is rejected rather than guessed at.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<URLSearchParams|null>} Null when the body is unusable.
 */
function readForm(req) {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', () => resolve(null));
  });
}

/**
 * Security headers.
 *
 * script-src is 'self' and nothing more. The only script in the system is
 * /filters.js, which this server generates and serves from this origin; there
 * is no CDN, no bundle and no third party. 'unsafe-inline' is deliberately NOT
 * allowed, which is why the auto-apply behaviour lives in that file rather than
 * in an onchange attribute - an inline handler would need the CSP relaxed far
 * further than a same-origin file does.
 *
 * Images are the SVG thumbnails this server generates, so img-src is limited to
 * this origin too. Nothing external is ever loaded.
 */
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
});

/**
 * Build the server.
 *
 * @returns {import('node:http').Server}
 */
export function createInventoryServer() {
  return createServer(async (req, res) => {
    // Reading is a GET; the only thing that can change data is a POST from one
    // of the record forms. Nothing else is accepted.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
      res.writeHead(405, {
        allow: 'GET, HEAD, POST',
        ...SECURITY_HEADERS,
        'content-type': 'text/html; charset=utf-8',
      });
      res.end(renderNotFoundPage());
      return;
    }

    try {
      // The base is a placeholder: only the path and query are ever used.
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'POST') {
        const form = await readForm(req);
        if (form === null) {
          res.writeHead(400, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' });
          res.end(renderNotFoundPage());
          return;
        }

        const result = await routeForm(url.pathname, form);

        // A write that went through answers with a redirect, so the browser
        // reloads the list with a fresh GET and refreshing cannot repeat it.
        if (result.location) {
          res.writeHead(303, { ...SECURITY_HEADERS, location: result.location });
          res.end();
          return;
        }

        res.writeHead(result.status, { ...SECURITY_HEADERS, 'content-type': result.contentType });
        res.end(result.body);
        return;
      }

      const { status, contentType, body } = await route(url.pathname, url.searchParams);

      res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': contentType });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      // The operator gets the detail; the page says nothing technical.
      console.error('[inventory] failed to render:', error?.message);
      res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' });
      res.end(renderNotFoundPage());
    }
  });
}

/* c8 ignore start - entry point, exercised by running the server */
async function main() {
  const port = Number(process.env.INVENTORY_PORT ?? DEFAULT_PORT);

  // Fail here, with something readable, rather than on the first page a member
  // of staff opens.
  let where;
  try {
    where = await checkConnection();
  } catch (error) {
    console.error('[inventory] cannot start:', error.message);
    process.exitCode = 1;
    await closePool();
    return;
  }

  const server = createInventoryServer();

  server.listen(port, () => {
    console.log(`[inventory] Smart Inventory Control running on http://localhost:${port}/`);
    console.log(
      `[inventory] data from PostgreSQL: ${where.database}, schema inventory_control, as ${where.user}.`,
    );
  });

  const shutdown = () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.endsWith('server.js')) {
  main();
}
/* c8 ignore stop */
