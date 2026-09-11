from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def component(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V64: componente não encontrado: {label}')
    return start, end, text[start:end]


# -----------------------------------------------------------------------------
# 1) CATÁLOGO CRM: paginação visual de 10 segmentos por página.
# -----------------------------------------------------------------------------
start, end, catalog = component(
    'function CatalogAdmin({ userEmail }) {',
    'function TargetSegments({ organization, userEmail }) {',
    'CatalogAdmin'
)

state_marker = "  const [catalogSearch, setCatalogSearch] = useState('')\n"
if state_marker not in catalog:
    raise SystemExit('V64: estado de busca do catálogo não encontrado.')
catalog = catalog.replace(
    state_marker,
    state_marker + "  const [catalogPage, setCatalogPage] = useState(0)\n  const CATALOG_PAGE_SIZE = 10\n",
    1
)

filter_block = r'''  const filteredCatalogSegments = segments.filter(segment => {
    const q = catalogSearch.trim().toLowerCase()
    return !q || (segment.name || '').toLowerCase().includes(q)
  })
'''

pagination_block = r'''  const filteredCatalogSegments = segments.filter(segment => {
    const q = catalogSearch.trim().toLowerCase()
    return !q || (segment.name || '').toLowerCase().includes(q)
  })

  const catalogTotalPages = Math.max(1, Math.ceil(filteredCatalogSegments.length / CATALOG_PAGE_SIZE))
  const safeCatalogPage = Math.min(catalogPage, catalogTotalPages - 1)
  const pagedCatalogSegments = filteredCatalogSegments.slice(
    safeCatalogPage * CATALOG_PAGE_SIZE,
    safeCatalogPage * CATALOG_PAGE_SIZE + CATALOG_PAGE_SIZE
  )

  useEffect(() => {
    setCatalogPage(0)
  }, [catalogSearch])
'''

if filter_block not in catalog:
    raise SystemExit('V64: filtro do catálogo não encontrado.')
catalog = catalog.replace(filter_block, pagination_block, 1)

if 'filteredCatalogSegments.map(segment => {' not in catalog:
    raise SystemExit('V64: lista do catálogo não encontrada.')
catalog = catalog.replace('filteredCatalogSegments.map(segment => {', 'pagedCatalogSegments.map(segment => {', 1)

catalog_end_marker = '''      </section>\n    </>\n  )\n}\n\n\n'''
if catalog_end_marker not in catalog:
    raise SystemExit('V64: fim do catálogo não encontrado.')

catalog_pager = r'''      </section>

      {filteredCatalogSegments.length > 0 && (
        <div className="admin-pagination-v64">
          <span>
            Página <strong>{safeCatalogPage + 1}</strong> de <strong>{catalogTotalPages}</strong>
            {' • '}{filteredCatalogSegments.length} segmento{filteredCatalogSegments.length === 1 ? '' : 's'}
          </span>
          <div>
            <button
              type="button"
              className="secondary mini"
              onClick={() => setCatalogPage(Math.max(0, safeCatalogPage - 1))}
              disabled={safeCatalogPage <= 0}
            >
              Anterior
            </button>
            <button
              type="button"
              className="secondary mini"
              onClick={() => setCatalogPage(Math.min(catalogTotalPages - 1, safeCatalogPage + 1))}
              disabled={safeCatalogPage >= catalogTotalPages - 1}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </>
  )
}


'''
catalog = catalog.replace(catalog_end_marker, catalog_pager, 1)
text = text[:start] + catalog + text[end:]


# -----------------------------------------------------------------------------
# 2) PADRÕES: remove apenas o bloco duplicado "Funcionalidades".
#    O botão Salvar permanece no bloco principal de padrões.
# -----------------------------------------------------------------------------
start, end, defaults = component(
    'function AdminDefaults({ organizations }) {',
    'function AdminMessages({ organizations, userEmail }) {',
    'AdminDefaults'
)

defaults = defaults.replace('    const flags = settings.feature_flags || {}\n', '', 1)
defaults = defaults.replace('        allowed_send_end: settings.allowed_send_end || null,\n        feature_flags: flags\n', '        allowed_send_end: settings.allowed_send_end || null\n', 1)

feature_fn_start = defaults.find('  function toggleFeature(key) {')
feature_fn_end = defaults.find('\n\n  return (', feature_fn_start)
if feature_fn_start < 0 or feature_fn_end < 0:
    raise SystemExit('V64: função toggleFeature não encontrada em Padrões.')
defaults = defaults[:feature_fn_start] + defaults[feature_fn_end + 2:]

old_main_end = r'''            <div className="field-grid">
              <label>
                Horário permitido — início
                <input type="time" value={settings.allowed_send_start || ''} onChange={e => setSettings({...settings, allowed_send_start: e.target.value})} />
              </label>
              <label>
                Horário permitido — fim
                <input type="time" value={settings.allowed_send_end || ''} onChange={e => setSettings({...settings, allowed_send_end: e.target.value})} />
              </label>
            </div>
          </section>

          <section className="panel">
            <span className="eyebrow">FUNCIONALIDADES</span>
            <h2>Liberadas para o cliente</h2>
            <div className="feature-grid">
              {[
                ['capture', 'Captação'],
                ['campaigns', 'Campanhas'],
                ['leads', 'Leads'],
                ['messages', 'Mensagens'],
                ['whatsapp', 'WhatsApp']
              ].map(([key, label]) => (
                <label className="toggle-card" key={key}>
                  <input
                    type="checkbox"
                    checked={(settings.feature_flags || {})[key] !== false}
                    onChange={() => toggleFeature(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <button className="primary inline-btn" onClick={save}><Save size={16}/> Salvar configurações</button>
          </section>'''

new_main_end = r'''            <div className="field-grid">
              <label>
                Horário permitido — início
                <input type="time" value={settings.allowed_send_start || ''} onChange={e => setSettings({...settings, allowed_send_start:e.target.value})} />
              </label>
              <label>
                Horário permitido — fim
                <input type="time" value={settings.allowed_send_end || ''} onChange={e => setSettings({...settings, allowed_send_end:e.target.value})} />
              </label>
            </div>

            <div className="form-actions">
              <button className="primary inline-btn" onClick={save}><Save size={16}/> Salvar configurações</button>
            </div>
          </section>'''

# Tenta primeiro o texto com espaçamento original exato; se V63 não mexeu, deve bater.
if old_main_end not in defaults:
    # Variação com espaços em object spread igual ao original.
    old_main_end_alt = old_main_end.replace('allowed_send_start:e.target.value', 'allowed_send_start: e.target.value').replace('allowed_send_end:e.target.value', 'allowed_send_end: e.target.value')
    if old_main_end_alt in defaults:
        old_main_end = old_main_end_alt
    else:
        # Remoção estrutural segura do segundo painel a partir do marcador FUNCIONALIDADES.
        feature_marker = '          <section className="panel">\n            <span className="eyebrow">FUNCIONALIDADES</span>'
        fs = defaults.find(feature_marker)
        fe = defaults.find('          </section>', fs)
        if fs < 0 or fe < 0:
            raise SystemExit('V64: bloco FUNCIONALIDADES não encontrado em Padrões.')
        fe += len('          </section>')
        defaults = defaults[:fs] + defaults[fe:]
        first_panel_close = defaults.find('          </section>', defaults.find('Horário permitido — fim'))
        if first_panel_close < 0:
            raise SystemExit('V64: painel principal de Padrões não encontrado.')
        save_button = '\n            <div className="form-actions">\n              <button className="primary inline-btn" onClick={save}><Save size={16}/> Salvar configurações</button>\n            </div>'
        defaults = defaults[:first_panel_close] + save_button + '\n' + defaults[first_panel_close:]
else:
    defaults = defaults.replace(old_main_end, new_main_end, 1)

text = text[:start] + defaults + text[end:]


# -----------------------------------------------------------------------------
# 3) AUDITORIA: paginação real no banco, 20 registros por página.
# -----------------------------------------------------------------------------
start, end, audit = component(
    'function AdminAudit({ organizations, userEmail }) {',
    'function Administration({ organizations, reloadOrganizations, userEmail }) {',
    'AdminAudit'
)

old_audit_state = r'''  const [organizationId, setOrganizationId] = useState('')
  const [logs, setLogs] = useState([])
  const [userMap, setUserMap] = useState({})
'''
new_audit_state = r'''  const [organizationId, setOrganizationId] = useState('')
  const [logs, setLogs] = useState([])
  const [userMap, setUserMap] = useState({})
  const [auditPage, setAuditPage] = useState(0)
  const [auditTotal, setAuditTotal] = useState(0)
  const AUDIT_PAGE_SIZE = 20
'''
if old_audit_state not in audit:
    raise SystemExit('V64: estados de Auditoria não encontrados.')
audit = audit.replace(old_audit_state, new_audit_state, 1)

old_load = r'''  async function load() {
    let query = supabase
      .from('audit_logs')
      .select('id,organization_id,actor_user_id,action,entity_type,entity_id,metadata,created_at,organizations(name)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (organizationId) query = query.eq('organization_id', organizationId)

    const { data } = await query
    const rows = data || []
    setLogs(rows)

    const userIds = [...new Set(rows.map(x => x.actor_user_id).filter(Boolean))]
    if (userIds.length) {
      const { data: resolved } = await supabase.functions.invoke('admin_resolve_users', {
        body: { user_ids: userIds }
      })
      setUserMap(resolved?.users || {})
    } else {
      setUserMap({})
    }
  }

  useEffect(() => { load() }, [organizationId])
'''

new_load = r'''  async function load(targetPage = auditPage) {
    const from = targetPage * AUDIT_PAGE_SIZE
    const to = from + AUDIT_PAGE_SIZE - 1

    let query = supabase
      .from('audit_logs')
      .select('id,organization_id,actor_user_id,action,entity_type,entity_id,metadata,created_at,organizations(name)', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (organizationId) query = query.eq('organization_id', organizationId)
    query = query.range(from, to)

    const { data, count, error } = await query
    if (error) {
      setLogs([])
      setAuditTotal(0)
      return
    }

    const rows = data || []
    setLogs(rows)
    setAuditTotal(count || 0)

    const userIds = [...new Set(rows.map(x => x.actor_user_id).filter(Boolean))]
    if (userIds.length) {
      const { data: resolved } = await supabase.functions.invoke('admin_resolve_users', {
        body: { user_ids: userIds }
      })
      setUserMap(resolved?.users || {})
    } else {
      setUserMap({})
    }
  }

  useEffect(() => {
    setAuditPage(0)
    load(0)
  }, [organizationId])

  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE))

  async function goToAuditPage(nextPage) {
    const safePage = Math.min(Math.max(nextPage, 0), auditTotalPages - 1)
    if (safePage === auditPage) return
    setAuditPage(safePage)
    await load(safePage)
  }
'''

if old_load not in audit:
    raise SystemExit('V64: carregamento de Auditoria não encontrado.')
audit = audit.replace(old_load, new_load, 1)

audit = audit.replace(
    'actions={<button className="secondary inline-btn" onClick={load}><RefreshCw size={15}/> Atualizar</button>}',
    'actions={<button className="secondary inline-btn" onClick={() => load(auditPage)}><RefreshCw size={15}/> Atualizar</button>}',
    1
)

audit_panel_end = '''      </section>\n    </>\n  )\n}\n\n'''
if audit_panel_end not in audit:
    raise SystemExit('V64: fim da Auditoria não encontrado.')

audit_pager = r'''      </section>

      <div className="admin-pagination-v64">
        <span>
          Página <strong>{auditPage + 1}</strong> de <strong>{auditTotalPages}</strong>
          {' • '}{auditTotal} registro{auditTotal === 1 ? '' : 's'}
        </span>
        <div>
          <button
            type="button"
            className="secondary mini"
            onClick={() => goToAuditPage(auditPage - 1)}
            disabled={auditPage <= 0}
          >
            Anterior
          </button>
          <button
            type="button"
            className="secondary mini"
            onClick={() => goToAuditPage(auditPage + 1)}
            disabled={auditPage >= auditTotalPages - 1}
          >
            Próxima
          </button>
        </div>
      </div>
    </>
  )
}

'''
audit = audit.replace(audit_panel_end, audit_pager, 1)
text = text[:start] + audit + text[end:]


# -----------------------------------------------------------------------------
# 4) CSS compartilhado da paginação.
# -----------------------------------------------------------------------------
css += r'''

/* V64 - paginação administrativa */
.admin-pagination-v64 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 0 4px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  color: #64748b;
  font-size: 13px;
}
.admin-pagination-v64 > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.admin-pagination-v64 button {
  min-width: 88px;
}
@media (max-width: 620px) {
  .admin-pagination-v64 {
    align-items: stretch;
    flex-direction: column;
  }
  .admin-pagination-v64 > div {
    width: 100%;
  }
  .admin-pagination-v64 button {
    flex: 1 1 0;
  }
}
'''


# -----------------------------------------------------------------------------
# 5) Validações: não altera WhatsApp, funil ou demais áreas.
# -----------------------------------------------------------------------------
start, end, catalog_check = component(
    'function CatalogAdmin({ userEmail }) {',
    'function TargetSegments({ organization, userEmail }) {',
    'Catalog final'
)
start, end, defaults_check = component(
    'function AdminDefaults({ organizations }) {',
    'function AdminMessages({ organizations, userEmail }) {',
    'Padrões final'
)
start, end, audit_check = component(
    'function AdminAudit({ organizations, userEmail }) {',
    'function Administration({ organizations, reloadOrganizations, userEmail }) {',
    'Auditoria final'
)
start, end, whatsapp_check = component(
    'function AdminWhatsApp({ organizations, userEmail, userMode = false }) {',
    'function AdminQueue({ organizations }) {',
    'WhatsApp final'
)

checks = [
    ('catálogo paginado', 'pagedCatalogSegments.map' in catalog_check and 'CATALOG_PAGE_SIZE = 10' in catalog_check),
    ('busca do catálogo preservada', 'catalogSearch' in catalog_check and 'filteredCatalogSegments' in catalog_check),
    ('funcionalidades removidas de Padrões', 'FUNCIONALIDADES' not in defaults_check and 'toggleFeature' not in defaults_check),
    ('salvar Padrões preservado', 'Salvar configurações' in defaults_check and 'async function save()' in defaults_check),
    ('auditoria paginada no banco', "{ count: 'exact' }" in audit_check and '.range(from, to)' in audit_check),
    ('auditoria limita 20 por página', 'AUDIT_PAGE_SIZE = 20' in audit_check),
    ('filtro por organização preservado', "query = query.eq('organization_id', organizationId)" in audit_check),
    ('WhatsApp por organização preservado', ".eq('organization_id', organizationId)" in whatsapp_check and 'default_cadence_days: cadenceDays' in whatsapp_check),
    ('Evolution preservada', "evolutionAction('create_instance'" in whatsapp_check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V64 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V64 aplicada: regras WhatsApp por organização preservadas; Padrões sem duplicidade; Catálogo e Auditoria paginados.')
