import { Audio, AudioListener, PositionalAudio, type Camera, type Object3D } from 'three'
import { ensureAssetUrl } from '../editor/assets/textures'
import { useAssetStore } from '../editor/assets/library'
import { useEditorStore } from '../editor/scene/store'
import type { ScenePicture } from '../editor/scene/types'
import { registerRuntimeSystem, RUNTIME_STAGE } from './sceneRuntime'

const MAX_SFX = 32

export interface AudioMix {
  master: number
  music: number
  sfx: number
}

export interface PlaySoundOptions {
  assetId: string
  bus?: 'sfx' | 'music'
  volume?: number
  playbackRate?: number
  loop?: boolean
  /** 挂在物体上时按距离衰减。不挂则是平面声。 */
  parent?: Object3D | null
  refDistance?: number
  rolloff?: number
}

interface Voice {
  id: number
  audio: Audio | PositionalAudio
  parent: Object3D | null
  loop: boolean
  bus: 'sfx' | 'music'
  local: number
}

const buffers = new Map<string, Promise<AudioBuffer>>()
let listener: AudioListener | null = null
let voices: Voice[] = []
let nextId = 1
let musicId = 0
let heardPlay = false
let installed = false

const DEFAULT_MIX: AudioMix = { master: 1, music: 0.8, sfx: 1 }

export function readAudioMix(picture: Pick<ScenePicture, 'audio'>): AudioMix {
  return {
    master: unit(picture.audio?.master, DEFAULT_MIX.master),
    music: unit(picture.audio?.music, DEFAULT_MIX.music),
    sfx: unit(picture.audio?.sfx, DEFAULT_MIX.sfx),
  }
}

export function audioMixPatch(picture: ScenePicture, partial: Partial<AudioMix>): Pick<ScenePicture, 'audio'> {
  return { audio: { ...readAudioMix(picture), ...partial } }
}

export function attachAudioListener(camera: Camera) {
  const ear = ensureListener()
  if (ear.parent !== camera) camera.add(ear)
}

export function unlockAudio() {
  const ctx = ensureListener().context
  if (ctx.state === 'suspended') void ctx.resume()
}

export function playSound(options: PlaySoundOptions): number {
  installUnlock()
  const id = nextId++
  const ear = ensureListener()
  const run = () => { void start(id, options) }
  if (ear.context.state === 'suspended') void ear.context.resume().then(run)
  else run()
  return id
}

export function stopSound(id: number) {
  const voice = voices.find(item => item.id === id)
  if (voice) stopVoice(voice)
}

export function stopMusic() {
  const voice = voices.find(item => item.id === musicId)
  if (voice) fadeStop(voice)
  musicId = 0
}

export function stopAllSounds() {
  for (const voice of [...voices]) stopVoice(voice)
  musicId = 0
}

function ensureListener(): AudioListener {
  if (!listener) {
    listener = new AudioListener()
    listener.gain.gain.value = 1
  }
  return listener
}

function installUnlock() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const once = () => unlockAudio()
  window.addEventListener('pointerdown', once, { capture: true })
  window.addEventListener('keydown', once, { capture: true })
}

async function start(id: number, options: PlaySoundOptions) {
  const assetId = options.assetId.trim()
  if (!assetId) return
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || asset.kind !== 'audio') return
  const buffer = await bufferFor(assetId, 'hash' in asset ? asset.hash : assetId)
  if (!buffer) return
  const state = useEditorStore.getState()
  if (options.bus === 'music' && state.playState !== 'playing') return
  const mix = readAudioMix(state.picture)
  applyMix(mix)
  const bus = options.bus ?? 'sfx'
  if (bus === 'sfx') trimSfx()
  const ear = ensureListener()
  const audio = options.parent ? new PositionalAudio(ear) : new Audio(ear)
  audio.setBuffer(buffer)
  audio.setLoop(options.loop === true)
  const local = clamp(options.volume ?? 1, 0, 4)
  audio.setVolume(local * (bus === 'music' ? mix.music : mix.sfx))
  if (options.playbackRate && options.playbackRate > 0) audio.setPlaybackRate(options.playbackRate)
  if (audio instanceof PositionalAudio && options.parent) {
    audio.setRefDistance(options.refDistance ?? 2)
    audio.setRolloffFactor(options.rolloff ?? 1)
    audio.setDistanceModel('inverse')
    options.parent.add(audio)
  }
  const voice: Voice = { id, audio, parent: options.parent ?? null, loop: options.loop === true, bus, local }
  voices.push(voice)
  if (bus === 'music') {
    const previous = voices.find(item => item.id === musicId && item.id !== id)
    if (previous) fadeStop(previous)
    musicId = id
  }
  audio.play()
  const source = audio.source as AudioBufferSourceNode | null
  if (!voice.loop && source) source.onended = () => stopVoice(voice)
}

async function bufferFor(assetId: string, hash: string): Promise<AudioBuffer | null> {
  const key = hash || assetId
  let pending = buffers.get(key)
  if (!pending) {
    pending = (async () => {
      const url = await ensureAssetUrl(assetId)
      const response = await fetch(url)
      const data = await response.arrayBuffer()
      return ensureListener().context.decodeAudioData(data.slice(0))
    })().catch(error => {
      buffers.delete(key)
      console.warn('[audio] 解码失败', error)
      return null as unknown as AudioBuffer
    })
    buffers.set(key, pending)
  }
  const buffer = await pending
  return buffer && buffer.duration > 0 ? buffer : null
}

function trimSfx() {
  const live = voices.filter(item => item.bus === 'sfx' && !item.loop)
  while (live.length >= MAX_SFX) {
    const oldest = live.shift()
    if (oldest) stopVoice(oldest)
  }
}

function fadeStop(voice: Voice) {
  try {
    const gain = (voice.audio.getOutput() as GainNode).gain
    const now = voice.audio.context.currentTime
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0, now + 0.35)
  } catch {
    stopVoice(voice)
    return
  }
  window.setTimeout(() => stopVoice(voice), 400)
}

function stopVoice(voice: Voice) {
  const index = voices.indexOf(voice)
  if (index >= 0) voices.splice(index, 1)
  if (musicId === voice.id) musicId = 0
  try {
    if (voice.audio.isPlaying) voice.audio.stop()
  } catch {
    // 已经停过。
  }
  voice.parent?.remove(voice.audio)
  voice.audio.disconnect()
}

let appliedMix = ''

function applyMix(mix: AudioMix) {
  const key = `${mix.master}|${mix.music}|${mix.sfx}`
  if (key === appliedMix) return
  appliedMix = key
  const ear = listener
  if (ear) ear.gain.gain.value = mix.master
  for (const voice of voices) {
    voice.audio.setVolume(voice.local * (voice.bus === 'music' ? mix.music : mix.sfx))
  }
}

function unit(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? clamp(number, 0, 1) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

registerRuntimeSystem('core.audio', RUNTIME_STAGE.PRE_RENDER, () => {
  const state = useEditorStore.getState()
  applyMix(readAudioMix(state.picture))
  if (state.playState === 'playing') {
    heardPlay = true
    return
  }
  if (!heardPlay) return
  heardPlay = false
  stopAllSounds()
})

installUnlock()
