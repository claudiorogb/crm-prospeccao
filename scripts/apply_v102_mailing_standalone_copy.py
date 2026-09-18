from pathlib import Path

changes = {
  'src/marketing-list-import.jsx': [
    ("export default function MarketingListImport({ organization, onImported, onManualAdded }) {", "export default function MarketingListImport({ organization, onImported, onManualAdded, standalone = false }) {"),
    ("setManualMessage('Destinatário adicionado e selecionado para a campanha.')", "setManualMessage(standalone ? 'E-mail incluído na lista.' : 'Destinatário adicionado e selecionado para a campanha.')"),
    ("{loading ? 'Adicionando...' : 'Adicionar e selecionar'}", "{loading ? 'Adicionando...' : standalone ? 'Adicionar à lista' : 'Adicionar e selecionar'}")
  ],
  'src/newsletter-mailing-panel.jsx': [
    ('<MarketingListImport organization={organization} onImported={handleImported} onManualAdded={handleImported} />', '<MarketingListImport organization={organization} standalone onImported={handleImported} onManualAdded={handleImported} />')
  ]
}
for filename, edits in changes.items():
  path = Path(filename)
  content = path.read_text(encoding='utf-8')
  for old, new in edits:
    if content.count(old) != 1:
      raise SystemExit(f'Patch halted: unexpected source at {filename}, {old[:100]!r}')
    content = content.replace(old, new, 1)
  path.write_text(content, encoding='utf-8')
print('V102: standalone list addition messages updated without changing campaign behavior.')
