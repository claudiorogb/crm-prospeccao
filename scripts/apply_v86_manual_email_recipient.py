from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
marketing = ROOT / 'src' / 'marketing-list-import.jsx'
email = ROOT / 'src' / 'email-marketing.jsx'
css = ROOT / 'src' / 'email-marketing.css'

text = marketing.read_text(encoding='utf-8')
text = text.replace(
    "export default function MarketingListImport({ organization, onImported }) {",
    "export default function MarketingListImport({ organization, onImported, onManualAdded }) {"
)
text = text.replace(
    "  const [loading, setLoading] = useState(false)\n",
    "  const [loading, setLoading] = useState(false)\n  const [manualEmail, setManualEmail] = useState('')\n  const [manualName, setManualName] = useState('')\n  const [manualCompany, setManualCompany] = useState('')\n  const [manualConfirmed, setManualConfirmed] = useState(false)\n  const [manualMessage, setManualMessage] = useState('')\n"
)
needle = "  return (\n    <div className=\"email-marketing-import-box\">\n"
manual_fn = '''  async function addManualRecipient() {\n    const normalizedEmail = manualEmail.trim().toLowerCase()\n    if (!validEmail(normalizedEmail)) return setManualMessage('Informe um e-mail válido.')\n    if (!manualConfirmed) return setManualMessage('Confirme que este contato pode receber comunicações de e-mail marketing.')\n    setLoading(true)\n    setManualMessage('')\n    try {\n      const { error } = await supabase.rpc('import_email_marketing_contacts', {\n        p_organization_id: organization.id,\n        p_contacts: [{\n          email: normalizedEmail,\n          contact_name: manualName.trim(),\n          company_name: manualCompany.trim(),\n          source: 'Inserido manualmente'\n        }],\n        p_source: 'Inserido manualmente',\n        p_confirmed: true\n      })\n      if (error) throw error\n\n      const { data: contact, error: contactError } = await supabase\n        .from('email_marketing_contacts')\n        .select('id,email,contact_name,company_name,source,status,consent_confirmed,unsubscribed_at')\n        .eq('organization_id', organization.id)\n        .eq('email_normalized', normalizedEmail)\n        .maybeSingle()\n      if (contactError) throw contactError\n      if (!contact) throw new Error('O destinatário foi salvo, mas não pôde ser carregado novamente.')\n      if (contact.status !== 'active' || contact.unsubscribed_at) {\n        setManualMessage('Este endereço está descadastrado e não pode ser usado em campanhas.')\n        if (onImported) await onImported()\n        return\n      }\n\n      setManualEmail('')\n      setManualName('')\n      setManualCompany('')\n      setManualConfirmed(false)\n      setManualMessage('Destinatário adicionado e selecionado para a campanha.')\n      if (onManualAdded) await onManualAdded(contact)\n      else if (onImported) await onImported()\n    } catch (error) {\n      setManualMessage(error.message || 'Não foi possível adicionar o destinatário.')\n    } finally {\n      setLoading(false)\n    }\n  }\n\n'''
if needle not in text:
    raise SystemExit('marketing return anchor not found')
text = text.replace(needle, manual_fn + needle, 1)

box_anchor = '''    <div className="email-marketing-import-box">\n      <div className="email-marketing-import-head">\n'''
manual_ui = '''    <div className="email-marketing-import-box">\n      <div className="email-manual-recipient-box">\n        <div className="email-marketing-import-head">\n          <div>\n            <strong>Adicionar destinatário manualmente</strong>\n            <span>Inclua um endereço individual sem precisar importar uma planilha.</span>\n          </div>\n        </div>\n        <div className="email-manual-recipient-grid">\n          <label>\n            E-mail *\n            <input type="email" value={manualEmail} onChange={e => setManualEmail(e.target.value)} placeholder="contato@empresa.com.br" />\n          </label>\n          <label>\n            Nome\n            <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Nome do contato" />\n          </label>\n          <label>\n            Empresa\n            <input value={manualCompany} onChange={e => setManualCompany(e.target.value)} placeholder="Empresa" />\n          </label>\n        </div>\n        <label className="email-marketing-confirm">\n          <input type="checkbox" checked={manualConfirmed} onChange={e => setManualConfirmed(e.target.checked)} />\n          <span>Confirmo que este contato pertence à base própria da empresa e pode receber comunicações de e-mail marketing. Não é um contato de prospecção fria.</span>\n        </label>\n        <div className="form-actions">\n          <button type="button" className="secondary" disabled={loading || !validEmail(manualEmail) || !manualConfirmed} onClick={addManualRecipient}>\n            {loading ? 'Adicionando...' : 'Adicionar e selecionar'}\n          </button>\n        </div>\n        {manualMessage && <div className="notice">{manualMessage}</div>}\n      </div>\n\n      <div className="email-marketing-import-divider"><span>ou importe uma lista</span></div>\n\n      <div className="email-marketing-import-head">\n'''
if box_anchor not in text:
    raise SystemExit('marketing box anchor not found')
text = text.replace(box_anchor, manual_ui, 1)
marketing.write_text(text, encoding='utf-8')

text = email.read_text(encoding='utf-8')
anchor = "  async function createCampaign(event) {\n"
handler = '''  async function handleManualRecipientAdded(contact) {\n    if (contact?.id) {\n      setSelectedMarketing(old => {\n        const next = new Set(old)\n        next.add(contact.id)\n        return next\n      })\n    }\n    await loadData()\n  }\n\n'''
if anchor not in text:
    raise SystemExit('email campaign anchor not found')
text = text.replace(anchor, handler + anchor, 1)
old = "          <MarketingListImport organization={organization} onImported={loadData} />"
new = "          <MarketingListImport organization={organization} onImported={loadData} onManualAdded={handleManualRecipientAdded} />"
if old not in text:
    raise SystemExit('MarketingListImport usage not found')
text = text.replace(old, new, 1)
email.write_text(text, encoding='utf-8')

style = css.read_text(encoding='utf-8')
append = '''\n.email-manual-recipient-box{display:grid;gap:12px;padding:14px;border:1px solid #dbeafe;border-radius:12px;background:#fff}.email-manual-recipient-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:10px}.email-marketing-import-divider{display:flex;align-items:center;gap:12px;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.email-marketing-import-divider:before,.email-marketing-import-divider:after{content:'';height:1px;background:#e2e8f0;flex:1}@media(max-width:800px){.email-manual-recipient-grid{grid-template-columns:1fr}}\n'''
if '.email-manual-recipient-box' not in style:
    style += append
css.write_text(style, encoding='utf-8')

print('V86 manual email recipient patch applied')
