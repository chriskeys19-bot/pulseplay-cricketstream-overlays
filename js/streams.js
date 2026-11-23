/*
 * Default Streams list. Reads pp_streams and starts or ends the matching
 * YouTube broadcast. Ground and ad setup stays on the Setup tab.
 */
(function () {
  var rules = window.PulsePlayYouTube;
  var client = null;
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
    "pms-1": "pms1",
    pms1: "pms1"
  };

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function liveClient() {
    var runtime = window.PulsePlayRuntime || {};
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) return null;
    if (runtime.adapter !== "supabase" || !runtime.supabaseUrl || !runtime.supabaseKey) return null;
    client = window.supabase.createClient(runtime.supabaseUrl, runtime.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return client;
  }

  function readError(error) {
    var context = error && error.context;
    if (context && context.json) {
      return context.json().then(function (body) {
        return body && body.error ? body.error : "YouTube could not complete that request.";
      }).catch(function () { return "YouTube could not complete that request."; });
    }
    return Promise.resolve(error && error.message ? error.message : "YouTube could not complete that request.");
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

  function groundIdFor(name) {
    var key = String(name || "").toLowerCase();
    var list;
    var i;
    var ground;
    if (GROUND_IDS[key]) return GROUND_IDS[key];
    list = window.PulsePlayAdmin && window.PulsePlayAdmin.grounds ? window.PulsePlayAdmin.grounds() : [];
    for (i = 0; i < list.length; i++) {
      ground = list[i];
      if (ground && String(ground.name || "").toLowerCase() === key) return ground.id;
      if (ground && String(ground.id || "").toLowerCase() === key.replace(/[^a-z0-9]/g, "")) return ground.id;
    }
    return "";
  }

  function selectedDay() {
    var node = document.getElementById("streams-day");
    return node ? node.value : "upcoming";
  }

  function selectedGround() {
    var node = document.getElementById("streams-ground");
    return node ? node.value : "";
  }

  function hideEnded() {
    var node = document.getElementById("streams-hide-ended");
    return !node || node.checked;
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
      if (hideEnded() && isEnded(row)) continue;
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
    if (!daySelect || !groundSelect) return;
    for (i = 0; i < streams.length; i++) {
      key = dayKey(streams[i]);
      if (key) days[key] = dayLabel(streams[i]);
      if (streams[i].ground) grounds[streams[i].ground] = true;
    }
    daySelect.innerHTML = "";
    daySelect.appendChild(option("upcoming", "Today & upcoming"));
    list = Object.keys(days).sort();
    for (i = 0; i < list.length; i++) daySelect.appendChild(option(list[i], days[list[i]]));
    if (dayValue) daySelect.value = dayValue;
    groundSelect.innerHTML = "";
    groundSelect.appendChild(option("", "All grounds"));
    list = Object.keys(grounds).sort();
    for (i = 0; i < list.length; i++) groundSelect.appendChild(option(list[i], list[i]));
    if (groundValue) groundSelect.value = groundValue;
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
      setText(title, row.team1 + " vs " + row.team2);
      card.appendChild(title);
      meta = document.createElement("p");
      life = lifeOf(row);
      setText(meta, row.division + " · " + timeLine(row) + " · " + (row.stream_key || "No encoder") + " · " + (life ? rules.lifeCycleLabel(life) : "Not live"));
      card.appendChild(meta);
      watch = document.createElement("p");
      watch.className = "broadcast-watch";
      setText(watch, "https://www.youtube.com/watch?v=" + row.video_id);
      card.appendChild(watch);
      overlay = document.createElement("p");
      setText(overlay, "Overlay: " + (row.overlay_url || "not set yet"));
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
    var ended = document.getElementById("streams-hide-ended");
    if (day && day.getAttribute("data-bound") !== "1") {
      day.setAttribute("data-bound", "1");
      day.onchange = paint;
      ground.onchange = paint;
      ended.onchange = paint;
    }
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
    }
  };
})();
