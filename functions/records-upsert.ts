// Create or update a record with attribute values.
// Body: { object: "people", record_id?, values: { name: "...", email: "...", company: {id: "..."} } }
export async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.json();
  const { object: objectSlug, record_id, values = {} } = body;
  if (!objectSlug) return new Response(JSON.stringify({ error: "object slug required" }), { status: 400 });

  const o = await ctx.db.query("SELECT id FROM pantry_objects WHERE slug = $1", [objectSlug]);
  if (!o.rows.length) return new Response(JSON.stringify({ error: "object not found" }), { status: 404 });
  const objectId = o.rows[0].id;

  const attrs = await ctx.db.query(
    "SELECT id, slug, type, config FROM pantry_attributes WHERE object_id = $1",
    [objectId]
  );
  const attrBySlug: Record<string, any> = {};
  for (const a of attrs.rows) attrBySlug[a.slug] = a;

  let recId = record_id;
  const userId = ctx.user?.id || null;
  if (!recId) {
    const ins = await ctx.db.query(
      "INSERT INTO pantry_records (object_id, created_by, embedding_stale) VALUES ($1, $2, true) RETURNING id",
      [objectId, userId]
    );
    recId = ins.rows[0].id;
  } else {
    await ctx.db.query("UPDATE pantry_records SET updated_at = now(), embedding_stale = true WHERE id = $1", [recId]);
  }

  const searchParts: string[] = [];
  for (const [slug, raw] of Object.entries(values)) {
    const a = attrBySlug[slug];
    if (!a) continue;

    if (a.type === "record-reference") {
      // raw can be {id, object_id} or array of those or just id string
      const refs = Array.isArray(raw) ? raw : raw ? [raw] : [];
      await ctx.db.query("DELETE FROM pantry_record_references WHERE from_record_id = $1 AND attribute_id = $2", [recId, a.id]);
      for (let i = 0; i < refs.length; i++) {
        const r = refs[i];
        const toId = typeof r === "string" ? r : r?.id;
        if (!toId) continue;
        await ctx.db.query(
          "INSERT INTO pantry_record_references (from_record_id, attribute_id, to_record_id, position) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [recId, a.id, toId, i]
        );
      }
      continue;
    }

    // Wipe existing values for this attr
    await ctx.db.query("DELETE FROM pantry_record_values WHERE record_id = $1 AND attribute_id = $2", [recId, a.id]);
    if (raw == null || raw === "") continue;

    let cols: any = { value_text: null, value_number: null, value_date: null, value_bool: null, value_json: null };
    if (a.type === "number" || a.type === "currency" || a.type === "rating") cols.value_number = Number(raw);
    else if (a.type === "date" || a.type === "timestamp") cols.value_date = new Date(raw).toISOString();
    else if (a.type === "checkbox") cols.value_bool = !!raw;
    else if (a.type === "personal-name" || a.type === "location" || a.type === "interaction" || (typeof raw === "object" && raw !== null)) {
      cols.value_json = raw;
      cols.value_text = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    } else {
      cols.value_text = String(raw);
    }

    await ctx.db.query(
      `INSERT INTO pantry_record_values (record_id, attribute_id, value_text, value_number, value_date, value_bool, value_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [recId, a.id, cols.value_text, cols.value_number, cols.value_date, cols.value_bool, cols.value_json]
    );

    if (cols.value_text) searchParts.push(`${a.name}: ${cols.value_text}`);
  }

  if (searchParts.length) {
    await ctx.db.query("UPDATE pantry_records SET search_text = $1 WHERE id = $2", [searchParts.join("\n"), recId]);
  }

  return new Response(JSON.stringify({ ok: true, record_id: recId }), { headers: { "Content-Type": "application/json" } });
}
