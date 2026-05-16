// people-search — RAG-powered people search over butterCRM.
// Auth: requires a platform-verified end-user JWT (ctx.user). Domain-allowlisted.
const COLLECTION = "buttercrm-records";
const DOMS = ["betauniversity.org", "betafund.ai"];

// Hard auth gate — verified end-user JWT required (no anonymous pass-through).
function guard(ctx) {
  const u = ctx && ctx.user;
  if (!u || !u.id) return { status: 401, error: "unauthorized" };
  const d = String(u.email || "").split("@").pop().toLowerCase();
  if (u.email && !DOMS.includes(d)) return { status: 403, error: "forbidden domain" };
  return null;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function clampScore(n) {
  n = Number(n);
  return isNaN(n) ? null : Math.max(0, Math.min(100, Math.round(n)));
}

function parseProfile(content) {
  const out = {};
  for (const line of (content || "").split("\n")) {
    const i = line.indexOf(": ");
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 2).trim();
    if (k && v && !(k in out)) out[k] = v;
  }
  return out;
}

export async function handler(req, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const g = guard(ctx);
  if (g) return json({ error: g.error }, g.status);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const query = String(body.query || body.q || "").trim();
  const useCase = String(body.use_case || body.context || "").trim();
  const topK = Math.min(Math.max(parseInt(body.top_k) || 12, 1), 30);
  const model = body.model || "anthropic/claude-haiku-4.5";
  const rank = body.rank !== false;
  if (!query) return json({ error: "query required", people: [] }, 400);

  const { BUTTERBASE_API_KEY, BUTTERBASE_API_URL, BUTTERBASE_APP_ID } = ctx.env;

  let chunks = [];
  try {
    const r = await fetch(
      `${BUTTERBASE_API_URL}/v1/${BUTTERBASE_APP_ID}/rag/collections/${COLLECTION}/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${BUTTERBASE_API_KEY}` },
        body: JSON.stringify({
          query,
          topK: Math.min(topK * 3, 60),
          threshold: 0,
          filter: { object_slug: "people" },
        }),
      },
    );
    if (!r.ok) return json({ error: "RAG query failed", detail: (await r.text()).slice(0, 300) }, 502);
    chunks = (await r.json()).chunks || [];
  } catch (e) {
    return json({ error: "RAG query error", detail: String(e?.message || e) }, 502);
  }

  const seen = new Set();
  let people = [];
  for (const c of chunks) {
    const rid = c.metadata?.record_id;
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);
    const p = parseProfile(c.content);
    people.push({
      record_id: rid,
      name: c.metadata?.name || p.name || "(unknown)",
      job_title: p.job_title || "",
      email: p.email_addresses || p.email || "",
      linkedin: p.linkedin || "",
      twitter: p.twitter || "",
      location: p.primary_location || p.location || "",
      avatar_url: p.avatar_url || "",
      bio: p.description || p.notes_summary || "",
      rag_score: c.score != null ? Math.round(c.score * 1000) / 1000 : null,
      fit_score: null,
      reason: "",
    });
  }
  if (!people.length) return json({ query, use_case: useCase, count: 0, ranked: false, people: [] });

  let ranked = false;
  if (rank) {
    const list = people.slice(0, topK + 8);
    const profiles = list
      .map(
        (c, i) =>
          `#${i} ${c.name}${c.job_title ? " — " + c.job_title : ""}${c.location ? " · " + c.location : ""}\n${(c.bio || "(no bio)").slice(0, 600)}`,
      )
      .join("\n\n");
    const sys =
      "You are a sourcing analyst. The user searches their CRM network for people fitting a use case. Score each candidate 0-100 for fit and give ONE concrete sentence citing their background as the reason. Be discerning: most are weak fits (<40); reserve 80+ for clear, specific matches.";
    const ucBlock = useCase
      ? `USE CASE — who we want:\n${useCase}\n\nSEARCH QUERY: ${query}`
      : `SEARCH QUERY — find people matching this: ${query}`;
    const usr = `${ucBlock}\n\n=== CANDIDATES ===\n${profiles}\n\nReturn ONLY a JSON array with one object per index above: [{"i":0,"score":85,"reason":"..."}]. Include every index. No prose, no markdown.`;
    try {
      const ar = await fetch(
        `${BUTTERBASE_API_URL}/v1/${BUTTERBASE_APP_ID}/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${BUTTERBASE_API_KEY}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: usr },
            ],
            max_tokens: 2200,
            temperature: 0.2,
          }),
        },
      );
      if (ar.ok) {
        let txt = (await ar.json()).choices?.[0]?.message?.content || "[]";
        const m = txt.match(/\[[\s\S]*\]/);
        const arr = JSON.parse(m ? m[0] : txt);
        const by = {};
        for (const s of arr) by[s.i] = s;
        list.forEach((c, i) => {
          if (by[i]) {
            c.fit_score = clampScore(by[i].score);
            c.reason = String(by[i].reason || "");
          }
        });
        people = list;
        ranked = true;
      } else {
        console.warn("rerank http", ar.status, (await ar.text()).slice(0, 200));
      }
    } catch (e) {
      console.error("rerank error", e?.message || e);
    }
  }

  people.sort((a, b) => {
    const fa = a.fit_score ?? -1;
    const fb = b.fit_score ?? -1;
    return fb !== fa ? fb - fa : (b.rag_score || 0) - (a.rag_score || 0);
  });

  return json({ query, use_case: useCase, ranked, count: people.length, people: people.slice(0, topK) });
}

