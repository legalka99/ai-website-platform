import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Current tracked files (including archives) + non-ignored untracked files. Not a Git-history scanner.
const names = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
const rules = [
  ['provider-key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{25,}/],
  ['aws-key', /\bAKIA[A-Z0-9]{16}/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{40,}/],
  ['auth-token', /\b(?:Bearer|Api-Key)\s+(?!TEST_ONLY)[A-Za-z0-9._-]{24,}/],
  ['secret-assignment', /(?:api[_-]?key|secret|password|access[_-]?token)\s*[=:]\s*["']?(?!TEST_ONLY|process\.|config\.|undefined|null|\[)[A-Za-z0-9_+/=-]{24,}/i],
];
const findings = []; let scanned = 0;
for (const name of names) {
  const path = resolve(root, name); let stat;
  try { stat = lstatSync(path); } catch { continue; }
  if (stat.isSymbolicLink()) { findings.push({ file: name, rule: 'symlink-review-required' }); continue; }
  if (!stat.isFile()) continue;
  if (/(^|\/)(\.env(?:\..*)?|id_rsa.*|id_ed25519.*)$|\.(pem|key|p12|pfx|keystore)$/.test(name) && !name.endsWith('.env.example')) findings.push({ file:name, rule:'secret-file-tracked' });
  if (stat.size > 10000000) { findings.push({ file:name, rule:'file-too-large-for-scan' }); continue; }
  const text = readFileSync(path, 'utf8'); scanned++;
  for (const [rule, pattern] of rules) if (pattern.test(text)) findings.push({ file:name, rule });
}
// Only filenames and rule names, never matching values or complete lines.
console.log(JSON.stringify({ scanned, includesArchives: true, findings }, null, 2));
if (findings.length) process.exitCode = 1;
