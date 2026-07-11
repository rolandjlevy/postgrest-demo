import { useState, useEffect, useRef } from 'react';

const API = process.env.POSTGREST_URL || 'http://localhost:3000';

// -----------------------------------------------------------------------------
// The endpoint catalogue.
//
// Every entry here corresponds to something declared in db/init.sql — a table,
// a view, or a function. Nothing in this app defines an endpoint; the database
// does. The `sql` field is what PostgREST effectively runs, shown so the
// URL-to-query mapping is visible rather than magic.
// -----------------------------------------------------------------------------
const ENDPOINTS = [
  {
    group: 'Table',
    source: 'api.branches',
    label: 'List branches',
    method: 'GET',
    path: '/branches',
    note: 'RLS silently restricts this. Anonymous callers get only active + B2C-visible rows — the internal depots are not filtered by the API, the database refuses to return them.',
    sql: 'SELECT * FROM api.branches;\n-- RLS appends: WHERE is_active AND show_on_b2c',
  },
  {
    group: 'Table',
    source: 'api.branches',
    label: 'Select columns',
    method: 'GET',
    path: '/branches?select=name,postcode',
    note: 'select= maps straight onto the SELECT list.',
    sql: 'SELECT name, postcode FROM api.branches;',
  },
  {
    group: 'Table',
    source: 'api.branches',
    label: 'Filter: equals',
    method: 'GET',
    path: '/branches?postcode=eq.LE1 1AA',
    note: 'Filters read as column=operator.value. eq, gt, lt, gte, lte, like, in, is.',
    sql: "SELECT * FROM api.branches\nWHERE postcode = 'LE1 1AA';",
  },
  {
    group: 'Table',
    source: 'api.branches',
    label: 'Filter: greater than',
    method: 'GET',
    path: '/branches?lat=gt.52.9',
    note: 'Numeric comparison. Everything north of Derby.',
    sql: 'SELECT * FROM api.branches\nWHERE lat > 52.9;',
  },
  {
    group: 'Table',
    source: 'api.branches',
    label: 'Order + limit',
    method: 'GET',
    path: '/branches?order=name.asc&limit=3',
    note: 'order and limit map onto ORDER BY and LIMIT.',
    sql: 'SELECT * FROM api.branches\nORDER BY name ASC\nLIMIT 3;',
  },
  {
    group: 'Table',
    source: 'api.branches',
    label: 'Combined query',
    method: 'GET',
    path: '/branches?select=name,lat&lat=gt.52.5&order=lat.desc&limit=4',
    note: 'Params compose. This is the point: no endpoint was written for this combination — it just works.',
    sql: 'SELECT name, lat FROM api.branches\nWHERE lat > 52.5\nORDER BY lat DESC\nLIMIT 4;',
  },
  {
    group: 'View',
    source: 'api.public_branches',
    label: 'Public branches',
    method: 'GET',
    path: '/public_branches',
    note: 'A view IS an endpoint. The filtering is baked into the view definition, so the contract is fixed by construction rather than by policy.',
    sql: 'SELECT id, name, postcode, lat, lon\nFROM api.branches\nWHERE is_active AND show_on_b2c;',
  },
  {
    group: 'Function',
    source: 'api.branches_near()',
    label: 'Branches near (RPC)',
    method: 'POST',
    path: '/rpc/branches_near',
    body: { lat: 52.6369, lon: -1.1398, radius_miles: 40 },
    note: 'A Postgres function exposed as POST /rpc/<name>. Real haversine distance maths, zero application code.',
    sql: 'SELECT id, name, postcode,\n  3959 * ACOS(...) AS distance\nFROM api.branches\nWHERE distance < radius_miles\nORDER BY distance;',
  },
  {
    group: 'Write',
    source: 'api.enquiries',
    label: 'Submit enquiry',
    method: 'POST',
    path: '/enquiries',
    body: { branch_id: 1, name: 'Ada', email: 'ada@example.com', message: 'Do you stock M6 bolts?' },
    note: 'Anonymous can INSERT but has no SELECT grant, so it cannot read enquiries back. A public contact form, enforced at the database.',
    sql: "INSERT INTO api.enquiries\n  (branch_id, name, email, message)\nVALUES (1, 'Ada', ...);",
  },
  {
    group: 'Write',
    source: 'api.enquiries',
    label: 'Read enquiries (denied)',
    method: 'GET',
    path: '/enquiries',
    note: 'Expected to fail with 401. Proves the asymmetry above is real, not cosmetic.',
    sql: '-- No SELECT grant for web_anon.\n-- Postgres refuses before any row is read.',
    expectFail: true,
  },
];

const METHOD_TONE = { GET: 'get', POST: 'post' };

export default function Playground() {
  const [active, setActive] = useState(ENDPOINTS[0]);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(null);
  const bodyRef = useRef(null);

  // Ping PostgREST so the connection state is honest rather than assumed.
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const r = await fetch(`${API}/branches?limit=1`);
        if (!cancelled) setOnline(r.ok || r.status === 401);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    ping();
    const t = setInterval(ping, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const send = async () => {
    setLoading(true);
    setRes(null);
    const started = performance.now();

    const url = `${API}${active.path}`;
    const init = { method: active.method, headers: {} };

    if (active.method === 'POST') {
      init.headers['Content-Type'] = 'application/json';
      // Prefer the (possibly edited) textarea contents over the preset.
      const raw = bodyRef.current?.value ?? JSON.stringify(active.body ?? {});
      init.body = raw;
      // Ask PostgREST to return the inserted row rather than an empty 201.
      init.headers.Prefer = 'return=representation';
    }

    try {
      const r = await fetch(url, init);
      const elapsed = Math.round(performance.now() - started);
      const text = await r.text();
      let parsed;
      try {
        parsed = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        parsed = text || '(empty response body)';
      }
      setRes({ status: r.status, ok: r.ok, elapsed, body: parsed });
    } catch (err) {
      setRes({
        status: 0,
        ok: false,
        elapsed: Math.round(performance.now() - started),
        body: `Could not reach PostgREST at ${API}\n\n${err.message}\n\nIs docker compose up running?`,
      });
    } finally {
      setLoading(false);
    }
  };

  const grouped = ENDPOINTS.reduce((acc, e) => {
    (acc[e.group] ||= []).push(e);
    return acc;
  }, {});

  return (
    <div className="shell">
      <header className="bar">
        <div className="bar__id">
          <span className="bar__mark">▚</span>
          <h1>PostgREST</h1>
          <p>No route handlers. The schema is the API.</p>
        </div>
        <div className={`conn conn--${online === null ? 'wait' : online ? 'up' : 'down'}`}>
          <span className="conn__dot" />
          {online === null ? 'connecting' : online ? `${API}` : 'offline'}
        </div>
      </header>

      <main className="grid">
        {/* ---- Catalogue: every endpoint the database generated ---- */}
        <nav className="cat">
          {Object.entries(grouped).map(([group, items]) => (
            <section key={group} className="cat__group">
              <p className="cat__head">
                {group}
                <span>{items[0].source}</span>
              </p>
              {items.map((e) => (
                <button
                  key={e.label}
                  className={`cat__item ${active.label === e.label ? 'is-on' : ''}`}
                  onClick={() => {
                    setActive(e);
                    setRes(null);
                  }}
                >
                  <span className={`verb verb--${METHOD_TONE[e.method]}`}>{e.method}</span>
                  {e.label}
                </button>
              ))}
            </section>
          ))}
        </nav>

        {/* ---- Request: the URL, and what it actually means ---- */}
        <section className="req">
          <div className="req__wire">
            <span className={`verb verb--${METHOD_TONE[active.method]} verb--lg`}>
              {active.method}
            </span>
            <code className="req__url">
              <span className="req__host">{API}</span>
              {active.path}
            </code>
            <button className="fire" onClick={send} disabled={loading}>
              {loading ? 'sending…' : 'Send'}
            </button>
          </div>

          {/* THE SIGNATURE: the URL and the SQL, adjacent. This is the whole
              concept made literal — the querystring IS the query. */}
          <div className="rosetta">
            <p className="rosetta__tag">what postgres actually runs</p>
            <pre className="rosetta__sql">{active.sql}</pre>
          </div>

          <p className="req__note">{active.note}</p>

          {active.body && (
            <div className="body">
              <p className="body__tag">request body — editable</p>
              <textarea
                ref={bodyRef}
                key={active.label}
                defaultValue={JSON.stringify(active.body, null, 2)}
                spellCheck={false}
                rows={7}
              />
            </div>
          )}
        </section>

        {/* ---- Response ---- */}
        <section className="res">
          {!res && !loading && (
            <div className="res__idle">
              <p>Send a request to see the response.</p>
            </div>
          )}
          {loading && <div className="res__idle"><p>waiting…</p></div>}
          {res && (
            <>
              <div className="res__bar">
                <span
                  className={`code ${
                    res.ok ? 'code--ok' : active.expectFail ? 'code--expected' : 'code--bad'
                  }`}
                >
                  {res.status || 'ERR'}
                </span>
                <span className="res__time">{res.elapsed}ms</span>
                {active.expectFail && !res.ok && (
                  <span className="res__expected">failing on purpose — that's the lesson</span>
                )}
              </div>
              <pre className="res__body">{res.body}</pre>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
