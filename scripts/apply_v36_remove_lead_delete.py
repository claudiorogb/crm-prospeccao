from pathlib import Path
import re

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')

start = text.find('function Leads({ organization, settings, userEmail }) {')
end = text.find('function Clients({ organization, userEmail, userId }) {', start)
if start < 0 or end < 0:
    raise SystemExit('Componente Leads não encontrado.')

leads = text[start:end]

# Remove a ação de exclusão definitiva da tela de Leads.
# Leads inadequados devem seguir pelos status Sem interesse ou Descartado,
# que já os direcionam para a área Leads sem interesse.
button_pattern = re.compile(
    r'\n\s*<button\s+type="button"\s+className="text-danger"\s+onClick=\{\(\)=>deleteLead\(l\.id,l\.business_name\)\}[^>]*>\s*\n?\s*<Trash2 size=\{14\}/>\s*Excluir\s*\n?\s*</button>',
    re.MULTILINE,
)
leads, removed_buttons = button_pattern.subn('', leads)

# Remove também a função de exclusão definitiva que ficou sem uso dentro de Leads.
function_start = leads.find('  async function deleteLead(id, businessName) {')
if function_start >= 0:
    function_end = leads.find('  function toggleSelected(id) {', function_start)
    if function_end < 0:
        raise SystemExit('Fim da função deleteLead não encontrado.')
    leads = leads[:function_start] + leads[function_end:]

if removed_buttons < 1:
    raise SystemExit('Botão Excluir de Leads não encontrado para remoção.')

if 'deleteLead(l.id,l.business_name)' in leads:
    raise SystemExit('Validação falhou: ainda existe ação Excluir em Leads.')
if '> Excluir<' in leads or '>Excluir<' in leads:
    raise SystemExit('Validação falhou: ainda existe botão Excluir no componente Leads.')
if "not_interested: 'Sem interesse'" not in leads or "discarded: 'Descartado'" not in leads:
    raise SystemExit('Validação falhou: rotas Sem interesse/Descartado não estão disponíveis em Leads.')

text = text[:start] + leads + text[end:]
APP.write_text(text, encoding='utf-8')
print('V36 aplicada: exclusão definitiva removida da tela de Leads.')
