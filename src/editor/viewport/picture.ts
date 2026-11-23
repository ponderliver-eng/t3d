import { type Camera, type Object3D, type Scene, type WebGPURenderer } from 'three/webgpu'
import { mix, vec4 } from 'three/tsl'
import { useEditorStore } from '../scene/store'
import type { ScenePicture } from '../scene/types'
import { SelectionOutlineNode } from './selectionOutline'
import { RuntimePicturePipeline } from '../../runtime/picturePipeline'

export class ScenePicturePipeline {
  private readonly runtime: RuntimePicturePipeline
  private outlineNode: SelectionOutlineNode | null = null

  constructor(renderer: WebGPURenderer) {
    this.runtime = new RuntimePicturePipeline(renderer, {
      beforeAntiAlias: (scene, camera, graded) => {
        const outlinePass = new SelectionOutlineNode(scene, camera)
        this.outlineNode = outlinePass
        const outlineSample = outlinePass as unknown as { rgb: unknown; a: unknown }
        const withOutline = vec4(
          mix(graded.rgb as never, outlineSample.rgb as never, outlineSample.a as never),
          graded.a as never,
        )
        return {
          node: withOutline,
          dispose: () => {
            outlinePass.dispose()
            if (this.outlineNode === outlinePass) this.outlineNode = null
          },
        }
      },
      onError: (message) => {
        useEditorStore.getState().log('error', message)
      },
    })
  }

  usesEffects(picture: ScenePicture, hasOutline = false): boolean {
    return this.runtime.usesEffects(picture, hasOutline)
  }

  render(scene: Scene, camera: Camera, picture: ScenePicture, width: number, height: number, outlineTargets: readonly Object3D[] = [], flashTarget: Object3D | null = null) {
    this.runtime.render(scene, camera, picture, width, height, () => {
      if (this.outlineNode) {
        this.outlineNode.selectedRoots.length = 0
        for (const obj of outlineTargets) this.outlineNode.selectedRoots.push(obj)
        this.outlineNode.flashRoot = flashTarget
      }
    })
  }

  async precompile(scene: Scene, camera: Camera, usedEffects: boolean): Promise<void> {
    await this.runtime.precompile(scene, camera, usedEffects)
  }

  dispose() {
    this.runtime.dispose()
    this.outlineNode = null
  }
}
