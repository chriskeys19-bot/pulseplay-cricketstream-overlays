/*
 * Live CricClubs score for Command Center.
 * overlay.cricclubs.com/<CODE>/ subscribes to
 *   https://overlay-ssc.cricclubs.com/overlay/client-sse/events/<CODE>/v2/
 * and reads the score-update event. That response sends Access-Control-Allow-Origin: *.
 * static.cricclubs.com/overlay-cc/?matchId=&clubId= polls
 *   https://core-prod-origin.cricclubs.com/core/scoring/livescore/liveScoreOverlayData
 * The public x-api-key and x-consumer-key are the same headers that page already sends.
 * The scorecard response allows https://chriskeys19-bot.github.io.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayCricClubs = api;
})(typeof window !== "undefined" ? window : this, function () {
  var RESERVED = {
    ninjacaster: 1,
    cc12: 1,
    cc_1712: 1,
    milc: 1,
    logsview: 1,
    scoreview: 1,
    clientupdates: 1,
    assets: 1
  };

  function truthy(value) {
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function oversNumber(value) {
    var number = parseFloat(value);
    return isFinite(number) && number >= 0 ? number : 0;
  }

  function wicketsNumber(value) {
    var number = parseInt(value, 10);
    return isFinite(number) && number >= 0 ? number : 0;
  }

  function formatOvers(value) {
    var text;
    if (!isFinite(value)) return "";
    text = String(value);
    if (text.indexOf(".") === -1) return text + ".0";
    return text;
  }

  function formatScore(code, total, wickets, overs) {
    var who;
    if (total == null || String(total).replace(/^\s+|\s+$/g, "") === "") return "";
    who = code ? String(code).replace(/^\s+|\s+$/g, "") + " " : "";
    return who + String(total).replace(/^\s+|\s+$/g, "") + "/" + wickets + " (" + formatOvers(overs) + ")";
  }

  /* PSD age-group files. The same ids live in psd-grounds.js. */
  var AGE_LOGO_DIVISION = {
    "logo-1795109375279": "U9",
    "logo-1795110181170": "U11",
    "logo-1795110230649": "U13",
    "logo-1795110263439": "U15"
  };

  function integerOvers(value) {
    var number = oversNumber(value);
    var nearest;
    if (!(number > 0)) return 0;
    nearest = Math.round(number);
    if (Math.abs(number - nearest) > 0.001) return 0;
    return nearest;
  }

  function divisionInText(value) {
    var text;
    var match;
    if (value == null) return "";
    text = String(value).replace(/^\s+|\s+$/g, "");
    if (!text) return "";
    if (AGE_LOGO_DIVISION[text]) return AGE_LOGO_DIVISION[text];
    match = /(?:^|[^A-Za-z0-9])U(15|13|11|9)(?![0-9])/i.exec(text);
    if (!match) return "";
    return "U" + match[1];
  }

  function divisionFromHint(hint) {
    var overlay;
    var division;
    var logo;
    var logoName;
    if (hint == null || hint === "") return "";
    if (typeof hint !== "object") return divisionInText(hint);
    overlay = divisionInText(hint.overlayName);
    if (overlay) return overlay;
    division = divisionInText(hint.division);
    if (division) return division;
    logo = divisionInText(hint.logoAgeId || hint.logo_age_id || hint.ageSponsor || hint.age_group_sponsor);
    if (logo) return logo;
    logoName = divisionInText(hint.logoName || hint.logoLabel);
    return logoName;
  }

  function divisionOf(state, hint) {
    var fromHint = divisionFromHint(hint);
    if (fromHint) return fromHint;
    if (!state || typeof state !== "object") return "";
    return divisionFromHint({
      division: state.division,
      overlayName: state.overlayName,
      logoAgeId: state.logoAgeId || state.logo_age_id,
      logoName: state.logoName || state.logoLabel,
      ageSponsor: state.ageSponsor
    });
  }

  /* 20-over games break at 10. 30-over games break at 15. Anything else has no mandatory drinks mark. */
  function drinksOverForLimit(limit) {
    if (limit === 20) return 10;
    if (limit === 30) return 15;
    return 0;
  }

  function oversForDivision(division) {
    if (division === "U9") return 20;
    if (division === "U11" || division === "U13" || division === "U15") return 30;
    return 0;
  }

  /*
   * maxOvers / totalOvers is the format. A present limit that is not 20 or 30
   * does not fall through to the ground, so a reduced or other game stays quiet.
   * Omitted overs use the division, the active overlay name, or the age logo.
   */
  function drinksOver(state, hint) {
    var limit = integerOvers(state && state.maxOvers);
    if (!limit) limit = integerOvers(state && state.totalOvers);
    if (limit) return drinksOverForLimit(limit);
    return drinksOverForLimit(oversForDivision(divisionOf(state, hint)));
  }

  function nearMark(overs, mark) {
    return mark > 0 && Math.abs(overs - mark) < 0.001;
  }

  function drinksApproaching(overs, mark) {
    if (!(mark > 0) || nearMark(overs, mark)) return false;
    return overs >= (mark - 2) - 0.0001 && overs < mark;
  }

  /* Exact 10.0 / 15.0, or a CricClubs drinks graphic that has not gone to the next ball. */
  function drinksNow(overs, mark, statusDrinks) {
    if (!(mark > 0)) return false;
    if (nearMark(overs, mark)) return true;
    if (!statusDrinks) return false;
    if (overs > mark + 0.001) return false;
    return overs >= (mark - 2) - 0.0001;
  }

  function valueIsDrinks(value) {
    var text;
    if (value === 15 || value === "15") return true;
    if (value == null || value === false) return false;
    text = String(value).replace(/^\s+|\s+$/g, "").toLowerCase();
    if (!text || text === "0" || text === "false" || text === "1") return false;
    if (text === "15") return true;
    return text.indexOf("drink") !== -1;
  }

  function drinksFromBag(bag) {
    var view;
    if (!bag || typeof bag !== "object") return null;
    if (truthy(bag.isDrinksBreak) || truthy(bag.isDrinks) || truthy(bag.drinksBreak) || valueIsDrinks(bag.drinksBreak)) {
      return true;
    }
    if (bag.viewId != null && bag.viewId !== "") view = bag.viewId;
    else if (bag.view != null && bag.view !== "") view = bag.view;
    else if (bag.currentView != null && bag.currentView !== "") view = bag.currentView;
    else view = null;
    if (view != null) return valueIsDrinks(view);
    if (valueIsDrinks(bag.status) || valueIsDrinks(bag.matchStatus) || valueIsDrinks(bag.breakType)) return true;
    return null;
  }

  function indicatesDrinks(source) {
    var bags = [];
    var i;
    var found;
    if (!source || typeof source !== "object") return false;
    bags.push(source);
    if (source.data && typeof source.data === "object") bags.push(source.data);
    if (source.values && typeof source.values === "object") bags.push(source.values);
    if (source.global && typeof source.global === "object") bags.push(source.global);
    if (source.data && source.data.values && typeof source.data.values === "object") bags.push(source.data.values);
    if (source.data && source.data.global && typeof source.data.global === "object") bags.push(source.data.global);
    for (i = 0; i < bags.length; i++) {
      found = drinksFromBag(bags[i]);
      if (found != null) return found;
    }
    return false;
  }

  function groundHint(ground, slot) {
    var logoId = "";
    if (slot && slot.logo_age_id) logoId = String(slot.logo_age_id);
    if (!logoId && ground && ground.logos && ground.logos.age_group_sponsor) {
      logoId = String(ground.logos.age_group_sponsor);
    }
    return {
      division: ground && ground.division ? String(ground.division) : "",
      overlayName: slot && slot.name ? String(slot.name) : "",
      logoAgeId: logoId.replace(/^\s+|\s+$/g, "")
    };
  }

  function alertPresentation(alert) {
    if (alert === "break") {
      return { tone: "break", text: "INNINGS BREAK — Trigger Ads", jump: true, outline: "break" };
    }
    if (alert === "soon") {
      return { tone: "soon", text: "Mid-Innings Break Coming Up", jump: false, outline: "" };
    }
    if (alert === "drinks") {
      return { tone: "drinks", text: "DRINKS BREAK — Trigger Ads", jump: true, outline: "drinks" };
    }
    if (alert === "drinks-soon") {
      return { tone: "drinks-soon", text: "Drinks Break Coming Up", jump: false, outline: "" };
    }
    return null;
  }

  function overlayCode(url) {
    var parsed;
    var match;
    var code;
    try {
      parsed = new URL(String(url || ""), "https://overlay.cricclubs.com");
    } catch (error) {
      return "";
    }
    if (parsed.hostname !== "overlay.cricclubs.com") return "";
    match = /^\/([A-Za-z0-9_-]{4,32})\/?$/.exec(parsed.pathname || "");
    if (!match) return "";
    code = match[1];
    if (RESERVED[code.toLowerCase()]) return "";
    return code;
  }

  function staticMatch(url) {
    var parsed;
    var clubId;
    var matchId;
    try {
      parsed = new URL(String(url || ""), "https://static.cricclubs.com");
    } catch (error) {
      return null;
    }
    if (parsed.hostname !== "static.cricclubs.com") return null;
    if (parsed.pathname.indexOf("/overlay-cc/") !== 0) return null;
    clubId = parsed.searchParams.get("clubId") || "";
    matchId = parsed.searchParams.get("matchId") || "";
    if (!/^\d{1,12}$/.test(clubId) || !/^\d{1,12}$/.test(matchId)) return null;
    return { clubId: clubId, matchId: matchId };
  }

  function sourceFromUrl(url) {
    var code = overlayCode(url);
    var match;
    if (code) return { kind: "sse", code: code };
    match = staticMatch(url);
    if (match) return { kind: "rest", clubId: match.clubId, matchId: match.matchId };
    return null;
  }

  function sseUrl(code) {
    return "https://overlay-ssc.cricclubs.com/overlay/client-sse/events/" + encodeURIComponent(code) + "/v2/";
  }

  function restUrl(clubId, matchId) {
    return "https://core-prod-origin.cricclubs.com/core/scoring/livescore/liveScoreOverlayData?clubId=" +
      encodeURIComponent(clubId) + "&matchId=" + encodeURIComponent(matchId);
  }

  function restHeaders() {
    return {
      Accept: "application/json",
      "x-api-key": "KmBjP2024",
      "x-consumer-key": "raVI88cc"
    };
  }

  function assess(state, hint) {
    var ended;
    var second;
    var overs;
    var wickets;
    var scheduled;
    var revised;
    var total;
    var code;
    var score;
    var started;
    var mark;
    var statusDrinks;
    var inningsSoon;
    if (!state) return null;
    ended = truthy(state.ended);
    second = truthy(state.secondStarted);
    overs = oversNumber(state.overs);
    wickets = wicketsNumber(state.wickets);
    revised = oversNumber(state.revisedOvers);
    scheduled = revised > 0 ? revised : oversNumber(state.maxOvers);
    mark = drinksOver(state, hint);
    if (!(scheduled > 0) && mark === 10) scheduled = 20;
    if (!(scheduled > 0) && mark === 15) scheduled = 30;
    total = state.total == null ? "" : String(state.total).replace(/^\s+|\s+$/g, "");
    code = String(state.code || state.name || "").replace(/^\s+|\s+$/g, "");
    score = formatScore(code, total, wickets, overs);
    started = overs > 0 || wickets > 0 || (total !== "" && total !== "0");
    statusDrinks = truthy(state.drinks) || indicatesDrinks(state);
    if (ended) return { phase: "done", alert: "", score: score, detail: "Final" };
    if (truthy(state.testMatch)) {
      return { phase: "quiet", alert: "", score: started ? score : "", detail: started ? "" : "" };
    }
    if (truthy(state.superOver)) {
      return { phase: "second", alert: "", score: score, detail: "Super over" };
    }
    if (second && !started) {
      return { phase: "break", alert: "break", score: score, detail: "Between innings" };
    }
    if (!second && scheduled > 0 && (overs >= scheduled || wickets >= 10 || truthy(state.inningsEnded))) {
      return { phase: "break", alert: "break", score: score, detail: "1st innings complete" };
    }
    if (started && drinksNow(overs, mark, statusDrinks)) {
      return { phase: "drinks", alert: "drinks", score: score, detail: "Drinks break" };
    }
    inningsSoon = !second && ((scheduled > 0 && overs >= scheduled - 2 && overs < scheduled) || (wickets >= 9 && started));
    if (inningsSoon) {
      return {
        phase: "soon",
        alert: "soon",
        score: score,
        detail: wickets >= 9 ? "9 wickets down" : "Within 2 overs of the innings limit"
      };
    }
    if (started && drinksApproaching(overs, mark)) {
      return {
        phase: "drinks-soon",
        alert: "drinks-soon",
        score: score,
        detail: "Within 2 overs of the drinks break"
      };
    }
    if (second) return { phase: "second", alert: "", score: score, detail: "2nd innings" };
    if (!started) return { phase: "pre", alert: "", score: "", detail: "Yet to start" };
    return { phase: "first", alert: "", score: score, detail: "1st innings" };
  }

  function fromSse(payload, hint) {
    var global;
    var bar;
    var teams;
    var second;
    var side;
    var stage;
    if (!payload || typeof payload !== "object" || !payload.global) return null;
    global = payload.global;
    bar = payload.scoreBar && typeof payload.scoreBar === "object" ? payload.scoreBar : {};
    teams = payload.teams && typeof payload.teams === "object" ? payload.teams : {};
    second = truthy(global.isSecondInningsStarted);
    side = second ? teams.t2 : teams.t1;
    side = side && typeof side === "object" ? side : {};
    stage = payload.atThisStage && typeof payload.atThisStage === "object" ? payload.atThisStage : {};
    return assess({
      ended: global.isMatchEnded,
      secondStarted: global.isSecondInningsStarted,
      superOver: global.isSuperOver,
      testMatch: global.isTestOr2x,
      overs: bar.overs != null ? bar.overs : side.overs,
      wickets: bar.tWickets != null ? bar.tWickets : side.wickets,
      total: bar.tTotal != null ? bar.tTotal : side.runs,
      maxOvers: global.totalOvers,
      revisedOvers: global.revisedOvers,
      code: side.code || stage.tCode || "",
      name: side.name || stage.tName || "",
      inningsEnded: payload.inningsEnd,
      drinks: indicatesDrinks(payload),
      viewId: payload.viewId != null ? payload.viewId : payload.view
    }, hint);
  }

  function fromRest(body, hint) {
    var data;
    var values;
    var second;
    if (!body || typeof body !== "object") return null;
    data = body.data && typeof body.data === "object" ? body.data : body;
    values = data.values && typeof data.values === "object" ? data.values : null;
    if (!values) return null;
    second = truthy(values.isSecondInningsStarted) || truthy(data.isSecondInningsStarted);
    return assess({
      ended: values.isMatchEnded,
      secondStarted: second,
      superOver: values.isSuperOver || data.isSuperOver,
      testMatch: values.isTestOr2x || data.isIs2XCricket,
      overs: values.overs,
      wickets: values.tWickets,
      total: values.tTotal,
      maxOvers: values.totalOvers,
      revisedOvers: values.revisedOvers,
      code: second ? (values.t2Code || values.t2Name || "") : (values.t1Code || values.t1Name || ""),
      name: second ? (values.t2Name || "") : (values.t1Name || ""),
      inningsEnded: false,
      drinks: indicatesDrinks(body)
    }, hint);
  }

  function parseSseScore(text) {
    var lines = String(text || "").split(/\r?\n/);
    var eventName = "";
    var i;
    var line;
    var data;
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (line.indexOf("event:") === 0) {
        eventName = line.slice(6).replace(/^\s+/, "");
        continue;
      }
      if (line.indexOf("data:") === 0 && eventName === "score-update") {
        data = line.slice(5).replace(/^\s+/, "");
        if (!data || data.charAt(0) !== "{") continue;
        try {
          return JSON.parse(data);
        } catch (error) {
          return null;
        }
      }
    }
    return null;
  }

  return {
    overlayCode: overlayCode,
    staticMatch: staticMatch,
    sourceFromUrl: sourceFromUrl,
    sseUrl: sseUrl,
    restUrl: restUrl,
    restHeaders: restHeaders,
    assess: assess,
    fromSse: fromSse,
    fromRest: fromRest,
    parseSseScore: parseSseScore,
    drinksOver: drinksOver,
    divisionFromHint: divisionFromHint,
    groundHint: groundHint,
    alertPresentation: alertPresentation
  };
});
