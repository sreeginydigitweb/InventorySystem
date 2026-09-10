/**
 * Reporting: the derived views the screens are built from.
 *
 * Like rules.js this owns no HTML. It turns the dummy dataset plus the
 * detection rules into the exact shapes the six screens need, so a screen never
 * has to work anything out for itself.
 *
 * Every figure here is derived on each call. Nothing is cached and nothing is
 * written back to the dataset, so what a screen shows is always what the data
 * says.
 */

import { STOCK_LINES } from './data/stock.js';
import { PRODUCTS, findProduct, productName } from './data/products.js';
import { warehouseName } from './data/warehouses.js';
import { TRANSFERS, TRANSFER_STATUSES } from './data/transfers.js';
import { AUDIT_COUNTS } from './data/audit.js';
import { STOCK_STATUS, describeStockLine, detectIssues } from './rules.js';
import { issueAction, issueKey } from './store.js';

/**
 * Every stock line, with available stock and health band worked out, and with
 * the product and warehouse names attached for display.
 *
 * @returns {object[]}
 */
export function stockReport() {
  return STOCK_LINES.map((line) => ({
    ...describeStockLine(line),
    productName: productName(line.sku),
    warehouseName: warehouseName(line.warehouseId),
  }));
}

/**
 * Every detected issue, with names attached, ordered so the most serious
 * problems are at the top of the list.
 *
 * Each issue also carries whatever staff have recorded against it - an action
 * status and a note. That record is looked up here, alongside the detection,
 * rather than being mixed into it: detectIssues() decides what is wrong with
 * the stock, and the action says what the team did about it. Neither can
 * silence the other, so an issue marked Resolved while the stock is still short
 * is still detected, still listed, and still counted on the dashboard.
 *
 * @returns {object[]}
 */
export function issuesReport() {
  const severity = {
    'Negative Inventory': 0,
    'Out of Stock': 1,
    'Low Stock': 2,
    'Warehouse/SKU Mismatch': 3,
    'Inactive Listing': 4,
    'Slow-Moving Stock': 5,
  };

  return detectIssues(STOCK_LINES)
    .map((issue) => ({
      ...issue,
      key: issueKey(issue),
      action: issueAction(issue),
      productName: productName(issue.sku),
      warehouseName: warehouseName(issue.warehouseId),
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
 * @returns {object[]}
 */
export function transfersReport() {
  return TRANSFERS.map((transfer) => ({
    ...transfer,
    productName: productName(transfer.sku),
    fromWarehouseName: warehouseName(transfer.fromWarehouseId),
    toWarehouseName: warehouseName(transfer.toWarehouseId),
  }));
}

/**
 * Every audit count, with the difference worked out.
 *
 *   difference = countedQuantity - systemQuantity
 *
 * A positive difference means more was found on the shelf than the system
 * expected; a negative difference means less. Zero means the count agreed.
 *
 * @returns {object[]}
 */
export function auditReport() {
  return AUDIT_COUNTS.map((count) => {
    const difference = count.countedQuantity - count.systemQuantity;
    return {
      ...count,
      difference,
      matches: difference === 0,
      productName: productName(count.sku),
      warehouseName: warehouseName(count.warehouseId),
    };
  });
}

/**
 * The six dashboard figures.
 *
 * The three stock figures count stock lines - one SKU at one warehouse - not
 * SKUs, because the same SKU can be healthy at one site and out of stock at
 * another. They are taken from the health band, which allows exactly one band
 * per line, so Healthy + Low + Out + Negative always equals the total number of
 * lines.
 *
 * @returns {object}
 */
export function dashboardMetrics() {
  const lines = stockReport();
  const countBand = (band) => lines.filter((line) => line.status === band).length;

  return {
    totalSkus: PRODUCTS.length,
    healthyStock: countBand(STOCK_STATUS.HEALTHY),
    lowStock: countBand(STOCK_STATUS.LOW),
    outOfStock: countBand(STOCK_STATUS.OUT),
    negativeInventory: countBand(STOCK_STATUS.NEGATIVE),
    discrepancies: auditReport().filter((row) => !row.matches).length,
    pendingTransfers: TRANSFERS.filter((transfer) => transfer.status === 'Pending').length,
    totalStockLines: lines.length,
  };
}

/**
 * How many issues of each type were found, in the declared display order.
 * Used on the dashboard to point staff at the Alerts screen.
 *
 * @returns {{type: string, count: number}[]}
 */
export function issueCounts() {
  const issues = issuesReport();
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
 * @returns {{status: string, count: number}[]}
 */
export function transferCounts() {
  return TRANSFER_STATUSES.map((status) => ({
    status,
    count: TRANSFERS.filter((transfer) => transfer.status === status).length,
  }));
}

/**
 * The product catalogue, with the total units held across every warehouse
 * attached so the Products screen can show whether a listing is holding stock.
 *
 * @returns {object[]}
 */
export function productsReport() {
  return PRODUCTS.map((product) => ({
    ...product,
    unitsHeld: STOCK_LINES.filter((line) => line.sku === product.sku).reduce(
      (total, line) => total + line.onHand,
      0,
    ),
  }));
}

/**
 * Products referenced by a stock line but missing from the catalogue.
 *
 * Surfaced on the Products screen so staff are not left thinking the catalogue
 * is the whole picture when a stock line points at a SKU that is not in it.
 *
 * @returns {string[]}
 */
export function unknownSkus() {
  const missing = STOCK_LINES.filter((line) => findProduct(line.sku) === null).map(
    (line) => line.sku,
  );
  return [...new Set(missing)].sort();
}
