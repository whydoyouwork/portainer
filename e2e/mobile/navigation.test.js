// Portainer's own ways of getting around must work at every size: the sidebar drawer, the header menus,
// the breadcrumbs, the tap size of the header controls. Each check returns a list of what is wrong and
// is shown to fail on a planted fault in the same run ("planted fault" tests), so a green result means
// the check can fail.

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, openView, withPage, eventually } = require('./lib/browser');
const { targetURL, VIEWPORTS } = require('./lib/config');

const { phone320, phone390, phoneLandscape, tablet767, tablet, tablet991 } = VIEWPORTS;
const PHONES = [phone320, phone390];
const SMALL_SCREENS = [phone320, phone390, phoneLandscape, tablet767, tablet, tablet991];
const BASE_URL = targetURL();
const TEST_TIMEOUT = 90000;

const TOGGLE = 'button[aria-label="Toggle Sidebar"]';
const CONTAINER = '#!/1/docker/containers';
// A container's own page has three breadcrumbs: Home > Containers > <name>.
const CONTAINER_DETAILS = (id) => `#!/1/docker/containers/${id}`;

let browser;
let storageState;
let containerId;

before(async () => {
  browser = await launch();
  storageState = await signIn(browser, BASE_URL);
  containerId = await withPage(browser, storageState, VIEWPORTS.desktop1440, async (page) => {
    await openView(page, BASE_URL, CONTAINER);
    const href = await page.locator('.datatable tbody tr a[href*="docker/containers/"]').first().getAttribute('href');
    return href.split('/').pop();
  });
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

// ---- checks (each returns a list of problems) ------------------------------

async function drawerProblems(page) {
  const problems = [];
  await page.locator(TOGGLE).tap();
  await eventually(async () => {
    const open = await page.evaluate(() => document.getElementById('page-wrapper').classList.contains('open'));
    assert.ok(open, 'the drawer did not open');
  });
  await eventually(async () => {
    const focusInside = await page.evaluate(() => document.querySelector('.sidebar').contains(document.activeElement));
    assert.ok(focusInside, 'focus did not move into the drawer when it opened');
  }).catch((e) => problems.push(e.message));

  const state = await page.evaluate(() => ({
    modal: document.querySelector('.sidebar').getAttribute('aria-modal') === 'true' && document.querySelector('.sidebar').getAttribute('role') === 'dialog',
    pageInert: document.getElementById('content-wrapper').hasAttribute('inert'),
  }));
  if (!state.modal) problems.push('the open drawer is not exposed as a modal dialog (role=dialog, aria-modal)');
  if (!state.pageInert) problems.push('the page behind the open drawer is not inert');

  let escaped = false;
  for (let i = 0; i < 45 && !escaped; i++) {
    await page.keyboard.press('Tab');
    escaped = !(await page.evaluate(() => document.querySelector('.sidebar').contains(document.activeElement)));
  }
  if (escaped) problems.push('Tab moved focus out of the open drawer');
  return problems;
}

async function closedDrawerProblems(page) {
  const reachable = await page.evaluate(() => {
    const drawer = document.querySelector('.sidebar');
    const style = getComputedStyle(drawer);
    return style.visibility !== 'hidden' && !drawer.hasAttribute('inert');
  });
  return reachable ? ['the closed drawer is off screen but its links can still be focused'] : [];
}

// The header menus open fully inside the window and close with Escape.
async function menuProblems(page) {
  const problems = [];
  for (const [name, button, list] of [
    ['user menu', '[data-cy=userMenu-button]', '[data-cy=userMenu]'],
    ['notifications menu', '[data-cy=notificationsMenu-button]', '[data-cy=notificationsMenu]'],
  ]) {
    await page.locator(button).first().tap();
    await page.waitForTimeout(400);
    const box = await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    }, list);
    if (!box) problems.push(`the ${name} did not open`);
    else if (box.left < -1 || box.right > box.width + 1 || box.top < -1 || box.bottom > box.height + 1) {
      problems.push(
        `the ${name} opens off screen: ${Math.round(box.left)}..${Math.round(box.right)} x ${Math.round(box.top)}..${Math.round(box.bottom)} in ${box.width}x${box.height}`
      );
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  return problems;
}

// The controls of the header are 44px to tap, at every size below the desktop layout.
async function headerTargetProblems(page) {
  const problems = [];
  for (const [name, selector] of [
    ['sidebar toggle', TOGGLE],
    ['home breadcrumb', '[data-cy=breadcrumb-home]'],
    ['notifications', '[data-cy=notificationsMenu-button]'],
    ['help', '[data-cy=context-help-button]'],
    ['user menu', '[data-cy=userMenu-button]'],
  ]) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) problems.push(`${name} not found`);
    else if (box.width < 43.5 || box.height < 43.5) problems.push(`${name} is ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  return problems;
}

// Every crumb is shown in full, wrapping rather than cut with an ellipsis or clipped.
async function breadcrumbProblems(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-cy=breadcrumb-home]').closest('.flex.items-center.gap-2').parentElement;
    const problems = [];
    const width = document.documentElement.clientWidth;
    for (const node of root.querySelectorAll('span, a')) {
      if (!node.textContent.trim() || node.querySelector('span, a')) continue;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (rect.right > width + 1) problems.push(`"${node.textContent.trim()}" runs past the window edge`);
      for (let el = node; el && el !== document.body; el = el.parentElement) {
        const s = getComputedStyle(el);
        if (/(hidden|clip)/.test(s.overflowX) && (el.scrollWidth > el.clientWidth + 1 || (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth))) {
          problems.push(`"${node.textContent.trim()}" is cut off by ${el.tagName.toLowerCase()}`);
          break;
        }
      }
      if (style.textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth + 1) problems.push(`"${node.textContent.trim()}" ends in an ellipsis`);
      // A short single word is never broken across lines: that is a column too narrow to read, not a wrap.
      const word = node.textContent.trim();
      if (word.length <= 20 && !/[\s-]/.test(word)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        if (range.getClientRects().length > 1) problems.push(`"${word}" is broken across ${range.getClientRects().length} lines`);
      }
    }
    return problems;
  });
}

// ---- the collapsed rail: a tap on a parent opens its sub-menu -------------------

const RAIL_PARENT = '.sidebar button > a[data-cy$="-link"]';
const FLYOUT = '.tippy-box a[href]';

async function hashOf(page) {
  return page.evaluate(() => location.hash);
}

async function flyoutLinks(page) {
  return page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('href')), FLYOUT);
}

// On a touch screen the rail has no hover, so a tap on a rail item that has sub-items opens them (instead of
// following the parent's link), they can be read, closed again, and choosing one goes there and closes them.
async function railFlyoutProblems(page) {
  const problems = [];
  const parent = page.locator(RAIL_PARENT).first();
  const startHash = await hashOf(page);

  await parent.tap();
  await page.waitForTimeout(400);
  if ((await hashOf(page)) !== startHash) problems.push(`tapping a rail item with sub-items followed its link (${startHash} -> ${await hashOf(page)})`);
  const opened = await flyoutLinks(page);
  if (opened.length === 0) problems.push('tapping a rail item with sub-items did not show its sub-menu');
  const state = await parent.evaluate((a) => ({ expanded: a.getAttribute('aria-expanded'), name: a.getAttribute('aria-label') }));
  if (state.expanded !== 'true') problems.push(`the open sub-menu is not announced (aria-expanded is ${state.expanded})`);
  if (!state.name) problems.push('the rail item has no accessible name');

  // Escape closes it and focus goes back to the rail item
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await flyoutLinks(page)).length !== 0) problems.push('Escape did not close the sub-menu');
  const focusBack = await parent.evaluate((a) => document.activeElement === a);
  if (!focusBack) problems.push('focus did not return to the rail item after Escape');
  if ((await parent.getAttribute('aria-expanded')) !== 'false') problems.push('the closed sub-menu is still announced as expanded');

  // a tap outside closes it
  await parent.tap();
  await page.waitForTimeout(300);
  if ((await flyoutLinks(page)).length === 0) problems.push('the sub-menu did not open a second time');
  await page.touchscreen.tap(600, 700);
  await page.waitForTimeout(300);
  if ((await flyoutLinks(page)).length !== 0) problems.push('a tap outside did not close the sub-menu');

  // choosing a sub-item goes there and closes the sub-menu
  await parent.tap();
  await page.waitForTimeout(300);
  const target = (await flyoutLinks(page))[0];
  if (target) {
    await page.locator(FLYOUT).first().tap();
    await page.waitForTimeout(800);
    if ((await hashOf(page)) !== target) problems.push(`choosing a sub-item did not go to it (${await hashOf(page)}, expected ${target})`);
    if ((await flyoutLinks(page)).length !== 0) problems.push('the sub-menu stayed open after choosing a sub-item');
  }
  return problems;
}

// An item with no sub-items is unchanged: a tap goes straight to it.
async function railLeafProblems(page) {
  await page.locator('[data-cy=portainerSidebar-home]').first().tap();
  await page.waitForTimeout(800);
  const hash = await hashOf(page);
  return /#!\/home/.test(hash) ? [] : [`tapping Home on the rail went to ${hash}`];
}

// ---- the tests --------------------------------------------------------------

describe('sidebar drawer as a dialog (phones)', () => {
  for (const viewport of PHONES) {
    test(`opens as a modal, takes focus and keeps it at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        assert.deepEqual(await closedDrawerProblems(page), []);
        assert.deepEqual(await drawerProblems(page), []);
      });
    });

    // Planted fault: the page behind is not made inert, and Tab is allowed to leave the drawer.
    test(`planted fault: an open drawer that is not modal is reported at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await page.evaluate(() => {
          window.addEventListener('keydown', (event) => event.key === 'Tab' && event.stopPropagation(), true);
          new MutationObserver(() => document.getElementById('content-wrapper').removeAttribute('inert')).observe(document.getElementById('content-wrapper'), { attributes: true });
        });
        const problems = await drawerProblems(page);
        assert.ok(
          problems.some((p) => /inert/.test(p)),
          `expected the inert fault, got: ${problems.join('; ')}`
        );
        assert.ok(
          problems.some((p) => /Tab moved focus out/.test(p)),
          `expected the focus fault, got: ${problems.join('; ')}`
        );
      });
    });

    test(`planted fault: a closed drawer that can still be focused is reported at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        await page.addStyleTag({ content: '.sidebar{visibility:visible !important}' });
        await page.evaluate(() => document.querySelector('.sidebar').removeAttribute('inert'));
        assert.equal((await closedDrawerProblems(page)).length, 1);
      });
    });
  }
});

describe('header menus open on screen', () => {
  for (const viewport of SMALL_SCREENS) {
    test(`the user and notifications menus at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        assert.deepEqual(await menuProblems(page), []);
      });
    });
  }

  test('planted fault: a menu pushed off screen is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone320, CONTAINER, async (page) => {
      await page.addStyleTag({ content: '[data-reach-popover]{transform: translateX(260px) !important}' });
      const problems = await menuProblems(page);
      assert.ok(
        problems.some((p) => /off screen/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });
});

describe('header controls are 44px to tap (below the desktop layout)', () => {
  for (const viewport of SMALL_SCREENS) {
    test(`at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        assert.deepEqual(await headerTargetProblems(page), []);
      });
    });
  }

  test('planted fault: small header controls are reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER, async (page) => {
      await page.addStyleTag({
        content:
          '[data-cy=userMenu-button],[data-cy=notificationsMenu-button],[data-cy=context-help-button],button[aria-label="Toggle Sidebar"],[data-cy=breadcrumb-home]{padding:0 !important;margin:0 !important;min-width:0 !important;min-height:0 !important;width:24px !important;height:24px !important}',
      });
      assert.ok((await headerTargetProblems(page)).length >= 3);
    });
  });
});

describe('breadcrumbs show every destination in full', () => {
  for (const viewport of SMALL_SCREENS) {
    test(`Home > Containers > the container's name at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER_DETAILS(containerId), async (page) => {
        assert.deepEqual(await breadcrumbProblems(page), []);
        const crumbs = await page.evaluate(() => [...document.querySelectorAll('[data-cy=breadcrumb-home]')].length);
        assert.equal(crumbs, 1);
      });
    });
  }

  // Planted fault: the first crumb is squeezed into 60px, so its word breaks letter by letter.
  test('planted fault: a crumb broken letter by letter is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, CONTAINER_DETAILS(containerId), async (page) => {
      await page.evaluate(() => {
        const group = document.querySelector('[data-cy=breadcrumb-home]').parentElement;
        group.style.cssText = 'flex:none;width:60px';
      });
      const problems = await breadcrumbProblems(page);
      assert.ok(
        problems.some((p) => /broken across/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });

  // Planted fault: the vendor's own truncation put back on the crumbs.
  test('planted fault: crumbs cut with an ellipsis are reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone320, CONTAINER_DETAILS(containerId), async (page) => {
      await page.evaluate(() => {
        const root = document.querySelector('[data-cy=breadcrumb-home]').closest('.flex.items-center.gap-2').parentElement;
        root.style.cssText = 'width:110px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex-wrap:nowrap';
        root.parentElement.style.overflow = 'hidden';
      });
      const problems = await breadcrumbProblems(page);
      assert.ok(problems.length > 0, 'the cut breadcrumbs were not reported');
    });
  });
});

describe('the collapsed rail on tablets', () => {
  // The rail shows a parent's children in a tooltip on hover. A finger has no hover, so the sidebar's own
  // toggle expands the full menu, and every destination is on it. This pins that way in.
  for (const viewport of [tablet, tablet991]) {
    test(`the toggle expands the sidebar and every destination is reachable at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        const railHrefs = await page.evaluate(() =>
          [...document.querySelectorAll('.sidebar a[href]')].filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('href'))
        );
        assert.ok(railHrefs.length > 5, `the rail shows only ${railHrefs.length} links`);
        await page.locator(TOGGLE).tap();
        await eventually(async () => {
          const opened = await page.evaluate(() => document.getElementById('page-wrapper').classList.contains('open'));
          assert.ok(opened, 'the sidebar did not expand');
        });
        // Every destination on the rail is also in the expanded menu, which shows its labels.
        const expandedHrefs = await page.evaluate(() => [...document.querySelectorAll('.sidebar a[href]')].map((a) => a.getAttribute('href')));
        const missing = railHrefs.filter((href) => !expandedHrefs.includes(href));
        assert.deepEqual(missing, [], `destinations on the rail that the expanded sidebar lacks: ${missing.join(', ')}`);
        const labelled = await page.evaluate(
          () => [...document.querySelectorAll('.sidebar a[href]')].filter((a) => a.getBoundingClientRect().width > 0 && a.textContent.trim()).length
        );
        assert.ok(labelled > 3, 'the expanded sidebar shows no labels');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `with the sidebar expanded the page is ${overflow}px wider than the window`);
      });
    });
  }
});

describe('the collapsed rail opens a sub-menu on tap (touch tablets)', () => {
  for (const viewport of [tablet, tablet991]) {
    test(`a tap opens, Escape and an outside tap close, a choice navigates at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        assert.deepEqual(await railFlyoutProblems(page), []);
      });
    });

    test(`an item without sub-items still goes straight there at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, CONTAINER, async (page) => {
        assert.deepEqual(await railLeafProblems(page), []);
      });
    });
  }

  // Planted fault: a tap that follows the parent's link, as the unchanged rail does.
  test('planted fault: a tap that follows the parent link is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, CONTAINER, async (page) => {
      await page.evaluate(() => {
        window.addEventListener(
          'click',
          (event) => {
            const link = event.target.closest && event.target.closest('a[data-cy$="-link"]');
            if (link) location.hash = link.getAttribute('href');
          },
          true
        );
      });
      const problems = await railFlyoutProblems(page);
      assert.ok(
        problems.some((p) => /followed its link/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });
});
