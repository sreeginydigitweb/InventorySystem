/**
 * Warehouse stock lines for the dummy dataset.
 *
 * One line per SKU per warehouse. All quantities are invented.
 *
 * Only three quantities are stored:
 *
 *   onHand    units physically recorded at the site. Allowed to be negative,
 *             because a real system can be driven negative by mis-sequenced
 *             movements - that is exactly the condition the Negative Inventory
 *             rule reports.
 *   reserved  units already committed to orders and not sellable.
 *   minimum   the level this site is expected to hold.
 *
 * Available stock is NOT stored. It is derived as onHand - reserved wherever it
 * is needed, so the two can never drift apart. See rules.js.
 *
 * The set below is deliberately seeded to demonstrate every condition the MVP
 * has to detect: healthy lines, low lines, zero-available lines, an
 * over-reserved line, a negative line, two SKUs held at sites they are not
 * approved for, a SKU that is not in the catalogue at all, and stock recorded
 * against a warehouse that does not exist.
 */

/**
 * @typedef {object} StockLine
 * @property {string} sku
 * @property {string} warehouseId
 * @property {number} onHand
 * @property {number} reserved
 * @property {number} minimum
 */

const lines = [
  // --- Birmingham Central -------------------------------------------------
  { sku: 'SIC-1001', warehouseId: 'WH-BIR', onHand: 84, reserved: 12, minimum: 25 },
  { sku: 'SIC-1002', warehouseId: 'WH-BIR', onHand: 18, reserved: 6, minimum: 20 },
  { sku: 'SIC-1003', warehouseId: 'WH-BIR', onHand: 40, reserved: 5, minimum: 15 },
  { sku: 'SIC-3001', warehouseId: 'WH-BIR', onHand: 260, reserved: 40, minimum: 80 },
  { sku: 'SIC-3002', warehouseId: 'WH-BIR', onHand: 9, reserved: 9, minimum: 12 },
  { sku: 'SIC-3003', warehouseId: 'WH-BIR', onHand: 150, reserved: 20, minimum: 60 },
  { sku: 'SIC-4001', warehouseId: 'WH-BIR', onHand: 0, reserved: 0, minimum: 30 },
  { sku: 'SIC-4003', warehouseId: 'WH-BIR', onHand: 26, reserved: 0, minimum: 10 },
  { sku: 'SIC-5002', warehouseId: 'WH-BIR', onHand: 14, reserved: 2, minimum: 8 },

  // --- Manchester North ---------------------------------------------------
  { sku: 'SIC-1001', warehouseId: 'WH-MAN', onHand: 32, reserved: 4, minimum: 20 },
  { sku: 'SIC-1002', warehouseId: 'WH-MAN', onHand: 7, reserved: 0, minimum: 18 },
  { sku: 'SIC-2001', warehouseId: 'WH-MAN', onHand: 55, reserved: 10, minimum: 20 },
  { sku: 'SIC-3001', warehouseId: 'WH-MAN', onHand: 190, reserved: 25, minimum: 80 },
  // Driven below zero by movements booked out of order.
  { sku: 'SIC-3003', warehouseId: 'WH-MAN', onHand: -6, reserved: 0, minimum: 40 },
  // Over-reserved: stock is on hand but every unit is already committed.
  { sku: 'SIC-4001', warehouseId: 'WH-MAN', onHand: 12, reserved: 18, minimum: 10 },
  { sku: 'SIC-5001', warehouseId: 'WH-MAN', onHand: 21, reserved: 3, minimum: 10 },
  { sku: 'SIC-5002', warehouseId: 'WH-MAN', onHand: 5, reserved: 0, minimum: 6 },

  // --- Leeds Overflow -----------------------------------------------------
  { sku: 'SIC-1002', warehouseId: 'WH-LDS', onHand: 44, reserved: 4, minimum: 15 },
  { sku: 'SIC-2002', warehouseId: 'WH-LDS', onHand: 62, reserved: 2, minimum: 10 },
  { sku: 'SIC-3001', warehouseId: 'WH-LDS', onHand: 95, reserved: 10, minimum: 50 },
  { sku: 'SIC-3002', warehouseId: 'WH-LDS', onHand: 31, reserved: 6, minimum: 12 },
  { sku: 'SIC-4002', warehouseId: 'WH-LDS', onHand: 48, reserved: 0, minimum: 8 },
  { sku: 'SIC-4003', warehouseId: 'WH-LDS', onHand: 9, reserved: 0, minimum: 10 },
  // SIC-1001 is approved for Birmingham and Manchester only.
  { sku: 'SIC-1001', warehouseId: 'WH-LDS', onHand: 12, reserved: 0, minimum: 10 },

  // --- Bristol South West -------------------------------------------------
  { sku: 'SIC-1003', warehouseId: 'WH-BRS', onHand: 22, reserved: 2, minimum: 10 },
  { sku: 'SIC-2001', warehouseId: 'WH-BRS', onHand: 3, reserved: 0, minimum: 12 },
  { sku: 'SIC-2002', warehouseId: 'WH-BRS', onHand: 0, reserved: 0, minimum: 6 },
  { sku: 'SIC-3001', warehouseId: 'WH-BRS', onHand: 120, reserved: 15, minimum: 60 },
  { sku: 'SIC-5001', warehouseId: 'WH-BRS', onHand: 16, reserved: 1, minimum: 8 },
  { sku: 'SIC-5003', warehouseId: 'WH-BRS', onHand: 37, reserved: 0, minimum: 6 },

  // --- Broken references, kept on purpose ---------------------------------
  // A SKU that is not in the product catalogue at all.
  { sku: 'SIC-9999', warehouseId: 'WH-BIR', onHand: 5, reserved: 0, minimum: 5 },
  // A warehouse identifier that does not exist.
  { sku: 'SIC-3002', warehouseId: 'WH-XXX', onHand: 14, reserved: 0, minimum: 5 },
];

/**
 * The live stock lines for the running session.
 *
 * The array is mutable so store.js can add, replace and remove lines in place
 * when staff use the Add/Edit/Delete screens; each line stays frozen so an edit
 * replaces a record rather than mutating one another screen already holds.
 * Nothing is written to disk - a restart returns the list above.
 *
 * @type {StockLine[]}
 */
export const STOCK_LINES = lines.map((line) => Object.freeze({ ...line }));
