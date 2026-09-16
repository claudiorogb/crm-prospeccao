"""V93: maintain deterministic stage-arrival ordering without changing business flows."""
from pathlib import Path

path = Path('src/App.jsx')
source = path.read_text(encoding='utf-8')


def replace_once(before, after):
    global source
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f'V93: expected exactly one anchor, found {count}: {before[:100]!r}')
    source = source.replace(before, after, 1)


replace_once(
    "import { mergeLeadsWithLocalDrafts } from './kanban-draft-merge.js'\n",
    "import { mergeLeadsWithLocalDrafts } from './kanban-draft-merge.js'\nimport { sortKanbanColumn } from './kanban-order.js'\n",
)

# Keep the timestamp returned by the database trigger, not the browser clock.
replace_once(
    """    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', id)
      .eq('organization_id', organization.id)

    if (error) {
      setMessage(error.message)
      return
    }

    const localPayload = { ...payload }
""",
    """    const { data: stageChange, error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', id)
      .eq('organization_id', organization.id)
      .select('status_changed_at')
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    const localPayload = { ...payload, status_changed_at: stageChange.status_changed_at }
""",
)

# The recovery path also changes the phase and must preserve the same rule.
replace_once(
    """    const { error } = await supabase
      .from('leads')
      .update({ status: fallback, lost_from_status: null, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('organization_id', organization.id)

    if (error) setMessage(error.message)
    else {
      setLeads(old => old.map(item => item.id === lead.id ? { ...item, status: fallback, lost_from_status: null } : item))
""",
    """    const { data: stageChange, error } = await supabase
      .from('leads')
      .update({ status: fallback, lost_from_status: null, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('organization_id', organization.id)
      .select('status_changed_at')
      .single()

    if (error) setMessage(error.message)
    else {
      setLeads(old => old.map(item => item.id === lead.id ? { ...item, status: fallback, lost_from_status: null, status_changed_at: stageChange.status_changed_at } : item))
""",
)

replace_once(
    '              const columnLeads = visibleLeads.filter(l => l.status === status)\n',
    '              const columnLeads = sortKanbanColumn(visibleLeads.filter(l => l.status === status))\n',
)

path.write_text(source, encoding='utf-8')
print('V93: four guarded Kanban integration changes applied.')
