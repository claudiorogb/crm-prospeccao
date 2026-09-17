"""Minimal guarded change: show the existing overdue popup in the admin test workspace.

No SQL, permissions, filters, or other tenant screens are changed.
"""
from pathlib import Path

path = Path('src/App.jsx')
code = path.read_text(encoding='utf-8')
anchor = '''        <main className="content">
          {!commercialMode && ('''
replacement = '''        <main className="content">
          {commercialMode && sandboxOrganization && adminSandboxSettings && (
            <OverdueReturnsAlert
              organization={sandboxOrganization}
              onOpen={() => { setAdminCommercialPage('overdue-returns'); setMobileMenuOpen(false) }}
            />
          )}
          {!commercialMode && ('''
normal = '''        <OverdueReturnsAlert organization={organization} onOpen={() => setPage('overdue-returns')} />'''

if replacement in code:
    print('V95 already applied; no changes required')
elif code.count(anchor) != 1 or code.count(normal) != 1:
    raise SystemExit('V95 stopped: admin or tenant view changed; no files modified')
else:
    updated = code.replace(anchor, replacement, 1)
    if updated.count('<OverdueReturnsAlert') != code.count('<OverdueReturnsAlert') + 1:
        raise SystemExit('V95 stopped: unexpected popup modification')
    path.write_text(updated, encoding='utf-8')
    print('V95 applied only to system administrator commercial test workspace')
