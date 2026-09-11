# testdata — sample rows, for tests only

Everything in this folder is **invented**. No SKU, supplier, warehouse,
quantity or count here comes from a real catalogue or a live inventory system.

## What it is for

The application reads `ledsone`, an existing business database, and is
**read-only** to it. The tests must therefore never open a connection to it —
not even to read — so they run the whole system against these arrays instead,
held in memory:

```js
import { useSource, memorySource } from './store.js';

useSource(memorySource({ products: PRODUCTS, warehouses: WAREHOUSES, stockLines: STOCK_LINES }));
```

The rows are deliberately shaped to exercise every rule: healthy lines, low
lines, zero-available lines, an over-reserved line, a negative line, SKUs held
at sites they are not approved for, a SKU missing from the catalogue, and stock
recorded against a warehouse that does not exist.

## What it is NOT for

It is **not** demonstration data for the running application, and there is no
code path that could make it so:

- Nothing in the production module graph imports this folder. `server.js`,
  `router.js`, `render.js`, `reports.js`, `rules.js`, `store.js`, `source.js`
  and `db.js` reference it nowhere.
- There is no loader, seeder, migration or reset script. The ones that used to
  exist (`fixture/load.js`, `fixture/ensure-test-schema.js`) have been deleted
  along with the schema they wrote into.
- It is never written to `ledsone`, or to any other database. The application's
  only database connection is read-only and holds no write privileges.
