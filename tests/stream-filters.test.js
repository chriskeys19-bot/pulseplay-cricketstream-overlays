const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const filters = require("../js/stream-filters.js");
const scope = require("../js/scope.js");

function row(partial) {
  return Object.assign({ event: "PSD", division: "U11", status: null, ground: "Stanford" }, partial);
}

test("event choices are the codes on the rows, in tournament order, plus All is separate", () => {
  const events = filters.eventsIn([
    row({ event: "nyct" }),
    row({ event: "PSD" }),
    row({ event: "AMLCA", status: "ended" }),
    row({ event: "PSD" }),
    row({ event: "" }),
    row({ event: "Club friendly" })
  ]);
  assert.deepEqual(events, ["AMLCA", "NYCT", "PSD"]);
});

test("the choice defaults to PSD, and a URL choice beats the saved one", () => {
  assert.equal(filters.preferredEvent("", ""), "PSD");
  assert.equal(filters.preferredEvent("", "NYCT"), "NYCT");
  assert.equal(filters.preferredEvent("all", "PSD"), "all");
  assert.equal(filters.preferredEvent("amlca", "PSD"), "AMLCA");
  assert.equal(filters.resolveEvent("PSD", ["AMLCA", "NYCT", "PSD"]), "PSD");
  assert.equal(filters.resolveEvent("NCCA", ["NYCT", "AMLCA"]), "all");
  assert.equal(filters.resolveEvent("PSD", []), "PSD");
});

test("ended rows stay hidden until show ended, and a concealed row stays hidden", () => {
  const rows = [
    row({ id: "live", status: "live" }),
    row({ id: "ended", status: "Ended" }),
    row({ id: "hidden", status: "live", hidden: true }),
    row({ id: "archived", status: null, archived: "yes" }),
    row({ id: "stamped", status: "live", hidden_at: "2026-11-01" }),
    row({ id: "shown", status: "live", hidden: false, archived_at: "" })
  ];
  const hidden = filters.visibleStreams(rows, null, { event: "PSD", showEnded: false }).map((item) => item.id);
  const shown = filters.visibleStreams(rows, null, { event: "PSD", showEnded: true }).map((item) => item.id);
  assert.deepEqual(hidden, ["live", "shown"]);
  assert.deepEqual(shown, ["live", "ended", "shown"]);
  assert.equal(filters.isStatusEnded(row({ status: "ended" })), true);
  assert.equal(filters.isConcealed(row({ is_hidden: "1" })), true);
  assert.equal(filters.isConcealed(row({ is_archived: false })), false);
});

test("the event filter cannot widen pp_access_grants", () => {
  const access = scope.summaryFromMe({
    allowed: true,
    grants: [{ scopeType: "tournament", tournament: "PSD", division: null, role: "admin", status: "active" }]
  });
  const rows = [
    row({ id: "psd", event: "PSD", division: "U15" }),
    row({ id: "nyct", event: "NYCT", division: "U11" }),
    row({ id: "amlca", event: "AMLCA", division: "U13", status: "ended" })
  ];
  const allows = (item) => scope.streamVisible(access, item);
  assert.deepEqual(filters.visibleStreams(rows, allows, { event: "all", showEnded: true }).map((item) => item.id), ["psd"]);
  assert.deepEqual(filters.visibleStreams(rows, allows, { event: "NYCT", showEnded: true }).map((item) => item.id), []);
  assert.deepEqual(filters.eventsIn(rows.filter(allows)), ["PSD"]);
});

test("the saved URL keeps the other query parameters", () => {
  assert.equal(filters.searchWithEvent("?tab=wall", "PSD"), "?tab=wall&event=PSD");
  assert.equal(filters.searchWithEvent("?event=NYCT&tab=wall", "all"), "?event=all&tab=wall");
  assert.equal(filters.searchWithEvent("", "amlca"), "?event=AMLCA");
});

test("a choice is remembered and a scoped user without PSD falls back to All", () => {
  const storage = new Map();
  const location = { pathname: "/admin.html", search: "?tab=wall", hash: "" };
  const urls = [];
  const store = filters.create({
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    location: location,
    history: {
      replaceState: function (_state, _title, url) { urls.push(url); location.search = url.slice(url.indexOf("?")); }
    }
  });
  assert.equal(store.current(), "PSD");
  store.noteRows([row({ event: "NYCT" }), row({ event: "AMLCA" })]);
  assert.equal(store.current(), "all");
  assert.deepEqual(store.events(), ["AMLCA", "NYCT"]);
  assert.equal(storage.get(filters.STORAGE_KEY), "all");
  store.setEvent("NYCT");
  assert.equal(store.current(), "NYCT");
  assert.equal(storage.get(filters.STORAGE_KEY), "NYCT");
  assert.match(urls[urls.length - 1], /event=NYCT/);
  assert.match(urls[urls.length - 1], /tab=wall/);
});

test("the Streams and Live Wall controls are one tap and at least 44px", () => {
  const html = readFileSync(join(__dirname, "../admin.html"), "utf8");
  const css = readFileSync(join(__dirname, "../admin.css"), "utf8");
  const streams = readFileSync(join(__dirname, "../js/streams.js"), "utf8");
  const wall = readFileSync(join(__dirname, "../js/live-wall-page.js"), "utf8");
  assert.match(html, /id="streams-event"[^>]*role="radiogroup"/);
  assert.match(html, /id="wall-event"[^>]*role="radiogroup"/);
  assert.match(html, /id="streams-show-ended"/);
  assert.doesNotMatch(html, /streams-hide-ended/);
  assert.match(html, /js\/stream-filters\.js/);
  assert.match(css, /\.stream-event-picks button,\s*\.stream-toggle \{[^}]*min-height:\s*44px;[^}]*font-size:\s*16px;[^}]*touch-action:\s*manipulation;/);
  assert.match(streams, /PulsePlayStreamFilters/);
  assert.match(streams, /streams-show-ended/);
  assert.match(wall, /PulsePlayStreamFilters/);
  assert.match(wall, /forWall/);
});
