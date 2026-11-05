// Jednoduché heslo pro celý web. Zapne se, jakmile je v Cloudflare nastavený secret SITE_PASSWORD.
const COOKIE = "treffik_auth";
const DAYS = 30;
const OPEN = new Set(["/og.jpg", "/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/favicon-512.png"]);

async function token(pw) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("treffik-navrh"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const cookieOf = (req) => Object.fromEntries((req.headers.get("cookie") || "").split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf("="); return [c.slice(0, i), c.slice(i + 1)]; }));

function page(url, error) {
  const o = url.origin;
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Treffik · návrh redesignu</title><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:title" content="Treffik · návrh redesignu"><meta property="og:description" content="Víte, co vás na cestě čeká. Analýza, user flow, proklikávací prototyp a nápady k rozhodnutí.">
<meta property="og:image" content="${o}/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${o}/">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${o}/og.jpg">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:#EDF0EE;color:#141A16;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-variant-ligatures:no-common-ligatures}
.card{width:min(100%,380px);background:#fff;border:1px solid #DFE4E1;border-radius:22px;padding:28px 24px;box-shadow:0 18px 44px -24px rgba(20,30,25,.35);text-align:center}
.logo{width:56px;height:56px;margin:0 auto 14px;display:block}h1{margin:0;font-size:22px;font-weight:800}p{margin:6px 0 20px;color:#66706A;font-size:14px;line-height:1.5}
form{display:flex;flex-direction:column;gap:10px;text-align:left}label{font-size:12px;font-weight:700;color:#66706A;letter-spacing:.04em;text-transform:uppercase}
input{height:46px;border:1px solid #DFE4E1;border-radius:12px;padding:0 14px;font-family:inherit;font-size:16px;font-weight:600;outline:none}input:focus{border-color:#2E9E4A;box-shadow:0 0 0 3px rgba(46,158,74,.18)}
button{height:46px;border:0;border-radius:12px;background:#2E9E4A;color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px}button:hover{background:#278A40}
.err{margin:0;color:#C8382A;font-size:13px;font-weight:600}.foot{margin-top:18px;font-size:12px;color:#8A948E}
</style></head><body><main class="card">
<svg class="logo" viewBox="0 0 48 48" aria-hidden="true"><rect x="1" y="1" width="46" height="46" rx="11" fill="#fff" stroke="#DDE3DF" stroke-width="1.5"/><circle cx="24" cy="14.91" r="5.82" fill="#E53935"/><circle cx="24" cy="24.44" r="5.82" fill="#F9A825"/><circle cx="24" cy="33.1" r="5.82" fill="#34A853"/></svg>
<h1>Treffik</h1><p>Návrh redesignu aplikace. Pro vstup zadejte heslo, které jste dostali spolu s odkazem.</p>
<form method="post" action="/login${url.search ? "?next=" + encodeURIComponent(url.pathname + url.search) : ""}"><label for="pw">Heslo</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>${error ? `<p class="err">Heslo nesedí, zkuste to prosím znovu.</p>` : ""}
<button type="submit">Vstoupit</button></form><div class="foot">Přihlášení vydrží ${DAYS} dní na tomto zařízení.</div></main></body></html>`;
}

// vrátí Response, když je potřeba přihlásit, jinak null
export async function gate(req, env, url) {
  const pw = env.SITE_PASSWORD;
  if (!pw || OPEN.has(url.pathname)) return null;
  const good = await token(pw);
  if (url.pathname === "/login" && req.method === "POST") {
    const form = await req.formData();
    if ((form.get("password") || "") === pw) {
      const next = url.searchParams.get("next");
      const to = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      return new Response(null, { status: 303, headers: { location: to, "set-cookie": `${COOKIE}=${good}; Max-Age=${DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax` } });
    }
    await new Promise((r) => setTimeout(r, 700));
    return new Response(page(url, true), { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (cookieOf(req)[COOKIE] === good) return null;
  if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: "Je potřeba se přihlásit" }), { status: 401, headers: { "content-type": "application/json" } });
  // 200, ne 401: WhatsApp a další sítě si náhled z chybové stránky nevezmou
  return new Response(page(url, false), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
