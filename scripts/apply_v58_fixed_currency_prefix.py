from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V58: componente não encontrado: {label}')
    return start, end


start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)
leads = text[start:end]

# Adiciona um prefixo visual fixo "R$" sem alterar o valor armazenado no input.
# Assim o parser e a persistência monetária da V57 continuam intactos.
fields = [
    (
        '''                                <input\n                                  type="text"\n                                  inputMode="decimal"\n                                  value={l.proposal_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'proposal_value', e.target.value)}\n                                  onBlur={e => updateDraftField(l.id, 'proposal_value', formatMoneyField(e.target.value))}\n                                  placeholder="0,00"\n                                />''',
        '''                                <div className="money-input-wrap-v58">\n                                  <span className="money-prefix-v58">R$</span>\n                                  <input\n                                    type="text"\n                                    inputMode="decimal"\n                                    value={l.proposal_value ?? ''}\n                                    onChange={e => updateDraftField(l.id, 'proposal_value', e.target.value)}\n                                    onBlur={e => updateDraftField(l.id, 'proposal_value', formatMoneyField(e.target.value))}\n                                    placeholder="0,00"\n                                  />\n                                </div>''',
        'Valor da proposta'
    ),
    (
        '''                                <input\n                                  type="text"\n                                  inputMode="decimal"\n                                  value={l.renegotiated_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'renegotiated_value', e.target.value)}\n                                  onBlur={e => updateDraftField(l.id, 'renegotiated_value', formatMoneyField(e.target.value))}\n                                  placeholder="0,00"\n                                />''',
        '''                                <div className="money-input-wrap-v58">\n                                  <span className="money-prefix-v58">R$</span>\n                                  <input\n                                    type="text"\n                                    inputMode="decimal"\n                                    value={l.renegotiated_value ?? ''}\n                                    onChange={e => updateDraftField(l.id, 'renegotiated_value', e.target.value)}\n                                    onBlur={e => updateDraftField(l.id, 'renegotiated_value', formatMoneyField(e.target.value))}\n                                    placeholder="0,00"\n                                  />\n                                </div>''',
        'Valor renegociado'
    ),
    (
        '''                                <input\n                                  type="text"\n                                  inputMode="decimal"\n                                  value={l.contract_value ?? ''}\n                                  onChange={e => updateDraftField(l.id, 'contract_value', e.target.value)}\n                                  onBlur={e => updateDraftField(l.id, 'contract_value', formatMoneyField(e.target.value))}\n                                  placeholder="0,00"\n                                />''',
        '''                                <div className="money-input-wrap-v58">\n                                  <span className="money-prefix-v58">R$</span>\n                                  <input\n                                    type="text"\n                                    inputMode="decimal"\n                                    value={l.contract_value ?? ''}\n                                    onChange={e => updateDraftField(l.id, 'contract_value', e.target.value)}\n                                    onBlur={e => updateDraftField(l.id, 'contract_value', formatMoneyField(e.target.value))}\n                                    placeholder="0,00"\n                                  />\n                                </div>''',
        'Valor do contrato'
    ),
]

for old, new, label in fields:
    if old not in leads:
        raise SystemExit(f'V58: campo não encontrado: {label}')
    leads = leads.replace(old, new, 1)

old_readonly = '''                                  <input type="text" value={formatMoneyField(l.proposal_value)} readOnly className="readonly-field-v54" />'''
new_readonly = '''                                  <div className="money-input-wrap-v58 readonly-money-v58">\n                                    <span className="money-prefix-v58">R$</span>\n                                    <input type="text" value={formatMoneyField(l.proposal_value)} readOnly className="readonly-field-v54" />\n                                  </div>'''
if old_readonly not in leads:
    raise SystemExit('V58: valor fixo da proposta em Negociação não encontrado.')
leads = leads.replace(old_readonly, new_readonly, 1)

text = text[:start] + leads + text[end:]

css += r'''

/* V58 - prefixo monetário fixo nos campos do funil */
.money-input-wrap-v58 {
  position: relative;
  width: 100%;
}
.money-input-wrap-v58 .money-prefix-v58 {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  color: #64748b;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}
.money-input-wrap-v58 input {
  padding-left: 38px !important;
}
.readonly-money-v58 .money-prefix-v58 {
  color: #64748b;
}
'''

# Validação restrita: garante o prefixo sem mexer nas regras de persistência.
start, end = bounds(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads final'
)
check = text[start:end]
checks = [
    ('quatro prefixos R$ adicionados', check.count('className="money-prefix-v58">R$</span>') == 4),
    ('proposta continua formatada', "updateDraftField(l.id, 'proposal_value'" in check and 'formatMoneyField(e.target.value)' in check),
    ('renegociação continua formatada', "updateDraftField(l.id, 'renegotiated_value'" in check),
    ('contrato continua formatado', "updateDraftField(l.id, 'contract_value'" in check),
    ('proposta fixa continua readonly', 'readOnly className="readonly-field-v54"' in check),
    ('proteção de rascunhos preservada', 'dirtyLeadFieldsRef' in check and 'persistDraftBeforeStatusChange' in check),
    ('histórico preservado', "from('lead_journey_entries')" in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V58 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V58 aplicada: prefixo R$ fixo nos campos monetários, mantendo formato e persistência da V57.')
