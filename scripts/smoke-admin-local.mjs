// Only invoked by the disposable Docker runner; never seeds a default database.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { createApi } from "../.test-build/apps/api/src/server.js";
import { AuthRepository } from "../.test-build/packages/persistence/src/auth.js";
import { PostgresPersistence } from "../.test-build/packages/persistence/src/postgres.js";
import { hashPassword } from "../.test-build/packages/security/src/password.js";
import { qaInput } from "../tests/fixtures/qa.mjs";
if (
  process.env.KLEO_ISOLATED_DB_TEST !== "1" ||
  !["127.0.0.1", "db"].includes(process.env.PGHOST) ||
  process.env.PGDATABASE !== "kleo_test"
)
  throw Error("Isolated runner required");
const pool = new Pool({ max: 3 });
let runtime, api;
try {
  const repo = new PostgresPersistence(pool),
    operator = await AuthRepository.create(pool),
    password = "TEST_ONLY_Local_Console_42";
  await pool.query(
    await readFile(
      new URL("../packages/persistence/sql/api-grants.sql", import.meta.url),
      "utf8",
    ),
  );
  await operator.bootstrapOwner("owner@example.test", password);
  const { userId, organizationId } = await repo.provisionOrganization(
    "North Studio — isolated test",
  );
  const projectId = await repo.createProject(
    userId,
    organizationId,
    "Studio website",
  );
  await pool.query(
    "INSERT INTO kleo.auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)",
    [userId, "tenant@example.test", await hashPassword(password)],
  );
  const scope = { actorId: userId, organizationId, projectId },
    input = qaInput();
  input.website.projectId = projectId;
  const run = await repo.startRun(scope);
  await repo.finishRun(scope, run.id, {
    success: true,
    state: {
      ...input.reviewContext,
      developer: { website: input.website, generatedAt: input.generatedAt },
      qa: {
        passed: true,
        score: 92,
        issues: [],
        checkedAt: new Date().toISOString(),
      },
    },
    executions: {
      qa: {
        projectId,
        usage: {
          provider: "openai",
          model: "test-fixture",
          workflowId: run.id,
          totalTokens: 42,
          durationMs: 85,
        },
      },
    },
  });
  runtime = new Pool({ max: 2, options: "-c role=kleo_api" });
  api = await createApi(await AuthRepository.create(runtime, 3600), {
    production: false,
    apiOrigin: "http://localhost:3001",
    origins: ["http://localhost:3000"],
    sessionSeconds: 3600,
    loginLimit: 10,
  });
  await api.listen({ host: "127.0.0.1", port: 3001 });
  const inspect = process.env.KLEO_CONSOLE_INSPECT === "1";
  const child = spawn("npm", ["run", inspect ? "web:dev" : "test:web"], {
    stdio: "inherit",
    env: { ...process.env, KLEO_CONSOLE_LIVE: "1" },
  });
  if (inspect)
    console.log(
      "Isolated Console inspection: http://localhost:3000/login (test fixtures only).",
    );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => child.kill("SIGTERM"));
  process.exitCode = await new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
} catch {
  console.error("Isolated console smoke failed; sensitive details omitted.");
  process.exitCode = 1;
} finally {
  await api?.close();
  await runtime?.end();
  await pool.end();
}
