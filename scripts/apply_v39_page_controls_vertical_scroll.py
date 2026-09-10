from pathlib import Path

CSS = Path('src/styles.css')
css = CSS.read_text(encoding='utf-8')

# V39: a rolagem vertical do funil deve acompanhar a rolagem da página.
# Mantemos apenas a rolagem horizontal própria/fixa do Kanban.
# O problema anterior vinha da altura limitada do container, que criava uma
# segunda rolagem vertical interna independente da rolagem da página.

if '/* V39 - rolagem vertical controlada pela página */' not in css:
    css += r'''

/* V39 - rolagem vertical controlada pela página */
.sales-kanban-always-scroll {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow-x: auto !important;
  overflow-y: visible !important;
  padding-bottom: 20px !important;
}

.sales-kanban {
  align-items: stretch !important;
}

.kanban-column {
  height: auto !important;
  align-self: stretch !important;
}

/* Evita que regras responsivas antigas recriem um container vertical limitado. */
@media (max-width: 900px) {
  .sales-kanban-always-scroll {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
  }
}

@media (max-width: 600px) {
  .sales-kanban-always-scroll {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
  }
}
'''

checks = [
    ('altura automática', 'height: auto !important;' in css),
    ('sem limite máximo', 'max-height: none !important;' in css),
    ('sem altura mínima forçada', 'min-height: 0 !important;' in css),
    ('vertical visível', 'overflow-y: visible !important;' in css),
    ('colunas esticadas', 'align-items: stretch !important;' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V39 falhou: ' + '; '.join(failed))

CSS.write_text(css, encoding='utf-8')
print('V39 aplicada: rolagem vertical do funil passa a acompanhar a página.')
