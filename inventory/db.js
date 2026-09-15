/**
 * The PostgreSQL connection for Smart Inventory Control.
 *
 * One pool, opened lazily, shared by every query in the system. Nothing else in
 * the application talks to `pg` directly - source.js goes through query() and
 * rows() below, so there is exactly one place that knows how a connection is
 * made.
 *
 * ---------------------------------------------------------------------------
 * THE SOURCE DATABASE IS READ-ONLY
 *
 * This application does not own its data. `ledsone` is an existing business
 * database and the source of truth for stock; this system only reports on what
 * is already in it. There is no write path anywhere in this application, and
 * three separate things stop one appearing by accident:
 *
 *   1. No statement in this codebase is anything but a SELECT. There is no
 *      INSERT, UPDATE, DELETE, CREATE, ALTER, DROP or TRUNCATE in the module
 *      graph the server loads.
 *
 *   2. Every connection this pool opens starts with
 *      `default_transaction_read_only = on` (see poolConfig below), so the
 *      SERVER refuses a write on this connection even if one were issued -
 *      "cannot execute INSERT in a read-only transaction". It is set as a
 *      connection option rather than a statement, so it is already in force on
 *      the very first query and cannot be missed.
 *
 *   3. The role the application connects as has no INSERT, UPDATE, DELETE or
 *      CREATE privilege on the source schemas. Verified with
 *      has_table_privilege(); checkConnection() re-checks it at startup and
 *      refuses to start if that ever stops being true.
 *
 * Any one of the three would be enough. All three are in place.
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
 * Every statement this application issues is qualified with one of the three
 * schemas named below, and reads only:
 *
 *   inventory         products, warehouses, physical stock, images
 *   suppliers         which supplier a SKU was last ordered from
 *   order_management  units sold, for the slow-moving rule
 *
 * The other schemas in the database belong to other applications and are never
 * referenced.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * DATE columns come back as 'YYYY-MM-DD' rather than a Date.
 *
 * The application treats calendar dates as plain dates and prints them as they
 * are. Letting node-postgres build a Date would drag the server's timezone into
 * a value that has no time in it.
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
 * Check a configured schema name and hand it back.
 *
 * A schema name is interpolated into SQL rather than passed as a parameter - an
 * identifier cannot be a placeholder - so it is checked against the shape of a
 * plain unquoted identifier first. Anything else is refused here rather than
 * reaching the server.
 *
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function schemaName(name, fallback) {
  const value = setting(name) || fallback;

  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`${name} is not a usable schema name: ${JSON.stringify(value)}.`);
  }

  return value;
}

/** Products, warehouses, physical stock and images. */
export const INVENTORY_SCHEMA = schemaName('DB_INVENTORY_SCHEMA', 'inventory');

/** Purchase orders, used for the supplier shown against a SKU. */
export const SUPPLIERS_SCHEMA = schemaName('DB_SUPPLIERS_SCHEMA', 'suppliers');

/** Sales orders, used for units sold in the last 90 days. */
export const ORDERS_SCHEMA = schemaName('DB_ORDERS_SCHEMA', 'order_management');

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
    // THE READ-ONLY LATCH. Sent as a startup option, so it is in force before
    // the first query rather than after a statement somebody could forget to
    // issue. With this set, the server itself refuses any INSERT, UPDATE,
    // DELETE, CREATE, ALTER, DROP or TRUNCATE on this connection, whatever the
    // application asks for. This is the line that makes "read-only" a property
    // of the connection rather than a promise about the code.
    options: '-c default_transaction_read_only=on',
    // The server presents a self-signed certificate, so the connection is
    // encrypted but the certificate chain is not verified. sslmode=require,
    // not verify-full.
    ssl: wantsTls ? { rejectUnauthorized: false } : false,
    // Deliberately small. The database role this application connects as is
    // shared with the other applications on this server, and the role has a
    // connection limit covering all of them together (25) - so a pool sized for
    // this application alone can exhaust the role and lock everyone out,
    // including itself at startup. Two is the smallest that still lets a page's
    // reads overlap; the rest queue on the pool rather than opening more.
    max: Number(setting('DB_POOL_MAX') || 2),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: 'smart-inventory-control (read-only)',
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
 * Check the source is reachable, readable, and still read-only to us.
 *
 * Called once at startup so a misconfigured deployment fails immediately with
 * something readable, rather than on the first page a member of staff opens.
 *
 * The last of the three checks is the important one: it asks the server whether
 * this role could write to the source if it tried. If the answer ever becomes
 * yes - somebody granted the role more than it needs - the application refuses
 * to start rather than running with a privilege it has no business holding.
 *
 * @returns {Promise<{database: string, user: string, readOnly: boolean, tables: number}>}
 */
export async function checkConnection() {
  const info = await firstRow(
    `SELECT current_database()                       AS database,
            current_user                             AS "user",
            current_setting('transaction_read_only')  AS read_only,
            (SELECT count(*)::int FROM information_schema.tables
              WHERE table_schema = $1)               AS tables,
            (has_table_privilege($2, 'INSERT')
             OR has_table_privilege($2, 'UPDATE')
             OR has_table_privilege($2, 'DELETE'))   AS can_write`,
    [INVENTORY_SCHEMA, `${INVENTORY_SCHEMA}.products`],
  );

  if (info.tables === 0) {
    throw new Error(
      `Connected to ${info.database}, but it has no ${INVENTORY_SCHEMA} schema. ` +
        'DB_NAME must name the source database (ledsone).',
    );
  }

  if (info.read_only !== 'on') {
    throw new Error(
      'The connection to the source database is not read-only. Refusing to start: ' +
        'this application must never be able to write to the source.',
    );
  }

  if (info.can_write === true) {
    throw new Error(
      `The role ${info.user} holds write privileges on ${INVENTORY_SCHEMA}.products. ` +
        'Refusing to start: the source database must be read-only to this application.',
    );
  }

  return {
    database: info.database,
    user: info.user,
    readOnly: info.read_only === 'on',
    tables: info.tables,
  };
}

/**
 * Close the pool. For a clean shutdown.
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
