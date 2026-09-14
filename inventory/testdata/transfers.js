/**
 * Warehouse-to-warehouse transfers, for the test dataset.
 *
 * All of it is invented, like everything else in this folder. What is NOT
 * invented is the SHAPE: these rows are exactly what source.js produces after
 * reading inventory.product_history, so a test that exercises the Transfers
 * screen against them is exercising it against the real structure.
 *
 * Two things follow from where the real data comes from, and both are
 * represented here:
 *
 *   There is no transfer reference in the source, so `id` is DERIVED from the
 *   event - date, who recorded it, the reason and the two warehouses. Rows
 *   sharing an id are the SKUs that moved together in one edit. TR-GROUP01
 *   below carries three of them, because 303 of the 776 real transfers move
 *   more than one SKU and a single-SKU fixture would never exercise that.
 *
 *   There is no Pending or In Transit. Every record is a movement already
 *   applied to both warehouses. `Received` means the two legs agree;
 *   `Received (Adjusted)` means the shelf was recounted in the same edit, so
 *   quantityOut and quantityIn differ and `quantity` is the lower of the two.
 *
 * The RAW_HISTORY_LINES export underneath is the other half: real-shaped log
 * text, including the lines that must NOT become transfers, for testing the
 * extraction itself.
 */

/**
 * @typedef {object} Transfer
 * @property {string} id          Derived reference, shared by one event's lines.
 * @property {string} sku
 * @property {string} fromWarehouseId  The warehouse whose stock went down.
 * @property {string} toWarehouseId    The warehouse whose stock went up.
 * @property {number} quantity         min(quantityOut, quantityIn).
 * @property {number} quantityOut      Units that left the source.
 * @property {number} quantityIn       Units that arrived at the destination.
 * @property {string} status           Received | Received (Adjusted).
 * @property {string} raisedOn         ISO date the change was applied.
 * @property {string} recordedBy       Who applied it.
 * @property {string} note             Why, in their own words.
 */

const transfers = [
  // One event, three SKUs. Everything but the SKU is identical across them,
  // which is what makes them one transfer.
  {
    id: 'TR-GROUP01',
    sku: 'SIC-1001',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-MAN',
    quantity: 40,
    quantityOut: 40,
    quantityIn: 40,
    status: 'Received',
    raisedOn: '2026-09-08',
    recordedBy: 'mithusha',
    note: 'stock take up group-taken to Manchester',
  },
  {
    id: 'TR-GROUP01',
    sku: 'SIC-1002',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-MAN',
    quantity: 60,
    quantityOut: 60,
    quantityIn: 60,
    status: 'Received',
    raisedOn: '2026-09-08',
    recordedBy: 'mithusha',
    note: 'stock take up group-taken to Manchester',
  },
  {
    id: 'TR-GROUP01',
    sku: 'SIC-2001',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-MAN',
    quantity: 25,
    quantityOut: 30,
    quantityIn: 25,
    status: 'Received (Adjusted)',
    raisedOn: '2026-09-08',
    recordedBy: 'mithusha',
    note: 'stock take up group-taken to Manchester',
  },
  {
    id: 'TR-SINGLE1',
    sku: 'SIC-3001',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-LDS',
    quantity: 120,
    quantityOut: 120,
    quantityIn: 120,
    status: 'Received',
    raisedOn: '2026-09-05',
    recordedBy: 'manoranjini',
    note: 'l/z in Birmingham-taken to Leeds',
  },
  {
    id: 'TR-SINGLE2',
    sku: 'SIC-3002',
    fromWarehouseId: 'WH-MAN',
    toWarehouseId: 'WH-BRS',
    quantity: 15,
    quantityOut: 22,
    quantityIn: 15,
    status: 'Received (Adjusted)',
    raisedOn: '2026-09-04',
    recordedBy: 'Slakshika',
    note: 'low stock counting-Bristol',
  },
  {
    id: 'TR-SINGLE3',
    sku: 'SIC-4001',
    fromWarehouseId: 'WH-MAN',
    toWarehouseId: 'WH-BIR',
    quantity: 35,
    quantityOut: 35,
    quantityIn: 35,
    status: 'Received',
    raisedOn: '2026-09-01',
    recordedBy: 'Nishani',
    note: 'refill check-back to Birmingham',
  },
  {
    id: 'TR-SINGLE4',
    sku: 'SIC-5001',
    fromWarehouseId: 'WH-LDS',
    toWarehouseId: 'WH-BIR',
    quantity: 20,
    quantityOut: 20,
    quantityIn: 20,
    status: 'Received',
    raisedOn: '2026-08-28',
    recordedBy: 'manoranjini',
    note: 'returned from Leeds',
  },
];

/**
 * The transfers for the running test session, newest first - the same order
 * source.js hands them back in.
 *
 * @type {Transfer[]}
 */
export const TRANSFERS = transfers
  .map((transfer) => Object.freeze({ ...transfer }))
  .sort(
    (a, b) =>
      b.raisedOn.localeCompare(a.raisedOn) ||
      a.id.localeCompare(b.id) ||
      a.sku.localeCompare(b.sku),
  );

/**
 * Log lines in the real format, for testing the extraction directly.
 *
 * The text here is shaped exactly like inventory.product_history.history,
 * including the awkward parts:
 *
 *   the bracket after UnitN is the LEGACY column, not the warehouse -
 *   "Unit4(unit3)" is Unit 4, and reading the bracket would file the movement
 *   against the wrong site
 *
 *   a three-leg line carries a third warehouse having a negative zeroed out,
 *   which is not part of the move
 *
 * `transfer: false` marks the lines that must NOT come out as transfers.
 */
export const RAW_HISTORY_LINES = Object.freeze([
  {
    what: 'balanced two-leg move, destination leg written first',
    transfer: true,
    line:
      'UK stock changes: Unit3(Quantity) from 121 to 226,Unit18(unit1) from 105 to 0 ' +
      '(all taken unit 18 in transfer informed nanthini akka) by mithusha on 2026-01-29 via inventory CSV.',
  },
  {
    what: 'the bracket says unit3 but the warehouse is Unit4',
    transfer: true,
    line:
      'UK stock changes: Unit3(Quantity) from 1360 to 1410,Unit4(unit3) from 1150 to 1100 ' +
      '(50 pcs in taken unit 3-thulasi akka) by mithusha on 2026-08-17 via inventory CSV.',
  },
  {
    what: 'legs disagree - moved and recounted in one edit',
    transfer: true,
    line:
      'UK stock changes: Unit3(Quantity) from 100 to 200,Unit4(unit3) from 1013 to 858 ' +
      '(l/z in unit 4-taken to unit 3 -thulasi akka) by mithusha on 2026-08-25 via inventory CSV.',
  },
  {
    what: 'three legs - the third is a negative being zeroed, not part of the move',
    transfer: true,
    line:
      'UK stock changes: Unit3(Quantity) from -9 to 71,Unit18(unit1) from 153 to 70,Unit4(unit3) from -2 to 0 ' +
      '(l/z in unit 18-taken in unit 3 -2 box -jey) by mithusha on 2026-08-03 via inventory CSV.',
  },
  {
    what: 'one leg only - a correction at a single site',
    transfer: false,
    line:
      'UK stock changes: Unit3(Quantity) from 7 to 13 ' +
      '(Low stock counting nanthu informed) by manoranjini on 2026-05-14 via inventory CSV.',
  },
  {
    what: 'two legs moving the same way - two recounts, not a move',
    transfer: false,
    line:
      'UK stock changes: Unit3(Quantity) from 10 to 40,Unit18(unit1) from 50 to 90 ' +
      '(Low stock counting-nanthini akka) by mithusha on 2026-01-16 via inventory CSV.',
  },
  {
    what: 'no opening figure - the delta cannot be worked out',
    transfer: false,
    line:
      'UK stock changes: Unit5(unit5) from  to 50 ' +
      '(To Keep Listing) by traineeebay on 2026-08-19 via inventory CSV.',
  },
  {
    what: 'Mark is a flag, not a warehouse',
    transfer: false,
    line: 'UK stock changes: Mark(unit2) from 0 to 1 (Mark 1) by mithusha on 2026-02-27 via inventory CSV.',
  },
  {
    what: 'not a stock-change line at all',
    transfer: false,
    line: 'Product was editted by mithusha On 2026-08-25 09:32:53',
  },
]);
