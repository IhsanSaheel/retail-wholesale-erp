"use client";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }> };

export function PWARegister() {
  const [installEvent,setInstallEvent] = useState<InstallPromptEvent|null>(null);
  const [ios,setIos] = useState(false);
  const [showIosHelp,setShowIosHelp] = useState(false);
  const [installed,setInstalled] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent;
    setIos(/iPhone|iPad|iPod/i.test(ua) && !(window.navigator as Navigator & {standalone?:boolean}).standalone);
    const onPrompt = (event:Event) => { event.preventDefault(); setInstallEvent(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); setShowIosHelp(false); };
    window.addEventListener("beforeinstallprompt",onPrompt);
    window.addEventListener("appinstalled",onInstalled);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(registration => {
        void registration.update();
        registration.addEventListener("updatefound",() => {
          const worker = registration.installing;
          if(worker) worker.addEventListener("statechange",() => {
            if(worker.state==="installed" && navigator.serviceWorker.controller) worker.postMessage({type:"SKIP_WAITING"});
          });
        });
      }).catch(()=>{});
    }
    return () => { window.removeEventListener("beforeinstallprompt",onPrompt); window.removeEventListener("appinstalled",onInstalled); };
  },[]);

  async function install() {
    if(installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if(choice.outcome==="accepted") setInstalled(true);
      setInstallEvent(null);
    } else if(ios) setShowIosHelp(value=>!value);
  }

  if(installed) return null;
  if(!installEvent && !ios) return null;
  return <div className="pwa-install-wrap">
    <button className="pwa-install-button" onClick={install} aria-label="Install Etihad Traders app">
      <span aria-hidden="true">⇩</span>{installEvent?"Install app":"Add to Home Screen"}
    </button>
    {showIosHelp && <div className="pwa-install-help">In Safari, tap the <b>Share</b> button, then choose <b>Add to Home Screen</b>.</div>}
  </div>;
}
