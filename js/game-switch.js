/*
 * Ordered score_overlays slots for one ground.
 * Existing rows keep id, name, url, full_size, and active.
 * logo_age_id and youtube_broadcast_id are optional and omitted when empty.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayGameSwitch = api;
})(typeof window !== "undefined" ? window : this, function () {
  var ASSET_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/;

  function cleanAssetId(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    return ASSET_ID.test(text) ? text : "";
  }

  function videoId(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    var match;
    if (!text) return "";
    match = /(?:[?&]v=|youtu\.be\/|\/live\/)([A-Za-z0-9_-]{6,64})/.exec(text);
    if (match) return match[1];
    return VIDEO_ID.test(text) ? text : "";
  }

  function normalizeSlot(item, index, groundId) {
    var saved;
    var logo;
    var video;
    if (!item || item.url == null || String(item.url).replace(/^\s+|\s+$/g, "") === "") return null;
    saved = {
      id: String(item.id || ((groundId || "ground") + "-score-" + (index + 1))),
      name: String(item.name || ("Game " + (index + 1))),
      url: String(item.url).replace(/^\s+|\s+$/g, ""),
      active: item.active === true
    };
    if (item.full_size === true) saved.full_size = true;
    else if (item.full_size === false) saved.full_size = false;
    logo = cleanAssetId(item.logo_age_id);
    if (logo) saved.logo_age_id = logo;
    video = videoId(item.youtube_broadcast_id);
    if (video) saved.youtube_broadcast_id = video;
    return saved;
  }

  function scoreList(ground) {
    var raw = ground && ground.score_overlays;
    var out = [];
    var i;
    var item;
    var activeAt = -1;
    var groundId = ground && ground.id ? ground.id : "ground";
    if (raw && raw.length) {
      for (i = 0; i < raw.length; i++) {
        item = normalizeSlot(raw[i], i, groundId);
        if (item) out.push(item);
      }
    }
    if (!out.length && ground && ground.score_url) {
      item = normalizeSlot({
        id: groundId + "-game-1",
        name: "Game 1",
        url: ground.score_url,
        active: true
      }, 0, groundId);
      if (item) out.push(item);
    }
    for (i = 0; i < out.length; i++) {
      if (out[i].active && activeAt === -1) activeAt = i;
      else out[i].active = false;
    }
    if (activeAt === -1 && out.length) {
      for (i = 0; i < out.length; i++) {
        if (ground && out[i].url === ground.score_url) {
          activeAt = i;
          break;
        }
      }
      if (activeAt === -1) activeAt = 0;
      out[activeAt].active = true;
    }
    return out;
  }

  function activeSlot(list) {
    var i;
    list = list || [];
    for (i = 0; i < list.length; i++) if (list[i].active) return list[i];
    return null;
  }

  function nextSlot(list) {
    var i;
    list = list || [];
    for (i = 0; i < list.length; i++) {
      if (list[i].active) return list[i + 1] || null;
    }
    return null;
  }

  function buttonLabel(current, next) {
    var from = current && current.name ? String(current.name) : "";
    var to = next && next.name ? String(next.name) : "";
    if (/\b(am|morning)\b/i.test(from) && /\b(pm|afternoon)\b/i.test(to)) return "End AM & Switch to PM";
    return "Next Game";
  }

  function confirmText(groundName, current, next, logoLabel) {
    var endBit = current && current.youtube_broadcast_id
      ? "End the linked AM broadcast (" + current.youtube_broadcast_id + ")."
      : "End the live YouTube broadcast on this ground, if one is live.";
    var logoBit = next && next.logo_age_id
      ? " The age-group logo changes to " + (logoLabel || next.logo_age_id) + "."
      : "";
    var startBit = next && next.youtube_broadcast_id
      ? "Start the linked PM broadcast (" + next.youtube_broadcast_id + ") if YouTube has it ready."
      : "No PM broadcast is linked, so the YouTube start step is skipped.";
    return [
      "Switch " + (groundName || "this ground") + " from " + (current && current.name ? current.name : "the current game") + " to " + (next && next.name ? next.name : "the next game") + "?",
      "",
      "1. " + endBit + " If that broadcast is not live, this step is skipped.",
      "2. Show " + (next && next.name ? next.name : "the next score") + " on the YoloBox overlay." + logoBit,
      "3. " + startBit
    ].join("\n");
  }

  function withLogo(ground, logoId) {
    var logos;
    if (!cleanAssetId(logoId)) return null;
    logos = ground && ground.logos ? ground.logos : {};
    return {
      age_group_sponsor: cleanAssetId(logoId),
      tournament: logos.tournament || "",
      cricketcraze: logos.cricketcraze || ""
    };
  }

  function fieldsFor(ground, slotId) {
    var list = scoreList(ground);
    var chosen = null;
    var i;
    var fields;
    var logos;
    for (i = 0; i < list.length; i++) {
      list[i].active = list[i].id === slotId;
      if (list[i].active) chosen = list[i];
    }
    if (!chosen) return null;
    fields = { score_url: chosen.url, score_overlays: list };
    logos = withLogo(ground, chosen.logo_age_id);
    if (logos) fields.logos = logos;
    return fields;
  }

  function switchPlan(current, next, fallbackLiveId) {
    var endId = current && current.youtube_broadcast_id ? current.youtube_broadcast_id : "";
    if (!endId) endId = videoId(fallbackLiveId);
    return {
      endId: endId,
      startId: next && next.youtube_broadcast_id ? next.youtube_broadcast_id : ""
    };
  }

  function endIsSkippable(message) {
    var text = String(message || "").toLowerCase();
    if (!text) return false;
    if (text.indexOf("not live yet") !== -1) return true;
    if (text.indexOf("already ended") !== -1) return true;
    if (text.indexOf("already complete") !== -1) return true;
    if (text.indexOf("revoked") !== -1) return true;
    return false;
  }

  function endCanContinue(message) {
    var text = String(message || "").toLowerCase();
    if (text.indexOf("not connected") !== -1) return true;
    if (text.indexOf("sign in") !== -1) return true;
    if (text.indexOf("reconnect") !== -1) return true;
    return false;
  }

  function assignSlotMeta(slot, logoRaw, youtubeRaw) {
    var logo = cleanAssetId(logoRaw);
    var video = videoId(youtubeRaw);
    var typed = String(youtubeRaw || "").replace(/^\s+|\s+$/g, "");
    if (typed && !video) return { ok: false, message: "That YouTube value needs a video id or a youtube.com watch link." };
    if (logo) slot.logo_age_id = logo;
    else delete slot.logo_age_id;
    if (video) slot.youtube_broadcast_id = video;
    else delete slot.youtube_broadcast_id;
    return { ok: true, slot: slot };
  }

  return {
    cleanAssetId: cleanAssetId,
    videoId: videoId,
    normalizeSlot: normalizeSlot,
    scoreList: scoreList,
    activeSlot: activeSlot,
    nextSlot: nextSlot,
    buttonLabel: buttonLabel,
    confirmText: confirmText,
    withLogo: withLogo,
    fieldsFor: fieldsFor,
    switchPlan: switchPlan,
    endIsSkippable: endIsSkippable,
    endCanContinue: endCanContinue,
    assignSlotMeta: assignSlotMeta
  };
});
