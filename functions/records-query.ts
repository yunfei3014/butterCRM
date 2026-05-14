// Query records by object slug. Returns records with attribute values joined.
// Body: { object: "people", limit?, offset?, list_id?, filter?: { attr_slug: value }, sort?: { attr_slug, dir } }
export async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.json();
  const { object: objectSlug, limit = 50, offset = 0, list_id, filter = {}, sort } = body;

  if (!objectSlug && !list_id) {
    return new Response(JSON.stringify({ error: "object slug or list_id required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let objectId: string;
  if (list_id) {
    const l = await ctx.db.query("SELECT parent_object_id FROM pantry_lists WHERE id = $1", [list_id]);
    if (!l.rows.length) return new Response(JSON.stringify({ error: "list not found" }), { status: 404 });
    objectId = l.rows[0].parent_object_id;
  } else {
    const o = await ctx.db.query("SELECT id FROM pantry_objects WHERE slug = $1", [objectSlug]);
    if (!o.rows.length) return new Response(JSON.stringify({ error: "object not found" }), { status: 404 });
    objectId = o.rows[0].id;
  }

  const attrs = await ctx.db.query(
    "SELECT id, slug, name, type, config, position, is_system, is_required FROM pantry_attributes WHERE object_id = $1 ORDER BY position ASC, name ASC",
    [objectId]
  );
  const attrBySlug: Record<string, any> = {};
  const attrById: Record<string, any> = {};
  for (const a of attrs.rows) {
    attrBySlug[a.slug] = a;
    attrById[a.id] = a;
  }

  const filterAttrs = Object.entries(filter).filter(([k, v]) => attrBySlug[k] && v != null && v !== "");
  const params: any[] = [objectId];
  let where = "r.object_id = $1";

  if (list_id) {
    params.push(list_id);
    where += ` AND EXISTS (SELECT 1 FROM pantry_list_entries le WHERE le.record_id = r.id AND le.list_id = $${params.length})`;
  }

  for (const [k, v] of filterAttrs) {
    const a = attrBySlug[k];
    params.push(a.id, String(v));
    where += ` AND EXISTS (SELECT 1 FROM pantry_record_values rv WHERE rv.record_id = r.id AND rv.attribute_id = $${params.length - 1} AND rv.value_text ILIKE '%' || $${params.length} || '%')`;
  }

  let orderBy = "r.updated_at DESC";
  if (sort && sort.attr_slug && attrBySlug[sort.attr_slug]) {
    const a = attrBySlug[sort.attr_slug];
    const dir = sort.dir === "asc" ? "ASC" : "DESC";
    params.push(a.id);
    const col = a.type === "number" || a.type === "currency" || a.type === "rating" ? "value_number"
              : a.type === "date" || a.type === "timestamp" ? "value_date"
              : "value_text";
    orderBy = `(SELECT ${col} FROM pantry_record_values WHERE record_id = r.id AND attribute_id = $${params.length} LIMIT 1) ${dir} NULLS LAST`;
  }

  params.push(limit, offset);
  const limOffIdx = params.length;
  const recs = await ctx.db.query(
    `SELECT r.id, r.object_id, r.created_at, r.updated_at
     FROM pantry_records r
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT $${limOffIdx - 1} OFFSET $${limOffIdx}`,
    params
  );

  const recIds = recs.rows.map((r: any) => r.id);
  let values: any = { rows: [] };
  if (recIds.length) {
    values = await ctx.db.query(
      `SELECT record_id, attribute_id, value_text, value_number, value_date, value_bool, value_json, position
       FROM pantry_record_values WHERE record_id = ANY($1::uuid[])`,
      [recIds]
    );
  }

  const valuesByRec: Record<string, any[]> = {};
  for (const v of values.rows) {
    const a = attrById[v.attribute_id];
    if (!a) continue;
    let value: any = null;
    if (a.type === "number" || a.type === "currency" || a.type === "rating") value = v.value_number;
    else if (a.type === "date" || a.type === "timestamp") value = v.value_date;
    else if (a.type === "checkbox") value = v.value_bool;
    else if (a.type === "select" || a.type === "status" || a.type === "personal-name" || a.type === "location" || a.type === "interaction") value = v.value_json || v.value_text;
    else value = v.value_text;
    if (!valuesByRec[v.record_id]) valuesByRec[v.record_id] = [];
    valuesByRec[v.record_id].push({ slug: a.slug, value, attribute_id: v.attribute_id, position: v.position });
  }

  // Record references
  let refs: any = { rows: [] };
  if (recIds.length) {
    refs = await ctx.db.query(
      `SELECT rr.from_record_id, rr.attribute_id, rr.to_record_id,
              r2.object_id as to_object_id,
              (SELECT value_text FROM pantry_record_values rv
                JOIN pantry_attributes pa ON pa.id = rv.attribute_id
                WHERE rv.record_id = rr.to_record_id AND pa.slug = 'name' LIMIT 1) AS to_label
       FROM pantry_record_references rr
       JOIN pantry_records r2 ON r2.id = rr.to_record_id
       WHERE rr.from_record_id = ANY($1::uuid[])`,
      [recIds]
    );
  }
  for (const rr of refs.rows) {
    const a = attrById[rr.attribute_id];
    if (!a) continue;
    if (!valuesByRec[rr.from_record_id]) valuesByRec[rr.from_record_id] = [];
    valuesByRec[rr.from_record_id].push({
      slug: a.slug,
      value: { id: rr.to_record_id, object_id: rr.to_object_id, label: rr.to_label || rr.to_record_id },
      attribute_id: rr.attribute_id,
      is_reference: true
    });
  }

  const records = recs.rows.map((r: any) => {
    const valsArr = valuesByRec[r.id] || [];
    const valsObj: Record<string, any> = {};
    for (const v of valsArr) valsObj[v.slug] = v.value;
    return { id: r.id, object_id: r.object_id, created_at: r.created_at, updated_at: r.updated_at, values: valsObj };
  });

  // Total count
  const cnt = await ctx.db.query(`SELECT COUNT(*)::int AS n FROM pantry_records r WHERE ${where}`, params.slice(0, limOffIdx - 2));

  return new Response(JSON.stringify({
    records,
    attributes: attrs.rows,
    total: cnt.rows[0].n,
    limit, offset
  }), { headers: { "Content-Type": "application/json" } });
}
