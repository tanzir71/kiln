import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { notarize } from '@electron/notarize';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');
const appPath = join(releaseDir, 'mac-arm64', 'Kiln.app');

function fail(message) {
  throw new Error(`Public release blocked: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${basename(command)} failed${detail ? `:\n${detail}` : ''}`);
  }

  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function completeStrategy(label, required, optional = []) {
  const supplied = required.filter((name) => process.env[name]);
  if (supplied.length === 0) return null;
  if (supplied.length !== required.length) {
    const missing = required.filter((name) => !process.env[name]);
    fail(`${label} notarization credentials are incomplete; missing ${missing.join(', ')}`);
  }
  return { label, required, optional };
}

function notarizationOptions(artifactPath) {
  const strategies = [
    completeStrategy('Apple ID', ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']),
    completeStrategy('App Store Connect API key', ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']),
    completeStrategy('Keychain profile', ['APPLE_KEYCHAIN_PROFILE'], ['APPLE_KEYCHAIN']),
  ].filter(Boolean);

  if (strategies.length === 0) {
    fail('configure one notarization credential strategy: Apple ID, App Store Connect API key, or APPLE_KEYCHAIN_PROFILE');
  }
  if (strategies.length > 1) {
    fail(`configure only one notarization credential strategy; found ${strategies.map(({ label }) => label).join(', ')}`);
  }

  const [{ label }] = strategies;
  if (label === 'Apple ID') {
    return {
      appPath: artifactPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    };
  }
  if (label === 'App Store Connect API key') {
    if (!existsSync(process.env.APPLE_API_KEY)) {
      fail('APPLE_API_KEY must be the path to the downloaded .p8 private key');
    }
    return {
      appPath: artifactPath,
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
    };
  }
  return {
    appPath: artifactPath,
    keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE,
    ...(process.env.APPLE_KEYCHAIN ? { keychain: process.env.APPLE_KEYCHAIN } : {}),
  };
}

function assertDeveloperIdAvailable() {
  if (process.env.CSC_LINK) return;

  const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { capture: true });
  if (!identities.includes('Developer ID Application:')) {
    fail('install a Developer ID Application certificate, or provide it through CSC_LINK');
  }
}

function preflight() {
  assertDeveloperIdAvailable();
  notarizationOptions('/tmp/preflight.dmg');
  run('/usr/bin/xcrun', ['--find', 'notarytool'], { capture: true });
}

function verifyRelease(dmgPath) {
  run('/usr/bin/hdiutil', ['verify', dmgPath]);
  run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath]);
  run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath]);

  const mountpoint = mkdtempSync(join(tmpdir(), 'kiln-release-'));
  let attached = false;
  try {
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, dmgPath]);
    attached = true;
    const mountedApp = join(mountpoint, 'Kiln.app');
    if (!existsSync(mountedApp)) fail('the DMG does not contain Kiln.app');

    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', mountedApp]);
    const signature = run('/usr/bin/codesign', ['-dv', '--verbose=4', mountedApp], { capture: true });
    if (!signature.includes('Authority=Developer ID Application:')) {
      fail('Kiln.app is not signed with a Developer ID Application certificate');
    }
    run('/usr/bin/xcrun', ['stapler', 'validate', mountedApp]);
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', mountedApp]);
  } finally {
    if (attached) execFileSync('/usr/bin/hdiutil', ['detach', mountpoint], { stdio: 'inherit' });
    rmSync(mountpoint, { recursive: true, force: true });
  }
}

async function main() {
  preflight();
  run('npm', ['run', 'build']);
  run(join(root, 'node_modules', '.bin', 'electron-builder'), ['--mac', 'dmg', 'zip', '--arm64']);

  const dmgNames = readdirSync(releaseDir).filter((name) => name.endsWith('.dmg'));
  if (dmgNames.length !== 1) fail(`expected one DMG in release/, found ${dmgNames.length}`);

  const dmgPath = join(releaseDir, dmgNames[0]);
  await notarize(notarizationOptions(dmgPath));
  verifyRelease(dmgPath);
  console.log(`Public release ready: ${dmgPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
