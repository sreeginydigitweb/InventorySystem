/**
 * Tests for the inventory detection rules.
 *
 * Two kinds of test appear here on purpose:
 *
 *   - rules tested against small hand-built lines, so the rule itself is pinned
 *     down independently of the dummy dataset;
 *   - rules tested against the real dummy dataset, so the shipped data is
 *     proven to demonstrate every condition the MVP has to show.
 *
 * No database, no network, no server.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ISSUE_TYPES,
  SLOW_MOVING_THRESHOLD,
  STOCK_STATUS,
  availableStock,
  describeStockLine,
  detectIssues,
  isInactiveListing,
  isLowStock,
  isNegativeInventory,
  isOutOfStock,
  isSlowMoving,
  stockStatus,
  warehouseMismatchReason,
} from './rules.js';
import { STOCK_LINES } from './data/stock.js';
import { PRODUCTS } from './data/products.js';

/** A stock line, healthy unless the test overrides something. */
function line(overrides = {}) {
  return { sku: 'SIC-1001', warehouseId: 'WH-BIR', onHand: 50, reserved: 5, minimum: 20, ...overrides };
}

describe('availableStock', () => {
  test('is on hand less reserved', () => {
    assert.equal(availableStock({ onHand: 50, reserved: 5 }), 45);
  });

  test('goes below zero when more is reserved than is held', () => {
    assert.equal(availableStock({ onHand: 12, reserved: 18 }), -6);
  });

  test('is never stored on the line, only derived', () => {
    for (const stored of STOCK_LINES) {
      assert.equal('available' in stored, false, `${stored.sku} stores available`);
    }
  });
});

describe('low stock', () => {
  test('fires when available is below the minimum', () => {
    assert.equal(isLowStock(line({ onHand: 18, reserved: 6, minimum: 20 })), true);
  });

  test('does not fire when available equals the minimum', () => {
    assert.equal(isLowStock(line({ onHand: 20, reserved: 0, minimum: 20 })), false);
  });

  test('does not fire when available is above the minimum', () => {
    assert.equal(isLowStock(line({ onHand: 50, reserved: 5, minimum: 20 })), false);
  });

  test('does not fire when there is nothing available - that is out of stock', () => {
    assert.equal(isLowStock(line({ onHand: 9, reserved: 9, minimum: 12 })), false);
  });

  test('uses available, not on hand: reserved stock does not count as cover', () => {
    // 30 on hand looks healthy against a minimum of 20, but 25 is committed.
    assert.equal(isLowStock(line({ onHand: 30, reserved: 25, minimum: 20 })), true);
  });
});

describe('out of stock', () => {
  test('fires when available is exactly zero', () => {
    assert.equal(isOutOfStock(line({ onHand: 9, reserved: 9 })), true);
  });

  test('fires when nothing is held at all', () => {
    assert.equal(isOutOfStock(line({ onHand: 0, reserved: 0 })), true);
  });

  test('fires when more is reserved than is held', () => {
    assert.equal(isOutOfStock(line({ onHand: 12, reserved: 18 })), true);
  });

  test('does not fire while anything is available', () => {
    assert.equal(isOutOfStock(line({ onHand: 1, reserved: 0 })), false);
  });
});

describe('negative inventory', () => {
  test('fires when on hand is below zero', () => {
    assert.equal(isNegativeInventory(line({ onHand: -6 })), true);
  });

  test('does not fire at zero', () => {
    assert.equal(isNegativeInventory(line({ onHand: 0 })), false);
  });

  test('is about on hand, not available: over-reservation is not negative inventory', () => {
    assert.equal(isNegativeInventory(line({ onHand: 12, reserved: 18 })), false);
  });
});

describe('stockStatus', () => {
  test('reports the most serious band first', () => {
    assert.equal(stockStatus(line({ onHand: -6, reserved: 0, minimum: 40 })), STOCK_STATUS.NEGATIVE);
    assert.equal(stockStatus(line({ onHand: 9, reserved: 9, minimum: 12 })), STOCK_STATUS.OUT);
    assert.equal(stockStatus(line({ onHand: 18, reserved: 6, minimum: 20 })), STOCK_STATUS.LOW);
    assert.equal(stockStatus(line({ onHand: 84, reserved: 12, minimum: 25 })), STOCK_STATUS.HEALTHY);
  });

  test('gives every line in the dummy data exactly one band', () => {
    const bands = Object.values(STOCK_STATUS);
    for (const stored of STOCK_LINES) {
      assert.ok(bands.includes(stockStatus(stored)), `${stored.sku} has no band`);
    }
  });

  test('the four bands account for every stock line, with none counted twice', () => {
    const counted = Object.values(STOCK_STATUS).reduce(
      (total, band) => total + STOCK_LINES.filter((l) => stockStatus(l) === band).length,
      0,
    );
    assert.equal(counted, STOCK_LINES.length);
  });
});

describe('warehouse/SKU mismatch', () => {
  test('passes a SKU held at an approved site', () => {
    assert.equal(warehouseMismatchReason({ sku: 'SIC-1001', warehouseId: 'WH-BIR' }), null);
  });

  test('reports a warehouse that does not exist', () => {
    const reason = warehouseMismatchReason({ sku: 'SIC-3002', warehouseId: 'WH-XXX' });
    assert.match(reason, /not a recognised warehouse/);
  });

  test('reports a SKU that is not in the catalogue', () => {
    const reason = warehouseMismatchReason({ sku: 'SIC-9999', warehouseId: 'WH-BIR' });
    assert.match(reason, /not in the product catalogue/);
  });

  test('reports a real SKU held at a site it is not approved for', () => {
    const reason = warehouseMismatchReason({ sku: 'SIC-1001', warehouseId: 'WH-LDS' });
    assert.match(reason, /not approved to be held at/);
  });

  test('checks the warehouse before the SKU, so an unknown warehouse is named first', () => {
    const reason = warehouseMismatchReason({ sku: 'SIC-9999', warehouseId: 'WH-XXX' });
    assert.match(reason, /not a recognised warehouse/);
  });
});

describe('inactive listing', () => {
  test('fires when a withdrawn listing is still holding stock', () => {
    assert.equal(isInactiveListing({ sku: 'SIC-4003', onHand: 26 }), true);
  });

  test('does not fire when a withdrawn listing holds nothing', () => {
    assert.equal(isInactiveListing({ sku: 'SIC-4003', onHand: 0 }), false);
  });

  test('does not fire for an active listing', () => {
    assert.equal(isInactiveListing({ sku: 'SIC-1001', onHand: 26 }), false);
  });

  test('does not fire for a SKU that is not in the catalogue', () => {
    assert.equal(isInactiveListing({ sku: 'SIC-9999', onHand: 5 }), false);
  });
});

describe('slow-moving stock', () => {
  test('fires for an active product at or under the threshold that still holds stock', () => {
    // SIC-2002 sold 3 in 90 days.
    assert.equal(isSlowMoving({ sku: 'SIC-2002', onHand: 62 }), true);
  });

  test('does not fire for a fast seller', () => {
    // SIC-3001 sold 388 in 90 days.
    assert.equal(isSlowMoving({ sku: 'SIC-3001', onHand: 260 }), false);
  });

  test('does not fire when no stock is held - there is nothing to shift', () => {
    assert.equal(isSlowMoving({ sku: 'SIC-2002', onHand: 0 }), false);
  });

  test('does not fire for a withdrawn listing - that is reported as inactive instead', () => {
    // SIC-4003 sold 1 in 90 days but is inactive.
    assert.equal(isSlowMoving({ sku: 'SIC-4003', onHand: 9 }), false);
  });

  test('the threshold is inclusive', () => {
    const atThreshold = PRODUCTS.find(
      (p) => p.active && p.unitsSoldLast90Days <= SLOW_MOVING_THRESHOLD,
    );
    assert.ok(atThreshold, 'the dummy catalogue has no slow-moving product to test');
    assert.equal(isSlowMoving({ sku: atThreshold.sku, onHand: 1 }), true);
  });
});

describe('describeStockLine', () => {
  test('adds available and status without altering the stored figures', () => {
    const described = describeStockLine(line({ onHand: 18, reserved: 6, minimum: 20 }));
    assert.equal(described.onHand, 18);
    assert.equal(described.reserved, 6);
    assert.equal(described.available, 12);
    assert.equal(described.status, STOCK_STATUS.LOW);
  });
});

describe('detectIssues', () => {
  test('returns nothing for a clean line', () => {
    assert.deepEqual(detectIssues([line()]), []);
  });

  test('names the SKU and the warehouse on every issue', () => {
    for (const issue of detectIssues(STOCK_LINES)) {
      assert.ok(issue.sku, 'issue has no SKU');
      assert.ok(issue.warehouseId, 'issue has no warehouse');
      assert.ok(issue.detail, 'issue has no explanation');
    }
  });

  test('only ever raises one of the six declared types', () => {
    for (const issue of detectIssues(STOCK_LINES)) {
      assert.ok(ISSUE_TYPES.includes(issue.type), `unexpected issue type ${issue.type}`);
    }
  });

  test('the dummy data demonstrates all six issue types', () => {
    const found = new Set(detectIssues(STOCK_LINES).map((issue) => issue.type));
    for (const type of ISSUE_TYPES) {
      assert.ok(found.has(type), `the dummy data raises no ${type}`);
    }
  });

  test('does not report a negative line as out of stock as well', () => {
    const issues = detectIssues([line({ onHand: -6, reserved: 0, minimum: 40 })]);
    const types = issues.map((issue) => issue.type);
    assert.deepEqual(types, ['Negative Inventory']);
  });

  test('reports a single line under more than one heading when both apply', () => {
    // Held at an unapproved site and below its minimum.
    const issues = detectIssues([
      { sku: 'SIC-1001', warehouseId: 'WH-LDS', onHand: 4, reserved: 0, minimum: 10 },
    ]);
    const types = issues.map((issue) => issue.type).sort();
    assert.deepEqual(types, ['Low Stock', 'Warehouse/SKU Mismatch']);
  });

  test('explains an over-reserved line as over-reservation, not an empty shelf', () => {
    const [issue] = detectIssues([line({ onHand: 12, reserved: 18, minimum: 10 })]);
    assert.equal(issue.type, 'Out of Stock');
    assert.match(issue.detail, /Over-reserved/);
  });
});
