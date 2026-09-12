import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "./index.ts";

test("parses RSS items and CDATA", () => {
  const items = parseFeed(`<rss><channel><item><title><![CDATA[New &amp; shiny]]></title><link>https://example.test/a</link><guid>a</guid></item></channel></rss>`, "Test");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "New & shiny");
  assert.equal(items[0].id, "a");
});

test("parses Atom link attributes", () => {
  const items = parseFeed(`<feed><entry><title>Device</title><link href="https://example.test/device"/><id>device-1</id></entry></feed>`, "Test");
  assert.equal(items[0].url, "https://example.test/device");
});
