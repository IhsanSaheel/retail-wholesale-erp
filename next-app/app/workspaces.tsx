"use client";

import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Row = { collection: string; record_id: string; data: Record<string, any> };
type Product = Record<string, any>;
type Props = { orgId: string; userId: string; role: string; branchIds: string[]; rows: Row[]; onSaved: () => void };

const n = (v: any) => Number(v || 0);
const cash = (v: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(v);
const makeId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 13);
const esc = (v: any) => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function POSWorkspace({ orgId, userId, role, branchIds, rows, onSaved }: Props) {
  const supabase = useMemo(() => getSupabase(), []);
  const products = rows.filter(r => r.collection === "mberp_products").map(r => r.data).filter(p => p.active !== false);
  const branches = rows.filter(r => r.collection === "mberp_branches").map(r => r.data).filter(b => b.active !== false && (!branchIds.length || branchIds.includes(String(b.id))));
  const sales = rows.filter(r => r.collection === "mberp_sales").map(r => r.data);
  const [cart, setCart] = useState<{ product: Product; qty: number }[]>([]);
  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id || "");
  const [received, setReceived] = useState("");
  const [method, setMethod] = useState("Cash");
  const [resolution, setResolution] = useState("change");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"new" | "history">("new");
  const total = cart.reduce((s, x) => s + n(x.product.price) * x.qty, 0);
  const receivedAmount = received === "" ? total : Math.max(0, n(received));
  const over = Math.max(0, receivedAmount - total);
  const applied = Math.min(total, receivedAmount);
  const balance = Math.max(0, total - applied);
  const matches = products.filter(p => [p.name, p.sku, p.category].join(" ").toLowerCase().includes(search.toLowerCase()));
  const customers = Array.from(new Map(sales.filter(s => s.customerName && s.customerName !== "Walk-in Customer").map(s => [s.customerPhone || s.customerName, { name: s.customerName, phone: s.customerPhone || "" }])).values()).filter(c => (c.name + " " + c.phone).toLowerCase().includes(customerSearch.toLowerCase())).slice(0, 6);
  const recent = [...sales].sort((a,b)=>new Date(b.date||0).getTime()-new Date(a.date||0).getTime()).slice(0,30);
  const add = (p: Product) => setCart(prev => { const found = prev.find(x => x.product.id === p.id); return found ? prev.map(x => x.product.id === p.id ? { ...x, qty: x.qty + 1 } : x) : [...prev, { product: p, qty: 1 }]; });
  const changeQty = (id: string, qty: number) => setCart(prev => qty <= 0 ? prev.filter(x => x.product.id !== id) : prev.map(x => x.product.id === id ? { ...x, qty } : x));

  async function saveSale() {
    setMessage("");
    if (!cart.length) { setMessage("Add at least one product to the bill."); return; }
    if (!branchId) { setMessage("Choose a branch before saving this sale."); return; }
    if (over > 0 && resolution === "advance" && (!customerPhone.trim() || customerName === "Walk-in Customer")) { setMessage("Select a saved customer or enter a customer name and phone to keep an advance."); return; }
    setSaving(true);
    const receiptWindow = window.open("", "_blank", "width=420,height=700");
    const id = makeId();
    const date = new Date().toISOString();
    const year = new Date().getFullYear();
    const invoiceNo = `INV-${year}-${String(sales.length + 1).padStart(5, "0")}`;
    const branch = branches.find(b => String(b.id) === String(branchId));
    const changeReturned = over > 0 && resolution === "change" ? over : 0;
    const customerAdvance = over > 0 && resolution === "advance" ? over : 0;
    const staffTip = over > 0 && resolution === "tip" ? over : 0;
    const sale = {
      id, date, invoiceNo, branchId, branchName: branch?.name || "",
      customerName: customerName.trim() || "Walk-in Customer", customerPhone: customerPhone.trim(),
      items: cart.map(x => ({ productId: x.product.id, name: x.product.name, sku: x.product.sku || "", qty: x.qty, cost: n(x.product.cost), price: n(x.product.price), unit: x.product.unit || "piece" })),
      subtotal: total, total, paid: applied, balance, receivedAmount, changeReturned, customerAdvance, staffTip,
      overpaymentResolution: over ? resolution : "none", paymentMethod: method, note
    };
    const record = { org_id: orgId, collection: "mberp_sales", record_id: id, branch_ids: [String(branchId)], data: sale, updated_by: userId };
    const { error: saleError } = await supabase.from("etihad_records").insert(record);
    if (saleError) { receiptWindow?.close(); setMessage("Sale could not be saved: " + saleError.message); setSaving(false); return; }

    let followupError: string | null = null;
    if (applied > 0) {
      const paymentId = makeId();
      const { error } = await supabase.from("etihad_records").insert({
        org_id: orgId, collection: "mberp_payments", record_id: paymentId, branch_ids: [String(branchId)], updated_by: userId,
        data: { id: paymentId, date, amount: applied, method, type: "sale_payment", saleId: id, invoiceNo, receiptNo: "REC-" + invoiceNo, branchId, branchName: branch?.name || "", customerName: sale.customerName, customerPhone: sale.customerPhone, note: "Payment received at point of sale" }
      });
      if (error) followupError = "Sale saved, but payment history could not be saved: " + error.message;
    }
    if (customerAdvance > 0) {
      const creditId = makeId();
      const { error } = await supabase.from("etihad_records").insert({
        org_id: orgId, collection: "mberp_customer_account_credits", record_id: creditId, branch_ids: [], updated_by: userId,
        data: { id: creditId, key: "phone:" + sale.customerPhone, customerName: sale.customerName, customerPhone: sale.customerPhone, amount: customerAdvance, balance: customerAdvance, date, type: "overpayment_advance", sourceSaleId: id, invoiceNo, branchId, branchName: branch?.name || "", note: "Extra amount received and retained as customer account advance." }
      });
      if (error) followupError = "Sale saved, but customer advance could not be recorded: " + error.message;
    }
    if (staffTip > 0) {
      const tipId = makeId();
      const { error } = await supabase.from("etihad_records").insert({
        org_id: orgId, collection: "mberp_payments", record_id: tipId, branch_ids: [String(branchId)], updated_by: userId,
        data: { id: tipId, date, amount: staffTip, method, type: "staff_tip", saleId: id, invoiceNo, receiptNo: "TIP-" + invoiceNo, branchId, branchName: branch?.name || "", customerName: sale.customerName, customerPhone: sale.customerPhone, note: "Staff tip; excluded from sales revenue." }
      });
      if (error) followupError = "Sale saved, but tip could not be recorded separately: " + error.message;
    }

    const receipt = `<!doctype html><html><head><title>${esc(invoiceNo)}</title><style>body{font:14px Arial;color:#18253b;max-width:360px;margin:24px auto;padding:10px}h2{text-align:center;margin:0}p{text-align:center;color:#667}hr{border:0;border-top:1px dashed #aaa}table{width:100%;border-collapse:collapse}td{padding:7px 0;border-bottom:1px solid #eee}.r{text-align:right}.total{font-weight:bold;font-size:18px}.small{font-size:12px;color:#667}</style></head><body><h2>ETIHAD TRADERS</h2><p>Sales receipt</p><hr/><div>Invoice: ${esc(invoiceNo)}</div><div>Date: ${esc(new Date(date).toLocaleString())}</div><div>Customer: ${esc(sale.customerName)}</div><div>Phone: ${esc(sale.customerPhone || "—")}</div><div>Branch: ${esc(sale.branchName)}</div><hr/><table>${sale.items.map((x:any)=>`<tr><td>${esc(x.name)} × ${x.qty}</td><td class="r">${cash(x.qty*x.price)}</td></tr>`).join("")}</table><hr/><table><tr><td>Total bill</td><td class="r">${cash(total)}</td></tr><tr><td>Amount received</td><td class="r">${cash(receivedAmount)}</td></tr><tr><td>Applied to invoice</td><td class="r">${cash(applied)}</td></tr>${changeReturned?`<tr><td>Change returned</td><td class="r">${cash(changeReturned)}</td></tr>`:""}${customerAdvance?`<tr><td>Customer advance saved</td><td class="r">${cash(customerAdvance)}</td></tr>`:""}${staffTip?`<tr><td>Staff tip (not sales)</td><td class="r">${cash(staffTip)}</td></tr>`:""}<tr><td>Balance due</td><td class="r">${cash(balance)}</td></tr></table><hr/><p class="small">Payment method: ${esc(method)}</p><p>Thank you for shopping with us.</p><script>window.onload=()=>window.print()<\/script></body></html>`;
    if (receiptWindow) { receiptWindow.document.open(); receiptWindow.document.write(receipt); receiptWindow.document.close(); }
    setCart([]); setReceived(""); setCustomerName("Walk-in Customer"); setCustomerPhone(""); setNote("");
    setMessage(followupError || "Sale saved successfully. Receipt opened in a new window.");
    setSaving(false); onSaved();
  }

  return <div className="pos-workspace">
    <div className="pos-heading"><div><div className="section-kicker">POINT OF SALE</div><h2>New sale</h2><p>Build a bill, select a customer and settle the payment.</p></div><div className="pos-tabs"><button className={tab==="new"?"selected":""} onClick={()=>setTab("new")}>New sale</button><button className={tab==="history"?"selected":""} onClick={()=>setTab("history")}>Sales history</button></div></div>
    {message && <div className={message.startsWith("Sale saved")?"pos-success":"notice-error"}>{message}</div>}
    {tab==="history" ? <div className="panel data-panel"><div className="panel-head"><div><h3>Recent invoices</h3><p>Latest sales from the shared Etihad Traders database</p></div></div><div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th></tr></thead><tbody>{recent.map((s,i)=><tr key={s.id||i}><td><b>{s.invoiceNo||"—"}</b></td><td>{s.customerName||"Walk-in"}</td><td>{new Date(s.date).toLocaleDateString()}</td><td>{cash(n(s.total))}</td><td>{cash(n(s.paid))}</td><td>{cash(n(s.balance))}</td></tr>)}</tbody></table></div></div> :
    <div className="pos-layout">
      <section className="pos-catalog panel"><div className="pos-catalog-head"><div><h3>Choose products</h3><p>Tap a product shortcut to add it to the bill</p></div><span className="record-count">{products.length} products</span></div><input className="pos-search" placeholder="Search product name, SKU or category…" value={search} onChange={e=>setSearch(e.target.value)}/><div className="pos-products">{matches.map((p,i)=><button className="pos-product" key={p.id||i} onClick={()=>add(p)}><span className="product-initial">{String(p.name||"P").slice(0,1).toUpperCase()}</span><b>{p.name}</b><small>{p.sku||p.category||"Product"}</small><strong>{cash(n(p.price))}</strong><em>+ Add</em></button>)}{!matches.length&&<div className="empty-cell">No products found.</div>}</div></section>
      <section className="pos-bill panel"><div className="bill-title"><div><h3>Current bill</h3><p>{cart.reduce((s,x)=>s+x.qty,0)} items in this sale</p></div><button className="text-action" onClick={()=>setCart([])}>Clear</button></div>
        <div className="customer-box"><label>Customer</label><input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="Search saved customer by name or phone…"/>{customerSearch&&<div className="customer-results">{customers.map((c,i)=><button key={i} onClick={()=>{setCustomerName(c.name);setCustomerPhone(c.phone);setCustomerSearch("");}}><b>{c.name}</b><small>{c.phone}</small></button>)}</div>}<div className="customer-fields"><input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="Customer name"/><input value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} placeholder="Phone number"/></div></div>
        <div className="bill-items">{cart.map(({product,qty})=><div className="bill-item" key={product.id}><div className="bill-product"><b>{product.name}</b><small>{cash(n(product.price))} each</small></div><div className="qty-control"><button onClick={()=>changeQty(product.id,qty-1)}>−</button><span>{qty}</span><button onClick={()=>changeQty(product.id,qty+1)}>+</button></div><b className="line-total">{cash(n(product.price)*qty)}</b><button className="remove-item" onClick={()=>changeQty(product.id,0)}>×</button></div>)}{!cart.length&&<div className="bill-empty">Your bill is empty.<br/>Choose a product to get started.</div>}</div>
        <div className="bill-summary"><div><span>Subtotal</span><b>{cash(total)}</b></div><div className="bill-grand"><span>Total bill</span><strong>{cash(total)}</strong></div></div>
        <div className="payment-box"><label>Amount actually received</label><input type="number" min="0" step="0.01" value={received} placeholder={String(total)} onChange={e=>setReceived(e.target.value)}/><div className="payment-summary"><span>Applied to bill <b>{cash(applied)}</b></span><span>Balance due <b>{cash(balance)}</b></span></div>{over>0&&<div className="overpayment-box"><b>Extra received: {cash(over)}</b><p>Choose how to settle the extra amount:</p><div className="resolution-options"><label><input type="radio" checked={resolution==="change"} onChange={()=>setResolution("change")}/> Return as change</label><label><input type="radio" checked={resolution==="advance"} onChange={()=>setResolution("advance")}/> Save customer advance</label><label><input type="radio" checked={resolution==="tip"} onChange={()=>setResolution("tip")}/> Record staff tip</label></div></div>}<div className="payment-row"><select value={method} onChange={e=>setMethod(e.target.value)}><option>Cash</option><option>Card</option><option>Bank transfer</option><option>Mobile wallet</option><option>Credit</option></select><select value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Sale note (optional)" rows={2}/><button className="primary-btn checkout-btn" disabled={saving||!cart.length} onClick={saveSale}>{saving?"Saving sale…":"Save sale & print receipt"} <span>→</span></button></div>
      </section>
    </div>}
  </div>;
}

export function ProductManager({ orgId, userId, role, branchIds, rows, onSaved }: Props) {
  const supabase = useMemo(() => getSupabase(), []);
  const products = rows.filter(r=>r.collection==="mberp_products").map(r=>r.data);
  const branches = rows.filter(r=>r.collection==="mberp_branches").map(r=>r.data).filter(b=>b.active!==false&&(!branchIds.length||branchIds.includes(String(b.id))));
  const canEdit = role==="owner"||role==="manager"||role==="stockkeeper";
  const [editing,setEditing]=useState<Product|null>(null); const [editorOpen,setEditorOpen]=useState(false);
  const [name,setName]=useState(""); const [sku,setSku]=useState(""); const [category,setCategory]=useState(""); const [qty,setQty]=useState("0"); const [cost,setCost]=useState("0"); const [price,setPrice]=useState("0"); const [alertQty,setAlertQty]=useState("5"); const [branchId,setBranchId]=useState(branches[0]?.id||""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  function start(p?:Product){setEditorOpen(true);setEditing(p||null);setName(p?.name||"");setSku(p?.sku||"");setCategory(p?.category||"");setQty(String(p?.qty??0));setCost(String(p?.cost??0));setPrice(String(p?.price??0));setAlertQty(String(p?.alert??p?.lowAt??5));setBranchId(p?.branchId||branches[0]?.id||"");setError("");}
  async function save(){setBusy(true);setError("");const id=editing?.id||makeId();const data={...(editing||{}),id,name:name.trim(),sku:sku.trim(),category:category.trim(),qty:n(qty),cost:n(cost),price:n(price),alert:n(alertQty),lowAt:n(alertQty),branchId};const payload={org_id:orgId,collection:"mberp_products",record_id:String(id),branch_ids:[String(branchId)],data,updated_by:userId};const q=editing?supabase.from("etihad_records").update({data,branch_ids:[String(branchId)],updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",String(id)):supabase.from("etihad_records").insert(payload);const {error}=await q;if(error)setError(error.message);else{setEditing(null);setEditorOpen(false);onSaved();}setBusy(false);}
  return <div className="product-manager"><div className="welcome-row"><div><div className="section-kicker">INVENTORY CONTROL</div><h1>Products & stock</h1><p>Manage catalogue details, selling prices and stock levels.</p></div>{canEdit&&<button className="primary-btn product-add" onClick={()=>start()}>＋ Add product</button>}</div>{error&&<div className="notice-error">{error}</div>}
    
    <div className="panel data-panel"><div className="panel-head"><div><h3>Product catalogue</h3><p>{products.length} items · shared across authorised devices</p></div></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>BRANCH</th><th>STOCK</th><th>COST</th><th>SELLING PRICE</th><th></th></tr></thead><tbody>{products.map((p,i)=><tr key={p.id||i}><td><b>{p.name}</b></td><td>{p.sku||"—"}</td><td>{p.category||"—"}</td><td>{branches.find(b=>b.id===p.branchId)?.name||"—"}</td><td>{n(p.qty)}</td><td>{cash(n(p.cost))}</td><td>{cash(n(p.price))}</td><td>{canEdit&&<button className="text-action" onClick={()=>start(p)}>Edit</button>}</td></tr>)}</tbody></table></div></div>
    {canEdit&&editorOpen&&<div className="panel product-editor"><h3>{editing?"Edit product":"Add product"}</h3><div className="product-form-grid"><label>Product name<input value={name} onChange={e=>setName(e.target.value)} /></label><label>SKU / Barcode<input value={sku} onChange={e=>setSku(e.target.value)} /></label><label>Category<input value={category} onChange={e=>setCategory(e.target.value)} /></label><label>Branch<select value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Quantity<input type="number" min="0" value={qty} onChange={e=>setQty(e.target.value)} /></label><label>Cost price<input type="number" min="0" value={cost} onChange={e=>setCost(e.target.value)} /></label><label>Selling price<input type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)} /></label><label>Low-stock alert<input type="number" min="0" value={alertQty} onChange={e=>setAlertQty(e.target.value)} /></label></div><div className="editor-actions"><button className="outline-btn" onClick={()=>start()}>Clear form</button><button className="primary-btn" disabled={busy||!name.trim()||!branchId} onClick={save}>{busy?"Saving…":"Save product"}</button></div></div>}
  </div>;
}
