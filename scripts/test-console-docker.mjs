// Browser fallback for hosts that disallow Chromium IPC. Never mounts the repository or .env.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, copyFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const exec = promisify(execFile),
  suffix = randomUUID(),
  network = "kleo-console-" + suffix,
  db = "kleo-console-db-" + suffix,
  web = "kleo-console-web-" + suffix;
const staging = await mkdtemp(join(tmpdir(), "kleo-console-source-")),
  password = randomBytes(32).toString("hex");
const environment = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  PGPASSWORD: password,
};
const systemBrowser = process.env.KLEO_TEST_SYSTEM_BROWSER === "1";
let createdNetwork = false,
  createdDB = false;
try {
  const { stdout } = await exec("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  for (const file of new Set(stdout.split("\0").filter(Boolean))) {
    if (
      file
        .split("/")
        .some(
          (p) =>
            p === ".." ||
            p === ".env" ||
            (p.startsWith(".env.") && p !== ".env.example"),
        )
    )
      continue;
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const target = join(staging, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file, target);
  }
  await exec("docker", ["network", "create", network]);
  createdNetwork = true;
  await exec(
    "docker",
    [
      "run",
      "-d",
      "--name",
      db,
      "--network",
      network,
      "--network-alias",
      "db",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_DB=kleo_test",
      "postgres:17",
    ],
    { env: environment },
  );
  createdDB = true;
  const child = spawn(
    "docker",
    [
      "run",
      "--name",
      web,
      "--network",
      network,
      "--shm-size=1g",
      "--mount",
      `type=bind,source=${staging},target=/source,readonly`,
      "--workdir",
      "/work",
      "--env",
      "PGPASSWORD",
      "--env",
      `KLEO_TEST_SYSTEM_BROWSER=${systemBrowser ? "1" : "0"}`,
      "--env",
      "PGHOST=db",
      "--env",
      "PGPORT=5432",
      "--env",
      "PGDATABASE=kleo_test",
      "--env",
      "PGUSER=postgres",
      "--env",
      "PGSSLMODE=disable",
      "--env",
      "KLEO_ISOLATED_DB_TEST=1",
      systemBrowser
        ? "kleo-console-browser:local"
        : "mcr.microsoft.com/playwright:v1.63.0-noble",
      "bash",
      "-c",
      "cp -R /source/. /work/ && node scripts/test-console-container.mjs",
    ],
    { env: environment, stdio: "inherit" },
  );
  process.exitCode = await new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
  for (const name of [
    "kleo-console-dashboard.png",
    "kleo-console-login.png",
    ...["organizations", "users", "projects", "workflows", "websites", "qa", "usage", "finance", "audit", "system"].map(name => `kleo-console-${name}.png`),
    "kleo-console-local-smoke.png",
  ])
    await exec("docker", [
      "cp",
      `${web}:/tmp/${name}`,
      join(tmpdir(), name),
    ]).catch(() => {});
} catch {
  console.error(
    "Isolated Docker console tests failed; upstream details omitted.",
  );
  process.exitCode = 1;
} finally {
  await exec("docker", ["rm", "-f", "-v", web]).catch(() => {});
  if (createdDB) await exec("docker", ["rm", "-f", "-v", db]).catch(() => {});
  if (createdNetwork)
    await exec("docker", ["network", "rm", network]).catch(() => {});
  await rm(staging, { recursive: true, force: true });
}
