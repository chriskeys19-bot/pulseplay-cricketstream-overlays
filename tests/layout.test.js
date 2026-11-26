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

function px(style, name) {
  return parseFloat(style[name]);
}

function scoreBox(style) {
  const left = px(style, "left");
  const width = px(style, "width");
  return {
    left,
    width,
    right: left + width,
    bottom: px(style, "bottom"),
    height: px(style, "height")
  };
}

function logoBox(style) {
  const width = px(style, "width");
  const rightInset = px(style, "right");
  const left = 1920 - rightInset - width;
  return { left, right: left + width, width, rightInset };
}

function assertClearsLogo(nodes, gap) {
  const score = scoreBox(nodes.score.style);
  const logo = logoBox(nodes.cricketcraze.style);
  assert.ok(score.left >= 16, `score left ${score.left} clips the frame`);
  assert.ok(score.right <= 1920, `score right ${score.right} leaves the frame`);
  assert.ok(logo.left - score.right >= gap, `gap ${logo.left - score.right}px is under ${gap}px`);
}

test("Pro default score sits 64px clear of CricketCrazeUSA", () => {
  const nodes = place("pro", null);
  const score = scoreBox(nodes.score.style);
  const logo = logoBox(nodes.cricketcraze.style);
  assert.equal(logo.left, 1690);
  assert.equal(score.left, 66);
  assert.equal(score.width, 1560);
  assert.equal(score.right, 1626);
  assert.equal(score.bottom, 28);
  assert.equal(score.height, 297);
  assert.equal(logo.left - score.right, 64);
  assert.equal(nodes.score.style.marginLeft, "0");
  assertClearsLogo(nodes, 64);
});

test("Mini default score is the widest bar that keeps the same gap", () => {
  const nodes = place("mini", null);
  const score = scoreBox(nodes.score.style);
  const logo = logoBox(nodes.cricketcraze.style);
  assert.equal(logo.left, 1672);
  assert.equal(score.left, 16);
  assert.equal(score.width, 1592);
  assert.equal(score.right, 1608);
  assert.equal(score.bottom, 20);
  assert.equal(score.height, 372);
  assert.equal(logo.left - score.right, 64);
  assertClearsLogo(nodes, 64);
});

test("live Pro ground scales and nudges stay clear of CricketCrazeUSA", () => {
  const grounds = [
    { name: "default", layout: null },
    { name: "scale 1.16", layout: { score: { scale: 1.16 } } },
    { name: "CTS West", layout: { score: { scale: 1.16, y: -10 } } },
    { name: "Sycamore 3", layout: { score: { scale: 1.25, x: -10 } } },
    { name: "4Leaf", layout: { score: { y: -60 }, cricketcraze: { x: 60, scale: 0.85 } } }
  ];
  for (const ground of grounds) {
    const nodes = place("pro", ground.layout);
    assertClearsLogo(nodes, 64);
  }

  const scaled = scoreBox(place("pro", { score: { scale: 1.16 } }).score.style);
  assert.equal(scaled.left, 16);
  assert.equal(scaled.width, 1610);
  assert.equal(scaled.right, 1626);
  assert.equal(scaled.height, 345);
  assert.equal(scaled.bottom, 28);

  const west = scoreBox(place("pro", { score: { scale: 1.16, y: -10 } }).score.style);
  assert.equal(west.bottom, 38);
  assert.equal(west.right, 1626);

  const sycamore = scoreBox(place("pro", { score: { scale: 1.25, x: -10 } }).score.style);
  assert.equal(sycamore.left, 16);
  assert.equal(sycamore.width, 1600);
  assert.equal(sycamore.right, 1616);
  assert.equal(sycamore.height, 371);
  assert.equal(sycamore.bottom, 28);

  const leaf = place("pro", { score: { y: -60 }, cricketcraze: { x: 60, scale: 0.85 } });
  const leafScore = scoreBox(leaf.score.style);
  const leafLogo = logoBox(leaf.cricketcraze.style);
  assert.equal(leafLogo.left, 1778);
  assert.equal(leafScore.right, 1626);
  assert.equal(leafScore.bottom, 88);
  assert.equal(leafLogo.left - leafScore.right, 152);
});

test("positive score x moves right and positive y moves down", () => {
  const base = scoreBox(place("pro", null).score.style);
  const nudged = scoreBox(place("pro", { score: { x: 24, y: 15 } }).score.style);
  assert.equal(nudged.left, base.left + 24);
  assert.equal(nudged.right, base.right + 24);
  assert.equal(nudged.width, base.width);
  assert.equal(nudged.bottom, base.bottom - 15);
  assert.equal(nudged.height, base.height);

  const mini = scoreBox(place("mini", null).score.style);
  const miniNudged = scoreBox(place("mini", { score: { x: 20, y: 8 } }).score.style);
  assert.equal(miniNudged.left, mini.left + 20);
  assert.equal(miniNudged.right, mini.right + 20);
  assert.equal(miniNudged.bottom, mini.bottom - 8);
});

test("a score scale that would leave the frame stops at the left margin and keeps the gap", () => {
  const capped = scoreBox(place("pro", { score: { scale: 2 } }).score.style);
  assert.equal(capped.left, 16);
  assert.equal(capped.right, 1626);
  assert.equal(capped.width, 1610);
  assert.equal(capped.height, 594);
  assert.equal(1690 - capped.right, 64);

  const shoved = scoreBox(place("pro", { score: { x: -80 } }).score.style);
  assert.equal(shoved.left, 16);
  assert.equal(shoved.right, 1546);
  assert.ok(shoved.right <= 1690 - 64);
});

test("a larger CricketCrazeUSA logo pulls the score left enough to keep the gap", () => {
  const nodes = place("pro", { cricketcraze: { scale: 1.5 } });
  const score = scoreBox(nodes.score.style);
  const logo = logoBox(nodes.cricketcraze.style);
  assert.equal(logo.left, 1595);
  assert.equal(score.right, 1531);
  assert.equal(score.left, 16);
  assert.equal(logo.left - score.right, 64);
});

function stageRect(style) {
  const width = px(style, "width");
  const height = px(style, "height");
  const left = style.left != null && style.left !== "auto" ? px(style, "left") : 1920 - px(style, "right") - width;
  const top = style.top != null && style.top !== "auto" ? px(style, "top") : 1080 - px(style, "bottom") - height;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function placePsd(layout, scales) {
  const nodes = {
    age: box(),
    tournament: box(),
    sponsor: box(),
    cricketcraze: box(),
    score: box(),
    ticker: box()
  };
  loadLayout().place({
    device: "pro",
    profile: "psd",
    layout: layout,
    scales: scales,
    age: nodes.age,
    tournament: nodes.tournament,
    sponsor: nodes.sponsor,
    cricketcraze: nodes.cricketcraze,
    score: nodes.score,
    ticker: nodes.ticker
  });
  return nodes;
}

test("PSD tournament matches the age logo and the sponsor matches CricketCrazeUSA", () => {
  const nodes = placePsd(null);
  const age = stageRect(nodes.age.style);
  const tournament = stageRect(nodes.tournament.style);
  const sponsor = stageRect(nodes.sponsor.style);
  const ccusa = stageRect(nodes.cricketcraze.style);
  assert.equal(tournament.top, age.top);
  assert.equal(tournament.width, age.width);
  assert.equal(tournament.height, age.height);
  assert.equal(tournament.right, 1920 - age.left);
  assert.equal(sponsor.bottom, ccusa.bottom);
  assert.equal(sponsor.width, ccusa.width);
  assert.equal(sponsor.height, ccusa.height);
  assert.equal(sponsor.left, 1920 - ccusa.right);
  assert.equal(age.left, 40);
  assert.equal(age.top, 20);
  assert.equal(age.width, 168);
  assert.equal(age.height, 84);
  assert.equal(sponsor.left, 40);
  assert.equal(1080 - sponsor.bottom, 20);
  assert.equal(1080 - ccusa.bottom, 20);
  assert.equal(ccusa.right, 1880);
});

test("a scaled PSD age logo keeps the tournament lined up with it", () => {
  const nodes = placePsd({ age: { scale: 1.1, x: 0, y: 4 } }, { age: 1 });
  const age = stageRect(nodes.age.style);
  const tournament = stageRect(nodes.tournament.style);
  assert.equal(age.width, 185);
  assert.equal(age.height, 92);
  assert.equal(age.top, 24);
  assert.equal(tournament.width, age.width);
  assert.equal(tournament.height, age.height);
  assert.equal(tournament.top, age.top);
  assert.equal(tournament.right, 1920 - age.left);
});

test("PSD score stays 64px clear of both bottom logos on the live ground layouts", () => {
  const grounds = [
    { name: "PMS-1", layout: { age: { scale: 1.1 }, score: { scale: 1.16 } } },
    { name: "CTS West", layout: { score: { scale: 1.16, y: -10 } } },
    { name: "Sycamore 2", layout: { age: { scale: 1.1 }, score: { scale: 1.16 } } },
    { name: "Sycamore 3", layout: { age: { scale: 1.1 }, score: { scale: 1.25, x: -10 } } },
    { name: "4Leaf", layout: { age: { scale: 0.9 }, score: { y: -60 }, cricketcraze: { x: 60, scale: 0.85 } } },
    { name: "HPMS", layout: { age: { scale: 1.1 }, score: { scale: 1.16 } } },
    { name: "Stanford", layout: null }
  ];
  for (const ground of grounds) {
    const nodes = placePsd(ground.layout);
    const score = stageRect(nodes.score.style);
    const sponsor = stageRect(nodes.sponsor.style);
    const ccusa = stageRect(nodes.cricketcraze.style);
    const age = stageRect(nodes.age.style);
    const tournament = stageRect(nodes.tournament.style);
    assert.ok(score.left >= 0 && score.right <= 1920, ground.name + " score leaves the stage");
    assert.ok(score.top >= 0 && score.bottom <= 1080, ground.name + " score leaves the stage vertically");
    assert.ok(!overlaps(score, sponsor), ground.name + " score hits the tournament sponsor");
    assert.ok(!overlaps(score, ccusa), ground.name + " score hits CricketCrazeUSA");
    assert.ok(!overlaps(age, tournament), ground.name + " top logos collide");
    assert.ok(!overlaps(sponsor, ccusa), ground.name + " bottom logos collide");
    assert.ok(score.left - sponsor.right >= 64, ground.name + " sponsor gap " + (score.left - sponsor.right));
    assert.ok(ccusa.left - score.right >= 64, ground.name + " ccusa gap " + (ccusa.left - score.right));
    assert.equal(nodes.ticker.style.left, nodes.score.style.left);
    assert.equal(nodes.ticker.style.width, nodes.score.style.width);
  }
});

test("a non-PSD ground keeps the previous tournament size and score bar", () => {
  const nodes = place("pro", { age: { scale: 1.1 }, score: { scale: 1.16 } });
  assert.equal(nodes.tournament.style.width, "180px");
  assert.equal(nodes.tournament.style.height, "140px");
  assert.equal(nodes.tournament.style.right, "40px");
  assert.equal(nodes.tournament.style.top, "20px");
  const score = scoreBox(nodes.score.style);
  assert.equal(score.left, 16);
  assert.equal(score.right, 1626);
  assert.equal(score.width, 1610);
});

test("the subscribe ticker matches the score bar and stays on the stage", () => {
  const layout = loadLayout();
  const nodes = {
    age: box(),
    tournament: box(),
    cricketcraze: box(),
    score: box(),
    ticker: box()
  };
  layout.place({
    device: "pro",
    layout: { score: { scale: 1.16, x: 0, y: 0 } },
    age: nodes.age,
    tournament: nodes.tournament,
    cricketcraze: nodes.cricketcraze,
    score: nodes.score,
    ticker: nodes.ticker
  });
  assert.equal(nodes.ticker.style.left, nodes.score.style.left);
  assert.equal(nodes.ticker.style.width, nodes.score.style.width);
  assert.equal(nodes.ticker.style.right, "auto");
  assert.equal(nodes.ticker.style.left, "16px");
  assert.equal(nodes.ticker.style.width, "1610px");

  const score = scoreBox(nodes.score.style);
  assert.equal(layout.tickerBottom(score.bottom, score.height, 1, 48), score.bottom + score.height + 10);
  assert.equal(layout.tickerBottom(28, 297, 2.15, 48), 677);
  assert.equal(layout.tickerBottom(20, 465, 2.15, 68), 1012);
  assert.ok(layout.tickerBottom(20, 465, 2.15, 68) + 68 <= 1080);
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
  assert.match(pro, /\.logo-sponsor \{ position: absolute; left: 40px; bottom: 20px; width: 190px; \}/);
  assert.match(mini, /\.logo-sponsor \{ position: absolute; left: 28px; bottom: 13px; width: 220px; \}/);
  assert.match(overlay, /\.logo-sponsor \{ object-position: left bottom; \}/);
  assert.match(adminCss, /\.layout-stage \.logo-sponsor \{ object-position: left bottom; \}/);
  assert.doesNotMatch(pro, /\.logo-tournament[^{]*\{[^}]*bottom/);
  assert.doesNotMatch(mini, /\.logo-tournament[^{]*\{[^}]*bottom/);
});

test("Pro and Mini CSS, the admin preview, and the README use the shifted score bar", () => {
  const pro = readFileSync(join(root, "renderer/pro.css"), "utf8");
  const mini = readFileSync(join(root, "renderer/mini.css"), "utf8");
  const overlay = readFileSync(join(root, "renderer/overlay.css"), "utf8");
  const adminCss = readFileSync(join(root, "admin.css"), "utf8");
  const adminJs = readFileSync(join(root, "admin.js"), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");

  assert.match(pro, /#score-slot \{\s*left: 66px;\s*bottom: 28px;\s*width: 1560px;\s*height: 297px;\s*\}/);
  assert.match(pro, /#subscribe-ticker \{\s*left: 66px;\s*right: auto;\s*width: 1560px;\s*\}/);
  assert.match(mini, /#score-slot \{\s*left: 16px;\s*bottom: 20px;\s*width: 1592px;\s*height: 372px;\s*\}/);
  assert.match(mini, /#subscribe-ticker \{\s*left: 16px;\s*right: auto;\s*width: 1592px;/);
  assert.match(overlay, /#subscribe-ticker \{\s*position: absolute;\s*left: 66px;\s*right: auto;\s*width: 1560px;/);
  assert.match(adminCss, /\.layout-score \{\s*position: absolute;\s*left: 66px;\s*bottom: 28px;\s*width: 1560px;\s*height: 297px;/);
  assert.match(adminCss, /\.layout-ticker \{\s*position: absolute;\s*left: 66px;\s*right: auto;\s*width: 1560px;/);
  assert.match(adminJs, /Bottom · Score/);
  assert.match(adminJs, /alignTicker/);
  assert.match(readme, /left 66px \(right edge 1626px\)/);
  assert.match(readme, /1592×372 at left 16px \(right edge 1608px\)/);
  for (const file of [pro, mini, overlay, adminCss]) {
    assert.doesNotMatch(file, /margin-left:\s*-780px|margin-left:\s*-867px|left:\s*50%/);
  }
});
