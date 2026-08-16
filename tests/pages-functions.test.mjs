import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sanitizeHoldings, syncHoldingsToGitHub } from "../functions/lib/github-holdings.js";
import { normalizeSecurityInput, parseSinaQuote } from "../functions/lib/security-lookup.js";
import { onRequestPost } from "../functions/api/holdings-sync.js";

const holding = { market: "美股", code: "NVDA", name: "英伟达", status: "holding", cost: 200, qty: 3, currency: "USD", sina: "gb_nvda", buyFeeUsd: 20 };

test("normalizes security codes for all supported markets", () => {
  assert.deepEqual(normalizeSecurityInput("A股", "SH.601138"), { market: "A股", code: "601138", sina: "sh601138", currency: "CNY" });
  assert.deepEqual(normalizeSecurityInput("港股", "1810"), { market: "港股", code: "01810", sina: "hk01810", currency: "HKD" });
  assert.deepEqual(normalizeSecurityInput("美股", "$nvda"), { market: "美股", code: "NVDA", sina: "gb_nvda", currency: "USD" });
});

test("parses names from Sina quote payloads", () => {
  assert.equal(parseSinaQuote('var hq_str_sh601138="工业富联,65.600,65.230,66.190";', normalizeSecurityInput("A股", "601138")).name, "工业富联");
  assert.equal(parseSinaQuote('var hq_str_hk01810="XIAOMI-W,小米集团-W,25.860,25.880,26.120,25.440,25.620";', normalizeSecurityInput("港股", "1810")).name, "小米集团-W");
  assert.equal(parseSinaQuote('var hq_str_gb_nvda="英伟达,225.1600,-0.06";', normalizeSecurityInput("美股", "NVDA")).name, "英伟达");
});

test("sanitizes holdings before synchronization", () => {
  assert.deepEqual(sanitizeHoldings([{ ...holding, ignored: "never-upload" }]), [holding]);
});

test("updates GitHub using the current file SHA", async () => {
  const calls = [];
  const result = await syncHoldingsToGitHub([holding], { token: "test-token", owner: "example", repo: "piggy" }, async (url, options) => {
    calls.push({ url, options });
    if (!options.method) return Response.json({ sha: "old-sha" });
    return Response.json({ commit: { sha: "commit-sha" }, content: { sha: "file-sha", html_url: "https://example.test/holdings.json" } });
  });
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].options.body).sha, "old-sha");
  assert.deepEqual(result, { commitSha: "commit-sha", fileSha: "file-sha", fileUrl: "https://example.test/holdings.json", alreadyCurrent: false });
});

test("accepts an identical GitHub file without creating another commit", async () => {
  const content = Buffer.from(JSON.stringify([holding], null, 2) + "\n").toString("base64");
  let calls = 0;
  const result = await syncHoldingsToGitHub([holding], { token: "test-token" }, async () => {
    calls += 1;
    return Response.json({ sha: "same-sha", content, html_url: "https://example.test/holdings.json" });
  });
  assert.equal(calls, 1);
  assert.equal(result.alreadyCurrent, true);
  assert.equal(result.fileSha, "same-sha");
});

test("refuses writes when site authentication is not configured", async () => {
  const response = await onRequestPost({
    request: new Request("https://example.test/api/holdings-sync", { method: "POST", body: JSON.stringify({ holdings: [holding] }) }),
    env: {},
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test("client adopts local holdings only after GitHub confirms the write", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const syncIndex = source.indexOf("await syncHoldingsToGitHubClient(nextHoldings)");
  const localIndex = source.indexOf("state.holdings = nextHoldings", syncIndex);
  assert.ok(syncIndex > 0);
  assert.ok(localIndex > syncIndex);
  assert.match(source, /GitHub 同步失败，本次未保存/);
});
