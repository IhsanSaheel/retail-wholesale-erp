"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { listPendingSales, removePendingSale, savePendingSale, updatePendingSale, type PendingSale } from "@/lib/offline-sales";
import { getSupabase } from "@/lib/supabase";

type Row = { collection: string; record_id: string; data: Record<string, any> };
type Product = Record<string, any>;
type Props = { orgId: string; userId: string; role: string; branchIds: string[]; rows: Row[]; onSaved: () => void };

const n = (v: any) => Number(v || 0);
const searchText = (v: any) => String(v ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const cash = (v: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(v);
const makeId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 13);
const esc = (v: any) => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function POSWorkspace({ orgId, userId, role, branchIds, rows, onSaved }: Props) {
  const supabase = useMemo(() => getSupabase(), []);
  const products = rows.filter(r => r.collection === "mberp_products").map(r => r.data).filter(p => p.active !== false);
  const branches = rows.filter(r => r.collection === "mberp_branches").map(r => r.data).filter(b => b.active !== false && (!branchIds.length || branchIds.includes(String(b.id))));
  const sales = rows.filter(r => r.collection === "mberp_sales").map(r => r.data);
  const customerCredits = rows.filter(r => r.collection === "mberp_customer_account_credits");
  const [cart, setCart] = useState<{ product: Product; qty: number }[]>([]);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [branchId, setBranchId] = useState(branches.find(b => products.some(p => String(p.branchId) === String(b.id) && n(p.qty) > 0))?.id || branches.find(b => products.some(p => String(p.branchId) === String(b.id)))?.id || branches[0]?.id || "");
  const [received, setReceived] = useState("");
  const [useAdvance, setUseAdvance] = useState(false);
  const [method, setMethod] = useState("Cash");
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
  const [tab, setTab] = useState<"new" | "history">("new");
  const total = cart.reduce((s, x) => s + n(x.product.price) * x.qty, 0);
  const availableAdvance = customerCredits.filter(r => r.data.customerPhone === customerPhone && r.data.balance > 0).reduce((sum, r) => sum + n(r.data.balance), 0);
  const advanceUsed = useAdvance ? Math.min(total, availableAdvance) : 0;
  const cashReceived = received === "" ? (method === "Credit" ? 0 : Math.max(0, total - advanceUsed)) : Math.max(0, n(received));
  const receivedAmount = cashReceived + advanceUsed;
  const over = Math.max(0, receivedAmount - total);
  const applied = Math.min(total, receivedAmount);
  const cashApplied = Math.min(cashReceived, Math.max(0, total - advanceUsed));
  const balance = Math.max(0, total - applied);
  const categories = ["All", ...Array.from(new Set(products.filter(p => String(p.branchId) === String(branchId)).map(p => String(p.category || "Uncategorised").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b))];
  const branchProducts = products.filter(p => String(p.branchId) === String(branchId));
  const matches = branchProducts
    .filter(p => categoryFilter === "All" || String(p.category || "Uncategorised").trim() === categoryFilter)
    .filter(p => showOutOfStock || n(p.qty) > 0)
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
    if (product && n(product.qty) > 0) {
      add(product);
      setSearch("");
      setMessage(product.name + " added to the bill.");
      requestAnimationFrame(() => searchInput.current?.focus());
    } else if (product) {
      setMessage(product.name + " is out of stock at this branch.");
    } else if (matches.length > 1) {
      setMessage("More than one product matches. Select the correct product from the results.");
    } else {
      setMessage("No product found. Check the name, SKU or barcode.");
    }
  };
  const customers = Array.from(new Map(sales.filter(s => s.customerName && s.customerName !== "Walk-in Customer").map(s => [s.customerPhone || s.customerName, { name: s.customerName, phone: s.customerPhone || "" }])).values()).filter(c => (c.name + " " + c.phone).toLowerCase().includes(customerSearch.toLowerCase())).slice(0, 6);
  const recent = [...sales].sort((a,b)=>new Date(b.date||0).getTime()-new Date(a.date||0).getTime()).slice(0,30);
  const add = (p: Product) => setCart(prev => { const found = prev.find(x => x.product.id === p.id); const nextQty = (found?.qty || 0) + 1; if (nextQty > n(p.qty)) { setMessage("Only " + n(p.qty) + " units of " + p.name + " are available at this branch."); return prev; } setMessage(""); return found ? prev.map(x => x.product.id === p.id ? { ...x, qty: nextQty } : x) : [...prev, { product: p, qty: 1 }]; });
  const changeQty = (id: string, qty: number) => setCart(prev => prev.map(x => x.product.id === id ? { ...x, qty: Math.min(n(x.product.qty), Math.max(0, qty)) } : x).filter(x => x.qty > 0));
  const clearBill = () => {
    setCart([]);
    setReceived("");
    setUseAdvance(false);
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
            const transient = !error?.code && /fetch|network|timeout|offline|load failed/i.test(detail);
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
    setIsOnline(navigator.onLine);
    void refreshQueue();
    if (navigator.onLine) void syncQueue();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { active = false; window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, [orgId, userId, supabase, syncTrigger]);

  async function retryPendingSales() {
    const items = await listPendingSales(orgId, userId);
    for (const item of items) if (item.status === "failed") await updatePendingSale({ ...item, status: "pending", lastError: undefined });
    setSyncTrigger(value => value + 1);
  }

  function reprintSale(s: Product) {
    const popup = window.open("", "_blank", "width=420,height=700");
    if (!popup) { setMessage("Allow pop-ups to reprint this receipt."); return; }
    const items = Array.isArray(s.items) ? s.items : [];
    const itemRows = items.map((item: Product) => `<tr><td>${esc(item.name)} × ${n(item.qty)}</td><td class="r">${cash(n(item.qty) * n(item.price))}</td></tr>`).join("");
    const rowsHtml = [
      ["Total bill", s.total],
      ["Amount received (" + (s.paymentMethod || "Payment") + ")", s.cashReceived ?? s.paid],
      ...(n(s.advanceUsed) > 0 ? [["Customer advance applied", s.advanceUsed] as [string, any]] : []),
      ["Applied to invoice", s.paid],
      ...(n(s.changeReturned) > 0 ? [["Change returned", s.changeReturned] as [string, any]] : []),
      ...(n(s.customerAdvance) > 0 ? [["Customer advance saved", s.customerAdvance] as [string, any]] : []),
      ...(n(s.staffTip) > 0 ? [["Staff tip (not sales)", s.staffTip] as [string, any]] : []),
      ["Balance due", s.balance]
    ].map(([label, amount]) => `<tr><td>${esc(label)}</td><td class="r">${cash(n(amount))}</td></tr>`).join("");
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.invoiceNo || "Sales receipt")}</title><style>body{font:14px Arial;color:#18253b;max-width:360px;margin:24px auto;padding:10px}h2{text-align:center;margin:0}p{text-align:center;color:#667}hr{border:0;border-top:1px dashed #aaa}table{width:100%;border-collapse:collapse}td{padding:7px 0;border-bottom:1px solid #eee}.r{text-align:right}.small{font-size:12px;color:#667}@media print{body{margin:0 auto}}</style></head><body><h2>ETIHAD TRADERS</h2><p>Sales receipt · Reprint</p><hr/><div>Invoice: ${esc(s.invoiceNo || "—")}</div><div>Date: ${esc(s.date ? new Date(s.date).toLocaleString() : "—")}</div><div>Customer: ${esc(s.customerName || "Walk-in Customer")}</div><div>Phone: ${esc(s.customerPhone || "—")}</div><div>Branch: ${esc(s.branchName || "—")}</div><hr/><table>${itemRows}</table><hr/><table>${rowsHtml}</table><hr/><p class="small">Payment method: ${esc(s.paymentMethod || "—")}</p><p>Thank you for shopping with us.</p><script>window.onload=()=>window.print()<\\/script></body></html>`);
    popup.document.close();
  }

  async function saveSale() {
    setMessage("");
    if (!cart.length) { setMessage("Add at least one product to the bill."); return; }
    if (!branchId) { setMessage("Choose a branch before saving this sale."); return; }
    if (received.trim() !== "" && (!Number.isFinite(Number(received)) || Number(received) < 0)) { setMessage("Enter a valid payment amount of zero or more."); return; }
    if (over > 0 && resolution === "advance" && (!customerPhone.trim() || customerName === "Walk-in Customer")) { setMessage("Select a saved customer or enter a customer name and phone to keep an advance."); return; }
    if (advanceUsed > 0 && (!customerPhone.trim() || customerName === "Walk-in Customer")) { setMessage("Select a saved customer before applying an account advance."); return; }
    if (cart.some(x => n(x.product.qty) < x.qty && String(x.product.branchId) === String(branchId))) {
      const shortage = cart.find(x => n(x.product.qty) < x.qty && String(x.product.branchId) === String(branchId));
      setMessage("Insufficient available stock for " + shortage?.product.name + ". Available: " + n(shortage?.product.qty));
      return;
    }
    if (cart.some(x => String(x.product.branchId) !== String(branchId))) {
      setMessage("One or more selected products belong to a different branch. Select the correct branch or transfer stock first.");
      return;
    }
    setSaving(true);
    const receiptWindow = window.open("", "_blank", "width=420,height=700");
    const id = makeId();
    const date = new Date().toISOString();
    const year = new Date().getFullYear();
    const invoiceNo = `INV-${year}-${id.slice(-6).toUpperCase()}`;
    const branch = branches.find(b => String(b.id) === String(branchId));
    const changeReturned = over > 0 && resolution === "change" ? over : 0;
    const customerAdvance = over > 0 && resolution === "advance" ? over : 0;
    const staffTip = over > 0 && resolution === "tip" ? over : 0;
    const sale = {
      id, date, invoiceNo, branchId, branchName: branch?.name || "",
      customerName: customerName.trim() || "Walk-in Customer", customerPhone: customerPhone.trim(),
      items: cart.map(x => ({ productId: x.product.id, name: x.product.name, sku: x.product.sku || "", qty: x.qty, cost: n(x.product.cost), price: n(x.product.price), unit: x.product.unit || "piece" })),
      subtotal: total, total, paid: applied, balance, receivedAmount, cashReceived, advanceUsed,
      changeReturned, customerAdvance, staffTip, overpaymentResolution: over ? resolution : "none",
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
        receiptWindow.document.write(`<!doctype html><html><head><title>Pending ${esc(invoiceNo)}</title><style>body{font:14px Arial;color:#18253b;max-width:360px;margin:24px auto;padding:10px}h2{text-align:center} .warn{padding:12px;background:#fff4df;border:1px solid #e4b65f;border-radius:8px;font-weight:bold}table{width:100%}td{padding:7px 0;border-bottom:1px solid #eee}.r{text-align:right}</style></head><body><h2>ETIHAD TRADERS</h2><div class="warn">PENDING CLOUD SYNC — NOT A CONFIRMED SALES RECEIPT</div><p>Reference: ${esc(invoiceNo)}</p><p>Date: ${esc(new Date(date).toLocaleString())}</p><p>Customer: ${esc(sale.customerName)}</p><table>${sale.items.map((x:any)=>`<tr><td>${esc(x.name)} × ${x.qty}</td><td class="r">${cash(x.qty*x.price)}</td></tr>`).join("")}</table><hr/><p>Total: <b>${cash(total)}</b></p><p>Amount tendered (${esc(method)}): ${cash(cashReceived)}</p><p>Keep this reference. The sale is not final until cloud synchronisation succeeds.</p></body></html>`);
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

    const receipt = `<!doctype html><html><head><title>${esc(invoiceNo)}</title><style>body{font:14px Arial;color:#18253b;max-width:360px;margin:24px auto;padding:10px}h2{text-align:center;margin:0}p{text-align:center;color:#667}hr{border:0;border-top:1px dashed #aaa}table{width:100%;border-collapse:collapse}td{padding:7px 0;border-bottom:1px solid #eee}.r{text-align:right}.small{font-size:12px;color:#667}</style></head><body><h2>ETIHAD TRADERS</h2><p>Sales receipt</p><hr/><div>Invoice: ${esc(invoiceNo)}</div><div>Date: ${esc(new Date(date).toLocaleString())}</div><div>Customer: ${esc(sale.customerName)}</div><div>Phone: ${esc(sale.customerPhone || "—")}</div><div>Branch: ${esc(sale.branchName)}</div><hr/><table>${sale.items.map((x:any)=>`<tr><td>${esc(x.name)} × ${x.qty}</td><td class="r">${cash(x.qty*x.price)}</td></tr>`).join("")}</table><hr/><table><tr><td>Total bill</td><td class="r">${cash(total)}</td></tr><tr><td>Amount received (${esc(method)})</td><td class="r">${cash(cashReceived)}</td></tr>${advanceUsed?`<tr><td>Customer advance applied</td><td class="r">${cash(advanceUsed)}</td></tr>`:""}<tr><td>Total tender applied</td><td class="r">${cash(receivedAmount)}</td></tr><tr><td>Applied to invoice</td><td class="r">${cash(applied)}</td></tr>${changeReturned?`<tr><td>Change returned</td><td class="r">${cash(changeReturned)}</td></tr>`:""}${customerAdvance?`<tr><td>Customer advance saved</td><td class="r">${cash(customerAdvance)}</td></tr>`:""}${staffTip?`<tr><td>Staff tip (not sales)</td><td class="r">${cash(staffTip)}</td></tr>`:""}<tr><td>Balance due</td><td class="r">${cash(balance)}</td></tr></table><hr/><p class="small">Payment method: ${esc(method)}</p><p>Thank you for shopping with us.</p><script>window.onload=()=>window.print()<\\/script></body></html>`;
    if (receiptWindow) { receiptWindow.document.open(); receiptWindow.document.write(receipt); receiptWindow.document.close(); }
    setCart([]); setReceived(""); setUseAdvance(false); setCustomerName("Walk-in Customer"); setCustomerPhone(""); setNote("");
    setMessage("Sale saved successfully. Stock and payment records updated atomically. Receipt opened in a new window.");
    setSaving(false);
    onSaved();
  }

  return <div className="pos-workspace">
    <div className="pos-heading"><div><div className="section-kicker">POINT OF SALE</div><h2>New sale</h2><p>Build a bill, select a customer and settle the payment.</p></div><div className="pos-tabs"><button className={tab==="new"?"selected":""} onClick={()=>setTab("new")}>New sale</button><button className={tab==="history"?"selected":""} onClick={()=>setTab("history")}>Sales history</button></div></div>
    {pendingSales.length>0&&<div className="panel offline-queue-banner"><div><b>{pendingSales.length} sale{pendingSales.length===1?"":"s"} awaiting cloud sync</b><p>{syncing?"Synchronising saved sales…":"These sales are stored on this device and are not yet confirmed in cloud stock or accounts."}</p>{pendingSales.filter(x=>x.status==="failed").map(x=><small key={x.id}>Needs attention: {x.sale.invoiceNo} — {x.lastError}</small>)}</div><div className="offline-queue-actions"><button className="secondary-btn" disabled={syncing||!isOnline} onClick={retryPendingSales}>{syncing?"Syncing…":"Retry sync"}</button></div></div>}
    {message && <div className={message.startsWith("Sale saved")||message.includes("synchronised successfully")?"pos-success":"notice-error"}>{message}</div>}
    {tab==="history" ? <div className="panel data-panel"><div className="panel-head"><div><h3>Recent invoices</h3><p>Latest sales from the shared Etihad Traders database</p></div></div><div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>TOTAL</th><th>PAID</th><th>BALANCE</th><th>RECEIPT</th></tr></thead><tbody>{recent.map((s,i)=><tr key={s.id||i}><td><b>{s.invoiceNo||"—"}</b></td><td>{s.customerName||"Walk-in"}</td><td>{s.date?new Date(s.date).toLocaleDateString():"—"}</td><td>{cash(n(s.total))}</td><td>{cash(n(s.paid))}</td><td>{cash(n(s.balance))}</td><td><button className="text-action" onClick={()=>reprintSale(s)}>Reprint</button></td></tr>)}</tbody></table></div></div> :
    <div className="pos-layout">
      <section className="pos-catalog panel"><div className="pos-catalog-head"><div><h3>Choose products</h3><p>{matches.length} matching products · {branchProducts.length} assigned to this branch</p></div><label className="pos-branch-picker">Branch<select className="pos-branch-select" value={branchId} onChange={e=>{setBranchId(e.target.value);setCart([]);setCategoryFilter("All");setReceived("");setUseAdvance(false);setMessage("Branch changed. The bill and payment inputs were cleared to prevent mixing branches.");}}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div><input ref={searchInput} className="pos-search" placeholder="Search product or scan barcode / SKU, then press Enter…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={handleProductSearchKey} autoComplete="off" inputMode="search"/><div className="pos-category-bar">{categories.map(category=><button type="button" key={category} className={categoryFilter===category?"active":""} onClick={()=>setCategoryFilter(category)}>{category}</button>)}<label className="stock-toggle"><input type="checkbox" checked={showOutOfStock} onChange={e=>setShowOutOfStock(e.target.checked)}/> Include out of stock</label></div><div className="pos-products">{matches.map((p,i)=><button className="pos-product" key={p.id||i} onClick={()=>add(p)} disabled={n(p.qty)<=0}><span className="product-initial">{String(p.name||"P").slice(0,1).toUpperCase()}</span><b>{p.name}</b><small>{p.sku||p.category||"Product"} · Stock {n(p.qty)}</small><strong>{cash(n(p.price))}</strong><em>{n(p.qty)>0?"+ Add":"Out of stock"}</em></button>)}{!matches.length&&<div className="empty-cell">{!branchProducts.length?"No products are assigned to this branch. Choose Barikot or Guratai to view its stock.":"No products match this search. Try another name, SKU or barcode, or enable out-of-stock items."}</div>}</div></section>
      <section className="pos-bill panel"><div className="bill-title"><div><h3>Current bill</h3><p>{cart.reduce((s,x)=>s+x.qty,0)} items in this sale</p></div><button className="text-action" onClick={clearBill} disabled={!cart.length&&!received&&!note}>Clear bill</button></div>
        <div className="customer-box"><label>Customer</label><input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="Search saved customer by name or phone…"/>{customerSearch&&<div className="customer-results">{customers.map((c,i)=><button key={i} onClick={()=>{setCustomerName(c.name);setCustomerPhone(c.phone);setUseAdvance(false);setCustomerSearch("");}}><b>{c.name}</b><small>{c.phone}</small></button>)}</div>}<div className="customer-fields"><input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="Customer name"/><input value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} placeholder="Phone number"/></div></div>
        <div className="bill-items">{cart.map(({product,qty})=><div className="bill-item" key={product.id}><div className="bill-product"><b>{product.name}</b><small>{cash(n(product.price))} each</small></div><div className="qty-control"><button aria-label={"Decrease "+product.name} onClick={()=>changeQty(product.id,qty-1)} disabled={qty<=1}>−</button><input className="qty-entry" aria-label={"Quantity for "+product.name} type="number" inputMode="decimal" min="0.001" step="any" max={n(product.qty)} value={qty} onChange={e=>changeQty(product.id,Number(e.target.value))}/><button aria-label={"Increase "+product.name} onClick={()=>changeQty(product.id,qty+1)} disabled={qty>=n(product.qty)}>+</button></div><b className="line-total">{cash(n(product.price)*qty)}</b><button className="remove-item" onClick={()=>changeQty(product.id,0)}>×</button></div>)}{!cart.length&&<div className="bill-empty">Your bill is empty.<br/>Choose a product to get started.</div>}</div>
        <div className="bill-summary"><div><span>Subtotal</span><b>{cash(total)}</b></div><div className="bill-grand"><span>Total bill</span><strong>{cash(total)}</strong></div></div>
        <div className="payment-box">{customerPhone&&availableAdvance>0&&<label className="use-advance"><input type="checkbox" checked={useAdvance} onChange={e=>setUseAdvance(e.target.checked)}/> Use customer advance ({cash(availableAdvance)} available)</label>}<div className="payment-row payment-method-row"><label>Payment method<select aria-label="Payment method" value={method} onChange={e=>setMethod(e.target.value)}><option>Cash</option><option>Card</option><option>Bank transfer</option><option>Mobile wallet</option><option>Credit</option></select></label></div><label>Amount received now ({method})</label><input type="number" min="0" step="0.01" inputMode="decimal" value={received} placeholder={String(Math.max(0,total-advanceUsed))} onChange={e=>setReceived(e.target.value)}/><div className="tender-shortcuts"><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed)))}>Exact due</button><button type="button" onClick={()=>setReceived(String(Math.max(0,total-advanceUsed+500)))}>＋ Rs 500</button><button type="button" onClick={()=>setReceived("0")}>No payment</button><button type="button" onClick={()=>setReceived("")}>Reset</button></div><div className="payment-summary settlement-preview"><span>Cash received <b>{cash(cashReceived)}</b></span><span>Advance applied <b>{cash(advanceUsed)}</b></span><span>Applied to bill <b>{cash(applied)}</b></span><span>Balance due <b>{cash(balance)}</b></span>{over>0&&<span>Extra tender <b>{cash(over)}</b></span>}</div>{over>0&&<div className="overpayment-box"><b>Extra received: {cash(over)}</b><p>Choose how to settle the extra amount:</p><div className="resolution-options"><label><input type="radio" checked={resolution==="change"} onChange={()=>setResolution("change")}/> Return as change</label><label><input type="radio" checked={resolution==="advance"} onChange={()=>setResolution("advance")}/> Save customer advance</label><label><input type="radio" checked={resolution==="tip"} onChange={()=>setResolution("tip")}/> Record staff tip</label></div></div>}<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Sale note (optional)" rows={2}/><button className="primary-btn checkout-btn" disabled={saving||!cart.length} onClick={saveSale}>{saving?"Saving sale…":"Save sale & print receipt"} <span>→</span></button></div>
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
  const [name,setName]=useState(""); const [sku,setSku]=useState(""); const [barcode,setBarcode]=useState(""); const [category,setCategory]=useState(""); const [qty,setQty]=useState("0"); const [cost,setCost]=useState("0"); const [price,setPrice]=useState("0"); const [alertQty,setAlertQty]=useState("5"); const [branchId,setBranchId]=useState(branches[0]?.id||""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  function start(p?:Product){setEditorOpen(true);setEditing(p||null);setName(p?.name||"");setSku(p?.sku||"");setBarcode(p?.barcode||"");setCategory(p?.category||"");setQty(String(p?.qty??0));setCost(String(p?.cost??0));setPrice(String(p?.price??0));setAlertQty(String(p?.alert??p?.lowAt??5));setBranchId(p?.branchId||branches[0]?.id||"");setError("");}
  async function save(){setBusy(true);setError("");const id=editing?.id||makeId();const data={...(editing||{}),id,name:name.trim(),sku:sku.trim(),barcode:barcode.trim(),category:category.trim(),qty:n(qty),cost:n(cost),price:n(price),alert:n(alertQty),lowAt:n(alertQty),branchId};const payload={org_id:orgId,collection:"mberp_products",record_id:String(id),branch_ids:[String(branchId)],data,updated_by:userId};const q=editing?supabase.from("etihad_records").update({data,branch_ids:[String(branchId)],updated_by:userId}).eq("org_id",orgId).eq("collection","mberp_products").eq("record_id",String(id)):supabase.from("etihad_records").insert(payload);const {error}=await q;if(error)setError(error.message);else{setEditing(null);setEditorOpen(false);onSaved();}setBusy(false);}
  return <div className="product-manager"><div className="welcome-row"><div><div className="section-kicker">INVENTORY CONTROL</div><h1>Products & stock</h1><p>Manage catalogue details, selling prices and stock levels.</p></div>{canEdit&&<button className="primary-btn product-add" onClick={()=>start()}>＋ Add product</button>}</div>{error&&<div className="notice-error">{error}</div>}
    
    <div className="panel data-panel"><div className="panel-head"><div><h3>Product catalogue</h3><p>{products.length} items · shared across authorised devices</p></div></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>BRANCH</th><th>STOCK</th><th>COST</th><th>SELLING PRICE</th><th></th></tr></thead><tbody>{products.map((p,i)=><tr key={p.id||i}><td><b>{p.name}</b></td><td>{p.sku||"—"}</td><td>{p.category||"—"}</td><td>{branches.find(b=>b.id===p.branchId)?.name||"—"}</td><td>{n(p.qty)}</td><td>{cash(n(p.cost))}</td><td>{cash(n(p.price))}</td><td>{canEdit&&<button className="text-action" onClick={()=>start(p)}>Edit</button>}</td></tr>)}</tbody></table></div></div>
    {canEdit&&editorOpen&&<div className="panel product-editor"><h3>{editing?"Edit product":"Add product"}</h3><div className="product-form-grid"><label>Product name<input value={name} onChange={e=>setName(e.target.value)} /></label><label>SKU / Product code<input value={sku} onChange={e=>setSku(e.target.value)} /></label><label>Barcode<input value={barcode} onChange={e=>setBarcode(e.target.value)} placeholder="Scan or enter barcode" /></label><label>Category<input value={category} onChange={e=>setCategory(e.target.value)} /></label><label>Branch<select value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Quantity<input type="number" min="0" value={qty} onChange={e=>setQty(e.target.value)} /></label><label>Cost price<input type="number" min="0" value={cost} onChange={e=>setCost(e.target.value)} /></label><label>Selling price<input type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)} /></label><label>Low-stock alert<input type="number" min="0" value={alertQty} onChange={e=>setAlertQty(e.target.value)} /></label></div><div className="editor-actions"><button className="outline-btn" onClick={()=>start()}>Clear form</button><button className="primary-btn" disabled={busy||!name.trim()||!branchId} onClick={save}>{busy?"Saving…":"Save product"}</button></div></div>}
  </div>;
}
