/**
 * Tests for the dummy dataset itself.
 *
 * These do two jobs. They check the data is internally consistent - no stock
 * line pointing at a warehouse that was renamed, no transfer for a SKU that was
 * deleted - and they check the seeded conditions are actually present, so the
 * claim that the system demonstrates every MVP feature at startup is enforced
 * rather than assumed.
 *
 * Run with: npm test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { WAREHOUSES, findWarehouse, warehouseName } from './fixture/warehouses.js';
import { CATEGORIES, PRODUCTS, SUPPLIERS, findProduct, productName } from './fixture/products.js';
import { STOCK_LINES } from './fixture/stock.js';
import { TRANSFERS, TRANSFER_STATUSES } from './fixture/transfers.js';
import { AUDIT_COUNTS } from './fixture/audit.js';
import { isInactiveListing, isSlowMoving, makeCatalogue, stockStatus, STOCK_STATUS } from './rules.js';
import { findStockLine, updateStockLine } from './store.js';
import { closePool } from './db.js';
import { resetToFixture } from './fixture/load.js';

const warehouseIds = WAREHOUSES.map((warehouse) => warehouse.id);

/** The seed catalogue the rules are judged against in this file. */
const catalogue = makeCatalogue(PRODUCTS, WAREHOUSES);
const skus = PRODUCTS.map((product) => product.sku);

describe('warehouses', () => {
  test('there is more than one, so transfers between sites are meaningful', () => {
    assert.ok(WAREHOUSES.length > 1);
  });

  test('every warehouse has an id, a name and a location', () => {
    for (const warehouse of WAREHOUSES) {
      assert.ok(warehouse.id, 'missing id');
      assert.ok(warehouse.name, `${warehouse.id} has no name`);
      assert.ok(warehouse.location, `${warehouse.id} has no location`);
    }
  });

  test('identifiers are unique', () => {
    assert.equal(new Set(warehouseIds).size, warehouseIds.length);
  });

  test('an unknown id resolves to null and displays as itself', () => {
    assert.equal(findWarehouse('WH-XXX'), null);
    assert.equal(warehouseName('WH-XXX'), 'WH-XXX');
  });
});

describe('products', () => {
  test('every product carries the fields the Products screen shows', () => {
    for (const product of PRODUCTS) {
      assert.ok(product.sku, 'missing SKU');
      assert.ok(product.name, `${product.sku} has no name`);
      assert.ok(product.image, `${product.sku} has no image`);
      assert.ok(product.category, `${product.sku} has no category`);
      assert.ok(product.supplier, `${product.sku} has no supplier`);
      assert.equal(typeof product.active, 'boolean', `${product.sku} has no active flag`);
      assert.equal(typeof product.unitsSoldLast90Days, 'number', `${product.sku} has no movement`);
    }
  });

  test('SKUs are unique', () => {
    assert.equal(new Set(skus).size, skus.length);
  });

  test('the image path is derived from the SKU', () => {
    for (const product of PRODUCTS) {
      assert.equal(product.image, `/images/${product.sku}.svg`);
    }
  });

  test('every category and supplier used is one of the declared ones', () => {
    for (const product of PRODUCTS) {
      assert.ok(CATEGORIES.includes(product.category), `${product.sku}: ${product.category}`);
      assert.ok(SUPPLIERS.includes(product.supplier), `${product.sku}: ${product.supplier}`);
    }
  });

  test('approved warehouses all exist and are never empty', () => {
    for (const product of PRODUCTS) {
      assert.ok(product.approvedWarehouses.length > 0, `${product.sku} is approved nowhere`);
      for (const id of product.approvedWarehouses) {
        assert.ok(warehouseIds.includes(id), `${product.sku} is approved for unknown site ${id}`);
      }
    }
  });

  test('an unknown SKU resolves to null and displays as a clear label', () => {
    assert.equal(findProduct('SIC-0000'), null);
    assert.equal(productName('SIC-0000'), 'Unknown SKU');
  });

  test('the catalogue contains both active and withdrawn listings', () => {
    assert.ok(PRODUCTS.some((product) => product.active));
    assert.ok(PRODUCTS.some((product) => !product.active));
  });
});

describe('stock lines', () => {
  test('every line has all three stored quantities', () => {
    for (const line of STOCK_LINES) {
      assert.equal(typeof line.onHand, 'number', `${line.sku} has no on-hand figure`);
      assert.equal(typeof line.reserved, 'number', `${line.sku} has no reserved figure`);
      assert.equal(typeof line.minimum, 'number', `${line.sku} has no minimum`);
    }
  });

  test('reserved and minimum are never negative - only on hand may go below zero', () => {
    for (const line of STOCK_LINES) {
      assert.ok(line.reserved >= 0, `${line.sku} at ${line.warehouseId} has negative reserved`);
      assert.ok(line.minimum >= 0, `${line.sku} at ${line.warehouseId} has a negative minimum`);
    }
  });

  test('a SKU appears at most once per warehouse', () => {
    const keys = STOCK_LINES.map((line) => `${line.sku}@${line.warehouseId}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('the dummy data demonstrates every required condition', () => {
  const bandPresent = (band) => STOCK_LINES.some((line) => stockStatus(line) === band);

  test('healthy stock', () => {
    assert.ok(bandPresent(STOCK_STATUS.HEALTHY));
  });

  test('low stock', () => {
    assert.ok(bandPresent(STOCK_STATUS.LOW));
  });

  test('out of stock', () => {
    assert.ok(bandPresent(STOCK_STATUS.OUT));
  });

  test('negative inventory', () => {
    assert.ok(bandPresent(STOCK_STATUS.NEGATIVE));
  });

  test('a warehouse that does not exist', () => {
    assert.ok(STOCK_LINES.some((line) => !warehouseIds.includes(line.warehouseId)));
  });

  test('a SKU that is not in the catalogue', () => {
    assert.ok(STOCK_LINES.some((line) => !skus.includes(line.sku)));
  });

  test('a real SKU held at a site it is not approved for', () => {
    assert.ok(
      STOCK_LINES.some((line) => {
        const product = findProduct(line.sku);
        return (
          product !== null &&
          warehouseIds.includes(line.warehouseId) &&
          !product.approvedWarehouses.includes(line.warehouseId)
        );
      }),
    );
  });

  test('an inactive listing still holding stock', () => {
    assert.ok(STOCK_LINES.some((line) => isInactiveListing(line, catalogue)));
  });

  test('slow-moving stock', () => {
    assert.ok(STOCK_LINES.some((line) => isSlowMoving(line, catalogue)));
  });

  test('an over-reserved line, so available can be seen going below zero', () => {
    assert.ok(STOCK_LINES.some((line) => line.onHand > 0 && line.onHand - line.reserved < 0));
  });

  test('a pending transfer, an in-transit transfer and a received transfer', () => {
    for (const status of TRANSFER_STATUSES) {
      assert.ok(
        TRANSFERS.some((transfer) => transfer.status === status),
        `no transfer is ${status}`,
      );
    }
  });

  test('an audit line that agrees and one that disagrees', () => {
    assert.ok(AUDIT_COUNTS.some((count) => count.countedQuantity === count.systemQuantity));
    assert.ok(AUDIT_COUNTS.some((count) => count.countedQuantity !== count.systemQuantity));
  });
});

describe('transfers', () => {
  test('every transfer carries the fields the Transfers screen shows', () => {
    for (const transfer of TRANSFERS) {
      assert.ok(transfer.id, 'missing transfer id');
      assert.ok(transfer.sku, `${transfer.id} has no SKU`);
      assert.ok(transfer.fromWarehouseId, `${transfer.id} has no source`);
      assert.ok(transfer.toWarehouseId, `${transfer.id} has no destination`);
      assert.ok(transfer.quantity > 0, `${transfer.id} moves nothing`);
      assert.ok(transfer.status, `${transfer.id} has no status`);
    }
  });

  test('transfer ids are unique', () => {
    const ids = TRANSFERS.map((transfer) => transfer.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every transfer references a real SKU and two real warehouses', () => {
    for (const transfer of TRANSFERS) {
      assert.ok(skus.includes(transfer.sku), `${transfer.id} moves unknown SKU ${transfer.sku}`);
      assert.ok(warehouseIds.includes(transfer.fromWarehouseId), `${transfer.id} source`);
      assert.ok(warehouseIds.includes(transfer.toWarehouseId), `${transfer.id} destination`);
    }
  });
});

describe('audit counts', () => {
  test('every count carries the fields the Audit screen shows', () => {
    for (const count of AUDIT_COUNTS) {
      assert.ok(count.sku, 'missing SKU');
      assert.ok(count.warehouseId, `${count.sku} has no warehouse`);
      assert.equal(typeof count.systemQuantity, 'number', `${count.sku} has no system figure`);
      assert.equal(typeof count.countedQuantity, 'number', `${count.sku} has no counted figure`);
      assert.ok(count.countedOn, `${count.sku} has no count date`);
    }
  });

  test('a SKU is counted at most once per warehouse', () => {
    const keys = AUDIT_COUNTS.map((count) => `${count.sku}@${count.warehouseId}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('every count references a real SKU and a real warehouse', () => {
    for (const count of AUDIT_COUNTS) {
      assert.ok(skus.includes(count.sku), `audit references unknown SKU ${count.sku}`);
      assert.ok(warehouseIds.includes(count.warehouseId), `audit references ${count.warehouseId}`);
    }
  });

  test('a physical count is never negative - a shelf cannot hold less than nothing', () => {
    for (const count of AUDIT_COUNTS) {
      assert.ok(count.countedQuantity >= 0, `${count.sku} counted ${count.countedQuantity}`);
    }
  });
});

describe('the seed records are immutable, and the database is the live copy', () => {
  before(resetToFixture);
  after(closePool);

  /*
   * ./data is now the SEED, not the live data: it is loaded into
   * inventory_control once and the database is what the screens read after
   * that. These records stay frozen so the seed cannot be edited by accident,
   * and the second case shows the separation directly - writing through the
   * store changes the database and leaves the seed exactly as it was.
   */
  test('a seed record cannot be altered in place', () => {
    assert.throws(() => {
      PRODUCTS[0].name = 'changed';
    });
    assert.throws(() => {
      STOCK_LINES[0].onHand = 999;
    });
    assert.throws(() => {
      TRANSFERS[0].status = 'Received';
    });
    assert.throws(() => {
      AUDIT_COUNTS[0].countedQuantity = 999;
    });
  });

  test('a write goes to the database and leaves the seed untouched', async () => {
    const seeded = STOCK_LINES.find(
      (line) => line.sku === 'SIC-1001' && line.warehouseId === 'WH-BIR',
    );
    const before = seeded.onHand;

    const result = await updateStockLine('SIC-1001', 'WH-BIR', {
      sku: 'SIC-1001',
      warehouseId: 'WH-BIR',
      onHand: before + 5,
      reserved: seeded.reserved,
      minimum: seeded.minimum,
    });

    assert.equal(result.ok, true);
    assert.equal((await findStockLine('SIC-1001', 'WH-BIR')).onHand, before + 5);
    assert.equal(seeded.onHand, before, 'the seed changed when the database was written');

    await resetToFixture();
    assert.equal((await findStockLine('SIC-1001', 'WH-BIR')).onHand, before);
  });
});

