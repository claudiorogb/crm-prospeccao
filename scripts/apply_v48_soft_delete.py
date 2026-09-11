from pathlib import Path
import re

APP = Path('src/App.jsx')
text = APP.read_text(encoding='utf-8')


def replace_async_function(name, replacement):
    global text
    pattern = re.compile(rf'(?ms)^  async function {re.escape(name)}\([^\n]*\) \{{.*?^  \}}\n')
    text, count = pattern.subn(replacement.rstrip() + '\n', text, count=1)
    if count != 1:
        raise SystemExit(f'Função {name} não encontrada ou ambígua para V48.')


# Helper único: toda exclusão normal vira arquivamento com autor e data.
if 'async function softDeleteRow(' not in text:
    marker = 'function AdminSectionHeader('
    pos = text.find(marker)
    if pos < 0:
        raise SystemExit('Âncora para softDeleteRow não encontrada.')
    helper = r'''async function softDeleteRow(table, id, organizationId, extra = {}) {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData?.user
  if (authError || !user) {
    return { error: authError || new Error('Sessão inválida para arquivar o registro.') }
  }

  let query = supabase
    .from(table)
    .update({
      ...extra,
      deleted_at: new Date().toISOString(),
      deleted_by: user.id
    })
    .eq('id', id)

  if (organizationId) query = query.eq('organization_id', organizationId)
  return await query
}

'''
    text = text[:pos] + helper + text[pos:]

replace_async_function('deleteLead', r'''  async function deleteLead(id, businessName) {
    const { error } = await softDeleteRow('leads', id, organization.id, { status: 'discarded' })
    if (error) {
      setMessage(`Não foi possível arquivar ${businessName}: ${error.message}`)
      return
    }
    setLeads(old => old.filter(l => l.id !== id))
    setSelected(old => {
      const next = new Set(old)
      next.delete(id)
      return next
    })
  }''')

replace_async_function('deleteSale', r'''  async function deleteSale(sale) {
    const { error } = await softDeleteRow('sales', sale.id, organization.id)
    if (error) setMessage(`Não foi possível arquivar a venda: ${error.message}`)
    else {
      setMessage('Venda arquivada. O histórico permanece preservado no banco.')
      await loadData(selectedClient.id)
    }
  }''')

replace_async_function('deleteCampaign', r'''  async function deleteCampaign(c) {
    const { error } = await softDeleteRow('campaigns', c.id, organization.id, { status: 'paused' })
    if (error) setMessage(error.message)
    else {
      setMessage('Campanha arquivada.')
      await loadData()
    }
  }''')

replace_async_function('deleteTemplate', r'''  async function deleteTemplate(t) {
    const { error } = await softDeleteRow('message_templates', t.id, organization.id, { is_active: false })
    if (error) setMessage(error.message)
    else {
      setMessage('Mensagem arquivada.')
      await loadData()
    }
  }''')

replace_async_function('deleteTargetSegment', r'''  async function deleteTargetSegment(segment) {
    setMessage('')
    const { error } = await softDeleteRow('target_segments', segment.id, organization.id, { is_active: false })
    if (error) {
      setMessage(`Não foi possível arquivar o público-alvo: ${error.message}`)
      return
    }
    setMessage('Público-alvo arquivado. O histórico foi preservado.')
    await loadData()
  }''')

replace_async_function('removeNumber', r'''  async function removeNumber(number) {
    if (number.evolution_instance_name) {
      try {
        await evolutionAction('delete_instance', { number_id: number.id })
      } catch (error) {
        if (!window.confirm(`A Evolution API respondeu: ${error.message}. Deseja arquivar o cadastro do CRM mesmo assim?`)) return
      }
    }

    const { error } = await softDeleteRow('whatsapp_numbers', number.id, number.organization_id || organization?.id, {
      is_active: false,
      is_default: false
    })
    if (error) setMessage(error.message)
    else {
      setMessage('Número arquivado. O histórico do cadastro foi preservado.')
      const remaining = numbers.filter(n => n.id !== number.id)
      setNumbers(remaining)
      if (number.is_default && remaining.length) await setDefault(remaining[0].id)
    }
  }''')

replace_async_function('deleteUser', r'''  async function deleteUser(item) {
    await runAction(
      { action: 'delete_user', user_id: item.id },
      'Usuário arquivado. Ele não poderá acessar o CRM até ser reativado.'
    )
  }''')

# Linguagem da interface passa a refletir que a ação é reversível.
text = text.replace("if (!label.includes('excluir')) return", "if (!label.includes('excluir') && !label.includes('arquivar')) return")
text = text.replace('<h3>Confirmar exclusão</h3>', '<h3>Confirmar arquivamento</h3>')
text = text.replace("Esta ação pode ser permanente.", "O registro será ocultado das telas normais, mas permanecerá preservado no banco.")
text = text.replace('>Sim, excluir</button>', '>Sim, arquivar</button>')

# Botões de exclusão de entidades de negócio passam a indicar arquivamento.
replacements = [
    ('<Trash2 size={14}/> Excluir', '<Trash2 size={14}/> Arquivar'),
    ('title="Remove o registro definitivamente"', 'title="Arquiva o registro preservando o histórico"'),
]
for old, new in replacements:
    text = text.replace(old, new)

# Ajusta textos específicos que ainda falavam em exclusão definitiva.
text = text.replace('Usuário excluído.', 'Usuário arquivado.')
text = text.replace('Número excluído.', 'Número arquivado.')
text = text.replace('Campanha excluída.', 'Campanha arquivada.')
text = text.replace('Mensagem excluída.', 'Mensagem arquivada.')
text = text.replace('Público-alvo excluído.', 'Público-alvo arquivado.')

# Validações: não permitimos que os fluxos visíveis continuem com delete físico.
required = [
    'async function softDeleteRow(',
    "softDeleteRow('leads'",
    "softDeleteRow('sales'",
    "softDeleteRow('campaigns'",
    "softDeleteRow('message_templates'",
    "softDeleteRow('target_segments'",
    "softDeleteRow('whatsapp_numbers'",
    "{ action: 'delete_user', user_id: item.id }",
    'Confirmar arquivamento',
]
missing = [item for item in required if item not in text]
if missing:
    raise SystemExit('V48 incompleta: ' + '; '.join(missing))

# Não pode restar delete físico nas entidades de negócio tratadas por V48.
for table in ['leads', 'sales', 'campaigns', 'message_templates', 'target_segments', 'whatsapp_numbers']:
    pattern = re.compile(rf"from\(['\"]{re.escape(table)}['\"]\).*?\.delete\(\)", re.S)
    if pattern.search(text):
        raise SystemExit(f'V48 encontrou delete físico remanescente em {table}.')

APP.write_text(text, encoding='utf-8')
print('V48 aplicada: soft delete padronizado e exclusões visíveis convertidas em arquivamento.')
