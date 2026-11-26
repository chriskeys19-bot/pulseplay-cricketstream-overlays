const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");

function loadPsd() {
  const context = { window: {}, Intl };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, "js/psd-grounds.js"), "utf8"), context, {
    filename: "js/psd-grounds.js"
  });
  return context.window.PulsePlayPsd;
}

const psd = loadPsd();
const MORNING = new Date("2026-11-26T19:30:00.000Z");
const AFTERNOON = new Date("2026-11-26T21:30:00.000Z");
const JUST_BEFORE_NOON = new Date("2026-11-26T19:59:00.000Z");
const NOON = new Date("2026-11-26T20:00:00.000Z");

test("Pacific noon is the AM/PM boundary", () => {
  assert.equal(psd.sessionOf(JUST_BEFORE_NOON, ""), "am");
  assert.equal(psd.sessionOf(NOON, ""), "pm");
  assert.equal(psd.sessionOf(AFTERNOON, "am"), "am");
  assert.equal(psd.sessionOf(MORNING, "pm"), "pm");
});

test("single-division PSD grounds keep one sponsor all day", () => {
  const allDay = {
    pms1: ["U9", "Dublin Kia"],
    pms2: ["U9", "Dublin Kia"],
    hpms: ["U11", "San Ramon Grizzlies"],
    stanfordu9: ["U11", "San Ramon Grizzlies"],
    "4leaf": ["U13", "Fremont Bank"],
    sycamore3: ["U15", "Discover San Ramon"],
    sycamore1: ["U15", "Discover San Ramon"]
  };
  for (const id of Object.keys(allDay)) {
    const am = psd.ageSponsor(id, MORNING, "");
    const pm = psd.ageSponsor(id, AFTERNOON, "");
    assert.equal(am.split, false, id);
    assert.equal(am.division, allDay[id][0], id);
    assert.equal(am.label, allDay[id][1], id);
    assert.equal(pm.assetId, am.assetId, id);
    assert.equal(pm.division, am.division, id);
  }
});

test("CTS West and Sycamore 2 switch sponsor at noon", () => {
  const westAm = psd.ageSponsor("ctsu11", MORNING, "");
  const westPm = psd.ageSponsor("ctsu11", AFTERNOON, "");
  assert.equal(westAm.split, true);
  assert.equal(westAm.division, "U13");
  assert.equal(westAm.label, "Fremont Bank");
  assert.equal(westPm.division, "U11");
  assert.equal(westPm.label, "San Ramon Grizzlies");
  assert.notEqual(westAm.assetId, westPm.assetId);

  const syAm = psd.ageSponsor("sycamore2", JUST_BEFORE_NOON, "");
  const syPm = psd.ageSponsor("sycamore2", NOON, "");
  assert.equal(syAm.split, true);
  assert.equal(syAm.division, "U15");
  assert.equal(syAm.label, "Discover San Ramon");
  assert.equal(syPm.division, "U13");
  assert.equal(syPm.label, "Fremont Bank");
});

test("only CTS West and Sycamore 2 are split grounds", () => {
  assert.equal(psd.isSplit({ id: "ctsu11", name: "CTS West" }), true);
  assert.equal(psd.isSplit("sycamore 2"), true);
  assert.equal(psd.isSplit({ id: "sycamore2", name: "sycamore2" }), true);
  assert.equal(psd.isSplit({ id: "stanfordu9", name: "StanfordU9" }), false);
  assert.equal(psd.isSplit({ id: "4leaf", name: "4leaf" }), false);
  assert.equal(psd.isSplit({ id: "hpms", name: "HPMS" }), false);
  assert.equal(psd.isSplit("cheetahs-home"), false);
});

test("the bottom-left sponsor is Discover San Ramon and other grounds are left alone", () => {
  const sponsor = psd.tournamentSponsor();
  assert.equal(sponsor.label, "Discover San Ramon");
  assert.equal(sponsor.assetId, psd.ageSponsor("sycamore3", MORNING, "").assetId);
  assert.equal(psd.isGround("cheetahs-home"), false);
  assert.equal(psd.ageSponsor("cheetahs-home", MORNING, ""), null);
  assert.equal(psd.ageSponsor("fspu15", MORNING, ""), null);
  assert.equal(psd.isGround("sycamore1"), true);
});
