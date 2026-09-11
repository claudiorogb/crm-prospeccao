import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.SUPABASE_URL
const API_KEY = __ENV.SUPABASE_KEY
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const VUS = Number(__ENV.VUS || 250)
const DURATION = __ENV.DURATION || '20s'
const sessions = JSON.parse(open('./.sessions.json'))

if (!BASE_URL || !API_KEY || !sessions.length) {
  throw new Error('Missing staging configuration or authenticated sessions')
}

export const options = {
  vus: VUS,
  duration: DURATION,
  gracefulStop: '5s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
    checks: ['rate>0.99']
  },
  noConnectionReuse: false,
  userAgent: 'CRM-Staging-Authenticated-E2E/1.0'
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
  check(res, {
    [`${operation}: HTTP 2xx`]: r => r.status >= 200 && r.status < 300
  })
}

function get(path, token, workload, operation) {
  return http.get(`${BASE_URL}${path}`, {
    headers: headers(token),
    tags: { workload, operation },
    timeout: '10s'
  })
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
  const results = http.batch(requests)
  results.forEach((r, i) => verify(r, `bootstrap_${i + 1}`))
}

function dashboard(token) {
  const results = http.batch([
    ['GET', `${BASE_URL}/rest/v1/leads?select=id,status,last_contact_date,last_contacted_at,proposal_value,proposal_sent_at&organization_id=eq.${ORG_ID}`, null, { headers: headers(token), tags: { workload: 'dashboard', operation: 'leads_stats' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/sales?select=amount,lead_id&organization_id=eq.${ORG_ID}`, null, { headers: headers(token), tags: { workload: 'dashboard', operation: 'sales_stats' }, timeout: '10s' }]
  ])
  results.forEach((r, i) => verify(r, `dashboard_${i + 1}`))
}

function leads(token) {
  const selectLeads = encodeURIComponent('*,campaigns(name),target_segments(name)')
  const selectCampaigns = encodeURIComponent('id,name,target_segment_id,target_segments(name)')
  const results = http.batch([
    ['GET', `${BASE_URL}/rest/v1/leads?select=${selectLeads}&organization_id=eq.${ORG_ID}&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'leads', operation: 'lead_list' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/campaigns?select=${selectCampaigns}&organization_id=eq.${ORG_ID}&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'leads', operation: 'campaign_lookup' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/target_segments?select=id,name&organization_id=eq.${ORG_ID}&is_active=eq.true&order=name`, null, { headers: headers(token), tags: { workload: 'leads', operation: 'target_lookup' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/message_templates?select=*&organization_id=eq.${ORG_ID}&is_active=eq.true&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'leads', operation: 'template_lookup' }, timeout: '10s' }]
  ])
  results.forEach((r, i) => verify(r, `leads_${i + 1}`))
}

function clients(token) {
  const results = http.batch([
    ['GET', `${BASE_URL}/rest/v1/leads?select=*&organization_id=eq.${ORG_ID}&status=eq.won&order=business_name.asc`, null, { headers: headers(token), tags: { workload: 'clients', operation: 'won_leads' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/sales?select=*&organization_id=eq.${ORG_ID}&order=sale_date.desc`, null, { headers: headers(token), tags: { workload: 'clients', operation: 'sales_history' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/activities?select=*&organization_id=eq.${ORG_ID}&order=occurred_at.desc`, null, { headers: headers(token), tags: { workload: 'clients', operation: 'activity_history' }, timeout: '10s' }]
  ])
  results.forEach((r, i) => verify(r, `clients_${i + 1}`))
}

function campaigns(token) {
  const targetSelect = encodeURIComponent('id,name,description,is_active,catalog_segment_id,created_at,target_segment_search_terms(id,term,priority,is_active)')
  const campaignSelect = encodeURIComponent('*,target_segments(name)')
  const results = http.batch([
    ['GET', `${BASE_URL}/rest/v1/target_segments?select=${targetSelect}&organization_id=eq.${ORG_ID}&order=created_at.asc`, null, { headers: headers(token), tags: { workload: 'campaigns', operation: 'targets' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/campaigns?select=${campaignSelect}&organization_id=eq.${ORG_ID}&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'campaigns', operation: 'campaigns' }, timeout: '10s' }],
    ['GET', `${BASE_URL}/rest/v1/message_templates?select=*&organization_id=eq.${ORG_ID}&order=created_at.desc`, null, { headers: headers(token), tags: { workload: 'campaigns', operation: 'templates' }, timeout: '10s' }]
  ])
  results.forEach((r, i) => verify(r, `campaigns_${i + 1}`))
}

function writeAction(token, leadIds) {
  if (!leadIds.length) return
  const id = leadIds[(__VU * 31 + __ITER * 17) % leadIds.length]
  const res = http.patch(
    `${BASE_URL}/rest/v1/leads?id=eq.${id}&organization_id=eq.${ORG_ID}`,
    JSON.stringify({ commercial_notes: `Authenticated staging load test VU ${__VU} iteration ${__ITER}` }),
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
  verify(res, 'setup_lead_ids')
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
