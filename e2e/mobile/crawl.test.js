// Visits every view the application links to, at the phone and tablet sizes, and applies the
// "nothing runs off the page, nothing is cut, nothing collides" measurements (lib/measure.js) to each.
//
// The views come from following the application's links (lib/crawl.js), so a new screen is covered
// the day it is linked. A floor on the number found makes a crawl that finds one page fail instead of
// pass. Sizes: set MOBILE_CRAWL_SIZES (comma separated names from lib/config.js) to run fewer.

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, settle, withPage } = require('./lib/browser');
const { discoverRoutes, routeTemplate } = require('./lib/crawl');
const { targetURL, VIEWPORTS } = require('./lib/config');
const measure = require('./lib/measure');

const BASE_URL = targetURL();
// A crawl of this application finds about fifty view templates; far fewer means it stopped following links.
const FLOOR = 40;

const ALL = ['phone320', 'phone360', 'phone390', 'phoneLandscape', 'tablet767', 'tablet', 'tablet991'];
const chosen = (process.env.MOBILE_CRAWL_SIZES || 'phone320,phone390,phoneLandscape,tablet767,tablet,tablet991').split(',');
const SIZES = chosen.map((key) => {
  assert.ok(ALL.includes(key), `unknown size ${key}`);
  return VIEWPORTS[key];
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

describe('the crawl', () => {
  test(`finds at least ${FLOOR} views by following links`, () => {
    assert.ok(found.routes.length >= FLOOR, `only ${found.routes.length} views found: ${found.routes.join(', ')}`);
  });

  test('records what it did not open, and why', () => {
    // Not opened: it leaves the app, ends the session, or opens a console on the machine.
    for (const link of found.skipped) assert.match(link, /logout|auth|kubeconfig|exec|console|attach|kubernetes-settings/);
  });

  test('one route per template: a hash in a route does not count twice', () => {
    const templates = found.routes.map(routeTemplate);
    assert.equal(new Set(templates).size, templates.length);
  });
});

describe('every linked view at phone and tablet sizes', () => {
  for (const viewport of SIZES) {
    test(`nothing runs off the page, is cut off or collides at ${viewport.name}`, { timeout: 900000 }, async () => {
      await withPage(browser, storageState, viewport, async (page) => {
        const failures = [];
        for (const route of found.routes) {
          await page.goto(`${BASE_URL}/${route}`);
          await page.waitForSelector('button[aria-label="Toggle Sidebar"]', { timeout: 30000 });
          await settle(page, { quietMs: 400 });
          // The measurements mean nothing on a desktop-width layout (a missing viewport tag).
          const width = await page.evaluate(() => document.documentElement.clientWidth);
          assert.equal(width, viewport.width, `${route}: the page lays out at ${width}px instead of ${viewport.width}px`);
          const [off, clipped, truncated, overlaps] = await Promise.all([
            page.evaluate(measure.findOffScreen),
            page.evaluate(measure.findClippedCtas),
            page.evaluate(measure.findTruncated),
            page.evaluate(measure.findOverlaps),
          ]);
          for (const [kind, list] of [
            ['off screen', off],
            ['cut call to action', clipped],
            ['cut text', truncated],
            ['overlap', overlaps],
          ]) {
            for (const violation of list) failures.push(`${route} [${kind}] ${violation}`);
          }
        }
        assert.deepEqual(failures, [], `${failures.length} problem(s) at ${viewport.name}:\n${failures.join('\n')}`);
      });
    });
  }
});

describe('touch targets on phones', () => {
  for (const viewport of [VIEWPORTS.phone390, VIEWPORTS.tablet]) {
    test(`controls reach 44px at ${viewport.name}`, { timeout: 900000 }, async () => {
      await withPage(browser, storageState, viewport, async (page) => {
        const failures = [];
        for (const route of found.routes) {
          await page.goto(`${BASE_URL}/${route}`);
          await page.waitForSelector('button[aria-label="Toggle Sidebar"]', { timeout: 30000 });
          await settle(page, { quietMs: 400 });
          for (const violation of await page.evaluate(measure.findSmallTargets, 44)) failures.push(`${route} ${violation}`);
        }
        assert.deepEqual(failures, [], `${failures.length} control(s) under 44px at ${viewport.name}:\n${failures.join('\n')}`);
      });
    });
  }
});

describe('the measurements on the real application: planted faults', () => {
  const containers = '#!/1/docker/containers';

  async function measureAll(page) {
    return [...(await page.evaluate(measure.findOffScreen)), ...(await page.evaluate(measure.findClippedCtas)), ...(await page.evaluate(measure.findTruncated))];
  }

  async function onContainers(fn) {
    await withPage(browser, storageState, VIEWPORTS.phone390, async (page) => {
      await page.goto(`${BASE_URL}/${containers}`);
      await page.waitForSelector('button[aria-label="Toggle Sidebar"]', { timeout: 30000 });
      await settle(page, { quietMs: 400 });
      await fn(page);
    });
  }

  test('the unchanged containers view reports nothing', { timeout: 120000 }, async () => {
    await onContainers(async (page) => assert.deepEqual(await measureAll(page), []));
  });

  // Mutation: the table toolbar keeps its buttons on one line and clips them, as it did before the fix.
  test('planted fault: a toolbar that cannot wrap is reported', { timeout: 120000 }, async () => {
    await onContainers(async (page) => {
      await page.addStyleTag({ content: '.datatable .toolBar .btn-group{flex-wrap:nowrap !important;width:640px !important} .datatable .toolBar{overflow:hidden !important}' });
      const violations = await measureAll(page);
      assert.ok(violations.length > 0, 'the clipped toolbar buttons were not reported');
    });
  });

  // Mutation: a page wider than the screen.
  test('planted fault: a page wider than the screen is reported', { timeout: 120000 }, async () => {
    await onContainers(async (page) => {
      await page.addStyleTag({ content: '#view .datatable{min-width:600px !important}' });
      const violations = await measureAll(page);
      assert.ok(
        violations.some((v) => /wide|spans/.test(v)),
        `got: ${violations.join('; ')}`
      );
    });
  });

  // Mutation: a long name cut with an ellipsis and not inside a link.
  test('planted fault: a cut-off label with nothing to tap is reported', { timeout: 120000 }, async () => {
    await onContainers(async (page) => {
      await page.evaluate(() => {
        const label = document.querySelector('h1[data-cy="page-title"]');
        label.style.cssText = 'display:block;width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      });
      const violations = await measureAll(page);
      assert.ok(
        violations.some((v) => /cut off/.test(v)),
        `got: ${violations.join('; ')}`
      );
    });
  });
});
