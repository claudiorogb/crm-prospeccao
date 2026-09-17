"""Remove only the redundant heading immediately above the dashboard's ongoing-deals metric.

The patch is intentionally scoped to a single exact JSX block. It never touches
other headings, funnel metrics, tenant filters, database schema or permissions.
"""
from pathlib import Path

path = Path('src/App.jsx')
original = path.read_text(encoding='utf-8')
before = '''      <section className="panel dashboard-block-v61 dashboard-funnel-v61">
        <div className="dashboard-block-head-v61">
          <div>
            <span className="eyebrow">FUNIL ATIVO</span>
            <h2>Negócios em andamento</h2>
            <p className="muted">Somente oportunidades que já chegaram a Interessado e ainda não foram encerradas.</p>
          </div>
        </div>

        <div className="dashboard-hero-v61">'''
after = '''      <section className="panel dashboard-block-v61 dashboard-funnel-v61">
        <div className="dashboard-hero-v61">'''
if original.count(before) != 1:
    raise SystemExit(f'V99 aborted: expected exactly one duplicate heading, found {original.count(before)}; nothing changed.')
updated = original.replace(before, after, 1)
if updated.replace(after, before, 1) != original:
    raise SystemExit('V99 aborted: unexpected extra changes; nothing changed.')
if updated.count('<StatCard\n            label="Negócios em andamento"') != original.count('<StatCard\n            label="Negócios em andamento"'):
    raise SystemExit('V99 aborted: ongoing-deals metric changed; nothing changed.')
path.write_text(updated, encoding='utf-8')
print('V99: removed only the redundant dashboard funnel heading; all metrics and other headings retained.')
