/**
 * The inventory detection rules.
 *
 * This module is the whole of the business logic. It owns no HTML, no routing
 * and no data access: every rule is a pure function of the rows it is handed.
 * Each is a small named function so that the rule can be read directly rather
 * than inferred from the code around it.
 *
 * ---------------------------------------------------------------------------
 * AVAILABLE STOCK
 *
 *   available = onHand - reserved
 *
 * Derived, never stored, so it cannot drift from the figures it comes from.
 *
 * ---------------------------------------------------------------------------
 * THE SIX RULES
 *
 *   Low Stock             available is below the minimum, but there is still
 *                         something left to sell.
 *   Out of Stock          nothing is available to sell: available is zero, or
 *                         has been driven below zero by over-reservation.
 *   Negative Inventory    onHand itself is below zero.
 *   Warehouse/SKU Mismatch  the line points at a warehouse that does not exist,
 *                         a SKU that is not in the catalogue, or a site the SKU
 *                         is not approved to be held at.
 *   Inactive Listing      the listing has been withdrawn but stock is still
 *                         being held against it.
 *   Slow-Moving Stock     an active product with stock on hand that has barely
 *                         moved in the last 90 days.
 *
 * ---------------------------------------------------------------------------
 * THREE DELIBERATE CHOICES, STATED HERE RATHER THAN HIDDEN IN THE CODE
 *
 * 1. Low Stock and Out of Stock are mutually exclusive. Taken completely
 *    literally, a line with nothing available is also "below minimum" and would
 *    raise both. Staff read them as different problems - running low versus
 *    having none - and the dashboard counts only add up if each line falls into
 *    exactly one band. So Low Stock additionally requires available > 0.
 *
 * 2. Slow-Moving requires the product to still be active. Stock sitting against
 *    a withdrawn listing is already reported as an Inactive Listing; reporting
 *    it a second time as slow-moving would add noise, not information.
 *
 * 3. Two of these rules have an input the source database does not hold, and
 *    each says so rather than guessing:
 *
 *    - The source has no minimum or reorder level for a SKU at a site. Rather
 *      than invent one per product, Low Stock is judged against a single
 *      application-wide threshold, LOW_STOCK_THRESHOLD, stated once below and
 *      printed on the screens that use it. A line may still carry its own
 *      `minimum`, and one that does is judged against that instead.
 *
 *    - The source has no list of which sites a SKU is approved to be held at.
 *      A product whose `approvedWarehouses` is null is not checked for that,
 *      because checking against a list nobody keeps would report every line in
 *      the business as misplaced. The two faults that CAN be seen in the real
 *      data - a warehouse that does not exist, and a SKU that is not in the
 *      catalogue - are still detected.
 */

/**
 * The catalogue a rule is judged against.
 *
 * Three of the six rules need to know what a SKU and a warehouse ARE, not just
 * what the stock line says. That used to be a hidden import of the test data;
 * now the rows come from the database, so it is passed in explicitly. The rules
 * stay pure functions of what they are handed - which is also why they can be
 * tested without a database.
 *
 * @typedef {{findProduct: (sku: string) => object|null, findWarehouse: (id: string) => object|null}} Catalogue
 */

/**
 * Build a catalogue from lists of products and warehouses.
 *
 * @param {readonly object[]} products
 * @param {readonly object[]} warehouses
 * @returns {Catalogue}
 */
export function makeCatalogue(products, warehouses) {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const byId = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));

  return {
    findProduct: (sku) => bySku.get(sku) ?? null,
    findWarehouse: (id) => byId.get(id) ?? null,
  };
}

/**
 * Units sold in the last 90 days at or below which a product counts as
 * slow-moving. A single threshold, stated once.
 */
export const SLOW_MOVING_THRESHOLD = 5;

/**
 * Available stock at or below which a line counts as running low, used when the
 * line itself carries no minimum.
 *
 * THIS IS AN APPLICATION SETTING, NOT A FIGURE FROM THE SOURCE DATABASE. The
 * source holds no minimum or reorder level for a SKU at a site - there is no
 * such column anywhere in it - so there is nothing to read. The choice is
 * between dropping the rule and stating a threshold; a threshold stated once,
 * in one place, and printed on the screens it governs is the more useful of the
 * two, and it is honest as long as it is never presented as the business's own
 * number. Change it here and every screen follows.
 */
export const LOW_STOCK_THRESHOLD = 10;

/**
 * The highest available figure that still counts as low.
 *
 * Two cases, and they differ by one on purpose:
 *
 *   - A row carrying its own `minimum` is the level that site is expected to
 *     HOLD, so sitting exactly on it is not low: the test is
 *     `available < minimum`, which is `available <= minimum - 1`.
 *
 *   - With no minimum - which is every row from the source database, because
 *     it has no such column - the test is the agreed application threshold,
 *     INCLUSIVE: `available > 0 AND available <= LOW_STOCK_THRESHOLD`.
 *
 * Both are expressed as one ceiling so there is a single comparison below.
 *
 * @param {{minimum?: number}} line
 * @returns {number}
 */
export function lowStockCeiling(line) {
  return typeof line.minimum === 'number' ? line.minimum - 1 : LOW_STOCK_THRESHOLD;
}

/**
 * The minimum shown against a line, for display only.
 *
 * @param {{minimum?: number}} line
 * @returns {number}
 */
export function minimumFor(line) {
  return typeof line.minimum === 'number' ? line.minimum : LOW_STOCK_THRESHOLD;
}

/** The health bands a stock line can fall into. Exactly one applies to a line. */
export const STOCK_STATUS = Object.freeze({
  HEALTHY: 'Healthy',
  LOW: 'Low Stock',
  OUT: 'Out of Stock',
  NEGATIVE: 'Negative Inventory',
});

/** The six issue types the system detects, in the order they are displayed. */
export const ISSUE_TYPES = Object.freeze([
  'Low Stock',
  'Out of Stock',
  'Negative Inventory',
  'Warehouse/SKU Mismatch',
  'Inactive Listing',
  'Slow-Moving Stock',
]);

/**
 * Available stock for a line: what is on hand, less what is already committed.
 *
 * @param {{onHand: number, reserved: number}} line
 * @returns {number}
 */
export function availableStock(line) {
  return line.onHand - line.reserved;
}

/**
 * NEGATIVE INVENTORY: the quantity on hand is below zero.
 *
 * @param {{onHand: number}} line
 * @returns {boolean}
 */
export function isNegativeInventory(line) {
  return line.onHand < 0;
}

/**
 * OUT OF STOCK: nothing is available to sell.
 *
 * Zero available, or below zero because more units are reserved than are on the
 * shelf. Either way there is nothing left to sell, so both are reported the
 * same way.
 *
 * @param {{onHand: number, reserved: number}} line
 * @returns {boolean}
 */
export function isOutOfStock(line) {
  return availableStock(line) <= 0;
}

/**
 * LOW STOCK: available stock is below the minimum this site should hold, while
 * there is still something left to sell.
 *
 * See choice 1 in the header for why the second condition is there.
 *
 * @param {{onHand: number, reserved: number, minimum: number}} line
 * @returns {boolean}
 */
export function isLowStock(line) {
  const available = availableStock(line);
  return available > 0 && available <= lowStockCeiling(line);
}

/**
 * The single health band for a stock line, most serious first.
 *
 * @param {{onHand: number, reserved: number, minimum: number}} line
 * @returns {string} One of STOCK_STATUS.
 */
export function stockStatus(line) {
  if (isNegativeInventory(line)) return STOCK_STATUS.NEGATIVE;
  if (isOutOfStock(line)) return STOCK_STATUS.OUT;
  if (isLowStock(line)) return STOCK_STATUS.LOW;
  return STOCK_STATUS.HEALTHY;
}

/**
 * WAREHOUSE/SKU MISMATCH: the line points somewhere it should not.
 *
 * Three separate faults are reported by this one rule, because to a member of
 * staff they are the same problem - this stock record cannot be trusted:
 *
 *   - the warehouse identifier is not a real warehouse
 *   - the SKU is not in the product catalogue
 *   - the SKU is real, the warehouse is real, but the SKU is not approved to be
 *     held at that site
 *
 * @param {{sku: string, warehouseId: string}} line
 * @param {Catalogue} catalogue
 * @returns {string|null} Why it is a mismatch, or null when the line is fine.
 */
export function warehouseMismatchReason(line, catalogue) {
  const warehouse = catalogue.findWarehouse(line.warehouseId);
  if (!warehouse) {
    return `Warehouse ${line.warehouseId} is not a recognised warehouse`;
  }

  const product = catalogue.findProduct(line.sku);
  if (!product) {
    return `SKU ${line.sku} is not in the product catalogue`;
  }

  // Null means the source keeps no approval list. Checking a real SKU at a real
  // site against a list nobody maintains would report the entire business as
  // misplaced stock, so the check is skipped rather than failed. See choice 3
  // in the header.
  if (product.approvedWarehouses && !product.approvedWarehouses.includes(line.warehouseId)) {
    return `${line.sku} is not approved to be held at ${warehouse.name}`;
  }

  return null;
}

/**
 * INACTIVE LISTING: the listing has been withdrawn but stock is still held.
 *
 * A withdrawn listing holding no stock is tidy, not a problem, so stock on hand
 * is required.
 *
 * @param {{sku: string, onHand: number}} line
 * @param {Catalogue} catalogue
 * @returns {boolean}
 */
export function isInactiveListing(line, catalogue) {
  const product = catalogue.findProduct(line.sku);
  return product !== null && product.active === false && line.onHand > 0;
}

/**
 * SLOW-MOVING STOCK: an active product, still holding stock, that has barely
 * moved in the last 90 days.
 *
 * See choice 2 in the header for why withdrawn listings are excluded.
 *
 * @param {{sku: string, onHand: number}} line
 * @param {Catalogue} catalogue
 * @returns {boolean}
 */
export function isSlowMoving(line, catalogue) {
  const product = catalogue.findProduct(line.sku);
  return (
    product !== null &&
    product.active === true &&
    line.onHand > 0 &&
    product.unitsSoldLast90Days <= SLOW_MOVING_THRESHOLD
  );
}

/**
 * Expand a stored stock line into the view the rest of the system works with:
 * the stored figures, the derived available quantity, and the health band.
 *
 * @param {object} line
 * @returns {object}
 */
export function describeStockLine(line) {
  return {
    ...line,
    available: availableStock(line),
    minimum: minimumFor(line),
    status: stockStatus(line),
  };
}

/**
 * The whole-business position for ONE SKU: its stock summed across every
 * warehouse it is held at, then banded by the same four rules a single line is.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IS NOT A COUNT OF LINES
 *
 * A stock line is one SKU at one warehouse. The catalogue is 6,510 SKUs and
 * they are spread over 68,237 lines, so "how many are healthy?" has two
 * completely different answers depending on which you count - and the two are
 * not interchangeable:
 *
 *   counting LINES  answers "how many SKU/warehouse records are healthy",
 *                   which is dominated by the fact that most SKUs have a row at
 *                   all ten sites and hold nothing at most of them.
 *   counting SKUs   answers "how many products can we actually sell", which is
 *                   the question the dashboard is asked.
 *
 * The dashboard counts SKUs, so that all six cards are the same unit as Total
 * SKUs and the four bands add up to the catalogue exactly.
 *
 * Summed, not worst-of: a product with 12 units at one site and none at the
 * other nine can be sold, and reporting it as out of stock because one shelf is
 * empty would be wrong. Reserved is summed too, so committed stock does not
 * count as cover anywhere.
 *
 * The aggregate deliberately carries no `minimum`: a minimum belongs to a site,
 * and there is no such thing as the minimum of ten sites at once. So the band
 * is judged against the application threshold, which is also the only thing the
 * source database could ever support.
 *
 * @param {string} sku
 * @param {readonly object[]} lines  Every stock line for that SKU. May be empty.
 * @returns {object}
 */
export function describeSkuPosition(sku, lines) {
  let onHand = 0;
  let reserved = 0;

  for (const line of lines) {
    onHand += line.onHand;
    reserved += line.reserved;
  }

  return describeStockLine({ sku, onHand, reserved, warehouseCount: lines.length });
}

/**
 * Every issue found across a set of stock lines.
 *
 * One line can raise more than one issue, and deliberately so: stock held at
 * the wrong site can also be running low, and staff need to see both. The
 * exceptions are Low Stock and Out of Stock, which cannot both apply.
 *
 * @param {readonly object[]} lines
 * @param {Catalogue} catalogue
 * @returns {object[]} Issues, each naming the SKU and warehouse affected.
 */
export function detectIssues(lines, catalogue) {
  const issues = [];

  for (const line of lines) {
    const available = availableStock(line);

    const raise = (type, detail) => {
      issues.push({
        type,
        sku: line.sku,
        warehouseId: line.warehouseId,
        onHand: line.onHand,
        reserved: line.reserved,
        available,
        minimum: minimumFor(line),
        detail,
      });
    };

    if (isNegativeInventory(line)) {
      raise('Negative Inventory', `On hand is ${line.onHand}, which is below zero`);
    }

    // A negative line is already reported as the more serious problem; it does
    // not also need to be listed as out of stock.
    if (isOutOfStock(line) && !isNegativeInventory(line)) {
      raise(
        'Out of Stock',
        available === 0
          ? 'Nothing available to sell'
          : `Over-reserved: ${line.reserved} reserved against ${line.onHand} on hand`,
      );
    }

    if (isLowStock(line)) {
      raise('Low Stock', `${available} available against a minimum of ${minimumFor(line)}`);
    }

    const mismatch = warehouseMismatchReason(line, catalogue);
    if (mismatch) {
      raise('Warehouse/SKU Mismatch', mismatch);
    }

    if (isInactiveListing(line, catalogue)) {
      raise('Inactive Listing', `Listing is inactive but ${line.onHand} units are still held`);
    }

    if (isSlowMoving(line, catalogue)) {
      const product = catalogue.findProduct(line.sku);
      raise(
        'Slow-Moving Stock',
        `${product.unitsSoldLast90Days} sold in 90 days against ${line.onHand} units held`,
      );
    }
  }

  return issues;
}
