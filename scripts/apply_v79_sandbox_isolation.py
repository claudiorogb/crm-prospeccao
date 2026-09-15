from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: esperado 1 trecho, encontrado {count}')
    text = text.replace(old, new, 1)

replace_once(
"""  const sandboxOrganization = organizations.find(
    org => org.name === 'Área Comercial - Testes e Apresentações' && org.is_active
  )""",
"""  const sandboxOrganization = organizations.find(
    org => org.is_sandbox === true && org.is_active
  )""",
'localização da organização sandbox'
)

replace_once(
"""function Administration({ organizations, reloadOrganizations, userEmail, userId }) {
  const [section, setSection] = useState('overview')""",
"""function Administration({ organizations, reloadOrganizations, userEmail, userId }) {
  const [section, setSection] = useState('overview')
  const productionOrganizations = useMemo(
    () => organizations.filter(org => org.is_sandbox !== true),
    [organizations]
  )""",
'filtro de organizações de produção'
)

start = text.index("function Administration({ organizations, reloadOrganizations, userEmail, userId }) {")
end = text.index("\n\n\n\nexport default function App()", start)
block = text[start:end]

replacements = {
    '<AdminOverview organizations={organizations} />': '<AdminOverview organizations={productionOrganizations} />',
    '<AdminUsers organizations={organizations} userEmail={userEmail} />': '<AdminUsers organizations={productionOrganizations} userEmail={userEmail} />',
    '<AdminWhatsApp organizations={organizations} userEmail={userEmail} />': '<AdminWhatsApp organizations={productionOrganizations} userEmail={userEmail} />',
    '<AdminQueue organizations={organizations} />': '<AdminQueue organizations={productionOrganizations} />',
    '<AdminClients organizations={organizations} reloadOrganizations={reloadOrganizations} />': '<AdminClients organizations={productionOrganizations} reloadOrganizations={reloadOrganizations} />',
    '<AdminGooglePlaces organizations={organizations} />': '<AdminGooglePlaces organizations={productionOrganizations} />',
    '<AdminIntegrations organizations={organizations} />': '<AdminIntegrations organizations={productionOrganizations} />',
    '<AdminDefaults organizations={organizations} />': '<AdminDefaults organizations={productionOrganizations} />',
    '<AdminMessages organizations={organizations} userEmail={userEmail} />': '<AdminMessages organizations={productionOrganizations} userEmail={userEmail} />',
    '<AdminAudit organizations={organizations} userEmail={userEmail} />': '<AdminAudit organizations={productionOrganizations} userEmail={userEmail} />',
}
for old, new in replacements.items():
    count = block.count(old)
    if count != 1:
        raise SystemExit(f'isolamento admin {old}: esperado 1, encontrado {count}')
    block = block.replace(old, new, 1)
text = text[:start] + block + text[end:]

replace_once(
"""      .from('organizations')
      .select('id,name,is_active,created_at,created_by')
      .order('created_at', { ascending: true })""",
"""      .from('organizations')
      .select('id,name,is_active,is_sandbox,created_at,created_by')
      .order('created_at', { ascending: true })""",
'carregamento da flag sandbox'
)

APP.write_text(text, encoding='utf-8')
print('V79 aplicada: ambiente sandbox isolado das organizações e métricas de produção.')
