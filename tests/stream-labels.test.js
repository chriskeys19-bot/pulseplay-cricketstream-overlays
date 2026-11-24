const assert = require("node:assert/strict");
const test = require("node:test");
const labels = require("../js/stream-labels.js");

test("tournament short names come from the field, the event, or the id", () => {
  assert.equal(labels.tournamentName({ tournament: "amlca", event: "PSD", id: "psd-1" }), "AMLCA");
  assert.equal(labels.tournamentName({ event: "PSD", id: "psd-20261126-stanford-0830" }), "PSD");
  assert.equal(labels.tournamentName({ event: "nyct", id: "other-1" }), "NYCT");
  assert.equal(labels.tournamentName({ id: "ncca-20261126-ground-0900" }), "NCCA");
  assert.equal(labels.tournamentName({ id: "amlca-20261126-a" }), "AMLCA");
  assert.equal(labels.tournamentName({ event: "Friendly", id: "club-1" }), "");
  assert.equal(labels.tournamentName({}), "");
});
