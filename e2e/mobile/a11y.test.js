// Accessibility of the phone and tablet changes (WCAG 2.2 AA): the drawer can be closed by someone who cannot
// reach the toggle, keyboard focus is always visible and never hidden behind the action bar, a scrolling
// region can be scrolled with the keyboard, text has enough contrast, and the controls have names and states.
//
// Each check returns a list of what is wrong. Every one fails on the build before the fix, and the ones that
// guard against a change spreading to larger screens are shown to fail on a planted fault in the same run.

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, openView, withPage, eventually } = require('./lib/browser');
const { findOffScreen } = require('./lib/measure');
const { comparePng } = require('./lib/pixels');
const { targetURL, VIEWPORTS } = require('./lib/config');

const { phone320, phone390, phoneLandscape, phoneLandscapeShort, phoneLandscapeTiny, tablet, tablet991, desktop992, desktop1440 } = VIEWPORTS;
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
  // the colour behind the element: the first opaque background up the tree from whatever is painted just outside its
  // edge (a control laid over a panel is not inside it in the tree), or from the element's own parents
  function backdrop(node) {
    const r = node.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const side = r.left >= 2 ? r.left - 1 : r.right + 1;
    const under = document.elementsFromPoint(side, y).find((e) => e !== node && !node.contains(e) && !e.contains(node));
    for (let n = under || node; n; n = n.parentElement) {
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
    if (box && (box.width < 35.5 || box.height < 35.5 || box.width > 40.5 || box.height > 40.5)) problems.push(`the "Close menu" button is not 36px, it is ${Math.round(box.width)}x${Math.round(box.height)}`);
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

// Every view with a sticky action bar, for the sizes where the bar is a touch tablet's (or phone's) fixed footer.
const ALL_STICKY_VIEWS = {
  'new environment group': '#!/groups/new',
  'edit environment group': '#!/groups/1',
  'new GitOps source': '#!/gitops/sources/new',
  'environment wizard (Docker standalone)': '#!/wizard/endpoints/create?envType=dockerStandalone',
  'environment wizard (Docker Swarm)': '#!/wizard/endpoints/create?envType=dockerSwarm',
  'environment wizard (Podman)': '#!/wizard/endpoints/create?envType=podman',
  'environment wizard (Kubernetes)': '#!/wizard/endpoints/create?envType=kubernetes',
  'environment wizard (Azure ACI)': '#!/wizard/endpoints/create?envType=aci',
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
      // the sidebar rail is beside the bar, not under it
      if (!bar || !el || el === document.body || bar.contains(el) || el.closest('.sidebar')) return null;
      const b = bar.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const across = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const overlap = across > 0 ? Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) : 0;
      return { name: el.getAttribute('data-cy') || el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || el.tagName, overlap: Math.round(overlap), bar: Math.round(b.height) };
    });
    if (result && result.overlap > 0 && !seen.has(result.name)) {
      seen.add(result.name);
      problems.push(`"${result.name}" is ${result.overlap}px behind the ${result.bar}px action bar`);
    }
  }
  return problems;
}

async function scrollPaddingProblems(page, expected) {
  const padding = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
  if (expected) return padding === 'auto' ? ['scroll-padding-bottom is auto, so the bar can hide the focused field'] : [];
  return padding === 'auto' ? [] : [`scroll-padding-bottom is ${padding}`];
}

describe('the action bar does not hide the field that has focus (phones and touch tablets)', () => {
  for (const [name, hash] of Object.entries(STICKY_VIEWS)) {
    test(`${name} at ${phone320.name}`, { timeout: TEST_TIMEOUT * 2 }, async () => {
      await onView(phone320, hash, async (page) => {
        assert.deepEqual(await actionBarProblems(page), []);
      });
    });
  }

  // A phone on its side is 768px or wider, so it has the tablet's rules: the bar is ~64px there, and with no scroll
  // padding the focused field was left fully behind it on every view that has one.
  // Mutation: the scroll padding stops at 767px (as in 16e704c) - the planted fault below shows the detector fails
  // when the padding is missing.
  for (const [name, hash] of Object.entries(ALL_STICKY_VIEWS)) {
    test(`${name} at ${phoneLandscape.name}`, { timeout: TEST_TIMEOUT * 2 }, async () => {
      await onView(phoneLandscape, hash, async (page) => {
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

  test('planted fault: a field behind the action bar is reported on a phone on its side', { timeout: TEST_TIMEOUT * 2 }, async () => {
    await onView(phoneLandscape, STICKY_VIEWS['new environment group'], async (page) => {
      await page.addStyleTag({ content: 'html { scroll-padding-bottom: 0 !important; }' });
      const problems = await actionBarProblems(page);
      assert.ok(problems.length > 0, 'a field behind the bar was not reported');
    });
  });

  // Tablets and touch screens up to 991px get the padding; from 992px the vendor's layout has none.
  for (const viewport of [tablet, tablet991, phoneLandscape]) {
    test(`scroll padding is added at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, STICKY_VIEWS['new environment group'], async (page) => {
        assert.deepEqual(await scrollPaddingProblems(page, true), []);
      });
    });
  }

  // Planted fault: the padding applied at every width, as an unfenced rule would.
  test('planted fault: scroll padding at 1440px is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(desktop1440, STICKY_VIEWS['new environment group'], async (page) => {
      await page.addStyleTag({ content: 'html { scroll-padding-bottom: 7rem; }' });
      assert.equal((await scrollPaddingProblems(page, false)).length, 1);
    });
  });

  // Planted fault: the padding missing on a tablet is reported too.
  test('planted fault: no scroll padding at 768px is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, STICKY_VIEWS['new environment group'], async (page) => {
      await page.addStyleTag({ content: 'html { scroll-padding-bottom: auto !important; }' });
      assert.equal((await scrollPaddingProblems(page, true)).length, 1);
    });
  });

  // Desktop keeps the vendor's behaviour: no scroll padding is added.
  for (const viewport of [desktop992, desktop1440]) {
    test(`no scroll padding is added at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, STICKY_VIEWS['new environment group'], async (page) => {
        assert.deepEqual(await scrollPaddingProblems(page, false), []);
      });
    });
  }
});

// ---- 8: the "Business Feature" badge has enough contrast on phones -------------------------------------------

// Every Business Feature badge: the one beside a locked switch, and the one on a locked panel.
const BADGE = 'a.be-indicator';
const BADGE_VIEWS = { settings: '#!/settings', 'add container': '#!/1/docker/containers/new' };

// The contrast of each shown badge's text against what is behind it, and the text colour, measured in the page.
function badgeContrasts(selector) {
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
  return [...document.querySelectorAll(selector)]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => {
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.a > 0.95) {
          bg = c;
          break;
        }
      }
      const label = el.querySelector('.be-indicator-label') || el;
      const fg = parse(getComputedStyle(label).color);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return { color: getComputedStyle(label).color, border: getComputedStyle(el).borderTopColor, ratio: (hi + 0.05) / (lo + 0.05), locked: !!el.closest('.limited-be-link') };
    });
}

function badgeProblems(badges, what) {
  const problems = [];
  if (badges.length === 0) problems.push(`${what}: no Business Feature badge is shown`);
  badges.forEach((b, i) => {
    if (b.ratio < 4.5) problems.push(`${what}: badge ${i + 1}${b.locked ? ' (locked panel)' : ' (switch)'} text is ${b.color}, ${b.ratio.toFixed(2)}:1`);
  });
  return problems;
}

async function setTheme(page, theme) {
  // the attribute the application itself sets on <html>; the stored theme preference is not touched
  await page.evaluate((t) => (t === 'light' ? document.documentElement.removeAttribute('theme') : document.documentElement.setAttribute('theme', t)), theme);
  await page.waitForTimeout(250);
}

describe('the Business Feature badge on phones and tablets', () => {
  // Mutation: the badge rule covers only the locked panel's badge (as in 16e704c), so the badge beside a switch
  // keeps the vendor's 2.58:1 grey. Mutation: fence the rule at 767px (as in 5be42f2): the tablets (768 to 991px)
  // keep the vendor's grey, 2.53 to 2.58:1.
  for (const viewport of [...PHONES, tablet, tablet991]) {
    for (const [name, hash] of Object.entries(BADGE_VIEWS)) {
      test(`every badge reaches 4.5:1 in the light theme on ${name} at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, hash, async (page) => {
          await setTheme(page, 'light');
          assert.deepEqual(badgeProblems(await page.evaluate(badgeContrasts, BADGE), name), []);
        });
      });
    }
  }

  // Planted fault: the vendor's grey put back on every badge.
  test('planted fault: the pale grey badge text is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, '#!/settings', async (page) => {
      await page.addStyleTag({ content: `${BADGE}, ${BADGE} * { color: rgb(152, 162, 179) !important }` });
      const problems = badgeProblems(await page.evaluate(badgeContrasts, BADGE), 'settings');
      assert.ok(problems.length >= 4, `got: ${problems.join('; ')}`);
    });
  });

  // The dark and high contrast themes sit on a dark background where the vendor's colours are already clear: they
  // are not changed.
  for (const theme of ['dark', 'highcontrast']) {
    test(`the ${theme} theme keeps the vendor's colours at ${phone390.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(phone390, '#!/settings', async (page) => {
        await setTheme(page, theme);
        const badges = await page.evaluate(badgeContrasts, BADGE);
        assert.ok(badges.length > 0, 'no badge shown');
        for (const b of badges) {
          assert.notEqual(b.color, 'rgb(102, 112, 133)', 'the light theme colour is used in the dark theme');
          assert.ok(b.ratio >= 4.5, `${theme}: ${b.color} is ${b.ratio.toFixed(2)}:1`);
        }
      });
    });
  }

  // Planted fault: the light colour applied in every theme, as a rule that ignores the theme would.
  test('planted fault: the light theme colour in the dark theme is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, '#!/settings', async (page) => {
      await setTheme(page, 'dark');
      await page.addStyleTag({ content: `${BADGE}, ${BADGE} * { color: rgb(102, 112, 133) !important }` });
      const badges = await page.evaluate(badgeContrasts, BADGE);
      assert.ok(badges.some((b) => b.color === 'rgb(102, 112, 133)'));
    });
  });

  // The colour change is for phones and tablets only: from 992px up the badge keeps the vendor's colour.
  // Mutation: take the media query off the rule.
  for (const viewport of [desktop992, desktop1440, VIEWPORTS.desktop1920]) {
    test(`it keeps the vendor's colour at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, '#!/settings', async (page) => {
        await setTheme(page, 'light');
        const badges = await page.evaluate(badgeContrasts, BADGE);
        assert.ok(badges.length > 0, 'no Business Feature badge on the settings page');
        for (const b of badges) assert.equal(b.color, 'rgb(152, 162, 179)');
      });
    });
  }
});

// The badge under a locked option of a box selector (the S3 backup option of the settings page).
const BOX_BADGE = 'a[href*="business-upsell"].text-gray-6';

describe('the Business Feature badge of a locked box selector option', () => {
  // Mutation: remove the two `business-upsell` rules of mobile.css (as in 5be42f2): the text is the vendor's grey, 2.58:1.
  for (const viewport of [phone320, phone390, tablet, tablet991]) {
    test(`it reaches 4.5:1 in the light theme at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, '#!/settings', async (page) => {
        await setTheme(page, 'light');
        assert.deepEqual(badgeProblems(await page.evaluate(badgeContrasts, BOX_BADGE), 'settings'), []);
      });
    });
  }

  // (the vendor's links are blue in the dark theme, and so is this one)
  test(`the dark theme keeps the vendor's colour at ${phone390.name}`, { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, '#!/settings', async (page) => {
      await setTheme(page, 'dark');
      const badges = await page.evaluate(badgeContrasts, BOX_BADGE);
      assert.ok(badges.length > 0, 'no badge shown');
      for (const b of badges) assert.equal(b.color, 'rgb(11, 165, 236)');
    });
  });

  // Mutation: take the media query off the rule.
  for (const viewport of [desktop992, desktop1440]) {
    test(`it keeps the vendor's grey at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, '#!/settings', async (page) => {
        await setTheme(page, 'light');
        const badges = await page.evaluate(badgeContrasts, BOX_BADGE);
        assert.ok(badges.length > 0, 'no badge shown');
        for (const b of badges) assert.equal(b.color, 'rgb(152, 162, 179)');
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

// ---- 10: the version button in the drawer is big enough to tap, and shows when it has focus -----------------------

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

// What the version button shows when a keyboard user reaches it.
async function versionFocusProblems(page) {
  await page.locator(VERSION).focus();
  const info = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    const style = getComputedStyle(el);
    return { active: document.activeElement === el, focusVisible: el.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), shadow: style.boxShadow };
  }, VERSION);
  const problems = [];
  if (!info.active) problems.push('the version button did not take focus');
  if (!info.focusVisible) problems.push('the version button does not match :focus-visible');
  const hasOutline = info.outlineStyle !== 'none' && info.outlineWidth > 0;
  const hasShadow = info.shadow !== 'none';
  if (!hasOutline && !hasShadow) problems.push('the version button shows no focus indicator');
  return problems;
}

describe('the version button shows when it has keyboard focus', () => {
  // Mutation: `.btn-none:focus { outline: none }` is left to win in the drawer (as in 16e704c).
  for (const viewport of PHONES) {
    test(`it has a visible focus indicator in the phone drawer at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        assert.deepEqual(await versionFocusProblems(page), []);
      });
    });
  }

  // Planted fault: every outline taken away.
  test('planted fault: a version button without a focus indicator is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await openDrawerWithKeyboard(page);
      await page.addStyleTag({ content: NO_RINGS });
      const problems = await versionFocusProblems(page);
      assert.ok(
        problems.some((p) => /no focus indicator/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });

  // The ring is for phones only: the desktop sidebar keeps the vendor's button, which shows none.
  test("the desktop sidebar keeps the vendor's button (no outline added) at 1440", { timeout: TEST_TIMEOUT }, async () => {
    await onView(desktop1440, CONTAINER, async (page) => {
      await page.keyboard.press('Tab');
      await page.locator(VERSION).focus();
      const outline = await page.evaluate((selector) => getComputedStyle(document.querySelector(selector)).outlineStyle, VERSION);
      assert.equal(outline, 'none');
    });
  });
});

// ---- 11: following a drawer link to another page leaves focus on the new page's toggle ----------------------

async function focusOnToggleProblems(page) {
  return page.evaluate((toggle) => {
    const el = document.querySelector(toggle);
    if (!el) return ['the new page has no sidebar toggle'];
    if (document.activeElement === el) return [];
    const active = document.activeElement;
    return [`focus is on ${active === document.body ? 'the page body' : `<${active.tagName.toLowerCase()}>`}, not on the sidebar toggle of the page that was opened`];
  }, TOGGLE);
}

describe('focus after following a link in the phone drawer to another page', () => {
  // Mutation: the drawer returns focus to the toggle of the page it is leaving, which is then replaced, so focus
  // drops to <body> (as in 16e704c).
  for (const viewport of PHONES) {
    test(`a keyboard user lands on the toggle of the new page at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        await page.locator(`${DIALOG} a[href="#!/home"]`).first().focus();
        await page.keyboard.press('Enter');
        await eventually(async () => assert.match(await page.evaluate(() => location.hash), /#!\/home/), { timeout: 5000 });
        await eventually(async () => assert.deepEqual(await focusOnToggleProblems(page), []), { timeout: 5000 });
        // it stays there, and the next Tab goes on from it
        await page.waitForTimeout(600);
        assert.deepEqual(await focusOnToggleProblems(page), []);
        assert.equal(await drawerIsOpen(page), false);
      });
    });

    test(`a tap lands on the toggle of the new page at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        await page.locator(`${DIALOG} a[href="#!/home"]`).first().tap();
        await eventually(async () => assert.match(await page.evaluate(() => location.hash), /#!\/home/), { timeout: 5000 });
        await eventually(async () => assert.deepEqual(await focusOnToggleProblems(page), []), { timeout: 5000 });
      });
    });
  }

  // Planted fault: focus dropped to the body after the navigation.
  test('planted fault: focus left on the body after a link is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      assert.equal((await focusOnToggleProblems(page)).length, 1);
    });
  });
});

// ---- 12: the environment wizard fits a phone, with its panels stacked -------------------------------------------

const WIZARD_TYPES = { 'Docker standalone': 'dockerStandalone', 'Docker Swarm': 'dockerSwarm', Podman: 'podman', Kubernetes: 'kubernetes', 'Azure ACI': 'aci' };
const wizardView = (type) => `#!/wizard/endpoints/create?envType=${type}`;

// Where the wizard's two panels are, in the page.
function wizardPanels() {
  const find = (title) => [...document.querySelectorAll('section.widget')].find((w) => w.querySelector('.widget-header')?.textContent.includes(title));
  const main = find('Environment Wizard');
  const added = find('New Environments');
  if (!main || !added) return null;
  const a = main.getBoundingClientRect();
  const b = added.getBoundingClientRect();
  return { main: { left: a.left, right: a.right, top: a.top, bottom: a.bottom }, added: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, vw: document.documentElement.clientWidth };
}

function stackedProblems(panels) {
  if (!panels) return ['the wizard panels were not found'];
  const problems = [];
  if (panels.added.top < panels.main.bottom - 1) problems.push(`the "New Environments" panel starts at ${Math.round(panels.added.top)}px, beside the wizard (which ends at ${Math.round(panels.main.bottom)}px) instead of below it`);
  if (panels.added.right > panels.vw + 1) problems.push(`the "New Environments" panel runs to ${Math.round(panels.added.right)}px in a ${panels.vw}px window`);
  return problems;
}

function sideBySideProblems(panels) {
  if (!panels) return ['the wizard panels were not found'];
  return panels.added.left >= panels.main.right - 1 && Math.abs(panels.added.top - panels.main.top) <= 2 ? [] : ['the wizard panels are not side by side'];
}

describe('the environment wizard on phones', () => {
  // Mutation: the two-column grid is kept on phones, with its 300px minimum for the second column (as in 16e704c);
  // the page is then 539px wide.
  for (const viewport of [phone320, phone390, VIEWPORTS.tablet767]) {
    for (const [name, type] of Object.entries(WIZARD_TYPES)) {
      test(`${name}: nothing runs off the page, and the panels are stacked at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, wizardView(type), async (page) => {
          assert.deepEqual(await page.evaluate(findOffScreen), []);
          assert.deepEqual(stackedProblems(await page.evaluate(wizardPanels)), []);
        });
      });
    }
  }

  // Planted fault: a panel pushed past the right edge.
  test('planted fault: a panel that runs off the page is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone320, wizardView('dockerStandalone'), async (page) => {
      await page.addStyleTag({ content: '[class*="wizard-wrapper"] { grid-template-columns: 2fr minmax(300px, 1fr) !important; grid-template-areas: "main sidebar" "footer sidebar" !important; }' });
      assert.ok((await page.evaluate(findOffScreen)).length > 0, 'a 539px wide page was not reported');
      assert.ok(stackedProblems(await page.evaluate(wizardPanels)).length > 0);
    });
  });

  // From 768px the vendor's two columns are kept.
  for (const viewport of [tablet, tablet991, phoneLandscape, desktop1440]) {
    test(`the panels stay side by side at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, wizardView('dockerStandalone'), async (page) => {
        assert.deepEqual(sideBySideProblems(await page.evaluate(wizardPanels)), []);
      });
    });
  }

  // Planted fault: the panels stacked at the desktop width, as an unfenced rule would.
  test('planted fault: panels stacked at 1440px are reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(desktop1440, wizardView('dockerStandalone'), async (page) => {
      await page.addStyleTag({ content: '[class*="wizard-wrapper"] { grid-template-columns: minmax(0, 1fr) !important; grid-template-areas: none !important; }' });
      assert.equal(sideBySideProblems(await page.evaluate(wizardPanels)).length, 1);
    });
  });
});

// ---- 13: the Close menu button sits in the logo row ---------------------------------------------------------------

const LOGO_LINK = `${DIALOG} [data-cy="portainerSidebar-homeImage"]`;
const MENU_SCROLL_AREA = `${DIALOG} nav > div:nth-child(2)`;

async function closeRowProblems(page, minMenuHeight) {
  const info = await page.evaluate(
    ({ close, logo, menu }) => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
      };
      return { close: rect(close), logo: rect(logo), menu: rect(menu), vw: document.documentElement.clientWidth, focused: document.activeElement?.getAttribute('aria-label') };
    },
    { close: CLOSE, logo: LOGO_LINK, menu: MENU_SCROLL_AREA }
  );
  const problems = [];
  if (!info.close || !info.logo || !info.menu) return ['the drawer parts were not found'];
  // level with the logo: the two are centred on the same line (the logo is a little shorter than the button on the
  // narrowest phones, where it is scaled down to leave room for the button)
  const offset = Math.abs((info.close.top + info.close.bottom) / 2 - (info.logo.top + info.logo.bottom) / 2);
  if (offset > 6) {
    problems.push(`the Close menu button (${Math.round(info.close.top)}..${Math.round(info.close.bottom)}) is not level with the logo (${Math.round(info.logo.top)}..${Math.round(info.logo.bottom)})`);
  }
  if (info.close.left < 0 || info.close.right > info.vw) problems.push('the Close menu button is outside the window');
  if (info.menu.height < minMenuHeight) problems.push(`the menu's scroll area is only ${Math.round(info.menu.height)}px tall, under ${minMenuHeight}px`);
  const logoImage = await page.locator(`${LOGO_LINK} img`).boundingBox();
  if (logoImage && logoImage.x + logoImage.width > info.close.left + 0.5) problems.push(`the logo (to ${Math.round(logoImage.x + logoImage.width)}px) runs under the Close menu button (from ${Math.round(info.close.left)}px)`);
  return problems;
}

describe('the Close menu button is in the logo row of the phone drawer', () => {
  // Mutation: the button gets a row of its own above the logo (as in 16e704c): the menu's scroll area is squeezed to
  // 80px at 568x320 and 30px at 568x270, and the button is not level with the logo.
  for (const [viewport, minMenuHeight] of [
    [phoneLandscapeShort, 120],
    [phoneLandscapeTiny, 70],
    [phone320, 300],
    [phone390, 400],
  ]) {
    test(`no height is lost to it at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        assert.deepEqual(await closeRowProblems(page, minMenuHeight), []);
      });
    });

    test(`it is first in the focus order, named, 36x36 and holds the initial focus at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        assert.deepEqual(await closeButtonProblems(page), []);
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close menu', 'focus did not start on the Close menu button');
      });
    });
  }

  // Planted fault: a row of its own, 56px tall, above the logo.
  test('planted fault: a Close menu row above the logo is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phoneLandscapeShort, CONTAINER, async (page) => {
      await openDrawerWithKeyboard(page);
      await page.evaluate(() => {
        const nav = document.querySelector('.sidebar[role="dialog"] nav');
        nav.style.marginTop = '56px';
      });
      const problems = await closeRowProblems(page, 120);
      assert.ok(problems.length >= 1, `got: ${problems.join('; ')}`);
    });
  });

  // The upgrade banner of the Community Edition sits above the logo row and is not on this instance: put one in, after
  // the Close menu button, and the button must still be level with the logo.
  test('it stays level with the logo when the upgrade banner is shown above the logo row', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await openDrawerWithKeyboard(page);
      await page.evaluate(() => {
        const banner = document.createElement('button');
        banner.type = 'button';
        banner.textContent = 'Upgrade to Business Edition';
        banner.className = 'flex w-full items-center justify-center py-2';
        banner.style.height = '40px';
        const close = document.querySelector('.sidebar[role="dialog"] button[aria-label="Close menu"]');
        // the banner is the next child of the drawer after the Close menu button, as in the application
        close.insertAdjacentElement('afterend', banner);
      });
      assert.deepEqual(await closeRowProblems(page, 300), []);
    });
  });

  // G2: the focus ring is painted all the way round, over whatever is next to the button.
  test('its focus ring is visible on all four sides', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await openDrawerWithKeyboard(page);
      assert.deepEqual(await ringSidesProblems(page, CLOSE), []);
    });
  });

  // Planted fault: the ring is taken away.
  test('planted fault: a button whose ring is not painted is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await openDrawerWithKeyboard(page);
      await page.addStyleTag({ content: NO_RINGS });
      assert.ok((await ringSidesProblems(page, CLOSE)).length > 0, 'a ring that is not painted was not reported');
    });
  });
});

// Compares the pixels around a focused control with the same pixels when it is not focused: the ring must show up
// at least 2px past each of its four sides.
async function ringSidesProblems(page, selector) {
  const box = await page.locator(selector).boundingBox();
  const margin = 6;
  const clip = { x: Math.floor(box.x) - margin, y: Math.floor(box.y) - margin, width: Math.ceil(box.width) + margin * 2, height: Math.ceil(box.height) + margin * 2 };
  const focused = await page.screenshot({ clip });
  await page.locator(selector).evaluate((el) => el.blur());
  const blurred = await page.screenshot({ clip });
  await page.locator(selector).focus();
  const diff = await comparePng(browser, blurred, focused);
  const problems = [];
  if (!diff.box) return ['left', 'right', 'top', 'bottom'].map((side) => `no ring is painted on the ${side} side`);
  const need = 2;
  if (diff.box.x > margin - need) problems.push('the ring is cut off on the left side');
  if (diff.box.y > margin - need) problems.push('the ring is cut off on the top side');
  if (diff.box.x + diff.box.width < clip.width - margin + need) problems.push('the ring is cut off on the right side');
  if (diff.box.y + diff.box.height < clip.height - margin + need) problems.push('the ring is cut off on the bottom side');
  return problems;
}

// ---- 14: a button in a table that scrolls sideways keeps its label on one line ---------------------------------

// The number of lines the label of the "Leave Network" button is set on.
function leaveNetworkLines() {
  const button = document.querySelector('[data-cy^="networkDetails-disconnect"]');
  if (!button) return null;
  const tops = new Set();
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
  }
  return { lines: tops.size, text: button.textContent.trim() };
}

describe('"Leave Network" on phones', () => {
  // Mutation: `.btn { white-space: normal }` and `td { overflow-wrap: anywhere }` apply to it (as in 16e704c), and
  // the label breaks into five pieces.
  for (const viewport of PHONES) {
    test(`the label is on one line at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, networkWithContainers, async (page) => {
        const info = await page.evaluate(leaveNetworkLines);
        assert.ok(info, 'no Leave Network button on this network');
        assert.equal(info.lines, 1, `"${info.text}" is set on ${info.lines} lines`);
      });
    });
  }

  // Planted fault: the label allowed to break anywhere again.
  test('planted fault: a label broken into pieces is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone320, networkWithContainers, async (page) => {
      await page.addStyleTag({ content: '[data-cy^="networkDetails-disconnect"] { white-space: normal !important; overflow-wrap: anywhere !important; width: 40px !important; }' });
      const info = await page.evaluate(leaveNetworkLines);
      assert.ok(info.lines > 1, `${info.lines}`);
    });
  });
});

// ---- 15: "Clear environment" in the phone drawer is a touch target -------------------------------------------------

const CLEAR_ENV = `${DIALOG} button[title="Clear environment"]`;

describe('"Clear environment" in the phone drawer', () => {
  // Mutation: the button keeps the vendor's 20x20px box on touch phones (as in 16e704c).
  for (const viewport of PHONES) {
    test(`it is 32-36px square on a touch phone at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await openDrawerWithKeyboard(page);
        const box = await page.locator(CLEAR_ENV).boundingBox();
        assert.ok(box, 'no Clear environment button in the open drawer');
        assert.ok(box.width >= 31.5 && box.height >= 31.5 && box.width <= 36.5 && box.height <= 36.5, `the button is ${Math.round(box.width)}x${Math.round(box.height)}`);
        const row = await page.locator(CLEAR_ENV).evaluate((el) => { const r = el.parentElement.getBoundingClientRect(); const d = el.closest('.sidebar').getBoundingClientRect(); return { right: r.right, drawerRight: d.right }; });
        assert.ok(row.right <= row.drawerRight + 1, 'the row runs past the drawer');
      });
    });
  }

  // Planted fault: the vendor's box.
  test('planted fault: a 20px Clear environment button is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await openDrawerWithKeyboard(page);
      await page.addStyleTag({ content: `${CLEAR_ENV} { width: 20px !important; height: 20px !important; }` });
      const box = await page.locator(CLEAR_ENV).boundingBox();
      assert.ok(box.width < 31.5);
    });
  });

  // The larger box is for the phone drawer: the tablet's and desktop's sidebars keep the vendor's.
  for (const viewport of [tablet, desktop1440]) {
    test(`it keeps the vendor's 20x20 at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        if (viewport.width < 992) {
          await page.locator(TOGGLE).tap();
          await page.waitForTimeout(500);
        }
        const box = await page.locator('.sidebar button[title="Clear environment"]').boundingBox();
        assert.ok(box, 'no Clear environment button in the expanded sidebar');
        assert.equal(Math.round(box.width), 20);
        assert.equal(Math.round(box.height), 20);
      });
    });
  }
});

// ---- 15: link-style buttons have enough contrast in the light theme -------------------------------------------

const LINK_BUTTON = '.btn.btn-link:not(:disabled):not(.disabled)';
const VENDOR_LINK_BLUE = 'rgb(0, 134, 201)';

function linkButtonProblems(buttons, what) {
  const problems = [];
  if (buttons.length < 4) problems.push(`${what}: found only ${buttons.length} link-style buttons`);
  buttons.forEach((b, i) => {
    if (b.ratio < 4.5) problems.push(`${what}: link-style button ${i + 1} is ${b.color}, ${b.ratio.toFixed(2)}:1`);
  });
  return problems;
}

describe('link-style buttons on phones and tablets', () => {
  const detail = () => `#!/1/docker/containers/${containerId}`;

  // Mutation: remove the `.btn.btn-link` rule of bootstrap-mobile.css (as in 5be42f2): "Logs", "Inspect", "Stats",
  // "Console", "Attach", "Change ownership" and "Advanced mode" are the vendor's blue, 4.0:1 on white.
  for (const viewport of [phone320, phone390, tablet, tablet991]) {
    test(`every link-style button reaches 4.5:1 in the light theme at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, detail(), async (page) => {
        await setTheme(page, 'light');
        assert.deepEqual(linkButtonProblems(await page.evaluate(badgeContrasts, LINK_BUTTON), 'container'), []);
      });
    });
  }

  // Planted fault: the vendor's blue put back on every link-style button.
  test('planted fault: the vendor blue is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, detail(), async (page) => {
      await page.addStyleTag({ content: `${LINK_BUTTON} { color: ${VENDOR_LINK_BLUE} !important }` });
      const problems = linkButtonProblems(await page.evaluate(badgeContrasts, LINK_BUTTON), 'container');
      assert.ok(problems.length >= 5, `got: ${problems.join('; ')}`);
    });
  });

  // A hovered button is still told apart from one at rest (the next darker blue again).
  test('a hovered link-style button is darker than one at rest', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, detail(), async (page) => {
      await setTheme(page, 'light');
      const button = page.locator(LINK_BUTTON).first();
      const rest = await button.evaluate((el) => getComputedStyle(el).color);
      await button.hover();
      const hovered = await button.evaluate((el) => getComputedStyle(el).color);
      assert.notEqual(hovered, rest, 'hover does not change the colour');
      assert.equal(hovered, 'rgb(6, 89, 134)');
    });
  });

  // The dark and high contrast themes keep the vendor's colours.
  // Mutation: drop the theme selectors from the rule, so the dark blue is used on a dark background.
  for (const [theme, colour] of [
    ['dark', 'rgb(11, 165, 236)'],
    ['highcontrast', 'rgb(124, 212, 253)'],
  ]) {
    test(`the ${theme} theme keeps the vendor's colour at ${phone390.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(phone390, detail(), async (page) => {
        await setTheme(page, theme);
        const buttons = await page.evaluate(badgeContrasts, LINK_BUTTON);
        assert.ok(buttons.length >= 4, 'no link-style buttons shown');
        for (const b of buttons) assert.equal(b.color, colour);
      });
    });
  }

  // From 992px up the vendor's blue stays.
  // Mutation: take the media query off the rule.
  for (const viewport of [desktop992, desktop1440]) {
    test(`it keeps the vendor's blue at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, detail(), async (page) => {
        await setTheme(page, 'light');
        const buttons = await page.evaluate(badgeContrasts, LINK_BUTTON);
        assert.ok(buttons.length >= 4, 'no link-style buttons shown');
        for (const b of buttons) assert.equal(b.color, VENDOR_LINK_BLUE);
      });
    });
  }
});

// ---- 16: keyboard focus is visible on controls that the vendor gives no ring --------------------------------

// The controls, the page that has them, and the part of the page that holds the painted control (the checkboxes
// of a table are drawn by their label, so the ring is checked around the box and not around the hidden input).
const FOCUS_TARGETS = {
  'the refresh button': { hash: CONTAINER, selector: 'button[data-cy="refresh-page-button"]', cover: true },
  'the search field of a table': { hash: CONTAINER, selector: 'input[data-cy^="docker-containers-datatable-header"]', cover: true },
  'the select all checkbox of a table': { hash: CONTAINER, selector: 'input[data-cy^="select-all-checkbox"]', cover: false },
  'a row checkbox of a table': { hash: CONTAINER, selector: 'input[data-cy^="select-row-checkbox"]', cover: false },
  'the rename button of a container': { hash: () => `#!/1/docker/containers/${containerId}`, selector: 'button[data-cy="container-edit-name-button"]', cover: true },
  'the selected card of a box selector': { hash: '#!/1/docker/containers/new', selector: 'input.sr-only[type="radio"]:checked', box: 'next', cover: true },
};

// A keyboard user focuses the control: the pixels around it change (a ring is painted), the ring stands out 3:1
// against what it is painted over, and, for a control drawn as one box, it goes all the way round.
// The page re-renders now and then (the data is polled), which can drop focus or move the control between the two
// pictures; the check is made again until the control keeps its focus and the page holds still.
async function focusRingProblems(page, target, what) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await focusRingOnce(page, target, what);
    if (!result.unstable) return result.problems;
  }
  return [`${what}: the page did not hold still long enough to compare the focused and the blurred control`];
}

async function focusRingOnce(page, { selector, box = 'self', cover }, what) {
  const control = page.locator(selector).first();
  if ((await control.count()) === 0) return { problems: [`${what}: no control matches ${selector}`] };
  await control.evaluate((el, boxOf) => {
    (boxOf === 'next' ? el.nextElementSibling : el).scrollIntoView({ block: 'center', behavior: 'instant' });
    el.blur();
  }, box);
  await page.waitForTimeout(300);
  const rect = await control.evaluate((el, boxOf) => {
    const r = (boxOf === 'next' ? el.nextElementSibling : el).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, box);
  const margin = 8;
  const clip = {
    x: Math.max(0, Math.floor(rect.x) - margin),
    y: Math.max(0, Math.floor(rect.y) - margin),
    width: Math.ceil(rect.width) + margin * 2,
    height: Math.ceil(rect.height) + margin * 2,
  };
  const first = await page.screenshot({ clip });
  const blurred = await page.screenshot({ clip });
  if (!first.equals(blurred)) return { unstable: true };
  // a key press first, so that the browser treats the focus as the keyboard's and matches :focus-visible
  await page.keyboard.press('Shift');
  await control.evaluate((el) => el.focus({ focusVisible: true, preventScroll: true }));
  await page.waitForTimeout(250);
  const held = await control.evaluate(
    (el, { boxOf, at }) => {
      const r = (boxOf === 'next' ? el.nextElementSibling : el).getBoundingClientRect();
      return document.activeElement === el && r.x === at.x && r.y === at.y;
    },
    { boxOf: box, at: rect }
  );
  if (!held) return { unstable: true };
  const focused = await page.screenshot({ clip });
  const diff = await comparePng(browser, blurred, focused);
  if (!diff.box) return { problems: [`${what}: no focus ring is painted`] };
  const problems = [];
  if (diff.ringContrast < 3) problems.push(`${what}: the focus ring has only ${diff.ringContrast.toFixed(2)}:1 contrast against what it is painted over`);
  if (cover) {
    const left = rect.x - clip.x;
    const top = rect.y - clip.y;
    if (diff.box.x > left + 3 || diff.box.y > top + 3 || diff.box.x + diff.box.width < left + rect.width - 3 || diff.box.y + diff.box.height < top + rect.height - 3) {
      problems.push(
        `${what}: the focus ring does not go all the way round the control (${JSON.stringify(diff.box)} in ${Math.round(rect.width)}x${Math.round(rect.height)} at ${Math.round(left)},${Math.round(top)})`
      );
    }
  }
  return { problems };
}

// Takes every ring away, including the ones that are set with !important on a more specific selector.
const STRONG_NO_RINGS =
  ':root:root:root body *:focus, :root:root:root body *:focus-visible, :root:root:root body .md-checkbox input:focus-visible + label:before { outline: none !important; box-shadow: none !important }';

const hashOf = (target) => (typeof target.hash === 'function' ? target.hash() : target.hash);

describe('keyboard focus is visible on phones and tablets', () => {
  // Mutation: remove the focus rules of bootstrap-mobile.css, datatable.css and BoxOption.module.css (as in 5be42f2):
  // the vendor takes the ring off these controls, and nothing is painted when one has focus.
  for (const viewport of [phone390, tablet, tablet991]) {
    for (const [name, target] of Object.entries(FOCUS_TARGETS)) {
      test(`${name} shows a focus ring at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, hashOf(target), async (page) => {
          assert.deepEqual(await focusRingProblems(page, target, name), []);
        });
      });
    }
  }

  // Planted fault: every ring taken away.
  test('planted fault: a control without a ring is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await page.addStyleTag({ content: `${STRONG_NO_RINGS}` });
      const target = FOCUS_TARGETS['the refresh button'];
      assert.ok((await focusRingProblems(page, target, 'the refresh button')).some((p) => /no focus ring is painted/.test(p)));
      assert.ok((await focusRingProblems(page, FOCUS_TARGETS['a row checkbox of a table'], 'a row checkbox')).some((p) => /no focus ring is painted/.test(p)));
    });
  });

  // Planted fault: a ring too pale to see on the white page.
  test('planted fault: a ring under 3:1 is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await page.addStyleTag({
        content: ':root:root:root body *:focus-visible { outline: 3px solid rgb(235, 235, 235) !important; outline-offset: -3px !important; box-shadow: none !important }',
      });
      const problems = await focusRingProblems(page, FOCUS_TARGETS['the refresh button'], 'the refresh button');
      assert.ok(
        problems.some((p) => /contrast/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });

  // Planted fault: a ring that covers only the top of the control.
  test('planted fault: a ring that does not go all the way round is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await page.addStyleTag({
        content: ':root:root:root body button[data-cy="refresh-page-button"]:focus-visible { outline: none !important; box-shadow: 0 -3px 0 0 rgb(0, 0, 0) !important }',
      });
      const problems = await focusRingProblems(page, FOCUS_TARGETS['the refresh button'], 'the refresh button');
      assert.ok(
        problems.some((p) => /all the way round/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });

  // From 992px up the vendor's controls are left alone.
  // Mutation: take the media queries off the focus rules.
  for (const viewport of [desktop992, desktop1440]) {
    for (const [name, target] of Object.entries(FOCUS_TARGETS)) {
      test(`${name} keeps the vendor's look (no ring added) at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, hashOf(target), async (page) => {
          assert.deepEqual(await focusRingProblems(page, target, name), [`${name}: no focus ring is painted`]);
        });
      });
    }
  }
});
