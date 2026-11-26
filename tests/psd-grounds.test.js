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

test("single-division PSD grounds keep one sponsor for both sessions", () => {
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
    const am = psd.ageSponsor(id, "am");
    const pm = psd.ageSponsor(id, "pm");
    assert.equal(am.split, false, id);
    assert.equal(am.division, allDay[id][0], id);
    assert.equal(am.label, allDay[id][1], id);
    assert.equal(pm.assetId, am.assetId, id);
    assert.equal(pm.division, am.division, id);
  }
});

test("CTS West and Sycamore 2 list a different afternoon division", () => {
  const westAm = psd.ageSponsor("ctsu11", "am");
  const westPm = psd.ageSponsor("ctsu11", "pm");
  assert.equal(westAm.split, true);
  assert.equal(westAm.division, "U13");
  assert.equal(westAm.label, "Fremont Bank");
  assert.equal(westPm.division, "U11");
  assert.equal(westPm.label, "San Ramon Grizzlies");
  assert.notEqual(westAm.assetId, westPm.assetId);

  const syAm = psd.ageSponsor("sycamore2", "am");
  const syPm = psd.ageSponsor("sycamore2", "pm");
  assert.equal(syAm.split, true);
  assert.equal(syAm.division, "U15");
  assert.equal(syAm.label, "Discover San Ramon");
  assert.equal(syPm.division, "U13");
  assert.equal(syPm.label, "Fremont Bank");
});

test("the on-air age logo is the saved sponsor, not the afternoon division", () => {
  const west = { id: "ctsu11", logos: { age_group_sponsor: "logo-1795110230649" } };
  assert.equal(psd.ageLogo(west), "logo-1795110230649");
  assert.notEqual(psd.ageLogo(west), psd.ageSponsor("ctsu11", "pm").assetId);

  const switched = { id: "sycamore2", logos: { age_group_sponsor: "logo-1795110181170" } };
  assert.equal(psd.ageLogo(switched), "logo-1795110181170");
  assert.notEqual(psd.ageLogo(switched), psd.ageSponsor("sycamore2", "am").assetId);
  assert.notEqual(psd.ageLogo(switched), psd.ageSponsor("sycamore2", "pm").assetId);

  assert.equal(psd.ageLogo({ id: "sycamore2", logos: { age_group_sponsor: "" } }), "");
  assert.equal(psd.ageLogo({ id: "sycamore2", logos: { age_group_sponsor: "  " } }), "");
  assert.equal(psd.ageLogo({ id: "ctsu11", logos: { age_group_sponsor: null } }), "");
  assert.equal(psd.ageLogo({ id: "ctsu11" }), "");
  assert.equal(psd.ageLogo({ id: "cheetahs-home", logos: { age_group_sponsor: "logo-age-group" } }), "logo-age-group");
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
  assert.equal(sponsor.assetId, psd.ageSponsor("sycamore3", "am").assetId);
  assert.equal(psd.isGround("cheetahs-home"), false);
  assert.equal(psd.ageSponsor("cheetahs-home", "am"), null);
  assert.equal(psd.ageSponsor("fspu15", "pm"), null);
  assert.equal(psd.isGround("sycamore1"), true);
});

test("the renderer and ground setup follow the saved age logo", () => {
  const overlay = readFileSync(join(root, "renderer/overlay.js"), "utf8");
  const admin = readFileSync(join(root, "admin.js"), "utf8");
  assert.match(overlay, /PulsePlayPsd\.ageLogo\(ground\)/);
  assert.doesNotMatch(overlay, /ageSponsor\(/);
  assert.doesNotMatch(overlay, /queryParam\("session"\)/);
  assert.match(overlay, /profile: psd \? "psd"/);
  assert.doesNotMatch(admin, /pick\.disabled = !!psdOn/);
  assert.doesNotMatch(admin, /not used for a PSD ground/);
  assert.doesNotMatch(admin, /switches at noon/);
  assert.match(admin, /does not switch at noon/);
  assert.match(admin, /ageSponsor\(id, "am"\)/);
  assert.match(admin, /ageSponsor\(id, "pm"\)/);
});
