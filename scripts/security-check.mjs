import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
for (const name of ['.env', '.env.local', 'test.key', 'test.pem', 'test.log', 'coverage/test', '.test-build/test', 'secrets.local.json']) {
  try { execFileSync('git', ['check-ignore', '-q', name], { cwd: root }); } catch { failures.push(`Not ignored: ${name}`); }
}
try { execFileSync('git', ['check-ignore', '-q', '.env.example'], {cwd:root}); failures.push('.env.example must remain trackable'); } catch { /* Expected nonzero */ }
const envPath = root + '.env';
if (existsSync(envPath)) {
  const s = lstatSync(envPath);
  if (!s.isFile() || s.isSymbolicLink() || (process.platform !== 'win32' && ((s.mode & 0o077) !== 0 || s.uid !== process.getuid?.()))) failures.push('.env ownership/permissions unsafe');
}
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd:root,encoding:'utf8'}).split('\0').filter(x=>x.endsWith('.ts'));
for (const file of new Set(files)) {
  const code = readFileSync(root + file, 'utf8');
  if (/\beval\s*\(|new\s+Function\s*\(|(?:node:)?child_process/.test(code)) failures.push(`Code execution review required: ${file}`);
  if (file.includes('/agents/') && /process\.env|node:(?:fs|net|http|https)|SecretProvider|OPENAI_API_KEY/.test(code)) failures.push(`Agent capability boundary violation: ${file}`);
}
console.log(JSON.stringify({ checks: 'ignore rules, local env metadata, basic static boundaries', failures }, null, 2));
if (failures.length) process.exitCode = 1;
