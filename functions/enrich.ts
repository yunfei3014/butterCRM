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

// AI enrichment: fill missing fields on a record from public info.
// Body: { record_id, model? }
export async function handler(req: Request, ctx: any): Promise<Response> {
  const _ag = authGuard(ctx); if (_ag) return _ag;
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const { record_id, model = "anthropic/claude-3.5-sonnet" } = await req.json();
  if (!record_id) return new Response(JSON.stringify({ error: "record_id required" }), { status: 400 });

  const r = await ctx.db.query(
    `SELECT r.id, r.object_id, o.slug as object_slug, o.singular_noun
     FROM pantry_records r JOIN pantry_objects o ON o.id = r.object_id WHERE r.id = $1`,
    [record_id]
  );
  if (!r.rows.length) return new Response(JSON.stringify({ error: "record not found" }), { status: 404 });
  const rec = r.rows[0];

  const attrs = await ctx.db.query(
    `SELECT a.id, a.slug, a.name, a.type, a.config,
            (SELECT json_build_object('value_text', value_text, 'value_number', value_number)
             FROM pantry_record_values rv WHERE rv.record_id = $1 AND rv.attribute_id = a.id LIMIT 1) AS current
     FROM pantry_attributes a WHERE a.object_id = $2 ORDER BY a.position ASC`,
    [record_id, rec.object_id]
  );

  const current: any = {};
  const missing: any[] = [];
  for (const a of attrs.rows) {
    if (a.type === "record-reference") continue;
    if (a.current && (a.current.value_text || a.current.value_number != null)) {
      current[a.slug] = a.current.value_text || a.current.value_number;
    } else {
      missing.push({ slug: a.slug, name: a.name, type: a.type });
    }
  }
  if (!missing.length) return new Response(JSON.stringify({ ok: true, message: "All fields populated", values: current }), { headers: { "Content-Type": "application/json" } });

  const { BUTTERBASE_API_KEY, BUTTERBASE_API_URL, BUTTERBASE_APP_ID } = ctx.env;
  if (!BUTTERBASE_API_KEY) return new Response(JSON.stringify({ error: "BUTTERBASE_API_KEY env var not set" }), { status: 500 });

  const systemPrompt = `You are a CRM enrichment agent. Given partial info about a ${rec.singular_noun}, infer the missing fields from your general knowledge. Return ONLY a JSON object with the missing field slugs as keys and your best-guess value as the value. If you cannot infer a field, omit it. Be conservative.`;
  const userPrompt = `Object type: ${rec.singular_noun}\nKnown:\n${JSON.stringify(current, null, 2)}\n\nMissing fields:\n${missing.map((m: any) => `- ${m.slug} (${m.name}, type: ${m.type})`).join("\n")}\n\nReturn JSON only.`;

  const aiResp = await fetch(`${BUTTERBASE_API_URL}/v1/${BUTTERBASE_APP_ID}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${BUTTERBASE_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 800, temperature: 0.2 })
  });
  if (!aiResp.ok) return new Response(JSON.stringify({ error: "AI call failed", detail: await aiResp.text() }), { status: 502 });
  const aiJson = await aiResp.json();
  const content = aiJson.choices?.[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return new Response(JSON.stringify({ error: "no JSON in AI response", raw: content }), { status: 502 });

  let inferred;
  try { inferred = JSON.parse(jsonMatch[0]); }
  catch { return new Response(JSON.stringify({ error: "invalid JSON", raw: content }), { status: 502 }); }

  return new Response(JSON.stringify({ ok: true, inferred, missing_slugs: missing.map((m: any) => m.slug), record_id, model }), { headers: { "Content-Type": "application/json" } });
}
