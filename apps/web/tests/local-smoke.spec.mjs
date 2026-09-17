import { test, expect } from "@playwright/test";
test("real local browser → HTTP → restricted PostgreSQL: owner navigation/logout/tenant denial", async ({
  page,
  context,
}) => {
  const external = [];
  await context.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (!["localhost", "127.0.0.1"].includes(host)) {
      external.push(host);
      return route.abort();
    }
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(page.getByRole("img", { name: "AiVeron", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/kleo-console-login.png", fullPage: true });
  async function login(email) {
    await page.getByLabel("Электронная почта", { exact: true }).fill(email);
    await page
      .getByLabel("Пароль", { exact: true })
      .fill("TEST_ONLY_Local_Console_42");
    await page.getByRole("button", { name: "Войти" }).click();
  }
  await login("owner@example.test");
  await expect(
    page.getByRole("heading", { name: "Обзор платформы" }),
  ).toBeVisible();
  await expect(page.locator(".metrics").first()).toContainText("1");
  const cookie = (await context.cookies("http://localhost:3001")).find(
    (c) => c.name === "kleo_session",
  );
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  await expect(page.locator("body")).not.toContainText(cookie.value);
  for (const [path, title] of [
    ["organizations", "Организации"],
    ["users", "Пользователи"],
    ["projects", "Проекты"],
    ["workflows", "Процессы"],
    ["websites", "Сайты"],
    ["qa", "Контроль качества"],
    ["usage", "Использование ИИ"],
    ["finance", "Финансы"],
    ["audit", "Аудит"],
  ]) {
    await page.goto("/admin/" + path);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: `/tmp/kleo-console-${path}.png`, fullPage: true });
  }
  await page.goto("/admin/websites");
  await page.locator("tbody a").first().click();
  await expect(
    page.getByRole("heading", { name: "Версии сайтов" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.goto("/admin/workflows");
  await page.locator("tbody a").first().click();
  await expect(
    page.getByRole("heading", { name: "Этапы выполнения" }),
  ).toBeVisible();
  await expect(page.locator(".timeline")).toContainText("QA");
  await page.goto("/admin/settings");
  await expect(page.getByRole("region", { name: "Профиль", exact: true })).toContainText("owner@example.test");
  await page.screenshot({ path: "/tmp/kleo-console-settings.png", fullPage: true });
  await page.getByRole("link", { name: "Сотрудники", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Учёт сотрудников ещё не подключён" })).toBeVisible();
  await page.screenshot({ path: "/tmp/kleo-console-employees.png", fullPage: true });
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.screenshot({ path: "/tmp/kleo-console-settings-laptop.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/system");
  await expect(page.locator("main")).toContainText("Доступен");
  await page.screenshot({ path: "/tmp/kleo-console-system.png", fullPage: true });
  await page.goto("/admin");
  await expect(page.locator(".metrics").first()).toBeVisible();
  await page.screenshot({
    path: "/tmp/kleo-console-local-smoke.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    (await context.cookies("http://localhost:3001")).some(
      (c) => c.name === "kleo_session",
    ),
  ).toBe(false);
  await login("tenant@example.test");
  await expect(
    page.getByRole("heading", { name: "Доступ запрещён" }),
  ).toBeVisible();
  const denied = await page.evaluate(async () => {
    const r = await fetch("http://localhost:3001/api/v1/admin/projects", {
      credentials: "include",
    });
    return { status: r.status, body: await r.json() };
  });
  expect(denied.status).toBe(403);
  expect(denied.body.data).toBeUndefined();
  expect(external).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});
