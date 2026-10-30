// How dense the phone and tablet layout is: the key/value tables of a container's page give their label column
// only the room it needs, table cells and widgets use less padding, and buttons and fields use a compact size
// (never under the 24px that WCAG 2.2 asks for). Each check returns a list of what is wrong and is shown to fail
// on a planted fault in the same run ("planted fault" tests).

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, openView, withPage, settle } = require('./lib/browser');
const { targetURL, VIEWPORTS } = require('./lib/config');

const { phone320, phone390, tablet767, tablet, tablet991 } = VIEWPORTS;
const BASE_URL = targetURL();
const TEST_TIMEOUT = 90000;
const CONTAINERS = '#!/1/docker/containers';

let browser;
let storageState;
let detailsHash;
let imageHash;

before(async () => {
  browser = await launch();
  storageState = await signIn(browser, BASE_URL);
  detailsHash = await withPage(browser, storageState, VIEWPORTS.desktop1440, async (page) => {
    await openView(page, BASE_URL, CONTAINERS);
    const href = await page.locator('.datatable tbody tr a[href*="docker/containers/"]').first().getAttribute('href');
    return `#!/1/docker/containers/${href.split('/').pop()}`;
  });
  imageHash = await withPage(browser, storageState, VIEWPORTS.desktop1440, async (page) => {
    await openView(page, BASE_URL, '#!/1/docker/images');
    const href = await page.locator('a[href*="docker/images/sha256"]').first().getAttribute('href');
    return `#!/1/docker/images/${href.split('/').pop()}`;
  });
});

after(async () => {
  await browser?.close();
});

function onDetails(viewport, fn) {
  return withPage(browser, storageState, viewport, async (page) => {
    await openView(page, BASE_URL, detailsHash);
    await page.waitForSelector('[data-cy="container-status-table"]');
    return fn(page);
  });
}

// ---- in-page measurements (these run inside the browser) ------------------

// The label column of the "Container status" table as a percentage of the table, and how many lines each value takes.
function measureStatusTable() {
  const table = document.querySelector('[data-cy="container-status-table"]');
  const row = (label) => [...table.rows].find((r) => r.cells[0].textContent.trim().toLowerCase().startsWith(label));
  const lines = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  };
  const width = table.getBoundingClientRect().width;
  return {
    labelPct: (table.rows[0].cells[0].getBoundingClientRect().width / width) * 100,
    lines: { id: lines(row('id').cells[1]), status: lines(row('status').cells[1]), created: lines(row('created').cells[1]), 'start time': lines(row('start time').cells[1]) },
  };
}

// Padding (in px) of a value cell of the status table, of the first widget body with padding, and of the header.
function measurePadding() {
  const px = (v) => parseFloat(v);
  const cell = document.querySelector('[data-cy="container-status-table"]').rows[1].cells[1];
  const cs = getComputedStyle(cell);
  const body = [...document.querySelectorAll('.widget-body:not(.no-padding)')].find((b) => b.getBoundingClientRect().width > 0);
  const header = document.querySelector('.widget .widget-header');
  return {
    cellTop: px(cs.paddingTop),
    cellBottom: px(cs.paddingBottom),
    cellLeft: px(cs.paddingLeft),
    bodyLeft: px(getComputedStyle(body).paddingLeft),
    headerLeft: px(getComputedStyle(header).paddingLeft),
  };
}

// The height of every Bootstrap button of the page that is not in a table or the sidebar, with its text size.
function measureButtons() {
  const buttons = [...document.querySelectorAll('.btn:not(.btn-link):not(.btn-xs):not(.btn-none)')].filter(
    (b) => !b.closest('table, .sidebar') && b.getBoundingClientRect().width > 0
  );
  return buttons.map((b) => ({ label: (b.textContent || b.getAttribute('aria-label') || b.className).trim().slice(0, 20), height: b.getBoundingClientRect().height, width: b.getBoundingClientRect().width, fontSize: parseFloat(getComputedStyle(b).fontSize) }));
}

// "Update" (the restart policy's button) sits in a narrow table cell: its word must stay whole.
function measureCellButton() {
  const button = [...document.querySelectorAll('table .btn')].find((b) => b.textContent.trim() === 'Update');
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function measureField() {
  const field = [...document.querySelectorAll('.form-control, select')].find((f) => !f.closest('table') && f.getBoundingClientRect().width > 0);
  const rect = field.getBoundingClientRect();
  return { height: rect.height, fontSize: parseFloat(getComputedStyle(field).fontSize) };
}

// ---- checks (each returns a list of problems) ------------------------------

async function statusTableProblems(page, { maxLabelPct, maxLines }) {
  const m = await page.evaluate(measureStatusTable);
  const problems = [];
  if (m.labelPct > maxLabelPct) problems.push(`the label column takes ${m.labelPct.toFixed(1)}% of the table, over ${maxLabelPct}%`);
  for (const [name, max] of Object.entries(maxLines)) {
    if (m.lines[name] > max) problems.push(`the ${name} value takes ${m.lines[name]} lines, over ${max}`);
  }
  return problems;
}

async function buttonProblems(page, { min, max }) {
  const problems = [];
  const buttons = await page.evaluate(measureButtons);
  if (buttons.length < 5) problems.push(`found only ${buttons.length} buttons to measure`);
  for (const b of buttons) {
    if (b.height < min || b.height > max) problems.push(`"${b.label}" is ${Math.round(b.height)}px tall, outside ${min}-${max}px`);
    if (b.width < 24) problems.push(`"${b.label}" is ${Math.round(b.width)}px wide, under the 24px of WCAG 2.2`);
    if (b.fontSize > 14) problems.push(`"${b.label}" has ${b.fontSize}px text, over 14px`);
  }
  return problems;
}

// ---- the key/value tables on a phone ------------------------------------------

describe('the key/value tables give their label column only what it needs', () => {
  // Mutation: remove the `width: 1%` rule of bootstrap-mobile.css (the label column then takes its widest cell, which
  // is the webhook switch and badge: 59% of the table at 390px, 66% at 320px), or let the badge keep `nowrap`.
  test('at 390px the label column is at most 40% and the container ID takes at most 3 lines', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      assert.deepEqual(await statusTableProblems(page, { maxLabelPct: 40, maxLines: { id: 3, status: 2, created: 1, 'start time': 1 } }), []);
    });
  });

  test('at 320px the label column is at most 45% and the container ID takes at most 4 lines', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone320, async (page) => {
      assert.deepEqual(await statusTableProblems(page, { maxLabelPct: 45, maxLines: { id: 4, created: 1, 'start time': 1 } }), []);
    });
  });

  // Planted fault: the label column at half the table, as the unchanged build has it.
  test('planted fault: a label column of 60% is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      await page.addStyleTag({ content: '[data-cy="container-status-table"] td:first-child { width: 60% !important; }' });
      const problems = await statusTableProblems(page, { maxLabelPct: 40, maxLines: { id: 3, status: 2, created: 1, 'start time': 1 } });
      assert.ok(problems.some((p) => /label column/.test(p)), `got: ${problems.join('; ')}`);
      assert.ok(problems.some((p) => /ID value/i.test(p)), `got: ${problems.join('; ')}`);
    });
  });

  // Mutation: remove `.widget-body td .btn { overflow-wrap: normal }`: "Update" breaks into letters and is 70px tall.
  test('a button in a narrow cell keeps its word whole at 390px', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      const button = await page.evaluate(measureCellButton);
      assert.ok(button, 'no Update button in the page');
      assert.ok(button.height <= 40, `the button is ${Math.round(button.width)}x${Math.round(button.height)}: its label is broken into letters`);
    });
  });

  test('planted fault: a button broken into letters is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      await page.addStyleTag({ content: 'table .btn { overflow-wrap: anywhere !important; width: 40px !important; }' });
      const button = await page.evaluate(measureCellButton);
      assert.ok(button.height > 40, `the planted button is ${Math.round(button.height)}px tall`);
    });
  });

  // The tablet is wide enough: its tables keep the vendor's layout.
  test('at 768px the label column is not narrowed', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(tablet, async (page) => {
      const m = await page.evaluate(measureStatusTable);
      assert.ok(m.labelPct > 40, `the label column takes ${m.labelPct.toFixed(1)}%`);
    });
  });
});

// ---- cells and widgets use less padding on a phone, the vendor's below it -----------------------------------------

describe('table cells and widgets are tighter on a phone', () => {
  // Mutation: remove the padding rules of bootstrap-mobile.css (the vendor's 8px cells and 20px widgets come back).
  test('at 390px cells use 6px above and below, and widgets 14px at the sides', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      const p = await page.evaluate(measurePadding);
      assert.ok(p.cellTop <= 6 && p.cellBottom <= 6, `a cell has ${p.cellTop}px above and ${p.cellBottom}px below`);
      assert.ok(p.cellLeft <= 8, `a cell has ${p.cellLeft}px at its left`);
      assert.ok(p.bodyLeft <= 14, `a widget body has ${p.bodyLeft}px of padding`);
      assert.ok(p.headerLeft <= 14, `a widget header has ${p.headerLeft}px of padding`);
    });
  });

  for (const viewport of [tablet767, tablet, tablet991]) {
    // 767 is still a phone; from 768 up the vendor's padding stays.
    const phone = viewport.width < 768;
    test(`at ${viewport.name} the padding is ${phone ? "the phone's" : "the vendor's"}`, { timeout: TEST_TIMEOUT }, async () => {
      await onDetails(viewport, async (page) => {
        const p = await page.evaluate(measurePadding);
        if (phone) assert.ok(p.bodyLeft <= 14 && p.cellTop <= 6, JSON.stringify(p));
        else assert.ok(p.bodyLeft === 20 && p.cellTop === 8 && p.headerLeft === 20, JSON.stringify(p));
      });
    });
  }

  test('planted fault: the vendor padding is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      await page.addStyleTag({ content: '.widget .widget-body, .widget .widget-header { padding: 20px !important; } td { padding: 8px !important; }' });
      const p = await page.evaluate(measurePadding);
      assert.ok(p.bodyLeft > 14 && p.cellTop > 6, JSON.stringify(p));
    });
  });
});

// ---- buttons and fields use the compact size on touch screens ---------------------------------------------------

describe('buttons and fields use the compact size on touch screens', () => {
  // Mutation: put back the 44px `min-height` of the earlier stylesheet.
  for (const viewport of [phone320, phone390, tablet767, tablet, tablet991]) {
    test(`buttons are 30-34px tall with 13px text at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onDetails(viewport, async (page) => {
        assert.deepEqual(await buttonProblems(page, { min: 30, max: 34 }), []);
      });
    });
  }

  test('fields are 36-40px tall with 16px text at 390px', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      const f = await page.evaluate(measureField);
      assert.ok(f.height >= 35.5 && f.height <= 40.5, `a field is ${f.height}px tall`);
      assert.equal(f.fontSize, 16, 'a field must use 16px text, or iOS zooms the page when one is focused');
    });
  });

  test('planted fault: 44px buttons are reported', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      await page.addStyleTag({ content: '.btn { min-height: 44px !important; }' });
      assert.ok((await buttonProblems(page, { min: 30, max: 34 })).length >= 5);
    });
  });

  test('planted fault: 20px buttons are reported', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone390, async (page) => {
      await page.addStyleTag({ content: '.btn { min-height: 0 !important; padding: 0 !important; min-width: 0 !important; height: 20px !important; width: 20px !important; }' });
      const problems = await buttonProblems(page, { min: 30, max: 34 });
      assert.ok(problems.some((p) => /WCAG/.test(p)), `got: ${problems.join('; ')}`);
    });
  });

  // A mouse at a tablet width keeps the vendor's controls: the compact size is for touch screens.
  test('a mouse at 768px keeps the vendor button size (30px for a small button)', { timeout: TEST_TIMEOUT }, async () => {
    const context = await browser.newContext({ storageState, viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await openView(page, BASE_URL, detailsHash);
      await page.waitForSelector('[data-cy="container-status-table"]');
      const buttons = await page.evaluate(measureButtons);
      assert.ok(buttons.length >= 5);
      for (const b of buttons) assert.ok(Math.abs(b.height - 30) < 1.5 && b.fontSize === 12, `"${b.label}" is ${b.height}px tall with ${b.fontSize}px text`);
    } finally {
      await context.close();
    }
  });
});

// ---- below 360px the label column keeps every word whole ----------------------------------------------------------

const phone340 = { name: 'phone-340x700', width: 340, height: 700, mobile: true };
const phone359 = { name: 'phone-359x700', width: 359, height: 700, mobile: true };
const LABEL_CELL = '.widget-body table.table:not(.table-responsive table):not(:has(> thead)) > tbody > tr > td:first-child';

// The words of the label column of every key/value table of the page that are set on more than one line (a word
// cut in two), and how many label cells were measured.
function measureLabelWords(selector) {
  const cells = [...document.querySelectorAll(selector)].filter((cell) => !cell.closest('td table') && cell.getClientRects().length > 0);
  const broken = [];
  for (const cell of cells) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.textContent.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (lines.size > 1) broken.push(`"${match[0]}" is cut over ${lines.size} lines in a cell ${Math.round(cell.getBoundingClientRect().width)}px wide`);
      }
    }
  }
  return { cells: cells.length, broken, pageWidth: document.documentElement.scrollWidth, window: window.innerWidth };
}

async function labelWordProblems(page) {
  const m = await page.evaluate(measureLabelWords, LABEL_CELL);
  const problems = [...m.broken];
  if (m.cells < 3) problems.push(`found only ${m.cells} label cells to measure`);
  if (m.pageWidth > m.window) problems.push(`the page is ${m.pageWidth}px wide in a ${m.window}px window`);
  return problems;
}

describe('the label column of a key/value table keeps every word whole on the narrowest phones', () => {
  // Mutation: put back the 6rem floor for widths under 360px (as in 5be42f2): "Container", "webhook", "Business",
  // "Feature", "configuration" and "ENTRYPOINT" are cut in two.
  for (const viewport of [phone320, phone340, phone359]) {
    test(`a container's page at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onDetails(viewport, async (page) => {
        assert.deepEqual(await labelWordProblems(page), []);
      });
    });

    test(`an image's page at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await withPage(browser, storageState, viewport, async (page) => {
        await openView(page, BASE_URL, imageHash);
        await page.waitForSelector('.widget-body table');
        assert.deepEqual(await labelWordProblems(page), []);
      });
    });
  }

  // Planted fault: a label column squeezed to 3rem, with the vendor's word breaking.
  test('planted fault: a word cut in two is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onDetails(phone320, async (page) => {
      await page.addStyleTag({
        content: `:root:root:root body ${LABEL_CELL} { min-width: 3rem !important; width: 3rem !important; } :root:root:root body ${LABEL_CELL}, :root:root:root body ${LABEL_CELL} * { overflow-wrap: anywhere !important; word-break: break-word !important; }`,
      });
      const problems = await labelWordProblems(page);
      assert.ok(problems.some((p) => /is cut over/.test(p)), `got: ${problems.join('; ')}`);
    });
  });
});

// ---- the quick actions of a table row are a touch target on touch screens --------------------------------------

// The five icon links of the first row of the containers list (logs, inspect, stats, exec, attach: a running container
// has all of them): the size of each link, of the icon in it, and whether two of them overlap.
function measureQuickActions() {
  const links = [
    ...document.querySelectorAll(
      '[data-cy^="container-logs-"], [data-cy^="container-inspect-"], [data-cy^="container-stats-"], [data-cy^="container-exec-"], [data-cy^="container-attach-"]'
    ),
  ];
  const row = links[0] && links[0].closest('tr');
  const mine = links
    .filter((l) => l.closest('tr') === row)
    .map((l) => ({ rect: l.getBoundingClientRect(), icon: l.querySelector('svg').getBoundingClientRect(), name: l.getAttribute('data-cy').replace(/-[0-9a-f]{64}$/, '') }));
  const overlaps = [];
  for (let i = 0; i < mine.length; i += 1) {
    for (let j = i + 1; j < mine.length; j += 1) {
      const a = mine[i].rect;
      const b = mine[j].rect;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(`${mine[i].name} and ${mine[j].name}`);
    }
  }
  return {
    count: mine.length,
    sizes: mine.map((l) => ({ name: l.name, w: l.rect.width, h: l.rect.height, iconW: l.icon.width, iconH: l.icon.height })),
    overlaps,
    pageWidth: document.documentElement.scrollWidth,
    window: window.innerWidth,
  };
}

async function quickActionProblems(page) {
  const m = await page.evaluate(measureQuickActions);
  const problems = [];
  if (m.count < 5) problems.push(`found only ${m.count} quick actions in the first row`);
  for (const l of m.sizes) {
    if (l.w < 24 || l.h < 24) problems.push(`"${l.name}" is ${Math.round(l.w)}x${Math.round(l.h)}, under the 24x24 of WCAG 2.2`);
    if (Math.round(l.iconW) !== 13 || Math.round(l.iconH) !== 13) problems.push(`the icon of "${l.name}" is drawn ${l.iconW}x${l.iconH} instead of 13x13`);
  }
  problems.push(...m.overlaps.map((o) => `${o} overlap`));
  if (m.pageWidth > m.window) problems.push(`the page is ${m.pageWidth}px wide in a ${m.window}px window`);
  return problems;
}

describe('the quick actions of the containers list are touch targets', () => {
  function onList(viewport, fn) {
    return withPage(browser, storageState, viewport, async (page) => {
      await openView(page, BASE_URL, CONTAINERS);
      return fn(page);
    });
  }

  // Mutation: remove the `.root a` rule of ContainerQuickActions.module.css (as in 5be42f2): the links are the 13x13 of
  // their icons, and the 24px circles around them overlap.
  for (const viewport of [phone320, phone390, tablet, tablet991]) {
    test(`each link is at least 24x24 and its icon is still 13x13 at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onList(viewport, async (page) => {
        assert.deepEqual(await quickActionProblems(page), []);
      });
    });
  }

  test('planted fault: 13px links are reported', { timeout: TEST_TIMEOUT }, async () => {
    await onList(phone390, async (page) => {
      await page.addStyleTag({ content: ':root:root:root body [data-cy^="container-"] { display: inline !important; min-width: 0 !important; min-height: 0 !important; }' });
      const problems = await quickActionProblems(page);
      assert.ok(
        problems.some((p) => /under the 24x24/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });

  // A mouse at a tablet width and a desktop keep the vendor's 13px links.
  // Mutation: take the `pointer: coarse` or the width condition off the rule.
  test('a mouse at 800px keeps the vendor size', { timeout: TEST_TIMEOUT }, async () => {
    const context = await browser.newContext({ storageState, viewport: { width: 800, height: 900 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await openView(page, BASE_URL, CONTAINERS);
      const m = await page.evaluate(measureQuickActions);
      assert.ok(m.count >= 5);
      for (const l of m.sizes) assert.ok(Math.round(l.w) === 13 && Math.round(l.h) <= 20, `"${l.name}" is ${l.w}x${l.h}`);
    } finally {
      await context.close();
    }
  });

  test('a desktop keeps the vendor size', { timeout: TEST_TIMEOUT }, async () => {
    await onList(VIEWPORTS.desktop1440, async (page) => {
      const m = await page.evaluate(measureQuickActions);
      assert.ok(m.count >= 5);
      for (const l of m.sizes) assert.ok(Math.round(l.w) === 13 && Math.round(l.h) <= 20, `"${l.name}" is ${l.w}x${l.h}`);
    });
  });
});

// ---- the radio buttons of a form are not crowded by the next one on touch screens --------------------------------

// For each radio button of the console setting: the 24px circle centred on it must not reach the line of another
// radio button (WCAG 2.2, target size: the spacing exception for a target under 24px).
function measureConsoleRadios() {
  const radios = [...document.querySelectorAll('input[name="container_console"]')];
  const labels = radios.map((r) => r.closest('label'));
  const crowded = [];
  radios.forEach((radio, i) => {
    const r = radio.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    labels.forEach((label, j) => {
      if (i === j) return;
      const b = label.getBoundingClientRect();
      const dx = Math.max(b.left - cx, 0, cx - b.right);
      const dy = Math.max(b.top - cy, 0, cy - b.bottom);
      if (Math.hypot(dx, dy) < 12) crowded.push(`the circle of radio ${i + 1} reaches the line of radio ${j + 1}`);
    });
  });
  return { count: radios.length, crowded, size: radios[0] && radios[0].getBoundingClientRect().width, secondLabelHeight: labels[1] && labels[1].getBoundingClientRect().height };
}

async function openConsoleSettings(page) {
  await openView(page, BASE_URL, '#!/1/docker/containers/new');
  await page.locator('a:has-text("Commands")').first().click();
  await page.waitForSelector('input[name="container_console"]');
  await settle(page);
}

describe('the console radio buttons of the new container form', () => {
  // Mutation: remove the `.radio-inline` rule of bootstrap-mobile.css (as in 5be42f2): the lines are 27px tall and the
  // circle of each button reaches the next one's line.
  for (const viewport of [phone320, phone390, tablet, tablet991]) {
    test(`no radio button is crowded by the next one at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await withPage(browser, storageState, viewport, async (page) => {
        await openConsoleSettings(page);
        const m = await page.evaluate(measureConsoleRadios);
        assert.equal(m.count, 4);
        assert.deepEqual(m.crowded, []);
        assert.equal(Math.round(m.size), 13, 'the radio button keeps its drawn size');
      });
    });
  }

  test('planted fault: lines of 27px are reported', { timeout: TEST_TIMEOUT }, async () => {
    await withPage(browser, storageState, phone390, async (page) => {
      await openConsoleSettings(page);
      await page.addStyleTag({ content: ':root:root:root body label.radio-inline { min-height: 0 !important; }' });
      const m = await page.evaluate(measureConsoleRadios);
      assert.ok(m.crowded.length > 0, 'a crowded radio button was not reported');
    });
  });

  // The vendor's lines stay for a mouse and a desktop.
  test('a desktop keeps the vendor line height', { timeout: TEST_TIMEOUT }, async () => {
    await withPage(browser, storageState, VIEWPORTS.desktop1440, async (page) => {
      await openConsoleSettings(page);
      const m = await page.evaluate(measureConsoleRadios);
      assert.ok(m.secondLabelHeight < 30, `a line is ${m.secondLabelHeight}px tall`);
    });
  });
});
