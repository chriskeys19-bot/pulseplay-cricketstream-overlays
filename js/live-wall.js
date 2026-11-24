/*
 * Live Wall rules. No network and no DOM.
 *
 * A row is on the wall only when it has a YouTube id and it is live.
 * YouTube lifecycle, when the broadcasts list has been checked, wins:
 *   complete / revoked -> off the wall
 *   live / liveStarting / testing / testStarting -> on the wall
 * Stored pp_streams.status is next:
 *   ended / complete / revoked / failed -> off
 *   live / liveStarting / testing / testStarting -> on
 * If status is empty and YouTube has nothing newer than created/ready,
 * the scheduled window is used: from 15 minutes before start until
 * 3 hours 30 minutes after start. That window matches the gap between
 * the morning and afternoon slots without keeping a finished game up.
 * Explicit live stays up past the window. Ended never uses the window.
 * Order: explicit live first, then window-inferred, then earlier start,
 * then ground, then id. Cap is 8.
 *
 * The page is read-only. Hidden tabs do not poll. One visible tab is
 * the leader (lowest id) and is the only tab that polls or refreshes
 * the auth session. Realtime, when the publication includes pp_streams,
 * is one channel per visible tab; the leader then polls about every
 * 2 minutes as a backstop. Otherwise the leader polls every 45 seconds
 * plus jitter, backing off to 5 minutes. Bursts collapse to one apply.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayLiveWallRules = api;
})(typeof window !== "undefined" ? window : this, function () {
  var MAX_TILES = 8;
  var LEAD_MS = 15 * 60 * 1000;
  var WINDOW_MS = 3.5 * 60 * 60 * 1000;
  var POLL_BASE_MS = 45000;
  var POLL_JITTER_MS = 15000;
  var POLL_MAX_MS = 5 * 60 * 1000;
  var SAFETY_POLL_MS = 120000;
  var STALE_MS = 7000;
  var STREAM_COLUMNS = "id,event,date,start_local,timezone,ground,division,team1,team2,video_id,status,scorecard_url,updated_at";

  function text(value) {
    return String(value || "").replace(/^\s+|\s+$/g, "");
  }

  function lower(value) {
    return text(value).toLowerCase();
  }

  function videoId(row) {
    var raw = text(row && row.video_id);
    var match;
    if (!raw) return "";
    match = /(?:v=|youtu\.be\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{6,64})/.exec(raw);
    if (match) return match[1];
    if (/^[A-Za-z0-9_-]{6,64}$/.test(raw)) return raw;
    return "";
  }

  function watchUrl(id) {
    return "https://www.youtube.com/watch?v=" + id;
  }

  function scorecardUrl(row) {
    var value = text(row && row.scorecard_url);
    if (!/^https?:\/\//i.test(value)) return "";
    return value;
  }

  function startIso(row, convert) {
    if (!row) return "";
    if (row.start_iso) return String(row.start_iso);
    if (!convert) return "";
    return convert(row.date, row.start_local, row.timezone) || "";
  }

  function kindOf(row, now, lifeCycle, convert) {
    var life = lower(lifeCycle);
    var status = lower(row && row.status);
    if (life === "complete" || life === "revoked") return "ended";
    if (life === "live" || life === "livestarting" || life === "testing" || life === "teststarting") return "explicit";
    if (status === "ended" || status === "complete" || status === "revoked" || status === "failed") return "ended";
    if (status === "live" || status === "livestarting" || status === "live_starting" || status === "testing" || status === "teststarting" || status === "test_starting") return "explicit";
    if (life && life !== "created" && life !== "ready" && life !== "upcoming") return "ended";
    var iso = startIso(row, convert);
    var start = iso ? Date.parse(iso) : NaN;
    if (!isFinite(start)) return "idle";
    if (now >= start - LEAD_MS && now < start + WINDOW_MS) return "window";
    return "idle";
  }

  function selectLive(rows, now, lifeByVideoId, convert) {
    var picked = [];
    var i;
    var row;
    var id;
    var life;
    var kind;
    var start;
    for (i = 0; i < (rows || []).length; i++) {
      row = rows[i];
      id = videoId(row);
      if (!id) continue;
      life = lifeByVideoId && row.video_id && lifeByVideoId[row.video_id] ? lifeByVideoId[row.video_id] : "";
      if (!life && lifeByVideoId && lifeByVideoId[id]) life = lifeByVideoId[id];
      kind = kindOf(row, now, life, convert);
      if (kind !== "explicit" && kind !== "window") continue;
      start = Date.parse(startIso(row, convert) || "");
      picked.push({
        row: row,
        kind: kind,
        start: isFinite(start) ? start : 0,
        ground: text(row.ground),
        id: String(row.id || id)
      });
    }
    picked.sort(function (a, b) {
      var ae = a.kind === "explicit" ? 0 : 1;
      var be = b.kind === "explicit" ? 0 : 1;
      if (ae !== be) return ae - be;
      if (a.start !== b.start) return a.start - b.start;
      if (a.ground !== b.ground) return a.ground < b.ground ? -1 : 1;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    });
    if (picked.length > MAX_TILES) picked = picked.slice(0, MAX_TILES);
    var out = [];
    for (i = 0; i < picked.length; i++) out.push(picked[i].row);
    return out;
  }

  function gridLayout(count, width) {
    var n = count < 0 ? 0 : count > MAX_TILES ? MAX_TILES : count;
    var bucket;
    var columns;
    var layout;
    var wide = width >= 1100;
    var narrow = width < 700;
    if (n <= 1) bucket = "1";
    else if (n === 2) bucket = "2";
    else if (n <= 4) bucket = "4";
    else if (n <= 6) bucket = "6";
    else bucket = "8";
    if (narrow || bucket === "1") {
      columns = 1;
      layout = "1";
    } else if (!wide) {
      columns = 2;
      layout = bucket === "2" ? "2" : "4";
    } else if (bucket === "2") {
      columns = 2;
      layout = "2";
    } else if (bucket === "4") {
      columns = 2;
      layout = "4";
    } else if (bucket === "6") {
      columns = 3;
      layout = "6";
    } else {
      columns = 4;
      layout = "8";
    }
    return { layout: layout, columns: columns, count: n };
  }

  function tileLabel(row, tournamentName) {
    var code = tournamentName ? tournamentName(row) : "";
    var teams = text(row && row.team1) + " vs " + text(row && row.team2);
    var ground = text(row && row.ground);
    var parts = [];
    if (code) parts.push(code);
    if (teams !== " vs ") parts.push(teams);
    if (ground) parts.push(ground);
    return parts.join(" · ");
  }

  function diffTiles(previous, next) {
    var prev = {};
    var nextMap = {};
    var keep = [];
    var add = [];
    var remove = [];
    var replace = [];
    var i;
    var id;
    for (i = 0; i < (previous || []).length; i++) prev[previous[i].id] = previous[i].videoId;
    for (i = 0; i < (next || []).length; i++) {
      id = next[i].id;
      nextMap[id] = next[i].videoId;
      if (!Object.prototype.hasOwnProperty.call(prev, id)) add.push(id);
      else if (prev[id] !== next[i].videoId) replace.push(id);
      else keep.push(id);
    }
    for (i = 0; i < (previous || []).length; i++) {
      id = previous[i].id;
      if (!Object.prototype.hasOwnProperty.call(nextMap, id)) remove.push(id);
    }
    return { keep: keep, add: add, remove: remove, replace: replace };
  }

  function clamp01(roll) {
    if (typeof roll !== "number" || !isFinite(roll)) return 0;
    if (roll < 0) return 0;
    if (roll > 1) return 1;
    return roll;
  }

  function jitter(random) {
    var roll = typeof random === "function" ? random() : 0;
    return Math.floor(clamp01(roll) * POLL_JITTER_MS);
  }

  function pollDelay(attempt, random) {
    var n = attempt > 0 ? attempt : 0;
    var base = POLL_BASE_MS * Math.pow(2, n);
    if (base > POLL_MAX_MS) base = POLL_MAX_MS;
    return base + jitter(random);
  }

  function leaderPollDelay(attempt, realtimeUp, random) {
    if (realtimeUp && !(attempt > 0)) return SAFETY_POLL_MS + jitter(random);
    return pollDelay(attempt, random);
  }

  function createBurst(wait, schedule, cancel) {
    var timer = null;
    var queued = [];
    var flush = null;
    return {
      push: function (item, onFlush) {
        queued.push(item);
        flush = onFlush;
        if (timer != null && cancel) cancel(timer);
        timer = schedule(function () {
          var batch = queued;
          queued = [];
          timer = null;
          if (flush) flush(batch);
        }, wait);
      },
      pending: function () { return queued.length; }
    };
  }

  function changeFromPayload(payload) {
    var event;
    var fresh;
    var oldRow;
    var id;
    if (!payload) return null;
    if (payload.event === "DELETE" || payload.event === "UPDATE" || payload.event === "INSERT" || payload.event === "REFETCH") {
      return payload.id ? payload : null;
    }
    event = payload.eventType || "";
    fresh = payload.new || null;
    oldRow = payload.old || null;
    id = fresh && fresh.id ? fresh.id : oldRow && oldRow.id ? oldRow.id : "";
    if (!id) return null;
    if (event === "DELETE") return { id: id, event: "DELETE" };
    if (!fresh || !fresh.video_id) return { id: id, event: "REFETCH" };
    return { id: id, event: event || "UPDATE", row: fresh };
  }

  function coalesceChanges(changes) {
    var byId = {};
    var order = [];
    var i;
    var change;
    for (i = 0; i < (changes || []).length; i++) {
      change = changes[i];
      if (!change || !change.id) continue;
      if (!Object.prototype.hasOwnProperty.call(byId, change.id)) order.push(change.id);
      byId[change.id] = change;
    }
    var out = [];
    for (i = 0; i < order.length; i++) out.push(byId[order[i]]);
    return out;
  }

  function applyChanges(rows, changes) {
    var map = {};
    var order = [];
    var i;
    var id;
    var next = [];
    for (i = 0; i < (rows || []).length; i++) {
      id = rows[i].id;
      if (!Object.prototype.hasOwnProperty.call(map, id)) order.push(id);
      map[id] = rows[i];
    }
    for (i = 0; i < (changes || []).length; i++) {
      id = changes[i].id;
      if (!id || changes[i].event === "REFETCH") continue;
      if (changes[i].event === "DELETE") {
        delete map[id];
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(map, id)) order.push(id);
      map[id] = changes[i].row;
    }
    for (i = 0; i < order.length; i++) if (map[order[i]]) next.push(map[order[i]]);
    return next;
  }

  function signature(rows, lives) {
    var parts = [];
    var lifePart = [];
    var i;
    var row;
    var id;
    for (i = 0; i < (rows || []).length; i++) {
      row = rows[i];
      parts.push([row.id, row.video_id, row.status, row.updated_at, row.scorecard_url, row.team1, row.team2, row.ground, row.event, row.date, row.start_local].join("~"));
    }
    parts.sort();
    for (id in lives || {}) {
      if (Object.prototype.hasOwnProperty.call(lives, id)) lifePart.push(id + "=" + lives[id]);
    }
    lifePart.sort();
    return parts.join("|") + "#" + lifePart.join(",");
  }

  function createCoordinator(tabId, staleMs) {
    var peers = {};
    var limit = staleMs || STALE_MS;
    function note(id, t, visible) {
      peers[id] = { t: t, visible: !!visible };
    }
    function leader(t) {
      var ids = [];
      var id;
      for (id in peers) {
        if (!Object.prototype.hasOwnProperty.call(peers, id)) continue;
        if (t - peers[id].t > limit) continue;
        if (!peers[id].visible) continue;
        ids.push(id);
      }
      ids.sort();
      return ids.length ? ids[0] : "";
    }
    return {
      beat: function (t, visible) {
        note(tabId, t, visible);
        return { type: "beat", id: tabId, t: t, visible: !!visible };
      },
      receive: function (msg) {
        if (!msg || msg.type !== "beat" || !msg.id || typeof msg.t !== "number") return;
        note(msg.id, msg.t, msg.visible);
      },
      leader: function (t) { return leader(t); },
      isLeader: function (t) { return leader(t) === tabId; },
      shouldRefreshAuth: function (t, visible) {
        return !!visible && leader(t) === tabId;
      },
      shouldPoll: function (t, visible, realtimeUp) {
        return !!visible && !realtimeUp && leader(t) === tabId;
      },
      shouldSafetyPoll: function (t, visible, realtimeUp) {
        return !!visible && !!realtimeUp && leader(t) === tabId;
      },
      shouldHoldRealtime: function (visible) { return !!visible; }
    };
  }

  function sampleRows() {
    return [
      { id: "sample-stanford", event: "PSD", date: "2026-11-24", start_local: "8:30 AM", timezone: "Pacific", ground: "Stanford", division: "U11", team1: "SRCA Spartans", team2: "Denver Dynamites", video_id: "M7lc1UVf-VE", status: "live", scorecard_url: "https://example.com/scorecards/stanford" },
      { id: "sample-cts", event: "PSD", date: "2026-11-24", start_local: "8:30 AM", timezone: "Pacific", ground: "CTS West", division: "U13", team1: "Strikers Tensors", team2: "BCA Mavericks", video_id: "jNQXAC9IVRw", status: "live", scorecard_url: "https://example.com/scorecards/cts-west" },
      { id: "sample-sycamore", event: "NYCT", date: "2026-11-24", start_local: "9:00 AM", timezone: "Central", ground: "PV1", division: "U17", team1: "MACS CANADA", team2: "DYCL Bolts", video_id: "M7lc1UVf-VE", status: "live", scorecard_url: "" },
      { id: "sample-hpms", event: "PSD", date: "2026-11-24", start_local: "10:30 AM", timezone: "Pacific", ground: "HPMS", division: "U11", team1: "BCA Challengers", team2: "CKCA All Stars", video_id: "jNQXAC9IVRw", status: "live", scorecard_url: "https://example.com/scorecards/hpms" }
    ];
  }

  return {
    MAX_TILES: MAX_TILES,
    LEAD_MS: LEAD_MS,
    WINDOW_MS: WINDOW_MS,
    POLL_BASE_MS: POLL_BASE_MS,
    POLL_MAX_MS: POLL_MAX_MS,
    SAFETY_POLL_MS: SAFETY_POLL_MS,
    STALE_MS: STALE_MS,
    STREAM_COLUMNS: STREAM_COLUMNS,
    videoId: videoId,
    watchUrl: watchUrl,
    scorecardUrl: scorecardUrl,
    kindOf: kindOf,
    selectLive: selectLive,
    gridLayout: gridLayout,
    tileLabel: tileLabel,
    diffTiles: diffTiles,
    pollDelay: pollDelay,
    leaderPollDelay: leaderPollDelay,
    createBurst: createBurst,
    changeFromPayload: changeFromPayload,
    coalesceChanges: coalesceChanges,
    applyChanges: applyChanges,
    signature: signature,
    createCoordinator: createCoordinator,
    sampleRows: sampleRows
  };
});
