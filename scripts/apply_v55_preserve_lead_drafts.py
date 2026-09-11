from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V55: componente não encontrado: {label}')
    return start, end


start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)
leads = text[start:end]

# 1) Mantém um mapa de campos locais alterados. O polling de 10 segundos não pode
# sobrescrever valores que o usuário ainda está editando antes de clicar Salvar.
state_marker = "  const [savingLeadIds, setSavingLeadIds] = useState(new Set())\n"
if state_marker not in leads:
    raise SystemExit('V55: estado savingLeadIds não encontrado.')
leads = leads.replace(
    state_marker,
    state_marker + "  const dirtyLeadFieldsRef = useRef({})\n",
    1
)

old_load = """    const payload = data || {}\n    setLeads(Array.isArray(payload.rows) ? payload.rows : [])\n    setTotalLeads(Number(payload.total || 0))"""
new_load = """    const payload = data || {}\n    const incomingRows = Array.isArray(payload.rows) ? payload.rows : []\n    setLeads(current => incomingRows.map(row => {\n      const local = current.find(item => item.id === row.id)\n      const dirty = dirtyLeadFieldsRef.current[row.id]\n      if (!local || !dirty) return row\n\n      const merged = { ...row }\n      Object.keys(dirty).forEach(field => {\n        merged[field] = local[field]\n      })\n      return merged\n    }))\n    setTotalLeads(Number(payload.total || 0))"""
if old_load not in leads:
    raise SystemExit('V55: atualização paginada dos leads não encontrada.')
leads = leads.replace(old_load, new_load, 1)

# 2) Helpers de edição. Campos alterados ficam protegidos contra o refresh e são
# persistidos antes de qualquer troca de status, sem criar histórico duplicado.
status_marker = '  async function updateStatus(id, status) {'
if status_marker not in leads:
    raise SystemExit('V55: updateStatus não encontrado.')
helpers = r'''  function updateDraftField(id, field, value) {
    dirtyLeadFieldsRef.current = {
      ...dirtyLeadFieldsRef.current,
      [id]: {
        ...(dirtyLeadFieldsRef.current[id] || {}),
        [field]: true
      }
    }

    setLeads(old => old.map(item => item.id === id ? { ...item, [field]: value } : item))
  }

  function clearDirtyFields(id) {
    if (!dirtyLeadFieldsRef.current[id]) return
    const next = { ...dirtyLeadFieldsRef.current }
    delete next[id]
    dirtyLeadFieldsRef.current = next
  }

  async function persistDraftBeforeStatusChange(lead) {
    const dirty = dirtyLeadFieldsRef.current[lead.id]
    if (!dirty || !Object.keys(dirty).length) return true

    const numericFields = new Set(['proposal_value', 'renegotiated_value', 'contract_value'])
    const payload = {}

    Object.keys(dirty).forEach(field => {
      let value = lead[field]
      if (numericFields.has(field)) {
        if (value === '' || value === null || value === undefined) value = null
        else {
          const parsed = Number(String(value).replace(',', '.'))
          value = Number.isFinite(parsed) ? parsed : null
        }
      } else if (typeof value === 'string') {
        value = value.trim() || null
      }
      payload[field] = value
    })

    payload.updated_at = new Date().toISOString()

    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', lead.id)
      .eq('organization_id', organization.id)

    if (error) {
      setMessage(`Não foi possível preservar os dados antes de mudar a etapa: ${error.message}`)
      return false
    }

    clearDirtyFields(lead.id)
    return true
  }

'''
leads = leads.replace(status_marker, helpers + status_marker, 1)

# 3) Antes de efetivar a nova etapa, grava todos os campos locais do card atual.
payload_marker = "    const payload = { status, updated_at: new Date().toISOString() }\n"
if payload_marker not in leads:
    raise SystemExit('V55: payload de status não encontrado.')
leads = leads.replace(
    payload_marker,
    "    const draftPreserved = await persistDraftBeforeStatusChange(currentLead)\n    if (!draftPreserved) return\n\n" + payload_marker,
    1
)

# 4) O botão Salvar continua sendo o responsável por gerar o registro datado do
# histórico. Depois que o banco recebeu os campos, eles deixam de ser considerados
# rascunho e o polling pode voltar a usar a versão do servidor.
checkpoint_marker = """    if (updateError) {\n      setMessage(`Não foi possível salvar: ${updateError.message}`)\n      setSavingLeadIds(old => {\n        const next = new Set(old)\n        next.delete(lead.id)\n        return next\n      })\n      return\n    }\n\n    const note = (noteDrafts[lead.id] || '').trim()"""
checkpoint_replacement = """    if (updateError) {\n      setMessage(`Não foi possível salvar: ${updateError.message}`)\n      setSavingLeadIds(old => {\n        const next = new Set(old)\n        next.delete(lead.id)\n        return next\n      })\n      return\n    }\n\n    clearDirtyFields(lead.id)\n\n    const note = (noteDrafts[lead.id] || '').trim()"""
if checkpoint_marker not in leads:
    raise SystemExit('V55: checkpoint de salvamento não encontrado.')
leads = leads.replace(checkpoint_marker, checkpoint_replacement, 1)

# 5) Todos os campos editáveis do novo funil usam o helper de rascunho.
replacements = [
    (
        "onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, contact_name: e.target.value } : item))}",
        "onChange={e => updateDraftField(l.id, 'contact_name', e.target.value)}",
        'nome do contato'
    ),
    (
        "onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, proposal_value: e.target.value } : item))}",
        "onChange={e => updateDraftField(l.id, 'proposal_value', e.target.value)}",
        'valor da proposta'
    ),
    (
        "onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, proposal_sent_at: e.target.value } : item))}",
        "onChange={e => updateDraftField(l.id, 'proposal_sent_at', e.target.value)}",
        'data da proposta'
    ),
    (
        "onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, renegotiated_value: e.target.value } : item))}",
        "onChange={e => updateDraftField(l.id, 'renegotiated_value', e.target.value)}",
        'valor renegociado'
    ),
    (
        "onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, contract_value: e.target.value } : item))}",
        "onChange={e => updateDraftField(l.id, 'contract_value', e.target.value)}",
        'valor do contrato'
    ),
    (
        "onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, contract_signed_at: e.target.value } : item))}",
        "onChange={e => updateDraftField(l.id, 'contract_signed_at', e.target.value)}",
        'data do contrato'
    ),
    (
        "onChange={e => setLeads(old => old.map(item => item.id === l.id ? { ...item, next_contact_date: e.target.value } : item))}",
        "onChange={e => updateDraftField(l.id, 'next_contact_date', e.target.value)}",
        'próximo contato'
    ),
]
for old, new, label in replacements:
    if old not in leads:
        raise SystemExit(f'V55: campo não encontrado para proteção: {label}')
    leads = leads.replace(old, new, 1)

text = text[:start] + leads + text[end:]

# Validações fortes para evitar publicar parcialmente.
start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads final'
)
check = text[start:end]
checks = [
    ('rascunhos protegidos do polling', 'dirtyLeadFieldsRef' in check and 'incomingRows.map(row =>' in check),
    ('nome protegido', "updateDraftField(l.id, 'contact_name'" in check),
    ('proposta protegida', "updateDraftField(l.id, 'proposal_value'" in check and "updateDraftField(l.id, 'proposal_sent_at'" in check),
    ('negociação protegida', "updateDraftField(l.id, 'renegotiated_value'" in check),
    ('contrato protegido', "updateDraftField(l.id, 'contract_value'" in check and "updateDraftField(l.id, 'contract_signed_at'" in check),
    ('próximo contato protegido', "updateDraftField(l.id, 'next_contact_date'" in check),
    ('migração de etapa preserva campos', 'persistDraftBeforeStatusChange(currentLead)' in check),
    ('Salvar limpa rascunho após persistência', 'clearDirtyFields(lead.id)' in check),
    ('histórico V54 preservado', "from('lead_journey_entries')" in check),
    ('Negociação preservada', "negotiation: 'Negociação'" in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V55 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V55 aplicada: campos editados não somem no polling e são preservados ao mudar de etapa.')
