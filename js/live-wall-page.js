/*
 * Live Wall page. Read-only. Tiles stay muted. Players already on screen
 * are left in place when the live set changes; only new, gone, or
 * video-id changes touch an iframe. Hidden tabs drop the realtime
 * channel and their timers. Stalled players reload themselves.
 */
(function () {
  var rules = window.PulsePlayLiveWallRules;
  var slots = {};
  var rows = [];
  var lifeById = {};
  var qualities = {};
  var focusedId = "";
  var running = false;
  var sampleMode = false;
  var sampleInit = false;
  var subscribed = false;
  var channel = null;
  var channelOpening = false;
  var fetching = false;
  var fetchAgain = false;
  var failures = 0;
  var etag = "";
  var lastSignature = "";
  var pollTimer = null;
  var watchTimer = null;
  var cursorTimer = null;
  var wake = null;
  var pseudoEl = null;
  var apiQueue = [];
  var apiStarted = false;
  var lastYoutubeAt = 0;
  var burst = null;

  var QUALITIES = [
    ["auto", "Auto"],
    ["hd1080", "1080p"],
    ["hd720", "720p"],
    ["large", "480p"],
    ["medium", "360p"],
    ["small", "240p"]
  ];

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function queryValue(name) {
    var search = window.location.search || "";
    var parts;
    var i;
    var pair;
    var key;
    var value;
    if (search.charAt(0) === "?") search = search.substring(1);
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

  function client() {
    if (!window.PulsePlaySupabase || !window.PulsePlaySupabase.get) return null;
    return window.PulsePlaySupabase.get();
  }

  function tournamentName(row) {
    var api = window.PulsePlayStreamLabels;
    return api && api.tournamentName ? api.tournamentName(row) : "";
  }

  function convertStart(date, time, zone) {
    if (!window.PulsePlayYouTube || !window.PulsePlayYouTube.zonedLocalToIso) return "";
    return window.PulsePlayYouTube.zonedLocalToIso(date, time, zone) || "";
  }

  function isOperator() {
    return window.PulsePlayAccess && window.PulsePlayAccess.role === "operator";
  }

  function visibleRows(list) {
    if (!window.PulsePlayScope) return list || [];
    return (list || []).filter(function (row) {
      return window.PulsePlayScope.streamVisible(window.PulsePlayAccess, row);
    });
  }

  function forWall(list) {
    var api = window.PulsePlayStreamFilters;
    if (!api) return list || [];
    return api.visibleStreams(list, null, { event: api.current(), showEnded: true });
  }

  function trackRows() {
    var api = window.PulsePlayStreamFilters;
    if (sampleMode || !api) return;
    api.noteRows(rows);
  }

  function paintWallEvent() {
    var api = window.PulsePlayStreamFilters;
    if (api) api.paint(document.getElementById("wall-event"));
  }

  function lockMute(player) {
    if (!player) return;
    try { if (player.mute) player.mute(); } catch (e) {}
    try { if (player.setVolume) player.setVolume(0); } catch (e2) {}
  }

  function note(text) {
    setText(document.getElementById("wall-note"), text || "");
  }

  function statusLine(count) {
    var node = document.getElementById("wall-status");
    if (!node) return;
    if (sampleMode) setText(node, "Sample games for layout preview. Not the live list. Sound stays off.");
    else if (count) setText(node, count + (count === 1 ? " game" : " games") + " on the wall. Sound stays off.");
    else setText(node, "");
  }

  function whenApi(fn) {
    if (window.YT && window.YT.Player) { fn(); return; }
    apiQueue.push(fn);
    if (apiStarted) return;
    apiStarted = true;
    var prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      var queued;
      var i;
      if (typeof prior === "function") prior();
      queued = apiQueue.slice();
      apiQueue = [];
      for (i = 0; i < queued.length; i++) queued[i]();
    };
    var script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  }

  function applyQuality(slot) {
    var quality = qualities[slot.id] || "auto";
    if (!slot.player || quality === "auto" || !slot.player.setPlaybackQuality) return;
    try { slot.player.setPlaybackQuality(quality); } catch (e) {}
    lockMute(slot.player);
  }

  function harden(player) {
    var frame;
    lockMute(player);
    try { frame = player.getIframe(); } catch (e) { frame = null; }
    if (!frame) return;
    frame.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
    frame.setAttribute("allowfullscreen", "true");
    frame.setAttribute("playsinline", "1");
    frame.style.width = "100%";
    frame.style.height = "100%";
  }

  function showSlotNote(slot, text) {
    var node = slot.node.querySelector(".wall-slot-note");
    if (!node) return;
    node.classList.toggle("is-off", !text);
    setText(node, text || "");
  }

  function mount(slot) {
    var host;
    if (!slot || !slot.frame) return;
    if (slot.player && slot.player.destroy) {
      try { slot.player.destroy(); } catch (e) {}
      slot.player = null;
    }
    host = slot.frame.querySelector(".wall-player");
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = document.createElement("div");
    host.className = "wall-player";
    slot.frame.insertBefore(host, slot.frame.firstChild);
    whenApi(function () {
      if (!slots[slot.id] || slots[slot.id] !== slot) return;
      slot.player = new window.YT.Player(host, {
        videoId: slot.videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          mute: 1,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          origin: window.location.origin
        },
        events: {
          onReady: function (event) {
            harden(event.target);
            applyQuality(slot);
            try { event.target.playVideo(); } catch (e) {}
          },
          onStateChange: function (event) {
            harden(event.target);
            if (event.data === 1) {
              slot.stuckSince = 0;
              slot.attempts = 0;
            }
          },
          onError: function (event) {
            var code = event.data;
            if (code === 100 || code === 101 || code === 150) {
              slot.fatal = true;
              showSlotNote(slot, "This video cannot be embedded. Use the YouTube link.");
              return;
            }
            recover(slot.id);
          }
        }
      });
    });
  }

  function recover(id) {
    var slot = slots[id];
    var wait;
    if (!slot || slot.fatal || slot.recovering) return;
    slot.attempts = (slot.attempts || 0) + 1;
    if (slot.attempts > 5) {
      slot.fatal = true;
      showSlotNote(slot, "Playback paused after several errors. The next refresh tries again.");
      return;
    }
    wait = Math.min(60000, 4000 * Math.pow(2, slot.attempts - 1));
    slot.recovering = true;
    slot.stuckSince = 0;
    window.setTimeout(function () {
      if (!slots[id]) return;
      slots[id].recovering = false;
      slots[id].fatal = false;
      mount(slots[id]);
    }, wait);
  }

  function eachSlot(fn) {
    var id;
    for (id in slots) if (Object.prototype.hasOwnProperty.call(slots, id)) fn(slots[id]);
  }

  function pausePlayers() {
    eachSlot(function (slot) {
      if (!slot.player || !slot.player.pauseVideo) return;
      try { slot.player.pauseVideo(); } catch (e) {}
    });
  }

  function resumePlayers() {
    eachSlot(function (slot) {
      if (!slot.player || !slot.player.playVideo || slot.fatal) return;
      try { slot.player.playVideo(); } catch (e) {}
      lockMute(slot.player);
    });
  }

  function watchdog() {
    var now;
    if (!running || document.hidden) return;
    now = Date.now();
    eachSlot(function (slot) {
      var state;
      var time;
      if (!slot.player || slot.fatal || slot.recovering || !slot.player.getPlayerState) return;
      try { state = slot.player.getPlayerState(); } catch (e) { return; }
      lockMute(slot.player);
      if (state === 1) {
        try { time = slot.player.getCurrentTime(); } catch (e2) { time = null; }
        if (time != null && slot.lastTime != null && time - slot.lastTime < 0.3) {
          if (!slot.stuckSince) slot.stuckSince = now;
          if (now - slot.stuckSince > 25000) recover(slot.id);
        } else slot.stuckSince = 0;
        if (time != null) slot.lastTime = time;
      } else if (state === 3 || state === -1 || state === 5) {
        if (!slot.stuckSince) slot.stuckSince = now;
        if (now - slot.stuckSince > 25000) recover(slot.id);
      } else slot.stuckSince = 0;
    });
  }

  function link(href, label) {
    var node = document.createElement("a");
    node.href = href;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    setText(node, label);
    return node;
  }

  function fillMeta(slot, row) {
    var label = rules.tileLabel(row, tournamentName);
    var score = rules.scorecardUrl(row);
    var select;
    var i;
    var option;
    var button;
    slot.meta.innerHTML = "";
    var title = document.createElement("p");
    title.className = "wall-label";
    setText(title, label);
    slot.meta.appendChild(title);
    var actions = document.createElement("div");
    actions.className = "wall-actions";
    select = document.createElement("select");
    select.setAttribute("aria-label", "Quality for " + label + ". YouTube may ignore this.");
    select.title = "YouTube may ignore this quality.";
    for (i = 0; i < QUALITIES.length; i++) {
      option = document.createElement("option");
      option.value = QUALITIES[i][0];
      setText(option, QUALITIES[i][1]);
      select.appendChild(option);
    }
    select.value = qualities[slot.id] || "auto";
    select.onchange = function () {
      qualities[slot.id] = select.value;
      applyQuality(slot);
    };
    actions.appendChild(select);
    actions.appendChild(link(rules.watchUrl(slot.videoId), "YouTube"));
    if (score) actions.appendChild(link(score, "Scorecard"));
    button = document.createElement("button");
    button.type = "button";
    setText(button, "Fullscreen");
    button.onclick = function () { enterFs(slot.node); };
    actions.appendChild(button);
    slot.meta.appendChild(actions);
    var slotNote = document.createElement("p");
    slotNote.className = "wall-slot-note is-off";
    slot.meta.appendChild(slotNote);
    if (slot.hit) slot.hit.setAttribute("aria-label", "Highlight " + label);
  }

  function setFocused(id) {
    focusedId = focusedId === id ? "" : id;
    eachSlot(function (slot) {
      var on = slot.id === focusedId;
      slot.node.classList.toggle("is-focused", on);
      if (slot.hit) slot.hit.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function buildSlot(row) {
    var id = String(row.id);
    var video = rules.videoId(row);
    var node = document.createElement("article");
    var frame = document.createElement("div");
    var hit = document.createElement("button");
    var meta = document.createElement("div");
    var slot;
    node.className = "wall-tile";
    node.setAttribute("data-id", id);
    frame.className = "wall-frame";
    hit.type = "button";
    hit.className = "wall-hit";
    hit.setAttribute("aria-pressed", "false");
    hit.onclick = function () { setFocused(id); };
    frame.appendChild(hit);
    meta.className = "wall-meta";
    node.appendChild(frame);
    node.appendChild(meta);
    slot = { id: id, videoId: video, node: node, frame: frame, hit: hit, meta: meta, player: null, attempts: 0, fatal: false };
    slots[id] = slot;
    fillMeta(slot, row);
    if (focusedId === id) {
      node.classList.add("is-focused");
      hit.setAttribute("aria-pressed", "true");
    }
    var grid = document.getElementById("wall-grid");
    if (grid) grid.appendChild(node);
    mount(slot);
    return slot;
  }

  function applyGrid(count) {
    var grid = document.getElementById("wall-grid");
    var width = window.innerWidth || 1200;
    var layout;
    if (!grid) return;
    layout = rules.gridLayout(count, width);
    grid.setAttribute("data-layout", layout.layout);
    grid.setAttribute("data-columns", String(layout.columns));
    grid.style.setProperty("--wall-cols", String(layout.columns));
  }

  function renderRows(list) {
    var grid = document.getElementById("wall-empty") && document.getElementById("wall-grid");
    var empty = document.getElementById("wall-empty");
    var previous = [];
    var next = [];
    var diff;
    var i;
    var id;
    var row;
    var byId = {};
    var slot;
    if (!grid) return;
    for (id in slots) if (Object.prototype.hasOwnProperty.call(slots, id)) previous.push({ id: id, videoId: slots[id].videoId });
    for (i = 0; i < list.length; i++) {
      row = list[i];
      id = String(row.id);
      byId[id] = row;
      next.push({ id: id, videoId: rules.videoId(row) });
    }
    diff = rules.diffTiles(previous, next);
    for (i = 0; i < diff.remove.length; i++) {
      slot = slots[diff.remove[i]];
      if (!slot) continue;
      if (slot.player && slot.player.destroy) {
        try { slot.player.destroy(); } catch (e) {}
      }
      if (slot.node.parentNode) slot.node.parentNode.removeChild(slot.node);
      if (focusedId === slot.id) focusedId = "";
      delete slots[slot.id];
    }
    for (i = 0; i < diff.add.length; i++) buildSlot(byId[diff.add[i]]);
    for (i = 0; i < diff.replace.length; i++) {
      slot = slots[diff.replace[i]];
      if (!slot) continue;
      slot.videoId = rules.videoId(byId[slot.id]);
      slot.fatal = false;
      slot.attempts = 0;
      fillMeta(slot, byId[slot.id]);
      mount(slot);
    }
    for (i = 0; i < diff.keep.length; i++) {
      slot = slots[diff.keep[i]];
      if (slot) fillMeta(slot, byId[slot.id]);
    }
    for (i = 0; i < next.length; i++) {
      slot = slots[next[i].id];
      if (slot) grid.appendChild(slot.node);
    }
    applyGrid(list.length);
    if (empty) empty.classList.toggle("is-off", list.length > 0);
    grid.classList.toggle("is-off", list.length === 0);
    statusLine(list.length);
    var sampleButton = document.getElementById("wall-sample");
    if (sampleButton) setText(sampleButton, sampleMode ? "Show live games" : "Preview sample games");
  }

  function render() {
    var source = forWall(rows);
    var live = sampleMode ? source : rules.selectLive(source, Date.now(), lifeById, convertStart);
    renderRows(live);
  }

  function stopTimer() {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function wantsPoll() {
    if (sampleMode || document.hidden) return false;
    if (!window.PulsePlayTabs) return true;
    if (subscribed) return window.PulsePlayTabs.shouldSafetyPoll(true);
    return window.PulsePlayTabs.shouldPoll(false);
  }

  function arm() {
    var delay;
    if (!running || sampleMode) return;
    stopTimer();
    if (!wantsPoll()) {
      pollTimer = window.setTimeout(arm, 5000);
      return;
    }
    delay = rules.leaderPollDelay(failures, subscribed, Math.random);
    pollTimer = window.setTimeout(function () { fetchRows(); }, delay);
  }

  function publishRows() {
    var sig = rules.signature(rows, lifeById);
    lastSignature = sig;
    if (window.PulsePlayTabs) {
      window.PulsePlayTabs.publish({ type: "streams", rows: rows, lives: lifeById, signature: sig, at: Date.now() });
    }
  }

  function maybeYoutube(supabase) {
    if (sampleMode || isOperator() || !supabase || !supabase.functions) return;
    if (!window.PulsePlayTabs || !window.PulsePlayTabs.isLeader()) return;
    if (Date.now() - lastYoutubeAt < 120000) return;
    lastYoutubeAt = Date.now();
    supabase.functions.invoke("youtube-broadcasts", { body: { action: "list" } }).then(function (result) {
      var list;
      var i;
      var id;
      var next = {};
      if (!running || !result || result.error || !result.data) return;
      list = result.data.broadcasts || [];
      for (i = 0; i < list.length; i++) {
        id = rules.videoId({ video_id: list[i].watchUrl || list[i].id });
        if (id && list[i].lifeCycle) next[id] = list[i].lifeCycle;
      }
      lifeById = next;
      render();
      publishRows();
    }).catch(function () {});
  }

  function fetchRows() {
    var runtime = window.PulsePlayRuntime || {};
    var supabase = client();
    if (!running || sampleMode) return;
    if (!supabase || !runtime.supabaseUrl || !runtime.supabaseKey) {
      note("Sign in on the live admin site to load the wall.");
      renderRows([]);
      return;
    }
    if (fetching) { fetchAgain = true; return; }
    fetching = true;
    supabase.auth.getSession().then(function (result) {
      var session = result && result.data ? result.data.session : null;
      var headers;
      if (!session || !session.access_token) throw new Error("signed-out");
      headers = {
        apikey: runtime.supabaseKey,
        Authorization: "Bearer " + session.access_token,
        Accept: "application/json"
      };
      if (etag) headers["If-None-Match"] = etag;
      return window.fetch(runtime.supabaseUrl.replace(/\/$/, "") + "/rest/v1/pp_streams?select=" + rules.STREAM_COLUMNS + "&order=date.asc", { headers: headers });
    }).then(function (response) {
      if (response.status === 304) return { unchanged: true };
      if (!response.ok) throw new Error("status " + response.status);
      etag = response.headers.get("etag") || etag;
      return response.json().then(function (data) { return { rows: data || [] }; });
    }).then(function (result) {
      fetching = false;
      if (!running || sampleMode) return;
      failures = 0;
      if (!result || result.unchanged) {
        note("");
        if (fetchAgain) { fetchAgain = false; fetchRows(); return; }
        arm();
        return;
      }
      rows = visibleRows(result.rows);
      trackRows();
      if (rules.signature(rows, lifeById) !== lastSignature) {
        render();
        publishRows();
      }
      note("");
      maybeYoutube(supabase);
      if (fetchAgain) { fetchAgain = false; fetchRows(); return; }
      arm();
    }).catch(function (err) {
      fetching = false;
      if (!running || sampleMode) return;
      if (err && err.message === "signed-out") {
        note("Sign in again to load the live wall.");
        if (fetchAgain) { fetchAgain = false; fetchRows(); return; }
        arm();
        return;
      }
      failures = Math.min(6, failures + 1);
      note("Connection hiccup. Showing the last live games.");
      if (fetchAgain) { fetchAgain = false; fetchRows(); return; }
      arm();
    });
  }

  function closeChannel() {
    var supabase = client();
    subscribed = false;
    channelOpening = false;
    if (channel && supabase && supabase.removeChannel) {
      try { supabase.removeChannel(channel); } catch (e) {}
    }
    channel = null;
  }

  function openChannel() {
    var supabase = client();
    if (channel || channelOpening || sampleMode || !running || document.hidden || !supabase || !supabase.channel) return;
    channelOpening = true;
    supabase.auth.getSession().then(function (result) {
      var session = result && result.data ? result.data.session : null;
      channelOpening = false;
      if (!running || sampleMode || document.hidden || channel) return;
      if (session && session.access_token && supabase.realtime && supabase.realtime.setAuth) {
        supabase.realtime.setAuth(session.access_token);
      }
      channel = supabase.channel("pulseplay-pp-streams");
      channel.on("postgres_changes", { event: "*", schema: "public", table: "pp_streams" }, function (payload) {
        burst.push(payload, onBurst);
      });
      channel.subscribe(function (status) {
        subscribed = status === "SUBSCRIBED";
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") subscribed = false;
        arm();
      });
    }).catch(function () {});
  }

  function onBurst(batch) {
    var changes = [];
    var refetch = false;
    var i;
    var change;
    for (i = 0; i < batch.length; i++) {
      change = rules.changeFromPayload(batch[i]);
      if (!change) continue;
      if (change.event === "REFETCH") refetch = true;
      changes.push(change);
    }
    if (refetch) { fetchRows(); return; }
    rows = visibleRows(rules.applyChanges(rows, rules.coalesceChanges(changes)));
    trackRows();
    render();
    if (window.PulsePlayTabs && window.PulsePlayTabs.isLeader()) publishRows();
  }

  function acquireWake() {
    if (!navigator.wakeLock || document.hidden || wake) return;
    navigator.wakeLock.request("screen").then(function (sentinel) {
      wake = sentinel;
      sentinel.addEventListener("release", function () { wake = null; });
    }).catch(function () {});
  }

  function releaseWake() {
    var current = wake;
    wake = null;
    if (current && current.release) current.release().catch(function () {});
  }

  function setKiosk(on) {
    var button = document.getElementById("wall-kiosk");
    document.body.classList.toggle("wall-kiosk", !!on);
    if (button) setText(button, on ? "Show chrome" : "Hide chrome");
    if (!on) document.body.classList.remove("wall-idle");
    else pokeCursor();
  }

  function pokeCursor() {
    if (cursorTimer) window.clearTimeout(cursorTimer);
    document.body.classList.remove("wall-idle");
    if (!document.body.classList.contains("wall-kiosk")) return;
    cursorTimer = window.setTimeout(function () {
      document.body.classList.add("wall-idle");
    }, 2500);
  }

  function enterPseudo(el) {
    exitPseudo();
    pseudoEl = el;
    el.classList.add("is-pseudo-fs");
    document.body.classList.add("wall-pseudo");
    var exit = document.getElementById("wall-exit-fs");
    if (exit) exit.classList.remove("is-off");
  }

  function exitPseudo() {
    if (pseudoEl) pseudoEl.classList.remove("is-pseudo-fs");
    pseudoEl = null;
    document.body.classList.remove("wall-pseudo");
    var exit = document.getElementById("wall-exit-fs");
    if (exit) exit.classList.add("is-off");
  }

  function enterNative(el) {
    var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitEnterFullscreen;
    if (!fn) return Promise.reject(new Error("unavailable"));
    try {
      var result = fn.call(el);
      if (result && result.then) return result;
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function enterFs(el) {
    var finished = false;
    function fallback() {
      if (finished) return;
      finished = true;
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      enterPseudo(el);
    }
    if (!el) return;
    enterNative(el).then(function () {
      window.setTimeout(fallback, 300);
    }).catch(fallback);
  }

  function useSample(on) {
    sampleMode = !!on;
    etag = "";
    if (sampleMode) {
      closeChannel();
      stopTimer();
      rows = rules.sampleRows();
      lifeById = {};
      note("");
      render();
      return;
    }
    rows = [];
    renderRows([]);
    note("");
    if (running) {
      openChannel();
      fetchRows();
    }
  }

  function bind() {
    var kiosk = document.getElementById("wall-kiosk");
    var full = document.getElementById("wall-fullscreen");
    var sample = document.getElementById("wall-sample");
    var exit = document.getElementById("wall-exit-fs");
    if (document.body.getAttribute("data-wall-bound") === "1") return;
    document.body.setAttribute("data-wall-bound", "1");
    if (window.PulsePlayStreamFilters) {
      window.PulsePlayStreamFilters.onChange(function () {
        paintWallEvent();
        if (running) render();
      });
    }
    if (kiosk) kiosk.onclick = function () { setKiosk(!document.body.classList.contains("wall-kiosk")); };
    if (full) full.onclick = function () { enterFs(document.getElementById("wall-grid")); };
    if (sample) sample.onclick = function () { useSample(!sampleMode); };
    if (exit) exit.onclick = exitPseudo;
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") exitPseudo();
    });
    document.addEventListener("mousemove", pokeCursor);
    document.addEventListener("touchstart", pokeCursor, { passive: true });
    window.addEventListener("resize", function () {
      if (!running) return;
      applyGrid(document.querySelectorAll("#wall-grid .wall-tile").length);
    });
    document.addEventListener("visibilitychange", function () {
      if (!running) return;
      if (document.hidden) {
        pausePlayers();
        closeChannel();
        stopTimer();
        releaseWake();
        return;
      }
      acquireWake();
      resumePlayers();
      if (!sampleMode) {
        openChannel();
        fetchRows();
      }
    });
    window.addEventListener("online", function () {
      if (!running || document.hidden || sampleMode) return;
      failures = 0;
      fetchRows();
    });
    if (window.PulsePlayTabs) {
      window.PulsePlayTabs.listen(function (msg) {
        if (!msg || msg.type !== "streams" || sampleMode || !running) return;
        if (window.PulsePlayTabs.isLeader()) return;
        if (msg.signature && msg.signature === lastSignature) return;
        rows = visibleRows(msg.rows || []);
        trackRows();
        lifeById = msg.lives || {};
        lastSignature = msg.signature || rules.signature(rows, lifeById);
        render();
      });
      window.PulsePlayTabs.onChange(function () {
        if (running && !sampleMode) arm();
      });
    }
    var supabase = client();
    if (supabase && supabase.auth && supabase.auth.onAuthStateChange) {
      supabase.auth.onAuthStateChange(function (event, session) {
        if (event === "TOKEN_REFRESHED" && session && supabase.realtime && supabase.realtime.setAuth) {
          supabase.realtime.setAuth(session.access_token);
        }
      });
    }
  }

  function startWatch() {
    if (watchTimer) return;
    watchTimer = window.setInterval(watchdog, 10000);
  }

  function stopWatch() {
    if (watchTimer) window.clearInterval(watchTimer);
    watchTimer = null;
  }

  if (!burst) {
    burst = rules.createBurst(400, function (fn, ms) { return window.setTimeout(fn, ms); }, function (id) { window.clearTimeout(id); });
  }

  window.PulsePlayLiveWall = {
    show: function () {
      running = true;
      bind();
      if (!sampleInit) {
        sampleInit = true;
        if (queryValue("wall") === "sample") sampleMode = true;
        if (queryValue("kiosk") === "1") setKiosk(true);
      }
      acquireWake();
      startWatch();
      paintWallEvent();
      if (sampleMode) {
        rows = rules.sampleRows();
        lifeById = {};
        render();
        return;
      }
      resumePlayers();
      if (rows.length) render();
      openChannel();
      fetchRows();
    },
    hide: function () {
      running = false;
      pausePlayers();
      closeChannel();
      stopTimer();
      stopWatch();
      releaseWake();
    }
  };
})();
