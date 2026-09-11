/**
 * Tests for the session store: the add, edit and delete operations.
 *
 * These exercise the write path directly, without a router or a socket, so a
 * validation rule can be read here next to the case that proves it.
 *
 * Every test starts from the seeded dummy data. resetStore() runs before each
 * one, so no case can be made to pass by something an earlier case left behind.
 *
 * Run with: npm test
 */

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { WAREHOUSES } from './fixture/warehouses.js';
import { PRODUCTS } from './fixture/products.js';
import { availableStock, detectIssues, makeCatalogue, stockStatus } from './rules.js';
import { closePool } from './db.js';
import { resetToFixture } from './fixture/load.js';
import {
  ACTION_STATUSES,
  addAuditCount,
  addProduct,
  addStockLine,
  addTransfer,
  deleteAuditCount,
  deleteProduct,
  deleteStockLine,
  deleteTransfer,
  findAuditCount,
  findStockLine,
  findTransfer,
  issueAction,
  recordIssueAction,
  referencesTo,
  allAuditCounts,
  allProducts,
  allStockLines,
  allTransfers,
  allWarehouses,
  findProduct,
  systemQuantityFor,
  updateAuditCount,
  updateProduct,
  updateStockLine,
  updateTransfer,
} from './store.js';

/*
 * Every case starts from the seeded dataset, restored in one statement so the
 * reset costs a single round trip rather than ninety.
 */
beforeEach(resetToFixture);
after(closePool);

/** The catalogue the rules are judged against, read from the database. */
const catalogue = async () => makeCatalogue(await allProducts(), await allWarehouses());

/** A complete, valid product form. */
const productForm = (overrides = {}) => ({
  sku: 'SIC-8001',
  name: 'Test Pendant',
  category: 'Ceiling Lights',
  supplier: 'Northgate Lighting Ltd',
  listing: 'Active',
  unitsSoldLast90Days: '40',
  approvedWarehouses: ['WH-BIR', 'WH-MAN'],
  ...overrides,
});

/** A complete, valid stock form. */
const stockForm = (overrides = {}) => ({
  sku: 'SIC-1001',
  warehouseId: 'WH-BRS',
  onHand: '50',
  reserved: '10',
  minimum: '20',
  ...overrides,
});

/** A complete, valid transfer form. */
const transferForm = (overrides = {}) => ({
  sku: 'SIC-1001',
  fromWarehouseId: 'WH-BIR',
  toWarehouseId: 'WH-MAN',
  quantity: '25',
  status: 'Pending',
  raisedOn: '2026-09-10',
  ...overrides,
});

/** A complete, valid audit form. */
const auditForm = (overrides = {}) => ({
  sku: 'SIC-1001',
  warehouseId: 'WH-BIR',
  systemQuantity: '84',
  countedQuantity: '80',
  countedOn: '2026-09-10',
  countedBy: 'ZZ',
  ...overrides,
});

/* ========================================================================== */

describe('products: add', () => {
  test('a complete form is accepted and the product appears in the catalogue', async () => {
    const before = (await allProducts()).length;
    const result = await addProduct(productForm());

    assert.equal(result.ok, true);
    assert.equal((await allProducts()).length, before + 1);
    assert.equal((await findProduct('SIC-8001')).name, 'Test Pendant');
  });

  test('the thumbnail path is derived from the SKU, not asked for', async () => {
    await addProduct(productForm());
    assert.equal((await findProduct('SIC-8001')).image, '/images/SIC-8001.svg');
  });

  test('the listing status becomes the active flag the rules read', async () => {
    await addProduct(productForm({ sku: 'SIC-8002', listing: 'Inactive' }));
    assert.equal((await findProduct('SIC-8002')).active, false);
  });

  test('a duplicate SKU is refused', async () => {
    const result = await addProduct(productForm({ sku: 'SIC-1001' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.sku, /already in the catalogue/);
  });

  test('a duplicate SKU in different case is refused too', async () => {
    const result = await addProduct(productForm({ sku: 'sic-1001' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.sku, /already in the catalogue/);
  });

  test('SKU, name, category and supplier are all required', async () => {
    const result = await addProduct({ sku: '', name: '', category: '', supplier: '', listing: '' });

    assert.equal(result.ok, false);
    for (const field of ['sku', 'name', 'category', 'supplier', 'listing']) {
      assert.ok(result.errors[field], `${field} was not required`);
    }
  });

  test('an unrecognised listing status is refused', async () => {
    const result = await addProduct(productForm({ listing: 'Archived' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.listing, /Active or Inactive/);
  });

  test('a category or supplier outside the declared lists is refused', async () => {
    assert.equal((await addProduct(productForm({ category: 'Kettles' }))).ok, false);
    assert.equal((await addProduct(productForm({ supplier: 'Someone Else Ltd' }))).ok, false);
  });

  test('a rejected form changes nothing', async () => {
    const before = (await allProducts()).length;
    await addProduct(productForm({ sku: 'SIC-1001' }));
    assert.equal((await allProducts()).length, before);
  });
});

describe('products: view and edit', () => {
  test('the stored product carries every field the view screen shows', async () => {
    await addProduct(productForm());
    const product = await findProduct('SIC-8001');

    for (const field of ['sku', 'name', 'image', 'category', 'supplier', 'approvedWarehouses']) {
      assert.ok(product[field] !== undefined, `${field} is missing`);
    }
    assert.equal(typeof product.active, 'boolean');
  });

  test('an edit changes the fields it is given', async () => {
    const result = await updateProduct('SIC-1001', {
      name: 'Renamed Pendant',
      category: 'Lamps',
      supplier: 'Verity Home Fittings',
      listing: 'Inactive',
      unitsSoldLast90Days: '7',
      approvedWarehouses: ['WH-BIR'],
    });

    assert.equal(result.ok, true);
    const product = await findProduct('SIC-1001');
    assert.equal(product.name, 'Renamed Pendant');
    assert.equal(product.category, 'Lamps');
    assert.equal(product.active, false);
    assert.deepEqual([...product.approvedWarehouses], ['WH-BIR']);
  });

  test('an edit keeps the SKU, because everything else points at it', async () => {
    await updateProduct('SIC-1001', { ...productForm({ sku: 'SIC-9999' }), name: 'Still 1001' });

    assert.equal((await findProduct('SIC-1001')).name, 'Still 1001');
    assert.equal(await findProduct('SIC-9999'), null);
  });

  test('editing a SKU that is not there is refused', async () => {
    assert.equal((await updateProduct('SIC-0000', productForm())).ok, false);
  });

  test('an invalid edit is refused and leaves the product alone', async () => {
    const result = await updateProduct('SIC-1001', productForm({ name: '' }));

    assert.equal(result.ok, false);
    assert.equal((await findProduct('SIC-1001')).name, 'Aurora 3-Light Ceiling Pendant');
  });
});

describe('products: delete', () => {
  test('a product nothing points at is removed', async () => {
    await addProduct(productForm());
    assert.equal((await referencesTo('SIC-8001')).total, 0);

    const result = await deleteProduct('SIC-8001');

    assert.equal(result.ok, true);
    assert.equal(await findProduct('SIC-8001'), null);
  });

  test('a product with related records is refused rather than orphaning them', async () => {
    const references = await referencesTo('SIC-1001');
    assert.ok(references.total > 0, 'the fixture no longer has a referenced product');

    const result = await deleteProduct('SIC-1001');

    assert.equal(result.ok, false);
    assert.match(result.errors.cascade, /still referenced/);
    assert.ok(await findProduct('SIC-1001'), 'the product was removed anyway');
  });

  test('with explicit consent the dependants go too, so nothing is left dangling', async () => {
    const references = await referencesTo('SIC-1001');
    assert.ok(references.stockLines > 0);

    const result = await deleteProduct('SIC-1001', { cascade: true });

    assert.equal(result.ok, true);
    assert.equal(await findProduct('SIC-1001'), null);
    assert.equal((await allStockLines()).filter((line) => line.sku === 'SIC-1001').length, 0);
    assert.equal((await allTransfers()).filter((transfer) => transfer.sku === 'SIC-1001').length, 0);
    assert.equal((await allAuditCounts()).filter((count) => count.sku === 'SIC-1001').length, 0);
  });

  test('deleting a SKU that is not there is refused', async () => {
    assert.equal((await deleteProduct('SIC-0000')).ok, false);
  });
});

/* ========================================================================== */

describe('stock: add', () => {
  test('a complete form is accepted', async () => {
    const before = (await allStockLines()).length;
    const result = await addStockLine(stockForm());

    assert.equal(result.ok, true);
    assert.equal((await allStockLines()).length, before + 1);
    assert.equal((await findStockLine('SIC-1001', 'WH-BRS')).onHand, 50);
  });

  test('available is never stored - only the three figures it comes from', async () => {
    await addStockLine(stockForm());
    const line = await findStockLine('SIC-1001', 'WH-BRS');

    assert.equal(line.available, undefined, 'available was written into the record');
    assert.deepEqual(Object.keys(line).sort(), ['minimum', 'onHand', 'reserved', 'sku', 'warehouseId']);
  });

  test('an available figure submitted on the form is ignored, not stored', async () => {
    await addStockLine(stockForm({ available: '999' }));

    const line = await findStockLine('SIC-1001', 'WH-BRS');
    assert.equal(line.available, undefined);
    assert.equal(availableStock(line), 40, 'available is not on hand minus reserved');
  });

  test('a SKU that is not in the catalogue is refused', async () => {
    const result = await addStockLine(stockForm({ sku: 'SIC-0000' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.sku, /not in the product catalogue/);
  });

  test('a warehouse that does not exist is refused', async () => {
    const result = await addStockLine(stockForm({ warehouseId: 'WH-ZZZ' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.warehouseId, /not a recognised warehouse/);
  });

  test('the three quantities must be whole numbers', async () => {
    assert.equal((await addStockLine(stockForm({ onHand: 'lots' }))).ok, false);
    assert.equal((await addStockLine(stockForm({ reserved: '2.5' }))).ok, false);
    assert.equal((await addStockLine(stockForm({ minimum: '' }))).ok, false);
  });

  test('reserved and minimum cannot be negative', async () => {
    assert.equal((await addStockLine(stockForm({ reserved: '-1' }))).ok, false);
    assert.equal((await addStockLine(stockForm({ minimum: '-1' }))).ok, false);
  });

  test('on hand may be negative, because that is a condition the rules report', async () => {
    const result = await addStockLine(stockForm({ onHand: '-4', reserved: '0' }));

    assert.equal(result.ok, true);
    assert.equal(stockStatus(await findStockLine('SIC-1001', 'WH-BRS')), 'Negative Inventory');
  });

  test('more reserved than on hand is allowed, because that is Out of Stock', async () => {
    const result = await addStockLine(stockForm({ onHand: '5', reserved: '9' }));

    assert.equal(result.ok, true);
    assert.equal(stockStatus(await findStockLine('SIC-1001', 'WH-BRS')), 'Out of Stock');
  });

  test('a second line for the same SKU and warehouse is refused', async () => {
    const result = await addStockLine(stockForm({ sku: 'SIC-1001', warehouseId: 'WH-BIR' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.sku, /already has a stock line/);
  });
});

describe('stock: edit', () => {
  test('the figures change and available follows them', async () => {
    const result = await updateStockLine('SIC-1001', 'WH-BIR', stockForm({ warehouseId: 'WH-BIR', onHand: '30', reserved: '4', minimum: '25' }));

    assert.equal(result.ok, true);
    const line = await findStockLine('SIC-1001', 'WH-BIR');
    assert.equal(availableStock(line), 26);
    assert.equal(stockStatus(line), 'Healthy');
  });

  test('lowering the figures moves the line into a worse band', async () => {
    await updateStockLine('SIC-1001', 'WH-BIR', stockForm({ warehouseId: 'WH-BIR', onHand: '10', reserved: '2', minimum: '25' }));

    const line = await findStockLine('SIC-1001', 'WH-BIR');
    assert.equal(availableStock(line), 8);
    assert.equal(stockStatus(line), 'Low Stock');
  });

  test('a line can be moved to another warehouse', async () => {
    const result = await updateStockLine('SIC-1001', 'WH-BIR', stockForm({ warehouseId: 'WH-BRS' }));

    assert.equal(result.ok, true);
    assert.equal(await findStockLine('SIC-1001', 'WH-BIR'), null);
    assert.ok(await findStockLine('SIC-1001', 'WH-BRS'));
  });

  test('moving a line onto another line that already exists is refused', async () => {
    const result = await updateStockLine('SIC-1001', 'WH-BIR', stockForm({ warehouseId: 'WH-MAN' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.sku, /already has a stock line/);
  });

  test('editing a line that is not there is refused', async () => {
    assert.equal((await updateStockLine('SIC-1001', 'WH-ZZZ', stockForm())).ok, false);
  });
});

describe('stock: delete', () => {
  test('the line is removed', async () => {
    const before = (await allStockLines()).length;
    const result = await deleteStockLine('SIC-1001', 'WH-BIR');

    assert.equal(result.ok, true);
    assert.equal((await allStockLines()).length, before - 1);
    assert.equal(await findStockLine('SIC-1001', 'WH-BIR'), null);
  });

  test('the issues that line was raising go with it', async () => {
    const raisedBefore = detectIssues(await allStockLines(), await catalogue()).filter(
      (issue) => issue.sku === 'SIC-3003' && issue.warehouseId === 'WH-MAN',
    );
    assert.ok(raisedBefore.length > 0, 'the fixture no longer has a problem line');

    await deleteStockLine('SIC-3003', 'WH-MAN');

    const raisedAfter = detectIssues(await allStockLines(), await catalogue()).filter(
      (issue) => issue.sku === 'SIC-3003' && issue.warehouseId === 'WH-MAN',
    );
    assert.equal(raisedAfter.length, 0);
  });

  test('deleting a line that is not there is refused', async () => {
    assert.equal((await deleteStockLine('SIC-1001', 'WH-ZZZ')).ok, false);
  });
});

/* ========================================================================== */

describe('alerts: recording what staff did', () => {
  const shortage = { type: 'Low Stock', sku: 'SIC-1002', warehouseId: 'WH-BIR' };

  test('an issue starts Open with nothing recorded against it', async () => {
    const action = await issueAction(shortage);

    assert.equal(action.status, 'Open');
    assert.equal(action.note, '');
    assert.equal(action.updatedAt, null);
  });

  test('a status and a note can be recorded', async () => {
    const result = await recordIssueAction(shortage, {
      status: 'In Progress',
      note: 'Replenishment raised with Halden.',
    });

    assert.equal(result.ok, true);
    const action = await issueAction(shortage);
    assert.equal(action.status, 'In Progress');
    assert.equal(action.note, 'Replenishment raised with Halden.');
  });

  test('the time it was updated is recorded', async () => {
    await recordIssueAction(shortage, { status: 'Resolved', note: '' });
    assert.match((await issueAction(shortage)).updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test('every declared action status is accepted', async () => {
    for (const status of ACTION_STATUSES) {
      assert.equal((await recordIssueAction(shortage, { status })).ok, true, `${status} was refused`);
    }
  });

  test('an unrecognised action status is refused', async () => {
    const result = await recordIssueAction(shortage, { status: 'Ignored' });

    assert.equal(result.ok, false);
    assert.match(result.errors.status, /Open, In Progress, Resolved/);
  });

  test('an over-long note is refused rather than truncated', async () => {
    const result = await recordIssueAction(shortage, { status: 'Open', note: 'x'.repeat(501) });

    assert.equal(result.ok, false);
    assert.ok(result.errors.note);
  });

  test('an action is filed against one issue, not the whole SKU', async () => {
    await recordIssueAction(shortage, { status: 'Resolved', note: 'Dealt with' });

    // Same SKU, different site: untouched.
    assert.equal((await issueAction({ ...shortage, warehouseId: 'WH-MAN' })).status, 'Open');
    // Same line, different problem: untouched.
    assert.equal((await issueAction({ ...shortage, type: 'Slow-Moving Stock' })).status, 'Open');
  });

  test('MARKING RESOLVED DOES NOT STOP THE RULE DETECTING THE PROBLEM', async () => {
    const before = detectIssues(await allStockLines(), await catalogue()).filter(
      (issue) => issue.type === 'Low Stock' && issue.sku === 'SIC-1002' && issue.warehouseId === 'WH-BIR',
    );
    assert.equal(before.length, 1, 'the fixture no longer has this shortage');

    await recordIssueAction(shortage, { status: 'Resolved', note: 'Says it is sorted' });

    const after = detectIssues(await allStockLines(), await catalogue()).filter(
      (issue) => issue.type === 'Low Stock' && issue.sku === 'SIC-1002' && issue.warehouseId === 'WH-BIR',
    );
    assert.equal(after.length, 1, 'a resolved label silenced a real shortage');
    assert.equal((await issueAction(shortage)).status, 'Resolved');
  });

  test('correcting the stock is what actually clears the issue', async () => {
    await recordIssueAction(shortage, { status: 'Resolved' });

    const line = await findStockLine('SIC-1002', 'WH-BIR');
    await updateStockLine('SIC-1002', 'WH-BIR', {
      sku: line.sku,
      warehouseId: line.warehouseId,
      onHand: '200',
      reserved: '6',
      minimum: '20',
    });

    const after = detectIssues(await allStockLines(), await catalogue()).filter(
      (issue) => issue.type === 'Low Stock' && issue.sku === 'SIC-1002' && issue.warehouseId === 'WH-BIR',
    );
    assert.equal(after.length, 0);
  });
});

/* ========================================================================== */

describe('transfers: add, edit and delete', () => {
  test('a complete form is accepted and given an identifier', async () => {
    const before = (await allTransfers()).length;
    const result = await addTransfer(transferForm());

    assert.equal(result.ok, true);
    assert.match(result.value.id, /^TR-\d+$/);
    assert.equal((await allTransfers()).length, before + 1);
    assert.ok(await findTransfer(result.value.id));
  });

  test('the identifier does not collide with one already in use', async () => {
    const first = (await addTransfer(transferForm())).value.id;
    const second = (await addTransfer(transferForm())).value.id;

    assert.notEqual(first, second);
    assert.equal((await allTransfers()).filter((transfer) => transfer.id === first).length, 1);
  });

  test('a SKU that is not in the catalogue is refused', async () => {
    const result = await addTransfer(transferForm({ sku: 'SIC-0000' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.sku, /not in the product catalogue/);
  });

  test('a warehouse that does not exist is refused, at either end', async () => {
    assert.match(
      (await addTransfer(transferForm({ fromWarehouseId: 'WH-ZZZ' }))).errors.fromWarehouseId,
      /not a recognised warehouse/,
    );
    assert.match(
      (await addTransfer(transferForm({ toWarehouseId: 'WH-ZZZ' }))).errors.toWarehouseId,
      /not a recognised warehouse/,
    );
  });

  test('a transfer to the same warehouse it came from is refused', async () => {
    const result = await addTransfer(transferForm({ toWarehouseId: 'WH-BIR' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.toWarehouseId, /two different warehouses/);
  });

  test('the quantity must be above zero', async () => {
    assert.match((await addTransfer(transferForm({ quantity: '0' }))).errors.quantity, /greater than zero/);
    assert.match((await addTransfer(transferForm({ quantity: '-5' }))).errors.quantity, /greater than zero/);
    assert.ok((await addTransfer(transferForm({ quantity: 'many' }))).errors.quantity);
  });

  test('the status must be one of the three', async () => {
    const result = await addTransfer(transferForm({ status: 'Cancelled' }));

    assert.equal(result.ok, false);
    assert.match(result.errors.status, /Pending, In Transit, Received/);
  });

  test('a nonsense date is refused', async () => {
    assert.ok((await addTransfer(transferForm({ raisedOn: '2026-02-31' }))).errors.raisedOn);
    assert.ok((await addTransfer(transferForm({ raisedOn: 'yesterday' }))).errors.raisedOn);
  });

  test('the status can be moved along', async () => {
    const result = await updateTransfer('TR-1001', transferForm({ status: 'Received' }));

    assert.equal(result.ok, true);
    assert.equal((await findTransfer('TR-1001')).status, 'Received');
    assert.equal((await findTransfer('TR-1001')).id, 'TR-1001', 'the identifier changed');
  });

  test('an invalid edit is refused and leaves the transfer alone', async () => {
    const result = await updateTransfer('TR-1001', transferForm({ status: 'Cancelled' }));

    assert.equal(result.ok, false);
    assert.equal((await findTransfer('TR-1001')).status, 'Pending');
  });

  test('a transfer can be deleted', async () => {
    const before = (await allTransfers()).length;
    const result = await deleteTransfer('TR-1001');

    assert.equal(result.ok, true);
    assert.equal((await allTransfers()).length, before - 1);
    assert.equal(await findTransfer('TR-1001'), null);
  });

  test('editing or deleting a transfer that is not there is refused', async () => {
    assert.equal((await updateTransfer('TR-0000', transferForm())).ok, false);
    assert.equal((await deleteTransfer('TR-0000')).ok, false);
  });

  test('no stock figure moves when a transfer is raised, edited or deleted', async () => {
    const before = (await allStockLines()).map((line) => `${line.sku}@${line.warehouseId}=${line.onHand}`).join();

    const added = (await addTransfer(transferForm({ quantity: '999' }))).value;
    await updateTransfer(added.id, transferForm({ quantity: '5', status: 'Received' }));
    await deleteTransfer(added.id);

    const after = (await allStockLines()).map((line) => `${line.sku}@${line.warehouseId}=${line.onHand}`).join();
    assert.equal(after, before, 'a transfer changed the stock figures');
  });
});

/* ========================================================================== */

describe('audit: add, edit and delete', () => {
  test('a complete form is accepted and given an identifier', async () => {
    const before = (await allAuditCounts()).length;
    const result = await addAuditCount(auditForm());

    assert.equal(result.ok, true);
    assert.match(result.value.id, /^AC-\d+$/);
    assert.equal((await allAuditCounts()).length, before + 1);
  });

  test('the difference is never stored - only the two figures it comes from', async () => {
    const { value } = await addAuditCount(auditForm());
    const stored = await findAuditCount(value.id);

    assert.equal(stored.difference, undefined, 'a difference was written into the record');
    assert.equal(stored.countedQuantity - stored.systemQuantity, -4);
  });

  test('a difference submitted on the form is ignored, not stored', async () => {
    const { value } = await addAuditCount(auditForm({ difference: '999' }));
    const stored = await findAuditCount(value.id);

    assert.equal(stored.difference, undefined);
    assert.equal(stored.countedQuantity - stored.systemQuantity, -4);
  });

  test('a SKU or warehouse that does not exist is refused', async () => {
    assert.ok((await addAuditCount(auditForm({ sku: 'SIC-0000' }))).errors.sku);
    assert.ok((await addAuditCount(auditForm({ warehouseId: 'WH-ZZZ' }))).errors.warehouseId);
  });

  test('both quantities must be whole numbers', async () => {
    assert.ok((await addAuditCount(auditForm({ systemQuantity: '' }))).errors.systemQuantity);
    assert.ok((await addAuditCount(auditForm({ countedQuantity: 'eighty' }))).errors.countedQuantity);
  });

  test('a physical count cannot be negative, though the system figure can', async () => {
    assert.match((await addAuditCount(auditForm({ countedQuantity: '-1' }))).errors.countedQuantity, /below zero/);
    assert.equal((await addAuditCount(auditForm({ systemQuantity: '-6', countedQuantity: '0' }))).ok, true);
  });

  test('whoever took the count is required', async () => {
    assert.ok((await addAuditCount(auditForm({ countedBy: '' }))).errors.countedBy);
  });

  test('editing the counted quantity changes what the difference works out to', async () => {
    const count = await findAuditCount('AC-1002');
    assert.equal(count.countedQuantity - count.systemQuantity, -3);

    const result = await updateAuditCount('AC-1002', {
      sku: count.sku,
      warehouseId: count.warehouseId,
      systemQuantity: String(count.systemQuantity),
      countedQuantity: '18',
      countedOn: count.countedOn,
      countedBy: count.countedBy,
    });

    assert.equal(result.ok, true);
    const updated = await findAuditCount('AC-1002');
    assert.equal(updated.countedQuantity - updated.systemQuantity, 0);
  });

  test('an audit record can be deleted', async () => {
    const before = (await allAuditCounts()).length;
    const result = await deleteAuditCount('AC-1001');

    assert.equal(result.ok, true);
    assert.equal((await allAuditCounts()).length, before - 1);
    assert.equal(await findAuditCount('AC-1001'), null);
  });

  test('editing or deleting a record that is not there is refused', async () => {
    assert.equal((await updateAuditCount('AC-0000', auditForm())).ok, false);
    assert.equal((await deleteAuditCount('AC-0000')).ok, false);
  });

  test('the system figure can be prefilled from the stock data', async () => {
    assert.equal(await systemQuantityFor('SIC-1001', 'WH-BIR'), 84);
    assert.equal(await systemQuantityFor('SIC-1001', 'WH-ZZZ'), null);
  });
});
