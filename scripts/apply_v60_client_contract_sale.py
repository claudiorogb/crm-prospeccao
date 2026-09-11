from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def bounds(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V60: componente não encontrado: {label}')
    return start, end


start, end = bounds(
    'function Clients({ organization, userEmail, userId }) {',
    'function Messages({ organization, userEmail }) {',
    'Clientes'
)
clients = text[start:end]

# Helpers monetários locais da tela Clientes. Mantêm o valor do banco numérico,
# mas exibem/aceitam o padrão brasileiro 0,00 / 10.000,00 no formulário de venda.
sale_state = """  const [saleForm, setSaleForm] = useState({
    id: null,
    sale_date: currentBrazilDate(),
    amount: '',
    product_service: '',
    notes: ''
  })
"""
helpers = sale_state + r'''
  function parseClientMoney(value) {
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

  function formatClientMoney(value) {
    const parsed = parseClientMoney(value)
    if (parsed === null) return ''
    return parsed.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }
'''
if sale_state not in clients:
    raise SystemExit('V60: estado saleForm não encontrado.')
clients = clients.replace(sale_state, helpers, 1)

# Editar venda já abre com a máscara brasileira.
old_edit_amount = "      amount: String(sale.amount || ''),\n"
new_edit_amount = "      amount: formatClientMoney(sale.amount),\n"
if old_edit_amount not in clients:
    raise SystemExit('V60: valor de edição da venda não encontrado.')
clients = clients.replace(old_edit_amount, new_edit_amount, 1)

# Salvar venda entende corretamente 10.000,00.
old_parser = "    const amount = Number(String(saleForm.amount).replace(',', '.'))\n"
new_parser = "    const amount = parseClientMoney(saleForm.amount)\n"
if old_parser not in clients:
    raise SystemExit('V60: parser atual da venda não encontrado.')
clients = clients.replace(old_parser, new_parser, 1)

# Campo Registrar venda recebe R$ fixo e formatação brasileira, sem alterar a
# lógica cumulativa do histórico de vendas.
old_input = '''                <label>Valor (R$)<input type="number" min="0.01" step="0.01" value={saleForm.amount} onChange={e => setSaleForm({...saleForm,amount:e.target.value})} required /></label>'''
new_input = '''                <label>Valor
                  <div className="money-input-wrap-v58">
                    <span className="money-prefix-v58">R$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={saleForm.amount}
                      onChange={e => setSaleForm({...saleForm,amount:e.target.value})}
                      onBlur={e => setSaleForm(old => ({...old, amount: formatClientMoney(e.target.value)}))}
                      placeholder="0,00"
                      required
                    />
                  </div>
                </label>'''
if old_input not in clients:
    raise SystemExit('V60: campo Valor de Registrar venda não encontrado.')
clients = clients.replace(old_input, new_input, 1)

text = text[:start] + clients + text[end:]

# Validação restrita: mantém Clientes, histórico e vendas manuais existentes.
start, end = bounds(
    'function Clients({ organization, userEmail, userId }) {',
    'function Messages({ organization, userEmail }) {',
    'Clientes final'
)
check = text[start:end]
checks = [
    ('parser monetário brasileiro', 'function parseClientMoney(value)' in check),
    ('formatador monetário brasileiro', "toLocaleString('pt-BR'" in check),
    ('editar venda formatado', 'amount: formatClientMoney(sale.amount)' in check),
    ('salvar venda parseado', 'const amount = parseClientMoney(saleForm.amount)' in check),
    ('R$ fixo em Registrar venda', 'className="money-prefix-v58">R$</span>' in check),
    ('histórico cumulativo preservado', ".from('sales').insert({" in check),
    ('edição de venda preservada', ".from('sales')\n        .update(payload)" in check),
    ('histórico visual preservado', 'className="sales-history"' in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V60 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V60 aplicada: contrato fechado sincronizado no histórico pelo banco e Registrar venda usa R$ 0,00.')
