/**
 * The PostgreSQL connection for Smart Inventory Control.
 *
 * One pool, opened lazily, shared by every query in the system. Nothing else in
 * the application talks to `pg` directly - store.js and reports.js go through
 * query() and withTransaction() below, so there is exactly one place that knows
 * how a connection is made.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURATION
 *
 * Read from inventory/.env, or from the real environment when one is already
 * set - a value exported by the shell or a deployment platform always wins, so
 * a checked-out .env cannot quietly override production settings.
 *
 * No value in this file has a default that could reach a real database by
 * accident: with nothing configured, connecting fails and says which variable
 * is missing. The password is never logged, never included in an error message
 * and never leaves this module.
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 *
 * Every statement this application issues is qualified with the schema below.
 * It reads and writes ONE schema - `inventory_control`, unless DB_SCHEMA names
 * another - and nothing else: the other schemas in this database belong to
 * other applications and are never referenced.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * DATE columns come back as 'YYYY-MM-DD' rather than a Date.
 *
 * The application treats `raisedOn` and `countedOn` as plain calendar dates and
 * prints them as they are. Letting node-postgres build a Date would drag the
 * server's timezone into a value that has no time in it, and a count taken on
 * the 9th could display as the 8th.
 */
pg.types.setTypeParser(1082, (value) => value);

/**
 * Load inventory/.env into a plain object.
 *
 * Deliberately tiny rather than a dependency: KEY=VALUE, `#` comments, optional
 * surrounding quotes. A missing file is not an error here - the variables may
 * come from the environment instead - it only becomes one when a required
 * setting turns out to be absent.
 *
 * @returns {Object<string, string>}
 */
function readEnvFile() {
  try {
    const text = readFileSync(join(HERE, '.env'), 'utf8');
    const values = {};

    for (const line of text.split(/\r?\n/)) {
      if (line.trimStart().startsWith('#')) continue;
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }

    return values;
  } catch {
    return {};
  }
}

const fileEnv = readEnvFile();

/** One setting, from the real environment first, then the file. */
const setting = (name) => process.env[name] ?? fileEnv[name] ?? '';

/**
 * The only schema this application touches.
 *
 * 'inventory_control' unless DB_SCHEMA says otherwise. The setting exists for
 * one reason: the test suite empties and reseeds every table it uses, which
 * must never happen to the schema the application serves. Tests therefore run
 * with DB_SCHEMA pointed at inventory_control_test (inventory/test.env), and
 * fixture/load.js refuses outright to delete or seed when this resolves to
 * inventory_control - so the application's data is untouchable from a test run
 * even if this setting is wrong.
 *
 * The name is interpolated into SQL rather than passed as a parameter - an
 * identifier cannot be a placeholder - so it is checked against the shape of a
 * plain unquoted identifier first. Anything else is refused here rather than
 * reaching the server.
 */
export const SCHEMA = (() => {
  const name = setting('DB_SCHEMA') || 'inventory_control';

  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`DB_SCHEMA is not a usable schema name: ${JSON.stringify(name)}.`);
  }

  return name;
})();

/**
 * Build the pool configuration, complaining clearly about anything missing.
 *
 * @returns {object}
 */
function poolConfig() {
  const missing = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].filter(
    (name) => setting(name) === '',
  );

  if (missing.length > 0) {
    throw new Error(
      `Database is not configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Copy inventory/.env.example to inventory/.env and fill it in.',
    );
  }

  const wantsTls = ['true', '1', 'require', 'yes'].includes(setting('DB_SSL').toLowerCase());

  return {
    host: setting('DB_HOST'),
    port: Number(setting('DB_PORT')),
    user: setting('DB_USER'),
    password: setting('DB_PASSWORD'),
    database: setting('DB_NAME'),
    // The server presents a self-signed certificate, so the connection is
    // encrypted but the certificate chain is not verified. sslmode=require,
    // not verify-full.
    ssl: wantsTls ? { rejectUnauthorized: false } : false,
    max: Number(setting('DB_POOL_MAX') || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: 'smart-inventory-control',
  };
}

/** @type {pg.Pool|null} */
let pool = null;

/**
 * The shared pool, opened on first use.
 *
 * @returns {pg.Pool}
 */
export function getPool() {
  if (pool === null) {
    pool = new pg.Pool(poolConfig());

    // An idle client dropped by the server must not take the process with it.
    pool.on('error', (error) => {
      console.error('[inventory] idle database client error:', error.message);
    });
  }

  return pool;
}

/**
 * Run one statement.
 *
 * @param {string} text   SQL, with $1-style placeholders.
 * @param {readonly unknown[]} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
export function query(text, params = []) {
  return getPool().query(text, params);
}

/**
 * Run one statement and hand back the rows.
 *
 * @param {string} text
 * @param {readonly unknown[]} [params]
 * @returns {Promise<object[]>}
 */
export async function rows(text, params = []) {
  return (await query(text, params)).rows;
}

/**
 * Run one statement and hand back the first row, or null.
 *
 * @param {string} text
 * @param {readonly unknown[]} [params]
 * @returns {Promise<object|null>}
 */
export async function firstRow(text, params = []) {
  return (await query(text, params)).rows[0] ?? null;
}

/**
 * Run several statements as one transaction on a single client.
 *
 * Used wherever a change is only correct if all of it happens - deleting a
 * product together with the records that point at it, or reseeding.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(work) {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check the database is reachable and the schema is present.
 *
 * Called once at startup so a misconfigured deployment fails immediately with
 * something readable, rather than on the first page a member of staff opens.
 *
 * @returns {Promise<{database: string, user: string, tables: number}>}
 */
export async function checkConnection() {
  const info = await firstRow(
    `SELECT current_database() AS database,
            current_user AS "user",
            (SELECT count(*)::int FROM information_schema.tables
              WHERE table_schema = $1) AS tables`,
    [SCHEMA],
  );

  if (info.tables === 0) {
    throw new Error(
      `Connected to ${info.database}, but the ${SCHEMA} schema has no tables. ` +
        'Run sql/001-inventory-control-schema.sql first.',
    );
  }

  return info;
}

/**
 * Close the pool. For tests and for a clean shutdown.
 *
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (pool !== null) {
    const closing = pool;
    pool = null;
    await closing.end();
  }
}
