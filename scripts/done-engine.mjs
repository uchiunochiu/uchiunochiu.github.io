#!/usr/bin/env node
import { execSync } from 'node:child_process';

const SB_URL = process.env.SB_URL || 'https://kzixjgzqyujqyjwvdgkn.supabase.co';
const SB_KEY = process.env.SB_KEY || 'sb_publishable_ZpX-YNB5Av3mtNiIablq3w_JOPXMVxK';
const REPO_DIR = process.env.DASHBOARD_REPO_DIR || '/Users/uchiunochiu/.openclaw/workspace/dashboard';

function run(cmd, { timeoutMs = 30000 } = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`REST ${method} ${path} failed: ${res.status} ${txt.slice(0, 500)}`);
  return txt ? JSON.parse(txt) : null;
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

async function main() {
  const ticketId = arg('--ticket-id');
  if (!ticketId) throw new Error('--ticket-id is required');

  const rows = await rest(`tickets?id=eq.${ticketId}&select=id,ticket_no,title,working_branch,project_id&limit=1`);
  const ticket = rows?.[0];
  if (!ticket) throw new Error('ticket not found');

  const branch = String(ticket.working_branch || '').trim();
  let merged = false;

  run(`git -C ${JSON.stringify(REPO_DIR)} checkout main`);
  run(`git -C ${JSON.stringify(REPO_DIR)} pull --ff-only`, { timeoutMs: 45000 });

  if (branch && branch !== 'main') {
    run(`git -C ${JSON.stringify(REPO_DIR)} merge --no-edit ${JSON.stringify(branch)}`, { timeoutMs: 60000 });
    merged = true;
  }

  // production reflection is mandatory
  run(`git -C ${JSON.stringify(REPO_DIR)} push origin main`, { timeoutMs: 60000 });

  try {
    run(`brv curate ${JSON.stringify(`done: ${ticket.ticket_no || ticket.id} ${ticket.title || ''}`)}`, { timeoutMs: 45000 });
  } catch {
    // non-fatal
  }

  const out = {
    ok: true,
    ticket_id: ticket.id,
    ticket_no: ticket.ticket_no || '',
    title: ticket.title || '',
    working_branch: branch || 'main',
    merged,
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => {
  const out = { ok: false, error: String(e?.message || e) };
  process.stdout.write(JSON.stringify(out));
  process.exitCode = 1;
});
