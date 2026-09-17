"""Apply only the requested fields in the Lost Kanban column.

All source anchors are verified before modifying App.jsx. No database, authorization,
organization scoping, history, or pipeline transition logic is changed.
"""
from pathlib import Path

path = Path('src/App.jsx')
src = path.read_text(encoding='utf-8')

changes = [
    (
        "  function formatKanbanDate(value) {\n    if (!value) return ''\n    return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')\n  }",
        "  function formatKanbanDate(value) {\n    if (!value) return ''\n    return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')\n  }\n\n  // The date when the lead entered Lost, in the CRM's São Paulo business timezone.\n  // Never use contract_signed_at for a proposal that was declined.\n  function formatLostDeclineDate(value) {\n    if (!value) return ''\n    const date = new Date(value)\n    if (Number.isNaN(date.getTime())) return ''\n    const parts = new Intl.DateTimeFormat('en-US', {\n      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'\n    }).formatToParts(date)\n    const get = type => parts.find(part => part.type === type)?.value || ''\n    return `${get('year')}-${get('month')}-${get('day')}`\n  }",
        'lost transition date formatter',
    ),
    (
        """                            <div className={`kanban-due-v70${overdue ? ' overdue' : withinDueDate ? ' on-time' : ''}`}>
                              {overdue ? (
                                <strong>ATRASADO</strong>
                              ) : l.next_contact_date ? (
                                <span><Clock size={14}/>{formatKanbanDate(l.next_contact_date)}</span>
                              ) : (
                                <span>Sem retorno previsto</span>
                              )}
                            </div>""",
        """                            {status !== 'lost' && (
                              <div className={`kanban-due-v70${overdue ? ' overdue' : withinDueDate ? ' on-time' : ''}`}>
                                {overdue ? (
                                  <strong>ATRASADO</strong>
                                ) : l.next_contact_date ? (
                                  <span><Clock size={14}/>{formatKanbanDate(l.next_contact_date)}</span>
                                ) : (
                                  <span>Sem retorno previsto</span>
                                )}
                              </div>
                            )}""",
        'hide next contact in Lost card summary only',
    ),
    (
        """                          {closedStage && (
                            <div className="kanban-two-fields">
                              <label>
                                <span>Valor do contrato</span>""",
        """                          {status === 'won' && (
                            <div className="kanban-two-fields">
                              <label>
                                <span>Valor do contrato</span>""",
        'limit contract amount and signature date to Won only',
    ),
    (
        """                          )}

                          {(repliedStage || interestedStage || proposalStage || negotiationStage) && (
                            <label className={l.next_contact_date""",
        """                          )}

                          {status === 'lost' && (
                            <label>
                              <span>Data de declínio da proposta</span>
                              <input
                                type="date"
                                value={formatLostDeclineDate(l.status_changed_at)}
                                readOnly
                                className="readonly-field-v54"
                              />
                            </label>
                          )}

                          {(repliedStage || interestedStage || proposalStage || negotiationStage) && (
                            <label className={l.next_contact_date""",
        'display real decline date in Lost only without repurposing signature data',
    ),
]

if 'Data de declínio da proposta' in src:
    raise SystemExit('V100 already present: nothing modified.')
for before, after, label in changes:
    count = src.count(before)
    if count != 1:
        raise SystemExit(f'V100 aborted: {label} expected once; found {count}. No files modified.')
    src = src.replace(before, after, 1)

path.write_text(src, encoding='utf-8')
print('V100 applied to src/App.jsx only. No data, backend, history or access rules touched.')
