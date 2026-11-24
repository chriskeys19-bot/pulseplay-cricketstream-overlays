/*
 * Broadcasts tab. Lists CricketCrazeUSA live broadcasts and starts or ends
 * them. The refresh token never comes to this page.
 */
(function () {
  var rules = window.PulsePlayYouTube;
  var rows = [];
  var connection = null;
  var filter = "upcoming";
  var inflight = "";
  var loaded = false;
  var notice = "";
  var noticeKind = "";

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function queryValue(name) {
    var search = window.location.search;
    var parts;
    var i;
    var pair;
    var key;
    var value;
    if (!search) return "";
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

  function liveClient() {
    if (window.PulsePlaySupabase && window.PulsePlaySupabase.get) return window.PulsePlaySupabase.get();
    return null;
  }

  function readError(error) {
    var context = error && error.context;
    var fallback = window.PulsePlayScope
      ? window.PulsePlayScope.explainFunctionError(error && error.message, "YouTube could not complete that request.")
      : "YouTube could not complete that request.";
    if (context && context.json) {
      return context.json().then(function (body) {
        var message = body && body.error ? body.error : fallback;
        return { message: message, body: body };
      }).catch(function () {
        return { message: fallback, body: null };
      });
    }
    return Promise.resolve({
      message: error && error.message
        ? (window.PulsePlayScope ? window.PulsePlayScope.explainFunctionError(error.message, fallback) : error.message)
        : fallback,
      body: null
    });
  }

  function invoke(name, body) {
    var supabase = liveClient();
    if (!supabase) return Promise.resolve({ error: "YouTube controls need the live Supabase sign-in. Add nothing to the address and sign in as an admin." });
    return supabase.functions.invoke(name, { body: body }).then(function (result) {
      if (result.error) return readError(result.error).then(function (parsed) { return { error: parsed.message, data: parsed.body }; });
      return { data: result.data };
    });
  }

  function setNotice(kind, text) {
    noticeKind = kind || "";
    notice = text || "";
    paintNotice();
  }

  function paintNotice() {
    var node = document.getElementById("broadcast-notice");
    if (!node) return;
    node.className = "broadcast-notice" + (notice ? "" : " is-off") + (noticeKind === "ok" ? " is-ok" : "") + (noticeKind === "err" ? " is-err" : "");
    setText(node, notice);
  }

  function paintConnection() {
    var label = document.getElementById("broadcast-connection");
    var connect = document.getElementById("broadcast-connect");
    var text = "YouTube is not connected.";
    if (!label) return;
    if (!liveClient()) {
      setText(label, "YouTube controls are on the live admin site, after you sign in.");
      if (connect) connect.disabled = true;
      return;
    }
    if (connection && connection.connected && !connection.needsReconnect) {
      text = "Connected" + (connection.channelTitle ? " as " + connection.channelTitle : "") + ".";
    } else if (connection && connection.needsReconnect) {
      text = connection.message || "The YouTube connection needs to be renewed.";
    } else if (connection && connection.message) {
      text = connection.message;
    }
    setText(label, text);
    if (connect) {
      var fullAdmin = !window.PulsePlayAccess || window.PulsePlayAccess.fullAdmin !== false;
      var test = document.getElementById("broadcast-test");
      connect.classList.toggle("is-off", !fullAdmin);
      if (test) test.classList.toggle("is-off", !fullAdmin);
      connect.disabled = !fullAdmin;
      setText(connect, connection && connection.connected ? "Reconnect YouTube" : "Connect YouTube");
    }
  }

  function button(label, className, disabled, onclick) {
    var node = document.createElement("button");
    node.type = "button";
    node.className = className || "";
    node.disabled = !!disabled;
    setText(node, label);
    node.onclick = onclick;
    return node;
  }

  function paintRows() {
    var root = document.getElementById("broadcast-list");
    var groups;
    var i;
    var j;
    var group;
    var row;
    var day;
    var card;
    var title;
    var times;
    var pacific;
    var central;
    var status;
    var key;
    var watch;
    var actions;
    var busy;
    if (!root || !rules) return;
    root.innerHTML = "";
    groups = rules.groupBroadcasts(rows, filter, Date.now());
    if (!groups.length) {
      var empty = document.createElement("p");
      empty.className = "hint";
      setText(empty, "No broadcasts in this view.");
      root.appendChild(empty);
      return;
    }
    for (i = 0; i < groups.length; i++) {
      group = groups[i];
      day = document.createElement("h3");
      day.className = "broadcast-day";
      setText(day, group.dayLabel);
      root.appendChild(day);
      for (j = 0; j < group.rows.length; j++) {
        row = group.rows[j];
        card = document.createElement("article");
        card.className = "broadcast-row";
        title = document.createElement("h4");
        setText(title, row.title);
        card.appendChild(title);
        times = document.createElement("p");
        pacific = row.scheduledStart ? rules.zonedClock(row.scheduledStart, rules.PACIFIC) : null;
        central = row.scheduledStart ? rules.zonedClock(row.scheduledStart, rules.CHICAGO) : null;
        setText(times, (pacific ? pacific.timeLabel : "No scheduled time") + (central ? " · " + central.timeLabel + " Central" : ""));
        card.appendChild(times);
        status = document.createElement("p");
        setText(status, rules.lifeCycleLabel(row.lifeCycle));
        card.appendChild(status);
        if (row.streamKeyName) {
          key = document.createElement("p");
          setText(key, "Stream key: " + row.streamKeyName);
          card.appendChild(key);
        }
        watch = document.createElement("p");
        watch.className = "broadcast-watch";
        setText(watch, row.watchUrl);
        card.appendChild(watch);
        actions = document.createElement("div");
        actions.className = "broadcast-actions";
        busy = inflight === row.id;
        if (rules.canStartBroadcast(row.lifeCycle)) {
          actions.appendChild(button(busy ? "Working…" : "Start", "", busy || !!inflight, startClick(row)));
        }
        if (rules.canEndBroadcast(row.lifeCycle)) {
          actions.appendChild(button(busy ? "Working…" : "End", "btn-danger", busy || !!inflight, endClick(row)));
        }
        card.appendChild(actions);
        root.appendChild(card);
      }
    }
  }

  function startClick(row) {
    return function () {
      var copy;
      if (inflight) return;
      if (rules.startNeedsConfirm(row.scheduledStart, Date.now())) {
        copy = rules.startConfirmCopy(row);
        if (!window.confirm(copy.body)) return;
      }
      transition("start", row);
    };
  }

  function endClick(row) {
    return function () {
      var copy;
      if (inflight) return;
      copy = rules.endConfirmCopy(row);
      if (!window.confirm(copy.body)) return;
      transition("end", row);
    };
  }

  function transition(action, row) {
    inflight = row.id;
    paintRows();
    setNotice("", "");
    invoke("youtube-broadcasts", { action: action, broadcastId: row.id }).then(function (result) {
      inflight = "";
      if (result.data && result.data.connection) connection = result.data.connection;
      if (result.error) {
        setNotice("err", result.error);
        paintConnection();
        paintRows();
        return;
      }
      setNotice("ok", result.data && result.data.message ? result.data.message : "YouTube updated the broadcast.");
      paintConnection();
      loadList();
    });
  }

  function paintFilters() {
    var buttons = document.getElementById("broadcast-filters");
    var nodes;
    var i;
    if (!buttons) return;
    nodes = buttons.getElementsByTagName("button");
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute("aria-pressed", nodes[i].getAttribute("data-filter") === filter ? "true" : "false");
    }
  }

  function loadList() {
    setNotice(noticeKind, notice);
    invoke("youtube-broadcasts", { action: "list" }).then(function (result) {
      if (result.data && result.data.connection) connection = result.data.connection;
      if (result.error) {
        rows = result.data && result.data.broadcasts ? result.data.broadcasts : rows;
        setNotice("err", result.error);
      } else {
        rows = result.data && result.data.broadcasts ? result.data.broadcasts : [];
      }
      paintConnection();
      paintFilters();
      paintRows();
    });
  }

  function show() {
    var reason = queryValue("youtube") === "error" ? queryValue("reason") : "";
    paintFilters();
    if (!loaded) {
      loaded = true;
      if (queryValue("youtube") === "connected") setNotice("ok", rules.oauthFlagMessage(null, true));
      else if (queryValue("youtube") === "error") setNotice("err", rules.oauthFlagMessage(reason, false));
    }
    if (!liveClient()) {
      paintConnection();
      paintRows();
      return;
    }
    loadList();
  }

  function connect() {
    var buttonNode = document.getElementById("broadcast-connect");
    if (buttonNode) buttonNode.disabled = true;
    setNotice("", "Opening Google…");
    invoke("youtube-oauth-start", {}).then(function (result) {
      if (buttonNode) buttonNode.disabled = false;
      if (result.error || !result.data || !result.data.url) {
        setNotice("err", result.error || "YouTube could not be connected. Try again.");
        return;
      }
      window.location.href = result.data.url;
    });
  }

  function testConnection() {
    var buttonNode = document.getElementById("broadcast-test");
    if (buttonNode) buttonNode.disabled = true;
    setNotice("", "Testing the YouTube connection…");
    invoke("youtube-broadcasts", { action: "test" }).then(function (result) {
      if (buttonNode) buttonNode.disabled = false;
      if (result.data && result.data.connection) connection = result.data.connection;
      paintConnection();
      if (result.error) setNotice("err", result.error);
      else setNotice("ok", result.data && result.data.message ? result.data.message : "YouTube responded.");
    });
  }

  function bind() {
    var filters = document.getElementById("broadcast-filters");
    var connectButton = document.getElementById("broadcast-connect");
    var testButton = document.getElementById("broadcast-test");
    var nodes;
    var i;
    if (!filters || filters.getAttribute("data-bound") === "1") return;
    filters.setAttribute("data-bound", "1");
    nodes = filters.getElementsByTagName("button");
    for (i = 0; i < nodes.length; i++) {
      nodes[i].onclick = function () {
        filter = this.getAttribute("data-filter") || "upcoming";
        paintFilters();
        paintRows();
      };
    }
    if (connectButton) connectButton.onclick = connect;
    if (testButton) testButton.onclick = testConnection;
  }

  window.PulsePlayBroadcasts = {
    show: function () {
      bind();
      show();
    }
  };
})();
