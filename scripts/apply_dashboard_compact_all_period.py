"""Apply two narrowly scoped changes to the shared AXIVA dashboard.

Run on a clean checkout of the verified baseline. Abort if any expected snippet changed.
No database changes, secrets, or organization/role logic are touched.
"""
from pathlib import Path

DASHBOARD = Path('src/dashboard-visual.jsx')
STYLE = Path('src/dashboard-visual.css')
source = DASHBOARD.read_text(encoding='utf-8')
css = STYLE.read_text(encoding='utf-8')


def change(old, new, count=1):
    global source
    actual = source.count(old)
    if actual != count:
        raise RuntimeError(f'Expected {count} match(es), found {actual}: {old[:110]}')
    source = source.replace(old, new)


change("  if (period === 'today') return [now, now]", "  if (period === 'all') return [null, null]\n  if (period === 'today') return [now, now]")
change("    if (!start || !end || start > end) {", "    if (period !== 'all' && (!start || !end || start > end)) {")
change("        const startTime = `${start}T00:00:00-03:00`\n        const endTime = `${shiftDay(end, 1)}T00:00:00-03:00`", "        const startTime = start ? `${start}T00:00:00-03:00` : null\n        const endTime = end ? `${shiftDay(end, 1)}T00:00:00-03:00` : null\n        const createdAtRange = query => startTime && endTime ? query.gte('created_at', startTime).lt('created_at', endTime) : query\n        const saleDateRange = query => start && end ? query.gte('sale_date', start).lte('sale_date', end) : query")
change("allRows(() => supabase.from('leads').select('id,business_name", "allRows(() => createdAtRange(supabase.from('leads').select('id,business_name")
change("allRows(() => supabase.from('sales').select('id,amount,sale_date')", "allRows(() => saleDateRange(supabase.from('sales').select('id,amount,sale_date')")
change("allRows(() => supabase.from('outbound_messages').select('id,status,created_at')", "allRows(() => createdAtRange(supabase.from('outbound_messages').select('id,status,created_at')")
change(".gte('created_at', startTime).lt('created_at', endTime).order('created_at', { ascending: false })", ").order('created_at', { ascending: false })", count=2)
change(".gte('sale_date', start).lte('sale_date', end).order('sale_date', { ascending: false })", ").order('sale_date', { ascending: false })")
change("  }, [organization?.id, start, end, refresh, weeklyRange])", "  }, [organization?.id, period, start, end, refresh, weeklyRange])")
change('<option value="year">Este ano</option><option value="custom">', '<option value="year">Este ano</option><option value="all">Todo o período</option><option value="custom">')
change('{displayDate(start)} a {displayDate(end)}', "{period === 'all' ? 'Todo o período' : `${displayDate(start)} a ${displayDate(end)}`}")

compact_style = '''
/* Compact metric cards for the shared admin test and customer dashboards. */
.axd-root .axd-metric{min-height:0;padding:11px 13px;gap:10px;align-items:center}
.axd-root .axd-metric-body{gap:4px}
@media(max-width:540px){.axd-root .axd-metric{padding:10px;gap:7px;align-items:flex-start}}
'''
if 'Compact metric cards for the shared admin test' in css:
    raise RuntimeError('Compact dashboard stylesheet is already applied')

# Safety: organization filters and the shared component must remain present.
assert source.count(".eq('organization_id', organization.id)") >= 5
assert "supabase.from('leads')" in source and "supabase.from('sales')" in source
assert "period === 'all'" in source and "[null, null]" in source
assert "const createdAtRange = query => startTime && endTime" in source
assert "const saleDateRange = query => start && end" in source
assert "service_role" not in source and '.insert(' not in source and '.update(' not in source
DASHBOARD.write_text(source, encoding='utf-8')
STYLE.write_text(css.rstrip() + '\n' + compact_style, encoding='utf-8')
print('Dashboard compacted; Todo o período skips date filters for leads, sales and messages.')
