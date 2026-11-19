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

  function isLogoFile(file) {
    var type = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    if (type === "image/png" || type === "image/webp" || type === "image/svg+xml") return true;
    return name.lastIndexOf(".png") === name.length - 4 ||
      name.lastIndexOf(".webp") === name.length - 5 ||
      name.lastIndexOf(".svg") === name.length - 4;
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
    if (includeNew) select.appendChild(option("__new__", "New ground"));
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
    var pollInput = document.getElementById("poll-seconds");
    var seconds;
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
    if (document.activeElement !== pollInput) {
      seconds = Math.round((currentDoc.poll_ms || 2000) / 1000);
      pollInput.value = String(seconds);
    }
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
    var ids = (ground && ground.ad_ids) || [];
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
      if (node.tagName === "A") return true;
      node = node.parentNode;
    }
    return false;
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
    iframe.setAttribute("title", ground.name + " score");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("referrerpolicy", "no-referrer");
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
    if (window.PulsePlayStore.isCrossOrigin(ground.score_url)) {
      var note = document.createElement("p");
      note.className = "card__note";
      setText(note, "Cross-origin score. If the strip stays blank, the site is refusing iframes (typical for CricClubs). Use the link. A later proxy or Supabase Edge Function can fetch it.");
      card.appendChild(note);
    }
    paintCard(card, ground);
    window.PulsePlayScore.attach({
      iframe: iframe,
      fallback: fallback,
      link: fallbackLink,
      url: ground.score_url,
      linkLabel: "Open score"
    });
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
      parts.push(item.id + ":" + item.label + ":" + item.auto_return + ":" + item.logo_type + ":" + item.src);
    }
    return parts.join("|");
  }

  function renderLibrary() {
    var box = document.getElementById("global-auto");
    var list = document.getElementById("ad-list");
    var ads = assetsOf("ad");
    var sig = librarySignature("ad");
    var i;
    if (document.activeElement !== box) box.checked = currentDoc.auto_return_on_end !== false;
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
      setText(emptyLogos, "No logos yet. Upload a PNG, WebP, or SVG above and tag its corner. Ground setup picks from this list.");
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
    del.type = "button";
    del.className = "btn-danger";
    setText(del, "Delete");
    del.onclick = function () { deleteAsset(logo.id); };
    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(type);
    card.appendChild(desc);
    card.appendChild(del);
    return card;
  }

  function buildAdCard(ad) {
    var card = document.createElement("article");
    var video = document.createElement("video");
    var title = document.createElement("h3");
    var desc = document.createElement("p");
    var label = document.createElement("label");
    var toggle = document.createElement("input");
    var del = document.createElement("button");
    card.className = "ad-card";
    video.setAttribute("controls", "");
    video.setAttribute("preload", "metadata");
    video.setAttribute("playsinline", "");
    store.mediaUrl(ad.src, function (err, url) {
      if (!err && url) video.src = url;
    });
    setText(title, ad.label);
    setText(desc, ad.description || "");
    toggle.type = "checkbox";
    toggle.checked = ad.auto_return !== false;
    label.className = "check";
    label.appendChild(toggle);
    label.appendChild(document.createTextNode(" Auto-return when this ad ends"));
    toggle.onchange = function () {
      var live = findAd(currentDoc, ad.id);
      if (!live) return;
      live.auto_return = toggle.checked;
      librarySig = "";
      saveDoc("Saved auto-return for " + live.label + ".");
    };
    del.type = "button";
    del.className = "btn-danger";
    setText(del, "Delete");
    del.onclick = function () { deleteAsset(ad.id); };
    card.appendChild(video);
    card.appendChild(title);
    card.appendChild(desc);
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

  function renderSetupList() {
    var select = document.getElementById("setup-select");
    var sig = groundIds().join("|");
    if (sig === setupSig) return;
    setupSig = sig;
    fillGroundSelect(select, true);
    if ((!select.value || select.value === "__new__") && currentId) select.value = currentId;
    if (!select.value && currentDoc.grounds[0]) select.value = currentDoc.grounds[0].id;
    loadSetupForm();
  }

  function loadSetupForm() {
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
      label.appendChild(document.createTextNode(" " + ad.label));
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
      document.getElementById("field-name").value = "";
      document.getElementById("field-id").value = "";
      document.getElementById("field-id").readOnly = false;
      document.getElementById("field-short").value = "";
      document.getElementById("field-device").value = "pro";
      document.getElementById("field-score").value = "";
      setText(document.getElementById("field-resolved"), "Resolved URL is filled in when you save.");
      document.getElementById("btn-delete-ground").classList.add("is-off");
      return;
    }
    document.getElementById("field-name").value = ground.name;
    document.getElementById("field-id").value = ground.id;
    document.getElementById("field-id").readOnly = true;
    document.getElementById("field-short").value = ground.short_link;
    document.getElementById("field-device").value = ground.device;
    document.getElementById("field-score").value = ground.score_url;
    setText(document.getElementById("field-resolved"), "Resolves to " + ground.resolved_url);
    document.getElementById("btn-delete-ground").classList.remove("is-off");
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

  function patch(id, fields) {
    var ground = findGround(currentDoc, id);
    var key;
    if (!ground) return;
    for (key in fields) {
      if (fields.hasOwnProperty(key)) ground[key] = fields[key];
    }
    ground.updated_at = new Date().toISOString();
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
      setupSig = "";
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
    ground.logos = {
      age_group_sponsor: document.getElementById("pick-age").value,
      tournament: document.getElementById("pick-tournament").value,
      cricketcraze: document.getElementById("pick-ccusa").value
    };
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
    setupSig = "";
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
    setupSig = "";
    centerSig = "";
    actionSig = "";
    controlsSig = "";
    saveDoc("Deleted " + ground.name + ".");
  }

  function onAddAd(event) {
    var fileInput = document.getElementById("ad-file");
    var file = fileInput.files && fileInput.files[0];
    var label = document.getElementById("ad-label").value.replace(/^\s+|\s+$/g, "");
    var description = document.getElementById("ad-description").value.replace(/^\s+|\s+$/g, "");
    var auto = document.getElementById("ad-auto").checked;
    var id;
    event.preventDefault();
    if (!label) { showBanner("Give the ad a label."); return; }
    if (!file) { showBanner("Choose an MP4."); return; }
    if (!isMp4(file)) { showBanner("That file is not an MP4."); return; }
    if (useSupabase && adOverFreePlan(file)) {
      showBanner(adFreePlanError(file));
      return;
    }
    if (!useSupabase && file.size > window.PulsePlayStore.MAX_BYTES) {
      showBanner("That MP4 is " + mb(file.size) + ", over the " + mb(window.PulsePlayStore.MAX_BYTES) + " limit for this browser.");
      return;
    }
    if (!useSupabase && adOverFreePlan(file)) {
      if (!window.confirm("This file is " + mb(file.size) + ". Each YoloBox preloads its assigned ads over the ground's internet. Save it anyway?")) return;
    }
    id = "upload-" + new Date().getTime();
    store.putBlob(id, file, function (err, info) {
      if (err) { showBanner(err.message || "Upload failed."); return; }
      currentDoc.assets.push(assetFromUpload(id, "ad", label, description, info, file, {
        auto_return: auto,
        logo_type: null
      }));
      document.getElementById("ad-form").reset();
      document.getElementById("ad-auto").checked = true;
      document.getElementById("ad-warn").classList.add("is-off");
      librarySig = "";
      setupSig = "";
      saveDoc("Added " + label + " to the library. Assign it to a ground before it can go on air.");
    });
  }

  function onAddLogo(event) {
    var fileInput = document.getElementById("logo-file");
    var file = fileInput.files && fileInput.files[0];
    var label = document.getElementById("logo-label").value.replace(/^\s+|\s+$/g, "");
    var description = document.getElementById("logo-description").value.replace(/^\s+|\s+$/g, "");
    var logoType = document.getElementById("logo-type").value;
    var warn = document.getElementById("logo-warn");
    var id;
    event.preventDefault();
    if (!label) { showBanner("Give the logo a name."); return; }
    if (!file) { showBanner("Choose a PNG, WebP, or SVG."); return; }
    if (!isLogoFile(file)) { showBanner("Logos must be PNG, WebP, or SVG."); return; }
    if (file.size > 8 * 1024 * 1024) {
      showBanner("That logo is " + mb(file.size) + ", over 8 MB.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setText(warn, "This logo is " + mb(file.size) + ". It will still be saved, but a smaller file loads faster on the YoloBox.");
      warn.classList.remove("is-off");
    }
    id = "logo-" + new Date().getTime();
    store.putBlob(id, file, function (err, info) {
      if (err) { showBanner(err.message || "Upload failed."); return; }
      currentDoc.assets.push(assetFromUpload(id, "logo", label, description, info, file, {
        auto_return: null,
        logo_type: logoType
      }));
      document.getElementById("logo-form").reset();
      document.getElementById("logo-type").value = "other";
      warn.classList.add("is-off");
      logoSig = "";
      setupSig = "";
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
    var seconds = parseInt(this.value, 10);
    if (!seconds || seconds < 1) seconds = 1;
    if (seconds > 30) seconds = 30;
    this.value = String(seconds);
    currentDoc.poll_ms = seconds * 1000;
    saveDoc("Poll interval saved (" + seconds + "s). Open overlays pick it up on the next read.");
  };
  document.getElementById("global-auto").onchange = function () {
    currentDoc.auto_return_on_end = this.checked;
    saveDoc(this.checked ? "Ads can return to View 1 when they end." : "Auto-return is off. Ads stay on the last frame.");
  };
  document.getElementById("ad-file").onchange = function () {
    var file = this.files && this.files[0];
    var warn = document.getElementById("ad-warn");
    if (!file) return;
    if (!isMp4(file)) {
      setText(warn, "Please choose an MP4.");
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
  document.getElementById("pick-age").onchange = function () { previewPickedLogo("pick-age", "preview-age"); };
  document.getElementById("pick-tournament").onchange = function () { previewPickedLogo("pick-tournament", "preview-tournament"); };
  document.getElementById("pick-ccusa").onchange = function () { previewPickedLogo("pick-ccusa", "preview-ccusa"); };
  document.getElementById("btn-ccusa-default").onclick = function () {
    document.getElementById("pick-ccusa").value = "logo-cricketcraze";
    previewPickedLogo("pick-ccusa", "preview-ccusa");
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
      setupSig = "";
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
    setText(document.getElementById("ad-library-intro"), "Upload an MP4 (sound is allowed). It becomes selectable in Ground setup. Files stay in this browser's IndexedDB, so a YoloBox will not see them yet.");
    setText(document.getElementById("logo-library-intro"), "Upload a PNG, WebP, or SVG (transparency is kept). Tag it, then pick it on a ground. Files stay in this browser's IndexedDB, so a YoloBox will not see them yet.");
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
