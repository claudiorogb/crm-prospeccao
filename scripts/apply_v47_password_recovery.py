from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

# 1) AuthScreen: forgot-password mode + 10-char password rule.
text = text.replace(
"""      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({""",
"""      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim(), {
          redirectTo: window.location.origin
        })
        if (error) throw error
        setMessage('Se o e-mail estiver cadastrado, enviaremos um link para criar uma nova senha.')
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({"""
)

text = text.replace(
"""          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Criar conta</button>
        </div>

        <form onSubmit={submit}>""",
"""          <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setMessage('') }}>Criar conta</button>
        </div>

        {mode === 'forgot' && (
          <div className=\"notice\">Informe seu e-mail. Você receberá um link seguro para criar uma nova senha.</div>
        )}

        <form onSubmit={submit}>"""
)

text = text.replace(
"""          <label>
            Senha
            <input type=\"password\" minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder=\"Mínimo de 6 caracteres\" required />
          </label>
          <button className=\"primary full\" disabled={loading}>
            {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>""",
"""          {mode !== 'forgot' && (
            <label>
              Senha
              <input type=\"password\" minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder=\"Mínimo de 10 caracteres\" required />
            </label>
          )}
          <button className=\"primary full\" disabled={loading}>
            {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : mode === 'forgot' ? 'Enviar link de redefinição' : 'Criar conta'}
          </button>
          {mode === 'login' && (
            <button type=\"button\" className=\"secondary full\" onClick={() => { setMode('forgot'); setMessage('') }}>
              Esqueci minha senha
            </button>
          )}
          {mode === 'forgot' && (
            <button type=\"button\" className=\"secondary full\" onClick={() => { setMode('login'); setMessage('') }}>
              Voltar para entrar
            </button>
          )}
        </form>"""
)

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

    setMessage('Senha alterada com sucesso. Você poderá entrar com a nova senha.')
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
    text = text.replace(anchor, reset_component + anchor)

# 3) System admin can send a recovery email to any user without knowing or setting their password.
text = text.replace(
"""  async function deleteUser(item) {
    if (!window.confirm(`Excluir definitivamente o usuário ${item.email}?`)) return""",
"""  async function sendPasswordReset(item) {
    setNotice('')
    const { error } = await supabase.auth.resetPasswordForEmail(item.email, {
      redirectTo: window.location.origin
    })
    setNotice(error ? (error.message || 'Não foi possível enviar o link.') : `Link de redefinição enviado para ${item.email}.`)
  }

  async function deleteUser(item) {
    if (!window.confirm(`Excluir definitivamente o usuário ${item.email}?`)) return"""
)

text = text.replace(
"""                <span>
                  {!isSelf && (
                    <button className=\"text-danger mini\" onClick={() => deleteUser(item)}>
                      Excluir
                    </button>
                  )}
                </span>""",
"""                <span className=\"row-actions\">
                  <button className=\"secondary mini\" onClick={() => sendPasswordReset(item)}>
                    Redefinir senha
                  </button>
                  {!isSelf && (
                    <button className=\"text-danger mini\" onClick={() => deleteUser(item)}>
                      Excluir
                    </button>
                  )}
                </span>"""
)

# 4) App detects PASSWORD_RECOVERY before rendering normal application access.
text = text.replace(
"""  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {""",
"""  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {"""
)

text = text.replace(
"""    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })""",
"""    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })"""
)

text = text.replace(
"""  if (loading || (session && accessLoading)) {
    return <div className=\"loading-screen\">Carregando...</div>
  }

  if (!session) return <AuthScreen />""",
"""  if (loading || (session && accessLoading && !passwordRecovery)) {
    return <div className=\"loading-screen\">Carregando...</div>
  }

  if (passwordRecovery && session) {
    return <ResetPasswordScreen onDone={() => setPasswordRecovery(false)} />
  }

  if (!session) return <AuthScreen />"""
)

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
