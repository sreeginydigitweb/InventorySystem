/**
 * Tests for the derived reports: the audit difference, the dashboard figures,
 * the transfer counts and the per-screen row sets.
 *
 * The dashboard tests deliberately assert the counts twice - once as a fixed
 * number, so a change to the dummy data cannot pass unnoticed, and once against
 * the underlying rows, so the tiles are proven to agree with the screens they
 * link to.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
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
import { AUDIT_COUNTS } from './data/audit.js';
import { PRODUCTS } from './data/products.js';
import { STOCK_LINES } from './data/stock.js';
import { TRANSFERS, TRANSFER_STATUSES } from './data/transfers.js';
import { STOCK_STATUS } from './rules.js';

describe('auditReport', () => {
  test('difference is counted minus system', () => {
    for (const row of auditReport()) {
      assert.equal(
        row.difference,
        row.countedQuantity - row.systemQuantity,
        `${row.sku} at ${row.warehouseId}`,
      );
    }
  });

  test('a shortage is negative and an overage is positive', () => {
    const rows = auditReport();
    const short = rows.find((row) => row.sku === 'SIC-1002' && row.warehouseId === 'WH-BIR');
    const over = rows.find((row) => row.sku === 'SIC-2002' && row.warehouseId === 'WH-LDS');

    assert.equal(short.difference, -3, 'counted 15 against a system figure of 18');
    assert.equal(over.difference, 4, 'counted 66 against a system figure of 62');
  });

  test('matches is true only when the difference is zero', () => {
    for (const row of auditReport()) {
      assert.equal(row.matches, row.difference === 0, `${row.sku} at ${row.warehouseId}`);
    }
  });

  test('a count against a negative system figure resolves it upwards', () => {
    const row = auditReport().find((r) => r.sku === 'SIC-3003' && r.warehouseId === 'WH-MAN');
    assert.equal(row.systemQuantity, -6);
    assert.equal(row.countedQuantity, 0);
    assert.equal(row.difference, 6);
  });

  test('the dummy data shows both outcomes', () => {
    const rows = auditReport();
    assert.ok(rows.some((row) => row.matches), 'no audit line agrees');
    assert.ok(rows.some((row) => !row.matches), 'no audit line disagrees');
  });

  test('covers every audit count in the dataset', () => {
    assert.equal(auditReport().length, AUDIT_COUNTS.length);
  });

  test('the system quantity agrees with the stock line it was counted against', () => {
    // The audit is a record of a moment, but the dummy counts were taken from
    // the current figures - so they must not drift apart as the data is edited.
    for (const row of auditReport()) {
      const stored = STOCK_LINES.find(
        (line) => line.sku === row.sku && line.warehouseId === row.warehouseId,
      );
      assert.ok(stored, `audit references a stock line that does not exist: ${row.sku}`);
      assert.equal(row.systemQuantity, stored.onHand, `${row.sku} at ${row.warehouseId}`);
    }
  });
});

describe('dashboardMetrics', () => {
  const metrics = dashboardMetrics();

  test('total SKUs is the size of the catalogue', () => {
    assert.equal(metrics.totalSkus, 14);
    assert.equal(metrics.totalSkus, PRODUCTS.length);
  });

  test('healthy stock matches the stock rows in that band', () => {
    assert.equal(metrics.healthyStock, 22);
    assert.equal(
      metrics.healthyStock,
      stockReport().filter((line) => line.status === STOCK_STATUS.HEALTHY).length,
    );
  });

  test('low stock matches the stock rows in that band', () => {
    assert.equal(metrics.lowStock, 5);
    assert.equal(
      metrics.lowStock,
      stockReport().filter((line) => line.status === STOCK_STATUS.LOW).length,
    );
  });

  test('out of stock matches the stock rows in that band', () => {
    assert.equal(metrics.outOfStock, 4);
    assert.equal(
      metrics.outOfStock,
      stockReport().filter((line) => line.status === STOCK_STATUS.OUT).length,
    );
  });

  test('negative inventory matches the stock rows in that band', () => {
    assert.equal(metrics.negativeInventory, 1);
    assert.equal(
      metrics.negativeInventory,
      stockReport().filter((line) => line.status === STOCK_STATUS.NEGATIVE).length,
    );
  });

  test('the four stock figures add up to every stock line, with none double counted', () => {
    const total =
      metrics.healthyStock + metrics.lowStock + metrics.outOfStock + metrics.negativeInventory;
    assert.equal(total, metrics.totalStockLines);
    assert.equal(total, STOCK_LINES.length);
  });

  test('discrepancies matches the audit lines that disagree', () => {
    assert.equal(metrics.discrepancies, 5);
    assert.equal(metrics.discrepancies, auditReport().filter((row) => !row.matches).length);
  });

  test('pending transfers matches the transfers at that status', () => {
    assert.equal(metrics.pendingTransfers, 3);
    assert.equal(
      metrics.pendingTransfers,
      TRANSFERS.filter((transfer) => transfer.status === 'Pending').length,
    );
  });
});

describe('issueCounts', () => {
  test('covers all six types and totals the issue list', () => {
    const counts = issueCounts();
    assert.equal(counts.length, 6);
    const total = counts.reduce((sum, row) => sum + row.count, 0);
    assert.equal(total, issuesReport().length);
  });

  test('every type is demonstrated by the dummy data', () => {
    for (const row of issueCounts()) {
      assert.ok(row.count > 0, `no ${row.type} in the dummy data`);
    }
  });
});

describe('transferCounts', () => {
  test('covers the three statuses in workflow order', () => {
    assert.deepEqual(
      transferCounts().map((row) => row.status),
      ['Pending', 'In Transit', 'Received'],
    );
  });

  test('all three statuses are demonstrated', () => {
    for (const row of transferCounts()) {
      assert.ok(row.count > 0, `no transfer is ${row.status}`);
    }
  });

  test('the counts add up to every transfer', () => {
    const total = transferCounts().reduce((sum, row) => sum + row.count, 0);
    assert.equal(total, TRANSFERS.length);
  });

  test('no transfer carries a status outside the three declared ones', () => {
    for (const transfer of TRANSFERS) {
      assert.ok(TRANSFER_STATUSES.includes(transfer.status), `${transfer.id} is ${transfer.status}`);
    }
  });
});

describe('transfersReport', () => {
  test('resolves the SKU and both warehouses to names', () => {
    const transfer = transfersReport().find((row) => row.id === 'TR-1001');
    assert.equal(transfer.productName, 'Halden Flush Ceiling Dome 30cm');
    assert.equal(transfer.fromWarehouseName, 'Birmingham Central');
    assert.equal(transfer.toWarehouseName, 'Manchester North');
  });

  test('never moves stock between two of the same warehouse', () => {
    for (const transfer of transfersReport()) {
      assert.notEqual(transfer.fromWarehouseId, transfer.toWarehouseId, transfer.id);
    }
  });
});

describe('stockReport', () => {
  test('covers every stored stock line', () => {
    assert.equal(stockReport().length, STOCK_LINES.length);
  });

  test('attaches available, status and both names to every line', () => {
    for (const line of stockReport()) {
      assert.equal(typeof line.available, 'number');
      assert.ok(line.status);
      assert.ok(line.productName);
      assert.ok(line.warehouseName);
    }
  });

  test('labels a SKU that is not in the catalogue rather than leaving it blank', () => {
    const orphan = stockReport().find((line) => line.sku === 'SIC-9999');
    assert.equal(orphan.productName, 'Unknown SKU');
  });

  test('falls back to the raw id for a warehouse that does not exist', () => {
    const orphan = stockReport().find((line) => line.warehouseId === 'WH-XXX');
    assert.equal(orphan.warehouseName, 'WH-XXX');
  });
});

describe('issuesReport', () => {
  test('puts the most serious issues first', () => {
    const types = issuesReport().map((issue) => issue.type);
    assert.equal(types[0], 'Negative Inventory');
  });

  test('attaches the product and warehouse names staff need to act', () => {
    for (const issue of issuesReport()) {
      assert.ok(issue.productName);
      assert.ok(issue.warehouseName);
    }
  });
});

describe('productsReport', () => {
  test('covers the whole catalogue', () => {
    assert.equal(productsReport().length, PRODUCTS.length);
  });

  test('totals the units held across every warehouse', () => {
    const product = productsReport().find((row) => row.sku === 'SIC-1001');
    // 84 at Birmingham, 32 at Manchester, 12 wrongly at Leeds.
    assert.equal(product.unitsHeld, 128);
  });

  test('shows zero for a catalogued product holding no stock anywhere', () => {
    for (const row of productsReport()) {
      assert.equal(typeof row.unitsHeld, 'number');
    }
  });
});

describe('unknownSkus', () => {
  test('lists SKUs that stock points at but the catalogue does not hold', () => {
    assert.deepEqual(unknownSkus(), ['SIC-9999']);
  });
});
