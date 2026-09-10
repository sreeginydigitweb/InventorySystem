/**
 * Tests for the record screens: view, add, edit and delete over the routes.
 *
 * route() and routeForm() are both pure functions of what they are handed, so a
 * whole workflow - open the form, post it, look at the list afterwards - runs
 * here without a socket.
 *
 * These check three things the unit tests cannot:
 *
 *   the screens exist and show what they should
 *   a write through a route reaches the data, and a bad one comes back as the
 *     form with the values still in it
 *   the figures on the dashboard and the alerts screen follow the data, rather
 *     than being counted once and cached
 *
 * Run with: npm test
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { route, routeForm } from './router.js';
import { dashboardMetrics, issuesReport } from './reports.js';
import { ISSUE_TYPES } from './rules.js';
import { findAuditCount, findStockLine, findTransfer, issueAction, resetStore } from './store.js';
import { findProduct } from './data/products.js';

beforeEach(() => {
  resetStore();
});

/** GET a screen. */
function get(path) {
  const url = new URL(path, 'http://localhost');
  return route(url.pathname, url.searchParams);
}

/** POST a form. */
function post(path, fields) {
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) form.append(name, entry);
  }
  return routeForm(path, form);
}

/** The path a successful write redirected to, with the flash stripped off. */
function landedOn(response) {
  assert.equal(response.status, 303, `expected a redirect, got ${response.status}`);
  return response.location.split('?')[0];
}

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

/* ========================================================================== */

describe('the existing screens still work', () => {
  for (const path of ['/', '/products', '/stock', '/alerts', '/transfers', '/audit']) {
    test(`${path} still returns a page`, () => {
      const response = get(path);
      assert.equal(response.status, 200);
      assert.match(response.body, /^<!doctype html>/);
    });
  }

  test('the existing filters still work', () => {
    assert.equal(get('/stock?status=Low+Stock').status, 200);
    assert.equal(get('/products?category=Bulbs').status, 200);
    assert.equal(get('/audit?difference=only').status, 200);
    assert.equal(get('/transfers?status=Pending').status, 200);
  });

  test('the pages carry one same-origin script and no inline handler', () => {
    // The filter bar needs a script to apply itself without an Apply button.
    // That is the whole of the client-side code: one file, from this origin,
    // asserted here so a second script or an inline handler cannot creep in.
    for (const path of ['/products', '/products/add', '/stock/edit?sku=SIC-1001&warehouse=WH-BIR']) {
      const { body } = get(path);
      const tags = body.match(/<script[^>]*>/g) ?? [];

      assert.deepEqual(tags, ['<script src="/filters.js" defer>'], `${path} scripts`);
      assert.equal(body.includes('onclick'), false, `${path} has an inline handler`);
      assert.equal(body.includes('onsubmit'), false, `${path} has an inline handler`);
      assert.equal(body.includes('onchange'), false, `${path} has an inline handler`);
    }
  });

  test('the responsive shell is still on every new screen', () => {
    for (const path of ['/products/add', '/stock/view?sku=SIC-1001&warehouse=WH-BIR', '/audit/edit?id=AC-1001']) {
      const { body } = get(path);
      assert.match(body, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
      assert.match(body, /@media \(max-width: 767px\)/);
      assert.match(body, /@media \(max-width: 1023px\)/);
    }
  });

  test('every table on a record screen is inside a scroll container', () => {
    for (const path of ['/products/view?sku=SIC-1001', '/stock/view?sku=SIC-3003&warehouse=WH-MAN']) {
      const { body } = get(path);
      const tables = (body.match(/<table[\s>]/g) ?? []).length;
      const wrappers = (body.match(/<div class="table-scroll">/g) ?? []).length;
      assert.equal(tables, wrappers, `${path} has a table outside a scroll container`);
    }
  });
});

describe('the filter bar: plain dropdowns that apply themselves', () => {
  const SCREENS = ['/products', '/stock', '/alerts', '/transfers', '/audit'];

  /** The filter form on a screen. */
  const bar = (body) => body.match(/<form class="filters"[\s\S]*?<\/form>/)[0];

  /** Where the filter form submits to. */
  const action = (body) => bar(body).match(/action="([^"]+)"/)[1];

  /** Every named control in the filter bar, and what it is currently set to. */
  function controls(body) {
    const form = bar(body);
    const found = [];

    for (const block of form.split('<div class="field">').slice(1)) {
      const label = block.match(/<label class="caption"[^>]*>([^<]*)</)[1];
      const select = block.match(/<select id="[^"]*" name="([^"]+)">([\s\S]*?)<\/select>/);

      if (select) {
        const options = [...select[2].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)</g)].map((m) => ({
          value: m[1],
          selected: Boolean(m[2]),
          label: m[3],
        }));
        found.push({
          label,
          name: select[1],
          kind: 'select',
          options,
          value: (options.find((o) => o.selected) ?? { value: '' }).value,
        });
        continue;
      }

      const search = block.match(/<input type="search" id="[^"]*" name="([^"]+)" value="([^"]*)"/);
      if (search) found.push({ label, name: search[1], kind: 'search', value: search[2] });
    }

    return found;
  }

  /**
   * The URL a browser would land on after changing one control.
   *
   * This is what /filters.js causes: the whole form is submitted, so every
   * other control goes along at its current value, and the empty ones are
   * dropped so the URL stays readable.
   */
  function submitWith(body, changes) {
    const query = new URLSearchParams();

    for (const control of controls(body)) {
      const value = Object.hasOwn(changes, control.name) ? changes[control.name] : control.value;
      if (value !== '') query.append(control.name, value);
    }

    const search = query.toString();
    return search ? `${action(body)}?${search}` : action(body);
  }

  /** The "N of M" line a screen prints above its table. */
  const shown = (body) => (body.match(/<p class="count">([^<]*)</) ?? [])[1];

  /** What each dropdown is currently showing, as label: value. */
  const settings = (body) =>
    controls(body)
      .filter((control) => control.kind === 'select')
      .map((control) => `${control.label}=${control.value || 'All'}`);

  /* --- the controls are ordinary dropdowns -------------------------------- */

  test('every list screen filters with real <select> elements, and no chips', () => {
    const expected = {
      '/products': ['Search', 'Category', 'Supplier'],
      '/stock': ['Search', 'Warehouse', 'Status'],
      '/alerts': ['Issue type', 'Warehouse', 'Action status'],
      '/transfers': ['Status', 'Warehouse from', 'Warehouse to'],
      '/audit': ['Warehouse', 'Show'],
    };

    for (const [screen, labels] of Object.entries(expected)) {
      const { body } = get(screen);
      assert.deepEqual(controls(body).map((control) => control.label), labels, `${screen} filters`);
      assert.ok(bar(body).includes('<select'), `${screen} has no dropdown`);
      assert.match(bar(body), /method="get"/);
      assert.equal(/class="chip|<div class="chips">/.test(body), false, `${screen} still has chips`);
    }
  });

  test('every dropdown offers an All option, and it is the empty value', () => {
    const alls = {
      category: 'All categories',
      supplier: 'All suppliers',
      warehouse: 'All warehouses',
      status: 'All statuses',
      type: 'All issue types',
      action: 'All action statuses',
      from: 'All warehouses',
      to: 'All warehouses',
      difference: 'All lines',
    };

    for (const screen of SCREENS) {
      for (const control of controls(get(screen).body)) {
        if (control.kind !== 'select') continue;
        const first = control.options[0];
        assert.equal(first.value, '', `${screen} ${control.name}: the All option is not empty`);
        assert.equal(first.label, alls[control.name], `${screen} ${control.name}: All option label`);
      }
    }
  });

  test('no screen renders an Apply button, or any button in a filter bar', () => {
    for (const screen of [...SCREENS, '/', '/products/add', '/audit/edit?id=AC-1001']) {
      assert.equal(get(screen).body.includes('Apply'), false, `${screen} still says Apply`);
    }
    for (const screen of SCREENS) {
      assert.equal((bar(get(screen).body).match(/<button/g) ?? []).length, 0, `${screen} has a button`);
      assert.equal(bar(get(screen).body).includes('type="submit"'), false, `${screen} has a submit`);
    }
  });

  /* --- choosing applies, and the rest is preserved ------------------------ */

  test('choosing a category filters immediately', () => {
    const start = get('/products').body;
    assert.equal(shown(start), '14 products');

    const url = submitWith(start, { category: 'Bulbs' });

    assert.equal(url, '/products?category=Bulbs');
    assert.equal(shown(get(url).body), '3 of 14 products');
  });

  test('the chosen value comes back selected in the dropdown', () => {
    const body = get('/products?category=Bulbs').body;
    const category = controls(body).find((control) => control.name === 'category');

    assert.equal(category.value, 'Bulbs');
    assert.match(bar(body), /<option value="Bulbs" selected>Bulbs<\/option>/);
  });

  test('then choosing a supplier keeps the category', () => {
    const withCategory = get('/products?category=Bulbs').body;
    const url = submitWith(withCategory, { supplier: 'Halden Electrical Supplies' });

    assert.equal(url, '/products?category=Bulbs&supplier=Halden+Electrical+Supplies');
    assert.equal(shown(get(url).body), '2 of 14 products');
    assert.deepEqual(settings(get(url).body), ['Category=Bulbs', 'Supplier=Halden Electrical Supplies']);
  });

  test('changing the supplier keeps the category', () => {
    const both = get('/products?category=Bulbs&supplier=Halden+Electrical+Supplies').body;
    const url = submitWith(both, { supplier: 'Verity Home Fittings' });

    assert.match(url, /category=Bulbs/);
    assert.match(url, /supplier=Verity\+Home\+Fittings/);
  });

  test('changing the category keeps the supplier', () => {
    const both = get('/products?category=Bulbs&supplier=Halden+Electrical+Supplies').body;
    const url = submitWith(both, { category: 'Lamps' });

    assert.match(url, /category=Lamps/);
    assert.equal(url.includes('Bulbs'), false, 'the old category survived');
    assert.match(url, /supplier=Halden/, 'the supplier was dropped');
  });

  test('a search term rides along with the dropdowns', () => {
    const body = get('/products?category=Bulbs').body;
    const url = submitWith(body, { q: 'daylight' });

    assert.match(url, /category=Bulbs/);
    assert.match(url, /q=daylight/);
    assert.equal(shown(get(url).body), '1 of 14 products');
  });

  /* --- the All option ----------------------------------------------------- */

  test('choosing All removes only that filter', () => {
    const both = get('/products?category=Bulbs&supplier=Halden+Electrical+Supplies').body;

    const noCategory = submitWith(both, { category: '' });
    assert.equal(noCategory, '/products?supplier=Halden+Electrical+Supplies');
    assert.equal(shown(get(noCategory).body), '3 of 14 products');

    const noSupplier = submitWith(both, { supplier: '' });
    assert.equal(noSupplier, '/products?category=Bulbs');
    assert.equal(shown(get(noSupplier).body), '3 of 14 products');
  });

  test('with everything on All the URL carries no filters at all', () => {
    const both = get('/products?category=Bulbs&supplier=Halden+Electrical+Supplies').body;

    assert.equal(submitWith(both, { category: '', supplier: '' }), '/products');
  });

  test('Clear filters appears once something is filtered, and resets everything', () => {
    assert.equal(/<a class="reset"/.test(get('/products').body), false);

    const body = get('/products?category=Bulbs&supplier=Halden+Electrical+Supplies').body;
    const reset = body.match(/<a class="reset" href="([^"]+)">([^<]*)</);

    assert.ok(reset, 'no Clear filters link');
    assert.equal(reset[1], '/products');
    assert.equal(reset[2], 'Clear filters');
    assert.equal(shown(get(reset[1]).body), '14 products');
  });

  /* --- every screen, every filter ----------------------------------------- */

  test('each filter works on its own', () => {
    const rows = (path) => Number(shown(get(path).body).split(' ')[0]);

    assert.ok(rows('/stock?warehouse=WH-BIR') < rows('/stock'));
    assert.ok(rows('/stock?status=Low+Stock') < rows('/stock'));
    assert.ok(rows('/alerts?type=Low+Stock') < rows('/alerts'));
    assert.ok(rows('/alerts?warehouse=WH-BIR') < rows('/alerts'));
    assert.ok(rows('/transfers?status=Pending') < rows('/transfers'));
    assert.ok(rows('/transfers?from=WH-BIR') < rows('/transfers'));
    assert.ok(rows('/transfers?to=WH-MAN') < rows('/transfers'));
    assert.ok(rows('/audit?warehouse=WH-BIR') < rows('/audit'));
    assert.ok(rows('/audit?difference=yes') < rows('/audit'));
  });

  test('filters on the same screen combine with AND', () => {
    const rows = (path) => Number(shown(get(path).body).split(' ')[0]);

    assert.ok(rows('/stock?warehouse=WH-BIR&status=Low+Stock') <= rows('/stock?warehouse=WH-BIR'));
    assert.ok(rows('/alerts?type=Low+Stock&warehouse=WH-BIR') <= rows('/alerts?type=Low+Stock'));
    assert.ok(rows('/audit?warehouse=WH-BIR&difference=yes') <= rows('/audit?warehouse=WH-BIR'));

    // From and To are separate filters, so together they name one leg of a move.
    const fromBir = rows('/transfers?from=WH-BIR');
    const birToMan = rows('/transfers?from=WH-BIR&to=WH-MAN');
    assert.ok(birToMan > 0 && birToMan <= fromBir);
  });

  test('the transfers screen filters source and destination separately', () => {
    const from = get('/transfers?from=WH-BIR').body;
    const to = get('/transfers?to=WH-BIR').body;

    // Every row leaving Birmingham, and separately every row arriving there.
    assert.notEqual(shown(from), shown(to));
    assert.deepEqual(settings(from), ['Status=All', 'Warehouse from=WH-BIR', 'Warehouse to=All']);
    assert.deepEqual(settings(to), ['Status=All', 'Warehouse from=All', 'Warehouse to=WH-BIR']);
  });

  test('the audit Show dropdown switches between all lines and discrepancies', () => {
    assert.equal(shown(get('/audit').body), '10 audit lines');
    assert.equal(shown(get('/audit?difference=yes').body), '5 of 10 audit lines');
    assert.deepEqual(settings(get('/audit?difference=yes').body), ['Warehouse=All', 'Show=yes']);
  });

  test('an unknown value is dropped rather than applied', () => {
    assert.equal(shown(get('/products?category=Bogus').body), '14 products');
    assert.equal(shown(get('/stock?status=Nonsense').body), '32 stock lines');
  });

  /* --- the auto-apply script ---------------------------------------------- */

  test('the filter bar is wired to a script that submits it on change', () => {
    const script = route('/filters.js');

    assert.equal(script.status, 200);
    assert.match(script.contentType, /javascript/);
    assert.match(script.body, /addEventListener\("change"/, 'it does not listen for a change');
    assert.match(script.body, /classList\.contains\("filters"\)/, 'it does not check the form');
    assert.match(script.body, /form\.submit\(\)/, 'it does not submit');
    assert.match(script.body, /field\.value === ""\) field\.disabled = true/, 'it keeps empty filters');

    for (const screen of SCREENS) {
      assert.match(get(screen).body, /<script src="\/filters\.js" defer><\/script>/, `${screen}`);
    }
  });

  test('the script is the only one, is served from this origin, and adds no dependency', () => {
    for (const screen of [...SCREENS, '/', '/products/add', '/products/view?sku=SIC-1001']) {
      const { body } = get(screen);
      const tags = body.match(/<script[^>]*>/g) ?? [];

      assert.equal(tags.length, 1, `${screen} has ${tags.length} script tags`);
      assert.equal(tags[0], '<script src="/filters.js" defer>', `${screen} loads something else`);
      assert.equal(/on(click|change|submit|input)=/.test(body), false, `${screen} has an inline handler`);
      assert.equal(/https?:\/\//.test(tags[0]), false, `${screen} loads a script off-origin`);
    }
  });
});

describe('the list screens offer the actions', () => {
  test('products offers add, and view, edit and delete per row', () => {
    const { body } = get('/products');
    assert.ok(body.includes('href="/products/add"'), 'no add link');
    assert.ok(body.includes('href="/products/view?sku=SIC-1001"'), 'no view link');
    assert.ok(body.includes('href="/products/edit?sku=SIC-1001"'), 'no edit link');
    assert.ok(body.includes('href="/products/delete?sku=SIC-1001"'), 'no delete link');
  });

  test('stock offers add, and view, edit and delete per row', () => {
    const { body } = get('/stock');
    assert.ok(body.includes('href="/stock/add"'));
    assert.ok(body.includes('sku=SIC-1001&amp;warehouse=WH-BIR'));
  });

  test('transfers and audit offer add and the row actions', () => {
    assert.ok(get('/transfers').body.includes('href="/transfers/add"'));
    assert.ok(get('/transfers').body.includes('href="/transfers/view?id=TR-1001"'));
    assert.ok(get('/audit').body.includes('href="/audit/add"'));
    assert.ok(get('/audit').body.includes('href="/audit/view?id=AC-1001"'));
  });

  test('alerts offers view and action, but no way to add or delete a detected issue', () => {
    const { body } = get('/alerts');
    assert.ok(body.includes('/alerts/view?'), 'no view link');
    assert.ok(body.includes('/alerts/edit?'), 'no action link');
    assert.equal(body.includes('href="/alerts/add"'), false, 'issues can be invented by hand');
    assert.equal(body.includes('href="/alerts/delete?'), false, 'issues can be deleted by hand');
  });

  test('a delete link goes to a confirmation page, not to the deletion', () => {
    const before = findProduct('SIC-1001');
    const response = get('/products/delete?sku=SIC-1001');

    assert.equal(response.status, 200);
    assert.match(response.body, /Delete SIC-1001\?/);
    assert.equal(findProduct('SIC-1001'), before, 'a GET deleted the record');
  });

  test('every action link on a list screen resolves', () => {
    for (const screen of ['/products', '/stock', '/transfers', '/audit', '/alerts']) {
      const { body } = get(screen);
      const hrefs = [...body.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

      for (const raw of hrefs) {
        const url = new URL(raw.replaceAll('&amp;', '&'), 'http://localhost');
        assert.equal(route(url.pathname, url.searchParams).status, 200, `${raw} is a dead link`);
      }
    }
  });
});

/* ========================================================================== */

describe('products through the routes', () => {
  test('add: the form is offered, the post is accepted, the product appears', () => {
    assert.equal(get('/products/add').status, 200);

    const response = post('/products/add', productForm());
    assert.equal(landedOn(response), '/products');
    assert.ok(findProduct('SIC-8001'));
    assert.ok(get('/products').body.includes('SIC-8001'));
  });

  test('view: the detail screen shows every field', () => {
    post('/products/add', productForm());
    const { body, status } = get('/products/view?sku=SIC-8001');

    assert.equal(status, 200);
    for (const shown of ['SIC-8001', 'Test Pendant', 'Ceiling Lights', 'Northgate Lighting Ltd', 'Active']) {
      assert.ok(body.includes(shown), `the view does not show ${shown}`);
    }
    assert.ok(body.includes('/images/SIC-8001.svg'), 'no product image');
  });

  test('view: an unknown SKU is a 404, not a broken page', () => {
    assert.equal(get('/products/view?sku=SIC-0000').status, 404);
  });

  test('edit: the form is prefilled and the post is applied', () => {
    const form = get('/products/edit?sku=SIC-1001').body;
    assert.ok(form.includes('Aurora 3-Light Ceiling Pendant'), 'the form is not prefilled');

    const response = post('/products/edit', productForm({ sku: 'SIC-1001', name: 'Renamed' }));

    assert.equal(landedOn(response), '/products');
    assert.equal(findProduct('SIC-1001').name, 'Renamed');
  });

  test('a duplicate SKU comes back as the form, with the values and the reason', () => {
    const response = post('/products/add', productForm({ sku: 'SIC-1001', name: 'Clash' }));

    assert.equal(response.status, 400);
    assert.match(response.body, /already in the catalogue/);
    assert.ok(response.body.includes('value="Clash"'), 'the typed name was thrown away');
    assert.equal(findProduct('SIC-1001').name, 'Aurora 3-Light Ceiling Pendant');
  });

  test('an invalid listing status comes back as the form', () => {
    const response = post('/products/add', productForm({ listing: 'Archived' }));

    assert.equal(response.status, 400);
    assert.match(response.body, /Listing status must be/);
    assert.equal(findProduct('SIC-8001'), null);
  });

  test('delete: a product nothing references goes on confirmation', () => {
    post('/products/add', productForm());

    const response = post('/products/delete', { sku: 'SIC-8001' });

    assert.equal(landedOn(response), '/products');
    assert.equal(findProduct('SIC-8001'), null);
  });

  test('delete: a referenced product is refused until the removal is agreed to', () => {
    const refused = post('/products/delete', { sku: 'SIC-1001' });

    assert.equal(refused.status, 400);
    assert.match(refused.body, /still referenced/);
    assert.ok(findProduct('SIC-1001'), 'the product went anyway');

    const agreed = post('/products/delete', { sku: 'SIC-1001', cascade: 'yes' });

    assert.equal(landedOn(agreed), '/products');
    assert.equal(findProduct('SIC-1001'), null);
    assert.equal(findStockLine('SIC-1001', 'WH-BIR'), null, 'a stock line was left dangling');
  });
});

/* ========================================================================== */

describe('warehouse stock through the routes', () => {
  const stockFields = (overrides = {}) => ({
    sku: 'SIC-1001',
    warehouseId: 'WH-BRS',
    onHand: '50',
    reserved: '10',
    minimum: '20',
    ...overrides,
  });

  test('add: the post is accepted and the line appears', () => {
    assert.equal(get('/stock/add').status, 200);

    const response = post('/stock/add', stockFields());

    assert.equal(landedOn(response), '/stock');
    assert.equal(findStockLine('SIC-1001', 'WH-BRS').onHand, 50);
  });

  test('view: available is shown, worked out rather than stored', () => {
    post('/stock/add', stockFields());
    const { body } = get('/stock/view?sku=SIC-1001&warehouse=WH-BRS');

    assert.match(body, /<strong>40<\/strong>/, 'available is not shown as 40');
    assert.match(body, /50 on hand minus 10 reserved/);
  });

  test('the add and edit forms never offer an Available field', () => {
    for (const path of ['/stock/add', '/stock/edit?sku=SIC-1001&warehouse=WH-BIR']) {
      const { body } = get(path);
      assert.equal(body.includes('name="available"'), false, `${path} offers an Available field`);
    }
  });

  test('edit: available is recalculated from the figures that were saved', () => {
    const response = post('/stock/edit', {
      originalSku: 'SIC-1001',
      originalWarehouse: 'WH-BIR',
      ...stockFields({ warehouseId: 'WH-BIR', onHand: '30', reserved: '4' }),
    });

    assert.equal(landedOn(response), '/stock');
    assert.match(get('/stock/view?sku=SIC-1001&warehouse=WH-BIR').body, /<strong>26<\/strong>/);
  });

  test('a SKU that does not exist comes back as the form', () => {
    const response = post('/stock/add', stockFields({ sku: 'SIC-0000' }));

    assert.equal(response.status, 400);
    assert.match(response.body, /not in the product catalogue/);
  });

  test('a warehouse that does not exist comes back as the form', () => {
    const response = post('/stock/add', stockFields({ warehouseId: 'WH-ZZZ' }));

    assert.equal(response.status, 400);
    assert.match(response.body, /not a recognised warehouse/);
  });

  test('delete: the line goes on confirmation', () => {
    const response = post('/stock/delete', { sku: 'SIC-1001', warehouse: 'WH-BIR' });

    assert.equal(landedOn(response), '/stock');
    assert.equal(findStockLine('SIC-1001', 'WH-BIR'), null);
  });
});

/* ========================================================================== */

describe('alerts through the routes', () => {
  const shortage = 'type=Low+Stock&sku=SIC-1002&warehouse=WH-BIR';

  test('view: the issue, the stock behind it and the action are all shown', () => {
    const { body, status } = get(`/alerts/view?${shortage}`);

    assert.equal(status, 200);
    assert.ok(body.includes('Low Stock'), 'no issue type');
    assert.ok(body.includes('SIC-1002'), 'no SKU');
    assert.ok(body.includes('Birmingham Central'), 'no warehouse');
    assert.match(body, /available against a minimum of/, 'no reason');
    assert.ok(body.includes('Action status'), 'no action status');
  });

  test('an action status and a note can be recorded and are shown afterwards', () => {
    const response = post('/alerts/edit', {
      type: 'Low Stock',
      sku: 'SIC-1002',
      warehouse: 'WH-BIR',
      status: 'In Progress',
      note: 'Chased the supplier on Tuesday.',
    });

    assert.equal(landedOn(response), '/alerts');
    const { body } = get(`/alerts/view?${shortage}`);
    assert.ok(body.includes('In Progress'));
    assert.ok(body.includes('Chased the supplier on Tuesday.'));
  });

  test('an invalid action status comes back as the form', () => {
    const response = post('/alerts/edit', {
      type: 'Low Stock',
      sku: 'SIC-1002',
      warehouse: 'WH-BIR',
      status: 'Ignored',
    });

    assert.equal(response.status, 400);
    assert.match(response.body, /Action status must be/);
  });

  test('RESOLVING AN ISSUE DOES NOT REMOVE IT WHILE THE STOCK IS STILL WRONG', () => {
    const before = issuesReport().filter(
      (issue) => issue.type === 'Low Stock' && issue.sku === 'SIC-1002' && issue.warehouseId === 'WH-BIR',
    );
    assert.equal(before.length, 1);

    const response = post('/alerts/resolve', { type: 'Low Stock', sku: 'SIC-1002', warehouse: 'WH-BIR' });
    assert.equal(landedOn(response), '/alerts');

    const after = issuesReport().filter(
      (issue) => issue.type === 'Low Stock' && issue.sku === 'SIC-1002' && issue.warehouseId === 'WH-BIR',
    );
    assert.equal(after.length, 1, 'the issue was silenced by a label');
    assert.equal(after[0].action.status, 'Resolved');
    assert.ok(get('/alerts').body.includes('Resolved'), 'the alerts screen no longer lists it');
  });

  test('the issue only goes when the stock that caused it is corrected', () => {
    post('/alerts/resolve', { type: 'Low Stock', sku: 'SIC-1002', warehouse: 'WH-BIR' });

    post('/stock/edit', {
      originalSku: 'SIC-1002',
      originalWarehouse: 'WH-BIR',
      sku: 'SIC-1002',
      warehouseId: 'WH-BIR',
      onHand: '200',
      reserved: '6',
      minimum: '20',
    });

    const after = issuesReport().filter(
      (issue) => issue.type === 'Low Stock' && issue.sku === 'SIC-1002' && issue.warehouseId === 'WH-BIR',
    );
    assert.equal(after.length, 0);
  });

  test('an issue that is not being raised cannot be actioned', () => {
    assert.equal(get('/alerts/view?type=Low+Stock&sku=SIC-1001&warehouse=WH-BIR').status, 404);
    assert.equal(
      post('/alerts/edit', { type: 'Low Stock', sku: 'SIC-1001', warehouse: 'WH-BIR', status: 'Resolved' }).status,
      404,
    );
  });

  test('the alerts screen can be filtered by action status', () => {
    post('/alerts/edit', {
      type: 'Low Stock',
      sku: 'SIC-1002',
      warehouse: 'WH-BIR',
      status: 'Resolved',
    });

    const open = get('/alerts?action=Open');
    const resolved = get('/alerts?action=Resolved');

    assert.equal(open.status, 200);
    assert.equal(resolved.status, 200);
    assert.equal(issueAction({ type: 'Low Stock', sku: 'SIC-1002', warehouseId: 'WH-BIR' }).status, 'Resolved');
  });
});

/* ========================================================================== */

describe('transfers through the routes', () => {
  const transferFields = (overrides = {}) => ({
    sku: 'SIC-1001',
    fromWarehouseId: 'WH-BIR',
    toWarehouseId: 'WH-MAN',
    quantity: '25',
    status: 'Pending',
    raisedOn: '2026-09-10',
    ...overrides,
  });

  test('add, view, edit and delete run end to end', () => {
    assert.equal(get('/transfers/add').status, 200);

    const added = post('/transfers/add', transferFields());
    assert.equal(landedOn(added), '/transfers');
    const id = new URL(added.location, 'http://x').searchParams.get('subject');

    const view = get(`/transfers/view?id=${id}`);
    assert.equal(view.status, 200);
    assert.ok(view.body.includes(id));
    assert.ok(view.body.includes('Pending'));

    const edited = post('/transfers/edit', { id, ...transferFields({ status: 'Received' }) });
    assert.equal(landedOn(edited), '/transfers');
    assert.equal(findTransfer(id).status, 'Received');

    assert.equal(get(`/transfers/delete?id=${id}`).status, 200);
    assert.ok(findTransfer(id), 'the confirmation page deleted the transfer');

    const deleted = post('/transfers/delete', { id });
    assert.equal(landedOn(deleted), '/transfers');
    assert.equal(findTransfer(id), null);
  });

  test('an invalid warehouse comes back as the form', () => {
    const response = post('/transfers/add', transferFields({ toWarehouseId: 'WH-ZZZ' }));

    assert.equal(response.status, 400);
    assert.match(response.body, /not a recognised warehouse/);
  });

  test('the same warehouse at both ends comes back as the form', () => {
    const response = post('/transfers/add', transferFields({ toWarehouseId: 'WH-BIR' }));

    assert.equal(response.status, 400);
    assert.match(response.body, /two different warehouses/);
  });

  test('an invalid status comes back as the form', () => {
    const response = post('/transfers/add', transferFields({ status: 'Cancelled' }));

    assert.equal(response.status, 400);
    assert.match(response.body, /Status must be one of/);
  });

  test('a transfer still moves no stock', () => {
    const before = findStockLine('SIC-1001', 'WH-BIR').onHand;
    post('/transfers/add', transferFields({ quantity: '999' }));

    assert.equal(findStockLine('SIC-1001', 'WH-BIR').onHand, before);
  });
});

/* ========================================================================== */

describe('audit through the routes', () => {
  const auditFields = (overrides = {}) => ({
    sku: 'SIC-1001',
    warehouseId: 'WH-BIR',
    systemQuantity: '84',
    countedQuantity: '80',
    countedOn: '2026-09-10',
    countedBy: 'ZZ',
    ...overrides,
  });

  test('add, view, edit and delete run end to end', () => {
    assert.equal(get('/audit/add').status, 200);

    const added = post('/audit/add', auditFields());
    assert.equal(landedOn(added), '/audit');
    const id = new URL(added.location, 'http://x').searchParams.get('subject');

    const view = get(`/audit/view?id=${id}`);
    assert.equal(view.status, 200);
    assert.match(view.body, />-4</, 'the difference is not shown');
    assert.match(view.body, /Discrepancy/);

    const edited = post('/audit/edit', { id, ...auditFields({ countedQuantity: '84' }) });
    assert.equal(landedOn(edited), '/audit');
    assert.match(get(`/audit/view?id=${id}`).body, /Matches/, 'the difference did not recalculate');

    const deleted = post('/audit/delete', { id });
    assert.equal(landedOn(deleted), '/audit');
    assert.equal(findAuditCount(id), null);
  });

  test('the difference follows the counted figure, in both directions', () => {
    const over = post('/audit/add', auditFields({ countedQuantity: '90' }));
    const id = new URL(over.location, 'http://x').searchParams.get('subject');

    assert.match(get(`/audit/view?id=${id}`).body, />\+6</, 'an overage is not signed');

    post('/audit/edit', { id, ...auditFields({ countedQuantity: '70' }) });
    assert.match(get(`/audit/view?id=${id}`).body, />-14</, 'a shortage is not signed');
  });

  test('the add and edit forms never offer a Difference field', () => {
    for (const path of ['/audit/add', '/audit/edit?id=AC-1001']) {
      assert.equal(get(path).body.includes('name="difference"'), false, `${path} offers one`);
    }
  });

  test('the add form prefills the system figure from the stock data', () => {
    const { body } = get('/audit/add?sku=SIC-1001&warehouse=WH-BIR');
    assert.ok(body.includes('value="84"'), 'the system figure was not prefilled');
  });

  test('a negative physical count comes back as the form', () => {
    const response = post('/audit/add', auditFields({ countedQuantity: '-1' }));

    assert.equal(response.status, 400);
    assert.match(response.body, /cannot be below zero/);
  });
});

/* ========================================================================== */

describe('the dashboard follows the data', () => {
  /** One dashboard figure, read off the rendered page rather than the report. */
  function tileValue(body, label) {
    const pattern = new RegExp(
      `<div class="value">(-?\\d+)</div>\\s*<div class="label">${label}</div>`,
    );
    const match = body.match(pattern);
    assert.ok(match, `the dashboard has no ${label} tile`);
    return Number(match[1]);
  }

  test('adding a product raises Total SKUs', () => {
    const before = tileValue(get('/').body, 'Total SKUs');

    post('/products/add', productForm());

    assert.equal(tileValue(get('/').body, 'Total SKUs'), before + 1);
  });

  test('deleting a product lowers Total SKUs', () => {
    post('/products/add', productForm());
    const before = tileValue(get('/').body, 'Total SKUs');

    post('/products/delete', { sku: 'SIC-8001' });

    assert.equal(tileValue(get('/').body, 'Total SKUs'), before - 1);
  });

  test('a stock edit that fixes a shortage lowers Low Stock', () => {
    const before = tileValue(get('/').body, 'Low Stock');

    post('/stock/edit', {
      originalSku: 'SIC-1002',
      originalWarehouse: 'WH-BIR',
      sku: 'SIC-1002',
      warehouseId: 'WH-BIR',
      onHand: '200',
      reserved: '6',
      minimum: '20',
    });

    assert.equal(tileValue(get('/').body, 'Low Stock'), before - 1);
  });

  test('a stock edit that creates a shortage raises Low Stock', () => {
    const before = tileValue(get('/').body, 'Low Stock');

    post('/stock/edit', {
      originalSku: 'SIC-1001',
      originalWarehouse: 'WH-BIR',
      sku: 'SIC-1001',
      warehouseId: 'WH-BIR',
      onHand: '10',
      reserved: '2',
      minimum: '25',
    });

    assert.equal(tileValue(get('/').body, 'Low Stock'), before + 1);
  });

  test('a new stock line in a bad state shows up on the alerts screen', () => {
    post('/products/add', productForm({ sku: 'SIC-8002', approvedWarehouses: ['WH-BIR'] }));
    post('/stock/add', {
      sku: 'SIC-8002',
      warehouseId: 'WH-BIR',
      onHand: '3',
      reserved: '0',
      minimum: '40',
    });

    const raised = issuesReport().filter((issue) => issue.sku === 'SIC-8002');
    assert.equal(raised.length, 1);
    assert.equal(raised[0].type, 'Low Stock');
    assert.ok(get('/alerts').body.includes('SIC-8002'), 'the new issue is not listed');
  });

  test('deleting an audit record that disagreed lowers Discrepancies', () => {
    const before = tileValue(get('/').body, 'Discrepancies');

    // AC-1002 counted 15 against a system figure of 18.
    post('/audit/delete', { id: 'AC-1002' });

    assert.equal(tileValue(get('/').body, 'Discrepancies'), before - 1);
  });

  test('raising a pending transfer raises Pending Transfers', () => {
    const before = tileValue(get('/').body, 'Pending Transfers');

    post('/transfers/add', {
      sku: 'SIC-1001',
      fromWarehouseId: 'WH-BIR',
      toWarehouseId: 'WH-MAN',
      quantity: '5',
      status: 'Pending',
      raisedOn: '2026-09-10',
    });

    assert.equal(tileValue(get('/').body, 'Pending Transfers'), before + 1);
  });

  test('the stock bands still add up to the number of stock lines after edits', () => {
    post('/stock/add', {
      sku: 'SIC-1001',
      warehouseId: 'WH-BRS',
      onHand: '-3',
      reserved: '0',
      minimum: '10',
    });
    post('/stock/delete', { sku: 'SIC-1001', warehouse: 'WH-BIR' });

    const metrics = dashboardMetrics();
    assert.equal(
      metrics.healthyStock + metrics.lowStock + metrics.outOfStock + metrics.negativeInventory,
      metrics.totalStockLines,
    );
  });
});

describe('the six detection rules still work after CRUD', () => {
  test('every issue type is still one of the six declared ones', () => {
    post('/stock/add', {
      sku: 'SIC-1001',
      warehouseId: 'WH-BRS',
      onHand: '2',
      reserved: '9',
      minimum: '20',
    });

    for (const issue of issuesReport()) {
      assert.ok(ISSUE_TYPES.includes(issue.type), `${issue.type} is not a declared issue type`);
    }
  });

  test('a line added at a site the SKU is not approved for is caught as a mismatch', () => {
    post('/products/add', productForm({ sku: 'SIC-8003', approvedWarehouses: ['WH-BIR'] }));
    post('/stock/add', {
      sku: 'SIC-8003',
      warehouseId: 'WH-LDS',
      onHand: '10',
      reserved: '0',
      minimum: '1',
    });

    const raised = issuesReport().filter((issue) => issue.sku === 'SIC-8003');
    assert.ok(
      raised.some((issue) => issue.type === 'Warehouse/SKU Mismatch'),
      'a SKU held at an unapproved site was not reported',
    );
  });

  test('withdrawing a listing that still holds stock is caught as an inactive listing', () => {
    post('/products/edit', productForm({ sku: 'SIC-1001', listing: 'Inactive' }));

    const raised = issuesReport().filter(
      (issue) => issue.sku === 'SIC-1001' && issue.type === 'Inactive Listing',
    );
    assert.ok(raised.length > 0, 'a withdrawn listing holding stock was not reported');
  });

  test('a product edited down to no movement is caught as slow-moving', () => {
    post('/products/edit', productForm({ sku: 'SIC-1001', unitsSoldLast90Days: '1' }));

    const raised = issuesReport().filter(
      (issue) => issue.sku === 'SIC-1001' && issue.type === 'Slow-Moving Stock',
    );
    assert.ok(raised.length > 0, 'a barely-moving product was not reported');
  });

  test('Low Stock and Out of Stock still never apply to the same line', () => {
    post('/stock/add', {
      sku: 'SIC-1001',
      warehouseId: 'WH-BRS',
      onHand: '5',
      reserved: '9',
      minimum: '20',
    });

    const raised = issuesReport().filter(
      (issue) => issue.sku === 'SIC-1001' && issue.warehouseId === 'WH-BRS',
    );
    const bands = raised.map((issue) => issue.type).filter((type) => type === 'Low Stock' || type === 'Out of Stock');
    assert.equal(bands.length, 1, `a single line raised ${bands.join(' and ')}`);
  });
});

/* ========================================================================== */

describe('nothing destructive is reachable by a GET', () => {
  test('the delete confirmation screens change nothing', () => {
    const before = {
      products: findProduct('SIC-1001'),
      stock: findStockLine('SIC-1001', 'WH-BIR'),
      transfer: findTransfer('TR-1001'),
      audit: findAuditCount('AC-1001'),
    };

    get('/products/delete?sku=SIC-1001');
    get('/stock/delete?sku=SIC-1001&warehouse=WH-BIR');
    get('/transfers/delete?id=TR-1001');
    get('/audit/delete?id=AC-1001');

    assert.equal(findProduct('SIC-1001'), before.products);
    assert.equal(findStockLine('SIC-1001', 'WH-BIR'), before.stock);
    assert.equal(findTransfer('TR-1001'), before.transfer);
    assert.equal(findAuditCount('AC-1001'), before.audit);
  });

  test('a delete form asks before it acts', () => {
    const { body } = get('/transfers/delete?id=TR-1001');

    assert.match(body, /Delete transfer TR-1001\?/);
    assert.match(body, /<form class="record" method="post" action="\/transfers\/delete">/);
  });

  test('an unknown record posted at is a 404, not a crash', () => {
    assert.equal(post('/transfers/delete', { id: 'TR-0000' }).status, 404);
    assert.equal(post('/audit/edit', { id: 'AC-0000' }).status, 404);
    assert.equal(post('/nowhere', {}).status, 404);
  });
});
