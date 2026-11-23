if(typeof globalThis.localStorage==="undefined"){const m=new Map();globalThis.localStorage={get length(){return m.size},clear:()=>m.clear(),getItem:k=>m.get(k)??null,key:i=>[...m.keys()][i]??null,removeItem:k=>{m.delete(k)},setItem:(k,v)=>{m.set(k,String(v))}};}if(typeof globalThis.document==="undefined"){globalThis.document={documentElement:{style:{}}};}
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/input/actionMap.ts
function cloneDefaultMap() {
  return structuredClone(DEFAULT_INPUT_MAP);
}
function normalizeInputMap(raw) {
  const base = cloneDefaultMap();
  if (!raw || typeof raw !== "object") return base;
  const record = raw;
  const deadzone = typeof record.deadzone === "number" && Number.isFinite(record.deadzone) ? Math.max(0.01, Math.min(0.6, record.deadzone)) : base.deadzone;
  const actions = { ...base.actions };
  if (record.actions && typeof record.actions === "object") {
    for (const [name, value] of Object.entries(record.actions)) {
      if (!value || typeof value !== "object") continue;
      const item = value;
      const type = item.type === "axis2d" ? "axis2d" : "button";
      actions[name] = {
        type,
        label: typeof item.label === "string" && item.label.trim() ? item.label : name,
        keys: Array.isArray(item.keys) ? item.keys.filter((k) => typeof k === "string") : void 0,
        axis: item.axis && typeof item.axis === "object" ? item.axis : void 0,
        gamepadButton: typeof item.gamepadButton === "number" ? item.gamepadButton : void 0,
        gamepadAxes: item.gamepadAxes && typeof item.gamepadAxes === "object" ? item.gamepadAxes : void 0,
        touchControl: item.touchControl === "joystick" || item.touchControl === "button" ? item.touchControl : void 0,
        touchLabel: typeof item.touchLabel === "string" ? item.touchLabel : void 0
      };
    }
  }
  return { version: 1, deadzone, actions };
}
function getInputActionMap() {
  return currentMap;
}
function setInputActionMap(next) {
  currentMap = normalizeInputMap(next);
}
function injectVirtualInput(events) {
  const list = Array.isArray(events) ? events : [events];
  for (const event of list) {
    if (event.type === "clear") {
      virtualKeys.clear();
      virtualActions.clear();
      virtualAxes.clear();
      tappedKeys.clear();
      tappedActions.clear();
      continue;
    }
    if (event.type === "keyDown") {
      if (!virtualKeys.has(event.code)) tappedKeys.add(event.code);
      virtualKeys.add(event.code);
      continue;
    }
    if (event.type === "keyUp") {
      virtualKeys.delete(event.code);
      continue;
    }
    if (event.type === "actionDown") {
      if (!virtualActions.has(event.action)) tappedActions.add(event.action);
      virtualActions.add(event.action);
      continue;
    }
    if (event.type === "actionUp") {
      virtualActions.delete(event.action);
      continue;
    }
    if (event.type === "axis") {
      virtualAxes.set(event.action, {
        x: Math.max(-1, Math.min(1, event.x)),
        y: Math.max(-1, Math.min(1, event.y))
      });
    }
  }
}
function clearAllVirtualInput() {
  injectVirtualInput({ type: "clear" });
}
function isKeyHeld(code) {
  return physicalKeys.has(code) || virtualKeys.has(code);
}
function wasKeyTapped(code) {
  return tappedKeys.has(code);
}
function activeGamepad() {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  const pads = navigator.getGamepads();
  for (const pad of pads) {
    if (pad && pad.connected) return pad;
  }
  return null;
}
function isActionPressed(actionName) {
  if (virtualActions.has(actionName)) return true;
  const binding = currentMap.actions[actionName];
  if (!binding) return false;
  if (binding.keys?.some((code) => isKeyHeld(code))) return true;
  if (typeof binding.gamepadButton === "number") {
    const pad = activeGamepad();
    if (pad?.buttons[binding.gamepadButton]?.pressed) return true;
  }
  return false;
}
function wasActionTapped(actionName) {
  if (tappedActions.has(actionName)) return true;
  const binding = currentMap.actions[actionName];
  if (!binding) return false;
  return Boolean(binding.keys?.some((code) => tappedKeys.has(code)));
}
function getActionAxis2D(actionName) {
  const vAxis = virtualAxes.get(actionName);
  let x = vAxis?.x ?? 0;
  let y = vAxis?.y ?? 0;
  const binding = currentMap.actions[actionName];
  if (binding?.axis) {
    if (binding.axis.right?.some((c) => isKeyHeld(c))) x += 1;
    if (binding.axis.left?.some((c) => isKeyHeld(c))) x -= 1;
    if (binding.axis.up?.some((c) => isKeyHeld(c))) y += 1;
    if (binding.axis.down?.some((c) => isKeyHeld(c))) y -= 1;
  }
  if (binding?.gamepadAxes) {
    const pad = activeGamepad();
    if (pad) {
      const gx = pad.axes[binding.gamepadAxes.x] ?? 0;
      const gyRaw = pad.axes[binding.gamepadAxes.y] ?? 0;
      const gy = binding.gamepadAxes.invertY ? -gyRaw : gyRaw;
      if (Math.abs(gx) > currentMap.deadzone) x += gx;
      if (Math.abs(gy) > currentMap.deadzone) y += gy;
    }
  }
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x, y };
}
function consumeInputFrame() {
  tappedKeys.clear();
  tappedActions.clear();
}
var DEFAULT_INPUT_MAP, currentMap, physicalKeys, virtualKeys, tappedKeys, virtualActions, tappedActions, virtualAxes;
var init_actionMap = __esm({
  "src/core/input/actionMap.ts"() {
    "use strict";
    DEFAULT_INPUT_MAP = {
      version: 1,
      deadzone: 0.15,
      actions: {
        Move: {
          type: "axis2d",
          label: "\u79FB\u52A8",
          axis: {
            up: ["KeyW", "ArrowUp"],
            down: ["KeyS", "ArrowDown"],
            left: ["KeyA", "ArrowLeft"],
            right: ["KeyD", "ArrowRight"]
          },
          gamepadAxes: { x: 0, y: 1, invertY: true },
          touchControl: "joystick"
        },
        Jump: {
          type: "button",
          label: "\u8DF3\u8DC3",
          keys: ["Space"],
          gamepadButton: 0,
          touchControl: "button",
          touchLabel: "\u8DF3"
        },
        Sprint: {
          type: "button",
          label: "\u51B2\u523A\u8DD1",
          keys: ["ShiftLeft", "ShiftRight"],
          gamepadButton: 4
        },
        Dash: {
          type: "button",
          label: "\u95EA\u907F",
          keys: ["KeyC"],
          gamepadButton: 1,
          touchControl: "button",
          touchLabel: "\u95EA"
        },
        Interact: {
          type: "button",
          label: "\u4EA4\u4E92",
          keys: ["KeyE"],
          gamepadButton: 2,
          touchControl: "button",
          touchLabel: "\u4EA4\u4E92"
        },
        Attack: {
          type: "button",
          label: "\u653B\u51FB/\u5F00\u706B",
          keys: ["KeyJ"],
          gamepadButton: 7,
          touchControl: "button",
          touchLabel: "\u653B"
        }
      }
    };
    currentMap = cloneDefaultMap();
    physicalKeys = /* @__PURE__ */ new Set();
    virtualKeys = /* @__PURE__ */ new Set();
    tappedKeys = /* @__PURE__ */ new Set();
    virtualActions = /* @__PURE__ */ new Set();
    tappedActions = /* @__PURE__ */ new Set();
    virtualAxes = /* @__PURE__ */ new Map();
  }
});

// src/runtime/transform.ts
import { Euler, Quaternion, Vector3 } from "three";
function eulerQuaternion(rotation) {
  return new Quaternion().setFromEuler(new Euler(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG, "XYZ"));
}
function worldPose(nodes, id) {
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let current = nodes[id];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? nodes[current.parentId] : void 0;
  }
  chain.reverse();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const localPosition = new Vector3();
  const localScale = new Vector3();
  for (const node of chain) {
    localPosition.set(node.position[0], node.position[1], node.position[2]).multiply(scale).applyQuaternion(quaternion);
    position.add(localPosition);
    quaternion.multiply(eulerQuaternion(node.rotation));
    localScale.set(node.scale[0], node.scale[1], node.scale[2]);
    scale.multiply(localScale);
  }
  return { position, quaternion, scale };
}
var DEG;
var init_transform = __esm({
  "src/runtime/transform.ts"() {
    "use strict";
    DEG = Math.PI / 180;
  }
});

// src/runtime/world.ts
function setRuntimeWorld(world3) {
  activeWorld = world3;
}
function getRuntimeWorld() {
  return activeWorld;
}
var EMPTY_DATABASE, EMPTY_PICTURE, FALLBACK_WORLD, activeWorld;
var init_world = __esm({
  "src/runtime/world.ts"() {
    "use strict";
    EMPTY_DATABASE = { tables: {} };
    EMPTY_PICTURE = {};
    FALLBACK_WORLD = {
      getNodes: () => ({}),
      setNodes: () => {
      },
      updateNode: () => {
      },
      getActiveSceneId: () => "",
      getPicture: () => EMPTY_PICTURE,
      getCapabilities: () => ({}),
      getGameplayPacks: () => ["core"],
      getGameDatabase: () => EMPTY_DATABASE,
      getTags: () => [],
      getAsset: () => void 0,
      listAssets: () => [],
      getPlayState: () => "stopped",
      markPlayDirty: () => {
      },
      log: (level, message) => {
        if (level === "error") console.error("[T3D]", message);
        else if (level === "warn") console.warn("[T3D]", message);
        else console.info("[T3D]", message);
      }
    };
    activeWorld = FALLBACK_WORLD;
  }
});

// src/capabilities/physics/meshCollect.ts
import { Matrix4, Vector3 as Vector32 } from "three";
function meshColliderKey(root) {
  root.updateWorldMatrix(true, true);
  inverse.copy(root.matrixWorld).invert();
  const keys = [];
  root.traverse((child) => {
    const mesh = child;
    const attr2 = mesh.isMesh ? mesh.geometry?.getAttribute("position") : void 0;
    if (!attr2 || attr2.count < 3) return;
    relative.copy(inverse).multiply(mesh.matrixWorld);
    keys.push(mesh.geometry.uuid, String(attr2.count), matrixKey(relative));
  });
  return keys.join("|");
}
function collectMeshCollider(root) {
  root.updateWorldMatrix(true, true);
  inverse.copy(root.matrixWorld).invert();
  const positions = [];
  const indices = [];
  const keys = [];
  root.traverse((child) => {
    const mesh = child;
    if (!mesh.isMesh || !mesh.geometry) return;
    const attr2 = mesh.geometry.getAttribute("position");
    if (!attr2 || attr2.count < 3) return;
    relative.copy(inverse).multiply(mesh.matrixWorld);
    const base = positions.length / 3;
    keys.push(mesh.geometry.uuid, String(attr2.count), matrixKey(relative));
    for (let i = 0; i < attr2.count; i += 1) {
      point.fromBufferAttribute(attr2, i).applyMatrix4(relative);
      positions.push(point.x, point.y, point.z);
    }
    const index = mesh.geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 1) indices.push(base + index.getX(i));
    } else {
      for (let i = 0; i < attr2.count; i += 1) indices.push(base + i);
    }
  });
  if (positions.length < 9 || indices.length < 3) return null;
  return {
    key: keys.join("|"),
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices)
  };
}
function matrixKey(matrix) {
  return matrix.elements.map((value) => value.toFixed(3)).join(",");
}
var point, inverse, relative;
var init_meshCollect = __esm({
  "src/capabilities/physics/meshCollect.ts"() {
    "use strict";
    point = new Vector32();
    inverse = new Matrix4();
    relative = new Matrix4();
  }
});

// src/capabilities/physics/rapierWorld.ts
var rapierWorld_exports = {};
__export(rapierWorld_exports, {
  createRapierWorld: () => createRapierWorld
});
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion as Quaternion2, Vector3 as Vector33 } from "three";
async function createRapierWorld() {
  await RAPIER.init();
  const world3 = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world3.timestep = STEP;
  const bodies = /* @__PURE__ */ new Map();
  const bodyByHandle = /* @__PURE__ */ new Map();
  const puppets = /* @__PURE__ */ new Map();
  let pending3 = 0;
  let frameIndex = 0;
  let interactFrame = -1;
  const controller2 = world3.createCharacterController(SKIN);
  controller2.setUp({ x: 0, y: 1, z: 0 });
  controller2.setSlideEnabled(true);
  controller2.enableAutostep(0.3, 0.18, true);
  controller2.enableSnapToGround(0.25);
  controller2.setMaxSlopeClimbAngle(CLIMB);
  controller2.setMinSlopeSlideAngle(SLIDE);
  const api = {
    setGravity(gravity) {
      world3.gravity = { x: gravity[0], y: gravity[1], z: gravity[2] };
    },
    sync(next) {
      const seen = /* @__PURE__ */ new Set();
      for (const desc of next) {
        seen.add(desc.id);
        const signature = signatureOf(desc);
        let live = bodies.get(desc.id);
        if (!live || live.signature !== signature) {
          if (live) {
            bodyByHandle.delete(live.body.handle);
            world3.removeRigidBody(live.body);
          }
          const created = createBody(world3, desc);
          live = {
            body: created,
            signature,
            kind: desc.body,
            prev: [desc.position[0], desc.position[1], desc.position[2]],
            prevRot: [desc.rotation[0], desc.rotation[1], desc.rotation[2], desc.rotation[3]],
            yawDelta: 0,
            characterForces: [],
            forceFrame: 0
          };
          bodies.set(desc.id, live);
          bodyByHandle.set(created.handle, live);
        }
        if (desc.body !== "dynamic") writePose(live.body, desc);
        const data = bodyData(live.body);
        if (desc.body === "kinematic") {
          data.platform = [
            desc.position[0] - live.prev[0],
            desc.position[1] - live.prev[1],
            desc.position[2] - live.prev[2]
          ];
          live.prev = [desc.position[0], desc.position[1], desc.position[2]];
        } else {
          data.platform = [0, 0, 0];
        }
      }
      for (const [id, live] of bodies) {
        if (seen.has(id)) continue;
        bodyByHandle.delete(live.body.handle);
        world3.removeRigidBody(live.body);
        bodies.delete(id);
      }
    },
    step(dt, beforeSubstep) {
      frameIndex += 1;
      for (const [id, puppet] of puppets) {
        if (puppet.lastFrame >= frameIndex - 1) continue;
        world3.removeRigidBody(puppet.body);
        puppets.delete(id);
      }
      pending3 = Math.min(pending3 + Math.max(0, dt), MAX_FRAME);
      for (const live of bodies.values()) live.yawDelta = 0;
      const perFrame = interactFrame >= frameIndex - 1;
      let count;
      let sub;
      if (perFrame) {
        if (pending3 < MIN_STEP) return;
        count = Math.max(1, Math.ceil(pending3 / STEP - 1e-6));
        sub = pending3 / count;
        pending3 = 0;
      } else {
        count = Math.floor(pending3 / STEP + 1e-9);
        if (count === 0) return;
        sub = STEP;
        pending3 = Math.max(0, pending3 - count * STEP);
      }
      world3.timestep = sub;
      for (const live of bodies.values()) {
        if (live.kind !== "dynamic") continue;
        const r = live.body.rotation();
        live.prevRot[0] = r.x;
        live.prevRot[1] = r.y;
        live.prevRot[2] = r.z;
        live.prevRot[3] = r.w;
      }
      for (let i = 0; i < count; i += 1) {
        for (const live of bodies.values()) {
          if (live.kind !== "dynamic") continue;
          live.body.resetForces(false);
          live.body.resetTorques(false);
          for (const item of live.characterForces) {
            live.body.addForceAtPoint(
              { x: item.force[0], y: item.force[1], z: item.force[2] },
              { x: item.point[0], y: item.point[1], z: item.point[2] },
              true
            );
          }
        }
        beforeSubstep?.(sub);
        world3.step();
      }
      for (const live of bodies.values()) {
        if (live.kind !== "dynamic") continue;
        live.characterForces.length = 0;
        const r = live.body.rotation();
        tmpPrevQuat.set(live.prevRot[0], live.prevRot[1], live.prevRot[2], live.prevRot[3]).invert();
        tmpCurrQuat.set(r.x, r.y, r.z, r.w);
        tmpDeltaQuat.multiplyQuaternions(tmpCurrQuat, tmpPrevQuat);
        live.yawDelta = Math.atan2(
          2 * (tmpDeltaQuat.w * tmpDeltaQuat.y + tmpDeltaQuat.x * tmpDeltaQuat.z),
          1 - 2 * (tmpDeltaQuat.y * tmpDeltaQuat.y + tmpDeltaQuat.z * tmpDeltaQuat.z)
        );
      }
    },
    moveCharacters(moves) {
      const results = [];
      const gravityMag = Math.abs(world3.gravity.y);
      const pushForce = (live, force, point2) => {
        if (live.forceFrame !== frameIndex) {
          live.forceFrame = frameIndex;
          live.characterForces.length = 0;
        }
        live.characterForces.push({ force, point: point2 });
      };
      for (const move of moves) {
        const puppet = ensurePuppet(world3, puppets, move);
        puppet.lastFrame = frameIndex;
        const half = capsuleHalf(puppet.height, puppet.radius);
        const interact = move.interact === true;
        if (interact) interactFrame = frameIndex;
        const exclude = (collider) => {
          const id = collider.parent()?.userData?.id;
          return id !== move.id;
        };
        const charMass = Math.max(1, move.mass ?? 65);
        const pushStrength = Math.max(0, move.pushStrength ?? 1);
        const moveDt = Math.max(1 / 480, move.dt ?? STEP);
        const charVx = move.displacement[0] / moveDt;
        const charVy = move.displacement[1] / moveDt;
        const charVz = move.displacement[2] / moveDt;
        let startX = move.position[0];
        let startY = move.position[1];
        let startZ = move.position[2];
        let yawDelta = 0;
        const moved = Math.hypot(startX - puppet.lastOut[0], startY - puppet.lastOut[1], startZ - puppet.lastOut[2]);
        if (moved > TELEPORT_DISTANCE) puppet.standingHandle = null;
        if (charVy <= JUMP_SPEED && puppet.standingHandle !== null) {
          const stood2 = bodyByHandle.get(puppet.standingHandle);
          if (stood2 && stood2.kind === "dynamic" && interact) {
            const currT = stood2.body.translation();
            const currR = stood2.body.rotation();
            tmpCurrQuat.set(currR.x, currR.y, currR.z, currR.w);
            tmpRel.set(puppet.localAnchor[0], puppet.localAnchor[1], puppet.localAnchor[2]).applyQuaternion(tmpCurrQuat);
            startX = currT.x + tmpRel.x;
            startY = currT.y + tmpRel.y;
            startZ = currT.z + tmpRel.z;
            yawDelta = stood2.yawDelta;
          } else if (stood2 && stood2.kind === "kinematic") {
            const plat = bodyData(stood2.body).platform;
            startX += plat[0];
            startY += plat[1];
            startZ += plat[2];
          }
        }
        puppet.body.setTranslation({
          x: startX,
          y: startY + half + puppet.radius,
          z: startZ
        }, true);
        controller2.computeColliderMovement(
          puppet.collider,
          { x: move.displacement[0], y: move.displacement[1], z: move.displacement[2] },
          void 0,
          void 0,
          exclude
        );
        const computed = controller2.computedMovement();
        const grounded = controller2.computedGrounded();
        const x = startX + computed.x;
        const y = startY + computed.y;
        const z = startZ + computed.z;
        let impX = 0;
        let impY = 0;
        let impZ = 0;
        let support = null;
        let supportX = x;
        let supportY = y;
        let supportZ = z;
        const pushedHandles = /* @__PURE__ */ new Set();
        const count = controller2.numComputedCollisions();
        for (let i = 0; i < count; i += 1) {
          const hit = controller2.computedCollision(i);
          if (!hit) continue;
          const parentBody = hit.collider?.parent();
          if (!parentBody) continue;
          const live = bodyByHandle.get(parentBody.handle);
          const isSupport = grounded && hit.normal1.y > SUPPORT_NORMAL;
          if (isSupport && !support) {
            support = parentBody;
            supportX = hit.witness1.x;
            supportY = hit.witness1.y;
            supportZ = hit.witness1.z;
          }
          if (!interact || !live || live.kind !== "dynamic") continue;
          const horizNormal = Math.hypot(hit.normal1.x, hit.normal1.z);
          if (!isSupport && horizNormal > 0.25 && pushStrength > 0 && !pushedHandles.has(parentBody.handle)) {
            const nx = hit.normal1.x / horizNormal;
            const nz = hit.normal1.z / horizNormal;
            const charAlong = -(charVx * nx + charVz * nz);
            const bv = live.body.linvel();
            const boxAlong = -(bv.x * nx + bv.z * nz);
            const diff = charAlong - boxAlong;
            if (charAlong > 0.05 && diff > 0.02) {
              pushedHandles.add(parentBody.handle);
              const bodyMass = live.body.mass();
              const effectiveMass = Math.min(charMass, bodyMass * 2);
              const forceMag = effectiveMass * Math.min(diff, 6) * 20 * pushStrength;
              pushForce(live, [-nx * forceMag, 0, -nz * forceMag], [hit.witness1.x, hit.witness1.y, hit.witness1.z]);
            }
          }
          if (!isSupport) {
            const bv = live.body.linvel();
            const bw = live.body.angvel();
            const bt = live.body.translation();
            const rx = hit.witness1.x - bt.x;
            const ry = hit.witness1.y - bt.y;
            const rz = hit.witness1.z - bt.z;
            const pvx = bv.x + (bw.y * rz - bw.z * ry);
            const pvy = bv.y + (bw.z * rx - bw.x * rz);
            const pvz = bv.z + (bw.x * ry - bw.y * rx);
            const relApproach = (pvx - charVx) * hit.normal1.x + (pvy - charVy) * hit.normal1.y + (pvz - charVz) * hit.normal1.z;
            if (relApproach > 1.4) {
              const bodyMass = live.body.mass();
              const ratio = bodyMass / (bodyMass + charMass);
              const kick = (relApproach - 1.4) * ratio * 0.9;
              impX += hit.normal1.x * kick;
              impY += Math.max(0, hit.normal1.y) * kick * 0.6;
              impZ += hit.normal1.z * kick;
            }
          }
        }
        if (grounded && !support) {
          const hit = world3.castShape(
            { x, y: y + half + puppet.radius, z },
            IDENTITY_ROTATION,
            DOWN,
            puppet.collider.shape,
            0,
            SUPPORT_REACH,
            true,
            void 0,
            void 0,
            puppet.collider,
            puppet.body
          );
          const parentBody = hit?.collider.parent();
          if (hit && parentBody && hit.normal1.y > SUPPORT_NORMAL) {
            support = parentBody;
            supportX = hit.witness1.x;
            supportY = hit.witness1.y;
            supportZ = hit.witness1.z;
          }
        }
        const stood = support ? bodyByHandle.get(support.handle) : void 0;
        puppet.standingHandle = support ? support.handle : null;
        if (stood && stood.kind === "dynamic" && interact) {
          pushForce(stood, [0, -charMass * gravityMag, 0], [supportX, supportY, supportZ]);
          const currT = stood.body.translation();
          const currR = stood.body.rotation();
          tmpCurrQuat.set(currR.x, currR.y, currR.z, currR.w).invert();
          tmpRel.set(x - currT.x, y - currT.y, z - currT.z).applyQuaternion(tmpCurrQuat);
          puppet.localAnchor[0] = tmpRel.x;
          puppet.localAnchor[1] = tmpRel.y;
          puppet.localAnchor[2] = tmpRel.z;
        }
        puppet.body.setNextKinematicTranslation({ x, y: y + half + puppet.radius, z });
        puppet.lastOut[0] = x;
        puppet.lastOut[1] = y;
        puppet.lastOut[2] = z;
        const result = { id: move.id, position: [x, y, z], grounded };
        if (Math.abs(yawDelta) > 1e-6) result.yawDelta = yawDelta;
        if (Math.abs(impX) > 1e-3 || Math.abs(impY) > 1e-3 || Math.abs(impZ) > 1e-3) {
          result.impulse = [impX, impY, impZ];
        }
        results.push(result);
      }
      return results;
    },
    dynamicPoses() {
      const poses = [];
      for (const [id, live] of bodies) {
        if (live.kind !== "dynamic") continue;
        const position = live.body.translation();
        const rotation = live.body.rotation();
        poses.push({
          id,
          position: [position.x, position.y, position.z],
          rotation: [rotation.x, rotation.y, rotation.z, rotation.w]
        });
      }
      return poses;
    },
    bodyState(id) {
      const live = bodies.get(id);
      if (!live || live.kind !== "dynamic") return null;
      const position = live.body.translation();
      const rotation = live.body.rotation();
      const linvel = live.body.linvel();
      const angvel = live.body.angvel();
      return {
        id,
        position: [position.x, position.y, position.z],
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        linvel: [linvel.x, linvel.y, linvel.z],
        angvel: [angvel.x, angvel.y, angvel.z],
        mass: live.body.mass()
      };
    },
    applyForceAtPoint(id, force, worldPoint) {
      const live = bodies.get(id);
      if (!live || live.kind !== "dynamic") return;
      live.body.addForceAtPoint(
        { x: force[0], y: force[1], z: force[2] },
        { x: worldPoint[0], y: worldPoint[1], z: worldPoint[2] },
        true
      );
    },
    applyTorque(id, torque) {
      const live = bodies.get(id);
      if (!live || live.kind !== "dynamic") return;
      live.body.addTorque({ x: torque[0], y: torque[1], z: torque[2] }, true);
    },
    setLinearVelocity(id, velocity) {
      const live = bodies.get(id);
      if (!live || live.kind !== "dynamic") return;
      live.body.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
    },
    applyImpulse(id, impulse) {
      const live = bodies.get(id);
      if (!live || live.kind !== "dynamic") return;
      live.body.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
    },
    dispose() {
      controller2.free();
      puppets.clear();
      bodies.clear();
      bodyByHandle.clear();
      world3.free();
    }
  };
  return api;
}
function createBody(world3, desc) {
  const bodyDesc = desc.body === "dynamic" ? RAPIER.RigidBodyDesc.dynamic() : desc.body === "kinematic" ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
  bodyDesc.setTranslation(desc.position[0], desc.position[1], desc.position[2]).setRotation({ x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3] }).setLinearDamping(Math.max(0, desc.linearDamping)).setAngularDamping(Math.max(0, desc.angularDamping)).setGravityScale(desc.gravityScale);
  if (desc.body === "dynamic") bodyDesc.setAdditionalMass(Math.max(1e-3, desc.mass));
  const body = world3.createRigidBody(bodyDesc);
  body.userData = { id: desc.id, platform: [0, 0, 0] };
  world3.createCollider(colliderDesc(desc), body);
  return body;
}
function bodyData(body) {
  const data = body.userData;
  if (data) return data;
  const created = { id: "", platform: [0, 0, 0] };
  body.userData = created;
  return created;
}
function capsuleHalf(height, radius) {
  return Math.max(0.02, height * 0.5 - radius);
}
function ensurePuppet(world3, puppets, move) {
  const radius = Math.max(0.05, move.radius);
  const height = Math.max(radius * 2 + 0.08, move.height);
  const current = puppets.get(move.id);
  if (current && Math.abs(current.radius - radius) < 1e-3 && Math.abs(current.height - height) < 1e-3) return current;
  if (current) world3.removeRigidBody(current.body);
  const half = capsuleHalf(height, radius);
  const body = world3.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    move.position[0],
    move.position[1] + half + radius,
    move.position[2]
  ));
  body.userData = { id: move.id, platform: [0, 0, 0] };
  const collider = world3.createCollider(RAPIER.ColliderDesc.capsule(half, radius).setFriction(0), body);
  const puppet = {
    body,
    collider,
    radius,
    height,
    standingHandle: null,
    localAnchor: [0, 0, 0],
    lastOut: [move.position[0], move.position[1], move.position[2]],
    lastFrame: 0
  };
  puppets.set(move.id, puppet);
  return puppet;
}
function scaledPositions(source, sx, sy, sz) {
  if (Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 && Math.abs(sz - 1) < 1e-4) return source;
  const scaled = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 3) {
    scaled[i] = source[i] * sx;
    scaled[i + 1] = source[i + 1] * sy;
    scaled[i + 2] = source[i + 2] * sz;
  }
  return scaled;
}
function colliderDesc(desc) {
  const collider = shapeDesc(desc);
  collider.setSensor(desc.trigger);
  collider.setFriction(Math.max(0, desc.friction));
  collider.setRestitution(Math.max(0, desc.restitution));
  if (desc.collisionGroups !== void 0) collider.setCollisionGroups(desc.collisionGroups);
  return collider;
}
function shapeDesc(desc) {
  const sx = Math.max(1e-3, desc.scale[0]);
  const sy = Math.max(1e-3, desc.scale[1]);
  const sz = Math.max(1e-3, desc.scale[2]);
  if (desc.shape === "sphere") {
    const radius = Math.max(1e-3, desc.size[0]) * Math.max(sx, sy, sz);
    return RAPIER.ColliderDesc.ball(radius);
  }
  if (desc.shape === "capsule") {
    const radius = Math.max(1e-3, desc.size[0]) * Math.max(sx, sz);
    const half = Math.max(1e-3, desc.size[1] * 0.5 * sy - radius);
    return RAPIER.ColliderDesc.capsule(half, radius);
  }
  if ((desc.shape === "convex" || desc.shape === "trimesh") && desc.mesh && desc.mesh.positions.length >= 9) {
    const positions = scaledPositions(desc.mesh.positions, sx, sy, sz);
    if (desc.shape === "convex") {
      const hull = RAPIER.ColliderDesc.convexHull(positions);
      if (hull) return hull;
    } else if (desc.mesh.indices.length >= 3) {
      return RAPIER.ColliderDesc.trimesh(positions, desc.mesh.indices);
    }
  }
  return RAPIER.ColliderDesc.cuboid(
    Math.max(1e-3, desc.size[0] * 0.5 * sx),
    Math.max(1e-3, desc.size[1] * 0.5 * sy),
    Math.max(1e-3, desc.size[2] * 0.5 * sz)
  );
}
function writePose(body, desc) {
  const pos = { x: desc.position[0], y: desc.position[1], z: desc.position[2] };
  const rot = { x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3] };
  if (desc.body === "kinematic") {
    body.setNextKinematicTranslation(pos);
    body.setNextKinematicRotation(rot);
    return;
  }
  body.setTranslation(pos, false);
  body.setRotation(rot, false);
}
function signatureOf(desc) {
  return [
    desc.body,
    desc.shape,
    desc.trigger ? 1 : 0,
    desc.size.map((n) => n.toFixed(3)).join(","),
    desc.scale.map((n) => n.toFixed(3)).join(","),
    desc.mass.toFixed(3),
    desc.friction.toFixed(3),
    desc.restitution.toFixed(3),
    desc.linearDamping.toFixed(3),
    desc.angularDamping.toFixed(3),
    desc.gravityScale.toFixed(3),
    desc.collisionGroups ?? "all",
    desc.mesh?.key ?? ""
  ].join("|");
}
var STEP, MAX_FRAME, MIN_STEP, CLIMB, SLIDE, SKIN, SUPPORT_REACH, SUPPORT_NORMAL, JUMP_SPEED, TELEPORT_DISTANCE, DOWN, IDENTITY_ROTATION, tmpPrevQuat, tmpCurrQuat, tmpDeltaQuat, tmpRel;
var init_rapierWorld = __esm({
  "src/capabilities/physics/rapierWorld.ts"() {
    "use strict";
    STEP = 1 / 60;
    MAX_FRAME = STEP * 4;
    MIN_STEP = 1 / 480;
    CLIMB = 46 * Math.PI / 180;
    SLIDE = 50 * Math.PI / 180;
    SKIN = 0.03;
    SUPPORT_REACH = SKIN + 0.07;
    SUPPORT_NORMAL = 0.55;
    JUMP_SPEED = 0.5;
    TELEPORT_DISTANCE = 0.5;
    DOWN = { x: 0, y: -1, z: 0 };
    IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
    tmpPrevQuat = new Quaternion2();
    tmpCurrQuat = new Quaternion2();
    tmpDeltaQuat = new Quaternion2();
    tmpRel = new Vector33();
  }
});

// src/capabilities/physics/session.ts
function registerPhysicsExtension(id, order, step2) {
  const index = extensions.findIndex((item) => item.id === id);
  if (index >= 0) extensions.splice(index, 1);
  extensions.push({ id, order, step: step2 });
  extensions.sort((a, b) => a.order - b.order);
  return () => {
    const idx = extensions.findIndex((item) => item.id === id);
    if (idx >= 0) extensions.splice(idx, 1);
  };
}
function getPhysicsBodyState(id) {
  return world?.bodyState(id) ?? null;
}
function setPhysicsVelocity(id, velocity) {
  world?.setLinearVelocity(id, velocity);
}
function applyPhysicsImpulse(id, impulse) {
  world?.applyImpulse(id, impulse);
}
function applyPhysicsForce(id, force) {
  const st = world?.bodyState(id);
  if (!st || !world) return;
  world.applyForceAtPoint(id, force, st.position);
}
function tickPhysics(dt, resolveObject) {
  const runtime2 = getRuntimeWorld();
  const enabled = capabilityEnabled(runtime2.getCapabilities(), "physics");
  const playState = runtime2.getPlayState();
  if (!enabled || playState === "stopped") {
    disposePhysics();
    return;
  }
  if (playState !== "playing") return;
  if (!world) {
    boot();
    return;
  }
  const currentWorld = world;
  currentWorld.setGravity(runtime2.getPicture().gravity ?? [0, -9.81, 0]);
  currentWorld.sync(collectBodies(resolveObject));
  currentWorld.step(dt, (subDt) => {
    for (const ext of extensions) {
      ext.step({ dt: subDt, world: currentWorld, resolveObject });
    }
  });
  const poses = world.dynamicPoses();
  if (resolveObject) {
    for (const pose of poses) {
      const obj = resolveObject(pose.id);
      if (!obj) continue;
      obj.position.set(pose.position[0], pose.position[1], pose.position[2]);
      obj.quaternion.set(pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]);
    }
    const now = performance.now();
    if (now - lastInspectorSync >= 120) {
      lastInspectorSync = now;
      const selected = new Set(runtime2.getSelection?.() ?? []);
      const selectedPoses = poses.filter((pose) => selected.has(pose.id));
      if (selectedPoses.length > 0) runtime2.applySimulation?.(selectedPoses);
    }
    return;
  }
  runtime2.applySimulation?.(poses);
}
function boot() {
  if (booting) return;
  booting = true;
  void Promise.resolve().then(() => (init_rapierWorld(), rapierWorld_exports)).then(async (module) => {
    if (world) return;
    world = await module.createRapierWorld();
  }).catch((error) => {
    console.warn("[physics] Rapier \u521D\u59CB\u5316\u5931\u8D25", error);
  }).finally(() => {
    booting = false;
  });
}
function disposePhysics() {
  world?.dispose();
  world = null;
  meshCache.clear();
}
function collectBodies(resolveObject) {
  const runtime2 = getRuntimeWorld();
  const nodes = runtime2.getNodes();
  const bodies = [];
  for (const node of Object.values(nodes)) {
    if (!node.physics || !node.visible) continue;
    const pose = worldPose(nodes, node.id);
    bodies.push({
      id: node.id,
      body: node.physics.body,
      shape: node.physics.shape,
      size: node.physics.size,
      position: [pose.position.x, pose.position.y, pose.position.z],
      rotation: [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w],
      scale: [Math.abs(pose.scale.x), Math.abs(pose.scale.y), Math.abs(pose.scale.z)],
      trigger: node.physics.trigger,
      mass: node.physics.mass,
      friction: node.physics.friction,
      restitution: node.physics.restitution,
      linearDamping: node.physics.linearDamping,
      angularDamping: node.physics.angularDamping,
      gravityScale: node.physics.gravityScale,
      collisionGroups: runtime2.collisionGroupsForLayer?.(node.renderLayerId) ?? 4294967295,
      mesh: node.physics.shape === "convex" || node.physics.shape === "trimesh" ? meshFor(node.id, resolveObject?.(node.id) ?? null) : void 0
    });
  }
  return bodies;
}
function meshFor(id, object) {
  if (!object) {
    meshCache.delete(id);
    return void 0;
  }
  const key = meshColliderKey(object);
  const cached = meshCache.get(id);
  if (cached && cached.key === key) return cached;
  const built = collectMeshCollider(object);
  if (!built) {
    meshCache.delete(id);
    return void 0;
  }
  meshCache.set(id, built);
  return built;
}
var world, booting, lastInspectorSync, meshCache, extensions;
var init_session = __esm({
  "src/capabilities/physics/session.ts"() {
    "use strict";
    init_registry2();
    init_transform();
    init_world();
    init_meshCollect();
    world = null;
    booting = false;
    lastInspectorSync = 0;
    meshCache = /* @__PURE__ */ new Map();
    extensions = [];
  }
});

// src/capabilities/water/defaults.ts
function defaultWater() {
  return {
    enabled: false,
    preset: "tropical",
    quality: "balanced",
    ...WATER_STYLE_PRESETS.tropical,
    ...WATER_QUALITY_PRESETS.balanced,
    foamTrail: 1,
    swellRate: 1,
    debugView: "off",
    underwaterEffect: false,
    underwaterColor: "#0d5c75",
    underwaterFogDensity: 0.25,
    underwaterFogStart: 0.5,
    underwaterTint: 0.15,
    underwaterSurfaceBrightness: 0.45,
    normalMapAssetId: null,
    foamMapAssetId: null
  };
}
function normalizeWater(raw) {
  const base = defaultWater();
  if (!raw || typeof raw !== "object") return base;
  const record = raw;
  const preset = record.preset && record.preset in WATER_STYLE_PRESETS ? record.preset : base.preset;
  const quality = record.quality && record.quality in WATER_QUALITY_PRESETS ? record.quality : base.quality;
  const qualPreset = WATER_QUALITY_PRESETS[quality];
  return {
    enabled: record.enabled === true,
    preset,
    quality,
    shallowColor: typeof record.shallowColor === "string" ? record.shallowColor : base.shallowColor,
    deepColor: typeof record.deepColor === "string" ? record.deepColor : base.deepColor,
    foamColor: typeof record.foamColor === "string" ? record.foamColor : base.foamColor,
    sunColor: typeof record.sunColor === "string" ? record.sunColor : base.sunColor,
    depthAbsorption: finite(record.depthAbsorption, base.depthAbsorption, 0.1, 30),
    opacity: finite(record.opacity, base.opacity, 0.05, 1),
    normalScale: finite(record.normalScale, base.normalScale, 0, 3),
    waveScale: finite(record.waveScale, base.waveScale, 0.01, 1),
    flowSpeed: finite(record.flowSpeed, base.flowSpeed, 0, 5),
    flowDirection: finite(record.flowDirection, base.flowDirection, 0, 360),
    fresnelPower: finite(record.fresnelPower, base.fresnelPower, 0.5, 10),
    reflectivity: finite(record.reflectivity, base.reflectivity, 0, 1),
    specularStrength: finite(record.specularStrength, base.specularStrength, 0, 5),
    specularSize: finite(record.specularSize, base.specularSize, 0.02, 1),
    sssStrength: finite(record.sssStrength, base.sssStrength, 0, 3),
    foamWidth: finite(record.foamWidth, base.foamWidth, 0, 4),
    foamIntensity: finite(record.foamIntensity, base.foamIntensity, 0, 3),
    foamScale: finite(record.foamScale, base.foamScale, 0.01, 2),
    crestFoam: finite(record.crestFoam, base.crestFoam, 0, 2),
    crestFoamThreshold: finite(record.crestFoamThreshold, base.crestFoamThreshold, 0, 0.9),
    foamTrail: finite(record.foamTrail, base.foamTrail, 0, 1.5),
    swellRate: finite(record.swellRate, base.swellRate, 0, 4),
    debugView: record.debugView && WATER_DEBUG_VIEWS.includes(record.debugView) ? record.debugView : "off",
    waveHeight: finite(record.waveHeight, base.waveHeight, 0, 3),
    waveSpeed: finite(record.waveSpeed, base.waveSpeed, 0, 4),
    waveSteepness: finite(record.waveSteepness, base.waveSteepness, 0, 1),
    waveBend: finite(record.waveBend, base.waveBend, 0, 1),
    waveLean: finite(record.waveLean, base.waveLean, 0, 1),
    crestSharpness: finite(record.crestSharpness, base.crestSharpness, 0, 1),
    reflectionScale: finite(record.reflectionScale, qualPreset.reflectionScale, 0, 1),
    softEdge: finite(record.softEdge, base.softEdge, 0, 1),
    planarReflection: typeof record.planarReflection === "boolean" ? record.planarReflection : qualPreset.planarReflection,
    refraction: typeof record.refraction === "boolean" ? record.refraction : qualPreset.refraction,
    caustics: typeof record.caustics === "boolean" ? record.caustics : qualPreset.caustics,
    causticsStrength: finite(record.causticsStrength, base.causticsStrength, 0, 2),
    causticsScale: finite(record.causticsScale, base.causticsScale, 0.04, 2),
    shoreFoam: typeof record.shoreFoam === "boolean" ? record.shoreFoam : qualPreset.shoreFoam,
    underwaterEffect: record.underwaterEffect === true,
    underwaterColor: typeof record.underwaterColor === "string" ? record.underwaterColor : base.underwaterColor,
    underwaterFogDensity: finite(record.underwaterFogDensity, base.underwaterFogDensity, 0.01, 2),
    underwaterFogStart: finite(record.underwaterFogStart, base.underwaterFogStart, 0, 20),
    underwaterTint: finite(record.underwaterTint, base.underwaterTint, 0, 1),
    underwaterSurfaceBrightness: finite(record.underwaterSurfaceBrightness, base.underwaterSurfaceBrightness, 0.05, 2),
    normalMapAssetId: typeof record.normalMapAssetId === "string" ? record.normalMapAssetId : null,
    foamMapAssetId: typeof record.foamMapAssetId === "string" ? record.foamMapAssetId : null
  };
}
function finite(value, fallback, min3, max4) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max4, Math.max(min3, value));
}
var WATER_CAPABILITY_ID, WATER_DEBUG_VIEWS, WATER_QUALITY_PRESETS, WATER_STYLE_PRESETS;
var init_defaults = __esm({
  "src/capabilities/water/defaults.ts"() {
    "use strict";
    WATER_CAPABILITY_ID = "water";
    WATER_DEBUG_VIEWS = ["off", "height", "squeeze", "foam"];
    WATER_QUALITY_PRESETS = {
      fast: { reflectionScale: 0, waveHeight: 0, planarReflection: false, refraction: false, caustics: false, shoreFoam: true },
      balanced: { reflectionScale: 0.5, waveHeight: 0, planarReflection: true, refraction: true, caustics: true, shoreFoam: true },
      ultra: { reflectionScale: 0.75, waveHeight: 0.04, planarReflection: true, refraction: true, caustics: true, shoreFoam: true }
    };
    WATER_STYLE_PRESETS = {
      tropical: {
        shallowColor: "#14b8a6",
        deepColor: "#063354",
        foamColor: "#f8fafc",
        sunColor: "#fff7e0",
        depthAbsorption: 1.7,
        opacity: 0.83,
        normalScale: 2,
        waveScale: 0.08,
        flowSpeed: 0.9,
        flowDirection: 32,
        fresnelPower: 5,
        reflectivity: 0.18,
        specularStrength: 3.95,
        specularSize: 0.58,
        sssStrength: 1.5,
        foamWidth: 0.4,
        foamIntensity: 0.75,
        foamScale: 0.1,
        crestFoam: 0.55,
        crestFoamThreshold: 0.42,
        waveHeight: 0.35,
        waveSpeed: 0.35,
        waveSteepness: 0.65,
        waveBend: 0.6,
        waveLean: 0.5,
        crestSharpness: 0.5,
        softEdge: 0.08,
        causticsStrength: 0.7,
        causticsScale: 0.22
      },
      ocean: {
        shallowColor: "#0369a1",
        deepColor: "#071b33",
        foamColor: "#e2e8f0",
        sunColor: "#ffefcc",
        depthAbsorption: 0.4,
        opacity: 0.65,
        normalScale: 2.65,
        waveScale: 0.06,
        flowSpeed: 0.15,
        flowDirection: 209,
        fresnelPower: 5,
        reflectivity: 0.16,
        specularStrength: 4,
        specularSize: 0.34,
        sssStrength: 0.95,
        foamWidth: 0.35,
        foamIntensity: 0.25,
        foamScale: 0.48,
        crestFoam: 0.85,
        crestFoamThreshold: 0.44,
        waveHeight: 1.48,
        waveSpeed: 0.55,
        waveSteepness: 1,
        waveBend: 0.15,
        waveLean: 0.95,
        crestSharpness: 0.8,
        softEdge: 0.22,
        causticsStrength: 0.25,
        causticsScale: 0.16
      },
      lake: {
        shallowColor: "#155e63",
        deepColor: "#08222a",
        foamColor: "#cbd5e1",
        sunColor: "#fff3d6",
        depthAbsorption: 1.3,
        opacity: 0.42,
        normalScale: 2,
        waveScale: 0.08,
        flowSpeed: 0.22,
        flowDirection: 45,
        fresnelPower: 5.2,
        reflectivity: 0.18,
        specularStrength: 3.95,
        specularSize: 0.68,
        sssStrength: 0.55,
        foamWidth: 0.15,
        foamIntensity: 0.4,
        foamScale: 0.08,
        crestFoam: 0.2,
        crestFoamThreshold: 0.5,
        waveHeight: 0.04,
        waveSpeed: 0.35,
        waveSteepness: 0.35,
        waveBend: 0.5,
        waveLean: 0.3,
        crestSharpness: 0.3,
        softEdge: 0.08,
        causticsStrength: 0.35,
        causticsScale: 0.24
      },
      pool: {
        shallowColor: "#38bdf8",
        deepColor: "#0284c7",
        foamColor: "#ffffff",
        sunColor: "#ffffff",
        depthAbsorption: 4.5,
        opacity: 0.07,
        normalScale: 2,
        waveScale: 0.08,
        flowSpeed: 0.25,
        flowDirection: 15,
        fresnelPower: 4.2,
        reflectivity: 0.3,
        specularStrength: 4,
        specularSize: 0.34,
        sssStrength: 0.2,
        foamWidth: 0.1,
        foamIntensity: 0,
        foamScale: 0.1,
        crestFoam: 0,
        crestFoamThreshold: 0.5,
        waveHeight: 0,
        waveSpeed: 0.35,
        waveSteepness: 0.2,
        waveBend: 0.4,
        waveLean: 0.2,
        crestSharpness: 0.2,
        softEdge: 0.03,
        causticsStrength: 0.95,
        causticsScale: 0.36
      },
      stylized: {
        shallowColor: "#06b6d4",
        deepColor: "#1e40af",
        foamColor: "#ffffff",
        sunColor: "#fffbeb",
        depthAbsorption: 2,
        opacity: 0.65,
        normalScale: 2,
        waveScale: 0.18,
        flowSpeed: 0.38,
        flowDirection: 30,
        fresnelPower: 3.4,
        reflectivity: 0.18,
        specularStrength: 3.95,
        specularSize: 0.68,
        sssStrength: 0.55,
        foamWidth: 0.32,
        foamIntensity: 1.2,
        foamScale: 0.15,
        crestFoam: 0.7,
        crestFoamThreshold: 0.42,
        waveHeight: 0.65,
        waveSpeed: 0.35,
        waveSteepness: 0.7,
        waveBend: 0.55,
        waveLean: 0.5,
        crestSharpness: 0.5,
        softEdge: 0.06,
        causticsStrength: 0.5,
        causticsScale: 0.28
      }
    };
  }
});

// src/capabilities/water/proceduralTextures.ts
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";
function hash2(ix, iy, period) {
  const px = (ix % period + period) % period;
  const py = (iy % period + period) % period;
  let h = px * 374761393 + py * 668265263 | 0;
  h = (h ^ h >> 13) * 1274126177 | 0;
  const angle = (h >>> 0) / 4294967295 * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
}
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function periodicPerlin(u, v, period) {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const [g00x, g00y] = hash2(x0, y0, period);
  const [g10x, g10y] = hash2(x1, y0, period);
  const [g01x, g01y] = hash2(x0, y1, period);
  const [g11x, g11y] = hash2(x1, y1, period);
  const d00 = g00x * fx + g00y * fy;
  const d10 = g10x * (fx - 1) + g10y * fy;
  const d01 = g01x * fx + g01y * (fy - 1);
  const d11 = g11x * (fx - 1) + g11y * (fy - 1);
  const ux = fade(fx);
  const uy = fade(fy);
  return lerp(lerp(d00, d10, ux), lerp(d01, d11, ux), uy);
}
function waterFbm(u, v) {
  let sum = 0;
  sum += periodicPerlin(u, v, 10) * 0.36;
  sum += periodicPerlin(u + 0.37, v + 0.19, 20) * 0.3;
  sum += periodicPerlin(u + 0.71, v + 0.53, 40) * 0.22;
  sum += periodicPerlin(u + 0.13, v + 0.83, 80) * 0.12;
  return sum;
}
function defaultWaterNormalTexture() {
  if (cachedNormal) return cachedNormal;
  const size = 512;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      heights[y * size + x] = waterFbm(x / size, v);
    }
  }
  const data = new Uint8Array(size * size * 4);
  const strength = 3.4;
  for (let y = 0; y < size; y += 1) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x += 1) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (heights[y * size + xp] - heights[y * size + xm]) * strength;
      const dy = (heights[yp * size + x] - heights[ym * size + x]) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      const o = (y * size + x) * 4;
      data[o] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const texture4 = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture4.colorSpace = NoColorSpace;
  texture4.wrapS = RepeatWrapping;
  texture4.wrapT = RepeatWrapping;
  texture4.minFilter = LinearMipmapLinearFilter;
  texture4.magFilter = LinearFilter;
  texture4.generateMipmaps = true;
  texture4.needsUpdate = true;
  cachedNormal = texture4;
  return texture4;
}
function cellularWeb(u, v, period, pts, thickness) {
  const gx = Math.floor(u * period);
  const gy = Math.floor(v * period);
  let d1 = 9;
  let d2 = 9;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const cx = ((gx + ox) % period + period) % period;
      const cy = ((gy + oy) % period + period) % period;
      const [px, py] = pts[cy * period + cx];
      let dx = px - u;
      let dy = py - v;
      if (dx > 0.5) dx -= 1;
      if (dx < -0.5) dx += 1;
      if (dy > 0.5) dy -= 1;
      if (dy < -0.5) dy += 1;
      const d = Math.hypot(dx, dy) * period;
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  const edge = Math.max(0, 1 - Math.abs(d2 - d1) * thickness);
  return Math.pow(edge, 1.65);
}
function buildCellGrid(period, seedOffset) {
  const pts = [];
  for (let gy = 0; gy < period; gy += 1) {
    for (let gx = 0; gx < period; gx += 1) {
      const [rx, ry] = hash2(gx + seedOffset, gy + seedOffset * 3, period);
      pts.push([(gx + 0.5 + rx * 0.4) / period, (gy + 0.5 + ry * 0.4) / period]);
    }
  }
  return pts;
}
function defaultWaterFoamTexture() {
  if (cachedFoam) return cachedFoam;
  const size = 512;
  const ptsLarge = buildCellGrid(8, 3);
  const ptsMid = buildCellGrid(18, 19);
  const ptsFine = buildCellGrid(38, 41);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const w1x = periodicPerlin(u, v, 4) * 0.085 + periodicPerlin(u + 0.19, v + 0.61, 10) * 0.028;
      const w1y = periodicPerlin(u + 0.53, v + 0.31, 4) * 0.085 + periodicPerlin(u + 0.71, v + 0.13, 10) * 0.028;
      const wu = ((u + w1x) % 1 + 1) % 1;
      const wv = ((v + w1y) % 1 + 1) % 1;
      const w2x = periodicPerlin(wu + 0.27, wv + 0.43, 8) * 0.032;
      const w2y = periodicPerlin(wu + 0.63, wv + 0.17, 8) * 0.032;
      const wu2 = ((wu + w2x) % 1 + 1) % 1;
      const wv2 = ((wv + w2y) % 1 + 1) % 1;
      const webLarge = cellularWeb(wu, wv, 8, ptsLarge, 2.2);
      const webMid = cellularWeb(wu2, wv2, 18, ptsMid, 2.6);
      const webFine = cellularWeb(wu2, wv2, 38, ptsFine, 3);
      const fbmA = Math.min(1, Math.max(0, periodicPerlin(wu, wv, 12) * 1.3 + 0.5));
      const fbmB = Math.min(1, Math.max(0, periodicPerlin(u + 0.37, v + 0.79, 28) * 1.4 + 0.5));
      const fbmC = Math.min(1, Math.max(0, periodicPerlin(u + 0.11, v + 0.47, 56) * 1.4 + 0.5));
      const wisp = fbmA * 0.42 + fbmB * 0.36 + fbmC * 0.22;
      const webMix = webLarge * 0.52 + webMid * 0.42 + webFine * 0.26;
      const foam = Math.min(1, Math.max(0, webMix * (0.45 + wisp * 0.75) + Math.pow(wisp, 2.2) * 0.38));
      const gateMid = Math.min(1, Math.max(0, periodicPerlin(u + 0.41, v + 0.23, 8) * 1.5 + 0.5));
      const breakup = Math.min(1, Math.max(0, gateMid * 0.6 + fbmB * 0.4));
      const o = (y * size + x) * 4;
      data[o] = Math.round(foam * 255);
      data[o + 1] = Math.round(breakup * 255);
      data[o + 2] = Math.round(Math.min(1, foam * 0.8 + breakup * 0.2) * 255);
      data[o + 3] = 255;
    }
  }
  const texture4 = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture4.colorSpace = NoColorSpace;
  texture4.wrapS = RepeatWrapping;
  texture4.wrapT = RepeatWrapping;
  texture4.minFilter = LinearMipmapLinearFilter;
  texture4.magFilter = LinearFilter;
  texture4.generateMipmaps = true;
  texture4.needsUpdate = true;
  cachedFoam = texture4;
  return texture4;
}
function defaultWaterCausticsTexture() {
  if (cachedCaustics) return cachedCaustics;
  const size = 256;
  const period = 8;
  const pts = [];
  for (let gy = 0; gy < period; gy += 1) {
    for (let gx = 0; gx < period; gx += 1) {
      const [rx, ry] = hash2(gx, gy, period);
      pts.push([(gx + 0.5 + rx * 0.38) / period, (gy + 0.5 + ry * 0.38) / period]);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const gx = Math.floor(u * period);
      const gy = Math.floor(v * period);
      let d1 = 9;
      let d2 = 9;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = ((gx + ox) % period + period) % period;
          const cy = ((gy + oy) % period + period) % period;
          const [px, py] = pts[cy * period + cx];
          let dx = px - u;
          let dy = py - v;
          if (dx > 0.5) dx -= 1;
          if (dx < -0.5) dx += 1;
          if (dy > 0.5) dy -= 1;
          if (dy < -0.5) dy += 1;
          const d = Math.hypot(dx, dy) * period;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }
      const edge = Math.max(0, 1 - Math.abs(d2 - d1) * 4.5);
      const ridge = Math.pow(edge, 2.2);
      const byte = Math.min(255, Math.round(ridge * 255));
      const o = (y * size + x) * 4;
      data[o] = byte;
      data[o + 1] = byte;
      data[o + 2] = byte;
      data[o + 3] = 255;
    }
  }
  const texture4 = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture4.colorSpace = NoColorSpace;
  texture4.wrapS = RepeatWrapping;
  texture4.wrapT = RepeatWrapping;
  texture4.minFilter = LinearMipmapLinearFilter;
  texture4.magFilter = LinearFilter;
  texture4.generateMipmaps = true;
  texture4.needsUpdate = true;
  cachedCaustics = texture4;
  return texture4;
}
var cachedNormal, cachedFoam, cachedCaustics;
var init_proceduralTextures = __esm({
  "src/capabilities/water/proceduralTextures.ts"() {
    "use strict";
    cachedNormal = null;
    cachedFoam = null;
    cachedCaustics = null;
  }
});

// src/capabilities/water/waves.ts
function swellGroupInfo(group) {
  const a = VERTEX_WAVES[group * 2];
  const b = VERTEX_WAVES[group * 2 + 1] ?? a;
  const length4 = (a.length + b.length) / 2;
  const k = Math.PI * 2 / length4;
  const speed = Math.sqrt(GRAVITY / k);
  return {
    crestSpeed: speed,
    overtake: speed * PACKET_OVERTAKE,
    kAlong: Math.PI * 2 / (length4 * PACKET_SPACING),
    kAcross: Math.PI * 2 / (length4 * PACKET_WIDTH)
  };
}
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function mix(a, b, t) {
  return a + (b - a) * t;
}
function sampleAtRest(restX, restZ, spec, waveTime, swellTime) {
  if (spec.quality === "fast" || spec.waveHeight <= 1e-3) {
    return { dx: 0, dy: 0, dz: 0, slopeX: 0, slopeZ: 0 };
  }
  const rich = spec.quality === "ultra";
  const flowRad = spec.flowDirection * Math.PI / 180;
  const flowX = Math.cos(flowRad);
  const flowZ = Math.sin(flowRad);
  const flowOrthoX = -flowZ;
  const flowOrthoZ = flowX;
  const ridge = Math.max(0, Math.min(1, spec.crestSharpness));
  const crestPower = 1 - ridge * 0.5;
  const crestRoundPow = Math.pow(CREST_ROUND, crestPower);
  const crestLift = ridge * 0.274;
  const waveLean = spec.waveLean * LEAN_GAIN;
  const waveCurl = spec.waveLean * CURL_GAIN;
  const swells = SWELL_GROUPS.map((cfg, g) => {
    const info = SWELL_INFOS[g];
    const along = restX * flowX + restZ * flowZ - waveTime * info.crestSpeed + swellTime * info.overtake;
    const across = restX * flowOrthoX + restZ * flowOrthoZ;
    const stagger = Math.sin(across * info.kAcross + cfg.offset) * 1.5 + Math.sin(across * info.kAcross * 0.43 - along * info.kAlong * 0.21 + cfg.offset * 2) * 1;
    const psi = along * info.kAlong + stagger;
    const pulse = smoothstep(-0.75, 0.75, Math.sin(psi - Math.sin(psi) * PACKET_SKEW));
    return mix(cfg.low, cfg.high, pulse);
  });
  const defs = rich ? [...VERTEX_WAVES, ...DETAIL_WAVES.slice(0, MID_WAVE_COUNT)] : VERTEX_WAVES;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  let slopeX = 0;
  let slopeZ = 0;
  for (let i = 0; i < defs.length; i += 1) {
    const def = defs[i];
    const k = Math.PI * 2 / def.length;
    const amp = spec.waveHeight * def.weight * AMP_GAIN;
    const pinch = Math.min(amp * PINCH_GAIN, def.share / k);
    const omega = Math.sqrt(GRAVITY * k);
    const rad = def.angle * Math.PI / 180;
    const rc = Math.cos(rad);
    const rs = Math.sin(rad);
    const dirX = flowX * rc - flowZ * rs;
    const dirZ = flowX * rs + flowZ * rc;
    const perpX = -dirZ;
    const perpZ = dirX;
    const isMid = i >= VERTEX_WAVES.length;
    const along = restX * dirX + restZ * dirZ;
    const across = restX * perpX + restZ * perpZ;
    let bendPhase = 0;
    let gradAcross = 0;
    let gradAlong = 0;
    if (!isMid) {
      const q1 = k / BEND_PRIMARY.span;
      const amount1 = spec.waveBend * (rich ? BEND_PRIMARY.amount : BEND_PRIMARY.amountSolo);
      const a1 = across * q1 + (i * 1.9 + 0.7) + waveTime * (0.11 + i * 0.013);
      bendPhase = Math.sin(a1) * amount1;
      gradAcross = Math.cos(a1) * amount1 * q1;
      if (rich && i < BEND_SECONDARY.waves) {
        const q2 = k / BEND_SECONDARY.span;
        const amount2 = spec.waveBend * BEND_SECONDARY.amount;
        const a2 = across * q2 + along * q2 * BEND_SECONDARY.along + (i * 2.7 + 1.3) - waveTime * (0.17 + i * 0.011);
        bendPhase += Math.sin(a2) * amount2;
        const g2 = Math.cos(a2) * amount2 * q2;
        gradAcross += g2;
        gradAlong += g2 * BEND_SECONDARY.along;
      }
    }
    const group = Math.min(SWELL_GROUPS.length - 1, Math.floor(i / 2));
    const mod2 = swells[group];
    const theta = along * k + def.phase + bendPhase - waveTime * omega;
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    const m = Math.max((1 - s) * 0.5, 0) + CREST_ROUND;
    const w = Math.pow(m, crestPower - 1);
    const height = 1 + crestLift - (m * w - crestRoundPow) * 2 - s * c * waveLean;
    const slope = c * w * crestPower - (c * c * 2 - 1) * waveLean;
    dy += height * amp * mod2;
    const crestUp = Math.max(s, 0);
    const gather = c * spec.waveSteepness + crestUp * crestUp * waveCurl;
    const horiz = gather * pinch * Math.min(mod2, 1.1);
    dx += dirX * horiz;
    dz += dirZ * horiz;
    const gradX = dirX * (gradAlong + k) + perpX * gradAcross;
    const gradZ = dirZ * (gradAlong + k) + perpZ * gradAcross;
    const scaleSlope = slope * amp * mod2;
    slopeX += gradX * scaleSlope;
    slopeZ += gradZ * scaleSlope;
  }
  return { dx, dy, dz, slopeX, slopeZ };
}
function evaluateWaterWave(worldX, worldZ, spec, waveTime, swellTime) {
  if (spec.quality === "fast" || spec.waveHeight <= 1e-3) {
    return { dy: 0, normal: [0, 1, 0] };
  }
  const first = sampleAtRest(worldX, worldZ, spec, waveTime, swellTime);
  const second = sampleAtRest(worldX - first.dx, worldZ - first.dz, spec, waveTime, swellTime);
  const nx = -second.slopeX;
  const ny = 1;
  const nz = -second.slopeZ;
  const invLen = 1 / Math.hypot(nx, ny, nz);
  return {
    dy: second.dy,
    normal: [nx * invLen, ny * invLen, nz * invLen]
  };
}
var GRAVITY, CREST_ROUND, AMP_GAIN, PINCH_GAIN, VERTEX_WAVES, BEND_PRIMARY, BEND_SECONDARY, LEAN_GAIN, CURL_GAIN, SWELL_GROUPS, PACKET_SPACING, PACKET_WIDTH, PACKET_OVERTAKE, PACKET_SKEW, MID_WAVE_COUNT, DETAIL_WAVES, SWELL_INFOS;
var init_waves = __esm({
  "src/capabilities/water/waves.ts"() {
    "use strict";
    GRAVITY = 9.81;
    CREST_ROUND = 0.03;
    AMP_GAIN = 1.25;
    PINCH_GAIN = 2.2;
    VERTEX_WAVES = [
      { length: 41, angle: -8, weight: 0.26, share: 0.09, phase: 0 },
      { length: 33, angle: 7, weight: 0.22, share: 0.1, phase: 1.7 },
      { length: 22, angle: -19, weight: 0.17, share: 0.12, phase: 4.1 },
      { length: 17, angle: 16, weight: 0.14, share: 0.13, phase: 2.9 },
      { length: 11, angle: -31, weight: 0.12, share: 0.14, phase: 5.3 },
      { length: 7.5, angle: 27, weight: 0.09, share: 0.14, phase: 0.8 }
    ];
    BEND_PRIMARY = { amount: 1.3, amountSolo: 1.6, span: 3.1 };
    BEND_SECONDARY = { amount: 0.7, span: 1.7, along: 0.25, waves: 4 };
    LEAN_GAIN = 0.4;
    CURL_GAIN = 1.3;
    SWELL_GROUPS = [
      { offset: 0, low: 0.2, high: 1.4 },
      { offset: 2.1, low: 0.25, high: 1.35 },
      { offset: 4.4, low: 0.5, high: 1.2 }
    ];
    PACKET_SPACING = 1.6;
    PACKET_WIDTH = 3.5;
    PACKET_OVERTAKE = 0.65;
    PACKET_SKEW = 0.55;
    MID_WAVE_COUNT = 2;
    DETAIL_WAVES = [
      { length: 4.9, angle: -44, weight: 0.055, share: 0.04, phase: 3.6 },
      { length: 3.3, angle: 39, weight: 0.038, share: 0.04, phase: 1.1 },
      { length: 2.2, angle: -58, weight: 0.026, share: 0, phase: 5.9 },
      { length: 1.5, angle: 12, weight: 0.018, share: 0, phase: 2.4 }
    ];
    SWELL_INFOS = SWELL_GROUPS.map((_, g) => swellGroupInfo(g));
  }
});

// src/capabilities/water/waterMaterial.ts
import { Color, DoubleSide, Vector2, Vector3 as Vector34 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  frontFacing,
  length,
  linearDepth,
  max,
  min,
  mix as mix2,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  reflector,
  screenUV,
  select,
  sin,
  smoothstep as smoothstep2,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportLinearDepth,
  viewportSharedTexture
} from "three/tsl";
function waterVariantKey(opts) {
  return `${opts.planar ? 1 : 0}|${opts.refraction ? 1 : 0}|${opts.caustics ? 1 : 0}|${opts.highDetail ? 1 : 0}|${opts.upAxis}|${opts.waves ? 1 : 0}|${opts.richWaves ? 1 : 0}|${opts.followGrid ? 1 : 0}`;
}
function createWaterMaterial(options) {
  const defaultNormal = defaultWaterNormalTexture();
  const defaultFoam = defaultWaterFoamTexture();
  const defaultCaustics = defaultWaterCausticsTexture();
  const uTime = uniform(0);
  const uWaveTime = uniform(0);
  const uSwellTime = uniform(0);
  const uInvScale = uniform(new Vector34(1, 1, 1));
  const uShallowColor = uniform(new Color("#14b8a6"));
  const uDeepColor = uniform(new Color("#063354"));
  const uFoamColor = uniform(new Color("#f8fafc"));
  const uSunColor = uniform(new Color("#fff7e0"));
  const uSkyTopColor = uniform(new Color("#7dd3fc"));
  const uSkyHorizonColor = uniform(new Color("#e0f2fe"));
  const uSunDir = uniform(new Vector34(0.45, 0.72, 0.52).normalize());
  const uDepthAbsorption = uniform(2.8);
  const uOpacity = uniform(0.25);
  const uNormalScale = uniform(0.38);
  const uWaveScale = uniform(0.24);
  const uFlowDir = uniform(new Vector2(0.85, 0.52));
  const uFlowSpeed = uniform(0.45);
  const uFresnelPower = uniform(5);
  const uReflectivity = uniform(0.92);
  const uSpecularStrength = uniform(2.2);
  const uSpecularSize = uniform(0.24);
  const uSssStrength = uniform(0.45);
  const uFoamWidth = uniform(0.28);
  const uFoamIntensity = uniform(0.9);
  const uFoamScale = uniform(0.1);
  const uCrestFoam = uniform(0.65);
  const uCrestFoamThreshold = uniform(0.42);
  const uShoreFoamOn = uniform(1);
  const uUnderwaterSurfaceBrightness = uniform(0.45);
  const uSoftEdge = uniform(0.08);
  const uCausticsStrength = uniform(0.7);
  const uCausticsScale = uniform(0.22);
  const uWaveHeight = uniform(0);
  const uWaveSteepness = uniform(0.65);
  const uWaveBend = uniform(0.6);
  const uWaveLean = uniform(0.2);
  const uWaveCurl = uniform(0.6);
  const uCrestPower = uniform(0.75);
  const uCrestLift = uniform(0.14);
  const uCrestRoundPow = uniform(Math.pow(CREST_ROUND, 0.75));
  const uCellSize = uniform(0);
  const uGridCenter = uniform(new Vector2(0, 0));
  const trailOmegas = VERTEX_WAVES.map((def) => Math.sqrt(GRAVITY * (Math.PI * 2 / def.length)));
  const uTrailTurns = FOAM_TRAIL_TAPS.map(() => trailOmegas.map(() => uniform(new Vector2(1, 0))));
  const uDebugView = uniform(0);
  const normalTexNode = texture(defaultNormal);
  const foamTexNode = texture(defaultFoam);
  const causticsTexNode = texture(defaultCaustics);
  const worldToEye = cameraPosition.sub(positionWorld);
  const eyeDist = length(worldToEye);
  const viewVec = normalize(worldToEye);
  const highFreqFade = float(1).sub(smoothstep2(float(18), float(110), eyeDist));
  const follow = options.followGrid && options.upAxis === "z";
  const restLocal = follow ? vec3(
    clamp(
      positionGeometry.xy.mul(vec2(uInvScale.x, uInvScale.z)).add(uGridCenter),
      vec2(-0.5, -0.5),
      vec2(0.5, 0.5)
    ),
    0
  ) : positionLocal;
  const cellSize = follow ? positionGeometry.z : uCellSize;
  const restVertexXZ = modelWorldMatrix.mul(vec4(follow ? restLocal : positionGeometry, 1)).xz;
  const surfXZ = varying(restVertexXZ);
  const rotatedDir = (deg) => {
    const rad = deg * Math.PI / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return vec2(uFlowDir.x.mul(c).sub(uFlowDir.y.mul(s)), uFlowDir.x.mul(s).add(uFlowDir.y.mul(c)));
  };
  const rich = options.richWaves;
  const vertexDefs = rich ? [...VERTEX_WAVES, ...DETAIL_WAVES.slice(0, MID_WAVE_COUNT)] : VERTEX_WAVES;
  const detailDefs = rich ? DETAIL_WAVES.slice(MID_WAVE_COUNT) : options.highDetail ? DETAIL_WAVES : DETAIL_WAVES.slice(0, 2);
  const vertexWaves = vertexDefs.map((def, index) => {
    const k = Math.PI * 2 / def.length;
    const amp = uWaveHeight.mul(def.weight * AMP_GAIN);
    const pinch = min(amp.mul(PINCH_GAIN), float(def.share / k));
    const dir = rotatedDir(def.angle);
    const isMid = index >= VERTEX_WAVES.length;
    return {
      def,
      k,
      omega: Math.sqrt(GRAVITY * k),
      dir,
      perp: vec2(dir.y.negate(), dir.x),
      amp,
      pinch,
      foamWeight: pinch.mul(k),
      isMid,
      // 网格太稀（一个波长不足 2.5 ~ 5 格）时，这道波不再位移顶点，只留在片元法线里，
      // 避免折线化，也避免跟随网格移动时顶点在采样不足的波上「游动」。只能用在顶点阶段。
      geoFade: float(1).sub(smoothstep2(float(def.length / 5), float(def.length / 2.5), cellSize))
    };
  });
  const bendOf = (xz, wave, index, withGradient) => {
    if (wave.isMid) return { phase: float(0), gradAcross: float(0), gradAlong: float(0) };
    const along = dot(xz, wave.dir);
    const across = dot(xz, wave.perp);
    const q1 = wave.k / BEND_PRIMARY.span;
    const amount1 = uWaveBend.mul(rich ? BEND_PRIMARY.amount : BEND_PRIMARY.amountSolo);
    const a1 = across.mul(q1).add(index * 1.9 + 0.7).add(uWaveTime.mul(0.11 + index * 0.013));
    let phase = sin(a1).mul(amount1);
    let gradAcross = withGradient ? cos(a1).mul(amount1).mul(q1) : float(0);
    let gradAlong = float(0);
    if (rich && index < BEND_SECONDARY.waves) {
      const q2 = wave.k / BEND_SECONDARY.span;
      const amount2 = uWaveBend.mul(BEND_SECONDARY.amount);
      const a2 = across.mul(q2).add(along.mul(q2 * BEND_SECONDARY.along)).add(index * 2.7 + 1.3).sub(uWaveTime.mul(0.17 + index * 0.011));
      phase = phase.add(sin(a2).mul(amount2));
      if (withGradient) {
        const g2 = cos(a2).mul(amount2).mul(q2);
        gradAcross = gradAcross.add(g2);
        gradAlong = g2.mul(BEND_SECONDARY.along);
      }
    }
    return { phase, gradAcross, gradAlong };
  };
  const profileOf = (s, c, withSlope) => {
    const m = max(float(1).sub(s).mul(0.5), float(0)).add(CREST_ROUND);
    const w = pow(m, uCrestPower.sub(1));
    const height = float(1).add(uCrestLift).sub(m.mul(w).sub(uCrestRoundPow).mul(2)).sub(s.mul(c).mul(uWaveLean));
    const slope = withSlope ? c.mul(w).mul(uCrestPower).sub(c.mul(c).mul(2).sub(1).mul(uWaveLean)) : float(0);
    return { height, slope };
  };
  const detailWaves = detailDefs.map((def) => {
    const k = Math.PI * 2 / def.length;
    const amp = uWaveHeight.mul(def.weight * AMP_GAIN);
    const fade2 = float(1).sub(smoothstep2(float(def.length * 30), float(def.length * 110), eyeDist));
    return { def, k, omega: Math.sqrt(GRAVITY * k), dir: rotatedDir(def.angle), amp, fade: fade2, foamWeight: min(amp.mul(PINCH_GAIN * k), float(0.18)).mul(fade2) };
  });
  let displacedLocal = restLocal;
  let waveSlope = vec2(0, 0);
  let macroSlope = vec2(0, 0);
  let waveCompress = float(0);
  let waveNorm = float(0);
  let squeezeNow = float(0);
  let crestField = float(0);
  let crestActive = float(0);
  if (options.waves) {
    const flowOrthoDir = vec2(uFlowDir.y.negate(), uFlowDir.x);
    const swellAt = (xz, group) => {
      const cfg = SWELL_GROUPS[group];
      const info = swellGroupInfo(group);
      const along = dot(xz, uFlowDir).sub(uWaveTime.mul(info.crestSpeed)).add(uSwellTime.mul(info.overtake));
      const across = dot(xz, flowOrthoDir);
      const stagger = sin(across.mul(info.kAcross).add(cfg.offset)).mul(1.5).add(sin(across.mul(info.kAcross * 0.43).sub(along.mul(info.kAlong * 0.21)).add(cfg.offset * 2)).mul(1));
      const psi = along.mul(info.kAlong).add(stagger);
      const pulse = smoothstep2(float(-0.75), float(0.75), sin(psi.sub(sin(psi).mul(PACKET_SKEW))));
      return mix2(float(cfg.low), float(cfg.high), pulse);
    };
    const groupOf = (i) => Math.min(SWELL_GROUPS.length - 1, Math.floor(i / 2));
    const vSwell = SWELL_GROUPS.map((_, g) => swellAt(restVertexXZ, g));
    let vHeight = float(0);
    let vHoriz = vec2(0, 0);
    vertexWaves.forEach((wave, i) => {
      const mod2 = vSwell[groupOf(i)];
      const theta = dot(restVertexXZ, wave.dir).mul(wave.k).add(wave.def.phase).add(bendOf(restVertexXZ, wave, i, false).phase).sub(uWaveTime.mul(wave.omega));
      const s = sin(theta);
      const c = cos(theta);
      vHeight = vHeight.add(profileOf(s, c, false).height.mul(wave.amp).mul(mod2).mul(wave.geoFade));
      const crestUp = max(s, float(0));
      const gather = c.mul(uWaveSteepness).add(crestUp.mul(crestUp).mul(uWaveCurl));
      vHoriz = vHoriz.add(wave.dir.mul(gather.mul(wave.pinch).mul(min(mod2, float(1.1))).mul(wave.geoFade)));
    });
    displacedLocal = options.upAxis === "z" ? vec3(
      restLocal.x.add(vHoriz.x.mul(uInvScale.x)),
      restLocal.y.sub(vHoriz.y.mul(uInvScale.z)),
      restLocal.z.add(vHeight.mul(uInvScale.y))
    ) : vec3(
      restLocal.x.add(vHoriz.x.mul(uInvScale.x)),
      restLocal.y.add(vHeight.mul(uInvScale.y)),
      restLocal.z.add(vHoriz.y.mul(uInvScale.z))
    );
    const vertexBend = vertexWaves.map((wave, i) => bendOf(surfXZ, wave, i, true));
    const vertexBase = vertexWaves.map((wave, i) => dot(surfXZ, wave.dir).mul(wave.k).add(wave.def.phase).add(vertexBend[i].phase));
    const detailBase = detailWaves.map((wave) => dot(surfXZ, wave.dir).mul(wave.k).add(wave.def.phase));
    const swellVarying = varying(vec3(vSwell[0], vSwell[1], vSwell[2]));
    const fSwell = [swellVarying.x, swellVarying.y, swellVarying.z];
    const waveSin = [];
    const waveCos = [];
    let vertexFoamWeight = float(0);
    let midSlope = vec2(0, 0);
    vertexWaves.forEach((wave, i) => {
      const mod2 = fSwell[groupOf(i)];
      const theta = vertexBase[i].sub(uWaveTime.mul(wave.omega));
      const s = sin(theta);
      const c = cos(theta);
      waveSin.push(s);
      waveCos.push(c);
      const profile = profileOf(s, c, true);
      const leanHeight = profile.height;
      const leanSlope = profile.slope;
      const crestUp = max(s, float(0));
      const bend = vertexBend[i];
      const phaseGrad = wave.dir.mul(bend.gradAlong.add(wave.k)).add(wave.perp.mul(bend.gradAcross));
      const slope = phaseGrad.mul(leanSlope.mul(wave.amp).mul(mod2));
      if (wave.isMid) {
        const fade2 = float(1).sub(smoothstep2(float(wave.def.length * 30), float(wave.def.length * 110), eyeDist));
        midSlope = midSlope.add(slope.mul(fade2));
      } else {
        macroSlope = macroSlope.add(slope);
      }
      const squeeze = s.mul(uWaveSteepness).sub(crestUp.mul(c).mul(uWaveCurl).mul(2));
      waveCompress = waveCompress.add(squeeze.mul(wave.pinch).mul(wave.k).mul(min(mod2, float(1.1))));
      waveNorm = waveNorm.add(leanHeight.mul(wave.def.weight).mul(mod2));
      vertexFoamWeight = vertexFoamWeight.add(wave.foamWeight);
    });
    waveSlope = macroSlope.add(midSlope);
    let detailNorm = float(0);
    detailWaves.forEach((wave, i) => {
      const theta = detailBase[i].sub(uWaveTime.mul(wave.omega));
      detailNorm = detailNorm.add(sin(theta).mul(wave.def.weight).mul(wave.fade));
    });
    const crestAt = (tap) => {
      let acc = float(0);
      vertexWaves.forEach((wave, i) => {
        if (wave.isMid) return;
        const turn = uTrailTurns[tap][i];
        acc = acc.add(waveSin[i].mul(turn.x).add(waveCos[i].mul(turn.y)).mul(wave.def.weight).mul(fSwell[groupOf(i)]));
      });
      return acc.mul(CREST_GAIN);
    };
    squeezeNow = waveNorm.add(detailNorm.mul(1.6)).mul(CREST_GAIN);
    const crestStart = mix2(float(0), float(0.8), clamp(uCrestFoamThreshold, float(0), float(1)));
    const crestEnd = crestStart.add(0.55);
    crestField = smoothstep2(crestStart, crestEnd, squeezeNow);
    const taps = options.highDetail ? FOAM_TRAIL_TAPS : FOAM_TRAIL_TAPS.slice(0, 3);
    taps.forEach((tap, index) => {
      crestField = max(crestField, smoothstep2(crestStart, crestEnd, crestAt(index)).mul(tap.keep * 0.6));
    });
    crestActive = smoothstep2(float(0.03), float(0.2), vertexFoamWeight);
  }
  const baseUv = surfXZ.mul(uWaveScale);
  const flow = uFlowDir.mul(uTime.mul(uFlowSpeed.mul(0.05)));
  const flowOrtho = vec2(uFlowDir.y.negate(), uFlowDir.x).mul(uTime.mul(uFlowSpeed.mul(0.038)));
  const n1 = normalTexNode.sample(baseUv.mul(0.37).add(flow.mul(0.7))).xyz.mul(2).sub(1);
  const n2 = normalTexNode.sample(baseUv.mul(0.91).sub(flowOrtho.mul(0.9))).xyz.mul(2).sub(1);
  let nAvg = n1.mul(0.54).add(n2.mul(0.46).mul(float(0.35).add(highFreqFade.mul(0.65))));
  let nCrisp = n2.mul(float(0.3).add(highFreqFade.mul(0.7)));
  if (options.highDetail) {
    const n3 = normalTexNode.sample(baseUv.mul(2.13).add(flow.mul(1.3).add(flowOrtho.mul(0.4)))).xyz.mul(2).sub(1);
    const n4 = normalTexNode.sample(baseUv.mul(4.71).sub(flow.mul(0.8).sub(flowOrtho.mul(1.2)))).xyz.mul(2).sub(1);
    const detail2 = n3.mul(0.24).add(n4.mul(0.16)).mul(highFreqFade);
    nAvg = n1.mul(0.32).add(n2.mul(0.28)).add(detail2);
    nCrisp = n2.mul(0.25).add(n3.mul(0.4).add(n4.mul(0.35)).mul(highFreqFade));
  }
  const crestPinchY = max(float(1).sub(waveCompress), float(0.4));
  const surfaceNormal = normalize(vec3(
    nAvg.x.mul(uNormalScale).sub(waveSlope.x.mul(1.2)),
    crestPinchY,
    nAvg.y.mul(uNormalScale).sub(waveSlope.y.mul(1.2))
  ));
  const waveMacroNormal = normalize(vec3(
    macroSlope.x.negate().mul(1.6),
    crestPinchY,
    macroSlope.y.negate().mul(1.6)
  ));
  const crispNormal = normalize(vec3(
    nCrisp.x.mul(uNormalScale).mul(1.45).sub(waveSlope.x.mul(1.2)),
    crestPinchY,
    nCrisp.y.mul(uNormalScale).mul(1.45).sub(waveSlope.y.mul(1.2))
  ));
  const nDotV = max(dot(surfaceNormal, viewVec), float(1e-3));
  const rf0 = float(0.025);
  const fresnel = clamp(
    pow(float(1).sub(nDotV), uFresnelPower).mul(float(1).sub(rf0)).add(rf0).mul(uReflectivity),
    float(0),
    float(1)
  );
  const grazingFade = smoothstep2(float(0.04), float(0.32), nDotV);
  const distortion = surfaceNormal.xz.mul(float(8e-3).add(float(0.18).div(max(eyeDist, float(1))))).mul(uNormalScale).mul(float(0.35).add(grazingFade.mul(0.65)));
  const reflDir = normalize(reflect(viewVec.negate(), surfaceNormal));
  const skyGrad = smoothstep2(float(0), float(0.5), max(reflDir.y, float(0)));
  const fallbackReflection = mix2(uSkyHorizonColor, uSkyTopColor, skyGrad);
  let reflectionTarget = null;
  let mirrorReflector = null;
  let reflectionColor = fallbackReflection;
  if (options.planar) {
    mirrorReflector = reflector({ resolutionScale: 0.5, bounces: false });
    if (mirrorReflector.uvNode) {
      mirrorReflector.uvNode = clamp(mirrorReflector.uvNode.add(distortion), vec2(2e-3, 2e-3), vec2(0.998, 0.998));
    }
    reflectionTarget = mirrorReflector.target;
    reflectionColor = mix2(fallbackReflection, mirrorReflector.rgb, mirrorReflector.a);
  }
  const depthScale = cameraFar.sub(cameraNear);
  let waterDepth = max(uDepthAbsorption, float(2));
  if (options.refraction) {
    const bgLinear = viewportLinearDepth;
    const hasBed = bgLinear.lessThan(float(0.999));
    const rawRayDepth = max(bgLinear.sub(linearDepth()).mul(depthScale), float(0));
    const rayWaterDepth = select(hasBed, rawRayDepth, float(20));
    const verticalFactor = clamp(abs(viewVec.y).mul(1.15).add(0.22), float(0.22), float(1));
    waterDepth = rayWaterDepth.mul(verticalFactor);
  }
  const absorb = float(1).sub(exp(waterDepth.negate().div(max(uDepthAbsorption, float(0.1)))));
  const waterTint = mix2(uShallowColor, uDeepColor, clamp(absorb, float(0), float(1)));
  let refractedBody = waterTint;
  if (options.refraction) {
    const depthRefractFade = clamp(waterDepth.mul(1.6), float(0), float(1));
    const refractUv = clamp(screenUV.add(distortion.mul(0.6).mul(depthRefractFade)), vec2(2e-3, 2e-3), vec2(0.998, 0.998));
    const refractDepth = linearDepth(viewportDepthTexture(refractUv)).sub(linearDepth()).mul(depthScale);
    const safeRefractUv = select(refractDepth.greaterThan(float(0)), refractUv, screenUV);
    let underWaterColor = viewportSharedTexture(safeRefractUv).rgb;
    if (options.caustics) {
      const causticsCoord = positionWorld.xz.add(surfaceNormal.xz.mul(clamp(waterDepth.mul(0.22), float(0), float(0.8))));
      const cUv1 = causticsCoord.mul(uCausticsScale).add(flow.mul(0.85));
      const cUv2 = causticsCoord.mul(uCausticsScale.mul(1.37)).sub(flowOrtho.mul(1.15));
      const c1 = causticsTexNode.sample(cUv1).r;
      const c2 = causticsTexNode.sample(cUv2).r;
      const causticMask = min(c1, c2).mul(1.6).add(c1.mul(c2)).mul(0.55);
      const shallowFade = exp(waterDepth.negate().mul(0.45)).mul(smoothstep2(float(0), float(0.18), waterDepth));
      underWaterColor = underWaterColor.add(uSunColor.mul(causticMask).mul(shallowFade).mul(uCausticsStrength));
    }
    const transmit = clamp(float(1).sub(absorb).mul(float(1).sub(uOpacity.mul(0.55))), float(0), float(1));
    refractedBody = mix2(waterTint, underWaterColor.mul(mix2(vec3(1), uShallowColor, float(0.42))), transmit);
  }
  const edgeOpacity = options.refraction ? select(
    uSoftEdge.greaterThan(float(2e-3)),
    smoothstep2(float(0), max(uSoftEdge, float(5e-3)), waterDepth),
    float(1)
  ) : float(1);
  const finalAlpha = options.refraction ? edgeOpacity : clamp(uOpacity.add(0.25), float(0.35), float(1));
  const foamUv = surfXZ.mul(uFoamScale);
  const foamSampleA = foamTexNode.sample(foamUv.mul(1.85).add(flow.mul(1.25)));
  const foamSampleB = foamTexNode.sample(foamUv.mul(4.1).sub(flowOrtho.mul(1.45)));
  const foamWeb = foamSampleA.r.mul(0.62).add(foamSampleB.r.mul(0.38));
  const foamErode = foamSampleA.g.mul(0.55).add(foamSampleB.g.mul(0.45));
  const shoreRatio = clamp(waterDepth.div(max(uFoamWidth, float(0.01))), float(0), float(1));
  const shoreBase = float(1).sub(smoothstep2(float(0), max(uFoamWidth, float(0.01)), waterDepth));
  const lapRipple = sin(shoreRatio.mul(12).sub(uTime.mul(2.2))).mul(0.5).add(0.5);
  const shoreBand = shoreBase.mul(float(0.62).add(lapRipple.mul(0.38))).mul(uShoreFoamOn);
  let crestBand = float(0);
  if (options.waves) {
    crestBand = crestField.mul(crestActive).mul(min(uCrestFoam, float(1)));
  }
  const crestBoost = max(uCrestFoam, float(1));
  const foamMask = clamp(max(shoreBand, crestBand), float(0), float(1));
  const foamCloud = foamTexNode.sample(foamUv.mul(0.45).add(flow.mul(0.4))).r;
  const detail = foamCloud.mul(0.4).add(foamWeb.mul(0.45)).add(foamErode.mul(0.15));
  const webThreshold = mix2(float(0.7), float(0), foamMask);
  const webPattern = smoothstep2(webThreshold, webThreshold.add(0.45), detail);
  const tipFill = smoothstep2(float(0.6), float(1), foamMask).mul(0.85);
  const foamAlpha = clamp(
    pow(foamMask, float(1.2)).mul(mix2(webPattern, float(1), tipFill)).mul(uFoamIntensity).mul(crestBoost).mul(1.2),
    float(0),
    float(1)
  );
  const sunDir = normalize(uSunDir);
  const sunSlope = max(dot(waveMacroNormal, sunDir), float(0));
  const waveShade = mix2(float(0.68), float(1.18), sunSlope);
  const sunRefl = normalize(reflect(sunDir.negate(), crispNormal));
  const specDot = max(dot(viewVec, sunRefl), float(0));
  const specPower = mix2(float(2200), float(120), clamp(uSpecularSize, float(0), float(1)));
  const specGain = mix2(float(3.2), float(1.1), clamp(uSpecularSize, float(0), float(1)));
  const sunSparkle = pow(specDot, specPower).mul(uSpecularStrength).mul(specGain).mul(float(0.35).add(highFreqFade.mul(0.65)));
  const waveUpperMask = smoothstep2(float(0.05), float(0.72), waveNorm).mul(smoothstep2(float(0.01), float(0.08), uWaveHeight));
  const viewSss = pow(max(dot(viewVec, sunDir.negate()), float(0)), float(4)).mul(0.65).add(0.35);
  const sssFactor = waveUpperMask.mul(viewSss).mul(max(float(1).sub(nDotV.mul(0.65)), float(0.25))).mul(uSssStrength);
  const sssColor = mix2(uShallowColor, vec3(0.22, 0.92, 0.86), float(0.35)).mul(sssFactor).mul(0.68);
  const litBody = refractedBody.mul(waveShade).add(sssColor);
  const waterSurface = mix2(litBody, reflectionColor, fresnel).add(uSunColor.mul(sunSparkle));
  const foamShadow = smoothstep2(float(0.05), float(0.35), foamAlpha).mul(float(1).sub(foamAlpha));
  const shadedWater = waterSurface.mul(float(1).sub(foamShadow.mul(0.18)));
  const finalColor = mix2(shadedWater, uFoamColor, foamAlpha);
  const upCos = clamp(dot(crispNormal, viewVec.negate()), float(0), float(1));
  const snellWindow = smoothstep2(float(0.28), float(0.72), upCos);
  const skyWindowColor = mix2(uShallowColor, vec3(0.75, 0.96, 1), float(0.65));
  const sunThrough = pow(max(dot(viewVec.negate(), sunDir), float(0)), float(12)).mul(0.85);
  const tirColor = mix2(uDeepColor, uShallowColor, clamp(float(0.45).add(crispNormal.x.mul(0.15)), float(0.2), float(0.8)));
  const underwaterBackColor = mix2(tirColor, skyWindowColor, snellWindow).add(uSunColor.mul(sunThrough)).mul(uUnderwaterSurfaceBrightness);
  const underwaterBackAlpha = mix2(float(0.88), float(0.32), snellWindow);
  const debugHeight = vec3(clamp(waveNorm.mul(0.5).add(0.5), float(0), float(1)));
  const debugSqueeze = vec3(
    clamp(squeezeNow, float(0), float(1)),
    float(0),
    clamp(squeezeNow.negate(), float(0), float(1))
  );
  const debugFoam = vec3(foamMask);
  const debugColor = select(
    uDebugView.lessThan(float(1.5)),
    debugHeight,
    select(uDebugView.lessThan(float(2.5)), debugSqueeze, debugFoam)
  );
  const debugOn = uDebugView.greaterThan(float(0.5));
  const material = new MeshBasicNodeMaterial();
  if (options.waves || follow) material.positionNode = displacedLocal;
  material.colorNode = select(debugOn, debugColor, select(frontFacing, finalColor, underwaterBackColor));
  material.opacityNode = select(debugOn, float(1), select(frontFacing, max(finalAlpha, foamAlpha), underwaterBackAlpha));
  material.transparent = true;
  material.depthWrite = true;
  material.side = DoubleSide;
  return {
    variantKey: waterVariantKey(options),
    material,
    reflectionTarget,
    setSpec(spec, customNormal, customFoam) {
      uShallowColor.value.set(spec.shallowColor);
      uDeepColor.value.set(spec.deepColor);
      uFoamColor.value.set(spec.foamColor);
      uSunColor.value.set(spec.sunColor);
      uDepthAbsorption.value = spec.depthAbsorption;
      uOpacity.value = spec.opacity;
      uNormalScale.value = spec.normalScale;
      uWaveScale.value = spec.waveScale;
      uFlowSpeed.value = spec.flowSpeed;
      const rad = spec.flowDirection * Math.PI / 180;
      uFlowDir.value.set(Math.cos(rad), Math.sin(rad));
      uFresnelPower.value = spec.fresnelPower;
      uReflectivity.value = spec.reflectivity;
      uSpecularStrength.value = spec.specularStrength;
      uSpecularSize.value = spec.specularSize;
      uSssStrength.value = spec.sssStrength;
      uFoamWidth.value = spec.foamWidth;
      uFoamIntensity.value = spec.foamIntensity;
      uFoamScale.value = spec.foamScale;
      uCrestFoam.value = spec.crestFoam;
      uCrestFoamThreshold.value = spec.crestFoamThreshold;
      uShoreFoamOn.value = spec.shoreFoam ? 1 : 0;
      uUnderwaterSurfaceBrightness.value = spec.underwaterSurfaceBrightness;
      uSoftEdge.value = spec.softEdge;
      uCausticsStrength.value = spec.causticsStrength;
      uCausticsScale.value = spec.causticsScale;
      uWaveHeight.value = spec.quality === "fast" ? 0 : spec.waveHeight;
      uWaveSteepness.value = spec.quality === "fast" ? 0 : spec.waveSteepness;
      uWaveBend.value = spec.waveBend;
      uWaveLean.value = spec.waveLean * LEAN_GAIN;
      uWaveCurl.value = spec.waveLean * CURL_GAIN;
      const ridge = Math.min(1, Math.max(0, spec.crestSharpness));
      uCrestPower.value = 1 - ridge * 0.5;
      uCrestRoundPow.value = Math.pow(CREST_ROUND, uCrestPower.value);
      uCrestLift.value = ridge * 0.274;
      FOAM_TRAIL_TAPS.forEach((tap, t) => {
        const lookBack = spec.foamTrail * tap.time;
        trailOmegas.forEach((omega, i) => {
          uTrailTurns[t][i].value.set(Math.cos(omega * lookBack), Math.sin(omega * lookBack));
        });
      });
      uDebugView.value = DEBUG_VIEW_INDEX[spec.debugView];
      if (mirrorReflector) {
        mirrorReflector.reflector.resolutionScale = Math.max(0.25, spec.reflectionScale);
      }
      normalTexNode.value = customNormal ?? defaultNormal;
      foamTexNode.value = customFoam ?? defaultFoam;
    },
    setTime(time2, waveTime, swellTime) {
      uSwellTime.value = swellTime;
      uTime.value = time2;
      uWaveTime.value = waveTime;
    },
    setInvScale(worldScale) {
      uInvScale.value.set(
        1 / Math.max(1e-3, Math.abs(worldScale.x)),
        1 / Math.max(1e-3, Math.abs(worldScale.y)),
        1 / Math.max(1e-3, Math.abs(worldScale.z))
      );
    },
    setCellSize(meters) {
      uCellSize.value = Math.max(0, meters);
    },
    setGridCenter(localX, localY) {
      uGridCenter.value.set(localX, localY);
    },
    setSun(direction, color2, intensity, skyHorizon, skyTop) {
      uSunDir.value.copy(direction).normalize();
      const boost = Math.min(2, Math.max(0.2, intensity));
      uSunColor.value.copy(color2).multiplyScalar(boost);
      if (skyHorizon) uSkyHorizonColor.value.copy(skyHorizon);
      if (skyTop) uSkyTopColor.value.copy(skyTop);
    },
    dispose() {
      material.dispose();
    }
  };
}
var FOLLOW_GRID, FOAM_TRAIL_TAPS, CREST_GAIN, DEBUG_VIEW_INDEX;
var init_waterMaterial = __esm({
  "src/capabilities/water/waterMaterial.ts"() {
    "use strict";
    init_proceduralTextures();
    init_waves();
    FOLLOW_GRID = {
      /** 网格整体对齐的步长 (m)，必须是 bands 里各个间距的整数倍。 */
      snap: 4,
      /** 从中心往外的各段：[间距 (m), 格数]。 */
      bands: [[0.25, 28], [0.5, 16], [1, 16], [2, 16], [4, 12]],
      /** 再往外每格间距翻倍的格数（远处只需要铺满，不需要细节）。 */
      doublingSteps: 9,
      /** 最外一圈极远的顶点，着色器把它收到水面边界上。 */
      farRadius: 1e5
    };
    FOAM_TRAIL_TAPS = [
      { time: 0.45, keep: 0.85 },
      { time: 0.9, keep: 0.65 },
      { time: 1.4, keep: 0.45 },
      { time: 2, keep: 0.25 }
    ];
    CREST_GAIN = 1.4;
    DEBUG_VIEW_INDEX = { off: 0, height: 1, squeeze: 2, foam: 3 };
  }
});

// src/capabilities/water/session.ts
var session_exports = {};
__export(session_exports, {
  anyUnderwaterEffectEnabled: () => anyUnderwaterEffectEnabled,
  default: () => session_default,
  dispose: () => dispose,
  mount: () => mount,
  sampleUnderwaterView: () => sampleUnderwaterView,
  sampleWaterSurface: () => sampleWaterSurface
});
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color as Color2,
  Mesh as Mesh2,
  PlaneGeometry,
  Sphere,
  Vector3 as Vector35
} from "three";
function getSharedPlaneGeometry(spec) {
  const tier = spec.quality === "fast" || spec.waveHeight <= 1e-3 ? "flat" : spec.quality;
  if (!planeGeos[tier]) {
    const seg = SEGMENTS[tier];
    planeGeos[tier] = new PlaneGeometry(1, 1, seg, seg);
  }
  return planeGeos[tier];
}
function getFollowGeometry() {
  if (followGeo) return followGeo;
  const half = [];
  let at = 0;
  let lastStep = 0;
  for (const [step2, count2] of FOLLOW_GRID.bands) {
    for (let i = 0; i < count2; i += 1) {
      at += step2;
      half.push({ at, step: step2 });
    }
    lastStep = step2;
  }
  for (let i = 0; i < FOLLOW_GRID.doublingSteps; i += 1) {
    lastStep *= 2;
    at += lastStep;
    half.push({ at, step: lastStep });
  }
  half.push({ at: FOLLOW_GRID.farRadius, step: FOLLOW_GRID.farRadius });
  const axis = [...half.map((entry) => -entry.at).reverse(), 0, ...half.map((entry) => entry.at)];
  const halfCell = half.map((entry, i) => Math.max(entry.step, half[i + 1]?.step ?? entry.step));
  const axisCell = [...[...halfCell].reverse(), FOLLOW_GRID.bands[0][0], ...halfCell];
  const count = axis.length;
  const positions = new Float32Array(count * count * 3);
  for (let j = 0; j < count; j += 1) {
    for (let i = 0; i < count; i += 1) {
      const slot = (j * count + i) * 3;
      positions[slot] = axis[i];
      positions[slot + 1] = axis[j];
      positions[slot + 2] = Math.max(axisCell[i], axisCell[j]);
    }
  }
  const indices = [];
  for (let j = 0; j < count - 1; j += 1) {
    for (let i = 0; i < count - 1; i += 1) {
      const a = j * count + i;
      const b = a + 1;
      const c = a + count;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(positions.length).map((_, i) => i % 3 === 2 ? 1 : 0), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array(count * count * 2), 2));
  geo.setIndex(indices);
  geo.boundingBox = new Box3(new Vector35(-0.5, -0.5, 0), new Vector35(0.5, 0.5, 0));
  geo.boundingSphere = new Sphere(new Vector35(0, 0, 0), Math.SQRT1_2);
  followGeo = geo;
  return geo;
}
function raycastAsUnitPlane(raycaster, intersects) {
  const geometry = this.geometry;
  if (!planeGeos.flat) planeGeos.flat = new PlaneGeometry(1, 1, 1, 1);
  this.geometry = planeGeos.flat;
  Mesh2.prototype.raycast.call(this, raycaster, intersects);
  this.geometry = geometry;
}
function refreshActiveNodes(nodes) {
  if (nodes === cachedNodesRef) return;
  cachedNodesRef = nodes;
  cachedActiveIds = [];
  cachedSunId = null;
  for (const node of Object.values(nodes)) {
    if (!cachedSunId && node.kind === "directional-light" && node.visible) {
      cachedSunId = node.id;
    }
    const raw = node.capabilities?.[WATER_CAPABILITY_ID];
    if (!raw || typeof raw !== "object") continue;
    if (raw.enabled !== true) continue;
    if (node.kind !== "empty" && node.kind !== "plane" && node.kind !== "model") continue;
    cachedActiveIds.push(node.id);
  }
}
function resolveNodeObject(scene2, id) {
  const hit = cachedNodeObjects.get(id);
  if (hit && hit.parent) return hit;
  if (cachedSceneRef !== scene2 || scene2.children.length !== cachedChildCount) {
    cachedSceneRef = scene2;
    cachedChildCount = scene2.children.length;
  }
  let found = null;
  scene2.traverse((child) => {
    if (child.userData?.t3dWaterMesh) return;
    const nid = child.userData?.nodeId;
    if (typeof nid === "string" && !cachedNodeObjects.has(nid)) {
      cachedNodeObjects.set(nid, child);
    }
    if (!found && nid === id) found = child;
  });
  return found;
}
function firstMeshOf(root) {
  let found = null;
  root.traverse((child) => {
    if (found) return;
    if (child.userData?.t3dWaterMesh) return;
    const mesh = child;
    if (mesh.isMesh) found = mesh;
  });
  return found;
}
function releaseBound(id) {
  const entry = boundMeshes.get(id);
  if (!entry) return;
  entry.handle.reflectionTarget?.removeFromParent();
  if (entry.kind === "owned") {
    entry.mesh.removeFromParent();
  } else {
    if (entry.originalMaterial) entry.mesh.material = entry.originalMaterial;
    if (entry.originalGeometry) entry.mesh.geometry = entry.originalGeometry;
  }
  entry.handle.dispose();
  boundMeshes.delete(id);
}
function updateSunAndSky(scene2, backgroundHex) {
  let intensity = 1;
  const sunGroup = cachedSunId ? resolveNodeObject(scene2, cachedSunId) : null;
  let dirLight = null;
  if (sunGroup) {
    sunGroup.traverse((child) => {
      if (!dirLight && child.isDirectionalLight) dirLight = child;
    });
  }
  if (dirLight) {
    const light = dirLight;
    light.getWorldPosition(tmpSunDir);
    light.target.getWorldPosition(tmpToCam);
    tmpSunDir.sub(tmpToCam).normalize();
    if (tmpSunDir.lengthSq() < 1e-4) tmpSunDir.set(0.45, 0.72, 0.52).normalize();
    tmpSunColor.copy(light.color);
    intensity = light.intensity;
  } else {
    tmpSunDir.set(0.45, 0.72, 0.52).normalize();
    tmpSunColor.set("#fff7e0");
  }
  const elev = tmpSunDir.y;
  if (elev <= 0.02) {
    tmpSkyHorizon.copy(NIGHT_HORIZON);
    tmpSkyTop.copy(NIGHT_TOP);
  } else if (elev < 0.28) {
    const t = Math.min(1, Math.max(0, (elev - 0.02) / 0.26));
    tmpSkyHorizon.copy(DUSK_HORIZON).lerp(DAY_HORIZON, t);
    tmpSkyTop.copy(DUSK_TOP).lerp(DAY_TOP, t);
  } else {
    tmpSkyHorizon.copy(DAY_HORIZON);
    tmpSkyTop.copy(DAY_TOP);
  }
  if (scene2.background instanceof Color2) {
    tmpSkyHorizon.lerp(scene2.background, 0.35);
    tmpSkyTop.lerp(scene2.background, 0.25);
  } else {
    tmpBgColor.set(backgroundHex || "#141414");
    if (tmpBgColor.r + tmpBgColor.g + tmpBgColor.b > 0.25) {
      tmpSkyHorizon.lerp(tmpBgColor, 0.25);
    }
  }
  return intensity;
}
function specOf(raw) {
  if (!raw || typeof raw !== "object") return normalizeWater(raw);
  let spec = specCache.get(raw);
  if (!spec) {
    spec = normalizeWater(raw);
    specCache.set(raw, spec);
  }
  return spec;
}
function optionsFor(spec, upAxis, followGrid) {
  return {
    followGrid,
    planar: spec.quality !== "fast" && spec.planarReflection && spec.reflectionScale > 0,
    refraction: spec.refraction,
    caustics: spec.refraction && spec.caustics,
    highDetail: spec.quality !== "fast",
    upAxis,
    waves: spec.quality !== "fast" && spec.waveHeight > 1e-3,
    richWaves: spec.quality === "ultra"
  };
}
function onBeforeRender(ctx) {
  const runtime2 = getRuntimeWorld();
  if (!capabilityEnabled(runtime2.getCapabilities(), WATER_CAPABILITY_ID)) {
    for (const id of [...boundMeshes.keys()]) releaseBound(id);
    cachedNodesRef = null;
    cachedActiveIds = [];
    return;
  }
  const nodes = runtime2.getNodes();
  refreshActiveNodes(nodes);
  const activeSet = new Set(cachedActiveIds);
  for (const id of [...boundMeshes.keys()]) {
    if (!activeSet.has(id)) releaseBound(id);
  }
  if (cachedActiveIds.length === 0) return;
  waterTime += Math.min(0.05, Math.max(0, ctx.dt));
  const dt = Math.min(0.05, Math.max(0, ctx.dt));
  const sunIntensity = updateSunAndSky(ctx.scene, runtime2.getPicture().background);
  for (const id of cachedActiveIds) {
    const node = nodes[id];
    if (!node) continue;
    const raw = node.capabilities?.[WATER_CAPABILITY_ID];
    const spec = specOf(raw);
    if (!spec.enabled) continue;
    const root = resolveNodeObject(ctx.scene, id);
    if (!root) continue;
    const upAxis = node.kind === "model" ? "y" : "z";
    root.getWorldScale(tmpWorldScale);
    const hasWaves = spec.quality !== "fast" && spec.waveHeight > 1e-3;
    const followGrid = node.kind === "empty" && hasWaves && Math.max(Math.abs(tmpWorldScale.x), Math.abs(tmpWorldScale.z)) > FOLLOW_GRID_MIN_SIZE;
    const opts = optionsFor(spec, upAxis, followGrid);
    const nextVariant = waterVariantKey(opts);
    let entry = boundMeshes.get(id);
    if (entry && entry.handle.variantKey !== nextVariant) {
      releaseBound(id);
      entry = void 0;
    }
    if (node.kind === "empty") {
      if (entry && (entry.kind !== "owned" || entry.parent !== root)) {
        releaseBound(id);
        entry = void 0;
      }
      if (!entry) {
        const handle = createWaterMaterial(opts);
        const mesh = new Mesh2(followGrid ? getFollowGeometry() : getSharedPlaneGeometry(spec), handle.material);
        if (followGrid) mesh.raycast = raycastAsUnitPlane;
        mesh.name = "water-surface";
        mesh.rotation.x = -Math.PI / 2;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.userData.nodeId = id;
        mesh.userData.t3dWaterMesh = true;
        if (handle.reflectionTarget) mesh.add(handle.reflectionTarget);
        root.add(mesh);
        entry = { kind: "owned", mesh, parent: root, handle, waveTime: waterTime };
        boundMeshes.set(id, entry);
      }
      const targetGeo = followGrid ? getFollowGeometry() : getSharedPlaneGeometry(spec);
      if (entry.mesh.geometry !== targetGeo) entry.mesh.geometry = targetGeo;
      if (followGrid) {
        entry.mesh.updateWorldMatrix(true, false);
        ctx.camera.getWorldPosition(tmpToCam);
        entry.mesh.worldToLocal(tmpToCam);
        const sizeX = Math.max(1e-3, Math.abs(tmpWorldScale.x));
        const sizeY = Math.max(1e-3, Math.abs(tmpWorldScale.z));
        const snap = FOLLOW_GRID.snap;
        entry.handle.setGridCenter(
          Math.round(tmpToCam.x * sizeX / snap) * snap / sizeX,
          Math.round(tmpToCam.y * sizeY / snap) * snap / sizeY
        );
      }
    } else {
      const hostMesh = firstMeshOf(root);
      if (!hostMesh) continue;
      if (entry && (entry.kind !== "hosted" || entry.mesh !== hostMesh)) {
        releaseBound(id);
        entry = void 0;
      }
      if (!entry) {
        const isPlane = node.kind === "plane";
        const handle = createWaterMaterial(opts);
        if (handle.reflectionTarget) hostMesh.add(handle.reflectionTarget);
        entry = {
          kind: "hosted",
          mesh: hostMesh,
          originalMaterial: hostMesh.material,
          originalGeometry: hostMesh.geometry,
          isPlane,
          handle,
          waveTime: waterTime
        };
        boundMeshes.set(id, entry);
      }
      if (entry.isPlane) {
        const targetGeo = getSharedPlaneGeometry(spec);
        if (hostMesh.geometry !== targetGeo) hostMesh.geometry = targetGeo;
      }
      if (hostMesh.material !== entry.handle.material) {
        hostMesh.material = entry.handle.material;
      }
      hostMesh.castShadow = false;
      hostMesh.receiveShadow = false;
    }
    const customNormal = spec.normalMapAssetId ? runtime2.getTexture?.(spec.normalMapAssetId, false) ?? null : null;
    const customFoam = spec.foamMapAssetId ? runtime2.getTexture?.(spec.foamMapAssetId, false) ?? null : null;
    if (entry.specRef !== raw || entry.normalId !== spec.normalMapAssetId || entry.foamId !== spec.foamMapAssetId || entry.normalTex !== customNormal || entry.foamTex !== customFoam) {
      entry.handle.setSpec(spec, customNormal, customFoam);
      entry.specRef = raw;
      entry.normalId = spec.normalMapAssetId;
      entry.foamId = spec.foamMapAssetId;
      entry.normalTex = customNormal;
      entry.foamTex = customFoam;
    }
    entry.waveTime += dt * spec.waveSpeed;
    entry.swellTime = (entry.swellTime ?? entry.waveTime) + dt * spec.waveSpeed * spec.swellRate;
    root.getWorldScale(tmpWorldScale);
    entry.spec = spec;
    if (!entry.worldPos) entry.worldPos = new Vector35();
    if (!entry.worldScale) entry.worldScale = new Vector35(1, 1, 1);
    root.getWorldPosition(entry.worldPos);
    entry.worldScale.copy(tmpWorldScale);
    entry.handle.setInvScale(tmpWorldScale);
    const usesSharedPlane = entry.kind === "owned" || entry.isPlane === true;
    entry.handle.setCellSize(usesSharedPlane ? Math.max(Math.abs(tmpWorldScale.x), Math.abs(tmpWorldScale.z)) / SEGMENTS[spec.quality] : 0);
    entry.handle.setTime(waterTime, entry.waveTime, entry.swellTime);
    entry.handle.setSun(tmpSunDir, tmpSunColor, sunIntensity, tmpSkyHorizon, tmpSkyTop);
  }
}
function sampleWaterSurface(worldX, worldZ) {
  if (boundMeshes.size === 0) return null;
  let best = null;
  for (const [id, entry] of boundMeshes) {
    const spec = entry.spec;
    const worldPos = entry.worldPos;
    const worldScale = entry.worldScale;
    if (!spec || !spec.enabled || !worldPos || !worldScale) continue;
    if (entry.kind === "owned") {
      const parent = entry.parent;
      if (parent) {
        tmpSamplePoint.set(worldX, worldPos.y, worldZ);
        parent.worldToLocal(tmpSamplePoint);
        if (Math.abs(tmpSamplePoint.x) > 0.5 || Math.abs(tmpSamplePoint.z) > 0.5) continue;
      } else {
        if (Math.abs(worldX - worldPos.x) > Math.abs(worldScale.x) * 0.5 || Math.abs(worldZ - worldPos.z) > Math.abs(worldScale.z) * 0.5) continue;
      }
    }
    const wave = evaluateWaterWave(worldX, worldZ, spec, entry.waveTime, entry.swellTime ?? entry.waveTime);
    const height = worldPos.y + wave.dy;
    if (!best || height > best.height) {
      best = { height, normal: wave.normal, waterNodeId: id };
    }
  }
  return best;
}
function anyUnderwaterEffectEnabled() {
  for (const entry of boundMeshes.values()) {
    if (entry.spec?.enabled && entry.spec.underwaterEffect) return true;
  }
  return false;
}
function sampleUnderwaterView(worldX, worldY, worldZ) {
  if (boundMeshes.size === 0) return null;
  let bestHeight = -Infinity;
  let bestSpec = null;
  for (const entry of boundMeshes.values()) {
    const spec = entry.spec;
    const worldPos = entry.worldPos;
    const worldScale = entry.worldScale;
    if (!spec || !spec.enabled || !spec.underwaterEffect || !worldPos || !worldScale) continue;
    if (entry.kind === "owned") {
      const parent = entry.parent;
      if (parent) {
        tmpSamplePoint.set(worldX, worldPos.y, worldZ);
        parent.worldToLocal(tmpSamplePoint);
        if (Math.abs(tmpSamplePoint.x) > 0.5 || Math.abs(tmpSamplePoint.z) > 0.5) continue;
      } else {
        if (Math.abs(worldX - worldPos.x) > Math.abs(worldScale.x) * 0.5 || Math.abs(worldZ - worldPos.z) > Math.abs(worldScale.z) * 0.5) continue;
      }
    }
    const wave = evaluateWaterWave(worldX, worldZ, spec, entry.waveTime, entry.swellTime ?? entry.waveTime);
    const height = worldPos.y + wave.dy;
    if (worldY < height && height > bestHeight) {
      bestHeight = height;
      bestSpec = spec;
    }
  }
  if (!bestSpec) return null;
  const depth = bestHeight - worldY;
  return {
    weight: Math.min(1, Math.max(0, depth / 0.15)),
    color: bestSpec.underwaterColor,
    fogDensity: bestSpec.underwaterFogDensity,
    fogStart: bestSpec.underwaterFogStart,
    tint: bestSpec.underwaterTint
  };
}
function mount() {
  if (!removeBeforeRender) {
    removeBeforeRender = getRuntimeWorld().registerBeforeRenderHook?.("water", 30, (ctx) => onBeforeRender(ctx)) ?? null;
  }
  return dispose;
}
function dispose() {
  if (removeBeforeRender) {
    removeBeforeRender();
    removeBeforeRender = null;
  }
  for (const id of [...boundMeshes.keys()]) releaseBound(id);
  for (const key of ["flat", "fast", "balanced", "ultra"]) {
    planeGeos[key]?.dispose();
    planeGeos[key] = null;
  }
  followGeo?.dispose();
  followGeo = null;
  cachedNodeObjects.clear();
  cachedNodesRef = null;
  cachedActiveIds = [];
  cachedSunId = null;
}
var boundMeshes, planeGeos, SEGMENTS, removeBeforeRender, waterTime, cachedNodesRef, cachedActiveIds, cachedSunId, cachedNodeObjects, cachedSceneRef, cachedChildCount, tmpToCam, tmpWorldScale, tmpSamplePoint, tmpSunDir, tmpSunColor, tmpSkyHorizon, tmpSkyTop, tmpBgColor, DAY_HORIZON, DAY_TOP, DUSK_HORIZON, DUSK_TOP, NIGHT_HORIZON, NIGHT_TOP, FOLLOW_GRID_MIN_SIZE, followGeo, specCache, waterRuntimeModule, session_default;
var init_session2 = __esm({
  "src/capabilities/water/session.ts"() {
    "use strict";
    init_world();
    init_registry2();
    init_defaults();
    init_waterMaterial();
    init_waves();
    boundMeshes = /* @__PURE__ */ new Map();
    planeGeos = { flat: null, fast: null, balanced: null, ultra: null };
    SEGMENTS = { flat: 1, fast: 32, balanced: 128, ultra: 160 };
    removeBeforeRender = null;
    waterTime = 0;
    cachedNodesRef = null;
    cachedActiveIds = [];
    cachedSunId = null;
    cachedNodeObjects = /* @__PURE__ */ new Map();
    cachedSceneRef = null;
    cachedChildCount = -1;
    tmpToCam = new Vector35();
    tmpWorldScale = new Vector35(1, 1, 1);
    tmpSamplePoint = new Vector35();
    tmpSunDir = new Vector35(0.45, 0.72, 0.52).normalize();
    tmpSunColor = new Color2("#fff7e0");
    tmpSkyHorizon = new Color2("#e0f2fe");
    tmpSkyTop = new Color2("#7dd3fc");
    tmpBgColor = new Color2("#141414");
    DAY_HORIZON = new Color2("#e0f2fe");
    DAY_TOP = new Color2("#7dd3fc");
    DUSK_HORIZON = new Color2("#fed7aa");
    DUSK_TOP = new Color2("#475569");
    NIGHT_HORIZON = new Color2("#1e293b");
    NIGHT_TOP = new Color2("#020617");
    FOLLOW_GRID_MIN_SIZE = 64;
    followGeo = null;
    specCache = /* @__PURE__ */ new WeakMap();
    waterRuntimeModule = { mount, dispose };
    session_default = waterRuntimeModule;
  }
});

// src/capabilities/buoyancy/defaults.ts
function defaultBuoyancy() {
  return {
    enabled: true,
    buoyancyForce: 1.6,
    waterDrag: 2.5,
    angularDrag: 2,
    sampleMode: "box4",
    draftDepth: 0
  };
}
function clamp2(value, min3, max4) {
  return Math.max(min3, Math.min(max4, value));
}
function finite2(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function normalizeBuoyancy(raw) {
  const base = defaultBuoyancy();
  if (!raw || typeof raw !== "object") return base;
  const input = raw;
  const mode = input.sampleMode === "box8" || input.sampleMode === "center" ? input.sampleMode : "box4";
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : base.enabled,
    buoyancyForce: clamp2(finite2(input.buoyancyForce, base.buoyancyForce), 0, 10),
    waterDrag: clamp2(finite2(input.waterDrag, base.waterDrag), 0, 20),
    angularDrag: clamp2(finite2(input.angularDrag, base.angularDrag), 0, 20),
    sampleMode: mode,
    draftDepth: clamp2(finite2(input.draftDepth, base.draftDepth), 0, 20)
  };
}
var BUOYANCY_CAPABILITY_ID;
var init_defaults2 = __esm({
  "src/capabilities/buoyancy/defaults.ts"() {
    "use strict";
    BUOYANCY_CAPABILITY_ID = "buoyancy";
  }
});

// src/capabilities/buoyancy/session.ts
var session_exports2 = {};
__export(session_exports2, {
  default: () => session_default2,
  dispose: () => dispose2,
  mount: () => mount2
});
import { Quaternion as Quaternion3, Vector3 as Vector36 } from "three";
function specOf2(raw) {
  if (!raw || typeof raw !== "object") return normalizeBuoyancy(raw);
  const cached = specCache2.get(raw);
  if (cached) return cached;
  const next = normalizeBuoyancy(raw);
  specCache2.set(raw, next);
  return next;
}
function sampleOffsets(mode, hx, hy, hz) {
  if (mode === "center") return [[0, 0, 0]];
  const ax = hx * 0.75;
  const az = hz * 0.75;
  if (mode === "box8") {
    const ay = hy * 0.75;
    return [
      [-ax, -ay, -az],
      [ax, -ay, -az],
      [-ax, -ay, az],
      [ax, -ay, az],
      [-ax, ay, -az],
      [ax, ay, -az],
      [-ax, ay, az],
      [ax, ay, az]
    ];
  }
  const by = -hy * 0.6;
  return [
    [-ax, by, -az],
    [ax, by, -az],
    [-ax, by, az],
    [ax, by, az]
  ];
}
function halfExtents(nodes, node) {
  const physics = node.physics;
  if (!physics) return [0.5, 0.5, 0.5];
  const pose = worldPose(nodes, node.id);
  tmpScale.set(Math.abs(pose.scale.x), Math.abs(pose.scale.y), Math.abs(pose.scale.z));
  const size = physics.size;
  if (physics.shape === "sphere") {
    const r = Math.max(0.05, size[0]) * Math.max(tmpScale.x, tmpScale.y, tmpScale.z);
    return [r, r, r];
  }
  if (physics.shape === "capsule") {
    const r = Math.max(0.05, size[0]) * Math.max(tmpScale.x, tmpScale.z);
    const hy = Math.max(r, Math.max(0.1, size[1]) * 0.5 * tmpScale.y);
    return [r, hy, r];
  }
  return [
    Math.max(0.05, size[0] * 0.5 * tmpScale.x),
    Math.max(0.05, size[1] * 0.5 * tmpScale.y),
    Math.max(0.05, size[2] * 0.5 * tmpScale.z)
  ];
}
function stepBuoyancy(ctx) {
  const runtime2 = getRuntimeWorld();
  const gravityY = Math.abs(runtime2.getPicture().gravity?.[1] ?? -9.81);
  const stepDt = Math.max(ctx.dt, 1 / 120);
  const nodes = runtime2.getNodes();
  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[BUOYANCY_CAPABILITY_ID];
    if (!raw || !node.physics || node.physics.body !== "dynamic") continue;
    const spec = specOf2(raw);
    if (!spec.enabled) continue;
    const body = ctx.world.bodyState(node.id);
    if (!body) continue;
    const [hx, hy, hz] = halfExtents(nodes, node);
    const points = sampleOffsets(spec.sampleMode, hx, hy, hz);
    const draft = spec.draftDepth > 0.01 ? spec.draftDepth : Math.max(0.15, hy * 1.4);
    const pointMass = body.mass / points.length;
    const pointWeight = pointMass * gravityY * Math.max(0, node.physics.gravityScale ?? 1);
    tmpQuat.set(body.rotation[0], body.rotation[1], body.rotation[2], body.rotation[3]);
    let subSum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const local = points[i];
      tmpOffset.set(local[0], local[1], local[2]).applyQuaternion(tmpQuat);
      const wx = body.position[0] + tmpOffset.x;
      const wy = body.position[1] + tmpOffset.y;
      const wz = body.position[2] + tmpOffset.z;
      const water = sampleWaterSurface(wx, wz);
      if (!water || wy >= water.height) continue;
      const submersion = Math.min(1, (water.height - wy) / draft);
      subSum += submersion;
      const upForce = submersion * spec.buoyancyForce * pointWeight;
      const wavePushX = water.normal[0] * upForce * 0.18;
      const wavePushZ = water.normal[2] * upForce * 0.18;
      const vx = body.linvel[0] + (body.angvel[1] * tmpOffset.z - body.angvel[2] * tmpOffset.y);
      const vy = body.linvel[1] + (body.angvel[2] * tmpOffset.x - body.angvel[0] * tmpOffset.z);
      const vz = body.linvel[2] + (body.angvel[0] * tmpOffset.y - body.angvel[1] * tmpOffset.x);
      const dragGain = spec.waterDrag * submersion * pointMass;
      const maxImpulseRate = pointMass / stepDt * 0.65;
      const clampDrag = (v) => {
        const rawDrag = -v * dragGain;
        const limit = Math.abs(v) * maxImpulseRate;
        return Math.max(-limit, Math.min(limit, rawDrag));
      };
      ctx.world.applyForceAtPoint(
        node.id,
        [wavePushX + clampDrag(vx), upForce + clampDrag(vy), wavePushZ + clampDrag(vz)],
        [wx, wy, wz]
      );
    }
    if (subSum > 0 && spec.angularDrag > 0) {
      const avgSub = subSum / points.length;
      const angGain = spec.angularDrag * avgSub * body.mass * 0.45;
      const maxAngRate = body.mass / stepDt * 0.5;
      const clampAng = (w) => {
        const rawTorque = -w * angGain;
        const limit = Math.abs(w) * maxAngRate;
        return Math.max(-limit, Math.min(limit, rawTorque));
      };
      ctx.world.applyTorque(node.id, [
        clampAng(body.angvel[0]),
        clampAng(body.angvel[1]),
        clampAng(body.angvel[2])
      ]);
    }
  }
}
function mount2() {
  if (!unregister) {
    unregister = registerPhysicsExtension("buoyancy", 20, stepBuoyancy);
  }
  return dispose2;
}
function dispose2() {
  unregister?.();
  unregister = null;
}
var unregister, tmpQuat, tmpOffset, tmpScale, specCache2, buoyancyRuntimeModule, session_default2;
var init_session3 = __esm({
  "src/capabilities/buoyancy/session.ts"() {
    "use strict";
    init_transform();
    init_world();
    init_session();
    init_session2();
    init_defaults2();
    unregister = null;
    tmpQuat = new Quaternion3();
    tmpOffset = new Vector36();
    tmpScale = new Vector36();
    specCache2 = /* @__PURE__ */ new WeakMap();
    buoyancyRuntimeModule = { mount: mount2, dispose: dispose2 };
    session_default2 = buoyancyRuntimeModule;
  }
});

// src/runtime/motion.ts
function evalEasing(name, rawT) {
  const t = Math.max(0, Math.min(1, Number.isFinite(rawT) ? rawT : 0));
  switch (name) {
    case "inQuad":
      return t * t;
    case "outQuad":
      return 1 - (1 - t) * (1 - t);
    case "inOutQuad":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "inCubic":
      return t * t * t;
    case "outCubic":
      return 1 - Math.pow(1 - t, 3);
    case "inOutCubic":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "inOutSine":
      return -(Math.cos(Math.PI * t) - 1) / 2;
    case "outBack": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case "inOutBack": {
      const c1 = 1.70158;
      const c2 = c1 * 1.525;
      return t < 0.5 ? Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    }
    case "outBounce": {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) {
        const u2 = t - 1.5 / d1;
        return n1 * u2 * u2 + 0.75;
      }
      if (t < 2.5 / d1) {
        const u2 = t - 2.25 / d1;
        return n1 * u2 * u2 + 0.9375;
      }
      const u = t - 2.625 / d1;
      return n1 * u * u + 0.984375;
    }
    case "outElastic": {
      if (t === 0 || t === 1) return t;
      const c4 = 2 * Math.PI / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    case "linear":
    default:
      return t;
  }
}
function normalizeCurveKeys(rawKeys) {
  const out = [];
  for (const k of rawKeys) {
    if (Array.isArray(k)) {
      const t = Number(k[0]);
      const v = Number(k[1]);
      if (Number.isFinite(t) && Number.isFinite(v)) {
        out.push({ t, v, mode: "smooth" });
      }
    } else if (k && typeof k === "object") {
      const obj = k;
      const t = Number(obj.t);
      const v = Number(obj.v);
      const mode = obj.mode === "linear" || obj.mode === "step" ? obj.mode : "smooth";
      if (Number.isFinite(t) && Number.isFinite(v)) {
        out.push({ t, v, mode });
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
function evalCurveKeys(keys, rawT, wrapMode = "clamp") {
  if (keys.length === 0) return 0;
  if (keys.length === 1) return keys[0].v;
  const minT = keys[0].t;
  const maxT = keys[keys.length - 1].t;
  const span = maxT - minT;
  let t = Number.isFinite(rawT) ? rawT : minT;
  if (span > 1e-6) {
    if (wrapMode === "loop") {
      const offset = ((t - minT) % span + span) % span;
      t = minT + offset;
    } else if (wrapMode === "pingPong") {
      const cycle = span * 2;
      const offset = ((t - minT) % cycle + cycle) % cycle;
      t = offset <= span ? minT + offset : maxT - (offset - span);
    } else {
      t = Math.max(minT, Math.min(maxT, t));
    }
  } else {
    return keys[0].v;
  }
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t || i === keys.length - 2) {
      const segLen = b.t - a.t;
      if (segLen <= 1e-6) return b.v;
      const u = Math.max(0, Math.min(1, (t - a.t) / segLen));
      if (a.mode === "step") return a.v;
      if (a.mode === "linear") return a.v + (b.v - a.v) * u;
      const s = u * u * (3 - 2 * u);
      return a.v + (b.v - a.v) * s;
    }
  }
  return keys[keys.length - 1].v;
}
function createAnimationCurve(rawKeys, options) {
  const keys = normalizeCurveKeys(rawKeys);
  const wrap = options?.wrap ?? "clamp";
  return {
    keys,
    eval: (t) => evalCurveKeys(keys, t, wrap)
  };
}
function catmullRomValue(p0, p1, p2, p3, t, tension) {
  const t2 = t * t;
  const t3 = t2 * t;
  const m1 = tension * (p2 - p0);
  const m2 = tension * (p3 - p1);
  const a = 2 * p1 - 2 * p2 + m1 + m2;
  const b = -3 * p1 + 3 * p2 - 2 * m1 - m2;
  return a * t3 + b * t2 + m1 * t + p1;
}
function createSplinePath(rawPoints, options) {
  const points = rawPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const closed = Boolean(options?.closed);
  const tension = Number.isFinite(options?.tension) ? Number(options?.tension) : 0.5;
  const samplesPerSegment = Math.max(4, Math.min(64, Math.floor(options?.samplesPerSegment ?? 16)));
  if (points.length === 0) {
    const zero = { x: 0, y: 0, z: 0 };
    return {
      length: 0,
      points,
      closed,
      pointAt: () => ({ ...zero }),
      tangentAt: () => ({ x: 0, y: 0, z: 1 }),
      pointAtDistance: () => ({ ...zero }),
      tangentAtDistance: () => ({ x: 0, y: 0, z: 1 })
    };
  }
  if (points.length === 1) {
    const only = points[0];
    return {
      length: 0,
      points,
      closed,
      pointAt: () => ({ ...only }),
      tangentAt: () => ({ x: 0, y: 0, z: 1 }),
      pointAtDistance: () => ({ ...only }),
      tangentAtDistance: () => ({ x: 0, y: 0, z: 1 })
    };
  }
  const segCount = closed ? points.length : points.length - 1;
  const getCtrl = (idx) => {
    if (closed) {
      const wrapped = (idx % points.length + points.length) % points.length;
      return points[wrapped];
    }
    const clamped = Math.max(0, Math.min(points.length - 1, idx));
    return points[clamped];
  };
  const rawPointAt = (uRaw) => {
    const u = closed ? (uRaw % 1 + 1) % 1 : Math.max(0, Math.min(1, uRaw));
    const scaled = u * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(scaled));
    const localT = scaled - segIdx;
    const p0 = getCtrl(segIdx - 1);
    const p1 = getCtrl(segIdx);
    const p2 = getCtrl(segIdx + 1);
    const p3 = getCtrl(segIdx + 2);
    return {
      x: catmullRomValue(p0.x, p1.x, p2.x, p3.x, localT, tension),
      y: catmullRomValue(p0.y, p1.y, p2.y, p3.y, localT, tension),
      z: catmullRomValue(p0.z, p1.z, p2.z, p3.z, localT, tension)
    };
  };
  const totalSamples = segCount * samplesPerSegment;
  const lutU = [0];
  const lutDist = [0];
  let acc = 0;
  let prev = rawPointAt(0);
  for (let i = 1; i <= totalSamples; i += 1) {
    const u = i / totalSamples;
    const cur = rawPointAt(u);
    acc += Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
    lutU.push(u);
    lutDist.push(acc);
    prev = cur;
  }
  const totalLength = acc;
  const distanceToU = (distRaw) => {
    if (totalLength <= 1e-6) return 0;
    const d = closed ? (distRaw % totalLength + totalLength) % totalLength : Math.max(0, Math.min(totalLength, distRaw));
    let lo = 0;
    let hi = lutDist.length - 1;
    while (lo < hi - 1) {
      const mid = lo + hi >> 1;
      if (lutDist[mid] <= d) lo = mid;
      else hi = mid;
    }
    const d0 = lutDist[lo];
    const d1 = lutDist[hi];
    const ratio = d1 > d0 + 1e-6 ? (d - d0) / (d1 - d0) : 0;
    return lutU[lo] + (lutU[hi] - lutU[lo]) * ratio;
  };
  const tangentFromU = (u) => {
    const eps = 1 / Math.max(100, totalSamples * 2);
    const a = rawPointAt(u - eps);
    const b = rawPointAt(u + eps);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len <= 1e-6) return { x: 0, y: 0, z: 1 };
    return { x: dx / len, y: dy / len, z: dz / len };
  };
  return {
    length: totalLength,
    points,
    closed,
    pointAt: (t) => rawPointAt(distanceToU((closed ? (t % 1 + 1) % 1 : Math.max(0, Math.min(1, t))) * totalLength)),
    tangentAt: (t) => tangentFromU(distanceToU((closed ? (t % 1 + 1) % 1 : Math.max(0, Math.min(1, t))) * totalLength)),
    pointAtDistance: (distance2) => rawPointAt(distanceToU(distance2)),
    tangentAtDistance: (distance2) => tangentFromU(distanceToU(distance2))
  };
}
var init_motion = __esm({
  "src/runtime/motion.ts"() {
    "use strict";
  }
});

// src/capabilities/navigation/archive.ts
function navEpoch() {
  return epoch;
}
function navRecord(sceneId) {
  return saved.get(sceneId) ?? null;
}
function forgetNavMesh(sceneId) {
  saved.delete(sceneId);
}
function hydrateNavMeshes(value) {
  saved.clear();
  epoch += 1;
  if (!value || typeof value !== "object") return;
  for (const [id, record] of Object.entries(value)) {
    const cleaned = cleanRecord(record);
    if (cleaned) saved.set(id, cleaned);
  }
}
function decodeBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function cleanRecord(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  if (typeof record.bytes !== "string" || record.bytes.length === 0) return null;
  if (record.mode !== "solo" && record.mode !== "tileCache") return null;
  if (typeof record.signature !== "string") return null;
  return {
    bytes: record.bytes,
    mode: record.mode,
    signature: record.signature,
    triangles: typeof record.triangles === "number" ? record.triangles : 0
  };
}
var saved, epoch;
var init_archive = __esm({
  "src/capabilities/navigation/archive.ts"() {
    "use strict";
    saved = /* @__PURE__ */ new Map();
    epoch = 0;
  }
});

// src/capabilities/navigation/defaults.ts
var init_defaults3 = __esm({
  "src/capabilities/navigation/defaults.ts"() {
    "use strict";
  }
});

// src/capabilities/navigation/recastNav.ts
var recastNav_exports = {};
__export(recastNav_exports, {
  createRecastNavigation: () => createRecastNavigation
});
import {
  exportNavMesh,
  exportTileCache,
  getNavMeshPositionsAndIndices,
  importNavMesh,
  importTileCache,
  init,
  NavMeshQuery
} from "recast-navigation";
import { createDefaultTileCacheMeshProcess } from "recast-navigation/generators";
async function createRecastNavigation() {
  await init();
  return new RecastNavigation();
}
function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
var RecastNavigation;
var init_recastNav = __esm({
  "src/capabilities/navigation/recastNav.ts"() {
    "use strict";
    RecastNavigation = class {
      navMesh = null;
      tileCache = null;
      query = null;
      retained = [];
      carved = /* @__PURE__ */ new Map();
      worker = null;
      mode = "solo";
      async bake(positions, indices, config, signal) {
        if (signal.aborted) throw abortError();
        this.worker?.terminate();
        const worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
        this.worker = worker;
        const response = await new Promise((resolve, reject) => {
          const stop = () => {
            worker.terminate();
            reject(abortError());
          };
          if (signal.aborted) {
            stop();
            return;
          }
          signal.addEventListener("abort", stop, { once: true });
          worker.onmessage = (event) => {
            signal.removeEventListener("abort", stop);
            resolve(event.data);
          };
          worker.onerror = () => {
            signal.removeEventListener("abort", stop);
            reject(new Error("navigation worker failed"));
          };
          const positionCopy = new Float32Array(positions);
          const indexCopy = new Uint32Array(indices);
          worker.postMessage(
            { positions: positionCopy, indices: indexCopy, config },
            [positionCopy.buffer, indexCopy.buffer]
          );
        });
        if (this.worker === worker) this.worker = null;
        worker.terminate();
        if (signal.aborted) throw abortError();
        if (!response.ok) throw new Error(response.error || "bake failed");
        await this.restore({ bytes: response.bytes, mode: response.mode });
      }
      async restore(record) {
        this.releaseMesh();
        if (record.mode === "tileCache") {
          const imported = importTileCache(record.bytes, createDefaultTileCacheMeshProcess());
          this.navMesh = imported.navMesh;
          this.tileCache = imported.tileCache;
          this.retained = [imported.allocator, imported.compressor];
          this.mode = "tileCache";
        } else {
          this.navMesh = importNavMesh(record.bytes).navMesh;
          this.mode = "solo";
        }
        this.query = new NavMeshQuery(this.navMesh);
        this.query.defaultQueryHalfExtents = { x: 2, y: 4, z: 2 };
      }
      clear() {
        this.releaseMesh();
      }
      obstacles(items) {
        const cache = this.tileCache;
        const mesh = this.navMesh;
        if (!cache || !mesh || this.mode !== "tileCache") return;
        let changed = this.carved.size > 0 || items.length > 0;
        for (const obstacle of this.carved.values()) cache.removeObstacle(obstacle);
        this.carved.clear();
        for (const item of items) {
          const added = cache.addCylinderObstacle(
            { x: item.position[0], y: item.position[1], z: item.position[2] },
            item.radius,
            item.height
          );
          if (!added.success || !added.obstacle) continue;
          this.carved.set(item.id, added.obstacle);
        }
        if (!changed) return;
        for (let step2 = 0; step2 < 8; step2 += 1) {
          const updated = cache.update(mesh);
          if (updated.upToDate) break;
        }
      }
      findPath(start2, end) {
        if (!this.query) return null;
        const result = this.query.computePath(
          { x: start2[0], y: start2[1], z: start2[2] },
          { x: end[0], y: end[1], z: end[2] }
        );
        if (!result.success || result.path.length === 0) return null;
        return result.path.map((point2) => [point2.x, point2.y, point2.z]);
      }
      debug() {
        if (!this.navMesh) return null;
        const [positions, indices] = getNavMeshPositionsAndIndices(this.navMesh);
        if (positions.length === 0 || indices.length === 0) return null;
        return {
          positions: Float32Array.from(positions),
          indices: Uint32Array.from(indices)
        };
      }
      exportRecord() {
        if (!this.navMesh) return null;
        if (this.mode === "tileCache" && this.tileCache) {
          return { bytes: new Uint8Array(exportTileCache(this.navMesh, this.tileCache)), mode: "tileCache" };
        }
        return { bytes: new Uint8Array(exportNavMesh(this.navMesh)), mode: "solo" };
      }
      dispose() {
        this.worker?.terminate();
        this.worker = null;
        this.releaseMesh();
      }
      releaseMesh() {
        this.carved.clear();
        this.query?.destroy();
        this.query = null;
        this.tileCache?.destroy();
        this.tileCache = null;
        this.navMesh?.destroy();
        this.navMesh = null;
        this.retained.splice(0, this.retained.length);
        this.mode = "solo";
      }
    };
  }
});

// src/capabilities/navigation/session.ts
import { create } from "zustand";
function tr(key, fallback) {
  return getRuntimeWorld().translate?.(key) ?? fallback;
}
function hydrateNavigation(value) {
  hydrateNavMeshes(value);
  loadedScene = "";
}
function cancelNavBake() {
  controller?.abort();
  controller = null;
  pending = null;
  if (useNavUi.getState().phase === "baking") {
    useNavUi.setState({ phase: "idle", text: "" });
  }
}
function findNavigationPath(start2, end) {
  const runtime2 = getRuntimeWorld();
  if (!capabilityEnabled(runtime2.getCapabilities(), "navigation")) return null;
  return instance?.findPath(start2, end) ?? null;
}
function tickNavigation() {
  const runtime2 = getRuntimeWorld();
  if (!capabilityEnabled(runtime2.getCapabilities(), "navigation")) {
    if (instance || controller || debugMesh || loadedScene) disposeWorld();
    return;
  }
  const sceneId = runtime2.getActiveSceneId();
  const ui = useNavUi.getState();
  if (ui.phase === "baking" && ui.sceneId !== sceneId) cancelNavBake();
  if (!activating && (loadedScene !== sceneId || seenEpoch !== navEpoch())) {
    activating = true;
    void activate(sceneId).finally(() => {
      activating = false;
    });
  }
  if (!instance || loadedScene !== sceneId) return;
  applyObstacles(runtime2.getPlayState() === "playing" ? collectObstacles(runtime2.getNodes()) : []);
}
async function activate(sceneId) {
  const ticket = life;
  const record = navRecord(sceneId);
  seenEpoch = navEpoch();
  if (useNavUi.getState().phase === "baking" && useNavUi.getState().sceneId === sceneId) {
    loadedScene = sceneId;
    return;
  }
  if (!record) {
    instance?.clear();
    loadedScene = sceneId;
    obstacleKey = "";
    pullDebug();
    if (useNavUi.getState().phase !== "baking") {
      useNavUi.setState({ phase: "idle", text: "", sceneId, signature: "", triangles: 0 });
    }
    return;
  }
  try {
    const nav = await world2();
    if (ticket !== life || getRuntimeWorld().getActiveSceneId() !== sceneId) return;
    await nav.restore({ bytes: decodeBytes(record.bytes), mode: record.mode });
    if (ticket !== life || getRuntimeWorld().getActiveSceneId() !== sceneId) return;
    loadedScene = sceneId;
    obstacleKey = "";
    pullDebug();
    useNavUi.setState({
      phase: "ready",
      text: tr("navigation.ready", "Navigation ready"),
      sceneId,
      signature: record.signature,
      triangles: record.triangles
    });
  } catch (error) {
    if (ticket !== life) return;
    const text = error instanceof Error ? error.message : String(error);
    useNavUi.setState({ phase: "error", text, sceneId });
  }
}
async function world2() {
  if (instance) return instance;
  const ticket = life;
  if (!opening) opening = Promise.resolve().then(() => (init_recastNav(), recastNav_exports)).then((module) => module.createRecastNavigation());
  const created = await opening;
  opening = null;
  if (ticket !== life || !capabilityEnabled(getRuntimeWorld().getCapabilities(), "navigation")) {
    created.dispose();
    throw abortError2();
  }
  if (instance && instance !== created) created.dispose();
  instance ??= created;
  return instance;
}
function applyObstacles(items) {
  const key = items.map((item) => [
    item.id,
    item.position.map((value) => value.toFixed(2)).join(","),
    item.radius.toFixed(2),
    item.height.toFixed(2)
  ].join(":")).join("|");
  if (key === obstacleKey) return;
  obstacleKey = key;
  instance?.obstacles(items);
  pullDebug();
}
function collectObstacles(nodes) {
  const items = [];
  for (const node of Object.values(nodes)) {
    if (!node.visible || node.navigation?.role !== "obstacle") continue;
    const pose = worldPose(nodes, node.id);
    const radius = Math.max(0.05, node.navigation.radius) * Math.max(Math.abs(pose.scale.x), Math.abs(pose.scale.z));
    const height = Math.max(0.05, node.navigation.height) * Math.abs(pose.scale.y);
    items.push({
      id: node.id,
      position: [pose.position.x, pose.position.y - height / 2, pose.position.z],
      radius,
      height
    });
  }
  return items;
}
function pullDebug() {
  debugMesh = instance?.debug() ?? null;
}
function disposeWorld() {
  life += 1;
  controller?.abort();
  controller = null;
  pending = null;
  instance?.dispose();
  instance = null;
  opening = null;
  loadedScene = "";
  obstacleKey = "";
  debugMesh = null;
  if (useNavUi.getState().phase === "baking") useNavUi.setState({ phase: "idle", text: "" });
}
function abortError2() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
var useNavUi, instance, opening, life, loadedScene, seenEpoch, activating, controller, pending, obstacleKey, debugMesh;
var init_session4 = __esm({
  "src/capabilities/navigation/session.ts"() {
    "use strict";
    init_registry2();
    init_transform();
    init_world();
    init_archive();
    init_defaults3();
    useNavUi = create(() => ({
      phase: "idle",
      text: "",
      sceneId: "",
      signature: "",
      triangles: 0
    }));
    instance = null;
    opening = null;
    life = 0;
    loadedScene = "";
    seenEpoch = -1;
    activating = false;
    controller = null;
    pending = null;
    obstacleKey = "";
    debugMesh = null;
  }
});

// src/capabilities/particles/readQuarks.ts
function readQuarksDocument(json) {
  if (!json || typeof json !== "object") return null;
  const record = json;
  if (record.version === "3.0" && record.shape && typeof record.shape === "object") {
    const body = { ...record };
    delete body.material;
    delete body.texture;
    return {
      simulation: { format: "system", body },
      appearance: appearanceFromFields(record, DEFAULT_APPEARANCE)
    };
  }
  if (record.object && typeof record.object === "object") {
    const system = findSystem(record.object);
    return {
      simulation: { format: "loader", body: record },
      appearance: appearanceFromLoader(record, system)
    };
  }
  return null;
}
function asSimulation(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  if ((record.format === "system" || record.format === "loader") && record.body && typeof record.body === "object") {
    return { format: record.format, body: record.body };
  }
  return readQuarksDocument(value)?.simulation ?? null;
}
function appearanceFromLoader(root, system) {
  const materials = Array.isArray(root.materials) ? root.materials : [];
  const materialId = system && typeof system.material === "string" ? system.material : "";
  const material = materials.find((item) => item && typeof item === "object" && item.uuid === materialId);
  const appearance = appearanceFromFields(material ?? system ?? {}, DEFAULT_APPEARANCE);
  appearance.image = firstImage(root);
  return appearance;
}
function appearanceFromFields(source, fallback) {
  const premultiplied = source.premultipliedAlpha === true;
  return {
    color: cssColor(source.color) ?? fallback.color,
    blend: premultiplied ? "premultiply" : blendFromThree(source.blending, fallback.blend),
    opacity: typeof source.opacity === "number" ? source.opacity : fallback.opacity,
    depthWrite: typeof source.depthWrite === "boolean" ? source.depthWrite : fallback.depthWrite,
    image: fallback.image
  };
}
function blendFromThree(value, fallback) {
  if (value === 2) return "additive";
  if (value === 4) return "multiply";
  if (value === 1) return "alpha";
  if (value === 5) return "premultiply";
  return fallback;
}
function cssColor(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `#${Math.max(0, Math.min(16777215, value)).toString(16).padStart(6, "0")}`;
}
function firstImage(root) {
  if (!Array.isArray(root.images)) return null;
  for (const image of root.images) {
    if (image && typeof image === "object" && typeof image.url === "string") {
      const url = image.url;
      if (url.length > 0) return url;
    }
  }
  return null;
}
function findSystem(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  if (record.ps && typeof record.ps === "object") return record.ps;
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      const found = findSystem(child);
      if (found) return found;
    }
  }
  return null;
}
var DEFAULT_APPEARANCE;
var init_readQuarks = __esm({
  "src/capabilities/particles/readQuarks.ts"() {
    "use strict";
    DEFAULT_APPEARANCE = {
      color: "#ff8c33",
      blend: "additive",
      opacity: 1,
      depthWrite: false,
      image: null
    };
  }
});

// src/capabilities/particles/simulationForm.ts
function readRange(value) {
  if (!value || typeof value !== "object") return { min: 0, max: 0, curve: false };
  const record = value;
  if (record.type === "ConstantValue" && typeof record.value === "number") return { min: record.value, max: record.value, curve: false };
  if (record.type === "IntervalValue" && typeof record.a === "number" && typeof record.b === "number") {
    return { min: record.a, max: record.b, curve: false };
  }
  return { min: 0, max: 0, curve: true };
}
function systemBodyForPlayback(body) {
  if (!body || typeof body !== "object") return body;
  const record = body;
  if (record.renderMode !== 3) return body;
  const settings = settingsOf(record);
  const stored = readRange(settings.startLength);
  if (stored.curve || stored.min >= 2) return body;
  return {
    ...record,
    rendererEmitterSettings: {
      ...settings,
      startLength: { type: "ConstantValue", value: TRAIL_SAMPLES },
      followLocalOrigin: settings.followLocalOrigin === true
    }
  };
}
function settingsOf(record) {
  return record.rendererEmitterSettings && typeof record.rendererEmitterSettings === "object" ? record.rendererEmitterSettings : {};
}
var TRAIL_SAMPLES;
var init_simulationForm = __esm({
  "src/capabilities/particles/simulationForm.ts"() {
    "use strict";
    TRAIL_SAMPLES = 30;
  }
});

// src/capabilities/particles/tslBatch.ts
import {
  AdditiveBlending,
  Color as Color3,
  CustomBlending,
  MultiplyBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector2 as Vector22
} from "three";
import {
  attribute,
  cameraPosition as cameraPosition2,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  float as float2,
  floor,
  fract,
  length as length2,
  max as max2,
  mix as mix3,
  mod,
  modelWorldMatrix as modelWorldMatrix2,
  normalize as normalize2,
  positionGeometry as positionGeometry2,
  texture as texture2,
  uniform as uniform2,
  uv,
  vec2 as vec22,
  vec3 as vec32,
  vec4 as vec42
} from "three/tsl";
import { MeshBasicNodeMaterial as MeshBasicNodeMaterial2 } from "three/webgpu";
import {
  BatchedRenderer,
  RenderMode,
  SpriteBatch,
  TrailBatch
} from "three.quarks";
function sameColor(a, b) {
  const left = a.color;
  const right = b.color;
  if (!left || !right) return left === right;
  return left.r === right.r && left.g === right.g && left.b === right.b;
}
function sameBatch(a, b) {
  return a.material.side === b.material.side && a.material.blending === b.material.blending && a.material.blendSrc === b.material.blendSrc && a.material.blendDst === b.material.blendDst && a.material.blendEquation === b.material.blendEquation && a.material.premultipliedAlpha === b.material.premultipliedAlpha && a.material.transparent === b.material.transparent && a.material.depthTest === b.material.depthTest && a.material.depthWrite === b.material.depthWrite && a.material.opacity === b.material.opacity && sameColor(a.material, b.material) && a.material.type === b.material.type && a.material.alphaTest === b.material.alphaTest && a.material.map === b.material.map && a.renderMode === b.renderMode && a.blendTiles === b.blendTiles && a.softParticles === b.softParticles && a.softFarFade === b.softFarFade && a.softNearFade === b.softNearFade && a.uTileCount === b.uTileCount && a.vTileCount === b.vTileCount && a.instancingGeometry === b.instancingGeometry && a.renderOrder === b.renderOrder && a.layers.mask === b.layers.mask;
}
function createSpriteMaterial(settings) {
  const source = settings.material;
  const material = new MeshBasicNodeMaterial2();
  copySurface(material, source);
  const particleColor = attr(PARTICLE_ATTR.color, "vec4");
  const uvTile = attr(PARTICLE_ATTR.uvTile, "float");
  const tiles = uni(new Vector22(settings.uTileCount, settings.vTileCount));
  const tint = uni(new Color3(source.color?.r ?? 1, source.color?.g ?? 1, source.color?.b ?? 1));
  const tintOpacity = uni(source.opacity ?? 1);
  const baseUv = tiledUv(uv(), uvTile, tiles);
  let sampled = vec42(1, 1, 1, 1);
  if (source.map) {
    const current = texture2(source.map, baseUv);
    if (settings.blendTiles) {
      const nextUv = tiledUv(uv(), floor(uvTile).add(1), tiles);
      sampled = mix3(current, texture2(source.map, nextUv), fract(uvTile));
    } else {
      sampled = current;
    }
  }
  material.colorNode = sampled.rgb.mul(particleColor.rgb).mul(tint);
  material.opacityNode = sampled.a.mul(particleColor.a).mul(tintOpacity);
  material.vertexNode = spriteClip(settings.renderMode);
  material.alphaTest = source.alphaTest;
  return material;
}
function createTrailMaterial(source) {
  const material = new MeshBasicNodeMaterial2();
  copySurface(material, source);
  const particleColor = attr(PARTICLE_ATTR.color, "vec4");
  const map = source.map;
  const sampled = map ? texture2(map, uv()) : vec42(1, 1, 1, 1);
  const color2 = source.color;
  const tint = uni(new Color3(color2?.r ?? 1, color2?.g ?? 1, color2?.b ?? 1));
  material.colorNode = sampled.rgb.mul(particleColor.rgb).mul(tint);
  material.opacityNode = sampled.a.mul(particleColor.a);
  material.vertexNode = trailClip();
  material.side = 2;
  return material;
}
function copySurface(material, source) {
  material.transparent = source.transparent;
  material.opacity = source.opacity;
  material.depthWrite = source.depthWrite;
  material.depthTest = source.depthTest;
  material.blending = source.blending;
  material.blendSrc = source.blendSrc;
  material.blendDst = source.blendDst;
  material.blendEquation = source.blendEquation;
  material.premultipliedAlpha = source.premultipliedAlpha;
  material.side = source.side;
  material.toneMapped = true;
  material.vertexColors = false;
}
function tiledUv(base, tileIndex, tiles) {
  const index = floor(tileIndex);
  const col = mod(index, tiles.x);
  const row = tiles.y.sub(floor(index.div(tiles.x))).sub(1);
  return base.div(tiles).add(vec22(col.div(tiles.x), row.div(tiles.y)));
}
function attr(name, type) {
  return attribute(name, type);
}
function uni(value) {
  return uniform2(value);
}
function spriteClip(mode) {
  const offset = attr(PARTICLE_ATTR.offset, "vec3");
  const size = attr(PARTICLE_ATTR.size, "vec3");
  const world3 = modelWorldMatrix2.mul(vec42(offset, 1));
  if (mode === RenderMode.Mesh) return meshClip(offset, size);
  if (mode === RenderMode.Trail) return trailClip();
  const rotation = attr(PARTICLE_ATTR.rotation, "float");
  const aligned = vec22(positionGeometry2.x.mul(size.x), positionGeometry2.y.mul(size.y));
  const c = rotation.cos();
  const s = rotation.sin();
  const rotated = vec22(c.mul(aligned.x).sub(s.mul(aligned.y)), s.mul(aligned.x).add(c.mul(aligned.y)));
  if (mode === RenderMode.HorizontalBillBoard) {
    const shifted = vec42(world3.x.add(rotated.x), world3.y, world3.z.sub(rotated.y), world3.w);
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(shifted));
  }
  if (mode === RenderMode.VerticalBillBoard) {
    const raised = vec42(world3.x, world3.y.add(rotated.y), world3.z, world3.w);
    const view2 = cameraViewMatrix.mul(raised);
    return cameraProjectionMatrix.mul(vec42(view2.x.add(rotated.x), view2.y, view2.z, view2.w));
  }
  if (mode === RenderMode.StretchedBillBoard) return stretchedClip(world3, size);
  const view = cameraViewMatrix.mul(world3);
  return cameraProjectionMatrix.mul(vec42(view.x.add(rotated.x), view.y.add(rotated.y), view.z, view.w));
}
function stretchedClip(world3, size) {
  const velocity = attr(PARTICLE_ATTR.velocity, "vec4");
  const view = cameraViewMatrix.mul(world3);
  const viewVelocity = cameraViewMatrix.mul(vec42(velocity.x, velocity.y, velocity.z, 0)).xyz;
  const vlength = max2(length2(viewVelocity), float2(1e-4));
  const avg = size.x.add(size.y).mul(0.5);
  const side = normalize2(cross(view.xyz, viewVelocity));
  const stretched = view.xyz.add(side.mul(positionGeometry2.y).mul(avg)).sub(viewVelocity.mul(positionGeometry2.x.add(0.5)).mul(float2(1).add(velocity.w.div(vlength))).mul(avg));
  return cameraProjectionMatrix.mul(vec42(stretched, view.w));
}
function meshClip(offset, size) {
  const rotation = attr(PARTICLE_ATTR.rotation, "vec4");
  const scaled = vec32(positionGeometry2.x.mul(size.x), positionGeometry2.y.mul(size.y), positionGeometry2.z.mul(size.z));
  const spun = rotateByQuat(rotation, scaled);
  const local = vec42(spun.x.add(offset.x), spun.y.add(offset.y), spun.z.add(offset.z), 1);
  return cameraProjectionMatrix.mul(cameraViewMatrix.mul(modelWorldMatrix2.mul(local)));
}
function trailClip() {
  const previous = attr(PARTICLE_ATTR.previous, "vec3");
  const next = attr(PARTICLE_ATTR.next, "vec3");
  const side = attr(PARTICLE_ATTR.side, "float");
  const width = attr(PARTICLE_ATTR.width, "float");
  const world3 = modelWorldMatrix2.mul(vec42(positionGeometry2, 1)).xyz;
  const worldPrev = modelWorldMatrix2.mul(vec42(previous, 1)).xyz;
  const worldNext = modelWorldMatrix2.mul(vec42(next, 1)).xyz;
  const tangent = normalize2(worldNext.sub(worldPrev).add(vec32(0, 1e-4, 0)));
  const toCamera = normalize2(cameraPosition2.sub(world3));
  const binormal = normalize2(cross(tangent, toCamera));
  const placed = world3.add(binormal.mul(side).mul(width));
  return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec42(placed, 1)));
}
function rotateByQuat(q, v) {
  const t = cross(q.xyz, v).mul(2);
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}
function surfaceBlending(blend) {
  if (blend === "alpha") return { blending: NormalBlending, premultipliedAlpha: false };
  if (blend === "multiply") return { blending: MultiplyBlending, premultipliedAlpha: false };
  if (blend === "premultiply") {
    return {
      blending: CustomBlending,
      premultipliedAlpha: true,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor
    };
  }
  return { blending: AdditiveBlending, premultipliedAlpha: false };
}
var PARTICLE_ATTR, TslSpriteBatch, TslTrailBatch, TslBatchedRenderer;
var init_tslBatch = __esm({
  "src/capabilities/particles/tslBatch.ts"() {
    "use strict";
    PARTICLE_ATTR = {
      offset: "offset",
      rotation: "rotation",
      size: "size",
      color: "color",
      uvTile: "uvTile",
      velocity: "velocity",
      previous: "previous",
      next: "next",
      side: "side",
      width: "width"
    };
    TslSpriteBatch = class extends SpriteBatch {
      rebuildMaterial() {
        this.layers.mask = this.settings.layers.mask;
        this.frustumCulled = false;
        this.renderOrder = this.settings.renderOrder;
        this.material = createSpriteMaterial(this.settings);
      }
      applyDepthTexture() {
      }
    };
    TslTrailBatch = class extends TrailBatch {
      rebuildMaterial() {
        this.layers.mask = this.settings.layers.mask;
        this.frustumCulled = false;
        this.renderOrder = this.settings.renderOrder;
        this.material = createTrailMaterial(this.settings.material);
      }
      applyDepthTexture() {
      }
    };
    TslBatchedRenderer = class extends BatchedRenderer {
      addSystem(system) {
        const particle = system;
        particle._renderer = this;
        const settings = particle.getRendererSettings();
        for (let i = 0; i < this.batches.length; i += 1) {
          if (sameBatch(this.batches[i].settings, settings)) {
            this.batches[i].addSystem(system);
            this.systemToBatchIndex.set(system, i);
            return;
          }
        }
        const batch = settings.renderMode === RenderMode.Trail ? new TslTrailBatch(settings) : new TslSpriteBatch(settings);
        batch.addSystem(system);
        this.batches.push(batch);
        this.systemToBatchIndex.set(system, this.batches.length - 1);
        this.add(batch);
      }
    };
  }
});

// src/capabilities/particles/quarksRuntime.ts
var quarksRuntime_exports = {};
__export(quarksRuntime_exports, {
  createQuarksRuntime: () => createQuarksRuntime,
  simulationOf: () => simulationOf
});
import {
  DoubleSide as DoubleSide2,
  MeshBasicMaterial
} from "three";
import {
  ParticleSystem,
  QuarksLoader,
  QuarksUtil
} from "three.quarks";
function createQuarksRuntime(scene2) {
  const batch = new TslBatchedRenderer();
  batch.name = "particles";
  scene2.add(batch);
  const lives = /* @__PURE__ */ new Map();
  const issues = /* @__PURE__ */ new Map();
  return {
    sync(instances) {
      const seen = /* @__PURE__ */ new Set();
      for (const instance2 of instances) {
        seen.add(instance2.id);
        const key = instanceKey(instance2);
        let live = lives.get(instance2.id);
        if (!live || live.key !== key) {
          detach(live);
          const spawned = spawn(instance2, batch, issues);
          if (!spawned) {
            lives.delete(instance2.id);
            continue;
          }
          live = spawned;
          lives.set(instance2.id, live);
        } else {
          issues.delete(instance2.id);
        }
        if (live.root.parent !== instance2.parent) instance2.parent.add(live.root);
        instance2.parent.updateWorldMatrix(true, false);
        setEmitterVisible(live.root, instance2.visible);
        if (!rendererOf(live)) {
          detach(live);
          lives.delete(instance2.id);
          const spawned = spawn(instance2, batch, issues);
          if (!spawned) continue;
          live = spawned;
          lives.set(instance2.id, live);
          if (live.root.parent !== instance2.parent) instance2.parent.add(live.root);
          instance2.parent.updateWorldMatrix(true, false);
          setEmitterVisible(live.root, instance2.visible);
        }
        if (live.playing !== instance2.playing) {
          if (instance2.playing) QuarksUtil.play(live.root);
          else QuarksUtil.pause(live.root);
          live.playing = instance2.playing;
        }
      }
      for (const [id, live] of lives) {
        if (seen.has(id)) continue;
        detach(live);
        lives.delete(id);
        issues.delete(id);
      }
    },
    update(dt) {
      batch.update(dt);
    },
    dispose() {
      for (const live of lives.values()) detach(live);
      lives.clear();
      issues.clear();
      batch.removeFromParent();
    },
    issue(id) {
      return issues.get(id) ?? null;
    }
  };
}
function spawn(instance2, batch, issues) {
  try {
    const root = instance2.simulation.format === "loader" ? spawnLoader(instance2, batch) : spawnSystem(instance2, batch);
    if (!instance2.playing) QuarksUtil.pause(root);
    issues.delete(instance2.id);
    return { id: instance2.id, root, key: instanceKey(instance2), playing: instance2.playing };
  } catch (error) {
    issues.set(instance2.id, error instanceof Error ? error.message : String(error));
    return null;
  }
}
function spawnSystem(instance2, batch) {
  const body = systemBodyForPlayback(instance2.simulation.body);
  const system = ParticleSystem.fromJSON(body, { geometries: {}, materials: {}, textures: {}, images: {} }, {});
  system.material = makeMaterial(instance2.material);
  system.emitter.position.set(0, 0, 0);
  batch.addSystem(system);
  return system.emitter;
}
function spawnLoader(instance2, batch) {
  const root = new QuarksLoader().parse(instance2.simulation.body);
  QuarksUtil.runOnAllParticleEmitters(root, (emitter) => {
    const system = emitter.system;
    if (instance2.material) system.material = makeMaterial(instance2.material);
    batch.addSystem(system);
  });
  return root;
}
function makeMaterial(desc) {
  const appearance = desc ?? {
    color: "#ffffff",
    opacity: 1,
    map: null,
    blend: "additive",
    depthWrite: false,
    depthTest: true,
    side: DoubleSide2
  };
  const blend = surfaceBlending(appearance.blend);
  const material = new MeshBasicMaterial({
    color: appearance.color,
    map: appearance.map,
    transparent: true,
    opacity: appearance.opacity,
    depthWrite: appearance.depthWrite,
    depthTest: appearance.depthTest,
    side: appearance.side,
    blending: blend.blending,
    premultipliedAlpha: blend.premultipliedAlpha
  });
  if (blend.blendSrc) material.blendSrc = blend.blendSrc;
  if (blend.blendDst) material.blendDst = blend.blendDst;
  return material;
}
function rendererOf(live) {
  let attached = false;
  QuarksUtil.runOnAllParticleEmitters(live.root, (emitter) => {
    if (emitter.system._renderer) attached = true;
  });
  return attached;
}
function detach(live) {
  if (!live) return;
  QuarksUtil.runOnAllParticleEmitters(live.root, (emitter) => {
    const system = emitter.system;
    system._renderer?.deleteSystem(system);
    system.dispose();
  });
  live.root.removeFromParent();
}
function setEmitterVisible(root, visible) {
  root.visible = visible;
  QuarksUtil.runOnAllParticleEmitters(root, (emitter) => {
    emitter.visible = visible;
  });
}
function instanceKey(instance2) {
  const material = instance2.material;
  return JSON.stringify({
    simulation: instance2.simulation,
    playingShape: material && {
      color: material.color,
      opacity: material.opacity,
      blend: material.blend,
      depthWrite: material.depthWrite,
      depthTest: material.depthTest,
      side: material.side,
      map: material.map?.uuid ?? ""
    }
  });
}
function simulationOf(value) {
  if (!value || typeof value !== "object") return null;
  const record = value;
  if ((record.format === "system" || record.format === "loader") && record.body && typeof record.body === "object") {
    return { format: record.format, body: record.body };
  }
  return null;
}
var init_quarksRuntime = __esm({
  "src/capabilities/particles/quarksRuntime.ts"() {
    "use strict";
    init_simulationForm();
    init_tslBatch();
  }
});

// src/capabilities/particles/session.ts
function tickParticles(dt, parentOf) {
  const runtimeWorld = getRuntimeWorld();
  if (!capabilityEnabled(runtimeWorld.getCapabilities(), "particles") || !scene) {
    disposeParticles();
    return;
  }
  if (!runtime) {
    ensureRuntime();
    return;
  }
  const instances = [];
  for (const node of Object.values(runtimeWorld.getNodes())) {
    if (node.kind !== "effect" || !node.effect) continue;
    const parent = parentOf(node.id);
    if (!parent || !rootedInScene(parent)) continue;
    const resolved = resolveInstance(node.id, node.effect, node.visible, parent);
    if (resolved) instances.push(resolved);
  }
  runtime.sync(instances);
  runtime.update(dt);
}
function disposeParticles() {
  generation += 1;
  runtime?.dispose();
  runtime = null;
  loading = null;
}
function ensureRuntime() {
  if (loading || !scene) return;
  const token = generation;
  const root = scene;
  loading = Promise.resolve().then(() => (init_quarksRuntime(), quarksRuntime_exports)).then((module) => {
    if (token !== generation) return;
    runtime = module.createQuarksRuntime(root);
  }).catch((error) => {
    console.warn("[particles] three.quarks \u52A0\u8F7D\u5931\u8D25", error);
  }).finally(() => {
    if (token === generation) loading = null;
  });
}
function rootedInScene(object) {
  let current = object;
  while (current.parent) current = current.parent;
  return current.type === "Scene";
}
function resolveInstance(id, effect, visible, parent) {
  const runtimeWorld = getRuntimeWorld();
  let simulation = effect.simulation;
  let materialId = effect.materialAssetId;
  if (effect.assetId) {
    const asset = runtimeWorld.getAsset(effect.assetId);
    if (!asset || asset.kind !== "effect") return null;
    simulation = asset.simulation;
    materialId = effect.materialAssetId ?? asset.materialAssetId ?? null;
  }
  const stored = asSimulation(simulation);
  if (!stored) return null;
  const material = runtimeWorld.resolveParticleDesc?.(materialId) ?? null;
  if (material === "incompatible") return null;
  return {
    id,
    parent,
    simulation: stored,
    material,
    playing: effect.playing !== false,
    visible
  };
}
var runtime, loading, scene, generation;
var init_session5 = __esm({
  "src/capabilities/particles/session.ts"() {
    "use strict";
    init_registry2();
    init_world();
    init_readQuarks();
    runtime = null;
    loading = null;
    scene = null;
    generation = 0;
  }
});

// src/gameplay/juiceClock.ts
function scalePlayDt(dt, now = performance.now() / 1e3) {
  if (now < holdUntil) return 0;
  return dt;
}
function juiceShake(now = performance.now() / 1e3) {
  if (now >= shakeUntil || shakeAmp <= 0) return { x: 0, y: 0 };
  return { x: (Math.random() - 0.5) * shakeAmp, y: (Math.random() - 0.5) * shakeAmp };
}
var holdUntil, shakeAmp, shakeUntil;
var init_juiceClock = __esm({
  "src/gameplay/juiceClock.ts"() {
    "use strict";
    holdUntil = 0;
    shakeAmp = 0;
    shakeUntil = 0;
  }
});

// src/runtime/frameProfile.ts
function measureCost(id, run) {
  const start2 = performance.now();
  try {
    run();
  } finally {
    const ms = performance.now() - start2;
    buckets.set(id, (buckets.get(id) ?? 0) + ms);
    if (capture) capture.set(id, (capture.get(id) ?? 0) + ms);
  }
}
var buckets, capture;
var init_frameProfile = __esm({
  "src/runtime/frameProfile.ts"() {
    "use strict";
    buckets = /* @__PURE__ */ new Map();
    capture = null;
  }
});

// src/runtime/sceneRuntime.ts
function defaultCharacter() {
  return {
    enabled: true,
    driver: "capsule",
    mode: "adventure",
    clickButton: "right",
    clickStop: 0.35,
    moveSpeed: 4.5,
    turnSpeed: 540,
    sprintMultiplier: 1.6,
    jumpSpeed: 6.5,
    maxJumps: 2,
    coyoteTime: 0.12,
    jumpBuffer: 0.12,
    gravity: 18,
    radius: 0.35,
    height: 1.7,
    capsuleOffset: [0, 0, 0],
    physicsInteract: false,
    mass: 65,
    pushStrength: 1,
    swim: true,
    swimSpeedMultiplier: 0.65,
    swimHeightOffset: 0,
    dash: true,
    dashKey: "KeyC",
    dashDistance: 4,
    dashDuration: 0.22,
    dashInvincible: 0.35,
    dashCooldown: 0.8,
    footstepDistance: 1.6,
    footstepJuice: "",
    lockTargetId: "",
    lockTargetName: "",
    idleClip: "",
    idleClipAssetId: "",
    walkClip: "",
    walkClipAssetId: "",
    runClip: "",
    runClipAssetId: "",
    jumpClip: "",
    jumpClipAssetId: "",
    airClip: "",
    airClipAssetId: "",
    landClip: "",
    landClipAssetId: "",
    dodgeClip: "",
    dodgeClipAssetId: "",
    swimIdleClip: "",
    swimIdleClipAssetId: "",
    swimClip: "",
    swimClipAssetId: ""
  };
}
function defaultCameraFollow() {
  return {
    enabled: true,
    targetId: "",
    targetName: "",
    offset: [0, 1.8, -4.2],
    pivot: [0, 1.4, 0],
    orbit: "rightDrag",
    sensitivity: 0.25,
    minPitch: -35,
    maxPitch: 70,
    collision: true,
    collisionRadius: 0.2,
    localOffset: false,
    damping: 8,
    lookAtTarget: true,
    fov: 60,
    zoom: true,
    zoomSpeed: 0.18,
    minDistance: 0.8,
    maxDistance: 18
  };
}
function cameraPresetForMode(mode) {
  if (mode === "strafe") return { offset: [0.65, 0.45, -2.2], pivot: [0, 1.5, 0], orbit: "mouse", localOffset: false, lookAtTarget: true, fov: 55, collision: true };
  if (mode === "lockOn") return { offset: [0.35, 2.2, -4.8], pivot: [0, 1.35, 0], orbit: "rightDrag", localOffset: false, lookAtTarget: true, fov: 58, collision: true };
  if (mode === "pointAndClick") return { offset: [0, 10.5, -7.2], pivot: [0, 0.8, 0], orbit: "none", localOffset: false, lookAtTarget: true, fov: 48, collision: false };
  if (mode === "topDown") return { offset: [0, 9.5, -6.5], pivot: [0, 0.8, 0], orbit: "none", localOffset: false, lookAtTarget: true, fov: 50, collision: false };
  if (mode === "side25d") return { offset: [0, 1.6, -7.5], pivot: [0, 1.2, 0], orbit: "none", localOffset: false, lookAtTarget: true, fov: 45, collision: false };
  if (mode === "firstPerson") return { offset: [0, 0, 0.12], pivot: [0, 1.65, 0], orbit: "mouse", localOffset: false, lookAtTarget: false, fov: 72, collision: false, zoom: false, damping: 0, minPitch: -85, maxPitch: 85 };
  return { offset: [0, 1.8, -4.2], pivot: [0, 1.4, 0], orbit: "rightDrag", localOffset: false, lookAtTarget: true, fov: 60, collision: true };
}
function resolveCharacterCamera(character, raw) {
  const mode = character.mode;
  const preset = cameraPresetForMode(mode);
  const base = { ...defaultCameraFollow(), ...preset, ...raw, preset: mode };
  base.targetId = "";
  base.targetName = "";
  base.lookAtTarget = true;
  if (mode === "pointAndClick" || mode === "topDown" || mode === "side25d") {
    base.orbit = "none";
    base.localOffset = false;
    base.collision = false;
    return base;
  }
  if (mode === "firstPerson") {
    base.orbit = "mouse";
    base.localOffset = false;
    base.collision = false;
    base.zoom = false;
    base.lookAtTarget = false;
    base.damping = 0;
    if (base.minPitch === -35 && base.maxPitch === 70) {
      base.minPitch = -85;
      base.maxPitch = 85;
    }
    if (base.offset[1] > 0.4 && Math.abs(base.offset[1] - base.pivot[1]) < 0.05) {
      base.offset = [base.offset[0], 0, base.offset[2]];
    }
    return base;
  }
  if (mode === "strafe") {
    base.orbit = "mouse";
    base.localOffset = false;
    return base;
  }
  base.localOffset = false;
  if (base.orbit === "none") base.orbit = "rightDrag";
  if (character.driver !== "capsule" && character.clickButton === "right" && base.orbit === "rightDrag") {
    base.orbit = "mouse";
  }
  return base;
}
function defaultInteract() {
  return {
    enabled: true,
    prompt: "\u6309 E \u4EA4\u4E92",
    key: "KeyE",
    radius: 2.5,
    filterTagId: "",
    message: "onInteract",
    once: false
  };
}
function defaultTrigger() {
  return {
    enabled: true,
    radius: 3,
    filterTagId: "",
    enterMessage: "onZoneEnter",
    exitMessage: "onZoneExit",
    once: false
  };
}
function defaultMover() {
  return {
    enabled: true,
    offset: [0, 3, 0],
    duration: 2.5,
    pause: 0.6,
    pingPong: true,
    autoPlay: true,
    startMessage: "onActivateMover",
    carryRadius: 1.6
  };
}
function defaultCheckpoint() {
  return {
    enabled: true,
    spawn: false,
    radius: 2.5,
    delay: 1.2,
    abyssY: -12,
    message: "onPlayerRespawned"
  };
}
function defaultSoundSource() {
  return {
    enabled: true,
    assetId: "",
    loop: true,
    volume: 1,
    refDistance: 3,
    rolloff: 1
  };
}
function defaultScore() {
  return {
    enabled: true,
    title: "\u5230\u8FBE\u76EE\u6807",
    target: 100,
    perInteract: 50,
    timeLimit: 0,
    victoryMessage: "onStageVictory",
    defeatMessage: "onStageDefeat"
  };
}
function registerRuntimeSystem(id, order, step2) {
  const target = order >= RUNTIME_STAGE.POST_ANIMATION ? postAnimationSystems : order >= RUNTIME_STAGE.PHYSICS_NAV ? postPhysicsSystems : systems;
  const index = target.findIndex((item) => item.id === id);
  if (index >= 0) target.splice(index, 1);
  target.push({ id, order, step: step2 });
  target.sort((a, b) => a.order - b.order);
  return () => {
    const idx = target.findIndex((item) => item.id === id);
    if (idx >= 0) target.splice(idx, 1);
  };
}
function stepSceneRuntime(dt, host) {
  const scaled = scalePlayDt(dt);
  for (const system of systems) {
    measureCost(system.id, () => system.step(scaled, host));
  }
  measureCost("physics", () => tickPhysics(scaled, host.resolveObject));
  measureCost("navigation", () => tickNavigation());
  for (const system of postPhysicsSystems) {
    measureCost(system.id, () => system.step(scaled, host));
  }
  if (host.ready) {
    measureCost("animation", () => host.updateAnimations(scaled));
    for (const system of postAnimationSystems) {
      measureCost(system.id, () => system.step(scaled, host));
    }
    measureCost("particles", () => tickParticles(scaled, host.resolveObject));
  }
  consumeInputFrame();
}
var RUNTIME_STAGE, systems, postPhysicsSystems, postAnimationSystems;
var init_sceneRuntime = __esm({
  "src/runtime/sceneRuntime.ts"() {
    "use strict";
    init_session();
    init_session4();
    init_session5();
    init_juiceClock();
    init_actionMap();
    init_frameProfile();
    RUNTIME_STAGE = {
      PRE_PHYSICS: 10,
      PHYSICS_NAV: 50,
      POST_PHYSICS: 55,
      ANIMATION: 60,
      POST_ANIMATION: 70,
      PRE_RENDER: 80
    };
    systems = [];
    postPhysicsSystems = [];
    postAnimationSystems = [];
  }
});

// src/core/schema/fieldSchema.ts
function safeVecDefault(type, rawDefault) {
  const len = type === "vec2" ? 2 : type === "vec3" ? 3 : 4;
  if (Array.isArray(rawDefault)) {
    return Array.from({ length: len }, (_, i) => {
      const v = rawDefault[i];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    });
  }
  if (rawDefault && typeof rawDefault === "object") {
    const obj = rawDefault;
    const keys = ["x", "y", "z", "w"];
    return Array.from({ length: len }, (_, i) => {
      const v = obj[keys[i]];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    });
  }
  return Array.from({ length: len }, () => 0);
}
function defaultForSchema(schema) {
  switch (schema.type) {
    case "number":
    case "boolean":
    case "string":
    case "color":
    case "enum":
      return schema.default;
    case "vec2":
    case "vec3":
    case "vec4":
      return safeVecDefault(schema.type, schema.default);
    case "texture":
    case "ref":
      return schema.default ?? null;
    case "list":
      return schema.default ? structuredClone(schema.default) : [];
    case "object": {
      const out = {};
      for (const [key, child] of Object.entries(schema.fields)) {
        out[key] = defaultForSchema(child);
      }
      return out;
    }
  }
}
function normalizeBySchema(schema, raw, options) {
  const clampNumbers = options?.clampNumbers ?? true;
  switch (schema.type) {
    case "number": {
      const num = typeof raw === "number" && Number.isFinite(raw) ? raw : schema.default;
      if (!clampNumbers) return num;
      let next = num;
      if (schema.min !== void 0) next = Math.max(schema.min, next);
      if (schema.max !== void 0) next = Math.min(schema.max, next);
      return next;
    }
    case "boolean":
      return typeof raw === "boolean" ? raw : schema.default;
    case "string":
      return typeof raw === "string" ? raw : schema.default;
    case "color":
      return typeof raw === "string" && /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : schema.default;
    case "vec2":
    case "vec3":
    case "vec4": {
      const len = schema.type === "vec2" ? 2 : schema.type === "vec3" ? 3 : 4;
      const fallback = safeVecDefault(schema.type, schema.default);
      if (!Array.isArray(raw)) return fallback;
      const out = [];
      for (let i = 0; i < len; i += 1) {
        const v = raw[i];
        out.push(typeof v === "number" && Number.isFinite(v) ? v : fallback[i]);
      }
      return out;
    }
    case "enum": {
      if (typeof raw === "string" && schema.options.some((opt) => opt.value === raw)) {
        return raw;
      }
      return schema.default;
    }
    case "texture":
    case "ref":
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    case "list": {
      if (!Array.isArray(raw)) return defaultForSchema(schema);
      return raw.map((entry) => normalizeBySchema(schema.item, entry, options));
    }
    case "object": {
      const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const out = {};
      for (const [key, child] of Object.entries(schema.fields)) {
        out[key] = normalizeBySchema(child, src[key], options);
      }
      return out;
    }
  }
}
var init_fieldSchema = __esm({
  "src/core/schema/fieldSchema.ts"() {
    "use strict";
  }
});

// src/capabilities/spline/schema.ts
function defaultSplinePath() {
  return {
    points: [
      [0, 0, 0],
      [3, 0, 2],
      [6, 0, -2],
      [9, 0, 0]
    ],
    closed: false,
    tension: 0.5,
    color: "#34d399"
  };
}
function normalizeSplinePath(raw) {
  const def = defaultSplinePath();
  if (!raw || typeof raw !== "object") return def;
  const obj = raw;
  const pts = Array.isArray(obj.points) ? obj.points.filter((p) => Array.isArray(p) && p.length >= 3).map((p) => [
    Number.isFinite(Number(p[0])) ? Number(p[0]) : 0,
    Number.isFinite(Number(p[1])) ? Number(p[1]) : 0,
    Number.isFinite(Number(p[2])) ? Number(p[2]) : 0
  ]) : def.points;
  return {
    points: pts.length >= 2 ? pts : def.points,
    closed: typeof obj.closed === "boolean" ? obj.closed : def.closed,
    tension: typeof obj.tension === "number" && Number.isFinite(obj.tension) ? Math.max(0, Math.min(1, obj.tension)) : def.tension,
    color: typeof obj.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(obj.color) ? obj.color : def.color
  };
}
function normalizeSpline(raw) {
  return normalizeBySchema(SPLINE_SCHEMA, raw);
}
var SPLINE_CAPABILITY_ID, SPLINE_PATH_CAPABILITY_ID, SPLINE_SCHEMA;
var init_schema = __esm({
  "src/capabilities/spline/schema.ts"() {
    "use strict";
    init_fieldSchema();
    SPLINE_CAPABILITY_ID = "spline";
    SPLINE_PATH_CAPABILITY_ID = "splinePath";
    SPLINE_SCHEMA = {
      type: "object",
      label: "Spline \u8DEF\u5F84\u8FD0\u52A8",
      fields: {
        enabled: { type: "boolean", default: true, label: "\u542F\u7528" },
        pathNodeId: { type: "ref", target: "node", kinds: ["spline"], default: null, label: "Spline \u66F2\u7EBF\u8282\u70B9" },
        mode: {
          type: "enum",
          default: "loop",
          label: "\u8FD0\u884C\u6A21\u5F0F",
          options: [
            { value: "once", label: "\u5355\u6B21\u5230\u8FBE" },
            { value: "loop", label: "\u5FAA\u73AF" },
            { value: "pingPong", label: "\u5F80\u8FD4" }
          ]
        },
        speed: { type: "number", default: 4, min: 0.05, max: 200, step: 0.5, label: "\u79FB\u52A8\u901F\u5EA6 (m/s)" },
        tension: { type: "number", default: 0.5, min: 0, max: 1, step: 0.05, label: "\u66F2\u7EBF\u5F20\u529B" },
        closed: { type: "boolean", default: false, label: "\u95ED\u5408\u66F2\u7EBF" },
        faceDirection: { type: "boolean", default: true, label: "\u671D\u5411\u8DEF\u5F84\u5207\u7EBF" },
        planeXZ: { type: "boolean", default: false, label: "\u4FDD\u6301\u5F53\u524D\u9AD8\u5EA6 (XZ)" },
        autoStart: { type: "boolean", default: true, label: "\u8BD5\u73A9\u81EA\u52A8\u542F\u52A8" },
        startProgress: { type: "number", default: 0, min: 0, max: 1, step: 0.05, label: "\u8D77\u59CB\u8FDB\u5EA6 (0~1)" }
      }
    };
  }
});

// src/capabilities/spline/session.ts
var session_exports3 = {};
__export(session_exports3, {
  default: () => session_default3,
  dispose: () => dispose3,
  mount: () => mount3
});
import { Vector3 as Vector37 } from "three";
function specOf3(raw) {
  if (!raw || typeof raw !== "object") return normalizeSpline(raw);
  const cached = specCache3.get(raw);
  if (cached) return cached;
  const next = normalizeSpline(raw);
  specCache3.set(raw, next);
  return next;
}
function collectWaypoints(nodes, host, ownerNode, spec) {
  const pathParentId = spec.pathNodeId || ownerNode.id;
  const pathNode = nodes[pathParentId];
  const rawSplinePath = pathNode?.capabilities?.[SPLINE_PATH_CAPABILITY_ID];
  if (pathNode && (pathNode.kind === "spline" || rawSplinePath)) {
    const pathData = normalizeSplinePath(rawSplinePath);
    const pathObj = host.resolveObject(pathNode.id);
    if (pathObj) pathObj.updateMatrixWorld();
    const tmp = new Vector37();
    const points2 = [];
    const closed2 = spec.closed || pathData.closed || spec.mode === "loop";
    const tension = Number.isFinite(pathData.tension) ? pathData.tension : spec.tension;
    const keyParts2 = [pathNode.id, closed2 ? "1" : "0", String(tension)];
    for (let i = 0; i < pathData.points.length; i += 1) {
      const pt = pathData.points[i];
      if (pathObj) {
        tmp.set(pt[0], pt[1], pt[2]).applyMatrix4(pathObj.matrixWorld);
      } else {
        tmp.set(pathNode.position[0] + pt[0], pathNode.position[1] + pt[1], pathNode.position[2] + pt[2]);
      }
      points2.push({ x: tmp.x, y: tmp.y, z: tmp.z });
      keyParts2.push(`${i}:${tmp.x.toFixed(2)},${tmp.y.toFixed(2)},${tmp.z.toFixed(2)}`);
    }
    return { key: keyParts2.join("|"), points: points2, closed: closed2, tension };
  }
  const children = Object.values(nodes).filter((n) => n.parentId === pathParentId && n.id !== ownerNode.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const points = [];
  const closed = spec.closed || spec.mode === "loop";
  const keyParts = [pathParentId, closed ? "1" : "0", String(spec.tension)];
  for (const child of children) {
    const obj = host.resolveObject(child.id);
    const p = obj ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : { x: child.position[0], y: child.position[1], z: child.position[2] };
    points.push(p);
    keyParts.push(`${child.id}:${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
  }
  return { key: keyParts.join("|"), points, closed, tension: spec.tension };
}
function stepSplineCapability(dt, host) {
  const runtime2 = getRuntimeWorld();
  if (runtime2.getPlayState() !== "playing") {
    if (agents.size > 0) agents.clear();
    return;
  }
  const nodes = runtime2.getNodes();
  const activeIds = /* @__PURE__ */ new Set();
  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[SPLINE_CAPABILITY_ID];
    if (!raw) continue;
    const spec = specOf3(raw);
    if (!spec.enabled || !spec.autoStart) continue;
    const obj = host.resolveObject(node.id);
    if (!obj) continue;
    activeIds.add(node.id);
    const { key, points, closed, tension } = collectWaypoints(nodes, host, node, spec);
    if (points.length < 2) continue;
    let agent = agents.get(node.id);
    if (!agent || agent.pathKey !== key) {
      const spline = createSplinePath(points, {
        closed,
        tension
      });
      const startDist = Math.max(0, Math.min(1, spec.startProgress)) * spline.length;
      agent = {
        pathKey: key,
        spline,
        distance: startDist,
        direction: 1,
        finished: false
      };
      agents.set(node.id, agent);
      const startPt = spline.pointAtDistance(startDist);
      obj.position.set(startPt.x, spec.planeXZ ? obj.position.y : startPt.y, startPt.z);
    }
    if (agent.finished || dt <= 0 || agent.spline.length <= 1e-6) continue;
    const totalLen = agent.spline.length;
    let nextDist = agent.distance + spec.speed * dt * agent.direction;
    if (spec.mode === "loop") {
      nextDist = (nextDist % totalLen + totalLen) % totalLen;
    } else if (spec.mode === "pingPong") {
      if (nextDist >= totalLen) {
        nextDist = totalLen - (nextDist - totalLen);
        agent.direction = -1;
      } else if (nextDist <= 0) {
        nextDist = -nextDist;
        agent.direction = 1;
      }
    } else {
      if (nextDist >= totalLen) {
        nextDist = totalLen;
        agent.finished = true;
      } else if (nextDist <= 0) {
        nextDist = 0;
        agent.finished = true;
      }
    }
    agent.distance = nextDist;
    const pt = agent.spline.pointAtDistance(nextDist);
    obj.position.set(pt.x, spec.planeXZ ? obj.position.y : pt.y, pt.z);
    if (spec.faceDirection) {
      const tan2 = agent.spline.tangentAtDistance(nextDist);
      const tx = tan2.x * agent.direction;
      const tz = tan2.z * agent.direction;
      if (Math.abs(tx) > 1e-5 || Math.abs(tz) > 1e-5) {
        obj.rotation.y = Math.atan2(tx, tz);
      }
    }
  }
  for (const id of agents.keys()) {
    if (!activeIds.has(id)) agents.delete(id);
  }
}
function mount3() {
  if (!unregister2) {
    unregister2 = registerRuntimeSystem(
      "capability.spline",
      RUNTIME_STAGE.PRE_PHYSICS + 2,
      stepSplineCapability
    );
  }
  return dispose3;
}
function dispose3() {
  unregister2?.();
  unregister2 = null;
  agents.clear();
}
var unregister2, agents, specCache3, splineRuntimeModule, session_default3;
var init_session6 = __esm({
  "src/capabilities/spline/session.ts"() {
    "use strict";
    init_motion();
    init_sceneRuntime();
    init_world();
    init_schema();
    unregister2 = null;
    agents = /* @__PURE__ */ new Map();
    specCache3 = /* @__PURE__ */ new WeakMap();
    splineRuntimeModule = { mount: mount3, dispose: dispose3 };
    session_default3 = splineRuntimeModule;
  }
});

// src/capabilities/tween/schema.ts
function normalizeTween(raw) {
  return normalizeBySchema(TWEEN_SCHEMA, raw);
}
var TWEEN_CAPABILITY_ID, TWEEN_SCHEMA;
var init_schema2 = __esm({
  "src/capabilities/tween/schema.ts"() {
    "use strict";
    init_fieldSchema();
    TWEEN_CAPABILITY_ID = "tween";
    TWEEN_SCHEMA = {
      type: "object",
      label: "Tween \u8865\u95F4\u52A8\u6548",
      fields: {
        enabled: { type: "boolean", default: true, label: "\u542F\u7528" },
        property: {
          type: "enum",
          default: "floatBob",
          label: "\u52A8\u6548\u7C7B\u578B",
          options: [
            { value: "floatBob", label: "\u60AC\u6D6E\u6D6E\u52A8 (PingPong)" },
            { value: "positionOffset", label: "\u4F4D\u7F6E\u504F\u79FB" },
            { value: "rotationOffset", label: "\u65CB\u8F6C\u89D2\u5EA6 (\u5EA6)" },
            { value: "scaleMultiplier", label: "\u7F29\u653E\u500D\u7387\u53D8\u5316" }
          ]
        },
        delta: { type: "vec3", default: [0, 0.35, 0], label: "\u53D8\u5316\u91CF (X/Y/Z)" },
        duration: { type: "number", default: 1.2, min: 0.05, max: 60, step: 0.1, label: "\u5355\u7A0B\u65F6\u957F (\u79D2)" },
        delay: { type: "number", default: 0, min: 0, max: 30, step: 0.1, label: "\u8D77\u59CB\u5EF6\u8FDF (\u79D2)" },
        ease: {
          type: "enum",
          default: "inOutSine",
          label: "\u7F13\u52A8\u66F2\u7EBF",
          options: [
            { value: "linear", label: "\u7EBF\u6027 (Linear)" },
            { value: "inOutSine", label: "\u6B63\u5F26\u7F13\u5165\u7F13\u51FA (Sine)" },
            { value: "outQuad", label: "\u4E8C\u6B21\u7F13\u51FA (OutQuad)" },
            { value: "inOutQuad", label: "\u4E8C\u6B21\u7F13\u5165\u7F13\u51FA (InOutQuad)" },
            { value: "outCubic", label: "\u4E09\u6B21\u7F13\u51FA (OutCubic)" },
            { value: "inOutCubic", label: "\u4E09\u6B21\u7F13\u5165\u7F13\u51FA (InOutCubic)" },
            { value: "outBack", label: "\u56DE\u5F39 (OutBack)" },
            { value: "outBounce", label: "\u5F39\u8DF3 (OutBounce)" },
            { value: "outElastic", label: "\u5F39\u6027 (OutElastic)" }
          ]
        },
        loopMode: {
          type: "enum",
          default: "pingPong",
          label: "\u5FAA\u73AF\u6A21\u5F0F",
          options: [
            { value: "once", label: "\u5355\u6B21" },
            { value: "loop", label: "\u4ECE\u5934\u5FAA\u73AF" },
            { value: "pingPong", label: "\u5F80\u8FD4 (PingPong)" }
          ]
        },
        autoStart: { type: "boolean", default: true, label: "\u8BD5\u73A9\u81EA\u52A8\u64AD\u653E" }
      }
    };
  }
});

// src/capabilities/tween/session.ts
var session_exports4 = {};
__export(session_exports4, {
  default: () => session_default4,
  dispose: () => dispose4,
  mount: () => mount4
});
function specOf4(raw) {
  if (!raw || typeof raw !== "object") return normalizeTween(raw);
  const cached = specCache4.get(raw);
  if (cached) return cached;
  const next = normalizeTween(raw);
  specCache4.set(raw, next);
  return next;
}
function stepTweenCapability(dt, host) {
  const runtime2 = getRuntimeWorld();
  if (runtime2.getPlayState() !== "playing") {
    if (agents2.size > 0) agents2.clear();
    return;
  }
  const nodes = runtime2.getNodes();
  const activeIds = /* @__PURE__ */ new Set();
  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[TWEEN_CAPABILITY_ID];
    if (!raw) continue;
    const spec = specOf4(raw);
    if (!spec.enabled || !spec.autoStart) continue;
    const obj = host.resolveObject(node.id);
    if (!obj) continue;
    activeIds.add(node.id);
    let agent = agents2.get(node.id);
    if (!agent) {
      agent = {
        basePos: [obj.position.x, obj.position.y, obj.position.z],
        baseRot: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        baseScale: [obj.scale.x, obj.scale.y, obj.scale.z],
        delayLeft: Math.max(0, spec.delay),
        elapsed: 0,
        reversed: false,
        finished: false
      };
      agents2.set(node.id, agent);
    }
    if (agent.finished || dt <= 0) continue;
    if (agent.delayLeft > 0) {
      agent.delayLeft -= dt;
      if (agent.delayLeft > 0) continue;
      agent.elapsed += -agent.delayLeft;
      agent.delayLeft = 0;
    } else {
      agent.elapsed += dt;
    }
    const dur = Math.max(0.05, spec.duration);
    let rawT = agent.elapsed / dur;
    const effectiveLoop = spec.property === "floatBob" && spec.loopMode === "once" ? "pingPong" : spec.loopMode;
    if (rawT >= 1) {
      if (effectiveLoop === "loop") {
        agent.elapsed = agent.elapsed % dur;
        rawT = agent.elapsed / dur;
      } else if (effectiveLoop === "pingPong") {
        const cycles = Math.floor(rawT);
        if (cycles % 2 === 1) agent.reversed = !agent.reversed;
        agent.elapsed = agent.elapsed % dur;
        rawT = agent.elapsed / dur;
      } else {
        rawT = 1;
        agent.finished = true;
      }
    }
    const progress = agent.reversed ? 1 - rawT : rawT;
    const eased = evalEasing(spec.ease, progress);
    const [dx, dy, dz] = spec.delta;
    if (spec.property === "positionOffset" || spec.property === "floatBob") {
      obj.position.set(
        agent.basePos[0] + dx * eased,
        agent.basePos[1] + dy * eased,
        agent.basePos[2] + dz * eased
      );
    } else if (spec.property === "rotationOffset") {
      const rx = dx * Math.PI / 180;
      const ry = dy * Math.PI / 180;
      const rz = dz * Math.PI / 180;
      obj.rotation.set(
        agent.baseRot[0] + rx * eased,
        agent.baseRot[1] + ry * eased,
        agent.baseRot[2] + rz * eased
      );
    } else if (spec.property === "scaleMultiplier") {
      obj.scale.set(
        agent.baseScale[0] * (1 + dx * eased),
        agent.baseScale[1] * (1 + dy * eased),
        agent.baseScale[2] * (1 + dz * eased)
      );
    }
  }
  for (const id of agents2.keys()) {
    if (!activeIds.has(id)) agents2.delete(id);
  }
}
function mount4() {
  if (!unregister3) {
    unregister3 = registerRuntimeSystem(
      "capability.tween",
      RUNTIME_STAGE.PRE_PHYSICS + 3,
      stepTweenCapability
    );
  }
  return dispose4;
}
function dispose4() {
  unregister3?.();
  unregister3 = null;
  agents2.clear();
}
var unregister3, agents2, specCache4, tweenRuntimeModule, session_default4;
var init_session7 = __esm({
  "src/capabilities/tween/session.ts"() {
    "use strict";
    init_motion();
    init_sceneRuntime();
    init_world();
    init_schema2();
    unregister3 = null;
    agents2 = /* @__PURE__ */ new Map();
    specCache4 = /* @__PURE__ */ new WeakMap();
    tweenRuntimeModule = { mount: mount4, dispose: dispose4 };
    session_default4 = tweenRuntimeModule;
  }
});

// src/capabilities/crowd/schema.ts
function normalizeCrowd(raw) {
  return normalizeBySchema(CROWD_SCHEMA, raw);
}
var CROWD_CAPABILITY_ID, CROWD_SCHEMA;
var init_schema3 = __esm({
  "src/capabilities/crowd/schema.ts"() {
    "use strict";
    init_fieldSchema();
    CROWD_CAPABILITY_ID = "crowd";
    CROWD_SCHEMA = {
      type: "object",
      label: "\u7FA4\u4F53\u907F\u8BA9 (Crowd)",
      fields: {
        enabled: { type: "boolean", default: true, label: "\u542F\u7528" },
        radius: { type: "number", default: 0.8, min: 0.2, max: 10, step: 0.1, label: "\u907F\u8BA9\u534A\u5F84 (m)" },
        maxSpeed: { type: "number", default: 4.5, min: 0.1, max: 50, step: 0.5, label: "\u6700\u5927\u901F\u5EA6 (m/s)" },
        separationWeight: { type: "number", default: 1.8, min: 0, max: 10, step: 0.1, label: "\u5206\u79BB\u6743\u91CD" },
        cohesionWeight: { type: "number", default: 0.25, min: 0, max: 5, step: 0.05, label: "\u51DD\u805A\u6743\u91CD" },
        alignmentWeight: { type: "number", default: 0.35, min: 0, max: 5, step: 0.05, label: "\u5BF9\u9F50\u6743\u91CD" },
        planeXZ: { type: "boolean", default: true, label: "XZ \u5E73\u9762\u79FB\u52A8" },
        faceDirection: { type: "boolean", default: true, label: "\u671D\u5411\u79FB\u52A8\u65B9\u5411" }
      }
    };
  }
});

// src/capabilities/crowd/session.ts
var session_exports5 = {};
__export(session_exports5, {
  crowdRuntimeModule: () => crowdRuntimeModule,
  dispose: () => dispose5,
  ensureCrowdRuntime: () => ensureCrowdRuntime,
  getCrowdStats: () => getCrowdStats,
  isCrowdMoving: () => isCrowdMoving,
  mount: () => mount5,
  setCrowdFormation: () => setCrowdFormation,
  setCrowdTarget: () => setCrowdTarget,
  stopCrowdAgent: () => stopCrowdAgent
});
function readNodePosition(host, node) {
  const obj = host.resolveObject(node.id);
  if (obj) return { x: obj.position.x, y: obj.position.y, z: obj.position.z };
  return { x: node.position[0], y: node.position[1], z: node.position[2] };
}
function writeNodePosition(host, node, x, y, z) {
  const obj = host.resolveObject(node.id);
  if (obj) obj.position.set(x, y, z);
  node.position = [x, y, z];
}
function writeNodeYaw(host, node, dx, dz) {
  if (dx * dx + dz * dz < 1e-6) return;
  const yawRad = Math.atan2(dx, dz);
  const obj = host.resolveObject(node.id);
  if (obj) obj.rotation.y = yawRad;
  node.rotation = [node.rotation[0], yawRad * 180 / Math.PI, node.rotation[2]];
}
function setCrowdTarget(nodeId, target, options) {
  const existing = agents3.get(nodeId);
  if (existing) {
    existing.target = { x: target.x, y: target.y, z: target.z };
    existing.arriveDist = Math.max(0.05, options?.arriveDist ?? 0.35);
    existing.speedOverride = options?.speed;
    existing.onArrive = options?.onArrive;
  } else {
    agents3.set(nodeId, {
      nodeId,
      vx: 0,
      vy: 0,
      vz: 0,
      target: { x: target.x, y: target.y, z: target.z },
      arriveDist: Math.max(0.05, options?.arriveDist ?? 0.35),
      speedOverride: options?.speed,
      onArrive: options?.onArrive
    });
  }
}
function stopCrowdAgent(nodeId) {
  const agent = agents3.get(nodeId);
  if (!agent) return;
  agent.target = null;
  agent.vx = 0;
  agent.vy = 0;
  agent.vz = 0;
  agent.onArrive = void 0;
}
function isCrowdMoving(nodeId) {
  const agent = agents3.get(nodeId);
  return Boolean(agent && agent.target);
}
function getCrowdStats() {
  let moving = 0;
  for (const agent of agents3.values()) {
    if (agent.target) moving += 1;
  }
  return { total: agents3.size, moving };
}
function setCrowdFormation(nodeIds, center, options) {
  const count = nodeIds.length;
  if (count === 0) return;
  const formation = options?.formation ?? "grid";
  const spacing = Math.max(0.5, options?.spacing ?? 1.8);
  const yaw = options?.facingYaw ?? 0;
  const cos3 = Math.cos(yaw);
  const sin3 = Math.sin(yaw);
  const rotateOffset = (lx, lz) => ({
    x: center.x + lx * cos3 + lz * sin3,
    y: center.y,
    z: center.z - lx * sin3 + lz * cos3
  });
  if (formation === "line") {
    const half = (count - 1) * 0.5;
    for (let i = 0; i < count; i += 1) {
      const target = rotateOffset((i - half) * spacing, 0);
      setCrowdTarget(nodeIds[i], target, options);
    }
    return;
  }
  if (formation === "wedge") {
    for (let i = 0; i < count; i += 1) {
      if (i === 0) {
        setCrowdTarget(nodeIds[i], rotateOffset(0, 0), options);
      } else {
        const rank = Math.ceil(i / 2);
        const side = i % 2 === 1 ? -1 : 1;
        setCrowdTarget(nodeIds[i], rotateOffset(side * rank * spacing * 0.85, -rank * spacing), options);
      }
    }
    return;
  }
  if (formation === "circle") {
    const radius = Math.max(spacing, count * spacing / (Math.PI * 2));
    for (let i = 0; i < count; i += 1) {
      const angle = i / count * Math.PI * 2;
      setCrowdTarget(
        nodeIds[i],
        rotateOffset(Math.cos(angle) * radius, Math.sin(angle) * radius),
        options
      );
    }
    return;
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const lx = (col - (cols - 1) * 0.5) * spacing;
    const lz = -(row - (rows - 1) * 0.5) * spacing;
    setCrowdTarget(nodeIds[i], rotateOffset(lx, lz), options);
  }
}
function stepCrowdRuntime(dt, host) {
  const world3 = getRuntimeWorld();
  const nodes = world3.getNodes();
  const entries = [];
  let maxRadius = 1;
  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[CROWD_CAPABILITY_ID];
    if (!raw || !node.visible) continue;
    const spec = normalizeCrowd(raw);
    if (!spec.enabled) continue;
    let agent = agents3.get(node.id);
    if (!agent) {
      agent = {
        nodeId: node.id,
        vx: 0,
        vy: 0,
        vz: 0,
        target: null,
        arriveDist: 0.35
      };
      agents3.set(node.id, agent);
    }
    if (spec.radius > maxRadius) maxRadius = spec.radius;
    entries.push({
      node,
      spec,
      pos: readNodePosition(host, node),
      agent
    });
  }
  const activeSet = new Set(entries.map((e) => e.node.id));
  for (const id of agents3.keys()) {
    if (!activeSet.has(id)) agents3.delete(id);
  }
  if (entries.length === 0) return;
  const cellSize = Math.max(1.2, maxRadius * 2.4);
  const grid = /* @__PURE__ */ new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const p = entries[i].pos;
    const cx = Math.floor(p.x / cellSize);
    const cz = Math.floor(p.z / cellSize);
    const key = `${cx},${cz}`;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }
  const safeDt = Math.min(0.05, Math.max(1e-4, dt));
  for (let i = 0; i < entries.length; i += 1) {
    const { node, spec, pos, agent } = entries[i];
    const maxSpeed = Math.max(0.1, agent.speedOverride ?? spec.maxSpeed);
    let desiredVx = 0;
    let desiredVy = 0;
    let desiredVz = 0;
    let hasGoal = false;
    if (agent.target) {
      const gx = agent.target.x - pos.x;
      const gy = spec.planeXZ ? 0 : agent.target.y - pos.y;
      const gz = agent.target.z - pos.z;
      const dist = Math.hypot(gx, gy, gz);
      if (dist <= agent.arriveDist) {
        agent.target = null;
        agent.vx = 0;
        agent.vy = 0;
        agent.vz = 0;
        const cb = agent.onArrive;
        agent.onArrive = void 0;
        if (cb) {
          try {
            cb();
          } catch (err) {
            console.warn("[Crowd] onArrive \u56DE\u8C03\u5F02\u5E38:", err);
          }
        }
      } else {
        hasGoal = true;
        const slowRadius = Math.max(agent.arriveDist * 2.5, 1);
        const speed = dist < slowRadius ? maxSpeed * (dist / slowRadius) : maxSpeed;
        desiredVx = gx / dist * speed;
        desiredVy = gy / dist * speed;
        desiredVz = gz / dist * speed;
      }
    }
    let sepX = 0;
    let sepY = 0;
    let sepZ = 0;
    let cohX = 0;
    let cohY = 0;
    let cohZ = 0;
    let aliX = 0;
    let aliY = 0;
    let aliZ = 0;
    let neighborCount = 0;
    const cx = Math.floor(pos.x / cellSize);
    const cz = Math.floor(pos.z / cellSize);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        const bucket = grid.get(`${cx + ox},${cz + oz}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i) continue;
          const other = entries[j];
          const dx = pos.x - other.pos.x;
          const dy = spec.planeXZ ? 0 : pos.y - other.pos.y;
          const dz = pos.z - other.pos.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const minDist = spec.radius + other.spec.radius;
          if (d2 > minDist * minDist * 2.25) continue;
          const d = Math.sqrt(d2);
          if (d < minDist) {
            if (d > 1e-4) {
              const push = (minDist - d) / minDist * maxSpeed;
              sepX += dx / d * push;
              sepY += dy / d * push;
              sepZ += dz / d * push;
            } else {
              const angle = i * 2.39996 % (Math.PI * 2);
              sepX += Math.cos(angle) * maxSpeed * 0.5;
              sepZ += Math.sin(angle) * maxSpeed * 0.5;
            }
          }
          neighborCount += 1;
          cohX += other.pos.x;
          cohY += other.pos.y;
          cohZ += other.pos.z;
          aliX += other.agent.vx;
          aliY += other.agent.vy;
          aliZ += other.agent.vz;
        }
      }
    }
    let steerVx = desiredVx + sepX * spec.separationWeight;
    let steerVy = desiredVy + sepY * spec.separationWeight;
    let steerVz = desiredVz + sepZ * spec.separationWeight;
    if (neighborCount > 0 && hasGoal) {
      const inv = 1 / neighborCount;
      const cxAvg = cohX * inv - pos.x;
      const cyAvg = spec.planeXZ ? 0 : cohY * inv - pos.y;
      const czAvg = cohZ * inv - pos.z;
      const cLen = Math.hypot(cxAvg, cyAvg, czAvg);
      if (cLen > 1e-4) {
        steerVx += cxAvg / cLen * maxSpeed * spec.cohesionWeight * 0.5;
        steerVy += cyAvg / cLen * maxSpeed * spec.cohesionWeight * 0.5;
        steerVz += czAvg / cLen * maxSpeed * spec.cohesionWeight * 0.5;
      }
      steerVx += aliX * inv * spec.alignmentWeight * 0.4;
      steerVy += aliY * inv * spec.alignmentWeight * 0.4;
      steerVz += aliZ * inv * spec.alignmentWeight * 0.4;
    }
    const spd = Math.hypot(steerVx, steerVy, steerVz);
    if (spd > maxSpeed) {
      const k = maxSpeed / spd;
      steerVx *= k;
      steerVy *= k;
      steerVz *= k;
    }
    const blend = Math.min(1, safeDt * 10);
    agent.vx += (steerVx - agent.vx) * blend;
    agent.vy += (steerVy - agent.vy) * blend;
    agent.vz += (steerVz - agent.vz) * blend;
    const moved = Math.hypot(agent.vx, agent.vy, agent.vz);
    if (moved < 0.01 && !hasGoal) {
      agent.vx = 0;
      agent.vy = 0;
      agent.vz = 0;
      continue;
    }
    const nx = pos.x + agent.vx * safeDt;
    const ny = spec.planeXZ ? pos.y : pos.y + agent.vy * safeDt;
    const nz = pos.z + agent.vz * safeDt;
    writeNodePosition(host, node, nx, ny, nz);
    if (spec.faceDirection && agent.vx * agent.vx + agent.vz * agent.vz > 0.04) {
      writeNodeYaw(host, node, agent.vx, agent.vz);
    }
  }
}
function ensureCrowdRuntime() {
  if (unregisterCrowd) return;
  unregisterCrowd = registerRuntimeSystem(
    "capability.crowd",
    RUNTIME_STAGE.PRE_PHYSICS + 4,
    stepCrowdRuntime
  );
}
function mount5() {
  ensureCrowdRuntime();
  return dispose5;
}
function dispose5() {
  unregisterCrowd?.();
  unregisterCrowd = null;
  agents3.clear();
}
var agents3, unregisterCrowd, crowdRuntimeModule;
var init_session8 = __esm({
  "src/capabilities/crowd/session.ts"() {
    "use strict";
    init_sceneRuntime();
    init_world();
    init_schema3();
    agents3 = /* @__PURE__ */ new Map();
    unregisterCrowd = null;
    crowdRuntimeModule = {
      mount: mount5,
      dispose: dispose5
    };
  }
});

// src/gameplay/types.ts
var CORE_GAMEPLAY_PACK_ID;
var init_types = __esm({
  "src/gameplay/types.ts"() {
    "use strict";
    CORE_GAMEPLAY_PACK_ID = "t3d.core";
  }
});

// src/gameplay/registry.ts
function registerGameplayPack(pack) {
  packs.set(pack.id, pack);
}
function resolveEnabledPackIds(enabled) {
  const next = /* @__PURE__ */ new Set([CORE_GAMEPLAY_PACK_ID, ...enabled ?? []]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...next]) {
      for (const dep of packs.get(id)?.dependencies ?? []) {
        if (!next.has(dep)) {
          next.add(dep);
          changed = true;
        }
      }
    }
  }
  return next;
}
function listEnabledTableSchemas(enabled) {
  const on = resolveEnabledPackIds(enabled);
  const schemas = [];
  for (const pack of packs.values()) {
    if (!on.has(pack.id)) continue;
    for (const table of pack.tables ?? []) schemas.push(table);
  }
  return schemas;
}
function tableSchema(tableId) {
  for (const pack of packs.values()) {
    const found = pack.tables?.find((table) => table.tableId === tableId);
    if (found) return found;
  }
  return void 0;
}
function defaultRows(tableId) {
  return structuredClone(tableSchema(tableId)?.defaultRows ?? []);
}
function tableRows(database, tableId) {
  const existing = database?.tables?.[tableId];
  if (existing) return existing;
  return defaultRows(tableId);
}
function createDefaultGameDatabase(enabled) {
  const tables = {};
  for (const schema of listEnabledTableSchemas(enabled)) {
    tables[schema.tableId] = structuredClone(schema.defaultRows ?? []);
  }
  return { tables };
}
function ensureGameDatabase(value, enabled) {
  const base = createDefaultGameDatabase(enabled);
  if (!value || typeof value !== "object") return base;
  const tables = value.tables;
  if (!tables || typeof tables !== "object") return base;
  for (const [tableId, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue;
    base.tables[tableId] = rows.flatMap((row) => cleanRow(row));
  }
  return base;
}
function cleanRow(value) {
  if (!value || typeof value !== "object") return [];
  const row = value;
  if (typeof row.id !== "string" || typeof row.name !== "string") return [];
  return [{
    id: row.id,
    name: row.name,
    category: typeof row.category === "string" ? row.category : "",
    description: typeof row.description === "string" ? row.description : "",
    fields: row.fields && typeof row.fields === "object" ? { ...row.fields } : {}
  }];
}
function findRow(database, tableId, id) {
  const key = id.trim();
  if (!key) return void 0;
  return tableRows(database, tableId).find((row) => row.id === key);
}
var packs;
var init_registry = __esm({
  "src/gameplay/registry.ts"() {
    "use strict";
    init_types();
    packs = /* @__PURE__ */ new Map();
  }
});

// src/gameplay/runtimeTags.ts
function matchesTag(actual, query) {
  if (!actual || !query) return false;
  const have = actual.trim();
  let want = query.trim();
  if (!have || !want) return false;
  if (want.endsWith(".*")) want = want.slice(0, -2);
  if (have === want) return true;
  return have.startsWith(`${want}.`);
}
function listRuntimeTags(nodeId, now = performance.now() / 1e3) {
  const bag = bags.get(nodeId);
  if (!bag) return [];
  return [...bag.entries()].map(([tag, until]) => ({
    tag,
    remaining: until > 0 ? Math.max(0, until - now) : null
  }));
}
function nodeHasTag(node, query) {
  if (!query.trim()) return false;
  if (matchesTag(node.tagId, query)) return true;
  for (const tag of node.tagIds ?? []) {
    if (matchesTag(tag, query)) return true;
  }
  const bag = bags.get(node.id);
  if (!bag) return false;
  for (const tag of bag.keys()) {
    if (matchesTag(tag, query)) return true;
  }
  return false;
}
var bags;
var init_runtimeTags = __esm({
  "src/gameplay/runtimeTags.ts"() {
    "use strict";
    init_world();
    init_registry();
    bags = /* @__PURE__ */ new Map();
  }
});

// src/capabilities/projectile/schema.ts
function normalizeProjectile(raw) {
  return normalizeBySchema(PROJECTILE_SCHEMA, raw);
}
var PROJECTILE_CAPABILITY_ID, PROJECTILE_SCHEMA;
var init_schema4 = __esm({
  "src/capabilities/projectile/schema.ts"() {
    "use strict";
    init_fieldSchema();
    PROJECTILE_CAPABILITY_ID = "projectile";
    PROJECTILE_SCHEMA = {
      type: "object",
      label: "\u901A\u7528\u5F39\u9053 (Projectile)",
      fields: {
        enabled: { type: "boolean", default: true, label: "\u542F\u7528" },
        mode: {
          type: "enum",
          default: "linear",
          label: "\u5F39\u9053\u6A21\u5F0F",
          options: [
            { value: "linear", label: "\u76F4\u7EBF\u98DE\u884C" },
            { value: "homing", label: "\u81EA\u52A8\u8FFD\u8E2A" },
            { value: "ballistic", label: "\u629B\u7269\u7EBF" }
          ]
        },
        speed: { type: "number", default: 22, min: 0.5, max: 200, step: 1, label: "\u98DE\u884C\u901F\u5EA6 (m/s)" },
        gravity: { type: "number", default: 9.8, min: 0, max: 50, step: 0.5, label: "\u91CD\u529B\u52A0\u901F\u5EA6" },
        turnRate: { type: "number", default: 6, min: 0.1, max: 30, step: 0.5, label: "\u8FFD\u8E2A\u8F6C\u5411\u7387 (rad/s)" },
        maxLifetime: { type: "number", default: 3, min: 0.1, max: 60, step: 0.2, label: "\u6700\u5927\u5BFF\u547D (s)" },
        hitRadius: { type: "number", default: 0.65, min: 0.05, max: 10, step: 0.05, label: "\u547D\u4E2D\u5224\u5B9A\u534A\u5F84 (m)" },
        targetTag: { type: "string", default: "enemy", label: "\u76EE\u6807\u6807\u7B7E" },
        damage: { type: "number", default: 10, min: 0, max: 9999, step: 1, label: "\u4F24\u5BB3\u503C" },
        destroyOnHit: { type: "boolean", default: true, label: "\u547D\u4E2D\u540E\u56DE\u6C60/\u9500\u6BC1" }
      }
    };
  }
});

// src/capabilities/projectile/session.ts
var session_exports6 = {};
__export(session_exports6, {
  bindProjectileRuntimeHooks: () => bindProjectileRuntimeHooks,
  dispose: () => dispose6,
  ensureProjectileRuntime: () => ensureProjectileRuntime,
  launchProjectile: () => launchProjectile,
  mount: () => mount6,
  projectileRuntimeModule: () => projectileRuntimeModule,
  resetProjectileState: () => resetProjectileState
});
import { Quaternion as Quaternion4, Vector3 as Vector38 } from "three";
function bindProjectileRuntimeHooks(next) {
  hooks = next;
}
function readPos(host, node) {
  const obj = host.resolveObject(node.id);
  if (obj) return { x: obj.position.x, y: obj.position.y, z: obj.position.z };
  return { x: node.position[0], y: node.position[1], z: node.position[2] };
}
function writePos(host, node, x, y, z) {
  const obj = host.resolveObject(node.id);
  if (obj) obj.position.set(x, y, z);
  node.position = [x, y, z];
}
function orientAlongVelocity(host, node, vx, vy, vz) {
  const lenSq = vx * vx + vy * vy + vz * vz;
  if (lenSq < 1e-6) return;
  tmpDir.set(vx, vy, vz).normalize();
  tmpQuat2.setFromUnitVectors(tmpForward, tmpDir);
  const obj = host.resolveObject(node.id);
  if (obj) {
    obj.quaternion.copy(tmpQuat2);
    node.rotation = [
      obj.rotation.x * 180 / Math.PI,
      obj.rotation.y * 180 / Math.PI,
      obj.rotation.z * 180 / Math.PI
    ];
  }
}
function defaultDirectionForNode(node) {
  const yaw = (node.rotation?.[1] ?? 0) * Math.PI / 180;
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}
function launchProjectile(nodeId, options) {
  const world3 = getRuntimeWorld();
  const node = world3.getNodes()[nodeId];
  const rawSpec = node?.capabilities?.[PROJECTILE_CAPABILITY_ID];
  const spec = normalizeProjectile(rawSpec);
  const speed = Math.max(0.1, options?.speed ?? spec.speed);
  const dir = options?.direction ?? (node ? defaultDirectionForNode(node) : { x: 0, y: 0, z: 1 });
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  activeProjectiles.set(nodeId, {
    nodeId,
    vx: dir.x / len * speed,
    vy: dir.y / len * speed,
    vz: dir.z / len * speed,
    elapsed: 0,
    mode: options?.mode,
    speed: options?.speed,
    gravity: options?.gravity,
    turnRate: options?.turnRate,
    maxLifetime: options?.maxLifetime,
    hitRadius: options?.hitRadius,
    targetTag: options?.targetTag,
    damage: options?.damage,
    destroyOnHit: options?.destroyOnHit,
    targetId: options?.targetId,
    ownerId: options?.ownerId,
    onHit: options?.onHit
  });
}
function resetProjectileState(nodeId) {
  activeProjectiles.delete(nodeId);
}
function stepProjectileRuntime(dt, host) {
  const world3 = getRuntimeWorld();
  const nodes = world3.getNodes();
  const safeDt = Math.min(0.05, Math.max(1e-4, dt));
  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[PROJECTILE_CAPABILITY_ID];
    if (!raw) continue;
    if (!node.visible || hooks.isNodeInactive?.(node.id, nodes)) {
      activeProjectiles.delete(node.id);
      continue;
    }
    const spec = normalizeProjectile(raw);
    if (!spec.enabled) continue;
    if (!activeProjectiles.has(node.id)) {
      const dir = defaultDirectionForNode(node);
      activeProjectiles.set(node.id, {
        nodeId: node.id,
        vx: dir.x * spec.speed,
        vy: dir.y * spec.speed,
        vz: dir.z * spec.speed,
        elapsed: 0
      });
    }
  }
  for (const [id, state] of [...activeProjectiles.entries()]) {
    const node = nodes[id];
    if (!node || !node.visible || hooks.isNodeInactive?.(id, nodes)) {
      activeProjectiles.delete(id);
      continue;
    }
    const spec = normalizeProjectile(node.capabilities?.[PROJECTILE_CAPABILITY_ID]);
    const mode = state.mode ?? spec.mode;
    const speed = Math.max(0.1, state.speed ?? spec.speed);
    const gravity = state.gravity ?? spec.gravity;
    const turnRate = state.turnRate ?? spec.turnRate;
    const maxLifetime = Math.max(0.05, state.maxLifetime ?? spec.maxLifetime);
    const hitRadius = Math.max(0.02, state.hitRadius ?? spec.hitRadius);
    const targetTag = (state.targetTag ?? spec.targetTag).trim();
    const damage = state.damage ?? spec.damage;
    const destroyOnHit = state.destroyOnHit ?? spec.destroyOnHit;
    state.elapsed += safeDt;
    if (state.elapsed >= maxLifetime) {
      activeProjectiles.delete(id);
      hooks.onRecycle?.(id, host);
      continue;
    }
    const pos = readPos(host, node);
    if (mode === "homing" && state.targetId) {
      const targetNode = nodes[state.targetId];
      if (targetNode && targetNode.visible && !hooks.isNodeInactive?.(targetNode.id, nodes)) {
        const tp = readPos(host, targetNode);
        const dx = tp.x - pos.x;
        const dy = tp.y - pos.y;
        const dz = tp.z - pos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 1e-4) {
          const desiredVx = dx / dist * speed;
          const desiredVy = dy / dist * speed;
          const desiredVz = dz / dist * speed;
          const blend = Math.min(1, turnRate * safeDt);
          state.vx += (desiredVx - state.vx) * blend;
          state.vy += (desiredVy - state.vy) * blend;
          state.vz += (desiredVz - state.vz) * blend;
          const curSpd = Math.hypot(state.vx, state.vy, state.vz) || 1;
          state.vx = state.vx / curSpd * speed;
          state.vy = state.vy / curSpd * speed;
          state.vz = state.vz / curSpd * speed;
        }
      }
    } else if (mode === "ballistic") {
      state.vy -= gravity * safeDt;
    }
    const nx = pos.x + state.vx * safeDt;
    const ny = pos.y + state.vy * safeDt;
    const nz = pos.z + state.vz * safeDt;
    writePos(host, node, nx, ny, nz);
    orientAlongVelocity(host, node, state.vx, state.vy, state.vz);
    let hitNode = null;
    if (state.targetId) {
      const t = nodes[state.targetId];
      if (t && t.visible && !hooks.isNodeInactive?.(t.id, nodes)) {
        const tp = readPos(host, t);
        const d = Math.hypot(tp.x - nx, tp.y - ny, tp.z - nz);
        if (d <= hitRadius) hitNode = t;
      }
    }
    if (!hitNode && targetTag) {
      const r2 = hitRadius * hitRadius;
      for (const candidate of Object.values(nodes)) {
        if (candidate.id === id || candidate.id === state.ownerId) continue;
        if (!candidate.visible || hooks.isNodeInactive?.(candidate.id, nodes)) continue;
        if (!nodeHasTag(candidate, targetTag)) continue;
        const cp = readPos(host, candidate);
        const dx = cp.x - nx;
        const dy = cp.y - ny;
        const dz = cp.z - nz;
        if (dx * dx + dy * dy + dz * dz <= r2) {
          hitNode = candidate;
          break;
        }
      }
    }
    if (hitNode) {
      const hitPos = { x: nx, y: ny, z: nz };
      try {
        state.onHit?.(hitNode.id, hitPos);
      } catch (err) {
        console.warn("[Projectile] onHit \u56DE\u8C03\u5F02\u5E38:", err);
      }
      try {
        hooks.onHit?.({
          projectileId: id,
          targetId: hitNode.id,
          ownerId: state.ownerId,
          damage,
          position: hitPos
        });
      } catch (err) {
        console.warn("[Projectile] hooks.onHit \u5F02\u5E38:", err);
      }
      if (destroyOnHit) {
        activeProjectiles.delete(id);
        hooks.onRecycle?.(id, host);
      }
    }
  }
}
function ensureProjectileRuntime() {
  if (unregisterProjectile) return;
  unregisterProjectile = registerRuntimeSystem(
    "capability.projectile",
    RUNTIME_STAGE.PRE_PHYSICS + 5,
    stepProjectileRuntime
  );
}
function mount6() {
  ensureProjectileRuntime();
  return dispose6;
}
function dispose6() {
  unregisterProjectile?.();
  unregisterProjectile = null;
  activeProjectiles.clear();
}
var activeProjectiles, unregisterProjectile, hooks, tmpDir, tmpQuat2, tmpForward, projectileRuntimeModule;
var init_session9 = __esm({
  "src/capabilities/projectile/session.ts"() {
    "use strict";
    init_runtimeTags();
    init_sceneRuntime();
    init_world();
    init_schema4();
    activeProjectiles = /* @__PURE__ */ new Map();
    unregisterProjectile = null;
    hooks = {};
    tmpDir = new Vector38();
    tmpQuat2 = new Quaternion4();
    tmpForward = new Vector38(0, 0, 1);
    projectileRuntimeModule = {
      mount: mount6,
      dispose: dispose6
    };
  }
});

// src/capabilities/sky/defaults.ts
function defaultSkySettings() {
  return {
    timeOfDay: 15,
    latitude: 35,
    dayOfYear: 172,
    north: "+Z",
    exposure: 2.5,
    turbidity: 1,
    groundAlbedo: 0.3,
    sunDisc: true,
    sunAngularDiameter: 0.53,
    sunIntensity: 0.12,
    sunShadow: true,
    fog: false,
    fogDensity: 0.3,
    fogHeightFalloff: 300,
    fogBaseHeight: 0,
    fogMaxOpacity: 1,
    fogColor: "#c9d6e6",
    fogSkyColor: true,
    haze: false,
    hazeStrength: 1,
    hazeNear: 200,
    stars: false,
    starIntensity: 1,
    starSize: 0.7,
    milkyWay: 0.25,
    moon: false,
    moonAngularDiameter: 0.53,
    moonPhase: 0.5,
    moonLight: 1,
    mirrorBelowHorizon: false
  };
}
function normalizeSkySettings(value) {
  const base = defaultSkySettings();
  if (!value || typeof value !== "object") return base;
  const raw = value;
  return {
    timeOfDay: clamp3(raw.timeOfDay, base.timeOfDay, 0, 24),
    latitude: clamp3(raw.latitude, base.latitude, -90, 90),
    dayOfYear: Math.round(clamp3(raw.dayOfYear, base.dayOfYear, 1, 365)),
    north: typeof raw.north === "string" && NORTH.includes(raw.north) ? raw.north : base.north,
    exposure: clamp3(raw.exposure, base.exposure, 0, 120),
    turbidity: clamp3(raw.turbidity, base.turbidity, 0, 12),
    groundAlbedo: clamp3(raw.groundAlbedo, base.groundAlbedo, 0, 1),
    sunDisc: bool(raw.sunDisc, base.sunDisc),
    sunAngularDiameter: clamp3(raw.sunAngularDiameter, base.sunAngularDiameter, 0.05, 12),
    sunIntensity: clamp3(raw.sunIntensity, base.sunIntensity, 0, 4),
    sunShadow: bool(raw.sunShadow, base.sunShadow),
    fog: bool(raw.fog, base.fog),
    fogDensity: clamp3(raw.fogDensity, base.fogDensity, 0, 12),
    fogHeightFalloff: clamp3(raw.fogHeightFalloff, base.fogHeightFalloff, 1, 8e3),
    fogBaseHeight: clamp3(raw.fogBaseHeight, base.fogBaseHeight, -500, 8e3),
    fogMaxOpacity: clamp3(raw.fogMaxOpacity, base.fogMaxOpacity, 0, 1),
    fogColor: colorOf(raw.fogColor, base.fogColor),
    fogSkyColor: bool(raw.fogSkyColor, base.fogSkyColor),
    haze: bool(raw.haze, base.haze),
    hazeStrength: clamp3(raw.hazeStrength, base.hazeStrength, 0, 3),
    hazeNear: clamp3(raw.hazeNear, base.hazeNear, 1, 1e3),
    stars: bool(raw.stars, base.stars),
    starIntensity: clamp3(raw.starIntensity, base.starIntensity, 0, 4),
    starSize: clamp3(raw.starSize, base.starSize, 0.2, 3),
    milkyWay: clamp3(raw.milkyWay, base.milkyWay, 0, 2),
    moon: bool(raw.moon, base.moon),
    moonAngularDiameter: clamp3(raw.moonAngularDiameter, base.moonAngularDiameter, 0.05, 12),
    moonPhase: clamp3(raw.moonPhase, base.moonPhase, 0, 1),
    moonLight: clamp3(raw.moonLight, base.moonLight, 0, 3),
    mirrorBelowHorizon: bool(raw.mirrorBelowHorizon, base.mirrorBelowHorizon)
  };
}
function clamp3(value, fallback, min3, max4) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max4, Math.max(min3, next));
}
function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function colorOf(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
var SKY_CAPABILITY_ID, NORTH;
var init_defaults4 = __esm({
  "src/capabilities/sky/defaults.ts"() {
    "use strict";
    SKY_CAPABILITY_ID = "sky";
    NORTH = ["+X", "-X", "+Z", "-Z"];
  }
});

// src/core/layers.ts
var EDITOR_HELPER_LAYER;
var init_layers = __esm({
  "src/core/layers.ts"() {
    "use strict";
    EDITOR_HELPER_LAYER = 31;
  }
});

// src/capabilities/sky/runtime.ts
var runtime_exports = {};
__export(runtime_exports, {
  createSkyDriver: () => createSkyDriver
});
import { Color as Color4, OrthographicCamera } from "three";
import { mix as mix4, uniform as uniform3, vec4 as vec43 } from "three/tsl";
import { Sky } from "@pmndrs/sky";
function createSkyDriver(renderer, scene2) {
  return new SkyRuntime(renderer, scene2);
}
function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}
function fogChanged(prev, next) {
  return prev.fog !== next.fog || prev.fogDensity !== next.fogDensity || prev.fogHeightFalloff !== next.fogHeightFalloff || prev.fogBaseHeight !== next.fogBaseHeight || prev.fogMaxOpacity !== next.fogMaxOpacity;
}
function lightUserLayers(light) {
  light.layers.disableAll();
  for (let bit = 0; bit < EDITOR_HELPER_LAYER; bit += 1) light.layers.enable(bit);
}
function configureShadow(light) {
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -15e-5;
  light.shadow.normalBias = 0.04;
  const camera = light.shadow.camera;
  if (camera instanceof OrthographicCamera) {
    camera.near = 0.5;
    camera.far = 160;
    camera.left = -40;
    camera.right = 40;
    camera.top = 40;
    camera.bottom = -40;
    camera.updateProjectionMatrix();
  }
}
var SkyRuntime;
var init_runtime = __esm({
  "src/capabilities/sky/runtime.ts"() {
    "use strict";
    init_layers();
    init_session10();
    SkyRuntime = class {
      constructor(renderer, scene2) {
        this.scene = scene2;
        this.sky = new Sky(renderer, {
          preset: "earth",
          sunColor: "bruneton",
          enableAerialPerspective: true
        });
        this.sky.attach(scene2);
        this.sun = this.sky.createSun({
          physical: true,
          intensity: 0.12,
          castShadow: true,
          horizonFade: true
        });
        lightUserLayers(this.sun.light);
        configureShadow(this.sun.light);
        this.sun.attach(scene2);
      }
      scene;
      sky;
      sun;
      moon = null;
      applied = null;
      starsWanted = false;
      starsReady = false;
      starsPending = false;
      starToken = 0;
      night = null;
      starLook = null;
      fogTint = uniform3(new Color4("#c9d6e6"));
      fogUseColor = uniform3(0);
      hazeOn = false;
      fogOn = false;
      apKey = "";
      applyFogNode = (colorNode, scenePass) => {
        let node = colorNode;
        if (this.hazeOn && this.sky.aerialPerspectiveTexture) {
          this.sky.setHazePolicy("ap");
          node = this.sky.applyHaze(node, {
            scenePass,
            policy: "ap",
            raymarchFallback: false,
            // 编辑器远平面只有两千米。不传这个的话，远处地面的深度会被当成天空，雾气在合成时被减掉。
            useCameraFar: true
          });
        }
        if (!this.fogOn) return node;
        const skyFog = this.sky.applyFog(node, { scenePass });
        const amount = this.sky.applyFog(node, { scenePass, debugMode: "fog-amount" });
        const base = node;
        const flat = mix4(base.rgb, this.fogTint, amount.r);
        return vec43(mix4(skyFog.rgb, flat, this.fogUseColor), skyFog.a);
      };
      /** 构造时库自己已经开始编译。这里只取那一份 Promise，避免和主绘制抢渲染器。 */
      compile() {
        return this.sky.compileAsync();
      }
      hazeReady() {
        return Boolean(this.sky.aerialPerspectiveTexture);
      }
      sync(settings, camera) {
        const prev = this.applied;
        if (!prev || prev.timeOfDay !== settings.timeOfDay) this.sky.setTimeOfDay(settings.timeOfDay);
        if (!prev || prev.latitude !== settings.latitude) this.sky.setLatitude(settings.latitude);
        if (!prev || prev.dayOfYear !== settings.dayOfYear) this.sky.setDayOfYear(settings.dayOfYear);
        if (!prev || prev.north !== settings.north) this.sky.setNorth(settings.north);
        if (!prev || prev.exposure !== settings.exposure) this.sky.setExposure(settings.exposure);
        if (!prev || prev.turbidity !== settings.turbidity) this.sky.setTurbidity(settings.turbidity);
        if (!prev || prev.groundAlbedo !== settings.groundAlbedo) this.sky.setGroundAlbedo(settings.groundAlbedo);
        if (!prev || prev.sunDisc !== settings.sunDisc || prev.sunAngularDiameter !== settings.sunAngularDiameter) {
          this.sky.setSunDisc({
            visible: settings.sunDisc,
            angularDiameter: degreesToRadians(settings.sunAngularDiameter)
          });
        }
        if (!prev || prev.mirrorBelowHorizon !== settings.mirrorBelowHorizon) this.sky.setMirrorBelowHorizon(settings.mirrorBelowHorizon);
        if (!prev || prev.sunIntensity !== settings.sunIntensity) this.sun.setIntensity(settings.sunIntensity);
        if (!prev || prev.sunShadow !== settings.sunShadow) this.sun.castShadow = settings.sunShadow;
        if (!prev || fogChanged(prev, settings)) {
          this.sky.setFog({
            density: settings.fogDensity,
            heightFalloff: settings.fogHeightFalloff,
            baseHeight: settings.fogBaseHeight,
            maxOpacity: settings.fog ? settings.fogMaxOpacity : 0
          });
        }
        this.fogTint.value.set(settings.fogColor);
        this.fogUseColor.value = settings.fogSkyColor ? 0 : 1;
        if (!prev || prev.hazeStrength !== settings.hazeStrength) this.sky.setHazeStrength(settings.hazeStrength);
        if (!prev || prev.hazeNear !== settings.hazeNear) this.sky.setAerialPerspectiveDistanceScale(settings.hazeNear);
        this.hazeOn = settings.haze;
        this.fogOn = settings.fog;
        this.syncMoon(settings);
        this.syncStars(settings);
        this.applied = settings;
        this.sky.update(camera);
        this.applyCelestialFade(settings, prev);
        if (settings.haze && this.hazeReady()) {
          const e = camera.matrixWorld.elements;
          const nextApKey = `${e[0].toFixed(3)},${e[4].toFixed(3)},${e[8].toFixed(3)},${e[12].toFixed(2)},${e[13].toFixed(2)},${e[14].toFixed(2)}|${settings.timeOfDay}|${settings.latitude}|${settings.dayOfYear}|${settings.north}|${settings.turbidity}|${settings.groundAlbedo}`;
          if (nextApKey !== this.apKey) {
            this.apKey = nextApKey;
            void this.sky.updateAerialPerspective();
          }
        } else {
          this.apKey = "";
        }
        const atmosphere = settings.fog || settings.haze;
        setSkyViewState({
          owns: true,
          fog: atmosphere,
          apply: atmosphere ? this.applyFogNode : null,
          signature: `${settings.haze ? 1 : 0}${settings.fog ? 1 : 0}`
        });
      }
      dispose() {
        this.starToken += 1;
        this.starsWanted = false;
        if (this.starsReady) this.sky.disableStars();
        this.starsReady = false;
        this.night = null;
        this.moon?.dispose();
        this.moon = null;
        this.sun.dispose();
        this.sky.detach();
        this.sky.dispose();
        setSkyViewState({ owns: false, fog: false, apply: null });
      }
      syncMoon(settings) {
        if (!settings.moon) {
          this.moon?.dispose();
          this.moon = null;
          return;
        }
        if (!this.moon) {
          this.moon = this.sky.createMoonlight({
            skyFill: false,
            castShadow: false,
            phase: settings.moonPhase,
            discAngularDiameter: degreesToRadians(settings.moonAngularDiameter)
          });
          lightUserLayers(this.moon.moon.light);
          this.moon.attach(this.scene);
          this.moon.setIntensity(settings.moonLight);
          this.moon.moon.setDiscIntensity(3);
          return;
        }
        const prev = this.applied;
        if (!prev || prev.moonLight !== settings.moonLight) this.moon.setIntensity(settings.moonLight);
        if (!prev || prev.moonPhase !== settings.moonPhase) this.moon.setPhase(settings.moonPhase);
        if (!prev || prev.moonAngularDiameter !== settings.moonAngularDiameter) {
          this.moon.moon.setDiscAngularDiameter(degreesToRadians(settings.moonAngularDiameter));
        }
        this.moon.moon.setDiscIntensity(3);
      }
      syncStars(settings) {
        const enabled = settings.stars;
        if (enabled) this.starLook = settings;
        if (enabled === this.starsWanted && (!enabled || this.starsReady || this.starsPending)) {
          if (enabled && this.night) this.applyStarLook(settings);
          return;
        }
        this.starsWanted = enabled;
        this.starToken += 1;
        if (!enabled) {
          if (this.starsReady) this.sky.disableStars();
          this.starsReady = false;
          this.starsPending = false;
          this.night = null;
          return;
        }
        const token = this.starToken;
        this.starsPending = true;
        void this.sky.enableStars({
          intensity: settings.starIntensity,
          size: settings.starSize,
          milkyWay: settings.milkyWay
        }).then((night) => {
          if (token !== this.starToken) {
            this.sky.disableStars();
            this.starsReady = false;
            this.starsPending = false;
            this.night = null;
            return;
          }
          this.night = night;
          this.starsPending = false;
          this.starsReady = true;
          if (this.starLook) this.applyStarLook(this.starLook, true);
        }).catch((error) => {
          if (token === this.starToken) this.starsPending = false;
          console.warn("[sky] \u661F\u7A7A\u52A0\u8F7D\u5931\u8D25", error);
        });
      }
      applyStarLook(settings, force = false) {
        const night = this.night;
        if (!night) return;
        const prev = force ? null : this.applied;
        if (!prev || prev.starIntensity !== settings.starIntensity) night.setIntensity(settings.starIntensity);
        if (!prev || prev.starSize !== settings.starSize) night.setSize(settings.starSize);
        if (!prev || prev.milkyWay !== settings.milkyWay) night.setMilkyWay(settings.milkyWay);
        this.applyStarContrast(settings, prev);
      }
      /**
       * 星星按天空亮度淡出，和夜空示例一样。
       * 库的阈值按曝光 40 调过。这里曝光低得多，要按同样比例放大，否则白天也看得见。
       * 月面不要再乘太阳高度：那会在白天把月盘亮度写成 0。月亮跟着月相转到地平线以下时，本来就看不到。
       */
      applyCelestialFade(settings, prev) {
        this.applyStarContrast(settings, prev);
      }
      applyStarContrast(settings, prev) {
        const night = this.night;
        if (!night || prev && prev.exposure === settings.exposure) return;
        const scale = 40 / Math.max(settings.exposure, 0.05);
        night.setContrast(40 * scale);
        night.setMilkyWayContrast(20 * scale);
      }
    };
  }
});

// src/capabilities/sky/session.ts
var session_exports7 = {};
__export(session_exports7, {
  composeSkyFog: () => composeSkyFog,
  dispose: () => dispose7,
  mount: () => mount7,
  releaseSkyResources: () => releaseSkyResources,
  setSkyViewState: () => setSkyViewState,
  skyBlocksFrame: () => skyBlocksFrame,
  skyFogActive: () => skyFogActive,
  skyFogRevision: () => skyFogRevision,
  skyOwnsSceneSlots: () => skyOwnsSceneSlots
});
function skyOwnsSceneSlots() {
  return ownsSlots;
}
function skyBlocksFrame() {
  return compiling;
}
function skyFogActive() {
  return fogActive;
}
function skyFogRevision() {
  return fogRevision;
}
function composeSkyFog(colorNode, scenePass) {
  return fogApply ? fogApply(colorNode, scenePass) : colorNode;
}
function setSkyViewState(next) {
  ownsSlots = next.owns;
  const signature = next.signature ?? "";
  if (fogActive === next.fog && fogApply === next.apply && fogSignature === signature) return;
  fogActive = next.fog;
  fogApply = next.apply;
  fogSignature = signature;
  fogRevision += 1;
}
function releaseSkyResources() {
  bootToken += 1;
  booting2 = false;
  compiling = false;
  driver?.dispose();
  driver = null;
  setSkyViewState({ owns: false, fog: false, apply: null });
}
function mount7() {
  if (removeHook) return () => shutdown();
  removeHook = getRuntimeWorld().registerBeforeRenderHook?.("sky", 20, (ctx) => onBeforeRender2(ctx)) ?? null;
  return () => shutdown();
}
function dispose7() {
  shutdown();
}
function shutdown() {
  removeHook?.();
  removeHook = null;
  releaseSkyResources();
}
function onBeforeRender2(ctx) {
  pending2 = ctx;
  try {
    const runtime2 = getRuntimeWorld();
    if (!capabilityEnabled(runtime2.getCapabilities(), SKY_CAPABILITY_ID)) {
      if (driver || booting2 || compiling) releaseSkyResources();
      return;
    }
    const settings = normalizeSkySettings(runtime2.getPicture().capabilities?.[SKY_CAPABILITY_ID]);
    if (!driver) {
      ensure();
      return;
    }
    if (compiling) return;
    if (settings.haze && !driver.hazeReady()) {
      driver.dispose();
      driver = null;
      ensure();
      return;
    }
    driver.sync(settings, ctx.camera);
  } catch (error) {
    console.warn("[sky] \u5929\u7A7A\u66F4\u65B0\u5931\u8D25", error);
  } finally {
    restoreCanvas(ctx);
  }
}
function restoreCanvas(ctx) {
  try {
    ctx.renderer.setRenderTarget(null);
  } catch {
  }
}
function ensure() {
  if (booting2 || !pending2) return;
  booting2 = true;
  const token = ++bootToken;
  const ctx = pending2;
  void Promise.resolve().then(() => (init_runtime(), runtime_exports)).then((module) => {
    if (token !== bootToken) return;
    booting2 = false;
    const runtime2 = getRuntimeWorld();
    if (!capabilityEnabled(runtime2.getCapabilities(), SKY_CAPABILITY_ID) || !pending2) return;
    let created;
    try {
      created = module.createSkyDriver(ctx.renderer, ctx.scene);
    } catch (error) {
      console.warn("[sky] \u5929\u7A7A\u521B\u5EFA\u5931\u8D25", error);
      return;
    }
    driver = created;
    compiling = true;
    void created.compile().then(() => {
      if (token !== bootToken || driver !== created || !pending2) return;
      const latest = getRuntimeWorld();
      if (!capabilityEnabled(latest.getCapabilities(), SKY_CAPABILITY_ID)) return;
      created.sync(normalizeSkySettings(latest.getPicture().capabilities?.[SKY_CAPABILITY_ID]), pending2.camera);
    }).catch((error) => {
      console.warn("[sky] \u7740\u8272\u5668\u7F16\u8BD1\u5931\u8D25", error);
    }).finally(() => {
      if (token === bootToken) compiling = false;
    });
  }).catch((error) => {
    if (token === bootToken) booting2 = false;
    console.warn("[sky] \u5929\u7A7A\u52A0\u8F7D\u5931\u8D25", error);
  });
}
var ownsSlots, fogActive, fogApply, fogSignature, fogRevision, removeHook, driver, booting2, bootToken, pending2, compiling;
var init_session10 = __esm({
  "src/capabilities/sky/session.ts"() {
    "use strict";
    init_registry2();
    init_world();
    init_defaults4();
    ownsSlots = false;
    fogActive = false;
    fogApply = null;
    fogSignature = "";
    fogRevision = 0;
    removeHook = null;
    driver = null;
    booting2 = false;
    bootToken = 0;
    pending2 = null;
    compiling = false;
  }
});

// src/capabilities/registry.ts
function allCapabilityManifests() {
  return [...CAPABILITIES, ...dynamicCapabilities.values()];
}
function defaultCapabilities() {
  const base = Object.fromEntries(CAPABILITIES.map((item) => [item.id, item.defaultEnabled]));
  for (const item of dynamicCapabilities.values()) base[item.id] = item.defaultEnabled;
  return base;
}
function normalizeCapabilities(value) {
  const next = defaultCapabilities();
  if (!value || typeof value !== "object") return next;
  const record = value;
  for (const item of allCapabilityManifests()) {
    if (typeof record[item.id] === "boolean") next[item.id] = record[item.id];
  }
  return next;
}
function capabilityEnabled(capabilities, id) {
  const defaults = defaultCapabilities();
  if (!capabilities || typeof capabilities[id] !== "boolean") return defaults[id] ?? false;
  const manifest = allCapabilityManifests().find((item) => item.id === id);
  if (manifest?.dependencies) {
    for (const dep of manifest.dependencies) {
      if (!capabilityEnabled(capabilities, dep)) return false;
    }
  }
  return capabilities[id];
}
var CAPABILITIES, dynamicCapabilities;
var init_registry2 = __esm({
  "src/capabilities/registry.ts"() {
    "use strict";
    CAPABILITIES = [
      { id: "physics", defaultEnabled: true, category: "physics" },
      { id: "buoyancy", defaultEnabled: true, category: "physics", dependencies: ["physics"], loadRuntime: () => Promise.resolve().then(() => (init_session3(), session_exports2)) },
      { id: "navigation", defaultEnabled: true, category: "physics" },
      { id: "spline", defaultEnabled: true, category: "animation", loadRuntime: () => Promise.resolve().then(() => (init_session6(), session_exports3)) },
      { id: "tween", defaultEnabled: true, category: "animation", loadRuntime: () => Promise.resolve().then(() => (init_session7(), session_exports4)) },
      { id: "crowd", defaultEnabled: true, category: "physics", loadRuntime: () => Promise.resolve().then(() => (init_session8(), session_exports5)) },
      { id: "projectile", defaultEnabled: true, category: "physics", loadRuntime: () => Promise.resolve().then(() => (init_session9(), session_exports6)) },
      { id: "particles", defaultEnabled: false, category: "scene-object" },
      { id: "sky", defaultEnabled: false, category: "environment", loadRuntime: () => Promise.resolve().then(() => (init_session10(), session_exports7)) },
      { id: "water", defaultEnabled: false, category: "environment", loadRuntime: () => Promise.resolve().then(() => (init_session2(), session_exports)) }
    ];
    dynamicCapabilities = /* @__PURE__ */ new Map();
  }
});

// src/editor/assets/folders.ts
function normalizeDir(path) {
  const parts = path.split(/[\\/]+/).map((part) => part.trim()).filter((part) => part && part !== "." && part !== "..");
  if (parts[0] !== ASSETS_ROOT) parts.unshift(ASSETS_ROOT);
  return parts.join("/");
}
function parentDir(path) {
  const dir = normalizeDir(path);
  if (dir === ASSETS_ROOT) return null;
  const index = dir.lastIndexOf("/");
  return index < 0 ? ASSETS_ROOT : dir.slice(0, index);
}
function joinDir(parent, name) {
  return `${normalizeDir(parent)}/${name.trim()}`;
}
function isWithin(path, root) {
  const dir = normalizeDir(path);
  const base = normalizeDir(root);
  return dir === base || dir.startsWith(`${base}/`);
}
function relocateDir(path, from, to) {
  const dir = normalizeDir(path);
  const source = normalizeDir(from);
  const target = normalizeDir(to);
  if (dir === source) return target;
  if (dir.startsWith(`${source}/`)) return `${target}${dir.slice(source.length)}`;
  return dir;
}
function directoryTree(folders, assetDirs) {
  const root = { name: ASSETS_ROOT, path: ASSETS_ROOT, children: [] };
  const nodes = /* @__PURE__ */ new Map([[ASSETS_ROOT, root]]);
  const paths = /* @__PURE__ */ new Set([ASSETS_ROOT]);
  for (const folder of folders) paths.add(normalizeDir(folder));
  for (const dir of Object.values(assetDirs)) paths.add(normalizeDir(dir));
  for (const path of paths) {
    const parts = path.split("/");
    let current = parts[0] || ASSETS_ROOT;
    for (let index = 1; index < parts.length; index += 1) {
      const parent = current;
      current = `${current}/${parts[index]}`;
      if (nodes.has(current)) continue;
      const node = { name: parts[index] ?? current, path: current, children: [] };
      nodes.set(current, node);
      nodes.get(parent)?.children.push(node);
    }
  }
  const sort = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}
function findDir(node, path) {
  if (node.path === path) return node;
  for (const child of node.children) {
    const found = findDir(child, path);
    if (found) return found;
  }
  return null;
}
function directoryExists(path, folders, assetDirs) {
  const target = normalizeDir(path);
  if (target === ASSETS_ROOT) return true;
  return [...folders.map(normalizeDir), ...Object.values(assetDirs).map(normalizeDir)].some((dir) => dir === target || dir.startsWith(`${target}/`));
}
function uniqueFolderName(parent, folders, assetDirs) {
  const node = findDir(directoryTree(folders, assetDirs), normalizeDir(parent));
  const names = new Set(node?.children.map((child) => child.name) ?? []);
  let name = "\u65B0\u5EFA\u6587\u4EF6\u5939";
  let index = 2;
  while (names.has(name)) {
    name = `\u65B0\u5EFA\u6587\u4EF6\u5939 ${index}`;
    index += 1;
  }
  return name;
}
var ASSETS_ROOT;
var init_folders = __esm({
  "src/editor/assets/folders.ts"() {
    "use strict";
    ASSETS_ROOT = "Assets";
  }
});

// src/editor/assets/library.ts
import { create as create2 } from "zustand";
function assetDirectory(id, assetDirs) {
  return normalizeDir(assetDirs[id] ?? ASSETS_ROOT);
}
var useAssetStore;
var init_library = __esm({
  "src/editor/assets/library.ts"() {
    "use strict";
    init_folders();
    useAssetStore = create2((set, get) => ({
      assets: {},
      folders: [],
      assetDirs: {},
      browseDir: ASSETS_ROOT,
      expanded: { [ASSETS_ROOT]: true },
      revision: 0,
      add: (asset) => set((state) => ({ assets: { ...state.assets, [asset.id]: asset }, revision: state.revision + 1 })),
      addMany: (list) => set((state) => {
        if (list.length === 0) return {};
        const assets = { ...state.assets };
        for (const asset of list) assets[asset.id] = asset;
        return { assets, revision: state.revision + 1 };
      }),
      remove: (id) => set((state) => {
        const assets = { ...state.assets };
        const assetDirs = { ...state.assetDirs };
        delete assets[id];
        delete assetDirs[id];
        return { assets, assetDirs, revision: state.revision + 1 };
      }),
      rename: (id, name) => set((state) => {
        const asset = state.assets[id];
        if (!asset) return {};
        return { assets: { ...state.assets, [id]: { ...asset, name } }, revision: state.revision + 1 };
      }),
      patch: (id, patch) => set((state) => {
        const asset = state.assets[id];
        if (!asset || !("url" in asset)) return {};
        return { assets: { ...state.assets, [id]: { ...asset, ...patch } }, revision: state.revision + 1 };
      }),
      writeScene: (id, nodes, picture, editorView) => set((state) => {
        const asset = state.assets[id];
        if (!asset || asset.kind !== "scene") return {};
        const view = editorView === void 0 ? asset.editorView ?? null : editorView;
        if (JSON.stringify(asset.nodes) === JSON.stringify(nodes) && JSON.stringify(asset.picture) === JSON.stringify(picture) && JSON.stringify(asset.editorView ?? null) === JSON.stringify(view)) return {};
        return { assets: { ...state.assets, [id]: { ...asset, nodes, picture, editorView: view } }, revision: state.revision + 1 };
      }),
      updateMaterial: (id, slot) => set((state) => {
        const asset = state.assets[id];
        if (!asset || asset.kind !== "material") return {};
        return { assets: { ...state.assets, [id]: { ...asset, slot: { ...asset.slot, ...slot } } }, revision: state.revision + 1 };
      }),
      replaceMaterial: (id, slot) => set((state) => {
        const asset = state.assets[id];
        if (!asset || asset.kind !== "material") return {};
        if (JSON.stringify(asset.slot) === JSON.stringify(slot)) return {};
        return { assets: { ...state.assets, [id]: { ...asset, slot } }, revision: state.revision + 1 };
      }),
      updateEffect: (id, patch) => set((state) => {
        const asset = state.assets[id];
        if (!asset || asset.kind !== "effect") return {};
        return { assets: { ...state.assets, [id]: { ...asset, ...patch } }, revision: state.revision + 1 };
      }),
      updateUi: (id, document2) => set((state) => {
        const asset = state.assets[id];
        if (!asset || asset.kind !== "ui") return {};
        return { assets: { ...state.assets, [id]: { ...asset, document: document2 } }, revision: state.revision + 1 };
      }),
      bump: () => set((state) => ({ revision: state.revision + 1 })),
      loadCatalog: (folders, assetDirs) => set({
        folders: [...new Set(folders.map(normalizeDir).filter((path) => path !== ASSETS_ROOT))],
        assetDirs: Object.fromEntries(Object.entries(assetDirs).map(([id, dir]) => [id, normalizeDir(dir)]))
      }),
      loadSession: (assets, folders, assetDirs, browseDir, expanded) => set((state) => ({
        assets,
        folders: [...new Set(folders.map(normalizeDir).filter((path) => path !== ASSETS_ROOT))],
        assetDirs: Object.fromEntries(Object.entries(assetDirs).map(([id, dir]) => [id, normalizeDir(dir)])),
        browseDir: normalizeDir(browseDir || ASSETS_ROOT),
        expanded: expanded ?? { [ASSETS_ROOT]: true },
        revision: state.revision + 1
      })),
      setBrowseDir: (dir) => set({ browseDir: normalizeDir(dir) }),
      setExpanded: (expanded) => set({ expanded }),
      writePrefab: (id, rootId, nodes) => set((state) => {
        const asset = state.assets[id];
        if (!asset || asset.kind !== "prefab") return {};
        return {
          assets: { ...state.assets, [id]: { ...asset, rootId, nodes } },
          revision: state.revision + 1
        };
      }),
      place: (id, dir) => set((state) => ({
        assetDirs: { ...state.assetDirs, [id]: normalizeDir(dir ?? state.browseDir) },
        revision: state.revision + 1
      })),
      createFolder: (parent) => {
        const state = get();
        const base = normalizeDir(parent ?? state.browseDir);
        const path = joinDir(base, uniqueFolderName(base, state.folders, state.assetDirs));
        set({ folders: [...state.folders, path], browseDir: path, revision: state.revision + 1 });
        return path;
      },
      renameFolder: (path, name) => {
        const clean = name.trim().replace(/[\\/]/g, "");
        const source = normalizeDir(path);
        const parent = parentDir(source);
        if (!clean || !parent) return;
        const next = joinDir(parent, clean);
        if (next === source) return;
        const state = get();
        if (directoryExists(next, state.folders, state.assetDirs)) return;
        const expanded = {};
        for (const [dir, open] of Object.entries(state.expanded)) expanded[relocateDir(dir, source, next)] = open;
        set({
          folders: [...new Set(state.folders.map((folder) => relocateDir(folder, source, next)).filter((folder) => folder !== ASSETS_ROOT))],
          assetDirs: Object.fromEntries(Object.entries(state.assetDirs).map(([id, dir]) => [id, relocateDir(dir, source, next)])),
          browseDir: relocateDir(state.browseDir, source, next),
          expanded,
          revision: state.revision + 1
        });
      },
      deleteFolder: (path) => {
        const source = normalizeDir(path);
        const parent = parentDir(source);
        if (!parent) return;
        const state = get();
        const remains = Object.keys(state.assets).some((id) => isWithin(assetDirectory(id, state.assetDirs), source));
        if (remains) return;
        const expanded = { ...state.expanded };
        for (const dir of Object.keys(expanded)) {
          if (dir === source || dir.startsWith(`${source}/`)) delete expanded[dir];
        }
        set({
          folders: state.folders.filter((folder) => {
            const dir = normalizeDir(folder);
            return dir !== source && !dir.startsWith(`${source}/`);
          }),
          browseDir: isWithin(state.browseDir, source) ? parent : state.browseDir,
          expanded,
          revision: state.revision + 1
        });
      }
    }));
  }
});

// src/editor/scene/spawn.ts
function getSpawn() {
  return provider();
}
var provider;
var init_spawn = __esm({
  "src/editor/scene/spawn.ts"() {
    "use strict";
    provider = () => [0, 0, 0];
  }
});

// src/capabilities/physics/defaults.ts
function defaultNodePhysics(kind) {
  if (kind === "plane") {
    return { ...SHARED, body: "static", shape: "box", size: [1, 1, 0.05] };
  }
  if (kind === "sphere") {
    return { ...SHARED, body: "dynamic", shape: "sphere", size: [0.5, 0.5, 0.5] };
  }
  if (kind === "capsule") {
    return { ...SHARED, body: "dynamic", shape: "capsule", size: [0.3, 1.1, 0.3] };
  }
  if (kind === "cylinder") {
    return { ...SHARED, body: "dynamic", shape: "cylinder", size: [0.5, 1, 0.5] };
  }
  if (kind === "cone") {
    return { ...SHARED, body: "dynamic", shape: "cone", size: [0.5, 1, 0.5] };
  }
  if (kind === "model") {
    return { ...SHARED, body: "static", shape: "convex", size: [1, 1, 1] };
  }
  return { ...SHARED, body: "dynamic", shape: "box", size: [1, 1, 1] };
}
var SHARED;
var init_defaults5 = __esm({
  "src/capabilities/physics/defaults.ts"() {
    "use strict";
    SHARED = {
      trigger: false,
      mass: 1,
      friction: 0.7,
      restitution: 0.05,
      linearDamping: 0.1,
      angularDamping: 0.1,
      gravityScale: 1
    };
  }
});

// src/capabilities/particles/defaults.ts
function defaultNodeEffect() {
  return {
    assetId: null,
    quarksVersion: QUARKS_VERSION,
    simulation: structuredClone(DEFAULT_SIMULATION),
    materialAssetId: null,
    playing: true
  };
}
var QUARKS_VERSION, DEFAULT_SIMULATION;
var init_defaults6 = __esm({
  "src/capabilities/particles/defaults.ts"() {
    "use strict";
    QUARKS_VERSION = "0.17.1";
    DEFAULT_SIMULATION = {
      format: "system",
      body: {
        version: "3.0",
        autoDestroy: false,
        looping: true,
        prewarm: false,
        duration: 1.2,
        shape: { type: "cone", radius: 0.05, arc: 6.283185307179586, thickness: 1, angle: 0.35, mode: 0, spread: 0, speed: { type: "ConstantValue", value: 1 } },
        startLife: { type: "IntervalValue", a: 0.4, b: 0.9 },
        startSpeed: { type: "IntervalValue", a: 0.6, b: 1.8 },
        startRotation: { type: "ConstantValue", value: 0 },
        startSize: { type: "IntervalValue", a: 0.08, b: 0.22 },
        startColor: { type: "ConstantColor", color: { r: 1, g: 0.55, b: 0.15, a: 1 } },
        emissionOverTime: { type: "ConstantValue", value: 36 },
        emissionOverDistance: { type: "ConstantValue", value: 0 },
        emissionBursts: [],
        onlyUsedByOther: false,
        renderOrder: 0,
        renderMode: 0,
        rendererEmitterSettings: {},
        layers: 1,
        startTileIndex: { type: "ConstantValue", value: 0 },
        uTileCount: 1,
        vTileCount: 1,
        blendTiles: false,
        softParticles: false,
        softFarFade: 0,
        softNearFade: 0,
        behaviors: [
          {
            type: "ColorOverLife",
            color: {
              type: "Gradient",
              color: { type: "CLinearFunction", subType: "Color", keys: [{ value: { r: 1, g: 0.7, b: 0.2 }, pos: 0 }, { value: { r: 1, g: 0.2, b: 0 }, pos: 1 }] },
              alpha: { type: "CLinearFunction", subType: "Number", keys: [{ value: 1, pos: 0 }, { value: 0, pos: 1 }] }
            }
          },
          { type: "SizeOverLife", size: { type: "PiecewiseBezier", functions: [{ function: { p0: 0.4, p1: 0.7, p2: 1, p3: 0 }, start: 0 }] } }
        ],
        worldSpace: false
      }
    };
  }
});

// src/runtime/ui/spec.ts
function defaultNodeScreen() {
  return { documentId: null, layer: "hud", visibleOnPlay: true };
}
var init_spec = __esm({
  "src/runtime/ui/spec.ts"() {
    "use strict";
  }
});

// src/editor/scene/kinds.ts
function isMesh(kind) {
  return MESH_KINDS.includes(kind);
}
function defaultColor(kind) {
  switch (kind) {
    case "plane":
      return "#6c757e";
    case "directional-light":
      return "#fff4d6";
    case "point-light":
      return "#ffd2a8";
    case "spot-light":
      return "#ffffff";
    case "hemisphere-light":
      return "#d7e4f5";
    case "camera":
      return "#9ecbff";
    case "empty":
      return "#b0b0b0";
    case "screen":
      return "#4a9eff";
    case "spline":
      return "#34d399";
    default:
      return "#d5dde6";
  }
}
function defaultIntensity(kind) {
  switch (kind) {
    case "directional-light":
      return 3.2;
    case "point-light":
      return 24;
    case "spot-light":
      return 30;
    case "hemisphere-light":
      return 0.7;
    default:
      return 1;
  }
}
function restHeight(kind) {
  switch (kind) {
    case "box":
    case "sphere":
    case "cylinder":
    case "cone":
      return 0.5;
    case "capsule":
      return 0.55;
    case "camera":
      return 1.5;
    case "model":
    case "plane":
    case "empty":
    case "spline":
      return 0;
    case "effect":
    case "screen":
      return 1;
    default:
      return 2;
  }
}
function makeNode(partial) {
  const kind = partial.kind;
  return {
    parentId: null,
    order: 0,
    visible: true,
    locked: false,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: defaultColor(kind),
    intensity: defaultIntensity(kind),
    fov: 50,
    spotAngle: 32,
    assetId: null,
    clip: "",
    clipAssetId: null,
    clipTime: 0,
    clipPlaying: false,
    clipLoop: true,
    clipEnd: "hold",
    clipSpeed: 1,
    clipFade: 0.15,
    clipInPlace: false,
    clipMask: "full",
    animator: null,
    metalness: kind === "plane" ? 0 : 0.04,
    roughness: kind === "plane" ? 0.92 : 0.58,
    emissive: "#000000",
    emissiveIntensity: 0,
    opacity: 1,
    ao: 1,
    mapAssetId: null,
    normalAssetId: null,
    metallicRoughnessAssetId: null,
    emissiveAssetId: null,
    aoAssetId: null,
    materialAssetId: null,
    shader: "lit",
    normalScale: 1,
    alphaMode: "opaque",
    alphaCutoff: 0.5,
    cull: "back",
    depthWrite: true,
    wireframe: false,
    effect: kind === "effect" ? defaultNodeEffect() : null,
    screen: kind === "screen" ? defaultNodeScreen() : null,
    capabilities: kind === "spline" ? { [SPLINE_PATH_CAPABILITY_ID]: defaultSplinePath(), ...partial.capabilities ?? {} } : partial.capabilities,
    slots: [],
    castShadow: kind === "directional-light" || kind === "spot-light" || (isMesh(kind) || kind === "model") && kind !== "plane",
    receiveShadow: isMesh(kind) || kind === "model",
    shadowBias: kind === "directional-light" ? -2e-4 : 5e-4,
    shadowNormalBias: 0.02,
    range: kind === "spot-light" ? 40 : 12,
    decay: 2,
    penumbra: 0.15,
    groundColor: "#2c261f",
    near: 0.1,
    far: kind === "camera" ? 200 : 40,
    ...partial
  };
}
function childrenOf(nodes, parentId) {
  return Object.values(nodes).filter((node) => node.parentId === parentId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}
function nextOrder(nodes, parentId, exceptId) {
  let max4 = 0;
  for (const node of Object.values(nodes)) {
    if (node.id === exceptId || node.parentId !== parentId) continue;
    if (node.order >= max4) max4 = node.order + 1;
  }
  return max4;
}
function uniqueName(nodes, base) {
  const names = new Set(Object.values(nodes).map((node) => node.name));
  const stripped = base.replace(/ \d+$/, "");
  if (!names.has(stripped)) return stripped;
  let index = 2;
  while (names.has(`${stripped} ${index}`)) index += 1;
  return `${stripped} ${index}`;
}
function subtreeIds(nodes, rootId) {
  const out = [];
  const walk = (id) => {
    out.push(id);
    for (const child of childrenOf(nodes, id)) walk(child.id);
  };
  if (nodes[rootId]) walk(rootId);
  return out;
}
function spawnPosition(kind, parentId, spawn2) {
  if (parentId) return [0, restHeight(kind), 0];
  return [spawn2[0], restHeight(kind), spawn2[2]];
}
var MESH_KINDS;
var init_kinds = __esm({
  "src/editor/scene/kinds.ts"() {
    "use strict";
    init_defaults6();
    init_schema();
    init_spec();
    MESH_KINDS = ["box", "sphere", "plane", "capsule", "cylinder", "cone"];
  }
});

// src/editor/scene/types.ts
function toneMapOf(value) {
  return typeof value === "string" && TONE_MAPS.includes(value) ? value : "aces";
}
function normalizePicture(picture) {
  const gravity = picture?.gravity;
  const legacyAudio = picture?.capabilities && typeof picture.capabilities === "object" ? picture.capabilities.audio : void 0;
  const capabilities = picture?.capabilities && typeof picture.capabilities === "object" ? { ...picture.capabilities } : void 0;
  if (capabilities) delete capabilities.audio;
  return {
    ...DEFAULT_PICTURE,
    ...picture,
    toneMapping: toneMapOf(picture?.toneMapping),
    ssgiDenoise: picture?.ssgiDenoise === true,
    gravity: gravity?.length === 3 ? gravity : DEFAULT_PICTURE.gravity,
    audio: { ...DEFAULT_PICTURE_AUDIO, ...pictureAudio(picture?.audio), ...pictureAudio(legacyAudio) },
    navigation: { ...DEFAULT_NAV, ...picture?.navigation },
    ...capabilities && Object.keys(capabilities).length > 0 ? { capabilities } : {}
  };
}
function pictureAudio(value) {
  if (!value || typeof value !== "object") return {};
  const row = value;
  const next = {};
  if (typeof row.master === "number") next.master = row.master;
  if (typeof row.music === "number") next.music = row.music;
  if (typeof row.sfx === "number") next.sfx = row.sfx;
  return next;
}
function normalizeEditorView(value) {
  if (!value || typeof value !== "object") return null;
  const view = value;
  if (!view.view || !EDITOR_VIEWS.includes(view.view)) return null;
  if (!view.pivot || view.pivot.length !== 3) return null;
  if (typeof view.orbitDistance !== "number" || typeof view.yaw !== "number" || typeof view.pitch !== "number" || typeof view.orthoSize !== "number") return null;
  return {
    view: view.view,
    pivot: [view.pivot[0], view.pivot[1], view.pivot[2]],
    orbitDistance: view.orbitDistance,
    yaw: view.yaw,
    pitch: view.pitch,
    orthoSize: view.orthoSize
  };
}
var DEFAULT_NAV, TONE_MAPS, DEFAULT_PICTURE_AUDIO, DEFAULT_PICTURE, EDITOR_VIEWS;
var init_types2 = __esm({
  "src/editor/scene/types.ts"() {
    "use strict";
    DEFAULT_NAV = {
      cellSize: 0.2,
      cellHeight: 0.2,
      walkableSlopeAngle: 45,
      agentRadius: 0.35,
      agentHeight: 1.8,
      maxObstacles: 32
    };
    TONE_MAPS = ["none", "linear", "reinhard", "cineon", "aces", "agx", "neutral"];
    DEFAULT_PICTURE_AUDIO = { master: 1, music: 0.8, sfx: 1 };
    DEFAULT_PICTURE = {
      background: "#141414",
      exposure: 1.05,
      toneMapping: "aces",
      fog: false,
      fogColor: "#141414",
      fogNear: 12,
      fogFar: 80,
      bloom: false,
      bloomStrength: 0.35,
      bloomRadius: 0.4,
      bloomThreshold: 0.85,
      ssr: false,
      ssrQuality: 0.5,
      ssrDistance: 5,
      ssrThickness: 0.05,
      ssrIntensity: 1,
      ssgi: false,
      ssgiSlices: 2,
      ssgiSteps: 8,
      ssgiRadius: 8,
      ssgiIntensity: 4,
      ssgiOcclusion: 1,
      ssgiDenoise: false,
      volume: false,
      volumeDensity: 0.25,
      volumeSteps: 24,
      volumeSize: 40,
      volumeHeight: 16,
      volumeColor: "#d7e6ff",
      aa: true,
      ao: false,
      dof: false,
      dofFocus: 8,
      dofFocal: 2,
      dofBokeh: 2,
      hue: 0,
      saturation: 1,
      envAssetId: null,
      gravity: [0, -9.81, 0],
      audio: { ...DEFAULT_PICTURE_AUDIO },
      navigation: { ...DEFAULT_NAV }
    };
    EDITOR_VIEWS = ["persp", "top", "bottom", "front", "back", "left", "right"];
  }
});

// src/editor/scene/seed.ts
import { Euler as Euler2, Quaternion as Quaternion5, Vector3 as Vector39 } from "three";
function aimDownY(from, to) {
  const direction = to.clone().sub(from).normalize();
  const quaternion = new Quaternion5().setFromUnitVectors(new Vector39(0, -1, 0), direction);
  const euler = new Euler2().setFromQuaternion(quaternion, "XYZ");
  return [euler.x * 180 / Math.PI, euler.y * 180 / Math.PI, euler.z * 180 / Math.PI];
}
function createSeed() {
  const sunPosition = [6, 10, 5];
  const nodes = {
    "seed-sun": makeNode({
      id: "seed-sun",
      name: "\u65B9\u5411\u5149",
      kind: "directional-light",
      order: 0,
      position: sunPosition,
      rotation: aimDownY(new Vector39(...sunPosition), new Vector39(0, 0.5, 0))
    }),
    "seed-sky": makeNode({
      id: "seed-sky",
      name: "\u73AF\u5883\u5149",
      kind: "hemisphere-light",
      order: 1,
      position: [-5, 3, -4]
    }),
    "seed-ground": makeNode({
      id: "seed-ground",
      name: "\u5730\u9762",
      kind: "plane",
      order: 2,
      position: [0, 0, 0],
      rotation: [-90, 0, 0],
      scale: [40, 40, 1],
      physics: defaultNodePhysics("plane")
    }),
    "seed-cube": makeNode({
      id: "seed-cube",
      name: "\u65B9\u5757",
      kind: "box",
      order: 3,
      position: [0, 0.5, 0]
    })
  };
  return { nodes, selectedId: "seed-cube" };
}
function createFreshScene(name) {
  const seed2 = createSeed();
  const map = /* @__PURE__ */ new Map();
  for (const id of Object.keys(seed2.nodes)) map.set(id, crypto.randomUUID());
  const nodes = {};
  for (const node of Object.values(seed2.nodes)) {
    const copy = structuredClone(node);
    copy.id = map.get(node.id) ?? copy.id;
    copy.parentId = node.parentId ? map.get(node.parentId) ?? null : null;
    nodes[copy.id] = copy;
  }
  return {
    id: crypto.randomUUID(),
    name,
    nodes,
    picture: structuredClone(DEFAULT_PICTURE),
    selectedId: map.get(seed2.selectedId) ?? Object.keys(nodes)[0]
  };
}
var init_seed = __esm({
  "src/editor/scene/seed.ts"() {
    "use strict";
    init_defaults5();
    init_kinds();
    init_types2();
  }
});

// src/editor/project/electronBridge.ts
var init_electronBridge = __esm({
  "src/editor/project/electronBridge.ts"() {
    "use strict";
  }
});

// src/editor/project/disk.ts
import { create as create3 } from "zustand";
function emptyIndex() {
  return { schemaVersion: CACHE_INDEX_VERSION, generatedAt: Date.now(), artifacts: {} };
}
var CACHE_ROOT, IMPORT_ARTIFACTS, TEXTURE_ARTIFACTS, TEXTURE_ORIGINALS, CACHE_INDEX_PATH, CACHE_INDEX_VERSION, useProjectDirectory, cacheIndex, ioChain;
var init_disk = __esm({
  "src/editor/project/disk.ts"() {
    "use strict";
    init_folders();
    init_electronBridge();
    CACHE_ROOT = ".cache/t3d";
    IMPORT_ARTIFACTS = `${CACHE_ROOT}/import-artifacts`;
    TEXTURE_ARTIFACTS = `${CACHE_ROOT}/texture-artifacts`;
    TEXTURE_ORIGINALS = `${CACHE_ROOT}/texture-originals`;
    CACHE_INDEX_PATH = `${CACHE_ROOT}/editor-library/v1/cache-index.json`;
    CACHE_INDEX_VERSION = 1;
    useProjectDirectory = create3(() => ({
      active: false,
      name: "",
      epoch: 0
    }));
    cacheIndex = emptyIndex();
    ioChain = Promise.resolve();
  }
});

// src/runtime/audio.ts
import { Audio, AudioListener, PositionalAudio } from "three";
function readAudioMix(picture) {
  return {
    master: unit(picture.audio?.master, DEFAULT_MIX.master),
    music: unit(picture.audio?.music, DEFAULT_MIX.music),
    sfx: unit(picture.audio?.sfx, DEFAULT_MIX.sfx)
  };
}
function unlockAudio() {
  if (holdContext) return;
  const ctx = ensureListener().context;
  if (ctx.state === "suspended") void ctx.resume();
}
function playSound(options) {
  installUnlock();
  const id = nextId++;
  const ticket = playTicket;
  const ear = ensureListener();
  const run = () => {
    void start(id, options, ticket);
  };
  if (ear.context.state === "suspended" && !holdContext) void ear.context.resume().then(run);
  else run();
  return id;
}
function stopMusic() {
  const voice = voices.find((item) => item.id === musicId);
  if (voice) fadeStop(voice);
  musicId = 0;
}
function stopAllSounds() {
  playTicket += 1;
  for (const voice of [...voices]) stopVoice(voice);
  musicId = 0;
  emitters.clear();
  managed.clear();
}
function ownsEmitter(id) {
  for (const current of emitters.values()) if (current.voice === id) return true;
  return false;
}
function guardAudioMatrixUpdate(node) {
  const original = node.updateMatrixWorld.bind(node);
  node.updateMatrixWorld = function safeAudioUpdateMatrixWorld(force) {
    Object.getPrototypeOf(Object.getPrototypeOf(node)).updateMatrixWorld.call(node, force);
    const now = node.context?.currentTime;
    if (typeof now !== "number" || !Number.isFinite(now)) return;
    const elements = node.matrixWorld.elements;
    for (let i = 0; i < elements.length; i += 1) {
      if (!Number.isFinite(elements[i])) return;
    }
    try {
      original(force);
    } catch {
    }
  };
  return node;
}
function ensureListener() {
  if (!listener) {
    listener = guardAudioMatrixUpdate(new AudioListener());
    listener.gain.gain.value = 1;
  }
  return listener;
}
function installUnlock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const once = () => unlockAudio();
  window.addEventListener("pointerdown", once, { capture: true });
  window.addEventListener("keydown", once, { capture: true });
}
async function start(id, options, ticket) {
  const assetId = options.assetId.trim();
  if (!assetId) return;
  const world3 = getRuntimeWorld();
  const asset = world3.getAsset(assetId);
  if (!asset || asset.kind !== "audio") return;
  const buffer = await bufferFor(assetId, "hash" in asset && typeof asset.hash === "string" ? asset.hash : assetId);
  if (!buffer) return;
  if (managed.has(id) && (ticket !== playTicket || !ownsEmitter(id))) {
    managed.delete(id);
    return;
  }
  if (managed.has(id) && options.parent && !options.parent.parent) {
    emitters.forEach((current, nodeId) => {
      if (current.voice === id) emitters.delete(nodeId);
    });
    managed.delete(id);
    return;
  }
  const latestWorld = getRuntimeWorld();
  if (options.bus === "music" && latestWorld.getPlayState() !== "playing") return;
  const mix6 = readAudioMix(latestWorld.getPicture());
  applyMix(mix6);
  const bus = options.bus ?? "sfx";
  if (bus === "sfx") trimSfx();
  const ear = ensureListener();
  const audio = options.parent ? guardAudioMatrixUpdate(new PositionalAudio(ear)) : new Audio(ear);
  audio.setBuffer(buffer);
  audio.setLoop(options.loop === true);
  const local = clamp4(options.volume ?? 1, 0, 4);
  audio.setVolume(local * (bus === "music" ? mix6.music : mix6.sfx));
  if (options.playbackRate && options.playbackRate > 0) audio.setPlaybackRate(options.playbackRate);
  if (audio instanceof PositionalAudio && options.parent) {
    audio.setRefDistance(Math.max(0.05, options.refDistance ?? 2));
    audio.setRolloffFactor(Math.max(0, options.rolloff ?? 1));
    audio.setDistanceModel("inverse");
    options.parent.add(audio);
  }
  const voice = { id, audio, parent: options.parent ?? null, loop: options.loop === true, bus, local };
  voices.push(voice);
  if (bus === "music") {
    const previous = voices.find((item) => item.id === musicId && item.id !== id);
    if (previous) fadeStop(previous);
    musicId = id;
  }
  audio.play();
  const source = audio.source;
  if (!voice.loop && source) source.onended = () => stopVoice(voice);
}
async function bufferFor(assetId, hash) {
  const key = hash || assetId;
  let pending3 = buffers.get(key);
  if (!pending3) {
    pending3 = (async () => {
      const world3 = getRuntimeWorld();
      const url = await world3.resolveAssetUrl?.(assetId) ?? world3.getAsset(assetId)?.url ?? "";
      if (!url) return null;
      const response = await fetch(url);
      const data = await response.arrayBuffer();
      return ensureListener().context.decodeAudioData(data.slice(0));
    })().catch((error) => {
      buffers.delete(key);
      console.warn("[audio] \u89E3\u7801\u5931\u8D25", error);
      return null;
    });
    buffers.set(key, pending3);
  }
  const buffer = await pending3;
  return buffer && buffer.duration > 0 ? buffer : null;
}
function trimSfx() {
  const live = voices.filter((item) => item.bus === "sfx" && !item.loop && !managed.has(item.id));
  while (live.length >= MAX_SFX) {
    const oldest = live.shift();
    if (oldest) stopVoice(oldest);
  }
}
function fadeStop(voice) {
  try {
    const gain = voice.audio.getOutput().gain;
    const now = voice.audio.context.currentTime;
    if (!Number.isFinite(now) || !Number.isFinite(gain.value)) {
      stopVoice(voice);
      return;
    }
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + 0.35);
  } catch {
    stopVoice(voice);
    return;
  }
  window.setTimeout(() => stopVoice(voice), 400);
}
function stopVoice(voice) {
  const index = voices.indexOf(voice);
  if (index >= 0) voices.splice(index, 1);
  if (musicId === voice.id) musicId = 0;
  try {
    if (voice.audio.isPlaying) voice.audio.stop();
  } catch {
  }
  voice.parent?.remove(voice.audio);
  voice.audio.disconnect();
}
function applyMix(mix6) {
  const key = `${mix6.master}|${mix6.music}|${mix6.sfx}`;
  if (key === appliedMix) return;
  appliedMix = key;
  const ear = listener;
  if (ear) ear.gain.gain.value = mix6.master;
  for (const voice of voices) {
    voice.audio.setVolume(voice.local * (voice.bus === "music" ? mix6.music : mix6.sfx));
  }
}
function unit(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? clamp4(number, 0, 1) : fallback;
}
function clamp4(value, min3, max4) {
  return Math.min(max4, Math.max(min3, value));
}
function settleContext(paused) {
  const ctx = listener?.context;
  if (!ctx) return;
  contextChain = contextChain.then(async () => {
    if (paused !== holdContext) return;
    if (paused && ctx.state === "running") await ctx.suspend();
    if (!paused && ctx.state === "suspended") await ctx.resume();
  }).catch(() => void 0);
}
var MAX_SFX, buffers, listener, voices, nextId, musicId, heardPlay, installed, DEFAULT_MIX, emitters, managed, playTicket, holdContext, appliedMix, contextChain;
var init_audio = __esm({
  "src/runtime/audio.ts"() {
    "use strict";
    init_sceneRuntime();
    init_world();
    MAX_SFX = 32;
    buffers = /* @__PURE__ */ new Map();
    listener = null;
    voices = [];
    nextId = 1;
    musicId = 0;
    heardPlay = false;
    installed = false;
    DEFAULT_MIX = { master: 1, music: 0.8, sfx: 1 };
    emitters = /* @__PURE__ */ new Map();
    managed = /* @__PURE__ */ new Set();
    playTicket = 0;
    holdContext = false;
    appliedMix = "";
    contextChain = Promise.resolve();
    registerRuntimeSystem("core.audio", 44, () => {
      const world3 = getRuntimeWorld();
      applyMix(readAudioMix(world3.getPicture()));
      const playState = world3.getPlayState();
      if (playState === "paused") {
        heardPlay = true;
        if (!holdContext) {
          holdContext = true;
          settleContext(true);
        }
        return;
      }
      if (holdContext) {
        holdContext = false;
        settleContext(false);
      }
      if (playState === "playing") {
        heardPlay = true;
        return;
      }
      if (!heardPlay) return;
      heardPlay = false;
      stopAllSounds();
    });
    installUnlock();
  }
});

// src/runtime/ui/bindings.ts
function coerceUiValue(raw) {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text !== "" && Number.isFinite(Number(text))) return Number(text);
  return raw;
}
var EMPTY_UI_VALUES;
var init_bindings = __esm({
  "src/runtime/ui/bindings.ts"() {
    "use strict";
    EMPTY_UI_VALUES = { variables: {}, components: {}, screens: {} };
  }
});

// src/runtime/ui/values.ts
function publish() {
  snapshot = {
    variables: { ...variables },
    components: Object.fromEntries(Object.entries(components).map(([id, fields]) => [id, { ...fields }])),
    screens: { ...screens }
  };
  for (const listener2 of listeners) listener2();
}
function uiValues() {
  return snapshot;
}
function writeUiVariable(varId, value) {
  variables = { ...variables, [varId]: value };
  publish();
}
function setScreenVisible(nodeId, visible) {
  screens = { ...screens, [nodeId]: visible };
  publish();
}
function resetUiValues() {
  variables = {};
  components = {};
  screens = {};
  publish();
}
function onUiClick(listener2) {
  clickListeners.add(listener2);
  return () => clickListeners.delete(listener2);
}
function dispatchUiClick(action, nodeId) {
  if (action.kind === "setVariable") writeUiVariable(action.varId, coerceUiValue(action.value));
  for (const listener2 of clickListeners) listener2(action, nodeId);
}
var variables, components, screens, snapshot, listeners, clickListeners;
var init_values = __esm({
  "src/runtime/ui/values.ts"() {
    "use strict";
    init_bindings();
    variables = {};
    components = {};
    screens = {};
    snapshot = EMPTY_UI_VALUES;
    listeners = /* @__PURE__ */ new Set();
    clickListeners = /* @__PURE__ */ new Set();
  }
});

// src/core/codeAssets/compiler.ts
import ts from "typescript";
var init_compiler = __esm({
  "src/core/codeAssets/compiler.ts"() {
    "use strict";
  }
});

// src/core/codeAssets/scriptRuntime.ts
import { Vector3 as Vector310 } from "three";
function ensureUiClickBridge() {
  if (uiClickSubscribed) return;
  uiClickSubscribed = true;
  onUiClick((action, uiNodeId) => {
    if (getRuntimeWorld().getPlayState() !== "playing") return;
    if (action.kind === "sendMessage" && action.message) {
      const payload = { nodeId: uiNodeId, kind: action.kind };
      uiEventQueue.push({
        eventName: action.message,
        payload
      });
      messageQueue.push({
        targetNodeId: null,
        name: action.message,
        payload
      });
    } else if (action.kind === "setVariable" && action.varId) {
      uiEventQueue.push({
        eventName: `var:${action.varId}`,
        payload: { nodeId: uiNodeId, kind: action.kind, varId: action.varId, value: action.value }
      });
    }
  });
}
function resolveScreenNodeId(screenIdOrName) {
  const nodes = getRuntimeWorld().getNodes();
  if (nodes[screenIdOrName]?.kind === "screen") return screenIdOrName;
  const hit = Object.values(nodes).find((n) => n.kind === "screen" && n.name === screenIdOrName);
  return hit ? hit.id : null;
}
function mouseButtonMask(button) {
  if (button === 0) return 1;
  if (button === 1) return 4;
  if (button === 2) return 2;
  return 0;
}
function instanceKey2(nodeId, scriptId) {
  return `${nodeId}::${scriptId}`;
}
function resolveVec3Input(target) {
  if (!target || typeof target !== "object") return null;
  const rec = target;
  if (typeof rec.x === "number" && typeof rec.y === "number" && typeof rec.z === "number") {
    return { x: rec.x, y: rec.y, z: rec.z };
  }
  if (rec.position && typeof rec.position === "object") {
    const pos = rec.position;
    if (typeof pos.x === "number" && typeof pos.y === "number" && typeof pos.z === "number") {
      return { x: pos.x, y: pos.y, z: pos.z };
    }
  }
  return null;
}
function toVec3Obj(tuple) {
  return { x: tuple[0], y: tuple[1], z: tuple[2] };
}
function makeNodeHandle(nodeId, host) {
  const world3 = getRuntimeWorld();
  const node = world3.getNodes()[nodeId];
  if (!node) return null;
  const obj = host.resolveObject(nodeId);
  const collectTags = () => {
    const out = [];
    if (node.tagId && !out.includes(node.tagId)) out.push(node.tagId);
    if (Array.isArray(node.tagIds)) {
      for (const t of node.tagIds) {
        if (t && !out.includes(t)) out.push(t);
      }
    }
    for (const rt of listRuntimeTags(node.id)) {
      if (rt.tag && !out.includes(rt.tag)) out.push(rt.tag);
    }
    return out;
  };
  return {
    get id() {
      return node.id;
    },
    get name() {
      return node.name;
    },
    get tags() {
      return collectTags();
    },
    get parent() {
      return node.parentId ? makeNodeHandle(node.parentId, host) : null;
    },
    get position() {
      return obj ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : toVec3Obj(node.position);
    },
    set position(val) {
      if (obj) obj.position.set(val.x, val.y, val.z);
      node.position[0] = val.x;
      node.position[1] = val.y;
      node.position[2] = val.z;
    },
    get rotation() {
      return obj ? { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z } : {
        x: node.rotation[0] * Math.PI / 180,
        y: node.rotation[1] * Math.PI / 180,
        z: node.rotation[2] * Math.PI / 180
      };
    },
    set rotation(val) {
      if (obj) obj.rotation.set(val.x, val.y, val.z);
      node.rotation[0] = val.x * 180 / Math.PI;
      node.rotation[1] = val.y * 180 / Math.PI;
      node.rotation[2] = val.z * 180 / Math.PI;
    },
    get scale() {
      return obj ? { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z } : toVec3Obj(node.scale);
    },
    set scale(val) {
      if (obj) obj.scale.set(val.x, val.y, val.z);
      node.scale[0] = val.x;
      node.scale[1] = val.y;
      node.scale[2] = val.z;
    },
    get visible() {
      if (pooledInactive.has(nodeId)) return false;
      return obj ? obj.visible : node.visible;
    },
    set visible(val) {
      if (obj) obj.visible = val;
      node.visible = val;
      if (!nodePoolKey.has(nodeId)) {
        world3.updateNode(nodeId, { visible: val });
      }
    },
    hasTag: (tag) => nodeHasTag(node, String(tag ?? "")),
    addTag: (tag) => {
      const t = String(tag ?? "").trim();
      if (!t) return;
      const list = Array.isArray(node.tagIds) ? [...node.tagIds] : [];
      if (!list.includes(t)) {
        list.push(t);
        node.tagIds = list;
      }
    },
    removeTag: (tag) => {
      const t = String(tag ?? "").trim();
      if (!t) return;
      if (node.tagId === t) node.tagId = void 0;
      if (Array.isArray(node.tagIds)) {
        node.tagIds = node.tagIds.filter((x) => x !== t);
      }
    },
    getChildren: () => {
      const all = world3.getNodes();
      return Object.values(all).filter((c) => c.parentId === node.id && !isNodePooledInactive(c.id, all)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((c) => makeNodeHandle(c.id, host)).filter(Boolean);
    },
    sendMessage: (name, payload) => {
      messageQueue.push({ targetNodeId: nodeId, name, payload });
    },
    getBehavior: (behavior) => {
      const targetEntry = Object.entries(node.gameplay?.packs?.__project__ ?? {}).find(
        ([sid2]) => compiledBehaviors.get(sid2) === behavior || compiledBehaviors.get(sid2)?.name === behavior?.name
      );
      if (!targetEntry) return null;
      const [sid, rawParams] = targetEntry;
      const rec = instanceStates.get(instanceKey2(nodeId, sid));
      if (!rec) return null;
      const ctx = buildScriptContext(node, sid, rawParams, rec.state, host);
      const wrapped = {};
      for (const [mName, fn] of Object.entries(behavior.methods ?? {})) {
        wrapped[mName] = (...args) => fn(ctx, ...args);
      }
      return wrapped;
    },
    destroy: () => {
      destroyOrReleaseNode(nodeId, host);
    }
  };
}
function cancelTimersForNode(nodeId) {
  for (const [tid, t] of scriptTimers.entries()) {
    if (t.nodeId === nodeId) scriptTimers.delete(tid);
  }
  splineFollowAgents.delete(nodeId);
  for (const [twId, tw] of activeTweens.entries()) {
    if (tw.ownerNodeId === nodeId) activeTweens.delete(twId);
  }
}
function resolveSplinePointsInput(input, host) {
  const world3 = getRuntimeWorld();
  const nodes = world3.getNodes();
  if (Array.isArray(input)) {
    const pts = [];
    for (const item of input) {
      const v = resolveVec3Input(item);
      if (v) pts.push(v);
    }
    return { points: pts };
  }
  const parentNode = resolveTemplateNode(input, nodes);
  if (!parentNode) return { points: [] };
  const rawSplinePath = parentNode.capabilities?.splinePath;
  if (parentNode.kind === "spline" || rawSplinePath) {
    const pathObj = host.resolveObject(parentNode.id);
    if (pathObj) pathObj.updateMatrixWorld();
    const rawPts = Array.isArray(rawSplinePath?.points) ? rawSplinePath.points : [];
    const pts = [];
    for (const p of rawPts) {
      if (!Array.isArray(p) || p.length < 3) continue;
      const lx = Number(p[0]) || 0;
      const ly = Number(p[1]) || 0;
      const lz = Number(p[2]) || 0;
      if (pathObj) {
        const v = new Vector310(lx, ly, lz).applyMatrix4(pathObj.matrixWorld);
        pts.push({ x: v.x, y: v.y, z: v.z });
      } else {
        pts.push({
          x: parentNode.position[0] + lx,
          y: parentNode.position[1] + ly,
          z: parentNode.position[2] + lz
        });
      }
    }
    return {
      points: pts,
      closed: typeof rawSplinePath?.closed === "boolean" ? rawSplinePath.closed : void 0,
      tension: typeof rawSplinePath?.tension === "number" ? rawSplinePath.tension : void 0
    };
  }
  const children = Object.values(nodes).filter((n) => n.parentId === parentNode.id && !isNodePooledInactive(n.id, nodes)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const targets = children.length > 0 ? children : [parentNode];
  return {
    points: targets.map((n) => {
      const obj = host.resolveObject(n.id);
      return obj ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : toVec3Obj(n.position);
    })
  };
}
function buildCurveApi() {
  return {
    create: (keys, options) => createAnimationCurve(keys, options),
    eval: (keys, t, options) => createAnimationCurve(keys, options).eval(t),
    ease: (name, t) => evalEasing(name, t),
    parabola: (t, height = 1) => {
      const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
      return 4 * u * (1 - u) * height;
    },
    pulse: (t) => {
      const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
      return Math.sin(u * Math.PI);
    }
  };
}
function isNodePooledInactive(nodeId, nodes) {
  let cur = nodeId;
  let guard = 0;
  while (cur && guard < 16) {
    if (pooledInactive.has(cur)) return true;
    cur = nodes[cur]?.parentId ?? null;
    guard += 1;
  }
  return false;
}
function resolveTemplateNode(templateOrName, nodes) {
  if (!templateOrName) return null;
  if (typeof templateOrName === "object" && typeof templateOrName.id === "string") {
    return nodes[templateOrName.id] ?? null;
  }
  if (typeof templateOrName === "string") {
    const key = templateOrName.trim();
    if (!key) return null;
    if (nodes[key]) return nodes[key];
    return Object.values(nodes).find((n) => n.name === key) ?? null;
  }
  return null;
}
function cloneSceneSubtree(templateNode, options, host) {
  const world3 = getRuntimeWorld();
  const allNodes = world3.getNodes();
  const clonedMap = {};
  const idMap = /* @__PURE__ */ new Map();
  const collect = (srcId) => {
    const src = allNodes[srcId];
    if (!src) return;
    const nextId2 = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `rt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    idMap.set(srcId, nextId2);
    for (const child of Object.values(allNodes)) {
      if (child.parentId === srcId) collect(child.id);
    }
  };
  collect(templateNode.id);
  if (idMap.size === 0) return null;
  const rootNewId = idMap.get(templateNode.id);
  const parentOpt = options?.parent;
  const resolvedParentId = parentOpt === void 0 ? templateNode.parentId : parentOpt === null ? null : typeof parentOpt === "string" ? allNodes[parentOpt]?.id ?? Object.values(allNodes).find((n) => n.name === parentOpt)?.id ?? null : parentOpt.id ?? null;
  for (const [oldId, newId] of idMap.entries()) {
    const src = allNodes[oldId];
    const copy = structuredClone(src);
    copy.id = newId;
    if (oldId === templateNode.id) {
      copy.parentId = resolvedParentId;
      copy.visible = options?.visible !== void 0 ? options.visible : true;
      if (options?.name) copy.name = options.name;
      else copy.name = `${src.name}_${newId.slice(0, 4)}`;
      const posVec = resolveVec3Input(options?.position);
      if (posVec) copy.position = [posVec.x, posVec.y, posVec.z];
      const rotVec = resolveVec3Input(options?.rotation);
      if (rotVec) {
        copy.rotation = [
          rotVec.x * 180 / Math.PI,
          rotVec.y * 180 / Math.PI,
          rotVec.z * 180 / Math.PI
        ];
      }
      const scaleVec = resolveVec3Input(options?.scale);
      if (scaleVec) copy.scale = [scaleVec.x, scaleVec.y, scaleVec.z];
    } else {
      copy.parentId = src.parentId ? idMap.get(src.parentId) ?? null : null;
    }
    delete copy.prefabAssetId;
    delete copy.prefabInstanceId;
    delete copy.prefabTemplateId;
    delete copy.prefabHostTemplateId;
    clonedMap[newId] = copy;
  }
  world3.setNodes({ ...allNodes, ...clonedMap });
  const spawnedObj = host.resolveObject(rootNewId);
  if (spawnedObj) {
    const rootNode = clonedMap[rootNewId];
    spawnedObj.visible = rootNode.visible;
    spawnedObj.position.set(rootNode.position[0], rootNode.position[1], rootNode.position[2]);
    spawnedObj.rotation.set(
      rootNode.rotation[0] * Math.PI / 180,
      rootNode.rotation[1] * Math.PI / 180,
      rootNode.rotation[2] * Math.PI / 180
    );
    spawnedObj.scale.set(rootNode.scale[0], rootNode.scale[1], rootNode.scale[2]);
  }
  return rootNewId;
}
function spawnFromTemplateOrPrefab(templateOrPrefab, options, host) {
  const world3 = getRuntimeWorld();
  const nodes = world3.getNodes();
  const tplNode = resolveTemplateNode(templateOrPrefab, nodes);
  if (tplNode) {
    const rootId = cloneSceneSubtree(tplNode, options, host);
    if (!rootId) return null;
    return {
      rootId,
      templatePos: [...tplNode.position],
      templateRotDeg: [...tplNode.rotation],
      templateScale: [...tplNode.scale],
      templateTagId: tplNode.tagId,
      templateTagIds: tplNode.tagIds ? [...tplNode.tagIds] : void 0
    };
  }
  if (typeof templateOrPrefab === "string" && templateOrPrefab.trim()) {
    const posVec = resolveVec3Input(options?.position);
    const pos = posVec ? [posVec.x, posVec.y, posVec.z] : [0, 0, 0];
    const parentOpt = options?.parent;
    const parentId = typeof parentOpt === "string" ? parentOpt : parentOpt && "id" in parentOpt ? parentOpt.id ?? null : null;
    const rootId = world3.instantiatePrefab?.(templateOrPrefab.trim(), { parentId, position: pos }) ?? null;
    if (!rootId) return null;
    const spawned = world3.getNodes()[rootId];
    if (spawned) {
      if (options?.visible !== void 0) spawned.visible = options.visible;
      if (options?.name) spawned.name = options.name;
      const rotVec = resolveVec3Input(optsOrRot(options?.rotation));
      if (rotVec) {
        spawned.rotation = [rotVec.x * 180 / Math.PI, rotVec.y * 180 / Math.PI, rotVec.z * 180 / Math.PI];
      }
      const scaleVec = resolveVec3Input(options?.scale);
      if (scaleVec) spawned.scale = [scaleVec.x, scaleVec.y, scaleVec.z];
      const spawnedObj = host.resolveObject(rootId);
      if (spawnedObj) {
        spawnedObj.visible = spawned.visible;
        spawnedObj.position.set(spawned.position[0], spawned.position[1], spawned.position[2]);
        spawnedObj.rotation.set(
          spawned.rotation[0] * Math.PI / 180,
          spawned.rotation[1] * Math.PI / 180,
          spawned.rotation[2] * Math.PI / 180
        );
        spawnedObj.scale.set(spawned.scale[0], spawned.scale[1], spawned.scale[2]);
      }
      return {
        rootId,
        templatePos: [0, 0, 0],
        templateRotDeg: [...spawned.rotation],
        templateScale: [...spawned.scale],
        templateTagId: spawned.tagId,
        templateTagIds: spawned.tagIds ? [...spawned.tagIds] : void 0
      };
    }
    return { rootId };
  }
  return null;
}
function optsOrRot(rot) {
  return rot;
}
function resetAndInvokeSpawn(nodeId, payload, host) {
  const nodes = getRuntimeWorld().getNodes();
  const targetNode = nodes[nodeId];
  if (!targetNode) return;
  const subtreeIds2 = [];
  const collectSubtree = (id) => {
    subtreeIds2.push(id);
    for (const candidate of Object.values(nodes)) {
      if (candidate.parentId === id) collectSubtree(candidate.id);
    }
  };
  collectSubtree(nodeId);
  for (const subId of subtreeIds2) {
    const subNode = nodes[subId];
    if (!subNode) continue;
    const projectScripts = subNode.gameplay?.packs?.__project__;
    if (!projectScripts || typeof projectScripts !== "object") continue;
    for (const [sid, rawParams] of Object.entries(projectScripts)) {
      if (rawParams && typeof rawParams === "object" && rawParams.__enabled === false) continue;
      const def = compiledBehaviors.get(sid);
      if (!def) continue;
      const key = instanceKey2(subId, sid);
      const rec = {
        nodeId: subId,
        scriptId: sid,
        started: true,
        state: def.state ? { ...def.state() } : {}
      };
      instanceStates.set(key, rec);
      const ctx = buildScriptContext(subNode, sid, rawParams, rec.state, host);
      try {
        def.onStart?.(ctx);
        def.onSpawn?.(ctx, payload);
      } catch (error) {
        getRuntimeWorld().log("error", `\u811A\u672C "${def.name}" \u6FC0\u6D3B\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
function releaseToPool(nodeId, host) {
  const pKey = nodePoolKey.get(nodeId);
  if (!pKey) return false;
  const bucket = poolBuckets.get(pKey);
  if (!bucket) return false;
  if (pooledInactive.has(nodeId)) return true;
  pooledInactive.add(nodeId);
  const nodes = getRuntimeWorld().getNodes();
  const resetSubtree = (id) => {
    cancelTimersForNode(id);
    navAgents.delete(id);
    resetProjectileState(id);
    stopCrowdAgent(id);
    splineFollowAgents.delete(id);
    for (const [tid, tw] of activeTweens.entries()) {
      if (tw.ownerNodeId === id) activeTweens.delete(tid);
    }
    if (nodes[id]?.physics) {
      setPhysicsVelocity(id, [0, 0, 0]);
    }
    for (const child of Object.values(nodes)) {
      if (child.parentId === id) resetSubtree(child.id);
    }
  };
  resetSubtree(nodeId);
  const obj = host.resolveObject(nodeId);
  if (obj) obj.visible = false;
  const n = nodes[nodeId];
  if (n) n.visible = false;
  if (!bucket.idle.includes(nodeId)) {
    bucket.idle.push(nodeId);
  }
  return true;
}
function destroyOrReleaseNode(nodeId, host) {
  if (releaseToPool(nodeId, host)) return;
  cancelTimersForNode(nodeId);
  navAgents.delete(nodeId);
  const world3 = getRuntimeWorld();
  const prev = world3.getNodes();
  if (!prev[nodeId]) return;
  const next = { ...prev };
  const removeTree = (id) => {
    delete next[id];
    cancelTimersForNode(id);
    for (const child of Object.values(prev)) {
      if (child.parentId === id) removeTree(child.id);
    }
  };
  removeTree(nodeId);
  world3.setNodes(next);
}
function resolvePoolKey(templateOrPrefab) {
  if (!templateOrPrefab) return null;
  if (typeof templateOrPrefab === "object" && typeof templateOrPrefab.id === "string") {
    return `node:${templateOrPrefab.id}`;
  }
  if (typeof templateOrPrefab === "string" && templateOrPrefab.trim()) {
    return `ref:${templateOrPrefab.trim()}`;
  }
  return null;
}
function buildScriptContext(node, scriptId, rawParams, stateObj, host) {
  const world3 = getRuntimeWorld();
  const def = compiledBehaviors.get(scriptId);
  const resolvedParams = {};
  const inputRecord = rawParams && typeof rawParams === "object" ? rawParams : {};
  for (const [k, schema] of Object.entries(def?.params ?? {})) {
    const val = k in inputRecord ? inputRecord[k] : defaultForSchema(schema);
    if (schema.type === "vec2" && Array.isArray(val)) resolvedParams[k] = { x: Number(val[0]) || 0, y: Number(val[1]) || 0 };
    else if (schema.type === "vec3" && Array.isArray(val)) resolvedParams[k] = { x: Number(val[0]) || 0, y: Number(val[1]) || 0, z: Number(val[2]) || 0 };
    else if (schema.type === "ref" && schema.target === "node" && typeof val === "string") resolvedParams[k] = makeNodeHandle(val, host);
    else resolvedParams[k] = val;
  }
  const handle = makeNodeHandle(node.id, host);
  const obj = host.resolveObject(node.id);
  return {
    node: handle,
    params: resolvedParams,
    state: stateObj,
    elapsedTime: simElapsed,
    get position() {
      return handle.position;
    },
    set position(v) {
      handle.position = v;
    },
    get rotation() {
      return handle.rotation;
    },
    set rotation(v) {
      handle.rotation = v;
    },
    get scale() {
      return handle.scale;
    },
    set scale(v) {
      handle.scale = v;
    },
    get visible() {
      return handle.visible;
    },
    set visible(v) {
      handle.visible = v;
    },
    hasTag: (tag) => handle.hasTag(tag),
    addTag: (tag) => handle.addTag(tag),
    removeTag: (tag) => handle.removeTag(tag),
    get forward() {
      const yaw = handle.rotation.y;
      return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
    },
    get right() {
      const yaw = handle.rotation.y;
      return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    },
    distanceTo(target) {
      const vec = resolveVec3Input(target);
      if (!vec) return Number.POSITIVE_INFINITY;
      const cur = handle.position;
      return Math.hypot(vec.x - cur.x, vec.y - cur.y, vec.z - cur.z);
    },
    directionTo(target, options) {
      const vec = resolveVec3Input(target);
      if (!vec) return { x: 0, y: 0, z: 1 };
      const cur = handle.position;
      const dx = vec.x - cur.x;
      const dy = options?.planeXZ ? 0 : vec.y - cur.y;
      const dz = vec.z - cur.z;
      const len = Math.hypot(dx, dy, dz);
      if (len <= 1e-6) return { x: 0, y: 0, z: 1 };
      return { x: dx / len, y: dy / len, z: dz / len };
    },
    translate(delta, space = "world") {
      const cur = handle.position;
      if (space === "local") {
        const yaw = handle.rotation.y;
        const sinY = Math.sin(yaw);
        const cosY = Math.cos(yaw);
        const wx = delta.x * cosY + delta.z * sinY;
        const wz = -delta.x * sinY + delta.z * cosY;
        handle.position = { x: cur.x + wx, y: cur.y + delta.y, z: cur.z + wz };
      } else {
        handle.position = { x: cur.x + delta.x, y: cur.y + delta.y, z: cur.z + delta.z };
      }
    },
    rotateY(radians) {
      const rot = handle.rotation;
      handle.rotation = { x: rot.x, y: rot.y + radians, z: rot.z };
    },
    moveToward(target, maxDistance, options) {
      const vec = resolveVec3Input(target);
      if (!vec) return false;
      const cur = handle.position;
      const dx = vec.x - cur.x;
      const dy = options?.planeXZ ? 0 : vec.y - cur.y;
      const dz = vec.z - cur.z;
      const dist = Math.hypot(dx, dy, dz);
      if (options?.faceTarget && (Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5)) {
        const yaw = Math.atan2(dx, dz);
        const r = handle.rotation;
        handle.rotation = { x: r.x, y: yaw, z: r.z };
      }
      if (dist <= 1e-4 || dist <= maxDistance) {
        handle.position = { x: vec.x, y: options?.planeXZ ? cur.y : vec.y, z: vec.z };
        return true;
      }
      const ratio = maxDistance / dist;
      handle.position = {
        x: cur.x + dx * ratio,
        y: cur.y + dy * ratio,
        z: cur.z + dz * ratio
      };
      return false;
    },
    lookAt(target, options) {
      const vec = resolveVec3Input(target);
      if (!vec || !Number.isFinite(vec.x) || !Number.isFinite(vec.y) || !Number.isFinite(vec.z)) return;
      const cur = handle.position;
      if (options?.yOnly) {
        const dx = vec.x - cur.x;
        const dz = vec.z - cur.z;
        if (Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5) {
          const r = handle.rotation;
          handle.rotation = { x: r.x, y: Math.atan2(dx, dz), z: r.z };
        }
        return;
      }
      if (!obj) {
        const dx = vec.x - cur.x;
        const dz = vec.z - cur.z;
        const dy = vec.y - cur.y;
        const horiz = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        const pitch = -Math.atan2(dy, Math.max(1e-5, horiz));
        handle.rotation = { x: pitch, y: yaw, z: 0 };
        return;
      }
      if (node.kind === "camera") {
        const p = obj.position;
        obj.lookAt(2 * p.x - vec.x, 2 * p.y - vec.y, 2 * p.z - vec.z);
      } else {
        obj.lookAt(vec.x, vec.y, vec.z);
      }
      node.rotation[0] = obj.rotation.x * 180 / Math.PI;
      node.rotation[1] = obj.rotation.y * 180 / Math.PI;
      node.rotation[2] = obj.rotation.z * 180 / Math.PI;
    },
    sendMessage(name, payload) {
      messageQueue.push({ targetNodeId: node.id, name, payload, senderId: node.id });
    },
    broadcast(name, payload) {
      messageQueue.push({ targetNodeId: null, name, payload, senderId: node.id });
    },
    getBehavior: (behavior) => handle.getBehavior(behavior),
    findNodeById: (id) => makeNodeHandle(id, host),
    findNodesByTag: (tag) => {
      const all = world3.getNodes();
      return Object.values(all).filter((n) => !isNodePooledInactive(n.id, all) && nodeHasTag(n, tag)).map((n) => makeNodeHandle(n.id, host)).filter(Boolean);
    },
    findNodesInRadius: (center, radius, tag) => {
      const r2 = radius * radius;
      const all = world3.getNodes();
      return Object.values(all).filter((n) => {
        if (isNodePooledInactive(n.id, all)) return false;
        if (tag && !nodeHasTag(n, tag)) return false;
        const p = host.resolveObject(n.id)?.position;
        const x = p ? p.x : n.position[0];
        const y = p ? p.y : n.position[1];
        const z = p ? p.z : n.position[2];
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        return dx * dx + dy * dy + dz * dz <= r2;
      }).map((n) => makeNodeHandle(n.id, host)).filter(Boolean);
    },
    cloneNode: (templateOrName, opts) => {
      const tpl = resolveTemplateNode(templateOrName, world3.getNodes());
      if (!tpl) return null;
      const spawnedId = cloneSceneSubtree(tpl, opts, host);
      if (!spawnedId) return null;
      if (opts?.initMessage) {
        messageQueue.push({ targetNodeId: spawnedId, name: opts.initMessage, payload: opts.initPayload, senderId: node.id });
      }
      return makeNodeHandle(spawnedId, host);
    },
    spawnPrefab: (prefabId, opts) => {
      const posVec = resolveVec3Input(opts?.position);
      const pos = posVec ? [posVec.x, posVec.y, posVec.z] : [0, 0, 0];
      const parentId = typeof opts?.parent === "string" ? opts.parent : opts?.parent && typeof opts.parent === "object" ? opts.parent.id ?? null : null;
      const spawnedId = world3.instantiatePrefab?.(prefabId, { parentId, position: pos }) ?? null;
      if (!spawnedId) return null;
      const spawnedNode = world3.getNodes()[spawnedId];
      if (spawnedNode) {
        if (opts?.name) spawnedNode.name = opts.name;
        const rotVec = resolveVec3Input(opts?.rotation);
        if (rotVec) {
          spawnedNode.rotation = [rotVec.x * 180 / Math.PI, rotVec.y * 180 / Math.PI, rotVec.z * 180 / Math.PI];
        }
        const scaleVec = resolveVec3Input(opts?.scale);
        if (scaleVec) spawnedNode.scale = [scaleVec.x, scaleVec.y, scaleVec.z];
      }
      return makeNodeHandle(spawnedId, host);
    },
    destroyNode: (target) => {
      const targetId = typeof target === "string" ? target : target?.id;
      if (targetId) destroyOrReleaseNode(targetId, host);
    },
    pool: {
      preload: (templateOrPrefab, count) => {
        const key = resolvePoolKey(templateOrPrefab);
        if (!key) return;
        const targetCount = Math.max(0, Math.min(200, Math.floor(count)));
        let bucket = poolBuckets.get(key);
        if (!bucket) {
          bucket = { all: [], idle: [] };
          poolBuckets.set(key, bucket);
        }
        while (bucket.all.length < targetCount) {
          const spawned = spawnFromTemplateOrPrefab(templateOrPrefab, { visible: false }, host);
          if (!spawned) break;
          if (!bucket.templatePos && spawned.templatePos) bucket.templatePos = spawned.templatePos;
          if (!bucket.templateRotDeg && spawned.templateRotDeg) bucket.templateRotDeg = spawned.templateRotDeg;
          if (!bucket.templateScale && spawned.templateScale) bucket.templateScale = spawned.templateScale;
          if (bucket.templateTagId === void 0 && spawned.templateTagId !== void 0) bucket.templateTagId = spawned.templateTagId;
          if (bucket.templateTagIds === void 0 && spawned.templateTagIds !== void 0) bucket.templateTagIds = spawned.templateTagIds;
          pooledInactive.add(spawned.rootId);
          nodePoolKey.set(spawned.rootId, key);
          bucket.all.push(spawned.rootId);
          bucket.idle.push(spawned.rootId);
        }
      },
      acquire: (templateOrPrefab, opts) => {
        const key = resolvePoolKey(templateOrPrefab);
        if (!key) return null;
        let bucket = poolBuckets.get(key);
        if (!bucket) {
          bucket = { all: [], idle: [] };
          poolBuckets.set(key, bucket);
        }
        const allNodes = world3.getNodes();
        let pickedId = null;
        while (bucket.idle.length > 0) {
          const cand = bucket.idle.pop();
          if (allNodes[cand]) {
            pickedId = cand;
            break;
          }
        }
        if (!pickedId) {
          const spawned = spawnFromTemplateOrPrefab(templateOrPrefab, {
            position: opts?.position,
            rotation: opts?.rotation,
            scale: opts?.scale,
            visible: true
          }, host);
          if (!spawned) return null;
          if (!bucket.templatePos && spawned.templatePos) bucket.templatePos = spawned.templatePos;
          if (!bucket.templateRotDeg && spawned.templateRotDeg) bucket.templateRotDeg = spawned.templateRotDeg;
          if (!bucket.templateScale && spawned.templateScale) bucket.templateScale = spawned.templateScale;
          if (bucket.templateTagId === void 0 && spawned.templateTagId !== void 0) bucket.templateTagId = spawned.templateTagId;
          if (bucket.templateTagIds === void 0 && spawned.templateTagIds !== void 0) bucket.templateTagIds = spawned.templateTagIds;
          pickedId = spawned.rootId;
          nodePoolKey.set(pickedId, key);
          bucket.all.push(pickedId);
        } else {
          pooledInactive.delete(pickedId);
          const n = world3.getNodes()[pickedId];
          const objTarget = host.resolveObject(pickedId);
          const posVec = resolveVec3Input(opts?.position);
          const rotVec = resolveVec3Input(opts?.rotation);
          const scaleVec = resolveVec3Input(opts?.scale);
          if (n) {
            n.visible = true;
            n.tagId = bucket.templateTagId;
            n.tagIds = bucket.templateTagIds ? [...bucket.templateTagIds] : void 0;
            if (posVec) n.position = [posVec.x, posVec.y, posVec.z];
            else if (bucket.templatePos) n.position = [...bucket.templatePos];
            if (rotVec) n.rotation = [rotVec.x * 180 / Math.PI, rotVec.y * 180 / Math.PI, rotVec.z * 180 / Math.PI];
            else if (bucket.templateRotDeg) n.rotation = [...bucket.templateRotDeg];
            if (scaleVec) n.scale = [scaleVec.x, scaleVec.y, scaleVec.z];
            else if (bucket.templateScale) n.scale = [...bucket.templateScale];
          }
          if (objTarget && n) {
            objTarget.visible = true;
            objTarget.position.set(n.position[0], n.position[1], n.position[2]);
            objTarget.rotation.set(
              n.rotation[0] * Math.PI / 180,
              n.rotation[1] * Math.PI / 180,
              n.rotation[2] * Math.PI / 180
            );
            objTarget.scale.set(n.scale[0], n.scale[1], n.scale[2]);
          }
        }
        resetAndInvokeSpawn(pickedId, opts?.payload, host);
        return makeNodeHandle(pickedId, host);
      },
      release: (target) => {
        const targetId = typeof target === "string" ? target : target?.id;
        if (targetId) destroyOrReleaseNode(targetId, host);
      },
      stats: (templateOrPrefab) => {
        if (templateOrPrefab) {
          const key = resolvePoolKey(templateOrPrefab);
          const b = key ? poolBuckets.get(key) : void 0;
          const total2 = b ? b.all.length : 0;
          const pooled2 = b ? b.idle.length : 0;
          return { active: Math.max(0, total2 - pooled2), pooled: pooled2, total: total2 };
        }
        let total = 0;
        let pooled = 0;
        for (const b of poolBuckets.values()) {
          total += b.all.length;
          pooled += b.idle.length;
        }
        return { active: Math.max(0, total - pooled), pooled, total };
      }
    },
    after: (seconds, callback) => {
      const id = nextTimerId++;
      const delay = Math.max(0, Number(seconds) || 0);
      scriptTimers.set(id, { id, nodeId: node.id, scriptId, remaining: delay, interval: delay, repeat: false, callback });
      return id;
    },
    every: (seconds, callback) => {
      const id = nextTimerId++;
      const interval = Math.max(0.016, Number(seconds) || 0.1);
      scriptTimers.set(id, { id, nodeId: node.id, scriptId, remaining: interval, interval, repeat: true, callback });
      return id;
    },
    cancelTimer: (timerId) => {
      scriptTimers.delete(timerId);
    },
    physics: {
      raycast: (origin, dir, maxDistance) => {
        const dist = host.probe?.(
          [origin.x, origin.y, origin.z],
          [dir.x, dir.y, dir.z],
          maxDistance,
          node.id
        );
        if (dist === null || dist === void 0) return null;
        return {
          node: handle,
          point: {
            x: origin.x + dir.x * dist,
            y: origin.y + dir.y * dist,
            z: origin.z + dir.z * dist
          },
          normal: { x: 0, y: 1, z: 0 },
          distance: dist
        };
      },
      sphereCast: (center, radius, options) => {
        const nodes = world3.getNodes();
        const r2 = radius * radius;
        const hits = [];
        for (const n of Object.values(nodes)) {
          if (!n.visible || n.id === node.id || isNodePooledInactive(n.id, nodes)) continue;
          if (options?.tag && n.tagId !== options.tag && !n.tagIds?.includes(options.tag)) continue;
          const o = host.resolveObject(n.id);
          const px = o ? o.position.x : n.position[0];
          const py = o ? o.position.y : n.position[1];
          const pz = o ? o.position.z : n.position[2];
          const dx = px - center.x;
          const dy = py - center.y;
          const dz = pz - center.z;
          if (dx * dx + dy * dy + dz * dz <= r2) {
            const h = makeNodeHandle(n.id, host);
            if (h) hits.push(h);
          }
        }
        return hits;
      },
      getVelocity: () => {
        const st = getPhysicsBodyState(node.id);
        if (!st) return { x: 0, y: 0, z: 0 };
        return { x: st.linvel[0], y: st.linvel[1], z: st.linvel[2] };
      },
      setVelocity: (velocity) => {
        setPhysicsVelocity(node.id, [velocity.x, velocity.y, velocity.z]);
      },
      applyImpulse: (impulse) => {
        applyPhysicsImpulse(node.id, [impulse.x, impulse.y, impulse.z]);
      },
      applyForce: (force) => {
        applyPhysicsForce(node.id, [force.x, force.y, force.z]);
      }
    },
    nav: {
      moveTo: (target, speed = 3.5) => {
        const cur = handle.position;
        const path = findNavigationPath([cur.x, cur.y, cur.z], [target.x, target.y, target.z]);
        if (!path || path.length === 0) {
          navAgents.delete(node.id);
          return false;
        }
        navAgents.set(node.id, { path, index: 0, speed: Math.max(0.1, speed) });
        return true;
      },
      stop: () => {
        navAgents.delete(node.id);
      },
      get isMoving() {
        return navAgents.has(node.id);
      }
    },
    spline: {
      create: (pointsOrParent, options) => {
        const resolved = resolveSplinePointsInput(pointsOrParent, host);
        return createSplinePath(resolved.points, {
          closed: options?.closed ?? resolved.closed,
          tension: options?.tension ?? resolved.tension
        });
      },
      follow: (pointsOrParent, options) => {
        let spline;
        if (pointsOrParent && typeof pointsOrParent === "object" && "pointAtDistance" in pointsOrParent) {
          spline = pointsOrParent;
        } else {
          const resolved = resolveSplinePointsInput(pointsOrParent, host);
          spline = createSplinePath(resolved.points, {
            closed: options?.closed ?? options?.loop ?? resolved.closed,
            tension: options?.tension ?? resolved.tension
          });
        }
        if (spline.points.length === 0) {
          splineFollowAgents.delete(node.id);
          return false;
        }
        const startT = Math.max(0, Math.min(1, Number(options?.startProgress ?? 0)));
        const startDist = startT * spline.length;
        const startPos = spline.pointAtDistance(startDist);
        handle.position = {
          x: startPos.x,
          y: options?.planeXZ ? handle.position.y : startPos.y,
          z: startPos.z
        };
        splineFollowAgents.set(node.id, {
          nodeId: node.id,
          spline,
          distance: startDist,
          speed: Math.max(0.01, Number(options?.speed ?? 4)),
          direction: 1,
          loop: Boolean(options?.loop),
          pingPong: Boolean(options?.pingPong),
          faceDirection: options?.faceDirection !== false,
          planeXZ: Boolean(options?.planeXZ),
          onArrive: options?.onArrive
        });
        return true;
      },
      stop: () => {
        splineFollowAgents.delete(node.id);
      },
      get isFollowing() {
        return splineFollowAgents.has(node.id);
      },
      get progress() {
        const ag = splineFollowAgents.get(node.id);
        if (!ag || ag.spline.length <= 1e-6) return 0;
        return Math.max(0, Math.min(1, ag.distance / ag.spline.length));
      }
    },
    tween: {
      to: (target, props, duration, options) => {
        const targetHandle = target && typeof target === "object" && "id" in target && typeof target.id === "string" ? makeNodeHandle(target.id, host) ?? target : target;
        if (!targetHandle) return -1;
        const startPos = props.position && targetHandle.position ? { ...targetHandle.position } : null;
        const startRot = props.rotation && targetHandle.rotation ? { ...targetHandle.rotation } : null;
        const startScale = props.scale && targetHandle.scale ? { ...targetHandle.scale } : null;
        const endPos = resolveVec3Input(props.position);
        const endRot = resolveVec3Input(props.rotation);
        const endScale = resolveVec3Input(props.scale);
        const id = nextTweenId++;
        const dur = Math.max(1e-3, Number(duration) || 1e-3);
        activeTweens.set(id, {
          id,
          ownerNodeId: node.id,
          delayRemaining: Math.max(0, Number(options?.delay ?? 0)),
          elapsed: 0,
          duration: dur,
          ease: options?.ease ?? "outQuad",
          repeat: Math.max(0, Math.floor(options?.repeat ?? 0)),
          yoyo: Boolean(options?.yoyo),
          reversed: false,
          completedCount: 0,
          apply: (t) => {
            if (startPos && endPos) {
              targetHandle.position = {
                x: startPos.x + (endPos.x - startPos.x) * t,
                y: startPos.y + (endPos.y - startPos.y) * t,
                z: startPos.z + (endPos.z - startPos.z) * t
              };
            }
            if (startRot && endRot) {
              targetHandle.rotation = {
                x: startRot.x + (endRot.x - startRot.x) * t,
                y: startRot.y + (endRot.y - startRot.y) * t,
                z: startRot.z + (endRot.z - startRot.z) * t
              };
            }
            if (startScale && endScale) {
              targetHandle.scale = {
                x: startScale.x + (endScale.x - startScale.x) * t,
                y: startScale.y + (endScale.y - startScale.y) * t,
                z: startScale.z + (endScale.z - startScale.z) * t
              };
            }
          },
          onUpdate: options?.onUpdate,
          onComplete: options?.onComplete
        });
        return id;
      },
      value: (from, to, duration, onUpdate, options) => {
        const id = nextTweenId++;
        const dur = Math.max(1e-3, Number(duration) || 1e-3);
        activeTweens.set(id, {
          id,
          ownerNodeId: node.id,
          delayRemaining: Math.max(0, Number(options?.delay ?? 0)),
          elapsed: 0,
          duration: dur,
          ease: options?.ease ?? "outQuad",
          repeat: Math.max(0, Math.floor(options?.repeat ?? 0)),
          yoyo: Boolean(options?.yoyo),
          reversed: false,
          completedCount: 0,
          apply: (t) => {
            onUpdate(from + (to - from) * t);
          },
          onComplete: options?.onComplete
        });
        return id;
      },
      punchScale: (strength = 0.25, duration = 0.22) => {
        const base = { ...handle.scale };
        const id = nextTweenId++;
        const dur = Math.max(0.05, Number(duration) || 0.22);
        activeTweens.set(id, {
          id,
          ownerNodeId: node.id,
          delayRemaining: 0,
          elapsed: 0,
          duration: dur,
          ease: "linear",
          repeat: 0,
          yoyo: false,
          reversed: false,
          completedCount: 0,
          apply: (t) => {
            const pulse = Math.sin(t * Math.PI) * strength;
            handle.scale = {
              x: base.x * (1 + pulse),
              y: base.y * (1 + pulse),
              z: base.z * (1 + pulse)
            };
          },
          onComplete: () => {
            handle.scale = base;
          }
        });
        return id;
      },
      shakePosition: (intensity = 0.18, duration = 0.25) => {
        const base = { ...handle.position };
        const id = nextTweenId++;
        const dur = Math.max(0.05, Number(duration) || 0.25);
        activeTweens.set(id, {
          id,
          ownerNodeId: node.id,
          delayRemaining: 0,
          elapsed: 0,
          duration: dur,
          ease: "linear",
          repeat: 0,
          yoyo: false,
          reversed: false,
          completedCount: 0,
          apply: (t) => {
            const decay = 1 - t;
            const amp = intensity * decay;
            handle.position = {
              x: base.x + (Math.random() * 2 - 1) * amp,
              y: base.y + (Math.random() * 2 - 1) * amp,
              z: base.z + (Math.random() * 2 - 1) * amp
            };
          },
          onComplete: () => {
            handle.position = base;
          }
        });
        return id;
      },
      cancel: (tweenId) => {
        activeTweens.delete(tweenId);
      },
      cancelAll: () => {
        for (const [twId, tw] of activeTweens.entries()) {
          if (tw.ownerNodeId === node.id) activeTweens.delete(twId);
        }
      }
    },
    curve: buildCurveApi(),
    crowd: {
      moveTo: (target, options) => {
        const v = resolveVec3Input(target);
        if (!v) return;
        setCrowdTarget(node.id, v, options);
      },
      stop: () => stopCrowdAgent(node.id),
      get isMoving() {
        return isCrowdMoving(node.id);
      },
      formation: (units, center, options) => {
        const c = resolveVec3Input(center);
        if (!c) return;
        const nodes = world3.getNodes();
        const ids = units.map((u) => resolveTemplateNode(u, nodes)?.id ?? (typeof u === "string" ? u : u?.id)).filter((id) => Boolean(id));
        setCrowdFormation(ids, c, options);
      },
      stats: () => getCrowdStats()
    },
    projectile: {
      launch: (options) => {
        const nodes = world3.getNodes();
        const targetId = options?.target ? resolveTemplateNode(options.target, nodes)?.id ?? (typeof options.target === "string" ? options.target : options.target?.id) : null;
        const ownerId = options?.owner ? resolveTemplateNode(options.owner, nodes)?.id ?? (typeof options.owner === "string" ? options.owner : options.owner?.id) : node.id;
        launchProjectile(node.id, {
          direction: options?.direction ? resolveVec3Input(options.direction) ?? void 0 : void 0,
          targetId,
          ownerId,
          mode: options?.mode,
          speed: options?.speed,
          gravity: options?.gravity,
          turnRate: options?.turnRate,
          maxLifetime: options?.maxLifetime,
          hitRadius: options?.hitRadius,
          targetTag: options?.targetTag,
          damage: options?.damage,
          destroyOnHit: options?.destroyOnHit,
          onHit: options?.onHit ? (hitNodeId, pos) => {
            options.onHit(makeNodeHandle(hitNodeId, host), pos);
          } : void 0
        });
      },
      reset: () => resetProjectileState(node.id)
    },
    anim: {
      playBody: (clipName, opts) => {
        world3.playBody?.(node.id, clipName, opts);
      },
      playUpper: (clipName, opts) => {
        world3.playUpper?.(node.id, clipName, opts);
      },
      stopUpper: (fade2) => world3.stopUpper?.(node.id, fade2)
    },
    audio: {
      playSfx: (assetId, opts) => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const last = sfxCooldownAt.get(assetId) ?? 0;
        if (now - last < 40) return;
        sfxCooldownAt.set(assetId, now);
        playSound({ assetId, bus: "sfx", volume: opts?.volume, playbackRate: opts?.pitch, parent: obj ?? void 0 });
      },
      playBgm: (assetId, opts) => {
        playSound({ assetId, bus: "music", volume: opts?.volume, loop: opts?.loop ?? true });
      },
      stopBgm: () => stopMusic()
    },
    fx: {
      spawn: (effectId, position, options) => {
        const nodes = world3.getNodes();
        const id = `fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const s = options?.scale ?? 1;
        const fxNode = {
          ...node,
          id,
          name: `FX_${effectId.slice(0, 8)}`,
          kind: "effect",
          parentId: null,
          visible: true,
          locked: false,
          position: [position.x, position.y, position.z],
          rotation: [0, 0, 0],
          scale: [s, s, s],
          castShadow: false,
          receiveShadow: false,
          assetId: effectId,
          slots: [],
          gameplay: {},
          physics: void 0,
          effect: {
            assetId: effectId,
            quarksVersion: "1.0",
            playing: true,
            materialAssetId: null,
            simulation: null
          }
        };
        world3.setNodes({ ...nodes, [id]: fxNode });
        const ttl = options?.autoDestroySec !== void 0 ? options.autoDestroySec : 3;
        if (ttl > 0) {
          const tid = nextTimerId++;
          scriptTimers.set(tid, {
            id: tid,
            nodeId: id,
            scriptId,
            remaining: ttl,
            interval: ttl,
            repeat: false,
            callback: () => destroyOrReleaseNode(id, host)
          });
        }
      }
    },
    input: {
      isPressed: (actionOrKey) => isActionPressed(actionOrKey) || isKeyHeld(actionOrKey) || isKeyHeld(`Key${actionOrKey.toUpperCase()}`),
      justPressed: (actionOrKey) => wasActionTapped(actionOrKey) || wasKeyTapped(actionOrKey) || wasKeyTapped(`Key${actionOrKey.toUpperCase()}`),
      isKeyPressed: (code) => isKeyHeld(code) || isKeyHeld(`Key${code.toUpperCase()}`),
      justReleased: () => false,
      axis1D: (action) => isActionPressed(action) ? 1 : 0,
      axis2D: (action) => getActionAxis2D(action),
      moveDirection: (action = "Move") => viewRelativeMove(action, host),
      pointerDelta: () => ({ ...framePointerDelta }),
      pointerPosition: () => ({ ...framePointerPos }),
      wheelDelta: () => frameWheelDelta,
      isMouseButtonPressed: (button) => (currMouseButtons & mouseButtonMask(button)) !== 0,
      justPressedMouseButton: (button) => (currMouseButtons & mouseButtonMask(button)) !== 0 && (prevMouseButtons & mouseButtonMask(button)) === 0,
      justReleasedMouseButton: (button) => (currMouseButtons & mouseButtonMask(button)) === 0 && (prevMouseButtons & mouseButtonMask(button)) !== 0
    },
    ui: {
      getVar: (key) => uiValues().variables[key],
      setVar: (key, value) => writeUiVariable(key, value),
      onEvent: (eventName, handler) => {
        ensureUiClickBridge();
        const instKey = instanceKey2(node.id, scriptId);
        let byEvent = uiEventHandlers.get(instKey);
        if (!byEvent) {
          byEvent = /* @__PURE__ */ new Map();
          uiEventHandlers.set(instKey, byEvent);
        }
        let set = byEvent.get(eventName);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          byEvent.set(eventName, set);
        }
        set.add(handler);
        return () => {
          set?.delete(handler);
        };
      },
      showScreen: (screenIdOrName) => {
        const sid = resolveScreenNodeId(screenIdOrName);
        if (sid) setScreenVisible(sid, true);
      },
      hideScreen: (screenIdOrName) => {
        const sid = resolveScreenNodeId(screenIdOrName);
        if (sid) setScreenVisible(sid, false);
      },
      toggleScreen: (screenIdOrName) => {
        const sid = resolveScreenNodeId(screenIdOrName);
        if (!sid) return;
        const nodeTarget = world3.getNodes()[sid];
        const curMap = uiValues().screens;
        const cur = sid in curMap ? curMap[sid] : Boolean(nodeTarget?.screen?.visibleOnPlay ?? true);
        setScreenVisible(sid, !cur);
      },
      isScreenVisible: (screenIdOrName) => {
        const sid = resolveScreenNodeId(screenIdOrName);
        if (!sid) return false;
        const nodeTarget = world3.getNodes()[sid];
        const curMap = uiValues().screens;
        return sid in curMap ? curMap[sid] : Boolean(nodeTarget?.screen?.visibleOnPlay ?? true);
      },
      worldToScreen: (position) => {
        const vec = resolveVec3Input(position);
        if (!vec || !host.worldToScreen) return null;
        return host.worldToScreen([vec.x, vec.y, vec.z]);
      }
    },
    scene: {
      currentId: () => world3.getActiveSceneId(),
      load: (sceneId, options) => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("t3d:load-scene", { detail: { sceneId, spawnPoint: options?.spawnPoint } }));
        }
      }
    },
    global: {
      get: (key) => globalMemory.get(key),
      set: (key, value) => {
        globalMemory.set(key, value);
      },
      remove: (key) => {
        globalMemory.delete(key);
      }
    },
    storage: {
      get: (key) => persistentMemory.get(key),
      set: (key, value) => {
        persistentMemory.set(key, value);
      },
      remove: (key) => {
        persistentMemory.delete(key);
      }
    },
    tables: {
      getRow: (tableId, rowId) => findRow(world3.getGameDatabase(), tableId, rowId)?.fields ?? null
    },
    log: (...args) => world3.log("info", args.map(String).join(" ")),
    warn: (...args) => world3.log("warn", args.map(String).join(" "))
  };
}
function buildSystemWorldApi(systemId, host) {
  const world3 = getRuntimeWorld();
  const sysNodeId = `__system__:${systemId}`;
  const poolHelpers = {
    preload: (templateOrPrefab, count) => {
      const key = resolvePoolKey(templateOrPrefab);
      if (!key) return;
      const targetCount = Math.max(0, Math.min(200, Math.floor(count)));
      let bucket = poolBuckets.get(key);
      if (!bucket) {
        bucket = { all: [], idle: [] };
        poolBuckets.set(key, bucket);
      }
      while (bucket.all.length < targetCount) {
        const spawned = spawnFromTemplateOrPrefab(templateOrPrefab, { visible: false }, host);
        if (!spawned) break;
        if (!bucket.templatePos && spawned.templatePos) bucket.templatePos = spawned.templatePos;
        if (!bucket.templateRotDeg && spawned.templateRotDeg) bucket.templateRotDeg = spawned.templateRotDeg;
        if (!bucket.templateScale && spawned.templateScale) bucket.templateScale = spawned.templateScale;
        if (bucket.templateTagId === void 0 && spawned.templateTagId !== void 0) bucket.templateTagId = spawned.templateTagId;
        if (bucket.templateTagIds === void 0 && spawned.templateTagIds !== void 0) bucket.templateTagIds = spawned.templateTagIds;
        pooledInactive.add(spawned.rootId);
        nodePoolKey.set(spawned.rootId, key);
        bucket.all.push(spawned.rootId);
        bucket.idle.push(spawned.rootId);
      }
    },
    acquire: (templateOrPrefab, opts) => {
      const key = resolvePoolKey(templateOrPrefab);
      if (!key) return null;
      let bucket = poolBuckets.get(key);
      if (!bucket) {
        bucket = { all: [], idle: [] };
        poolBuckets.set(key, bucket);
      }
      const allNodes = world3.getNodes();
      let pickedId = null;
      while (bucket.idle.length > 0) {
        const cand = bucket.idle.pop();
        if (allNodes[cand]) {
          pickedId = cand;
          break;
        }
      }
      if (!pickedId) {
        const spawned = spawnFromTemplateOrPrefab(templateOrPrefab, {
          position: opts?.position,
          rotation: opts?.rotation,
          scale: opts?.scale,
          visible: true
        }, host);
        if (!spawned) return null;
        if (!bucket.templatePos && spawned.templatePos) bucket.templatePos = spawned.templatePos;
        if (!bucket.templateRotDeg && spawned.templateRotDeg) bucket.templateRotDeg = spawned.templateRotDeg;
        if (!bucket.templateScale && spawned.templateScale) bucket.templateScale = spawned.templateScale;
        if (bucket.templateTagId === void 0 && spawned.templateTagId !== void 0) bucket.templateTagId = spawned.templateTagId;
        if (bucket.templateTagIds === void 0 && spawned.templateTagIds !== void 0) bucket.templateTagIds = spawned.templateTagIds;
        pickedId = spawned.rootId;
        nodePoolKey.set(pickedId, key);
        bucket.all.push(pickedId);
      } else {
        pooledInactive.delete(pickedId);
        const n = world3.getNodes()[pickedId];
        const objTarget = host.resolveObject(pickedId);
        const posVec = resolveVec3Input(opts?.position);
        const rotVec = resolveVec3Input(opts?.rotation);
        const scaleVec = resolveVec3Input(opts?.scale);
        if (n) {
          n.visible = true;
          n.tagId = bucket.templateTagId;
          n.tagIds = bucket.templateTagIds ? [...bucket.templateTagIds] : void 0;
          if (posVec) n.position = [posVec.x, posVec.y, posVec.z];
          else if (bucket.templatePos) n.position = [...bucket.templatePos];
          if (rotVec) n.rotation = [rotVec.x * 180 / Math.PI, rotVec.y * 180 / Math.PI, rotVec.z * 180 / Math.PI];
          else if (bucket.templateRotDeg) n.rotation = [...bucket.templateRotDeg];
          if (scaleVec) n.scale = [scaleVec.x, scaleVec.y, scaleVec.z];
          else if (bucket.templateScale) n.scale = [...bucket.templateScale];
        }
        if (objTarget && n) {
          objTarget.visible = true;
          objTarget.position.set(n.position[0], n.position[1], n.position[2]);
          objTarget.rotation.set(
            n.rotation[0] * Math.PI / 180,
            n.rotation[1] * Math.PI / 180,
            n.rotation[2] * Math.PI / 180
          );
          objTarget.scale.set(n.scale[0], n.scale[1], n.scale[2]);
        }
      }
      resetAndInvokeSpawn(pickedId, opts?.payload, host);
      return makeNodeHandle(pickedId, host);
    },
    release: (target) => {
      const targetId = typeof target === "string" ? target : target?.id;
      if (targetId) destroyOrReleaseNode(targetId, host);
    },
    stats: (templateOrPrefab) => {
      if (templateOrPrefab) {
        const key = resolvePoolKey(templateOrPrefab);
        const b = key ? poolBuckets.get(key) : void 0;
        const total2 = b ? b.all.length : 0;
        const pooled2 = b ? b.idle.length : 0;
        return { active: Math.max(0, total2 - pooled2), pooled: pooled2, total: total2 };
      }
      let total = 0;
      let pooled = 0;
      for (const b of poolBuckets.values()) {
        total += b.all.length;
        pooled += b.idle.length;
      }
      return { active: Math.max(0, total - pooled), pooled, total };
    }
  };
  return {
    get elapsedTime() {
      return simElapsed;
    },
    findNodeById: (id) => makeNodeHandle(id, host),
    findNodesByTag: (tag) => {
      const all = world3.getNodes();
      return Object.values(all).filter((n) => !isNodePooledInactive(n.id, all) && nodeHasTag(n, tag)).map((n) => makeNodeHandle(n.id, host)).filter(Boolean);
    },
    findNodesInRadius: (center, radius, tag) => {
      const r2 = radius * radius;
      const all = world3.getNodes();
      return Object.values(all).filter((n) => {
        if (isNodePooledInactive(n.id, all)) return false;
        if (tag && !nodeHasTag(n, tag)) return false;
        const p = host.resolveObject(n.id)?.position;
        const x = p ? p.x : n.position[0];
        const y = p ? p.y : n.position[1];
        const z = p ? p.z : n.position[2];
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        return dx * dx + dy * dy + dz * dz <= r2;
      }).map((n) => makeNodeHandle(n.id, host)).filter(Boolean);
    },
    cloneNode: (templateOrName, opts) => {
      const tpl = resolveTemplateNode(templateOrName, world3.getNodes());
      if (!tpl) return null;
      const spawnedId = cloneSceneSubtree(tpl, opts, host);
      if (!spawnedId) return null;
      const initMsg = typeof opts?.initMessage === "string" ? opts.initMessage : void 0;
      if (initMsg) {
        messageQueue.push({ targetNodeId: spawnedId, name: initMsg, payload: opts?.initPayload });
      }
      return makeNodeHandle(spawnedId, host);
    },
    spawnPrefab: (prefabId, opts) => {
      const posVec = resolveVec3Input(opts?.position);
      const pos = posVec ? [posVec.x, posVec.y, posVec.z] : [0, 0, 0];
      const spawnedId = world3.instantiatePrefab?.(prefabId, { position: pos }) ?? null;
      if (!spawnedId) return null;
      const spawnedNode = world3.getNodes()[spawnedId];
      if (spawnedNode && opts?.name) spawnedNode.name = opts.name;
      return makeNodeHandle(spawnedId, host);
    },
    destroyNode: (target) => {
      const targetId = typeof target === "string" ? target : target?.id;
      if (targetId) destroyOrReleaseNode(targetId, host);
    },
    pool: poolHelpers,
    broadcast: (name, payload) => {
      messageQueue.push({ targetNodeId: null, name, payload });
    },
    after: (seconds, callback) => {
      const id = nextTimerId++;
      const delay = Math.max(0, Number(seconds) || 0);
      scriptTimers.set(id, { id, nodeId: sysNodeId, scriptId: systemId, remaining: delay, interval: delay, repeat: false, callback });
      return id;
    },
    every: (seconds, callback) => {
      const id = nextTimerId++;
      const interval = Math.max(0.016, Number(seconds) || 0.1);
      scriptTimers.set(id, { id, nodeId: sysNodeId, scriptId: systemId, remaining: interval, interval, repeat: true, callback });
      return id;
    },
    cancelTimer: (timerId) => {
      scriptTimers.delete(timerId);
    },
    curve: buildCurveApi(),
    crowd: {
      moveTo: (targetNode, target, options) => {
        const nodes = world3.getNodes();
        const id = resolveTemplateNode(targetNode, nodes)?.id ?? (typeof targetNode === "string" ? targetNode : targetNode?.id);
        const v = resolveVec3Input(target);
        if (id && v) setCrowdTarget(id, v, options);
      },
      stop: (targetNode) => {
        const nodes = world3.getNodes();
        const id = resolveTemplateNode(targetNode, nodes)?.id ?? (typeof targetNode === "string" ? targetNode : targetNode?.id);
        if (id) stopCrowdAgent(id);
      },
      formation: (units, center, options) => {
        const c = resolveVec3Input(center);
        if (!c) return;
        const nodes = world3.getNodes();
        const ids = units.map((u) => resolveTemplateNode(u, nodes)?.id ?? (typeof u === "string" ? u : u?.id)).filter((id) => Boolean(id));
        setCrowdFormation(ids, c, options);
      },
      stats: () => getCrowdStats()
    },
    projectile: {
      launch: (projNode, options) => {
        const nodes = world3.getNodes();
        const id = resolveTemplateNode(projNode, nodes)?.id ?? (typeof projNode === "string" ? projNode : projNode?.id);
        if (!id) return;
        const targetId = options?.target ? resolveTemplateNode(options.target, nodes)?.id ?? (typeof options.target === "string" ? options.target : options.target?.id) : null;
        const ownerId = options?.owner ? resolveTemplateNode(options.owner, nodes)?.id ?? (typeof options.owner === "string" ? options.owner : options.owner?.id) : null;
        launchProjectile(id, {
          direction: options?.direction ? resolveVec3Input(options.direction) ?? void 0 : void 0,
          targetId,
          ownerId,
          mode: options?.mode,
          speed: options?.speed,
          gravity: options?.gravity,
          turnRate: options?.turnRate,
          maxLifetime: options?.maxLifetime,
          hitRadius: options?.hitRadius,
          targetTag: options?.targetTag,
          damage: options?.damage,
          destroyOnHit: options?.destroyOnHit,
          onHit: options?.onHit ? (hitNodeId, pos) => {
            options.onHit(makeNodeHandle(hitNodeId, host), pos);
          } : void 0
        });
      },
      reset: (projNode) => {
        const nodes = world3.getNodes();
        const id = resolveTemplateNode(projNode, nodes)?.id ?? (typeof projNode === "string" ? projNode : projNode?.id);
        if (id) resetProjectileState(id);
      }
    },
    input: {
      isPressed: (actionOrKey) => isActionPressed(actionOrKey) || isKeyHeld(actionOrKey) || isKeyHeld(`Key${actionOrKey.toUpperCase()}`),
      justPressed: (actionOrKey) => wasActionTapped(actionOrKey) || wasKeyTapped(actionOrKey) || wasKeyTapped(`Key${actionOrKey.toUpperCase()}`),
      isKeyPressed: (code) => isKeyHeld(code) || isKeyHeld(`Key${code.toUpperCase()}`),
      justReleased: () => false,
      axis1D: (action) => isActionPressed(action) ? 1 : 0,
      axis2D: (action) => getActionAxis2D(action),
      moveDirection: (action = "Move") => viewRelativeMove(action, host),
      pointerDelta: () => ({ ...framePointerDelta }),
      pointerPosition: () => ({ ...framePointerPos }),
      wheelDelta: () => frameWheelDelta,
      isMouseButtonPressed: (button) => (currMouseButtons & mouseButtonMask(button)) !== 0,
      justPressedMouseButton: (button) => (currMouseButtons & mouseButtonMask(button)) !== 0 && (prevMouseButtons & mouseButtonMask(button)) === 0,
      justReleasedMouseButton: (button) => (currMouseButtons & mouseButtonMask(button)) === 0 && (prevMouseButtons & mouseButtonMask(button)) !== 0
    },
    ui: {
      getVar: (key) => uiValues().variables[key],
      setVar: (key, value) => writeUiVariable(key, value),
      onEvent: (eventName, handler) => {
        ensureUiClickBridge();
        const instKey = `sys:${systemId}`;
        let byEvent = uiEventHandlers.get(instKey);
        if (!byEvent) {
          byEvent = /* @__PURE__ */ new Map();
          uiEventHandlers.set(instKey, byEvent);
        }
        let set = byEvent.get(eventName);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          byEvent.set(eventName, set);
        }
        set.add(handler);
        return () => {
          set?.delete(handler);
        };
      },
      showScreen: (screenIdOrName) => {
        const sid = resolveScreenNodeId(screenIdOrName);
        if (sid) setScreenVisible(sid, true);
      },
      hideScreen: (screenIdOrName) => {
        const sid = resolveScreenNodeId(screenIdOrName);
        if (sid) setScreenVisible(sid, false);
      },
      toggleScreen: (screenIdOrName) => {
        const sid = resolveScreenNodeId(screenIdOrName);
        if (!sid) return;
        const nodeTarget = world3.getNodes()[sid];
        const curMap = uiValues().screens;
        const cur = sid in curMap ? curMap[sid] : Boolean(nodeTarget?.screen?.visibleOnPlay ?? true);
        setScreenVisible(sid, !cur);
      },
      isScreenVisible: (screenIdOrName) => {
        const sid = resolveScreenNodeId(screenIdOrName);
        if (!sid) return false;
        const nodeTarget = world3.getNodes()[sid];
        const curMap = uiValues().screens;
        return sid in curMap ? curMap[sid] : Boolean(nodeTarget?.screen?.visibleOnPlay ?? true);
      },
      worldToScreen: (position) => {
        const vec = resolveVec3Input(position);
        if (!vec || !host.worldToScreen) return null;
        return host.worldToScreen([vec.x, vec.y, vec.z]);
      }
    },
    scene: {
      currentId: () => world3.getActiveSceneId(),
      load: (sceneId, options) => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("t3d:load-scene", { detail: { sceneId, spawnPoint: options?.spawnPoint } }));
        }
      }
    },
    global: {
      get: (key) => globalMemory.get(key),
      set: (key, value) => {
        globalMemory.set(key, value);
      },
      remove: (key) => {
        globalMemory.delete(key);
      }
    },
    storage: {
      get: (key) => persistentMemory.get(key),
      set: (key, value) => {
        persistentMemory.set(key, value);
      },
      remove: (key) => {
        persistentMemory.delete(key);
      }
    },
    tables: {
      getRow: (tableId, rowId) => findRow(world3.getGameDatabase(), tableId, rowId)?.fields ?? null
    },
    log: (...args) => world3.log("info", args.map(String).join(" ")),
    warn: (...args) => world3.log("warn", args.map(String).join(" "))
  };
}
function viewRelativeMove(action, host) {
  const axis = getActionAxis2D(action);
  const length4 = Math.hypot(axis.x, axis.y);
  if (length4 < 1e-4) return { x: 0, y: 0, z: 0 };
  const scale = length4 > 1 ? 1 / length4 : 1;
  const yaw = host.yaw?.() ?? 0;
  const sin3 = Math.sin(yaw);
  const cos3 = Math.cos(yaw);
  return {
    x: (axis.x * cos3 - axis.y * sin3) * scale,
    y: 0,
    z: (-axis.x * sin3 - axis.y * cos3) * scale
  };
}
function clearScriptRuntimeState() {
  for (const [sysId, sys] of compiledSystems.entries()) {
    if (sys.mounted) {
      sys.mounted = false;
      const noopHost = { ready: false, resolveObject: () => null, updateAnimations: () => {
      } };
      const api = buildSystemWorldApi(sysId, noopHost);
      try {
        sys.def.onDispose?.(api, sys.state);
        sys.def.onDestroy?.(api, sys.state);
      } catch {
      }
      sys.state = {};
    }
  }
  instanceStates.clear();
  messageQueue.length = 0;
  uiEventHandlers.clear();
  uiEventQueue.length = 0;
  globalMemory.clear();
  navAgents.clear();
  pooledInactive.clear();
  nodePoolKey.clear();
  poolBuckets.clear();
  scriptTimers.clear();
  splineFollowAgents.clear();
  activeTweens.clear();
  sfxCooldownAt.clear();
  nextTimerId = 1;
  nextTweenId = 1;
  simElapsed = 0;
  framePointerDelta = { x: 0, y: 0 };
  framePointerPos = { x: 0, y: 0 };
  frameWheelDelta = 0;
  prevMouseButtons = 0;
  currMouseButtons = 0;
}
function stepProjectScripts(dt, host) {
  const world3 = getRuntimeWorld();
  if (world3.getPlayState() !== "playing") {
    clearScriptRuntimeState();
    return;
  }
  ensureUiClickBridge();
  bindProjectileRuntimeHooks({
    onHit: ({ projectileId, targetId, ownerId, damage, position }) => {
      messageQueue.push({
        targetNodeId: targetId,
        name: "onProjectileHit",
        payload: { projectileId, targetId, ownerId, damage, position },
        senderId: projectileId
      });
      messageQueue.push({
        targetNodeId: projectileId,
        name: "onProjectileHit",
        payload: { projectileId, targetId, ownerId, damage, position },
        senderId: projectileId
      });
    },
    onRecycle: (nodeId, runtimeHost) => {
      destroyOrReleaseNode(nodeId, runtimeHost);
    },
    isNodeInactive: (nodeId, nodes2) => isNodePooledInactive(nodeId, nodes2)
  });
  simElapsed += Math.max(0, dt);
  framePointerDelta = host.peekPointerDelta?.() ?? host.pointerDelta?.() ?? { x: 0, y: 0 };
  framePointerPos = host.pointerNormalized?.() ?? { x: 0, y: 0 };
  frameWheelDelta = host.peekWheel?.() ?? host.wheel?.() ?? 0;
  prevMouseButtons = currMouseButtons;
  currMouseButtons = host.mouseButtons ? host.mouseButtons() : host.rightHeld?.() ? 2 : 0;
  const nodes = world3.getNodes();
  const activeKeys = /* @__PURE__ */ new Set();
  for (const sysId of compiledSystems.keys()) {
    activeKeys.add(`sys:${sysId}`);
  }
  if (navAgents.size > 0 && dt > 0) {
    for (const [agentId, agent] of navAgents) {
      const obj = host.resolveObject(agentId);
      const n = nodes[agentId];
      if (!obj && !n) {
        navAgents.delete(agentId);
        continue;
      }
      const targetPt = agent.path[agent.index];
      if (!targetPt) {
        navAgents.delete(agentId);
        continue;
      }
      const curX = obj ? obj.position.x : n.position[0];
      const curY = obj ? obj.position.y : n.position[1];
      const curZ = obj ? obj.position.z : n.position[2];
      const dx = targetPt[0] - curX;
      const dy = targetPt[1] - curY;
      const dz = targetPt[2] - curZ;
      const dist = Math.hypot(dx, dy, dz);
      const stepDist = agent.speed * dt;
      if (dist <= Math.max(0.05, stepDist)) {
        if (obj) obj.position.set(targetPt[0], targetPt[1], targetPt[2]);
        agent.index += 1;
        if (agent.index >= agent.path.length) navAgents.delete(agentId);
      } else {
        const inv = stepDist / dist;
        if (obj) {
          obj.position.set(curX + dx * inv, curY + dy * inv, curZ + dz * inv);
          obj.rotation.y = Math.atan2(dx, dz);
        }
      }
    }
  }
  for (const node of Object.values(nodes)) {
    if (isNodePooledInactive(node.id, nodes)) continue;
    const projectScripts = node.gameplay?.packs?.__project__;
    if (!projectScripts || typeof projectScripts !== "object") continue;
    for (const [scriptId, rawParams] of Object.entries(projectScripts)) {
      if (rawParams && typeof rawParams === "object" && rawParams.__enabled === false) {
        continue;
      }
      const def = compiledBehaviors.get(scriptId);
      if (!def) continue;
      const key = instanceKey2(node.id, scriptId);
      activeKeys.add(key);
      let rec = instanceStates.get(key);
      if (!rec) {
        rec = {
          nodeId: node.id,
          scriptId,
          started: false,
          state: def.state ? { ...def.state() } : {}
        };
        instanceStates.set(key, rec);
      }
      const ctx = buildScriptContext(node, scriptId, rawParams, rec.state, host);
      measureCost(`script:${scriptId}`, () => {
        try {
          if (!rec.started) {
            rec.started = true;
            def.onStart?.(ctx);
          }
          def.onUpdate?.(ctx, dt);
        } catch (error) {
          world3.log("error", `\u811A\u672C "${def.name}" \u8FD0\u884C\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }
  }
  if (splineFollowAgents.size > 0 && dt > 0) {
    for (const [agentId, ag] of Array.from(splineFollowAgents.entries())) {
      const n = nodes[agentId];
      const h = makeNodeHandle(agentId, host);
      if (!n || !h || isNodePooledInactive(agentId, nodes)) {
        splineFollowAgents.delete(agentId);
        continue;
      }
      const totalLen = ag.spline.length;
      if (totalLen <= 1e-6) {
        splineFollowAgents.delete(agentId);
        ag.onArrive?.();
        continue;
      }
      let nextDist = ag.distance + ag.speed * dt * ag.direction;
      let arrived = false;
      if (ag.loop) {
        nextDist = (nextDist % totalLen + totalLen) % totalLen;
      } else if (ag.pingPong) {
        if (nextDist >= totalLen) {
          nextDist = totalLen - (nextDist - totalLen);
          ag.direction = -1;
        } else if (nextDist <= 0) {
          nextDist = -nextDist;
          ag.direction = 1;
        }
      } else {
        if (nextDist >= totalLen) {
          nextDist = totalLen;
          arrived = true;
        } else if (nextDist <= 0) {
          nextDist = 0;
          arrived = true;
        }
      }
      ag.distance = nextDist;
      const pt = ag.spline.pointAtDistance(nextDist);
      const cur = h.position;
      h.position = { x: pt.x, y: ag.planeXZ ? cur.y : pt.y, z: pt.z };
      if (ag.faceDirection) {
        const tan2 = ag.spline.tangentAtDistance(nextDist);
        const tx = tan2.x * ag.direction;
        const tz = tan2.z * ag.direction;
        if (Math.abs(tx) > 1e-5 || Math.abs(tz) > 1e-5) {
          const r = h.rotation;
          h.rotation = { x: r.x, y: Math.atan2(tx, tz), z: r.z };
        }
      }
      if (arrived) {
        splineFollowAgents.delete(agentId);
        try {
          ag.onArrive?.();
        } catch (error) {
          world3.log("error", `Spline \u5230\u8FBE\u56DE\u8C03\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  if (activeTweens.size > 0 && dt > 0) {
    for (const tw of Array.from(activeTweens.values())) {
      if (!activeTweens.has(tw.id)) continue;
      const ownerExists = tw.ownerNodeId.startsWith("__system__:") || Boolean(nodes[tw.ownerNodeId]) && !isNodePooledInactive(tw.ownerNodeId, nodes);
      if (!ownerExists) {
        activeTweens.delete(tw.id);
        continue;
      }
      if (tw.delayRemaining > 0) {
        tw.delayRemaining -= dt;
        if (tw.delayRemaining > 0) continue;
        tw.elapsed += -tw.delayRemaining;
        tw.delayRemaining = 0;
      } else {
        tw.elapsed += dt;
      }
      const rawT = Math.min(1, tw.elapsed / tw.duration);
      const progress = tw.reversed ? 1 - rawT : rawT;
      const eased = evalEasing(tw.ease, progress);
      try {
        tw.apply(eased);
        tw.onUpdate?.(eased);
      } catch (error) {
        world3.log("error", `Tween \u66F4\u65B0\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
        activeTweens.delete(tw.id);
        continue;
      }
      if (rawT >= 1) {
        if (tw.completedCount < tw.repeat) {
          tw.completedCount += 1;
          tw.elapsed = 0;
          if (tw.yoyo) tw.reversed = !tw.reversed;
        } else {
          activeTweens.delete(tw.id);
          try {
            tw.onComplete?.();
          } catch (error) {
            world3.log("error", `Tween \u5B8C\u6210\u56DE\u8C03\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
  }
  if (scriptTimers.size > 0 && dt > 0) {
    const timerSnapshot = Array.from(scriptTimers.values());
    for (const timer of timerSnapshot) {
      if (!scriptTimers.has(timer.id)) continue;
      const isSystemTimer = timer.nodeId.startsWith("__system__:");
      const tNode = isSystemTimer ? null : nodes[timer.nodeId];
      if (!isSystemTimer && (!tNode || isNodePooledInactive(timer.nodeId, nodes))) {
        scriptTimers.delete(timer.id);
        continue;
      }
      timer.remaining -= dt;
      if (timer.remaining <= 0) {
        if (timer.repeat) {
          timer.remaining += timer.interval;
          if (timer.remaining <= 0) timer.remaining = timer.interval;
        } else {
          scriptTimers.delete(timer.id);
        }
        try {
          timer.callback();
        } catch (error) {
          world3.log("error", `\u811A\u672C\u5B9A\u65F6\u5668\u56DE\u8C03\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  if (messageQueue.length > 0) {
    const batch = messageQueue.splice(0, messageQueue.length);
    for (const msg of batch) {
      for (const rec of instanceStates.values()) {
        if (msg.targetNodeId && msg.targetNodeId !== rec.nodeId) continue;
        const def = compiledBehaviors.get(rec.scriptId);
        const node = nodes[rec.nodeId];
        if (!def?.onMessage || !node) continue;
        const rawParams = node.gameplay?.packs?.__project__?.[rec.scriptId];
        if (rawParams && typeof rawParams === "object" && rawParams.__enabled === false) continue;
        const ctx = buildScriptContext(node, rec.scriptId, rawParams, rec.state, host);
        const sender = msg.senderId ? makeNodeHandle(msg.senderId, host) : void 0;
        try {
          def.onMessage(ctx, { name: msg.name, payload: msg.payload, sender });
        } catch (error) {
          world3.log("error", `\u811A\u672C "${def.name}" \u6D88\u606F\u5904\u7406\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  if (uiEventQueue.length > 0) {
    const uiBatch = uiEventQueue.splice(0, uiEventQueue.length);
    for (const evt of uiBatch) {
      for (const [instKey, byEvent] of uiEventHandlers.entries()) {
        if (!activeKeys.has(instKey)) continue;
        const handlers = byEvent.get(evt.eventName);
        if (!handlers || handlers.size === 0) continue;
        for (const fn of [...handlers]) {
          try {
            fn(evt.payload);
          } catch (error) {
            world3.log("error", `UI \u4E8B\u4EF6 "${evt.eventName}" \u5904\u7406\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
  }
  for (const [key, rec] of instanceStates.entries()) {
    if (activeKeys.has(key)) continue;
    uiEventHandlers.delete(key);
    const def = compiledBehaviors.get(rec.scriptId);
    const node = nodes[rec.nodeId];
    if (def?.onDestroy && node) {
      const ctx = buildScriptContext(node, rec.scriptId, {}, rec.state, host);
      try {
        def.onDestroy(ctx);
      } catch {
      }
    }
    instanceStates.delete(key);
  }
}
var compiledBehaviors, compiledSystems, instanceStates, messageQueue, uiEventHandlers, uiEventQueue, uiClickSubscribed, globalMemory, persistentMemory, navAgents, pooledInactive, nodePoolKey, poolBuckets, scriptTimers, splineFollowAgents, activeTweens, sfxCooldownAt, nextTimerId, nextTweenId, simElapsed, framePointerDelta, framePointerPos, frameWheelDelta, prevMouseButtons, currMouseButtons;
var init_scriptRuntime = __esm({
  "src/core/codeAssets/scriptRuntime.ts"() {
    "use strict";
    init_session4();
    init_runtimeTags();
    init_session8();
    init_session9();
    init_session();
    init_registry();
    init_audio();
    init_frameProfile();
    init_motion();
    init_sceneRuntime();
    init_values();
    init_world();
    init_actionMap();
    init_fieldSchema();
    init_compiler();
    compiledBehaviors = /* @__PURE__ */ new Map();
    compiledSystems = /* @__PURE__ */ new Map();
    instanceStates = /* @__PURE__ */ new Map();
    messageQueue = [];
    uiEventHandlers = /* @__PURE__ */ new Map();
    uiEventQueue = [];
    uiClickSubscribed = false;
    globalMemory = /* @__PURE__ */ new Map();
    persistentMemory = /* @__PURE__ */ new Map();
    navAgents = /* @__PURE__ */ new Map();
    pooledInactive = /* @__PURE__ */ new Set();
    nodePoolKey = /* @__PURE__ */ new Map();
    poolBuckets = /* @__PURE__ */ new Map();
    scriptTimers = /* @__PURE__ */ new Map();
    splineFollowAgents = /* @__PURE__ */ new Map();
    activeTweens = /* @__PURE__ */ new Map();
    sfxCooldownAt = /* @__PURE__ */ new Map();
    nextTimerId = 1;
    nextTweenId = 1;
    simElapsed = 0;
    framePointerDelta = { x: 0, y: 0 };
    framePointerPos = { x: 0, y: 0 };
    frameWheelDelta = 0;
    prevMouseButtons = 0;
    currMouseButtons = 0;
    registerRuntimeSystem("core.projectScripts", RUNTIME_STAGE.PRE_PHYSICS + 2, stepProjectScripts);
  }
});

// src/core/codeAssets/shaderRuntime.ts
import { Color as Color5, DataTexture as DataTexture2, RGBAFormat as RGBAFormat2 } from "three";
import * as tsl from "three/tsl";
import { MeshBasicNodeMaterial as MeshBasicNodeMaterial3, MeshStandardNodeMaterial } from "three/webgpu";
var init_shaderRuntime = __esm({
  "src/core/codeAssets/shaderRuntime.ts"() {
    "use strict";
    init_fieldSchema();
    init_compiler();
  }
});

// src/core/codeAssets/workspace.ts
import { create as create4 } from "zustand";
var useCodeAssetStore;
var init_workspace = __esm({
  "src/core/codeAssets/workspace.ts"() {
    "use strict";
    init_folders();
    init_library();
    init_disk();
    init_electronBridge();
    init_store2();
    init_scriptRuntime();
    init_shaderRuntime();
    useCodeAssetStore = create4((set) => ({
      assets: {},
      selectedId: null,
      revision: 0,
      selectAsset: (id) => set({ selectedId: id }),
      upsertAsset: (record) => set((state) => ({ assets: { ...state.assets, [record.id]: record }, revision: state.revision + 1 })),
      removeAsset: (id) => set((state) => {
        const next = { ...state.assets };
        delete next[id];
        return {
          assets: next,
          selectedId: state.selectedId === id ? null : state.selectedId,
          revision: state.revision + 1
        };
      }),
      clear: () => set((state) => ({ assets: {}, selectedId: null, revision: state.revision + 1 }))
    }));
  }
});

// src/editor/assets/prefab.ts
function readPrefab(asset) {
  if (!Array.isArray(asset.nodes)) {
    const nodes2 = asset.nodes;
    const rootId2 = asset.rootId && nodes2[asset.rootId] ? asset.rootId : Object.values(nodes2).find((node) => !node.parentId)?.id ?? "";
    return { rootId: rootId2, nodes: nodes2 };
  }
  const nodes = {};
  for (const node of asset.nodes) nodes[node.id] = node;
  const roots = Object.values(nodes).filter((node) => !node.parentId || !nodes[node.parentId]);
  if (roots.length === 1) return { rootId: roots[0].id, nodes };
  if (roots.length === 0) return { rootId: "", nodes };
  const rootId = crypto.randomUUID();
  nodes[rootId] = makeNode({ id: rootId, name: "\u9884\u5236\u4F53", kind: "empty" });
  roots.forEach((node, order) => {
    node.parentId = rootId;
    node.order = order;
  });
  return { rootId, nodes };
}
function isPrefabRoot(node) {
  return !!node && !!node.prefabAssetId && node.prefabInstanceId === node.id;
}
function captureTemplate(scene2, rootId) {
  const nodes = {};
  const map = /* @__PURE__ */ new Map();
  const walk = (id, parentTemplate) => {
    const source = scene2[id];
    if (!source) return;
    if (isPrefabRoot(source) && id !== rootId) {
      const templateId2 = crypto.randomUUID();
      map.set(id, templateId2);
      const copy2 = strip(source);
      copy2.id = templateId2;
      copy2.parentId = parentTemplate;
      copy2.nestedPrefabId = source.prefabAssetId;
      nodes[templateId2] = copy2;
      return;
    }
    const templateId = crypto.randomUUID();
    map.set(id, templateId);
    const copy = strip(source);
    copy.id = templateId;
    copy.parentId = parentTemplate;
    nodes[templateId] = copy;
    for (const child of childrenOf(scene2, id)) walk(child.id, templateId);
  };
  walk(rootId, null);
  const root = nodes[map.get(rootId) ?? ""];
  if (root) {
    root.position = [0, 0, 0];
    root.rotation = [0, 0, 0];
    root.scale = [1, 1, 1];
  }
  return { rootId: map.get(rootId) ?? "", nodes };
}
function instantiatePrefab(scene2, doc, assetId, parentId, position, lookup, visiting = /* @__PURE__ */ new Set()) {
  if (!doc.rootId || visiting.has(assetId)) return null;
  visiting.add(assetId);
  const root = doc.nodes[doc.rootId];
  if (!root) return null;
  const sceneRoot = crypto.randomUUID();
  const copy = strip(root);
  copy.id = sceneRoot;
  copy.parentId = parentId;
  copy.order = nextOrder2(scene2, parentId);
  copy.name = uniqueName2(scene2, copy.name);
  if (position) copy.position = [position[0], position[1], position[2]];
  copy.prefabAssetId = assetId;
  copy.prefabInstanceId = sceneRoot;
  copy.prefabTemplateId = root.id;
  copy.prefabOverrides = position ? [...PLACEMENT] : [];
  scene2[sceneRoot] = copy;
  expand(scene2, doc, assetId, root.id, sceneRoot, sceneRoot, lookup, visiting);
  visiting.delete(assetId);
  return sceneRoot;
}
function reconcilePrefab(scene2, assetId, doc, lookup) {
  const roots = Object.values(scene2).filter((node) => node.prefabAssetId === assetId && node.prefabInstanceId === node.id);
  for (const root of roots) syncInstance(scene2, root.id, doc, assetId, lookup);
}
function applyInstance(scene2, instanceId, doc) {
  const next = structuredClone(doc);
  const removed = new Set(scene2[instanceId]?.prefabRemoved ?? []);
  for (const id of removed) deleteTemplate(next.nodes, id);
  for (const node of Object.values(scene2)) {
    if (node.prefabInstanceId !== instanceId || !node.prefabTemplateId) continue;
    const template = next.nodes[node.prefabTemplateId];
    if (!template) continue;
    for (const key of node.prefabOverrides ?? []) {
      if (SKIP.has(key) || node.id === instanceId && PLACEMENT.includes(key)) continue;
      copyKey(template, node, key);
    }
    node.prefabOverrides = node.id === instanceId ? [...PLACEMENT] : [];
  }
  for (const node of [...Object.values(scene2)]) {
    if (node.prefabInstanceId !== instanceId || node.prefabTemplateId) continue;
    const parent = node.parentId ? scene2[node.parentId] : void 0;
    const parentTemplate = parent?.prefabTemplateId;
    if (!parentTemplate || !next.nodes[parentTemplate]) continue;
    if (isPrefabRoot(node)) {
      const templateId = crypto.randomUUID();
      const placeholder = strip(node);
      placeholder.id = templateId;
      placeholder.parentId = parentTemplate;
      placeholder.nestedPrefabId = node.prefabAssetId;
      placeholder.order = nextOrder2(next.nodes, parentTemplate);
      next.nodes[templateId] = placeholder;
      node.prefabHostTemplateId = templateId;
      continue;
    }
    graftAdded(scene2, next.nodes, node.id, parentTemplate);
  }
  if (scene2[instanceId]) scene2[instanceId].prefabRemoved = [];
  return next;
}
function revertInstance(scene2, instanceId, doc, assetId, lookup) {
  const root = scene2[instanceId];
  if (!root) return;
  for (const node of Object.values(scene2)) {
    if (node.prefabInstanceId !== instanceId) continue;
    if (!node.prefabTemplateId && node.id !== instanceId) delete scene2[node.id];
    else node.prefabOverrides = node.id === instanceId ? [...PLACEMENT] : [];
  }
  root.prefabRemoved = [];
  syncInstance(scene2, instanceId, doc, assetId, lookup);
}
function unpackInstance(scene2, instanceId) {
  for (const node of Object.values(scene2)) {
    if (node.prefabInstanceId !== instanceId) continue;
    delete node.prefabAssetId;
    delete node.prefabInstanceId;
    delete node.prefabTemplateId;
    delete node.prefabHostTemplateId;
    delete node.prefabOverrides;
    delete node.prefabRemoved;
  }
}
function rememberRemoval(scene2, id) {
  const node = scene2[id];
  if (!node?.prefabTemplateId || !node.prefabInstanceId || node.id === node.prefabInstanceId) return;
  const root = scene2[node.prefabInstanceId];
  if (!root) return;
  root.prefabRemoved = [.../* @__PURE__ */ new Set([...root.prefabRemoved ?? [], node.prefabTemplateId])];
}
function detachIfReparented(scene2, id) {
  const node = scene2[id];
  if (!node?.prefabInstanceId || node.id === node.prefabInstanceId || !node.prefabTemplateId) return;
  const rootId = node.prefabInstanceId;
  if (contains(scene2, rootId, id)) {
    rememberRemoval(scene2, id);
    delete node.prefabTemplateId;
    delete node.prefabOverrides;
    return;
  }
  const templateIds = [node.prefabTemplateId];
  const walk = (current) => {
    for (const child of childrenOf(scene2, current)) {
      if (child.prefabInstanceId === rootId && child.prefabTemplateId) templateIds.push(child.prefabTemplateId);
      if (child.prefabInstanceId === rootId) walk(child.id);
    }
  };
  walk(id);
  const root = scene2[rootId];
  if (root) root.prefabRemoved = [.../* @__PURE__ */ new Set([...root.prefabRemoved ?? [], ...templateIds])];
  const clear = (current) => {
    const item = scene2[current];
    if (!item || item.prefabInstanceId !== rootId) return;
    delete item.prefabAssetId;
    delete item.prefabInstanceId;
    delete item.prefabTemplateId;
    delete item.prefabHostTemplateId;
    delete item.prefabOverrides;
    delete item.prefabRemoved;
    for (const child of childrenOf(scene2, current)) clear(child.id);
  };
  clear(id);
}
function tagAddedChild(scene2, id) {
  const node = scene2[id];
  const parent = node?.parentId ? scene2[node.parentId] : void 0;
  if (!node || !parent?.prefabInstanceId || node.prefabAssetId) return;
  node.prefabAssetId = parent.prefabAssetId;
  node.prefabInstanceId = parent.prefabInstanceId;
}
function retargetInstance(scene2, oldRoot, newRoot) {
  const walk = (id) => {
    const node = scene2[id];
    if (!node) return;
    if (node.prefabInstanceId === oldRoot) node.prefabInstanceId = newRoot;
    for (const child of childrenOf(scene2, id)) walk(child.id);
  };
  walk(newRoot);
}
function markOverrides(node, patch) {
  if (!node.prefabAssetId) return;
  const keys = Object.keys(patch).filter((key) => !SKIP.has(key) && key !== "clipTime" && key !== "clipPlaying");
  if (keys.length === 0) return;
  node.prefabOverrides = [.../* @__PURE__ */ new Set([...node.prefabOverrides ?? [], ...keys])];
}
function syncInstance(scene2, instanceId, doc, assetId, lookup) {
  const root = scene2[instanceId];
  const templateRoot = doc.nodes[doc.rootId];
  if (!root || !templateRoot) return;
  const removed = new Set(root.prefabRemoved ?? []);
  const byTemplate = /* @__PURE__ */ new Map();
  for (const node of Object.values(scene2)) {
    if (node.prefabInstanceId === instanceId && node.prefabTemplateId) byTemplate.set(node.prefabTemplateId, node);
    if (node.prefabHostTemplateId) byTemplate.set(node.prefabHostTemplateId, node);
  }
  const keep = /* @__PURE__ */ new Set([instanceId]);
  const visit = (templateId, parentSceneId) => {
    if (removed.has(templateId)) return;
    const template = doc.nodes[templateId];
    if (!template) return;
    if (template.nestedPrefabId) {
      let nested = byTemplate.get(templateId);
      if (!nested || !isPrefabRoot(nested)) {
        const nestedDoc = lookup(template.nestedPrefabId);
        const created = nestedDoc ? instantiatePrefab(scene2, nestedDoc, template.nestedPrefabId, parentSceneId, null, lookup) : null;
        nested = created ? scene2[created] : void 0;
        if (nested) {
          nested.prefabHostTemplateId = templateId;
          nested.position = [...template.position];
          nested.rotation = [...template.rotation];
          nested.scale = [...template.scale];
          nested.prefabOverrides = (nested.prefabOverrides ?? []).filter((key) => !PLACEMENT.includes(key));
        }
      } else if (nested.parentId !== parentSceneId) nested.parentId = parentSceneId;
      if (nested) {
        applyProps(nested, template, new Set(nested.prefabOverrides ?? []));
        keep.add(nested.id);
      }
      return;
    }
    let node = templateId === doc.rootId ? root : byTemplate.get(templateId);
    if (!node) {
      const id = crypto.randomUUID();
      node = strip(template);
      node.id = id;
      node.parentId = parentSceneId;
      node.order = template.order;
      node.prefabAssetId = assetId;
      node.prefabInstanceId = instanceId;
      node.prefabTemplateId = templateId;
      node.prefabOverrides = [];
      scene2[id] = node;
    } else if (node.id !== instanceId) node.parentId = parentSceneId;
    const overrides = new Set(node.prefabOverrides ?? []);
    if (node.id === instanceId) PLACEMENT.forEach((key) => overrides.add(key));
    applyProps(node, template, overrides);
    keep.add(node.id);
    for (const child of childrenOf(doc.nodes, templateId)) visit(child.id, node.id);
  };
  visit(doc.rootId, root.parentId);
  for (const node of Object.values(scene2)) {
    if (node.prefabInstanceId !== instanceId || !node.prefabTemplateId) continue;
    if (!keep.has(node.id)) deleteSubtree(scene2, node.id);
  }
}
function expand(scene2, doc, assetId, templateParent, sceneParent, instanceId, lookup, visiting) {
  for (const template of childrenOf(doc.nodes, templateParent)) {
    if (template.nestedPrefabId) {
      const nestedDoc = lookup(template.nestedPrefabId);
      const nestedId = nestedDoc ? instantiatePrefab(scene2, nestedDoc, template.nestedPrefabId, sceneParent, null, lookup, visiting) : null;
      const nested = nestedId ? scene2[nestedId] : void 0;
      if (!nested) continue;
      nested.prefabHostTemplateId = template.id;
      nested.position = [...template.position];
      nested.rotation = [...template.rotation];
      nested.scale = [...template.scale];
      nested.order = template.order;
      nested.prefabOverrides = [];
      continue;
    }
    const id = crypto.randomUUID();
    const node = strip(template);
    node.id = id;
    node.parentId = sceneParent;
    node.order = template.order;
    node.prefabAssetId = assetId;
    node.prefabInstanceId = instanceId;
    node.prefabTemplateId = template.id;
    node.prefabOverrides = [];
    scene2[id] = node;
    expand(scene2, doc, assetId, template.id, id, instanceId, lookup, visiting);
  }
}
function graftAdded(scene2, templateNodes, id, parentTemplate) {
  const map = /* @__PURE__ */ new Map();
  const walk = (current, parent) => {
    const source = scene2[current];
    if (!source || isPrefabRoot(source)) return;
    const templateId = crypto.randomUUID();
    map.set(current, templateId);
    const copy = strip(source);
    copy.id = templateId;
    copy.parentId = parent;
    copy.order = source.order;
    templateNodes[templateId] = copy;
    source.prefabTemplateId = templateId;
    source.prefabOverrides = [];
    for (const child of childrenOf(scene2, current)) walk(child.id, templateId);
  };
  walk(id, parentTemplate);
}
function deleteTemplate(nodes, id) {
  for (const child of childrenOf(nodes, id)) deleteTemplate(nodes, child.id);
  delete nodes[id];
}
function deleteSubtree(nodes, id) {
  for (const child of childrenOf(nodes, id)) deleteSubtree(nodes, child.id);
  delete nodes[id];
}
function applyProps(target, source, overrides) {
  for (const key of Object.keys(source)) {
    if (SKIP.has(key) || overrides.has(key)) continue;
    copyKey(target, source, key);
  }
}
function copyKey(target, source, key) {
  const value = source[key];
  target[key] = structuredClone(value);
}
function strip(node) {
  const copy = structuredClone(node);
  delete copy.prefabAssetId;
  delete copy.prefabInstanceId;
  delete copy.prefabTemplateId;
  delete copy.prefabHostTemplateId;
  delete copy.prefabOverrides;
  delete copy.prefabRemoved;
  return copy;
}
function contains(nodes, ancestor, id) {
  let current = nodes[id]?.parentId;
  const seen = /* @__PURE__ */ new Set();
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = nodes[current]?.parentId ?? null;
  }
  return false;
}
function nextOrder2(nodes, parentId) {
  let max4 = -1;
  for (const node of Object.values(nodes)) if (node.parentId === parentId) max4 = Math.max(max4, node.order);
  return max4 + 1;
}
function uniqueName2(nodes, base) {
  const names = new Set(Object.values(nodes).map((node) => node.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
var PLACEMENT, SKIP;
var init_prefab = __esm({
  "src/editor/assets/prefab.ts"() {
    "use strict";
    init_kinds();
    PLACEMENT = ["position", "rotation", "scale"];
    SKIP = /* @__PURE__ */ new Set([
      "id",
      "parentId",
      "order",
      "prefabAssetId",
      "prefabInstanceId",
      "prefabTemplateId",
      "prefabHostTemplateId",
      "prefabOverrides",
      "prefabRemoved",
      "nestedPrefabId"
    ]);
  }
});

// src/editor/prefs/store.ts
import { create as create5 } from "zustand";
function readPrefs() {
  const fallback = { language: "system", autoSave: true, openLastProject: true, uiScale: 1 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const language = parsed.language === "zh" || parsed.language === "en" || parsed.language === "system" ? parsed.language : "system";
    const uiScale = parsed.uiScale === 1.25 || parsed.uiScale === 1.5 ? parsed.uiScale : 1;
    return { language, autoSave: parsed.autoSave !== false, openLastProject: parsed.openLastProject !== false, uiScale };
  } catch {
    return fallback;
  }
}
function persist(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  document.documentElement.style.zoom = String(state.uiScale);
}
function dataOf(state, patch) {
  return { ...state, ...patch };
}
function resolveLanguage(setting) {
  if (setting === "zh" || setting === "en") return setting;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}
var KEY, initial, usePrefsStore;
var init_store = __esm({
  "src/editor/prefs/store.ts"() {
    "use strict";
    KEY = "t3d-editor-prefs";
    initial = readPrefs();
    persist(initial);
    usePrefsStore = create5((set) => ({
      ...initial,
      settingsOpen: false,
      setLanguage: (language) => set((state) => {
        const next = dataOf(state, { language });
        persist(next);
        return next;
      }),
      setAutoSave: (autoSave) => set((state) => {
        const next = dataOf(state, { autoSave });
        persist(next);
        return next;
      }),
      setOpenLastProject: (openLastProject) => set((state) => {
        const next = dataOf(state, { openLastProject });
        persist(next);
        return next;
      }),
      setUiScale: (uiScale) => set((state) => {
        const next = dataOf(state, { uiScale });
        persist(next);
        return next;
      }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false })
    }));
  }
});

// src/editor/i18n/messages.ts
var zh, en;
var init_messages = __esm({
  "src/editor/i18n/messages.ts"() {
    "use strict";
    zh = {
      "menu.file": "\u6587\u4EF6",
      "menu.edit": "\u7F16\u8F91",
      "menu.create": "\u521B\u5EFA",
      "menu.view": "\u89C6\u56FE",
      "menu.newProject": "\u65B0\u5EFA\u5DE5\u7A0B\u2026",
      "menu.openProject": "\u6253\u5F00\u5DE5\u7A0B\u2026",
      "menu.recentProjects": "\u6700\u8FD1\u5DE5\u7A0B",
      "menu.newScene": "\u65B0\u5EFA\u573A\u666F",
      "menu.save": "\u4FDD\u5B58",
      "menu.saveAsProject": "\u53E6\u5B58\u4E3A\u5DE5\u7A0B\u2026",
      "menu.projectSettings": "\u5DE5\u7A0B\u8BBE\u7F6E\u2026",
      "menu.database": "\u6E38\u620F\u6570\u636E\u2026",
      "menu.library": "\u5B98\u65B9\u5E93\u2026",
      "menu.tags": "\u6807\u7B7E\u2026",
      "menu.layers": "\u5C42\u2026",
      "hub.title": "\u6E38\u620F\u6570\u636E",
      "hub.count": "{tables} \u5F20\u6570\u636E\u8868",
      "hub.database": "\u6E38\u620F\u6570\u636E\uFF08{count} \u5F20\u8868\uFF09",
      "hub.packs": "\u73A9\u6CD5\u5305",
      "hub.search": "\u641C\u7D22{name}",
      "hub.reset": "\u91CD\u7F6E\u9ED8\u8BA4",
      "hub.add": "\u65B0\u589E\u6761\u76EE",
      "hub.catalog": "\u6570\u636E\u8868\u76EE\u5F55",
      "hub.corePack": "\u6838\u5FC3\u5305",
      "hub.rowCount": "{count} \u6761",
      "hub.showing": "\u663E\u793A {shown} / {total} \u6761",
      "hub.empty": "\u6CA1\u6709\u5339\u914D\u7684\u8BB0\u5F55\u3002\u53EF\u4EE5\u65B0\u589E\u4E00\u6761\u3002",
      "hub.id": "\u6807\u8BC6",
      "hub.name": "\u540D\u79F0",
      "hub.category": "\u5206\u7EC4",
      "hub.note": "\u5907\u6CE8",
      "hub.delete": "\u5220\u9664",
      "hub.enabled": "\u5DF2\u542F\u7528",
      "hub.disabled": "\u5DF2\u5173\u95ED",
      "hub.packHint": "\u5173\u6389\u7684\u5305\u4F1A\u4ECE\u8FD9\u5F20\u76EE\u5F55\u6D88\u5931\uFF0C\u5DF2\u7ECF\u5199\u8FC7\u7684\u884C\u7559\u5728\u5DE5\u7A0B\u91CC\u3002\u5C5E\u6027\u3001\u7269\u54C1\u8FD9\u4E9B\u8868\u7B49\u5BF9\u5E94\u7684\u5305\u505A\u4E86\u518D\u51FA\u73B0\u3002",
      "library.title": "\u5B98\u65B9\u5E93",
      "library.lead": "\u7F16\u8F91\u5668\u81EA\u5E26\u7684\u80FD\u529B\u3001\u73A9\u6CD5\u3001\u4E13\u9879\u548C\u7D20\u6750\u3002\u5F00\u5173\u8BB0\u5728\u5F53\u524D\u5DE5\u7A0B\u91CC\u3002",
      "library.search": "\u641C\u7D22\u540D\u79F0",
      "library.empty": "\u6CA1\u6709\u5339\u914D\u7684\u6761\u76EE",
      "library.on": "\u5DF2\u5F00\u542F",
      "library.off": "\u5DF2\u5173\u95ED",
      "library.soon": "\u5F00\u53D1\u4E2D",
      "library.official": "\u5B98\u65B9",
      "library.includes": "\u8FD9\u4E00\u5305\u63D0\u4F9B",
      "library.switch": "\u5DE5\u7A0B\u5F00\u5173",
      "library.soonNote": "\u968F\u7F16\u8F91\u5668\u5F00\u53D1\u3002\u767B\u8BB0\u5B8C\u6210\u524D\u4E0D\u80FD\u5F00\u5173\u3002",
      "library.assetNote": "\u7D20\u6750\u662F\u76EE\u5F55\uFF0C\u7528\u5230\u65F6\u518D\u5BFC\u5165\u5DE5\u7A0B\u3002\u73B0\u5728\u8FD8\u4E0D\u80FD\u5B89\u88C5\u3002",
      "library.shelf.capability": "\u80FD\u529B",
      "library.shelf.gameplay": "\u73A9\u6CD5",
      "library.shelf.genre": "\u4E13\u9879",
      "library.shelf.asset": "\u7D20\u6750",
      "library.shelfHint.capability": "\u6A21\u62DF\u548C\u753B\u9762\u8FD0\u884C\u65F6\u3002\u6C34\u4F53\u3001\u5929\u6C14\u4E5F\u5F52\u5728\u8FD9\u91CC\u3002",
      "library.shelfHint.gameplay": "\u6838\u5FC3\u5305\u4EE5\u5916\u7684\u9886\u57DF\u5305\u3002\u6838\u5FC3\u5305\u59CB\u7EC8\u5F00\u542F\uFF0C\u4E0D\u5728\u5E93\u91CC\u3002",
      "library.shelfHint.genre": "\u67D0\u4E00\u7C7B\u6E38\u620F\u7684\u4E13\u5C5E\u5305\u3002\u6A21\u677F\u4EE5\u540E\u5355\u72EC\u6807\u660E\u3002",
      "library.shelfHint.asset": "\u73B0\u6210\u7684\u6A21\u578B\u3001\u52A8\u753B\u548C\u7C92\u5B50\u9884\u8BBE\u3002",
      "library.item.physics": "\u7269\u7406",
      "library.item.physicsDetail": "\u78B0\u649E\u4F53\u3001\u521A\u4F53\u548C\u8BD5\u73A9\u65F6\u7684\u7269\u7406\u6A21\u62DF\u3002",
      "library.item.physicsPoints": "\u521A\u4F53\u4E0E\u78B0\u649E\u4F53\n\u573A\u666F\u91CD\u529B\u4E0B\u7684\u6A21\u62DF",
      "library.item.buoyancy": "\u6D6E\u529B",
      "library.item.buoyancyDetail": "\u57FA\u4E8E\u5F53\u524D\u6C34\u4F53\u6CE2\u6D6A\u7684\u7269\u7406\u6D6E\u529B\u4E0E\u6C34\u963B\u5C3C\uFF08\u4F9D\u8D56\u7269\u7406\u7CFB\u7EDF\uFF09\u3002",
      "library.item.buoyancyPoints": "\u591A\u70B9\u6D6E\u529B\u91C7\u6837\n\u6C34\u963B\u5C3C\u4E0E\u6CE2\u6D6A\u8DDF\u968F",
      "library.item.navigation": "\u5BFC\u822A",
      "library.item.navigationDetail": "\u4ECE\u9759\u6001\u8868\u9762\u70D8\u7119\u5BFC\u822A\u7F51\u683C\u3002\u8BD5\u73A9\u65F6\u969C\u788D\u53EF\u4EE5\u6316\u5F00\u7F51\u683C\u3002",
      "library.item.navigationPoints": "\u5BFC\u822A\u7F51\u683C\u70D8\u7119\n\u5BFB\u8DEF\u4E0E\u969C\u788D",
      "library.item.spline": "Spline \u8DEF\u5F84\u8FD0\u52A8",
      "library.item.splineDetail": "\u914D\u5408 3D \u89C6\u53E3\u53EF\u7F16\u8F91 Spline \u66F2\u7EBF\u8282\u70B9\uFF0C\u6309\u5F27\u957F\u5300\u901F\u5DE1\u903B\u6216\u8F68\u9053\u79FB\u52A8\u3002",
      "library.item.splinePoints": "3D \u89C6\u53E3\u66F2\u8FB9\u7F16\u8F91\u5668\n\u5F27\u957F\u5300\u901F\u8FD0\u52A8\n\u5355\u6B21 / \u5FAA\u73AF / \u5F80\u8FD4",
      "library.item.tween": "Tween \u8865\u95F4\u52A8\u6548",
      "library.item.tweenDetail": "\u4E3A\u7269\u4F53\u63D0\u4F9B\u4F4D\u7F6E\u3001\u65CB\u8F6C\u3001\u7F29\u653E\u4E0E\u60AC\u6D6E\u6D6E\u52A8\u7B49\u7F13\u52A8\u5FAA\u73AF\u52A8\u6548\u3002",
      "library.item.tweenPoints": "12 \u79CD\u5E38\u7528\u7F13\u52A8\u66F2\u7EBF\n\u5FAA\u73AF\u4E0E Yoyo \u5F80\u8FD4\n\u811A\u672C self.tween \u94FE\u5F0F\u9A71\u52A8",
      "library.item.crowd": "\u7FA4\u4F53\u907F\u8BA9 (Crowd)",
      "library.item.crowdDetail": "\u4E3A\u591A\u5355\u4F4D\u63D0\u4F9B\u5C40\u90E8\u907F\u8BA9\u5206\u79BB\u3001\u51DD\u805A\u5BF9\u9F50\u4E0E\u6A2A\u6392/\u65B9\u9635/\u6954\u5F62/\u73AF\u5F62\u7F16\u961F\u79FB\u52A8\u3002",
      "library.item.crowdPoints": "\u7A7A\u95F4\u7F51\u683C\u5C40\u90E8\u907F\u8BA9\n\u6A2A\u6392 / \u65B9\u9635 / \u6954\u5F62 / \u73AF\u5F62\u7F16\u961F\n\u811A\u672C self.crowd / world.crowd",
      "library.item.projectile": "\u901A\u7528\u5F39\u9053 (Projectile)",
      "library.item.projectileDetail": "\u652F\u6301\u76F4\u7EBF\u3001\u8FFD\u8E2A\u4E0E\u629B\u7269\u7EBF\u5F39\u9053\u98DE\u884C\uFF0C\u81EA\u52A8\u68C0\u6D4B\u76EE\u6807\u6807\u7B7E\u547D\u4E2D\u5E76\u56DE\u6C60\u6216\u9500\u6BC1\u3002",
      "library.item.projectilePoints": "\u76F4\u7EBF / \u8FFD\u8E2A / \u629B\u7269\u7EBF\n\u76EE\u6807\u6807\u7B7E\u547D\u4E2D\u4E0E\u56DE\u6C60\n\u81EA\u52A8\u6D3E\u53D1 onProjectileHit",
      "library.item.particles": "\u7C92\u5B50",
      "library.item.particlesDetail": "\u7C92\u5B50\u8FD0\u884C\u65F6\u3002\u5173\u6389\u540E\u8D44\u6E90\u548C\u7269\u4F53\u4E0A\u7684\u6570\u636E\u8FD8\u5728\uFF0C\u53EA\u662F\u4E0D\u518D\u64AD\u653E\u3002",
      "library.item.particlesPoints": "\u7C92\u5B50\u6A21\u62DF\n\u73B0\u6210\u9884\u8BBE\u5728\u7D20\u6750\u680F",
      "library.item.sky": "\u5929\u7A7A",
      "library.item.skyDetail": "\u65F6\u523B\u3001\u5927\u6C14\u6563\u5C04\u548C\u8DDF\u7740\u592A\u9633\u8D70\u7684\u73AF\u5883\u5149\u7167\u3002\u5173\u6389\u540E\u53C2\u6570\u7559\u5728\u753B\u9762\u4E0A\uFF0C\u53EA\u662F\u4E0D\u518D\u7ED8\u5236\u3002",
      "library.item.skyPoints": "\u65F6\u523B\u4E0E\u5927\u6C14\n\u73AF\u5883\u5149\u7167\n\u9AD8\u5EA6\u96FE\u3001\u661F\u7A7A\u4E0E\u6708\u4EAE",
      "library.item.water": "\u6C34\u4F53",
      "library.item.waterDetail": "TSL \u6C34\u9762\u3001\u53CC\u5C42\u6D41\u52A8\u6CD5\u7EBF\u3001\u5E73\u9762\u53CD\u5C04\u3001\u6C34\u6DF1\u5438\u6536\u4E0E\u5CB8\u8FB9\u6CE1\u6CAB\u3002\u5173\u6389\u540E\u53C2\u6570\u4FDD\u7559\uFF0C\u6062\u590D\u539F\u6750\u8D28\u3002",
      "library.item.waterPoints": "\u5E73\u9762\u53CD\u5C04\u4E0E\u6C34\u6DF1\u5438\u6536\n\u5CB8\u8FB9\u6CE1\u6CAB\u4E0E\u6CE2\u6D6A\n5 \u5957\u9884\u8BBE\u4E0E 3 \u6863\u753B\u8D28",
      "buoyancy.title": "\u6D6E\u529B",
      "buoyancy.enable": "\u542F\u7528\u6D6E\u529B",
      "buoyancy.sampleMode": "\u91C7\u6837\u5206\u5E03",
      "buoyancy.sample.box4": "\u5E95\u9762\u56DB\u70B9\uFF08\u8239\u53EA/\u7BB1\u5B50\uFF09",
      "buoyancy.sample.box8": "\u516B\u89D2\u70B9\uFF08\u53EF\u7FFB\u6EDA/\u5168\u6D78\uFF09",
      "buoyancy.sample.center": "\u4E2D\u5FC3\u70B9\uFF08\u7403\u4F53/\u6D6E\u6807\uFF09",
      "buoyancy.force": "\u6D6E\u529B\u500D\u7387",
      "buoyancy.waterDrag": "\u6C34\u4E2D\u963B\u529B",
      "buoyancy.angularDrag": "\u6447\u6643\u963B\u5C3C",
      "buoyancy.draftDepth": "\u5403\u6C34\u6DF1\u5EA6\uFF080 \u81EA\u52A8\uFF09",
      "buoyancy.needsDynamic": "\u9700\u8981\u52A8\u6001\u521A\u4F53\u624D\u80FD\u53D7\u529B\u6F02\u6D6E",
      "buoyancy.makeDynamic": "\u8BBE\u4E3A\u52A8\u6001\u521A\u4F53",
      "projectSettings.buoyancyDetail": "\u57FA\u4E8E\u5F53\u524D\u6C34\u4F53\u6CE2\u6D6A\u7684\u7269\u7406\u6D6E\u529B\u4E0E\u6C34\u963B\u5C3C\uFF08\u4F9D\u8D56\u7269\u7406\u7CFB\u7EDF\uFF09\u3002",
      "spline.title": "Spline \u8DEF\u5F84\u8FD0\u52A8",
      "projectSettings.splineDetail": "\u6CBF\u8DEF\u5F84\u7236\u8282\u70B9\u7684\u6709\u5E8F\u5B50\u8282\u70B9\u4F5C\u5E73\u6ED1\u6837\u6761\u66F2\u7EBF\u5300\u901F\u8FD0\u52A8\u3002",
      "tween.title": "Tween \u8865\u95F4\u52A8\u6548",
      "projectSettings.tweenDetail": "\u4E3A\u7269\u4F53\u63D0\u4F9B\u4F4D\u7F6E\u3001\u65CB\u8F6C\u3001\u7F29\u653E\u4E0E\u60AC\u6D6E\u6D6E\u52A8\u7B49\u7F13\u52A8\u5FAA\u73AF\u52A8\u6548\u3002",
      "crowd.title": "\u7FA4\u4F53\u907F\u8BA9 (Crowd)",
      "projectSettings.crowdDetail": "\u4E3A\u591A\u5355\u4F4D\u63D0\u4F9B\u5C40\u90E8\u907F\u8BA9\u5206\u79BB\u3001\u51DD\u805A\u5BF9\u9F50\u4E0E\u6A2A\u6392/\u65B9\u9635/\u6954\u5F62/\u73AF\u5F62\u7F16\u961F\u79FB\u52A8\u3002",
      "projectile.title": "\u901A\u7528\u5F39\u9053 (Projectile)",
      "projectSettings.projectileDetail": "\u652F\u6301\u76F4\u7EBF\u3001\u8FFD\u8E2A\u4E0E\u629B\u7269\u7EBF\u5F39\u9053\u98DE\u884C\uFF0C\u81EA\u52A8\u68C0\u6D4B\u76EE\u6807\u6807\u7B7E\u547D\u4E2D\u5E76\u56DE\u6C60\u6216\u9500\u6BC1\u3002",
      "water.title": "\u6C34\u4F53",
      "water.enable": "\u542F\u7528\u6C34\u4F53",
      "water.groupColor": "\u6C34\u8272\u4E0E\u5438\u6536",
      "water.groupWaves": "\u6CE2\u7EB9\u4E0E\u6D77\u6D6A",
      "water.groupOptics": "\u5149\u5B66\u4E0E\u6CE1\u6CAB",
      "water.on": "\u5F00\u542F",
      "water.off": "\u5173\u95ED",
      "water.add": "\u8BBE\u4E3A\u6C34\u4F53",
      "water.style": "\u98CE\u683C\u9884\u8BBE",
      "water.quality": "\u753B\u8D28\u6863\u4F4D",
      "water.preset.tropical": "\u70ED\u5E26\u6D45\u6D77",
      "water.preset.ocean": "\u6DF1\u6D77\u5927\u6D0B",
      "water.preset.lake": "\u9759\u8C27\u6E56\u6CCA",
      "water.preset.pool": "\u6E05\u6F88\u6CF3\u6C60",
      "water.preset.stylized": "\u98CE\u683C\u5316\u5361\u901A\u6C34",
      "water.quality.fast": "\u8F7B\u91CF\uFF08\u65E0\u53CD\u5C04\uFF09",
      "water.quality.balanced": "\u5747\u8861\uFF080.5x \u53CD\u5C04\uFF09",
      "water.quality.ultra": "\u6781\u81F4\uFF080.75x + \u5927\u6D6A\uFF09",
      "water.shallow": "\u6D45\u6C34\u8272",
      "water.deep": "\u6DF1\u6C34\u8272",
      "water.absorption": "\u6C34\u6DF1\u5438\u6536 (m)",
      "water.opacity": "\u57FA\u7840\u4E0D\u900F\u660E",
      "water.waveScale": "\u6CE2\u7EB9\u5C3A\u5EA6",
      "water.flowSpeed": "\u6D41\u901F",
      "water.normalScale": "\u6CD5\u7EBF\u5F3A\u5EA6",
      "water.reflectivity": "\u53CD\u5C04\u5F3A\u5EA6",
      "water.specular": "\u592A\u9633\u9AD8\u5149",
      "water.specularSize": "\u9AD8\u5149\u5927\u5C0F",
      "water.sss": "\u6B21\u8868\u9762\u6563\u5C04",
      "water.foamWidth": "\u6CE1\u6CAB\u8303\u56F4",
      "water.foamIntensity": "\u6CE1\u6CAB\u5F3A\u5EA6",
      "water.foamScale": "\u6CE1\u6CAB\u5C3A\u5EA6",
      "water.crestFoam": "\u6CE2\u5CF0\u6D6A\u82B1",
      "water.crestThreshold": "\u6D6A\u82B1\u9608\u503C",
      "water.foamTrail": "\u6CE1\u6CAB\u62D6\u5C3E",
      "water.debugView": "\u8C03\u8BD5\u89C6\u56FE",
      "water.debug.off": "\u5173\u95ED",
      "water.debug.height": "\u6CE2\u9AD8",
      "water.debug.squeeze": "\u6324\u538B\u503C",
      "water.debug.foam": "\u6CE1\u6CAB\u906E\u7F69",
      "water.waveHeight": "\u6CE2\u6D6A\u9AD8\u5EA6",
      "water.waveSpeed": "\u6CE2\u6D6A\u901F\u5EA6",
      "water.waveSteepness": "\u6CE2\u5CF0\u805A\u62E2",
      "water.waveBend": "\u6D6A\u7EBF\u873F\u8712",
      "water.swellRate": "\u8D77\u843D\u9891\u7387",
      "water.waveLean": "\u6D6A\u5C16\u5377\u66F2",
      "water.crestSharpness": "\u6D6A\u5C16\u9510\u5EA6",
      "water.groupSwitches": "\u6548\u679C\u4E0E\u6027\u80FD\u5F00\u5173",
      "water.planar": "\u5E73\u9762\u53CD\u5C04",
      "water.refraction": "\u6C34\u4E0B\u6298\u5C04",
      "water.caustics": "\u6C34\u5E95\u7126\u6563",
      "water.shoreFoam": "\u5CB8\u8FB9\u6CE1\u6CAB",
      "water.underwaterEffect": "\u6C34\u4E0B\u6548\u679C",
      "water.underwaterColor": "\u6C34\u4E0B\u96FE\u8272",
      "water.underwaterFogDensity": "\u6C34\u4E0B\u96FE\u6D53\u5EA6",
      "water.underwaterFogStart": "\u8D77\u96FE\u8DDD\u79BB (m)",
      "water.underwaterTint": "\u6C34\u4E0B\u67D3\u8272",
      "water.underwaterSurfaceBrightness": "\u6C34\u4E0B\u6C34\u9762\u4EAE\u5EA6",
      "water.softEdge": "\u5CB8\u8FB9\u7FBD\u5316 (m)",
      "water.flowDir": "\u6D41\u5411\u89D2\u5EA6",
      "water.fresnel": "\u83F2\u6D85\u5C14\u6307\u6570",
      "water.causticsStrength": "\u7126\u6563\u5F3A\u5EA6",
      "water.causticsScale": "\u7126\u6563\u5C3A\u5EA6",
      "water.foamColor": "\u6CE1\u6CAB\u8272",
      "water.sunColor": "\u9AD8\u5149\u8272",
      "water.normalMap": "\u6CD5\u7EBF\u8D34\u56FE",
      "water.foamMap": "\u6CE1\u6CAB\u8D34\u56FE",
      "library.item.stats": "\u5C5E\u6027",
      "library.item.statsDetail": "\u751F\u547D\u3001\u653B\u51FB\u3001\u9632\u5FA1\u3001\u72B6\u6001\u6548\u679C\u548C\u7B49\u7EA7\u8868\u3002",
      "library.item.statsPoints": "\u5C5E\u6027\u8868\n\u72B6\u6001\u6548\u679C\n\u7B49\u7EA7",
      "library.item.combat": "\u6218\u6597",
      "library.item.combatDetail": "\u8FD1\u6218\u3001\u5C04\u51FB\u3001\u6B66\u5668\u548C\u8FDE\u62DB\u3002\u4F9D\u8D56\u5C5E\u6027\u5305\u3002",
      "library.item.combatPoints": "\u6B66\u5668\u4E0E\u62DB\u5F0F\n\u8FD1\u6218\u548C\u5C04\u51FB\u7EC4\u4EF6",
      "library.item.perception": "\u611F\u77E5",
      "library.item.perceptionDetail": "\u7D22\u654C\u548C\u5237\u602A\u3002",
      "library.item.perceptionPoints": "\u7D22\u654C\n\u5237\u602A",
      "library.item.inventory": "\u80CC\u5305",
      "library.item.inventoryDetail": "\u7269\u54C1\u3001\u5BB9\u5668\u548C\u5730\u4E0A\u7684\u6389\u843D\u7269\u3002",
      "library.item.inventoryPoints": "\u7269\u54C1\u8868\n\u5BB9\u5668\u4E0E\u6389\u843D",
      "library.item.dialogue": "\u5BF9\u8BDD",
      "library.item.dialogueDetail": "\u5BF9\u8BDD\u548C\u4EFB\u52A1\u8FFD\u8E2A\u3002",
      "library.item.dialoguePoints": "\u5BF9\u8BDD\n\u4EFB\u52A1",
      "library.item.rts": "\u5373\u65F6\u7B56\u7565",
      "library.item.rtsDetail": "\u6846\u9009\u3001\u7F16\u7EC4\u548C\u5355\u4F4D\u6307\u4EE4\u3002\u4E13\u5C5E\u5305\uFF0C\u4E0D\u662F\u793A\u4F8B\u5DE5\u7A0B\u3002",
      "library.item.rtsPoints": "\u6846\u9009\u4E0E\u7F16\u7EC4\n\u5355\u4F4D\u6307\u4EE4",
      "library.item.rpg": "\u89D2\u8272\u626E\u6F14",
      "library.item.rpgDetail": "\u628A\u5C5E\u6027\u3001\u80CC\u5305\u3001\u5BF9\u8BDD\u548C\u4EFB\u52A1\u6536\u6210\u4E00\u5957\u89D2\u8272\u626E\u6F14\u89C4\u5219\u3002",
      "library.item.rpgPoints": "\u89D2\u8272\u6210\u957F\n\u4EFB\u52A1\u6D41\u7A0B",
      "library.item.characters": "\u89D2\u8272\u4E0E\u52A8\u753B",
      "library.item.charactersDetail": "\u5B98\u65B9\u4EBA\u5F62\u548C\u5E38\u7528\u52A8\u4F5C\u3002\u5BFC\u5165\u540E\u8FDB\u5165\u5DE5\u7A0B\u8D44\u6E90\u3002",
      "library.item.charactersPoints": "\u4EBA\u5F62\u6A21\u578B\n\u8D70\u8DD1\u8DF3\u52A8\u4F5C",
      "library.item.environments": "\u573A\u666F\u5957\u4EF6",
      "library.item.environmentsDetail": "\u5730\u9762\u3001\u5CA9\u77F3\u548C\u5E38\u7528\u6446\u4EF6\u3002",
      "library.item.environmentsPoints": "\u6A21\u5757\u5316\u573A\u666F\n\u6446\u4EF6",
      "library.item.vfx": "\u7C92\u5B50\u9884\u8BBE",
      "library.item.vfxDetail": "\u505A\u597D\u7684\u7206\u70B8\u3001\u62D6\u5C3E\u548C\u547D\u4E2D\u6548\u679C\u3002\u64AD\u653E\u4ECD\u8981\u6253\u5F00\u7C92\u5B50\u80FD\u529B\u3002",
      "library.item.vfxPoints": "\u547D\u4E2D\u4E0E\u7206\u70B8\n\u62D6\u5C3E",
      "hub.noBlock": "\u4E0D\u963B\u65AD",
      "menu.projectMenu": "\u5DE5\u7A0B",
      "menu.views": "\u89C6\u56FE",
      "menu.display": "\u663E\u793A",
      "menu.savedDirectory": "\u5DF2\u4FDD\u5B58\u5230 {name}",
      "menu.import": "\u5BFC\u5165\u8D44\u6E90",
      "menu.extractPackage": "\u63D0\u53D6\u7D20\u6750\u5305\u2026",
      "menu.undo": "\u64A4\u9500",
      "menu.redo": "\u91CD\u505A",
      "menu.duplicate": "\u5C31\u5730\u590D\u5236",
      "menu.copy": "\u62F7\u8D1D",
      "menu.paste": "\u7C98\u8D34",
      "menu.group": "\u6210\u7EC4",
      "menu.ground": "\u8D34\u5730",
      "menu.delete": "\u5220\u9664",
      "menu.selectAll": "\u5168\u9009",
      "menu.empty": "\u7A7A\u7269\u4F53",
      "menu.meshes": "\u51E0\u4F55\u4F53",
      "menu.lights": "\u706F\u5149",
      "menu.devices": "\u73A9\u6CD5\u88C5\u7F6E",
      "menu.camera": "\u76F8\u673A",
      "menu.effect": "\u7279\u6548",
      "menu.screen": "\u754C\u9762",
      "menu.spline": "Spline \u66F2\u7EBF",
      "component.add": "\u6DFB\u52A0\u7EC4\u4EF6",
      "component.search": "\u641C\u7D22\u7EC4\u4EF6\u2026",
      "component.remove": "\u79FB\u9664\u7EC4\u4EF6",
      "component.reset": "\u91CD\u7F6E\u4E3A\u9ED8\u8BA4",
      "component.added": "\u5DF2\u6DFB\u52A0",
      "component.empty": "\u6CA1\u6709\u5339\u914D\u7684\u7EC4\u4EF6",
      "component.group.character": "\u89D2\u8272\u4E0E\u955C\u5934",
      "component.group.devices": "\u573A\u666F\u88C5\u7F6E",
      "component.group.world": "\u7269\u7406\u4E0E\u5BFC\u822A",
      "component.group.pack": "\u73A9\u6CD5\u4E0E\u9886\u57DF\u5305",
      "menu.focus": "\u805A\u7126\u9009\u4E2D",
      "menu.alignCamera": "\u5BF9\u9F50\u5230\u5F53\u524D\u89C6\u56FE",
      "menu.alignView": "\u8DF3\u8F6C\u5230\u8BE5\u955C\u5934\u89C6\u89D2",
      "menu.focusAll": "\u805A\u7126\u5168\u90E8",
      "menu.viewTop": "\u9876\u89C6\u56FE",
      "menu.viewFront": "\u524D\u89C6\u56FE",
      "menu.viewRight": "\u4FA7\u89C6\u56FE",
      "menu.viewPersp": "\u900F\u89C6",
      "menu.viewBottom": "\u5E95\u89C6\u56FE",
      "menu.viewBack": "\u540E\u89C6\u56FE",
      "menu.viewLeft": "\u5DE6\u89C6\u56FE",
      "menu.grid": "\u663E\u793A\u7F51\u683C",
      "menu.snap": "\u7F51\u683C\u5438\u9644",
      "menu.resetLayout": "\u91CD\u7F6E\u5E03\u5C40",
      "menu.settings": "\u8BBE\u7F6E",
      "menu.saved": "\u5DF2\u4FDD\u5B58\u5230\u672C\u5730\u7F13\u5B58",
      "kind.empty": "\u7A7A\u7269\u4F53",
      "kind.box": "\u6B63\u65B9\u4F53",
      "kind.sphere": "\u7403\u4F53",
      "kind.plane": "\u5E73\u9762",
      "kind.capsule": "\u80F6\u56CA",
      "kind.cylinder": "\u5706\u67F1\u4F53",
      "kind.cone": "\u5706\u9525\u4F53",
      "kind.model": "\u6A21\u578B",
      "kind.directional-light": "\u65B9\u5411\u5149",
      "kind.point-light": "\u70B9\u5149\u6E90",
      "kind.spot-light": "\u805A\u5149\u706F",
      "kind.hemisphere-light": "\u534A\u7403\u5149",
      "kind.camera": "\u76F8\u673A",
      "kind.effect": "\u7279\u6548",
      "kind.screen": "\u754C\u9762",
      "kind.spline": "Spline \u66F2\u7EBF",
      "tool.newScene": "\u65B0\u5EFA\u573A\u666F",
      "tool.save": "\u4FDD\u5B58\u5230\u672C\u5730\u7F13\u5B58",
      "tool.undo": "\u64A4\u9500",
      "tool.redo": "\u91CD\u505A",
      "tool.move": "\u79FB\u52A8 (W)",
      "tool.rotate": "\u65CB\u8F6C (E)",
      "tool.scale": "\u7F29\u653E (R)",
      "tool.world": "\u4E16\u754C",
      "tool.local": "\u5C40\u90E8",
      "tool.snap": "\u7F51\u683C\u5438\u9644",
      "tool.grid": "\u663E\u793A\u7F51\u683C",
      "tool.ground": "\u8D34\u5730",
      "tool.originCenter": "\u624B\u67C4\u5728\u5305\u56F4\u76D2\u4E2D\u5FC3",
      "tool.originPivot": "\u624B\u67C4\u5728\u8F74\u5FC3",
      "tool.center": "\u4E2D\u5FC3",
      "tool.pivot": "\u8F74\u5FC3",
      "tool.play": "\u8BD5\u73A9 (Ctrl+P)",
      "tool.pause": "\u6682\u505C (Ctrl+P)",
      "tool.playLabel": "\u8BD5\u73A9",
      "tool.pauseLabel": "\u6682\u505C",
      "tool.stop": "\u505C\u6B62 (Ctrl+Shift+P)",
      "tool.history": "\u5386\u53F2",
      "status.unnamed": "\u672A\u547D\u540D\u573A\u666F",
      "status.playing": "\u8BD5\u73A9\u4E2D",
      "status.paused": "\u5DF2\u6682\u505C",
      "status.ready": "\u5C31\u7EEA",
      "status.objects": "\u7269\u4F53",
      "status.none": "\u672A\u9009\u62E9",
      "status.selected": "\u5DF2\u9009 {count} \u4E2A",
      "status.move": "\u79FB\u52A8",
      "status.rotate": "\u65CB\u8F6C",
      "status.scale": "\u7F29\u653E",
      "status.world": "\u4E16\u754C",
      "status.local": "\u5C40\u90E8",
      "status.center": "\u4E2D\u5FC3",
      "status.pivot": "\u8F74\u5FC3",
      "status.snapOn": "\u5438\u9644 {step}",
      "status.snapOff": "\u5438\u9644\u5173",
      "status.warming": "\u6B63\u5728\u52A0\u8F7D\u8D44\u6E90 {completed}/{total}",
      "panel.project": "\u8D44\u6E90",
      "panel.viewport": "3D \u89C6\u53E3",
      "panel.console": "\u63A7\u5236\u53F0",
      "panel.scene": "\u573A\u666F",
      "panel.inspector": "\u5C5E\u6027",
      "panel.history": "\u5386\u53F2",
      "panel.unknown": "\u672A\u77E5\u9762\u677F",
      "settings.title": "\u7F16\u8F91\u5668\u8BBE\u7F6E",
      "settings.general": "\u5E38\u89C4",
      "settings.language": "\u8BED\u8A00",
      "settings.languageSystem": "\u8DDF\u968F\u7CFB\u7EDF",
      "settings.languageZh": "\u4E2D\u6587",
      "settings.languageEn": "English",
      "settings.autoSave": "\u81EA\u52A8\u4FDD\u5B58",
      "settings.autoSaveNote": "\u7F16\u8F91\u540E\u5199\u5165\u672C\u5730\u7F13\u5B58\u3002\u5173\u95ED\u540E\u4ECD\u4F1A\u5728\u79BB\u5F00\u9875\u9762\u524D\u4FDD\u5B58\u3002",
      "settings.openLastProject": "\u542F\u52A8\u65F6\u6253\u5F00\u4E0A\u6B21\u5DE5\u7A0B",
      "settings.openLastProjectNote": "\u542F\u52A8\u65F6\u6253\u5F00\u6700\u8FD1\u4E00\u6B21\u7684\u5DE5\u7A0B\u76EE\u5F55\u3002",
      "settings.uiScale": "\u754C\u9762\u7F29\u653E",
      "settings.close": "\u5173\u95ED",
      "inspector.modelRenderer": "\u6A21\u578B\u6E32\u67D3",
      "inspector.castShadow": "\u6295\u5C04\u9634\u5F71",
      "inspector.receiveShadow": "\u63A5\u6536\u9634\u5F71",
      "inspector.materialSlots": "\u6750\u8D28\u69FD",
      "inspector.parts": "\u90E8\u4F4D",
      "inspector.hierarchy": "\u5C42\u7EA7",
      "inspector.partHint": "\u8FD9\u91CC\u53EA\u5F00\u5173\u663E\u793A\uFF0C\u90E8\u4F4D\u4ECD\u7559\u5728\u6A21\u578B\u91CC\u3002",
      "inspector.sockets": "\u9AA8\u9ABC\u6302\u70B9",
      "inspector.socketHint": "\u6302\u70B9\u662F\u89D2\u8272\u7684\u5B50\u7269\u4F53\uFF0C\u6BCF\u5E27\u8D34\u7740\u8FD9\u6839\u9AA8\u5934\u3002\u6B66\u5668\u518D\u4F5C\u4E3A\u6302\u70B9\u7684\u5B50\u7269\u4F53\uFF0C\u7528\u5B83\u81EA\u5DF1\u7684\u4F4D\u7F6E\u8C03\u63E1\u6301\u3002",
      "inspector.extractSocket": "\u63D0\u51FA\u6302\u70B9",
      "inspector.socketReady": "\u5DF2\u63D0\u51FA",
      "inspector.searchBones": "\u641C\u7D22\u9AA8\u9ABC",
      "inspector.backToModel": "\u8FD4\u56DE\u6A21\u578B",
      "inspector.partVisible": "\u663E\u793A\u90E8\u4F4D",
      "inspector.showAllSlots": "\u5168\u90E8 ({count})",
      "inspector.partSlotsOnly": "\u4EC5\u6B64\u90E8\u4F4D",
      "inspector.sharedSlotHint": "\u6B64\u6750\u8D28\u4E5F\u88AB\u5176\u4ED6\u90E8\u4F4D\u5171\u7528\uFF0C\u4FEE\u6539\u4F1A\u540C\u6B65\u751F\u6548\u3002",
      "inspector.bonePath": "\u8DEF\u5F84",
      "inspector.jumpSocket": "\u9009\u4E2D\u6302\u70B9",
      "inspector.followModel": "\u8DDF\u968F\u6A21\u578B",
      "inspector.on": "\u5F00\u542F",
      "inspector.off": "\u5173\u95ED",
      "inspector.partMaterial": "\u5355\u72EC\u6750\u8D28",
      "inspector.followSlot": "\u8DDF\u968F\u6750\u8D28\u69FD",
      "inspector.searchSlots": "\u641C\u7D22\u6750\u8D28\u69FD",
      "inspector.slot": "\u69FD {index}",
      "inspector.inline": "\u5185\u5D4C",
      "inspector.extract": "\u63D0\u53D6\u4E3A\u6750\u8D28\u8D44\u6E90",
      "inspector.reveal": "\u5728\u8D44\u6E90\u91CC\u6253\u5F00",
      "inspector.clear": "\u6E05\u9664\u5F15\u7528\uFF0C\u6062\u590D\u5185\u5D4C\u6750\u8D28",
      "inspector.expandSlot": "\u5C55\u5F00\u6750\u8D28\u69FD",
      "inspector.collapseSlot": "\u6298\u53E0\u6750\u8D28\u69FD",
      "inspector.linkedNote": "\u8FD9\u4E2A\u69FD\u5F15\u7528\u6750\u8D28\u8D44\u6E90\u3002\u8FD9\u91CC\u7684\u4FEE\u6539\u4F1A\u4F5C\u7528\u5230\u6240\u6709\u4F7F\u7528\u5B83\u7684\u7269\u4F53\u3002",
      "material.shader": "\u7740\u8272\u5668",
      "material.lit": "\u6807\u51C6\u5149\u7167",
      "material.unityStandard": "Unity \u6807\u51C6 (R\u91D1\u5C5E / A\u5149\u6ED1)",
      "material.unityMetallicGloss": "\u91D1\u5C5E\u5149\u6ED1",
      "material.unityMetallicGlossHint": "Unity \u8D34\u56FE\u7EA6\u5B9A\uFF1A\u7EA2\u901A\u9053\u91D1\u5C5E\uFF0CAlpha \u901A\u9053\u5149\u6ED1\u5EA6\uFF081-\u7C97\u7CD9\uFF09\uFF0C\u7EFF\u901A\u9053\u906E\u853D",
      "material.particle": "\u7C92\u5B50\u65E0\u5149",
      "material.particleBlend": "\u6DF7\u5408",
      "material.blendAlpha": "\u900F\u660E",
      "material.blendPremultiply": "\u9884\u4E58",
      "material.blendAdditive": "\u53E0\u52A0",
      "material.blendMultiply": "\u76F8\u4E58",
      "material.unlitColor": "\u65E0\u5149\u7167\u989C\u8272",
      "material.unlitTexture": "\u65E0\u5149\u7167\u8D34\u56FE",
      "material.surface": "\u8868\u9762",
      "material.color": "\u989C\u8272",
      "material.baseMap": "\u5E95\u8272",
      "material.metalness": "\u91D1\u5C5E",
      "material.roughness": "\u7C97\u7CD9",
      "material.metallicRoughness": "\u91D1\u5C5E\u7C97\u7CD9",
      "material.metallicRoughnessHint": "\u7EFF\u901A\u9053\u7C97\u7CD9\uFF0C\u84DD\u901A\u9053\u91D1\u5C5E\uFF0C\u7EA2\u901A\u9053\u906E\u853D",
      "material.normal": "\u6CD5\u7EBF",
      "material.normalScale": "\u6CD5\u7EBF\u5F3A\u5EA6",
      "material.ao": "\u906E\u6321",
      "material.aoMap": "\u906E\u6321\u56FE",
      "material.aoMapHint": "\u7559\u7A7A\u65F6\u4F7F\u7528\u91D1\u5C5E\u7C97\u7CD9\u56FE\u7684\u7EA2\u901A\u9053",
      "material.emission": "\u53D1\u5149",
      "material.emissionColor": "\u53D1\u5149",
      "material.emissionIntensity": "\u53D1\u5149\u5F3A\u5EA6",
      "material.emissionMap": "\u53D1\u5149\u56FE",
      "material.transparency": "\u900F\u660E",
      "material.mode": "\u6A21\u5F0F",
      "material.opaque": "\u4E0D\u900F\u660E",
      "material.blend": "\u6DF7\u5408",
      "material.clip": "\u88C1\u526A",
      "material.opacity": "\u4E0D\u900F\u660E\u5EA6",
      "material.cutoff": "\u88C1\u526A\u9608\u503C",
      "material.render": "\u6E32\u67D3",
      "material.cull": "\u5254\u9664",
      "material.cullBack": "\u80CC\u9762",
      "material.cullFront": "\u6B63\u9762",
      "material.cullOff": "\u5173\u95ED",
      "material.depthWrite": "\u6DF1\u5EA6\u5199\u5165",
      "material.wireframe": "\u7EBF\u6846",
      "material.none": "\u65E0",
      "inspector.playBanner": "\u8BD5\u73A9\u4E2D\u53EF\u4EE5\u6539\u53C2\u6570\u3002\u505C\u6B62\u540E\u4F1A\u56DE\u5230\u8BD5\u73A9\u524D\u3002",
      "inspector.keepPlayChanges": "\u4FDD\u7559\u4FEE\u6539",
      "tool.keepPlayChanges": "\u4FDD\u7559\u8BD5\u73A9\u671F\u95F4\u4FEE\u6539\u7684\u7EC4\u4EF6\u3001\u6750\u8D28\u3001\u706F\u5149\u3001\u753B\u9762\uFF0C\u4EE5\u53CA\u955C\u5934\u6EDA\u8F6E\u8DDD\u79BB\u548C\u53F3\u952E\u89D2\u5EA6\uFF08\u4E0D\u8986\u76D6\u8DD1\u52A8\u540E\u7684\u5750\u6807\uFF09",
      "log.keptPlayChanges": "\u5DF2\u4FDD\u7559\u8BD5\u73A9\u671F\u95F4\u4FEE\u6539\u7684\u53C2\u6570",
      "inspector.multi": "\u5DF2\u9009\u62E9 {count} \u4E2A\u7269\u4F53\u3002\u8FD9\u91CC\u6539\u7684\u662F\u4E3B\u9009\u4E2D\u9879\uFF0C\u624B\u67C4\u4F1A\u4F5C\u7528\u5230\u5168\u90E8\u672A\u9501\u5B9A\u7269\u4F53\u3002",
      "inspector.locked": "\u5DF2\u9501\u5B9A",
      "inspector.visible": "\u663E\u793A",
      "inspector.unlock": "\u89E3\u9501",
      "inspector.lockHint": "\u9501\u5B9A\u540E\u89C6\u53E3\u70B9\u9009\u7A7F\u900F",
      "inspector.sceneSettings": "\u573A\u666F\u8BBE\u7F6E",
      "inspector.transform": "\u53D8\u6362",
      "inspector.position": "\u4F4D\u7F6E",
      "inspector.rotation": "\u65CB\u8F6C",
      "inspector.scale": "\u7F29\u653E",
      "inspector.resetPosition": "\u91CD\u7F6E\u4F4D\u7F6E",
      "inspector.resetRotation": "\u91CD\u7F6E\u65CB\u8F6C",
      "inspector.resetScale": "\u91CD\u7F6E\u7F29\u653E",
      "inspector.model": "\u6A21\u578B\u52A8\u753B",
      "character.title": "\u89D2\u8272",
      "character.enable": "\u8BD5\u73A9\u65F6\u53EF\u64CD\u63A7",
      "character.driver": "\u79FB\u52A8\u9A71\u52A8",
      "character.driver.capsule": "\u80F6\u56CA",
      "character.driver.nav": "\u5BFC\u822A",
      "character.driver.hybrid": "\u6DF7\u5408",
      "character.mode": "\u671D\u5411",
      "character.mode.adventure": "\u7B2C\u4E09\u4EBA\u79F0\u81EA\u7531",
      "character.mode.strafe": "\u8D8A\u80A9\u6A2A\u79FB",
      "character.mode.lockOn": "\u9501\u5B9A\u73AF\u7ED5",
      "character.mode.pointAndClick": "\u70B9\u51FB\u5730\u9762",
      "character.mode.topDown": "\u4FEF\u89C6\u5168\u5411",
      "character.mode.side25d": "\u6A2A\u7248",
      "character.mode.firstPerson": "\u7B2C\u4E00\u4EBA\u79F0",
      "character.click": "\u70B9\u51FB\u952E",
      "character.clickRight": "\u53F3\u952E",
      "character.clickLeft": "\u5DE6\u952E",
      "character.walk": "\u884C\u8D70\u901F\u5EA6",
      "character.turn": "\u8F6C\u8EAB\u901F\u5EA6 (\xB0/s)",
      "character.sprint": "\u75BE\u8DD1\u500D\u7387",
      "character.jump": "\u8D77\u8DF3\u901F\u5EA6",
      "character.jumps": "\u8DF3\u8DC3\u6BB5\u6570",
      "character.coyote": "\u79BB\u5730\u5BBD\u9650",
      "character.buffer": "\u8DF3\u8DC3\u9884\u8F93\u5165",
      "character.dash": "\u95EA\u907F",
      "character.dashKey": "\u95EA\u907F\u952E",
      "character.dashDistance": "\u95EA\u907F\u8DDD\u79BB",
      "character.radius": "\u80F6\u56CA\u534A\u5F84",
      "character.height": "\u80F6\u56CA\u9AD8\u5EA6",
      "character.capsuleOffset": "\u504F\u79FB",
      "character.physicsInteract": "\u7269\u7406\u4EA4\u4E92",
      "character.mass": "\u4F53\u91CD (kg)",
      "character.pushStrength": "\u63A8\u529B\u500D\u7387",
      "character.swim": "\u9047\u6C34\u6E38\u6CF3",
      "character.swimSpeed": "\u6C34\u4E2D\u79FB\u901F\u500D\u7387",
      "character.swimHeightOffset": "\u6C34\u4E2D\u9AD8\u5EA6\u504F\u79FB",
      "character.gravity": "\u91CD\u529B",
      "character.clickStop": "\u5230\u8FBE\u534A\u5F84",
      "character.footstep": "\u811A\u6B65\u95F4\u9694",
      "character.footstepJuice": "\u811A\u6B65\u6253\u51FB\u611F",
      "character.dashDuration": "\u95EA\u907F\u65F6\u957F",
      "character.dashInvincible": "\u65E0\u654C\u65F6\u95F4",
      "character.dashCooldown": "\u95EA\u907F\u51B7\u5374",
      "character.section.control": "\u63A7\u5236",
      "character.section.move": "\u79FB\u52A8",
      "character.section.body": "\u4F53\u578B",
      "character.section.clips": "\u5E95\u52A8\u753B",
      "character.lock": "\u9501\u5B9A\u76EE\u6807",
      "character.pickLock": "\u9009\u62E9\u9501\u5B9A\u76EE\u6807",
      "character.idle": "\u5F85\u673A\u7247\u6BB5",
      "character.walkClip": "\u884C\u8D70\u7247\u6BB5",
      "character.runClip": "\u75BE\u8DD1\u7247\u6BB5",
      "character.jumpClip": "\u8D77\u8DF3",
      "character.airClip": "\u6EDE\u7A7A",
      "character.landClip": "\u843D\u5730",
      "character.dodgeClip": "\u95EA\u907F\u7247\u6BB5",
      "character.swimIdleClip": "\u6C34\u4E2D\u5F85\u673A",
      "character.swimClip": "\u6E38\u6CF3\u7247\u6BB5",
      "character.hint": "WASD \u79FB\u52A8\uFF0CShift \u75BE\u8DD1\uFF0C\u7A7A\u683C\u8DF3\uFF0C\u95EA\u907F\u952E\u9ED8\u8BA4 C\u3002\u70B9\u51FB\u6A21\u5F0F\u7528\u6240\u9009\u9F20\u6807\u952E\u70B9\u5730\u9762\u3002\u955C\u5934\u7531\u8DDF\u968F\u955C\u5934\u7EC4\u4EF6\u63A7\u5236\u3002",
      "camera.title": "\u8DDF\u968F\u955C\u5934",
      "camera.enable": "\u8BD5\u73A9\u65F6\u8DDF\u968F",
      "camera.hint": "\u955C\u5934\u770B\u5411\u89C2\u5BDF\u70B9\uFF0C\u5E76\u4FDD\u6301\u8FD9\u6BB5\u504F\u79FB\u3002\u53F3\u952E\u6216\u9F20\u6807\u73AF\u7ED5\u53EF\u4EE5\u8F6C\u89C6\u89D2\uFF0C\u9632\u7A7F\u5899\u4F1A\u5728\u78B0\u5230\u969C\u788D\u524D\u628A\u955C\u5934\u62C9\u8FD1\u3002",
      "camera.preset": "\u673A\u4F4D\u9884\u8BBE",
      "camera.presetPick": "\u5957\u7528\u4E00\u79CD\u673A\u4F4D",
      "camera.target": "\u8DDF\u968F\u76EE\u6807",
      "camera.targetSelf": "\u81EA\u5DF1",
      "camera.pickTarget": "\u9009\u62E9\u8DDF\u968F\u76EE\u6807",
      "camera.orbit": "\u73AF\u7ED5",
      "camera.orbit.rightDrag": "\u6309\u4F4F\u53F3\u952E",
      "camera.orbit.mouse": "\u9F20\u6807\u81EA\u7531\u8F6C",
      "camera.orbit.none": "\u56FA\u5B9A\u89D2\u5EA6",
      "camera.fov": "\u89C6\u91CE",
      "camera.damping": "\u8DDF\u968F\u963B\u5C3C",
      "camera.collision": "\u9632\u7A7F\u5899",
      "camera.zoom": "\u6EDA\u8F6E\u7F29\u653E",
      "camera.zoomSpeed": "\u7F29\u653E\u901F\u5EA6",
      "camera.minDistance": "\u6700\u8FD1\u8DDD\u79BB",
      "camera.maxDistance": "\u6700\u8FDC\u8DDD\u79BB",
      "camera.offset": "\u504F\u79FB",
      "camera.pivot": "\u89C2\u5BDF\u70B9",
      "camera.sensitivity": "\u73AF\u7ED5\u7075\u654F\u5EA6",
      "camera.minPitch": "\u6700\u4F4E\u4FEF\u4EF0",
      "camera.maxPitch": "\u6700\u9AD8\u4FEF\u4EF0",
      "camera.local": "\u8DDF\u968F\u671D\u5411",
      "camera.look": "\u770B\u5411\u76EE\u6807",
      "camera.collisionRadius": "\u63A2\u6D4B\u534A\u5F84",
      "rule.title": "\u5F8B\u4EE4",
      "rule.hint": "\u68C0\u67E5\u5668\u91CC\u53EA\u770B\u6458\u8981\u3002\u89E6\u53D1\u3001\u6761\u4EF6\u548C\u52A8\u4F5C\u6D41\u5728\u5DE5\u4F5C\u53F0\u91CC\u7F16\u6392\u3002\u6761\u4EF6\u4E0D\u6210\u7ACB\u65F6\uFF0C\u91CC\u9762\u7684\u7B49\u5F85\u4E0D\u4F1A\u6267\u884C\u3002",
      "rule.add": "\u65B0\u589E\u89C4\u5219\u5E76\u7F16\u8F91",
      "rule.addStep": "\u6DFB\u52A0\u52A8\u4F5C",
      "rule.remove": "\u5220\u9664",
      "rule.limit": "\u6700\u591A\u5D4C\u5957 3 \u5C42\u3002",
      "rule.cond": "\u6761\u4EF6",
      "rule.message": "\u6D88\u606F",
      "rule.key": "\u6309\u952E",
      "rule.keyHint": "\u70B9\u8FD9\u91CC\u540E\u6309\u4E0B\u6309\u952E",
      "key.hint": "\u70B9\u51FB\u540E\u6309\u4E0B\u6309\u952E",
      "key.listening": "\u8BF7\u6309\u952E\u2026",
      "rule.tag": "\u6807\u7B7E",
      "rule.left": "\u5DE6\u503C",
      "rule.op": "\u6BD4\u8F83",
      "rule.right": "\u53F3\u503C",
      "rule.var": "\u53D8\u91CF",
      "rule.value": "\u6570\u503C",
      "rule.seconds": "\u79D2",
      "rule.clip": "\u7247\u6BB5",
      "rule.trigger.playStart": "\u8BD5\u73A9\u5F00\u59CB",
      "rule.trigger.interact": "\u4EA4\u4E92",
      "rule.trigger.key": "\u6309\u952E",
      "rule.trigger.message": "\u6536\u5230\u6D88\u606F",
      "rule.trigger.enter": "\u8FDB\u5165\u533A\u57DF",
      "rule.trigger.exit": "\u79BB\u5F00\u533A\u57DF",
      "rule.trigger.hit": "\u53D7\u5230\u547D\u4E2D",
      "rule.cond.always": "\u59CB\u7EC8\u6210\u7ACB",
      "rule.cond.hasTag": "\u6301\u6709\u6807\u7B7E",
      "rule.cond.missingTag": "\u6CA1\u6709\u6807\u7B7E",
      "rule.cond.compare": "\u53D8\u91CF\u6BD4\u8F83",
      "rule.cond.formula": "\u516C\u5F0F\u4E3A\u771F",
      "rule.step.message": "\u53D1\u9001\u6D88\u606F",
      "rule.step.setVar": "\u5199\u53D8\u91CF",
      "rule.step.addTag": "\u6DFB\u52A0\u6807\u7B7E",
      "rule.step.removeTag": "\u79FB\u9664\u6807\u7B7E",
      "rule.step.wait": "\u7B49\u5F85\u79D2\u6570",
      "rule.step.waitFrame": "\u7B49\u5F85\u4E00\u5E27",
      "rule.step.waitUpper": "\u7B49\u5230\u8986\u76D6\u7ED3\u675F",
      "rule.step.waitMark": "\u7B49\u5230\u8FDB\u5EA6",
      "rule.step.playClip": "\u64AD\u653E\u7247\u6BB5",
      "rule.step.playUpper": "\u64AD\u653E\u8986\u76D6",
      "rule.step.stance": "\u4FDD\u6301\u59FF\u6001",
      "rule.step.if": "\u5982\u679C",
      "rule.step.gather": "\u6536\u96C6\u5468\u56F4",
      "rule.step.each": "\u904D\u5386\u76EE\u6807",
      "rule.step.switchState": "\u5207\u6362\u72B6\u6001",
      "rule.step.showUi": "\u663E\u793A\u754C\u9762",
      "rule.step.hideUi": "\u9690\u85CF\u754C\u9762",
      "rule.step.lock": "\u9501\u5B9A\u76EE\u6807",
      "rule.step.camera": "\u5207\u6362\u955C\u5934",
      "rule.step.moveTo": "\u8D70\u5230",
      "rule.step.spawn": "\u751F\u6210\u9884\u5236\u4F53",
      "rule.step.hide": "\u9500\u6BC1\u81EA\u8EAB",
      "rule.step.score": "\u52A0\u5206",
      "rule.step.juice": "\u64AD\u653E\u6253\u51FB\u611F",
      "rule.step.sound": "\u64AD\u653E\u58F0\u97F3",
      "rule.sound.sfx": "\u97F3\u6548",
      "rule.sound.music": "\u97F3\u4E50",
      "rule.step.log": "\u8F93\u51FA\u5230\u63A7\u5236\u53F0",
      "rule.formula": "\u516C\u5F0F\uFF0C\u5927\u4E8E 0 \u6210\u7ACB\u3002\u53EF\u7528 clamp(\u503C, \u6700\u5C0F, \u6700\u5927) \u548C msg.\u5B57\u6BB5",
      "rule.mark": "\u8FDB\u5EA6 0 \u5230 1",
      "rule.target": "\u540D\u79F0",
      "rule.offset": "\u504F\u79FB x,y,z",
      "rule.amount": "\u5206\u6570\u6216\u516C\u5F0F",
      "rule.radius": "\u534A\u5F84",
      "rule.angle": "\u5939\u89D2\uFF0C0 \u4E3A\u4EFB\u610F",
      "rule.pickTag": "\u9009\u62E9\u73A9\u6CD5\u6807\u7B7E",
      "rule.pickJuice": "\u9009\u62E9\u6253\u51FB\u611F",
      "rule.pickNode": "\u9009\u62E9\u7269\u4F53",
      "rule.pickCamera": "\u9009\u62E9\u955C\u5934",
      "rule.pickScreen": "\u9009\u62E9\u754C\u9762",
      "rule.pickPrefab": "\u9009\u62E9\u9884\u5236\u4F53",
      "rule.pickEmpty": "\u6CA1\u6709\u53EF\u9009\u9879",
      "rule.packMissing": "\u7F3A\u5931\uFF08{kind}\uFF09",
      "rule.packDisabledHint": "\u6240\u5C5E\u73A9\u6CD5\u5305\u672A\u5F00\u542F\uFF0C\u8BD5\u73A9\u65F6\u8DF3\u8FC7",
      "rule.logText": "\u8981\u8F93\u51FA\u7684\u6587\u672C",
      "rule.open": "\u6253\u5F00\u5F8B\u4EE4\u5DE5\u4F5C\u53F0\uFF08{count} \u6761\uFF09",
      "rule.note": "\u4EA4\u4E92\u3001\u8FDB\u51FA\u533A\u57DF\u3001\u547D\u4E2D\u548C\u6D88\u606F\u90FD\u4F1A\u9001\u5230\u8FD9\u91CC\u3002\u70B9\u4E00\u6761\u89C4\u5219\uFF0C\u6216\u6253\u5F00\u5DE5\u4F5C\u53F0\u7F16\u6392\u3002",
      "rule.unnamed": "\u672A\u547D\u540D\u89C4\u5219",
      "rule.enabled": "\u542F\u7528\u6B64\u6761\u5F8B\u4EE4",
      "rule.duplicate": "\u590D\u5236\u5F53\u524D\u89C4\u5219",
      "rule.when": "\u5F53\u53D1\u751F\u4EE5\u4E0B\u4E8B\u4EF6\u65F6",
      "rule.ifTitle": "\u4E14\u540C\u65F6\u6EE1\u8DB3\u4EE5\u4E0B\u6761\u4EF6",
      "rule.doTitle": "\u6309\u987A\u5E8F\u6267\u884C",
      "rule.addCond": "\u6DFB\u52A0\u6761\u4EF6",
      "rule.noCond": "\u6CA1\u6709\u989D\u5916\u6761\u4EF6\uFF0C\u89E6\u53D1\u540E\u76F4\u63A5\u6267\u884C\u4E0B\u9762\u7684\u52A8\u4F5C\u3002",
      "rule.noStep": "\u8FD8\u6CA1\u6709\u52A8\u4F5C\u3002",
      "rule.addChild": "\u6DFB\u52A0\u5B50\u6B65\u9AA4",
      "rule.rules": "\u89C4\u5219",
      "rule.states": "\u72B6\u6001\u6811",
      "rule.done": "\u5B8C\u6210\u5E76\u5173\u95ED",
      "rule.workbench": "\u884C\u4E3A\u5F8B\u4EE4\u5DE5\u4F5C\u53F0",
      "rule.count": "\u5171 {count} \u6761",
      "rule.list": "\u5F8B\u4EE4\u89C4\u5219",
      "rule.empty": "\u8FD8\u6CA1\u6709\u89C4\u5219\u3002\u70B9\u5DE6\u4E0A\u89D2\u65B0\u589E\u3002",
      "rule.name": "\u89C4\u5219\u540D\u79F0",
      "rule.triggerKind": "\u89E6\u53D1\u65F6\u673A",
      "rule.alwaysPass": "\u59CB\u7EC8\u901A\u8FC7",
      "rule.stateName": "\u72B6\u6001\u540D\u79F0",
      "rule.enterCond": "\u8FDB\u5165\u6761\u4EF6",
      "rule.enterHint": "\u53EA\u5728\u4F5C\u4E3A\u5B50\u72B6\u6001\u65F6\u5224\u65AD\u3002\u7559\u7A7A\u8868\u793A\u53EF\u4EE5\u8FDB\u5165\u3002",
      "rule.jump": "\u8DF3\u8F6C\u5230\u522B\u7684\u72B6\u6001",
      "rule.noJump": "\u6CA1\u6709\u8DF3\u8F6C\u65F6\u4F1A\u7559\u5728\u8FD9\u91CC\u3002",
      "rule.addJump": "\u6DFB\u52A0\u8DF3\u8F6C",
      "rule.pickState": "\u9009\u62E9\u76EE\u6807",
      "rule.addState": "\u6DFB\u52A0\u72B6\u6001",
      "rule.addChildState": "\u6DFB\u52A0\u5B50\u72B6\u6001",
      "rule.noState": "\u8FD8\u6CA1\u6709\u72B6\u6001\u3002\u8D70\u8DEF\u4ECD\u7531\u89D2\u8272\u8D1F\u8D23\uFF0C\u8FD9\u91CC\u5199\u63A2\u7D22\u3001\u6218\u6597\u3001\u786C\u76F4\u8FD9\u7C7B\u72B6\u6001\u3002",
      "rule.lane.enter": "\u8FDB\u5165",
      "rule.lane.tick": "\u6BCF\u5E27",
      "rule.lane.exit": "\u9000\u51FA",
      "rule.lane.enterHint": "\u521A\u8FDB\u5165\u8FD9\u4E2A\u72B6\u6001\u65F6\u6267\u884C\u4E00\u6B21\u3002",
      "rule.lane.tickHint": "\u7559\u5728\u8FD9\u4E2A\u72B6\u6001\u65F6\u53CD\u590D\u6267\u884C\u3002\u6301\u7EED\u6548\u679C\u8BF7\u52A0\u7B49\u5F85\uFF0C\u907F\u514D\u6BCF\u5E27\u90FD\u89E6\u53D1\u3002",
      "rule.lane.exitHint": "\u79BB\u5F00\u8FD9\u4E2A\u72B6\u6001\u65F6\u6267\u884C\u4E00\u6B21\u3002",
      "rule.live": "\u6B63\u5728\u6267\u884C",
      "rule.waiting": "\u6B63\u5728\u7B49\u5F85",
      "rule.footer": "\u4FEE\u6539\u4F1A\u8BB0\u5165\u64A4\u9500\u3002\u6761\u4EF6\u662F\u6807\u7B7E\u6216\u53D8\u91CF\u6BD4\u8F83\uFF0C\u5168\u90E8\u6210\u7ACB\u624D\u7EE7\u7EED\u3002",
      "interact.title": "\u667A\u80FD\u4EA4\u4E92\u70B9",
      "interact.enable": "\u53EF\u4EA4\u4E92",
      "interact.prompt": "\u63D0\u793A\u6587\u6848",
      "interact.key": "\u4EA4\u4E92\u952E",
      "interact.radius": "\u534A\u5F84",
      "interact.tag": "\u4EA4\u4E92\u8005\u6807\u7B7E",
      "interact.any": "\u4EFB\u610F\u89D2\u8272",
      "mover.title": "\u79FB\u52A8\u5E73\u53F0",
      "mover.enable": "\u542F\u7528",
      "mover.offset": "\u4F4D\u79FB",
      "mover.duration": "\u5355\u7A0B\u79D2\u6570",
      "mover.pause": "\u7AEF\u70B9\u505C\u987F",
      "mover.carry": "\u8F7D\u4EBA\u534A\u5F84",
      "mover.ping": "\u5F80\u8FD4",
      "mover.auto": "\u8FDB\u573A\u5373\u52A8",
      "mover.message": "\u542F\u52A8\u6D88\u606F",
      "checkpoint.title": "\u68C0\u67E5\u70B9",
      "checkpoint.enable": "\u542F\u7528",
      "checkpoint.spawn": "\u521D\u59CB\u51FA\u751F\u70B9",
      "checkpoint.radius": "\u6FC0\u6D3B\u534A\u5F84",
      "checkpoint.delay": "\u91CD\u751F\u5EF6\u8FDF",
      "checkpoint.abyss": "\u5760\u843D\u9AD8\u5EA6",
      "checkpoint.message": "\u91CD\u751F\u6D88\u606F",
      "score.title": "\u8BA1\u5206",
      "score.enable": "\u542F\u7528",
      "score.hint": "\u754C\u9762\u6587\u5B57\u7ED1\u5B9A\u53D8\u91CF objective\u3001score\u3001timeLeft",
      "score.objective": "\u76EE\u6807\u6807\u9898",
      "score.target": "\u76EE\u6807\u5206\u6570",
      "score.interact": "\u6BCF\u6B21\u4EA4\u4E92",
      "score.time": "\u9650\u65F6\u79D2\u6570",
      "interact.message": "\u4EA4\u4E92\u6D88\u606F",
      "interact.once": "\u53EA\u4EA4\u4E92\u4E00\u6B21",
      "trigger.title": "\u89E6\u53D1\u533A",
      "trigger.enable": "\u542F\u7528",
      "trigger.radius": "\u534A\u5F84",
      "trigger.tag": "\u5BF9\u8C61\u6807\u7B7E",
      "trigger.enter": "\u8FDB\u5165\u6D88\u606F",
      "trigger.exit": "\u79BB\u5F00\u6D88\u606F",
      "trigger.once": "\u53EA\u89E6\u53D1\u4E00\u6B21",
      "inspector.savePrefab": "\u5B58\u4E3A\u9884\u5236\u4F53",
      "inspector.shortSavePrefab": "\u5B58\u9884\u5236",
      "inspector.shortPreview": "\u9884\u89C8",
      "prefab.edit": "\u6253\u5F00\u7269\u4F53\u6A21\u677F",
      "prefab.shortEdit": "\u6253\u5F00",
      "prefab.shortReveal": "\u5B9A\u4F4D",
      "prefab.shortApply": "\u8986\u76D6",
      "prefab.shortRevert": "\u8FD8\u539F",
      "prefab.shortUnpack": "\u8131\u79BB",
      "prefab.instance": "\u7269\u4F53\u6A21\u677F\u5B9E\u4F8B",
      "prefab.apply": "\u8986\u76D6\u6A21\u677F",
      "prefab.revert": "\u8FD8\u539F\u9884\u5236\u4F53",
      "prefab.unpack": "\u8131\u79BB\u6A21\u677F",
      "prefab.saveAs": "\u5B58\u4E3A\u7269\u4F53\u6A21\u677F\u2026",
      "prefab.saveHint": "\u540D\u79F0\u7559\u7A7A\u5219\u4F7F\u7528\u300C{name}\u300D\u3002",
      "prefab.reveal": "\u5B9A\u4F4D\u7269\u4F53\u6A21\u677F",
      "prefab.openHint": "\u5355\u51FB\u6253\u5F00\u7269\u4F53\u6A21\u677F",
      "prefab.cancel": "\u53D6\u6D88",
      "prefab.confirm": "\u786E\u5B9A",
      "prefab.discard": "\u4E0D\u4FDD\u5B58\u8FD4\u56DE",
      "prefab.unpackTitle": "\u8131\u79BB\u7269\u4F53\u6A21\u677F",
      "prefab.unpackMessage": "\u8131\u79BB\u540E\uFF0C\u8FD9\u4E2A\u5B9E\u4F8B\u4F1A\u53D8\u6210\u666E\u901A\u7269\u4F53\uFF0C\u4E0D\u518D\u8DDF\u968F\u6A21\u677F\u66F4\u65B0\u3002",
      "prefab.alreadyInstance": "\u8FD9\u5DF2\u7ECF\u662F\u7269\u4F53\u6A21\u677F\u5B9E\u4F8B\u3002\u8BF7\u5148\u8131\u79BB\u6A21\u677F\uFF0C\u518D\u5B58\u6210\u65B0\u6A21\u677F\u3002",
      "prefab.rebind": "\u91CD\u7ED1\u6A21\u677F",
      "prefab.rebindPick": "\u9009\u62E9\u76EE\u6807\u6A21\u677F\u2026",
      "prefab.rebound": "\u5DF2\u628A\u7F3A\u5931\u6A21\u677F\u7684\u5B9E\u4F8B\u6539\u7ED1\u5230\u65B0\u6A21\u677F",
      "prefab.editing": "\u6B63\u5728\u7F16\u8F91\u9884\u5236\u4F53 {name}",
      "prefab.saveBack": "\u4FDD\u5B58\u5E76\u8FD4\u56DE",
      "prefab.saved": "\u9884\u5236\u4F53\u5DF2\u4FDD\u5B58\uFF0C\u5B9E\u4F8B\u5DF2\u66F4\u65B0",
      "prefab.closed": "\u5DF2\u8FD4\u56DE\u573A\u666F",
      "prefab.applied": "\u5DF2\u628A\u5B9E\u4F8B\u4FEE\u6539\u5199\u56DE\u9884\u5236\u4F53",
      "prefab.reverted": "\u5DF2\u8FD8\u539F\u4E3A\u9884\u5236\u4F53",
      "prefab.unpacked": "\u5DF2\u89E3\u5F00\u9884\u5236\u4F53",
      "prefab.place": "\u653E\u7F6E {name}",
      "prefab.create": "\u521B\u5EFA\u9884\u5236\u4F53 {name}",
      "prefab.needOne": "\u8BF7\u53EA\u9009\u62E9\u4E00\u4E2A\u7269\u4F53\u6216\u5176\u5B50\u6811\u6765\u521B\u5EFA\u9884\u5236\u4F53",
      "prefab.exitFirst": "\u5148\u9000\u51FA\u9884\u5236\u4F53\u7F16\u8F91",
      "prefab.noPlay": "\u9884\u5236\u4F53\u7F16\u8F91\u4E2D\u4E0D\u80FD\u8BD5\u73A9",
      "prefab.keepRoot": "\u9884\u5236\u4F53\u6839\u7269\u4F53\u4E0D\u80FD\u5220\u9664",
      "prefab.rootLocked": "\u9884\u5236\u4F53\u6839\u7269\u4F53\u7684\u53D8\u6362\u56FA\u5B9A\u5728\u539F\u70B9",
      "prefab.missing": "\u627E\u4E0D\u5230\u9884\u5236\u4F53",
      "prefab.dirty": "\u6709\u672A\u5199\u56DE\u7684\u4FEE\u6539",
      "inspector.previewModel": "\u9884\u89C8\u6A21\u578B",
      "inspector.light": "\u5149\u6E90",
      "inspector.color": "\u989C\u8272",
      "inspector.intensity": "\u5F3A\u5EA6",
      "inspector.angle": "\u89D2\u5EA6",
      "inspector.ground": "\u5730\u9762",
      "inspector.range": "\u8303\u56F4",
      "inspector.decay": "\u8870\u51CF",
      "inspector.penumbra": "\u534A\u5F71",
      "inspector.shadow": "\u9634\u5F71",
      "inspector.bias": "\u504F\u79FB",
      "inspector.normalBias": "\u6CD5\u7EBF\u504F\u79FB",
      "inspector.camera": "\u76F8\u673A",
      "inspector.fov": "\u89C6\u91CE",
      "inspector.near": "\u8FD1\u88C1",
      "inspector.far": "\u8FDC\u88C1",
      "inspector.material": "\u6750\u8D28",
      "inspector.asset": "\u8D44\u6E90",
      "inspector.type": "\u7C7B\u578B",
      "inspector.file": "\u6587\u4EF6",
      "inspector.objects": "\u7269\u4F53",
      "inspector.clips": "\u7247\u6BB5",
      "inspector.preview": "\u9884\u89C8",
      "inspector.place": "\u653E\u5165\u573A\u666F",
      "inspector.unnamedScene": "\u672A\u547D\u540D\u573A\u666F",
      "inspector.scene": "\u573A\u666F",
      "physics.enable": "\u7269\u7406",
      "particles.enable": "\u7279\u6548",
      "particles.title": "\u7279\u6548",
      "particles.playing": "\u64AD\u653E",
      "particles.material": "\u6750\u8D28",
      "particles.materialEmpty": "\u9ED8\u8BA4\u53E0\u52A0",
      "particles.clearMaterial": "\u6E05\u9664\u6750\u8D28",
      "particles.saveAsset": "\u5B58\u6210\u8D44\u6E90",
      "particles.saved": "\u5DF2\u628A {name} \u5B58\u6210\u7279\u6548\u8D44\u6E90",
      "particles.missing": "\u7279\u6548\u80FD\u529B\u672A\u5F00\u542F\uFF0C\u8FD9\u4E2A\u7269\u4F53\u4E0D\u4F1A\u64AD\u653E\u3002",
      "particles.missingAsset": "\u7F3A\u5C11\u7279\u6548\u8D44\u6E90\u3002",
      "particles.badMaterial": "\u8FD9\u5F20\u6750\u8D28\u4E0D\u662F\u7C92\u5B50\u65E0\u5149\uFF0C\u5916\u89C2\u4E0D\u4F1A\u7528\u5230\u5B83\u3002",
      "particles.version": "\u8FD9\u4EFD\u7279\u6548\u7531 quarks {version} \u5199\u6210\uFF0C\u5F53\u524D\u8FD0\u884C\u5E93\u662F {current}\u3002",
      "particles.loadFail": "\u8FD9\u4EFD\u7279\u6548\u8BFB\u4E0D\u51FA\u6765\uFF1A{message}",
      "particles.imported": "\u5DF2\u5BFC\u5165\u7279\u6548 {name}",
      "particles.notQuarks": "{name} \u4E0D\u662F Quarks \u7279\u6548",
      "particles.noEmitter": "\u8FD9\u4EFD\u7279\u6548\u91CC\u6CA1\u6709\u53EF\u7F16\u8F91\u7684\u53D1\u5C04\u5668\u3002",
      "particles.emitter": "\u53D1\u5C04\u5668",
      "particles.main": "\u4E3B\u6A21\u5757",
      "particles.duration": "\u65F6\u957F",
      "particles.looping": "\u5FAA\u73AF",
      "particles.prewarm": "\u9884\u70ED",
      "particles.worldSpace": "\u4E16\u754C\u7A7A\u95F4",
      "particles.renderMode": "\u6E32\u67D3",
      "particles.billboard": "\u516C\u544A\u677F",
      "particles.stretched": "\u62C9\u4F38\u516C\u544A\u677F",
      "particles.horizontal": "\u6C34\u5E73\u516C\u544A\u677F",
      "particles.vertical": "\u5782\u76F4\u516C\u544A\u677F",
      "particles.mesh": "\u7F51\u683C",
      "particles.trail": "\u62D6\u5C3E",
      "particles.emission": "\u53D1\u5C04",
      "particles.rate": "\u6BCF\u79D2",
      "particles.burst": "\u7206\u53D1",
      "particles.burstsLocked": "\u6709\u591A\u6B21\u7206\u53D1\uFF0C\u68C0\u67E5\u5668\u91CC\u4E0D\u6539\u3002",
      "particles.start": "\u521D\u59CB",
      "particles.life": "\u751F\u547D",
      "particles.speed": "\u901F\u5EA6",
      "particles.size": "\u5927\u5C0F",
      "particles.rotation": "\u65CB\u8F6C",
      "particles.color": "\u989C\u8272",
      "particles.tint": "\u67D3\u8272",
      "particles.alpha": "\u900F\u660E",
      "particles.shape": "\u5F62\u72B6",
      "particles.shapeType": "\u7C7B\u578B",
      "particles.shapePoint": "\u70B9",
      "particles.shapeCone": "\u9525\u4F53",
      "particles.shapeSphere": "\u7403\u4F53",
      "particles.shapeHemisphere": "\u534A\u7403",
      "particles.shapeCircle": "\u5706",
      "particles.shapeDonut": "\u5706\u73AF",
      "particles.shapeRectangle": "\u77E9\u5F62",
      "particles.radius": "\u534A\u5F84",
      "particles.angle": "\u89D2\u5EA6",
      "particles.arc": "\u5F20\u89D2",
      "particles.thickness": "\u539A\u5EA6",
      "particles.width": "\u5BBD",
      "particles.height": "\u9AD8",
      "particles.sheet": "\u5E8F\u5217\u5E27",
      "particles.tilesX": "\u5217",
      "particles.tilesY": "\u884C",
      "particles.force": "\u529B",
      "particles.gravity": "\u91CD\u529B",
      "particles.gravityLocked": "\u5DF2\u6709\u659C\u5411\u7684\u529B\uFF0C\u91CD\u529B\u4E0D\u5728\u8FD9\u91CC\u6539\u3002",
      "particles.speedFactor": "\u901F\u5EA6\u62C9\u4F38",
      "particles.lengthFactor": "\u957F\u5EA6",
      "particles.trailLength": "\u62D6\u5C3E\u8282\u6570",
      "particles.modules": "\u66F2\u7EBF\u6A21\u5757",
      "particles.moduleColor": "\u989C\u8272\u968F\u751F\u547D",
      "particles.moduleSize": "\u5927\u5C0F\u968F\u751F\u547D",
      "particles.moduleNoise": "\u566A\u58F0",
      "particles.moduleOther": "{name}",
      "particles.min": "\u6700\u5C0F",
      "particles.max": "\u6700\u5927",
      "particles.curve": "\u8FD9\u6761\u662F\u66F2\u7EBF\uFF0C\u68C0\u67E5\u5668\u91CC\u4E0D\u6539\u3002",
      "particles.shared": "\u6B63\u5728\u6539\u8D44\u6E90\u300C{name}\u300D\uFF0C\u5F15\u7528\u5B83\u7684\u7269\u4F53\u90FD\u4F1A\u53D8\u3002",
      "particles.createMaterial": "\u521B\u5EFA\u7C92\u5B50\u6750\u8D28",
      "physics.title": "\u7269\u7406",
      "physics.participate": "\u53C2\u4E0E\u7269\u7406",
      "physics.body": "\u521A\u4F53",
      "physics.static": "\u9759\u6001",
      "physics.dynamic": "\u52A8\u6001",
      "physics.kinematic": "\u8FD0\u52A8\u5B66",
      "physics.shape": "\u5F62\u72B6",
      "physics.box": "\u76D2\u5B50",
      "physics.sphere": "\u7403\u4F53",
      "physics.capsule": "\u80F6\u56CA",
      "physics.cylinder": "\u5706\u67F1",
      "physics.cone": "\u5706\u9525",
      "physics.convex": "\u51F8\u5305",
      "physics.trimesh": "\u4E09\u89D2\u7F51\u683C",
      "physics.convexHint": "\u7528\u7269\u4F53\u7F51\u683C\u7684\u51F8\u5305\u3002\u53EF\u4EE5\u662F\u52A8\u6001\u521A\u4F53\uFF0C\u51F9\u8FDB\u53BB\u7684\u90E8\u5206\u4E0D\u4F1A\u6321\u4F4F\u3002",
      "physics.trimeshHint": "\u7528\u7269\u4F53\u7F51\u683C\u7684\u4E09\u89D2\u9762\uFF0C\u53EF\u4EE5\u662F\u51F9\u7684\u3002\u9002\u5408\u9759\u6001\u548C\u8FD0\u52A8\u5B66\uFF1B\u52A8\u6001\u7269\u4F53\u66F4\u7A33\u7684\u662F\u51F8\u5305\u3002",
      "physics.radius": "\u534A\u5F84",
      "physics.height": "\u9AD8\u5EA6",
      "physics.size": "\u5C3A\u5BF8",
      "physics.trigger": "\u89E6\u53D1\u5668",
      "physics.mass": "\u8D28\u91CF",
      "physics.friction": "\u6469\u64E6",
      "physics.restitution": "\u5F39\u6027",
      "physics.linearDamping": "\u7EBF\u963B\u5C3C",
      "physics.angularDamping": "\u89D2\u963B\u5C3C",
      "physics.gravityScale": "\u91CD\u529B\u7F29\u653E",
      "physics.gravity": "\u91CD\u529B",
      "audio.title": "\u97F3\u6548",
      "audio.master": "\u603B\u97F3\u91CF",
      "audio.music": "\u97F3\u4E50",
      "audio.sfx": "\u97F3\u6548",
      "audio.volume": "\u97F3\u91CF",
      "audio.pick": "\u9009\u62E9\u97F3\u6548",
      "audio.hint": "\u7F51\u9875\u7248\u5728\u7B2C\u4E00\u6B21\u70B9\u51FB\u9875\u9762\u4E4B\u540E\u624D\u80FD\u51FA\u58F0\u3002\u684C\u9762\u7248\u6253\u5F00\u5C31\u80FD\u64AD\u3002",
      "soundSource.title": "\u58F0\u6E90",
      "soundSource.enable": "\u542F\u7528",
      "soundSource.clip": "\u58F0\u97F3",
      "soundSource.loop": "\u5FAA\u73AF",
      "soundSource.distance": "\u6E05\u6670\u8DDD\u79BB",
      "soundSource.rolloff": "\u8870\u51CF",
      "soundSource.hint": "\u8BD5\u73A9\u65F6\u5728\u8FD9\u4E2A\u7269\u4F53\u4E0A\u64AD\u653E\uFF0C\u4F4D\u7F6E\u8DDF\u7740\u7269\u4F53\u8D70\u3002\u5173\u6389\u5FAA\u73AF\u5C31\u53EA\u64AD\u4E00\u904D\u3002",
      "physics.disabledHint": "\u7269\u7406\u80FD\u529B\u5305\u5DF2\u5173\u95ED\u3002\u78B0\u649E\u6570\u636E\u4ECD\u7559\u5728\u7269\u4F53\u4E0A\u3002",
      "navigation.enable": "\u5BFC\u822A",
      "navigation.title": "\u5BFC\u822A",
      "navigation.participate": "\u53C2\u4E0E\u5BFC\u822A",
      "navigation.role": "\u7528\u9014",
      "navigation.surface": "\u8868\u9762",
      "navigation.obstacle": "\u969C\u788D",
      "navigation.radius": "\u534A\u5F84",
      "navigation.height": "\u9AD8\u5EA6",
      "navigation.cellSize": "\u683C\u5B50\u5927\u5C0F",
      "navigation.cellHeight": "\u683C\u5B50\u9AD8\u5EA6",
      "navigation.slope": "\u6700\u5927\u5761\u5EA6",
      "navigation.agentRadius": "\u4EE3\u7406\u534A\u5F84",
      "navigation.agentHeight": "\u4EE3\u7406\u9AD8\u5EA6",
      "navigation.maxObstacles": "\u969C\u788D\u5BB9\u91CF",
      "navigation.show": "\u663E\u793A\u7F51\u683C",
      "navigation.bake": "\u70D8\u7119",
      "navigation.rebake": "\u91CD\u65B0\u70D8\u7119",
      "navigation.clear": "\u6E05\u7A7A",
      "navigation.cleared": "\u5DF2\u6E05\u7A7A\u5BFC\u822A\u7F51\u683C",
      "navigation.cancel": "\u53D6\u6D88\u70D8\u7119",
      "navigation.baking": "\u6B63\u5728\u70D8\u7119\u2026",
      "navigation.ready": "\u53EF\u884C\u8D70\u9762\u5DF2\u751F\u6210",
      "navigation.noSurface": "\u6CA1\u6709\u53EF\u70D8\u7119\u7684\u5BFC\u822A\u8868\u9762\u3002",
      "navigation.disabledHint": "\u5BFC\u822A\u80FD\u529B\u5305\u5DF2\u5173\u95ED\u3002\u8868\u9762\u548C\u969C\u788D\u6570\u636E\u4ECD\u7559\u5728\u7269\u4F53\u4E0A\u3002",
      "navigation.stale": "\u53C2\u6570\u5DF2\u53D8\u5316\uFF0C\u9700\u8981\u91CD\u65B0\u70D8\u7119\u3002",
      "navigation.triangles": "\u8868\u9762\u4E09\u89D2\u5F62",
      "navigation.obstacleHint": "\u969C\u788D\u5BB9\u91CF\u5927\u4E8E 0 \u65F6\uFF0C\u8BD5\u73A9\u4F1A\u7528\u7AD6\u76F4\u5706\u67F1\u628A\u969C\u788D\u4ECE\u5BFC\u822A\u7F51\u683C\u4E0A\u6316\u5F00\u3002",
      "projectSettings.title": "\u5DE5\u7A0B\u8BBE\u7F6E",
      "projectSettings.modules": "\u80FD\u529B\u5305",
      "projectSettings.note": "\u5F00\u5173\u4FDD\u5B58\u5728\u5F53\u524D\u5DE5\u7A0B\u91CC\u3002\u5173\u95ED\u540E\u4E0D\u518D\u52A0\u8F7D\u5BF9\u5E94\u6A21\u5757\uFF0C\u5DF2\u586B\u5199\u7684\u6570\u636E\u4E0D\u4F1A\u5220\u9664\u3002",
      "projectSettings.physicsDetail": "\u78B0\u649E\u4F53\u3001\u521A\u4F53\u548C\u8BD5\u73A9\u65F6\u7684\u7269\u7406\u6A21\u62DF\u3002",
      "projectSettings.particlesDetail": "\u7C92\u5B50\u7279\u6548\u3002\u5173\u6389\u540E\u8D44\u6E90\u548C\u7269\u4F53\u4E0A\u7684\u6570\u636E\u8FD8\u5728\uFF0C\u53EA\u662F\u4E0D\u518D\u64AD\u653E\u3002",
      "sky.enable": "\u5929\u7A7A",
      "sky.title": "\u5929\u7A7A",
      "sky.time": "\u65F6\u523B",
      "sky.latitude": "\u7EAC\u5EA6",
      "sky.day": "\u5E74\u79EF\u65E5",
      "sky.north": "\u5317\u5411",
      "sky.northPosZ": "+Z \u4E3A\u5317",
      "sky.northNegZ": "-Z \u4E3A\u5317",
      "sky.northPosX": "+X \u4E3A\u5317",
      "sky.northNegX": "-X \u4E3A\u5317",
      "sky.atmosphere": "\u5927\u6C14",
      "sky.exposure": "\u5929\u7A7A\u66DD\u5149",
      "sky.turbidity": "\u6D51\u6D4A\u5EA6",
      "sky.albedo": "\u5730\u9762\u53CD\u7167\u7387",
      "sky.mirror": "\u5730\u5E73\u7EBF\u4EE5\u4E0B\u955C\u50CF",
      "sky.sun": "\u592A\u9633",
      "sky.sunDisc": "\u592A\u9633\u76D8",
      "sky.angularSize": "\u89D2\u76F4\u5F84 \xB0",
      "sky.sunIntensity": "\u592A\u9633\u5F3A\u5EA6",
      "sky.sunShadow": "\u592A\u9633\u9634\u5F71",
      "sky.haze": "\u7A7A\u6C14\u900F\u89C6",
      "sky.hazeStrength": "\u5F3A\u5EA6",
      "sky.hazeNear": "\u8FD1\u8DDD",
      "sky.fog": "\u9AD8\u5EA6\u96FE",
      "sky.fogColor": "\u989C\u8272",
      "sky.fogSkyColor": "\u8DDF\u968F\u5929\u7A7A",
      "sky.fogDensity": "\u5BC6\u5EA6",
      "sky.fogFalloff": "\u9AD8\u5EA6\u8870\u51CF",
      "sky.fogBase": "\u57FA\u51C6\u9AD8\u5EA6",
      "sky.fogOpacity": "\u6700\u5927\u4E0D\u900F\u660E\u5EA6",
      "sky.night": "\u591C\u665A",
      "sky.stars": "\u661F\u661F",
      "sky.starIntensity": "\u661F\u5149",
      "sky.starSize": "\u661F\u70B9",
      "sky.milkyWay": "\u94F6\u6CB3",
      "sky.moon": "\u6708\u4EAE",
      "sky.moonPhase": "\u6708\u76F8",
      "sky.moonLight": "\u6708\u5149",
      "projectSettings.skyDetail": "\u7A0B\u5E8F\u5316\u5927\u6C14\u548C\u65F6\u523B\u3002\u5F00\u542F\u540E\u53D6\u4EE3\u80CC\u666F\u4E0E\u73AF\u5883\u8D34\u56FE\uFF0C\u91D1\u5C5E\u53CD\u5C04\u8DDF\u7740\u592A\u9633\u53D8\u3002\u5173\u6389\u540E\u53C2\u6570\u7559\u5728\u753B\u9762\u4E0A\u3002",
      "projectSettings.navigationDetail": "\u4ECE\u9759\u6001\u8868\u9762\u70D8\u7119\u5BFC\u822A\u7F51\u683C\u3002\u8BD5\u73A9\u65F6\u969C\u788D\u53EF\u4EE5\u6316\u5F00\u7F51\u683C\uFF0C\u5BFB\u8DEF\u8BFB\u53D6\u8FD9\u4EFD\u7F51\u683C\u3002",
      "projectSettings.catalogs": "\u9879\u76EE\u76EE\u5F55",
      "projectSettings.manage": "\u7BA1\u7406\u2026",
      "tags.title": "\u6807\u7B7E",
      "tags.subtitle": "\u548C Unity \u7684 Tag \u4E00\u6837\uFF1A\u6BCF\u4E2A\u7269\u4F53\u6709\u4E00\u4E2A\u4E3B\u6807\u7B7E\uFF0C\u53E6\u5916\u53EF\u4EE5\u52A0\u591A\u5C42\u6807\u7B7E\uFF0C\u7528\u6765\u7B5B\u9009\u548C\u4EE5\u540E\u7684\u903B\u8F91\u67E5\u627E\u3002",
      "tags.name": "\u540D\u79F0",
      "tags.id": "Id",
      "tags.add": "\u6DFB\u52A0\u6807\u7B7E",
      "tags.addDefault": "\u65B0\u6807\u7B7E",
      "tags.remove": "\u5220\u9664",
      "tags.done": "\u5B8C\u6210",
      "tags.card": "\u6807\u7B7E",
      "tags.none": "\u65E0\u6807\u7B7E",
      "tags.orphan": "\u7F3A\u5931\u7684\u6807\u7B7E {id}",
      "tags.extraPlaceholder": "+ \u8F93\u5165\u5C42\u7EA7\u6807\u7B7E\uFF08\u5982 Team.Enemy\uFF09\u56DE\u8F66\u6DFB\u52A0",
      "tags.gameplay": "\u73A9\u6CD5\u6807\u7B7E",
      "tags.addGameplay": "\u6DFB\u52A0\u73A9\u6CD5\u6807\u7B7E\u2026",
      "tags.runtime": "\u8BD5\u73A9\u4E2D\u7684\u9650\u65F6\u6807\u7B7E",
      "tags.openDatabase": "\u6253\u5F00\u6E38\u620F\u6570\u636E",
      "tags.filter": "\u6309\u6807\u7B7E\u7B5B\u9009",
      "tags.filterAll": "\u5168\u90E8",
      "tags.filterUntagged": "\u4EC5\u65E0\u6807\u7B7E",
      "layers.title": "\u5C42",
      "layers.subtitle": "\u5C42\u540C\u65F6\u7528\u4E8E\u89C6\u53E3\u5254\u9664\u548C\u7269\u7406\u78B0\u649E\u3002\u4F4D 31 \u7559\u7ED9\u7F16\u8F91\u5668\u624B\u67C4\uFF0C\u4E0D\u80FD\u5206\u914D\u3002",
      "layers.tabLayers": "\u5C42\u5217\u8868",
      "layers.tabPhysics": "\u7269\u7406\u78B0\u649E\u77E9\u9635",
      "layers.bit": "\u4F4D",
      "layers.name": "\u540D\u79F0",
      "layers.id": "Id",
      "layers.builtIn": "\u5185\u7F6E",
      "layers.visible": "\u89C6\u53E3",
      "layers.add": "\u6DFB\u52A0\u5C42",
      "layers.addDefault": "\u65B0\u5C42",
      "layers.remove": "\u5220\u9664",
      "layers.done": "\u5B8C\u6210",
      "layers.show": "\u5728\u7F16\u8F91\u89C6\u53E3\u663E\u793A\u8BE5\u5C42",
      "layers.hide": "\u5728\u7F16\u8F91\u89C6\u53E3\u9690\u85CF\u8BE5\u5C42",
      "layers.card": "\u5C42",
      "layers.option": "{name} \xB7 \u4F4D {bit}",
      "layers.matrixEnable": "\u542F\u7528\u78B0\u649E\u77E9\u9635",
      "layers.matrixHint": "\u6BCF\u4E00\u884C\u662F\u4E00\u5BF9\u5C42\u3002\u52FE\u4E0A\u624D\u4F1A\u76F8\u649E\uFF0C\u5DE6\u53F3\u5BF9\u79F0\u3002\u5173\u95ED\u65F6\u6240\u6709\u5C42\u4E92\u76F8\u78B0\u649E\u3002Rapier \u53EA\u4F7F\u7528\u524D 16 \u4F4D\u3002",
      "layers.matrixEmpty": "\u81F3\u5C11\u8981\u6709\u4E24\u5C42\uFF0C\u624D\u4F1A\u51FA\u73B0\u53EF\u52FE\u9009\u7684\u78B0\u649E\u5173\u7CFB\u3002",
      "inspector.column.system": "\u7CFB\u7EDF",
      "inspector.column.packs": "\u6269\u5C55\u5305",
      "inspector.sky": "\u5929\u7A7A",
      "inspector.background": "\u80CC\u666F",
      "inspector.exposure": "\u66DD\u5149",
      "inspector.toneMapping": "\u8272\u8C03\u6620\u5C04",
      "tone.none": "\u65E0",
      "tone.linear": "\u7EBF\u6027",
      "tone.reinhard": "Reinhard",
      "tone.cineon": "Cineon",
      "tone.aces": "ACES",
      "tone.agx": "AgX",
      "tone.neutral": "Neutral",
      "inspector.fog": "\u96FE",
      "inspector.enabled": "\u542F\u7528",
      "inspector.fogColor": "\u96FE\u8272",
      "inspector.fogStart": "\u8D77\u59CB",
      "inspector.fogEnd": "\u7ED3\u675F",
      "inspector.environment": "\u73AF\u5883\u5149\u7167",
      "inspector.env": "\u73AF\u5883",
      "inspector.bloom": "\u6CDB\u5149",
      "inspector.aa": "\u6297\u952F\u9F7F",
      "inspector.ssr": "\u5C4F\u5E55\u53CD\u5C04",
      "inspector.ssrQuality": "\u8D28\u91CF",
      "inspector.ssrDistance": "\u8DDD\u79BB",
      "inspector.ssrThickness": "\u539A\u5EA6",
      "inspector.volume": "\u4F53\u79EF\u5149",
      "inspector.volumeDensity": "\u5BC6\u5EA6",
      "inspector.volumeSteps": "\u6B65\u8FDB",
      "inspector.volumeSize": "\u8303\u56F4",
      "inspector.volumeHeight": "\u9AD8\u5EA6",
      "inspector.ssgi": "\u5168\u5C40\u5149\u7167",
      "inspector.ssgiIndirect": "\u95F4\u63A5\u5149",
      "inspector.ssgiOcclusion": "\u906E\u853D",
      "inspector.ssgiRadius": "\u534A\u5F84",
      "inspector.ssgiSlices": "\u5207\u7247",
      "inspector.ssgiSteps": "\u6B65\u8FDB",
      "inspector.ssgiDenoise": "\u964D\u566A",
      "inspector.radius": "\u534A\u5F84",
      "inspector.threshold": "\u9608\u503C",
      "inspector.dof": "\u666F\u6DF1",
      "inspector.focus": "\u5BF9\u7126",
      "inspector.focal": "\u7126\u6BB5",
      "inspector.bokeh": "\u6563\u666F",
      "inspector.occlusion": "\u906E\u853D",
      "inspector.grade": "\u8C03\u8272",
      "inspector.hue": "\u8272\u76F8",
      "inspector.saturation": "\u9971\u548C",
      "inspector.clip": "\u7247\u6BB5",
      "inspector.play": "\u64AD\u653E",
      "inspector.pause": "\u6682\u505C",
      "inspector.time": "\u65F6\u95F4",
      "inspector.animFile": "\u52A8\u753B\u6587\u4EF6",
      "inspector.modelClips": "\u6A21\u578B\u7247\u6BB5",
      "inspector.fileClips": "\u6587\u4EF6\u7247\u6BB5",
      "humanoid.summary": "\u4EBA\u5F62\u53EF\u7528 \xB7 {skins} \u5957\u8499\u76AE \xB7 {bind} \xB7 {motion}",
      "humanoid.noHips": "\u8FD9\u5957\u9AA8\u67B6\u8FD8\u8BA4\u4E0D\u51FA\u76C6\u9AA8\uFF0C\u8DE8\u6A21\u578B\u52A8\u4F5C\u4E0D\u4F1A\u81EA\u52A8\u5957\u7528\u3002",
      "humanoid.missing": "\u7F3A {names}",
      "humanoid.coreOk": "{count} \u4E2A\u6838\u5FC3\u69FD\u5DF2\u9F50",
      "humanoid.restConflict": "\u8FD9\u4E9B\u9AA8\u5934\u5728\u591A\u5957\u8499\u76AE\u91CC\u7684\u9759\u606F\u59FF\u6001\u4E0D\u4E00\u81F4\uFF1A{names}",
      "humanoid.bind": "\u6709\u7ED1\u5B9A\u59FF\u6001",
      "humanoid.noBind": "\u65E0\u7ED1\u5B9A\u59FF\u6001",
      "humanoid.inPlace": "\u539F\u5730",
      "humanoid.rootMotion": "\u6839\u8FD0\u52A8",
      "humanoid.motionUnknown": "\u4F4D\u79FB\u672A\u5224\u65AD",
      "humanoid.slots": "\u9AA8\u9ABC\u69FD\u4F4D",
      "humanoid.slotsHint": "\u81EA\u52A8\u8BA4\u9519\u65F6\u53EA\u6539\u5BF9\u5E94\u7684\u4E00\u6839\u9AA8\u5934\u3002\u6539\u5B8C\u540E\u91CD\u65B0\u64AD\u653E\u3002",
      "humanoid.auto": "\u81EA\u52A8",
      "humanoid.slotHips": "\u76C6\u9AA8",
      "humanoid.slotSpine": "\u810A\u67F1",
      "humanoid.slotHead": "\u5934",
      "humanoid.slotLeftUpperArm": "\u5DE6\u5927\u81C2",
      "humanoid.slotLeftLowerArm": "\u5DE6\u5C0F\u81C2",
      "humanoid.slotRightUpperArm": "\u53F3\u5927\u81C2",
      "humanoid.slotRightLowerArm": "\u53F3\u5C0F\u81C2",
      "humanoid.slotLeftUpperLeg": "\u5DE6\u5927\u817F",
      "humanoid.slotLeftLowerLeg": "\u5DE6\u5C0F\u817F",
      "humanoid.slotRightUpperLeg": "\u53F3\u5927\u817F",
      "humanoid.slotRightLowerLeg": "\u53F3\u5C0F\u817F",
      "humanoid.adjust": "\u91CD\u5B9A\u5411\u5FAE\u8C03",
      "humanoid.adjustHint": "\u81EA\u52A8\u7ED3\u679C\u4E0D\u5BF9\u65F6\u518D\u62C9\u3002\u6B63\u503C\u5206\u522B\u662F\u80A9\u66F4\u5BBD\u3001\u80A9\u5411\u5916\u65CB\u3001\u624B\u81C2\u66F4\u5F00\u3001\u8098\u66F4\u5F2F\u3001\u80EF\u66F4\u5BBD\u3001\u819D\u66F4\u5F2F\u3001\u811A\u5C16\u5411\u4E0B\u3001\u4EBA\u66F4\u9AD8\u3001\u6B65\u5E45\u66F4\u5927\u3002\u53EA\u4F5C\u7528\u4E8E\u522B\u7684\u9AA8\u67B6\u5957\u5230\u8FD9\u4E2A\u89D2\u8272\u4E0A\u7684\u52A8\u753B\u3002",
      "humanoid.reset": "\u91CD\u7F6E\u4E3A\u81EA\u52A8",
      "humanoid.shoulderWidth": "\u80A9\u5BBD",
      "humanoid.shoulderRotate": "\u80A9\u8180\u65CB\u8F6C",
      "humanoid.armSpread": "\u624B\u81C2\u5F20\u5F00",
      "humanoid.elbowBend": "\u8098\u89D2",
      "humanoid.hipSpread": "\u80EF\u5BBD",
      "humanoid.kneeBend": "\u819D\u89D2",
      "humanoid.footPitch": "\u811A\u9762",
      "humanoid.hipsHeight": "\u76C6\u9AA8\u9AD8\u4F4E",
      "humanoid.stride": "\u6B65\u5E45",
      "project.clips": "\u7247\u6BB5",
      "anim.loop": "\u5FAA\u73AF",
      "anim.speed": "\u901F\u5EA6",
      "anim.fade": "\u6DE1\u5165",
      "anim.inPlace": "\u539F\u5730",
      "anim.animator": "\u72B6\u6001\u673A",
      "anim.enabled": "\u542F\u7528",
      "anim.current": "\u5F53\u524D {name}",
      "anim.addState": "\u52A0\u72B6\u6001",
      "anim.addParam": "\u52A0\u53C2\u6570",
      "anim.addTransition": "\u52A0\u8FC7\u6E21",
      "anim.transitions": "\u8FC7\u6E21",
      "anim.state": "\u72B6\u6001",
      "anim.param": "\u53C2\u6570",
      "anim.remove": "\u5220\u9664",
      "anim.bool": "\u5F00\u5173",
      "anim.number": "\u6570\u503C",
      "anim.trigger": "\u89E6\u53D1",
      "anim.fire": "\u89E6\u53D1",
      "anim.equals": "\u7B49\u4E8E",
      "anim.greater": "\u5927\u4E8E",
      "anim.less": "\u5C0F\u4E8E",
      "anim.simple": "\u57FA\u7840\u64AD\u653E",
      "anim.machine": "\u72B6\u6001\u673A",
      "anim.simpleHint": "\u53EA\u64AD\u4E00\u6BB5\u3002\u8981\u591A\u4E2A\u72B6\u6001\u3001\u53C2\u6570\u548C\u81EA\u52A8\u5207\u6362\u65F6\uFF0C\u518D\u5207\u5230\u72B6\u6001\u673A\u3002",
      "anim.machineHint": "\u72B6\u6001\u673A\u51B3\u5B9A\u64AD\u54EA\u4E00\u6BB5\u3002\u906E\u7F69\u8DDF\u7740\u6BCF\u4E2A\u72B6\u6001\u8D70\u3002",
      "anim.end": "\u64AD\u5B8C\u540E",
      "anim.hold": "\u505C\u5728\u6700\u540E\u4E00\u5E27",
      "anim.stop": "\u505C\u6B62\u64AD\u653E",
      "anim.backToDefault": "\u56DE\u5230\u9ED8\u8BA4\u72B6\u6001",
      "anim.default": "\u9ED8\u8BA4",
      "anim.setDefault": "\u8BBE\u4E3A\u9ED8\u8BA4",
      "anim.fromClips": "\u6309\u7247\u6BB5\u751F\u6210\u72B6\u6001",
      "anim.seedParams": "\u6DFB\u52A0\u5E38\u7528\u53C2\u6570",
      "anim.mask": "\u9AA8\u9ABC\u906E\u7F69",
      "anim.overlay": "\u4E0A\u534A\u8EAB",
      "anim.overlayStop": "\u505C\u6389\u8986\u76D6",
      "anim.maskFull": "\u5168\u8EAB\u9AA8\u9ABC",
      "anim.maskUpper": "\u4EC5\u4E0A\u534A\u8EAB",
      "anim.maskLower": "\u4EC5\u4E0B\u534A\u8EAB",
      "anim.exit": "\u7B49\u5230\u8FDB\u5EA6",
      "anim.embedded": "\u5185\u5D4C {count} \u6BB5",
      "asset.scene": "\u573A\u666F",
      "asset.model": "\u6A21\u578B",
      "asset.texture": "\u8D34\u56FE",
      "asset.environment": "\u73AF\u5883",
      "asset.material": "\u6750\u8D28",
      "asset.effect": "\u7279\u6548",
      "asset.ui": "\u754C\u9762",
      "project.createUi": "\u754C\u9762",
      "project.newUiName": "\u8BA1\u5206\u754C\u9762",
      "ui.open": "\u7F16\u8F91\u754C\u9762",
      "ui.add": "\u6DFB\u52A0",
      "ui.delete": "\u5220\u9664",
      "ui.up": "\u4E0A\u79FB",
      "ui.down": "\u4E0B\u79FB",
      "ui.close": "\u5173\u95ED",
      "ui.undo": "\u64A4\u9500",
      "ui.redo": "\u91CD\u505A",
      "ui.zoom": "\u7F29\u653E",
      "ui.name": "\u540D\u79F0",
      "ui.text": "\u6587\u5B57",
      "ui.image": "\u56FE\u7247",
      "ui.layout": "\u5E03\u5C40",
      "ui.anchor": "\u951A\u70B9",
      "ui.flex": "\u6392\u5217",
      "ui.anchorPreset": "\u951A\u70B9\u4F4D\u7F6E",
      "ui.custom": "\u4FDD\u6301\u73B0\u72B6",
      "ui.direction": "\u65B9\u5411",
      "ui.column": "\u7AD6\u6392",
      "ui.row": "\u6A2A\u6392",
      "ui.gap": "\u95F4\u8DDD",
      "ui.width": "\u5BBD",
      "ui.height": "\u9AD8",
      "ui.style": "\u6837\u5F0F",
      "ui.state": "\u72B6\u6001",
      "ui.color": "\u989C\u8272",
      "ui.align": "\u5BF9\u9F50",
      "ui.align.left": "\u5DE6",
      "ui.align.center": "\u4E2D",
      "ui.align.right": "\u53F3",
      "ui.border": "\u8FB9\u6846",
      "ui.borderWidth": "\u8FB9\u6846\u7C97\u7EC6",
      "ui.fontSize": "\u5B57\u53F7",
      "ui.background": "\u80CC\u666F",
      "ui.opacity": "\u900F\u660E\u5EA6",
      "ui.radius": "\u5706\u89D2",
      "ui.tint": "\u586B\u5145",
      "ui.binding": "\u7ED1\u5B9A",
      "ui.source": "\u6765\u6E90",
      "ui.variable": "\u53D8\u91CF",
      "ui.component": "\u7EC4\u4EF6",
      "ui.node": "\u7269\u4F53",
      "ui.field": "\u5B57\u6BB5",
      "ui.value": "\u503C",
      "ui.min": "\u6700\u5C0F",
      "ui.max": "\u6700\u5927",
      "ui.click": "\u70B9\u51FB",
      "ui.none": "\u65E0",
      "ui.sendMessage": "\u53D1\u9001\u6D88\u606F",
      "ui.setVariable": "\u5199\u53D8\u91CF",
      "ui.message": "\u6D88\u606F",
      "ui.fake": "\u9884\u89C8\u6570\u503C",
      "ui.previewClick": "{name}\uFF1A{detail}",
      "ui.document": "\u754C\u9762",
      "ui.layer": "\u5C42",
      "ui.visibleOnPlay": "\u8BD5\u73A9\u5F00\u59CB\u65F6\u53EF\u89C1",
      "ui.addScreen": "\u6DFB\u52A0\u5C4F\u5E55\u754C\u9762",
      "ui.removeScreen": "\u79FB\u9664",
      "ui.missing": "\u7F3A\u5C11\u754C\u9762\u6587\u6863",
      "ui.mount": "\u6302\u4E0A\u754C\u9762",
      "ui.type.panel": "\u9762\u677F",
      "ui.type.stack": "\u6392\u5217",
      "ui.type.text": "\u6587\u5B57",
      "ui.type.image": "\u56FE\u7247",
      "ui.type.button": "\u6309\u94AE",
      "ui.type.progress": "\u8FDB\u5EA6\u6761",
      "ui.state.normal": "\u901A\u5E38",
      "ui.state.hover": "\u60AC\u505C",
      "ui.state.pressed": "\u6309\u4E0B",
      "ui.state.disabled": "\u7981\u7528",
      "ui.target.text": "\u6587\u5B57",
      "ui.target.visible": "\u53EF\u89C1",
      "ui.target.enabled": "\u53EF\u7528",
      "ui.target.progress": "\u8FDB\u5EA6",
      "ui.target.opacity": "\u900F\u660E\u5EA6",
      "ui.anchor.top": "\u4E0A",
      "ui.anchor.center": "\u4E2D",
      "ui.anchor.bottom": "\u4E0B",
      "ui.anchor.left": "\u5DE6",
      "ui.anchor.right": "\u53F3",
      "ui.layer.hud": "\u62AC\u5934",
      "ui.layer.menu": "\u83DC\u5355",
      "ui.layer.popup": "\u5F39\u51FA",
      "ui.layer.modal": "\u6A21\u6001",
      "log.createdUi": "\u5DF2\u521B\u5EFA\u754C\u9762 {name}",
      "log.mountedUi": "\u5DF2\u6302\u4E0A\u754C\u9762 {name}",
      "log.uiMessage": "\u754C\u9762\u53D1\u51FA\u6D88\u606F {message}",
      "asset.animation": "\u52A8\u753B",
      "asset.audio": "\u97F3\u9891",
      "asset.prefab": "\u9884\u5236\u4F53",
      "project.all": "\u5168\u90E8",
      "project.model": "\u6A21\u578B",
      "project.image": "\u6750\u8D28/\u8D34\u56FE",
      "project.audio": "\u97F3\u9891",
      "project.animation": "\u52A8\u753B",
      "project.scene": "\u573A\u666F",
      "project.used": "\u672C\u573A\u666F",
      "project.unused": "\u672A\u5F15\u7528",
      "project.newFolder": "\u5728\u5F53\u524D\u76EE\u5F55\u65B0\u5EFA\u6587\u4EF6\u5939",
      "project.search": "\u641C\u7D22\u8D44\u6E90",
      "project.clear": "\u6E05\u9664",
      "project.import": "\u5BFC\u5165",
      "project.extractPackage": "\u63D0\u53D6\u7D20\u6750\u5305",
      "pkg.title": "\u63D0\u53D6\u7D20\u6750\u5305",
      "pkg.noFile": "\u672A\u9009\u62E9\u6587\u4EF6",
      "pkg.close": "\u5173\u95ED",
      "pkg.scanning": "\u6B63\u5728\u626B\u63CF\u53EF\u63D0\u53D6\u8D44\u6E90\u2026",
      "pkg.scanningSlow": "\u8D44\u6E90\u5305\u8F83\u5927\uFF0C\u6B63\u5728\u89E3\u538B\u548C\u5EFA\u7ACB\u7D22\u5F15\u3002\u7A97\u53E3\u6CA1\u6709\u5361\u6B7B\uFF0C\u5B8C\u6210\u540E\u4F1A\u663E\u793A\u53EF\u63D0\u53D6\u8D44\u6E90\u3002",
      "pkg.scanFailed": "\u626B\u63CF\u5931\u8D25\uFF1A{detail}",
      "pkg.empty": "\u6CA1\u6709\u627E\u5230\u53EF\u63D0\u53D6\u7684\u6A21\u578B\u3001\u8D34\u56FE\u3001\u52A8\u753B\u6216\u6750\u8D28\u3002",
      "pkg.models": "\u6A21\u578B",
      "pkg.textures": "\u8D34\u56FE",
      "pkg.animations": "\u52A8\u753B",
      "pkg.materials": "\u6750\u8D28",
      "pkg.hidden": "\u5DF2\u9690\u85CF",
      "pkg.unsupported": "\u4E0D\u652F\u6301",
      "pkg.previewOnly": "\u63D0\u53D6\u6A21\u578B\u3001\u8D34\u56FE\u3001\u52A8\u753B\u548C\u6750\u8D28\u3002FBX \u7528 ufbx \u5BFC\u5165\uFF1B\u52FE\u9009\u5408\u5E76\u540E\uFF0C\u52A8\u753B\u4F1A\u6309\u73B0\u6709\u4EBA\u5F62\u91CD\u5B9A\u5411\u5199\u8FDB\u672C\u4F53\u6A21\u578B\u3002",
      "pkg.selectedSummary": "\u5DF2\u9009\u62E9 {count} \u9879",
      "pkg.selectAll": "\u5168\u9009",
      "pkg.selectNone": "\u5168\u4E0D\u9009",
      "pkg.selectModels": "\u53EA\u9009\u6A21\u578B",
      "pkg.selectTextures": "\u53EA\u9009\u8D34\u56FE",
      "pkg.selectAnimations": "\u53EA\u9009\u52A8\u753B",
      "pkg.selectMaterials": "\u53EA\u9009\u6750\u8D28",
      "pkg.filterPlaceholder": "\u6309\u6587\u4EF6\u540D\u8FC7\u6EE4",
      "pkg.filterEmpty": "\u6CA1\u6709\u5339\u914D\u7684\u6587\u4EF6",
      "pkg.targetDirectory": "\u76EE\u6807\u76EE\u5F55",
      "pkg.directoryMode": "\u76EE\u5F55\u65B9\u5F0F",
      "pkg.directoryModeFlat": "\u72EC\u7ACB\u76EE\u5F55\uFF08Textures / Materials / Animations\uFF09",
      "pkg.directoryModePreserve": "\u4FDD\u7559\u5305\u5185\u76EE\u5F55",
      "pkg.showDiagnostics": "\u663E\u793A\u8BCA\u65AD",
      "pkg.hideDiagnostics": "\u9690\u85CF\u8BCA\u65AD",
      "pkg.extracting": "\u6B63\u5728\u63D0\u53D6\u2026",
      "pkg.extractingTitle": "\u6B63\u5728\u63D0\u53D6\u7D20\u6750",
      "pkg.extractingProgress": "\u5DF2\u5904\u7406 {completed} / {total} \u9879",
      "pkg.extractSelected": "\u63D0\u53D6\u5DF2\u9009\uFF08{count}\uFF09",
      "pkg.extractSuccess": "\u5DF2\u63D0\u53D6 {count} \u4E2A\u8D44\u6E90\u3002",
      "pkg.extractFailed": "{count} \u4E2A\u8D44\u6E90\u63D0\u53D6\u5931\u8D25\u3002",
      "pkg.companions": "{count} \u4E2A\u4F34\u968F\u6587\u4EF6",
      "pkg.warnings": "{count} \u4E2A\u63D0\u793A",
      "pkg.kind.model": "\u6A21\u578B",
      "pkg.kind.texture": "\u8D34\u56FE",
      "pkg.kind.animation": "\u52A8\u753B",
      "pkg.kind.material": "\u6750\u8D28",
      "pkg.role.modelBody": "\u672C\u4F53\u6A21\u578B",
      "pkg.role.animationCarrier": "\u52A8\u753B",
      "pkg.role.ordinaryModel": "\u666E\u901A\u6A21\u578B",
      "pkg.role.unknownModel": "\u5F85\u786E\u8BA4",
      "pkg.confidence.high": "\u9AD8\u7F6E\u4FE1",
      "pkg.confidence.medium": "\u4E2D\u7F6E\u4FE1",
      "pkg.confidence.low": "\u4F4E\u7F6E\u4FE1",
      "pkg.roleOverrideFor": "\u8BBE\u7F6E {name} \u7684\u5BFC\u5165\u89D2\u8272",
      "pkg.carrierBodyFor": "\u8BBE\u7F6E {name} \u5173\u8054\u7684\u672C\u4F53\u6A21\u578B",
      "pkg.noCarrierBody": "\u672A\u5173\u8054\u672C\u4F53",
      "pkg.mergePreview.title": "\u52A8\u753B\u5408\u5E76\u9884\u89C8",
      "pkg.mergePreview.summary": "{bodies} \u4E2A\u672C\u4F53\uFF0C{carriers} \u4E2A\u52A8\u753B",
      "pkg.phase.textures": "\u8D34\u56FE",
      "pkg.phase.models": "\u6A21\u578B",
      "pkg.phase.animations": "\u52A8\u753B",
      "pkg.phase.materials": "\u6750\u8D28",
      "pkg.phase.retarget": "\u91CD\u5B9A\u5411",
      "pkg.diag.hidden": "\u5DF2\u9690\u85CF",
      "pkg.diag.unsupported": "\u4E0D\u652F\u6301",
      "pkg.diag.missingPathname": "\u7F3A\u5C11\u8DEF\u5F84",
      "pkg.diag.missingAssetBytes": "\u7F3A\u5C11\u8D44\u4EA7\u6570\u636E",
      "pkg.diag.scan": "\u626B\u63CF\u8BCA\u65AD",
      "project.newScene": "\u5728\u5F53\u524D\u76EE\u5F55\u65B0\u5EFA\u573A\u666F",
      "project.count": "{count} \u9879",
      "project.list": "\u5217\u8868",
      "project.details": "\u8BE6\u60C5",
      "project.grid": "\u7F29\u7565\u56FE",
      "project.name": "\u540D\u79F0",
      "project.type": "\u7C7B\u578B",
      "project.detail": "\u8BF4\u660E",
      "project.drop": "\u677E\u5F00\u5373\u53EF\u5BFC\u5165",
      "project.empty": "\u8FD9\u4E2A\u76EE\u5F55\u91CC\u8FD8\u6CA1\u6709\u8D44\u6E90\u3002",
      "project.deleteScene": "\u5220\u9664\u573A\u666F\u300C{name}\u300D\uFF1F\u91CC\u9762\u7684\u7269\u4F53\u4E5F\u4F1A\u53BB\u6389\u3002",
      "project.deleteAsset": "\u5220\u9664\u8D44\u6E90\u300C{name}\u300D\uFF1F\u5220\u9664\u540E\u4E0D\u80FD\u64A4\u9500\u3002",
      "project.cancel": "\u53D6\u6D88",
      "project.open": "\u6253\u5F00",
      "project.reveal": "\u6253\u5F00\u6240\u5728\u76EE\u5F55\u2026",
      "project.revealMissing": "\u8FD9\u4E2A\u8D44\u6E90\u8FD8\u6CA1\u6709\u5199\u5230\u78C1\u76D8\u76EE\u5F55\u3002\u5148\u628A\u5DE5\u7A0B\u53E6\u5B58\u4E3A\u76EE\u5F55\u5DE5\u7A0B\u3002",
      "project.revealFailed": "\u6253\u4E0D\u5F00\u6240\u5728\u76EE\u5F55\uFF1A{message}",
      "project.place": "\u653E\u5165\u573A\u666F",
      "project.rename": "\u91CD\u547D\u540D",
      "project.delete": "\u5220\u9664",
      "project.resizeTextures": "\u6279\u91CF\u8C03\u6574\u8D34\u56FE\u5C3A\u5BF8\u2026",
      "texResize.title": "\u6279\u91CF\u8C03\u6574\u8D34\u56FE\u5C3A\u5BF8",
      "texResize.maxEdge": "\u6700\u5927\u8FB9\u957F",
      "texResize.search": "\u641C\u7D22\u8D34\u56FE\u540D\u79F0\u2026",
      "texResize.scopeCurrent": "\u4EC5\u5F53\u524D\u8303\u56F4",
      "texResize.scopeAll": "\u663E\u793A\u5168\u90E8\u8D34\u56FE ({count})",
      "texResize.selectAll": "\u5168\u9009",
      "texResize.selectLarge": "\u4EC5\u9009 > {size}px",
      "texResize.selectBackedUp": "\u4EC5\u9009\u5DF2\u5907\u4EFD\u539F\u56FE",
      "texResize.clear": "\u6E05\u7A7A",
      "texResize.empty": "\u6CA1\u6709\u5339\u914D\u7684\u8D34\u56FE\u8D44\u4EA7",
      "texResize.unsupported": "\u683C\u5F0F\u4E0D\u652F\u6301\u8C03\u6574",
      "texResize.backedUp": "\u5DF2\u5907\u4EFD\u539F\u56FE",
      "texResize.skipFormat": "\u8DF3\u8FC7\u8BE5\u683C\u5F0F",
      "texResize.restoreOrSkip": "\u5C06\u8FD8\u539F\u539F\u56FE",
      "texResize.alreadySmall": "\u5DF2\u6EE1\u8DB3\uFF0C\u8DF3\u8FC7",
      "texResize.backupHint": "\u8986\u76D6\u524D\u4F1A\u81EA\u52A8\u4FDD\u7559\u539F\u56FE\u5907\u4EFD\uFF0C\u53EF\u968F\u65F6\u4E00\u952E\u8FD8\u539F",
      "texResize.progress": "\u6B63\u5728\u5904\u7406 {done} / {total}\u2026",
      "texResize.restore": "\u8FD8\u539F\u539F\u56FE ({count})",
      "texResize.apply": "\u5E94\u7528\u7F29\u653E ({count})",
      "texResize.done": "\u8D34\u56FE\u7F29\u653E\u5B8C\u6210\uFF1A\u66F4\u65B0 {updated} \u5F20\uFF0C\u8DF3\u8FC7 {skipped} \u5F20\uFF0C\u5931\u8D25 {failed} \u5F20",
      "texResize.restored": "\u8D34\u56FE\u5DF2\u8FD8\u539F\u539F\u56FE\uFF1A{updated} \u5F20\uFF0C\u5931\u8D25 {failed} \u5F20",
      "project.newFolderMenu": "\u65B0\u5EFA\u6587\u4EF6\u5939",
      "project.deleteFolder": "\u5220\u9664\u6587\u4EF6\u5939\u300C{name}\u300D\uFF1F\u91CC\u9762\u7684\u8D44\u6E90\u548C\u5B50\u6587\u4EF6\u5939\u4F1A\u4E00\u8D77\u5220\u9664\uFF0C\u4E0D\u80FD\u64A4\u9500\u3002",
      "project.objects": "{count} \u4E2A\u7269\u4F53",
      "project.inUse": "\u4F7F\u7528\u4E2D",
      "project.sceneHint": "\u5355\u51FB\u6253\u5F00\u3002\u518D\u5355\u51FB\u5F53\u524D\u573A\u666F\u53EF\u6539\u540D",
      "project.modelHint": "\u53CC\u51FB\u9884\u89C8\uFF0C\u62D6\u8FDB\u89C6\u53E3\u653E\u5165\u573A\u666F",
      "project.envHint": "\u53CC\u51FB\u9884\u89C8\u73AF\u5883\u8D34\u56FE",
      "project.textureHint": "\u53CC\u51FB\u9884\u89C8\uFF0C\u4E5F\u53EF\u4EE5\u62D6\u5230\u7269\u4F53\u4E0A",
      "project.animHint": "\u62D6\u5230\u6A21\u578B\u4E0A\u64AD\u653E",
      "project.audioHint": "\u53CC\u51FB\u8BD5\u542C",
      "project.openFolder": "\u53CC\u51FB\u6253\u5F00\u76EE\u5F55",
      "project.folder": "\u76EE\u5F55",
      "hierarchy.search": "\u641C\u7D22\u7269\u4F53",
      "hierarchy.expand": "\u5168\u90E8\u5C55\u5F00",
      "hierarchy.collapse": "\u5168\u90E8\u6298\u53E0",
      "hierarchy.create": "\u521B\u5EFA",
      "hierarchy.empty": "\u573A\u666F\u662F\u7A7A\u7684\u3002\u7528\u52A0\u53F7\u6216\u300C\u521B\u5EFA\u300D\u83DC\u5355\u6DFB\u52A0\u7269\u4F53\u3002",
      "hierarchy.hint": "\u5355\u51FB\u9009\u62E9\uFF0C\u518D\u5355\u51FB\u6539\u540D\uFF0C\u53CC\u51FB\u805A\u7126",
      "hierarchy.hide": "\u9690\u85CF",
      "hierarchy.show": "\u663E\u793A",
      "hierarchy.locked": "\u5DF2\u9501\u5B9A\uFF1A\u89C6\u53E3\u70B9\u9009\u4F1A\u7A7F\u900F\uFF0C\u624B\u67C4\u4E5F\u4E0D\u4F5C\u7528",
      "hierarchy.lock": "\u9501\u5B9A\u540E\u89C6\u53E3\u70B9\u9009\u7A7F\u900F\uFF0C\u624B\u67C4\u4E0D\u4F5C\u7528",
      "hierarchy.createChild": "\u521B\u5EFA\u5B50\u7269\u4F53",
      "hierarchy.unparent": "\u89E3\u9664\u7236\u5B50",
      "hierarchy.pasteChild": "\u7C98\u8D34\u4E3A\u5B50\u7EA7",
      "hierarchy.moveUp": "\u4E0A\u79FB",
      "hierarchy.moveDown": "\u4E0B\u79FB",
      "view.persp": "\u900F\u89C6",
      "view.top": "\u9876",
      "view.bottom": "\u5E95",
      "view.front": "\u524D",
      "view.back": "\u540E",
      "view.left": "\u5DE6",
      "view.right": "\u53F3",
      "view.up": "\u4E0A",
      "view.down": "\u4E0B",
      "view.world": "\u4E16\u754C\u5750\u6807",
      "view.local": "\u5C40\u90E8\u5750\u6807",
      "view.helpers": "\u8F85\u52A9\u663E\u793A",
      "view.grid": "\u7F51\u683C",
      "view.lights": "\u706F\u5149\u548C\u76F8\u673A",
      "view.gizmoCenter": "\u624B\u67C4\u5728\u4E2D\u5FC3",
      "view.snap": "\u5438\u9644",
      "view.step": "\u6B65\u957F",
      "view.focus": "\u805A\u7126\u9009\u4E2D (F)",
      "view.fullscreen": "\u89C6\u53E3\u5168\u5C4F",
      "view.stats": "{objects} \u7269\u4F53 \xB7 {triangles} \u4E09\u89D2",
      "view.statsOpen": "\u7EDF\u8BA1",
      "view.statsTitle": "\u7EDF\u8BA1",
      "view.statsRender": "\u6E32\u67D3",
      "view.statsPhysics": "\u7269\u7406",
      "view.statsCamera": "\u76F8\u673A\u4E0E\u9009\u4E2D",
      "view.statsBackend": "\u56FE\u5F62\u540E\u7AEF",
      "view.statsCalls": "\u7ED8\u5236\u8C03\u7528",
      "view.statsTris": "\u6E32\u67D3\u4E09\u89D2",
      "view.statsMeshes": "\u7F51\u683C / \u9876\u70B9",
      "view.statsMats": "\u6750\u8D28 / \u8D34\u56FE",
      "view.statsNodes": "\u573A\u666F\u7269\u4F53",
      "view.statsAssets": "\u8D44\u6E90",
      "view.statsBodies": "\u521A\u4F53 \u52A8 / \u8FD0 / \u9759",
      "view.statsTriggers": "\u89E6\u53D1\u5668",
      "view.statsPlay": "\u8FD0\u884C",
      "view.statsCamMode": "\u76F8\u673A",
      "view.statsCamPos": "\u5750\u6807",
      "view.statsSelected": "\u9009\u4E2D",
      "view.statsNone": "\u672A\u9009\u4E2D",
      "view.statsPlaying": "\u8FD0\u884C\u4E2D",
      "view.statsEditing": "\u7F16\u8F91",
      "view.statsReady": "\u5DF2\u542F\u52A8",
      "view.statsIdle": "\u672A\u8FD0\u884C",
      "view.statsCollapse": "\u6536\u8D77\u8BE6\u60C5",
      "view.statsExpand": "\u5C55\u5F00\u8BE6\u60C5",
      "view.statsVertices": "\u9876\u70B9",
      "view.statsCallsShort": "\u7ED8\u5236",
      "view.statsTrisShort": "\u4E09\u89D2",
      "view.costTitle": "\u8017\u65F6\u524D 8",
      "view.costHint": "\u6700\u8FD1\u534A\u79D2\u6BCF\u5E27\u5E73\u5747",
      "view.cost.core.character": "\u89D2\u8272",
      "view.cost.core.camera": "\u8DDF\u968F\u955C\u5934",
      "view.cost.core.rules": "\u5F8B\u4EE4",
      "view.cost.core.devices": "\u4EA4\u4E92\u4E0E\u89E6\u53D1",
      "view.cost.core.movers": "\u79FB\u52A8\u673A\u5173",
      "view.cost.core.round": "\u8BA1\u5206\u4E0E\u56DE\u5408",
      "view.cost.physics": "\u7269\u7406",
      "view.cost.navigation": "\u5BFC\u822A",
      "view.cost.animation": "\u9AA8\u9ABC\u52A8\u753B",
      "view.cost.particles": "\u7C92\u5B50",
      "view.cost.render": "\u4E3B\u573A\u666F\u7ED8\u5236",
      "view.cost.picture": "\u753B\u9762\u4E0E\u7ED8\u5236\u524D",
      "view.cost.rig": "\u7F16\u8F91\u955C\u5934",
      "view.create": "\u521B\u5EFA",
      "view.createChild": "\u521B\u5EFA\u5B50\u7269\u4F53",
      "view.paste": "\u7C98\u8D34",
      "console.info": "\u4FE1\u606F",
      "console.warn": "\u8B66\u544A",
      "console.error": "\u9519\u8BEF",
      "console.filter": "\u7B5B\u9009",
      "console.clear": "\u6E05\u7A7A",
      "history.empty": "\u8FD8\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u64CD\u4F5C\u3002\u79FB\u52A8\u3001\u521B\u5EFA\u548C\u5220\u9664\u90FD\u4F1A\u8BB0\u5728\u8FD9\u91CC\u3002",
      "history.current": "\u5F53\u524D",
      "preview.pendingMaterial": "\u6750\u8D28\u8FD8\u6CA1\u5C31\u7EEA",
      "preview.sphere": "\u7403\u4F53",
      "preview.box": "\u7ACB\u65B9\u4F53",
      "preview.torus": "\u5706\u73AF",
      "preview.plane": "\u5E73\u9762",
      "preview.studio": "\u6444\u5F71\u68DA",
      "preview.bright": "\u660E\u4EAE",
      "preview.dark": "\u6697\u8C03",
      "preview.turn": "\u65CB\u8F6C",
      "preview.popout": "\u72EC\u7ACB\u7A97\u53E3",
      "preview.title": "\u9884\u89C8",
      "preview.pendingModel": "\u6A21\u578B\u8FD8\u5728\u8BFB\u53D6",
      "preview.lit": "\u5149\u7167",
      "preview.wire": "\u7EBF\u6846",
      "preview.unlit": "\u65E0\u5149",
      "preview.bounds": "\u5305\u56F4\u76D2",
      "preview.reset": "\u590D\u4F4D",
      "preview.light": "\u706F\u5149",
      "preview.faces": "{count} \u9762",
      "preview.tabOverview": "\u6982\u89C8",
      "preview.tabMesh": "\u7F51\u683C",
      "preview.tabAnim": "\u52A8\u753B",
      "preview.tabMaterial": "\u6750\u8D28",
      "preview.tabSocket": "\u6302\u70B9",
      "preview.tabImport": "\u5BFC\u5165",
      "preview.importScale": "\u5BFC\u5165\u7F29\u653E",
      "preview.reimport": "\u91CD\u65B0\u5BFC\u5165",
      "preview.reimportDone": "\u5DF2\u91CD\u65B0\u5BFC\u5165\uFF1A{name}",
      "preview.reimportFailed": "\u91CD\u65B0\u5BFC\u5165\u5931\u8D25\u3002\u6E90\u6587\u4EF6\u4E0D\u5728\u7F13\u5B58\u91CC\u3002",
      "preview.reimportFailedDetail": "\u91CD\u65B0\u5BFC\u5165\u5931\u8D25\uFF1A{message}",
      "preview.reimportUnavailable": "\u8FD9\u4E2A\u8D44\u6E90\u4E0D\u80FD\u91CD\u65B0\u5BFC\u5165\u3002",
      "preview.source": "\u6765\u6E90",
      "preview.scaleHint": "\u5F53\u524D\u9AD8\u5EA6 {height} m\u3002\u5EFA\u8BAE\u628A\u5BFC\u5165\u7F29\u653E\u8BBE\u4E3A {scale}x\u3002",
      "preview.useScale": "\u8BBE\u4E3A {scale}x",
      "preview.noMesh": "\u8FD8\u6CA1\u6709\u7F51\u683C\u7EDF\u8BA1\u3002\u91CD\u65B0\u5BFC\u5165\u540E\u53EF\u4EE5\u770B\u6BCF\u4E2A\u5B50\u7F51\u683C\u3002",
      "preview.noBone": "\u8FD9\u4E2A\u6A21\u578B\u6CA1\u6709\u9AA8\u9ABC\u3002",
      "preview.noClip": "\u6CA1\u6709\u5185\u5D4C\u52A8\u753B\u3002",
      "preview.socketEmpty": "\u8FD8\u6CA1\u6709\u6302\u70B9\u3002\u5728\u9AA8\u9ABC\u65C1\u8FB9\u70B9\u52A0\u53F7\uFF0C\u9884\u89C8\u91CC\u4F1A\u663E\u793A\u5750\u6807\u8F74\u3002",
      "preview.addSocket": "\u52A0\u6302\u70B9",
      "preview.triangles": "\u4E09\u89D2\u9762",
      "preview.vertices": "\u9876\u70B9",
      "preview.meshes": "\u7F51\u683C",
      "preview.slots": "\u6750\u8D28\u69FD",
      "preview.bones": "\u9AA8\u9ABC",
      "preview.sourceSize": "\u539F\u56FE {size}",
      "preview.textureHint": "\u6EDA\u8F6E\u7F29\u653E\uFF0C\u62D6\u52A8\u5E73\u79FB\u3002\u4FDD\u5B58\u4F1A\u751F\u6210\u65B0\u8D34\u56FE\uFF0C\u4E0D\u80FD\u64A4\u9500\u3002",
      "preview.flipX": "\u5DE6\u53F3\u7FFB\u8F6C",
      "preview.flipY": "\u4E0A\u4E0B\u7FFB\u8F6C",
      "preview.flipNormalY": "\u7FFB\u8F6C\u6CD5\u7EBF Y",
      "preview.width": "\u5BBD",
      "preview.height": "\u9AD8",
      "preview.lockAspect": "\u9501\u5B9A\u6BD4\u4F8B",
      "preview.saveTexture": "\u4FDD\u5B58\u4E3A\u65B0\u8D34\u56FE",
      "preview.overwriteTexture": "\u8986\u76D6\u539F\u56FE",
      "preview.saving": "\u4FDD\u5B58\u4E2D\u2026",
      "preview.savedTexture": "\u5DF2\u4FDD\u5B58\u65B0\u8D34\u56FE\u300C{name}\u300D",
      "preview.overwroteTexture": "\u5DF2\u8986\u76D6\u539F\u56FE\u300C{name}\u300D\uFF08\u539F\u56FE\u5DF2\u5907\u4EFD\uFF09",
      "preview.actor": "\u8BD5\u6F14\u6A21\u578B",
      "preview.noActor": "\u8BF7\u5148\u5BFC\u5165\u4E00\u4E2A\u6A21\u578B\u6765\u8BD5\u6F14\u8FD9\u6BB5\u52A8\u753B",
      "preview.loading": "\u6B63\u5728\u52A0\u8F7D\u2026",
      "preview.saveTextureFail": "\u4FDD\u5B58\u8D34\u56FE\u5931\u8D25\uFF1A{message}",
      "preview.envHint": "\u62D6\u52A8\u65CB\u8F6C\uFF0C\u6EDA\u8F6E\u62C9\u8FD1",
      "gesture.create": "\u521B\u5EFA {name}",
      "gesture.rename": "\u91CD\u547D\u540D",
      "gesture.move": "\u4FEE\u6539\u4F4D\u79FB",
      "gesture.rotate": "\u4FEE\u6539\u65CB\u8F6C",
      "gesture.scale": "\u4FEE\u6539\u7F29\u653E",
      "gesture.light": "\u4FEE\u6539\u5149\u6E90",
      "gesture.camera": "\u4FEE\u6539\u76F8\u673A",
      "gesture.alignCamera": "\u5BF9\u9F50\u955C\u5934",
      "gesture.picture": "\u4FEE\u6539\u753B\u9762",
      "gesture.shadow": "\u4FEE\u6539\u9634\u5F71",
      "gesture.material": "\u4FEE\u6539\u6750\u8D28",
      "gesture.map": "\u8BBE\u7F6E\u8D34\u56FE",
      "gesture.mapClear": "\u6E05\u9664\u8D34\u56FE",
      "gesture.anim": "\u9884\u89C8\u52A8\u753B",
      "gesture.reset": "\u91CD\u7F6E\u53D8\u6362",
      "gesture.color": "\u4FEE\u6539\u989C\u8272",
      "error.panel": "{name} \u51FA\u9519\uFF1A{message}",
      "log.cacheOpenFail": "\u672C\u5730\u9879\u76EE\u7F13\u5B58\u6CA1\u80FD\u6253\u5F00\uFF0C\u4F7F\u7528\u7A7A\u767D\u573A\u666F",
      "log.projectCreated": "\u5DF2\u521B\u5EFA\u5DE5\u7A0B\u300C{name}\u300D\u3002\u6E90\u6587\u4EF6\u5728 Assets/\uFF0C\u7F13\u5B58\u5728 .cache/t3d/",
      "log.projectSavedAs": "\u5DF2\u628A\u5F53\u524D\u9879\u76EE\u53E6\u5B58\u4E3A\u5DE5\u7A0B\u300C{name}\u300D",
      "log.projectSaveAsOccupied": "\u300C{name}\u300D\u91CC\u5DF2\u7ECF\u6709\u5DE5\u7A0B\uFF0C\u8BF7\u53E6\u9009\u4E00\u4E2A\u7A7A\u6587\u4EF6\u5939",
      "log.projectOpened": "\u5DF2\u6253\u5F00\u5DE5\u7A0B\u300C{name}\u300D",
      "log.projectExists": "\u8FD9\u4E2A\u6587\u4EF6\u5939\u5DF2\u6709\u5DE5\u7A0B\uFF0C\u5DF2\u6253\u5F00\u300C{name}\u300D",
      "log.projectMissing": "\u8FD9\u4E2A\u6587\u4EF6\u5939\u91CC\u6CA1\u6709 project.t3d",
      "log.projectInvalid": "project.t3d \u65E0\u6CD5\u8BFB\u53D6",
      "log.projectFailed": "\u5DE5\u7A0B\u64CD\u4F5C\u5931\u8D25\uFF1A{message}",
      "log.projectBrowser": "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u80FD\u9009\u62E9\u672C\u5730\u5DE5\u7A0B\u76EE\u5F55",
      "log.projectPermission": "\u4E0A\u6B21\u7684\u5DE5\u7A0B\u9700\u8981\u91CD\u65B0\u6388\u6743\u3002\u8BF7\u4ECE\u300C\u6587\u4EF6 \u2192 \u6700\u8FD1\u5DE5\u7A0B\u300D\u6253\u5F00\uFF0C\u6216\u4F7F\u7528\u300C\u6253\u5F00\u5DE5\u7A0B\u300D\u3002",
      "log.projectLoose": "\u5DF2\u4ECE Assets \u76EE\u5F55\u7EB3\u5165 {count} \u4E2A\u6587\u4EF6",
      "status.localProject": "\u672C\u5730\u7F13\u5B58",
      "log.opened": "\u9879\u76EE\u5DF2\u6253\u5F00\uFF0C\u573A\u666F {ms}ms",
      "log.openedDetail": "\u9879\u76EE\u5DF2\u6253\u5F00 {total}ms\uFF08\u573A\u666F {scene}ms \xB7 \u6A21\u578B\u7D2F\u8BA1 {model}ms \xB7 \u8D34\u56FE\u7D2F\u8BA1 {texture}ms\uFF09\uFF0C\u6210\u54C1\u547D\u4E2D {hits}\uFF0C\u6E90\u6587\u4EF6\u89E3\u6790 {parsed}\uFF0C\u5931\u8D25 {failed}",
      "log.openProfile": "\u6253\u5F00\u5256\u6790\uFF08\u8D44\u6E90\u5230\u9F50\u540E\u5230\u753B\u9762\u7A33\u5B9A\uFF0C\u542B\u9884\u7F16\u8BD1\uFF09\uFF1A\u4E3B\u7EBF\u7A0B\u5404\u73AF\u8282 {costs} \xB7 \u65B0\u5EFA\u7740\u8272\u5668 {shaders} \u4E2A \xB7 \u73B0\u7F16\u8BD1\u7BA1\u7EBF {pipelines} \u6761 \xB7 \u9884\u7F16\u8BD1\u7BA1\u7EBF {asyncPipelines} \u6761\uFF08\u7D2F\u8BA1 {asyncMs}ms\uFF0C\u6700\u957F {asyncWorst}ms\uFF09\xB7 \u8D44\u6E90\u5230\u9F50\u524D\u5DF2\u5EFA\u7740\u8272\u5668 {earlyShaders} \u4E2A\u3001\u7BA1\u7EBF {earlyPipelines} \u6761",
      "log.openTimeline": "\u6253\u5F00\u65F6\u95F4\u7EBF\uFF08\u5B9E\u9645\u8017\u65F6\uFF09\uFF1A\u8BFB\u5DE5\u7A0B\u6587\u4EF6 {read}ms \xB7 \u5EFA\u7ACB\u4F1A\u8BDD {session}ms \xB7 \u626B\u63CF\u76EE\u5F55 {scan}ms \xB7 \u4FDD\u5B58 {save}ms \xB7 \u8D44\u6E90\u6062\u590D {warm}ms\uFF08\u6A21\u578B {model}ms \xB7 \u8D34\u56FE {texture}ms\uFF09\xB7 \u6E32\u67D3\u5668\u521D\u59CB\u5316 {init}ms\uFF08\u8D44\u6E90\u5230\u9F50\u540E\u53C8\u7B49\u4E86\u5B83 {wait}ms\uFF09\xB7 \u7740\u8272\u5668\u9884\u7F16\u8BD1 {compile}ms\uFF08\u671F\u95F4\u754C\u9762\u53EF\u64CD\u4F5C\uFF09\xB7 \u9884\u7F16\u8BD1\u540E\u5230\u753B\u9762\u7A33\u5B9A {settle}ms\uFF08{frames} \u5E27\uFF0C\u5176\u4E2D {slow} \u5E27\u5361\u987F\uFF0C\u6700\u957F\u4E00\u5E27 {worst}ms\uFF09\xB7 \u4E3B\u7EBF\u7A0B\u957F\u4EFB\u52A1 {tasks} \u4E2A\u5171 {busy}ms\uFF0C\u6700\u957F {longest}ms",
      "log.backend": "\u6E32\u67D3\u540E\u7AEF\uFF1A{label}",
      "log.webgpu": "WebGPU",
      "log.webgl2": "WebGL2 \u56DE\u9000",
      "log.playCameraMany": "\u6709\u591A\u53F0 MainCamera\uFF0C\u8BD5\u73A9\u4F7F\u7528\u300C{name}\u300D",
      "log.rendererFail": "\u6E32\u67D3\u5668\u521D\u59CB\u5316\u5931\u8D25\uFF1A{message}",
      "log.unknownFile": "\u4E0D\u8BA4\u8BC6\u7684\u6587\u4EF6\uFF1A{name}",
      "log.already": "\u8D44\u6E90\u5DF2\u5728\u5E93\u4E2D\uFF1A{name}",
      "log.importFail": "{name} \u5BFC\u5165\u5931\u8D25\uFF1A{message}",
      "log.importedAnim": "\u5DF2\u5BFC\u5165\u52A8\u753B {name}",
      "log.importedModel": "\u5DF2\u5BFC\u5165\u6A21\u578B {name}\uFF0C{count} \u4E2A\u7247\u6BB5",
      "log.importedTexture": "\u5DF2\u5BFC\u5165\u8D34\u56FE {name}",
      "log.importedEnv": "\u5DF2\u5BFC\u5165\u73AF\u5883\u8D34\u56FE {name}",
      "log.importedAudio": "\u5DF2\u5BFC\u5165\u97F3\u9891 {name}",
      "log.cacheFail": "\u7F13\u5B58\u8D44\u6E90 {name} \u6CA1\u80FD\u6062\u590D\uFF1A{message}",
      "log.referenced": "\u8FD8\u88AB\u8FD9\u4E9B\u7269\u4F53\u5F15\u7528\uFF1A",
      "log.folderKept": "\u6587\u4EF6\u5939\u91CC\u8FD8\u6709\u6B63\u5728\u4F7F\u7528\u7684\u8D44\u6E90\uFF0C\u8FD9\u4E9B\u548C\u6587\u4EF6\u5939\u90FD\u7559\u7740\uFF1A",
      "log.modelLoading": "\u6A21\u578B\u8FD8\u5728\u8BFB\u53D6",
      "log.envSet": "\u5DF2\u7528 {name} \u4F5C\u4E3A\u73AF\u5883",
      "log.dragAnim": "\u628A\u52A8\u753B\u62D6\u5230\u6A21\u578B\u4E0A",
      "log.dragAsset": "\u628A\u8D44\u6E90\u62D6\u5230\u7269\u4F53\u4E0A",
      "log.animOnModel": "\u52A8\u753B\u8981\u62D6\u5230\u6A21\u578B\u4E0A",
      "log.needMesh": "\u5148\u9009\u4E2D\u4E00\u4E2A\u7F51\u683C\u6216\u6A21\u578B",
      "log.savedMaterial": "\u5DF2\u4FDD\u5B58\u6750\u8D28 {name}",
      "log.needSelection": "\u5148\u9009\u4E2D\u8981\u4FDD\u5B58\u7684\u7269\u4F53",
      "log.savedPrefab": "\u5DF2\u4FDD\u5B58\u9884\u5236\u4F53 {name}",
      "log.created": "\u5DF2\u521B\u5EFA {name}",
      "log.skippedLocked": "\u5DF2\u8DF3\u8FC7\u9501\u5B9A\u7684\u7269\u4F53\uFF1A{names}",
      "log.deleted": "\u5DF2\u5220\u9664 {count} \u4E2A\u7269\u4F53",
      "log.duplicated": "\u5DF2\u590D\u5236 {count} \u4E2A\u7269\u4F53",
      "log.nothingCopy": "\u6CA1\u6709\u53EF\u62F7\u8D1D\u7684\u7269\u4F53",
      "log.copied": "\u5DF2\u62F7\u8D1D {count} \u4E2A\u7269\u4F53",
      "log.clipboardEmpty": "\u526A\u8D34\u677F\u662F\u7A7A\u7684",
      "log.pasted": "\u5DF2\u7C98\u8D34 {count} \u4E2A\u7269\u4F53",
      "log.groupNeedTwo": "\u6210\u7EC4\u81F3\u5C11\u8981\u9009\u4E2D\u4E24\u4E2A\u7269\u4F53",
      "log.grouped": "\u5DF2\u6210\u7EC4",
      "log.needGround": "\u5148\u9009\u62E9\u8981\u8D34\u5730\u7684\u7269\u4F53",
      "log.alreadyGround": "\u7269\u4F53\u5DF2\u7ECF\u8D34\u5728\u5730\u9762\u4E0A",
      "log.grounded": "\u5DF2\u8D34\u5730 {count} \u4E2A\u7269\u4F53",
      "log.locked": "{name} \u5DF2\u9501\u5B9A",
      "log.cycle": "\u4E0D\u80FD\u628A\u7269\u4F53\u62D6\u6210\u81EA\u5DF1\u7684\u5B50\u7EA7",
      "log.noUndoPlay": "\u8BD5\u73A9\u4E2D\u4E0D\u80FD\u64A4\u9500",
      "log.noRedoPlay": "\u8BD5\u73A9\u4E2D\u4E0D\u80FD\u91CD\u505A",
      "log.resumePlay": "\u7EE7\u7EED\u8BD5\u73A9",
      "log.startPlay": "\u5F00\u59CB\u8BD5\u73A9\u3002\u505C\u6B62\u540E\u573A\u666F\u4F1A\u56DE\u5230\u8BD5\u73A9\u524D\u3002",
      "log.stopPlay": "\u5DF2\u505C\u6B62\u8BD5\u73A9\uFF0C\u573A\u666F\u5DF2\u6062\u590D",
      "log.stopBeforeNew": "\u5148\u505C\u6B62\u8BD5\u73A9\uFF0C\u518D\u65B0\u5EFA\u573A\u666F",
      "log.createdScene": "\u5DF2\u65B0\u5EFA\u5E76\u6253\u5F00\u573A\u666F {name}",
      "log.stopBeforeOpen": "\u5148\u505C\u6B62\u8BD5\u73A9\uFF0C\u518D\u6253\u5F00\u573A\u666F",
      "log.openedScene": "\u5DF2\u6253\u5F00\u573A\u666F {name}",
      "log.keepScene": "\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A\u573A\u666F",
      "log.stopBeforeDelete": "\u5148\u505C\u6B62\u8BD5\u73A9\uFF0C\u518D\u5220\u9664\u573A\u666F",
      "log.deletedScene": "\u5DF2\u5220\u9664\u573A\u666F",
      "log.placed": "\u5DF2\u653E\u5165\u573A\u666F {name}",
      "log.assignedMaterial": "\u5DF2\u6307\u5B9A\u6750\u8D28 {name}",
      "log.noStructure": "\u8BD5\u73A9\u4E2D\u4E0D\u80FD\u6539\u573A\u666F\u7ED3\u6784\uFF0C\u505C\u6B62\u540E\u518D\u7F16\u8F91",
      "picker.search": "\u641C\u7D22",
      "clip.pick": "\u9009\u62E9\u52A8\u753B",
      "picker.empty": "\u6CA1\u6709\u5339\u914D\u7684\u8D44\u6E90",
      "picker.texture": "\u9009\u62E9\u8D34\u56FE",
      "picker.material": "\u9009\u62E9\u6750\u8D28",
      "picker.environment": "\u9009\u62E9\u73AF\u5883",
      "picker.none": "\u65E0",
      "picker.unset": "\u672A\u8BBE\u7F6E",
      "picker.select": "\u9009\u62E9",
      "picker.clear": "\u6E05\u9664",
      "picker.missing": "\u7F3A\u5931",
      "picker.textureHint": "\u5355\u51FB\u5728\u8D44\u6E90\u7A97\u53E3\u5B9A\u4F4D\uFF0C\u53CC\u51FB\u9884\u89C8",
      "picker.textureLocate": "\u5728\u8D44\u6E90\u7A97\u53E3\u4E2D\u5B9A\u4F4D",
      "picker.textureReplace": "\u9009\u62E9\u6216\u66FF\u6362\u8D34\u56FE",
      "picker.textureDrop": "\u62D6\u653E\u8D34\u56FE\u5230\u8FD9\u91CC",
      "picker.thumbs": "\u5927\u7F29\u7565\u56FE",
      "picker.list": "\u5217\u8868",
      "project.create": "\u521B\u5EFA",
      "project.createScene": "\u573A\u666F",
      "project.createMaterial": "\u6750\u8D28",
      "project.createPrefab": "\u9884\u5236\u4F53",
      "project.newMaterialName": "\u65B0\u6750\u8D28",
      "project.copySuffix": "\u526F\u672C",
      "project.duplicate": "\u590D\u5236",
      "project.findRefs": "\u67E5\u627E\u5F15\u7528",
      "project.noRefs": "\u6CA1\u6709\u7269\u4F53\u5F15\u7528\u8FD9\u4E2A\u8D44\u6E90",
      "project.refs": "\u88AB\u8FD9\u4E9B\u8D44\u6E90\u6216\u7269\u4F53\u4F7F\u7528\uFF1A{names}"
    };
    en = {
      "menu.file": "File",
      "menu.edit": "Edit",
      "menu.create": "Create",
      "menu.view": "View",
      "menu.newProject": "New Project\u2026",
      "menu.openProject": "Open Project\u2026",
      "menu.recentProjects": "Recent Projects",
      "menu.newScene": "New Scene",
      "menu.save": "Save",
      "menu.saveAsProject": "Save as Project\u2026",
      "menu.projectSettings": "Project Settings\u2026",
      "menu.database": "Game Database\u2026",
      "menu.library": "Official Library\u2026",
      "menu.tags": "Tags\u2026",
      "menu.layers": "Layers\u2026",
      "hub.title": "Game data",
      "hub.count": "{tables} tables",
      "hub.database": "Database ({count} tables)",
      "hub.packs": "Packs",
      "hub.search": "Search {name}",
      "hub.reset": "Reset defaults",
      "hub.add": "Add row",
      "hub.catalog": "Tables",
      "hub.corePack": "Core",
      "hub.rowCount": "{count} rows",
      "hub.showing": "Showing {shown} / {total}",
      "hub.empty": "No matching rows. Add one.",
      "hub.id": "Id",
      "hub.name": "Name",
      "hub.category": "Category",
      "hub.note": "Note",
      "hub.delete": "Delete",
      "hub.enabled": "On",
      "hub.disabled": "Off",
      "hub.packHint": "A disabled pack leaves this catalog. Rows already written stay in the project. Stats and items appear when those packs exist.",
      "library.title": "Official Library",
      "library.lead": "Capabilities, gameplay, genres, and assets that ship with the editor. Switches belong to this project.",
      "library.search": "Search",
      "library.empty": "Nothing matches",
      "library.on": "On",
      "library.off": "Off",
      "library.soon": "In development",
      "library.official": "Official",
      "library.includes": "Includes",
      "library.switch": "Project switch",
      "library.soonNote": "Still being built into the editor. The switch opens when the pack is registered.",
      "library.assetNote": "Assets are a catalog. Import them into the project when you use them. Install is not available yet.",
      "library.shelf.capability": "Capabilities",
      "library.shelf.gameplay": "Gameplay",
      "library.shelf.genre": "Genres",
      "library.shelf.asset": "Assets",
      "library.shelfHint.capability": "Simulation and rendering runtimes. Water and weather belong here.",
      "library.shelfHint.gameplay": "Domain packs besides the core. The core pack stays on and is not listed.",
      "library.shelfHint.genre": "Packs for one kind of game. Templates will be marked separately.",
      "library.shelfHint.asset": "Ready-made models, animation, and particle presets.",
      "library.item.physics": "Physics",
      "library.item.physicsDetail": "Colliders, rigidbodies, and simulation while playing.",
      "library.item.physicsPoints": "Rigidbodies and colliders\nSimulation under scene gravity",
      "library.item.buoyancy": "Buoyancy",
      "library.item.buoyancyDetail": "Wave-driven physical buoyancy and water drag (requires Physics).",
      "library.item.buoyancyPoints": "Multi-point buoyancy sampling\nWater drag & wave following",
      "library.item.navigation": "Navigation",
      "library.item.navigationDetail": "Bakes a navmesh from static surfaces. Obstacles can carve it during play.",
      "library.item.navigationPoints": "Navmesh baking\nPaths and obstacles",
      "library.item.spline": "Spline Motion",
      "library.item.splineDetail": "Constant-speed arc-length movement along editable 3D viewport Spline curves.",
      "library.item.splinePoints": "3D viewport curve editor\nArc-length uniform speed\nOnce / Loop / Ping-Pong",
      "library.item.tween": "Tween Motion",
      "library.item.tweenDetail": "Drive looping or one-shot eased position, rotation, scale, and float animations.",
      "library.item.tweenPoints": "12 built-in easing curves\nLoop & Yoyo repeat\nScript self.tween API",
      "library.item.crowd": "Crowd Avoidance",
      "library.item.crowdDetail": "Local separation steering and line/grid/wedge/circle formation movement for multiple units.",
      "library.item.crowdPoints": "Spatial hash local avoidance\nLine / Grid / Wedge / Circle formations\nScript self.crowd / world.crowd",
      "library.item.projectile": "Projectile",
      "library.item.projectileDetail": "Linear, homing, and ballistic projectile flight with tag-based hit detection and auto-recycle.",
      "library.item.projectilePoints": "Linear / Homing / Ballistic\nTag hit detection & pooling\nEmits onProjectileHit",
      "library.item.particles": "Particles",
      "library.item.particlesDetail": "Particle runtime. Turning this off keeps the data and stops playback.",
      "library.item.particlesPoints": "Particle simulation\nPresets live in Assets",
      "library.item.sky": "Sky",
      "library.item.skyDetail": "Time of day, atmospheric scattering and image lighting that follows the sun. Turning this off keeps the settings and stops drawing it.",
      "library.item.skyPoints": "Time and atmosphere\nImage-based lighting\nHeight fog, stars and moon",
      "library.item.water": "Water",
      "library.item.waterDetail": "TSL water surface with dual scrolling normals, planar reflection, depth absorption and shoreline foam.",
      "library.item.waterPoints": "Planar reflection & depth\nShoreline foam & waves\n5 style & 3 quality presets",
      "buoyancy.title": "Buoyancy",
      "buoyancy.enable": "Enable buoyancy",
      "buoyancy.sampleMode": "Sample points",
      "buoyancy.sample.box4": "Bottom 4 corners (boat/crate)",
      "buoyancy.sample.box8": "8 corners (full roll)",
      "buoyancy.sample.center": "Center point (sphere/buoy)",
      "buoyancy.force": "Buoyancy force",
      "buoyancy.waterDrag": "Water drag",
      "buoyancy.angularDrag": "Angular drag",
      "buoyancy.draftDepth": "Draft depth (0 = auto)",
      "buoyancy.needsDynamic": "Requires a dynamic rigid body to float",
      "buoyancy.makeDynamic": "Set dynamic",
      "projectSettings.buoyancyDetail": "Wave-driven physics buoyancy and water drag (requires physics).",
      "spline.title": "Spline Path",
      "projectSettings.splineDetail": "Move objects smoothly along ordered child waypoints of a path node.",
      "tween.title": "Tween Motion",
      "projectSettings.tweenDetail": "Drive looping or one-shot eased position, rotation, scale, and float animations.",
      "crowd.title": "Crowd Avoidance",
      "projectSettings.crowdDetail": "Local separation steering and line/grid/wedge/circle formation movement for multiple units.",
      "projectile.title": "Projectile",
      "projectSettings.projectileDetail": "Linear, homing, and ballistic projectile flight with tag-based hit detection and auto-recycle.",
      "water.title": "Water",
      "water.enable": "Enable water",
      "water.groupColor": "Color & absorption",
      "water.groupWaves": "Ripples & waves",
      "water.groupOptics": "Optics & foam",
      "water.on": "On",
      "water.off": "Off",
      "water.add": "Make Water",
      "water.style": "Style preset",
      "water.quality": "Quality",
      "water.preset.tropical": "Tropical shallow",
      "water.preset.ocean": "Deep ocean",
      "water.preset.lake": "Calm lake",
      "water.preset.pool": "Clear pool",
      "water.preset.stylized": "Stylized toon",
      "water.quality.fast": "Fast (no reflection)",
      "water.quality.balanced": "Balanced (0.5x)",
      "water.quality.ultra": "Ultra (0.75x + waves)",
      "water.shallow": "Shallow color",
      "water.deep": "Deep color",
      "water.absorption": "Absorption (m)",
      "water.opacity": "Base opacity",
      "water.waveScale": "Wave scale",
      "water.flowSpeed": "Flow speed",
      "water.normalScale": "Normal scale",
      "water.reflectivity": "Reflectivity",
      "water.specular": "Sun specular",
      "water.specularSize": "Sparkle size",
      "water.sss": "Subsurface",
      "water.foamWidth": "Foam range",
      "water.foamIntensity": "Foam intensity",
      "water.foamScale": "Foam scale",
      "water.crestFoam": "Crest foam",
      "water.crestThreshold": "Crest threshold",
      "water.foamTrail": "Foam trail",
      "water.debugView": "Debug view",
      "water.debug.off": "Off",
      "water.debug.height": "Wave height",
      "water.debug.squeeze": "Squeeze",
      "water.debug.foam": "Foam mask",
      "water.waveHeight": "Wave height",
      "water.waveSpeed": "Wave speed",
      "water.waveSteepness": "Wave steepness",
      "water.waveBend": "Crest meander",
      "water.swellRate": "Swell rate",
      "water.waveLean": "Crest curl",
      "water.crestSharpness": "Crest sharpness",
      "water.groupSwitches": "Features & Performance",
      "water.planar": "Planar reflect",
      "water.refraction": "Refraction",
      "water.caustics": "Caustics",
      "water.shoreFoam": "Shore foam",
      "water.underwaterEffect": "Underwater effect",
      "water.underwaterColor": "Underwater fog color",
      "water.underwaterFogDensity": "Underwater fog density",
      "water.underwaterFogStart": "Underwater fog start (m)",
      "water.underwaterTint": "Underwater tint",
      "water.underwaterSurfaceBrightness": "Underwater surface brightness",
      "water.softEdge": "Soft edge (m)",
      "water.flowDir": "Flow angle",
      "water.fresnel": "Fresnel power",
      "water.causticsStrength": "Caustics strength",
      "water.causticsScale": "Caustics scale",
      "water.foamColor": "Foam color",
      "water.sunColor": "Sun color",
      "water.normalMap": "Normal map",
      "water.foamMap": "Foam map",
      "library.item.stats": "Stats",
      "library.item.statsDetail": "Health, attack, defense, status effects, and levels.",
      "library.item.statsPoints": "Attributes\nStatus effects\nLevels",
      "library.item.combat": "Combat",
      "library.item.combatDetail": "Melee, shooting, weapons, and combos. Depends on Stats.",
      "library.item.combatPoints": "Weapons and moves\nMelee and shooting",
      "library.item.perception": "Perception",
      "library.item.perceptionDetail": "Targeting and spawning.",
      "library.item.perceptionPoints": "Targeting\nSpawning",
      "library.item.inventory": "Inventory",
      "library.item.inventoryDetail": "Items, containers, and pickups.",
      "library.item.inventoryPoints": "Item table\nContainers and drops",
      "library.item.dialogue": "Dialogue",
      "library.item.dialogueDetail": "Dialogue and quest tracking.",
      "library.item.dialoguePoints": "Dialogue\nQuests",
      "library.item.rts": "Real-time strategy",
      "library.item.rtsDetail": "Selection, groups, and unit orders. A genre pack, not a sample project.",
      "library.item.rtsPoints": "Selection and groups\nUnit orders",
      "library.item.rpg": "Role-playing",
      "library.item.rpgDetail": "Stats, inventory, dialogue, and quests gathered as one ruleset.",
      "library.item.rpgPoints": "Character growth\nQuest flow",
      "library.item.characters": "Characters and animation",
      "library.item.charactersDetail": "Official humanoids and common clips. Import adds them to the project.",
      "library.item.charactersPoints": "Humanoid models\nWalk, run, and jump",
      "library.item.environments": "Environment kit",
      "library.item.environmentsDetail": "Ground, rock, and common props.",
      "library.item.environmentsPoints": "Modular scenes\nProps",
      "library.item.vfx": "Particle presets",
      "library.item.vfxDetail": "Finished impacts, trails, and bursts. Playback still needs the particle capability.",
      "library.item.vfxPoints": "Impacts and bursts\nTrails",
      "hub.noBlock": "No block",
      "menu.projectMenu": "Project",
      "menu.views": "Views",
      "menu.display": "Display",
      "menu.savedDirectory": "Saved to {name}",
      "menu.import": "Import Assets",
      "menu.extractPackage": "Extract Package\u2026",
      "menu.undo": "Undo",
      "menu.redo": "Redo",
      "menu.duplicate": "Duplicate",
      "menu.copy": "Copy",
      "menu.paste": "Paste",
      "menu.group": "Group",
      "menu.ground": "Snap to Ground",
      "menu.delete": "Delete",
      "menu.selectAll": "Select All",
      "menu.empty": "Empty",
      "menu.meshes": "Geometry",
      "menu.lights": "Lights",
      "menu.devices": "Gameplay Devices",
      "menu.camera": "Camera",
      "menu.effect": "Effect",
      "menu.screen": "UI",
      "menu.spline": "Spline Curve",
      "component.add": "Add Component",
      "component.search": "Search components\u2026",
      "component.remove": "Remove Component",
      "component.reset": "Reset to defaults",
      "component.added": "Added",
      "component.empty": "No matching components",
      "component.group.character": "Character & Camera",
      "component.group.devices": "Scene Devices",
      "component.group.world": "Physics & Navigation",
      "component.group.pack": "Gameplay & Domain Packs",
      "menu.focus": "Focus Selection",
      "menu.alignCamera": "Align to Current View",
      "menu.alignView": "Jump to This Camera",
      "menu.focusAll": "Focus All",
      "menu.viewTop": "Top",
      "menu.viewFront": "Front",
      "menu.viewRight": "Right",
      "menu.viewPersp": "Perspective",
      "menu.viewBottom": "Bottom",
      "menu.viewBack": "Back",
      "menu.viewLeft": "Left",
      "menu.grid": "Show Grid",
      "menu.snap": "Grid Snap",
      "menu.resetLayout": "Reset Layout",
      "menu.settings": "Settings",
      "menu.saved": "Saved to local cache",
      "kind.empty": "Empty",
      "kind.box": "Cube",
      "kind.sphere": "Sphere",
      "kind.plane": "Plane",
      "kind.capsule": "Capsule",
      "kind.cylinder": "Cylinder",
      "kind.cone": "Cone",
      "kind.model": "Model",
      "kind.directional-light": "Directional Light",
      "kind.point-light": "Point Light",
      "kind.spot-light": "Spot Light",
      "kind.hemisphere-light": "Hemisphere Light",
      "kind.camera": "Camera",
      "kind.effect": "Effect",
      "kind.screen": "UI",
      "kind.spline": "Spline Curve",
      "tool.newScene": "New Scene",
      "tool.save": "Save to local cache",
      "tool.undo": "Undo",
      "tool.redo": "Redo",
      "tool.move": "Move (W)",
      "tool.rotate": "Rotate (E)",
      "tool.scale": "Scale (R)",
      "tool.world": "World",
      "tool.local": "Local",
      "tool.snap": "Grid Snap",
      "tool.grid": "Show Grid",
      "tool.ground": "Snap to Ground",
      "tool.originCenter": "Gizmo at bounds center",
      "tool.originPivot": "Gizmo at pivot",
      "tool.center": "Center",
      "tool.pivot": "Pivot",
      "tool.play": "Play (Ctrl+P)",
      "tool.pause": "Pause (Ctrl+P)",
      "tool.playLabel": "Play",
      "tool.pauseLabel": "Pause",
      "tool.stop": "Stop (Ctrl+Shift+P)",
      "tool.history": "History",
      "status.unnamed": "Untitled Scene",
      "status.playing": "Playing",
      "status.paused": "Paused",
      "status.ready": "Ready",
      "status.objects": "Objects",
      "status.none": "Nothing selected",
      "status.selected": "{count} selected",
      "status.move": "Move",
      "status.rotate": "Rotate",
      "status.scale": "Scale",
      "status.world": "World",
      "status.local": "Local",
      "status.center": "Center",
      "status.pivot": "Pivot",
      "status.snapOn": "Snap {step}",
      "status.snapOff": "Snap off",
      "status.warming": "Loading assets {completed}/{total}",
      "panel.project": "Assets",
      "panel.viewport": "3D Viewport",
      "panel.console": "Console",
      "panel.scene": "Scene",
      "panel.inspector": "Inspector",
      "panel.history": "History",
      "panel.unknown": "Unknown panel",
      "settings.title": "Editor Settings",
      "settings.general": "General",
      "settings.language": "Language",
      "settings.languageSystem": "Follow System",
      "settings.languageZh": "\u4E2D\u6587",
      "settings.languageEn": "English",
      "settings.autoSave": "Auto Save",
      "settings.autoSaveNote": "Writes to the local cache after edits. Closing the page still saves when this is off.",
      "settings.openLastProject": "Open last project on startup",
      "settings.openLastProjectNote": "Opens the most recent project folder when the page loads.",
      "settings.uiScale": "UI Scale",
      "settings.close": "Close",
      "inspector.modelRenderer": "Model Renderer",
      "inspector.castShadow": "Cast Shadows",
      "inspector.receiveShadow": "Receive Shadows",
      "inspector.materialSlots": "Material Slots",
      "inspector.parts": "Parts",
      "inspector.hierarchy": "Hierarchy",
      "inspector.partHint": "Toggles visibility only. The part stays inside the model.",
      "inspector.sockets": "Bone sockets",
      "inspector.socketHint": "A socket is a child of the character and sticks to this bone. Parent the weapon under the socket and use the weapon\u2019s own position for the grip.",
      "inspector.extractSocket": "Extract socket",
      "inspector.socketReady": "Extracted",
      "inspector.searchBones": "Search bones",
      "inspector.backToModel": "Back to model",
      "inspector.partVisible": "Show part",
      "inspector.showAllSlots": "All ({count})",
      "inspector.partSlotsOnly": "Part only",
      "inspector.sharedSlotHint": "Shared with other parts. Edits affect all of them.",
      "inspector.bonePath": "Path",
      "inspector.jumpSocket": "Select socket",
      "inspector.followModel": "Follow model",
      "inspector.on": "On",
      "inspector.off": "Off",
      "inspector.partMaterial": "Part material",
      "inspector.followSlot": "Follow slot",
      "inspector.searchSlots": "Search material slots",
      "inspector.slot": "Slot {index}",
      "inspector.inline": "Inline",
      "inspector.extract": "Extract as material asset",
      "inspector.reveal": "Show in assets",
      "inspector.clear": "Clear reference and restore inline material",
      "inspector.expandSlot": "Expand material slot",
      "inspector.collapseSlot": "Collapse material slot",
      "inspector.linkedNote": "This slot references a material asset. Edits apply to every object using it.",
      "material.shader": "Shader",
      "material.lit": "Lit",
      "material.unityStandard": "Unity Standard (R Metallic / A Smoothness)",
      "material.unityMetallicGloss": "Metallic Smoothness",
      "material.unityMetallicGlossHint": "Unity convention: Red is metallic, Alpha is smoothness (1-roughness), Green is occlusion",
      "material.particle": "Particle Unlit",
      "material.particleBlend": "Blending",
      "material.blendAlpha": "Alpha",
      "material.blendPremultiply": "Premultiply",
      "material.blendAdditive": "Additive",
      "material.blendMultiply": "Multiply",
      "material.unlitColor": "Unlit Color",
      "material.unlitTexture": "Unlit Texture",
      "material.surface": "Surface",
      "material.color": "Color",
      "material.baseMap": "Base Map",
      "material.metalness": "Metallic",
      "material.roughness": "Roughness",
      "material.metallicRoughness": "Metallic Roughness",
      "material.metallicRoughnessHint": "Green is roughness, blue is metallic, red is occlusion",
      "material.normal": "Normal",
      "material.normalScale": "Normal Scale",
      "material.ao": "Occlusion",
      "material.aoMap": "Occlusion Map",
      "material.aoMapHint": "When empty, the red channel of the metallic-roughness map is used",
      "material.emission": "Emission",
      "material.emissionColor": "Emission",
      "material.emissionIntensity": "Emission Intensity",
      "material.emissionMap": "Emission Map",
      "material.transparency": "Transparency",
      "material.mode": "Mode",
      "material.opaque": "Opaque",
      "material.blend": "Blend",
      "material.clip": "Clip",
      "material.opacity": "Opacity",
      "material.cutoff": "Alpha Cutoff",
      "material.render": "Rendering",
      "material.cull": "Cull",
      "material.cullBack": "Back",
      "material.cullFront": "Front",
      "material.cullOff": "Off",
      "material.depthWrite": "Depth Write",
      "material.wireframe": "Wireframe",
      "material.none": "None",
      "inspector.playBanner": "Values can change while playing. Stop to restore the scene.",
      "inspector.keepPlayChanges": "Keep Changes",
      "tool.keepPlayChanges": "Keep component, material, light, and picture changes made during Play, including scroll distance and right-drag angle (without overwriting runtime positions)",
      "log.keptPlayChanges": "Kept parameter changes made during Play",
      "inspector.multi": "{count} objects selected. Fields edit the primary one. The gizmo moves every unlocked object.",
      "inspector.locked": "Locked",
      "inspector.visible": "Visible",
      "inspector.unlock": "Unlock",
      "inspector.lockHint": "Lock so viewport picking passes through",
      "inspector.sceneSettings": "Scene Settings",
      "inspector.transform": "Transform",
      "inspector.position": "Position",
      "inspector.rotation": "Rotation",
      "inspector.scale": "Scale",
      "inspector.resetPosition": "Reset Position",
      "inspector.resetRotation": "Reset Rotation",
      "inspector.resetScale": "Reset Scale",
      "inspector.model": "Model Animation",
      "character.title": "Character",
      "character.enable": "Control during play",
      "character.driver": "Driver",
      "character.driver.capsule": "Capsule",
      "character.driver.nav": "Navigation",
      "character.driver.hybrid": "Hybrid",
      "character.mode": "Facing",
      "character.mode.adventure": "Third-person free",
      "character.mode.strafe": "Shoulder strafe",
      "character.mode.lockOn": "Lock-on orbit",
      "character.mode.pointAndClick": "Click to move",
      "character.mode.topDown": "Top-down",
      "character.mode.side25d": "Side scroller",
      "character.mode.firstPerson": "First person",
      "character.click": "Click button",
      "character.clickRight": "Right",
      "character.clickLeft": "Left",
      "character.walk": "Walk speed",
      "character.turn": "Turn speed (\xB0/s)",
      "character.sprint": "Sprint multiplier",
      "character.jump": "Jump speed",
      "character.jumps": "Jump count",
      "character.coyote": "Coyote time",
      "character.buffer": "Jump buffer",
      "character.dash": "Dodge",
      "character.dashKey": "Dodge key",
      "character.dashDistance": "Dodge distance",
      "character.radius": "Capsule radius",
      "character.height": "Capsule height",
      "character.capsuleOffset": "Offset",
      "character.physicsInteract": "Physics interaction",
      "character.mass": "Mass (kg)",
      "character.pushStrength": "Push strength",
      "character.swim": "Swim in water",
      "character.swimSpeed": "Swim speed scale",
      "character.swimHeightOffset": "Swim height offset",
      "character.gravity": "Gravity",
      "character.clickStop": "Stop radius",
      "character.footstep": "Footstep distance",
      "character.footstepJuice": "Footstep feel",
      "character.dashDuration": "Dodge duration",
      "character.dashInvincible": "Invincible time",
      "character.dashCooldown": "Dodge cooldown",
      "character.section.control": "Control",
      "character.section.move": "Movement",
      "character.section.body": "Body",
      "character.section.clips": "Locomotion clips",
      "character.lock": "Lock target",
      "character.pickLock": "Choose lock target",
      "character.idle": "Idle clip",
      "character.walkClip": "Walk clip",
      "character.runClip": "Run clip",
      "character.jumpClip": "Takeoff",
      "character.airClip": "In air",
      "character.landClip": "Landing",
      "character.dodgeClip": "Dodge clip",
      "character.swimIdleClip": "Swim idle clip",
      "character.swimClip": "Swim clip",
      "character.hint": "WASD moves, Shift sprints, Space jumps. Dodge defaults to C. Click-to-move uses the chosen mouse button. The follow camera owns the view.",
      "camera.title": "Follow camera",
      "camera.enable": "Follow during play",
      "camera.hint": "The camera looks at the pivot and keeps the offset. Right-drag or mouse orbit turns it. Collision pulls it in before a wall.",
      "camera.preset": "Framing preset",
      "camera.presetPick": "Apply a framing",
      "camera.target": "Follow target",
      "camera.targetSelf": "Self",
      "camera.pickTarget": "Choose follow target",
      "camera.orbit": "Orbit",
      "camera.orbit.rightDrag": "Hold right button",
      "camera.orbit.mouse": "Mouse look",
      "camera.orbit.none": "Fixed angle",
      "camera.fov": "Field of view",
      "camera.damping": "Damping",
      "camera.collision": "Avoid walls",
      "camera.zoom": "Scroll zoom",
      "camera.zoomSpeed": "Zoom speed",
      "camera.minDistance": "Min distance",
      "camera.maxDistance": "Max distance",
      "camera.offset": "Offset",
      "camera.pivot": "Look pivot",
      "camera.sensitivity": "Orbit sensitivity",
      "camera.minPitch": "Min pitch",
      "camera.maxPitch": "Max pitch",
      "camera.local": "Follow facing",
      "camera.look": "Look at target",
      "camera.collisionRadius": "Probe radius",
      "rule.title": "Rules",
      "rule.hint": "The inspector shows a summary. Triggers, conditions, and the action flow are edited in the workbench. A failed If skips the waits inside it.",
      "rule.add": "Add rule and edit",
      "rule.addStep": "Add action",
      "rule.remove": "Remove",
      "rule.limit": "Three levels of nesting is the limit.",
      "rule.cond": "Condition",
      "rule.message": "Message",
      "rule.key": "Key",
      "rule.keyHint": "Click, then press a key",
      "key.hint": "Click, then press a key",
      "key.listening": "Press a key\u2026",
      "rule.tag": "Tag",
      "rule.left": "Left",
      "rule.op": "Compare",
      "rule.right": "Right",
      "rule.var": "Variable",
      "rule.value": "Value",
      "rule.seconds": "Seconds",
      "rule.clip": "Clip",
      "rule.trigger.playStart": "Play starts",
      "rule.trigger.interact": "Interact",
      "rule.trigger.key": "Key",
      "rule.trigger.message": "Message received",
      "rule.trigger.enter": "Enter zone",
      "rule.trigger.exit": "Exit zone",
      "rule.trigger.hit": "Hit",
      "rule.cond.always": "Always",
      "rule.cond.hasTag": "Has tag",
      "rule.cond.missingTag": "Missing tag",
      "rule.cond.compare": "Compare",
      "rule.cond.formula": "Formula",
      "rule.step.message": "Send message",
      "rule.step.setVar": "Set variable",
      "rule.step.addTag": "Add tag",
      "rule.step.removeTag": "Remove tag",
      "rule.step.wait": "Wait seconds",
      "rule.step.waitFrame": "Wait one frame",
      "rule.step.waitUpper": "Wait for overlay",
      "rule.step.waitMark": "Wait for progress",
      "rule.step.playClip": "Play clip",
      "rule.step.playUpper": "Play overlay",
      "rule.step.stance": "Hold stance",
      "rule.step.if": "If",
      "rule.step.gather": "Gather nearby",
      "rule.step.each": "For each",
      "rule.step.switchState": "Switch state",
      "rule.step.showUi": "Show UI",
      "rule.step.hideUi": "Hide UI",
      "rule.step.lock": "Lock target",
      "rule.step.camera": "Switch camera",
      "rule.step.moveTo": "Move to",
      "rule.step.spawn": "Spawn prefab",
      "rule.step.hide": "Destroy self",
      "rule.step.score": "Add score",
      "rule.step.juice": "Play hit feel",
      "rule.step.sound": "Play sound",
      "rule.sound.sfx": "Effect",
      "rule.sound.music": "Music",
      "rule.step.log": "Print to console",
      "rule.formula": "Formula, true when > 0. clamp(value, min, max) and msg.field work",
      "rule.mark": "Progress 0 to 1",
      "rule.target": "Name",
      "rule.offset": "Offset x,y,z",
      "rule.amount": "Score or formula",
      "rule.radius": "Radius",
      "rule.angle": "Angle, 0 for any",
      "rule.pickTag": "Select gameplay tag",
      "rule.pickJuice": "Select hit feel",
      "rule.pickNode": "Select object",
      "rule.pickCamera": "Select camera",
      "rule.pickScreen": "Select UI",
      "rule.pickPrefab": "Select prefab",
      "rule.pickEmpty": "Nothing to pick",
      "rule.packMissing": "Missing ({kind})",
      "rule.packDisabledHint": "Pack disabled, skipped during play",
      "rule.logText": "Text to print",
      "rule.open": "Open rules workbench ({count})",
      "rule.note": "Interact, zones, hits, and messages arrive here. Pick a rule, or open the workbench.",
      "rule.unnamed": "Untitled rule",
      "rule.enabled": "Enable this rule",
      "rule.duplicate": "Duplicate rule",
      "rule.when": "When this happens",
      "rule.ifTitle": "And these conditions hold",
      "rule.doTitle": "Then do, in order",
      "rule.addCond": "Add condition",
      "rule.noCond": "No extra conditions. The actions run as soon as this triggers.",
      "rule.noStep": "No actions yet.",
      "rule.addChild": "Add child step",
      "rule.rules": "Rules",
      "rule.states": "State tree",
      "rule.done": "Done",
      "rule.workbench": "Rules workbench",
      "rule.count": "{count} rules",
      "rule.list": "Rules",
      "rule.empty": "No rules yet. Add one from the toolbar.",
      "rule.name": "Name",
      "rule.triggerKind": "Trigger",
      "rule.alwaysPass": "Always passes",
      "rule.stateName": "State name",
      "rule.enterCond": "Enter condition",
      "rule.enterHint": "Used only for child states. Empty means the state can be entered.",
      "rule.jump": "Jump to another state",
      "rule.noJump": "With no jump, the state stays active.",
      "rule.addJump": "Add jump",
      "rule.pickState": "Choose target",
      "rule.addState": "Add state",
      "rule.addChildState": "Add child state",
      "rule.noState": "No states yet. Locomotion stays on the character. Use states for explore, combat, or stun.",
      "rule.lane.enter": "Enter",
      "rule.lane.tick": "Each frame",
      "rule.lane.exit": "Exit",
      "rule.lane.enterHint": "Runs once when this state is entered.",
      "rule.lane.tickHint": "Repeats while this state is active. Add a wait for effects that should not fire every frame.",
      "rule.lane.exitHint": "Runs once when leaving this state.",
      "rule.live": "Running",
      "rule.waiting": "Waiting",
      "rule.footer": "Edits are undoable. Every tag or variable condition must pass.",
      "interact.title": "Smart object",
      "interact.enable": "Interactable",
      "interact.prompt": "Prompt",
      "interact.key": "Interact key",
      "interact.radius": "Radius",
      "interact.tag": "Interactor tag",
      "interact.any": "Any character",
      "mover.title": "Mover",
      "mover.enable": "Enable",
      "mover.offset": "Offset",
      "mover.duration": "Leg seconds",
      "mover.pause": "Pause",
      "mover.carry": "Carry radius",
      "mover.ping": "Ping pong",
      "mover.auto": "Play on start",
      "mover.message": "Start message",
      "checkpoint.title": "Checkpoint",
      "checkpoint.enable": "Enable",
      "checkpoint.spawn": "Initial spawn",
      "checkpoint.radius": "Radius",
      "checkpoint.delay": "Respawn delay",
      "checkpoint.abyss": "Abyss height",
      "checkpoint.message": "Respawn message",
      "score.title": "Score",
      "score.enable": "Enable",
      "score.hint": "Bind UI text to objective, score, timeLeft",
      "score.objective": "Objective",
      "score.target": "Target",
      "score.interact": "Per interact",
      "score.time": "Time limit",
      "interact.message": "Interact message",
      "interact.once": "Only once",
      "trigger.title": "Trigger zone",
      "trigger.enable": "Enabled",
      "trigger.radius": "Radius",
      "trigger.tag": "Subject tag",
      "trigger.enter": "Enter message",
      "trigger.exit": "Exit message",
      "trigger.once": "Only once",
      "inspector.savePrefab": "Save as Prefab",
      "inspector.shortSavePrefab": "Prefab",
      "inspector.shortPreview": "Preview",
      "prefab.edit": "Open Prefab",
      "prefab.shortEdit": "Open",
      "prefab.shortReveal": "Reveal",
      "prefab.shortApply": "Apply",
      "prefab.shortRevert": "Revert",
      "prefab.shortUnpack": "Unpack",
      "prefab.instance": "Prefab Instance",
      "prefab.apply": "Apply to Prefab",
      "prefab.revert": "Revert Prefab",
      "prefab.unpack": "Unpack",
      "prefab.saveAs": "Save as Prefab\u2026",
      "prefab.saveHint": "Leave blank to use \u201C{name}\u201D.",
      "prefab.reveal": "Reveal Prefab",
      "prefab.openHint": "Click to edit this prefab",
      "prefab.cancel": "Cancel",
      "prefab.confirm": "OK",
      "prefab.discard": "Discard and Return",
      "prefab.unpackTitle": "Unpack Prefab",
      "prefab.unpackMessage": "This instance becomes a normal object and will no longer follow the prefab.",
      "prefab.alreadyInstance": "This is already a prefab instance. Unpack it before saving a new prefab.",
      "prefab.rebind": "Rebind",
      "prefab.rebindPick": "Choose a prefab\u2026",
      "prefab.rebound": "Rebound instances to the new prefab",
      "prefab.editing": "Editing prefab {name}",
      "prefab.saveBack": "Save and Return",
      "prefab.saved": "Prefab saved and instances updated",
      "prefab.closed": "Returned to the scene",
      "prefab.applied": "Instance changes were written to the prefab",
      "prefab.reverted": "Reverted to the prefab",
      "prefab.unpacked": "Prefab unpacked",
      "prefab.place": "Place {name}",
      "prefab.create": "Create prefab {name}",
      "prefab.needOne": "Select a single object to create a prefab",
      "prefab.exitFirst": "Exit prefab editing first",
      "prefab.noPlay": "Cannot play while editing a prefab",
      "prefab.keepRoot": "The prefab root cannot be deleted",
      "prefab.rootLocked": "The prefab root transform stays at the origin",
      "prefab.missing": "Missing prefab",
      "prefab.dirty": "Unapplied changes",
      "inspector.previewModel": "Preview Model",
      "inspector.light": "Light",
      "inspector.color": "Color",
      "inspector.intensity": "Intensity",
      "inspector.angle": "Angle",
      "inspector.ground": "Ground",
      "inspector.range": "Range",
      "inspector.decay": "Decay",
      "inspector.penumbra": "Penumbra",
      "inspector.shadow": "Shadow",
      "inspector.bias": "Bias",
      "inspector.normalBias": "Normal Bias",
      "inspector.camera": "Camera",
      "inspector.fov": "Field of View",
      "inspector.near": "Near",
      "inspector.far": "Far",
      "inspector.material": "Material",
      "inspector.asset": "Asset",
      "inspector.type": "Type",
      "inspector.file": "File",
      "inspector.objects": "Objects",
      "inspector.clips": "Clips",
      "inspector.preview": "Preview",
      "inspector.place": "Place in Scene",
      "inspector.unnamedScene": "Untitled Scene",
      "inspector.scene": "Scene",
      "physics.enable": "Physics",
      "particles.enable": "Effects",
      "particles.title": "Effect",
      "particles.playing": "Playing",
      "particles.material": "Material",
      "particles.materialEmpty": "Default additive",
      "particles.clearMaterial": "Clear material",
      "particles.saveAsset": "Save as asset",
      "particles.saved": "Saved {name} as an effect asset",
      "particles.missing": "The effect capability is off, so this object does not play.",
      "particles.missingAsset": "The effect asset is missing.",
      "particles.badMaterial": "This material is not Particle Unlit, so its look is not used.",
      "particles.version": "This effect was written by quarks {version}. The runtime is {current}.",
      "particles.loadFail": "This effect could not be read: {message}",
      "particles.imported": "Imported effect {name}",
      "particles.notQuarks": "{name} is not a Quarks effect",
      "particles.noEmitter": "This effect has no editable emitter.",
      "particles.emitter": "Emitter",
      "particles.main": "Main",
      "particles.duration": "Duration",
      "particles.looping": "Looping",
      "particles.prewarm": "Prewarm",
      "particles.worldSpace": "World space",
      "particles.renderMode": "Render mode",
      "particles.billboard": "Billboard",
      "particles.stretched": "Stretched billboard",
      "particles.horizontal": "Horizontal billboard",
      "particles.vertical": "Vertical billboard",
      "particles.mesh": "Mesh",
      "particles.trail": "Trail",
      "particles.emission": "Emission",
      "particles.rate": "Rate",
      "particles.burst": "Burst",
      "particles.burstsLocked": "Several bursts are stored; the inspector leaves them alone.",
      "particles.start": "Start",
      "particles.life": "Lifetime",
      "particles.speed": "Speed",
      "particles.size": "Size",
      "particles.rotation": "Rotation",
      "particles.color": "Color",
      "particles.tint": "Tint",
      "particles.alpha": "Alpha",
      "particles.shape": "Shape",
      "particles.shapeType": "Type",
      "particles.shapePoint": "Point",
      "particles.shapeCone": "Cone",
      "particles.shapeSphere": "Sphere",
      "particles.shapeHemisphere": "Hemisphere",
      "particles.shapeCircle": "Circle",
      "particles.shapeDonut": "Donut",
      "particles.shapeRectangle": "Rectangle",
      "particles.radius": "Radius",
      "particles.angle": "Angle",
      "particles.arc": "Arc",
      "particles.thickness": "Thickness",
      "particles.width": "Width",
      "particles.height": "Height",
      "particles.sheet": "Texture sheet",
      "particles.tilesX": "Columns",
      "particles.tilesY": "Rows",
      "particles.force": "Forces",
      "particles.gravity": "Gravity",
      "particles.gravityLocked": "A sideways force is already stored. Gravity is left unchanged.",
      "particles.speedFactor": "Speed stretch",
      "particles.lengthFactor": "Length",
      "particles.trailLength": "Trail segments",
      "particles.modules": "Curve modules",
      "particles.moduleColor": "Color over lifetime",
      "particles.moduleSize": "Size over lifetime",
      "particles.moduleNoise": "Noise",
      "particles.moduleOther": "{name}",
      "particles.min": "min",
      "particles.max": "max",
      "particles.curve": "This value is a curve. The inspector does not edit it.",
      "particles.shared": "Editing asset \u201C{name}\u201D. Every object that uses it changes.",
      "particles.createMaterial": "Create particle material",
      "physics.title": "Physics",
      "physics.participate": "Simulate",
      "physics.body": "Body",
      "physics.static": "Static",
      "physics.dynamic": "Dynamic",
      "physics.kinematic": "Kinematic",
      "physics.shape": "Shape",
      "physics.box": "Box",
      "physics.sphere": "Sphere",
      "physics.capsule": "Capsule",
      "physics.cylinder": "Cylinder",
      "physics.cone": "Cone",
      "physics.convex": "Convex hull",
      "physics.trimesh": "Triangle mesh",
      "physics.convexHint": "Uses the convex hull of this object\u2019s mesh. Dynamic bodies are fine. Concave gaps are not solid.",
      "physics.trimeshHint": "Uses the mesh triangles and can be concave. Best as static or kinematic. Dynamic bodies are steadier with a convex hull.",
      "physics.radius": "Radius",
      "physics.height": "Height",
      "physics.size": "Size",
      "physics.trigger": "Trigger",
      "physics.mass": "Mass",
      "physics.friction": "Friction",
      "physics.restitution": "Restitution",
      "physics.linearDamping": "Linear damping",
      "physics.angularDamping": "Angular damping",
      "physics.gravityScale": "Gravity scale",
      "physics.gravity": "Gravity",
      "audio.title": "Audio",
      "audio.master": "Master",
      "audio.music": "Music",
      "audio.sfx": "Effects",
      "audio.volume": "Volume",
      "audio.pick": "Choose sound",
      "audio.hint": "In the browser, sound starts after the first click. The desktop app can play immediately.",
      "soundSource.title": "Sound source",
      "soundSource.enable": "Enable",
      "soundSource.clip": "Sound",
      "soundSource.loop": "Loop",
      "soundSource.distance": "Full volume distance",
      "soundSource.rolloff": "Falloff",
      "soundSource.hint": "Plays on this object during play and follows it. Turn loop off to play once.",
      "physics.disabledHint": "The physics pack is off. Collider data stays on the objects.",
      "navigation.enable": "Navigation",
      "navigation.title": "Navigation",
      "navigation.participate": "Navigate",
      "navigation.role": "Use",
      "navigation.surface": "Surface",
      "navigation.obstacle": "Obstacle",
      "navigation.radius": "Radius",
      "navigation.height": "Height",
      "navigation.cellSize": "Cell size",
      "navigation.cellHeight": "Cell height",
      "navigation.slope": "Max slope",
      "navigation.agentRadius": "Agent radius",
      "navigation.agentHeight": "Agent height",
      "navigation.maxObstacles": "Obstacle capacity",
      "navigation.show": "Show mesh",
      "navigation.bake": "Bake",
      "navigation.rebake": "Bake again",
      "navigation.clear": "Clear",
      "navigation.cleared": "Cleared the navigation mesh.",
      "navigation.cancel": "Cancel bake",
      "navigation.baking": "Baking\u2026",
      "navigation.ready": "Walkable surface is ready",
      "navigation.noSurface": "There is no navigation surface to bake.",
      "navigation.disabledHint": "The navigation pack is off. Surface and obstacle data stays on the objects.",
      "navigation.stale": "Parameters changed. Bake again.",
      "navigation.triangles": "Source triangles",
      "navigation.obstacleHint": "When obstacle capacity is above 0, play mode carves vertical cylinders out of the navmesh.",
      "projectSettings.title": "Project Settings",
      "projectSettings.modules": "Capability packs",
      "projectSettings.note": "Switches are saved with this project. Turning one off stops loading that module and keeps data already authored.",
      "projectSettings.physicsDetail": "Colliders, rigidbodies, and simulation while playing.",
      "projectSettings.particlesDetail": "Particle effects. Turning this off keeps the data and stops playback.",
      "sky.enable": "Sky",
      "sky.title": "Sky",
      "sky.time": "Time",
      "sky.latitude": "Latitude",
      "sky.day": "Day of year",
      "sky.north": "North",
      "sky.northPosZ": "+Z is north",
      "sky.northNegZ": "-Z is north",
      "sky.northPosX": "+X is north",
      "sky.northNegX": "-X is north",
      "sky.atmosphere": "Atmosphere",
      "sky.exposure": "Sky exposure",
      "sky.turbidity": "Turbidity",
      "sky.albedo": "Ground albedo",
      "sky.mirror": "Mirror below horizon",
      "sky.sun": "Sun",
      "sky.sunDisc": "Sun disc",
      "sky.angularSize": "Angular size \xB0",
      "sky.sunIntensity": "Sun intensity",
      "sky.sunShadow": "Sun shadows",
      "sky.haze": "Aerial haze",
      "sky.hazeStrength": "Strength",
      "sky.hazeNear": "Near range",
      "sky.fog": "Height fog",
      "sky.fogColor": "Color",
      "sky.fogSkyColor": "Match the sky",
      "sky.fogDensity": "Density",
      "sky.fogFalloff": "Height falloff",
      "sky.fogBase": "Base height",
      "sky.fogOpacity": "Max opacity",
      "sky.night": "Night",
      "sky.stars": "Stars",
      "sky.starIntensity": "Starlight",
      "sky.starSize": "Star size",
      "sky.milkyWay": "Milky Way",
      "sky.moon": "Moon",
      "sky.moonPhase": "Moon phase",
      "sky.moonLight": "Moonlight",
      "projectSettings.skyDetail": "Procedural atmosphere and time of day. While on, it replaces the background and environment image so metal reflections follow the sun. Turning it off keeps the settings.",
      "projectSettings.navigationDetail": "Bakes a navmesh from static surfaces. Obstacles can carve it during play, and path queries read that mesh.",
      "projectSettings.catalogs": "Project catalogs",
      "projectSettings.manage": "Manage\u2026",
      "tags.title": "Tags",
      "tags.subtitle": "Like Unity tags: each object has one primary tag, plus extra hierarchical tags for filtering and later gameplay queries.",
      "tags.name": "Name",
      "tags.id": "Id",
      "tags.add": "Add Tag",
      "tags.addDefault": "New Tag",
      "tags.remove": "Delete",
      "tags.done": "Done",
      "tags.card": "Tag",
      "tags.none": "Untagged",
      "tags.orphan": "Missing tag {id}",
      "tags.extraPlaceholder": "+ Type a tag such as Team.Enemy and press Enter",
      "tags.gameplay": "Gameplay tags",
      "tags.addGameplay": "Add gameplay tag\u2026",
      "tags.runtime": "Timed tag while playing",
      "tags.openDatabase": "Open game database",
      "tags.filter": "Filter by tag",
      "tags.filterAll": "All",
      "tags.filterUntagged": "Untagged only",
      "layers.title": "Layers",
      "layers.subtitle": "Layers drive viewport visibility and physics collision. Bit 31 is reserved for editor helpers.",
      "layers.tabLayers": "Layers",
      "layers.tabPhysics": "Physics matrix",
      "layers.bit": "Bit",
      "layers.name": "Name",
      "layers.id": "Id",
      "layers.builtIn": "Built-in",
      "layers.visible": "View",
      "layers.add": "Add Layer",
      "layers.addDefault": "New Layer",
      "layers.remove": "Delete",
      "layers.done": "Done",
      "layers.show": "Show this layer in the viewport",
      "layers.hide": "Hide this layer in the viewport",
      "layers.card": "Layer",
      "layers.option": "{name} \xB7 bit {bit}",
      "layers.matrixEnable": "Use collision matrix",
      "layers.matrixHint": "Each row is one pair of layers. Checked pairs collide, and the relationship is symmetric. While off, every layer collides. Rapier uses the first 16 bits.",
      "layers.matrixEmpty": "Add at least two layers to choose collision pairs.",
      "inspector.column.system": "System",
      "inspector.column.packs": "Extension packs",
      "inspector.sky": "Sky",
      "inspector.background": "Background",
      "inspector.exposure": "Exposure",
      "inspector.toneMapping": "Tone Mapping",
      "tone.none": "None",
      "tone.linear": "Linear",
      "tone.reinhard": "Reinhard",
      "tone.cineon": "Cineon",
      "tone.aces": "ACES",
      "tone.agx": "AgX",
      "tone.neutral": "Neutral",
      "inspector.fog": "Fog",
      "inspector.enabled": "Enabled",
      "inspector.fogColor": "Fog Color",
      "inspector.fogStart": "Start",
      "inspector.fogEnd": "End",
      "inspector.environment": "Environment Lighting",
      "inspector.env": "Environment",
      "inspector.bloom": "Bloom",
      "inspector.aa": "Antialiasing",
      "inspector.ssr": "Screen Reflections",
      "inspector.ssrQuality": "Quality",
      "inspector.ssrDistance": "Distance",
      "inspector.ssrThickness": "Thickness",
      "inspector.volume": "Volumetric Light",
      "inspector.volumeDensity": "Density",
      "inspector.volumeSteps": "Steps",
      "inspector.volumeSize": "Extent",
      "inspector.volumeHeight": "Height",
      "inspector.ssgi": "Global Illumination",
      "inspector.ssgiIndirect": "Indirect",
      "inspector.ssgiOcclusion": "Occlusion",
      "inspector.ssgiRadius": "Radius",
      "inspector.ssgiSlices": "Slices",
      "inspector.ssgiSteps": "Steps",
      "inspector.ssgiDenoise": "Denoise",
      "inspector.radius": "Radius",
      "inspector.threshold": "Threshold",
      "inspector.dof": "Depth of Field",
      "inspector.focus": "Focus",
      "inspector.focal": "Focal Length",
      "inspector.bokeh": "Bokeh",
      "inspector.occlusion": "Ambient Occlusion",
      "inspector.grade": "Color Grade",
      "inspector.hue": "Hue",
      "inspector.saturation": "Saturation",
      "inspector.clip": "Clip",
      "inspector.play": "Play",
      "inspector.pause": "Pause",
      "inspector.time": "Time",
      "inspector.animFile": "Animation",
      "inspector.modelClips": "Model clips",
      "inspector.fileClips": "File clips",
      "humanoid.summary": "Humanoid \xB7 {skins} skins \xB7 {bind} \xB7 {motion}",
      "humanoid.noHips": "No hips bone was recognized, so clips will not retarget onto this model.",
      "humanoid.missing": "Missing {names}",
      "humanoid.coreOk": "{count} core slots found",
      "humanoid.restConflict": "These bones disagree across skins: {names}",
      "humanoid.bind": "bind pose",
      "humanoid.noBind": "no bind pose",
      "humanoid.inPlace": "in place",
      "humanoid.rootMotion": "root motion",
      "humanoid.motionUnknown": "motion unknown",
      "humanoid.slots": "Bone slots",
      "humanoid.slotsHint": "Correct one bone when the automatic slot is wrong. Play the clip again afterwards.",
      "humanoid.auto": "Auto",
      "humanoid.slotHips": "Hips",
      "humanoid.slotSpine": "Spine",
      "humanoid.slotHead": "Head",
      "humanoid.slotLeftUpperArm": "Left upper arm",
      "humanoid.slotLeftLowerArm": "Left lower arm",
      "humanoid.slotRightUpperArm": "Right upper arm",
      "humanoid.slotRightLowerArm": "Right lower arm",
      "humanoid.slotLeftUpperLeg": "Left upper leg",
      "humanoid.slotLeftLowerLeg": "Left lower leg",
      "humanoid.slotRightUpperLeg": "Right upper leg",
      "humanoid.slotRightLowerLeg": "Right lower leg",
      "humanoid.adjust": "Retarget adjust",
      "humanoid.adjustHint": "Leave this closed unless the automatic result is off. Positive values widen the shoulders, rotate them outward, spread the arms, bend the elbows, widen the hips, bend the knees, point the toes down, raise the hips, and lengthen the stride. Applied only when another skeleton plays on this character.",
      "humanoid.reset": "Reset to automatic",
      "humanoid.shoulderWidth": "Shoulder width",
      "humanoid.shoulderRotate": "Shoulder rotate",
      "humanoid.armSpread": "Arm spread",
      "humanoid.elbowBend": "Elbow",
      "humanoid.hipSpread": "Hip spread",
      "humanoid.kneeBend": "Knee",
      "humanoid.footPitch": "Foot pitch",
      "humanoid.hipsHeight": "Hips height",
      "humanoid.stride": "Stride",
      "project.clips": "Clips",
      "anim.loop": "Loop",
      "anim.speed": "Speed",
      "anim.fade": "Fade",
      "anim.inPlace": "In place",
      "anim.animator": "State machine",
      "anim.enabled": "Enabled",
      "anim.current": "Current {name}",
      "anim.addState": "Add state",
      "anim.addParam": "Add parameter",
      "anim.addTransition": "Add transition",
      "anim.transitions": "Transitions",
      "anim.state": "State",
      "anim.param": "Parameter",
      "anim.remove": "Remove",
      "anim.bool": "Bool",
      "anim.number": "Number",
      "anim.trigger": "Trigger",
      "anim.fire": "Fire",
      "anim.equals": "Equals",
      "anim.greater": "Greater",
      "anim.less": "Less",
      "anim.simple": "Simple",
      "anim.machine": "State machine",
      "anim.simpleHint": "Play one clip. Switch to the state machine for parameters and automatic changes.",
      "anim.machineHint": "The state machine picks the clip. Each state has its own mask.",
      "anim.end": "When finished",
      "anim.hold": "Hold last frame",
      "anim.stop": "Stop",
      "anim.backToDefault": "Return to default",
      "anim.default": "Default",
      "anim.setDefault": "Set default",
      "anim.fromClips": "Create states from clips",
      "anim.seedParams": "Add common parameters",
      "anim.mask": "Bone mask",
      "anim.overlay": "Upper body",
      "anim.overlayStop": "Stop overlay",
      "anim.maskFull": "Full body",
      "anim.maskUpper": "Upper body only",
      "anim.maskLower": "Lower body only",
      "anim.exit": "Wait until",
      "anim.embedded": "{count} embedded clips",
      "asset.scene": "Scene",
      "asset.model": "Model",
      "asset.texture": "Texture",
      "asset.environment": "Environment",
      "asset.material": "Material",
      "asset.effect": "Effect",
      "asset.ui": "UI",
      "project.createUi": "UI",
      "project.newUiName": "Score UI",
      "ui.open": "Edit UI",
      "ui.add": "Add",
      "ui.delete": "Delete",
      "ui.up": "Up",
      "ui.down": "Down",
      "ui.close": "Close",
      "ui.undo": "Undo",
      "ui.redo": "Redo",
      "ui.zoom": "Zoom",
      "ui.name": "Name",
      "ui.text": "Text",
      "ui.image": "Image",
      "ui.layout": "Layout",
      "ui.anchor": "Anchor",
      "ui.flex": "Stack",
      "ui.anchorPreset": "Anchor",
      "ui.custom": "Keep",
      "ui.direction": "Direction",
      "ui.column": "Column",
      "ui.row": "Row",
      "ui.gap": "Gap",
      "ui.width": "Width",
      "ui.height": "Height",
      "ui.style": "Style",
      "ui.state": "State",
      "ui.color": "Color",
      "ui.align": "Align",
      "ui.align.left": "Left",
      "ui.align.center": "Center",
      "ui.align.right": "Right",
      "ui.border": "Border",
      "ui.borderWidth": "Border width",
      "ui.fontSize": "Font size",
      "ui.background": "Background",
      "ui.opacity": "Opacity",
      "ui.radius": "Radius",
      "ui.tint": "Fill",
      "ui.binding": "Binding",
      "ui.source": "Source",
      "ui.variable": "Variable",
      "ui.component": "Component",
      "ui.node": "Object",
      "ui.field": "Field",
      "ui.value": "Value",
      "ui.min": "Min",
      "ui.max": "Max",
      "ui.click": "Click",
      "ui.none": "None",
      "ui.sendMessage": "Send message",
      "ui.setVariable": "Set variable",
      "ui.message": "Message",
      "ui.fake": "Preview values",
      "ui.previewClick": "{name}: {detail}",
      "ui.document": "UI",
      "ui.layer": "Layer",
      "ui.visibleOnPlay": "Visible when play starts",
      "ui.addScreen": "Add screen UI",
      "ui.removeScreen": "Remove",
      "ui.missing": "Missing UI document",
      "ui.mount": "Mount UI",
      "ui.type.panel": "Panel",
      "ui.type.stack": "Stack",
      "ui.type.text": "Text",
      "ui.type.image": "Image",
      "ui.type.button": "Button",
      "ui.type.progress": "Progress",
      "ui.state.normal": "Normal",
      "ui.state.hover": "Hover",
      "ui.state.pressed": "Pressed",
      "ui.state.disabled": "Disabled",
      "ui.target.text": "Text",
      "ui.target.visible": "Visible",
      "ui.target.enabled": "Enabled",
      "ui.target.progress": "Progress",
      "ui.target.opacity": "Opacity",
      "ui.anchor.top": "Top",
      "ui.anchor.center": "Center",
      "ui.anchor.bottom": "Bottom",
      "ui.anchor.left": "Left",
      "ui.anchor.right": "Right",
      "ui.layer.hud": "HUD",
      "ui.layer.menu": "Menu",
      "ui.layer.popup": "Popup",
      "ui.layer.modal": "Modal",
      "log.createdUi": "Created UI {name}",
      "log.mountedUi": "Mounted UI {name}",
      "log.uiMessage": "UI sent message {message}",
      "asset.animation": "Animation",
      "asset.audio": "Audio",
      "asset.prefab": "Prefab",
      "project.all": "All",
      "project.model": "Models",
      "project.image": "Materials/Textures",
      "project.audio": "Audio",
      "project.animation": "Animations",
      "project.scene": "Scenes",
      "project.used": "Used Here",
      "project.unused": "Unused",
      "project.newFolder": "New folder in the current directory",
      "project.search": "Search assets",
      "project.clear": "Clear",
      "project.import": "Import",
      "project.extractPackage": "Extract Unity Package",
      "pkg.title": "Extract Package",
      "pkg.noFile": "No file selected",
      "pkg.close": "Close",
      "pkg.scanning": "Scanning extractable assets\u2026",
      "pkg.scanningSlow": "This package is large. The window is still working.",
      "pkg.scanFailed": "Scan failed: {detail}",
      "pkg.empty": "No extractable models, textures, animations, or materials.",
      "pkg.models": "Models",
      "pkg.textures": "Textures",
      "pkg.animations": "Animations",
      "pkg.materials": "Materials",
      "pkg.hidden": "Hidden",
      "pkg.unsupported": "Unsupported",
      "pkg.previewOnly": "Extracts models, textures, animations, and materials. FBX uses ufbx. Merged animations are retargeted onto the body model.",
      "pkg.selectedSummary": "{count} selected",
      "pkg.selectAll": "All",
      "pkg.selectNone": "None",
      "pkg.selectModels": "Models only",
      "pkg.selectTextures": "Textures only",
      "pkg.selectAnimations": "Animations only",
      "pkg.selectMaterials": "Materials only",
      "pkg.filterPlaceholder": "Filter by file name",
      "pkg.filterEmpty": "No matching files",
      "pkg.targetDirectory": "Target folder",
      "pkg.directoryMode": "Folders",
      "pkg.directoryModeFlat": "Split folders (Textures / Materials / Animations)",
      "pkg.directoryModePreserve": "Keep package folders",
      "pkg.showDiagnostics": "Show diagnostics",
      "pkg.hideDiagnostics": "Hide diagnostics",
      "pkg.extracting": "Extracting\u2026",
      "pkg.extractingTitle": "Extracting assets",
      "pkg.extractingProgress": "{completed} / {total}",
      "pkg.extractSelected": "Extract selected ({count})",
      "pkg.extractSuccess": "Extracted {count} assets.",
      "pkg.extractFailed": "{count} assets failed.",
      "pkg.companions": "{count} companion files",
      "pkg.warnings": "{count} warnings",
      "pkg.kind.model": "Model",
      "pkg.kind.texture": "Texture",
      "pkg.kind.animation": "Animation",
      "pkg.kind.material": "Material",
      "pkg.role.modelBody": "Body",
      "pkg.role.animationCarrier": "Animation",
      "pkg.role.ordinaryModel": "Ordinary",
      "pkg.role.unknownModel": "Unreviewed",
      "pkg.confidence.high": "High",
      "pkg.confidence.medium": "Medium",
      "pkg.confidence.low": "Low",
      "pkg.roleOverrideFor": "Role for {name}",
      "pkg.carrierBodyFor": "Body for {name}",
      "pkg.noCarrierBody": "No body",
      "pkg.mergePreview.title": "Animation merge preview",
      "pkg.mergePreview.summary": "{bodies} bodies, {carriers} animations",
      "pkg.phase.textures": "Textures",
      "pkg.phase.models": "Models",
      "pkg.phase.animations": "Animations",
      "pkg.phase.materials": "Materials",
      "pkg.phase.retarget": "Retarget",
      "pkg.diag.hidden": "Hidden",
      "pkg.diag.unsupported": "Unsupported",
      "pkg.diag.missingPathname": "Missing path",
      "pkg.diag.missingAssetBytes": "Missing bytes",
      "pkg.diag.scan": "Scan diagnostics",
      "project.newScene": "New scene in the current directory",
      "project.count": "{count} items",
      "project.list": "List",
      "project.details": "Details",
      "project.grid": "Grid",
      "project.name": "Name",
      "project.type": "Type",
      "project.detail": "Details",
      "project.drop": "Drop to import",
      "project.empty": "This folder is empty.",
      "project.deleteScene": "Delete scene \u201C{name}\u201D? Its objects will be removed.",
      "project.deleteAsset": "Delete \u201C{name}\u201D? This cannot be undone.",
      "project.cancel": "Cancel",
      "project.open": "Open",
      "project.reveal": "Show in Explorer\u2026",
      "project.revealMissing": "This item is not on disk yet. Save the project as a folder first.",
      "project.revealFailed": "Could not open the folder: {message}",
      "project.place": "Place in Scene",
      "project.rename": "Rename",
      "project.delete": "Delete",
      "project.resizeTextures": "Batch resize textures\u2026",
      "texResize.title": "Batch Resize Textures",
      "texResize.maxEdge": "Max edge",
      "texResize.search": "Search textures\u2026",
      "texResize.scopeCurrent": "Current scope only",
      "texResize.scopeAll": "Show all textures ({count})",
      "texResize.selectAll": "Select all",
      "texResize.selectLarge": "Only > {size}px",
      "texResize.selectBackedUp": "Only backed up",
      "texResize.clear": "Clear",
      "texResize.empty": "No matching texture assets",
      "texResize.unsupported": "Unsupported format",
      "texResize.backedUp": "Original backed up",
      "texResize.skipFormat": "Format skipped",
      "texResize.restoreOrSkip": "Will restore original",
      "texResize.alreadySmall": "Already fits, skip",
      "texResize.backupHint": "Originals are backed up automatically before overwriting and can be restored anytime",
      "texResize.progress": "Processing {done} / {total}\u2026",
      "texResize.restore": "Restore original ({count})",
      "texResize.apply": "Apply resize ({count})",
      "texResize.done": "Textures resized: {updated} updated, {skipped} skipped, {failed} failed",
      "texResize.restored": "Textures restored: {updated} restored, {failed} failed",
      "project.newFolderMenu": "New Folder",
      "project.deleteFolder": "Delete folder \u201C{name}\u201D? Assets and subfolders inside are deleted too. This cannot be undone.",
      "project.objects": "{count} objects",
      "project.inUse": "In use",
      "project.sceneHint": "Click to open. Click the current scene again to rename.",
      "project.modelHint": "Double-click to preview. Drag into the viewport to place.",
      "project.envHint": "Double-click to preview the environment map",
      "project.textureHint": "Double-click to preview. Drag onto an object.",
      "project.animHint": "Drag onto a model to play",
      "project.audioHint": "Double-click to listen",
      "project.openFolder": "Double-click to open the folder",
      "project.folder": "Folder",
      "hierarchy.search": "Search objects",
      "hierarchy.expand": "Expand all",
      "hierarchy.collapse": "Collapse all",
      "hierarchy.create": "Create",
      "hierarchy.empty": "The scene is empty. Use + or the Create menu to add objects.",
      "hierarchy.hint": "Click to select, click again to rename, double-click to focus",
      "hierarchy.hide": "Hide",
      "hierarchy.show": "Show",
      "hierarchy.locked": "Locked: viewport picking and the gizmo pass through",
      "hierarchy.lock": "Lock so viewport picking and the gizmo pass through",
      "hierarchy.createChild": "Create Child",
      "hierarchy.unparent": "Unparent",
      "hierarchy.pasteChild": "Paste as Child",
      "hierarchy.moveUp": "Move Up",
      "hierarchy.moveDown": "Move Down",
      "view.persp": "Persp",
      "view.top": "Top",
      "view.bottom": "Bottom",
      "view.front": "Front",
      "view.back": "Back",
      "view.left": "Left",
      "view.right": "Right",
      "view.up": "Up",
      "view.down": "Down",
      "view.world": "World space",
      "view.local": "Local space",
      "view.helpers": "Helpers",
      "view.grid": "Grid",
      "view.lights": "Lights and cameras",
      "view.gizmoCenter": "Gizmo at center",
      "view.snap": "Snap",
      "view.step": "Step",
      "view.focus": "Focus selection (F)",
      "view.fullscreen": "Maximize viewport",
      "view.stats": "{objects} objects \xB7 {triangles} tris",
      "view.statsOpen": "Stats",
      "view.statsTitle": "Stats",
      "view.statsRender": "Rendering",
      "view.statsPhysics": "Physics",
      "view.statsCamera": "Camera and selection",
      "view.statsBackend": "Backend",
      "view.statsCalls": "Draw calls",
      "view.statsTris": "Rendered triangles",
      "view.statsMeshes": "Meshes / vertices",
      "view.statsMats": "Materials / textures",
      "view.statsNodes": "Scene objects",
      "view.statsAssets": "Assets",
      "view.statsBodies": "Bodies dyn / kin / static",
      "view.statsTriggers": "Triggers",
      "view.statsPlay": "Play",
      "view.statsCamMode": "Camera",
      "view.statsCamPos": "Position",
      "view.statsSelected": "Selection",
      "view.statsNone": "None",
      "view.statsPlaying": "Playing",
      "view.statsEditing": "Editing",
      "view.statsReady": "Running",
      "view.statsIdle": "Idle",
      "view.statsCollapse": "Collapse details",
      "view.statsExpand": "Expand details",
      "view.statsVertices": "Vertices",
      "view.statsCallsShort": "Calls",
      "view.statsTrisShort": "Tris",
      "view.costTitle": "Top 8 costs",
      "view.costHint": "Average per frame, last half second",
      "view.cost.core.character": "Character",
      "view.cost.core.camera": "Follow camera",
      "view.cost.core.rules": "Rules",
      "view.cost.core.devices": "Interact and triggers",
      "view.cost.core.movers": "Movers",
      "view.cost.core.round": "Score and round",
      "view.cost.physics": "Physics",
      "view.cost.navigation": "Navigation",
      "view.cost.animation": "Skeletal animation",
      "view.cost.particles": "Particles",
      "view.cost.render": "Scene render",
      "view.cost.picture": "Picture and pre-draw",
      "view.cost.rig": "Editor camera",
      "view.create": "Create",
      "view.createChild": "Create Child",
      "view.paste": "Paste",
      "console.info": "Info",
      "console.warn": "Warning",
      "console.error": "Error",
      "console.filter": "Filter",
      "console.clear": "Clear",
      "history.empty": "Nothing to undo yet. Moves, creates, and deletes are recorded here.",
      "history.current": "Current",
      "preview.pendingMaterial": "Material is not ready",
      "preview.sphere": "Sphere",
      "preview.box": "Box",
      "preview.torus": "Torus",
      "preview.plane": "Plane",
      "preview.studio": "Studio",
      "preview.bright": "Bright",
      "preview.dark": "Dark",
      "preview.turn": "Turn",
      "preview.popout": "Pop out",
      "preview.title": "Preview",
      "preview.pendingModel": "Model is still loading",
      "preview.lit": "Lit",
      "preview.wire": "Wire",
      "preview.unlit": "Unlit",
      "preview.bounds": "Bounds",
      "preview.reset": "Reset",
      "preview.light": "Light",
      "preview.faces": "{count} faces",
      "preview.tabOverview": "Overview",
      "preview.tabMesh": "Meshes",
      "preview.tabAnim": "Animation",
      "preview.tabMaterial": "Materials",
      "preview.tabSocket": "Sockets",
      "preview.tabImport": "Import",
      "preview.importScale": "Import scale",
      "preview.reimport": "Reimport",
      "preview.reimportDone": "Reimported {name}",
      "preview.reimportFailed": "Reimport failed. The source file is not in the cache.",
      "preview.reimportFailedDetail": "Reimport failed: {message}",
      "preview.reimportUnavailable": "This asset cannot be reimported.",
      "preview.source": "Source",
      "preview.scaleHint": "Height is {height} m. Suggested import scale is {scale}x.",
      "preview.useScale": "Set {scale}x",
      "preview.noMesh": "No mesh stats yet. Reimport to list each mesh.",
      "preview.noBone": "This model has no skeleton.",
      "preview.noClip": "No embedded clips.",
      "preview.socketEmpty": "No sockets yet. Add one from a bone to show its axis in the preview.",
      "preview.addSocket": "Add socket",
      "preview.triangles": "Triangles",
      "preview.vertices": "Vertices",
      "preview.meshes": "Meshes",
      "preview.slots": "Slots",
      "preview.bones": "Bones",
      "preview.sourceSize": "Source {size}",
      "preview.textureHint": "Scroll to zoom, drag to pan. Saving creates a new texture and cannot be undone.",
      "preview.flipX": "Flip horizontally",
      "preview.flipY": "Flip vertically",
      "preview.flipNormalY": "Flip normal Y",
      "preview.width": "W",
      "preview.height": "H",
      "preview.lockAspect": "Lock aspect",
      "preview.saveTexture": "Save as new texture",
      "preview.overwriteTexture": "Overwrite original",
      "preview.saving": "Saving\u2026",
      "preview.savedTexture": "Saved new texture \u201C{name}\u201D",
      "preview.overwroteTexture": "Overwrote original \u201C{name}\u201D (original backed up)",
      "preview.actor": "Actor",
      "preview.noActor": "Import a model first to preview this animation",
      "preview.loading": "Loading\u2026",
      "preview.saveTextureFail": "Failed to save texture: {message}",
      "preview.envHint": "Drag to rotate, scroll to zoom",
      "gesture.create": "Create {name}",
      "gesture.rename": "Rename",
      "gesture.move": "Move",
      "gesture.rotate": "Rotate",
      "gesture.scale": "Scale",
      "gesture.light": "Edit Light",
      "gesture.camera": "Edit Camera",
      "gesture.alignCamera": "Align Camera",
      "gesture.picture": "Edit Picture",
      "gesture.shadow": "Edit Shadows",
      "gesture.material": "Edit Material",
      "gesture.map": "Set Texture",
      "gesture.mapClear": "Clear Texture",
      "gesture.anim": "Preview Animation",
      "gesture.reset": "Reset Transform",
      "gesture.color": "Edit Color",
      "error.panel": "{name} failed: {message}",
      "log.cacheOpenFail": "Could not open the local project cache. Starting with an empty scene.",
      "log.projectCreated": 'Created project "{name}". Sources are in Assets/, cache is in .cache/t3d/',
      "log.projectSavedAs": 'Saved the current project as "{name}"',
      "log.projectSaveAsOccupied": '"{name}" already contains a project. Choose an empty folder',
      "log.projectOpened": 'Opened project "{name}"',
      "log.projectExists": 'This folder already has a project. Opened "{name}"',
      "log.projectMissing": "This folder has no project.t3d",
      "log.projectInvalid": "Could not read project.t3d",
      "log.projectFailed": "Project action failed: {message}",
      "log.projectBrowser": "This browser cannot pick a local project folder",
      "log.projectPermission": "The last project needs permission again. Open it from File \u2192 Recent Projects, or use Open Project.",
      "log.projectLoose": "Added {count} file(s) from the Assets folder",
      "status.localProject": "Local cache",
      "log.opened": "Project opened, scene {ms}ms",
      "log.openedDetail": "Project opened in {total}ms (scene {scene}ms \xB7 models {model}ms \xB7 textures {texture}ms), artifact hits {hits}, source parses {parsed}, failed {failed}",
      "log.openProfile": "Open profile (assets ready to steady frames): main thread {costs} \xB7 new shaders {shaders} \xB7 pipelines compiled on draw {pipelines} \xB7 precompiled pipelines {asyncPipelines} ({asyncMs}ms total, worst {asyncWorst}ms) \xB7 before assets were ready: shaders {earlyShaders}, pipelines {earlyPipelines}",
      "log.openTimeline": "Open timeline (wall clock): read project {read}ms \xB7 session {session}ms \xB7 scan folders {scan}ms \xB7 save {save}ms \xB7 asset restore {warm}ms (models {model}ms \xB7 textures {texture}ms) \xB7 renderer init {init}ms (assets waited {wait}ms for it) \xB7 shader precompile {compile}ms (UI stays responsive) \xB7 precompile to steady frames {settle}ms ({frames} frames, {slow} slow, worst {worst}ms) \xB7 main-thread long tasks {tasks} totalling {busy}ms, longest {longest}ms",
      "log.backend": "Renderer: {label}",
      "log.webgpu": "WebGPU",
      "log.webgl2": "WebGL2 fallback",
      "log.playCameraMany": 'Several MainCamera tags; play uses "{name}"',
      "log.rendererFail": "Renderer failed to start: {message}",
      "log.unknownFile": "Unrecognized file: {name}",
      "log.importFail": "{name} failed to import: {message}",
      "log.already": "Asset is already in the library: {name}",
      "log.importedAnim": "Imported animation {name}",
      "log.importedModel": "Imported model {name}, {count} clips",
      "log.importedTexture": "Imported texture {name}",
      "log.importedEnv": "Imported environment {name}",
      "log.importedAudio": "Imported audio {name}",
      "log.cacheFail": "Cached asset {name} could not be restored: {message}",
      "log.referenced": "Still used by: ",
      "log.folderKept": "Kept the folder. These assets are still in use: ",
      "log.modelLoading": "The model is still loading",
      "log.envSet": "Using {name} as the environment",
      "log.dragAnim": "Drop the animation on a model",
      "log.dragAsset": "Drop the asset on an object",
      "log.animOnModel": "Animations belong on models",
      "log.needMesh": "Select a mesh or model first",
      "log.savedMaterial": "Saved material {name}",
      "log.needSelection": "Select objects to save first",
      "log.savedPrefab": "Saved prefab {name}",
      "log.created": "Created {name}",
      "log.skippedLocked": "Skipped locked objects: {names}",
      "log.deleted": "Deleted {count} objects",
      "log.duplicated": "Duplicated {count} objects",
      "log.nothingCopy": "Nothing to copy",
      "log.copied": "Copied {count} objects",
      "log.clipboardEmpty": "The clipboard is empty",
      "log.pasted": "Pasted {count} objects",
      "log.groupNeedTwo": "Select at least two objects to group",
      "log.grouped": "Grouped",
      "log.needGround": "Select objects to snap to the ground",
      "log.alreadyGround": "The objects are already on the ground",
      "log.grounded": "Snapped {count} objects to the ground",
      "log.locked": "{name} is locked",
      "log.cycle": "An object cannot become its own child",
      "log.noUndoPlay": "Stop playing before undoing",
      "log.noRedoPlay": "Stop playing before redoing",
      "log.resumePlay": "Resumed play",
      "log.startPlay": "Playing. Stop to restore the scene.",
      "log.stopPlay": "Stopped. The scene is restored.",
      "log.stopBeforeNew": "Stop playing before creating a scene",
      "log.createdScene": "Created and opened {name}",
      "log.stopBeforeOpen": "Stop playing before opening a scene",
      "log.openedScene": "Opened {name}",
      "log.keepScene": "Keep at least one scene",
      "log.stopBeforeDelete": "Stop playing before deleting a scene",
      "log.deletedScene": "Deleted the scene",
      "log.placed": "Placed {name}",
      "log.assignedMaterial": "Assigned material {name}",
      "log.noStructure": "Stop playing before changing the scene structure",
      "picker.search": "Search",
      "clip.pick": "Choose clip",
      "picker.empty": "No matching assets",
      "picker.texture": "Select Texture",
      "picker.material": "Select Material",
      "picker.environment": "Select Environment",
      "picker.none": "None",
      "picker.unset": "None",
      "picker.select": "Select",
      "picker.clear": "Clear",
      "picker.missing": "Missing",
      "picker.textureHint": "Click to reveal in assets, double-click to preview",
      "picker.textureLocate": "Reveal in assets",
      "picker.textureReplace": "Select or replace texture",
      "picker.textureDrop": "Drop a texture here",
      "picker.thumbs": "Large thumbnails",
      "picker.list": "List",
      "project.create": "Create",
      "project.createScene": "Scene",
      "project.createMaterial": "Material",
      "project.createPrefab": "Prefab",
      "project.newMaterialName": "New Material",
      "project.copySuffix": "Copy",
      "project.duplicate": "Duplicate",
      "project.findRefs": "Find References",
      "project.noRefs": "Nothing references this asset",
      "project.refs": "Used by: {names}"
    };
  }
});

// src/editor/i18n/index.ts
import { useMemo } from "react";
function translate(key, vars) {
  const lang = resolveLanguage(usePrefsStore.getState().language);
  const text = (lang === "en" ? en : zh)[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}
var init_i18n = __esm({
  "src/editor/i18n/index.ts"() {
    "use strict";
    init_store();
    init_messages();
  }
});

// src/gameplay/corePack.ts
var tags, juice;
var init_corePack = __esm({
  "src/gameplay/corePack.ts"() {
    "use strict";
    init_registry();
    init_types();
    tags = [
      { id: "Team.Player", name: "\u73A9\u5BB6\u9635\u8425", category: "Team", description: "\u4E3B\u89D2\u4E0E\u53CB\u519B", fields: { color: "#3b82f6", defaultDurationSec: 0, blockPrefix: "" } },
      { id: "Team.Enemy", name: "\u654C\u4EBA\u9635\u8425", category: "Team", description: "\u654C\u65B9\u5355\u4F4D", fields: { color: "#ef4444", defaultDurationSec: 0, blockPrefix: "" } },
      { id: "State.Dead", name: "\u6B7B\u4EA1", category: "State", description: "\u751F\u547D\u5F52\u96F6\u540E\u7684\u7EC8\u6001", fields: { color: "#6b7280", defaultDurationSec: 0, blockPrefix: "Action" } },
      { id: "State.CrowdControl.Stunned", name: "\u7729\u6655\u786C\u76F4", category: "State/Control", description: "\u6E05\u6389\u5E76\u7981\u6B62 Action \u4E0B\u7684\u52A8\u4F5C", fields: { color: "#f59e0b", defaultDurationSec: 1.5, blockPrefix: "Action" } },
      { id: "State.Invincible", name: "\u65E0\u654C", category: "State", description: "\u95EA\u907F\u6216\u53D7\u51FB\u540E\u7684\u514D\u75AB", fields: { color: "#fbbf24", defaultDurationSec: 0.4, blockPrefix: "" } },
      { id: "Action.Attacking", name: "\u653B\u51FB\u4E2D", category: "Action", description: "\u6B63\u5728\u6325\u780D\u6216\u51FA\u624B", fields: { color: "#ec4899", defaultDurationSec: 0.8, blockPrefix: "" } },
      { id: "Interactive.Chest", name: "\u53EF\u5F00\u542F", category: "Interactive", description: "\u7BB1\u5B50\u6216\u673A\u5173", fields: { color: "#10b981", defaultDurationSec: 0, blockPrefix: "" } }
    ];
    juice = [
      { id: "juice_light_hit", name: "\u8F7B\u51FB", category: "Combat", description: "\u77ED\u987F\u5E27\u3001\u8F7B\u9707\u548C\u77ED\u51FB\u9000", fields: { hitStopSec: 0.04, cameraShake: 0.2, rimFlashColor: "#ffffff", knockbackMeters: 0.45 } },
      { id: "juice_heavy_hit", name: "\u91CD\u51FB", category: "Combat", description: "\u66F4\u957F\u7684\u987F\u5E27\u3001\u9707\u5C4F\u548C\u51FB\u9000", fields: { hitStopSec: 0.09, cameraShake: 0.65, rimFlashColor: "#fde047", knockbackMeters: 0.9 } },
      { id: "juice_pickup", name: "\u62FE\u53D6", category: "Interact", description: "\u6253\u5F00\u6216\u62FE\u53D6\u65F6\u7684\u8F7B\u53CD\u9988", fields: { hitStopSec: 0.02, cameraShake: 0.1, rimFlashColor: "#34d399", knockbackMeters: 0 } }
    ];
    registerGameplayPack({
      id: CORE_GAMEPLAY_PACK_ID,
      name: "\u6838\u5FC3\u5305",
      description: "\u89D2\u8272\u3001\u5F8B\u4EE4\u3001\u73A9\u6CD5\u6807\u7B7E\u548C\u6253\u51FB\u611F\u3002\u59CB\u7EC8\u5F00\u542F\u3002\u9886\u57DF\u5305\u4EE5\u540E\u53EA\u5F80\u8FD9\u91CC\u8FFD\u52A0\u8868\u548C\u52A8\u4F5C\u3002",
      builtIn: true,
      core: true,
      tables: [
        {
          tableId: "tags",
          title: "\u73A9\u6CD5\u6807\u7B7E",
          packId: CORE_GAMEPLAY_PACK_ID,
          description: "\u70B9\u5206\u540D\u5B57\uFF0C\u5982 State.CrowdControl.Stunned\u3002\u67E5\u8BE2\u524D\u7F00\u4F1A\u547D\u4E2D\u5B83\u4E0B\u9762\u7684\u6807\u7B7E\u3002\u963B\u65AD\u524D\u7F00\u4F1A\u6E05\u6389\u5E76\u7981\u6B62\u8FD9\u4E00\u652F\u3002",
          columns: [
            { key: "color", label: "\u989C\u8272", type: "color", defaultValue: "#3b82f6" },
            { key: "defaultDurationSec", label: "\u9ED8\u8BA4\u6301\u7EED\u79D2\u6570\uFF0C0 \u4E3A\u5E38\u9A7B", type: "number", defaultValue: 0 },
            { key: "blockPrefix", label: "\u963B\u65AD\u524D\u7F00", type: "string", defaultValue: "" }
          ],
          defaultRows: tags
        },
        {
          tableId: "juice",
          title: "\u6253\u51FB\u611F",
          packId: CORE_GAMEPLAY_PACK_ID,
          description: "\u5F8B\u4EE4\u53EA\u5F15\u7528\u9884\u8BBE\u540D\u3002\u987F\u5E27\u3001\u955C\u5934\u9707\u52A8\u3001\u53D7\u51FB\u95EA\u5149\u548C\u51FB\u9000\u5199\u5728\u8FD9\u4E00\u884C\u3002",
          columns: [
            { key: "hitStopSec", label: "\u987F\u5E27\u79D2\u6570", type: "number", defaultValue: 0.05 },
            { key: "cameraShake", label: "\u955C\u5934\u9707\u52A8", type: "number", defaultValue: 0.3 },
            { key: "rimFlashColor", label: "\u53D7\u51FB\u95EA\u5149", type: "color", defaultValue: "#ffffff" },
            { key: "knockbackMeters", label: "\u51FB\u9000\u7C73\u6570", type: "number", defaultValue: 0.45 },
            { key: "sound", label: "\u97F3\u6548", type: "string", defaultValue: "" },
            { key: "soundVolume", label: "\u97F3\u91CF", type: "number", defaultValue: 1 }
          ],
          defaultRows: juice
        }
      ]
    });
  }
});

// src/runtime/camera.ts
function stepCameras(dt, host) {
  const world3 = getRuntimeWorld();
  const playState = world3.getPlayState();
  if (playState === "stopped") {
    arms.clear();
    return;
  }
  if (playState !== "playing") return;
  const nodes = world3.getNodes();
  const wheel = host.wheel?.() ?? 0;
  const active = Object.values(nodes).find((node) => node.gameplay?.character?.enabled && node.gameplay.cameraFollow?.enabled !== false) ?? Object.values(nodes).find((node) => node.gameplay?.cameraFollow?.enabled);
  if (!active) return;
  const character = active.gameplay?.character?.enabled ? { ...defaultCharacter(), ...active.gameplay.character } : null;
  const spec = character ? resolveCharacterCamera(character, active.gameplay?.cameraFollow) : { ...defaultCameraFollow(), ...active.gameplay?.cameraFollow };
  if (!spec.enabled) return;
  const target = character ? active : resolveTarget(spec, active.id, nodes);
  const targetObject = target ? host.resolveObject(target.id) : null;
  if (!targetObject) return;
  const lockNode = character?.mode === "lockOn" ? resolveLock(character, active.id, nodes) : void 0;
  const lockObject = lockNode ? host.resolveObject(lockNode.id) : null;
  const focus = [
    targetObject.position.x + spec.pivot[0],
    targetObject.position.y + spec.pivot[1],
    targetObject.position.z + spec.pivot[2]
  ];
  const lookAt = lockObject ? [
    (focus[0] + lockObject.position.x) * 0.5,
    (focus[1] + lockObject.position.y + spec.pivot[1] * 0.6) * 0.5,
    (focus[2] + lockObject.position.z) * 0.5
  ] : focus;
  const arm = arms.get(active.id) ?? freshArm(spec, host);
  if (arm.local !== spec.localOffset) {
    arm.local = spec.localOffset;
    arm.yaw = spec.localOffset ? 0 : host.yaw?.() ?? arm.yaw;
    arm.position = null;
  }
  const q = targetObject.quaternion;
  const targetYaw = lockObject ? Math.atan2(lockObject.position.x - targetObject.position.x, lockObject.position.z - targetObject.position.z) : Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
  steer(spec, arm, host);
  arm.pitch = clampPitch(arm.pitch, spec);
  if (character?.mode === "firstPerson") {
    poseFirstPerson(active.id, spec, arm, focus, host);
    return;
  }
  const scale = dolly(spec, arm, wheel);
  const yaw = lockObject ? targetYaw + Math.PI : spec.orbit === "none" ? targetYaw : spec.localOffset ? targetYaw + arm.yaw : arm.yaw;
  const offset = orbitOffset(spec, yaw, arm.pitch, scale);
  let desired = [focus[0] + offset[0], focus[1] + offset[1], focus[2] + offset[2]];
  if (spec.collision) desired = spring(host, focus, desired, target.id, spec.collisionRadius);
  const alpha = spec.damping > 0 && dt > 0 ? 1 - Math.exp(-spec.damping * dt) : 1;
  const from = arm.position ?? desired;
  const next = [
    from[0] + (desired[0] - from[0]) * alpha,
    from[1] + (desired[1] - from[1]) * alpha,
    from[2] + (desired[2] - from[2]) * alpha
  ];
  const shake = juiceShake();
  const shaken = [next[0] + shake.x, next[1] + shake.y, next[2]];
  arm.position = next;
  arms.set(active.id, arm);
  if (!arm.noted && armChanged(arm)) {
    arm.noted = true;
    getRuntimeWorld().markPlayDirty();
  }
  host.poseCamera?.(shaken, lookPoint(shaken, lookAt, spec.lookAtTarget), spec.fov);
}
function poseFirstPerson(id, spec, arm, focus, host) {
  const yaw = arm.yaw;
  const pitch = arm.pitch;
  const flat = Math.cos(pitch);
  const forward = [-Math.sin(yaw) * flat, Math.sin(pitch), -Math.cos(yaw) * flat];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const eye = [
    focus[0] + right[0] * spec.offset[0] + forward[0] * spec.offset[2],
    focus[1] + spec.offset[1] + forward[1] * spec.offset[2],
    focus[2] + right[2] * spec.offset[0] + forward[2] * spec.offset[2]
  ];
  const look = [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]];
  arm.position = eye;
  arms.set(id, arm);
  if (!arm.noted && armChanged(arm)) {
    arm.noted = true;
    getRuntimeWorld().markPlayDirty();
  }
  const shake = juiceShake();
  host.poseCamera?.(
    [eye[0] + shake.x, eye[1] + shake.y, eye[2]],
    [look[0] + shake.x, look[1] + shake.y, look[2]],
    spec.fov
  );
}
function freshArm(spec, host) {
  const yaw = typeof spec.orbitYaw === "number" ? spec.orbitYaw * Math.PI / 180 : spec.localOffset ? 0 : host.yaw?.() ?? 0;
  const pitch = clampPitch(
    typeof spec.orbitPitch === "number" ? spec.orbitPitch * Math.PI / 180 : host.pitch?.() ?? 0,
    spec
  );
  return { yaw, pitch, zoom: 1, startYaw: yaw, startPitch: pitch, position: null, local: spec.localOffset, noted: false };
}
function armChanged(arm) {
  return Math.abs(arm.zoom - 1) > 1e-3 || Math.abs(angleDelta(arm.yaw, arm.startYaw)) > 1e-3 || Math.abs(angleDelta(arm.pitch, arm.startPitch)) > 1e-3;
}
function angleDelta(current, start2) {
  let delta = current - start2;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
function cameraArmOf(id) {
  const arm = arms.get(id);
  if (!arm) return null;
  return { zoom: arm.zoom, yaw: arm.yaw, pitch: arm.pitch, changed: armChanged(arm) };
}
function settleCameraArm(id) {
  const arm = arms.get(id);
  if (!arm) return;
  arm.zoom = 1;
  arm.startYaw = arm.yaw;
  arm.startPitch = arm.pitch;
  arm.noted = false;
}
function resolveLock(character, selfId, nodes) {
  if (character.lockTargetId && character.lockTargetId !== selfId && nodes[character.lockTargetId]) return nodes[character.lockTargetId];
  if (!character.lockTargetId && character.lockTargetName) {
    return Object.values(nodes).find((item) => item.id !== selfId && item.name === character.lockTargetName);
  }
  return void 0;
}
function resolveTarget(spec, selfId, nodes) {
  if (spec.targetId && nodes[spec.targetId]) return nodes[spec.targetId];
  if (!spec.targetId && spec.targetName) return Object.values(nodes).find((node) => node.name === spec.targetName) ?? nodes[selfId];
  return nodes[selfId];
}
function steer(spec, arm, host) {
  const delta = host.pointerDelta?.() ?? { x: 0, y: 0 };
  if (spec.orbit === "none") return;
  const drag = spec.orbit === "mouse" || host.rightHeld?.() === true;
  if (!drag) return;
  const sens = Math.max(0.01, spec.sensitivity) * 0.02;
  arm.yaw -= delta.x * sens;
  arm.pitch = clampPitch(arm.pitch - delta.y * sens, spec);
}
function dolly(spec, arm, wheel) {
  if (!spec.zoom) {
    arm.zoom = 1;
    return 1;
  }
  const base = Math.max(0.05, Math.hypot(spec.offset[0], spec.offset[1], spec.offset[2]));
  const minScale = Math.max(0.05, spec.minDistance) / base;
  const maxScale = Math.max(minScale, spec.maxDistance) / base;
  if (wheel) {
    const steps = Math.sign(wheel) * Math.min(Math.abs(wheel), 400) / 100;
    arm.zoom *= Math.exp(steps * Math.max(0.01, spec.zoomSpeed));
  }
  arm.zoom = Math.min(maxScale, Math.max(minScale, arm.zoom));
  return arm.zoom;
}
function orbitOffset(spec, yaw, pitch, scale = 1) {
  const scaled = [spec.offset[0] * scale, spec.offset[1] * scale, spec.offset[2] * scale];
  if (spec.orbit === "none" && !spec.localOffset) return scaled;
  const pitchNow = spec.orbit === "none" ? 0 : pitch;
  const [x, y, z] = scaled;
  const behind = -z;
  const cp = Math.cos(pitchNow);
  const sp = Math.sin(pitchNow);
  const y1 = y * cp - behind * sp;
  const z1 = y * sp + behind * cp;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return [x * cy + z1 * sy, y1, -x * sy + z1 * cy];
}
function lookPoint(eye, focus, lookAtTarget) {
  if (lookAtTarget) return focus;
  const dx = eye[0] - focus[0];
  const dy = eye[1] - focus[1];
  const dz = eye[2] - focus[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return [eye[0], eye[1], eye[2] - 1];
  return [eye[0] + dx / len, eye[1] + dy / len, eye[2] + dz / len];
}
function clampPitch(pitch, spec) {
  let min3 = spec.minPitch * Math.PI / 180;
  let max4 = spec.maxPitch * Math.PI / 180;
  if (min3 > max4) [min3, max4] = [max4, min3];
  return Math.min(max4, Math.max(min3, pitch));
}
function spring(host, focus, desired, ignoreId, radius) {
  const dx = desired[0] - focus[0];
  const dy = desired[1] - focus[1];
  const dz = desired[2] - focus[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.25 || !host.probe) return desired;
  const hit = host.probe(focus, [dx / dist, dy / dist, dz / dist], dist, ignoreId);
  if (hit === null || hit >= dist) return desired;
  const safe = Math.max(0.2, hit - radius);
  return [focus[0] + dx / dist * safe, focus[1] + dy / dist * safe, focus[2] + dz / dist * safe];
}
var arms;
var init_camera = __esm({
  "src/runtime/camera.ts"() {
    "use strict";
    init_juiceClock();
    init_sceneRuntime();
    init_world();
    arms = /* @__PURE__ */ new Map();
    registerRuntimeSystem("core.camera", 75, stepCameras);
  }
});

// src/editor/project/taxonomy.ts
function defaultTags() {
  return [{ id: TAG_ID_MAIN_CAMERA, name: TAG_NAME_MAIN_CAMERA }];
}
function defaultLayers() {
  return DEFAULT_LAYERS.map((layer) => ({ ...layer }));
}
function ensureTags(tags2) {
  const list = (tags2 ?? []).map((tag) => ({ id: tag.id, name: tag.name }));
  if (list.some((tag) => tag.id === TAG_ID_MAIN_CAMERA || tag.name === TAG_NAME_MAIN_CAMERA)) return list;
  return [{ id: TAG_ID_MAIN_CAMERA, name: TAG_NAME_MAIN_CAMERA }, ...list];
}
function ensureLayers(layers) {
  const list = layers && layers.length > 0 ? layers.map((layer) => ({ ...layer })) : defaultLayers();
  if (!list.some((layer) => layer.id === LAYER_ID_DEFAULT)) {
    list.unshift({ id: LAYER_ID_DEFAULT, name: "Default", bitIndex: 0, builtIn: true });
  }
  return list;
}
var TAG_ID_MAIN_CAMERA, TAG_NAME_MAIN_CAMERA, LAYER_ID_DEFAULT, ALL_LAYERS_VISIBLE_MASK, DEFAULT_LAYERS;
var init_taxonomy = __esm({
  "src/editor/project/taxonomy.ts"() {
    "use strict";
    TAG_ID_MAIN_CAMERA = "tag_main_camera";
    TAG_NAME_MAIN_CAMERA = "MainCamera";
    LAYER_ID_DEFAULT = "layer_default";
    ALL_LAYERS_VISIBLE_MASK = 4294967295 >>> 0;
    DEFAULT_LAYERS = [
      { id: LAYER_ID_DEFAULT, name: "Default", bitIndex: 0, builtIn: true }
    ];
  }
});

// src/editor/scene/transform.ts
import { Euler as Euler3, Matrix4 as Matrix42, Quaternion as Quaternion6, Vector3 as Vector311 } from "three";
function eulerQuaternion2(rotation) {
  return new Quaternion6().setFromEuler(new Euler3(rotation[0] * DEG2, rotation[1] * DEG2, rotation[2] * DEG2, "XYZ"));
}
function quaternionEuler(quaternion) {
  const euler = new Euler3().setFromQuaternion(quaternion, "XYZ");
  return [euler.x * RAD, euler.y * RAD, euler.z * RAD];
}
function worldPose2(nodes, id) {
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let current = nodes[id];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? nodes[current.parentId] : void 0;
  }
  chain.reverse();
  const position = new Vector311();
  const quaternion = new Quaternion6();
  const scale = new Vector311(1, 1, 1);
  const localPosition = new Vector311();
  const localScale = new Vector311();
  for (const node of chain) {
    localPosition.set(node.position[0], node.position[1], node.position[2]).multiply(scale).applyQuaternion(quaternion);
    position.add(localPosition);
    quaternion.multiply(eulerQuaternion2(node.rotation));
    localScale.set(node.scale[0], node.scale[1], node.scale[2]);
    scale.multiply(localScale);
  }
  return { position, quaternion, scale };
}
function safeDiv(value, scale) {
  return Math.abs(scale) > 1e-8 ? value / scale : value;
}
function worldPointToLocal(parent, point2) {
  const delta = point2.clone().sub(parent.position).applyQuaternion(parent.quaternion.clone().invert());
  return new Vector311(
    safeDiv(delta.x, parent.scale.x),
    safeDiv(delta.y, parent.scale.y),
    safeDiv(delta.z, parent.scale.z)
  );
}
function localPoseFromWorld(parent, world3) {
  if (!parent) {
    return {
      position: world3.position.clone(),
      quaternion: world3.quaternion.clone(),
      scale: world3.scale.clone()
    };
  }
  return {
    position: worldPointToLocal(parent, world3.position),
    quaternion: parent.quaternion.clone().invert().multiply(world3.quaternion),
    scale: new Vector311(
      safeDiv(world3.scale.x, parent.scale.x),
      safeDiv(world3.scale.y, parent.scale.y),
      safeDiv(world3.scale.z, parent.scale.z)
    )
  };
}
function poseComponents(pose) {
  return {
    position: [pose.position.x, pose.position.y, pose.position.z],
    rotation: quaternionEuler(pose.quaternion),
    scale: [pose.scale.x, pose.scale.y, pose.scale.z]
  };
}
function writePose2(node, pose) {
  const parts = poseComponents(pose);
  node.position = parts.position;
  node.rotation = parts.rotation;
  node.scale = parts.scale;
}
function isUnder(nodes, nodeId, ancestorId) {
  const seen = /* @__PURE__ */ new Set();
  let current = nodes[nodeId]?.parentId;
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = nodes[current]?.parentId ?? null;
  }
  return false;
}
var DEG2, RAD;
var init_transform2 = __esm({
  "src/editor/scene/transform.ts"() {
    "use strict";
    DEG2 = Math.PI / 180;
    RAD = 180 / Math.PI;
  }
});

// src/editor/scene/viewportBridge.ts
function measureGroundSnap(ids) {
  return snapper?.(ids) ?? [];
}
function readEditorViewPose() {
  return readEditorView?.() ?? null;
}
function readViewportPose() {
  return readViewport?.() ?? null;
}
function placeViewportAt(position, quaternion) {
  placeViewport?.(position, quaternion);
}
var snapper, readViewport, placeViewport, readEditorView;
var init_viewportBridge = __esm({
  "src/editor/scene/viewportBridge.ts"() {
    "use strict";
    snapper = null;
    readViewport = null;
    placeViewport = null;
    readEditorView = null;
  }
});

// src/editor/scene/store.ts
var store_exports = {};
__export(store_exports, {
  askNewScene: () => askNewScene,
  primaryId: () => primaryId,
  useEditorStore: () => useEditorStore
});
import { Quaternion as Quaternion7, Vector3 as Vector312 } from "three";
import { create as create6 } from "zustand";
function bakeFollow(node) {
  const arm = cameraArmOf(node.id);
  if (!arm?.changed) return null;
  const character = node.gameplay?.character?.enabled ? { ...defaultCharacter(), ...node.gameplay.character } : null;
  if (!character && !node.gameplay?.cameraFollow?.enabled) return null;
  const spec = character ? resolveCharacterCamera(character, node.gameplay?.cameraFollow) : { ...defaultCameraFollow(), ...node.gameplay?.cameraFollow };
  if (!spec.enabled) return null;
  const zoom = arm.zoom;
  return {
    ...spec,
    offset: [spec.offset[0] * zoom, spec.offset[1] * zoom, spec.offset[2] * zoom],
    orbitYaw: arm.yaw * 180 / Math.PI,
    orbitPitch: arm.pitch * 180 / Math.PI
  };
}
function cloneNodes(nodes) {
  return structuredClone(nodes);
}
function sameNodes(a, b) {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i += 1) {
    const key = keysA[i];
    const nodeA = a[key];
    const nodeB = b[key];
    if (!nodeB) return false;
    if (nodeA === nodeB) continue;
    if (JSON.stringify(nodeA) !== JSON.stringify(nodeB)) return false;
  }
  return true;
}
function sameJson(a, b) {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
function sameSelection(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
function pushHistory(set, entry) {
  set((state) => ({
    past: [...state.past, entry].slice(-80),
    future: []
  }));
}
function savedEditorView(document2) {
  const scene2 = document2.library.find((item) => item.kind === "scene" && item.id === document2.activeSceneId);
  return normalizeEditorView(scene2?.editorView);
}
function selectionRoots(nodes, selection) {
  const selected = new Set(selection);
  return selection.filter((id) => {
    let parent = nodes[id]?.parentId;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = nodes[parent]?.parentId ?? null;
    }
    return Boolean(nodes[id]);
  });
}
function pasteNodes(draft, parentId) {
  if (!clipboard) return [];
  const map = /* @__PURE__ */ new Map();
  for (const node of clipboard) map.set(node.id, crypto.randomUUID());
  const roots = [];
  for (const source of clipboard) {
    const copy = structuredClone(source);
    const nextId2 = map.get(source.id);
    if (!nextId2) continue;
    copy.id = nextId2;
    copy.locked = false;
    const mappedParent = source.parentId ? map.get(source.parentId) ?? null : null;
    copy.parentId = mappedParent ?? parentId;
    if (!source.parentId) {
      copy.name = uniqueName(draft.nodes, source.name);
      copy.order = nextOrder(draft.nodes, copy.parentId);
      if (!parentId) copy.position = [copy.position[0] + 1, copy.position[1], copy.position[2]];
      roots.push(nextId2);
    }
    draft.nodes[nextId2] = copy;
  }
  return roots;
}
function mutate(set, get, label, fn) {
  if (get().playState !== "stopped") {
    get().log("warn", translate("log.noStructure"));
    return false;
  }
  if (get().gesture) get().endGesture();
  const before = cloneNodes(get().nodes);
  const beforeSelection = get().selection.slice();
  const draft = { nodes: cloneNodes(before), selection: beforeSelection.slice() };
  fn(draft);
  draft.selection = draft.selection.filter((id) => draft.nodes[id]);
  set({ nodes: draft.nodes, selection: draft.selection });
  if (sameNodes(before, draft.nodes) && sameSelection(beforeSelection, draft.selection)) return true;
  const picture = structuredClone(get().picture);
  pushHistory(set, {
    label,
    before,
    after: cloneNodes(draft.nodes),
    beforeSelection,
    afterSelection: draft.selection.slice(),
    beforePicture: picture,
    afterPicture: picture
  });
  return true;
}
function restoreMaterials(slots) {
  if (!slots) return;
  for (const [id, slot] of Object.entries(slots)) {
    useAssetStore.getState().replaceMaterial(id, structuredClone(slot));
  }
}
function lookupPrefab(assetId) {
  const asset = useAssetStore.getState().assets[assetId];
  return asset?.kind === "prefab" ? readPrefab(asset) : null;
}
function deleteSubtree2(nodes, id) {
  for (const child of childrenOf(nodes, id)) deleteSubtree2(nodes, child.id);
  delete nodes[id];
}
function uniqueAssetName(base) {
  const names = new Set(Object.values(useAssetStore.getState().assets).map((asset) => asset.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
function askNewScene() {
  useEditorStore.getState().createScene();
}
function uniqueSceneName(names) {
  if (!names.includes("\u65B0\u573A\u666F")) return "\u65B0\u573A\u666F";
  let index = 2;
  while (names.includes(`\u65B0\u573A\u666F ${index}`)) index += 1;
  return `\u65B0\u573A\u666F ${index}`;
}
function primaryId(state) {
  return state.selection[state.selection.length - 1] ?? null;
}
function selectedCameraId(state, editable) {
  const id = primaryId(state);
  const node = id ? state.nodes[id] : void 0;
  if (!node || node.kind !== "camera") return null;
  if (editable && node.locked) return null;
  return id;
}
var seed, useEditorStore, clipboard;
var init_store2 = __esm({
  "src/editor/scene/store.ts"() {
    "use strict";
    init_spawn();
    init_seed();
    init_library();
    init_workspace();
    init_prefab();
    init_i18n();
    init_kinds();
    init_registry2();
    init_corePack();
    init_registry();
    init_defaults5();
    init_sceneRuntime();
    init_camera();
    init_values();
    init_taxonomy();
    init_transform2();
    init_viewportBridge();
    init_viewportBridge();
    init_types2();
    init_archive();
    init_session4();
    seed = createSeed();
    useEditorStore = create6((set, get) => ({
      nodes: seed.nodes,
      selection: [seed.selectedId],
      gizmoMode: "translate",
      gizmoSpace: "world",
      gizmoOrigin: "pivot",
      snap: false,
      gridVisible: true,
      playState: "stopped",
      playSnapshot: null,
      playSelection: [],
      playDirty: false,
      past: [],
      future: [],
      gesture: null,
      logs: [
        { id: "boot", level: "info", message: "\u7F16\u8F91\u5668\u5DF2\u5C31\u7EEA", time: Date.now() },
        {
          id: "boot-help",
          level: "info",
          message: "\u89C6\u53E3\uFF1A\u53F3\u952E\u73AF\u987E\uFF0C\u6309\u4F4F\u53F3\u952E\u7528 WASD \u6216\u65B9\u5411\u952E\u98DE\u884C\uFF0C\u4E2D\u952E\u5E73\u79FB\uFF0C\u6EDA\u8F6E\u7F29\u653E\uFF0CAlt+\u5DE6\u952E\u7ED5\u76EE\u6807\u65CB\u8F6C\u3002",
          time: Date.now()
        }
      ],
      notice: null,
      gameplayHubOpen: false,
      setGameplayHubOpen: (open) => set({ gameplayHubOpen: open }),
      libraryOpen: false,
      setLibraryOpen: (open) => set({ libraryOpen: open }),
      projectionLabel: "\u900F\u89C6",
      sidePanel: "inspector",
      cameraNonce: 0,
      cameraAction: "focus",
      cameraView: "persp",
      picture: structuredClone(DEFAULT_PICTURE),
      editorView: null,
      editorViewNonce: 0,
      capabilities: defaultCapabilities(),
      tags: defaultTags(),
      gameplayPacks: [...resolveEnabledPackIds()],
      gameDatabase: createDefaultGameDatabase(),
      layers: defaultLayers(),
      editorCullingMask: ALL_LAYERS_VISIBLE_MASK,
      physicsCollisionMatrixEnabled: false,
      physicsCollisionRowMasks: {},
      activeSceneId: "",
      inspectedAssetId: null,
      assetPing: null,
      pendingRenameId: null,
      renderBackend: "\u6B63\u5728\u521D\u59CB\u5316",
      helpersVisible: true,
      navMeshVisible: true,
      snapStep: 1,
      canPaste: false,
      viewportStats: { objects: 0, triangles: 0, vertices: 0, materials: 0, textures: 0, calls: 0, fps: 0, frameMs: 0, costs: [], camera: [0, 0, 0], orbit: 0 },
      playPicture: null,
      prefabSession: null,
      setSelection: (ids) => {
        const selection = ids.filter((id) => get().nodes[id]);
        set({
          selection,
          inspectedAssetId: selection.length > 0 ? null : get().inspectedAssetId
        });
      },
      inspectAsset: (id) => set({ inspectedAssetId: id, selection: id ? [] : get().selection }),
      pingAsset: (id) => {
        const library = useAssetStore.getState();
        if (id.startsWith("code:")) {
          const parts = id.split(":");
          const codeKind = parts[1] === "shader" ? "shader" : "script";
          const codeId = parts.slice(2).join(":");
          const codeAssets = useCodeAssetStore.getState().assets;
          const record = codeAssets[codeId];
          if (!record) return;
          const storedDir = library.assetDirs[id];
          const fallbackDir = record.relativePath.startsWith("Assets/") && record.relativePath.includes("/") ? record.relativePath.slice(0, record.relativePath.lastIndexOf("/")) : codeKind === "shader" ? "Assets/Shaders" : "Assets/Scripts";
          library.setBrowseDir(storedDir || fallbackDir);
          useCodeAssetStore.getState().selectAsset(codeId);
          set({ inspectedAssetId: null, selection: [], assetPing: { id, nonce: Date.now() } });
          return;
        }
        if (!library.assets[id]) return;
        library.setBrowseDir(assetDirectory(id, library.assetDirs));
        set({ assetPing: { id, nonce: Date.now() } });
      },
      setGizmoMode: (mode) => {
        if (get().gizmoMode !== mode) set({ gizmoMode: mode });
      },
      setGizmoSpace: (space) => {
        if (get().gizmoSpace !== space) set({ gizmoSpace: space });
      },
      setGizmoOrigin: (origin) => {
        if (get().gizmoOrigin !== origin) set({ gizmoOrigin: origin });
      },
      toggleSnap: () => set((state) => ({ snap: !state.snap })),
      toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
      setSidePanel: (panel) => {
        if (get().sidePanel !== panel) set({ sidePanel: panel });
      },
      setProjectionLabel: (label) => {
        if (get().projectionLabel !== label) set({ projectionLabel: label });
      },
      requestFocus: () => set((state) => ({ cameraNonce: state.cameraNonce + 1, cameraAction: "focus" })),
      requestFocusAll: () => set((state) => ({ cameraNonce: state.cameraNonce + 1, cameraAction: "focus-all" })),
      requestView: (view) => set((state) => ({
        cameraNonce: state.cameraNonce + 1,
        cameraAction: "view",
        cameraView: view
      })),
      alignCameraToView: () => {
        if (get().playState !== "stopped") return;
        const id = selectedCameraId(get(), true);
        const view = readViewportPose();
        if (!id || !view) return;
        const nodes = get().nodes;
        const node = nodes[id];
        const parent = node.parentId ? worldPose2(nodes, node.parentId) : null;
        const current = worldPose2(nodes, id);
        const local = poseComponents(localPoseFromWorld(parent, {
          position: new Vector312(view.position[0], view.position[1], view.position[2]),
          quaternion: new Quaternion7(view.quaternion[0], view.quaternion[1], view.quaternion[2], view.quaternion[3]),
          scale: current.scale
        }));
        get().beginGesture(translate("gesture.alignCamera"));
        get().updateNode(id, { position: local.position, rotation: local.rotation });
        get().endGesture();
      },
      alignViewToCamera: () => {
        if (get().playState !== "stopped") return;
        const id = selectedCameraId(get(), false);
        if (!id) return;
        const pose = worldPose2(get().nodes, id);
        placeViewportAt(
          [pose.position.x, pose.position.y, pose.position.z],
          [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w]
        );
      },
      beginGesture: (label) => {
        if (get().gesture) get().endGesture();
        set({
          gesture: {
            label,
            before: cloneNodes(get().nodes),
            beforeSelection: get().selection.slice(),
            beforePicture: structuredClone(get().picture)
          }
        });
      },
      endGesture: () => {
        const gesture = get().gesture;
        if (!gesture) return;
        const after = cloneNodes(get().nodes);
        const afterSelection = get().selection.slice();
        set({ gesture: null });
        if (get().playState !== "stopped") return;
        if (sameNodes(gesture.before, after) && sameSelection(gesture.beforeSelection, afterSelection) && sameJson(gesture.beforePicture, get().picture)) return;
        pushHistory(set, {
          label: gesture.label,
          before: gesture.before,
          after,
          beforeSelection: gesture.beforeSelection,
          afterSelection,
          beforePicture: gesture.beforePicture,
          afterPicture: structuredClone(get().picture)
        });
      },
      updateNode: (id, patch) => {
        const node = get().nodes[id];
        if (!node) return;
        const touchesTransform = patch.position !== void 0 || patch.rotation !== void 0 || patch.scale !== void 0;
        if (node.locked && touchesTransform) return;
        if (get().prefabSession && !node.parentId && touchesTransform) return;
        const next = { ...node, ...patch, id: node.id, kind: node.kind };
        if (!get().prefabSession) markOverrides(next, patch);
        const keys = Object.keys(patch);
        const onlyRuntimeClock = keys.every((key) => key === "clipTime" || key === "overlayTime");
        const markPlayDirty = get().playState !== "stopped" && !onlyRuntimeClock;
        set((state) => ({
          nodes: { ...state.nodes, [id]: next },
          ...markPlayDirty ? { playDirty: true } : {}
        }));
      },
      createNode: (kind, parentId = null) => {
        let created = "";
        const label = translate(`kind.${kind}`);
        const ok = mutate(set, get, translate("gesture.create", { name: label }), (draft) => {
          let parent = parentId && draft.nodes[parentId] ? parentId : null;
          if (get().prefabSession && !parent) parent = Object.values(draft.nodes).find((node) => !node.parentId)?.id ?? null;
          const id = crypto.randomUUID();
          const name = uniqueName(draft.nodes, label);
          const shaped = kind === "box" || kind === "sphere" || kind === "capsule" || kind === "cylinder" || kind === "cone" || kind === "plane";
          draft.nodes[id] = makeNode({
            id,
            name,
            kind,
            parentId: parent,
            order: nextOrder(draft.nodes, parent),
            position: spawnPosition(kind, parent, getSpawn()),
            rotation: kind === "plane" ? [-90, 0, 0] : [0, 0, 0],
            ...shaped ? { physics: defaultNodePhysics(kind) } : {}
          });
          tagAddedChild(draft.nodes, id);
          draft.selection = [id];
          created = name;
        });
        if (ok && created) get().log("info", translate("log.created", { name: created }));
      },
      extractSocket: (modelId, bone, name, select2 = true) => {
        if (get().playState !== "stopped") return null;
        const parent = get().nodes[modelId];
        if (!parent || parent.kind !== "model") return null;
        const existing = Object.values(get().nodes).find((node) => node.parentId === modelId && node.socketBone === bone);
        if (existing) {
          if (select2) get().setSelection([existing.id]);
          return existing.id;
        }
        let createdId = null;
        mutate(set, get, translate("inspector.extractSocket"), (draft) => {
          const id = crypto.randomUUID();
          createdId = id;
          draft.nodes[id] = makeNode({
            id,
            name: uniqueName(draft.nodes, name || bone),
            kind: "empty",
            parentId: modelId,
            order: nextOrder(draft.nodes, modelId),
            socketBone: bone
          });
          tagAddedChild(draft.nodes, id);
          if (select2) draft.selection = [id];
        });
        return createdId;
      },
      createDevice: (device, parentId = null) => {
        let created = "";
        const labelKey = {
          interact: "interact.title",
          trigger: "trigger.title",
          mover: "mover.title",
          checkpoint: "checkpoint.title",
          score: "score.title",
          sound: "soundSource.title"
        };
        const label = translate(labelKey[device]);
        const ok = mutate(set, get, translate("gesture.create", { name: label }), (draft) => {
          let parent = parentId && draft.nodes[parentId] ? parentId : null;
          if (get().prefabSession && !parent) parent = Object.values(draft.nodes).find((node) => !node.parentId)?.id ?? null;
          const id = crypto.randomUUID();
          const name = uniqueName(draft.nodes, label);
          const isMover = device === "mover";
          const kind = isMover ? "box" : "empty";
          const gameplay = {};
          if (device === "interact") gameplay.interact = defaultInteract();
          else if (device === "trigger") gameplay.trigger = defaultTrigger();
          else if (device === "mover") gameplay.mover = defaultMover();
          else if (device === "checkpoint") gameplay.checkpoint = defaultCheckpoint();
          else if (device === "score") gameplay.score = defaultScore();
          else if (device === "sound") gameplay.soundSource = defaultSoundSource();
          draft.nodes[id] = makeNode({
            id,
            name,
            kind,
            parentId: parent,
            order: nextOrder(draft.nodes, parent),
            position: spawnPosition(kind, parent, getSpawn()),
            scale: isMover ? [2.4, 0.3, 2.4] : [1, 1, 1],
            gameplay,
            ...isMover ? { physics: { ...defaultNodePhysics("box"), body: "kinematic" } } : {}
          });
          tagAddedChild(draft.nodes, id);
          draft.selection = [id];
          created = name;
        });
        if (ok && created) get().log("info", translate("log.created", { name: created }));
      },
      spawnEffect: (assetId, point2) => {
        const asset = useAssetStore.getState().assets[assetId];
        if (!asset || asset.kind !== "effect") return;
        let created = "";
        const ok = mutate(set, get, translate("gesture.create", { name: asset.name }), (draft) => {
          const id = crypto.randomUUID();
          const name = uniqueName(draft.nodes, asset.name);
          draft.nodes[id] = makeNode({
            id,
            name,
            kind: "effect",
            parentId: null,
            order: nextOrder(draft.nodes, null),
            position: point2,
            effect: {
              assetId: asset.id,
              quarksVersion: asset.quarksVersion,
              simulation: null,
              materialAssetId: null,
              playing: true
            }
          });
          tagAddedChild(draft.nodes, id);
          draft.selection = [id];
          created = name;
        });
        if (ok && created) get().log("info", translate("log.created", { name: created }));
      },
      mountScreen: (assetId, point2) => {
        const asset = useAssetStore.getState().assets[assetId];
        if (!asset || asset.kind !== "ui") return;
        let created = "";
        const ok = mutate(set, get, translate("gesture.create", { name: asset.name }), (draft) => {
          const id = crypto.randomUUID();
          const name = uniqueName(draft.nodes, asset.name);
          draft.nodes[id] = makeNode({
            id,
            name,
            kind: "screen",
            parentId: null,
            order: nextOrder(draft.nodes, null),
            position: point2,
            screen: { documentId: asset.id, layer: "hud", visibleOnPlay: true }
          });
          tagAddedChild(draft.nodes, id);
          draft.selection = [id];
          created = name;
        });
        if (ok && created) get().log("info", translate("log.created", { name: created }));
      },
      deleteSelection: () => {
        const state = get();
        const selected = new Set(state.selection);
        const roots = state.selection.filter((id) => {
          let parent = state.nodes[id]?.parentId;
          while (parent) {
            if (selected.has(parent)) return false;
            parent = state.nodes[parent]?.parentId ?? null;
          }
          return Boolean(state.nodes[id]);
        });
        const remove = /* @__PURE__ */ new Set();
        const blocked = [];
        for (const id of roots) {
          const sub = subtreeIds(state.nodes, id);
          if (sub.some((childId) => state.nodes[childId]?.locked)) blocked.push(state.nodes[id].name);
          else sub.forEach((childId) => remove.add(childId));
        }
        if (get().prefabSession) {
          const root = Object.values(state.nodes).find((node) => !node.parentId);
          if (root && remove.has(root.id)) {
            remove.delete(root.id);
            get().log("warn", translate("prefab.keepRoot"));
          }
        }
        if (blocked.length) get().log("warn", translate("log.skippedLocked", { names: blocked.join("\u3001") }));
        if (remove.size === 0) return;
        const ok = mutate(set, get, "\u5220\u9664", (draft) => {
          for (const id of remove) rememberRemoval(draft.nodes, id);
          for (const id of remove) delete draft.nodes[id];
          draft.selection = [];
        });
        if (ok) get().log("info", translate("log.deleted", { count: remove.size }));
      },
      duplicateSelection: () => {
        let count = 0;
        const ok = mutate(set, get, "\u590D\u5236", (draft) => {
          const selected = new Set(draft.selection);
          const roots = draft.selection.filter((id) => {
            let parent = draft.nodes[id]?.parentId;
            while (parent) {
              if (selected.has(parent)) return false;
              parent = draft.nodes[parent]?.parentId ?? null;
            }
            return Boolean(draft.nodes[id]);
          });
          const created = [];
          const cloneSubtree = (id, parentId, isRoot) => {
            const source = draft.nodes[id];
            const childIds = childrenOf(draft.nodes, id).map((child) => child.id);
            const nextId2 = crypto.randomUUID();
            const copy = structuredClone(source);
            copy.id = nextId2;
            copy.parentId = parentId;
            copy.name = uniqueName(draft.nodes, source.name);
            copy.order = nextOrder(draft.nodes, parentId);
            copy.locked = false;
            if (isRoot) copy.position = [copy.position[0] + 1, copy.position[1], copy.position[2]];
            draft.nodes[nextId2] = copy;
            for (const childId of childIds) cloneSubtree(childId, nextId2, false);
            return nextId2;
          };
          for (const id of roots) {
            const createdId = cloneSubtree(id, draft.nodes[id].parentId, true);
            if (draft.nodes[id]?.prefabInstanceId === id) retargetInstance(draft.nodes, id, createdId);
            created.push(createdId);
          }
          draft.selection = created;
          count = created.length;
        });
        if (ok && count) get().log("info", translate("log.duplicated", { count }));
      },
      copySelection: () => {
        const state = get();
        const roots = selectionRoots(state.nodes, state.selection);
        if (roots.length === 0) {
          state.log("warn", translate("log.nothingCopy"));
          return;
        }
        const nodes = [];
        const walk = (id, parentId) => {
          const source = state.nodes[id];
          const copy = structuredClone(source);
          copy.parentId = parentId;
          nodes.push(copy);
          for (const child of childrenOf(state.nodes, id)) walk(child.id, id);
        };
        for (const id of roots) walk(id, null);
        clipboard = nodes;
        set({ canPaste: true });
        state.log("info", translate("log.copied", { count: roots.length }));
      },
      pasteClipboard: (parentId = null) => {
        if (!clipboard || clipboard.length === 0) {
          get().log("warn", translate("log.clipboardEmpty"));
          return;
        }
        let count = 0;
        const ok = mutate(set, get, "\u7C98\u8D34", (draft) => {
          const created = pasteNodes(draft, parentId);
          draft.selection = created;
          count = created.length;
        });
        if (ok && count) get().log("info", translate("log.pasted", { count }));
      },
      groupSelection: () => {
        const roots = selectionRoots(get().nodes, get().selection);
        if (roots.length < 2) {
          get().log("warn", translate("log.groupNeedTwo"));
          return;
        }
        const ok = mutate(set, get, "\u6210\u7EC4", (draft) => {
          const live = selectionRoots(draft.nodes, draft.selection);
          if (live.length < 2) return;
          const sharedParent = draft.nodes[live[0]].parentId;
          const parentId = live.every((id) => draft.nodes[id].parentId === sharedParent) ? sharedParent : null;
          const worlds = new Map(live.map((id) => [id, worldPose2(draft.nodes, id)]));
          const center = new Vector312();
          for (const id of live) center.add(worlds.get(id).position);
          center.multiplyScalar(1 / live.length);
          const parentPose = parentId ? worldPose2(draft.nodes, parentId) : null;
          const localCenter = parentPose ? worldPointToLocal(parentPose, center) : center;
          const group = makeNode({
            id: crypto.randomUUID(),
            name: uniqueName(draft.nodes, "\u7EC4"),
            kind: "empty",
            parentId,
            order: nextOrder(draft.nodes, parentId),
            position: [localCenter.x, localCenter.y, localCenter.z]
          });
          draft.nodes[group.id] = group;
          const groupPose = worldPose2(draft.nodes, group.id);
          for (const id of live) {
            const world3 = worlds.get(id);
            if (!world3) continue;
            draft.nodes[id].parentId = group.id;
            draft.nodes[id].order = nextOrder(draft.nodes, group.id, id);
            writePose2(draft.nodes[id], localPoseFromWorld(groupPose, world3));
          }
          draft.selection = [group.id];
        });
        if (ok) get().log("info", translate("log.grouped"));
      },
      snapSelectionToGround: () => {
        const state = get();
        const ids = selectionRoots(state.nodes, state.selection).filter((id) => !state.nodes[id]?.locked);
        if (ids.length === 0) {
          state.log("warn", translate("log.needGround"));
          return;
        }
        const moves = measureGroundSnap(ids);
        if (moves.length === 0) {
          state.log("info", translate("log.alreadyGround"));
          return;
        }
        const ok = mutate(set, get, "\u8D34\u5730", (draft) => {
          for (const move of moves) {
            const node = draft.nodes[move.id];
            if (node) node.position = move.position;
          }
        });
        if (ok) get().log("info", translate("log.grounded", { count: moves.length }));
      },
      reparent: (id, parentId) => {
        get().placeNodes([id], parentId, "end");
      },
      attachToBone: (id, modelId, bonePath) => {
        const nodes = get().nodes;
        const node = nodes[id];
        const model = nodes[modelId];
        if (!node || !model || model.kind !== "model" || node.locked) return;
        if (id === modelId || isUnder(nodes, modelId, id)) {
          get().log("warn", translate("log.cycle"));
          return;
        }
        mutate(set, get, translate("inspector.extractSocket"), (draft) => {
          const current = draft.nodes[id];
          if (!current) return;
          current.parentId = modelId;
          current.socketBone = bonePath;
          current.position = [0, 0, 0];
          current.rotation = [0, 0, 0];
          current.order = nextOrder(draft.nodes, modelId, id);
          detachIfReparented(draft.nodes, id);
          draft.selection = [id];
        });
      },
      placeNodes: (ids, parentId, zone, anchorId = null) => {
        const nodes = get().nodes;
        const moving = selectionRoots(nodes, ids).filter((id) => nodes[id] && !nodes[id].locked);
        if (moving.length === 0) return;
        if (parentId && moving.some((id) => id === parentId || isUnder(nodes, parentId, id))) {
          get().log("warn", translate("log.cycle"));
          return;
        }
        const anchor = anchorId ? nodes[anchorId] : null;
        const nextParent = zone === "into" || zone === "end" ? parentId : anchor?.parentId ?? parentId;
        if (nextParent && moving.some((id) => id === nextParent || isUnder(nodes, nextParent, id))) {
          get().log("warn", translate("log.cycle"));
          return;
        }
        mutate(set, get, "\u66F4\u6539\u7236\u5B50", (draft) => {
          const worlds = new Map(moving.map((id) => [id, worldPose2(draft.nodes, id)]));
          const parentPose = nextParent ? worldPose2(draft.nodes, nextParent) : null;
          for (const id of moving) {
            const current = draft.nodes[id];
            if (!current || current.parentId === nextParent) continue;
            const world3 = worlds.get(id);
            if (!world3) continue;
            current.parentId = nextParent;
            delete current.socketBone;
            writePose2(current, localPoseFromWorld(parentPose, world3));
            detachIfReparented(draft.nodes, id);
          }
          const siblings = childrenOf(draft.nodes, nextParent).filter((node) => !moving.includes(node.id));
          let index = siblings.length;
          if (anchor && (zone === "before" || zone === "after")) {
            const at = siblings.findIndex((node) => node.id === anchor.id);
            index = at < 0 ? siblings.length : zone === "before" ? at : at + 1;
          }
          const ordered = [...siblings];
          ordered.splice(index, 0, ...moving.map((id) => draft.nodes[id]).filter(Boolean));
          ordered.forEach((node, order) => {
            node.order = order;
          });
        });
      },
      toggleVisible: (id) => {
        const node = get().nodes[id];
        if (!node) return;
        mutate(set, get, node.visible ? "\u9690\u85CF" : "\u663E\u793A", (draft) => {
          draft.nodes[id].visible = !draft.nodes[id].visible;
        });
      },
      toggleLocked: (id) => {
        const node = get().nodes[id];
        if (!node) return;
        mutate(set, get, node.locked ? "\u89E3\u9501" : "\u9501\u5B9A", (draft) => {
          draft.nodes[id].locked = !draft.nodes[id].locked;
        });
      },
      selectAll: () => set({ selection: Object.keys(get().nodes) }),
      undo: () => {
        if (get().playState !== "stopped") {
          get().log("warn", translate("log.noUndoPlay"));
          return;
        }
        if (get().gesture) get().endGesture();
        const past = get().past;
        const entry = past[past.length - 1];
        if (!entry) return;
        if (entry.databaseOnly && entry.beforeDatabase) {
          set({
            past: past.slice(0, -1),
            future: [...get().future, entry],
            gameDatabase: structuredClone(entry.beforeDatabase),
            gameplayPacks: [...entry.beforePacks ?? get().gameplayPacks]
          });
          return;
        }
        if (entry.materialsOnly) {
          set({
            past: past.slice(0, -1),
            future: [...get().future, entry]
          });
          restoreMaterials(entry.beforeMaterials);
          return;
        }
        set({
          nodes: cloneNodes(entry.before),
          selection: entry.beforeSelection.filter((id) => entry.before[id]),
          past: past.slice(0, -1),
          future: [...get().future, entry],
          picture: structuredClone(entry.beforePicture)
        });
        restoreMaterials(entry.beforeMaterials);
      },
      redo: () => {
        if (get().playState !== "stopped") {
          get().log("warn", translate("log.noRedoPlay"));
          return;
        }
        if (get().gesture) {
          get().endGesture();
          return;
        }
        const future = get().future;
        const entry = future[future.length - 1];
        if (!entry) return;
        if (entry.databaseOnly && entry.afterDatabase) {
          set({
            future: future.slice(0, -1),
            past: [...get().past, entry],
            gameDatabase: structuredClone(entry.afterDatabase),
            gameplayPacks: [...entry.afterPacks ?? get().gameplayPacks]
          });
          return;
        }
        if (entry.materialsOnly) {
          set({
            future: future.slice(0, -1),
            past: [...get().past, entry]
          });
          restoreMaterials(entry.afterMaterials);
          return;
        }
        set({
          nodes: cloneNodes(entry.after),
          selection: entry.afterSelection.filter((id) => entry.after[id]),
          future: future.slice(0, -1),
          past: [...get().past, entry],
          picture: structuredClone(entry.afterPicture)
        });
        restoreMaterials(entry.afterMaterials);
      },
      play: () => {
        if (get().prefabSession) {
          get().log("warn", translate("prefab.noPlay"));
          return;
        }
        if (get().gesture) get().endGesture();
        const state = get().playState;
        if (state === "paused") {
          set({ playState: "playing" });
          get().log("info", translate("log.resumePlay"));
          return;
        }
        if (state === "playing") return;
        resetUiValues();
        const snapshot2 = cloneNodes(get().nodes);
        const nodes = cloneNodes(snapshot2);
        for (const node of Object.values(nodes)) {
          if (node.kind !== "model") continue;
          const animator = node.animator?.enabled ? node.animator : null;
          if (animator) {
            const start2 = animator.states.find((state2) => state2.id === (animator.defaultStateId || animator.stateId)) ?? animator.states[0];
            if (!start2?.clip) continue;
            nodes[node.id] = { ...node, clipPlaying: true, clipTime: 0, animator: { ...animator, stateId: start2.id } };
            continue;
          }
          if (!node.clip) continue;
          nodes[node.id] = { ...node, clipPlaying: true, clipTime: 0 };
        }
        set({
          playState: "playing",
          playSnapshot: snapshot2,
          nodes,
          playSelection: get().selection.slice(),
          playPicture: structuredClone(get().picture),
          playDirty: false
        });
        get().log("info", translate("log.startPlay"));
      },
      pause: () => {
        const state = get().playState;
        if (state === "playing") set({ playState: "paused" });
        else if (state === "paused") set({ playState: "playing" });
      },
      stop: () => {
        const snapshot2 = get().playSnapshot;
        const picture = get().playPicture;
        if (get().playState === "stopped" || !snapshot2) return;
        set({
          gesture: null,
          playState: "stopped",
          nodes: cloneNodes(snapshot2),
          selection: get().playSelection.filter((id) => snapshot2[id]),
          playSnapshot: null,
          picture: picture ? structuredClone(picture) : get().picture,
          playPicture: null,
          playDirty: false
        });
        resetUiValues();
        get().log("info", translate("log.stopPlay"));
      },
      keepPlayChanges: () => {
        const snapshot2 = get().playSnapshot;
        if (get().playState === "stopped" || !snapshot2) return;
        const beforeNodes = cloneNodes(snapshot2);
        const beforePicture = get().playPicture ? structuredClone(get().playPicture) : structuredClone(get().picture);
        const currentNodes = get().nodes;
        const nextSnapshot = {};
        const liveNodes = { ...currentNodes };
        let cameraKept = false;
        for (const [id, snapNode] of Object.entries(snapshot2)) {
          const liveNode = currentNodes[id];
          if (!liveNode) {
            nextSnapshot[id] = structuredClone(snapNode);
            continue;
          }
          const merged = structuredClone(liveNode);
          merged.position = [...snapNode.position];
          merged.rotation = [...snapNode.rotation];
          merged.scale = [...snapNode.scale];
          merged.clipPlaying = snapNode.clipPlaying;
          merged.clipTime = snapNode.clipTime;
          merged.overlayPlaying = snapNode.overlayPlaying;
          merged.overlayTime = snapNode.overlayTime;
          if (merged.animator && snapNode.animator) {
            merged.animator = {
              ...merged.animator,
              stateId: snapNode.animator.stateId
            };
          }
          const followed = bakeFollow(liveNode);
          if (followed) {
            const gameplay = { ...liveNode.gameplay, cameraFollow: followed };
            merged.gameplay = gameplay;
            liveNodes[id] = { ...liveNode, gameplay };
            cameraKept = true;
            settleCameraArm(id);
          }
          nextSnapshot[id] = merged;
        }
        const nextPicture = structuredClone(get().picture);
        if (!sameNodes(beforeNodes, nextSnapshot) || !sameJson(beforePicture, nextPicture)) {
          pushHistory(set, {
            label: translate("inspector.keepPlayChanges"),
            before: beforeNodes,
            after: cloneNodes(nextSnapshot),
            beforeSelection: get().playSelection.slice(),
            afterSelection: get().playSelection.slice(),
            beforePicture,
            afterPicture: structuredClone(nextPicture)
          });
        }
        set({
          nodes: cameraKept ? liveNodes : currentNodes,
          playSnapshot: nextSnapshot,
          playPicture: nextPicture,
          playDirty: false
        });
        get().notify(translate("log.keptPlayChanges"));
        get().log("info", translate("log.keptPlayChanges"));
      },
      newScene: () => {
        get().createScene();
      },
      createScene: () => {
        if (get().playState !== "stopped") {
          get().log("warn", translate("log.stopBeforeNew"));
          return;
        }
        if (get().gesture) get().endGesture();
        get().flushActiveScene();
        const existing = Object.values(useAssetStore.getState().assets).filter((asset) => asset.kind === "scene");
        const fresh = createFreshScene(uniqueSceneName(existing.map((scene2) => scene2.name)));
        useAssetStore.getState().add({
          id: fresh.id,
          name: fresh.name,
          kind: "scene",
          nodes: fresh.nodes,
          picture: fresh.picture
        });
        useAssetStore.getState().place(fresh.id);
        set({
          activeSceneId: fresh.id,
          nodes: fresh.nodes,
          selection: [fresh.selectedId],
          past: [],
          future: [],
          gesture: null,
          playSnapshot: null,
          playPicture: null,
          picture: fresh.picture
        });
        get().log("info", translate("log.createdScene", { name: fresh.name }));
      },
      openScene: (id) => {
        const asset = useAssetStore.getState().assets[id];
        if (!asset || asset.kind !== "scene") return;
        if (get().playState !== "stopped") {
          get().log("warn", translate("log.stopBeforeOpen"));
          return;
        }
        if (get().activeSceneId === id && !get().prefabSession) return;
        if (get().prefabSession) get().closePrefab(true);
        if (get().activeSceneId === id) return;
        if (get().gesture) get().endGesture();
        get().flushActiveScene();
        set({
          activeSceneId: id,
          nodes: structuredClone(asset.nodes),
          picture: normalizePicture(asset.picture),
          editorView: normalizeEditorView(asset.editorView),
          editorViewNonce: get().editorViewNonce + 1,
          selection: [],
          past: [],
          future: [],
          gesture: null,
          playSnapshot: null,
          playPicture: null
        });
        get().log("info", translate("log.openedScene", { name: asset.name }));
      },
      deleteScene: (id) => {
        const scenes = Object.values(useAssetStore.getState().assets).filter((asset) => asset.kind === "scene");
        if (!scenes.some((scene2) => scene2.id === id)) return;
        if (scenes.length <= 1) {
          get().log("warn", translate("log.keepScene"));
          return;
        }
        if (get().playState !== "stopped") {
          get().log("warn", translate("log.stopBeforeDelete"));
          return;
        }
        if (get().activeSceneId === id) {
          const next = scenes.find((scene2) => scene2.id !== id);
          if (!next) return;
          set({
            activeSceneId: next.id,
            nodes: structuredClone(next.nodes),
            picture: normalizePicture(next.picture),
            editorView: normalizeEditorView(next.editorView),
            editorViewNonce: get().editorViewNonce + 1,
            selection: [],
            past: [],
            future: [],
            gesture: null,
            playSnapshot: null,
            playPicture: null
          });
        }
        useAssetStore.getState().remove(id);
        forgetNavMesh(id);
        get().log("info", translate("log.deletedScene"));
      },
      flushActiveScene: () => {
        const id = get().activeSceneId;
        if (!id) return;
        const session = get().prefabSession;
        if (session) {
          const editing = structuredClone(get().nodes);
          const root = Object.values(editing).find((node) => !node.parentId);
          if (root) {
            root.position = [0, 0, 0];
            root.rotation = [0, 0, 0];
            root.scale = [1, 1, 1];
          }
          useAssetStore.getState().writePrefab(session.assetId, root?.id ?? "", editing);
          reconcilePrefab(session.sceneNodes, session.assetId, readPrefab({ rootId: root?.id ?? "", nodes: editing }), lookupPrefab);
        }
        const nodes = session ? session.sceneNodes : get().nodes;
        const liveView = get().prefabSession ? get().editorView : readEditorViewPose();
        useAssetStore.getState().writeScene(id, structuredClone(nodes), structuredClone(get().picture), liveView ?? void 0);
      },
      ensureSceneAsset: () => {
        const scenes = Object.values(useAssetStore.getState().assets).filter((asset) => asset.kind === "scene");
        if (scenes.length === 0) {
          const id = crypto.randomUUID();
          useAssetStore.getState().add({
            id,
            name: "\u672A\u547D\u540D\u573A\u666F",
            kind: "scene",
            nodes: structuredClone(get().nodes),
            picture: structuredClone(get().picture)
          });
          useAssetStore.getState().place(id, "Assets");
          set({ activeSceneId: id });
          return;
        }
        if (!scenes.some((scene2) => scene2.id === get().activeSceneId)) {
          const first = scenes[0];
          set({
            activeSceneId: first.id,
            nodes: structuredClone(first.nodes),
            picture: structuredClone(first.picture),
            selection: []
          });
        }
      },
      requestRename: (id) => {
        if (!get().nodes[id]) return;
        set({ pendingRenameId: id, selection: [id] });
      },
      loadDocument: (document2) => {
        if (get().gesture) get().endGesture();
        const nodes = document2.nodes;
        set({
          nodes,
          selection: document2.selection.filter((id) => nodes[id]),
          past: [],
          future: [],
          gesture: null,
          playState: "stopped",
          playSnapshot: null,
          playSelection: [],
          playPicture: null,
          picture: normalizePicture(document2.picture),
          editorView: savedEditorView(document2),
          editorViewNonce: get().editorViewNonce + 1,
          capabilities: normalizeCapabilities(document2.capabilities),
          tags: ensureTags(document2.tags),
          gameplayPacks: [...resolveEnabledPackIds(document2.gameplayPacks)],
          gameDatabase: ensureGameDatabase(document2.gameDatabase, document2.gameplayPacks),
          layers: ensureLayers(document2.layers),
          editorCullingMask: typeof document2.editorCullingMask === "number" ? document2.editorCullingMask >>> 0 : ALL_LAYERS_VISIBLE_MASK,
          physicsCollisionMatrixEnabled: document2.physicsCollisionMatrixEnabled === true,
          physicsCollisionRowMasks: document2.physicsCollisionRowMasks ?? {},
          activeSceneId: document2.activeSceneId,
          prefabSession: null,
          inspectedAssetId: typeof document2.workspace?.inspectedAssetId === "string" ? document2.workspace.inspectedAssetId : null
        });
        hydrateNavigation(document2.navMeshes);
      },
      clearLogs: () => set({ logs: [] }),
      log: (level, message, parts) => {
        const entry = { id: crypto.randomUUID(), level, message, time: Date.now(), parts };
        set((state) => ({ logs: [...state.logs, entry].slice(-300) }));
        if (level !== "info") get().notify(message);
      },
      notify: (message) => {
        set({ notice: message });
        window.setTimeout(() => {
          if (get().notice === message) set({ notice: null });
        }, 2600);
      },
      setPicture: (patch) => set((state) => ({
        picture: normalizePicture({ ...state.picture, ...patch }),
        ...state.playState !== "stopped" ? { playDirty: true } : {}
      })),
      rememberEditorView: (view) => {
        if (get().prefabSession || get().playState !== "stopped") return;
        if (JSON.stringify(get().editorView) === JSON.stringify(view)) return;
        set({ editorView: view });
      },
      setCapability: (id, enabled) => set((state) => ({
        capabilities: { ...state.capabilities, [id]: enabled }
      })),
      commitGameplay: (packs2, database, label) => {
        const beforePacks = [...get().gameplayPacks];
        const beforeDatabase = structuredClone(get().gameDatabase);
        const nextPacks = [...resolveEnabledPackIds(packs2)];
        const nextDatabase = ensureGameDatabase(database, nextPacks);
        if (JSON.stringify(beforePacks) === JSON.stringify(nextPacks) && JSON.stringify(beforeDatabase) === JSON.stringify(nextDatabase)) return;
        pushHistory(set, {
          label,
          before: {},
          after: {},
          beforeSelection: [],
          afterSelection: [],
          beforePicture: get().picture,
          afterPicture: get().picture,
          databaseOnly: true,
          beforeDatabase,
          afterDatabase: structuredClone(nextDatabase),
          beforePacks,
          afterPacks: nextPacks
        });
        set({ gameplayPacks: nextPacks, gameDatabase: nextDatabase });
      },
      setTags: (tags2) => {
        const next = ensureTags(tags2);
        const ids = new Set(next.map((tag) => tag.id));
        const previous = new Set(get().tags.map((tag) => tag.id));
        set((state) => {
          const nodes = { ...state.nodes };
          for (const [id, node] of Object.entries(nodes)) {
            const tagId = node.tagId && ids.has(node.tagId) ? node.tagId : null;
            const tagIds = (node.tagIds ?? []).filter((tag) => !previous.has(tag) || ids.has(tag));
            const samePrimary = (node.tagId ?? null) === tagId;
            const sameExtra = (node.tagIds ?? []).join("|") === tagIds.join("|");
            if (!samePrimary || !sameExtra) nodes[id] = { ...node, tagId, tagIds };
          }
          return { tags: next, nodes };
        });
      },
      setLayers: (layers) => {
        const next = ensureLayers(layers);
        const ids = new Set(next.map((layer) => layer.id));
        set((state) => {
          const nodes = { ...state.nodes };
          for (const [id, node] of Object.entries(nodes)) {
            if (node.renderLayerId && !ids.has(node.renderLayerId)) {
              nodes[id] = { ...node, renderLayerId: LAYER_ID_DEFAULT };
            }
          }
          return { layers: next, nodes };
        });
      },
      setEditorCullingMask: (mask) => set({ editorCullingMask: mask >>> 0 }),
      setPhysicsCollisionMatrix: (enabled, rows) => set({
        physicsCollisionMatrixEnabled: enabled,
        physicsCollisionRowMasks: rows
      }),
      applySimulation: (poses) => {
        if (get().playState !== "playing" || poses.length === 0) return;
        const depthOf = (id) => {
          let depth = 0;
          let parent = get().nodes[id]?.parentId;
          const seen = /* @__PURE__ */ new Set();
          while (parent && !seen.has(parent)) {
            seen.add(parent);
            depth += 1;
            parent = get().nodes[parent]?.parentId;
          }
          return depth;
        };
        const ordered = [...poses].sort((a, b) => depthOf(a.id) - depthOf(b.id));
        set((state) => {
          const nodes = { ...state.nodes };
          for (const pose of ordered) {
            const node = nodes[pose.id];
            if (!node) continue;
            const parent = node.parentId ? worldPose2(nodes, node.parentId) : null;
            const local = localPoseFromWorld(parent, {
              position: new Vector312(pose.position[0], pose.position[1], pose.position[2]),
              quaternion: new Quaternion7(pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]),
              scale: new Vector312(node.scale[0], node.scale[1], node.scale[2])
            });
            const parts = poseComponents(local);
            nodes[pose.id] = { ...node, position: parts.position, rotation: parts.rotation };
          }
          return { nodes };
        });
      },
      setRenderBackend: (label) => {
        if (get().renderBackend !== label) set({ renderBackend: label });
      },
      setHelpersVisible: (visible) => set({ helpersVisible: visible }),
      setNavMeshVisible: (visible) => set({ navMeshVisible: visible }),
      setSnapStep: (step2) => set({ snapStep: Math.max(0.01, step2) }),
      setViewportStats: (stats) => {
        set({ viewportStats: stats });
      },
      spawnModel: (assetId, name, slots, point2) => {
        let created = "";
        const ok = mutate(set, get, `\u653E\u7F6E${name}`, (draft) => {
          const id = crypto.randomUUID();
          created = uniqueName(draft.nodes, name);
          draft.nodes[id] = makeNode({
            id,
            name: created,
            kind: "model",
            assetId,
            slots: structuredClone(slots),
            position: [point2[0], point2[1], point2[2]]
          });
          draft.selection = [id];
        });
        if (ok && created) get().log("info", translate("log.placed", { name: created }));
      },
      spawnPrefab: (assetId, point2, parentId = null) => {
        if (get().prefabSession) {
          get().log("warn", translate("prefab.exitFirst"));
          return;
        }
        const asset = useAssetStore.getState().assets[assetId];
        const doc = asset?.kind === "prefab" ? readPrefab(asset) : null;
        if (!doc?.rootId) return;
        let created = "";
        const ok = mutate(set, get, translate("prefab.place", { name: asset?.name ?? "" }), (draft) => {
          const id = instantiatePrefab(draft.nodes, doc, assetId, parentId, parentId ? null : point2, lookupPrefab);
          if (!id) return;
          created = draft.nodes[id]?.name ?? "";
          draft.selection = [id];
        });
        if (ok && created) get().log("info", translate("log.placed", { name: created }));
      },
      createPrefabFromSelection: (name, nodeId, dir) => {
        if (get().playState !== "stopped") return;
        if (get().prefabSession) {
          get().log("warn", translate("prefab.exitFirst"));
          return;
        }
        const roots = nodeId ? [nodeId] : selectionRoots(get().nodes, get().selection);
        if (roots.length !== 1 || !get().nodes[roots[0]]) {
          get().log("warn", translate("prefab.needOne"));
          return;
        }
        if (get().nodes[roots[0]].prefabInstanceId === roots[0]) {
          get().log("warn", translate("prefab.alreadyInstance"));
          return;
        }
        const source = get().nodes[roots[0]];
        const doc = captureTemplate(get().nodes, roots[0]);
        if (!doc.rootId) return;
        const id = crypto.randomUUID();
        const assetName = uniqueAssetName(name?.trim() || source.name);
        useAssetStore.getState().add({ id, name: assetName, kind: "prefab", rootId: doc.rootId, nodes: doc.nodes });
        useAssetStore.getState().place(id, dir);
        const ok = mutate(set, get, translate("prefab.create", { name: assetName }), (draft) => {
          const current = draft.nodes[roots[0]];
          if (!current) return;
          const parentId = current.parentId;
          const position = current.position;
          const rotation = current.rotation;
          const scale = current.scale;
          const order = current.order;
          const name2 = current.name;
          deleteSubtree2(draft.nodes, roots[0]);
          const instanceId = instantiatePrefab(draft.nodes, doc, id, parentId, position, lookupPrefab);
          const instance2 = instanceId ? draft.nodes[instanceId] : void 0;
          if (!instance2) return;
          instance2.name = name2;
          instance2.rotation = rotation;
          instance2.scale = scale;
          instance2.order = order;
          instance2.prefabOverrides = ["position", "rotation", "scale"];
          draft.selection = [instance2.id];
        });
        if (ok) get().log("info", translate("log.savedPrefab", { name: assetName }));
      },
      rebindPrefab: (fromId, toId) => {
        const doc = lookupPrefab(toId);
        if (!doc?.rootId || fromId === toId) return;
        const ok = mutate(set, get, translate("prefab.rebind"), (draft) => {
          const roots = Object.values(draft.nodes).filter((node) => node.prefabAssetId === fromId && node.prefabInstanceId === node.id);
          for (const root of roots) {
            for (const node of Object.values(draft.nodes)) {
              if (node.prefabInstanceId === root.id && node.id !== root.id) delete draft.nodes[node.id];
            }
            root.prefabAssetId = toId;
            root.prefabTemplateId = doc.rootId;
            root.prefabRemoved = [];
            root.prefabOverrides = ["position", "rotation", "scale"];
          }
          reconcilePrefab(draft.nodes, toId, doc, lookupPrefab);
        });
        if (ok) get().log("info", translate("prefab.rebound"));
      },
      openPrefab: (assetId) => {
        if (get().playState !== "stopped") {
          get().log("warn", translate("prefab.noPlay"));
          return;
        }
        if (get().prefabSession?.assetId === assetId) return;
        if (get().prefabSession) get().closePrefab(true);
        const asset = useAssetStore.getState().assets[assetId];
        const doc = asset?.kind === "prefab" ? readPrefab(asset) : null;
        if (!doc?.rootId) return;
        if (get().gesture) get().endGesture();
        set({
          prefabSession: {
            assetId,
            sceneNodes: structuredClone(get().nodes),
            sceneSelection: get().selection.slice(),
            scenePast: get().past,
            sceneFuture: get().future,
            sceneView: readEditorViewPose() ?? get().editorView
          },
          nodes: structuredClone(doc.nodes),
          selection: [doc.rootId],
          past: [],
          future: [],
          inspectedAssetId: null
        });
        get().log("info", translate("prefab.editing", { name: asset?.name ?? "" }));
      },
      closePrefab: (save) => {
        const session = get().prefabSession;
        if (!session) return;
        if (get().gesture) get().endGesture();
        const sceneNodes = session.sceneNodes;
        if (save) {
          const nodes = structuredClone(get().nodes);
          const root = Object.values(nodes).find((node) => !node.parentId);
          if (root) {
            root.position = [0, 0, 0];
            root.rotation = [0, 0, 0];
            root.scale = [1, 1, 1];
          }
          useAssetStore.getState().writePrefab(session.assetId, root?.id ?? "", nodes);
          const doc = readPrefab({ rootId: root?.id ?? "", nodes });
          reconcilePrefab(sceneNodes, session.assetId, doc, lookupPrefab);
        }
        set({
          prefabSession: null,
          nodes: sceneNodes,
          selection: session.sceneSelection.filter((id) => sceneNodes[id]),
          past: session.scenePast,
          future: session.sceneFuture,
          editorView: session.sceneView,
          editorViewNonce: session.sceneView ? get().editorViewNonce + 1 : get().editorViewNonce
        });
        get().log("info", translate(save ? "prefab.saved" : "prefab.closed"));
      },
      applyPrefabInstance: (id) => {
        const root = get().nodes[id];
        const asset = root?.prefabAssetId ? useAssetStore.getState().assets[root.prefabAssetId] : void 0;
        if (!root || root.prefabInstanceId !== root.id || asset?.kind !== "prefab") return;
        const ok = mutate(set, get, translate("prefab.apply"), (draft) => {
          const doc = applyInstance(draft.nodes, id, readPrefab(asset));
          useAssetStore.getState().writePrefab(asset.id, doc.rootId, doc.nodes);
          reconcilePrefab(draft.nodes, asset.id, doc, lookupPrefab);
        });
        if (ok) get().log("info", translate("prefab.applied"));
      },
      revertPrefabInstance: (id) => {
        const root = get().nodes[id];
        const asset = root?.prefabAssetId ? useAssetStore.getState().assets[root.prefabAssetId] : void 0;
        if (!root || root.prefabInstanceId !== root.id || asset?.kind !== "prefab") return;
        const ok = mutate(set, get, translate("prefab.revert"), (draft) => {
          revertInstance(draft.nodes, id, readPrefab(asset), asset.id, lookupPrefab);
        });
        if (ok) get().log("info", translate("prefab.reverted"));
      },
      unpackPrefabInstance: (id) => {
        if (!get().nodes[id] || get().nodes[id].prefabInstanceId !== id) return;
        const ok = mutate(set, get, translate("prefab.unpack"), (draft) => {
          unpackInstance(draft.nodes, id);
        });
        if (ok) get().log("info", translate("prefab.unpacked"));
      },
      assignMap: (id, assetId) => {
        const node = get().nodes[id];
        if (!node) return;
        const label = translate(assetId ? "gesture.map" : "gesture.mapClear");
        if (node.kind === "model" && node.slots.length > 0) {
          const linked = node.slots[0].materialAssetId;
          if (linked) {
            get().commitMaterial(linked, { mapAssetId: assetId }, label);
            return;
          }
          get().beginGesture(label);
          get().updateNode(id, {
            slots: node.slots.map((slot, index) => index === 0 ? { ...slot, mapAssetId: assetId } : slot)
          });
          get().endGesture();
          return;
        }
        if (node.materialAssetId) {
          get().commitMaterial(node.materialAssetId, { mapAssetId: assetId }, label);
          return;
        }
        get().beginGesture(label);
        get().updateNode(id, { mapAssetId: assetId });
        get().endGesture();
      },
      commitMaterial: (id, patch, label) => {
        const asset = useAssetStore.getState().assets[id];
        if (!asset || asset.kind !== "material") return;
        const beforeSlot = structuredClone(asset.slot);
        const afterSlot = { ...beforeSlot, ...patch };
        if (sameJson(beforeSlot, afterSlot)) return;
        if (get().gesture) get().endGesture();
        useAssetStore.getState().replaceMaterial(id, afterSlot);
        const nodes = cloneNodes(get().nodes);
        const selection = get().selection.slice();
        const picture = structuredClone(get().picture);
        pushHistory(set, {
          label,
          before: nodes,
          after: cloneNodes(nodes),
          beforeSelection: selection,
          afterSelection: selection.slice(),
          beforePicture: picture,
          afterPicture: picture,
          materialsOnly: true,
          beforeMaterials: { [id]: beforeSlot },
          afterMaterials: { [id]: structuredClone(afterSlot) }
        });
      },
      assignMaterial: (id, materialId) => {
        const asset = useAssetStore.getState().assets[materialId];
        const node = get().nodes[id];
        if (!node || asset?.kind !== "material") return;
        get().beginGesture("\u6307\u5B9A\u6750\u8D28");
        if (node.kind === "model" && node.slots.length > 0) {
          get().updateNode(id, {
            slots: node.slots.map((item) => ({ ...item, materialAssetId: materialId }))
          });
        } else {
          get().updateNode(id, { materialAssetId: materialId });
        }
        get().endGesture();
        get().log("info", translate("log.assignedMaterial", { name: asset.name }));
      }
    }));
    clipboard = null;
    if (typeof window !== "undefined") {
      window.addEventListener("t3d:load-scene", (ev) => {
        const detail = ev.detail;
        if (!detail?.sceneId) return;
        const st = useEditorStore.getState();
        if (st.playState === "playing") {
          st.openScene(detail.sceneId);
        }
      });
    }
  }
});

// tests/phase2-runtime.test.ts
init_actionMap();
import assert from "node:assert/strict";
import test from "node:test";

// src/core/query/diagnose.ts
init_registry2();
init_library();
init_store2();
init_workspace();
init_actionMap();

// src/core/preview/offscreenPreview.ts
var activeBridge = null;
function getViewportBridge() {
  return activeBridge;
}
function captureMainViewport(options) {
  if (!activeBridge) return null;
  activeBridge.renderNow();
  return activeBridge.captureDataUrl(options);
}
function readMainRenderMetrics() {
  return activeBridge?.getRenderMetrics() ?? null;
}

// src/core/query/diagnose.ts
var DEFAULT_PERFORMANCE_BUDGET = {
  maxDrawCalls: 600,
  maxTriangles: 35e4,
  maxShadowLights: 3,
  maxAssetBytes: 120 * 1024 * 1024
};
function diagnoseProject(budget = DEFAULT_PERFORMANCE_BUDGET) {
  const state = useEditorStore.getState();
  const assets = useAssetStore.getState().assets;
  const nodes = Object.values(state.nodes);
  const issues = [];
  let hasCamera = false;
  let hasLight = false;
  let hasCharacterOrPlayer = false;
  for (const node of nodes) {
    if (node.kind === "camera") hasCamera = true;
    if (node.kind === "directional-light" || node.kind === "point-light" || node.kind === "spot-light" || node.kind === "hemisphere-light") {
      hasLight = true;
    }
    if (node.gameplay?.character?.enabled || node.tagId === "player" || node.tagIds?.includes("player")) {
      hasCharacterOrPlayer = true;
    }
    if (node.parentId && !state.nodes[node.parentId]) {
      issues.push({
        severity: "error",
        category: "reference",
        target: node.id,
        message: `\u8282\u70B9 "${node.name}" \u7684\u7236\u8282\u70B9 "${node.parentId}" \u4E0D\u5B58\u5728`,
        hint: "\u8C03\u7528 scene.reparentNode \u5C06\u5176\u79FB\u5230\u6839\u7EA7\u6216\u6709\u6548\u7684\u7236\u8282\u70B9\u4E0B"
      });
    }
    if (node.assetId && !assets[node.assetId]) {
      issues.push({
        severity: "error",
        category: "reference",
        target: node.id,
        message: `\u8282\u70B9 "${node.name}" \u5F15\u7528\u7684\u8D44\u4EA7 "${node.assetId}" \u5DF2\u4E22\u5931`,
        hint: "\u8BF7\u91CD\u65B0\u6307\u6D3E\u6709\u6548\u7684\u6A21\u578B/\u7279\u6548/\u754C\u9762\u8D44\u4EA7\u6216\u5220\u9664\u65E0\u6548\u8282\u70B9"
      });
    }
    if (node.materialAssetId && !assets[node.materialAssetId]) {
      issues.push({
        severity: "error",
        category: "reference",
        target: node.id,
        message: `\u8282\u70B9 "${node.name}" \u5F15\u7528\u7684\u6750\u8D28\u8D44\u4EA7 "${node.materialAssetId}" \u4E0D\u5B58\u5728`,
        hint: "\u8BF7\u901A\u8FC7 asset.assignMaterial \u91CD\u65B0\u7ED1\u5B9A\u6709\u6548\u6750\u8D28"
      });
    }
    for (const slot of node.slots) {
      if (slot.materialAssetId && !assets[slot.materialAssetId]) {
        issues.push({
          severity: "error",
          category: "reference",
          target: node.id,
          message: `\u8282\u70B9 "${node.name}" \u69FD\u4F4D "${slot.name}" \u5F15\u7528\u7684\u6750\u8D28\u8D44\u4EA7 "${slot.materialAssetId}" \u4E0D\u5B58\u5728`,
          hint: "\u8BF7\u901A\u8FC7 asset.assignMaterial \u91CD\u65B0\u7ED1\u5B9A\u6709\u6548\u6750\u8D28"
        });
      }
    }
    if (node.capabilities?.water && !capabilityEnabled(state.capabilities, "water")) {
      issues.push({
        severity: "warning",
        category: "pack",
        target: node.id,
        message: `\u8282\u70B9 "${node.name}" \u6302\u6709\u6C34\u4F53\u914D\u7F6E\uFF0C\u4F46\u5DE5\u7A0B\u5C1A\u672A\u542F\u7528 water \u80FD\u529B\u5305`,
        hint: "\u8C03\u7528 capability.setEnabled \u5F00\u542F water \u80FD\u529B\u5305"
      });
    }
    if (node.gameplay?.packs) {
      for (const packId of Object.keys(node.gameplay.packs)) {
        if (packId !== "core" && packId !== "__project__" && !state.gameplayPacks.includes(packId)) {
          issues.push({
            severity: "warning",
            category: "pack",
            target: node.id,
            message: `\u8282\u70B9 "${node.name}" \u4F7F\u7528\u4E86\u672A\u542F\u7528\u7684\u73A9\u6CD5\u5305 "${packId}"`,
            hint: `\u8C03\u7528 gameplay.setPackEnabled \u5F00\u542F "${packId}"`
          });
        }
      }
    }
  }
  const codeAssets = Object.values(useCodeAssetStore.getState().assets);
  const scriptAssets = codeAssets.filter((a) => a.kind === "script");
  const scriptById = new Map(scriptAssets.map((s) => [s.id, s]));
  for (const script of scriptAssets) {
    if (!script.ok) {
      issues.push({
        severity: "error",
        category: "playability",
        target: script.id,
        message: `\u811A\u672C "${script.relativePath}" \u7F16\u8BD1\u5931\u8D25\uFF08${script.diagnostics[0]?.message ?? "\u5B58\u5728\u8BED\u6CD5\u6216\u7ED3\u6784\u9519\u8BEF"}\uFF09`,
        hint: "\u8C03\u7528 script__read \u67E5\u770B\u6E90\u7801\u5E76\u7528 script.update / script.patch \u4FEE\u590D"
      });
    }
  }
  const mountedScriptIds = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    const projectScripts = node.gameplay?.packs?.__project__;
    if (!projectScripts || typeof projectScripts !== "object") continue;
    for (const [scriptId, rawConfig] of Object.entries(projectScripts)) {
      if (!rawConfig || typeof rawConfig !== "object") continue;
      if (rawConfig.__enabled === false) continue;
      mountedScriptIds.add(scriptId);
      const scriptRecord = scriptById.get(scriptId);
      if (!scriptRecord) {
        issues.push({
          severity: "error",
          category: "reference",
          target: node.id,
          message: `\u8282\u70B9 "${node.name}" \u6302\u8F7D\u4E86\u4E0D\u5B58\u5728\u7684\u811A\u672C "${scriptId}"`,
          hint: "\u68C0\u67E5 scriptId \u6216\u4ECE\u8282\u70B9\u79FB\u9664\u65E0\u6548\u811A\u672C"
        });
        continue;
      }
      const paramSchema = scriptRecord.compiledScript?.behavior?.params;
      if (paramSchema && typeof paramSchema === "object") {
        for (const [paramKey, rawDef] of Object.entries(paramSchema)) {
          if (!rawDef || typeof rawDef !== "object") continue;
          const def = rawDef;
          if (def.type !== "ref") continue;
          const val = rawConfig[paramKey] ?? def.default;
          const strVal = typeof val === "string" ? val.trim() : "";
          if (!strVal) {
            if (!def.optional) {
              issues.push({
                severity: "warning",
                category: "reference",
                target: node.id,
                message: `\u8282\u70B9 "${node.name}" \u4E0A\u7684\u811A\u672C "${scriptId}" \u7F3A\u5C11\u5F15\u7528\u53C2\u6570 "${paramKey}"\uFF08\u5F53\u524D\u4E3A\u7A7A\uFF09`,
                hint: `\u8C03\u7528 script.attach \u4E3A "${node.name}" \u7684 ${scriptId}.params.${paramKey} \u4F20\u5165\u6709\u6548\u8282\u70B9\u6216\u8D44\u4EA7 ID`
              });
            }
          } else if (def.target === "node" && !state.nodes[strVal]) {
            issues.push({
              severity: "error",
              category: "reference",
              target: node.id,
              message: `\u8282\u70B9 "${node.name}" \u811A\u672C "${scriptId}" \u7684\u8282\u70B9\u5F15\u7528 "${paramKey}" \u6307\u5411\u4E86\u4E0D\u5B58\u5728\u7684\u8282\u70B9 "${strVal}"`,
              hint: `\u8C03\u7528 script.attach \u66F4\u65B0 ${scriptId}.params.${paramKey} \u4E3A\u6709\u6548\u7684\u573A\u666F\u8282\u70B9 ID`
            });
          } else if (def.target === "asset" && !assets[strVal]) {
            issues.push({
              severity: "error",
              category: "reference",
              target: node.id,
              message: `\u8282\u70B9 "${node.name}" \u811A\u672C "${scriptId}" \u7684\u8D44\u4EA7\u5F15\u7528 "${paramKey}" \u6307\u5411\u4E86\u4E0D\u5B58\u5728\u7684\u8D44\u4EA7 "${strVal}"`,
              hint: `\u8C03\u7528 script.attach \u66F4\u65B0 ${scriptId}.params.${paramKey} \u4E3A\u6709\u6548\u7684\u8D44\u4EA7 ID`
            });
          }
        }
      }
    }
  }
  const inputActions = getInputActionMap().actions;
  const inputActionRe = /\b(?:self|world)\.input\.(?:isPressed|justPressed|justReleased|axis1D|axis2D)\(\s*["']([^"']+)["']/g;
  const reportedMissingActions = /* @__PURE__ */ new Set();
  for (const script of scriptAssets) {
    if (!mountedScriptIds.has(script.id) && script.compiledScript?.kind !== "system") continue;
    let m;
    while ((m = inputActionRe.exec(script.source)) !== null) {
      const actionName = m[1];
      if (!inputActions[actionName] && !reportedMissingActions.has(actionName)) {
        reportedMissingActions.add(actionName);
        issues.push({
          severity: "warning",
          category: "playability",
          target: script.id,
          message: `\u811A\u672C "${script.id}" \u8BFB\u53D6\u4E86\u8F93\u5165\u52A8\u4F5C "${actionName}"\uFF0C\u4F46\u5DE5\u7A0B\u8F93\u5165\u914D\u7F6E\u4E2D\u672A\u6CE8\u518C\u8BE5\u52A8\u4F5C`,
          hint: `\u8C03\u7528 input.setAction \u6CE8\u518C "${actionName}" \u7684\u6309\u952E\u6620\u5C04\uFF08\u6216\u6539\u7528\u5DF2\u6CE8\u518C\u52A8\u4F5C\uFF1A${Object.keys(inputActions).join(", ")}\uFF09`
        });
      }
    }
  }
  const allScriptSources = scriptAssets.map((s) => s.source).join("\n");
  const scriptSetVars = /* @__PURE__ */ new Set();
  const setVarRe = /\bui\.setVar\(\s*["']([^"']+)["']/g;
  let varMatch;
  while ((varMatch = setVarRe.exec(allScriptSources)) !== null) {
    scriptSetVars.add(varMatch[1]);
  }
  const scriptEventHandlers = /* @__PURE__ */ new Set();
  const onEventRe = /\bui\.onEvent\(\s*["']([^"']+)["']/g;
  let evMatch;
  while ((evMatch = onEventRe.exec(allScriptSources)) !== null) {
    scriptEventHandlers.add(evMatch[1]);
  }
  const uiBoundVars = /* @__PURE__ */ new Map();
  const uiSentMessages = /* @__PURE__ */ new Map();
  const uiSelfSetVars = /* @__PURE__ */ new Set();
  const collectUiRefs = (uiNode, screenName) => {
    if (Array.isArray(uiNode.bindings)) {
      for (const b of uiNode.bindings) {
        if (b?.source?.kind === "variable" && b.source.varId) {
          uiBoundVars.set(b.source.varId, screenName);
        }
      }
    }
    if (uiNode.click?.kind === "sendMessage" && uiNode.click.message) {
      uiSentMessages.set(uiNode.click.message, screenName);
    } else if (uiNode.click?.kind === "setVariable" && uiNode.click.varId) {
      uiSelfSetVars.add(uiNode.click.varId);
    }
    if (Array.isArray(uiNode.children)) {
      for (const child of uiNode.children) collectUiRefs(child, screenName);
    }
  };
  for (const node of nodes) {
    if (node.kind === "screen" && node.screen?.documentId) {
      const uiAsset = assets[node.screen.documentId];
      if (uiAsset?.kind === "ui") {
        collectUiRefs(uiAsset.document.root, uiAsset.name);
      }
    }
  }
  if (scriptAssets.length > 0) {
    for (const [varId, uiName] of uiBoundVars.entries()) {
      if (!scriptSetVars.has(varId) && !uiSelfSetVars.has(varId)) {
        issues.push({
          severity: "warning",
          category: "ui",
          target: varId,
          message: `UI "${uiName}" \u7ED1\u5B9A\u4E86\u53D8\u91CF "${varId}"\uFF0C\u4F46\u6CA1\u6709\u4EFB\u4F55\u811A\u672C\u8C03\u7528 ui.setVar("${varId}", ...) \u66F4\u65B0\u5B83`,
          hint: `\u5728\u76F8\u5173\u811A\u672C\u4E2D\u6DFB\u52A0 self.ui.setVar("${varId}", value)\uFF08\u6216 world.ui.setVar\uFF09`
        });
      }
    }
    for (const [msgName, uiName] of uiSentMessages.entries()) {
      const quotedPresent = scriptEventHandlers.has(msgName) || allScriptSources.includes(`"${msgName}"`) || allScriptSources.includes(`'${msgName}'`);
      if (!quotedPresent) {
        issues.push({
          severity: "warning",
          category: "ui",
          target: msgName,
          message: `UI "${uiName}" \u7684\u6309\u94AE\u4F1A\u53D1\u9001\u4E8B\u4EF6 "${msgName}"\uFF0C\u4F46\u5F53\u524D\u6CA1\u6709\u811A\u672C\u76D1\u542C\u6216\u5904\u7406\u5B83`,
          hint: `\u5728\u811A\u672C\u4E2D\u901A\u8FC7 self.ui.onEvent("${msgName}", () => { ... }) \u6216 onMessage \u54CD\u5E94\u6B64\u4E8B\u4EF6`
        });
      }
    }
  }
  if (!hasCamera) {
    issues.push({
      severity: "warning",
      category: "playability",
      message: "\u5F53\u524D\u573A\u666F\u6CA1\u6709\u76F8\u673A\u8282\u70B9",
      hint: "\u53EF\u521B\u5EFA\u4E00\u4E2A camera \u8282\u70B9\u6216\u4E3A\u89D2\u8272\u542F\u7528\u8DDF\u968F\u76F8\u673A"
    });
  }
  if (!hasLight) {
    issues.push({
      severity: "warning",
      category: "playability",
      message: "\u5F53\u524D\u573A\u666F\u6CA1\u6709\u4EFB\u4F55\u706F\u5149\u8282\u70B9\uFF0C\u753B\u9762\u53EF\u80FD\u5168\u9ED1",
      hint: "\u8C03\u7528 scene.createNode \u521B\u5EFA\u4E00\u4E2A directional-light \u6216 hemisphere-light"
    });
  }
  if (nodes.length > 0 && !hasCharacterOrPlayer) {
    issues.push({
      severity: "info",
      category: "playability",
      message: "\u5F53\u524D\u573A\u666F\u672A\u68C0\u6D4B\u5230\u5E26\u6709\u89D2\u8272\u63A7\u5236\u5668\u7684\u4E3B\u89D2\u8282\u70B9",
      hint: "\u5982\u4E3A\u53EF\u64CD\u63A7\u6E38\u620F\uFF0C\u5EFA\u8BAE\u914D\u7F6E\u89D2\u8272\u7EC4\u4EF6\u6216\u73A9\u5BB6\u6807\u7B7E"
    });
  }
  let shadowLights = 0;
  for (const node of nodes) {
    if ((node.kind === "directional-light" || node.kind === "spot-light" || node.kind === "point-light") && node.castShadow) {
      shadowLights += 1;
    }
  }
  if (shadowLights > budget.maxShadowLights) {
    issues.push({
      severity: "warning",
      category: "budget",
      message: `\u5B9E\u65F6\u9634\u5F71\u5149\u6E90\u6570\u91CF\u8FC7\u591A\uFF08\u5F53\u524D ${shadowLights} \u4E2A\uFF0C\u5EFA\u8BAE\u4E0D\u8D85\u8FC7 ${budget.maxShadowLights} \u4E2A\uFF09`,
      hint: "\u5173\u95ED\u6B21\u8981\u5149\u6E90\u7684 castShadow \u4EE5\u964D\u4F4E\u9634\u5F71\u6E32\u67D3\u5F00\u9500"
    });
  }
  const assetList = Object.values(assets);
  let assetBytes = 0;
  for (const asset of assetList) {
    if ("byteLength" in asset && typeof asset.byteLength === "number") {
      assetBytes += asset.byteLength;
    }
  }
  if (assetBytes > budget.maxAssetBytes) {
    issues.push({
      severity: "warning",
      category: "budget",
      message: `\u5DE5\u7A0B\u8D44\u4EA7\u603B\u4F53\u79EF\u8F83\u5927\uFF08${(assetBytes / (1024 * 1024)).toFixed(1)} MB\uFF0C\u9884\u7B97 ${(budget.maxAssetBytes / (1024 * 1024)).toFixed(0)} MB\uFF09`,
      hint: "\u5EFA\u8BAE\u538B\u7F29\u8D34\u56FE\u3001\u5F00\u542F Meshopt/KTX2 \u6216\u6E05\u7406\u672A\u5F15\u7528\u8D44\u4EA7"
    });
  }
  const renderMetrics = readMainRenderMetrics();
  if (renderMetrics) {
    if (renderMetrics.drawCalls > budget.maxDrawCalls) {
      issues.push({
        severity: renderMetrics.drawCalls > budget.maxDrawCalls * 2 ? "error" : "warning",
        category: "budget",
        message: `DrawCall \u8D85\u51FA\u9884\u7B97\uFF08\u5F53\u524D ${renderMetrics.drawCalls}\uFF0C\u9884\u7B97 ${budget.maxDrawCalls}\uFF09`,
        hint: "\u5EFA\u8BAE\u5408\u5E76\u9759\u6001\u7F51\u683C\u3001\u590D\u7528\u6750\u8D28\u6216\u51CF\u5C11\u52A8\u6001\u5149\u6E90\u6570\u91CF"
      });
    }
    if (renderMetrics.triangles > budget.maxTriangles) {
      issues.push({
        severity: renderMetrics.triangles > budget.maxTriangles * 2 ? "error" : "warning",
        category: "budget",
        message: `\u4E09\u89D2\u9762\u6570\u8D85\u51FA\u9884\u7B97\uFF08\u5F53\u524D ${renderMetrics.triangles}\uFF0C\u9884\u7B97 ${budget.maxTriangles}\uFF09`,
        hint: "\u5EFA\u8BAE\u5BF9\u8FDC\u666F\u6A21\u578B\u51CF\u9762\u6216\u66FF\u6362\u4F4E\u6A21"
      });
    }
  }
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    metrics: {
      nodeCount: nodes.length,
      assetCount: assetList.length,
      assetBytes,
      shadowLights,
      drawCalls: renderMetrics?.drawCalls,
      triangles: renderMetrics?.triangles,
      geometries: renderMetrics?.geometries,
      textures: renderMetrics?.textures
    }
  };
}

// src/playtest/session.ts
init_actionMap();
import { Group } from "three";
init_library();
init_store2();
init_sceneRuntime();
init_values();
init_world();
function captureLogCursor() {
  const logs = useEditorStore.getState().logs;
  return logs.length > 0 ? logs[logs.length - 1].id : null;
}
function readLogsSince(cursor) {
  const logs = useEditorStore.getState().logs;
  if (!cursor) return logs;
  const idx = logs.findIndex((item) => item.id === cursor);
  return idx >= 0 ? logs.slice(idx + 1) : logs;
}
function summarizeInfoLogs(logs, maxLines = 40) {
  const counts = /* @__PURE__ */ new Map();
  for (const item of logs) {
    if (item.level === "error" || item.level === "warn") continue;
    counts.set(item.message, (counts.get(item.message) ?? 0) + 1);
  }
  const lines = Array.from(counts.entries()).slice(0, maxLines).map(([message, n]) => {
    const text = message.length > 300 ? `${message.slice(0, 300)}\u2026` : message;
    return n > 1 ? `${text}\uFF08\u91CD\u590D ${n} \u6B21\uFF09` : text;
  });
  if (counts.size > maxLines) lines.push(`\u2026\u53E6\u6709 ${counts.size - maxLines} \u79CD\u4E0D\u540C\u65E5\u5FD7\u672A\u5217\u51FA`);
  return lines;
}
var PlaytestSession = class {
  active = false;
  startedFromStopped = false;
  elapsedSec = 0;
  stepsSimulated = 0;
  logCursor = null;
  sampler = null;
  screenshots = [];
  assertions = [];
  headlessObjects = /* @__PURE__ */ new Map();
  start(options) {
    const autoPlay = options?.autoPlayEditor !== false;
    const store = useEditorStore.getState();
    this.logCursor = captureLogCursor();
    this.elapsedSec = 0;
    this.stepsSimulated = 0;
    this.screenshots.length = 0;
    this.assertions.length = 0;
    this.headlessObjects.clear();
    clearAllVirtualInput();
    if (autoPlay && store.playState === "stopped") {
      this.startedFromStopped = true;
      store.play();
    } else {
      this.startedFromStopped = false;
    }
    this.active = true;
  }
  input(events) {
    injectVirtualInput(events);
  }
  step(seconds, fixedDt = 1 / 60) {
    if (!this.active) this.start();
    const total = Math.max(0, seconds);
    const dt = Math.max(1 / 240, Math.min(0.1, fixedDt));
    const count = Math.max(1, Math.round(total / dt));
    const bridge = getViewportBridge();
    for (let i = 0; i < count; i += 1) {
      if (bridge) {
        bridge.stepRuntime(dt);
      } else {
        stepSceneRuntime(dt, this.headlessHost());
      }
      this.elapsedSec += dt;
      this.stepsSimulated += 1;
      if (this.sampler && this.elapsedSec + 1e-6 >= this.sampler.next) {
        this.sampler.next += this.sampler.every;
        this.sampler.onSample(Number(this.elapsedSec.toFixed(3)));
      }
    }
  }
  read(query) {
    const world3 = getRuntimeWorld();
    const nodes = world3.getNodes();
    if (query.kind === "nodeCount") {
      return Object.keys(nodes).length;
    }
    if (query.kind === "uiVar") {
      return uiValues().variables[query.name];
    }
    if (query.kind === "logs") {
      const logs = readLogsSince(this.logCursor);
      const limit = query.limit ?? 30;
      return logs.slice(-limit);
    }
    if (query.kind === "metrics") {
      return readMainRenderMetrics();
    }
    const target = Object.values(nodes).find(
      (n) => n.id === query.nodeIdOrName || n.name === query.nodeIdOrName
    );
    if (!target) return null;
    const obj = getViewportBridge()?.resolveObject(target.id) ?? this.headlessObjects.get(target.id);
    if (obj) {
      const deg = 180 / Math.PI;
      const pose2 = {
        id: target.id,
        name: target.name,
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [obj.rotation.x * deg, obj.rotation.y * deg, obj.rotation.z * deg],
        visible: obj.visible
      };
      return pose2;
    }
    const pose = {
      id: target.id,
      name: target.name,
      position: [...target.position],
      rotation: [...target.rotation],
      visible: target.visible
    };
    return pose;
  }
  /** 每推进 everySec 游戏秒回调一次，用于采样节点轨迹等过程数据 */
  setSampler(everySec, onSample) {
    this.sampler = { every: Math.max(1 / 60, everySec), next: 0, onSample };
  }
  evaluateCondition(condition) {
    if (condition.kind === "elapsed") {
      return this.elapsedSec >= condition.seconds;
    }
    if (condition.kind === "logContains") {
      const logs = readLogsSince(this.logCursor);
      return logs.some((item) => item.message.includes(condition.text));
    }
    if (condition.kind === "nodeExists") {
      return Boolean(this.read({ kind: "nodePose", nodeIdOrName: condition.nodeIdOrName }));
    }
    if (condition.kind === "nodeMissing") {
      return !this.read({ kind: "nodePose", nodeIdOrName: condition.nodeIdOrName });
    }
    if (condition.kind === "uiVarEquals") {
      return this.read({ kind: "uiVar", name: condition.name }) === condition.value;
    }
    if (condition.kind === "nodeCountAtLeast") {
      return Number(this.read({ kind: "nodeCount" })) >= condition.min;
    }
    const pose = this.read({ kind: "nodePose", nodeIdOrName: condition.nodeIdOrName });
    if (!pose) return false;
    const dx = pose.position[0] - condition.from[0];
    const dy = pose.position[1] - condition.from[1];
    const dz = pose.position[2] - condition.from[2];
    return Math.hypot(dx, dy, dz) >= condition.minDistance;
  }
  waitFor(condition, timeoutSec = 5, fixedDt = 1 / 60) {
    const maxSteps = Math.max(1, Math.ceil(timeoutSec / fixedDt));
    for (let i = 0; i < maxSteps; i += 1) {
      if (this.evaluateCondition(condition)) return true;
      this.step(fixedDt, fixedDt);
    }
    return this.evaluateCondition(condition);
  }
  capture(options) {
    const dataUrl = captureMainViewport(options);
    if (dataUrl) this.screenshots.push(dataUrl);
    return dataUrl;
  }
  report(budget = DEFAULT_PERFORMANCE_BUDGET) {
    const logs = readLogsSince(this.logCursor);
    const errors = logs.filter((item) => item.level === "error").map((item) => item.message);
    const warnings = logs.filter((item) => item.level === "warn").map((item) => item.message);
    const infoLogs = summarizeInfoLogs(logs);
    const render = readMainRenderMetrics();
    const budgetNotes = [];
    let budgetPassed = true;
    if (render) {
      if (render.drawCalls > budget.maxDrawCalls) {
        budgetPassed = false;
        budgetNotes.push(`DrawCall=${render.drawCalls} \u8D85\u8FC7\u9884\u7B97 ${budget.maxDrawCalls}`);
      }
      if (render.triangles > budget.maxTriangles) {
        budgetPassed = false;
        budgetNotes.push(`Triangles=${render.triangles} \u8D85\u8FC7\u9884\u7B97 ${budget.maxTriangles}`);
      }
    }
    const assertionsOk = this.assertions.every((item) => item.passed);
    return {
      ok: errors.length === 0 && assertionsOk && budgetPassed,
      elapsedSec: Number(this.elapsedSec.toFixed(3)),
      stepsSimulated: this.stepsSimulated,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
      logs: infoLogs,
      screenshots: [...this.screenshots],
      assertions: [...this.assertions],
      metrics: {
        drawCalls: render?.drawCalls,
        triangles: render?.triangles,
        geometries: render?.geometries,
        textures: render?.textures,
        budgetPassed,
        budgetNotes
      }
    };
  }
  stop() {
    clearAllVirtualInput();
    if (this.startedFromStopped && useEditorStore.getState().playState !== "stopped") {
      useEditorStore.getState().stop();
    }
    this.active = false;
    this.startedFromStopped = false;
  }
  runSmoke(steps, options) {
    this.start();
    try {
      const effectiveSteps = steps.length > 0 ? steps : [{ action: "step", seconds: 0.5 }];
      for (const step2 of effectiveSteps) {
        if (step2.action === "input") {
          this.input(step2.events);
        } else if (step2.action === "uiClick") {
          const hit = findMountedUiButton(step2.target);
          if (hit && hit.click) {
            dispatchUiClick(hit.click, hit.id);
            this.assertions.push({ passed: true, message: `\u5DF2\u70B9\u51FB UI \u6309\u94AE "${hit.name || hit.text || hit.id}"` });
          } else {
            this.assertions.push({ passed: false, message: `\u672A\u627E\u5230\u53EF\u70B9\u51FB\u7684 UI \u6309\u94AE "${step2.target}"` });
          }
        } else if (step2.action === "step") {
          this.step(step2.seconds, step2.fixedDt);
        } else if (step2.action === "waitFor") {
          const ok = this.waitFor(step2.condition, step2.timeoutSec ?? 5);
          this.assertions.push({
            passed: ok,
            message: ok ? `\u7B49\u5F85\u6761\u4EF6\u6210\u7ACB: ${step2.condition.kind}` : `\u7B49\u5F85\u6761\u4EF6\u8D85\u65F6: ${step2.condition.kind}`
          });
        } else if (step2.action === "assert") {
          const ok = this.evaluateCondition(step2.condition);
          this.assertions.push({
            passed: ok,
            message: step2.message ?? (ok ? `\u65AD\u8A00\u901A\u8FC7: ${step2.condition.kind}` : `\u65AD\u8A00\u5931\u8D25: ${step2.condition.kind}`)
          });
        } else if (step2.action === "capture") {
          this.capture(step2.options);
        }
      }
      if (this.stepsSimulated === 0) {
        this.step(0.25);
      }
      return this.report(options?.budget);
    } finally {
      if (options?.autoStop !== false) {
        this.stop();
      }
    }
  }
  headlessHost() {
    return {
      ready: true,
      resolveObject: (id) => {
        const node = getRuntimeWorld().getNodes()[id];
        if (!node) return null;
        let obj = this.headlessObjects.get(id);
        if (!obj) {
          obj = new Group();
          obj.position.set(node.position[0], node.position[1], node.position[2]);
          obj.rotation.set(
            node.rotation[0] * Math.PI / 180,
            node.rotation[1] * Math.PI / 180,
            node.rotation[2] * Math.PI / 180
          );
          obj.scale.set(node.scale[0], node.scale[1], node.scale[2]);
          obj.visible = node.visible;
          this.headlessObjects.set(id, obj);
        }
        return obj;
      },
      updateAnimations: () => {
      },
      yaw: () => 0,
      pitch: () => 0
    };
  }
};
function findMountedUiButton(target) {
  const q = target.trim();
  if (!q) return null;
  const nodes = getRuntimeWorld().getNodes();
  const assets = useAssetStore.getState().assets;
  const searchNode = (node) => {
    if (node.type === "button" && node.click) {
      if (node.id === q || node.name === q || node.text === q || node.click.kind === "sendMessage" && node.click.message === q) {
        return node;
      }
    }
    for (const child of node.children ?? []) {
      const found = searchNode(child);
      if (found) return found;
    }
    return null;
  };
  for (const sceneNode of Object.values(nodes)) {
    if (sceneNode.kind !== "screen" || !sceneNode.visible || !sceneNode.screen?.documentId) continue;
    const asset = assets[sceneNode.screen.documentId];
    if (asset?.kind === "ui" && asset.document?.root) {
      const hit = searchNode(asset.document.root);
      if (hit) return hit;
    }
  }
  return null;
}

// tests/phase2-runtime.test.ts
init_world();
if (typeof globalThis.localStorage === "undefined") {
  const mem = /* @__PURE__ */ new Map();
  globalThis.localStorage = {
    get length() {
      return mem.size;
    },
    clear: () => mem.clear(),
    getItem: (key) => mem.get(key) ?? null,
    key: (index) => [...mem.keys()][index] ?? null,
    removeItem: (key) => {
      mem.delete(key);
    },
    setItem: (key, val) => {
      mem.set(key, String(val));
    }
  };
}
var storeModule = null;
async function getEditorStore() {
  storeModule ??= await Promise.resolve().then(() => (init_store2(), store_exports));
  return storeModule.useEditorStore;
}
test("InputActionMap \u89C4\u8303\u5316\u4E0E\u865A\u62DF\u8F93\u5165\u6CE8\u5165/\u5E27\u6D88\u8D39", () => {
  setInputActionMap(normalizeInputMap(DEFAULT_INPUT_MAP));
  clearAllVirtualInput();
  injectVirtualInput([
    { type: "axis", action: "Move", x: 0.8, y: -0.6 },
    { type: "actionDown", action: "Jump" }
  ]);
  const axis = getActionAxis2D("Move");
  assert.ok(Math.abs(axis.x - 0.8) < 1e-6);
  assert.ok(Math.abs(axis.y + 0.6) < 1e-6);
  assert.equal(isActionPressed("Jump"), true);
  assert.equal(wasActionTapped("Jump"), true);
  consumeInputFrame();
  assert.equal(wasActionTapped("Jump"), false);
  assert.equal(isActionPressed("Jump"), true);
  injectVirtualInput({ type: "actionUp", action: "Jump" });
  assert.equal(isActionPressed("Jump"), false);
  clearAllVirtualInput();
});
test("RuntimeWorld \u72EC\u7ACB\u8FD0\u884C\u65F6\u4E0E PlaytestSession \u5B9A\u6B65\u957F\u5192\u70DF\u6D4B\u8BD5", () => {
  const hero = {
    id: "hero-1",
    name: "Hero",
    kind: "capsule",
    parentId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    color: "#ffffff",
    roughness: 0.5,
    metalness: 0,
    assetId: null,
    materialAssetId: null,
    slots: [],
    castShadow: true,
    receiveShadow: true,
    gameplay: {
      character: {
        enabled: true,
        driver: "capsule",
        mode: "adventure",
        clickButton: "right",
        clickStop: 0.35,
        moveSpeed: 5,
        turnSpeed: 540,
        sprintMultiplier: 1.5,
        jumpSpeed: 6,
        maxJumps: 1,
        coyoteTime: 0.1,
        jumpBuffer: 0.1,
        gravity: 20,
        radius: 0.4,
        height: 1.8,
        capsuleOffset: [0, 0.9, 0],
        dash: false,
        dashKey: "KeyC",
        dashDistance: 4,
        dashDuration: 0.15,
        dashInvincible: 0.2,
        dashCooldown: 1,
        footstepDistance: 1.5,
        footstepJuice: "",
        lockTargetName: "",
        idleClip: "",
        idleClipAssetId: "",
        walkClip: "",
        walkClipAssetId: "",
        runClip: "",
        runClipAssetId: "",
        jumpClip: "",
        jumpClipAssetId: "",
        airClip: "",
        airClipAssetId: "",
        landClip: "",
        landClipAssetId: "",
        dodgeClip: "",
        dodgeClipAssetId: ""
      }
    }
  };
  let nodes = { "hero-1": hero };
  const standaloneWorld = {
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next;
    },
    updateNode: (id, patch) => {
      if (nodes[id]) nodes = { ...nodes, [id]: { ...nodes[id], ...patch } };
    },
    getActiveSceneId: () => "scene-1",
    getPicture: () => ({}),
    getCapabilities: () => ({}),
    getGameplayPacks: () => ["core"],
    getGameDatabase: () => ({ tables: {} }),
    getTags: () => [],
    getAsset: () => void 0,
    listAssets: () => [],
    getPlayState: () => "playing",
    markPlayDirty: () => {
    },
    log: () => {
    }
  };
  setRuntimeWorld(standaloneWorld);
  const session = new PlaytestSession();
  const report = session.runSmoke(
    [
      { action: "input", events: [{ type: "axis", action: "Move", x: 1, y: 0 }] },
      { action: "step", seconds: 0.5, fixedDt: 1 / 60 },
      {
        action: "assert",
        condition: { kind: "elapsed", seconds: 0.49 },
        message: "\u5B9A\u6B65\u957F\u63A8\u8FDB\u65F6\u957F\u5E94\u8FBE\u5230 0.5s"
      },
      {
        action: "assert",
        condition: { kind: "nodeExists", nodeIdOrName: "hero-1" },
        message: "\u4E3B\u89D2\u8282\u70B9\u5E94\u5B58\u5728"
      }
    ],
    { autoStop: false }
  );
  assert.equal(report.ok, true);
  assert.equal(report.stepsSimulated, 30);
  assert.equal(report.assertions.length, 2);
  assert.equal(report.assertions.every((a) => a.passed), true);
  session.stop();
});
test("diagnoseProject \u8FD4\u56DE\u6027\u80FD\u9884\u7B97 metrics \u7EDF\u8BA1", async () => {
  const useEditorStore2 = await getEditorStore();
  useEditorStore2.setState({
    nodes: {},
    capabilities: {},
    gameplayPacks: ["core"]
  });
  const report = diagnoseProject({
    maxDrawCalls: 500,
    maxTriangles: 3e5,
    maxShadowLights: 2,
    maxAssetBytes: 100 * 1024 * 1024
  });
  assert.ok(report.metrics);
  assert.equal(report.metrics?.nodeCount, 0);
  assert.equal(report.metrics?.shadowLights, 0);
});
