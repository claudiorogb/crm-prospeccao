import React, { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { supabase } from './lib/supabase'
import { youtubeThumb, youtubeEmbed, youtubeWatch } from './youtube'
import './tutorials.css'

function VideoCard({ video }) {
  const [playing, setPlaying] = useState(false)
  return (
    <article className="tutorial-card">
      <div className="tutorial-player">
        {playing ? (
          <iframe
            src={youtubeEmbed(video.youtube_id)}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" className="tutorial-thumb" onClick={() => setPlaying(true)} aria-label={`Assistir: ${video.title}`}>
            <img src={youtubeThumb(video.youtube_id)} alt="" loading="lazy" />
            <span className="tutorial-play"><Play size={28} fill="currentColor" /></span>
          </button>
        )}
      </div>
      <div className="tutorial-info">
        <h4>{video.title}</h4>
        {video.description && <p>{video.description}</p>}
        <a href={youtubeWatch(video.youtube_id)} target="_blank" rel="noopener noreferrer">Abrir no YouTube</a>
      </div>
    </article>
  )
}

export default function TutorialsPage() {
  const [categories, setCategories] = useState([])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [cats, vids] = await Promise.all([
        supabase.from('tutorial_categories').select('id,name,position').order('position').order('created_at'),
        supabase.from('tutorial_videos').select('id,category_id,title,description,youtube_id,position').order('position').order('created_at')
      ])
      if (cancelled) return
      if (cats.error || vids.error) setError('Não foi possível carregar os tutoriais agora. Tente novamente em instantes.')
      setCategories(cats.data || [])
      setVideos(vids.data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filled = categories.filter(category => videos.some(video => video.category_id === category.id))

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">APRENDA A USAR</span>
          <h1>Tutoriais</h1>
          <p className="muted">Vídeos explicando cada função do CRM.</p>
        </div>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      {loading ? <p className="muted">Carregando tutoriais...</p> : (
        filled.length === 0 && !error ? (
          <section className="panel"><p className="muted">Os tutoriais serão publicados em breve.</p></section>
        ) : (
          filled.map(category => (
            <section className="panel tutorial-category" key={category.id}>
              <h3>{category.name}</h3>
              <div className="tutorial-grid">
                {videos.filter(video => video.category_id === category.id).map(video => <VideoCard key={video.id} video={video} />)}
              </div>
            </section>
          ))
        )
      )}
    </>
  )
}
