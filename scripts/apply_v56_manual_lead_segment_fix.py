from pathlib import Path

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

start = text.find('function ManualLeadRegistration(')
end = text.find('function NotInterestedRepository', start)
if start < 0 or end < 0:
    raise SystemExit('V56: componente de cadastro manual não encontrado.')

manual = text[start:end]

old_insert = """    const { error } = await supabase.from('leads').insert({\n      organization_id: organization.id,\n      business_name: form.business_name.trim(),"""
new_insert = """    const { error } = await supabase.from('leads').insert({\n      organization_id: organization.id,\n      segment: 'Cadastro manual',\n      business_name: form.business_name.trim(),"""

if old_insert not in manual:
    raise SystemExit('V56: ponto de inserção do lead manual não encontrado.')

manual = manual.replace(old_insert, new_insert, 1)

if "segment: 'Cadastro manual'" not in manual:
    raise SystemExit('V56: validação falhou; segment obrigatório não foi incluído.')

text = text[:start] + manual + text[end:]
APP.write_text(text, encoding='utf-8')
print('V56 aplicada: cadastro manual grava segment=Cadastro manual e respeita a restrição NOT NULL.')
