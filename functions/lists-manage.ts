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

// GET ?object=people: list all lists for object. POST: create/update/delete list, add/remove entries.
export async function handler(req: Request, ctx: any): Promise<Response> {
  const _ag = authGuard(ctx); if (_ag) return _ag;
  const url = new URL(req.url);

  if (req.method === "GET") {
    const slug = url.searchParams.get("object");
    let where = "1=1";
    const params: any[] = [];
    if (slug) {
      const o = await ctx.db.query("SELECT id FROM pantry_objects WHERE slug = $1", [slug]);
      if (!o.rows.length) return new Response(JSON.stringify({ lists: [] }), { headers: { "Content-Type": "application/json" } });
      params.push(o.rows[0].id);
      where = "parent_object_id = $1";
    }
    const lists = await ctx.db.query(
      `SELECT l.id, l.slug, l.name, l.icon, l.parent_object_id, l.view_config, l.created_at,
              (SELECT COUNT(*)::int FROM pantry_list_entries WHERE list_id = l.id) as entry_count,
              (SELECT slug FROM pantry_objects WHERE id = l.parent_object_id) as object_slug
       FROM pantry_lists l WHERE ${where} ORDER BY l.created_at DESC`,
      params
    );
    return new Response(JSON.stringify({ lists: lists.rows }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.json();
  const { action = "create" } = body;

  if (action === "add_entries") {
    const { list_id, record_ids = [] } = body;
    if (!list_id) return new Response(JSON.stringify({ error: "list_id required" }), { status: 400 });
    for (const rid of record_ids) {
      await ctx.db.query("INSERT INTO pantry_list_entries (list_id, record_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [list_id, rid]);
    }
    return new Response(JSON.stringify({ ok: true, added: record_ids.length }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "remove_entry") {
    const { list_id, record_id } = body;
    await ctx.db.query("DELETE FROM pantry_list_entries WHERE list_id = $1 AND record_id = $2", [list_id, record_id]);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "delete") {
    await ctx.db.query("DELETE FROM pantry_lists WHERE id = $1", [body.id]);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "update") {
    await ctx.db.query(
      "UPDATE pantry_lists SET name = COALESCE($1, name), icon = COALESCE($2, icon), view_config = COALESCE($3::jsonb, view_config), updated_at = now() WHERE id = $4",
      [body.name, body.icon, body.view_config ? JSON.stringify(body.view_config) : null, body.id]
    );
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // create
  if (!body.object_slug || !body.name) return new Response(JSON.stringify({ error: "object_slug, name required" }), { status: 400 });
  const o = await ctx.db.query("SELECT id FROM pantry_objects WHERE slug = $1", [body.object_slug]);
  if (!o.rows.length) return new Response(JSON.stringify({ error: "object not found" }), { status: 404 });
  const slug = body.slug || (body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(36).slice(2, 7));
  const userId = ctx.user?.id || null;
  const ins = await ctx.db.query(
    "INSERT INTO pantry_lists (parent_object_id, slug, name, icon, view_config, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [o.rows[0].id, slug, body.name, body.icon || null, JSON.stringify(body.view_config || {}), userId]
  );
  return new Response(JSON.stringify({ ok: true, id: ins.rows[0].id, slug }), { headers: { "Content-Type": "application/json" } });
}
