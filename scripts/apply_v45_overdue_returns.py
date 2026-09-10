from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f'Marcador não encontrado: {label}')
    text = text.replace(old, new, 1)

# Ícone de calendário para o contador no menu.
replace_once(
    '  Save, ChevronDown, Menu, X\n',
    '  Save, ChevronDown, Menu, X, CalendarDays\n',
    'import CalendarDays'
)

# Ao abrir um lead a partir de Retornos atrasados, o funil abre filtrado naquele lead.
old_filter = "  const [filter, setFilter] = useState({ search: '', segment: 'all', status: 'all' })\n"
new_filter = """  const [filter, setFilter] = useState(() => {
    try {
      const stored = sessionStorage.getItem('crm_focus_lead')
      if (stored) {
        sessionStorage.removeItem('crm_focus_lead')
        const lead = JSON.parse(stored)
        return { search: lead?.business_name || '', segment: 'all', status: 'all' }
      }
    } catch {}
    return { search: '', segment: 'all', status: 'all' }
  })
"""
replace_once(old_filter, new_filter, 'foco do lead vindo de retornos')

# Componentes de retornos atrasados.
insert_marker = 'function AdminOverview'
insert_at = text.find(insert_marker)
if insert_at < 0:
    raise SystemExit('AdminOverview não encontrado para inserir Retornos atrasados.')

components = r'''
function isOverdueReturn(lead) {
  const today = currentBrazilDate()
  if (!lead?.next_contact_date || lead.next_contact_date >= today) return false
  if (['won','lost','not_interested','discarded'].includes(lead.status)) return false
  if (lead.last_contact_date && lead.last_contact_date >= lead.next_contact_date) return false
  return true
}

function overdueDays(dateValue) {
  if (!dateValue) return 0
  const today = currentBrazilDate()
  const start = new Date(`${dateValue}T12:00:00`)
  const end = new Date(`${today}T12:00:00`)
  return Math.max(0, Math.floor((end - start) / 86400000))
}

function OverdueReturnsNavItem({ organization, active, onOpen }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let mounted = true
    async function refresh() {
      const { data } = await supabase
        .from('leads')
        .select('id,status,next_contact_date,last_contact_date')
        .eq('organization_id', organization.id)
        .lt('next_contact_date', currentBrazilDate())
      if (mounted) setCount((data || []).filter(isOverdueReturn).length)
    }
    refresh()
    const timer = setInterval(refresh, 30000)
    return () => { mounted = false; clearInterval(timer) }
  }, [organization.id])

  return (
    <button className={`nav-item overdue-nav-v45 ${active ? 'active' : ''}`} onClick={onOpen}>
      <span className="overdue-calendar-icon-v45">
        <CalendarDays size={18}/>
        {count > 0 && <strong>{count > 99 ? '99+' : count}</strong>}
      </span>
      Retornos atrasados
    </button>
  )
}

function OverdueReturnsAlert({ organization, onOpen }) {
  const [count, setCount] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let mounted = true
    async function check() {
      const key = `crm_overdue_alert_${organization.id}_${currentBrazilDate()}`
      if (sessionStorage.getItem(key)) return
      const { data } = await supabase
        .from('leads')
        .select('id,status,next_contact_date,last_contact_date')
        .eq('organization_id', organization.id)
        .lt('next_contact_date', currentBrazilDate())
      const total = (data || []).filter(isOverdueReturn).length
      if (!mounted || !total) return
      sessionStorage.setItem(key, '1')
      setCount(total)
      setVisible(true)
    }
    check()
    return () => { mounted = false }
  }, [organization.id])

  if (!visible) return null

  return (
    <aside className="overdue-alert-v45" role="status">
      <button className="overdue-alert-close-v45" onClick={() => setVisible(false)} aria-label="Fechar aviso">×</button>
      <div className="overdue-alert-icon-v45"><CalendarDays size={22}/><strong>{count > 99 ? '99+' : count}</strong></div>
      <div>
        <strong>{count === 1 ? '1 retorno atrasado' : `${count} retornos atrasados`}</strong>
        <span>Há contatos que precisam de acompanhamento.</span>
      </div>
      <button className="primary inline-btn" onClick={() => { setVisible(false); onOpen() }}>Ver retornos</button>
    </aside>
  )
}

function OverdueReturnsPage({ organization, userEmail, onOpenLead }) {
  const [leads, setLeads] = useState([])
  const [message, setMessage] = useState('')

  const statusNames = {
    new: 'Novo', qualified: 'Qualificado', queued: 'Na fila', contacted: 'Contatado',
    replied: 'Respondeu', interested: 'Interessado', proposal: 'Proposta'
  }

  async function loadData() {
    const { data, error } = await supabase
      .from('leads')
      .select('id,business_name,contact_name,phone,status,next_contact_date,last_contact_date,city,state,target_segments(name),campaigns(name)')
      .eq('organization_id', organization.id)
      .lt('next_contact_date', currentBrazilDate())
      .order('next_contact_date', { ascending: true })

    if (error) setMessage(error.message)
    else {
      setMessage('')
      setLeads((data || []).filter(isOverdueReturn))
    }
  }

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 15000)
    return () => clearInterval(timer)
  }, [organization.id])

  return (
    <>
      <header className="topbar compact-subpage-header">
        <div>
          <span className="eyebrow">ACOMPANHAMENTO</span>
          <h1>Retornos atrasados</h1>
          <p className="muted">Esta lista não retira o lead do funil. Ela funciona como uma fila de acompanhamento dos contatos vencidos.</p>
        </div>
        <div className="topbar-actions"><div className="user-badge">{userEmail}</div></div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="overdue-list-v45">
        {leads.length === 0 ? (
          <article className="panel empty-state">
            <CalendarDays size={34}/>
            <h2>Nenhum retorno atrasado</h2>
            <p>Quando um próximo contato vencer sem atendimento, ele aparecerá aqui automaticamente.</p>
          </article>
        ) : leads.map(lead => (
          <article className="panel overdue-row-v45" key={lead.id}>
            <div className="overdue-company-v45">
              <strong>{lead.business_name}</strong>
              <span>{lead.campaigns?.name || lead.target_segments?.name || 'Sem campanha'}</span>
            </div>
            <div><span>Contato</span><strong>{lead.contact_name || 'Não informado'}</strong></div>
            <div><span>Telefone / WhatsApp</span><strong>{lead.phone || 'Não informado'}</strong></div>
            <div><span>Retorno previsto</span><strong>{lead.next_contact_date ? new Date(`${lead.next_contact_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</strong></div>
            <div><span>Atraso</span><strong className="overdue-days-v45">{overdueDays(lead.next_contact_date)} dia(s)</strong></div>
            <div><span>Etapa do funil</span><strong>{statusNames[lead.status] || lead.status}</strong></div>
            <button className="secondary inline-btn" onClick={() => onOpenLead(lead)}>Abrir lead <ChevronRight size={16}/></button>
          </article>
        ))}
      </section>
    </>
  )
}

'''
text = text[:insert_at] + components + text[insert_at:]

# Novo item no menu logo abaixo do Funil de vendas.
nav_old = """          <button className={`nav-item ${page === 'sales-funnel' ? 'active' : ''}`} onClick={() => { setPage('sales-funnel'); setMobileMenuOpen(false) }}>
            <Users size={18}/> Funil de vendas
          </button>

          {isSystemAdmin && ("""
nav_new = """          <button className={`nav-item ${page === 'sales-funnel' ? 'active' : ''}`} onClick={() => { setPage('sales-funnel'); setMobileMenuOpen(false) }}>
            <Users size={18}/> Funil de vendas
          </button>
          <OverdueReturnsNavItem
            organization={organization}
            active={page === 'overdue-returns'}
            onOpen={() => { setPage('overdue-returns'); setMobileMenuOpen(false) }}
          />

          {isSystemAdmin && ("""
replace_once(nav_old, nav_new, 'menu Retornos atrasados')

# Alerta único ao entrar no sistema.
main_old = """      <main className="content">
        {page === 'dashboard' && ("""
main_new = """      <main className="content">
        <OverdueReturnsAlert organization={organization} onOpen={() => setPage('overdue-returns')} />
        {page === 'dashboard' && ("""
replace_once(main_old, main_new, 'alerta de retornos atrasados')

# Página de retornos e abertura direta do lead no funil.
route_old = """        {page === 'administration' && isSystemAdmin && ("""
route_new = """        {page === 'overdue-returns' && (
          <OverdueReturnsPage
            organization={organization}
            userEmail={userEmail}
            onOpenLead={(lead) => {
              sessionStorage.setItem('crm_focus_lead', JSON.stringify({ id: lead.id, business_name: lead.business_name }))
              setPage('sales-funnel')
            }}
          />
        )}
        {page === 'administration' && isSystemAdmin && ("""
replace_once(route_old, route_new, 'rota Retornos atrasados')

# Estilos.
if '/* V45 - retornos atrasados */' not in css:
    css += r'''

/* V45 - retornos atrasados */
.overdue-nav-v45 { position: relative; }
.overdue-calendar-icon-v45 { position: relative; display: inline-grid; place-items: center; flex: 0 0 18px; }
.overdue-calendar-icon-v45 > strong {
  position: absolute; top: -9px; right: -11px; min-width: 17px; height: 17px; padding: 0 4px;
  border-radius: 999px; background: #dc2626; color: white; border: 2px solid #0b192c;
  display: grid; place-items: center; font-size: 9px; line-height: 1; font-weight: 800;
}
.overdue-alert-v45 {
  position: fixed; right: 24px; top: 24px; z-index: 2000; width: min(430px, calc(100vw - 32px));
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px;
  background: white; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 12px;
  padding: 14px 16px; box-shadow: 0 16px 44px rgba(15,23,42,.18);
}
.overdue-alert-v45 > div:nth-child(3) { display: grid; gap: 3px; }
.overdue-alert-v45 span { color: #64748b; font-size: 12px; }
.overdue-alert-icon-v45 { position: relative; display: grid; place-items: center; color: #b91c1c; }
.overdue-alert-icon-v45 strong {
  position: absolute; top: -8px; right: -9px; min-width: 18px; height: 18px; padding: 0 4px;
  border-radius: 999px; background: #dc2626; color: white; font-size: 9px; display: grid; place-items: center;
}
.overdue-alert-close-v45 { position: absolute; right: 6px; top: 2px; border: 0; background: transparent; color: #94a3b8; font-size: 20px; }
.overdue-list-v45 { display: grid; gap: 10px; }
.overdue-row-v45 {
  display: grid; grid-template-columns: minmax(180px,1.5fr) minmax(140px,1fr) minmax(150px,1fr) 130px 90px 130px auto;
  gap: 14px; align-items: center; padding: 16px 18px;
}
.overdue-row-v45 > div { min-width: 0; display: grid; gap: 4px; }
.overdue-row-v45 > div > span { color: #94a3b8; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.overdue-row-v45 > div > strong { font-size: 13px; color: #334155; overflow-wrap: anywhere; }
.overdue-company-v45 > strong { color: #17212b !important; font-size: 14px !important; }
.overdue-company-v45 > span { text-transform: none !important; letter-spacing: 0 !important; }
.overdue-days-v45 { color: #b91c1c !important; }
@media (max-width: 1100px) {
  .overdue-row-v45 { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .overdue-row-v45 button { width: fit-content; }
}
@media (max-width: 700px) {
  .overdue-alert-v45 { top: 12px; right: 12px; grid-template-columns: auto 1fr; }
  .overdue-alert-v45 .primary { grid-column: 1 / -1; width: 100%; justify-content: center; }
  .overdue-row-v45 { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 500px) { .overdue-row-v45 { grid-template-columns: 1fr; } }
'''

checks = [
    ('menu criado', 'OverdueReturnsNavItem' in text and "page === 'overdue-returns'" in text),
    ('contador no calendário', 'overdue-calendar-icon-v45' in text and 'CalendarDays' in text),
    ('alerta único', 'crm_overdue_alert_' in text and 'OverdueReturnsAlert' in text),
    ('lead não sai do funil', "from('leads')" in components and ".update(" not in components),
    ('abertura direta do lead', "crm_focus_lead" in text),
    ('saída automática após atendimento', 'lead.last_contact_date >= lead.next_contact_date' in text),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V45 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V45 aplicada: Retornos atrasados, contador, alerta único e acesso direto ao lead.')
