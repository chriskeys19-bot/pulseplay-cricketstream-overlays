const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");
const PAGES = "https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays";

function loadApi() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, "js/psd-grounds.js"), "utf8"), context, {
    filename: "js/psd-grounds.js"
  });
  vm.runInContext(readFileSync(join(root, "js/overlay-target.js"), "utf8"), context, {
    filename: "js/overlay-target.js"
  });
  return context.window.PulsePlayDevice;
}

function inlineScripts(html) {
  const scripts = [];
  const re = /<script>([\s\S]*?)<\/script>/gi;
  let match = re.exec(html);
  while (match) {
    scripts.push(match[1]);
    match = re.exec(html);
  }
  return scripts;
}

function runPageScript(html, location, options) {
  const written = [];
  const replaced = [];
  const link = { href: "pro.html" };
  const context = {
    window: {},
    location: {
      pathname: location.pathname || "/renderer/mini.html",
      search: location.search || "",
      hash: location.hash || "",
      replace: function (url) { replaced.push(url); }
    },
    document: {
      write: function (chunk) { written.push(chunk); },
      getElementById: function () { return options && options.link ? link : null; }
    }
  };
  vm.createContext(context);
  if (!options || options.loadApi !== false) {
    vm.runInContext(readFileSync(join(root, "js/overlay-target.js"), "utf8"), context, {
      filename: "js/overlay-target.js"
    });
  }
  vm.runInContext(inlineScripts(html)[options && options.scriptIndex ? options.scriptIndex : 0], context);
  return { replaced, written, link };
}

const api = loadApi();
const miniHtml = readFileSync(join(root, "renderer/mini.html"), "utf8");
const proHtml = readFileSync(join(root, "renderer/pro.html"), "utf8");
const adminHtml = readFileSync(join(root, "admin.html"), "utf8");
const adminJs = readFileSync(join(root, "admin.js"), "utf8");

test("mini.html redirects to pro.html and forces device=pro", () => {
  assert.equal(
    api.miniHref("?ground=sycamore2&device=mini", ""),
    "pro.html?ground=sycamore2&device=pro"
  );
  assert.equal(
    api.miniHref("?ground=pms1&device=pro", ""),
    "pro.html?ground=pms1&device=pro"
  );
  assert.equal(
    api.miniHref("?ground=sycamore2&device=mini", "#panel"),
    "pro.html?ground=sycamore2&device=pro#panel"
  );
  assert.equal(
    api.miniHref("?ground=sycamore2&device=mini&adapter=mock", "#live"),
    "pro.html?ground=sycamore2&device=pro&adapter=mock#live"
  );
  assert.equal(
    api.miniHref("?device=mini&ground=pms1", ""),
    "pro.html?device=pro&ground=pms1"
  );
  assert.equal(
    api.miniHref("?ground=sycamore2", ""),
    "pro.html?ground=sycamore2&device=pro"
  );
  assert.equal(api.miniHref("", "#only"), "pro.html?device=pro#only");
  assert.equal(
    api.miniHref("?ground=sycamore2&device=mini&device=pro", ""),
    "pro.html?ground=sycamore2&device=pro"
  );
  assert.equal(
    api.miniHref("?ground=sycamore2&note=a+b&device=MINI", ""),
    "pro.html?ground=sycamore2&note=a+b&device=pro"
  );
});

test("pro.html rewrites device=mini and leaves device=pro alone", () => {
  assert.equal(api.proNeedsNormalize("?ground=sycamore2&device=mini"), true);
  assert.equal(api.proNeedsNormalize("?ground=pms1&device=pro"), false);
  assert.equal(api.proNeedsNormalize("?ground=sycamore2"), false);
  assert.equal(api.proNeedsNormalize("?device=Mini"), true);
  assert.equal(api.proNeedsNormalize("?device=miniature"), false);
  assert.equal(
    api.proHref("/renderer/pro.html", "?ground=sycamore2&device=mini", "#panel"),
    "/renderer/pro.html?ground=sycamore2&device=pro#panel"
  );
  assert.equal(
    api.proHref("/repo/renderer/pro.html", "?ground=pms1&device=pro&adapter=mock", ""),
    "/repo/renderer/pro.html?ground=pms1&device=pro&adapter=mock"
  );
  assert.equal(
    api.proHref("/renderer/pro.html", "?device=mini&ground=pms1&device=pro", ""),
    "/renderer/pro.html?device=pro&ground=pms1"
  );
});

test("device labels and saved overlay URLs stay on the Pro renderer", () => {
  assert.equal(api.deviceLabel(), "YoloBox Pro / Ultra");
  assert.equal(api.deviceLabel("mini"), "YoloBox Pro / Ultra");
  assert.equal(api.savedDevice(), "pro");
  assert.equal(api.savedDevice("mini"), "pro");
  assert.equal(api.savedDevice("ultra"), "pro");
  assert.equal(
    api.groundOptionLabel("Sycamore 2"),
    "Sycamore 2 (YoloBox Pro / Ultra)"
  );
  assert.equal(
    api.pagesRendererUrl(PAGES, "sycamore2"),
    PAGES + "/renderer/pro.html?ground=sycamore2&device=pro"
  );
  assert.equal(
    api.pagesRendererUrl(PAGES, "pms1"),
    PAGES + "/renderer/pro.html?ground=pms1&device=pro"
  );
  assert.equal(api.rendererQuery("sycamore2"), "pro.html?ground=sycamore2&device=pro");
  assert.doesNotMatch(api.pagesRendererUrl(PAGES, "sycamore2"), /mini|ultra/);
});

test("a stored short link is the web overlay, including on a split ground", () => {
  const cts = {
    id: "ctsu11",
    name: "CTS West",
    short_link: "https://ccusa-overlay.s.gy/ppstreampsdcts"
  };
  assert.equal(api.webOverlayUrl(cts, PAGES), "https://ccusa-overlay.s.gy/ppstreampsdcts");
  const saved = api.overlayChoices(cts, PAGES);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].label, "Web overlay");
  assert.equal(saved[0].url, "https://ccusa-overlay.s.gy/ppstreampsdcts");
  assert.equal(
    api.streamOverlayUrl({ overlay_url: "", start_local: "1:30 PM", ground: "CTS West" }, cts, PAGES),
    "https://ccusa-overlay.s.gy/ppstreampsdcts"
  );
  assert.equal(
    api.streamOverlayUrl({ overlay_url: "https://ccusa-overlay.s.gy/mscaavengers", start_local: "8:30 AM" }, cts, PAGES),
    "https://ccusa-overlay.s.gy/mscaavengers"
  );
});

test("split grounds without a short link use one renderer URL", () => {
  const cts = { id: "ctsu11", name: "CTS West", short_link: "" };
  const syc = { id: "sycamore2", name: "sycamore2", short_link: "  " };
  const stanford = { id: "stanfordu9", name: "StanfordU9", short_link: "" };
  const ctsUrl = PAGES + "/renderer/pro.html?ground=ctsu11&device=pro";
  const sycUrl = PAGES + "/renderer/pro.html?ground=sycamore2&device=pro";
  assert.equal(api.webOverlayUrl(cts, PAGES), ctsUrl);
  assert.equal(api.webOverlayUrl(syc, PAGES), sycUrl);
  assert.equal(
    api.webOverlayUrl(stanford, PAGES),
    PAGES + "/renderer/pro.html?ground=stanfordu9&device=pro"
  );
  const splitChoices = api.overlayChoices(cts, PAGES);
  assert.equal(splitChoices.length, 1);
  assert.equal(splitChoices[0].label, "Web overlay");
  assert.equal(splitChoices[0].url, ctsUrl);
  assert.doesNotMatch(splitChoices[0].url, /session=/);
  assert.equal(
    api.streamOverlayUrl({ overlay_url: null, start_local: "8:30 AM" }, cts, PAGES),
    ctsUrl
  );
  assert.equal(
    api.streamOverlayUrl({ overlay_url: "", start_local: "1:30 PM" }, syc, PAGES),
    sycUrl
  );
  assert.equal(
    api.streamOverlayUrl({ overlay_url: "https://ccusa-overlay.s.gy/ppstreampsdcts", start_local: "1:30 PM" }, cts, PAGES),
    "https://ccusa-overlay.s.gy/ppstreampsdcts"
  );
  assert.doesNotMatch(api.webOverlayUrl(cts, PAGES), /ultra|mini|session=/);
});

test("copy uses the clipboard and falls back to a 16px field", async () => {
  const context = { window: {}, Promise };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, "js/overlay-target.js"), "utf8"), context, {
    filename: "js/overlay-target.js"
  });
  const button = {
    textContent: "Copy",
    classNames: [],
    classList: {
      add(name) { button.classNames.push(name); },
      remove(name) { button.classNames = button.classNames.filter((item) => item !== name); }
    },
    getAttribute() { return "Copy"; }
  };
  let wrote = "";
  context.window.setTimeout = () => 1;
  context.window.clearTimeout = () => {};
  context.window.navigator = {
    clipboard: {
      writeText(text) {
        wrote = text;
        return Promise.resolve();
      }
    }
  };
  context.window.PulsePlayDevice.copyText("https://ccusa-overlay.s.gy/hpms", button);
  await Promise.resolve();
  assert.equal(wrote, "https://ccusa-overlay.s.gy/hpms");
  assert.equal(button.textContent, "Copied");
  assert.deepEqual(button.classNames, ["is-copied"]);

  const area = { value: "", style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {} };
  let command = false;
  const fallbackButton = {
    textContent: "Copy",
    classList: { add() {}, remove() {} },
    getAttribute() { return "Copy"; }
  };
  context.window.navigator = {};
  context.window.document = {
    body: {
      appendChild() {},
      removeChild() {}
    },
    createElement() { return area; },
    execCommand() { command = true; return true; }
  };
  context.window.PulsePlayDevice.copyText("https://ccusa-overlay.s.gy/pms1", fallbackButton);
  assert.equal(command, true);
  assert.equal(area.value, "https://ccusa-overlay.s.gy/pms1");
  assert.equal(area.style.fontSize, "16px");
  assert.equal(fallbackButton.textContent, "Copied");
});

test("the mini page replaces the URL and offers a refresh and link fallback", () => {
  const result = runPageScript(miniHtml, {
    search: "?ground=sycamore2&device=mini",
    hash: "#panel"
  });
  assert.deepEqual(result.replaced, ["pro.html?ground=sycamore2&device=pro#panel"]);
  assert.match(result.written[0], /http-equiv="refresh"/);
  assert.match(result.written[0], /content="0;url=pro\.html\?ground=sycamore2&amp;device=pro#panel"/);
  assert.match(result.written[1], /rel="canonical"/);

  const alreadyPro = runPageScript(miniHtml, {
    search: "?ground=pms1&device=pro",
    hash: ""
  });
  assert.deepEqual(alreadyPro.replaced, ["pro.html?ground=pms1&device=pro"]);

  const link = runPageScript(miniHtml, {
    search: "?ground=sycamore2&device=mini",
    hash: "#panel"
  }, { link: true, scriptIndex: 1 });
  assert.equal(link.link.href, "pro.html?ground=sycamore2&device=pro#panel");

  const fallback = runPageScript(miniHtml, {
    search: "?ground=pms1&device=pro",
    hash: "#keep"
  }, { loadApi: false });
  assert.deepEqual(fallback.replaced, ["pro.html?ground=pms1&device=pro#keep"]);

  assert.match(miniHtml, /location\.replace/);
  assert.match(miniHtml, /http-equiv="refresh"/);
  assert.match(miniHtml, /<a id="pro-fallback" href="pro.html">/);
  assert.match(miniHtml, /min-height:\s*44px/);
  assert.match(miniHtml, /font-size:\s*16px/);
});

test("pro.html normalizes device=mini before the overlay runs", () => {
  const mini = runPageScript(proHtml, {
    pathname: "/pulseplay/renderer/pro.html",
    search: "?ground=sycamore2&device=mini",
    hash: "#panel"
  });
  assert.deepEqual(mini.replaced, ["/pulseplay/renderer/pro.html?ground=sycamore2&device=pro#panel"]);

  const pro = runPageScript(proHtml, {
    pathname: "/renderer/pro.html",
    search: "?ground=pms1&device=pro",
    hash: ""
  });
  assert.deepEqual(pro.replaced, []);

  assert.match(proHtml, /proNeedsNormalize/);
  assert.match(proHtml, /location\.replace/);
  assert.match(proHtml, /data-device="pro"/);
});

test("admin offers only YoloBox Pro / Ultra and builds pro overlay URLs", () => {
  assert.match(adminHtml, /<option value="pro">YoloBox Pro \/ Ultra<\/option>/);
  assert.doesNotMatch(adminHtml, /<option value="mini"|YoloBox Mini|>Mini</);
  assert.match(adminHtml, /js\/psd-grounds\.js/);
  assert.match(adminHtml, /js\/overlay-target\.js/);
  assert.match(adminJs, /PulsePlayDevice\.overlayChoices\(ground, PAGES\)/);
  assert.match(readFileSync(join(root, "js/streams.js"), "utf8"), /streamOverlayUrl/);
  assert.match(readFileSync(join(root, "admin.css"), "utf8"), /\.card__overlay a, \.stream-link a/);
  assert.match(readFileSync(join(root, "admin.css"), "utf8"), /min-height:\s*44px/);
  assert.match(adminJs, /PulsePlayDevice\.deviceLabel\(\)/);
  assert.match(adminJs, /PulsePlayDevice\.savedDevice\(\)/);
  assert.match(adminJs, /PulsePlayDevice\.pagesRendererUrl\(PAGES, id\)/);
  assert.match(adminJs, /PulsePlayDevice\.groundOptionLabel\(ground\.name\)/);
  assert.match(adminJs, /PulsePlayDevice\.rendererQuery\(ground\.id\)/);
  assert.match(adminJs, /Open the YoloBox Pro \/ Ultra overlay for this ground/);
  assert.doesNotMatch(adminJs, /mini/i);
  const adminCss = readFileSync(join(root, "admin.css"), "utf8");
  assert.match(adminCss, /min-height:\s*44px/);
  assert.match(adminCss, /touch-action:\s*manipulation/);
  assert.match(adminCss, /font-size:\s*16px/);
});

test("schema and the database still allow a stored mini value", () => {
  const schema = readFileSync(join(root, "config/schema.json"), "utf8");
  const example = readFileSync(join(root, "config/grounds.example.json"), "utf8");
  const sql = readFileSync(join(root, "supabase/migrations/20261119180000_pulseplay_init.sql"), "utf8");
  assert.match(schema, /"enum": \["pro", "mini"\]/);
  assert.doesNotMatch(schema, /ultra/);
  assert.doesNotMatch(example, /mini\.html|"device": "mini"/);
  assert.match(example, /renderer\/pro\.html\?ground=cheetahs-home-mini&device=pro/);
  assert.match(sql, /device in \('pro', 'mini'\)/);
  assert.doesNotMatch(sql, /ultra/);
});
