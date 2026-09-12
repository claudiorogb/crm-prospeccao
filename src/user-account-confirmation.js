const nativeConfirm = window.confirm.bind(window)

window.confirm = (message) => {
  const text = String(message || '')

  if (text.startsWith('Excluir definitivamente o usuário')) {
    return nativeConfirm(
      `${text}\n\nEsta ação remove a conta de acesso e não pode ser desfeita. Os registros comerciais já existentes permanecem no CRM. Depois da exclusão, este mesmo e-mail poderá criar uma nova conta pela tela de login.`
    )
  }

  return nativeConfirm(message)
}
