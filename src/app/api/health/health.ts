// Liveness for Docker and uptime monitors: no authentication, no details.
export async function healthResponse(ping: () => Promise<unknown>): Promise<Response> {
  try {
    await ping();
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
