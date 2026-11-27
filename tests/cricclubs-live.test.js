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

function liveState(second, overs, extra) {
  return live.assess(Object.assign({
    ended: false,
    secondStarted: second,
    overs: overs,
    wickets: 2,
    total: second ? "40" : "80",
    maxOvers: second ? 20 : 20,
    revisedOvers: 0,
    code: second ? "CHB" : "SAC"
  }, extra || {}));
}

function expectWindow(label, maxOvers, soonOvers, breakOver, clearOver, hint) {
  [false, true].forEach((second) => {
    const innings = second ? "2nd" : "1st";
    const before = liveState(second, soonOvers - 0.5, { maxOvers: maxOvers, revisedOvers: 0 });
    const open = liveState(second, soonOvers, { maxOvers: maxOvers });
    const last = liveState(second, breakOver - 0.5, { maxOvers: maxOvers });
    const on = liveState(second, breakOver, { maxOvers: maxOvers });
    const onText = liveState(second, String(breakOver) + ".0", { maxOvers: maxOvers });
    const after = liveState(second, String(clearOver), { maxOvers: maxOvers });
    assert.equal(before.alert, "", label + " " + innings + " before the window");
    assert.equal(open.alert, "drinks-soon", label + " " + innings + " at " + soonOvers);
    assert.equal(open.phase, "drinks-soon");
    assert.equal(last.alert, "drinks-soon", label + " " + innings + " at " + (breakOver - 0.5));
    assert.equal(on.alert, "drinks", label + " " + innings + " at " + breakOver);
    assert.equal(on.phase, "drinks");
    assert.equal(onText.alert, "drinks", label + " " + innings + " at " + breakOver + ".0");
    assert.equal(after.alert, "", label + " " + innings + " clears at " + clearOver);
    assert.equal(after.phase, second ? "second" : "first");
    if (hint) {
      const hinted = live.assess({
        ended: false,
        secondStarted: second,
        overs: breakOver,
        wickets: 1,
        total: "22",
        code: "SAC"
      }, hint);
      assert.equal(hinted.alert, "drinks", label + " " + innings + " fallback at the mark");
      const hintedSoon = live.assess({
        ended: false,
        secondStarted: second,
        overs: soonOvers,
        wickets: 1,
        total: "22",
        code: "SAC"
      }, hint);
      assert.equal(hintedSoon.alert, "drinks-soon", label + " " + innings + " fallback approaching");
      const hintedClear = live.assess({
        ended: false,
        secondStarted: second,
        overs: String(clearOver),
        wickets: 1,
        total: "22",
        code: "SAC"
      }, hint);
      assert.equal(hintedClear.alert, "", label + " " + innings + " fallback clears");
    }
  });
}

test("U9 20-over games warn from 8.0, break at 10.0, and clear at 10.1 in both innings", () => {
  expectWindow("U9", 20, 8, 10, "10.1", { division: "U9" });
  assert.equal(liveState(false, "7.5", { maxOvers: 20 }).alert, "");
  assert.equal(liveState(false, "9.5", { maxOvers: 20 }).alert, "drinks-soon");
  assert.equal(liveState(true, "9.5", { maxOvers: 20 }).alert, "drinks-soon");
  assert.equal(liveState(false, 18, { maxOvers: 20 }).alert, "soon");
  assert.equal(liveState(false, 20, { maxOvers: 20 }).alert, "break");
  assert.equal(liveState(true, 18, { maxOvers: 20 }).alert, "");
  assert.equal(liveState(false, 10, { maxOvers: 20, wickets: 9 }).alert, "drinks");
  assert.equal(liveState(false, "8.2", { maxOvers: 20, wickets: 9 }).alert, "soon");
  assert.equal(liveState(false, 10, { maxOvers: 20, wickets: 10 }).alert, "break");
});

test("U11, U13, and U15 30-over games warn from 13.0, break at 15.0, and clear at 15.1 in both innings", () => {
  expectWindow("U11", 30, 13, 15, "15.1", { division: "U11" });
  expectWindow("U13", 30, 13, 15, "15.1", { overlayName: "U13 AM" });
  expectWindow("U15", 30, 13, 15, "15.1", { logo_age_id: "logo-1795110263439" });
  assert.equal(liveState(false, "12.5", { maxOvers: 30 }).alert, "");
  assert.equal(liveState(false, "14.5", { maxOvers: 30 }).alert, "drinks-soon");
  assert.equal(liveState(true, "14.5", { maxOvers: 30 }).alert, "drinks-soon");
  assert.equal(liveState(true, "15.0", { maxOvers: 30 }).alert, "drinks");
  assert.equal(liveState(true, "15.1", { maxOvers: 30 }).alert, "");
  assert.equal(liveState(false, 28, { maxOvers: 30 }).alert, "soon");
  assert.equal(liveState(false, 30, { maxOvers: 30 }).alert, "break");
  assert.equal(liveState(false, 15, { maxOvers: 30, inningsEnded: true }).alert, "break");
});

test("a missing maxOvers falls back to the overlay name, division, or age-group logo", () => {
  const u9Logo = live.groundHint(
    { logos: { age_group_sponsor: "logo-1795109375279" }, division: "" },
    { name: "Game 1", logo_age_id: "" }
  );
  assert.equal(live.divisionFromHint(u9Logo), "U9");
  assert.equal(live.drinksOver({ total: "10" }, u9Logo), 10);
  assert.equal(live.assess({
    ended: false, secondStarted: false, overs: "10.0", wickets: 1, total: "70", code: "SAC"
  }, u9Logo).alert, "drinks");
  assert.equal(live.divisionFromHint({ logoAgeId: "logo-1795110181170" }), "U11");
  assert.equal(live.divisionFromHint({ logo_age_id: "logo-u13" }), "U13");
  assert.equal(live.divisionFromHint({ overlayName: "Game 2 – U15 vs Y" }), "U15");
  assert.equal(live.divisionFromHint({ overlayName: "Game 1", division: "U13", logoAgeId: "logo-1795109375279" }), "U13");
  assert.equal(live.divisionFromHint({ overlayName: "stanfordu9" }), "");
  assert.equal(live.divisionFromHint("U17"), "");
  const noHint = live.assess({
    ended: false, secondStarted: true, overs: "15.0", wickets: 1, total: "40", code: "CHB"
  });
  assert.equal(noHint.alert, "");
  assert.equal(noHint.phase, "second");
  const payloadWins = live.assess({
    ended: false, secondStarted: false, overs: "10.0", wickets: 1, total: "60", maxOvers: 20, code: "SAC"
  }, { division: "U15", overlayName: "U15 PM" });
  assert.equal(payloadWins.alert, "drinks");
  const notFifteen = live.assess({
    ended: false, secondStarted: false, overs: "15.0", wickets: 1, total: "90", maxOvers: 20, code: "SAC"
  }, { division: "U15" });
  assert.equal(notFifteen.alert, "");
  const fromName = live.fromSse({
    viewId: 1,
    global: { isSecondInningsStarted: true, isMatchEnded: false, revisedOvers: 0 },
    scoreBar: { overs: "13.2", tWickets: "1", tTotal: "48" },
    teams: { t2: { code: "CHB" } }
  }, { overlayName: "U11 PM" });
  assert.equal(fromName.alert, "drinks-soon");
  assert.equal(fromName.phase, "drinks-soon");
  assert.equal(live.alertPresentation("drinks-soon").text, "Drinks Break Coming Up");
  assert.equal(live.alertPresentation("drinks").text, "DRINKS BREAK — Trigger Ads");
  assert.equal(live.alertPresentation("drinks").jump, true);
  assert.equal(live.alertPresentation("soon").text, "Mid-Innings Break Coming Up");
  assert.equal(live.alertPresentation("break").text, "INNINGS BREAK — Trigger Ads");
});

test("a CricClubs drinks graphic counts at the mark and clears on the next ball", () => {
  const sse = "event:score-update\ndata:" + JSON.stringify({
    viewId: 15,
    global: { isSecondInningsStarted: false, isMatchEnded: false, totalOvers: 20, revisedOvers: 0 },
    scoreBar: { overs: "9.5", tWickets: "2", tTotal: "61" },
    teams: { t1: { code: "SAC" } }
  }) + "\n\n";
  assert.equal(live.fromSse(live.parseSseScore(sse)).alert, "drinks");
  const cleared = live.fromSse({
    view: "drinksBreak",
    global: { isSecondInningsStarted: true, isMatchEnded: false, totalOvers: 30 },
    scoreBar: { overs: "15.1", tWickets: "3", tTotal: "102" },
    teams: { t2: { code: "CHB" } }
  });
  assert.equal(cleared.alert, "");
  assert.equal(cleared.phase, "second");
  const between = live.fromRest({
    data: {
      viewId: 15,
      values: {
        isSecondInningsStarted: true,
        isMatchEnded: 0,
        overs: "0",
        tWickets: "0",
        tTotal: "0",
        totalOvers: 20,
        t2Code: "CHB"
      }
    }
  });
  assert.equal(between.alert, "break");
  const done = live.assess({
    ended: true, secondStarted: true, overs: "10.0", wickets: 4, total: "80", maxOvers: 20, viewId: 15, code: "CHB"
  });
  assert.equal(done.alert, "");
  assert.equal(done.phase, "done");
  const earlyGraphic = live.assess({
    ended: false, secondStarted: false, overs: "5.2", wickets: 1, total: "30", maxOvers: 20, viewId: 15, code: "SAC"
  });
  assert.equal(earlyGraphic.alert, "");
  assert.equal(earlyGraphic.phase, "first");
});
