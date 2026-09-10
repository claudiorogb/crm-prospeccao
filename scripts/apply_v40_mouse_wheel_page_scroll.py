from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')

marker = "function Leads({ organization, settings, userEmail }) {\n  const kanbanScrollRef = useRef(null)\n  const kanbanFixedScrollRef = useRef(null)\n"
replacement = """function Leads({ organization, settings, userEmail }) {\n  const kanbanScrollRef = useRef(null)\n  const kanbanFixedScrollRef = useRef(null)\n\n  useEffect(() => {\n    const kanban = kanbanScrollRef.current\n    const fixedBar = kanbanFixedScrollRef.current\n\n    function routeVerticalWheelToPage(event) {\n      if (event.ctrlKey || event.metaKey) return\n\n      const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)\n      if (horizontalIntent || !event.deltaY) return\n\n      event.preventDefault()\n      window.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' })\n    }\n\n    const options = { passive: false }\n    if (kanban) kanban.addEventListener('wheel', routeVerticalWheelToPage, options)\n    if (fixedBar) fixedBar.addEventListener('wheel', routeVerticalWheelToPage, options)\n\n    return () => {\n      if (kanban) kanban.removeEventListener('wheel', routeVerticalWheelToPage, options)\n      if (fixedBar) fixedBar.removeEventListener('wheel', routeVerticalWheelToPage, options)\n    }\n  }, [])\n"""

if 'routeVerticalWheelToPage' not in text:
    if marker not in text:
        raise SystemExit('Refs do Kanban não encontrados no componente Leads.')
    text = text.replace(marker, replacement, 1)

if '/* V40 - wheel vertical sempre rola a página */' not in css:
    css += r'''

/* V40 - wheel vertical sempre rola a página */
.sales-kanban-always-scroll,
.kanban-fixed-horizontal-scroll {
  overscroll-behavior-y: auto !important;
}
'''

checks = [
    ('listener de wheel vertical', 'routeVerticalWheelToPage' in text),
    ('scroll da página', "window.scrollBy({ top: event.deltaY" in text),
    ('preserva gesto horizontal', 'horizontalIntent' in text),
    ('listener não passivo', 'passive: false' in text),
    ('overscroll vertical liberado', 'overscroll-behavior-y: auto !important;' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V40 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V40 aplicada: roda do mouse volta a controlar a rolagem vertical da página sobre o funil.')
