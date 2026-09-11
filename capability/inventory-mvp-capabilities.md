# Smart Inventory Control - capabilities

What the system can do, and where it stops. Updated 2026-09-11, when the system
was connected to the live `ledsone` database and became read-only.

## What it is

A **read-only reporting view** over `ledsone`, the existing business inventory
database. It does not own its data, does not store any of its own, and cannot
change the source. Every figure on every screen is read from `ledsone` when the
page is built.

| | |
| --- | --- |
| Source database | `ledsone` |
| Schemas read | `inventory` (primary), `suppliers`, `order_management`, `listings` |
| Catalogue | `inventory.products WHERE inventory_bool = true` |
| Catalogue size | **6,510 SKUs** (verified 2026-09-11) |
| Stock lines | 68,237 (SKU × warehouse) across 10 warehouses |
| Writes | **None.** No INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, migration or seed. |

## Capabilities

| Capability | What it covers |
| --- | --- |
| **Dashboard** | Total SKUs, Healthy Stock, Low Stock, Out-of-Stock Items, Discrepancies and Pending Transfers, plus a breakdown by issue type and by transfer status. All six cards count **catalogue SKUs**, so the four stock bands add up to Total SKUs exactly. Every card links through to the screen listing the same SKUs, showing the same figure. |
| **Products** | The catalogue: SKU, image, product name, category, supplier, listing status, total units held and stock position. Search across SKU, name and supplier; filter by category, supplier and stock position. View only. |
| **Warehouse Stock** | Stock by SKU and warehouse: current, reserved, available and health band. Search by SKU or name; filter by warehouse and band. View only; available is always derived, never stored. |
| **Alerts / Issues** | The six detected issue types, each naming the SKU and warehouse affected and the reason it was raised. Filter by issue type and warehouse. View only. Issues are recalculated from the source on every page load and are never stored. |
| **Transfers** | Reads transfer records from the source. `ledsone` holds none, so the screen is empty and says why. |
| **Inventory Audit** | Reads physical stock counts from the source. `ledsone` holds none, so the screen is empty and says why. `Difference = Counted − System` remains the definition. |

Each list screen renders at most 200 rows and says so above the table
("showing 200 of 68,237 stock lines"). Filters narrow the whole set, not the
displayed page, so a search finds a SKU wherever it sits.

## Where each field comes from

| Field | Source |
| --- | --- |
| SKU, product name, description | `inventory.products` |
| Product image | `inventory.product_media` (`type = 'main-image'`), falling back to `inventory.product_images`. A SKU with neither gets an SVG the server draws from its initials. |
| Category | `listings.shopify_listings.product_type`, most recently updated listing for the SKU |
| Supplier | `suppliers.order_items` → `suppliers.orders` → `suppliers.suppliers`, most recent purchase order |
| Listing status | `inventory.end_of_line_products.end_of_line_status`; `Permanent` means Inactive, anything else Active |
| Units sold (90 days) | `order_management.orders` → `order_item_info` → `order_combo`, so a SKU sold inside a bundle is still counted |
| Warehouses | `inventory.warehouse` |
| Current, Reserved | `inventory.physical_product_stock.quantity`, `.reserved_quantity` |
| Shelf location | `inventory.physical_product_stock.product_shelf_location`, `.product_bulk_location` |

A SKU with no listing, no purchase order or no sales shows **Not recorded** —
never a blank or a zero that could be read as a figure.

## Detection rules

| Rule | Condition |
| --- | --- |
| Low Stock | `available > 0` and `available <= 10` |
| Out of Stock | `available <= 0` |
| Negative Inventory | `onHand < 0` |
| Warehouse/SKU Mismatch | Unknown warehouse, or unknown SKU |
| Inactive Listing | Listing withdrawn and `onHand > 0` |
| Slow-Moving Stock | Active, `onHand > 0`, and 5 or fewer units sold in 90 days |

`available` is always `onHand − reserved` and the audit `difference` is always
`counted − system`. Both are derived on read, have no column anywhere, and
appear on no form — so a saved figure cannot disagree with the figures it comes
from.

Health bands are assigned most serious first — Negative, then Out of Stock, then
Low Stock, then Healthy — so every row sits in exactly one band.

### The Low Stock threshold is an application setting

`ledsone` has **no minimum or reorder-level column anywhere**. There is nothing
to read, so Low Stock is judged against one application-wide threshold of **10
available**, stated once in `inventory/rules.js` as `LOW_STOCK_THRESHOLD` and
printed above the Warehouse Stock table. It is never presented as a figure the
business set. Changing it there changes every screen.

### Warehouse/SKU Mismatch checks two conditions, not three

`ledsone` holds no list of which sites a SKU is approved for. A product's
`approvedWarehouses` is therefore `null`, and that check is skipped rather than
failed — checking against a list nobody keeps would report the entire business
as misplaced stock. The two faults visible in real data are still detected:
3,160 stock rows point at warehouse `33`, which is not in `inventory.warehouse`.

## Dashboard counting: SKUs, not stock lines

All four stock cards count **catalogue SKUs**. A SKU's band comes from its stock
summed across every warehouse (`describeSkuPosition` in `rules.js`) — summed,
not worst-of, because a product with 12 units at one site and none at the other
nine can still be sold.

This matters because the two are not interchangeable. Counting stock lines gave
Healthy Stock = 6,791 against a catalogue of 6,510 — a figure larger than the
set it is a subset of, because most SKUs carry a row at all ten warehouses.

Verified against `ledsone` on 2026-09-11:

| Card | Figure |
| --- | --- |
| Total SKUs | 6,510 |
| Healthy Stock | 4,010 |
| Low Stock | 561 |
| Out-of-Stock Items | 1,379 |
| Discrepancies | 0 (no source data) |
| Pending Transfers | 0 (no source data) |

`4,010 + 561 + 1,379 + 560 negative = 6,510`. Every SKU falls into exactly one
band, which is the invariant that makes the six cards comparable with each
other.

## There is no add, edit or delete

`ledsone` is not this application's to change, so every screen is view only. A
form that appeared to change the source would be worse than no form at all —
staff would believe a correction had been made.

| Screen | Actions available |
| --- | --- |
| Products | **View only** |
| Warehouse Stock | **View only** |
| Alerts / Issues | **View only**, and calculated rather than stored |
| Transfers | **View only** (empty — the source holds no transfer records) |
| Inventory Audit | **View only** (empty — the source holds no stock-count records) |

| What | Behaviour |
| --- | --- |
| Add / edit / delete routes | Do not exist. `route()` has view routes only. |
| Forms that post | None. The only `<form>` on any screen is the filter bar, which is a `GET`. |
| `POST` to any path | Answered with a page explaining the source is read-only. HTTP 405. |
| Alert state | None. An issue carries no status, note or timestamp, because nothing about it is stored. |

Four independent things keep the source safe, and any one would be enough:

1. Every statement in the codebase is a `SELECT`.
2. There is no write route, form or button to reach one from.
3. The pool opens every connection with `default_transaction_read_only = on`, so
   the **server** refuses a write regardless of what the application asks.
4. The role holds no INSERT, UPDATE, DELETE or CREATE privilege. The application
   asks PostgreSQL at startup and **refuses to start** if that ever changes.

### An issue still cannot be cleared by hand

An issue is a conclusion the rules reach about the stock data, recomputed on
every page load — not a record. There is now no way to mark one at all, so a
problem that exists in the data is listed and counted until the data changes.

## Boundaries — what this system explicitly does not do

- **No writes to the source, ever.** No CRUD, no migration, no seed, no schema
  of its own, no second data store. This is the defining constraint.
- **No transfer data.** `ledsone` has no inter-warehouse transfer table. The
  nearest match by name, `listings.bandq_transfers`, is a record of category
  spreadsheets uploaded to B&Q and is unrelated to moving stock.
- **No audit/count data.** `ledsone` has no stock-count table.
  `inventory.product_history` is a free-text edit log with no counted quantity,
  no system quantity and no warehouse, so `Counted − System` cannot be derived
  from it without inventing two of its three terms.
- **No minimum/reorder level.** See the threshold note above.
- **Category covers 3,812 of 6,510 SKUs; supplier covers 1,628.** The rest show
  "Not recorded". Category is a marketplace merchandising field, so its 323
  distinct values include near-duplicates and several languages.
- **Figures can be up to 60 seconds old.** Reads are cached in-process for
  `INVENTORY_CACHE_MS` (default 60,000) and shared across requests, because the
  catalogue and stock are large and remote. Nothing is written back, so a cached
  figure can only be behind, never inconsistent.
- **No authentication, user management or permissions.** Anyone who can reach
  the port sees everything.
- **No API, marketplace integration or deployment configuration.** It runs
  locally via `npm start`.
- **No concurrency concerns.** There is nothing to write.

## Judgment calls inside the rules

1. **Low Stock and Out of Stock never both fire.** Low Stock additionally
   requires `available > 0`, so each row falls into one band.
2. **Slow-Moving requires an active listing**, so stock against a withdrawn
   listing is reported once as an Inactive Listing rather than twice.
3. **A row carrying its own `minimum` is judged `available < minimum`**; a row
   without one — which is every row from `ledsone` — is judged
   `available <= 10`. Expressed as a single ceiling in `lowStockCeiling()`.

A row may still raise several issues where they are genuinely different
problems.
