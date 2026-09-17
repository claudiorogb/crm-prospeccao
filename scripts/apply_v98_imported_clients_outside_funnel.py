"""Apply only the imported-customer visibility correction to the CRM interface.

Fail closed if the current source differs; no schema, tenant, or import changes.
"""
from pathlib import Path

path = Path('src/App.jsx')
original = path.read_text(encoding='utf-8')
start = original.index('  async function loadTerminalPreview(')
end = original.index('  async function loadAllLeads(', start)
section = original[start:end]
old = "    if (currentFilter.segment !== 'all') query = query.eq('target_segment_id', currentFilter.segment)"
new = "    // Imported customers are in the customer portfolio, not sales-funnel wins.\n    if (status === 'won') query = query.neq('source', 'import')\n\n" + old
if section.count(old) != 1 or "query.neq('source', 'import')" in section:
    raise SystemExit('V98 aborted: terminal Kanban query changed or already patched.')
updated = original[:start] + section.replace(old, new, 1) + original[end:]
old_header = '<p className="muted">Leads marcados como Ganho aparecem aqui automaticamente.</p>'
new_header = '<p className="muted">Clientes conquistados no funil ou adicionados por importação aparecem aqui.</p>'
if updated.count(old_header) != 1:
    raise SystemExit('V98 aborted: customers header changed. No file modified.')
updated = updated.replace(old_header, new_header, 1)
path.write_text(updated, encoding='utf-8')
print('V98 interface: Kanban excludes imported wins; Clientes preserves imported and converted customers.')
