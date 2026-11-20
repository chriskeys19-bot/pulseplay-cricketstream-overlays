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
  var SILENT_POSTER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  var shownKey = "";
  var appliedSig = "";
  var placedKey = "";
  var externalTimer = null;
  var externalToken = 0;
  var externalSent = "";
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
    if (box && !box.classList.contains("is-off")) box.classList.add("is-off");
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
      if (!img.getAttribute("data-src") && img.classList.contains("is-off")) return;
      img.classList.add("is-off");
      img.removeAttribute("data-src");
      if (img.getAttribute("src")) img.removeAttribute("src");
      return;
    }
    if (img.getAttribute("data-src") === src || img.getAttribute("data-pending") === src) return;
    img.setAttribute("data-pending", src);
    store.mediaUrl(src, function (err, url) {
      var pre;
      if (err || !url) return;
      if (img.getAttribute("data-pending") !== src) return;
      if (img.getAttribute("src") === url) {
        img.setAttribute("data-src", src);
        img.removeAttribute("data-pending");
        if (img.classList.contains("is-off")) img.classList.remove("is-off");
        return;
      }
      pre = new Image();
      pre.onload = function () {
        if (img.getAttribute("data-pending") !== src) return;
        img.src = url;
        img.setAttribute("data-src", src);
        img.removeAttribute("data-pending");
        if (img.classList.contains("is-off")) img.classList.remove("is-off");
      };
      pre.src = url;
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
    video.removeAttribute("data-playing");
    video.removeAttribute("data-command");
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

  function revealOnce(video) {
    if (!video || video.getAttribute("data-seen") === "1") return;
    if (video.getAttribute("data-playing") !== "1") return;
    if (!video.classList.contains("is-active")) return;
    video.setAttribute("data-seen", "1");
    video.classList.add("is-framed");
    finishArm(video);
  }

  function startVideo(video) {
    var url = video.getAttribute("data-resolved") || "";
    var result;
    if (!url) {
      video.setAttribute("data-want-play", "1");
      return;
    }
    if (video.getAttribute("data-playing") === "1" && video.getAttribute("data-started") === url) return;
    parkOthers(video);
    video.classList.add("is-active");
    video.classList.remove("is-framed");
    video.removeAttribute("data-seen");
    video.setAttribute("data-arming", "1");
    video.setAttribute("data-resolved", url);
    video.setAttribute("data-started", url);
    video.removeAttribute("data-want-play");
    video.setAttribute("data-playing", "1");
    if (video.getAttribute("src") !== url) video.src = url;
    try { video.currentTime = 0; } catch (e) {}
    try {
      result = video.play();
    } catch (err) {
      finishArm(video);
      if (window.console && console.log) console.log("Pulse Play video play failed", err && err.message);
      return;
    }
    if (result && result.then) {
      result.then(function () {
        revealOnce(video);
      }).catch(function (err) {
        finishArm(video);
        if (window.console && console.log) console.log("Pulse Play video play rejected", err && err.message);
      });
    }
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
    if (!node || node.getAttribute("data-playing") !== "1") return;
    if (!node.classList.contains("is-active")) return;
    if (node.getAttribute("data-arming") === "1") return;
    if (!isFinite(node.duration) || node.duration < 0.5) return;
    if (node.currentTime < node.duration - 0.5) return;
    ad = findAd(currentDoc, adId);
    ground = findGround(currentDoc);
    if (!ground || ground.mode !== "ad" || ground.active_ad !== adId) return;
    if (shownKey !== "ad:" + adId) return;
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
          node.setAttribute("autoplay", "");
          node.setAttribute("poster", SILENT_POSTER);
          node.controls = false;
          node.loop = false;
          videos[ad.id] = node;
          (function (adId, video) {
            video.addEventListener("ended", function () { onEnded(adId); });
            video.addEventListener("playing", function () { revealOnce(video); });
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
    if (document.body.getAttribute("data-view") === mode) return;
    document.body.setAttribute("data-view", mode);
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

  function clearExternalTimer() {
    externalToken += 1;
    if (externalTimer) {
      window.clearTimeout(externalTimer);
      externalTimer = null;
    }
  }

  function externalVideo(doc, ground) {
    var ad;
    if (!ground || ground.external_video_audio !== true) return false;
    if (ground.mode !== "ad" || !ground.active_ad) return false;
    ad = findAd(doc, ground.active_ad);
    return !!(ad && !isImageAd(ad));
  }

  function showExternal(adId) {
    var ad = findAd(currentDoc, adId);
    var ground = findGround(currentDoc);
    var seconds;
    var seenAt;
    var token;
    var key;
    clearExternalTimer();
    document.body.classList.add("mode-external");
    document.body.classList.remove("mode-image");
    setMode("ad");
    hideStills();
    parkOthers(null);
    if (!ad || !isFinite(Number(ad.duration_seconds)) || Number(ad.duration_seconds) <= 0) {
      if (window.console && console.log) console.log("Pulse Play external video has no duration");
      return;
    }
    seconds = Number(ad.duration_seconds) + 2.5;
    seenAt = ground ? ground.updated_at : "";
    key = adId + "@" + String(seenAt || "");
    token = externalToken;
    externalTimer = window.setTimeout(function () {
      var live;
      if (token !== externalToken) return;
      if (!currentDoc) return;
      live = findGround(currentDoc);
      if (!live || live.external_video_audio !== true) return;
      if (live.mode !== "ad" || live.active_ad !== adId) return;
      if (String(live.updated_at || "") !== String(seenAt || "")) return;
      if (externalSent === key) return;
      externalSent = key;
      live.mode = "logos_score";
      live.active_ad = null;
      appliedSig = "";
      shownKey = "";
      document.body.classList.remove("mode-external");
      apply(currentDoc);
      if (store.returnToLogos) store.returnToLogos(live.id, adId, seenAt, function () {});
      else if (store.write) store.write(currentDoc, function () {});
    }, Math.round(seconds * 1000));
  }

  function showLogos() {
    var key;
    clearExternalTimer();
    document.body.classList.remove("mode-external");
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
    if (image) {
      clearExternalTimer();
      document.body.classList.remove("mode-external");
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
    clearExternalTimer();
    document.body.classList.remove("mode-external");
    setMode("ad");
    document.body.classList.remove("mode-image");
    hideStills();
    if (node.getAttribute("data-command") === adId && node.getAttribute("data-playing") === "1") {
      node.classList.add("is-active");
      if (node.getAttribute("data-seen") === "1") node.classList.add("is-framed");
      return;
    }
    node.setAttribute("data-command", adId);
    startVideo(node);
  }

  function schedule() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(poll, pollMs);
  }

  function logoPart(doc, id) {
    var asset = findAsset(doc, id);
    return (id || "") + "@" + (asset ? asset.src : "") + "@" + (asset && asset.logo_scale != null ? asset.logo_scale : "");
  }

  function visualSig(doc, ground) {
    var logos = (ground && ground.logos) || {};
    return [
      ground ? (ground.mode || "logos_score") : "",
      ground ? (ground.active_ad || "") : "",
      logoPart(doc, logos.age_group_sponsor),
      logoPart(doc, logos.tournament),
      logoPart(doc, logos.cricketcraze),
      ground ? (ground.score_url || "") : "",
      ground && ground.external_video_audio ? "1" : "0",
      (function () {
        var ad = ground ? findAd(doc, ground.active_ad) : null;
        return ad && ad.duration_seconds != null ? String(ad.duration_seconds) : "";
      })(),
      JSON.stringify(ground ? (ground.layout || null) : null)
    ].join("|");
  }

  function apply(doc) {
    var ground;
    var logos;
    var nextPoll;
    var sig;
    var nextKey;
    var nextPlace;
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
    sig = visualSig(doc, ground);
    if (sig === appliedSig) {
      nextPoll = doc.poll_ms || window.PulsePlayStore.DEFAULT_POLL_MS;
      if (nextPoll < 2000) nextPoll = 2000;
      if (nextPoll > 300000) nextPoll = 300000;
      if (nextPoll !== pollMs) {
        pollMs = nextPoll;
        schedule();
      }
      return;
    }
    appliedSig = sig;
    logos = ground.logos || {};
    setLogo("logo-age", assetSrc(doc, logos.age_group_sponsor));
    setLogo("logo-tournament", assetSrc(doc, logos.tournament));
    setLogo("logo-ccusa", assetSrc(doc, logos.cricketcraze));
    nextPlace = [
      document.body.getAttribute("data-device") || "",
      logoScaleFor(doc, logos.age_group_sponsor),
      logoScaleFor(doc, logos.tournament),
      logoScaleFor(doc, logos.cricketcraze),
      JSON.stringify(ground.layout || null)
    ].join("|");
    if (nextPlace !== placedKey && window.PulsePlayLayout) {
      placedKey = nextPlace;
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
    nextPoll = doc.poll_ms || window.PulsePlayStore.DEFAULT_POLL_MS;
    if (nextPoll < 2000) nextPoll = 2000;
    if (nextPoll > 300000) nextPoll = 300000;
    if (nextPoll !== pollMs) {
      pollMs = nextPoll;
      schedule();
    }
    if (externalVideo(doc, ground)) nextKey = "ext:" + ground.active_ad;
    else if (ground.mode === "ad" && ground.active_ad) nextKey = "ad:" + ground.active_ad;
    else nextKey = "logos";
    if (nextKey === shownKey) {
      /* A duration that arrives after the transparent ad started still
         needs its return timer. A timer that is already running stays. */
      if (nextKey.indexOf("ext:") === 0 && !externalTimer) showExternal(ground.active_ad);
      return;
    }
    if (nextKey.indexOf("ext:") !== 0) ensureAds(doc, ground);
    shownKey = nextKey;
    if (nextKey === "logos") showLogos();
    else if (nextKey.indexOf("ext:") === 0) showExternal(ground.active_ad);
    else showAd(ground.active_ad);
  }

  function deliver(doc) {
    apply(doc);
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
      deliver(doc);
    });
  }

  window.addEventListener("resize", fitStage);
  fitStage();
  store.subscribe(function (err, doc) {
    if (!err && doc) deliver(doc);
  });
  poll();
  schedule();
})();
