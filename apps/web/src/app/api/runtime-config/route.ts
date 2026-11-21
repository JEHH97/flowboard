import { getWebSocketBaseUrl } from "../../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return Response.json(
    {
      webSocketUrl: getWebSocketBaseUrl(
        process.env,
        new URL(request.url).origin,
      ),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
