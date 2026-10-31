// In-page measurements for the "nothing runs off the page" and "everything can be read" rules.
//
// Every function here runs INSIDE the browser (`page.evaluate(fn, options)`), so it must not use
// anything from this file's scope. Each returns a list of violations; an empty list means it passes.
// They are exercised on good and planted-bad fixtures on every run (measure.fixtures.test.js), so a
// measurement that stops being able to fail is itself a failing test.

// An element may extend past the screen edge only inside a horizontal scroll container (a table, a
// code block) that itself lies inside the screen. `overflow-x: hidden` on <html> or <body> hides the
// overflow without removing it, so the page's own scroll width is not enough.
function findOffScreen() {
  const vw = document.documentElement.clientWidth;
  const violations = [];
  const flagged = new Set();
  const skipped = (el) =>
    el.closest('.sidebar, [aria-hidden="true"], .tippy-box, .sr-only, #loading-bar, #loading-bar-spinner, .bar') || (el.closest('svg') && el.tagName.toLowerCase() !== 'svg');

  if (document.documentElement.scrollWidth > vw + 1) {
    violations.push(`the page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window`);
  }

  for (const el of document.body.querySelectorAll('*')) {
    if (skipped(el)) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 2 || rect.height < 2 || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    if (rect.right <= vw + 1 && rect.left >= -1) continue;

    let insideScroller = false;
    for (let ancestor = el.parentElement; ancestor && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      const overflowX = getComputedStyle(ancestor).overflowX;
      if (/(auto|scroll)/.test(overflowX)) {
        const box = ancestor.getBoundingClientRect();
        insideScroller = box.right <= vw + 1 && box.left >= -1;
        break;
      }
      if (/(hidden|clip)/.test(overflowX)) break; // hides the overflow: that is not a scroller
    }
    if (insideScroller) continue;
    if (el.parentElement && flagged.has(el.parentElement)) {
      flagged.add(el);
      continue;
    }
    flagged.add(el);
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    violations.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${label}" spans ${Math.round(rect.left)}..${Math.round(rect.right)} in a ${vw}px window`);
  }
  return violations;
}

// A call to action has its whole box on screen and inside whatever clips or scrolls its ancestor,
// whatever that ancestor's overflow is. Controls inside a table row scroll with their row and are
// exempt: every action they offer is also reachable from the row's name link.
function findClippedCtas() {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const violations = [];
  const selector = 'button, a.btn, input[type=button], input[type=submit], input[type=reset], [role=button], [role=tab], [role=menuitem]';
  for (const el of document.body.querySelectorAll(selector)) {
    if (el.closest('.sidebar, [aria-hidden="true"], .tippy-box, table, [role=grid], #loading-bar')) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 2 || rect.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue;
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('data-cy') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
    if (rect.left < -1 || rect.right > vw + 1) {
      violations.push(`"${label}" is off screen: ${Math.round(rect.left)}..${Math.round(rect.right)} in a ${vw}px window`);
      continue;
    }
    for (let ancestor = el.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (!/(hidden|clip|auto|scroll)/.test(ancestorStyle.overflowX + ancestorStyle.overflowY)) continue;
      const box = ancestor.getBoundingClientRect();
      const cutX = rect.right > box.right + 1 || rect.left < box.left - 1;
      const cutY = /(hidden|clip)/.test(ancestorStyle.overflowY) && (rect.bottom > box.bottom + 1 || rect.top < box.top - 1);
      if (cutX || cutY) violations.push(`"${label}" is cut by its container (${ancestor.tagName.toLowerCase()}.${String(ancestor.className).split(/\s+/)[0]})`);
      break;
    }
    if (rect.top > vh + 100000) violations.push(`"${label}" is far below the page`);
  }
  return violations;
}

// Text cut off by its own box (overflow hidden/clipped) is allowed only where a tap shows the full
// value: inside a link to a detail view. A `title` or `aria-label` does not count on a touch screen.
function findTruncated() {
  const violations = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.children.length > 2 || el.closest('.sidebar, [aria-hidden="true"], .tippy-box, .sr-only, #loading-bar, svg')) continue;
    if (!el.textContent.trim() || ['SELECT', 'INPUT', 'TEXTAREA', 'OPTION'].includes(el.tagName)) continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue;
    const clipsX = /(hidden|clip)/.test(style.overflowX) && !/(auto|scroll)/.test(style.overflowY);
    const clipsY = /(hidden|clip)/.test(style.overflowY) && !/(auto|scroll)/.test(style.overflowX);
    const cutX = clipsX && el.scrollWidth > el.clientWidth + 1;
    const cutY = clipsY && el.scrollHeight > el.clientHeight + 1;
    if (!cutX && !cutY) continue;
    if (el.closest('a[href]')) continue; // a tap opens the item, which shows it in full
    violations.push(
      `"${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}" is cut off (${cutX ? `${el.scrollWidth}px of text in ${el.clientWidth}px` : `${el.scrollHeight}px of text in ${el.clientHeight}px`}) and no tap shows it`
    );
  }
  return violations;
}

// Two lines of text that overlap by more than 3px both ways, neither inside the other, collide. Each
// line of wrapped text is measured on its own, so a wrapped label does not claim the empty space
// beside its lines; text that cannot be seen (opacity 0) is not text a person reads.
function findOverlaps() {
  const violations = [];
  const hidden = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return true;
    }
    return false;
  };
  // A bar fixed to the screen lies over the page by design: what it covers scrolls out from under it.
  const isPinned = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (/(fixed|sticky)/.test(getComputedStyle(node).position)) return true;
    }
    return false;
  };
  const candidates = [...document.body.querySelectorAll('h1,h2,h3,h4,label,span,a,p,td,th,button,div')].filter(
    (el) =>
      !el.closest('.sidebar, [aria-hidden="true"], .tippy-box, .sr-only, svg, #loading-bar, .bar') &&
      !isPinned(el) &&
      [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
  );
  const lines = [];
  for (const el of candidates) {
    if (hidden(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const rect of range.getClientRects()) {
      if (rect.width > 4 && rect.height > 4) lines.push({ el, rect });
    }
  }
  const reported = new Set();
  for (let i = 0; i < lines.length && violations.length < 10; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (overlapX > 3 && overlapY > 3) {
        const key = `${a.el.textContent.trim().slice(0, 25)}|${b.el.textContent.trim().slice(0, 25)}`;
        if (!reported.has(key)) {
          reported.add(key);
          violations.push(`"${a.el.textContent.trim().slice(0, 25)}" overlaps "${b.el.textContent.trim().slice(0, 25)}"`);
        }
        break;
      }
    }
  }
  return violations;
}

// A touch control (not an inline text link, not inside a table row) is at least `min` px square.
function findSmallTargets(min) {
  const violations = [];
  const selector = 'button, a.btn, input[type=button], input[type=submit], [role=button]';
  for (const el of document.body.querySelectorAll(selector)) {
    if (el.closest('.sidebar, [aria-hidden="true"], .tippy-box, table, [role=grid], #loading-bar')) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 2 || rect.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue;
    // The expand/collapse toggles of a dense JSON tree and the two icon buttons of the date range picker
    // (which share one narrow line with their fields) only have to reach WCAG 2.2's 24px.
    const floor = el.closest('[class*="JsonTree"]') || el.matches('.react-daterange-picker__button') ? 24 : min;
    if (el.classList.contains('btn-link') && rect.height + 0.5 >= floor) continue; // a text link only has to be tall enough
    if (rect.height + 0.5 < floor || (rect.width + 0.5 < floor && !el.classList.contains('btn-link'))) {
      violations.push(
        `"${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30)}" is ${Math.round(rect.width)}x${Math.round(rect.height)}`
      );
    }
  }
  return violations;
}

// The colour of every visible link's text against what is painted behind it (WCAG 1.4.3 asks 4.5:1 for text).
// Runs in the page and returns one entry per link: { text, color, background, ratio, unreadable }. `selector` says
// what is read: text links (`a`, the default) or link-style buttons (`.btn-link`), which sit on dark panels too.
//
// The background is what the browser paints at the middle of the first word, found by hit-testing: every
// element under that point is a layer, from the link down to the first opaque one, and translucent layers are
// blended over what lies below them. A background image (a gradient, a picture) cannot be read from colours: that
// link is returned with `unreadable` set and its `index`, and readBackgroundImages looks at the pixels instead.
// Links that are not read: icon-only links (no text), links of a disabled control (WCAG 1.4.3 exempts inactive
// components, e.g. the "Output" tab of the image build form before a build has run), and links that are not on the
// page (hidden, or the closed drawer, which is moved out of the window to the left).
function measureLinkContrasts(selector = 'a') {
  function parse(color) {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return { r: 0, g: 0, b: 0, a: 0 };
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  function luminance({ r, g, b }) {
    const lin = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }
  function over(top, bottom) {
    return { r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 };
  }
  const rgb = (c) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

  const entries = [];
  for (const el of document.body.querySelectorAll(selector)) {
    if (el.closest('[aria-hidden="true"], [inert], .tippy-box, #loading-bar, .sr-only')) continue;
    if (el.closest('.disabled, [disabled], [aria-disabled="true"]')) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;

    // the first word: the first text node with something in it that can be seen (the dashboard's tiles keep a
    // "Refreshing total" label at opacity 0 in front of the one that shows)
    let textNode = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && !textNode; node = walker.nextNode()) {
      if (node.textContent.trim() && node.parentElement.checkVisibility({ opacityProperty: true, visibilityProperty: true })) textNode = node;
    }
    if (!textNode) continue;
    const first = document.createRange();
    first.selectNodeContents(textNode);
    const probe = first.getClientRects()[0];
    if (!probe || probe.width < 1 || probe.right <= 0) continue;

    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const box = first.getClientRects()[0];
    const x = Math.min(Math.max(box.left + Math.min(box.width / 2, 6), 0), window.innerWidth - 1);
    const y = box.top + box.height / 2;
    const stack = document.elementsFromPoint(x, y);
    const from = stack.findIndex((e) => el === e || el.contains(e));
    if (from < 0) continue; // something else is on top of it here: it cannot be read there either

    // below every layer is the page's canvas: the colour of <html>, or the one of <body> when <html> has none (a point
    // below the end of <body>, where nothing but the canvas is painted, is not hit-tested as <body>)
    const canvas = [document.documentElement, document.body].map((e) => parse(getComputedStyle(e).backgroundColor)).find((c) => c.a > 0) || { r: 255, g: 255, b: 255, a: 1 };
    let background = over(canvas, { r: 255, g: 255, b: 255, a: 1 });
    const layers = [];
    let unreadable = false;
    for (const layer of stack.slice(from)) {
      const style = getComputedStyle(layer);
      if (style.backgroundImage !== 'none') {
        unreadable = true;
        break;
      }
      const c = parse(style.backgroundColor);
      if (c.a > 0) layers.push(c);
      if (c.a >= 0.999) break;
    }
    for (const c of layers.reverse()) background = over(c, background);

    const holder = textNode.parentElement;
    const style = getComputedStyle(holder);
    let opacity = 1;
    for (let n = holder; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    const text = parse(style.color);
    const foreground = over({ ...text, a: text.a * opacity }, background);
    const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    entries.push({
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      color: style.color,
      background: unreadable ? 'a background image' : rgb(background),
      ratio: unreadable ? 0 : (hi + 0.05) / (lo + 0.05),
      unreadable,
      index: [...document.body.querySelectorAll(selector)].indexOf(el),
      foreground: { r: foreground.r, g: foreground.g, b: foreground.b },
    });
  }
  return entries;
}

// For the entries on a background image: the link's text is made transparent, the first word's box is captured, and
// the contrast is the lowest that the text colour has against any pixel of the capture (so a pale patch of a picture
// under the word counts, and the worst place is what is judged). Entries that cannot be captured stay unreadable.
async function readBackgroundImages(page, browser, entries, selector = 'a') {
  const { lowestContrast } = require('./pixels');
  const result = [];
  for (const entry of entries) {
    if (!entry.unreadable) {
      result.push(entry);
      continue;
    }
    const box = await page.evaluate(
      ({ index, selector: sel }) => {
        const el = document.body.querySelectorAll(sel)[index];
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const style = document.createElement('style');
        style.id = 'link-contrast-probe';
        style.textContent = '[data-link-contrast-probe], [data-link-contrast-probe] * { color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }';
        document.head.appendChild(style);
        el.setAttribute('data-link-contrast-probe', '');
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim() || !node.parentElement.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getClientRects()[0];
          if (r) return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(r.width), height: Math.ceil(r.height) };
        }
        return null;
      },
      { index: entry.index, selector }
    );
    let png = null;
    try {
      if (box) {
        await page.waitForTimeout(100);
        png = await page.screenshot({ clip: box });
      }
    } finally {
      await page.evaluate(() => {
        document.getElementById('link-contrast-probe')?.remove();
        document.querySelector('[data-link-contrast-probe]')?.removeAttribute('data-link-contrast-probe');
      });
    }
    if (!png) {
      result.push(entry);
      continue;
    }
    result.push({ ...entry, unreadable: false, ratio: await lowestContrast(browser, png, entry.foreground), background: 'a background image (lowest of its pixels)' });
  }
  return result;
}

// Turns the entries of measureLinkContrasts into the list of links under `min` (plain Node, not run in the page).
function lowContrastLinks(entries, min = 4.5) {
  const found = [];
  for (const e of entries) {
    if (e.unreadable) found.push(`"${e.text}" is on a background image, so its contrast cannot be read from colours`);
    else if (e.ratio + 1e-9 < min) found.push(`"${e.text}" ${e.color} on ${e.background} is ${e.ratio.toFixed(2)}:1`);
  }
  return found;
}

module.exports = { findOffScreen, findClippedCtas, findTruncated, findOverlaps, findSmallTargets, measureLinkContrasts, readBackgroundImages, lowContrastLinks };
