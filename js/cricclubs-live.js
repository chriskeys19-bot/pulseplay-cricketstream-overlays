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

  function assess(state) {
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
    if (!state) return null;
    ended = truthy(state.ended);
    second = truthy(state.secondStarted);
    overs = oversNumber(state.overs);
    wickets = wicketsNumber(state.wickets);
    revised = oversNumber(state.revisedOvers);
    scheduled = revised > 0 ? revised : oversNumber(state.maxOvers);
    total = state.total == null ? "" : String(state.total).replace(/^\s+|\s+$/g, "");
    code = String(state.code || state.name || "").replace(/^\s+|\s+$/g, "");
    score = formatScore(code, total, wickets, overs);
    started = overs > 0 || wickets > 0 || (total !== "" && total !== "0");
    if (ended) return { phase: "done", alert: "", score: score, detail: "Final" };
    if (truthy(state.testMatch)) {
      return { phase: "quiet", alert: "", score: started ? score : "", detail: started ? "" : "" };
    }
    if (truthy(state.superOver)) {
      return { phase: "second", alert: "", score: score, detail: "Super over" };
    }
    if (second) {
      if (!started) {
        return { phase: "break", alert: "break", score: score, detail: "Between innings" };
      }
      return { phase: "second", alert: "", score: score, detail: "2nd innings" };
    }
    if (scheduled > 0 && (overs >= scheduled || wickets >= 10 || truthy(state.inningsEnded))) {
      return { phase: "break", alert: "break", score: score, detail: "1st innings complete" };
    }
    if ((scheduled > 0 && overs >= scheduled - 2 && overs < scheduled) || (wickets >= 9 && started)) {
      return {
        phase: "soon",
        alert: "soon",
        score: score,
        detail: wickets >= 9 ? "9 wickets down" : "Within 2 overs of the innings limit"
      };
    }
    if (!started) return { phase: "pre", alert: "", score: "", detail: "Yet to start" };
    return { phase: "first", alert: "", score: score, detail: "1st innings" };
  }

  function fromSse(payload) {
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
      inningsEnded: payload.inningsEnd
    });
  }

  function fromRest(body) {
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
      inningsEnded: false
    });
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
    parseSseScore: parseSseScore
  };
});
