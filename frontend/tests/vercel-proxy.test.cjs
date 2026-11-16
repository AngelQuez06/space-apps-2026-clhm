const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const configScript = fs.readFileSync(path.join(root, "assets/config.js"), "utf8");

function configuredUrl(hostname) {
  const context = { location: { hostname, origin: `https://${hostname}` }, window: {} };
  vm.runInNewContext(configScript, context);
  return context.window.ARES_CONFIG.backendUrl;
}

test("Vercel preview connects through its own HTTPS origin", () => {
  assert.equal(configuredUrl("clhm-git-main-team.vercel.app"), "https://clhm-git-main-team.vercel.app");
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(vercel.rewrites, [{
    source: "/api/:path*",
    destination: "https://api.clhm.study/api/:path*",
  }]);
});

test("new frontend domain reaches the backend through the Vercel rewrite", () => {
  assert.equal(configuredUrl("clhm.cooking"), "https://clhm.cooking");
  assert.equal(configuredUrl("www.clhm.cooking"), "https://www.clhm.cooking");
  assert.equal(configuredUrl("localhost"), "https://api.clhm.study");
});
