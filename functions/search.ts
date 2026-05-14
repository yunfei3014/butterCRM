// Hybrid search: keyword (FTS-ish ILIKE) + semantic (vector). Body: { q, object_slug?, limit? }
export async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const { q = "", object_slug, limit = 30 } = await req.json();
  if (!q.trim()) return new Response(JSON.stringify({ records: [] }), { headers: { "Content-Type": "application/json" } });

  let objectFilter = "";
  const params: any[] = [`%${q}%`];
  if (object_slug) {
    const o = await ctx.db.query("SELECT id FROM pantry_objects WHERE slug = $1", [object_slug]);
    if (o.rows.length) {
      params.push(o.rows[0].id);
      objectFilter = ` AND r.object_id = $${params.length}`;
    }
  }

  // Keyword candidates
  const kw = await ctx.db.query(
    `SELECT r.id, r.object_id, r.search_text, r.updated_at FROM pantry_records r
     WHERE r.search_text ILIKE $1 ${objectFilter}
     ORDER BY r.updated_at DESC LIMIT 50`,
    params
  );

  // Semantic candidates (if AI gateway available)
  let semantic: any[] = [];
  try {
    const aiKey = ctx.env?.AI_GATEWAY_KEY || ctx.env?.OPENAI_API_KEY;
    const aiBase = ctx.env?.AI_BASE_URL || `${ctx.env?.API_BASE || ""}/ai`;
    if (aiKey) {
      const er = await fetch(`${aiBase}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${aiKey}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: q })
      });
      if (er.ok) {
        const ej = await er.json();
        const vec = ej.data?.[0]?.embedding;
        if (vec) {
          const vecStr = "[" + vec.join(",") + "]";
          const semParams: any[] = [vecStr];
          let semFilter = "";
          if (object_slug && params[1]) { semParams.push(params[1]); semFilter = ` AND object_id = $${semParams.length}`; }
          const sr = await ctx.db.query(
            `SELECT id, object_id, search_text, updated_at, embedding <=> $1::vector AS distance
             FROM pantry_records WHERE embedding IS NOT NULL ${semFilter}
             ORDER BY embedding <=> $1::vector LIMIT 30`,
            semParams
          );
          semantic = sr.rows;
        }
      }
    }
  } catch (e) {
    console.error("Embedding lookup failed", e);
  }

  // Merge by id
  const merged: Record<string, any> = {};
  for (const r of kw.rows) merged[r.id] = { ...r, score: 1.0, source: "keyword" };
  for (const r of semantic) {
    const sim = 1 - (r.distance || 0);
    if (merged[r.id]) merged[r.id].score = Math.max(merged[r.id].score, 0.5 + sim);
    else merged[r.id] = { ...r, score: sim, source: "semantic" };
  }
  const ids = Object.values(merged)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit)
    .map((r: any) => r.id);

  if (!ids.length) return new Response(JSON.stringify({ records: [] }), { headers: { "Content-Type": "application/json" } });

  const recs = await ctx.db.query(
    `SELECT r.id, r.object_id, r.search_text, r.updated_at, o.slug as object_slug, o.singular_noun, o.icon
     FROM pantry_records r JOIN pantry_objects o ON o.id = r.object_id
     WHERE r.id = ANY($1::uuid[])`,
    [ids]
  );
  const byId: Record<string, any> = {};
  for (const r of recs.rows) byId[r.id] = r;

  // Get name attribute values for display
  const names = await ctx.db.query(
    `SELECT rv.record_id, rv.value_text FROM pantry_record_values rv
     JOIN pantry_attributes a ON a.id = rv.attribute_id
     WHERE rv.record_id = ANY($1::uuid[]) AND a.slug = 'name'`,
    [ids]
  );
  for (const n of names.rows) if (byId[n.record_id]) byId[n.record_id].display_name = n.value_text;

  const results = ids.map(id => ({ ...byId[id], ...merged[id] })).filter(r => r.id);
  return new Response(JSON.stringify({ records: results, query: q }), { headers: { "Content-Type": "application/json" } });
}
