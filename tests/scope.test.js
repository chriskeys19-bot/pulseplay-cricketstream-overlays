const assert = require("node:assert/strict");
const test = require("node:test");
const scope = require("../js/scope.js");

const access = scope.summaryFromMe({
  fullAdmin: false,
  manage: true,
  setup: true,
  broadcasts: true,
  allowed: true,
  grants: [
    { scopeType: "tournament", tournament: "PSD", division: null, role: "admin", status: "active" },
    { scopeType: "division", tournament: "NYCT", division: "U11", role: "operator", status: "revoked" }
  ]
});

test("the dashboard shows a tournament admin only their games and grounds", () => {
  assert.equal(access.fullAdmin, false);
  assert.equal(access.manage, true);
  assert.equal(scope.streamVisible(access, { event: "PSD", division: "U15", ground: "Stanford" }), true);
  assert.equal(scope.streamVisible(access, { event: "NYCT", division: "U11", ground: "PV1" }), false);
  assert.equal(scope.groundVisible(access, { id: "stanfordu9", name: "Stanford" }, [
    { event: "PSD", division: "U11", ground: "Stanford" },
    { event: "NYCT", division: "U15", ground: "PV1" }
  ]), true);
  assert.equal(scope.groundVisible(access, { id: "pv1", name: "PV1" }, [
    { event: "NYCT", division: "U15", ground: "PV1" }
  ]), false);
  assert.equal(scope.canManage(access, { scopeType: "division", tournament: "PSD", division: "U9" }), true);
  assert.equal(scope.canManage(access, { scopeType: "all", tournament: null, division: null }), false);
});

test("an age-group operator does not see other divisions", () => {
  const operator = scope.summaryFromMe({
    allowed: true,
    grants: [{ scopeType: "division", tournament: null, division: "U13", role: "operator", status: "active" }]
  });
  assert.equal(operator.setup, false);
  assert.equal(operator.broadcasts, false);
  assert.equal(scope.streamVisible(operator, { event: "PSD", division: "U13" }), true);
  assert.equal(scope.streamVisible(operator, { event: "NYCT", division: "U13" }), true);
  assert.equal(scope.streamVisible(operator, { event: "PSD", division: "U11" }), false);
});

test("a missing edge function is explained instead of the generic browser error", () => {
  const message = scope.explainFunctionError("Failed to send a request to the Edge Function", "fallback");
  assert.equal(message.includes("Failed to send a request to the Edge Function"), false);
  assert.match(message, /CORS|redeploy|pp-access/i);
});
