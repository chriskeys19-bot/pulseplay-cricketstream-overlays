/*
 * Pure rules for the Broadcasts tab. No network calls.
 * Times are Pacific first, with Central beside them.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayYouTube = api;
})(typeof window !== "undefined" ? window : this, function () {
  var START_CONFIRM_LEAD_MS = 15 * 60 * 1000;
  var RECENT_ENDED_MS = 14 * 24 * 60 * 60 * 1000;
  var PACIFIC = "America/Los_Angeles";
  var CHICAGO = "America/Chicago";

  function zonedClock(iso, timeZone) {
    var date = new Date(iso);
    var parts;
    var map = {};
    var i;
    var monthNumber;
    var dayNumber;
    if (!iso || !isFinite(date.getTime())) return null;
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short"
    }).formatToParts(date);
    for (i = 0; i < parts.length; i++) {
      if (parts[i].type !== "literal") map[parts[i].type] = parts[i].value;
    }
    if (!map.year || !map.month || !map.day || !map.weekday || !map.hour || !map.minute) return null;
    monthNumber = new Intl.DateTimeFormat("en-US", { timeZone: timeZone, month: "2-digit" }).format(date);
    dayNumber = new Intl.DateTimeFormat("en-US", { timeZone: timeZone, day: "2-digit" }).format(date);
    return {
      dayKey: map.year + "-" + monthNumber + "-" + dayNumber,
      dayLabel: map.weekday + ", " + map.month + " " + map.day,
      timeLabel: (map.hour + ":" + map.minute + " " + (map.dayPeriod || "") + " " + (map.timeZoneName || "")).replace(/\s+/g, " ").trim()
    };
  }

  function displayStatus(lifeCycle) {
    if (lifeCycle === "live" || lifeCycle === "liveStarting") return "live";
    if (lifeCycle === "complete" || lifeCycle === "revoked") return "ended";
    return "upcoming";
  }

  function lifeCycleLabel(lifeCycle) {
    if (lifeCycle === "created" || lifeCycle === "ready") return "Upcoming";
    if (lifeCycle === "testStarting") return "Starting test";
    if (lifeCycle === "testing") return "Testing";
    if (lifeCycle === "liveStarting") return "Going live";
    if (lifeCycle === "live") return "Live";
    if (lifeCycle === "complete") return "Ended";
    if (lifeCycle === "revoked") return "Revoked";
    return "Upcoming";
  }

  function canStartBroadcast(lifeCycle) {
    return lifeCycle === "created" || lifeCycle === "ready" || lifeCycle === "testing" || lifeCycle === "testStarting";
  }

  function canEndBroadcast(lifeCycle) {
    return lifeCycle === "live" || lifeCycle === "liveStarting" || lifeCycle === "testing" || lifeCycle === "testStarting";
  }

  function startNeedsConfirm(scheduledStart, now) {
    var start;
    if (!scheduledStart) return true;
    start = Date.parse(scheduledStart);
    if (!isFinite(start)) return true;
    return start - now > START_CONFIRM_LEAD_MS;
  }

  function pacificDay(iso) {
    if (!iso) return null;
    var clock = zonedClock(iso, PACIFIC);
    return clock ? clock.dayKey : null;
  }

  function matchesFilter(row, filter, now) {
    var status = displayStatus(row.lifeCycle);
    var stamp;
    var age;
    var day;
    var today;
    if (filter === "live") return status === "live";
    if (filter === "ended") {
      if (status !== "ended") return false;
      stamp = Date.parse(row.actualEnd || row.scheduledStart || "");
      if (!isFinite(stamp)) return false;
      age = now - stamp;
      return age <= RECENT_ENDED_MS && age >= -60 * 60 * 1000;
    }
    if (status === "ended") return false;
    if (status === "live") return true;
    day = pacificDay(row.scheduledStart);
    today = pacificDay(new Date(now).toISOString());
    if (!day || !today) return true;
    return day >= today;
  }

  function sortTime(row) {
    var stamp = Date.parse(row.scheduledStart || row.actualStart || row.actualEnd || "");
    return isFinite(stamp) ? stamp : Infinity;
  }

  function groupBroadcasts(rows, filter, now) {
    var visible = [];
    var groups = {};
    var order = [];
    var i;
    var row;
    var clock;
    var dayKey;
    var group;
    var direction = filter === "ended" ? -1 : 1;
    for (i = 0; i < rows.length; i++) if (matchesFilter(rows[i], filter, now)) visible.push(rows[i]);
    for (i = 0; i < visible.length; i++) {
      row = visible[i];
      clock = row.scheduledStart ? zonedClock(row.scheduledStart, PACIFIC) : null;
      dayKey = clock ? clock.dayKey : "unscheduled";
      if (!groups[dayKey]) {
        groups[dayKey] = { dayKey: dayKey, dayLabel: clock ? clock.dayLabel : "No scheduled time", rows: [] };
        order.push(dayKey);
      }
      groups[dayKey].rows.push(row);
    }
    order.sort(function (left, right) {
      if (left === "unscheduled") return 1;
      if (right === "unscheduled") return -1;
      return left < right ? -direction : direction;
    });
    for (i = 0; i < order.length; i++) {
      group = groups[order[i]];
      group.rows.sort(function (left, right) { return (sortTime(left) - sortTime(right)) * direction; });
    }
    return order.map(function (key) { return groups[key]; });
  }

  function startConfirmCopy(row) {
    var pacific = row.scheduledStart ? zonedClock(row.scheduledStart, PACIFIC) : null;
    var central = row.scheduledStart ? zonedClock(row.scheduledStart, CHICAGO) : null;
    var when = pacific ? pacific.timeLabel : "an unknown time";
    var day = pacific ? pacific.dayLabel : null;
    var centralText = central ? central.timeLabel : "an unknown Central time";
    var key = row.streamKeyName && row.streamKeyName.replace(/^\s+|\s+$/g, "") ? row.streamKeyName.replace(/^\s+|\s+$/g, "") : "no stream key name on file";
    var schedule = day ? day + " at " + when : when;
    return {
      title: "Start this stream early?",
      body: "Start " + row.title + " now? It is scheduled for " + schedule + " (" + centralText + " Central). Stream key: " + key + "."
    };
  }

  function endConfirmCopy(row) {
    return {
      title: "End this stream?",
      body: "End " + row.title + " on YouTube? The broadcast will stop for viewers."
    };
  }

  function oauthFlagMessage(reason, connected) {
    if (connected) return "YouTube is connected.";
    if (reason === "denied") return "Google sign-in was cancelled before YouTube was connected.";
    if (reason === "state") return "That connection link expired or was already used. Press Connect YouTube again.";
    if (reason === "channel") return "YouTube did not return a channel for this account. Connect the CricketCrazeUSA account and try again.";
    if (reason === "missing_refresh") return "Google did not return a refresh token. Press Reconnect and accept the consent screen.";
    if (reason === "config") return "YouTube OAuth is not configured yet. An admin still needs to set the YouTube client secrets.";
    if (reason === "forbidden") return "Only a Pulse Play admin can connect YouTube.";
    return "YouTube could not be connected. Press Connect YouTube again.";
  }

  return {
    PACIFIC: PACIFIC,
    CHICAGO: CHICAGO,
    START_CONFIRM_LEAD_MS: START_CONFIRM_LEAD_MS,
    zonedClock: zonedClock,
    displayStatus: displayStatus,
    lifeCycleLabel: lifeCycleLabel,
    canStartBroadcast: canStartBroadcast,
    canEndBroadcast: canEndBroadcast,
    startNeedsConfirm: startNeedsConfirm,
    matchesFilter: matchesFilter,
    groupBroadcasts: groupBroadcasts,
    startConfirmCopy: startConfirmCopy,
    endConfirmCopy: endConfirmCopy,
    oauthFlagMessage: oauthFlagMessage
  };
});
