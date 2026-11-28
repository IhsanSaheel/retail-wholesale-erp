"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { listPendingSales, removePendingSale, savePendingSale, updatePendingSale, type PendingSale } from "@/lib/offline-sales";
import { getSupabase } from "@/lib/supabase";
import { saveOfflineRecordMutation } from "@/lib/offline-records";

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
function transliterateProductNameToUrdu(value:string) {
  const known:Record<string,string>={
    "fish":"فش","chana khata":"چنا خٹا","chana chat":"چنا چاٹ","chana":"چنا",
    "khata":"خٹا","fish nimko":"فش نمکو","nimko":"نمکو","jelly":"جیلی",
    "chewing gum":"چیونگم","papad":"پاپڑ","pulses":"پلسز"
  };
  const normalized=value.trim().toLocaleLowerCase().replace(/\s+/g," ");
  if(known[normalized]) return known[normalized];
  // Phonetic transliteration only: keep the English word's sound, never translate its meaning.
  const digraphs:Record<string,string>={kh:"خ",gh:"غ",sh:"ش",ch:"چ",zh:"ژ",ph:"ف",th:"تھ",dh:"دھ",bh:"بھ",tt:"ٹ",dd:"ڈ",rr:"ڑ"};
  const letters:Record<string,string>={a:"",b:"ب",c:"ک",d:"د",e:"",f:"ف",g:"گ",h:"ہ",i:"",j:"ج",k:"ک",l:"ل",m:"م",n:"ن",o:"و",p:"پ",q:"ق",r:"ر",s:"س",t:"ت",u:"و",v:"و",w:"و",x:"کس",y:"ی",z:"ز"};
  return value.split(/(\s+)/).map(word=>{
    if(!word.trim()) return word;
    let out="";
    for(let i=0;i<word.length;){
      const pair=word.slice(i,i+2).toLowerCase();
      if(digraphs[pair]){out+=digraphs[pair];i+=2;continue;}
      const ch=word[i].toLowerCase();
      out+=letters[ch]??word[i];
      i++;
    }
    return out;
  }).join("");
}
async function translateInvoiceItemsToUrdu(items: any[]) {
  const cacheKey="ihsan_invoice_urdu_translation_v3";
  let cache:Record<string,string>={};
  try { cache=JSON.parse(localStorage.getItem(cacheKey)||"{}"); } catch {}
  const translated=(items||[]).map((item:any)=>{
    const name=String(item.name||item.productName||item.title||item.product?.name||"").trim();
    if(!name) return {...item,urduName:""};
    if(/[\u0600-\u06FF]/.test(name)) return {...item,urduName:name};
    const key=name.toLocaleLowerCase().replace(/\s+/g," ").trim();
    const value=transliterateProductNameToUrdu(name);
    cache[key]=value;
    return {...item,urduName:value||name};
  });
  try { localStorage.setItem(cacheKey,JSON.stringify(cache)); } catch {}
  return translated;
}

function buildReceiptDocument(data: Record<string, any>) {
  const itemRows = (Array.isArray(data.items) ? data.items : []).map((item: Product, index:number) => {
    const qty = n(item.saleQty??item.qty), price = n(item.originalUnitSalePrice??item.unitSalePrice??item.price);
    const secondary=item.saleSecondaryUnit&&n(item.saleSecondaryQty)>0?`<small>(${n(item.saleSecondaryQty)*qty} ${esc(item.saleSecondaryUnit)})</small>`:"";const productName=String(data.language||"en")==="ur"?(item.urduName||item.nameUrdu||item.name):item.name;return `<tr><td class="item-no">${index+1}</td><td class="item-name"><strong>${esc(productName)}</strong>${item.sku ? `<small>SKU: ${esc(item.sku)}</small>` : ""}</td><td class="r item-qty">${qty} <small>${esc(item.saleUnit||item.unit||"")}</small>${secondary}</td><td class="r item-rate">${cash(price)}</td><td class="r item-total">${cash(qty * price)}</td></tr>`;
  }).join("");
  const urduTotals:Record<string,string>={"Subtotal":"ذیلی کل","Bill discount":"بل پر رعایت","Loyalty discount":"وفاداری رعایت","Total bill":"کل بل","Amount received":"وصول شدہ رقم","Applied to invoice":"بل میں جمع","Customer advance applied":"پیشگی رقم استعمال","Previous outstanding settled":"پرانا بقایا وصول","Change returned":"واپس کی گئی رقم","Customer advance saved":"اکاؤنٹ میں جمع پیشگی","Staff tip (not sales)":"ٹِپ (فروخت میں شامل نہیں)","Balance due":"بقایا رقم"};
  const totalRows = (Array.isArray(data.rows) ? data.rows : []).map(([label, amount]: [string, any]) => {
    const shown=String(label||"");const translated=data.language==="ur"?(urduTotals[shown]||shown):shown;return `<tr><td>${esc(translated)}</td><td class="r">${cash(n(amount))}</td></tr>`;
  }).join("");
  const logoUrl = String(data.logoUrl || "https://njzhtxrmrqhuxhytxaay.supabase.co/storage/v1/object/public/etihad-branding/d343ea3c-6c19-48f8-bf06-d47f883debcb/logo.png?v=1795278776451");
  return `<!doctype html><html lang="${data.language==="ur"?"ur":"en"}" dir="${data.language==="ur"?"rtl":"ltr"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>${esc(data.invoiceNo || "Sales receipt")}</title>
  <style>
    *{box-sizing:border-box}html{background:#eef0f3}body{font:11px/1.65 "Noto Nastaliq Urdu","Noto Naskh Arabic",Arial,sans-serif;color:#202b3d;width:100%;max-width:420px;margin:18px auto;padding:16px;background:#fff;border:1px solid #e7e9ed;box-shadow:0 8px 28px #17243a12}
    .brand{background:#172942;margin:-16px -16px 13px;padding:17px 14px 13px;text-align:center;border-bottom:4px solid #c6a264}.brand img{display:block;width:190px;height:auto;max-height:90px;object-fit:contain;margin:0 auto}.brand .tag{font-size:8px;letter-spacing:2px;color:#e4c98f;font-weight:700;margin-top:5px}.brand .contact{font-size:9px;letter-spacing:.2px;color:#fff;font-weight:700;margin-top:6px}
    .item-name strong{font-family:"Noto Nastaliq Urdu","Noto Naskh Arabic",serif}.receipt-title{text-align:center;font-size:14px;font-weight:800;letter-spacing:1.5px;color:#172942;margin:12px 0 2px}.subtitle{text-align:center;color:#7a8492;font-size:8px;letter-spacing:.7px}.status{margin:10px 0;padding:8px;border:1px solid #d8b66b;background:#fff7e7;color:#75551c;text-align:center;font-size:9px;font-weight:800;letter-spacing:.4px;border-radius:5px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:9px 12px;font-size:9px;margin:14px 0;padding:11px;background:#f5f6f8;border:1px solid #e8ebef;border-radius:6px}.meta div{min-width:0;overflow-wrap:anywhere}.meta b{display:block;color:#7c8796;font-size:7px;font-weight:800;letter-spacing:.8px;margin-bottom:2px}.meta span{font-weight:700;color:#27364b}
    .section-label{font-size:8px;font-weight:800;letter-spacing:1px;color:#8a6a35;margin:13px 0 6px}table{width:100%;border-collapse:collapse}th{font-size:7px;letter-spacing:.5px;color:#667286;text-align:left;padding:6px 3px;border-bottom:1px solid #dfe4eb}td{padding:7px 3px;border-bottom:1px solid #edf0f3;vertical-align:top;font-size:8px}.r{text-align:right;white-space:nowrap}.item-no{color:#9aa3af;width:15px}.item-name{padding-right:4px}.item-name strong{display:block;font-size:9px;color:#202d42}.item-name small{display:block;color:#8993a1;font-size:7px;margin-top:2px}.item-qty{white-space:nowrap}.item-qty small{font-size:7px;color:#7d8794}.item-rate{color:#677386}.item-total{font-weight:800;color:#26364c}.totals{margin-top:8px}.totals td{border:0;padding:4px 3px;font-size:9px;color:#596579}.totals tr:last-child td{font-weight:800;font-size:12px;color:#fff;background:#172942;padding:10px 8px;border-top:2px solid #c6a264}.totals tr:last-child td:first-child{border-radius:5px 0 0 5px}.totals tr:last-child td:last-child{border-radius:0 5px 5px 0}
    .payment-label{text-align:center;font-size:8px;color:#687487;margin:11px 0}.note{font-size:8px;color:#596579;overflow-wrap:anywhere;background:#f7f8fa;padding:8px;border-left:3px solid #c6a264}.thanks{text-align:center;font-weight:800;font-size:11px;color:#172942;margin:14px 0 3px}.footer{text-align:center;font-size:7px;color:#8791a0;letter-spacing:.6px}
    @page{size:80mm auto;margin:0}@media print{html,body{width:74mm;max-width:74mm;margin:0;padding:0;background:#fff;border:0;box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}.brand{margin:-0px -0px 10px;padding:12px 8px 9px}.brand img{width:170px;max-height:75px}.meta{margin:10px 0;padding:8px;gap:7px}.receipt-title{margin-top:8px}td{padding:5px 2px}.totals tr:last-child td{padding:8px 6px}}
  </style></head><body>
  <header class="brand"><img src="${esc(logoUrl)}" alt="Ihsan Sweets & Supplies"><div class="tag">GENERAL TRADING · WHOLESALE</div><div class="contact">Ihsan Saheel · Mob No. 0332-3222125</div></header>
  <div class="receipt-title">${data.language==="ur"?"فروخت کا بل":esc(data.title || "SALES INVOICE")}</div><div class="subtitle">${data.language==="ur"?"سرکاری فروخت دستاویز":"OFFICIAL SALES DOCUMENT"}</div>
  ${data.status ? `<div class="status">${esc(data.status)}</div>` : ""}
  <section class="meta">
    <div><b>${data.language==="ur"?"بل نمبر":"INVOICE NUMBER"}</b><span>${esc(data.invoiceNo || "—")}</span></div>
    <div><b>${data.language==="ur"?"تاریخ اور وقت":"DATE &amp; TIME"}</b><span>${esc(data.date ? new Date(data.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}) : "—")}</span></div>
    <div><b>${data.language==="ur"?"گاہک کا نام":"BILL TO"}</b><span>${esc(data.customerName || "Walk-in Customer")}</span></div>
    <div><b>${data.language==="ur"?"رابطہ نمبر":"CONTACT"}</b><span>${esc(data.customerPhone || "—")}</span></div>
    <div><b>${data.language==="ur"?"برانچ":"BRANCH"}</b><span>${esc(data.branchName || "—")}</span></div>
    <div><b>${data.language==="ur"?"بل بنانے والا":"SERVED BY"}</b><span>${esc(data.cashier || "—")}</span></div>
  </section>
  <div class="section-label">${data.language==="ur"?"اشیاء کی تفصیل":"ITEM DETAILS"}</div><table><thead><tr><th>#</th><th>${data.language==="ur"?"پروڈکٹ":"PRODUCT"}</th><th class="r">${data.language==="ur"?"تعداد":"QTY"}</th><th class="r">${data.language==="ur"?"قیمت":"RATE"}</th><th class="r">${data.language==="ur"?"رقم":"AMOUNT"}</th></tr></thead><tbody>${itemRows || '<tr><td colspan="5">No items</td></tr>'}</tbody></table>
  <div class="section-label">${data.language==="ur"?"ادائیگی کی تفصیل":"PAYMENT SUMMARY"}</div><table class="totals"><tbody>${totalRows}</tbody></table>
  <p class="payment-label">${data.language==="ur"?"ادائیگی کا طریقہ:":"PAYMENT METHOD:"} <strong>${esc(data.paymentMethod || "—")}</strong></p>
  ${data.note ? `<p class="note"><b>${data.language==="ur"?"نوٹ":"NOTE"}</b><br>${esc(data.note)}</p>` : ""}
  <p class="thanks">${data.language==="ur"?"آپ کے کاروبار کا شکریہ!":"Thank you for your business!"}</p><p class="footer">IHSAN SWEETS & SUPPLIES · QUALITY &amp; TRUST</p>
  <script>window.onload=()=>window.print()<\\/script></body></html>`;
}


export function POSWorkspace({ orgId, userId, cashier, role, branchIds, rows, onSaved, initialTab = "new" }: POSProps) {
  const [invoiceLanguage,setInvoiceLanguage]=useState<"en"|"ur">("en");
  const supabase = useMemo(() => getSupabase(), []);
  const products = rows.filter(r => r.collection === "mberp_products").map(r => r.data).filter(p => p.active !== false);
  const branches = rows.filter(r => r.collection === "mberp_branches").map(r => r.data).filter(b => b.active !== false && (!branchIds.length || branchIds.includes(String(b.id))));
  const sales = rows.filter(r => r.collection === "mberp_sales" && !r.data?.recycleBinId).map(r => r.data);
  const customerCredits = rows.filter(r => r.collection === "mberp_customer_account_credits");
  const loyaltyConfig=rows.find(r=>r.collection==="mberp_loyalty_settings")?.data||{earnAmount:1,earnPoints:1,redeemPoints:1000,redeemValue:1,enabled:true};
  const [loyaltyRedeemPoints,setLoyaltyRedeemPoints]=useState("0");
  const [cart, setCart] = useState<{ product: Product; qty: number; qtyDraft?: string; amountDraft?: string; saleUnit?: string; saleFactor?: number; saleQty?: number }[]>([]);
  const [saleType,setSaleType]=useState<"retailer"|"salesman">("retailer");
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const normalizeCustomerPhone=(value:any)=>{let digits=String(value||"").replace(/\D/g,"");if(digits.startsWith("00"))digits=digits.slice(2);if(digits.startsWith("0")&&digits.length>=10&&digits.length<=11)digits="92"+digits.slice(1);return digits;};
  const [remoteCustomerLedger,setRemoteCustomerLedger]=useState<any>(null);
  const [customerLookupStatus,setCustomerLookupStatus]=useState("");
  const remoteCustomerMatches=!!remoteCustomerLedger&&normalizeCustomerPhone(remoteCustomerLedger.phoneNormalized||remoteCustomerLedger.profile?.phone)===normalizeCustomerPhone(customerPhone);
  useEffect(()=>{
    const phone=customerPhone.trim(),normalized=normalizeCustomerPhone(phone);
    if(!phone||normalized.length<7||normalized.length>15){setRemoteCustomerLedger(null);setCustomerLookupStatus("");return;}
    if(!navigator.onLine){setRemoteCustomerLedger(null);setCustomerLookupStatus("Connect to the internet to verify the customer across branches.");return;}
    let active=true;
    setCustomerLookupStatus("Searching customer records across all branches…");
    const timer=window.setTimeout(async()=>{
      try{
        const {data,error}=await supabase.rpc("etihad_customer_lookup",{p_org_id:orgId,p_customer_phone:phone});
        if(!active)return;
        if(error){setRemoteCustomerLedger(null);setCustomerLookupStatus("Customer lookup could not be confirmed: "+error.message);return;}
        if(data?.found&&data.profile){
          setRemoteCustomerLedger(data);
          setCustomerName(String(data.profile.name||""));
          setCustomerLookupStatus("Existing customer found · previous bills, points and balances are shared across branches.");
        }else{
          setRemoteCustomerLedger(null);
          setCustomerLookupStatus("New customer number · enter the customer's name to save this customer and bill.");
        }
      }catch(error:any){if(active){setRemoteCustomerLedger(null);setCustomerLookupStatus("Customer lookup failed: "+(error?.message||"Check your connection."));}}
    },350);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[customerPhone,orgId,supabase]);
  const [branchId, setBranchId] = useState(branches.find(b => products.some(p => String(p.branchId) === String(b.id) && n(p.qty) > 0))?.id || branches.find(b => products.some(p => String(p.branchId) === String(b.id)))?.id || branches[0]?.id || "");
  const [received, setReceived] = useState("");
  const [billDiscount, setBillDiscount] = useState("0");
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
  async function saveDraft(kind:"order"|"quote"){if(!cart.length){setMessage("Add products before saving.");return;}if(!branchId){setMessage("Choose a branch before saving.");return;}setDraftBusy(true);const id=makeId(),date=new Date().toISOString(),branch=branches.find(b=>String(b.id)===String(branchId));const draftSubtotal=cart.reduce((sum,x)=>sum+n(x.product.price)*x.qty,0);const draftTaxAmount=selectedTax?(selectedTax.type==="inclusive"?draftSubtotal*n(selectedTax.rate)/(100+n(selectedTax.rate)):draftSubtotal*n(selectedTax.rate)/100):0;const draftTotal=selectedTax&&selectedTax.type!=="inclusive"?draftSubtotal+draftTaxAmount:draftSubtotal;const draftDiscount=Math.min(draftTotal,Math.max(0,n(billDiscount)));const data={id,reference:(kind==="order"?"ORD-":"QUO-")+id.slice(-6).toUpperCase(),date,validUntil:kind==="quote"?addPakistanDays(7):null,branchId:String(branchId),branchName:branch?.name||"",customerName:customerName.trim()||"Walk-in Customer",customerPhone:customerPhone.trim(),title:draftTitle.trim(),saleType,items:cart.map(x=>({productId:String(x.product.id),name:x.product.name,urduName:x.product.urduName||x.product.nameUrdu||"",sku:x.product.sku||"",qty:x.qty,saleQty:n(x.saleQty??x.qty),saleUnit:x.saleUnit||x.product.unit||"piece",saleFactor:n(x.saleFactor)||1,unitSalePrice:n(x.product.price)*(n(x.saleFactor)||1),cost:n(x.product.cost),price:n(x.product.price),unit:x.saleUnit||x.product.unit||"piece"})),subtotal:draftSubtotal,taxId:selectedTax?.id||null,taxName:selectedTax?.name||"",taxRate:selectedTax?n(selectedTax.rate):0,taxType:selectedTax?.type||null,taxAmount:draftTaxAmount,total:Math.max(0,draftTotal-draftDiscount),discount:draftDiscount,billDiscount:draftDiscount,notes:note,status:"open",createdBy:userId};const {error}=await supabase.from("etihad_records").insert({org_id:orgId,collection:kind==="order"?"mberp_open_orders":"mberp_quotations",record_id:String(id),branch_ids:[String(branchId)],data,updated_by:userId});setDraftBusy(false);if(error){setMessage("Could not save "+kind+": "+error.message);return;}clearBill();setDraftTitle("");setMessage((kind==="order"?"Open order ":"Quotation ")+data.reference+" saved. Draft totals exclude loyalty redemption.");onSaved();}
  async function resumeOrder(order:any){setBranchId(String(order.branchId));const restored=(order.items||[]).map((it:any)=>{const p=products.find(x=>String(x.id)===String(it.productId));return p?{product:{...p,price:Number.isFinite(Number(it.price))?Number(it.price):n(p.price),cost:Number.isFinite(Number(it.cost))?Number(it.cost):n(p.cost)},qty:n(it.qty)}:null;}).filter(Boolean) as {product:Product;qty:number}[];if(!restored.length){setMessage("No available products from this saved order could be restored.");return;}setCart(restored);setBillDiscount(String(order.billDiscount??order.discount??0));setCustomerName(order.customerName||"Walk-in Customer");setCustomerPhone(order.customerPhone||"");setNote(order.notes||"");setTaxId(String(order.taxId||""));setLoyaltyRedeemPoints("0");setTab("new");setMessage("Saved prices and tax settings restored to the bill. Review quantities and stock before checkout.");}
  function printQuotation(quote:any){
    const esc=(v:any)=>String(v??"—").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]||ch));
    const lines=(quote.items||[]).map((it:any,i:number)=>`<tr><td>${i+1}</td><td><b>${esc(it.name)}</b><small>${it.sku?"SKU: "+esc(it.sku):""}</small></td><td>${esc(it.qty)} ${esc(it.unit||"")}</td><td class="num">${cash(n(it.price))}</td><td class="num">${cash(n(it.price)*n(it.qty))}</td></tr>`).join("");
    const w=window.open("","_blank","width=900,height=750");
    if(!w){setMessage("Allow pop-ups to print or save the quotation as PDF.");return;}
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Quotation ${esc(quote.reference)}</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:12px/1.55 Arial,sans-serif;color:#263449;margin:0;background:#fff}header{display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:4px solid #c5a064;padding:0 0 17px}header img{width:175px;height:82px;object-fit:contain}header h1{font-size:25px;letter-spacing:1.5px;margin:0;color:#172942;text-align:right}header p{margin:5px 0 0;color:#8a6c3e;font-size:9px;letter-spacing:1.2px;text-align:right;font-weight:700}.meta{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}.meta section{padding:15px 16px;background:#f6f7f9;border:1px solid #e4e8ee;border-radius:7px;min-height:105px}.meta b{display:block;margin-bottom:7px;color:#967542;font-size:9px;letter-spacing:1px;text-transform:uppercase}.meta span{display:block;line-height:1.8;color:#354258}table{width:100%;border-collapse:collapse;margin-top:18px}th{background:#172942;color:#fff;text-align:left;padding:11px 10px;font-size:9px;letter-spacing:.6px}td{border-bottom:1px solid #e6e9ee;padding:11px 10px;vertical-align:top}td small{display:block;color:#8993a1;margin-top:4px}.num{text-align:right;white-space:nowrap}.total{margin:22px 0 0 auto;width:285px;padding:15px 17px;background:#f6f7f9;border:1px solid #e4e8ee;border-top:3px solid #c5a064;border-radius:0 0 7px 7px}.total div{display:flex;justify-content:space-between;gap:15px;padding:6px 0;color:#596579}.total strong{font-size:20px;color:#172942}.notes{margin-top:24px;padding:14px 16px;border:1px solid #e4e8ee;border-left:3px solid #c5a064;background:#fafbfc;white-space:pre-wrap}.foot{margin-top:38px;border-top:1px solid #e1e5eb;padding-top:12px;color:#8993a1;font-size:9px;text-align:center}.signature-row{display:flex;justify-content:space-between;margin-top:48px;color:#6d7888;font-size:9px}.signature-row span{width:28%;border-top:1px solid #aeb7c3;padding-top:7px;text-align:center}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><header><img src="/brand-logo.svg?v=6" alt="Ihsan Sweets & Supplies"><div><h1>QUOTATION</h1><p>IHSAN SWEETS & SUPPLIES · GENERAL TRADING & WHOLESALE</p></div></header><div class="meta"><section><b>Prepared for</b><span>${esc(quote.customerName)}</span><span>${esc(quote.customerPhone||"No phone recorded")}</span></section><section><b>Quotation details</b><span>Reference: ${esc(quote.reference)}</span><span>Issued: ${esc(quote.date?new Date(quote.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—")}</span><span>Valid until: ${esc(quote.validUntil||"—")}</span><span>Branch: ${esc(quote.branchName||"—")}</span></section></div><table><thead><tr><th>#</th><th>Product / Description</th><th>Qty</th><th class="num">Unit price</th><th class="num">Line total</th></tr></thead><tbody>${lines||'<tr><td colspan="5">No items</td></tr>'}</tbody></table><div class="total"><div><span>Subtotal</span><b>${cash(n(quote.subtotal))}</b></div>${quote.taxName?`<div><span>${esc(quote.taxName)} (${n(quote.taxRate)}% · ${quote.taxType==="inclusive"?"included":"added"})</span><b>${cash(n(quote.taxAmount))}</b></div>`:""}${n(quote.discount)>0?`<div><span>Discount</span><b>−${cash(n(quote.discount))}</b></div>`:""}<div><strong>Quotation total</strong><strong>${cash(n(quote.total))}</strong></div></div>${quote.notes?`<div class="notes"><b>Notes</b><br>${esc(quote.notes)}</div>`:""}<div class="signature-row"><span>Prepared by</span><span>Customer acceptance</span><span>Authorized signature</span></div><div class="foot">This quotation is valid until the date shown above and is not a tax invoice or proof of payment. · Ihsan Sweets & Supplies</div><script>window.onload=()=>window.print()<\\/script></body></html>`);
    w.document.close();
  }
  function shareQuotation(quote:any){
    const lines=(quote.items||[]).map((it:any)=>"• "+String(it.name||"Item")+" × "+n(it.qty)+" = "+cash(n(it.price)*n(it.qty))).join("\n");
    const message=["IHSAN SWEETS & SUPPLIES — QUOTATION", "Reference: "+(quote.reference||"—"),"Customer: "+(quote.customerName||"—"),"Date: "+(quote.date?new Date(quote.date).toLocaleDateString("en-PK",{timeZone:"Asia/Karachi"}):"—"),"Valid until: "+(quote.validUntil||"—"),"",lines,"","Total: "+cash(n(quote.total)),quote.notes?"Notes: "+quote.notes:""].filter(Boolean).join("\n");
    const phone=String(quote.customerPhone||"").replace(/[^0-9]/g,"");
    window.open("https://wa.me/"+(phone||"")+"?text="+encodeURIComponent(message),"_blank","noopener,noreferrer");
  }
  async function markDraft(id:string,collection:string,status:string){const entry=rows.find(r=>r.collection===collection&&String(r.data.id)===id);if(!entry)return;const {error}=await supabase.from("etihad_records").update({data:{...entry.data,status,updatedAt:new Date().toISOString()},updated_by:userId}).eq("org_id",orgId).eq("collection",collection).eq("record_id",id);if(error){setMessage(error.message);return;}onSaved();}

  const subtotal = cart.reduce((s, x) => s + n(x.product.price) * x.qty, 0);
  const selectedTax=taxRates.find(t=>String(t.id)===String(taxId));
  const taxRate=selectedTax?Math.max(0,Math.min(100,n(selectedTax.rate))):0;
  const taxAmount=selectedTax?(selectedTax.type==="inclusive"?subtotal*taxRate/(100+taxRate):subtotal*taxRate/100):0;
  const baseTotal=selectedTax&&selectedTax.type!=="inclusive"?subtotal+taxAmount:subtotal;
  const loyaltyCustomerSales=customerPhone.trim()?(remoteCustomerMatches?(remoteCustomerLedger.sales||[]):sales.filter(s=>normalizeCustomerPhone(s.customerPhone)===normalizeCustomerPhone(customerPhone)&&String(s.status||"").toLowerCase()!=="cancelled")):[];
  const customerLoyaltyPoints=remoteCustomerMatches?Math.max(0,n(remoteCustomerLedger.loyaltyPoints)):Math.max(0,loyaltyCustomerSales.reduce((sum:number,s:any)=>{const original=Math.max(0,n(s.loyaltyEligibleTotal)||n(s.total));const ratio=original>0?Math.min(1,Math.max(0,n(s.total)/original)):1;return sum+Math.floor(n(s.loyaltyPointsEarned)*ratio)-Math.floor(n(s.loyaltyPointsRedeemed)*ratio);},0));
  const redeemRatePoints=Math.max(1,n(loyaltyConfig.redeemPoints)||1000),redeemRateValue=Math.max(0,n(loyaltyConfig.redeemValue)||1);
  const requestedRedeem=Math.max(0,Math.floor(n(loyaltyRedeemPoints)));
  const loyaltyPointsRedeemed=Math.min(customerLoyaltyPoints,requestedRedeem,Math.floor(baseTotal*redeemRatePoints/Math.max(0.01,redeemRateValue)));
  const loyaltyDiscount=loyaltyConfig.enabled!==false?Math.min(baseTotal,loyaltyPointsRedeemed/redeemRatePoints*redeemRateValue):0;
  const billDiscountLimit=Math.max(0,baseTotal-loyaltyDiscount);
  const billDiscountAmount=Math.min(billDiscountLimit,Math.max(0,n(billDiscount)));
  const total=Math.max(0,baseTotal-loyaltyDiscount-billDiscountAmount);
  const loyaltyFactor=baseTotal>0?Math.max(0,(baseTotal-loyaltyDiscount)/baseTotal):1;
  const finalPriceFactor=baseTotal>0?total/baseTotal:1;
  const saleSubtotal=subtotal*finalPriceFactor;
  const saleTaxAmount=taxAmount*finalPriceFactor;
  const loyaltyPointsEarned=customerPhone.trim()&&customerName!=="Walk-in Customer"&&loyaltyConfig.enabled!==false&&n(loyaltyConfig.earnAmount)>0?Math.floor(total/Math.max(0.01,n(loyaltyConfig.earnAmount))*Math.max(0,n(loyaltyConfig.earnPoints))):0;
  const customerOutstanding = customerPhone.trim() ? (remoteCustomerMatches?n(remoteCustomerLedger.grossOutstanding):sales.filter(s=>normalizeCustomerPhone(s.customerPhone)===normalizeCustomerPhone(customerPhone)&&String(s.status||"").toLowerCase()!=="cancelled").reduce((sum,s)=>sum+n(s.balance),0)) : 0;
  const customerAdvanceBalance = customerPhone.trim() ? (remoteCustomerMatches?n(remoteCustomerLedger.grossAdvance):customerCredits.filter(r=>normalizeCustomerPhone(r.data.customerPhone)===normalizeCustomerPhone(customerPhone)).reduce((sum,r)=>sum+n(r.data.balance),0)) : 0;
  const availableAdvance = Math.max(0, customerAdvanceBalance - customerOutstanding);
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
  const customerOptions:Array<[string,{name:string;phone:string}]>=[...sales.filter(s=>s.customerName&&s.customerName!=="Walk-in Customer").map(s=>[s.customerPhone?"phone:"+normalizeCustomerPhone(s.customerPhone):"name:"+String(s.customerName).toLowerCase(),{name:String(s.customerName),phone:String(s.customerPhone||"")}] as [string,{name:string;phone:string}]),...savedCustomers.map(c=>[c.phone?"phone:"+normalizeCustomerPhone(c.phone):"id:"+String(c.id),{name:String(c.name||""),phone:String(c.phone||"")}] as [string,{name:string;phone:string}])];
  const customers = Array.from(new Map<string,{name:string;phone:string}>(customerOptions).values()).filter(c => (c.name + " " + c.phone).toLowerCase().includes(customerSearch.toLowerCase())).slice(0, 6);
  const recent = [...sales].sort((a,b)=>new Date(b.date||0).getTime()-new Date(a.date||0).getTime()).slice(0,30);
  const packageFor=(p:Product,name:string)=>{const options=Array.isArray(p.packagingUnits)?p.packagingUnits:[];return options.find((u:any)=>String(u.name)===name)||{name:p.unit||"piece",conversionToBase:1,costPrice:n(p.cost),retailerPrice:n(p.retailerPrice??p.price),salesmanPrice:n(p.salesmanPrice??p.retailerPrice??p.price)};};
  const priceForSaleType=(p:Product,type:"retailer"|"salesman",unitName?:string)=>{const options=[{name:String(p.unit||"piece"),conversionToBase:1,costPrice:p.cost,retailerPrice:p.retailerPrice??p.price,salesmanPrice:p.salesmanPrice??p.retailerPrice??p.price},...(Array.isArray(p.packagingUnits)?p.packagingUnits:[])];const u=options.find((x:any)=>String(x.name).toLowerCase()===String(unitName||p.unit||"piece").toLowerCase())||options[0];const key=type==="salesman"?"salesmanPrice":"retailerPrice";let packageRate=n(u[key]);if(packageRate<=0){const smaller=options.filter((x:any)=>n(x.conversionToBase)>0&&n(x.conversionToBase)<n(u.conversionToBase)&&n(x[key])>0).sort((a:any,b:any)=>n(b.conversionToBase)-n(a.conversionToBase))[0];if(smaller)packageRate=n(smaller[key])*(n(u.conversionToBase)/n(smaller.conversionToBase));}if(packageRate<=0){const base=options[0];packageRate=n(base[key]);}return packageRate/Math.max(0.000001,n(u.conversionToBase)||1);};
  const upperUnitThreshold=(p:Product)=>Math.max(0,...(Array.isArray(p.packagingUnits)?p.packagingUnits:[]).map((u:any)=>n(u.conversionToBase)).filter((v:number)=>v>1));
  const autoPriceTypeForQty=(p:Product,baseQty:number):"retailer"|"salesman"=>baseQty>=upperUnitThreshold(p)?"salesman":"retailer";
  const add = (p: Product) => setCart(prev => {const found=prev.find(x=>String(x.product.id)===String(p.id));setMessage("");if(!found)return [...prev,{product:{...p,price:priceForSaleType(p,saleType)},qty:1,saleQty:1,saleUnit:String(p.unit||"piece"),saleFactor:1}];const currentFactor=Math.max(0.000001,n(found.saleFactor)||1),baseQty=n(found.qty)+currentFactor,larger=bestWholePackage(p,baseQty,currentFactor),autoType=autoPriceTypeForQty(p,baseQty);setSaleType(autoType);if(larger){const nextFactor=Math.max(0.000001,n(larger.conversionToBase)||1);return prev.map(x=>String(x.product.id)===String(p.id)?{...x,product:{...x.product,price:priceForSaleType(p,autoType,String(larger.name))},qty:baseQty,saleUnit:String(larger.name),saleFactor:nextFactor,saleQty:baseQty/nextFactor,amountDraft:undefined}:x);}return prev.map(x=>String(x.product.id)===String(p.id)?{...x,product:{...x.product,price:priceForSaleType(p,autoType,x.saleUnit)},qty:baseQty,saleQty:(n(x.saleQty??(x.qty/currentFactor))+1),amountDraft:undefined}:x);});
  const changeSaleType=(type:"retailer"|"salesman")=>{setSaleType(type);setCart(prev=>prev.map(x=>({...x,product:{...x.product,price:priceForSaleType(products.find(p=>String(p.id)===String(x.product.id))||x.product,type,x.saleUnit)},amountDraft:undefined})));};
  const bestWholePackage=(p:Product,baseQty:number,currentFactor:number)=>{const options=[{name:String(p.unit||"piece"),conversionToBase:1},...(Array.isArray(p.packagingUnits)?p.packagingUnits:[])].filter((u:any)=>n(u.conversionToBase)>currentFactor&&n(u.conversionToBase)<=baseQty&&Math.abs(baseQty/n(u.conversionToBase)-Math.round(baseQty/n(u.conversionToBase)))<0.000001).sort((a:any,b:any)=>n(b.conversionToBase)-n(a.conversionToBase));return options[0]||null;};
  const changePackageUnit=(id:string,unitName:string)=>{const p=products.find(p=>String(p.id)===id);const selected=packageFor(p||({unit:unitName} as Product),unitName);const factor=Math.max(0.000001,n(selected.conversionToBase)||1);const autoType: "retailer"|"salesman" = factor>1?"salesman":"retailer";setSaleType(autoType);setCart(prev=>prev.map(x=>{if(String(x.product.id)!==id)return x;const product=p||x.product;return {...x,product:{...x.product,price:priceForSaleType(product,autoType,unitName)},saleUnit:unitName,saleFactor:factor,saleQty:x.qty/factor,amountDraft:undefined};}));};
  const changeUnitPrice=(id:string,raw:string)=>{const value=Number(raw);if(raw.trim()===""||!Number.isFinite(value)||value<0)return;setCart(prev=>prev.map(x=>String(x.product.id)===id?{...x,product:{...x.product,price:value/Math.max(0.000001,n(x.saleFactor)||1)},amountDraft:undefined}:x));};
  const changeQty = (id: string, raw: string) => {if(raw.trim()===""){setCart(prev=>prev.map(x=>String(x.product.id)===id?{...x,qty:0,saleQty:0,qtyDraft:"",amountDraft:undefined}:x));return;}const qty=Number(raw);if(!Number.isFinite(qty)||qty<0){setCart(prev=>prev.map(x=>String(x.product.id)===id?{...x,qtyDraft:raw}:x));return;}if(qty===0){setCart(prev=>prev.map(x=>String(x.product.id)===id?{...x,qty:0,saleQty:0,qtyDraft:"",amountDraft:undefined}:x));return;}let autoType:"retailer"|"salesman"="retailer";const next=cart.map(x=>{if(String(x.product.id)!==id)return x;const nextQty=qty,factor=Math.max(0.000001,n(x.saleFactor)||1),baseQty=nextQty*factor,p=products.find(p=>String(p.id)===id)||x.product,larger=bestWholePackage(p,baseQty,factor);autoType=autoPriceTypeForQty(p,baseQty);if(larger){const nextFactor=n(larger.conversionToBase)||1;return {...x,product:{...x.product,price:priceForSaleType(p,autoType,String(larger.name))},saleUnit:String(larger.name),saleFactor:nextFactor,saleQty:baseQty/nextFactor,qty:baseQty,qtyDraft:undefined,amountDraft:undefined};}return {...x,product:{...x.product,price:priceForSaleType(p,autoType,x.saleUnit)},saleQty:nextQty,qty:baseQty,qtyDraft:undefined,amountDraft:undefined};});setSaleType(autoType);setCart(next);};
  const supportsAmountToQty = (unit?: string) => ["kg","kilogram","kilograms","litre","liter","litres","liters"].includes(String(unit||"piece").trim().toLowerCase());
  const changeAmount = (id: string, raw: string) => { const current = cart.find(x => String(x.product.id) === id); if (!current || !supportsAmountToQty(current.product.unit)) return; if (raw.trim() !== "" && n(current.product.price) <= 0) { setMessage("Set a selling price greater than zero before entering an amount."); return; } setCart(prev => prev.map(x => { if (String(x.product.id) !== id) return x; if (raw.trim() === "") return { ...x, amountDraft: raw }; const amount = Number(raw); return Number.isFinite(amount) && amount >= 0 ? { ...x, qty: amount / n(x.product.price), amountDraft: raw } : { ...x, amountDraft: raw }; }).filter(x => x.qty > 0)); };
  const clearBill = () => {
    setCart([]);
    setSaleType("retailer");
    setReceived("");
    setUseAdvance(false);
    setLoyaltyRedeemPoints("0");
    setBillDiscount("0");
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

  async function reprintSale(s: Product) {
    const popup = window.open("", "_blank", "width=440,height=760");
    if (!popup) { setMessage("Allow pop-ups to reprint this receipt."); return; }
    const rowsHtml: [string, any][] = [
      ["Subtotal", s.originalSubtotal ?? s.subtotal ?? s.total],
      ...(n(s.billDiscount)>0?[["Bill discount",-n(s.billDiscount)] as [string,any]]:[]),
      ...(n(s.loyaltyDiscount)>0?[["Loyalty discount",-n(s.loyaltyDiscount)] as [string,any]]:[]),
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
    const receiptItems=(s.items||[]).map((it:any)=>({...it,urduName:it.urduName||it.nameUrdu||products.find(p=>String(p.id)===String(it.productId))?.urduName||products.find(p=>String(p.id)===String(it.productId))?.nameUrdu||""}));
    const translatedItems=invoiceLanguage==="ur"?await translateInvoiceItemsToUrdu(receiptItems):receiptItems;
    popup.document.open();
    popup.document.write(buildReceiptDocument({
      origin: window.location.origin, language: invoiceLanguage, logoUrl: String(rows.find(r=>r.collection==="mberp_brand_settings"&&r.record_id==="default")?.data?.logoUrl || ""), title: "SALES RECEIPT · REPRINT",
      invoiceNo: s.invoiceNo, date: s.date, customerName: s.customerName,
      customerPhone: s.customerPhone, branchName: s.branchName, cashier: s.cashier || cashier || userId,
      items: translatedItems, rows: rowsHtml, paymentMethod: s.paymentMethod, note: s.note
    }));
    popup.document.close();
  }

  function shareSaleInvoice(sale:Product,channel:"whatsapp"|"email") {
    const normalizeDigits=(value:any)=>String(value??"").replace(/\D/g,"");
    const salePhone=normalizeDigits(sale.customerPhone);
    const saleName=searchText(sale.customerName);
    const profile=savedCustomers.find((c:any)=>sale.customerId&&String(c.id)===String(sale.customerId))
      ||savedCustomers.find((c:any)=>salePhone&&[c.phone,c.whatsapp,c.whatsappNumber,c.mobile].some((v:any)=>normalizeDigits(v)===salePhone))
      ||savedCustomers.find((c:any)=>saleName&&searchText(c.name)===saleName);
    const email=String(profile?.email||profile?.emailAddress||profile?.contactEmail||sale.customerEmail||"").trim();
    const rowsBrandLogo=String(rows.find(r=>r.collection==="mberp_brand_settings"&&r.record_id==="default")?.data?.logoUrl||"https://njzhtxrmrqhuxhytxaay.supabase.co/storage/v1/object/public/etihad-branding/d343ea3c-6c19-48f8-bf06-d47f883debcb/logo.png?v=1795278776451");
    const rawPhone=String(profile?.whatsapp||profile?.whatsappNumber||profile?.phone||profile?.mobile||sale.customerPhone||"").trim();
    let digits=normalizeDigits(rawPhone);
    if(digits.startsWith("00"))digits=digits.slice(2);
    if(digits.startsWith("0"))digits="92"+digits.slice(1);
    else if(digits.length===10&&digits.startsWith("3"))digits="92"+digits;
    const whatsappPhone=digits;
    if(channel==="whatsapp"&&(!whatsappPhone||whatsappPhone.length<10||whatsappPhone.length>15)){setMessage("A valid WhatsApp number is not saved for this customer. Update the customer's phone/WhatsApp number in their profile.");return;}
    if(channel==="email"&&!email){setMessage("This customer has no email address saved in their profile.");return;}
    const clean=(v:any)=>String(v??"").normalize("NFKD").replace(/[^\x20-\x7E]/g," ").replace(/\s+/g," ").trim();
    const money=(v:any)=>"Rs. "+cash(n(v));
    const itemLines=(Array.isArray(sale.items)?sale.items:[]).flatMap((it:any)=>{
      const name=clean(it.name||"Item");
      const qty=n(it.saleQty??it.qty),unit=clean(it.saleUnit||it.unit||"");
      const rate=n(it.originalUnitSalePrice??it.unitSalePrice??it.price),amount=rate*qty;
      return [name,qty+" "+unit+" x "+money(rate)+" = "+money(amount)];
    });
    const lines=["IHSAN SWEETS & SUPPLIES","SALES INVOICE","Invoice: "+clean(sale.invoiceNo||"—"),"Date: "+(sale.date?new Date(sale.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"),"Customer: "+clean(sale.customerName||"Walk-in Customer"),"Phone: "+clean(rawPhone||sale.customerPhone||"—"),"Branch: "+clean(sale.branchName||"—"),"--------------------------------",...itemLines,"--------------------------------","Bill discount: "+money(sale.billDiscount||0),"Loyalty discount: "+money(sale.loyaltyDiscount||0),"Total: "+money(sale.total),"Paid: "+money(sale.paid),"Balance due: "+money(sale.balance),"Payment: "+clean(sale.paymentMethod||"—"),"","Thank you for your business!"];
    const escapePdf=(value:string)=>value.replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
    const wrapped:string[]=[];
    for(const line of lines){if(!line){wrapped.push("");continue;}let rest=line;while(rest.length>42){let cut=rest.lastIndexOf(" ",42);if(cut<1)cut=42;wrapped.push(rest.slice(0,cut));rest=rest.slice(cut).trim();}wrapped.push(rest);}
    const pageW=226.77,pageH=Math.max(360,wrapped.length*12+48);
    let stream="BT /F1 8 Tf 10 "+(pageH-24)+" Td 12 TL ";
    wrapped.forEach((line,i)=>{if(i)stream+="T* ";stream+="("+escapePdf(line)+") Tj ";});
    stream+="ET";
    const streamBytes=new TextEncoder().encode(stream);
    const objects:string[]=[
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+pageW+" "+pageH+"] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Length "+streamBytes.length+" >>\nstream\n"+stream+"\nendstream"
    ];
    let pdf="%PDF-1.4\n",offsets:number[]=[0];
    objects.forEach((obj,i)=>{offsets.push(new TextEncoder().encode(pdf).length);pdf+=(i+1)+" 0 obj\n"+obj+"\nendobj\n";});
    const xref=new TextEncoder().encode(pdf).length;
    pdf+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n";
    for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,"0")+" 00000 n \n";
    pdf+="trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";
    const pdfBytes=new TextEncoder().encode(pdf);
    const fileName="Ihsan-Sweets-Invoice-"+clean(sale.invoiceNo||"receipt").replace(/\s+/g,"-")+".pdf";
    const file=new File([pdfBytes],fileName,{type:"application/pdf"});
    const shareText="Ihsan Sweets & Supplies invoice "+String(sale.invoiceNo||"");
    if(channel==="whatsapp"){
      const createInvoiceImage=async():Promise<File>=>{
        // Render the WhatsApp JPG as a high-resolution 80 mm thermal receipt.
        const canvas=document.createElement("canvas");
        const width=640, pad=34, content=width-pad*2;
        const items=Array.isArray(sale.items)?sale.items:[];
        const wrap=(value:string,max=31)=>{const words=value.split(/\s+/);const out:string[]=[];let line="";for(const word of words){const next=line?line+" "+word:word;if(next.length>max&&line){out.push(line);line=word;}else line=next;}if(line)out.push(line);return out.length?out:[""];};
        const rows=items.map((it:any)=>({it,name:wrap(clean(it.name||"Item"),31)}));
        const totals:[string,any][]=[["Subtotal",sale.originalSubtotal??sale.subtotal??sale.total],...(n(sale.billDiscount)>0?[["Bill discount",-n(sale.billDiscount)] as [string,any]]:[]),...(n(sale.loyaltyDiscount)>0?[["Loyalty discount",-n(sale.loyaltyDiscount)] as [string,any]]:[]),["TOTAL",sale.total],["Paid",sale.paid],["Balance due",sale.balance]];
        if(n(sale.advanceUsed)>0)totals.splice(2,0,["Advance used",sale.advanceUsed]);
        if(n(sale.changeReturned)>0)totals.push(["Change returned",sale.changeReturned]);
        if(n(sale.customerAdvance)>0)totals.push(["Advance saved",sale.customerAdvance]);
        if(n(sale.staffTip)>0)totals.push(["Staff tip",sale.staffTip]);
        const logoUrl=String(rowsBrandLogo||"");
        const headerHeight=logoUrl?260:190;
        const metaRows=[["INVOICE",clean(sale.invoiceNo||"—")],["DATE",sale.date?new Date(sale.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"],["CUSTOMER",clean(sale.customerName||"Walk-in Customer")],["PHONE",clean(rawPhone||sale.customerPhone||"—")],["BRANCH",clean(sale.branchName||"—")],["SERVED BY",clean(sale.cashier||cashier||"—")]];
        const height=headerHeight+metaRows.length*54+110+rows.reduce((sum,r)=>sum+58+r.name.length*27,0)+80+totals.length*48+130;
        // Render at 2x pixel density and export lossless PNG so small receipt text stays crisp.
        const pixelRatio=2;
        canvas.width=width*pixelRatio;canvas.height=height*pixelRatio;
        const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image canvas is unavailable");
        ctx.scale(pixelRatio,pixelRatio);
        ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
        ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);
        let y=0;ctx.fillStyle="#172942";ctx.fillRect(0,0,width,headerHeight);
        ctx.fillStyle="#c6a264";ctx.fillRect(0,headerHeight-5,width,5);
        if(logoUrl){try{const logo=new Image();if(!logoUrl.startsWith("data:"))logo.crossOrigin="anonymous";logo.src=logoUrl;await new Promise<void>((resolve,reject)=>{logo.onload=()=>resolve();logo.onerror=()=>reject(new Error("Logo could not be loaded"));});const scale=Math.min(260/logo.width,150/logo.height);const w=logo.width*scale,h=logo.height*scale;ctx.drawImage(logo,(width-w)/2,18,w,h);}catch{}}
        ctx.textAlign="center";ctx.fillStyle="#fff";ctx.font="bold 25px Arial";ctx.fillText("IHSAN SWEETS & SUPPLIES",width/2,logoUrl?198:78);
        ctx.fillStyle="#e4c98f";ctx.font="bold 15px Arial";ctx.fillText("GENERAL TRADING · WHOLESALE",width/2,logoUrl?225:108);
        ctx.fillStyle="#fff";ctx.font="14px Arial";ctx.fillText("Ihsan Saheel · Mob No. 0332-3222125",width/2,logoUrl?248:137);
        y=headerHeight+30;ctx.textAlign="center";ctx.fillStyle="#172942";ctx.font="bold 25px Arial";ctx.fillText("SALES INVOICE",width/2,y);y+=24;
        ctx.strokeStyle="#c6a264";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();y+=24;
        metaRows.forEach(([label,value])=>{ctx.textAlign="left";ctx.fillStyle="#788497";ctx.font="bold 13px Arial";ctx.fillText(label,pad,y);ctx.fillStyle="#26364c";ctx.font="bold 17px Arial";const v=String(value||"—");ctx.textAlign="right";ctx.fillText(v.length>40?v.slice(0,37)+"…":v,width-pad,y);y+=54;});
        y+=4;ctx.fillStyle="#172942";ctx.fillRect(pad,y,content,36);ctx.textAlign="left";ctx.fillStyle="#fff";ctx.font="bold 15px Arial";ctx.fillText("ITEM DETAILS",pad+12,y+24);y+=48;
        rows.forEach(({it,name},index)=>{const qty=n(it.saleQty??it.qty),rate=n(it.originalUnitSalePrice??it.unitSalePrice??it.price),unit=clean(it.saleUnit||it.unit||"");ctx.fillStyle="#26364c";ctx.font="bold 17px Arial";ctx.textAlign="left";name.forEach((line:string)=>{ctx.fillText(line,pad,y);y+=25;});ctx.fillStyle="#687487";ctx.font="14px Arial";ctx.fillText(qty+" "+unit+" × "+cash(rate),pad,y);ctx.textAlign="right";ctx.fillStyle="#172942";ctx.font="bold 17px Arial";ctx.fillText(cash(qty*rate),width-pad,y);y+=19;ctx.strokeStyle="#e7ebf0";ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();y+=18;});
        y+=12;ctx.fillStyle="#172942";ctx.fillRect(pad,y,content,36);ctx.textAlign="left";ctx.fillStyle="#fff";ctx.font="bold 15px Arial";ctx.fillText("PAYMENT SUMMARY",pad+12,y+24);y+=50;
        totals.forEach(([label,amount],i)=>{ctx.textAlign="left";ctx.fillStyle=label==="TOTAL"?"#172942":"#4d5b70";ctx.font=label==="TOTAL"?"bold 19px Arial":"16px Arial";ctx.fillText(label,pad,y);ctx.textAlign="right";ctx.fillText(cash(n(amount)),width-pad,y);y+=48;});
        y+=12;ctx.strokeStyle="#c6a264";ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();y+=50;ctx.textAlign="center";ctx.fillStyle="#172942";ctx.font="bold 20px Arial";ctx.fillText("Thank you for your business!",width/2,y);ctx.fillStyle="#8993a1";ctx.font="13px Arial";ctx.fillText("IHSAN SWEETS & SUPPLIES · QUALITY & TRUST",width/2,y+28);
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("Could not create invoice image")),"image/png"));
        return new File([blob],"Ihsan-Sweets-Invoice-"+clean(sale.invoiceNo||"receipt").replace(/\s+/g,"-")+".png",{type:"image/png"});
      };
      createInvoiceImage().then(async(imageFile)=>{
        const chatText=lines.join("\n");
        // Prefer Android's native file-share sheet: the PNG and invoice text are passed together.
        if(typeof navigator!=="undefined"&&typeof navigator.share==="function"&&typeof navigator.canShare==="function"&&navigator.canShare({files:[imageFile]})){
          try{
            await navigator.share({files:[imageFile],title:"Ihsan Sweets & Supplies · "+String(sale.invoiceNo||"Invoice"),text:chatText});
            setMessage("Invoice and message shared. Choose the customer's WhatsApp chat and press Send.");
            return;
          }catch(err:any){
            if(err?.name==="AbortError"){setMessage("Invoice sharing cancelled.");return;}
            // If the native share sheet fails, continue with the previous safe download + customer-chat flow.
          }
        }
        const downloadUrl=URL.createObjectURL(imageFile);
        const anchor=document.createElement("a");
        anchor.href=downloadUrl;anchor.download=imageFile.name;
        document.body.appendChild(anchor);anchor.click();anchor.remove();
        window.setTimeout(()=>URL.revokeObjectURL(downloadUrl),120000);
        const shortText="Hello, please find my invoice "+String(sale.invoiceNo||"")+" from Ihsan Sweets & Supplies.";
        const whatsappUrl="https://wa.me/"+whatsappPhone+"?text="+encodeURIComponent(shortText);
        setMessage("This browser does not support sharing invoice files directly. Invoice PNG downloaded; opening the saved WhatsApp chat as before.");
        window.setTimeout(()=>{window.location.href=whatsappUrl;},350);
      }).catch((err:any)=>{if(err?.name!=="AbortError")setMessage("Could not create the invoice image. Please try again.");});
      return;
    }
    if(typeof navigator!=="undefined"&&typeof navigator.share==="function"&&typeof navigator.canShare==="function"&&navigator.canShare({files:[file]})){
      navigator.share({files:[file],title:shareText,text:shareText}).catch((err:any)=>{if(err?.name!=="AbortError")setMessage("Could not open the share menu. Please try again.");});
      return;
    }
    const downloadUrl=URL.createObjectURL(file);
    const anchor=document.createElement("a");anchor.href=downloadUrl;anchor.download=fileName;document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(downloadUrl),120000);
    window.location.href="mailto:"+encodeURIComponent(email)+"?subject="+encodeURIComponent(shareText);
    setMessage("Invoice PDF downloaded. Attach it to the email before sending.");
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
    setEditingSale(sale);setBranchId(branch);setCart(restored);setBillDiscount("0");
    setCustomerName(sale.customerName||"Walk-in Customer");setCustomerPhone(sale.customerPhone||"");
    setTaxId(sale.taxId?String(sale.taxId):"");setMethod(sale.paymentMethod||"Cash");setNote(sale.note||"");
    setReceived("");setUseAdvance(false);setTab("new");
    setMessage("Editing "+(sale.invoiceNo||"invoice")+". Existing payment and customer details are preserved; adjust products or quantities, then save.");
  }

  async function saveEditedSale() {
    if(!editingSale||!cart.length) { setMessage("Add at least one product before saving the edited invoice."); return; }
    const items=cart.map(x=>({productId:String(x.product.id),name:String(x.product.name||""),urduName:String(x.product.urduName||x.product.nameUrdu||""),sku:String(x.product.sku||""),qty:x.qty,cost:n(x.product.cost),price:n(x.product.price),unit:String(x.product.unit||"piece")}));
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
    setEditingSale(null);setCart([]);setReceived("");setBillDiscount("0");setUseAdvance(false);setMessage("Invoice edit discarded. No changes were saved.");
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

  async function moveCancelledSaleToRecycleBin(sale:Product) {
    const saleId=String(sale.id||"");
    if(role!=="owner"){setMessage("Only the owner can move a sale to the Recycle Bin.");return;}
    if(!saleId||(!(sale as any).cancelled&&String((sale as any).status||"").toLowerCase()!=="cancelled")){setMessage("For financial safety, cancel the invoice first. Only cancelled sales can be moved to the Recycle Bin.");return;}
    const reason=window.prompt("Why are you moving invoice "+String(sale.invoiceNo||saleId)+" to the Recycle Bin?");
    if(reason===null)return;
    if(reason.trim().length<3){setMessage("Enter a reason of at least 3 characters.");return;}
    if(!window.confirm("Archive this cancelled invoice? Its linked payment, refund and customer ledger history will remain intact."))return;
    const source=rows.find(r=>r.collection==="mberp_sales"&&String(r.record_id)===saleId);
    if(!source){setMessage("Sale record not found. Refresh and try again.");return;}
    const trashId=makeId(),deletedAt=new Date().toISOString();
    const saleBranchId=String((sale as any).branchId||"").trim();
    if(!saleBranchId){setMessage("This sale has no branch reference. Its archive was not created; contact the owner to correct the sale record.");return;}
    const archive={id:trashId,recordType:"Sale",branchId:saleBranchId,originalCollection:"mberp_sales",originalRecordId:saleId,originalData:source.data,originalBranchIds:[saleBranchId],itemLabel:String((sale as any).invoiceNo||saleId),reason:reason.trim(),deletedAt,deletedBy:userId,deletedByRole:role};
    setSaleActionBusy(saleId);setMessage("");
    const {error:archiveError}=await supabase.from("etihad_records").insert({org_id:orgId,collection:"mberp_recycle_bin",record_id:trashId,branch_ids:archive.originalBranchIds,data:archive,updated_by:userId});
    if(archiveError){setSaleActionBusy("");setMessage("Sale was not archived: "+archiveError.message);return;}
    const archivedData={...source.data,recycleBinId:trashId,recycleBinDeletedAt:deletedAt,recycleBinReason:reason.trim()};
    const {error:updateError}=await supabase.from("etihad_records").update({data:archivedData,updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_sales").eq("record_id",saleId);
    if(updateError){await supabase.from("etihad_records").delete().eq("org_id",orgId).eq("collection","mberp_recycle_bin").eq("record_id",trashId);setSaleActionBusy("");setMessage("Sale was not archived: "+updateError.message);return;}
    setSaleActionBusy("");setMessage("Cancelled invoice "+String((sale as any).invoiceNo||saleId)+" moved to the Recycle Bin. Its financial history remains preserved.");onSaved();
  }

  async function saveSale() {
    if(editingSale) { await saveEditedSale(); return; }
    setMessage("");
    if (!cart.length) { setMessage("Add at least one product to the bill."); return; }
    if (!branchId) { setMessage("Choose a branch before saving this sale."); return; }
    if (received.trim() !== "" && (!Number.isFinite(Number(received)) || Number(received) < 0)) { setMessage("Enter a valid payment amount of zero or more."); return; }
    if (billDiscount.trim() !== "" && (!Number.isFinite(Number(billDiscount)) || Number(billDiscount) < 0 || n(billDiscount) > billDiscountLimit + 0.001)) { setMessage("Enter a valid discount that does not exceed the remaining bill total."); return; }
    if (method === "Credit" && cashReceived > 0) { setMessage("For a credit sale, set amount received now to zero. Record any cash payment using Cash or another payment method."); return; }
    if(customerPhone.trim()&&(customerName.trim().length<2||customerName==="Walk-in Customer")){setMessage("A customer name is required with this phone number. Save the named customer before completing the bill.");return;}
    if(!customerPhone.trim()&&customerName.trim()&&customerName!=="Walk-in Customer"){setMessage("Enter the customer's phone number as well as their name before saving a customer-linked bill.");return;}
    if(customerLookupStatus.startsWith("Searching")){setMessage("Wait for the customer phone lookup to finish before saving this bill.");return;}
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
      customerName: customerName.trim() || "Walk-in Customer", customerPhone: customerPhone.trim(), saleType, cashier: cashier || userId, cashierId: userId,
      items: cart.map(x => {const factor=Math.max(0.000001,n(x.saleFactor)||1),originalPrice=n(x.product.price),netPrice=originalPrice*finalPriceFactor,afterLoyalty=originalPrice*loyaltyFactor;return {productId:x.product.id,name:x.product.name,urduName:x.product.urduName||x.product.nameUrdu||"",sku:x.product.sku||"",qty:x.qty,saleQty:n(x.saleQty??(x.qty/factor)),saleUnit:x.saleUnit||x.product.unit||"piece",saleSecondaryUnit:String((x.product.packagingUnits||[]).find((u:any)=>String(u.name)===String(x.saleUnit))?.secondaryUnit||""),saleSecondaryQty:n((x.product.packagingUnits||[]).find((u:any)=>String(u.name)===String(x.saleUnit))?.secondaryQty),saleFactor:factor,unitSalePrice:netPrice*factor,originalUnitSalePrice:originalPrice*factor,cost:n(x.product.cost),price:netPrice,originalPrice,loyaltyDiscountPerUnit:Math.max(0,originalPrice-afterLoyalty),billDiscountPerUnit:Math.max(0,afterLoyalty-netPrice),unit:x.saleUnit||x.product.unit||"piece"};}),
      subtotal:saleSubtotal, originalSubtotal:subtotal, billDiscount:billDiscountAmount, taxId:selectedTax?.id||null, taxName:selectedTax?.name||"", taxRate, taxType:selectedTax?.type||null, taxAmount:saleTaxAmount, originalTaxAmount:taxAmount, total, paid: applied, balance, receivedAmount, cashReceived, advanceUsed,
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
          branchName: sale.branchName, cashier: cashier || userId, items: invoiceLanguage==="ur"?await translateInvoiceItemsToUrdu(sale.items):sale.items,
          rows: [["Subtotal", subtotal], ...(taxAmount>0?[[selectedTax?.type==="inclusive"?(selectedTax?.name||"Tax")+" included in subtotal":(selectedTax?.name||"Tax"),taxAmount] as [string,any]]:[]), ...(loyaltyDiscount>0?[["Loyalty discount",-loyaltyDiscount] as [string,any]]:[]), ...(billDiscountAmount>0?[["Bill discount",-billDiscountAmount] as [string,any]]:[]), ["Total bill", total], ["Amount tendered (" + method + ")", cashReceived],
            ...(advanceUsed > 0 ? [["Customer advance applied", advanceUsed] as [string, any]] : []),
            ...(priorOutstandingApplied > 0 ? [["Previous outstanding settled", priorOutstandingApplied] as [string, any]] : []),
            ...(customerAdvance > 0 ? [["Customer advance saved", customerAdvance] as [string, any]] : []),
            ["Balance due", balance]], paymentMethod: method, note
        }));
        receiptWindow.document.close();
      }
      setCart([]); setReceived(""); setBillDiscount("0"); setUseAdvance(false); setCustomerName("Walk-in Customer"); setCustomerPhone(""); setNote("");
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
        origin: window.location.origin, language: invoiceLanguage, logoUrl: String(rows.find(r=>r.collection==="mberp_brand_settings"&&r.record_id==="default")?.data?.logoUrl || ""), title: "SALES RECEIPT",
        invoiceNo, date, customerName: sale.customerName, customerPhone: sale.customerPhone,
        branchName: sale.branchName, cashier: cashier || userId, items: invoiceLanguage==="ur"?await translateInvoiceItemsToUrdu(sale.items):sale.items,
        rows: [["Subtotal", subtotal], ...(taxAmount>0?[[selectedTax?.type==="inclusive"?(selectedTax?.name||"Tax")+" included in subtotal":(selectedTax?.name||"Tax"),taxAmount] as [string,any]]:[]), ...(loyaltyDiscount>0?[["Loyalty discount",-loyaltyDiscount] as [string,any]]:[]), ...(billDiscountAmount>0?[["Bill discount",-billDiscountAmount] as [string,any]]:[]), ["Total bill", total], ["Amount received (" + method + ")", cashReceived],
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
    setCart([]); setReceived(""); setBillDiscount("0"); setUseAdvance(false); setCustomerName("Walk-in Customer"); setCustomerPhone(""); setNote("");
    setMessage("Sale saved successfully. Stock and payment records updated atomically. Receipt opened in a new window.");
    setSaving(false);
    onSaved();
  }

  return <div className="pos-workspace">
    <div className="pos-heading"><div><div className="section-kicker">POINT OF SALE</div><h2>New sale</h2><p>Build a bill, select a customer and settle the payment.</p><label className="invoice-language-control">Receipt language<select value={invoiceLanguage} onChange={e=>setInvoiceLanguage(e.target.value==="ur"?"ur":"en")}><option value="en">English</option><option value="ur">اردو (Urdu)</option></select></label></div><div className="pos-tabs"><button className={tab==="new"?"selected":""} onClick={()=>setTab("new")}>New sale</button><button className={tab==="history"?"selected":""} onClick={()=>setTab("history")}>Sales history</button><button className={tab==="orders"?"selected":""} onClick={()=>setTab("orders")}>Open orders ({openOrders.length})</button><button className={tab==="quotes"?"selected":""} onClick={()=>setTab("quotes")}>Quotations ({quotations.length})</button></div></div>
    {pendingSales.length>0&&<div className="panel offline-queue-banner"><div><b>{pendingSales.length} sale{pendingSales.length===1?"":"s"} awaiting cloud sync</b><p>{syncing?"Synchronising saved sales…":"These sales are stored on this device and are not yet confirmed in cloud stock or accounts."}</p>{pendingSales.filter(x=>x.status==="failed").map(x=><small key={x.id}>Needs attention: {x.sale.invoiceNo} — {x.lastError}</small>)}</div><div className="offline-queue-actions"><button className="secondary-btn" disabled={syncing||!isOnline} onClick={retryPendingSales}>{syncing?"Syncing…":"Retry sync"}</button></div></div>}
    {message && <div className={message.startsWith("Sale saved")||message.includes("synchronised successfully")?"pos-success":"notice-error"}>{message}</div>}
    {tab==="orders"||tab==="quotes"?<div className="panel data-panel"><div className="panel-head"><div><h3>{tab==="orders"?"Open orders":"Quotations"}</h3><p>{tab==="orders"?"Saved carts can be restored and checked out later.":"Seven-day quotations can be reviewed and converted into a sale by restoring the items."}</p></div></div><div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>CUSTOMER</th><th>DATE</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{(tab==="orders"?openOrders:quotations).map((d:any)=><tr key={d.id}><td><b>{d.reference}</b></td><td>{d.customerName}</td><td>{d.date?new Date(d.date).toLocaleDateString():"—"}</td><td>{(d.items||[]).length}</td><td>{cash(n(d.total))}</td><td>{d.status||"open"}</td><td>{tab==="orders"&&<button className="text-action" onClick={()=>resumeOrder(d)}>Restore to bill</button>}{tab==="quotes"&&<><button className="text-action" onClick={()=>printQuotation(d)}>Print / Save PDF</button><button className="text-action" onClick={()=>shareQuotation(d)}>WhatsApp share</button><button className="text-action" onClick={()=>resumeOrder(d)}>Convert to sale</button></>} <button className="text-action" onClick={()=>markDraft(String(d.id),tab==="orders"?"mberp_open_orders":"mberp_quotations","cancelled")}>Close</button></td></tr>)}{!(tab==="orders"?openOrders:quotations).length&&<tr><td colSpan={7} className="empty-cell">No {tab==="orders"?"open orders":"quotations"} saved.</td></tr>}</tbody></table></div></div>:tab==="history" ? <div className="panel data-panel"><div id="product-history-section" className="panel-head"><div><h3>Recent invoices</h3><p>Latest sales from the shared Ihsan Sweets & Supplies database</p></div></div><div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>TOTAL</th><th>PROFIT</th><th>PAID</th><th>BALANCE</th><th>RECEIPT</th><th>ACTIONS</th></tr></thead><tbody>{recent.map((s,i)=>{const key=String(s.id||s.invoiceNo||i),customerProfile=savedCustomers.find((c:any)=>String(c.phone||"").replace(/\D/g,"")===String(s.customerPhone||"").replace(/\D/g,""))||savedCustomers.find((c:any)=>searchText(c.name)===searchText(s.customerName)),hasWhatsapp=!!String(customerProfile?.whatsapp||customerProfile?.phone||s.customerPhone||"").replace(/\D/g,""),hasEmail=!!String(customerProfile?.email||customerProfile?.emailAddress||customerProfile?.contactEmail||s.customerEmail||"").trim(),saleStatus=String(s.status||"").toLowerCase(),cancelled=saleStatus==="cancelled",returned=saleStatus==="returned",partiallyReturned=saleStatus==="partially_returned",items=Array.isArray(s.items)?s.items:[],saleReturns=rows.filter(r=>r.collection==="mberp_sales_returns"&&String(r.data.saleId)===String(s.id)),saleProfit=cancelled||returned?0:items.every((it:any)=>it.cost!==undefined&&it.cost!==null)?items.reduce((sum:number,it:any)=>sum+(n(it.price)-n(it.cost))*n(it.qty),0)-saleReturns.reduce((sum:number,r:any)=>{const soldItem=items.find((it:any)=>String(it.productId)===String(r.data.productId));return sum+n(r.data.creditAmount??r.data.refund)-n(soldItem?.cost)*n(r.data.qty);},0):null;return <><tr key={key} className={cancelled?"cancelled-sale-row":""}><td><b>{s.invoiceNo||"—"}</b><div><button className="text-action" onClick={()=>setExpandedSales(prev=>({...prev,[key]:!prev[key]}))}>{expandedSales[key]?"− Collapse":"＋ Expand"} ({items.length})</button></div></td><td>{s.customerName||"Walk-in"}<small className="history-subline">{s.branchName||"—"}</small></td><td>{s.date?new Date(s.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"}</td><td>{cash(n(s.total))}</td><td className={saleProfit===null?"muted-cell":saleProfit>=0?"profit-positive":"profit-negative"}>{saleProfit===null?"—":cash(saleProfit)}</td><td>{cash(n(s.paid))}</td><td>{cash(n(s.balance))}</td><td><span className={cancelled?"status cancelled":returned?"status returned":partiallyReturned?"status partially-returned":"status paid"}>{cancelled?"Cancelled":returned?"Returned":partiallyReturned?"Partially returned":"Recorded"}</span><button className="text-action" onClick={()=>reprintSale(s)}>Print 80mm receipt</button>{hasWhatsapp&&<button className="text-action" onClick={()=>shareSaleInvoice(s,"whatsapp")}>WhatsApp</button>}{hasEmail&&<button className="text-action" onClick={()=>shareSaleInvoice(s,"email")}>Email</button>}{!hasWhatsapp&&!hasEmail&&<small className="history-subline">Add customer contact to enable sharing</small>}</td><td>{!cancelled&&(role==="owner"||role==="manager")&&<button className="text-action" disabled={!!saleActionBusy} onClick={()=>beginEditSale(s)}>Edit sale</button>}{!cancelled&&(role==="owner"||role==="manager")&&<button className="text-action danger-action" disabled={saleActionBusy===key||!!saleActionBusy} onClick={()=>cancelSale(s)}>{saleActionBusy===key?"Cancelling…":"Cancel sale"}</button>}{cancelled&&<><small>Reason: {s.cancellationReason||"—"}</small>{role==="owner"&&<button className="text-action danger-action" disabled={!!saleActionBusy} onClick={()=>moveCancelledSaleToRecycleBin(s)}>{saleActionBusy===key?"Archiving…":"Move to Recycle Bin"}</button>}</>}</td></tr>{expandedSales[key]&&<tr key={key+"-items"} className={cancelled?"cancelled-sale-row":""}><td colSpan={9}><div className="sale-history-details"><div><b>Invoice:</b> {s.invoiceNo||"—"} · <b>Customer:</b> {s.customerName||"Walk-in"} · <b>Branch:</b> {s.branchName||"—"}</div><div><b>Recorded:</b> {s.date?new Date(s.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"} · <b>Bill discount:</b> {cash(n(s.billDiscount))} · <b>Loyalty discount:</b> {cash(n(s.loyaltyDiscount))} · <b>Total:</b> {cash(n(s.total))}</div>{items.map((it:any,j:number)=><div className="sale-history-item" key={j}><span>{cancelled?<del>{n(it.qty)} {it.unit||""} × {it.name}</del>:<>{n(it.qty)} {it.unit||""} × {it.name}</>}</span><b>{cash(n(it.price)*n(it.qty))}</b></div>)}{!items.length&&<small>No product line details stored for this invoice.</small>}</div></td></tr>}</>;})}{!recent.length&&<tr><td colSpan={9} className="empty-cell">No sales have been recorded yet.</td></tr>}</tbody></table></div></div> :
    <div className="pos-layout">
      <section className="pos-catalog panel"><div className="pos-catalog-head"><div><h3>Choose products</h3><p>{matches.length} matching products · {branchProducts.length} assigned to this branch</p></div></div><input ref={searchInput} className="pos-search" placeholder="Search product or scan barcode / SKU, then press Enter…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={handleProductSearchKey} autoComplete="off" inputMode="search"/><div className="pos-category-bar">{categories.map(category=><button type="button" key={category} className={categoryFilter===category?"active":""} onClick={()=>setCategoryFilter(category)}>{category}</button>)}<span className="stock-toggle">Negative inventory sales enabled</span></div><div className="pos-products">{matches.map((p,i)=><button className="pos-product" key={p.id||i} onClick={()=>add(p)}><span className="product-initial">{String(p.name||"P").slice(0,1).toUpperCase()}</span><b>{p.name}</b><small>{p.sku||p.category||"Product"} · Stock {effectiveStock(p)}</small><strong>{cash(priceForSaleType(p,saleType))} / {p.unit||"piece"}</strong><em>{n(p.qty)<0?"Negative stock · Add":n(p.qty)===0?"Zero stock · Add":"+ Add"}</em></button>)}{!matches.length&&<div className="empty-cell">{!branchProducts.length?"No products are assigned to the selected branch view. Change the Branch view at the top of the workspace or assign products to this branch.":"No products match this search. Try another name, SKU or barcode, or enable out-of-stock items."}</div>}</div></section>
      <section className="pos-bill panel"><div className="bill-title"><div><h3>{editingSale?"Edit invoice "+(editingSale.invoiceNo||""):"Current bill"}</h3><p>{cart.reduce((s,x)=>s+x.qty,0)} items in this sale</p></div>{editingSale?<button className="text-action" onClick={discardSaleEdit}>Discard edit</button>:<button className="text-action" onClick={clearBill} disabled={!cart.length&&!received&&!note}>Clear bill</button>}</div>
        <div className="bill-items">{cart.map(({product,qty})=><div className="bill-item" key={product.id}><div className="bill-product"><b>{product.name}</b><small>{cash(n(product.price)*Math.max(0.000001,n(cart.find(x=>String(x.product.id)===String(product.id))?.saleFactor)||1))} / {cart.find(x=>String(x.product.id)===String(product.id))?.saleUnit||product.unit||"piece"}</small><label style={{fontSize:11}}>Selling unit<select value={cart.find(x=>String(x.product.id)===String(product.id))?.saleUnit||product.unit||"piece"} onChange={e=>changePackageUnit(String(product.id),e.target.value)}>{(Array.isArray(product.packagingUnits)&&product.packagingUnits.length?product.packagingUnits:[{name:product.unit||"piece",conversionToBase:1,retailerPrice:product.retailerPrice??product.price,salesmanPrice:product.salesmanPrice??product.price}]).map((u:any)=><option key={u.name} value={u.name}>{u.name} · {u.secondaryUnit&&n(u.secondaryQty)>0 ? n(u.secondaryQty)+" "+u.secondaryUnit : (n(u.conversionToBase)||1)+" "+(product.unit||"base units")}</option>)}</select></label><label style={{fontSize:11}}>Unit sale price (editable)<input className="amount-entry" aria-label={"Unit sale price for "+product.name} type="number" min="0" step="0.01" value={n(product.price)*Math.max(0.000001,n(cart.find(x=>String(x.product.id)===String(product.id))?.saleFactor)||1)} onChange={e=>changeUnitPrice(String(product.id),e.target.value)} style={{width:"100%"}}/></label></div><div className="qty-control" style={{display:"grid",gridTemplateColumns:"minmax(78px,1fr) minmax(96px,1fr)",gap:6}}><label style={{fontSize:11}}>Qty ({cart.find(x=>String(x.product.id)===String(product.id))?.saleUnit||product.unit||"piece"} )<div style={{display:"flex",alignItems:"center",gap:5}}><button type="button" aria-label={"Decrease quantity for "+product.name} onClick={()=>{const item=cart.find(x=>String(x.product.id)===String(product.id));const current=item?.qtyDraft===""?0:Number(item?.qtyDraft??item?.saleQty??qty);changeQty(String(product.id),String(Math.max(0,current-1)));}} style={{width:32,height:36,flex:"0 0 32px",border:"1px solid #cbd5e1",borderRadius:7,fontSize:20,fontWeight:700}}>−</button><input className="qty-entry" aria-label={"Quantity for "+product.name} type="number" inputMode="decimal" min="0.000001" step="any" value={cart.find(x=>String(x.product.id)===String(product.id))?.qtyDraft ?? Number((cart.find(x=>String(x.product.id)===String(product.id))?.saleQty??qty).toFixed(6))} onChange={e=>changeQty(String(product.id),e.target.value)} onBlur={()=>setCart(prev=>prev.map(x=>String(x.product.id)===String(product.id)?{...x,qtyDraft:n(x.saleQty)>0?undefined:""}:x))} style={{width:"100%"}}/><button type="button" aria-label={"Increase quantity for "+product.name} onClick={()=>{const item=cart.find(x=>String(x.product.id)===String(product.id));const current=item?.qtyDraft===""?0:Number(item?.qtyDraft??item?.saleQty??qty);changeQty(String(product.id),String(current+1));}} style={{width:32,height:36,flex:"0 0 32px",border:"1px solid #cbd5e1",borderRadius:7,fontSize:20,fontWeight:700}}>+</button></div></label><label style={{fontSize:11}}>Amount (Rs)<input className="amount-entry" aria-label={"Amount for "+product.name} type="number" inputMode="decimal" min="0" step="0.01" readOnly={!supportsAmountToQty(product.unit)} value={supportsAmountToQty(product.unit) ? (cart.find(x=>String(x.product.id)===String(product.id))?.amountDraft ?? (n(product.price)*qty).toFixed(2)) : (n(product.price)*qty).toFixed(2)} onChange={e=>changeAmount(String(product.id),e.target.value)} style={{width:"100%",background:supportsAmountToQty(product.unit)?"":"#f1f0ed"}}/></label></div><b className="line-total">{cash(n(product.price)*qty)}</b><button type="button" className="remove-item" aria-label={"Remove "+product.name+" from bill"} onClick={()=>setCart(prev=>prev.filter(x=>String(x.product.id)!==String(product.id)))}>×</button></div>)}{!cart.length&&<div className="bill-empty">Your bill is empty.<br/>Choose a product to get started.</div>}</div>
        <div className="customer-box"><label>Sale price type</label><div className="customer-fields"><label><input type="radio" name="saleType" checked={saleType==="retailer"} onChange={()=>changeSaleType("retailer")}/> Retailer price</label><label><input type="radio" name="saleType" checked={saleType==="salesman"} onChange={()=>changeSaleType("salesman")}/> Salesman price</label></div><label>Customer</label><input value={customerSearch} onChange={e=>{const value=e.target.value;setCustomerSearch(value);const digits=value.replace(/\D/g,"");if(digits.length>=7&&/^[+0-9()\s-]+$/.test(value)){setCustomerPhone(value);setCustomerName("Walk-in Customer");setLoyaltyRedeemPoints("0");}}} placeholder="Search customer by name or phone across all branches…"/>{customerSearch&&<div className="customer-results">{customers.map((c,i)=><button key={i} onClick={async()=>{setCustomerName(c.name);setCustomerPhone(c.phone);setUseAdvance(true);setLoyaltyRedeemPoints("0");setCustomerSearch("");if(c.phone){const {data,error}=await supabase.rpc("etihad_reconcile_customer_ledger",{p_org_id:orgId,p_customer_phone:c.phone});if(error){setMessage("Customer advance could not be reconciled: "+error.message);return;}if(n(data?.advanceApplied)>0){setMessage("Existing customer advance applied to older invoices: "+cash(n(data.advanceApplied))+". Remaining advance is ready for this sale.");await onSaved();}}}}><b>{c.name}</b><small>{c.phone}</small></button>)}</div>}<div className="customer-fields"><input value={customerName} disabled={!!editingSale} required={!!customerPhone.trim()} onChange={e=>setCustomerName(e.target.value)} placeholder={customerPhone.trim()?"Customer name (required)":"Customer name"}/><input value={customerPhone} disabled={!!editingSale} onChange={e=>{setCustomerPhone(e.target.value);setCustomerName("Walk-in Customer");setLoyaltyRedeemPoints("0");}} placeholder="Phone number"/></div>{customerLookupStatus&&customerPhone.trim()&&<small className={remoteCustomerMatches?"customer-lookup-found":"customer-lookup-status"}>{customerLookupStatus}</small>}{remoteCustomerMatches&&<div className="purchase-totals"><span>Lifetime purchases <b>{cash(n(remoteCustomerLedger.lifetimeSales))}</b></span><span>Previous bills <b>{n(remoteCustomerLedger.invoiceCount)}</b></span><span>Outstanding <b>{cash(n(remoteCustomerLedger.grossOutstanding))}</b></span><span>Advance <b>{cash(n(remoteCustomerLedger.grossAdvance))}</b></span><span>Available points <b>{n(remoteCustomerLedger.loyaltyPoints).toLocaleString()}</b></span></div>}{remoteCustomerMatches&&Array.isArray(remoteCustomerLedger.sales)&&remoteCustomerLedger.sales.length>0&&<div className="customer-results"><b>Previous bills across branches</b>{remoteCustomerLedger.sales.slice(0,3).map((bill:any)=><div key={bill.id||bill.invoiceNo}><span>{bill.invoiceNo||bill.id} · {bill.branchName||"Branch"} · {String(bill.date||"").slice(0,10)}</span><span>{cash(n(bill.total))} · Due {cash(n(bill.serverBalance??bill.balance))}</span></div>)}</div>}{customerPhone.trim()&&loyaltyConfig.enabled!==false&&<div className="purchase-totals"><span>Loyalty balance <b>{customerLoyaltyPoints.toLocaleString()} points</b></span><span>Points earned on this sale <b>{loyaltyPointsEarned.toLocaleString()}</b></span></div>}{customerPhone.trim()&&customerLoyaltyPoints>0&&loyaltyConfig.enabled!==false&&<label>Redeem loyalty points (max {Math.min(customerLoyaltyPoints,Math.floor(baseTotal*redeemRatePoints/Math.max(0.01,redeemRateValue))).toLocaleString()})<input type="number" min="0" step="1" max={customerLoyaltyPoints} value={loyaltyRedeemPoints} onChange={e=>setLoyaltyRedeemPoints(e.target.value)}/><small>Discount: {cash(loyaltyDiscount)} · {redeemRatePoints.toLocaleString()} points = {cash(redeemRateValue)}</small></label>}</div>
                <div className="customer-box"><label>Save current cart as</label><input value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} placeholder="Order / quotation reference note (optional)"/><div className="editor-actions"><button className="outline-btn" disabled={draftBusy||!cart.length} onClick={()=>saveDraft("order")}>{draftBusy?"Saving…":"Save open order"}</button><button className="outline-btn" disabled={draftBusy||!cart.length} onClick={()=>saveDraft("quote")}>Save quotation</button></div></div><div className="bill-summary"><div><span>Subtotal</span><b>{cash(subtotal)}</b></div>{selectedTax&&<div><span>{selectedTax.name} ({taxRate}% · {selectedTax.type==="inclusive"?"included":"added"})</span><b>{cash(taxAmount)}</b></div>}{loyaltyDiscount>0&&<div><span>Loyalty redemption ({loyaltyPointsRedeemed.toLocaleString()} points)</span><b>−{cash(loyaltyDiscount)}</b></div>}<div className="bill-discount-control"><label htmlFor="pos-bill-discount">Bill discount (PKR)</label><input id="pos-bill-discount" type="number" min="0" max={billDiscountLimit} step="0.01" inputMode="decimal" value={billDiscount} disabled={!!editingSale} onChange={e=>setBillDiscount(e.target.value)} placeholder="0.00"/><small>Reduces the bill total — it is not a payment or customer due.</small></div>{billDiscountAmount>0&&<div><span>Bill discount</span><b>−{cash(billDiscountAmount)}</b></div>}<div className="bill-grand"><span>Total bill</span><strong>{cash(total)}</strong></div></div>
        <div className="payment-box">{customerPhone&&availableAdvance>0&&<label className="use-advance"><input type="checkbox" checked={useAdvance} onChange={e=>setUseAdvance(e.target.checked)}/> Use customer advance ({cash(availableAdvance)} available)</label>}<div className="payment-row payment-method-row"><label>Invoice tax<select aria-label="Invoice tax" value={taxId} disabled={!!editingSale} onChange={e=>setTaxId(e.target.value)}><option value="">No tax</option>{taxRates.map(t=><option key={t.id} value={t.id}>{t.name} · {t.rate}% · {t.type==="inclusive"?"Included":"Added"}</option>)}</select></label><label>Payment method<select aria-label="Payment method" value={method} disabled={!!editingSale} onChange={e=>setMethod(e.target.value)}><option>Cash</option><option>Card</option><option>Bank transfer</option><option>Mobile wallet</option><option>Credit</option></select></label></div><label>Amount received now ({method})</label><input type="number" min="0" step="0.01" inputMode="decimal" disabled={!!editingSale} value={received} placeholder={String(Math.max(0,total-advanceUsed))} onChange={e=>setReceived(e.target.value)}/><div className="tender-shortcuts"><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed)))}>Exact due</button><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed+500)))}>＋ Rs 500</button><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed+1000)))}>＋ Rs 1,000</button><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed+2000)))}>＋ Rs 2,000</button><button type="button" onClick={()=>setReceived("0")}>No payment</button><button type="button" onClick={()=>setReceived("")}>Reset</button></div><div className="payment-summary settlement-preview"><span>Cash received <b>{cash(cashReceived)}</b></span><span>Advance applied <b>{cash(advanceUsed)}</b></span><span>Applied to bill <b>{cash(applied)}</b></span><span>Balance due <b>{cash(balance)}</b></span>{over>0&&<span>Extra tender <b>{cash(over)}</b></span>}{priorOutstandingApplied>0&&<span>Previous due settled <b>{cash(priorOutstandingApplied)}</b></span>}{over>priorOutstandingApplied&&<span>New advance saved <b>{cash(over-priorOutstandingApplied)}</b></span>}</div>{over>0&&<div className="overpayment-box"><b>Extra received: {cash(over)}</b><p>Choose how to settle the extra amount:</p><div className="resolution-options"><label><input type="radio" checked={resolution==="change"} onChange={()=>setResolution("change")}/> Return as change</label><label><input type="radio" checked={resolution==="advance"} onChange={()=>setResolution("advance")}/> Save customer advance</label><label><input type="radio" checked={resolution==="tip"} onChange={()=>setResolution("tip")}/> Record staff tip</label></div></div>}<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Sale note (optional)" rows={2}/><button className="primary-btn checkout-btn" disabled={saving||!cart.length} onClick={saveSale}>{saving?(editingSale?"Saving invoice…":"Saving sale…"):(editingSale?"Save invoice changes":"Save sale & print receipt")} <span>→</span></button></div>
      </section>
    </div>}
 
 </div>;
}

export function ProductManager({ orgId, userId, role, branchIds, rows, allRows, selectedBranchId, onSaved, onSectionChange }: Props & { allRows?: Row[]; selectedBranchId?: string; onSectionChange?: (section:string)=>void }) {
 const supabase=useMemo(()=>getSupabase(),[]);
 const products:Product[]=rows.filter(r=>r.collection==="mberp_products").map(r=>({...r.data,id:r.data?.id||r.record_id} as Product));
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
 const [activeSection,setActiveSection]=useState("products");
 const chooseSection=(section:string)=>{setActiveSection(section);onSectionChange?.(section);};
 const [editing,setEditing]=useState<Product|null>(null),[editorOpen,setEditorOpen]=useState(false);
 const [name,setName]=useState(""),[urduName,setUrduName]=useState(""),[sku,setSku]=useState(""),[barcode,setBarcode]=useState(""),[category,setCategory]=useState(""),[unit,setUnit]=useState("piece"),[qty,setQty]=useState("0"),[cost,setCost]=useState("0"),[price,setPrice]=useState("0"),[salesmanPrice,setSalesmanPrice]=useState("0"),[alertQty,setAlertQty]=useState("5"),[productNote,setProductNote]=useState(""),[branchId,setBranchId]=useState(branches[0]?.id||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [extraUnits,setExtraUnits]=useState<any[]>([]);
 const [upperUnit,setUpperUnit]=useState(""),[upperQty,setUpperQty]=useState(""),[lowerUnit,setLowerUnit]=useState(""),[lowerQty,setLowerQty]=useState("");
 const [adjustProduct,setAdjustProduct]=useState(""),[adjustBatch,setAdjustBatch]=useState(""),[adjustDelta,setAdjustDelta]=useState(""),[adjustReason,setAdjustReason]=useState(""),[adjustBusy,setAdjustBusy]=useState(false),[reviewBusy,setReviewBusy]=useState("");
 const [stockZeroBusy,setStockZeroBusy]=useState("");
 const [bulkRows,setBulkRows]=useState<Record<string,string>[]>([]),[bulkName,setBulkName]=useState(""),[bulkError,setBulkError]=useState(""),[bulkBusy,setBulkBusy]=useState(false),[bulkSummary,setBulkSummary]=useState("");
  const [bulkSettlement,setBulkSettlement]=useState<any|null>(null),[bulkPaid,setBulkPaid]=useState<Record<string,string>>({}),[bulkPaymentMethod,setBulkPaymentMethod]=useState("Cash"),[bulkSettlementBusy,setBulkSettlementBusy]=useState(false);
  useEffect(()=>{if(bulkSettlement)return;const pending=(allRows||rows).find(r=>r.collection==="mberp_import_settlements"&&r.data?.status==="pending");if(pending?.data?.settlement){setBulkSettlement({...pending.data.settlement,recordId:String(pending.record_id)});setBulkPaid(pending.data.paidAmounts||{});setBulkPaymentMethod(pending.data.paymentMethod||"Cash");}},[rows,allRows,bulkSettlement]);
 const [labelSelection,setLabelSelection]=useState<string[]>([]),[labelCopies,setLabelCopies]=useState<Record<string,string>>({});
 const [labelTemplate,setLabelTemplate]=useState("standard"),[labelShowBrand,setLabelShowBrand]=useState(true),[labelShowBranch,setLabelShowBranch]=useState(false),[labelShowName,setLabelShowName]=useState(true),[labelShowPrice,setLabelShowPrice]=useState(true);
 const [historyProduct,setHistoryProduct]=useState("");
 const [deleteTarget,setDeleteTarget]=useState<Product|null>(null),[deleteReason,setDeleteReason]=useState("");
 const [productSearch,setProductSearch]=useState("");
 const [catalogueBranch,setCatalogueBranch]=useState("all"),[catalogueStock,setCatalogueStock]=useState("all");
 const [labelProductPicker,setLabelProductPicker]=useState("");
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
 ...rows.filter(r=>r.collection==="mberp_purchases").map(r=>r.data).filter(p=>String(p.productId||"")===historyProduct).map(p=>({date:p.createdAt||p.receivedAt||p.date,type:"Purchase receipt",reference:p.invoiceNo||p.id,customer:"",supplier:p.supplierName||"",branch:p.branchName||"",product:p.productName||"",qty:n(p.qty),detail:p.note||"Supplier purchase"})),
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
 function printProductLabels(){const selected=products.filter(p=>labelSelection.includes(String(p.id)));if(!selected.length){setError("Select at least one product to print labels.");return;}try{const templates:any={compact:{columns:4,height:"28mm",barcode:"11mm",gap:"3mm"},standard:{columns:3,height:"36mm",barcode:"15mm",gap:"5mm"},wide:{columns:2,height:"44mm",barcode:"19mm",gap:"6mm"}};const layout=templates[labelTemplate]||templates.standard;const labels=selected.flatMap(p=>{const code=String(p.barcode||p.sku||"").trim();if(!code)throw new Error("Add a barcode or SKU to "+p.name+" before printing its label.");const copies=Math.max(1,Math.min(100,Number(labelCopies[String(p.id)]||1)));const svg=barcodeSvg(code);const branch=branches.find(b=>String(b.id)===String(p.branchId));return Array.from({length:copies},()=>'<article class="label">'+(labelShowBrand?'<b class="brand">IHSAN SWEETS & SUPPLIES</b>':"")+(labelShowBranch&&branch?'<small class="branch">'+esc(branch.name)+'</small>':"")+(labelShowName?'<b class="name">'+esc(p.name)+'</b>':"")+svg+'<span class="code">'+esc(code)+'</span>'+(labelShowPrice?'<strong>PKR '+n(p.retailerPrice??p.price).toLocaleString("en-PK")+'</strong>':"")+'</article>');});const w=window.open("","_blank","width=900,height=700");if(!w){setError("Allow pop-ups for Ihsan Sweets & Supplies to print labels.");return;}w.document.write('<!doctype html><html><head><title>Ihsan Sweets & Supplies Product Labels</title><style>*{box-sizing:border-box}body{font:12px Arial;margin:8mm;color:#111}.sheet{display:grid;grid-template-columns:repeat('+layout.columns+',1fr);gap:'+layout.gap+'} .label{height:'+layout.height+';border:1px dashed #bbb;padding:3mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;text-align:center;break-inside:avoid}.brand{font-size:9px;letter-spacing:1.2px;color:#9b7b43}.branch{font-size:8px;color:#666}.name{font-size:11px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.label svg{width:95%;height:'+layout.barcode+'} .code{font-size:10px;letter-spacing:1px}.label strong{font-size:11px}@page{size:A4;margin:8mm}@media print{.label{border-color:#ddd}}</style></head><body><main class="sheet">'+labels.join("")+'</main><script>window.onload=()=>window.print()<\\/script></body></html>');w.document.close();}catch(e){setError(e instanceof Error?e.message:"Could not create labels.");}}
 function exportProductHistoryCsv(){if(!historyProduct||!productHistory.length){setError("Select a product with recorded history first.");return;}const headers=["Date & Time","Transaction","Reference","Customer","Supplier","Branch","Product","Quantity","Details"];const rowsOut=productHistory.map(x=>[x.date?new Date(x.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"",x.type,x.reference,x.customer,x.supplier,x.branch,x.product,x.qty,x.detail]);const csv=[headers,...rowsOut].map(row=>row.map(v=>{const raw=String(v??"");const safe=typeof v==="string"&&/^\s*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="Ihsan-Sweets-Supplies-Product-History-"+historyProduct+".csv";a.click();URL.revokeObjectURL(url);}
 function printProductHistory(){if(!historyProduct||!productHistory.length){setError("Select a product with recorded history first.");return;}const p=products.find(x=>String(x.id)===historyProduct);const w=window.open("","_blank","width=1100,height=750");if(!w){setError("Allow pop-ups to print product history.");return;}const body=productHistory.map(x=>"<tr><td>"+esc(x.date?new Date(x.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—")+"</td><td>"+esc(x.type)+"</td><td>"+esc(x.reference||"—")+"</td><td>"+esc(x.customer||"—")+"</td><td>"+esc(x.supplier||"—")+"</td><td>"+esc(x.branch||"—")+"</td><td>"+esc(x.qty)+"</td><td>"+esc(x.detail||"—")+"</td></tr>").join("");w.document.write("<!doctype html><html><head><title>Product History</title><style>body{font:12px Arial;margin:18mm;color:#222}h1{font-size:20px}p{color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:7px;text-align:left}th{background:#eee}@page{size:A4 landscape;margin:12mm}</style></head><body><h1>IHSAN SWEETS & SUPPLIES · PRODUCT HISTORY</h1><p>"+esc(p?.name||"")+" · SKU "+esc(p?.sku||"—")+" · Barcode "+esc(p?.barcode||"—")+"</p><table><thead><tr><th>Date & Time</th><th>Type</th><th>Reference</th><th>Customer</th><th>Supplier</th><th>Branch</th><th>Qty</th><th>Details</th></tr></thead><tbody>"+body+"</tbody></table><script>window.onload=()=>window.print()<\\/script></body></html>");w.document.close();}
 function parseProductCsv(text:string){
  const lines:string[][]=[];let row:string[]=[],cell="",quoted=false;
  const cleanText=String(text||"").replace(/^\\uFEFF/,"").replace(/^\\s*\\r?\\n/,"");
  const firstLine=cleanText.split(/\\r?\\n/,1)[0]||"";
  const countDelimiter=(candidate:string)=>{let count=0,inQuotes=false;for(let i=0;i<firstLine.length;i++){const ch=firstLine[i];if(ch==='"'){if(inQuotes&&firstLine[i+1]==='"'){i++;}else inQuotes=!inQuotes;}else if(ch===candidate&&!inQuotes)count++;}return count;};
  const delimiter=["\\t",",",";"].sort((x,y)=>countDelimiter(y)-countDelimiter(x))[0];
  text=cleanText;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(cell.trim());cell="";}else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&text[i+1]==="\n")i++;row.push(cell.trim());if(row.some(v=>v!==""))lines.push(row);row=[];cell="";}else cell+=c;}
  row.push(cell.trim());if(row.some(v=>v!==""))lines.push(row);
  if(lines.length<2)throw new Error("The CSV must contain a header row and at least one product.");
  const headers=lines[0].map(h=>h.replace(/^\uFEFF/,"").toLowerCase().replace(/[ _-]+/g,""));
  const allowed=["name","sku","barcode","category","unit","branch","cost","price","retailprice","retailerprice","salesmanprice","qty","quantity","alert","lowstockalert","upperunit","upperqty","lowerunit","lowerqty","unit2","unit2baseqty","unit2qty","unit3","unit3baseqty","unit3qty","unit4","unit4baseqty","unit4qty","unit5","unit5baseqty","unit5qty","supplier","suppliername","suppliercode","supplieritemcode","suppliercost","supplierlead","supplierleaddays","supplierleadtime","urduname","nameurdu"];
  const unknown=headers.filter(h=>!allowed.includes(h));if(unknown.length)throw new Error("Unsupported CSV column(s): "+unknown.join(", "));
  if(!headers.includes("name"))throw new Error("A name column is required.");
  return lines.slice(1).map((cells,i)=>{const item:Record<string,string>={};headers.forEach((h,j)=>item[h]=cells[j]||"");return {...item,__row:String(i+2)};});
 }

 function downloadUrduProductList(){
  const source=(allRows||rows).filter(r=>r.collection==="mberp_products").map(r=>({row:r,name:String(r.data?.name||""),sku:String(r.data?.sku||"").trim(),urduName:String(r.data?.urduName||r.data?.nameUrdu||""),branchId:String(r.data?.branchId||"")}));
  const headers=["name","sku","urduName","branch"];
  const output=source.map(x=>[x.name,x.sku,x.urduName,branches.find(b=>String(b.id)===x.branchId)?.name||x.branchId]);
  const csv=[headers,...output].map(line=>line.map(v=>{const raw=String(v??"");return '"'+raw.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="Ihsan-Sweets-Supplies-Urdu-Product-Names.csv";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 }
 async function importUrduProductNames(file?:File){
  if(!file)return;
  try{
   const imported=parseProductCsv(await file.text());
   const source=(allRows||rows).filter(r=>r.collection==="mberp_products");
   const seen=new Set<string>(),updates:any[]=[],issues:string[]=[];
   for(const item of imported as any[]){
    const sku=String(item.sku||"").trim(),branchName=String(item.branch||"").trim(),urduName=String(item.urduname||item.nameurdu||"").trim();
    if(!sku){issues.push("Row "+item.__row+": SKU is required.");continue;}
    if(!urduName){issues.push("Row "+item.__row+": Urdu name is empty.");continue;}
    const branch=branchName?branches.find(b=>searchText(b.name)===searchText(branchName)):undefined;
    if(branchName&&!branch){issues.push("Row "+item.__row+": branch '"+branchName+"' was not found.");continue;}
    const matches=source.filter(r=>searchText(r.data?.sku)===searchText(sku)&&(!branch||String(r.data?.branchId||"")===String(branch.id)));
    if(matches.length!==1){issues.push("Row "+item.__row+": SKU "+sku+(matches.length===0?" was not found.":" matches multiple products; add/check the branch column or resolve duplicate SKUs.") );continue;}
    const key=String(matches[0].data?.branchId||"")+"|"+searchText(sku);
    if(seen.has(key)){issues.push("Row "+item.__row+": duplicate SKU "+sku+" for the same branch in this file.");continue;}
    seen.add(key);updates.push({source:matches[0],urduName});
   }
   if(issues.length){window.alert("No Urdu names were changed. Please correct these issues and upload again:\n"+issues.slice(0,10).join("\n")+(issues.length>10?"\nAnd "+(issues.length-10)+" more issue(s).":""));return;}
   if(!updates.length){window.alert("No matching product names found.");return;}
   if(!window.confirm("Update Urdu names for "+updates.length+" existing products? Only Urdu name fields will change. Stock, prices, English names and sales will remain unchanged."))return;
   let saved=0;
   for(const item of updates){
    const nextData={...item.source.data,urduName:item.urduName,nameUrdu:item.urduName};
    const {error}=await supabase.from("etihad_records").update({data:nextData,updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",String(item.source.record_id));
    if(error){window.alert("Stopped after "+saved+" update(s). Error: "+error.message+". Previously saved Urdu names remain saved; refresh and retry the remaining rows.");onSaved();return;}
    saved++;
   }
   window.alert("Successfully updated Urdu names for "+saved+" existing products. No duplicate products were created.");onSaved();
  }catch(error){window.alert(error instanceof Error?error.message:"Could not import the Urdu product names file.");}
 }
 function downloadBulkTemplate(){
  const headers=["name","urduName","sku","barcode","category","unit","branch","cost","retailerPrice","salesmanPrice","qty","alert","unit2","unit2BaseQty","unit3","unit3BaseQty","unit4","unit4BaseQty","unit5","unit5BaseQty","supplier","supplierCode","supplierCost","supplierLeadDays"];
  const example=["Fish Nimko","فش نمکو","FN-001","","Snacks","Pack","","100","120","110","20","5","Carton","18","Dozen","12","Bundle","6","","","AH Traders","AH-FN-001","100","3"];
  const csv=[headers,example].map(line=>line.map(value=>{const text=String(value??"");return /[",\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;}).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="etihad-prime-product-import-template.csv";document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
 }
 function readBulkFile(file?:File){setBulkError("");setBulkSummary("");setBulkRows([]);setBulkName("");if(!file)return;setBulkName(file.name);if(!/\\.csv$/i.test(file.name)&&file.type!=="text/csv"&&file.type!=="application/vnd.ms-excel"){setBulkError("Please choose a .csv file. Excel .xlsx files are not supported; save the sheet as CSV UTF-8 first.");return;}const reader=new FileReader();reader.onload=()=>{try{const parsed=parseProductCsv(String(reader.result||""));setBulkRows(parsed);if(!parsed.length)setBulkError("The selected CSV contains no product rows.");}catch(e){setBulkRows([]);setBulkError(e instanceof Error?e.message:"Could not read this CSV.");}};reader.onerror=()=>setBulkError("Could not read the selected file. Please save it as CSV UTF-8 and try again.");reader.readAsText(file,"UTF-8");}
 async function applyBulkImport(){
  setBulkError("");setBulkSummary("");if(!bulkRows.length)return;if(bulkSettlement){setBulkError("Finish the pending supplier purchase settlement below before starting another import. This prevents duplicate or unfinished purchase records.");return;}
  const existing=(allRows||rows).filter(r=>r.collection==="mberp_products").map(r=>r.data);
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
   const targetBranch=explicitBranch||branches.find(b=>String(b.id)===String(candidateBranches[0]))||branches.find(b=>String(b.id)===String(selectedBranchId))||branches[0];
   if(!targetBranch){issues.push("Row "+item.__row+": branch is missing or not accessible.");continue;}
   const branchMatch=candidates.filter(p=>String(p.branchId||"")===String(targetBranch.id));
   if(branchMatch.length>1){issues.push("Row "+item.__row+": duplicate matching products already exist in branch "+targetBranch.name+". Resolve the duplicate before importing.");continue;}
   const match=branchMatch[0];
   const branchKeys=keys.map(k=>String(targetBranch.id)+"|"+k);
   if(branchKeys.some(k=>seen.has(k))){issues.push("Row "+item.__row+": duplicate SKU or barcode in this file for branch "+targetBranch.name+".");continue;}branchKeys.forEach(k=>seen.add(k));
   const numeric=(...keys:string[])=>{const raw=keys.map(key=>item[key]).find(value=>value!==undefined&&value!=="")??"";if(raw==="")return undefined;const v=Number(raw);return Number.isFinite(v)&&v>=0?v:NaN;};
   const costValue=numeric("cost"),retailValue=numeric("retailerprice")??numeric("retailprice")??numeric("price"),salesmanValue=numeric("salesmanprice"),alertValue=numeric("alert","lowstockalert"),qtyValue=numeric("qty","quantity"),supplierCostValue=numeric("suppliercost"),supplierLeadValue=numeric("supplierleaddays","supplierlead","supplierleadtime");
   if([costValue,retailValue,salesmanValue,alertValue,qtyValue,supplierCostValue,supplierLeadValue].some(v=>Number.isNaN(v))){issues.push("Row "+item.__row+": cost, retailer price, salesman price, quantity and alert must be non-negative numbers.");continue;}
   if(!match&&[costValue,retailValue,salesmanValue].some(v=>v===undefined)){issues.push("Row "+item.__row+": cost, Retailer Price and Salesman Price are required for a new product.");continue;}
   const baseUnit=String(item.unit||match?.unit||"piece").trim();
   const unitDefinitions:{name:string;factor:number}[]=[];
   for(let unitIndex=2;unitIndex<=5;unitIndex++){
    const unitName=String(item["unit"+unitIndex]||"").trim(),factorRaw=String(item["unit"+unitIndex+"baseqty"]??item["unit"+unitIndex+"qty"]??"").trim();
    if((unitName&&!factorRaw)||(!unitName&&factorRaw)){issues.push("Row "+item.__row+": for Unit "+unitIndex+", enter both its name and BaseQty, or leave both blank.");continue;}
    if(unitName){const factor=Number(factorRaw);if(!Number.isFinite(factor)||factor<=0){issues.push("Row "+item.__row+": "+unitName+" BaseQty must be a number greater than zero (e.g. 18, 12, 0.5).");continue;}unitDefinitions.push({name:unitName,factor});}
   }
   const upperName=String(item.upperunit||"").trim(),upperRaw=String(item.upperqty||"").trim(),lowerName=String(item.lowerunit||"").trim(),lowerRaw=String(item.lowerqty||"").trim();
   if((upperName&&!upperRaw)||(!upperName&&upperRaw)||(lowerName&&!lowerRaw)||(!lowerName&&lowerRaw)){issues.push("Row "+item.__row+": enter both the legacy upper/lower unit name and quantity, or leave both blank.");continue;}
   const upperFactor=upperRaw?Number(upperRaw):0,lowerCount=lowerRaw?Number(lowerRaw):0;
   if((upperRaw&&(!Number.isFinite(upperFactor)||upperFactor<=1))||(lowerRaw&&(!Number.isFinite(lowerCount)||lowerCount<=1))){issues.push("Row "+item.__row+": legacy upper/lower quantities must be greater than 1.");continue;}
   if(upperName)unitDefinitions.push({name:upperName,factor:upperFactor});
   if(lowerName)unitDefinitions.push({name:lowerName,factor:1/lowerCount});
   const unitNames=[baseUnit,...unitDefinitions.map(u=>u.name)];
   if(unitNames.some(x=>!x)||new Set(unitNames.map(searchText)).size!==unitNames.length){issues.push("Row "+item.__row+": base and additional unit names must be filled and unique.");continue;}
   const baseCost=costValue??n(match?.cost),baseRetail=retailValue??n(match?.retailerPrice??match?.price),baseSalesman=salesmanValue??n(match?.salesmanPrice??match?.retailerPrice??match?.price);
   const hasUnitInput=unitDefinitions.length>0;
   const roundPrice=(value:number)=>Math.round(value*100)/100;
   const packageUnits:any[]=[{name:baseUnit,conversionToBase:1,costPrice:baseCost,retailerPrice:baseRetail,salesmanPrice:baseSalesman},...unitDefinitions.map(u=>({name:u.name,conversionToBase:u.factor,costPrice:roundPrice(baseCost*u.factor),retailerPrice:roundPrice(baseRetail*u.factor),salesmanPrice:roundPrice(baseSalesman*u.factor),secondaryUnit:baseUnit,secondaryQty:u.factor}))];
   const packagingUnits=hasUnitInput?packageUnits:(match?.packagingUnits||undefined);
   const id=match?.id||makeId();
   const data={...(match||{}),id,name,urduName:String(item.urduname||item.nameurdu||match?.urduName||match?.nameUrdu||"").trim()||String(match?.urduName||match?.nameUrdu||""),sku:skuValue||String(match?.sku||""),barcode:barcodeValue||String(match?.barcode||""),category:String(item.category||match?.category||"").trim(),unit:baseUnit,branchId:String(targetBranch.id),...(costValue!==undefined?{cost:costValue}:{}),...(retailValue!==undefined?{price:retailValue,retailerPrice:retailValue}:{}),...(salesmanValue!==undefined?{salesmanPrice:salesmanValue}:{}),...(packagingUnits?{packagingUnits}:{}),...(alertValue!==undefined?{alert:alertValue,lowAt:alertValue}:{}),...(!match&&qtyValue!==undefined?{qty:qtyValue}:{})};
   const supplierNameValue=String(item.supplier||item.suppliername||"").trim();
    const supplierCodeValue=String(item.suppliercode||item.supplieritemcode||"").trim();
    const supplierCost=supplierCostValue??costValue??n(match?.cost);
    prepared.push({id,match,data,branchId:String(targetBranch.id),supplierName:supplierNameValue,supplierCode:supplierCodeValue,supplierCost,supplierLeadDays:supplierLeadValue,importQty:qtyValue??0});
  }
  if(issues.length){setBulkError(issues.slice(0,8).join(" ")+(issues.length>8?" And "+(issues.length-8)+" more issue(s).":""));return;}
  if(!prepared.length){setBulkError("No valid products were found.");return;}
  setBulkBusy(true);
  for(const item of prepared){
   const q=item.match?supabase.from("etihad_records").update({data:item.data,branch_ids:[item.branchId],updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",String(item.id)):supabase.from("etihad_records").insert({org_id:orgId,collection:"mberp_products",record_id:String(item.id),branch_ids:[item.branchId],data:item.data,updated_by:userId});
   const {error}=await q;if(error){setBulkError("Import stopped at "+item.data.name+": "+error.message+" Previously saved rows remain saved; correct the file and retry remaining rows.");setBulkBusy(false);onSaved();return;}
  }
  const updated=prepared.filter(x=>x.match).length,created=prepared.length-updated;
  const supplierGroups=new Map<string,any>();
  const supplierRecords=(allRows||rows).filter(r=>r.collection==="mberp_suppliers").map(r=>r.data||{});
  const productSupplierRows=(allRows||rows).filter(r=>r.collection==="mberp_product_suppliers");
  for(const item of prepared){
   const linkedSupplierRow=productSupplierRows.find(r=>String(r.data?.productId)===String(item.id)&&(!item.supplierName||searchText(r.data?.supplierName)===searchText(item.supplierName)));
   const resolvedSupplierName=String(item.supplierName||linkedSupplierRow?.data?.supplierName||"").trim();
   if(!resolvedSupplierName)continue;
   const linkedSupplierCost=linkedSupplierRow?.data?.cost!==null&&linkedSupplierRow?.data?.cost!==undefined&&linkedSupplierRow?.data?.cost!==""?n(linkedSupplierRow.data.cost):undefined;
   const resolvedSupplierCost=linkedSupplierCost!==undefined?linkedSupplierCost:n(item.supplierCost);
   if(!item.match&&n(item.importQty)>0&&(!Number.isFinite(resolvedSupplierCost)||resolvedSupplierCost<=0)){issues.push("Row "+(item.__row||"?")+": supplier cost must be greater than zero to create a purchase record.");continue;}
   const matchedSupplier=supplierRecords.find((s:any)=>searchText(s.name)===searchText(resolvedSupplierName));
   let supplier=matchedSupplier?.active===false&&matchedSupplier?.mergedInto?supplierRecords.find((s:any)=>String(s.id)===String(matchedSupplier.mergedInto)&&s.active!==false)||null:matchedSupplier?.active===false?null:matchedSupplier;
   if(!supplier){const sid=makeId();supplier={id:sid,name:resolvedSupplierName,phone:"",address:"",openingBalance:0,openingBalanceDate:new Date().toISOString().slice(0,10),active:true,createdAt:new Date().toISOString()};const {error}=await supabase.from("etihad_records").upsert({org_id:orgId,collection:"mberp_suppliers",record_id:String(sid),branch_ids:[],data:supplier,updated_by:userId},{onConflict:"org_id,collection,record_id"});if(error){setBulkError("Products were imported, but supplier "+resolvedSupplierName+" could not be saved: "+error.message+". Refresh before retrying.");setBulkBusy(false);onSaved();return;}supplierRecords.push(supplier);}
   const supplierId=String(supplier.id);
   const existingLink=productSupplierRows.find(r=>String(r.data?.productId)===String(item.id)&&((String(r.data?.supplierId||"")===supplierId)||searchText(r.data?.supplierName)===searchText(resolvedSupplierName)));
   const linkId=String(existingLink?.record_id||existingLink?.data?.id||makeId());
   const canonicalSupplierName=String(supplier.name||resolvedSupplierName);
   const linkData={...(existingLink?.data||{}),id:linkId,productId:String(item.id),productName:item.data.name,branchId:item.branchId,supplierId,supplierName:canonicalSupplierName,supplierCode:item.supplierCode||existingLink?.data?.supplierCode||"",cost:resolvedSupplierCost,leadDays:item.supplierLeadDays??existingLink?.data?.leadDays??null,updatedAt:new Date().toISOString(),...(!existingLink?{createdAt:new Date().toISOString()}:{})};
   const linkQuery=existingLink?supabase.from("etihad_records").update({data:linkData,branch_ids:[item.branchId],updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_product_suppliers").eq("record_id",linkId):supabase.from("etihad_records").insert({org_id:orgId,collection:"mberp_product_suppliers",record_id:linkId,branch_ids:[item.branchId],data:linkData,updated_by:userId});
   const {error:linkError}=await linkQuery;if(linkError){setBulkError("Products were imported, but supplier link for "+item.data.name+" could not be saved: "+linkError.message+". Refresh before retrying.");setBulkBusy(false);onSaved();return;}
   if(!supplierGroups.has(supplierId))supplierGroups.set(supplierId,{supplierId,supplierName:canonicalSupplierName,total:0,lines:[]});
   const group=supplierGroups.get(supplierId);const purchaseQty=item.match?0:Math.max(0,n(item.importQty));const lineTotal=Math.round(purchaseQty*Math.max(0,resolvedSupplierCost)*100)/100;if(lineTotal<=0)continue;group.total+=lineTotal;group.lines.push({...item,supplierName:canonicalSupplierName,supplierCost:resolvedSupplierCost,importQty:purchaseQty,supplierId,lineTotal});
  }
  const groups=[...supplierGroups.values()].filter(g=>g.total>0);
  setBulkSummary("Products saved: "+created+" new and "+updated+" updated. Existing stock quantities were protected. "+(supplierGroups.size?"Complete the supplier purchase step below to post these items into Purchase History and Supplier Accounts.":"No purchase was posted because no new product row had a supplier, a positive imported quantity and a supplier cost. Existing product stock was not changed."));
  setBulkRows([]);setBulkName("");setBulkBusy(false);
  if(groups.length){const batchId=makeId();const settlement={batchId,created,updated,groups};const paidAmounts=Object.fromEntries(groups.map(g=>[g.supplierId,"0"]));const draft={id:"csv-settlement-"+batchId,batchId,status:"pending",settlement,paidAmounts,paymentMethod:"Cash",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};const {error:draftError}=await supabase.from("etihad_records").upsert({org_id:orgId,collection:"mberp_import_settlements",record_id:draft.id,branch_ids:[String(prepared[0]?.branchId||"")].filter(Boolean),data:draft,updated_by:userId},{onConflict:"org_id,collection,record_id"});if(draftError){setBulkError("Products and supplier links were imported, but the supplier settlement draft could not be saved: "+draftError.message+". Do not re-import; refresh and contact support before continuing.");setBulkBusy(false);onSaved();return;}setBulkSettlement({...settlement,recordId:draft.id});setBulkPaid(paidAmounts);setBulkPaymentMethod("Cash");}
  onSaved();
 }

 async function persistBulkSettlement(paidAmounts=bulkPaid,paymentMethod=bulkPaymentMethod){if(!bulkSettlement)return;const recordId=String(bulkSettlement.recordId||("csv-settlement-"+bulkSettlement.batchId));const previous=(allRows||rows).find(r=>r.collection==="mberp_import_settlements"&&String(r.record_id)===recordId)?.data||{};const data={...previous,id:recordId,batchId:bulkSettlement.batchId,status:"pending",settlement:{batchId:bulkSettlement.batchId,created:bulkSettlement.created,updated:bulkSettlement.updated,groups:bulkSettlement.groups},paidAmounts,paymentMethod,updatedAt:new Date().toISOString()};const {error}=await supabase.from("etihad_records").upsert({org_id:orgId,collection:"mberp_import_settlements",record_id:recordId,branch_ids:Array.from(new Set((bulkSettlement.groups||[]).flatMap((g:any)=>g.lines.map((line:any)=>String(line.branchId||"")).filter(Boolean)))),data,updated_by:userId},{onConflict:"org_id,collection,record_id"});if(error)throw error;}
 async function finalizeBulkSupplierSettlement(){
  if(!bulkSettlement||bulkSettlementBusy)return;
  const groups=bulkSettlement.groups as any[];
  for(const group of groups){const paid=Number(bulkPaid[group.supplierId]??0);if(!Number.isFinite(paid)||paid<0||paid>group.total+0.000001){setBulkError("Payment for "+group.supplierName+" must be between Rs 0 and "+cash(group.total)+".");return;}}
  setBulkSettlementBusy(true);setBulkError("");
  try{await persistBulkSettlement();}catch(e){setBulkError("Could not save the supplier payment entries. Nothing was finalized: "+(e instanceof Error?e.message:"Unknown error"));setBulkSettlementBusy(false);return;}
  const now=new Date().toISOString(),today=now.slice(0,10);let totalValue=0,totalPaid=0,totalDue=0;
  for(const group of groups){
   let remainingPaid=Number(bulkPaid[group.supplierId]??0);
   for(let index=0;index<group.lines.length;index++){
    const line=group.lines[index];const paidForLine=Math.min(line.lineTotal,remainingPaid);remainingPaid=Math.max(0,remainingPaid-paidForLine);
    const purchaseId="csv-"+bulkSettlement.batchId+"-"+String(line.id);
    const invoiceNo="CSV-"+bulkSettlement.batchId.slice(-6).toUpperCase()+"-"+String(index+1).padStart(3,"0");
    const purchase={id:purchaseId,date:today,createdAt:now,invoiceNo,branchId:String(line.branchId),branchName:branches.find(b=>String(b.id)===String(line.branchId))?.name||"",productId:String(line.id),productName:String(line.data.name),sku:String(line.data.sku||""),qty:n(line.importQty),cost:n(line.supplierCost),purchaseQty:n(line.importQty),purchaseUnit:String(line.data.unit||"piece"),purchaseFactor:1,packageCost:n(line.supplierCost),subtotal:line.lineTotal,taxType:"none",taxRate:0,taxAmount:0,inputTaxRecoverable:false,inputTax:0,nonRecoverableTax:0,inventoryUnitCost:n(line.supplierCost),supplierId:String(group.supplierId),supplierName:String(group.supplierName),total:line.lineTotal,paid:paidForLine,balance:Math.max(0,line.lineTotal-paidForLine),batchNo:"",expiryDate:"",note:"Bulk product CSV import. Opening quantity was handled by the product import; this ledger entry does not add stock again.",importedVia:"bulk_product_csv",importBatchId:bulkSettlement.batchId};
    const {error:purchaseError}=await supabase.from("etihad_records").upsert({org_id:orgId,collection:"mberp_purchases",record_id:purchaseId,branch_ids:[String(line.branchId)],data:purchase,updated_by:userId},{onConflict:"org_id,collection,record_id"});
    if(purchaseError){setBulkError("Supplier ledger save stopped at "+line.data.name+": "+purchaseError.message+". Keep this settlement open and retry; saved rows use the same import reference.");setBulkSettlementBusy(false);onSaved();return;}
    const paymentId="csvpay-"+bulkSettlement.batchId+"-"+String(line.id);
    if(paidForLine>0){
     const payment={id:paymentId,purchaseId,supplierId:String(group.supplierId),supplierName:String(group.supplierName),invoiceNo,amount:paidForLine,method:bulkPaymentMethod,note:"Payment entered after bulk product CSV import",date:today,paidAt:now,createdAt:now,importBatchId:bulkSettlement.batchId};
     const {error:paymentError}=await supabase.from("etihad_records").upsert({org_id:orgId,collection:"mberp_supplier_payments",record_id:paymentId,branch_ids:[String(line.branchId)],data:payment,updated_by:userId},{onConflict:"org_id,collection,record_id"});
     if(paymentError){setBulkError("Purchase was recorded, but its payment could not be saved: "+paymentError.message+". Keep this settlement open and retry; the same reference will be reused.");setBulkSettlementBusy(false);onSaved();return;}
    }else{
     const {error:deletePaymentError}=await supabase.from("etihad_records").delete().eq("org_id",orgId).eq("collection","mberp_supplier_payments").eq("record_id",paymentId);
     if(deletePaymentError){setBulkError("Purchase was saved, but the previous payment entry could not be cleared: "+deletePaymentError.message+". Keep this settlement open and retry.");setBulkSettlementBusy(false);onSaved();return;}
    }
    totalValue+=line.lineTotal;totalPaid+=paidForLine;totalDue+=Math.max(0,line.lineTotal-paidForLine);
   }
  }
  const settlementRecordId=String(bulkSettlement.recordId||("csv-settlement-"+bulkSettlement.batchId));const completedDraft={id:settlementRecordId,batchId:bulkSettlement.batchId,status:"completed",settlement:{batchId:bulkSettlement.batchId,created:bulkSettlement.created,updated:bulkSettlement.updated,groups:bulkSettlement.groups},paidAmounts:bulkPaid,paymentMethod:bulkPaymentMethod,totals:{purchase:totalValue,paid:totalPaid,due:totalDue},completedAt:new Date().toISOString()};const {error:completionError}=await supabase.from("etihad_records").upsert({org_id:orgId,collection:"mberp_import_settlements",record_id:settlementRecordId,branch_ids:Array.from(new Set(groups.flatMap((g:any)=>g.lines.map((line:any)=>String(line.branchId||"")).filter(Boolean)))),data:completedDraft,updated_by:userId},{onConflict:"org_id,collection,record_id"});if(completionError){setBulkError("Purchases and payments were saved, but settlement history status could not be updated: "+completionError.message+". Do not re-import; check the supplier account first.");setBulkSettlementBusy(false);onSaved();return;}
  setBulkSummary("Import completed: "+bulkSettlement.created+" new products and "+bulkSettlement.updated+" updated. Supplier purchase value "+cash(totalValue)+" · Paid "+cash(totalPaid)+" · Due "+cash(totalDue)+". Supplier accounts have been updated.");
  setBulkSettlement(null);setBulkSettlementBusy(false);setBulkPaid({});onSaved();
 }
 function start(p?:Product){const units=Array.isArray(p?.packagingUnits)?p.packagingUnits:[];const upper=units.filter((x:any)=>n(x.conversionToBase)>1).sort((a:any,b:any)=>n(b.conversionToBase)-n(a.conversionToBase))[0];const lower=units.filter((x:any)=>n(x.conversionToBase)>0&&n(x.conversionToBase)<1).sort((a:any,b:any)=>n(a.conversionToBase)-n(b.conversionToBase))[0];setEditorOpen(true);setEditing(p||null);setName(p?.name||"");setUrduName(p?.urduName||p?.nameUrdu||"");setSku(p?.sku||"");setBarcode(p?.barcode||"");setCategory(p?.category||"");setUnit(String(p?.unit||"piece"));setQty(String(p?.qty??0));setCost(String(p?.cost??0));setPrice(String(p?.retailerPrice??p?.price??0));setSalesmanPrice(String(p?.salesmanPrice??p?.retailerPrice??p?.price??0));setAlertQty(String(p?.alert??p?.lowAt??5));setBranchId(p?.branchId||branches.find(b=>String(b.id)===String(selectedBranchId))?.id||branches[0]?.id||"");setProductNote(p?.note||"");setUpperUnit(String(upper?.name||""));setUpperQty(upper?String(n(upper.conversionToBase)):"");setLowerUnit(String(lower?.name||""));setLowerQty(lower?String(1/n(lower.conversionToBase)):"");setExtraUnits([]);setError("");}
 async function setProductStockToZero(product:Product){
  if(role!=="owner"){setError("Only the owner can directly set product stock to zero.");return;}
  const productId=String(product.id||"");
  const current=n(product.qty);
  if(!productId){setError("Product record ID is missing. Refresh and try again.");return;}
  if(current===0){setError("This product is already at zero stock.");return;}
  const reason=window.prompt("Reason for setting "+String(product.name||"this product")+" stock to zero (minimum 4 characters):","Physical stock count correction");
  if(reason===null)return;
  if(reason.trim().length<4){setError("Please enter a reason of at least 4 characters.");return;}
  if(!window.confirm("Set "+String(product.name||"this product")+" stock from "+current+" to 0? All remaining batch quantities will also be set to zero in one atomic adjustment. Full batch movement history will be retained."))return;
  setStockZeroBusy(productId);setError("");
  const {data,error}=await supabase.rpc("etihad_owner_set_product_stock_zero",{
   p_org_id:orgId,p_product_id:productId,p_reason:reason.trim(),p_request_id:makeId()
  });
  setStockZeroBusy("");
  if(error||!data?.success){
   setError("Could not set stock to zero: "+(error?.message||data?.message||"The adjustment was not confirmed."));
   onSaved();return;
  }
  const mismatch=n(data.reconciliationDifference);
  setError("Stock for "+String(product.name||"product")+" is now zero. "+n(data.batchCount)+" batch(es) were closed and their movements recorded. "+(Math.abs(mismatch)>0.000001?"The previous batch/product difference of "+mismatch+" was recorded in the adjustment audit. ":"")+"Previous sales and purchase records are unchanged.");
  onSaved();
 }
 async function deleteProduct(product:Product){
  if(role!=="owner"){setError("Only the business owner can delete products.");return;}
  if(!product.id){setError("This product has no valid record ID. Refresh and try again.");return;}
  if(n(product.qty)!==0){setError("This product still has stock ("+n(product.qty)+"). Bring its stock to zero through the stock adjustment workflow before deleting it.");return;}
  setDeleteTarget(product);setDeleteReason("");setError("");
 }
 async function confirmProductDelete(){
  const product=deleteTarget;if(!product)return;
  if(deleteReason.trim().length<3){setError("Enter a deletion reason of at least 3 characters.");return;}
  const productId=String(product.id);
  const source=rows.find(r=>r.collection==="mberp_products"&&String(r.record_id)===productId);
  if(!source){setError("Product record not found. Refresh and try again.");return;}
  const candidateIds=[...(Array.isArray((source as any).branch_ids)?(source as any).branch_ids:[]),product.branchId,branchId,...branchIds].map(v=>String(v||"").trim()).filter(Boolean);
  const validBranchIds=Array.from(new Set(candidateIds)).filter(id=>rows.some(r=>r.collection==="mberp_branches"&&String(r.data?.id||r.record_id)===id));
  if(!validBranchIds.length){setError("This product has no valid linked branch. Open Edit Product, select its correct branch, save, then retry.");return;}
  setBusy(true);setError("");
  const trashId=makeId(),deletedAt=new Date().toISOString();
  const archive={id:trashId,recordType:"Product",branchId:validBranchIds[0],originalCollection:"mberp_products",originalRecordId:productId,originalData:source.data,originalBranchIds:validBranchIds,itemLabel:String(product.name||productId),reason:deleteReason.trim(),deletedAt,deletedBy:userId,deletedByRole:role};
  const {error:archiveError}=await supabase.from("etihad_records").insert({org_id:orgId,collection:"mberp_recycle_bin",record_id:trashId,branch_ids:validBranchIds,data:archive,updated_by:userId});
  if(archiveError){setBusy(false);setError("Product was not moved to the Recycle Bin: "+archiveError.message);return;}
  const {data:deletedRows,error}=await supabase.from("etihad_records").delete().eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",productId).select("record_id");
  if(error||!deletedRows||deletedRows.length===0){
   const {error:cleanupError}=await supabase.from("etihad_records").delete().eq("org_id",orgId).eq("collection","mberp_recycle_bin").eq("record_id",trashId);
   setBusy(false);setError("Product was not removed. "+(error?.message||"The product record was not found.")+(cleanupError?" The archive copy remains safely in the Recycle Bin.":""));return;
  }
  setBusy(false);setDeleteTarget(null);setDeleteReason("");setError("Product moved to Recycle Bin. Its deletion reason and time have been recorded.");onSaved();
 }

 async function saveOnlyUrduName(){
  if(!editing?.id){setError("Open an existing product to update its Urdu name.");return;}
  setBusy(true);setError("");
  const source=rows.find(r=>r.collection==="mberp_products"&&String(r.record_id)===String(editing.id));
  if(!source){setBusy(false);setError("Product record not found. Refresh and try again.");return;}
  const nextData={...source.data,urduName:urduName.trim(),nameUrdu:urduName.trim()};
  const {error}=await supabase.from("etihad_records").update({data:nextData,updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",String(editing.id));
  setBusy(false);
  if(error){setError("Urdu name was not saved: "+error.message);return;}
  setEditing({...editing,urduName:urduName.trim(),nameUrdu:urduName.trim()});
  setError("Urdu invoice name saved. Other product details were not changed.");
  onSaved();
 }
 async function save(){
  setBusy(true);setError("");
  const id=editing?.id||makeId();
  const cleanNote=productNote.trim();
  const baseName=unit.trim()||"piece";
  if((upperUnit.trim()&&(!Number.isFinite(Number(upperQty))||Number(upperQty)<=1))||(lowerUnit.trim()&&(!Number.isFinite(Number(lowerQty))||Number(lowerQty)<=1))){setError("Enter a valid upper-unit quantity greater than 1 and a valid lower-unit quantity greater than 1.");setBusy(false);return;}
  if((upperUnit.trim()&&upperUnit.trim().toLowerCase()===baseName.toLowerCase())||(lowerUnit.trim()&&lowerUnit.trim().toLowerCase()===baseName.toLowerCase())||(upperUnit.trim()&&lowerUnit.trim()&&upperUnit.trim().toLowerCase()===lowerUnit.trim().toLowerCase())){setError("Upper, base and lower unit names must be different.");setBusy(false);return;}
  const previousNotes=Array.isArray(editing?.noteHistory)?editing.noteHistory:[];
  const noteChanged=!!cleanNote&&(!editing||cleanNote!==String(editing.note||"")||n(price)!==n(editing.retailerPrice??editing.price)||n(cost)!==n(editing.cost));
  const data={...(editing||{}),id,name:name.trim(),urduName:urduName.trim(),sku:sku.trim(),barcode:barcode.trim(),category:category.trim(),unit:unit.trim()||"piece",packagingUnits:(()=>{const raw:any[]=[{name:baseName,conversionToBase:1,costPrice:n(cost),retailerPrice:n(price),salesmanPrice:n(salesmanPrice),}];if(upperUnit.trim())raw.push({name:upperUnit.trim(),conversionToBase:Number(upperQty),costPrice:n(cost)*Number(upperQty),retailerPrice:n(price)*Number(upperQty),salesmanPrice:n(salesmanPrice)*Number(upperQty),secondaryUnit:baseName,secondaryQty:Number(upperQty)});if(lowerUnit.trim())raw.push({name:lowerUnit.trim(),conversionToBase:1/Number(lowerQty),costPrice:n(cost)/Number(lowerQty),retailerPrice:n(price)/Number(lowerQty),salesmanPrice:n(salesmanPrice)/Number(lowerQty),secondaryUnit:baseName,secondaryQty:1/Number(lowerQty)});return raw;})(),...(editing?{}:{qty:n(qty)}),cost:n(cost),price:n(price),retailerPrice:n(price),salesmanPrice:n(salesmanPrice),alert:n(alertQty),lowAt:n(alertQty),branchId,note:cleanNote,noteHistory:noteChanged?[...previousNotes,{note:cleanNote,at:new Date().toISOString(),oldRetailerPrice:editing?n(editing.retailerPrice??editing.price):null,newRetailerPrice:n(price),oldCost:editing?n(editing.cost):null,newCost:n(cost)}]:previousNotes};
  const branchIdsForRecord=[String(branchId)];
  if(!navigator.onLine){
    try{
      await saveOfflineRecordMutation({orgId,userId,collection:"mberp_products",recordId:String(id),branchIds:branchIdsForRecord,data,updatedBy:userId});
      setEditing(null);setEditorOpen(false);setError("Product saved securely on this device. It will sync to the cloud when internet returns.");
      onSaved();
    }catch(storageError){setError("Product was not saved. Secure offline storage failed: "+(storageError instanceof Error?storageError.message:"Unknown error"));}
    setBusy(false);return;
  }
  const payload={org_id:orgId,collection:"mberp_products",record_id:String(id),branch_ids:branchIdsForRecord,data,updated_by:userId};
  const q=editing?supabase.from("etihad_records").update({data,branch_ids:branchIdsForRecord,updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",String(id)):supabase.from("etihad_records").insert(payload);
  const {error}=await q;
  if(error&&(!error.code&&/fetch|network|timeout|offline|connection|request failed|load failed/i.test(error.message||""))){
    try{await saveOfflineRecordMutation({orgId,userId,collection:"mberp_products",recordId:String(id),branchIds:branchIdsForRecord,data,updatedBy:userId});setEditing(null);setEditorOpen(false);setError("Connection interrupted. Product saved securely on this device and queued for cloud sync.");onSaved();}
    catch(storageError){setError("Product was not confirmed and could not be queued offline: "+(storageError instanceof Error?storageError.message:"Unknown error"));}
  }else if(error)setError(error.message);
  else{setEditing(null);setEditorOpen(false);onSaved();}
  setBusy(false);
}
 function exportStockAdjustmentRegister(){const headers=["Request date","Reviewed date","Request reference","Product","Branch","Batch / lot","Delta quantity","Reason","Status","Review note"];const data=requests.map(x=>[x.requestedAt||x.date||"",x.reviewedAt||"",x.requestNo||x.id,x.productName,x.branchName,x.batchNo||"",x.delta,x.reason,x.status||"pending",x.reviewNote||""]);const csv=[headers,...data].map(row=>row.map(v=>{const raw=String(v??"");const safe=typeof v==="string"&&/^\s*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="Ihsan-Sweets-Supplies-Stock-Adjustment-Register.csv";a.click();URL.revokeObjectURL(url);}
 function exportBatchExpiryRegister(){const headers=["Status","Product","SKU","Batch","Branch","Received quantity","Available quantity","Received date","Expiry date","Days to expiry"];const data=batches.map(b=>{const days=daysUntilPakistanDate(b.expiryDate);const remaining=n(b.remainingQty??b.qty);const status=remaining<=0?"DEPLETED":days===null?"DATE MISSING":days<0?"EXPIRED":days<=7?"EXPIRES WITHIN 7 DAYS":days<=30?"EXPIRING SOON":"OK";return [status,b.productName,b.sku,b.batchNo,b.branchName,b.qty,remaining,b.receivedDate,b.expiryDate,days??""];});const csv=[headers,...data].map(row=>row.map(v=>{const raw=String(v??"");const safe=typeof v==="string"&&/^\s*[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';}).join(",")).join("\r\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="Ihsan-Sweets-Supplies-Batch-Expiry-Register.csv";a.click();URL.revokeObjectURL(url);}
 async function requestAdjustment(){if(!adjustProduct||!Number.isFinite(Number(adjustDelta))||Number(adjustDelta)===0||adjustReason.trim().length<4||(adjustmentBatches.length>0&&!adjustBatch)){setError("Choose a product and batch if batch-tracked, enter a non-zero quantity change and provide a reason.");return;}setAdjustBusy(true);setError("");const {data,error}=await supabase.rpc("etihad_request_stock_adjustment_v2",{p_org_id:orgId,p_product_id:String(adjustProduct),p_delta:Number(adjustDelta),p_reason:adjustReason.trim(),p_request_id:makeId(),p_batch_id:adjustBatch||null});setAdjustBusy(false);if(error||!data?.success){setError(error?.message||"Stock adjustment request was not saved.");return;}setAdjustDelta("");setAdjustReason("");setAdjustBatch("");onSaved();}
 async function reviewAdjustment(id:string,decision:"approved"|"rejected"){setReviewBusy(id);setError("");const {data,error}=await supabase.rpc("etihad_review_stock_adjustment",{p_org_id:orgId,p_request_id:id,p_decision:decision,p_note:""});setReviewBusy("");if(error||!data?.success){setError(error?.message||"Adjustment review failed.");return;}onSaved();}
 const catalogueProducts=products.filter(p=>{const term=productSearch.trim().toLowerCase();const matchesSearch=!term||[p.name,p.sku,p.barcode,p.category,p.note].some(v=>String(v||"").toLowerCase().includes(term));const matchesBranch=catalogueBranch==="all"||String(p.branchId)===catalogueBranch;const qty=n(p.qty),alertAt=Math.max(0,n(p.alert??p.alertQty));const matchesStock=catalogueStock==="all"||(catalogueStock==="negative"&&qty<0)||(catalogueStock==="zero"&&qty===0)||(catalogueStock==="low"&&qty>0&&qty<=alertAt)||(catalogueStock==="available"&&qty>alertAt);return matchesSearch&&matchesBranch&&matchesStock;});
 return <div className="product-manager">
 <div className="welcome-row"><div><div className="section-kicker">INVENTORY CONTROL</div><h1>Products & stock</h1><p>Manage catalogue details, selling prices and controlled stock adjustments.</p></div>{activeSection==="products"&&canEdit&&<button className="primary-btn product-add" onClick={()=>start()}>＋ Add product</button>}</div><nav className="product-stock-nav" aria-label="Product and stock sections">{[{id:"products",label:"Products"},{id:"product-history",label:"Product history"},{id:"suppliers",label:"Suppliers"},{id:"taxes",label:"Taxes"},{id:"price-adjustments",label:"Price adjustments"},{id:"inventory",label:"Inventory"},{id:"stock",label:"Stock"},{id:"transfer",label:"Stock transfer"},{id:"expiry",label:"Product expiry"},{id:"barcode",label:"Barcode printing"}].map(item=><button key={item.id} type="button" className={activeSection===item.id?"active":""} aria-current={activeSection===item.id?"page":undefined} onClick={()=>chooseSection(item.id)}>{item.label}</button>)}</nav>{error&&<div className="notice-error">{error}</div>}{activeSection==="expiry"&&batchReconciliationIssues.length>0&&<div className="panel product-editor"><h3>Stock / batch reconciliation warnings</h3><p className="muted">Batch-managed product quantities do not match their lot totals. Batch adjustments are blocked until the physical stock and lot records are reconciled.</p><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>BRANCH</th><th>PRODUCT STOCK</th><th>BATCH STOCK</th><th>DIFFERENCE</th></tr></thead><tbody>{batchReconciliationIssues.map(issue=><tr key={issue.id}><td><b>{issue.name}</b></td><td>{branches.find(b=>String(b.id)===String(issue.branchId))?.name||issue.branchId}</td><td>{n(issue.productQty)}</td><td>{n(issue.batchQty)}</td><td className={issue.difference<0?"negative-value":"warning-value"}>{issue.difference>0?"+":""}{n(issue.difference)}</td></tr>)}</tbody></table></div></div>}
 {activeSection==="products"&&canEdit&&<div className="panel product-editor"><div className="panel-head"><div><h3>Urdu product names · download & update</h3><p>Download your existing catalogue, fill the Urdu names, then upload it. Products are matched by SKU and branch; only Urdu names are updated.</p></div></div><div className="editor-actions"><button type="button" className="outline-btn" onClick={downloadUrduProductList}>↓ Download existing product list</button><label className="outline-btn">Upload corrected Urdu names<input type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(file)void importUrduProductNames(file);e.currentTarget.value="";}}/></label></div><p className="muted">Keep the SKU and branch columns unchanged. Enter your corrected spelling in urduName. The importer never creates products and never changes stock, prices or English catalogue names.</p></div>}{activeSection==="products"&&canEdit&&<div className="panel product-editor"><div id="products-section" className="panel-head"><div><h3>Bulk product upload & update</h3><p>Import a CSV file to add products or update matching products by SKU or barcode.</p></div></div><div className="catalogue-import-guidance"><b>Before importing</b><ul><li><b>New product:</b> quantity is saved as opening stock.</li><li><b>Existing product:</b> current stock is protected; CSV quantity is ignored.</li><li>Retailer and Salesman prices are entered per base unit. Add up to four more units (Carton, Box, Pack, Bundle, Dozen, etc.) with each unit’s BaseQty conversion. Use 18 for a carton of 18 base units, 12 for a dozen, or 0.5 for a half-unit. Prices for each package are calculated from the base-unit prices.</li><li>SKU or barcode duplicates, ambiguous branches, duplicate unit names and invalid numbers stop the entire import before saving.</li><li>Supplier cost defaults to Cost when blank; supplier purchase records are created only when supplier details are provided.</li></ul></div><div className="editor-actions"><button type="button" className="outline-btn" onClick={downloadBulkTemplate}>↓ Download sample CSV</button><label className="outline-btn">Choose CSV file<input type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={e=>{const file=e.currentTarget.files?.[0];readBulkFile(file);e.currentTarget.value="";}}/></label>{bulkName&&<span className="muted">{bulkName} · {bulkRows.length} rows</span>}</div>{bulkError&&<div className="notice-error">{bulkError}</div>}{bulkSummary&&<div className="pos-success">{bulkSummary}</div>}{bulkRows.length>0&&<><div className="table-wrap"><table><thead><tr><th>ROW</th><th>PRODUCT</th><th>SKU / BARCODE</th><th>COST</th><th>RETAIL PRICE</th><th>SALESMAN PRICE</th><th>QTY</th><th>SUPPLIER</th><th>SUPPLIER COST</th></tr></thead><tbody>{bulkRows.slice(0,8).map((r,i)=><tr key={i}><td>{r.__row}</td><td>{r.name}</td><td>{r.sku||r.barcode||"—"}</td><td>{r.cost||"—"}</td><td>{r.retailerprice||r.retailprice||r.price||"—"}</td><td>{r.salesmanprice||"—"}</td><td>{r.qty||r.quantity||"—"}</td><td>{r.supplier||r.suppliername||"—"}</td><td>{r.suppliercost||r.cost||"—"}</td></tr>)}</tbody></table></div><p className="muted">Previewing first {Math.min(8,bulkRows.length)} of {bulkRows.length} rows. The entire file is validated before any changes are saved.</p><button className="primary-btn" disabled={bulkBusy} onClick={applyBulkImport}>{bulkBusy?"Importing…":"Validate & import "+bulkRows.length+" products"}</button></>}</div>}{bulkSettlement&&<div className="panel product-editor"><div className="panel-head"><div><h3>Complete supplier purchase posting</h3><p>This is the required final step. Enter how much was paid to each supplier; confirming will create the purchase history and supplier account entries. The unpaid balance is recorded as due.</p></div></div>{bulkSettlement.groups.map((g:any)=><div key={g.supplierId} className="purchase-totals" style={{marginBottom:12}}><span><b>{g.supplierName}</b><small>{g.lines.length} imported product(s)</small></span><span>Total supplier cost <b>{cash(g.total)}</b></span><label>Amount paid (PKR)<input type="number" min="0" max={g.total} step="0.01" value={bulkPaid[g.supplierId]??"0"} onChange={e=>{const next={...bulkPaid,[g.supplierId]:e.target.value};setBulkPaid(next);void persistBulkSettlement(next).catch(err=>setBulkError("Payment entry is not yet saved: "+(err instanceof Error?err.message:"Unknown error")));}}/><small>Due: {cash(Math.max(0,g.total-n(bulkPaid[g.supplierId])))}</small><small>{n(bulkPaid[g.supplierId])>=g.total?"Status: Paid in full":n(bulkPaid[g.supplierId])>0?"Status: Partially paid · balance due":"Status: Unpaid · full amount due"}</small><div className="editor-actions"><button type="button" className="text-action" onClick={()=>{const next={...bulkPaid,[g.supplierId]:String(g.total)};setBulkPaid(next);void persistBulkSettlement(next).catch(err=>setBulkError("Payment entry is not yet saved: "+(err instanceof Error?err.message:"Unknown error")));}}>Mark fully paid</button><button type="button" className="text-action" onClick={()=>{const next={...bulkPaid,[g.supplierId]:"0"};setBulkPaid(next);void persistBulkSettlement(next).catch(err=>setBulkError("Payment entry is not yet saved: "+(err instanceof Error?err.message:"Unknown error")));}}>Keep full amount due</button></div></label></div>)}<div className="product-form-grid"><label>Payment method<select value={bulkPaymentMethod} onChange={e=>{setBulkPaymentMethod(e.target.value);void persistBulkSettlement(bulkPaid,e.target.value).catch(err=>setBulkError("Payment method is not yet saved: "+(err instanceof Error?err.message:"Unknown error")));}}>{["Cash","Bank transfer","Card","Mobile wallet"].map(x=><option key={x}>{x}</option>)}</select></label></div><div className="purchase-totals"><span>Total items cost <b>{cash(bulkSettlement.groups.reduce((a:number,g:any)=>a+g.total,0))}</b></span><span>Total paid <b>{cash(bulkSettlement.groups.reduce((a:number,g:any)=>a+n(bulkPaid[g.supplierId]),0))}</b></span><span>Total due <b>{cash(bulkSettlement.groups.reduce((a:number,g:any)=>a+Math.max(0,g.total-n(bulkPaid[g.supplierId])),0))}</b></span></div><div className="editor-actions"><button className="primary-btn" disabled={bulkSettlementBusy||bulkSettlement.groups.some((g:any)=>!Number.isFinite(Number(bulkPaid[g.supplierId]??0))||Number(bulkPaid[g.supplierId]??0)<0||Number(bulkPaid[g.supplierId]??0)>g.total)} onClick={finalizeBulkSupplierSettlement}>{bulkSettlementBusy?"Saving supplier accounts…":"Confirm paid amount & record supplier dues"}</button></div><p className="muted">Stock is not added again during settlement. The import already handled opening quantities. Purchase invoices and payments will appear in Supplier Account and Purchases.</p></div>}
 {activeSection==="barcode"&&<div className="panel product-editor"><div id="barcode-section" className="panel-head"><div><h3>Barcode label design</h3><p>Choose products, select a label layout and optional branding before printing.</p></div><button type="button" className="primary-btn" disabled={!labelSelection.length} onClick={printProductLabels}>Print selected labels ({labelSelection.length})</button></div>{labelSelection.length>0&&<p className="muted">Selected products: {products.filter(p=>labelSelection.includes(String(p.id))).map(p=>p.name).join(", ")}</p>}<div className="product-form-grid"><label>Select product<select value={labelProductPicker} onChange={e=>setLabelProductPicker(e.target.value)}><option value="">Choose a product</option>{products.filter(p=>role==="owner"||branchIds.includes(String(p.branchId))).map(p=><option key={p.id} value={String(p.id)}>{p.name} · {p.sku||p.barcode||"No code"} · PKR {n(p.retailerPrice??p.price)}</option>)}</select></label><button type="button" className="outline-btn" disabled={!labelProductPicker} onClick={()=>{setLabelSelection(current=>current.includes(labelProductPicker)?current:[...current,labelProductPicker]);setLabelProductPicker("");}}>Add product to print list</button><label>Label template<select value={labelTemplate} onChange={e=>setLabelTemplate(e.target.value)}><option value="compact">Compact · 4 columns</option><option value="standard">Standard · 3 columns</option><option value="wide">Wide · 2 columns</option></select></label><label>Company branding<input type="checkbox" checked={labelShowBrand} onChange={e=>setLabelShowBrand(e.target.checked)}/></label><label>Branch name<input type="checkbox" checked={labelShowBranch} onChange={e=>setLabelShowBranch(e.target.checked)}/></label><label>Product name<input type="checkbox" checked={labelShowName} onChange={e=>setLabelShowName(e.target.checked)}/></label><label>Selling price<input type="checkbox" checked={labelShowPrice} onChange={e=>setLabelShowPrice(e.target.checked)}/></label></div></div>}
 {activeSection==="products"&&<div className="panel data-panel"><div className="panel-head"><div><h3>Product catalogue</h3><p>{products.length} items · quantities are changed through stock transactions or approved adjustments. Barcode labels are managed only in Barcode printing.</p></div></div><div className="catalogue-toolbar"><label className="product-search">Search products<input type="search" value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="Name, SKU, barcode or category" /></label><label>Branch<select value={catalogueBranch} onChange={e=>setCatalogueBranch(e.target.value)}><option value="all">All accessible branches</option>{branches.filter(b=>role==="owner"||branchIds.includes(String(b.id))).map(b=><option key={b.id} value={String(b.id)}>{b.name}</option>)}</select></label><label>Stock status<select value={catalogueStock} onChange={e=>setCatalogueStock(e.target.value)}><option value="all">All stock</option><option value="available">In stock</option><option value="low">Low stock</option><option value="zero">Zero stock</option><option value="negative">Negative stock</option></select></label><span className="catalogue-result-count">{catalogueProducts.length} of {products.length} products</span><button type="button" className="text-action" onClick={()=>{setProductSearch("");setCatalogueBranch("all");setCatalogueStock("all");}}>Clear filters</button></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU / BARCODE</th><th>CATEGORY</th><th>UNIT</th><th>BRANCH</th><th>STOCK</th><th>COST</th><th>RETAILER SALE PRICE</th><th>SALESMAN PRICE</th><th>NOTE / OBSERVATION</th><th>ACTIONS</th></tr></thead><tbody>{catalogueProducts.map((p,i)=><tr key={p.id||i} onClick={()=>start(p)} style={{cursor:"pointer"}} title="Open product profile"><td><b>{p.name}</b></td><td>{p.sku||"—"}{p.barcode&&<small className="table-subline">{p.barcode}</small>}</td><td>{p.category||"—"}</td><td>{p.unit||"piece"}</td><td>{branches.find(b=>String(b.id)===String(p.branchId))?.name||"—"}</td><td>{n(p.qty)}</td><td>{cash(n(p.cost))}</td><td><b>{cash(n(p.retailerPrice??p.price))}</b></td><td><b>{cash(n(p.salesmanPrice??p.retailerPrice??p.price))}</b></td><td className="product-observation-cell">{p.note?<><span>{p.note}</span>{Array.isArray(p.noteHistory)&&p.noteHistory.length>0&&<small className="table-subline">{p.noteHistory.length} note / price update(s)</small>}</>:"—"}</td><td>{canEdit&&<button className="text-action" onClick={e=>{e.stopPropagation();start(p);}}>Open profile</button>}{role==="owner"&&<> <button className="text-action" disabled={stockZeroBusy===String(p.id)||n(p.qty)===0} onClick={e=>{e.stopPropagation();void setProductStockToZero(p);}}>{stockZeroBusy===String(p.id)?"Adjusting…":"Set stock to 0"}</button> <button className="text-action danger-action" disabled={busy||stockZeroBusy===String(p.id)} onClick={e=>{e.stopPropagation();void deleteProduct(p);}}>Delete</button></>}</td></tr>)}{catalogueProducts.length===0&&<tr><td colSpan={11} className="empty-cell">No products match your search.</td></tr>}</tbody></table></div></div>}
 {activeSection==="stock"&&canEdit&&<div id="stock-section" className="panel product-editor"><h3>Request stock adjustment</h3><p className="muted">Positive quantity adds stock; negative quantity reduces it. Stock changes only after owner approval.</p><div className="product-form-grid"><label>Product<select value={adjustProduct} onChange={e=>{setAdjustProduct(e.target.value);setAdjustBatch("");}}><option value="">Select product</option>{products.filter(p=>role==="owner"||branchIds.includes(String(p.branchId))).map(p=><option key={p.id} value={p.id}>{p.name} · Current {n(p.qty)}</option>)}</select></label>{adjustmentBatches.length>0&&<label>Batch / lot<select value={adjustBatch} onChange={e=>setAdjustBatch(e.target.value)}><option value="">Select affected batch</option>{adjustmentBatches.map((b:any)=><option key={b.id} value={b.id}>{b.batchNo||b.id} · Available {n(b.remainingQty??b.qty)} · Expiry {b.expiryDate||"Not recorded"}</option>)}</select><small>Batch quantities must reconcile with product stock before approval.</small></label>}<label>Quantity change (+ / −)<input type="number" step="any" value={adjustDelta} onChange={e=>setAdjustDelta(e.target.value)} placeholder="e.g. 5 or -2"/></label><label>Reason<input value={adjustReason} onChange={e=>setAdjustReason(e.target.value)} placeholder="Damage, count correction…"/></label></div><button className="primary-btn" disabled={adjustBusy||!adjustProduct||!adjustDelta||adjustReason.trim().length<4||(adjustmentBatches.length>0&&!adjustBatch)} onClick={requestAdjustment}>{adjustBusy?"Submitting…":"Submit for owner approval"}</button></div>}
 {activeSection==="stock"&&<div className="panel data-panel"><div id="stock-section" className="panel-head"><div><h3>Stock adjustment register</h3><p>Requester, reviewer, reason and before/after quantities are retained.</p></div><div className="editor-actions"><button className="outline-btn" onClick={exportStockAdjustmentRegister}>Export register CSV</button><span className="record-count">{requests.length} requests</span></div></div><div className="table-wrap"><table><thead><tr><th>DATE / REF</th><th>PRODUCT / BRANCH</th><th>CHANGE</th><th>REASON</th><th>STATUS</th><th>REVIEW</th></tr></thead><tbody>{requests.map((x:any)=><tr key={x.id}><td><b>{x.requestNo||x.id}</b><small className="table-subline">{x.requestedAt?new Date(x.requestedAt).toLocaleString():"—"}</small></td><td>{x.productName}<small className="table-subline">{x.branchName||"—"}{x.batchNo?" · Batch "+x.batchNo:""}</small></td><td className={n(x.delta)<0?"negative-value":"positive-value"}>{n(x.delta)>0?"+":""}{n(x.delta)}</td><td>{x.reason}</td><td><b>{String(x.status||"pending").toUpperCase()}</b><small className="table-subline">{x.reviewedAt?new Date(x.reviewedAt).toLocaleString():""}</small></td><td>{role==="owner"&&x.status==="pending"?<><button className="text-action" disabled={reviewBusy===x.id} onClick={()=>reviewAdjustment(String(x.id),"approved")}>Approve</button> <button className="text-action" disabled={reviewBusy===x.id} onClick={()=>reviewAdjustment(String(x.id),"rejected")}>Reject</button></>:x.reviewNote||"—"}</td></tr>)}{!requests.length&&<tr><td colSpan={6} className="empty-cell">No stock adjustment requests.</td></tr>}</tbody></table></div></div>}
 {activeSection==="expiry"&&<div className="panel product-editor"><div id="expiry-section" className="panel-head"><div><h3>Batch & expiry date control</h3><p>Assign existing on-hand stock to batches and monitor approaching expiry. New stock must be received through Purchases.</p></div><div className="editor-actions"><button className="outline-btn" onClick={exportBatchExpiryRegister}>Export batch / expiry CSV</button><span className="record-count">{batches.length} batches</span></div></div>{canEdit&&<><div className="product-form-grid"><label>Product<select value={batchProduct} onChange={e=>setBatchProduct(e.target.value)}><option value="">Select product</option>{products.filter(p=>role==="owner"||branchIds.includes(String(p.branchId))).map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku||"No SKU"}</option>)}</select></label><label>Batch / lot number<input value={batchCode} onChange={e=>setBatchCode(e.target.value)} placeholder="Optional batch reference"/></label><label>Existing stock assigned<input type="number" min="0.001" step="any" value={batchQty} onChange={e=>setBatchQty(e.target.value)}/></label><label>Branch<select value={batchBranch} onChange={e=>setBatchBranch(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Received date<input type="date" value={batchReceived} onChange={e=>setBatchReceived(e.target.value)}/></label><label>Expiry date<input type="date" value={batchExpiry} onChange={e=>setBatchExpiry(e.target.value)}/></label></div><button className="primary-btn" disabled={batchBusy||!batchProduct||!batchQty||!batchExpiry} onClick={saveBatch}>{batchBusy?"Saving batch…":"Save batch & expiry record"}</button></>}<div className="summary-grid" style={{margin:"12px 0"}}><div className="summary-card"><span>Expired stock</span><strong className="negative-value">{expiredBatchCount}</strong></div><div className="summary-card"><span>Expires within 7 days</span><strong className="negative-value">{urgentExpiryCount}</strong></div><div className="summary-card"><span>Expires in 8–30 days</span><strong className="warning-value">{upcomingExpiryCount}</strong></div></div>{expiryAttention.length>0&&<div className="notice-error" role="alert"><b>Expiry attention required:</b> {expiredBatchCount} expired batch(es), {urgentExpiryCount} batch(es) expiring within 7 days and {upcomingExpiryCount} batch(es) expiring within 8–30 days. Review available quantities before selling or replenishing these products.</div>}{expiryAttention.length===0&&<p className="muted">No active batches are expired or due to expire within the next 30 days.</p>}<div className="table-wrap"><table><thead><tr><th>STATUS</th><th>PRODUCT / SKU</th><th>BATCH</th><th>BRANCH</th><th>RECEIVED QTY</th><th>AVAILABLE QTY</th><th>RECEIVED</th><th>EXPIRY DATE</th></tr></thead><tbody>{batches.map((b:any)=>{const days=daysUntilPakistanDate(b.expiryDate);const remaining=n(b.remainingQty??b.qty);const status=remaining<=0?"DEPLETED":days===null?"DATE MISSING":days<0?"EXPIRED":days<=7?"EXPIRES WITHIN 7 DAYS":days<=30?"EXPIRING SOON":"OK";return <tr key={b.id}><td><b className={status==="EXPIRED"?"negative-value":status==="EXPIRES WITHIN 7 DAYS"?"negative-value":status==="EXPIRING SOON"?"warning-value":status==="DEPLETED"?"muted-value":"positive-value"}>{status}</b></td><td><b>{b.productName}</b><small className="table-subline">{b.sku||"—"}</small></td><td>{b.batchNo||"—"}</td><td>{b.branchName||"—"}</td><td>{n(b.qty)}</td><td><b>{remaining}</b></td><td>{b.receivedDate||"—"}</td><td>{b.expiryDate}{days!==null&&days>=0&&remaining>0&&<small className="table-subline">{days} days remaining</small>}{days===null&&<small className="table-subline">Expiry date needs review</small>}</td></tr>})}{!batches.length&&<tr><td colSpan={8} className="empty-cell">No batch or expiry records yet. Add a batch above to begin tracking.</td></tr>}</tbody></table></div><p className="muted">Tracked batches are deducted automatically during checkout using earliest-expiry-first allocation. Expired batches are excluded from sale availability. New returns restore quantities to their original sale batches when allocation history exists. Older sales without batch history are listed as unallocated returns and require inspection before manual batch assignment.</p><div className="panel-head" style={{marginTop:18}}><div><h3>Batch movement history</h3><p>Auditable batch receipts, FEFO sale deductions, original-batch returns and unallocated historical returns.</p></div><span className="record-count">{batchMovements.length} movements</span></div><div className="table-wrap"><table><thead><tr><th>DATE</th><th>MOVEMENT</th><th>PRODUCT</th><th>BATCH</th><th>BRANCH</th><th>REFERENCE</th><th>QTY</th><th>DETAIL</th></tr></thead><tbody>{batchMovements.map((m:any)=><tr key={m.id}><td>{m.date?new Date(m.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"}</td><td><b>{m.type==="sale_deduction"?"Sale deduction":m.type==="sale_return_restoration"?"Return to original batch":m.type==="unallocated_return"?"Unallocated return":String(m.type||"Movement").replaceAll("_"," ")}</b></td><td>{m.productName||"—"}</td><td>{m.batchNo||"—"}</td><td>{m.branchName||"—"}</td><td>{m.invoiceNo||m.returnId||m.saleId||"—"}</td><td className={n(m.qty)<0?"negative-value":"positive-value"}>{n(m.qty).toLocaleString("en-PK")}</td><td>{m.note||"—"}</td></tr>)}{!batchMovements.length&&<tr><td colSpan={8} className="empty-cell">No batch movements have been recorded yet. New batch-tracked sales and returns will appear here.</td></tr>}</tbody></table></div></div>}
 {activeSection==="suppliers"&&canEdit&&<div className="panel product-editor"><div id="suppliers-section" className="panel-head"><div><h3>Product suppliers</h3><p>Link supplier references, supplier product codes, purchase costs and lead times to catalogue items.</p></div><span className="record-count">{productSuppliers.length} links</span></div><div className="product-form-grid"><label>Product<select value={supplierProduct} onChange={e=>setSupplierProduct(e.target.value)}><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Supplier name<input value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="Supplier / vendor"/></label><label>Supplier item code<input value={supplierCode} onChange={e=>setSupplierCode(e.target.value)}/></label><label>Supplier cost<input type="number" min="0" value={supplierCost} onChange={e=>setSupplierCost(e.target.value)}/></label><label>Lead time (days)<input type="number" min="0" value={supplierLead} onChange={e=>setSupplierLead(e.target.value)}/></label></div><button className="primary-btn" disabled={supplierBusy||!supplierProduct||!supplierName.trim()} onClick={addProductSupplier}>{supplierBusy?"Saving…":"Link supplier to product"}</button><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SUPPLIER</th><th>SUPPLIER CODE</th><th>COST</th><th>LEAD TIME</th></tr></thead><tbody>{productSuppliers.map((x:any)=><tr key={x.id}><td>{x.productName}</td><td>{x.supplierName}</td><td>{x.supplierCode||"—"}</td><td>{x.cost==null?"—":cash(n(x.cost))}</td><td>{x.leadDays==null?"—":x.leadDays+" days"}</td></tr>)}{!productSuppliers.length&&<tr><td colSpan={5} className="empty-cell">No product-supplier links recorded.</td></tr>}</tbody></table></div></div>}
 {activeSection==="taxes"&&canEdit&&<div className="panel product-editor"><div id="taxes-section" className="panel-head"><div><h3>Product taxes</h3><p>Maintain reusable tax rates for product and invoice workflows.</p></div><span className="record-count">{productTaxes.length} rates</span></div><div className="product-form-grid"><label>Tax name<input value={taxName} onChange={e=>setTaxName(e.target.value)} placeholder="e.g. Sales Tax"/></label><label>Rate (%)<input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={e=>setTaxRate(e.target.value)}/></label><label>Calculation<select value={taxType} onChange={e=>setTaxType(e.target.value)}><option value="exclusive">Added to price</option><option value="inclusive">Included in price</option></select></label></div><button className="primary-btn" disabled={taxBusy||!taxName.trim()||taxRate===""} onClick={addProductTax}>{taxBusy?"Saving…":"Add tax rate"}</button><div className="table-wrap"><table><thead><tr><th>TAX</th><th>RATE</th><th>CALCULATION</th><th>STATUS</th></tr></thead><tbody>{productTaxes.map((x:any)=><tr key={x.id}><td>{x.name}</td><td>{x.rate}%</td><td>{x.type==="inclusive"?"Included":"Added"}</td><td>{x.active===false?"Inactive":"Active"}</td></tr>)}{!productTaxes.length&&<tr><td colSpan={4} className="empty-cell">No tax rates configured.</td></tr>}</tbody></table></div><p className="muted">Tax rates are stored as configuration records. Automatic tax calculation on invoices and purchases is a separate integration step.</p></div>}
 {activeSection==="price-adjustments"&&canEdit&&<div className="panel product-editor"><div id="price-adjustments-section" className="panel-head"><div><h3>Price readjustment</h3><p>Preview a category-wide or catalogue-wide price change before applying it.</p></div></div><div className="product-form-grid"><label>Adjustment type<select value={priceMode} onChange={e=>{setPriceMode(e.target.value);setPricePreview([]);}}><option value="percent">Percentage increase</option><option value="fixed">Fixed PKR increase</option></select></label><label>{priceMode==="percent"?"Increase (%)":"Increase (PKR)"}<input type="number" min="0.01" step="any" value={priceValue} onChange={e=>{setPriceValue(e.target.value);setPricePreview([]);}}/></label><label>Apply to<select value={priceScope} onChange={e=>{setPriceScope(e.target.value);setPricePreview([]);}}><option value="all">All products</option><option value="category">One category</option></select></label>{priceScope==="category"&&<label>Category<select value={priceCategory} onChange={e=>setPriceCategory(e.target.value)}><option value="">Select category</option>{[...new Set(products.map(p=>String(p.category||"")).filter(Boolean))].map(c=><option key={c} value={c}>{c}</option>)}</select></label>}</div><div className="editor-actions"><button className="outline-btn" onClick={previewPriceChange}>Preview price changes</button>{pricePreview.length>0&&<button className="primary-btn" disabled={priceBusy} onClick={applyPriceChange}>{priceBusy?"Applying…":"Confirm & apply "+pricePreview.length+" prices"}</button>}</div>{pricePreview.length>0&&<div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>OLD PRICE</th><th>NEW PRICE</th></tr></thead><tbody>{pricePreview.slice(0,30).map(x=><tr key={x.id}><td>{x.name}</td><td>{cash(n(x.oldPrice))}</td><td><b>{cash(n(x.newPrice))}</b></td></tr>)}</tbody></table><p className="muted">Previewing {Math.min(30,pricePreview.length)} of {pricePreview.length} products. Confirm only after reviewing the changes.</p></div>}</div>}

{activeSection==="product-history"&&<div className="panel data-panel"><div className="panel-head"><div><h3>Product history</h3><p>Customer purchases, supplier receipts and returns with recorded date and time.</p></div><span className="record-count">{productHistory.length} records</span></div><div className="product-form-grid"><label>Choose product<select value={historyProduct} onChange={e=>setHistoryProduct(e.target.value)}><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.sku?" · "+p.sku:""}</option>)}</select></label></div><div className="editor-actions"><button className="outline-btn" disabled={!historyProduct||!productHistory.length} onClick={exportProductHistoryCsv}>Export Excel-compatible CSV</button><button className="primary-btn" disabled={!historyProduct||!productHistory.length} onClick={printProductHistory}>Print / Save PDF</button></div><div className="table-wrap"><table><thead><tr><th>DATE & TIME</th><th>TYPE</th><th>REFERENCE</th><th>CUSTOMER</th><th>SUPPLIER</th><th>BRANCH</th><th>QTY</th><th>DETAILS</th></tr></thead><tbody>{productHistory.map((x:any,i:number)=><tr key={x.type+":"+x.reference+":"+i}><td>{x.date?new Date(x.date).toLocaleString("en-PK",{timeZone:"Asia/Karachi"}):"—"}</td><td>{x.type}</td><td>{x.reference||"—"}</td><td>{x.customer||"—"}</td><td>{x.supplier||"—"}</td><td>{x.branch||"—"}</td><td className={x.qty<0?"negative-value":"positive-value"}>{x.qty>0?"+":""}{x.qty}</td><td>{x.detail||"—"}</td></tr>)}{!productHistory.length&&<tr><td colSpan={8} className="empty-cell">{historyProduct?"No history for this product yet.":"Select a product to view its complete transaction history."}</td></tr>}</tbody></table></div></div>}
 {activeSection==="inventory"&&<div className="panel data-panel"><div id="inventory-section" className="panel-head"><div><h3>Stock movement history</h3><p>Purchases, sales, returns, transfers and approved adjustments.</p></div><span className="record-count">{movements.length} movements</span></div><div className="table-wrap"><table><thead><tr><th>DATE</th><th>TYPE</th><th>REFERENCE</th><th>PRODUCT</th><th>BRANCH</th><th>QUANTITY CHANGE</th><th>DETAILS</th></tr></thead><tbody>{movements.map((m:any,i:number)=><tr key={m.id||i}><td>{m.date?new Date(m.date).toLocaleDateString():"—"}</td><td><b>{m.type}</b></td><td>{m.reference||"—"}</td><td>{m.productName||"—"}</td><td>{m.branchName||"—"}</td><td className={m.qty<0?"negative-value":"positive-value"}>{m.qty>0?"+":""}{m.qty}</td><td>{m.note||"—"}</td></tr>)}{!movements.length&&<tr><td colSpan={7} className="empty-cell">No recorded stock movements yet.</td></tr>}</tbody></table></div></div>}
 {activeSection==="products"&&canEdit&&editorOpen&&<main className="product-profile-page" style={{position:"fixed",inset:0,zIndex:10000,overflowY:"auto",background:"var(--background, #f5f7fa)",padding:"24px 16px"}}><div style={{width:"100%",maxWidth:1100,margin:"0 auto",padding:24,background:"var(--panel, #fff)",border:"1px solid var(--border, #e5e7eb)",borderRadius:16,boxSizing:"border-box"}}><div className="panel-head" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}><h3>{editing?"Product profile":"Add product"}</h3><button type="button" className="outline-btn" onClick={()=>{setEditorOpen(false);setEditing(null);}}>← Back to Products</button></div><div className="product-form-grid"><label>Product name (English)<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Urdu invoice name<input dir="rtl" lang="ur" value={urduName} onChange={e=>setUrduName(e.target.value)} placeholder="مثلاً فش نمکو"/>{editing&&<button type="button" className="outline-btn" style={{marginTop:8}} disabled={busy} onClick={saveOnlyUrduName}>{busy?"Saving…":"Save Urdu name only"}</button>}</label><label>SKU / Product code<input value={sku} onChange={e=>setSku(e.target.value)}/></label><label>Barcode<input value={barcode} onChange={e=>setBarcode(e.target.value)} placeholder="Scan or enter barcode"/></label><label>Category<input value={category} onChange={e=>setCategory(e.target.value)}/></label><label>Base unit<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="e.g. Box, Pack, Bundle"/></label><label>Branch<select value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{!editing&&<label>Opening quantity<input type="number" min="0" value={qty} onChange={e=>setQty(e.target.value)}/></label>}<label>Cost price<input type="number" min="0" value={cost} onChange={e=>setCost(e.target.value)}/></label><label>Retailer sale price<input type="number" min="0" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></label><label>Salesman price<input type="number" min="0" step="0.01" value={salesmanPrice} onChange={e=>setSalesmanPrice(e.target.value)}/></label><label>Low-stock alert<input type="number" min="0" value={alertQty} onChange={e=>setAlertQty(e.target.value)}/></label></div><div className="panel" style={{padding:14,marginTop:14}}><div className="panel-head"><div><h3>Product unit levels</h3><p>Enter prices only for the base unit. Upper and lower unit prices and costs are calculated automatically.</p></div></div><div className="product-form-grid"><label>Upper unit (e.g. CTN)<input value={upperUnit} onChange={e=>setUpperUnit(e.target.value)} placeholder="e.g. CTN"/></label><label>How many base units in 1 upper unit?<input type="number" min="2" step="any" value={upperQty} onChange={e=>setUpperQty(e.target.value)} placeholder="e.g. 18"/></label><label>Lower unit (e.g. Piece)<input value={lowerUnit} onChange={e=>setLowerUnit(e.target.value)} placeholder="e.g. Piece"/></label><label>How many lower units in 1 base unit?<input type="number" min="2" step="any" value={lowerQty} onChange={e=>setLowerQty(e.target.value)} placeholder="e.g. 20"/></label></div><div className="table-wrap"><table><thead><tr><th>UNIT LEVEL</th><th>CONVERSION</th><th>COST</th><th>RETAILER PRICE</th><th>SALESMAN PRICE</th></tr></thead><tbody><tr><td><b>{upperUnit||"Upper unit"}</b></td><td>{upperUnit&&n(upperQty)>1?"1 "+upperUnit+" = "+n(upperQty)+" "+unit:"Enter upper-unit quantity"}</td><td>{upperUnit&&n(upperQty)>1?cash(n(cost)*n(upperQty)):"—"}</td><td>{upperUnit&&n(upperQty)>1?cash(n(price)*n(upperQty)):"—"}</td><td>{upperUnit&&n(upperQty)>1?cash(n(salesmanPrice)*n(upperQty)):"—"}</td></tr><tr><td><b>{unit||"Base unit"}</b> <small>BASE · enter prices above</small></td><td>1 {unit||"base unit"}</td><td>{cash(n(cost))}</td><td>{cash(n(price))}</td><td>{cash(n(salesmanPrice))}</td></tr><tr><td><b>{lowerUnit||"Lower unit"}</b></td><td>{lowerUnit&&n(lowerQty)>1?"1 "+unit+" = "+n(lowerQty)+" "+lowerUnit:"Enter lower-unit quantity"}</td><td>{lowerUnit&&n(lowerQty)>1?cash(n(cost)/n(lowerQty)):"—"}</td><td>{lowerUnit&&n(lowerQty)>1?cash(n(price)/n(lowerQty)):"—"}</td><td>{lowerUnit&&n(lowerQty)>1?cash(n(salesmanPrice)/n(lowerQty)):"—"}</td></tr></tbody></table></div><div className="catalogue-import-guidance"><b>How automatic pricing works</b><p>Enter the number of base units in one upper unit. When the total quantity in the sale reaches that threshold, the app automatically switches to Salesman Price. Below the threshold it uses Retailer Price. Changing the sale unit does not remove the threshold rule.</p><p>Example: 1 Carton = 18 Boxes. At 18 or more base units, Salesman Price is selected. All stock quantities are stored in the base unit ({unit||"base unit"}).</p></div></div><label className="product-note-field">Optional product note / observation<textarea rows={3} value={productNote} onChange={e=>setProductNote(e.target.value)} placeholder="e.g. retailer price revised due to supplier cost change, quality observation, or other note"/></label><div className="editor-actions"><button className="outline-btn" onClick={()=>start()}>Clear form</button><button className="primary-btn" disabled={busy||!name.trim()||!branchId} onClick={save}>{busy?"Saving…":"Save product"}</button></div></div></main>}
 {deleteTarget&&<div className="eps-modal-backdrop" role="presentation" onClick={()=>{if(!busy)setDeleteTarget(null);}}><section className="eps-modal" role="dialog" aria-modal="true" aria-labelledby="delete-product-title" onClick={e=>e.stopPropagation()}><div className="eps-modal-icon">!</div><h3 id="delete-product-title">Move product to Recycle Bin</h3><p><b>{deleteTarget.name||"Selected product"}</b> will be removed from the active catalogue. Its original details will be saved for owner recovery.</p><label>Reason for deletion<textarea rows={3} value={deleteReason} onChange={e=>setDeleteReason(e.target.value)} placeholder="Enter why this product is being removed…"/></label><div className="eps-modal-actions"><button type="button" className="outline-btn" disabled={busy} onClick={()=>setDeleteTarget(null)}>Cancel</button><button type="button" className="danger-btn" disabled={busy||deleteReason.trim().length<3} onClick={confirmProductDelete}>{busy?"Moving…":"Move to Recycle Bin"}</button></div></section></div>}
 </div>;
}
