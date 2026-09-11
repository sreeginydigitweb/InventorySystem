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
 *    The dummy data is ours, but the rule is absolute so it cannot lapse when a
 *    real source is connected later.
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
 * CSS class for what staff have recorded against an issue.
 *
 * Deliberately a quieter palette than the issue itself: an issue marked
 * Resolved is still whatever the rules say it is, and the green here says the
 * team has dealt with it, not that the stock is now correct.
 *
 * @param {string} status
 * @returns {string}
 */
export function actionStatusClass(status) {
  switch (status) {
    case 'Resolved':
      return 'ok';
    case 'In Progress':
      return 'info';
    case 'Open':
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
  header.masthead .sub { font-size: .8rem; color: #a9b6c4; margin-top: .1rem; }
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

  /* Dashboard tiles */
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: .9rem; margin: 0 0 1.75rem; }
  .tile {
    background: #fff; border: 1px solid var(--line); border-radius: 7px; padding: .95rem 1rem;
    display: block; text-decoration: none; color: inherit; min-width: 0;
  }
  a.tile:hover { border-color: var(--accent); }
  a.tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tile .value { font-size: 1.9rem; font-weight: 600; line-height: 1.1; }
  .tile .label { font-size: .82rem; text-transform: uppercase; letter-spacing: .04em;
                 color: var(--muted); margin-top: .3rem; overflow-wrap: break-word; }
  .tile .unit { font-size: .78rem; color: var(--muted); margin-top: .15rem; overflow-wrap: break-word; }
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
    .tiles { grid-template-columns: repeat(2, 1fr); gap: .8rem; }
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
    header.masthead .sub { font-size: .76rem; }
    /* Every link is kept: they wrap onto as many rows as they need, squared
       off so a wrapped row does not read as a broken tab strip. */
    nav { gap: .3rem; margin-top: .65rem; padding-bottom: .5rem; }
    nav a { flex: 1 1 auto; text-align: center; border-radius: 5px; padding: .5rem .6rem; font-size: .82rem; }
    main { padding: 1.1rem var(--gutter) 2rem; }
    h1 { font-size: 1.15rem; }
    h2 { margin: 1.4rem 0 .5rem; }
    .tiles { grid-template-columns: 1fr; gap: .7rem; margin-bottom: 1.4rem; }
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

  /* Per-row actions. Kept on one line inside the scrolling table. */
  th.row-actions, td.row-actions { white-space: nowrap; }
  td.row-actions a { color: var(--accent); text-decoration: none; font-size: .85rem;
                     display: inline-block; padding: .25rem .25rem; }
  td.row-actions a:hover { text-decoration: underline; }
  td.row-actions a.remove { color: var(--bad-fg); }
  td.row-actions .sep { color: #c8cdd4; }

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
    <div class="sub">Dummy data - demonstration MVP, not a live inventory system</div>
    <nav>${nav}</nav>
  </header>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ''}
${banner}${body}
    <footer>Smart Inventory Control MVP. All products, warehouses, stock figures and transfers shown are invented.</footer>
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

/** Row count line above a table. */
function countLine(shown, total, noun) {
  const label =
    shown === total
      ? `${total} ${noun}${total === 1 ? '' : 's'}`
      : `${shown} of ${total} ${noun}${total === 1 ? '' : 's'}`;
  return `    <p class="count">${escapeHtml(label)}</p>`;
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
 * The View / Edit / Delete cell for one table row.
 *
 * @param {{label: string, href: string, remove?: boolean}[]} links
 * @returns {string}
 */
function rowActions(links) {
  const rendered = links
    .map(
      (link) =>
        `<a class="${link.remove ? 'remove' : ''}" href="${link.href}">${escapeHtml(link.label)}</a>`,
    )
    .join('<span class="sep">|</span>');

  return `<td class="row-actions">${rendered}</td>`;
}

/**
 * The button bar above a table or a record.
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
 * One field on a view screen.
 *
 * A row is given either text, which is escaped, or html, which is not and is
 * only ever markup this module built itself - a pill, a thumbnail, a signed
 * difference. Nothing from a form ever arrives as html.
 *
 * @typedef {{label: string, text?: unknown, html?: string, derived?: string}} DetailRow
 */

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

/**
 * An add or edit form.
 *
 * Submitted values are handed back in `values` and errors in `errors`, so a
 * rejected form comes back with what the member of staff typed still in it and
 * the problem named against the field it belongs to - not a blank form and a
 * vague apology.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderFormPage({
  title,
  activePath,
  lede = '',
  action,
  fields,
  values = {},
  errors = {},
  hidden = {},
  submitLabel = 'Save',
  cancelHref,
  note = '',
  flash = null,
}) {
  const messages = Object.values(errors);
  const summary =
    messages.length === 0
      ? ''
      : `    <div class="errors">
      <strong>${escapeHtml(
        messages.length === 1 ? 'One field needs attention:' : `${messages.length} fields need attention:`,
      )}</strong>
      <ul>${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('')}</ul>
    </div>`;

  const control = (field) => {
    const value = values[field.name];
    const invalid = Boolean(errors[field.name]);
    const id = `f-${field.name}`;

    if (field.kind === 'select') {
      const options = (field.options ?? [])
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}"${option.value === String(value ?? '') ? ' selected' : ''}>${escapeHtml(option.label)}</option>`,
        )
        .join('');
      return `<select id="${id}" name="${escapeHtml(field.name)}">${options}</select>`;
    }

    if (field.kind === 'textarea') {
      return `<textarea id="${id}" name="${escapeHtml(field.name)}" rows="4">${escapeHtml(value ?? '')}</textarea>`;
    }

    if (field.kind === 'checkboxes') {
      // A form posts one value as a string and several as an array, so a single
      // ticked box must not come back as an unticked one.
      const chosen = (Array.isArray(value) ? value : value ? [value] : []).map(String);
      const boxes = (field.options ?? [])
        .map(
          (option) =>
            `<label><input type="checkbox" name="${escapeHtml(field.name)}" value="${escapeHtml(option.value)}"${chosen.includes(option.value) ? ' checked' : ''}> ${escapeHtml(option.label)}</label>`,
        )
        .join('');
      return `<div class="options">${boxes}</div>`;
    }

    if (field.kind === 'readonly') {
      // Also submitted as a hidden field, because a readonly input is easy to
      // edit from a console and must not be trusted as the record's key.
      return `<input id="${id}" type="text" value="${escapeHtml(value ?? '')}" readonly>`;
    }

    const type = field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text';
    const step = field.kind === 'number' ? ' step="1"' : '';
    return `<input id="${id}" type="${type}"${step} name="${escapeHtml(field.name)}" value="${escapeHtml(value ?? '')}"${invalid ? ' aria-invalid="true"' : ''}>`;
  };

  const controls = fields
    .map((field) => {
      const invalid = errors[field.name] ? ' bad' : '';
      const wide = field.wide || field.kind === 'checkboxes' || field.kind === 'textarea' ? ' wide' : '';
      const hint = field.hint ? `\n          <span class="hint">${escapeHtml(field.hint)}</span>` : '';
      const message = errors[field.name]
        ? `\n          <span class="field-error">${escapeHtml(errors[field.name])}</span>`
        : '';

      return `        <div class="field${wide}${invalid}">
          <label class="caption" for="f-${escapeHtml(field.name)}">${escapeHtml(field.label)}</label>
          ${control(field)}${hint}${message}
        </div>`;
    })
    .join('\n');

  const hiddenFields = Object.entries(hidden)
    .map(
      ([name, value]) =>
        `      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('\n');

  const body = `${summary}
${note ? `    <p class="note">${escapeHtml(note)}</p>` : ''}
    <form class="record" method="post" action="${escapeHtml(action)}">
${hiddenFields}
      <div class="grid">
${controls}
      </div>
      <div class="buttons">
        <button type="submit">${escapeHtml(submitLabel)}</button>
        <a class="btn secondary" href="${cancelHref}">Cancel</a>
      </div>
    </form>`;

  return layout({ title, activePath, lede, body, flash });
}

/**
 * The confirmation step in front of a delete.
 *
 * Nothing is removed by reaching this page: it is a plain GET that shows what
 * would go and asks. The removal only happens when the form on it is posted.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderConfirmPage({
  title,
  activePath,
  lede = '',
  warning,
  rows,
  action,
  hidden = {},
  confirmLabel = 'Delete',
  cancelHref,
  blocked = false,
  consent = null,
  flash = null,
}) {
  const items = rows
    .map((row, index) => {
      const last = index === rows.length - 1 ? 'last' : '';
      return `        <dt class="${last}">${escapeHtml(row.label)}</dt>
        <dd class="${last}">${row.html ?? escapeHtml(row.text)}</dd>`;
    })
    .join('\n');

  const hiddenFields = Object.entries(hidden)
    .map(
      ([name, value]) =>
        `      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('\n');

  const consentBox = consent
    ? `      <div class="field wide">
        <div class="options">
          <label><input type="checkbox" name="${escapeHtml(consent.name)}" value="yes"> ${escapeHtml(consent.label)}</label>
        </div>
      </div>`
    : '';

  const form = blocked
    ? `    <p><a class="btn secondary" href="${cancelHref}">Back</a></p>`
    : `    <form class="record" method="post" action="${escapeHtml(action)}">
${hiddenFields}
${consentBox}
      <div class="buttons">
        <button class="btn danger" type="submit">${escapeHtml(confirmLabel)}</button>
        <a class="btn secondary" href="${cancelHref}">Cancel</a>
      </div>
    </form>`;

  const body = `    <p class="flash ${blocked ? 'bad' : 'warn'}">${escapeHtml(warning)}</p>
    <div class="detail">
      <dl>
${items}
      </dl>
    </div>
${form}`;

  return layout({ title, activePath, lede, body, flash });
}

/* ========================================================================== */
/* 1. DASHBOARD                                                               */
/* ========================================================================== */

/**
 * @param {object} options
 * @param {object} options.metrics       From dashboardMetrics().
 * @param {object[]} options.issueCounts From issueCounts().
 * @param {object[]} options.transferCounts From transferCounts().
 */
export function renderDashboardPage({ metrics, issueCounts, transferCounts }) {
  const tile = (href, value, label, unit, tone) =>
    `      <a class="tile ${tone}" href="${escapeHtml(href)}">
        <div class="value">${escapeHtml(String(value))}</div>
        <div class="label">${escapeHtml(label)}</div>
        <div class="unit">${escapeHtml(unit)}</div>
      </a>`;

  const tiles = [
    tile('/products', metrics.totalSkus, 'Total SKUs', 'in the catalogue', ''),
    tile('/stock?status=Healthy', metrics.healthyStock, 'Healthy Stock', 'stock lines', 'ok'),
    tile('/stock?status=Low+Stock', metrics.lowStock, 'Low Stock', 'stock lines', 'warn'),
    tile('/stock?status=Out+of+Stock', metrics.outOfStock, 'Out-of-Stock Items', 'stock lines', 'bad'),
    tile('/audit?show=discrepancy', metrics.discrepancies, 'Discrepancies', 'audit lines that disagree', 'bad'),
    tile('/transfers?status=Pending', metrics.pendingTransfers, 'Pending Transfers', 'awaiting despatch', 'warn'),
  ].join('\n');

  const issueRows = issueCounts
    .map(
      (row) => `          <tr>
            <td><span class="pill ${escapeHtml(issueClass(row.type))}">${escapeHtml(row.type)}</span></td>
            <td class="num">${escapeHtml(String(row.count))}</td>
            <td><a href="/alerts?type=${encodeURIComponent(row.type)}">View</a></td>
          </tr>`,
    )
    .join('\n');

  const transferRows = transferCounts
    .map(
      (row) => `          <tr>
            <td><span class="pill ${escapeHtml(transferStatusClass(row.status))}">${escapeHtml(row.status)}</span></td>
            <td class="num">${escapeHtml(String(row.count))}</td>
            <td><a href="/transfers?status=${encodeURIComponent(row.status)}">View</a></td>
          </tr>`,
    )
    .join('\n');

  const body = `    <div class="tiles">
${tiles}
    </div>

    <p class="note">Stock figures count stock lines - one SKU held at one warehouse - because the same SKU can be healthy at one site and out of stock at another. Across ${escapeHtml(String(metrics.totalStockLines))} stock lines, every line falls into exactly one of Healthy, Low, Out of Stock or Negative.</p>

    <h2>Issues detected</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Issue type</th><th class="num">Count</th><th>Action</th></tr></thead>
        <tbody>
${issueRows}
        </tbody>
      </table>
    </div>

    <h2>Transfers by status</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Status</th><th class="num">Count</th><th>Action</th></tr></thead>
        <tbody>
${transferRows}
        </tbody>
      </table>
    </div>`;

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
  total,
  categories,
  suppliers,
  search = '',
  category = '',
  supplier = '',
  unknownSkus = [],
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
            <td>${escapeHtml(product.category)}</td>
            <td>${escapeHtml(product.supplier)}</td>
            <td>${status}</td>
            <td class="num">${escapeHtml(String(product.unitsHeld))}</td>
            ${rowActions([
              { label: 'View', href: href('/products/view', { sku: product.sku }) },
              { label: 'Edit', href: href('/products/edit', { sku: product.sku }) },
              { label: 'Delete', href: href('/products/delete', { sku: product.sku }), remove: true },
            ])}
          </tr>`;
    })
    .join('\n');

  const head =
    '<th>Image</th><th>SKU</th><th>Product Name</th><th>Category</th><th>Supplier</th><th>Listing</th><th class="num">Units held</th><th class="row-actions">Actions</th>';

  const filters = renderFilters({
    action: '/products',
    showReset: Boolean(search || category || supplier),
    controls: [
      { kind: 'search', name: 'q', label: 'Search', value: search, placeholder: 'SKU, name or supplier' },
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
    ],
  });

  const unknownNote =
    unknownSkus.length === 0
      ? ''
      : `    <p class="note">Stock is recorded against ${escapeHtml(String(unknownSkus.length))} SKU${unknownSkus.length === 1 ? '' : 's'} that ${unknownSkus.length === 1 ? 'is' : 'are'} not in this catalogue: ${escapeHtml(unknownSkus.join(', '))}. ${unknownSkus.length === 1 ? 'It is' : 'They are'} reported on the Alerts screen as a Warehouse/SKU Mismatch.</p>`;

  const body = `${pageActions([{ label: 'Add product', href: '/products/add' }])}
${filters}
${unknownNote}
${countLine(products.length, total, 'product')}
${tableOrEmpty(rows, head, 'No products match these filters.')}`;

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
  total,
  warehouses,
  statuses,
  warehouseId = '',
  status = '',
  search = '',
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
          ? `<span class="neg">${escapeHtml(String(line.onHand))}</span>`
          : escapeHtml(String(line.onHand));

      const available =
        line.available <= 0
          ? `<span class="neg">${escapeHtml(String(line.available))}</span>`
          : escapeHtml(String(line.available));

      return `          <tr${rowClass}>
            <td class="sku">${escapeHtml(line.sku)}</td>
            <td class="name">${escapeHtml(line.productName)}</td>
            <td>${escapeHtml(line.warehouseName)}</td>
            <td class="num">${onHand}</td>
            <td class="num">${escapeHtml(String(line.reserved))}</td>
            <td class="num">${available}</td>
            <td class="num">${escapeHtml(String(line.minimum))}</td>
            <td><span class="pill ${escapeHtml(statusClass(line.status))}">${escapeHtml(line.status)}</span></td>
            ${rowActions([
              {
                label: 'View',
                href: href('/stock/view', { sku: line.sku, warehouse: line.warehouseId }),
              },
              {
                label: 'Edit',
                href: href('/stock/edit', { sku: line.sku, warehouse: line.warehouseId }),
              },
              {
                label: 'Delete',
                href: href('/stock/delete', { sku: line.sku, warehouse: line.warehouseId }),
                remove: true,
              },
            ])}
          </tr>`;
    })
    .join('\n');

  const head =
    '<th>SKU</th><th>Product</th><th>Warehouse</th><th class="num">Current</th><th class="num">Reserved</th><th class="num">Available</th><th class="num">Minimum</th><th>Status</th><th class="row-actions">Actions</th>';

  const filters = renderFilters({
    action: '/stock',
    showReset: Boolean(warehouseId || status || search),
    controls: [
      { kind: 'search', name: 'q', label: 'Search', value: search, placeholder: 'SKU or product name' },
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

  const body = `${pageActions([{ label: 'Add stock record', href: '/stock/add' }])}
${filters}
    <p class="note">Available is not stored - it is always Current minus Reserved. A line can show stock on hand and still have nothing available when every unit is reserved. There is no field for Available on the add or edit form for the same reason.</p>
${countLine(lines.length, total, 'stock line')}
${tableOrEmpty(rows, head, 'No stock lines match these filters.')}`;

  return layout({
    title: 'Warehouse Stock',
    activePath: '/stock',
    lede: 'Stock held by SKU and warehouse.',
    body,
    flash,
  });
}

/* ========================================================================== */
/* 4. ALERTS / ISSUES                                                         */
/* ========================================================================== */

export function renderIssuesPage({
  issues,
  total,
  issueTypes,
  warehouses,
  actionStatuses = [],
  type = '',
  warehouseId = '',
  actionStatus = '',
  flash = null,
}) {
  const rows = issues
    .map((issue) => {
      const serious =
        issue.type === 'Negative Inventory' ||
        issue.type === 'Out of Stock' ||
        issue.type === 'Warehouse/SKU Mismatch';

      const action = issue.action ?? { status: 'Open', note: '' };
      const key = { type: issue.type, sku: issue.sku, warehouse: issue.warehouseId };

      return `          <tr${serious ? ' class="serious"' : ' class="flagged"'}>
            <td><span class="pill ${escapeHtml(issueClass(issue.type))}">${escapeHtml(issue.type)}</span></td>
            <td class="sku">${escapeHtml(issue.sku)}</td>
            <td class="name">${escapeHtml(issue.productName)}</td>
            <td>${escapeHtml(issue.warehouseName)}</td>
            <td class="num">${escapeHtml(String(issue.available))}</td>
            <td class="num">${escapeHtml(String(issue.minimum))}</td>
            <td class="reason">${escapeHtml(issue.detail)}</td>
            <td><span class="pill ${escapeHtml(actionStatusClass(action.status))}">${escapeHtml(action.status)}</span></td>
            ${rowActions([
              { label: 'View', href: href('/alerts/view', key) },
              { label: 'Action', href: href('/alerts/edit', key) },
            ])}
          </tr>`;
    })
    .join('\n');

  const head =
    '<th>Issue</th><th>SKU</th><th>Product</th><th>Warehouse</th><th class="num">Available</th><th class="num">Minimum</th><th>Why it was raised</th><th>Action status</th><th class="row-actions">Actions</th>';

  const filters = renderFilters({
    action: '/alerts',
    showReset: Boolean(type || warehouseId || actionStatus),
    controls: [
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
      {
        name: 'action',
        label: 'Action status',
        allLabel: 'All action statuses',
        value: actionStatus,
        options: actionStatuses.map((st) => ({ value: st, label: st })),
      },
    ],
  });

  const body = `${filters}
    <p class="note">Issues are worked out from the stock data every time this page is loaded - nothing is raised or cleared by hand. One stock line can raise more than one issue. Action status records what staff did about a problem; it never hides one. A shortage marked Resolved is still detected, still listed here and still counted on the dashboard until the stock figures themselves change.</p>
${countLine(issues.length, total, 'issue')}
${tableOrEmpty(rows, head, 'No issues match these filters.')}`;

  return layout({
    title: 'Alerts / Issues',
    activePath: '/alerts',
    lede: 'Problems detected in the current stock position.',
    body,
    flash,
  });
}

/* ========================================================================== */
/* 5. TRANSFERS                                                               */
/* ========================================================================== */

export function renderTransfersPage({
  transfers,
  total,
  statuses,
  warehouses,
  status = '',
  fromWarehouseId = '',
  toWarehouseId = '',
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
            <td class="num">${escapeHtml(String(transfer.quantity))}</td>
            <td><span class="pill ${escapeHtml(transferStatusClass(transfer.status))}">${escapeHtml(transfer.status)}</span></td>
            <td class="muted">${escapeHtml(transfer.raisedOn)}</td>
            ${rowActions([
              { label: 'View', href: href('/transfers/view', { id: transfer.id }) },
              { label: 'Edit', href: href('/transfers/edit', { id: transfer.id }) },
              { label: 'Delete', href: href('/transfers/delete', { id: transfer.id }), remove: true },
            ])}
          </tr>`,
    )
    .join('\n');

  const head =
    '<th>Transfer ID</th><th>SKU</th><th>Product</th><th>From</th><th>To</th><th class="num">Qty</th><th>Status</th><th>Raised</th><th class="row-actions">Actions</th>';

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

  const body = `${pageActions([{ label: 'Add transfer', href: '/transfers/add' }])}
${filters}
    <p class="note">Transfers are a record only in this MVP: the quantities shown are not applied to the warehouse stock figures. Adding, editing or deleting one here changes the transfer record and nothing else.</p>
${countLine(transfers.length, total, 'transfer')}
${tableOrEmpty(rows, head, 'No transfers match these filters.')}`;

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
  total,
  warehouses,
  warehouseId = '',
  differencesOnly = false,
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
            <td class="num">${escapeHtml(String(row.systemQuantity))}</td>
            <td class="num">${escapeHtml(String(row.countedQuantity))}</td>
            <td class="num">${differenceCell}</td>
            <td>${row.matches ? '<span class="pill ok">Matches</span>' : '<span class="pill bad">Discrepancy</span>'}</td>
            <td class="muted">${escapeHtml(row.countedOn)} (${escapeHtml(row.countedBy)})</td>
            ${rowActions([
              { label: 'View', href: href('/audit/view', { id: row.id }) },
              { label: 'Edit', href: href('/audit/edit', { id: row.id }) },
              { label: 'Delete', href: href('/audit/delete', { id: row.id }), remove: true },
            ])}
          </tr>`;
    })
    .join('\n');

  const head =
    '<th>SKU</th><th>Product</th><th>Warehouse</th><th class="num">System Qty</th><th class="num">Counted Qty</th><th class="num">Difference</th><th>Result</th><th>Counted</th><th class="row-actions">Actions</th>';

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
        name: 'difference',
        label: 'Show',
        allLabel: 'All lines',
        value: differencesOnly ? 'yes' : '',
        options: [{ value: 'yes', label: 'Discrepancies only' }],
      },
    ],
  });

  const body = `${pageActions([{ label: 'Add audit record', href: '/audit/add' }])}
${filters}
    <p class="note">Difference is Counted minus System. A positive difference means more was found than expected; a negative difference means less. It is worked out every time this page is drawn, so there is no field for it on the add or edit form and no way for a stored figure to disagree with the two it comes from.</p>
${countLine(auditRows.length, total, 'audit line')}
${tableOrEmpty(rows, head, 'No audit lines match these filters.')}`;

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
 * View, add, edit and delete for each of the five areas.
 *
 * Every function here is a thin wrapper over renderRecordPage, renderFormPage
 * or renderConfirmPage: it decides what a member of staff needs to see for that
 * kind of record and hands it over. None of them work anything out - the router
 * arrives with the record already assembled - and none of them write anything.
 */

/** SKU options for the forms that must point at a real product. */
function skuOptions(products, placeholder = 'Choose a SKU') {
  return [
    { value: '', label: placeholder },
    ...products.map((product) => ({ value: product.sku, label: `${product.sku} - ${product.name}` })),
  ];
}

/** Warehouse options for the forms that must point at a real site. */
function warehouseOptions(warehouses, placeholder = 'Choose a warehouse') {
  return [
    { value: '', label: placeholder },
    ...warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
  ];
}

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
            <td class="num">${escapeHtml(String(line.onHand))}</td>
            <td class="num">${escapeHtml(String(line.reserved))}</td>
            <td class="num">${escapeHtml(String(line.available))}</td>
            <td class="num">${escapeHtml(String(line.minimum))}</td>
            <td><span class="pill ${escapeHtml(statusClass(line.status))}">${escapeHtml(line.status)}</span></td>
          </tr>`,
    )
    .join('\n');

  const summary =
    stockLines.length === 0
      ? '    <p class="empty">No stock is recorded against this SKU at any warehouse.</p>'
      : `    <div class="table-scroll">
      <table>
        <thead><tr><th>Warehouse</th><th class="num">Current</th><th class="num">Reserved</th><th class="num">Available</th><th class="num">Minimum</th><th>Status</th></tr></thead>
        <tbody>
${summaryRows}
        </tbody>
      </table>
    </div>`;

  const approved =
    product.approvedWarehouseNames.length === 0
      ? 'None - stock recorded anywhere will be reported as a mismatch'
      : product.approvedWarehouseNames.join(', ');

  return renderRecordPage({
    title: product.name,
    activePath: '/products',
    lede: `Product ${product.sku}.`,
    flash,
    actions: [
      { label: 'Edit product', href: href('/products/edit', { sku: product.sku }) },
      { label: 'Delete product', href: href('/products/delete', { sku: product.sku }), tone: 'danger' },
      { label: 'Back to products', href: '/products', tone: 'secondary' },
    ],
    rows: [
      {
        label: 'Image',
        html: `<img class="thumb" src="${escapeHtml(product.image)}" alt="" width="56" height="56">`,
      },
      { label: 'SKU', text: product.sku },
      { label: 'Product name', text: product.name },
      { label: 'Category', text: product.category },
      { label: 'Supplier', text: product.supplier },
      {
        label: 'Listing status',
        html: product.active
          ? '<span class="pill ok">Active</span>'
          : '<span class="pill neutral">Inactive</span>',
      },
      {
        label: 'Units held',
        text: String(product.unitsHeld),
        derived: `Across ${stockLines.length} stock line${stockLines.length === 1 ? '' : 's'}. Totalled from the stock data, not stored here.`,
      },
      { label: 'Units sold (90 days)', text: String(product.unitsSoldLast90Days) },
      { label: 'Approved warehouses', text: approved },
    ],
    extra: `    <h2>Stock held</h2>\n${summary}`,
  });
}

/**
 * The add and edit form for a product.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderProductFormPage({
  mode,
  values,
  errors = {},
  categories,
  suppliers,
  warehouses,
  listingStatuses,
  flash = null,
}) {
  const editing = mode === 'edit';

  const fields = [
    editing
      ? { kind: 'readonly', name: 'sku', label: 'SKU', hint: 'The SKU is the key stock lines, transfers and audit records point at, so it cannot be changed here.' }
      : { kind: 'text', name: 'sku', label: 'SKU', hint: 'Required, and must not already be in the catalogue.' },
    { kind: 'text', name: 'name', label: 'Product name' },
    { kind: 'select', name: 'category', label: 'Category', options: [{ value: '', label: 'Choose a category' }, ...categories.map((c) => ({ value: c, label: c }))] },
    { kind: 'select', name: 'supplier', label: 'Supplier', options: [{ value: '', label: 'Choose a supplier' }, ...suppliers.map((s) => ({ value: s, label: s }))] },
    { kind: 'select', name: 'listing', label: 'Listing status', options: listingStatuses.map((s) => ({ value: s, label: s })) },
    { kind: 'number', name: 'unitsSoldLast90Days', label: 'Units sold (90 days)', hint: 'Used by the slow-moving rule. Zero if it has not sold.' },
    {
      kind: 'checkboxes',
      name: 'approvedWarehouses',
      label: 'Approved warehouses',
      options: warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
      hint: 'Stock recorded anywhere else is reported as a Warehouse/SKU Mismatch.',
    },
  ];

  return renderFormPage({
    title: editing ? `Edit ${values.sku}` : 'Add product',
    activePath: '/products',
    lede: editing ? 'Change the catalogue entry for this SKU.' : 'Create a new product in the dummy catalogue.',
    action: editing ? '/products/edit' : '/products/add',
    hidden: editing ? { sku: values.sku } : {},
    fields,
    values,
    errors,
    submitLabel: editing ? 'Save changes' : 'Add product',
    cancelHref: editing ? href('/products/view', { sku: values.sku }) : '/products',
    flash,
  });
}

/**
 * The confirmation in front of deleting a product.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderProductDeletePage({ product, references, flash = null }) {
  const referenced = references.total > 0;

  return renderConfirmPage({
    title: `Delete ${product.sku}?`,
    activePath: '/products',
    lede: 'This cannot be undone within the running session.',
    flash,
    warning: referenced
      ? `${product.sku} is still referenced by ${references.stockLines} stock line(s), ${references.transfers} transfer(s) and ${references.auditCounts} audit record(s). Deleting the product on its own would leave those pointing at a SKU that no longer exists, so they have to go with it.`
      : 'Nothing else in the system points at this product, so it can be removed on its own.',
    rows: [
      { label: 'SKU', text: product.sku },
      { label: 'Product name', text: product.name },
      { label: 'Category', text: product.category },
      { label: 'Supplier', text: product.supplier },
      { label: 'Stock lines affected', text: String(references.stockLines) },
      { label: 'Transfers affected', text: String(references.transfers) },
      { label: 'Audit records affected', text: String(references.auditCounts) },
    ],
    action: '/products/delete',
    hidden: { sku: product.sku },
    consent: referenced
      ? {
          name: 'cascade',
          label: `Yes - also delete the ${references.total} record(s) that point at ${product.sku}`,
        }
      : null,
    confirmLabel: referenced ? 'Delete product and related records' : 'Delete product',
    cancelHref: href('/products/view', { sku: product.sku }),
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
export function renderStockViewPage({ line, issues, flash = null }) {
  const issueList =
    issues.length === 0
      ? '    <p class="empty">The rules find nothing wrong with this stock line.</p>'
      : `    <div class="table-scroll">
      <table>
        <thead><tr><th>Issue</th><th>Why it was raised</th><th>Action status</th></tr></thead>
        <tbody>
${issues
  .map(
    (issue) => `          <tr>
            <td><span class="pill ${escapeHtml(issueClass(issue.type))}">${escapeHtml(issue.type)}</span></td>
            <td class="reason">${escapeHtml(issue.detail)}</td>
            <td><span class="pill ${escapeHtml(actionStatusClass(issue.action.status))}">${escapeHtml(issue.action.status)}</span></td>
          </tr>`,
  )
  .join('\n')}
        </tbody>
      </table>
    </div>`;

  return renderRecordPage({
    title: `${line.sku} at ${line.warehouseName}`,
    activePath: '/stock',
    lede: 'One SKU held at one warehouse.',
    flash,
    actions: [
      { label: 'Edit stock record', href: href('/stock/edit', { sku: line.sku, warehouse: line.warehouseId }) },
      { label: 'Delete stock record', href: href('/stock/delete', { sku: line.sku, warehouse: line.warehouseId }), tone: 'danger' },
      { label: 'Back to stock', href: '/stock', tone: 'secondary' },
    ],
    rows: [
      { label: 'SKU', text: line.sku },
      { label: 'Product', text: line.productName },
      { label: 'Warehouse', text: line.warehouseName },
      { label: 'Current / on hand', text: String(line.onHand) },
      { label: 'Reserved', text: String(line.reserved) },
      {
        label: 'Available',
        html: `<strong>${escapeHtml(String(line.available))}</strong>`,
        derived: `Calculated as ${line.onHand} on hand minus ${line.reserved} reserved. Never stored, and never entered on a form.`,
      },
      { label: 'Minimum stock', text: String(line.minimum) },
      {
        label: 'Status',
        html: `<span class="pill ${escapeHtml(statusClass(line.status))}">${escapeHtml(line.status)}</span>`,
        derived: 'Worked out from the figures above by the same rules that fill the dashboard.',
      },
    ],
    extra: `    <h2>Issues raised by this line</h2>\n${issueList}`,
  });
}

/**
 * The add and edit form for a stock line.
 *
 * There is no Available field, on purpose: it is onHand minus reserved and is
 * derived wherever it is shown.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderStockFormPage({ mode, values, errors = {}, products, warehouses, flash = null }) {
  const editing = mode === 'edit';

  const fields = [
    { kind: 'select', name: 'sku', label: 'SKU', options: skuOptions(products) },
    { kind: 'select', name: 'warehouseId', label: 'Warehouse', options: warehouseOptions(warehouses) },
    { kind: 'number', name: 'onHand', label: 'Current / on hand', hint: 'May be below zero: that is what the Negative Inventory rule reports.' },
    { kind: 'number', name: 'reserved', label: 'Reserved', hint: 'Units already committed to orders. Zero or more.' },
    { kind: 'number', name: 'minimum', label: 'Minimum stock', hint: 'The level this site is expected to hold. Zero or more.' },
  ];

  return renderFormPage({
    title: editing ? `Edit ${values.sku} at ${values.warehouseName ?? values.warehouseId}` : 'Add stock record',
    activePath: '/stock',
    lede: editing ? 'Change the stored figures for this stock line.' : 'Record stock for a SKU at a warehouse.',
    note: 'Available is not on this form. It is always Current minus Reserved, worked out when the figures are shown, so there is no way to save an Available that disagrees with them.',
    action: editing ? '/stock/edit' : '/stock/add',
    hidden: editing ? { originalSku: values.sku, originalWarehouse: values.warehouseId } : {},
    fields,
    values,
    errors,
    submitLabel: editing ? 'Save changes' : 'Add stock record',
    cancelHref: editing
      ? href('/stock/view', { sku: values.sku, warehouse: values.warehouseId })
      : '/stock',
    flash,
  });
}

/**
 * The confirmation in front of deleting a stock line.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderStockDeletePage({ line, flash = null }) {
  return renderConfirmPage({
    title: `Delete stock record for ${line.sku}?`,
    activePath: '/stock',
    lede: 'This cannot be undone within the running session.',
    flash,
    warning:
      'Removing this line removes the stock it records. The dashboard counts and the Alerts screen are worked out from the stock data, so both will change as soon as it is gone.',
    rows: [
      { label: 'SKU', text: line.sku },
      { label: 'Product', text: line.productName },
      { label: 'Warehouse', text: line.warehouseName },
      { label: 'Current / on hand', text: String(line.onHand) },
      { label: 'Reserved', text: String(line.reserved) },
      { label: 'Available', text: String(line.available) },
      { label: 'Minimum stock', text: String(line.minimum) },
    ],
    action: '/stock/delete',
    hidden: { sku: line.sku, warehouse: line.warehouseId },
    confirmLabel: 'Delete stock record',
    cancelHref: href('/stock/view', { sku: line.sku, warehouse: line.warehouseId }),
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
  const key = { type: issue.type, sku: issue.sku, warehouse: issue.warehouseId };

  const resolveForm =
    issue.action.status === 'Resolved'
      ? ''
      : `    <form class="record" method="post" action="/alerts/resolve">
      <input type="hidden" name="type" value="${escapeHtml(issue.type)}">
      <input type="hidden" name="sku" value="${escapeHtml(issue.sku)}">
      <input type="hidden" name="warehouse" value="${escapeHtml(issue.warehouseId)}">
      <div class="buttons">
        <button type="submit">Mark as resolved</button>
      </div>
    </form>`;

  return renderRecordPage({
    title: `${issue.type}: ${issue.sku}`,
    activePath: '/alerts',
    lede: `Detected at ${issue.warehouseName}.`,
    flash,
    note: 'Marking this resolved records what the team did. It does not change the stock, and it does not stop the rules detecting the problem: if the condition is still there on the next page load, this issue is still raised, still listed and still counted.',
    actions: [
      { label: 'Record an action', href: href('/alerts/edit', key) },
      ...(line
        ? [{ label: 'Edit the stock line', href: href('/stock/edit', { sku: issue.sku, warehouse: issue.warehouseId }), tone: 'secondary' }]
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
      { label: 'On hand', text: String(issue.onHand) },
      { label: 'Reserved', text: String(issue.reserved) },
      {
        label: 'Available',
        text: String(issue.available),
        derived: 'On hand minus reserved.',
      },
      { label: 'Minimum stock', text: String(issue.minimum) },
      {
        label: 'Action status',
        html: `<span class="pill ${escapeHtml(actionStatusClass(issue.action.status))}">${escapeHtml(issue.action.status)}</span>`,
      },
      { label: 'Action note', text: issue.action.note || 'Nothing recorded yet.' },
      { label: 'Action last updated', text: issue.action.updatedAt ?? 'Never' },
    ],
    extra: resolveForm,
  });
}

/**
 * The form for recording what staff did about an issue.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderIssueActionPage({ issue, values, errors = {}, actionStatuses, flash = null }) {
  return renderFormPage({
    title: `Action: ${issue.type}`,
    activePath: '/alerts',
    lede: `${issue.sku} at ${issue.warehouseName}. ${issue.detail}`,
    note: 'This records what the team did. It cannot clear the underlying problem: the detection rules read the stock figures, not this form, so the only thing that removes the issue from the list is correcting the stock itself.',
    action: '/alerts/edit',
    hidden: { type: issue.type, sku: issue.sku, warehouse: issue.warehouseId },
    fields: [
      {
        kind: 'select',
        name: 'status',
        label: 'Action status',
        options: actionStatuses.map((status) => ({ value: status, label: status })),
      },
      {
        kind: 'textarea',
        name: 'note',
        label: 'Action note',
        hint: 'What was done, or what is waiting on what. Optional.',
      },
    ],
    values,
    errors,
    submitLabel: 'Save action',
    cancelHref: href('/alerts/view', { type: issue.type, sku: issue.sku, warehouse: issue.warehouseId }),
    flash,
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
    note: 'Transfers are a record only in this MVP. The quantity below has not been taken off the source warehouse or added to the destination.',
    actions: [
      { label: 'Edit transfer', href: href('/transfers/edit', { id: transfer.id }) },
      { label: 'Delete transfer', href: href('/transfers/delete', { id: transfer.id }), tone: 'danger' },
      { label: 'Back to transfers', href: '/transfers', tone: 'secondary' },
    ],
    rows: [
      { label: 'Transfer ID', text: transfer.id },
      { label: 'SKU', text: transfer.sku },
      { label: 'Product', text: transfer.productName },
      { label: 'From', text: transfer.fromWarehouseName },
      { label: 'To', text: transfer.toWarehouseName },
      { label: 'Quantity', text: String(transfer.quantity) },
      {
        label: 'Status',
        html: `<span class="pill ${escapeHtml(transferStatusClass(transfer.status))}">${escapeHtml(transfer.status)}</span>`,
      },
      { label: 'Raised on', text: transfer.raisedOn },
    ],
  });
}

/**
 * The add and edit form for a transfer.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderTransferFormPage({
  mode,
  values,
  errors = {},
  products,
  warehouses,
  statuses,
  flash = null,
}) {
  const editing = mode === 'edit';

  const fields = [
    ...(editing ? [{ kind: 'readonly', name: 'id', label: 'Transfer ID' }] : []),
    { kind: 'select', name: 'sku', label: 'SKU', options: skuOptions(products) },
    { kind: 'select', name: 'fromWarehouseId', label: 'From warehouse', options: warehouseOptions(warehouses, 'Choose a source') },
    { kind: 'select', name: 'toWarehouseId', label: 'To warehouse', options: warehouseOptions(warehouses, 'Choose a destination') },
    { kind: 'number', name: 'quantity', label: 'Quantity', hint: 'Must be greater than zero.' },
    { kind: 'select', name: 'status', label: 'Status', options: statuses.map((s) => ({ value: s, label: s })) },
    { kind: 'date', name: 'raisedOn', label: 'Raised on' },
  ];

  return renderFormPage({
    title: editing ? `Edit transfer ${values.id}` : 'Add transfer',
    activePath: '/transfers',
    lede: editing ? 'Change this transfer, including its status.' : 'Raise a dummy transfer between two warehouses.',
    note: 'Saving this does not move any stock. Transfers are tracked only.',
    action: editing ? '/transfers/edit' : '/transfers/add',
    hidden: editing ? { id: values.id } : {},
    fields,
    values,
    errors,
    submitLabel: editing ? 'Save changes' : 'Add transfer',
    cancelHref: editing ? href('/transfers/view', { id: values.id }) : '/transfers',
    flash,
  });
}

/**
 * The confirmation in front of deleting a transfer.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderTransferDeletePage({ transfer, flash = null }) {
  return renderConfirmPage({
    title: `Delete transfer ${transfer.id}?`,
    activePath: '/transfers',
    lede: 'This cannot be undone within the running session.',
    flash,
    warning: 'The transfer record will be removed. No stock figures change, because transfers do not move stock in this MVP.',
    rows: [
      { label: 'Transfer ID', text: transfer.id },
      { label: 'SKU', text: transfer.sku },
      { label: 'Product', text: transfer.productName },
      { label: 'From', text: transfer.fromWarehouseName },
      { label: 'To', text: transfer.toWarehouseName },
      { label: 'Quantity', text: String(transfer.quantity) },
      { label: 'Status', text: transfer.status },
    ],
    action: '/transfers/delete',
    hidden: { id: transfer.id },
    confirmLabel: 'Delete transfer',
    cancelHref: href('/transfers/view', { id: transfer.id }),
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
      { label: 'Edit audit record', href: href('/audit/edit', { id: row.id }) },
      { label: 'Delete audit record', href: href('/audit/delete', { id: row.id }), tone: 'danger' },
      { label: 'Back to audit', href: '/audit', tone: 'secondary' },
    ],
    rows: [
      { label: 'Audit ID', text: row.id },
      { label: 'SKU', text: row.sku },
      { label: 'Product', text: row.productName },
      { label: 'Warehouse', text: row.warehouseName },
      { label: 'System quantity', text: String(row.systemQuantity) },
      { label: 'Counted quantity', text: String(row.countedQuantity) },
      {
        label: 'Difference',
        html: row.matches
          ? '<span class="muted">0</span>'
          : `<span class="${row.difference > 0 ? 'pos' : 'neg'}">${escapeHtml(formatDifference(row.difference))}</span>`,
        derived: `Calculated as ${row.countedQuantity} counted minus ${row.systemQuantity} system. Never stored, and never entered on a form.`,
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

/**
 * The add and edit form for an audit count.
 *
 * There is no Difference field: it is counted minus system, worked out wherever
 * it is shown.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderAuditFormPage({ mode, values, errors = {}, products, warehouses, flash = null }) {
  const editing = mode === 'edit';

  const fields = [
    ...(editing ? [{ kind: 'readonly', name: 'id', label: 'Audit ID' }] : []),
    { kind: 'select', name: 'sku', label: 'SKU', options: skuOptions(products) },
    { kind: 'select', name: 'warehouseId', label: 'Warehouse', options: warehouseOptions(warehouses) },
    {
      kind: 'number',
      name: 'systemQuantity',
      label: 'System quantity',
      hint: 'What the system believed was on hand when the count was taken. An audit records a moment, so this is stored rather than looked up live.',
    },
    { kind: 'number', name: 'countedQuantity', label: 'Counted / physical quantity', hint: 'What was actually found on the shelf. Zero or more.' },
    { kind: 'date', name: 'countedOn', label: 'Counted on' },
    { kind: 'text', name: 'countedBy', label: 'Counted by', hint: 'Initials of whoever took the count.' },
  ];

  return renderFormPage({
    title: editing ? `Edit audit ${values.id}` : 'Add audit record',
    activePath: '/audit',
    lede: editing ? 'Change the counted figures. The difference follows.' : 'Record a physical count against what the system expected.',
    note: 'There is no Difference field. It is always Counted minus System, worked out when the figures are shown, so a stored difference can never disagree with them.',
    action: editing ? '/audit/edit' : '/audit/add',
    hidden: editing ? { id: values.id } : {},
    fields,
    values,
    errors,
    submitLabel: editing ? 'Save changes' : 'Add audit record',
    cancelHref: editing ? href('/audit/view', { id: values.id }) : '/audit',
    flash,
  });
}

/**
 * The confirmation in front of deleting an audit count.
 *
 * @param {object} options
 * @returns {string}
 */
export function renderAuditDeletePage({ row, flash = null }) {
  return renderConfirmPage({
    title: `Delete audit ${row.id}?`,
    activePath: '/audit',
    lede: 'This cannot be undone within the running session.',
    flash,
    warning:
      'The count will be removed. The Discrepancies figure on the dashboard is worked out from the audit records, so it will change if this count disagreed.',
    rows: [
      { label: 'Audit ID', text: row.id },
      { label: 'SKU', text: row.sku },
      { label: 'Warehouse', text: row.warehouseName },
      { label: 'System quantity', text: String(row.systemQuantity) },
      { label: 'Counted quantity', text: String(row.countedQuantity) },
      { label: 'Difference', text: formatDifference(row.difference) },
    ],
    action: '/audit/delete',
    hidden: { id: row.id },
    confirmLabel: 'Delete audit record',
    cancelHref: href('/audit/view', { id: row.id }),
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
