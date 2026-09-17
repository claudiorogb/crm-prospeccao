from pathlib import Path

p = Path('scripts/apply_v94_customer_import.py')
source = p.read_text(encoding='utf-8')
old = '''replace_once("keyName: ['empresa / cliente','empresa','cliente']", "keyName: ['empresa / cliente','empresa','cliente','nome do cliente']")
replace_once("keyName: ['empresa / cliente','empresa','cliente']", "keyName: ['empresa / cliente','empresa','cliente','nome do cliente']")'''
new = '''key_anchor = "keyName: ['empresa / cliente','empresa','cliente']"
if text.count(key_anchor) != 2:
    raise SystemExit('V94 halted: activity and sale alias anchors changed')
text = text.replace(key_anchor, "keyName: ['empresa / cliente','empresa','cliente','nome do cliente']", 2)'''
if old in source:
    p.write_text(source.replace(old, new, 1), encoding='utf-8')
elif new in source:
    print('V94 anchor already corrected')
else:
    raise SystemExit('V94 halted: patch source unexpectedly changed')
