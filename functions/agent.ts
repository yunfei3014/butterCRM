// AI agent: drafts emails, follow-ups, summaries from record context.
export async function handler(req: Request, ctx: any): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const { record_id, prompt, model = "anthropic/claude-3.5-sonnet" } = await req.json();
  if (!record_id || !prompt) return new Response(JSON.stringify({ error: "record_id and prompt required" }), { status: 400 });

  const r = await ctx.db.query(
    `SELECT r.id, o.slug as object_slug, o.singular_noun FROM pantry_records r JOIN pantry_objects o ON o.id = r.object_id WHERE r.id = $1`,
    [record_id]
  );
  if (!r.rows.length) return new Response(JSON.stringify({ error: "record not found" }), { status: 404 });
  const rec = r.rows[0];

  const vals = await ctx.db.query(
    `SELECT a.slug, rv.value_text, rv.value_number, rv.value_date, rv.value_bool, rv.value_json
     FROM pantry_record_values rv JOIN pantry_attributes a ON a.id = rv.attribute_id
     WHERE rv.record_id = $1 ORDER BY a.position ASC`,
    [record_id]
  );
  const ctxValues: any = {};
  for (const v of vals.rows) {
    ctxValues[v.slug] = v.value_text ?? v.value_number ?? v.value_date ?? v.value_bool ?? v.value_json;
  }

  const notes = await ctx.db.query(`SELECT title, body_md FROM pantry_notes WHERE parent_record_id = $1 ORDER BY created_at DESC LIMIT 10`, [record_id]);
  const tasks = await ctx.db.query(`SELECT title, due_at, completed_at FROM pantry_tasks WHERE parent_record_id = $1 ORDER BY created_at DESC LIMIT 10`, [record_id]);

  const { BUTTERBASE_API_KEY, BUTTERBASE_API_URL, BUTTERBASE_APP_ID } = ctx.env;
  if (!BUTTERBASE_API_KEY) return new Response(JSON.stringify({ error: "BUTTERBASE_API_KEY not set" }), { status: 500 });

  const sys = `You are a CRM assistant for a ${rec.singular_noun} record. Use the data, notes, and tasks to help draft emails, follow-ups, summaries, or answer questions. Be concise and professional.`;
  const userMsg = `=== Record ===\n${JSON.stringify(ctxValues, null, 2)}\n\n=== Notes ===\n${notes.rows.map((n: any) => `- ${n.title}: ${n.body_md.slice(0, 200)}`).join("\n") || "(none)"}\n\n=== Tasks ===\n${tasks.rows.map((t: any) => `- ${t.title}${t.completed_at ? " (done)" : ""}${t.due_at ? " due " + t.due_at : ""}`).join("\n") || "(none)"}\n\n=== Request ===\n${prompt}`;

  const aiResp = await fetch(`${BUTTERBASE_API_URL}/v1/${BUTTERBASE_APP_ID}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${BUTTERBASE_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }], max_tokens: 1500, temperature: 0.5 })
  });
  if (!aiResp.ok) return new Response(JSON.stringify({ error: "AI call failed", detail: await aiResp.text() }), { status: 502 });
  const aiJson = await aiResp.json();
  return new Response(JSON.stringify({ ok: true, reply: aiJson.choices?.[0]?.message?.content || "", record_id, model, usage: aiJson.usage }), { headers: { "Content-Type": "application/json" } });
}
