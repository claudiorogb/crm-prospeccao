from pathlib import Path
import re

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

start = text.index("function Leads({ organization, settings, userEmail }) {")
end = text.index("\nfunction Clients({ organization, userEmail, userId }) {", start)
block = text[start:end]

bulk_pattern = re.compile(
    r'\n\s*<section className="bulk-toolbar">\s*'
    r'<label[\s\S]*?checked=\{bulkVisibleSelected\}[\s\S]*?'
    r'Selecionar todos os filtrados[\s\S]*?'
    r'onClick=\{sendSelectedMessages\}[\s\S]*?'
    r'</section>\s*\n',
    re.MULTILINE,
)

block, bulk_count = bulk_pattern.subn('\n', block, count=1)
if bulk_count != 1:
    raise SystemExit(f'barra de seleção em massa: esperado 1 trecho, encontrado {bulk_count}')

checkbox = """                          <input
                            type=\"checkbox\"
                            checked={selected.has(l.id)}
                            onChange={()=>toggleSelected(l.id)}
                            aria-label={`Selecionar ${l.business_name}`}
                          />
"""
checkbox_count = block.count(checkbox)
if checkbox_count != 1:
    raise SystemExit(f'flag individual do funil: esperado 1 trecho, encontrado {checkbox_count}')
block = block.replace(checkbox, '', 1)

text = text[:start] + block + text[end:]

APP.write_text(text, encoding='utf-8')
print('V81 aplicada: removidos seleção em massa, contador, envio em massa e flags do Funil de vendas para todos os perfis.')
