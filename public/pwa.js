// No automatic reload or skipWaiting: an update must not interrupt an inspection.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window.gardenInstallPrompt = event;
  window.dispatchEvent(new Event("garden-install-ready"));
});
window.addEventListener("appinstalled", () => {
  window.gardenInstallPrompt = null;
  window.dispatchEvent(new Event("garden-installed"));
});
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // The online application remains usable if the browser cannot cache its shell.
      });
  });
}
