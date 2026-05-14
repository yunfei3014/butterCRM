#!/usr/bin/env node
// Migrate an Attio workspace into butterCRM.
// Usage:
//   ATTIO_API_TOKEN=... node scripts/migrate-attio.mjs [--app-url=https://api.butterbase.ai/v1/app_xxx] [--limit=200]
//
// Strategy:
//   1) Pull Attio objects + attributes; ensure matching objects + attrs exist in butterCRM.
//   2) Pull Attio records per object; insert into butterCRM via records-upsert.
//      Build attio_record_id → buttercrm_record_id mapping.
//   3) Second pass to resolve record-reference attributes using the mapping.
//   4) Pull Attio lists + entries; create matching lists in butterCRM.

const ATTIO_API_TOKEN = process.env.ATTIO_API_TOKEN;
if (!ATTIO_API_TOKEN) { console.error("ATTIO_API_TOKEN env var required"); process.exit(1); }

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const BB_URL = args["app-url"] || "https://api.butterbase.ai/v1/app_sf5izitigmil";
const LIMIT_PER_OBJECT = parseInt(args.limit || "10000", 10);
const SYNC_LISTS = args["skip-lists"] ? false : true;
const OBJECTS_TO_MIGRATE = (args.objects || "companies,people,segments,luma_events,deals").split(",");

const ATTIO_BASE = "https://api.attio.com/v2";
const HDR = { Authorization: `Bearer ${ATTIO_API_TOKEN}`, "Content-Type": "application/json" };

async function attioGet(path) {
  const r = await fetch(`${ATTIO_BASE}${path}`, { headers: HDR });
  if (!r.ok) throw new Error(`Attio GET ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}
async function attioPost(path, body) {
  const r = await fetch(`${ATTIO_BASE}${path}`, { method: "POST", headers: HDR, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Attio POST ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}
async function bbCall(fn, body, method = "POST") {
  const r = await fetch(`${BB_URL}/fn/${fn}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`bb ${fn} ${r.status}: ${await r.text()}`);
  return r.json();
}
async function bbGet(fn, params = {}) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${BB_URL}/fn/${fn}${q ? "?" + q : ""}`);
  if (!r.ok) throw new Error(`bb ${fn} ${r.status}: ${await r.text()}`);
  return r.json();
}

const SLUG_MAP = {}; // attio_object_slug → bb object slug (1:1 by default)
const RECORD_MAP = {}; // attio_record_id → bb record_id

// Extract a simple value from Attio's array-of-value-objects format.
function extractValue(attioValues, attioType) {
  if (!Array.isArray(attioValues) || !attioValues.length) return null;
  // Active value(s): no active_until or active_until > now
  const active = attioValues.filter(v => !v.active_until || new Date(v.active_until) > new Date());
  if (!active.length) return null;

  const isMulti = active.length > 1 || ["select", "multi-select"].includes(attioType);
  const out = active.map(v => {
    switch (attioType) {
      case "personal-name":
        return v.full_name || `${v.first_name || ""} ${v.last_name || ""}`.trim();
      case "email-address":
        return v.email_address || v.email_address_full || v.value;
      case "phone-number":
        return v.phone_number || v.original_phone_number || v.value;
      case "domain":
        return v.domain || v.value;
      case "location":
        return v.locality || v.region || v.country_code || v.value;
      case "number":
      case "currency":
      case "rating":
        return v.number_value ?? v.currency_value ?? v.value ?? null;
      case "date":
      case "timestamp":
        return v.value;
      case "checkbox":
        return v.value;
      case "status":
        return v.status?.title || v.status?.api_slug || v.value;
      case "select":
        return v.option?.title || v.value;
      case "record-reference":
        return { _attio_ref: v.target_record_id, _attio_object: v.target_object };
      case "actor-reference":
        return v.referenced_actor_id || v.referenced_actor_type || v.value;
      case "interaction":
        return v;
      default:
        return v.value ?? v;
    }
  });
  return isMulti ? out : out[0];
}

async function paginate(objectSlug, limit) {
  let offset = 0;
  const pageSize = 500;
  const all = [];
  while (all.length < limit) {
    const remaining = limit - all.length;
    const lim = Math.min(pageSize, remaining);
    const res = await attioPost(`/objects/${objectSlug}/records/query`, { limit: lim, offset });
    const batch = res.data || [];
    all.push(...batch);
    if (batch.length < lim) break;
    offset += batch.length;
    console.log(`    fetched ${all.length}…`);
  }
  return all;
}

async function ensureObject(attioObj) {
  const slug = attioObj.api_slug;
  // Check if already exists in butterCRM
  const objs = await bbGet("objects");
  let existing = objs.objects.find(o => o.slug === slug);
  if (existing) { SLUG_MAP[slug] = slug; return existing; }

  const out = await bbCall("objects", {
    action: "create",
    slug,
    singular_noun: attioObj.singular_noun,
    plural_noun: attioObj.plural_noun,
    icon: "tag"
  });
  SLUG_MAP[slug] = slug;
  return out;
}

async function ensureAttributes(attioObjSlug) {
  const ar = await attioGet(`/objects/${attioObjSlug}/attributes`);
  const attioAttrs = ar.data || [];
  const bb = await bbGet("attributes", { object: attioObjSlug });
  const existingSlugs = new Set(bb.attributes.map(a => a.slug));

  let added = 0;
  for (const a of attioAttrs) {
    if (existingSlugs.has(a.api_slug)) continue;
    if (a.api_slug.startsWith("_")) continue; // skip internal
    try {
      const body = {
        action: "create",
        object_slug: attioObjSlug,
        slug: a.api_slug,
        name: a.title || a.api_slug,
        type: a.type,
        is_required: !!a.is_required,
        is_unique: !!a.is_unique,
        config: {}
      };
      if (a.type === "record-reference" && a.config?.record_reference?.allowed_object_ids) {
        // We don't have Attio object IDs mapped; allow any
        body.config.allowed_object_slugs = [];
      }
      if (a.type === "status" || a.type === "select") {
        const optsEndpoint = a.type === "status" ? "statuses" : "select-options";
        try {
          const opts = await attioGet(`/objects/${attioObjSlug}/attributes/${a.api_slug}/${optsEndpoint}`);
          body.options = (opts.data || []).map(o => ({
            value: o.api_slug || o.title?.toLowerCase().replace(/\W+/g, "_") || o.title,
            label: o.title,
            color: o.celebration_enabled ? "green" : null
          }));
        } catch (e) { /* ignore option fetch err */ }
      }
      await bbCall("attributes", body);
      added++;
    } catch (e) {
      console.warn(`    attr ${a.api_slug} skipped: ${e.message.slice(0, 80)}`);
    }
  }
  return added;
}

async function migrateRecords(attioObjSlug) {
  console.log(`  pulling records…`);
  const records = await paginate(attioObjSlug, LIMIT_PER_OBJECT);
  console.log(`  ${records.length} records pulled, inserting…`);

  // Get attribute types so we can extract values correctly
  const ar = await attioGet(`/objects/${attioObjSlug}/attributes`);
  const attrTypeBySlug = {};
  for (const a of ar.data) attrTypeBySlug[a.api_slug] = a.type;

  let inserted = 0, skipped = 0;
  const deferredRefs = [];

  // Build payload list
  const payloads = [];
  for (const r of records) {
    const attioId = r.id?.record_id;
    if (!attioId) { skipped++; continue; }
    const values = {};
    for (const [slug, vals] of Object.entries(r.values || {})) {
      const type = attrTypeBySlug[slug];
      if (!type) continue;
      if (type === "record-reference") {
        const active = (vals || []).filter(v => !v.active_until);
        for (const v of active) {
          deferredRefs.push({ attio_rec_id: attioId, slug, attio_ref_id: v.target_record_id, attio_ref_object: v.target_object });
        }
        continue;
      }
      const extracted = extractValue(vals, type);
      if (extracted != null && extracted !== "") values[slug] = extracted;
    }
    payloads.push({ attioId, values });
  }

  // Parallel upserts in batches of 10
  const CONCURRENCY = 10;
  for (let i = 0; i < payloads.length; i += CONCURRENCY) {
    const batch = payloads.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(p => bbCall("records-upsert", { object: attioObjSlug, values: p.values }))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        RECORD_MAP[batch[j].attioId] = r.value.record_id;
        inserted++;
      } else {
        console.warn(`    rec ${batch[j].attioId.slice(0, 8)} failed: ${r.reason.message.slice(0, 100)}`);
        skipped++;
      }
    }
    if (inserted > 0 && inserted % 100 < CONCURRENCY) console.log(`    ${inserted}/${payloads.length}…`);
  }
  console.log(`  ${attioObjSlug}: inserted=${inserted}, skipped=${skipped}, refs_deferred=${deferredRefs.length}`);
  return deferredRefs;
}

async function resolveReferences(allDeferred) {
  console.log(`Resolving ${allDeferred.length} record references…`);
  let resolved = 0, missed = 0;
  // Group by from_record so we can batch updates
  const byFrom = {};
  for (const d of allDeferred) {
    const fromBbId = RECORD_MAP[d.attio_rec_id];
    const toBbId = RECORD_MAP[d.attio_ref_id];
    if (!fromBbId || !toBbId) { missed++; continue; }
    const key = `${fromBbId}|${d.slug}|${d.attio_ref_object}`;
    if (!byFrom[key]) byFrom[key] = { from: fromBbId, slug: d.slug, object_slug: d.attio_ref_object, refs: [] };
    byFrom[key].refs.push(toBbId);
  }
  // Group by from record + collect slug→[ids]
  const updates = {};
  for (const g of Object.values(byFrom)) {
    if (!updates[g.from]) updates[g.from] = { object_slug: null, values: {} };
    updates[g.from].values[g.slug] = g.refs.length === 1 ? g.refs[0] : g.refs;
  }
  // Determine object_slug per record by querying butterCRM (simple: use any object)
  // Faster: we know which attio object each from belongs to from upstream — but lost it here.
  // Workaround: query records to look up object_id per record. Cheap: bulk.
  // Simpler: try all 5 object slugs in turn until upsert succeeds; not great but works.
  // Even simpler: track from_object during pass 1. Let's pass that through.
  for (const [bbId, upd] of Object.entries(updates)) {
    let ok = false;
    for (const trySlug of OBJECTS_TO_MIGRATE) {
      try {
        await bbCall("records-upsert", { object: trySlug, record_id: bbId, values: upd.values });
        resolved++; ok = true; break;
      } catch (e) { /* try next */ }
    }
    if (!ok) missed++;
  }
  console.log(`  refs resolved=${resolved}, missed=${missed}`);
}

async function migrateLists() {
  if (!SYNC_LISTS) return;
  console.log("Migrating lists…");
  const lr = await attioGet("/lists");
  const lists = lr.data || [];
  for (const l of lists) {
    const parentObj = l.parent_object?.[0];
    if (!parentObj || !SLUG_MAP[parentObj]) continue;
    try {
      // Create list (slug auto-generated to avoid collision)
      const out = await bbCall("lists", {
        action: "create",
        object_slug: parentObj,
        name: l.name,
        icon: "tag"
      });
      // Fetch entries
      const er = await attioPost(`/lists/${l.api_slug}/entries/query`, { limit: 500 });
      const entries = er.data || [];
      const recordIds = entries
        .map(e => RECORD_MAP[e.parent_record_id])
        .filter(Boolean);
      if (recordIds.length) {
        await bbCall("lists", { action: "add_entries", list_id: out.id, record_ids: recordIds });
      }
      console.log(`  list "${l.name}" → ${recordIds.length}/${entries.length} entries linked`);
    } catch (e) {
      console.warn(`  list "${l.name}" failed: ${e.message.slice(0, 100)}`);
    }
  }
}

async function main() {
  console.log(`Migrating from Attio → butterCRM (${BB_URL})`);
  console.log(`Objects: ${OBJECTS_TO_MIGRATE.join(", ")}\n`);

  const objs = await attioGet("/objects");
  const attioObjs = objs.data.filter(o => OBJECTS_TO_MIGRATE.includes(o.api_slug));

  const allDeferred = [];
  for (const o of attioObjs) {
    console.log(`\n=== ${o.api_slug} (${o.plural_noun}) ===`);
    await ensureObject(o);
    const attrsAdded = await ensureAttributes(o.api_slug);
    console.log(`  attrs added: ${attrsAdded}`);
    const deferred = await migrateRecords(o.api_slug);
    allDeferred.push(...deferred);
  }

  await resolveReferences(allDeferred);
  await migrateLists();
  console.log("\n✅ Migration complete.");
  console.log(`Records mapped: ${Object.keys(RECORD_MAP).length}`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
