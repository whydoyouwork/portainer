// Accessibility of the phone and tablet changes (WCAG 2.2 AA): the drawer can be closed by someone who cannot
// reach the toggle, keyboard focus is always visible and never hidden behind the action bar, a scrolling
// region can be scrolled with the keyboard, text has enough contrast, and the controls have names and states.
//
// Each check returns a list of what is wrong. Every one fails on the build before the fix, and the ones that
// guard against a change spreading to larger screens are shown to fail on a planted fault in the same run.

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, openView, withPage, eventually } = require('./lib/browser');
const { targetURL, VIEWPORTS } = require('./lib/config');

const { phone320, phone390, phoneLandscape, tablet, desktop1440 } = VIEWPORTS;
const PHONES = [phone320, phone390];
const BASE_URL = targetURL();
const TEST_TIMEOUT = 120000;

const TOGGLE = 'button[aria-label="Toggle Sidebar"]';
const CONTAINER = '#!/1/docker/containers';
const NETWORKS = '#!/1/docker/networks';
// Takes every focus ring away (specific enough to beat utility classes that set a ring).
const NO_RINGS = ':root body *:focus, :root body *:focus-visible { outline: none !important; box-shadow: none !important; }';

let browser;
let storageState;
let containerId;
let networkWithContainers;

before(async () => {
  browser = await launch();
  storageState = await signIn(browser, BASE_URL);
  await withPage(browser, storageState, desktop1440, async (page) => {
    await openView(page, BASE_URL, CONTAINER);
    const href = await page.locator('.datatable tbody tr a[href*="docker/containers/"]').first().getAttribute('href');
    containerId = href.split('/').pop();

    await openView(page, BASE_URL, NETWORKS);
    const hrefs = await page.$$eval('a[href*="/docker/networks/"]', (links) => links.map((a) => a.getAttribute('href')).filter((h) => /networks\/[0-9a-f]{12,}/.test(h)));
    for (const href of hrefs) {
      await openView(page, BASE_URL, href);
      if (await page.$('[data-cy="networkDetails-networkContainers"]')) {
        networkWithContainers = href;
        break;
      }
    }
  });
  assert.ok(networkWithContainers, 'no network with containers to check');
});

after(async () => {
  await browser?.close();
});

function onView(viewport, hash, fn) {
  return withPage(browser, storageState, viewport, async (page) => {
    await openView(page, BASE_URL, hash);
    return fn(page);
  });
}

// ---- helpers ------------------------------------------------------------------

// A keyboard user opens the drawer: focus the toggle and press Enter (so focus rings are shown, as they are
// for keyboard users).
async function openDrawerWithKeyboard(page) {
  await page.locator(TOGGLE).focus();
  await page.keyboard.press('Enter');
  await eventually(async () => {
    const open = await page.evaluate(() => document.getElementById('page-wrapper').classList.contains('open'));
    assert.ok(open, 'the drawer did not open');
  });
  await eventually(async () => {
    const inside = await page.evaluate(() => document.querySelector('.sidebar').contains(document.activeElement));
    assert.ok(inside, 'focus did not move into the drawer');
  });
}

async function drawerIsOpen(page) {
  return page.evaluate(() => document.getElementById('page-wrapper').classList.contains('open'));
}

// What the focused element looks like: is it a focus-visible target, and is there a ring a person can see
// (an outline or a shadow that is not transparent), and how strongly does the ring stand out from what is
// behind it. Runs in the page.
function describeFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const style = getComputedStyle(el);

  function parse(color) {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  function luminance({ r, g, b }) {
    const lin = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
  // the colour behind the element: the first opaque background up the tree
  function backdrop(node) {
    for (let n = node; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.95) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  const rings = [];
  if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) {
    const c = parse(style.outlineColor);
    if (c && c.a > 0) rings.push(c);
  }
  const shadow = /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/g;
  for (const m of style.boxShadow.matchAll(shadow)) {
    const c = parse(m[1]);
    const [x, y, blur, spread] = [m[2], m[3], m[4], m[5] || 0].map(Number);
    if (c && c.a > 0 && (x || y || blur || spread)) rings.push(c);
  }
  const bg = backdrop(el);
  return {
    name: el.getAttribute('aria-label') || el.getAttribute('data-cy') || (el.textContent || '').trim().slice(0, 30) || el.tagName,
    focusVisible: el.matches(':focus-visible'),
    rings: rings.length,
    ringContrast: rings.length ? Math.max(...rings.map((c) => contrast(c, bg))) : 0,
  };
}

function focusIndicatorProblems(focus, what) {
  if (!focus) return [`${what}: nothing has focus`];
  const problems = [];
  if (!focus.focusVisible) problems.push(`${what}: "${focus.name}" does not match :focus-visible`);
  if (focus.rings === 0) problems.push(`${what}: "${focus.name}" shows no focus ring`);
  else if (focus.ringContrast < 3) problems.push(`${what}: the focus ring of "${focus.name}" has only ${focus.ringContrast.toFixed(2)}:1 contrast`);
  return problems;
}

// ---- 1 + 2: the phone drawer can be closed, and focus starts on something visible ------------------------

const DIALOG = '.sidebar[role="dialog"]';
const CLOSE = `${DIALOG} button[aria-label="Close menu"]`;

// The open drawer has a close button, and it is the first control in it.
async function closeButtonProblems(page) {
  const problems = [];
  const info = await page.evaluate(
    ({ dialog, close }) => {
      const root = document.querySelector(dialog);
      if (!root) return { dialog: false };
      const button = root.querySelector(close.replace(dialog, '').trim());
      const first = root.querySelector('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      return { dialog: true, count: root.querySelectorAll('button[aria-label="Close menu"]').length, isFirst: !!button && first === button, visible: !!button && button.getBoundingClientRect().width > 0 };
    },
    { dialog: DIALOG, close: CLOSE }
  );
  if (!info.dialog) return ['the open drawer is not a dialog'];
  if (info.count !== 1) problems.push(`the open drawer has ${info.count} "Close menu" buttons, expected 1`);
  else {
    if (!info.visible) problems.push('the "Close menu" button is not shown');
    if (!info.isFirst) problems.push('the "Close menu" button is not the first control in the drawer');
    const box = await page.locator(CLOSE).boundingBox();
    if (box && (box.width < 43.5 || box.height < 43.5)) problems.push(`the "Close menu" button is ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  return problems;
}

// Initial focus is on a control that shows a focus ring.
async function initialFocusProblems(page) {
  const focus = await page.evaluate(describeFocus);
  return focusIndicatorProblems(focus, 'when the drawer opens');
}

describe('the phone drawer can be closed from inside it', () => {
  for (const viewport of PHONES) {
    test(`it has a Close menu button as its first control at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        assert.deepEqual(await closeButtonProblems(page), []);
      });
    });

    test(`the Close menu button closes it with a tap, and focus goes back to the toggle at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        // the page behind the drawer is inert, so the toggle cannot be reached: this is the only way out
        // for someone using a screen reader on a touch screen
        assert.equal(await page.evaluate(() => document.getElementById('content-wrapper').hasAttribute('inert')), true);
        await page.locator(CLOSE).tap();
        await eventually(async () => assert.equal(await drawerIsOpen(page), false, 'the drawer stayed open'));
        await eventually(async () => {
          const onToggle = await page.evaluate(() => document.activeElement === document.querySelector('button[aria-label="Toggle Sidebar"]'));
          assert.ok(onToggle, 'focus did not return to the toggle');
        });
      });
    });

    test(`the Close menu button closes it with the keyboard at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        // focus starts on the Close menu button, so Enter closes the drawer and goes nowhere
        await page.keyboard.press('Enter');
        await eventually(async () => assert.equal(await drawerIsOpen(page), false, 'the drawer stayed open'));
        assert.match(await page.evaluate(() => location.hash), /#!\/1\/docker\/containers$/, 'Enter followed a link instead of closing the drawer');
      });
    });

    test(`focus starts on a control with a visible ring at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        assert.deepEqual(await initialFocusProblems(page), []);
      });
    });

    // Planted fault: the ring is taken away from whatever has focus.
    test(`planted fault: a focused control without a ring is reported at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        await page.addStyleTag({ content: NO_RINGS });
        const problems = await initialFocusProblems(page);
        assert.ok(
          problems.some((p) => /no focus ring/.test(p)),
          `got: ${problems.join('; ')}`
        );
      });
    });

    test(`tapping the link of the page you are on closes it at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        await page.locator(`${DIALOG} a[href="#!/1/docker/containers"]`).first().tap();
        await eventually(async () => assert.equal(await drawerIsOpen(page), false, 'the drawer stayed open after the link of the current page was tapped'));
        assert.match(await page.evaluate(() => location.hash), /#!\/1\/docker\/containers$/);
      });
    });

    test(`tapping a link to another page still goes there and closes it at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        await page.locator(`${DIALOG} a[href="#!/home"]`).first().tap();
        await eventually(async () => assert.equal(await drawerIsOpen(page), false, 'the drawer stayed open'));
        await eventually(async () => assert.match(await page.evaluate(() => location.hash), /#!\/home/));
      });
    });
  }

  // Where the sidebar is not a drawer there is nothing to close: no button is shown or exposed.
  for (const viewport of [tablet, desktop1440]) {
    test(`no Close menu button is shown at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        if (viewport.width < 992) {
          await page.locator(TOGGLE).tap();
          await page.waitForTimeout(400);
        }
        assert.deepEqual(await visibleCloseButtons(page), []);
      });
    });
  }

  test('planted fault: a Close menu button shown on a tablet is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, CONTAINER, async (page) => {
      await page.evaluate(() => {
        const button = document.createElement('button');
        button.setAttribute('aria-label', 'Close menu');
        button.textContent = 'x';
        document.querySelector('.sidebar').prepend(button);
      });
      assert.equal((await visibleCloseButtons(page)).length, 1);
    });
  });
});

async function visibleCloseButtons(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label="Close menu"]')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
      })
      .map(() => 'a Close menu button is shown')
  );
}

// ---- 6: the toggle announces and controls the sidebar -------------------------------------------------

async function toggleProblems(page, expectOpenAfterTap) {
  const problems = [];
  const read = () =>
    page.evaluate(() => {
      const toggle = document.querySelector('button[aria-label="Toggle Sidebar"]');
      const id = toggle.getAttribute('aria-controls');
      return { expanded: toggle.getAttribute('aria-expanded'), controls: id, target: id ? !!document.getElementById(id) && document.getElementById(id).classList.contains('sidebar') : false, open: document.getElementById('page-wrapper').classList.contains('open') };
    });
  const before = await read();
  if (before.expanded !== String(before.open)) problems.push(`before a tap the toggle says aria-expanded=${before.expanded} but the sidebar is ${before.open ? 'open' : 'closed'}`);
  if (!before.controls) problems.push('the toggle has no aria-controls');
  else if (!before.target) problems.push(`aria-controls="${before.controls}" does not point at the sidebar`);
  await page.locator(TOGGLE).tap();
  await page.waitForTimeout(500);
  const after = await read();
  if (after.open !== expectOpenAfterTap) problems.push(`a tap on the toggle left the sidebar ${after.open ? 'open' : 'closed'}`);
  if (after.expanded !== String(after.open)) problems.push(`after a tap the toggle says aria-expanded=${after.expanded} but the sidebar is ${after.open ? 'open' : 'closed'}`);
  return problems;
}

describe('the sidebar toggle announces its state', () => {
  for (const viewport of PHONES) {
    test(`aria-expanded follows the drawer and aria-controls points at it at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        assert.deepEqual(await toggleProblems(page, true), []);
      });
    });
  }

  test('aria-expanded follows the rail on a tablet', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, CONTAINER, async (page) => {
      const wasOpen = await drawerIsOpen(page);
      assert.deepEqual(await toggleProblems(page, !wasOpen), []);
    });
  });

  // Planted fault: the state attribute is stuck.
  test('planted fault: a toggle whose aria-expanded does not follow the sidebar is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await page.evaluate(() => {
        const toggle = document.querySelector('button[aria-label="Toggle Sidebar"]');
        toggle.setAttribute('aria-expanded', 'false');
        new MutationObserver(() => toggle.getAttribute('aria-expanded') !== 'false' && toggle.setAttribute('aria-expanded', 'false')).observe(toggle, { attributes: true });
      });
      const problems = await toggleProblems(page, true);
      assert.ok(
        problems.some((p) => /aria-expanded/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });
});

// ---- 5: the tablet rail item does not claim a menu ------------------------------------------------------

describe('the collapsed rail item on a touch tablet', () => {
  test('announces whether its sub-menu is open, without claiming a pop-up menu', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, CONTAINER, async (page) => {
      const parent = page.locator('.sidebar button > a[data-cy$="-link"]').first();
      await parent.tap();
      await page.waitForTimeout(400);
      const attrs = await parent.evaluate((a) => ({ expanded: a.getAttribute('aria-expanded'), controls: a.getAttribute('aria-controls'), haspopup: a.getAttribute('aria-haspopup') }));
      assert.equal(attrs.expanded, 'true');
      assert.ok(attrs.controls, 'the open item has no aria-controls');
      assert.equal(attrs.haspopup, null, 'the item says it opens a menu, but it opens a list of links');
    });
  });
});

// ---- 3: the table that scrolls sideways can be scrolled with the keyboard --------------------------------

const REGION_NAME = 'Containers in network';

async function regionProblems(page) {
  const problems = [];
  const region = page.getByRole('region', { name: REGION_NAME });
  if ((await region.count()) !== 1) return [`there is no "${REGION_NAME}" region to scroll`];
  const overflow = await region.evaluate((el) => ({ scrolls: el.scrollWidth > el.clientWidth + 1, tabindex: el.tabIndex }));
  if (!overflow.scrolls) problems.push('the table does not overflow its region here, so this view cannot show a scrollable region');
  if (overflow.tabindex !== 0) problems.push(`the region is not in the tab order (tabindex ${overflow.tabindex})`);

  // reach it the way a keyboard user does
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await region.evaluate((el) => el === document.activeElement);
  }
  if (!reached) {
    problems.push('Tab does not reach the region');
    return problems;
  }
  problems.push(...focusIndicatorProblems(await page.evaluate(describeFocus), 'the scrolling region'));
  const before = await region.evaluate((el) => el.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const after = await region.evaluate((el) => el.scrollLeft);
  if (!(after > before)) problems.push(`the arrow keys do not scroll the region (scrollLeft ${before} -> ${after})`);
  return problems;
}

describe('the containers table of a network can be scrolled with the keyboard (phones)', () => {
  for (const viewport of PHONES) {
    test(`the region is named, focusable, shows a ring and scrolls with the arrow keys at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, networkWithContainers, async (page) => {
        assert.deepEqual(await regionProblems(page), []);
      });
    });
  }

  // Planted fault: the ring is taken away.
  test('planted fault: a scrolling region without a focus ring is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone320, networkWithContainers, async (page) => {
      await page.addStyleTag({ content: NO_RINGS });
      const problems = await regionProblems(page);
      assert.ok(
        problems.some((p) => /no focus ring/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });

  // From 768px the table does not scroll in a region of its own, so it adds no stop to the tab order.
  for (const viewport of [tablet, desktop1440]) {
    test(`it adds no tab stop at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, networkWithContainers, async (page) => {
        const stops = await tabStopsAround(page);
        assert.deepEqual(stops, []);
      });
    });
  }

  test('planted fault: a tab stop on the table wrapper at 768px is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, networkWithContainers, async (page) => {
      await page.evaluate(() => {
        const table = document.querySelector('[data-cy="networkDetails-networkContainers"]');
        table.parentElement.tabIndex = 0;
      });
      assert.equal((await tabStopsAround(page)).length, 1);
    });
  });
});

// A focusable element that holds the containers table and is not itself a control.
async function tabStopsAround(page) {
  return page.evaluate(() => {
    const table = document.querySelector('[data-cy="networkDetails-networkContainers"]');
    const stops = [];
    for (let el = table; el && el !== document.body; el = el.parentElement) {
      if (el.hasAttribute('tabindex') && el.tabIndex >= 0) stops.push(`${el.tagName.toLowerCase()} is a tab stop`);
    }
    return stops;
  });
}

// ---- 4: the search box on the home page is not squeezed by its clear button -----------------------------

const SEARCH = '[data-cy="home-endpointList-header-search"]';

async function searchBoxProblems(page) {
  const box = await page.locator(SEARCH).boundingBox();
  const problems = [];
  if (!box) return ['the search box is not shown'];
  // WCAG 2.5.8 asks for 24px; a search field under 100px wide cannot show what was typed
  if (box.width < 24) problems.push(`the search field is ${Math.round(box.width)}px wide, under the 24px minimum target`);
  else if (box.width < 100) problems.push(`the search field is only ${Math.round(box.width)}px wide`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`the page is ${overflow}px wider than the window`);
  return problems;
}

describe('the environment search on the home page (phones)', () => {
  for (const viewport of PHONES) {
    test(`the field is wide enough to use at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, '#!/home', async (page) => {
        assert.deepEqual(await searchBoxProblems(page), []);
      });
    });
  }

  // Planted fault: the box is squeezed back to a sliver.
  test('planted fault: a squeezed search field is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone320, '#!/home', async (page) => {
      await page.addStyleTag({ content: `${SEARCH}{width:23px !important;min-width:0 !important}` });
      assert.equal((await searchBoxProblems(page)).length, 1);
    });
  });

  // From 768px the layout is the vendor's: the search keeps its own width and does not stretch across the row.
  for (const viewport of [tablet, desktop1440]) {
    test(`the search does not stretch across its row at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, '#!/home', async (page) => {
        assert.deepEqual(await stretchedSearchProblems(page), []);
      });
    });
  }

  test('planted fault: a search stretched across its row at 768px is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, '#!/home', async (page) => {
      await page.addStyleTag({ content: `.searchBar:has(${SEARCH}){width:700px !important}` });
      assert.equal((await stretchedSearchProblems(page)).length, 1);
    });
  });
});

async function stretchedSearchProblems(page) {
  const sizes = await page.evaluate((selector) => {
    const bar = document.querySelector(selector).closest('.searchBar');
    // the whole header: the sort bar, the buttons and the search
    const row = bar.parentElement.parentElement;
    return { bar: bar.getBoundingClientRect().width, row: row.getBoundingClientRect().width };
  }, SEARCH);
  return sizes.bar > sizes.row * 0.9 ? [`the search is ${Math.round(sizes.bar)}px of a ${Math.round(sizes.row)}px row`] : [];
}

// ---- 7: the action bar never hides the field that has focus ----------------------------------------

const STICKY_VIEWS = {
  'new environment group': '#!/groups/new',
  'environment wizard': '#!/wizard/endpoints/create?envType=dockerStandalone',
};

// Tab through the view; after the page has stopped scrolling, the focused control must not lie behind the bar.
async function actionBarProblems(page) {
  const problems = [];
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(async () => {
      await new Promise((resolve) => {
        let last = -1;
        let still = 0;
        const started = performance.now();
        (function frame() {
          const y = window.scrollY;
          if (y === last) still += 1;
          else {
            still = 0;
            last = y;
          }
          if (still >= 4 || performance.now() - started > 1500) resolve();
          else requestAnimationFrame(frame);
        })();
      });
      const bar = document.querySelector('[class*="StickyFooter"][class*="actionBar"]');
      const el = document.activeElement;
      if (!bar || !el || el === document.body || bar.contains(el)) return null;
      const b = bar.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      return { name: el.getAttribute('data-cy') || el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || el.tagName, overlap: Math.round(overlap), bar: Math.round(b.height) };
    });
    if (result && result.overlap > 0 && !seen.has(result.name)) {
      seen.add(result.name);
      problems.push(`"${result.name}" is ${result.overlap}px behind the ${result.bar}px action bar`);
    }
  }
  return problems;
}

async function scrollPaddingProblems(page) {
  const padding = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
  return padding === 'auto' ? [] : [`scroll-padding-bottom is ${padding}`];
}

describe('the action bar does not hide the field that has focus (phones)', () => {
  for (const [name, hash] of Object.entries(STICKY_VIEWS)) {
    test(`${name} at ${phone320.name}`, { timeout: TEST_TIMEOUT * 2 }, async () => {
      await onView(phone320, hash, async (page) => {
        assert.deepEqual(await actionBarProblems(page), []);
      });
    });
  }

  // Planted fault: the scroll padding is taken away again.
  test('planted fault: a field behind the action bar is reported', { timeout: TEST_TIMEOUT * 2 }, async () => {
    await onView(phone320, STICKY_VIEWS['new environment group'], async (page) => {
      await page.addStyleTag({ content: 'html { scroll-padding-bottom: 0 !important; }' });
      const problems = await actionBarProblems(page);
      assert.ok(problems.length > 0, 'a field behind the bar was not reported');
    });
  });

  // Planted fault: the padding applied at every width, as an unfenced rule would.
  test('planted fault: scroll padding at 768px is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, STICKY_VIEWS['new environment group'], async (page) => {
      await page.addStyleTag({ content: 'html { scroll-padding-bottom: 7rem; }' });
      assert.equal((await scrollPaddingProblems(page)).length, 1);
    });
  });

  // Desktop and tablet keep the vendor's behaviour: no scroll padding is added.
  for (const viewport of [tablet, desktop1440]) {
    test(`no scroll padding is added at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, STICKY_VIEWS['new environment group'], async (page) => {
        assert.deepEqual(await scrollPaddingProblems(page), []);
      });
    });
  }
});

// ---- 8: the "Business Feature" badge has enough contrast on phones -------------------------------------------

const BADGE = '.be-indicator-container > .limited-be-link a.be-indicator';

// The contrast of the badge text against what is behind it, and the text colour, measured in the page.
function badgeContrast(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  function parse(color) {
    const m = color.match(/rgba?\(([^)]+)\)/);
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  function lum({ r, g, b }) {
    const l = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  }
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (let n = el; n; n = n.parentElement) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c.a > 0.95) {
      bg = c;
      break;
    }
  }
  const fg = parse(getComputedStyle(el).color);
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  const label = el.querySelector('.be-indicator-label');
  return { color: getComputedStyle(label || el).color, ratio: (hi + 0.05) / (lo + 0.05) };
}

describe('the Business Feature badge on phones', () => {
  for (const viewport of PHONES) {
    test(`its text reaches 4.5:1 at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, '#!/settings', async (page) => {
        const result = await page.evaluate(badgeContrast, BADGE);
        assert.ok(result, 'no Business Feature badge on the settings page');
        assert.ok(result.ratio >= 4.5, `the badge text is ${result.color}, ${result.ratio.toFixed(2)}:1`);
      });
    });
  }

  // Planted fault: the vendor's grey put back.
  test('planted fault: the pale grey badge text is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, '#!/settings', async (page) => {
      await page.addStyleTag({ content: `${BADGE}, ${BADGE} * { color: rgb(152, 162, 179) !important }` });
      const result = await page.evaluate(badgeContrast, BADGE);
      assert.ok(result.ratio < 4.5, `${result.ratio}`);
    });
  });

  // The colour change is for phones only: from 768px up the badge keeps the vendor's colour.
  for (const viewport of [tablet, desktop1440, VIEWPORTS.desktop1920]) {
    test(`it keeps the vendor's colour at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, '#!/settings', async (page) => {
        const result = await page.evaluate(badgeContrast, '.be-indicator-container .be-indicator, .be-indicator');
        assert.ok(result, 'no Business Feature badge on the settings page');
        assert.equal(result.color, 'rgb(152, 162, 179)');
      });
    });
  }
});

// ---- 9: breadcrumbs are a navigation landmark ---------------------------------------------------------------

async function breadcrumbSemanticsProblems(page) {
  const problems = [];
  const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
  if ((await nav.count()) !== 1) return ['the breadcrumbs are not a navigation landmark named "Breadcrumb"'];
  const home = nav.getByRole('link', { name: 'Home' });
  if ((await home.count()) !== 1) problems.push('the home link of the breadcrumbs has no accessible name "Home"');
  const current = nav.locator('[aria-current="page"]');
  if ((await current.count()) !== 1) problems.push(`${await current.count()} crumbs are marked as the current page, expected 1`);
  else {
    const crumbs = await nav.evaluate((el) => {
      const items = [...el.querySelectorAll('[aria-current="page"]')];
      const last = el.querySelector('[data-cy="breadcrumb-home"]') && [...el.querySelectorAll(':scope > span')].pop();
      return { markedInLast: !!last && items.every((i) => last.contains(i)), text: items[0].textContent.trim() };
    });
    if (!crumbs.markedInLast) problems.push('the crumb marked as the current page is not the last one');
    if (!crumbs.text) problems.push('the current-page crumb is empty');
  }
  return problems;
}

describe('breadcrumbs for assistive technology', () => {
  for (const viewport of [phone320, phone390, phoneLandscape, tablet, desktop1440]) {
    test(`a navigation landmark, a named home link and the current page at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, `#!/1/docker/containers/${containerId}`, async (page) => {
        assert.deepEqual(await breadcrumbSemanticsProblems(page), []);
        const current = await page.locator('nav[aria-label="Breadcrumb"] [aria-current="page"]').first().textContent();
        assert.ok(current.trim().length > 0);
      });
    });
  }

  // Planted fault: the landmark's name is lost and the home link goes back to an icon with no name.
  test('planted fault: an unnamed home link and a missing current page are reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, `#!/1/docker/containers/${containerId}`, async (page) => {
      await page.evaluate(() => {
        document.querySelector('[data-cy="breadcrumb-home"]').removeAttribute('aria-label');
        document.querySelector('nav[aria-label="Breadcrumb"] [aria-current]')?.removeAttribute('aria-current');
        document.querySelectorAll('nav[aria-label="Breadcrumb"] [aria-current]').forEach((n) => n.removeAttribute('aria-current'));
      });
      const problems = await breadcrumbSemanticsProblems(page);
      assert.ok(problems.length >= 2, `got: ${problems.join('; ')}`);
    });
  });
});

// ---- 10: the version button in the drawer is big enough to tap ------------------------------------------------

const VERSION = '[data-cy="portainerSidebar-versionNumber"]';

describe('the version button in the phone drawer', () => {
  for (const viewport of PHONES) {
    test(`is at least 24px to tap at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        const box = await page.locator(VERSION).boundingBox();
        assert.ok(box, 'the version button is not shown in the open drawer');
        assert.ok(box.width >= 24 && box.height >= 24, `the version button is ${Math.round(box.width)}x${Math.round(box.height)}`);
      });
    });
  }

  // From 768px the footer is the vendor's: the button keeps its text-sized box.
  test('it keeps the vendor size on the expanded sidebar at 1440', { timeout: TEST_TIMEOUT }, async () => {
    await onView(desktop1440, CONTAINER, async (page) => {
      const box = await page.locator(VERSION).boundingBox();
      assert.ok(box, 'the version button is not shown');
      assert.ok(box.height < 24, `the version button grew to ${Math.round(box.height)}px at the desktop size`);
    });
  });
});
