"""AXIVA CRM: independent HTTP probes from GitHub Actions (no DB credentials).

GitHub OIDC authenticates the short-lived monitoring identity to Supabase.
Only the public CRM landing page and a read-only backend health endpoint are probed.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

PROBES = (
    ("crm_web", "https://crm.axiva.com.br/", b"AXIVA CRM"),
    ("crm_backend", "https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/axiva-healthz", b'"ok":true'),
)
INGEST = "https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/axiva-monitor-ingest"


def probe(component, url, marker):
    started = time.monotonic()
    status = 0
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "AXIVA-HealthMonitor/1.0", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=12) as response:
            status = response.status
            sample = response.read(300_000)
        up = status == 200 and marker in sample
        detail = "ok" if up else "Resposta inesperada do serviço"
    except urllib.error.HTTPError as exc:
        status = exc.code
        up = False
        detail = "HTTP não disponível"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        up = False
        detail = "Falha de conexão ou tempo esgotado"
    elapsed = min(round((time.monotonic() - started) * 1000), 120000)
    return {"component": component, "is_up": up, "http_status": status or None, "latency_ms": elapsed, "detail": detail}


def github_oidc():
    uri = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    key = os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
    request = urllib.request.Request(uri + "&audience=axiva-monitor-v1", headers={"Authorization": f"bearer {key}"})
    with urllib.request.urlopen(request, timeout=12) as response:
        return json.load(response)["value"]


def ingest(token, result):
    request = urllib.request.Request(
        INGEST,
        data=json.dumps(result, separators=(",", ":")).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        answer = json.load(response)
        if not answer.get("ok"):
            raise RuntimeError("monitoring endpoint did not acknowledge check")
        return answer.get("event", "none")


def main():
    results = [probe(*target) for target in PROBES]
    try:
        token = github_oidc()
    except Exception as exc:
        print("ERRO: não foi possível obter identidade segura do monitor GitHub.", file=sys.stderr)
        return 1
    failed_ingestion = False
    for result in results:
        try:
            event = ingest(token, result)
            print(f"{result['component']}: {'OK' if result['is_up'] else 'FALHA'}; evento: {event}; resposta: {result['latency_ms']} ms")
        except Exception:
            failed_ingestion = True
            print(f"ERRO: não foi possível registrar {result['component']} no monitor.", file=sys.stderr)
    # A failed workflow is a fallback signal while the primary dashboard/alert backend is down.
    return 1 if failed_ingestion or any(not item["is_up"] for item in results) else 0


if __name__ == "__main__":
    sys.exit(main())
