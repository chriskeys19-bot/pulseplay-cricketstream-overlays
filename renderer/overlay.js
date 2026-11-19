/*
 * Dumb renderer for one ground. Reads config, toggles view classes, preloads
 * that ground's ads. The only write is the auto-return to View 1 when a video ends.
 * Open with ?ground=<id>&device=pro|mini
 */
(function () {
  var store = window.PulsePlayStore.create({
    configUrl: "../config/grounds.example.json"
  });
  var groundId = queryParam("ground");
  var videos = {};
  var currentDoc = null;
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

  function quiet(video) {
    if (!video.getAttribute("data-playing") && !video.classList.contains("is-active")) return;
    video.classList.remove("is-active");
    video.muted = true;
    video.removeAttribute("data-playing");
    video.removeAttribute("data-want-play");
    try {
      video.pause();
      if (video.currentTime > 0) video.currentTime = 0;
    } catch (e) {}
  }

  function playVideo(video) {
    var result;
    video.muted = false;
    try {
      result = video.play();
      if (result && result.catch) {
        result.catch(function () {
          video.muted = true;
          var retry = video.play();
          if (retry && retry.catch) retry.catch(function () {});
        });
      }
    } catch (e) {}
  }

  function shouldReturn(doc, ad) {
    return !!(doc && doc.auto_return_on_end !== false && ad && ad.auto_return !== false);
  }

  function onEnded(adId) {
    var ad;
    var ground;
    if (!currentDoc) return;
    ad = findAd(currentDoc, adId);
    ground = findGround(currentDoc);
    if (!ground || ground.mode !== "ad" || ground.active_ad !== adId) return;
    if (!shouldReturn(currentDoc, ad)) return;
    ground.mode = "logos_score";
    ground.active_ad = null;
    ground.updated_at = new Date().toISOString();
    store.write(currentDoc, function (err) {
      if (err) return;
      apply(currentDoc);
    });
  }

  function ensureVideos(doc, ground) {
    var slots = document.getElementById("ad-slots");
    var wanted = {};
    var ids = ground.ad_ids || [];
    var i;
    var ad;
    var video;
    var key;
    for (i = 0; i < ids.length; i++) {
      ad = findAd(doc, ids[i]);
      if (!ad) continue;
      wanted[ad.id] = ad;
      video = videos[ad.id];
      if (!video) {
        video = document.createElement("video");
        video.setAttribute("preload", "auto");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.muted = true;
        video.loop = false;
        video.setAttribute("data-ad-id", ad.id);
        videos[ad.id] = video;
        slots.appendChild(video);
        (function (adId, node) {
          node.addEventListener("ended", function () { onEnded(adId); });
        })(ad.id, video);
      }
      if (video.getAttribute("data-src") !== ad.src) {
        video.setAttribute("data-src", ad.src);
        (function (node, src) {
          store.mediaUrl(src, function (err, url) {
            if (err || !url) return;
            if (node.getAttribute("data-src") !== src) return;
            node.src = url;
            try { node.load(); } catch (e) {}
            if (node.getAttribute("data-want-play") === "1") {
              node.removeAttribute("data-playing");
              showAd(node.getAttribute("data-ad-id"));
            }
          });
        })(video, ad.src);
      }
    }
    for (key in videos) {
      if (!videos.hasOwnProperty(key) || wanted[key]) continue;
      quiet(videos[key]);
      if (videos[key].parentNode) videos[key].parentNode.removeChild(videos[key]);
      delete videos[key];
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

  function showLogos() {
    var key;
    setMode("logos");
    for (key in videos) {
      if (videos.hasOwnProperty(key)) quiet(videos[key]);
    }
  }

  function showAd(adId) {
    var key;
    var video;
    setMode("ad");
    for (key in videos) {
      if (!videos.hasOwnProperty(key) || key === adId) continue;
      quiet(videos[key]);
    }
    video = videos[adId];
    if (!video) return;
    video.classList.add("is-active");
    if (video.getAttribute("data-playing") === "1") return;
    if (!video.src) {
      video.setAttribute("data-want-play", "1");
      return;
    }
    video.removeAttribute("data-want-play");
    video.setAttribute("data-playing", "1");
    playVideo(video);
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
    logos = ground.logos || {};
    setLogo("logo-age", assetSrc(doc, logos.age_group_sponsor));
    setLogo("logo-tournament", assetSrc(doc, logos.tournament));
    setLogo("logo-ccusa", assetSrc(doc, logos.cricketcraze));
    setScore(ground.score_url);
    ensureVideos(doc, ground);
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

  window.addEventListener("resize", fitStage);
  fitStage();
  store.subscribe(function (err, doc) {
    if (!err && doc) apply(doc);
  });
  poll();
  schedule();
})();
