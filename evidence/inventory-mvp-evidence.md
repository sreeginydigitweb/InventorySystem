# Smart Inventory Control MVP - evidence

Captured output supporting `validation/inventory-mvp-validation.md`.
Captured 2026-09-10 on Node v24.20.0, Windows 11.

All output below is copied from actual command runs. Nothing here is
illustrative or reconstructed, and no screenshots are claimed.

## 1. Test run - `npm test`

```
ℹ tests 173
ℹ suites 41
ℹ pass 173
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 309.4212
```

## 2. Independent recomputation from the raw data files

Recalculated directly from `inventory/data/*.js` without importing `rules.js` or
`reports.js`:

```
Total SKUs        : 14
Healthy Stock     : 22
Low Stock         : 5
Out-of-Stock      : 4
Negative Inventory: 1
Discrepancies     : 5 | Audit matches: 5
Pending Transfers : 3
Bands sum         : 32 of 32 lines

mismatch: unknown warehouse 1 | unknown SKU 1 | unapproved site 1
inactive listing holding stock: 4
slow-moving (active, held, <=5): 3
over-reserved lines: 1
transfer statuses: { Pending: 3, 'In Transit': 3, Received: 2 }
```

## 3. Rendered HTML parsed back and re-checked

```
PASS  parsed 32 stock rows from HTML (expected 32)
PASS  every rendered Available = Current - Reserved
PASS  parsed 10 audit rows (expected 10)
PASS  every rendered Difference = Counted - System
PASS  all 14 products render sku+name+category+supplier+image
PASS  all 8 transfers render
PASS  issue type shown: Low Stock / Out of Stock / Negative Inventory /
      Warehouse/SKU Mismatch / Inactive Listing / Slow-Moving Stock
ALL HTML CONTENT CHECKS PASSED
```

## 4. Server startup - `npm start`

```
> smart-inventory-control@0.1.0 start
> node inventory/server.js

[inventory] Smart Inventory Control running on http://localhost:3000/
[inventory] dummy data only - no database, no live inventory source.
```

This was the complete server log after every route, filter and image below had
been requested: no errors, no warnings.

## 5. Live routes

```
/              HTTP 200    11050 bytes  0.019245s
/products      HTTP 200    14992 bytes  0.002092s
/stock         HTTP 200    21258 bytes  0.001845s
/alerts        HTTP 200    16618 bytes  0.001699s
/transfers     HTTP 200    11731 bytes  0.001763s
/audit         HTTP 200    12809 bytes  0.001384s
```

## 6. Live images

```
SIC-1001   HTTP 200  image/svg+xml; charset=utf-8  383 bytes
SIC-3001   HTTP 200  image/svg+xml; charset=utf-8  386 bytes
SIC-5003   HTTP 200  image/svg+xml; charset=utf-8  374 bytes
SIC-9999   HTTP 200  image/svg+xml; charset=utf-8  367 bytes
```

`SIC-9999` is the SKU deliberately absent from the catalogue; it returns a
neutral placeholder rather than a broken image.

## 7. Live filters

```
/products?category=Bulbs                   -> 3 of 14 products
/products?supplier=Verity+Home+Fittings    -> 4 of 14 products
/products?q=aurora                         -> 1 of 14 products
/stock?warehouse=WH-BIR                    -> 10 of 32 stock lines
/stock?status=Low+Stock                    -> 5 of 32 stock lines
/stock?status=Negative+Inventory            -> 1 of 32 stock lines
/alerts?type=Warehouse%2FSKU+Mismatch      -> 3 of 20 issues
/alerts?type=Inactive+Listing              -> 4 of 20 issues
/alerts?warehouse=WH-MAN                   -> 5 of 20 issues
/transfers?status=Pending                  -> 3 of 8 transfers
/transfers?status=In+Transit               -> 3 of 8 transfers
/transfers?status=Received                 -> 2 of 8 transfers
/audit?difference=only                     -> 5 of 10 audit lines
/audit?warehouse=WH-BIR                    -> 4 of 10 audit lines
```

## 8. Navigation - every link on every screen followed

```
/            19 links checked, 0 broken
/products     6 links checked, 0 broken
/stock        6 links checked, 0 broken
/alerts       6 links checked, 0 broken
/transfers    6 links checked, 0 broken
/audit        6 links checked, 0 broken
```

## 9. Dashboard tiles as rendered live

```
14   Total SKUs
22   Healthy Stock
5    Low Stock
4    Out-of-Stock Items
5    Discrepancies
3    Pending Transfers
```

## 10. Repository standard intact

```
all 12 folder READMEs still byte-identical to canonical (untouched)
Initial-Mini-AIOS HEAD 5c1233a | changes: 0
Task 1 HEAD 05987d0 | changes: 0
```

## 11. Server stopped

```
SUCCESS: The process with PID 13356 has been terminated.
probe after stop: 000
server stopped cleanly (connection refused)
```

---

# Round two - add, edit and delete

Captured 2026-09-10 on Node v24.20.0, Windows 11, supporting the second round in
`validation/inventory-mvp-validation.md`. Same rule as above: every block is
copied from an actual run. Sections 1-11 were re-run unchanged and still hold.

## 12. Test run - `npm test`

```
ℹ tests 307
ℹ suites 60
ℹ pass 307
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 408.6108
```

By file:

```
crud.test.js      64      (new - the record routes and the workflows)
data.test.js      35
render.test.js    24
reports.test.js   33
router.test.js    42
rules.test.js     40
store.test.js     69      (new - the write operations and their validation)
```

## 13. Products - add, view, edit, delete over HTTP

```
GET  /products/add                 200
POST /products/add   SIC-9100      303  /products?done=product-added&subject=SIC-9100
GET  /products/view?sku=SIC-9100   200
     view shows: /images/SIC-9100.svg
     view shows: Evidence Test Lamp
     view shows: pill ok">Active
     view shows: Verity Home Fittings
POST /products/edit  -> Inactive   303  /products?done=product-updated&subject=SIC-9100
     view shows: (edited)
     view shows: pill neutral">Inactive
POST /products/add   duplicate SKU 400   (refused)
POST /products/add   bad listing   400   (refused)
GET  /products/delete (asks)       200   record still present: 200
POST /products/delete              303  /products?done=product-deleted&subject=SIC-9100
GET  view after delete             404
```

## 14. Warehouse stock - Available is recalculated, never accepted

```
dashboard Low Stock, before        5
POST /stock/add  10 on hand, min 50 303  /stock?done=stock-added&subject=SIC-1003
dashboard Low Stock, after add     6   (the new line is short)
     view shows: <strong>8</strong>
     view shows: 10 on hand minus 2 reserved
     view shows: pill warn">Low Stock
POST /stock/edit 120 on hand, res 15 303  /stock?done=stock-updated&subject=SIC-1003
     view shows: <strong>105</strong>
     view shows: 120 on hand minus 15 reserved
     view shows: pill ok">Healthy
dashboard Low Stock, after fix     5   (back where it started)

name="available" on /stock/add     0 occurrences
name="available" on /stock/edit    0 occurrences
POST /stock/add  available=999     303   (accepted, field ignored)
     view shows: <strong>30</strong>
     view shows: 40 on hand minus 10 reserved
```

An `available=999` posted alongside 40 on hand and 10 reserved is discarded: the
record stores the three figures and the screen shows 30.

Validation refusals:

```
POST /stock/add  unknown SKU       400
POST /stock/add  unknown warehouse 400
POST /stock/add  duplicate pair    400
POST /stock/add  reserved=-1       400
```

## 15. Alerts - a resolved issue is still a detected issue

Measured on the running server over HTTP, by counting the SIC-1002 row on
`/alerts?type=Low+Stock&warehouse=WH-BIR`:

```
Low Stock rows for SIC-1002@WH-BIR, before   1   labelled: pill neutral">Open
POST /alerts/resolve                        303  /alerts?done=issue-resolved&subject=Low Stock on SIC-1002
Low Stock rows for SIC-1002@WH-BIR, after    1   labelled: pill ok">Resolved
                                            ^ still raised, now carrying the label

-- correct the stock, which is the only thing that clears it --
POST /stock/edit  onHand 18 -> 200           303  /stock?done=stock-updated&subject=SIC-1002
Low Stock rows for SIC-1002@WH-BIR, now      0   <- gone, because the stock is no longer short
```

Recording an action:

```
GET  /alerts/view                  200
     view shows: 12 available against a minimum of 20
     view shows: Birmingham Central
     view shows: Low Stock
     view shows: pill neutral">Open
     view shows: SIC-1002
POST /alerts/edit  In Progress+note 303  /alerts?done=issue-actioned&subject=Low Stock on SIC-1002
     view shows: Chased Halden; 60 units due Friday.
     view shows: pill info">In Progress
POST /alerts/edit  bad status      400   (refused)
```

> A first attempt at this section measured the issue count by spawning
> `node -e "import('./inventory/reports.js')..."`. That runs in a **separate
> process** with its own copy of the seed data and cannot see the running
> server's session, so it reported the seeded figure both before and after and
> proved nothing. The measurement above goes over HTTP to the server itself.
> The discarded attempt is recorded here rather than quietly dropped.

## 16. Transfers - still a record only

```
dashboard Pending Transfers, before 3
POST /transfers/add                303  /transfers?done=transfer-added&subject=TR-1009
dashboard Pending Transfers, after  4
GET  /transfers/view?id=TR-1009     200
     view shows: Birmingham Central
     view shows: Bristol South West
     view shows: pill warn">Pending
     view shows: TR-1009
POST /transfers/edit -> In Transit  303  /transfers?done=transfer-updated&subject=TR-1009
     view shows: pill info">In Transit
SIC-1001 @ WH-BIR available         72 before, 72 after   (transfers move no stock)
POST same warehouse both ends       400   (refused)
POST status=Cancelled               400   (refused)
POST quantity=0                     400   (refused)
POST unknown warehouse              400   (refused)
GET  /transfers/delete (asks)       200   record still present: 200
POST /transfers/delete              303  /transfers?done=transfer-deleted&subject=TR-1009
GET  view after delete              404
```

## 17. Inventory audit - Difference is recalculated, never accepted

```
GET  /audit/add?sku=SIC-3001&warehouse=WH-BIR   200
     system figure prefilled from the stock data: name="systemQuantity" value="260"
dashboard Discrepancies, before                5
POST /audit/add  counted 250 of 260            303  /audit?done=audit-added&subject=AC-1011
dashboard Discrepancies, after                 6
     view shows: 250 counted minus 260 system
     view shows: class="neg">-10<
     view shows: pill bad">Discrepancy
POST /audit/edit counted 250 -> 260            303  /audit?done=audit-updated&subject=AC-1011
     view shows: 260 counted minus 260 system
     view shows: muted">0<
     view shows: pill ok">Matches
POST /audit/edit counted 260 -> 275            303  /audit?done=audit-updated&subject=AC-1011
     view shows: 275 counted minus 260 system
     view shows: class="pos">+15<

name="difference" on /audit/add                0 occurrences
POST /audit/add  difference=999                303   (accepted, field ignored)
     audit list shows the calculated value: class="neg">-4<
POST /audit/add  counted=-1                    400   (refused)
POST /audit/add  no counter                    400   (refused)
GET  /audit/delete (asks)                      200   record still present: 200
POST /audit/delete                             303  /audit?done=audit-deleted&subject=AC-1011
GET  view after delete                         404
```

The difference was driven negative, to zero and positive by editing only the
counted figure. A `difference=999` posted against 48 system and 44 counted is
discarded: the list shows the calculated `-4`.

## 18. Deleting a product that other records point at

```
     confirmation page says: is still referenced by 2 stock line(s), 0 transfer(s) and 1 audit record(s)
POST /products/delete  no consent   400   (refused)
product still present               200
stock line still present            200
POST /products/delete  cascade=yes  303  /products?done=product-deleted-cascade&subject=SIC-2002
product gone                        404
its stock line gone with it         404   (no dangling reference)
```

## 19. Nothing destructive is reachable by a GET

All four delete confirmation pages fetched, then every record re-checked:

```
GET /products/delete?sku=SIC-1001                200
GET /stock/delete?sku=SIC-1001&warehouse=WH-BIR  200
GET /transfers/delete?id=TR-1001                 200
GET /audit/delete?id=AC-1001                     200

records afterwards: product 200, stock 200, transfer 200, audit 200
```

Method handling:

```
DELETE /products          405
PUT    /stock             405
POST   application/json   400   (only form-encoded bodies are accepted)
```

## 20. Links and responsive structure across all 24 screens

Every link on the six list screens followed:

```
/            19 links checked, 0 broken
/products    46 links checked, 0 broken
/stock       97 links checked, 0 broken
/alerts      40 links checked, 0 broken
/transfers   31 links checked, 0 broken
/audit       37 links checked, 0 broken
           270 links total, 0 broken
```

Structural check over the six list screens plus all eighteen record screens:

```
screens checked        : 24
tables found           : 8, all inside a scroll container
viewport meta          : present on all 24
three breakpoints      : present on all 24
client-side JavaScript : none on any screen
fixed widths > 320px   : none
forms/detail collapse  : one column below 768px on every screen that has them

0 problems.
```

This is a structural check of the served HTML and CSS, not a rendered-pixel
check. No browser automation was available in the session that produced it, so
no screenshot or measured layout is claimed.

## 21. Server log and shutdown

The complete log after every request in sections 13-20, including the 400s and
404s, had been made:

```
> smart-inventory-control@0.1.0 start
> node inventory/server.js

[inventory] Smart Inventory Control running on http://localhost:3000/
[inventory] dummy data only - no database, no live inventory source.
```

No errors, no warnings, no stack traces.

```
terminated PID 8280
probe after stop: 000   (connection refused)
```
