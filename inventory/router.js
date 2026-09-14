/**
 * Routing and filtering for Smart Inventory Control.
 *
 * This is the seam between the reports and the rendering. It is a pure
 * function of (path, query): it opens no socket, reads no request object and
 * writes no response, so every route can be exercised directly in a test
 * without starting a server.
 *
 * Filtering happens here rather than in the browser. Each screen reads its
 * filters from the query string, so a filtered view is a normal URL that can be
 * linked to - which is how the dashboard tiles drill through - and the pages
 * need no client-side JavaScript at all.
 *
 * ---------------------------------------------------------------------------
 * EVERY ROUTE IS A READ
 *
 * The data comes from `ledsone`, an existing business database this application
 * does not own and must not change. There is therefore no add, edit or delete
 * route, and no POST handling at all: routeForm() answers every submission with
 * the same "the source is read-only" page.
 *
 * This is not a rule the routing enforces on top of a system that could still
 * write - store.js has no write function left to call. The routing simply has
 * nothing to offer, and the screens offer no button that would reach it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LISTS ARE CAPPED
 *
 * The real catalogue is 6,510 SKUs across 68,000 stock lines. Rendering a
 * screen's worth of that as one table would be tens of megabytes of HTML for a
 * page nobody can read. So each list screen renders at most LIST_LIMIT rows and
 * says so in the line above the table - "200 of 68,237 stock lines" - which is
 * the count line the screens already had. The filters narrow the real set, not
 * the capped one, so searching for a SKU finds it wherever it sits in the list.
 */

import { ISSUE_TYPES, LOW_STOCK_THRESHOLD, STOCK_STATUS } from './rules.js';
import {
  TRANSFER_STATUSES,
  categories,
  findProduct,
  findStockLine,
  suppliers,
} from './store.js';
import { SOURCE_GAPS } from './source.js';
import {
  auditReport,
  dashboardMetrics,
  issueCounts,
  issuesReport,
  productsReport,
  snapshot,
  stockReport,
  transferCounts,
  transferGroup,
  transfersReport,
} from './reports.js';
import {
  renderAuditPage,
  renderAuditViewPage,
  renderDashboardPage,
  renderIssueViewPage,
  renderIssuesPage,
  renderNotFoundPage,
  renderProductViewPage,
  renderProductsPage,
  renderReadOnlyPage,
  renderStockPage,
  renderStockViewPage,
  renderFilterScript,
  renderThumbnailSvg,
  renderTransferViewPage,
  renderTransfersPage,
} from './render.js';

/**
 * Most rows any one list screen will render.
 *
 * A display limit, not a query limit: every figure on the page - the count
 * line, the dashboard tiles, the issue totals - is worked out over the whole
 * set before this is applied, so nothing is under-reported because of it.
 */
export const LIST_LIMIT = 200;

/** Every warehouse identifier, for validating a warehouse filter. */
const idsOf = (warehouses) => warehouses.map((warehouse) => warehouse.id);

/** The health bands offered in the stock filter, in severity order. */
const STOCK_STATUS_FILTERS = Object.freeze([
  STOCK_STATUS.HEALTHY,
  STOCK_STATUS.LOW,
  STOCK_STATUS.OUT,
  STOCK_STATUS.NEGATIVE,
]);

/**
 * What the audit screen's Show filter accepts.
 *
 * One value, because the filter has two outcomes and "all lines" is the
 * absence of a choice rather than a value of its own. It goes through
 * allowedValue() like every other filter, so ?show=anything-else shows every
 * line rather than an empty screen.
 */
const AUDIT_SHOW_VALUES = Object.freeze(['discrepancy']);

/**
 * Read one query parameter as a trimmed string.
 *
 * @param {URLSearchParams} query
 * @param {string} name
 * @returns {string}
 */
function param(query, name) {
  return (query.get(name) ?? '').trim();
}

/**
 * Read one query parameter EXACTLY as it was given, without trimming.
 *
 * For record identifiers only - a SKU, a warehouse id, a transfer id. Seven
 * SKUs in the source database carry a leading or trailing space (" FWS444BL",
 * "CGSPBM ", "RBLSDO300BI  " and so on). Those spaces are part of the key: they
 * are what the stock rows join on, and what the catalogue stores.
 *
 * param() trims, which is right for a search box and wrong here - it turned
 * every one of those products' own View link into a 404, because the href was
 * built from the real SKU and then trimmed back to something that matches
 * nothing. Identifiers are compared byte for byte; only human-typed filter
 * text is trimmed.
 *
 * @param {URLSearchParams} query
 * @param {string} name
 * @returns {string}
 */
function key(query, name) {
  return query.get(name) ?? '';
}

/**
 * Keep a filter value only when it is one the screen actually offers.
 *
 * Each filter group holds one value at a time: choosing another replaces it.
 * Groups are separate conditions on the same row, so they AND - a category and
 * a supplier narrow together.
 *
 * An unrecognised value is dropped rather than applied, so a mistyped or
 * tampered query string shows the unfiltered screen instead of an empty one.
 * A repeated parameter takes the first value, for the same reason: an odd URL
 * lands somewhere sensible rather than nowhere.
 *
 * @param {string} value
 * @param {readonly string[]} allowed
 * @returns {string}
 */
function allowedValue(value, allowed) {
  return allowed.includes(value) ? value : '';
}

/**
 * Case-insensitive partial match across a row's searchable fields.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY IS
 *
 * A plain substring test, ORed across the fields the screen says it searches.
 * "kettle" finds "Copper Kettle Shade"; "abc123" finds SKU "ABC123"; a term
 * matching nothing returns nothing rather than everything.
 *
 * It is String.prototype.includes, NOT a regular expression, and that is the
 * point: a search box is user input, and a term like `.*`, `(`, `[a-z` or
 * `\` is treated as those literal characters instead of being compiled into a
 * pattern. So there is no regex injection, no catastrophic backtracking on a
 * hostile term, and no "why did searching for ( crash the page".
 *
 * An empty term matches everything, so clearing the box returns the normally
 * filtered list rather than an empty screen.
 *
 * Null and undefined fields - a product with no category, a stock line with no
 * shelf - are treated as empty text rather than skipped or stringified into
 * "null", so they simply never match.
 *
 * @param {string} needle     Already trimmed by param().
 * @param {readonly unknown[]} haystacks
 * @returns {boolean}
 */
function matchesSearch(needle, haystacks) {
  if (!needle) return true;
  const term = needle.toLowerCase();

  return haystacks.some((value) => {
    if (value === null || value === undefined) return false;
    return String(value).toLowerCase().includes(term);
  });
}

/**
 * One page of a filtered set, and where that page sits in it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Rendering at most LIST_LIMIT rows is necessary - 67,747 issues as one table
 * is tens of megabytes of HTML - but a cap on its own is not enough, and on the
 * Alerts screen it was actively misleading.
 *
 * Issues come back sorted by severity, most serious first. There are 2,076
 * Negative Inventory issues in the real data, so with a flat 200-row cap and no
 * way to move past it, every row on the Alerts screen was a Negative Inventory
 * row and the other five types were unreachable. The labels were right and the
 * counts were right; 99.7% of the rows simply could not be got to.
 *
 * So the cap became a window. Every row is now reachable, the count line says
 * which rows are on screen, and the filters still narrow the whole set rather
 * than the current page.
 *
 * @param {readonly object[]} list
 * @param {number} wanted  1-based page number, from the query string.
 * @returns {{rows: object[], pageNumber: number, pageCount: number, from: number, to: number}}
 */
function windowOf(list, wanted) {
  const pageCount = Math.max(1, Math.ceil(list.length / LIST_LIMIT));
  // Clamped rather than refused: ?page=0, ?page=999 and ?page=banana all land
  // on a real page instead of an empty screen or an error.
  const pageNumber = Math.min(Math.max(1, wanted || 1), pageCount);
  const start = (pageNumber - 1) * LIST_LIMIT;
  const rows = list.slice(start, start + LIST_LIMIT);

  return {
    rows,
    pageNumber,
    pageCount,
    from: list.length === 0 ? 0 : start + 1,
    to: start + rows.length,
  };
}

/** The requested page number, or 1. */
const pageParam = (query) => {
  const raw = param(query, 'page');
  return /^\d+$/.test(raw) ? Number(raw) : 1;
};

/** An HTML response. */
function html(body, status = 200) {
  return { status, contentType: 'text/html; charset=utf-8', body };
}

/** The 404, used whenever a record is addressed that is not there. */
function notFound() {
  return html(renderNotFoundPage(), 404);
}

/* -------------------------------------------------------------------------- */
/* Screens                                                                    */
/* -------------------------------------------------------------------------- */

async function dashboardRoute() {
  // One snapshot, three reports built from it, so the dashboard is one read.
  const data = await snapshot();

  return html(
    renderDashboardPage({
      metrics: await dashboardMetrics(data),
      issueCounts: await issueCounts(data),
      transferCounts: await transferCounts(data),
    }),
  );
}

async function productsRoute(query) {
  const data = await snapshot();
  const all = await productsReport(data);
  const categoryOptions = await categories();
  const supplierOptions = await suppliers();

  const search = param(query, 'q');
  const category = allowedValue(param(query, 'category'), categoryOptions);
  const supplier = allowedValue(param(query, 'supplier'), supplierOptions);
  // The band for the SKU across every warehouse. This is what the dashboard
  // cards count, so ?stock=Healthy lands on exactly the SKUs the card counted.
  const stock = allowedValue(param(query, 'stock'), STOCK_STATUS_FILTERS);

  const products = all.filter(
    (product) =>
      // SKU, name, category and supplier - the four columns the screen shows
      // and the four the placeholder promises.
      matchesSearch(search, [product.sku, product.name, product.category, product.supplier]) &&
      (!category || product.category === category) &&
      (!supplier || product.supplier === supplier) &&
      (!stock || product.stockStatus === stock),
  );

  const view = windowOf(products, pageParam(query));

  return html(
    renderProductsPage({
      products: view.rows,
      view,
      params: { q: search, category, supplier, stock },
      total: all.length,
      matched: products.length,
      categories: categoryOptions,
      suppliers: supplierOptions,
      statuses: STOCK_STATUS_FILTERS,
      search,
      category,
      supplier,
      stock,
    }),
  );
}

async function stockRoute(query) {
  const data = await snapshot();
  const all = await stockReport(data);
  const search = param(query, 'q');
  const warehouseId = allowedValue(param(query, 'warehouse'), idsOf(data.warehouses));
  const status = allowedValue(param(query, 'status'), STOCK_STATUS_FILTERS);

  const lines = all.filter(
    (line) =>
      // SKU, product, warehouse, and the shelf and bulk locations where the
      // source records them - so "UK Unit3" finds a site's stock and "R01-S14"
      // finds what is on that shelf.
      matchesSearch(search, [
        line.sku,
        line.productName,
        line.warehouseName,
        line.shelfLocation,
        line.bulkLocation,
      ]) &&
      (!warehouseId || line.warehouseId === warehouseId) &&
      (!status || line.status === status),
  );

  const view = windowOf(lines, pageParam(query));

  return html(
    renderStockPage({
      lines: view.rows,
      view,
      params: { q: search, warehouse: warehouseId, status },
      total: all.length,
      matched: lines.length,
      warehouses: data.warehouses,
      statuses: STOCK_STATUS_FILTERS,
      warehouseId,
      status,
      search,
      threshold: LOW_STOCK_THRESHOLD,
      note: SOURCE_GAPS.minimum,
    }),
  );
}

async function alertsRoute(query) {
  const data = await snapshot();
  const all = await issuesReport(data);
  const search = param(query, 'q');
  const type = allowedValue(param(query, 'type'), ISSUE_TYPES);
  const warehouseId = allowedValue(param(query, 'warehouse'), idsOf(data.warehouses));

  // Searched over the WHOLE issue set - all 67,747 of them - before the page
  // window is taken. Issues are derived, not stored, so there is no table to
  // search; the rules have already produced every issue by this point and the
  // search narrows that result.
  const issues = all.filter(
    (issue) =>
      matchesSearch(search, [
        issue.sku,
        issue.productName,
        issue.warehouseName,
        issue.type,
        issue.detail,
      ]) &&
      (!type || issue.type === type) &&
      (!warehouseId || issue.warehouseId === warehouseId),
  );

  const view = windowOf(issues, pageParam(query));

  return html(
    renderIssuesPage({
      issues: view.rows,
      view,
      params: { q: search, type, warehouse: warehouseId },
      total: all.length,
      matched: issues.length,
      issueTypes: ISSUE_TYPES,
      warehouses: data.warehouses,
      search,
      type,
      warehouseId,
    }),
  );
}

async function transfersRoute(query) {
  const data = await snapshot();
  const all = await transfersReport(data);
  const search = param(query, 'q');
  const status = allowedValue(param(query, 'status'), TRANSFER_STATUSES);
  // Source and destination are filtered separately, so staff can ask what is
  // leaving one site, what is arriving at another, or a specific move between
  // the two. Set both and they narrow together like any other pair of filters.
  const fromWarehouseId = allowedValue(param(query, 'from'), idsOf(data.warehouses));
  const toWarehouseId = allowedValue(param(query, 'to'), idsOf(data.warehouses));

  // Searched over every movement before the page window is taken, so a SKU
  // that moved two years ago is found from the search box rather than only by
  // paging to it.
  const transfers = all.filter(
    (transfer) =>
      matchesSearch(search, [
        transfer.id,
        transfer.sku,
        transfer.productName,
        transfer.fromWarehouseName,
        transfer.toWarehouseName,
        transfer.status,
        transfer.note,
        transfer.recordedBy,
      ]) &&
      (!status || transfer.status === status) &&
      (!fromWarehouseId || transfer.fromWarehouseId === fromWarehouseId) &&
      (!toWarehouseId || transfer.toWarehouseId === toWarehouseId),
  );

  const view = windowOf(transfers, pageParam(query));

  return html(
    renderTransfersPage({
      transfers: view.rows,
      view,
      params: { q: search, status, from: fromWarehouseId, to: toWarehouseId },
      total: all.length,
      matched: transfers.length,
      statuses: TRANSFER_STATUSES,
      warehouses: data.warehouses,
      search,
      status,
      fromWarehouseId,
      toWarehouseId,
    }),
  );
}

async function auditRoute(query) {
  const data = await snapshot();
  const all = await auditReport(data);
  const warehouseId = allowedValue(param(query, 'warehouse'), idsOf(data.warehouses));
  // The Show filter has two outcomes, so it is one named value rather than a
  // switch: ?show=discrepancy keeps the lines where the count and the system
  // disagree, and anything else - including nothing - shows every line.
  const differencesOnly = allowedValue(param(query, 'show'), AUDIT_SHOW_VALUES) !== '';

  const rows = all.filter(
    (row) => (!warehouseId || row.warehouseId === warehouseId) && (!differencesOnly || !row.matches),
  );

  const view = windowOf(rows, pageParam(query));

  return html(
    renderAuditPage({
      rows: view.rows,
      view,
      params: { warehouse: warehouseId, show: differencesOnly ? 'discrepancy' : '' },
      total: all.length,
      matched: rows.length,
      warehouses: data.warehouses,
      warehouseId,
      differencesOnly,
      note: all.length === 0 ? SOURCE_GAPS.audit : '',
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Record screens                                                             */
/* -------------------------------------------------------------------------- */

/*
 * Each area has one record route: view. The record is addressed by the same
 * query parameters the filters use, so /stock/view?sku=...&warehouse=... reads
 * the way /stock?warehouse=... already does.
 *
 * There is no add, edit or delete counterpart. The source database is not ours
 * to change, and a form that appeared to change it would be worse than no form
 * at all - staff would believe a correction had been made.
 */

async function productViewRoute(query) {
  const sku = key(query, 'sku');
  const data = await snapshot();
  const product = (await productsReport(data)).find((row) => row.sku === sku);
  if (!product) return notFound();

  return html(
    renderProductViewPage({
      product,
      stockLines: (await stockReport(data)).filter((line) => line.sku === sku),
    }),
  );
}

async function stockViewRoute(query) {
  const sku = key(query, 'sku');
  const warehouseId = key(query, 'warehouse');
  const data = await snapshot();
  const line = (await stockReport(data)).find(
    (row) => row.sku === sku && row.warehouseId === warehouseId,
  );
  if (!line) return notFound();

  return html(
    renderStockViewPage({
      line,
      issues: (await issuesReport(data)).filter(
        (issue) => issue.sku === sku && issue.warehouseId === warehouseId,
      ),
      threshold: LOW_STOCK_THRESHOLD,
      note: SOURCE_GAPS.minimum,
    }),
  );
}

/**
 * The detected issue a URL is pointing at, if the rules are still raising it.
 *
 * Nothing is looked up in a table here: the issues are recomputed, then the one
 * matching the type, SKU and warehouse is picked out. An issue whose condition
 * has been fixed is simply not found any more, which is the correct answer.
 *
 * @param {URLSearchParams} query
 * @returns {Promise<object|null>}
 */
async function issueFromQuery(query) {
  const type = key(query, 'type');
  const sku = key(query, 'sku');
  const warehouseId = key(query, 'warehouse');

  return (
    (await issuesReport()).find(
      (issue) => issue.type === type && issue.sku === sku && issue.warehouseId === warehouseId,
    ) ?? null
  );
}

async function issueViewRoute(query) {
  const issue = await issueFromQuery(query);
  if (!issue) return notFound();

  return html(
    renderIssueViewPage({
      issue,
      line: await findStockLine(issue.sku, issue.warehouseId),
    }),
  );
}

/**
 * One transfer, as its header and every SKU line that moved under it.
 *
 * A transfer is a group of history lines sharing a derived reference, so this
 * gathers the group rather than picking the first row carrying the id - 303 of
 * the 776 transfers in the source moved more than one SKU, and showing only the
 * first of them would misreport the movement.
 */
async function transferViewRoute(query) {
  const transfer = await transferGroup(key(query, 'id'));
  if (!transfer) return notFound();

  return html(renderTransferViewPage({ transfer }));
}

async function auditViewRoute(query) {
  const row = (await auditReport()).find((entry) => entry.id === key(query, 'id'));
  if (!row) return notFound();

  return html(renderAuditViewPage({ row }));
}

/**
 * Product thumbnail route.
 *
 * Only used for a product the source holds no photograph for. The SKU is only
 * ever used to look up a catalogue entry; it is never used to touch the
 * filesystem, so a crafted path cannot reach anything. An unknown SKU still
 * renders a neutral placeholder rather than a broken image.
 *
 * @param {string} pathname
 * @returns {Promise<object>}
 */
async function imageRoute(pathname) {
  const sku = decodeURIComponent(pathname.slice('/images/'.length, -'.svg'.length));

  return {
    status: 200,
    contentType: 'image/svg+xml; charset=utf-8',
    body: renderThumbnailSvg(await findProduct(sku)),
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Resolve one request to a response.
 *
 * @param {string} pathname  Request path, without the query string.
 * @param {URLSearchParams} [query]
 * @returns {Promise<{status: number, contentType: string, body: string}>}
 */
export async function route(pathname, query = new URLSearchParams()) {
  const path = normalisePath(pathname);

  if (path.startsWith('/images/') && path.endsWith('.svg')) {
    return imageRoute(path);
  }

  if (path === '/filters.js') {
    return {
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: renderFilterScript(),
    };
  }

  switch (path) {
    case '':
    case '/':
      return dashboardRoute();

    case '/products':
      return productsRoute(query);
    case '/products/view':
      return productViewRoute(query);

    case '/stock':
      return stockRoute(query);
    case '/stock/view':
      return stockViewRoute(query);

    case '/alerts':
      return alertsRoute(query);
    case '/alerts/view':
      return issueViewRoute(query);

    case '/transfers':
      return transfersRoute(query);
    case '/transfers/view':
      return transferViewRoute(query);

    case '/audit':
      return auditRoute(query);
    case '/audit/view':
      return auditViewRoute(query);

    default:
      return notFound();
  }
}

/** Trailing slashes are tolerated so /products/ is not a dead end. */
function normalisePath(pathname) {
  return pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Resolve one form submission to a response.
 *
 * Nothing in this application accepts one. It is kept as a named route rather
 * than dropped so that a POST to an old bookmarked form URL gets an answer that
 * explains itself - the source database is read-only and this system reports on
 * it - instead of a bare 404 that looks like a bug.
 *
 * @param {string} pathname
 * @param {URLSearchParams} [form] The decoded request body.
 * @returns {Promise<{status: number, contentType: string, body: string}>}
 */
export async function routeForm(pathname, form = new URLSearchParams()) {
  void form;
  void pathname;

  return html(renderReadOnlyPage(), 405);
}
