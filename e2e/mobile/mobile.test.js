// Checks for the phone and tablet behaviour of the application shell and the
// shared data table. Run with `node --test e2e/mobile/` (see README.md).
//
// Only the mobile behaviour is covered here. Existing features are not tested.

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, openView, withPage, eventually } = require('./lib/browser');
const { targetURL, VIEWS, VIEWPORTS, DRAWER_BREAKPOINT } = require('./lib/config');

const { phone360, phone390, phoneLandscape, tablet } = VIEWPORTS;
const PHONES_AND_TABLET = [phone360, phone390, phoneLandscape, tablet];
const PHONES = [phone360, phone390, phoneLandscape];
// Below the drawer breakpoint the sidebar is an off-canvas drawer.
const DRAWER_VIEWPORTS = [phone360, phone390];
const RAIL_VIEWPORTS = [phoneLandscape, tablet];

const NAV = 'nav[aria-label="Main"]';
const TOGGLE = 'button[aria-label="Toggle Sidebar"]';
const BACKDROP = '[data-cy="sidebar-backdrop"]';
const BASE_URL = targetURL();
const TEST_TIMEOUT = 90000;

let browser;
let storageState;

before(async () => {
  browser = await launch();
  storageState = await signIn(browser, BASE_URL);
});

after(async () => {
  await browser?.close();
});

// Runs `fn(page)` on `view` in a fresh context of the given size.
function onView(viewport, viewKey, fn) {
  return withPage(browser, storageState, viewport, async (page) => {
    await openView(page, BASE_URL, VIEWS[viewKey]);
    return fn(page);
  });
}

// The layout viewport must be the device width. Without it every other
// measurement is taken on a 980px-wide desktop layout and means nothing.
async function assertRealViewport(page, viewport) {
  const innerWidth = await page.evaluate(() => window.innerWidth);
  assert.equal(
    innerWidth,
    viewport.width,
    `the page lays out at ${innerWidth}px instead of the ${viewport.width}px device width, so there is no real mobile layout to measure (is the viewport meta tag missing?)`
  );
}

// ---- in-page measurements (these run inside the browser) ------------------

function readNav(selectors) {
  const nav = document.querySelector(selectors.nav);
  if (!nav) {
    return { present: false, open: false, closed: true };
  }
  const style = getComputedStyle(nav);
  const rect = nav.getBoundingClientRect();
  const displayed = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  const centre = document.elementFromPoint(
    Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1),
    Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1)
  );
  return {
    present: true,
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    width: Math.round(rect.width),
    // off-screen, hidden, or not rendered: not reachable by the user
    closed: !displayed || rect.right <= 0,
    // fully inside the viewport and not covered by anything else
    open: displayed && rect.left >= -1 && rect.right <= window.innerWidth + 1 && !!centre && nav.contains(centre),
  };
}

function readBackdrop(selector) {
  // Every element carrying the marker counts, not only the first: a hidden one
  // must not mask a visible one.
  const elements = [...document.querySelectorAll(selector)];
  return {
    present: elements.length > 0,
    visible: elements.some((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    }),
  };
}

const nav = (page) => page.evaluate(readNav, { nav: NAV });
const backdrop = (page) => page.evaluate(readBackdrop, BACKDROP);
const contentLeft = (page) => page.evaluate(() => Math.round(document.querySelector('#content-wrapper').getBoundingClientRect().left));

async function assertDrawerClosed(page) {
  const check = async () => {
    const state = await nav(page);
    assert.ok(state.closed, `the main navigation should be closed but is on screen: ${JSON.stringify(state)}`);
    assert.equal((await backdrop(page)).visible, false, 'the backdrop should be gone when the drawer is closed');
  };
  await eventually(check);
  // It must stay closed, not just pass through a closed moment on its way to reopening.
  await page.waitForTimeout(600);
  await check();
}

async function assertDrawerOpen(page) {
  await eventually(async () => {
    const state = await nav(page);
    assert.ok(state.open, `the main navigation should be open and fully on screen: ${JSON.stringify(state)}`);
    assert.equal((await backdrop(page)).visible, true, 'a backdrop should be visible while the drawer is open');
  });
}

async function openDrawer(page) {
  await page.click(TOGGLE);
  await assertDrawerOpen(page);
}

// ---- 1. a real viewport ----------------------------------------------------

describe('viewport', () => {
  test('the page declares width=device-width', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone360, 'home', async (page) => {
      const content = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null);
      assert.ok(content, 'there is no <meta name="viewport"> tag');
      assert.match(content, /(^|[,;\s])width\s*=\s*device-width/, `viewport meta is "${content}"`);
    });
  });

  for (const viewport of PHONES_AND_TABLET) {
    test(`the layout width equals the screen width at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, 'home', (page) => assertRealViewport(page, viewport));
    });
  }
});

// ---- 2. no sideways page scroll -------------------------------------------

describe('no sideways page scroll', () => {
  for (const viewport of PHONES_AND_TABLET) {
    for (const viewKey of Object.keys(VIEWS)) {
      test(`${viewKey} at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, viewKey, async (page) => {
          await assertRealViewport(page, viewport);
          const { scrollWidth, innerWidth, offenders } = await page.evaluate(() => {
            const width = window.innerWidth;
            const wide = [...document.querySelectorAll('body *')]
              .filter((element) => element.getBoundingClientRect().right > width + 1 && getComputedStyle(element).position !== 'fixed')
              .slice(0, 5)
              .map(
                (element) =>
                  `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${typeof element.className === 'string' && element.className ? `.${element.className.split(/\s+/).slice(0, 2).join('.')}` : ''} right=${Math.round(element.getBoundingClientRect().right)}`
              );
            return { scrollWidth: document.documentElement.scrollWidth, innerWidth: width, offenders: wide };
          });
          assert.ok(
            scrollWidth <= innerWidth,
            `the page is ${scrollWidth}px wide in a ${innerWidth}px window; first elements past the edge: ${offenders.join(', ') || 'none found'}`
          );
        });
      });
    }
  }
});

// ---- 3. sidebar drawer -----------------------------------------------------

describe(`sidebar drawer below ${DRAWER_BREAKPOINT}px`, () => {
  for (const viewport of DRAWER_VIEWPORTS) {
    describe(viewport.name, () => {
      test('is closed on load and the content starts at the left edge', { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, 'dashboard', async (page) => {
          await assertRealViewport(page, viewport);
          await assertDrawerClosed(page);
          const left = await contentLeft(page);
          assert.ok(left <= 2, `the content starts ${left}px from the left edge, so a sidebar rail still takes up room`);
        });
      });

      test('the Toggle Sidebar button opens it with a backdrop', { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, 'dashboard', async (page) => {
          await assertRealViewport(page, viewport);
          await openDrawer(page);
        });
      });

      test('tapping the backdrop closes it', { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, 'dashboard', async (page) => {
          await assertRealViewport(page, viewport);
          await openDrawer(page);
          // Tap the strip of backdrop that shows beside the drawer.
          const x = viewport.width - 6;
          const y = Math.round(viewport.height / 2);
          const covered = await page.evaluate(([px, py, selector]) => !!document.elementFromPoint(px, py)?.closest(selector), [x, y, BACKDROP]);
          assert.ok(covered, `the backdrop is not what is under a tap at (${x}, ${y}); there is no backdrop strip beside the drawer`);
          await page.mouse.click(x, y);
          await assertDrawerClosed(page);
        });
      });

      test('Escape closes it and focus returns to the Toggle Sidebar button', { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, 'dashboard', async (page) => {
          await assertRealViewport(page, viewport);
          await openDrawer(page);
          // A keyboard user is inside the drawer when they press Escape.
          const focusedInside = await page.evaluate((selector) => {
            const link = document.querySelector(`${selector} a`);
            link?.focus();
            return !!link && document.activeElement === link;
          }, NAV);
          assert.ok(focusedInside, 'could not move focus onto a link inside the drawer');
          await page.keyboard.press('Escape');
          await assertDrawerClosed(page);
          const focus = await page.evaluate(
            (selector) => ({ onToggle: document.activeElement?.matches(selector) ?? false, active: document.activeElement?.outerHTML.slice(0, 80) }),
            TOGGLE
          );
          assert.ok(focus.onToggle, `focus did not return to the Toggle Sidebar button; it is on ${focus.active}`);
        });
      });

      test('following a link in it navigates and closes it', { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, 'dashboard', async (page) => {
          await assertRealViewport(page, viewport);
          await openDrawer(page);
          await page.click(`${NAV} a[href="${VIEWS.containers}"]`);
          await page.waitForURL(/#!\/1\/docker\/containers$/);
          await assertDrawerClosed(page);
        });
      });

      // A person cannot tap the toggle behind a dialog, but a dialog can open while
      // the drawer is already open (for instance from a banner inside the drawer).
      // Either way both end up open, and the dialog must be the one on top.
      test('a dialog is not covered by the open drawer', { timeout: TEST_TIMEOUT }, async () => {
        await onView(viewport, 'containers', async (page) => {
          await assertRealViewport(page, viewport);
          // Opens the container removal confirmation. It is never confirmed.
          await page.locator('.datatable tbody tr').first().locator('input[type="checkbox"]').check({ force: true });
          await page.click('[data-cy="remove-docker-container-button"]');
          await page.waitForSelector('[role="dialog"]');
          await page.evaluate((selector) => document.querySelector(selector).click(), TOGGLE);

          const state = await eventually(async () => {
            const drawer = await page.evaluate(
              ([navSelector, backdropSelector]) => {
                const navElement = document.querySelector(navSelector);
                const backdropElement = document.querySelector(backdropSelector);
                const rect = navElement?.getBoundingClientRect();
                const style = navElement && getComputedStyle(navElement);
                return {
                  shown: !!rect && rect.width > 0 && rect.left >= -1 && rect.right <= window.innerWidth + 1 && style.visibility !== 'hidden' && style.display !== 'none',
                  backdrop: !!backdropElement && getComputedStyle(backdropElement).display !== 'none',
                };
              },
              [NAV, BACKDROP]
            );
            assert.ok(drawer.shown && drawer.backdrop, `the drawer should be open together with the dialog: ${JSON.stringify(drawer)}`);
            return drawer;
          });
          assert.ok(state.shown);

          const hits = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            const describeHit = (hit) => (hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${hit.dataset?.cy ? `[data-cy=${hit.dataset.cy}]` : ''}` : 'nothing');
            const buttons = [...dialog.querySelectorAll('button')].map((button) => {
              const rect = button.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return { label: button.textContent.trim() || button.getAttribute('aria-label') || 'button', onDialog: !!hit?.closest('[role="dialog"]'), topmost: describeHit(hit) };
            });
            // A point beside the dialog must land on the dialog's own overlay, not on the drawer or its backdrop.
            const beside = document.elementFromPoint(4, window.innerHeight / 2);
            return { buttons, besideOnOverlay: !!beside?.closest('[data-reach-dialog-overlay]'), besideTopmost: describeHit(beside) };
          });
          assert.ok(hits.buttons.length >= 2, 'the dialog should have buttons');
          for (const button of hits.buttons) {
            assert.ok(button.onDialog, `the dialog's "${button.label}" button is covered by ${button.topmost}`);
          }
          assert.ok(hits.besideOnOverlay, `beside the dialog the topmost element is ${hits.besideTopmost}, not the dialog's overlay`);
        });
      });
    });
  }

  for (const viewport of RAIL_VIEWPORTS) {
    test(`at ${viewport.name} the sidebar rail is kept and there is no backdrop`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, 'dashboard', async (page) => {
        await assertRealViewport(page, viewport);
        const state = await nav(page);
        assert.ok(state.open, `the sidebar should be on screen at ${viewport.width}px: ${JSON.stringify(state)}`);
        const left = await contentLeft(page);
        assert.ok(left >= 60, `the content starts ${left}px from the left edge; the sidebar rail should still take up room at ${viewport.width}px`);
        assert.equal((await backdrop(page)).visible, false, 'a backdrop is visible before the toggle was used');
        await page.click(TOGGLE);
        await page.waitForTimeout(500);
        assert.equal((await backdrop(page)).visible, false, `a backdrop is visible at ${viewport.width}px; it should only exist below ${DRAWER_BREAKPOINT}px`);
      });
    });
  }
});

// ---- 4. tables fit ---------------------------------------------------------

// Measures the shared data table inside the page.
function readTable() {
  const card = document.querySelector('.datatable');
  const table = card?.querySelector('table');
  if (!card || !table) {
    return { found: false };
  }
  const cardRect = card.getBoundingClientRect();

  // The nearest ancestor of the table, up to and including the card, that
  // scrolls horizontally.
  let scroller = null;
  for (let element = table.parentElement; element; element = element.parentElement) {
    const overflowX = getComputedStyle(element).overflowX;
    if (overflowX === 'auto' || overflowX === 'scroll') {
      scroller = element;
      break;
    }
    if (element === card) {
      break;
    }
  }
  let scrolling = null;
  if (scroller) {
    const before = scroller.scrollLeft;
    scroller.scrollLeft = 100000;
    scrolling = {
      tag: scroller.tagName.toLowerCase(),
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      moved: scroller.scrollLeft > before,
      insideCard: card.contains(scroller),
    };
    scroller.scrollLeft = before;
  }

  // Everything clickable in the toolbar, including the "Add container" link,
  // which is an anchor styled as a button.
  const buttons = [...card.querySelectorAll('.toolBar button, .toolBar a.btn')]
    .map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        label: (element.textContent || element.getAttribute('aria-label') || element.dataset.cy || element.tagName).trim().slice(0, 30),
        shown: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      };
    })
    .filter((button) => button.shown);

  return {
    found: true,
    card: { left: Math.round(cardRect.left), right: Math.round(cardRect.right) },
    viewportWidth: window.innerWidth,
    scroller: scrolling,
    buttons,
  };
}

describe('data tables fit on a phone', () => {
  for (const viewKey of ['containers', 'images']) {
    for (const viewport of PHONES) {
      test(`${viewKey} at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async (t) => {
        await onView(viewport, viewKey, async (page) => {
          await assertRealViewport(page, viewport);
          const table = await page.evaluate(readTable);
          assert.ok(table.found, 'no data table found on the page');

          await t.test('the card is inside the viewport', () => {
            assert.ok(
              table.card.left >= -1 && table.card.right <= table.viewportWidth + 1,
              `the card spans ${table.card.left}..${table.card.right}px in a ${table.viewportWidth}px window`
            );
          });

          await t.test('the table scrolls sideways inside the card', () => {
            assert.ok(table.scroller, 'no ancestor of the table (inside the card) has overflow-x auto or scroll');
            assert.ok(table.scroller.insideCard, 'the scrolling element is not inside the card');
            if (viewKey === 'containers') {
              // Nine columns cannot fit a phone, so the container list must really scroll.
              assert.ok(
                table.scroller.scrollWidth > table.scroller.clientWidth,
                `the table is not wider than its scroller (${table.scroller.scrollWidth} vs ${table.scroller.clientWidth})`
              );
            }
            if (table.scroller.scrollWidth > table.scroller.clientWidth) {
              assert.ok(table.scroller.moved, 'the scroller is wider than its box but does not scroll');
            }
          });

          await t.test('every toolbar button is inside the viewport and the card', () => {
            assert.ok(table.buttons.length > 0, 'no toolbar buttons found');
            if (viewKey === 'containers') {
              assert.ok(
                table.buttons.some((button) => button.label === 'Add container'),
                'the "Add container" button is missing from the toolbar'
              );
            }
            const outside = table.buttons.filter(
              (button) => button.left < -1 || button.right > table.viewportWidth + 1 || button.left < table.card.left - 1 || button.right > table.card.right + 1
            );
            assert.deepEqual(
              outside.map((button) => `${button.label} ${button.left}..${button.right}`),
              [],
              `these toolbar buttons are clipped (viewport 0..${table.viewportWidth}, card ${table.card.left}..${table.card.right})`
            );
          });
        });
      });
    }
  }
});
