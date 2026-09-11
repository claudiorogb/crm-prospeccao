from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V57: componente não encontrado: {label}')
    return start, end


start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)
leads = text[start:end]

# Helpers localizados somente no componente Leads para não alterar outras telas.
helper_marker = "  const dirtyLeadFieldsRef = useRef({})\n"
helpers = r'''  const dirtyLeadFieldsRef = useRef({})

  function parseMoneyValue(value) {
    if (value === '' || value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null

    let normalized = String(value)
      .trim()
      .replace(/R\$/g, '')
      .replace(/\s/g, '')

    if (!normalized) return null

    if (normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '')
    }

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  function formatMoneyField(value) {
    const parsed = parseMoneyValue(value)
    if (parsed === null) return ''
    return parsed.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }
'''
if helper_marker not in leads:
    raise SystemExit('V57: estado dirtyLeadFieldsRef não encontrado.')
leads = leads.replace(helper_marker, helpers, 1)

# Valores vindos do banco já entram na tela no padrão brasileiro (ex.: 10.000,00).
old_rows = "    const incomingRows = Array.isArray(payload.rows) ? payload.rows : []\n"
new_rows = """    const incomingRows = (Array.isArray(payload.rows) ? payload.rows : []).map(row => ({\n      ...row,\n      proposal_value: formatMoneyField(row.proposal_value),\n      renegotiated_value: formatMoneyField(row.renegotiated_value),\n      contract_value: formatMoneyField(row.contract_value)\n    }))\n"""
if old_rows not in leads:
    raise SystemExit('V57: carregamento paginado dos valores não encontrado.')
leads = leads.replace(old_rows, new_rows, 1)

# Os dois pontos que convertem valores para número passam a aceitar 10.000,00.
old_parser = "const parsed = Number(String(value).replace(',', '.'))"
parser_count = leads.count(old_parser)
if parser_count < 2:
    raise SystemExit(f'V57: esperava 2 conversores monetários e encontrou {parser_count}.')
leads = leads.replace(old_parser, "const parsed = parseMoneyValue(value)")

# Corrige a validação subsequente, pois parseMoneyValue pode retornar null.
leads = leads.replace(
    "return Number.isFinite(parsed) ? parsed : null",
    "return parsed !== null && Number.isFinite(parsed) ? parsed : null",
    2
)

# Campos monetários editáveis: deixam de ser input number e recebem formatação ao sair do campo.
field_changes = [
    (
        '''                                <input\n                                  type="number"\n                                  min="0"\n                                  step="0.01"\n                                  value={l.proposal_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'proposal_value', e.target.value)}\n                                  placeholder="R$ 0,00"\n                                />''',
        '''                                <input\n                                  type="text"\n                                  inputMode="decimal"\n                                  value={l.proposal_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'proposal_value', e.target.value)}\n                                  onBlur={e => updateDraftField(l.id, 'proposal_value', formatMoneyField(e.target.value))}\n                                  placeholder="0,00"\n                                />''',
        'Valor da proposta'
    ),
    (
        '''                                <input\n                                  type="number"\n                                  min="0"\n                                  step="0.01"\n                                  value={l.renegotiated_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'renegotiated_value', e.target.value)}\n                                  placeholder="R$ 0,00"\n                                />''',
        '''                                <input\n                                  type="text"\n                                  inputMode="decimal"\n                                  value={l.renegotiated_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'renegotiated_value', e.target.value)}\n                                  onBlur={e => updateDraftField(l.id, 'renegotiated_value', formatMoneyField(e.target.value))}\n                                  placeholder="0,00"\n                                />''',
        'Valor renegociado'
    ),
    (
        '''                                <input\n                                  type="number"\n                                  min="0"\n                                  step="0.01"\n                                  value={l.contract_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'contract_value', e.target.value)}\n                                  placeholder="R$ 0,00"\n                                />''',
        '''                                <input\n                                  type="text"\n                                  inputMode="decimal"\n                                  value={l.contract_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'contract_value', e.target.value)}\n                                  onBlur={e => updateDraftField(l.id, 'contract_value', formatMoneyField(e.target.value))}\n                                  placeholder="0,00"\n                                />''',
        'Valor do contrato'
    ),
]

for old, new, label in field_changes:
    if old not in leads:
        raise SystemExit(f'V57: campo não encontrado: {label}')
    leads = leads.replace(old, new, 1)

# Campo fixo da proposta na Negociação também deve aparecer formatado.
old_readonly = '''                                  <input type="number" value={l.proposal_value ?? ''} readOnly className="readonly-field-v54" />'''
new_readonly = '''                                  <input type="text" value={formatMoneyField(l.proposal_value)} readOnly className="readonly-field-v54" />'''
if old_readonly not in leads:
    raise SystemExit('V57: valor fixo da proposta em Negociação não encontrado.')
leads = leads.replace(old_readonly, new_readonly, 1)

text = text[:start] + leads + text[end:]

# Validação forte para não alterar nenhuma outra funcionalidade.
start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads final'
)
check = text[start:end]
checks = [
    ('helper pt-BR criado', 'function formatMoneyField(value)' in check and 'toLocaleString(\'pt-BR\'' in check),
    ('parser aceita formato brasileiro', "normalized.replace(/\\./g, '').replace(',', '.')" in check),
    ('proposta formatada', "onBlur={e => updateDraftField(l.id, 'proposal_value', formatMoneyField(e.target.value))}" in check),
    ('renegociado formatado', "onBlur={e => updateDraftField(l.id, 'renegotiated_value', formatMoneyField(e.target.value))}" in check),
    ('contrato formatado', "onBlur={e => updateDraftField(l.id, 'contract_value', formatMoneyField(e.target.value))}" in check),
    ('valor fixo preservado', 'value={formatMoneyField(l.proposal_value)} readOnly' in check),
    ('proteção V55 preservada', 'dirtyLeadFieldsRef' in check and 'persistDraftBeforeStatusChange' in check),
    ('histórico V54 preservado', "from('lead_journey_entries')" in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V57 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V57 aplicada: campos monetários do funil usam formato brasileiro 0,00 / 10.000,00.')
