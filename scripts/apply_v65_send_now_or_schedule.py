from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def component(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V65: componente não encontrado: {label}')
    return start, end, text[start:end]


start, end, sending = component(
    'function MessageSending({ organization, settings, userEmail }) {',
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'MessageSending'
)

# Relógio local da regra de envio. Recalcula o estado da janela sem depender
# do relógio/locale do navegador do usuário.
state_marker = "  const [message, setMessage] = useState('')\n"
if state_marker not in sending:
    raise SystemExit('V65: estado message não encontrado.')
sending = sending.replace(
    state_marker,
    state_marker + "  const [scheduleClock, setScheduleClock] = useState(Date.now())\n",
    1
)

# Atualiza o botão quando a janela abre/fecha enquanto a tela permanece aberta.
load_effect_marker = "  const queuedLeadIds = new Set(\n"
if load_effect_marker not in sending:
    raise SystemExit('V65: marcador após useEffect de carregamento não encontrado.')
clock_effect = r'''  useEffect(() => {
    const timer = setInterval(() => setScheduleClock(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

'''
sending = sending.replace(load_effect_marker, clock_effect + load_effect_marker, 1)

# Calcula dia/hora sempre em America/Sao_Paulo, que é a mesma referência
# usada pelo backend/worker atualmente.
all_selected_marker = "  const allSelectableSelected = selectableLeads.length > 0 && selectableLeads.every(lead => selected.has(lead.id))\n"
if all_selected_marker not in sending:
    raise SystemExit('V65: marcador allSelectableSelected não encontrado.')
schedule_logic = r'''  const allSelectableSelected = selectableLeads.length > 0 && selectableLeads.every(lead => selected.has(lead.id))

  function hhmmToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
    if (!match) return null
    return Number(match[1]) * 60 + Number(match[2])
  }

  const scheduleNow = new Date(scheduleClock)
  const weekdayToken = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short'
  }).format(scheduleNow)
  const weekdayNumber = ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[weekdayToken]
  const currentBrazilTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(scheduleNow)
  const currentMinutes = hhmmToMinutes(currentBrazilTime)
  const startMinutes = hhmmToMinutes(sendConfig.start)
  const endMinutes = hhmmToMinutes(sendConfig.end)
  const allowedToday = (sendConfig.days || []).map(Number).includes(weekdayNumber)
  const insideSendWindow = Boolean(
    allowedToday &&
    currentMinutes != null &&
    startMinutes != null &&
    endMinutes != null &&
    currentMinutes >= startMinutes &&
    currentMinutes <= endMinutes
  )
  const sendActionLabel = insideSendWindow ? 'Enviar mensagem' : 'Agendar mensagens'
'''
sending = sending.replace(all_selected_marker, schedule_logic, 1)

# Mensagem após o backend: distingue processamento imediato de agendamento.
old_success = r'''      const first = data?.first_scheduled_for ? new Date(data.first_scheduled_for).toLocaleString('pt-BR') : '—'
      const last = data?.last_scheduled_for ? new Date(data.last_scheduled_for).toLocaleString('pt-BR') : '—'
      const ignoredText = ignored > 0 ? ` ${ignored} lead(s) não foram agendados por falta de dados necessários.` : ''
      setMessage(`${data?.queued || 0} mensagem(ns) agendada(s). Primeiro envio: ${first}. Último envio: ${last}.${ignoredText}`)'''
new_success = r'''      const firstScheduled = data?.first_scheduled_for ? new Date(data.first_scheduled_for) : null
      const lastScheduled = data?.last_scheduled_for ? new Date(data.last_scheduled_for) : null
      const first = firstScheduled ? firstScheduled.toLocaleString('pt-BR') : '—'
      const last = lastScheduled ? lastScheduled.toLocaleString('pt-BR') : '—'
      const immediate = Boolean(
        insideSendWindow &&
        firstScheduled &&
        firstScheduled.getTime() <= Date.now() + 90000
      )
      const ignoredText = ignored > 0 ? ` ${ignored} lead(s) não foram incluídos por falta de telefone ou mensagem cadastrada para o público-alvo.` : ''
      setMessage(
        immediate
          ? `${data?.queued || 0} mensagem(ns) encaminhada(s) para envio. O processamento é automático.${ignoredText}`
          : `${data?.queued || 0} mensagem(ns) agendada(s). Primeiro envio: ${first}. Último envio: ${last}.${ignoredText}`
      )'''
if old_success not in sending:
    raise SystemExit('V65: mensagem de sucesso do envio não encontrada.')
sending = sending.replace(old_success, new_success, 1)

# Botão: envia dentro da janela; agenda fora dela.
old_button = r'''          <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}>
            <Send size={16}/>{loading ? 'Processando...' : 'Agendar mensagens'}
          </button>'''
new_button = r'''          <button className="primary inline-btn" onClick={send} disabled={!selected.size || loading}>
            <Send size={16}/>{loading ? 'Processando...' : sendActionLabel}
          </button>'''
if old_button not in sending:
    raise SystemExit('V65: botão Agendar mensagens não encontrado.')
sending = sending.replace(old_button, new_button, 1)

# Expõe claramente quando um lead não tem mensagem/modelo cadastrado. Isso evita
# parecer que o horário bloqueou um envio que na verdade não era elegível.
old_status = r'''              {(isQueued || canSend || !hasPhone) && (
                <span className={isQueued ? 'template-status queued' : canSend ? 'template-status active' : 'template-status inactive'}>
                  {isQueued ? 'Na fila' : canSend ? 'Apto' : 'Sem telefone'}
                </span>
              )}'''
new_status = r'''              <span className={isQueued ? 'template-status queued' : canSend ? 'template-status active' : 'template-status inactive'}>
                {isQueued ? 'Na fila' : canSend ? 'Apto' : !hasPhone ? 'Sem telefone' : 'Sem mensagem'}
              </span>'''
if old_status not in sending:
    raise SystemExit('V65: status de aptidão do lead não encontrado.')
sending = sending.replace(old_status, new_status, 1)

text = text[:start] + sending + text[end:]

# Validações para evitar regressões nas funções já existentes.
start, end, check = component(
    'function MessageSending({ organization, settings, userEmail }) {',
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'MessageSending final'
)
checks = [
    ('botão dinâmico', "sendActionLabel = insideSendWindow ? 'Enviar mensagem' : 'Agendar mensagens'" in check),
    ('timezone do backend preservado', "timeZone: 'America/Sao_Paulo'" in check),
    ('dias configurados respeitados', 'allowedToday' in check and 'sendConfig.days' in check),
    ('horários configurados respeitados', 'startMinutes' in check and 'endMinutes' in check),
    ('agendamento backend preservado', "enqueue_whatsapp_messages" in check),
    ('seleção/descarte preservados', 'discardSelected' in check),
    ('motivo sem mensagem visível', "'Sem mensagem'" in check),
    ('janela somente leitura preservada', 'schedule-readonly-fields-v63' in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V65 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V65 aplicada: botão Enviar/Agendar acompanha a janela configurada; fora da janela permanece na fila para a próxima janela.')
