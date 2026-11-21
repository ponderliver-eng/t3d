import * as electron from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const { safeStorage } = electron

export interface ProviderConfigPublic {
  id: string
  providerType: 'openai-compatible' | 'openai' | 'anthropic' | 'gemini'
  label: string
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export interface ProviderConfigStored extends Omit<ProviderConfigPublic, 'hasApiKey'> {
  encryptedKey?: string
  plainKey?: string
}

export interface SecretStoreData {
  activeProviderId: string
  providers: ProviderConfigStored[]
}

const DEFAULT_PROVIDERS: ProviderConfigStored[] = [
  {
    id: 'openai-compatible',
    providerType: 'openai-compatible',
    label: 'OpenAI 兼容接口（DeepSeek / 通义 / 本地）',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'openai',
    providerType: 'openai',
    label: 'OpenAI 原生',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  {
    id: 'anthropic',
    providerType: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-7-sonnet-latest',
  },
  {
    id: 'gemini',
    providerType: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-pro',
  },
]

export class SecretStore {
  private readonly filePath: string
  private cache: SecretStoreData | null = null

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'T3D', 'ai-providers.json')
  }

  private async load(): Promise<SecretStoreData> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<SecretStoreData>
      this.cache = {
        activeProviderId: parsed.activeProviderId || 'openai-compatible',
        providers: Array.isArray(parsed.providers) && parsed.providers.length > 0
          ? parsed.providers
          : structuredClone(DEFAULT_PROVIDERS),
      }
    } catch {
      this.cache = {
        activeProviderId: 'openai-compatible',
        providers: structuredClone(DEFAULT_PROVIDERS),
      }
    }
    return this.cache
  }

  private async save(data: SecretStoreData): Promise<void> {
    this.cache = data
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  async listPublic(): Promise<{ activeProviderId: string; providers: ProviderConfigPublic[] }> {
    const data = await this.load()
    return {
      activeProviderId: data.activeProviderId,
      providers: data.providers.map((p) => ({
        id: p.id,
        providerType: p.providerType,
        label: p.label,
        baseUrl: p.baseUrl,
        model: p.model,
        hasApiKey: Boolean(p.encryptedKey || p.plainKey),
      })),
    }
  }

  async saveProvider(input: {
    id: string
    providerType?: ProviderConfigPublic['providerType']
    label?: string
    baseUrl?: string
    model?: string
    apiKey?: string
    setActive?: boolean
  }): Promise<{ activeProviderId: string; providers: ProviderConfigPublic[] }> {
    const data = await this.load()
    let target = data.providers.find((p) => p.id === input.id)
    if (!target) {
      target = {
        id: input.id,
        providerType: input.providerType ?? 'openai-compatible',
        label: input.label ?? input.id,
        baseUrl: input.baseUrl ?? '',
        model: input.model ?? '',
      }
      data.providers.push(target)
    } else {
      if (input.providerType) target.providerType = input.providerType
      if (input.label !== undefined) target.label = input.label
      if (input.baseUrl !== undefined) target.baseUrl = input.baseUrl.trim()
      if (input.model !== undefined) target.model = input.model.trim()
    }

    if (input.apiKey !== undefined) {
      const trimmed = input.apiKey.trim()
      if (!trimmed) {
        delete target.encryptedKey
        delete target.plainKey
      } else if (safeStorage?.isEncryptionAvailable?.()) {
        target.encryptedKey = safeStorage.encryptString(trimmed).toString('base64')
        delete target.plainKey
      } else {
        target.plainKey = trimmed
        delete target.encryptedKey
      }
    }

    if (input.setActive) {
      data.activeProviderId = target.id
    }

    await this.save(data)
    return this.listPublic()
  }

  async setActiveProvider(id: string): Promise<string> {
    const data = await this.load()
    if (data.providers.some((p) => p.id === id)) {
      data.activeProviderId = id
      await this.save(data)
    }
    return data.activeProviderId
  }

  async resolveCredentials(providerId?: string): Promise<{
    config: ProviderConfigPublic
    apiKey: string
  }> {
    const data = await this.load()
    const targetId = providerId || data.activeProviderId
    const found = data.providers.find((p) => p.id === targetId) ?? data.providers[0]
    if (!found) {
      throw new Error('未配置任何模型接入商')
    }
    let apiKey = ''
    if (found.encryptedKey && safeStorage?.isEncryptionAvailable?.()) {
      apiKey = safeStorage.decryptString(Buffer.from(found.encryptedKey, 'base64'))
    } else if (found.plainKey) {
      apiKey = found.plainKey
    }
    if (!apiKey) {
      throw new Error(`模型 "${found.label}" 尚未设置 API Key`)
    }
    return {
      config: {
        id: found.id,
        providerType: found.providerType,
        label: found.label,
        baseUrl: found.baseUrl,
        model: found.model,
        hasApiKey: true,
      },
      apiKey,
    }
  }
}
