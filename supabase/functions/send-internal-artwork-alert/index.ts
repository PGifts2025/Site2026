import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendInternalArtworkAlert } from "../_shared/sendInternalArtworkAlert.ts";

// Internal artwork-uploaded alert endpoint.
//
// Invoked SERVER-SIDE by an AFTER INSERT trigger on order_artwork (via pg_net),
// NOT from the browser. Deploy with `--no-verify-jwt`: pg_net sends no Supabase
// JWT, so this function authenticates the caller itself by comparing a shared
// secret (x-artwork-alert-secret header) against the ARTWORK_ALERT_SECRET Edge
// Function secret. The SAME secret value is stored in Supabase Vault
// (artwork_alert_secret) for the trigger to read and send.
//
// Every return is HTTP 200 JSON so pg_net does not treat it as a delivery
// error to retry. Idempotency + retry live in the helper; a genuine miss is a
// NULL order_artwork.internal_alert_sent_at, found by the miss-detector query.
// A 401 is returned ONLY for a bad/missing secret (a real auth failure).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, reason: "method_not_allowed" });
  }

  // Shared-secret auth (no JWT — this runs --no-verify-jwt).
  const expected = Deno.env.get("ARTWORK_ALERT_SECRET") || "";
  const provided = req.headers.get("x-artwork-alert-secret") || "";
  if (!expected || provided !== expected) {
    console.warn("[send-internal-artwork-alert] rejected: missing/invalid secret");
    return json(401, { ok: false, reason: "unauthorized" });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const artworkId: string = typeof body?.artwork_id === "string" ? body.artwork_id : "";
    if (!artworkId || !UUID_RE.test(artworkId)) {
      console.warn("[send-internal-artwork-alert] invalid artwork_id:", artworkId);
      return json(200, { ok: true, sent: false, reason: "invalid_artwork_id" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const result = await sendInternalArtworkAlert(supabase, artworkId);
    console.log("[send-internal-artwork-alert] result:", JSON.stringify(result));
    return json(200, { ok: true, ...result });
  } catch (err) {
    // The helper never throws; this is a last-resort backstop.
    console.error("[send-internal-artwork-alert] unexpected error:", err);
    return json(200, { ok: true, sent: false, reason: "unexpected_error" });
  }
});
