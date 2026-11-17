import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as nodemailer from "nodemailer";

export const runtime = "nodejs";

const json = (message: string, status = 200) => NextResponse.json({ message }, { status });
const esc = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
const money = (value: unknown) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(Number(value || 0));

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json("Authentication required.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return json("Supabase configuration is incomplete.", 500);

  const db = createClient(url, key, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return json("Your login has expired. Sign in again.", 401);

  let body: any;
  try { body = await request.json(); } catch { return json("Invalid report request.", 400); }
  const orgId = String(body?.orgId || "");
  const requestedSession = body?.session || {};
  const summary = body?.summary || {};
  const sessionId = String(requestedSession.id || "");
  if (!orgId || !sessionId) return json("A valid closed register reference is required.", 400);

  // Resolve branch/session details from the saved register record, not the browser payload.
  // This prevents an incomplete client object from creating a branchless delivery log.
  const { data: savedSession, error: sessionLookupError } = await db.from("etihad_records")
    .select("record_id,data,branch_ids")
    .eq("org_id", orgId).eq("collection", "mberp_cash_registers").eq("record_id", sessionId).maybeSingle();
  if (sessionLookupError || !savedSession) return json("Could not verify the saved cash register session: " + (sessionLookupError?.message || "session not found"), 404);
  const s = savedSession.data || {};
  const branchId = String(s.branchId || s.branch_id || savedSession.branch_ids?.[0] || requestedSession.branchId || requestedSession.branch_id || "");
  if (s.status !== "closed" || !s.closedAt) return json("A successfully closed register session is required.", 400);
  if (!branchId) return json("The saved register session has no branch reference; email was not attempted.", 422);
  const { data: savedBranch, error: branchLookupError } = await db.from("etihad_records")
    .select("record_id").eq("org_id", orgId).eq("collection", "mberp_branches").eq("record_id", branchId).maybeSingle();
  if (branchLookupError || !savedBranch) return json("The saved register references a branch that could not be verified; email was not attempted.", 422);

  const { data: membership, error: membershipError } = await db.from("etihad_memberships").select("role,active,branch_ids").eq("org_id", orgId).eq("user_id", auth.user.id).eq("active", true).maybeSingle();
  if (membershipError || !membership) return json("Active business membership required.", 403);
  const role = String(membership.role || "");
  const allowed = ["owner", "manager", "accountant", "cashier"].includes(role);
  const branches = Array.isArray(membership.branch_ids) ? membership.branch_ids.map(String) : [];
  if (!allowed || (role !== "owner" && !branches.includes(branchId)) || (role === "cashier" && String(s.cashierId) !== auth.user.id)) return json("You are not authorised to email this register report.", 403);

  const recipient = process.env.ETIHAD_REPORT_EMAIL;
  const sender = process.env.ETIHAD_SMTP_USER;
  const password = process.env.ETIHAD_SMTP_PASS;
  if (!recipient || !sender || !password || !process.env.ETIHAD_SMTP_HOST) return json("Email settings are incomplete. Ask the owner to check Vercel environment variables.", 503);

  const recordId = "cash-close-email-" + sessionId;
  const { data: prior, error: priorError } = await db.from("etihad_records").select("record_id,data").eq("org_id", orgId).eq("collection", "mberp_email_delivery").eq("record_id", recordId).maybeSingle();
  if (priorError) return json("Could not check the email delivery record: " + priorError.message, 500);
  if (prior?.data?.status === "sent") return json("This closing report was already emailed. Duplicate delivery prevented.");

  const logData = { kind: "cash_register_closing", sessionId, branchId, branchName: String(s.branchName || ""), status: "sending", recipient, updatedAt: new Date().toISOString() };
  if (prior) {
    const { error } = await db.from("etihad_records").update({ data: logData, updated_by: auth.user.id, updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("collection", "mberp_email_delivery").eq("record_id", recordId);
    if (error) return json("Could not prepare the email delivery record: " + error.message, 500);
  } else {
    const { error } = await db.from("etihad_records").insert({ org_id: orgId, collection: "mberp_email_delivery", record_id: recordId, branch_ids: [branchId], updated_by: auth.user.id, data: logData });
    if (error) {
      if (error.code === "23505") return json("A closing report delivery is already being processed. Please wait a moment.");
      return json("Could not create the email delivery record: " + error.message, 500);
    }
  }

  const rows: [string, unknown][] = [
    ["Branch", s.branchName], ["Cashier", s.cashierName || s.cashierId], ["Session reference", sessionId],
    ["Opened", s.openedAt ? new Date(s.openedAt).toLocaleString("en-PK") : "—"], ["Closed", new Date(s.closedAt).toLocaleString("en-PK")],
    ["Opening float", money(s.openingFloat)], ["Cash sales", money(summary.cashSales)], ["Cash tips", money(summary.cashTips)],
    ["Customer cash advances", money(summary.cashAdvances)], ["Cash refunds", money(summary.cashRefunds)],
    ["Cash in", money(summary.cashIn)], ["Cash out", money(summary.cashOut)], ["Expected cash", money(s.expectedCash)],
    ["Actual counted cash", money(s.actualCash)], ["Variance", money(s.variance)]
  ];
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><h2 style="color:#172b4d">Etihad Traders — Cash Register Closing Report</h2><p>Register reconciliation completed successfully.</p><table style="border-collapse:collapse;width:100%;max-width:680px">${rows.map(([label,value]) => `<tr><th style="text-align:left;padding:9px;border:1px solid #dce2ea;background:#f4f6f9">${esc(label)}</th><td style="padding:9px;border:1px solid #dce2ea">${esc(value)}</td></tr>`).join("")}</table><p style="color:#667085;font-size:12px">Automatically generated by Etihad Traders ERP. This email does not alter accounting records.</p></body></html>`;

  try {
    const transport = nodemailer.createTransport({ host: process.env.ETIHAD_SMTP_HOST, port: Number(process.env.ETIHAD_SMTP_PORT || 465), secure: process.env.ETIHAD_SMTP_SECURE !== "false", auth: { user: sender, pass: password } });
    const sent = await transport.sendMail({ from: { name: "Etihad Traders ERP", address: sender }, to: recipient, subject: "Cash Register Closing Report — " + String(s.branchName || "Branch") + " — " + sessionId, html });
    const sentData = { ...logData, status: "sent", sentAt: new Date().toISOString(), messageId: sent.messageId };
    const { error: updateError } = await db.from("etihad_records").update({ data: sentData, updated_by: auth.user.id, updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("collection", "mberp_email_delivery").eq("record_id", recordId);
    if (updateError) return json("Email was sent, but the delivery log could not be updated. Do not resend until checked.", 200);
    return json("Closing report emailed successfully to " + recipient + ".");
  } catch (error) {
    const failure = error instanceof Error ? error.message : "SMTP delivery failed";
    await db.from("etihad_records").update({ data: { ...logData, status: "failed", error: failure.slice(0, 500), failedAt: new Date().toISOString() }, updated_by: auth.user.id, updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("collection", "mberp_email_delivery").eq("record_id", recordId);
    return json("Register closed, but email delivery failed: " + failure, 502);
  }
}
