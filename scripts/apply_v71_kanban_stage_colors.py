from pathlib import Path


APP = Path('src/App.jsx')
CSS = Path('src/styles.css')

text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f'V71: marcador não encontrado: {label}')
    text = text.replace(old, new, 1)


if 'status-new-v71' in text and '/* V71 - Cores por etapa' in css:
    print('V71 já aplicada.')
    raise SystemExit(0)


# Totais e atrasos pertencem às etapas em que já existe negociação/retorno.
# Novo e Contatado mantêm apenas o título e a quantidade de leads.
replace_once(
    '''                    <div className="kanban-column-metrics-v70">
                      <strong>{formatCurrency(columnTotal)}</strong>
                      <span className={overdueCount > 0 ? 'has-overdue' : ''} title="Retornos atrasados">
                        <Clock size={14}/>{overdueCount}
                      </span>
                    </div>''',
    '''                    {!['new', 'contacted'].includes(status) && (
                      <div className="kanban-column-metrics-v70">
                        <strong>{formatCurrency(columnTotal)}</strong>
                        <span className={overdueCount > 0 ? 'has-overdue' : ''} title="Retornos atrasados">
                          <Clock size={14}/>{overdueCount}
                        </span>
                      </div>
                    )}''',
    'métricas condicionais do cabeçalho'
)


# A regra visual de prazo começa em Respondeu e segue as mesmas condições já
# usadas em Interessado, Proposta e Negociação.
replace_once(
    '''                      const expanded = expandedLeadIds.has(l.id)
                      const overdue = isOverdueReturn(l)
                      const withinDueDate = !closedStage && Boolean(l.next_contact_date) && !overdue && l.next_contact_date >= currentBrazilDate()

                      return (
                        <article
                          className={`panel kanban-lead-card kanban-lead-card-v70${overdue ? ' is-overdue-v70' : withinDueDate ? ' is-on-time-v70' : ''}`}''',
    '''                      const expanded = expandedLeadIds.has(l.id)
                      const tracksReturnDeadline = ['replied', 'interested', 'proposal', 'negotiation'].includes(status)
                      const overdue = tracksReturnDeadline && isOverdueReturn(l)
                      const withinDueDate = tracksReturnDeadline && Boolean(l.next_contact_date) && !overdue && l.next_contact_date >= currentBrazilDate()

                      return (
                        <article
                          className={`panel kanban-lead-card kanban-lead-card-v70 status-${status}-v71${overdue ? ' is-overdue-v70' : withinDueDate ? ' is-on-time-v70' : ''}`}''',
    'cores e prazo por etapa'
)


css += r'''

/* V71 - Cores por etapa do Kanban */
.kanban-lead-card-v70.status-new-v71 {
  background: #DCD3FF !important;
  border-color: #C9BCFF !important;
}
.kanban-lead-card-v70.status-contacted-v71 {
  background: #F3FFE3 !important;
  border-color: #D9F4B6 !important;
}
'''


APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')


checks = [
    ('Novo sem métricas', "!['new', 'contacted'].includes(status)" in text),
    ('cores por status', 'status-${status}-v71' in text),
    ('prazo desde Respondeu', "['replied', 'interested', 'proposal', 'negotiation'].includes(status)" in text),
    ('cor de Novo', '#DCD3FF' in css),
    ('cor de Contatado', '#F3FFE3' in css),
]

failed = [label for label, ok in checks if not ok]
if failed:
    raise SystemExit('V71: validações falharam: ' + ', '.join(failed))

print('V71 aplicada: cores de Novo/Contatado e métricas a partir de Respondeu.')
