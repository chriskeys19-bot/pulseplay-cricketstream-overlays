const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");
const BASE = "https://example.supabase.co";

function loadStore() {
  const calls = [];
  const sockets = [];
  const context = {
    window: {
      setInterval() { return 1; },
      clearInterval() {},
      setTimeout() { return 1; },
      clearTimeout() {},
      fetch(url, init) {
        calls.push({ url: String(url), init: init || {}, transport: "fetch" });
        return Promise.resolve({
          ok: true,
          status: 200,
          text() { return Promise.resolve("[]"); }
        });
      },
      WebSocket: function WebSocket(url) {
        this.url = url;
        this.readyState = 1;
        this.sent = [];
        sockets.push(this);
      }
    }
  };
  context.window.WebSocket.prototype.send = function () {};
  context.window.WebSocket.prototype.close = function () {};
  context.XMLHttpRequest = function XMLHttpRequest() {
    this.headers = {};
    this.method = "";
    this.url = "";
    this.readyState = 0;
    this.status = 0;
    this.responseText = "";
  };
  context.XMLHttpRequest.prototype.open = function (method, url) {
    this.method = method;
    this.url = url;
  };
  context.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this.headers[name] = value;
  };
  context.XMLHttpRequest.prototype.send = function () {
    calls.push({
      url: this.url,
      init: { method: this.method, headers: this.headers },
      transport: "xhr"
    });
    this.readyState = 4;
    this.status = 200;
    this.responseText = "[]";
    if (this.onreadystatechange) this.onreadystatechange();
  };
  context.window.window = context.window;
  vm.createContext(context);
  let source = readFileSync(join(root, "js/supabase-store.js"), "utf8");
  source = source.replace(
    "return {\n      read: read,",
    "return {\n      request: request,\n      read: read,"
  );
  vm.runInContext(source, context, { filename: "js/supabase-store.js" });
  const store = context.window.PulsePlayStore.createSupabaseStore({
    supabaseUrl: BASE,
    supabaseKey: "publishable-test-key"
  });
  return { store, calls, sockets, window: context.window };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertReadHeaders(call) {
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.headers["Cache-Control"], "no-cache");
  assert.equal(call.init.headers.Pragma, "no-cache");
  assert.equal(call.init.headers.apikey, "publishable-test-key");
  assert.equal(call.init.method, "GET");
}

test("pp_grounds reads use no-store and do not add a PostgREST query param", async () => {
  const env = loadStore();
  let doc = null;
  env.store.read(function (err, next) {
    assert.equal(err, null);
    doc = next;
  });
  await tick();
  await tick();
  assert.ok(doc);
  assert.equal(env.calls.length, 4);
  const grounds = env.calls.find((call) => call.url.indexOf("/rest/v1/pp_grounds?") !== -1);
  assert.ok(grounds);
  assert.equal(grounds.url, BASE + "/rest/v1/pp_grounds?select=*&order=name.asc");
  assert.equal(grounds.url.indexOf("_="), -1);
  assert.equal(grounds.url.indexOf("ppbust="), -1);
  env.calls.forEach(assertReadHeaders);
  for (const path of [
    "/rest/v1/pp_settings?select=*",
    "/rest/v1/pp_assets?select=*&order=created_at.asc",
    "/rest/v1/pp_ground_ads?select=*&order=position.asc"
  ]) {
    assert.ok(env.calls.some((call) => call.url === BASE + path), path);
  }
});

test("a Realtime pp_grounds read stays cache-busted only by no-store headers", async () => {
  const env = loadStore();
  const stop = env.store.subscribe(function () {});
  assert.equal(env.sockets.length, 1);
  env.sockets[0].onopen();
  env.calls.length = 0;
  env.sockets[0].onmessage({ data: JSON.stringify({ event: "postgres_changes" }) });
  await tick();
  await tick();
  const grounds = env.calls.find((call) => call.url.indexOf("pp_grounds") !== -1);
  assert.ok(grounds);
  assert.equal(grounds.url, BASE + "/rest/v1/pp_grounds?select=*&order=name.asc");
  assertReadHeaders(grounds);
  stop();
});

test("non-PostgREST GET and HEAD reads can take a _ cache buster", async () => {
  const env = loadStore();
  await new Promise((resolve) => {
    env.store.request("https://cdn.example/logo.png?x=1#pic", { method: "GET", headers: {} }, function (err) {
      assert.equal(err, null);
      resolve();
    });
  });
  await new Promise((resolve) => {
    env.store.request("/storage/v1/object/public/pulseplay-assets/a.png", { method: "HEAD", headers: {} }, function (err) {
      assert.equal(err, null);
      resolve();
    });
  });
  assert.match(env.calls[0].url, /^https:\/\/cdn\.example\/logo\.png\?x=1&_=\d+#pic$/);
  assert.equal(env.calls[0].init.cache, "no-store");
  assert.match(env.calls[1].url, new RegExp("^" + BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/storage/v1/object/public/pulseplay-assets/a\\.png\\?_=\\d+$"));
  assert.equal(env.calls[1].init.method, "HEAD");
  assert.equal(env.calls[1].init.cache, "no-store");
});

test("PostgREST writes are not cache-busted and XHR reads still send no-cache", () => {
  const env = loadStore();
  env.window.fetch = null;
  let posted = false;
  env.store.request("/rest/v1/pp_grounds?on_conflict=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }, function (err) {
    assert.equal(err, null);
    posted = true;
  });
  assert.equal(posted, true);
  assert.equal(env.calls[0].transport, "xhr");
  assert.equal(env.calls[0].url, BASE + "/rest/v1/pp_grounds?on_conflict=id");
  assert.equal(env.calls[0].init.method, "POST");
  assert.equal(env.calls[0].init.headers["Cache-Control"], undefined);
  assert.equal(env.calls[0].init.headers.Pragma, undefined);

  env.calls.length = 0;
  let read = false;
  env.store.request("/rest/v1/pp_grounds?select=*&order=name.asc", { method: "GET", headers: {} }, function (err) {
    assert.equal(err, null);
    read = true;
  });
  assert.equal(read, true);
  assert.equal(env.calls[0].url, BASE + "/rest/v1/pp_grounds?select=*&order=name.asc");
  assert.equal(env.calls[0].init.headers["Cache-Control"], "no-cache");
  assert.equal(env.calls[0].init.headers.Pragma, "no-cache");
  assert.equal(env.calls[0].init.headers.apikey, "publishable-test-key");
});
