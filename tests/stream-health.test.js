const assert = require("node:assert/strict");
const test = require("node:test");
const health = require("../js/stream-health.js");

test("live and healthy is green, testing is amber, and a stalled live stream is red", () => {
  assert.deepEqual(
    health.classifyStreamHealth({ lifeCycle: "live", boundStreamId: "stream1", streamStatus: "active", healthStatus: "good", issues: [] }),
    { tone: "good", label: "Live", detail: "" }
  );
  assert.equal(health.classifyStreamHealth({ lifeCycle: "live", boundStreamId: "s", streamStatus: "active", healthStatus: "ok" }).tone, "good");
  assert.equal(health.classifyStreamHealth({ lifeCycle: "testing", boundStreamId: "s", streamStatus: "active", healthStatus: "good" }).tone, "warn");
  assert.equal(health.classifyStreamHealth({ lifeCycle: "liveStarting", boundStreamId: "s", streamStatus: "active", healthStatus: "ok" }).label, "Starting");
  const stalled = health.classifyStreamHealth({
    lifeCycle: "live",
    boundStreamId: "s",
    streamStatus: "inactive",
    healthStatus: "noData",
    issues: [{ severity: "error", reason: "noData", description: "YouTube is not receiving data." }]
  });
  assert.equal(stalled.tone, "bad");
  assert.equal(stalled.label, "NO DATA");
  assert.match(stalled.detail, /not receiving data/);
  const bad = health.classifyStreamHealth({ lifeCycle: "live", boundStreamId: "s", streamStatus: "active", healthStatus: "bad", issues: [] });
  assert.equal(bad.tone, "bad");
  assert.equal(bad.label, "STREAM STALLED");
  assert.equal(health.classifyStreamHealth({ lifeCycle: "ready", boundStreamId: "s", streamStatus: "inactive", healthStatus: "noData" }).tone, "muted");
  assert.equal(health.classifyStreamHealth(null).tone, "muted");
});
