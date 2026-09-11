from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

old = '''            <input type="password" minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mínimo de 6 caracteres" required />'''
new = '''            <input type="password" minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mínimo de 10 caracteres" required />'''

if old not in text:
    raise SystemExit('Campo de senha esperado não encontrado para V46.')

text = text.replace(old, new, 1)

needle = """      if (mode === 'signup') {\n        const { error } = await supabase.auth.signUp({"""
replacement = """      if (mode === 'signup') {\n        if (form.password.length < 10) {\n          throw new Error('A senha precisa ter pelo menos 10 caracteres.')\n        }\n        const { error } = await supabase.auth.signUp({"""
if needle not in text:
    raise SystemExit('Fluxo de cadastro esperado não encontrado para V46.')
text = text.replace(needle, replacement, 1)

APP.write_text(text, encoding='utf-8')
print('V46 aplicada: requisito mínimo de senha elevado para 10 caracteres no cadastro.')
