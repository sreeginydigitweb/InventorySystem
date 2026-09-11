/**
 * The dummy dataset, in one place.
 *
 * Nothing in this folder is real. There is no database, no network call and no
 * external inventory source anywhere in this system: the data below is the
 * whole of it, and it is loaded straight from these modules at startup.
 */

export { WAREHOUSES, findWarehouse, warehouseName } from './warehouses.js';
export { PRODUCTS, CATEGORIES, SUPPLIERS, findProduct, productName, imagePathFor } from './products.js';
export { STOCK_LINES } from './stock.js';
export { TRANSFERS, TRANSFER_STATUSES } from './transfers.js';
export { AUDIT_COUNTS } from './audit.js';
