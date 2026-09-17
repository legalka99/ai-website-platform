import type { SessionView } from "../../../packages/core/src/admin-api.js";
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? "Сессия завершена. Войдите снова."
        : status === 403
          ? "Доступ запрещён."
          : status === 429
            ? "Слишком много запросов. Повторите позже."
            : status === 404
              ? "Запись не найдена."
              : "Не удалось загрузить данные. Попробуйте ещё раз.",
    );
  }
}
/** Only HTTP; CSRF lives in memory. No storage, payload logging or automatic retries. */
export class ApiClient {
  private csrf = "";
  onUnauthorized: () => void = () => {};
  constructor(
    private base = import.meta.env.DEV ? "http://localhost:3001" : "",
  ) {}
  clear() {
    this.csrf = "";
  }
  async request<T>(
    path: string,
    signal?: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    if (!path.startsWith("/api/v1/") && path !== "/health")
      throw new ApiError(400);
    const response = await fetch(this.base + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal,
      headers:
        body === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              ...(this.csrf ? { "X-CSRF-Token": this.csrf } : {}),
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      if (response.status === 401 && !path.endsWith("/login")) {
        this.clear();
        this.onUnauthorized();
      }
      throw new ApiError(response.status);
    }
    return response.json() as Promise<T>;
  }
  async me(signal?: AbortSignal) {
    const view = await this.request<SessionView>("/api/v1/auth/me", signal);
    this.csrf = view.csrfToken;
    return view.user;
  }
  async login(email: string, password: string) {
    await this.request("/api/v1/auth/login", undefined, { email, password });
    return this.me();
  }
  async logout() {
    await this.request("/api/v1/auth/logout", undefined, {});
    this.clear();
  }
}
export const api = new ApiClient();
