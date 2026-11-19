import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Repeat, Volume2 } from 'lucide-react'
import { useAssetStore } from '../assets/library'
import { ensureAssetUrl } from '../assets/textures'
import { useI18n } from '../i18n'
import { popPreviewWindow } from './previewStore'

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const whole = Math.floor(sec)
  const mins = Math.floor(whole / 60)
  const secs = whole % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function AudioPreview({ assetId, standalone = false }: { assetId: string, standalone?: boolean }) {
  const { t } = useI18n()
  const asset = useAssetStore(state => state.assets[assetId])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [url, setUrl] = useState('')
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [volume, setVolume] = useState(0.85)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setUrl('')
    setPlaying(false)
    setDuration(0)
    setCurrent(0)
    setError('')
    void ensureAssetUrl(assetId)
      .then(next => { if (active) setUrl(next) })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
  }, [assetId])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !url) return
    audio.volume = volume
    audio.loop = loop
    return () => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [url])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = loop
  }, [loop])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio || !url) return
    if (audio.paused) {
      void audio.play().catch(() => undefined)
    } else {
      audio.pause()
    }
  }

  return (
    <div className="audio-preview">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={event => setCurrent(event.currentTarget.currentTime || 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <div className="audio-preview__meta">
        <strong>{asset?.name ?? ''}</strong>
        <span>{asset && 'fileName' in asset ? asset.fileName : ''}</span>
      </div>
      {error && <div className="audio-preview__error">{error}</div>}
      <div className="audio-preview__transport">
        <button type="button" className="audio-preview__play" disabled={!url} onClick={togglePlay}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0.01, duration)}
          step={0.01}
          value={Math.min(current, Math.max(0.01, duration))}
          disabled={!url || duration <= 0}
          onChange={event => {
            const next = Number(event.target.value)
            setCurrent(next)
            if (audioRef.current) audioRef.current.currentTime = next
          }}
        />
        <span className="audio-preview__clock">{formatTime(current)} / {formatTime(duration)}</span>
      </div>
      <div className="audio-preview__footer">
        <button
          type="button"
          className={`tex-edit__icon${loop ? ' is-on' : ''}`}
          title={t('anim.loop')}
          onClick={() => setLoop(value => !value)}
        >
          <Repeat size={13} />
        </button>
        <label className="audio-preview__volume">
          <Volume2 size={13} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={event => setVolume(Number(event.target.value))}
          />
        </label>
        <span className="tex-edit__spacer" />
        {!standalone && (
          <button type="button" className="tex-edit__ghost" onClick={() => popPreviewWindow('audio', assetId)}>
            {t('preview.popout')}
          </button>
        )}
      </div>
    </div>
  )
}
