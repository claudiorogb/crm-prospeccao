from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V59: componente não encontrado: {label}')
    return start, end


start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)
leads = text[start:end]

# Ao avançar de Negociação para Ganho, o último valor negociado passa a ser
# o valor inicial do contrato. O campo continua editável na etapa Ganho.
# Se não houver valor renegociado, usamos o valor original da proposta como fallback.
payload_marker = "    const payload = { status, updated_at: new Date().toISOString() }\n"
if payload_marker not in leads:
    raise SystemExit('V59: payload da troca de status não encontrado.')

carry_block = """    const payload = { status, updated_at: new Date().toISOString() }\n\n    if (currentStatus === 'negotiation' && status === 'won') {\n      const negotiatedValue = parseMoneyValue(currentLead.renegotiated_value)\n      const proposalValue = parseMoneyValue(currentLead.proposal_value)\n      const initialContractValue = negotiatedValue !== null ? negotiatedValue : proposalValue\n      if (initialContractValue !== null) payload.contract_value = initialContractValue\n    }\n"""
leads = leads.replace(payload_marker, carry_block, 1)

# O banco recebe número; a interface mantém a mesma máscara brasileira imediatamente,
# sem esperar o próximo refresh automático.
old_local_update = "    setLeads(old => old.map(item => item.id === id ? { ...item, ...payload } : item))\n    setMessage('')\n"
new_local_update = """    const localPayload = { ...payload }\n    if (Object.prototype.hasOwnProperty.call(localPayload, 'contract_value')) {\n      localPayload.contract_value = formatMoneyField(localPayload.contract_value)\n    }\n\n    setLeads(old => old.map(item => item.id === id ? { ...item, ...localPayload } : item))\n    setMessage('')\n"""
if old_local_update not in leads:
    raise SystemExit('V59: atualização local após troca de status não encontrada.')
leads = leads.replace(old_local_update, new_local_update, 1)

text = text[:start] + leads + text[end:]

# Validação: alteração pontual, sem tocar nas demais regras do funil.
start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads final'
)
check = text[start:end]
checks = [
    ('Negociação -> Ganho copia último valor', "currentStatus === 'negotiation' && status === 'won'" in check),
    ('prioriza renegociado', 'negotiatedValue !== null ? negotiatedValue : proposalValue' in check),
    ('contrato continua editável', "updateDraftField(l.id, 'contract_value'" in check),
    ('valor local mantém formato brasileiro', "localPayload.contract_value = formatMoneyField(localPayload.contract_value)" in check),
    ('progressão controlada preservada', "negotiation: ['negotiation', 'won', 'lost']" in check),
    ('histórico preservado', "from('lead_journey_entries')" in check),
    ('proteção de rascunhos preservada', 'persistDraftBeforeStatusChange(currentLead)' in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V59 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V59 aplicada: Negociação -> Ganho leva o último valor negociado para Valor do contrato, mantendo o campo editável.')
