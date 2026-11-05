// Treffik: statický návrh + jednoduché API pro komentáře (Cloudflare D1)
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

let ready = false;
async function init(db) {
  if (ready) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, data TEXT NOT NULL, ts INTEGER NOT NULL)").run();
  ready = true;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      // náhled pro sociální sítě potřebuje absolutní adresu obrázku
      const res = await env.ASSETS.fetch(req);
      const abs = { element(e) { const c = e.getAttribute("content") || ""; if (c.startsWith("/")) e.setAttribute("content", url.origin + c); } };
      return new HTMLRewriter().on('meta[property="og:image"]', abs).on('meta[name="twitter:image"]', abs)
        .on("head", { element(e) { e.prepend(`<meta property="og:url" content="${url.origin}/">`, { html: true }); } })
        .transform(res);
    }
    if (!url.pathname.startsWith("/api/comments")) return env.ASSETS.fetch(req);
    if (!env.DB) return json({ error: "Databáze není připojená" }, 503);
    await init(env.DB);
    const id = decodeURIComponent(url.pathname.slice("/api/comments".length).replace(/^\/+/, ""));

    if (req.method === "GET" && !id) {
      const { results } = await env.DB.prepare("SELECT data FROM comments ORDER BY ts").all();
      return json({ comments: results.map((r) => JSON.parse(r.data)) });
    }
    if (req.method === "PUT" && id) {
      const body = await req.text();
      if (body.length > 20000) return json({ error: "Příliš dlouhé" }, 413);
      let c;
      try { c = JSON.parse(body); } catch { return json({ error: "Neplatná data" }, 400); }
      if (!c || c.id !== id || typeof c.text !== "string" || !c.text.trim() || c.text.length > 4000) return json({ error: "Neplatný komentář" }, 400);
      await env.DB.prepare("INSERT INTO comments (id, data, ts) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
        .bind(id, JSON.stringify(c), Number(c.ts) || Date.now()).run();
      return json({ ok: true });
    }
    if (req.method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM comments WHERE id = ?1").bind(id).run();
      return json({ ok: true });
    }
    return json({ error: "Nepodporovaná metoda" }, 405);
  },
};
