// Arquivo baixado do Leads Brasil → cadastro do CRM.
// O download do Leads Brasil NÃO muda: o CRM é que reconhece as colunas dele e leva só o essencial
// para prospecção: empresa, responsável (decisor + cargo), e-mail, telefone, endereço (+ cidade/UF) e CNPJ.
// Todo o resto (nota, sócios, capital, atividade, links, site, WhatsApp...) é ignorado.

export const LEADS_BRASIL_ORIGIN = 'Leads Brasil'

function canon(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function pick(row, names) {
  const entries = Object.entries(row || {})
  for (const name of names) {
    const wanted = canon(name)
    const found = entries.find(([key]) => canon(key) === wanted)
    if (found && String(found[1] ?? '').trim()) return found[1]
  }
  return ''
}

// Colunas que só existem no arquivo do Leads Brasil (planilha comum de cliente não tem todas elas).
const MARCAS = ['nota', 'decisor', 'cnpj', 'atividade principal', 'matriz/filial']

export function isLeadsBrasilRow(row) {
  const keys = new Set(Object.keys(row || {}).map(canon))
  return MARCAS.every(marca => keys.has(marca))
}

const text = value => String(value ?? '').trim()
const isLink = value => /^https?:\/\//i.test(text(value))

// No CSV as colunas com link trazem o endereço do link em vez do texto: nesse caso o nome vem dos sócios.
function responsavel(row) {
  const decisor = text(pick(row, ['Decisor']))
  if (decisor && !isLink(decisor)) return decisor
  const primeiro = text(pick(row, ['Sócios / administradores'])).split(';')[0] || ''
  return primeiro.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function telefone(row) {
  const valor = text(pick(row, ['Telefone 1', 'Telefone 2']))
  return isLink(valor) ? '' : valor.replace(/\D/g, '')
}

function endereco(row) {
  const partes = [pick(row, ['Endereço', 'Endereco']), pick(row, ['Bairro']), pick(row, ['CEP'])]
    .map(text).filter(Boolean)
  return partes.join(', ')
}

export function normalizeLeadsBrasilRow(row) {
  const empresa = text(pick(row, ['Empresa', 'Nome fantasia', 'Razão social']))
  const cnpj = text(pick(row, ['CNPJ'])).replace(/\D/g, '')
  const email = text(pick(row, ['E-mail', 'Email'])).toLowerCase()
  return {
    business_name: empresa,
    legal_name: text(pick(row, ['Razão social', 'Razao social'])),
    tax_id: cnpj,
    segment: '',
    contact_name: responsavel(row),
    contact_role: isLink(pick(row, ['Cargo'])) ? '' : text(pick(row, ['Cargo'])),
    phone: telefone(row),
    whatsapp_phone: '',
    email: email.includes('@') ? email : '',
    address: endereco(row),
    city: text(pick(row, ['Cidade'])),
    state: text(pick(row, ['UF'])).toUpperCase(),
    website: '',
    customer_origin: LEADS_BRASIL_ORIGIN,
    next_contact_date: '',
    commercial_notes: '',
    customer_key: cnpj ? `tax:${cnpj}` : (empresa ? `name:${canon(empresa)}` : '')
  }
}
