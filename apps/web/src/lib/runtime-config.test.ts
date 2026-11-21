import { describe, expect, it, vi } from "vitest";
import {
  getApiProxyUrl,
  getWebSocketBaseUrl,
  proxyApiRequest,
} from "./runtime-config";

describe("runtime deployment configuration", () => {
  it("reads the WebSocket URL from runtime environment values", () => {
    expect(
      getWebSocketBaseUrl({ WS_PUBLIC_URL: "https://live.example.test/" }),
    ).toBe("https://live.example.test");
    expect(getWebSocketBaseUrl({}, "https://board.example.test")).toBe(
      "https://board.example.test",
    );
  });

  it("proxies the same API path and query to the runtime API origin", () => {
    expect(
      getApiProxyUrl(
        "https://board.example.test/api/boards?active=true",
        "http://api:4000/",
      ),
    ).toBe("http://api:4000/boards?active=true");
  });

  it("forwards cookies and preserves separate first-party Set-Cookie headers", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.headers).toBeInstanceOf(Headers);
      expect(new Headers(init?.headers).get("cookie")).toBe("session=value");
      const response = new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      Object.defineProperty(response.headers, "getSetCookie", {
        value: () => [
          "access_token=access; Path=/",
          "refresh_token=refresh; Path=/",
        ],
      });
      return response;
    });
    const request = new Request("https://board.example.test/api/auth/login", {
      method: "POST",
      headers: { cookie: "session=value", "content-type": "application/json" },
      body: "{}",
    });
    const response = await proxyApiRequest(request, fetcher, {
      API_ORIGIN: "http://api:4000",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://api:4000/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      "access_token=access; Path=/",
      "refresh_token=refresh; Path=/",
    ]);
  });

  it("fails closed when the API origin is missing", async () => {
    const response = await proxyApiRequest(
      new Request("https://board.example.test/api/health"),
      fetch,
      {},
    );
    expect(response.status).toBe(503);
  });
});
