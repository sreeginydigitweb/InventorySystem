/**
 * Tests for routing and filtering.
 *
 * await route() is a pure function of path and query, so every screen is exercised
 * here without opening a socket.
 *
 * Run with: npm test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { route, routeForm } from './router.js';
import { TRANSFER_STATUSES, memorySource, useSource } from './store.js';
import { PRODUCTS } from './testdata/products.js';
import { WAREHOUSES } from './testdata/warehouses.js';
import { STOCK_LINES } from './testdata/stock.js';
import { TRANSFERS } from './testdata/transfers.js';
import { AUDIT_COUNTS } from './testdata/audit.js';
import { NAV_ITEMS } from './render.js';
import { ISSUE_TYPES } from './rules.js';
import { dashboardMetrics, issueCounts, transferCounts } from './reports.js';

// Every route in this file runs against the sample arrays in ./testdata, held
// in memory. Nothing here opens a connection to the business database - not
// even to read it - so the suite can be run anywhere, cannot be affected by
// what is in the real data today, and cannot touch it.
before(() =>
  useSource(
    memorySource({
      products: PRODUCTS,
      warehouses: WAREHOUSES,
      stockLines: STOCK_LINES,
      transfers: TRANSFERS,
      auditCounts: AUDIT_COUNTS,
    }),
  ),
);

after(() => useSource());

/** Fetch a screen, optionally with a query string. */
async function get(path, query = '') {
  return await route(path, new URLSearchParams(query));
}

/**
 * The body rows of a list screen's table, as raw HTML.
 *
 * For checking that every row on screen really does satisfy every filter that
 * was applied, rather than only that the count went down.
 *
 * @param {string} body
 * @returns {string[]}
 */
function tableRows(body) {
  const table = body.split('<tbody>')[1];
  if (!table) return [];
  return table.split('</tbody>')[0].split('<tr').slice(1);
}

/**
 * The count line a screen prints above its table.
 *
 * It takes one of three forms, and this reads all of them:
 *
 *   "4 products"                              nothing filtered, nothing capped
 *   "showing 200 of 1,289 stock lines"        capped
 *   "3 issues matching, out of 22"            filtered
 */
function shownCount(body) {
  const match = body.match(/<p class="count">([^<]*)</);
  assert.ok(match, 'the page has no count line');

  const text = match[1].replaceAll(',', '');

  // Four shapes, and this reads all of them:
  //   "22 issues"                                       one page, unfiltered
  //   "showing 1–200 of 255 issues"                     paged, unfiltered
  //   "3 issues matching, out of 22"                    one page, filtered
  //   "showing 1–200 of 250 issues matching, out of 255"  paged and filtered
  const paged = text.match(/^showing (\d+)–(\d+) of (\d+)/);
  const plain = text.match(/^(\d+)/);
  const outOf = text.match(/out of (\d+)/);

  assert.ok(paged || plain, `unreadable count line: ${JSON.stringify(match[1])}`);

  const shown = paged ? Number(paged[2]) - Number(paged[1]) + 1 : Number(plain[1]);
  const matched = paged ? Number(paged[3]) : Number(plain[1]);

  return { shown, matched, total: Number(outOf ? outOf[1] : matched) };
}

describe('every navigation link resolves', () => {
  for (const item of NAV_ITEMS) {
    test(`${item.path} returns a page`, async () => {
      const response = await get(item.path);
      assert.equal(response.status, 200, `${item.path} did not return 200`);
      assert.equal(response.contentType, 'text/html; charset=utf-8');
      assert.match(response.body, /^<!doctype html>/);
    });
  }

  test('there are no other links in the page shell to follow', async () => {
    // Every href the dashboard offers must itself resolve, so no tile or
    // drill-through can become a dead end.
    const { body } = await get('/');
    const hrefs = [...body.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    for (const href of hrefs) {
      const url = new URL(href.replaceAll('&amp;', '&'), 'http://localhost');
      const response = await route(url.pathname, url.searchParams);
      assert.equal(response.status, 200, `${href} is a dead link`);
    }
  });
});

describe('dashboard', () => {
  test('shows all six figures', async () => {
    const { body } = await get('/');
    for (const label of [
      'Total SKUs',
      'Healthy Stock',
      'Low Stock',
      'Out-of-Stock Items',
      'Discrepancies',
      'Stock Transfers',
    ]) {
      assert.ok(body.includes(label), `the dashboard is missing ${label}`);
    }
  });

  test('the figures on the page are the figures the reports produce', async () => {
    const { body } = await get('/');
    const metrics = await dashboardMetrics();

    for (const value of [
      metrics.totalSkus,
      metrics.healthyStock,
      metrics.lowStock,
      metrics.outOfStock,
      metrics.discrepancies,
      metrics.stockTransfers,
    ]) {
      assert.ok(
        body.includes(`<div class="value">${value}</div>`),
        `the dashboard does not show the value ${value}`,
      );
    }
  });

  test('is six cards, two summaries and no explanation', async () => {
    const { body } = await get('/');

    assert.equal((body.match(/<a class="tile/g) ?? []).length, 6, 'not six cards');
    assert.equal((body.match(/<h2/g) ?? []).length, 2, 'not two sections');
    assert.equal((body.match(/<table/g) ?? []).length, 2, 'not two tables');

    // The explanation that used to sit under the cards is gone for good.
    assert.equal((body.match(/<p class="note"/g) ?? []).length, 0, 'the dashboard has a note');
    assert.equal(body.includes('Stock figures count stock lines'), false);

    // The lede is the only paragraph left in <main>.
    const main = body.match(/<main>([\s\S]*)<\/main>/)[1];
    assert.equal((main.match(/<p[ >]/g) ?? []).length, 1, 'main has a paragraph other than the lede');
  });

  test('a card is a shortcut you can see and reach', async () => {
    const { body } = await get('/');

    // The whole card is the link, so the number, the name and the description
    // are one target rather than three.
    assert.equal((body.match(/<a class="tile[^"]*" href=/g) ?? []).length, 6);
    assert.equal(body.includes('<button'), false, 'the dashboard added a button');

    // Pointer, a hover state and a focus ring, so the shortcut is obvious with
    // a mouse and reachable with a keyboard.
    assert.match(body, /\.tile \{[^}]*cursor: pointer/, 'cards do not show a pointer');
    assert.match(body, /a\.tile:hover \{[^}]*border-color/, 'no hover state');
    assert.match(body, /a\.tile:active \{/, 'no click feedback');
    assert.match(body, /a\.tile:focus-visible \{[^}]*outline:/, 'no keyboard focus state');
    assert.match(body, /prefers-reduced-motion/, 'hover movement is not opt-out');
  });

  /** The <tr> blocks of the table under a given heading. */
  function summaryRows(body, heading) {
    // The body rows only - splitting the whole table would take the header
    // row with it and count it as a summary line.
    const section = body.split(`<h2>${heading}</h2>`)[1].split('<tbody>')[1].split('</tbody>')[0];
    return section
      .split('<tr>')
      .slice(1)
      .map((row) => ({
        badge: (row.match(/<span class="pill [^"]*">([^<]*)</) ?? [])[1],
        count: Number((row.match(/<td class="num">(\d+)</) ?? [])[1]),
        href: (row.match(/<a class="icon"[^>]*href="([^"]+)"/) ?? [])[1]?.replaceAll('&amp;', '&'),
      }));
  }

  test('the Issues detected summary lists every issue type, with its count', async () => {
    const { body } = await get('/');
    const counts = await issueCounts();
    const rows = summaryRows(body, 'Issues detected');

    assert.ok(body.includes('<h2>Issues detected</h2>'));
    assert.deepEqual(counts.map((row) => row.type).sort(), [...ISSUE_TYPES].sort());

    // Same types, same order, same counts as the report produces - and a link.
    assert.deepEqual(rows.map((row) => row.badge), counts.map((row) => row.type));
    assert.deepEqual(rows.map((row) => row.count), counts.map((row) => row.count));

    for (const row of rows) {
      assert.ok(row.href?.startsWith('/alerts?type='), `${row.badge} has no Alerts link`);
    }
  });

  test('the Transfers by status summary lists every status, with its count', async () => {
    const { body } = await get('/');
    const counts = await transferCounts();
    const rows = summaryRows(body, 'Transfers by status');

    assert.ok(body.includes('<h2>Transfers by status</h2>'));
    // Only the statuses a movement in this source can actually hold. Pending
    // and In Transit were a workflow ledsone has no trace of, and every row
    // under them was permanently zero.
    assert.deepEqual(counts.map((row) => row.status), ['Received', 'Received (Adjusted)']);

    assert.deepEqual(rows.map((row) => row.badge), counts.map((row) => row.status));
    assert.deepEqual(rows.map((row) => row.count), counts.map((row) => row.count));

    for (const row of rows) {
      assert.ok(row.href?.startsWith('/transfers?status='), `${row.badge} has no Transfers link`);
    }
  });

  test('every View link resolves and narrows the screen it lands on', async () => {
    const { body } = await get('/');
    const links = [...body.matchAll(/<td class="row-actions"><a class="icon"[^>]*href="([^"]+)"/g)].map(
      (match) => match[1].replaceAll('&amp;', '&'),
    );

    assert.equal(links.length, 8, 'expected six issue links and two transfer links');

    for (const href of links) {
      const url = new URL(href, 'http://localhost');
      const filtered = await route(url.pathname, url.searchParams);
      const all = await route(url.pathname, new URLSearchParams());

      assert.equal(filtered.status, 200, `${href} does not resolve`);
      assert.ok(
        shownCount(filtered.body).shown < shownCount(all.body).total,
        `${href} lands on the screen unfiltered`,
      );
    }
  });

  test('the summaries are read-only - no CRUD moved onto the dashboard', async () => {
    const { body } = await get('/');

    assert.equal(body.includes('<form'), false, 'the dashboard has a form');
    for (const path of ['/alerts/edit', '/alerts/add', '/transfers/add', '/transfers/edit']) {
      assert.equal(body.includes(path), false, `the dashboard links to ${path}`);
    }
  });

  test('both summaries are laid out on the same three columns', async () => {
    const { body } = await get('/');
    const table = (heading) => body.split(`<h2>${heading}</h2>`)[1].split('</table>')[0];
    const colgroup = (heading) => table(heading).match(/<colgroup>[\s\S]*?<\/colgroup>/)[0];

    // The same column layout on both, so Count and Action start at the same
    // horizontal position on each rather than wherever the widest cell in the
    // first column happens to push them.
    assert.equal(colgroup('Issues detected'), colgroup('Transfers by status'));
    assert.match(colgroup('Issues detected'), /<col class="c-name"><col class="c-count"><col class="c-action">/);

    // A <col> width is only a hint unless the table layout is fixed.
    assert.match(body, /table\.summary \{[^}]*table-layout: fixed/, 'column widths are not binding');
    assert.match(body, /table\.summary col\.c-count \{ width: [\d.]+rem/);
    assert.match(body, /table\.summary col\.c-action \{ width: [\d.]+rem/);

    // Count stays right-aligned, Action stays left, headers with their cells.
    assert.match(body, /td\.num, th\.num \{ text-align: right/);
    for (const heading of ['Issues detected', 'Transfers by status']) {
      assert.match(table(heading), /<th class="num">Count<\/th><th class="row-actions">Action<\/th>/);
      assert.match(table(heading), /<td class="num">\d+<\/td>\s*<td class="row-actions">/);
    }

    // Narrow screens scroll the table, never the page.
    assert.match(body, /table\.summary \{[^}]*min-width: [\d.]+rem/);
    assert.equal((body.match(/<div class="table-scroll">\s*<table/g) ?? []).length, 2);
  });

  test('both summaries scroll inside their own container', async () => {
    const { body } = await get('/');

    // A narrow screen scrolls the table, never the page.
    assert.equal((body.match(/<div class="table-scroll">\s*<table/g) ?? []).length, 2);
    assert.match(body, /\.table-scroll \{[^}]*overflow-x: auto/);
    assert.match(body, /\.table-scroll \{[^}]*max-width: 100%/);
  });

  test('a SKU with a space in it is still reachable from its own link', async () => {
    // Seven SKUs in the source database carry a leading or trailing space -
    // " FWS444BL", "CGSPBM ", "RBLSDO300BI  ". Trimming the query parameter
    // turned every one of their View links into a 404: the href was built from
    // the real SKU, then trimmed back to something matching nothing.
    // Identifiers are compared exactly; only search text is trimmed.
    const padded = ' SIC-PAD ';

    useSource(
      memorySource({
        products: [
          ...PRODUCTS,
          { ...PRODUCTS[0], sku: padded, approvedWarehouses: null },
        ],
        warehouses: WAREHOUSES,
        stockLines: [{ sku: padded, warehouseId: WAREHOUSES[0].id, onHand: 5, reserved: 0 }],
        transfers: [],
        auditCounts: [],
      }),
    );

    try {
      const listed = await get('/products', 'q=SIC-PAD');
      const hrefs = [...listed.body.matchAll(/href="(\/products\/view[^"]*)"/g)].map((m) =>
        m[1].replaceAll('&amp;', '&'),
      );
      assert.equal(hrefs.length, 1, 'the padded SKU is not listed');

      const url = new URL(hrefs[0], 'http://localhost');
      const viewed = await route(url.pathname, url.searchParams);
      assert.equal(viewed.status, 200, 'the padded SKU 404s from its own View link');

      const stockUrl = new URL(
        `/stock/view?sku=${encodeURIComponent(padded)}&warehouse=${WAREHOUSES[0].id}`,
        'http://localhost',
      );
      const stockViewed = await route(stockUrl.pathname, stockUrl.searchParams);
      assert.equal(stockViewed.status, 200, 'the padded stock line 404s from its own View link');
    } finally {
      useSource(
        memorySource({
          products: PRODUCTS,
          warehouses: WAREHOUSES,
          stockLines: STOCK_LINES,
          transfers: TRANSFERS,
          auditCounts: AUDIT_COUNTS,
        }),
      );
    }
  });

  test('a card and the screen it opens show the same figure', async () => {
    // The whole point of making the cards count SKUs. Before, Healthy Stock
    // counted stock lines and drilled through to a screen counting something
    // else, so the two numbers disagreed.
    const metrics = await dashboardMetrics();

    for (const [href, expected] of [
      ['/products', metrics.totalSkus],
      ['/products?stock=Healthy', metrics.healthyStock],
      ['/products?stock=Low+Stock', metrics.lowStock],
      ['/products?stock=Out+of+Stock', metrics.outOfStock],
      ['/transfers', metrics.stockTransfers],
      ['/audit?show=discrepancy', metrics.discrepancies],
    ]) {
      const url = new URL(href, 'http://localhost');
      const { body } = await route(url.pathname, url.searchParams);

      assert.equal(
        shownCount(body).matched,
        expected,
        `the card says ${expected} but ${href} lists a different number`,
      );
    }
  });

  test('every card is a shortcut to the rows behind it', async () => {
    const { body } = await get('/');

    // The three stock cards count SKUs, so they drill through to the Products
    // screen filtered to that band - not to the stock screen, which counts
    // lines and would show a different figure from the card that opened it.
    for (const href of [
      '/products',
      '/products?stock=Healthy',
      '/products?stock=Low+Stock',
      '/products?stock=Out+of+Stock',
      '/audit?show=discrepancy',
      '/transfers',
    ]) {
      assert.ok(body.includes(`href="${href}"`), `no card links to ${href}`);

      // The link must not just resolve - it must narrow the screen it lands on.
      const url = new URL(href, 'http://localhost');
      const response = await route(url.pathname, url.searchParams);
      assert.equal(response.status, 200, `${href} does not resolve`);

      if (url.search) {
        const all = await route(url.pathname, new URLSearchParams());
        assert.notEqual(
          shownCount(response.body).shown,
          shownCount(all.body).total,
          `${href} lands on the screen unfiltered`,
        );
      }
    }
  });
});

describe('products screen', () => {
  test('shows the required columns', async () => {
    const { body } = await get('/products');
    for (const heading of ['SKU', 'Product Name', 'Category', 'Supplier', 'Image']) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('renders a thumbnail per product', async () => {
    const { body } = await get('/products');
    assert.ok(body.includes('src="/images/SIC-1001.svg"'));
  });

  test('filters by category', async () => {
    const { body } = await get('/products', 'category=Bulbs');
    const { shown, total } = shownCount(body);
    assert.ok(shown > 0 && shown < total, 'the category filter changed nothing');
  });

  test('filters by supplier', async () => {
    const { body } = await get('/products', 'supplier=Verity+Home+Fittings');
    const { shown, total } = shownCount(body);
    assert.ok(shown > 0 && shown < total);
  });

  test('searches SKU, name and supplier', async () => {
    assert.ok(shownCount((await get('/products', 'q=SIC-1001')).body).shown === 1);
    assert.ok(shownCount((await get('/products', 'q=tripod')).body).shown === 1);
    assert.ok(shownCount((await get('/products', 'q=northgate')).body).shown > 1);
  });

  test('search is case-insensitive', async () => {
    assert.equal(
      shownCount((await get('/products', 'q=AURORA')).body).shown,
      shownCount((await get('/products', 'q=aurora')).body).shown,
    );
  });

  test('an unmatched search shows an empty state, not a broken table', async () => {
    const { body } = await get('/products', 'q=zzzznothing');
    assert.equal(shownCount(body).shown, 0);

    // The term is quoted back, so a typo is obvious rather than looking like a
    // screen that simply does not work.
    assert.match(body, /No products match/);
    assert.ok(body.includes('zzzznothing'), 'the empty state does not name the term searched for');
  });

  test('the SKU stock points at but the catalogue does not hold is still reported', async () => {
    // The Products screen used to carry a note naming it. That note is gone,
    // so the check is that the condition is still detected and still listed -
    // on the Alerts screen, which is where every other issue is reported.
    const { body } = await get('/alerts', 'type=Warehouse%2FSKU+Mismatch');
    assert.ok(body.includes('SIC-9999'), 'the uncatalogued SKU is reported nowhere');
  });
});

describe('warehouse stock screen', () => {
  test('shows the required columns', async () => {
    const { body } = await get('/stock');
    for (const heading of ['SKU', 'Warehouse', 'Current', 'Reserved', 'Available', 'Status']) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('filters by warehouse', async () => {
    const { body } = await get('/stock', 'warehouse=WH-BIR');
    const { shown, total } = shownCount(body);
    assert.ok(shown > 0 && shown < total);
  });

  test('filters by each health band, and the bands add up to the whole', async () => {
    const total = shownCount((await get('/stock')).body).total;
    const bands = ['Healthy', 'Low Stock', 'Out of Stock', 'Negative Inventory'];
    let summed = 0;
    for (const band of bands) {
      summed += shownCount((await get('/stock', `status=${encodeURIComponent(band)}`)).body).shown;
    }
    assert.equal(summed, total);
  });

  test('shows a negative quantity as negative rather than hiding it', async () => {
    const { body } = await get('/stock', 'status=Negative+Inventory');
    assert.match(body, /class="neg">-6</);
  });

  test('an unrecognised filter value shows everything rather than nothing', async () => {
    const { shown, total } = shownCount((await get('/stock', 'status=Nonsense')).body);
    assert.equal(shown, total);
  });
});

/**
 * The issue-type pills actually rendered in a screen's table body.
 *
 * Deliberately NOT a search of the whole page. The filter dropdown lists all
 * six type names in its <option> elements, so `body.includes('Low Stock')` is
 * true even when every row on the page is a Negative Inventory row - which is
 * exactly the bug this file now guards against. Only the <tbody> counts.
 */
function renderedIssueTypes(body) {
  const tbody = body.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
  return [...tbody.matchAll(/<td><span class="pill [^"]*">([^<]*)</g)].map((m) => m[1]);
}

describe('alerts screen', () => {
  test('shows every issue type when unfiltered', async () => {
    const rendered = new Set(renderedIssueTypes((await get('/alerts')).body));
    for (const type of ISSUE_TYPES) {
      assert.ok(rendered.has(type), `no ${type} row is rendered on the alerts table`);
    }
  });

  test('each rendered row carries the type it was filtered to, and no other', async () => {
    for (const type of ISSUE_TYPES) {
      const { body } = await get('/alerts', `type=${encodeURIComponent(type)}`);
      const rendered = renderedIssueTypes(body);

      assert.ok(rendered.length > 0, `filtering to ${type} renders no rows`);
      assert.deepEqual(
        [...new Set(rendered)],
        [type],
        `filtering to ${type} rendered other types too`,
      );
    }
  });

  test('each issue type can be filtered to on its own, and each has rows', async () => {
    for (const type of ISSUE_TYPES) {
      const { body } = await get('/alerts', `type=${encodeURIComponent(type)}`);
      const { shown } = shownCount(body);
      assert.ok(shown > 0, `filtering to ${type} shows nothing`);
    }
  });

  test('the per-type counts add up to the unfiltered list', async () => {
    const total = shownCount((await get('/alerts')).body).total;
    let summed = 0;
    for (const type of ISSUE_TYPES) {
      summed += shownCount((await get('/alerts', `type=${encodeURIComponent(type)}`)).body).shown;
    }
    assert.equal(summed, total);
  });

  test('filters by warehouse', async () => {
    const { shown, total } = shownCount((await get('/alerts', 'warehouse=WH-MAN')).body);
    assert.ok(shown > 0 && shown < total);
  });

  test('names the SKU and the warehouse on the row', async () => {
    const { body } = await get('/alerts', 'type=Negative+Inventory');
    assert.ok(body.includes('SIC-3003'), 'the affected SKU is not shown');
    assert.ok(body.includes('Manchester North'), 'the affected warehouse is not shown');
  });
});

/*
 * THE BUG THIS BLOCK EXISTS FOR
 *
 * Issues are sorted most serious first, and the list screens render at most 200
 * rows. In the real data there are 2,076 Negative Inventory issues, so with a
 * flat cap and no way past it EVERY row on the Alerts screen was a Negative
 * Inventory row and the other five types could not be reached at all.
 *
 * Nothing was mislabelled: rules.js raised all six types with the right names
 * and the right counts. The rows simply could not be got to.
 *
 * The sample data used everywhere else in this file is far too small to show
 * this - 22 issues fit on one page - so these cases build a source with more
 * top-severity issues than fit on a page, exactly as the real data has.
 */
describe('alerts: one severity must not crowd out the rest', () => {
  const WAREHOUSES_ONE = [{ id: 'W1', name: 'Main Depot', location: 'Leeds' }];
  const GHOST = 'W-GONE';

  /** An active, fast-selling product, so only the stock line decides the issue. */
  const product = (sku, over = {}) => ({
    sku,
    name: `Product ${sku}`,
    image: null,
    category: 'Test',
    supplier: 'Test Supplier',
    active: true,
    endOfLineStatus: null,
    unitsSoldLast90Days: 100,
    approvedWarehouses: null,
    ...over,
  });

  const line = (sku, onHand, reserved = 0, warehouseId = 'W1') => ({
    sku,
    warehouseId,
    onHand,
    reserved,
  });

  // 250 negative lines - more than one page - plus exactly one of every other
  // type, each isolated so it raises that issue and no other.
  const NEGATIVE_COUNT = 250;
  const products = [];
  const stockLines = [];

  for (let i = 0; i < NEGATIVE_COUNT; i += 1) {
    const sku = `NEG-${String(i).padStart(3, '0')}`;
    products.push(product(sku));
    stockLines.push(line(sku, -5));
  }

  products.push(product('OUT-1'));
  stockLines.push(line('OUT-1', 0)); //                      Out of Stock

  products.push(product('LOW-1'));
  stockLines.push(line('LOW-1', 5)); //                       Low Stock: 5 <= 10

  products.push(product('MIS-1'));
  stockLines.push(line('MIS-1', 50, 0, GHOST)); //            Warehouse/SKU Mismatch

  products.push(product('INACT-1', { active: false }));
  stockLines.push(line('INACT-1', 20)); //                    Inactive Listing

  products.push(product('SLOW-1', { unitsSoldLast90Days: 0 }));
  stockLines.push(line('SLOW-1', 30)); //                     Slow-Moving Stock

  const EXPECTED = {
    'Negative Inventory': NEGATIVE_COUNT,
    'Out of Stock': 1,
    'Low Stock': 1,
    'Warehouse/SKU Mismatch': 1,
    'Inactive Listing': 1,
    'Slow-Moving Stock': 1,
  };

  before(() =>
    useSource(
      memorySource({
        products,
        warehouses: WAREHOUSES_ONE,
        stockLines,
        transfers: [],
        auditCounts: [],
      }),
    ),
  );

  after(() =>
    useSource(
      memorySource({
        products: PRODUCTS,
        warehouses: WAREHOUSES,
        stockLines: STOCK_LINES,
        transfers: TRANSFERS,
        auditCounts: AUDIT_COUNTS,
      }),
    ),
  );

  test('the rules still raise all six types with the right counts', async () => {
    const counts = Object.fromEntries((await issueCounts()).map((r) => [r.type, r.count]));
    assert.deepEqual(counts, EXPECTED);
  });

  test('page one is a full page of the most serious type - this is the trap', async () => {
    const { body } = await get('/alerts');
    const rendered = renderedIssueTypes(body);

    assert.equal(rendered.length, 200, 'page one is not a full page');
    assert.deepEqual([...new Set(rendered)], ['Negative Inventory']);

    // ...and it must say so, rather than looking like the whole list.
    assert.match(body, /showing 1–200 of 255 issues/);
  });

  test('paging through reaches every one of the six types', async () => {
    const seen = new Set();
    let rows = 0;

    for (let p = 1; p <= 10; p += 1) {
      const { status, body } = await get('/alerts', `page=${p}`);
      assert.equal(status, 200, `page ${p} did not render`);

      const rendered = renderedIssueTypes(body);
      rendered.forEach((t) => seen.add(t));
      rows += rendered.length;

      if (!body.includes('rel="next"')) break;
    }

    assert.equal(rows, 255, 'paging did not reach every issue');
    assert.deepEqual([...seen].sort(), [...ISSUE_TYPES].sort(), 'a type is unreachable by paging');
  });

  test('every type is still reachable in one step through its filter', async () => {
    for (const [type, expected] of Object.entries(EXPECTED)) {
      const { body } = await get('/alerts', `type=${encodeURIComponent(type)}`);
      const rendered = renderedIssueTypes(body);

      assert.deepEqual([...new Set(rendered)], [type], `${type} filter shows other types`);
      assert.equal(
        shownCount(body).matched,
        expected,
        `${type} filter does not match the counted total`,
      );
    }
  });

  test('the pager carries the filter, so paging cannot silently widen it', async () => {
    const { body } = await get('/alerts', 'type=Negative+Inventory');
    const nextHref = body.match(/rel="next" href="([^"]+)"/)?.[1].replaceAll('&amp;', '&');

    assert.ok(nextHref, 'a 250-row filtered list offers no next page');
    assert.ok(nextHref.includes('type=Negative'), 'the next link drops the type filter');

    const url = new URL(nextHref, 'http://localhost');
    const next = await route(url.pathname, url.searchParams);
    assert.deepEqual([...new Set(renderedIssueTypes(next.body))], ['Negative Inventory']);
  });

  test('an out-of-range or nonsense page lands on a real page, not an error', async () => {
    for (const p of ['0', '-3', '9999', 'banana', '']) {
      const { status, body } = await get('/alerts', `page=${encodeURIComponent(p)}`);
      assert.equal(status, 200, `page=${p} did not render`);
      assert.ok(renderedIssueTypes(body).length > 0, `page=${p} rendered an empty table`);
    }
  });
});

describe('transfers screen', () => {
  test('shows the required columns', async () => {
    const { body } = await get('/transfers');
    for (const heading of [
      'Reference',
      'SKU',
      'Product',
      'From',
      'To',
      'Qty',
      'Status',
      'Date',
      'Recorded by',
      'Reason',
    ]) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('each status the source can hold can be filtered to, and each has rows', async () => {
    for (const status of TRANSFER_STATUSES) {
      const { shown } = shownCount((await get('/transfers', `status=${encodeURIComponent(status)}`)).body);
      assert.ok(shown > 0, `no transfer is ${status}`);
    }
  });

  test('offers no Pending or In Transit filter, and invents no rows for them', async () => {
    const { body } = await get('/transfers');

    for (const invented of ['Pending', 'In Transit']) {
      assert.equal(
        body.includes(`<option value="${invented}"`),
        false,
        `the Status dropdown still offers ${invented}`,
      );

      // An unrecognised status is dropped rather than applied, so the URL
      // lands on the unfiltered screen - not on a screen of fabricated rows.
      const { matched, total } = shownCount(
        (await get('/transfers', `status=${encodeURIComponent(invented)}`)).body,
      );
      assert.equal(matched, total, `${invented} produced rows the source does not hold`);
    }
  });

  test('the statuses add up to every transfer', async () => {
    const total = shownCount((await get('/transfers')).body).total;
    let summed = 0;
    for (const status of TRANSFER_STATUSES) {
      summed += shownCount((await get('/transfers', `status=${encodeURIComponent(status)}`)).body).shown;
    }
    assert.equal(summed, total);
  });

  test('the source and the destination are filtered separately', async () => {
    // One filter for what is leaving a site, another for what is arriving, so
    // a site's outbound and inbound moves can be asked about on their own.
    const out = shownCount((await get('/transfers', 'from=WH-BIR')).body);
    const into = shownCount((await get('/transfers', 'to=WH-BIR')).body);

    assert.ok(out.shown > 0 && out.shown < out.total, 'nothing leaves Birmingham');
    assert.ok(into.shown > 0 && into.shown < into.total, 'nothing arrives at Birmingham');
    assert.notEqual(out.shown, into.shown, 'the two directions cannot be told apart');
  });

  test('source and destination narrow together, naming one leg of a move', async () => {
    const out = shownCount((await get('/transfers', 'from=WH-BIR')).body);
    const leg = shownCount((await get('/transfers', 'from=WH-BIR&to=WH-MAN')).body);

    assert.ok(leg.shown > 0 && leg.shown <= out.shown);
  });

  test('searches the SKU, product, warehouses, reason, user and reference', async () => {
    for (const [term, expected] of [
      ['SIC-3001', 'the SKU'],
      ['aurora', 'the product name'],
      ['Leeds', 'a warehouse name'],
      ['refill check', 'the reason'],
      ['Slakshika', 'who recorded it'],
      ['TR-GROUP01', 'the derived reference'],
    ]) {
      const { shown, matched, total } = shownCount((await get('/transfers', `q=${encodeURIComponent(term)}`)).body);
      assert.ok(shown > 0, `searching ${expected} (${term}) found nothing`);
      assert.ok(matched < total, `searching ${expected} (${term}) narrowed nothing`);
    }
  });

  test('search is case-insensitive, partial, and literal rather than a pattern', async () => {
    const lower = shownCount((await get('/transfers', 'q=sic-3001')).body).matched;
    const upper = shownCount((await get('/transfers', 'q=SIC-3001')).body).matched;
    const partial = shownCount((await get('/transfers', 'q=SIC-30')).body).matched;

    assert.equal(lower, upper, 'search is case-sensitive');
    assert.ok(partial >= upper, 'a partial term finds less than the whole one');

    // A regex metacharacter is the character, not a pattern: ".*" matches
    // nothing rather than everything.
    assert.equal(shownCount((await get('/transfers', 'q=.*')).body).matched, 0);
  });

  test('search combines with status, from and to', async () => {
    const all = shownCount((await get('/transfers')).body).total;

    const combined = shownCount(
      (await get('/transfers', 'q=SIC&status=Received&from=WH-BIR&to=WH-MAN')).body,
    );

    assert.ok(combined.matched > 0, 'the four filters together match nothing');
    assert.ok(combined.matched < all, 'the four filters together narrow nothing');

    // Each condition genuinely applies: every row on screen satisfies all four.
    const { body } = await get('/transfers', 'q=SIC&status=Received&from=WH-BIR&to=WH-MAN');
    for (const row of tableRows(body)) {
      assert.ok(row.includes('Birmingham Central'), 'a row is not from Birmingham');
      assert.ok(row.includes('Manchester North'), 'a row is not to Manchester');
      assert.ok(row.includes('>Received<'), 'a row is not Received');
      assert.ok(/SIC-\d+/.test(row), 'a row does not match the search');
    }
  });

  test('search and each filter narrow on their own as well as together', async () => {
    const all = shownCount((await get('/transfers')).body).total;

    for (const query of [
      'q=SIC-3001',
      'status=Received+%28Adjusted%29',
      'from=WH-MAN',
      'to=WH-BIR',
      'q=SIC&from=WH-BIR',
      'status=Received&to=WH-MAN',
      'q=stock+take&status=Received&from=WH-BIR',
    ]) {
      const { matched } = shownCount((await get('/transfers', query)).body);
      assert.ok(matched > 0, `${query} matches nothing`);
      assert.ok(matched < all, `${query} narrows nothing`);
    }
  });

  test('a search matching nothing says so and names the term', async () => {
    const { body } = await get('/transfers', 'q=zzzznothinghere');

    assert.equal(shownCount(body).matched, 0);
    assert.match(body, /No transfers match/);
    assert.ok(body.includes('zzzznothinghere'), 'the empty state does not quote the term');
    assert.equal(body.includes('<tbody>'), false, 'an empty result still rendered a table');
  });

  test('View opens the whole movement, not just the row that was clicked', async () => {
    // 303 of the 776 real transfers move more than one SKU under one
    // reference. Opening one must show all of its lines.
    const { body } = await get('/transfers', 'q=TR-GROUP01');
    const [first] = [...body.matchAll(/href="(\/transfers\/view[^"]*)"/g)].map((match) =>
      match[1].replaceAll('&amp;', '&'),
    );

    const url = new URL(first, 'http://localhost');
    const viewed = await route(url.pathname, url.searchParams);

    assert.equal(viewed.status, 200);
    for (const sku of ['SIC-1001', 'SIC-1002', 'SIC-2001']) {
      assert.ok(viewed.body.includes(sku), `the transfer page is missing line ${sku}`);
    }

    // And it says the reference is derived rather than a business number.
    assert.match(viewed.body, /ledsone holds no transfer reference/);
  });

  test('an unknown reference is a 404, not an empty transfer page', async () => {
    assert.equal((await get('/transfers/view', 'id=TR-NOT-REAL')).status, 404);
  });
});

describe('inventory audit screen', () => {
  test('shows the required columns', async () => {
    const { body } = await get('/audit');
    for (const heading of ['SKU', 'Warehouse', 'System Qty', 'Counted Qty', 'Difference']) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('shows a shortage and an overage with their signs', async () => {
    const { body } = await get('/audit');
    assert.match(body, />-3</, 'no shortage is shown');
    assert.match(body, />\+4</, 'no overage is shown');
  });

  test('the discrepancies-only filter keeps only the lines that disagree', async () => {
    const { shown, total } = shownCount((await get('/audit', 'show=discrepancy')).body);
    assert.ok(shown > 0 && shown < total);
    assert.equal(shown, (await dashboardMetrics()).discrepancies);
  });

  test('filters by warehouse', async () => {
    const { shown, total } = shownCount((await get('/audit', 'warehouse=WH-BIR')).body);
    assert.ok(shown > 0 && shown < total);
  });
});

describe('thumbnail route', () => {
  test('serves an SVG for a catalogued SKU', async () => {
    const response = await get('/images/SIC-1001.svg');
    assert.equal(response.status, 200);
    assert.equal(response.contentType, 'image/svg+xml; charset=utf-8');
    assert.match(response.body, /<svg/);
  });

  test('serves a placeholder rather than failing for an unknown SKU', async () => {
    const response = await get('/images/SIC-9999.svg');
    assert.equal(response.status, 200);
    assert.match(response.body, /<svg/);
  });

  test('a path-traversal attempt is treated as a SKU lookup, not a file read', async () => {
    const response = await get('/images/..%2F..%2Fpackage.json.svg');
    assert.equal(response.status, 200);
    assert.match(response.body, /<svg/);
    assert.equal(response.body.includes('smart-inventory-control'), false);
  });
});

describe('unknown paths', () => {
  test('return 404 with a usable page', async () => {
    const response = await get('/nope');
    assert.equal(response.status, 404);
    assert.match(response.body, /does not exist/);
  });

  test('a trailing slash is tolerated rather than 404ing', async () => {
    assert.equal((await get('/products/')).status, 200);
  });
});
describe('the list screens carry no explanatory boxes', () => {
  const SCREENS = ['/', '/products', '/stock', '/alerts', '/transfers', '/audit'];

  test('no screen explains itself in a note above its table', async () => {
    for (const screen of SCREENS) {
      const { body } = await get(screen);
      const main = body.match(/<main>[\s\S]*<\/main>/)[0];
      assert.equal((main.match(/<p class="note"/g) ?? []).length, 0, `${screen} still has a note`);
    }
  });

  test('the particular explanations are gone, wherever they sat', async () => {
    const gone = {
      '/products': 'not in this catalogue',
      '/stock': 'Available is not stored',
      '/alerts': 'Issues are worked out from the stock data',
      '/transfers': 'Transfers are a record only in this MVP',
      '/audit': 'Difference is Counted minus System',
      '/': 'Stock figures count stock lines',
    };

    for (const [screen, text] of Object.entries(gone)) {
      const { body } = await get(screen);
      assert.equal(body.includes(text), false, `${screen} still explains "${text}"`);
    }
  });

  test('what the screens are actually for is untouched', async () => {
    // Removing the prose must not have taken a heading, a filter bar, the row
    // count, the table or the add button with it.
    for (const screen of ['/products', '/stock', '/alerts', '/transfers', '/audit']) {
      const { body } = await get(screen);
      assert.match(body, /<h1>/, `${screen} lost its heading`);
      assert.match(body, /<form class="filters"/, `${screen} lost its filters`);
      assert.match(body, /<p class="count">/, `${screen} lost its row count`);
      assert.match(body, /<table/, `${screen} lost its table`);
    }

    // The dashboard keeps both summaries.
    const { body } = await get('/');
    assert.match(body, /<h2>Issues detected<\/h2>/);
    assert.match(body, /<h2>Transfers by status<\/h2>/);
    assert.equal((body.match(/<a class="tile/g) ?? []).length, 6);
  });

  test('nothing on any screen offers to change the source data', async () => {
    // The source database is read-only to this application, so no screen may
    // carry a form, and no screen may link to a route that would change
    // something. This is the check that a write path has not crept back in by
    // way of the rendering.
    for (const item of NAV_ITEMS) {
      const { body } = await get(item.path);
      const main = body.match(/<main>([\s\S]*)<\/main>/)[1];

      // The filter bar is a form, and is allowed to be: it is a GET, so it can
      // only ever ask for a different view of the same data. A POST is what
      // changes something, and there must not be one.
      assert.equal(/<form[^>]*method="post"/i.test(main), false, `${item.path} posts a form`);

      for (const write of ['/add', '/edit', '/delete', '/resolve']) {
        assert.equal(main.includes(write), false, `${item.path} links to ${write}`);
      }
    }
  });

  test('a posted form is refused rather than acted on', async () => {
    // There is no route that accepts a submission. An old bookmark gets a page
    // that says so, not a 303 and not a silent success.
    for (const path of ['/products/add', '/stock/edit', '/audit/delete', '/alerts/resolve']) {
      const response = await routeForm(path, new URLSearchParams({ sku: 'SIC-1001' }));

      assert.equal(response.status, 405, `${path} did not refuse the post`);
      assert.equal(response.location, undefined, `${path} redirected as if it had written`);
      assert.match(response.body, /does not change it/, `${path} did not explain itself`);
    }
  });
});

/*
 * SEARCH
 *
 * Three things had to hold and did not:
 *
 *   - Alerts had no search at all - no `q` parameter was read and no box was
 *     rendered;
 *   - Products searched SKU, name and supplier but not category;
 *   - Warehouse Stock searched SKU and product name only, so a warehouse name
 *     or a shelf reference found nothing.
 *
 * The cases below pin all three down, and - because Alerts carries tens of
 * thousands of issues in the real data - prove that the search runs over the
 * WHOLE set before the page window is taken, not over the 200 rows that happen
 * to be on screen.
 */
describe('search', () => {
  /** Rows rendered in a screen's table body. */
  const rowsOf = (body) => {
    const tbody = body.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
    return tbody.split('<tr').slice(1);
  };

  describe('products', () => {
    test('an exact SKU finds that product', async () => {
      const { body } = await get('/products', 'q=SIC-1001');
      assert.equal(shownCount(body).matched, 1);
      assert.ok(body.includes('SIC-1001'));
    });

    test('a partial product name matches', async () => {
      const target = PRODUCTS[0];
      const fragment = target.name.slice(2, 8);
      const { body } = await get('/products', `q=${encodeURIComponent(fragment)}`);

      assert.ok(shownCount(body).matched > 0, `"${fragment}" matched no product`);
      assert.ok(
        rowsOf(body).some((row) => row.includes(target.sku)),
        'the product the fragment came from is not in the results',
      );
    });

    test('search is case-insensitive', async () => {
      const lower = shownCount((await get('/products', 'q=sic-1001')).body).matched;
      const upper = shownCount((await get('/products', 'q=SIC-1001')).body).matched;
      const mixed = shownCount((await get('/products', 'q=SiC-1001')).body).matched;

      assert.equal(lower, upper);
      assert.equal(upper, mixed);
      assert.equal(lower, 1);
    });

    test('category is searchable, not just SKU, name and supplier', async () => {
      const withCategory = PRODUCTS.find((p) => p.category);
      const { body } = await get('/products', `q=${encodeURIComponent(withCategory.category)}`);

      assert.ok(
        rowsOf(body).some((row) => row.includes(withCategory.sku)),
        'searching a category finds nothing - category is not being searched',
      );
    });

    test('supplier is searchable', async () => {
      const withSupplier = PRODUCTS.find((p) => p.supplier);
      const { body } = await get('/products', `q=${encodeURIComponent(withSupplier.supplier)}`);
      assert.ok(rowsOf(body).some((row) => row.includes(withSupplier.sku)));
    });

    test('a term matching nothing returns nothing, not everything', async () => {
      const { body } = await get('/products', 'q=zzz-no-such-product-zzz');
      assert.equal(shownCount(body).matched, 0);
      assert.equal(rowsOf(body).length, 0);
    });

    test('search narrows alongside a dropdown filter rather than replacing it', async () => {
      const target = PRODUCTS[0];
      const band = shownCount((await get('/products', 'stock=Healthy')).body).matched;
      const both = await get('/products', `stock=Healthy&q=${encodeURIComponent(target.sku)}`);

      assert.ok(shownCount(both.body).matched <= band, 'search widened the filtered set');

      // Both controls come back still set, so the bar reflects the list.
      assert.match(both.body, /<option value="Healthy" selected>/);
      assert.ok(both.body.includes(`value="${target.sku}"`), 'the search box lost its term');
    });
  });

  describe('warehouse stock', () => {
    test('a SKU finds its stock rows', async () => {
      const { body } = await get('/stock', 'q=SIC-1001');

      assert.ok(shownCount(body).matched > 0);
      assert.ok(rowsOf(body).every((row) => row.includes('SIC-1001')));
    });

    test('a warehouse name finds that site stock', async () => {
      const site = WAREHOUSES[0];
      const { body } = await get('/stock', `q=${encodeURIComponent(site.name)}`);
      const matched = shownCount(body).matched;

      assert.ok(matched > 0, `searching "${site.name}" found no stock - warehouse is not searched`);

      const filtered = shownCount((await get('/stock', `warehouse=${site.id}`)).body).matched;
      assert.equal(matched, filtered, 'searching a site disagrees with filtering to it');
    });

    test('a partial warehouse name matches', async () => {
      const site = WAREHOUSES[0];
      const fragment = site.name.slice(0, 4);
      const { body } = await get('/stock', `q=${encodeURIComponent(fragment)}`);
      assert.ok(shownCount(body).matched > 0, `"${fragment}" matched no stock`);
    });

    test('search is case-insensitive', async () => {
      const site = WAREHOUSES[0];
      const lower = shownCount(
        (await get('/stock', `q=${encodeURIComponent(site.name.toLowerCase())}`)).body,
      ).matched;
      const upper = shownCount(
        (await get('/stock', `q=${encodeURIComponent(site.name.toUpperCase())}`)).body,
      ).matched;

      assert.ok(lower > 0);
      assert.equal(lower, upper);
    });

    test('a term matching nothing returns nothing', async () => {
      const { body } = await get('/stock', 'q=zzz-no-such-shelf-zzz');
      assert.equal(shownCount(body).matched, 0);
      assert.equal(rowsOf(body).length, 0);
    });

    test('search narrows alongside the warehouse and status filters', async () => {
      const site = WAREHOUSES[0];
      const base = shownCount((await get('/stock', `warehouse=${site.id}`)).body).matched;
      const both = await get('/stock', `warehouse=${site.id}&q=SIC-1001`);

      assert.ok(shownCount(both.body).matched > 0);
      assert.ok(shownCount(both.body).matched <= base, 'search widened the filtered set');
      assert.ok(both.body.includes('value="SIC-1001"'), 'the search box lost its term');
    });
  });

  describe('alerts', () => {
    test('an issue type is searchable as free text', async () => {
      const { body } = await get('/alerts', 'q=Negative+Inventory');
      const types = new Set(renderedIssueTypes(body));

      assert.ok(shownCount(body).matched > 0, 'searching an issue type found nothing');
      assert.deepEqual([...types], ['Negative Inventory']);
    });

    test('a SKU finds the issues raised against it', async () => {
      const { body } = await get('/alerts', 'q=SIC-3003');
      assert.ok(shownCount(body).matched > 0);
      assert.ok(rowsOf(body).every((row) => row.includes('SIC-3003')));
    });

    test('a warehouse name finds that site issues', async () => {
      const { body } = await get('/alerts', 'q=Manchester');

      assert.ok(shownCount(body).matched > 0, 'searching a warehouse name found no issues');
      assert.ok(rowsOf(body).every((row) => row.includes('Manchester North')));
    });

    test('the reason text is searchable', async () => {
      const { body } = await get('/alerts', 'q=below+zero');
      assert.ok(shownCount(body).matched > 0, 'the reason column is not searched');
    });

    test('search is case-insensitive and partial', async () => {
      const exact = shownCount((await get('/alerts', 'q=Negative+Inventory')).body).matched;
      const lower = shownCount((await get('/alerts', 'q=negative+inventory')).body).matched;
      const partial = shownCount((await get('/alerts', 'q=negativ')).body).matched;

      assert.equal(exact, lower);
      assert.ok(partial >= exact, 'a partial term matched fewer rows than the whole one');
    });

    test('a term matching nothing returns nothing', async () => {
      const { body } = await get('/alerts', 'q=zzz-no-such-issue-zzz');
      assert.equal(shownCount(body).matched, 0);
      assert.equal(renderedIssueTypes(body).length, 0);
    });

    test('search narrows alongside the issue-type filter', async () => {
      const typeOnly = shownCount((await get('/alerts', 'type=Negative+Inventory')).body).matched;
      const both = await get('/alerts', 'type=Negative+Inventory&q=SIC-3003');

      assert.ok(shownCount(both.body).matched > 0);
      assert.ok(shownCount(both.body).matched <= typeOnly, 'search widened the filtered set');
      assert.match(both.body, /<option value="Negative Inventory" selected>/);
      assert.ok(both.body.includes('value="SIC-3003"'), 'the search box lost its term');
    });

    test('a search term with regex metacharacters is treated literally', async () => {
      const everything = shownCount((await get('/alerts')).body).matched;

      // Terms that no row contains as literal text, but which a regular
      // expression would match almost every row with. Matching nothing is the
      // proof that the term is not being compiled into a pattern.
      for (const term of ['.*', '[a-z', '.+', '^N']) {
        const { status, body } = await get('/alerts', `q=${encodeURIComponent(term)}`);

        assert.equal(status, 200, `searching ${JSON.stringify(term)} did not render`);
        assert.equal(
          shownCount(body).matched,
          0,
          `${JSON.stringify(term)} was treated as a pattern, not literal text`,
        );
      }

      // Terms that are invalid regular expressions. A regex engine would throw
      // on these; a substring test simply reports what it finds. The only
      // requirement is that the page renders and does not match the whole set.
      for (const term of ['(', '\\', '++', '?', '[']) {
        const { status, body } = await get('/alerts', `q=${encodeURIComponent(term)}`);

        assert.equal(status, 200, `searching ${JSON.stringify(term)} did not render`);
        assert.ok(
          shownCount(body).matched < everything,
          `${JSON.stringify(term)} matched everything`,
        );
      }
    });
  });
});

/*
 * SEARCH RUNS BEFORE PAGINATION, NOT AFTER IT
 *
 * The required order is:
 *
 *   real data -> filter/search -> sort -> take a 200-row page -> render
 *
 * and NOT:
 *
 *   real data -> take the first 200 -> search those 200
 *
 * The difference is invisible on a small dataset, so these cases build a source
 * of 250 matching records - more than one page - plus decoys, and then search
 * for something that only exists BEYOND the first page. If the search ran after
 * the page window, those cases would return nothing.
 */
describe('search runs over the whole set, before the page window', () => {
  const MATCHING = 250;
  // Named so it shares no text with the product token being searched for -
  // otherwise every row would match 'kettle' through its warehouse name.
  const SITE = { id: 'W1', name: 'Leeds Depot', location: 'Leeds' };

  const products = [];
  const stockLines = [];

  // 250 products whose name carries a shared token, each holding negative
  // stock, so each also raises exactly one issue.
  for (let i = 0; i < MATCHING; i += 1) {
    const sku = `KET-${String(i).padStart(3, '0')}`;
    products.push({
      sku,
      name: `Copper Kettle Shade ${i}`,
      image: null,
      category: 'Kitchenware',
      supplier: 'Brassware Supply Co',
      active: true,
      endOfLineStatus: null,
      unitsSoldLast90Days: 100,
      approvedWarehouses: null,
    });
    stockLines.push({ sku, warehouseId: 'W1', onHand: -1, reserved: 0 });
  }

  // Decoys sharing none of the searchable text.
  for (let i = 0; i < 5; i += 1) {
    const sku = `ZZZ-${i}`;
    products.push({
      sku,
      name: `Unrelated Lamp ${i}`,
      image: null,
      category: 'Lighting',
      supplier: 'Other Supplier',
      active: true,
      endOfLineStatus: null,
      unitsSoldLast90Days: 100,
      approvedWarehouses: null,
    });
    stockLines.push({ sku, warehouseId: 'W1', onHand: -1, reserved: 0 });
  }

  // A SKU that sorts late, so it is NOT on page one of any unfiltered list.
  const DEEP_SKU = 'KET-240';

  before(() =>
    useSource(
      memorySource({
        products,
        warehouses: [SITE],
        stockLines,
        transfers: [],
        auditCounts: [],
      }),
    ),
  );

  after(() =>
    useSource(
      memorySource({
        products: PRODUCTS,
        warehouses: WAREHOUSES,
        stockLines: STOCK_LINES,
        transfers: TRANSFERS,
        auditCounts: AUDIT_COUNTS,
      }),
    ),
  );

  for (const [screen, path, noun] of [
    ['products', '/products', 'products'],
    ['warehouse stock', '/stock', 'stock lines'],
    ['alerts', '/alerts', 'issues'],
  ]) {
    describe(screen, () => {
      test('a record beyond page one is still found', async () => {
        // The proof. KET-240 sits past the 200-row window of the unfiltered
        // list, so a search applied to the visible page could never find it.
        const unfiltered = await get(path);
        assert.ok(!unfiltered.body.includes(DEEP_SKU), `${DEEP_SKU} is already on page one`);

        const { body } = await get(path, `q=${DEEP_SKU}`);
        assert.equal(shownCount(body).matched, 1, `${DEEP_SKU} was not found by search`);
        assert.ok(body.includes(DEEP_SKU));
      });

      test('a term matching more than one page reports the full count', async () => {
        const { body } = await get(path, 'q=kettle');

        assert.equal(
          shownCount(body).matched,
          MATCHING,
          'the count is the page, not the whole matching set',
        );
        assert.equal(shownCount(body).shown, 200, 'page one is not a full page');
        assert.match(body, /showing 1–200 of 250/);
      });

      test('paging through a search reaches every match, and only matches', async () => {
        let seen = 0;
        let page = 1;

        for (;;) {
          const { status, body } = await get(path, `q=kettle&page=${page}`);
          assert.equal(status, 200, `page ${page} did not render`);

          const tbody = body.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
          const rows = tbody.split('<tr').slice(1);
          seen += rows.length;

          for (const row of rows) {
            assert.ok(!row.includes('ZZZ-'), 'a non-matching decoy appeared in the results');
          }

          if (!body.includes('rel="next"')) break;
          page += 1;
          assert.ok(page < 10, 'pager did not terminate');
        }

        assert.equal(seen, MATCHING, 'paging a search did not reach every match');
      });

      test('the pager carries the search term', async () => {
        const { body } = await get(path, 'q=kettle');
        const next = body.match(/rel="next" href="([^"]+)"/)?.[1].replaceAll('&amp;', '&');

        assert.ok(next, 'a 250-match search offers no next page');
        assert.ok(next.includes('q=kettle'), 'the next link drops the search term');

        const url = new URL(next, 'http://localhost');
        const second = await route(url.pathname, url.searchParams);

        assert.equal(shownCount(second.body).matched, MATCHING, 'page two lost the search');
        assert.ok(second.body.includes('value="kettle"'), 'page two lost the search box value');
      });

      test('the search box keeps its term so the screen matches the list', async () => {
        const { body } = await get(path, 'q=kettle');
        assert.ok(body.includes('value="kettle"'), 'the search box came back empty');
      });

      void noun;
    });
  }

  test('products: searching a category reaches past page one', async () => {
    const { body } = await get('/products', 'q=Kitchenware');
    assert.equal(shownCount(body).matched, MATCHING);
  });

  test('stock: searching the warehouse name reaches past page one', async () => {
    const { body } = await get('/stock', 'q=Leeds Depot');
    assert.equal(shownCount(body).matched, MATCHING + 5, 'every line is at that site');
  });

  test('alerts: searching an issue type reaches past page one', async () => {
    const { body } = await get('/alerts', 'q=Negative Inventory');
    assert.equal(shownCount(body).matched, MATCHING + 5);
  });

  test('alerts: search and the issue-type filter narrow together across pages', async () => {
    const { body } = await get('/alerts', 'q=kettle&type=Negative+Inventory');

    assert.equal(shownCount(body).matched, MATCHING);
    assert.match(body, /<option value="Negative Inventory" selected>/);

    const next = body.match(/rel="next" href="([^"]+)"/)?.[1].replaceAll('&amp;', '&');
    assert.ok(next.includes('q=kettle'), 'the next link drops the search');
    assert.ok(next.includes('type=Negative'), 'the next link drops the type filter');
  });
});

/* ========================================================================== */
/* The filter bar                                                             */
/* ========================================================================== */

/**
 * The bug staff reported, and the rule that replaces it.
 *
 * Choosing Status used to grey out Warehouse from, Warehouse to and the search
 * box: /filters.js disabled every control still sitting at "All" before
 * submitting, and never put them back. Nothing was cascading and nothing was
 * restricting the options - the choices were there, they had simply been
 * switched off in the page.
 *
 * So these tests are about one property, checked from both ends: applying a
 * filter must leave every other filter exactly as usable, and as fully stocked
 * with options, as it was before.
 */
describe('the filter bar keeps every filter usable', () => {
  /** The filter bar of a rendered screen. */
  const barOf = (body) => body.match(/<form class="filters"[\s\S]*?<\/form>/)[0];

  /** Every dropdown in a filter bar, as name -> the option values it offers. */
  function dropdowns(body) {
    const bar = barOf(body);
    const found = {};

    for (const select of bar.matchAll(/<select id="[^"]*" name="([^"]+)">([\s\S]*?)<\/select>/g)) {
      found[select[1]] = [...select[2].matchAll(/<option value="([^"]*)"/g)].map((o) => o[1]);
    }

    return found;
  }

  /** The search inputs in a filter bar, as name -> value. */
  function searches(body) {
    const bar = barOf(body);
    const found = {};

    for (const input of bar.matchAll(/<input type="search" id="[^"]*" name="([^"]+)" value="([^"]*)"/g)) {
      found[input[1]] = input[2];
    }

    return found;
  }

  // Every list screen, and a filter on each that is worth applying.
  const SCREENS = [
    ['/products', 'stock=Low+Stock'],
    ['/stock', 'warehouse=WH-BIR'],
    ['/alerts', 'type=Out+of+Stock'],
    ['/transfers', 'status=Received'],
    ['/audit', 'show=discrepancy'],
  ];

  for (const [path, applied] of SCREENS) {
    describe(path, () => {
      test('no control in the bar is ever disabled', async () => {
        for (const query of ['', applied, `${applied}&q=SIC`]) {
          const bar = barOf((await get(path, query)).body);
          assert.equal(bar.includes('disabled'), false, `${path}?${query} disables a control`);
        }
      });

      test('applying one filter leaves every other dropdown fully stocked', async () => {
        // No cascading. The options a dropdown offers come from the whole data
        // set and must not shrink because something else was selected.
        const before = dropdowns((await get(path)).body);
        const after = dropdowns((await get(path, applied)).body);

        assert.deepEqual(Object.keys(after), Object.keys(before), 'a dropdown disappeared');

        for (const [name, options] of Object.entries(before)) {
          assert.deepEqual(after[name], options, `the ${name} dropdown lost options`);
        }
      });

      test('the bar carries no page number, so changing a filter starts at page one', async () => {
        // The form is what a changed filter submits. A hidden page field here
        // would carry the reader to page 7 of a list that now has two pages.
        const bar = barOf((await get(path, `${applied}&page=2`)).body);
        assert.equal(/name="page"/.test(bar), false, 'the filter bar would carry a page number');
      });

      test('carries an Apply button, so the bar still works without JavaScript', async () => {
        const bar = barOf((await get(path)).body);
        assert.match(bar, /<button type="submit" class="apply">Apply<\/button>/);
      });

      test('the bar is a plain GET form pointing at its own screen', async () => {
        const bar = barOf((await get(path)).body);
        assert.ok(bar.startsWith(`<form class="filters" method="get" action="${path}"`));
      });

      test('offers Clear filters once something is applied, and not before', async () => {
        assert.equal(barOf((await get(path)).body).includes('Clear filters'), false);
        assert.match(barOf((await get(path, applied)).body), /Clear filters<\/a>/);
      });

      test('"All" is the first option of every dropdown and means no filter', async () => {
        const unfiltered = shownCount((await get(path)).body);

        for (const [name, options] of Object.entries(dropdowns((await get(path)).body))) {
          assert.equal(options[0], '', `the ${name} dropdown has no All option first`);

          // Selecting All explicitly is the same screen as not selecting it.
          const explicit = shownCount((await get(path, `${name}=`)).body);
          assert.equal(explicit.matched, unfiltered.matched, `an empty ${name} narrowed the screen`);
        }
      });

      test('an unrecognised filter value shows the whole screen, not an empty one', async () => {
        for (const name of Object.keys(dropdowns((await get(path)).body))) {
          const { matched, total } = shownCount((await get(path, `${name}=not-a-real-value`)).body);
          assert.equal(matched, total, `a junk ${name} emptied the screen`);
        }
      });
    });
  }

  test('a search term is kept in the box, and kept when another filter is applied', async () => {
    for (const [path, applied] of SCREENS) {
      const searched = searches((await get(path, 'q=SIC')).body);
      if (Object.keys(searched).length === 0) continue;

      assert.equal(searched.q, 'SIC', `${path} forgot the search term`);

      const both = searches((await get(path, `q=SIC&${applied}`)).body);
      assert.equal(both.q, 'SIC', `${path} dropped the search when a filter was applied`);
    }
  });
});

describe('filters combine, and pagination keeps them', () => {
  // One case per screen: two or more conditions that must all hold at once.
  const CASES = [
    {
      path: '/products',
      query: 'q=SIC&category=Bulbs&stock=Healthy',
      mustHold: (row) =>
        row.includes('SIC-') && row.includes('>Bulbs<') && row.includes('>Healthy<'),
    },
    {
      path: '/stock',
      query: 'q=SIC&warehouse=WH-BIR&status=Low+Stock',
      mustHold: (row) => row.includes('Birmingham Central') && row.includes('>Low Stock<'),
    },
    {
      path: '/alerts',
      query: 'q=SIC&type=Out+of+Stock&warehouse=WH-BIR',
      mustHold: (row) => row.includes('Birmingham Central') && row.includes('>Out of Stock<'),
    },
    {
      path: '/transfers',
      query: 'q=SIC&status=Received&from=WH-BIR&to=WH-MAN',
      mustHold: (row) =>
        row.includes('Birmingham Central') &&
        row.includes('Manchester North') &&
        row.includes('>Received<'),
    },
  ];

  for (const { path, query, mustHold } of CASES) {
    test(`${path}: every row satisfies every condition at once`, async () => {
      const all = shownCount((await get(path)).body).total;
      const { body } = await get(path, query);
      const { matched } = shownCount(body);

      assert.ok(matched > 0, `${path}?${query} matches nothing`);
      assert.ok(matched < all, `${path}?${query} narrows nothing`);

      const rows = tableRows(body);
      assert.ok(rows.length > 0, 'no rows were rendered');
      for (const row of rows) {
        assert.ok(mustHold(row), `a row on ${path}?${query} does not satisfy every filter`);
      }
    });

    test(`${path}: dropping one condition never narrows the result`, async () => {
      // Proof that each condition is doing its own work, rather than one of
      // them quietly deciding the whole result.
      const parts = query.split('&');
      const full = shownCount((await get(path, query)).body).matched;

      for (let i = 0; i < parts.length; i += 1) {
        const without = parts.filter((_, index) => index !== i).join('&');
        const widened = shownCount((await get(path, without)).body).matched;

        assert.ok(widened >= full, `dropping ${parts[i]} on ${path} narrowed the result`);
      }
    });

    test(`${path}: the pager carries every filter and the search`, async () => {
      const { body } = await get(path, `${query}&page=1`);
      const next = body.match(/rel="next" href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');

      // Not every fixture screen runs to a second page; when one does, the
      // link must carry the whole filter set rather than the page alone.
      if (!next) return;

      for (const part of query.split('&')) {
        assert.ok(next.includes(part), `the next link on ${path} dropped ${part}`);
      }
    });

    test(`${path}: a page beyond the end lands on a real page, not an error`, async () => {
      const { status, body } = await get(path, `${query}&page=999`);
      assert.equal(status, 200);
      assert.ok(shownCount(body).matched >= 0);
    });

    test(`${path}: a term matching nothing empties the screen and says so`, async () => {
      // The term REPLACES the one already in the query - a repeated
      // parameter takes the first value, so appending would search for the
      // original term again.
      const missing = query.replace(/(^|&)q=[^&]*/, '').replace(/^&/, '');
      const { body } = await get(path, `${missing}&q=zzzznothinghere`);

      assert.equal(shownCount(body).matched, 0);
      assert.ok(body.includes('zzzznothinghere'), 'the empty state does not quote the term');
      assert.equal(body.includes('<tbody>'), false, 'an empty result still rendered a table');

      // And the bar is still there and still usable, so the reader can get
      // back out again.
      assert.match(body, /<form class="filters"/);
      const bar = body.match(/<form class="filters"[\s\S]*?<\/form>/)[0];
      assert.equal(bar.includes('disabled'), false, 'the empty screen disabled the filters');
    });
  }
});

describe('transfers search runs over the whole set, before the page window', () => {
  const MATCHING = 250;
  const SITE_A = { id: 'W1', name: 'Leeds Depot', location: 'Leeds' };
  const SITE_B = { id: 'W2', name: 'Hull Annexe', location: 'Hull' };

  const products = [];
  const transfers = [];

  for (let i = 0; i < MATCHING; i += 1) {
    const sku = `MOV-${String(i).padStart(3, '0')}`;
    products.push({
      sku,
      name: `Copper Kettle Shade ${i}`,
      image: null,
      category: 'Kitchenware',
      supplier: 'Brassware Supply Co',
      active: true,
      endOfLineStatus: null,
      unitsSoldLast90Days: 100,
      approvedWarehouses: null,
    });
    transfers.push({
      id: `TR-BULK${String(i).padStart(3, '0')}`,
      sku,
      fromWarehouseId: 'W1',
      toWarehouseId: 'W2',
      quantity: 10,
      quantityOut: 10,
      quantityIn: 10,
      status: 'Received',
      raisedOn: '2026-01-01',
      recordedBy: 'mithusha',
      note: 'bulk move',
    });
  }

  // Decoys sharing none of the searchable text.
  for (let i = 0; i < 5; i += 1) {
    const sku = `ZZZ-${i}`;
    products.push({
      sku,
      name: `Unrelated Lamp ${i}`,
      image: null,
      category: 'Lighting',
      supplier: 'Other Supplier',
      active: true,
      endOfLineStatus: null,
      unitsSoldLast90Days: 100,
      approvedWarehouses: null,
    });
    transfers.push({
      id: `TR-OTHER${i}`,
      sku,
      fromWarehouseId: 'W2',
      toWarehouseId: 'W1',
      quantity: 1,
      quantityOut: 1,
      quantityIn: 1,
      status: 'Received (Adjusted)',
      raisedOn: '2026-01-02',
      recordedBy: 'someone',
      note: 'unrelated',
    });
  }

  /** A movement that sorts past the 200-row window of the unfiltered list. */
  const DEEP_SKU = 'MOV-240';

  before(() =>
    useSource(
      memorySource({
        products,
        warehouses: [SITE_A, SITE_B],
        stockLines: [],
        transfers,
        auditCounts: [],
      }),
    ),
  );

  after(() =>
    useSource(
      memorySource({
        products: PRODUCTS,
        warehouses: WAREHOUSES,
        stockLines: STOCK_LINES,
        transfers: TRANSFERS,
        auditCounts: AUDIT_COUNTS,
      }),
    ),
  );

  test('a movement beyond page one is still found', async () => {
    const unfiltered = await get('/transfers');
    assert.ok(!unfiltered.body.includes(DEEP_SKU), `${DEEP_SKU} is already on page one`);

    const { body } = await get('/transfers', `q=${DEEP_SKU}`);
    assert.equal(shownCount(body).matched, 1, `${DEEP_SKU} was not found by search`);
    assert.ok(body.includes(DEEP_SKU));
  });

  test('a term matching more than one page reports the full count', async () => {
    const { body } = await get('/transfers', 'q=kettle');

    assert.equal(shownCount(body).matched, MATCHING, 'the count is the page, not the matching set');
    assert.equal(shownCount(body).shown, 200, 'page one is not a full page');
  });

  test('paging through a search reaches every match, and only matches', async () => {
    let seen = 0;
    let page = 1;

    for (;;) {
      const { status, body } = await get('/transfers', `q=kettle&page=${page}`);
      assert.equal(status, 200, `page ${page} did not render`);

      const rows = tableRows(body);
      seen += rows.length;

      for (const row of rows) {
        assert.ok(!row.includes('ZZZ-'), 'a non-matching decoy appeared in the results');
      }

      if (!body.includes('rel="next"')) break;
      page += 1;
      assert.ok(page < 10, 'pager did not terminate');
    }

    assert.equal(seen, MATCHING, 'paging a search did not reach every match');
  });

  test('the pager carries the search, the status and both warehouses', async () => {
    const { body } = await get('/transfers', 'q=kettle&status=Received&from=W1&to=W2');
    const next = body.match(/rel="next" href="([^"]+)"/)?.[1].replaceAll('&amp;', '&');

    assert.ok(next, 'a 250-match search offers no next page');
    for (const part of ['q=kettle', 'status=Received', 'from=W1', 'to=W2']) {
      assert.ok(next.includes(part), `the next link dropped ${part}`);
    }
  });

  test('search and filters together still narrow the whole set', async () => {
    const both = shownCount((await get('/transfers', 'q=kettle&from=W1&to=W2&status=Received')).body);

    assert.equal(both.matched, MATCHING);
    assert.equal(both.total, transfers.length);
    assert.ok(both.matched < both.total, 'the decoys were not excluded');
  });
});
