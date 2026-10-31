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
| `measure.fixtures.test.js`  | measurement self-tests            | each in-page measurement (`lib/measure.js`) passes on a good fixture and fails on a planted-bad one, on every run: an element past the edge, `overflow-x: hidden` on `body`, a button clipped by its toolbar, text cut with an ellipsis, a badge laid over a title, a 30px button, a link too pale for its panel (on white, on grey, on a dark band, under a translucent layer, on a background image), and a page laid out without the viewport tag |
| `crawl.test.js`             | the crawl                         | the views are found by following the application's own links (a floor of 40 view templates; a crawl that finds one page fails)                                                                                                                                                                                                  |
|                             | every linked view                 | at 320, 390, 844x390, 767, 768 and 991 wide, nothing runs off the page outside a scroller, no call to action is clipped, no text is cut with nothing to tap, and no two texts overlap                                                                                                                                           |
|                             | touch targets                     | at 390 and 768 wide, buttons outside table rows are 24px or more, the minimum of WCAG 2.2 (links 24px tall)                                                                                                                                                                                                                                               |
| `a11y.test.js`              | phone drawer                      | the open drawer starts with a "Close menu" button (36px, first control, holds the initial focus) that closes it with the page behind inert and returns focus to the toggle; the button is level with the logo, so the menu loses no height at 568x320 and 568x270, also with an upgrade banner above the logo; its focus ring shows on all four sides; focus starts on a control with a visible ring of 3:1 or more; tapping the link of the page you are on closes it; no close button on tablets or desktop |
|                             | toggle and rail                   | the sidebar toggle has `aria-expanded` that follows the sidebar and `aria-controls` pointing at it; a touch tablet's rail item says it is expanded without claiming a pop-up menu                                                                                                                                     |
|                             | network containers table          | on phones it is a named region in the tab order with a visible ring that the arrow keys scroll; from 768px it adds no tab stop                                                                                                                                                                                      |
|                             | home search                       | at 320 and 390 wide the search field is at least 100px wide (24px is the target minimum); from 768px it does not stretch across its row                                                                                                                                                                              |
|                             | action bar                        | tabbing through the new group form and the environment wizard at 320x568, and through all eight views with a sticky bar at 844x390, no focused field is behind the fixed action bar; scroll padding is added up to 991px and none from 992px |
|                             | Business Feature badge            | every badge (beside a locked switch, on a locked panel, and under a locked box selector option) is 4.5:1 or more in the light theme on phones and tablets (up to 991px), and keeps the vendor's colours in the dark and high contrast themes; from 992px it keeps the vendor's `rgb(152, 162, 179)` |
|                             | link-style buttons                | every `.btn-link` (Logs, Inspect, Stats, Console, Attach, Change ownership, Advanced mode) is 4.5:1 or more in the light theme up to 991px, a hovered one is darker than one at rest, the dark and high contrast themes and widths from 992px keep the vendor's blue |
|                             | keyboard focus                    | the refresh button, a table's search field and selection checkboxes, the rename button and the selected card of a box selector paint a focus ring (3:1 or more, all the way round the control) up to 991px; from 992px they keep the vendor's look, with no ring |
|                             | breadcrumbs                       | a navigation landmark named "Breadcrumb", a home link named "Home", and one crumb (the last) marked as the current page, at every size                                                                                                                                                                              |
|                             | focus after a drawer link         | following a drawer link to another page, by keyboard or tap, leaves focus on the toggle of the page that was opened (not on the page body)                                                                                                                                                         |
|                             | environment wizard                | none of the five environment types runs off the page at 320, 390 and 767px, and its two panels are stacked; from 768px they stay side by side                                                                                                                                                                    |
|                             | Leave Network                     | the label is set on one line at 320 and 390px                                                                                                                                                                                                                                                                      |
|                             | Clear environment                 | 32-36px square in the phone drawer; the vendor's 20x20px on the tablet and desktop sidebars                                                                                                                                                                                                                              |
|                             | version button                    | at least 24px to tap in the phone drawer, with a visible focus indicator for keyboard users; unchanged on the desktop sidebar |
| `navigation.test.js`        | sidebar drawer as a dialog        | a closed drawer cannot be focused; an open one is a dialog, takes focus, keeps Tab inside it and makes the page behind inert (each seen failing on a planted fault)                                                                                                                                                             |
|                             | header menus                      | the user and notifications menus open inside the window at every small size, and close on Escape                                                                                                                                                                                                                                |
|                             | header controls                   | the sidebar toggle, home breadcrumb, notifications, help and user menu are 36px to tap                                                                                                                                                                                                                                          |
|                             | breadcrumbs                       | every crumb is shown in full (wrapped, never cut with an ellipsis) at every small size                                                                                                                                                                                                                                          |
|                             | tablet rail                       | the toggle expands the sidebar and every destination on the rail is in it                                                                                                                                                                                                                                                       |
|                             | tablet rail on touch              | a tap on a rail item with sub-items opens them instead of following its link; Escape, a tap outside and a choice close them; items without sub-items go straight there (fails on the unchanged rail)                                                                                                                            |
| `density.test.js`           | key/value tables                  | at 390 the label column of a container's status table is at most 40% of the table and its ID takes at most 3 lines (at 320: 45% and 4); a button in a narrow cell keeps its word whole; the tablet keeps the vendor's layout |
|                             | padding                           | on phones cells use 6px above and below and widgets 14px at the sides; from 768px the vendor's 8px and 20px stay |
|                             | compact controls                  | on touch screens up to 991px a Bootstrap button is 30-34px tall with 13px text, a field 36-40px with 16px text; a mouse at 768px keeps the vendor's 30px button |
|                             | label words below 360px           | at 320, 340 and 359 no word of the label column of a key/value table (a container's and an image's page) is cut in two and the page does not scroll sideways |
|                             | quick actions of a row            | on touch screens up to 991px each icon link of the containers list is at least 24x24 and its icon is still drawn 13x13; a mouse at 800px and a desktop keep the vendor's 13px links |
|                             | console radio buttons             | on touch screens up to 991px the 24px circle on each console radio button of the new container form stays inside its own line; a desktop keeps the vendor's lines |
| `links.test.js`             | text links                        | every visible link on every linked view is 4.5:1 or more against what is painted behind it at 390, 768 and 991 wide in the light theme, and so are the links of the open phone drawer; a text link's hover is darker than at rest; a link with a colour of its own (primary button, breadcrumb, drawer, active tab) keeps it; the dark and high contrast themes keep the vendor's colours and also reach 4.5:1; from 992px the vendor's blues stay (each seen failing on a planted fault) |
|                             | link-style buttons                | every `.btn-link` on every linked view is 4.5:1 or more against what is actually behind it, in the light theme at 390, 768 and 991 and in the dark and high contrast themes at 390; the dismiss button of the news panel (pale text on a dark panel) keeps its colour at rest and on hover in every theme; from 992px the vendor's colours stay |
| `desktop-unchanged.test.js` | comparison self-test              | the pixel comparison notices one changed pixel, a one pixel shift, and a 3/255 colour difference                                                                                                                                                                                                                                |
|                             | desktop is unchanged              | each view at 1440x900 and 1920x1080 matches its baseline: same size and no differing pixels                                                                                                                                                                                                                                     |
| `csp-and-overlay.test.js`   | content security policy           | the page is served with a policy without `'unsafe-inline'`, and loading each view raises the same policy violations as the unchanged build                                                                                                                                                                                      |
|                             | nothing covers the desktop layout | at 1440 and 1920 wide, the element on top at the centre of the main controls is the control itself                                                                                                                                                                                                                              |
| `fence.test.js`             | stylesheets are fenced            | every rule of `mobile.css` and `bootstrap-mobile.css` is inside a media query of max-width 991px or less, so desktop widths cannot change |
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
