from pathlib import Path
import re

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def component(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V51: componente não encontrado: {label}')
    return start, end, text[start:end]


# -----------------------------------------------------------------------------
# 1) Soft delete passa por Edge Function autenticada. Isso evita o conflito
#    entre RLS de SELECT (que esconde arquivados) e UPDATE do próprio arquivamento.
#    A função também aceita System Admin e valida organização/membership no backend.
# -----------------------------------------------------------------------------
soft_delete = r'''async function softDeleteRow(table, id, organizationId, extra = {}) {
  const { data, error } = await supabase.functions.invoke('archive_record', {
    body: {
      table,
      id,
      organization_id: organizationId
    }
  })

  if (error) return { error }
  if (data?.error) return { error: new Error(data.error) }
  return { data, error: null }
}'''

pattern = re.compile(r'(?ms)^async function softDeleteRow\(table, id, organizationId, extra = \{\}\) \{.*?^\}')
text, count = pattern.subn(soft_delete, text, count=1)
if count != 1:
    raise SystemExit('V51: helper softDeleteRow não encontrado.')


# -----------------------------------------------------------------------------
# 2) Público-alvo: INATIVO em vermelho e arquivados explicitamente fora da lista,
#    inclusive para System Admin (que possui política ampla de leitura).
# -----------------------------------------------------------------------------
start, end, target = component(
    'function TargetSegments({ organization, userEmail }) {',
    'function Campaigns({ organization, settings, userEmail }) {',
    'Público-alvo'
)

target = target.replace(
    ".eq('organization_id', organization.id)\n          .order('created_at', { ascending: true })",
    ".eq('organization_id', organization.id)\n          .is('deleted_at', null)\n          .order('created_at', { ascending: true })",
    1
)

target = target.replace(
    '<span className="eyebrow">{segment.is_active ? \'ATIVO\' : \'INATIVO\'}</span>',
    '<span className={`eyebrow ${segment.is_active ? \'\' : \'status-inactive-v51\'}`}>{segment.is_active ? \'ATIVO\' : \'INATIVO\'}</span>',
    1
)
text = text[:start] + target + text[end:]


# -----------------------------------------------------------------------------
# 3) Campanhas: arquivados somem também para System Admin. Caso uma campanha
#    esteja pausada/inativa sem estar arquivada, o estado aparece em vermelho.
# -----------------------------------------------------------------------------
start, end, campaigns = component(
    'function Campaigns({ organization, settings, userEmail }) {',
    'function Capture({ organization, settings, userEmail }) {',
    'Campanhas'
)

campaigns = campaigns.replace(
    ".eq('organization_id', organization.id)\n        .order('created_at', {ascending:false}),",
    ".eq('organization_id', organization.id)\n        .is('deleted_at', null)\n        .order('created_at', {ascending:false}),",
    1
)
campaigns = campaigns.replace(
    ".eq('organization_id', organization.id)\n        .eq('is_active', true)",
    ".eq('organization_id', organization.id)\n        .is('deleted_at', null)\n        .eq('is_active', true)",
    1
)

campaign_card_marker = '''              <span className="eyebrow">{c.target_segments?.name || c.segment}</span>\n              <h2>{c.name}</h2>'''
campaign_card_new = '''              <span className="eyebrow">{c.target_segments?.name || c.segment}</span>\n              {(c.status === 'paused' || c.deleted_at) && <span className="status-inactive-v51 campaign-inactive-v51">INATIVA</span>}\n              <h2>{c.name}</h2>'''
if campaign_card_marker not in campaigns:
    raise SystemExit('V51: cartão de Campanha não encontrado.')
campaigns = campaigns.replace(campaign_card_marker, campaign_card_new, 1)
text = text[:start] + campaigns + text[end:]


# Remove campanhas arquivadas também das telas auxiliares que usam a mesma organização.
start, end, capture = component(
    'function Capture({ organization, settings, userEmail }) {',
    'function Messages({ organization, userEmail }) {',
    'Captação'
)
capture = capture.replace(
    ".eq('organization_id', organization.id)\n        .order('created_at', { ascending: false })",
    ".eq('organization_id', organization.id)\n        .is('deleted_at', null)\n        .order('created_at', { ascending: false })",
    1
)
text = text[:start] + capture + text[end:]

# Filtros explícitos em consultas compactas de envio, para o mesmo comportamento no System Admin.
text = text.replace(
    ".from('campaigns').select('id,name,target_segment_id,target_segments(name)').eq('organization_id',organization.id).order('created_at',{ascending:false})",
    ".from('campaigns').select('id,name,target_segment_id,target_segments(name)').eq('organization_id',organization.id).is('deleted_at',null).order('created_at',{ascending:false})"
)
text = text.replace(
    ".from('target_segments').select('id,name').eq('organization_id',organization.id).eq('is_active',true).order('name')",
    ".from('target_segments').select('id,name').eq('organization_id',organization.id).is('deleted_at',null).eq('is_active',true).order('name')"
)


# -----------------------------------------------------------------------------
# 4) Cabeçalho REALMENTE congelado no funil.
#    O sticky anterior estava dentro do elemento com overflow horizontal e por isso
#    não acompanhava a rolagem vertical da página. Criamos uma faixa sticky irmã,
#    sincronizada horizontalmente com o Kanban.
# -----------------------------------------------------------------------------
if "useEffect, useMemo, useState" in text:
    text = text.replace("useEffect, useMemo, useState", "useEffect, useMemo, useRef, useState", 1)
elif "useEffect, useMemo, useRef, useState" not in text:
    raise SystemExit('V51: import React não encontrado para useRef.')

start, end, leads = component(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)

lead_signature = 'function Leads({ organization, settings, userEmail }) {\n'
if lead_signature not in leads:
    raise SystemExit('V51: assinatura de Leads não encontrada.')
leads = leads.replace(
    lead_signature,
    lead_signature + '  const stickyKanbanHeaderRef = useRef(null)\n',
    1
)

kanban_open = '      <section className="sales-kanban-wrap sales-kanban-always-scroll">'
kanban_open_new = r'''      <div className="kanban-sticky-scope-v51">
        <div className="kanban-sticky-viewport-v51" ref={stickyKanbanHeaderRef} aria-hidden="true">
          <div className="sales-kanban kanban-sticky-grid-v51">
            {Object.entries(statusLabel)
              .filter(([status]) => !['discarded','queued'].includes(status))
              .map(([status, label]) => (
                <div className="kanban-column-head kanban-sticky-cell-v51" key={`sticky-${status}`}>
                  <strong>{label}</strong>
                  <span>{visibleLeads.filter(l => l.status === status).length}</span>
                </div>
              ))}
          </div>
        </div>
        <section
          className="sales-kanban-wrap sales-kanban-always-scroll"
          onScroll={e => {
            if (stickyKanbanHeaderRef.current) stickyKanbanHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft
          }}
        >'''
if kanban_open not in leads:
    raise SystemExit('V51: início do Kanban não encontrado.')
leads = leads.replace(kanban_open, kanban_open_new, 1)

kanban_pos = leads.find('className="sales-kanban-wrap sales-kanban-always-scroll"')
section_end = leads.find('\n      </section>', kanban_pos)
if section_end < 0:
    raise SystemExit('V51: fim do Kanban não encontrado.')
section_end += len('\n      </section>')
leads = leads[:section_end] + '\n      </div>' + leads[section_end:]

text = text[:start] + leads + text[end:]


# -----------------------------------------------------------------------------
# 5) Estilos finais. Também deixa INATIVO vermelho no catálogo do System Admin.
# -----------------------------------------------------------------------------
css += r'''

/* V51 - status inativo e cabeçalho persistente do funil */
.status-inactive-v51,
.eyebrow.status-inactive-v51 {
  color: #b91c1c !important;
}
.campaign-inactive-v51 {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .10em;
}

/* O mesmo padrão visual para itens inativos na administração do sistema. */
.compact-status.inactive {
  background: #fef2f2 !important;
  color: #b91c1c !important;
  border-color: #fecaca !important;
}

.kanban-sticky-scope-v51 {
  position: relative;
}
.kanban-sticky-viewport-v51 {
  position: sticky;
  top: 0;
  z-index: 80;
  overflow-x: hidden;
  overflow-y: hidden;
  width: 100%;
  background: #f4f7f9;
  padding-bottom: 6px;
}
.kanban-sticky-grid-v51 {
  align-items: stretch !important;
}
.kanban-sticky-cell-v51 {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(15,23,42,.07);
  min-height: 52px;
}

/* A faixa acima substitui visualmente os cabeçalhos originais das colunas. */
.sales-kanban-always-scroll .kanban-column > .kanban-column-head {
  display: none !important;
}
'''


# -----------------------------------------------------------------------------
# 6) Validações para impedir deploy parcial.
# -----------------------------------------------------------------------------
checks = [
    ('arquivamento via Edge Function', "supabase.functions.invoke('archive_record'" in text),
    ('público inativo vermelho', 'status-inactive-v51' in target),
    ('campanha arquivada filtrada', ".from('campaigns')" in campaigns and ".is('deleted_at', null)" in campaigns),
    ('campanha inativa vermelha', 'campaign-inactive-v51' in campaigns),
    ('useRef do cabeçalho', 'stickyKanbanHeaderRef = useRef(null)' in text),
    ('faixa sticky fora do overflow', 'kanban-sticky-viewport-v51' in text and 'kanban-sticky-scope-v51' in text),
    ('sincronização horizontal', 'stickyKanbanHeaderRef.current.scrollLeft' in text),
    ('cabeçalho original oculto', '.sales-kanban-always-scroll .kanban-column > .kanban-column-head' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V51 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V51 aplicada: arquivamento seguro, INATIVO vermelho e cabeçalho real do funil congelado.')
