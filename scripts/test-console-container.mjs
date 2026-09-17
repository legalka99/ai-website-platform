import { spawn } from "node:child_process";
if (
  process.env.KLEO_ISOLATED_DB_TEST !== "1" ||
  process.env.PGHOST !== "db" ||
  process.env.PGDATABASE !== "kleo_test"
)
  throw Error("Isolated container required");
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const c = spawn(command, args, { stdio: "inherit" });
    c.on("error", reject);
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Test command failed")),
    );
  });
try {
  await run("npm", ["ci"]);
  await run("npm", ["run", "typecheck"]);
  await run("npm", ["run", "test:web"]);
  await run("npx", ["tsc", "--noEmit", "false", "--outDir", ".test-build"]);
  const { Pool } = await import("pg"),
    { migratePool } = await import("./persistence-db.mjs");
  const pool = new Pool({ connectionTimeoutMillis: 5000 });
  try {
    await migratePool(pool);
  } finally {
    await pool.end();
  }
  await run(process.execPath, ["scripts/smoke-admin-local.mjs"]);
  await run("npm", ["run", "web:build"]);
  await run(process.execPath, ["scripts/check-web-build.mjs"]);
} catch {
  console.error("Console container checks did not complete successfully.");
  process.exitCode = 1;
}
