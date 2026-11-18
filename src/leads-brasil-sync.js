import { supabase } from './lib/supabase'

const LEADS_BRASIL_API = 'https://leads-sp.vercel.app/api/sso'

export async function syncCurrentLeadsBrasilOrganization(organizationId) {
  if (!organizationId) throw new Error('Empresa do CRM não identificada.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session?.access_token) throw new Error('Sessão do CRM indisponível para sincronizar o Leads Brasil.')
  const response = await fetch(LEADS_BRASIL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: data.session.access_token, organization_id: organizationId, sync_only: true }),
    cache: 'no-store'
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result?.ok) throw new Error(result?.erro || 'Não foi possível sincronizar a empresa com o Leads Brasil.')
  return result
}
