# Smart Inventory Control - evidence

Captured output supporting `validation/inventory-mvp-validation.md`.
Captured **2026-09-11** on Node v24.20.0, Windows 11, against the live `ledsone`
database.

All output below is copied from actual command runs and actual HTTP responses.
Nothing here is illustrative or reconstructed, and no screenshots are claimed.

---

## 1. Test run — `npm test`

```
ℹ tests 155
ℹ suites 35
ℹ pass 155
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## 2. The tests open no database connection

The same suite, run with the connection details deliberately sabotaged. If any
test opened a connection it would fail.

```
$ DB_HOST=0.0.0.0 DB_PORT=1 DB_USER=nobody DB_PASSWORD=x DB_NAME=nope npm test

ℹ tests 155
ℹ pass 155
ℹ fail 0
```

## 3. Server startup — `npm start`

```
[inventory] Smart Inventory Control running on http://localhost:3000/
[inventory] reading ledsone as varmen_user - read-only connection: yes, no write privileges.
```

The second line is printed by `checkConnection()`, which asks PostgreSQL three
questions before the server will listen: is the `inventory` schema there, is
`transaction_read_only` on, and does this role hold INSERT/UPDATE/DELETE. A
"no" to the second or a "yes" to the third stops startup.

## 4. Live routes

```
/            200
/products    200
/stock       200
/alerts      200
/transfers   200
/audit       200
/filters.js  200
/nope        404
```

## 5. Nothing accepts a write

```
POST /products/add      405
POST /stock/edit        405
POST /audit/delete      405
POST /alerts/resolve    405
```

No redirect, no 303, no partial write — each returns the page explaining that
the source database is read-only.

Every screen is **view only**. Counted in the served HTML of all six:

```
screen        <form> total   method="post"   links to /add /edit /delete /resolve
/                   0              0                 0
/products           1              0                 0
/stock              1              0                 0
/alerts             1              0                 0
/transfers          1              0                 0
/audit              1              0                 0
```

The one form on each list screen is the filter bar, which is a `GET` and can
only ask for a different view of the same data.

## 6. Dashboard as rendered live

```
6,510   Total SKUs
4,010   Healthy Stock
561     Low Stock
1,379   Out-of-Stock Items
0       Discrepancies
0       Pending Transfers
```

## 7. The same figures recomputed independently in SQL

Run against `ledsone` directly. Shares no code with the application.

```sql
WITH sku_position AS (
  SELECT p.sku,
         sum(s.quantity)::int          AS on_hand,
         sum(s.reserved_quantity)::int AS reserved,
         (sum(s.quantity) - sum(s.reserved_quantity))::int AS available
    FROM inventory.products p
    LEFT JOIN inventory.physical_product_stock s ON s.inventory = p.id
   WHERE p.inventory_bool
   GROUP BY p.sku
)
SELECT count(*)                                                  AS total_skus,
       count(*) FILTER (WHERE on_hand < 0)                       AS negative_skus,
       count(*) FILTER (WHERE on_hand >= 0 AND available <= 0)   AS out_of_stock_skus,
       count(*) FILTER (WHERE on_hand >= 0 AND available BETWEEN 1 AND 10) AS low_stock_skus,
       count(*) FILTER (WHERE on_hand >= 0 AND available > 10)   AS healthy_skus
  FROM sku_position;
```

```
total_skus | negative_skus | out_of_stock_skus | low_stock_skus | healthy_skus
-----------+---------------+-------------------+----------------+--------------
      6510 |           560 |              1379 |            561 |         4010
```

| Card | Application | SQL | Result |
| --- | --- | --- | --- |
| Total SKUs | 6,510 | 6,510 | MATCH |
| Healthy Stock | 4,010 | 4,010 | MATCH |
| Low Stock | 561 | 561 | MATCH |
| Out-of-Stock Items | 1,379 | 1,379 | MATCH |

`4,010 + 561 + 1,379 + 560 = 6,510` — every SKU in exactly one band.

## 8. Proof that the cards are not counting stock lines

A defect found and fixed during this round: the stock cards were banding stock
lines rather than catalogue SKUs, which produced a Healthy Stock figure of 6,791
against a 6,510-SKU catalogue — larger than the set it is a subset of. Traced to
`dashboardMetrics()` and confirmed against the source:

```sql
SELECT count(*) AS total_lines,
       count(*) FILTER (WHERE s.quantity >= 0 AND s.quantity - s.reserved_quantity > 9) AS healthy_lines
  FROM inventory.physical_product_stock s
  JOIN inventory.products p ON p.id = s.inventory AND p.inventory_bool;
```

```
 total_lines | healthy_lines
-------------+---------------
       68237 |          6791
```

6,791 was exactly the count of healthy **stock lines** — one SKU at one
warehouse — not SKUs. Fixed; see §7 for the figures now.

## 9. Each card and the screen it opens show the same number

```
/products                            showing 200 of 6,510 products
/products?stock=Healthy              showing 200 of 4,010 products matching, out of 6,510
/products?stock=Low+Stock            showing 200 of 561 products matching, out of 6,510
/products?stock=Out+of+Stock         showing 200 of 1,379 products matching, out of 6,510
/products?stock=Negative+Inventory   showing 200 of 560 products matching, out of 6,510
/transfers?status=Pending            0 transfers
/audit?show=discrepancy              0 audit lines
```

## 10. Dashboard issue breakdown against the Alerts screen

Dashboard summary, and the same filter applied on `/alerts`:

| Issue type | Dashboard | `/alerts?type=…` | Result |
| --- | --- | --- | --- |
| Negative Inventory | 2,076 | 2,076 | MATCH |
| Out of Stock | 58,211 | 58,211 | MATCH |
| Low Stock | 1,289 | 1,289 | MATCH |
| Warehouse/SKU Mismatch | 3,160 | 3,160 | MATCH |
| Inactive Listing | 364 | 364 | MATCH |
| Slow-Moving Stock | 2,647 | 2,647 | MATCH |

`2,076 + 58,211 + 1,289 + 3,160 + 364 + 2,647 = 67,747`, which is the unfiltered
total the screen reports:

```
/alerts    showing 200 of 67,747 issues
```

These count **issues** (one SKU at one warehouse), not SKUs, which is correct:
an issue is about a specific line. The six dashboard cards count SKUs.

## 11. Derived figures parsed back out of the rendered HTML

The served HTML was re-parsed and every row recomputed, rather than trusting the
code that produced it:

```
/stock                                 200 rows, 0 mismatches
/stock?status=Negative+Inventory       200 rows, 0 mismatches
/stock?status=Low+Stock                200 rows, 0 mismatches
```

600 of 600 rendered rows satisfy `Available = Current − Reserved`.

## 12. A rendered row checked against the source row

Application, `/stock?q=12AT60`:

```
12AT60 | DC12V LED Transformer Power Adaptor Driver ... 60W | UK Unit3 | -2 | 0 | -2 | Negative Inventory
```

Source:

```sql
SELECT p.sku, w.warehouse_name, s.quantity, s.reserved_quantity
  FROM inventory.physical_product_stock s
  JOIN inventory.products p ON p.id = s.inventory AND p.inventory_bool
  LEFT JOIN inventory.warehouse w ON w.warehouse = s.warehouse
 WHERE p.sku = '12AT60' ORDER BY s.warehouse;
```

```
  sku   |     warehouse_name      | quantity | reserved_quantity
--------+-------------------------+----------+-------------------
 12AT60 | UK Unit3                |       -2 |                 0
 12AT60 | France1                 |        0 |                 0
 12AT60 | Netherlands1            |        0 |                 0
 12AT60 | Canada1                 |        0 |                 0
 12AT60 | Duisburg warehouse      |        0 |                 0
 12AT60 | UK Unit18               |        0 |                 0
 12AT60 | Trossingen schmutter str|        0 |                 0
 12AT60 | UK Unit4                |        0 |                 0
 12AT60 | Trossingen kronen str   |        0 |                 0
 12AT60 | US1                     |        0 |                 0
```

All ten rows agree.

## 13. Real product data on screen

`/products` count line and first rows:

```
showing 200 of 6,510 products

 FWS444BL        S4-44 blue Bata
12ASIP20100      Constant voltage 12V LED Driver Power Supply Transformer ...
12ASIP20150      Constant voltage 12V LED Driver Power Supply Transformer ...
12ASIP20200      Constant voltage 12V LED Driver Power Supply Transformer ...
```

Image sources are the business's own product photographs from the source:

```
src="https://sin1.contabostorage.com/.../img/product_images/42215.jpg"
src="https://sin1.contabostorage.com/.../img/product_images/2844.jpg"
```

Filter options, built from the real data rather than a declared list:

```
categories: 324 options   (323 real values from listings.shopify_listings.product_type, plus "All categories")
suppliers:   45 options   (44 real values from suppliers.suppliers, plus "All suppliers")
```

A product view page, `/products/view?sku=12AT60`:

```
SKU                    12AT60
Product name           DC12V LED Transformer Power Adaptor Driver for Led Strips MR 16 CCTV A++ - 60W
Category               Constant Voltage Transformer
Supplier               Not recorded
Listing status         Inactive    (End-of-line status in the source: Permanent.)
Units held             -2          (Across 10 stock lines. Totalled from the stock data, not stored here.)
Units sold (90 days)   0
```

"Not recorded" is shown where the source holds nothing — never a blank or a zero.

## 14. Empty screens explain themselves

`/transfers`:

```
0 transfers
ledsone holds no inter-warehouse transfer records, so there is nothing to show
here. This screen reads the source; it does not create transfers.
No transfers match these filters.
```

`/audit`:

```
0 audit lines
ledsone holds no physical stock counts, so there is nothing to compare against
the system figure. This screen reads the source; it does not record counts.
No audit lines match these filters.
```

`/stock`:

```
Low Stock is flagged below 10 available. ledsone holds no minimum or reorder
level for a SKU, so Low Stock is flagged against a single application-wide
threshold instead.
```

## 15. Every link on every screen followed

```
links found: 619
crawl complete - no output above means no broken links
```

### The defect this crawl found

The first crawl returned 11 broken links:

```
BROKEN 404 /products/view?sku=%20FWS444BL
BROKEN 404 /stock/view?sku=%20FWS444BL&warehouse=1
BROKEN 404 /stock/view?sku=%20FWS444BL&warehouse=2
... (nine more, one per warehouse)
```

Cause, confirmed in the source — seven real SKUs carry untrimmed whitespace:

```sql
SELECT '[' || sku || ']' AS sku_bracketed, length(sku) AS len, length(btrim(sku)) AS trimmed_len
  FROM inventory.products WHERE inventory_bool AND sku <> btrim(sku);
```

```
  sku_bracketed  | len | trimmed_len
-----------------+-----+-------------
 [ FWS444BL]     |   9 |           8
 [CGSPBM ]       |   7 |           6
 [CGSPWH ]       |   7 |           6
 [IMWW ]         |   5 |           4
 [RBLSDO300BI  ] |  13 |          11
 [RBLSWG135YB ]  |  12 |          11
 [WSLFS1002BM  ] |  13 |          11
```

The router trimmed every query parameter, so an href built from the real SKU was
trimmed back to something matching nothing. Fixed by comparing identifiers
exactly and trimming only filter text. Re-crawl: 619 links, 0 broken.

## 16. Source database safety

```sql
SELECT has_table_privilege('varmen_user','inventory.products','INSERT')            AS can_insert,
       has_table_privilege('varmen_user','inventory.products','UPDATE')            AS can_update,
       has_table_privilege('varmen_user','inventory.products','DELETE')            AS can_delete,
       has_table_privilege('varmen_user','inventory.physical_product_stock','UPDATE') AS can_update_stock,
       has_schema_privilege('varmen_user','inventory','CREATE')                    AS can_create_in_schema,
       has_database_privilege('varmen_user','ledsone','CREATE')                    AS can_create_schema,
       (SELECT count(*) FROM information_schema.schemata
         WHERE schema_name IN ('inventory_control','inventory_control_test'))      AS app_schemas,
       (SELECT count(*) FROM inventory.products)               AS products,
       (SELECT count(*) FROM inventory.physical_product_stock) AS stock_rows,
       (SELECT count(*) FROM inventory.warehouse)              AS warehouses;
```

```
 can_insert | can_update | can_delete | can_update_stock | can_create_in_schema | can_create_schema
------------+------------+------------+------------------+----------------------+-------------------
 false      | false      | false      | false            | false                | false

 app_schemas | products | stock_rows | warehouses
-------------+----------+------------+------------
           0 |    44494 |      76683 |         10
```

No application schema was ever created in `ledsone`, and the role holds no
write privilege of any kind.

### About the `products` count

`inventory.products` was 44,492 at the start of this work and 44,494 at the end.
**This application did not add those rows and could not have** — `can_insert` is
`false` above, the connection is read-only, and there is no INSERT statement in
the codebase.

`ledsone` is a live business database that other systems write to continuously.
The two new rows are bundle SKUs created by the order/listing systems during the
session:

```sql
SELECT id, sku, inventory_bool, created_at FROM inventory.products ORDER BY id DESC LIMIT 2;
```

```
  id   |               sku                | inventory_bool |      created_at
-------+----------------------------------+----------------+---------------------
 44503 | CRSF100BM+PHTT2PBRBM+WCDC10BM    | false          | 2026-09-11 09:39:07
 44502 | ENC10398                         | false          | 2026-09-11 09:13:04
```

Both carry `inventory_bool = false`, so neither is in this system's catalogue:

```sql
SELECT count(*) FROM inventory.products WHERE inventory_bool;
```

```
 count
-------
  6510
```

The catalogue is **unchanged at 6,510**, and every figure in this document
remains valid. This is what a read-only view over a live source looks like: the
source moves, and the reader does not move it.

## 17. No write SQL in the application

```
$ grep -rnoiE "\b(insert +into|update +[a-z_.\"]+ +set|delete +from|truncate|
    create +(table|schema|database|index)|alter +table|drop +(table|schema))\b" inventory/*.js

none
```

The only occurrences of those words anywhere in `inventory/` are inside comments
in `db.js` explaining why they cannot happen.

## 18. Demonstration data is unreachable from production

Production modules importing `testdata/`:

```
inventory/server.js:0
inventory/router.js:0
inventory/render.js:0
inventory/reports.js:0
inventory/rules.js:0
inventory/store.js:0
inventory/source.js:0
inventory/db.js:0
```

References to `varmen` in application code and `package.json`:

```
(none)
```

Configured source database:

```
$ grep ^DB_NAME inventory/.env
DB_NAME=ledsone
```

Deleted, and confirmed absent:

```
gone: inventory/fixture
gone: inventory/test.env
gone: sql/001-inventory-control-schema.sql
gone: inventory/crud.test.js
gone: inventory/store.test.js
gone: inventory/fixture.test.js
```

`package.json` scripts, with no `pretest` and no seed step:

```json
"scripts": {
  "start": "node inventory/server.js",
  "test": "node --test --test-concurrency=1 \"inventory/**/*.test.js\""
}
```

## 19. Server stopped

The server was stopped after verification. No background process was left
running, and no connection to `ledsone` remains open.
