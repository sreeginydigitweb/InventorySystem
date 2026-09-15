/**
 * The source: everything this application knows, read from `ledsone`.
 *
 * `ledsone` is an existing business database and the source of truth for stock.
 * This module is the ONLY place that knows its table and column names. It reads
 * them and hands back the shapes the rest of the system was already written
 * against - sku, warehouseId, onHand, unitsSoldLast90Days - so the screens, the
 * detection rules and the reports did not have to change to follow a schema
 * they do not own.
 *
 * Every statement below is a SELECT. There is no write path in this file, and
 * the connection it uses cannot carry one (see db.js).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SOURCE HAS, AND WHAT IT DOES NOT
 *
 * Mapped from real columns:
 *
 *   Products          inventory.products (the 6,510 rows flagged
 *                     inventory_bool - the SKUs this business actually tracks
 *                     stock for; the other ~38,000 rows are catalogue history)
 *   Product name      inventory.products.title
 *   Product image     inventory.product_media (type 'main-image'), falling back
 *                     to inventory.product_images
 *   Category          listings.shopify_listings.product_type
 *   Supplier          suppliers.order_items -> orders -> suppliers
 *   Listing state     inventory.end_of_line_products.end_of_line_status
 *   Units sold (90d)  order_management orders -> order_item_info -> order_combo
 *   Warehouses        inventory.warehouse
 *   Warehouse stock   inventory.physical_product_stock
 *                       Current  = quantity
 *                       Reserved = reserved_quantity
 *                       Available is NOT a column; it is Current - Reserved,
 *                       derived on read, exactly as before.
 *   Transfers         inventory.product_history.history - the warehouse
 *                     stock-change entries, read as movements between two
 *                     sites. See the Transfers section below for how, and for
 *                     what that source can and cannot say.
 *
 * NOT IN THE SOURCE. Nothing here is invented to fill the gap; see SOURCE_GAPS
 * at the foot of this file, which the screens print so staff can see why a
 * column or a screen is empty rather than assuming the business has no data.
 *
 *   Minimum / reorder level   no such column anywhere in ledsone
 *   Audit / stock counts      no physical-count table
 *
 * ---------------------------------------------------------------------------
 * ONE READ PER MINUTE, NOT ONE PER PAGE
 *
 * The catalogue is 6,510 SKUs and 68,000 stock lines across ten warehouses, on
 * a database over the network. Re-reading all of it for every page - and the
 * dashboard alone needs products, warehouses and stock together - would make
 * every screen wait on the same three large results.
 *
 * So each read is cached in this process for CACHE_TTL_MS, and shared by every
 * request that arrives during it. Figures still follow the source: a change in
 * ledsone appears within the minute without a restart, and nothing is ever
 * written back or persisted, so the cache can only ever be behind, never wrong
 * in a way a refresh will not fix.
 */

import { createHash } from 'node:crypto';

import {
  INVENTORY_SCHEMA,
  ORDERS_SCHEMA,
  SUPPLIERS_SCHEMA,
  rows,
} from './db.js';

/** Listings schema, for the product_type shown as Category. */
const LISTINGS_SCHEMA = 'listings';

/** How long a read is reused before the source is asked again, in ms. */
export const CACHE_TTL_MS = Number(process.env.INVENTORY_CACHE_MS ?? 60_000);

/** The window the "units sold" figure covers, in days. */
export const SALES_WINDOW_DAYS = 90;

/**
 * The end-of-line status that means a listing has been withdrawn for good.
 *
 * inventory.end_of_line_products carries three values - 'Permanent',
 * 'Temporary' and 'Not Sure'. Only the first is a withdrawal; a line that may
 * come back, or that nobody has decided about, is still an active listing. The
 * raw value is carried through to the product page either way, so the
 * distinction is visible rather than flattened away.
 */
const WITHDRAWN_STATUS = 'Permanent';

/* -------------------------------------------------------------------------- */
/* Caching                                                                    */
/* -------------------------------------------------------------------------- */

/** @type {Map<string, {at: number, value: Promise<unknown>}>} */
const cache = new Map();

/**
 * Run a read, or hand back the one taken less than CACHE_TTL_MS ago.
 *
 * The promise is cached rather than the result, so ten requests arriving
 * together take one round trip between them rather than ten. A failed read is
 * evicted so the next request retries instead of being handed the error for a
 * minute.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} read
 * @returns {Promise<T>}
 */
function cached(key, read) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = read().catch((error) => {
    cache.delete(key);
    throw error;
  });

  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Drop everything cached. For a forced refresh and for tests. */
export function clearCache() {
  cache.clear();
}

/* -------------------------------------------------------------------------- */
/* Warehouses                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every warehouse in the business, in the source's own order.
 *
 * The identifier is an integer in ledsone and a string everywhere in this
 * application, so it is cast once, here, rather than being compared loosely
 * later.
 *
 * @returns {Promise<object[]>}
 */
export function warehouses() {
  return cached('warehouses', async () =>
    (
      await rows(`
        SELECT w.warehouse::text     AS id,
               w.warehouse_name      AS name,
               w.warehouse_location  AS location
          FROM ${INVENTORY_SCHEMA}.warehouse w
         ORDER BY w.warehouse`)
    ).map((row) =>
      Object.freeze({
        id: row.id,
        name: row.name,
        location: row.location,
      }),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The product catalogue.
 *
 * One statement rather than six round trips. Each CTE picks exactly one row per
 * product so the join cannot multiply the catalogue:
 *
 *   main_media / first_image  the image to show, preferring the designated
 *                             main image over the first gallery image
 *   category                  the product_type from the most recently updated
 *                             Shopify listing for the SKU
 *   supplier                  the supplier of the most recent purchase order
 *                             that included the SKU
 *   sold                      units despatched in the last 90 days, taken from
 *                             order_combo, which is the source's own expansion
 *                             of an order line into the SKUs it contains - so a
 *                             SKU sold only inside a multi-item bundle is still
 *                             counted, and the quantity is already multiplied
 *                             out by the order quantity
 *
 * Every one of them is a LEFT JOIN: a SKU with no listing, no purchase order
 * and no sales is still a product, and comes back with those fields empty
 * rather than being dropped or filled in with something plausible.
 *
 * @returns {Promise<object[]>}
 */
export function products() {
  return cached('products', async () =>
    (
      await rows(
        `
        WITH catalogue AS (
          SELECT p.id, p.sku, p.title, p.description
            FROM ${INVENTORY_SCHEMA}.products p
           WHERE p.inventory_bool
        ),
        main_media AS (
          SELECT DISTINCT ON (m.product_id) m.product_id, m.image_url
            FROM ${INVENTORY_SCHEMA}.product_media m
           WHERE m.type = 'main-image' AND coalesce(m.image_url, '') <> ''
           ORDER BY m.product_id, m.id
        ),
        first_image AS (
          SELECT DISTINCT ON (i.product_id) i.product_id, i.image_url
            FROM ${INVENTORY_SCHEMA}.product_images i
           WHERE coalesce(i.image_url, '') <> ''
           ORDER BY i.product_id, i.image_ordering NULLS LAST, i.id
        ),
        category AS (
          SELECT DISTINCT ON (coalesce(nullif(l.mapped_sku, ''), l.sku))
                 coalesce(nullif(l.mapped_sku, ''), l.sku) AS sku,
                 l.product_type
            FROM ${LISTINGS_SCHEMA}.shopify_listings l
           WHERE coalesce(l.product_type, '') <> ''
           ORDER BY 1, l.updated_at DESC NULLS LAST, l.id DESC
        ),
        supplier AS (
          SELECT DISTINCT ON (oi.sku) oi.sku, s.name
            FROM ${SUPPLIERS_SCHEMA}.order_items oi
            JOIN ${SUPPLIERS_SCHEMA}.orders     o ON o.id = oi.order_id
            JOIN ${SUPPLIERS_SCHEMA}.suppliers  s ON s.id = o.supplier_id
           WHERE coalesce(s.name, '') <> ''
           ORDER BY oi.sku, o.order_date DESC NULLS LAST, o.id DESC
        ),
        sold AS (
          SELECT c.sku, sum(c.qty)::int AS units
            FROM ${ORDERS_SCHEMA}.orders          o
            JOIN ${ORDERS_SCHEMA}.order_item_info i ON i.order_id = o.id
            JOIN ${ORDERS_SCHEMA}.order_combo     c ON c.order_item_info_id = i.id
           WHERE o.order_date >= now() - make_interval(days => $1::int)
           GROUP BY c.sku
        ),
        withdrawn AS (
          SELECT DISTINCT ON (e.sku) e.sku, e.end_of_line_status
            FROM ${INVENTORY_SCHEMA}.end_of_line_products e
           ORDER BY e.sku, e.updated_at DESC NULLS LAST, e.id DESC
        )
        SELECT c.sku,
               c.title                                        AS name,
               c.description,
               coalesce(mm.image_url, fi.image_url)            AS image_url,
               cat.product_type                                AS category,
               sup.name                                        AS supplier,
               coalesce(sold.units, 0)                         AS units_sold,
               w.end_of_line_status
          FROM catalogue c
          LEFT JOIN main_media  mm  ON mm.product_id = c.id
          LEFT JOIN first_image fi  ON fi.product_id = c.id
          LEFT JOIN category    cat ON cat.sku = c.sku
          LEFT JOIN supplier    sup ON sup.sku = c.sku
          LEFT JOIN sold            ON sold.sku = c.sku
          LEFT JOIN withdrawn   w   ON w.sku = c.sku
         ORDER BY c.sku`,
        [SALES_WINDOW_DAYS],
      )
    ).map(toProduct),
  );
}

/**
 * One catalogue row, in the shape the screens expect.
 *
 * `approvedWarehouses` is deliberately null rather than an empty array. The
 * source has no concept of a SKU being approved for a site, and an empty array
 * would make the mismatch rule report every single stock line as held somewhere
 * it should not be. Null says "the source does not answer this", and
 * warehouseMismatchReason() skips that check accordingly - the two faults it
 * CAN see in real data, an unknown warehouse and an unknown SKU, are still
 * detected.
 *
 * @param {object} row
 * @returns {object}
 */
function toProduct(row) {
  return Object.freeze({
    sku: row.sku,
    name: row.name,
    // Null when the source holds no image. The screens fall back to the
    // thumbnail this server draws from the SKU itself, so a product without a
    // photograph still lines up in the table.
    image: row.image_url ?? null,
    category: row.category ?? null,
    supplier: row.supplier ?? null,
    description: row.description ?? null,
    active: row.end_of_line_status !== WITHDRAWN_STATUS,
    endOfLineStatus: row.end_of_line_status ?? null,
    unitsSoldLast90Days: row.units_sold,
    approvedWarehouses: null,
  });
}

/* -------------------------------------------------------------------------- */
/* Warehouse stock                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Every stock line: one SKU held at one warehouse.
 *
 * Joined to the catalogue rather than read on its own, so the lines are the
 * ones belonging to the SKUs this system tracks. The warehouse is NOT joined:
 * physical_product_stock holds thousands of rows against warehouse 33, which is
 * not in inventory.warehouse, and those rows are precisely what the
 * Warehouse/SKU Mismatch rule exists to surface. Filtering them out here would
 * delete the system's ability to report a real problem.
 *
 * There is no minimum or reorder-level column in the source, so `minimum` is
 * not set on the line at all; rules.js falls back to its stated application
 * threshold. It is left absent rather than filled in with a number, so nothing
 * downstream can mistake an application setting for a figure the business set.
 *
 * @returns {Promise<object[]>}
 */
export function stockLines() {
  return cached('stockLines', async () =>
    (
      await rows(`
        SELECT p.sku,
               s.warehouse::text          AS warehouse_id,
               s.quantity                 AS on_hand,
               s.reserved_quantity        AS reserved,
               s.shelf_quantity,
               s.shelf_capacity,
               s.product_shelf_location,
               s.product_bulk_location
          FROM ${INVENTORY_SCHEMA}.physical_product_stock s
          JOIN ${INVENTORY_SCHEMA}.products p
            ON p.id = s.inventory AND p.inventory_bool
         ORDER BY p.sku, s.warehouse`)
    ).map((row) =>
      Object.freeze({
        sku: row.sku,
        warehouseId: row.warehouse_id,
        onHand: row.on_hand,
        reserved: row.reserved,
        shelfQuantity: row.shelf_quantity,
        shelfCapacity: row.shelf_capacity,
        shelfLocation: row.product_shelf_location,
        bulkLocation: row.product_bulk_location,
      }),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Transfers                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * WHERE THE TRANSFER DATA ACTUALLY IS
 *
 * ledsone has no transfer header/item table, and this file used to conclude
 * from that that the business had no transfer records at all. That conclusion
 * was wrong. The records exist; they are written into the free-text log in
 * inventory.product_history.history, one line per stock-change event:
 *
 *   UK stock changes: Unit3(Quantity) from 121 to 226,Unit18(unit1) from 105
 *   to 0 (all taken unit 18 in transfer informed nanthini akka) by mithusha on
 *   2026-01-29 via inventory CSV.
 *
 * A line carries one to three LEGS - "UnitN(field) from OLD to NEW" - then an
 * optional note in brackets, then who applied it and when.
 *
 * A line is a TRANSFER when two of its legs move in opposite directions: stock
 * left one warehouse and arrived at another. The warehouse that went down is
 * Warehouse From; the one that went up is Warehouse To.
 *
 * Everything else in that log is something other than a transfer, and is
 * dropped here rather than shown as one:
 *
 *   one leg only                a stock correction at a single site
 *   two legs, same direction    two sites recounted in one go
 *   no readable opening figure  "from  to 50" - no delta can be worked out
 *   Mark(unit2), Out of stock   flags, not warehouses
 *
 * ---------------------------------------------------------------------------
 * THE UNIT TOKEN IS THE WAREHOUSE. THE BRACKET IS NOT.
 *
 * The name in brackets is the legacy column the figure used to live in, and it
 * does NOT agree with the unit number in front of it:
 *
 *   Unit3(Quantity)   is UK Unit3
 *   Unit4(unit3)      is UK Unit4  - NOT UK Unit3
 *   Unit18(unit1)     is UK Unit18 - NOT UK Unit1
 *
 * Reading the bracket would silently file a third of the movements against the
 * wrong site, so the warehouse is resolved from the UnitN token only.
 * unitWarehouseMap() builds that mapping out of inventory.warehouse itself
 * rather than hard-coding it.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO REFERENCE NUMBER, AND THERE IS NO "PENDING"
 *
 * Two things the source genuinely does not have, and neither is invented:
 *
 *   A reference number. There is no business transfer id anywhere in ledsone,
 *   so one is DERIVED - a stable hash of the event that produced the line, and
 *   labelled a derived reference wherever it is shown. Rows sharing it are the
 *   SKUs that moved together in one event, which is how one transfer comes to
 *   carry many SKU lines.
 *
 *   A workflow status. Across all 10,615 stock-change lines, "pending" appears
 *   zero times, "in transit" zero times and "awaiting" zero times. Every line
 *   records a move ALREADY applied to both warehouses, so the only honest
 *   status is Received. Where the two legs disagree - stock moved and the
 *   shelf recounted in the same edit - it is Received (Adjusted), and both leg
 *   quantities are carried through so the difference is visible rather than
 *   averaged away.
 */

/** One leg of a stock-change line: "Unit4(unit3) from 179 to 0". */
const LEG_PATTERN = /(Unit\d+)\(([^)]*)\)\s+from\s+(-?\d*)\s+to\s+(-?\d+)/g;

/**
 * The trailing "by <user> on <date>" every applied change carries.
 *
 * The name may be more than one word - "by Thojika Santhaseelan on 2026-07-22"
 * is a real, current user - so it is not limited to one token. It cannot cross
 * a bracket, which is what stops a "by" inside the note ("(Informed by Nanthini
 * akka) by ...") being read as the person who applied the change.
 */
const APPLIED_PATTERN = /\bby\s+([^()\r\n]+?)\s+on\s+(\d{4}-\d{2}-\d{2})/g;

/** The note in brackets, immediately before "by <user>". */
const NOTE_PATTERN = /\(([^()]*)\)\s*by\s/;

/** A movement whose two legs agree on the quantity. */
export const TRANSFER_RECEIVED = 'Received';

/** A movement recorded alongside a recount, so the two legs disagree. */
export const TRANSFER_RECEIVED_ADJUSTED = 'Received (Adjusted)';

/**
 * Map a "UnitN" token to a warehouse id, using the warehouse list itself.
 *
 * Only UK sites are considered: the log line says "UK stock changes", and no
 * other warehouse in the source carries a unit number, so there is nothing for
 * a French or German site to be confused with.
 *
 * @param {readonly {id: string, name: string, location: string}[]} warehouseList
 * @returns {Map<string, string>} "Unit3" -> warehouse id.
 */
export function unitWarehouseMap(warehouseList) {
  const map = new Map();

  for (const warehouse of warehouseList) {
    if (String(warehouse.location ?? '').trim().toUpperCase() !== 'UK') continue;

    const match = /unit\s*(\d+)\b/i.exec(String(warehouse.name ?? ''));
    if (match) map.set(`Unit${match[1]}`, warehouse.id);
  }

  return map;
}

/**
 * A stable derived reference for the event a movement belongs to.
 *
 * Derived, not read: ledsone has no transfer reference. The same event always
 * produces the same reference, so a link to a transfer keeps working between
 * reads, and the SKUs that moved together share one.
 *
 * @param {{raisedOn: string, recordedBy: string, note: string,
 *          fromWarehouseId: string, toWarehouseId: string}} event
 * @returns {string}
 */
export function transferReference(event) {
  const material = [
    event.raisedOn,
    event.recordedBy,
    event.note,
    event.fromWarehouseId,
    event.toWarehouseId,
  ].join('\u0000');

  return `TR-${createHash('sha1').update(material).digest('hex').slice(0, 10).toUpperCase()}`;
}

/**
 * Read one history line, and say what movement it describes - if any.
 *
 * Exported so the extraction can be exercised against real line text without
 * opening a connection to the source.
 *
 * @param {string} text                One line of product_history.history.
 * @param {Map<string, string>} units  From unitWarehouseMap().
 * @returns {object|null} The movement, or null when the line is not a transfer.
 */
export function parseTransferLine(text, units) {
  const line = String(text ?? '');

  const legs = [];
  LEG_PATTERN.lastIndex = 0;
  for (let match = LEG_PATTERN.exec(line); match; match = LEG_PATTERN.exec(line)) {
    // An opening figure that is not there - "from  to 50" - makes the delta
    // unknowable. The whole line goes rather than half of it: the leg that
    // could not be read may be the one that balances the move.
    if (match[3] === '') return null;
    legs.push({ unit: match[1], delta: Number(match[4]) - Number(match[3]) });
  }

  // One leg is a correction at a single site, not a move between two.
  if (legs.length < 2) return null;

  // The biggest fall is where the stock left; the biggest rise is where it
  // arrived. On a three-leg line the third is a negative being zeroed out and
  // is not part of the move.
  let out = null;
  let into = null;
  for (const leg of legs) {
    if (leg.delta < 0 && (out === null || leg.delta < out.delta)) out = leg;
    if (leg.delta > 0 && (into === null || leg.delta > into.delta)) into = leg;
  }

  // Both sites moved the same way: two recounts in one edit, not a transfer.
  if (out === null || into === null) return null;

  APPLIED_PATTERN.lastIndex = 0;
  let applied = null;
  for (let match = APPLIED_PATTERN.exec(line); match; match = APPLIED_PATTERN.exec(line)) {
    applied = match;
  }
  if (applied === null) return null;

  const quantityOut = Math.abs(out.delta);
  const quantityIn = into.delta;

  return {
    // An unmapped unit keeps its token as its identifier rather than being
    // dropped. Unit5 appears in the log and has no row in inventory.warehouse;
    // those movements are still real, and are shown under the name the log
    // gave them rather than deleted for being inconvenient.
    fromWarehouseId: units.get(out.unit) ?? out.unit,
    toWarehouseId: units.get(into.unit) ?? into.unit,
    // The conservative figure. Where the legs disagree, the smaller of the two
    // is the most that can honestly be called moved; the rest was a recount.
    quantity: Math.min(quantityOut, quantityIn),
    quantityOut,
    quantityIn,
    status: quantityOut === quantityIn ? TRANSFER_RECEIVED : TRANSFER_RECEIVED_ADJUSTED,
    raisedOn: applied[2],
    recordedBy: applied[1],
    note: (NOTE_PATTERN.exec(line)?.[1] ?? '').trim(),
  };
}

/** How a bracket balance is kept: opening brackets less closing ones. */
const bracketDepth = (text) =>
  (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;

/**
 * Put back together a log entry whose note was typed across several lines.
 *
 * The log is split into entries on line breaks, but a note is free text and
 * staff sometimes press Enter inside it:
 *
 *   UK stock changes: Unit3(Quantity) from -42 to 4,Unit18(unit1) from 60 to 0 (Informed by 0 in Unit 18 - Nanthu
 *   4 in Unit 3 - Nanthi Akka) by Slakshika on 2026-01-09 via inventory CSV.
 *
 * Read on its own, the first line has no "by <user> on <date>" and a real
 * transfer was silently dropped. An entry whose note bracket is still open at
 * the end of the line is therefore continued onto the lines after it until the
 * bracket closes. Anything else is handed back untouched - so is an entry whose
 * bracket never closes, or that would run into the next stock-change entry,
 * because guessing where it ends would be worse than leaving it unread.
 *
 * @param {string} line                   One line of the log.
 * @param {readonly string[]} [following] The lines after it, in order.
 * @returns {string}
 */
export function joinWrappedEntry(line, following = []) {
  const first = String(line ?? '');
  if (bracketDepth(first) <= 0) return first;

  let text = first;
  for (const next of following ?? []) {
    const part = String(next ?? '').trim();
    if (part.startsWith('UK stock changes:') || part.startsWith('[')) break;

    text = `${text} ${part}`;
    if (bracketDepth(text) <= 0) return text;
  }

  return first;
}

/**
 * Turn the matching history lines into transfer rows.
 *
 * One row per SKU per movement, which is the grain the screen lists and the
 * filters narrow. Rows produced by one event share a derived reference, and the
 * transfer detail page gathers them back up by it.
 *
 * @param {readonly {sku: string, line: string, following?: string[]|null}[]} lines
 *        `following` is the next few lines of the log, supplied only when the
 *        line's note runs on past its end - see joinWrappedEntry().
 * @param {readonly object[]} warehouseList
 * @returns {object[]}
 */
export function extractTransfers(lines, warehouseList) {
  const units = unitWarehouseMap(warehouseList);
  const found = [];

  for (const row of lines) {
    const movement = parseTransferLine(joinWrappedEntry(row.line, row.following ?? []), units);
    if (movement === null) continue;

    found.push(
      Object.freeze({
        id: transferReference(movement),
        sku: row.sku,
        ...movement,
      }),
    );
  }

  // Most recent first, then grouped by reference, so the newest movements are
  // on the first page and a transfer's SKU lines sit together.
  return found.sort(
    (a, b) =>
      b.raisedOn.localeCompare(a.raisedOn) ||
      a.id.localeCompare(b.id) ||
      a.sku.localeCompare(b.sku),
  );
}

/**
 * Every warehouse-to-warehouse movement the source records.
 *
 * The line splitting and the "is this a transfer line at all" test happen in
 * the database, so what comes back is the ten thousand candidate lines rather
 * than the whole log. Deciding which of those is actually a transfer happens in
 * parseTransferLine() above, where it can be read and tested.
 *
 * A candidate line whose note bracket is still open at its end also brings the
 * next three lines of the log with it, so a note typed across several lines can
 * be put back together - see joinWrappedEntry(). Every other line brings none.
 *
 * @returns {Promise<object[]>}
 */
export function transfers() {
  return cached('transfers', async () =>
    extractTransfers(
      // lead() rather than indexing an array of the lines: a subscript into a
      // text[] walks the array from the start, which on the longest histories
      // turned this read from seconds into minutes. Histories with no
      // stock-change entry at all are skipped before anything is split.
      await rows(`
        WITH numbered AS (
          SELECT p.sku,
                 l.line,
                 l.n,
                 lead(l.line, 1) OVER entry AS next1,
                 lead(l.line, 2) OVER entry AS next2,
                 lead(l.line, 3) OVER entry AS next3
            FROM ${INVENTORY_SCHEMA}.product_history h
            JOIN ${INVENTORY_SCHEMA}.products p
              ON p.id = h.inventory_id AND p.inventory_bool
           CROSS JOIN LATERAL regexp_split_to_table(h.history, E'[\\r\\n]+')
                 WITH ORDINALITY AS l(line, n)
           WHERE h.history LIKE '%UK stock changes: Unit%'
          WINDOW entry AS (PARTITION BY h.ctid ORDER BY l.n)
        )
        SELECT sku,
               trim(line) AS line,
               CASE
                 WHEN length(line) - length(replace(line, '(', ''))
                    > length(line) - length(replace(line, ')', ''))
                 THEN ARRAY[next1, next2, next3]
               END AS following
          FROM numbered
         WHERE trim(line) LIKE 'UK stock changes: Unit%'`),
      await warehouses(),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Audit counts                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Physical stock counts.
 *
 * ledsone has no stock-count table, and inventory.product_history is NOT one.
 * That log is where the transfers above come from, and it answers a different
 * question: it records what a stock figure was changed FROM and TO, by whom.
 * An audit line needs what was counted on the shelf against what the system
 * believed at the moment of counting - two figures the log does not hold and
 * which cannot be recovered from it. Reusing it here would mean inventing two
 * of the three terms in Counted - System, so it is not reused here.
 *
 * @returns {Promise<object[]>}
 */
export async function auditCounts() {
  return [];
}

/* -------------------------------------------------------------------------- */
/* What the source cannot answer                                              */
/* -------------------------------------------------------------------------- */

/**
 * The gaps between what the screens can show and what ledsone holds.
 *
 * Printed on the screen each one affects. A screen that is empty because the
 * business has no data looks exactly like a screen that is empty because it is
 * broken, and staff should not have to guess which they are looking at.
 */
export const SOURCE_GAPS = Object.freeze({
  minimum:
    'ledsone holds no minimum or reorder level for a SKU, so Low Stock is ' +
    'flagged against a single application-wide threshold instead.',
  audit:
    'ledsone holds no physical stock counts, so there is nothing to compare ' +
    'against the system figure. This screen reads the source; it does not ' +
    'record counts.',
});
