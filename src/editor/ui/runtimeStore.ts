import { useSyncExternalStore } from 'react'
import { subscribeUiValues, uiValues, writeUiComponent, writeUiVariable } from '../../runtime/ui/values'

export { uiValues, writeUiComponent, writeUiVariable }

export function useUiValues() {
  return useSyncExternalStore(subscribeUiValues, uiValues, uiValues)
}
