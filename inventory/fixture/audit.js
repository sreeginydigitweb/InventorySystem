/**
 * Inventory audit counts for the dummy dataset.
 *
 * Each record is one physical count of one SKU at one warehouse. All counts are
 * invented.
 *
 *   systemQuantity  what the system believed was on hand when the count was
 *                   taken. Held here rather than looked up, because an audit is
 *                   a record of a moment, not a live figure.
 *   countedQuantity what was actually found on the shelf.
 *
 * The difference is NOT stored - it is derived as countedQuantity minus
 * systemQuantity so the two can never disagree. See rules.js.
 *
 * The dummy counts are seeded so that both outcomes are visible immediately:
 * lines that agree, and lines that do not. The Manchester count of SIC-3003 is
 * the physical explanation for that line being negative in the stock data.
 *
 * Each count carries its own id. The same SKU at the same warehouse can be
 * counted more than once, so (sku, warehouse) cannot address a single record.
 */

/**
 * @typedef {object} AuditCount
 * @property {string} id          Stable identifier for this count.
 * @property {string} sku
 * @property {string} warehouseId
 * @property {number} systemQuantity
 * @property {number} countedQuantity
 * @property {string} countedOn  ISO date the count was taken.
 * @property {string} countedBy  Initials of the member of staff who counted.
 */

const counts = [
  { id: 'AC-1001', sku: 'SIC-1001', warehouseId: 'WH-BIR', systemQuantity: 84, countedQuantity: 84, countedOn: '2026-09-09', countedBy: 'RJ' },
  { id: 'AC-1002', sku: 'SIC-1002', warehouseId: 'WH-BIR', systemQuantity: 18, countedQuantity: 15, countedOn: '2026-09-09', countedBy: 'RJ' },
  { id: 'AC-1003', sku: 'SIC-3001', warehouseId: 'WH-BIR', systemQuantity: 260, countedQuantity: 258, countedOn: '2026-09-09', countedBy: 'RJ' },
  { id: 'AC-1004', sku: 'SIC-3002', warehouseId: 'WH-BIR', systemQuantity: 9, countedQuantity: 9, countedOn: '2026-09-09', countedBy: 'AM' },
  { id: 'AC-1005', sku: 'SIC-3003', warehouseId: 'WH-MAN', systemQuantity: -6, countedQuantity: 0, countedOn: '2026-09-08', countedBy: 'DP' },
  { id: 'AC-1006', sku: 'SIC-4001', warehouseId: 'WH-MAN', systemQuantity: 12, countedQuantity: 12, countedOn: '2026-09-08', countedBy: 'DP' },
  { id: 'AC-1007', sku: 'SIC-2002', warehouseId: 'WH-LDS', systemQuantity: 62, countedQuantity: 66, countedOn: '2026-09-07', countedBy: 'SK' },
  { id: 'AC-1008', sku: 'SIC-4002', warehouseId: 'WH-LDS', systemQuantity: 48, countedQuantity: 48, countedOn: '2026-09-07', countedBy: 'SK' },
  { id: 'AC-1009', sku: 'SIC-1003', warehouseId: 'WH-BRS', systemQuantity: 22, countedQuantity: 19, countedOn: '2026-09-06', countedBy: 'LT' },
  { id: 'AC-1010', sku: 'SIC-3001', warehouseId: 'WH-BRS', systemQuantity: 120, countedQuantity: 120, countedOn: '2026-09-06', countedBy: 'LT' },
];

/**
 * The live audit counts for the running session. Mutable for the same reason
 * as the stock lines: store.js edits it in place and a restart resets it.
 *
 * @type {AuditCount[]}
 */
export const AUDIT_COUNTS = counts.map((count) => Object.freeze({ ...count }));
