from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def component(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V53: componente não encontrado: {label}')
    return start, end, text[start:end]


# 1) Remove Qualificado das opções de status do funil.
qualified_label = "    qualified: 'Qualificado',\n"
if qualified_label not in text:
    raise SystemExit('V53: status Qualificado não encontrado.')
text = text.replace(qualified_label, '', 1)

# 2) Tela Envio passa a trabalhar apenas com Novo e Na fila.
start, end, sending = component(
    'function MessageSending({ organization, settings, userEmail }) {',
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'Envio'
)
old_sending_statuses = ".in('status', ['new','qualified','queued'])"
new_sending_statuses = ".in('status', ['new','queued'])"
if old_sending_statuses not in sending:
    raise SystemExit('V53: filtro de status da tela Envio não encontrado.')
sending = sending.replace(old_sending_statuses, new_sending_statuses, 1)
text = text[:start] + sending + text[end:]

# 3) Remove a coluna Qualificado e mantém Perdido como última coluna.
start, end, leads = component(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads'
)
old_order = "['new','qualified','contacted','replied','interested','proposal','won','lost']"
new_order = "['new','contacted','replied','interested','proposal','won','lost']"
if old_order not in leads:
    raise SystemExit('V53: ordem atual do funil não encontrada.')
leads = leads.replace(old_order, new_order, 1)
text = text[:start] + leads + text[end:]

# 4) Validações finais para impedir publicação parcial.
start, end, sending_check = component(
    'function MessageSending({ organization, settings, userEmail }) {',
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'Envio final'
)
start, end, leads_check = component(
    'function Leads({ organization, settings, userEmail }) {',
    'function Clients({ organization, userEmail, userId }) {',
    'Leads final'
)

checks = [
    ('Qualificado removido do seletor', "qualified: 'Qualificado'" not in leads_check),
    ('Qualificado removido do funil', "'qualified'" not in leads_check),
    ('Qualificado removido da tela Envio', "'qualified'" not in sending_check),
    ('ordem simplificada do funil', "['new','contacted','replied','interested','proposal','won','lost']" in leads_check),
    ('Perdido continua por último', "'won','lost']" in leads_check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V53 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V53 aplicada: etapa Qualificado removida; fluxo passa de Novo diretamente para Contatado.')
