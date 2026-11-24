/*
 * Dashboard: ground controls, Command Center, Ad Library, ground setup.
 * Writes go through the mock adapter. Renderers pick them up by storage event or poll.
 */
(function () {
  var PAGES = "https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays";
  var store = window.PulsePlayStore.create({
    configUrl: "config/grounds.example.json"
  });
  var useSupabase = window.PulsePlayStore.chosenAdapter === "supabase";
  var currentDoc = null;
  var currentId = "";
  var actionSig = "";
  var centerSig = "";
  var librarySig = null;
  var logoSig = null;
  var setupSig = null;
  var controlsSig = "";
  var setupSection = "controls";
  var polling = false;
  var POLL_MIN_SECONDS = 2;
  var POLL_MAX_SECONDS = 300;
  var TICKER_LINES = [
    "Enjoying the game? Like and subscribe to CricketCrazeUSA for more USA cricket!",
    "Never miss a match. Subscribe to CricketCrazeUSA and tap the bell \uD83D\uDD14",
    "Share this stream with family and friends who couldn't make it to the ground!"
  ];
  var tickerFormSig = "";
  var TAP_GUARD_MS = 3000;
  var lastControlTap = { key: "", at: 0 };
  var scoreFullTouched = false;
  var layoutDirty = false;
  var externalDirty = false;
  var setupLoadedId = "";

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function showBanner(message, kind) {
    var banner = document.getElementById("banner");
    setText(banner, message || "");
    banner.className = "banner" + (message ? "" : " is-off") + (kind === "ok" ? " is-ok" : "");
  }

  function formatTime(iso) {
    if (!iso) return "unknown";
    return String(iso).replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC");
  }

  function mb(bytes) {
    return (Math.round((bytes / (1024 * 1024)) * 10) / 10) + " MB";
  }

  function isMp4(file) {
    var type = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    return type === "video/mp4" || name.lastIndexOf(".mp4") === name.length - 4;
  }

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var logoConvertToken = 0;
  var preparingLogo = false;
  var preparedLogo = null;

  function fileSuffix(name, suffix) {
    return name.lastIndexOf(suffix) === name.length - suffix.length;
  }

  function isJpeg(file) {
    var type = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    return type === "image/jpeg" || type === "image/jpg" || fileSuffix(name, ".jpg") || fileSuffix(name, ".jpeg");
  }

  function isPng(file) {
    var type = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    return type === "image/png" || fileSuffix(name, ".png");
  }

  function isPdf(file) {
    var type = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    return type === "application/pdf" || fileSuffix(name, ".pdf");
  }

  function isImageMedia(asset) {
    var mime;
    if (!asset || asset.kind !== "ad") return false;
    if (asset.media_type === "image") return true;
    if (asset.media_type === "video") return false;
    mime = (asset.mime || "").toLowerCase();
    return mime.indexOf("image/") === 0;
  }

  function isLogoFile(file) {
    var type = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    if (type === "image/png" || type === "image/webp" || type === "image/svg+xml" || isJpeg(file) || isPdf(file)) return true;
    return fileSuffix(name, ".png") || fileSuffix(name, ".webp") || fileSuffix(name, ".svg");
  }

  function fileKey(file) {
    return (file.name || "") + ":" + (file.size || 0) + ":" + (file.lastModified || 0);
  }

  function jpegFile(file) {
    var type = (file.type || "").toLowerCase();
    var name;
    if (type === "image/jpeg") return file;
    name = file.name || "logo.jpg";
    if (!fileSuffix(name.toLowerCase(), ".jpg") && !fileSuffix(name.toLowerCase(), ".jpeg")) name += ".jpg";
    return new File([file], name, { type: "image/jpeg" });
  }

  function hideLogoPreview() {
    var preview = document.getElementById("logo-convert-preview");
    if (preview.getAttribute("src")) {
      try { URL.revokeObjectURL(preview.src); } catch (e) {}
    }
    preview.removeAttribute("src");
    preview.classList.add("is-off");
  }

  function showLogoPreview(file) {
    var preview = document.getElementById("logo-convert-preview");
    hideLogoPreview();
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("is-off");
  }

  function pdfToPng(file, fit, callback) {
    var reader = new FileReader();
    if (typeof fit === "function") {
      callback = fit;
      fit = { longEdge: 1000 };
    }
    reader.onerror = function () { callback(new Error("Could not read that PDF.")); };
    reader.onload = function () {
      var data = new Uint8Array(reader.result);
      var lib = window.pdfjsLib;
      if (!lib || !lib.getDocument) {
        callback(new Error("The PDF converter did not load. Reload the page and try again."));
        return;
      }
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      lib.getDocument({ data: data }).promise.then(function (pdf) {
        return pdf.getPage(1);
      }).then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var scale = fit.longEdge
          ? fit.longEdge / (Math.max(base.width, base.height) || 1)
          : Math.min(fit.maxWidth / base.width, fit.maxHeight / base.height);
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement("canvas");
        var ctx;
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        ctx = canvas.getContext("2d");
        return page.render({
          canvasContext: ctx,
          viewport: viewport,
          background: "rgba(0,0,0,0)"
        }).promise.then(function () { return canvas; });
      }).then(function (canvas) {
        canvas.toBlob(function (blob) {
          var name;
          if (!blob) { callback(new Error("Could not convert that PDF to a PNG.")); return; }
          name = (file.name || "page.pdf").replace(/\.pdf$/i, "") + ".png";
          callback(null, new File([blob], name, { type: "image/png" }));
        }, "image/png");
      }).catch(function (err) {
        callback(new Error((err && err.message) || "Could not convert that PDF."));
      });
    };
    reader.readAsArrayBuffer(file);
  }

  var FREE_PLAN_BYTES = 50 * 1024 * 1024;

  function adOverFreePlan(file) {
    return file.size > FREE_PLAN_BYTES;
  }

  function adFreePlanError(file) {
    return "This file is " + mb(file.size) + ". The Supabase free plan rejects uploads over 50 MB. Compress it under 50 MB.";
  }

  function assetFromUpload(id, kind, label, description, info, file, extra) {
    var src = typeof info === "string" ? info : info.src;
    var storagePath = typeof info === "string" ? info : info.storage_path;
    var asset = {
      id: id,
      kind: kind,
      label: label,
      description: description,
      src: src,
      storage_path: storagePath,
      mime: file.type || (typeof info === "string" ? "" : info.mime),
      size: file.size || 0,
      logo_type: extra.logo_type,
      auto_return: extra.auto_return,
      media_type: extra.media_type || null,
      logo_scale: extra.logo_scale || null,
      duration_seconds: extra.duration_seconds || null,
      created_at: new Date().toISOString()
    };
    return asset;
  }

  function slug(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function findGround(doc, id) {
    var i;
    if (!doc || !doc.grounds) return null;
    for (i = 0; i < doc.grounds.length; i++) {
      if (doc.grounds[i].id === id) return doc.grounds[i];
    }
    return null;
  }

  var LOGO_TYPES = [
    ["age_group_sponsor", "Age Group Sponsor"],
    ["tournament", "Tournament"],
    ["cricketcraze", "CricketCrazeUSA"],
    ["other", "Other"]
  ];

  function findAsset(doc, id) {
    var all = (doc && doc.assets) || [];
    var i;
    if (!id) return null;
    for (i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function findAd(doc, id) {
    var asset = findAsset(doc, id);
    if (!asset || asset.kind !== "ad") return null;
    return asset;
  }

  function assetsOf(kind) {
    var all = (currentDoc && currentDoc.assets) || [];
    var list = [];
    var i;
    for (i = 0; i < all.length; i++) {
      if (all[i].kind === kind) list.push(all[i]);
    }
    return list;
  }

  function logoTypeLabel(type) {
    var i;
    for (i = 0; i < LOGO_TYPES.length; i++) {
      if (LOGO_TYPES[i][0] === type) return LOGO_TYPES[i][1];
    }
    return "Other";
  }

  function deviceLabel() {
    return window.PulsePlayDevice.deviceLabel();
  }

  function modeLabel(doc, ground) {
    var ad;
    if (ground.mode === "ad") {
      ad = findAd(doc, ground.active_ad);
      return "View 2: " + (ad ? ad.label : "Ad");
    }
    return "View 1: Logos + Score";
  }

  var STUCK_VIDEO_BUFFER_SECONDS = 3;
  var STUCK_ANY_MS = 10 * 60 * 1000;

  function adStartMs(ground) {
    var n = Date.parse((ground && (ground.ad_started_at || ground.updated_at)) || "");
    return isNaN(n) ? 0 : n;
  }

  function isVideoStuck(doc, ground) {
    var ad;
    var dur;
    var start;
    if (!doc || !ground || ground.mode !== "ad" || !ground.active_ad) return false;
    ad = findAd(doc, ground.active_ad);
    if (!ad || isImageMedia(ad)) return false;
    dur = Number(ad.duration_seconds);
    if (!isFinite(dur) || dur <= 0) return false;
    start = adStartMs(ground);
    if (!start) return false;
    return Date.now() > start + (dur + STUCK_VIDEO_BUFFER_SECONDS) * 1000;
  }

  function isInformationalStuck(doc, ground) {
    var start;
    if (!doc || !ground || ground.mode !== "ad" || !ground.active_ad) return false;
    start = adStartMs(ground);
    if (!start) return false;
    return Date.now() > start + STUCK_ANY_MS;
  }

  function isStuck(doc, ground) {
    return isVideoStuck(doc, ground) || isInformationalStuck(doc, ground);
  }

  function stuckGrounds(doc) {
    var out = [];
    var i;
    var ground;
    if (!doc || !doc.grounds) return out;
    for (i = 0; i < doc.grounds.length; i++) {
      ground = doc.grounds[i];
      if (isStuck(doc, ground)) out.push(ground);
    }
    return out;
  }

  function resetGroundToLogos(groundId) {
    tapControl(groundId, { mode: "logos_score", active_ad: null });
  }

  function resetAllStuck() {
    var list = stuckGrounds(currentDoc);
    var i;
    if (!list.length) {
      showBanner("No stuck ads to reset.", "ok");
      return;
    }
    for (i = 0; i < list.length; i++) resetGroundToLogos(list[i].id);
    showBanner("Reset " + list.length + " stuck ground" + (list.length === 1 ? "" : "s") + " to Logos + Score.", "ok");
  }

  function paintStuckHint() {
    var node = document.getElementById("stuck-hint");
    var list;
    var n;
    if (!node) return;
    list = stuckGrounds(currentDoc);
    n = list.length;
    if (!n) {
      setText(node, "");
      return;
    }
    setText(node, n + " ground" + (n === 1 ? " is" : "s are") + " marked stuck. Video ads past their length, or any ad on for more than 10 minutes, can be reset here. Image ads are not cleared automatically.");
  }

  function resolvedFor(id) {
    return window.PulsePlayDevice.pagesRendererUrl(PAGES, id);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function option(value, text) {
    var node = document.createElement("option");
    node.value = value;
    setText(node, text);
    return node;
  }

  function isFullAdmin() {
    var access = window.PulsePlayAccess;
    return !access || access.fullAdmin !== false;
  }

  function scopedGrounds() {
    var grounds = currentDoc && currentDoc.grounds ? currentDoc.grounds : [];
    var access = window.PulsePlayAccess;
    var streams = window.PulsePlayAccessStreams || [];
    var out = [];
    var i;
    if (!window.PulsePlayScope || !access || access.fullAdmin) return grounds;
    for (i = 0; i < grounds.length; i++) {
      if (window.PulsePlayScope.groundVisible(access, grounds[i], streams)) out.push(grounds[i]);
    }
    return out;
  }

  function fillGroundSelect(select, includeNew) {
    var previous = select.value;
    var grounds = scopedGrounds();
    var i;
    var ground;
    clear(select);
    if (includeNew && isFullAdmin()) select.appendChild(option("__new__", "+ New ground"));
    for (i = 0; i < grounds.length; i++) {
      ground = grounds[i];
      select.appendChild(option(ground.id, window.PulsePlayDevice.groundOptionLabel(ground.name)));
    }
    if (previous && select.querySelector) {
      if (select.querySelector('option[value="' + previous + '"]')) select.value = previous;
    }
  }

  function renderStatus() {
    var ground = findGround(currentDoc, currentId);
    var localLink = document.getElementById("local-overlay");
    syncPollField();
    if (!ground) {
      setText(document.getElementById("st-name"), "No grounds yet");
      setText(document.getElementById("st-device"), "—");
      setText(document.getElementById("st-active"), "Add the first ground in Ground setup");
      setText(document.getElementById("st-short"), "—");
      document.getElementById("st-short").removeAttribute("href");
      setText(document.getElementById("st-resolved"), "—");
      document.getElementById("st-resolved").removeAttribute("href");
      setText(document.getElementById("st-score"), "—");
      document.getElementById("st-score").removeAttribute("href");
      setText(localLink, "Overlay pages stay transparent until a ground exists");
      localLink.removeAttribute("href");
      if (document.getElementById("external-video")) document.getElementById("external-video").disabled = true;
      if (document.getElementById("score-switch")) document.getElementById("score-switch").classList.add("is-off");
      if (document.getElementById("show-ticker")) document.getElementById("show-ticker").disabled = true;
      if (document.getElementById("btn-ticker-now")) document.getElementById("btn-ticker-now").disabled = true;
      return;
    }
    setText(document.getElementById("st-name"), ground.name);
    setText(document.getElementById("st-device"), deviceLabel());
    setText(document.getElementById("st-short"), ground.short_link);
    document.getElementById("st-short").href = ground.short_link;
    setText(document.getElementById("st-resolved"), resolvedFor(ground.id));
    document.getElementById("st-resolved").href = resolvedFor(ground.id);
    setText(document.getElementById("st-active"), modeLabel(currentDoc, ground));
    setText(document.getElementById("st-score"), ground.score_url);
    document.getElementById("st-score").href = window.PulsePlayStore.safeUrl(ground.score_url) || "#";
    localLink.href = "renderer/" + window.PulsePlayDevice.rendererQuery(ground.id);
    setText(localLink, "Open the YoloBox Pro / Ultra overlay for this ground");
    if (document.getElementById("external-video") && document.activeElement !== document.getElementById("external-video")) {
      document.getElementById("external-video").checked = ground.external_video_audio === true;
      document.getElementById("external-video").disabled = false;
    }
    renderScoreSwitch(ground);
    if (document.getElementById("show-ticker") && document.activeElement !== document.getElementById("show-ticker")) {
      document.getElementById("show-ticker").checked = ground.show_subscribe_ticker !== false;
      document.getElementById("show-ticker").disabled = false;
    }
    if (document.getElementById("btn-ticker-now")) document.getElementById("btn-ticker-now").disabled = false;
  }

  function scoreList(ground) {
    var raw = ground && ground.score_overlays;
    var out = [];
    var i;
    var item;
    var activeAt = -1;
    if (raw && raw.length) {
      for (i = 0; i < raw.length; i++) {
        item = raw[i];
        if (!item || !item.url) continue;
        var saved = {
          id: String(item.id || ((ground.id || "ground") + "-score-" + (i + 1))),
          name: String(item.name || ("Game " + (out.length + 1))),
          url: String(item.url).replace(/^\s+|\s+$/g, ""),
          active: item.active === true
        };
        if (item.full_size === true) saved.full_size = true;
        else if (item.full_size === false) saved.full_size = false;
        out.push(saved);
      }
    }
    if (!out.length && ground && ground.score_url) {
      out.push({
        id: (ground.id || "ground") + "-game-1",
        name: "Game 1",
        url: ground.score_url,
        active: true
      });
    }
    for (i = 0; i < out.length; i++) {
      if (out[i].active && activeAt === -1) activeAt = i;
      else out[i].active = false;
    }
    if (activeAt === -1 && out.length) {
      for (i = 0; i < out.length; i++) {
        if (ground && out[i].url === ground.score_url) { activeAt = i; break; }
      }
      if (activeAt === -1) activeAt = 0;
      out[activeAt].active = true;
    }
    return out;
  }

  function scoreWarnText(url) {
    if (!url || scoreHost(url) === "overlay.cricclubs.com") return "";
    return "This score URL is not overlay.cricclubs.com. That is the only host this overlay is set up to embed.";
  }

  var scoreSwitchSig = "";

  function renderScoreSwitch(ground) {
    var box = document.getElementById("score-switch");
    var listEl = document.getElementById("score-switch-list");
    var warn = document.getElementById("score-switch-warn");
    var list;
    var sig;
    var i;
    var button;
    var activeUrl = "";
    if (!box || !listEl) return;
    if (!ground) {
      box.classList.add("is-off");
      scoreSwitchSig = "";
      return;
    }
    box.classList.remove("is-off");
    list = scoreList(ground);
    sig = ground.id + "|" + JSON.stringify(list);
    if (sig !== scoreSwitchSig) {
      scoreSwitchSig = sig;
      clear(listEl);
      for (i = 0; i < list.length; i++) {
        button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-score-id", list[i].id);
        button.setAttribute("aria-pressed", list[i].active ? "true" : "false");
        setText(button, list[i].name);
        button.onclick = function () { showSavedScore(this.getAttribute("data-score-id")); };
        listEl.appendChild(button);
        if (list[i].active) activeUrl = list[i].url;
      }
    } else {
      for (i = 0; i < list.length; i++) if (list[i].active) activeUrl = list[i].url;
    }
    var typed = document.getElementById("score-switch-url").value.replace(/^\s+|\s+$/g, "");
    var warnText = scoreWarnText(typed || activeUrl);
    setText(warn, warnText);
    if (warnText) warn.classList.add("is-warn");
    else warn.classList.remove("is-warn");
  }

  function freshScoreOverlays(existing, groundId, scoreUrl) {
    var list;
    var i;
    var active = null;
    if (!existing) {
      return [{ id: groundId + "-game-1", name: "Game 1", url: scoreUrl, active: true }];
    }
    list = scoreList(existing);
    for (i = 0; i < list.length; i++) if (list[i].active) active = list[i];
    if (!active && list.length) {
      list[0].active = true;
      active = list[0];
    }
    if (active) active.url = scoreUrl;
    else list.push({ id: groundId + "-game-1", name: "Game 1", url: scoreUrl, active: true });
    return list;
  }

  function showSavedScore(scoreId) {
    var ground = findGround(currentDoc, currentId);
    var list;
    var i;
    var chosen = null;
    if (!ground || !scoreId) return;
    list = scoreList(ground);
    for (i = 0; i < list.length; i++) {
      list[i].active = list[i].id === scoreId;
      if (list[i].active) chosen = list[i];
    }
    if (!chosen) return;
    /* Leave updated_at alone so an in-flight video return timer still matches. */
    patch(ground.id, { score_url: chosen.url, score_overlays: list }, { keepUpdatedAt: true });
  }

  function addScoreOverlay() {
    var ground = findGround(currentDoc, currentId);
    var name = document.getElementById("score-switch-name").value.replace(/^\s+|\s+$/g, "");
    var url = document.getElementById("score-switch-url").value.replace(/^\s+|\s+$/g, "");
    var list;
    var i;
    var id;
    var taken;
    var n;
    var reused = false;
    var fullSize;
    if (!ground) return;
    if (!name || !url) {
      showBanner("Give the score overlay a name and a URL.");
      return;
    }
    fullSize = document.getElementById("score-full-size").checked;
    list = scoreList(ground);
    id = (ground.id || "ground") + "-" + (slug(name) || "score");
    taken = {};
    for (i = 0; i < list.length; i++) taken[list[i].id] = true;
    n = 2;
    while (taken[id]) {
      id = (ground.id || "ground") + "-" + (slug(name) || "score") + "-" + n;
      n += 1;
    }
    for (i = 0; i < list.length; i++) {
      if (list[i].url === url) {
        list[i].name = name;
        list[i].full_size = fullSize;
        list[i].active = true;
        reused = true;
      } else list[i].active = false;
    }
    if (!reused) list.push({ id: id, name: name, url: url, active: true, full_size: fullSize });
    document.getElementById("score-switch-name").value = "";
    document.getElementById("score-switch-url").value = "";
    scoreFullTouched = false;
    refreshScoreSwitchDraftWarn();
    patch(ground.id, { score_url: url, score_overlays: list }, { keepUpdatedAt: true });
  }

  function refreshScoreSwitchDraftWarn() {
    var warn = document.getElementById("score-switch-warn");
    var url = document.getElementById("score-switch-url").value.replace(/^\s+|\s+$/g, "");
    var text;
    if (!warn) return;
    if (!url) {
      renderScoreSwitch(findGround(currentDoc, currentId));
      return;
    }
    text = scoreWarnText(url);
    setText(warn, text);
    if (text) warn.classList.add("is-warn");
    else warn.classList.remove("is-warn");
  }

  function clampPollSeconds(seconds) {
    seconds = parseInt(seconds, 10);
    if (!seconds || seconds < POLL_MIN_SECONDS) return POLL_MIN_SECONDS;
    if (seconds > POLL_MAX_SECONDS) return POLL_MAX_SECONDS;
    return seconds;
  }

  function markPollPick(seconds) {
    var buttons = document.getElementById("poll-picks").getElementsByTagName("button");
    var i;
    var picked;
    for (i = 0; i < buttons.length; i++) {
      picked = parseInt(buttons[i].getAttribute("data-seconds"), 10) === seconds;
      if (picked) buttons[i].classList.add("is-on");
      else buttons[i].classList.remove("is-on");
      buttons[i].setAttribute("aria-pressed", picked ? "true" : "false");
    }
  }

  function syncPollField() {
    var pollInput = document.getElementById("poll-seconds");
    var seconds;
    if (!currentDoc || document.activeElement === pollInput) return;
    seconds = clampPollSeconds(Math.round((currentDoc.poll_ms || 2000) / 1000));
    pollInput.value = String(seconds);
    markPollPick(seconds);
  }

  function savePollSeconds(raw) {
    var seconds = clampPollSeconds(raw);
    document.getElementById("poll-seconds").value = String(seconds);
    markPollPick(seconds);
    currentDoc.poll_ms = seconds * 1000;
    saveDoc("Poll interval saved (" + seconds + "s). A missed live update can take that long to reach the YoloBox.");
  }

  function controlAdIds(ground) {
    var ids = (ground && ground.ad_ids) || [];
    var videos = [];
    var images = [];
    var i;
    var ad;
    for (i = 0; i < ids.length; i++) {
      ad = findAd(currentDoc, ids[i]);
      if (!ad) continue;
      if (isImageMedia(ad)) images.push(ad.id);
      else videos.push(ad.id);
    }
    return videos.concat(images);
  }

  function tapControl(groundId, fields) {
    var now = Date.now();
    var key = groundId + "|" + fields.mode + "|" + (fields.active_ad || "");
    if (lastControlTap.key === key && now - lastControlTap.at < TAP_GUARD_MS) {
      showBanner("That control was just sent. Wait a few seconds to start it again.");
      return;
    }
    lastControlTap.key = key;
    lastControlTap.at = now;
    patch(groundId, fields);
  }

  function makeAction(action, label, onclick) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-action", action);
    button.setAttribute("aria-pressed", "false");
    setText(button, label);
    button.onclick = onclick;
    return button;
  }

  function renderActions() {
    var ground = findGround(currentDoc, currentId);
    var bar = document.getElementById("action-bar");
    var ids = controlAdIds(ground);
    var sig = ground ? ground.id + "|" + ids.join(",") : "";
    var buttons;
    var i;
    var kind;
    var on;
    if (!ground) {
      clear(bar);
      actionSig = "";
      var none = document.createElement("p");
      none.className = "hint";
      setText(none, "No grounds yet. Open Ground setup to add one. Until then the YoloBox pages stay blank.");
      bar.appendChild(none);
      return;
    }
    if (sig !== actionSig) {
      actionSig = sig;
      clear(bar);
      bar.appendChild(makeAction("logos", "Logos + Score", function () {
        tapControl(ground.id, { mode: "logos_score", active_ad: null });
      }));
      for (i = 0; i < ids.length; i++) {
        (function (adId) {
          var ad = findAd(currentDoc, adId);
          if (!ad) return;
          bar.appendChild(makeAction(adId, ad.label, function () {
            tapControl(ground.id, { mode: "ad", active_ad: adId });
          }));
        })(ids[i]);
      }
      if (!ids.length) {
        var empty = document.createElement("p");
        empty.className = "hint";
        setText(empty, "No ads are assigned to this ground. Choose some in Ground setup.");
        bar.appendChild(empty);
      }
    }
    buttons = bar.getElementsByTagName("button");
    for (i = 0; i < buttons.length; i++) {
      kind = buttons[i].getAttribute("data-action");
      on = kind === "logos" ? ground.mode !== "ad" : ground.mode === "ad" && ground.active_ad === kind;
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function isLinkTarget(node) {
    while (node && node !== document) {
      if (node.tagName === "A" || node.tagName === "BUTTON" || node.tagName === "INPUT") return true;
      node = node.parentNode;
    }
    return false;
  }

  function scoreHost(url) {
    var anchor = document.createElement("a");
    anchor.href = url || "";
    return (anchor.hostname || "").toLowerCase();
  }

  function refreshScoreWarn() {
    var box = document.getElementById("field-score-warn");
    var url = document.getElementById("field-score").value.replace(/^\s+|\s+$/g, "");
    if (!box) return;
    if (!url || scoreHost(url) === "overlay.cricclubs.com") {
      setText(box, "");
      box.classList.remove("is-warn");
      return;
    }
    setText(box, "This score URL is not overlay.cricclubs.com. That is the only host this overlay is set up to embed.");
    box.classList.add("is-warn");
  }

  function copyText(text) {
    var input;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
      return;
    }
    input = document.createElement("input");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(input);
  }

  function rendererPageUrl(ground) {
    return resolvedFor(ground.id);
  }

  function srtPullUrl(id) {
    return "srt://149.28.72.146:8890?streamid=read:" + id + "&latency=500";
  }

  function rtmpPullUrl(id) {
    return "rtmp://149.28.72.146/" + id;
  }

  function appendCopyLine(card, label, text) {
    var row = document.createElement("p");
    var button = document.createElement("button");
    row.className = "card__pull";
    row.appendChild(document.createTextNode(label + " " + text + " "));
    button.type = "button";
    button.className = "btn-text";
    setText(button, "Copy");
    button.onclick = function (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      copyText(text);
      setText(button, "Copied");
      window.setTimeout(function () { setText(button, "Copy"); }, 1200);
    };
    row.appendChild(button);
    card.appendChild(row);
  }

  function duplicateGround() {
    var source = findGround(currentDoc, document.getElementById("setup-select").value);
    var name;
    var id;
    var n;
    if (!source) return;
    name = source.name + " copy";
    id = slug(name) || "ground-copy";
    n = 2;
    while (findGround(currentDoc, id)) {
      id = slug(name) + "-" + n;
      n += 1;
    }
    showTab("setup");
    document.getElementById("setup-select").value = "__new__";
    idTouched = true;
    loadSetupForm({
      selection: "__new__",
      name: name,
      id: id,
      idTouched: true,
      shortLink: "",
      device: window.PulsePlayDevice.savedDevice(),
      score: "",
      age: source.logos ? source.logos.age_group_sponsor : "",
      tournament: source.logos ? source.logos.tournament : "",
      ccusa: source.logos ? source.logos.cricketcraze : "",
      ads: (source.ad_ids || []).slice(),
      layout: source.layout || null,
      external: source.external_video_audio === true,
      ticker: source.show_subscribe_ticker !== false
    });
    showBanner("Copy of " + source.name + " is ready. Logos, layout, and ads were copied. Set a short URL and a new score URL. Saved score overlays were not copied.");
  }

  function childByClass(parent, className) {
    var nodes = parent.getElementsByClassName(className);
    return nodes.length ? nodes[0] : null;
  }

  function paintCard(card, ground) {
    var mode = childByClass(card, "card__mode");
    var badge = childByClass(card, "card__stuck");
    var reset = childByClass(card, "card__reset");
    var videoStuck = isVideoStuck(currentDoc, ground);
    var infoStuck = !videoStuck && isInformationalStuck(currentDoc, ground);
    if (ground.mode === "ad") card.classList.add("card--ad");
    else card.classList.remove("card--ad");
    if (videoStuck || infoStuck) card.classList.add("card--stuck");
    else card.classList.remove("card--stuck");
    setText(childByClass(card, "card__name"), ground.name);
    setText(mode, modeLabel(currentDoc, ground));
    setText(childByClass(card, "card__time"), "Updated " + formatTime(ground.updated_at));
    if (badge) {
      if (videoStuck) {
        setText(badge, "Stuck");
        badge.className = "card__stuck is-on";
      } else if (infoStuck) {
        setText(badge, "On air 10+ min");
        badge.className = "card__stuck card__stuck--info is-on";
      } else {
        setText(badge, "");
        badge.className = "card__stuck";
      }
    }
    if (reset) {
      if (ground.mode === "ad") reset.classList.remove("is-off");
      else reset.classList.add("is-off");
    }
    syncCardStill(card, ground);
    syncCardScore(card, ground);
  }

  function syncCardScore(card, ground) {
    var scoreP = childByClass(card, "card__score");
    var scoreA = scoreP ? scoreP.getElementsByTagName("a")[0] : null;
    var slot = childByClass(card, "score-slot");
    var frame = slot ? slot.getElementsByTagName("iframe")[0] : null;
    var fallback = childByClass(card, "score-fallback");
    var link = fallback ? fallback.getElementsByTagName("a")[0] : null;
    var warn = childByClass(card, "card__hostwarn");
    var safe = window.PulsePlayStore.safeUrl(ground.score_url) || "#";
    var text = scoreWarnText(ground.score_url);
    if (scoreA) {
      if (scoreA.getAttribute("href") !== safe) scoreA.href = safe;
      if ((scoreA.textContent || scoreA.innerText) !== ground.score_url) setText(scoreA, ground.score_url);
    }
    if (warn) {
      setText(warn, text);
      if (text) warn.classList.remove("is-off");
      else warn.classList.add("is-off");
    }
    if (!frame || card.getAttribute("data-score") === ground.score_url) return;
    card.setAttribute("data-score", ground.score_url);
    window.PulsePlayScore.attach({
      iframe: frame,
      fallback: fallback,
      link: link,
      url: ground.score_url,
      linkLabel: "Open score"
    });
  }

  function syncCardStill(card, ground) {
    var still = childByClass(card, "card-ad-still");
    var frame = card.getElementsByTagName("iframe")[0];
    var ad = ground.mode === "ad" ? findAd(currentDoc, ground.active_ad) : null;
    if (!still || !frame) return;
    if (ad && isImageMedia(ad)) {
      frame.classList.add("is-off");
      still.classList.remove("is-off");
      if (still.getAttribute("data-src") !== ad.src) {
        still.setAttribute("data-src", ad.src);
        store.mediaUrl(ad.src, function (err, url) {
          if (!err && url && still.getAttribute("data-src") === ad.src) still.src = url;
        });
      }
      return;
    }
    still.classList.add("is-off");
    frame.classList.remove("is-off");
  }

  function buildCard(ground) {
    var card = document.createElement("article");
    var head = document.createElement("div");
    var name = document.createElement("h3");
    var pill = document.createElement("span");
    var mode = document.createElement("p");
    var shortP = document.createElement("p");
    var shortA = document.createElement("a");
    var time = document.createElement("p");
    var slot = document.createElement("div");
    var iframe = document.createElement("iframe");
    var fallback = document.createElement("p");
    var fallbackLink = document.createElement("a");
    var scoreP = document.createElement("p");
    var scoreA = document.createElement("a");

    card.className = "card";
    card.setAttribute("data-id", ground.id);
    card.tabIndex = 0;
    head.className = "card__head";
    name.className = "card__name";
    pill.className = "pill";
    setText(pill, deviceLabel());
    head.appendChild(name);
    head.appendChild(pill);
    var badge = document.createElement("span");
    badge.className = "card__stuck";
    head.appendChild(badge);
    mode.className = "card__mode";
    shortP.className = "card__short";
    shortA.href = ground.short_link;
    shortA.target = "_blank";
    shortA.rel = "noopener";
    setText(shortA, ground.short_link);
    shortP.appendChild(document.createTextNode("Short link: "));
    shortP.appendChild(shortA);
    time.className = "card__time";
    slot.className = "score-slot";
    var still = document.createElement("img");
    still.className = "card-ad-still is-off";
    still.alt = "";
    slot.appendChild(still);
    iframe.setAttribute("title", ground.name + " score");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("allowtransparency", "true");
    iframe.style.backgroundColor = "transparent";
    fallback.className = "score-fallback is-off";
    setText(fallback, "This score source blocks embedding. ");
    fallback.appendChild(fallbackLink);
    slot.appendChild(iframe);
    slot.appendChild(fallback);
    scoreP.className = "card__score";
    scoreA.href = window.PulsePlayStore.safeUrl(ground.score_url) || "#";
    scoreA.target = "_blank";
    scoreA.rel = "noopener";
    setText(scoreA, ground.score_url);
    scoreP.appendChild(document.createTextNode("Score URL: "));
    scoreP.appendChild(scoreA);
    var reset = document.createElement("button");
    reset.type = "button";
    reset.className = "card__reset is-off";
    setText(reset, "Logos + Score");
    reset.onclick = function (event) {
      if (event.stopPropagation) event.stopPropagation();
      resetGroundToLogos(ground.id);
    };
    card.appendChild(head);
    card.appendChild(mode);
    card.appendChild(reset);
    card.appendChild(shortP);
    card.appendChild(time);
    card.appendChild(slot);
    card.appendChild(scoreP);
    appendCopyLine(card, "Renderer:", rendererPageUrl(ground));
    appendCopyLine(card, "SRT:", srtPullUrl(ground.id));
    appendCopyLine(card, "RTMP:", rtmpPullUrl(ground.id));
    var hostWarn = document.createElement("p");
    hostWarn.className = "card__note card__hostwarn";
    card.appendChild(hostWarn);
    if (window.PulsePlayStore.isCrossOrigin(ground.score_url)) {
      var note = document.createElement("p");
      note.className = "card__note";
      setText(note, "Cross-origin score. If the strip stays blank, the site is refusing iframes (typical for CricClubs). Use the link. A later proxy or Supabase Edge Function can fetch it.");
      card.appendChild(note);
    }
    paintCard(card, ground);
    card.onclick = function (event) {
      if (isLinkTarget(event.target || event.srcElement)) return;
      openGround(ground.id);
    };
    card.onkeydown = function (event) {
      var key;
      if (isLinkTarget(event.target || event.srcElement)) return;
      key = event.key || event.keyCode;
      if (key === "Enter" || key === " " || key === 13 || key === 32) {
        if (event.preventDefault) event.preventDefault();
        openGround(ground.id);
      }
    };
    return card;
  }

  function renderCenter() {
    var grid = document.getElementById("card-grid");
    var grounds = scopedGrounds();
    var sig = groundIds().join("|") || "__empty__";
    var i;
    var card;
    var ground;
    var emptyNote;
    if (sig !== centerSig) {
      centerSig = sig;
      clear(grid);
      if (!grounds.length) {
        emptyNote = document.createElement("p");
        emptyNote.className = "hint";
        setText(emptyNote, currentDoc.grounds.length
          ? "No grounds in your access."
          : "No grounds yet. Add the first one in Ground setup. Overlay pages stay transparent until a ground exists.");
        grid.appendChild(emptyNote);
        paintStuckHint();
        return;
      }
      for (i = 0; i < grounds.length; i++) grid.appendChild(buildCard(grounds[i]));
      paintStuckHint();
      return;
    }
    for (i = 0; i < grounds.length; i++) {
      ground = grounds[i];
      card = null;
      var cards = grid.getElementsByClassName("card");
      var n;
      for (n = 0; n < cards.length; n++) {
        if (cards[n].getAttribute("data-id") === ground.id) card = cards[n];
      }
      if (card) paintCard(card, ground);
    }
    paintStuckHint();
  }

  function groundIds() {
    var ids = [];
    var grounds = scopedGrounds();
    var i;
    for (i = 0; i < grounds.length; i++) ids.push(grounds[i].id);
    return ids;
  }

  function librarySignature(kind) {
    var parts = [];
    var i;
    var list = assetsOf(kind);
    var item;
    for (i = 0; i < list.length; i++) {
      item = list[i];
      parts.push(item.id + ":" + item.label + ":" + item.auto_return + ":" + item.logo_type + ":" + (item.media_type || "") + ":" + (item.logo_scale || "") + ":" + (item.duration_seconds || "") + ":" + item.src);
    }
    return parts.join("|");
  }

  function renderLibrary() {
    var list = document.getElementById("ad-list");
    var ads = assetsOf("ad");
    var sig = librarySignature("ad");
    var i;
    if (sig === librarySig) return;
    librarySig = sig;
    clear(list);
    if (!ads.length) {
      var emptyAds = document.createElement("p");
      emptyAds.className = "hint";
      setText(emptyAds, "No ads yet. Upload an MP4 above. It will show up in Ground setup once it is saved.");
      list.appendChild(emptyAds);
      return;
    }
    for (i = 0; i < ads.length; i++) list.appendChild(buildAdCard(ads[i]));
  }

  function renderLogoLibrary() {
    var list = document.getElementById("logo-list");
    var sig = librarySignature("logo");
    var logos;
    var i;
    if (!list) return;
    if (sig === logoSig) return;
    logoSig = sig;
    clear(list);
    logos = assetsOf("logo");
    if (!logos.length) {
      var emptyLogos = document.createElement("p");
      emptyLogos.className = "hint";
      setText(emptyLogos, "No logos yet. Upload a PNG, WebP, SVG, JPG, or PDF above and tag its corner. Ground setup picks from this list.");
      list.appendChild(emptyLogos);
      return;
    }
    for (i = 0; i < logos.length; i++) list.appendChild(buildLogoCard(logos[i]));
  }

  function buildLogoCard(logo) {
    var card = document.createElement("article");
    var img = document.createElement("img");
    var title = document.createElement("h3");
    var type = document.createElement("p");
    var desc = document.createElement("p");
    var del = document.createElement("button");
    card.className = "ad-card";
    img.className = "logo-preview";
    img.alt = "";
    store.mediaUrl(logo.src, function (err, url) {
      if (!err && url) img.src = url;
    });
    setText(title, logo.label);
    setText(type, logoTypeLabel(logo.logo_type));
    setText(desc, logo.description || "");
    var scaleLabel = document.createElement("label");
    var scale = document.createElement("input");
    var scaleRead = document.createElement("span");
    var scaleValue = logo.logo_scale ? Math.round(logo.logo_scale * 100) : 100;
    scaleLabel.className = "check";
    scale.type = "range";
    scale.min = "25";
    scale.max = "200";
    scale.step = "5";
    scale.value = String(scaleValue);
    setText(scaleRead, scaleValue + "%");
    scale.oninput = function () { setText(scaleRead, scale.value + "%"); };
    scale.onchange = function () {
      var live = findAsset(currentDoc, logo.id);
      var next = Number(scale.value);
      if (!live) return;
      live.logo_scale = next === 100 ? null : next / 100;
      logoSig = "";
      setupSig = null;
      saveDoc("Saved default scale for " + live.label + ".");
    };
    scaleLabel.appendChild(document.createTextNode(" Default scale "));
    scaleLabel.appendChild(scale);
    scaleLabel.appendChild(scaleRead);
    del.type = "button";
    del.className = "btn-danger";
    setText(del, "Delete");
    del.onclick = function () { deleteAsset(logo.id); };
    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(type);
    card.appendChild(desc);
    card.appendChild(scaleLabel);
    card.appendChild(del);
    return card;
  }

  function buildAdCard(ad) {
    var card = document.createElement("article");
    var preview = isImageMedia(ad) ? document.createElement("img") : document.createElement("video");
    var title = document.createElement("h3");
    var desc = document.createElement("p");
    var label = document.createElement("p");
    var del = document.createElement("button");
    card.className = "ad-card";
    if (isImageMedia(ad)) {
      preview.className = "logo-preview";
      preview.alt = "";
    } else {
      preview.setAttribute("controls", "");
      preview.setAttribute("preload", "metadata");
      preview.setAttribute("playsinline", "");
    }
    store.mediaUrl(ad.src, function (err, url) {
      if (!err && url) preview.src = url;
    });
    setText(title, ad.label);
    setText(desc, ad.description || "");
    del.type = "button";
    del.className = "btn-danger";
    setText(del, "Delete");
    del.onclick = function () { deleteAsset(ad.id); };
    card.appendChild(preview);
    card.appendChild(title);
    card.appendChild(desc);
    label.className = "hint";
    setText(label, isImageMedia(ad) ? "Stays on screen until you switch." : "Returns to Logos + Score when it finishes.");
    card.appendChild(label);
    card.appendChild(del);
    return card;
  }

  function previewSrc(img, src) {
    if (!src) return;
    store.mediaUrl(src, function (err, url) {
      if (!err && url) img.src = url;
    });
  }

  function setupSignature() {
    var parts = ["grounds"];
    var i;
    var asset;
    var ids = groundIds();
    for (i = 0; i < ids.length; i++) parts.push(ids[i]);
    parts.push("assets");
    for (i = 0; i < currentDoc.assets.length; i++) {
      asset = currentDoc.assets[i];
      parts.push(asset.kind + ":" + asset.id + ":" + asset.label + ":" + (asset.logo_type || "") + ":" + (asset.media_type || "") + ":" + (asset.logo_scale || ""));
    }
    for (i = 0; i < currentDoc.grounds.length; i++) {
      parts.push("layout:" + currentDoc.grounds[i].id + ":" + JSON.stringify(currentDoc.grounds[i].layout || null));
      parts.push("ext:" + currentDoc.grounds[i].id + ":" + (currentDoc.grounds[i].external_video_audio === true ? "1" : "0"));
    }
    return parts.join("|");
  }

  function selectHas(select, value) {
    var i;
    for (i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) return true;
    }
    return false;
  }

  var LAYOUT_LABELS = {
    age: "Top left · Age group",
    tournament: "Top right · Tournament",
    cricketcraze: "Bottom right · CricketCrazeUSA",
    score: "Bottom · Score"
  };

  function layoutField(id, type, min, max, step, value) {
    var input = document.createElement("input");
    input.id = id;
    input.type = type;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    return input;
  }

  function buildLayoutControls() {
    var root = document.getElementById("layout-controls");
    var names;
    var i;
    var name;
    var box;
    var title;
    var scale;
    var readout;
    var nudge;
    if (!root || !window.PulsePlayLayout) return;
    names = window.PulsePlayLayout.slots;
    clear(root);
    for (i = 0; i < names.length; i++) {
      name = names[i];
      box = document.createElement("div");
      title = document.createElement("p");
      readout = document.createElement("span");
      nudge = document.createElement("p");
      box.className = "layout-slot";
      title.className = "k";
      setText(title, LAYOUT_LABELS[name]);
      scale = layoutField("layout-" + name + "-scale", "range", 25, 200, 1, 100);
      readout.id = "layout-" + name + "-readout";
      setText(readout, "100%");
      nudge.className = "hint";
      nudge.appendChild(document.createTextNode("X "));
      nudge.appendChild(layoutField("layout-" + name + "-x", "number", -400, 400, 1, 0));
      nudge.appendChild(document.createTextNode(" Y "));
      nudge.appendChild(layoutField("layout-" + name + "-y", "number", -400, 400, 1, 0));
      box.appendChild(title);
      box.appendChild(scale);
      box.appendChild(readout);
      box.appendChild(nudge);
      if (name === "score") {
        var widthLabel = document.createElement("p");
        var width = layoutField("layout-score-width", "range", 50, 100, 1, 100);
        var widthRead = document.createElement("span");
        widthLabel.className = "hint";
        widthRead.id = "layout-score-width-readout";
        setText(widthLabel, "Width ");
        setText(widthRead, "100%");
        widthLabel.appendChild(width);
        widthLabel.appendChild(widthRead);
        box.appendChild(widthLabel);
        width.oninput = function () {
          layoutDirty = true;
          renderLayoutPreview();
        };
      }
      root.appendChild(box);
      scale.oninput = function () {
        layoutDirty = true;
        renderLayoutPreview();
      };
      nudge.getElementsByTagName("input")[0].oninput = function () {
        layoutDirty = true;
        renderLayoutPreview();
      };
      nudge.getElementsByTagName("input")[1].oninput = function () {
        layoutDirty = true;
        renderLayoutPreview();
      };
    }
  }

  function readLayoutForm() {
    var raw = {};
    var names = window.PulsePlayLayout.slots;
    var i;
    var name;
    var scale;
    var x;
    var y;
    for (i = 0; i < names.length; i++) {
      name = names[i];
      scale = document.getElementById("layout-" + name + "-scale");
      x = document.getElementById("layout-" + name + "-x");
      y = document.getElementById("layout-" + name + "-y");
      raw[name] = {
        scale: Number(scale && scale.value) / 100,
        x: Number(x && x.value),
        y: Number(y && y.value)
      };
    }
    if (raw.score && document.getElementById("layout-score-width")) {
      raw.score.width = Number(document.getElementById("layout-score-width").value) / 100;
    }
    return window.PulsePlayLayout.normalize(raw);
  }

  function writeLayoutForm(layout) {
    var norm = window.PulsePlayLayout.normalize(layout);
    var names = window.PulsePlayLayout.slots;
    var i;
    var name;
    var slot;
    for (i = 0; i < names.length; i++) {
      name = names[i];
      slot = norm[name];
      document.getElementById("layout-" + name + "-scale").value = String(Math.round(slot.scale * 100));
      document.getElementById("layout-" + name + "-x").value = String(slot.x);
      document.getElementById("layout-" + name + "-y").value = String(slot.y);
      setText(document.getElementById("layout-" + name + "-readout"), Math.round(slot.scale * 100) + "%");
    }
    if (document.getElementById("layout-score-width")) {
      var widthPct = norm.score && norm.score.width != null ? Math.round(norm.score.width * 100) : 100;
      document.getElementById("layout-score-width").value = String(widthPct);
      setText(document.getElementById("layout-score-width-readout"), widthPct + "%");
    }
  }

  function setLayoutLogo(id, asset) {
    var img = document.getElementById(id);
    if (!img) return;
    if (!asset) {
      img.classList.add("is-off");
      img.removeAttribute("src");
      return;
    }
    img.classList.remove("is-off");
    previewSrc(img, asset.src);
  }

  function renderLayoutPreview() {
    var preview = document.getElementById("layout-preview");
    var stage = document.getElementById("layout-stage");
    var names;
    var i;
    var scale;
    var age;
    var tournament;
    var ccusa;
    if (!preview || !stage || !window.PulsePlayLayout || !currentDoc) return;
    names = window.PulsePlayLayout.slots;
    for (i = 0; i < names.length; i++) {
      scale = document.getElementById("layout-" + names[i] + "-scale");
      setText(document.getElementById("layout-" + names[i] + "-readout"), (scale ? scale.value : "100") + "%");
    }
    if (document.getElementById("layout-score-width-readout")) {
      setText(document.getElementById("layout-score-width-readout"), (document.getElementById("layout-score-width").value || "100") + "%");
    }
    scale = preview.clientWidth / 1920;
    if (!scale || scale <= 0) scale = 0.5;
    stage.style.transform = "scale(" + scale + ")";
    age = findAsset(currentDoc, document.getElementById("pick-age").value);
    tournament = findAsset(currentDoc, document.getElementById("pick-tournament").value);
    ccusa = findAsset(currentDoc, document.getElementById("pick-ccusa").value);
    window.PulsePlayLayout.place({
      device: document.getElementById("field-device").value,
      layout: readLayoutForm(),
      scales: {
        age: age && age.logo_scale,
        tournament: tournament && tournament.logo_scale,
        cricketcraze: ccusa && ccusa.logo_scale
      },
      age: document.getElementById("layout-age"),
      tournament: document.getElementById("layout-tournament"),
      cricketcraze: document.getElementById("layout-ccusa"),
      score: document.getElementById("layout-score"),
      ticker: document.getElementById("layout-ticker")
    });
    setLayoutLogo("layout-age", age);
    setLayoutLogo("layout-tournament", tournament);
    setLayoutLogo("layout-ccusa", ccusa);
    fitPreviewScore();
    placePreviewTicker();
  }

  function fitPreviewScore() {
    var slot = document.getElementById("layout-score");
    var graphic = slot ? slot.getElementsByClassName("layout-score-graphic")[0] : null;
    var field = document.getElementById("field-score");
    var widthEl = document.getElementById("layout-score-width");
    var base;
    var width;
    var sx;
    var sy;
    if (!slot || !graphic || !field || !window.PulsePlayScore || !window.PulsePlayScore.frameScale) return;
    base = window.PulsePlayScore.frameScale(field.value, null);
    width = widthEl ? Number(widthEl.value) / 100 : 1;
    if (!width || width < 0.5) width = 1;
    if (width > 1) width = 1;
    sx = String(Math.round(base * width * 1000) / 1000);
    sy = String(Math.round(base * 1000) / 1000);
    if (slot.style.getPropertyValue("--score-sx") !== sx) slot.style.setProperty("--score-sx", sx);
    if (slot.style.getPropertyValue("--score-sy") !== sy) slot.style.setProperty("--score-sy", sy);
    if (graphic.style.transform !== "scale(var(--score-sx, 1), var(--score-sy, 1))") {
      graphic.style.transform = "scale(var(--score-sx, 1), var(--score-sy, 1))";
      graphic.style.transformOrigin = "bottom center";
    }
  }

  function placePreviewTicker() {
    var score = document.getElementById("layout-score");
    var bar = document.getElementById("layout-ticker");
    var bottom;
    var height;
    var sy;
    var next;
    var message;
    if (!score || !bar) return;
    if (window.PulsePlayLayout && window.PulsePlayLayout.alignTicker) {
      window.PulsePlayLayout.alignTicker(score, bar);
    }
    bottom = parseFloat(score.style.bottom);
    height = parseFloat(score.style.height);
    sy = parseFloat(score.style.getPropertyValue("--score-sy"));
    if (!sy) sy = 1;
    if (isNaN(bottom) || isNaN(height)) return;
    next = window.PulsePlayLayout.tickerBottom(bottom, height, sy, bar.offsetHeight || 48) + "px";
    if (bar.style.bottom !== next) bar.style.bottom = next;
    message = currentDoc && currentDoc.ticker_messages && currentDoc.ticker_messages[0]
      ? currentDoc.ticker_messages[0]
      : TICKER_LINES[0];
    if ((bar.textContent || "") !== message) setText(bar, message);
  }

  function readSetupDraft() {
    var select = document.getElementById("setup-select");
    if (!select.options.length) return null;
    return {
      selection: select.value,
      name: document.getElementById("field-name").value,
      id: document.getElementById("field-id").value,
      idTouched: idTouched,
      shortLink: document.getElementById("field-short").value,
      device: document.getElementById("field-device").value,
      score: document.getElementById("field-score").value,
      age: document.getElementById("pick-age").value,
      tournament: document.getElementById("pick-tournament").value,
      ccusa: document.getElementById("pick-ccusa").value,
      ads: checkedAdIds(),
      layout: readLayoutForm(),
      external: document.getElementById("field-external").checked,
      ticker: document.getElementById("field-ticker").checked
    };
  }

  function applySetupDraft(draft) {
    var nodes;
    var i;
    document.getElementById("field-name").value = draft.name;
    document.getElementById("field-id").value = draft.id;
    idTouched = draft.idTouched;
    document.getElementById("field-short").value = draft.shortLink;
    document.getElementById("field-device").value = window.PulsePlayDevice.savedDevice();
    document.getElementById("field-score").value = draft.score;
    document.getElementById("field-external").checked = !!draft.external;
    document.getElementById("field-ticker").checked = draft.ticker !== false;
    refreshScoreWarn();
    if (selectHas(document.getElementById("pick-age"), draft.age)) document.getElementById("pick-age").value = draft.age;
    if (selectHas(document.getElementById("pick-tournament"), draft.tournament)) document.getElementById("pick-tournament").value = draft.tournament;
    if (selectHas(document.getElementById("pick-ccusa"), draft.ccusa)) document.getElementById("pick-ccusa").value = draft.ccusa;
    nodes = document.getElementById("ad-checks").getElementsByTagName("input");
    for (i = 0; i < nodes.length; i++) nodes[i].checked = indexOf(draft.ads, nodes[i].value) !== -1;
    previewPickedLogo("pick-age", "preview-age");
    previewPickedLogo("pick-tournament", "preview-tournament");
    previewPickedLogo("pick-ccusa", "preview-ccusa");
    writeLayoutForm(draft.layout);
    renderLayoutPreview();
  }

  function renderSetupList() {
    var select = document.getElementById("setup-select");
    var sig = setupSignature();
    var draft;
    var sameSelection;
    if (!currentDoc) return;
    if (sig === setupSig) return;
    draft = readSetupDraft();
    setupSig = sig;
    fillGroundSelect(select, true);
    if (!currentDoc.grounds.length) select.value = "__new__";
    else if (draft && draft.selection && selectHas(select, draft.selection)) select.value = draft.selection;
    else if (currentId && selectHas(select, currentId)) select.value = currentId;
    else if (currentDoc.grounds[0]) select.value = currentDoc.grounds[0].id;
    sameSelection = !!(draft && draft.selection === select.value);
    loadSetupForm(sameSelection ? draft : null);
  }

  function loadSetupForm(draft) {
    var select = document.getElementById("setup-select");
    var id = select.value;
    var ground = id === "__new__" ? null : findGround(currentDoc, id);
    var checks = document.getElementById("ad-checks");
    var ads = assetsOf("ad");
    var i;
    var ad;
    var label;
    var box;
    var logos = ground ? ground.logos : {
      age_group_sponsor: "logo-age-group",
      tournament: "logo-tournament",
      cricketcraze: "logo-cricketcraze"
    };
    idTouched = false;
    if (id !== setupLoadedId) {
      layoutDirty = false;
      externalDirty = false;
      setupLoadedId = id;
    }
    if (!draft || typeof draft.selection !== "string") draft = null;
    clear(checks);
    for (i = 0; i < ads.length; i++) {
      ad = ads[i];
      label = document.createElement("label");
      label.className = "check";
      box = document.createElement("input");
      box.type = "checkbox";
      box.value = ad.id;
      if (ground && indexOf(ground.ad_ids || [], ad.id) !== -1) box.checked = true;
      label.appendChild(box);
      label.appendChild(document.createTextNode(" " + ad.label + (isImageMedia(ad) ? " (image)" : "")));
      checks.appendChild(label);
    }
    if (!ads.length) {
      var noAds = document.createElement("p");
      noAds.className = "hint";
      setText(noAds, "No ads in the library yet. Add one on the Ad Library tab, then tick it here.");
      checks.appendChild(noAds);
    }
    var logoPickEmpty = document.getElementById("logo-pick-empty");
    if (logoPickEmpty) {
      if (!assetsOf("logo").length) logoPickEmpty.classList.remove("is-off");
      else logoPickEmpty.classList.add("is-off");
    }
    var setupEmpty = document.getElementById("setup-empty");
    if (setupEmpty) {
      if (!currentDoc.grounds.length) setupEmpty.classList.remove("is-off");
      else setupEmpty.classList.add("is-off");
    }
    fillLogoSelect("pick-age", "age_group_sponsor", logos.age_group_sponsor);
    fillLogoSelect("pick-tournament", "tournament", logos.tournament);
    fillLogoSelect("pick-ccusa", "cricketcraze", logos.cricketcraze);
    previewPickedLogo("pick-age", "preview-age");
    previewPickedLogo("pick-tournament", "preview-tournament");
    previewPickedLogo("pick-ccusa", "preview-ccusa");
    if (!ground) {
      document.getElementById("field-id").readOnly = false;
      document.getElementById("btn-delete-ground").classList.add("is-off");
      document.getElementById("btn-duplicate-ground").classList.add("is-off");
      if (!draft) {
        document.getElementById("field-name").value = "";
        document.getElementById("field-id").value = "";
        document.getElementById("field-short").value = "";
        document.getElementById("field-device").value = window.PulsePlayDevice.savedDevice();
        document.getElementById("field-score").value = "";
        document.getElementById("field-external").checked = false;
        document.getElementById("field-ticker").checked = true;
        setText(document.getElementById("field-resolved"), "Resolved URL is filled in when you save.");
        writeLayoutForm(null);
        refreshScoreWarn();
      } else {
        applySetupDraft(draft);
      }
      renderLayoutPreview();
      return;
    }
    document.getElementById("field-id").readOnly = true;
    document.getElementById("btn-delete-ground").classList.remove("is-off");
    document.getElementById("btn-duplicate-ground").classList.remove("is-off");
    if (!draft) {
      document.getElementById("field-name").value = ground.name;
      document.getElementById("field-id").value = ground.id;
      document.getElementById("field-short").value = ground.short_link;
      document.getElementById("field-device").value = window.PulsePlayDevice.savedDevice();
      document.getElementById("field-score").value = ground.score_url;
      document.getElementById("field-external").checked = ground.external_video_audio === true;
      document.getElementById("field-ticker").checked = ground.show_subscribe_ticker !== false;
      setText(document.getElementById("field-resolved"), "Resolves to " + resolvedFor(ground.id));
      writeLayoutForm(ground.layout);
      refreshScoreWarn();
    } else {
      applySetupDraft(draft);
    }
    if (!layoutDirty) writeLayoutForm(ground.layout);
    if (!externalDirty) document.getElementById("field-external").checked = ground.external_video_audio === true;
    renderLayoutPreview();
  }

  function fillLogoSelect(selectId, preferred, selectedId) {
    var select = document.getElementById(selectId);
    var logos = assetsOf("logo");
    var match = document.createElement("optgroup");
    var rest = document.createElement("optgroup");
    var i;
    var logo;
    clear(select);
    select.appendChild(option("", "None"));
    match.label = logoTypeLabel(preferred);
    rest.label = "Any other logo";
    for (i = 0; i < logos.length; i++) {
      logo = logos[i];
      if (logo.logo_type === preferred) match.appendChild(option(logo.id, logo.label));
      else rest.appendChild(option(logo.id, logo.label + " (" + logoTypeLabel(logo.logo_type) + ")"));
    }
    if (match.firstChild) select.appendChild(match);
    if (rest.firstChild) select.appendChild(rest);
    select.value = selectedId || "";
  }

  function previewPickedLogo(selectId, imgId) {
    var id = document.getElementById(selectId).value;
    var asset = findAsset(currentDoc, id);
    var img = document.getElementById(imgId);
    if (!asset) {
      img.removeAttribute("src");
      return;
    }
    previewSrc(img, asset.src);
  }

  function indexOf(list, value) {
    var i;
    for (i = 0; i < list.length; i++) if (list[i] === value) return i;
    return -1;
  }

  function checkedAdIds() {
    var nodes = document.getElementById("ad-checks").getElementsByTagName("input");
    var ids = [];
    var i;
    for (i = 0; i < nodes.length; i++) if (nodes[i].checked) ids.push(nodes[i].value);
    return ids;
  }

  function showTab(name) {
    var setupPanels = ["controls", "center", "library", "logos", "setup", "ticker"];
    var flags = window.PulsePlayAccess;
    var main;
    var globalPanels = { library: 1, logos: 1, ticker: 1 };
    if (accessRole === "operator" && name !== "streams" && name !== "wall") name = "streams";
    if (flags && !flags.setup && (name === "setup" || name === "setup-home" || setupPanels.indexOf(name) !== -1)) name = "streams";
    if (flags && !flags.broadcasts && name === "broadcasts") name = "streams";
    if (flags && !flags.manage && name === "access") name = "streams";
    if (flags && !flags.fullAdmin && globalPanels[name]) name = flags.setup ? "controls" : "streams";
    main = name === "streams" || name === "broadcasts" || name === "access" || name === "wall" ? name : "setup";
    var section = main === "setup" ? (name === "setup-home" ? setupSection : name) : "";
    var i;
    var panel;
    var tab;
    if (main === "setup" && section) setupSection = section;
    setTabState("tab-streams", main === "streams");
    setTabState("tab-wall", main === "wall");
    setTabState("tab-setup-home", main === "setup");
    setTabState("tab-broadcasts", main === "broadcasts");
    setTabState("tab-access", main === "access");
    document.getElementById("panel-streams").classList.toggle("is-off", main !== "streams");
    document.getElementById("panel-wall").classList.toggle("is-off", main !== "wall");
    document.getElementById("panel-broadcasts").classList.toggle("is-off", main !== "broadcasts");
    document.getElementById("panel-access").classList.toggle("is-off", main !== "access");
    document.getElementById("setup-subnav").classList.toggle("is-off", main !== "setup");
    for (i = 0; i < setupPanels.length; i++) {
      panel = document.getElementById("panel-" + setupPanels[i]);
      tab = document.getElementById("tab-" + setupPanels[i]);
      if (main === "setup" && setupPanels[i] === setupSection) {
        panel.classList.remove("is-off");
        tab.classList.add("is-active");
      } else {
        panel.classList.add("is-off");
        tab.classList.remove("is-active");
      }
    }
    if (main === "setup" && setupSection === "center") renderCenter();
    if (main === "setup" && setupSection === "library") renderLibrary();
    if (main === "setup" && setupSection === "logos") renderLogoLibrary();
    if (main === "setup" && setupSection === "setup") renderSetupList();
    if (main === "setup" && setupSection === "ticker") loadTickerForm();
    if (main === "streams" && window.PulsePlayStreams) window.PulsePlayStreams.show();
    if (main === "broadcasts" && window.PulsePlayBroadcasts) window.PulsePlayBroadcasts.show();
    if (main === "access" && window.PulsePlayAccessTab) window.PulsePlayAccessTab.show();
    if (main === "wall" && window.PulsePlayLiveWall) window.PulsePlayLiveWall.show();
    else if (window.PulsePlayLiveWall) window.PulsePlayLiveWall.hide();
  }

  function setTabState(id, on) {
    var tab = document.getElementById(id);
    if (!tab) return;
    if (on) tab.classList.add("is-active");
    else tab.classList.remove("is-active");
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

  function maybeOpenBroadcasts() {
    if (queryValue("tab") === "wall") {
      showTab("wall");
      return;
    }
    if (accessRole === "operator") return;
    if (queryValue("tab") === "broadcasts" || queryValue("youtube")) showTab("broadcasts");
  }

  function renderAll() {
    var select = document.getElementById("ground-select");
    var sig = groundIds().join("|");
    if (sig !== controlsSig) {
      controlsSig = sig;
      fillGroundSelect(select, false);
      var visible = scopedGrounds();
      var visibleIds = [];
      var n;
      for (n = 0; n < visible.length; n++) visibleIds.push(visible[n].id);
      if (!(currentId && indexOf(visibleIds, currentId) !== -1) && visible[0]) {
        currentId = visible[0].id;
      }
      if (currentId) select.value = currentId;
      actionSig = "";
    }
    currentId = select.value || currentId;
    renderStatus();
    renderActions();
    if (!document.getElementById("panel-center").classList.contains("is-off") || centerSig) renderCenter();
    if (!document.getElementById("panel-library").classList.contains("is-off")) renderLibrary();
    if (!document.getElementById("panel-logos").classList.contains("is-off")) renderLogoLibrary();
    if (!document.getElementById("panel-setup").classList.contains("is-off")) renderSetupList();
    if (!document.getElementById("panel-ticker").classList.contains("is-off")) loadTickerForm();
  }

  function saveDoc(hint) {
    if (!isFullAdmin()) {
      showBanner("That change is for a full Pulse Play admin.");
      return;
    }
    store.write(currentDoc, function (err) {
      if (err) {
        showBanner(err.message || "Could not save.");
        return;
      }
      showBanner("");
      actionSig = "";
      librarySig = "";
      renderAll();
      if (hint) setText(document.getElementById("save-hint"), hint);
    });
  }

  function patch(id, fields, opts) {
    var ground = findGround(currentDoc, id);
    var key;
    var hint;
    if (!ground) return;
    for (key in fields) {
      if (fields.hasOwnProperty(key)) ground[key] = fields[key];
    }
    if (!opts || !opts.keepUpdatedAt) ground.updated_at = new Date().toISOString();
    hint = "Saved " + ground.name + " at " + formatTime(ground.updated_at) + ". The overlay follows within about 2 seconds, often sooner in this browser.";
    if (!isFullAdmin() && store.writeGround) {
      store.writeGround(ground, { live: true }, function (err) {
        if (err) {
          showBanner(err.message || "Could not save.");
          return;
        }
        showBanner("");
        actionSig = "";
        setText(document.getElementById("save-hint"), hint);
        renderAll();
      });
      return;
    }
    saveDoc(hint);
  }

  function tickerMessagesFromDoc() {
    var raw = currentDoc && currentDoc.ticker_messages;
    var out = [];
    var i;
    if (raw && raw.length) {
      for (i = 0; i < raw.length; i++) {
        if (raw[i] && String(raw[i]).replace(/^\s+|\s+$/g, "")) out.push(String(raw[i]).replace(/^\s+|\s+$/g, ""));
      }
    }
    return out.length ? out : TICKER_LINES.slice();
  }

  function addTickerLine(value) {
    var row = document.createElement("div");
    var input = document.createElement("input");
    var remove = document.createElement("button");
    row.className = "ticker-line";
    input.type = "text";
    input.value = value || "";
    remove.type = "button";
    remove.className = "btn-text";
    setText(remove, "Remove");
    remove.onclick = function () {
      if (row.parentNode) row.parentNode.removeChild(row);
    };
    row.appendChild(input);
    row.appendChild(remove);
    document.getElementById("ticker-lines").appendChild(row);
  }

  function loadTickerForm() {
    var panel = document.getElementById("panel-ticker");
    var lines;
    var sig;
    var i;
    if (!panel || !currentDoc) return;
    if (panel.contains(document.activeElement)) return;
    lines = tickerMessagesFromDoc();
    sig = (currentDoc.ticker_enabled === false ? "0" : "1") + "|" +
      (currentDoc.ticker_interval_seconds || 600) + "|" +
      (currentDoc.ticker_duration_seconds || 20) + "|" +
      lines.join("\n");
    if (sig === tickerFormSig) return;
    tickerFormSig = sig;
    document.getElementById("ticker-enabled").checked = currentDoc.ticker_enabled !== false;
    document.getElementById("ticker-interval").value = String(Math.round((currentDoc.ticker_interval_seconds || 600) / 60));
    document.getElementById("ticker-duration").value = String(currentDoc.ticker_duration_seconds || 20);
    clear(document.getElementById("ticker-lines"));
    for (i = 0; i < lines.length; i++) addTickerLine(lines[i]);
  }

  function saveTickerForm(event) {
    var inputs = document.getElementById("ticker-lines").getElementsByTagName("input");
    var lines = [];
    var minutes;
    var seconds;
    var i;
    event.preventDefault();
    for (i = 0; i < inputs.length; i++) {
      if (inputs[i].value.replace(/^\s+|\s+$/g, "")) lines.push(inputs[i].value.replace(/^\s+|\s+$/g, ""));
    }
    if (!lines.length) {
      showBanner("Add at least one ticker line.");
      return;
    }
    minutes = parseInt(document.getElementById("ticker-interval").value, 10);
    seconds = parseInt(document.getElementById("ticker-duration").value, 10);
    if (!minutes || minutes < 1) minutes = 1;
    if (minutes > 1440) minutes = 1440;
    if (!seconds || seconds < 5) seconds = 5;
    if (seconds > 180) seconds = 180;
    currentDoc.ticker_enabled = document.getElementById("ticker-enabled").checked;
    currentDoc.ticker_interval_seconds = minutes * 60;
    currentDoc.ticker_duration_seconds = seconds;
    currentDoc.ticker_messages = lines;
    tickerFormSig = "";
    saveDoc("Subscribe ticker saved. Each ground picks it up on the next poll.");
  }

  function stampTicker(groundIds) {
    var stamp = new Date().toISOString();
    var i;
    var ground;
    var hit = false;
    if (!currentDoc) return;
    for (i = 0; i < currentDoc.grounds.length; i++) {
      ground = currentDoc.grounds[i];
      if (groundIds && indexOf(groundIds, ground.id) === -1) continue;
      ground.ticker_trigger_at = stamp;
      hit = true;
    }
    if (!hit) return;
    if (!isFullAdmin() && store.writeGround) {
      if (!groundIds) {
        showBanner("Showing the ticker on every ground is for a full Pulse Play admin.");
        return;
      }
      (function writeNext(index) {
        var target;
        if (index >= groundIds.length) {
          showBanner("");
          setText(document.getElementById("save-hint"), "Subscribe ticker will scroll once on this ground.");
          return;
        }
        target = findGround(currentDoc, groundIds[index]);
        if (!target) { writeNext(index + 1); return; }
        store.writeGround(target, { live: true }, function (err) {
          if (err) { showBanner(err.message || "Could not save."); return; }
          writeNext(index + 1);
        });
      })(0);
      return;
    }
    saveDoc(groundIds ? "Subscribe ticker will scroll once on this ground." : "Subscribe ticker will scroll once on every ground.");
  }

  function openGround(id) {
    var ground = findGround(currentDoc, id);
    if (!ground) return;
    currentId = id;
    actionSig = "";
    document.getElementById("ground-select").value = id;
    showTab("controls");
    renderStatus();
    renderActions();
    window.scrollTo(0, 0);
  }

  function deleteAsset(id) {
    var asset = findAsset(currentDoc, id);
    var next = [];
    var i;
    var ground;
    var kept;
    var n;
    var slot;
    if (!asset) return;
    if (!window.confirm("Delete " + asset.label + " from the library?")) return;
    for (i = 0; i < currentDoc.assets.length; i++) {
      if (currentDoc.assets[i].id !== id) next.push(currentDoc.assets[i]);
    }
    currentDoc.assets = next;
    for (i = 0; i < currentDoc.grounds.length; i++) {
      ground = currentDoc.grounds[i];
      kept = [];
      for (n = 0; n < (ground.ad_ids || []).length; n++) {
        if (ground.ad_ids[n] !== id) kept.push(ground.ad_ids[n]);
      }
      ground.ad_ids = kept;
      if (ground.active_ad === id) {
        ground.mode = "logos_score";
        ground.active_ad = null;
        ground.updated_at = new Date().toISOString();
      }
      if (ground.logos) {
        for (slot in ground.logos) {
          if (ground.logos.hasOwnProperty(slot) && ground.logos[slot] === id) ground.logos[slot] = "";
        }
      }
    }
    store.deleteBlob(asset.storage_path || id, function () {
      librarySig = "";
      logoSig = "";
      actionSig = "";
      setupSig = null;
      saveDoc("Deleted " + asset.label + ".");
    });
  }

  function clearGroundErrors() {
    var ids = ["err-name", "err-id", "err-short", "err-score"];
    var i;
    for (i = 0; i < ids.length; i++) setText(document.getElementById(ids[i]), "");
  }

  function setSaveStatus(kind, text) {
    var el = document.getElementById("save-ground-status");
    var btn = document.getElementById("btn-save-ground");
    if (el) {
      el.className = "save-status" + (kind ? " is-" + kind : "");
      setText(el, text || "");
    }
    if (btn) btn.disabled = kind === "saving";
  }

  function onSaveGround(event) {
    var select = document.getElementById("setup-select");
    var isNew = select.value === "__new__";
    var name = document.getElementById("field-name").value.replace(/^\s+|\s+$/g, "");
    var id = document.getElementById("field-id").value.replace(/^\s+|\s+$/g, "");
    var shortLink = document.getElementById("field-short").value.replace(/^\s+|\s+$/g, "");
    var device = window.PulsePlayDevice.savedDevice();
    var scoreUrl = document.getElementById("field-score").value.replace(/^\s+|\s+$/g, "");
    var existing = isNew ? null : findGround(currentDoc, select.value);
    var ground;
    var i;
    var adIds;
    var layout;
    var external;
    var live;
    var message;
    event.preventDefault();
    clearGroundErrors();
    if (!name) setText(document.getElementById("err-name"), "Enter a ground name.");
    if (!shortLink) setText(document.getElementById("err-short"), "Enter a short URL.");
    if (!scoreUrl) setText(document.getElementById("err-score"), "Enter a CricClubs URL.");
    if (!name || !shortLink || !scoreUrl) {
      message = "Name, short URL, and CricClubs URL are required.";
      setSaveStatus("err", message);
      showBanner(message);
      return;
    }
    if (!id) id = slug(name);
    if (!/^[a-z0-9-]+$/.test(id)) {
      message = "Id can only use lowercase letters, numbers, and hyphens.";
      setText(document.getElementById("err-id"), message);
      setSaveStatus("err", message);
      showBanner(message);
      return;
    }
    if (isNew && findGround(currentDoc, id)) {
      message = "A ground with that id already exists.";
      setText(document.getElementById("err-id"), message);
      setSaveStatus("err", message);
      showBanner(message);
      return;
    }
    if (!store.writeGround) {
      message = "This store cannot save one ground on its own.";
      setSaveStatus("err", message);
      showBanner(message);
      return;
    }
    adIds = checkedAdIds();
    layout = !existing || layoutDirty ? readLayoutForm() : existing.layout;
    if (window.PulsePlayLayout.isDefault(layout)) layout = null;
    external = !existing || externalDirty ? document.getElementById("field-external").checked : existing.external_video_audio === true;
    live = !existing;
    ground = {
      id: id,
      name: name,
      short_link: shortLink,
      device: device,
      resolved_url: resolvedFor(id),
      score_url: scoreUrl,
      score_overlays: freshScoreOverlays(existing, id, scoreUrl),
      logos: {
        age_group_sponsor: document.getElementById("pick-age").value,
        tournament: document.getElementById("pick-tournament").value,
        cricketcraze: document.getElementById("pick-ccusa").value
      },
      layout: layout,
      external_video_audio: external,
      show_subscribe_ticker: document.getElementById("field-ticker") ? document.getElementById("field-ticker").checked : (existing ? existing.show_subscribe_ticker !== false : true),
      ad_ids: adIds,
      mode: existing ? (existing.mode || "logos_score") : "logos_score",
      active_ad: existing ? existing.active_ad : null,
      updated_at: existing ? existing.updated_at : new Date().toISOString(),
      ticker_trigger_at: existing ? existing.ticker_trigger_at || null : null
    };
    if (ground.active_ad && indexOf(adIds, ground.active_ad) === -1) {
      ground.mode = "logos_score";
      ground.active_ad = null;
      ground.updated_at = new Date().toISOString();
      live = true;
    }
    setSaveStatus("saving", "Saving…");
    showBanner("");
    store.writeGround(ground, { live: live }, function (err, saved, count) {
      var when;
      var note;
      if (err || !count) {
        note = (err && err.message) || "Saved 0 rows. This account may not be allowed to update " + name + ".";
        setSaveStatus("err", note);
        showBanner(note);
        return;
      }
      if (!existing) currentDoc.grounds.push(saved || ground);
      else {
        for (i = 0; i < currentDoc.grounds.length; i++) {
          if (currentDoc.grounds[i].id === ground.id) currentDoc.grounds[i] = saved || ground;
        }
      }
      currentId = ground.id;
      layoutDirty = false;
      externalDirty = false;
      setupSig = null;
      centerSig = "";
      actionSig = "";
      controlsSig = "";
      when = formatTime(ground.updated_at);
      note = "Saved " + ground.name + " at " + when;
      setSaveStatus("ok", note);
      showBanner(note, "ok");
      document.getElementById("setup-select").value = ground.id;
      loadSetupForm();
    });
  }

  function onDeleteGround() {
    var id = document.getElementById("setup-select").value;
    var ground = findGround(currentDoc, id);
    var next = [];
    var i;
    if (!ground) return;
    if (!window.confirm("Delete " + ground.name + "?")) return;
    for (i = 0; i < currentDoc.grounds.length; i++) {
      if (currentDoc.grounds[i].id !== id) next.push(currentDoc.grounds[i]);
    }
    if (!next.length) {
      showBanner("Keep at least one ground.");
      return;
    }
    currentDoc.grounds = next;
    if (currentId === id) currentId = next[0].id;
    setupSig = null;
    centerSig = "";
    actionSig = "";
    controlsSig = "";
    saveDoc("Deleted " + ground.name + ".");
  }

  var adConvertToken = 0;
  var preparingAd = false;
  var preparedAd = null;

  function isStillAdFile(file) {
    return !!(file && (isPng(file) || isJpeg(file) || isPdf(file)));
  }

  function isAdFile(file) {
    return !!(file && (isMp4(file) || isStillAdFile(file)));
  }

  function hideAdPreview() {
    var preview = document.getElementById("ad-convert-preview");
    if (!preview) return;
    if (preview.getAttribute("src")) {
      try { URL.revokeObjectURL(preview.src); } catch (e) {}
    }
    preview.removeAttribute("src");
    preview.classList.add("is-off");
  }

  function showAdPreview(file) {
    var preview = document.getElementById("ad-convert-preview");
    hideAdPreview();
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("is-off");
  }

  function clearAdForm() {
    adConvertToken += 1;
    preparingAd = false;
    preparedAd = null;
    hideAdPreview();
    document.getElementById("ad-form").reset();
    document.getElementById("ad-warn").classList.add("is-off");
  }

  function adUploadFile(file) {
    if (isPdf(file)) {
      if (preparingAd) return { error: "Still converting that PDF. The preview appears when page 1 is ready." };
      if (!preparedAd || preparedAd.key !== fileKey(file)) return { error: "That PDF did not convert. Choose it again." };
      return { file: preparedAd.file, image: true };
    }
    if (isJpeg(file)) return { file: jpegFile(file), image: true };
    if (isPng(file)) return { file: file, image: true };
    return { file: file, image: false };
  }

  function onAdFile(file) {
    var warn = document.getElementById("ad-warn");
    var token;
    adConvertToken += 1;
    token = adConvertToken;
    preparingAd = false;
    preparedAd = null;
    hideAdPreview();
    if (!file) {
      warn.classList.add("is-off");
      return;
    }
    if (!isAdFile(file)) {
      setText(warn, "Ads must be MP4, PNG, JPG, or PDF.");
      warn.classList.remove("is-off");
      return;
    }
    if (isPdf(file)) {
      preparingAd = true;
      setText(warn, "Converting page 1 to a PNG…");
      warn.classList.remove("is-off");
      pdfToPng(file, { maxWidth: 1920, maxHeight: 1080 }, function (err, pngFile) {
        if (token !== adConvertToken) return;
        preparingAd = false;
        if (err) {
          setText(warn, err.message || "Could not convert that PDF.");
          return;
        }
        preparedAd = { key: fileKey(file), file: pngFile };
        showAdPreview(pngFile);
        setText(warn, "Page 1 converted to a PNG that fits in 1920×1080. This preview is what will be saved. An image stays on screen until you switch.");
      });
      return;
    }
    if (!isMp4(file)) {
      setText(warn, "An image stays on screen until you switch. It does not auto-return.");
      warn.classList.remove("is-off");
      return;
    }
    if (adOverFreePlan(file)) {
      setText(warn, useSupabase
        ? adFreePlanError(file)
        : "This file is " + mb(file.size) + ". Each YoloBox preloads its assigned ads over the ground's internet.");
      warn.classList.remove("is-off");
      return;
    }
    warn.classList.add("is-off");
  }

  function onAddAd(event) {
    var fileInput = document.getElementById("ad-file");
    var file = fileInput.files && fileInput.files[0];
    var label = document.getElementById("ad-label").value.replace(/^\s+|\s+$/g, "");
    var description = document.getElementById("ad-description").value.replace(/^\s+|\s+$/g, "");
    var upload;
    var id;
    event.preventDefault();
    if (!label) { showBanner("Give the ad a label."); return; }
    if (!file) { showBanner("Choose an MP4, PNG, JPG, or PDF."); return; }
    if (!isAdFile(file)) { showBanner("Ads must be MP4, PNG, JPG, or PDF."); return; }
    if (useSupabase && adOverFreePlan(file)) {
      showBanner(adFreePlanError(file));
      return;
    }
    if (!useSupabase && isMp4(file) && file.size > window.PulsePlayStore.MAX_BYTES) {
      showBanner("That MP4 is " + mb(file.size) + ", over the " + mb(window.PulsePlayStore.MAX_BYTES) + " limit for this browser.");
      return;
    }
    if (!useSupabase && isMp4(file) && adOverFreePlan(file)) {
      if (!window.confirm("This file is " + mb(file.size) + ". Each YoloBox preloads its assigned ads over the ground's internet. Save it anyway?")) return;
    }
    upload = adUploadFile(file);
    if (upload.error) { showBanner(upload.error); return; }
    try { upload.file.adFolder = "ads"; } catch (e) {}
    id = "upload-" + new Date().getTime();
    readVideoDuration(upload.image ? null : upload.file, function (seconds) {
    store.putBlob(id, upload.file, function (err, info) {
      if (err) { showBanner(err.message || "Upload failed."); return; }
      currentDoc.assets.push(assetFromUpload(id, "ad", label, description, info, upload.file, {
        auto_return: upload.image ? null : true,
        logo_type: null,
        media_type: upload.image ? "image" : "video",
        duration_seconds: seconds
      }));
      clearAdForm();
      librarySig = "";
      setupSig = null;
      actionSig = "";
      saveDoc("Added " + label + " to the library. Assign it to a ground before it can go on air.");
    });
    });
  }

  function readVideoDurationFromUrl(url, revoke, callback) {
    var video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = function () {
      var seconds = video.duration;
      if (revoke) URL.revokeObjectURL(url);
      callback(isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) / 1000 : null);
    };
    video.onerror = function () {
      if (revoke) URL.revokeObjectURL(url);
      callback(null);
    };
    video.src = url;
  }

  function readVideoDuration(file, callback) {
    if (!file) { callback(null); return; }
    readVideoDurationFromUrl(URL.createObjectURL(file), true, callback);
  }

  var durationBackfillStarted = false;

  function backfillMissingDurations() {
    var ids = [];
    var i;
    var asset;
    if (durationBackfillStarted || !currentDoc || !currentDoc.assets) return;
    durationBackfillStarted = true;
    for (i = 0; i < currentDoc.assets.length; i++) {
      asset = currentDoc.assets[i];
      if (asset.kind === "ad" && asset.media_type !== "image" && !(Number(asset.duration_seconds) > 0)) {
        ids.push(asset.id);
      }
    }
    if (ids.length) probeDurationQueue(ids, 0, false);
  }

  function probeDurationQueue(ids, index, changed) {
    var asset;
    if (!currentDoc) return;
    if (index >= ids.length) {
      if (changed) saveDoc("Saved video lengths for ads that were missing one.");
      return;
    }
    asset = findAsset(currentDoc, ids[index]);
    if (!asset || Number(asset.duration_seconds) > 0 || !asset.src) {
      probeDurationQueue(ids, index + 1, changed);
      return;
    }
    store.mediaUrl(asset.src, function (err, url) {
      if (err || !url) {
        probeDurationQueue(ids, index + 1, changed);
        return;
      }
      readVideoDurationFromUrl(url, false, function (seconds) {
        var live = currentDoc ? findAsset(currentDoc, ids[index]) : null;
        if (live && !(Number(live.duration_seconds) > 0) && seconds) {
          live.duration_seconds = seconds;
          changed = true;
        }
        probeDurationQueue(ids, index + 1, changed);
      });
    });
  }

  function clearLogoForm() {
    var warn = document.getElementById("logo-warn");
    logoConvertToken += 1;
    preparingLogo = false;
    preparedLogo = null;
    hideLogoPreview();
    document.getElementById("logo-form").reset();
    document.getElementById("logo-type").value = "other";
    setText(document.getElementById("logo-scale-readout"), "100%");
    warn.classList.add("is-off");
    setText(warn, "");
  }

  function logoToSave(file) {
    if (isPdf(file)) {
      if (preparingLogo) return { error: "Still converting that PDF. The preview appears when page 1 is ready." };
      if (!preparedLogo || preparedLogo.key !== fileKey(file)) return { error: "That PDF did not convert. Choose it again." };
      return { file: preparedLogo.file };
    }
    if (isJpeg(file)) return { file: jpegFile(file) };
    return { file: file };
  }

  function onLogoFile(file) {
    var warn = document.getElementById("logo-warn");
    var token;
    logoConvertToken += 1;
    token = logoConvertToken;
    preparingLogo = false;
    preparedLogo = null;
    hideLogoPreview();
    if (!file) {
      warn.classList.add("is-off");
      setText(warn, "");
      return;
    }
    if (!isLogoFile(file)) {
      setText(warn, "Logos must be PNG, WebP, SVG, JPG, or PDF.");
      warn.classList.remove("is-off");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setText(warn, "That logo is " + mb(file.size) + ", over 8 MB.");
      warn.classList.remove("is-off");
      return;
    }
    if (isPdf(file)) {
      preparingLogo = true;
      setText(warn, "Converting page 1 to a PNG…");
      warn.classList.remove("is-off");
      pdfToPng(file, function (err, pngFile) {
        if (token !== logoConvertToken) return;
        preparingLogo = false;
        if (err) {
          setText(warn, err.message || "Could not convert that PDF.");
          return;
        }
        preparedLogo = { key: fileKey(file), file: pngFile };
        showLogoPreview(pngFile);
        setText(warn, "Page 1 converted to PNG. This preview is what will be saved.");
      });
      return;
    }
    if (isJpeg(file)) {
      setText(warn, "JPGs have no transparency, so they show as a solid box on the stream. PNG is best." +
        (file.size > 2 * 1024 * 1024 ? " This logo is " + mb(file.size) + ". It will still be saved, but a smaller file loads faster on the YoloBox." : ""));
      warn.classList.remove("is-off");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setText(warn, "This logo is " + mb(file.size) + ". It will still be saved, but a smaller file loads faster on the YoloBox.");
      warn.classList.remove("is-off");
      return;
    }
    warn.classList.add("is-off");
    setText(warn, "");
  }

  function onAddLogo(event) {
    var fileInput = document.getElementById("logo-file");
    var file = fileInput.files && fileInput.files[0];
    var label = document.getElementById("logo-label").value.replace(/^\s+|\s+$/g, "");
    var description = document.getElementById("logo-description").value.replace(/^\s+|\s+$/g, "");
    var logoType = document.getElementById("logo-type").value;
    var upload;
    var id;
    event.preventDefault();
    if (!label) { showBanner("Give the logo a name."); return; }
    if (!file) { showBanner("Choose a PNG, WebP, SVG, JPG, or PDF."); return; }
    if (!isLogoFile(file)) { showBanner("Logos must be PNG, WebP, SVG, JPG, or PDF."); return; }
    if (file.size > 8 * 1024 * 1024) {
      showBanner("That logo is " + mb(file.size) + ", over 8 MB.");
      return;
    }
    upload = logoToSave(file);
    if (upload.error) { showBanner(upload.error); return; }
    if (upload.file.size > 8 * 1024 * 1024) {
      showBanner("That logo is " + mb(upload.file.size) + ", over 8 MB.");
      return;
    }
    id = "logo-" + new Date().getTime();
    store.putBlob(id, upload.file, function (err, info) {
      if (err) { showBanner(err.message || "Upload failed."); return; }
      currentDoc.assets.push(assetFromUpload(id, "logo", label, description, info, upload.file, {
        auto_return: null,
        logo_type: logoType,
        logo_scale: Number(document.getElementById("logo-scale").value) === 100 ? null : Number(document.getElementById("logo-scale").value) / 100
      }));
      clearLogoForm();
      logoSig = "";
      setupSig = null;
      saveDoc("Added " + label + " to the logo library. Pick it on a ground to put it on air.");
    });
  }

  document.getElementById("tab-streams").onclick = function () { showTab("streams"); };
  document.getElementById("tab-wall").onclick = function () { showTab("wall"); };
  document.getElementById("tab-setup-home").onclick = function () { showTab("setup-home"); };
  document.getElementById("tab-controls").onclick = function () { showTab("controls"); };
  document.getElementById("tab-center").onclick = function () { showTab("center"); };
  document.getElementById("tab-library").onclick = function () { showTab("library"); };
  document.getElementById("tab-logos").onclick = function () { showTab("logos"); };
  document.getElementById("tab-setup").onclick = function () { showTab("setup"); };
  document.getElementById("tab-ticker").onclick = function () { showTab("ticker"); };
  document.getElementById("tab-broadcasts").onclick = function () { showTab("broadcasts"); };
  document.getElementById("tab-access").onclick = function () { showTab("access"); };
  document.getElementById("ground-select").onchange = function () {
    currentId = this.value;
    actionSig = "";
    renderStatus();
    renderActions();
  };
  document.getElementById("poll-seconds").onchange = function () {
    savePollSeconds(this.value);
  };
  document.getElementById("external-video").onchange = function () {
    if (!currentId) return;
    patch(currentId, { external_video_audio: this.checked });
  };
  document.getElementById("score-switch-save").onclick = addScoreOverlay;
  document.getElementById("show-ticker").onchange = function () {
    if (!currentId) return;
    patch(currentId, { show_subscribe_ticker: this.checked }, { keepUpdatedAt: true });
  };
  document.getElementById("btn-ticker-now").onclick = function () {
    if (!currentId) return;
    stampTicker([currentId]);
  };
  document.getElementById("btn-ticker-all").onclick = function () { stampTicker(null); };
  document.getElementById("btn-ticker-add").onclick = function () { addTickerLine(""); };
  document.getElementById("ticker-form").onsubmit = saveTickerForm;
  document.getElementById("score-switch-url").oninput = function () {
    var box = document.getElementById("score-full-size");
    refreshScoreSwitchDraftWarn();
    if (scoreFullTouched || !box || !window.PulsePlayScore.frameScale) return;
    box.checked = window.PulsePlayScore.frameScale(this.value, null) !== 2.15;
  };
  document.getElementById("score-full-size").onchange = function () { scoreFullTouched = true; };
  document.getElementById("field-score").oninput = function () {
    refreshScoreWarn();
    fitPreviewScore();
    placePreviewTicker();
  };
  document.getElementById("field-external").onchange = function () { externalDirty = true; };
  document.getElementById("btn-duplicate-ground").onclick = duplicateGround;
  (function wirePollPicks() {
    var buttons = document.getElementById("poll-picks").getElementsByTagName("button");
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].onclick = function () {
        savePollSeconds(this.getAttribute("data-seconds"));
      };
    }
  })();
  document.getElementById("ad-file").onchange = function () {
    onAdFile(this.files && this.files[0]);
  };
  document.getElementById("ad-form").onsubmit = onAddAd;
  document.getElementById("setup-select").onchange = loadSetupForm;
  document.getElementById("field-name").oninput = function () {
    var idInput;
    if (document.getElementById("setup-select").value !== "__new__" || idTouched) return;
    idInput = document.getElementById("field-id");
    idInput.value = slug(this.value);
  };
  document.getElementById("field-id").oninput = function () { idTouched = true; };
  document.getElementById("ground-form").onsubmit = onSaveGround;
  document.getElementById("btn-delete-ground").onclick = onDeleteGround;
  document.getElementById("pick-age").onchange = function () { previewPickedLogo("pick-age", "preview-age"); renderLayoutPreview(); };
  document.getElementById("pick-tournament").onchange = function () { previewPickedLogo("pick-tournament", "preview-tournament"); renderLayoutPreview(); };
  document.getElementById("pick-ccusa").onchange = function () { previewPickedLogo("pick-ccusa", "preview-ccusa"); renderLayoutPreview(); };
  document.getElementById("field-device").onchange = renderLayoutPreview;
  document.getElementById("btn-layout-reset").onclick = function () {
    writeLayoutForm(null);
    renderLayoutPreview();
  };
  document.getElementById("btn-ccusa-default").onclick = function () {
    document.getElementById("pick-ccusa").value = "logo-cricketcraze";
    previewPickedLogo("pick-ccusa", "preview-ccusa");
    renderLayoutPreview();
  };
  document.getElementById("logo-scale").oninput = function () {
    setText(document.getElementById("logo-scale-readout"), this.value + "%");
  };
  buildLayoutControls();
  window.addEventListener("resize", renderLayoutPreview);
  document.getElementById("logo-file").onchange = function () {
    onLogoFile(this.files && this.files[0]);
  };
  document.getElementById("logo-form").onsubmit = onAddLogo;
  if (document.getElementById("btn-reset-stuck")) {
    document.getElementById("btn-reset-stuck").onclick = function () { resetAllStuck(); };
  }
  window.setInterval(function () {
    if (!currentDoc || !currentDoc.grounds) return;
    renderCenter();
  }, 15000);
  document.getElementById("btn-reset").onclick = function () {
    if (!window.confirm("Replace this browser's mock config and delete uploaded files?")) return;
    store.reset(function (err, doc) {
      if (err) { showBanner(err.message || "Reset failed."); return; }
      currentDoc = doc;
      currentId = doc.grounds[0] ? doc.grounds[0].id : "";
      actionSig = "";
      centerSig = "";
      librarySig = "";
      logoSig = "";
      setupSig = null;
      controlsSig = "";
      showBanner("");
      renderAll();
      setText(document.getElementById("save-hint"), "Mock store reset to the example config.");
    });
  };

  function showSignIn() {
    document.getElementById("not-admin").classList.add("is-off");
    document.getElementById("dashboard").classList.add("is-off");
    document.getElementById("sign-in").classList.remove("is-off");
  }

  function hideSignIn() {
    document.getElementById("sign-in").classList.add("is-off");
    document.getElementById("not-admin").classList.add("is-off");
    document.getElementById("dashboard").classList.remove("is-off");
  }

  function showNotAdmin(email) {
    document.getElementById("sign-in").classList.add("is-off");
    document.getElementById("dashboard").classList.add("is-off");
    document.getElementById("not-admin").classList.remove("is-off");
    setText(document.getElementById("not-admin-email"), email || "");
  }

  function adminRedirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  function showSignError(message) {
    var errEl = document.getElementById("sign-error");
    setText(errEl, message || "");
    if (message) errEl.classList.remove("is-off");
    else errEl.classList.add("is-off");
  }

  function boot() {
    if (useSupabase) {
      document.getElementById("btn-reset").classList.add("is-off");
      document.getElementById("btn-sign-out").classList.remove("is-off");
      setText(document.querySelector(".foot p"), "Live store: Supabase project cheetahs-club. Sign in with a club admin account to add grounds, ads, and logos. Add ?adapter=mock to this URL to use the local example instead.");
    }
    store.read(function (err, doc) {
      if (err) { showBanner(err.message || "Could not read config."); return; }
      currentDoc = doc;
      currentId = doc.grounds[0] ? doc.grounds[0].id : "";
      renderAll();
      backfillMissingDurations();
    });
    store.subscribe(function (err, doc) {
      if (err || !doc) return;
      currentDoc = doc;
      renderAll();
    });
    window.setInterval(function () {
      if (polling || !currentDoc) return;
      polling = true;
      store.read(function (err, doc) {
        polling = false;
        if (err || !doc) return;
        currentDoc = doc;
        renderAll();
      });
    }, (window.PulsePlayRuntime && window.PulsePlayRuntime.pollMs) || window.PulsePlayStore.DEFAULT_POLL_MS);
  }

  var authClient = null;
  var dashboardStarted = false;
  var accessRole = "admin";

  function hideNode(id, hidden) {
    var node = document.getElementById(id);
    if (node) node.classList.toggle("is-off", !!hidden);
  }

  function applyAccess(summary) {
    var operatorOnly;
    window.PulsePlayAccess = summary;
    operatorOnly = !summary.setup && !summary.broadcasts && !summary.manage;
    accessRole = operatorOnly ? "operator" : "admin";
    hideNode("tab-setup-home", !summary.setup);
    hideNode("tab-broadcasts", !summary.broadcasts);
    hideNode("tab-access", !summary.manage);
    hideNode("tab-library", !summary.fullAdmin);
    hideNode("tab-logos", !summary.fullAdmin);
    hideNode("tab-ticker", !summary.fullAdmin);
    hideNode("btn-delete-ground", !summary.fullAdmin);
    hideNode("btn-ticker-all", !summary.fullAdmin);
    var poll = document.getElementById("poll-seconds");
    var picks = document.getElementById("poll-picks");
    if (poll) poll.disabled = !summary.fullAdmin;
    if (picks) picks.classList.toggle("is-off", !summary.fullAdmin);
    if (operatorOnly) showTab("streams");
  }

  function enterDashboard(summary) {
    var intro = document.getElementById("streams-intro");
    applyAccess(summary);
    showSignError("");
    hideSignIn();
    if (intro) {
      setText(intro, summary.fullAdmin
        ? "Today and upcoming CricketCrazeUSA games. Start and End use the same YouTube connection as Broadcasts."
        : summary.setup
          ? "Your tournament only. Grounds, the live wall, and broadcasts outside it stay hidden."
          : "Your games only. Start and End stay inside your access. Setup stays with an admin.");
    }
    if (!dashboardStarted) {
      dashboardStarted = true;
      boot();
    }
    if (summary.broadcasts) maybeOpenBroadcasts();
    if (window.PulsePlayStreams && !document.getElementById("panel-streams").classList.contains("is-off")) {
      window.PulsePlayStreams.show();
    }
  }

  function fullSignOut(done) {
    function clearStore() {
      store.signOut(function () {
        currentDoc = null;
        dashboardStarted = false;
        showSignIn();
        if (done) done();
      });
    }
    if (authClient && authClient.auth) {
      authClient.auth.signOut().then(clearStore).catch(clearStore);
      return;
    }
    clearStore();
  }

  function admitSession(session) {
    if (!session || !session.access_token) {
      showSignIn();
      return;
    }
    store.adoptSession(session, function () {
      store.fetchRole(function (err, role) {
        var email = session.user && session.user.email;
        if (err) {
          showNotAdmin(email);
          setText(document.getElementById("not-admin-email"), "Could not check your club role. Sign out and try again.");
          return;
        }
        if (role === "admin") {
          enterDashboard(window.PulsePlayScope.legacyAdmin());
          return;
        }
        loadAccess(email);
      });
    });
  }

  function loadAccess(email) {
    function legacy() {
      if (!authClient) {
        showNotAdmin(email);
        return;
      }
      authClient.from("pp_admins").select("id").eq("active", true).limit(1).then(function (adminResult) {
        if (!adminResult.error && adminResult.data && adminResult.data.length) {
          enterDashboard(window.PulsePlayScope.legacyAdmin());
          return;
        }
        authClient.from("pp_operators").select("divisions, active").eq("active", true).then(function (result) {
          var row = result.data && result.data[0];
          if (result.error || !row || !row.divisions || !row.divisions.length) {
            showNotAdmin(email);
            return;
          }
          enterDashboard(window.PulsePlayScope.legacyOperator(row.divisions));
        }).catch(function () {
          showNotAdmin(email);
        });
      }).catch(function () {
        showNotAdmin(email);
      });
    }
    if (!authClient || !authClient.functions || !window.PulsePlayScope) {
      legacy();
      return;
    }
    authClient.functions.invoke("pp-access", { body: { action: "me" } }).then(function (result) {
      var summary;
      if (result.error || !result.data || result.data.error) {
        legacy();
        return;
      }
      window.PulsePlayCatalog = {
        tournaments: result.data.tournaments || [],
        ageGroups: result.data.ageGroups || []
      };
      summary = window.PulsePlayScope.summaryFromMe(result.data);
      if (!summary.allowed) {
        showNotAdmin(email);
        return;
      }
      enterDashboard(summary);
    }).catch(function () {
      legacy();
    });
  }

  document.getElementById("btn-google").onclick = function () {
    if (!authClient || !authClient.auth) {
      showSignError("Google sign-in did not load. Use email and password, or reload the page.");
      return;
    }
    showSignError("");
    authClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: adminRedirectUrl() }
    }).then(function (result) {
      if (result && result.error) showSignError(result.error.message || "Google sign-in could not be started.");
    }).catch(function (err) {
      showSignError(err && err.message ? err.message : "Google sign-in could not be started.");
    });
  };

  document.getElementById("sign-in-form").onsubmit = function (event) {
    var email = document.getElementById("sign-email").value;
    var password = document.getElementById("sign-password").value;
    event.preventDefault();
    showSignError("");
    if (authClient && authClient.auth) {
      authClient.auth.signInWithPassword({ email: email, password: password }).then(function (result) {
        document.getElementById("sign-password").value = "";
        if (result && result.error) showSignError(result.error.message || "Sign-in failed.");
      }).catch(function (err) {
        showSignError(err && err.message ? err.message : "Sign-in failed.");
      });
      return;
    }
    store.signIn(email, password, function (err) {
      document.getElementById("sign-password").value = "";
      if (err) { showSignError(err.message || "Sign-in failed."); return; }
      store.getSession(function (session) { admitSession(session); });
    });
  };
  document.getElementById("btn-sign-out").onclick = function () { fullSignOut(); };
  document.getElementById("btn-not-admin-out").onclick = function () { fullSignOut(); };

  (function applyLibraryCopy() {
    if (useSupabase) return;
    setText(document.getElementById("ad-library-intro"), "Upload an MP4, PNG, JPG, or a one-page PDF (saved as a PNG). It becomes selectable in Ground setup. Files stay in this browser's IndexedDB, so a YoloBox will not see them yet.");
    setText(document.getElementById("logo-library-intro"), "Upload a PNG, WebP, SVG, or JPG. A PDF is converted to a PNG of page 1 in this browser. Files stay in this browser's IndexedDB, so a YoloBox will not see them yet.");
  })();

  if (!useSupabase) {
    hideSignIn();
    boot();
    maybeOpenBroadcasts();
    if (window.PulsePlayStreams) window.PulsePlayStreams.show();
  } else if (!window.supabase || !window.supabase.createClient) {
    showSignIn();
    showSignError("Google sign-in did not load. Email and password still work if this message is a network blip — reload to try Google again.");
    store.getSession(function (session) {
      if (session) admitSession(session);
    });
  } else {
    authClient = window.PulsePlaySupabase.get();
    if (window.PulsePlayTabs) window.PulsePlayTabs.attach(authClient);
    var inviteToken = queryValue("token_hash");
    var inviteType = queryValue("type");
    if (inviteToken && (inviteType === "magiclink" || inviteType === "invite" || inviteType === "email" || inviteType === "signup")) {
      window.history.replaceState({}, "", window.location.origin + window.location.pathname);
      authClient.auth.verifyOtp({ token_hash: inviteToken, type: inviteType }).then(function (result) {
        if (result && result.error) showSignError("That sign-in link has expired. Ask Ben to resend the invite.");
      }).catch(function () {
        showSignError("That sign-in link has expired. Ask Ben to resend the invite.");
      });
    }
    authClient.auth.onAuthStateChange(function (event, session) {
      if (event === "SIGNED_OUT") {
        store.signOut(function () {
          currentDoc = null;
          dashboardStarted = false;
          showSignIn();
        });
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        if (session) store.adoptSession(session);
        return;
      }
      if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN") return;
      if (!session) {
        showSignIn();
        return;
      }
      admitSession(session);
    });
  }
  window.PulsePlayAdmin = {
    openGround: openGround,
    grounds: function () { return scopedGrounds(); },
    noteStreams: function (rows) {
      window.PulsePlayAccessStreams = rows || [];
      centerSig = "";
      controlsSig = "";
      setupSig = null;
      if (currentDoc) renderAll();
    }
  };
})();
