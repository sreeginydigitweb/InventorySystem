# Smart Inventory Control

## Purpose

Smart Inventory Control gives a clear, single view of what stock exists, where it
is held, what is moving between locations, and what needs attention — so stock
problems are seen and acted on rather than discovered late.

## What this repository contains

This repository will hold the **Smart Inventory Control MVP**.

The MVP runs on **realistic dummy inventory data**. There is no live inventory
database and no real inventory data at this stage: the dummy data is invented,
and is shaped as the real thing would be so the system can be built and reviewed
before any live source is connected.

The system will eventually cover:

| Area | Purpose |
| --- | --- |
| Dashboard | The overall stock position at a glance |
| Products | The product and SKU records the system works from |
| Warehouse Stock | Stock held, by product and by location |
| Alerts / Issues | Stock conditions that need attention |
| Transfers | Stock moving between locations |
| Inventory Audit | Counting stock and reconciling what is found against what is expected |

All six areas read and write PostgreSQL. The application serves the
`inventory_control` schema in `varmen_db` and never seeds it: what is on
screen is whatever is in that schema.

## Running it

Node 20 or newer, and a PostgreSQL database.

```
npm install                                  # one dependency: pg
cp inventory/.env.example inventory/.env     # then fill it in
psql "<connection>" -f sql/001-inventory-control-schema.sql
npm start                                    # http://localhost:3000/
npm test                                     # the test suite
```

There is no seed step for the application. `inventory_control` holds the real
stock data, and nothing in the running application writes demonstration data
into it.

`inventory/.env` holds the connection and is git-ignored. `.env.example` is the
template and holds no real values.

## Tests and the production schema

The suite empties and reseeds every table it touches on each test case, so it is
kept away from the production schema by two independent measures:

1. `npm test` loads `inventory/test.env`, which sets `DB_SCHEMA=inventory_control_test`.
   The schema is created and seeded automatically by the pretest step. Connection
   details still come from `inventory/.env`, so the password lives in one file only.
2. `inventory/fixture/load.js` refuses outright to delete or seed when `DB_SCHEMA`
   is `inventory_control`, whatever the configuration says. A shell variable that
   overrides `test.env` does not get past it - the run fails with a clear message
   and writes nothing.

So the fixture can only ever reach the test schema, and `npm run seed:test` is
the only way to load it.

`documentation/smart-inventory-control-mvp.md` covers the dummy data structure,
the detection rules and each of the six areas in detail.

## How the application is laid out

Data, business logic and rendering are kept apart. Filtering runs on the server
from the query string; the only client-side JavaScript is `/filters.js`, a
single same-origin file that submits a filter bar when one of its dropdowns
changes, so the filters need no Apply button.

| Path | Responsibility |
| --- | --- |
| `inventory/db.js` | The PostgreSQL pool, and the only place a connection is made. |
| `inventory/fixture/` | Test fixture only. Never loaded by the application, and never written to `inventory_control`. |
| `inventory/fixture/load.js` | Loads the fixture into the **test** schema. Refuses to run against `inventory_control`. |
| `inventory/fixture/ensure-test-schema.js` | Creates and seeds `inventory_control_test` before the suite runs. |
| `inventory/store.js` | The only place data is read or written: validation and the SQL. |
| `inventory/rules.js` | The six detection rules and the stock health bands. |
| `inventory/reports.js` | Derived views: dashboard figures, audit differences, per-screen rows. |
| `inventory/render.js` | HTML only. |
| `inventory/router.js` | Path and query to a response, and form posts to a write. Pure, so both are testable without a server. |
| `inventory/server.js` | The HTTP shell. |

Records are added, edited and deleted through the screens and persist in
PostgreSQL - restarting the server changes nothing. The application reads and
writes one schema, `inventory_control`, and never touches any other schema in
the database. Available stock and the audit difference have no columns at all:
both are always calculated, never stored and never entered.

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
