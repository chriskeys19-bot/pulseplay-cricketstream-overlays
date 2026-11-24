const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");

function loadLayout() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, "js/layout.js"), "utf8"), context, {
    filename: "js/layout.js"
  });
  return context.window.PulsePlayLayout;
}

function box() {
  return { style: {} };
}

function place(device, layout, scales) {
  const nodes = {
    age: box(),
    tournament: box(),
    cricketcraze: box(),
    score: box()
  };
  loadLayout().place({
    device: device,
    layout: layout,
    scales: scales,
    age: nodes.age,
    tournament: nodes.tournament,
    cricketcraze: nodes.cricketcraze,
    score: nodes.score
  });
  return nodes;
}

test("Pro default pins the tournament logo to the top-right", () => {
  const logo = place("pro", null).tournament.style;
  assert.equal(logo.right, "40px");
  assert.equal(logo.top, "20px");
  assert.equal(logo.left, "auto");
  assert.equal(logo.bottom, "auto");
  assert.equal(logo.width, "180px");
  assert.equal(logo.height, "140px");
});

test("Mini default pins the tournament logo to the top-right", () => {
  const logo = place("mini", null).tournament.style;
  assert.equal(logo.right, "28px");
  assert.equal(logo.top, "18px");
  assert.equal(logo.left, "auto");
  assert.equal(logo.bottom, "auto");
  assert.equal(logo.width, "211px");
  assert.equal(logo.height, "164px");
});

test("a missing layout uses the same top-right defaults", () => {
  assert.deepEqual(place("pro").tournament.style, place("pro", null).tournament.style);
  assert.deepEqual(place("mini", undefined).tournament.style, place("mini", {}).tournament.style);
});

test("positive x moves the tournament logo right and positive y moves it down", () => {
  const pro = place("pro", { tournament: { x: 15, y: 12 } }).tournament.style;
  assert.equal(pro.right, "25px");
  assert.equal(pro.top, "32px");
  assert.equal(pro.width, "180px");
  assert.equal(pro.height, "140px");

  const mini = place("mini", { tournament: { x: 8, y: 4 } }).tournament.style;
  assert.equal(mini.right, "20px");
  assert.equal(mini.top, "22px");
  assert.equal(mini.width, "211px");
  assert.equal(mini.height, "164px");
});

test("negative nudges move the tournament logo left and up", () => {
  const logo = place("pro", { tournament: { x: -10, y: -6 } }).tournament.style;
  assert.equal(logo.right, "50px");
  assert.equal(logo.top, "14px");
});

test("tournament scale keeps the top-right corner and changes the box size", () => {
  const pro = place("pro", { tournament: { scale: 0.8 } }).tournament.style;
  assert.equal(pro.right, "40px");
  assert.equal(pro.top, "20px");
  assert.equal(pro.width, "144px");
  assert.equal(pro.height, "112px");

  const mini = place("mini", { tournament: { scale: 0.8, x: 0, y: 0 } }).tournament.style;
  assert.equal(mini.right, "28px");
  assert.equal(mini.top, "18px");
  assert.equal(mini.width, "169px");
  assert.equal(mini.height, "131px");

  const grown = place("pro", { tournament: { scale: 2, x: 5, y: -3 } }).tournament.style;
  assert.equal(grown.right, "35px");
  assert.equal(grown.top, "17px");
  assert.equal(grown.width, "360px");
  assert.equal(grown.height, "280px");
});

test("a logo's own scale multiplies the tournament slot scale", () => {
  const onlyLogo = place("pro", null, { tournament: 0.8 }).tournament.style;
  assert.equal(onlyLogo.right, "40px");
  assert.equal(onlyLogo.top, "20px");
  assert.equal(onlyLogo.width, "144px");
  assert.equal(onlyLogo.height, "112px");

  const both = place("mini", { tournament: { scale: 0.8, x: 6, y: 2 } }, { tournament: 0.8 }).tournament.style;
  assert.equal(both.right, "22px");
  assert.equal(both.top, "20px");
  assert.equal(both.width, "135px");
  assert.equal(both.height, "105px");
});

test("age and CricketCraze anchors stay top-left and bottom-right", () => {
  const pro = place("pro", {
    age: { x: 10, y: 5, scale: 0.5 },
    cricketcraze: { x: 10, y: 5, scale: 0.5 }
  });
  assert.equal(pro.age.style.left, "50px");
  assert.equal(pro.age.style.top, "25px");
  assert.equal(pro.age.style.right, "auto");
  assert.equal(pro.age.style.width, "84px");
  assert.equal(pro.age.style.height, "42px");
  assert.equal(pro.cricketcraze.style.right, "30px");
  assert.equal(pro.cricketcraze.style.bottom, "15px");
  assert.equal(pro.cricketcraze.style.top, "auto");
  assert.equal(pro.cricketcraze.style.left, "auto");
  assert.equal(pro.cricketcraze.style.width, "95px");
  assert.equal(pro.cricketcraze.style.height, "73px");
});

test("renderer CSS, the admin preview, and the docs use the top-right corner", () => {
  const pro = readFileSync(join(root, "renderer/pro.css"), "utf8");
  const mini = readFileSync(join(root, "renderer/mini.css"), "utf8");
  const overlay = readFileSync(join(root, "renderer/overlay.css"), "utf8");
  const adminCss = readFileSync(join(root, "admin.css"), "utf8");
  const adminHtml = readFileSync(join(root, "admin.html"), "utf8");
  const adminJs = readFileSync(join(root, "admin.js"), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");

  assert.match(pro, /\.logo-tournament \{ position: absolute; right: 40px; top: 20px; width: 180px; \}/);
  assert.match(mini, /\.logo-tournament \{ position: absolute; right: 28px; top: 18px; width: 211px; \}/);
  assert.match(overlay, /\.logo-tournament \{ object-position: right top; \}/);
  assert.match(adminCss, /\.layout-stage \.logo-tournament \{ object-position: right top; \}/);
  assert.match(adminHtml, /Top right · Tournament/);
  assert.match(adminJs, /Top right · Tournament/);
  assert.match(readme, /\| Top right \| Tournament logo \|/);
  for (const file of [pro, mini, overlay, adminCss, adminHtml, adminJs, readme]) {
    assert.doesNotMatch(file, /Bottom left|bottom-left|left bottom/);
  }
});
