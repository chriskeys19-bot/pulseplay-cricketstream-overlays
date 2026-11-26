/*
 * Event filter shared by Streams and the Live Wall.
 * Options come from events on the rows the caller can already see.
 * Default is PSD. All keeps that same access scope. Ended rows
 * (status ended) stay out of the Streams list until Show ended.
 * A hidden or archived column, when the row has one, stays out.
 */
(function (root, factory) {
  var api = factory(typeof window !== "undefined" ? window : null);
  api.create = factory;
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayStreamFilters = api;
})(typeof window !== "undefined" ? window : this, function (env) {
  var STORAGE_KEY = "pulseplay.streams.event";
  var DEFAULT_EVENT = "PSD";
  var KNOWN = ["AMLCA", "NCCA", "NYCT", "PSD"];
  var CODE = /^[A-Z][A-Z0-9]{1,11}$/;
  var FLAG_KEYS = ["hidden", "is_hidden", "archived", "is_archived"];
  var state = { event: DEFAULT_EVENT, events: [] };
  var listeners = [];

  env = env || {};

  function canonicalEvent(value) {
    var text = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "").toUpperCase();
    if (!text) return "";
    if (text === "ALL" || text === "*") return "all";
    return CODE.test(text) ? text : "";
  }

  function preferredEvent(urlValue, storedValue) {
    var fromUrl = canonicalEvent(urlValue);
    if (fromUrl) return fromUrl;
    var stored = canonicalEvent(storedValue);
    if (stored) return stored;
    return DEFAULT_EVENT;
  }

  function eventOf(row) {
    if (!row) return "";
    return canonicalEvent(row.event || row.tournament);
  }

  function truthyFlag(value) {
    if (value === true || value === 1) return true;
    var text = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "").toLowerCase();
    return text === "true" || text === "t" || text === "1" || text === "yes" || text === "y";
  }

  function presentStamp(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "") !== "";
  }

  function isConcealed(row) {
    var i;
    if (!row) return false;
    for (i = 0; i < FLAG_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(row, FLAG_KEYS[i]) && truthyFlag(row[FLAG_KEYS[i]])) return true;
    }
    if (Object.prototype.hasOwnProperty.call(row, "archived_at") && presentStamp(row.archived_at)) return true;
    if (Object.prototype.hasOwnProperty.call(row, "hidden_at") && presentStamp(row.hidden_at)) return true;
    return false;
  }

  function isStatusEnded(row) {
    return String(row && row.status || "").replace(/^\s+|\s+$/g, "").toLowerCase() === "ended";
  }

  function orderEvents(list) {
    var known = [];
    var rest = [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (KNOWN.indexOf(list[i]) !== -1) known.push(list[i]);
      else rest.push(list[i]);
    }
    known.sort(function (a, b) { return KNOWN.indexOf(a) - KNOWN.indexOf(b); });
    rest.sort();
    return known.concat(rest);
  }

  function eventsIn(rows) {
    var seen = {};
    var out = [];
    var i;
    var code;
    rows = rows || [];
    for (i = 0; i < rows.length; i++) {
      if (isConcealed(rows[i])) continue;
      code = eventOf(rows[i]);
      if (!code || code === "all" || seen[code]) continue;
      seen[code] = true;
      out.push(code);
    }
    return orderEvents(out);
  }

  function eventMatches(row, eventFilter) {
    var filter = canonicalEvent(eventFilter) || DEFAULT_EVENT;
    if (filter === "all") return true;
    return eventOf(row) === filter;
  }

  function resolveEvent(preferred, events) {
    var choice = canonicalEvent(preferred) || DEFAULT_EVENT;
    if (!events || !events.length) return choice;
    if (choice === "all") return "all";
    if (events.indexOf(choice) !== -1) return choice;
    if (events.indexOf(DEFAULT_EVENT) !== -1) return DEFAULT_EVENT;
    return "all";
  }

  function queryValue(search, name) {
    var parts;
    var i;
    var pair;
    var key;
    var value;
    search = search || "";
    if (search.charAt(0) === "?") search = search.substring(1);
    if (!search) return "";
    parts = search.split("&");
    for (i = 0; i < parts.length; i++) {
      pair = parts[i].split("=");
      try { key = decodeURIComponent(pair[0] || ""); } catch (e) { key = pair[0] || ""; }
      if (key !== name) continue;
      try { value = decodeURIComponent((pair[1] || "").replace(/\+/g, " ")); } catch (e2) { value = pair[1] || ""; }
      return value;
    }
    return "";
  }

  function searchWithEvent(search, event) {
    var raw = search || "";
    var parts;
    var next = [];
    var i;
    var pair;
    var key;
    var seen = false;
    var encoded = encodeURIComponent(canonicalEvent(event) || DEFAULT_EVENT);
    if (raw.charAt(0) === "?") raw = raw.substring(1);
    parts = raw ? raw.split("&") : [];
    for (i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      pair = parts[i].split("=");
      try { key = decodeURIComponent(pair[0] || ""); } catch (e) { key = pair[0] || ""; }
      if (key === "event") {
        if (!seen) next.push("event=" + encoded);
        seen = true;
      } else {
        next.push(parts[i]);
      }
    }
    if (!seen) next.push("event=" + encoded);
    return "?" + next.join("&");
  }

  function visibleStreams(rows, accessAllows, options) {
    var opts = options || {};
    var event = opts.event == null ? state.event : opts.event;
    var showEnded = !!opts.showEnded;
    var out = [];
    var i;
    var row;
    rows = rows || [];
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (accessAllows && !accessAllows(row)) continue;
      if (isConcealed(row)) continue;
      if (!showEnded && isStatusEnded(row)) continue;
      if (!eventMatches(row, event)) continue;
      out.push(row);
    }
    return out;
  }

  function readStorage() {
    try {
      if (env.localStorage) return env.localStorage.getItem(STORAGE_KEY) || "";
    } catch (e) {}
    return "";
  }

  function writeStorage(value) {
    try {
      if (env.localStorage) env.localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {}
  }

  function locationOf() {
    return env.location || null;
  }

  function replaceUrl(event) {
    var location = locationOf();
    var next;
    if (!location || !env.history || !env.history.replaceState) return;
    next = searchWithEvent(location.search || "", event);
    if (next === (location.search || "")) return;
    env.history.replaceState({}, "", (location.pathname || "") + next + (location.hash || ""));
  }

  function emit() {
    var i;
    var current = listeners.slice();
    for (i = 0; i < current.length; i++) current[i](state.event);
  }

  function sameList(a, b) {
    var i;
    if (a.length !== b.length) return false;
    for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function noteRows(rows) {
    var found = eventsIn(rows);
    var nextEvent = resolveEvent(state.event, found);
    var eventsChanged = !sameList(found, state.events);
    var eventChanged = nextEvent !== state.event;
    state.events = found;
    if (eventChanged) {
      state.event = nextEvent;
      writeStorage(nextEvent);
      replaceUrl(nextEvent);
    }
    if (eventsChanged || eventChanged) emit();
  }

  function setEvent(value) {
    var next = canonicalEvent(value);
    if (!next) return;
    if (next !== "all" && state.events.length && state.events.indexOf(next) === -1) return;
    if (next === state.event) return;
    state.event = next;
    writeStorage(next);
    replaceUrl(next);
    emit();
  }

  function choiceValues() {
    var events = state.events.slice();
    if (!events.length) {
      events = state.event && state.event !== "all" ? [state.event] : [DEFAULT_EVENT];
    }
    return ["all"].concat(events);
  }

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function paint(container) {
    var values;
    var current;
    var doc;
    var i;
    var button;
    if (!container) return;
    doc = container.ownerDocument || env.document;
    if (!doc || !doc.createElement) return;
    values = choiceValues();
    current = state.event;
    container.innerHTML = "";
    for (i = 0; i < values.length; i++) {
      button = doc.createElement("button");
      button.type = "button";
      button.className = "stream-event-choice";
      button.setAttribute("role", "radio");
      button.setAttribute("data-event", values[i]);
      button.setAttribute("aria-checked", values[i] === current ? "true" : "false");
      setText(button, values[i] === "all" ? "All" : values[i]);
      button.onclick = (function (value) {
        return function () { setEvent(value); };
      })(values[i]);
      container.appendChild(button);
    }
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  function readInitial() {
    var location = locationOf();
    var fromUrl = location ? queryValue(location.search || "", "event") : "";
    state.event = preferredEvent(fromUrl, readStorage());
    if (canonicalEvent(fromUrl)) writeStorage(state.event);
  }

  readInitial();

  if (env.addEventListener) {
    env.addEventListener("storage", function (event) {
      if (!event || event.key !== STORAGE_KEY) return;
      var next = resolveEvent(canonicalEvent(readStorage()) || state.event, state.events);
      if (next === state.event) return;
      state.event = next;
      replaceUrl(next);
      emit();
    });
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_EVENT: DEFAULT_EVENT,
    canonicalEvent: canonicalEvent,
    preferredEvent: preferredEvent,
    eventsIn: eventsIn,
    eventMatches: eventMatches,
    isConcealed: isConcealed,
    isStatusEnded: isStatusEnded,
    resolveEvent: resolveEvent,
    searchWithEvent: searchWithEvent,
    visibleStreams: visibleStreams,
    current: function () { return state.event; },
    events: function () { return state.events.slice(); },
    noteRows: noteRows,
    setEvent: setEvent,
    onChange: onChange,
    paint: paint,
    reloadFromStorage: function () {
      var next = resolveEvent(canonicalEvent(readStorage()) || state.event, state.events);
      if (next === state.event) return;
      state.event = next;
      replaceUrl(next);
      emit();
    }
  };
});
