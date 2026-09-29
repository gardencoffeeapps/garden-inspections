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
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || sessionStorage.getItem("garden-sw-refreshed") === "1") return;
    refreshing = true;
    sessionStorage.setItem("garden-sw-refreshed", "1");
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // The online application remains usable if the browser cannot cache its shell.
      });
  });
}
