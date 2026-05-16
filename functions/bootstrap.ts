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

// Seed default objects + attributes. Idempotent — run once on a fresh app.
export async function handler(req: Request, ctx: any): Promise<Response> {
  const _ag = authGuard(ctx); if (_ag) return _ag;
  const seed = [
    {
      slug: "people",
      singular: "Person",
      plural: "People",
      icon: "user",
      attrs: [
        { slug: "name", name: "Name", type: "personal-name", is_system: true, is_required: true },
        { slug: "email", name: "Email", type: "email-address", is_system: true },
        { slug: "phone", name: "Phone", type: "phone-number", is_system: true },
        { slug: "company", name: "Company", type: "record-reference", config: { allowed_object_slugs: ["companies"] }, is_system: true },
        { slug: "job_title", name: "Job title", type: "text" },
        { slug: "linkedin", name: "LinkedIn", type: "text" },
        { slug: "twitter", name: "Twitter", type: "text" },
        { slug: "location", name: "Location", type: "text" },
        { slug: "notes_summary", name: "Bio", type: "text" }
      ]
    },
    {
      slug: "companies",
      singular: "Company",
      plural: "Companies",
      icon: "building",
      attrs: [
        { slug: "name", name: "Name", type: "text", is_system: true, is_required: true },
        { slug: "domain", name: "Domain", type: "domain", is_system: true },
        { slug: "description", name: "Description", type: "text" },
        { slug: "industry", name: "Industry", type: "text" },
        { slug: "employees", name: "Employees", type: "number" },
        { slug: "location", name: "Location", type: "text" },
        { slug: "linkedin", name: "LinkedIn", type: "text" }
      ]
    },
    {
      slug: "deals",
      singular: "Deal",
      plural: "Deals",
      icon: "currency-dollar",
      attrs: [
        { slug: "name", name: "Name", type: "text", is_system: true, is_required: true },
        { slug: "value", name: "Value", type: "currency" },
        { slug: "stage", name: "Stage", type: "status", config: { options: ["lead", "qualified", "proposal", "negotiation", "won", "lost"] } },
        { slug: "close_date", name: "Close date", type: "date" },
        { slug: "company", name: "Company", type: "record-reference", config: { allowed_object_slugs: ["companies"] } },
        { slug: "primary_contact", name: "Primary contact", type: "record-reference", config: { allowed_object_slugs: ["people"] } }
      ]
    }
  ];

  const results: any[] = [];
  for (const o of seed) {
    const existing = await ctx.db.query("SELECT id FROM pantry_objects WHERE slug = $1", [o.slug]);
    let objectId: string;
    if (existing.rows.length) {
      objectId = existing.rows[0].id;
    } else {
      const ins = await ctx.db.query(
        "INSERT INTO pantry_objects (slug, singular_noun, plural_noun, icon, is_system) VALUES ($1,$2,$3,$4,true) RETURNING id",
        [o.slug, o.singular, o.plural, o.icon]
      );
      objectId = ins.rows[0].id;
    }

    for (let i = 0; i < o.attrs.length; i++) {
      const a = o.attrs[i];
      const exists = await ctx.db.query(
        "SELECT id FROM pantry_attributes WHERE object_id = $1 AND slug = $2",
        [objectId, a.slug]
      );
      if (exists.rows.length) continue;
      const attrIns = await ctx.db.query(
        `INSERT INTO pantry_attributes (object_id, slug, name, type, config, position, is_system, is_required, is_unique)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false) RETURNING id`,
        [objectId, a.slug, a.name, a.type, JSON.stringify(a.config || {}), i, !!a.is_system, !!a.is_required]
      );
      const attrId = attrIns.rows[0].id;
      if (a.type === "status" && a.config?.options) {
        for (let j = 0; j < a.config.options.length; j++) {
          const v = a.config.options[j];
          await ctx.db.query(
            "INSERT INTO pantry_select_options (attribute_id, value, label, position) VALUES ($1,$2,$3,$4)",
            [attrId, v, v.charAt(0).toUpperCase() + v.slice(1), j]
          );
        }
      }
    }
    results.push({ slug: o.slug, object_id: objectId });
  }

  return new Response(JSON.stringify({ ok: true, seeded: results }), {
    headers: { "Content-Type": "application/json" }
  });
}
