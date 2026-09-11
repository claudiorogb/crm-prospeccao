from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

start = text.find('function ManualLeadRegistration({ organization, settings, userEmail, userId }) {')
end = text.find('function NotInterestedRepository({ organization, userEmail }) {', start)
if start < 0 or end < 0:
    raise SystemExit('V66: componente de cadastro manual não encontrado.')

manual = text[start:end]

# 1) Lista de públicos-alvo disponíveis para associação opcional.
state_marker = "  const [message, setMessage] = useState('')\n"
if state_marker not in manual:
    raise SystemExit('V66: estado message não encontrado.')
manual = manual.replace(
    state_marker,
    state_marker + "  const [targetSegments, setTargetSegments] = useState([])\n",
    1
)

form_marker = "    capture_notes: ''\n  })"
if form_marker not in manual:
    raise SystemExit('V66: formulário do cadastro manual não encontrado.')
manual = manual.replace(
    form_marker,
    "    capture_notes: '',\n    target_segment_id: ''\n  })",
    1
)

profile_effect_marker = "  useEffect(() => {\n    let active = true\n    if (!userId) return undefined"
if profile_effect_marker not in manual:
    raise SystemExit('V66: useEffect do captador não encontrado.')
segments_effect = r'''  useEffect(() => {
    let active = true
    supabase
      .from('target_segments')
      .select('id,name')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (active) setTargetSegments(data || [])
      })
    return () => { active = false }
  }, [organization.id])

'''
manual = manual.replace(profile_effect_marker, segments_effect + profile_effect_marker, 1)

# 2) O público-alvo é opcional. Sem seleção, mantém o comportamento atual.
save_marker = "    setLoading(true)\n    setMessage('')\n\n    const { error } = await supabase.from('leads').insert({"
if save_marker not in manual:
    raise SystemExit('V66: início do saveLead não encontrado.')
manual = manual.replace(
    save_marker,
    "    setLoading(true)\n    setMessage('')\n\n    const selectedTarget = targetSegments.find(item => item.id === form.target_segment_id)\n\n    const { error } = await supabase.from('leads').insert({",
    1
)

segment_marker = "      segment: 'Cadastro manual',\n"
if segment_marker not in manual:
    raise SystemExit('V66: segment padrão da V56 não encontrado.')
manual = manual.replace(
    segment_marker,
    "      segment: selectedTarget?.name || 'Cadastro manual',\n      target_segment_id: form.target_segment_id || null,\n",
    1
)

reset_marker = "        capture_notes: ''\n      }))"
if reset_marker not in manual:
    raise SystemExit('V66: reset do formulário não encontrado.')
manual = manual.replace(
    reset_marker,
    "        capture_notes: '',\n        target_segment_id: ''\n      }))",
    1
)

# 3) Comunicação e campo visual opcional.
manual = manual.replace(
    '<p className="muted">Cadastro manual independente de público-alvo ou campanha.</p>',
    '<p className="muted">Cadastre o lead manualmente. O público-alvo é opcional e permite usar a mensagem automática correspondente.</p>',
    1
)

ui_marker = r'''          <div className="field-grid">
            <label>Telefone / WhatsApp<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></label>
            <label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></label>
          </div>
          <label>Site<input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} /></label>'''
ui_replacement = r'''          <div className="field-grid">
            <label>Telefone / WhatsApp<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></label>
            <label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></label>
          </div>
          <label>
            Público-alvo <span className="muted">(opcional)</span>
            <select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})}>
              <option value="">Não informar</option>
              {targetSegments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
            </select>
          </label>
          <label>Site<input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} /></label>'''
if ui_marker not in manual:
    raise SystemExit('V66: posição do campo Público-alvo não encontrada.')
manual = manual.replace(ui_marker, ui_replacement, 1)

text = text[:start] + manual + text[end:]

# Validações para não transformar o campo em obrigatório nem afetar outras áreas.
start = text.find('function ManualLeadRegistration({ organization, settings, userEmail, userId }) {')
end = text.find('function NotInterestedRepository({ organization, userEmail }) {', start)
check = text[start:end]
checks = [
    ('lista públicos ativos', ".from('target_segments')" in check and ".eq('is_active', true)" in check),
    ('campo público opcional', 'Público-alvo' in check and '<option value="">Não informar</option>' in check),
    ('select não obrigatório', 'target_segment_id:e.target.value})} required' not in check),
    ('target opcional no banco', 'target_segment_id: form.target_segment_id || null' in check),
    ('segment NOT NULL preservado', "segment: selectedTarget?.name || 'Cadastro manual'" in check),
    ('lead continua novo', "status: 'new'" in check),
    ('origem manual preservada', "source: 'manual'" in check),
    ('captador preservado', 'captured_by: userId' in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V66 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V66 aplicada: cadastro manual permite Público-alvo opcional sem bloquear criação do lead.')
