export const API = "/api";

export class SessionExpiredError extends Error {}

async function refreshSession(fetcher: typeof fetch): Promise<boolean> {
  const response = await fetcher(`${API}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  return response.ok;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
  isRetry = false,
): Promise<T> {
  const headers: Record<string, string> =
    init?.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : (init?.headers as Record<string, string>) || {};
  if (init?.method !== "DELETE" || init?.body) {
    headers["content-type"] = "application/json";
  }
  const response = await fetcher(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (response.status === 401 && path !== "/auth/login") {
    if (isRetry) throw new SessionExpiredError("Session expired");
    if (await refreshSession(fetcher))
      return request<T>(path, init, fetcher, true);
    throw new SessionExpiredError("Session expired");
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok)
    throw new Error(
      ((await response.json()) as { error?: string }).error ?? "Request failed",
    );
  return response.json() as Promise<T>;
}
