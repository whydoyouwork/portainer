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

module.exports = { findOffScreen, findClippedCtas, findTruncated, findOverlaps, findSmallTargets };
