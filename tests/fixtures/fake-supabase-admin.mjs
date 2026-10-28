// Cliente Supabase falso em memória (só o necessário para enqueue_whatsapp_messages).
export const db = globalThis.__fakeDb
function builder(table) {
  const filters = []
  let op = 'select', payload = null, single = null, orders = [], returning = false
  const b = {
    select() { if (op !== 'select') returning = true; return b },
    eq(c, v) { filters.push(r => r[c] === v); return b },
    in(c, v) { filters.push(r => v.includes(r[c])); return b },
    is(c, v) { filters.push(r => (v === null ? r[c] == null : r[c] === v)); return b },
    gte(c, v) { filters.push(r => String(r[c]) >= String(v)); return b },
    order(c, o = {}) { orders.push([c, o.ascending !== false]); return b },
    limit() { return b },
    maybeSingle() { single = 'maybe'; return b },
    single() { single = 'one'; return b },
    insert(rows) { op = 'insert'; payload = rows; return b },
    update(p) { op = 'update'; payload = p; return b },
    then(res, rej) { return Promise.resolve(run()).then(res, rej) }
  }
  function run() {
    const rows = (db[table] ||= [])
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: r.id || `${table}-${rows.length + 1}`, ...r }))
      rows.push(...list)
      return single ? { data: list[0], error: null } : { data: list, error: null }
    }
    let out = rows.filter(r => filters.every(f => f(r)))
    if (op === 'update') { out.forEach(r => Object.assign(r, payload)); return { data: null, error: null } }
    for (const [c, asc] of [...orders].reverse()) out = [...out].sort((a, b) => (a[c] === b[c] ? 0 : (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)))
    if (single === 'maybe') return { data: out[0] || null, error: null }
    if (single === 'one') return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'not found' } }
    return { data: out, error: null }
  }
  return b
}
export function createClient() {
  return { from: builder, auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) } }
}
