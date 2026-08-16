import { lookupSecurity, SecurityLookupError } from "../lib/security-lookup.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  try {
    const security = await lookupSecurity(url.searchParams.get("market"), url.searchParams.get("code"));
    return Response.json({ security }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SecurityLookupError ? error.status : 500;
    return Response.json(
      { error: error.message || "股票识别失败" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
