import { bindCommandBusToEditor } from './editorAdapter'
import { registerAssetAndUiCommands } from './domains/assetAndUi'
import { registerCapabilityCommands } from './domains/capability'
import { registerCodeAssetCommands } from './domains/codeAssets'
import { registerGameplayCommands } from './domains/gameplay'
import { registerPictureAndProjectCommands } from './domains/pictureAndProject'
import { registerSceneCommands } from './domains/scene'

let registeredCleanup: (() => void) | null = null

/** 绑定编辑器事务适配器并注册核心指令域（幂等） */
export function ensureCoreCommandsRegistered(): () => void {
  if (registeredCleanup) return registeredCleanup
  bindCommandBusToEditor()
  registerCodeAssetCommands()
  const unsubs = [
    registerSceneCommands(),
    registerCapabilityCommands(),
    registerGameplayCommands(),
    registerAssetAndUiCommands(),
    registerPictureAndProjectCommands(),
  ]
  registeredCleanup = () => {
    unsubs.forEach((fn) => fn())
    registeredCleanup = null
  }
  return registeredCleanup
}
