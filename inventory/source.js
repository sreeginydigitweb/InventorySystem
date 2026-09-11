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
 *
 * NOT IN THE SOURCE. Nothing here is invented to fill the gap; see SOURCE_GAPS
 * at the foot of this file, which the screens print so staff can see why a
 * column or a screen is empty rather than assuming the business has no data.
 *
 *   Minimum / reorder level   no such column anywhere in ledsone
 *   Transfers                 no inter-warehouse transfer table
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
/* Transfers and audit counts                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Inter-warehouse transfers.
 *
 * ledsone has no transfer table. Every schema was searched for one: the nearest
 * match by name, listings.bandq_transfers, is a record of category spreadsheets
 * uploaded to B&Q and has nothing to do with moving stock between sites.
 *
 * So this returns nothing, and the Transfers screen says why. It does not
 * return invented rows, and there is nowhere for staff to create one, because a
 * transfer created here would be a record the business does not have.
 *
 * @returns {Promise<object[]>}
 */
export async function transfers() {
  return [];
}

/**
 * Physical stock counts.
 *
 * ledsone has no stock-count table. inventory.product_history is the closest
 * thing and is a free-text log of edits ("Quantity changed from 0 to 400"), not
 * a counted-against-system record: it has no counted quantity, no system
 * quantity at the time of counting, and no warehouse, so the difference the
 * audit screen exists to show - Counted - System - cannot be derived from it
 * without inventing two of its three terms.
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
  transfers:
    'ledsone holds no inter-warehouse transfer records, so there is nothing ' +
    'to show here. This screen reads the source; it does not create transfers.',
  audit:
    'ledsone holds no physical stock counts, so there is nothing to compare ' +
    'against the system figure. This screen reads the source; it does not ' +
    'record counts.',
});
