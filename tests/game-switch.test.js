const assert = require("node:assert/strict");
const test = require("node:test");
const rules = require("../js/game-switch.js");

const MORNING = "https://overlay.cricclubs.com/AMCODE1/";
const AFTERNOON = "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=99&clubId=1";

function ground(extra) {
  return Object.assign({
    id: "ctsu11",
    name: "CTS West",
    score_url: MORNING,
    logos: { age_group_sponsor: "logo-u13", tournament: "logo-psd", cricketcraze: "logo-cc" },
    score_overlays: [
      { id: "am", name: "U13 AM", url: MORNING, active: true, full_size: false },
      { id: "pm", name: "U11 PM", url: AFTERNOON, active: false, full_size: true, logo_age_id: "logo-u11", youtube_broadcast_id: "pmVideoId123" }
    ]
  }, extra || {});
}

test("old score rows keep id, name, url, full_size, and active", () => {
  const list = rules.scoreList({
    id: "g",
    score_url: MORNING,
    score_overlays: [{ id: "only", name: "Game 1", url: MORNING, active: true, full_size: false }]
  });
  assert.deepEqual(list, [{ id: "only", name: "Game 1", url: MORNING, active: true, full_size: false }]);
  assert.equal(Object.prototype.hasOwnProperty.call(list[0], "logo_age_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(list[0], "youtube_broadcast_id"), false);
});

test("optional logo and broadcast id survive and a watch link becomes an id", () => {
  const list = rules.scoreList(ground({
    score_overlays: [
      { id: "am", name: "U13 AM", url: MORNING, active: true, youtube_broadcast_id: "https://www.youtube.com/watch?v=amVideoId123" },
      { id: "pm", name: "U11 PM", url: AFTERNOON, active: false, logo_age_id: "logo-u11", youtube_broadcast_id: "pmVideoId123", ignored: "nope" }
    ]
  }));
  assert.equal(list[0].youtube_broadcast_id, "amVideoId123");
  assert.equal(list[1].logo_age_id, "logo-u11");
  assert.equal(list[1].youtube_broadcast_id, "pmVideoId123");
  assert.equal(list[1].ignored, undefined);
});

test("the next ordered slot is the game after the active one", () => {
  const list = rules.scoreList(ground());
  assert.equal(rules.activeSlot(list).id, "am");
  assert.equal(rules.nextSlot(list).id, "pm");
  assert.equal(rules.nextSlot([list[1]]), null);
  assert.equal(rules.buttonLabel(list[0], list[1]), "End AM & Switch to PM");
  assert.equal(rules.buttonLabel({ name: "Game 1" }, { name: "Game 2" }), "Next Game");
});

test("switching copies the next score and the age logo when the slot has one", () => {
  const fields = rules.fieldsFor(ground(), "pm");
  assert.equal(fields.score_url, AFTERNOON);
  assert.equal(fields.score_overlays[0].active, false);
  assert.equal(fields.score_overlays[1].active, true);
  assert.equal(fields.score_overlays[1].full_size, true);
  assert.equal(fields.logos.age_group_sponsor, "logo-u11");
  assert.equal(fields.logos.tournament, "logo-psd");
  const sameLogo = rules.fieldsFor(ground(), "am");
  assert.equal(sameLogo.logos, undefined);
});

test("the plan ends the linked AM broadcast and starts the linked PM broadcast", () => {
  const list = rules.scoreList(ground({
    score_overlays: [
      { id: "am", name: "U13 AM", url: MORNING, active: true, youtube_broadcast_id: "amVideoId123" },
      { id: "pm", name: "U11 PM", url: AFTERNOON, active: false, logo_age_id: "logo-u11", youtube_broadcast_id: "pmVideoId123" }
    ]
  }));
  assert.deepEqual(rules.switchPlan(list[0], list[1], "otherLiveId1"), {
    endId: "amVideoId123",
    startId: "pmVideoId123"
  });
  const unlinked = rules.scoreList(ground());
  assert.deepEqual(rules.switchPlan(unlinked[0], unlinked[1], "liveVideo123"), {
    endId: "liveVideo123",
    startId: "pmVideoId123"
  });
  assert.match(rules.confirmText("CTS West", list[0], list[1], "San Ramon Grizzlies"), /San Ramon Grizzlies/);
  assert.match(rules.confirmText("CTS West", list[0], list[1], ""), /1\. End the linked AM/);
});

test("a broadcast that is not live can be skipped, and a dead connection can continue", () => {
  assert.equal(rules.endIsSkippable("This broadcast is not live yet, so it cannot be ended."), true);
  assert.equal(rules.endIsSkippable("This broadcast has already ended on YouTube."), true);
  assert.equal(rules.endIsSkippable("YouTube revoked this broadcast."), true);
  assert.equal(rules.endIsSkippable("YouTube did not respond. Try again."), false);
  assert.equal(rules.endCanContinue("YouTube is not connected yet."), true);
  assert.equal(rules.endCanContinue("Sign in on the live admin site to change a YouTube broadcast."), true);
  assert.equal(rules.endCanContinue("YouTube did not respond. Try again."), false);
});

test("a bad broadcast value is refused and a blank one clears the link", () => {
  const slot = { id: "pm", name: "PM", url: AFTERNOON, active: false, youtube_broadcast_id: "pmVideoId123", logo_age_id: "logo-u11" };
  const bad = rules.assignSlotMeta(slot, "logo-u11", "not a video");
  assert.equal(bad.ok, false);
  assert.equal(slot.youtube_broadcast_id, "pmVideoId123");
  const cleared = rules.assignSlotMeta(slot, "", "");
  assert.equal(cleared.ok, true);
  assert.equal(slot.youtube_broadcast_id, undefined);
  assert.equal(slot.logo_age_id, undefined);
});
