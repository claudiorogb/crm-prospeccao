from pathlib import Path

email_file = Path('src/email-marketing.jsx')
import_file = Path('src/marketing-list-import.jsx')
css_file = Path('src/email-marketing.css')

email = email_file.read_text(encoding='utf-8')
imports = import_file.read_text(encoding='utf-8')
css = css_file.read_text(encoding='utf-8')

old = '''          <p className="muted email-compliance-note">Leads do Funil continuam excluídos. Descadastros valem para as duas bases. Se o mesmo e-mail estiver nas duas, ele recebe apenas uma mensagem por campanha.</p>\n'''
if old not in email:
    raise SystemExit('Compliance note not found')
email = email.replace(old, '', 1)

old = '            <span>Inclua um endereço individual sem precisar importar uma planilha.</span>\n'
if old not in imports:
    raise SystemExit('Manual recipient helper text not found')
imports = imports.replace(old, '', 1)

old = '          <span>Importe uma lista própria em Excel ou CSV. Ela fica separada do Funil e da base de Clientes.</span>\n'
new = '          <span>Importe uma lista própria em Excel ou CSV.</span>\n'
if old not in imports:
    raise SystemExit('Marketing list helper text not found')
imports = imports.replace(old, new, 1)

append = r'''

/* V88 — ajustes finos de densidade visual e textos */
.email-attachments-box .email-file-button{
  display:inline-flex!important;
  width:max-content!important;
  min-width:0!important;
  max-width:max-content!important;
  justify-self:start!important;
  align-self:start!important;
  padding:7px 11px!important;
  min-height:34px!important;
  white-space:nowrap!important;
}
.email-recipient-head>div{
  display:flex!important;
  align-items:baseline!important;
  flex-wrap:wrap!important;
  gap:6px 14px!important;
  min-width:0!important;
}
.email-recipient-head>div>strong{margin-right:2px!important;}
.email-recipient-head>div>span{display:inline-block!important;margin:0!important;}
@media(max-width:700px){
  .email-recipient-head>div{gap:4px 10px!important;}
  .email-attachments-box .email-file-button{width:max-content!important;}
}
'''
if '/* V88 — ajustes finos de densidade visual e textos */' not in css:
    css += append

email_file.write_text(email, encoding='utf-8')
import_file.write_text(imports, encoding='utf-8')
css_file.write_text(css, encoding='utf-8')
print('V88 patch applied')
