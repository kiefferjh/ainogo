import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { join, resolve } from 'node:path';

const tag = process.env.AINOGO_RELEASE_TAG ?? 'desktop-v1.2.2';
assert.match(tag, /^desktop-v\d+\.\d+\.\d+$/);
const version = tag.slice('desktop-v'.length);
const kind = process.env.AINOGO_DOWNLOAD_KIND;
const formats = {
  'linux-archive': ['linux', `Ainogo-${version}-linux-x64.tar.gz`],
  'linux-appimage': ['linux', `Ainogo-${version}-linux-x86_64.AppImage`],
  'windows-installer': ['win32', `Ainogo-${version}-windows-x64-setup.exe`],
  'windows-portable': ['win32', `Ainogo-${version}-win-x64.exe`],
  'mac-zip': ['darwin', `Ainogo-${version}-mac-universal.zip`],
};
assert.ok(formats[kind], 'Choose an AINOGO_DOWNLOAD_KIND.');
const [platform, filename] = formats[kind];
assert.equal(process.platform, platform, 'Downloads must be tested on their native OS.');
const directory = mkdtempSync(join(tmpdir(), 'Ainogo downloaded app '));
const asset = join(directory, filename);
const run = (command, args, env = process.env) => execFileSync(command, args,
  { env, encoding: 'utf8', timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
if (process.env.AINOGO_DOWNLOAD_SOURCE) {
  for (const name of [filename, 'SHA256SUMS']) copyFileSync(join(resolve(process.env.AINOGO_DOWNLOAD_SOURCE), name), join(directory, name));
} else {
  run('gh', ['release', 'download', tag, '--repo', 'kiefferjh/ainogo', '--dir', directory,
    '--pattern', filename, '--pattern', 'SHA256SUMS']);
}
const checksum = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').split(/\r?\n/)
  .map(line => /^([a-f0-9]{64})  (.+)$/.exec(line)).find(match => match?.[2] === filename)?.[1];
assert.ok(checksum, 'The exact download must appear in SHA256SUMS.');
const hash = createHash('sha256');
for await (const chunk of createReadStream(asset)) hash.update(chunk);
assert.equal(hash.digest('hex'), checksum, 'Published download checksum mismatch.');
const target = join(directory, 'Installed app with spaces');
mkdirSync(target);
const dataParent = join(directory, 'Participant data with spaces');
mkdirSync(dataParent);
const runtimeParent = join(directory, 'Runtime extraction with spaces');
mkdirSync(runtimeParent);
const env = { ...process.env, AINOGO_EXPECTED_ARCH: process.arch, AINOGO_EXPECTED_VERSION: version,
  AINOGO_TEST_DATA_PARENT: dataParent, TMPDIR: runtimeParent, TMP: runtimeParent, TEMP: runtimeParent };
let script = 'scripts/desktop-smoke.mjs';
if (kind === 'linux-archive') {
  run('tar', ['-xzf', asset, '-C', target]);
  env.AINOGO_PACKAGED_EXECUTABLE = join(target, `Ainogo-${version}-linux-x64`, 'ainogo');
} else if (kind === 'linux-appimage') {
  chmodSync(asset, 0o755);
  env.AINOGO_PACKAGED_EXECUTABLE = asset;
  env.APPIMAGE_EXTRACT_AND_RUN = '1';
  script = 'scripts/download-launch-smoke.mjs';
} else if (kind === 'mac-zip') {
  run('ditto', ['-x', '-k', asset, target]);
  const bundle = join(target, 'Ainogo.app');
  env.AINOGO_PACKAGED_EXECUTABLE = join(bundle, 'Contents', 'MacOS', 'Ainogo');
  const architectures = run('lipo', ['-archs', env.AINOGO_PACKAGED_EXECUTABLE]);
  assert.match(architectures, /\bx86_64\b/);
  assert.match(architectures, /\barm64\b/);
  run('codesign', ['--verify', '--deep', '--strict', bundle]);
} else if (kind === 'windows-installer') {
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$p = Start-Process -FilePath $env:AINOGO_INSTALLER -ArgumentList ('/S /currentuser /D=' + $env:AINOGO_INSTALL_DIR) -Wait -PassThru; if ($p.ExitCode -ne 0) { throw ('Installer exit ' + $p.ExitCode) }"],
  { ...env, AINOGO_INSTALLER: asset, AINOGO_INSTALL_DIR: target });
  env.AINOGO_PACKAGED_EXECUTABLE = join(target, 'Ainogo.exe');
} else {
  env.AINOGO_PACKAGED_EXECUTABLE = asset;
  script = 'scripts/download-launch-smoke.mjs';
}
const output = run(process.execPath, [script], env);
process.stdout.write(output);
const evidence = JSON.parse(output.trim().split(/\r?\n/).findLast(line => line.startsWith('{')));
const report = { tag, filename, checksum, operatingSystem: `${process.platform} ${release()}`, arch: process.arch,
  source: process.env.AINOGO_DOWNLOAD_SOURCE ? 'local-build' : 'published-release',
  normalAppSandbox: env.AINOGO_TEST_NO_SANDBOX !== '1', appImageFuseFree: kind === 'linux-appimage', evidence };
if (process.env.AINOGO_VERIFICATION_REPORT) writeFileSync(process.env.AINOGO_VERIFICATION_REPORT, JSON.stringify(report, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY,
  `### ${filename}\n\nNative OS: ${report.operatingSystem}; architecture: ${report.arch}.\n\nSHA-256: \`${checksum}\`.\n\nDownload launch, offline study, partial saving and restart recovery passed.\n`, { flag: 'a' });
console.log(JSON.stringify(report));
