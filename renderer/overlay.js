/*
 * Dumb renderer for one ground. Reads config, toggles view classes, preloads
 * that ground's ads. When a video finishes, it always returns to View 1 and
 * asks the store to save that. Image ads stay until someone switches.
 * Open with ?ground=<id>&device=pro|mini
 */
(function () {
  var store = window.PulsePlayStore.create({
    configUrl: "../config/grounds.example.json"
  });
  var groundId = queryParam("ground");
  var videos = {};
  var stills = {};
  var currentDoc = null;
  var soundUnlocked = false;
  var audioCtx = null;
  var SILENT_POSTER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  var returnHold = null;
  var returnTimer = null;
  var pollMs = window.PulsePlayStore.DEFAULT_POLL_MS;
  var pollTimer = null;
  var polling = false;

  function queryParam(name) {
    var query = window.location.search;
    var parts;
    var i;
    var pair;
    var key;
    if (!query) return "";
    if (query.charAt(0) === "?") query = query.substring(1);
    parts = query.split("&");
    for (i = 0; i < parts.length; i++) {
      pair = parts[i].split("=");
      key = decodePart(pair[0] || "");
      if (key === name) return decodePart(pair[1] || "");
    }
    return "";
  }

  function decodePart(value) {
    try { return decodeURIComponent(String(value).replace(/\+/g, " ")); }
    catch (e) { return String(value); }
  }

  function setText(id, text) {
    var node = document.getElementById(id);
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function showStatus(message) {
    var box = document.getElementById("overlay-status");
    if (!box) return;
    setText("overlay-status-text", message);
    box.classList.remove("is-off");
  }

  function hideStatus() {
    var box = document.getElementById("overlay-status");
    if (box) box.classList.add("is-off");
  }

  function findGround(doc) {
    var i;
    if (!doc || !doc.grounds) return null;
    for (i = 0; i < doc.grounds.length; i++) {
      if (doc.grounds[i].id === groundId) return doc.grounds[i];
    }
    return null;
  }

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

  function assetSrc(doc, id) {
    var asset = findAsset(doc, id);
    return asset ? asset.src : "";
  }

  function logoScaleFor(doc, id) {
    var asset = findAsset(doc, id);
    if (!asset || !window.PulsePlayLayout) return 1;
    return window.PulsePlayLayout.logoMultiplier(asset.logo_scale);
  }

  function fitStage() {
    var stage = document.getElementById("stage");
    var w;
    var h;
    var scale;
    var x;
    var y;
    if (!stage) return;
    w = parseInt(stage.getAttribute("data-w"), 10) || 1920;
    h = parseInt(stage.getAttribute("data-h"), 10) || 1080;
    scale = Math.min(window.innerWidth / w, window.innerHeight / h);
    if (!scale || scale <= 0) scale = 1;
    stage.style.width = w + "px";
    stage.style.height = h + "px";
    stage.style.transform = "scale(" + scale + ")";
    x = Math.max(0, (window.innerWidth - (w * scale)) / 2);
    y = Math.max(0, (window.innerHeight - (h * scale)) / 2);
    stage.style.left = x + "px";
    stage.style.top = y + "px";
  }

  function setLogo(id, src) {
    var img = document.getElementById(id);
    if (!img) return;
    if (!src) {
      img.classList.add("is-off");
      img.removeAttribute("data-src");
      return;
    }
    img.classList.remove("is-off");
    if (img.getAttribute("data-src") === src) return;
    img.setAttribute("data-src", src);
    store.mediaUrl(src, function (err, url) {
      if (err || !url) return;
      if (img.getAttribute("data-src") !== src) return;
      img.src = url;
    });
  }

  function setScore(url) {
    window.PulsePlayScore.attach({
      iframe: document.getElementById("score-frame"),
      fallback: document.getElementById("score-fallback"),
      link: document.getElementById("score-fallback-link"),
      url: url,
      linkLabel: "Open score"
    });
  }

  /*
   * A paused <video> that still has a src keeps the hardware decoder.
   * YoloBox's browser will then show the next file as a frozen frame.
   * Drop src so only the video that is about to play holds the pipeline.
   */
  function parkVideo(video) {
    var url;
    if (!video) return;
    video.setAttribute("data-load-gen", String((parseInt(video.getAttribute("data-load-gen"), 10) || 0) + 1));
    url = video.getAttribute("data-resolved") || video.currentSrc || "";
    if (url) video.setAttribute("data-resolved", url);
    video.classList.remove("is-active");
    video.classList.remove("is-framed");
    video.muted = true;
    video.removeAttribute("data-playing");
    video.removeAttribute("data-want-play");
    if (!video.getAttribute("src") && !video.currentSrc) return;
    try { video.pause(); } catch (e) {}
    video.removeAttribute("src");
    try { video.load(); } catch (e2) {}
  }

  function parkOthers(keep) {
    var key;
    for (key in videos) {
      if (!videos.hasOwnProperty(key) || videos[key] === keep) continue;
      parkVideo(videos[key]);
    }
  }

  function finishArm(video) {
    if (video) video.removeAttribute("data-arming");
  }

  function playFromStart(video) {
    var url = video.getAttribute("data-resolved") || video.currentSrc || video.src || "";
    if (!url) {
      video.setAttribute("data-want-play", "1");
      return;
    }
    video.setAttribute("data-resolved", url);
    parkOthers(video);
    video.classList.add("is-active");
    video.classList.remove("is-framed");
    video.setAttribute("data-arming", "1");
    try { video.pause(); } catch (e) {}
    video.src = url;
    try { video.load(); } catch (e2) {}
    video.removeAttribute("data-want-play");
    video.setAttribute("data-playing", "1");
    playVideo(video);
  }

  function showSoundChip() {}

  function audioQuery() {
    var value = queryParam("audio");
    if (value === "1" || value === "true") return "on";
    if (value === "0" || value === "false") return "off";
    return "";
  }

  function wantAudio() {
    var flag = audioQuery();
    var ground;
    if (flag === "on" || soundUnlocked) return true;
    if (flag === "off") return false;
    ground = findGround(currentDoc);
    if (!ground || ground.play_audio == null) return true;
    return ground.play_audio !== false;
  }

  function resumeAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var source;
    var buffer;
    if (!AC) return;
    try {
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state !== "running" && audioCtx.resume) {
        var pending = audioCtx.resume();
        if (pending && pending.catch) pending.catch(function () {});
      }
      buffer = audioCtx.createBuffer(1, 1, 22050);
      source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
    } catch (e) {}
  }

  function markAudible(video) {
    video.removeAttribute("muted");
    video.defaultMuted = false;
    video.muted = false;
    video.volume = 1;
  }

  function revealVideo(video) {
    if (!video || video.getAttribute("data-playing") !== "1") return;
    if (!video.classList.contains("is-active")) return;
    video.classList.add("is-framed");
    document.body.classList.remove("mode-image");
    hideStills();
    setMode("ad");
    finishArm(video);
  }

  function activeVideo() {
    var key;
    for (key in videos) {
      if (videos.hasOwnProperty(key) && videos[key].classList.contains("is-active")) return videos[key];
    }
    return null;
  }

  function unlockSound() {
    var video;
    if (soundUnlocked) return;
    soundUnlocked = true;
    video = activeVideo();
    if (!video) return;
    resumeAudio();
    markAudible(video);
    playAndReveal(video, false);
  }

  function playAndReveal(video, allowMuteFallback) {
    var result;
    try {
      result = video.play();
    } catch (e) {
      if (allowMuteFallback) playMutedThenUnmute(video);
      return;
    }
    if (result && result.then) {
      result.then(function () {
        revealVideo(video);
      }).catch(function () {
        if (allowMuteFallback) playMutedThenUnmute(video);
      });
      return;
    }
    revealVideo(video);
  }

  function unmuteAfterStart(video) {
    var attempt = 0;
    function tick() {
      var result;
      if (!wantAudio() || attempt > 5) return;
      if (video.getAttribute("data-playing") !== "1" || !video.classList.contains("is-active")) return;
      attempt += 1;
      resumeAudio();
      markAudible(video);
      try {
        result = video.play();
      } catch (e) {
        video.muted = true;
        window.setTimeout(tick, 400);
        return;
      }
      if (result && result.then) {
        result.then(function () {
          if (video.muted) window.setTimeout(tick, 400);
        }).catch(function () {
          video.muted = true;
          var again = video.play();
          if (again && again.catch) again.catch(function () {});
          window.setTimeout(tick, 400);
        });
      }
    }
    tick();
  }

  function playMutedThenUnmute(video) {
    var result;
    video.muted = true;
    try {
      result = video.play();
    } catch (e) {
      return;
    }
    function after() {
      revealVideo(video);
      if (wantAudio()) unmuteAfterStart(video);
    }
    if (result && result.then) result.then(after).catch(function () {});
    else after();
  }

  function playVideo(video) {
    resumeAudio();
    if (!wantAudio()) {
      video.muted = true;
      playAndReveal(video, false);
      return;
    }
    markAudible(video);
    playAndReveal(video, true);
  }

  function timeMs(value) {
    var n = Date.parse(value || "");
    return isNaN(n) ? 0 : n;
  }

  /*
   * A poll can still say "playing this video" for a moment after it ended.
   * Keep View 1 until the saved row is no longer that play. A newer command
   * (different ad, or the same ad with a new updated_at) wins.
   */
  function noteReturn(ground) {
    var samePlay;
    if (!returnHold || !ground || ground.id !== returnHold.groundId) return;
    samePlay = ground.active_ad === returnHold.adId && timeMs(ground.updated_at) === timeMs(returnHold.seenAt);
    if (ground.mode === "ad" && samePlay) {
      ground.mode = "logos_score";
      ground.active_ad = null;
      return;
    }
    if (ground.mode === "logos_score" && !ground.active_ad && timeMs(ground.updated_at) === timeMs(returnHold.seenAt)) return;
    returnHold = null;
  }

  function scheduleReturn() {
    if (returnTimer) return;
    returnTimer = window.setTimeout(function () {
      returnTimer = null;
      persistReturn();
    }, 2000);
  }

  function persistReturn() {
    var hold = returnHold;
    if (!hold) return;
    if (store.returnToLogos) {
      store.returnToLogos(hold.groundId, hold.adId, hold.seenAt, function (err) {
        if (returnHold !== hold) return;
        if (err) scheduleReturn();
      });
      return;
    }
    store.write(currentDoc, function (err) {
      if (returnHold !== hold) return;
      if (err) scheduleReturn();
    });
  }

  function onEnded(adId) {
    var ad;
    var ground;
    var node = videos[adId];
    if (!currentDoc) return;
    if (node && node.getAttribute("data-arming") === "1") return;
    if (node && node.duration > 1 && node.currentTime > 0 && node.currentTime < 0.5) return;
    ad = findAd(currentDoc, adId);
    ground = findGround(currentDoc);
    if (!ground || ground.mode !== "ad" || ground.active_ad !== adId) return;
    if (isImageAd(ad)) return;
    returnHold = {
      groundId: ground.id,
      adId: adId,
      seenAt: ground.updated_at
    };
    apply(currentDoc);
    persistReturn();
  }

  function isImageAd(ad) {
    var mime;
    if (!ad) return false;
    if (ad.media_type === "image") return true;
    if (ad.media_type === "video") return false;
    mime = (ad.mime || "").toLowerCase();
    return mime.indexOf("image/") === 0;
  }

  function dropNode(map, key) {
    if (!map[key]) return;
    if (map[key].parentNode) map[key].parentNode.removeChild(map[key]);
    delete map[key];
  }

  function ensureAds(doc, ground) {
    var slots = document.getElementById("ad-slots");
    var wanted = {};
    var ids = ground.ad_ids || [];
    var i;
    var ad;
    var node;
    var key;
    var image;
    for (i = 0; i < ids.length; i++) {
      ad = findAd(doc, ids[i]);
      if (!ad) continue;
      wanted[ad.id] = ad;
      image = isImageAd(ad);
      if (image && videos[ad.id]) {
        parkVideo(videos[ad.id]);
        dropNode(videos, ad.id);
      }
      if (!image && stills[ad.id]) dropNode(stills, ad.id);
      node = image ? stills[ad.id] : videos[ad.id];
      if (!node) {
        if (image) {
          node = document.createElement("img");
          node.alt = "";
          stills[ad.id] = node;
        } else {
          node = document.createElement("video");
          node.setAttribute("preload", "auto");
          node.setAttribute("playsinline", "");
          node.setAttribute("webkit-playsinline", "");
          node.setAttribute("disableremoteplayback", "");
          node.setAttribute("poster", SILENT_POSTER);
          node.controls = false;
          node.defaultMuted = false;
          node.muted = false;
          node.volume = 1;
          node.loop = false;
          videos[ad.id] = node;
          (function (adId, video) {
            video.addEventListener("ended", function () { onEnded(adId); });
            video.addEventListener("playing", function () { revealVideo(video); });
            video.addEventListener("timeupdate", function () {
              if (video.currentTime > 0) revealVideo(video);
            });
          })(ad.id, node);
        }
        node.setAttribute("data-ad-id", ad.id);
        slots.appendChild(node);
      }
      if (node.getAttribute("data-src") !== ad.src) {
        node.setAttribute("data-src", ad.src);
        if (!node.getAttribute("data-load-gen")) node.setAttribute("data-load-gen", "0");
        (function (el, src, isImage) {
          var gen = el.getAttribute("data-load-gen") || "0";
          store.mediaUrl(src, function (err, url) {
            var playingOther = false;
            var otherKey;
            if (err || !url) return;
            if (el.getAttribute("data-src") !== src) return;
            if (!isImage) el.setAttribute("data-resolved", url);
            if (el.getAttribute("data-load-gen") !== gen && el.getAttribute("data-want-play") !== "1") return;
            if (!isImage) {
              for (otherKey in videos) {
                if (!videos.hasOwnProperty(otherKey) || videos[otherKey] === el) continue;
                if (videos[otherKey].getAttribute("data-playing") === "1") playingOther = true;
              }
              if (playingOther && el.getAttribute("data-want-play") !== "1") return;
            }
            el.src = url;
            if (!isImage) {
              try { el.load(); } catch (e) {}
            }
            if (el.getAttribute("data-want-play") === "1") {
              el.removeAttribute("data-playing");
              showAd(el.getAttribute("data-ad-id"));
            }
          });
        })(node, ad.src, image);
      }
    }
    for (key in videos) {
      if (!videos.hasOwnProperty(key) || wanted[key]) continue;
      parkVideo(videos[key]);
      dropNode(videos, key);
    }
    for (key in stills) {
      if (!stills.hasOwnProperty(key) || wanted[key]) continue;
      dropNode(stills, key);
    }
  }

  function setMode(mode) {
    var logos = document.getElementById("view-logos");
    var ad = document.getElementById("view-ad");
    var toAd = mode === "ad";
    if (toAd) {
      document.body.classList.add("mode-ad");
      document.body.classList.remove("mode-logos-score");
    } else {
      document.body.classList.add("mode-logos-score");
      document.body.classList.remove("mode-ad");
    }
    if (!logos || !ad) return;
    /*
     * A class change alone does not start the opacity transition in Chrome
     * when these layers began at opacity 0, and requestAnimationFrame does
     * not run while the tab is in the background. Set the inline opacities
     * around a reflow so the 250ms crossfade runs when the page is visible
     * and the end state is applied even when it is not.
     */
    if (document.hidden) {
      logos.style.transition = "none";
      ad.style.transition = "none";
      logos.style.opacity = toAd ? "0" : "1";
      ad.style.opacity = toAd ? "1" : "0";
      return;
    }
    logos.style.transition = "none";
    ad.style.transition = "none";
    logos.style.opacity = toAd ? "1" : "0";
    ad.style.opacity = toAd ? "0" : "1";
    void ad.offsetWidth;
    logos.style.transition = "opacity 250ms linear";
    ad.style.transition = "opacity 250ms linear";
    logos.style.opacity = toAd ? "0" : "1";
    ad.style.opacity = toAd ? "1" : "0";
  }

  function hideStills() {
    var key;
    for (key in stills) {
      if (stills.hasOwnProperty(key)) stills[key].classList.remove("is-active");
    }
  }

  function showLogos() {
    var key;
    showSoundChip(false);
    document.body.classList.remove("mode-image");
    setMode("logos");
    hideStills();
    for (key in videos) {
      if (videos.hasOwnProperty(key)) parkVideo(videos[key]);
    }
  }

  function showAd(adId) {
    var ad = findAd(currentDoc, adId);
    var image = isImageAd(ad);
    var node;
    var groundNow;
    var command;
    var same;
    if (image) {
      setMode("ad");
      document.body.classList.add("mode-image");
      hideStills();
      node = stills[adId];
      parkOthers(null);
      if (!node) return;
      node.classList.add("is-active");
      if (!node.getAttribute("src")) node.setAttribute("data-want-play", "1");
      else node.removeAttribute("data-want-play");
      return;
    }
    node = videos[adId];
    if (!node) return;
    groundNow = findGround(currentDoc);
    command = adId + ":" + (groundNow ? String(timeMs(groundNow.updated_at)) : "");
    same = node.getAttribute("data-command") === command;
    if (same && node.getAttribute("data-playing") === "1" && node.classList.contains("is-framed") && !node.paused && !node.ended && node.readyState >= 2) {
      node.classList.add("is-active");
      parkOthers(node);
      setMode("ad");
      return;
    }
    if (!same) node.removeAttribute("data-retried");
    node.setAttribute("data-command", command);
    node.classList.add("is-active");
    node.classList.remove("is-framed");
    playFromStart(node);
    if (node.getAttribute("data-retried") === "1") return;
    window.setTimeout(function () {
      if (node.getAttribute("data-command") !== command) return;
      if (node.getAttribute("data-retried") === "1") return;
      if (node.classList.contains("is-framed") || node.currentTime > 0 || (!node.paused && !node.ended)) {
        finishArm(node);
        return;
      }
      node.setAttribute("data-retried", "1");
      playFromStart(node);
    }, 700);
  }

  function schedule() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(poll, pollMs);
  }

  function apply(doc) {
    var ground;
    var logos;
    var nextPoll;
    currentDoc = doc;
    ground = findGround(doc);
    if (!groundId || !ground) {
      /* Empty database or a bad short link: stay transparent so the game
         video is not covered by an error plate. */
      hideStatus();
      setLogo("logo-age", "");
      setLogo("logo-tournament", "");
      setLogo("logo-ccusa", "");
      showLogos();
      return;
    }
    hideStatus();
    noteReturn(ground);
    logos = ground.logos || {};
    setLogo("logo-age", assetSrc(doc, logos.age_group_sponsor));
    setLogo("logo-tournament", assetSrc(doc, logos.tournament));
    setLogo("logo-ccusa", assetSrc(doc, logos.cricketcraze));
    if (window.PulsePlayLayout) {
      window.PulsePlayLayout.place({
        device: document.body.getAttribute("data-device"),
        layout: ground.layout,
        scales: {
          age: logoScaleFor(doc, logos.age_group_sponsor),
          tournament: logoScaleFor(doc, logos.tournament),
          cricketcraze: logoScaleFor(doc, logos.cricketcraze)
        },
        age: document.getElementById("logo-age"),
        tournament: document.getElementById("logo-tournament"),
        cricketcraze: document.getElementById("logo-ccusa"),
        score: document.getElementById("score-slot")
      });
    }
    setScore(ground.score_url);
    ensureAds(doc, ground);
    if (ground.mode === "ad" && ground.active_ad) showAd(ground.active_ad);
    else showLogos();
    nextPoll = doc.poll_ms || window.PulsePlayStore.DEFAULT_POLL_MS;
    if (nextPoll < 2000) nextPoll = 2000;
    if (nextPoll > 300000) nextPoll = 300000;
    if (nextPoll !== pollMs) {
      pollMs = nextPoll;
      schedule();
    }
  }

  function poll() {
    if (polling) return;
    polling = true;
    store.read(function (err, doc) {
      polling = false;
      if (err) {
        hideStatus();
        return;
      }
      apply(doc);
    });
  }

  document.addEventListener("click", unlockSound, true);
  document.addEventListener("touchend", unlockSound, true);
  window.addEventListener("resize", fitStage);
  fitStage();
  store.subscribe(function (err, doc) {
    if (!err && doc) apply(doc);
  });
  poll();
  schedule();
})();
