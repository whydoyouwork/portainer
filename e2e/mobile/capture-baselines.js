#!/usr/bin/env node
/* eslint-disable no-console -- a command line script: progress and errors go to the terminal */
// Captures the desktop baselines that the "desktop is unchanged" check
// compares against.
//
//   node e2e/mobile/capture-baselines.js <url-of-an-unchanged-build>
//
// The URL is a required argument on purpose: baselines taken from a build that
// already contains the mobile changes would make the check compare the change
// with itself. Each view is captured twice and the baseline is only written if
// the two captures agree to within the tolerance, which is how the check proves
// the page is deterministic before trusting it.

const fs = require('node:fs');

const { launch, signIn, withPage } = require('./lib/browser');
const { comparePng } = require('./lib/pixels');
const { BASELINE_DIR, CHANNEL_TOLERANCE, DESKTOP_VIEWPORTS, baselineName, captureView } = require('./lib/capture');
const { collectViolations, writeBaselineViolations } = require('./lib/csp');
const { VIEWS, targetURL } = require('./lib/config');

async function main() {
  if (!process.argv[2]) {
    console.error('usage: node e2e/mobile/capture-baselines.js <url-of-an-unchanged-build>');
    process.exit(2);
  }
  const baseURL = targetURL(process.env, process.argv[2]);

  const browser = await launch();
  try {
    const storageState = await signIn(browser, baseURL);
    fs.mkdirSync(BASELINE_DIR, { recursive: true });

    const versionText = await withPage(browser, storageState, DESKTOP_VIEWPORTS[0], async (page) => (await page.request.get(`${baseURL}/api/system/version`)).text());
    const { ServerVersion: version } = JSON.parse(versionText);

    const written = [];
    for (const viewport of DESKTOP_VIEWPORTS) {
      for (const viewKey of Object.keys(VIEWS)) {
        // Two captures must agree. An occasional capture catches the sidebar in a
        // different state (about one pair in twenty), so a disagreeing pair is
        // retried; a page that never agrees is rejected.
        let first;
        let result;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          first = await withPage(browser, storageState, viewport, (page) => captureView(page, baseURL, viewKey));
          const second = await withPage(browser, storageState, viewport, (page) => captureView(page, baseURL, viewKey));
          result = await comparePng(browser, first, second, { channelTolerance: CHANNEL_TOLERANCE });
          if (result.sameSize && result.differing === 0) {
            break;
          }
          console.log(`${viewKey} at ${viewport.name}: attempt ${attempt} disagreed in ${result.differing} pixels`);
        }
        if (!result.sameSize || result.differing !== 0) {
          throw new Error(
            `${viewKey} at ${viewport.name} is not deterministic: three pairs of captures differed (last: ${result.differing} pixels beyond ${CHANNEL_TOLERANCE}/255, box ${JSON.stringify(result.box)}). Hide or fix the changing region before taking a baseline.`
          );
        }
        fs.writeFileSync(`${BASELINE_DIR}/${baselineName(viewKey, viewport)}`, first);
        written.push(baselineName(viewKey, viewport));
        console.log(
          `captured ${baselineName(viewKey, viewport)} (${result.expected.width}x${result.expected.height}, two captures within the tolerance, largest difference ${result.maxDelta}/255)`
        );
      }
    }

    // What the unchanged build reports to the Content-Security-Policy while each
    // view loads. The check on the changed build must report exactly the same.
    const violations = {};
    for (const viewKey of Object.keys(VIEWS)) {
      violations[viewKey] = await collectViolations(browser, storageState, baseURL, DESKTOP_VIEWPORTS[0], viewKey);
    }
    writeBaselineViolations(violations);
    console.log(`recorded policy violations of the unchanged build: ${JSON.stringify(violations)}`);

    fs.writeFileSync(`${BASELINE_DIR}/manifest.json`, `${JSON.stringify({ portainerVersion: version, source: 'unchanged build', files: written }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/* eslint-enable no-console */
