from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')

# A barra nativa fica no fim do conteúdo do Kanban. A V35 acrescenta uma
# segunda barra horizontal fixa na base da janela e sincronizada com o funil.
old_import = "import React, { useEffect, useMemo, useState } from 'react'"
new_import = "import React, { useEffect, useMemo, useRef, useState } from 'react'"
if old_import in text:
    text = text.replace(old_import, new_import, 1)
elif new_import not in text:
    raise SystemExit('Import do React não encontrado.')

lead_marker = "function Leads({ organization, settings, userEmail }) {\n"
lead_replacement = "function Leads({ organization, settings, userEmail }) {\n  const kanbanScrollRef = useRef(null)\n  const kanbanFixedScrollRef = useRef(null)\n"
if lead_replacement not in text:
    if lead_marker not in text:
        raise SystemExit('Componente Leads não encontrado.')
    text = text.replace(lead_marker, lead_replacement, 1)

old_section = '      <section className="sales-kanban-wrap sales-kanban-always-scroll">'
new_section = '''      <div
        className="kanban-fixed-horizontal-scroll"
        ref={kanbanFixedScrollRef}
        onScroll={e => {
          const target = kanbanScrollRef.current
          if (target && Math.abs(target.scrollLeft - e.currentTarget.scrollLeft) > 1) {
            target.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
        aria-label="Rolagem horizontal do funil"
      >
        <div className="kanban-fixed-horizontal-scroll-inner" />
      </div>

      <section
        className="sales-kanban-wrap sales-kanban-always-scroll"
        ref={kanbanScrollRef}
        onScroll={e => {
          const target = kanbanFixedScrollRef.current
          if (target && Math.abs(target.scrollLeft - e.currentTarget.scrollLeft) > 1) {
            target.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
      >'''
if 'className="kanban-fixed-horizontal-scroll"' not in text:
    if old_section not in text:
        raise SystemExit('Container do Kanban não encontrado.')
    text = text.replace(old_section, new_section, 1)

if '/* V35 - barra horizontal fixa do funil */' not in css:
    css += r'''

/* V35 - barra horizontal fixa do funil */
.kanban-fixed-horizontal-scroll {
  position: fixed;
  left: 250px;
  right: 0;
  bottom: 0;
  height: 18px;
  overflow-x: scroll;
  overflow-y: hidden;
  z-index: 1000;
  background: #f4f7f9;
  border-top: 1px solid #cbd5e1;
  scrollbar-width: auto;
  scrollbar-color: #64748b #e2e8f0;
}
.kanban-fixed-horizontal-scroll-inner {
  width: 2658px;
  height: 1px;
}
.kanban-fixed-horizontal-scroll::-webkit-scrollbar {
  height: 16px;
}
.kanban-fixed-horizontal-scroll::-webkit-scrollbar-thumb {
  background: #64748b;
  border-radius: 999px;
  border: 3px solid #e2e8f0;
}
.kanban-fixed-horizontal-scroll::-webkit-scrollbar-track {
  background: #e2e8f0;
}
.sales-kanban-always-scroll {
  max-width: 100% !important;
  width: 100% !important;
  overflow-x: auto !important;
  overscroll-behavior-x: contain;
}
@media (max-width: 900px) {
  .kanban-fixed-horizontal-scroll { left: 0; }
}
'''

checks = [
    ('useRef importado', 'useRef' in text.split('\n', 1)[0]),
    ('barra fixa presente', 'kanban-fixed-horizontal-scroll' in text),
    ('refs do Kanban presentes', 'kanbanScrollRef' in text and 'kanbanFixedScrollRef' in text),
    ('sincronização horizontal presente', 'target.scrollLeft = e.currentTarget.scrollLeft' in text),
    ('CSS fixo na base da janela', 'position: fixed;' in css and 'bottom: 0;' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V35 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V35 aplicada e validada com sucesso.')
