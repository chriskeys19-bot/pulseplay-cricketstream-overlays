const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");
const CCINDEX = "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=1435&clubId=846";
const OVERLAY = "https://overlay.cricclubs.com/H8J3AC/";

function makeEl() {
  const props = {};
  const el = {
    style: {
      getPropertyValue(name) {
        return props[name] == null ? "" : String(props[name]);
      },
      setProperty(name, value) {
        props[name] = String(value);
      },
      removeProperty(name) {
        delete props[name];
      }
    },
    offsetWidth: 0,
    offsetHeight: 48
  };
  return el;
}

function loadRenderer() {
  const ids = {};
  const els = {
    score: makeEl(),
    frame: makeEl(),
    ticker: makeEl(),
    age: makeEl(),
    tournament: makeEl(),
    sponsor: makeEl(),
    ccusa: makeEl()
  };
  ids["score-slot"] = els.score;
  ids["score-frame"] = els.frame;
  ids["subscribe-ticker"] = els.ticker;

  const context = {
    window: {
      location: { search: "" },
      innerWidth: 1920,
      innerHeight: 1080,
      addEventListener() {},
      setInterval() { return 0; },
      clearInterval() {},
      setTimeout() { return 0; },
      clearTimeout() {},
      PulsePlayStore: {
        DEFAULT_POLL_MS: 2000,
        create() {
          return {
            read() {},
            subscribe() {},
            mediaUrl() {},
            safeUrl(url) { return url || ""; },
            hostBlocksEmbed() { return false; }
          };
        }
      }
    },
    document: {
      getElementById(id) { return ids[id] || null; },
      createElement() {
        const el = { hostname: "", pathname: "" };
        let href = "";
        Object.defineProperty(el, "href", {
          get() { return href; },
          set(value) {
            href = String(value || "");
            try {
              const url = new URL(href, "http://localhost/");
              el.hostname = url.hostname;
              el.pathname = url.pathname;
            } catch (e) {
              el.hostname = "";
              el.pathname = "";
            }
          }
        });
        return el;
      }
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, "js/score-frame.js"), "utf8"), context, {
    filename: "js/score-frame.js"
  });
  vm.runInContext(readFileSync(join(root, "js/layout.js"), "utf8"), context, {
    filename: "js/layout.js"
  });
  let overlay = readFileSync(join(root, "renderer/overlay.js"), "utf8");
  const marker = "  window.addEventListener(\"resize\", fitStage);";
  assert.ok(overlay.includes(marker), "fitScore stays inside the renderer closure");
  overlay = overlay.replace(
    marker,
    "  window.PulsePlayScoreFit = { fitScore: fitScore, placeTicker: placeTicker };\n" + marker
  );
  vm.runInContext(overlay, context, { filename: "renderer/overlay.js" });
  return { context, els, layout: context.window.PulsePlayLayout, fit: context.window.PulsePlayScoreFit };
}

const renderer = loadRenderer();

function place(profile, layout) {
  const els = renderer.els;
  renderer.layout.place({
    device: "pro",
    profile: profile,
    layout: layout,
    age: els.age,
    tournament: els.tournament,
    sponsor: els.sponsor,
    cricketcraze: els.ccusa,
    score: els.score,
    ticker: els.ticker
  });
}

function ground(url, scale, extra) {
  const item = Object.assign({ url: url, active: true }, extra || {});
  return {
    score_url: url,
    score_overlays: [item],
    layout: scale == null ? null : { score: scale }
  };
}

function fit(profile, url, scale, extra) {
  place(profile, scale == null ? null : { score: scale });
  renderer.fit.fitScore(ground(url, scale, extra));
  renderer.fit.placeTicker();
  return {
    sx: renderer.els.score.style.getPropertyValue("--score-sx"),
    sy: renderer.els.score.style.getPropertyValue("--score-sy"),
    paint: renderer.els.score.style.getPropertyValue("--score-paint"),
    vw: renderer.els.score.style.getPropertyValue("--score-vw"),
    left: renderer.els.score.style.getPropertyValue("--score-left"),
    mx: renderer.els.score.style.getPropertyValue("--score-mx"),
    slotW: parseFloat(renderer.els.score.style.width),
    slotH: parseFloat(renderer.els.score.style.height),
    slotBottom: parseFloat(renderer.els.score.style.bottom),
    tickerBottom: parseFloat(renderer.els.ticker.style.bottom),
    tickerLeft: renderer.els.ticker.style.left,
    tickerWidth: renderer.els.ticker.style.width
  };
}

test("a PSD full-size bar at 100% fits the clamped slot and does not grow past it", () => {
  const painted = fit("psd", OVERLAY, { scale: 1 }, { full_size: true });
  assert.equal(painted.slotW, 1332);
  assert.equal(painted.sx, "0.694");
  assert.equal(painted.sy, "0.694");
  assert.equal(painted.paint, "166.5");
  assert.equal(painted.vw, "1920px");
  assert.equal(painted.left, "50%");
  assert.equal(painted.mx, "-960px");
  assert.equal(painted.tickerBottom, renderer.layout.tickerBottom(painted.slotBottom, 166.5, 1, 48));
  assert.ok(painted.tickerBottom >= painted.slotBottom + Number(painted.paint));
});

test("raising a PSD full-size score above 100% enlarges the painted bar from the same slot", () => {
  const baseline = fit("psd", CCINDEX, null, null);
  const grown = fit("psd", CCINDEX, { scale: 1.5 }, null);
  assert.equal(baseline.slotW, 1332);
  assert.equal(grown.slotW, baseline.slotW);
  assert.equal(baseline.sy, "0.694");
  assert.equal(grown.sy, "1.041");
  assert.equal(grown.sx, "1.041");
  assert.equal(grown.paint, "249.75");
  assert.equal(grown.left, "50%");
  assert.equal(grown.mx, "-960px");
  assert.ok(Number(grown.paint) > Number(baseline.paint));
  assert.ok(grown.tickerBottom > baseline.tickerBottom);
  assert.equal(grown.tickerBottom, renderer.layout.tickerBottom(grown.slotBottom, 249.75, 1, 48));
  assert.ok(grown.tickerBottom >= grown.slotBottom + Number(grown.paint));
  assert.equal(grown.tickerLeft, renderer.els.score.style.left);
  assert.equal(grown.tickerWidth, renderer.els.score.style.width);
});

test("a full-size scale of 200% is the top of the clamp and 250% does not go past it", () => {
  const full = fit("psd", OVERLAY, { scale: 2 }, { full_size: true });
  const capped = fit("psd", OVERLAY, { scale: 2.5 }, { full_size: true });
  assert.equal(full.sy, "1.388");
  assert.equal(full.paint, "333");
  assert.equal(capped.sy, full.sy);
  assert.equal(capped.paint, full.paint);
  assert.equal(capped.slotW, 1332);
  assert.ok(full.tickerBottom >= full.slotBottom + Number(full.paint));
});

test("full-size scale at or below 100% stays on the slot-fit baseline", () => {
  const at100 = fit("psd", CCINDEX, { scale: 1 }, null);
  const underGap = fit("psd", CCINDEX, { scale: 0.8 }, null);
  const missing = fit("psd", CCINDEX, null, null);
  const shrunk = fit("", CCINDEX, { scale: 0.5 }, null);
  assert.equal(at100.sy, "0.694");
  assert.equal(missing.sy, at100.sy);
  assert.equal(missing.paint, at100.paint);
  assert.equal(underGap.slotW, 1248);
  assert.equal(underGap.sy, "0.65");
  assert.notEqual(underGap.sy, "0.52");
  assert.equal(shrunk.slotW, 780);
  assert.equal(shrunk.sy, "0.406");
  assert.equal(shrunk.paint, "97.5");
});

test("a non-PSD full-size bar at 100% is unchanged and still grows once scale passes 100%", () => {
  const baseline = fit("", OVERLAY, { scale: 1 }, { full_size: true });
  const grown = fit("", OVERLAY, { scale: 1.5 }, { full_size: true });
  assert.equal(baseline.slotW, 1560);
  assert.equal(baseline.sy, "0.813");
  assert.equal(baseline.paint, "195");
  assert.equal(grown.slotW, 1610);
  assert.equal(grown.sy, "1.258");
  assert.equal(grown.paint, "301.875");
  assert.ok(grown.tickerBottom >= grown.slotBottom + Number(grown.paint));
});

test("compact score bars keep the 2.15 scale when the layout scale is above 100%", () => {
  const psd = fit("psd", OVERLAY, { scale: 1.5 }, { full_size: false });
  const plain = fit("", OVERLAY, { scale: 1.16 }, null);
  assert.equal(psd.vw, "");
  assert.equal(psd.sy, "2.15");
  assert.equal(psd.sx, "2.15");
  assert.equal(psd.slotH, 446);
  assert.equal(psd.paint, "958.9");
  assert.equal(psd.tickerBottom, renderer.layout.tickerBottom(28, 446, 2.15, 48));
  assert.equal(plain.sy, "2.15");
  assert.equal(plain.vw, "");
  assert.notEqual(plain.sy, "2.494");
});

test("score width still narrows a scaled-up full-size bar from the center", () => {
  const painted = fit("psd", CCINDEX, { scale: 1.5, width: 0.8 }, null);
  assert.equal(painted.sy, "1.041");
  assert.equal(painted.sx, "0.833");
  assert.equal(painted.left, "50%");
  assert.equal(painted.mx, "-960px");
});

test("the slot stays overflow visible and the frame grows from bottom center", () => {
  const css = readFileSync(join(root, "renderer/overlay.css"), "utf8");
  assert.match(css, /#score-slot \{ position: absolute; overflow: visible;/);
  assert.match(css, /transform-origin:\s*bottom center/);
});
