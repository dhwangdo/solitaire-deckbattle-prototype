import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the exploration map", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>카드 파일 전투/);
  assert.match(html, /THE DESCENT/);
  assert.match(html, /아래로 이어지는 방/);
  assert.match(html, /class="map-viewport"/);
  assert.match(html, /현재 위치로/);
  assert.match(html, /인접한 방을 클릭해 이동/);
  assert.match(html, /덱 편집/);
  assert.match(html, /aria-label="탐험 지도"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
