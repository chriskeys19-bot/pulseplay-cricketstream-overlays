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
  var idTouched = false;
  var polling = false;
  var POLL_MIN_SECONDS = 2;
  var POLL_MAX_SECONDS = 300;

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function showBanner(message) {
    var banner = document.getElementById("banner");
    setText(banner, message || "");
    if (message) banner.classList.remove("is-off");
    else banner.classList.add("is-off");
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

  function deviceLabel(device) {
    return device === "mini" ? "YoloBox Mini" : "YoloBox Pro";
  }

  function modeLabel(doc, ground) {
    var ad;
    if (ground.mode === "ad") {
      ad = findAd(doc, ground.active_ad);
      return "View 2: " + (ad ? ad.label : "Ad");
    }
    return "View 1: Logos + Score";
  }

  function resolvedFor(id, device) {
    return PAGES + "/renderer/" + device + ".html?ground=" + encodeURIComponent(id) + "&device=" + device;
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

  function fillGroundSelect(select, includeNew) {
    var previous = select.value;
    var i;
    var ground;
    clear(select);
    if (includeNew) select.appendChild(option("__new__", "+ New ground"));
    for (i = 0; i < currentDoc.grounds.length; i++) {
      ground = currentDoc.grounds[i];
      select.appendChild(option(ground.id, ground.name + " (" + (ground.device === "mini" ? "Mini" : "Pro") + ")"));
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
      return;
    }
    setText(document.getElementById("st-name"), ground.name);
    setText(document.getElementById("st-device"), deviceLabel(ground.device));
    setText(document.getElementById("st-short"), ground.short_link);
    document.getElementById("st-short").href = ground.short_link;
    setText(document.getElementById("st-resolved"), ground.resolved_url);
    document.getElementById("st-resolved").href = ground.resolved_url;
    setText(document.getElementById("st-active"), modeLabel(currentDoc, ground));
    setText(document.getElementById("st-score"), ground.score_url);
    document.getElementById("st-score").href = window.PulsePlayStore.safeUrl(ground.score_url) || "#";
    localLink.href = "renderer/" + ground.device + ".html?ground=" + encodeURIComponent(ground.id) + "&device=" + ground.device;
    setText(localLink, "Open " + (ground.device === "mini" ? "Mini" : "Pro") + " overlay for this ground");
    if (document.getElementById("external-video") && document.activeElement !== document.getElementById("external-video")) {
      document.getElementById("external-video").checked = ground.external_video_audio === true;
      document.getElementById("external-video").disabled = false;
    }
    renderScoreSwitch(ground);
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
        out.push({
          id: String(item.id || ((ground.id || "ground") + "-score-" + (i + 1))),
          name: String(item.name || ("Game " + (out.length + 1))),
          url: String(item.url).replace(/^\s+|\s+$/g, ""),
          active: item.active === true
        });
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
    if (!ground) return;
    if (!name || !url) {
      showBanner("Give the score overlay a name and a URL.");
      return;
    }
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
        list[i].active = true;
        reused = true;
      } else list[i].active = false;
    }
    if (!reused) list.push({ id: id, name: name, url: url, active: true });
    document.getElementById("score-switch-name").value = "";
    document.getElementById("score-switch-url").value = "";
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
        patch(ground.id, { mode: "logos_score", active_ad: null });
      }));
      for (i = 0; i < ids.length; i++) {
        (function (adId) {
          var ad = findAd(currentDoc, adId);
          if (!ad) return;
          bar.appendChild(makeAction(adId, ad.label, function () {
            patch(ground.id, { mode: "ad", active_ad: adId });
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
    var device = ground.device === "mini" ? "mini" : "pro";
    return "https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays/renderer/" +
      device + ".html?ground=" + encodeURIComponent(ground.id) + "&device=" + device;
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
      device: source.device || "pro",
      score: "",
      age: source.logos ? source.logos.age_group_sponsor : "",
      tournament: source.logos ? source.logos.tournament : "",
      ccusa: source.logos ? source.logos.cricketcraze : "",
      ads: (source.ad_ids || []).slice(),
      layout: source.layout || null,
      external: source.external_video_audio === true
    });
    showBanner("Copy of " + source.name + " is ready. Logos, layout, and ads were copied. Set a short URL and a new score URL. Saved score overlays were not copied.");
  }

  function childByClass(parent, className) {
    var nodes = parent.getElementsByClassName(className);
    return nodes.length ? nodes[0] : null;
  }

  function paintCard(card, ground) {
    var mode = childByClass(card, "card__mode");
    if (ground.mode === "ad") card.classList.add("card--ad");
    else card.classList.remove("card--ad");
    setText(childByClass(card, "card__name"), ground.name);
    setText(mode, modeLabel(currentDoc, ground));
    setText(childByClass(card, "card__time"), "Updated " + formatTime(ground.updated_at));
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
    pill.className = ground.device === "mini" ? "pill pill--mini" : "pill";
    setText(pill, ground.device === "mini" ? "Mini" : "Pro");
    head.appendChild(name);
    head.appendChild(pill);
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
    card.appendChild(head);
    card.appendChild(mode);
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
    var sig = groundIds().join("|") || "__empty__";
    var i;
    var card;
    var ground;
    var emptyNote;
    if (sig !== centerSig) {
      centerSig = sig;
      clear(grid);
      if (!currentDoc.grounds.length) {
        emptyNote = document.createElement("p");
        emptyNote.className = "hint";
        setText(emptyNote, "No grounds yet. Add the first one in Ground setup. Overlay pages stay transparent until a ground exists.");
        grid.appendChild(emptyNote);
        return;
      }
      for (i = 0; i < currentDoc.grounds.length; i++) grid.appendChild(buildCard(currentDoc.grounds[i]));
      return;
    }
    for (i = 0; i < currentDoc.grounds.length; i++) {
      ground = currentDoc.grounds[i];
      card = null;
      var cards = grid.getElementsByClassName("card");
      var n;
      for (n = 0; n < cards.length; n++) {
        if (cards[n].getAttribute("data-id") === ground.id) card = cards[n];
      }
      if (card) paintCard(card, ground);
    }
  }

  function groundIds() {
    var ids = [];
    var i;
    for (i = 0; i < currentDoc.grounds.length; i++) ids.push(currentDoc.grounds[i].id);
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
    age: "Age group",
    tournament: "Tournament",
    cricketcraze: "CricketCrazeUSA",
    score: "Score"
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
      scale = layoutField("layout-" + name + "-scale", "range", 25, 200, 5, 100);
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
      root.appendChild(box);
      scale.oninput = renderLayoutPreview;
      nudge.getElementsByTagName("input")[0].oninput = renderLayoutPreview;
      nudge.getElementsByTagName("input")[1].oninput = renderLayoutPreview;
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
      score: document.getElementById("layout-score")
    });
    setLayoutLogo("layout-age", age);
    setLayoutLogo("layout-tournament", tournament);
    setLayoutLogo("layout-ccusa", ccusa);
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
      external: document.getElementById("field-external").checked
    };
  }

  function applySetupDraft(draft) {
    var nodes;
    var i;
    document.getElementById("field-name").value = draft.name;
    document.getElementById("field-id").value = draft.id;
    idTouched = draft.idTouched;
    document.getElementById("field-short").value = draft.shortLink;
    document.getElementById("field-device").value = draft.device;
    document.getElementById("field-score").value = draft.score;
    document.getElementById("field-external").checked = !!draft.external;
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
        document.getElementById("field-device").value = "pro";
        document.getElementById("field-score").value = "";
        document.getElementById("field-external").checked = false;
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
      document.getElementById("field-device").value = ground.device;
      document.getElementById("field-score").value = ground.score_url;
      document.getElementById("field-external").checked = ground.external_video_audio === true;
      setText(document.getElementById("field-resolved"), "Resolves to " + ground.resolved_url);
      writeLayoutForm(ground.layout);
      refreshScoreWarn();
    } else {
      applySetupDraft(draft);
    }
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
    var panels = ["controls", "center", "library", "logos", "setup"];
    var i;
    var panel;
    var tab;
    for (i = 0; i < panels.length; i++) {
      panel = document.getElementById("panel-" + panels[i]);
      tab = document.getElementById("tab-" + panels[i]);
      if (panels[i] === name) {
        panel.classList.remove("is-off");
        tab.classList.add("is-active");
      } else {
        panel.classList.add("is-off");
        tab.classList.remove("is-active");
      }
    }
    if (name === "center") renderCenter();
    if (name === "library") renderLibrary();
    if (name === "logos") renderLogoLibrary();
    if (name === "setup") renderSetupList();
  }

  function renderAll() {
    var select = document.getElementById("ground-select");
    var sig = groundIds().join("|");
    if (sig !== controlsSig) {
      controlsSig = sig;
      fillGroundSelect(select, false);
      if (!(currentId && findGround(currentDoc, currentId)) && currentDoc.grounds[0]) {
        currentId = currentDoc.grounds[0].id;
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
  }

  function saveDoc(hint) {
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
    if (!ground) return;
    for (key in fields) {
      if (fields.hasOwnProperty(key)) ground[key] = fields[key];
    }
    if (!opts || !opts.keepUpdatedAt) ground.updated_at = new Date().toISOString();
    saveDoc("Saved " + ground.name + " at " + formatTime(ground.updated_at) + ". The overlay follows within about 2 seconds, often sooner in this browser.");
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

  function onSaveGround(event) {
    var select = document.getElementById("setup-select");
    var isNew = select.value === "__new__";
    var name = document.getElementById("field-name").value.replace(/^\s+|\s+$/g, "");
    var id = document.getElementById("field-id").value.replace(/^\s+|\s+$/g, "");
    var shortLink = document.getElementById("field-short").value.replace(/^\s+|\s+$/g, "");
    var device = document.getElementById("field-device").value;
    var scoreUrl = document.getElementById("field-score").value.replace(/^\s+|\s+$/g, "");
    var existing = isNew ? null : findGround(currentDoc, select.value);
    var ground;
    var i;
    var adIds;
    event.preventDefault();
    if (!name || !shortLink || !scoreUrl) {
      showBanner("Name, short URL, and CricClubs URL are required.");
      return;
    }
    if (!id) id = slug(name);
    if (!/^[a-z0-9-]+$/.test(id)) {
      showBanner("Id can only use lowercase letters, numbers, and hyphens.");
      return;
    }
    if (isNew && findGround(currentDoc, id)) {
      showBanner("A ground with that id already exists.");
      return;
    }
    adIds = checkedAdIds();
    ground = existing || {
      id: id,
      mode: "logos_score",
      active_ad: null
    };
    ground.name = name;
    ground.short_link = shortLink;
    ground.device = device;
    ground.resolved_url = resolvedFor(id, device);
    ground.score_url = scoreUrl;
    ground.score_overlays = freshScoreOverlays(existing, id, scoreUrl);
    ground.logos = {
      age_group_sponsor: document.getElementById("pick-age").value,
      tournament: document.getElementById("pick-tournament").value,
      cricketcraze: document.getElementById("pick-ccusa").value
    };
    ground.layout = window.PulsePlayLayout.isDefault(readLayoutForm()) ? null : readLayoutForm();
    ground.external_video_audio = document.getElementById("field-external").checked;
    ground.ad_ids = adIds;
    if (ground.active_ad && indexOf(adIds, ground.active_ad) === -1) {
      ground.mode = "logos_score";
      ground.active_ad = null;
    }
    ground.updated_at = new Date().toISOString();
    if (!existing) currentDoc.grounds.push(ground);
    else {
      for (i = 0; i < currentDoc.grounds.length; i++) {
        if (currentDoc.grounds[i].id === ground.id) currentDoc.grounds[i] = ground;
      }
    }
    currentId = ground.id;
    setupSig = null;
    centerSig = "";
    actionSig = "";
    controlsSig = "";
    saveDoc("Saved ground " + ground.name + ".");
    document.getElementById("setup-select").value = ground.id;
    loadSetupForm();
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

  document.getElementById("tab-controls").onclick = function () { showTab("controls"); };
  document.getElementById("tab-center").onclick = function () { showTab("center"); };
  document.getElementById("tab-library").onclick = function () { showTab("library"); };
  document.getElementById("tab-logos").onclick = function () { showTab("logos"); };
  document.getElementById("tab-setup").onclick = function () { showTab("setup"); };
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
  document.getElementById("score-switch-url").oninput = refreshScoreSwitchDraftWarn;
  document.getElementById("field-score").oninput = refreshScoreWarn;
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
        if (role !== "admin") {
          showNotAdmin(email);
          return;
        }
        showSignError("");
        hideSignIn();
        if (!dashboardStarted) {
          dashboardStarted = true;
          boot();
        }
      });
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
  } else if (!window.supabase || !window.supabase.createClient) {
    showSignIn();
    showSignError("Google sign-in did not load. Email and password still work if this message is a network blip — reload to try Google again.");
    store.getSession(function (session) {
      if (session) admitSession(session);
    });
  } else {
    authClient = window.supabase.createClient(window.PulsePlayRuntime.supabaseUrl, window.PulsePlayRuntime.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce"
      }
    });
    authClient.auth.onAuthStateChange(function (event, session) {
      if (event === "SIGNED_OUT") {
        store.signOut(function () {
          currentDoc = null;
          dashboardStarted = false;
          showSignIn();
        });
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
})();
