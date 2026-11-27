const assert = require("node:assert/strict");
const test = require("node:test");
const live = require("../js/cricclubs-live.js");

const OVERLAY = "https://overlay.cricclubs.com/H8J3AC/";
const STATIC = "https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=1435&clubId=846#bar";

test("overlay codes and static match ids are recognized", () => {
  assert.equal(live.overlayCode(OVERLAY), "H8J3AC");
  assert.equal(live.overlayCode("https://overlay.cricclubs.com/scoreView/"), "");
  assert.deepEqual(live.staticMatch(STATIC), { clubId: "846", matchId: "1435" });
  assert.equal(live.sourceFromUrl("https://cricclubs.com/"), null);
  assert.equal(live.sourceFromUrl(OVERLAY).kind, "sse");
  assert.equal(live.sseUrl("H8J3AC"), "https://overlay-ssc.cricclubs.com/overlay/client-sse/events/H8J3AC/v2/");
  assert.match(live.restUrl("846", "1435"), /clubId=846&matchId=1435/);
});

function firstInnings(overs, wickets, extra) {
  return live.assess(Object.assign({
    ended: false,
    secondStarted: false,
    overs: overs,
    wickets: wickets,
    total: "80",
    maxOvers: 20,
    revisedOvers: 0,
    code: "SAC"
  }, extra || {}));
}

test("the first innings warns inside two overs and at nine wickets", () => {
  assert.equal(firstInnings(17.5, 2).alert, "");
  assert.equal(firstInnings(17.5, 2).phase, "first");
  assert.equal(firstInnings(18, 3).alert, "soon");
  assert.equal(firstInnings(19.5, 4).phase, "soon");
  assert.equal(firstInnings(5, 9).alert, "soon");
  assert.equal(firstInnings(19, 4).score, "SAC 80/4 (19.0)");
});

test("a finished first innings is the innings break, including a reduced over limit", () => {
  assert.equal(firstInnings(20, 6).alert, "break");
  assert.equal(firstInnings(8, 10).phase, "break");
  assert.equal(firstInnings(13, 2, { revisedOvers: 15, maxOvers: 20 }).alert, "soon");
  assert.equal(firstInnings(15, 4, { revisedOvers: 15 }).alert, "break");
  assert.equal(firstInnings(4, 1, { inningsEnded: true }).alert, "break");
});

test("second innings, a completed match, and a match that has not started stay quiet", () => {
  const second = live.assess({
    ended: false,
    secondStarted: true,
    overs: 3.2,
    wickets: 1,
    total: "22",
    maxOvers: 20,
    code: "CHB"
  });
  assert.equal(second.alert, "");
  assert.equal(second.phase, "second");
  assert.equal(second.detail, "2nd innings");
  const between = live.assess({
    ended: false,
    secondStarted: true,
    overs: 0,
    wickets: 0,
    total: "0",
    maxOvers: 20,
    code: "CHB"
  });
  assert.equal(between.alert, "break");
  const done = live.assess({ ended: "1", secondStarted: true, overs: 19, wickets: 5, total: "189", maxOvers: 20, code: "ULN" });
  assert.equal(done.phase, "done");
  assert.equal(done.alert, "");
  const pre = live.assess({ ended: false, secondStarted: false, overs: 0, wickets: 0, total: "0", maxOvers: 20, code: "SAC" });
  assert.equal(pre.phase, "pre");
  assert.equal(pre.alert, "");
  assert.equal(pre.detail, "Yet to start");
});

test("a score-update event and a liveScoreOverlayData body become the same readout", () => {
  const sse = "event:score-update\ndata:" + JSON.stringify({
    global: { isSecondInningsStarted: false, isMatchEnded: false, totalOvers: 20, revisedOvers: 0 },
    scoreBar: { overs: "18.4", tWickets: "3", tTotal: "141" },
    teams: { t1: { code: "SAC", name: "StrongArm" } }
  }) + "\n\n";
  const fromSse = live.fromSse(live.parseSseScore(sse));
  assert.equal(fromSse.alert, "soon");
  assert.equal(fromSse.score, "SAC 141/3 (18.4)");
  const fromRest = live.fromRest({
    data: {
      values: {
        isSecondInningsStarted: "true",
        isMatchEnded: 0,
        overs: "6.1",
        tWickets: "1",
        tTotal: "48",
        totalOvers: 20,
        t2Code: "CHB"
      }
    },
    responseState: true
  });
  assert.equal(fromRest.phase, "second");
  assert.equal(fromRest.score, "CHB 48/1 (6.1)");
  assert.equal(live.fromRest({ data: {} }), null);
  assert.equal(live.parseSseScore("event:view-change\ndata:{}\n"), null);
});
