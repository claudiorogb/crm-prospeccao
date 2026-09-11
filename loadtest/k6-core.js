import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const BASE_URL = __ENV.SUPABASE_URL;
const API_KEY = __ENV.SUPABASE_KEY;

const stages = [
  ['s10', 10, '30s', '0s'],
  ['s25', 25, '30s', '35s'],
  ['s50', 50, '30s', '70s'],
  ['s100', 100, '40s', '105s'],
  ['s200', 200, '40s', '150s'],
  ['s350', 350, '40s', '195s'],
  ['s500', 500, '40s', '240s'],
];

const scenarios = {};
const thresholds = {};
for (const [name, vus, duration, startTime] of stages) {
  scenarios[name] = {
    executor: 'constant-vus',
    vus,
    duration,
    startTime,
    gracefulStop: '5s',
  };
  thresholds[`http_req_failed{scenario:${name}}`] = ['rate<0.02'];
  thresholds[`http_req_duration{scenario:${name}}`] = ['p(95)<2000'];
}

export const options = {
  scenarios,
  thresholds,
  discardResponseBodies: false,
  noConnectionReuse: false,
  userAgent: 'CRM-Staging-LoadTest/1.0',
};

function pickScenario() {
  const n = (__VU * 31 + __ITER * 17) % 100;
  if (n < 8) return 'write';
  if (n < 38) return 'leads';
  if (n < 58) return 'dashboard';
  if (n < 73) return 'funnel';
  if (n < 88) return 'clients';
  return 'campaigns';
}

export default function () {
  const workload = pickScenario();
  const slot = ((__VU * 100003 + __ITER) % 2000) + 1;
  const url = `${BASE_URL}/rest/v1/rpc/loadtest_core`;
  const payload = JSON.stringify({ p_scenario: workload, p_slot: slot });

  const res = http.post(url, payload, {
    headers: {
      apikey: API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    tags: { workload, stage: exec.scenario.name },
    timeout: '10s',
  });

  check(res, {
    'status 200': (r) => r.status === 200,
    'response under 2s': (r) => r.timings.duration < 2000,
  });

  sleep(2 + Math.random() * 2);
}
