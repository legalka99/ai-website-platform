import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowFiles = ['.github/workflows/ci.yml', '.github/workflows/codeql.yml'];
const actionReference = /^\s*uses:\s+[^@\s]+@([0-9a-f]{40})(?:\s+#.*)?$/gim;

for (const file of workflowFiles) {
  test(`${file} pins every action to an immutable commit`, async () => {
    const source = await readFile(file, 'utf8');
    const references = [...source.matchAll(actionReference)];
    assert.ok(references.length > 0, 'workflow must declare at least one action');
    assert.equal(
      references.some(([, sha]) => sha.length !== 40),
      false,
      'workflow action references must use full commit SHAs',
    );
    assert.equal(source.includes('@v'), false, 'workflow must not use mutable version tags');
  });
}
