import { describe, expect, it, vi } from "vitest";
import { request, SessionExpiredError } from "./api-client";

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe("api-client request()", () => {
  it("returns parsed JSON on success", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(200, { ok: true }));
    await expect(request("/boards", undefined, fetcher)).resolves.toEqual({ ok: true });
  });

  it("returns undefined for a 204 response", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(204));
    await expect(request("/boards/1", { method: "DELETE" }, fetcher)).resolves.toBeUndefined();
  });

  it("throws the server's error message on a non-401 failure", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(400, { error: "Invalid board" }));
    await expect(request("/boards", undefined, fetcher)).rejects.toThrow("Invalid board");
  });

  it("refreshes once and retries after a 401, then succeeds", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200)) // POST /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await expect(request("/boards", undefined, fetcher)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/auth/refresh");
  });

  it("throws SessionExpiredError when refresh itself fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(401)); // POST /auth/refresh fails
    await expect(request("/boards", undefined, fetcher)).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("throws SessionExpiredError when the retried request is still 401", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200)) // refresh succeeds
      .mockResolvedValueOnce(jsonResponse(401)); // retry still fails
    await expect(request("/boards", undefined, fetcher)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not attempt a refresh for a failed /auth/login", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(401, { error: "Email or password is incorrect" }));
    await expect(
      request("/auth/login", { method: "POST" }, fetcher),
    ).rejects.toThrow("Email or password is incorrect");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
