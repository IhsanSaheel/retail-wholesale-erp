import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Ihsan Sweets & Supplies App | Install the POS on Any Device",
  description: "Open Ihsan Sweets & Supplies, install the business POS on Android, iPhone, Windows, Mac and Chromebook, and use the prepared POS offline.",
  alternates: { canonical: "https://etihad-traders-saheel5.vercel.app/download" },
  openGraph: {
    title: "Ihsan Sweets & Supplies — Retail & Wholesale POS",
    description: "Install Ihsan Sweets & Supplies on your phone, laptop or Chromebook.",
    url: "https://etihad-traders-saheel5.vercel.app/download",
    siteName: "Ihsan Sweets & Supplies",
    type: "website"
  }
};

export default function DownloadPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Ihsan Sweets & Supplies",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Android, iOS, Windows, macOS, ChromeOS",
    description: "Retail and wholesale business management with point of sale and offline sales queue.",
    url: "https://etihad-traders-saheel5.vercel.app/"
  };
  return <main style={{minHeight:"100vh",background:"#101d35",color:"#fff",fontFamily:"Arial,sans-serif",padding:"clamp(24px,6vw,72px)",display:"grid",alignItems:"center"}}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structuredData)}} />
    <section style={{maxWidth:850,margin:"0 auto",width:"100%"}}>
      <img src="/brand-logo.svg?v=5" alt="Ihsan Sweets & Supplies" style={{width:220,maxWidth:"70%",height:110,objectFit:"contain",background:"#050505",borderRadius:12,padding:8}}/>
      <p style={{color:"#dfc58e",fontWeight:800,letterSpacing:3,fontSize:12,marginTop:36}}>RETAIL & WHOLESALE BUSINESS MANAGEMENT</p>
      <h1 style={{fontSize:"clamp(38px,7vw,66px)",lineHeight:1.08,margin:"14px 0",letterSpacing:-2}}>Ihsan Sweets & Supplies</h1>
      <p style={{fontSize:"clamp(17px,2.5vw,21px)",lineHeight:1.7,color:"#c5d0df",maxWidth:680}}>Your sales, products, customers and business reports in one installable point-of-sale workspace.</p>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:28}}>
        <Link href="/" style={{background:"#d9b875",color:"#101d35",padding:"14px 22px",borderRadius:9,textDecoration:"none",fontWeight:800}}>Open Ihsan Sweets & Supplies →</Link>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:14,marginTop:48}}>
        {[
          ["Android phones & tablets","Open this page in Chrome, choose Install app or Add to Home screen."],
          ["Windows, Mac & Chromebook","Open in Chrome or Edge and choose the install icon or Install Ihsan Sweets & Supplies from the browser menu."],
          ["iPhone & iPad","Open in Safari, tap Share, then Add to Home Screen."]
        ].map(([title,body])=><article key={title} style={{border:"1px solid #ffffff25",background:"#ffffff0b",borderRadius:12,padding:18}}><h2 style={{fontSize:15,color:"#f0d8a5",margin:"0 0 8px"}}>{title}</h2><p style={{fontSize:13,color:"#c5d0df",lineHeight:1.65,margin:0}}>{body}</p></article>)}
      </div>
      <p style={{marginTop:36,color:"#9eabc0",fontSize:12,lineHeight:1.7}}>Offline point of sale works after the app has been opened online, the user has signed in, and the device has saved its latest POS catalogue. Offline sales remain marked pending until cloud synchronisation is confirmed.</p>
    </section>
  </main>;
}
