// Treffik: statický návrh + jednoduché API pro komentáře (Cloudflare D1)
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

let ready = false, readyF = false;
// obrázky přiložené ke zprávám v diskuzích
async function files(req, env, url) {
  if (!env.DB) return json({ error: "Databáze není připojená" }, 503);
  if (!readyF) { await env.DB.prepare("CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, ts INTEGER NOT NULL)").run(); readyF = true; }
  const id = decodeURIComponent(url.pathname.slice("/api/files".length).replace(/^\/+/, ""));
  if (req.method === "POST" && !id) {
    const mime = (req.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) return json({ error: "Jen obrázky" }, 415);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 1900000) return json({ error: "Obrázek je moc velký" }, 413);
    const nid = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await env.DB.prepare("INSERT INTO files (id, mime, data, ts) VALUES (?1, ?2, ?3, ?4)").bind(nid, mime, buf, Date.now()).run();
    return json({ id: nid });
  }
  if (req.method === "GET" && id) {
    const row = await env.DB.prepare("SELECT mime, data FROM files WHERE id = ?1").bind(id).first();
    if (!row) return new Response("Nenalezeno", { status: 404 });
    return new Response(new Uint8Array(row.data), { headers: { "content-type": row.mime, "cache-control": "public, max-age=31536000, immutable" } });
  }
  return json({ error: "Nepodporovaná metoda" }, 405);
}
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
    if (url.pathname.startsWith("/api/files")) return files(req, env, url);
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
