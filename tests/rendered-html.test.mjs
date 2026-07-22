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

test("server-renders the card battle", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>카드 파일 전투/);
  assert.match(html, /SOLITAIRE DECKBATTLE/);
  assert.match(html, /훈련용 괴수/);
  assert.match(html, /숲 고블린/);
  assert.match(html, /턴 종료/);
  assert.match(html, /class="piles"/);
  assert.match(html, /카드를 준비하고 있습니다/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
