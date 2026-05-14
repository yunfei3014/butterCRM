// Cron: regenerate embeddings for stale records.
export async function handler(req: Request, ctx: any): Promise<Response> {
  const aiKey = ctx.env?.AI_GATEWAY_KEY || ctx.env?.OPENAI_API_KEY;
  if (!aiKey) {
    return new Response(JSON.stringify({ ok: false, error: "AI_GATEWAY_KEY not set" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const aiBase = ctx.env?.AI_BASE_URL || `${ctx.env?.API_BASE || ""}/ai`;

  const stale = await ctx.db.query(
    "SELECT id, search_text FROM pantry_records WHERE embedding_stale = true AND char_length(search_text) > 0 LIMIT 50"
  );

  let updated = 0;
  for (const r of stale.rows) {
    try {
      const er = await fetch(`${aiBase}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${aiKey}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: r.search_text.slice(0, 6000) })
      });
      if (!er.ok) { console.error("embed failed", await er.text()); continue; }
      const ej = await er.json();
      const vec = ej.data?.[0]?.embedding;
      if (!vec) continue;
      await ctx.db.query(
        "UPDATE pantry_records SET embedding = $1::vector, embedding_stale = false WHERE id = $2",
        ["[" + vec.join(",") + "]", r.id]
      );
      updated++;
    } catch (e: any) {
      console.error("embed loop err", e.message);
    }
  }
  return new Response(JSON.stringify({ ok: true, updated }), { headers: { "Content-Type": "application/json" } });
}
