from pathlib import Path
import re

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def component(start_marker, end_marker):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'Componente não encontrado: {start_marker}')
    return start, end, text[start:end]


# 1) Corrige a causa real da quebra excessiva nos cards do funil.
# O layout antigo do topo do card ainda reservava uma coluna estreita do checkbox removido.
css += r'''

/* V34 - leitura dos cards e confirmação de exclusão */
.kanban-card-top {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) !important;
  width: 100% !important;
}
.kanban-card-top > div {
  grid-column: 1 / -1 !important;
  width: 100% !important;
  min-width: 0 !important;
}
.kanban-card-top .eyebrow {
  display: block;
  width: 100%;
  max-width: none !important;
  white-space: normal !important;
  word-break: normal !important;
  overflow-wrap: normal !important;
  hyphens: none !important;
  line-height: 1.35;
}
.kanban-lead-card h3 {
  width: 100%;
  max-width: none !important;
  white-space: normal !important;
  word-break: normal !important;
  overflow-wrap: normal !important;
  hyphens: none !important;
  font-size: 14px !important;
  line-height: 1.25 !important;
}

.delete-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: rgba(15, 23, 42, .38);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 24px 16px;
}
.delete-confirm-banner {
  margin-top: 18px;
  width: min(560px, 100%);
  background: #ffffff;
  border: 1px solid #fecaca;
  border-radius: 14px;
  box-shadow: 0 18px 60px rgba(15, 23, 42, .22);
  padding: 18px;
}
.delete-confirm-banner h3 {
  margin: 0;
  font-size: 18px;
  color: #991b1b;
}
.delete-confirm-banner p {
  margin: 8px 0 0;
  color: #475569;
  line-height: 1.45;
  font-size: 13px;
}
.delete-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
.delete-confirm-danger {
  border: 0;
  background: #b91c1c;
  color: #fff;
  padding: 11px 16px;
  border-radius: 9px;
  font-weight: 800;
}
'''


# 2) Confirmação visual centralizada para TODO botão de exclusão do sistema.
# Intercepta o clique antes do onClick do React; ao confirmar, o clique é liberado uma única vez.
if 'function installGlobalDeleteConfirmation()' not in text:
    guard = r'''function installGlobalDeleteConfirmation() {
  if (typeof document === 'undefined' || window.__crmDeleteConfirmationInstalled) return
  window.__crmDeleteConfirmationInstalled = true

  document.addEventListener('click', event => {
    const origin = event.target
    const button = origin?.closest ? origin.closest('button') : null
    if (!button) return

    if (button.dataset.deleteConfirmed === 'true') {
      delete button.dataset.deleteConfirmed
      return
    }

    const label = [
      button.textContent || '',
      button.getAttribute('aria-label') || '',
      button.getAttribute('title') || ''
    ].join(' ').toLowerCase()

    if (!label.includes('excluir')) return

    event.preventDefault()
    event.stopPropagation()
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()

    document.querySelector('.delete-confirm-overlay')?.remove()

    const scope = button.closest('article, tr, section, .panel')
    const itemName = scope?.querySelector('h2, h3, strong')?.textContent?.trim()
    const customMessage = button.dataset.confirmMessage || ''

    const overlay = document.createElement('div')
    overlay.className = 'delete-confirm-overlay'
    overlay.innerHTML = `
      <div class="delete-confirm-banner" role="dialog" aria-modal="true" aria-label="Confirmar exclusão">
        <h3>Confirmar exclusão</h3>
        <p>${customMessage || `Tem certeza que deseja excluir${itemName ? ` “${itemName}”` : ' este registro'}? Esta ação pode ser permanente.`}</p>
        <div class="delete-confirm-actions">
          <button type="button" class="secondary" data-delete-action="cancel">Cancelar</button>
          <button type="button" class="delete-confirm-danger" data-delete-action="confirm">Sim, excluir</button>
        </div>
      </div>`

    const close = () => overlay.remove()
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close()
    })
    overlay.querySelector('[data-delete-action="cancel"]')?.addEventListener('click', close)
    overlay.querySelector('[data-delete-action="confirm"]')?.addEventListener('click', () => {
      button.dataset.deleteConfirmed = 'true'
      close()
      button.click()
    })

    document.body.appendChild(overlay)
  }, true)
}

installGlobalDeleteConfirmation()

'''
    marker = 'function AdminSectionHeader('
    pos = text.find(marker)
    if pos < 0:
        raise SystemExit('Ponto para confirmação global não encontrado.')
    text = text[:pos] + guard + text[pos:]


# 3) Evita confirmação duplicada nos fluxos que já usavam window.confirm ao excluir.
multiline_delete_lead = r'''    const confirmed = window.confirm(
      `Excluir definitivamente \"${businessName}\"?\
\
Ao excluir, esse lead poderá ser encontrado novamente em uma futura captação automática.`
    )
    if (!confirmed) return
'''
text = text.replace(multiline_delete_lead, '', 1)

# Confirmações de exclusão em uma única linha: campanha, mensagem, venda, número e usuário.
text = re.sub(
    r'^\s*if \(!window\.confirm\(`Excluir[^`]*`\)\) return\s*$',
    '',
    text,
    flags=re.MULTILINE
)


# 4) Público-alvo passa a ter exclusão própria.
start, end, target = component(
    'function TargetSegments({ organization, userEmail }) {',
    'function Campaigns({ organization, settings, userEmail }) {'
)

if 'async function deleteTargetSegment(segment)' not in target:
    return_pos = target.rfind('\n  return (')
    if return_pos < 0:
        raise SystemExit('Render do Público-alvo não encontrado.')

    delete_fn = r'''
  async function deleteTargetSegment(segment) {
    setMessage('')

    // Mantém campanhas históricas, apenas retirando o vínculo com o público que será excluído.
    const { error: campaignError } = await supabase
      .from('campaigns')
      .update({ target_segment_id: null })
      .eq('organization_id', organization.id)
      .eq('target_segment_id', segment.id)

    if (campaignError) {
      setMessage(`Não foi possível preparar a exclusão: ${campaignError.message}`)
      return
    }

    const { error } = await supabase
      .from('target_segments')
      .delete()
      .eq('id', segment.id)
      .eq('organization_id', organization.id)

    if (error) {
      setMessage(`Não foi possível excluir o público-alvo: ${error.message}`)
      return
    }

    setMessage('Público-alvo excluído. Campanhas existentes foram mantidas e podem ser editadas para escolher outro público.')
    await loadData()
  }

'''
    target = target[:return_pos] + delete_fn + target[return_pos:]

button_marker = r'''                <button className="secondary" onClick={() => toggleSegment(segment)}>
                  {segment.is_active ? 'Desativar' : 'Ativar'}
                </button>'''
button_replacement = r'''                <button className="secondary" onClick={() => toggleSegment(segment)}>
                  {segment.is_active ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  className="text-danger"
                  data-confirm-message={`Tem certeza que deseja excluir o público-alvo “${segment.name}”? As campanhas existentes serão mantidas, mas ficarão sem público até serem editadas.`}
                  onClick={() => deleteTargetSegment(segment)}
                >
                  <Trash2 size={14}/> Excluir
                </button>'''

if 'onClick={() => deleteTargetSegment(segment)}' not in target:
    if button_marker not in target:
        raise SystemExit('Botões do Público-alvo não encontrados.')
    target = target.replace(button_marker, button_replacement, 1)

text = text[:start] + target + text[end:]


# 5) Validações para impedir deploy parcial.
_, _, target_check = component(
    'function TargetSegments({ organization, userEmail }) {',
    'function Campaigns({ organization, settings, userEmail }) {'
)

checks = [
    ('Correção estrutural do topo do card', 'grid-template-columns: minmax(0, 1fr) !important' in css),
    ('Nome sem quebra no meio da palavra', 'overflow-wrap: normal !important' in css and 'hyphens: none !important' in css),
    ('Excluir público-alvo', 'deleteTargetSegment(segment)' in target_check and 'onClick={() => deleteTargetSegment(segment)}' in target_check),
    ('Confirmação global', 'installGlobalDeleteConfirmation()' in text and 'delete-confirm-overlay' in css),
]

failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V34 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V34 aplicada e validada com sucesso.')
