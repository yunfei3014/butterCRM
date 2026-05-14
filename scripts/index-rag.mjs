#!/usr/bin/env node
// Drive index-records fn over all records. Parallel pages.
const BASE = "https://api.butterbase.ai/v1/app_hz4h4bcpu63n";
const KEY = "bb_sk_6698d03cadf1e58cdcff7c23ceb2a04f3424a3bb";
const PAGE = 100;
const CONC = 6;

async function index(offset) {
  const r = await fetch(`${BASE}/fn/index-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KEY}` },
    body: JSON.stringify({ offset, limit: PAGE })
  });
  if (!r.ok) throw new Error(`offset ${offset} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  // Pre-discover total count
  const cnt = await fetch(`${BASE}/fn/objects`, { headers: { "Authorization": `Bearer ${KEY}` } }).then(r => r.json());
  const total = cnt.objects.reduce((s, o) => s + o.record_count, 0);
  console.log(`Indexing ${total} records, page=${PAGE}, conc=${CONC}`);

  let nextOffset = 0;
  let totalIngested = 0, totalErrors = 0;
  const inFlight = new Map();
  let done = false;
  while (!done || inFlight.size > 0) {
    while (inFlight.size < CONC && !done) {
      const offset = nextOffset;
      nextOffset += PAGE;
      const p = index(offset).then(r => {
        totalIngested += r.ingested;
        totalErrors += r.errors;
        if (r.done) done = true;
        console.log(`  offset ${offset}: +${r.ingested} (${totalIngested} total, ${totalErrors} errors)`);
        inFlight.delete(offset);
      }).catch(e => {
        console.warn(`  offset ${offset}: ${e.message.slice(0, 100)}`);
        inFlight.delete(offset);
      });
      inFlight.set(offset, p);
    }
    await Promise.race(inFlight.values());
  }
  console.log(`\n✅ Indexed ${totalIngested} records (${totalErrors} errors)`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
