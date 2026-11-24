"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

type Profile = Record<string, any>;

export default function ScannedProfilePage() {
  const params = useParams<{ type: string; id: string }>();
  const type = String(params?.type || "").toLowerCase();
  const recordId = decodeURIComponent(String(params?.id || ""));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Checking your Etihad account…");

  useEffect(() => {
    const db = getSupabase();
    let alive = true;
    let request = 0;

    const load = async (userId: string) => {
      const current = ++request;
      if (!alive) return;
      setStatus("loading");
      setMessage("Loading the registered profile…");
      const { data: memberships, error: membershipError } = await db
        .from("etihad_memberships")
        .select("org_id,role,active")
        .eq("user_id", userId)
        .eq("active", true);
      if (!alive || current !== request) return;
      if (membershipError) {
        setStatus("error");
        setMessage("Your business access could not be verified. Please reconnect and try again.");
        return;
      }
      if (!memberships?.length) {
        setStatus("error");
        setMessage("This login is not linked to an active Etihad Prime Supplies account.");
        return;
      }
      const collection = type === "customer" ? "mberp_customers" : "mberp_suppliers";
      const { data, error } = await db
        .from("etihad_records")
        .select("data")
        .eq("org_id", memberships[0].org_id)
        .eq("collection", collection)
        .eq("record_id", recordId)
        .maybeSingle();
      if (!alive || current !== request) return;
      if (error || !data?.data) {
        setStatus("error");
        setMessage(error ? "Your account does not have permission to view this profile, or it could not be loaded." : "No matching profile was found in your business. Check that you scanned the latest card.");
        return;
      }
      setProfile(data.data as Profile);
      setStatus("ready");
    };

    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id) void load(session.user.id);
      else {
        setProfile(null);
        setStatus("signed-out");
        setMessage("Sign in to your Etihad Prime Supplies account to securely view this card.");
      }
    });
    void db.auth.getSession().then(({ data }) => {
      if (data.session?.user?.id) void load(data.session.user.id);
      else if (alive) {
        setStatus("signed-out");
        setMessage("Sign in to your Etihad Prime Supplies account to securely view this card.");
      }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [recordId, type]);

  const isCustomer = type === "customer";
  const title = isCustomer ? "Customer profile" : "Supplier profile";
  const label = isCustomer ? "CUSTOMER ID" : "SUPPLIER ID";

  return (
    <main style={{minHeight:"100vh",background:"#f3f5f8",padding:"28px 16px",fontFamily:"Arial,sans-serif",color:"#17243a"}}>
      <section style={{maxWidth:520,margin:"0 auto",background:"#fff",border:"1px solid #e4e8ee",borderRadius:18,overflow:"hidden",boxShadow:"0 12px 34px rgba(23,36,58,.08)"}}>
        <header style={{background:"linear-gradient(120deg,#101e35,#263d5c)",padding:"22px 24px",borderBottom:"4px solid #c9a45f",color:"#fff"}}>
          <div style={{fontSize:11,letterSpacing:2,color:"#e2c58e",fontWeight:700}}>ETIHAD PRIME SUPPLIES</div>
          <h1 style={{fontSize:23,margin:"9px 0 4px"}}>{title}</h1>
          <div style={{fontSize:12,color:"#d8e0eb"}}>Secure card verification</div>
        </header>
        <div style={{padding:24}}>
          {status === "loading" && <p role="status">{message}</p>}
          {status === "signed-out" && <><p>{message}</p><Link href="/" style={{display:"inline-block",marginTop:10,padding:"11px 16px",borderRadius:9,background:"#172b4d",color:"#fff",textDecoration:"none",fontWeight:700}}>Sign in to Etihad Prime Supplies</Link><p style={{fontSize:12,color:"#697586",marginTop:14}}>After signing in, scan this card again to open its profile.</p></>}
          {status === "error" && <><p role="alert">{message}</p><Link href="/" style={{color:"#9a783e",fontWeight:700}}>Return to sign in</Link></>}
          {status === "ready" && profile && <>
            <div style={{fontSize:11,letterSpacing:1.3,color:"#9a783e",fontWeight:700}}>{label}</div>
            <div style={{fontSize:13,color:"#697586",marginTop:5,overflowWrap:"anywhere"}}>{recordId}</div>
            <h2 style={{fontSize:24,margin:"18px 0 20px",overflowWrap:"anywhere"}}>{profile.name || (isCustomer ? "Customer" : "Supplier")}</h2>
            <div style={{display:"grid",gap:14}}>
              <div><div style={{fontSize:11,color:"#8b744b",fontWeight:700}}>PHONE</div><div style={{marginTop:4}}>{profile.phone || "—"}</div></div>
              {profile.address && <div><div style={{fontSize:11,color:"#8b744b",fontWeight:700}}>ADDRESS</div><div style={{marginTop:4,overflowWrap:"anywhere"}}>{profile.address}</div></div>}
              {profile.email && <div><div style={{fontSize:11,color:"#8b744b",fontWeight:700}}>EMAIL</div><div style={{marginTop:4,overflowWrap:"anywhere"}}>{profile.email}</div></div>}
            </div>
            <div style={{marginTop:24,paddingTop:14,borderTop:"1px solid #eceff3",fontSize:12,color:"#697586"}}>Verified against your signed-in business account. This page does not display account balances or payment information.</div>
          </>}
        </div>
      </section>
    </main>
  );
}
