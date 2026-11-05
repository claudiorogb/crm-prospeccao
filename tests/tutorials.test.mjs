import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseYoutubeId } from '../src/youtube.js'

test('aceita os formatos comuns de link do YouTube', () => {
  const id = 'dQw4w9WgXcQ'
  assert.equal(parseYoutubeId(`https://www.youtube.com/watch?v=${id}`), id)
  assert.equal(parseYoutubeId(`https://www.youtube.com/watch?v=${id}&t=30s&list=abc`), id)
  assert.equal(parseYoutubeId(`https://youtu.be/${id}?si=xyz`), id)
  assert.equal(parseYoutubeId(`https://m.youtube.com/watch?v=${id}`), id)
  assert.equal(parseYoutubeId(`https://www.youtube.com/embed/${id}`), id)
  assert.equal(parseYoutubeId(`https://www.youtube.com/shorts/${id}`), id)
  assert.equal(parseYoutubeId(`https://www.youtube.com/live/${id}`), id)
  assert.equal(parseYoutubeId(`youtube.com/watch?v=${id}`), id)
  assert.equal(parseYoutubeId(id), id)
})

test('rejeita links que não são de vídeo do YouTube', () => {
  assert.equal(parseYoutubeId(''), '')
  assert.equal(parseYoutubeId('https://vimeo.com/123456789'), '')
  assert.equal(parseYoutubeId('https://www.youtube.com/watch?v=curto'), '')
  assert.equal(parseYoutubeId('https://evil.com/watch?v=dQw4w9WgXcQ'), '')
  assert.equal(parseYoutubeId('javascript:alert(1)'), '')
  assert.equal(parseYoutubeId('https://www.youtube.com/@canal'), '')
})

test('Tutoriais fica por último no menu do usuário e só administrador grava', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const nav = app.indexOf("setPage('tutorials')")
  const install = app.indexOf('<InstallAppMenuItem', nav)
  assert.ok(nav > 0 && install > nav && install - nav < 400)
  const sql = readFileSync(new URL('../supabase/migrations/20261105210000_tutorials.sql', import.meta.url), 'utf8')
  assert.match(sql, /tutorial_videos_admin_write[\s\S]*private\.is_system_admin/)
  assert.match(sql, /tutorial_videos_read[\s\S]*to authenticated using \(true\)/)
})
