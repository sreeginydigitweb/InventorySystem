/**
 * HTML rendering for Smart Inventory Control.
 *
 * Pure string building. No data access, no rule evaluation, no I/O: every
 * function here is handed the rows it should show and does nothing but turn
 * them into markup.
 *
 * Two rules hold throughout:
 *
 * 1. Every dynamic value goes through escapeHtml before it reaches the page.
 *    The data comes from PostgreSQL, so the rule is not optional: anything a
 *    member of staff can type is escaped before it reaches a page.
 *
 * 2. There is exactly one script in the system, and it does one thing.
 *    /filters.js submits a list screen's filter bar when one of its controls
 *    changes, which is what makes the filters apply without an Apply button.
 *    It is served from this origin, so the CSP allows script-src 'self' and
 *    nothing else - no inline handler, no CDN, no dependency. Filtering itself
 *    still happens on the server from query-string parameters, so a filtered
 *    view is a plain URL, and every page but the filter bar works untouched
 *    with scripting disabled.
 */

/** Shown wherever a value is absent. */
export const UNKNOWN_LABEL = 'Unknown';

/**
 * Shown wherever the SOURCE DATABASE has no value for a field.
 *
 * Deliberately different from UNKNOWN_LABEL, and deliberately not a blank cell
 * or a zero. "Not recorded" says the business has not captured this, which is
 * the true answer for a SKU with no listing, no purchase order or no sales -
 * and it can never be mistaken for a figure.
 */
export const NOT_IN_SOURCE = 'Not recorded';

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for interpolation into HTML text or an attribute.
 *
 * Ampersand is replaced in the same pass as the rest, so entities cannot be
 * double-built. Applied to every dynamic value without exception.
 *
 * @param {unknown} value
 * @returns {string}
 */
/**
 * The View icon used in every Action column.
 *
 * Inline SVG rather than an image or a font: the page loads nothing external,
 * the icon inherits the link colour in both the light and the dark parts of the
 * stylesheet, and it stays sharp at any zoom. aria-hidden because the link
 * around it already carries the label for a screen reader.
 */
const ICON_VIEW =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z"/>' +
  '<circle cx="12" cy="12" r="3"/></svg>';

export function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Format a signed quantity for the audit difference column, so a shortage and
 * an overage are told apart at a glance.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatDifference(value) {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : String(value);
}

/** The six areas, in navigation order. */
export const NAV_ITEMS = Object.freeze([
  Object.freeze({ path: '/', label: 'Dashboard' }),
  Object.freeze({ path: '/products', label: 'Products' }),
  Object.freeze({ path: '/stock', label: 'Warehouse Stock' }),
  Object.freeze({ path: '/alerts', label: 'Alerts / Issues' }),
  Object.freeze({ path: '/transfers', label: 'Transfers' }),
  Object.freeze({ path: '/audit', label: 'Inventory Audit' }),
]);

/**
 * CSS class for a stock health band, so problem stock is identifiable without
 * reading the numbers.
 *
 * @param {string} status
 * @returns {string}
 */
export function statusClass(status) {
  switch (status) {
    case 'Healthy':
      return 'ok';
    case 'Low Stock':
      return 'warn';
    case 'Out of Stock':
      return 'bad';
    case 'Negative Inventory':
      return 'critical';
    default:
      return 'neutral';
  }
}

/**
 * CSS class for an issue type. Shares the palette with the stock bands so the
 * same problem looks the same on every screen.
 *
 * @param {string} type
 * @returns {string}
 */
export function issueClass(type) {
  switch (type) {
    case 'Negative Inventory':
      return 'critical';
    case 'Out of Stock':
      return 'bad';
    case 'Low Stock':
      return 'warn';
    case 'Warehouse/SKU Mismatch':
      return 'bad';
    case 'Inactive Listing':
      return 'neutral';
    case 'Slow-Moving Stock':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/**
 * CSS class for a transfer status.
 *
 * @param {string} status
 * @returns {string}
 */
export function transferStatusClass(status) {
  switch (status) {
    case 'Pending':
      return 'warn';
    case 'In Transit':
      return 'info';
    case 'Received':
      return 'ok';
    default:
      return 'neutral';
  }
}

const STYLES = `
  :root {
    color-scheme: light;
    --accent: #2b6cb0;
    --line: #dfe3e8;
    --muted: #5c6672;
    --ink: #1c1f23;
    --ok-bg: #e6f4ea; --ok-fg: #1e6b34;
    --warn-bg: #fdf3d8; --warn-fg: #8a5a00;
    --bad-bg: #fbe6e6; --bad-fg: #a52222;
    --critical-bg: #a52222; --critical-fg: #ffffff;
    --info-bg: #e4edfa; --info-fg: #1f4f8f;
    --neutral-bg: #eceff2; --neutral-fg: #48525e;
    /* One gutter drives the masthead and the main column, so the page keeps a
       single edge from the widest desktop down to the narrowest phone. */
    --gutter: 1.5rem;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; padding: 0; background: #f6f7f9; color: var(--ink);
    font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  /* Nothing is allowed to push the page wider than the viewport: only the
     table containers below ever scroll sideways. */
  img, svg { max-width: 100%; }
  header.masthead { background: #22303f; color: #fff; padding: .9rem var(--gutter) .1rem; }
  header.masthead .title { font-size: 1.05rem; font-weight: 600; letter-spacing: .01em; }
  nav { display: flex; flex-wrap: wrap; gap: .25rem; margin-top: .75rem; }
  nav a {
    color: #cbd5e0; text-decoration: none; font-size: .88rem;
    padding: .5rem .8rem; border-radius: 5px 5px 0 0;
  }
  nav a:hover { background: #2e3f52; color: #fff; }
  nav a[aria-current="page"] { background: #f6f7f9; color: var(--ink); font-weight: 600; }
  nav a:focus-visible { outline: 2px solid #7fb2ee; outline-offset: -2px; }
  main { max-width: 1180px; width: 100%; margin: 0 auto; padding: 1.5rem var(--gutter) 2.5rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .2rem; overflow-wrap: break-word; }
  p.lede { color: var(--muted); font-size: .88rem; margin: 0 0 1.25rem; overflow-wrap: break-word; }

  /* Dashboard tiles.

     Six cards on one grid: three to a row on a desktop, two on a tablet, one
     on a phone. minmax(0, 1fr) rather than 1fr is what keeps the columns
     exactly equal - a plain 1fr track has an automatic minimum, so the card
     with the longest word would otherwise be allowed to push itself wider than
     the other two in its row.

     Grid already stretches every card in a row to the height of the tallest,
     so the cards are equal in size whatever they contain. Making each card a
     flex column and pushing .unit down with margin-top:auto lines the three
     parts up ACROSS the row as well: the numbers share a top edge and the
     descriptions share a bottom edge, so a name that wraps onto a second line
     moves nothing else out of true.

     The whole card is one <a>, so the number, the name and the description are
     a single click target rather than three. */
  .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .9rem; margin: 0 0 1.75rem; }
  .tile {
    background: #fff; border: 1px solid var(--line); border-radius: 7px; padding: .95rem 1rem;
    display: flex; flex-direction: column; text-decoration: none; color: inherit; min-width: 0;
    cursor: pointer;
    transition: border-color .12s ease, box-shadow .12s ease, transform .12s ease;
  }

  /* Hover says "this is a shortcut" without moving the grid: the border picks
     up the accent, a small shadow lifts the card off the page and it rises by
     one pixel. The transform is a paint-only change, so nothing around it
     reflows and no other card shifts. */
  a.tile:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgb(15 23 32 / 10%); transform: translateY(-1px); }
  a.tile:active { transform: translateY(0); box-shadow: none; }

  /* Keyboard focus is the accent ring, offset so it sits clear of the border
     and is visible against both the card and the page behind it. */
  a.tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }

  /* Anyone who has asked for less movement gets the border and shadow only. */
  @media (prefers-reduced-motion: reduce) {
    .tile { transition: none; }
    a.tile:hover { transform: none; }
  }
  .tile .value { font-size: 1.9rem; font-weight: 600; line-height: 1.1; }
  .tile .label { font-size: .82rem; text-transform: uppercase; letter-spacing: .04em;
                 color: var(--muted); margin-top: .3rem; overflow-wrap: break-word; }
  .tile .unit { font-size: .78rem; color: var(--muted); margin-top: auto; padding-top: .3rem;
                overflow-wrap: break-word; }
  .tile.warn .value { color: var(--warn-fg); }
  .tile.bad .value { color: var(--bad-fg); }
  .tile.ok .value { color: var(--ok-fg); }

  h2 { font-size: 1rem; margin: 1.75rem 0 .6rem; }

  /* Filters. One GET form of plain dropdowns; /filters.js submits that form
     as soon as any control in it changes, so there is nothing to press. */
  .filters {
    display: flex; flex-wrap: wrap; gap: .7rem .9rem; align-items: flex-end;
    background: #fff; border: 1px solid var(--line); border-radius: 7px;
    padding: .8rem .9rem; margin: 0 0 1rem;
  }
  .filters .field { display: flex; flex-direction: column; gap: .28rem; min-width: 0; max-width: 100%; }
  .filters .caption { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .filters input[type="search"] {
    font: inherit; color: var(--ink); background: #fff; min-height: 36px; max-width: 100%;
    border: 1px solid var(--line); border-radius: 4px; padding: .3rem .5rem;
    min-width: 15rem;
  }
  .filters input[type="search"]:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }

  /* The dropdowns.

     A real <select>, styled only as far as its box: the browser draws the list,
     opens it from the keyboard and turns it into a native picker on a phone.
     The chevron is drawn in CSS rather than loaded, and appearance: none is
     what stops the platform drawing a second one next to it. */
  .filters select {
    font: inherit; color: var(--ink); cursor: pointer;
    min-height: 36px; min-width: 11rem; max-width: 100%;
    padding: .3rem 1.9rem .3rem .5rem;
    border: 1px solid var(--line); border-radius: 4px;
    appearance: none; -webkit-appearance: none;
    background-color: #fff;
    background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%),
                      linear-gradient(135deg, var(--muted) 50%, transparent 50%);
    background-position: right 1.05rem center, right .75rem center;
    background-size: .3rem .3rem, .3rem .3rem;
    background-repeat: no-repeat;
  }
  .filters select:hover { border-color: #b6bfca; }
  .filters select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button {
    font: inherit; min-height: 34px; padding: .3rem .9rem; cursor: pointer;
    background: var(--accent); color: #fff; border: 1px solid var(--accent); border-radius: 4px;
  }
  button:hover { background: #245a94; }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  a.reset { font-size: .85rem; color: var(--accent); align-self: center; }

  /* Tables. The container scrolls sideways so the page itself never has to. */
  .table-scroll {
    overflow-x: auto; max-width: 100%;
    overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch;
  }
  .scroll-hint { display: none; font-size: .78rem; color: var(--muted); margin: 0 0 .35rem; }
  table { width: 100%; border-collapse: collapse; background: #fff;
          border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
  th, td { padding: .6rem .8rem; text-align: left; vertical-align: top;
           border-bottom: 1px solid #eceff2; }
  th { background: #f0f2f5; font-size: .74rem; text-transform: uppercase;
       letter-spacing: .04em; color: #48525e; white-space: nowrap; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr.flagged { background: #fffaf3; }
  tbody tr.serious { background: #fdf4f4; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.sku { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: .88rem; white-space: nowrap; }
  td.name { min-width: 14rem; overflow-wrap: break-word; }
  td.reason { min-width: 16rem; overflow-wrap: break-word; }
  .muted { color: var(--muted); }
  .neg { color: var(--bad-fg); font-weight: 600; }
  .pos { color: var(--ok-fg); font-weight: 600; }

  /* Pills */
  .pill { display: inline-block; max-width: 100%; padding: .12rem .5rem; border-radius: 999px;
          font-size: .78rem; white-space: nowrap; }
  .pill.ok { background: var(--ok-bg); color: var(--ok-fg); }
  .pill.warn { background: var(--warn-bg); color: var(--warn-fg); }
  .pill.bad { background: var(--bad-bg); color: var(--bad-fg); }
  .pill.critical { background: var(--critical-bg); color: var(--critical-fg); }
  .pill.info { background: var(--info-bg); color: var(--info-fg); }
  .pill.neutral { background: var(--neutral-bg); color: var(--neutral-fg); }

  img.thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 5px;
              display: block; border: 1px solid var(--line); }
  td.thumb-cell { width: 56px; }

  .empty { padding: 1.75rem; text-align: center; color: var(--muted);
           background: #fff; border: 1px solid var(--line); border-radius: 7px; }
  .count { font-size: .85rem; color: var(--muted); margin: 0 0 .6rem; }
  .note { font-size: .84rem; color: var(--muted); background: #fff;
          border: 1px solid var(--line); border-left: 3px solid var(--accent);
          border-radius: 5px; padding: .6rem .8rem; margin: 0 0 1rem;
          overflow-wrap: break-word; }
  footer { margin-top: 1.75rem; color: #8a929c; font-size: .8rem; }

  /* --- Tablet: 768px to 1023px ------------------------------------------ */
  @media (max-width: 1023px) {
    :root { --gutter: 1.15rem; }
    .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; }
    /* Filter groups share the row and wrap onto the next one rather than being
       pushed off the edge. */
    .filters .field { flex: 1 1 13rem; }
    .filters input[type="search"] { width: 100%; min-width: 0; }
    .filters select { min-width: 0; }
    td.name { min-width: 11rem; }
    td.reason { min-width: 13rem; }
  }

  /* --- Mobile: below 768px ---------------------------------------------- */
  @media (max-width: 767px) {
    :root { --gutter: 1rem; }
    /* Every link is kept: they wrap onto as many rows as they need, squared
       off so a wrapped row does not read as a broken tab strip. */
    nav { gap: .3rem; margin-top: .65rem; padding-bottom: .5rem; }
    nav a { flex: 1 1 auto; text-align: center; border-radius: 5px; padding: .5rem .6rem; font-size: .82rem; }
    main { padding: 1.1rem var(--gutter) 2rem; }
    h1 { font-size: 1.15rem; }
    h2 { margin: 1.4rem 0 .5rem; }
    .tiles { grid-template-columns: minmax(0, 1fr); gap: .7rem; margin-bottom: 1.4rem; }
    .tile { padding: .8rem .9rem; }
    .tile .value { font-size: 1.65rem; }
    .filters { padding: .75rem; gap: .6rem; }
    .filters .field { flex: 1 1 100%; }
    /* Full width, a comfortable tap target, and 16px so mobile browsers do not
       zoom the page when a control takes focus. */
    .filters input[type="search"] {
      width: 100%; min-width: 0; font-size: 16px; min-height: 44px;
    }
    .filters select { width: 100%; min-width: 0; font-size: 16px; min-height: 44px; }
    a.reset { align-self: flex-start; padding: .25rem 0; }
    .scroll-hint { display: block; }
    table { font-size: .92rem; }
    th, td { padding: .5rem .6rem; }
    td.name { min-width: 9rem; }
    td.reason { min-width: 11rem; }
    .empty { padding: 1.25rem 1rem; }
    .note { font-size: .82rem; }
    footer { margin-top: 1.4rem; }
  }

  /* --- Small phones ------------------------------------------------------ */
  @media (max-width: 400px) {
    :root { --gutter: .85rem; }
    nav a { font-size: .8rem; padding: .5rem .45rem; }
    .tile .value { font-size: 1.5rem; }
  }

  /* ======================================================================== */
  /* Records: the add, view, edit and delete screens                          */
  /* ======================================================================== */

  /* One button style, used for links and submits alike so an Add link and a
     Save button are the same object on screen. */
  .btn {
    display: inline-block; font: inherit; font-size: .88rem; line-height: 1.4;
    text-decoration: none; text-align: center; cursor: pointer;
    min-height: 36px; padding: .4rem .9rem; border-radius: 4px;
    background: var(--accent); color: #fff; border: 1px solid var(--accent);
  }
  .btn:hover { background: #245a94; border-color: #245a94; color: #fff; }
  .btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .btn.secondary { background: #fff; color: var(--accent); }
  .btn.secondary:hover { background: #eef4fb; color: var(--accent); border-color: var(--accent); }
  .btn.danger { background: var(--bad-fg); border-color: var(--bad-fg); }
  .btn.danger:hover { background: #8c1c1c; border-color: #8c1c1c; }

  .page-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin: 0 0 1rem; }

  /* The two dashboard summaries.

     Every row is a single line - a badge, a count and a link - so they are
     centred against each other rather than top-aligned. The list screens keep
     the top alignment they need, because their cells wrap onto several lines
     and a reason has to start level with the SKU beside it. */
  /* The two dashboard summaries share one column layout.

     table-layout: fixed is what makes the <col> widths binding rather than a
     hint, so Count and Action sit at the same horizontal position on both
     tables no matter how long the longest issue type happens to be. The first
     column takes whatever is left, so the pair still fills the content width.

     min-width keeps the two narrow columns legible on a phone: below it the
     table scrolls inside .table-scroll, which is what stops the page itself
     ever scrolling sideways. */
  table.summary { table-layout: fixed; min-width: 22rem; }
  table.summary col.c-count { width: 7rem; }
  table.summary col.c-action { width: 8rem; }
  table.summary td { vertical-align: middle; }
  table.summary th, table.summary td { overflow-wrap: break-word; }

  /* Per-row actions. One icon link per row, centred under the column heading. */
  th.row-actions, td.row-actions { white-space: nowrap; text-align: center; }
  td.row-actions a.icon { color: var(--accent); display: inline-flex; align-items: center;
                          justify-content: center; width: 2rem; height: 2rem;
                          border-radius: 5px; border: 1px solid transparent; }
  td.row-actions a.icon:hover { background: var(--tile-hover, #eef2f7); border-color: #d5dbe3; }
  td.row-actions a.icon:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  td.row-actions a.icon svg { display: block; }

  /* Previous / Next across a filtered set. Same control above and below the
     table, so it is where you are whichever end you reach. */
  .pager { display: flex; align-items: center; gap: .5rem; margin: 0 0 .8rem; flex-wrap: wrap; }
  .pager a, .pager .disabled {
    font-size: .85rem; padding: .35rem .7rem; border-radius: 4px;
    border: 1px solid #d5dbe3; text-decoration: none;
  }
  .pager a { color: var(--accent); background: #fff; }
  .pager a:hover { background: #eef2f7; border-color: #b6bfca; }
  .pager a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .pager .disabled { color: var(--muted); background: #f5f7fa; border-color: #e5e9ee; }
  .pager .position { font-size: .85rem; color: var(--muted); }

  /* A line of explanation for something the source database cannot answer. */
  .source-note { font-size: .85rem; color: var(--muted); margin: 0 0 .8rem;
                 padding: .55rem .7rem; border-left: 3px solid #c8cdd4;
                 background: #f5f7fa; border-radius: 0 4px 4px 0; }

  .flash { border: 1px solid; border-radius: 5px; padding: .6rem .8rem; margin: 0 0 1rem;
           font-size: .88rem; overflow-wrap: break-word; }
  .flash.ok { background: var(--ok-bg); color: var(--ok-fg); border-color: #bfe0c9; }
  .flash.warn { background: var(--warn-bg); color: var(--warn-fg); border-color: #ecd9a8; }
  .flash.bad { background: var(--bad-bg); color: var(--bad-fg); border-color: #eec4c4; }

  /* View screens */
  .detail { background: #fff; border: 1px solid var(--line); border-radius: 7px;
            padding: 0 1rem; margin: 0 0 1.25rem; }
  .detail dl { display: grid; grid-template-columns: 13rem minmax(0, 1fr); margin: 0; }
  .detail dt { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em;
               color: var(--muted); padding: .7rem .8rem .7rem 0; border-bottom: 1px solid #eceff2; }
  .detail dd { margin: 0; padding: .7rem 0; border-bottom: 1px solid #eceff2;
               overflow-wrap: break-word; min-width: 0; }
  .detail dt.last, .detail dd.last { border-bottom: 0; }
  .detail dd img.thumb { width: 56px; height: 56px; }
  .detail dd .derived { font-size: .78rem; color: var(--muted); display: block; margin-top: .15rem; }

  /* Add and edit forms */
  form.record { background: #fff; border: 1px solid var(--line); border-radius: 7px;
                padding: 1rem; margin: 0 0 1.25rem; }
  form.record .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .9rem; }
  form.record .field { display: flex; flex-direction: column; gap: .3rem; min-width: 0; }
  form.record .field.wide { grid-column: 1 / -1; }
  form.record label.caption { font-size: .75rem; text-transform: uppercase;
                              letter-spacing: .04em; color: var(--muted); }
  form.record input, form.record select, form.record textarea {
    font: inherit; color: var(--ink); background: #fff; width: 100%; max-width: 100%;
    min-height: 38px; border: 1px solid var(--line); border-radius: 4px; padding: .35rem .5rem;
  }
  form.record textarea { min-height: 5.5rem; resize: vertical; line-height: 1.5; }
  form.record input[readonly] { background: #f1f3f5; color: var(--muted); }
  form.record input:focus-visible, form.record select:focus-visible, form.record textarea:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  form.record .hint { font-size: .78rem; color: var(--muted); overflow-wrap: break-word; }
  form.record .field.bad input, form.record .field.bad select, form.record .field.bad textarea {
    border-color: var(--bad-fg);
  }
  form.record .field-error { font-size: .78rem; color: var(--bad-fg); overflow-wrap: break-word; }
  form.record .options { display: flex; flex-wrap: wrap; gap: .45rem .9rem; padding-top: .15rem; }
  form.record .options label { display: flex; align-items: center; gap: .4rem;
                               font-size: .88rem; color: var(--ink); }
  form.record .options input { width: auto; min-height: 0; }
  form.record .buttons { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center;
                         margin-top: 1.1rem; }
  .errors { background: var(--bad-bg); border: 1px solid #eec4c4; border-left: 3px solid var(--bad-fg);
            border-radius: 5px; padding: .7rem .9rem; margin: 0 0 1rem; color: var(--bad-fg); font-size: .86rem; }
  .errors ul { margin: .35rem 0 0; padding-left: 1.1rem; }
  .errors li { margin-top: .15rem; overflow-wrap: break-word; }

  @media (max-width: 767px) {
    /* Buttons share the row and stay a comfortable size for a thumb. */
    .page-actions .btn, form.record .buttons .btn, form.record .buttons button {
      flex: 1 1 auto; min-height: 44px;
    }
    form.record { padding: .85rem; }
    form.record .grid { grid-template-columns: 1fr; gap: .8rem; }
    form.record input, form.record select, form.record textarea { font-size: 16px; min-height: 42px; }
    /* Label above value rather than beside it: 13rem of label leaves nothing
       for the value on a phone. */
    .detail { padding: 0 .85rem; }
    .detail dl { grid-template-columns: 1fr; }
    .detail dt { padding: .7rem 0 .1rem; border-bottom: 0; }
    .detail dd { padding: 0 0 .7rem; }
    td.row-actions a { padding: .35rem .3rem; }
  }
`;

/**
 * Wrap page content in the shared shell: masthead, navigation, footer.
 *
 * @param {object} options
 * @param {string} options.title      Page heading and document title.
 * @param {string} options.activePath Nav item to mark as current.
 * @param {string} options.lede       One line under the heading.
 * @param {string} options.body       Page markup.
 * @returns {string} A complete HTML document.
 */
export function layout({ title, activePath, lede = '', body, flash = null }) {
  const nav = NAV_ITEMS.map((item) => {
    const current = item.path === activePath ? ' aria-current="page"' : '';
    return `<a href="${escapeHtml(item.path)}"${current}>${escapeHtml(item.label)}</a>`;
  }).join('');

  const banner = flash
    ? `    <p class="flash ${escapeHtml(flash.tone ?? 'ok')}">${escapeHtml(flash.message)}</p>\n`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Smart Inventory Control</title>
<style>${STYLES}</style>
<script src="/filters.js" defer></script>
</head>
<body>
  <header class="masthead">
    <div class="title">Smart Inventory Control</div>
    <nav>${nav}</nav>
  </header>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ''}
${banner}${body}
    <footer>Smart Inventory Control</footer>
  </main>
</body>
</html>
`;
}

/**
 * Build the filter bar from a list of controls.
 *
 * The bar is one ordinary GET form. There is no Apply button: /filters.js
 * submits the form the moment anything in it changes, so choosing a value
 * applies it immediately.
 *
 * Each group is a plain <select>. Not a custom widget, not a panel of
 * checkboxes - the control the browser already knows how to draw, open with a
 * keyboard and turn into a native picker on a phone. One choice per group, so
 * what is on screen can always be read off the dropdowns without opening
 * anything.
 *
 * "All" is the first option of every group and its value is the empty string.
 * Choosing it is how a filter is removed, and because /filters.js drops empty
 * fields before submitting, the URL - ?category=Bulbs&supplier=Halden... -
 * stays a readable, shareable description of exactly what is on screen. The
 * groups sit in the SAME form, so keeping the others is not something this
 * code has to arrange: submitting the form sends all of them.
 *
 * Separate groups are separate conditions on the same row and AND together, so
 * a category and a supplier narrow.
 *
 * @param {object} options
 * @param {string} options.action        Path the filters submit to.
 * @param {object[]} options.controls    Control definitions.
 * @param {boolean} options.showReset    Whether anything is filtered.
 * @returns {string}
 */
function renderFilters({ action, controls, showReset }) {
  const fields = controls
    .map((control) => {
      const id = `f-${control.name}`;

      if (control.kind === 'search') {
        return `<div class="field">
        <label class="caption" for="${escapeHtml(id)}">${escapeHtml(control.label)}</label>
        <input type="search" id="${escapeHtml(id)}" name="${escapeHtml(control.name)}" value="${escapeHtml(control.value ?? '')}" placeholder="${escapeHtml(control.placeholder ?? '')}">
      </div>`;
      }

      // The chosen value, narrowed to one the control actually offers. A value
      // the route did not recognise leaves the dropdown on All rather than
      // adding an option for it, so the bar never claims to be filtered by
      // something the list is not filtered by.
      const chosen = String(control.value ?? '');

      const options = [{ value: '', label: control.allLabel }, ...control.options]
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}"${option.value === chosen ? ' selected' : ''}>${escapeHtml(option.label)}</option>`,
        )
        .join('');

      return `<div class="field">
        <label class="caption" for="${escapeHtml(id)}">${escapeHtml(control.label)}</label>
        <select id="${escapeHtml(id)}" name="${escapeHtml(control.name)}">${options}</select>
      </div>`;
    })
    .join('\n      ');

  const reset = showReset ? `<a class="reset" href="${escapeHtml(action)}">Clear filters</a>` : '';

  return `    <form class="filters" method="get" action="${escapeHtml(action)}">
      ${fields}
      ${reset}
    </form>`;
}

/**
 * Wrap table markup, or show an empty-state message when there is nothing to
 * show.
 *
 * @param {string} rows
 * @param {string} head
 * @param {string} emptyMessage
 * @returns {string}
 */
/**
 * What an empty table says.
 *
 * When a search is running, the term is quoted back. "No issues match these
 * filters" leaves a member of staff wondering whether the search worked at all;
 * "No issues match “ktetle”." shows the typo straight away.
 *
 * @param {string} noun    Plural, as it appears in the count line.
 * @param {string} search  The active search term, or ''.
 * @returns {string}
 */
function noMatches(noun, search) {
  return search
    ? `No ${noun} match “${search}”. Try a shorter term, or clear the filters.`
    : `No ${noun} match these filters.`;
}

function tableOrEmpty(rows, head, emptyMessage) {
  if (!rows) {
    return `    <p class="empty">${escapeHtml(emptyMessage)}</p>`;
  }

  return `    <p class="scroll-hint">Scroll the table sideways to see every column.</p>
    <div class="table-scroll">
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`;
}

/**
 * A whole number, grouped for reading.
 *
 * The figures are real now - sixty-eight thousand stock lines, not fourteen -
 * and an ungrouped 68237 is read wrong at a glance.
 *
 * @param {number} value
 * @returns {string}
 */
export function number(value) {
  return Number(value).toLocaleString('en-GB');
}

/**
 * Row count line above a table.
 *
 * Three figures, because there are three: how many rows this page is showing,
 * how many matched the filters, and how many exist. A screen capped at its
 * display limit says so here rather than quietly showing the first page as if
 * it were everything.
 *
 * @param {number} shown    Rows rendered in the table.
 * @param {number} matched  Rows the filters selected.
 * @param {number} total    Rows in the source.
 * @param {string} noun
 * @returns {string}
 */
function countLine(view, matched, total, noun) {
  const plural = (n) => `${number(n)} ${noun}${n === 1 ? '' : 's'}`;

  const head =
    view.pageCount <= 1
      ? plural(matched)
      : `showing ${number(view.from)}–${number(view.to)} of ${plural(matched)}`;
  const tail = matched === total ? '' : ` matching, out of ${number(total)}`;

  return `    <p class="count">${escapeHtml(head + tail)}</p>`;
}

/**
 * Previous / Next across a filtered set.
 *
 * Plain links carrying the current filters plus a page number, so a page is an
 * ordinary URL that can be bookmarked, linked and opened in a new tab, and the
 * screens still need no client-side JavaScript.
 *
 * Rendered above and below the table: on a 200-row page the bottom is where you
 * are when you want the next one, and the top is where you are when you come
 * back.
 *
 * @param {string} path
 * @param {object} params     The filters currently applied.
 * @param {{pageNumber: number, pageCount: number}} view
 * @returns {string}
 */
function pager(path, params, view) {
  if (view.pageCount <= 1) return '';

  const at = (n) => href(path, { ...params, page: n });
  const link = (n, label, rel) =>
    `<a rel="${rel}" href="${at(n)}">${escapeHtml(label)}</a>`;
  const disabled = (label) => `<span class="disabled">${escapeHtml(label)}</span>`;

  const previous =
    view.pageNumber > 1 ? link(view.pageNumber - 1, '← Previous', 'prev') : disabled('← Previous');
  const next =
    view.pageNumber < view.pageCount ? link(view.pageNumber + 1, 'Next →', 'next') : disabled('Next →');

  const position = `<span class="position">Page ${number(view.pageNumber)} of ${number(view.pageCount)}</span>`;

  return `    <nav class="pager" aria-label="Pagination">${previous}${position}${next}</nav>`;
}

/**
 * A line of explanation above a table, for something the source cannot answer.
 *
 * @param {string} text
 * @returns {string}
 */
function sourceNote(text) {
  return text ? `    <p class="source-note">${escapeHtml(text)}</p>` : '';
}

/* ========================================================================== */
/* Record screens: the shared pieces                                          */
/* ========================================================================== */

/*
 * Add, view, edit and delete look the same on all five screens, so they are
 * built once here rather than five times below. A screen supplies the rows or
 * the fields; everything about how they are laid out, escaped and made to work
 * on a phone lives in these four functions.
 *
 * There is still no client-side JavaScript. A delete is a GET to a confirmation
 * page followed by a POST from a form on it, so nothing destructive can happen
 * by following a link, and nothing depends on a confirm() dialog.
 */

/**
 * Build a URL with a query string.
 *
 * The result is already safe to drop straight into an href: every value goes
 * through encodeURIComponent, which cannot emit a quote or an angle bracket,
 * and the separator is written as an entity. It must NOT be passed through
 * escapeHtml as well, or the separator would be double-encoded.
 *
 * @param {string} path
 * @param {object} params
 * @returns {string}
 */
export function href(path, params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&amp;');

  return query ? `${path}?${query}` : path;
}

/**
 * The Action cell for one table row.
 *
 * Icon links, not words. Every list screen has exactly one action per row now -
 * the source is read-only, so there is nothing to edit or delete - and a column
 * of identical "View" words is noise next to the figures that matter. The
 * accessible name is still the word, on the link itself.
 *
 * @param {{label: string, href: string}[]} links
 * @returns {string}
 */
function rowActions(links) {
  const rendered = links
    .map(
      (link) =>
        `<a class="icon" title="${escapeHtml(link.label)}" aria-label="${escapeHtml(link.label)}" href="${link.href}">${ICON_VIEW}</a>`,
    )
    .join('');

  return `<td class="row-actions">${rendered}</td>`;
}

/**
 * One field on a view screen.
 *
 * A row is given either text, which is escaped, or html, which is not and is
 * only ever markup this module built itself - a pill, a thumbnail, a signed
 * difference. Nothing from a form ever arrives as html.
 *
 * @typedef {{label: string, text?: unknown, html?: string, derived?: string}} DetailRow
 */

/**
 * The button bar above a record.
 *
 * Only ever navigation now - "Back to products", "View the stock line". There
 * is nothing to add, edit or delete, so nothing here submits anything.
 *
 * @param {{label: string, href: string, tone?: string}[]} buttons
 * @returns {string}
 */
function pageActions(buttons) {
  if (buttons.length === 0) return '';

  const rendered = buttons
    .map(
      (button) =>
        `      <a class="btn ${button.tone ?? ''}" href="${button.href}">${escapeHtml(button.label)}</a>`,
    )
    .join('\n');

  return `    <div class="page-actions">\n${rendered}\n    </div>`;
}

/**
 * A read-only view of one record.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.activePath
 * @param {string} [options.lede]
 * @param {DetailRow[]} options.rows
 * @param {{label: string, href: string, tone?: string}[]} [options.actions]
 * @param {string} [options.note]
 * @param {string} [options.extra] Extra markup below the record, already built.
 * @param {object} [options.flash]
 * @returns {string}
 */
export function renderRecordPage({
  title,
  activePath,
  lede = '',
  rows,
  actions = [],
  note = '',
  extra = '',
  flash = null,
}) {
  const items = rows
    .map((row, index) => {
      const last = index === rows.length - 1 ? ' last' : '';
      const value = row.html ?? escapeHtml(row.text);
      const derived = row.derived ? `<span class="derived">${escapeHtml(row.derived)}</span>` : '';
      return `        <dt class="${last.trim()}">${escapeHtml(row.label)}</dt>
        <dd class="${last.trim()}">${value}${derived}</dd>`;
    })
    .join('\n');

  const body = `${pageActions(actions)}
${note ? `    <p class="note">${escapeHtml(note)}</p>` : ''}
    <div class="detail">
      <dl>
${items}
      </dl>
    </div>
${extra}`;

  return layout({ title, activePath, lede, body, flash });
}

/**
 * One control on an add or edit form.
 *
 * @typedef {object} FormField
 * @property {string} kind    text | number | date | select | textarea | checkboxes | readonly
 * @property {string} name
 * @property {string} label
 * @property {string} [hint]
 * @property {boolean} [wide] Span both columns.
 * @property {{value: string, label: string}[]} [options] For select and checkboxes.
 */

/* ========================================================================== */
/* 1. DASHBOARD                                                               */
/* ========================================================================== */

/**
 * The dashboard: six figures, then two summaries.
 *
 * Each card is a shortcut. The whole card is one <a>, so the number, its name
 * and its description are all the same click, and it lands on the screen that
 * shows the rows behind the figure already filtered to them.
 *
 * Under them, what was detected and what is in flight, as counts with a link
 * through to the rows. Both tables are read-only: nothing is raised, actioned
 * or edited here. The counts are handed in - this file evaluates no rule and
 * reads no data.
 *
 * @param {object} options
 * @param {object} options.metrics          From dashboardMetrics().
 * @param {object[]} options.issueCounts    From issueCounts().
 * @param {object[]} options.transferCounts From transferCounts().
 */
export function renderDashboardPage({ metrics, issueCounts, transferCounts }) {
  const tile = (href, value, label, unit, tone) =>
    `      <a class="${escapeHtml(tone ? `tile ${tone}` : 'tile')}" href="${escapeHtml(href)}">
        <div class="value">${escapeHtml(number(value))}</div>
        <div class="label">${escapeHtml(label)}</div>
        <div class="unit">${escapeHtml(unit)}</div>
      </a>`;

  /*
   * All six cards count catalogue SKUs, and each one drills through to the
   * screen that lists exactly the SKUs it counted - so the figure on the card
   * and the figure on the screen it opens are the same number. A card linking
   * to a screen that counts something else is worse than no link at all.
   */
  const tiles = [
    tile('/products', metrics.totalSkus, 'Total SKUs', 'in the catalogue', ''),
    tile('/products?stock=Healthy', metrics.healthyStock, 'Healthy Stock', 'SKUs', 'ok'),
    tile('/products?stock=Low+Stock', metrics.lowStock, 'Low Stock', 'SKUs', 'warn'),
    tile('/products?stock=Out+of+Stock', metrics.outOfStock, 'Out-of-Stock Items', 'SKUs', 'bad'),
    // ?show=discrepancy is what the audit screen's Show filter reads, so the
    // card lands with that dropdown already set to Discrepancies only.
    tile('/audit?show=discrepancy', metrics.discrepancies, 'Discrepancies', 'audit lines that disagree', 'bad'),
    tile('/transfers?status=Pending', metrics.pendingTransfers, 'Pending Transfers', 'awaiting despatch', 'warn'),
  ].join('\n');

  /*
   * The two summaries under the cards.
   *
   * Both are counts only, with a link through to the screen that holds the
   * rows. Nothing is raised, actioned or edited here - that stays on the
   * Alerts and Transfers screens, which these link to.
   *
   * The counts come from issueCounts() and transferCounts() in reports.js, so
   * the six rules are evaluated in exactly one place and this file only prints
   * what it is handed.
   */
  const summaryRows = (rows, cell, href) =>
    rows
      .map(
        (row) => `          <tr>
            <td>${cell(row)}</td>
            <td class="num">${escapeHtml(number(row.count))}</td>
            <td class="row-actions"><a class="icon" title="View" aria-label="View" href="${escapeHtml(href(row))}">${ICON_VIEW}</a></td>
          </tr>`,
      )
      .join('\n');

  /*
   * One <colgroup> for both tables, so Count and Action start at the same
   * horizontal position on each. Left to size themselves, the two tables would
   * measure their own first column - "Warehouse/SKU Mismatch" against
   * "In Transit" - and put the other two columns in different places, which
   * reads as two unrelated tables rather than two views of the same shape.
   *
   * The widths are enforced by table-layout: fixed in the stylesheet; without
   * it a <col> width is only a suggestion the browser may overrule.
   */
  const summaryTable = (heading, firstColumn, rows) => `    <h2>${escapeHtml(heading)}</h2>
    <div class="table-scroll">
      <table class="summary">
        <colgroup><col class="c-name"><col class="c-count"><col class="c-action"></colgroup>
        <thead><tr><th>${escapeHtml(firstColumn)}</th><th class="num">Count</th><th class="row-actions">Action</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`;

  const issueRows = summaryRows(
    issueCounts,
    (row) => `<span class="pill ${escapeHtml(issueClass(row.type))}">${escapeHtml(row.type)}</span>`,
    (row) => href('/alerts', { type: row.type }),
  );

  const transferRows = summaryRows(
    transferCounts,
    (row) =>
      `<span class="pill ${escapeHtml(transferStatusClass(row.status))}">${escapeHtml(row.status)}</span>`,
    (row) => href('/transfers', { status: row.status }),
  );

  const body = `    <div class="tiles">
${tiles}
    </div>

${summaryTable('Issues detected', 'Issue type', issueRows)}

${summaryTable('Transfers by status', 'Status', transferRows)}`;

  return layout({
    title: 'Dashboard',
    activePath: '/',
    lede: 'The current inventory position across every warehouse.',
    body,
  });
}

/* ========================================================================== */
/* 2. PRODUCTS                                                                */
/* ========================================================================== */

export function renderProductsPage({
  products,
  view,
  params = {},
  total,
  matched,
  categories,
  suppliers,
  statuses = [],
  search = '',
  category = '',
  supplier = '',
  stock = '',
  flash = null,
}) {
  const rows = products
    .map((product) => {
      const status = product.active
        ? '<span class="pill ok">Active</span>'
        : '<span class="pill neutral">Inactive</span>';

      return `          <tr${product.active ? '' : ' class="flagged"'}>
            <td class="thumb-cell"><img class="thumb" src="${escapeHtml(product.image)}" alt="" width="40" height="40"></td>
            <td class="sku">${escapeHtml(product.sku)}</td>
            <td class="name">${escapeHtml(product.name)}</td>
            <td>${escapeHtml(product.category ?? NOT_IN_SOURCE)}</td>
            <td>${escapeHtml(product.supplier ?? NOT_IN_SOURCE)}</td>
            <td>${status}</td>
            <td class="num">${escapeHtml(number(product.unitsHeld))}</td>
            <td><span class="pill ${escapeHtml(statusClass(product.stockStatus))}">${escapeHtml(product.stockStatus)}</span></td>
            ${rowActions([{ label: 'View', href: href('/products/view', { sku: product.sku }) }])}
          </tr>`;
    })
    .join('\n');

  // Stock is the band for the SKU across every warehouse, which is what the
  // dashboard cards count - so a card and this column always say the same
  // thing about the same product.
  const head =
    '<th>Image</th><th>SKU</th><th>Product Name</th><th>Category</th><th>Supplier</th><th>Listing</th><th class="num">Units held</th><th>Stock</th><th class="row-actions">Action</th>';

  const filters = renderFilters({
    action: '/products',
    showReset: Boolean(search || category || supplier || stock),
    controls: [
      { kind: 'search', name: 'q', label: 'Search', value: search, placeholder: 'SKU, name, category or supplier' },
      {
        name: 'category',
        label: 'Category',
        allLabel: 'All categories',
        value: category,
        options: categories.map((c) => ({ value: c, label: c })),
      },
      {
        name: 'supplier',
        label: 'Supplier',
        allLabel: 'All suppliers',
        value: supplier,
        options: suppliers.map((sup) => ({ value: sup, label: sup })),
      },
      {
        // What the dashboard cards drill through to.
        name: 'stock',
        label: 'Stock',
        allLabel: 'All stock positions',
        value: stock,
        options: statuses.map((st) => ({ value: st, label: st })),
      },
    ],
  });

  const body = `${filters}
${countLine(view, matched, total, 'product')}
${pager('/products', params, view)}
${tableOrEmpty(rows, head, noMatches('products', search))}
${pager('/products', params, view)}`;

  return layout({
    title: 'Products',
    activePath: '/products',
    lede: 'The product catalogue the stock figures are measured against.',
    body,
    flash,
  });
}

/* ========================================================================== */
/* 3. WAREHOUSE STOCK                                                         */
/* ========================================================================== */

export function renderStockPage({
  lines,
  view,
  params = {},
  total,
  matched,
  warehouses,
  statuses,
  warehouseId = '',
  status = '',
  search = '',
  threshold = 0,
  note = '',
  flash = null,
}) {
  const rows = lines
    .map((line) => {
      const rowClass =
        line.status === 'Negative Inventory' || line.status === 'Out of Stock'
          ? ' class="serious"'
          : line.status === 'Low Stock'
            ? ' class="flagged"'
            : '';

      const onHand =
        line.onHand < 0
          ? `<span class="neg">${escapeHtml(number(line.onHand))}</span>`
          : escapeHtml(number(line.onHand));

      const available =
        line.available <= 0
          ? `<span class="neg">${escapeHtml(number(line.available))}</span>`
          : escapeHtml(number(line.available));

      return `          <tr${rowClass}>
            <td class="sku">${escapeHtml(line.sku)}</td>
            <td class="name">${escapeHtml(line.productName)}</td>
            <td>${escapeHtml(line.warehouseName)}</td>
            <td class="num">${onHand}</td>
            <td class="num">${escapeHtml(number(line.reserved))}</td>
            <td class="num">${available}</td>
            <td><span class="pill ${escapeHtml(statusClass(line.status))}">${escapeHtml(line.status)}</span></td>
            ${rowActions([
              {
                label: 'View',
                href: href('/stock/view', { sku: line.sku, warehouse: line.warehouseId }),
              },
            ])}
          </tr>`;
    })
    .join('\n');

  // No Minimum column. There is no minimum in the source database, so the only
  // thing this column could hold is the application threshold repeated on every
  // one of sixty-eight thousand rows. It is stated once, above the table.
  const head =
    '<th>SKU</th><th>Product</th><th>Warehouse</th><th class="num">Current</th><th class="num">Reserved</th><th class="num">Available</th><th>Status</th><th class="row-actions">Action</th>';

  const filters = renderFilters({
    action: '/stock',
    showReset: Boolean(warehouseId || status || search),
    controls: [
      { kind: 'search', name: 'q', label: 'Search', value: search, placeholder: 'SKU, product, warehouse or shelf' },
      {
        name: 'warehouse',
        label: 'Warehouse',
        allLabel: 'All warehouses',
        value: warehouseId,
        options: warehouses.map((w) => ({ value: w.id, label: w.name })),
      },
      {
        name: 'status',
        label: 'Status',
        allLabel: 'All statuses',
        value: status,
        options: statuses.map((st) => ({ value: st, label: st })),
      },
    ],
  });

  const body = `${filters}
${countLine(view, matched, total, 'stock line')}
${pager('/stock', params, view)}
${sourceNote(note ? `Low Stock is flagged below ${number(threshold)} available. ${note}` : '')}
${tableOrEmpty(rows, head, noMatches('stock lines', search))}
${pager('/stock', params, view)}`;

  return layout({
    title: 'Warehouse Stock',
    activePath: '/stock',
    lede: 'Stock held by SKU and warehouse. Available is Current minus Reserved.',
    body,
    flash,
  });
}

/* ========================================================================== */
/* 4. ALERTS / ISSUES                                                         */
/* ========================================================================== */

export function renderIssuesPage({
  issues,
  view,
  params = {},
  total,
  matched,
  issueTypes,
  warehouses,
  search = '',
  type = '',
  warehouseId = '',
  flash = null,
}) {
  const rows = issues
    .map((issue) => {
      const serious =
        issue.type === 'Negative Inventory' ||
        issue.type === 'Out of Stock' ||
        issue.type === 'Warehouse/SKU Mismatch';

      const key = { type: issue.type, sku: issue.sku, warehouse: issue.warehouseId };

      return `          <tr${serious ? ' class="serious"' : ' class="flagged"'}>
            <td><span class="pill ${escapeHtml(issueClass(issue.type))}">${escapeHtml(issue.type)}</span></td>
            <td class="sku">${escapeHtml(issue.sku)}</td>
            <td class="name">${escapeHtml(issue.productName)}</td>
            <td>${escapeHtml(issue.warehouseName)}</td>
            <td class="num">${escapeHtml(number(issue.available))}</td>
            <td class="reason">${escapeHtml(issue.detail)}</td>
            ${rowActions([{ label: 'View', href: href('/alerts/view', key) }])}
          </tr>`;
    })
    .join('\n');

  const head =
    '<th>Issue</th><th>SKU</th><th>Product</th><th>Warehouse</th><th class="num">Available</th><th>Why it was raised</th><th class="row-actions">Action</th>';

  const filters = renderFilters({
    action: '/alerts',
    showReset: Boolean(search || type || warehouseId),
    controls: [
      {
        kind: 'search',
        name: 'q',
        label: 'Search',
        value: search,
        placeholder: 'SKU, product, warehouse, issue or reason',
      },
      {
        name: 'type',
        label: 'Issue type',
        allLabel: 'All issue types',
        value: type,
        options: issueTypes.map((t) => ({ value: t, label: t })),
      },
      {
        name: 'warehouse',
        label: 'Warehouse',
        allLabel: 'All warehouses',
        value: warehouseId,
        options: warehouses.map((w) => ({ value: w.id, label: w.name })),
      },
    ],
  });

  const body = `${filters}
${countLine(view, matched, total, 'issue')}
${pager('/alerts', params, view)}
${tableOrEmpty(rows, head, noMatches('issues', search))}
${pager('/alerts', params, view)}`;

  return layout({
    title: 'Alerts / Issues',
    activePath: '/alerts',
    lede: 'Problems detected in the current stock position. Recalculated on every page load; nothing is stored.',
    body,
    flash,
  });
}

/* ========================================================================== */
/* 5. TRANSFERS                                                               */
/* ========================================================================== */

export function renderTransfersPage({
  transfers,
  view,
  params = {},
  total,
  matched,
  statuses,
  warehouses,
  status = '',
  fromWarehouseId = '',
  toWarehouseId = '',
  note = '',
  flash = null,
}) {
  const rows = transfers
    .map(
      (transfer) => `          <tr>
            <td class="sku">${escapeHtml(transfer.id)}</td>
            <td class="sku">${escapeHtml(transfer.sku)}</td>
            <td class="name">${escapeHtml(transfer.productName)}</td>
            <td>${escapeHtml(transfer.fromWarehouseName)}</td>
            <td>${escapeHtml(transfer.toWarehouseName)}</td>
            <td class="num">${escapeHtml(number(transfer.quantity))}</td>
            <td><span class="pill ${escapeHtml(transferStatusClass(transfer.status))}">${escapeHtml(transfer.status)}</span></td>
            <td class="muted">${escapeHtml(transfer.raisedOn)}</td>
            ${rowActions([{ label: 'View', href: href('/transfers/view', { id: transfer.id }) }])}
          </tr>`,
    )
    .join('\n');

  const head =
    '<th>Transfer ID</th><th>SKU</th><th>Product</th><th>From</th><th>To</th><th class="num">Qty</th><th>Status</th><th>Raised</th><th class="row-actions">Action</th>';

  const filters = renderFilters({
    action: '/transfers',
    showReset: Boolean(status || fromWarehouseId || toWarehouseId),
    controls: [
      {
        name: 'status',
        label: 'Status',
        allLabel: 'All statuses',
        value: status,
        options: statuses.map((st) => ({ value: st, label: st })),
      },
      {
        name: 'from',
        label: 'Warehouse from',
        allLabel: 'All warehouses',
        value: fromWarehouseId,
        options: warehouses.map((w) => ({ value: w.id, label: w.name })),
      },
      {
        name: 'to',
        label: 'Warehouse to',
        allLabel: 'All warehouses',
        value: toWarehouseId,
        options: warehouses.map((w) => ({ value: w.id, label: w.name })),
      },
    ],
  });

  const body = `${filters}
${countLine(view, matched, total, 'transfer')}
${pager('/transfers', params, view)}
${sourceNote(note)}
${tableOrEmpty(rows, head, 'No transfers match these filters.')}
${pager('/transfers', params, view)}`;

  return layout({
    title: 'Transfers',
    activePath: '/transfers',
    lede: 'Stock moving between warehouses.',
    body,
    flash,
  });
}

/* ========================================================================== */
/* 6. INVENTORY AUDIT                                                         */
/* ========================================================================== */

export function renderAuditPage({
  rows: auditRows,
  view,
  params = {},
  total,
  matched,
  warehouses,
  warehouseId = '',
  differencesOnly = false,
  note = '',
  flash = null,
}) {
  const rows = auditRows
    .map((row) => {
      const differenceCell = row.matches
        ? '<span class="muted">0</span>'
        : `<span class="${row.difference > 0 ? 'pos' : 'neg'}">${escapeHtml(formatDifference(row.difference))}</span>`;

      return `          <tr${row.matches ? '' : ' class="serious"'}>
            <td class="sku">${escapeHtml(row.sku)}</td>
            <td class="name">${escapeHtml(row.productName)}</td>
            <td>${escapeHtml(row.warehouseName)}</td>
            <td class="num">${escapeHtml(number(row.systemQuantity))}</td>
            <td class="num">${escapeHtml(number(row.countedQuantity))}</td>
            <td class="num">${differenceCell}</td>
            <td>${row.matches ? '<span class="pill ok">Matches</span>' : '<span class="pill bad">Discrepancy</span>'}</td>
            <td class="muted">${escapeHtml(row.countedOn)} (${escapeHtml(row.countedBy)})</td>
            ${rowActions([{ label: 'View', href: href('/audit/view', { id: row.id }) }])}
          </tr>`;
    })
    .join('\n');

  const head =
    '<th>SKU</th><th>Product</th><th>Warehouse</th><th class="num">System Qty</th><th class="num">Counted Qty</th><th class="num">Difference</th><th>Result</th><th>Counted</th><th class="row-actions">Action</th>';

  const filters = renderFilters({
    action: '/audit',
    showReset: Boolean(warehouseId || differencesOnly),
    controls: [
      {
        name: 'warehouse',
        label: 'Warehouse',
        allLabel: 'All warehouses',
        value: warehouseId,
        options: warehouses.map((w) => ({ value: w.id, label: w.name })),
      },
      {
        // Every line, or only the ones where the count and the system disagree.
        // Two outcomes, so one dropdown with All and the one narrowing it does.
        name: 'show',
        label: 'Show',
        allLabel: 'All lines',
        value: differencesOnly ? 'discrepancy' : '',
        options: [{ value: 'discrepancy', label: 'Discrepancies only' }],
      },
    ],
  });

  const body = `${filters}
${countLine(view, matched, total, 'audit line')}
${pager('/audit', params, view)}
${sourceNote(note)}
${tableOrEmpty(rows, head, 'No audit lines match these filters.')}
${pager('/audit', params, view)}`;

  return layout({
    title: 'Inventory Audit',
    activePath: '/audit',
    lede: 'Physical counts compared against what the system expected.',
    body,
    flash,
  });
}

/* ========================================================================== */
/* 7. RECORD SCREENS                                                          */
/* ========================================================================== */

/*
 * The view page for each of the five areas. There is no add, edit or delete
 * counterpart: the data belongs to the source database, which this application
 * reads and never writes.
 *
 * Every function here is a thin wrapper over renderRecordPage. It decides what
 * a member of staff needs to see for that kind of record and hands it over.
 * None of them work anything out - the router arrives with the record already
 * assembled.
 */

/* --- Products ------------------------------------------------------------- */

/**
 * One product, with the stock it is holding across every site.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderProductViewPage({ product, stockLines, flash = null }) {
  const summaryRows = stockLines
    .map(
      (line) => `          <tr>
            <td>${escapeHtml(line.warehouseName)}</td>
            <td class="num">${escapeHtml(number(line.onHand))}</td>
            <td class="num">${escapeHtml(number(line.reserved))}</td>
            <td class="num">${escapeHtml(number(line.available))}</td>
            <td><span class="pill ${escapeHtml(statusClass(line.status))}">${escapeHtml(line.status)}</span></td>
          </tr>`,
    )
    .join('\n');

  const summary =
    stockLines.length === 0
      ? '    <p class="empty">No stock is recorded against this SKU at any warehouse.</p>'
      : `    <div class="table-scroll">
      <table>
        <thead><tr><th>Warehouse</th><th class="num">Current</th><th class="num">Reserved</th><th class="num">Available</th><th>Status</th></tr></thead>
        <tbody>
${summaryRows}
        </tbody>
      </table>
    </div>`;

  return renderRecordPage({
    title: product.name,
    activePath: '/products',
    lede: `Product ${product.sku}.`,
    flash,
    actions: [{ label: 'Back to products', href: '/products', tone: 'secondary' }],
    rows: [
      {
        label: 'Image',
        html: `<img class="thumb" src="${escapeHtml(product.image)}" alt="" width="56" height="56" loading="lazy">`,
      },
      { label: 'SKU', text: product.sku },
      { label: 'Product name', text: product.name },
      { label: 'Category', text: product.category ?? NOT_IN_SOURCE },
      { label: 'Supplier', text: product.supplier ?? NOT_IN_SOURCE },
      {
        label: 'Listing status',
        html: product.active
          ? '<span class="pill ok">Active</span>'
          : '<span class="pill neutral">Inactive</span>',
        derived:
          product.endOfLineStatus === null || product.endOfLineStatus === undefined
            ? 'Not flagged end-of-line in the source.'
            : `End-of-line status in the source: ${product.endOfLineStatus}.`,
      },
      {
        label: 'Units held',
        text: number(product.unitsHeld),
        derived: `Across ${stockLines.length} stock line${stockLines.length === 1 ? '' : 's'}. Totalled from the stock data, not stored here.`,
      },
      {
        label: 'Available',
        text: number(product.available),
        derived: `${number(product.unitsHeld)} held minus ${number(product.reserved)} reserved, across every warehouse.`,
      },
      {
        label: 'Stock position',
        html: `<span class="pill ${escapeHtml(statusClass(product.stockStatus))}">${escapeHtml(product.stockStatus)}</span>`,
        derived: 'The band this SKU is counted in on the dashboard.',
      },
      {
        label: 'Units sold (90 days)',
        text: number(product.unitsSoldLast90Days),
        derived: 'Counted from despatched order lines, including this SKU sold inside a bundle.',
      },
    ],
    extra: `    <h2>Stock held</h2>\n${summary}`,
  });
}

/* --- Warehouse stock ------------------------------------------------------ */

/**
 * One stock line, with the available figure worked out in front of staff
 * rather than stored.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderStockViewPage({ line, issues, threshold = 0, note = '', flash = null }) {
  const issueList =
    issues.length === 0
      ? '    <p class="empty">The rules find nothing wrong with this stock line.</p>'
      : `    <div class="table-scroll">
      <table>
        <thead><tr><th>Issue</th><th>Why it was raised</th></tr></thead>
        <tbody>
${issues
  .map(
    (issue) => `          <tr>
            <td><span class="pill ${escapeHtml(issueClass(issue.type))}">${escapeHtml(issue.type)}</span></td>
            <td class="reason">${escapeHtml(issue.detail)}</td>
          </tr>`,
  )
  .join('\n')}
        </tbody>
      </table>
    </div>`;

  const shelf = [line.shelfLocation, line.bulkLocation].filter(
    (value) => value && value !== '-',
  );

  return renderRecordPage({
    title: `${line.sku} at ${line.warehouseName}`,
    activePath: '/stock',
    lede: 'One SKU held at one warehouse.',
    flash,
    note,
    actions: [{ label: 'Back to stock', href: '/stock', tone: 'secondary' }],
    rows: [
      { label: 'SKU', text: line.sku },
      { label: 'Product', text: line.productName },
      { label: 'Warehouse', text: line.warehouseName },
      { label: 'Current / on hand', text: number(line.onHand) },
      { label: 'Reserved', text: number(line.reserved) },
      {
        label: 'Available',
        html: `<strong>${escapeHtml(number(line.available))}</strong>`,
        derived: `Calculated as ${number(line.onHand)} on hand minus ${number(line.reserved)} reserved. Never stored.`,
      },
      {
        label: 'Low-stock threshold',
        text: number(threshold),
        derived: 'An application setting, not a figure from the source database.',
      },
      { label: 'Shelf location', text: shelf.length > 0 ? shelf.join(' / ') : NOT_IN_SOURCE },
      {
        label: 'Status',
        html: `<span class="pill ${escapeHtml(statusClass(line.status))}">${escapeHtml(line.status)}</span>`,
        derived: 'Worked out from the figures above by the same rules that fill the dashboard.',
      },
    ],
    extra: `    <h2>Issues raised by this line</h2>\n${issueList}`,
  });
}

/* --- Alerts / issues ------------------------------------------------------ */

/**
 * One detected issue, with the stock behind it and whatever staff recorded.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderIssueViewPage({ issue, line, flash = null }) {
  return renderRecordPage({
    title: `${issue.type}: ${issue.sku}`,
    activePath: '/alerts',
    lede: `Detected at ${issue.warehouseName}.`,
    flash,
    note:
      'This issue is not a record. It is recalculated from the source data every time this page is loaded, so it cannot be dismissed here and it disappears by itself once the stock figures no longer meet the condition.',
    actions: [
      ...(line
        ? [
            {
              label: 'View the stock line',
              href: href('/stock/view', { sku: issue.sku, warehouse: issue.warehouseId }),
              tone: 'secondary',
            },
          ]
        : []),
      { label: 'Back to alerts', href: '/alerts', tone: 'secondary' },
    ],
    rows: [
      {
        label: 'Issue type',
        html: `<span class="pill ${escapeHtml(issueClass(issue.type))}">${escapeHtml(issue.type)}</span>`,
      },
      { label: 'SKU', text: issue.sku },
      { label: 'Product', text: issue.productName },
      { label: 'Warehouse', text: issue.warehouseName },
      { label: 'Why it was raised', text: issue.detail },
      { label: 'On hand', text: number(issue.onHand) },
      { label: 'Reserved', text: number(issue.reserved) },
      {
        label: 'Available',
        text: number(issue.available),
        derived: 'On hand minus reserved.',
      },
    ],
  });
}

/* --- Transfers ------------------------------------------------------------ */

/**
 * One transfer.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderTransferViewPage({ transfer, flash = null }) {
  return renderRecordPage({
    title: `Transfer ${transfer.id}`,
    activePath: '/transfers',
    lede: `${transfer.quantity} x ${transfer.sku}.`,
    flash,
    note: 'Read from the source database. Nothing on this page can be changed here.',
    actions: [
      { label: 'Back to transfers', href: '/transfers', tone: 'secondary' },
    ],
    rows: [
      { label: 'Transfer ID', text: transfer.id },
      { label: 'SKU', text: transfer.sku },
      { label: 'Product', text: transfer.productName },
      { label: 'From', text: transfer.fromWarehouseName },
      { label: 'To', text: transfer.toWarehouseName },
      { label: 'Quantity', text: number(transfer.quantity) },
      {
        label: 'Status',
        html: `<span class="pill ${escapeHtml(transferStatusClass(transfer.status))}">${escapeHtml(transfer.status)}</span>`,
      },
      { label: 'Raised on', text: transfer.raisedOn },
    ],
  });
}

/* --- Inventory audit ------------------------------------------------------ */

/**
 * One audit count, with the difference worked out in front of staff.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderAuditViewPage({ row, flash = null }) {
  return renderRecordPage({
    title: `Audit ${row.id}`,
    activePath: '/audit',
    lede: `${row.sku} counted at ${row.warehouseName}.`,
    flash,
    actions: [
      { label: 'Back to audit', href: '/audit', tone: 'secondary' },
    ],
    rows: [
      { label: 'Audit ID', text: row.id },
      { label: 'SKU', text: row.sku },
      { label: 'Product', text: row.productName },
      { label: 'Warehouse', text: row.warehouseName },
      { label: 'System quantity', text: number(row.systemQuantity) },
      { label: 'Counted quantity', text: number(row.countedQuantity) },
      {
        label: 'Difference',
        html: row.matches
          ? '<span class="muted">0</span>'
          : `<span class="${row.difference > 0 ? 'pos' : 'neg'}">${escapeHtml(formatDifference(row.difference))}</span>`,
        derived: `Calculated as ${number(row.countedQuantity)} counted minus ${number(row.systemQuantity)} system. Never stored.`,
      },
      {
        label: 'Result',
        html: row.matches
          ? '<span class="pill ok">Matches</span>'
          : '<span class="pill bad">Discrepancy</span>',
      },
      { label: 'Counted on', text: row.countedOn },
      { label: 'Counted by', text: row.countedBy },
    ],
  });
}

/* ========================================================================== */
/* Supporting pages and assets                                                */
/* ========================================================================== */

/**
 * Not-found page. Kept inside the normal shell so the navigation still works.
 *
 * @returns {string}
 */
export function renderNotFoundPage() {
  return layout({
    title: 'Page not found',
    activePath: '',
    lede: '',
    body: '    <p class="empty">That page does not exist. Use the navigation above to pick one of the six areas.</p>',
  });
}

/**
 * The answer to anything that tries to change something.
 *
 * There is no form in this application and no route that accepts a submission,
 * so this is only reached by an old bookmark or a hand-made request. It says
 * what is actually true - the data belongs to another system and this one only
 * reports on it - rather than a bare error.
 *
 * @returns {string}
 */
export function renderReadOnlyPage() {
  return layout({
    title: 'Read-only',
    activePath: '',
    lede: '',
    body:
      '    <p class="empty">This system reports on the inventory database; it does not change it. ' +
      'Stock, products, transfers and counts are maintained in the source system, and appear here ' +
      'as soon as they change there.</p>',
  });
}

/**
 * The one script in the system, served from this origin as /filters.js.
 *
 * It does exactly one thing: when a control in a list-screen filter bar
 * changes, it submits that bar. That is the whole of the client-side behaviour
 * - there is no framework, no bundle, no dependency and no other script.
 *
 * Three details are deliberate:
 *
 * 1. It listens on the document rather than wiring up each control, so it does
 *    not care when it runs or what the page redraws.
 *
 * 2. It checks the form carries class="filters" before doing anything. The
 *    add and edit forms are class="record" and are submitted by their own Save
 *    button; nothing here touches them.
 *
 * 3. It drops empty fields before submitting. Without that, choosing "All
 *    categories" would produce ?category=&supplier= rather than a clean URL,
 *    and the address bar would stop being a readable description of the screen.
 *    The page navigates immediately afterwards, so the change is never seen.
 *
 * With scripting turned off the filters do not apply themselves. Everything
 * else - every screen, every record, every link - still works exactly as it
 * did, because nothing else on any page depends on this file.
 *
 * @returns {string} JavaScript source.
 */
export function renderFilterScript() {
  return `"use strict";
/* Smart Inventory Control - list-screen filters. Applied on change. */
document.addEventListener("change", function (event) {
  var control = event.target;
  if (!control || !control.form) return;

  var form = control.form;
  if (!form.classList.contains("filters")) return;

  var tag = control.tagName;
  if (tag !== "SELECT" && !(tag === "INPUT" && control.type === "search")) return;

  // A filter left at "All" should leave the URL, not sit in it empty.
  for (var i = 0; i < form.elements.length; i += 1) {
    var field = form.elements[i];
    if (field.name && field.value === "") field.disabled = true;
  }

  form.submit();
});
`;
}

/** Thumbnail background colour per category. */
const CATEGORY_COLOURS = Object.freeze({
  'Ceiling Lights': '#2b6cb0',
  'Outdoor Lighting': '#2f855a',
  Bulbs: '#b7791f',
  'Fittings & Spares': '#4a5568',
  Lamps: '#805ad5',
});

/**
 * Initials for a product thumbnail: the first letter of the first two words.
 *
 * @param {string} name
 * @returns {string}
 */
export function thumbnailInitials(name) {
  const letters = String(name ?? '')
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');

  return letters || '?';
}

/**
 * A product thumbnail, generated as SVG.
 *
 * Generated rather than stored so the repository carries no binary assets, and
 * so the page never reaches out to the network for an image.
 *
 * @param {{name: string, category: string}|null} product
 * @returns {string} An SVG document.
 */
export function renderThumbnailSvg(product) {
  const colour = CATEGORY_COLOURS[product?.category] ?? '#718096';
  const initials = product ? thumbnailInitials(product.name) : '?';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${escapeHtml(product?.name ?? 'Unknown product')}">
  <rect width="64" height="64" rx="8" fill="${escapeHtml(colour)}"/>
  <text x="32" y="32" fill="#ffffff" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" font-weight="600" text-anchor="middle" dominant-baseline="central">${escapeHtml(initials)}</text>
</svg>
`;
}
