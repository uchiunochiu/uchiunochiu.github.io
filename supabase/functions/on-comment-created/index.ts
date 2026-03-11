// Supabase Edge Function: on-comment-created
// Stable relay version (rollback-safe)
// Env:
// - OPENCLAW_NOTIFY_URL
// - OPENCLAW_NOTIFY_TOKEN

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildStatusMessage(payload: any, statusLabel: string, header: string) {
  const ticketId = payload?.ticket_id ?? "";
  const ticketNo = payload?.ticket_no ?? "";
  const title = payload?.title ?? "";
  const projectId = payload?.project_id ?? "";
  const ticketUrl = ticketId
    ? `https://uchiunochiu.github.io/ticket-detail.html?ticket_id=${ticketId}`
    : "";

  return [
    header,
    `${ticketNo || ticketId} ${title}`.trim(),
    `project=${projectId}`,
    `status=${statusLabel}`,
    ticketUrl,
  ].filter(Boolean).join("\n");
}

function buildTodoOperationPrompt(payload: any) {
  const ticketId = payload?.ticket_id ?? "";
  const ticketNo = payload?.ticket_no ?? "";
  const title = payload?.title ?? "";
  const projectId = payload?.project_id ?? "";
  const ticketUrl = ticketId
    ? `https://uchiunochiu.github.io/ticket-detail.html?ticket_id=${ticketId}`
    : "";

  return [
    "[TODO運用命令 / 厳守]",
    "前提: チケットは親プロジェクト完了のための実行タスク。",
    "今回の責務は『設計作成（tickets.design 更新）→少佐への承認依頼DM送信→tickets.status を spec_review に更新』まで。",
    "",
    "必須確認項目:",
    "- project.goal / project.definition_of_done / project.constraints / project.links",
    "- tickets.title / tickets.description（チケット概要）/ tickets.completion_criteria（完了条件）",
    "- ticket_comments / ticket_attachments",
    "",
    "通常分岐:",
    "- 設計可能なら tickets.design を更新し、Discord DMで次を送信した後、tickets.status を spec_review に更新する。",
    "  todoチケットの{ticket_no} {title}について、設計のたたき台を作りました。ご確認お願いします。",
    "  ---設計要約---",
    "  ・{要点1}",
    "  ・{要点2}",
    "  ・{要点3}",
    "  -----",
    "  {ticket_url}",
    "",
    "qa_blocked分岐（重要）:",
    "- 情報不足/曖昧/依存未解決で設計確定できない場合、tickets.status を qa_blocked に変更する。",
    "- 質問内容は必ず ticket_comments に記録する。",
    "- Discord DMには『コメントを残した旨』と『チケットURL』のみを通知する。",
    "",
    "禁止事項:",
    "- このフェーズで tickets.specification 更新、実装依頼、in_progress/review/done 変更を行わない。",
    "- 例外として spec_review または qa_blocked への変更のみ許可。",
    "",
    "出力必須:",
    "- current_phase / checked_fields / decision(design_ready or qa_blocked) / execution_result / next_action",
    "",
    "[EVENT DATA]",
    `ticket_id: ${ticketId}`,
    `ticket_no: ${ticketNo}`,
    `title: ${title}`,
    `project_id: ${projectId}`,
    `ticket_url: ${ticketUrl}`,
  ].join("\n");
}

function buildInProgressOperationPrompt(payload: any) {
  const ticketId = payload?.ticket_id ?? "";
  const ticketNo = payload?.ticket_no ?? "";
  const title = payload?.title ?? "";
  const projectId = payload?.project_id ?? "";
  const ticketUrl = ticketId
    ? `https://uchiunochiu.github.io/ticket-detail.html?ticket_id=${ticketId}`
    : "";

  return [
    "[IN_PROGRESS運用命令 / 厳守]",
    "前提: 少佐が spec_review から in_progress へ変更した時点で承認確定。",
    "今回の責務: 仕様確定、Git作業開始、フチコマ実装依頼、進行管理。",
    "",
    "必須実行:",
    "1) tickets.specification を最終確定する（未確定なら先に更新）。",
    "2) working_branch を決定・作成し tickets.working_branch に記録する。",
    "3) フチコマへ実装依頼し、着手確認を取得する。",
    "4) DB変更有無を db_change_check として明示する（あり/なし）。",
    "5) DB変更ありの場合、migrationファイル同梱を必須化する。",
    "",
    "分岐:",
    "- 要件判断待ちは qa_blocked に変更し、質問を ticket_comments に記録。DMへ『コメント記録済み＋ticket_url』通知。",
    "- 権限/API key/環境不足は blocked に変更し、理由を ticket_comments に記録。DMへ『コメント記録済み＋ticket_url』通知。",
    "",
    "完了条件:",
    "- 実装完了＋一次レビューOKで tickets.status を review に変更し、Discord DMでレビュー依頼を送る。",
    "",
    "禁止事項:",
    "- 根拠不明のまま実装を進めない。",
    "",
    "[EVENT DATA]",
    `ticket_id: ${ticketId}`,
    `ticket_no: ${ticketNo}`,
    `title: ${title}`,
    `project_id: ${projectId}`,
    `ticket_url: ${ticketUrl}`,
  ].join("\n");
}


function buildInProgressResumePrompt(payload: any, mode: "spec_review" | "qa_blocked" | "blocked") {
  const ticketId = payload?.ticket_id ?? "";
  const ticketNo = payload?.ticket_no ?? "";
  const title = payload?.title ?? "";
  const ticketUrl = ticketId
    ? `https://uchiunochiu.github.io/ticket-detail.html?ticket_id=${ticketId}`
    : "";

  const modeLine = mode === "spec_review"
    ? "承認確定からの着手です。"
    : mode === "qa_blocked"
      ? "Q&A解消後の再開です。未解消事項を再確認して再開してください。"
      : "実行環境復旧後の再開です。権限/API/環境が回復したことを確認して再開してください。";

  return [
    "[IN_PROGRESS再開命令 / 厳守]",
    modeLine,
    "まず tickets.working_branch / tickets.specification / 依存条件を確認し、フチコマへ実装再開を依頼する。",
    "未解消なら qa_blocked または blocked に戻し、理由を ticket_comments に記録してDM通知する。",
    "実装完了＋一次レビューOKで review へ変更し、DMでレビュー依頼する。",
    "",
    `[EVENT] ticket=${ticketNo || ticketId} ${title}`,
    ticketUrl,
  ].filter(Boolean).join("\n");
}

function buildCommentMessage(payload: any) {
  return String(payload?.body || "").trim() || "(empty comment)";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await req.json().catch(() => null);
    if (!payload) {
      return new Response(JSON.stringify({ ok: false, error: "invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notifyUrl = Deno.env.get("OPENCLAW_NOTIFY_URL") || "";
    const notifyToken = Deno.env.get("OPENCLAW_NOTIFY_TOKEN") || "";

    if (!notifyUrl) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "OPENCLAW_NOTIFY_URL not set" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventType = payload?.type || "unknown";
    const isTodo = eventType === "ticket_todo_detected";
    const isInProgress = eventType === "ticket_in_progress_detected";
    const isInProgressFromSpecReview = eventType === "ticket_in_progress_from_spec_review";
    const isInProgressFromQaBlocked = eventType === "ticket_in_progress_from_qa_blocked";
    const isInProgressFromBlocked = eventType === "ticket_in_progress_from_blocked";
    const isReview = eventType === "ticket_review_detected";
    const isComment = eventType === "project_comment_created" || eventType === "ticket_comment_created";

    const message = isTodo
      ? buildTodoOperationPrompt(payload)
      : isInProgressFromSpecReview
        ? buildInProgressOperationPrompt(payload)
        : isInProgressFromQaBlocked
          ? buildInProgressResumePrompt(payload, "qa_blocked")
          : isInProgressFromBlocked
            ? buildInProgressResumePrompt(payload, "blocked")
            : isInProgress
              ? buildInProgressResumePrompt(payload, "spec_review")
              : isReview
                ? buildStatusMessage(payload, "review", "Reviewチケットを検知しました。レビュー依頼です。")
                : isComment
                  ? buildCommentMessage(payload)
                  : `Dashboard event: ${eventType}`;

    const body = {
      message,
      name: "Dashboard",
      wakeMode: "now",
      deliver: true,
      channel: "discord",
      to: "1466059533578403998",
      agentId: "main",
    };

    const res = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(notifyToken ? { authorization: `Bearer ${notifyToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    return new Response(JSON.stringify({
      ok: res.ok,
      upstreamStatus: res.status,
      upstreamBody: text.slice(0, 500),
    }), {
      status: res.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
