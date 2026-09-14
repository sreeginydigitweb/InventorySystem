/**
 * The store: the one place the rest of the system asks for inventory data.
 *
 * It is READ-ONLY, and there is nothing in this file that could make it
 * otherwise. `ledsone` is an existing business database that this application
 * does not own; it reports on what is in it and never writes back. There is no
 * add, update or delete function here any more, so no route, no form and no
 * future edit to a screen can reach a write path - there is not one to reach.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LAYER STILL EXISTS
 *
 * source.js knows ledsone's tables. The screens, rules and reports know the
 * shapes they were written against. This module is the seam between them, and
 * it does two things worth having:
 *
 *   1. It holds the source behind useSource(), so the tests can run the whole
 *      application - routing, reports, detection, rendering - against sample
 *      data in memory, and never open a connection to the business database.
 *
 *   2. It answers the small lookups (one product, one stock line, the list of
 *      categories to offer in a filter) from the lists source.js has already
 *      read, rather than issuing another query per page.
 *
 * ---------------------------------------------------------------------------
 * DERIVED FIGURES ARE STILL NEVER STORED
 *
 * Available stock stays on_hand - reserved, the audit difference stays
 * counted - system, and every detected issue stays recomputed from the stock.
 * Nothing in the source is a saved copy of any of them, so none of them can
 * drift from the figures they come from.
 */

import * as ledsone from './source.js';

/* -------------------------------------------------------------------------- */
/* Where the data comes from                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The source the store reads. ledsone in production; a plain object of arrays
 * in a test.
 *
 * @type {{products: () => Promise<object[]>, warehouses: () => Promise<object[]>,
 *         stockLines: () => Promise<object[]>, transfers: () => Promise<object[]>,
 *         auditCounts: () => Promise<object[]>}}
 */
let source = ledsone;

/**
 * Point the store at a different source.
 *
 * Exists for the test suite, which supplies sample data in memory so no test
 * can reach the business database. Call with no argument to go back to ledsone.
 *
 * @param {object} [impl]
 * @returns {void}
 */
export function useSource(impl) {
  source = impl ?? ledsone;
}

/**
 * Build a source out of plain arrays.
 *
 * @param {{products?: object[], warehouses?: object[], stockLines?: object[],
 *          transfers?: object[], auditCounts?: object[]}} data
 * @returns {object}
 */
export function memorySource(data = {}) {
  const give = (list) => async () => list ?? [];

  return {
    products: give(data.products),
    warehouses: give(data.warehouses),
    stockLines: give(data.stockLines),
    transfers: give(data.transfers),
    auditCounts: give(data.auditCounts),
  };
}

/* -------------------------------------------------------------------------- */
/* Vocabulary the screens offer                                               */
/* -------------------------------------------------------------------------- */

/**
 * The transfer statuses a movement in this source can actually hold.
 *
 * This list used to be Pending / In Transit / Received - a workflow the source
 * has no trace of. Every transfer record in ledsone is a stock change that has
 * ALREADY been applied to both warehouses: searching the whole log finds
 * "pending" zero times, "in transit" zero times and "awaiting" zero times.
 * Offering those two as filters meant two of the three dropdown options could
 * only ever return an empty screen.
 *
 * So the list is now what the source can say, and the difference between the
 * two is real and readable off the record itself:
 *
 *   Received             the two legs agree - the quantity that left one site
 *                        is the quantity that arrived at the other
 *   Received (Adjusted)  the legs disagree, because the shelf was recounted in
 *                        the same edit. Both leg figures are kept on the row,
 *                        so the discrepancy is shown rather than smoothed over
 *
 * @see source.js TRANSFER_RECEIVED, TRANSFER_RECEIVED_ADJUSTED
 */
export const TRANSFER_STATUSES = Object.freeze(['Received', 'Received (Adjusted)']);

/**
 * Categories to offer in the Products filter.
 *
 * Derived from the catalogue rather than declared. The old declared list was
 * five invented categories; the source has a real one - the product_type its
 * Shopify listings carry - and the only honest list of them is the set actually
 * present. A SKU with no listing has no category and is simply absent from
 * every category-filtered view, which is what "not in the source" should look
 * like.
 *
 * @returns {Promise<string[]>}
 */
export async function categories() {
  return distinct(await allProducts(), 'category');
}

/**
 * Suppliers to offer in the Products filter, from the same real data.
 *
 * @returns {Promise<string[]>}
 */
export async function suppliers() {
  return distinct(await allProducts(), 'supplier');
}

/**
 * The sorted set of non-empty values a field takes across the catalogue.
 *
 * @param {readonly object[]} list
 * @param {string} field
 * @returns {string[]}
 */
function distinct(list, field) {
  const values = new Set();
  for (const item of list) {
    if (item[field]) values.add(item[field]);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

/* -------------------------------------------------------------------------- */
/* Small shared helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Thumbnail path for a SKU.
 *
 * Drawn by the server from the SKU itself, and used only when the source holds
 * no photograph for the product. It is not a picture of the product and does
 * not pretend to be one - it is initials on a coloured square, so a row without
 * an image still lines up with the rows that have one.
 *
 * @param {string} sku
 * @returns {string}
 */
export function imagePathFor(sku) {
  return `/images/${encodeURIComponent(sku)}.svg`;
}

/**
 * The image to show for a product: the real one, or the drawn fallback.
 *
 * @param {{sku: string, image: string|null}} product
 * @returns {string}
 */
export function productImage(product) {
  return product.image ?? imagePathFor(product.sku);
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The whole product catalogue.
 *
 * @returns {Promise<object[]>}
 */
export async function allProducts() {
  return source.products();
}

/**
 * One product, or null when the SKU is not in the catalogue.
 *
 * Returns null rather than throwing. A stock row may reference a SKU that is
 * not in the catalogue, and that is a condition the mismatch rule reports.
 *
 * @param {string} sku
 * @returns {Promise<object|null>}
 */
export async function findProduct(sku) {
  return (await allProducts()).find((product) => product.sku === sku) ?? null;
}

/**
 * Every warehouse, in display order.
 *
 * @returns {Promise<object[]>}
 */
export async function allWarehouses() {
  return source.warehouses();
}

/**
 * One warehouse, or null when the identifier is not a real site.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findWarehouse(id) {
  return (await allWarehouses()).find((warehouse) => warehouse.id === id) ?? null;
}

/**
 * Every stock line.
 *
 * @returns {Promise<object[]>}
 */
export async function allStockLines() {
  return source.stockLines();
}

/**
 * One stock line, addressed by the pair that identifies it.
 *
 * @param {string} sku
 * @param {string} warehouseId
 * @returns {Promise<object|null>}
 */
export async function findStockLine(sku, warehouseId) {
  return (
    (await allStockLines()).find(
      (line) => line.sku === sku && line.warehouseId === warehouseId,
    ) ?? null
  );
}

/**
 * Every transfer the source holds.
 *
 * @returns {Promise<object[]>}
 */
export async function allTransfers() {
  return source.transfers();
}

/**
 * One transfer, by identifier.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findTransfer(id) {
  return (await allTransfers()).find((transfer) => transfer.id === id) ?? null;
}

/**
 * Every physical stock count the source holds.
 *
 * @returns {Promise<object[]>}
 */
export async function allAuditCounts() {
  return source.auditCounts();
}

/**
 * One stock count, by identifier.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findAuditCount(id) {
  return (await allAuditCounts()).find((count) => count.id === id) ?? null;
}
