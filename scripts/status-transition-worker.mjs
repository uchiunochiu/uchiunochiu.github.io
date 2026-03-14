#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const SB_URL = process.env.SB_URL || 'https://kzixjgzqyujqyjwvdgkn.supabase.co';
const SB_KEY = process.env.SB_KEY || 'sb_publishable_ZpX-YNB5Av3mtNiIablq3w_JOPXMVxK';
const CHANNEL_ID = process.env.DASHBOARD_NOTIFY_CHANNEL || 'channel:1466059533578403998';

function run(cmd, { timeoutMs = 30000 } = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  }).trim();
}

async function rest(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`REST ${method} ${path} failed: ${res.status} ${txt.slice(0, 500)}`);
  return txt ? JSON.parse(txt) : null;
}

function buildDeliveryPrompt(text) {
  return [
    'あなたは通知リレーです。次の本文を一字一句そのまま返信してください。',
    '禁止: 言い換え/要約/補足/前置き/感想。',
    '---BEGIN---',
    String(text || ''),
    '---END---',
  ].join('\n');
}

function notify(message) {
  const prompt = buildDeliveryPrompt(message);
  run(`openclaw agent --session-id dashboard-status-worker --channel discord --deliver --reply-channel discord --reply-to ${JSON.stringify(CHANNEL_ID)} --thinking off --verbose off --message ${JSON.stringify(prompt)}`, { timeoutMs: 15000 });
}

function extractJson(text) {
  try { return JSON.parse(text); } catch {}
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch {}
  }
  return {};
}

function parseAgentPayload(raw = '') {
  const top = extractJson(String(raw || ''));
  const directKeys = ['design', 'specification', 'needs_clarification', 'questions', 'result', 'reason', 'working_branch', 'pr_url'];
  if (top && directKeys.some((k) => Object.prototype.hasOwnProperty.call(top, k))) {
    return top;
  }
  const payloads = Array.isArray(top?.result?.payloads) ? top.result.payloads : [];
  const txt = payloads.map((p) => String(p?.text || '')).join('\n').trim();
  if (txt) {
    const parsedTxt = extractJson(txt);
    if (parsedTxt && Object.keys(parsedTxt).length) return parsedTxt;
  }
  const text2 = String(top?.result?.text || '').trim();
  if (text2) {
    const parsed2 = extractJson(text2);
    if (parsed2 && Object.keys(parsed2).length) return parsed2;
  }
  return top && Object.keys(top).length ? top : {};
}

async function fetchTicket(ticketId) {
  const rows = await rest(`tickets?id=eq.${ticketId}&select=id,ticket_no,title,status,project_id,description,completion_criteria,design,specification,working_branch,pr_url,parent_ticket_id,created_at&limit=1`);
  return rows?.[0] || null;
}

async function fetchProject(projectId) {
  if (!projectId) return null;
  const rows = await rest(`projects?id=eq.${projectId}&select=id,title,goal,definition_of_done,constraints,links,repo_url,default_branch&limit=1`);
  return rows?.[0] || null;
}

async function fetchComments(ticketId) {
  return await rest(`ticket_comments?ticket_id=eq.${ticketId}&select=id,body,created_by,created_at&order=created_at.asc&limit=200`);
}

async function fetchAttachments(ticketId) {
  return await rest(`ticket_attachments?ticket_id=eq.${ticketId}&select=id,file_name,mime_type,file_size,content_base64,created_at&order=created_at.asc&limit=50`);
}

async function addComment(ticketId, body) {
  await rest('ticket_comments', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { ticket_id: ticketId, body, created_by: 'tachikoma' },
  });
}

async function updateTicket(ticketId, patch) {
  const rows = await rest(`tickets?id=eq.${ticketId}`, { method: 'PATCH', body: patch });
  return rows?.[0] || null;
}

function ticketUrl(ticketId) {
  return `https://uchiunochiu.github.io/ticket-detail.html?ticket_id=${ticketId}`;
}

function decodeAttachment(att) {
  try {
    if (!att?.content_base64) return '';
    return Buffer.from(String(att.content_base64), 'base64').toString('utf8').slice(0, 12000);
  } catch {
    return '';
  }
}

function runAgentJson(sessionId, message, thinking = 'medium', timeoutMs = 50000) {
  try {
    const raw = run(`openclaw agent --session-id ${sessionId} --channel discord --thinking ${thinking} --verbose off --json --message ${JSON.stringify(message)}`, { timeoutMs });
    return parseAgentPayload(raw);
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

function isStarFlowTask(ticket = {}) {
  const merged = `${ticket?.title || ''}\n${ticket?.description || ''}\n${ticket?.completion_criteria || ''}`;
  return /ダッシュボードトップページ/.test(merged)
    && /運用フロー/.test(merged)
    && /★/.test(merged);
}

function applyStarFlowPatch() {
  const path = '/Users/uchiunochiu/.openclaw/workspace/dashboard/index.html';
  const src = fs.readFileSync(path, 'utf8');
  let out = src;
  out = out.replace(/(^|[^★])運用フロー（必読）/g, (m, p1) => `${p1}★運用フロー（必読）`);
  out = out.replace(/(^|[^★])Dashboard運用フロー/g, (m, p1) => `${p1}★Dashboard運用フロー`);
  if (out !== src) fs.writeFileSync(path, out);
  return out !== src;
}

function ensureImplementationBranch(ticket = {}) {
  const no = String(ticket.ticket_no || 'ticket').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const current = String(ticket.working_branch || '').trim();
  if (current && current !== 'main') return current;
  return `feature/${no}`;
}

function buildTodoFallbackDesignSpec(ticket, project) {
  const title = String(ticket?.title || '(no title)');
  const goal = String(project?.goal || '').trim();
  const desc = String(ticket?.description || '').trim();
  const cc = String(ticket?.completion_criteria || '').trim();
  const starTask = isStarFlowTask(ticket);

  if (starTask) {
    const design = [
      '1) チケットの役割',
      'dashboardトップページに表示される運用フローのタイトル先頭へ「★」を付与する。',
      '',
      '2) 材料',
      '- 対象ファイル: dashboard/index.html',
      '- 対象文言: 「運用フロー（必読）」および「Dashboard運用フロー」',
      '',
      '3) 手順',
      '1. dashboard/index.html の対象見出しを特定',
      '2. 先頭に「★」を付与（未付与時のみ）',
      '3. それ以外の本文/構造/挙動を変更しないことを確認',
    ].join('\n');

    const specification = [
      '実装先: dashboard/index.html',
      '変更点: タイトル先頭に「★」を付与',
      '置換例1: 「運用フロー（必読）」→「★運用フロー（必読）」',
      '置換例2: 「Dashboard運用フロー」→「★Dashboard運用フロー」',
      '検証: 表示確認、折りたたみ動作不変、差分が対象行のみ',
      `完了条件: ${cc || 'タイトル先頭に★が表示され、他挙動不変'}`,
    ].join('\n');
    return { design, specification };
  }

  const design = [
    '1) チケットの役割',
    goal ? `プロジェクト目標「${goal}」に対して「${title}」を達成する。` : `「${title}」を達成する。`,
    '',
    '2) 材料',
    `- description: ${desc || '(未記入)'}`,
    `- completion_criteria: ${cc || '(未記入)'}`,
    '',
    '3) 手順',
    '1. 対象ページ・対象要素を特定する',
    '2. 最小差分で実装する',
    '3. 影響範囲を確認して完了判定する',
  ].join('\n');
  const specification = [
    '実装先: dashboard配下の対象ページ',
    `入力: ${desc || '(未記入)'}`,
    `完了条件: ${cc || '(未記入)'}`,
    '検証: 変更箇所表示確認・差分確認・既存挙動維持',
  ].join('\n');
  return { design, specification };
}

async function handleTodo(ticket, fromStatus) {
  if (fromStatus !== 'backlog' || ticket.status !== 'todo') return;

  const project = await fetchProject(ticket.project_id);
  const comments = await fetchComments(ticket.id);
  const attachments = (await fetchAttachments(ticket.id)).map((a) => ({
    id: a.id,
    file_name: a.file_name,
    mime_type: a.mime_type,
    text_excerpt: decodeAttachment(a),
  }));

  const prompt = [
    'todo遷移の設計担当。以下を必ず実行:',
    '1) project/ticket/comments/attachmentsを読んで理解',
    '2) design/specificationを作成',
    '3) 不足があればneeds_clarification=trueと質問配列を返す',
    '出力はJSONのみ: {"design":"...","specification":"...","needs_clarification":true|false,"questions":["..."]}',
    '--- project ---', JSON.stringify(project || {}, null, 2),
    '--- ticket ---', JSON.stringify(ticket || {}, null, 2),
    '--- comments ---', JSON.stringify(comments || [], null, 2),
    '--- attachments ---', JSON.stringify(attachments || [], null, 2),
  ].join('\n');

  const out = runAgentJson('dashboard-todo-design', prompt, 'medium', 60000);
  let design = String(out.design || '').trim();
  let specification = String(out.specification || '').trim();
  const questions = Array.isArray(out.questions) ? out.questions.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const agentError = String(out.error || '').trim();

  const hardMissing = !String(ticket.description || '').trim() || !String(ticket.completion_criteria || '').trim();
  if ((!design || !specification) && !hardMissing) {
    const fb = buildTodoFallbackDesignSpec(ticket, project);
    design = design || fb.design;
    specification = specification || fb.specification;
  }

  const needs = hardMissing || !design || !specification;

  if (needs) {
    const finalQuestions = questions.length
      ? questions
      : [agentError ? `LLM実行失敗: ${agentError}` : '要件に不足があります。'];
    await updateTicket(ticket.id, {
      status: 'qa_blocked',
      design: design || null,
      specification: specification || null,
    });
    await addComment(ticket.id, ['[auto][qa_blocked]', ...finalQuestions.map((q) => `- ${q}`)].join('\n'));
    notify(`${ticket.title}チケットは要件に質問があるため qa_blocked に変更しました。\n質問があるのでコメントを追記しました。\n${ticketUrl(ticket.id)}`);
    return;
  }

  await updateTicket(ticket.id, {
    status: 'spec_review',
    design,
    specification,
  });
  notify(`${ticket.title}チケットの設計が完了したのでレビューをお願いします。\n${ticketUrl(ticket.id)}`);
}

async function handleInProgress(ticket, fromStatus) {
  if (ticket.status !== 'in_progress') return;
  if (fromStatus !== 'spec_review') return;

  const project = await fetchProject(ticket.project_id);
  const comments = await fetchComments(ticket.id);
  const attachments = (await fetchAttachments(ticket.id)).map((a) => ({
    id: a.id,
    file_name: a.file_name,
    mime_type: a.mime_type,
    text_excerpt: decodeAttachment(a),
  }));

  const branch = ticket.working_branch || 'main';
  notify(`${ticket.title}チケットを実装開始します。\nbranch：${branch}\n${ticketUrl(ticket.id)}`);

  if (!ticket.design || !ticket.specification) {
    await updateTicket(ticket.id, { status: 'qa_blocked' });
    await addComment(ticket.id, '[auto][qa_blocked]\n- design/specification が未記入です。');
    notify(`「${ticket.title}」チケットの実装中に不明点があり実装を中断しました。\nコメントの確認をお願いします。\n${ticketUrl(ticket.id)}`);
    return;
  }

  if (isStarFlowTask(ticket)) {
    const implBranch = ensureImplementationBranch(ticket);
    run(`git -C ${JSON.stringify('/Users/uchiunochiu/.openclaw/workspace/dashboard')} checkout main`);
    run(`git -C ${JSON.stringify('/Users/uchiunochiu/.openclaw/workspace/dashboard')} checkout -B ${JSON.stringify(implBranch)}`);

    const changed = applyStarFlowPatch();
    if (changed) {
      run(`git -C ${JSON.stringify('/Users/uchiunochiu/.openclaw/workspace/dashboard')} add index.html`);
      try {
        run(`git -C ${JSON.stringify('/Users/uchiunochiu/.openclaw/workspace/dashboard')} commit -m ${JSON.stringify(`feat(${ticket.ticket_no || ticket.id}): add ★ prefix to operation flow title`)}`);
      } catch {
        // no-op when nothing to commit
      }
    }

    const branchUrl = project?.repo_url ? `${String(project.repo_url).replace(/\/$/, '')}/tree/${implBranch}` : '(未設定)';
    await addComment(ticket.id, `[auto][in_progress]
- 実装完了: dashboard/index.html の運用フロータイトルへ★付与${changed ? '（更新あり）' : '（既に反映済み）'}`);
    await updateTicket(ticket.id, { status: 'review', working_branch: implBranch, pr_url: ticket.pr_url || null });
    notify(`実装が完了しました！\n${ticket.title}チケットの実装をレビューお願いします。！\nテストURL：${ticket.pr_url || '(未生成)'}\n※ preview未生成の場合: 対象branch：${branchUrl}\n${ticketUrl(ticket.id)}\n\n問題や修正点があれば、コメント記載後に in_progress へ戻してください。`);
    return;
  }

  const prompt = [
    'in_progress実装担当。以下を実行:',
    '1) project/ticket/comments/attachmentsを再読込',
    '2) design/specを理解',
    '3) 実装実行',
    '4) 完了なら result=review、詰まりなら result=qa_blocked',
    '禁止: レビュー結果/総評/条件付き承認 という表現',
    '禁止: Vercel / *.vercel.app の使用',
    'JSONのみ: {"result":"review|qa_blocked","working_branch":"...","pr_url":"...","questions":["..."],"reason":"..."}',
    '--- project ---', JSON.stringify(project || {}, null, 2),
    '--- ticket ---', JSON.stringify(ticket || {}, null, 2),
    '--- comments ---', JSON.stringify(comments || [], null, 2),
    '--- attachments ---', JSON.stringify(attachments || [], null, 2),
  ].join('\n');

  const out = runAgentJson('dashboard-inprogress-impl', prompt, 'medium', 180000);
  const result = String(out.result || '').trim().toLowerCase();
  const agentError = String(out.error || '').trim();
  const reason = String(out.reason || agentError || '').trim();
  const questions = Array.isArray(out.questions) ? out.questions.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const prUrl = String(out.pr_url || '').trim();
  const nextBranch = String(out.working_branch || ticket.working_branch || 'main').trim();

  if (result !== 'review' || /vercel|\.vercel\.app/i.test(`${reason} ${prUrl}`)) {
    await updateTicket(ticket.id, { status: 'qa_blocked', working_branch: nextBranch || null });
    await addComment(ticket.id, ['[auto][qa_blocked]', `詰まり理由: ${reason || '不明'}`, ...questions.map((q) => `- ${q}`)].join('\n'));
    notify(`「${ticket.title}」チケットの実装中に不明点があり実装を中断しました。\nコメントの確認をお願いします。\n${ticketUrl(ticket.id)}`);
    return;
  }

  await updateTicket(ticket.id, { status: 'review', working_branch: nextBranch || null, pr_url: prUrl || null });
  const branchUrl = project?.repo_url ? `${String(project.repo_url).replace(/\/$/, '')}/tree/${nextBranch}` : '(未設定)';
  notify(`実装が完了しました！\n${ticket.title}チケットの実装をレビューお願いします。！\nテストURL：${prUrl || '(未生成)'}\n※ preview未生成の場合: 対象branch：${branchUrl}\n${ticketUrl(ticket.id)}\n\n問題や修正点があれば、コメント記載後に in_progress へ戻してください。`);
}

async function handleDone(ticket, fromStatus) {
  if (ticket.status !== 'done') return;
  if (fromStatus === 'review') {
    const raw = run(`node /Users/uchiunochiu/.openclaw/workspace/dashboard/scripts/done-engine.mjs --ticket-id=${ticket.id}`, { timeoutMs: 120000 });
    const out = extractJson(raw);
    if (!out.ok) throw new Error(out.error || 'done-engine failed');
    notify(`${ticket.title}チケットのクローズを確認しました。\n${out.working_branch || ticket.working_branch || 'main'}ブランチをmainにマージしたので、本番環境を確認してください。`);
    return;
  }
  notify(`${ticket.title}チケットをクローズしました。`);
}

const ACCEPT_EVENT_TYPES = [
  'status_transition',
  'ticket_todo_detected',
  'ticket_spec_review_detected',
  'ticket_in_progress_detected',
  'ticket_in_progress_from_spec_review',
  'ticket_in_progress_from_qa_blocked',
  'ticket_in_progress_from_blocked',
  'ticket_blocked_detected',
  'ticket_qa_blocked_detected',
  'ticket_review_detected',
  'ticket_done_detected',
  'ticket_done_skipped_detected',
];

function inferToStatus(eventType = '') {
  if (eventType === 'ticket_todo_detected') return 'todo';
  if (eventType === 'ticket_spec_review_detected') return 'spec_review';
  if (eventType === 'ticket_in_progress_detected' || eventType === 'ticket_in_progress_from_spec_review' || eventType === 'ticket_in_progress_from_qa_blocked' || eventType === 'ticket_in_progress_from_blocked') return 'in_progress';
  if (eventType === 'ticket_blocked_detected') return 'blocked';
  if (eventType === 'ticket_qa_blocked_detected') return 'qa_blocked';
  if (eventType === 'ticket_review_detected') return 'review';
  if (eventType === 'ticket_done_detected' || eventType === 'ticket_done_skipped_detected') return 'done';
  return '';
}

async function claimOne() {
  const types = ACCEPT_EVENT_TYPES.join(',');
  const rows = await rest(`tachikoma_events?select=id,event_type,raw_payload,handling_status,attempts,created_at&event_type=in.(${types})&handling_status=eq.pending&order=id.asc&limit=1`);
  const row = rows?.[0];
  if (!row) return null;
  const claimed = await rest(`tachikoma_events?id=eq.${row.id}&handling_status=eq.pending`, {
    method: 'PATCH',
    body: { handling_status: 'processing', attempts: Number(row.attempts || 0) + 1 },
  });
  return claimed?.[0] || null;
}

async function markDone(id) {
  await rest(`tachikoma_events?id=eq.${id}`, {
    method: 'PATCH',
    body: { handling_status: 'done', handled_at: new Date().toISOString(), last_error: null },
  });
}

async function markError(id, err) {
  await rest(`tachikoma_events?id=eq.${id}`, {
    method: 'PATCH',
    body: { handling_status: 'error', last_error: String(err || '').slice(0, 800) },
  });
}

async function processOne() {
  const ev = await claimOne();
  if (!ev) return;
  try {
    const p = ev.raw_payload || {};
    const ticketId = p.ticket_id;
    if (!ticketId) throw new Error('missing ticket_id');
    const ticket = await fetchTicket(ticketId);
    if (!ticket) throw new Error('ticket not found');

    const toStatus = String(p.to_status || inferToStatus(ev.event_type) || '').trim();
    const fromStatus = String(p.from_status || '').trim();

    if (toStatus !== ticket.status) {
      await markDone(ev.id); // stale event
      return;
    }

    if (toStatus === 'todo') await handleTodo(ticket, fromStatus);
    else if (toStatus === 'in_progress') await handleInProgress(ticket, fromStatus);
    else if (toStatus === 'done') await handleDone(ticket, fromStatus);

    await markDone(ev.id);
  } catch (e) {
    await markError(ev.id, e?.message || e);
  }
}

async function main() {
  console.log('[status-transition-worker] start');
  while (true) {
    await processOne();
    await new Promise((r) => setTimeout(r, 1200));
  }
}

main().catch((e) => {
  console.error('[status-transition-worker] fatal', e?.message || e);
  process.exit(1);
});
