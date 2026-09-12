from pathlib import Path


APP = Path('src/App.jsx')

text = APP.read_text(encoding='utf-8')


new_condition = "!['replied', 'interested'].includes(status) && <strong>{formatCurrency(columnTotal)}</strong>"

if new_condition in text:
    print('V73 já aplicada.')
    raise SystemExit(0)


old_condition = "status !== 'replied' && <strong>{formatCurrency(columnTotal)}</strong>"

if old_condition not in text:
    raise SystemExit('V73: regra financeira da coluna Respondeu não encontrada.')

text = text.replace(old_condition, new_condition, 1)
APP.write_text(text, encoding='utf-8')

if new_condition not in text:
    raise SystemExit('V73: validação da coluna Interessado falhou.')

print('V73 aplicada: coluna Interessado sem total em R$, preservando o relógio.')
