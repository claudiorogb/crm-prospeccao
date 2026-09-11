from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

old = """    if (!button) return

    if (button.dataset.deleteConfirmed === 'true') {"""
new = """    if (!button) return

    // Os botões do próprio modal não podem ser interceptados novamente.
    // Sem esta trava, \"Sim, arquivar\" abre/intercepta a própria confirmação e o modal fica preso.
    if (button.closest('.delete-confirm-overlay') || button.dataset.deleteAction) return

    if (button.dataset.deleteConfirmed === 'true') {"""

if old not in text:
    raise SystemExit('V50: ponto da confirmação global não encontrado.')

text = text.replace(old, new, 1)

checks = [
    ("ignora botões do modal", "button.closest('.delete-confirm-overlay')" in text),
    ("ignora ações internas", "button.dataset.deleteAction" in text),
    ("mantém confirmação original", "button.dataset.deleteConfirmed === 'true'" in text),
    ("mantém soft delete", "async function softDeleteRow(" in text),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V50 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V50 aplicada: confirmação de arquivamento não intercepta mais os próprios botões do modal.')
