/*
 * Color for a YouTube live broadcast plus its bound liveStream health.
 * good / ok / active while live is green.
 * testing, starting, or a degraded report is amber.
 * noData, bad, or inactive while the broadcast is live is red.
 * Anything else is muted.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PulsePlayStreamHealth = api;
})(typeof window !== "undefined" ? window : this, function () {
  function issueText(row) {
    var issues = row && row.issues;
    var issue;
    var parts;
    if (!issues || !issues.length) return "";
    issue = issues[0] || {};
    parts = [];
    if (issue.description) parts.push(String(issue.description));
    else if (issue.reason) parts.push(String(issue.reason));
    if (issue.severity && parts.length) parts[0] = String(issue.severity) + ": " + parts[0];
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function classifyStreamHealth(row) {
    var life = String(row && row.lifeCycle || "");
    var healthKey = String(row && row.healthStatus || "").toLowerCase();
    var streamKey = String(row && row.streamStatus || "").toLowerCase();
    var live = life === "live";
    var starting = life === "testing" || life === "testStarting" || life === "liveStarting";
    var detail = issueText(row);
    var stalled = healthKey === "nodata" || healthKey === "bad" || streamKey === "inactive" || streamKey === "error" || streamKey === "revoked";
    if (!row || !life || life === "complete" || life === "created" || life === "ready") {
      return { tone: "muted", label: life ? "No broadcast" : "No broadcast", detail: "" };
    }
    if (life === "revoked") return { tone: "muted", label: "Revoked", detail: detail };
    if (live && stalled) {
      return {
        tone: "bad",
        label: healthKey === "nodata" ? "NO DATA" : "STREAM STALLED",
        detail: detail || (healthKey === "nodata"
          ? "YouTube is not receiving video data."
          : streamKey === "inactive"
            ? "The bound stream is inactive."
            : "YouTube reports this stream as " + (row.healthStatus || row.streamStatus) + ".")
      };
    }
    if (live && !row.boundStreamId) {
      return { tone: "bad", label: "STREAM STALLED", detail: detail || "No stream is bound to this broadcast." };
    }
    if (live && (healthKey === "good" || healthKey === "ok" || streamKey === "active")) {
      if (detail && /error/i.test(String(row.issues && row.issues[0] && row.issues[0].severity || ""))) {
        return { tone: "warn", label: "Live · degraded", detail: detail };
      }
      return { tone: "good", label: "Live", detail: detail };
    }
    if (starting || streamKey === "ready" || streamKey === "created") {
      return {
        tone: "warn",
        label: life === "testing" ? "Testing" : (life === "testStarting" || life === "liveStarting" ? "Starting" : "Check stream"),
        detail: detail
      };
    }
    if (live) return { tone: "warn", label: "Live · check", detail: detail || "Stream health has not reported yet." };
    return { tone: "muted", label: "Offline", detail: "" };
  }

  return { classifyStreamHealth: classifyStreamHealth, issueText: issueText };
});
