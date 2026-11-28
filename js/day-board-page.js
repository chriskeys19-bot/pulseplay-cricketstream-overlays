/*
 * Command Center day status board.
 * Stream rows refresh on the existing Command Center health poll
 * (about every 25 seconds). This file does not start its own timer.
 */
(function () {
  var COLUMNS = "id,event,date,start_local,timezone,ground,division,team1,team2,video_id,auto_start,overlay_url,status,updated_at,scorecard_url";
  var COPY = {
    live: {
      title: "Live",
      blurb: "On air. Green means YouTube is live and the transmission is healthy. Amber means testing, starting, or a check."
    },
    stuck: {
      title: "Stuck",
      blurb: "The broadcast is live, but the transmission is stalled."
    },
    "not-ended": {
      title: "Not ended",
      blurb: "The game should be over, or the morning slot is still active after the afternoon start."
    },
    "not-started": {
      title: "Not started",
      blurb: "Scheduled, and the broadcast has not gone live. Overdue means the start time has passed."
    },
    completed: {
      title: "Completed",
      blurb: ""
    }
  };
  var selectedDay = "";
  var ownRows = null;
  var loadState = "idle";
  var busy = false;
  var fetchedAt = 0;
  var healthMap = {};
  var previewing = false;
  var previewRows = null;
  var previewGrounds = null;
  var previewNow = null;
  var completedOpen = false;
  var lastSignature = "";
  var errorMessage = "";

  function rules() {
    return window.PulsePlayDayBoardRules || null;
  }

  function setText(node, value) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = value;
    else node.innerText = value;
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function centerOpen() {
    var panel = document.getElementById("panel-center");
    return !!(panel && !panel.classList.contains("is-off") && document.visibilityState !== "hidden");
  }

  function liveClient() {
    if (window.PulsePlaySupabase && window.PulsePlaySupabase.get) return window.PulsePlaySupabase.get();
    return null;
  }

  function grounds() {
    if (previewing && previewGrounds) return previewGrounds;
    if (window.PulsePlayAdmin && window.PulsePlayAdmin.grounds) return window.PulsePlayAdmin.grounds() || [];
    return [];
  }

  function sourceRows() {
    if (previewing) return previewRows || [];
    if (loadState === "ready" && ownRows) return ownRows;
    if (window.PulsePlayAccessStreams && window.PulsePlayAccessStreams.length) return window.PulsePlayAccessStreams;
    return ownRows || [];
  }

  function dataReady() {
    if (previewing) return true;
    if (loadState === "ready") return true;
    return !!(window.PulsePlayAccessStreams && window.PulsePlayAccessStreams.length);
  }

  function visibleRows(rows) {
    var access = window.PulsePlayAccess;
    var scope = window.PulsePlayScope;
    var filters = window.PulsePlayStreamFilters;
    var out = [];
    var i;
    var row;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (filters && filters.isConcealed && filters.isConcealed(row)) continue;
      if (scope && scope.streamVisible && !scope.streamVisible(access, row)) continue;
      out.push(row);
    }
    return out;
  }

  function groundViews(list) {
    var api = window.PulsePlayGameSwitch;
    var out = [];
    var i;
    var slots;
    var slot;
    var ground;
    for (i = 0; i < list.length; i++) {
      ground = list[i];
      if (!ground) continue;
      slots = api && api.scoreList ? api.scoreList(ground) : [];
      slot = api && api.activeSlot ? api.activeSlot(slots) : null;
      out.push({
        id: ground.id,
        name: ground.name,
        activeBroadcastId: slot && slot.youtube_broadcast_id ? slot.youtube_broadcast_id : (ground.activeBroadcastId || "")
      });
    }
    return out;
  }

  function ensureDay() {
    var api = rules();
    var input = document.getElementById("day-date");
    if (!selectedDay) selectedDay = api ? api.chicagoDayKey(Date.now()) : "";
    if (input && !input.value) input.value = selectedDay;
    if (input && input.value && input.value !== selectedDay) selectedDay = input.value;
    return selectedDay;
  }

  function setDay(dayKey, refreshHealth) {
    var input = document.getElementById("day-date");
    selectedDay = dayKey || selectedDay;
    if (input && selectedDay) input.value = selectedDay;
    lastSignature = "";
    paint();
    if (refreshHealth && window.PulsePlayCommand && window.PulsePlayCommand.refresh) window.PulsePlayCommand.refresh();
  }

  function model() {
    var api = rules();
    var youtube = window.PulsePlayYouTube;
    var health = window.PulsePlayStreamHealth;
    var scope = window.PulsePlayScope;
    if (!api) return null;
    return api.buildBoard({
      streams: visibleRows(sourceRows()),
      grounds: groundViews(grounds()),
      now: previewing && previewNow != null ? previewNow : Date.now(),
      dayKey: ensureDay(),
      healthById: healthMap,
      convert: youtube && youtube.zonedLocalToIso,
      clock: youtube && youtube.zonedClock,
      classifyHealth: health && health.classifyStreamHealth,
      groundMatches: scope && scope.groundMatches
    });
  }

  function signature(board) {
    try { return JSON.stringify(board); } catch (error) { return ""; }
  }

  function addLine(parent, className, value) {
    var node;
    if (!value) return;
    node = el("p", className);
    setText(node, value);
    parent.appendChild(node);
  }

  function renderCard(item) {
    var card = el("article", "day-card day-card--" + item.section + (item.overdue ? " day-card--overdue" : ""));
    var top = el("div", "day-card__top");
    var badge = el("span", "day-badge day-badge--" + (item.tone || "muted"));
    var meta = [];
    card.setAttribute("data-section", item.section);
    card.setAttribute("data-id", item.id);
    if (item.division) {
      var division = el("span", "day-card__division");
      setText(division, item.division);
      top.appendChild(division);
    }
    setText(badge, item.badge || "");
    top.appendChild(badge);
    card.appendChild(top);
    addLine(card, "day-card__ground", item.groundName);
    addLine(card, "day-card__teams", item.teams);
    if (item.event) meta.push(item.event);
    if (item.startLabel) meta.push(item.startLabel);
    addLine(card, "day-card__start", meta.join(" · "));
    if (item.watchUrl) {
      var link = el("a", "day-card__watch");
      link.href = item.watchUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      setText(link, item.watchUrl);
      card.appendChild(link);
    }
    addLine(card, "day-card__detail", item.detail);
    return card;
  }

  function renderSection(board, id) {
    var items = board.sections[id] || [];
    var copy = COPY[id];
    var section;
    var grid;
    var i;
    var summary;
    var title;
    if (!items.length) return null;
    if (id === "completed") {
      section = el("details", "day-section day-section--done");
      section.id = "day-completed";
      if (completedOpen) section.open = true;
      summary = el("summary", "day-section__summary");
      setText(summary, copy.title + " · " + items.length);
      section.appendChild(summary);
    } else {
      section = el("section", "day-section day-section--" + id);
      section.setAttribute("aria-label", copy.title);
      title = el("h3", "day-section__title");
      setText(title, copy.title + " · " + items.length);
      section.appendChild(title);
      if (copy.blurb) addLine(section, "day-section__blurb", copy.blurb);
    }
    grid = el("div", "day-grid");
    for (i = 0; i < items.length; i++) grid.appendChild(renderCard(items[i]));
    section.appendChild(grid);
    return section;
  }

  function renderIdle(board) {
    var root = document.getElementById("day-idle");
    var grid;
    var i;
    var card;
    var title;
    var note;
    if (!root) return;
    clear(root);
    if (!dataReady() || !board.idle.length) return;
    title = el("h3", "day-idle__title");
    setText(title, "No games scheduled");
    root.appendChild(title);
    note = el("p", "hint");
    setText(note, "These grounds have no game on " + (board.heading || board.dayKey) + ".");
    root.appendChild(note);
    grid = el("div", "day-grid");
    for (i = 0; i < board.idle.length; i++) {
      card = el("article", "day-card day-card--idle");
      card.setAttribute("data-id", board.idle[i].id);
      addLine(card, "day-card__ground", board.idle[i].name);
      addLine(card, "day-card__idle", "No games scheduled");
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  function paintNote(board) {
    var note = document.getElementById("day-board-note");
    var when = document.getElementById("day-board-when");
    if (when && board) setText(when, board.heading || "");
    if (!note) return;
    if (errorMessage) {
      setText(note, errorMessage);
      return;
    }
    if (!dataReady() && !previewing) {
      setText(note, liveClient() ? "Loading games…" : "Sign in on the live admin site to load this day’s games.");
      return;
    }
    if (!board) return;
    setText(note, "");
  }

  function paint() {
    var root = document.getElementById("day-board-sections");
    var done;
    var board;
    var sig;
    var open;
    var i;
    var section;
    if (!root || !rules()) return;
    done = document.getElementById("day-completed");
    if (done) completedOpen = !!done.open;
    ensureDay();
    board = model();
    if (!board) return;
    paintNote(board);
    renderIdle(board);
    if (!dataReady() && !previewing) {
      clear(root);
      lastSignature = "";
      return;
    }
    sig = signature(board);
    if (sig && sig === lastSignature) return;
    lastSignature = sig;
    open = completedOpen;
    clear(root);
    for (i = 0; i < rules().SECTION_ORDER.length; i++) {
      section = renderSection(board, rules().SECTION_ORDER[i]);
      if (section) root.appendChild(section);
    }
    if (open) {
      done = document.getElementById("day-completed");
      if (done) done.open = true;
    }
    if (!root.firstChild) {
      var empty = el("p", "hint");
      setText(empty, "No games on " + (board.heading || board.dayKey) + ".");
      root.appendChild(empty);
    }
  }

  function broadcastIds() {
    var api = rules();
    var rows;
    var ids = [];
    var seen = {};
    var i;
    var id;
    if (!api) return ids;
    rows = visibleRows(sourceRows());
    for (i = 0; i < rows.length; i++) {
      if (api.rowDay && api.rowDay(rows[i]) !== ensureDay()) continue;
      if (!api.rowDay && String(rows[i].date || "").slice(0, 10) !== ensureDay()) continue;
      id = api.videoId(rows[i]);
      if (!id || seen[id]) continue;
      seen[id] = true;
      ids.push(id);
    }
    return ids;
  }

  function refreshStreams() {
    var supabase;
    if (previewing || !centerOpen()) return;
    if (loadState === "ready" && fetchedAt && Date.now() - fetchedAt < 20000) return;
    supabase = liveClient();
    if (!supabase || !supabase.from) {
      if (window.PulsePlayAccessStreams) {
        ownRows = window.PulsePlayAccessStreams;
        loadState = "ready";
        paint();
      } else {
        loadState = "offline";
        paint();
      }
      return;
    }
    if (busy) return;
    busy = true;
    if (loadState !== "ready") loadState = "loading";
    supabase.from("pp_streams").select(COLUMNS).order("date", { ascending: true }).then(function (result) {
      var rows;
      var beforeIds;
      busy = false;
      if (!centerOpen() && !previewing) return;
      if (result.error) {
        errorMessage = "Could not read games. " + (result.error.message || "Try Refresh live status.");
        if (!ownRows) loadState = "error";
        paint();
        return;
      }
      errorMessage = "";
      rows = result.data || [];
      if (window.PulsePlayScope && window.PulsePlayScope.streamVisible) {
        rows = rows.filter(function (row) {
          return window.PulsePlayScope.streamVisible(window.PulsePlayAccess, row);
        });
      }
      beforeIds = broadcastIds().join(",");
      ownRows = rows;
      loadState = "ready";
      fetchedAt = Date.now();
      paint();
      if (beforeIds !== broadcastIds().join(",") && window.PulsePlayCommand && window.PulsePlayCommand.refresh) {
        window.PulsePlayCommand.refresh();
      }
    }).catch(function () {
      busy = false;
      if (loadState !== "ready") {
        loadState = "error";
        errorMessage = "Could not read games. Try Refresh live status.";
        paint();
      }
    });
  }

  function onHealth(map) {
    if (previewing) return;
    healthMap = map || {};
    paint();
  }

  function bind() {
    var prev = document.getElementById("day-prev");
    var next = document.getElementById("day-next");
    var today = document.getElementById("day-today");
    var input = document.getElementById("day-date");
    var api = rules();
    if (!api || !input || input.getAttribute("data-bound") === "1") return;
    input.setAttribute("data-bound", "1");
    selectedDay = api.chicagoDayKey(Date.now());
    input.value = selectedDay;
    prev.onclick = function () { setDay(api.shiftDay(ensureDay(), -1), true); };
    next.onclick = function () { setDay(api.shiftDay(ensureDay(), 1), true); };
    today.onclick = function () { setDay(api.chicagoDayKey(Date.now()), true); };
    input.onchange = function () {
      if (input.value) setDay(input.value, true);
    };
  }

  function preview(input) {
    var field;
    previewing = true;
    previewRows = input && input.streams || [];
    previewGrounds = input && input.grounds || [];
    previewNow = input && input.now != null ? input.now : Date.now();
    healthMap = input && input.healthById || {};
    loadState = "ready";
    lastSignature = "";
    if (input && input.dayKey) selectedDay = input.dayKey;
    else if (rules()) selectedDay = rules().chicagoDayKey(previewNow);
    field = document.getElementById("day-date");
    if (field && selectedDay) field.value = selectedDay;
    paint();
  }

  bind();
  window.PulsePlayDayBoard = {
    paint: paint,
    refreshStreams: refreshStreams,
    onHealth: onHealth,
    broadcastIds: broadcastIds,
    preview: preview,
    setDay: setDay
  };
})();
