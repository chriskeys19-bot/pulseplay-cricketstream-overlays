const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const rules = require("../js/youtube-broadcasts.js");

const ROW = {
  id: "abcdefghijk",
  title: "PSD U13 vs Hawks",
  scheduledStart: "2026-11-26T18:00:00.000Z",
  actualStart: null,
  actualEnd: null,
  lifeCycle: "ready",
  streamKeyName: "PSD-3",
  watchUrl: "https://www.youtube.com/watch?v=abcdefghijk"
};

test("start more than 15 minutes early names the game, both times, and the stream key", () => {
  const now = Date.parse("2026-11-26T17:00:00.000Z");
  assert.equal(rules.startNeedsConfirm(ROW.scheduledStart, now), true);
  const copy = rules.startConfirmCopy(ROW);
  assert.match(copy.body, /PSD U13 vs Hawks/);
  assert.match(copy.body, /Stream key: PSD-3/);
  assert.match(copy.body, /Central/);
  assert.match(copy.body, /P[DS]T|Pacific|PT/);
  assert.equal(rules.startNeedsConfirm(ROW.scheduledStart, Date.parse("2026-11-26T17:50:00.000Z")), false);
});

test("end always names the game", () => {
  assert.match(rules.endConfirmCopy(ROW).body, /End PSD U13 vs Hawks/);
});

test("today and upcoming hides ended rows and groups by the Pacific day", () => {
  const now = Date.parse("2026-11-26T16:00:00.000Z");
  const ended = Object.assign({}, ROW, { id: "endedended1", lifeCycle: "complete", actualEnd: "2026-11-20T18:00:00.000Z" });
  const groups = rules.groupBroadcasts([ROW, ended], "upcoming", now);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].rows[0].id, ROW.id);
  const pacific = rules.zonedClock(ROW.scheduledStart, rules.PACIFIC);
  assert.equal(groups[0].dayKey, pacific.dayKey);
});

test("privacy and terms pages are public and name the YouTube use", () => {
  const privacy = readFileSync(join(__dirname, "../privacy.html"), "utf8");
  const terms = readFileSync(join(__dirname, "../terms.html"), "utf8");
  for (const file of [privacy, terms]) {
    assert.match(file, /CricketCrazeUSA/);
    assert.match(file, /cricketcrazeusa@gmail\.com/);
    assert.match(file, /https:\/\/myaccount\.google\.com\/permissions/);
    assert.match(file, /does not sell/);
    assert.match(file, /server/);
    assert.match(file, /live broadcast list/);
    assert.match(file, /privacy\.html/);
    assert.match(file, /terms\.html/);
    assert.doesNotMatch(file, /noindex/);
  }
  assert.match(privacy, /start and end live broadcasts/);
  assert.match(terms, /start and end live broadcasts/);
});
