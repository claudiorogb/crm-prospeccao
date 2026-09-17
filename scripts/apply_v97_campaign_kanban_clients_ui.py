"""Apply only four requested presentation changes with guarded exact matches.

No database, authentication, permissions or tenant-scoped queries are touched.
"""
from pathlib import Path

app_path = Path('src/App.jsx')
css_path = Path('src/styles.css')
app = app_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')

changes = [
    (
        "    ['capture','Captação'],\n    ['sending','Enviar mensagem'],\n    ['messages','Mensagens'],\n    ['email','E-mail marketing'],",
        "    ['capture','Captação'],\n    ['messages','Mensagens'],\n    ['sending','Enviar Mensagens'],\n    ['email','E-mail marketing'],",
        'campaign tab order',
    ),
    (
        '                            <strong className="kanban-value-v70">{formatCurrency(currentLeadValue(l))}</strong>',
        "                            {(!['new', 'contacted', 'replied', 'interested'].includes(status) || currentLeadValue(l) !== 0) && (\n                              <strong className=\"kanban-value-v70\">{formatCurrency(currentLeadValue(l))}</strong>\n                            )}",
        'hide zero-valued cards in four first stages only',
    ),
    (
        '                <span className="eyebrow">{client.segment || \'Cliente\'}</span>\n                <strong>{client.business_name}</strong>',
        '                <strong>{client.business_name}</strong>',
        'hide segment in client list only',
    ),
    (
        '            <p className="muted">Cadastro, relacionamento e histórico comercial em um único lugar.</p>\n',
        '',
        'remove client detail helper copy',
    ),
    (
        '            <p className="field-help">Estas anotações acompanham o mesmo registro do lead e não são perdidas na conversão para cliente.</p>\n',
        '',
        'remove notes helper copy',
    ),
]

for before, after, label in changes:
    if app.count(before) != 1:
        raise SystemExit(f'V97 aborted: expected one {label} anchor, found {app.count(before)}. No files modified.')
    app = app.replace(before, after, 1)

css_mark = '/* V97: lead search icon and all filters share a single 48px row. */'
if css_mark in css:
    raise SystemExit('V97 already applied; refusing to append CSS twice.')
if css.count('.leads-toolbar {') < 1 or css.count('.leads-toolbar {') > 5:
    raise SystemExit('V97 aborted: lead toolbar stylesheet differs unexpectedly. No files modified.')

css += '''\n\n/* V97: lead search icon and all filters share a single 48px row. */
.leads-toolbar .search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 48px;
  padding: 0 13px;
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  background: #fff;
}
.leads-toolbar .search-box svg {
  flex: 0 0 auto;
}
.leads-toolbar .search-box input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: none;
  background: transparent;
}
.leads-toolbar .search-box input:focus {
  border: 0;
  box-shadow: none;
}
.leads-toolbar .search-box:focus-within {
  border-color: #00a88f;
  box-shadow: 0 0 0 3px rgba(0,168,143,.10);
}
.leads-toolbar > select {
  min-width: 0;
  height: 48px;
}
'''

# All validations complete before touching either file.
app_path.write_text(app, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
print('V97 applied: only App.jsx and styles.css; no data, access, or business rules changed.')
