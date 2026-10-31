// Text links on phones and tablets: every visible link has 4.5:1 or more against what is painted behind it
// (WCAG 1.4.3), on every view the application links to, in the light theme. The dark and high contrast themes keep
// the vendor's colours, and so do widths from 992px; links that carry a colour of their own (buttons, tabs, the
// breadcrumbs, the drawer) are not recoloured. Link-style buttons (`.btn-link`) are read the same way, against
// what is really behind each one: some sit on a dark panel, where the darker blue that suits white is unreadable.
//
// The views come from following the application's links (lib/crawl.js). The measurement is in lib/measure.js and
// has its own fixtures (measure.fixtures.test.js).

const fs = require('node:fs');
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, settle, withPage, eventually } = require('./lib/browser');
const { discoverRoutes } = require('./lib/crawl');
const { targetURL, VIEWPORTS } = require('./lib/config');
const { measureLinkContrasts, readBackgroundImages, lowContrastLinks } = require('./lib/measure');
const { MOTD_FIXTURE } = require('./lib/capture');

const { phone390, tablet, tablet991, desktop992, desktop1440 } = VIEWPORTS;
const BASE_URL = targetURL();
const TEST_TIMEOUT = 900000;
const TOGGLE = 'button[aria-label="Toggle Sidebar"]';

const VENDOR_BLUE = 'rgb(0, 134, 201)'; // blue-8, 4.0:1 on white
const LINK_BLUE = 'rgb(2, 106, 162)'; // blue-9
const LINK_BLUE_HOVER = 'rgb(6, 89, 134)'; // blue-10
const VENDOR_DOC_BLUE = 'rgb(51, 122, 183)'; // the link of a help text beside a web editor, 4.14:1 on its grey panel
const BUTTON_LINK = '.btn-link';
const DISMISS = '[data-cy="dismiss-information-panel-button"]';
const MIN_BUTTONS = 10; // a measurement that reads no buttons would pass everything
const NEWS_BUTTON_TEXT = 'rgb(247, 246, 243)'; // the text of the news panel's button, 12.37:1 on its dark panel

// The news banner is remote content; a small notice with a link in it stands in for it (the same for every run).
const NOTICE = JSON.stringify({
  ...JSON.parse(fs.readFileSync(MOTD_FIXTURE, 'utf8')),
  Message: '<p>A short sample message with <a href="https://example.invalid/news">a link in it</a>.</p>',
});

let browser;
let storageState;
let found;

before(
  async () => {
    browser = await launch();
    storageState = await signIn(browser, BASE_URL);
    found = await withPage(browser, storageState, VIEWPORTS.desktop1440, (page) => discoverRoutes(page, BASE_URL, { settle: (p) => settle(p, { quietMs: 300 }) }));
  },
  { timeout: 300000 }
);

after(async () => {
  await browser?.close();
});

async function setTheme(page, theme) {
  // the attribute the application itself sets on <html>; the stored theme preference is not touched
  await page.evaluate((t) => (t === 'light' ? document.documentElement.removeAttribute('theme') : document.documentElement.setAttribute('theme', t)), theme);
  await page.waitForTimeout(250);
}

// The links (or, with a selector, the link-style buttons) on the page, with the contrast of each one; those on a
// background image are read from the pixels.
async function readLinks(page, selector = 'a') {
  return readBackgroundImages(page, browser, await page.evaluate(measureLinkContrasts, selector), selector);
}

async function open(page, route, theme = 'light') {
  await page.route('**/api/motd', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: NOTICE }));
  await page.goto(`${BASE_URL}/${route}`);
  await page.waitForSelector(TOGGLE, { timeout: 30000 });
  await settle(page, { quietMs: 400 });
  await setTheme(page, theme);
}

function onView(viewport, route, fn, theme = 'light') {
  return withPage(browser, storageState, viewport, async (page) => {
    await open(page, route, theme);
    return fn(page);
  });
}

// Mutation: remove the "Links" rules of bootstrap-mobile.css (the build before they were added): a container's,
// an image's and a user's name, the Home and dashboard links are the vendor's blue, 4.00:1 on white (3.87:1 and
// 3.93:1 on the Home and dashboard links' panels).
describe('every visible link reaches 4.5:1 in the light theme', () => {
  for (const viewport of [phone390, tablet, tablet991]) {
    test(`on every linked view at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await withPage(browser, storageState, viewport, async (page) => {
        const failures = [];
        let checked = 0;
        let buttons = 0;
        for (const route of found.routes) {
          await open(page, route);
          const entries = await readLinks(page);
          checked += entries.length;
          for (const problem of lowContrastLinks(entries)) failures.push(`${route} ${problem}`);
          const buttonEntries = await readLinks(page, BUTTON_LINK);
          buttons += buttonEntries.length;
          for (const problem of lowContrastLinks(buttonEntries)) failures.push(`${route} button ${problem}`);
        }
        // a measurement that reads no links would pass everything
        assert.ok(checked >= 100, `only ${checked} links were read on ${found.routes.length} views`);
        assert.ok(buttons >= MIN_BUTTONS, `only ${buttons} link-style buttons were read on ${found.routes.length} views`);
        assert.deepEqual(failures, [], `${failures.length} link(s) under 4.5:1 at ${viewport.name}:\n${failures.join('\n')}`);
      });
    });
  }

  // The drawer of a phone is dark: its links must not be taken for the blue of a link on white.
  test(`in the open drawer at ${phone390.name}`, { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, '#!/1/docker/containers', async (page) => {
      await page.locator(TOGGLE).tap();
      await eventually(async () => assert.ok(await page.evaluate(() => document.getElementById('page-wrapper').classList.contains('open')), 'the drawer did not open'));
      await page.waitForTimeout(500);
      const entries = (await readLinks(page)).filter((e) => /^(Home|Dashboard|Containers|Images)$/.test(e.text));
      assert.ok(entries.length >= 3, `only ${entries.length} drawer links were read`);
      assert.deepEqual(lowContrastLinks(entries), []);
      for (const e of entries) assert.notEqual(e.color, LINK_BLUE, `"${e.text}" in the drawer has the link blue`);
    });
  });

  // Planted fault: the vendor's blue on every link, as the build without the rules has it.
  test('planted fault: the vendor blue on white is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, '#!/users', async (page) => {
      assert.deepEqual(lowContrastLinks(await readLinks(page)), [], 'the users view has a link under 4.5:1 before the fault is planted');
      await page.addStyleTag({ content: `body a:not(.btn) { color: ${VENDOR_BLUE} !important }` });
      const problems = lowContrastLinks(await readLinks(page));
      assert.ok(problems.length >= 3, `got: ${problems.join('; ')}`);
      assert.ok(
        problems.every((p) => /4\.00:1/.test(p)),
        `got: ${problems.join('; ')}`
      );
    });
  });

  // The link in the notice of the Home view, and the one beside a web editor, sit on tinted panels.
  test(`the links on tinted panels (the notice, a help text) at ${phone390.name}`, { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, '#!/home', async (page) => {
      const entries = (await readLinks(page)).filter((e) => e.text === 'a link in it');
      assert.equal(entries.length, 1, 'the notice and its link are not on the Home view');
      assert.deepEqual(lowContrastLinks(entries), []);
    });
    await onView(phone390, '#!/1/docker/stacks/newstack', async (page) => {
      const entries = (await readLinks(page)).filter((e) => e.text === 'official documentation');
      assert.ok(entries.length >= 1, 'no documentation link beside the web editor');
      assert.deepEqual(lowContrastLinks(entries), []);
      for (const e of entries) assert.notEqual(e.background, 'rgb(255, 255, 255)', 'the link is not on a tinted panel, so this checks nothing');
    });
  });
});

// The "dismiss" button of the news panel on the Home view is a link-style button on a dark panel, in every theme. It has a
// colour of its own, so the darker blue that the other link-style buttons use on white must not reach it.
// Mutation: take the theme conditions of the `.btn-link` rule of bootstrap-mobile.css out of `where` (its specificity is
// then higher than the news panel's rule, and the button is #026aa2 on #2e2f33, 2.28:1, 1.77:1 on hover).
describe('the dismiss button of the news panel keeps its colours', () => {
  for (const viewport of [phone390, tablet, tablet991]) {
    test(`it is readable at rest and on hover in the light theme at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, '#!/home', async (page) => {
        const button = page.locator(DISMISS);
        assert.equal(await button.count(), 1, 'the news panel has no dismiss button');
        const rest = await readLinks(page, DISMISS);
        assert.equal(rest.length, 1);
        assert.equal(rest[0].color, NEWS_BUTTON_TEXT);
        assert.deepEqual(lowContrastLinks(rest), []);
        await button.hover();
        await page.waitForTimeout(250);
        const hovered = await readLinks(page, DISMISS);
        assert.equal(hovered[0].color, NEWS_BUTTON_TEXT, 'hover changes the colour');
        assert.deepEqual(lowContrastLinks(hovered), []);
      });
    });
  }

  for (const [theme, viewport] of [
    ['dark', phone390],
    ['highcontrast', phone390],
  ]) {
    test(`it is readable in the ${theme} theme at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(
        viewport,
        '#!/home',
        async (page) => {
          const rest = await readLinks(page, DISMISS);
          assert.equal(rest.length, 1);
          assert.deepEqual(lowContrastLinks(rest), []);
        },
        theme
      );
    });
  }

  // Planted fault: the darker blue of the light theme's link-style buttons put on the button.
  test('planted fault: the blue of the link-style buttons on the dark panel is reported', { timeout: TEST_TIMEOUT }, async () => {
    await onView(phone390, '#!/home', async (page) => {
      await page.addStyleTag({ content: `:root:root:root body ${DISMISS} { color: ${LINK_BLUE} !important }` });
      const problems = lowContrastLinks(await readLinks(page, DISMISS));
      assert.equal(problems.length, 1, `got: ${problems.join('; ')}`);
      assert.match(problems[0], /2\.28:1/);
    });
  });

  // From 992px up the vendor's colours stay.
  test(`it keeps the vendor's colours at ${desktop1440.name}`, { timeout: TEST_TIMEOUT }, async () => {
    await onView(desktop1440, '#!/home', async (page) => {
      assert.equal(await page.locator(DISMISS).evaluate((el) => getComputedStyle(el).color), NEWS_BUTTON_TEXT);
    });
  });
});

describe('link colours on phones and tablets', () => {
  const USERS = '#!/users';

  const plainLink = (page) => page.locator('a', { hasText: /^Teams view$/ }).first();

  test(`a text link is the darker blue and its hover darker still at ${tablet.name}`, { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet, USERS, async (page) => {
      const link = plainLink(page);
      assert.equal(await link.evaluate((el) => getComputedStyle(el).color), LINK_BLUE);
      await link.hover();
      await page.waitForTimeout(250);
      assert.equal(await link.evaluate((el) => getComputedStyle(el).color), LINK_BLUE_HOVER);
    });
  });

  // Mutation: the hover rule is dropped (the vendor's hover is the same blue-9 as the resting colour).
  test(`a hovered link is told apart from one at rest at ${tablet991.name}`, { timeout: TEST_TIMEOUT }, async () => {
    await onView(tablet991, '#!/1/docker/containers', async (page) => {
      const link = page.locator('.datatable tbody tr a[href*="docker/containers/"]').first();
      const rest = await link.evaluate((el) => getComputedStyle(el).color);
      await link.hover();
      await page.waitForTimeout(250);
      assert.notEqual(await link.evaluate((el) => getComputedStyle(el).color), rest);
    });
  });

  // A link with a colour of its own keeps it. Mutation: drop `where` from the rule (it then outranks the classes
  // that colour a button, a breadcrumb or a tab), or select `a` with a theme condition that is not `where`.
  test(`a link that has a colour of its own keeps it at ${phone390.name}`, { timeout: TEST_TIMEOUT }, async () => {
    const colours = (page, selector) => page.$$eval(selector, (els) => [...new Set(els.map((el) => getComputedStyle(el).color))]);
    await onView(phone390, '#!/1/docker/containers', async (page) => {
      assert.deepEqual(await colours(page, 'a.btn-primary'), ['rgb(247, 246, 243)'], 'a primary button');
      assert.deepEqual(await colours(page, 'a.text-gray-8'), ['rgb(71, 84, 103)'], 'a breadcrumb');
      await page.locator(TOGGLE).tap();
      await page.waitForTimeout(700);
      const drawer = await colours(page, '.sidebar a');
      assert.ok(drawer.length > 0 && drawer.every((c) => c === 'rgb(242, 244, 247)' || c === 'rgb(255, 255, 255)'), `drawer links: ${drawer.join(', ')}`);
    });
    await onView(phone390, '#!/1/docker/images/build', async (page) => {
      assert.deepEqual(await colours(page, '.nav-tabs > li.active > a'), ['rgb(85, 85, 85)'], 'the active tab');
    });
  });

  // The dark and high contrast themes keep the vendor's colours, and they must pass too.
  // Mutation: apply the rule in every theme and with !important. (The theme conditions alone do not matter: `where` already
  // leaves the vendor's rules for the dark and high contrast themes in force.)
  for (const [theme, colour] of [
    ['dark', 'rgb(11, 165, 236)'],
    ['highcontrast', 'rgb(124, 212, 253)'],
  ]) {
    test(`the ${theme} theme keeps the vendor's colours and reaches 4.5:1 at ${phone390.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await withPage(browser, storageState, phone390, async (page) => {
        const failures = [];
        let checked = 0;
        let buttons = 0;
        for (const route of found.routes) {
          await open(page, route, theme);
          const entries = await readLinks(page);
          checked += entries.length;
          for (const problem of lowContrastLinks(entries)) failures.push(`${route} ${problem}`);
          const buttonEntries = await readLinks(page, BUTTON_LINK);
          buttons += buttonEntries.length;
          for (const problem of lowContrastLinks(buttonEntries)) failures.push(`${route} button ${problem}`);
        }
        assert.ok(checked >= 100, `only ${checked} links were read`);
        assert.ok(buttons >= MIN_BUTTONS, `only ${buttons} link-style buttons were read`);
        assert.deepEqual(failures, [], `${failures.length} link(s) under 4.5:1 in the ${theme} theme:\n${failures.join('\n')}`);
        await open(page, USERS, theme);
        assert.equal(await plainLink(page).evaluate((el) => getComputedStyle(el).color), colour);
      });
    });
  }

  // From 992px up the vendor's blue stays. Mutation: take the media query off the rules.
  for (const viewport of [desktop992, desktop1440, VIEWPORTS.desktop1920]) {
    test(`the vendor's blues stay at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await onView(viewport, USERS, async (page) => {
        assert.equal(await plainLink(page).evaluate((el) => getComputedStyle(el).color), VENDOR_BLUE);
      });
      await onView(viewport, '#!/1/docker/stacks/newstack', async (page) => {
        const colours = await page.$$eval('.web-editor a', (els) => [...new Set(els.map((el) => getComputedStyle(el).color))]);
        assert.deepEqual(colours, [VENDOR_DOC_BLUE]);
      });
    });
  }
});
