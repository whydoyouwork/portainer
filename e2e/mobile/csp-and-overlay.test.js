// The checks run with the page's Content-Security-Policy on, and the desktop
// layout must have nothing laid over it that would swallow clicks.

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, openView, withPage } = require('./lib/browser');
const { collectViolations, readBaselineViolations } = require('./lib/csp');
const { targetURL, VIEWS, VIEWPORTS } = require('./lib/config');

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

describe('content security policy', () => {
  test('the page is served with a policy that blocks inline scripts', { timeout: TEST_TIMEOUT }, async () => {
    const response = await withPage(browser, storageState, VIEWPORTS.desktop1440, (page) => page.request.get(`${BASE_URL}/`));
    const policy = response.headers()['content-security-policy'];
    assert.ok(policy, 'the page has no Content-Security-Policy header');
    const scriptSrc = policy
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('script-src'));
    assert.ok(scriptSrc, `the policy has no script-src directive: ${policy}`);
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), `script-src allows inline scripts: ${scriptSrc}`);
  });

  // The unchanged application already raises a couple of violations (it uses
  // eval), so the check is that the changed build raises exactly the same ones.
  for (const viewKey of ['home', 'containers', 'containers-new']) {
    for (const viewport of [VIEWPORTS.phone360, VIEWPORTS.desktop1440]) {
      test(`${viewKey} at ${viewport.name} raises the same policy violations as the unchanged build`, { timeout: TEST_TIMEOUT }, async () => {
        const expected = readBaselineViolations()[viewKey];
        assert.ok(expected, `no recorded violations for ${viewKey}; run capture-baselines.js against an unchanged build`);
        const actual = await collectViolations(browser, storageState, BASE_URL, viewport, viewKey);
        assert.deepEqual(actual, expected, 'the policy violations differ from the unchanged build');
      });
    }
  }
});

// On a desktop the drawer's backdrop must not exist as a layer: whatever is on
// top at the centre of a control has to be that control. This is a hit test,
// not an opacity test, so a transparent layer that swallows clicks is caught.
const CLICK_TARGETS = {
  'the sidebar toggle': 'button[aria-label="Toggle Sidebar"]',
  'the Containers sidebar link': 'nav[aria-label="Main"] a[href="#!/1/docker/containers"]',
  'the Add container button': '[data-cy="add-docker-container-button"]',
  'the search box': '[data-cy="docker-containers-datatable-header-search-input"]',
  'the first container link': '.datatable tbody tr a',
};

function hitTest(targets) {
  return Object.entries(targets).map(([name, selector]) => {
    const element = document.querySelector(selector);
    if (!element) {
      return { name, found: false };
    }
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      name,
      found: true,
      inViewport: x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight,
      covered: !(hit && element.contains(hit)),
      topmost: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${hit.dataset?.cy ? `[data-cy=${hit.dataset.cy}]` : ''}` : 'nothing',
    };
  });
}

describe('nothing covers the desktop layout', () => {
  for (const viewport of [VIEWPORTS.desktop1440, VIEWPORTS.desktop1920]) {
    test(`controls are on top at ${viewport.name}`, { timeout: TEST_TIMEOUT }, async () => {
      await withPage(browser, storageState, viewport, async (page) => {
        await openView(page, BASE_URL, VIEWS.containers);
        const results = await page.evaluate(hitTest, CLICK_TARGETS);
        for (const result of results) {
          assert.ok(result.found, `${result.name} was not found on the page`);
          assert.ok(result.inViewport, `${result.name} is outside the viewport`);
          assert.equal(result.covered, false, `${result.name} is covered: ${result.topmost} is on top at its centre`);
        }
      });
    });
  }
});
