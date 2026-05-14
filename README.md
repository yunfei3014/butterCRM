# 🥫 Pantry

**Open-source CRM, built on [Butterbase](https://butterbase.ai).**

Pantry is an Attio-style flexible CRM where everything is data: people, companies, deals, or any custom object you invent. Records have typed attributes. Lists let you filter and segment. Notes and tasks attach to anything. And AI is wired in from day one — semantic search + an enrichment agent + a per-record assistant for drafting outreach.

This is also the **first recipe** in the Butterbase recipe ecosystem. The entire stack — schema, functions, frontend — lives in this repo and deploys to your own Butterbase account with one command.

---

## What you get

- **Custom objects**, like Notion databases but record-shaped (People, Companies, Deals built in; add Investors, Properties, Pets, whatever)
- **Typed attributes**: text, email, phone, currency, date, number, checkbox, status, select, record reference, location, rating
- **Lists** — saved filtered views per object
- **Notes** — markdown notes attached to records
- **Tasks** — checkboxes with due dates
- **Hybrid search** — keyword + semantic vector via pgvector + Butterbase AI gateway
- **AI enrichment** — fill missing fields on any record from public info
- **AI agent** — chat with any record's context to draft emails, summaries, follow-ups
- **Background embedding** — cron job that keeps record embeddings fresh

All open source. All yours. No SaaS lock-in.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Vite + React frontend  →  https://your-app.butterbase.dev │
└─────────────────────────┬──────────────────────────────────┘
                          │
              ┌───────────▼─────────────┐
              │   Butterbase platform   │
              │  ┌───────────────────┐  │
              │  │  9 serverless fns │  │  records, objects, attributes,
              │  │  (TypeScript)     │  │  lists, notes, tasks, search,
              │  └───────────────────┘  │  enrich, agent, embed (cron)
              │  ┌───────────────────┐  │
              │  │  Postgres + RLS   │  │  EAV model (~10 tables)
              │  │  pgvector HNSW    │  │
              │  └───────────────────┘  │
              │  ┌───────────────────┐  │
              │  │  AI gateway       │  │  Claude / GPT / embeddings
              │  └───────────────────┘  │
              └─────────────────────────┘
```

## Quick deploy

```bash
git clone https://github.com/yunfei3014/pantry
cd pantry
./scripts/deploy.sh
```

The script will:
1. Create a new Butterbase app
2. Apply the database schema
3. Deploy all 9 serverless functions
4. Set up the AI gateway key
5. Build and upload the frontend
6. Print your live URL

Requires the [Butterbase MCP](https://butterbase.ai) configured in your Claude Code. (We use MCP so AI agents can deploy and operate Pantry end-to-end.)

## Data model

| Table | Purpose |
|---|---|
| `pantry_objects` | Object types (People, Companies, Deals, custom) |
| `pantry_attributes` | Per-object field definitions, typed |
| `pantry_select_options` | Options for select/status attrs |
| `pantry_records` | Record instances + embedding |
| `pantry_record_values` | EAV: one row per (record, attribute) |
| `pantry_record_references` | record-to-record links |
| `pantry_lists` | Saved filtered views |
| `pantry_list_entries` | Records belonging to a list |
| `pantry_notes` | Markdown notes |
| `pantry_tasks` | Tasks with due dates |
| `pantry_members` | Workspace members |

## API surface

All serverless functions are at `https://api.butterbase.ai/v1/{app_id}/fn/{name}`.

| Function | Method | Purpose |
|---|---|---|
| `bootstrap` | POST | Seed default People/Companies/Deals (idempotent) |
| `objects` | GET / POST | List, create, update, delete objects |
| `attributes` | GET / POST | Manage attributes + select options per object |
| `records-query` | POST | List/filter/sort records with attribute values joined |
| `records-upsert` | POST | Create or update a record + its attribute values |
| `lists` | GET / POST | Manage lists + add/remove entries |
| `notes-tasks` | GET / POST | Notes (`?type=notes`) or tasks (`?type=tasks`) |
| `search` | POST | Hybrid keyword + semantic search |
| `enrich` | POST | AI agent fills missing fields on a record |
| `agent` | POST | Per-record AI chat (drafts, summaries, follow-ups) |
| `embed-records` | cron | Regenerate embeddings every 5 min |

## Why "Pantry"?

Butterbase is your kitchen. Pantry is where you keep what you've gathered. It's the first **recipe** — a fully-cooked starter app you can clone and customize.

## Roadmap (post-v0.1)

- [ ] Real auth (sign-up / login via Butterbase auth)
- [ ] Multi-workspace
- [ ] Kanban view for `status`-attr objects (Deals pipeline)
- [ ] Webhooks
- [ ] Email integration (sync to records)
- [ ] Mobile app
- [ ] Templates marketplace (sales / fundraising / hiring / personal)

## Contributing

PRs welcome. Open an issue first for anything bigger than a bug fix.

## License

MIT — see [LICENSE](LICENSE).
