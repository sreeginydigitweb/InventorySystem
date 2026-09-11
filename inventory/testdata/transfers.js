/**
 * Stock transfers between warehouses, for the test dataset.
 *
 * All transfers are invented. Every one of the three statuses appears, so all
 * of them can be seen on screen as soon as the system starts.
 *
 * Transfers are a record only in this MVP: raising or receiving one does not
 * move stock, and the quantities here are deliberately not applied to the
 * warehouse stock lines.
 */

/** The three transfer statuses, in the order work moves through them. */
export const TRANSFER_STATUSES = Object.freeze(['Pending', 'In Transit', 'Received']);

/**
 * @typedef {object} Transfer
 * @property {string} id
 * @property {string} sku
 * @property {string} fromWarehouseId
 * @property {string} toWarehouseId
 * @property {number} quantity
 * @property {string} status    One of TRANSFER_STATUSES.
 * @property {string} raisedOn  ISO date the transfer was raised.
 */

const transfers = [
  {
    id: 'TR-1001',
    sku: 'SIC-1002',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-MAN',
    quantity: 40,
    status: 'Pending',
    raisedOn: '2026-09-08',
  },
  {
    id: 'TR-1002',
    sku: 'SIC-3001',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-LDS',
    quantity: 120,
    status: 'In Transit',
    raisedOn: '2026-09-05',
  },
  {
    id: 'TR-1003',
    sku: 'SIC-2001',
    fromWarehouseId: 'WH-MAN',
    toWarehouseId: 'WH-BRS',
    quantity: 25,
    status: 'Received',
    raisedOn: '2026-09-01',
  },
  {
    id: 'TR-1004',
    sku: 'SIC-3003',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-MAN',
    quantity: 60,
    status: 'Pending',
    raisedOn: '2026-09-09',
  },
  {
    id: 'TR-1005',
    sku: 'SIC-5001',
    fromWarehouseId: 'WH-MAN',
    toWarehouseId: 'WH-BRS',
    quantity: 15,
    status: 'In Transit',
    raisedOn: '2026-09-06',
  },
  {
    id: 'TR-1006',
    sku: 'SIC-1001',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-MAN',
    quantity: 30,
    status: 'Received',
    raisedOn: '2026-08-28',
  },
  {
    id: 'TR-1007',
    sku: 'SIC-3002',
    fromWarehouseId: 'WH-LDS',
    toWarehouseId: 'WH-BIR',
    quantity: 20,
    status: 'Pending',
    raisedOn: '2026-09-09',
  },
  {
    id: 'TR-1008',
    sku: 'SIC-4001',
    fromWarehouseId: 'WH-MAN',
    toWarehouseId: 'WH-BIR',
    quantity: 35,
    status: 'In Transit',
    raisedOn: '2026-09-04',
  },
];

/**
 * The live transfers for the running session. Mutable for the same reason as
 * the stock lines: store.js edits it in place and a restart resets it.
 *
 * @type {Transfer[]}
 */
export const TRANSFERS = transfers.map((transfer) => Object.freeze({ ...transfer }));
