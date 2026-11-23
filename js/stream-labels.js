/*
 * Short tournament name for a Streams card. Known codes only.
 * Prefer a tournament column, then event, then the id prefix (amlca-...).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayStreamLabels = api;
})(typeof window !== "undefined" ? window : this, function () {
  var CODES = ["AMLCA", "PSD", "NYCT", "NCCA"];

  function canonical(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    var upper = text.toUpperCase();
    var i;
    if (!text) return "";
    for (i = 0; i < CODES.length; i++) if (CODES[i] === upper) return CODES[i];
    return "";
  }

  function tournamentName(row) {
    var id;
    var prefix;
    if (!row) return "";
    if (canonical(row.tournament)) return canonical(row.tournament);
    if (canonical(row.event)) return canonical(row.event);
    id = String(row.id || "");
    prefix = id.split("-")[0];
    return canonical(prefix);
  }

  return { tournamentName: tournamentName };
});
