import { readdir, readFile, lstat } from "node:fs/promises";
const root = new URL("../apps/web/dist/", import.meta.url),
  findings = [];
const rules = [
  ["local-path", /(?:\/Users\/|\/private\/|\/tmp\/|[A-Z]:\\Users\\)/],
  ["brand-archive-reference", /AiVeron-Brand-Assets[^"\s]*\.zip/i],
  [
    "server-secret-reference",
    /\b(?:PGPASSWORD|DATABASE_URL|OPENAI_API_KEY|YANDEX_API_KEY|SESSION_SECRET)\b/,
  ],
  ["database-url", /postgres(?:ql)?:\/\//],
  ["provider-key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{25,}/],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "credential-literal",
    /\b(?:Bearer|Api-Key)\s+(?!TEST_ONLY)[A-Za-z0-9._-]{24,}/,
  ],
  ["aws-key", /\bAKIA[A-Z0-9]{16}/],
  [
    "server-module",
    /\b(?:node:fs|node:crypto|AuthRepository|PostgresPersistence)\b/,
  ],
];
let count = 0;
async function walk(dir) {
  for (const name of await readdir(dir)) {
    const url = new URL(name, dir),
      stat = await lstat(url);
    if (stat.isSymbolicLink()) {
      findings.push({ rule: "symlink" });
      continue;
    }
    if (stat.isDirectory()) {
      await walk(new URL(name + "/", dir));
      continue;
    }
    if (/\.(?:zip|pdf)$/i.test(name)) findings.push({ rule: "non-web-asset" });
    count++;
    const text = await readFile(url, "utf8");
    for (const [rule, re] of rules)
      if (re.test(text))
        findings.push({ file: url.pathname.slice(root.pathname.length), rule });
  }
}
try {
  await walk(root);
  for (const name of ["aiveron-logo.svg", "aiveron-symbol.svg", "favicon.svg", "favicon.ico", "apple-touch-icon.png"]) {
    const built = await readFile(new URL("brand/" + name, root));
    const source = await readFile(new URL("../apps/web/public/brand/" + name, import.meta.url));
    if (!built.equals(source)) findings.push({ rule: "brand-asset-mismatch", file: name });
  }
  if (!count) findings.push({ rule: "missing-build" });
} catch {
  findings.push({ rule: "unreadable-build" });
}
console.log(JSON.stringify({ scanned: count, findings }, null, 2));
if (findings.length) process.exitCode = 1;
