"use client";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }> };

export function PWARegister() {
  const [installEvent,setInstallEvent] = useState<InstallPromptEvent|null>(null);
  const [ios,setIos] = useState(false);
  const [showIosHelp,setShowIosHelp] = useState(false);
  const [installed,setInstalled] = useState(false);
  const [officialHost,setOfficialHost] = useState<boolean|null>(null);

  useEffect(() => {
    const hostname = window.location.hostname.toLowerCase();
    // Support the stable production alias and Vercel's unique deployment aliases.
    // Each alias has its own origin and must register its own offline worker.
    const isOfficialHost = hostname === "etihad-traders-saheel5.vercel.app"
      || (hostname.startsWith("etihad-traders-") && hostname.endsWith(".vercel.app"));
    setOfficialHost(isOfficialHost);
    if (!isOfficialHost) return;
    const ua = window.navigator.userAgent;
    setIos(/iPhone|iPad|iPod/i.test(ua) && !(window.navigator as Navigator & {standalone?:boolean}).standalone);
    const onPrompt = (event:Event) => { event.preventDefault(); setInstallEvent(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); setShowIosHelp(false); };
    let reloadingForUpdate = false;
    const refreshToUpdatedApp = () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    };
    const onControllerChange = () => {
      // A new worker now controls this installed app. Reload once to fetch its new UI.
      refreshToUpdatedApp();
    };
    const onAppVisible = () => {
      if (document.visibilityState === "visible") {
        void navigator.serviceWorker?.getRegistration().then(registration => registration?.update());
      }
    };
    let updateCheck:number|undefined;
    window.addEventListener("beforeinstallprompt",onPrompt);
    window.addEventListener("appinstalled",onInstalled);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange",onControllerChange);
      navigator.serviceWorker.register("/sw.js?release=20261122-1",{updateViaCache:"none"}).then(registration => {
        const activateWaitingWorker = () => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            registration.waiting.postMessage({type:"SKIP_WAITING"});
          }
        };
        activateWaitingWorker();
        void registration.update();
        updateCheck = window.setInterval(() => { if (document.visibilityState === "visible") void registration.update(); }, 60_000);
        registration.addEventListener("updatefound",() => {
          const worker = registration.installing;
          if(worker) worker.addEventListener("statechange",() => {
            if(worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({type:"SKIP_WAITING"});
            }
          });
        });
        window.addEventListener("focus",onAppVisible);
        document.addEventListener("visibilitychange",onAppVisible);
      }).catch(()=>{});
    }
    return () => {
      if(updateCheck!==undefined) window.clearInterval(updateCheck);
      window.removeEventListener("beforeinstallprompt",onPrompt);
      window.removeEventListener("appinstalled",onInstalled);
      window.removeEventListener("focus",onAppVisible);
      document.removeEventListener("visibilitychange",onAppVisible);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange",onControllerChange);
    };
  },[]);

  async function install() {
    if(installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if(choice.outcome==="accepted") setInstalled(true);
      setInstallEvent(null);
    } else if(ios) setShowIosHelp(value=>!value);
  }

  if(officialHost === null) return null;
  if(!officialHost) return <div className="pwa-install-wrap"><a className="pwa-install-button" href="https://etihad-traders-saheel5.vercel.app/">Open official Etihad Prime Supplies app</a></div>;
  if(installed) return null;
  if(!installEvent && !ios) return null;
  return <div className="pwa-install-wrap">
    <button className="pwa-install-button" onClick={install} aria-label="Install Etihad Prime Supplies app">
      <span aria-hidden="true">⇩</span>{installEvent?"Install app":"Add to Home Screen"}
    </button>
    {showIosHelp && <div className="pwa-install-help">In Safari, tap the <b>Share</b> button, then choose <b>Add to Home Screen</b>.</div>}
  </div>;
}
