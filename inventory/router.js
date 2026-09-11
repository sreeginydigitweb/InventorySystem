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
 */

import { ISSUE_TYPES, STOCK_STATUS } from './rules.js';
import {
  ACTION_STATUSES,
  CATEGORIES,
  LISTING_STATUSES,
  SUPPLIERS,
  TRANSFER_STATUSES,
  allProducts,
  allWarehouses,
  addAuditCount,
  addProduct,
  addStockLine,
  addTransfer,
  deleteAuditCount,
  deleteProduct,
  deleteStockLine,
  deleteTransfer,
  findAuditCount,
  findProduct,
  findStockLine,
  findTransfer,
  findWarehouse,
  recordIssueAction,
  referencesTo,
  systemQuantityFor,
  today,
  updateAuditCount,
  updateProduct,
  updateStockLine,
  updateTransfer,
} from './store.js';
import {
  auditReport,
  dashboardMetrics,
  issueCounts,
  issuesReport,
  productsReport,
  snapshot,
  stockReport,
  transferCounts,
  transfersReport,
  unknownSkus,
} from './reports.js';
import {
  renderAuditFormPage,
  renderAuditDeletePage,
  renderAuditPage,
  renderAuditViewPage,
  renderDashboardPage,
  renderIssueActionPage,
  renderIssueViewPage,
  renderIssuesPage,
  renderNotFoundPage,
  renderProductDeletePage,
  renderProductFormPage,
  renderProductViewPage,
  renderProductsPage,
  renderStockDeletePage,
  renderStockFormPage,
  renderStockPage,
  renderStockViewPage,
  renderFilterScript,
  renderThumbnailSvg,
  renderTransferDeletePage,
  renderTransferFormPage,
  renderTransferViewPage,
  renderTransfersPage,
} from './render.js';

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
 * Case-insensitive substring match across a row's searchable fields.
 *
 * @param {string} needle
 * @param {readonly string[]} haystacks
 * @returns {boolean}
 */
function matchesSearch(needle, haystacks) {
  if (!needle) return true;
  const term = needle.toLowerCase();
  return haystacks.some((value) => String(value ?? '').toLowerCase().includes(term));
}

/** An HTML response. */
function html(body, status = 200) {
  return { status, contentType: 'text/html; charset=utf-8', body };
}

/**
 * A redirect after a successful write.
 *
 * Every form post that changes something answers with one of these rather than
 * with a page. The browser then fetches the list screen fresh, so what staff
 * see afterwards is a normal GET of the current data - reloading it cannot
 * repeat the write, and the back button cannot resubmit it.
 *
 * @param {string} location
 * @returns {object}
 */
function redirect(location) {
  return { status: 303, location, contentType: 'text/html; charset=utf-8', body: '' };
}

/**
 * What each screen says after a write, keyed by the code the redirect carries.
 *
 * The message is chosen here from a fixed list rather than taken from the query
 * string, so nothing a URL says can be echoed onto the page. The subject - a
 * SKU, an id - is the only part that comes from the request, and it is escaped
 * like every other dynamic value.
 */
const FLASH_MESSAGES = Object.freeze({
  'product-added': (subject) => `Product ${subject} has been added to the catalogue.`,
  'product-updated': (subject) => `Product ${subject} has been updated.`,
  'product-deleted': (subject) => `Product ${subject} has been deleted.`,
  'product-deleted-cascade': (subject) =>
    `Product ${subject} has been deleted, along with the stock lines, transfers and audit records that pointed at it.`,
  'stock-added': (subject) => `Stock record for ${subject} has been added.`,
  'stock-updated': (subject) => `Stock record for ${subject} has been updated. Available has been recalculated.`,
  'stock-deleted': (subject) => `Stock record for ${subject} has been deleted.`,
  'issue-actioned': (subject) => `The action against ${subject} has been recorded.`,
  'issue-resolved': (subject) =>
    `${subject} has been marked resolved. The rules still check the stock, so the issue stays listed while the condition is still there.`,
  'transfer-added': (subject) => `Transfer ${subject} has been raised. No stock has moved.`,
  'transfer-updated': (subject) => `Transfer ${subject} has been updated.`,
  'transfer-deleted': (subject) => `Transfer ${subject} has been deleted.`,
  'audit-added': (subject) => `Audit record ${subject} has been added.`,
  'audit-updated': (subject) => `Audit record ${subject} has been updated. The difference has been recalculated.`,
  'audit-deleted': (subject) => `Audit record ${subject} has been deleted.`,
});

/**
 * The banner to show at the top of a list screen, if the URL asks for one.
 *
 * @param {URLSearchParams} query
 * @returns {{tone: string, message: string}|null}
 */
function flashFrom(query) {
  const code = param(query, 'done');
  const build = FLASH_MESSAGES[code];
  if (!build) return null;

  return { tone: 'ok', message: build(param(query, 'subject')) };
}

/** The URL to land on after a write. */
function doneAt(path, code, subject) {
  return `${path}?done=${encodeURIComponent(code)}&subject=${encodeURIComponent(subject)}`;
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
  const search = param(query, 'q');
  const category = allowedValue(param(query, 'category'), CATEGORIES);
  const supplier = allowedValue(param(query, 'supplier'), SUPPLIERS);

  const products = all.filter(
    (product) =>
      matchesSearch(search, [product.sku, product.name, product.supplier]) &&
      (!category || product.category === category) &&
      (!supplier || product.supplier === supplier),
  );

  return html(
    renderProductsPage({
      products,
      total: all.length,
      categories: CATEGORIES,
      suppliers: SUPPLIERS,
      search,
      category,
      supplier,
      unknownSkus: await unknownSkus(data),
      flash: flashFrom(query),
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
      matchesSearch(search, [line.sku, line.productName]) &&
      (!warehouseId || line.warehouseId === warehouseId) &&
      (!status || line.status === status),
  );

  return html(
    renderStockPage({
      lines,
      total: all.length,
      warehouses: data.warehouses,
      statuses: STOCK_STATUS_FILTERS,
      warehouseId,
      status,
      search,
      flash: flashFrom(query),
    }),
  );
}

async function alertsRoute(query) {
  const data = await snapshot();
  const all = await issuesReport(data);
  const type = allowedValue(param(query, 'type'), ISSUE_TYPES);
  const warehouseId = allowedValue(param(query, 'warehouse'), idsOf(data.warehouses));
  const actionStatus = allowedValue(param(query, 'action'), ACTION_STATUSES);

  const issues = all.filter(
    (issue) =>
      (!type || issue.type === type) &&
      (!warehouseId || issue.warehouseId === warehouseId) &&
      (!actionStatus || issue.action.status === actionStatus),
  );

  return html(
    renderIssuesPage({
      issues,
      total: all.length,
      issueTypes: ISSUE_TYPES,
      warehouses: data.warehouses,
      actionStatuses: ACTION_STATUSES,
      type,
      warehouseId,
      actionStatus,
      flash: flashFrom(query),
    }),
  );
}

async function transfersRoute(query) {
  const data = await snapshot();
  const all = await transfersReport(data);
  const status = allowedValue(param(query, 'status'), TRANSFER_STATUSES);
  // Source and destination are filtered separately, so staff can ask what is
  // leaving one site, what is arriving at another, or a specific move between
  // the two. Set both and they narrow together like any other pair of filters.
  const fromWarehouseId = allowedValue(param(query, 'from'), idsOf(data.warehouses));
  const toWarehouseId = allowedValue(param(query, 'to'), idsOf(data.warehouses));

  const transfers = all.filter(
    (transfer) =>
      (!status || transfer.status === status) &&
      (!fromWarehouseId || transfer.fromWarehouseId === fromWarehouseId) &&
      (!toWarehouseId || transfer.toWarehouseId === toWarehouseId),
  );

  return html(
    renderTransfersPage({
      transfers,
      total: all.length,
      statuses: TRANSFER_STATUSES,
      warehouses: data.warehouses,
      status,
      fromWarehouseId,
      toWarehouseId,
      flash: flashFrom(query),
    }),
  );
}

async function auditRoute(query) {
  const data = await snapshot();
  const all = await auditReport(data);
  const warehouseId = allowedValue(param(query, 'warehouse'), idsOf(data.warehouses));
  // Discrepancies-only is a plain on/off switch rather than a choice of values.
  const differencesOnly = param(query, 'difference') !== '';

  const rows = all.filter(
    (row) => (!warehouseId || row.warehouseId === warehouseId) && (!differencesOnly || !row.matches),
  );

  return html(
    renderAuditPage({
      rows,
      total: all.length,
      warehouses: data.warehouses,
      warehouseId,
      differencesOnly,
      flash: flashFrom(query),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Record screens                                                             */
/* -------------------------------------------------------------------------- */

/*
 * Each area gets the same four routes: view, add, edit and delete. They follow
 * the conventions already in this file - the record is addressed by the same
 * query parameters the filters use, so /stock/view?sku=...&warehouse=... reads
 * the way /stock?warehouse=... already does.
 *
 * The split between GET and POST is the important part. A GET never changes
 * anything: /products/delete is the page that ASKS, and the removal only
 * happens when the form on it is posted to the same path. So no link, crawler
 * or prefetch can destroy a record, and a delete cannot happen by accident.
 */

/** The 404, used whenever a record is addressed that is not there. */
function notFound() {
  return html(renderNotFoundPage(), 404);
}

/**
 * Turn a posted form body into the plain object the store validates.
 *
 * A field that appears more than once - the approved-warehouse checkboxes -
 * arrives as an array; everything else as a string.
 *
 * @param {URLSearchParams} form
 * @returns {object}
 */
function formValues(form) {
  const values = {};
  for (const key of new Set(form.keys())) {
    const all = form.getAll(key);
    values[key] = all.length > 1 ? all : all[0];
  }
  return values;
}

/** One posted field, trimmed. */
function field(form, name) {
  return String(form.get(name) ?? '').trim();
}

/** The lists every record form offers, read together. */
async function formLists() {
  const [products, warehouses] = await Promise.all([allProducts(), allWarehouses()]);
  return { products, warehouses };
}

/* --- Products ------------------------------------------------------------- */

/** A stored product as the form fields see it. */
function productToForm(product) {
  return {
    sku: product.sku,
    name: product.name,
    category: product.category,
    supplier: product.supplier,
    listing: product.active ? 'Active' : 'Inactive',
    unitsSoldLast90Days: String(product.unitsSoldLast90Days),
    approvedWarehouses: [...product.approvedWarehouses],
  };
}

/** Everything renderProductFormPage needs besides the values. */
async function productFormOptions() {
  return {
    categories: CATEGORIES,
    suppliers: SUPPLIERS,
    warehouses: await allWarehouses(),
    listingStatuses: LISTING_STATUSES,
  };
}

async function productViewRoute(query) {
  const sku = param(query, 'sku');
  const data = await snapshot();
  const product = (await productsReport(data)).find((row) => row.sku === sku);
  if (!product) return notFound();

  return html(
    renderProductViewPage({
      product: {
        ...product,
        approvedWarehouseNames: product.approvedWarehouses.map(
          (id) => data.catalogue.findWarehouse(id)?.name ?? id,
        ),
      },
      stockLines: (await stockReport(data)).filter((line) => line.sku === sku),
      flash: flashFrom(query),
    }),
  );
}

async function productAddRoute() {
  const options = await productFormOptions();

  return html(
    renderProductFormPage({
      mode: 'add',
      // A new SKU is approved everywhere by default: approving it nowhere would
      // make every stock line raise a mismatch the moment it was recorded.
      values: {
        listing: 'Active',
        unitsSoldLast90Days: '0',
        approvedWarehouses: options.warehouses.map((warehouse) => warehouse.id),
      },
      ...options,
    }),
  );
}

async function productEditRoute(query) {
  const product = await findProduct(param(query, 'sku'));
  if (!product) return notFound();

  return html(
    renderProductFormPage({ mode: 'edit', values: productToForm(product), ...(await productFormOptions()) }),
  );
}

async function productDeleteRoute(query) {
  const product = await findProduct(param(query, 'sku'));
  if (!product) return notFound();

  return html(
    renderProductDeletePage({
      product,
      references: await referencesTo(product.sku),
      flash: flashFrom(query),
    }),
  );
}

async function productAddPost(form) {
  const values = formValues(form);
  const result = await addProduct(values);
  if (!result.ok) {
    return html(
      renderProductFormPage({ mode: 'add', values, errors: result.errors, ...(await productFormOptions()) }),
      400,
    );
  }

  return redirect(doneAt('/products', 'product-added', result.value.sku));
}

async function productEditPost(form) {
  const sku = field(form, 'sku');
  const values = { ...formValues(form), sku };
  const result = await updateProduct(sku, values);
  if (!result.ok) {
    if (!(await findProduct(sku))) return notFound();
    return html(
      renderProductFormPage({ mode: 'edit', values, errors: result.errors, ...(await productFormOptions()) }),
      400,
    );
  }

  return redirect(doneAt('/products', 'product-updated', result.value.sku));
}

async function productDeletePost(form) {
  const sku = field(form, 'sku');
  const product = await findProduct(sku);
  if (!product) return notFound();

  const references = await referencesTo(sku);
  const result = await deleteProduct(sku, { cascade: form.get('cascade') !== null });

  if (!result.ok) {
    return html(
      renderProductDeletePage({
        product,
        references,
        flash: { tone: 'bad', message: Object.values(result.errors)[0] },
      }),
      400,
    );
  }

  return redirect(
    doneAt('/products', references.total > 0 ? 'product-deleted-cascade' : 'product-deleted', sku),
  );
}

/* --- Warehouse stock ------------------------------------------------------ */

/** A stored stock line as the form fields see it. */
function stockToForm(line, warehouseName) {
  return {
    sku: line.sku,
    warehouseId: line.warehouseId,
    warehouseName,
    onHand: String(line.onHand),
    reserved: String(line.reserved),
    minimum: String(line.minimum),
  };
}

async function stockViewRoute(query) {
  const sku = param(query, 'sku');
  const warehouseId = param(query, 'warehouse');
  const line = (await stockReport()).find((row) => row.sku === sku && row.warehouseId === warehouseId);
  if (!line) return notFound();

  return html(
    renderStockViewPage({
      line,
      issues: (await issuesReport()).filter(
        (issue) => issue.sku === sku && issue.warehouseId === warehouseId,
      ),
      flash: flashFrom(query),
    }),
  );
}

async function stockAddRoute(query) {
  return html(
    renderStockFormPage({
      mode: 'add',
      values: {
        sku: param(query, 'sku'),
        warehouseId: param(query, 'warehouse'),
        onHand: '0',
        reserved: '0',
        minimum: '0',
      },
      ...(await formLists()),
    }),
  );
}

async function stockEditRoute(query) {
  const line = await findStockLine(param(query, 'sku'), param(query, 'warehouse'));
  if (!line) return notFound();

  const warehouse = await findWarehouse(line.warehouseId);

  return html(
    renderStockFormPage({
      mode: 'edit',
      values: stockToForm(line, warehouse?.name ?? line.warehouseId),
      ...(await formLists()),
    }),
  );
}

async function stockDeleteRoute(query) {
  const sku = param(query, 'sku');
  const warehouseId = param(query, 'warehouse');
  const line = (await stockReport()).find((row) => row.sku === sku && row.warehouseId === warehouseId);
  if (!line) return notFound();

  return html(renderStockDeletePage({ line, flash: flashFrom(query) }));
}

async function stockAddPost(form) {
  const values = formValues(form);
  const result = await addStockLine(values);
  if (!result.ok) {
    return html(renderStockFormPage({ mode: 'add', values, errors: result.errors, ...(await formLists()) }), 400);
  }

  return redirect(doneAt('/stock', 'stock-added', result.value.sku));
}

async function stockEditPost(form) {
  const originalSku = field(form, 'originalSku');
  const originalWarehouse = field(form, 'originalWarehouse');
  if (!(await findStockLine(originalSku, originalWarehouse))) return notFound();

  const values = { ...formValues(form), originalSku, originalWarehouse };
  const result = await updateStockLine(originalSku, originalWarehouse, values);
  if (!result.ok) {
    return html(
      renderStockFormPage({
        mode: 'edit',
        values: {
          ...values,
          warehouseName: (await findWarehouse(values.warehouseId))?.name ?? values.warehouseId,
        },
        errors: result.errors,
        ...(await formLists()),
      }),
      400,
    );
  }

  return redirect(doneAt('/stock', 'stock-updated', result.value.sku));
}

async function stockDeletePost(form) {
  const sku = field(form, 'sku');
  const warehouseId = field(form, 'warehouse');
  const result = await deleteStockLine(sku, warehouseId);
  if (!result.ok) return notFound();

  return redirect(doneAt('/stock', 'stock-deleted', sku));
}

/* --- Alerts / issues ------------------------------------------------------ */

/**
 * The detected issue a URL is pointing at, if the rules are still raising it.
 *
 * Nothing is looked up in a table here: the issues are recomputed, then the one
 * matching the type, SKU and warehouse is picked out. An issue whose condition
 * has been fixed is simply not found any more, which is the correct answer.
 *
 * @param {URLSearchParams} query
 * @returns {object|null}
 */
async function issueFromQuery(query) {
  const type = param(query, 'type');
  const sku = param(query, 'sku');
  const warehouseId = param(query, 'warehouse');

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
      flash: flashFrom(query),
    }),
  );
}

async function issueEditRoute(query) {
  const issue = await issueFromQuery(query);
  if (!issue) return notFound();

  return html(
    renderIssueActionPage({
      issue,
      values: { status: issue.action.status, note: issue.action.note },
      actionStatuses: ACTION_STATUSES,
    }),
  );
}

async function issueEditPost(form) {
  const query = new URLSearchParams({
    type: field(form, 'type'),
    sku: field(form, 'sku'),
    warehouse: field(form, 'warehouse'),
  });
  const issue = await issueFromQuery(query);
  if (!issue) return notFound();

  const values = formValues(form);
  const result = await recordIssueAction(
    { type: issue.type, sku: issue.sku, warehouseId: issue.warehouseId },
    values,
  );

  if (!result.ok) {
    return html(
      renderIssueActionPage({
        issue,
        values,
        errors: result.errors,
        actionStatuses: ACTION_STATUSES,
      }),
      400,
    );
  }

  return redirect(doneAt('/alerts', 'issue-actioned', `${issue.type} on ${issue.sku}`));
}

/**
 * Mark an issue resolved in one step from its view screen.
 *
 * This records a decision. It does not touch the stock, and the next page load
 * runs the same six rules over the same figures, so a shortage that has not
 * actually been fixed is detected again and listed again - carrying the
 * Resolved label, rather than being hidden by it.
 */
async function issueResolvePost(form) {
  const query = new URLSearchParams({
    type: field(form, 'type'),
    sku: field(form, 'sku'),
    warehouse: field(form, 'warehouse'),
  });
  const issue = await issueFromQuery(query);
  if (!issue) return notFound();

  const result = await recordIssueAction(
    { type: issue.type, sku: issue.sku, warehouseId: issue.warehouseId },
    { status: 'Resolved', note: issue.action.note },
  );
  if (!result.ok) return notFound();

  return redirect(doneAt('/alerts', 'issue-resolved', `${issue.type} on ${issue.sku}`));
}

/* --- Transfers ------------------------------------------------------------ */

/** A stored transfer as the form fields see it. */
function transferToForm(transfer) {
  return {
    id: transfer.id,
    sku: transfer.sku,
    fromWarehouseId: transfer.fromWarehouseId,
    toWarehouseId: transfer.toWarehouseId,
    quantity: String(transfer.quantity),
    status: transfer.status,
    raisedOn: transfer.raisedOn,
  };
}

async function transferViewRoute(query) {
  const transfer = (await transfersReport()).find((row) => row.id === param(query, 'id'));
  if (!transfer) return notFound();

  return html(renderTransferViewPage({ transfer, flash: flashFrom(query) }));
}

async function transferAddRoute() {
  return html(
    renderTransferFormPage({
      mode: 'add',
      values: { status: TRANSFER_STATUSES[0], quantity: '1', raisedOn: today() },
      statuses: TRANSFER_STATUSES,
      ...(await formLists()),
    }),
  );
}

async function transferEditRoute(query) {
  const transfer = await findTransfer(param(query, 'id'));
  if (!transfer) return notFound();

  return html(
    renderTransferFormPage({
      mode: 'edit',
      values: transferToForm(transfer),
      statuses: TRANSFER_STATUSES,
      ...(await formLists()),
    }),
  );
}

async function transferDeleteRoute(query) {
  const transfer = (await transfersReport()).find((row) => row.id === param(query, 'id'));
  if (!transfer) return notFound();

  return html(renderTransferDeletePage({ transfer, flash: flashFrom(query) }));
}

async function transferAddPost(form) {
  const values = formValues(form);
  const result = await addTransfer(values);
  if (!result.ok) {
    return html(
      renderTransferFormPage({
        mode: 'add',
        values,
        errors: result.errors,
        statuses: TRANSFER_STATUSES,
        ...(await formLists()),
      }),
      400,
    );
  }

  return redirect(doneAt('/transfers', 'transfer-added', result.value.id));
}

async function transferEditPost(form) {
  const id = field(form, 'id');
  if (!(await findTransfer(id))) return notFound();

  const values = { ...formValues(form), id };
  const result = await updateTransfer(id, values);
  if (!result.ok) {
    return html(
      renderTransferFormPage({
        mode: 'edit',
        values,
        errors: result.errors,
        statuses: TRANSFER_STATUSES,
        ...(await formLists()),
      }),
      400,
    );
  }

  return redirect(doneAt('/transfers', 'transfer-updated', result.value.id));
}

async function transferDeletePost(form) {
  const id = field(form, 'id');
  const result = await deleteTransfer(id);
  if (!result.ok) return notFound();

  return redirect(doneAt('/transfers', 'transfer-deleted', id));
}

/* --- Inventory audit ------------------------------------------------------ */

/** A stored audit count as the form fields see it. */
function auditToForm(count) {
  return {
    id: count.id,
    sku: count.sku,
    warehouseId: count.warehouseId,
    systemQuantity: String(count.systemQuantity),
    countedQuantity: String(count.countedQuantity),
    countedOn: count.countedOn,
    countedBy: count.countedBy,
  };
}

async function auditViewRoute(query) {
  const row = (await auditReport()).find((entry) => entry.id === param(query, 'id'));
  if (!row) return notFound();

  return html(renderAuditViewPage({ row, flash: flashFrom(query) }));
}

async function auditAddRoute(query) {
  const sku = param(query, 'sku');
  const warehouseId = param(query, 'warehouse');
  // When the SKU and site are already known, the system figure is filled in
  // from the stock data rather than left for staff to look up by hand.
  const system = sku && warehouseId ? await systemQuantityFor(sku, warehouseId) : null;

  return html(
    renderAuditFormPage({
      mode: 'add',
      values: {
        sku,
        warehouseId,
        systemQuantity: system === null ? '' : String(system),
        countedQuantity: '',
        countedOn: today(),
        countedBy: '',
      },
      ...(await formLists()),
    }),
  );
}

async function auditEditRoute(query) {
  const count = await findAuditCount(param(query, 'id'));
  if (!count) return notFound();

  return html(renderAuditFormPage({ mode: 'edit', values: auditToForm(count), ...(await formLists()) }));
}

async function auditDeleteRoute(query) {
  const row = (await auditReport()).find((entry) => entry.id === param(query, 'id'));
  if (!row) return notFound();

  return html(renderAuditDeletePage({ row, flash: flashFrom(query) }));
}

async function auditAddPost(form) {
  const values = formValues(form);
  const result = await addAuditCount(values);
  if (!result.ok) {
    return html(renderAuditFormPage({ mode: 'add', values, errors: result.errors, ...(await formLists()) }), 400);
  }

  return redirect(doneAt('/audit', 'audit-added', result.value.id));
}

async function auditEditPost(form) {
  const id = field(form, 'id');
  if (!(await findAuditCount(id))) return notFound();

  const values = { ...formValues(form), id };
  const result = await updateAuditCount(id, values);
  if (!result.ok) {
    return html(renderAuditFormPage({ mode: 'edit', values, errors: result.errors, ...(await formLists()) }), 400);
  }

  return redirect(doneAt('/audit', 'audit-updated', result.value.id));
}

async function auditDeletePost(form) {
  const id = field(form, 'id');
  const result = await deleteAuditCount(id);
  if (!result.ok) return notFound();

  return redirect(doneAt('/audit', 'audit-deleted', id));
}

/**
 * Product thumbnail route.
 *
 * The SKU is only ever used to look up a catalogue entry; it is never used to
 * touch the filesystem, so a crafted path cannot reach anything. An unknown SKU
 * still renders a neutral placeholder rather than a broken image.
 *
 * @param {string} pathname
 * @returns {object}
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
 * @returns {{status: number, contentType: string, body: string}}
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
    case '/products/add':
      return productAddRoute();
    case '/products/edit':
      return productEditRoute(query);
    case '/products/delete':
      return productDeleteRoute(query);

    case '/stock':
      return stockRoute(query);
    case '/stock/view':
      return stockViewRoute(query);
    case '/stock/add':
      return stockAddRoute(query);
    case '/stock/edit':
      return stockEditRoute(query);
    case '/stock/delete':
      return stockDeleteRoute(query);

    case '/alerts':
      return alertsRoute(query);
    case '/alerts/view':
      return issueViewRoute(query);
    case '/alerts/edit':
      return issueEditRoute(query);

    case '/transfers':
      return transfersRoute(query);
    case '/transfers/view':
      return transferViewRoute(query);
    case '/transfers/add':
      return transferAddRoute();
    case '/transfers/edit':
      return transferEditRoute(query);
    case '/transfers/delete':
      return transferDeleteRoute(query);

    case '/audit':
      return auditRoute(query);
    case '/audit/view':
      return auditViewRoute(query);
    case '/audit/add':
      return auditAddRoute(query);
    case '/audit/edit':
      return auditEditRoute(query);
    case '/audit/delete':
      return auditDeleteRoute(query);

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
 * Kept separate from route() rather than folded into it with a method
 * argument, so the read-only routing above stays exactly what it was: a pure
 * function of path and query that cannot change anything. Everything that can
 * change something is reachable only from here, and only by POST.
 *
 * The answer is either a redirect - the write went through - or the form again,
 * with a 400, the values still in it and the problems named. Nothing partial is
 * ever saved.
 *
 * @param {string} pathname
 * @param {URLSearchParams} [form] The decoded request body.
 * @returns {{status: number, contentType: string, body: string, location?: string}}
 */
export async function routeForm(pathname, form = new URLSearchParams()) {
  switch (normalisePath(pathname)) {
    case '/products/add':
      return productAddPost(form);
    case '/products/edit':
      return productEditPost(form);
    case '/products/delete':
      return productDeletePost(form);

    case '/stock/add':
      return stockAddPost(form);
    case '/stock/edit':
      return stockEditPost(form);
    case '/stock/delete':
      return stockDeletePost(form);

    case '/alerts/edit':
      return issueEditPost(form);
    case '/alerts/resolve':
      return issueResolvePost(form);

    case '/transfers/add':
      return transferAddPost(form);
    case '/transfers/edit':
      return transferEditPost(form);
    case '/transfers/delete':
      return transferDeletePost(form);

    case '/audit/add':
      return auditAddPost(form);
    case '/audit/edit':
      return auditEditPost(form);
    case '/audit/delete':
      return auditDeletePost(form);

    default:
      return notFound();
  }
}

