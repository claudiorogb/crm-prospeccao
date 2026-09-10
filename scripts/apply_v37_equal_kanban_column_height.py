from pathlib import Path

CSS = Path('src/styles.css')
css = CSS.read_text(encoding='utf-8')

# Faz todas as colunas do Kanban acompanharem a altura da coluna mais alta.
# Isso mantém as linhas/bordas verticais contínuas até o fim do funil,
# mesmo quando algumas etapas têm poucos leads.
if '/* V37 - colunas do funil com altura uniforme */' not in css:
    css += r'''

/* V37 - colunas do funil com altura uniforme */
.sales-kanban {
  align-items: stretch !important;
}
.kanban-column {
  align-self: stretch !important;
  height: 100% !important;
}
'''

checks = [
    ('Kanban esticando colunas', 'align-items: stretch !important;' in css),
    ('Coluna acompanhando altura do grid', 'align-self: stretch !important;' in css and 'height: 100% !important;' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V37 falhou: ' + '; '.join(failed))

CSS.write_text(css, encoding='utf-8')
print('V37 aplicada e validada com sucesso.')
