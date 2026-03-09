#!/usr/bin/env node

const SB_URL = process.env.SB_URL || 'https://kzixjgzqyujqyjwvdgkn.supabase.co';
const SB_KEY = process.env.SB_KEY || 'sb_publishable_ZpX-YNB5Av3mtNiIablq3w_JOPXMVxK';
const POLL_MS = Number(process.env.POLL_MS || 1500);
const DISCORD_TARGET = process.env.DISCORD_TARGET || 'channel:1466059533578403998';

const headers = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function claimOne() {
  const rows = await rest('tachikoma_events?select=id,event_type,project_id,ticket_id,body,raw_payload,attempts,handling_status&handling_status=eq.pending&order=id.asc&limit=1');
  if (!rows?.length) return null;
  const row = rows[0];
  const claimed = await rest(`tachikoma_events?id=eq.${row.id}&handling_status=eq.pending`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ handling_status: 'processing', attempts: (row.attempts || 0) + 1 }),
  });
  return claimed?.[0] || null;
}

function decodeBase64Text(b64 = '') {
  try {
    const bin = Buffer.from(String(b64 || ''), 'base64');
    return bin.toString('utf8');
  } catch {
    return '';
  }
}

async function fetchContext(ev) {
  const ctx = { project: null, ticket: null, attachments: [] };
  if (ev.project_id) {
    const p = await rest(`projects?select=id,project_key,title,goal,definition_of_done,constraints&id=eq.${ev.project_id}&limit=1`);
    ctx.project = p?.[0] || null;
  }
  if (ev.ticket_id) {
    const t = await rest(`tickets?select=id,ticket_no,title,description,completion_criteria,status,project_id,parent_ticket_id&id=eq.${ev.ticket_id}&limit=1`);
    ctx.ticket = t?.[0] || null;
  }

  const rp = ev.raw_payload || {};
  const ids = Array.isArray(rp.attachment_ids) ? rp.attachment_ids.filter(Boolean) : [];
  if (ids.length) {
    const inList = ids.map((x) => `"${String(x)}"`).join(',');
    const rows = await rest(`ticket_attachments?select=id,file_name,mime_type,file_size,content_base64,created_at&id=in.(${inList})`);
    ctx.attachments = (rows || []).map((a) => {
      const mt = String(a.mime_type || '').toLowerCase();
      const isText = mt.startsWith('text/') || mt.includes('json') || mt.includes('xml') || mt.includes('yaml') || mt.includes('csv') || a.file_name?.match(/\.(md|txt|json|yaml|yml|csv)$/i);
      const excerpt = isText ? decodeBase64Text(a.content_base64).slice(0, 1200) : '';
      return {
        id: a.id,
        file_name: a.file_name,
        mime_type: a.mime_type,
        file_size: a.file_size,
        excerpt,
        has_text: !!excerpt,
      };
    });
  }

  return ctx;
}

async function callLLM(ev, ctx) {
  const scope = ev.ticket_id
    ? `ticket_id=${ev.ticket_id} (project_id=${ev.project_id || ctx.ticket?.project_id || '-'})`
    : `project_id=${ev.project_id}`;

  const attachmentsJson = JSON.stringify(ctx.attachments || []);
  const isTodo = ev.event_type === 'ticket_todo_detected';
  const prompt = isTodo
    ? [
        'あなたはタチコマ。以下のチケットは todo へ遷移したため即時着手候補です。',
        '要約は不要。',
        '出力は次の2点のみ:',
        '1) 実行ステップ（番号付き）',
        '2) 不足情報がある場合だけ、最小質問を1つ',
        '実行可能なら開始宣言を含める。日本語・簡潔・実務的。',
        `返信先スコープ: ${scope}`,
        `project: ${JSON.stringify(ctx.project || {})}`,
        `ticket: ${JSON.stringify(ctx.ticket || {})}`,
        `attachments: ${attachmentsJson}`,
        `comment_or_trigger: ${ev.body || ''}`,
      ].join('\n')
    : [
        'あなたはタチコマ。以下のコメントに短く実務的に返信してください。',
        '添付ファイルがある場合は内容（text excerpt）を読んだ前提で応答してください。',
        '必ず日本語、2行以内。',
        `返信先スコープ: ${scope}`,
        `project: ${JSON.stringify(ctx.project || {})}`,
        `ticket: ${JSON.stringify(ctx.ticket || {})}`,
        `attachments: ${attachmentsJson}`,
        `comment: ${ev.body || ''}`,
      ].join('\n');

  const cmd = `openclaw agent --session-id dash-comment-worker --channel discord --thinking off --verbose off --json --message ${JSON.stringify(prompt)}`;
  const { execSync } = await import('node:child_process');
  const raw = execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
  const json = JSON.parse(raw);
  const text = json?.result?.payloads?.[0]?.text?.trim();
  if (!text) throw new Error('LLM empty response');
  return text;
}

async function replyInSameScope(ev, text) {
  const body = ev.event_type === 'ticket_todo_detected' ? `【todo着手提案】\n${text}` : text;
  if (ev.ticket_id) {
    await rest('ticket_comments', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ticket_id: ev.ticket_id, body, created_by: 'tachikoma' }),
    });
  } else if (ev.project_id) {
    await rest('project_comments', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ project_id: ev.project_id, body, created_by: 'tachikoma' }),
    });
  } else {
    throw new Error('no project_id/ticket_id');
  }
}

async function markDone(id) {
  await rest(`tachikoma_events?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ handling_status: 'done', handled_at: new Date().toISOString(), last_error: null }),
  });
}

async function markError(id, err) {
  await rest(`tachikoma_events?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ handling_status: 'error', last_error: String(err).slice(0, 800) }),
  });
}

async function notifyDiscord(text) {
  try {
    const { execSync } = await import('node:child_process');
    const cmd = `openclaw agent --session-id dash-comment-notify --channel discord --deliver --reply-channel discord --reply-to ${JSON.stringify(DISCORD_TARGET)} --thinking off --verbose off --message ${JSON.stringify(text)}`;
    execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 });
  } catch (_) {}
}

async function tick() {
  const ev = await claimOne();
  if (!ev) return;
  try {
    if (ev.event_type === 'ticket_todo_detected') {
      const rp = ev.raw_payload || {};
      const title = rp.title || '(no title)';
      const no = rp.ticket_no || ev.ticket_id || '-';
      await notifyDiscord(`todo検知しました: ${no} ${title}`);
    }

    const ctx = await fetchContext(ev);
    const reply = await callLLM(ev, ctx);
    await replyInSameScope(ev, reply);
    await markDone(ev.id);

    if (ev.event_type === 'ticket_todo_detected') {
      const rp = ev.raw_payload || {};
      const title = rp.title || '(no title)';
      const no = rp.ticket_no || ev.ticket_id || '-';
      await notifyDiscord(`todo実行結果: ${no} ${title} / 完了`);
    }

    console.log('[done]', ev.id, ev.event_type);
  } catch (e) {
    await markError(ev.id, e?.message || e);
    if (ev.event_type === 'ticket_todo_detected') {
      const rp = ev.raw_payload || {};
      const title = rp.title || '(no title)';
      const no = rp.ticket_no || ev.ticket_id || '-';
      await notifyDiscord(`todo実行結果: ${no} ${title} / error: ${String(e?.message || e).slice(0, 120)}`);
    }
    console.error('[error]', ev.id, e?.message || e);
  }
}

console.log('comment-llm-worker start');
setInterval(() => { tick().catch((e) => console.error(e)); }, POLL_MS);
