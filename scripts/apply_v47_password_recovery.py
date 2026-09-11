from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

# 1) AuthScreen: forgot-password mode + 10-char password rule.
old_signup = """      if (mode === 'signup') {\n        if (form.password.length < 10) {\n          throw new Error('A senha precisa ter pelo menos 10 caracteres.')\n        }\n        const { error } = await supabase.auth.signUp({"""
new_signup = """      if (mode === 'forgot') {\n        const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim(), {\n          redirectTo: window.location.origin\n        })\n        if (error) throw error\n        setMessage('Se o e-mail estiver cadastrado, enviaremos um link para criar uma nova senha.')\n      } else if (mode === 'signup') {\n        if (form.password.length < 10) {\n          throw new Error('A senha precisa ter pelo menos 10 caracteres.')\n        }\n        const { error } = await supabase.auth.signUp({"""
if old_signup not in text:
    raise SystemExit('Fluxo de cadastro pós-V46 não encontrado para V47.')
text = text.replace(old_signup, new_signup, 1)

old_tabs = """          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Criar conta</button>\n        </div>\n\n        <form onSubmit={submit}>"""
new_tabs = """          <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setMessage('') }}>Criar conta</button>\n        </div>\n\n        {mode === 'forgot' && (\n          <div className=\"notice\">Informe seu e-mail. Você receberá um link seguro para criar uma nova senha.</div>\n        )}\n\n        <form onSubmit={submit}>"""
if old_tabs not in text:
    raise SystemExit('Abas de autenticação não encontradas para V47.')
text = text.replace(old_tabs, new_tabs, 1)

old_password = """          <label>\n            Senha\n            <input type=\"password\" minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder=\"Mínimo de 10 caracteres\" required />\n          </label>\n          <button className=\"primary full\" disabled={loading}>\n            {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : 'Criar conta'}\n          </button>\n        </form>"""
new_password = """          {mode !== 'forgot' && (\n            <label>\n              Senha\n              <input type=\"password\" minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder=\"Mínimo de 10 caracteres\" required />\n            </label>\n          )}\n          <button className=\"primary full\" disabled={loading}>\n            {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : mode === 'forgot' ? 'Enviar link de redefinição' : 'Criar conta'}\n          </button>\n          {mode === 'login' && (\n            <button type=\"button\" className=\"secondary full\" onClick={() => { setMode('forgot'); setMessage('') }}>\n              Esqueci minha senha\n            </button>\n          )}\n          {mode === 'forgot' && (\n            <button type=\"button\" className=\"secondary full\" onClick={() => { setMode('login'); setMessage('') }}>\n              Voltar para entrar\n            </button>\n          )}\n        </form>"""
if old_password not in text:
    raise SystemExit('Campo de senha pós-V46 não encontrado para V47.')
text = text.replace(old_password, new_password, 1)

# 2) Recovery screen shown when Supabase opens a recovery session.
anchor = "\nfunction Onboarding({ user, onCreated }) {"
reset_component = r'''

function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(e) {
    e.preventDefault()
    setMessage('')
    if (password.length < 10) {
      setMessage('A nova senha deve ter pelo menos 10 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setMessage('As senhas não conferem.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMessage(error.message || 'Não foi possível alterar a senha.')
      setLoading(false)
      return
    }

    await supabase.auth.signOut()
    setLoading(false)
    onDone()
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">CP</div>
        <h1>Criar nova senha</h1>
        <p className="muted">Defina uma nova senha para acessar o CRM.</p>
        <form onSubmit={submit}>
          <label>
            Nova senha
            <input type="password" minLength={10} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 10 caracteres" required />
          </label>
          <label>
            Confirmar nova senha
            <input type="password" minLength={10} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
          </label>
          <button className="primary full" disabled={loading}>{loading ? 'Salvando...' : 'Salvar nova senha'}</button>
        </form>
        {message && <div className="notice">{message}</div>}
      </section>
    </main>
  )
}
'''
if 'function ResetPasswordScreen(' not in text:
    if anchor not in text:
        raise SystemExit('Âncora para ResetPasswordScreen não encontrada.')
    text = text.replace(anchor, reset_component + anchor, 1)

# 3) System admin can send a recovery email to any user without knowing or setting their password.
old_delete = """  async function deleteUser(item) {\n    if (!window.confirm(`Excluir definitivamente o usuário ${item.email}?`)) return"""
new_delete = """  async function sendPasswordReset(item) {\n    setNotice('')\n    const { error } = await supabase.auth.resetPasswordForEmail(item.email, {\n      redirectTo: window.location.origin\n    })\n    setNotice(error ? (error.message || 'Não foi possível enviar o link.') : `Link de redefinição enviado para ${item.email}.`)\n  }\n\n  async function deleteUser(item) {\n    if (!window.confirm(`Excluir definitivamente o usuário ${item.email}?`)) return"""
if old_delete not in text:
    raise SystemExit('Função deleteUser não encontrada para V47.')
text = text.replace(old_delete, new_delete, 1)

old_action = """                <span>\n                  {!isSelf && (\n                    <button className=\"text-danger mini\" onClick={() => deleteUser(item)}>\n                      Excluir\n                    </button>\n                  )}\n                </span>"""
new_action = """                <span className=\"row-actions\">\n                  <button className=\"secondary mini\" onClick={() => sendPasswordReset(item)}>\n                    Redefinir senha\n                  </button>\n                  {!isSelf && (\n                    <button className=\"text-danger mini\" onClick={() => deleteUser(item)}>\n                      Excluir\n                    </button>\n                  )}\n                </span>"""
if old_action not in text:
    raise SystemExit('Ações do usuário não encontradas para V47.')
text = text.replace(old_action, new_action, 1)

# 4) App detects PASSWORD_RECOVERY before rendering normal application access.
old_state = """  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)\n\n  useEffect(() => {"""
new_state = """  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)\n  const [passwordRecovery, setPasswordRecovery] = useState(false)\n\n  useEffect(() => {"""
if old_state not in text:
    raise SystemExit('Estado principal do App não encontrado para V47.')
text = text.replace(old_state, new_state, 1)

old_listener = """    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {\n      setSession(newSession)\n    })"""
new_listener = """    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {\n      setSession(newSession)\n      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)\n    })"""
if old_listener not in text:
    raise SystemExit('Listener de autenticação não encontrado para V47.')
text = text.replace(old_listener, new_listener, 1)

old_render = """  if (loading || (session && accessLoading)) {\n    return <div className=\"loading-screen\">Carregando...</div>\n  }\n\n  if (!session) return <AuthScreen />"""
new_render = """  if (loading || (session && accessLoading && !passwordRecovery)) {\n    return <div className=\"loading-screen\">Carregando...</div>\n  }\n\n  if (passwordRecovery && session) {\n    return <ResetPasswordScreen onDone={() => setPasswordRecovery(false)} />\n  }\n\n  if (!session) return <AuthScreen />"""
if old_render not in text:
    raise SystemExit('Renderização principal do App não encontrada para V47.')
text = text.replace(old_render, new_render, 1)

checks = {
    'forgot mode': "mode === 'forgot'" in text,
    'reset email': 'resetPasswordForEmail' in text,
    'recovery screen': 'function ResetPasswordScreen' in text,
    'recovery event': "event === 'PASSWORD_RECOVERY'" in text,
    'admin reset': 'Redefinir senha' in text,
    'password length': 'minLength={10}' in text,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('V47 validação falhou: ' + ', '.join(failed))

APP.write_text(text, encoding='utf-8')
print('V47 aplicada: recuperação e redefinição segura de senha.')
