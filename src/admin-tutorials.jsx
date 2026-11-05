import React, { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react'
import { supabase } from './lib/supabase'
import { parseYoutubeId, youtubeThumb } from './youtube'
import './tutorials.css'

const EMPTY_VIDEO = { title: '', url: '', description: '' }

// Gerenciamento dos Tutoriais (somente administrador do sistema; o banco também só aceita gravação de administradores).
export default function AdminTutorials() {
  const [categories, setCategories] = useState([])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [categoryDrafts, setCategoryDrafts] = useState({})
  const [videoDrafts, setVideoDrafts] = useState({})
  const [newVideos, setNewVideos] = useState({})

  const load = useCallback(async () => {
    const [cats, vids] = await Promise.all([
      supabase.from('tutorial_categories').select('id,name,position').order('position').order('created_at'),
      supabase.from('tutorial_videos').select('id,category_id,title,description,youtube_id,position').order('position').order('created_at')
    ])
    if (cats.error || vids.error) {
      setError((cats.error || vids.error).message || 'Não foi possível carregar.')
    }
    setCategories(cats.data || [])
    setVideos(vids.data || [])
    setCategoryDrafts(Object.fromEntries((cats.data || []).map(c => [c.id, c.name])))
    setVideoDrafts(Object.fromEntries((vids.data || []).map(v => [v.id, {
      title: v.title,
      url: `https://www.youtube.com/watch?v=${v.youtube_id}`,
      description: v.description || ''
    }])))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function done(message) { setNotice(message); setError('') }
  function fail(message) { setError(message); setNotice('') }

  async function addCategory(event) {
    event.preventDefault()
    const name = newCategory.trim()
    if (!name) return fail('Informe o nome da categoria.')
    const position = categories.reduce((max, c) => Math.max(max, c.position), 0) + 1
    const { error: err } = await supabase.from('tutorial_categories').insert({ name, position })
    if (err) return fail(err.message)
    setNewCategory('')
    done(`Categoria “${name}” criada.`)
    await load()
  }

  async function renameCategory(category) {
    const name = String(categoryDrafts[category.id] || '').trim()
    if (!name) return fail('O nome da categoria não pode ficar vazio.')
    const { error: err } = await supabase.from('tutorial_categories').update({ name }).eq('id', category.id)
    if (err) return fail(err.message)
    done('Nome da categoria salvo.')
    await load()
  }

  async function deleteCategory(category) {
    const { error: err } = await supabase.from('tutorial_categories').delete().eq('id', category.id)
    if (err) return fail(err.message)
    done(`Categoria “${category.name}” e seus vídeos foram apagados.`)
    await load()
  }

  // Reordena regravando a posição de todos os itens da lista (evita empates).
  async function reorder(table, list, index, direction) {
    const target = index + direction
    if (target < 0 || target >= list.length) return
    const next = [...list]
    ;[next[index], next[target]] = [next[target], next[index]]
    for (let i = 0; i < next.length; i += 1) {
      const { error: err } = await supabase.from(table).update({ position: i + 1 }).eq('id', next[i].id)
      if (err) return fail(err.message)
    }
    done('Ordem atualizada.')
    await load()
  }

  async function addVideo(category, event) {
    event.preventDefault()
    const draft = newVideos[category.id] || EMPTY_VIDEO
    const title = draft.title.trim()
    const youtubeId = parseYoutubeId(draft.url)
    if (!title) return fail('Informe o título do vídeo.')
    if (!youtubeId) return fail('O link não parece ser do YouTube. Cole o endereço completo do vídeo (por exemplo, https://www.youtube.com/watch?v=...).')
    const inCategory = videos.filter(v => v.category_id === category.id)
    const position = inCategory.reduce((max, v) => Math.max(max, v.position), 0) + 1
    const { error: err } = await supabase.from('tutorial_videos').insert({
      category_id: category.id,
      title,
      description: draft.description.trim() || null,
      youtube_id: youtubeId,
      position
    })
    if (err) return fail(err.message)
    setNewVideos(current => ({ ...current, [category.id]: EMPTY_VIDEO }))
    done(`Vídeo “${title}” adicionado.`)
    await load()
  }

  async function saveVideo(video) {
    const draft = videoDrafts[video.id]
    const title = String(draft?.title || '').trim()
    const youtubeId = parseYoutubeId(draft?.url)
    if (!title) return fail('Informe o título do vídeo.')
    if (!youtubeId) return fail('O link não parece ser do YouTube.')
    const { error: err } = await supabase.from('tutorial_videos').update({
      title,
      description: String(draft.description || '').trim() || null,
      youtube_id: youtubeId
    }).eq('id', video.id)
    if (err) return fail(err.message)
    done('Vídeo salvo.')
    await load()
  }

  async function deleteVideo(video) {
    const { error: err } = await supabase.from('tutorial_videos').delete().eq('id', video.id)
    if (err) return fail(err.message)
    done(`Vídeo “${video.title}” apagado.`)
    await load()
  }

  function setDraft(id, field, value) {
    setVideoDrafts(current => ({ ...current, [id]: { ...current[id], [field]: value } }))
  }

  function setNewVideo(categoryId, field, value) {
    setNewVideos(current => ({ ...current, [categoryId]: { ...(current[categoryId] || EMPTY_VIDEO), [field]: value } }))
  }

  return (
    <section className="panel admin-tutorials">
      <header className="admin-section-header">
        <div>
          <span className="eyebrow">TUTORIAIS</span>
          <h2>Vídeos de tutoriais</h2>
          <p className="muted">Crie categorias e cole o link dos vídeos do YouTube. Todos os usuários do CRM, atuais e novos, veem a página “Tutoriais” no menu lateral.</p>
        </div>
      </header>

      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}

      <form className="tutorial-add-form" onSubmit={addCategory}>
        <label>
          Nova categoria
          <input value={newCategory} onChange={event => setNewCategory(event.target.value)} placeholder="Ex.: Primeiros passos" maxLength={80} />
        </label>
        <div><button type="submit" className="primary"><Plus size={15} /> Criar categoria</button></div>
      </form>

      {loading ? <p className="muted">Carregando...</p> : (
        <>
          {categories.length === 0 && <p className="muted">Nenhuma categoria ainda. Crie a primeira acima.</p>}
          {categories.map((category, categoryIndex) => {
            const categoryVideos = videos.filter(video => video.category_id === category.id)
            const draft = newVideos[category.id] || EMPTY_VIDEO
            return (
              <div className="tutorial-admin-category" key={category.id}>
                <div className="tutorial-admin-head">
                  <input
                    aria-label="Nome da categoria"
                    value={categoryDrafts[category.id] ?? ''}
                    onChange={event => setCategoryDrafts(current => ({ ...current, [category.id]: event.target.value }))}
                    maxLength={80}
                  />
                  <button type="button" className="secondary mini" onClick={() => renameCategory(category)}><Save size={13} /> Salvar nome</button>
                  <button type="button" className="secondary mini" onClick={() => reorder('tutorial_categories', categories, categoryIndex, -1)} disabled={categoryIndex === 0} aria-label="Subir categoria"><ArrowUp size={13} /></button>
                  <button type="button" className="secondary mini" onClick={() => reorder('tutorial_categories', categories, categoryIndex, 1)} disabled={categoryIndex === categories.length - 1} aria-label="Descer categoria"><ArrowDown size={13} /></button>
                  <button
                    type="button"
                    className="text-danger mini"
                    data-confirm-message={`Tem certeza que deseja apagar a categoria “${category.name}” e todos os ${categoryVideos.length} vídeo(s) dela? Essa ação não pode ser desfeita.`}
                    onClick={() => deleteCategory(category)}
                  >
                    <Trash2 size={13} /> Apagar categoria
                  </button>
                </div>

                {categoryVideos.map((video, videoIndex) => (
                  <div className="tutorial-admin-video" key={video.id}>
                    <img src={youtubeThumb(video.youtube_id)} alt="" loading="lazy" />
                    <div className="fields">
                      <input aria-label="Título do vídeo" value={videoDrafts[video.id]?.title ?? ''} onChange={event => setDraft(video.id, 'title', event.target.value)} maxLength={140} placeholder="Título" />
                      <input aria-label="Link do YouTube" value={videoDrafts[video.id]?.url ?? ''} onChange={event => setDraft(video.id, 'url', event.target.value)} placeholder="Link do YouTube" />
                      <textarea aria-label="Descrição do vídeo" value={videoDrafts[video.id]?.description ?? ''} onChange={event => setDraft(video.id, 'description', event.target.value)} maxLength={2000} placeholder="Descrição (opcional)" />
                    </div>
                    <div className="tutorial-admin-actions">
                      <button type="button" className="secondary mini" onClick={() => saveVideo(video)}><Save size={13} /> Salvar</button>
                      <button type="button" className="secondary mini" onClick={() => reorder('tutorial_videos', categoryVideos, videoIndex, -1)} disabled={videoIndex === 0} aria-label="Subir vídeo"><ArrowUp size={13} /></button>
                      <button type="button" className="secondary mini" onClick={() => reorder('tutorial_videos', categoryVideos, videoIndex, 1)} disabled={videoIndex === categoryVideos.length - 1} aria-label="Descer vídeo"><ArrowDown size={13} /></button>
                      <button
                        type="button"
                        className="text-danger mini"
                        data-confirm-message={`Tem certeza que deseja apagar o vídeo “${video.title}”?`}
                        onClick={() => deleteVideo(video)}
                      >
                        <Trash2 size={13} /> Apagar
                      </button>
                    </div>
                  </div>
                ))}

                <form className="tutorial-add-form" onSubmit={event => addVideo(category, event)}>
                  <strong>Adicionar vídeo em “{category.name}”</strong>
                  <input value={draft.title} onChange={event => setNewVideo(category.id, 'title', event.target.value)} placeholder="Título do vídeo" maxLength={140} />
                  <input value={draft.url} onChange={event => setNewVideo(category.id, 'url', event.target.value)} placeholder="Link do YouTube (https://www.youtube.com/watch?v=...)" />
                  <textarea value={draft.description} onChange={event => setNewVideo(category.id, 'description', event.target.value)} placeholder="Descrição (opcional)" maxLength={2000} />
                  <div><button type="submit" className="primary"><Plus size={15} /> Adicionar vídeo</button></div>
                </form>
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}
