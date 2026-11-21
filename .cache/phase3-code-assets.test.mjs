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
    init_registry();
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
  const texture3 = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture3.colorSpace = NoColorSpace;
  texture3.wrapS = RepeatWrapping;
  texture3.wrapT = RepeatWrapping;
  texture3.minFilter = LinearMipmapLinearFilter;
  texture3.magFilter = LinearFilter;
  texture3.generateMipmaps = true;
  texture3.needsUpdate = true;
  cachedNormal = texture3;
  return texture3;
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
  const texture3 = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture3.colorSpace = NoColorSpace;
  texture3.wrapS = RepeatWrapping;
  texture3.wrapT = RepeatWrapping;
  texture3.minFilter = LinearMipmapLinearFilter;
  texture3.magFilter = LinearFilter;
  texture3.generateMipmaps = true;
  texture3.needsUpdate = true;
  cachedFoam = texture3;
  return texture3;
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
  const texture3 = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture3.colorSpace = NoColorSpace;
  texture3.wrapS = RepeatWrapping;
  texture3.wrapT = RepeatWrapping;
  texture3.minFilter = LinearMipmapLinearFilter;
  texture3.magFilter = LinearFilter;
  texture3.generateMipmaps = true;
  texture3.needsUpdate = true;
  cachedCaustics = texture3;
  return texture3;
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
    init_registry();
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
var init_defaults3 = __esm({
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
import { Color as Color3, OrthographicCamera } from "three";
import { mix as mix3, uniform as uniform2, vec4 as vec42 } from "three/tsl";
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
    init_session4();
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
      fogTint = uniform2(new Color3("#c9d6e6"));
      fogUseColor = uniform2(0);
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
        const flat = mix3(base.rgb, this.fogTint, amount.r);
        return vec42(mix3(skyFog.rgb, flat, this.fogUseColor), skyFog.a);
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
var session_exports3 = {};
__export(session_exports3, {
  composeSkyFog: () => composeSkyFog,
  dispose: () => dispose3,
  mount: () => mount3,
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
function mount3() {
  if (removeHook) return () => shutdown();
  removeHook = getRuntimeWorld().registerBeforeRenderHook?.("sky", 20, (ctx) => onBeforeRender2(ctx)) ?? null;
  return () => shutdown();
}
function dispose3() {
  shutdown();
}
function shutdown() {
  removeHook?.();
  removeHook = null;
  releaseSkyResources();
}
function onBeforeRender2(ctx) {
  pending = ctx;
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
  if (booting2 || !pending) return;
  booting2 = true;
  const token = ++bootToken;
  const ctx = pending;
  void Promise.resolve().then(() => (init_runtime(), runtime_exports)).then((module) => {
    if (token !== bootToken) return;
    booting2 = false;
    const runtime2 = getRuntimeWorld();
    if (!capabilityEnabled(runtime2.getCapabilities(), SKY_CAPABILITY_ID) || !pending) return;
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
      if (token !== bootToken || driver !== created || !pending) return;
      const latest = getRuntimeWorld();
      if (!capabilityEnabled(latest.getCapabilities(), SKY_CAPABILITY_ID)) return;
      created.sync(normalizeSkySettings(latest.getPicture().capabilities?.[SKY_CAPABILITY_ID]), pending.camera);
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
var ownsSlots, fogActive, fogApply, fogSignature, fogRevision, removeHook, driver, booting2, bootToken, pending, compiling;
var init_session4 = __esm({
  "src/capabilities/sky/session.ts"() {
    "use strict";
    init_registry();
    init_world();
    init_defaults3();
    ownsSlots = false;
    fogActive = false;
    fogApply = null;
    fogSignature = "";
    fogRevision = 0;
    removeHook = null;
    driver = null;
    booting2 = false;
    bootToken = 0;
    pending = null;
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
var init_registry = __esm({
  "src/capabilities/registry.ts"() {
    "use strict";
    CAPABILITIES = [
      { id: "physics", defaultEnabled: true, category: "physics" },
      { id: "buoyancy", defaultEnabled: true, category: "physics", dependencies: ["physics"], loadRuntime: () => Promise.resolve().then(() => (init_session3(), session_exports2)) },
      { id: "navigation", defaultEnabled: true, category: "physics" },
      { id: "particles", defaultEnabled: false, category: "scene-object" },
      { id: "sky", defaultEnabled: false, category: "environment", loadRuntime: () => Promise.resolve().then(() => (init_session4(), session_exports3)) },
      { id: "water", defaultEnabled: false, category: "environment", loadRuntime: () => Promise.resolve().then(() => (init_session2(), session_exports)) }
    ];
    dynamicCapabilities = /* @__PURE__ */ new Map();
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
  Color as Color4,
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
  mix as mix4,
  mod,
  modelWorldMatrix as modelWorldMatrix2,
  normalize as normalize2,
  positionGeometry as positionGeometry2,
  texture as texture2,
  uniform as uniform3,
  uv,
  vec2 as vec22,
  vec3 as vec32,
  vec4 as vec43
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
  const tint = uni(new Color4(source.color?.r ?? 1, source.color?.g ?? 1, source.color?.b ?? 1));
  const tintOpacity = uni(source.opacity ?? 1);
  const baseUv = tiledUv(uv(), uvTile, tiles);
  let sampled = vec43(1, 1, 1, 1);
  if (source.map) {
    const current = texture2(source.map, baseUv);
    if (settings.blendTiles) {
      const nextUv = tiledUv(uv(), floor(uvTile).add(1), tiles);
      sampled = mix4(current, texture2(source.map, nextUv), fract(uvTile));
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
  const sampled = map ? texture2(map, uv()) : vec43(1, 1, 1, 1);
  const color2 = source.color;
  const tint = uni(new Color4(color2?.r ?? 1, color2?.g ?? 1, color2?.b ?? 1));
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
  return uniform3(value);
}
function spriteClip(mode) {
  const offset = attr(PARTICLE_ATTR.offset, "vec3");
  const size = attr(PARTICLE_ATTR.size, "vec3");
  const world3 = modelWorldMatrix2.mul(vec43(offset, 1));
  if (mode === RenderMode.Mesh) return meshClip(offset, size);
  if (mode === RenderMode.Trail) return trailClip();
  const rotation = attr(PARTICLE_ATTR.rotation, "float");
  const aligned = vec22(positionGeometry2.x.mul(size.x), positionGeometry2.y.mul(size.y));
  const c = rotation.cos();
  const s = rotation.sin();
  const rotated = vec22(c.mul(aligned.x).sub(s.mul(aligned.y)), s.mul(aligned.x).add(c.mul(aligned.y)));
  if (mode === RenderMode.HorizontalBillBoard) {
    const shifted = vec43(world3.x.add(rotated.x), world3.y, world3.z.sub(rotated.y), world3.w);
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(shifted));
  }
  if (mode === RenderMode.VerticalBillBoard) {
    const raised = vec43(world3.x, world3.y.add(rotated.y), world3.z, world3.w);
    const view2 = cameraViewMatrix.mul(raised);
    return cameraProjectionMatrix.mul(vec43(view2.x.add(rotated.x), view2.y, view2.z, view2.w));
  }
  if (mode === RenderMode.StretchedBillBoard) return stretchedClip(world3, size);
  const view = cameraViewMatrix.mul(world3);
  return cameraProjectionMatrix.mul(vec43(view.x.add(rotated.x), view.y.add(rotated.y), view.z, view.w));
}
function stretchedClip(world3, size) {
  const velocity = attr(PARTICLE_ATTR.velocity, "vec4");
  const view = cameraViewMatrix.mul(world3);
  const viewVelocity = cameraViewMatrix.mul(vec43(velocity.x, velocity.y, velocity.z, 0)).xyz;
  const vlength = max2(length2(viewVelocity), float2(1e-4));
  const avg = size.x.add(size.y).mul(0.5);
  const side = normalize2(cross(view.xyz, viewVelocity));
  const stretched = view.xyz.add(side.mul(positionGeometry2.y).mul(avg)).sub(viewVelocity.mul(positionGeometry2.x.add(0.5)).mul(float2(1).add(velocity.w.div(vlength))).mul(avg));
  return cameraProjectionMatrix.mul(vec43(stretched, view.w));
}
function meshClip(offset, size) {
  const rotation = attr(PARTICLE_ATTR.rotation, "vec4");
  const scaled = vec32(positionGeometry2.x.mul(size.x), positionGeometry2.y.mul(size.y), positionGeometry2.z.mul(size.z));
  const spun = rotateByQuat(rotation, scaled);
  const local = vec43(spun.x.add(offset.x), spun.y.add(offset.y), spun.z.add(offset.z), 1);
  return cameraProjectionMatrix.mul(cameraViewMatrix.mul(modelWorldMatrix2.mul(local)));
}
function trailClip() {
  const previous = attr(PARTICLE_ATTR.previous, "vec3");
  const next = attr(PARTICLE_ATTR.next, "vec3");
  const side = attr(PARTICLE_ATTR.side, "float");
  const width = attr(PARTICLE_ATTR.width, "float");
  const world3 = modelWorldMatrix2.mul(vec43(positionGeometry2, 1)).xyz;
  const worldPrev = modelWorldMatrix2.mul(vec43(previous, 1)).xyz;
  const worldNext = modelWorldMatrix2.mul(vec43(next, 1)).xyz;
  const tangent = normalize2(worldNext.sub(worldPrev).add(vec32(0, 1e-4, 0)));
  const toCamera = normalize2(cameraPosition2.sub(world3));
  const binormal = normalize2(cross(tangent, toCamera));
  const placed = world3.add(binormal.mul(side).mul(width));
  return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec43(placed, 1)));
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

// tests/phase3-code-assets.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { Group } from "three";

// src/core/codeAssets/compiler.ts
import ts from "typescript";
function diagnosticHint(code, message) {
  if (message.includes("t3d/shader") || message.includes("t3d/runtime")) {
    return '\u8BF7\u786E\u4FDD\u4ECE "t3d/shader" \u6216 "t3d/runtime" \u5BFC\u5165\u767D\u540D\u5355 API';
  }
  if (code === 2304) return "\u5B58\u5728\u672A\u5B9A\u4E49\u7684\u6807\u8BC6\u7B26\uFF0C\u8BF7\u68C0\u67E5\u62FC\u5199\u6216\u4ECE t3d/runtime / t3d/shader \u5BFC\u5165";
  if (code === 2322 || code === 2345) return "\u7C7B\u578B\u4E0D\u5339\u914D\uFF0C\u8BF7\u68C0\u67E5\u53C2\u6570\u6216\u8FD4\u56DE\u503C\u7C7B\u578B\u662F\u5426\u7B26\u5408\u5951\u7EA6";
  return "\u8BF7\u6839\u636E\u62A5\u9519\u884C\u53F7\u4FEE\u6B63\u8BED\u6CD5\u6216\u7C7B\u578B\u9519\u8BEF";
}
function checkAndTranspileTs(fileName, source) {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    isolatedModules: true
  };
  const output = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions
  });
  const diagnostics = (output.diagnostics ?? []).map((diag) => {
    const start2 = diag.start ?? 0;
    const pos = diag.file ? diag.file.getLineAndCharacterOfPosition(start2) : { line: 0, character: 0 };
    const msg = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
    return {
      file: fileName,
      line: pos.line + 1,
      column: pos.character + 1,
      severity: diag.category === ts.DiagnosticCategory.Warning ? "warning" : "error",
      message: msg,
      hint: diagnosticHint(diag.code, msg)
    };
  });
  const hasError = diagnostics.some((d) => d.severity === "error");
  if (hasError) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    diagnostics,
    jsCode: output.outputText
  };
}
function evaluateTranspiledModule(fileName, jsCode, injectedModules) {
  const moduleObj = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier in injectedModules) {
      return injectedModules[specifier];
    }
    throw new Error(`\u4E0D\u5141\u8BB8\u5BFC\u5165\u672A\u6388\u6743\u6A21\u5757 "${specifier}"\uFF08\u4EC5\u5141\u8BB8 ${Object.keys(injectedModules).join(", ")}\uFF09`);
  };
  try {
    const fn = new Function("require", "module", "exports", jsCode);
    fn(customRequire, moduleObj, moduleObj.exports);
    const exported = moduleObj.exports.default ?? moduleObj.exports;
    return {
      ok: true,
      diagnostics: [],
      jsCode,
      exports: exported
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      diagnostics: [
        {
          file: fileName,
          line: 1,
          column: 1,
          severity: "error",
          message: `\u6A21\u5757\u6267\u884C\u5931\u8D25\uFF1A${message}`,
          hint: "\u8BF7\u68C0\u67E5\u9876\u5C42\u4EE3\u7801\u662F\u5426\u5B58\u5728\u8FD0\u884C\u65F6\u5F02\u5E38\u6216\u975E\u6CD5\u6A21\u5757\u5BFC\u5165"
        }
      ]
    };
  }
}

// src/capabilities/navigation/session.ts
init_registry();
init_transform();
init_world();
import { create } from "zustand";

// src/capabilities/navigation/archive.ts
var saved = /* @__PURE__ */ new Map();
var epoch = 0;
function navEpoch() {
  return epoch;
}
function navRecord(sceneId) {
  return saved.get(sceneId) ?? null;
}
function decodeBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// src/capabilities/navigation/session.ts
function tr(key, fallback) {
  return getRuntimeWorld().translate?.(key) ?? fallback;
}
var useNavUi = create(() => ({
  phase: "idle",
  text: "",
  sceneId: "",
  signature: "",
  triangles: 0
}));
var instance = null;
var opening = null;
var life = 0;
var loadedScene = "";
var seenEpoch = -1;
var activating = false;
var controller = null;
var pending2 = null;
var obstacleKey = "";
var debugMesh = null;
function cancelNavBake() {
  controller?.abort();
  controller = null;
  pending2 = null;
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
  pending2 = null;
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

// src/gameplay/registry.ts
var packs = /* @__PURE__ */ new Map();
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
function findRow(database, tableId, id) {
  const key = id.trim();
  if (!key) return void 0;
  return tableRows(database, tableId).find((row) => row.id === key);
}

// src/runtime/audio.ts
import { Audio, AudioListener, PositionalAudio } from "three";

// src/runtime/sceneRuntime.ts
init_session();

// src/capabilities/particles/session.ts
init_registry();
init_world();

// src/capabilities/particles/readQuarks.ts
var DEFAULT_APPEARANCE = {
  color: "#ff8c33",
  blend: "additive",
  opacity: 1,
  depthWrite: false,
  image: null
};
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

// src/capabilities/particles/session.ts
var runtime = null;
var loading = null;
var scene = null;
var generation = 0;
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

// src/gameplay/juiceClock.ts
var holdUntil = 0;
function scalePlayDt(dt, now = performance.now() / 1e3) {
  if (now < holdUntil) return 0;
  return dt;
}

// src/core/input/actionMap.ts
var DEFAULT_INPUT_MAP = {
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
function cloneDefaultMap() {
  return structuredClone(DEFAULT_INPUT_MAP);
}
var currentMap = cloneDefaultMap();
var physicalKeys = /* @__PURE__ */ new Set();
var virtualKeys = /* @__PURE__ */ new Set();
var tappedKeys = /* @__PURE__ */ new Set();
var virtualActions = /* @__PURE__ */ new Set();
var tappedActions = /* @__PURE__ */ new Set();
var virtualAxes = /* @__PURE__ */ new Map();
function isKeyHeld(code) {
  return physicalKeys.has(code) || virtualKeys.has(code);
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

// src/runtime/frameProfile.ts
var buckets = /* @__PURE__ */ new Map();
var capture = null;
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

// src/runtime/sceneRuntime.ts
var RUNTIME_STAGE = {
  PRE_PHYSICS: 10,
  PHYSICS_NAV: 50,
  POST_PHYSICS: 55,
  ANIMATION: 60,
  POST_ANIMATION: 70,
  PRE_RENDER: 80
};
var systems = [];
var postPhysicsSystems = [];
var postAnimationSystems = [];
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

// src/runtime/audio.ts
init_world();
var MAX_SFX = 32;
var buffers = /* @__PURE__ */ new Map();
var listener = null;
var voices = [];
var nextId = 1;
var musicId = 0;
var heardPlay = false;
var installed = false;
var DEFAULT_MIX = { master: 1, music: 0.8, sfx: 1 };
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
var emitters = /* @__PURE__ */ new Map();
var managed = /* @__PURE__ */ new Set();
var playTicket = 0;
var holdContext = false;
function ownsEmitter(id) {
  for (const current of emitters.values()) if (current.voice === id) return true;
  return false;
}
function ensureListener() {
  if (!listener) {
    listener = new AudioListener();
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
  const audio = options.parent ? new PositionalAudio(ear) : new Audio(ear);
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
var appliedMix = "";
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
var contextChain = Promise.resolve();
function settleContext(paused) {
  const ctx = listener?.context;
  if (!ctx) return;
  contextChain = contextChain.then(async () => {
    if (paused !== holdContext) return;
    if (paused && ctx.state === "running") await ctx.suspend();
    if (!paused && ctx.state === "suspended") await ctx.resume();
  }).catch(() => void 0);
}
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

// src/runtime/ui/bindings.ts
var EMPTY_UI_VALUES = { variables: {}, components: {}, screens: {} };

// src/runtime/ui/values.ts
var variables = {};
var components = {};
var screens = {};
var snapshot = EMPTY_UI_VALUES;
var listeners = /* @__PURE__ */ new Set();
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

// src/core/codeAssets/scriptRuntime.ts
init_world();

// src/core/schema/fieldSchema.ts
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
      return [...schema.default];
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

// src/core/codeAssets/scriptRuntime.ts
var compiledBehaviors = /* @__PURE__ */ new Map();
var compiledSystems = /* @__PURE__ */ new Map();
var instanceStates = /* @__PURE__ */ new Map();
var messageQueue = [];
var globalMemory = /* @__PURE__ */ new Map();
var persistentMemory = /* @__PURE__ */ new Map();
var simElapsed = 0;
function instanceKey2(nodeId, scriptId) {
  return `${nodeId}::${scriptId}`;
}
function toVec3Obj(tuple) {
  return { x: tuple[0], y: tuple[1], z: tuple[2] };
}
function makeNodeHandle(nodeId, host) {
  const world3 = getRuntimeWorld();
  const node = world3.getNodes()[nodeId];
  if (!node) return null;
  const obj = host.resolveObject(nodeId);
  const tags = [
    ...node.tagId ? [node.tagId] : [],
    ...node.tagIds ?? []
  ];
  return {
    get id() {
      return node.id;
    },
    get name() {
      return node.name;
    },
    get tags() {
      return tags;
    },
    get position() {
      return obj ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : toVec3Obj(node.position);
    },
    set position(val) {
      if (obj) obj.position.set(val.x, val.y, val.z);
      else world3.updateNode(nodeId, { position: [val.x, val.y, val.z] });
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
    },
    get scale() {
      return obj ? { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z } : toVec3Obj(node.scale);
    },
    set scale(val) {
      if (obj) obj.scale.set(val.x, val.y, val.z);
    },
    get visible() {
      return obj ? obj.visible : node.visible;
    },
    set visible(val) {
      if (obj) obj.visible = val;
      world3.updateNode(nodeId, { visible: val });
    },
    hasTag: (tag) => tags.includes(tag) || tags.some((t) => t.startsWith(`${tag}.`)),
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
      const next = { ...world3.getNodes() };
      delete next[nodeId];
      world3.setNodes(next);
    }
  };
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
    moveToward(target, maxDistance) {
      const cur = handle.position;
      const dx = target.x - cur.x;
      const dy = target.y - cur.y;
      const dz = target.z - cur.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist <= 1e-4 || dist <= maxDistance) {
        handle.position = { x: target.x, y: target.y, z: target.z };
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
    lookAt(target) {
      if (obj) obj.lookAt(target.x, target.y, target.z);
    },
    sendMessage(name, payload) {
      messageQueue.push({ targetNodeId: node.id, name, payload, senderId: node.id });
    },
    broadcast(name, payload) {
      messageQueue.push({ targetNodeId: null, name, payload, senderId: node.id });
    },
    getBehavior: (behavior) => handle.getBehavior(behavior),
    findNodeById: (id) => makeNodeHandle(id, host),
    findNodesByTag: (tag) => Object.values(world3.getNodes()).filter((n) => n.tagId === tag || n.tagIds?.includes(tag)).map((n) => makeNodeHandle(n.id, host)).filter(Boolean),
    findNodesInRadius: (center, radius, tag) => {
      const r2 = radius * radius;
      return Object.values(world3.getNodes()).filter((n) => {
        if (tag && n.tagId !== tag && !n.tagIds?.includes(tag)) return false;
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
    spawnPrefab: (prefabId, opts) => {
      const pos = opts?.position ? [opts.position.x, opts.position.y, opts.position.z] : [0, 0, 0];
      world3.instantiatePrefab?.(prefabId, { position: pos });
      return null;
    },
    destroyNode: (target) => {
      const next = { ...world3.getNodes() };
      delete next[target.id];
      world3.setNodes(next);
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
      sphereCast: () => [],
      getVelocity: () => ({ x: 0, y: 0, z: 0 }),
      setVelocity: () => {
      },
      applyImpulse: () => {
      },
      applyForce: () => {
      }
    },
    nav: {
      moveTo: (target) => {
        const cur = handle.position;
        const path = findNavigationPath([cur.x, cur.y, cur.z], [target.x, target.y, target.z]);
        return Boolean(path && path.length > 0);
      },
      stop: () => {
      },
      isMoving: false
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
        playSound({ assetId, bus: "sfx", volume: opts?.volume, playbackRate: opts?.pitch, parent: obj ?? void 0 });
      },
      playBgm: (assetId, opts) => {
        playSound({ assetId, bus: "music", volume: opts?.volume, loop: opts?.loop ?? true });
      },
      stopBgm: () => stopMusic()
    },
    fx: { spawn: () => {
    } },
    input: {
      isPressed: (action) => isActionPressed(action),
      justPressed: (action) => wasActionTapped(action),
      justReleased: () => false,
      axis1D: (action) => isActionPressed(action) ? 1 : 0,
      axis2D: (action) => getActionAxis2D(action)
    },
    ui: {
      getVar: (key) => uiValues().variables[key],
      setVar: (key, value) => writeUiVariable(key, value),
      onEvent: () => () => {
      }
    },
    scene: {
      currentId: () => world3.getActiveSceneId(),
      load: () => {
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
function createRuntimeSdk() {
  return {
    defineBehavior: (def) => ({ __t3dKind: "behavior", ...def }),
    defineSystem: (def) => ({ __t3dKind: "system", ...def })
  };
}
function compileAndRegisterScript(id, fileName, source) {
  const transpiled = checkAndTranspileTs(fileName, source);
  if (!transpiled.ok || !transpiled.jsCode) {
    return { ok: false, diagnostics: transpiled.diagnostics };
  }
  const evaluated = evaluateTranspiledModule(fileName, transpiled.jsCode, {
    "t3d/runtime": createRuntimeSdk()
  });
  if (!evaluated.ok || !evaluated.exports) {
    return { ok: false, diagnostics: evaluated.diagnostics };
  }
  const exp2 = evaluated.exports;
  if (exp2.__t3dKind === "system") {
    const def2 = exp2;
    const prev = compiledSystems.get(id);
    prev?.unregister();
    const baseOrder = def2.stage === "postAnimation" ? RUNTIME_STAGE.POST_ANIMATION : def2.stage === "postPhysics" ? RUNTIME_STAGE.PHYSICS_NAV + 5 : RUNTIME_STAGE.PRE_PHYSICS + 1;
    const unregister2 = registerRuntimeSystem(
      `script.${id}`,
      baseOrder + (def2.order ?? 0),
      (dt, host) => {
        if (getRuntimeWorld().getPlayState() !== "playing") return;
        def2.onUpdate?.({ host, elapsedTime: simElapsed }, dt);
      }
    );
    compiledSystems.set(id, { def: def2, unregister: unregister2 });
    return {
      ok: true,
      diagnostics: transpiled.diagnostics,
      jsCode: transpiled.jsCode,
      exports: { id, file: fileName, kind: "system", system: def2 }
    };
  }
  const def = exp2;
  if (exp2.__t3dKind !== "behavior" || typeof def.name !== "string" || !def.name.trim()) {
    return {
      ok: false,
      diagnostics: [
        {
          file: fileName,
          line: 1,
          column: 1,
          severity: "error",
          message: "\u811A\u672C\u5FC5\u987B\u901A\u8FC7 export default defineBehavior({ name, description, params, onUpdate }) \u6216 defineSystem(...) \u5BFC\u51FA",
          hint: '\u8BF7\u4ECE "t3d/runtime" \u5BFC\u5165 defineBehavior\uFF0C\u5E76\u63D0\u4F9B name\uFF08\u4E2D\u6587\u6807\u9898\uFF09\u3001description\uFF08\u4F5C\u7528\u8BF4\u660E\uFF09\u548C onUpdate(self, dt) \u56DE\u8C03\uFF1B\u4FEE\u6539\u4F4D\u7F6E\u8BF7\u6574\u4F53\u8D4B\u503C self.position = { x, y, z }'
        }
      ]
    };
  }
  compiledBehaviors.set(id, def);
  return {
    ok: true,
    diagnostics: transpiled.diagnostics,
    jsCode: transpiled.jsCode,
    exports: { id, file: fileName, kind: "behavior", behavior: def }
  };
}
function clearScriptRuntimeState() {
  instanceStates.clear();
  messageQueue.length = 0;
  globalMemory.clear();
  simElapsed = 0;
}
function stepProjectScripts(dt, host) {
  const world3 = getRuntimeWorld();
  if (world3.getPlayState() !== "playing") {
    clearScriptRuntimeState();
    return;
  }
  simElapsed += Math.max(0, dt);
  const nodes = world3.getNodes();
  const activeKeys = /* @__PURE__ */ new Set();
  for (const node of Object.values(nodes)) {
    const projectScripts = node.gameplay?.packs?.__project__;
    if (!projectScripts || typeof projectScripts !== "object") continue;
    for (const [scriptId, rawParams] of Object.entries(projectScripts)) {
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
  if (messageQueue.length > 0) {
    const batch = messageQueue.splice(0, messageQueue.length);
    for (const msg of batch) {
      for (const rec of instanceStates.values()) {
        if (msg.targetNodeId && msg.targetNodeId !== rec.nodeId) continue;
        const def = compiledBehaviors.get(rec.scriptId);
        const node = nodes[rec.nodeId];
        if (!def?.onMessage || !node) continue;
        const rawParams = node.gameplay?.packs?.__project__?.[rec.scriptId];
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
  for (const [key, rec] of instanceStates.entries()) {
    if (activeKeys.has(key)) continue;
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
registerRuntimeSystem("core.projectScripts", RUNTIME_STAGE.PRE_PHYSICS + 2, stepProjectScripts);

// src/core/codeAssets/shaderRuntime.ts
import { Color as Color5 } from "three";
import * as tsl from "three/tsl";
import { MeshBasicNodeMaterial as MeshBasicNodeMaterial3, MeshStandardNodeMaterial } from "three/webgpu";
function asNode(value) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value === "number") return tsl.float(value);
  if (typeof value === "boolean") return tsl.float(value ? 1 : 0);
  if (typeof value === "string") return tsl.color(new Color5(value));
  return value;
}
function paramToNode(schema, raw) {
  const value = raw !== void 0 ? raw : defaultForSchema(schema);
  if (schema.type === "number") return tsl.float(Number(value) || 0);
  if (schema.type === "boolean") return tsl.float(value ? 1 : 0);
  if (schema.type === "color") return tsl.color(new Color5(typeof value === "string" ? value : "#ffffff"));
  if (schema.type === "vec2") {
    const arr = Array.isArray(value) ? value : [0, 0];
    return tsl.vec2(Number(arr[0]) || 0, Number(arr[1]) || 0);
  }
  if (schema.type === "vec3") {
    const arr = Array.isArray(value) ? value : [0, 0, 0];
    return tsl.vec3(Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0);
  }
  if (schema.type === "vec4") {
    const arr = Array.isArray(value) ? value : [0, 0, 0, 1];
    return tsl.vec4(Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0, Number(arr[3]) ?? 1);
  }
  return value;
}
function createShaderSdk() {
  return {
    defineShader: (def) => def,
    float: (x = 0) => tsl.float(x),
    vec2: (x = 0, y = 0) => tsl.vec2(x, y),
    vec3: (x = 0, y = 0, z = 0) => tsl.vec3(x, y, z),
    vec4: (x = 0, y = 0, z = 0, w = 1) => tsl.vec4(x, y, z, w),
    color: (hexOrR, g, b) => typeof hexOrR === "string" ? tsl.color(new Color5(hexOrR)) : tsl.vec3(hexOrR, g ?? hexOrR, b ?? hexOrR),
    mix: (a, b, t) => tsl.mix(asNode(a), asNode(b), asNode(t)),
    clamp: (x, minVal, maxVal) => tsl.clamp(asNode(x), asNode(minVal), asNode(maxVal)),
    smoothstep: (edge0, edge1, x) => tsl.smoothstep(asNode(edge0), asNode(edge1), asNode(x)),
    step: (edge, x) => tsl.step(asNode(edge), asNode(x)),
    sin: (x) => tsl.sin(asNode(x)),
    cos: (x) => tsl.cos(asNode(x)),
    abs: (x) => tsl.abs(asNode(x)),
    floor: (x) => tsl.floor(asNode(x)),
    ceil: (x) => tsl.ceil(asNode(x)),
    fract: (x) => tsl.fract(asNode(x)),
    pow: (x, y) => tsl.pow(asNode(x), asNode(y)),
    sqrt: (x) => tsl.sqrt(asNode(x)),
    min: (a, b) => tsl.min(asNode(a), asNode(b)),
    max: (a, b) => tsl.max(asNode(a), asNode(b)),
    dot: (a, b) => tsl.dot(asNode(a), asNode(b)),
    cross: (a, b) => tsl.cross(asNode(a), asNode(b)),
    normalize: (v) => tsl.normalize(asNode(v)),
    length: (v) => tsl.length(asNode(v)),
    uv: (index = 0) => tsl.uv(index),
    time: tsl.time,
    normalView: tsl.normalView,
    normalWorld: tsl.normalWorld,
    positionWorld: tsl.positionWorld,
    positionLocal: tsl.positionLocal,
    viewDirection: tsl.positionViewDirection,
    texture: () => tsl.vec4(1, 1, 1, 1)
  };
}
function buildMaterialFromShader(def, overrides) {
  const paramValues = {};
  const runtimeParams = {};
  for (const [key, schema] of Object.entries(def.params ?? {})) {
    const val = overrides && key in overrides ? overrides[key] : defaultForSchema(schema);
    paramValues[key] = val;
    runtimeParams[key] = paramToNode(schema, val);
  }
  const out = def.surface(runtimeParams);
  const isUnlit = def.mode === "unlit";
  const material = isUnlit ? new MeshBasicNodeMaterial3() : new MeshStandardNodeMaterial();
  if (out.baseColor !== void 0) {
    ;
    material.colorNode = asNode(out.baseColor);
  }
  if (out.opacity !== void 0) {
    ;
    material.opacityNode = asNode(out.opacity);
  }
  if (out.vertexOffset !== void 0) {
    ;
    material.positionNode = tsl.positionLocal.add(asNode(out.vertexOffset));
  }
  if (!isUnlit && material instanceof MeshStandardNodeMaterial) {
    if (out.roughness !== void 0) material.roughnessNode = asNode(out.roughness);
    if (out.metalness !== void 0) material.metalnessNode = asNode(out.metalness);
    if (out.emissive !== void 0) material.emissiveNode = asNode(out.emissive);
    if (out.normal !== void 0) material.normalNode = asNode(out.normal);
  }
  if (def.transparent) material.transparent = true;
  if (def.doubleSided) material.side = 2;
  material.needsUpdate = true;
  return { material, paramValues };
}
function compileShaderSource(id, fileName, source, overrides) {
  const transpiled = checkAndTranspileTs(fileName, source);
  if (!transpiled.ok || !transpiled.jsCode) {
    return { ok: false, diagnostics: transpiled.diagnostics };
  }
  const sdk = createShaderSdk();
  const evaluated = evaluateTranspiledModule(fileName, transpiled.jsCode, {
    "t3d/shader": sdk
  });
  if (!evaluated.ok || !evaluated.exports || typeof evaluated.exports.surface !== "function") {
    return {
      ok: false,
      diagnostics: evaluated.diagnostics.length ? evaluated.diagnostics : [
        {
          file: fileName,
          line: 1,
          column: 1,
          severity: "error",
          message: "\u7740\u8272\u5668\u5FC5\u987B\u901A\u8FC7 export default defineShader({ ... }) \u5BFC\u51FA",
          hint: "\u8BF7\u68C0\u67E5\u9ED8\u8BA4\u5BFC\u51FA\u662F\u5426\u5305\u542B name\u3001params \u548C surface \u51FD\u6570"
        }
      ]
    };
  }
  try {
    const { material, paramValues } = buildMaterialFromShader(evaluated.exports, overrides);
    return {
      ok: true,
      diagnostics: transpiled.diagnostics,
      jsCode: transpiled.jsCode,
      exports: {
        id,
        file: fileName,
        definition: evaluated.exports,
        material,
        paramValues
      }
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      diagnostics: [
        {
          file: fileName,
          line: 1,
          column: 1,
          severity: "error",
          message: `TSL \u7740\u8272\u5668\u6784\u5EFA\u5931\u8D25\uFF1A${msg}`,
          hint: "\u8BF7\u68C0\u67E5 surface() \u8FD4\u56DE\u7684\u8282\u70B9\u7C7B\u578B\u53CA\u8FD0\u7B97\u53C2\u6570"
        }
      ]
    };
  }
}

// tests/phase3-code-assets.test.ts
init_world();
test("checkAndTranspileTs \u8FD4\u56DE\u7EDF\u4E00\u8BCA\u65AD\u683C\u5F0F", () => {
  const bad = checkAndTranspileTs("scripts/broken.ts", "export const x = ;");
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.length > 0);
  assert.equal(bad.diagnostics[0].file, "scripts/broken.ts");
  assert.equal(bad.diagnostics[0].severity, "error");
  assert.ok(bad.diagnostics[0].line >= 1);
});
test("compileShaderSource \u7F16\u8BD1 TSL \u7740\u8272\u5668\u5E76\u751F\u6210 NodeMaterial", () => {
  const shaderCode = `
    import { defineShader, mix, sin, time, uv } from 't3d/shader'
    export default defineShader({
      name: 'Pulse',
      mode: 'lit',
      params: {
        a: { type: 'color', default: '#ff0000', label: 'Color A' },
        b: { type: 'color', default: '#00ff00', label: 'Color B' },
        speed: { type: 'number', default: 2, label: 'Speed' },
      },
      surface(p) {
        const t = sin(uv().x.add(time.mul(p.speed))).mul(0.5).add(0.5)
        return { baseColor: mix(p.a, p.b, t), roughness: 0.4, metalness: 0.2 }
      },
    })
  `;
  const res = compileShaderSource("pulse", "shaders/pulse.shader.ts", shaderCode, { speed: 4 });
  assert.equal(res.ok, true);
  assert.ok(res.exports?.material);
  assert.equal(res.exports?.paramValues.speed, 4);
});
test("compileAndRegisterScript \u6302\u8F7D __project__ \u69FD\u4F4D\u5E76\u652F\u6301\u70ED\u91CD\u8F7D\u4FDD\u7559 self.state", () => {
  clearScriptRuntimeState();
  const v1 = `
    import { defineBehavior } from 't3d/runtime'
    export default defineBehavior({
      name: 'Counter',
      params: { step: { type: 'number', default: 1, label: 'Step' } },
      state: () => ({ count: 0 }),
      onUpdate(self) {
        self.state.count += self.params.step
      },
    })
  `;
  const r1 = compileAndRegisterScript("counter", "scripts/counter.ts", v1);
  assert.equal(r1.ok, true);
  const nodeObj = new Group();
  const nodes = {
    "n-1": {
      id: "n-1",
      name: "CounterNode",
      kind: "box",
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
      castShadow: false,
      receiveShadow: true,
      gameplay: {
        packs: {
          __project__: {
            counter: { step: 2 }
          }
        }
      }
    }
  };
  let lastCountLog = "";
  const world3 = {
    getNodes: () => nodes,
    setNodes: () => {
    },
    updateNode: () => {
    },
    getActiveSceneId: () => "default",
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
    log: (_lvl, msg) => {
      lastCountLog = msg;
    }
  };
  setRuntimeWorld(world3);
  const host = {
    ready: true,
    resolveObject: (id) => id === "n-1" ? nodeObj : null,
    updateAnimations: () => {
    }
  };
  stepSceneRuntime(1 / 60, host);
  stepSceneRuntime(1 / 60, host);
  const v2 = `
    import { defineBehavior } from 't3d/runtime'
    export default defineBehavior({
      name: 'Counter',
      params: { step: { type: 'number', default: 1, label: 'Step' } },
      state: () => ({ count: 0 }),
      onUpdate(self) {
        self.state.count += 10
        self.log('count=' + self.state.count)
      },
    })
  `;
  const r2 = compileAndRegisterScript("counter", "scripts/counter.ts", v2);
  assert.equal(r2.ok, true);
  stepSceneRuntime(1 / 60, host);
  assert.equal(lastCountLog, "count=14");
  clearScriptRuntimeState();
});
