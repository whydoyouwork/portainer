# Mobile layout checks

Browser checks for how Portainer looks and behaves on a phone or tablet, plus one check that the
desktop layout has not moved. They drive a running Portainer with Playwright and the built-in
`node:test` runner.

This folder is its own package (own `package.json`, own `pnpm-lock.yaml`). It is not part of the
application's build, lint, type check or unit tests, and it changes none of them.

Only the mobile behaviour is tested here. Existing features are not.

The crawl and navigation checks take a few minutes. Set `MOBILE_CRAWL_SIZES` (for example
`phone390,tablet`) to crawl fewer sizes.

## Run

```sh
cd e2e/mobile
pnpm install --frozen-lockfile        # installs the pinned Playwright into e2e/mobile/node_modules
PORTAINER_E2E_URL=http://127.0.0.1:9001 pnpm test
```

From the repository root the same thing is
`node --test --test-concurrency=1 "e2e/mobile/*.test.js"`.

Playwright needs its Chromium browser. If it is not installed yet, run
`pnpm exec playwright install chromium` once. That uses Playwright's default download location;
do not point it at another host.

### Settings

| Variable                      | Meaning                                                  | Default                     |
| ----------------------------- | -------------------------------------------------------- | --------------------------- |
| `PORTAINER_E2E_URL`           | the Portainer under test                                 | `http://127.0.0.1:9001`     |
| `PORTAINER_E2E_USER`          | an administrator of that instance                        | `admin`                     |
| `PORTAINER_E2E_PASSWORD_FILE` | file holding that administrator's password               | `~/.portainer-e2e/admin-pw` |
| `PORTAINER_E2E_ALLOW_REMOTE`  | set to `1` to allow a server that is not on this machine | unset                       |

The password is only ever read from a file that nobody else can read (mode `0600`). It is not taken
from an environment variable or the command line, so it never shows up in a process list or a log.
To create the file without typing the password into a command:

```sh
mkdir -p ~/.portainer-e2e && chmod 700 ~/.portainer-e2e
( umask 077; read -rsp 'Administrator password: ' pw; printf '%s' "$pw" > ~/.portainer-e2e/admin-pw )
```

The checks sign in as an administrator, so they refuse any `PORTAINER_E2E_URL` that is not a
loopback address (`127.0.0.0/8`, `localhost`, `::1`) unless `PORTAINER_E2E_ALLOW_REMOTE=1`. Start the
instance under test with its tunnel server on loopback too (`--tunnel-addr 127.0.0.1`).

The checks were written against a local Docker environment with id `1` holding six containers and
two images. They run with the page's Content-Security-Policy on.

## What each check guards

| File                        | Check                             | Guards                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobile.test.js`            | viewport                          | the page declares `width=device-width`, and at 360, 390, 844 and 768 px wide the layout is that wide                                                                                                                                                                                                                            |
|                             | no sideways page scroll           | none of the six views is wider than the window at those sizes                                                                                                                                                                                                                                                                   |
|                             | sidebar drawer (below 768 px)     | closed on load with the content at the left edge; the toggle opens it with a backdrop; tapping the backdrop closes it; Escape closes it and focus returns to the toggle; following a link navigates and closes it; an open dialog is never covered by the drawer                                                                |
|                             | sidebar rail (768 px and wider)   | the rail stays and there is no backdrop                                                                                                                                                                                                                                                                                         |
|                             | data tables on a phone            | on the container and image lists, the card is inside the window, the table scrolls sideways inside the card, and every toolbar button is inside the window and the card                                                                                                                                                         |
| `measure.fixtures.test.js`  | measurement self-tests            | each in-page measurement (`lib/measure.js`) passes on a good fixture and fails on a planted-bad one, on every run: an element past the edge, `overflow-x: hidden` on `body`, a button clipped by its toolbar, text cut with an ellipsis, a badge laid over a title, a 30px button, and a page laid out without the viewport tag |
| `crawl.test.js`             | the crawl                         | the views are found by following the application's own links (a floor of 40 view templates; a crawl that finds one page fails)                                                                                                                                                                                                  |
|                             | every linked view                 | at 320, 390, 844x390, 767, 768 and 991 wide, nothing runs off the page outside a scroller, no call to action is clipped, no text is cut with nothing to tap, and no two texts overlap                                                                                                                                           |
|                             | touch targets                     | at 390 and 768 wide, buttons outside table rows are 44px square (links 44px tall)                                                                                                                                                                                                                                               |
| `navigation.test.js`        | sidebar drawer as a dialog        | a closed drawer cannot be focused; an open one is a dialog, takes focus, keeps Tab inside it and makes the page behind inert (each seen failing on a planted fault)                                                                                                                                                             |
|                             | header menus                      | the user and notifications menus open inside the window at every small size, and close on Escape                                                                                                                                                                                                                                |
|                             | header controls                   | the sidebar toggle, home breadcrumb, notifications, help and user menu are 44px to tap                                                                                                                                                                                                                                          |
|                             | breadcrumbs                       | every crumb is shown in full (wrapped, never cut with an ellipsis) at every small size                                                                                                                                                                                                                                          |
|                             | tablet rail                       | the toggle expands the sidebar and every destination on the rail is in it                                                                                                                                                                                                                                                       |
|                             | tablet rail on touch              | a tap on a rail item with sub-items opens them instead of following its link; Escape, a tap outside and a choice close them; items without sub-items go straight there (fails on the unchanged rail)                                                                                                                            |
| `desktop-unchanged.test.js` | comparison self-test              | the pixel comparison notices one changed pixel, a one pixel shift, and a 3/255 colour difference                                                                                                                                                                                                                                |
|                             | desktop is unchanged              | each view at 1440x900 and 1920x1080 matches its baseline: same size and no differing pixels                                                                                                                                                                                                                                     |
| `csp-and-overlay.test.js`   | content security policy           | the page is served with a policy without `'unsafe-inline'`, and loading each view raises the same policy violations as the unchanged build                                                                                                                                                                                      |
|                             | nothing covers the desktop layout | at 1440 and 1920 wide, the element on top at the centre of the main controls is the control itself                                                                                                                                                                                                                              |
| `guards.test.js`            | suite guards                      | remote servers are refused, the password file must be private, Playwright is pinned and installed in this package                                                                                                                                                                                                               |

## Baselines

`__baselines__/` holds one PNG per view and desktop size, `motd.json` (a small neutral stand-in for
the news banner), `csp-violations.json` (what the unchanged build reports to the policy) and
`manifest.json`.

Capture them from a build that does **not** contain the mobile changes:

```sh
cd e2e/mobile
node capture-baselines.js http://127.0.0.1:9000     # an unchanged build
```

The URL is a required argument so that a changed build cannot be used by accident. Every view is
captured twice and a baseline is only written if the two captures agree, so a page that is not
deterministic is rejected rather than trusted.

What is fixed so the comparison does not depend on the machine or the day:

- timestamps and IPv4 addresses anywhere in the page are replaced by a fixed string of the same shape
  (the environment card on the home view, the Created columns, the container IP column);
- the news banner is answered from `motd.json`, and the Docker Hub pull counter from a fixed value;
- animations, transitions and the text caret are frozen, and a screenshot is only taken once two in a
  row are identical.

A capture occasionally (about one in twenty) catches the sidebar in a different state. A real change is
there on every capture, so the check retries a mismatch once and the baseline script retries a
disagreeing pair up to three times. A page that never agrees is rejected.

Pixels may differ by up to 2 out of 255 per channel and still count as equal. That is the measured
size of the anti-aliasing noise on rounded borders in the container and image lists; anything that
moves or resizes an element changes pixels by far more.

No host, settings or edge view is used as a baseline, because those show details of the machine.

Refresh the baselines only when the desktop design is meant to change, or the sample data changes.
Look at every PNG before committing it.

Failed comparisons write the captured page and a picture of the differing pixels to `__output__/`,
which is ignored by git.
