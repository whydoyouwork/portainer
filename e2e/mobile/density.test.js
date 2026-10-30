// How dense the phone and tablet layout is: the key/value tables of a container's page give their label column
// only the room it needs, table cells and widgets use less padding, and buttons and fields use a compact size
// (never under the 24px that WCAG 2.2 asks for). Each check returns a list of what is wrong and is shown to fail
// on a planted fault in the same run ("planted fault" tests).

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, openView, withPage } = require('./lib/browser');
const { targetURL, VIEWPORTS } = require('./lib/config');

const { phone320, phone390, tablet767, tablet, tablet991 } = VIEWPORTS;
const BASE_URL = targetURL();
const TEST_TIMEOUT = 90000;
const CONTAINERS = '#!/1/docker/containers';

let browser;
let storageState;
let detailsHash;

before(async () => {
  browser = await launch();
  storageState = await signIn(browser, BASE_URL);
  detailsHash = await withPage(browser, storageState, VIEWPORTS.desktop1440, async (page) => {
    await openView(page, BASE_URL, CONTAINERS);
    const href = await page.locator('.datatable tbody tr a[href*="docker/containers/"]').first().getAttribute('href');
    return `#!/1/docker/containers/${href.split('/').pop()}`;
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
