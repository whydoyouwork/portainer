// Guards of the check suite itself: it only talks to a loopback server, reads
// the password from a private file, and runs on the pinned Playwright.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { isLoopbackHost, targetURL, readPassword } = require('./lib/config');

describe('target server', () => {
  test('loopback addresses are accepted', () => {
    for (const url of ['http://127.0.0.1:9001', 'http://localhost:9000', 'https://127.0.0.2:9443', 'http://[::1]:9000']) {
      assert.doesNotThrow(() => targetURL({}, url), url);
    }
  });

  test('anything that is not loopback is refused', () => {
    for (const url of [
      'http://192.0.2.10:9001',
      'https://portainer.example.com',
      'http://10.0.0.5:9000',
      'http://127.0.0.1.example.com:9000',
      'http://127.0.0.1@evil.example.com/',
    ]) {
      assert.throws(() => targetURL({}, url), /not a loopback address/, url);
    }
    assert.equal(isLoopbackHost('example.com'), false);
  });

  test('a remote server needs the explicit override', () => {
    assert.equal(targetURL({ PORTAINER_E2E_ALLOW_REMOTE: '1' }, 'http://192.0.2.10:9001'), 'http://192.0.2.10:9001');
    assert.throws(() => targetURL({ PORTAINER_E2E_ALLOW_REMOTE: 'yes' }, 'http://192.0.2.10:9001'), /not a loopback address/);
  });

  test('the default is the local build on port 9001', () => {
    assert.equal(targetURL({}), 'http://127.0.0.1:9001');
  });
});

describe('administrator password', () => {
  function withFile(mode, content, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pw-'));
    const file = path.join(dir, 'pw');
    fs.writeFileSync(file, content, { mode });
    fs.chmodSync(file, mode);
    try {
      return fn(file);
    } finally {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    }
  }

  test('is read from a private file', () => {
    withFile(0o600, 'a-test-secret\n', (file) => {
      assert.equal(readPassword({ PORTAINER_E2E_PASSWORD_FILE: file }, 'linux'), 'a-test-secret');
    });
  });

  test('a file other users can read is refused', () => {
    withFile(0o644, 'a-test-secret\n', (file) => {
      assert.throws(() => readPassword({ PORTAINER_E2E_PASSWORD_FILE: file }, 'linux'), /readable by other users/);
    });
  });

  test('a missing or empty file is refused', () => {
    assert.throws(() => readPassword({ PORTAINER_E2E_PASSWORD_FILE: path.join(os.tmpdir(), 'no-such-file-for-e2e') }, 'linux'), /does not exist/);
    withFile(0o600, '\n', (file) => {
      assert.throws(() => readPassword({ PORTAINER_E2E_PASSWORD_FILE: file }, 'linux'), /is empty/);
    });
  });

  test('an environment variable is not a way to pass it', () => {
    assert.throws(
      () => readPassword({ PORTAINER_E2E_PASSWORD: 'typed-on-a-command-line', PORTAINER_E2E_PASSWORD_FILE: path.join(os.tmpdir(), 'no-such-file-for-e2e') }, 'linux'),
      /does not exist/
    );
  });
});

describe('Playwright', () => {
  const pinned = require('./package.json').devDependencies.playwright;

  test('is pinned to an exact version', () => {
    assert.match(pinned, /^\d+\.\d+\.\d+$/, `package.json has "${pinned}"; pin an exact version`);
  });

  test('is the pinned version, installed inside this package', () => {
    const resolved = require.resolve('playwright');
    assert.ok(
      resolved.startsWith(`${__dirname}${path.sep}node_modules${path.sep}`),
      `playwright resolves to ${resolved}, not to this package's node_modules (run pnpm install --frozen-lockfile in e2e/mobile)`
    );
    assert.equal(require('playwright/package.json').version, pinned);
  });
});
