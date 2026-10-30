// The mobile stylesheet must not reach desktop: every top-level rule in it sits inside a max-width
// media query of 991px or less. A rule outside one applies at every width, which is how a phone-only
// fix could move the desktop layout without any view-specific check noticing.

const fs = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

// The stylesheet of the checkout under test (PORTAINER_MOBILE_CSS overrides the path).
const STYLESHEET = process.env.PORTAINER_MOBILE_CSS || path.resolve(__dirname, '../../app/assets/css/mobile.css');

// The prelude of every rule at nesting depth 0 (comments removed).
function topLevelPreludes(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const preludes = [];
  let depth = 0;
  let buffer = '';
  for (const char of source) {
    if (char === '{') {
      if (depth === 0) preludes.push(buffer.trim());
      depth += 1;
      buffer = '';
    } else if (char === '}') {
      depth -= 1;
      buffer = '';
    } else if (depth === 0) {
      buffer += char;
    }
  }
  return preludes;
}

// A prelude is fenced if it is a media query whose max-width is 991px or less.
function isFenced(prelude) {
  const match = /^@media[^{]*\(max-width:\s*(\d+)px\)/.exec(prelude);
  return !!match && Number(match[1]) <= 991;
}

describe('the mobile stylesheet is fenced below 992px', () => {
  test('every top-level rule is a media query of max-width 991px or less', () => {
    assert.ok(fs.existsSync(STYLESHEET), `${STYLESHEET} does not exist; check out the branch with the mobile stylesheet or set PORTAINER_MOBILE_CSS`);
    const preludes = topLevelPreludes(fs.readFileSync(STYLESHEET, 'utf8'));
    assert.ok(preludes.length >= 2, `found only ${preludes.length} rules in ${STYLESHEET}`);
    const unfenced = preludes.filter((prelude) => !isFenced(prelude));
    assert.deepEqual(unfenced, [], `rules that apply at every width: ${unfenced.join(', ')}`);
  });

  // Mutation: a rule left outside the media query (the fault that happened while writing this file).
  test('planted fault: a rule outside a media query is reported', () => {
    const css = '@media only screen and (max-width: 767px) { .a { color: red } }\n.portainer-selector__placeholder { white-space: normal }';
    assert.deepEqual(
      topLevelPreludes(css).filter((prelude) => !isFenced(prelude)),
      ['.portainer-selector__placeholder']
    );
  });

  test('planted fault: a media query that reaches desktop widths is reported', () => {
    const css = '@media only screen and (max-width: 1200px) { .a { color: red } }';
    assert.equal(topLevelPreludes(css).filter((prelude) => !isFenced(prelude)).length, 1);
  });

  test('a media query with a min-width only is not a fence', () => {
    assert.equal(isFenced('@media only screen and (min-width: 768px)'), false);
  });
});
