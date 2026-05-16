// people-search — RAG-powered people search over butterCRM.
// Auth: requires a platform-verified end-user JWT (ctx.user). Domain-allowlisted.
//
// POST { query, use_case?, top_k?, model?, rank?, segment? }
//   query    — natural-language description of who to find
//   use_case — optional context the fit score is judged against
//   top_k    — results to return (1-30, default 12)
//   segment  — optional Segment record id. Restricts results to people tagged
//              with that beta_segment. Small segments are loaded directly;
//              large ones are RAG-retrieved then membership-filtered. With no
//              query, searches the segment's own theme (= browse the segment).
// POST { list_segments: true } → { segments: [{ id, name, segment_id }] }
const COLLECTION = "buttercrm-records";
const DOMS = ["betauniversity.org", "betafund.ai"];
const DIRECT_MAX = 60; // segments at/under this size skip RAG and load members directly

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

// Parse a newline-delimited "key: value" profile blob (search_text or RAG content).
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

function toPerson(record_id, fields, rag_score) {
  return {
    record_id,
    name: fields.name || "(unknown)",
    job_title: fields.job_title || "",
    email: fields.email_addresses || fields.email || "",
    linkedin: fields.linkedin || "",
    twitter: fields.twitter || "",
    location: fields.primary_location || fields.location || "",
    avatar_url: fields.avatar_url || "",
    bio: fields.description || fields.notes_summary || "",
    rag_score: rag_score != null ? Math.round(rag_score * 1000) / 1000 : null,
    fit_score: null,
    reason: "",
  };
}

export async function handler(req, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const g = guard(ctx);
  if (g) return json({ error: g.error }, g.status);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const { BUTTERBASE_API_KEY, BUTTERBASE_API_URL, BUTTERBASE_APP_ID } = ctx.env;

  // --- list_segments mode: return the Segment records for the UI picker ---
  if (body.list_segments) {
    try {
      const r = await ctx.db.query(
        `SELECT r.id,
                MAX(CASE WHEN a.slug = 'name'       THEN v.value_text END) AS name,
                MAX(CASE WHEN a.slug = 'segment_id' THEN v.value_text END) AS segment_id
         FROM pantry_records r
         JOIN pantry_objects o ON o.id = r.object_id AND o.slug = 'segments'
         JOIN pantry_record_values v ON v.record_id = r.id
         JOIN pantry_attributes a ON a.id = v.attribute_id
         GROUP BY r.id
         ORDER BY segment_id NULLS LAST`,
      );
      return json({ segments: r.rows });
    } catch (e) {
      return json({ error: "segment list failed", detail: String(e?.message || e) }, 500);
    }
  }

  // --- search mode --------------------------------------------------------
  let query = String(body.query || body.q || "").trim();
  const useCase = String(body.use_case || body.context || "").trim();
  const topK = Math.min(Math.max(parseInt(body.top_k) || 12, 1), 30);
  const model = body.model || "anthropic/claude-haiku-4.5";
  const rank = body.rank !== false;
  const segment = String(body.segment || "").trim();

  // Resolve the segment to its member people.
  let memberIds = null;
  let segmentName = "";
  if (segment) {
    try {
      const mem = await ctx.db.query(
        `SELECT DISTINCT prr.from_record_id AS pid
         FROM pantry_record_references prr
         JOIN pantry_attributes a ON a.id = prr.attribute_id
         WHERE a.slug = 'beta_segments' AND prr.to_record_id = $1`,
        [segment],
      );
      memberIds = mem.rows.map((x) => x.pid);
      const nm = await ctx.db.query(
        `SELECT v.value_text AS name FROM pantry_record_values v
         JOIN pantry_attributes a ON a.id = v.attribute_id
         WHERE v.record_id = $1 AND a.slug = 'name' LIMIT 1`,
        [segment],
      );
      segmentName = nm.rows[0]?.name || "";
    } catch (e) {
      return json({ error: "segment lookup failed", detail: String(e?.message || e) }, 500);
    }
    if (!memberIds.length) {
      return json({ query, segment, segment_name: segmentName, count: 0, ranked: false, people: [] });
    }
  }

  // With a segment but no query, search the segment's own theme (= browse it).
  if (!query && segment) query = segmentName.replace(/^[\d.]+\s*·?\s*/, "") || "people";
  if (!query) return json({ error: "query required", people: [] }, 400);

  // Small segment: load every member directly (no RAG pre-rank needed).
  // Large / no segment: RAG-retrieve, then membership-filter if a segment is set.
  const directMode = !!(memberIds && memberIds.length <= DIRECT_MAX);
  let people = [];

  if (directMode) {
    try {
      const rows = await ctx.db.query(
        `SELECT id, search_text FROM pantry_records
         WHERE id = ANY($1::uuid[]) AND char_length(search_text) > 0`,
        [memberIds],
      );
      for (const row of rows.rows) people.push(toPerson(row.id, parseProfile(row.search_text), null));
    } catch (e) {
      return json({ error: "member load failed", detail: String(e?.message || e) }, 500);
    }
  } else {
    const fetchK = memberIds ? 50 : Math.min(topK * 3, 50); // RAG query endpoint caps topK at 50
    let chunks = [];
    try {
      const r = await fetch(
        `${BUTTERBASE_API_URL}/v1/${BUTTERBASE_APP_ID}/rag/collections/${COLLECTION}/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${BUTTERBASE_API_KEY}` },
          body: JSON.stringify({ query, topK: fetchK, threshold: 0, filter: { object_slug: "people" } }),
        },
      );
      if (!r.ok) return json({ error: "RAG query failed", detail: (await r.text()).slice(0, 300) }, 502);
      chunks = (await r.json()).chunks || [];
    } catch (e) {
      return json({ error: "RAG query error", detail: String(e?.message || e) }, 502);
    }
    const seen = new Set();
    for (const c of chunks) {
      const rid = c.metadata?.record_id;
      if (!rid || seen.has(rid)) continue;
      seen.add(rid);
      const f = parseProfile(c.content);
      if (!f.name && c.metadata?.name) f.name = c.metadata.name;
      people.push(toPerson(rid, f, c.score));
    }
    if (memberIds) {
      const set = new Set(memberIds);
      people = people.filter((p) => set.has(p.record_id));
    }
  }

  if (!people.length) {
    return json({ query, use_case: useCase, segment, segment_name: segmentName, count: 0, ranked: false, people: [] });
  }

  // LLM rerank + fit scoring. Direct mode ranks the whole (small) member set.
  let ranked = false;
  if (rank) {
    const list = directMode ? people : people.slice(0, topK + 8);
    const bioLen = directMode ? 450 : 600;
    const profiles = list
      .map(
        (c, i) =>
          `#${i} ${c.name}${c.job_title ? " — " + c.job_title : ""}${c.location ? " · " + c.location : ""}\n${(c.bio || "(no bio)").slice(0, bioLen)}`,
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
            max_tokens: 3000,
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

  // Sort: fit desc (nulls last), then RAG score.
  people.sort((a, b) => {
    const fa = a.fit_score ?? -1;
    const fb = b.fit_score ?? -1;
    return fb !== fa ? fb - fa : (b.rag_score || 0) - (a.rag_score || 0);
  });

  return json({
    query,
    use_case: useCase,
    segment,
    segment_name: segmentName,
    ranked,
    count: people.length,
    people: people.slice(0, topK),
  });
}
