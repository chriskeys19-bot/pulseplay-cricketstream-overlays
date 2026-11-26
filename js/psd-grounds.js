/*
 * Age-group sponsors for the PSD Youth Cricket Tournament 2026 grounds.
 * Top-left follows the division on that ground. CTS West and Sycamore 2
 * play a different division in the afternoon, so the sponsor changes at
 * noon Pacific. Every other listed ground keeps one sponsor all day.
 * The bottom-left tournament sponsor is Discover San Ramon on all of them.
 * Other tournaments are not in this table and keep the ordinary layout.
 *
 * Divisions come from pp_streams (same ground, same session, all three days).
 * Stanford's id is stanfordu9, and the games on that ground are U11.
 */
(function (global) {
  var ZONE = "America/Los_Angeles";
  var NOON = 12 * 60;
  var PUBLIC = "https://lutcbvzunjcosncvdyke.supabase.co/storage/v1/object/public/pulseplay-assets/logos/";
  var SPONSORS = {
    u9: {
      division: "U9",
      label: "Dublin Kia",
      assetId: "logo-1795109375279",
      fallbackSrc: PUBLIC + "logo-1795109375279.png"
    },
    u11: {
      division: "U11",
      label: "San Ramon Grizzlies",
      assetId: "logo-1795110181170",
      fallbackSrc: PUBLIC + "logo-1795110181170.jpeg"
    },
    u13: {
      division: "U13",
      label: "Fremont Bank",
      assetId: "logo-1795110230649",
      fallbackSrc: PUBLIC + "logo-1795110230649.png"
    },
    u15: {
      division: "U15",
      label: "Discover San Ramon",
      assetId: "logo-1795110263439",
      fallbackSrc: PUBLIC + "logo-1795110263439.png"
    }
  };
  /* [morning division, afternoon division]. sycamore1 is the same field as sycamore3. */
  var GROUNDS = {
    stanfordu9: ["u11", "u11"],
    ctsu11: ["u13", "u11"],
    "4leaf": ["u13", "u13"],
    sycamore2: ["u15", "u13"],
    sycamore1: ["u15", "u15"],
    sycamore3: ["u15", "u15"],
    pms1: ["u9", "u9"],
    pms2: ["u9", "u9"],
    hpms: ["u11", "u11"]
  };

  function pacificMinutes(date) {
    var fmt;
    var parts;
    var i;
    var hour = 0;
    var minute = 0;
    var value;
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    parts = fmt.formatToParts(date instanceof Date ? date : new Date(date));
    for (i = 0; i < parts.length; i++) {
      if (parts[i].type === "hour") hour = parseInt(parts[i].value, 10);
      if (parts[i].type === "minute") minute = parseInt(parts[i].value, 10);
    }
    if (hour === 24) hour = 0;
    if (isNaN(hour)) hour = 0;
    if (isNaN(minute)) minute = 0;
    return hour * 60 + minute;
  }

  function sessionOf(date, override) {
    var forced = String(override || "").toLowerCase();
    if (forced === "am" || forced === "pm") return forced;
    return pacificMinutes(date) < NOON ? "am" : "pm";
  }

  function isGround(id) {
    return Object.prototype.hasOwnProperty.call(GROUNDS, String(id || ""));
  }

  function ageSponsor(id, date, override) {
    var pair = GROUNDS[String(id || "")];
    var session;
    var key;
    var sponsor;
    if (!pair) return null;
    session = sessionOf(date, override);
    key = session === "am" ? pair[0] : pair[1];
    sponsor = SPONSORS[key];
    return {
      groundId: String(id),
      session: session,
      split: pair[0] !== pair[1],
      division: sponsor.division,
      label: sponsor.label,
      assetId: sponsor.assetId,
      fallbackSrc: sponsor.fallbackSrc
    };
  }

  function tournamentSponsor() {
    var sponsor = SPONSORS.u15;
    return {
      label: sponsor.label,
      assetId: sponsor.assetId,
      fallbackSrc: sponsor.fallbackSrc
    };
  }

  global.PulsePlayPsd = {
    isGround: isGround,
    sessionOf: sessionOf,
    pacificMinutes: pacificMinutes,
    ageSponsor: ageSponsor,
    tournamentSponsor: tournamentSponsor,
    grounds: GROUNDS
  };
})(typeof window !== "undefined" ? window : global);
