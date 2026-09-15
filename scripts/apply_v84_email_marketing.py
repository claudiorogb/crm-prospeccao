from pathlib import Path

p = Path('src/App.jsx')
s = p.read_text(encoding='utf-8')

# Import components.
needle = "import CustomerImportPanel from './customer-import'\n"
addition = "import CustomerImportPanel from './customer-import'\nimport { EmailMarketing, AdminEmailMarketing } from './email-marketing'\n"
if "from './email-marketing'" not in s:
    if needle not in s:
        raise SystemExit('Import marker not found')
    s = s.replace(needle, addition, 1)

# Campaigns workspace tab.
needle = "    ['messages','Mensagens'],\n    ['whatsapp','WhatsApp']"
replacement = "    ['messages','Mensagens'],\n    ['email','E-mail marketing'],\n    ['whatsapp','WhatsApp']"
if "['email','E-mail marketing']" not in s:
    if needle not in s:
        raise SystemExit('Campaign tab marker not found')
    s = s.replace(needle, replacement, 1)

# Campaigns workspace render.
needle = "      {section === 'messages' && settings?.feature_flags?.messages !== false && <Messages organization={organization} userEmail={userEmail} />}\n      {section === 'whatsapp' && <AdminWhatsApp organizations={[organization]} userEmail={userEmail} userMode={true} />}"
replacement = "      {section === 'messages' && settings?.feature_flags?.messages !== false && <Messages organization={organization} userEmail={userEmail} />}\n      {section === 'email' && <EmailMarketing organization={organization} userEmail={userEmail} />}\n      {section === 'whatsapp' && <AdminWhatsApp organizations={[organization]} userEmail={userEmail} userMode={true} />}"
if "<EmailMarketing organization={organization}" not in s:
    if needle not in s:
        raise SystemExit('Campaign render marker not found')
    s = s.replace(needle, replacement, 1)

# System administration navigation.
needle = "    ['whatsapp', 'WhatsApp', Phone],\n    ['queue', 'Fila', ListChecks],"
replacement = "    ['whatsapp', 'WhatsApp', Phone],\n    ['email', 'E-mail', Send],\n    ['queue', 'Fila', ListChecks],"
if "['email', 'E-mail', Send]" not in s:
    if needle not in s:
        raise SystemExit('Admin navigation marker not found')
    s = s.replace(needle, replacement, 1)

# System administration render.
needle = "          {section === 'whatsapp' && <AdminWhatsApp organizations={productionOrganizations} userEmail={userEmail} />}\n          {section === 'queue' && <AdminQueue organizations={productionOrganizations} />}"
replacement = "          {section === 'whatsapp' && <AdminWhatsApp organizations={productionOrganizations} userEmail={userEmail} />}\n          {section === 'email' && <AdminEmailMarketing organizations={productionOrganizations} userEmail={userEmail} />}\n          {section === 'queue' && <AdminQueue organizations={productionOrganizations} />}"
if "<AdminEmailMarketing organizations={productionOrganizations}" not in s:
    if needle not in s:
        raise SystemExit('Admin render marker not found')
    s = s.replace(needle, replacement, 1)

p.write_text(s, encoding='utf-8')
print('V84 App.jsx patch applied')
