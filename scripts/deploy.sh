#!/bin/bash
# Pantry recipe deployer.
# Requires Claude Code with butterbase MCP configured. Run from a Claude Code session.
#
# Steps:
#   1) Create Butterbase app (pantry-crm or custom name)
#   2) Apply schema from schema/schema.json
#   3) Deploy all 11 functions (functions/*.ts)
#   4) Generate AI key + set as env var on AI fns
#   5) Set CORS origins
#   6) Build frontend (cd web && npm install && npm run build && npm run zip)
#   7) Upload zip to deployment URL
#   8) Trigger frontend deployment
#   9) POST /fn/bootstrap to seed default objects
#  10) Print live URL
#
# This script is a stub — invoke each step via Butterbase MCP from your Claude Code session.
# A future version will be fully scripted via the Butterbase CLI.

set -e
echo "🥫 Pantry recipe deploy"
echo
echo "This recipe is meant to be deployed via Claude Code + Butterbase MCP."
echo
echo "Tell Claude:"
echo "  > Deploy the Pantry recipe in this directory to a new Butterbase app."
echo
echo "Claude will:"
echo "  - Init app, apply schema/schema.json, deploy each function, build web/, deploy frontend, run bootstrap."
echo
echo "Manual fallback: see README for step-by-step commands."
