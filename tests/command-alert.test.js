const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");
const OVERLAY = "https://overlay.cricclubs.com/H8J3AC/";

function tokens(el) {
  return String(el.className || "").split(/\s+/).filter(Boolean);
}

function makeEl(tag) {
  const el = {
    nodeType: 1,
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    textContent: "",
    type: "",
    children: [],
    attrs: {},
    style: {}
  };
  el.classList = {
    contains(name) { return tokens(el).indexOf(name) !== -1; },
    add(name) {
      const list = tokens(el);
      if (list.indexOf(name) === -1) list.push(name);
      el.className = list.join(" ");
    },
    remove(name) {
      el.className = tokens(el).filter((item) => item !== name).join(" ");
    }
  };
  el.appendChild = function (child) {
    el.children.push(child);
    return child;
  };
  el.removeChild = function (child) {
    el.children = el.children.filter((item) => item !== child);
  };
  Object.defineProperty(el, "firstChild", {
    get() { return el.children[0] || null; }
  });
  el.setAttribute = function (key, value) { el.attrs[key] = String(value); };
  el.getAttribute = function (key) {
    return Object.prototype.hasOwnProperty.call(el.attrs, key) ? el.attrs[key] : null;
  };
  el.removeAttribute = function (key) { delete el.attrs[key]; };
  el.getElementsByClassName = function (name) {
    const found = [];
    walk(el, found, (node) => tokens(node).indexOf(name) !== -1);
    return found;
  };
  el.getElementsByTagName = function (name) {
    const found = [];
    const wanted = String(name).toUpperCase();
    walk(el, found, (node) => node.tagName === wanted);
    return found;
  };
  return el;
}

function walk(el, found, match) {
  (el.children || []).forEach((child) => {
    if (child.nodeType === 1 && match(child)) found.push(child);
    if (child.children) walk(child, found, match);
  });
}

function textOf(el) {
  if (!el.children || !el.children.length) return el.textContent || "";
  return el.children.map((child) => (child.nodeType === 3 ? child.textContent : textOf(child))).join("");
}

function load() {
  const body = makeEl("body");
  const focused = [];
  const document = {
    body: body,
    visibilityState: "visible",
    addEventListener() {},
    createElement: makeEl,
    createTextNode(text) { return { nodeType: 3, textContent: String(text), children: [] }; },
    getElementById() { return null; },
    getElementsByClassName(name) { return body.getElementsByClassName(name); }
  };
  const ground = {
    id: "pms1",
    name: "PMS 1",
    score_url: OVERLAY,
    division: "U9",
    logos: { age_group_sponsor: "logo-1795109375279" },
    score_overlays: [
      { id: "am", name: "U9 AM", url: OVERLAY, active: true, logo_age_id: "logo-1795109375279" }
    ]
  };
  const card = makeEl("article");
  card.className = "card";
  card.setAttribute("data-id", ground.id);
  const line = makeEl("p");
  line.className = "card__scoreline";
  const alert = makeEl("p");
  alert.className = "card__alert is-off";
  card.appendChild(line);
  card.appendChild(alert);
  body.appendChild(card);
  const context = {
    window: {
      PulsePlayAdmin: {
        grounds() { return [ground]; },
        focusAds(id) { focused.push(id); }
      },
      PulsePlayGameSwitch: require("../js/game-switch.js")
    },
    document: document,
    URL: URL,
    console: console,
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout() { return 0; },
    clearTimeout() {}
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, "js/cricclubs-live.js"), "utf8"), context, { filename: "js/cricclubs-live.js" });
  vm.runInContext(readFileSync(join(root, "js/command-monitor.js"), "utf8"), context, { filename: "js/command-monitor.js" });
  return { context, card, alert, line, focused, live: context.window.PulsePlayCricClubs, command: context.window.PulsePlayCommand };
}

test("Command Center shows the drinks banners and jumps to that ground's ads", () => {
  const env = load();
  const soon = env.live.assess({
    ended: false, secondStarted: false, overs: "8.4", wickets: 1, total: "46", maxOvers: 20, code: "DKI"
  });
  env.command.rememberScore("pms1", soon);
  assert.equal(env.alert.className, "card__alert card__alert--drinks-soon");
  assert.equal(textOf(env.alert), "Drinks Break Coming Up");
  assert.equal(env.card.classList.contains("card--drinks"), false);
  assert.match(env.line.textContent, /DKI 46\/1 \(8\.4\)/);

  const active = env.live.assess({
    ended: false, secondStarted: true, overs: "10.0", wickets: 2, total: "71", maxOvers: 20, code: "DKI"
  });
  env.command.rememberScore("pms1", active);
  assert.equal(env.alert.className, "card__alert card__alert--drinks");
  assert.equal(env.card.classList.contains("card--drinks"), true);
  assert.match(textOf(env.alert), /DRINKS BREAK — Trigger Ads/);
  const button = env.alert.getElementsByTagName("button")[0];
  assert.equal(button.textContent, "Trigger ads");
  button.onclick({ stopPropagation() {} });
  assert.deepEqual(env.focused, ["pms1"]);

  const cleared = env.live.assess({
    ended: false, secondStarted: true, overs: "10.1", wickets: 2, total: "75", maxOvers: 20, code: "DKI"
  });
  env.command.rememberScore("pms1", cleared);
  assert.equal(env.alert.className, "card__alert is-off");
  assert.equal(textOf(env.alert), "");
  assert.equal(env.card.classList.contains("card--drinks"), false);
  assert.match(env.line.textContent, /2nd innings/);
});

test("the innings break still owns the card once the first innings ends", () => {
  const env = load();
  const soon = env.live.assess({
    ended: false, secondStarted: false, overs: "18.2", wickets: 4, total: "121", maxOvers: 20, code: "SAC"
  });
  env.command.rememberScore("pms1", soon);
  assert.equal(env.alert.className, "card__alert card__alert--soon");
  assert.equal(textOf(env.alert), "Mid-Innings Break Coming Up");

  const between = env.live.assess({
    ended: false, secondStarted: true, overs: 0, wickets: 0, total: "0", maxOvers: 20, code: "CHB"
  });
  env.command.rememberScore("pms1", between);
  assert.equal(env.alert.className, "card__alert card__alert--break");
  assert.equal(env.card.classList.contains("card--break"), true);
  assert.equal(env.card.classList.contains("card--drinks"), false);
  assert.match(textOf(env.alert), /INNINGS BREAK — Trigger Ads/);
});
