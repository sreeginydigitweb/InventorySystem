# Smart Inventory Control MVP - capabilities

What the MVP can do, and where it stops. Recorded 2026-09-10.

## Capabilities

| Capability | What it covers |
| --- | --- |
| **Dashboard** | Total SKUs, Healthy Stock, Low Stock, Out-of-Stock Items, Discrepancies and Pending Transfers, plus a breakdown by issue type and by transfer status. Every tile links through to the filtered screen behind it. |
| **Products** | The catalogue: SKU, image, product name, category, supplier, listing status and total units held. Search across SKU, name and supplier; filter by category and supplier. View, add, edit and delete. |
| **Warehouse Stock** | Stock by SKU and warehouse: current, reserved, available, minimum and health band. Search by SKU or name; filter by warehouse and band. View, add, edit and delete; available is recalculated, never entered. |
| **Alerts / Issues** | The six detected issue types, each naming the SKU and warehouse affected and the reason it was raised. Filter by issue type, warehouse and action status. View one issue, and record an action status and note against it. |
| **Transfers** | Transfer id, SKU, product, source, destination, quantity, status and date raised. Filter by status and by warehouse at either end. View, add, edit and delete. |
| **Inventory Audit** | System quantity against counted quantity, with the signed difference and whether the line agreed. Filter by warehouse, or narrow to discrepancies only. View, add, edit and delete; the difference is recalculated, never entered. |

## Detection rules

| Rule | Condition |
| --- | --- |
| Low Stock | `available < minimum` and `available > 0` |
| Out of Stock | `available <= 0` |
| Negative Inventory | `onHand < 0` |
| Warehouse/SKU Mismatch | Unknown warehouse, unknown SKU, or SKU not approved for that site |
| Inactive Listing | Listing withdrawn and `onHand > 0` |
| Slow-Moving Stock | Active, `onHand > 0`, and 5 or fewer units sold in 90 days |

`available` and the audit `difference` are always derived, never stored - and
neither appears as a field on any form, so a saved figure cannot disagree with
the figures it comes from.

Health bands are assigned most serious first - Negative, then Out of Stock, then
Low Stock, then Healthy - so every stock line sits in exactly one band and the
dashboard figures reconcile against the stock lines.

## Add, edit and delete

Added 2026-09-10, on top of the read-only MVP above.

| What | Behaviour |
| --- | --- |
| **Scope** | Products, Warehouse Stock, Transfers and Inventory Audit have view, add, edit and delete. Alerts has view and an action record. |
| **Where changes live** | In memory, for the life of the server process. The files in `inventory/data/` are the seed; a restart discards every change. Still no database. |
| **How writes happen** | Plain HTML forms posting to the server. A `GET` never changes anything, so a delete link only opens the page that asks. |
| **After a successful write** | A redirect to the list screen, so refreshing cannot repeat it. |
| **After a rejected write** | The form again, with the submitted values still in it and the reason named against the field. Nothing partial is ever saved. |

### Validation applied

| Area | Rules enforced |
| --- | --- |
| Products | SKU required, unique (case-insensitively) and not editable once set; name, category, supplier and listing status required; category and supplier must be declared ones; listing status must be Active or Inactive. |
| Warehouse Stock | SKU must exist in the catalogue; warehouse must exist; on hand, reserved and minimum must be whole numbers; reserved and minimum cannot be negative; one line per SKU per warehouse. |
| Alerts | Action status must be Open, In Progress or Resolved; note capped at 500 characters. |
| Transfers | SKU must exist; both warehouses must exist and must differ; quantity must be above zero; status must be Pending, In Transit or Received; date must be a real calendar date. |
| Inventory Audit | SKU and warehouse must exist; both quantities must be whole numbers; a physical count cannot be negative; whoever counted is required. |

Two combinations that look invalid are accepted on purpose, because the
detection rules exist to report them: on hand below zero (Negative Inventory)
and reserved above on hand (Out of Stock). Refusing them on the form would make
two of the six rules unreachable.

### Resolving an issue does not clear it

An issue is a conclusion the rules reach about the stock data, recomputed on
every page load - not a record. Staff record what they **did**: Open, In
Progress or Resolved, plus a note. That never suppresses the detection. A
shortage marked Resolved while the stock is still below minimum is detected
again, listed again and counted again, carrying the Resolved label. Only
correcting the stock figures clears it.

### Deleting a product that is still referenced

Refused, with the confirmation page naming the stock lines, transfers and audit
records that point at it. Staff can agree to remove those too with an explicit
tick, so a deletion never leaves a record pointing at a SKU that is gone.

## Boundaries - what this MVP explicitly does not do

Recording these matters as much as recording what is supported.

- **No database.** All data is loaded from files in `inventory/data/` at startup.
- **No live inventory source, marketplace or warehouse integration, and no API.**
- **Nothing survives a restart.** Records can be added, edited and deleted, but
  only in memory. The server answers `GET`, `HEAD` and `POST`; any other
  method returns 405, and `POST` is accepted only as form-encoded data from the
  record forms.
- **No audit trail of changes.** Who changed a record, and when, is not kept -
  only the action notes staff write against issues carry a timestamp.
- **No concurrency control.** Two people editing the same record last-write-wins.
- **Transfers do not move stock.** They are a record; their quantities are
  deliberately not applied to the stock lines.
- **No authentication, user management or permissions.** Anyone who can reach
  the port sees everything.
- **No deployment configuration.** It runs locally via `npm start`.
- **No sales history.** `unitsSoldLast90Days` is a single field standing in for
  one, and is the only input to the slow-moving rule.
- **Alerts are still not a workflow engine.** An issue can be given a status and
  a note, but not assigned to anyone, escalated or scheduled - and it cannot be
  raised or deleted by hand, because the list is recomputed from the stock data
  on every page load.

## Judgment calls inside the rules

Two rules resolve an overlap the requirement does not settle. Both are
deliberate and were reviewed against the MVP source, which does not require
different behaviour.

1. **Low Stock and Out of Stock never both fire on one line.** Low Stock
   additionally requires `available > 0`, so each line falls into one band.
2. **Slow-Moving requires an active listing**, so stock against a withdrawn
   listing is reported once as an Inactive Listing rather than twice.

A line may still raise several issues where they are genuinely different
problems - stock held at an unapproved site can also be running low.
