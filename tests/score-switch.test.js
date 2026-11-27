const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");
const MORNING = "https://overlay.cricclubs.com/MORNING/";
const AFTERNOON = "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=99&clubId=1";

function loadOverlay() {
  let now = 1700000000000;
  const timers = [];
  let seq = 1;

  function styleBag() {
    const props = {};
    return {
      cssText: "",
      backgroundColor: "",
      left: "",
      bottom: "",
      width: "",
      height: "",
      getPropertyValue(name) {
        return props[name] == null ? "" : String(props[name]);
      },
      setProperty(name, value) {
        props[name] = String(value);
      },
      removeProperty(name) {
        delete props[name];
      }
    };
  }

  function makeNode(tag) {
    const attrs = {};
    const children = [];
    const classNames = new Set();
    const node = {
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      id: "",
      parentNode: null,
      children,
      childNodes: children,
      style: styleBag(),
      onload: null,
      onerror: null,
      _loadedInSlot: false,
      textContent: "",
      offsetWidth: 0,
      offsetHeight: 0
    };
    Object.defineProperty(node, "className", {
      get() { return Array.from(classNames).join(" "); },
      set(value) {
        classNames.clear();
        String(value || "").split(/\s+/).filter(Boolean).forEach((name) => classNames.add(name));
      }
    });
    node.classList = {
      add(name) { classNames.add(name); },
      remove(name) { classNames.delete(name); },
      contains(name) { return classNames.has(name); }
    };
    node.setAttribute = function (name, value) {
      attrs[name] = String(value);
      if (name === "id") node.id = String(value);
    };
    node.getAttribute = function (name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    };
    node.removeAttribute = function (name) {
      delete attrs[name];
    };
    node.appendChild = function (child) {
      child.parentNode = node;
      children.push(child);
      return child;
    };
    node.removeChild = function (child) {
      const index = children.indexOf(child);
      if (index < 0) throw new Error("not a child");
      children.splice(index, 1);
      child.parentNode = null;
      return child;
    };
    node.replaceChild = function (next, prev) {
      const index = children.indexOf(prev);
      if (index < 0) throw new Error("not a child");
      children[index] = next;
      next.parentNode = node;
      prev.parentNode = null;
      return prev;
    };
    let src = "";
    Object.defineProperty(node, "src", {
      configurable: true,
      get() { return src; },
      set(value) {
        src = String(value);
        attrs.src = src;
        if (node.parentNode && node.parentNode.id === "score-slot") node._loadedInSlot = true;
      }
    });
    return node;
  }

  function makeAnchor() {
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

  const body = makeNode("body");
  const slot = makeNode("div");
  slot.id = "score-slot";
  slot.setAttribute("id", "score-slot");
  slot.offsetWidth = 1560;
  slot.offsetHeight = 297;
  const frame = makeNode("iframe");
  frame.id = "score-frame";
  frame.setAttribute("id", "score-frame");
  const fallback = makeNode("p");
  const link = makeNode("a");
  const ticker = makeNode("div");
  ticker.id = "subscribe-ticker";
  ticker.setAttribute("id", "subscribe-ticker");
  slot.appendChild(frame);
  body.appendChild(slot);
  body.appendChild(ticker);

  function getElementById(id) {
    function walk(node) {
      if (!node || typeof node !== "object") return null;
      if (node.id === id) return node;
      const kids = node.children || [];
      for (let i = 0; i < kids.length; i++) {
        const found = walk(kids[i]);
        if (found) return found;
      }
      return null;
    }
    return walk(body);
  }

  function FakeDate() {
    if (!(this instanceof FakeDate)) return new FakeDate();
    this._t = now;
  }
  FakeDate.prototype.getTime = function () { return this._t; };
  FakeDate.now = function () { return now; };

  const context = {
    window: {
      location: { search: "?ground=g1" },
      innerWidth: 1920,
      innerHeight: 1080,
      addEventListener() {},
      setInterval() { return 0; },
      clearInterval() {},
      setTimeout(fn) {
        const id = seq++;
        timers.push({ id, fn });
        return id;
      },
      clearTimeout(id) {
        const index = timers.findIndex((timer) => timer.id === id);
        if (index >= 0) timers.splice(index, 1);
      },
      PulsePlayStore: {
        DEFAULT_POLL_MS: 2000,
        safeUrl(url) {
          const value = String(url || "").replace(/^\s+/, "");
          if (!value || value.toLowerCase().indexOf("javascript:") === 0) return "";
          return value;
        },
        hostBlocksEmbed() { return false; },
        create() {
          return {
            read() {},
            subscribe() {},
            mediaUrl() {},
            write(_doc, callback) { if (callback) callback(null); }
          };
        }
      }
    },
    document: {
      body,
      getElementById,
      createElement(tag) {
        if (String(tag).toLowerCase() === "a") return makeAnchor();
        return makeNode(tag);
      }
    },
    Date: FakeDate
  };
  context.window.window = context.window;
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, "js/score-frame.js"), "utf8"), context, {
    filename: "js/score-frame.js"
  });
  let overlay = readFileSync(join(root, "renderer/overlay.js"), "utf8");
  const marker = "  window.addEventListener(\"resize\", fitStage);";
  assert.ok(overlay.includes(marker));
  overlay = overlay.replace(
    marker,
    "  window.PulsePlayOverlayTest = { setScore: setScore, visualSig: visualSig, apply: apply, resolvedScoreUrl: resolvedScoreUrl };\n" + marker
  );
  vm.runInContext(overlay, context, { filename: "renderer/overlay.js" });
  return {
    api: context.window.PulsePlayOverlayTest,
    document: context.document,
    slot,
    fallback,
    link,
    advance(ms) { now += ms; }
  };
}

function ground(extra) {
  return Object.assign({
    id: "g1",
    mode: "logos_score",
    score_url: MORNING,
    logos: {},
    layout: null
  }, extra);
}

function doc(item) {
  return { grounds: [item], assets: [], poll_ms: 2000, ticker_enabled: false };
}

test("the active score overlay URL wins over a stale score_url", () => {
  const env = loadOverlay();
  const active = ground({
    score_overlays: [
      { id: "am", url: MORNING, active: false, full_size: false },
      { id: "pm", url: AFTERNOON, active: true, full_size: true }
    ]
  });
  assert.equal(env.api.resolvedScoreUrl(active), AFTERNOON);
  assert.match(env.api.visualSig(doc(active), active), new RegExp(AFTERNOON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\|pm\\|1"));
  assert.equal(env.api.visualSig(doc(active), active).includes(MORNING), false);

  const blankActive = ground({
    score_overlays: [
      { id: "blank", url: "   ", active: true },
      { id: "am", url: MORNING, active: false, full_size: false }
    ]
  });
  assert.equal(env.api.resolvedScoreUrl(blankActive), MORNING);

  const fallback = ground({ score_overlays: [] });
  assert.equal(env.api.resolvedScoreUrl(fallback), MORNING);
  assert.match(env.api.visualSig(doc(fallback), fallback), /https:\/\/overlay\.cricclubs\.com\/MORNING\/\|\|\|0/);
});

test("setScore loads the active overlay and fitScore uses that URL", () => {
  const env = loadOverlay();
  const active = ground({
    score_overlays: [
      { id: "am", url: MORNING, active: false, full_size: false },
      { id: "pm", url: AFTERNOON, active: true }
    ]
  });
  env.api.setScore(active);
  const live = env.document.getElementById("score-frame");
  assert.equal(live.parentNode.id, "score-slot");
  assert.equal(live._loadedInSlot, true);
  assert.equal(live.id, "score-frame");
  assert.equal(live.getAttribute("data-pending"), AFTERNOON);
  assert.equal(live.src, AFTERNOON + "&ppbust=1700000000000");
  assert.equal(env.slot.style.getPropertyValue("--score-vw"), "1920px");
});

test("a poll retries setScore when the frame never reached the new canonical URL", () => {
  const env = loadOverlay();
  const active = ground({
    score_overlays: [
      { id: "am", url: MORNING, active: false, full_size: false },
      { id: "pm", url: AFTERNOON, active: true, full_size: true }
    ]
  });
  const config = doc(active);
  env.api.apply(config);
  const first = env.document.getElementById("score-frame");
  assert.equal(first.getAttribute("data-pending"), AFTERNOON);
  const src = first.src;
  env.api.apply(config);
  assert.equal(env.document.getElementById("score-frame"), first);
  assert.equal(first.src, src);

  first.setAttribute("data-pending-at", "1");
  env.advance(5000);
  env.api.apply(config);
  const retried = env.document.getElementById("score-frame");
  assert.notEqual(retried, first);
  assert.equal(retried.getAttribute("data-pending"), AFTERNOON);
  assert.notEqual(retried.src, src);
  assert.match(retried.src, /ppbust=/);

  retried.onload();
  const loaded = retried.src;
  env.advance(10000);
  env.api.apply(config);
  assert.equal(env.document.getElementById("score-frame"), retried);
  assert.equal(retried.src, loaded);
  assert.equal(retried.getAttribute("data-current"), AFTERNOON);

  retried.setAttribute("data-current", MORNING);
  retried.removeAttribute("data-pending");
  env.api.apply(config);
  const replaced = env.document.getElementById("score-frame");
  assert.notEqual(replaced, retried);
  assert.equal(replaced.getAttribute("data-pending"), AFTERNOON);
  assert.match(replaced.src, /ccindex\.html\?matchId=99&clubId=1&ppbust=/);
});
