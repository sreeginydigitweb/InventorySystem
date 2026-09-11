/**
 * Reporting: the derived views the screens are built from.
 *
 * Like rules.js this owns no HTML. It turns what is in the database plus the
 * detection rules into the exact shapes the six screens need, so a screen never
 * has to work anything out for itself.
 *
 * Every figure here is derived on each call. Nothing is cached and nothing is
 * written back, so what a screen shows is always what the data says.
 *
 * ---------------------------------------------------------------------------
 * ONE SNAPSHOT PER REQUEST
 *
 * The database is remote, so a round trip is not free. Each of these functions
 * can be handed a snapshot() - one parallel read of the five tables - and a
 * screen that needs several reports takes one snapshot and passes it to all of
 * them. Called without one, a function loads its own, so each is still usable
 * on its own and in a test.
 */

import {
  STOCK_STATUS,
  describeSkuPosition,
  describeStockLine,
  detectIssues,
  makeCatalogue,
} from './rules.js';
import {
  TRANSFER_STATUSES,
  allAuditCounts,
  allProducts,
  allStockLines,
  allTransfers,
  allWarehouses,
  productImage,
} from './store.js';

/**
 * Read everything the screens are built from, in parallel.
 *
 * Six statements, issued together rather than one after another, so a page
 * costs roughly one round trip instead of six.
 *
 * @returns {Promise<object>}
 */
export async function snapshot() {
  const [products, warehouses, stockLines, transfers, auditCounts] = await Promise.all([
    allProducts(),
    allWarehouses(),
    allStockLines(),
    allTransfers(),
    allAuditCounts(),
  ]);

  return {
    products,
    warehouses,
    stockLines,
    transfers,
    auditCounts,
    catalogue: makeCatalogue(products, warehouses),
  };
}

/** Use the snapshot given, or take one. */
const use = async (given) => given ?? (await snapshot());

/** Display name for a SKU, falling back to a clear label. */
const productName = (data, sku) => data.catalogue.findProduct(sku)?.name ?? 'Unknown SKU';

/** Display name for a warehouse, falling back to the raw id. */
const warehouseName = (data, id) => data.catalogue.findWarehouse(id)?.name ?? id;

/**
 * Every stock line, with available stock and health band worked out, and with
 * the product and warehouse names attached for display.
 *
 * @param {object} [data]
 * @returns {Promise<object[]>}
 */
export async function stockReport(data) {
  const snap = await use(data);

  return snap.stockLines.map((line) => ({
    ...describeStockLine(line),
    productName: productName(snap, line.sku),
    warehouseName: warehouseName(snap, line.warehouseId),
  }));
}

/**
 * Every detected issue, with names attached, ordered so the most serious
 * problems are at the top of the list.
 *
 * Nothing is stored here and nothing can be. Issues are recomputed from the
 * source on every page load, so an issue cannot be dismissed, suppressed or
 * marked away: a problem that still exists in the data is still detected, still
 * listed, and still counted on the dashboard. The source is read-only, so there
 * is no alert table to write to and no record of one that could go stale.
 *
 * @param {object} [data]
 * @returns {Promise<object[]>}
 */
export async function issuesReport(data) {
  const snap = await use(data);

  const severity = {
    'Negative Inventory': 0,
    'Out of Stock': 1,
    'Low Stock': 2,
    'Warehouse/SKU Mismatch': 3,
    'Inactive Listing': 4,
    'Slow-Moving Stock': 5,
  };

  return detectIssues(snap.stockLines, snap.catalogue)
    .map((issue) => ({
      ...issue,
      key: `${issue.type}|${issue.sku}|${issue.warehouseId}`,
      productName: productName(snap, issue.sku),
      warehouseName: warehouseName(snap, issue.warehouseId),
    }))
    .sort(
      (a, b) =>
        severity[a.type] - severity[b.type] ||
        a.sku.localeCompare(b.sku) ||
        a.warehouseId.localeCompare(b.warehouseId),
    );
}

/**
 * Every transfer, with product and warehouse names attached.
 *
 * @param {object} [data]
 * @returns {Promise<object[]>}
 */
export async function transfersReport(data) {
  const snap = await use(data);

  return snap.transfers.map((transfer) => ({
    ...transfer,
    productName: productName(snap, transfer.sku),
    fromWarehouseName: warehouseName(snap, transfer.fromWarehouseId),
    toWarehouseName: warehouseName(snap, transfer.toWarehouseId),
  }));
}

/**
 * Every audit count, with the difference worked out.
 *
 *   difference = countedQuantity - systemQuantity
 *
 * A positive difference means more was found on the shelf than the system
 * expected; a negative difference means less. Zero means the count agreed.
 * There is no difference column in the database, so this is the only place the
 * figure exists and it cannot disagree with the two it comes from.
 *
 * @param {object} [data]
 * @returns {Promise<object[]>}
 */
export async function auditReport(data) {
  const snap = await use(data);

  return snap.auditCounts.map((count) => {
    const difference = count.countedQuantity - count.systemQuantity;
    return {
      ...count,
      difference,
      matches: difference === 0,
      productName: productName(snap, count.sku),
      warehouseName: warehouseName(snap, count.warehouseId),
    };
  });
}

/**
 * The six dashboard figures.
 *
 * ---------------------------------------------------------------------------
 * EVERY CARD COUNTS THE SAME THING: CATALOGUE SKUs
 *
 * The three stock figures count SKUs, not stock lines. A SKU's band is worked
 * out from its stock summed across every warehouse - see describeSkuPosition()
 * in rules.js - so exactly one band applies to each SKU and
 *
 *   Healthy + Low + Out of Stock + Negative  ===  Total SKUs
 *
 * always holds. That is the invariant the last assertion on this report exists
 * to protect, and it is the reason the cards are comparable with each other at
 * all: six cards in two different units is not a dashboard, it is a trap.
 *
 * These figures used to count stock lines, which made Healthy Stock read 6,791
 * against a catalogue of 6,510 - a number larger than the thing it was a subset
 * of, because most SKUs carry a row at all ten warehouses.
 *
 * @param {object} [data]
 * @returns {Promise<object>}
 */
export async function dashboardMetrics(data) {
  const snap = await use(data);
  const products = await productsReport(snap);
  const audit = await auditReport(snap);
  const countBand = (band) => products.filter((product) => product.stockStatus === band).length;

  return {
    totalSkus: products.length,
    healthyStock: countBand(STOCK_STATUS.HEALTHY),
    lowStock: countBand(STOCK_STATUS.LOW),
    outOfStock: countBand(STOCK_STATUS.OUT),
    negativeInventory: countBand(STOCK_STATUS.NEGATIVE),
    discrepancies: audit.filter((row) => !row.matches).length,
    pendingTransfers: snap.transfers.filter((transfer) => transfer.status === 'Pending').length,
    totalStockLines: snap.stockLines.length,
  };
}

/**
 * How many issues of each type were found, in the declared display order.
 * Used on the dashboard to point staff at the Alerts screen.
 *
 * @param {object} [data]
 * @returns {Promise<{type: string, count: number}[]>}
 */
export async function issueCounts(data) {
  const snap = await use(data);
  const issues = await issuesReport(snap);

  const order = [
    'Negative Inventory',
    'Out of Stock',
    'Low Stock',
    'Warehouse/SKU Mismatch',
    'Inactive Listing',
    'Slow-Moving Stock',
  ];

  return order.map((type) => ({
    type,
    count: issues.filter((issue) => issue.type === type).length,
  }));
}

/**
 * How many transfers sit at each status, in workflow order.
 *
 * @param {object} [data]
 * @returns {Promise<{status: string, count: number}[]>}
 */
export async function transferCounts(data) {
  const snap = await use(data);

  return TRANSFER_STATUSES.map((status) => ({
    status,
    count: snap.transfers.filter((transfer) => transfer.status === status).length,
  }));
}

/**
 * The product catalogue, with the total units held across every warehouse
 * attached so the Products screen can show whether a listing is holding stock.
 *
 * @param {object} [data]
 * @returns {Promise<object[]>}
 */
export async function productsReport(data) {
  const snap = await use(data);

  // Grouped in one pass over the stock lines rather than one pass per product.
  // The catalogue is six and a half thousand SKUs against sixty-eight thousand
  // lines; filtering the lines inside the map would be four hundred million
  // comparisons for a screen that shows a page of rows.
  const linesBySku = new Map();
  for (const line of snap.stockLines) {
    const existing = linesBySku.get(line.sku);
    if (existing) existing.push(line);
    else linesBySku.set(line.sku, [line]);
  }

  return snap.products.map((product) => {
    // The SKU's position across the whole business, banded by the same rules a
    // single stock line is. This is what the dashboard counts, so the card and
    // the row a member of staff drills through to always agree.
    const position = describeSkuPosition(product.sku, linesBySku.get(product.sku) ?? []);

    return {
      ...product,
      image: productImage(product),
      unitsHeld: position.onHand,
      reserved: position.reserved,
      available: position.available,
      stockStatus: position.status,
      warehouseCount: position.warehouseCount,
    };
  });
}

/**
 * Products referenced by a stock line but missing from the catalogue.
 *
 * Surfaced on the Products screen so staff are not left thinking the catalogue
 * is the whole picture when a stock line points at a SKU that is not in it.
 *
 * @param {object} [data]
 * @returns {Promise<string[]>}
 */
export async function unknownSkus(data) {
  const snap = await use(data);

  const missing = snap.stockLines
    .filter((line) => snap.catalogue.findProduct(line.sku) === null)
    .map((line) => line.sku);

  return [...new Set(missing)].sort();
}
