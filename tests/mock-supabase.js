// Minimal in-memory imitation of the Supabase endpoints used by js/sync.js.
export function mockSupabase({ failPush = false } = {}) {
  const rows = new Map(); let rev = 0; const state = { failPush, calls: 0, down: false };
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
  const fetchFn = async (url, opts = {}) => {
    state.calls++;
    if (state.down) throw new Error('network down');
    const u = new URL(url), method = (opts.method || 'GET').toUpperCase();
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse(opts.body);
      if (u.searchParams.get('grant_type') === 'password' && b.password !== 'secret') return json({}, 400);
      return json({ access_token: 'tok', refresh_token: 'ref', user: { id: 'owner-1' } });
    }
    if (u.pathname === '/rest/v1/sync_records') {
      if (opts.headers.Authorization !== 'Bearer tok') return json({}, 401);
      if (method === 'POST') {
        if (state.failPush) return json({ message: 'boom' }, 500);
        for (const r of JSON.parse(opts.body)) rows.set(`${r.owner_id}|${r.col}|${r.rid}`, { ...r, rev: ++rev });
        return json(null, 201);
      }
      const q = u.searchParams, gt = Number((q.get('rev') || 'gt.0').slice(3)), neq = (q.get('device') || '').slice(4);
      const out = [...rows.values()].filter((r) => r.rev > gt && r.device !== neq).sort((a, b) => a.rev - b.rev).slice(0, Number(q.get('limit') || 1000))
        .map((r) => ({ col: r.col, rid: r.rid, payload: r.payload, rev: r.rev }));
      return json(out);
    }
    return json({}, 404);
  };
  return { fetchFn, rows, state };
}
