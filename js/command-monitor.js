/*
 * Command Center live monitors.
 * YouTube health polls youtube-broadcasts action "health" about every 25s.
 * CricClubs scores poll about every 18s. Both pause while the tab is hidden
 * or Command Center is not the open panel.
 */
(function () {
  var HEALTH_MS = 25000;
  var SCORE_MS = 18000;
  var CATALOG_MS = 60000;
  var healthTimer = null;
  var scoreTimer = null;
  var healthBusy = false;
  var scoreBusy = false;
  var healthAgain = false;
  var scoreAgain = false;
  var healthBackoffUntil = 0;
  var lastHealth = {};
  var lastScore = {};
  var scoreKeys = {};
  var catalog = [];
  var catalogAt = 0;
  var catalogBusy = false;

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function centerOpen() {
    var panel = document.getElementById("panel-center");
    return !!(panel && !panel.classList.contains("is-off") && document.visibilityState !== "hidden");
  }

  function grounds() {
    if (window.PulsePlayAdmin && window.PulsePlayAdmin.grounds) return window.PulsePlayAdmin.grounds() || [];
    return [];
  }

  function liveClient() {
    if (window.PulsePlaySupabase && window.PulsePlaySupabase.get) return window.PulsePlaySupabase.get();
    return null;
  }

  function readError(error) {
    var context = error && error.context;
    var fallback = error && error.message ? error.message : "YouTube could not complete that request.";
    if (context && context.json) {
      return context.json().then(function (body) {
        return body && body.error ? body.error : fallback;
      }).catch(function () { return fallback; });
    }
    return Promise.resolve(fallback);
  }

  function invoke(body) {
    var supabase = liveClient();
    if (!supabase || !supabase.functions) return Promise.resolve({ error: "Sign in on the live admin site to check YouTube." });
    return supabase.functions.invoke("youtube-broadcasts", { body: body }).then(function (result) {
      if (result.error) return readError(result.error).then(function (message) { return { error: message }; });
      return { data: result.data };
    });
  }

  function broadcastIdFor(ground) {
    var rules = window.PulsePlayGameSwitch;
    var list;
    var slot;
    var streams;
    var i;
    var row;
    var status;
    if (!ground) return "";
    if (rules) {
      list = rules.scoreList(ground);
      slot = rules.activeSlot(list);
      if (slot && slot.youtube_broadcast_id) return slot.youtube_broadcast_id;
    }
    streams = window.PulsePlayAccessStreams || [];
    if (!window.PulsePlayScope || !window.PulsePlayScope.groundMatches) return "";
    for (i = 0; i < streams.length; i++) {
      row = streams[i];
      if (!window.PulsePlayScope.groundMatches(ground, row)) continue;
      status = String(row && row.status || "").toLowerCase();
      if (status === "live" && row.video_id) return String(row.video_id);
    }
    return "";
  }

  function cardFor(id) {
    var cards = document.getElementsByClassName("card");
    var i;
    for (i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-id") === id) return cards[i];
    }
    return null;
  }

  function child(parent, className) {
    var nodes;
    if (!parent) return null;
    nodes = parent.getElementsByClassName(className);
    return nodes.length ? nodes[0] : null;
  }

  function setNote(text) {
    var node = document.getElementById("live-monitor-note");
    setText(node, text || "");
  }

  function paintHealth() {
    var list = grounds();
    var i;
    var ground;
    var id;
    var row;
    var view;
    var card;
    var box;
    var label;
    var detail;
    var tone;
    for (i = 0; i < list.length; i++) {
      ground = list[i];
      card = cardFor(ground.id);
      box = child(card, "card__health");
      if (!box) continue;
      id = broadcastIdFor(ground);
      row = id ? lastHealth[id] : null;
      if (!id) view = { tone: "muted", label: "No broadcast", detail: "" };
      else if (!row) view = { tone: "muted", label: "Checking stream…", detail: "" };
      else if (window.PulsePlayStreamHealth) view = window.PulsePlayStreamHealth.classifyStreamHealth(row);
      else view = { tone: "muted", label: "No broadcast", detail: "" };
      tone = view.tone || "muted";
      box.className = "card__health card__health--" + tone;
      label = child(box, "card__health-label");
      detail = child(box, "card__health-detail");
      setText(label, view.label || "");
      setText(detail, view.detail || "");
      if (detail) {
        if (view.detail) detail.classList.remove("is-off");
        else detail.classList.add("is-off");
      }
    }
    if (window.PulsePlayDayBoard && window.PulsePlayDayBoard.onHealth) window.PulsePlayDayBoard.onHealth(lastHealth);
  }

  function clearAlert(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function clearOutline(card) {
    if (!card || !card.classList) return;
    if (card.classList.contains("card--break")) card.classList.remove("card--break");
    if (card.classList.contains("card--drinks")) card.classList.remove("card--drinks");
  }

  function activeSlotFor(ground) {
    var rules = window.PulsePlayGameSwitch;
    if (!rules || !rules.scoreList || !rules.activeSlot) return null;
    return rules.activeSlot(rules.scoreList(ground));
  }

  function scoreHint(ground) {
    var clubs = window.PulsePlayCricClubs;
    if (!clubs || !clubs.groundHint) return null;
    return clubs.groundHint(ground, activeSlotFor(ground));
  }

  function paintScores() {
    var list = grounds();
    var clubs = window.PulsePlayCricClubs;
    var i;
    var ground;
    var source;
    var view;
    var card;
    var line;
    var alert;
    var phase;
    var copy;
    var button;
    for (i = 0; i < list.length; i++) {
      ground = list[i];
      card = cardFor(ground.id);
      if (!card) continue;
      line = child(card, "card__scoreline");
      alert = child(card, "card__alert");
      source = clubs ? clubs.sourceFromUrl(ground.score_url) : null;
      view = source ? lastScore[ground.id] : null;
      if (!source || !view) {
        setText(line, "");
        if (alert) {
          alert.className = "card__alert is-off";
          alert.removeAttribute("data-phase");
          clearAlert(alert);
        }
        clearOutline(card);
        continue;
      }
      copy = clubs.alertPresentation ? clubs.alertPresentation(view.phase) : null;
      setText(line, view.score ? view.score + (view.detail && !copy ? " · " + view.detail : "") : (view.detail || ""));
      phase = view.alert || "";
      clearOutline(card);
      copy = clubs.alertPresentation ? clubs.alertPresentation(phase) : null;
      if (copy && copy.outline) card.classList.add("card--" + copy.outline);
      if (!alert) continue;
      if (alert.getAttribute("data-phase") === phase) continue;
      alert.setAttribute("data-phase", phase);
      clearAlert(alert);
      if (!copy) {
        alert.className = "card__alert is-off";
        continue;
      }
      alert.className = "card__alert card__alert--" + copy.tone;
      alert.appendChild(document.createTextNode(copy.text));
      if (copy.jump) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "card__ads";
        setText(button, "Trigger ads");
        button.onclick = (function (groundId) {
          return function (event) {
            if (event.stopPropagation) event.stopPropagation();
            if (window.PulsePlayAdmin && window.PulsePlayAdmin.focusAds) window.PulsePlayAdmin.focusAds(groundId);
          };
        })(ground.id);
        alert.appendChild(button);
      }
    }
  }

  function paint() {
    paintHealth();
    paintScores();
  }

  function pushId(ids, seen, id) {
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  }

  function pollHealth() {
    var ids = [];
    var seen = {};
    var list;
    var extra;
    var i;
    var id;
    var now;
    if (!centerOpen()) return;
    if (window.PulsePlayDayBoard && window.PulsePlayDayBoard.refreshStreams) window.PulsePlayDayBoard.refreshStreams();
    now = Date.now();
    if (now < healthBackoffUntil) return;
    if (healthBusy) {
      healthAgain = true;
      return;
    }
    list = grounds();
    for (i = 0; i < list.length; i++) pushId(ids, seen, broadcastIdFor(list[i]));
    extra = window.PulsePlayDayBoard && window.PulsePlayDayBoard.broadcastIds ? window.PulsePlayDayBoard.broadcastIds() : [];
    for (i = 0; i < extra.length; i++) pushId(ids, seen, extra[i]);
    if (!ids.length) {
      paintHealth();
      return;
    }
    healthBusy = true;
    invoke({ action: "health", broadcastIds: ids }).then(function (result) {
      var rows;
      var n;
      var when;
      healthBusy = false;
      if (healthAgain) {
        healthAgain = false;
        pollHealth();
        return;
      }
      if (!centerOpen()) return;
      if (result.error) {
        if (/quota/i.test(result.error)) healthBackoffUntil = Date.now() + 120000;
        setNote(result.error);
        paintHealth();
        return;
      }
      rows = result.data && result.data.broadcasts ? result.data.broadcasts : [];
      for (n = 0; n < rows.length; n++) if (rows[n] && rows[n].id) lastHealth[rows[n].id] = rows[n];
      when = new Date();
      setNote("Stream health checked at " + when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ".");
      paintHealth();
    }).catch(function () {
    healthBusy = false;
    if (healthAgain) {
      healthAgain = false;
      pollHealth();
    }
  });
  }

  function fetchScore(ground) {
    var clubs = window.PulsePlayCricClubs;
    var source;
    var key;
    if (!clubs) return Promise.resolve();
    source = clubs.sourceFromUrl(ground.score_url);
    key = ground.score_url || "";
    if (scoreKeys[ground.id] !== key) {
      scoreKeys[ground.id] = key;
      delete lastScore[ground.id];
    }
    if (!source) return Promise.resolve();
    if (source.kind === "sse") {
      return fetchSse(source.code, scoreHint(ground)).then(function (view) {
        if (view) lastScore[ground.id] = view;
      });
    }
    return fetchRest(source.clubId, source.matchId, scoreHint(ground)).then(function (view) {
      if (view) lastScore[ground.id] = view;
    });
  }

  function scoreEventReady(text) {
    var at = text.indexOf("event:score-update");
    var dataAt;
    if (at < 0) at = text.indexOf("event: score-update");
    if (at < 0) return false;
    dataAt = text.indexOf("data:", at);
    if (dataAt < 0) return false;
    return text.indexOf("\n", dataAt + 5) !== -1;
  }

  function readUntil(response) {
    var reader;
    var decoder;
    var buf = "";
    if (!response.body || !response.body.getReader) return response.text();
    reader = response.body.getReader();
    decoder = new TextDecoder();
    function pump() {
      return reader.read().then(function (part) {
        if (part.value) buf += decoder.decode(part.value, { stream: true });
        if (part.done || scoreEventReady(buf) || buf.length >= 250000) return buf;
        return pump();
      }, function () {
        return buf;
      });
    }
    return pump();
  }

  function fetchSse(code, hint) {
    var clubs = window.PulsePlayCricClubs;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    var promise = fetch(clubs.sseUrl(code), {
      headers: { Accept: "text/event-stream" },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error("score");
      return readUntil(response);
    }).then(function (text) {
      clearTimeout(timer);
      return clubs.fromSse(clubs.parseSseScore(text), hint);
    }).catch(function () {
      clearTimeout(timer);
      return null;
    });
    promise.then(function () {
      try { if (ctrl) ctrl.abort(); } catch (error) {}
    });
    return promise;
  }

  function fetchRest(clubId, matchId, hint) {
    var clubs = window.PulsePlayCricClubs;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    return fetch(clubs.restUrl(clubId, matchId), {
      headers: clubs.restHeaders(),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error("score");
      return response.json();
    }).then(function (body) {
      clearTimeout(timer);
      return clubs.fromRest(body, hint);
    }).catch(function () {
      clearTimeout(timer);
      return null;
    });
  }

  function pollScores() {
    var list;
    var jobs = [];
    var i;
    if (!centerOpen() || !window.PulsePlayCricClubs) return;
    if (scoreBusy) {
      scoreAgain = true;
      return;
    }
    list = grounds();
    scoreBusy = true;
    for (i = 0; i < list.length; i++) jobs.push(fetchScore(list[i]));
    Promise.all(jobs).then(function () {
      scoreBusy = false;
      if (scoreAgain) {
        scoreAgain = false;
        pollScores();
        return;
      }
      if (centerOpen()) paintScores();
    }).catch(function () {
      scoreBusy = false;
      if (scoreAgain) {
        scoreAgain = false;
        pollScores();
      }
    });
  }

  function stop() {
    if (healthTimer) clearInterval(healthTimer);
    if (scoreTimer) clearInterval(scoreTimer);
    healthTimer = null;
    scoreTimer = null;
  }

  function sync() {
    stop();
    if (!centerOpen()) return;
    pollHealth();
    pollScores();
    healthTimer = setInterval(pollHealth, HEALTH_MS);
    scoreTimer = setInterval(pollScores, SCORE_MS);
  }

  function refresh() {
    healthBackoffUntil = 0;
    pollHealth();
    pollScores();
  }

  function option(value, text) {
    var node = document.createElement("option");
    node.value = value;
    setText(node, text);
    return node;
  }

  function fillPick(select) {
    var current;
    var i;
    var row;
    var label;
    var clock;
    var rules;
    if (!select) return;
    current = select.value;
    while (select.firstChild) select.removeChild(select.firstChild);
    select.appendChild(option("", catalog.length ? "Pick an upcoming broadcast" : "Upcoming list unavailable"));
    rules = window.PulsePlayYouTube;
    for (i = 0; i < catalog.length; i++) {
      row = catalog[i];
      if (!row || !row.id) continue;
      if (rules && rules.matchesFilter && !rules.matchesFilter(row, "upcoming", Date.now())) continue;
      label = row.title || row.id;
      if (row.scheduledStart && rules && rules.zonedClock) {
        clock = rules.zonedClock(row.scheduledStart, rules.PACIFIC);
        if (clock) label = clock.timeLabel + " · " + label;
      }
      select.appendChild(option(row.id, label));
    }
    if (current) select.value = current;
  }

  function fillAllPicks() {
    var nodes = document.getElementsByClassName("score-yt-pick");
    var i;
    for (i = 0; i < nodes.length; i++) fillPick(nodes[i]);
  }

  function loadBroadcasts(force) {
    var now = Date.now();
    if (!force && catalogAt && now - catalogAt < CATALOG_MS) {
      fillAllPicks();
      return;
    }
    if (catalogBusy) return;
    if (!liveClient()) {
      fillAllPicks();
      return;
    }
    catalogBusy = true;
    invoke({ action: "list" }).then(function (result) {
      catalogBusy = false;
      if (!result.error) {
        catalog = result.data && result.data.broadcasts ? result.data.broadcasts : [];
        catalogAt = Date.now();
      }
      fillAllPicks();
    }).catch(function () {
      catalogBusy = false;
      fillAllPicks();
    });
  }

  document.addEventListener("visibilitychange", sync);

  function rememberScore(id, view) {
    if (!id) return;
    if (!view) delete lastScore[id];
    else lastScore[id] = view;
    paintScores();
  }

  window.PulsePlayCommand = {
    sync: sync,
    refresh: refresh,
    paint: paint,
    loadBroadcasts: loadBroadcasts,
    fillPick: fillPick,
    rememberScore: rememberScore
  };
})();
