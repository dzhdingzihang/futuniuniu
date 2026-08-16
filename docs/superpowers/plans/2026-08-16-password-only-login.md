# Password-Only Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser Basic Auth with a branded login page that always displays the configured flower name and asks only for the password before granting access to the complete portfolio application and APIs.

**Architecture:** Cloudflare server code renders `/login`, accepts `POST /api/login`, and issues a seven-day `HttpOnly`, `Secure`, `SameSite=Strict` session cookie signed with HMAC-SHA256. Every page, static holding file, and portfolio API remains server-protected; authenticated users can explicitly clear the cookie through `POST /api/logout`.

**Tech Stack:** Cloudflare Pages Functions, Cloudflare Worker Web Crypto, vanilla HTML/CSS/JavaScript, Node test runner, Vite Sites packaging.

---

### Task 1: Add signed session primitives and the password-only login page

**Files:**
- Modify: `/Users/dingzihang/Documents/个人小项目/futuniuniu/functions/_middleware.js`
- Test: `/Users/dingzihang/Documents/个人小项目/futuniuniu/tests/pages-functions.test.mjs`

- [ ] **Step 1: Write failing authentication tests**

Add tests that request `/` without a cookie and expect a `302` redirect to `/login`, request `/login` and expect visible text `我的花名` with exactly one password input, submit an incorrect password and expect `401`, submit the configured password and expect a `Set-Cookie` header containing `HttpOnly`, `Secure`, and `SameSite=Strict`, reuse that cookie to load `/` and APIs, tamper with it and expect rejection, and post `/api/logout` to expire the cookie.

- [ ] **Step 2: Run the production function tests and verify the new tests fail**

Run:

```bash
node --test tests/pages-functions.test.mjs
```

Expected: the new password-login assertions fail because the middleware still expects an `Authorization: Basic` header.

- [ ] **Step 3: Implement signed sessions and the login routes**

Implement helpers with these interfaces:

```js
const SESSION_COOKIE = "piggy_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

async function createSessionValue(password, now = Date.now()) {
  const payload = base64UrlEncode(JSON.stringify({ exp: now + SESSION_TTL_SECONDS * 1000 }));
  return payload + "." + await hmacHex(password, payload);
}

async function hasValidSession(request, password, now = Date.now()) {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !(await constantTimeEqual(signature, await hmacHex(password, payload)))) return false;
  const session = JSON.parse(base64UrlDecode(payload));
  return Number(session.exp) > now;
}
```

Render `/login` as a self-contained black-gold page with the fixed display name, one password field, an error region, and client JavaScript that posts JSON `{ password }` to `/api/login`. A successful response navigates to a same-origin relative `next` target; an error keeps the password field visible and shows a concise message.

Handle routes before protected content:

```js
if (request.method === "GET" && url.pathname === "/login") return loginPage(env.BASIC_AUTH_USER || "我的花名", safeNext(url));
if (request.method === "POST" && url.pathname === "/api/login") return login(request, env);
if (request.method === "POST" && url.pathname === "/api/logout") return logout();
```

Use `BASIC_AUTH_PASSWORD` only on the server. Missing login configuration must return `503`; page requests without a valid session redirect to `/login`, while protected API requests return JSON `401` without calling downstream handlers.

- [ ] **Step 4: Run tests and verify the production authentication path passes**

Run:

```bash
node --check functions/_middleware.js
node --test tests/pages-functions.test.mjs
git diff --check
```

Expected: syntax passes, all tests pass, and the diff contains no whitespace errors.

### Task 2: Mirror authentication into the Sites preview worker

**Files:**
- Modify: `/Users/dingzihang/Desktop/丁子航的资金理财/optimized-v1-cockpit/worker/index.js`
- Test: `/Users/dingzihang/Desktop/丁子航的资金理财/optimized-v1-cockpit/tests/sites-worker.test.mjs`

- [ ] **Step 1: Replace Basic Auth test helpers with session-login helpers**

Add a helper that posts the test password to `/api/login`, extracts the first cookie pair from `Set-Cookie`, and returns authenticated requests with `Cookie: piggy_session=...`. Preserve the table-driven coverage for pages, static assets, security lookup, and GitHub synchronization.

- [ ] **Step 2: Run the Sites tests and confirm they fail against the old Worker**

Run:

```bash
npm run test:sites
```

Expected: password-form and session-cookie tests fail because the Worker still requires an Authorization header.

- [ ] **Step 3: Implement the same login/session behavior in the preview Worker**

Port the exact session helpers, login HTML, `/api/login`, `/api/logout`, page redirect, API JSON rejection, and fail-closed configuration behavior from the production middleware into `worker/index.js`. Keep the existing security-lookup, holdings-sync, and static SPA fallback branches unchanged after authentication succeeds.

- [ ] **Step 4: Build and test the Sites package**

Run:

```bash
npm run build
npm run test:sites
```

Expected: the build succeeds, all Sites tests pass, and `dist/server/index.js` contains the session routes but no literal production password.

### Task 3: Add explicit sign-out to the application header

**Files:**
- Modify: `/Users/dingzihang/Documents/个人小项目/futuniuniu/assets/app.js`
- Modify: `/Users/dingzihang/Documents/个人小项目/futuniuniu/assets/styles.css`
- Modify: `/Users/dingzihang/Desktop/丁子航的资金理财/optimized-v1-cockpit/public/assets/app.js`
- Modify: `/Users/dingzihang/Desktop/丁子航的资金理财/optimized-v1-cockpit/public/assets/styles.css`
- Test: `/Users/dingzihang/Documents/个人小项目/futuniuniu/tests/pages-functions.test.mjs`
- Test: `/Users/dingzihang/Desktop/丁子航的资金理财/optimized-v1-cockpit/tests/sites-worker.test.mjs`

- [ ] **Step 1: Add a header logout button and handler tests**

Require a real button labeled `退出`, and assert the client posts to `/api/logout` before navigating to `/login`.

- [ ] **Step 2: Implement the logout control**

Add a small secondary header action aligned with `修改持仓` and `刷新`. Handle it with:

```js
await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
location.assign("/login");
```

Disable the button while the request is active and retain an accessible text label on mobile.

- [ ] **Step 3: Rebuild and run both test suites**

Run:

```bash
node --check assets/app.js
node --test tests/pages-functions.test.mjs
cd "/Users/dingzihang/Desktop/丁子航的资金理财/optimized-v1-cockpit" && npm run build && npm run test:sites
```

Expected: both suites pass and no application source contains the configured password.

### Task 4: Publish and verify Cloudflare production

**Files:**
- Modify: `/Users/dingzihang/Documents/个人小项目/futuniuniu/README.md`
- Modify: `/Users/dingzihang/Documents/个人小项目/futuniuniu/CLOUDFLARE.md`

- [ ] **Step 1: Document the password-only login behavior**

State that the display name comes from `BASIC_AUTH_USER`, the password stays in encrypted `BASIC_AUTH_PASSWORD`, the browser receives only a signed `HttpOnly` cookie, and `/api/logout` clears the session. Do not store the configured password in documentation or source.

- [ ] **Step 2: Commit the verified changes**

Run:

```bash
git add functions/_middleware.js tests/pages-functions.test.mjs assets/app.js assets/styles.css README.md CLOUDFLARE.md docs/superpowers/plans/2026-08-16-password-only-login.md
git commit -m "Add password-only portfolio login"
```

Expected: one commit is created and `git status --short` is empty.

- [ ] **Step 3: Confirm Cloudflare encrypted login values and push**

List secret names without displaying values, then push `main`. Do not deploy if either `BASIC_AUTH_USER` or `BASIC_AUTH_PASSWORD` is absent.

- [ ] **Step 4: Verify the production login and protected routes**

Confirm on both `https://futuniuniu.pages.dev` and `https://alixjd.com`:

```text
GET /                     -> 302 /login when signed out
GET /login                -> 200, displays 我的花名 and one password field
POST /api/login wrong     -> 401, no session cookie
POST /api/login correct   -> 200, signed HttpOnly session cookie
GET / with session        -> 200 application
GET /api/rates session    -> 200 JSON
POST /api/logout session  -> 200 and expired cookie
```

Use the correct login only through a hidden-input or browser form flow so it does not appear in command history or logs.

