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
    ? `https://dashboard-mu-woad-68.vercel.app/ticket-detail.html?ticket_id=${ticketId}`
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
    ? `https://dashboard-mu-woad-68.vercel.app/ticket-detail.html?ticket_id=${ticketId}`
    : "";

  return [
    "[TODO運用命令 / 厳守]",
    "前提: チケットは親プロジェクト完了のための実行タスク。",
    "今回の責務は『設計作成（tickets.design 更新）と少佐への承認依頼DM送信』まで。",
    "",
    "必須確認項目:",
    "- project.goal / project.definition_of_done / project.constraints / project.links",
    "- tickets.title / tickets.description（チケット概要）/ tickets.completion_criteria（完了条件）",
    "- ticket_comments / ticket_attachments",
    "",
    "通常分岐:",
    "- 設計可能なら tickets.design を更新し、Discord DMで次を送信する。",
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
    "- 例外として qa_blocked への変更のみ許可。",
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
    const isReview = eventType === "ticket_review_detected";
    const isComment = eventType === "project_comment_created" || eventType === "ticket_comment_created";

    const message = isTodo
      ? buildTodoOperationPrompt(payload)
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
