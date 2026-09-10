# Smart Inventory Control MVP - validation

What was checked, how, and what was found. Carried out 2026-09-10 against the
working tree at commit `2c46830` (the MVP itself is uncommitted at the time of
validation).

Supporting output is in `evidence/inventory-mvp-evidence.md`.

## What was validated, and how

Three independent methods were used, deliberately, so that a mistake in the
implementation could not validate itself:

1. **Automated tests** - `npm test`, covering the rules, the reports, the
   dataset and every route.
2. **Independent recomputation** - every dashboard figure recalculated straight
   from the raw data files, without importing `rules.js` or `reports.js`, then
   compared against what the application produces.
3. **Live HTTP verification** - the server started with `npm start` and every
   route, filter, image and link requested over HTTP.

## Results

### 1. The six MVP areas

| Area | Result | Basis |
| --- | --- | --- |
| Dashboard | PASS | All six required figures present; each matches the independent recomputation |
| Products | PASS | SKU, image, name, category and supplier confirmed rendered for all 14 products |
| Warehouse Stock | PASS | Current, reserved, available and minimum rendered for all 32 lines |
| Alerts / Issues | PASS | All six issue types appear, each naming SKU, warehouse and a reason |
| Transfers | PASS | All 8 transfers render; Pending, In Transit and Received all present |
| Inventory Audit | PASS | System, counted and difference rendered for all 10 lines |

### 2. Derived figures checked against the rendered page

Rather than trusting the code, the HTML was parsed back and each row recomputed:

- **32 of 32** stock rows: rendered `Available` equals `Current - Reserved`.
- **10 of 10** audit rows: rendered `Difference` equals `Counted - System`.

### 3. Dashboard figures against independent recomputation

| Figure | Application | Recomputed from raw data | Result |
| --- | --- | --- | --- |
| Total SKUs | 14 | 14 | Match |
| Healthy Stock | 22 | 22 | Match |
| Low Stock | 5 | 5 | Match |
| Out-of-Stock Items | 4 | 4 | Match |
| Discrepancies | 5 | 5 | Match |
| Pending Transfers | 3 | 3 | Match |

The four health bands sum to 22 + 5 + 4 + 1 = 32, which is every stock line,
with none counted twice.

### 4. Dummy data conditions

Every condition the MVP has to demonstrate was confirmed present:

| Condition | Found |
| --- | --- |
| Healthy stock | 22 lines |
| Low stock | 5 lines |
| Out of stock | 4 lines |
| Negative inventory | 1 line |
| Warehouse/SKU mismatch | 3 lines - one unknown warehouse, one unknown SKU, one unapproved site |
| Inactive listing holding stock | 4 lines |
| Slow-moving stock | 3 lines |
| Over-reserved line | 1 line |
| Pending / In Transit / Received transfers | 3 / 3 / 2 |
| Audit discrepancy / audit match | 5 / 5 |

### 5. Live application

Server started, all six routes returned HTTP 200, all filters returned the
expected subsets, all thumbnails returned `image/svg+xml`, and **49 links across
the six screens were followed with zero broken**. The server log contained only
its two startup lines - no runtime errors. The server was then stopped and the
port confirmed closed.

### 6. Repository standard

All 12 standard folders and their `README.md` files remain present and
**byte-identical** to the canonical `Initial-Mini-AIOS` originals - none were
modified. Neither sibling repository was touched.

## Outcome

**PASS.** No defect was found and no code change was required by this
validation. Every MVP requirement is implemented and demonstrable from startup.

## Second round - add, edit and delete (2026-09-10)

Carried out after the CRUD screens were added, against the same working tree.
The results above were re-run unchanged and still hold. Captured output is in
sections 12-21 of `evidence/inventory-mvp-evidence.md`.

### Method

1. **Automated tests** - `npm test`. The suite grew from 173 to 307 tests: 69
   new tests over the write operations and their validation, 64 over the record
   routes and the workflows they make up, and one existing test rewritten (see
   below). All 307 pass.
2. **Live HTTP walkthrough** - the server started and the whole workflow driven
   over HTTP: add a product, view it, edit it, delete it; add a stock record,
   edit its quantities, confirm available recalculated, check the dashboard and
   the alerts screen; open an alert, view it, note it, change its status; add a
   transfer, view it, edit its status, delete it; add an audit record, view it,
   edit the counted quantity, confirm the difference recalculated, delete it.
3. **Structural responsive check** - all 24 screens fetched and checked for
   tables outside a scroll container, fixed widths wider than a phone, missing
   breakpoints and forms or detail lists that do not collapse to one column.

### Results

| Check | Result | Basis |
| --- | --- | --- |
| Products add / view / edit / delete | PASS | Full cycle over HTTP; view showed every field and the generated thumbnail |
| Duplicate SKU refused | PASS | `POST /products/add` with an existing SKU returned 400 with the form and the reason |
| Stock add / view / edit / delete | PASS | Full cycle over HTTP |
| Available recalculated | PASS | Edited 10/2 to 120/15; the view moved from 8 to 105 and the band from Low Stock to Healthy |
| Available never accepted from a form | PASS | No `name="available"` on either form; an available field posted anyway is ignored |
| Alerts view / action status / note | PASS | Status and note recorded and shown back on the view screen |
| Resolving does not clear a real problem | PASS | Shortage marked Resolved stayed detected, stayed listed and stayed counted; it cleared only when the stock was corrected |
| Transfers add / view / edit / delete | PASS | Full cycle over HTTP; same-warehouse, bad status and zero quantity all refused with 400 |
| Transfers still move no stock | PASS | A 999-unit transfer left every stock figure unchanged |
| Audit add / view / edit / delete | PASS | Full cycle over HTTP |
| Difference recalculated | PASS | Counted 250 against 260 showed `-10` and Discrepancy; edited to 260 it showed `0` and Matches |
| Dashboard follows the data | PASS | Total SKUs, Low Stock, Discrepancies and Pending Transfers each moved with the change that should move them |
| The six rules still work | PASS | Every issue raised after CRUD is one of the six; mismatch, inactive-listing and slow-moving all still fire on edited data; Low Stock and Out of Stock still never both fire on one line |
| No destructive GET | PASS | All four delete confirmation pages fetched; every record still present afterwards |
| Existing routes and filters | PASS | All six screens and every existing filter returned 200 |
| Responsive shell intact | PASS | All 24 screens carry the viewport meta and all three breakpoints; every table is inside a scroll container; no fixed width above 320px |
| No client-side JavaScript | PASS at the time | True when this round ran. The filter bars were later changed to dropdowns that apply on change, which added `/filters.js` - one same-origin file, CSP `script-src 'self'`, no inline handler and no dependency |

### One existing test was rewritten, not weakened

`data.test.js` asserted that `STOCK_LINES.push(...)` throws - that the
collections were frozen. That is exactly the guarantee this change removes: the
collections are now the session. It was replaced with the stronger guarantee the
store actually provides, and that one is asserted directly: every **record**
stays frozen, and an edit swaps in a new record rather than writing into the old
one, so a screen already holding a record never sees it change underneath. No
other existing test was changed, skipped or removed.

### Outcome

**PASS.** No defect was found. Every screen listed in the task has view, add,
edit and delete where those make sense, the derived figures stay derived, and
the detection rules are unchanged.

## Known limitations at the point of validation

These are recorded boundaries, not defects. They are listed in full in
`capability/inventory-mvp-capabilities.md`:

- Negative Inventory has no dashboard tile. The MVP source names six tiles and
  Negative Inventory is not among them; it is shown on Warehouse Stock as its
  own band and in the dashboard issue breakdown.
- The stock tiles count stock lines, not SKUs, because one SKU can be healthy at
  one site and out of stock at another. Each tile is labelled with its unit.
- Transfers do not move stock.
- Changes made through the new screens live in memory only and are lost on
  restart. There is no audit trail of who changed what, and no concurrency
  control if two people edit the same record.
