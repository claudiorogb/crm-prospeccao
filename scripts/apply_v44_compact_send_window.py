from pathlib import Path

CSS = Path('src/styles.css')
css = CSS.read_text(encoding='utf-8')

marker = '/* V44 - janela de envio compacta */'
if marker not in css:
    css += r'''

/* V44 - janela de envio compacta */
.whatsapp-schedule-v43 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 20px !important;
}

.whatsapp-schedule-v43 > div:first-child {
  min-width: 0;
  flex: 1 1 auto;
}

.whatsapp-schedule-v43 h2 {
  margin: 3px 0 3px;
}

.whatsapp-schedule-v43 p {
  margin: 0;
}

.schedule-fields-v43 {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex: 0 0 auto;
}

.schedule-fields-v43 label {
  display: grid;
  gap: 5px;
  width: 132px;
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}

.schedule-fields-v43 input[type="time"] {
  width: 132px !important;
  min-width: 0 !important;
  height: 42px;
  padding: 8px 10px;
}

.schedule-fields-v43 button {
  height: 42px;
  white-space: nowrap;
  margin: 0;
}

@media (max-width: 1000px) {
  .whatsapp-schedule-v43 {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 560px) {
  .schedule-fields-v43 {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .schedule-fields-v43 label,
  .schedule-fields-v43 input[type="time"] {
    width: 100% !important;
  }

  .schedule-fields-v43 button {
    grid-column: 1 / -1;
    width: 100%;
  }
}
'''

checks = [
    ('campos na mesma linha', '.schedule-fields-v43 {' in css and 'display: flex;' in css),
    ('largura compacta', 'width: 132px' in css),
    ('responsivo no celular', '@media (max-width: 560px)' in css),
]
failed = [name for name, ok in checks if not ok]
if failed:
    raise SystemExit('Validação V44 falhou: ' + '; '.join(failed))

CSS.write_text(css, encoding='utf-8')
print('V44 aplicada: janela de envio compacta com horários e botão na mesma linha.')
