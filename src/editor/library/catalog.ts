import type { CapabilityId } from '../../capabilities/registry'
import type { MessageKey } from '../i18n'

export type LibraryShelf = 'capability' | 'gameplay' | 'genre' | 'asset'

export interface LibraryItem {
  id: string
  shelf: LibraryShelf
  kind: 'capability' | 'soon'
  capabilityId?: CapabilityId
  name: MessageKey
  detail: MessageKey
  points: MessageKey
  hue: string
}

export const LIBRARY_SHELVES: LibraryShelf[] = ['capability', 'gameplay', 'genre', 'asset']

export const LIBRARY_ITEMS: LibraryItem[] = [
  { id: 'physics', shelf: 'capability', kind: 'capability', capabilityId: 'physics', name: 'library.item.physics', detail: 'library.item.physicsDetail', points: 'library.item.physicsPoints', hue: '#7eb6ff' },
  { id: 'navigation', shelf: 'capability', kind: 'capability', capabilityId: 'navigation', name: 'library.item.navigation', detail: 'library.item.navigationDetail', points: 'library.item.navigationPoints', hue: '#8fd0a4' },
  { id: 'particles', shelf: 'capability', kind: 'capability', capabilityId: 'particles', name: 'library.item.particles', detail: 'library.item.particlesDetail', points: 'library.item.particlesPoints', hue: '#f2cf7f' },
  { id: 'sky', shelf: 'capability', kind: 'capability', capabilityId: 'sky', name: 'library.item.sky', detail: 'library.item.skyDetail', points: 'library.item.skyPoints', hue: '#7eb6ff' },
  { id: 'water', shelf: 'capability', kind: 'capability', capabilityId: 'water', name: 'library.item.water', detail: 'library.item.waterDetail', points: 'library.item.waterPoints', hue: '#38bdf8' },
  { id: 'stats', shelf: 'gameplay', kind: 'soon', name: 'library.item.stats', detail: 'library.item.statsDetail', points: 'library.item.statsPoints', hue: '#e7a3b8' },
  { id: 'combat', shelf: 'gameplay', kind: 'soon', name: 'library.item.combat', detail: 'library.item.combatDetail', points: 'library.item.combatPoints', hue: '#e07a5f' },
  { id: 'perception', shelf: 'gameplay', kind: 'soon', name: 'library.item.perception', detail: 'library.item.perceptionDetail', points: 'library.item.perceptionPoints', hue: '#d4b8ff' },
  { id: 'inventory', shelf: 'gameplay', kind: 'soon', name: 'library.item.inventory', detail: 'library.item.inventoryDetail', points: 'library.item.inventoryPoints', hue: '#f0c27a' },
  { id: 'dialogue', shelf: 'gameplay', kind: 'soon', name: 'library.item.dialogue', detail: 'library.item.dialogueDetail', points: 'library.item.dialoguePoints', hue: '#9fd6c2' },
  { id: 'rts', shelf: 'genre', kind: 'soon', name: 'library.item.rts', detail: 'library.item.rtsDetail', points: 'library.item.rtsPoints', hue: '#f0a35e' },
  { id: 'rpg', shelf: 'genre', kind: 'soon', name: 'library.item.rpg', detail: 'library.item.rpgDetail', points: 'library.item.rpgPoints', hue: '#c9a27a' },
  { id: 'characters', shelf: 'asset', kind: 'soon', name: 'library.item.characters', detail: 'library.item.charactersDetail', points: 'library.item.charactersPoints', hue: '#9bb7e0' },
  { id: 'environments', shelf: 'asset', kind: 'soon', name: 'library.item.environments', detail: 'library.item.environmentsDetail', points: 'library.item.environmentsPoints', hue: '#8fb89a' },
  { id: 'vfx', shelf: 'asset', kind: 'soon', name: 'library.item.vfx', detail: 'library.item.vfxDetail', points: 'library.item.vfxPoints', hue: '#e6c15a' },
]
