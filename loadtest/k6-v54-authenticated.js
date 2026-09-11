import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.SUPABASE_URL || 'https://ovenrdiykmfnjtvqnalz.supabase.co'
const API_KEY = __ENV.SUPABASE_KEY || 'sb_publishable_Q2F3ab3kHYpI_RZfrhdEfA_49dQEm9G'
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const VUS = Number(__ENV.VUS || 150)
const RAMP_DURATION = __ENV.RAMP_DURATION || '30s'
const HOLD_DURATION = __ENV.HOLD_DURATION || '20s'
const sessions = JSON.parse(open('./.sessions-v54.json'))

if (!sessions.length) throw new Error('Missing authenticated staging sessions')

export const options = {
  stages: [
    { duration: RAMP_DURATION, target: VUS },
    { duration: HOLD_DURATION, target: VUS },
    { duration: '5s', target: 0 }
  ],
  gracefulRampDown: '5s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
    checks: ['rate>0.99']
  },
  noConnectionReuse: false,
  userAgent: 'CRM-Staging-V54-Authenticated/1.0'
}

let bootstrapped = false

function sessionForVu() {
  return sessions[(__VU - 1) % sessions.length]
}

function headers(token, extra = {}) {
  return {
    apikey: API_KEY,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...extra
  }
}

function verify(res, operation) {
  check(res, { [`${operation}: HTTP 2xx`]: r => r.status >= 200 && r.status < 300 })
}

function get(path, token, workload, operation) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers: headers(token),
    tags: { workload, operation },
    timeout: '10s'
  })
  verify(res, operation)
  return res
}

function rpc(name, body, token, workload, operation) {
  const res = http.post(`${BASE_URL}/rest/v1/rpc/${name}`, JSON.stringify(body), {
    headers: headers(token, { 'Content-Type': 'application/json' }),
    tags: { workload, operation },
    timeout: '10s'
  })
  verify(res, operation)
  return res
}

function bootstrap(session) {
  const token = session.access_token
  const uid = session.user.id
  const requests = [
    ['GET', `${BASE_URL}/rest/v1/profiles?select=account_status&id=eq.${uid}`, null, { headers: headers(token), tags: { workload: 'bootstrap', operation: 'profile' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/organization_members?select=organization_id,role,is_active,organizations(id,name,is_active)&user_id=eq.${uid}&is_active=eq.true&limit=1`, null, { headers: headers(token), tags: { workload: 'bootstrap', operation: 'membership' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/system_admins?select=user_id&user_id=eq.${uid}&limit=1`, null, { headers: headers(token), tags: { workload: 'bootstrap', operation: 'admin_check' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/organization_settings?select=*&organization_id=eq.${ORG_ID}`, null, { headers: headers(token), tags: { workload: 'bootstrap', operation: 'settings' }, timeout: '10s' }]
  ]
  http.batch(requests).forEach((r, i) => verify(r, `bootstrap_${i + 1}`))
}

function dashboard(token) {
  rpc('get_dashboard_stats', { p_organization_id: ORG_ID }, token, 'dashboard', 'dashboard_stats')
}

function leads(token) {
  const page = (__ITER + __VU) % 4
  const offset = page * 50
  const results = http.batch([
    ['POST', `${BASE_URL}/rest/v1/rpc/get_leads_page`, JSON.stringify({
      p_organization_id: ORG_ID,
      p_search: null,
      p_target_segment_id: null,
      p_status: null,
      p_limit: 50,
      p_offset: offset
    }), { headers: headers(token, { 'Content-Type': 'application/json' }), tags: { workload: 'leads', operation: 'lead_page' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/campaigns?select=id,name,target_segment_id,target_segments(name)&organization_id=eq.${ORG_ID}&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'leads', operation: 'campaign_lookup' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/target_segments?select=id,name&organization_id=eq.${ORG_ID}&is_active=eq.true&order=name`, null, { headers: headers(token), tags: { workload: 'leads', operation: 'target_lookup' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/message_templates?select=id,name,target_segment_id,is_active&organization_id=eq.${ORG_ID}&is_active=eq.true&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'leads', operation: 'template_lookup' }, timeout: '10s' }]
  ])
  results.forEach((r, i) => verify(r, `leads_${i + 1}`))
}

function clients(token) {
  const results = http.batch([
    ['GET', `${BASE_URL}/rest/v1/leads?select=id,business_name,status,phone,whatsapp,contact_name,last_contact_date,next_contact_date&organization_id=eq.${ORG_ID}&status=eq.won&order=business_name.asc`, null, { headers: headers(token), tags: { workload: 'clients', operation: 'won_leads' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/sales?select=id,lead_id,amount,sale_date,product_service,notes&organization_id=eq.${ORG_ID}&order=sale_date.desc`, null, { headers: headers(token), tags: { workload: 'clients', operation: 'sales_history' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/activities?select=id,lead_id,type,notes,occurred_at&organization_id=eq.${ORG_ID}&order=occurred_at.desc&limit=500`, null, { headers: headers(token), tags: { workload: 'clients', operation: 'activity_history' }, timeout: '10s' }]
  ])
  results.forEach((r, i) => verify(r, `clients_${i + 1}`))
}

function campaigns(token) {
  const targetSelect = encodeURIComponent('id,name,description,is_active,catalog_segment_id,created_at,target_segment_search_terms(id,term,priority,is_active)')
  const campaignSelect = encodeURIComponent('id,name,status,target_segment_id,created_at,target_segments(name)')
  const results = http.batch([
    ['GET', `${BASE_URL}/rest/v1/target_segments?select=${targetSelect}&organization_id=eq.${ORG_ID}&order=created_at.asc`, null, { headers: headers(token), tags: { workload: 'campaigns', operation: 'targets' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/campaigns?select=${campaignSelect}&organization_id=eq.${ORG_ID}&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'campaigns', operation: 'campaigns' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/message_templates?select=id,name,target_segment_id,is_active,created_at&organization_id=eq.${ORG_ID}&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'campaigns', operation: 'templates' }, timeout: '10s' }]
  ])
  results.forEach((r, i) => verify(r, `campaigns_${i + 1}`))
}

function writeAction(token, leadIds) {
  if (!leadIds.length) return
  const id = leadIds[(__VU * 31 + __ITER * 17) % leadIds.length]
  const res = http.patch(
    `${BASE_URL}/rest/v1/leads?id=eq.${id}&organization_id=eq.${ORG_ID}`,
    JSON.stringify({ commercial_notes: `V54 staging load test VU ${__VU} iteration ${__ITER}` }),
    {
      headers: headers(token, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      tags: { workload: 'write', operation: 'lead_update' },
      timeout: '10s'
    }
  )
  verify(res, 'write_lead')
}

export function setup() {
  const session = sessions[0]
  const res = get(`/rest/v1/leads?select=id&organization_id=eq.${ORG_ID}&order=created_at.asc&limit=200`, session.access_token, 'setup', 'lead_ids')
  const rows = res.json() || []
  return { leadIds: rows.map(row => row.id) }
}

export default function (data) {
  const session = sessionForVu()
  const token = session.access_token

  if (!bootstrapped) {
    bootstrap(session)
    bootstrapped = true
  }

  const n = (__VU * 37 + __ITER * 19) % 100
  if (n < 30) dashboard(token)
  else if (n < 55) leads(token)
  else if (n < 70) clients(token)
  else if (n < 90) campaigns(token)
  else writeAction(token, data.leadIds)

  sleep(7 + Math.random() * 3)
}
