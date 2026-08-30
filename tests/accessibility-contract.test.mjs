import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const [indexHtml, styles, appSource] = await Promise.all([
  readFile(new URL("index.html", projectRoot), "utf8"),
  readFile(new URL("assets/styles.css", projectRoot), "utf8"),
  readFile(new URL("assets/app.js", projectRoot), "utf8"),
]);

test("static shell exposes a keyboard skip link and an assistive route announcer", () => {
  assert.match(indexHtml, /<a class="skip-link" href="#main-content">跳到主要内容<\/a>/);
  assert.match(indexHtml, /<div id="route-announcer" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"><\/div>/);
  assert.match(indexHtml, /<main id="main-content" class="loading-screen" tabindex="-1">/);
  assert.match(styles, /\.visually-hidden\s*\{[\s\S]*?clip-path:\s*inset\(50%\)/);
  assert.match(styles, /\.skip-link:focus-visible\s*\{[\s\S]*?transform:\s*translateY\(0\)/);
});

test("every dynamic route promotes its semantic main as the skip-link target", () => {
  assert.match(appSource, /const main = document\.querySelector\("#app > main\.page-shell"\)/);
  assert.match(appSource, /main\.id = "main-content"/);
  assert.match(appSource, /main\.setAttribute\("tabindex", "-1"\)/);
  assert.match(appSource, /PAGE_META = \{[\s\S]*overview:[\s\S]*actions:[\s\S]*radar:[\s\S]*trades:/);
  assert.match(appSource, /document\.title = meta\.title \+ " · 猪猪存钱罐"/);
});

test("accessible semantic color tokens keep the required contrast palette", () => {
  assert.match(styles, /--muted:\s*#5f697e;/i);
  assert.match(styles, /--red:\s*#c42f3f;/i);
  assert.match(styles, /--green:\s*#08764f;/i);
  assert.match(styles, /--orange:\s*#a94900;/i);
});

test("forms expose visible keyboard focus and invalid states", () => {
  assert.match(styles, /:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible/);
  assert.match(styles, /\[aria-invalid="true"\]/);
  assert.match(styles, /:user-invalid/);
  assert.match(styles, /border-color:\s*var\(--red\)\s*!important/);
  assert.match(styles, /:where\(\.field-error, \.form-error, \.holding-form-error, \[data-form-error\]\)/);
});

test("reduced-motion preference stops all motion and smooth scrolling", () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\*, \*::before, \*::after\s*\{[\s\S]*?animation:\s*none\s*!important/);
  assert.match(styles, /\*, \*::before, \*::after\s*\{[\s\S]*?transition:\s*none\s*!important/);
  assert.match(styles, /scroll-behavior:\s*auto\s*!important/);
});

test("mobile controls keep 44px targets while header actions remain compact", () => {
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?#main-content :where\(button, input, select, textarea, summary, \[role="button"\]\)[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.site-header \.header-action-button[\s\S]*?min-height:\s*42px;[\s\S]*?height:\s*42px;/);
  assert.match(styles, /\.page-shell :where\(small, \.section-helper, \.page-subtitle\)[\s\S]*?font-size:\s*12px;/);
});
