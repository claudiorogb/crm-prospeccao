from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')


def component(start_marker, end_marker, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f'V63: componente não encontrado: {label}')
    return start, end, text[start:end]


# -----------------------------------------------------------------------------
# 1) PAINEL DO USUÁRIO / ENVIO: horário passa a ser somente leitura.
# -----------------------------------------------------------------------------
start, end, sending = component(
    'function MessageSending({ organization, settings, userEmail }) {',
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'MessageSending'
)

saving_state = "  const [savingWindow, setSavingWindow] = useState(false)\n"
if saving_state not in sending:
    raise SystemExit('V63: estado savingWindow não encontrado.')
sending = sending.replace(saving_state, '', 1)

save_start = sending.find('  async function saveScheduleWindow() {')
save_end = sending.find('  async function discardSelected() {', save_start)
if save_start < 0 or save_end < 0:
    # Em versões sem descarte, send() é o próximo marcador.
    save_end = sending.find('  async function send() {', save_start)
if save_start < 0 or save_end < 0:
    raise SystemExit('V63: função saveScheduleWindow não encontrada.')
sending = sending[:save_start] + sending[save_end:]

marker = "  const allSelectableSelected = selectableLeads.length > 0 && selectableLeads.every(lead => selected.has(lead.id))\n"
if marker not in sending:
    raise SystemExit('V63: marcador para rótulo dos dias não encontrado.')
labels = r'''  const allSelectableSelected = selectableLeads.length > 0 && selectableLeads.every(lead => selected.has(lead.id))

  const sendDayNames = {
    0: 'Domingo',
    1: 'Segunda',
    2: 'Terça',
    3: 'Quarta',
    4: 'Quinta',
    5: 'Sexta',
    6: 'Sábado'
  }
  const sendDaysLabel = (sendConfig.days || [])
    .map(day => sendDayNames[Number(day)])
    .filter(Boolean)
    .join(', ') || 'Nenhum dia configurado'
'''
sending = sending.replace(marker, labels, 1)

old_panel = r'''      <section className="panel whatsapp-schedule-v43">
        <div>
          <span className="eyebrow">PROGRAMAÇÃO AUTOMÁTICA</span>
          <h2>Janela de envio</h2>
          <p className="muted">Segunda, quarta e sexta • até {sendConfig.dailyLimit} mensagens por dia • intervalo de {sendConfig.intervalSeconds} segundos.</p>
        </div>
        <div className="schedule-fields-v43">
          <label>Início
            <input type="time" value={sendConfig.start} onChange={e => setSendConfig(old => ({...old, start:e.target.value}))} />
          </label>
          <label>Fim
            <input type="time" value={sendConfig.end} onChange={e => setSendConfig(old => ({...old, end:e.target.value}))} />
          </label>
          <button type="button" className="secondary inline-btn" onClick={saveScheduleWindow} disabled={savingWindow}>
            {savingWindow ? 'Salvando...' : 'Salvar horário'}
          </button>
        </div>
      </section>'''

new_panel = r'''      <section className="panel whatsapp-schedule-v43 schedule-readonly-v63">
        <div>
          <span className="eyebrow">PROGRAMAÇÃO AUTOMÁTICA</span>
          <h2>Janela de envio</h2>
          <p className="muted">{sendDaysLabel} • até {sendConfig.dailyLimit} mensagens por dia • intervalo de {sendConfig.intervalSeconds} segundos.</p>
        </div>
        <div className="schedule-readonly-fields-v63" aria-label="Horário definido pelo administrador">
          <div>
            <span>Início</span>
            <strong>{sendConfig.start}</strong>
          </div>
          <div>
            <span>Fim</span>
            <strong>{sendConfig.end}</strong>
          </div>
        </div>
      </section>'''

if old_panel not in sending:
    raise SystemExit('V63: painel editável da janela de envio não encontrado.')
sending = sending.replace(old_panel, new_panel, 1)
text = text[:start] + sending + text[end:]


# -----------------------------------------------------------------------------
# 2) ADMIN / WHATSAPP: administrador controla dias, horários, limite e intervalo.
# -----------------------------------------------------------------------------
start, end, admin = component(
    'function AdminWhatsApp({ organizations, userEmail, userMode = false }) {',
    'function AdminQueue({ organizations }) {',
    'AdminWhatsApp'
)

old_save_head = r'''  async function saveSettings() {
    if (!settings) return
    const payload = {
      whatsapp_send_interval_seconds: Math.max(1, Number(settings.whatsapp_send_interval_seconds || 120)),
      whatsapp_batch_limit: Math.max(1, Number(settings.whatsapp_batch_limit || 20)),
      whatsapp_daily_send_limit:
        settings.whatsapp_daily_send_limit === '' || settings.whatsapp_daily_send_limit == null
          ? null
          : Math.max(1, Number(settings.whatsapp_daily_send_limit)),
      whatsapp_sending_paused: Boolean(settings.whatsapp_sending_paused)
    }'''

new_save_head = r'''  async function saveSettings() {
    if (!settings) return

    const allowedStart = String(settings.allowed_send_start || '08:00').slice(0, 5)
    const allowedEnd = String(settings.allowed_send_end || '18:00').slice(0, 5)
    const cadenceDays = (Array.isArray(settings.default_cadence_days) && settings.default_cadence_days.length
      ? settings.default_cadence_days
      : [1, 3, 5]
    ).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort((a, b) => a - b)

    if (!allowedStart || !allowedEnd || allowedStart >= allowedEnd) {
      setMessage('O horário inicial precisa ser anterior ao horário final.')
      return
    }
    if (!cadenceDays.length) {
      setMessage('Selecione pelo menos um dia de envio.')
      return
    }

    const payload = {
      whatsapp_send_interval_seconds: Math.max(1, Number(settings.whatsapp_send_interval_seconds || 120)),
      whatsapp_batch_limit: Math.max(1, Number(settings.whatsapp_batch_limit || 20)),
      whatsapp_daily_send_limit:
        settings.whatsapp_daily_send_limit === '' || settings.whatsapp_daily_send_limit == null
          ? null
          : Math.max(1, Number(settings.whatsapp_daily_send_limit)),
      whatsapp_sending_paused: Boolean(settings.whatsapp_sending_paused),
      allowed_send_start: allowedStart,
      allowed_send_end: allowedEnd,
      default_cadence_days: cadenceDays
    }'''

if old_save_head not in admin:
    raise SystemExit('V63: saveSettings do WhatsApp não encontrado.')
admin = admin.replace(old_save_head, new_save_head, 1)

form_marker = r'''          {settings && (
            <div className="campaign-form">
              <div className="field-grid">
                <label>
                  Intervalo entre mensagens (s)'''

schedule_admin = r'''          {settings && (
            <div className="campaign-form">
              <div className="admin-send-window-v63">
                <span className="eyebrow">PROGRAMAÇÃO AUTOMÁTICA</span>
                <h3>Janela de envio</h3>

                <div className="field-grid">
                  <label>
                    Início
                    <input
                      type="time"
                      value={String(settings.allowed_send_start || '08:00').slice(0, 5)}
                      onChange={e => setSettings({...settings, allowed_send_start: e.target.value})}
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      type="time"
                      value={String(settings.allowed_send_end || '18:00').slice(0, 5)}
                      onChange={e => setSettings({...settings, allowed_send_end: e.target.value})}
                    />
                  </label>
                </div>

                <div>
                  <strong className="admin-days-title-v63">Dias de envio</strong>
                  <div className="admin-days-v63">
                    {[
                      [1, 'Segunda'],
                      [2, 'Terça'],
                      [3, 'Quarta'],
                      [4, 'Quinta'],
                      [5, 'Sexta'],
                      [6, 'Sábado'],
                      [0, 'Domingo']
                    ].map(([day, label]) => {
                      const currentDays = (Array.isArray(settings.default_cadence_days) && settings.default_cadence_days.length
                        ? settings.default_cadence_days
                        : [1, 3, 5]).map(Number)
                      return (
                        <label className="admin-day-option-v63" key={day}>
                          <input
                            type="checkbox"
                            checked={currentDays.includes(day)}
                            onChange={e => {
                              const nextDays = e.target.checked
                                ? [...new Set([...currentDays, day])].sort((a, b) => a - b)
                                : currentDays.filter(value => value !== day)
                              setSettings({...settings, default_cadence_days: nextDays})
                            }}
                          />
                          {label}
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="field-grid">
                <label>
                  Intervalo entre mensagens (s)'''

if form_marker not in admin:
    raise SystemExit('V63: formulário de regras de envio do administrador não encontrado.')
admin = admin.replace(form_marker, schedule_admin, 1)

summary_old = r'''                <strong>Enviadas hoje:</strong> {sentToday}<br/>
                <strong>Intervalo padrão:</strong> {settings.whatsapp_send_interval_seconds || 120}s<br/>
                <strong>Máximo por lote:</strong> {settings.whatsapp_batch_limit || 20}'''
summary_new = r'''                <strong>Enviadas hoje:</strong> {sentToday}<br/>
                <strong>Janela:</strong> {String(settings.allowed_send_start || '08:00').slice(0, 5)} às {String(settings.allowed_send_end || '18:00').slice(0, 5)}<br/>
                <strong>Limite diário:</strong> {settings.whatsapp_daily_send_limit || 20}<br/>
                <strong>Intervalo padrão:</strong> {settings.whatsapp_send_interval_seconds || 120}s<br/>
                <strong>Máximo por lote:</strong> {settings.whatsapp_batch_limit || 20}'''
if summary_old not in admin:
    raise SystemExit('V63: resumo das regras do administrador não encontrado.')
admin = admin.replace(summary_old, summary_new, 1)

text = text[:start] + admin + text[end:]


# -----------------------------------------------------------------------------
# 3) CSS: leitura fixa no usuário e edição clara no administrador.
# -----------------------------------------------------------------------------
css += r'''

/* V63 - janela de envio controlada pelo administrador */
.schedule-readonly-fields-v63 {
  display: flex;
  align-items: stretch;
  gap: 10px;
  flex: 0 0 auto;
}
.schedule-readonly-fields-v63 > div {
  min-width: 132px;
  min-height: 62px;
  padding: 9px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}
.schedule-readonly-fields-v63 span {
  font-size: 12px;
  color: #64748b;
  font-weight: 700;
}
.schedule-readonly-fields-v63 strong {
  font-size: 17px;
  color: #0f172a;
}
.admin-send-window-v63 {
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
  display: grid;
  gap: 12px;
}
.admin-send-window-v63 h3 {
  margin: 2px 0 0;
}
.admin-days-title-v63 {
  display: block;
  margin-bottom: 7px;
  font-size: 13px;
}
.admin-days-v63 {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.admin-day-option-v63 {
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  width: auto !important;
  margin: 0 !important;
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  font-size: 12px;
  font-weight: 600;
}
.admin-day-option-v63 input {
  width: auto !important;
  margin: 0;
}
@media (max-width: 700px) {
  .schedule-readonly-fields-v63 {
    width: 100%;
  }
  .schedule-readonly-fields-v63 > div {
    flex: 1 1 0;
    min-width: 0;
  }
}
'''


# -----------------------------------------------------------------------------
# 4) Validações para não afetar demais recursos.
# -----------------------------------------------------------------------------
start, end, sending_check = component(
    'function MessageSending({ organization, settings, userEmail }) {',
    'function CampaignWorkspace({ organization, settings, userEmail }) {',
    'MessageSending final'
)
start, end, admin_check = component(
    'function AdminWhatsApp({ organizations, userEmail, userMode = false }) {',
    'function AdminQueue({ organizations }) {',
    'AdminWhatsApp final'
)

checks = [
    ('usuário sem edição de horário', 'saveScheduleWindow' not in sending_check and 'schedule-readonly-fields-v63' in sending_check),
    ('usuário sem botão Salvar horário', 'Salvar horário' not in sending_check),
    ('usuário lê configuração do banco', 'allowed_send_start,allowed_send_end,default_cadence_days' in sending_check),
    ('admin altera horários', 'allowed_send_start: allowedStart' in admin_check and 'allowed_send_end: allowedEnd' in admin_check),
    ('admin altera dias', 'default_cadence_days: cadenceDays' in admin_check and 'admin-days-v63' in admin_check),
    ('admin mantém intervalo', 'whatsapp_send_interval_seconds' in admin_check),
    ('admin mantém limite diário', 'whatsapp_daily_send_limit' in admin_check),
    ('admin mantém pausa global', 'whatsapp_sending_paused' in admin_check),
    ('cadastro de números preservado', 'async function addNumber' in admin_check),
    ('Evolution preservada', "evolutionAction('create_instance'" in admin_check),
    ('envio preservado', "enqueue_whatsapp_messages" in sending_check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V63 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V63 aplicada: administrador controla janela/dias/limites; usuário visualiza horários sem editar.')
