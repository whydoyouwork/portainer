// Desktop screenshots used by the "desktop is unchanged" check.

const fs = require('node:fs');
const path = require('node:path');

const { openView } = require('./browser');
const { VIEWS, VIEWPORTS } = require('./config');

const BASELINE_DIR = path.join(__dirname, '..', '__baselines__');
const OUTPUT_DIR = path.join(__dirname, '..', '__output__');

// The two desktop sizes that must not change.
const DESKTOP_VIEWPORTS = [VIEWPORTS.desktop1440, VIEWPORTS.desktop1920];

// Stops anything that moves between two captures of the same page: animations,
// transitions and the text caret. Nothing is hidden; the one source of
// run-to-run noise that remains is handled by the comparison tolerance (see
// lib/pixels.js).
const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

// Largest per-channel difference (out of 255) still treated as the same pixel.
// Measured, not guessed: capturing the unchanged build over and over gives
// differences of at most 2 in a few dozen pixels (anti-aliasing of rounded
// borders in the container and image lists). A moved or resized element
// changes pixels by far more than that.
const CHANNEL_TOLERANCE = 2;

// Things the server reads from outside the page or from the machine it runs
// on. They differ between two servers and between two days even when nothing
// about the layout changed, so each is answered from a fixed value, in the
// baseline capture and in the check alike.
//  - the home view's news banner is fetched from the internet; a small neutral
//    notice (__baselines__/motd.json) stands in for it, so the banner is still
//    drawn;
//  - the image and container-creation views show how many anonymous Docker Hub
//    pulls remain, which falls with every pull anywhere.
const MOTD_FIXTURE = path.join(BASELINE_DIR, 'motd.json');
const DOCKER_HUB_RATE_LIMIT = JSON.stringify({ remaining: 70, limit: 100 });

// Text that identifies the machine or the moment, replaced by a fixed string
// of the same shape wherever it appears in the page: timestamps (the home
// view's environment card, the Created columns) and IPv4 addresses (the
// container list). Hiding them would still let their width move the text
// beside them, so the text itself is swapped.
const PINNED_TEXT = [
  { name: 'timestamp', source: '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}', placeholder: '0000-00-00 00:00:00' },
  { name: 'ip address', source: '\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b', placeholder: '0.0.0.0' },
];

// Runs in the browser. Returns how many replacements were made per kind.
function pinText(rules) {
  const counts = {};
  const patterns = rules.map((rule) => ({ ...rule, pattern: new RegExp(rule.source, 'g') }));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('script, style')) {
      continue;
    }
    let text = node.textContent;
    for (const rule of patterns) {
      text = text.replace(rule.pattern, () => {
        counts[rule.name] = (counts[rule.name] || 0) + 1;
        return rule.placeholder;
      });
    }
    if (text !== node.textContent) {
      node.textContent = text;
    }
  }
  return counts;
}

function baselineName(viewKey, viewport) {
  return `${viewKey}-${viewport.width}x${viewport.height}.png`;
}

// Full-page capture of one view in an open page.
async function captureView(page, baseURL, viewKey, { extraCss = '' } = {}) {
  await page.route('**/api/motd', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(MOTD_FIXTURE) }));
  await page.route('**/api/endpoints/*/dockerhub/*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: DOCKER_HUB_RATE_LIMIT }));
  await openViewWithNoRequestRunning(page, baseURL, VIEWS[viewKey]);
  const pinned = await page.evaluate(pinText, PINNED_TEXT);
  if (viewKey === 'home' && !pinned.timestamp) {
    throw new Error('expected to find the environment timestamp on the home view and found none; update the pinned text in lib/capture.js');
  }
  await page.addStyleTag({ content: FREEZE_CSS + extraCss });
  // Move the pointer off every control so no hover style is captured.
  await page.mouse.move(0, 0);
  return stableScreenshot(page);
}

// Opens the view and waits until no request indicator is on screen, before
// animations are frozen: freezing one part-way through its exit would leave it
// on screen for good. Rarely (about once in thirty loads on a busy machine) an
// indicator outlasts the wait; the view is then loaded once more. A layout
// change shows on every load, so a second load cannot hide one.
async function openViewWithNoRequestRunning(page, baseURL, hash, { loads = 2, timeout = 15000 } = {}) {
  for (let load = 1; load <= loads; load += 1) {
    if (load > 1) {
      await page.goto('about:blank');
    }
    await openView(page, baseURL, hash);
    try {
      await page.waitForFunction((selector) => document.querySelector(selector) === null, REQUEST_INDICATORS, { timeout });
      return;
    } catch (error) {
      if (error.name !== 'TimeoutError') {
        throw error;
      }
    }
  }
  throw new Error(`a request kept running: a request indicator (${REQUEST_INDICATORS}) stayed on screen for ${timeout}ms on each of ${loads} loads (${page.url()})`);
}

// The application's own request indicators: the AngularJS loading bar and its
// spinner, and the bar shown for React requests. Each is in the page only while
// a request is running. With animations frozen they stop moving, so two
// screenshots taken during a request can be identical and look settled. Seen
// once in about twenty captures of the home view: a thin bar across the top
// and a spinner by the user menu, 129 pixels.
const REQUEST_INDICATORS = '#loading-bar, #loading-bar-spinner, #nprogress';

function requestRunning(page) {
  return page.evaluate((selector) => document.querySelector(selector) !== null, REQUEST_INDICATORS);
}

// Takes full-page screenshots until two in a row are byte-identical with no
// request running, so a late re-render or a background request (seen once or
// twice in a hundred captures on a busy machine) is never the one that is
// compared. A real layout change is stable, so it is still caught by the
// comparison with the baseline.
async function stableScreenshot(page, { attempts = 8, gapMs = 500 } = {}) {
  let previous = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await page.waitForTimeout(gapMs);
    }
    if (await requestRunning(page)) {
      previous = null;
      continue;
    }
    const next = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
    if (previous && next.equals(previous) && !(await requestRunning(page))) {
      return next;
    }
    previous = next;
  }
  throw new Error(`the page kept changing, or a request kept running, for ${attempts} screenshots in a row (${page.url()})`);
}

module.exports = { BASELINE_DIR, OUTPUT_DIR, MOTD_FIXTURE, CHANNEL_TOLERANCE, DESKTOP_VIEWPORTS, FREEZE_CSS, REQUEST_INDICATORS, baselineName, captureView };
