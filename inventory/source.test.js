/**
 * Tests for reading transfers out of the source's stock-change log.
 *
 * The extraction is the part of source.js that decides what a line of
 * inventory.product_history.history means, and it is pure - line text and a
 * warehouse list in, movements out - so all of it is exercised here without
 * opening a connection to the business database.
 *
 * The line text in ./testdata/transfers.js is shaped exactly like the real
 * log, including the lines that must NOT come out as transfers.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRANSFER_RECEIVED,
  TRANSFER_RECEIVED_ADJUSTED,
  extractTransfers,
  parseTransferLine,
  transferReference,
  unitWarehouseMap,
} from './source.js';
import { RAW_HISTORY_LINES } from './testdata/transfers.js';

/**
 * The UK sites the log's "UnitN" tokens refer to, shaped like the rows
 * inventory.warehouse actually returns - including the sites that carry no
 * unit number and the non-UK ones the log never mentions.
 */
const UK_WAREHOUSES = Object.freeze([
  Object.freeze({ id: '1', name: 'UK Unit3', location: 'UK' }),
  Object.freeze({ id: '6', name: 'UK Unit18', location: 'UK' }),
  Object.freeze({ id: '8', name: 'UK Unit4', location: 'UK' }),
  Object.freeze({ id: '10', name: 'Trossingen kronen str', location: 'Germany' }),
  Object.freeze({ id: '32', name: 'US1', location: 'US' }),
]);

const units = unitWarehouseMap(UK_WAREHOUSES);

/** Parse one of the sample lines by its description. */
function parse(what) {
  const sample = RAW_HISTORY_LINES.find((row) => row.what === what);
  assert.ok(sample, `no sample line called ${what}`);
  return parseTransferLine(sample.line, units);
}

describe('unitWarehouseMap', () => {
  test('maps each UnitN token to the warehouse carrying that number', () => {
    assert.equal(units.get('Unit3'), '1');
    assert.equal(units.get('Unit18'), '6');
    assert.equal(units.get('Unit4'), '8');
  });

  test('Unit18 is its own site, not Unit1 with a digit stuck on', () => {
    assert.notEqual(units.get('Unit18'), units.get('Unit1'));
    assert.equal(units.get('Unit1'), undefined, 'there is no UK Unit1 to map to');
  });

  test('leaves out sites with no unit number and sites outside the UK', () => {
    assert.equal(units.size, 3);
    for (const id of units.values()) {
      assert.ok(['1', '6', '8'].includes(id), `${id} is not a UK unit`);
    }
  });
});

describe('parseTransferLine: what is a transfer', () => {
  test('a balanced two-leg move reads as Received', () => {
    const move = parse('balanced two-leg move, destination leg written first');

    assert.equal(move.quantity, 105);
    assert.equal(move.quantityOut, 105);
    assert.equal(move.quantityIn, 105);
    assert.equal(move.status, TRANSFER_RECEIVED);
  });

  test('the falling leg is From and the rising leg is To, whichever is written first', () => {
    // Unit3 went 121 -> 226 and is written FIRST, but it is the destination.
    // Reading the legs in order would have the stock moving backwards.
    const move = parse('balanced two-leg move, destination leg written first');

    assert.equal(move.fromWarehouseId, '6', 'Warehouse From is not the site that lost stock');
    assert.equal(move.toWarehouseId, '1', 'Warehouse To is not the site that gained stock');
  });

  test('legs that disagree read as Received (Adjusted), at the lower quantity', () => {
    // Moved and recounted in the same edit: 155 left Unit4, 100 arrived at
    // Unit3. Only 100 can honestly be called moved.
    const move = parse('legs disagree - moved and recounted in one edit');

    assert.equal(move.quantityOut, 155);
    assert.equal(move.quantityIn, 100);
    assert.equal(move.quantity, 100, 'the movement is overstated');
    assert.equal(move.status, TRANSFER_RECEIVED_ADJUSTED);
  });

  test('a third leg zeroing out a negative is not part of the move', () => {
    // Unit18 -83, Unit3 +80, Unit4 +2. The move is Unit18 -> Unit3; the two
    // units on Unit4 are a negative being cleared.
    const move = parse('three legs - the third is a negative being zeroed, not part of the move');

    assert.equal(move.fromWarehouseId, '6');
    assert.equal(move.toWarehouseId, '1');
    assert.equal(move.quantityOut, 83);
    assert.equal(move.quantityIn, 80);
    assert.equal(move.quantity, 80);
  });

  test('reads the date, who applied it and why', () => {
    const move = parse('balanced two-leg move, destination leg written first');

    assert.equal(move.raisedOn, '2026-01-29');
    assert.equal(move.recordedBy, 'mithusha');
    assert.equal(move.note, 'all taken unit 18 in transfer informed nanthini akka');
  });
});

describe('parseTransferLine: the bracket is not the warehouse', () => {
  test('Unit4(unit3) is Unit 4, not Unit 3', () => {
    // The single most dangerous thing about this format. The name in brackets
    // is the legacy column the figure used to live in; believing it would file
    // roughly a third of the movements against the wrong site.
    const move = parse('the bracket says unit3 but the warehouse is Unit4');

    assert.equal(move.fromWarehouseId, units.get('Unit4'), 'the legacy field name was believed');
    assert.equal(move.fromWarehouseId, '8');
    assert.notEqual(move.fromWarehouseId, units.get('Unit3'));
    assert.equal(move.toWarehouseId, units.get('Unit3'));
  });

  test('Unit18(unit1) is Unit 18, not Unit 1', () => {
    const move = parse('balanced two-leg move, destination leg written first');

    assert.equal(move.fromWarehouseId, units.get('Unit18'));
    assert.equal(move.fromWarehouseId, '6');
  });
});

describe('parseTransferLine: what is not a transfer', () => {
  test('a single-site correction is not a movement', () => {
    assert.equal(parse('one leg only - a correction at a single site'), null);
  });

  test('two sites moving the same way is a recount, not a movement', () => {
    assert.equal(parse('two legs moving the same way - two recounts, not a move'), null);
  });

  test('a leg with no opening figure takes the whole line with it', () => {
    // "from  to 50" - the delta is unknowable, and the unreadable leg may be
    // the one that balances the move, so half-reading it is not an option.
    assert.equal(parse('no opening figure - the delta cannot be worked out'), null);
  });

  test('Mark(unit2) is a flag, not a warehouse', () => {
    assert.equal(parse('Mark is a flag, not a warehouse'), null);
  });

  test('a line that is not a stock change at all is ignored', () => {
    assert.equal(parse('not a stock-change line at all'), null);
  });

  test('empty, null and rubbish input produce nothing rather than throwing', () => {
    for (const input of ['', null, undefined, 'Unit3(Quantity)', 'from 1 to 2']) {
      assert.equal(parseTransferLine(input, units), null, `${JSON.stringify(input)} became a transfer`);
    }
  });
});

describe('parseTransferLine: a warehouse the source does not list', () => {
  test('an unmapped unit keeps its own token rather than being dropped', () => {
    // Unit5 appears in the real log and has no row in inventory.warehouse.
    // The movement is still real and is shown under the name the log gave it.
    const move = parseTransferLine(
      'UK stock changes: Unit3(Quantity) from 0 to 40,Unit5(unit5) from 40 to 0 ' +
        '(taken to unit 3) by mithusha on 2026-05-02 via inventory CSV.',
      units,
    );

    assert.equal(move.fromWarehouseId, 'Unit5');
    assert.equal(move.toWarehouseId, '1');
    assert.equal(move.quantity, 40);
  });
});

describe('transferReference', () => {
  const event = {
    raisedOn: '2026-01-29',
    recordedBy: 'mithusha',
    note: 'taken to unit 3',
    fromWarehouseId: '6',
    toWarehouseId: '1',
  };

  test('is stable, so a link to a transfer keeps working between reads', () => {
    assert.equal(transferReference(event), transferReference({ ...event }));
  });

  test('changes when any part of the event changes', () => {
    const base = transferReference(event);

    assert.notEqual(base, transferReference({ ...event, raisedOn: '2026-01-30' }));
    assert.notEqual(base, transferReference({ ...event, recordedBy: 'manoranjini' }));
    assert.notEqual(base, transferReference({ ...event, note: 'something else' }));
    assert.notEqual(base, transferReference({ ...event, fromWarehouseId: '8' }));
    assert.notEqual(base, transferReference({ ...event, toWarehouseId: '8' }));
  });

  test('is marked as derived rather than dressed up as a business number', () => {
    assert.match(transferReference(event), /^TR-[0-9A-F]{10}$/);
  });
});

describe('extractTransfers', () => {
  /** Every sample line, against the same SKU. */
  const lines = RAW_HISTORY_LINES.map((row) => ({ sku: 'LSDO400GY', line: row.line }));

  test('keeps exactly the lines that are movements', () => {
    const expected = RAW_HISTORY_LINES.filter((row) => row.transfer).length;
    assert.equal(extractTransfers(lines, UK_WAREHOUSES).length, expected);
  });

  test('every row carries the fields the screen displays', () => {
    for (const transfer of extractTransfers(lines, UK_WAREHOUSES)) {
      for (const field of [
        'id',
        'sku',
        'fromWarehouseId',
        'toWarehouseId',
        'quantity',
        'quantityOut',
        'quantityIn',
        'status',
        'raisedOn',
        'recordedBy',
        'note',
      ]) {
        assert.ok(field in transfer, `${transfer.id} has no ${field}`);
      }
    }
  });

  test('never reports a movement from a warehouse to itself', () => {
    for (const transfer of extractTransfers(lines, UK_WAREHOUSES)) {
      assert.notEqual(transfer.fromWarehouseId, transfer.toWarehouseId, transfer.id);
    }
  });

  test('only ever produces a status the source can actually hold', () => {
    for (const transfer of extractTransfers(lines, UK_WAREHOUSES)) {
      assert.ok(
        [TRANSFER_RECEIVED, TRANSFER_RECEIVED_ADJUSTED].includes(transfer.status),
        `${transfer.id} is ${transfer.status}`,
      );
    }
  });

  test('invents no Pending or In Transit movement', () => {
    for (const transfer of extractTransfers(lines, UK_WAREHOUSES)) {
      assert.equal(transfer.status.includes('Pending'), false);
      assert.equal(transfer.status.includes('Transit'), false);
    }
  });

  test('the SKUs of one event share a reference, and different events do not', () => {
    const event = RAW_HISTORY_LINES.find((row) => row.transfer).line;

    const together = extractTransfers(
      [
        { sku: 'SKU-A', line: event },
        { sku: 'SKU-B', line: event },
      ],
      UK_WAREHOUSES,
    );

    assert.equal(together.length, 2);
    assert.equal(together[0].id, together[1].id, 'one event produced two references');
    assert.notEqual(together[0].sku, together[1].sku);

    const references = new Set(extractTransfers(lines, UK_WAREHOUSES).map((row) => row.id));
    assert.ok(references.size > 1, 'every movement got the same reference');
  });

  test('hands the rows back newest first', () => {
    const dates = extractTransfers(lines, UK_WAREHOUSES).map((row) => row.raisedOn);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  test('an empty log produces no transfers rather than throwing', () => {
    assert.deepEqual(extractTransfers([], UK_WAREHOUSES), []);
  });
});
