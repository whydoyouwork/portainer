// Content-Security-Policy checks. The tests run with the policy ON: contexts
// are never created with bypassCSP, no response header is rewritten, and no
// script is injected as text.

const fs = require('node:fs');
const path = require('node:path');

const { newContext, openView } = require('./browser');
const { VIEWS } = require('./config');

const VIOLATIONS_FILE = path.join(__dirname, '..', '__baselines__', 'csp-violations.json');

// Opens a view and returns every policy violation the browser reported while
// the page loaded, as sorted "directive blockedURI" strings. The unmodified
// application already raises two `script-src eval` violations on load, so the
// check compares against what the unchanged build raises; it never expects zero.
async function collectViolations(browser, storageState, baseURL, viewport, viewKey) {
  const context = await newContext(browser, storageState, viewport);
  try {
    // An init script is injected by the browser itself, so it is not subject to
    // the page's policy.
    await context.addInitScript(() => {
      window.__policyViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__policyViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
      });
    });
    const page = await context.newPage();
    await openView(page, baseURL, VIEWS[viewKey]);
    const violations = await page.evaluate(() => window.__policyViolations);
    return violations.sort();
  } finally {
    await context.close();
  }
}

function readBaselineViolations() {
  return JSON.parse(fs.readFileSync(VIOLATIONS_FILE, 'utf8')).views;
}

function writeBaselineViolations(views) {
  fs.writeFileSync(VIOLATIONS_FILE, `${JSON.stringify({ note: 'policy violations raised by the unchanged build while each view loads', views }, null, 2)}\n`);
}

module.exports = { collectViolations, readBaselineViolations, writeBaselineViolations };
