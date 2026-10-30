// Shared settings for the mobile end-to-end checks.
//
// Everything that varies between machines is read from the environment or a
// file, so no URL or credential is ever committed or typed on a command line.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USER = process.env.PORTAINER_E2E_USER || 'admin';

// The sample data these checks were written against: a local Docker
// environment with id 1 and a handful of containers and images.
const ENDPOINT_ID = 1;

// Hash routes covered by the checks. Only views that show nothing about the
// machine they run on: no host, settings or edge views.
const VIEWS = {
  home: '#!/home',
  dashboard: `#!/${ENDPOINT_ID}/docker/dashboard`,
  containers: `#!/${ENDPOINT_ID}/docker/containers`,
  'containers-new': `#!/${ENDPOINT_ID}/docker/containers/new`,
  images: `#!/${ENDPOINT_ID}/docker/images`,
  users: '#!/users',
};

// Breakpoint scale is Bootstrap 3's: the sidebar becomes a drawer below 768px.
const DRAWER_BREAKPOINT = 768;

// `mobile` makes Chromium behave like a phone browser: it honours (or
// ignores) the viewport meta tag and reports touch support.
const VIEWPORTS = {
  phone320: { name: 'phone-320x568', width: 320, height: 568, mobile: true },
  phone360: { name: 'phone-360x740', width: 360, height: 740, mobile: true },
  phone390: { name: 'phone-390x844', width: 390, height: 844, mobile: true },
  phoneLandscape: { name: 'phone-landscape-844x390', width: 844, height: 390, mobile: true },
  // Both sides of the 768px (drawer) and 992px (sidebar rail) breakpoints.
  tablet767: { name: 'tablet-767x1024', width: 767, height: 1024, mobile: true },
  tablet: { name: 'tablet-768x1024', width: 768, height: 1024, mobile: true },
  tablet991: { name: 'tablet-991x800', width: 991, height: 800, mobile: true },
  desktop1440: { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  desktop1920: { name: 'desktop-1920x1080', width: 1920, height: 1080, mobile: false },
};

const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]']);

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname) || /^127(\.\d{1,3}){3}$/.test(hostname);
}

// The server under test, from PORTAINER_E2E_URL (default http://127.0.0.1:9001).
// These checks sign in as an administrator, so they only talk to a server on
// this machine unless PORTAINER_E2E_ALLOW_REMOTE=1 says otherwise.
function targetURL(env = process.env, raw = env.PORTAINER_E2E_URL || 'http://127.0.0.1:9001') {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`"${raw}" is not an http or https URL`);
  }
  if (!isLoopbackHost(url.hostname) && env.PORTAINER_E2E_ALLOW_REMOTE !== '1') {
    throw new Error(`refusing to sign in to ${url.origin}: it is not a loopback address. Set PORTAINER_E2E_ALLOW_REMOTE=1 only if you mean to run against a remote test instance.`);
  }
  return url.origin;
}

// Where the administrator password is read from: a file that only its owner
// can read, outside the repository. It is never taken from the command line or
// an environment variable, so it cannot end up in a process list or a log.
function passwordFile(env = process.env) {
  return env.PORTAINER_E2E_PASSWORD_FILE || path.join(os.homedir(), '.portainer-e2e', 'admin-pw');
}

function readPassword(env = process.env, platform = process.platform) {
  const file = passwordFile(env);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error(`cannot read the administrator password: ${file} does not exist. Put it in that file (mode 0600) or point PORTAINER_E2E_PASSWORD_FILE at one.`);
  }
  if (platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`${file} is readable by other users (mode ${(stat.mode & 0o777).toString(8)}); run chmod 600 on it`);
  }
  const password = fs.readFileSync(file, 'utf8').trim();
  if (!password) {
    throw new Error(`${file} is empty`);
  }
  return password;
}

module.exports = { USER, ENDPOINT_ID, VIEWS, DRAWER_BREAKPOINT, VIEWPORTS, isLoopbackHost, targetURL, passwordFile, readPassword };
