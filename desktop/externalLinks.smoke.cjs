"use strict";

const assert = require("node:assert/strict");
const {
  createExternalLinkWindowHandler,
  isSafeExternalLinkUrl,
} = require("./externalLinks.cjs");

assert.equal(isSafeExternalLinkUrl("https://localhost/page"), true);
assert.equal(isSafeExternalLinkUrl("http://127.0.0.1/page"), true);
for (const value of [
  "javascript:alert(1)",
  "data:text/plain,unsafe",
  "file:///C:/private.txt",
  "/relative",
  "not a URL",
]) {
  assert.equal(isSafeExternalLinkUrl(value), false, value);
}

const opened = [];
const handler = createExternalLinkWindowHandler((url) => {
  opened.push(url);
  return Promise.resolve();
});
assert.deepEqual(handler({ url: "https://localhost/page" }), { action: "deny" });
assert.deepEqual(handler({ url: "javascript:alert(1)" }), { action: "deny" });
assert.deepEqual(opened, ["https://localhost/page"]);

const throwingHandler = createExternalLinkWindowHandler(() => {
  throw new Error("No default browser");
});
assert.deepEqual(
  throwingHandler({ url: "https://localhost/unavailable" }),
  { action: "deny" },
);

console.log("Desktop external-link smoke test passed.");
