// Vercel previews and the frontend domain use the same-origin /api rewrite.
const frontendHost = location.hostname.toLowerCase();
window.ARES_CONFIG = {
  backendUrl: ["clhm.cooking", "www.clhm.cooking"].includes(frontendHost) || frontendHost.endsWith(".vercel.app")
    ? location.origin : "https://api.clhm.study",
};
