/**
 * The session store: the one place that changes data.
 *
 * The MVP still has no database. What it now has is a session: the arrays in
 * ./data are the seed, this module edits them in place while the server is
 * running, and a restart puts everything back. Nothing is written to disk and
 * nothing leaves the process.
 *
 * Three rules hold throughout, and they are the reason this module exists at
 * all rather than each route editing the arrays itself:
 *
 * 1. DERIVED FIGURES ARE NEVER STORED. Available stock, the audit difference
 *    and every detected issue stay derived, exactly as before. No write path
 *    accepts them, so no edit can put a stored figure at odds with the rule
 *    that produces it.
 *
 * 2. EVERY WRITE IS VALIDATED FIRST. Each operation returns either
 *    {ok: true, value} or {ok: false, errors} - a plain object keyed by field
 *    name. Nothing is half-applied: validation runs to completion before the
 *    array is touched, so a rejected form leaves the data exactly as it was.
 *
 * 3. RECORDS ARE REPLACED, NOT MUTATED. Every record stays frozen. An edit
 *    swaps in a new frozen object, so a report that is midway through reading
 *    the data cannot see a half-written record.
 *
 * The detection rules in rules.js are not touched by anything here. A stock
 * line edited through this module is re-examined by exactly the same six rules
 * as a seeded one.
 */

import { WAREHOUSES, findWarehouse } from './data/warehouses.js';
import { CATEGORIES, PRODUCTS, SUPPLIERS, findProduct, imagePathFor } from './data/products.js';
import { STOCK_LINES } from './data/stock.js';
import { TRANSFERS, TRANSFER_STATUSES } from './data/transfers.js';
import { AUDIT_COUNTS } from './data/audit.js';

/** The two listing states a product can be in, as shown on screen. */
export const LISTING_STATUSES = Object.freeze(['Active', 'Inactive']);

/**
 * The action states staff can put a detected issue into.
 *
 * These describe what staff have DONE about a problem. They never describe
 * whether the problem exists - that stays the job of the detection rules.
 */
export const ACTION_STATUSES = Object.freeze(['Open', 'In Progress', 'Resolved']);

/**
 * Separator inside an issue key. NUL cannot appear in an issue type, a SKU or a
 * warehouse id, so two different issues cannot collide on one key.
 */
const KEY_SEPARATOR = String.fromCharCode(0);

/** The state a detected issue is in until somebody records otherwise. */
export const DEFAULT_ACTION_STATUS = 'Open';

/** Longest action note accepted, so a form post cannot grow without limit. */
export const MAX_NOTE_LENGTH = 500;

/**
 * Staff notes against detected issues, keyed by issueKey().
 *
 * Kept apart from the stock data on purpose. An issue is not a record - it is
 * a conclusion the rules reach about the stock data every time a page loads.
 * What staff type here annotates that conclusion; it can never suppress it.
 *
 * @type {Map<string, {status: string, note: string, updatedAt: string}>}
 */
const issueActions = new Map();

/** The seed, captured before anything can edit it, so tests can reset. */
const SEED = Object.freeze({
  products: Object.freeze([...PRODUCTS]),
  stock: Object.freeze([...STOCK_LINES]),
  transfers: Object.freeze([...TRANSFERS]),
  audit: Object.freeze([...AUDIT_COUNTS]),
});

/**
 * Put every collection back to the seeded dummy data and forget every recorded
 * action. Used by the tests so one case cannot leak into the next.
 */
export function resetStore() {
  PRODUCTS.splice(0, PRODUCTS.length, ...SEED.products);
  STOCK_LINES.splice(0, STOCK_LINES.length, ...SEED.stock);
  TRANSFERS.splice(0, TRANSFERS.length, ...SEED.transfers);
  AUDIT_COUNTS.splice(0, AUDIT_COUNTS.length, ...SEED.audit);
  issueActions.clear();
}

/* -------------------------------------------------------------------------- */
/* Small shared helpers                                                       */
/* -------------------------------------------------------------------------- */

/** A rejected write. */
const fail = (errors) => ({ ok: false, errors });

/** An accepted write. */
const done = (value) => ({ ok: true, value });

/** Trim a submitted value without caring whether it arrived at all. */
function text(value) {
  return String(value ?? '').trim();
}

/**
 * Read a whole number from a form field.
 *
 * Returns null when the field is not a whole number, so the caller can say
 * which field was wrong rather than silently storing NaN.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function wholeNumber(value) {
  const raw = text(value);
  if (raw === '') return null;
  if (!/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

/** Today, as the ISO date the dummy data uses. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Whether a string is an ISO calendar date the system will accept. */
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Next identifier in a series, one past the highest already in use.
 *
 * @param {readonly {id: string}[]} rows
 * @param {string} prefix
 * @returns {string}
 */
function nextId(rows, prefix) {
  const highest = rows.reduce((top, row) => {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(row.id ?? '');
    return match ? Math.max(top, Number(match[1])) : top;
  }, 1000);
  return `${prefix}${highest + 1}`;
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One stock line, addressed by the pair that identifies it.
 *
 * A SKU is held at a warehouse once. That pair is the key, and addStockLine
 * refuses to create a second line for the same pair, so it stays one.
 *
 * @param {string} sku
 * @param {string} warehouseId
 * @returns {object|null}
 */
export function findStockLine(sku, warehouseId) {
  return STOCK_LINES.find((line) => line.sku === sku && line.warehouseId === warehouseId) ?? null;
}

/**
 * One transfer, by identifier.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function findTransfer(id) {
  return TRANSFERS.find((transfer) => transfer.id === id) ?? null;
}

/**
 * One audit count, by identifier.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function findAuditCount(id) {
  return AUDIT_COUNTS.find((count) => count.id === id) ?? null;
}

/**
 * Everything that points at a SKU, so a delete can say what it would break.
 *
 * @param {string} sku
 * @returns {{stockLines: object[], transfers: object[], auditCounts: object[], total: number}}
 */
export function referencesTo(sku) {
  const stockLines = STOCK_LINES.filter((line) => line.sku === sku);
  const transfers = TRANSFERS.filter((transfer) => transfer.sku === sku);
  const auditCounts = AUDIT_COUNTS.filter((count) => count.sku === sku);

  return {
    stockLines,
    transfers,
    auditCounts,
    total: stockLines.length + transfers.length + auditCounts.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Check the fields a product form submits.
 *
 * @param {object} input
 * @param {string|null} existingSku SKU being edited, so it can keep its own.
 * @returns {object} Errors by field name. Empty when the form is good.
 */
function validateProduct(input, existingSku = null) {
  const errors = {};
  const sku = text(input.sku);
  const name = text(input.name);
  const category = text(input.category);
  const supplier = text(input.supplier);
  const listing = text(input.listing);
  const sold = text(input.unitsSoldLast90Days);

  if (!sku) {
    errors.sku = 'A SKU is required.';
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/.test(sku)) {
    errors.sku = 'Use 2 to 32 letters, digits, dot, dash or underscore.';
  } else if (
    // Case-insensitive, so SIC-1001 and sic-1001 cannot both exist and leave
    // staff unable to tell two rows apart.
    PRODUCTS.some(
      (product) =>
        product.sku.toLowerCase() === sku.toLowerCase() && product.sku !== existingSku,
    )
  ) {
    errors.sku = `SKU ${sku} is already in the catalogue.`;
  }

  if (!name) errors.name = 'A product name is required.';
  else if (name.length > 120) errors.name = 'Keep the name to 120 characters or fewer.';

  if (!category) errors.category = 'A category is required.';
  else if (!CATEGORIES.includes(category)) errors.category = 'Choose one of the listed categories.';

  if (!supplier) errors.supplier = 'A supplier is required.';
  else if (!SUPPLIERS.includes(supplier)) errors.supplier = 'Choose one of the listed suppliers.';

  if (!listing) errors.listing = 'A listing status is required.';
  else if (!LISTING_STATUSES.includes(listing)) {
    errors.listing = `Listing status must be ${LISTING_STATUSES.join(' or ')}.`;
  }

  if (sold !== '') {
    const units = wholeNumber(sold);
    if (units === null || units < 0) {
      errors.unitsSoldLast90Days = 'Units sold must be a whole number of zero or more.';
    }
  }

  return errors;
}

/**
 * Approved warehouses from a form, keeping only real ones.
 *
 * @param {unknown} value One id, or several.
 * @returns {string[]}
 */
function approvedWarehousesFrom(value) {
  const submitted = Array.isArray(value) ? value : [value];
  return WAREHOUSES.map((warehouse) => warehouse.id).filter((id) =>
    submitted.map((entry) => text(entry)).includes(id),
  );
}

/**
 * Add a product to the catalogue.
 *
 * @param {object} input Raw form fields.
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function addProduct(input) {
  const errors = validateProduct(input);
  if (Object.keys(errors).length > 0) return fail(errors);

  const sku = text(input.sku);
  const product = Object.freeze({
    sku,
    name: text(input.name),
    image: imagePathFor(sku),
    category: text(input.category),
    supplier: text(input.supplier),
    active: text(input.listing) === 'Active',
    unitsSoldLast90Days: wholeNumber(input.unitsSoldLast90Days) ?? 0,
    approvedWarehouses: Object.freeze(approvedWarehousesFrom(input.approvedWarehouses)),
  });

  PRODUCTS.push(product);
  return done(product);
}

/**
 * Update a product.
 *
 * The SKU is the key every stock line, transfer and audit count points at, so
 * it is not editable: changing it here would orphan those records, which is
 * exactly what this MVP is supposed to avoid. Staff delete and re-add instead.
 *
 * @param {string} sku
 * @param {object} input
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function updateProduct(sku, input) {
  const index = PRODUCTS.findIndex((product) => product.sku === sku);
  if (index === -1) return fail({ sku: `No product with SKU ${sku}.` });

  const errors = validateProduct({ ...input, sku }, sku);
  if (Object.keys(errors).length > 0) return fail(errors);

  const updated = Object.freeze({
    ...PRODUCTS[index],
    name: text(input.name),
    category: text(input.category),
    supplier: text(input.supplier),
    active: text(input.listing) === 'Active',
    unitsSoldLast90Days:
      wholeNumber(input.unitsSoldLast90Days) ?? PRODUCTS[index].unitsSoldLast90Days,
    approvedWarehouses: Object.freeze(approvedWarehousesFrom(input.approvedWarehouses)),
  });

  PRODUCTS.splice(index, 1, updated);
  return done(updated);
}

/**
 * Delete a product.
 *
 * A product that nothing points at is removed outright. A product that stock
 * lines, transfers or audit counts still reference is refused, because removing
 * it would leave those records pointing at a SKU that no longer exists. Staff
 * can say so explicitly with cascade, which removes the dependants too.
 *
 * @param {string} sku
 * @param {{cascade?: boolean}} [options]
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function deleteProduct(sku, { cascade = false } = {}) {
  const index = PRODUCTS.findIndex((product) => product.sku === sku);
  if (index === -1) return fail({ sku: `No product with SKU ${sku}.` });

  const references = referencesTo(sku);
  if (references.total > 0 && !cascade) {
    return fail({
      cascade:
        `${sku} is still referenced by ${references.stockLines.length} stock line(s), ` +
        `${references.transfers.length} transfer(s) and ${references.auditCounts.length} audit ` +
        'record(s). Confirm that those should be removed too, or remove them first.',
    });
  }

  const removed = PRODUCTS[index];
  PRODUCTS.splice(index, 1);

  let cascaded = { stockLines: 0, transfers: 0, auditCounts: 0 };
  if (references.total > 0) {
    cascaded = {
      stockLines: references.stockLines.length,
      transfers: references.transfers.length,
      auditCounts: references.auditCounts.length,
    };
    removeAll(STOCK_LINES, (line) => line.sku === sku);
    removeAll(TRANSFERS, (transfer) => transfer.sku === sku);
    removeAll(AUDIT_COUNTS, (count) => count.sku === sku);
    // The stock lines are gone, so any issue raised against them is gone too.
    for (const key of [...issueActions.keys()]) {
      if (key.split(KEY_SEPARATOR)[1] === sku) issueActions.delete(key);
    }
  }

  return done({ ...removed, cascaded });
}

/** Remove every entry matching a predicate, in place. */
function removeAll(rows, predicate) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (predicate(rows[i])) rows.splice(i, 1);
  }
}

/* -------------------------------------------------------------------------- */
/* Warehouse stock                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Check the fields a stock form submits.
 *
 * Available is not among them and never will be: it is onHand - reserved,
 * worked out by rules.js, so there is no field here for it to disagree with.
 *
 * Two combinations that look wrong are allowed on purpose, because the
 * detection rules exist to report them:
 *
 *   onHand below zero      reported as Negative Inventory
 *   reserved above onHand  reported as Out of Stock (over-reserved)
 *
 * Rejecting those on the form would make the conditions unreachable and quietly
 * disable two of the six rules.
 *
 * @param {object} input
 * @param {{sku: string, warehouseId: string}|null} existing Line being edited.
 * @returns {object} Errors by field name.
 */
function validateStockLine(input, existing = null) {
  const errors = {};
  const sku = text(input.sku);
  const warehouseId = text(input.warehouseId);

  if (!sku) errors.sku = 'A SKU is required.';
  else if (!findProduct(sku)) errors.sku = `SKU ${sku} is not in the product catalogue.`;

  if (!warehouseId) errors.warehouseId = 'A warehouse is required.';
  else if (!findWarehouse(warehouseId)) {
    errors.warehouseId = `Warehouse ${warehouseId} is not a recognised warehouse.`;
  }

  if (!errors.sku && !errors.warehouseId) {
    const clash = findStockLine(sku, warehouseId);
    const isSelf =
      existing !== null && existing.sku === sku && existing.warehouseId === warehouseId;
    if (clash && !isSelf) {
      errors.sku = `${sku} already has a stock line at ${findWarehouse(warehouseId).name}. Edit that line instead.`;
    }
  }

  const onHand = wholeNumber(input.onHand);
  if (onHand === null) errors.onHand = 'On hand must be a whole number.';

  const reserved = wholeNumber(input.reserved);
  if (reserved === null) errors.reserved = 'Reserved must be a whole number.';
  else if (reserved < 0) errors.reserved = 'Reserved cannot be below zero.';

  const minimum = wholeNumber(input.minimum);
  if (minimum === null) errors.minimum = 'Minimum stock must be a whole number.';
  else if (minimum < 0) errors.minimum = 'Minimum stock cannot be below zero.';

  return errors;
}

/**
 * Add a warehouse stock line.
 *
 * @param {object} input
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function addStockLine(input) {
  const errors = validateStockLine(input);
  if (Object.keys(errors).length > 0) return fail(errors);

  const line = Object.freeze({
    sku: text(input.sku),
    warehouseId: text(input.warehouseId),
    onHand: wholeNumber(input.onHand),
    reserved: wholeNumber(input.reserved),
    minimum: wholeNumber(input.minimum),
  });

  STOCK_LINES.push(line);
  return done(line);
}

/**
 * Update a stock line, including moving it to another SKU or warehouse.
 *
 * @param {string} sku          SKU of the line being edited.
 * @param {string} warehouseId  Warehouse of the line being edited.
 * @param {object} input
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function updateStockLine(sku, warehouseId, input) {
  const index = STOCK_LINES.findIndex(
    (line) => line.sku === sku && line.warehouseId === warehouseId,
  );
  if (index === -1) return fail({ sku: `No stock line for ${sku} at ${warehouseId}.` });

  const errors = validateStockLine(input, { sku, warehouseId });
  if (Object.keys(errors).length > 0) return fail(errors);

  const updated = Object.freeze({
    sku: text(input.sku),
    warehouseId: text(input.warehouseId),
    onHand: wholeNumber(input.onHand),
    reserved: wholeNumber(input.reserved),
    minimum: wholeNumber(input.minimum),
  });

  STOCK_LINES.splice(index, 1, updated);
  return done(updated);
}

/**
 * Delete a stock line.
 *
 * @param {string} sku
 * @param {string} warehouseId
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function deleteStockLine(sku, warehouseId) {
  const index = STOCK_LINES.findIndex(
    (line) => line.sku === sku && line.warehouseId === warehouseId,
  );
  if (index === -1) return fail({ sku: `No stock line for ${sku} at ${warehouseId}.` });

  const [removed] = STOCK_LINES.splice(index, 1);
  // Whatever the rules were saying about this line, they are no longer saying
  // it, so the notes staff left against those issues go with it.
  for (const key of [...issueActions.keys()]) {
    const [, keySku, keyWarehouse] = key.split(KEY_SEPARATOR);
    if (keySku === sku && keyWarehouse === warehouseId) issueActions.delete(key);
  }

  return done(removed);
}

/* -------------------------------------------------------------------------- */
/* Issue actions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The key one detected issue is filed under.
 *
 * An issue has no stored identity - it is recomputed from the stock data on
 * every page load - so its identity has to come from what it is about: the
 * problem, the SKU and the site. Reload the page and the same problem produces
 * the same key, which is how a note written ten minutes ago is still attached.
 *
 * A NUL separator is used because it cannot appear in a SKU, a warehouse id or
 * an issue type, so two different issues cannot collide on one key.
 *
 * @param {{type: string, sku: string, warehouseId: string}} issue
 * @returns {string}
 */
export function issueKey(issue) {
  return [issue.type, issue.sku, issue.warehouseId].join(KEY_SEPARATOR);
}

/**
 * What staff have recorded against an issue, or the default if nothing yet.
 *
 * @param {{type: string, sku: string, warehouseId: string}} issue
 * @returns {{status: string, note: string, updatedAt: string|null}}
 */
export function issueAction(issue) {
  return (
    issueActions.get(issueKey(issue)) ?? {
      status: DEFAULT_ACTION_STATUS,
      note: '',
      updatedAt: null,
    }
  );
}

/**
 * Record what staff did about an issue.
 *
 * This writes nothing to the stock data, which is the whole point. Marking a
 * problem Resolved says the team has dealt with it; it does not say the stock
 * is now correct. If the shortage is still there the next page load detects it
 * again, exactly as before, and the issue is still listed - carrying the note
 * and the status alongside it.
 *
 * The only way to make an issue go away is to fix the stock figures it is
 * derived from.
 *
 * @param {{type: string, sku: string, warehouseId: string}} issue
 * @param {{status?: string, note?: string}} input
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function recordIssueAction(issue, input) {
  const errors = {};
  const status = text(input.status) || DEFAULT_ACTION_STATUS;
  const note = text(input.note);

  if (!ACTION_STATUSES.includes(status)) {
    errors.status = `Action status must be one of ${ACTION_STATUSES.join(', ')}.`;
  }
  if (note.length > MAX_NOTE_LENGTH) {
    errors.note = `Keep the note to ${MAX_NOTE_LENGTH} characters or fewer.`;
  }
  if (Object.keys(errors).length > 0) return fail(errors);

  const action = Object.freeze({
    status,
    note,
    updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  });

  issueActions.set(issueKey(issue), action);
  return done(action);
}

/* -------------------------------------------------------------------------- */
/* Transfers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Check the fields a transfer form submits.
 *
 * @param {object} input
 * @returns {object} Errors by field name.
 */
function validateTransfer(input) {
  const errors = {};
  const sku = text(input.sku);
  const from = text(input.fromWarehouseId);
  const to = text(input.toWarehouseId);
  const status = text(input.status);
  const raisedOn = text(input.raisedOn);

  if (!sku) errors.sku = 'A SKU is required.';
  else if (!findProduct(sku)) errors.sku = `SKU ${sku} is not in the product catalogue.`;

  if (!from) errors.fromWarehouseId = 'A source warehouse is required.';
  else if (!findWarehouse(from)) {
    errors.fromWarehouseId = `Warehouse ${from} is not a recognised warehouse.`;
  }

  if (!to) errors.toWarehouseId = 'A destination warehouse is required.';
  else if (!findWarehouse(to)) {
    errors.toWarehouseId = `Warehouse ${to} is not a recognised warehouse.`;
  }

  if (!errors.fromWarehouseId && !errors.toWarehouseId && from === to) {
    errors.toWarehouseId = 'A transfer must move stock between two different warehouses.';
  }

  const quantity = wholeNumber(input.quantity);
  if (quantity === null) errors.quantity = 'Quantity must be a whole number.';
  else if (quantity <= 0) errors.quantity = 'Quantity must be greater than zero.';

  if (!status) errors.status = 'A status is required.';
  else if (!TRANSFER_STATUSES.includes(status)) {
    errors.status = `Status must be one of ${TRANSFER_STATUSES.join(', ')}.`;
  }

  if (raisedOn && !isIsoDate(raisedOn)) {
    errors.raisedOn = 'Use a real date in the form YYYY-MM-DD.';
  }

  return errors;
}

/**
 * Raise a transfer.
 *
 * As in the seeded data, a transfer is a record only: no stock line is touched
 * here, and raising or receiving one moves nothing.
 *
 * @param {object} input
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function addTransfer(input) {
  const errors = validateTransfer(input);
  if (Object.keys(errors).length > 0) return fail(errors);

  const transfer = Object.freeze({
    id: nextId(TRANSFERS, 'TR-'),
    sku: text(input.sku),
    fromWarehouseId: text(input.fromWarehouseId),
    toWarehouseId: text(input.toWarehouseId),
    quantity: wholeNumber(input.quantity),
    status: text(input.status),
    raisedOn: text(input.raisedOn) || today(),
  });

  TRANSFERS.push(transfer);
  return done(transfer);
}

/**
 * Update a transfer, including its status.
 *
 * @param {string} id
 * @param {object} input
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function updateTransfer(id, input) {
  const index = TRANSFERS.findIndex((transfer) => transfer.id === id);
  if (index === -1) return fail({ id: `No transfer with id ${id}.` });

  const errors = validateTransfer(input);
  if (Object.keys(errors).length > 0) return fail(errors);

  const updated = Object.freeze({
    id: TRANSFERS[index].id,
    sku: text(input.sku),
    fromWarehouseId: text(input.fromWarehouseId),
    toWarehouseId: text(input.toWarehouseId),
    quantity: wholeNumber(input.quantity),
    status: text(input.status),
    raisedOn: text(input.raisedOn) || TRANSFERS[index].raisedOn,
  });

  TRANSFERS.splice(index, 1, updated);
  return done(updated);
}

/**
 * Delete a transfer.
 *
 * @param {string} id
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function deleteTransfer(id) {
  const index = TRANSFERS.findIndex((transfer) => transfer.id === id);
  if (index === -1) return fail({ id: `No transfer with id ${id}.` });

  const [removed] = TRANSFERS.splice(index, 1);
  return done(removed);
}

/* -------------------------------------------------------------------------- */
/* Inventory audit                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Check the fields an audit form submits.
 *
 * There is no difference field. Difference is countedQuantity minus
 * systemQuantity, worked out in reports.js, so a stored difference cannot
 * contradict the two figures it comes from.
 *
 * @param {object} input
 * @returns {object} Errors by field name.
 */
function validateAuditCount(input) {
  const errors = {};
  const sku = text(input.sku);
  const warehouseId = text(input.warehouseId);
  const countedBy = text(input.countedBy);
  const countedOn = text(input.countedOn);

  if (!sku) errors.sku = 'A SKU is required.';
  else if (!findProduct(sku)) errors.sku = `SKU ${sku} is not in the product catalogue.`;

  if (!warehouseId) errors.warehouseId = 'A warehouse is required.';
  else if (!findWarehouse(warehouseId)) {
    errors.warehouseId = `Warehouse ${warehouseId} is not a recognised warehouse.`;
  }

  const systemQuantity = wholeNumber(input.systemQuantity);
  if (systemQuantity === null) {
    errors.systemQuantity = 'System quantity must be a whole number.';
  }

  const countedQuantity = wholeNumber(input.countedQuantity);
  if (countedQuantity === null) {
    errors.countedQuantity = 'Counted quantity must be a whole number.';
  } else if (countedQuantity < 0) {
    // The system figure can be negative - that is a known fault the rules
    // report. A physical count cannot be: nobody counts minus six off a shelf.
    errors.countedQuantity = 'A physical count cannot be below zero.';
  }

  if (!countedBy) errors.countedBy = 'Say who took the count.';
  else if (countedBy.length > 40) errors.countedBy = 'Keep this to 40 characters or fewer.';

  if (countedOn && !isIsoDate(countedOn)) {
    errors.countedOn = 'Use a real date in the form YYYY-MM-DD.';
  }

  return errors;
}

/**
 * Record a physical count.
 *
 * @param {object} input
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function addAuditCount(input) {
  const errors = validateAuditCount(input);
  if (Object.keys(errors).length > 0) return fail(errors);

  const count = Object.freeze({
    id: nextId(AUDIT_COUNTS, 'AC-'),
    sku: text(input.sku),
    warehouseId: text(input.warehouseId),
    systemQuantity: wholeNumber(input.systemQuantity),
    countedQuantity: wholeNumber(input.countedQuantity),
    countedOn: text(input.countedOn) || today(),
    countedBy: text(input.countedBy),
  });

  AUDIT_COUNTS.push(count);
  return done(count);
}

/**
 * Update a count. The difference is re-derived from the new figures wherever it
 * is displayed; nothing recalculates because nothing was stored.
 *
 * @param {string} id
 * @param {object} input
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function updateAuditCount(id, input) {
  const index = AUDIT_COUNTS.findIndex((count) => count.id === id);
  if (index === -1) return fail({ id: `No audit record with id ${id}.` });

  const errors = validateAuditCount(input);
  if (Object.keys(errors).length > 0) return fail(errors);

  const updated = Object.freeze({
    id: AUDIT_COUNTS[index].id,
    sku: text(input.sku),
    warehouseId: text(input.warehouseId),
    systemQuantity: wholeNumber(input.systemQuantity),
    countedQuantity: wholeNumber(input.countedQuantity),
    countedOn: text(input.countedOn) || AUDIT_COUNTS[index].countedOn,
    countedBy: text(input.countedBy),
  });

  AUDIT_COUNTS.splice(index, 1, updated);
  return done(updated);
}

/**
 * Delete an audit count.
 *
 * @param {string} id
 * @returns {{ok: true, value: object}|{ok: false, errors: object}}
 */
export function deleteAuditCount(id) {
  const index = AUDIT_COUNTS.findIndex((count) => count.id === id);
  if (index === -1) return fail({ id: `No audit record with id ${id}.` });

  const [removed] = AUDIT_COUNTS.splice(index, 1);
  return done(removed);
}

/**
 * What the system currently believes is on hand for a SKU at a warehouse, used
 * to prefill a new count rather than making staff look it up.
 *
 * @param {string} sku
 * @param {string} warehouseId
 * @returns {number|null} Null when no stock line exists for that pair.
 */
export function systemQuantityFor(sku, warehouseId) {
  return findStockLine(sku, warehouseId)?.onHand ?? null;
}
