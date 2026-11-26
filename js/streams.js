/*
 * Default Streams list. Reads pp_streams and starts or ends the matching
 * YouTube broadcast. Ground and ad setup stays on the Setup tab.
 */
(function () {
  var rules = window.PulsePlayYouTube;
  var streams = [];
  var lifeById = {};
  var youtubeNote = "";
  var connected = false;
  var inflight = "";
  var loaded = false;

  var GROUND_IDS = {
    stanford: "stanfordu9",
    "cts west": "ctsu11",
    "4leaf east": "4leaf",
    "sycamore 2": "sycamore2",
    "sycamore 3": "sycamore3",
    sycamore3: "sycamore3",
    "pms-1": "pms1",
    pms1: "pms1",
    "pms-2": "pms2",
    pms2: "pms2",
    hpms: "hpms"
  };

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function liveClient() {
    if (window.PulsePlaySupabase && window.PulsePlaySupabase.get) return window.PulsePlaySupabase.get();
    return null;
  }

  function readError(error) {
    var context = error && error.context;
    var fallback = window.PulsePlayScope
      ? window.PulsePlayScope.explainFunctionError(error && error.message, "YouTube could not complete that request.")
      : (error && error.message ? error.message : "YouTube could not complete that request.");
    if (context && context.json) {
      return context.json().then(function (body) {
        return body && body.error ? body.error : fallback;
      }).catch(function () { return fallback; });
    }
    return Promise.resolve(fallback);
  }

  function invoke(body) {
    var supabase = liveClient();
    if (!supabase) return Promise.resolve({ error: "Sign in on the live admin site to start or end a broadcast." });
    return supabase.functions.invoke("youtube-broadcasts", { body: body }).then(function (result) {
      if (result.error) return readError(result.error).then(function (message) { return { error: message }; });
      return { data: result.data };
    });
  }

  function videoFromWatch(url) {
    var match = /[?&]v=([A-Za-z0-9_-]{6,64})/.exec(url || "");
    return match ? match[1] : "";
  }

  function whenIso(row) {
    if (!rules || !rules.zonedLocalToIso) return null;
    return rules.zonedLocalToIso(row.date, row.start_local, row.timezone);
  }

  function timeLine(row) {
    var iso = whenIso(row);
    var pacific = iso && rules.zonedClock(iso, rules.PACIFIC);
    var central = iso && rules.zonedClock(iso, rules.CHICAGO);
    if (row.timezone === "Central") {
      return (central ? central.timeLabel : row.start_local + " CT") + (pacific ? " · " + pacific.timeLabel : "");
    }
    return pacific ? pacific.timeLabel : row.start_local + " PT";
  }

  function dayKey(row) {
    var iso = whenIso(row);
    var clock = iso && rules.zonedClock(iso, rules.PACIFIC);
    return clock ? clock.dayKey : String(row.date || "");
  }

  function dayLabel(row) {
    var iso = whenIso(row);
    var clock = iso && rules.zonedClock(iso, rules.PACIFIC);
    return clock ? clock.dayLabel : String(row.date || "");
  }

  function lifeOf(row) {
    return lifeById[row.video_id] || row.status || "";
  }

  function isEnded(row) {
    var life = String(lifeOf(row)).toLowerCase();
    return life === "complete" || life === "revoked" || life === "ended";
  }

  function httpUrl(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    if (!/^https?:\/\//i.test(text)) return "";
    return text;
  }

  function matchTitle(row) {
    var teams = (row.team1 || "") + " vs " + (row.team2 || "");
    var code = window.PulsePlayStreamLabels ? window.PulsePlayStreamLabels.tournamentName(row) : "";
    return code ? code + " · " + teams : teams;
  }

  function copyText(text, button) {
    if (window.PulsePlayDevice && window.PulsePlayDevice.copyText) {
      window.PulsePlayDevice.copyText(text, button);
    }
  }

  function copyButton(text) {
    var node = document.createElement("button");
    node.type = "button";
    node.className = "btn-copy";
    node.setAttribute("data-label", "Copy");
    setText(node, "Copy");
    node.onclick = function () { copyText(text, node); };
    return node;
  }

  function groundList() {
    if (window.PulsePlayAdmin && window.PulsePlayAdmin.grounds) return window.PulsePlayAdmin.grounds() || [];
    return [];
  }

  function groundIdFor(name) {
    var key = String(name || "").toLowerCase();
    var list = groundList();
    var i;
    var ground;
    if (GROUND_IDS[key]) return GROUND_IDS[key];
    for (i = 0; i < list.length; i++) {
      ground = list[i];
      if (ground && String(ground.name || "").toLowerCase() === key) return ground.id;
      if (ground && String(ground.id || "").toLowerCase() === key.replace(/[^a-z0-9]/g, "")) return ground.id;
    }
    if (window.PulsePlayScope && window.PulsePlayScope.groundMatches) {
      for (i = 0; i < list.length; i++) {
        if (window.PulsePlayScope.groundMatches(list[i], { ground: name })) return list[i].id;
      }
    }
    return "";
  }

  function groundRecordFor(name) {
    var list = groundList();
    var id = groundIdFor(name);
    var i;
    for (i = 0; i < list.length; i++) {
      if (id && list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function overlayForRow(row) {
    if (!window.PulsePlayDevice || !window.PulsePlayDevice.streamOverlayUrl) return "";
    return window.PulsePlayDevice.streamOverlayUrl(row, groundRecordFor(row && row.ground));
  }

  function selectedDay() {
    var node = document.getElementById("streams-day");
    return node ? node.value : "upcoming";
  }

  function selectedGround() {
    var node = document.getElementById("streams-ground");
    return node ? node.value : "";
  }

  function filters() {
    return window.PulsePlayStreamFilters || null;
  }

  function showEnded() {
    var node = document.getElementById("streams-show-ended");
    return !!(node && node.getAttribute("aria-pressed") === "true");
  }

  function passesStreamFilters(row) {
    var api = filters();
    if (api && api.isConcealed(row)) return false;
    if (!showEnded() && isEnded(row)) return false;
    if (api && !api.eventMatches(row, api.current())) return false;
    return true;
  }

  function visibleRows() {
    var day = selectedDay();
    var ground = selectedGround();
    var today = rules.zonedClock(new Date().toISOString(), rules.PACIFIC);
    var out = [];
    var i;
    var row;
    var key;
    for (i = 0; i < streams.length; i++) {
      row = streams[i];
      if (!passesStreamFilters(row)) continue;
      if (ground && row.ground !== ground) continue;
      key = dayKey(row);
      if (day === "upcoming") {
        if (today && key && key < today.dayKey) continue;
      } else if (day && key !== day) continue;
      out.push(row);
    }
    out.sort(function (a, b) {
      var ak = dayKey(a) + "|" + a.ground + "|" + (whenIso(a) || "");
      var bk = dayKey(b) + "|" + b.ground + "|" + (whenIso(b) || "");
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });
    return out;
  }

  function hasOption(select, value) {
    var i;
    if (!select || !select.options) return false;
    for (i = 0; i < select.options.length; i++) if (select.options[i].value === value) return true;
    return false;
  }

  function fillFilters() {
    var daySelect = document.getElementById("streams-day");
    var groundSelect = document.getElementById("streams-ground");
    var dayValue = daySelect ? daySelect.value : "upcoming";
    var groundValue = groundSelect ? groundSelect.value : "";
    var days = {};
    var grounds = {};
    var i;
    var key;
    var list;
    var api = filters();
    var pool = [];
    if (api) api.paint(document.getElementById("streams-event"));
    if (!daySelect || !groundSelect) return;
    for (i = 0; i < streams.length; i++) {
      if (api && api.isConcealed(streams[i])) continue;
      if (api && !api.eventMatches(streams[i], api.current())) continue;
      pool.push(streams[i]);
    }
    for (i = 0; i < pool.length; i++) {
      key = dayKey(pool[i]);
      if (key) days[key] = dayLabel(pool[i]);
      if (pool[i].ground) grounds[pool[i].ground] = true;
    }
    daySelect.innerHTML = "";
    daySelect.appendChild(option("upcoming", "Today & upcoming"));
    list = Object.keys(days).sort();
    for (i = 0; i < list.length; i++) daySelect.appendChild(option(list[i], days[list[i]]));
    if (hasOption(daySelect, dayValue)) daySelect.value = dayValue;
    else daySelect.value = "upcoming";
    groundSelect.innerHTML = "";
    groundSelect.appendChild(option("", "All grounds"));
    list = Object.keys(grounds).sort();
    for (i = 0; i < list.length; i++) groundSelect.appendChild(option(list[i], list[i]));
    if (hasOption(groundSelect, groundValue)) groundSelect.value = groundValue;
    else groundSelect.value = "";
  }

  function option(value, text) {
    var node = document.createElement("option");
    node.value = value;
    setText(node, text);
    return node;
  }

  function paintNote() {
    var node = document.getElementById("streams-youtube");
    if (!node) return;
    if (!youtubeNote) {
      node.className = "broadcast-notice is-off";
      setText(node, "");
      return;
    }
    node.className = "broadcast-notice is-err";
    node.innerHTML = "";
    node.appendChild(document.createTextNode(youtubeNote + (isOperator() ? "" : " ")));
    if (isOperator()) return;
    var link = document.createElement("button");
    link.type = "button";
    setText(link, "Connect YouTube");
    link.onclick = function () {
      if (window.PulsePlayBroadcasts) {
        var tab = document.getElementById("tab-broadcasts");
        if (tab) tab.click();
      }
    };
    node.appendChild(link);
  }

  function paint() {
    var root = document.getElementById("streams-list");
    var rows = visibleRows();
    var i;
    var row;
    var lastDay = "";
    var lastGround = "";
    var card;
    var title;
    var meta;
    var watch;
    var overlay;
    var actions;
    var groundId;
    var ads;
    var busy;
    var life;
    if (!root) return;
    root.innerHTML = "";
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "hint";
      setText(empty, streams.length ? "No streams match these filters." : "No streams loaded.");
      root.appendChild(empty);
      return;
    }
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (dayKey(row) !== lastDay) {
        lastDay = dayKey(row);
        lastGround = "";
        var day = document.createElement("h3");
        day.className = "stream-day";
        setText(day, dayLabel(row));
        root.appendChild(day);
      }
      if (row.ground !== lastGround) {
        lastGround = row.ground;
        var ground = document.createElement("h4");
        ground.className = "stream-ground";
        setText(ground, row.ground);
        root.appendChild(ground);
      }
      card = document.createElement("article");
      card.className = "stream-row";
      title = document.createElement("p");
      title.className = "stream-title";
      var titleText = document.createElement("span");
      var scorecard = httpUrl(row.scorecard_url);
      var scoreLink;
      setText(titleText, matchTitle(row));
      title.appendChild(titleText);
      if (scorecard) {
        scoreLink = document.createElement("a");
        scoreLink.href = scorecard;
        scoreLink.target = "_blank";
        scoreLink.rel = "noopener noreferrer";
        setText(scoreLink, "Scorecard");
        title.appendChild(scoreLink);
        title.appendChild(copyButton(scorecard));
      }
      card.appendChild(title);
      meta = document.createElement("p");
      life = lifeOf(row);
      setText(meta, row.division + " · " + timeLine(row) + " · " + (row.stream_key || "No encoder") + " · " + (life ? rules.lifeCycleLabel(life) : "Not live"));
      card.appendChild(meta);
      watch = document.createElement("p");
      watch.className = "stream-link";
      var watchText = document.createElement("span");
      watchText.className = "broadcast-watch";
      setText(watchText, "https://www.youtube.com/watch?v=" + row.video_id);
      watch.appendChild(watchText);
      watch.appendChild(copyButton("https://www.youtube.com/watch?v=" + row.video_id));
      card.appendChild(watch);
      overlay = document.createElement("div");
      overlay.className = "stream-link stream-overlay";
      var overlayLabel = document.createElement("span");
      var overlayUrl = overlayForRow(row);
      var overlayLink;
      var overlayMissing;
      overlayLabel.className = "stream-overlay-label";
      setText(overlayLabel, "Web overlay");
      overlay.appendChild(overlayLabel);
      if (overlayUrl) {
        overlayLink = document.createElement("a");
        overlayLink.href = overlayUrl;
        overlayLink.target = "_blank";
        overlayLink.rel = "noopener noreferrer";
        setText(overlayLink, overlayUrl);
        overlay.appendChild(overlayLink);
        overlay.appendChild(copyButton(overlayUrl));
      } else {
        overlayMissing = document.createElement("span");
        setText(overlayMissing, "not set yet");
        overlay.appendChild(overlayMissing);
      }
      card.appendChild(overlay);
      actions = document.createElement("div");
      actions.className = "stream-actions broadcast-actions";
      busy = inflight === row.id;
      actions.appendChild(actionButton(busy ? "Working…" : "Start", "", busy || !!inflight, startRow(row)));
      actions.appendChild(actionButton(busy ? "Working…" : "End", "btn-danger", busy || !!inflight, endRow(row)));
      if (row.event === "PSD" && !isOperator()) {
        groundId = groundIdFor(row.ground);
        ads = document.createElement("button");
        ads.type = "button";
        setText(ads, groundId ? "Ads for this ground" : "No overlay ground yet");
        ads.disabled = !groundId;
        ads.onclick = (function (id) {
          return function () {
            if (id && window.PulsePlayAdmin) window.PulsePlayAdmin.openGround(id);
          };
        })(groundId);
        actions.appendChild(ads);
      }
      card.appendChild(actions);
      root.appendChild(card);
    }
  }

  function actionButton(label, className, disabled, onclick) {
    var node = document.createElement("button");
    node.type = "button";
    if (className) node.className = className;
    node.disabled = !!disabled;
    setText(node, label);
    node.onclick = onclick;
    return node;
  }

  function isOperator() {
    return window.PulsePlayAccess && window.PulsePlayAccess.role === "operator";
  }

  function startRow(row) {
    return function () {
      var iso;
      var copy;
      if (inflight) return;
      if (!connected && !isOperator()) {
        youtubeNote = "YouTube isn't connected.";
        paintNote();
        return;
      }
      iso = whenIso(row);
      if (rules.startNeedsConfirm(iso, Date.now())) {
        copy = rules.startConfirmCopy({
          title: row.team1 + " vs " + row.team2,
          scheduledStart: iso,
          streamKeyName: row.stream_key
        });
        if (!window.confirm(copy.body)) return;
      }
      go("start", row);
    };
  }

  function endRow(row) {
    return function () {
      if (inflight) return;
      if (!connected && !isOperator()) {
        youtubeNote = "YouTube isn't connected.";
        paintNote();
        return;
      }
      if (!window.confirm(rules.endConfirmCopy({ title: row.team1 + " vs " + row.team2 }).body)) return;
      go("end", row);
    };
  }

  function go(action, row) {
    inflight = row.id;
    paint();
    invoke({ action: action, broadcastId: row.video_id, streamId: row.id }).then(function (result) {
      inflight = "";
      if (result.error) {
        youtubeNote = result.error;
        if (/connect/i.test(result.error)) connected = false;
      } else {
        youtubeNote = "";
        connected = true;
        if (result.data && result.data.lifeCycle) lifeById[row.video_id] = result.data.lifeCycle;
      }
      paintNote();
      paint();
    });
  }

  function loadYouTube() {
    return invoke({ action: "list" }).then(function (result) {
      var list;
      var i;
      var id;
      lifeById = {};
      if (result.error) {
        connected = false;
        youtubeNote = /connect/i.test(result.error) ? "YouTube isn't connected." : result.error;
        return;
      }
      connected = !(result.data && result.data.connection && result.data.connection.needsReconnect);
      if (!connected) youtubeNote = "YouTube isn't connected.";
      else youtubeNote = "";
      list = result.data && result.data.broadcasts ? result.data.broadcasts : [];
      for (i = 0; i < list.length; i++) {
        id = videoFromWatch(list[i].watchUrl);
        if (id) lifeById[id] = list[i].lifeCycle;
      }
    });
  }

  function loadStreams() {
    var supabase = liveClient();
    var root = document.getElementById("streams-list");
    if (!supabase) {
      if (root) setText(root, "The streams list is on the live admin site after you sign in.");
      return;
    }
    supabase.from("pp_streams").select("*").order("date", { ascending: true }).then(function (result) {
      if (result.error) {
        if (root) setText(root, "Could not read streams. Apply the pp_streams migration, then reload. " + result.error.message);
        return;
      }
      streams = result.data || [];
      if (window.PulsePlayScope) {
        streams = streams.filter(function (row) {
          return window.PulsePlayScope.streamVisible(window.PulsePlayAccess, row);
        });
      }
      if (window.PulsePlayAdmin && window.PulsePlayAdmin.noteStreams) window.PulsePlayAdmin.noteStreams(streams);
      if (filters()) filters().noteRows(streams);
      fillFilters();
      if (isOperator()) {
        connected = true;
        paintNote();
        paint();
        return;
      }
      loadYouTube().then(function () {
        paintNote();
        paint();
      });
    });
  }

  function bind() {
    var day = document.getElementById("streams-day");
    var ground = document.getElementById("streams-ground");
    var ended = document.getElementById("streams-show-ended");
    if (day && day.getAttribute("data-bound") !== "1") {
      day.setAttribute("data-bound", "1");
      day.onchange = paint;
      if (ground) ground.onchange = paint;
      if (ended) ended.onclick = function () {
        var on = ended.getAttribute("aria-pressed") === "true";
        ended.setAttribute("aria-pressed", on ? "false" : "true");
        paint();
      };
      if (filters()) filters().onChange(function () {
        fillFilters();
        paint();
      });
    }
    fillFilters();
  }

  window.PulsePlayStreams = {
    show: function () {
      bind();
      if (!loaded) {
        loaded = true;
        loadStreams();
        return;
      }
      paintNote();
      paint();
    },
    preview: function (rows) {
      streams = rows || [];
      if (window.PulsePlayScope) {
        streams = streams.filter(function (row) {
          return window.PulsePlayScope.streamVisible(window.PulsePlayAccess, row);
        });
      }
      connected = true;
      if (filters()) filters().noteRows(streams);
      fillFilters();
      paint();
    }
  };
})();
