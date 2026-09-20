#!/usr/bin/env python3
"""Remove only the four dashboard descriptions requested by the user."""
from pathlib import Path

app_path = Path('src/App.jsx')
visual_path = Path('src/dashboard-visual.jsx')
app = app_path.read_text(encoding='utf-8')
visual = visual_path.read_text(encoding='utf-8')

# Fail closed if the code differs, rather than applying a partial change.
app_replacements = {
    '            <p className="muted">Conversão, propostas e vendas atribuídas a cada usuário da empresa.</p>\n': '',
    '            <p className="muted">Origem dos leads e avanço inicial da prospecção.</p>\n': '',
}
visual_replacements = {
    'function Panel({ title, subtitle, icon: Icon, children }) {': 'function Panel({ title, icon: Icon, children }) {',
    '<div><h2>{title}</h2><p>{subtitle}</p></div>': '<div><h2>{title}</h2></div>',
    'title="Funil de vendas" subtitle="Etapa atual dos leads cadastrados" icon={Filter}': 'title="Funil de vendas" icon={Filter}',
    'title="Origem dos leads" subtitle="Como os leads chegaram" icon={ChartNoAxesCombined}': 'title="Origem dos leads" icon={ChartNoAxesCombined}',
}
for path, content, replacements in ((app_path, app, app_replacements), (visual_path, visual, visual_replacements)):
    for original in replacements:
        if content.count(original) != 1:
            raise SystemExit(f'Expected exactly one occurrence in {path}: {original!r}; found {content.count(original)}')

for old, new in app_replacements.items():
    app = app.replace(old, new)
for old, new in visual_replacements.items():
    visual = visual.replace(old, new)
for phrase in (
    'Etapa atual dos leads cadastrados',
    'Como os leads chegaram',
    'Conversão, propostas e vendas atribuídas a cada usuário da empresa.',
    'Conversão, propostas e vendas atribuídas a cada vendedor',
    'Origem dos leads e avanço inicial da prospecção.',
):
    if phrase in app or phrase in visual:
        raise SystemExit(f'Description still present: {phrase}')

app_path.write_text(app, encoding='utf-8')
visual_path.write_text(visual, encoding='utf-8')
print('Removed four dashboard descriptions; only src/App.jsx and src/dashboard-visual.jsx updated.')
