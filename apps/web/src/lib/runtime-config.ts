export type RuntimeEnvironment = Record<string, string | undefined>;

const hopByHopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
];

export function getWebSocketBaseUrl(
  environment: RuntimeEnvironment = process.env,
  requestOrigin = "http://localhost:3000",
) {
  return (
    environment.WS_PUBLIC_URL ??
    environment.NEXT_PUBLIC_API_URL ??
    requestOrigin
  ).replace(/\/$/, "");
}

export function getApiProxyUrl(requestUrl: string, apiOrigin: string) {
  const request = new URL(requestUrl);
  const origin = new URL(apiOrigin);
  if (origin.protocol !== "http:" && origin.protocol !== "https:")
    throw new Error("API_ORIGIN must use HTTP or HTTPS");
  if (origin.username || origin.password)
    throw new Error("API_ORIGIN must not include credentials");
  const apiPath = request.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  return new URL(`${apiPath}${request.search}`, origin.origin).toString();
}

export async function proxyApiRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
  environment: RuntimeEnvironment = process.env,
) {
  const apiOrigin = environment.API_ORIGIN;
  if (!apiOrigin)
    return Response.json(
      { error: "API_ORIGIN is not configured" },
      { status: 503 },
    );

  let target: string;
  try {
    target = getApiProxyUrl(request.url, apiOrigin);
  } catch {
    return Response.json({ error: "API_ORIGIN is invalid" }, { status: 503 });
  }

  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetcher(target, {
    method: request.method,
    headers,
    ...(hasBody ? { body: await request.arrayBuffer() } : {}),
    redirect: "manual",
    signal: request.signal,
  });
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie")
      responseHeaders.append(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie())
    responseHeaders.append("set-cookie", cookie);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
