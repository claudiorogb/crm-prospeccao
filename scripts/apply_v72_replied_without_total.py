from pathlib import Path


APP = Path('src/App.jsx')

text = APP.read_text(encoding='utf-8')


if "status !== 'replied' && <strong>{formatCurrency(columnTotal)}</strong>" in text:
    print('V72 já aplicada.')
    raise SystemExit(0)


old = '''                      <div className="kanban-column-metrics-v70">
                        <strong>{formatCurrency(columnTotal)}</strong>
                        <span className={overdueCount > 0 ? 'has-overdue' : ''} title="Retornos atrasados">'''

new = '''                      <div className="kanban-column-metrics-v70">
                        {status !== 'replied' && <strong>{formatCurrency(columnTotal)}</strong>}
                        <span className={overdueCount > 0 ? 'has-overdue' : ''} title="Retornos atrasados">'''

if old not in text:
    raise SystemExit('V72: cabeçalho financeiro do Kanban não encontrado.')

text = text.replace(old, new, 1)
APP.write_text(text, encoding='utf-8')

if "status !== 'replied' && <strong>{formatCurrency(columnTotal)}</strong>" not in text:
    raise SystemExit('V72: validação da coluna Respondeu falhou.')

print('V72 aplicada: coluna Respondeu sem total em R$, preservando o relógio.')
