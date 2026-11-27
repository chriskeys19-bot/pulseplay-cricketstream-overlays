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

function loadAttach() {
  let now = 1700000000000;
  const timers = [];
  let seq = 1;

  function styleBag() {
    const props = {};
    return {
      cssText: "",
      backgroundColor: "",
      left: "",
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
      href: "",
      target: "",
      rel: ""
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
  const frame = makeNode("iframe");
  frame.id = "score-frame";
  frame.setAttribute("id", "score-frame");
  frame.style.cssText = "color-scheme: normal";
  const fallback = makeNode("p");
  fallback.id = "score-fallback";
  const link = makeNode("a");
  link.id = "score-fallback-link";
  slot.appendChild(frame);
  slot.appendChild(fallback);
  body.appendChild(slot);

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
        safeUrl(url) {
          const value = String(url || "").replace(/^\s+/, "");
          if (!value || value.toLowerCase().indexOf("javascript:") === 0) return "";
          return value;
        },
        hostBlocksEmbed() { return false; }
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

  function opts(iframe, url) {
    return {
      iframe: iframe,
      fallback: fallback,
      link: link,
      url: url,
      linkLabel: "Open score"
    };
  }

  return {
    api: context.window.PulsePlayScore,
    body,
    slot,
    frame,
    fallback,
    link,
    document: context.document,
    opts,
    advance(ms) { now += ms; },
    flush() {
      const due = timers.splice(0, timers.length);
      due.forEach((timer) => timer.fn());
    },
    pendingTimers() { return timers.length; }
  };
}

const SCORE = "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=1435&clubId=846#bar";
const NEXT = "https://overlay.cricclubs.com/AFTERNOON/";

test("a new score URL replaces #score-frame inside the slot", () => {
  const env = loadAttach();
  const original = env.frame;
  env.api.attach(env.opts(original, SCORE));
  const live = env.document.getElementById("score-frame");
  assert.notEqual(live, original);
  assert.equal(original.parentNode, null);
  assert.equal(original.src, "");
  assert.equal(live.id, "score-frame");
  assert.equal(live.parentNode, env.slot);
  assert.equal(live._loadedInSlot, true);
  assert.equal(live.getAttribute("title"), "Match score");
  assert.equal(live.getAttribute("scrolling"), "no");
  assert.equal(live.getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(live.getAttribute("allowtransparency"), "true");
  assert.equal(live.style.backgroundColor, "transparent");
  assert.equal(live.style.cssText, "color-scheme: normal");
  assert.equal(live.classList.contains("is-off"), false);
  assert.equal(
    live.src,
    "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=1435&clubId=846&ppbust=1700000000000#bar"
  );
  assert.equal(live.getAttribute("data-pending"), "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=1435&clubId=846#bar");
  assert.equal(live.getAttribute("data-current"), null);
  assert.equal(env.body.children.some((node) => node.getAttribute && node.getAttribute("aria-hidden") === "true"), false);
});

test("the same canonical score URL does not reload the iframe", () => {
  const env = loadAttach();
  env.api.attach(env.opts(env.frame, SCORE));
  const live = env.document.getElementById("score-frame");
  live.onload();
  const src = live.src;
  assert.equal(live.getAttribute("data-current"), "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=1435&clubId=846#bar");
  assert.equal(live.getAttribute("data-pending"), null);
  env.advance(5000);
  env.api.attach(env.opts(live, SCORE));
  assert.equal(env.document.getElementById("score-frame"), live);
  assert.equal(live.src, src);
  env.api.attach(env.opts(live, SCORE.replace("#bar", "&ppbust=999#bar")));
  assert.equal(env.document.getElementById("score-frame"), live);
  assert.equal(live.src, src);
});

test("a changed score URL cache-busts with ppbust and keeps the query and hash", () => {
  const env = loadAttach();
  env.api.attach(env.opts(env.frame, SCORE));
  const first = env.document.getElementById("score-frame");
  first.onload();
  env.advance(25);
  env.api.attach(env.opts(first, NEXT));
  const live = env.document.getElementById("score-frame");
  assert.notEqual(live, first);
  assert.equal(first.src.indexOf("AFTERNOON"), -1);
  assert.equal(live.src, NEXT + "?ppbust=1700000000025");
  assert.equal(live.getAttribute("data-pending"), NEXT);
  assert.equal(live.getAttribute("data-current"), null);
  assert.equal(env.slot.children[0], live);
});

test("a fresh in-flight load is left alone and a stale one is retried", () => {
  const env = loadAttach();
  env.api.attach(env.opts(env.frame, NEXT));
  const first = env.document.getElementById("score-frame");
  env.api.attach(env.opts(first, NEXT));
  assert.equal(env.document.getElementById("score-frame"), first);
  first.setAttribute("data-pending-at", "1");
  env.advance(5000);
  env.api.attach(env.opts(first, NEXT));
  const retry = env.document.getElementById("score-frame");
  assert.notEqual(retry, first);
  assert.equal(retry.getAttribute("data-score-attempts"), "2");
  assert.match(retry.src, /ppbust=1700000005000/);
});

test("the onload watchdog retries a hidden-frame miss and then stops", () => {
  const env = loadAttach();
  env.api.attach(env.opts(env.frame, NEXT));
  const first = env.document.getElementById("score-frame");
  assert.equal(first.getAttribute("data-score-attempts"), "1");
  assert.equal(env.pendingTimers(), 1);
  env.advance(4000);
  env.flush();
  const second = env.document.getElementById("score-frame");
  assert.notEqual(second, first);
  assert.equal(second.getAttribute("data-score-attempts"), "2");
  env.advance(4000);
  env.flush();
  const third = env.document.getElementById("score-frame");
  assert.notEqual(third, second);
  assert.equal(third.getAttribute("data-score-attempts"), "3");
  assert.equal(env.pendingTimers(), 0);
  const src = third.src;
  env.advance(4000);
  env.flush();
  env.api.attach(env.opts(third, NEXT));
  assert.equal(env.document.getElementById("score-frame"), third);
  assert.equal(third.src, src);
});

test("onload cancels the watchdog and a leftover ghost iframe is removed", () => {
  const env = loadAttach();
  const ghost = env.document.createElement("iframe");
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:0;opacity:0;";
  env.body.appendChild(ghost);
  env.api.attach(env.opts(env.frame, NEXT));
  assert.equal(ghost.parentNode, null);
  const live = env.document.getElementById("score-frame");
  live.onload();
  assert.equal(env.pendingTimers(), 0);
  env.advance(4000);
  env.flush();
  assert.equal(env.document.getElementById("score-frame"), live);
  assert.equal(live.getAttribute("data-current"), NEXT);
});

test("pro.html and mini.html cache-bust script and stylesheet URLs", () => {
  const pro = readFileSync(join(root, "renderer/pro.html"), "utf8");
  const mini = readFileSync(join(root, "renderer/mini.html"), "utf8");
  for (const src of [
    "../js/overlay-target.js?v=20261126",
    "overlay.css?v=20261126",
    "pro.css?v=20261126",
    "../config/runtime.js?v=20261126",
    "../js/storage.js?v=20261126",
    "../js/supabase-store.js?v=20261126",
    "../js/score-frame.js?v=20261126",
    "../js/layout.js?v=20261126",
    "../js/psd-grounds.js?v=20261126",
    "overlay.js?v=20261126"
  ]) {
    assert.ok(pro.includes(src), src);
  }
  assert.match(mini, /js\/overlay-target\.js\?v=20261126/);
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
