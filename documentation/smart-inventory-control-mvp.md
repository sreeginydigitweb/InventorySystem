# Smart Inventory Control

How the system is run, where its data comes from, and how each inventory problem
is detected.

The application reads **`ledsone`**, the existing business inventory database.
It has no database of its own, no schema of its own and no dummy data. Every
figure on every screen is read from `ledsone` when the page is built.

**The source is read-only.** Nothing in this application writes to `ledsone` —
no INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, migration or seed — and there is
no add, edit or delete screen anywhere in it. See "Why the source cannot be
written to" below.

## Running it

Node 20 or newer.

```
npm install                                  # one dependency: pg
cp inventory/.env.example inventory/.env     # then fill it in
npm start                                    # http://localhost:3000/
```

There is no schema to create, no migration to run and no seed step. `ledsone`
already holds the data.

`inventory/.env` holds the connection and is git-ignored. `DB_NAME` must be
`ledsone`. `DB_USER` should name a role holding `SELECT` and nothing else; the
application checks at startup and **refuses to start** against a role that can
write.

## Running the tests

```
npm test
```

The suite opens **no database connection at all**. Every test that needs data
points the store at the sample arrays in `inventory/testdata/`, held in memory:

```js
useSource(memorySource({ products: PRODUCTS, warehouses: WAREHOUSES, stockLines: STOCK_LINES }));
```

There is no `--env-file`, no connection string on the test path and no loader.
The suite runs anywhere, is unaffected by what is in the real data today, and
cannot touch it. Proven by running it with the credentials deliberately
sabotaged: it still passes.

`inventory/testdata/` is invented sample data used as **test input only**. It is
never written to any database, and nothing in the running application imports
it. See `inventory/testdata/README.md`.

## Where the data comes from

| | |
| --- | --- |
| Database | `ledsone` |
| Catalogue | `inventory.products WHERE inventory_bool = true` — **6,510 SKUs** |
| Warehouses | `inventory.warehouse` — 10 sites |
| Stock | `inventory.physical_product_stock` — 68,237 lines for the catalogue |

The other ~38,000 rows in `inventory.products` are catalogue history and are not
SKUs this business tracks stock for, which is what `inventory_bool` records.

### Field by field

| Field | Source |
| --- | --- |
| SKU, product name, description | `inventory.products` (`sku`, `title`, `description`) |
| Product image | `inventory.product_media` where `type = 'main-image'`, falling back to `inventory.product_images`. A SKU with neither gets an SVG the server draws from its initials. |
| Category | `listings.shopify_listings.product_type`, most recently updated listing for the SKU |
| Supplier | `suppliers.order_items` → `suppliers.orders` → `suppliers.suppliers`, most recent purchase order containing the SKU |
| Listing status | `inventory.end_of_line_products.end_of_line_status`. `Permanent` → Inactive; `Temporary`, `Not Sure` and no row → Active. The raw value is shown on the product page. |
| Units sold (90 days) | `order_management.orders` → `order_item_info` → `order_combo`, summing `order_combo.qty`. `order_combo` is the source's own expansion of an order line into the SKUs it contains, so a SKU sold only inside a bundle is still counted and the quantity is already multiplied out. |
| Current | `inventory.physical_product_stock.quantity` |
| Reserved | `inventory.physical_product_stock.reserved_quantity` |
| Available | **Not a column.** Always `Current − Reserved`, derived on read. |
| Shelf location | `product_shelf_location`, `product_bulk_location` |

Coverage is honest, not padded: category resolves for 3,812 of 6,510 SKUs and
supplier for 1,628. The rest display **Not recorded** — never a blank or a zero
that could be mistaken for a figure.

### What the source does not hold

| Missing | Affects | What the system does |
| --- | --- | --- |
| Minimum / reorder level | Low Stock rule, Low Stock card | Judged against one application threshold of **10 available**, stated once in `rules.js` and printed above the Warehouse Stock table |
| Transfer number / workflow status | Transfers screen | Reference is derived from the event and labelled so; status is `Received` or `Received (Adjusted)` only |
| Physical stock counts | Inventory Audit screen, Discrepancies card | Screen is empty and explains why; card reads 0 |
| Approved-sites list per SKU | Warehouse/SKU Mismatch rule | That one check is skipped; the two faults visible in real data are still detected |

Every schema was searched for each of these. `listings.bandq_transfers` is a
record of category spreadsheets uploaded to B&Q, not stock movements.

Transfers themselves *are* recorded, in the free-text stock-change log
`inventory.product_history.history`. A `UK stock changes:` line where one unit
fell and another rose is a transfer; the warehouse is taken from the `UnitN`
token, never the bracketed legacy column name, which disagrees with it. That log
still cannot serve the audit screen: it holds from/to figures, not a counted
quantity against a system quantity, so `Counted − System` cannot be derived from
it without inventing two of its three terms.

## How the code is laid out

| Path | Responsibility |
| --- | --- |
| `inventory/db.js` | The PostgreSQL pool, and the only place a connection is made. Read-only. |
| `inventory/source.js` | The only module that knows `ledsone`'s tables. All the SQL, and the mapping to the shapes the screens use. |
| `inventory/store.js` | What the rest of the system asks for data. Read-only, and swappable via `useSource()` for tests. |
| `inventory/rules.js` | The six detection rules, the stock health bands, and the per-SKU position the dashboard counts. |
| `inventory/reports.js` | Derived views: dashboard figures, per-screen rows. |
| `inventory/render.js` | HTML only. |
| `inventory/router.js` | Path and query to a response. Pure, so it is testable without a server. |
| `inventory/server.js` | The HTTP shell. |
| `inventory/testdata/` | Invented sample rows. Test input only. |

### Why the source cannot be written to

Four independent things, any one of which would be enough:

1. **No write statement exists.** Every statement in the codebase is a `SELECT`.
2. **No write route exists.** `route()` has view routes only. `routeForm()`
   answers every POST with a page explaining the source is read-only (HTTP 405).
   The only `<form>` on any screen is the filter bar, which is a `GET`.
3. **The connection refuses writes.** The pool opens every connection with
   `default_transaction_read_only = on` as a startup option, so the *server*
   rejects a write on it whatever the application asks for.
4. **The role holds no write privilege.** `checkConnection()` asks PostgreSQL at
   startup whether the role could write to `inventory.products`. If the answer
   is ever yes, the application refuses to start.

### Reads are cached for a minute

The catalogue is 6,510 SKUs and 68,237 stock lines on a remote database, and the
dashboard needs products, warehouses and stock together. Each read is cached
in-process for `INVENTORY_CACHE_MS` (default 60,000) and shared by every request
arriving during it. Nothing is written back, so a cached figure can only ever be
up to a minute behind — never inconsistent, and never wrong in a way a refresh
will not fix.

## The detection rules

All six live in `inventory/rules.js`, one named function each.

| Rule | Fires when |
| --- | --- |
| **Low Stock** | `available > 0` and `available <= 10` |
| **Out of Stock** | `available <= 0` — either the shelf is empty or every unit is reserved |
| **Negative Inventory** | `onHand < 0` |
| **Warehouse/SKU Mismatch** | The warehouse does not exist, or the SKU is not in the catalogue |
| **Inactive Listing** | The listing is withdrawn but `onHand > 0` |
| **Slow-Moving Stock** | The product is active, holds stock, and sold 5 or fewer units in 90 days |

Issues are **recalculated on every page load and never stored**. There is no
alert table, no action status and no note — so an issue cannot be dismissed, and
a problem that still exists in the data is still listed and still counted. It
disappears only when the data changes.

### The Low Stock threshold is an application setting

`ledsone` has no minimum or reorder-level column anywhere, so there is nothing
to read. Low Stock is judged against `LOW_STOCK_THRESHOLD = 10` in `rules.js`,
**inclusive**: `available > 0 AND available <= 10`. The Warehouse Stock screen
prints the threshold and says it is an application setting, so it is never
presented as a figure the business set.

A row that carries its own `minimum` — which no row from `ledsone` does, but the
sample data used in tests does — is judged `available < minimum` instead, since
a stated minimum is the level a site should *hold*. Both are expressed as one
ceiling in `lowStockCeiling()`.

### Stock health bands

Every row falls into exactly one band, taken most serious first:

```
Negative Inventory  ->  Out of Stock  ->  Low Stock  ->  Healthy
```

### Three deliberate choices

1. **Low Stock and Out of Stock never both fire.** Read completely literally, a
   row with nothing available is also below its minimum and would raise both.
   Staff read them as different problems — running low against having none — and
   the dashboard only adds up if each row sits in one band. So Low Stock
   additionally requires `available > 0`.

2. **Slow-Moving requires the listing to be active.** Stock against a withdrawn
   listing is already reported as an Inactive Listing; reporting it again would
   add noise rather than information.

3. **Warehouse/SKU Mismatch skips the approval check.** A product's
   `approvedWarehouses` is `null` because the source keeps no such list, and
   checking against a list nobody maintains would report every row in the
   business as misplaced. The two faults visible in real data are still caught —
   3,160 rows point at warehouse `33`, which is not in `inventory.warehouse`.

One row *can* raise several issues where they are genuinely different problems.

## The dashboard counts SKUs, not stock lines

The stock cards count **catalogue SKUs**, so they are one unit and comparable
with each other. (Stock Transfers is the exception: it counts recorded transfer
lines and links to the Transfers screen.) A SKU's band comes from its stock summed across every warehouse
(`describeSkuPosition` in `rules.js`) — summed, not worst-of, because a product
with 12 units at one site and none at the other nine can still be sold. Reserved
is summed too, so committed stock does not count as cover anywhere.

This distinction is not cosmetic. Counting stock lines gave Healthy Stock =
**6,791** against a catalogue of **6,510** — a figure larger than the set it is a
subset of, because most SKUs carry a row at all ten warehouses. A stock line is
one SKU at one warehouse; "how many SKU/warehouse records are healthy" and "how
many products can we actually sell" are different questions, and the dashboard
is asked the second.

Because each SKU falls into exactly one band:

```
Healthy + Low + Out of Stock + Negative  ===  Total SKUs
```

Verified against `ledsone` on 2026-09-11: `4,010 + 561 + 1,379 + 560 = 6,510`.

Each card links through to the screen listing exactly the SKUs it counted, so
the card and its destination always show the same number.

## The six areas

| Area | Path | Shows |
| --- | --- | --- |
| Dashboard | `/` | Total SKUs, Healthy Stock, Low Stock, Out-of-Stock Items, Discrepancies, Stock Transfers, plus a breakdown by issue type and by transfer status. Every card links through to the screen behind it. |
| Products | `/products` | SKU, image, name, category, supplier, listing status, units held and stock position. Search across SKU, name and supplier; filter by category, supplier and stock position. |
| Warehouse Stock | `/stock` | SKU, product, warehouse, current, reserved, available and health band. Search by SKU or name; filter by warehouse and band. Problem rows are tinted and negative figures shown in red. |
| Alerts / Issues | `/alerts` | Every detected issue with the SKU, warehouse, available and a plain-English reason. Filter by issue type and warehouse. |
| Transfers | `/transfers` | One row per SKU per movement between UK units: derived reference, SKU, product, from, to, quantity, status, date, recorded by and reason. Search across those; filter by status, warehouse from and warehouse to. View shows the whole movement with every SKU line. |
| Inventory Audit | `/audit` | Empty — `ledsone` holds no stock counts. The screen says so. |

Each list screen renders at most 200 rows and says so above the table
("showing 200 of 68,237 stock lines"). Filters narrow the whole set, not the
displayed page, so a search finds a SKU wherever it sits in the list.

## Viewing a record

Each area has one record screen: view. There is no add, edit or delete
counterpart.

| Area | View |
| --- | --- |
| Products | `/products/view?sku=` |
| Warehouse Stock | `/stock/view?sku=&warehouse=` |
| Alerts / Issues | `/alerts/view?type=&sku=&warehouse=` |
| Transfers | `/transfers/view?id=` |
| Inventory Audit | `/audit/view?id=` |

**Identifiers are compared exactly, never trimmed.** Seven SKUs in `ledsone`
carry a leading or trailing space — `" FWS444BL"`, `"CGSPBM "`,
`"RBLSDO300BI  "` and others. Those spaces are part of the key: they are what
the stock rows join on. Trimming the query parameter turned each of those
products' own View links into a 404. Only human-typed filter text is trimmed.

## What the system deliberately does not do

- **It does not write to `ledsone`.** No CRUD, no migration, no seed, no schema
  of its own, no second data store. This is the defining constraint.
- **It does not invent missing values.** A field the source does not hold shows
  "Not recorded", and a screen with no source data is empty and says why.
- **It has no audit trail, no authentication, no permissions and no API.**
  Anyone who can reach the port sees everything.
- **It has no deployment configuration.** It runs locally via `npm start`.
- **It does not move stock.** It reports; it does not act.
