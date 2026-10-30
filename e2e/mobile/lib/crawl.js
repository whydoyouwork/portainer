// Finds the views to check by following the application's own links, not from a hand-kept list.

// Ids are replaced so that /containers/<hash>/logs and /containers/<other hash>/logs are one view.
function routeTemplate(route) {
  return route
    .replace(/\?.*$/, '')
    .replace(/[0-9a-f]{64}/g, ':id')
    .replace(/sha256%3A:id/g, ':id')
    .replace(/sha256%3A[0-9a-f]+/g, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
}

// Links that leave the page, end the session, or open a console on the machine.
const SKIPPED = /logout|#!\/auth|kubeconfig|\/exec|\/console|\/attach|#kubernetes-settings/;

const START = ['#!/home', '#!/1/docker/dashboard'];

// Breadth first over `a[href^="#!/"]` from the signed-in landing views. One representative route per
// template. Returns { routes, skipped }.
async function discoverRoutes(page, baseURL, { max = 120, settle } = {}) {
  const seen = new Map(); // template -> first route
  const skipped = new Set();
  const queue = [...START];
  while (queue.length && seen.size < max) {
    const route = queue.shift();
    const template = routeTemplate(route);
    if (seen.has(template)) continue;
    seen.set(template, route);
    await page.goto(`${baseURL}/${route}`);
    await settle(page);
    const links = await page.$$eval('a[href^="#!/"]', (anchors) => anchors.map((a) => a.getAttribute('href')));
    for (const link of links) {
      if (SKIPPED.test(link)) {
        skipped.add(link);
        continue;
      }
      if (!seen.has(routeTemplate(link))) queue.push(link);
    }
  }
  return { routes: [...seen.values()], skipped: [...skipped] };
}

module.exports = { routeTemplate, discoverRoutes, SKIPPED, START };
