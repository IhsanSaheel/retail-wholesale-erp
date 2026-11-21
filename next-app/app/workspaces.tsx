"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { listPendingSales, removePendingSale, savePendingSale, updatePendingSale, type PendingSale } from "@/lib/offline-sales";
import { getSupabase } from "@/lib/supabase";

type Row = { collection: string; record_id: string; data: Record<string, any> };
type Product = Record<string, any>;
type Props = { orgId: string; userId: string; cashier?: string; role: string; branchIds: string[]; rows: Row[]; onSaved: () => void };
type POSProps = Props & { initialTab?: "new" | "history" };

const n = (v: any) => Number(v || 0);
const searchText = (v: any) => String(v ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const cash = (v: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(v);
const makeId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 13);
const pakistanDate = (date:Date=new Date()) => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Karachi",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const addPakistanDays = (days:number) => {const [year,month,day]=pakistanDate().split("-").map(Number);const date=new Date(Date.UTC(year,month-1,day+days,12));return date.toISOString().slice(0,10);};
const daysUntilPakistanDate = (value:any) => {const raw=String(value||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;const [y,m,d]=raw.split("-").map(Number);const [ty,tm,td]=pakistanDate().split("-").map(Number);const target=Date.UTC(y,m-1,d),today=Date.UTC(ty,tm-1,td);return Number.isFinite(target)&&Number.isFinite(today)?Math.round((target-today)/86400000):null;};
const esc = (v: any) => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function buildReceiptDocument(data: Record<string, any>) {
  const itemRows = (Array.isArray(data.items) ? data.items : []).map((item: Product) => {
    const qty = n(item.qty);
    const price = n(item.price);
    return `<tr><td class="item-name"><strong>${esc(item.name)}</strong>${item.sku ? `<small>SKU: ${esc(item.sku)}</small>` : ""}<small>${qty} × ${cash(price)}</small></td><td class="r item-total">${cash(qty * price)}</td></tr>`;
  }).join("");
  const totalRows = (Array.isArray(data.rows) ? data.rows : []).map(([label, amount]: [string, any]) =>
    `<tr><td>${esc(label)}</td><td class="r">${cash(n(amount))}</td></tr>`
  ).join("");
  const logoUrl = String(data.logoUrl || `${data.origin || ""}/receipt-logo.svg?v=6`);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(data.invoiceNo || "Sales receipt")}</title>
  <style>
    *{box-sizing:border-box}html{background:#fff}body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#17243a;width:100%;max-width:420px;margin:18px auto;padding:14px}
    .brand{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 auto 5px;text-align:left}.brand img{display:block;width:210px;height:auto;max-height:132px;object-fit:contain;margin:0 auto 4px}.brand strong{display:block;font-size:17px;letter-spacing:1.2px;color:#14243b}.brand span{display:block;font-size:9px;letter-spacing:1.6px;color:#9b7b43;font-weight:700;margin-top:3px}
    .receipt-title{text-align:center;font-size:12px;font-weight:700;letter-spacing:1px;margin:7px 0 3px}.status{margin:8px 0;padding:8px;border:1px solid #d8b66b;background:#fff7e7;color:#75551c;text-align:center;font-size:10px;font-weight:800;letter-spacing:.4px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;font-size:10px;margin:10px 0}.meta div{min-width:0;overflow-wrap:anywhere}.meta b{display:block;color:#687487;font-size:9px;font-weight:600}.meta span{font-weight:700}
    hr{border:0;border-top:1px dashed #9da6b3;margin:10px 0}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #edf0f3;vertical-align:top}.r{text-align:right;white-space:nowrap}.item-name{padding-right:8px}.item-name strong{display:block;font-size:11px}.item-name small{display:block;color:#738095;font-size:9px}.item-total{font-weight:700;font-size:10px}.totals td{font-size:10px}.totals tr:last-child td{font-weight:800;font-size:13px;color:#17243a;border-top:1px solid #aeb7c3;border-bottom:0;padding-top:9px}
    .payment-label{text-align:center;font-size:9px;color:#667387;margin:8px 0}.note{font-size:9px;color:#667387;overflow-wrap:anywhere}.thanks{text-align:center;font-weight:700;font-size:11px;margin:13px 0 3px}.footer{text-align:center;font-size:8px;color:#8b95a4}
    @page{size:80mm auto;margin:3mm}@media print{html,body{width:100%;max-width:none;margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.brand img{width:190px;max-height:118px}.brand strong{font-size:15px}.receipt-title{margin-top:5px}hr{margin:7px 0}td{padding:5px 0}.status{padding:6px}}
  </style></head><body>
  <header class="brand"><img src="${esc(logoUrl)}" alt="Etihad Prime Supplies — Shop, Sell, Grow"></header>
  <div class="receipt-title">${esc(data.title || "SALES RECEIPT")}</div>
  ${data.status ? `<div class="status">${esc(data.status)}</div>` : ""}
  <hr><section class="meta">
    <div><b>INVOICE</b><span>${esc(data.invoiceNo || "—")}</span></div>
    <div><b>DATE &amp; TIME</b><span>${esc(data.date ? new Date(data.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}) : "—")}</span></div>
    <div><b>CUSTOMER</b><span>${esc(data.customerName || "Walk-in Customer")}</span></div>
    <div><b>PHONE</b><span>${esc(data.customerPhone || "—")}</span></div>
    <div><b>BRANCH</b><span>${esc(data.branchName || "—")}</span></div>
    <div><b>CASHIER / LOGIN</b><span>${esc(data.cashier || "—")}</span></div>
  </section><hr>
  <table><tbody>${itemRows || '<tr><td colspan="2">No items</td></tr>'}</tbody></table>
  <hr><table class="totals"><tbody>${totalRows}</tbody></table>
  <p class="payment-label">PAYMENT METHOD: <strong>${esc(data.paymentMethod || "—")}</strong></p>
  ${data.note ? `<p class="note">Note: ${esc(data.note)}</p>` : ""}
  <hr><p class="thanks">Thank you for shopping with us!</p><p class="footer">ETIHAD PRIME SUPPLIES · PLEASE VISIT AGAIN</p>
  <script>window.onload=()=>window.print()<\\/script></body></html>`;
}


export function POSWorkspace({ orgId, userId, cashier, role, branchIds, rows, onSaved, initialTab = "new" }: POSProps) {
  const supabase = useMemo(() => getSupabase(), []);
  const products = rows.filter(r => r.collection === "mberp_products").map(r => r.data).filter(p => p.active !== false);
  const branches = rows.filter(r => r.collection === "mberp_branches").map(r => r.data).filter(b => b.active !== false && (!branchIds.length || branchIds.includes(String(b.id))));
  const sales = rows.filter(r => r.collection === "mberp_sales").map(r => r.data);
  const customerCredits = rows.filter(r => r.collection === "mberp_customer_account_credits");
  const loyaltyConfig=rows.find(r=>r.collection==="mberp_loyalty_settings")?.data||{earnAmount:1,earnPoints:1,redeemPoints:1000,redeemValue:1,enabled:true};
  const [loyaltyRedeemPoints,setLoyaltyRedeemPoints]=useState("0");
  const [cart, setCart] = useState<{ product: Product; qty: number }[]>([]);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [branchId, setBranchId] = useState(branches.find(b => products.some(p => String(p.branchId) === String(b.id) && n(p.qty) > 0))?.id || branches.find(b => products.some(p => String(p.branchId) === String(b.id)))?.id || branches[0]?.id || "");
  const [received, setReceived] = useState("");
  const [useAdvance, setUseAdvance] = useState(false);
  const [method, setMethod] = useState("Cash");
  const taxRates=rows.filter(r=>r.collection==="mberp_product_taxes").map(r=>r.data).filter(t=>t.active!==false);
  const [taxId,setTaxId]=useState("");
  const [resolution, setResolution] = useState("change");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const syncLock = useRef(false);
  const onSavedRef = useRef(onSaved);
  const [tab, setTab] = useState<"new" | "history" | "orders" | "quotes">(initialTab);
  const openOrders=rows.filter(r=>r.collection==="mberp_open_orders").map(r=>r.data).filter(x=>x.status!=="converted"&&x.status!=="cancelled");
  const quotations=rows.filter(r=>r.collection==="mberp_quotations").map(r=>r.data).filter(x=>x.status!=="converted"&&x.status!=="cancelled");
  const [draftBusy,setDraftBusy]=useState(false);
  const [draftTitle,setDraftTitle]=useState("");
  const [expandedSales,setExpandedSales]=useState<Record<string,boolean>>({});
  const [saleActionBusy,setSaleActionBusy]=useState<string>("");
  const [editingSale,setEditingSale]=useState<Product|null>(null);
  async function saveDraft(kind:"order"|"quote"){if(!cart.length){setMessage("Add products before saving.");return;}if(!branchId){setMessage("Choose a branch before saving.");return;}setDraftBusy(true);const id=makeId(),date=new Date().toISOString(),branch=branches.find(b=>String(b.id)===String(branchId));const draftSubtotal=cart.reduce((sum,x)=>sum+n(x.product.price)*x.qty,0);const draftTaxAmount=selectedTax?(selectedTax.type==="inclusive"?draftSubtotal*n(selectedTax.rate)/(100+n(selectedTax.rate)):draftSubtotal*n(selectedTax.rate)/100):0;const draftTotal=selectedTax&&selectedTax.type!=="inclusive"?draftSubtotal+draftTaxAmount:draftSubtotal;const data={id,reference:(kind==="order"?"ORD-":"QUO-")+id.slice(-6).toUpperCase(),date,validUntil:kind==="quote"?addPakistanDays(7):null,branchId:String(branchId),branchName:branch?.name||"",customerName:customerName.trim()||"Walk-in Customer",customerPhone:customerPhone.trim(),title:draftTitle.trim(),items:cart.map(x=>({productId:String(x.product.id),name:x.product.name,sku:x.product.sku||"",qty:x.qty,cost:n(x.product.cost),price:n(x.product.price),unit:x.product.unit||"piece"})),subtotal:draftSubtotal,taxId:selectedTax?.id||null,taxName:selectedTax?.name||"",taxRate:selectedTax?n(selectedTax.rate):0,taxType:selectedTax?.type||null,taxAmount:draftTaxAmount,total:draftTotal,discount:0,notes:note,status:"open",createdBy:userId};const {error}=await supabase.from("etihad_records").insert({org_id:orgId,collection:kind==="order"?"mberp_open_orders":"mberp_quotations",record_id:String(id),branch_ids:[String(branchId)],data,updated_by:userId});setDraftBusy(false);if(error){setMessage("Could not save "+kind+": "+error.message);return;}clearBill();setDraftTitle("");setMessage((kind==="order"?"Open order ":"Quotation ")+data.reference+" saved. Draft totals exclude loyalty redemption.");onSaved();}
  async function resumeOrder(order:any){setBranchId(String(order.branchId));const restored=(order.items||[]).map((it:any)=>{const p=products.find(x=>String(x.id)===String(it.productId));return p?{product:{...p,price:Number.isFinite(Number(it.price))?Number(it.price):n(p.price),cost:Number.isFinite(Number(it.cost))?Number(it.cost):n(p.cost)},qty:n(it.qty)}:null;}).filter(Boolean) as {product:Product;qty:number}[];if(!restored.length){setMessage("No available products from this saved order could be restored.");return;}setCart(restored);setCustomerName(order.customerName||"Walk-in Customer");setCustomerPhone(order.customerPhone||"");setNote(order.notes||"");setTaxId(String(order.taxId||""));setLoyaltyRedeemPoints("0");setTab("new");setMessage("Saved prices and tax settings restored to the bill. Review quantities and stock before checkout.");}
  function printQuotation(quote:any){
    const esc=(v:any)=>String(v??"—").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]||ch));
    const lines=(quote.items||[]).map((it:any,i:number)=>`<tr><td>${i+1}</td><td><b>${esc(it.name)}</b><small>${it.sku?"SKU: "+esc(it.sku):""}</small></td><td>${esc(it.qty)} ${esc(it.unit||"")}</td><td class="num">${cash(n(it.price))}</td><td class="num">${cash(n(it.price)*n(it.qty))}</td></tr>`).join("");
    const w=window.open("","_blank","width=900,height=750");
    if(!w){setMessage("Allow pop-ups to print or save the quotation as PDF.");return;}
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Quotation ${esc(quote.reference)}</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#243247;margin:0}header{display:flex;align-items:center;gap:18px;border-bottom:3px solid #b58a3a;padding-bottom:14px}header img{width:145px;height:62px;object-fit:contain}h1{font-size:24px;margin:0;color:#142c52}header p{margin:5px 0;color:#68758a}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0}.meta section{padding:12px;background:#f5f6f8;border:1px solid #e2e5e9}.meta b{display:block;margin-bottom:5px;color:#142c52}.meta span{display:block;line-height:1.7}table{width:100%;border-collapse:collapse;margin-top:18px}th{background:#142c52;color:#fff;text-align:left;padding:10px}td{border-bottom:1px solid #dfe4eb;padding:10px;vertical-align:top}td small{display:block;color:#778196;margin-top:4px}.num{text-align:right;white-space:nowrap}.total{margin:20px 0 0 auto;width:260px;padding:14px;background:#f5f6f8;border-top:2px solid #b58a3a}.total div{display:flex;justify-content:space-between;padding:5px 0}.total strong{font-size:19px;color:#142c52}.notes{margin-top:24px;padding:12px;border:1px solid #e2e5e9;white-space:pre-wrap}.foot{margin-top:35px;border-top:1px solid #ddd;padding-top:10px;color:#7d8795;font-size:10px;text-align:center}</style></head><body><header><img src="/brand-logo.svg?v=6" alt="Etihad Prime Supplies"><div><h1>QUOTATION</h1><p>Etihad Prime Supplies · General Trading & Wholesale</p></div></header><div class="meta"><section><b>Prepared for</b><span>${esc(quote.customerName)}</span><span>${esc(quote.customerPhone||"No phone recorded")}</span></section><section><b>Quotation details</b><span>Reference: ${esc(quote.reference)}</span><span>Issued: ${esc(quote.date?new Date(quote.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—")}</span><span>Valid until: ${esc(quote.validUntil||"—")}</span><span>Branch: ${esc(quote.branchName||"—")}</span></section></div><table><thead><tr><th>#</th><th>Product / Description</th><th>Qty</th><th class="num">Unit price</th><th class="num">Line total</th></tr></thead><tbody>${lines||'<tr><td colspan="5">No items</td></tr>'}</tbody></table><div class="total"><div><span>Subtotal</span><b>${cash(n(quote.subtotal))}</b></div>${quote.taxName?`<div><span>${esc(quote.taxName)} (${n(quote.taxRate)}% · ${quote.taxType==="inclusive"?"included":"added"})</span><b>${cash(n(quote.taxAmount))}</b></div>`:""}${n(quote.discount)>0?`<div><span>Discount</span><b>−${cash(n(quote.discount))}</b></div>`:""}<div><strong>Quotation total</strong><strong>${cash(n(quote.total))}</strong></div></div>${quote.notes?`<div class="notes"><b>Notes</b><br>${esc(quote.notes)}</div>`:""}<div class="foot">This quotation is valid until the date shown above and is not a tax invoice or proof of payment.</div><script>window.onload=()=>window.print()<\\/script></body></html>`);
    w.document.close();
  }
  function shareQuotation(quote:any){
    const lines=(quote.items||[]).map((it:any)=>"• "+String(it.name||"Item")+" × "+n(it.qty)+" = "+cash(n(it.price)*n(it.qty))).join("\\n");
    const message=["ETIHAD PRIME SUPPLIES — QUOTATION", "Reference: "+(quote.reference||"—"),"Customer: "+(quote.customerName||"—"),"Date: "+(quote.date?new Date(quote.date).toLocaleDateString("en-PK",{timeZone:"Asia/Karachi"}):"—"),"Valid until: "+(quote.validUntil||"—"),"",lines,"","Total: "+cash(n(quote.total)),quote.notes?"Notes: "+quote.notes:""].filter(Boolean).join("\\n");
    const phone=String(quote.customerPhone||"").replace(/[^0-9]/g,"");
    window.open("https://wa.me/"+(phone||"")+"?text="+encodeURIComponent(message),"_blank","noopener,noreferrer");
  }
  async function markDraft(id:string,collection:string,status:string){const entry=rows.find(r=>r.collection===collection&&String(r.data.id)===id);if(!entry)return;const {error}=await supabase.from("etihad_records").update({data:{...entry.data,status,updatedAt:new Date().toISOString()},updated_by:userId}).eq("org_id",orgId).eq("collection",collection).eq("record_id",id);if(error){setMessage(error.message);return;}onSaved();}

  const subtotal = cart.reduce((s, x) => s + n(x.product.price) * x.qty, 0);
  const selectedTax=taxRates.find(t=>String(t.id)===String(taxId));
  const taxRate=selectedTax?Math.max(0,Math.min(100,n(selectedTax.rate))):0;
  const taxAmount=selectedTax?(selectedTax.type==="inclusive"?subtotal*taxRate/(100+taxRate):subtotal*taxRate/100):0;
  const baseTotal=selectedTax&&selectedTax.type!=="inclusive"?subtotal+taxAmount:subtotal;
  const loyaltyCustomerSales=customerPhone.trim()?sales.filter(s=>String(s.customerPhone||"").trim()===customerPhone.trim()&&String(s.status||"").toLowerCase()!=="cancelled"):[];
  const customerLoyaltyPoints=Math.max(0,loyaltyCustomerSales.reduce((sum,s)=>{const original=Math.max(0,n(s.loyaltyEligibleTotal)||n(s.total));const ratio=original>0?Math.min(1,Math.max(0,n(s.total)/original)):1;return sum+Math.floor(n(s.loyaltyPointsEarned)*ratio)-Math.floor(n(s.loyaltyPointsRedeemed)*ratio);},0));
  const redeemRatePoints=Math.max(1,n(loyaltyConfig.redeemPoints)||1000),redeemRateValue=Math.max(0,n(loyaltyConfig.redeemValue)||1);
  const requestedRedeem=Math.max(0,Math.floor(n(loyaltyRedeemPoints)));
  const loyaltyPointsRedeemed=Math.min(customerLoyaltyPoints,requestedRedeem,Math.floor(baseTotal*redeemRatePoints/Math.max(0.01,redeemRateValue)));
  const loyaltyDiscount=loyaltyConfig.enabled!==false?Math.min(baseTotal,loyaltyPointsRedeemed/redeemRatePoints*redeemRateValue):0;
  const total=Math.max(0,baseTotal-loyaltyDiscount);
  const loyaltyFactor=baseTotal>0?total/baseTotal:1;
  const saleSubtotal=subtotal*loyaltyFactor;
  const saleTaxAmount=taxAmount*loyaltyFactor;
  const loyaltyPointsEarned=customerPhone.trim()&&customerName!=="Walk-in Customer"&&loyaltyConfig.enabled!==false&&n(loyaltyConfig.earnAmount)>0?Math.floor(total/Math.max(0.01,n(loyaltyConfig.earnAmount))*Math.max(0,n(loyaltyConfig.earnPoints))):0;
  const customerOutstanding = customerPhone.trim() ? sales.filter(s => String(s.customerPhone || "").trim() === customerPhone.trim() && String(s.status || "").toLowerCase() !== "cancelled").reduce((sum, s) => sum + n(s.balance), 0) : 0;
  const availableAdvance = customerOutstanding > 0 ? 0 : customerCredits.filter(r => String(r.data.customerPhone || "").trim() === customerPhone.trim() && n(r.data.balance) > 0).reduce((sum, r) => sum + n(r.data.balance), 0);
  const advanceUsed = useAdvance ? Math.min(total, availableAdvance) : 0;
  const cashReceived = received === "" ? (method === "Credit" ? 0 : Math.max(0, total - advanceUsed)) : Math.max(0, n(received));
  const receivedAmount = cashReceived + advanceUsed;
  const over = Math.max(0, receivedAmount - total);
  const priorOutstandingApplied = over > 0 && resolution === "advance" ? Math.min(over, customerOutstanding) : 0;
  const applied = Math.min(total, receivedAmount);
  const cashApplied = Math.min(cashReceived, Math.max(0, total - advanceUsed));
  const balance = Math.max(0, total - applied);
  const categories = ["All", ...Array.from(new Set(products.filter(p => String(p.branchId) === String(branchId)).map(p => String(p.category || "Uncategorised").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))];
  const branchProducts = products.filter(p => String(p.branchId) === String(branchId));
  const editAllowance = (productId:string) => editingSale ? (editingSale.items||[]).filter((it:any)=>String(it.productId)===productId).reduce((sum:number,it:any)=>sum+n(it.qty),0) : 0;
  const effectiveStock = (product:Product) => n(product.qty)+editAllowance(String(product.id));
  const matches = branchProducts
    .filter(p => categoryFilter === "All" || String(p.category || "Uncategorised").trim() === categoryFilter)
    // Keep zero and negative-stock products visible for permitted POS sales.
    .filter(p => !searchText(search) || [p.name, p.sku, p.category, p.barcode].some(value => searchText(value).includes(searchText(search))))
    .sort((a,b) => String(a.name).localeCompare(String(b.name)));
  const handleProductSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const term = searchText(search);
    if (!term) return;
    const exact = branchProducts.find(p => [p.sku, p.barcode, p.name].some(value => searchText(value) === term));
    const singleResult = !exact && matches.length === 1 ? matches[0] : null;
    const product = exact || singleResult;
    if (product) {
      add(product);
      setSearch("");
      setMessage(product.name + " added to the bill.");
      requestAnimationFrame(() => searchInput.current?.focus());
    } else if (matches.length > 1) {
      setMessage("More than one product matches. Select the correct product from the results.");
    } else {
      setMessage("No product found. Check the name, SKU or barcode.");
    }
  };
  const savedCustomers=rows.filter(r=>r.collection==="mberp_customers").map(r=>r.data);
  const customerOptions:Array<[string,{name:string;phone:string}]>=[...sales.filter(s=>s.customerName&&s.customerName!=="Walk-in Customer").map(s=>[String(s.customerPhone||s.customerName),{name:String(s.customerName),phone:String(s.customerPhone||"")}] as [string,{name:string;phone:string}]),...savedCustomers.map(c=>[String(c.phone||c.id),{name:String(c.name||""),phone:String(c.phone||"")}] as [string,{name:string;phone:string}])];
  const customers = Array.from(new Map<string,{name:string;phone:string}>(customerOptions).values()).filter(c => (c.name + " " + c.phone).toLowerCase().includes(customerSearch.toLowerCase())).slice(0, 6);
  const recent = [...sales].sort((a,b)=>new Date(b.date||0).getTime()-new Date(a.date||0).getTime()).slice(0,30);
  const add = (p: Product) => setCart(prev => { const found = prev.find(x => x.product.id === p.id); const nextQty = (found?.qty || 0) + 1; setMessage(""); return found ? prev.map(x => x.product.id === p.id ? { ...x, qty: nextQty } : x) : [...prev, { product: p, qty: 1 }]; });
  const changeQty = (id: string, qty: number) => setCart(prev => prev.map(x => x.product.id === id ? { ...x, qty: Math.max(0, qty) } : x).filter(x => x.qty > 0));
  const clearBill = () => {
    setCart([]);
    setReceived("");
    setUseAdvance(false);
    setLoyaltyRedeemPoints("0");
    setResolution("change");
    setNote("");
    setMessage("");
  };

  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  useEffect(() => {
    let active = true;
    const refreshQueue = async () => {
      try {
        const items = await listPendingSales(orgId, userId);
        if (active) setPendingSales(items);
        return items;
      } catch (error) {
        if (active) setMessage("Offline queue could not be opened: " + (error instanceof Error ? error.message : "Storage unavailable"));
        return [];
      }
    };
    const syncQueue = async () => {
      if (!navigator.onLine || syncLock.current) return;
      syncLock.current = true;
      if (active) setSyncing(true);
      let completed = 0;
      try {
        const items = await refreshQueue();
        for (const item of items) {
          if (!active || item.status === "failed") continue;
          const { data, error } = await supabase.rpc("etihad_create_sale", item.rpcArgs);
          if (error || !data?.success) {
            const detail = error?.message || "The server could not confirm this sale.";
            const transient = !error?.code && /fetch|network|timeout|offline|load failed|connection|request failed|temporarily unavailable/i.test(detail);
            await updatePendingSale({ ...item, status: transient ? "pending" : "failed", lastError: detail });
            if (transient) break;
          } else {
            await removePendingSale(item.id);
            completed++;
          }
        }
        const remaining = await refreshQueue();
        if (active && completed > 0) {
          setMessage(completed + " offline sale" + (completed === 1 ? "" : "s") + " synchronised successfully. Stock and payment records are now confirmed in the cloud.");
          onSavedRef.current();
        }
        if (active && remaining.some(x => x.status === "failed")) {
          setMessage("Some saved offline sales need attention. Review the pending-sync list before retrying.");
        }
      } catch (error) {
        if (active) setMessage("Offline sales remain safely stored on this device. Synchronisation will retry when the connection is available.");
      } finally {
        syncLock.current = false;
        if (active) setSyncing(false);
      }
    };
    const handleOnline = () => { setIsOnline(true); void syncQueue(); };
    const handleOffline = () => setIsOnline(false);
    const handleResume = () => { if (document.visibilityState === "visible" && navigator.onLine) void syncQueue(); };
    setIsOnline(navigator.onLine);
    void refreshQueue();
    if (navigator.onLine) void syncQueue();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    return () => { active = false; window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); window.removeEventListener("focus", handleResume); document.removeEventListener("visibilitychange", handleResume); };
  }, [orgId, userId, supabase, syncTrigger]);

  async function retryPendingSales() {
    const items = await listPendingSales(orgId, userId);
    for (const item of items) if (item.status === "failed") await updatePendingSale({ ...item, status: "pending", lastError: undefined });
    setSyncTrigger(value => value + 1);
  }

  function reprintSale(s: Product) {
    const popup = window.open("", "_blank", "width=440,height=760");
    if (!popup) { setMessage("Allow pop-ups to reprint this receipt."); return; }
    const rowsHtml: [string, any][] = [
      ["Subtotal", s.subtotal ?? s.total],
      ["Total bill", s.total],
      ["Amount received (" + (s.paymentMethod || "Payment") + ")", s.cashReceived ?? s.paid],
      ...(n(s.advanceUsed) > 0 ? [["Customer advance applied", s.advanceUsed] as [string, any]] : []),
      ["Applied to invoice", s.paid],
      ...(n(s.priorOutstandingApplied) > 0 ? [["Previous outstanding settled", s.priorOutstandingApplied] as [string, any]] : []),
      ...(n(s.changeReturned) > 0 ? [["Change returned", s.changeReturned] as [string, any]] : []),
      ...(n(s.customerAdvance) > 0 ? [["Customer advance saved", s.customerAdvance] as [string, any]] : []),
      ...(n(s.staffTip) > 0 ? [["Staff tip (not sales)", s.staffTip] as [string, any]] : []),
      ["Balance due", s.balance]
    ];
    popup.document.open();
    popup.document.write(buildReceiptDocument({
      origin: window.location.origin, logoUrl: String(rows.find(r=>r.collection==="mberp_brand_settings"&&r.record_id==="default")?.data?.logoUrl || ""), title: "SALES RECEIPT · REPRINT",
      invoiceNo: s.invoiceNo, date: s.date, customerName: s.customerName,
      customerPhone: s.customerPhone, branchName: s.branchName, cashier: s.cashier || cashier || userId,
      items: s.items, rows: rowsHtml, paymentMethod: s.paymentMethod, note: s.note
    }));
    popup.document.close();
  }

  function beginEditSale(sale:Product) {
    if(role!=="owner"&&role!=="manager") { setMessage("Only an owner or manager can edit a completed sale."); return; }
    if(sale.status==="cancelled") { setMessage("Cancelled invoices cannot be edited."); return; }
    if(rows.some(r=>r.collection==="mberp_sales_returns"&&String(r.data.saleId)===String(sale.id))) { setMessage("This invoice has previous returns. Reconcile returns before editing."); return; }
    const branch=String(sale.branchId||"");
    const restored=(sale.items||[]).map((item:any)=>{
      const product=products.find(p=>String(p.id)===String(item.productId)&&String(p.branchId)===branch);
      return product?{product:{...product,price:n(item.price),cost:n(item.cost)},qty:n(item.qty)}:null;
    }).filter(Boolean) as {product:Product;qty:number}[];
    if(!restored.length||(sale.items||[]).length!==restored.length) { setMessage("One or more original products are no longer available in the catalogue. This invoice cannot be edited safely."); return; }
    setEditingSale(sale);setBranchId(branch);setCart(restored);
    setCustomerName(sale.customerName||"Walk-in Customer");setCustomerPhone(sale.customerPhone||"");
    setTaxId(sale.taxId?String(sale.taxId):"");setMethod(sale.paymentMethod||"Cash");setNote(sale.note||"");
    setReceived("");setUseAdvance(false);setTab("new");
    setMessage("Editing "+(sale.invoiceNo||"invoice")+". Existing payment and customer details are preserved; adjust products or quantities, then save.");
  }

  async function saveEditedSale() {
    if(!editingSale||!cart.length) { setMessage("Add at least one product before saving the edited invoice."); return; }
    const items=cart.map(x=>({productId:String(x.product.id),name:String(x.product.name||""),sku:String(x.product.sku||""),qty:x.qty,cost:n(x.product.cost),price:n(x.product.price),unit:String(x.product.unit||"piece")}));
    const editDiscount=n(editingSale.discount);
    const editTaxRate=n(editingSale.taxRate),editTaxType=String(editingSale.taxType||"none");
    const taxableSubtotal=Math.max(0,subtotal-editDiscount);
    const editTaxAmount=editTaxType==="inclusive"?(editTaxRate>0?taxableSubtotal*editTaxRate/(100+editTaxRate):0):editTaxType==="exclusive"?taxableSubtotal*editTaxRate/100:0;
    const editTotal=editTaxType==="exclusive"?taxableSubtotal+editTaxAmount:taxableSubtotal;
    const expectedRefund=Math.max(0,n(editingSale.paid)-editTotal);
    const confirmText="Save these changes to "+(editingSale.invoiceNo||"this invoice")+"? Stock and batch quantities will be recalculated."+(expectedRefund>0?" Up to "+cash(expectedRefund)+" will be reconciled: any available customer advance is restored first, then the remaining amount is refunded through the original cash payment method.":"");
    if(!window.confirm(confirmText)) return;
    setSaving(true);setMessage("");
    const {data,error}=await supabase.rpc("etihad_edit_sale",{p_org_id:orgId,p_sale_id:String(editingSale.id),p_items:items,p_subtotal:subtotal,p_discount:editDiscount,p_tax_id:String(editingSale.taxId||""),p_tax_name:String(editingSale.taxName||""),p_tax_rate:editTaxRate,p_tax_type:editTaxType,p_tax_amount:editTaxAmount,p_total:editTotal,p_note:String(editingSale.note||"")});
    setSaving(false);
    if(error||!data?.success) { setMessage("Invoice was not changed: "+(error?.message||"The server did not confirm the edit.")); return; }
    setMessage("Invoice "+(data.invoiceNo||editingSale.invoiceNo)+" updated. Stock, batch movements, balance and edit audit were saved."+(n(data.advanceRestored)>0?" Customer advance restored: "+cash(n(data.advanceRestored))+".":"")+(n(data.refundAmount)>0?" Cash refund recorded: "+cash(n(data.refundAmount))+".":""));
    setEditingSale(null);setCart([]);setReceived("");setUseAdvance(false);setTab("history");onSaved();
  }

  function discardSaleEdit() {
    if(!editingSale)return;
    if(!window.confirm("Discard these unsaved invoice changes?"))return;
    setEditingSale(null);setCart([]);setReceived("");setUseAdvance(false);setMessage("Invoice edit discarded. No changes were saved.");
  }

  async function cancelSale(sale: Product) {
    const saleId=String(sale.id||"");
    if(!saleId||saleActionBusy) return;
    if(role!=="owner"&&role!=="manager") { setMessage("Only an owner or manager can cancel a completed sale."); return; }
    const reason=window.prompt("Enter the reason for cancelling invoice "+String(sale.invoiceNo||saleId)+":");
    if(reason===null) return;
    if(reason.trim().length<3) { setMessage("Please enter a cancellation reason of at least 3 characters."); return; }
    if(!window.confirm("Cancel this invoice? Its stock will be restored. The cash-paid portion will be recorded as a refund, while any fully reconciled customer advance will be returned to the customer’s credit balance (not paid out as cash). Invoices with unreconciled advances, later advance usage, previous returns or staff tips will be blocked. Any prior-balance settlement payments will be reversed and refunded separately using their original payment methods. This action cannot be undone.")) return;
    setSaleActionBusy(saleId);setMessage("");
    const {data,error}=await supabase.rpc("etihad_cancel_sale",{p_org_id:orgId,p_sale_id:saleId,p_reason:reason.trim()});
    setSaleActionBusy("");
    if(error||!data?.success) { setMessage("Sale was not cancelled: "+(error?.message||"The server did not confirm the cancellation.")); return; }
    setMessage(data.alreadyCancelled?"This invoice was already cancelled.":"Invoice "+(data.invoiceNo||sale.invoiceNo||saleId)+" cancelled. Stock restored."+(n(data.refundAmount)>0?" Cash refund: "+cash(n(data.refundAmount))+".":"")+(n(data.advanceRestored)>0?" Customer advance returned to credit balance: "+cash(n(data.advanceRestored))+".":""));
    onSaved();
  }

  async function saveSale() {
    if(editingSale) { await saveEditedSale(); return; }
    setMessage("");
    if (!cart.length) { setMessage("Add at least one product to the bill."); return; }
    if (!branchId) { setMessage("Choose a branch before saving this sale."); return; }
    if (received.trim() !== "" && (!Number.isFinite(Number(received)) || Number(received) < 0)) { setMessage("Enter a valid payment amount of zero or more."); return; }
    if (method === "Credit" && cashReceived > 0) { setMessage("For a credit sale, set amount received now to zero. Record any cash payment using Cash or another payment method."); return; }
    if (method === "Credit" && (!customerName.trim() || customerName === "Walk-in Customer" || !customerPhone.trim())) { setMessage("Credit sales require a named customer and phone number so the outstanding balance can be tracked."); return; }
    if (over > 0 && resolution === "advance" && (!customerPhone.trim() || customerName === "Walk-in Customer")) { setMessage("Select a saved customer or enter a customer name and phone to keep an advance."); return; }
    if (advanceUsed > 0 && (!customerPhone.trim() || customerName === "Walk-in Customer")) { setMessage("Select a saved customer before applying an account advance."); return; }
    if (cart.some(x => String(x.product.branchId) !== String(branchId))) {
      setMessage("One or more selected products belong to a different branch. Select the correct branch or transfer stock first.");
      return;
    }
    setSaving(true);
    const receiptWindow = window.open("", "_blank", "width=420,height=700");
    const id = makeId();
    const date = new Date().toISOString();
    const year = pakistanDate().slice(0,4);
    const invoiceNo = `INV-${year}-${id.slice(-6).toUpperCase()}`;
    const branch = branches.find(b => String(b.id) === String(branchId));
    const changeReturned = over > 0 && resolution === "change" ? over : 0;
    const customerAdvance = over > 0 && resolution === "advance" ? Math.max(0, over - priorOutstandingApplied) : 0;
    const staffTip = over > 0 && resolution === "tip" ? over : 0;
    const sale = {
      id, date, invoiceNo, branchId, branchName: branch?.name || "",
      customerName: customerName.trim() || "Walk-in Customer", customerPhone: customerPhone.trim(), cashier: cashier || userId, cashierId: userId,
      items: cart.map(x => {const originalPrice=n(x.product.price),netPrice=originalPrice*loyaltyFactor;return {productId:x.product.id,name:x.product.name,sku:x.product.sku||"",qty:x.qty,cost:n(x.product.cost),price:netPrice,originalPrice,loyaltyDiscountPerUnit:Math.max(0,originalPrice-netPrice),unit:x.product.unit||"piece"};}),
      subtotal:saleSubtotal, originalSubtotal:subtotal, taxId:selectedTax?.id||null, taxName:selectedTax?.name||"", taxRate, taxType:selectedTax?.type||null, taxAmount:saleTaxAmount, originalTaxAmount:taxAmount, total, paid: applied, balance, receivedAmount, cashReceived, advanceUsed,
      priorOutstandingApplied, changeReturned, customerAdvance, staffTip, overpaymentResolution: over ? resolution : "none",
      loyaltyPointsRedeemed, loyaltyDiscount, loyaltyPointsEarned, loyaltyEligibleTotal:total,
      paymentMethod: method, note
    };
    const rpcArgs = {
      p_org_id: orgId,
      p_branch_id: String(branchId),
      p_sale: sale,
      p_cash_applied: cashApplied,
      p_advance_used: advanceUsed,
      p_customer_advance: customerAdvance,
      p_staff_tip: staffTip,
      p_method: method
    };
    const queueSale = async (reason: string) => {
      const pending: PendingSale = { id, orgId, userId, createdAt: date, sale, rpcArgs, status: "pending", lastError: reason };
      await savePendingSale(pending);
      const items = await listPendingSales(orgId, userId);
      setPendingSales(items);
      if (receiptWindow) {
        receiptWindow.document.open();
        receiptWindow.document.write(buildReceiptDocument({
          origin: window.location.origin, logoUrl: String(rows.find(r=>r.collection==="mberp_brand_settings"&&r.record_id==="default")?.data?.logoUrl || ""), title: "OFFLINE SALES SLIP",
          status: "PENDING CLOUD SYNC — NOT A CONFIRMED SALES RECEIPT",
          invoiceNo, date, customerName: sale.customerName, customerPhone: sale.customerPhone,
          branchName: sale.branchName, cashier: cashier || userId, items: sale.items,
          rows: [["Subtotal after loyalty", saleSubtotal], ...(saleTaxAmount>0?[[selectedTax?.name||"Tax",saleTaxAmount] as [string,any]]:[]), ["Total bill", total], ...(loyaltyDiscount>0?[["Loyalty savings (included above)",loyaltyDiscount] as [string,any]]:[]), ["Amount tendered (" + method + ")", cashReceived],
            ...(advanceUsed > 0 ? [["Customer advance applied", advanceUsed] as [string, any]] : []),
            ...(priorOutstandingApplied > 0 ? [["Previous outstanding settled", priorOutstandingApplied] as [string, any]] : []),
            ...(customerAdvance > 0 ? [["Customer advance saved", customerAdvance] as [string, any]] : []),
            ["Balance due", balance]], paymentMethod: method, note
        }));
        receiptWindow.document.close();
      }
      setCart([]); setReceived(""); setUseAdvance(false); setCustomerName("Walk-in Customer"); setCustomerPhone(""); setNote("");
      setMessage("Sale stored securely on this device as PENDING SYNC. It is not yet recorded in cloud stock, sales or accounts. Do not treat the pending slip as a final receipt.");
      setSaving(false);
    };
    if (!navigator.onLine) {
      try { await queueSale("Device is offline"); }
      catch (storageError) { receiptWindow?.close(); setMessage("Sale was not recorded. Offline storage failed: " + (storageError instanceof Error ? storageError.message : "Unknown storage error")); setSaving(false); }
      return;
    }
    let checkout: any = null;
    let error: any = null;
    try {
      const result = await supabase.rpc("etihad_create_sale", rpcArgs);
      checkout = result.data;
      error = result.error;
    } catch (rpcFailure) {
      const detail = rpcFailure instanceof Error ? rpcFailure.message : "The connection was interrupted before the server confirmed checkout.";
      const transient = /fetch|network|timeout|offline|load failed|connection|request failed/i.test(detail);
      if (transient) {
        try { await queueSale(detail); }
        catch (storageError) {
          receiptWindow?.close();
          setMessage("Connection failed and the sale could not be saved locally: " + (storageError instanceof Error ? storageError.message : "Offline storage unavailable"));
          setSaving(false);
        }
      } else {
        receiptWindow?.close();
        setMessage("Sale was not confirmed. No stock change is assumed: " + detail);
        setSaving(false);
      }
      return;
    }
    if (error || !checkout?.success) {
      const detail = error?.message || "Checkout could not be completed.";
      const transient = !error?.code && /fetch|network|timeout|offline|load failed/i.test(detail);
      if (transient) {
        try { await queueSale(detail); }
        catch (storageError) { receiptWindow?.close(); setMessage("Connection failed and the sale could not be saved locally: " + (storageError instanceof Error ? storageError.message : "Offline storage unavailable")); setSaving(false); }
        return;
      }
      receiptWindow?.close();
      setMessage("Sale was not saved and stock was not changed: " + detail);
      setSaving(false);
      return;
    }

    if (receiptWindow) {
      receiptWindow.document.open();
      receiptWindow.document.write(buildReceiptDocument({
        origin: window.location.origin, logoUrl: String(rows.find(r=>r.collection==="mberp_brand_settings"&&r.record_id==="default")?.data?.logoUrl || ""), title: "SALES RECEIPT",
        invoiceNo, date, customerName: sale.customerName, customerPhone: sale.customerPhone,
        branchName: sale.branchName, cashier: cashier || userId, items: sale.items,
        rows: [["Subtotal after loyalty", saleSubtotal], ...(saleTaxAmount>0?[[selectedTax?.name||"Tax",saleTaxAmount] as [string,any]]:[]), ["Total bill", total], ...(loyaltyDiscount>0?[["Loyalty savings (included above)",loyaltyDiscount] as [string,any]]:[]), ["Amount received (" + method + ")", cashReceived],
          ...(advanceUsed > 0 ? [["Customer advance applied", advanceUsed] as [string, any]] : []),
          ["Total tender applied", receivedAmount], ["Applied to invoice", applied],
          ...(priorOutstandingApplied > 0 ? [["Previous outstanding settled", priorOutstandingApplied] as [string, any]] : []),
          ...(changeReturned > 0 ? [["Change returned", changeReturned] as [string, any]] : []),
          ...(customerAdvance > 0 ? [["Customer advance saved", customerAdvance] as [string, any]] : []),
          ...(staffTip > 0 ? [["Staff tip (not sales)", staffTip] as [string, any]] : []),
          ["Balance due", balance]], paymentMethod: method, note
      }));
      receiptWindow.document.close();
    }
    setCart([]); setReceived(""); setUseAdvance(false); setCustomerName("Walk-in Customer"); setCustomerPhone(""); setNote("");
    setMessage("Sale saved successfully. Stock and payment records updated atomically. Receipt opened in a new window.");
    setSaving(false);
    onSaved();
  }

  return <div className="pos-workspace">
    <div className="pos-heading"><div><div className="section-kicker">POINT OF SALE</div><h2>New sale</h2><p>Build a bill, select a customer and settle the payment.</p></div><div className="pos-tabs"><button className={tab==="new"?"selected":""} onClick={()=>setTab("new")}>New sale</button><button className={tab==="history"?"selected":""} onClick={()=>setTab("history")}>Sales history</button><button className={tab==="orders"?"selected":""} onClick={()=>setTab("orders")}>Open orders ({openOrders.length})</button><button className={tab==="quotes"?"selected":""} onClick={()=>setTab("quotes")}>Quotations ({quotations.length})</button></div></div>
    {pendingSales.length>0&&<div className="panel offline-queue-banner"><div><b>{pendingSales.length} sale{pendingSales.length===1?"":"s"} awaiting cloud sync</b><p>{syncing?"Synchronising saved sales…":"These sales are stored on this device and are not yet confirmed in cloud stock or accounts."}</p>{pendingSales.filter(x=>x.status==="failed").map(x=><small key={x.id}>Needs attention: {x.sale.invoiceNo} — {x.lastError}</small>)}</div><div className="offline-queue-actions"><button className="secondary-btn" disabled={syncing||!isOnline} onClick={retryPendingSales}>{syncing?"Syncing…":"Retry sync"}</button></div></div>}
    {message && <div className={message.startsWith("Sale saved")||message.includes("synchronised successfully")?"pos-success":"notice-error"}>{message}</div>}
    {tab==="orders"||tab==="quotes"?<div className="panel data-panel"><div className="panel-head"><div><h3>{tab==="orders"?"Open orders":"Quotations"}</h3><p>{tab==="orders"?"Saved carts can be restored and checked out later.":"Seven-day quotations can be reviewed and converted into a sale by restoring the items."}</p></div></div><div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>CUSTOMER</th><th>DATE</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{(tab==="orders"?openOrders:quotations).map((d:any)=><tr key={d.id}><td><b>{d.reference}</b></td><td>{d.customerName}</td><td>{d.date?new Date(d.date).toLocaleDateString():"—"}</td><td>{(d.items||[]).length}</td><td>{cash(n(d.total))}</td><td>{d.status||"open"}</td><td>{tab==="orders"&&<button className="text-action" onClick={()=>resumeOrder(d)}>Restore to bill</button>}{tab==="quotes"&&<><button className="text-action" onClick={()=>printQuotation(d)}>Print / Save PDF</button><button className="text-action" onClick={()=>shareQuotation(d)}>WhatsApp share</button><button className="text-action" onClick={()=>resumeOrder(d)}>Convert to sale</button></>} <button className="text-action" onClick={()=>markDraft(String(d.id),tab==="orders"?"mberp_open_orders":"mberp_quotations","cancelled")}>Close</button></td></tr>)}{!(tab==="orders"?openOrders:quotations).length&&<tr><td colSpan={7} className="empty-cell">No {tab==="orders"?"open orders":"quotations"} saved.</td></tr>}</tbody></table></div></div>:tab==="history" ? <div className="panel data-panel"><div className="panel-head"><div><h3>Recent invoices</h3><p>Latest sales from the shared Etihad Prime Supplies database</p></div></div><div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th><th>RECEIPT</th><th>ACTIONS</th></tr></thead><tbody>{recent.map((s,i)=>{const key=String(s.id||s.invoiceNo||i),saleStatus=String(s.status||"").toLowerCase(),cancelled=saleStatus==="cancelled",returned=saleStatus==="returned",partiallyReturned=saleStatus==="partially_returned",items=Array.isArray(s.items)?s.items:[];return <><tr key={key} className={cancelled?"cancelled-sale-row":""}><td><b>{s.invoiceNo||"—"}</b><div><button className="text-action" onClick={()=>setExpandedSales(prev=>({...prev,[key]:!prev[key]}))}>{expandedSales[key]?"− Collapse":"＋ Expand"} ({items.length})</button></div></td><td>{s.customerName||"Walk-in"}<small className="history-subline">{s.branchName||"—"}</small></td><td>{s.date?new Date(s.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"}</td><td>{cash(n(s.total))}</td><td>{cash(n(s.paid))}</td><td>{cash(n(s.balance))}</td><td><span className={cancelled?"status cancelled":returned?"status returned":partiallyReturned?"status partially-returned":"status paid"}>{cancelled?"Cancelled":returned?"Returned":partiallyReturned?"Partially returned":"Recorded"}</span><button className="text-action" onClick={()=>reprintSale(s)}>Invoice print</button></td><td>{!cancelled&&(role==="owner"||role==="manager")&&<button className="text-action" disabled={!!saleActionBusy} onClick={()=>beginEditSale(s)}>Edit sale</button>}{!cancelled&&(role==="owner"||role==="manager")&&<button className="text-action danger-action" disabled={saleActionBusy===key||!!saleActionBusy} onClick={()=>cancelSale(s)}>{saleActionBusy===key?"Cancelling…":"Cancel sale"}</button>}{cancelled&&<small>Reason: {s.cancellationReason||"—"}</small>}</td></tr>{expandedSales[key]&&<tr key={key+"-items"} className={cancelled?"cancelled-sale-row":""}><td colSpan={8}><div className="sale-history-details"><div><b>Invoice:</b> {s.invoiceNo||"—"} · <b>Customer:</b> {s.customerName||"Walk-in"} · <b>Branch:</b> {s.branchName||"—"}</div><div><b>Recorded:</b> {s.date?new Date(s.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"} · <b>Discount:</b> {cash(n(s.discount))} · <b>Total:</b> {cash(n(s.total))}</div>{items.map((it:any,j:number)=><div className="sale-history-item" key={j}><span>{cancelled?<del>{n(it.qty)} × {it.name}</del>:<>{n(it.qty)} × {it.name}</>}</span><b>{cash(n(it.price)*n(it.qty))}</b></div>)}{!items.length&&<small>No product line details stored for this invoice.</small>}</div></td></tr>}</>;})}{!recent.length&&<tr><td colSpan={8} className="empty-cell">No sales have been recorded yet.</td></tr>}</tbody></table></div></div> :
    <div className="pos-layout">
      <section className="pos-catalog panel"><div className="pos-catalog-head"><div><h3>Choose products</h3><p>{matches.length} matching products · {branchProducts.length} assigned to this branch</p></div><label className="pos-branch-picker">Branch<select className="pos-branch-select" value={branchId} disabled={!!editingSale} onChange={e=>{setBranchId(e.target.value);setCart([]);setCategoryFilter("All");setReceived("");setUseAdvance(false);setMessage("Branch changed. The bill and payment inputs were cleared to prevent mixing branches.");}}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div><input ref={searchInput} className="pos-search" placeholder="Search product or scan barcode / SKU, then press Enter…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={handleProductSearchKey} autoComplete="off" inputMode="search"/><div className="pos-category-bar">{categories.map(category=><button type="button" key={category} className={categoryFilter===category?"active":""} onClick={()=>setCategoryFilter(category)}>{category}</button>)}<span className="stock-toggle">Negative inventory sales enabled</span></div><div className="pos-products">{matches.map((p,i)=><button className="pos-product" key={p.id||i} onClick={()=>add(p)}><span className="product-initial">{String(p.name||"P").slice(0,1).toUpperCase()}</span><b>{p.name}</b><small>{p.sku||p.category||"Product"} · Stock {effectiveStock(p)}</small><strong>{cash(n(p.price))}</strong><em>{n(p.qty)<0?"Negative stock · Add":n(p.qty)===0?"Zero stock · Add":"+ Add"}</em></button>)}{!matches.length&&<div className="empty-cell">{!branchProducts.length?"No products are assigned to this branch. Choose Barikot or Guratai to view its stock.":"No products match this search. Try another name, SKU or barcode, or enable out-of-stock items."}</div>}</div></section>
      <section className="pos-bill panel"><div className="bill-title"><div><h3>{editingSale?"Edit invoice "+(editingSale.invoiceNo||""):"Current bill"}</h3><p>{cart.reduce((s,x)=>s+x.qty,0)} items in this sale</p></div>{editingSale?<button className="text-action" onClick={discardSaleEdit}>Discard edit</button>:<button className="text-action" onClick={clearBill} disabled={!cart.length&&!received&&!note}>Clear bill</button>}</div>
        <div className="bill-items">{cart.map(({product,qty})=><div className="bill-item" key={product.id}><div className="bill-product"><b>{product.name}</b><small>{cash(n(product.price))} each</small></div><div className="qty-control"><button aria-label={"Decrease "+product.name} onClick={()=>changeQty(product.id,qty-1)} disabled={qty<=1}>−</button><input className="qty-entry" aria-label={"Quantity for "+product.name} type="number" inputMode="decimal" min="0.001" step="any" value={qty} onChange={e=>changeQty(product.id,Number(e.target.value))}/><button aria-label={"Increase "+product.name} onClick={()=>changeQty(product.id,qty+1)}>+</button></div><b className="line-total">{cash(n(product.price)*qty)}</b><button className="remove-item" onClick={()=>changeQty(product.id,0)}>×</button></div>)}{!cart.length&&<div className="bill-empty">Your bill is empty.<br/>Choose a product to get started.</div>}</div>
        <div className="customer-box"><label>Customer</label><input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="Search saved customer by name or phone…"/>{customerSearch&&<div className="customer-results">{customers.map((c,i)=><button key={i} onClick={()=>{setCustomerName(c.name);setCustomerPhone(c.phone);setUseAdvance(false);setLoyaltyRedeemPoints("0");setCustomerSearch("");}}><b>{c.name}</b><small>{c.phone}</small></button>)}</div>}<div className="customer-fields"><input value={customerName} disabled={!!editingSale} onChange={e=>setCustomerName(e.target.value)} placeholder="Customer name"/><input value={customerPhone} disabled={!!editingSale} onChange={e=>setCustomerPhone(e.target.value)} placeholder="Phone number"/></div>{customerPhone.trim()&&loyaltyConfig.enabled!==false&&<div className="purchase-totals"><span>Loyalty balance <b>{customerLoyaltyPoints.toLocaleString()} points</b></span><span>Points earned on this sale <b>{loyaltyPointsEarned.toLocaleString()}</b></span></div>}{customerPhone.trim()&&customerLoyaltyPoints>0&&loyaltyConfig.enabled!==false&&<label>Redeem loyalty points (max {Math.min(customerLoyaltyPoints,Math.floor(baseTotal*redeemRatePoints/Math.max(0.01,redeemRateValue))).toLocaleString()})<input type="number" min="0" step="1" max={customerLoyaltyPoints} value={loyaltyRedeemPoints} onChange={e=>setLoyaltyRedeemPoints(e.target.value)}/><small>Discount: {cash(loyaltyDiscount)} · {redeemRatePoints.toLocaleString()} points = {cash(redeemRateValue)}</small></label>}</div>
                <div className="customer-box"><label>Save current cart as</label><input value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} placeholder="Order / quotation reference note (optional)"/><div className="editor-actions"><button className="outline-btn" disabled={draftBusy||!cart.length} onClick={()=>saveDraft("order")}>{draftBusy?"Saving…":"Save open order"}</button><button className="outline-btn" disabled={draftBusy||!cart.length} onClick={()=>saveDraft("quote")}>Save quotation</button></div></div><div className="bill-summary"><div><span>Subtotal</span><b>{cash(subtotal)}</b></div>{selectedTax&&<div><span>{selectedTax.name} ({taxRate}% · {selectedTax.type==="inclusive"?"included":"added"})</span><b>{cash(taxAmount)}</b></div>}{loyaltyDiscount>0&&<div><span>Loyalty redemption ({loyaltyPointsRedeemed.toLocaleString()} points)</span><b>−{cash(loyaltyDiscount)}</b></div>}<div className="bill-grand"><span>Total bill</span><strong>{cash(total)}</strong></div></div>
        <div className="payment-box">{customerPhone&&availableAdvance>0&&<label className="use-advance"><input type="checkbox" checked={useAdvance} onChange={e=>setUseAdvance(e.target.checked)}/> Use customer advance ({cash(availableAdvance)} available)</label>}<div className="payment-row payment-method-row"><label>Invoice tax<select aria-label="Invoice tax" value={taxId} disabled={!!editingSale} onChange={e=>setTaxId(e.target.value)}><option value="">No tax</option>{taxRates.map(t=><option key={t.id} value={t.id}>{t.name} · {t.rate}% · {t.type==="inclusive"?"Included":"Added"}</option>)}</select></label><label>Payment method<select aria-label="Payment method" value={method} disabled={!!editingSale} onChange={e=>setMethod(e.target.value)}><option>Cash</option><option>Card</option><option>Bank transfer</option><option>Mobile wallet</option><option>Credit</option></select></label></div><label>Amount received now ({method})</label><input type="number" min="0" step="0.01" inputMode="decimal" disabled={!!editingSale} value={received} placeholder={String(Math.max(0,total-advanceUsed))} onChange={e=>setReceived(e.target.value)}/><div className="tender-shortcuts"><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed)))}>Exact due</button><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed+500)))}>＋ Rs 500</button><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed+1000)))}>＋ Rs 1,000</button><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed+2000)))}>＋ Rs 2,000</button><button type="button" onClick={()=>setReceived("0")}>No payment</button><button type="button" onClick={()=>setReceived("")}>Reset</button></div><div className="payment-summary settlement-preview"><span>Cash received <b>{cash(cashReceived)}</b></span><span>Advance applied <b>{cash(advanceUsed)}</b></span><span>Applied to bill <b>{cash(applied)}</b></span><span>Balance due <b>{cash(balance)}</b></span>{over>0&&<span>Extra tender <b>{cash(over)}</b></span>}{priorOutstandingApplied>0&&<span>Previous due settled <b>{cash(priorOutstandingApplied)}</b></span>}{over>priorOutstandingApplied&&<span>New advance saved <b>{cash(over-priorOutstandingApplied)}</b></span>}</div>{over>0&&<div className="overpayment-box"><b>Extra received: {cash(over)}</b><p>Choose how to settle the extra amount:</p><div className="resolution-options"><label><input type="radio" checked={resolution==="change"} onChange={()=>setResolution("change")}/> Return as change</label><label><input type="radio" checked={resolution==="advance"} onChange={()=>setResolution("advance")}/> Save customer advance</label><label><input type="radio" checked={resolution==="tip"} onChange={()=>setResolution("tip")}/> Record staff tip</label></div></div>}<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Sale note (optional)" rows={2}/><button className="primary-btn checkout-btn" disabled={saving||!cart.length} onClick={saveSale}>{saving?(editingSale?"Saving invoice…":"Saving sale…"):(editingSale?"Save invoice changes":"Save sale & print receipt")} <span>→</span></button></div>
      </section>
    </div>}
  </div>;
}

export function ProductManager({ orgId, userId, role, branchIds, rows, onSaved }: Props) {
 const supabase=useMemo(()=>getSupabase(),[]);
 const products=rows.filter(r=>r.collection==="mberp_products").map(r=>r.data);
 const branches=rows.filter(r=>r.collection==="mberp_branches").map(r=>r.data).filter(b=>b.active!==false&&(!branchIds.length||branchIds.includes(String(b.id))));
 const requests=rows.filter(r=>r.collection==="mberp_stock_adjustments").map(r=>r.data).filter(x=>role==="owner"||branchIds.includes(String(x.branchId))).sort((a,b)=>String(b.requestedAt||b.date).localeCompare(String(a.requestedAt||a.date)));
 const canEdit=["owner","manager","stockkeeper"].includes(role);
 const movements=[
 ...rows.filter(r=>r.collection==="mberp_purchases").map(r=>r.data).map(p=>({id:"purchase:"+p.id,type:"Purchase receipt",date:p.createdAt||p.receivedAt||p.date,reference:p.invoiceNo||p.id,productName:p.productName,branchId:p.branchId,branchName:p.branchName,qty:n(p.qty),note:p.supplierName||"Supplier purchase"})),
 ...rows.filter(r=>r.collection==="mberp_sales").flatMap(r=>(r.data.items||[]).map((it:any,i:number)=>({id:"sale:"+r.data.id+":"+i,type:"Sale",date:r.data.createdAt||r.data.date,reference:r.data.invoiceNo||r.data.id,productName:it.name,branchId:r.data.branchId,branchName:r.data.branchName,qty:-n(it.qty),note:r.data.customerName||"Customer sale"}))),
 ...rows.filter(r=>r.collection==="mberp_sales_returns").map(r=>r.data).map(x=>({id:"return:"+x.id,type:"Sales return",date:x.createdAt||x.date,reference:x.invoiceNo||x.saleId,productName:x.productName,branchId:x.branchId,branchName:x.branchName,qty:n(x.qty),note:x.reason||"Returned goods"})),
 ...rows.filter(r=>r.collection==="mberp_transfers").flatMap(r=>[{id:"out:"+r.data.id,type:"Transfer out",date:r.data.date,reference:r.data.transferNo,productName:r.data.productName,branchId:r.data.fromBranchId,branchName:r.data.fromBranchName,qty:-n(r.data.qty),note:r.data.toBranchName},{id:"in:"+r.data.id,type:"Transfer in",date:r.data.date,reference:r.data.transferNo,productName:r.data.productName,branchId:r.data.toBranchId,branchName:r.data.toBranchName,qty:n(r.data.qty),note:r.data.fromBranchName}]),
 ...requests.filter(x=>x.status==="approved").map(x=>({id:"adjust:"+x.id,type:"Approved adjustment",date:x.reviewedAt||x.date,reference:x.requestNo||x.id,productName:x.productName,branchId:x.branchId,branchName:x.branchName,qty:n(x.delta),note:x.reason}))
 ].filter(m=>role==="owner"||branchIds.includes(String(m.branchId))).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 const [editing,setEditing]=useState<Product|null>(null),[editorOpen,setEditorOpen]=useState(false);
 const [name,setName]=useState(""),[sku,setSku]=useState(""),[barcode,setBarcode]=useState(""),[category,setCategory]=useState(""),[qty,setQty]=useState("0"),[cost,setCost]=useState("0"),[price,setPrice]=useState("0"),[alertQty,setAlertQty]=useState("5"),[branchId,setBranchId]=useState(branches[0]?.id||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [adjustProduct,setAdjustProduct]=useState(""),[adjustBatch,setAdjustBatch]=useState(""),[adjustDelta,setAdjustDelta]=useState(""),[adjustReason,setAdjustReason]=useState(""),[adjustBusy,setAdjustBusy]=useState(false),[reviewBusy,setReviewBusy]=useState("");
 const [bulkRows,setBulkRows]=useState<Record<string,string>[]>([]),[bulkName,setBulkName]=useState(""),[bulkError,setBulkError]=useState(""),[bulkBusy,setBulkBusy]=useState(false),[bulkSummary,setBulkSummary]=useState("");
 const [labelSelection,setLabelSelection]=useState<string[]>([]),[labelCopies,setLabelCopies]=useState<Record<string,string>>({});
 const [labelTemplate,setLabelTemplate]=useState("standard"),[labelShowBrand,setLabelShowBrand]=useState(true),[labelShowBranch,setLabelShowBranch]=useState(false),[labelShowName,setLabelShowName]=useState(true),[labelShowPrice,setLabelShowPrice]=useState(true);
 const [historyProduct,setHistoryProduct]=useState("");
 const batches=rows.filter(r=>r.collection==="mberp_stock_batches").map(r=>r.data).filter(b=>role==="owner"||branchIds.includes(String(b.branchId))).sort((a,b)=>String(a.expiryDate||"").localeCompare(String(b.expiryDate||"")));
 const expiryAttention=batches.map((b:any)=>({...b,daysToExpiry:daysUntilPakistanDate(b.expiryDate),available:n(b.remainingQty??b.qty)})).filter((b:any)=>b.available>0&&b.daysToExpiry!==null&&b.daysToExpiry<=30).sort((a:any,b:any)=>a.daysToExpiry-b.daysToExpiry);
 const expiredBatchCount=expiryAttention.filter((b:any)=>b.daysToExpiry<0).length;
 const urgentExpiryCount=expiryAttention.filter((b:any)=>b.daysToExpiry>=0&&b.daysToExpiry<=7).length;
 const upcomingExpiryCount=expiryAttention.filter((b:any)=>b.daysToExpiry>7&&b.daysToExpiry<=30).length;
  const adjustmentBatches=batches.filter(b=>String(b.productId)===adjustProduct&&String(b.status||"active")!=="cancelled");
  const batchReconciliationIssues=products.flatMap((p:any)=>{const tracked=batches.filter(b=>String(b.productId)===String(p.id)&&String(b.branchId)===String(p.branchId)&&String(b.status||"active")!=="cancelled");if(!tracked.length)return[];const batchQty=tracked.reduce((sum:number,b:any)=>sum+n(b.remainingQty??b.qty),0);const productQty=n(p.qty);const difference=productQty-batchQty;return Math.abs(difference)>0.000001?[{id:String(p.id),name:p.name,branchId:p.branchId,productQty,batchQty,difference}]:[];});
 const batchMovements=rows.filter(r=>r.collection==="mberp_stock_batch_movements").map(r=>r.data).filter(m=>role==="owner"||branchIds.includes(String(m.branchId))).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
 const productHistory=historyProduct?[
 ...rows.filter(r=>r.collection==="mberp_sales").flatMap(r=>{const s=r.data;return (s.items||[]).filter((it:any)=>String(it.productId)===historyProduct).map((it:any)=>({date:s.createdAt||s.date,type:"Sale",reference:s.invoiceNo||s.id,customer:s.customerName||"Walk-in Customer",supplier:"",branch:s.branchName||"",product:it.name||products.find(p=>String(p.id)===historyProduct)?.name||"",qty:n(it.qty),detail:"Customer: "+(s.customerPhone||"—")}));}),
 ...rows.filter(r=>r.collection==="mberp_sales_returns").map(r=>r.data).filter(x=>String(x.productId)===historyProduct).map(x=>({date:x.createdAt||x.date,type:"Sales return",reference:x.invoiceNo||x.saleId,customer:x.customerName||"",supplier:"",branch:x.branchName||"",product:x.productName||"",qty:-n(x.qty),detail:x.reason||"Returned goods"})),
 ...rows.filter(r=>r.collection==="mberp_purchases").map(r=>r.data).filter(p=>String(p.productId||"")===historyProduct).map(p=>({date:p.createdAt||p.receivedAt||p.date,type:"Purchase receipt",reference:p.invoiceNo||p.id,customer:"",supplier:p.supplierName||"",branch:p.branchName||"",product:p.productName||"",qty:n(p.qty),detail:"Supplier purchase"})),
 ...rows.filter(r=>r.collection==="mberp_transfers").map(r=>r.data).filter(t=>String(t.productId||"")===historyProduct).flatMap(t=>[{date:t.createdAt||t.date,type:"Transfer out",reference:t.transferNo||t.id,customer:"",supplier:"",branch:t.fromBranchName||"",product:t.productName||"",qty:-n(t.qty),detail:"Transferred to "+(t.toBranchName||"another branch")},{date:t.createdAt||t.date,type:"Transfer in",reference:t.transferNo||t.id,customer:"",supplier:"",branch:t.toBranchName||"",product:t.productName||"",qty:n(t.qty),detail:"Transferred from "+(t.fromBranchName||"another branch")}]),
 ...requests.filter(x=>String(x.productId||"")===historyProduct&&x.status==="approved").map(x=>({date:x.reviewedAt||x.requestedAt||x.createdAt||x.date,type:"Approved stock adjustment",reference:x.requestNo||x.id,customer:"",supplier:"",branch:x.branchName||"",product:x.productName||"",qty:n(x.delta),detail:x.reason||"Approved adjustment"})),
 ...batchMovements.filter(m=>String(m.productId||"")===historyProduct).map(m=>({date:m.createdAt||m.date,type:String(m.type||"Batch movement").replaceAll("_"," "),reference:m.invoiceNo||m.returnId||m.saleId||m.id,customer:"",supplier:"",branch:m.branchName||"",product:m.productName||"",qty:n(m.qty),detail:m.note||m.batchNo||"Batch stock movement"}))
 ].sort((a,b)=>new Date(b.date||0).getTime()-new Date(a.date||0).getTime()):[];
 const [batchProduct,setBatchProduct]=useState(""),[batchCode,setBatchCode]=useState(""),[batchQty,setBatchQty]=useState(""),[batchExpiry,setBatchExpiry]=useState(""),[batchReceived,setBatchReceived]=useState(pakistanDate()),[batchBranch,setBatchBranch]=useState(branches[0]?.id||""),[batchBusy,setBatchBusy]=useState(false);
 const productSuppliers=rows.filter(r=>r.collection==="mberp_product_suppliers").map(r=>r.data);
 const productTaxes=rows.filter(r=>r.collection==="mberp_product_taxes").map(r=>r.data);
 const [supplierProduct,setSupplierProduct]=useState(""),[supplierName,setSupplierName]=useState(""),[supplierCode,setSupplierCode]=useState(""),[supplierCost,setSupplierCost]=useState(""),[supplierLead,setSupplierLead]=useState(""),[supplierBusy,setSupplierBusy]=useState(false);
 const [taxName,setTaxName]=useState(""),[taxRate,setTaxRate]=useState(""),[taxType,setTaxType]=useState("exclusive"),[taxBusy,setTaxBusy]=useState(false);
 const [priceMode,setPriceMode]=useState("percent"),[priceValue,setPriceValue]=useState(""),[priceScope,setPriceScope]=useState("all"),[priceCategory,setPriceCategory]=useState(""),[pricePreview,setPricePreview]=useState<any[]>([]),[priceBusy,setPriceBusy]=useState(false);
 async function addProductSupplier(){const product=products.find(p=>String(p.id)===supplierProduct);if(!product||supplierName.trim().length<2){setError("Select a product and enter a supplier name.");return;}setSupplierBusy(true);const id=makeId();const data={id,productId:String(product.id),productName:product.name,branchId:String(product.branchId||""),supplierName:supplierName.trim(),supplierCode:supplierCode.trim(),cost:supplierCost===""?null:Number(supplierCost),leadDays:supplierLead===""?null:Number(supplierLead),createdAt:new Date().toISOString()};const {error}=await supabase.from("etihad_records").insert({org_id:orgId,collection:"mberp_product_suppliers",record_id:String(id),branch_ids:[String(product.branchId)],data,updated_by:userId});setSupplierBusy(false);if(error){setError(error.message);return;}setSupplierName("");setSupplierCode("");setSupplierCost("");setSupplierLead("");onSaved();}
 async function addProductTax(){const rate=Number(taxRate);if(taxName.trim().length<2||!Number.isFinite(rate)||rate<0||rate>100){setError("Enter a tax name and a rate between 0 and 100.");return;}setTaxBusy(true);const id=makeId();const data={id,name:taxName.trim(),rate,type:taxType,active:true,createdAt:new Date().toISOString()};const {error}=await supabase.from("etihad_records").insert({org_id:orgId,collection:"mberp_product_taxes",record_id:String(id),branch_ids:branches.map(b=>String(b.id)),data,updated_by:userId});setTaxBusy(false);if(error){setError(error.message);return;}setTaxName("");setTaxRate("");onSaved();}
 function previewPriceChange(){const value=Number(priceValue);if(!Number.isFinite(value)||value<=0){setError("Enter a positive price adjustment.");return;}const targets=products.filter(p=>priceScope==="all"||String(p.category||"")===priceCategory);const changes=targets.map(p=>{const old=n(p.price);const next=priceMode==="percent"?old*(1+value/100):old+value;return {id:String(p.id),name:p.name,oldPrice:old,newPrice:Math.max(0,Math.round(next*100)/100),branchId:String(p.branchId)};});if(!changes.length){setError("No products match this adjustment.");return;}setPricePreview(changes);setError("");}
 async function applyPriceChange(){if(!pricePreview.length)return;setPriceBusy(true);setError("");for(const change of pricePreview){const p=products.find(x=>String(x.id)===change.id);if(!p)continue;const data={...p,price:change.newPrice};const {error}=await supabase.from("etihad_records").update({data,updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",change.id);if(error){setError("Price update stopped at "+change.name+": "+error.message+" Earlier products may already have been updated.");setPriceBusy(false);onSaved();return;}}setPriceBusy(false);setPricePreview([]);setPriceValue("");onSaved();}

 async function saveBatch(){setError("");const product=products.find(p=>String(p.id)===batchProduct);const quantity=Number(batchQty);if(!product||!batchBranch||!Number.isFinite(quantity)||quantity<=0||!batchExpiry||!batchReceived){setError("Select a product and branch, enter a positive quantity, and provide received and expiry dates.");return;}if(String(product.branchId)!==String(batchBranch)){setError("The selected product belongs to a different branch. Select a product from the chosen branch.");return;}if(batchExpiry<batchReceived){setError("Expiry date cannot be earlier than the received date.");return;}const alreadyAllocated=batches.filter(b=>String(b.productId)===String(product.id)&&String(b.branchId)===String(batchBranch)&&String(b.status||"active")!=="cancelled").reduce((sum:number,b:any)=>sum+n(b.remainingQty??b.qty),0);const onHand=n(product.qty);if(alreadyAllocated+quantity>onHand+0.000001){setError("Batch allocation would exceed current product stock. Current stock: "+onHand+"; already allocated to batches: "+alreadyAllocated+". Only assign stock that is already on hand; receive new stock through Purchases.");return;}setBatchBusy(true);const id=makeId();const data={id,productId:String(product.id),productName:product.name,sku:product.sku||"",barcode:product.barcode||"",batchNo:batchCode.trim(),qty:quantity,remainingQty:quantity,expiryDate:batchExpiry,receivedDate:batchReceived,branchId:String(batchBranch),branchName:branches.find(b=>String(b.id)===String(batchBranch))?.name||"",status:"active",createdAt:new Date().toISOString()};const {error}=await supabase.from("etihad_records").insert({org_id:orgId,collection:"mberp_stock_batches",record_id:String(id),branch_ids:[String(batchBranch)],data,updated_by:userId});setBatchBusy(false);if(error){setError(error.message);return;}setBatchProduct("");setBatchCode("");setBatchQty("");setBatchExpiry("");onSaved();}

 const code39:Record<string,string>={"0":"nnnwwnwnn","1":"wnnwnnnnw","2":"nnwwnnnnw","3":"wnwwnnnnn","4":"nnnwwnnnw","5":"wnnwwnnnn","6":"nnwwwnnnn","7":"nnnwnnwnw","8":"wnnwnnwnn","9":"nnwwnnwnn","A":"wnnnnwnnw","B":"nnwnnwnnw","C":"wnwnnwnnn","D":"nnnnwwnnw","E":"wnnnwwnnn","F":"nnwnwwnnn","G":"nnnnnwwnw","H":"wnnnnwwnn","I":"nnwnnwwnn","J":"nnnnwwwnn","K":"wnnnnnnww","L":"nnwnnnnww","M":"wnwnnnnwn","N":"nnnnwnnww","O":"wnnnwnnwn","P":"nnwnwnnwn","Q":"nnnnnnwww","R":"wnnnnnwwn","S":"nnwnnnwwn","T":"nnnnwnwwn","U":"wwnnnnnnw","V":"nwwnnnnnw","W":"wwwnnnnnn","X":"nwnnwnnnw","Y":"wwnnwnnnn","Z":"nwwnwnnnn","-":"nwnnnnwnw",".":"wwnnnnwnn"," ":"nwwnnnwnn","$":"nwnwnwnnn","/":"nwnwnnnwn","+":"nwnnnwnwn","%":"nnnwnwnwn","*":"nwnnwnwnn"};
 function barcodeSvg(value:string){const code="*"+value.toUpperCase()+"*";let x=8;const bars:string[]=[];for(const ch of code){const pattern=code39[ch];if(!pattern)throw new Error("Barcode "+value+" contains unsupported Code 39 characters. Use A–Z, 0–9, space, hyphen or . $ / + %.");for(let i=0;i<pattern.length;i++){const w=pattern[i]==="w"?3:1;if(i%2===0)bars.push('<rect x="'+x+'" y="0" width="'+w+'" height="48" fill="#111"/>');x+=w;}x+=1;}return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(x+8)+' 48" role="img" aria-label="Barcode '+value+'"><rect width="100%" height="100%" fill="#fff"/>'+bars.join("")+'</svg>';}
 function printProductLabels(){const selected=products.filter(p=>labelSelection.includes(String(p.id)));if(!selected.length){setError("Select at least one product to print labels.");return;}try{const templates:any={compact:{columns:4,height:"28mm",barcode:"11mm",gap:"3mm"},standard:{columns:3,height:"36mm",barcode:"15mm",gap:"5mm"},wide:{columns:2,height:"44mm",barcode:"19mm",gap:"6mm"}};const layout=templates[labelTemplate]||templates.standard;const labels=selected.flatMap(p=>{const code=String(p.barcode||p.sku||"").trim();if(!code)throw new Error("Add a barcode or SKU to "+p.name+" before printing its label.");const copies=Math.max(1,Math.min(100,Number(labelCopies[String(p.id)]||1)));const svg=barcodeSvg(code);const branch=branches.find(b=>String(b.id)===String(p.branchId));return Array.from({length:copies},()=>'<article class="label">'+(labelShowBrand?'<b class="brand">ETIHAD PRIME SUPPLIES</b>':"")+(labelShowBranch&&branch?'<small class="branch">'+esc(branch.name)+'</small>':"")+(labelShowName?'<b class="name">'+esc(p.name)+'</b>':"")+svg+'<span class="code">'+esc(code)+'</span>'+(labelShowPrice?'<strong>PKR '+n(p.price).toLocaleString("en-PK")+'</strong>':"")+'</article>');});const w=window.open("","_blank","width=900,height=700");if(!w){setError("Allow pop-ups for Etihad Prime Supplies to print labels.");return;}w.document.write('<!doctype html><html><head><title>Etihad Prime Supplies Product Labels</title><style>*{box-sizing:border-box}body{font:12px Arial;margin:8mm;color:#111}.sheet{display:grid;grid-template-columns:repeat('+layout.columns+',1fr);gap:'+layout.gap+'} .label{height:'+layout.height+';border:1px dashed #bbb;padding:3mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;text-align:center;break-inside:avoid}.brand{font-size:9px;letter-spacing:1.2px;color:#9b7b43}.branch{font-size:8px;color:#666}.name{font-size:11px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.label svg{width:95%;height:'+layout.barcode+'} .code{font-size:10px;letter-spacing:1px}.label strong{font-size:11px}@page{size:A4;margin:8mm}@media print{.label{border-color:#ddd}}</style></head><body><main class="sheet">'+labels.join("")+'</main><script>window.onload=()=>window.print()<\\/script></body></html>');w.document.close();}catch(e){setError(e instanceof Error?e.message:"Could not create labels.");}}
 function exportProductHistoryCsv(){if(!historyProduct||!productHistory.length){setError("Select a product with recorded history first.");return;}const headers=["Date & Time","Transaction","Reference","Customer","Supplier","Branch","Product","Quantity","Details"];const rowsOut=productHistory.map(x=>[x.date?new Date(x.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"",x.type,x.reference,x.customer,x.supplier,x.branch,x.product,x.qty,x.detail]);const csv=[headers,...rowsOut].map(row=>row.map(v=>{const raw=String(v??"");const safe=typeof v==="string"&&/^\s*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="Etihad-Traders-Product-History-"+historyProduct+".csv";a.click();URL.revokeObjectURL(url);}
 function printProductHistory(){if(!historyProduct||!productHistory.length){setError("Select a product with recorded history first.");return;}const p=products.find(x=>String(x.id)===historyProduct);const w=window.open("","_blank","width=1100,height=750");if(!w){setError("Allow pop-ups to print product history.");return;}const body=productHistory.map(x=>"<tr><td>"+esc(x.date?new Date(x.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—")+"</td><td>"+esc(x.type)+"</td><td>"+esc(x.reference||"—")+"</td><td>"+esc(x.customer||"—")+"</td><td>"+esc(x.supplier||"—")+"</td><td>"+esc(x.branch||"—")+"</td><td>"+esc(x.qty)+"</td><td>"+esc(x.detail||"—")+"</td></tr>").join("");w.document.write("<!doctype html><html><head><title>Product History</title><style>body{font:12px Arial;margin:18mm;color:#222}h1{font-size:20px}p{color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:7px;text-align:left}th{background:#eee}@page{size:A4 landscape;margin:12mm}</style></head><body><h1>ETIHAD PRIME SUPPLIES · PRODUCT HISTORY</h1><p>"+esc(p?.name||"")+" · SKU "+esc(p?.sku||"—")+" · Barcode "+esc(p?.barcode||"—")+"</p><table><thead><tr><th>Date & Time</th><th>Type</th><th>Reference</th><th>Customer</th><th>Supplier</th><th>Branch</th><th>Qty</th><th>Details</th></tr></thead><tbody>"+body+"</tbody></table><script>window.onload=()=>window.print()<\\/script></body></html>");w.document.close();}
 function parseProductCsv(text:string){
  const lines:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===","&&!quoted){row.push(cell.trim());cell="";}else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&text[i+1]==="\n")i++;row.push(cell.trim());if(row.some(v=>v!==""))lines.push(row);row=[];cell="";}else cell+=c;}
  row.push(cell.trim());if(row.some(v=>v!==""))lines.push(row);
  if(lines.length<2)throw new Error("The CSV must contain a header row and at least one product.");
  const headers=lines[0].map(h=>h.toLowerCase().replace(/[ _-]+/g,""));
  const allowed=["name","sku","barcode","category","branch","cost","price","qty","quantity","alert","lowstockalert"];
  const unknown=headers.filter(h=>!allowed.includes(h));if(unknown.length)throw new Error("Unsupported CSV column(s): "+unknown.join(", "));
  if(!headers.includes("name"))throw new Error("A name column is required.");
  return lines.slice(1).map((cells,i)=>{const item:Record<string,string>={};headers.forEach((h,j)=>item[h]=cells[j]||"");return {...item,__row:String(i+2)};});
 }
 function readBulkFile(file?:File){setBulkError("");setBulkSummary("");if(!file)return;setBulkName(file.name);const reader=new FileReader();reader.onload=()=>{try{setBulkRows(parseProductCsv(String(reader.result||"")));}catch(e){setBulkRows([]);setBulkError(e instanceof Error?e.message:"Could not read this CSV.");}};reader.onerror=()=>setBulkError("Could not read the selected file.");reader.readAsText(file);}
 async function applyBulkImport(){
  setBulkError("");setBulkSummary("");if(!bulkRows.length)return;
  const existing=rows.filter(r=>r.collection==="mberp_products").map(r=>r.data);
  const seen=new Set<string>();const prepared:any[]=[];const issues:string[]=[];
  for(const item of bulkRows){
   const name=String(item.name||"").trim(),skuValue=String(item.sku||"").trim(),barcodeValue=String(item.barcode||"").trim();
   if(!name){issues.push("Row "+item.__row+": product name is required.");continue;}
   const keys=[skuValue&&"sku:"+searchText(skuValue),barcodeValue&&"barcode:"+searchText(barcodeValue)].filter(Boolean) as string[];
   const branchName=String(item.branch||"").trim();
   const explicitBranch=branchName?branches.find(b=>searchText(b.name)===searchText(branchName)):undefined;
   if(branchName&&!explicitBranch){issues.push("Row "+item.__row+": branch '"+branchName+"' is missing or not accessible.");continue;}
   const candidates=existing.filter(p=>(skuValue&&searchText(p.sku)===searchText(skuValue))||(barcodeValue&&searchText(p.barcode)===searchText(barcodeValue)));
   const candidateBranches=Array.from(new Set(candidates.map(p=>String(p.branchId||""))));
   if(!explicitBranch&&candidateBranches.length>1){issues.push("Row "+item.__row+": this SKU or barcode exists in multiple branches. Specify the branch column to avoid updating the wrong product.");continue;}
   const targetBranch=explicitBranch||branches.find(b=>String(b.id)===String(candidateBranches[0]))||branches[0];
   if(!targetBranch){issues.push("Row "+item.__row+": branch is missing or not accessible.");continue;}
   const branchMatch=candidates.filter(p=>String(p.branchId||"")===String(targetBranch.id));
   if(branchMatch.length>1){issues.push("Row "+item.__row+": duplicate matching products already exist in branch "+targetBranch.name+". Resolve the duplicate before importing.");continue;}
   const match=branchMatch[0];
   const branchKeys=keys.map(k=>String(targetBranch.id)+"|"+k);
   if(branchKeys.some(k=>seen.has(k))){issues.push("Row "+item.__row+": duplicate SKU or barcode in this file for branch "+targetBranch.name+".");continue;}branchKeys.forEach(k=>seen.add(k));
   const numeric=(key:string,alt?:string)=>{const raw=item[key]??(alt?item[alt]:"");if(raw==="")return undefined;const v=Number(raw);return Number.isFinite(v)&&v>=0?v:NaN;};
   const costValue=numeric("cost"),priceValue=numeric("price"),alertValue=numeric("alert","lowstockalert"),qtyValue=numeric("qty","quantity");
   if([costValue,priceValue,alertValue,qtyValue].some(v=>Number.isNaN(v))){issues.push("Row "+item.__row+": cost, price, quantity and alert must be non-negative numbers.");continue;}
   const id=match?.id||makeId();
   const data={...(match||{}),id,name,sku:skuValue,barcode:barcodeValue,category:String(item.category||match?.category||"").trim(),branchId:String(targetBranch.id),...(costValue!==undefined?{cost:costValue}:{}),...(priceValue!==undefined?{price:priceValue}:{}),...(alertValue!==undefined?{alert:alertValue,lowAt:alertValue}:{}),...(!match&&qtyValue!==undefined?{qty:qtyValue}:{})};
   prepared.push({id,match,data,branchId:String(targetBranch.id)});
  }
  if(issues.length){setBulkError(issues.slice(0,8).join(" ")+(issues.length>8?" And "+(issues.length-8)+" more issue(s).":""));return;}
  if(!prepared.length){setBulkError("No valid products were found.");return;}
  setBulkBusy(true);
  for(const item of prepared){
   const q=item.match?supabase.from("etihad_records").update({data:item.data,branch_ids:[item.branchId],updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",String(item.id)):supabase.from("etihad_records").insert({org_id:orgId,collection:"mberp_products",record_id:String(item.id),branch_ids:[item.branchId],data:item.data,updated_by:userId});
   const {error}=await q;if(error){setBulkError("Import stopped at "+item.data.name+": "+error.message+" Previously saved rows remain saved; correct the file and retry remaining rows.");setBulkBusy(false);onSaved();return;}
  }
  const updated=prepared.filter(x=>x.match).length,created=prepared.length-updated;
  setBulkSummary("Import complete: "+created+" new products added and "+updated+" existing products updated. Existing stock quantities were not overwritten; quantities in the file were used only for new products.");
  setBulkRows([]);setBulkName("");setBulkBusy(false);onSaved();
 }

 function start(p?:Product){setEditorOpen(true);setEditing(p||null);setName(p?.name||"");setSku(p?.sku||"");setBarcode(p?.barcode||"");setCategory(p?.category||"");setQty(String(p?.qty??0));setCost(String(p?.cost??0));setPrice(String(p?.price??0));setAlertQty(String(p?.alert??p?.lowAt??5));setBranchId(p?.branchId||branches[0]?.id||"");setError("");}
 async function save(){setBusy(true);setError("");const id=editing?.id||makeId();const data={...(editing||{}),id,name:name.trim(),sku:sku.trim(),barcode:barcode.trim(),category:category.trim(),...(editing?{}:{qty:n(qty)}),cost:n(cost),price:n(price),alert:n(alertQty),lowAt:n(alertQty),branchId};const payload={org_id:orgId,collection:"mberp_products",record_id:String(id),branch_ids:[String(branchId)],data,updated_by:userId};const q=editing?supabase.from("etihad_records").update({data,branch_ids:[String(branchId)],updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",String(id)):supabase.from("etihad_records").insert(payload);const {error}=await q;if(error)setError(error.message);else{setEditing(null);setEditorOpen(false);onSaved();}setBusy(false);}
 function exportStockAdjustmentRegister(){const headers=["Request date","Reviewed date","Request reference","Product","Branch","Batch / lot","Delta quantity","Reason","Status","Review note"];const data=requests.map(x=>[x.requestedAt||x.date||"",x.reviewedAt||"",x.requestNo||x.id,x.productName,x.branchName,x.batchNo||"",x.delta,x.reason,x.status||"pending",x.reviewNote||""]);const csv=[headers,...data].map(row=>row.map(v=>{const raw=String(v??"");const safe=typeof v==="string"&&/^\s*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="Etihad-Traders-Stock-Adjustment-Register.csv";a.click();URL.revokeObjectURL(url);}
 function exportBatchExpiryRegister(){const headers=["Status","Product","SKU","Batch","Branch","Received quantity","Available quantity","Received date","Expiry date","Days to expiry"];const data=batches.map(b=>{const days=daysUntilPakistanDate(b.expiryDate);const remaining=n(b.remainingQty??b.qty);const status=remaining<=0?"DEPLETED":days===null?"DATE MISSING":days<0?"EXPIRED":days<=7?"EXPIRES WITHIN 7 DAYS":days<=30?"EXPIRING SOON":"OK";return [status,b.productName,b.sku,b.batchNo,b.branchName,b.qty,remaining,b.receivedDate,b.expiryDate,days??""];});const csv=[headers,...data].map(row=>row.map(v=>{const raw=String(v??"");const safe=typeof v==="string"&&/^\s*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="Etihad-Traders-Batch-Expiry-Register.csv";a.click();URL.revokeObjectURL(url);}
 async function requestAdjustment(){if(!adjustProduct||!Number.isFinite(Number(adjustDelta))||Number(adjustDelta)===0||adjustReason.trim().length<4||(adjustmentBatches.length>0&&!adjustBatch)){setError("Choose a product and batch if batch-tracked, enter a non-zero quantity change and provide a reason.");return;}setAdjustBusy(true);setError("");const {data,error}=await supabase.rpc("etihad_request_stock_adjustment_v2",{p_org_id:orgId,p_product_id:String(adjustProduct),p_delta:Number(adjustDelta),p_reason:adjustReason.trim(),p_request_id:makeId(),p_batch_id:adjustBatch||null});setAdjustBusy(false);if(error||!data?.success){setError(error?.message||"Stock adjustment request was not saved.");return;}setAdjustDelta("");setAdjustReason("");setAdjustBatch("");onSaved();}
 async function reviewAdjustment(id:string,decision:"approved"|"rejected"){setReviewBusy(id);setError("");const {data,error}=await supabase.rpc("etihad_review_stock_adjustment",{p_org_id:orgId,p_request_id:id,p_decision:decision,p_note:""});setReviewBusy("");if(error||!data?.success){setError(error?.message||"Adjustment review failed.");return;}onSaved();}
 return <div className="product-manager">
 <div className="welcome-row"><div><div className="section-kicker">INVENTORY CONTROL</div><h1>Products & stock</h1><p>Manage catalogue details, selling prices and controlled stock adjustments.</p></div>{canEdit&&<button className="primary-btn product-add" onClick={()=>start()}>＋ Add product</button>}</div>{error&&<div className="notice-error">{error}</div>}{batchReconciliationIssues.length>0&&<div className="panel product-editor"><h3>Stock / batch reconciliation warnings</h3><p className="muted">Batch-managed product quantities do not match their lot totals. Batch adjustments are blocked until the physical stock and lot records are reconciled.</p><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>BRANCH</th><th>PRODUCT STOCK</th><th>BATCH STOCK</th><th>DIFFERENCE</th></tr></thead><tbody>{batchReconciliationIssues.map(issue=><tr key={issue.id}><td><b>{issue.name}</b></td><td>{branches.find(b=>String(b.id)===String(issue.branchId))?.name||issue.branchId}</td><td>{n(issue.productQty)}</td><td>{n(issue.batchQty)}</td><td className={issue.difference<0?"negative-value":"warning-value"}>{issue.difference>0?"+":""}{n(issue.difference)}</td></tr>)}</tbody></table></div></div>}
 {canEdit&&<div className="panel product-editor"><div className="panel-head"><div><h3>Bulk product upload & update</h3><p>Import a CSV file to add products or update matching products by SKU or barcode.</p></div></div><p className="muted">CSV columns: name, sku, barcode, category, branch, cost, price, qty, alert. Existing stock quantities are protected; qty is applied only to new products.</p><div className="editor-actions"><label className="outline-btn">Choose CSV file<input type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={e=>readBulkFile(e.target.files?.[0])}/></label>{bulkName&&<span className="muted">{bulkName} · {bulkRows.length} rows</span>}</div>{bulkError&&<div className="notice-error">{bulkError}</div>}{bulkSummary&&<div className="pos-success">{bulkSummary}</div>}{bulkRows.length>0&&<><div className="table-wrap"><table><thead><tr><th>ROW</th><th>PRODUCT</th><th>SKU / BARCODE</th><th>COST</th><th>PRICE</th><th>QTY</th></tr></thead><tbody>{bulkRows.slice(0,8).map((r,i)=><tr key={i}><td>{r.__row}</td><td>{r.name}</td><td>{r.sku||r.barcode||"—"}</td><td>{r.cost||"—"}</td><td>{r.price||"—"}</td><td>{r.qty||r.quantity||"—"}</td></tr>)}</tbody></table></div><p className="muted">Previewing first {Math.min(8,bulkRows.length)} of {bulkRows.length} rows. The entire file is validated before any changes are saved.</p><button className="primary-btn" disabled={bulkBusy} onClick={applyBulkImport}>{bulkBusy?"Importing…":"Validate & import "+bulkRows.length+" products"}</button></>}</div>}
 <div className="panel product-editor"><div className="panel-head"><div><h3>Barcode label design</h3><p>Choose a label layout and optional branding before printing selected products.</p></div></div><div className="product-form-grid"><label>Label template<select value={labelTemplate} onChange={e=>setLabelTemplate(e.target.value)}><option value="compact">Compact · 4 columns</option><option value="standard">Standard · 3 columns</option><option value="wide">Wide · 2 columns</option></select></label><label>Company branding<input type="checkbox" checked={labelShowBrand} onChange={e=>setLabelShowBrand(e.target.checked)}/></label><label>Branch name<input type="checkbox" checked={labelShowBranch} onChange={e=>setLabelShowBranch(e.target.checked)}/></label><label>Product name<input type="checkbox" checked={labelShowName} onChange={e=>setLabelShowName(e.target.checked)}/></label><label>Selling price<input type="checkbox" checked={labelShowPrice} onChange={e=>setLabelShowPrice(e.target.checked)}/></label></div></div>
 <div className="panel data-panel"><div className="panel-head"><div><h3>Product catalogue</h3><p>{products.length} items · quantities are changed through stock transactions or approved adjustments.</p></div>{canEdit&&<button className="outline-btn" disabled={!labelSelection.length} onClick={printProductLabels}>Print barcode labels ({labelSelection.length})</button>}</div><div className="table-wrap"><table><thead><tr><th><input aria-label="Select all products for labels" type="checkbox" checked={products.length>0&&labelSelection.length===products.length} onChange={e=>setLabelSelection(e.target.checked?products.map(p=>String(p.id)):[])}/></th><th>PRODUCT</th><th>SKU / BARCODE</th><th>LABEL COPIES</th><th>CATEGORY</th><th>BRANCH</th><th>STOCK</th><th>COST</th><th>SELLING PRICE</th><th></th></tr></thead><tbody>{products.map((p,i)=><tr key={p.id||i}><td><input aria-label={"Select "+p.name+" for label printing"} type="checkbox" checked={labelSelection.includes(String(p.id))} onChange={e=>setLabelSelection(current=>e.target.checked?[...current,String(p.id)]:current.filter(id=>id!==String(p.id)))}/></td><td><b>{p.name}</b></td><td>{p.sku||"—"}{p.barcode&&<small className="table-subline">{p.barcode}</small>}</td><td><input aria-label={"Label copies for "+p.name} type="number" min="1" max="100" value={labelCopies[String(p.id)]||"1"} onChange={e=>setLabelCopies(current=>({...current,[String(p.id)]:e.target.value}))} style={{width:64}}/></td><td>{p.category||"—"}</td><td>{branches.find(b=>String(b.id)===String(p.branchId))?.name||"—"}</td><td>{n(p.qty)}</td><td>{cash(n(p.cost))}</td><td>{cash(n(p.price))}</td><td>{canEdit&&<button className="text-action" onClick={()=>start(p)}>Edit</button>}</td></tr>)}</tbody></table></div></div>
 {canEdit&&<div className="panel product-editor"><h3>Request stock adjustment</h3><p className="muted">Positive quantity adds stock; negative quantity reduces it. Stock changes only after owner approval.</p><div className="product-form-grid"><label>Product<select value={adjustProduct} onChange={e=>{setAdjustProduct(e.target.value);setAdjustBatch("");}}><option value="">Select product</option>{products.filter(p=>role==="owner"||branchIds.includes(String(p.branchId))).map(p=><option key={p.id} value={p.id}>{p.name} · Current {n(p.qty)}</option>)}</select></label>{adjustmentBatches.length>0&&<label>Batch / lot<select value={adjustBatch} onChange={e=>setAdjustBatch(e.target.value)}><option value="">Select affected batch</option>{adjustmentBatches.map((b:any)=><option key={b.id} value={b.id}>{b.batchNo||b.id} · Available {n(b.remainingQty??b.qty)} · Expiry {b.expiryDate||"Not recorded"}</option>)}</select><small>Batch quantities must reconcile with product stock before approval.</small></label>}<label>Quantity change (+ / −)<input type="number" step="any" value={adjustDelta} onChange={e=>setAdjustDelta(e.target.value)} placeholder="e.g. 5 or -2"/></label><label>Reason<input value={adjustReason} onChange={e=>setAdjustReason(e.target.value)} placeholder="Damage, count correction…"/></label></div><button className="primary-btn" disabled={adjustBusy||!adjustProduct||!adjustDelta||adjustReason.trim().length<4||(adjustmentBatches.length>0&&!adjustBatch)} onClick={requestAdjustment}>{adjustBusy?"Submitting…":"Submit for owner approval"}</button></div>}
 <div className="panel data-panel"><div className="panel-head"><div><h3>Stock adjustment register</h3><p>Requester, reviewer, reason and before/after quantities are retained.</p></div><div className="editor-actions"><button className="outline-btn" onClick={exportStockAdjustmentRegister}>Export register CSV</button><span className="record-count">{requests.length} requests</span></div></div><div className="table-wrap"><table><thead><tr><th>DATE / REF</th><th>PRODUCT / BRANCH</th><th>CHANGE</th><th>REASON</th><th>STATUS</th><th>REVIEW</th></tr></thead><tbody>{requests.map((x:any)=><tr key={x.id}><td><b>{x.requestNo||x.id}</b><small className="table-subline">{x.requestedAt?new Date(x.requestedAt).toLocaleString():"—"}</small></td><td>{x.productName}<small className="table-subline">{x.branchName||"—"}{x.batchNo?" · Batch "+x.batchNo:""}</small></td><td className={n(x.delta)<0?"negative-value":"positive-value"}>{n(x.delta)>0?"+":""}{n(x.delta)}</td><td>{x.reason}</td><td><b>{String(x.status||"pending").toUpperCase()}</b><small className="table-subline">{x.reviewedAt?new Date(x.reviewedAt).toLocaleString():""}</small></td><td>{role==="owner"&&x.status==="pending"?<><button className="text-action" disabled={reviewBusy===x.id} onClick={()=>reviewAdjustment(String(x.id),"approved")}>Approve</button> <button className="text-action" disabled={reviewBusy===x.id} onClick={()=>reviewAdjustment(String(x.id),"rejected")}>Reject</button></>:x.reviewNote||"—"}</td></tr>)}{!requests.length&&<tr><td colSpan={6} className="empty-cell">No stock adjustment requests.</td></tr>}</tbody></table></div></div>
 <div className="panel product-editor"><div className="panel-head"><div><h3>Batch & expiry date control</h3><p>Assign existing on-hand stock to batches and monitor approaching expiry. New stock must be received through Purchases.</p></div><div className="editor-actions"><button className="outline-btn" onClick={exportBatchExpiryRegister}>Export batch / expiry CSV</button><span className="record-count">{batches.length} batches</span></div></div>{canEdit&&<><div className="product-form-grid"><label>Product<select value={batchProduct} onChange={e=>setBatchProduct(e.target.value)}><option value="">Select product</option>{products.filter(p=>role==="owner"||branchIds.includes(String(p.branchId))).map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku||"No SKU"}</option>)}</select></label><label>Batch / lot number<input value={batchCode} onChange={e=>setBatchCode(e.target.value)} placeholder="Optional batch reference"/></label><label>Existing stock assigned<input type="number" min="0.001" step="any" value={batchQty} onChange={e=>setBatchQty(e.target.value)}/></label><label>Branch<select value={batchBranch} onChange={e=>setBatchBranch(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Received date<input type="date" value={batchReceived} onChange={e=>setBatchReceived(e.target.value)}/></label><label>Expiry date<input type="date" value={batchExpiry} onChange={e=>setBatchExpiry(e.target.value)}/></label></div><button className="primary-btn" disabled={batchBusy||!batchProduct||!batchQty||!batchExpiry} onClick={saveBatch}>{batchBusy?"Saving batch…":"Save batch & expiry record"}</button></>}<div className="summary-grid" style={{margin:"12px 0"}}><div className="summary-card"><span>Expired stock</span><strong className="negative-value">{expiredBatchCount}</strong></div><div className="summary-card"><span>Expires within 7 days</span><strong className="negative-value">{urgentExpiryCount}</strong></div><div className="summary-card"><span>Expires in 8–30 days</span><strong className="warning-value">{upcomingExpiryCount}</strong></div></div>{expiryAttention.length>0&&<div className="notice-error" role="alert"><b>Expiry attention required:</b> {expiredBatchCount} expired batch(es), {urgentExpiryCount} batch(es) expiring within 7 days and {upcomingExpiryCount} batch(es) expiring within 8–30 days. Review available quantities before selling or replenishing these products.</div>}{expiryAttention.length===0&&<p className="muted">No active batches are expired or due to expire within the next 30 days.</p>}<div className="table-wrap"><table><thead><tr><th>STATUS</th><th>PRODUCT / SKU</th><th>BATCH</th><th>BRANCH</th><th>RECEIVED QTY</th><th>AVAILABLE QTY</th><th>RECEIVED</th><th>EXPIRY DATE</th></tr></thead><tbody>{batches.map((b:any)=>{const days=daysUntilPakistanDate(b.expiryDate);const remaining=n(b.remainingQty??b.qty);const status=remaining<=0?"DEPLETED":days===null?"DATE MISSING":days<0?"EXPIRED":days<=7?"EXPIRES WITHIN 7 DAYS":days<=30?"EXPIRING SOON":"OK";return <tr key={b.id}><td><b className={status==="EXPIRED"?"negative-value":status==="EXPIRES WITHIN 7 DAYS"?"negative-value":status==="EXPIRING SOON"?"warning-value":status==="DEPLETED"?"muted-value":"positive-value"}>{status}</b></td><td><b>{b.productName}</b><small className="table-subline">{b.sku||"—"}</small></td><td>{b.batchNo||"—"}</td><td>{b.branchName||"—"}</td><td>{n(b.qty)}</td><td><b>{remaining}</b></td><td>{b.receivedDate||"—"}</td><td>{b.expiryDate}{days!==null&&days>=0&&remaining>0&&<small className="table-subline">{days} days remaining</small>}{days===null&&<small className="table-subline">Expiry date needs review</small>}</td></tr>})}{!batches.length&&<tr><td colSpan={8} className="empty-cell">No batch or expiry records yet. Add a batch above to begin tracking.</td></tr>}</tbody></table></div><p className="muted">Tracked batches are deducted automatically during checkout using earliest-expiry-first allocation. Expired batches are excluded from sale availability. New returns restore quantities to their original sale batches when allocation history exists. Older sales without batch history are listed as unallocated returns and require inspection before manual batch assignment.</p><div className="panel-head" style={{marginTop:18}}><div><h3>Batch movement history</h3><p>Auditable batch receipts, FEFO sale deductions, original-batch returns and unallocated historical returns.</p></div><span className="record-count">{batchMovements.length} movements</span></div><div className="table-wrap"><table><thead><tr><th>DATE</th><th>MOVEMENT</th><th>PRODUCT</th><th>BATCH</th><th>BRANCH</th><th>REFERENCE</th><th>QTY</th><th>DETAIL</th></tr></thead><tbody>{batchMovements.map((m:any)=><tr key={m.id}><td>{m.date?new Date(m.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"}</td><td><b>{m.type==="sale_deduction"?"Sale deduction":m.type==="sale_return_restoration"?"Return to original batch":m.type==="unallocated_return"?"Unallocated return":String(m.type||"Movement").replaceAll("_"," ")}</b></td><td>{m.productName||"—"}</td><td>{m.batchNo||"—"}</td><td>{m.branchName||"—"}</td><td>{m.invoiceNo||m.returnId||m.saleId||"—"}</td><td className={n(m.qty)<0?"negative-value":"positive-value"}>{n(m.qty).toLocaleString("en-PK")}</td><td>{m.note||"—"}</td></tr>)}{!batchMovements.length&&<tr><td colSpan={8} className="empty-cell">No batch movements have been recorded yet. New batch-tracked sales and returns will appear here.</td></tr>}</tbody></table></div></div>
 {canEdit&&<div className="panel product-editor"><div className="panel-head"><div><h3>Product suppliers</h3><p>Link supplier references, supplier product codes, purchase costs and lead times to catalogue items.</p></div><span className="record-count">{productSuppliers.length} links</span></div><div className="product-form-grid"><label>Product<select value={supplierProduct} onChange={e=>setSupplierProduct(e.target.value)}><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Supplier name<input value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="Supplier / vendor"/></label><label>Supplier item code<input value={supplierCode} onChange={e=>setSupplierCode(e.target.value)}/></label><label>Supplier cost<input type="number" min="0" value={supplierCost} onChange={e=>setSupplierCost(e.target.value)}/></label><label>Lead time (days)<input type="number" min="0" value={supplierLead} onChange={e=>setSupplierLead(e.target.value)}/></label></div><button className="primary-btn" disabled={supplierBusy||!supplierProduct||!supplierName.trim()} onClick={addProductSupplier}>{supplierBusy?"Saving…":"Link supplier to product"}</button><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SUPPLIER</th><th>SUPPLIER CODE</th><th>COST</th><th>LEAD TIME</th></tr></thead><tbody>{productSuppliers.map((x:any)=><tr key={x.id}><td>{x.productName}</td><td>{x.supplierName}</td><td>{x.supplierCode||"—"}</td><td>{x.cost==null?"—":cash(n(x.cost))}</td><td>{x.leadDays==null?"—":x.leadDays+" days"}</td></tr>)}{!productSuppliers.length&&<tr><td colSpan={5} className="empty-cell">No product-supplier links recorded.</td></tr>}</tbody></table></div></div>}
 {canEdit&&<div className="panel product-editor"><div className="panel-head"><div><h3>Product taxes</h3><p>Maintain reusable tax rates for product and invoice workflows.</p></div><span className="record-count">{productTaxes.length} rates</span></div><div className="product-form-grid"><label>Tax name<input value={taxName} onChange={e=>setTaxName(e.target.value)} placeholder="e.g. Sales Tax"/></label><label>Rate (%)<input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={e=>setTaxRate(e.target.value)}/></label><label>Calculation<select value={taxType} onChange={e=>setTaxType(e.target.value)}><option value="exclusive">Added to price</option><option value="inclusive">Included in price</option></select></label></div><button className="primary-btn" disabled={taxBusy||!taxName.trim()||taxRate===""} onClick={addProductTax}>{taxBusy?"Saving…":"Add tax rate"}</button><div className="table-wrap"><table><thead><tr><th>TAX</th><th>RATE</th><th>CALCULATION</th><th>STATUS</th></tr></thead><tbody>{productTaxes.map((x:any)=><tr key={x.id}><td>{x.name}</td><td>{x.rate}%</td><td>{x.type==="inclusive"?"Included":"Added"}</td><td>{x.active===false?"Inactive":"Active"}</td></tr>)}{!productTaxes.length&&<tr><td colSpan={4} className="empty-cell">No tax rates configured.</td></tr>}</tbody></table></div><p className="muted">Tax rates are stored as configuration records. Automatic tax calculation on invoices and purchases is a separate integration step.</p></div>}
 {canEdit&&<div className="panel product-editor"><div className="panel-head"><div><h3>Price readjustment</h3><p>Preview a category-wide or catalogue-wide price change before applying it.</p></div></div><div className="product-form-grid"><label>Adjustment type<select value={priceMode} onChange={e=>{setPriceMode(e.target.value);setPricePreview([]);}}><option value="percent">Percentage increase</option><option value="fixed">Fixed PKR increase</option></select></label><label>{priceMode==="percent"?"Increase (%)":"Increase (PKR)"}<input type="number" min="0.01" step="any" value={priceValue} onChange={e=>{setPriceValue(e.target.value);setPricePreview([]);}}/></label><label>Apply to<select value={priceScope} onChange={e=>{setPriceScope(e.target.value);setPricePreview([]);}}><option value="all">All products</option><option value="category">One category</option></select></label>{priceScope==="category"&&<label>Category<select value={priceCategory} onChange={e=>setPriceCategory(e.target.value)}><option value="">Select category</option>{[...new Set(products.map(p=>String(p.category||"")).filter(Boolean))].map(c=><option key={c} value={c}>{c}</option>)}</select></label>}</div><div className="editor-actions"><button className="outline-btn" onClick={previewPriceChange}>Preview price changes</button>{pricePreview.length>0&&<button className="primary-btn" disabled={priceBusy} onClick={applyPriceChange}>{priceBusy?"Applying…":"Confirm & apply "+pricePreview.length+" prices"}</button>}</div>{pricePreview.length>0&&<div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>OLD PRICE</th><th>NEW PRICE</th></tr></thead><tbody>{pricePreview.slice(0,30).map(x=><tr key={x.id}><td>{x.name}</td><td>{cash(n(x.oldPrice))}</td><td><b>{cash(n(x.newPrice))}</b></td></tr>)}</tbody></table><p className="muted">Previewing {Math.min(30,pricePreview.length)} of {pricePreview.length} products. Confirm only after reviewing the changes.</p></div>}</div>}

<div className="panel data-panel"><div className="panel-head"><div><h3>Product history</h3><p>Customer purchases, supplier receipts and returns with recorded date and time.</p></div><span className="record-count">{productHistory.length} records</span></div><div className="product-form-grid"><label>Choose product<select value={historyProduct} onChange={e=>setHistoryProduct(e.target.value)}><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.sku?" · "+p.sku:""}</option>)}</select></label></div><div className="editor-actions"><button className="outline-btn" disabled={!historyProduct||!productHistory.length} onClick={exportProductHistoryCsv}>Export Excel-compatible CSV</button><button className="primary-btn" disabled={!historyProduct||!productHistory.length} onClick={printProductHistory}>Print / Save PDF</button></div><div className="table-wrap"><table><thead><tr><th>DATE & TIME</th><th>TYPE</th><th>REFERENCE</th><th>CUSTOMER</th><th>SUPPLIER</th><th>BRANCH</th><th>QTY</th><th>DETAILS</th></tr></thead><tbody>{productHistory.map((x:any,i:number)=><tr key={x.type+":"+x.reference+":"+i}><td>{x.date?new Date(x.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"}</td><td>{x.type}</td><td>{x.reference||"—"}</td><td>{x.customer||"—"}</td><td>{x.supplier||"—"}</td><td>{x.branch||"—"}</td><td className={x.qty<0?"negative-value":"positive-value"}>{x.qty>0?"+":""}{x.qty}</td><td>{x.detail||"—"}</td></tr>)}{!productHistory.length&&<tr><td colSpan={8} className="empty-cell">{historyProduct?"No history for this product yet.":"Select a product to view its complete transaction history."}</td></tr>}</tbody></table></div></div>
 <div className="panel data-panel"><div className="panel-head"><div><h3>Stock movement history</h3><p>Purchases, sales, returns, transfers and approved adjustments.</p></div><span className="record-count">{movements.length} movements</span></div><div className="table-wrap"><table><thead><tr><th>DATE</th><th>TYPE</th><th>REFERENCE</th><th>PRODUCT</th><th>BRANCH</th><th>QUANTITY CHANGE</th><th>DETAILS</th></tr></thead><tbody>{movements.map((m:any,i:number)=><tr key={m.id||i}><td>{m.date?new Date(m.date).toLocaleDateString():"—"}</td><td><b>{m.type}</b></td><td>{m.reference||"—"}</td><td>{m.productName||"—"}</td><td>{m.branchName||"—"}</td><td className={m.qty<0?"negative-value":"positive-value"}>{m.qty>0?"+":""}{m.qty}</td><td>{m.note||"—"}</td></tr>)}{!movements.length&&<tr><td colSpan={7} className="empty-cell">No recorded stock movements yet.</td></tr>}</tbody></table></div></div>
 {canEdit&&editorOpen&&<div className="panel product-editor"><h3>{editing?"Edit product":"Add product"}</h3><div className="product-form-grid"><label>Product name<input value={name} onChange={e=>setName(e.target.value)}/></label><label>SKU / Product code<input value={sku} onChange={e=>setSku(e.target.value)}/></label><label>Barcode<input value={barcode} onChange={e=>setBarcode(e.target.value)} placeholder="Scan or enter barcode"/></label><label>Category<input value={category} onChange={e=>setCategory(e.target.value)}/></label><label>Branch<select value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{!editing&&<label>Opening quantity<input type="number" min="0" value={qty} onChange={e=>setQty(e.target.value)}/></label>}<label>Cost price<input type="number" min="0" value={cost} onChange={e=>setCost(e.target.value)}/></label><label>Selling price<input type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)}/></label><label>Low-stock alert<input type="number" min="0" value={alertQty} onChange={e=>setAlertQty(e.target.value)}/></label></div><div className="editor-actions"><button className="outline-btn" onClick={()=>start()}>Clear form</button><button className="primary-btn" disabled={busy||!name.trim()||!branchId} onClick={save}>{busy?"Saving…":"Save product"}</button></div></div>}
 </div>;
}
