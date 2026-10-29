import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2] ?? 'release';
const lines = [];
for (const name of readdirSync(directory).filter(name => /\.(exe|AppImage|tar\.gz|zip)$/.test(name)).sort()) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
if (!lines.length) throw new Error('No desktop packages were found.');
writeFileSync(join(directory, 'SHA256SUMS'), lines.join('\n') + '\n');
