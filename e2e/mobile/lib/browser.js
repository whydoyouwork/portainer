// Browser helpers: sign in once, open a view in a fresh phone/tablet/desktop
// context, and wait until the page has stopped changing.

const { chromium } = require('playwright');

const { USER, readPassword } = require('./config');

function launch() {
  return chromium.launch();
}

// Signs in through the login form and returns the browser storage state (the
// session cookie plus local storage), so every later context starts signed in
// without repeating the login or sharing a page between checks.
async function signIn(browser, baseURL) {
  const password = readPassword();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/#!/auth`);
    await page.fill('[data-cy="auth-usernameInput"]', USER);
    await page.fill('[data-cy="auth-passwordInput"]', password);
    await page.click('[data-cy="auth-loginButton"]');
    await page.waitForURL(/#!\/(home|init)/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    return await context.storageState();
  } finally {
    await context.close();
  }
}

function newContext(browser, storageState, viewport) {
  return browser.newContext({
    storageState,
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    reducedMotion: 'reduce',
  });
}

// Waits for network idle, web fonts, and then for the page to stop changing:
// the text length, element count and document height must hold for `quietMs`.
async function settle(page, { quietMs = 500, timeout = 30000 } = {}) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  const started = Date.now();
  let last = null;
  let stableSince = Date.now();
  while (Date.now() - started < timeout) {
    const signature = await page.evaluate(() => `${document.body.innerText.length}:${document.documentElement.scrollHeight}:${document.querySelectorAll('*').length}`);
    if (signature !== last) {
      last = signature;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`page did not settle within ${timeout}ms (${page.url()})`);
}

// Opens a hash route and waits until the application has rendered it.
async function openView(page, baseURL, hash) {
  await page.goto(`${baseURL}/${hash}`);
  // The sidebar only renders once the application state has loaded, so its
  // presence means the shell is up and the view is being drawn.
  await page.waitForSelector('button[aria-label="Toggle Sidebar"]', { timeout: 30000 });
  await settle(page);
}

// Runs `fn(page)` in a new context for `viewport`, always closing it.
async function withPage(browser, storageState, viewport, fn) {
  const context = await newContext(browser, storageState, viewport);
  try {
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await context.close();
  }
}

// Polls `check` (which throws while the condition does not hold) until it
// passes or `timeout` elapses, then rethrows the last failure. Used for
// transitions such as a drawer sliding in.
async function eventually(check, { timeout = 3000, interval = 100 } = {}) {
  const started = Date.now();
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() - started >= timeout) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

module.exports = { launch, signIn, newContext, settle, openView, withPage, eventually };
