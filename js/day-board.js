/*
 * Command Center day status. No network and no DOM.
 *
 * One selected calendar day, defaulting to today in America/Chicago.
 * Games come from pp_streams. A configured ground comes from pp_grounds.
 * YouTube health, when the existing health check has a row, uses the same
 * classifier as the ground-card health bar.
 *
 * Sections, in order:
 *   live        broadcast is on air and the transmission is not stalled
 *   stuck       broadcast is live and the transmission is stalled
 *   not-ended   still on air past the expected end, not marked complete
 *               after that window, or the earlier slot is still the active
 *               score when a later game on that ground is due
 *   not-started broadcast has not gone live; overdue once the start passes
 *   completed   ended on YouTube or in pp_streams
 *
 * Expected end is 3.5 hours after the scheduled start, the same window the
 * Live Wall uses between the morning and afternoon slots.
 * A ground with no pp_streams row on the selected day is idle.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayDayBoardRules = api;
})(typeof window !== "undefined" ? window : this, function () {
  var CHICAGO = "America/Chicago";
  var EXPECTED_MS = 3.5 * 60 * 60 * 1000;
  var SECTION_ORDER = ["live", "stuck", "not-ended", "not-started", "completed"];
  var VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/;
  var STREAM_NAMES = {
    pms1: "PMS-1",
    pms2: "PMS-2",
    hpms: "HPMS",
    stanfordu9: "Stanford",
    "4leaf": "4Leaf East",
    ctsu11: "CTS West",
    sycamore2: "Sycamore 2",
    sycamore3: "Sycamore 3"
  };

  function text(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  }

  function lower(value) {
    return text(value).toLowerCase();
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function chicagoDayKey(now) {
    var date = new Date(now);
    var parts;
    var map = {};
    var i;
    if (!isFinite(date.getTime())) return "";
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    for (i = 0; i < parts.length; i++) {
      if (parts[i].type !== "literal") map[parts[i].type] = parts[i].value;
    }
    if (!map.year || !map.month || !map.day) return "";
    return map.year + "-" + map.month + "-" + map.day;
  }

  function shiftDay(dayKey, delta) {
    var parts = String(dayKey || "").split("-");
    var utc;
    if (parts.length !== 3) return "";
    utc = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10) + delta));
    if (!isFinite(utc.getTime())) return "";
    return utc.getUTCFullYear() + "-" + pad(utc.getUTCMonth() + 1) + "-" + pad(utc.getUTCDate());
  }

  function dayHeading(dayKey) {
    var parts = String(dayKey || "").split("-");
    var utc;
    if (parts.length !== 3) return "";
    utc = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 18, 0, 0));
    if (!isFinite(utc.getTime())) return dayKey;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      weekday: "long",
      month: "short",
      day: "numeric"
    }).format(utc);
  }

  function rowDay(row) {
    return text(row && row.date).slice(0, 10);
  }

  function videoId(row) {
    var raw = text(row && row.video_id);
    var match;
    if (!raw) return "";
    match = /(?:v=|youtu\.be\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{6,64})/.exec(raw);
    if (match) return match[1];
    if (VIDEO_ID.test(raw)) return raw;
    return "";
  }

  function watchUrl(id) {
    return id ? "https://www.youtube.com/watch?v=" + id : "";
  }

  function divisionLabel(value) {
    var token = text(value).toUpperCase();
    if (/^U\d{1,2}$/.test(token)) return token;
    return text(value);
  }

  function idleName(ground) {
    var id = lower(ground && ground.id);
    var name = text(ground && ground.name);
    var compact = lower(name).replace(/[^a-z0-9]/g, "");
    if (STREAM_NAMES[id] && (!name || compact === id)) return STREAM_NAMES[id];
    return name || STREAM_NAMES[id] || id;
  }

  function teamsLabel(row) {
    var a = text(row && row.team1);
    var b = text(row && row.team2);
    if (a && b) return a + " vs " + b;
    return a || b || "";
  }

  function startMs(row, convert) {
    var iso = convert ? convert(row.date, row.start_local, row.timezone) : "";
    var parsed = iso ? Date.parse(iso) : NaN;
    return isFinite(parsed) ? parsed : NaN;
  }

  function startLabel(row, convert, clock) {
    var iso = convert ? convert(row.date, row.start_local, row.timezone) : "";
    var zone = row && row.timezone === "Central" ? CHICAGO : "America/Los_Angeles";
    var local = iso && clock ? clock(iso, zone) : null;
    var chicago = iso && clock && zone !== CHICAGO ? clock(iso, CHICAGO) : null;
    var primary = local && local.timeLabel ? local.timeLabel : (text(row && row.start_local) + (row && row.timezone === "Central" ? " CT" : " PT"));
    if (!local && !text(row && row.start_local)) return "";
    if (chicago && chicago.timeLabel && chicago.timeLabel !== primary) return primary + " · " + chicago.timeLabel;
    return primary;
  }

  function onAir(life) {
    var value = lower(life);
    return value === "live" || value === "livestarting" || value === "live_starting" || value === "testing" || value === "teststarting" || value === "test_starting";
  }

  function isEnded(life) {
    var value = lower(life);
    return value === "complete" || value === "revoked" || value === "ended" || value === "failed";
  }

  function healthRow(row, healthById) {
    var id = videoId(row);
    var raw = text(row && row.video_id);
    if (!healthById) return null;
    if (id && healthById[id]) return healthById[id];
    if (raw && healthById[raw]) return healthById[raw];
    return null;
  }

  function lifeOf(row, health) {
    if (health && health.lifeCycle) return String(health.lifeCycle);
    return String(row && row.status || "");
  }

  function neverWentLive(health) {
    var life;
    if (!health || !health.lifeCycle) return false;
    life = lower(health.lifeCycle);
    return life === "created" || life === "ready" || life === "upcoming";
  }

  function defaultMatch(ground, stream) {
    var name = lower(stream && stream.ground);
    if (!name || !ground) return false;
    if (lower(ground.name) === name) return true;
    if (lower(ground.id) === name) return true;
    return false;
  }

  function matchedGround(stream, grounds, matches) {
    var i;
    for (i = 0; i < grounds.length; i++) {
      if (matches(grounds[i], stream)) return grounds[i];
    }
    return null;
  }

  function groupKey(stream, ground) {
    if (ground && ground.id) return "id:" + ground.id;
    return "name:" + lower(stream && stream.ground);
  }

  function blocksLater(game, group, now, convert, activeBroadcastId) {
    var start = game.start;
    var laterDue = false;
    var i;
    var other;
    var id;
    if (!isFinite(start)) return false;
    for (i = 0; i < group.length; i++) {
      other = group[i];
      if (other.id === game.id) continue;
      if (isFinite(other.start) && other.start > start && now >= other.start) laterDue = true;
    }
    if (!laterDue) return false;
    if (onAir(game.life)) return true;
    id = game.video;
    if (id && activeBroadcastId && id === activeBroadcastId) return true;
    return false;
  }

  function classify(game, now) {
    var life = game.life;
    var ended = isEnded(life);
    var air = onAir(life);
    var pastEnd = isFinite(game.start) && now >= game.start + EXPECTED_MS;
    var pastStart = isFinite(game.start) && now >= game.start;
    var stalled = !!(game.view && game.view.tone === "bad" && lower(life) === "live");
    var section;
    var reason = "";
    if (air) ended = false;
    if (stalled) {
      section = "stuck";
      if (game.amBlock) reason = "am-slot";
      else if (pastEnd) reason = "past-end";
    } else if (game.amBlock) {
      section = "not-ended";
      reason = "am-slot";
    } else if (!ended && air && pastEnd) {
      section = "not-ended";
      reason = "past-end";
    } else if (!ended && pastEnd && !neverWentLive(game.health)) {
      section = "not-ended";
      reason = "unmarked";
    } else if (air) {
      section = "live";
    } else if (ended) {
      section = "completed";
    } else {
      section = "not-started";
      if (pastStart) reason = "overdue";
    }
    return { section: section, reason: reason, pastEnd: pastEnd, overdue: section === "not-started" && pastStart };
  }

  function badgeFor(placed, game) {
    if (placed.section === "stuck") {
      return { label: game.view && game.view.label ? game.view.label : "Stuck", tone: "bad" };
    }
    if (placed.section === "not-ended") return { label: "Not ended", tone: "warn" };
    if (placed.section === "not-started") {
      return placed.overdue
        ? { label: "Overdue", tone: "warn" }
        : { label: "Not started", tone: "muted" };
    }
    if (placed.section === "completed") return { label: "Completed", tone: "muted" };
    if (game.view && game.view.label) return { label: game.view.label, tone: game.view.tone || "good" };
    return { label: "Checking", tone: "muted" };
  }

  function detailFor(placed, game) {
    var parts = [];
    if (placed.section === "stuck") {
      if (game.view && game.view.detail) parts.push(game.view.detail);
      if (placed.reason === "am-slot") parts.push("The afternoon game is due and this broadcast is still on.");
      else if (game.pastEndFlag || placed.reason === "past-end") parts.push("Still live past the expected end.");
      return parts.join(" ");
    }
    if (placed.section === "not-ended" && placed.reason === "am-slot") {
      parts.push("The morning slot is still active and the afternoon game is due.");
      if (isFinite(game.start) && game.now >= game.start + EXPECTED_MS) parts.push("The expected end has also passed.");
      return parts.join(" ");
    }
    if (placed.section === "not-ended" && placed.reason === "past-end") {
      return "Scheduled end has passed and this broadcast is still live.";
    }
    if (placed.section === "not-ended" && placed.reason === "unmarked") {
      return "The scheduled window has ended and this game is not marked complete.";
    }
    if (placed.section === "not-started" && placed.overdue) return "Start time has passed.";
    if (placed.section === "live" && !game.view) return "Waiting for the YouTube health check.";
    if (game.view && game.view.detail) return game.view.detail;
    return "";
  }

  function buildBoard(options) {
    var streams = options && options.streams || [];
    var grounds = options && options.grounds || [];
    var matches = options && options.groundMatches || defaultMatch;
    var now = options && options.now != null ? options.now : Date.now();
    var dayKey = options && options.dayKey || chicagoDayKey(now);
    var healthById = options && options.healthById || {};
    var convert = options && options.convert;
    var clock = options && options.clock;
    var classifyHealth = options && options.classifyHealth;
    var dayStreams = [];
    var prepared = [];
    var groups = {};
    var sections = { live: [], stuck: [], "not-ended": [], "not-started": [], completed: [] };
    var used = {};
    var idle = [];
    var i;
    var row;
    var ground;
    var key;
    var game;
    var placed;
    var badge;
    var item;
    var list;
    for (i = 0; i < streams.length; i++) {
      row = streams[i];
      if (!row || rowDay(row) !== dayKey) continue;
      dayStreams.push(row);
    }
    for (i = 0; i < dayStreams.length; i++) {
      row = dayStreams[i];
      ground = matchedGround(row, grounds, matches);
      key = groupKey(row, ground);
      game = {
        id: String(row.id || videoId(row) || i),
        row: row,
        ground: ground,
        key: key,
        start: startMs(row, convert),
        video: videoId(row),
        health: healthRow(row, healthById)
      };
      game.life = lifeOf(row, game.health);
      game.view = game.health && game.health.lifeCycle && classifyHealth ? classifyHealth(game.health) : null;
      if (!groups[key]) groups[key] = [];
      groups[key].push(game);
      prepared.push(game);
      if (ground && ground.id) used[ground.id] = true;
    }
    for (i = 0; i < prepared.length; i++) {
      game = prepared[i];
      game.amBlock = blocksLater(game, groups[game.key] || [], now, convert, game.ground && game.ground.activeBroadcastId);
      game.now = now;
      placed = classify(game, now);
      game.pastEndFlag = placed.pastEnd;
      badge = badgeFor(placed, game);
      item = {
        id: game.id,
        section: placed.section,
        reason: placed.reason,
        groundName: text(game.row.ground) || text(game.ground && game.ground.name),
        division: divisionLabel(game.row.division),
        teams: teamsLabel(game.row),
        event: text(game.row.event),
        startLabel: startLabel(game.row, convert, clock),
        watchUrl: watchUrl(game.video),
        videoId: game.video,
        badge: badge.label,
        tone: badge.tone,
        overdue: placed.overdue,
        detail: detailFor(placed, game),
        sort: isFinite(game.start) ? game.start : 0
      };
      sections[placed.section].push(item);
    }
    for (i = 0; i < SECTION_ORDER.length; i++) {
      list = sections[SECTION_ORDER[i]];
      list.sort(function (a, b) {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.sort !== b.sort) return a.sort - b.sort;
        if (a.groundName !== b.groundName) return a.groundName < b.groundName ? -1 : 1;
        if (a.id !== b.id) return a.id < b.id ? -1 : 1;
        return 0;
      });
    }
    for (i = 0; i < grounds.length; i++) {
      ground = grounds[i];
      if (!ground || !ground.id || used[ground.id]) continue;
      idle.push({
        id: ground.id,
        name: idleName(ground),
        detail: "No games scheduled"
      });
    }
    idle.sort(function (a, b) {
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    return {
      dayKey: dayKey,
      heading: dayHeading(dayKey),
      sections: sections,
      idle: idle
    };
  }

  return {
    CHICAGO: CHICAGO,
    EXPECTED_MS: EXPECTED_MS,
    SECTION_ORDER: SECTION_ORDER,
    chicagoDayKey: chicagoDayKey,
    shiftDay: shiftDay,
    dayHeading: dayHeading,
    videoId: videoId,
    watchUrl: watchUrl,
    buildBoard: buildBoard
  };
});
