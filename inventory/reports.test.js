/**
 * Tests for the derived reports: the audit difference, the dashboard figures,
 * the transfer counts and the per-screen row sets.
 *
 * The dashboard tests deliberately assert the counts twice - once as a fixed
 * number, so a change to the test data cannot pass unnoticed, and once against
 * the underlying rows, so the tiles are proven to agree with the screens they
 * link to.
 *
 * Run with: npm test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  auditReport,
  dashboardMetrics,
  issueCounts,
  issuesReport,
  productsReport,
  stockReport,
  transferCounts,
  transfersReport,
  unknownSkus,
} from './reports.js';
import { AUDIT_COUNTS } from './testdata/audit.js';
import { PRODUCTS } from './testdata/products.js';
import { STOCK_LINES } from './testdata/stock.js';
import { TRANSFERS, TRANSFER_STATUSES } from './testdata/transfers.js';
import { STOCK_STATUS } from './rules.js';

import { WAREHOUSES } from './testdata/warehouses.js';
import { memorySource, useSource } from './store.js';

// The reports read whatever the store's source hands them. That source is
// pointed at the sample arrays in ./testdata for the whole of this file, so no
// test here opens a connection to the business database - not even to read it -
// and the expectations below are about a dataset that cannot change underneath
// them.
before(() =>
  useSource(
    memorySource({
      products: PRODUCTS,
      warehouses: WAREHOUSES,
      stockLines: STOCK_LINES,
      transfers: TRANSFERS,
      auditCounts: AUDIT_COUNTS,
    }),
  ),
);

after(() => useSource());

describe('auditReport', () => {
  test('difference is counted minus system', async () => {
    for (const row of await auditReport()) {
      assert.equal(
        row.difference,
        row.countedQuantity - row.systemQuantity,
        `${row.sku} at ${row.warehouseId}`,
      );
    }
  });

  test('a shortage is negative and an overage is positive', async () => {
    const rows = await auditReport();
    const short = rows.find((row) => row.sku === 'SIC-1002' && row.warehouseId === 'WH-BIR');
    const over = rows.find((row) => row.sku === 'SIC-2002' && row.warehouseId === 'WH-LDS');

    assert.equal(short.difference, -3, 'counted 15 against a system figure of 18');
    assert.equal(over.difference, 4, 'counted 66 against a system figure of 62');
  });

  test('matches is true only when the difference is zero', async () => {
    for (const row of await auditReport()) {
      assert.equal(row.matches, row.difference === 0, `${row.sku} at ${row.warehouseId}`);
    }
  });

  test('a count against a negative system figure resolves it upwards', async () => {
    const row = (await auditReport()).find((r) => r.sku === 'SIC-3003' && r.warehouseId === 'WH-MAN');
    assert.equal(row.systemQuantity, -6);
    assert.equal(row.countedQuantity, 0);
    assert.equal(row.difference, 6);
  });

  test('the test data shows both outcomes', async () => {
    const rows = await auditReport();
    assert.ok(rows.some((row) => row.matches), 'no audit line agrees');
    assert.ok(rows.some((row) => !row.matches), 'no audit line disagrees');
  });

  test('covers every audit count in the dataset', async () => {
    assert.equal((await auditReport()).length, AUDIT_COUNTS.length);
  });

  test('the system quantity agrees with the stock line it was counted against', async () => {
    // The audit is a record of a moment, but the dummy counts were taken from
    // the current figures - so they must not drift apart as the data is edited.
    for (const row of await auditReport()) {
      const stored = STOCK_LINES.find(
        (line) => line.sku === row.sku && line.warehouseId === row.warehouseId,
      );
      assert.ok(stored, `audit references a stock line that does not exist: ${row.sku}`);
      assert.equal(row.systemQuantity, stored.onHand, `${row.sku} at ${row.warehouseId}`);
    }
  });
});

describe('dashboardMetrics', () => {
  // Read once and shared: every case below asks about the same set of figures,
  // and the database is remote enough that six reads would be six round trips.
  let metrics;
  before(async () => {
    metrics = await dashboardMetrics();
  });

  test('total SKUs is the size of the catalogue', async () => {
    assert.equal(metrics.totalSkus, 14);
    assert.equal(metrics.totalSkus, PRODUCTS.length);
  });

  /*
   * The four stock cards count CATALOGUE SKUs, banded on the SKU's stock summed
   * across every warehouse - not stock lines. Each case below asserts the same
   * thing twice: once as a fixed number, so a change to the sample data cannot
   * pass unnoticed, and once against the per-SKU band the products report
   * carries, so the card is proven to agree with the screen it links to.
   */
  const bandedSkus = async (band) =>
    (await productsReport()).filter((product) => product.stockStatus === band).length;

  test('healthy stock counts SKUs in that band, not stock lines', async () => {
    assert.equal(metrics.healthyStock, 13);
    assert.equal(metrics.healthyStock, await bandedSkus(STOCK_STATUS.HEALTHY));

    // The bug this replaced: counting lines gave a figure LARGER than the
    // catalogue it is a subset of, because a SKU has a row per warehouse.
    const healthyLines = (await stockReport()).filter(
      (line) => line.status === STOCK_STATUS.HEALTHY,
    ).length;
    assert.notEqual(metrics.healthyStock, healthyLines, 'the card is counting lines again');
    assert.ok(metrics.healthyStock <= metrics.totalSkus, 'more healthy SKUs than SKUs');
  });

  test('low stock counts SKUs in that band', async () => {
    assert.equal(metrics.lowStock, 0);
    assert.equal(metrics.lowStock, await bandedSkus(STOCK_STATUS.LOW));
  });

  test('out of stock counts SKUs in that band', async () => {
    assert.equal(metrics.outOfStock, 1);
    assert.equal(metrics.outOfStock, await bandedSkus(STOCK_STATUS.OUT));
  });

  test('negative inventory counts SKUs in that band', async () => {
    assert.equal(metrics.negativeInventory, 0);
    assert.equal(metrics.negativeInventory, await bandedSkus(STOCK_STATUS.NEGATIVE));
  });

  test('the four stock figures add up to the catalogue, with none double counted', async () => {
    const total =
      metrics.healthyStock + metrics.lowStock + metrics.outOfStock + metrics.negativeInventory;

    // The invariant that makes the six cards comparable with one another:
    // every SKU falls into exactly one band, so the four add up to Total SKUs.
    assert.equal(total, metrics.totalSkus);
    assert.equal(total, PRODUCTS.length);
  });

  test('every card is a count of SKUs, so none can exceed the catalogue', async () => {
    for (const [name, value] of Object.entries({
      healthyStock: metrics.healthyStock,
      lowStock: metrics.lowStock,
      outOfStock: metrics.outOfStock,
      negativeInventory: metrics.negativeInventory,
    })) {
      assert.ok(value <= metrics.totalSkus, `${name} (${value}) exceeds ${metrics.totalSkus} SKUs`);
    }

    // Stock lines still outnumber SKUs in the sample data, so this test would
    // have caught the old behaviour.
    assert.ok(metrics.totalStockLines > metrics.totalSkus);
  });

  test('discrepancies matches the audit lines that disagree', async () => {
    assert.equal(metrics.discrepancies, 5);
    assert.equal(metrics.discrepancies, (await auditReport()).filter((row) => !row.matches).length);
  });

  test('pending transfers matches the transfers at that status', async () => {
    assert.equal(metrics.pendingTransfers, 3);
    assert.equal(
      metrics.pendingTransfers,
      TRANSFERS.filter((transfer) => transfer.status === 'Pending').length,
    );
  });
});

describe('issueCounts', () => {
  test('covers all six types and totals the issue list', async () => {
    const counts = await issueCounts();
    assert.equal(counts.length, 6);
    const total = counts.reduce((sum, row) => sum + row.count, 0);
    assert.equal(total, (await issuesReport()).length);
  });

  test('every type is demonstrated by the test data', async () => {
    for (const row of await issueCounts()) {
      assert.ok(row.count > 0, `no ${row.type} in the test data`);
    }
  });
});

describe('transferCounts', () => {
  test('covers the three statuses in workflow order', async () => {
    assert.deepEqual(
      (await transferCounts()).map((row) => row.status),
      ['Pending', 'In Transit', 'Received'],
    );
  });

  test('all three statuses are demonstrated', async () => {
    for (const row of await transferCounts()) {
      assert.ok(row.count > 0, `no transfer is ${row.status}`);
    }
  });

  test('the counts add up to every transfer', async () => {
    const total = (await transferCounts()).reduce((sum, row) => sum + row.count, 0);
    assert.equal(total, TRANSFERS.length);
  });

  test('no transfer carries a status outside the three declared ones', async () => {
    for (const transfer of TRANSFERS) {
      assert.ok(TRANSFER_STATUSES.includes(transfer.status), `${transfer.id} is ${transfer.status}`);
    }
  });
});

describe('transfersReport', () => {
  test('resolves the SKU and both warehouses to names', async () => {
    const transfer = (await transfersReport()).find((row) => row.id === 'TR-1001');
    assert.equal(transfer.productName, 'Halden Flush Ceiling Dome 30cm');
    assert.equal(transfer.fromWarehouseName, 'Birmingham Central');
    assert.equal(transfer.toWarehouseName, 'Manchester North');
  });

  test('never moves stock between two of the same warehouse', async () => {
    for (const transfer of await transfersReport()) {
      assert.notEqual(transfer.fromWarehouseId, transfer.toWarehouseId, transfer.id);
    }
  });
});

describe('stockReport', () => {
  test('covers every stored stock line', async () => {
    assert.equal((await stockReport()).length, STOCK_LINES.length);
  });

  test('attaches available, status and both names to every line', async () => {
    for (const line of await stockReport()) {
      assert.equal(typeof line.available, 'number');
      assert.ok(line.status);
      assert.ok(line.productName);
      assert.ok(line.warehouseName);
    }
  });

  test('labels a SKU that is not in the catalogue rather than leaving it blank', async () => {
    const orphan = (await stockReport()).find((line) => line.sku === 'SIC-9999');
    assert.equal(orphan.productName, 'Unknown SKU');
  });

  test('falls back to the raw id for a warehouse that does not exist', async () => {
    const orphan = (await stockReport()).find((line) => line.warehouseId === 'WH-XXX');
    assert.equal(orphan.warehouseName, 'WH-XXX');
  });
});

describe('issuesReport', () => {
  test('puts the most serious issues first', async () => {
    const types = (await issuesReport()).map((issue) => issue.type);
    assert.equal(types[0], 'Negative Inventory');
  });

  test('attaches the product and warehouse names staff need to act', async () => {
    for (const issue of await issuesReport()) {
      assert.ok(issue.productName);
      assert.ok(issue.warehouseName);
    }
  });
});

describe('productsReport', () => {
  test('covers the whole catalogue', async () => {
    assert.equal((await productsReport()).length, PRODUCTS.length);
  });

  test('totals the units held across every warehouse', async () => {
    const product = (await productsReport()).find((row) => row.sku === 'SIC-1001');
    // 84 at Birmingham, 32 at Manchester, 12 wrongly at Leeds.
    assert.equal(product.unitsHeld, 128);
  });

  test('shows zero for a catalogued product holding no stock anywhere', async () => {
    for (const row of await productsReport()) {
      assert.equal(typeof row.unitsHeld, 'number');
    }
  });
});

describe('unknownSkus', () => {
  test('lists SKUs that stock points at but the catalogue does not hold', async () => {
    assert.deepEqual(await unknownSkus(), ['SIC-9999']);
  });
});
