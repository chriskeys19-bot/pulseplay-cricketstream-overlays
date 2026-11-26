/*
 * Pulse Play scope checks for the dashboard. Mirrors the edge-function rules.
 * Full admin sees everything. A tournament admin sees that tournament.
 * An age-group grant sees that division in one tournament, or in every tournament.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayScope = api;
})(typeof window !== "undefined" ? window : this, function () {
  var AGE_GROUPS = ["U9", "U11", "U13", "U15", "U17", "U19"];
  var KNOWN_TOURNAMENTS = ["AMLCA", "NCCA", "NYCT", "PSD"];
  var GROUND_IDS = {
    stanford: "stanfordu9",
    "cts west": "ctsu11",
    "4leaf east": "4leaf",
    "sycamore 2": "sycamore2",
    "sycamore 3": "sycamore3",
    sycamore3: "sycamore3",
    "pms-1": "pms1",
    pms1: "pms1",
    "pms-2": "pms2",
    pms2: "pms2",
    hpms: "hpms"
  };
  var CODE = /^[A-Z][A-Z0-9]{1,11}$/;

  function canonicalTournament(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "").toUpperCase();
    return CODE.test(text) ? text : "";
  }

  function canonicalDivision(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "").toUpperCase();
    return AGE_GROUPS.indexOf(text) === -1 ? "" : text;
  }

  function covers(grant, stream) {
    var tournament;
    var division;
    if (!grant || (grant.status && grant.status !== "active")) return false;
    if (grant.scopeType === "all") return true;
    tournament = canonicalTournament(stream && (stream.tournament || stream.event));
    division = canonicalDivision(stream && stream.division);
    if (grant.scopeType === "tournament") return !!(grant.tournament && tournament && grant.tournament === tournament);
    if (grant.scopeType === "division") {
      if (!grant.division || grant.division !== division) return false;
      if (!grant.tournament) return true;
      return !!(tournament && grant.tournament === tournament);
    }
    return false;
  }

  function streamVisible(access, stream) {
    var scopes;
    var i;
    if (!access || access.fullAdmin) return true;
    scopes = access.scopes || [];
    if (scopes.length) {
      for (i = 0; i < scopes.length; i++) if (covers(scopes[i], stream)) return true;
      return false;
    }
    if (access.divisions && access.divisions.length) return access.divisions.indexOf(stream && stream.division) !== -1;
    return false;
  }

  function groundMatches(ground, stream) {
    var name = String(stream && stream.ground || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    if (!name || !ground) return false;
    if (String(ground.name || "").replace(/^\s+|\s+$/g, "").toLowerCase() === name) return true;
    if (String(ground.id || "").replace(/^\s+|\s+$/g, "").toLowerCase() === name) return true;
    return GROUND_IDS[name] === String(ground.id || "").toLowerCase();
  }

  function groundVisible(access, ground, streams) {
    var i;
    if (!access || access.fullAdmin) return true;
    streams = streams || [];
    for (i = 0; i < streams.length; i++) {
      if (streamVisible(access, streams[i]) && groundMatches(ground, streams[i])) return true;
    }
    return false;
  }

  function canManage(access, target) {
    var scopes;
    var i;
    var grant;
    if (!access) return false;
    if (access.fullAdmin) return true;
    scopes = access.scopes || [];
    for (i = 0; i < scopes.length; i++) {
      grant = scopes[i];
      if (!grant || grant.status && grant.status !== "active") continue;
      if (grant.role !== "admin" || grant.scopeType !== "tournament" || !grant.tournament) continue;
      if (!target || target.scopeType === "all") continue;
      if (target.scopeType === "tournament" && target.tournament === grant.tournament) return true;
      if (target.scopeType === "division" && target.tournament === grant.tournament) return true;
    }
    return false;
  }

  function label(scope) {
    var role = scope && scope.role === "admin" ? "Admin" : "Operator";
    if (!scope) return "";
    if (scope.scopeType === "all") return "All tournaments · " + role;
    if (scope.scopeType === "tournament") return (scope.tournament || "Tournament") + " · " + role;
    if (scope.tournament) return scope.division + " in " + scope.tournament + " · " + role;
    return (scope.division || "Age group") + " in every tournament · " + role;
  }

  function activeScopes(grants) {
    var out = [];
    var i;
    var grant;
    grants = grants || [];
    for (i = 0; i < grants.length; i++) {
      grant = grants[i];
      if (!grant || grant.status && grant.status !== "active") continue;
      out.push(grant);
    }
    return out;
  }

  function summaryFromMe(payload) {
    payload = payload || {};
    var scopes = activeScopes(payload.grants);
    var divisions = payload.divisions || [];
    var fullAdmin = payload.fullAdmin === true || scopes.some(function (grant) {
      return grant.scopeType === "all" && grant.role === "admin";
    });
    return {
      fullAdmin: fullAdmin,
      manage: payload.manage === true || fullAdmin,
      setup: payload.setup === true || fullAdmin,
      broadcasts: payload.broadcasts === true || fullAdmin,
      allowed: payload.allowed === true || fullAdmin || scopes.length > 0 || divisions.length > 0,
      scopes: scopes,
      divisions: divisions
    };
  }

  function legacyAdmin() {
    return { fullAdmin: true, manage: true, setup: true, broadcasts: true, allowed: true, scopes: [], divisions: [] };
  }

  function legacyOperator(divisions) {
    return {
      fullAdmin: false,
      manage: false,
      setup: false,
      broadcasts: false,
      allowed: true,
      scopes: [],
      divisions: divisions || []
    };
  }

  function explainFunctionError(message, fallback) {
    var text = message || "";
    if (text === "Failed to send a request to the Edge Function") {
      return "The access service did not answer. The browser blocked the response, which happens when the function crashes before it can send CORS headers. Reload, and redeploy pp-access if it keeps happening.";
    }
    if (text === "Edge Function returned a non-2xx status code") {
      return fallback || "The access service rejected the request and did not say why.";
    }
    return text || fallback || "That request failed.";
  }

  return {
    AGE_GROUPS: AGE_GROUPS,
    KNOWN_TOURNAMENTS: KNOWN_TOURNAMENTS,
    canonicalTournament: canonicalTournament,
    canonicalDivision: canonicalDivision,
    covers: covers,
    streamVisible: streamVisible,
    groundVisible: groundVisible,
    canManage: canManage,
    label: label,
    summaryFromMe: summaryFromMe,
    legacyAdmin: legacyAdmin,
    legacyOperator: legacyOperator,
    explainFunctionError: explainFunctionError
  };
});
