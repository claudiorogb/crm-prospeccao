import React from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import './message-template-item.css'

// Item da lista de "Mensagens": fechado mostra só o público-alvo e o título;
// ao clicar abre o texto da mensagem e os botões (Editar, Desativar, Arquivar).
export default function MessageTemplateItem({ template, open, onToggle, onEdit, onToggleActive, onArchive }) {
  const bodyId = `message-item-body-${template.id}`
  return (
    <article className={`panel message-item-v110${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="message-item-head-v110"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="message-item-titles-v110">
          <span className="eyebrow">{template.target_segments?.name || template.segment}</span>
          <strong>
            {template.name}
            {template.is_default_for_target && <span className="inline-default-badge">Padrão</span>}
            {!template.is_active && <span className="template-status inactive message-item-inactive-v110">Inativo</span>}
          </strong>
        </span>
        <ChevronDown size={18} className="message-item-chevron-v110" aria-hidden="true" />
      </button>
      {open && (
        <div className="message-item-body-v110" id={bodyId}>
          <p>{template.body}</p>
          <div className="message-card-actions message-item-actions-v110">
            <span className={`template-status ${template.is_active ? 'active' : 'inactive'}`}>{template.is_active ? 'Ativo' : 'Inativo'}</span>
            <button type="button" className="secondary" onClick={onEdit}>Editar</button>
            <button type="button" className="secondary" onClick={onToggleActive}>{template.is_active ? 'Desativar' : 'Ativar'}</button>
            <button type="button" className="text-danger" onClick={onArchive}><Trash2 size={14} /> Arquivar</button>
          </div>
        </div>
      )}
    </article>
  )
}
