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
import { memorySource, useSource } from './store.js';
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
  const capped = text.match(/^showing (\d+) of (\d+)/);
  const plain = text.match(/^(\d+)/);
  const outOf = text.match(/out of (\d+)/);

  const shown = Number(capped ? capped[1] : plain[1]);
  const matched = Number(capped ? capped[2] : plain[1]);

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
      'Pending Transfers',
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
      metrics.pendingTransfers,
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
    assert.deepEqual(counts.map((row) => row.status), ['Pending', 'In Transit', 'Received']);

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

    assert.equal(links.length, 9, 'expected six issue links and three transfer links');

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
      ['/transfers?status=Pending', metrics.pendingTransfers],
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
      '/transfers?status=Pending',
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
    assert.match(body, /No products match these filters/);
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
    for (const heading of ['Transfer ID', 'SKU', 'Product', 'From', 'To', 'Qty', 'Status']) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('each of the three statuses can be filtered to, and each has rows', async () => {
    for (const status of ['Pending', 'In Transit', 'Received']) {
      const { shown } = shownCount((await get('/transfers', `status=${encodeURIComponent(status)}`)).body);
      assert.ok(shown > 0, `no transfer is ${status}`);
    }
  });

  test('the three statuses add up to every transfer', async () => {
    const total = shownCount((await get('/transfers')).body).total;
    let summed = 0;
    for (const status of ['Pending', 'In Transit', 'Received']) {
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
