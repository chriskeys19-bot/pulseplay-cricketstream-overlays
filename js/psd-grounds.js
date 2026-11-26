/*
 * PSD Youth Cricket Tournament 2026 grounds.
 * The top-left logo on air is the sponsor saved on the ground
 * (logos.age_group_sponsor). It does not change at noon Pacific.
 * This table names the division that usually plays there, so Ground setup
 * can suggest the morning and afternoon marks. CTS West and Sycamore 2
 * host two divisions; the operator changes the picker between them.
 * The bottom-left tournament sponsor is Discover San Ramon on all of them.
 * Other tournaments are not in this table and keep the ordinary layout.
 *
 * Divisions come from pp_streams (same ground, same session, all three days).
 * Stanford's id is stanfordu9.
 */
(function (global) {
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

  function isGround(id) {
    return Object.prototype.hasOwnProperty.call(GROUNDS, String(id || ""));
  }

  /* The logo Ground setup saved. Empty means the top-left corner stays blank. */
  function ageLogo(ground) {
    var id = ground && ground.logos && ground.logos.age_group_sponsor;
    if (id == null) return "";
    return String(id).replace(/^\s+|\s+$/g, "");
  }

  /* Morning or afternoon division for the setup hint. Not what the overlay draws. */
  function ageSponsor(id, session) {
    var pair = GROUNDS[String(id || "")];
    var which;
    var key;
    var sponsor;
    if (!pair) return null;
    which = String(session || "").toLowerCase() === "pm" ? "pm" : "am";
    key = which === "am" ? pair[0] : pair[1];
    sponsor = SPONSORS[key];
    return {
      groundId: String(id),
      session: which,
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

  var NAMES = {
    "cts west": "ctsu11",
    "sycamore 2": "sycamore2"
  };

  function groundKey(ground) {
    var id;
    var name;
    if (!ground) return "";
    if (typeof ground === "string") {
      id = String(ground).replace(/^\s+|\s+$/g, "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(GROUNDS, id)) return id;
      return NAMES[id] || "";
    }
    id = String(ground.id || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(GROUNDS, id)) return id;
    name = String(ground.name || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(GROUNDS, name)) return name;
    return NAMES[name] || "";
  }

  function isSplit(ground) {
    var pair = GROUNDS[groundKey(ground)];
    return !!(pair && pair[0] !== pair[1]);
  }

  global.PulsePlayPsd = {
    isGround: isGround,
    ageLogo: ageLogo,
    ageSponsor: ageSponsor,
    tournamentSponsor: tournamentSponsor,
    isSplit: isSplit,
    grounds: GROUNDS
  };
})(typeof window !== "undefined" ? window : global);
