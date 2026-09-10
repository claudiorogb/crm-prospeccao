from pathlib import Path
import re

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

start = text.find('function Leads({ organization, settings, userEmail }) {')
end = text.find('function Clients({ organization, userEmail, userId }) {', start)
if start < 0 or end < 0:
    raise SystemExit('Componente Leads não encontrado.')

leads = text[start:end]

# Remove SOMENTE o botão Excluir do card do funil.
# A função deleteLead pode permanecer sem uso para evitar qualquer risco estrutural.
pattern = re.compile(
    r'\n\s*<button\s+type="button"\s+className="text-danger"\s+onClick=\{\(\)=>deleteLead\(l\.id,l\.business_name\)\}[^>]*>\s*\n?\s*<Trash2 size=\{14\}/>\s*Excluir\s*\n?\s*</button>',
    re.MULTILINE,
)
leads, removed = pattern.subn('', leads)

if removed < 1:
    raise SystemExit('Botão Excluir de Leads não encontrado para remoção segura.')

# Validações estruturais fortes para evitar sumir com o funil.
required = [
    'return (',
    'sales-kanban-wrap',
    'sales-kanban',
    'kanban-column',
    "new: 'Novo'",
    "qualified: 'Qualificado'",
    "contacted: 'Contatado'",
    "proposal: 'Proposta'",
    "won: 'Ganho'",
    "lost: 'Perdido'",
]
missing = [item for item in required if item not in leads]
if missing:
    raise SystemExit('Validação estrutural do Funil falhou: ' + '; '.join(missing))

if 'deleteLead(l.id,l.business_name)' in leads:
    raise SystemExit('Ainda existe botão de exclusão no Funil.')

text = text[:start] + leads + text[end:]
APP.write_text(text, encoding='utf-8')
print('V38 aplicada: Funil preservado e botão Excluir removido com segurança.')
