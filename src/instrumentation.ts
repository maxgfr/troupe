// Next.js runs register() once per server process, before the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { boot } = await import("./server/boot");
  await boot();
}
