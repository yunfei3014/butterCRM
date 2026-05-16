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

// GET: list all objects + counts. POST: create a new custom object.
// PATCH (via body action): update; DELETE (via body action): delete (non-system only).
export async function handler(req: Request, ctx: any): Promise<Response> {
  const _ag = authGuard(ctx); if (_ag) return _ag;
  if (req.method === "GET") {
    const objs = await ctx.db.query(
      `SELECT o.id, o.slug, o.singular_noun, o.plural_noun, o.icon, o.is_system,
              (SELECT COUNT(*)::int FROM pantry_records r WHERE r.object_id = o.id) as record_count
       FROM pantry_objects o ORDER BY o.is_system DESC, o.slug ASC`
    );
    return new Response(JSON.stringify({ objects: objs.rows }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { action = "create", slug, singular_noun, plural_noun, icon, id } = body;

    if (action === "delete" && id) {
      const o = await ctx.db.query("SELECT is_system FROM pantry_objects WHERE id = $1", [id]);
      if (!o.rows.length) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      if (o.rows[0].is_system) return new Response(JSON.stringify({ error: "cannot delete system object" }), { status: 400 });
      await ctx.db.query("DELETE FROM pantry_objects WHERE id = $1", [id]);
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    if (action === "update" && id) {
      await ctx.db.query(
        "UPDATE pantry_objects SET singular_noun = COALESCE($1, singular_noun), plural_noun = COALESCE($2, plural_noun), icon = COALESCE($3, icon), updated_at = now() WHERE id = $4",
        [singular_noun, plural_noun, icon, id]
      );
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    // create
    if (!slug || !singular_noun || !plural_noun) {
      return new Response(JSON.stringify({ error: "slug, singular_noun, plural_noun required" }), { status: 400 });
    }
    const ins = await ctx.db.query(
      "INSERT INTO pantry_objects (slug, singular_noun, plural_noun, icon, is_system) VALUES ($1,$2,$3,$4,false) RETURNING id",
      [slug, singular_noun, plural_noun, icon || "tag"]
    );
    const objectId = ins.rows[0].id;
    // Default name attr
    await ctx.db.query(
      "INSERT INTO pantry_attributes (object_id, slug, name, type, position, is_system, is_required) VALUES ($1,'name','Name','text',0,true,true)",
      [objectId]
    );
    return new Response(JSON.stringify({ ok: true, id: objectId }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response("Method not allowed", { status: 405 });
}
