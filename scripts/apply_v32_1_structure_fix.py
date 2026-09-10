from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def replace_between(start_marker, end_marker, replacement, label):
    global text
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'Início não encontrado: {label}')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'Fim não encontrado: {label}')
    text = text[:start] + replacement + text[end:]


# Garante a ordem exata dentro de Campanhas.
campaign_workspace = r'''function CampaignWorkspace({ organization, settings, userEmail }) {
  const [section, setSection] = useState('targets')
  const items = [
    ['targets','Público-alvo'],
    ['campaigns','Campanha'],
    ['capture','Captação'],
    ['sending','Enviar mensagem'],
    ['messages','Mensagens'],
    ['whatsapp','WhatsApp']
  ]

  return (
    <>
      <div className="workspace-tabs">
        {items.map(([key,label]) => (
          <button key={key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>
            {label}
          </button>
        ))}
      </div>
      {section === 'targets' && <TargetSegments organization={organization} userEmail={userEmail} />}
      {section === 'campaigns' && settings?.feature_flags?.campaigns !== false && <Campaigns organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'capture' && settings?.feature_flags?.capture !== false && <Capture organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'sending' && <MessageSending organization={organization} settings={settings} userEmail={userEmail} />}
      {section === 'messages' && settings?.feature_flags?.messages !== false && <Messages organization={organization} userEmail={userEmail} />}
      {section === 'whatsapp' && <AdminWhatsApp organizations={[organization]} userEmail={userEmail} userMode={true} />}
    </>
  )
}

'''
replace_between(
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'function ManualLeadRegistration({ organization, settings, userEmail }) {',
    campaign_workspace,
    'CampaignWorkspace'
)


# Mantém Clientes como subpágina principal do Funil e coloca Cadastro/Repositório dentro de Leads.
sales_workspace = r'''function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {
  const [section, setSection] = useState('leads')
  const [leadSection, setLeadSection] = useState('funnel')

  return (
    <>
      <div className="workspace-tabs">
        <button className={section === 'leads' ? 'active' : ''} onClick={() => setSection('leads')}>Leads</button>
        <button className={section === 'clients' ? 'active' : ''} onClick={() => setSection('clients')}>Clientes</button>
      </div>

      {section === 'leads' && (
        <>
          <div className="workspace-tabs workspace-subtabs">
            <button className={leadSection === 'funnel' ? 'active' : ''} onClick={() => setLeadSection('funnel')}>Funil</button>
            <button className={leadSection === 'new-lead' ? 'active' : ''} onClick={() => setLeadSection('new-lead')}>Cadastro novo lead</button>
            <button className={leadSection === 'repository' ? 'active' : ''} onClick={() => setLeadSection('repository')}>Repositório</button>
          </div>
          {leadSection === 'funnel' && <Leads organization={organization} settings={settings} userEmail={userEmail} />}
          {leadSection === 'new-lead' && <ManualLeadRegistration organization={organization} settings={settings} userEmail={userEmail} />}
          {leadSection === 'repository' && <NotInterestedRepository organization={organization} userEmail={userEmail} />}
        </>
      )}

      {section === 'clients' && <Clients organization={organization} userEmail={userEmail} userId={userId} />}
    </>
  )
}

'''
replace_between(
    'function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {',
    'function AdminOverview',
    sales_workspace,
    'SalesFunnelWorkspace'
)


if '/* V32.1 - estrutura refinada */' not in css:
    css += r'''

/* V32.1 - estrutura refinada */
.workspace-subtabs {
  margin-top: -10px;
  margin-bottom: 16px;
  padding: 6px;
  background: #f8fafc;
}
.workspace-subtabs button {
  font-size: 13px;
  padding: 8px 12px;
}
'''


# Validações de implantação: o build falha se alguma regra crítica desaparecer.
def component(start_marker, end_marker):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'Componente ausente: {start_marker}')
    return text[start:end]

campaigns = component('function Campaigns({ organization, settings, userEmail }) {', 'function Capture({ organization, settings, userEmail }) {')
messages = component('function Messages({ organization, userEmail }) {', 'function AdminOverview')
leads = component('function Leads({ organization, settings, userEmail }) {', 'function Clients({ organization, userEmail, userId }) {')
manual = component('function ManualLeadRegistration({ organization, settings, userEmail }) {', 'function NotInterestedRepository({ organization, userEmail }) {')
sending = component('function MessageSending({ organization, settings, userEmail }) {', 'function CampaignWorkspace({ organization, settings, userEmail }) {')
workspace = component('function CampaignWorkspace({ organization, settings, userEmail }) {', 'function ManualLeadRegistration({ organization, settings, userEmail }) {')
sales = component('function SalesFunnelWorkspace({ organization, settings, userEmail, userId }) {', 'function AdminOverview')

checks = [
    ('Campanha sem valor de proposta', 'Valor da proposta' not in campaigns and 'proposal_sent_at' not in campaigns),
    ('Campanha editável', 'startEdit' in campaigns and '>Editar<' in campaigns),
    ('Campanha excluível', 'deleteCampaign' in campaigns and '> Excluir<' in campaigns),
    ('Mensagens listadas', 'templates.map' in messages),
    ('Mensagens editáveis', 'editTemplate' in messages),
    ('Mensagens excluíveis', 'deleteTemplate' in messages),
    ('Rolagem do funil fixa na área visível', 'sales-kanban-always-scroll' in leads),
    ('Fila acompanhada em Enviar mensagem', 'Na fila' in sending and 'queue' in sending),
    ('Sem interesse com repositório', 'NotInterestedRepository' in text),
    ('Cadastro manual separado', 'Cadastro novo lead' in manual),
    ('Cadastro manual sem público', '<label>Público-alvo' not in manual),
    ('Cadastro manual sem campanha', '<label>Campanha' not in manual),
    ('Flags fora do funil', 'type="checkbox"' not in leads),
    ('Enviar mensagem após Captação', workspace.find("['capture','Captação']") < workspace.find("['sending','Enviar mensagem']") < workspace.find("['messages','Mensagens']")),
    ('Coluna Na fila removida', ".filter(([status]) => !['discarded','queued'].includes(status))" in leads),
    ('Coluna Proposta criada', "proposal: 'Proposta'" in leads),
    ('Campos iniciais simplificados', "const compactEarly = ['new','qualified','contacted'].includes(status)" in leads),
    ('Respondido sem proposta', "const repliedStage = status === 'replied'" in leads),
    ('Sem interesse simplificado', "const minimalRejected = status === 'not_interested'" in leads),
    ('Perdido sem próximo contato', "const showNextContact = !['lost','not_interested'].includes(status)" in leads),
    ('Cadastro e repositório dentro de Leads', 'workspace-subtabs' in sales and "leadSection === 'new-lead'" in sales and "leadSection === 'repository'" in sales),
]

failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V32.1 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V32.1 aplicada e validada com sucesso.')
