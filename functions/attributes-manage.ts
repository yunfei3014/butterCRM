// --- auth guard: a verified end-user JWT is required for every request ---
// Butterbase does NOT reject unauthenticated callers at the edge, so each
// function must enforce auth itself. ctx.user is only populated for a
// platform-verified JWT — never trust a self-decoded token.
// ALLOWED_AUTH_DOMAINS: optionally restrict to specific email domains.
// Leave empty to allow any authenticated user.
const ALLOWED_AUTH_DOMAINS: string[] = [];
function authGuard(ctx: any): Response | null {
  const u = ctx && ctx.user;
  if (!u || !u.id) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  if (ALLOWED_AUTH_DOMAINS.length) {
    const domain = String(u.email || "").toLowerCase().split("@")[1] || "";
    if (!ALLOWED_AUTH_DOMAINS.includes(domain)) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
  }
  return null;
}

// Manage attributes per object.
// GET ?object=people: list attrs
// POST: { action: "create"|"update"|"delete", object_slug?, id?, slug, name, type, config, position, is_required, is_unique, options? }
export async function handler(req: Request, ctx: any): Promise<Response> {
  const _ag = authGuard(ctx); if (_ag) return _ag;
  const url = new URL(req.url);

  if (req.method === "GET") {
    const slug = url.searchParams.get("object");
    if (!slug) return new Response(JSON.stringify({ error: "object query param required" }), { status: 400 });
    const o = await ctx.db.query("SELECT id FROM pantry_objects WHERE slug = $1", [slug]);
    if (!o.rows.length) return new Response(JSON.stringify({ error: "object not found" }), { status: 404 });
    const attrs = await ctx.db.query(
      "SELECT * FROM pantry_attributes WHERE object_id = $1 ORDER BY position ASC, name ASC",
      [o.rows[0].id]
    );
    const opts = await ctx.db.query(
      `SELECT so.* FROM pantry_select_options so
       JOIN pantry_attributes a ON a.id = so.attribute_id
       WHERE a.object_id = $1 ORDER BY so.position ASC`,
      [o.rows[0].id]
    );
    const optsByAttr: Record<string, any[]> = {};
    for (const op of opts.rows) {
      if (!optsByAttr[op.attribute_id]) optsByAttr[op.attribute_id] = [];
      optsByAttr[op.attribute_id].push(op);
    }
    return new Response(JSON.stringify({
      attributes: attrs.rows.map((a: any) => ({ ...a, options: optsByAttr[a.id] || [] }))
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.json();
  const { action = "create" } = body;

  if (action === "delete") {
    if (!body.id) return new Response(JSON.stringify({ error: "id required" }), { status: 400 });
    const a = await ctx.db.query("SELECT is_system FROM pantry_attributes WHERE id = $1", [body.id]);
    if (!a.rows.length) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    if (a.rows[0].is_system) return new Response(JSON.stringify({ error: "cannot delete system attribute" }), { status: 400 });
    await ctx.db.query("DELETE FROM pantry_attributes WHERE id = $1", [body.id]);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "update") {
    await ctx.db.query(
      `UPDATE pantry_attributes SET name = COALESCE($1, name), position = COALESCE($2, position),
       config = COALESCE($3::jsonb, config), is_required = COALESCE($4, is_required), is_unique = COALESCE($5, is_unique)
       WHERE id = $6`,
      [body.name, body.position, body.config ? JSON.stringify(body.config) : null, body.is_required, body.is_unique, body.id]
    );
    if (body.options && Array.isArray(body.options)) {
      await ctx.db.query("DELETE FROM pantry_select_options WHERE attribute_id = $1", [body.id]);
      for (let i = 0; i < body.options.length; i++) {
        const op = body.options[i];
        await ctx.db.query(
          "INSERT INTO pantry_select_options (attribute_id, value, label, color, position) VALUES ($1,$2,$3,$4,$5)",
          [body.id, op.value, op.label, op.color || null, i]
        );
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // create
  if (!body.object_slug || !body.slug || !body.name || !body.type) {
    return new Response(JSON.stringify({ error: "object_slug, slug, name, type required" }), { status: 400 });
  }
  const o = await ctx.db.query("SELECT id FROM pantry_objects WHERE slug = $1", [body.object_slug]);
  if (!o.rows.length) return new Response(JSON.stringify({ error: "object not found" }), { status: 404 });
  const posR = await ctx.db.query("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pantry_attributes WHERE object_id = $1", [o.rows[0].id]);
  const ins = await ctx.db.query(
    `INSERT INTO pantry_attributes (object_id, slug, name, type, config, position, is_required, is_unique)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [o.rows[0].id, body.slug, body.name, body.type, JSON.stringify(body.config || {}), posR.rows[0].p, !!body.is_required, !!body.is_unique]
  );
  const attrId = ins.rows[0].id;
  if (body.options && Array.isArray(body.options)) {
    for (let i = 0; i < body.options.length; i++) {
      const op = body.options[i];
      await ctx.db.query(
        "INSERT INTO pantry_select_options (attribute_id, value, label, color, position) VALUES ($1,$2,$3,$4,$5)",
        [attrId, op.value, op.label, op.color || null, i]
      );
    }
  }
  return new Response(JSON.stringify({ ok: true, id: attrId }), { headers: { "Content-Type": "application/json" } });
}
