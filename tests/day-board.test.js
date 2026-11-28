const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const board = require("../js/day-board.js");
const health = require("../js/stream-health.js");
const youtube = require("../js/youtube-broadcasts.js");
const scope = require("../js/scope.js");
const wall = require("../js/live-wall.js");

const NOW = Date.parse("2026-11-27T23:46:00.000Z");
const PM_START = Date.parse("2026-11-27T21:30:00.000Z");

function row(partial) {
  return Object.assign({
    id: "game",
    event: "PSD",
    date: "2026-11-27",
    start_local: "1:30 PM",
    timezone: "Pacific",
    ground: "Stanford",
    division: "U11",
    team1: "CFC Raptors",
    team2: "Denver Dynamites",
    video_id: "Ik5C76xsVR0",
    status: null
  }, partial);
}

function liveHealth(id, tone) {
  if (tone === "bad") {
    return {
      id: id,
      lifeCycle: "live",
      boundStreamId: "s",
      streamStatus: "inactive",
      healthStatus: "noData",
      issues: [{ severity: "error", description: "YouTube is not receiving data." }]
    };
  }
  return {
    id: id,
    lifeCycle: "live",
    boundStreamId: "s",
    streamStatus: "active",
    healthStatus: "good",
    issues: []
  };
}

function build(partial) {
  return board.buildBoard(Object.assign({
    now: NOW,
    dayKey: "2026-11-27",
    convert: youtube.zonedLocalToIso,
    clock: youtube.zonedClock,
    classifyHealth: health.classifyStreamHealth,
    groundMatches: scope.groundMatches
  }, partial));
}

function ids(list) {
  return list.map((item) => item.id);
}

test("today defaults to the America/Chicago calendar day", () => {
  assert.equal(board.EXPECTED_MS, wall.WINDOW_MS);
  assert.equal(board.chicagoDayKey(NOW), "2026-11-27");
  assert.equal(board.chicagoDayKey("2026-11-28T05:30:00.000Z"), "2026-11-27");
  assert.equal(board.chicagoDayKey("2026-11-28T06:30:00.000Z"), "2026-11-28");
  assert.equal(board.shiftDay("2026-11-27", -1), "2026-11-26");
  assert.equal(board.shiftDay("2026-11-27", 1), "2026-11-28");
  assert.equal(board.shiftDay("2026-11-30", 1), "2026-12-01");
  assert.match(board.dayHeading("2026-11-27"), /Nov/);
  assert.match(board.dayHeading("2026-11-27"), /27/);
});

test("a healthy live broadcast is Live and a stalled one is Stuck", () => {
  const result = build({
    streams: [
      row({ id: "healthy", video_id: "healthyVid", status: "live" }),
      row({ id: "stalled", video_id: "stalledVid", ground: "CTS West", division: "U13", team1: "CCA Tornados", team2: "CKCA All Stars", status: "live" })
    ],
    grounds: [
      { id: "stanfordu9", name: "StanfordU9" },
      { id: "ctsu11", name: "CTS West" }
    ],
    healthById: {
      healthyVid: liveHealth("healthyVid", "good"),
      stalledVid: liveHealth("stalledVid", "bad")
    }
  });
  assert.deepEqual(ids(result.sections.live), ["healthy"]);
  assert.equal(result.sections.live[0].badge, "Live");
  assert.equal(result.sections.live[0].tone, "good");
  assert.equal(result.sections.live[0].division, "U11");
  assert.equal(result.sections.live[0].teams, "CFC Raptors vs Denver Dynamites");
  assert.equal(result.sections.live[0].watchUrl, "https://www.youtube.com/watch?v=healthyVid");
  assert.match(result.sections.live[0].startLabel, /1:30 PM/);
  assert.match(result.sections.live[0].startLabel, /3:30 PM/);
  assert.deepEqual(ids(result.sections.stuck), ["stalled"]);
  assert.equal(result.sections.stuck[0].badge, "NO DATA");
  assert.equal(result.sections.stuck[0].tone, "bad");
  assert.match(result.sections.stuck[0].detail, /not receiving data/);
});

test("a live broadcast past the expected end is Not ended, not Live", () => {
  const late = PM_START + board.EXPECTED_MS;
  const result = build({
    now: late,
    streams: [row({ id: "late", status: "live", video_id: "lateVid" })],
    healthById: { lateVid: liveHealth("lateVid", "good") }
  });
  assert.deepEqual(ids(result.sections["not-ended"]), ["late"]);
  assert.equal(result.sections["not-ended"][0].reason, "past-end");
  assert.equal(result.sections["not-ended"][0].badge, "Not ended");
  assert.equal(result.sections.live.length, 0);
});

test("the morning slot still active when the afternoon game is due is Not ended", () => {
  const result = build({
    now: Date.parse("2026-11-27T21:45:00.000Z"),
    streams: [
      row({
        id: "am",
        start_local: "8:30 AM",
        video_id: "amVideo1",
        status: "ended",
        team1: "SRCA Spartans",
        team2: "MSKICA Cheetahs"
      }),
      row({ id: "pm", video_id: "pmVideo1", status: null })
    ],
    grounds: [{ id: "stanfordu9", name: "StanfordU9", activeBroadcastId: "amVideo1" }]
  });
  assert.equal(result.sections["not-ended"][0].id, "am");
  assert.equal(result.sections["not-ended"][0].reason, "am-slot");
  assert.match(result.sections["not-ended"][0].detail, /afternoon game is due/);
  assert.equal(result.sections["not-started"][0].id, "pm");
  assert.equal(result.sections["not-started"][0].overdue, true);
  assert.equal(result.sections["not-started"][0].badge, "Overdue");
});

test("a switched morning game is Completed and the afternoon game stays Live", () => {
  const result = build({
    streams: [
      row({ id: "am", start_local: "8:30 AM", video_id: "amDone01", status: "ended", team1: "A", team2: "B" }),
      row({ id: "pm", video_id: "pmLive01", status: "live" })
    ],
    grounds: [{ id: "stanfordu9", name: "StanfordU9", activeBroadcastId: "pmLive01" }],
    healthById: {
      amDone01: { id: "amDone01", lifeCycle: "complete", healthStatus: null, streamStatus: null, issues: [] },
      pmLive01: liveHealth("pmLive01", "good")
    }
  });
  assert.deepEqual(ids(result.sections.completed), ["am"]);
  assert.deepEqual(ids(result.sections.live), ["pm"]);
});

test("a broadcast that has not started is Not started, and overdue after the start time", () => {
  const early = build({
    now: PM_START - 60 * 1000,
    streams: [row({ id: "soon", status: null, video_id: "soonVid1" })],
    healthById: { soonVid1: { id: "soonVid1", lifeCycle: "ready", streamStatus: "ready", healthStatus: "good", issues: [] } }
  });
  assert.equal(early.sections["not-started"][0].overdue, false);
  assert.equal(early.sections["not-started"][0].badge, "Not started");

  const overdue = build({
    now: PM_START + 20 * 60 * 1000,
    streams: [row({ id: "late-start", status: null, video_id: "lateStart" })],
    healthById: { lateStart: { id: "lateStart", lifeCycle: "created", streamStatus: "inactive", healthStatus: "noData", issues: [] } }
  });
  assert.equal(overdue.sections["not-started"][0].overdue, true);
  assert.equal(overdue.sections["not-started"][0].badge, "Overdue");
  assert.equal(overdue.sections.stuck.length, 0);
});

test("a game with no status well past the window is Not ended", () => {
  const result = build({
    streams: [row({
      id: "nyct-20261127-pv1-0900",
      event: "NYCT",
      start_local: "9:00 AM",
      timezone: "Central",
      ground: "PV1",
      division: "U17",
      team1: "MACS CANADA",
      team2: "All Stars Invincibles",
      video_id: "5mRXsYTEPto",
      status: null
    })]
  });
  assert.equal(result.sections["not-ended"][0].id, "nyct-20261127-pv1-0900");
  assert.equal(result.sections["not-ended"][0].reason, "unmarked");
  assert.equal(result.sections["not-ended"][0].division, "U17");
  assert.equal(result.sections["not-ended"][0].watchUrl, "https://www.youtube.com/watch?v=5mRXsYTEPto");
});

test("Nov 27 PMS-1, PMS-2, and HPMS stay in the status sections when they have rows", () => {
  const result = build({
    streams: [
      row({ id: "psd-20261127-pms-1-1030", start_local: "10:30 AM", ground: "PMS-1", division: "U9", team1: "TCA Tigers", team2: "CCA Little Masters", video_id: "azY01hx_H3M", status: "ended" }),
      row({ id: "psd-20261127-pms-2-1030", start_local: "10:30 AM", ground: "PMS-2", division: "U9", team1: "PCL Avengers", team2: "BCA Vikings", video_id: "kpa0uU5k_i4", status: "ended" }),
      row({ id: "psd-20261127-hpms-1030", start_local: "10:30 AM", ground: "HPMS", division: "U11", team1: "BCA Challengers", team2: "Strikers Tensors", video_id: "twMnFKL59U4", status: "ended" }),
      row({ id: "other-day", date: "2026-11-26", ground: "PMS-1", video_id: "yesterday1", status: "ended" })
    ],
    grounds: [
      { id: "pms1", name: "PMS1" },
      { id: "pms2", name: "PMS2" },
      { id: "hpms", name: "HPMS" },
      { id: "spare", name: "Practice Field" }
    ]
  });
  assert.deepEqual(ids(result.sections.completed).sort(), ["psd-20261127-hpms-1030", "psd-20261127-pms-1-1030", "psd-20261127-pms-2-1030"]);
  assert.equal(result.sections.completed[0].watchUrl.startsWith("https://www.youtube.com/watch?v="), true);
  assert.deepEqual(result.idle.map((item) => item.id), ["spare"]);
  assert.equal(result.idle[0].detail, "No games scheduled");
  assert.equal(result.idle[0].name, "Practice Field");
});

test("an idle PMS ground uses the broadcast ground name", () => {
  const result = build({
    dayKey: "2026-11-29",
    streams: [],
    grounds: [
      { id: "pms1", name: "PMS1" },
      { id: "pms2", name: "PMS2" },
      { id: "hpms", name: "HPMS" },
      { id: "ctsu11", name: "CTS West" },
      { id: "pms1-renamed", name: "PMS North" }
    ]
  });
  assert.deepEqual(result.idle.map((item) => item.name), ["CTS West", "HPMS", "PMS North", "PMS-1", "PMS-2"]);
  result.idle.forEach((item) => assert.equal(item.detail, "No games scheduled"));
});

test("a video id can start with a dash and still links to YouTube", () => {
  const result = build({
    streams: [row({ id: "dash", video_id: "-V1NIv884T0", status: "ended", ground: "Sycamore 2" })],
    grounds: [{ id: "sycamore2", name: "sycamore2" }]
  });
  assert.equal(result.sections.completed[0].watchUrl, "https://www.youtube.com/watch?v=-V1NIv884T0");
  assert.equal(result.idle.length, 0);
});

test("Command Center keeps the day board, the health poll, and the existing controls", () => {
  const html = readFileSync(join(__dirname, "../admin.html"), "utf8");
  const css = readFileSync(join(__dirname, "../admin.css"), "utf8");
  const page = readFileSync(join(__dirname, "../js/day-board-page.js"), "utf8");
  const monitor = readFileSync(join(__dirname, "../js/command-monitor.js"), "utf8");
  const admin = readFileSync(join(__dirname, "../admin.js"), "utf8");
  const boardAt = html.indexOf('id="day-board"');
  const gridAt = html.indexOf('id="card-grid"');
  const idleAt = html.indexOf('id="day-idle"');
  assert.ok(boardAt > 0 && boardAt < gridAt && gridAt < idleAt);
  assert.match(html, /id="day-prev"/);
  assert.match(html, /id="day-next"/);
  assert.match(html, /id="day-date"/);
  assert.match(html, /js\/day-board\.js/);
  assert.match(html, /js\/day-board-page\.js/);
  assert.match(css, /\.day-board__controls button,\s*\.day-board__date input \{[^}]*min-height:\s*44px;/);
  assert.match(css, /@media \(max-width: 720px\) \{\s*\.day-grid \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(page, /setInterval/);
  assert.match(page, /pp_streams/);
  assert.doesNotMatch(page, /stream_key/);
  assert.doesNotMatch(page, /profiles/);
  assert.match(monitor, /HEALTH_MS = 25000/);
  assert.match(monitor, /PulsePlayDayBoard/);
  assert.match(monitor, /refreshStreams/);
  assert.match(admin, /RTMP:/);
  assert.match(admin, /btn-next-game/);
  assert.match(admin, /card__health/);
  assert.match(html, /id="btn-live-refresh"/);
  assert.match(html, /id="btn-reset-stuck"/);
});
