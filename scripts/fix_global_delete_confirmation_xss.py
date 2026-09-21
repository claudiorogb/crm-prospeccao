from pathlib import Path

path = Path('src/App.jsx')
source = path.read_text(encoding='utf-8')
old = '''        <p>${customMessage || `Tem certeza que deseja excluir${itemName ? ` “${itemName}”` : ' este registro'}? O registro será ocultado das telas normais, mas permanecerá preservado no banco.`}</p>'''
new = '''        <p data-delete-message></p>'''
assert source.count(old) == 1, 'Expected original confirmation markup exactly once; refusing to edit'
source = source.replace(old, new, 1)
anchor = '''      </div>`\n\n    const close = () => overlay.remove()'''
replacement = '''      </div>`\n\n    // Treat names and custom messages as text, never as HTML.\n    overlay.querySelector('[data-delete-message]').textContent =\n      customMessage || `Tem certeza que deseja excluir${itemName ? ` “${itemName}”` : ' este registro'}? O registro será ocultado das telas normais, mas permanecerá preservado no banco.`\n\n    const close = () => overlay.remove()'''
assert source.count(anchor) == 1, 'Expected confirmation modal closing marker exactly once; refusing to edit'
source = source.replace(anchor, replacement, 1)
path.write_text(source, encoding='utf-8')
print('Global deletion modal text injection patched without changing other features.')
