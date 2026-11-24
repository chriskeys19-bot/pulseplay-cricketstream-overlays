const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const rules = require("../js/live-wall.js");
const youtube = require("../js/youtube-broadcasts.js");

const convert = youtube.zonedLocalToIso;
const START = "2026-11-26T16:30:00.000Z";

function row(partial) {
  return Object.assign({
    id: "psd-1",
    event: "PSD",
    date: "2026-11-26",
    start_local: "8:30 AM",
    timezone: "Pacific",
    ground: "Stanford",
    division: "U11",
    team1: "SRCA Spartans",
    team2: "Denver Dynamites",
    video_id: "M7lc1UVf-VE",
    status: null,
    scorecard_url: "https://example.com/scorecard"
  }, partial);
}

test("scheduled window is 15 minutes before start until 3.5 hours after", () => {
  const start = Date.parse(START);
  const inside = rules.selectLive([row()], start, {}, convert);
  assert.equal(inside.length, 1);
  assert.equal(rules.kindOf(row(), start - rules.LEAD_MS, "", convert), "window");
  assert.equal(rules.kindOf(row(), start - rules.LEAD_MS - 1000, "", convert), "idle");
  assert.equal(rules.kindOf(row(), start + rules.WINDOW_MS - 1, "", convert), "window");
  assert.equal(rules.kindOf(row(), start + rules.WINDOW_MS, "", convert), "idle");
});

test("explicit live stays up and ended never uses the window", () => {
  const late = Date.parse(START) + 10 * 60 * 60 * 1000;
  assert.equal(rules.kindOf(row({ status: "Live" }), late, "", convert), "explicit");
  assert.equal(rules.selectLive([row({ status: "ended" })], Date.parse(START), {}, convert).length, 0);
  assert.equal(rules.kindOf(row({ status: "live" }), Date.parse(START), "complete", convert), "ended");
  assert.equal(rules.kindOf(row({ status: "ended" }), Date.parse(START), "live", convert), "explicit");
  assert.equal(rules.kindOf(row({ status: "" }), Date.parse(START), "testing", convert), "explicit");
  assert.equal(rules.kindOf(row({ status: "failed" }), Date.parse(START), "", convert), "ended");
});

test("live ordering prefers explicit games, then earlier starts, and caps at 8", () => {
  const now = Date.parse(START);
  const rows = [];
  let i;
  for (i = 0; i < 9; i++) {
    rows.push(row({
      id: "w-" + i,
      ground: "Ground " + String.fromCharCode(90 - i),
      start_local: "8:30 AM",
      video_id: "vidvid" + i + "xx",
      status: null,
      start_iso: new Date(now - i * 60000).toISOString()
    }));
  }
  rows.push(row({
    id: "explicit-late",
    ground: "ZZ",
    status: "live",
    video_id: "explicit1",
    start_iso: new Date(now + 60 * 60000).toISOString()
  }));
  const live = rules.selectLive(rows, now, {}, convert);
  assert.equal(live.length, 8);
  assert.equal(live[0].id, "explicit-late");
  assert.equal(live[1].id, "w-8");
  assert.equal(live[live.length - 1].id, "w-2");
  assert.equal(rules.selectLive([row({ video_id: "" })], now, {}, convert).length, 0);
  assert.equal(rules.selectLive([row({ video_id: "nope" })], now, {}, convert).length, 0);
});

test("labels, watch urls, and video ids", () => {
  assert.equal(rules.tileLabel(row(), () => "PSD"), "PSD · SRCA Spartans vs Denver Dynamites · Stanford");
  assert.equal(rules.watchUrl("M7lc1UVf-VE"), "https://www.youtube.com/watch?v=M7lc1UVf-VE");
  assert.equal(rules.videoId({ video_id: "https://www.youtube.com/watch?v=_upXtKEUFbs" }), "_upXtKEUFbs");
  assert.equal(rules.videoId({ video_id: "-V1NIv884T0" }), "-V1NIv884T0");
  assert.equal(rules.scorecardUrl(row()), "https://example.com/scorecard");
  assert.equal(rules.scorecardUrl({ scorecard_url: "not a url" }), "");
  assert.equal(rules.STREAM_COLUMNS.indexOf("stream_key"), -1);
  assert.equal(rules.STREAM_COLUMNS.indexOf("overlay_url"), -1);
  assert.ok(rules.STREAM_COLUMNS.indexOf("video_id") > -1);
});

test("grid layout follows count and width", () => {
  assert.deepEqual(rules.gridLayout(1, 1400), { layout: "1", columns: 1, count: 1 });
  assert.deepEqual(rules.gridLayout(2, 1400), { layout: "2", columns: 2, count: 2 });
  assert.deepEqual(rules.gridLayout(3, 1400), { layout: "4", columns: 2, count: 3 });
  assert.deepEqual(rules.gridLayout(4, 1400), { layout: "4", columns: 2, count: 4 });
  assert.deepEqual(rules.gridLayout(5, 1400), { layout: "6", columns: 3, count: 5 });
  assert.deepEqual(rules.gridLayout(6, 1400), { layout: "6", columns: 3, count: 6 });
  assert.deepEqual(rules.gridLayout(7, 1400), { layout: "8", columns: 4, count: 7 });
  assert.deepEqual(rules.gridLayout(8, 1400), { layout: "8", columns: 4, count: 8 });
  assert.deepEqual(rules.gridLayout(9, 1400), { layout: "8", columns: 4, count: 8 });
  assert.deepEqual(rules.gridLayout(8, 900), { layout: "4", columns: 2, count: 8 });
  assert.deepEqual(rules.gridLayout(2, 800), { layout: "2", columns: 2, count: 2 });
  assert.deepEqual(rules.gridLayout(8, 400), { layout: "1", columns: 1, count: 8 });
  assert.deepEqual(rules.gridLayout(2, 699), { layout: "1", columns: 1, count: 2 });
  assert.deepEqual(rules.gridLayout(0, 1400), { layout: "1", columns: 1, count: 0 });
});

test("tile diff keeps playing ids and only replaces a changed video", () => {
  const diff = rules.diffTiles(
    [{ id: "a", videoId: "one" }, { id: "b", videoId: "two" }, { id: "c", videoId: "three" }],
    [{ id: "b", videoId: "two" }, { id: "c", videoId: "four" }, { id: "d", videoId: "five" }]
  );
  assert.deepEqual(diff.keep, ["b"]);
  assert.deepEqual(diff.replace, ["c"]);
  assert.deepEqual(diff.add, ["d"]);
  assert.deepEqual(diff.remove, ["a"]);
});

test("poll delay stays at or above 30 seconds and backs off", () => {
  assert.equal(rules.pollDelay(0, () => 0), 45000);
  assert.equal(rules.pollDelay(0, () => 1), 60000);
  assert.equal(rules.pollDelay(1, () => 0), 90000);
  assert.equal(rules.pollDelay(4, () => 0), rules.POLL_MAX_MS);
  assert.equal(rules.leaderPollDelay(0, true, () => 0), rules.SAFETY_POLL_MS);
  assert.equal(rules.leaderPollDelay(0, false, () => 0), 45000);
  assert.ok(rules.leaderPollDelay(2, true, () => 0) >= 30000);
  let attempt;
  for (attempt = 0; attempt <= 6; attempt++) {
    assert.ok(rules.pollDelay(attempt, () => 0.5) >= 30000);
  }
});

test("bursts collapse to the last change per stream", () => {
  let queued = null;
  let cancelled = 0;
  const burst = rules.createBurst(400, (fn) => {
    queued = fn;
    return queued;
  }, () => {
    cancelled += 1;
    queued = null;
  });
  const seen = [];
  burst.push({ id: "a", event: "UPDATE", row: { id: "a", n: 1 } }, (batch) => seen.push(batch));
  burst.push({ id: "a", event: "UPDATE", row: { id: "a", n: 2 } }, (batch) => seen.push(batch));
  burst.push({ id: "b", event: "DELETE", idKeep: true }, (batch) => seen.push(["final", batch]));
  assert.equal(cancelled, 2);
  assert.equal(typeof queued, "function");
  queued();
  assert.equal(seen.length, 1);
  const coalesced = rules.coalesceChanges(seen[0][1]);
  assert.equal(coalesced.length, 2);
  assert.equal(coalesced[0].row.n, 2);
  assert.equal(coalesced[1].event, "DELETE");
  const next = rules.applyChanges(
    [{ id: "a", n: 0 }, { id: "b", n: 1 }, { id: "c", n: 2 }],
    coalesced
  );
  assert.deepEqual(next.map((item) => item.id), ["a", "c"]);
  assert.equal(next[0].n, 2);
});

test("a realtime payload without a video id asks for a refetch", () => {
  const partial = rules.changeFromPayload({ eventType: "UPDATE", new: { id: "a", status: "live" }, old: { id: "a" } });
  assert.equal(partial.event, "REFETCH");
  const full = rules.changeFromPayload({ eventType: "UPDATE", new: { id: "a", video_id: "M7lc1UVf-VE", status: "live" } });
  assert.equal(full.event, "UPDATE");
  const removed = rules.changeFromPayload({ eventType: "DELETE", old: { id: "a" } });
  assert.equal(removed.event, "DELETE");
  const applied = rules.applyChanges([{ id: "a", video_id: "old" }], [full]);
  assert.equal(applied[0].status, "live");
});

test("only the visible leader polls or refreshes auth", () => {
  const leader = rules.createCoordinator("a");
  const follower = rules.createCoordinator("b");
  const hidden = rules.createCoordinator("c");
  const t = 1_000_000;
  follower.receive(leader.beat(t, true));
  leader.receive(follower.beat(t, true));
  leader.receive(hidden.beat(t, false));
  follower.receive(hidden.beat(t, false));
  hidden.receive(leader.beat(t, true));
  hidden.receive(follower.beat(t, true));
  assert.equal(leader.leader(t), "a");
  assert.equal(leader.shouldRefreshAuth(t, true), true);
  assert.equal(follower.shouldRefreshAuth(t, true), false);
  assert.equal(hidden.shouldRefreshAuth(t, false), false);
  assert.equal(leader.shouldPoll(t, true, false), true);
  assert.equal(follower.shouldPoll(t, true, false), false);
  assert.equal(leader.shouldPoll(t, true, true), false);
  assert.equal(leader.shouldSafetyPoll(t, true, true), true);
  assert.equal(follower.shouldSafetyPoll(t, true, true), false);
  assert.equal(hidden.shouldHoldRealtime(false), false);
  assert.equal(leader.shouldHoldRealtime(true), true);
  assert.equal(hidden.leader(t), "a");
  const later = t + rules.STALE_MS + 1;
  const only = rules.createCoordinator("b");
  only.beat(later, true);
  only.receive({ type: "beat", id: "a", t: t, visible: true });
  assert.equal(only.leader(later), "b");
  const bothHidden = rules.createCoordinator("a");
  bothHidden.beat(t, false);
  assert.equal(bothHidden.leader(t), "");
  assert.equal(bothHidden.shouldPoll(t, false, false), false);
});

test("the wall page stays muted and read-only, behind the existing admin", () => {
  const page = readFileSync(join(__dirname, "../js/live-wall-page.js"), "utf8");
  const html = readFileSync(join(__dirname, "../admin.html"), "utf8");
  const admin = readFileSync(join(__dirname, "../admin.js"), "utf8");
  const client = readFileSync(join(__dirname, "../js/pp-supabase.js"), "utf8");
  assert.doesNotMatch(page, /unMute/);
  assert.doesNotMatch(page, /setVolume\(\s*[1-9]/);
  assert.match(page, /\.mute\(/);
  assert.doesNotMatch(page, /\.insert\(|\.update\(|\.delete\(/);
  assert.match(page, /setPlaybackQuality/);
  assert.match(html, /id="tab-wall"/);
  assert.match(html, /id="panel-wall"/);
  assert.match(html, /js\/live-wall-page\.js/);
  assert.match(html, /js\/pp-supabase\.js/);
  assert.match(admin, /name !== "wall"/);
  assert.match(client, /if \(client\) return client/);
  assert.match(client, /localStorage/);
});
