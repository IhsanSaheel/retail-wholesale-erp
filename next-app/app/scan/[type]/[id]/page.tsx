"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

type PublicCardProfile = { profile_name: string; profile_phone: string; profile_id: string };

export default function ScannedProfilePage() {
  const params = useParams<{ type: string; id: string }>();
  const type = String(params?.type || "").toLowerCase();
  const recordId = decodeURIComponent(String(params?.id || ""));
  const [profile, setProfile] = useState<PublicCardProfile | null>(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Loading card details…");

  useEffect(() => {
    let alive = true;
    const orgId = new URLSearchParams(window.location.search).get("org") || "";
    const isValidType = type === "customer" || type === "supplier";
    if (!isValidType || !orgId || !recordId) {
      setStatus("error");
      setMessage("This card QR code is incomplete. Please ask the business to print a new card.");
      return () => { alive = false; };
    }
    const collection = type === "customer" ? "mberp_customers" : "mberp_suppliers";
    void getSupabase()
      .rpc("etihad_public_id_card_profile", {
        p_org_id: orgId,
        p_collection: collection,
        p_record_id: recordId,
      })
      .then(({ data, error }) => {
        if (!alive) return;
        const row = Array.isArray(data) ? data[0] : null;
        if (error || !row) {
          setStatus("error");
          setMessage(error ? "Card details could not be loaded. Please try again later." : "No matching card was found. Please check that this is the latest card.");
          return;
        }
        setProfile(row as PublicCardProfile);
        setStatus("ready");
      });
    return () => { alive = false; };
  }, [recordId, type]);

  const isCustomer = type === "customer";
  const title = isCustomer ? "Customer ID Card" : "Supplier ID Card";
  const label = isCustomer ? "CUSTOMER ID" : "SUPPLIER ID";

  return (
    <main style={{minHeight:"100vh",background:"#f3f5f8",padding:"28px 16px",fontFamily:"Arial,sans-serif",color:"#17243a"}}>
      <section style={{maxWidth:520,margin:"0 auto",background:"#fff",border:"1px solid #e4e8ee",borderRadius:18,overflow:"hidden",boxShadow:"0 12px 34px rgba(23,36,58,.08)"}}>
        <header style={{background:"linear-gradient(120deg,#101e35,#263d5c)",padding:"22px 24px",borderBottom:"4px solid #c9a45f",color:"#fff"}}>
          <div style={{fontSize:11,letterSpacing:2,color:"#e2c58e",fontWeight:700}}>IHSAN SWEETS & SUPPLIES</div>
          <h1 style={{fontSize:23,margin:"9px 0 4px"}}>{title}</h1>
          <div style={{fontSize:12,color:"#d8e0eb"}}>Card identity details</div>
        </header>
        <div style={{padding:24}}>
          {status === "loading" && <p role="status">{message}</p>}
          {status === "error" && <p role="alert">{message}</p>}
          {status === "ready" && profile && <>
            <div style={{fontSize:11,letterSpacing:1.3,color:"#9a783e",fontWeight:700}}>{label}</div>
            <div style={{fontSize:13,color:"#697586",marginTop:5,overflowWrap:"anywhere"}}>{profile.profile_id}</div>
            <h2 style={{fontSize:24,margin:"18px 0 20px",overflowWrap:"anywhere"}}>{profile.profile_name || (isCustomer ? "Customer" : "Supplier")}</h2>
            <div style={{display:"grid",gap:14}}>
              <div><div style={{fontSize:11,color:"#8b744b",fontWeight:700}}>PHONE NUMBER</div><div style={{marginTop:4,fontSize:18,fontWeight:600}}>{profile.profile_phone || "—"}</div></div>
            </div>
            <div style={{marginTop:24,paddingTop:14,borderTop:"1px solid #eceff3",fontSize:12,color:"#697586"}}>Only the name, ID and phone number printed on this card are shown. No sign-in is required.</div>
          </>}
        </div>
      </section>
    </main>
  );
}
