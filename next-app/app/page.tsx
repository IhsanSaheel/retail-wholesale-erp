"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { getOfflineBusinessSnapshot, saveOfflineBusinessSnapshot, OFFLINE_SNAPSHOT_MAX_AGE_MS, type OfflineBusinessRow } from "@/lib/offline-business";
import { POSWorkspace, ProductManager } from "./workspaces";
import { PeopleWorkspace, ReportsWorkspace, SettingsWorkspace } from "./management";
import { CustomerWorkspace, SupplierWorkspace, PurchaseWorkspace, ReturnsWorkspace, PaymentWorkspace, TransferWorkspace, ExpenseWorkspace, BranchWorkspace, CashRegisterWorkspace } from "./commerce";

type RecordRow = { collection: string; record_id: string; branch_ids: string[]; data: Record<string, any>; updated_at: string; updated_by?: string };
type ModuleKey = "overview" | "cashregister" | "sales" | "returns" | "products" | "customers" | "purchases" | "suppliers" | "expenses" | "branches" | "payments" | "transfers" | "reports" | "employees" | "settings";
const NAV: { group: string; items: { id: ModuleKey; label: string; icon: string }[] }[] = [
  { group: "WORKSPACE", items: [{id:"overview",label:"Overview",icon:"⌂"},{id:"cashregister",label:"Cash register",icon:"＄"},{id:"sales",label:"Sales & POS",icon:"▣"},{id:"returns",label:"Sales returns",icon:"↩"},{id:"customers",label:"Customers",icon:"♙"},{id:"purchases",label:"Purchases",icon:"⇩"},{id:"suppliers",label:"Suppliers",icon:"♧"},{id:"expenses",label:"Expenses",icon:"−"}] },
  { group: "PRODUCT & RESTOCK", items: [{id:"products",label:"Products & stock",icon:"▤"},{id:"transfers",label:"Stock transfers",icon:"⇄"}] },
  { group: "MANAGEMENT", items: [{id:"branches",label:"Branches",icon:"⌖"},{id:"payments",label:"Payments",icon:"＄"},{id:"reports",label:"Reports & analytics",icon:"▥"},{id:"employees",label:"Employees & payroll",icon:"♧"}] },
  { group: "SYSTEM", items: [{id:"settings",label:"Settings",icon:"⚙"}] },
];
const COLLECTION: Partial<Record<ModuleKey,string>> = {sales:"mberp_sales",returns:"mberp_sales_returns",products:"mberp_products",branches:"mberp_branches",payments:"mberp_payments",transfers:"mberp_transfers",purchases:"mberp_purchases",suppliers:"mberp_suppliers"};
const BRAND_LOGO_URL = "https://njzhtxrmrqhuxhytxaay.supabase.co/storage/v1/object/public/etihad-branding/d343ea3c-6c19-48f8-bf06-d47f883debcb/logo.png?v=1795278776451";
const money = (v:number) => new Intl.NumberFormat("en-PK",{style:"currency",currency:"PKR",maximumFractionDigits:0}).format(Number.isFinite(v)?v:0);
const dateLabel = (v:any) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-PK",{timeZone:"Asia/Karachi",day:"2-digit",month:"short",year:"numeric"}); };
const pakistanDateKey=(v:any)=>{if(!v)return "";const raw=String(v);if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;const d=new Date(v);return Number.isNaN(d.getTime())?"":new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Karachi",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);};
const shiftPakistanDate=(key:string,days:number)=>{const d=new Date(key+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const pakistanDateLabel=(key:string,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat("en-PK",{timeZone:"Asia/Karachi",...options}).format(new Date(key+"T12:00:00Z"));
const amount = (v:any) => Number(v || 0);
const OFFLINE_POS_COLLECTIONS = new Set(["mberp_sales","mberp_products","mberp_branches","mberp_customers","mberp_customer_account_credits","mberp_loyalty_settings","mberp_product_taxes"]);
const isNetworkFailure = (error:any) => !navigator.onLine || /fetch|network|timeout|offline|load failed|connection|request failed|temporarily unavailable/i.test(String(error?.message||error||""));

export default function Home() {
  const supabase = useMemo(() => getSupabase(), []);
  const [session,setSession] = useState<Session|null>(null);
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [resetNotice,setResetNotice] = useState("");
  const [rows,setRows] = useState<RecordRow[]>([]);
  const [offlineMode,setOfflineMode] = useState(false);
  const [module,setModule] = useState<ModuleKey>("overview");
  const [orgName,setOrgName] = useState("Etihad Prime Supplies");
  const [orgId,setOrgId] = useState("");
  const [branchIds,setBranchIds] = useState<string[]>([]);
  const [role,setRole] = useState("");
  const [permissions,setPermissions] = useState<Record<string,boolean>>({});
  const [userEmail,setUserEmail] = useState("");
  const [mobileNav,setMobileNav] = useState(false);
  const [query,setQuery] = useState("");
  const [clockTime,setClockTime] = useState(()=>new Date());
  const [selectedActivityDate,setSelectedActivityDate] = useState("");
  const [salesStartTab,setSalesStartTab] = useState<"new"|"history">("new");

  useEffect(()=>{const timer=window.setInterval(()=>setClockTime(new Date()),1000);return ()=>window.clearInterval(timer);},[]);

  const loadBusiness = useCallback(async (userId:string) => {
    setLoading(true); setError("");
    const restoreOfflineSnapshot = async () => {
      try {
        const snapshot = await getOfflineBusinessSnapshot(userId);
        if (!snapshot || !snapshot.orgId || Date.now()-snapshot.cachedAt>OFFLINE_SNAPSHOT_MAX_AGE_MS) return false;
        setOrgId(snapshot.orgId); setOrgName(snapshot.orgName||"Etihad Prime Supplies"); setBranchIds(snapshot.branchIds||[]);
        setRole(String(snapshot.role||"staff").trim().toLowerCase()); setPermissions(snapshot.permissions||{});
        setRows(snapshot.rows as RecordRow[]); setOfflineMode(true); setModule("sales"); setSalesStartTab("new");
        setError("OFFLINE MODE · Using this device’s saved POS data from "+new Date(snapshot.cachedAt).toLocaleString()+". New sales will remain pending until synchronised.");
        setLoading(false); return true;
      } catch { return false; }
    };
    if (!navigator.onLine) {
      setOfflineMode(true);
      if (!(await restoreOfflineSnapshot())) setError("You are offline and this device has no recent Etihad Prime Supplies data. Connect once to load and prepare offline POS.");
      setLoading(false); return;
    }
    setOfflineMode(false);
    const {data: memberships,error: memberError} = await supabase.from("etihad_memberships").select("org_id,role,active,branch_ids,permissions").eq("user_id",userId).eq("active",true);
    if(memberError) {
      if (isNetworkFailure(memberError) && await restoreOfflineSnapshot()) return;
      setError("Your account could not load its business membership. Please reconnect and try again."); setLoading(false); return;
    }
    if(!memberships?.length) { setError("This login is not linked to an active Etihad Prime Supplies employee account."); setRows([]); setOrgId(""); setBranchIds([]); setRole(""); setPermissions({}); setOfflineMode(false); setLoading(false); return; }
    const membership = memberships[0];
    setOrgId(membership.org_id);
    setBranchIds(Array.isArray(membership.branch_ids) ? membership.branch_ids : []);
    setRole(String(membership.role || "staff").trim().toLowerCase());
    setPermissions((membership.permissions && typeof membership.permissions==="object") ? membership.permissions : {});
    const {data:org} = await supabase.from("etihad_organizations").select("name").eq("id",membership.org_id).maybeSingle();
    if(org?.name) setOrgName(org.name);

    // Supabase's default row cap can silently truncate a large business.
    // Fetch stable, ordered pages so POS history, customer credits and stock
    // calculations use the complete authorised record set.
    const allRecords: RecordRow[] = [];
    let offset = 0;
    let recordsError: Error | null = null;
    const pageSize = 1000;
    while (true) {
      const {data: page, error: pageError} = await supabase
        .from("etihad_records")
        .select("collection,record_id,branch_ids,data,updated_at,updated_by")
        .eq("org_id",membership.org_id)
        .order("updated_at",{ascending:false})
        .order("record_id",{ascending:true})
        .range(offset,offset+pageSize-1);
      if (pageError) { recordsError = pageError; break; }
      const batch = (page || []) as RecordRow[];
      allRecords.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    if(recordsError) {
      if (isNetworkFailure(recordsError) && await restoreOfflineSnapshot()) return;
      setError("Your account is signed in, but business records could not be loaded. Reconnect and refresh; existing screen data has been kept.");
    } else {
      setRows(allRecords); setOfflineMode(false);
      const snapshotRows = allRecords.filter(row=>OFFLINE_POS_COLLECTIONS.has(row.collection)) as OfflineBusinessRow[];
      try { await saveOfflineBusinessSnapshot({userId,orgId:membership.org_id,orgName:org?.name||"Etihad Prime Supplies",branchIds:Array.isArray(membership.branch_ids)?membership.branch_ids:[],role:String(membership.role||"staff").trim().toLowerCase(),permissions:(membership.permissions&&typeof membership.permissions==="object")?membership.permissions:{},cachedAt:Date.now(),rows:snapshotRows}); }
      catch { setError("Business data loaded online, but this device could not refresh its offline POS cache. Check available device storage."); }
    }
    setLoading(false);
  },[supabase]);

  useEffect(() => {
    // Supabase emits INITIAL_SESSION after it has restored the persisted login.
    // Use this single auth event as the source of truth. Calling getSession()
    // alongside the auth listener can race the auth lock and leave the ERP
    // waiting forever before membership and records are fetched.
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,next) => {
      setSession(next);
      setUserEmail(next?.user.email || "");
      setLoading(Boolean(next?.user.id));
      window.setTimeout(() => {
        if(next?.user.id) {
          void loadBusiness(next.user.id);
        } else {
          setRows([]);
          setOrgId("");
          setBranchIds([]);
          setRole("");
          setPermissions({});
          setLoading(false);
        }
      },0);
    });
    return () => subscription.unsubscribe();
  },[supabase,loadBusiness]);

  async function signIn(e:FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const {error} = await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(error) setError(error.message);
    setBusy(false);
  }
  async function sendPasswordReset(){if(!email.trim()){setError("Enter your employee email address first.");return;}setBusy(true);setError("");setResetNotice("");const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin});if(error)setError(error.message);else setResetNotice("If this email belongs to an active account, a password reset link has been sent. Open it on this device, then change your password in Settings.");setBusy(false);}
  useEffect(()=>{
    const handleOffline=()=>setOfflineMode(true);
    const handleOnline=()=>{if(session?.user.id) void loadBusiness(session.user.id); else setOfflineMode(false);};
    window.addEventListener("offline",handleOffline); window.addEventListener("online",handleOnline);
    return ()=>{window.removeEventListener("offline",handleOffline);window.removeEventListener("online",handleOnline);};
  },[session,loadBusiness]);

  async function signOut() { await supabase.auth.signOut(); setModule("overview"); setPermissions({}); setRole(""); setOfflineMode(false); }

  const records = (name:string) => rows.filter(r=>r.collection===name).map(r=>r.data || {});
  const roleDefaults:Record<string,string[]>={owner:["cashregister","sales","returns","products","customers","purchases","suppliers","expenses","branches","payments","transfers","reports","employees","settings"],manager:["cashregister","sales","returns","products","customers","purchases","suppliers","expenses","branches","payments","transfers","reports","employees"],cashier:["cashregister","sales","returns","customers","payments"],stockkeeper:["products","transfers","purchases"],accountant:["cashregister","sales","returns","customers","suppliers","payments","expenses","reports"]};
  const permissionAliases:Record<string,string[]>={cashregister:["cashregister","payments","reports"],customers:["customers","customer_balances"],returns:["returns","sales_returns"],transfers:["transfers","stock"],products:["products"],sales:["sales"],purchases:["purchases"],suppliers:["suppliers"],payments:["payments"],expenses:["expenses"],reports:["reports"],employees:["employees"]};
  const permitted=(id:ModuleKey)=>{if(offlineMode)return id==="sales"||id==="overview";if(String(role).trim().toLowerCase()==="owner")return true;if(id==="overview")return true;if(id==="branches")return false;if(id==="settings")return true;const hasExplicit=Object.keys(permissions).length>0;return hasExplicit?(permissionAliases[id]||[id]).some(key=>permissions[key]===true):(roleDefaults[role]||[]).includes(id);};
  const visibleNav=NAV.map(group=>({...group,items:group.items.filter(item=>permitted(item.id))})).filter(group=>group.items.length>0);
  useEffect(()=>{if(session&&!permitted(module))setModule("overview");},[role,permissions,module,session]);

  const sales = records("mberp_sales");
  const products = records("mberp_products");
  const branches = records("mberp_branches");
  const payments = records("mberp_payments");
  const activeSales = sales.filter(s=>String(s.status||"").toLowerCase()!=="cancelled");
  const now = clockTime;
  const todayKey=pakistanDateKey(now);const monthSales = activeSales.filter(s=>pakistanDateKey(s.date).slice(0,7)===todayKey.slice(0,7));
  const monthTotal = monthSales.reduce((n,s)=>n+amount(s.total),0);
  const outstanding = activeSales.reduce((n,s)=>n+amount(s.balance),0);
  const lowStock = products.filter(p=>amount(p.qty)<=amount(p.alert ?? p.lowAt ?? 0));
  const expiryAlerts: any[] = rows.filter(r=>r.collection==="mberp_stock_batches").map(r=>r.data).filter(b=>amount(b.remainingQty??b.qty)>0&&Boolean(b.expiryDate||b.expiry||b.expiresAt)).map(b=>{const expiryValue=b.expiryDate||b.expiry||b.expiresAt;const expiryKey=pakistanDateKey(expiryValue);const daysToExpiry=expiryKey?Math.round((new Date(expiryKey+"T12:00:00Z").getTime()-new Date(todayKey+"T12:00:00Z").getTime())/86400000):Number.POSITIVE_INFINITY;return {...b,expiryValue,daysToExpiry};}).filter(b=>Number.isFinite(b.daysToExpiry)&&b.daysToExpiry<=30).sort((a,b)=>a.daysToExpiry-b.daysToExpiry);
  const expiredBatchCount=expiryAlerts.filter(b=>b.daysToExpiry<0).length;const expiringWithin7DaysCount=expiryAlerts.filter(b=>b.daysToExpiry>=0&&b.daysToExpiry<=7).length;const expiring8To30DaysCount=expiryAlerts.filter(b=>b.daysToExpiry>7&&b.daysToExpiry<=30).length;
  const daily = Array.from({length:7},(_,i)=>{const key=shiftPakistanDate(todayKey,i-6);const total=activeSales.filter(s=>pakistanDateKey(s.date)===key).reduce((n,s)=>n+amount(s.total),0);return {key,label:pakistanDateLabel(key,{weekday:"short"}),total};});
  const maxDaily = Math.max(1,...daily.map(x=>x.total));
  const selectedDaySales=selectedActivityDate?activeSales.filter(s=>pakistanDateKey(s.date)===selectedActivityDate):[];
  const recent = [...activeSales].sort((a,b)=>new Date(b.date||0).getTime()-new Date(a.date||0).getTime()).slice(0,6);
  const moduleRows = COLLECTION[module] ? records(COLLECTION[module]!) : [];
  const filteredRows = moduleRows.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
  const title = NAV.flatMap(g=>g.items).find(i=>i.id===module)?.label || "Overview";

  const businessLogoUrl=String(rows.find(r=>r.collection==="mberp_brand_settings"&&r.record_id==="default")?.data?.logoUrl||BRAND_LOGO_URL);
   if(!session) return <main className="login-page"><div className="login-art"><div className="login-brand"><img className="brand-mark" src={BRAND_LOGO_URL} alt="Etihad Prime Supplies — Shop Sell Grow"/></div><div className="art-copy"><span className="eyebrow">BUSINESS MANAGEMENT, REIMAGINED</span><h1>One clear view.<br/><em>Every business move.</em></h1><p>A connected workspace for your sales, inventory, customers and team.</p><div className="art-orbit"><div className="orbit-core">ET</div><span className="orbit-chip chip-one">Sales</span><span className="orbit-chip chip-two">Inventory</span><span className="orbit-chip chip-three">People</span></div></div><div className="art-foot">ETIHAD PRIME SUPPLIES · RETAIL & WHOLESALE</div></div><section className="login-side"><div className="login-form-wrap"><div className="mobile-brand"><img className="brand-mark" src={BRAND_LOGO_URL} alt="Etihad Prime Supplies logo"/><span>ETIHAD <b>PRIME SUPPLIES</b></span></div><div className="form-kicker">WELCOME BACK</div><h2>Sign in to your workspace</h2><p className="muted">Use your existing Etihad Prime Supplies employee login.</p><form onSubmit={signIn} className="login-form"><label>Email address</label><input type="email" autoComplete="username" required placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)}/><label>Password</label><input type="password" autoComplete="current-password" required placeholder="Enter your password" value={password} onChange={e=>setPassword(e.target.value)}/>{error&&<div className="error-box">{error}</div>}{resetNotice&&<div className="pos-success">{resetNotice}</div>}<button className="primary-btn" disabled={busy}>{busy?"Signing in…":"Sign in securely"} <span>→</span></button><button type="button" className="login-reset-link" disabled={busy} onClick={sendPasswordReset}>Forgot password? Send a reset link</button></form><div className="login-security"><span>⌑</span> Secure sign-in · Your existing business data stays in place</div><div className="login-help">Need access? Ask your Etihad Prime Supplies owner to create your employee account.</div></div><div className="login-bottom">© {new Date().getFullYear()} Etihad Prime Supplies</div></section></main>;

  return <main className="app-shell">
    <aside className={"sidebar "+(mobileNav?"sidebar-open":"")}><div className="side-brand"><img className="brand-mark" src={businessLogoUrl} alt="Etihad Prime Supplies — Shop Sell Grow"/><button className="mobile-close" onClick={()=>setMobileNav(false)}>×</button></div>
      <div className="workspace-switch"><span className="workspace-dot"></span><div><small>WORKSPACE</small><strong>{orgName}</strong></div><span className="switch-caret">⌄</span></div>
      <nav>{visibleNav.map(group=><div className="nav-group" key={group.group}><div className="nav-caption">{group.group}</div>{group.items.map(item=><button key={item.id} className={"nav-item "+(module===item.id?"active":"")} onClick={()=>{if(item.id==="sales")setSalesStartTab("history");setModule(item.id);setMobileNav(false);setQuery("");}}><span className="nav-icon">{item.icon}</span><span>{item.label}</span>{item.id==="sales"&&<small className="nav-tag">POS</small>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="sync-state"><span className={offlineMode?"sync-dot sync-dot-offline":"sync-dot"}></span><div><b>{offlineMode?"Offline POS mode":"Cloud connected"}</b><small>{offlineMode?"Pending sales sync when online":"Supabase live data"}</small></div></div><div className="user-card"><div className="avatar">{(userEmail[0]||"E").toUpperCase()}</div><div className="user-meta"><b>{userEmail.split("@")[0]||"Team member"}</b><small>{role||"Staff"}</small></div><button title="Sign out" onClick={signOut}>↗</button></div></div>
    </aside>
    {mobileNav&&<button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <section className="main-area"><header className="topbar"><div className="top-left"><button className="hamburger" onClick={()=>setMobileNav(true)}>☰</button><div className="crumb">Workspace <span>/</span> <b>{title}</b></div></div><div className="top-actions"><div className="live-pill"><span></span> Live data</div><div className="top-date">{now.toLocaleDateString("en-PK",{timeZone:"Asia/Karachi",weekday:"short",day:"2-digit",month:"short",year:"numeric"})} <b className="digital-clock">{now.toLocaleTimeString("en-PK",{timeZone:"Asia/Karachi",hour12:true})}</b></div><button className="top-avatar" title={userEmail}>{(userEmail[0]||"E").toUpperCase()}</button></div></header>
      <div className="page-content">
        {offlineMode&&<div className="offline-mode-banner" role="status">OFFLINE POS MODE · Sales are saved on this device and will sync when internet returns. Cloud balances and stock are not confirmed until sync.</div>}
        {error&&<div className={offlineMode?"offline-mode-notice":"notice-error"}>{error}</div>}
        {module==="overview"?<><div className="welcome-row"><div><div className="section-kicker">BUSINESS OVERVIEW</div><h1>Good {Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Karachi",hour:"2-digit",hourCycle:"h23"}).format(now))<12?"morning":Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Karachi",hour:"2-digit",hourCycle:"h23"}).format(now))<18?"afternoon":"evening"} <span>👋</span></h1><p>Here’s what’s happening across {orgName} today.</p></div><button className="outline-btn" onClick={()=>session.user.id&&loadBusiness(session.user.id)}>↻ <span>Refresh data</span></button></div>
          {loading?<div className="loading-panel">Loading your live business data…</div>:<><div className="metrics-grid"><Metric label="Sales this month" value={money(monthTotal)} icon="↗" tone="gold" note={monthSales.length+" recorded invoices"}/><Metric label="Outstanding balance" value={money(outstanding)} icon="◷" tone="blue" note="Across recorded invoices"/><Metric label="Products in catalogue" value={String(products.length)} icon="▤" tone="violet" note={lowStock.length+" at or below alert level"}/><Metric label="Active branches" value={String(branches.filter(b=>b.active!==false).length)} icon="⌖" tone="green" note={branches.length+" total branches"}/></div>
          <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-head"><div><h3>Sales activity</h3><p>Daily invoice totals · last 7 days</p></div><span className="panel-badge">THIS WEEK</span></div><div className="chart-total">{money(daily.reduce((n,d)=>n+d.total,0))}<small>Recorded sales</small></div><div className="bar-chart">{daily.map(d=>{const key=d.key;return <button type="button" className={"bar-col bar-select "+(selectedActivityDate===key?"active":"")} key={key} onClick={()=>setSelectedActivityDate(selectedActivityDate===key?"":key)} title={"View sales for "+pakistanDateLabel(key,{day:"2-digit",month:"short",year:"numeric"})+" · "+money(d.total)}><div className="bar-track"><div className="bar-fill" style={{height:Math.max(4,d.total/maxDaily*100)+"%"}}></div></div><small>{d.label}</small></button>;})}</div>{selectedActivityDate&&<div className="activity-drilldown"><div className="panel-head"><div><h4>Sales on {pakistanDateLabel(selectedActivityDate,{day:"2-digit",month:"short",year:"numeric"})}</h4><p>{selectedDaySales.length} invoices · {money(selectedDaySales.reduce((sum,s)=>sum+amount(s.total),0))}</p></div><button className="text-action" onClick={()=>setSelectedActivityDate("")}>Close</button></div>{selectedDaySales.map((s,i)=><div className="activity-sale-row" key={s.id||i}><span><b>{s.invoiceNo||"Invoice"}</b><small>{s.customerName||"Walk-in"} · {s.branchName||"—"} · {s.date?new Date(s.date).toLocaleTimeString("en-PK",{timeZone:"Asia/Karachi"}):"—"}</small></span><strong>{money(amount(s.total))}</strong></div>)}{!selectedDaySales.length&&<div className="empty-inline">No sales were recorded on this date.</div>}</div>}</section>
          <section className="panel stock-panel"><div className="panel-head"><div><h3>Stock attention</h3><p>Low stock and batches expiring within 30 days</p></div><button className="text-action" onClick={()=>setModule("products")}>View stock →</button></div><div className="stock-summary"><div className="stock-number">{(lowStock.length+expiryAlerts.length).toString().padStart(2,"0")}</div><div><b>{lowStock.length||expiryAlerts.length?"Needs a look":"All clear"}</b><small>{lowStock.length||expiryAlerts.length?`${lowStock.length} low-stock items · ${expiredBatchCount} expired · ${expiringWithin7DaysCount} due within 7 days · ${expiring8To30DaysCount} due in 8–30 days`:"No low-stock or near-expiry batches currently need attention"}</small></div></div><div className="stock-list">{lowStock.slice(0,3).map((p,i)=><div className="stock-row" key={p.id||i}><span className="stock-avatar">{String(p.name||"P").slice(0,1).toUpperCase()}</span><div className="stock-name"><b>{p.name||"Unnamed product"}</b><small>Low stock · {p.sku||"No SKU"}</small></div><span className="stock-qty">{amount(p.qty)} <small>{p.unit||"units"}</small></span></div>)}{expiryAlerts.slice(0,4).map((b,i)=><div className="stock-row expiry-attention" key={String((b as any).id||(b as any).batchNo||i)}><span className="stock-avatar">!</span><div className="stock-name"><b>{b.productName||b.name||"Product batch"}</b><small>{(b as any).batchNo||"Batch"} · {b.daysToExpiry<0?"Expired":b.daysToExpiry===0?"Expires today":"Expires in "+b.daysToExpiry+" days"}</small></div><span className="stock-qty">{amount(b.remainingQty??b.qty)} <small>{b.unit||"units"}</small></span></div>)}{!lowStock.length&&!expiryAlerts.length&&<div className="empty-inline">No low-stock or near-expiry batches currently need attention.</div>}</div></section></div>
          <section className="panel recent-panel"><div className="panel-head"><div><h3>Recent sales</h3><p>Latest recorded invoices from your business</p></div><button className="text-action" onClick={()=>{setSalesStartTab("history");setModule("sales");}}>All sales →</button></div><div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>PAYMENT STATUS</th><th className="align-right">TOTAL</th></tr></thead><tbody>{recent.map((s,i)=><tr key={s.id||i}><td><b className="invoice-id">{s.invoiceNo||"Invoice"}</b></td><td>{s.customerName||"Walk-in Customer"}</td><td>{dateLabel(s.date)}</td><td><span className={"status "+(amount(s.balance)>0?"pending":"paid")}>{amount(s.balance)>0?"Balance due":"Settled"}</span></td><td className="align-right amount-cell">{money(amount(s.total))}</td></tr>)}{!recent.length&&<tr><td colSpan={5} className="empty-cell">No sales have been recorded yet.</td></tr>}</tbody></table></div></section></>}</>
        :<><div className="welcome-row"><div><div className="section-kicker">ETIHAD PRIME SUPPLIES / WORKSPACE</div><h1>{title}</h1><p>{offlineMode?"Create POS sales from the last saved catalogue. Sales remain pending until cloud synchronisation.":module==="sales"?"Create sales, manage invoice history, restore open orders and convert quotations.":module==="employees"?"Employee profiles, attendance, leave and payroll records.":module==="reports"?"Business reporting built from your existing records.":"Browse your existing business records securely."}</p></div>{COLLECTION[module]&&<span className="record-count">{moduleRows.length} records</span>}</div>
          {module==="cashregister" ? <CashRegisterWorkspace orgId={orgId} userId={session.user.id} cashier={userEmail||session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="sales" ? <POSWorkspace key={salesStartTab} initialTab={salesStartTab} orgId={orgId} userId={session.user.id} cashier={userEmail || session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="products" ? <ProductManager orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="customers" ? <CustomerWorkspace orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="transfers" ? <TransferWorkspace orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="payments" ? <PaymentWorkspace orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="returns" ? <ReturnsWorkspace orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="purchases" ? <PurchaseWorkspace orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="suppliers" ? <SupplierWorkspace orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="expenses" ? <ExpenseWorkspace orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="branches" ? <BranchWorkspace orgId={orgId} userId={session.user.id} role={role} branchIds={branchIds} rows={rows} onSaved={()=>loadBusiness(session.user.id)}/> : module==="employees" ? <PeopleWorkspace orgId={orgId} userId={session.user.id} role={role} rows={rows} onRefresh={()=>loadBusiness(session.user.id)}/> : module==="reports" ? <ReportsWorkspace rows={rows}/> : module==="settings" ? <SettingsWorkspace rows={rows} orgName={orgName} orgId={orgId} userId={session.user.id} role={role} onRefresh={()=>loadBusiness(session.user.id)}/> : COLLECTION[module]?<section className="panel data-panel"><div className="data-toolbar"><div><h3>{title}</h3><p>Live records from your existing Etihad Prime Supplies database</p></div><input className="search-input" placeholder="Search records…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="table-wrap"><table><thead><tr>{(module==="payments"?["RECEIPT","CUSTOMER","DATE","METHOD","AMOUNT"]:module==="transfers"?["TRANSFER","PRODUCT","FROM","TO","QUANTITY"]:["RECORD","DETAILS","DATE"]).map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{filteredRows.map((r,i)=><RecordTableRow key={r.id||r.invoiceNo||r.sku||i} module={module} row={r}/>) }{!filteredRows.length&&<tr><td colSpan={6} className="empty-cell">{query?"No matching records.":"No records in this section yet."}</td></tr>}</tbody></table></div></section>:<section className="module-placeholder"><div className="placeholder-icon">▤</div><div className="section-kicker">MODULE FOUNDATION</div><h2>{title} workspace</h2><p>This section is part of the new Etihad Prime Supplies application. Its existing database and permission model have been retained. The full create, edit and approval workflows are being implemented in the next development stage.</p><div className="placeholder-chips"><span>Existing Supabase</span><span>Role-aware access</span><span>Responsive workspace</span></div></section>}</>}
      </div><footer className="app-footer"><span>ETIHAD PRIME SUPPLIES</span><span>Secure business workspace · Powered by Vercel + Supabase</span></footer>
    </section>
  </main>;
}

function Metric({label,value,icon,tone,note}:{label:string;value:string;icon:string;tone:string;note:string}) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={"metric-icon "+tone}>{icon}</span></div><strong>{value}</strong><small>{note}</small></article>;
}
function RecordTableRow({module,row:r}:{module:ModuleKey;row:Record<string,any>}) {
  if(module==="sales") return <tr><td><b className="invoice-id">{r.invoiceNo||"—"}</b></td><td>{r.customerName||"Walk-in Customer"}</td><td>{dateLabel(r.date)}</td><td>{money(amount(r.total))}</td><td>{money(amount(r.paid))}</td><td>{money(amount(r.balance))}</td></tr>;
  if(module==="products") return <tr><td><b>{r.name||"—"}</b></td><td>{r.sku||"—"}</td><td>{r.category||"—"}</td><td>{amount(r.qty)} {r.unit||""}</td><td>{money(amount(r.cost))}</td><td>{money(amount(r.price))}</td></tr>;
  if(module==="branches") return <tr><td><b>{r.name||"—"}</b></td><td>{r.code||"—"}</td><td>{r.address||"—"}</td><td><span className={"status "+(r.active===false?"pending":"paid")}>{r.active===false?"Inactive":"Active"}</span></td></tr>;
  if(module==="payments") return <tr><td><b>{r.receiptNo||r.invoiceNo||"—"}</b></td><td>{r.customerName||"—"}</td><td>{dateLabel(r.date)}</td><td>{r.method||"—"}</td><td>{money(amount(r.amount))}</td></tr>;
  if(module==="transfers") return <tr><td><b>{r.transferNo||"—"}</b></td><td>{r.productName||"—"}</td><td>{r.fromBranchName||"—"}</td><td>{r.toBranchName||"—"}</td><td>{amount(r.qty)}</td></tr>;
  return <tr><td><b>{r.name||r.id||"—"}</b></td><td>—</td><td>{dateLabel(r.date)}</td></tr>;
}
