from pathlib import Path

APP = Path('src/App.jsx')
CSS = Path('src/styles.css')
text = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')

start = text.find('function ManualLeadRegistration({ organization, settings, userEmail, userId }) {')
end = text.find('function NotInterestedRepository({ organization, userEmail }) {', start)
if start < 0 or end < 0:
    raise SystemExit('V68: componente de cadastro manual não encontrado.')

manual = text[start:end]

# -----------------------------------------------------------------------------
# 1) Cadastro manual: acrescenta Origem comercial ao lado de Público-alvo.
# -----------------------------------------------------------------------------
form_marker = "    capture_notes: '',\n    target_segment_id: ''\n  })"
if form_marker not in manual:
    raise SystemExit('V68: estado do formulário após V66 não encontrado.')
manual = manual.replace(
    form_marker,
    "    capture_notes: '',\n    target_segment_id: '',\n    customer_origin: ''\n  })",
    1
)

insert_marker = "      target_segment_id: form.target_segment_id || null,\n"
if insert_marker not in manual:
    raise SystemExit('V68: target_segment_id no insert não encontrado.')
manual = manual.replace(
    insert_marker,
    insert_marker + "      customer_origin: form.customer_origin || null,\n",
    1
)

reset_marker = "        capture_notes: '',\n        target_segment_id: ''\n      }))"
if reset_marker not in manual:
    raise SystemExit('V68: reset do formulário não encontrado.')
manual = manual.replace(
    reset_marker,
    "        capture_notes: '',\n        target_segment_id: '',\n        customer_origin: ''\n      }))",
    1
)

old_ui = r'''          <label>
            Público-alvo <span className="muted">(opcional)</span>
            <select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})}>
              <option value="">Não informar</option>
              {targetSegments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
            </select>
          </label>
          <label>Site<input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} /></label>'''

new_ui = r'''          <div className="field-grid manual-target-origin-v68">
            <label>
              <span className="field-label-inline-v68">
                <span>Público-alvo</span>
                <span className="muted">(opcional)</span>
              </span>
              <select value={form.target_segment_id} onChange={e=>setForm({...form,target_segment_id:e.target.value})}>
                <option value="">Não informar</option>
                {targetSegments.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
              </select>
            </label>
            <label>
              Origem
              <select value={form.customer_origin} onChange={e=>setForm({...form,customer_origin:e.target.value})} required>
                <option value="">Selecione</option>
                <option value="Base">Base</option>
                <option value="Captação ativa">Captação ativa</option>
                <option value="Recomendação">Recomendação</option>
                <option value="Redes sociais">Redes sociais</option>
                <option value="Google">Google</option>
              </select>
            </label>
          </div>
          <label>Site<input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} /></label>'''

if old_ui not in manual:
    raise SystemExit('V68: bloco Público-alvo da V66 não encontrado.')
manual = manual.replace(old_ui, new_ui, 1)

text = text[:start] + manual + text[end:]

# -----------------------------------------------------------------------------
# 2) Ajustes visuais: "Na fila" e rótulo Público-alvo (opcional) sem quebra.
# -----------------------------------------------------------------------------
css += r'''

/* V68 - cadastro manual e status de envio */
.template-status {
  white-space: nowrap !important;
  width: auto !important;
  min-width: max-content;
  display: inline-flex;
  align-items: center;
}
.field-label-inline-v68 {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  white-space: nowrap;
}
.field-label-inline-v68 .muted {
  font-weight: 600;
}
.manual-target-origin-v68 > label {
  min-width: 0;
}
@media (max-width: 620px) {
  .field-label-inline-v68 {
    white-space: normal;
  }
}
'''

# -----------------------------------------------------------------------------
# 3) Validações.
# -----------------------------------------------------------------------------
start = text.find('function ManualLeadRegistration({ organization, settings, userEmail, userId }) {')
end = text.find('function NotInterestedRepository({ organization, userEmail }) {', start)
check = text[start:end]
checks = [
    ('público-alvo continua opcional', '<option value="">Não informar</option>' in check and 'target_segment_id: form.target_segment_id || null' in check),
    ('opcional na mesma linha', 'field-label-inline-v68' in check and '<span>Público-alvo</span>' in check),
    ('origem adicionada', 'customer_origin: form.customer_origin || null' in check),
    ('origem ao lado do público', 'manual-target-origin-v68' in check),
    ('opção Base', '<option value="Base">Base</option>' in check),
    ('opção Captação ativa', '<option value="Captação ativa">Captação ativa</option>' in check),
    ('opção Recomendação', '<option value="Recomendação">Recomendação</option>' in check),
    ('opção Redes sociais', '<option value="Redes sociais">Redes sociais</option>' in check),
    ('opção Google', '<option value="Google">Google</option>' in check),
    ('lead manual preservado', "source: 'manual'" in check),
    ('público automático preservado', 'targetSegments.map' in check),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V68 falhou: ' + '; '.join(failed))

APP.write_text(text, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
print('V68 aplicada: Na fila sem quebra, Público-alvo (opcional) na mesma linha, Origem adicionada ao cadastro manual.')
