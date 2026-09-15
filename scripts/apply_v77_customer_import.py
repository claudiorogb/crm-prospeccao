from pathlib import Path

app_path = Path('src/App.jsx')
styles_path = Path('src/styles.css')

app = app_path.read_text(encoding='utf-8')

import_anchor = "import { supabase } from './lib/supabase'\n"
import_line = "import CustomerImportPanel from './customer-import'\n"
if import_line not in app:
    if import_anchor not in app:
        raise SystemExit('V77: supabase import anchor not found')
    app = app.replace(import_anchor, import_anchor + import_line, 1)

panel_anchor = "      </header>\n\n      {message && <div className=\"notice\">{message}</div>}\n\n      <section className=\"panel clients-toolbar\">"
panel_replacement = "      </header>\n\n      <CustomerImportPanel organization={organization} userId={userId} onImported={() => loadData(null)} />\n\n      {message && <div className=\"notice\">{message}</div>}\n\n      <section className=\"panel clients-toolbar\">"
if '<CustomerImportPanel organization={organization}' not in app:
    if panel_anchor not in app:
        raise SystemExit('V77: clients toolbar anchor not found')
    app = app.replace(panel_anchor, panel_replacement, 1)

app_path.write_text(app, encoding='utf-8')

styles = styles_path.read_text(encoding='utf-8')
marker = '/* V77 CUSTOMER IMPORT */'
if marker not in styles:
    styles += r'''

/* V77 CUSTOMER IMPORT */
.customer-import-wrap { margin-bottom: 18px; }
.customer-import-actions { display: flex; justify-content: flex-end; }
.customer-import-panel { margin-top: 10px; padding: 18px; }
.customer-import-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.customer-import-head h2 { margin: 4px 0 6px; }
.customer-import-head p { margin: 0; max-width: 760px; }
.customer-import-file-button { cursor: pointer; flex: 0 0 auto; }
.customer-import-file-summary { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin-top: 16px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; }
.customer-import-file-summary span { color: var(--muted); font-size: 13px; }
.customer-import-confirm-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; }
.customer-import-confirm-row p { margin: 0; color: var(--muted); }
.customer-import-analysis { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)); gap: 10px; margin-top: 16px; align-items: end; }
.customer-import-stat { border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
.customer-import-stat span { color: var(--muted); font-size: 12px; }
.customer-import-stat strong { font-size: 22px; }
.customer-import-stat.ok { border-color: rgba(34, 197, 94, .35); }
.customer-import-stat.bad { border-color: rgba(239, 68, 68, .45); }
.customer-import-analysis .notice { grid-column: 1 / -1; margin: 0; display: flex; gap: 8px; align-items: center; }
.customer-import-duplicate-choice { grid-column: 1 / span 3; display: flex; flex-direction: column; gap: 6px; }
.customer-import-analysis > .primary { justify-self: end; }
.customer-import-help { margin: 12px 0 0; font-size: 12px; }
@media (max-width: 760px) {
  .customer-import-head, .customer-import-confirm-row { flex-direction: column; align-items: stretch; }
  .customer-import-analysis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .customer-import-duplicate-choice { grid-column: 1 / -1; }
  .customer-import-analysis > .primary { grid-column: 1 / -1; justify-self: stretch; }
  .customer-import-actions .inline-btn, .customer-import-file-button { width: 100%; justify-content: center; }
}
'''
    styles_path.write_text(styles, encoding='utf-8')

print('V77 customer import applied')
