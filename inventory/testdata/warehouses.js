/**
 * Warehouses held in the test dataset.
 *
 * Every record here is invented. No real site, address or company appears in
 * this file, and none of it comes from a live inventory system.
 */

/**
 * @typedef {object} Warehouse
 * @property {string} id       Warehouse identifier, used as the key everywhere else.
 * @property {string} name     Display name.
 * @property {string} location Town or city the site operates from.
 */

/** @type {readonly Warehouse[]} */
export const WAREHOUSES = Object.freeze([
  Object.freeze({ id: 'WH-BIR', name: 'Birmingham Central', location: 'Birmingham' }),
  Object.freeze({ id: 'WH-MAN', name: 'Manchester North', location: 'Manchester' }),
  Object.freeze({ id: 'WH-LDS', name: 'Leeds Overflow', location: 'Leeds' }),
  Object.freeze({ id: 'WH-BRS', name: 'Bristol South West', location: 'Bristol' }),
]);

/**
 * Look up a warehouse by identifier.
 *
 * Returns null rather than throwing: stock rows are allowed to reference a
 * warehouse that does not exist, and that is a condition the mismatch rule is
 * meant to detect, not a crash.
 *
 * @param {string} id
 * @returns {Warehouse|null}
 */
export function findWarehouse(id) {
  return WAREHOUSES.find((warehouse) => warehouse.id === id) ?? null;
}

/**
 * Display name for a warehouse identifier, falling back to the raw id so an
 * unknown warehouse is still identifiable on screen.
 *
 * @param {string} id
 * @returns {string}
 */
export function warehouseName(id) {
  return findWarehouse(id)?.name ?? id;
}
