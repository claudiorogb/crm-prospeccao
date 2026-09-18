#!/usr/bin/env python3
"""Apply a fail-closed, two-anchor UI patch. Existing business logic stays untouched."""
from pathlib import Path

path = Path('src/App.jsx')
source = path.read_text(encoding='utf-8')
import_anchor = "import CustomerImportPanel from './customer-import'"
new_import = "import CrmFullExport from './crm-full-export'"
list_anchor = "      <CustomerImportPanel organization={organization} userId={userId} onImported={() => loadData(null)} />"
new_panel = "      <CrmFullExport organization={organization} userId={userId} />"

if source.count(import_anchor) != 1 or source.count(list_anchor) != 1:
    raise SystemExit('V101: App.jsx changed unexpectedly; no edit made')
if new_import in source or new_panel in source:
    raise SystemExit('V101: export already wired; no edit made')
clients_start = source.find('function Clients(')
clients_end = source.find('function Messages(', clients_start)
anchor_position = source.find(list_anchor)
if not (0 <= clients_start < anchor_position < clients_end):
    raise SystemExit('V101: anchor is not in the expected client-list component')

updated = source.replace(import_anchor, import_anchor + '\n' + new_import, 1)
updated = updated.replace(list_anchor, list_anchor + '\n' + new_panel, 1)
if updated.count(new_import) != 1 or updated.count(new_panel) != 1:
    raise SystemExit('V101: post-patch validation failed')
path.write_text(updated, encoding='utf-8')
print('V101: only App.jsx import and client-list export panel were inserted.')
