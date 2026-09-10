# Smart Inventory Control - MVP

How the MVP is run, how the dummy data is put together, and how each inventory
problem is detected.

The system is a demonstration. There is no database, no live inventory source
and no external API: everything on screen is invented and is loaded from files
in `inventory/data/` when the server starts.

## Running it

Node 20 or newer. There are no dependencies to install.

```
npm start
```

Then open <http://localhost:3000/>.

Set `INVENTORY_PORT` to use a different port:

```
INVENTORY_PORT=4000 npm start
```

## Running the tests

```
npm test
```

Node's built-in test runner, so again there is nothing to install. The tests
cover the detection rules, the derived reports, the dummy data itself, the
rendering and every route.

## How the code is laid out

Data, business logic and rendering are kept apart so a rule can be found and
changed in one place.

| File | Responsibility |
| --- | --- |
| `inventory/data/` | The dummy dataset. No logic. Seeds the session at startup. |
| `inventory/store.js` | The only place data changes. Validation and the add/edit/delete operations. No HTML, no rules. |
| `inventory/rules.js` | The six detection rules and the stock health bands. No HTML. |
| `inventory/reports.js` | Derived views: dashboard figures, audit differences, per-screen rows. |
| `inventory/render.js` | HTML only. No data access, no rules. |
| `inventory/router.js` | Path plus query string to a response, and form posts to a write. Pure, so both are testable without a server. |
| `inventory/server.js` | The HTTP shell. Thin on purpose. |

Each list screen's filters are ordinary `<select>` dropdowns in one GET form,
each offering an "All" option. There is no Apply button: `/filters.js` submits
the form as soon as any control in it changes, so choosing an option applies it
immediately. Because every filter sits in the same form, the others are carried
along automatically - change the supplier and the category goes with it.

Each dropdown is a single choice, and groups combine with AND:

```
/products?category=Bulbs&supplier=Halden+Electrical+Supplies
```

which reads "a Bulb supplied by Halden". Choosing an "All" option drops just
that parameter; Clear filters resets every group at once. Filtering itself still
runs on the server from query string parameters, so a filtered view is an
ordinary URL that can be linked to or bookmarked.

`/filters.js` is the only script in the system and does only that one thing. It
is served from this origin, so the CSP allows `script-src 'self'` and nothing
more - no inline handler, no CDN, no dependency. With scripting off, the filter
bar no longer applies itself; every other screen, record and link still works,
because nothing else depends on it. The record forms are plain HTML forms
posting to the server - there is no `confirm()` dialog anywhere, and a delete
asks on its own page instead.

### Where data changes, and where it does not

`route()` is still a pure function of path and query that cannot change
anything. Everything that can is reachable only through `routeForm()`, and only
by `POST`. So a link, a crawler or a prefetch cannot alter a record, and a
delete link only ever opens the page that asks.

Derived figures stay derived. There is no Available field on the stock form and
no Difference field on the audit form, because both are worked out from the
figures beside them whenever they are shown. Nothing that can be calculated is
ever accepted from a form.

## How the dummy data is structured

### Products - `inventory/data/products.js`

14 products.

| Field | Purpose |
| --- | --- |
| `sku` | Identifier used by every other file. |
| `name` | Display name. |
| `image` | Path to a thumbnail, generated as SVG at `/images/<sku>.svg`. |
| `category` | One of five categories. |
| `supplier` | One of four suppliers. |
| `active` | `false` once the listing is withdrawn from sale. |
| `unitsSoldLast90Days` | Movement figure. Stands in for a sales history the MVP does not have. |
| `approvedWarehouses` | The sites this SKU is meant to be held at. |

### Warehouses - `inventory/data/warehouses.js`

4 warehouses, each with an identifier, a name and a location.

### Warehouse stock - `inventory/data/stock.js`

32 stock lines. One line is one SKU at one warehouse.

| Field | Purpose |
| --- | --- |
| `onHand` | Units physically recorded. May be negative. |
| `reserved` | Units already committed to orders. |
| `minimum` | The level this site is expected to hold. |

**Available stock is not stored.** It is always derived:

```
available = onHand - reserved
```

so the figure on screen can never drift from the figures it comes from.

### Transfers - `inventory/data/transfers.js`

8 transfers, each with an id, SKU, source, destination, quantity, status and the
date it was raised. Statuses are `Pending`, `In Transit` and `Received`, and all
three appear in the data.

Transfers are a record only: the quantities are deliberately not applied to the
stock lines.

### Inventory audit - `inventory/data/audit.js`

10 physical counts. Each holds the `systemQuantity` believed at the time of the
count and the `countedQuantity` actually found.

**The difference is not stored.** It is always derived:

```
difference = countedQuantity - systemQuantity
```

A positive difference means more was found than expected, a negative difference
means less, and zero means the count agreed.

## The detection rules

All six live in `inventory/rules.js`, one named function each.

| Rule | Fires when |
| --- | --- |
| **Low Stock** | `available` is below `minimum`, and `available` is still above zero. |
| **Out of Stock** | `available` is zero or below - either the shelf is empty or every unit is reserved. |
| **Negative Inventory** | `onHand` is below zero. |
| **Warehouse/SKU Mismatch** | The warehouse does not exist, the SKU is not in the catalogue, or the SKU is not approved for that site. |
| **Inactive Listing** | The listing is withdrawn but `onHand` is still above zero. |
| **Slow-Moving Stock** | The product is active, holds stock, and sold 5 or fewer units in 90 days. |

### Stock health bands

Every stock line falls into exactly one band, taken most serious first:

```
Negative Inventory  ->  Out of Stock  ->  Low Stock  ->  Healthy
```

This is what makes the dashboard add up: Healthy + Low + Out + Negative always
equals the total number of stock lines.

### Two deliberate choices

These are judgment calls rather than direct readings of the requirement, and are
recorded here so they can be reviewed.

1. **Low Stock and Out of Stock never both fire on one line.** Read completely
   literally, a line with nothing available is also below its minimum and would
   raise both. Staff read them as different problems - running low against
   having none - and the dashboard tiles only add up if each line sits in one
   band. So Low Stock additionally requires `available > 0`.

2. **Slow-Moving requires the listing to be active.** Stock against a withdrawn
   listing is already reported as an Inactive Listing. Reporting it again as
   slow-moving would add noise rather than information.

One line *can* raise several issues where they are genuinely different problems.
Stock held at an unapproved site can also be running low, and staff need to see
both.

## The six areas

| Area | Path | Shows |
| --- | --- | --- |
| Dashboard | `/` | Total SKUs, Healthy Stock, Low Stock, Out-of-Stock Items, Discrepancies, Pending Transfers, plus a breakdown by issue type and by transfer status. Every tile links through to the filtered screen behind it. |
| Products | `/products` | SKU, image, name, category, supplier, listing status and units held. Search across SKU, name and supplier; filter by category and supplier. |
| Warehouse Stock | `/stock` | SKU, product, warehouse, current, reserved, available, minimum and health band. Search by SKU or name; filter by warehouse and band. Problem rows are tinted and negative figures are shown in red. |
| Alerts / Issues | `/alerts` | Every detected issue with the SKU, warehouse, available, minimum and a plain-English reason it was raised. Filter by issue type and warehouse. |
| Transfers | `/transfers` | Transfer id, SKU, product, from, to, quantity, status and date raised. Filter by status and by warehouse, matching either end of the move. |
| Inventory Audit | `/audit` | SKU, product, warehouse, system quantity, counted quantity, difference and result. Filter by warehouse, or narrow to discrepancies only. |

Every figure is worked out from the data each time a page is loaded. Nothing is
cached and no count is stored.

## Adding, editing and deleting

Each area has the same four record screens, addressed with the query parameters
the filters already use.

| Area | View | Add | Edit | Delete |
| --- | --- | --- | --- | --- |
| Products | `/products/view?sku=` | `/products/add` | `/products/edit?sku=` | `/products/delete?sku=` |
| Warehouse Stock | `/stock/view?sku=&warehouse=` | `/stock/add` | `/stock/edit?sku=&warehouse=` | `/stock/delete?sku=&warehouse=` |
| Alerts / Issues | `/alerts/view?type=&sku=&warehouse=` | - | `/alerts/edit?type=&sku=&warehouse=` | `/alerts/resolve` (POST) |
| Transfers | `/transfers/view?id=` | `/transfers/add` | `/transfers/edit?id=` | `/transfers/delete?id=` |
| Inventory Audit | `/audit/view?id=` | `/audit/add` | `/audit/edit?id=` | `/audit/delete?id=` |

Each `add`, `edit` and `delete` path answers a `GET` with a form or a
confirmation, and a `POST` with the write. A write that succeeds answers with a
redirect, so refreshing afterwards cannot repeat it. A write that fails answers
with the form again, the values still in it and the reason against the field.

### Changes last for the session, not beyond it

There is still no database. The arrays in `inventory/data/` are the seed;
`store.js` edits them in place while the server runs; a restart puts everything
back exactly as it was. Nothing is written to disk.

### Alerts are the exception, deliberately

An issue is not a record. It is a conclusion the six rules reach about the stock
data every time a page loads, so there is nothing to add and nothing to delete.
What staff can record is what they **did** about it: an action status of Open, In
Progress or Resolved, and a note.

That record annotates the conclusion and can never suppress it. Marking a
shortage Resolved says the team has dealt with it; if the stock is still below
minimum, the next page load detects it again, lists it again and counts it again
on the dashboard - carrying the Resolved label rather than being hidden by it.
The only thing that clears an issue is correcting the stock figures it comes
from.

### Deleting a product that other records point at

A product nothing references is removed on its own. A product that stock lines,
transfers or audit records still point at is refused, and the confirmation page
says exactly what points at it. Staff can agree to remove those too, with an
explicit tick - so a deletion can never leave a record pointing at a SKU that no
longer exists.

## What the MVP deliberately does not do

No database, no warehouse or marketplace integration, no inventory API, no
authentication, no user management, no permissions, and no deployment
configuration. The server answers `GET`, `HEAD` and `POST`; `POST` is
accepted only from the record forms, and only as form-encoded data.

Records can now be added, edited and deleted, but only for the life of the
process: there is nothing behind the screens but the dummy arrays, and a restart
discards every change. Transfers still do not move stock - raising, editing or
receiving one changes the transfer record and nothing else.
