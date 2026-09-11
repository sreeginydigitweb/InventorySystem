# Smart Inventory Control - validation

What was checked, how, and what was found. Carried out **2026-09-11** against
the working tree, after the system was connected to the live `ledsone` database
and made read-only.

Supporting output is in `evidence/inventory-mvp-evidence.md`.

This record describes the system as it stands. Everything below was checked
against the live `ledsone` database on the date above.

## What the system is now

| | |
| --- | --- |
| Source database | `ledsone` (existing business database) |
| Catalogue | `inventory.products WHERE inventory_bool = true` |
| Catalogue size | **6,510 SKUs** |
| Stock lines | 68,237 across 10 warehouses |
| Application writes | **None** |

## What was validated, and how

Four independent methods, so that a mistake in the implementation could not
validate itself:

1. **Automated tests** — `npm test`, covering the rules, the reports, the
   rendering and every route.
2. **Independent recomputation in SQL** — every dashboard figure recalculated
   directly against `ledsone` with SQL that shares no code with the application,
   then compared against what the application produces.
3. **Live HTTP verification** — the server started, every route requested, and
   every link on all six screens crawled.
4. **Privilege and statement inspection** — what the application *could* do to
   the source, asked of PostgreSQL rather than assumed from the code.

## Results

### 1. The six areas

| Area | Result | Basis |
| --- | --- | --- |
| Dashboard | PASS | All six cards present; each matches the independent SQL recomputation exactly |
| Products | PASS | Real SKUs, names, images, categories and suppliers rendered from `ledsone` |
| Warehouse Stock | PASS | Real Current, Reserved and Available for 68,237 lines across the 10 real warehouses |
| Alerts / Issues | PASS | All six issue types calculated from real stock, product and warehouse data |
| Transfers | PASS (empty) | `ledsone` holds no transfer records; screen is empty and states why |
| Inventory Audit | PASS (empty) | `ledsone` holds no stock counts; screen is empty and states why |

### 2. Dashboard figures against independent SQL recomputation

The application's six figures, and the same figures computed straight from
`ledsone` with SQL that imports none of the application's code:

| Card | Application | Independent SQL | Result |
| --- | --- | --- | --- |
| Total SKUs | 6,510 | 6,510 | MATCH |
| Healthy Stock | 4,010 | 4,010 | MATCH |
| Low Stock | 561 | 561 | MATCH |
| Out-of-Stock Items | 1,379 | 1,379 | MATCH |
| Discrepancies | 0 | 0 (no source data) | MATCH |
| Pending Transfers | 0 | 0 (no source data) | MATCH |

Negative Inventory, which has no card, is 560 in both.

**The invariant holds:** `4,010 + 561 + 1,379 + 560 = 6,510`. Every SKU falls
into exactly one band, so the four stock bands add up to Total SKUs.

### 3. A counting-scope defect was found and fixed

Before this round, the three stock cards counted **stock lines**, not SKUs.
Healthy Stock read **6,791** — larger than the 6,510-SKU catalogue it is
supposedly a subset of, because most SKUs carry a row at all ten warehouses.
Traced to `dashboardMetrics()` banding `snap.stockLines` (68,237 rows) rather
than the catalogue, and confirmed against SQL: 6,791 is exactly the count of
healthy stock lines.

Fixed by banding each SKU on its stock **summed across every warehouse**
(`describeSkuPosition` in `rules.js`) — summed rather than worst-of, because a
product with stock at one site and none at nine others can still be sold. The
cards now drill through to `/products?stock=…`, which lists the same SKUs and
shows the same figure.

Regression cover added: a card can never exceed Total SKUs, the four bands must
sum to Total SKUs, and each card's figure must equal the count line of the
screen it opens.

### 4. The Low Stock threshold was corrected to be inclusive

The agreed definition is `available > 0 AND available <= 10`. The implementation
tested `available < 10`, excluding exactly 10. Corrected in `lowStockCeiling()`.
Effect on the live data: Low Stock rises from 1,159 to **1,289 stock lines**.

### 5. Derived figures checked against the rendered page

The HTML was parsed back and each row recomputed, rather than trusting the code:

- **600 of 600** rendered stock rows across three screens: `Available` equals
  `Current − Reserved`. Zero mismatches.
- Spot-checked against the source: SKU `12AT60` at UK Unit3 renders −2 / 0 / −2,
  Negative Inventory; SQL returns `quantity = -2, reserved_quantity = 0` for
  that pair. All ten of its warehouse rows agree.

### 6. Live application

| Check | Result |
| --- | --- |
| `/`, `/products`, `/stock`, `/alerts`, `/transfers`, `/audit` | All HTTP 200 |
| Every link on all six screens crawled (619 unique URLs) | **0 broken** |
| Unknown path | HTTP 404, inside the normal page shell |
| `POST` to `/products/add`, `/stock/edit`, `/audit/delete`, `/alerts/resolve` | HTTP 405 with the read-only explanation; no redirect, nothing written |
| Every screen is **view only** — Products, Warehouse Stock, Alerts, Transfers, Audit | **0** forms with `method="post"` and **0** links to `/add`, `/edit`, `/delete` or `/resolve` across all six screens. The one form per list screen is the `GET` filter bar. |
| Runtime errors in the server log | None |
| Startup banner | `reading ledsone as varmen_user - read-only connection: yes, no write privileges.` |

### 7. A link defect was found by the crawl and fixed

The first crawl returned 11 broken links, all for SKU `" FWS444BL"`. Seven SKUs
in `ledsone` carry a leading or trailing space — `" FWS444BL"`, `"CGSPBM "`,
`"IMWW "`, `"RBLSDO300BI  "`, `"RBLSWG135YB "`, `"WSLFS1002BM  "`, `"CGSPWH "`.
The router trimmed every query parameter, so the href built from the real SKU was
trimmed back to something matching nothing and each of those products 404'd from
its own View link.

Fixed by comparing record identifiers exactly (`key()`) and trimming only
human-typed filter text (`param()`). Re-crawl: 619 links, 0 broken. Regression
test added for a padded SKU on both the product and stock view routes.

### 8. Source database safety

Asked of PostgreSQL, not inferred from the code:

| Check | Result |
| --- | --- |
| `has_table_privilege('varmen_user','inventory.products','INSERT')` | **false** |
| `…'UPDATE'` / `…'DELETE'` | **false** / **false** |
| `has_table_privilege('varmen_user','inventory.physical_product_stock','UPDATE')` | **false** |
| `has_schema_privilege('varmen_user','inventory','CREATE')` | **false** |
| `has_database_privilege('varmen_user','ledsone','CREATE')` | **false** |
| Connection `transaction_read_only` | **on** (set as a startup option) |
| Schemas named `inventory_control*` in `ledsone` | **0** |
| Write SQL anywhere in `inventory/*.js` | **none** (only the word in comments) |
| `inventory.physical_product_stock` row count, before and after | 76,683 → 76,683 |
| `inventory.warehouse` row count | 10 → 10 |
| Catalogue (`inventory_bool = true`) | 6,510 → 6,510 |

No INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, TRUNCATE, migration or seed was
executed against `ledsone` at any point.

`inventory.products` moved from 44,492 to 44,494 during the session. **Not this
application** — it holds no INSERT privilege, the connection is read-only, and
there is no INSERT statement in the codebase. `ledsone` is a live database that
the business's own order and listing systems write to continuously; the two new
rows are bundle SKUs carrying `inventory_bool = false`, so neither enters this
system's catalogue. The catalogue is unchanged at 6,510 and every figure above
still holds. Full detail in the evidence record.

### 9. Demonstration data is gone from production

| Check | Result |
| --- | --- |
| Production modules importing `testdata/` (8 files) | **0** |
| Loader / seeder / reset script | Deleted (`fixture/load.js`, `fixture/ensure-test-schema.js`) |
| Schema creation SQL | Deleted (`sql/001-inventory-control-schema.sql`) |
| `npm run seed:test`, `pretest` | Removed from `package.json` |
| References to `varmen` in application code | **none** |
| `DB_NAME` in `inventory/.env` | `ledsone` |

`inventory/testdata/` remains as **test input only** and is not reachable from
the running application.

### 10. Test isolation

| Check | Result |
| --- | --- |
| `npm test` | **155 passed, 0 failed**, 35 suites |
| Same suite with credentials sabotaged (`DB_HOST=0.0.0.0 DB_PORT=1 DB_USER=nobody DB_NAME=nope`) | **155 passed, 0 failed** |

The suite opens no database connection at all. Every test needing data points
the store at in-memory arrays via `useSource(memorySource(…))`. There is no
`--env-file` on the test path and no connection string. No test can read or
write `ledsone`.

## Outcome

**PASS.** Two defects were found during this round and both were fixed and
covered by regression tests:

1. Dashboard stock cards counted stock lines instead of catalogue SKUs, giving a
   Healthy Stock figure larger than the catalogue itself.
2. Record identifiers were trimmed, making seven real SKUs unreachable from
   their own links.

One agreed definition was corrected: Low Stock is now inclusive of 10.

## Known limitations at the point of validation

These are recorded boundaries, not defects. They are listed in full in
`capability/inventory-mvp-capabilities.md`.

- **Three things the source does not hold**, and none is invented: no
  minimum/reorder level (an application threshold of 10 is used and labelled as
  such), no inter-warehouse transfers (screen empty), no physical stock counts
  (screen empty).
- **Negative Inventory has no dashboard card.** Six cards are agreed and it is
  not among them; it appears on Warehouse Stock as its own band, in the
  dashboard issue breakdown, and in the Products stock filter.
- **Warehouse/SKU Mismatch checks two conditions, not three.** The source keeps
  no approved-sites list, so that check is skipped rather than failed.
- **Partial field coverage.** Category resolves for 3,812 of 6,510 SKUs and
  supplier for 1,628; the rest show "Not recorded". Category is a marketplace
  field with 323 distinct values including near-duplicates and several
  languages.
- **Figures can be up to 60 seconds old**, because reads are cached in-process.
  Nothing is written back, so a cached figure can only be behind.
- **List screens render at most 200 rows.** Counts and dashboard figures are
  computed over the whole set first, so nothing is under-reported.
- **No authentication, permissions, audit trail or API.** Anyone who can reach
  the port sees everything.
