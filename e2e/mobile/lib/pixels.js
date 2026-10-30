// Pixel-for-pixel comparison of two PNG images, with no extra dependency.
//
// Both images are decoded by the browser into canvases inside a blank page and
// compared channel by channel. A pixel differs if any of its red, green, blue
// or alpha values differs by more than `channelTolerance` (0 means any
// difference at all).

// Runs in the browser, so it must not close over anything from this module.
function compareInBrowser([expectedBase64, actualBase64, channelTolerance]) {
  const decode = (base64) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        resolve(context.getImageData(0, 0, canvas.width, canvas.height));
      };
      image.onerror = () => reject(new Error('could not decode image'));
      image.src = `data:image/png;base64,${base64}`;
    });

  return Promise.all([decode(expectedBase64), decode(actualBase64)]).then(([expected, actual]) => {
    const result = {
      expected: { width: expected.width, height: expected.height },
      actual: { width: actual.width, height: actual.height },
      sameSize: expected.width === actual.width && expected.height === actual.height,
      differing: 0,
      maxDelta: 0,
      box: null,
      diffPng: null,
    };
    if (!result.sameSize) {
      return result;
    }

    const { width, height } = expected;
    const out = new ImageData(width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0; i < expected.data.length; i += 4) {
      const delta = Math.max(
        Math.abs(expected.data[i] - actual.data[i]),
        Math.abs(expected.data[i + 1] - actual.data[i + 1]),
        Math.abs(expected.data[i + 2] - actual.data[i + 2]),
        Math.abs(expected.data[i + 3] - actual.data[i + 3])
      );
      result.maxDelta = Math.max(result.maxDelta, delta);
      if (delta <= channelTolerance) {
        // faded copy of the image so the changed pixels stand out
        out.data[i] = actual.data[i] * 0.25 + 191;
        out.data[i + 1] = actual.data[i + 1] * 0.25 + 191;
        out.data[i + 2] = actual.data[i + 2] * 0.25 + 191;
        out.data[i + 3] = 255;
      } else {
        result.differing += 1;
        const pixel = i / 4;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        out.data[i] = 255;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 255;
      }
    }
    if (result.differing > 0) {
      result.box = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').putImageData(out, 0, 0);
      result.diffPng = canvas.toDataURL('image/png').split(',')[1];
    }
    return result;
  });
}

// Compares two PNG buffers. `browser` is a Playwright browser; a throwaway
// blank page is used for decoding and closed again. The result has
// `differing` (pixels beyond the tolerance), `maxDelta` (the largest channel
// difference seen anywhere, even within the tolerance), `box` (bounding box of
// the differing pixels) and `diffPng` (a picture of them, or null).
async function comparePng(browser, expectedPng, actualPng, { channelTolerance = 0 } = {}) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('about:blank');
    const result = await page.evaluate(compareInBrowser, [expectedPng.toString('base64'), actualPng.toString('base64'), channelTolerance]);
    return { ...result, diffPng: result.diffPng ? Buffer.from(result.diffPng, 'base64') : null };
  } finally {
    await context.close();
  }
}

module.exports = { comparePng };
