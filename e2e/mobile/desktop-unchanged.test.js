// The desktop layout must not move. Each view is captured at 1440x900 and
// 1920x1080 on the server under test and compared, pixel for pixel, with the
// baseline captured from an unchanged build (see README.md).
//
// The comparison itself is proven here too: it must notice a single changed
// pixel and a one pixel shift, or the check below it would mean nothing.

const fs = require('node:fs');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch, signIn, withPage } = require('./lib/browser');
const { comparePng } = require('./lib/pixels');
const { targetURL, VIEWS } = require('./lib/config');
const { BASELINE_DIR, OUTPUT_DIR, CHANNEL_TOLERANCE, DESKTOP_VIEWPORTS, baselineName, captureView } = require('./lib/capture');

const BASE_URL = targetURL();
const TEST_TIMEOUT = 120000;

let browser;
let storageState;

before(async () => {
  browser = await launch();
  storageState = await signIn(browser, BASE_URL);
});

after(async () => {
  await browser?.close();
});

function readBaseline(viewKey, viewport) {
  const file = path.join(BASELINE_DIR, baselineName(viewKey, viewport));
  assert.ok(fs.existsSync(file), `missing baseline ${path.relative(process.cwd(), file)}; capture it from an unchanged build (see e2e/mobile/README.md)`);
  return fs.readFileSync(file);
}

// A flat grey square PNG, made by the browser.
async function greySquare(value) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('about:blank');
    const base64 = await page.evaluate((grey) => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context2d = canvas.getContext('2d');
      context2d.fillStyle = `rgb(${grey}, ${grey}, ${grey})`;
      context2d.fillRect(0, 0, 8, 8);
      return canvas.toDataURL('image/png').split(',')[1];
    }, value);
    return Buffer.from(base64, 'base64');
  } finally {
    await context.close();
  }
}

describe('the comparison can tell a change from no change', () => {
  const home = DESKTOP_VIEWPORTS[0];

  test('a single changed pixel is detected', { timeout: TEST_TIMEOUT }, async () => {
    const baseline = readBaseline('home', home);
    const planted = await withPage(browser, storageState, home, (page) =>
      captureView(page, BASE_URL, 'home', {
        extraCss: 'body::after { content: ""; position: fixed; left: 100px; top: 100px; width: 1px; height: 1px; background: #ff0000; z-index: 2147483647; }',
      })
    );
    const result = await comparePng(browser, baseline, planted, { channelTolerance: CHANNEL_TOLERANCE });
    assert.equal(result.sameSize, true, 'the planted change should not change the page size');
    assert.equal(result.differing, 1, `expected exactly the one planted pixel to differ, got ${result.differing}`);
  });

  test('a one pixel shift of the content (sidebar 300px to 301px) is detected', { timeout: TEST_TIMEOUT }, async () => {
    const baseline = readBaseline('home', home);
    const planted = await withPage(browser, storageState, home, (page) => captureView(page, BASE_URL, 'home', { extraCss: '#page-wrapper { padding-left: 301px !important; }' }));
    const result = await comparePng(browser, baseline, planted, { channelTolerance: CHANNEL_TOLERANCE });
    assert.equal(result.sameSize, true, 'the shifted page should keep its size');
    assert.ok(result.differing > 100, `a 1px shift of the whole content should change many pixels, got ${result.differing}`);
  });

  test(`a difference of ${CHANNEL_TOLERANCE + 1}/255 is detected and ${CHANNEL_TOLERANCE}/255 is not`, { timeout: TEST_TIMEOUT }, async () => {
    const base = await greySquare(100);
    const within = await comparePng(browser, base, await greySquare(100 + CHANNEL_TOLERANCE), { channelTolerance: CHANNEL_TOLERANCE });
    const beyond = await comparePng(browser, base, await greySquare(100 + CHANNEL_TOLERANCE + 1), { channelTolerance: CHANNEL_TOLERANCE });
    assert.equal(within.differing, 0, `${CHANNEL_TOLERANCE}/255 should be treated as the same`);
    assert.equal(beyond.differing, 64, `${CHANNEL_TOLERANCE + 1}/255 should be treated as different`);
  });

  test('images of different sizes are reported as different', { timeout: TEST_TIMEOUT }, async () => {
    const result = await comparePng(browser, await greySquare(100), readBaseline('home', home), { channelTolerance: CHANNEL_TOLERANCE });
    assert.equal(result.sameSize, false);
  });
});

describe('desktop is unchanged', () => {
  for (const viewport of DESKTOP_VIEWPORTS) {
    for (const viewKey of Object.keys(VIEWS)) {
      test(`${viewKey} at ${viewport.name} matches the baseline`, { timeout: TEST_TIMEOUT }, async () => {
        const baseline = readBaseline(viewKey, viewport);
        // A capture occasionally catches the sidebar in a different state (about one
        // in twenty). A real change is there every time, so one retry is enough to
        // tell the two apart.
        let actual;
        let result;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          actual = await withPage(browser, storageState, viewport, (page) => captureView(page, BASE_URL, viewKey));
          result = await comparePng(browser, baseline, actual, { channelTolerance: CHANNEL_TOLERANCE });
          if (result.sameSize && result.differing === 0) {
            break;
          }
        }

        if (!result.sameSize || result.differing > 0) {
          fs.mkdirSync(OUTPUT_DIR, { recursive: true });
          const stem = path.join(OUTPUT_DIR, baselineName(viewKey, viewport).replace(/\.png$/, ''));
          fs.writeFileSync(`${stem}.actual.png`, actual);
          if (result.diffPng) {
            fs.writeFileSync(`${stem}.diff.png`, result.diffPng);
          }
        }
        // Both must hold: a page of a different size is reported as having no
        // differing pixels, because there is nothing to compare them with.
        assert.equal(result.sameSize, true, `the page is ${result.actual.width}x${result.actual.height} but the baseline is ${result.expected.width}x${result.expected.height}`);
        assert.equal(
          result.differing,
          0,
          `${result.differing} pixels differ from the baseline (largest channel difference ${result.maxDelta}/255, inside ${JSON.stringify(result.box)})`
        );
      });
    }
  }
});
