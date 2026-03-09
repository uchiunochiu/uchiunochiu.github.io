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
      ? buildStatusMessage(payload, "todo", "Todoチケットを検知しました。内容確認に入ります。")
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
