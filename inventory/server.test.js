/**
 * Tests for the HTTP shell's security headers.
 *
 * Only /filters.js is requested, which is generated in memory and reads no
 * data, so these tests open no connection to the business database.
 *
 * Run with: npm test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { IMAGE_HOSTS, createInventoryServer } from './server.js';

describe('content security policy', () => {
  let server;
  let policy;

  before(async () => {
    server = createInventoryServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/filters.js`);
    policy = response.headers.get('content-security-policy');
    await response.text();
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  /** One directive's value. */
  const directive = (name) => new RegExp(`(?:^|;)\\s*${name} ([^;]*)`).exec(policy)?.[1] ?? '';

  test('lets the filter bar submit to its own screen', () => {
    // With form-action 'none' the browser blocked the filter form outright:
    // Enter in the search box did nothing, and so did the no-script Apply.
    assert.equal(directive('form-action'), "'self'");
  });

  test('allows product images from every host the source stores them on', () => {
    const allowed = directive('img-src').split(' ');

    assert.ok(allowed.includes("'self'"));
    for (const host of ['https://sin1.contabostorage.com', 'https://dashboard.digitweblk.com']) {
      assert.ok(allowed.includes(host), `images on ${host} would be blocked`);
    }
    assert.deepEqual(allowed.slice(1), [...IMAGE_HOSTS]);
  });

  test('still allows no script but this origin, and no external host generally', () => {
    assert.equal(directive('script-src'), "'self'");
    assert.equal(/\bhttps:(\s|;|$)/.test(policy), false, 'https: is allowed wholesale');
  });
});
