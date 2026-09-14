# Smart Inventory Control

## Purpose

Smart Inventory Control gives a clear, single view of what stock exists, where it
is held, what is moving between locations, and what needs attention — so stock
problems are seen and acted on rather than discovered late.

## What this repository contains

The **Smart Inventory Control MVP**, reporting on **real inventory data**.

The system reads `ledsone`, the existing business inventory database. There is no
dummy data, no demonstration dataset and no schema of its own: every figure on
every screen is read from `ledsone` at the moment the page is built.

| Area | Purpose | Source |
| --- | --- | --- |
| Dashboard | The overall stock position at a glance | Calculated from the four below |
| Products | The product and SKU records the system works from | `inventory.products` (SKUs flagged `inventory_bool`) |
| Warehouse Stock | Stock held, by product and by location | `inventory.physical_product_stock`, `inventory.warehouse` |
| Alerts / Issues | Stock conditions that need attention | Calculated from products, warehouses and stock |
| Transfers | Stock moving between locations | Not held in `ledsone` — see "What the source does not hold" |
| Inventory Audit | Counting stock and reconciling what is found against what is expected | Not held in `ledsone` — see below |

## THE SOURCE DATABASE IS READ-ONLY

`ledsone` belongs to the business, not to this application. This system reports
on it and **never writes to it**. There is no add, edit or delete anywhere in it.

Four independent things keep that true:

1. **No write statement exists.** Every statement in the codebase is a `SELECT`.
   There is no `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP` or
   `TRUNCATE` in it, and no migration, seed or reset script.
2. **No write screen exists.** There is no add, edit or delete route, no form
   that posts, and no button that submits. `routeForm()` answers every POST with
   a page explaining that the source is read-only.
3. **The connection refuses writes.** The pool opens every connection with
   `default_transaction_read_only = on` as a startup option, so the *server*
   rejects a write on it whatever the application asks for.
4. **The role holds no write privilege.** `checkConnection()` asks PostgreSQL at
   startup whether the role could write to `inventory.products`. If the answer
   is ever yes, the application **refuses to start**.

Any one of the four would be enough.

## What the source does not hold

Two things the screens can show have no source column. Neither is filled in
with an invented value; each screen says what is missing and why.

| Missing | Affects | What the system does instead |
| --- | --- | --- |
| Minimum / reorder level per SKU per site | Low Stock rule, Dashboard "Low Stock" card | Judged against one application-wide threshold, `LOW_STOCK_THRESHOLD` in `rules.js`, printed above the Warehouse Stock table. Not presented as the business's figure. |
| Physical stock counts | Inventory Audit screen, Dashboard "Discrepancies" card | The screen is empty and says so. The card reads 0. `Difference = Counted − System` is still the only definition; there is simply nothing to apply it to. |

Transfers have no table of their own, but they are recorded: they are read out
of the stock-change log in `inventory.product_history.history`. A line counts as
a transfer when one UK unit's stock fell and another's rose in the same edit.
The source has no transfer number and no workflow, so the reference is derived
(a hash of the event, labelled as derived) and every transfer is `Received` or
`Received (Adjusted)` — never Pending or In Transit. See the Transfers section
of `inventory/source.js`.

A SKU with no Shopify listing, no purchase order or no sales in the window shows
**Not recorded** for Category, Supplier or units sold, rather than a blank or a
zero that could be read as a figure.

## Running it

Node 20 or newer.

```
npm install                                  # one dependency: pg
cp inventory/.env.example inventory/.env     # then fill it in
npm start                                    # http://localhost:3000/
npm test                                     # the test suite
```

There is no schema to create, no migration to run and no seed step. The source
database already holds the data.

`inventory/.env` holds the connection and is git-ignored. `.env.example` is the
template and holds no real values. `DB_USER` should name a role with `SELECT`
and nothing else; the application refuses to start against a role that can
write.

## Tests never reach the source database

The suite opens no database connection at all. Every test that needs data points
the store at the sample arrays in `inventory/testdata/`, held in memory:

```js
useSource(memorySource({ products: PRODUCTS, warehouses: WAREHOUSES, stockLines: STOCK_LINES }));
```

So the suite runs anywhere, is unaffected by what is in the real data today, and
cannot touch it — there is no connection string in the test path, no `--env-file`
and no loader. `inventory/testdata/` is invented sample data used as test input
only; it is never written to any database and nothing in the running application
imports it. See `inventory/testdata/README.md`.

`documentation/smart-inventory-control-mvp.md` covers the detection rules and
each of the six areas in detail.

## How the application is laid out

Data, business logic and rendering are kept apart. Filtering runs on the server
from the query string; the only client-side JavaScript is `/filters.js`, a
single same-origin file that submits a filter bar when one of its dropdowns
changes, so the filters need no Apply button.

| Path | Responsibility |
| --- | --- |
| `inventory/db.js` | The PostgreSQL pool, and the only place a connection is made. Read-only. |
| `inventory/source.js` | The only place that knows `ledsone`'s tables. All the SQL, and the mapping to the shapes the screens use. |
| `inventory/store.js` | What the rest of the system asks for data. Read-only, and swappable for tests. |
| `inventory/rules.js` | The six detection rules and the stock health bands. |
| `inventory/reports.js` | Derived views: dashboard figures, audit differences, per-screen rows. |
| `inventory/render.js` | HTML only. |
| `inventory/router.js` | Path and query to a response. Pure, so it is testable without a server. |
| `inventory/server.js` | The HTTP shell. |
| `inventory/testdata/` | Invented sample rows. **Test input only** — never loaded into any database, never imported by the application. |

Available stock and the audit difference are never stored. Available is always
`Current − Reserved`, the difference is always `Counted − System`, and every
detected issue is recomputed on each page load — so none of them can drift from
the figures they come from, and an issue cannot be dismissed while its cause is
still there.

Each list screen renders at most 200 rows and says so above the table
("showing 200 of 68,237 stock lines"). The filters narrow the whole set, not the
first page, so a search finds a SKU wherever it sits.

## Standard folders

This repository uses exactly twelve standard top-level folders. Each contains a
`README.md` explaining what belongs in it.

| Folder | Purpose |
| --- | --- |
| `evidence/` | Proof supporting work, decisions, and validation results |
| `documentation/` | Specifications, design notes, and durable operating guidance |
| `handover/` | Material needed to transfer work to another person or team |
| `closure/` | Completion summaries, final decisions, and lessons learned |
| `validation/` | Validation plans, check results, and verification records |
| `workflows/` | Mini-AIOS workflow definitions and repeatable procedures |
| `sql/` | SQL scripts, queries, and database-related definitions |
| `capability/` | Capability definitions, supported functions, and boundaries |
| `prompts/` | Reusable prompts, prompt specifications, and templates |
| `data-maps/` | Data maps, field mappings, and source-to-target mappings |
| `query-packs/` | Reusable grouped query definitions and query templates |
| `duplicate-risk-reports/` | Duplicate-risk assessments and naming collision findings |

### Naming conventions

- Folder names are lowercase.
- Multi-word folder names are hyphenated: `data-maps/`, `query-packs/`,
  `duplicate-risk-reports/` — never underscored or run together.
- `workflows/` is the top-level Mini-AIOS workflow area. It is **not**
  `.github/workflows/`, which is reserved for GitHub Actions and is not created
  unless it is specifically required.

Keeping to these conventions is what prevents near-identical duplicate folders
from accumulating.

## Operating model

Work in this repository is carried out by two roles:

- **GPT acts as the planning BRAIN.** It decides what should be built, sets the
  requirements, and produces the specification to be followed.
- **Claude Code acts as the WORKER.** It carries out the specification as given,
  without inventing additional requirements.

The separation is deliberate: planning decisions stay with the BRAIN, and the
WORKER executes them exactly.

## Validation before handover and closure

Changes should be validated before they move to handover or closure.

1. Carry out the work.
2. Validate it, recording plans and results in `validation/`, with supporting
   proof in `evidence/`.
3. Only once validation passes, prepare transfer material in `handover/`.
4. Record final completion in `closure/`.

Work should not reach handover or closure unvalidated.
