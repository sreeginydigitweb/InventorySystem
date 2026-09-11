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
    assert.equal(transferStatusClass('Pending'), 'warn');
    assert.equal(transferStatusClass('In Transit'), 'info');
    assert.equal(transferStatusClass('Received'), 'ok');
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
});

describe('renderNotFoundPage', () => {
  test('explains the problem and keeps the navigation', () => {
    const page = renderNotFoundPage();
    assert.match(page, /does not exist/);
    assert.ok(page.includes('href="/products"'));
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
