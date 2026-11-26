const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");

function loadScore() {
  const context = {
    window: {},
    document: {
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
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, "js/score-frame.js"), "utf8"), context, {
    filename: "js/score-frame.js"
  });
  return context.window.PulsePlayScore;
}

const PMS = "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=1435&clubId=846";

test("a ccindex page gets a viewport wider than CricClubs' 1800px compact layout", () => {
  const api = loadScore();
  const view = api.frameViewport(PMS, null);
  assert.equal(view.width, 1920);
  assert.equal(view.height, 240);
  assert.ok(view.width > 1800);
  assert.equal(api.frameScale(PMS, null), 1);
});

test("the compact overlay.cricclubs.com bar stays slot-sized at 2.15", () => {
  const api = loadScore();
  const url = "https://overlay.cricclubs.com/H8J3AC/";
  assert.equal(api.frameViewport(url, null), null);
  assert.equal(api.frameScale(url, null), 2.15);
});

test("full_size selects the wide viewport and full_size false keeps the compact bar", () => {
  const api = loadScore();
  const wide = api.frameViewport("https://example.com/score", { full_size: true });
  assert.equal(wide.width, 1920);
  assert.equal(wide.height, 240);
  assert.equal(api.frameScale("https://example.com/score", { full_size: true }), 1);
  assert.equal(api.frameViewport(PMS, { full_size: false }), null);
  assert.equal(api.frameScale(PMS, { full_size: false }), 2.15);
});

test("the placeholder board is not given the ccindex viewport", () => {
  const api = loadScore();
  assert.equal(api.frameViewport("scores/board.html?batting=Cheetahs", null), null);
  assert.equal(api.frameScale("scores/board.html?batting=Cheetahs", null), 1);
});

test("the score frame is positioned from the slot variables", () => {
  const css = readFileSync(join(root, "renderer/overlay.css"), "utf8");
  assert.match(css, /#score-frame\s*\{[^}]*position:\s*absolute;/);
  assert.match(css, /left:\s*var\(--score-left,\s*0\)/);
  assert.match(css, /width:\s*var\(--score-vw,\s*100%\)/);
  assert.match(css, /height:\s*var\(--score-vh,\s*100%\)/);
  assert.match(css, /margin:\s*0 0 0 var\(--score-mx,\s*0\)/);
  assert.match(css, /transform-origin:\s*bottom center/);
});
