/**
 * Product catalogue for the test dataset.
 *
 * Every product, supplier and SKU here is invented. Nothing in this file comes
 * from a real catalogue, a real supplier or a live inventory system.
 *
 * Two fields exist specifically so the detection rules have something to work
 * from, and are described here rather than buried in the rules:
 *
 *   active            false means the listing has been withdrawn from sale.
 *                     Stock still sitting against an inactive listing is a
 *                     problem, which is what the Inactive Listing rule finds.
 *
 *   unitsSoldLast90Days
 *                     A simple movement figure. A low number against stock that
 *                     is still being held is what the Slow-Moving rule finds.
 *                     There is no sales history in the MVP - this single field
 *                     stands in for it.
 *
 *   approvedWarehouses
 *                     The sites this SKU is meant to be held at. Stock recorded
 *                     anywhere else is what the Warehouse/SKU Mismatch rule
 *                     finds.
 */

/**
 * @typedef {object} Product
 * @property {string} sku
 * @property {string} name
 * @property {string} image               Path to the generated thumbnail for this SKU.
 * @property {string} category
 * @property {string} supplier
 * @property {boolean} active             False once the listing is withdrawn.
 * @property {number} unitsSoldLast90Days Movement figure used by the slow-moving rule.
 * @property {readonly string[]} approvedWarehouses Sites this SKU may be held at.
 */

/** Product categories, in display order. */
export const CATEGORIES = Object.freeze([
  'Ceiling Lights',
  'Outdoor Lighting',
  'Bulbs',
  'Fittings & Spares',
  'Lamps',
]);

/** Suppliers used in the dummy catalogue. All invented. */
export const SUPPLIERS = Object.freeze([
  'Northgate Lighting Ltd',
  'Halden Electrical Supplies',
  'Verity Home Fittings',
  'Mercer & Roe Components',
]);

/**
 * Thumbnail path for a SKU. The image is generated as an SVG by the server, so
 * there is no binary asset in the repository and nothing is fetched over the
 * network.
 *
 * @param {string} sku
 * @returns {string}
 */
export function imagePathFor(sku) {
  return `/images/${sku}.svg`;
}

const catalogue = [
  {
    sku: 'SIC-1001',
    name: 'Aurora 3-Light Ceiling Pendant',
    category: 'Ceiling Lights',
    supplier: 'Northgate Lighting Ltd',
    active: true,
    unitsSoldLast90Days: 142,
    approvedWarehouses: ['WH-BIR', 'WH-MAN'],
  },
  {
    sku: 'SIC-1002',
    name: 'Halden Flush Ceiling Dome 30cm',
    category: 'Ceiling Lights',
    supplier: 'Halden Electrical Supplies',
    active: true,
    unitsSoldLast90Days: 96,
    approvedWarehouses: ['WH-BIR', 'WH-MAN', 'WH-LDS'],
  },
  {
    sku: 'SIC-1003',
    name: 'Verity Brushed Chrome Spotlight Bar',
    category: 'Ceiling Lights',
    supplier: 'Verity Home Fittings',
    active: true,
    unitsSoldLast90Days: 61,
    approvedWarehouses: ['WH-BIR', 'WH-BRS'],
  },
  {
    sku: 'SIC-2001',
    name: 'Cobble Outdoor Wall Lantern',
    category: 'Outdoor Lighting',
    supplier: 'Northgate Lighting Ltd',
    active: true,
    unitsSoldLast90Days: 74,
    approvedWarehouses: ['WH-MAN', 'WH-BRS'],
  },
  {
    sku: 'SIC-2002',
    name: 'Pathline Solar Bollard 450mm',
    category: 'Outdoor Lighting',
    supplier: 'Verity Home Fittings',
    active: true,
    unitsSoldLast90Days: 3,
    approvedWarehouses: ['WH-LDS', 'WH-BRS'],
  },
  {
    sku: 'SIC-3001',
    name: 'Warm White GU10 LED Bulb (5 pack)',
    category: 'Bulbs',
    supplier: 'Halden Electrical Supplies',
    active: true,
    unitsSoldLast90Days: 388,
    approvedWarehouses: ['WH-BIR', 'WH-MAN', 'WH-LDS', 'WH-BRS'],
  },
  {
    sku: 'SIC-3002',
    name: 'Vintage Edison Filament Bulb E27',
    category: 'Bulbs',
    supplier: 'Mercer & Roe Components',
    active: true,
    unitsSoldLast90Days: 55,
    approvedWarehouses: ['WH-BIR', 'WH-LDS'],
  },
  {
    sku: 'SIC-3003',
    name: 'Daylight B22 LED Bulb (3 pack)',
    category: 'Bulbs',
    supplier: 'Halden Electrical Supplies',
    active: true,
    unitsSoldLast90Days: 210,
    approvedWarehouses: ['WH-BIR', 'WH-MAN'],
  },
  {
    sku: 'SIC-4001',
    name: 'Chrome Ceiling Rose Plate',
    category: 'Fittings & Spares',
    supplier: 'Mercer & Roe Components',
    active: true,
    unitsSoldLast90Days: 47,
    approvedWarehouses: ['WH-BIR', 'WH-MAN'],
  },
  {
    sku: 'SIC-4002',
    name: 'Braided Fabric Flex 3m - Black',
    category: 'Fittings & Spares',
    supplier: 'Mercer & Roe Components',
    active: true,
    unitsSoldLast90Days: 2,
    approvedWarehouses: ['WH-LDS'],
  },
  {
    sku: 'SIC-4003',
    name: 'Lamp Shade Reducer Ring Set',
    category: 'Fittings & Spares',
    supplier: 'Verity Home Fittings',
    active: false,
    unitsSoldLast90Days: 1,
    approvedWarehouses: ['WH-BIR', 'WH-LDS'],
  },
  {
    sku: 'SIC-5001',
    name: 'Marlow Tripod Floor Lamp',
    category: 'Lamps',
    supplier: 'Northgate Lighting Ltd',
    active: true,
    unitsSoldLast90Days: 38,
    approvedWarehouses: ['WH-MAN', 'WH-BRS'],
  },
  {
    sku: 'SIC-5002',
    name: 'Ashcroft Touch Table Lamp',
    category: 'Lamps',
    supplier: 'Northgate Lighting Ltd',
    active: false,
    unitsSoldLast90Days: 12,
    approvedWarehouses: ['WH-BIR', 'WH-MAN'],
  },
  {
    sku: 'SIC-5003',
    name: 'Linen Drum Shade 40cm',
    category: 'Lamps',
    supplier: 'Verity Home Fittings',
    active: true,
    unitsSoldLast90Days: 4,
    approvedWarehouses: ['WH-BRS'],
  },
];

/**
 * The live catalogue for the running session.
 *
 * The array itself is not frozen: store.js adds, replaces and removes entries
 * in place when staff use the Add/Edit/Delete screens, and because the binding
 * never changes every module that imported it sees those edits immediately.
 * Each record stays frozen, so an edit replaces a product rather than quietly
 * mutating one that another screen is already holding.
 *
 * Nothing is written to disk. The catalogue returns to exactly the list above
 * when the server restarts.
 *
 * @type {Product[]}
 */
export const PRODUCTS = catalogue.map((product) =>
  Object.freeze({
    ...product,
    image: imagePathFor(product.sku),
    approvedWarehouses: Object.freeze([...product.approvedWarehouses]),
  }),
);

/**
 * Look up a product by SKU.
 *
 * Returns null rather than throwing. A stock row may reference a SKU that is
 * not in the catalogue, and that is a condition the mismatch rule reports.
 *
 * @param {string} sku
 * @returns {Product|null}
 */
export function findProduct(sku) {
  return PRODUCTS.find((product) => product.sku === sku) ?? null;
}

/**
 * Display name for a SKU, falling back to a clear label when the SKU is not in
 * the catalogue at all.
 *
 * @param {string} sku
 * @returns {string}
 */
export function productName(sku) {
  return findProduct(sku)?.name ?? 'Unknown SKU';
}
