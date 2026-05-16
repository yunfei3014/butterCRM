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

// Combined notes + tasks. Routed by ?type=notes|tasks
// GET ?type=notes&record_id=... -> list. POST -> create/update/delete.
export async function handler(req: Request, ctx: any): Promise<Response> {
  const _ag = authGuard(ctx); if (_ag) return _ag;
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "notes";
  const table = type === "tasks" ? "pantry_tasks" : "pantry_notes";

  if (req.method === "GET") {
    const recordId = url.searchParams.get("record_id");
    const assignee = url.searchParams.get("assignee_id");
    const openOnly = url.searchParams.get("open") === "true";
    const params: any[] = [];
    let where = "1=1";
    if (recordId) { params.push(recordId); where += ` AND parent_record_id = $${params.length}`; }
    if (type === "tasks" && assignee) { params.push(assignee); where += ` AND assignee_id = $${params.length}`; }
    if (type === "tasks" && openOnly) where += " AND completed_at IS NULL";
    const order = type === "tasks" ? "completed_at NULLS FIRST, due_at ASC NULLS LAST, created_at DESC" : "created_at DESC";
    const r = await ctx.db.query(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT 200`, params);
    return new Response(JSON.stringify({ items: r.rows }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.json();
  const { action = "create" } = body;
  const userId = ctx.user?.id || null;

  if (action === "delete") {
    await ctx.db.query(`DELETE FROM ${table} WHERE id = $1`, [body.id]);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  if (action === "update") {
    if (type === "tasks") {
      await ctx.db.query(
        `UPDATE pantry_tasks SET title = COALESCE($1, title), body_md = COALESCE($2, body_md),
         due_at = COALESCE($3::timestamptz, due_at), completed_at = $4, assignee_id = COALESCE($5, assignee_id),
         updated_at = now() WHERE id = $6`,
        [body.title, body.body_md, body.due_at || null, body.completed === true ? new Date().toISOString() : (body.completed === false ? null : body.completed_at), body.assignee_id, body.id]
      );
    } else {
      await ctx.db.query(
        `UPDATE pantry_notes SET title = COALESCE($1, title), body_md = COALESCE($2, body_md), updated_at = now() WHERE id = $3`,
        [body.title, body.body_md, body.id]
      );
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // create
  const { parent_record_id, parent_object_id, title = "", body_md = "", due_at, assignee_id } = body;
  let ins;
  if (type === "tasks") {
    if (!title) return new Response(JSON.stringify({ error: "title required" }), { status: 400 });
    ins = await ctx.db.query(
      "INSERT INTO pantry_tasks (parent_object_id, parent_record_id, title, body_md, due_at, assignee_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [parent_object_id, parent_record_id, title, body_md, due_at || null, assignee_id || null, userId]
    );
  } else {
    ins = await ctx.db.query(
      "INSERT INTO pantry_notes (parent_object_id, parent_record_id, title, body_md, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [parent_object_id, parent_record_id, title, body_md, userId]
    );
  }
  return new Response(JSON.stringify({ ok: true, id: ins.rows[0].id }), { headers: { "Content-Type": "application/json" } });
}
