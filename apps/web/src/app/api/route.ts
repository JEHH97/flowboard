import { proxyApiRequest } from "../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = (request: Request) => proxyApiRequest(request);

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
