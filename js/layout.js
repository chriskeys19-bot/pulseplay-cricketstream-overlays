/*
 * Logo and score placement for the 1920x1080 stage.
 * Device CSS is the 100% size. A ground layout multiplies that size and
 * nudges the anchor. A logo's own scale multiplies the slot again.
 * Missing layout means the current shipped sizes.
 * Age is top-left, the tournament logo is top-right, and CricketCrazeUSA
 * is bottom-right. The tournament logo shares the age logo's top inset and
 * the CricketCrazeUSA logo's right inset. Positive x moves right. Positive
 * y moves down. Ground rows store only those nudges and a scale, so this
 * anchor is what places the tournament logo on every ground.
 *
 * The score bar's right edge is the anchor. It sits SCORE_GAP pixels left of
 * the default CricketCrazeUSA box, and the same left and width are used for
 * the subscribe ticker. If that logo is nudged or scaled so its painted left
 * edge is further left, the bar yields to keep the gap. Scale grows the bar
 * to the left. Past SCORE_MIN_LEFT the width stops so the bar stays on the
 * 1920px stage, and the right edge keeps its gap. Height still follows the
 * requested scale. A positive score x moves that right edge right; a positive
 * y moves the bar down.
 */
(function (global) {
  var STAGE_W = 1920;
  var STAGE_H = 1080;
  var SCORE_GAP = 64;
  var SCORE_MIN_LEFT = 16;
  var BASE = {
    pro: {
      age: { left: 40, top: 20, w: 168, h: 84 },
      tournament: { right: 40, top: 20, w: 180, h: 140 },
      cricketcraze: { right: 40, bottom: 20, w: 190, h: 146 },
      score: { bottom: 28, w: 1560, h: 297 }
    },
    mini: {
      age: { left: 36, top: 18, w: 224, h: 112 },
      tournament: { right: 28, top: 18, w: 211, h: 164 },
      cricketcraze: { right: 28, bottom: 13, w: 220, h: 169 },
      /* Widest bar that keeps SCORE_GAP before the Mini logo and
         SCORE_MIN_LEFT on the stage. The old 1734px bar overlapped it. */
      score: { bottom: 20, w: 1592, h: 372 }
    }
  };
  var SLOTS = ["age", "tournament", "cricketcraze", "score"];

  function clamp(value, min, max) {
    var n = Number(value);
    if (isNaN(n)) n = min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function slotOrDefault(raw, name) {
    var src = raw || {};
    var slot = {
      scale: clamp(src.scale == null ? 1 : src.scale, 0.25, 2),
      x: Math.round(clamp(src.x || 0, -400, 400)),
      y: Math.round(clamp(src.y || 0, -400, 400))
    };
    var width;
    if (name === "score" && src.width != null && src.width !== "") {
      width = clamp(src.width, 0.5, 1);
      if (Math.abs(width - 1) > 0.001) slot.width = Math.round(width * 1000) / 1000;
    }
    return slot;
  }

  function normalize(raw) {
    var out = {};
    var i;
    for (i = 0; i < SLOTS.length; i++) out[SLOTS[i]] = slotOrDefault(raw && raw[SLOTS[i]], SLOTS[i]);
    return out;
  }

  function defaults() {
    return normalize(null);
  }

  function isDefault(raw) {
    var layout = normalize(raw);
    var i;
    var slot;
    for (i = 0; i < SLOTS.length; i++) {
      slot = layout[SLOTS[i]];
      if (slot.scale !== 1 || slot.x !== 0 || slot.y !== 0) return false;
      if (slot.width != null && Math.abs(slot.width - 1) > 0.001) return false;
    }
    return true;
  }

  function logoMultiplier(value) {
    if (value == null || value === "") return 1;
    return clamp(value, 0.25, 2);
  }

  function clearBox(el) {
    el.style.top = "auto";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = "auto";
    el.style.marginLeft = "0";
  }

  function placeLogo(el, base, slot, logoScale, anchor) {
    var scale;
    var w;
    var h;
    if (!el) return;
    scale = slot.scale * logoMultiplier(logoScale);
    w = Math.round(base.w * scale);
    h = Math.round(base.h * scale);
    clearBox(el);
    el.style.width = w + "px";
    el.style.height = h + "px";
    if (anchor === "top") {
      el.style.left = (base.left + slot.x) + "px";
      el.style.top = (base.top + slot.y) + "px";
      return;
    }
    if (anchor === "top-right") {
      el.style.right = (base.right - slot.x) + "px";
      el.style.top = (base.top + slot.y) + "px";
      return;
    }
    if (anchor === "bottom-right") {
      el.style.right = (base.right - slot.x) + "px";
      el.style.bottom = (base.bottom - slot.y) + "px";
    }
  }

  function logoLeft(base) {
    return STAGE_W - base.right - base.w;
  }

  function paintedLogoLeft(el, base) {
    var inset;
    var width;
    var edge;
    var painted;
    edge = logoLeft(base);
    if (!el || !el.style) return edge;
    inset = parseFloat(el.style.right);
    width = parseFloat(el.style.width);
    if (isNaN(inset) || isNaN(width)) return edge;
    painted = STAGE_W - inset - width;
    if (painted < edge) return painted;
    return edge;
  }

  function scoreRightEdge(logoBase, logoEl, nudgeX) {
    return paintedLogoLeft(logoEl, logoBase) - SCORE_GAP + nudgeX;
  }

  function placeScore(el, base, slot, logoBase, logoEl) {
    var rightEdge;
    var maxW;
    var w;
    var h;
    var left;
    if (!el) return;
    rightEdge = scoreRightEdge(logoBase, logoEl, slot.x);
    maxW = rightEdge - SCORE_MIN_LEFT;
    if (maxW < 1) maxW = 1;
    w = Math.round(base.w * slot.scale);
    if (w > maxW) w = maxW;
    if (w < 1) w = 1;
    h = Math.round(base.h * slot.scale);
    if (h < 1) h = 1;
    left = rightEdge - w;
    if (left < SCORE_MIN_LEFT) left = SCORE_MIN_LEFT;
    clearBox(el);
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.left = left + "px";
    el.style.bottom = (base.bottom - slot.y) + "px";
  }

  function alignTicker(scoreEl, tickerEl) {
    if (!scoreEl || !tickerEl) return;
    tickerEl.style.left = scoreEl.style.left;
    tickerEl.style.width = scoreEl.style.width;
    tickerEl.style.right = "auto";
    tickerEl.style.marginLeft = "0";
  }

  /* Sit just above the painted score, and never above the stage. */
  function tickerBottom(scoreBottom, scoreHeight, sy, tickerHeight) {
    var next = Math.round(scoreBottom + scoreHeight * (sy || 1) + 10);
    var limit = STAGE_H - (tickerHeight > 0 ? tickerHeight : 0);
    if (next > limit) next = limit;
    if (next < 0) next = 0;
    return next;
  }

  function place(opts) {
    var device = opts && opts.device === "mini" ? "mini" : "pro";
    var base = BASE[device];
    var layout = normalize(opts && opts.layout);
    var scales = (opts && opts.scales) || {};
    placeLogo(opts.age, base.age, layout.age, scales.age, "top");
    placeLogo(opts.tournament, base.tournament, layout.tournament, scales.tournament, "top-right");
    placeLogo(opts.cricketcraze, base.cricketcraze, layout.cricketcraze, scales.cricketcraze, "bottom-right");
    placeScore(opts.score, base.score, layout.score, base.cricketcraze, opts.cricketcraze);
    alignTicker(opts.score, opts.ticker);
  }

  global.PulsePlayLayout = {
    slots: SLOTS,
    stageWidth: STAGE_W,
    stageHeight: STAGE_H,
    scoreGap: SCORE_GAP,
    scoreMinLeft: SCORE_MIN_LEFT,
    normalize: normalize,
    defaults: defaults,
    isDefault: isDefault,
    logoMultiplier: logoMultiplier,
    alignTicker: alignTicker,
    tickerBottom: tickerBottom,
    place: place
  };
})(window);
