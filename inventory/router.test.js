/**
 * Tests for routing and filtering.
 *
 * route() is a pure function of path and query, so every screen is exercised
 * here without opening a socket.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { route } from './router.js';
import { NAV_ITEMS } from './render.js';
import { ISSUE_TYPES } from './rules.js';
import { dashboardMetrics } from './reports.js';

/** Fetch a screen, optionally with a query string. */
function get(path, query = '') {
  return route(path, new URLSearchParams(query));
}

/** The "N of M" line a screen prints above its table. */
function shownCount(body) {
  const match = body.match(/<p class="count">([^<]*)</);
  assert.ok(match, 'the page has no count line');
  const numbers = match[1].match(/^(\d+)(?: of (\d+))?/);
  return { shown: Number(numbers[1]), total: Number(numbers[2] ?? numbers[1]) };
}

describe('every navigation link resolves', () => {
  for (const item of NAV_ITEMS) {
    test(`${item.path} returns a page`, () => {
      const response = get(item.path);
      assert.equal(response.status, 200, `${item.path} did not return 200`);
      assert.equal(response.contentType, 'text/html; charset=utf-8');
      assert.match(response.body, /^<!doctype html>/);
    });
  }

  test('there are no other links in the page shell to follow', () => {
    // Every href the dashboard offers must itself resolve, so no tile or
    // drill-through can become a dead end.
    const { body } = get('/');
    const hrefs = [...body.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    for (const href of hrefs) {
      const url = new URL(href.replaceAll('&amp;', '&'), 'http://localhost');
      const response = route(url.pathname, url.searchParams);
      assert.equal(response.status, 200, `${href} is a dead link`);
    }
  });
});

describe('dashboard', () => {
  test('shows all six figures', () => {
    const { body } = get('/');
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

  test('the figures on the page are the figures the reports produce', () => {
    const { body } = get('/');
    const metrics = dashboardMetrics();

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

  test('lists all six issue types', () => {
    const { body } = get('/');
    for (const type of ISSUE_TYPES) {
      assert.ok(body.includes(type), `the dashboard does not mention ${type}`);
    }
  });

  test('lists all three transfer statuses', () => {
    const { body } = get('/');
    for (const status of ['Pending', 'In Transit', 'Received']) {
      assert.ok(body.includes(status), `the dashboard does not mention ${status}`);
    }
  });
});

describe('products screen', () => {
  test('shows the required columns', () => {
    const { body } = get('/products');
    for (const heading of ['SKU', 'Product Name', 'Category', 'Supplier', 'Image']) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('renders a thumbnail per product', () => {
    const { body } = get('/products');
    assert.ok(body.includes('src="/images/SIC-1001.svg"'));
  });

  test('filters by category', () => {
    const { body } = get('/products', 'category=Bulbs');
    const { shown, total } = shownCount(body);
    assert.ok(shown > 0 && shown < total, 'the category filter changed nothing');
  });

  test('filters by supplier', () => {
    const { body } = get('/products', 'supplier=Verity+Home+Fittings');
    const { shown, total } = shownCount(body);
    assert.ok(shown > 0 && shown < total);
  });

  test('searches SKU, name and supplier', () => {
    assert.ok(shownCount(get('/products', 'q=SIC-1001').body).shown === 1);
    assert.ok(shownCount(get('/products', 'q=tripod').body).shown === 1);
    assert.ok(shownCount(get('/products', 'q=northgate').body).shown > 1);
  });

  test('search is case-insensitive', () => {
    assert.equal(
      shownCount(get('/products', 'q=AURORA').body).shown,
      shownCount(get('/products', 'q=aurora').body).shown,
    );
  });

  test('an unmatched search shows an empty state, not a broken table', () => {
    const { body } = get('/products', 'q=zzzznothing');
    assert.equal(shownCount(body).shown, 0);
    assert.match(body, /No products match these filters/);
  });

  test('flags the SKU that stock points at but the catalogue does not hold', () => {
    const { body } = get('/products');
    assert.ok(body.includes('SIC-9999'));
  });
});

describe('warehouse stock screen', () => {
  test('shows the required columns', () => {
    const { body } = get('/stock');
    for (const heading of ['SKU', 'Warehouse', 'Current', 'Reserved', 'Available', 'Minimum']) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('filters by warehouse', () => {
    const { body } = get('/stock', 'warehouse=WH-BIR');
    const { shown, total } = shownCount(body);
    assert.ok(shown > 0 && shown < total);
  });

  test('filters by each health band, and the bands add up to the whole', () => {
    const total = shownCount(get('/stock').body).total;
    const bands = ['Healthy', 'Low Stock', 'Out of Stock', 'Negative Inventory'];
    const summed = bands.reduce(
      (sum, band) => sum + shownCount(get('/stock', `status=${encodeURIComponent(band)}`).body).shown,
      0,
    );
    assert.equal(summed, total);
  });

  test('shows a negative quantity as negative rather than hiding it', () => {
    const { body } = get('/stock', 'status=Negative+Inventory');
    assert.match(body, /class="neg">-6</);
  });

  test('an unrecognised filter value shows everything rather than nothing', () => {
    const { shown, total } = shownCount(get('/stock', 'status=Nonsense').body);
    assert.equal(shown, total);
  });
});

describe('alerts screen', () => {
  test('shows every issue type when unfiltered', () => {
    const { body } = get('/alerts');
    for (const type of ISSUE_TYPES) {
      assert.ok(body.includes(type), `the alerts screen never shows ${type}`);
    }
  });

  test('each issue type can be filtered to on its own, and each has rows', () => {
    for (const type of ISSUE_TYPES) {
      const { body } = get('/alerts', `type=${encodeURIComponent(type)}`);
      const { shown } = shownCount(body);
      assert.ok(shown > 0, `filtering to ${type} shows nothing`);
    }
  });

  test('the per-type counts add up to the unfiltered list', () => {
    const total = shownCount(get('/alerts').body).total;
    const summed = ISSUE_TYPES.reduce(
      (sum, type) => sum + shownCount(get('/alerts', `type=${encodeURIComponent(type)}`).body).shown,
      0,
    );
    assert.equal(summed, total);
  });

  test('filters by warehouse', () => {
    const { shown, total } = shownCount(get('/alerts', 'warehouse=WH-MAN').body);
    assert.ok(shown > 0 && shown < total);
  });

  test('names the SKU and the warehouse on the row', () => {
    const { body } = get('/alerts', 'type=Negative+Inventory');
    assert.ok(body.includes('SIC-3003'), 'the affected SKU is not shown');
    assert.ok(body.includes('Manchester North'), 'the affected warehouse is not shown');
  });
});

describe('transfers screen', () => {
  test('shows the required columns', () => {
    const { body } = get('/transfers');
    for (const heading of ['Transfer ID', 'SKU', 'Product', 'From', 'To', 'Qty', 'Status']) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('each of the three statuses can be filtered to, and each has rows', () => {
    for (const status of ['Pending', 'In Transit', 'Received']) {
      const { shown } = shownCount(get('/transfers', `status=${encodeURIComponent(status)}`).body);
      assert.ok(shown > 0, `no transfer is ${status}`);
    }
  });

  test('the three statuses add up to every transfer', () => {
    const total = shownCount(get('/transfers').body).total;
    const summed = ['Pending', 'In Transit', 'Received'].reduce(
      (sum, status) =>
        sum + shownCount(get('/transfers', `status=${encodeURIComponent(status)}`).body).shown,
      0,
    );
    assert.equal(summed, total);
  });

  test('the source and the destination are filtered separately', () => {
    // One filter for what is leaving a site, another for what is arriving, so
    // a site's outbound and inbound moves can be asked about on their own.
    const out = shownCount(get('/transfers', 'from=WH-BIR').body);
    const into = shownCount(get('/transfers', 'to=WH-BIR').body);

    assert.ok(out.shown > 0 && out.shown < out.total, 'nothing leaves Birmingham');
    assert.ok(into.shown > 0 && into.shown < into.total, 'nothing arrives at Birmingham');
    assert.notEqual(out.shown, into.shown, 'the two directions cannot be told apart');
  });

  test('source and destination narrow together, naming one leg of a move', () => {
    const out = shownCount(get('/transfers', 'from=WH-BIR').body);
    const leg = shownCount(get('/transfers', 'from=WH-BIR&to=WH-MAN').body);

    assert.ok(leg.shown > 0 && leg.shown <= out.shown);
  });
});

describe('inventory audit screen', () => {
  test('shows the required columns', () => {
    const { body } = get('/audit');
    for (const heading of ['SKU', 'Warehouse', 'System Qty', 'Counted Qty', 'Difference']) {
      assert.ok(body.includes(heading), `missing column ${heading}`);
    }
  });

  test('shows a shortage and an overage with their signs', () => {
    const { body } = get('/audit');
    assert.match(body, />-3</, 'no shortage is shown');
    assert.match(body, />\+4</, 'no overage is shown');
  });

  test('the discrepancies-only filter keeps only the lines that disagree', () => {
    const { shown, total } = shownCount(get('/audit', 'difference=yes').body);
    assert.ok(shown > 0 && shown < total);
    assert.equal(shown, dashboardMetrics().discrepancies);
  });

  test('filters by warehouse', () => {
    const { shown, total } = shownCount(get('/audit', 'warehouse=WH-BIR').body);
    assert.ok(shown > 0 && shown < total);
  });
});

describe('thumbnail route', () => {
  test('serves an SVG for a catalogued SKU', () => {
    const response = get('/images/SIC-1001.svg');
    assert.equal(response.status, 200);
    assert.equal(response.contentType, 'image/svg+xml; charset=utf-8');
    assert.match(response.body, /<svg/);
  });

  test('serves a placeholder rather than failing for an unknown SKU', () => {
    const response = get('/images/SIC-9999.svg');
    assert.equal(response.status, 200);
    assert.match(response.body, /<svg/);
  });

  test('a path-traversal attempt is treated as a SKU lookup, not a file read', () => {
    const response = get('/images/..%2F..%2Fpackage.json.svg');
    assert.equal(response.status, 200);
    assert.match(response.body, /<svg/);
    assert.equal(response.body.includes('smart-inventory-control'), false);
  });
});

describe('unknown paths', () => {
  test('return 404 with a usable page', () => {
    const response = get('/nope');
    assert.equal(response.status, 404);
    assert.match(response.body, /does not exist/);
  });

  test('a trailing slash is tolerated rather than 404ing', () => {
    assert.equal(get('/products/').status, 200);
  });
});
