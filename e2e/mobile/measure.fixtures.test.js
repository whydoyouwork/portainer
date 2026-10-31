// Proves the in-page measurements (lib/measure.js) on fixtures, on every run: each one passes on a
// good page and fails on a page with the fault it is meant to catch. A measurement that can no longer
// fail would turn the crawl into a check that always passes, so this file is what makes the crawl count.

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { launch } = require('./lib/browser');
const measure = require('./lib/measure');

let browser;

before(async () => {
  browser = await launch();
});

after(async () => {
  await browser?.close();
});

const HEAD = '<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:14px sans-serif}</style>';

// Renders `body` in a 360px phone context and returns the measurement's violations.
async function run(fn, body, options, { viewportMeta = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head>${viewportMeta ? HEAD : '<style>body{margin:0;font:14px sans-serif}</style>'}</head><body>${body}</body></html>`);
    return await page.evaluate(fn, options);
  } finally {
    await context.close();
  }
}

describe('the layout viewport is the device width (the precondition of every measurement)', () => {
  test('with the viewport tag the page lays out at 360px', async () => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head>${HEAD}</head><body><div>fits</div></body></html>`);
    assert.equal(await page.evaluate(() => window.innerWidth), 360);
    await context.close();
  });

  // Mutation: drop the viewport tag. A phone then lays the page out at 980px, so a width check made
  // there measures a desktop layout and passes. The suite's real-viewport assertion must see it.
  test('without the viewport tag the page lays out at 980px, which the suite refuses to measure', async () => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><head><style>body{margin:0}</style></head><body><div style="width:900px">a desktop-sized page</div></body></html>');
    assert.notEqual(await page.evaluate(() => window.innerWidth), 360);
    await context.close();
  });
});

describe('findOffScreen', () => {
  test('passes: everything fits, and a wide table scrolls inside its own card', async () => {
    const violations = await run(measure.findOffScreen, '<div style="width:300px;overflow-x:auto"><table style="width:900px"><tr><td>wide table</td></tr></table></div>');
    assert.deepEqual(violations, []);
  });

  test('fails: an element runs past the right edge', async () => {
    const violations = await run(measure.findOffScreen, '<div style="width:700px">too wide</div>');
    assert.ok(violations.length > 0);
  });

  // Mutation: the overflow is hidden on <body>. The page's scroll width then looks fine.
  test('fails: overflow hidden on body hides the overflow without removing it', async () => {
    const violations = await run(measure.findOffScreen, '<style>body{overflow-x:hidden}</style><div style="width:700px">too wide</div>');
    assert.ok(
      violations.some((v) => /spans/.test(v)),
      `got: ${violations.join('; ')}`
    );
  });

  test('fails: a scroller that itself runs off the screen does not excuse its content', async () => {
    const violations = await run(measure.findOffScreen, '<div style="width:700px;overflow-x:auto"><div style="width:900px">inside</div></div>');
    assert.ok(violations.length > 0);
  });
});

describe('findClippedCtas', () => {
  test('passes: buttons wrap onto a second line', async () => {
    const violations = await run(
      measure.findClippedCtas,
      '<div style="display:flex;flex-wrap:wrap;overflow:auto;width:300px"><button style="width:200px">One</button><button style="width:200px">Two</button></div>'
    );
    assert.deepEqual(violations, []);
  });

  // Mutation: the toolbar keeps its buttons on one line and clips them (the original table toolbar fault).
  test('fails: a toolbar with overflow auto still holds a button past its edge', async () => {
    const violations = await run(
      measure.findClippedCtas,
      '<div style="display:flex;overflow:auto;width:300px"><button style="flex:none;width:200px">One</button><button style="flex:none;width:200px">Two</button></div>'
    );
    assert.ok(
      violations.some((v) => /Two/.test(v)),
      `got: ${violations.join('; ')}`
    );
  });

  test('fails: a button cut by overflow hidden', async () => {
    const violations = await run(measure.findClippedCtas, '<div style="overflow:hidden;width:100px"><button style="width:200px">Wide</button></div>');
    assert.ok(violations.length > 0);
  });

  test('passes: a button in a table row is exempt (its row opens the same actions)', async () => {
    const violations = await run(
      measure.findClippedCtas,
      '<div style="overflow:auto;width:300px"><table style="width:800px"><tr><td><button>Row action</button></td><td style="padding-left:600px">x</td></tr></table></div>'
    );
    assert.deepEqual(violations, []);
  });
});

describe('findTruncated', () => {
  test('passes: text that fits', async () => {
    assert.deepEqual(await run(measure.findTruncated, '<div style="width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">short</div>'), []);
  });

  test('fails: text cut with an ellipsis and nothing to tap', async () => {
    const violations = await run(measure.findTruncated, '<div style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">a long name that does not fit</div>');
    assert.equal(violations.length, 1);
  });

  // A title is read by a mouse hover or a screen reader, not by a finger.
  test('fails: a title attribute does not make the cut text reachable on a touch screen', async () => {
    const violations = await run(
      measure.findTruncated,
      '<div title="a long name that does not fit" style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">a long name that does not fit</div>'
    );
    assert.equal(violations.length, 1);
  });

  test('passes: cut text inside a link, which a tap opens', async () => {
    const violations = await run(
      measure.findTruncated,
      '<a href="#detail" style="display:block;width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">a long name that does not fit</a>'
    );
    assert.deepEqual(violations, []);
  });

  test('passes: a scroller is not truncation', async () => {
    assert.deepEqual(await run(measure.findTruncated, '<div style="width:80px;overflow-x:auto;white-space:nowrap">a long name that does not fit</div>'), []);
  });
});

describe('findOverlaps', () => {
  test('passes: two labels side by side', async () => {
    assert.deepEqual(
      await run(measure.findOverlaps, '<span style="position:absolute;left:0;top:0">First</span><span style="position:absolute;left:100px;top:0">Second</span>'),
      []
    );
  });

  test('fails: a badge laid over a title', async () => {
    const violations = await run(
      measure.findOverlaps,
      '<h2 style="position:absolute;left:0;top:0;margin:0">Certificate Authority file</h2><span style="position:absolute;left:40px;top:0">Business Feature</span>'
    );
    assert.equal(violations.length, 1);
  });
});

describe('findOverlaps: what is not a collision', () => {
  // The first version measured the box around all the lines of a wrapped label, which claimed the empty
  // space beside them and reported labels that do not touch.
  test('passes: a wrapped label and a word that sits in the space beside its lines', async () => {
    const violations = await run(
      measure.findOverlaps,
      '<div style="position:relative;width:60px;overflow-wrap:anywhere"><span>Environments wrapped</span></div><span style="position:absolute;left:0;top:200px">Below</span>'
    );
    assert.deepEqual(violations, []);
  });

  test('passes: two invisible labels laid over each other (opacity 0)', async () => {
    const violations = await run(
      measure.findOverlaps,
      '<span style="position:absolute;left:0;top:0;opacity:0">Refreshing total</span><span style="position:absolute;left:0;top:0;opacity:0">Loading total</span>'
    );
    assert.deepEqual(violations, []);
  });

  test('fails: the second line of one label runs under a neighbour', async () => {
    const violations = await run(
      measure.findOverlaps,
      '<div style="position:absolute;left:0;top:0;width:60px;overflow-wrap:anywhere">Environments wrapped</div><span style="position:absolute;left:0;top:30px">Neighbour</span>'
    );
    assert.equal(violations.length, 1);
  });
});

describe('findSmallTargets', () => {
  test('passes: a 24px button', async () => {
    assert.deepEqual(await run(measure.findSmallTargets, '<button style="width:60px;height:24px">Go</button>', 24), []);
  });

  test('fails: a 20px button', async () => {
    const violations = await run(measure.findSmallTargets, '<button style="width:60px;height:20px">Go</button>', 24);
    assert.equal(violations.length, 1);
  });

  test('passes: a small button inside a table row is exempt', async () => {
    assert.deepEqual(await run(measure.findSmallTargets, '<table><tr><td><button style="height:20px">x</button></td></tr></table>', 24), []);
  });
});

describe('measureLinkContrasts', () => {
  const problems = async (body) => measure.lowContrastLinks(await run(measure.measureLinkContrasts, body));

  test('passes: the darker blue on white, white on a dark band', async () => {
    assert.deepEqual(await problems('<a href="#" style="color:#026aa2">Teams view</a><div style="background:#2e2f33;padding:8px"><a href="#" style="color:#f2f4f7">Containers</a></div>'), []);
  });

  // Mutation: the vendor's blue (blue-8) on white.
  test('fails: the vendor blue on white is 4.00:1', async () => {
    const found = await problems('<a href="#" style="color:#0086c9">Teams view</a>');
    assert.equal(found.length, 1);
    assert.match(found[0], /4\.00:1/);
  });

  // The ratio is taken against the panel the link is on, not against white.
  test('fails: a link on a tinted panel is measured against the panel', async () => {
    const found = await problems('<div style="background:#f2f4f7;padding:8px"><a href="#" style="color:#337ab7">official documentation</a></div>');
    assert.equal(found.length, 1);
    assert.match(found[0], /4\.14:1/);
  });

  // A darker link must not be put on a dark background it was never meant for.
  test('fails: the darker blue on a dark band is under 4.5:1', async () => {
    assert.equal((await problems('<div style="background:#2e2f33;padding:8px"><a href="#" style="color:#026aa2">Containers</a></div>')).length, 1);
  });

  test('blends a translucent layer over what lies below it', async () => {
    const passes = await problems('<div style="background:#fff"><div style="background:rgba(0,0,0,.05);padding:8px"><a href="#" style="color:#026aa2">Teams view</a></div></div>');
    assert.deepEqual(passes, []);
    const fails = await problems('<div style="background:#fff"><div style="background:rgba(0,0,0,.25);padding:8px"><a href="#" style="color:#026aa2">Teams view</a></div></div>');
    assert.equal(fails.length, 1);
  });

  test('fails: a link on a background image cannot be measured, so it is reported', async () => {
    const found = await problems('<div style="background:linear-gradient(#fff,#eee);padding:8px"><a href="#" style="color:#026aa2">Learn more</a></div>');
    assert.equal(found.length, 1);
    assert.match(found[0], /background image/);
  });

  test('passes: icon-only, disabled, hidden and covered links are not read', async () => {
    const entries = await run(
      measure.measureLinkContrasts,
      '<a href="#" style="color:#0086c9"><svg width="10" height="10"></svg></a>' +
        '<ul class="nav"><li class="disabled"><a href="#" style="color:#777">Output</a></li></ul>' +
        '<a href="#" style="color:#0086c9;visibility:hidden">hidden</a>' +
        '<a href="#" style="color:#0086c9;position:absolute;left:-400px">off the left edge</a>' +
        '<a href="#" aria-hidden="true" style="color:#0086c9">aria hidden</a>'
    );
    assert.deepEqual(entries, []);
  });

  // The page's background is the canvas's: <body>'s colour reaches below the end of <body>, where <body> is not hit.
  // Mutation: start from white instead of the canvas colour.
  test('passes: a link below the end of a dark body is on the dark canvas', async () => {
    assert.deepEqual(await problems('<style>body{background:#121212;height:20px}</style><a href="#" style="position:absolute;top:300px;color:#0ba5ec">Business Feature</a>'), []);
  });

  test('reads the colour of the text, not of the link around it', async () => {
    const found = await problems('<a href="#" style="color:#026aa2"><span style="color:#0086c9">inner text</span></a>');
    assert.equal(found.length, 1);
  });

  // Link-style buttons are read with their own selector: a button of the light blue on a dark panel is reported, and one
  // with the pale text that panel needs is not. Text links are not mistaken for buttons, nor buttons for links.
  describe('link-style buttons', () => {
    const buttonProblems = async (body) => measure.lowContrastLinks(await run(measure.measureLinkContrasts, body, '.btn-link'));

    test('fails: the darker blue on a dark panel is 2.28:1', async () => {
      const found = await buttonProblems(
        '<div style="background:#2e2f33;padding:8px"><button class="btn btn-link" style="color:#026aa2;border:0;background:none">dismiss</button></div>'
      );
      assert.equal(found.length, 1);
      assert.match(found[0], /2\.28:1/);
    });

    test('passes: pale text on a dark panel, and the darker blue on white', async () => {
      assert.deepEqual(
        await buttonProblems('<div style="background:#2e2f33;padding:8px"><button class="btn btn-link" style="color:#f7f6f3;border:0;background:none">dismiss</button></div>'),
        []
      );
      assert.deepEqual(await buttonProblems('<button class="btn btn-link" style="color:#026aa2;border:0;background:none">Logs</button>'), []);
    });

    test('fails: the vendor blue on white is 4.00:1', async () => {
      const found = await buttonProblems('<button class="btn btn-link" style="color:#0086c9;border:0;background:none">Inspect</button>');
      assert.equal(found.length, 1);
      assert.match(found[0], /4\.00:1/);
    });

    test('reads only what the selector names', async () => {
      const body =
        '<a href="#" style="color:#0086c9">a text link</a><button class="btn btn-link" style="color:#0086c9;border:0;background:none">a button</button><button disabled class="btn btn-link" style="color:#999;border:0;background:none">off</button>';
      assert.deepEqual(
        (await run(measure.measureLinkContrasts, body, '.btn-link')).map((e) => e.text),
        ['a button']
      );
      assert.deepEqual(
        (await run(measure.measureLinkContrasts, body)).map((e) => e.text),
        ['a text link']
      );
    });
  });
});

describe('readBackgroundImages', () => {
  async function onImage(body) {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html><head>${HEAD}</head><body>${body}</body></html>`);
      const entries = await page.evaluate(measure.measureLinkContrasts);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].unreadable, true);
      return measure.lowContrastLinks(await measure.readBackgroundImages(page, browser, entries));
    } finally {
      await context.close();
    }
  }

  test('passes: a link on a pale gradient is read from the pixels behind it', async () => {
    assert.deepEqual(await onImage('<div style="background:linear-gradient(#fff,#eee);padding:8px"><a href="#" style="color:#026aa2">Learn more here</a></div>'), []);
  });

  // The pale blue of a picture under the word is what counts, not the colour at the edge of the box.
  test('fails: a link over a dark patch of a picture is under 4.5:1', async () => {
    const found = await onImage(
      '<div style="background:linear-gradient(90deg,#fff 0,#fff 30px,#1b3a57 30px,#1b3a57 100%);padding:8px 8px 8px 0"><a href="#" style="color:#026aa2;margin-left:20px;display:inline-block;width:160px">Learn more here</a></div>'
    );
    assert.equal(found.length, 1);
    assert.match(found[0], /background image/);
    assert.match(found[0], /:1$/);
  });
});
