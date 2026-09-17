import { test, expect } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111",
  org = "22222222-2222-4222-8222-222222222222";
const user = {
  id,
  email: "owner@example.test",
  platformRole: "platform_owner",
};
const stamp = "2026-09-17T10:30:00.000Z";
const row = {
  id,
  name: "North Studio",
  email: "member@example.test",
  role: "user",
  status: "active",
  organization_id: org,
  project_id: id,
  website_id: id,
  workflow_run_id: id,
  created_at: stamp,
  updated_at: stamp,
  started_at: stamp,
  completed_at: stamp,
  recorded_at: stamp,
  passed: true,
  score: "94",
  issues: [],
  version_number: 1,
  provider: "openai",
  model: "test-model",
  agent_type: "qa",
  outcome: "success",
  input_tokens: null,
  output_tokens: "30",
  total_tokens: "30",
  cached_input_tokens: null,
  duration_ms: "85",
  actor_id: id,
  event_type: "platform_read",
  request_id: id,
  resource_type: "projects",
};
const dashboard = {
  counts: {
    organizations: "12",
    users: "38",
    projects: "24",
    workflows: "146",
  },
  workflows: [{ ...row, status: "completed" }],
  qa: [row],
  audit: [row],
};
async function mock(page, options = {}) {
  let authenticated = options.auth !== false;
  const requests = [];
  await page.route("http://localhost:3001/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    requests.push({ path: url.pathname, method: request.method() });
    const send = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://localhost:3000",
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "content-type,x-csrf-token",
          "access-control-allow-methods": "GET, POST",
        },
        body: JSON.stringify(body),
      });
    if (request.method() === "OPTIONS") return send({});
    if (url.pathname.endsWith("/auth/me"))
      return send(
        authenticated
          ? {
              user: {
                ...user,
                platformRole: options.role ?? user.platformRole,
              },
              csrfToken: "TEST_ONLY_CSRF",
            }
          : {},
        authenticated ? 200 : 401,
      );
    if (url.pathname.endsWith("/login")) {
      if (options.badLogin)
        return send({ error: { message: "PRIVATE_UNTRUSTED_MESSAGE" } }, 401);
      authenticated = true;
      return send({ csrfToken: "TEST_ONLY_CSRF" });
    }
    if (url.pathname.endsWith("/logout")) {
      expect(request.headers()["x-csrf-token"]).toBe("TEST_ONLY_CSRF");
      authenticated = false;
      return send({ success: true });
    }
    if (options.status && url.pathname.includes("/admin/"))
      return send(
        { error: { message: "PRIVATE_UNTRUSTED_MESSAGE" } },
        options.status,
      );
    if (options.delay)
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    if (url.pathname === "/health") return send({ status: "ok" });
    if (url.pathname.endsWith("/dashboard")) return send(dashboard);
    if (url.pathname.endsWith("/" + id))
      return send({
        item: row,
        executions: [{ id, agent_type: "business", status: "completed" }],
      });
    return send({
      data: options.empty
        ? []
        : options.pagination && url.searchParams.get("offset") !== "20"
          ? Array.from({ length: 20 }, (_, i) => ({
              ...row,
              id: `${i.toString().padStart(8, "0")}-1111-4111-8111-111111111111`,
              name: "Project " + i,
            }))
          : [{ ...row, ...options.row }],
      pagination: {
        limit: 20,
        offset: Number(url.searchParams.get("offset") ?? 0),
      },
    });
  });
  return requests;
}
test("login labels and browser validation prevent empty/short credentials", async ({
  page,
}) => {
  const requests = await mock(page, { auth: false });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Вход в Console" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Войти в Console" }).click();
  expect(requests.some((r) => r.path.endsWith("/login"))).toBe(false);
  await page.getByLabel("Email", { exact: true }).fill("test@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Войти в Console" }).click();
  expect(requests.some((r) => r.path.endsWith("/login"))).toBe(false);
});
test("login obtains session, redirects to shell; password/storage not persisted", async ({
  page,
}) => {
  await mock(page, { auth: false });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("TEST_ONLY_Long_Passphrase");
  await page.getByRole("button", { name: "Войти в Console" }).click();
  await expect(
    page.getByRole("heading", { name: "Обзор платформы" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});
test("wrong credentials display generic safe error and clear inputs", async ({
  page,
}) => {
  await mock(page, { auth: false, badLogin: true });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("TEST_ONLY_Long_Passphrase");
  await page.getByRole("button", { name: "Войти в Console" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Проверьте email и пароль",
  );
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(
    "PRIVATE_UNTRUSTED_MESSAGE",
  );
});
for (const role of ["platform_owner", "platform_admin"])
  test(`${role} sees authenticated admin shell`, async ({ page }) => {
    await mock(page, { role });
    await page.goto("/admin");
    await expect(
      page.getByRole("navigation", { name: "Основная навигация" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Обзор платформы" }),
    ).toBeVisible();
  });
test("normal tenant user denied before any admin data requests", async ({
  page,
}) => {
  const requests = await mock(page, { role: "user" });
  await page.goto("/admin/projects");
  await expect(
    page.getByRole("heading", { name: "Доступ запрещён" }),
  ).toBeVisible();
  expect(requests.some((r) => r.path.includes("/admin/"))).toBe(false);
});
test("logout uses CSRF, clears UI and returns to login", async ({ page }) => {
  await mock(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("navigation", { name: "Основная навигация" }),
  ).toHaveCount(0);
});
test("401 clears console session without retry loop", async ({ page }) => {
  const requests = await mock(page, { status: 401 });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  expect(requests.filter((r) => r.path.endsWith("/dashboard")).length).toBe(1);
});
for (const [status, label] of [
  [403, "Доступ запрещён"],
  [429, "Слишком много запросов"],
  [503, "Не удалось загрузить данные"],
])
  test(`safe ${status} handling without raw error/retry`, async ({ page }) => {
    const requests = await mock(page, { status });
    await page.goto("/admin");
    await expect(page.getByRole("alert")).toContainText(label);
    await expect(page.locator("body")).not.toContainText(
      "PRIVATE_UNTRUSTED_MESSAGE",
    );
    expect(requests.filter((r) => r.path.endsWith("/dashboard")).length).toBe(
      1,
    );
  });
test("dashboard loading then real supplied counts and recent records", async ({
  page,
}) => {
  await mock(page, { delay: 600 });
  await page.goto("/admin");
  await expect(page.getByRole("status")).toContainText("Загрузка");
  await expect(page.locator(".metrics")).toContainText("146");
  await expect(
    page.getByRole("heading", { name: "Последние проверки QA" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/kleo-console-dashboard.png",
    fullPage: true,
  });
});
for (const [path, title] of [
  ["organizations", "Организации"],
  ["users", "Пользователи"],
  ["projects", "Проекты"],
  ["workflows", "Workflows"],
  ["websites", "Websites"],
  ["versions", "Версии сайтов"],
  ["qa", "Контроль качества"],
  ["usage", "AI Usage"],
  ["audit", "Audit"],
])
  test(`${path} table renders bounded records`, async ({ page }) => {
    await mock(page);
    await page.goto("/admin/" + path);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Назад", exact: true }),
    ).toBeDisabled();
  });
test("pagination persists offset in URL and uses bounded next page", async ({
  page,
}) => {
  await mock(page, { pagination: true });
  await page.goto("/admin/projects");
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/offset=20/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page).toHaveURL(/offset=0/);
});
test("empty state is explicit", async ({ page }) => {
  await mock(page, { empty: true });
  await page.goto("/admin/organizations");
  await expect(
    page.getByRole("heading", { name: "Пока нет записей" }),
  ).toBeVisible();
});
test("persisted HTML is text, never executable", async ({ page }) => {
  let dialogs = 0;
  page.on("dialog", async (d) => {
    dialogs++;
    await d.dismiss();
  });
  await mock(page, {
    row: { name: "<script>alert(1)</script><img src=x onerror=alert(2)>" },
  });
  await page.goto("/admin/organizations");
  await expect(page.locator("tbody")).toContainText(
    "<script>alert(1)</script>",
  );
  expect(await page.locator("tbody script, tbody img").count()).toBe(0);
  expect(dialogs).toBe(0);
});
test("extra secret fields are never generically rendered by tables", async ({
  page,
}) => {
  await mock(page, {
    row: {
      passwordHash: "PRIVATE_HASH",
      sessionTokenHash: "PRIVATE_SESSION",
      document: { secret: "PRIVATE_DOCUMENT" },
      authorization: "PRIVATE_AUTH",
    },
  });
  await page.goto("/admin/users");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  for (const value of [
    "PRIVATE_HASH",
    "PRIVATE_SESSION",
    "PRIVATE_DOCUMENT",
    "PRIVATE_AUTH",
    "TEST_ONLY_CSRF",
  ])
    await expect(page.locator("body")).not.toContainText(value);
});
test("usage null is unavailable; cost is planned", async ({ page }) => {
  await mock(page);
  await page.goto("/admin/usage");
  await expect(page.locator("tbody")).toContainText("Недоступно");
  await expect(page.locator("main")).toContainText("Стоимость: planned");
});
test("QA text, severity counts and recommendation can be inspected", async ({
  page,
}) => {
  await mock(page, {
    row: {
      passed: false,
      issues: [
        {
          code: "BUSINESS_ALIGNMENT",
          severity: "error",
          message: "Review positioning.",
          recommendation: "Review audience.",
        },
      ],
    },
  });
  await page.goto("/admin/qa");
  await page.locator("summary").click();
  await expect(page.locator("tbody")).toContainText("FAIL");
  await expect(page.locator(".qa-issues")).toContainText("error: 1");
  await expect(page.locator(".qa-issues")).toContainText("Review audience.");
});
test("project detail links preserve explicit project scope", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/admin/projects/" + id);
  await expect(
    page
      .getByRole("navigation", { name: "Связанные данные" })
      .getByRole("link", { name: "AI Usage →" }),
  ).toHaveAttribute("href", "/admin/usage?projectId=" + id);
});
test("workflow detail shows only persisted execution timeline", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/admin/workflows/" + id);
  await expect(page.locator(".timeline")).toContainText("business");
  await expect(page.locator(".timeline li")).toHaveCount(1);
});
test("system liveness does not pretend DB readiness", async ({ page }) => {
  await mock(page);
  await page.goto("/admin/system");
  await expect(page.locator("main")).toContainText("Online");
  await expect(page.locator("main")).toContainText(
    "Отдельная проверка не предоставлена",
  );
});
test("tablet layout and keyboard navigation remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await mock(page);
  await page.goto("/admin");
  await expect(page.locator(".metrics")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Проекты", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/projects$/);
});

test("version links to exact source workflow QA and report shows version association", async ({
  page,
}) => {
  await mock(page, { row: { website_version_id: id } });
  await page.goto("/admin/versions");
  await expect(
    page.getByRole("link", { name: "QA этой версии →" }),
  ).toHaveAttribute("href", "/admin/qa?workflowId=" + id);
  await page.getByRole("link", { name: "QA этой версии →" }).click();
  await page.locator("summary").click();
  await expect(page.locator(".qa-issues")).toContainText("Версия: " + id);
});


test("official branding and favicon assets load on dark login", async ({ page }) => {
  await mock(page, { auth: false });
  await page.goto("/login");
  const logo = page.getByRole("img", { name: "AiVeron", exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", "/brand/aiveron-logo.svg");
  expect(await logo.evaluate(img => img.complete && img.naturalWidth === 576)).toBe(true);
  await expect(page).toHaveTitle("AiVeron Console");
  expect(await page.locator("html").evaluate(el => getComputedStyle(el).colorScheme)).toBe("dark");
  expect(await page.locator('meta[name="theme-color"]').getAttribute("content")).toBe(
    await page.locator("html").evaluate(el => getComputedStyle(el).getPropertyValue("--canvas").trim())
  );
  for (const path of ["aiveron-logo.svg", "aiveron-symbol.svg", "favicon.svg", "favicon.ico", "apple-touch-icon.png"]) {
    const r = await page.request.get("/brand/" + path);
    expect(r.ok()).toBe(true);
    expect(r.headers()["content-type"]).toMatch(/image/);
    expect((await r.body()).length).toBeGreaterThan(100);
  }
  await page.getByLabel("Email", { exact: true }).focus();
  expect(await page.getByLabel("Email", { exact: true }).evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
});

test("shell reuses official logo without clipping at laptop and narrow widths", async ({ page }) => {
  await mock(page);
  await page.goto("/admin");
  await expect(page.locator(".metrics")).toBeVisible();
  for (const width of [1440, 1024, 768, 500]) {
    await page.setViewportSize({ width, height: 900 });
    const logo = page.locator(".sidebar .brand-logo");
    await expect(logo).toHaveAttribute("src", "/brand/aiveron-logo.svg");
    expect(await logo.evaluate(el => {
      const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
      return r.width > 0 && r.left >= p.left && r.right <= p.right + 1 && Math.abs(r.width / r.height - 576 / 212) < .01;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
  }
});

test("dark tokens keep normal text and status labels above WCAG AA contrast", async ({ page }) => {
  await mock(page);
  await page.goto("/admin");
  const contrasts = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const luminance = token => {
      const hex = css.getPropertyValue(token).trim().slice(1);
      const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
      return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
    };
    const pairs = ["--canvas", "--sidebar", "--surface", "--surface-raised", "--surface-hover", "--soft"].flatMap(bg => ["--ink", "--muted", "--subtle", "--accent"].map(fg => [fg, bg]));
    for (const status of ["success", "warning", "danger", "info"]) pairs.push([`--${status}-ink`, `--${status}-bg`]);
    pairs.push(["--button-ink", "--button-bg"]);
    return pairs.map(([fg, bg]) => { const a = luminance(fg), b = luminance(bg); return { fg, bg, ratio: (Math.max(a,b) + .05)/(Math.min(a,b) + .05) }; });
  });
  for (const pair of contrasts) expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
});
