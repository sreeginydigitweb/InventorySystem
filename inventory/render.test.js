/**
 * Tests for the rendering layer.
 *
 * Rendering is pure string building, so these run without a server.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  NAV_ITEMS,
  escapeHtml,
  formatDifference,
  issueClass,
  layout,
  formatHeaderDate,
  renderFilterScript,
  renderTransferViewPage,
  renderNotFoundPage,
  renderThumbnailSvg,
  statusClass,
  thumbnailInitials,
  transferStatusClass,
} from './render.js';

describe('escapeHtml', () => {
  test('escapes the characters that break out of HTML', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
    assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
    assert.equal(escapeHtml("it's"), 'it&#39;s');
  });

  test('does not double-build entities', () => {
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });

  test('returns an empty string for null and undefined', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });

  test('leaves ordinary text alone, including non-ASCII', () => {
    assert.equal(escapeHtml('Glühbirne, 40cm'), 'Glühbirne, 40cm');
  });

  test('renders numbers, including negative ones', () => {
    assert.equal(escapeHtml(-6), '-6');
    assert.equal(escapeHtml(0), '0');
  });
});

describe('formatDifference', () => {
  test('signs an overage and a shortage differently', () => {
    assert.equal(formatDifference(4), '+4');
    assert.equal(formatDifference(-3), '-3');
  });

  test('shows a match as a plain zero', () => {
    assert.equal(formatDifference(0), '0');
  });
});

describe('status classes', () => {
  test('each stock band gets its own class', () => {
    assert.equal(statusClass('Healthy'), 'ok');
    assert.equal(statusClass('Low Stock'), 'warn');
    assert.equal(statusClass('Out of Stock'), 'bad');
    assert.equal(statusClass('Negative Inventory'), 'critical');
  });

  test('each transfer status gets its own class', () => {
    assert.equal(transferStatusClass('Received'), 'ok');
    assert.equal(transferStatusClass('Received (Adjusted)'), 'info');
  });

  test('the statuses the source cannot hold are no longer dressed up', () => {
    // Pending and In Transit used to have their own colours, which made a
    // workflow ledsone has no trace of look like a real one.
    assert.equal(transferStatusClass('Pending'), 'neutral');
    assert.equal(transferStatusClass('In Transit'), 'neutral');
  });

  test('an unrecognised value falls back to neutral rather than breaking the page', () => {
    assert.equal(statusClass('something else'), 'neutral');
    assert.equal(issueClass('something else'), 'neutral');
    assert.equal(transferStatusClass('something else'), 'neutral');
  });
});

describe('layout', () => {
  const page = layout({ title: 'Dashboard', activePath: '/', lede: 'A lede.', body: '<p>Body</p>' });

  test('produces a complete document', () => {
    assert.match(page, /^<!doctype html>/);
    assert.match(page, /<\/html>\s*$/);
    assert.match(page, /<meta name="viewport"/);
  });

  test('carries the six areas in the navigation', () => {
    for (const item of NAV_ITEMS) {
      assert.ok(page.includes(`href="${item.path}"`), `no link to ${item.path}`);
      assert.ok(page.includes(item.label), `no label for ${item.label}`);
    }
    assert.equal(NAV_ITEMS.length, 6);
  });

  test('marks the current area for assistive technology', () => {
    assert.match(page, /<a href="\/" aria-current="page">Dashboard<\/a>/);
  });

  test('makes no claim that the data is not real', () => {
    // It is real: every figure on every screen comes from ledsone, the
    // business's own inventory database. The page shell used to say otherwise
    // on every screen, which stopped being true when the demonstration data was
    // taken out.
    for (const claim of [/Dummy data/i, /invented/i, /demonstration MVP/i]) {
      assert.equal(claim.test(page), false, `the page shell still says ${claim}`);
    }
  });

  test('carries exactly one script, from this origin, and no inline handler', () => {
    // The filter bars apply themselves on change rather than behind an Apply
    // button, which needs a script. It is one same-origin file and nothing
    // else - no inline handler, no CDN, no dependency - so the CSP can stay at
    // script-src 'self' without ever allowing 'unsafe-inline'.
    assert.deepEqual(page.match(/<script[^>]*>/g), ['<script src="/filters.js" defer>']);
    assert.equal(page.includes('onclick'), false);
    assert.equal(page.includes('onchange'), false);
    assert.equal(page.includes('onsubmit'), false);
  });

  test('escapes the title rather than trusting it', () => {
    const injected = layout({ title: '<script>x</script>', activePath: '/', body: '' });
    assert.equal(injected.includes('<script>x</script>'), false);
    assert.match(injected, /&lt;script&gt;/);
  });

  test('omits the lede line when there is none', () => {
    const bare = layout({ title: 'T', activePath: '/', body: '' });
    assert.equal(bare.includes('class="lede"'), false);
  });

  test('shows the date it is given in the masthead, beside the title', () => {
    const dated = layout({ title: 'T', activePath: '/', body: '', today: new Date(2026, 8, 14) });
    const masthead = /<header class="masthead">([\s\S]*?)<\/header>/.exec(dated)[1];

    assert.match(
      masthead,
      /<div class="masthead-top">\s*<div class="title">Smart Inventory Control<\/div>\s*<time class="today" datetime="2026-09-14">Monday, 14 September 2026<\/time>\s*<\/div>/,
    );
    assert.equal((dated.match(/<header/g) ?? []).length, 1, 'a second header was added');
  });

  test('defaults to the current date rather than a fixed one', () => {
    const now = new Date();
    assert.ok(page.includes(`>${formatHeaderDate(now)}</time>`), 'the masthead is not showing today');
  });
});

describe('formatHeaderDate', () => {
  test('is Weekday, DD Month YYYY', () => {
    assert.equal(formatHeaderDate(new Date(2026, 8, 14)), 'Monday, 14 September 2026');
    assert.equal(formatHeaderDate(new Date(2027, 0, 1)), 'Friday, 01 January 2027');
    assert.equal(formatHeaderDate(new Date(2024, 1, 29)), 'Thursday, 29 February 2024');
    assert.equal(formatHeaderDate(new Date(2026, 11, 31)), 'Thursday, 31 December 2026');
  });
});

describe('renderNotFoundPage', () => {
  test('explains the problem and keeps the navigation', () => {
    const page = renderNotFoundPage();
    assert.match(page, /does not exist/);
    assert.ok(page.includes('href="/products"'));
  });
});

describe('renderFilterScript', () => {
  const script = renderFilterScript();

  /** The script with its comments taken out, so prose cannot pass for code. */
  const code = script.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  test('never disables a control', () => {
    // THE BUG. The script used to set disabled = true on every field still
    // sitting at "All" before submitting, to keep the URL clean. That mutation
    // was applied to the live page and never reverted, so choosing Status
    // greyed out Warehouse from, Warehouse to and the search box - and the
    // browser's back-forward cache restored them still disabled.
    assert.equal(/\.disabled\s*=/.test(code), false, 'the script still disables controls');
    assert.equal(code.includes('disabled'), false);
  });

  test('does not touch the options in any dropdown', () => {
    // No cascading. Every filter keeps offering every value whatever else is
    // selected, so Status then Warehouse from then Warehouse to all combine.
    for (const mutation of ['removeChild', 'remove()', 'innerHTML', 'options.length', 'appendChild']) {
      assert.equal(code.includes(mutation), false, `the script still does ${mutation}`);
    }
  });

  test('builds the URL from the non-empty fields and navigates', () => {
    assert.match(code, /encodeURIComponent/);
    assert.match(code, /location\.assign/);
    assert.match(code, /field\.value === ""/);
  });

  test('carries no page number, so a changed filter starts at page one', () => {
    assert.equal(code.includes('page'), false, 'the script would carry a page number over');
  });

  test('leaves forms that are not filter bars alone', () => {
    assert.match(code, /classList\.contains\("filters"\)/);
  });

  test('marks the document so the Apply button can be hidden', () => {
    // The class only lands if this file actually ran. With scripting off, or
    // if the file fails to load, the button stays and the bar still works.
    assert.match(code, /documentElement\.className/);
  });

  test('takes over the submit that Enter in the search box causes', () => {
    // Typing a term and pressing Enter submits the form rather than changing a
    // dropdown. Handled here, so it lands on the same clean URL and still
    // searches when the term has not changed since the page loaded.
    assert.match(code, /addEventListener\("submit"/);
    assert.match(code, /preventDefault\(\)/);
  });
});

describe('renderTransferViewPage', () => {
  /** One event in which the same SKU was edited twice, plus a second SKU. */
  const line = (sku, quantity) => ({
    id: 'TR-REPEAT0001',
    sku,
    productName: `Product ${sku}`,
    fromWarehouseId: '8',
    toWarehouseId: '1',
    fromWarehouseName: 'UK Unit4',
    toWarehouseName: 'UK Unit3',
    quantity,
    quantityOut: quantity,
    quantityIn: quantity,
    status: 'Received',
    raisedOn: '2025-05-08',
    recordedBy: 'manoranjini',
    note: 'Low stock counting',
  });
  const lines = [line('WCB4BS', 21), line('WCB4BS', 19), line('WCB6BM', 20)];

  test('the heading counts the lines the table lists, not distinct SKUs', () => {
    // Real data has events where one SKU was edited twice. The heading used to
    // count distinct SKUs, so it read "2 SKU lines" above three rows.
    const page = renderTransferViewPage({
      transfer: { ...lines[0], lines, skuCount: 2, quantity: 60, quantityOut: 60, quantityIn: 60 },
    });

    assert.match(page, /<h2>3 SKU lines<\/h2>/);
    assert.equal((page.match(/<td class="sku">/g) ?? []).length, 3);
  });
});

describe('thumbnails', () => {
  test('initials come from the first two words', () => {
    assert.equal(thumbnailInitials('Aurora 3-Light Ceiling Pendant'), 'A3');
    assert.equal(thumbnailInitials('Marlow Tripod Floor Lamp'), 'MT');
  });

  test('a single-word name gives a single initial', () => {
    assert.equal(thumbnailInitials('Bollard'), 'B');
  });

  test('an empty or missing name still produces something drawable', () => {
    assert.equal(thumbnailInitials(''), '?');
    assert.equal(thumbnailInitials(null), '?');
  });

  test('renders a self-contained SVG with no external reference', () => {
    const svg = renderThumbnailSvg({ name: 'Aurora 3-Light Ceiling Pendant', category: 'Ceiling Lights' });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.equal(svg.includes('http://localhost'), false);
    assert.equal(/<image|xlink:href/.test(svg), false);
  });

  test('an unknown product still renders a placeholder', () => {
    const svg = renderThumbnailSvg(null);
    assert.match(svg, /<svg/);
    assert.match(svg, />\?</);
  });

  test('escapes the product name it puts in the label', () => {
    const svg = renderThumbnailSvg({ name: '"><script>x</script>', category: 'Bulbs' });
    assert.equal(svg.includes('<script>'), false);
  });
});
