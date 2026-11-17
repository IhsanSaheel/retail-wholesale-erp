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

  const from = new Date(s.openedAt).getTime();
  const to = new Date(s.closedAt).getTime();
  const collections = ["mberp_payments", "mberp_customer_account_credits", "mberp_sales", "mberp_cash_movements"];
  const { data: transactionRecords, error: transactionError } = await db.from("etihad_records")
    .select("collection,record_id,data,branch_ids,updated_by")
    .eq("org_id", orgId).in("collection", collections).limit(5000);
  if (transactionError) return json("Could not prepare the closing PDF transaction detail: " + transactionError.message, 500);
  const records = transactionRecords || [];
  const inSession = (r: any, dateValue: unknown, requireCashier = true) => {
    const time = new Date(String(dateValue || "")).getTime();
    const branch = String(r.data?.branchId || r.branch_ids?.[0] || "");
    return Number.isFinite(time) && time >= from && time <= to && branch === branchId &&
      (!requireCashier || String(r.updated_by || "") === String(s.cashierId || ""));
  };
  const entries: { date: string; type: string; reference: string; detail: string; amount: number }[] = [];
  for (const r of records) {
    const d = r.data || {};
    if (r.collection === "mberp_payments" && inSession(r, d.date)) {
      if (d.type === "sales_return_refund") entries.push({ date: d.date, type: "Sales return refund · " + String(d.method || "—"), reference: d.invoiceNo || r.record_id, detail: d.customerName || d.note || "Sales return", amount: -Number(d.amount || 0) });
      else if (d.type === "staff_tip" && String(d.method || "").toLowerCase() === "cash") entries.push({ date: d.date, type: "Staff tip · Cash", reference: d.receiptNo || d.invoiceNo || r.record_id, detail: d.customerName || "Staff tip", amount: Number(d.amount || 0) });
      else if (d.type === "sale_payment" || (!d.type && String(d.note || "").includes("Bulk customer payment"))) entries.push({ date: d.date, type: (d.type === "sale_payment" ? "Sale payment · " : "Customer balance payment · ") + String(d.method || "—"), reference: d.invoiceNo || r.record_id, detail: d.customerName || "Customer payment", amount: Number(d.amount || 0) });
    }
    if (r.collection === "mberp_customer_account_credits") {
      const date = d.receivedAt || d.date;
      const branch = String(d.branchId || r.branch_ids?.[0] || "");
      const cashierMatch = String(d.receivedBy || r.updated_by || "") === String(s.cashierId || "");
      const time = new Date(String(date || "")).getTime();
      if (branch === branchId && cashierMatch && Number.isFinite(time) && time >= from && time <= to) {
        if (d.type === "overpayment_advance") entries.push({ date, type: "Customer advance · " + String(d.method || "Unknown"), reference: d.invoiceNo || r.record_id, detail: d.customerName || "Customer advance", amount: Number(d.amount || 0) });
        if (d.type === "return_advance") entries.push({ date, type: "Return credit retained · Non-cash", reference: d.invoiceNo || r.record_id, detail: d.customerName || "Customer return credit", amount: Number(d.amount || 0) });
      }
    }
    if (r.collection === "mberp_sales" && inSession(r, d.date || d.createdAt)) {
      const hasPayment = records.some(p => p.collection === "mberp_payments" && p.data?.saleId && String(p.data.saleId) === String(d.id || ""));
      if (!hasPayment && String(d.status || "").toLowerCase() !== "cancelled") {
        const cash = String(d.paymentMethod || "").toLowerCase() === "cash";
        entries.push({ date: d.date || d.createdAt, type: "Sale · " + String(d.paymentMethod || "—"), reference: d.invoiceNo || d.id || r.record_id, detail: d.customerName || "Walk-in Customer", amount: cash ? Math.max(0, Number(d.cashReceived || 0) - Number(d.changeReturned || 0)) : Number(d.cashReceived || 0) });
      }
    }
    if (r.collection === "mberp_cash_movements" && String(d.sessionId || "") === sessionId) {
      entries.push({ date: d.date, type: d.type === "cash_in" ? "Cash in" : "Cash out", reference: d.id || r.record_id, detail: d.note || "—", amount: d.type === "cash_in" ? Number(d.amount || 0) : -Number(d.amount || 0) });
    }
  }
  entries.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
  const expected = Number(s.expectedCash || 0), actual = Number(s.actualCash || 0), variance = Number(s.variance ?? (actual - expected));
  const summaryRows: [string, unknown][] = [
    ["Opening float", s.openingFloat], ["Cash sales", summary.cashSales], ["Cash tips", s.cashTips ?? summary.cashTips],
    ["Customer cash advances", s.cashAdvances ?? summary.cashAdvances], ["Cash refunds", summary.cashRefunds],
    ["Cash in", summary.cashIn], ["Cash out", summary.cashOut], ["Expected cash", expected],
    ["Actual counted cash", actual], ["Variance", variance]
  ];
  const pdfText = (v: unknown) => String(v ?? "—").normalize("NFKD").replace(/[^\x20-\x7E]/g, " ").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const pdfMoney = (v: unknown) => "Rs " + Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });
  const pageLines: string[][] = [];
  let page: string[] = [];
  const pushLine = (line: string) => { page.push(line); if (page.length >= 43) { pageLines.push(page); page = []; } };
  pushLine("ETIHAD TRADERS");
  pushLine("CASH REGISTER CLOSING REPORT");
  pushLine("Branch: " + pdfText(s.branchName || "—") + "    Cashier: " + pdfText(s.cashierName || s.cashierId));
  pushLine("Session: " + pdfText(sessionId));
  pushLine("Opened: " + pdfText(new Date(s.openedAt).toLocaleString("en-PK",{timeZone:"Asia/Karachi",dateStyle:"medium",timeStyle:"short"})) + "    Closed: " + pdfText(new Date(s.closedAt).toLocaleString("en-PK",{timeZone:"Asia/Karachi",dateStyle:"medium",timeStyle:"short"})));
  pushLine("--------------------------------------------------------------------------");
  for (const [label, value] of summaryRows) pushLine(label + ": " + (["Opening float","Cash sales","Cash tips","Customer cash advances","Cash refunds","Cash in","Cash out","Expected cash","Actual counted cash","Variance"].includes(label) ? pdfMoney(value) : pdfText(value)));
  pushLine("--------------------------------------------------------------------------");
  pushLine("TRANSACTION DETAILS (" + entries.length + " records)");
  pushLine("DATE / TIME | TYPE | REFERENCE / DETAILS | AMOUNT");
  pushLine("--------------------------------------------------------------------------");
  if (!entries.length) pushLine("No transactions recorded in this shift.");
  for (const e of entries) {
    const line = new Date(e.date || 0).toLocaleString("en-PK",{timeZone:"Asia/Karachi",dateStyle:"medium",timeStyle:"short"}) + " | " + e.type + " | " + e.reference + " / " + e.detail + " | " + pdfMoney(e.amount);
    const clean = pdfText(line);
    for (let i = 0; i < clean.length; i += 92) pushLine(clean.slice(i, i + 92));
  }
  if (page.length) pageLines.push(page);
  const pdfObjects: string[] = [];
  const addObj = (v: string) => { pdfObjects.push(v); return pdfObjects.length; };
  const catalogId = addObj("");
  const pagesId = addObj("");
  const fontId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (let p = 0; p < pageLines.length; p++) {
    const commands = ["q", "0.08 0.16 0.29 rg", "40 790 515 32 re f", "Q", "BT", "/F1 15 Tf", "1 1 1 rg", "52 801 Td", "(ETIHAD TRADERS) Tj", "ET", "BT", "/F1 9 Tf", "0.08 0.16 0.29 rg", "52 775 Td", "(CASH REGISTER CLOSING REPORT) Tj", "ET"];
    let y = 752;
    for (let i = 0; i < pageLines[p].length; i++) {
      const line = pageLines[p][i];
      const isTitle = i === 0 || i === 1 || line.startsWith("TRANSACTION DETAILS");
      commands.push("BT", isTitle ? "/F1 10 Tf" : "/F1 7 Tf", isTitle ? "0.08 0.16 0.29 rg" : "0.16 0.20 0.26 rg", "52 " + y + " Td", "(" + pdfText(line).slice(0, 110) + ") Tj", "ET");
      y -= isTitle ? 16 : 13;
    }
    commands.push("BT", "/F1 7 Tf", "0.4 0.43 0.48 rg", "52 28 Td", "(Etihad Traders ERP  |  Confidential business record  |  Page " + (p + 1) + " of " + pageLines.length + ") Tj", "ET");
    const stream = commands.join("\n");
    const contentId = addObj("<< /Length " + Buffer.byteLength(stream, "ascii") + " >>\nstream\n" + stream + "\nendstream");
    const pageId = addObj("<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 " + fontId + " 0 R >> >> /Contents " + contentId + " 0 R >>");
    pageIds.push(pageId);
  }
  pdfObjects[catalogId - 1] = "<< /Type /Catalog /Pages " + pagesId + " 0 R >>";
  pdfObjects[pagesId - 1] = "<< /Type /Pages /Kids [" + pageIds.map(id => id + " 0 R").join(" ") + "] /Count " + pageIds.length + " >>";
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < pdfObjects.length; i++) { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += (i + 1) + " 0 obj\n" + pdfObjects[i] + "\nendobj\n"; }
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += "xref\n0 " + (pdfObjects.length + 1) + "\n0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + (pdfObjects.length + 1) + " /Root " + catalogId + " 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  const attachment = Buffer.from(pdf, "ascii");
  const html = "<!doctype html><html><body style=\"font-family:Arial,sans-serif;color:#172033\"><div style=\"max-width:640px;margin:auto;border:1px solid #d8dee8\"><div style=\"background:#172b4d;color:#fff;padding:22px 26px\"><div style=\"color:#d8bd7a;font-size:12px;letter-spacing:2px;font-weight:bold\">ETIHAD TRADERS</div><h2 style=\"margin:8px 0 0\">Cash Register Closing Report</h2></div><div style=\"padding:24px 26px\"><p>The register has been closed and reconciled successfully.</p><p><b>Branch:</b> " + esc(s.branchName) + "<br><b>Cashier:</b> " + esc(s.cashierName || s.cashierId) + "<br><b>Session:</b> " + esc(sessionId) + "</p><table style=\"border-collapse:collapse;width:100%\">" + summaryRows.map(([label,value]) => "<tr><td style=\"padding:8px;border-bottom:1px solid #e5e9ef\">" + esc(label) + "</td><td style=\"padding:8px;border-bottom:1px solid #e5e9ef;text-align:right\"><b>" + esc(pdfMoney(value)) + "</b></td></tr>").join("") + "</table><p style=\"margin-top:22px\">The complete branded, multi-page closing report is attached as a PDF, including all " + entries.length + " transaction records.</p><p style=\"font-size:12px;color:#667085\">Automatically generated by Etihad Traders ERP. This email and attachment do not alter accounting records.</p></div></div></body></html>";

  try {
    const transport = nodemailer.createTransport({ host: process.env.ETIHAD_SMTP_HOST, port: Number(process.env.ETIHAD_SMTP_PORT || 465), secure: process.env.ETIHAD_SMTP_SECURE !== "false", auth: { user: sender, pass: password } });
    const sent = await transport.sendMail({ from: { name: "Etihad Traders ERP", address: sender }, to: recipient, subject: "Cash Register Closing Report — " + String(s.branchName || "Branch") + " — " + sessionId, html, attachments: [{ filename: "Etihad-Traders-Cash-Closing-" + sessionId + ".pdf", content: attachment.toString("base64"), encoding: "base64", contentType: "application/pdf" }] });
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
