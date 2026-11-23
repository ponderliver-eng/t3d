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
function registerPhysicsExtension(id, order, step) {
  const index = extensions.findIndex((item) => item.id === id);
  if (index >= 0) extensions.splice(index, 1);
  extensions.push({ id, order, step });
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
function finite(value, fallback, min2, max3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max3, Math.max(min2, value));
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
  const length3 = (a.length + b.length) / 2;
  const k = Math.PI * 2 / length3;
  const speed = Math.sqrt(GRAVITY / k);
  return {
    crestSpeed: speed,
    overtake: speed * PACKET_OVERTAKE,
    kAlong: Math.PI * 2 / (length3 * PACKET_SPACING),
    kAcross: Math.PI * 2 / (length3 * PACKET_WIDTH)
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
    setTime(time, waveTime, swellTime) {
      uSwellTime.value = swellTime;
      uTime.value = time;
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
    setSun(direction, color, intensity, skyHorizon, skyTop) {
      uSunDir.value.copy(direction).normalize();
      const boost = Math.min(2, Math.max(0.2, intensity));
      uSunColor.value.copy(color).multiplyScalar(boost);
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
  for (const [step, count2] of FOLLOW_GRID.bands) {
    for (let i = 0; i < count2; i += 1) {
      at += step;
      half.push({ at, step });
    }
    lastStep = step;
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
function clamp2(value, min2, max3) {
  return Math.max(min2, Math.min(max3, value));
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
    pointAtDistance: (distance) => rawPointAt(distanceToU(distance)),
    tangentAtDistance: (distance) => tangentFromU(distanceToU(distance))
  };
}
var init_motion = __esm({
  "src/runtime/motion.ts"() {
    "use strict";
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
  const color = source.color;
  const tint = uni(new Color3(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1));
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
var init_session4 = __esm({
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
var holdUntil;
var init_juiceClock = __esm({
  "src/gameplay/juiceClock.ts"() {
    "use strict";
    holdUntil = 0;
  }
});

// src/core/input/actionMap.ts
function cloneDefaultMap() {
  return structuredClone(DEFAULT_INPUT_MAP);
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
function registerRuntimeSystem(id, order, step) {
  const target = order >= RUNTIME_STAGE.POST_ANIMATION ? postAnimationSystems : order >= RUNTIME_STAGE.PHYSICS_NAV ? postPhysicsSystems : systems;
  const index = target.findIndex((item) => item.id === id);
  if (index >= 0) target.splice(index, 1);
  target.push({ id, order, step });
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
    init_session10();
    init_session4();
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
      const tan = agent.spline.tangentAtDistance(nextDist);
      const tx = tan.x * agent.direction;
      const tz = tan.z * agent.direction;
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
var init_session5 = __esm({
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
var init_session6 = __esm({
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
  const cos2 = Math.cos(yaw);
  const sin2 = Math.sin(yaw);
  const rotateOffset = (lx, lz) => ({
    x: center.x + lx * cos2 + lz * sin2,
    y: center.y,
    z: center.z - lx * sin2 + lz * cos2
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
var init_session7 = __esm({
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
var init_types = __esm({
  "src/gameplay/types.ts"() {
    "use strict";
  }
});

// src/gameplay/registry.ts
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
var init_session8 = __esm({
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
function clamp3(value, fallback, min2, max3) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max3, Math.max(min2, next));
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
    init_session9();
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
var init_session9 = __esm({
  "src/capabilities/sky/session.ts"() {
    "use strict";
    init_registry2();
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
var init_registry2 = __esm({
  "src/capabilities/registry.ts"() {
    "use strict";
    CAPABILITIES = [
      { id: "physics", defaultEnabled: true, category: "physics" },
      { id: "buoyancy", defaultEnabled: true, category: "physics", dependencies: ["physics"], loadRuntime: () => Promise.resolve().then(() => (init_session3(), session_exports2)) },
      { id: "navigation", defaultEnabled: true, category: "physics" },
      { id: "spline", defaultEnabled: true, category: "animation", loadRuntime: () => Promise.resolve().then(() => (init_session5(), session_exports3)) },
      { id: "tween", defaultEnabled: true, category: "animation", loadRuntime: () => Promise.resolve().then(() => (init_session6(), session_exports4)) },
      { id: "crowd", defaultEnabled: true, category: "physics", loadRuntime: () => Promise.resolve().then(() => (init_session7(), session_exports5)) },
      { id: "projectile", defaultEnabled: true, category: "physics", loadRuntime: () => Promise.resolve().then(() => (init_session8(), session_exports6)) },
      { id: "particles", defaultEnabled: false, category: "scene-object" },
      { id: "sky", defaultEnabled: false, category: "environment", loadRuntime: () => Promise.resolve().then(() => (init_session9(), session_exports7)) },
      { id: "water", defaultEnabled: false, category: "environment", loadRuntime: () => Promise.resolve().then(() => (init_session2(), session_exports)) }
    ];
    dynamicCapabilities = /* @__PURE__ */ new Map();
  }
});

// src/capabilities/navigation/archive.ts
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
var saved, epoch;
var init_archive = __esm({
  "src/capabilities/navigation/archive.ts"() {
    "use strict";
    saved = /* @__PURE__ */ new Map();
    epoch = 0;
  }
});

// src/capabilities/navigation/defaults.ts
var init_defaults4 = __esm({
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
        for (let step = 0; step < 8; step += 1) {
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
var useNavUi, instance, opening, life, loadedScene, seenEpoch, activating, controller, pending2, obstacleKey, debugMesh;
var init_session10 = __esm({
  "src/capabilities/navigation/session.ts"() {
    "use strict";
    init_registry2();
    init_transform();
    init_world();
    init_archive();
    init_defaults4();
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
    pending2 = null;
    obstacleKey = "";
    debugMesh = null;
  }
});

// tests/ai-knowledge.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { Group } from "three";

// src/core/codeAssets/scriptRuntime.ts
init_session10();
init_runtimeTags();
init_session7();
init_session8();
init_session();
init_registry();
import { Vector3 as Vector39 } from "three";

// src/runtime/audio.ts
init_sceneRuntime();
init_world();
import { Audio, AudioListener, PositionalAudio } from "three";
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
  const mix5 = readAudioMix(latestWorld.getPicture());
  applyMix(mix5);
  const bus = options.bus ?? "sfx";
  if (bus === "sfx") trimSfx();
  const ear = ensureListener();
  const audio = options.parent ? guardAudioMatrixUpdate(new PositionalAudio(ear)) : new Audio(ear);
  audio.setBuffer(buffer);
  audio.setLoop(options.loop === true);
  const local = clamp4(options.volume ?? 1, 0, 4);
  audio.setVolume(local * (bus === "music" ? mix5.music : mix5.sfx));
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
var appliedMix = "";
function applyMix(mix5) {
  const key = `${mix5.master}|${mix5.music}|${mix5.sfx}`;
  if (key === appliedMix) return;
  appliedMix = key;
  const ear = listener;
  if (ear) ear.gain.gain.value = mix5.master;
  for (const voice of voices) {
    voice.audio.setVolume(voice.local * (voice.bus === "music" ? mix5.music : mix5.sfx));
  }
}
function unit(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? clamp4(number, 0, 1) : fallback;
}
function clamp4(value, min2, max3) {
  return Math.min(max3, Math.max(min2, value));
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

// src/core/codeAssets/scriptRuntime.ts
init_frameProfile();
init_motion();
init_sceneRuntime();

// src/runtime/ui/bindings.ts
var EMPTY_UI_VALUES = { variables: {}, components: {}, screens: {} };

// src/runtime/ui/values.ts
var variables = {};
var components = {};
var screens = {};
var snapshot = EMPTY_UI_VALUES;
var listeners = /* @__PURE__ */ new Set();
var clickListeners = /* @__PURE__ */ new Set();
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
function onUiClick(listener2) {
  clickListeners.add(listener2);
  return () => clickListeners.delete(listener2);
}

// src/core/codeAssets/scriptRuntime.ts
init_world();
init_actionMap();
init_fieldSchema();

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

// src/core/codeAssets/scriptRuntime.ts
var compiledBehaviors = /* @__PURE__ */ new Map();
var compiledSystems = /* @__PURE__ */ new Map();
var instanceStates = /* @__PURE__ */ new Map();
var messageQueue = [];
var uiEventHandlers = /* @__PURE__ */ new Map();
var uiEventQueue = [];
var uiClickSubscribed = false;
var globalMemory = /* @__PURE__ */ new Map();
var persistentMemory = /* @__PURE__ */ new Map();
var navAgents = /* @__PURE__ */ new Map();
var pooledInactive = /* @__PURE__ */ new Set();
var nodePoolKey = /* @__PURE__ */ new Map();
var poolBuckets = /* @__PURE__ */ new Map();
var scriptTimers = /* @__PURE__ */ new Map();
var splineFollowAgents = /* @__PURE__ */ new Map();
var activeTweens = /* @__PURE__ */ new Map();
var sfxCooldownAt = /* @__PURE__ */ new Map();
var nextTimerId = 1;
var nextTweenId = 1;
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
var simElapsed = 0;
var framePointerDelta = { x: 0, y: 0 };
var framePointerPos = { x: 0, y: 0 };
var frameWheelDelta = 0;
var prevMouseButtons = 0;
var currMouseButtons = 0;
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
        const v = new Vector39(lx, ly, lz).applyMatrix4(pathObj.matrixWorld);
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
  const subtreeIds = [];
  const collectSubtree = (id) => {
    subtreeIds.push(id);
    for (const candidate of Object.values(nodes)) {
      if (candidate.parentId === id) collectSubtree(candidate.id);
    }
  };
  collectSubtree(nodeId);
  for (const subId of subtreeIds) {
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
    const baseOrder = def2.stage === "preRender" ? RUNTIME_STAGE.PRE_RENDER - 1 : def2.stage === "postAnimation" ? RUNTIME_STAGE.POST_ANIMATION : def2.stage === "postPhysics" ? RUNTIME_STAGE.PHYSICS_NAV + 5 : RUNTIME_STAGE.PRE_PHYSICS + 1;
    const sysEntry = {
      def: def2,
      mounted: false,
      state: def2.createState ? { ...def2.createState() } : def2.state ? { ...def2.state() } : {},
      unregister: () => {
      }
    };
    const unregister4 = registerRuntimeSystem(
      `script.${id}`,
      baseOrder + (def2.order ?? 0),
      (dt, host) => {
        if (getRuntimeWorld().getPlayState() !== "playing") return;
        const api = buildSystemWorldApi(id, host);
        try {
          if (!sysEntry.mounted) {
            sysEntry.mounted = true;
            sysEntry.state = def2.createState ? { ...def2.createState() } : def2.state ? { ...def2.state() } : {};
            def2.onMount?.(api, sysEntry.state);
            def2.onInit?.(api, sysEntry.state);
          }
          def2.onStep?.(api, sysEntry.state, dt);
          def2.onUpdate?.(api, sysEntry.state, dt);
        } catch (error) {
          getRuntimeWorld().log("error", `\u7CFB\u7EDF "${def2.name}" \u8FD0\u884C\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
    sysEntry.unregister = unregister4;
    compiledSystems.set(id, sysEntry);
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
function viewRelativeMove(action, host) {
  const axis = getActionAxis2D(action);
  const length3 = Math.hypot(axis.x, axis.y);
  if (length3 < 1e-4) return { x: 0, y: 0, z: 0 };
  const scale = length3 > 1 ? 1 / length3 : 1;
  const yaw = host.yaw?.() ?? 0;
  const sin2 = Math.sin(yaw);
  const cos2 = Math.cos(yaw);
  return {
    x: (axis.x * cos2 - axis.y * sin2) * scale,
    y: 0,
    z: (-axis.x * sin2 - axis.y * cos2) * scale
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
        const tan = ag.spline.tangentAtDistance(nextDist);
        const tx = tan.x * ag.direction;
        const tz = tan.z * ag.direction;
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
registerRuntimeSystem("core.projectScripts", RUNTIME_STAGE.PRE_PHYSICS + 2, stepProjectScripts);

// src/core/codeAssets/scriptLint.ts
function lineColumnAt(source, index) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline };
}
function lintScriptSource(source, file = "script.ts") {
  const issues = [];
  const text = String(source ?? "");
  if (!text.trim()) return issues;
  if (!/\bdefine(?:Behavior|System)\s*\(/.test(text)) {
    issues.push({
      file,
      severity: "error",
      line: 1,
      column: 1,
      message: '[T3D\u89C4\u8303] \u811A\u672C\u5FC5\u987B\u4ECE "t3d/runtime" \u5BFC\u5165\u5E76\u4F7F\u7528 export default defineBehavior(...) \u6216 defineSystem(...)',
      hint: '\u6DFB\u52A0 import { defineBehavior } from "t3d/runtime" \u5E76\u5BFC\u51FA export default defineBehavior({ ... })'
    });
  }
  const vecAssignRe = /\bself\.(position|rotation|scale)\.[xyz]\s*(?:[+\-*/%]?=|\+\+|--)(?!=)/g;
  let match;
  while ((match = vecAssignRe.exec(text)) !== null) {
    const pos = lineColumnAt(text, match.index);
    issues.push({
      file,
      severity: "error",
      line: pos.line,
      column: pos.column,
      message: `[T3D\u89C4\u8303] \u7981\u6B62\u76F4\u63A5\u4FEE\u6539 self.${match[1]} \u7684\u5355\u4E2A\u5206\u91CF\uFF08${match[0].trim()}\uFF09\uFF0C\u5FC5\u987B\u6574\u4F53\u8D4B\u503C`,
      hint: `\u6539\u4E3A\u6574\u4F53\u8D4B\u503C\uFF0C\u4F8B\u5982\uFF1Aself.${match[1]} = { ...self.${match[1]}, x: ... }`
    });
  }
  const wrongNodeHandleRe = /\b(?!self\b)([a-zA-Z_$][\w$]*)\.node\.(addTag|removeTag|hasTag|position|rotation|scale|destroy|sendMessage|getChildren|visible|name)\b/g;
  while ((match = wrongNodeHandleRe.exec(text)) !== null) {
    const pos = lineColumnAt(text, match.index);
    issues.push({
      file,
      severity: "error",
      line: pos.line,
      column: pos.column,
      message: `[T3D\u89C4\u8303] pool.acquire / cloneNode / spawnPrefab / findNodeById \u8FD4\u56DE\u7684\u76F4\u63A5\u5C31\u662F NodeHandle`,
      hint: `\u8BF7\u76F4\u63A5\u5199 ${match[1]}.${match[2]}\uFF0C\u4E0D\u8981\u5199 ${match[1]}.node.${match[2]}`
    });
  }
  const forbiddenGlobalRe = /(?:^|[^\w$.])(window|document|localStorage|sessionStorage)\s*\./gm;
  while ((match = forbiddenGlobalRe.exec(text)) !== null) {
    const idx = match.index + match[0].indexOf(match[1]);
    const pos = lineColumnAt(text, idx);
    issues.push({
      file,
      severity: "error",
      line: pos.line,
      column: pos.column,
      message: `[T3D\u89C4\u8303] \u4E25\u7981\u76F4\u63A5\u8BBF\u95EE\u6D4F\u89C8\u5668\u5168\u5C40\u5BF9\u8C61 "${match[1]}"`,
      hint: "\u8BF7\u6539\u7528 self.input / self.storage / self.ui \u7B49\u8FD0\u884C\u65F6\u63A5\u53E3"
    });
  }
  const paramsBlockMatch = /\bparams\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(text);
  if (paramsBlockMatch) {
    const blockBody = paramsBlockMatch[1];
    const bodyStartIdx = paramsBlockMatch.index + paramsBlockMatch[0].length;
    const restText = text.slice(bodyStartIdx);
    const keyRe = /^\s*([a-zA-Z_$][\w$]*)\s*:\s*\{/gm;
    let keyMatch;
    while ((keyMatch = keyRe.exec(blockBody)) !== null) {
      const keyName = keyMatch[1];
      const usedRe = new RegExp(`\\b${keyName}\\b`);
      if (!usedRe.test(restText)) {
        const pos = lineColumnAt(text, paramsBlockMatch.index + keyMatch.index);
        issues.push({
          file,
          severity: "warning",
          line: pos.line,
          column: pos.column,
          message: `[T3D\u63D0\u793A] \u58F0\u660E\u4E86\u53C2\u6570 "${keyName}" \u4F46\u811A\u672C\u903B\u8F91\u4E2D\u5C1A\u672A\u4F7F\u7528`,
          hint: `\u8BF7\u68C0\u67E5\u662F\u5426\u9057\u6F0F\u4E86 self.params.${keyName}`
        });
      }
    }
    const refLikeKeyRe = /(?:^|_)(?:node|target|parent|spawn|path|prefab|model|clip|anim|animation|audio|sfx|bgm|sound|effect|fx|material|texture|tex|ui|screen|scene|asset)(?:Id|Ref|Asset)?$/i;
    const stringParamRe = /^\s*([a-zA-Z_$][\w$]*)\s*:\s*\{[^}]*\btype\s*:\s*['"]string['"]/gm;
    let strMatch;
    while ((strMatch = stringParamRe.exec(blockBody)) !== null) {
      const keyName = strMatch[1];
      if (!refLikeKeyRe.test(keyName)) continue;
      const lower = keyName.toLowerCase();
      let suggest = `{ type: 'ref', target: 'asset', label: '...', default: null }`;
      if (lower.includes("clip") || lower.includes("anim")) {
        suggest = `{ type: 'ref', target: 'clip', label: '...', default: null }`;
      } else if (lower.includes("tex")) {
        suggest = `{ type: 'texture', label: '...', default: null }`;
      } else if (lower.includes("node") || lower.includes("target") || lower.includes("parent") || lower.includes("spawn") || lower.includes("path")) {
        suggest = `{ type: 'ref', target: 'node', label: '...', default: null }`;
      } else if (lower.includes("prefab")) {
        suggest = `{ type: 'ref', target: 'asset', kinds: ['prefab'], label: '...', default: null }`;
      } else if (lower.includes("audio") || lower.includes("sfx") || lower.includes("bgm") || lower.includes("sound")) {
        suggest = `{ type: 'ref', target: 'asset', kinds: ['audio'], label: '...', default: null }`;
      } else if (lower.includes("effect") || lower.includes("fx")) {
        suggest = `{ type: 'ref', target: 'asset', kinds: ['effect'], label: '...', default: null }`;
      }
      const pos = lineColumnAt(text, paramsBlockMatch.index + strMatch.index);
      issues.push({
        file,
        severity: "warning",
        line: pos.line,
        column: pos.column,
        message: `[T3D\u89C4\u8303] \u53C2\u6570 "${keyName}" \u770B\u8D77\u6765\u662F\u8D44\u6E90\u6216\u8282\u70B9\u5F15\u7528\uFF0C\u8BF7\u52FF\u4F7F\u7528 type: "string" \u624B\u586B ID`,
        hint: `\u8BF7\u6539\u4E3A ${suggest}\uFF0C\u4EE5\u4FBF\u5C5E\u6027\u9762\u677F\u6E32\u67D3\u4E3A\u5F39\u7A97\u9009\u62E9\u5668\u4E0E\u62D6\u653E\u69FD\u4F4D`
      });
    }
  }
  return issues;
}

// tests/ai-knowledge.test.ts
init_actionMap();
init_sceneRuntime();
init_world();

// src/ai/knowledge/recipes.ts
var THIRD_PERSON_CONTROLLER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u7B2C\u4E09\u4EBA\u79F0\u89D2\u8272\u63A7\u5236",
  description: "WASD \u76F8\u5BF9\u76F8\u673A\u79FB\u52A8\u3001\u7A7A\u683C\u8DF3\u8DC3\u3001Shift \u5954\u8DD1\uFF0C\u5E76\u6309\u901F\u5EA6\u5207\u6362\u5F85\u673A/\u884C\u8D70/\u5954\u8DD1\u52A8\u753B",
  params: {
    idleClip: { type: "ref", target: "clip", label: "\u5F85\u673A\u526A\u8F91", default: null },
    walkClip: { type: "ref", target: "clip", label: "\u884C\u8D70\u526A\u8F91", default: null },
    runClip: { type: "ref", target: "clip", label: "\u5954\u8DD1\u526A\u8F91", default: null },
    walkSpeed: { type: "number", label: "\u884C\u8D70\u901F\u5EA6", default: 3.2 },
    runSpeed: { type: "number", label: "\u5954\u8DD1\u901F\u5EA6", default: 6.5 },
    turnSpeed: { type: "number", label: "\u8F6C\u8EAB\u901F\u5EA6", default: 12 },
    jumpSpeed: { type: "number", label: "\u8DF3\u8DC3\u521D\u901F", default: 5.2 },
    gravity: { type: "number", label: "\u91CD\u529B\u52A0\u901F\u5EA6", default: 14 },
    groundY: { type: "number", label: "\u5730\u9762\u9AD8\u5EA6", default: 0 },
  },
  state: () => ({ velY: 0, grounded: true, clip: "" }),
  onStart(self) {
    self.addTag("player")
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    const pos = self.position

    // 1) \u8F93\u5165\uFF1AmoveDirection \u76F4\u63A5\u7ED9\u51FA\u300C\u76F8\u5BF9\u5F53\u524D\u76F8\u673A\u300D\u7684\u4E16\u754C\u6C34\u5E73\u65B9\u5411\uFF08W = \u753B\u9762\u8FDC\u5904\uFF09\uFF0C
    //    \u65B9\u4F4D\u89D2\u7531\u5F15\u64CE\u6309\u76F8\u673A\u89C6\u7EBF\u7B97\u597D\uFF0C\u4E0D\u8981\u81EA\u5DF1\u4ECE\u76F8\u673A\u65CB\u8F6C\u91CC\u63A8
    const dir = self.input.moveDirection("Move")
    let mx = dir.x
    let mz = dir.z
    const mLen = Math.hypot(mx, mz)
    const moving = mLen > 0.05
    const sprinting = moving && self.input.isPressed("Sprint")
    const speed = sprinting ? p.runSpeed : p.walkSpeed
    if (moving) {
      mx /= mLen
      mz /= mLen
    }

    // 3) \u8DF3\u8DC3\u4E0E\u91CD\u529B\uFF08\u624B\u52A8\u79EF\u5206\uFF0C\u4E0D\u4F9D\u8D56\u7269\u7406\u80FD\u529B\u5305\uFF09
    if (s.grounded && self.input.justPressed("Jump")) {
      s.velY = p.jumpSpeed
      s.grounded = false
    }
    s.velY -= p.gravity * dt
    let y = pos.y + s.velY * dt
    if (y <= p.groundY) {
      y = p.groundY
      s.velY = 0
      s.grounded = true
    }

    // 4) \u4F4D\u7F6E\u5FC5\u987B\u6574\u4F53\u8D4B\u503C
    self.position = {
      x: pos.x + (moving ? mx * speed * dt : 0),
      y,
      z: pos.z + (moving ? mz * speed * dt : 0),
    }

    // 5) \u5E73\u6ED1\u8F6C\u5411\u79FB\u52A8\u65B9\u5411\uFF08self.rotation \u4E3A\u5F27\u5EA6\uFF1Byaw=0 \u65F6\u671D +Z\uFF09
    if (moving) {
      const targetYaw = Math.atan2(mx, mz)
      const rot = self.rotation
      let diff = targetYaw - rot.y
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const k = Math.min(1, p.turnSpeed * dt)
      self.rotation = { x: rot.x, y: rot.y + diff * k, z: rot.z }
    }

    // 6) \u53EA\u5728\u76EE\u6807\u526A\u8F91\u53D8\u5316\u65F6\u5207\u6362\u52A8\u753B\uFF0C\u907F\u514D\u6BCF\u5E27\u91CD\u64AD
    const next = moving ? (sprinting ? p.runClip || p.walkClip : p.walkClip) : p.idleClip
    if (next && next !== s.clip) {
      s.clip = next
      self.anim.playBody(next, { loop: true, fade: 0.15 })
    }
  },
})
`;
var FOLLOW_CAMERA = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u8DDF\u968F\u76F8\u673A",
  description: "\u5E73\u6ED1\u8DDF\u968F\u76EE\u6807\u5E76\u59CB\u7EC8\u770B\u5411\u5B83\uFF1B\u6309\u4F4F\u9F20\u6807\u53F3\u952E\u62D6\u52A8\u53EF\u73AF\u7ED5",
  params: {
    target: { type: "ref", target: "node", label: "\u8DDF\u968F\u76EE\u6807", default: null },
    distance: { type: "number", label: "\u6C34\u5E73\u8DDD\u79BB", default: 6 },
    height: { type: "number", label: "\u76F8\u673A\u9AD8\u5EA6", default: 3.2 },
    lookHeight: { type: "number", label: "\u6CE8\u89C6\u70B9\u9AD8\u5EA6", default: 1.2 },
    smooth: { type: "number", label: "\u8DDF\u968F\u5E73\u6ED1\u5EA6", default: 8 },
    orbitSpeed: { type: "number", label: "\u73AF\u7ED5\u7075\u654F\u5EA6", default: 0.005 },
  },
  state: () => ({ yaw: 0 }),
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!p.target) return

    if (self.input.isMouseButtonPressed(2)) {
      s.yaw -= self.input.pointerDelta().x * p.orbitSpeed
    }

    const t = p.target.position
    // yaw=0 \u65F6\u76F8\u673A\u4F4D\u4E8E\u76EE\u6807\u7684 -Z \u4FA7\uFF0C\u770B\u5411 +Z\uFF08\u4E0E\u89D2\u8272\u9ED8\u8BA4\u671D\u5411\u4E00\u81F4\uFF09
    const want = {
      x: t.x - Math.sin(s.yaw) * p.distance,
      y: t.y + p.height,
      z: t.z - Math.cos(s.yaw) * p.distance,
    }
    const k = 1 - Math.exp(-p.smooth * dt)
    const cur = self.position
    self.position = {
      x: cur.x + (want.x - cur.x) * k,
      y: cur.y + (want.y - cur.y) * k,
      z: cur.z + (want.z - cur.z) * k,
    }
    self.lookAt({ x: t.x, y: t.y + p.lookHeight, z: t.z })
  },
})
`;
var WAVE_SPAWNER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u6CE2\u6B21\u5237\u602A",
  description: "\u6309\u6CE2\u6B21\u4ECE\u9690\u85CF\u6A21\u677F\u8282\u70B9\u6C60\u5316\u751F\u6210\u654C\u4EBA\uFF0C\u5E76\u628A\u5F53\u524D\u6CE2\u6B21\u5199\u5165\u754C\u9762\u53D8\u91CF",
  params: {
    template: { type: "ref", target: "node", label: "\u654C\u4EBA\u6A21\u677F\uFF08\u9690\u85CF\u8282\u70B9\uFF09", default: null },
    spawnRadius: { type: "number", label: "\u751F\u6210\u534A\u5F84", default: 12 },
    firstWaveCount: { type: "number", label: "\u9996\u6CE2\u6570\u91CF", default: 3 },
    countPerWave: { type: "number", label: "\u6BCF\u6CE2\u9012\u589E", default: 2 },
    spawnInterval: { type: "number", label: "\u5355\u53EA\u95F4\u9694(\u79D2)", default: 0.6 },
    waveGap: { type: "number", label: "\u6CE2\u6B21\u95F4\u9694(\u79D2)", default: 4 },
    maxAlive: { type: "number", label: "\u540C\u5C4F\u4E0A\u9650", default: 20 },
    waveVar: { type: "string", label: "\u6CE2\u6B21\u754C\u9762\u53D8\u91CF", default: "wave" },
  },
  state: () => ({ wave: 0, toSpawn: 0, spawnTimer: 0, gapTimer: 1 }),
  onStart(self) {
    if (self.params.template) self.pool.preload(self.params.template, 6)
    self.ui.setVar(self.params.waveVar, 0)
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!p.template) return
    const alive = self.pool.stats(p.template).active

    // \u672C\u6CE2\u5DF2\u5237\u5B8C\u4E14\u573A\u4E0A\u6E05\u7A7A -> \u5012\u8BA1\u65F6\u8FDB\u5165\u4E0B\u4E00\u6CE2
    if (s.toSpawn <= 0) {
      if (alive > 0) return
      s.gapTimer -= dt
      if (s.gapTimer > 0) return
      s.wave += 1
      s.toSpawn = p.firstWaveCount + (s.wave - 1) * p.countPerWave
      s.spawnTimer = 0
      s.gapTimer = p.waveGap
      self.ui.setVar(p.waveVar, s.wave)
      self.broadcast("waveStarted", { wave: s.wave })
      return
    }

    s.spawnTimer -= dt
    if (s.spawnTimer > 0 || alive >= p.maxAlive) return
    s.spawnTimer = p.spawnInterval
    s.toSpawn -= 1

    const angle = Math.random() * Math.PI * 2
    const center = self.position
    self.pool.acquire(p.template, {
      position: {
        x: center.x + Math.cos(angle) * p.spawnRadius,
        y: center.y,
        z: center.z + Math.sin(angle) * p.spawnRadius,
      },
      payload: { wave: s.wave },
    })
  },
})
`;
var CHASE_ENEMY = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u8FFD\u51FB\u654C\u4EBA",
  description: "\u8FFD\u5411\u5E26\u6307\u5B9A\u6807\u7B7E\u7684\u76EE\u6807\uFF0C\u8D34\u8EAB\u540E\u6309\u95F4\u9694\u9020\u6210\u4F24\u5BB3\uFF1B\u6536\u5230 hit \u6D88\u606F\u6263\u8840\uFF0C\u6B7B\u4EA1\u540E\u56DE\u6C60",
  params: {
    targetTag: { type: "string", label: "\u76EE\u6807\u6807\u7B7E", default: "player" },
    speed: { type: "number", label: "\u79FB\u52A8\u901F\u5EA6", default: 2.4 },
    maxHp: { type: "number", label: "\u751F\u547D\u503C", default: 3 },
    damage: { type: "number", label: "\u653B\u51FB\u4F24\u5BB3", default: 10 },
    attackRange: { type: "number", label: "\u653B\u51FB\u8DDD\u79BB", default: 1.3 },
    attackInterval: { type: "number", label: "\u653B\u51FB\u95F4\u9694(\u79D2)", default: 0.8 },
    score: { type: "number", label: "\u51FB\u6740\u5F97\u5206", default: 10 },
  },
  state: () => ({ hp: 1, cooldown: 0, alive: false }),
  onStart(self) {
    // \u9690\u85CF\u7684\u6A21\u677F\u8282\u70B9\u81EA\u8EAB\u4E5F\u4F1A\u6267\u884C\u811A\u672C\uFF1A\u4E0D\u53EF\u89C1\u65F6\u4E0D\u8981\u6FC0\u6D3B\u3001\u66F4\u4E0D\u8981\u6253\u6807\u7B7E
    if (!self.visible) return
    self.state.hp = self.params.maxHp
    self.state.alive = true
    self.addTag("enemy")
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!s.alive || !self.visible) return

    const target = self.findNodesByTag(p.targetTag)[0]
    if (!target || !target.visible) return

    s.cooldown -= dt
    const dist = self.distanceTo(target)
    if (dist > p.attackRange) {
      self.moveToward(target, p.speed * dt, { faceTarget: true, planeXZ: true })
      return
    }
    self.lookAt(target, { yOnly: true })
    if (s.cooldown <= 0) {
      s.cooldown = p.attackInterval
      target.sendMessage("damage", { amount: p.damage })
    }
  },
  onMessage(self, msg) {
    const s = self.state
    if (msg.name !== "hit" || !s.alive) return
    const payload = msg.payload
    const amount = payload && typeof payload === "object" && "damage" in payload ? Number(payload.damage) : 1
    s.hp -= amount
    self.tween.punchScale(0.25, 0.15)
    if (s.hp > 0) return
    s.alive = false
    self.broadcast("enemyKilled", { score: self.params.score })
    // \u6C60\u5316\u5BF9\u8C61\u8C03\u7528 destroy \u4F1A\u81EA\u52A8\u56DE\u6C60
    self.node.destroy()
  },
})
`;
var PLAYER_SHOOTER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u73A9\u5BB6\u5C04\u51FB",
  description: "\u6309\u4F4F\u653B\u51FB\u952E\u6CBF\u89D2\u8272\u671D\u5411\u8FDE\u7EED\u53D1\u5C04\u6C60\u5316\u5B50\u5F39",
  params: {
    bullet: { type: "ref", target: "node", label: "\u5B50\u5F39\u6A21\u677F\uFF08\u9690\u85CF\u8282\u70B9\uFF09", default: null },
    fireInterval: { type: "number", label: "\u5C04\u51FB\u95F4\u9694(\u79D2)", default: 0.18 },
    muzzleHeight: { type: "number", label: "\u67AA\u53E3\u9AD8\u5EA6", default: 1.1 },
    muzzleForward: { type: "number", label: "\u67AA\u53E3\u524D\u4F38", default: 0.7 },
  },
  state: () => ({ cooldown: 0 }),
  onStart(self) {
    if (self.params.bullet) self.pool.preload(self.params.bullet, 12)
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    s.cooldown -= dt
    if (!p.bullet || s.cooldown > 0) return
    if (!self.input.isPressed("Attack") && !self.input.isMouseButtonPressed(0)) return
    s.cooldown = p.fireInterval

    const pos = self.position
    const dir = self.forward
    self.pool.acquire(p.bullet, {
      position: {
        x: pos.x + dir.x * p.muzzleForward,
        y: pos.y + p.muzzleHeight,
        z: pos.z + dir.z * p.muzzleForward,
      },
      rotation: self.rotation,
      payload: { dir },
    })
  },
})
`;
var BULLET = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u5B50\u5F39",
  description: "\u6CBF\u53D1\u5C04\u65B9\u5411\u76F4\u7EBF\u98DE\u884C\uFF0C\u547D\u4E2D\u5E26\u76EE\u6807\u6807\u7B7E\u7684\u8282\u70B9\u540E\u53D1\u9001 hit \u6D88\u606F\u5E76\u56DE\u6C60",
  params: {
    speed: { type: "number", label: "\u98DE\u884C\u901F\u5EA6", default: 22 },
    life: { type: "number", label: "\u5B58\u6D3B\u65F6\u95F4(\u79D2)", default: 2 },
    damage: { type: "number", label: "\u4F24\u5BB3", default: 1 },
    hitRadius: { type: "number", label: "\u547D\u4E2D\u534A\u5F84", default: 0.7 },
    targetTag: { type: "string", label: "\u76EE\u6807\u6807\u7B7E", default: "enemy" },
  },
  state: () => ({ dx: 0, dz: 1, age: 0, live: false }),
  onSpawn(self, payload) {
    const s = self.state
    const dir = payload && typeof payload === "object" && "dir" in payload ? payload.dir : null
    const fallback = self.forward
    s.dx = dir && typeof dir === "object" && "x" in dir ? Number(dir.x) : fallback.x
    s.dz = dir && typeof dir === "object" && "z" in dir ? Number(dir.z) : fallback.z
    s.age = 0
    s.live = true
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    // \u6A21\u677F\u8282\u70B9\u672C\u8EAB\u4E0D\u53EF\u89C1\u4E14\u4ECE\u672A\u88AB onSpawn \u6FC0\u6D3B\uFF0C\u76F4\u63A5\u8DF3\u8FC7
    if (!s.live || !self.visible) return

    self.translate({ x: s.dx * p.speed * dt, y: 0, z: s.dz * p.speed * dt }, "world")
    s.age += dt

    const hit = self.findNodesInRadius(self.position, p.hitRadius, p.targetTag)[0]
    if (hit) {
      hit.sendMessage("hit", { damage: p.damage })
      s.live = false
      self.node.destroy()
      return
    }
    if (s.age >= p.life) {
      s.live = false
      self.node.destroy()
    }
  },
})
`;
var PLAYER_HEALTH = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u73A9\u5BB6\u751F\u547D",
  description: "\u63A5\u6536 damage \u6D88\u606F\u6263\u8840\u5E76\u540C\u6B65\u5230\u754C\u9762\u8FDB\u5EA6\u6761\uFF080~1\uFF09\uFF0C\u6B7B\u4EA1\u65F6\u5E7F\u64AD playerDied",
  params: {
    maxHp: { type: "number", label: "\u6700\u5927\u751F\u547D", default: 100 },
    hpVar: { type: "string", label: "\u751F\u547D\u754C\u9762\u53D8\u91CF(0~1)", default: "hp" },
    invincibleTime: { type: "number", label: "\u53D7\u51FB\u65E0\u654C(\u79D2)", default: 0.4 },
  },
  state: () => ({ hp: 100, invincible: 0, dead: false }),
  onStart(self) {
    self.addTag("player")
    self.state.hp = self.params.maxHp
    self.ui.setVar(self.params.hpVar, 1)
  },
  onUpdate(self, dt) {
    if (self.state.invincible > 0) self.state.invincible -= dt
  },
  onMessage(self, msg) {
    const p = self.params
    const s = self.state
    if (msg.name !== "damage" || s.dead || s.invincible > 0) return
    const payload = msg.payload
    const amount = payload && typeof payload === "object" && "amount" in payload ? Number(payload.amount) : 10
    s.hp = Math.max(0, s.hp - amount)
    s.invincible = p.invincibleTime
    // HUD \u6A21\u677F\u7684\u8FDB\u5EA6\u6761\u91CF\u7A0B\u662F 0~1
    self.ui.setVar(p.hpVar, s.hp / p.maxHp)
    self.tween.shakePosition(0.12, 0.2)
    if (s.hp > 0) return
    s.dead = true
    self.visible = false
    self.broadcast("playerDied")
  },
})
`;
var GAME_MANAGER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u5BF9\u5C40\u7BA1\u7406",
  description: "\u6C47\u603B\u5F97\u5206\u3001\u5904\u7406\u80DC\u8D1F\u5E76\u63A7\u5236\u7ED3\u7B97\u754C\u9762\u7684\u663E\u793A",
  params: {
    scoreVar: { type: "string", label: "\u5F97\u5206\u754C\u9762\u53D8\u91CF", default: "score" },
    targetScore: { type: "number", label: "\u80DC\u5229\u6240\u9700\u5F97\u5206(0=\u65E0\u4E0A\u9650)", default: 0 },
    resultScreen: { type: "string", label: "\u7ED3\u7B97\u754C\u9762\u5C4F\u5E55\u540D\u79F0", default: "\u7ED3\u7B97\u754C\u9762" },
    resultTitleVar: { type: "string", label: "\u7ED3\u7B97\u6807\u9898\u754C\u9762\u53D8\u91CF", default: "resultTitle" },
  },
  state: () => ({ score: 0, over: false }),
  onStart(self) {
    self.ui.setVar(self.params.scoreVar, 0)
    self.ui.hideScreen(self.params.resultScreen)
  },
  onMessage(self, msg) {
    const p = self.params
    const s = self.state
    if (s.over) return

    if (msg.name === "enemyKilled" || msg.name === "collected") {
      const payload = msg.payload
      const gain = payload && typeof payload === "object" && "score" in payload ? Number(payload.score) : 1
      s.score += gain
      self.ui.setVar(p.scoreVar, s.score)
      if (p.targetScore > 0 && s.score >= p.targetScore) {
        s.over = true
        self.ui.setVar(p.resultTitleVar, "\u80DC\u5229\uFF01")
        self.ui.showScreen(p.resultScreen)
        self.broadcast("gameOver", { win: true })
      }
      return
    }

    if (msg.name === "playerDied") {
      s.over = true
      self.ui.setVar(p.resultTitleVar, "\u5931\u8D25")
      self.ui.showScreen(p.resultScreen)
      self.broadcast("gameOver", { win: false })
    }
  },
})
`;
var COLLECTIBLE = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u53EF\u62FE\u53D6\u7269",
  description: "\u539F\u5730\u65CB\u8F6C\u6D6E\u52A8\uFF0C\u5E26\u6307\u5B9A\u6807\u7B7E\u7684\u8282\u70B9\u9760\u8FD1\u540E\u5E7F\u64AD collected \u5E76\u6D88\u5931",
  params: {
    pickerTag: { type: "string", label: "\u62FE\u53D6\u8005\u6807\u7B7E", default: "player" },
    radius: { type: "number", label: "\u62FE\u53D6\u534A\u5F84", default: 1.1 },
    score: { type: "number", label: "\u5F97\u5206", default: 1 },
    spinSpeed: { type: "number", label: "\u65CB\u8F6C\u901F\u5EA6(\u5F27\u5EA6/\u79D2)", default: 2.2 },
    bobHeight: { type: "number", label: "\u6D6E\u52A8\u5E45\u5EA6", default: 0.18 },
  },
  state: () => ({ baseY: 0, taken: false }),
  onStart(self) {
    self.state.baseY = self.position.y
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (s.taken) return

    self.rotateY(p.spinSpeed * dt)
    const pos = self.position
    self.position = { x: pos.x, y: s.baseY + Math.sin(self.elapsedTime * 3) * p.bobHeight, z: pos.z }

    const picker = self.findNodesInRadius(self.position, p.radius, p.pickerTag)[0]
    if (!picker) return
    s.taken = true
    self.broadcast("collected", { score: p.score })
    self.node.destroy()
  },
})
`;
var RECIPES = [
  {
    id: "third-person-controller",
    title: "\u7B2C\u4E09\u4EBA\u79F0\u89D2\u8272\u63A7\u5236\uFF08\u79FB\u52A8 / \u8DF3\u8DC3 / \u52A8\u753B\u5207\u6362\uFF09",
    summary: "WASD \u76F8\u5BF9\u76F8\u673A\u79FB\u52A8\u3001\u7A7A\u683C\u8DF3\u8DC3\u3001Shift \u5954\u8DD1\uFF0C\u6309\u72B6\u6001\u5207\u6362\u5F85\u673A/\u884C\u8D70/\u5954\u8DD1\u526A\u8F91",
    setup: [
      '\u89D2\u8272\u8282\u70B9\uFF1A\u5DF2\u6709\u8499\u76AE\u6A21\u578B\u5C31\u7528 kind:"model"\uFF1B\u6CA1\u6709\u6A21\u578B\u5C31\u7528 kind:"capsule"\uFF08\u6B64\u65F6\u4E09\u4E2A\u526A\u8F91\u53C2\u6570\u7559\u7A7A\u5373\u53EF\uFF09\u3002',
      "\u573A\u666F\u91CC\u8981\u6709\u4E00\u4E2A\u76F8\u673A\u8282\u70B9\uFF08\u5EFA\u8BAE\u540C\u65F6\u6302 follow-camera \u8303\u4F8B\uFF09\u3002",
      "script__create \u5199\u5165\u6E90\u7801\u540E\uFF0Cscript__attach \u5230\u89D2\u8272\uFF0Cparams \u4F20\u4E09\u4E2A\u526A\u8F91\u540D\uFF08\u6765\u81EA\u6A21\u578B\u6216\u52A8\u753B\u8D44\u4EA7\u7684 clips \u5217\u8868\uFF09\u3002\u79FB\u52A8\u65B9\u5411\u81EA\u52A8\u76F8\u5BF9\u5F53\u524D\u76F8\u673A\uFF0C\u4E0D\u9700\u8981\u4F20\u76F8\u673A\u3002",
      "\u5730\u9762\u4E0D\u5728 y=0 \u65F6\u628A groundY \u8BBE\u4E3A\u5730\u9762\u9AD8\u5EA6\u3002"
    ],
    files: [{ scriptId: "ThirdPersonController", attachTo: "\u73A9\u5BB6\u89D2\u8272\u8282\u70B9", source: THIRD_PERSON_CONTROLLER }],
    verify: 'playtest__run_smoke\uFF1A\u5148 input \u6CE8\u5165 {type:"axis",action:"Move",x:0,y:1}\uFF0Cstep 1 \u79D2\uFF0C\u518D assert nodeMoved\uFF08from \u4E3A\u89D2\u8272\u521D\u59CB\u4F4D\u7F6E\uFF0CminDistance 1\uFF09\u3002',
    pitfalls: [
      '\u526A\u8F91\u53C2\u6570\u5FC5\u987B\u662F ref(target:"clip")\uFF0C\u76F4\u63A5\u628A\u53C2\u6570\u503C\u4F20\u7ED9 self.anim.playBody\uFF0C\u5F15\u64CE\u4F1A\u81EA\u52A8\u5728\u6A21\u578B\u4E0E\u5916\u90E8\u52A8\u753B\u8D44\u4EA7\u91CC\u627E\u540C\u540D\u526A\u8F91\u3002',
      "\u4E0D\u8981\u6BCF\u5E27\u8C03\u7528 playBody\uFF0C\u53EA\u5728\u76EE\u6807\u526A\u8F91\u53D8\u5316\u65F6\u8C03\u7528\u3002",
      "\u76F8\u5BF9\u76F8\u673A\u7684\u79FB\u52A8\u4E00\u5F8B\u7528 self.input.moveDirection()\uFF1B\u4E0D\u8981\u8BFB\u76F8\u673A\u7684 rotation \u81EA\u5DF1\u7B97\u65B9\u4F4D\u89D2\uFF0C\u6B27\u62C9\u89D2\u5728\u76F8\u673A\u6709\u4FEF\u4EF0\u65F6\u4F1A\u7B97\u504F\u3002",
      "\u53EA\u9700\u8981\u6807\u51C6\u7684\u8D70/\u8DD1/\u8DF3\u52A0\u52A8\u753B\u5207\u6362\u65F6\uFF0C\u76F4\u63A5\u7528\u5185\u7F6E\u7EC4\u4EF6 character\uFF08gameplay__setCoreComponent\uFF09\u66F4\u7701\u4E8B\uFF1B\u9700\u8981\u81EA\u5B9A\u4E49\u79FB\u52A8\u624B\u611F\u624D\u7528\u8FD9\u4EFD\u811A\u672C\u3002"
    ]
  },
  {
    id: "follow-camera",
    title: "\u8DDF\u968F\u76F8\u673A\uFF08\u5E73\u6ED1\u8DDF\u968F + \u53F3\u952E\u73AF\u7ED5\uFF09",
    summary: "\u76F8\u673A\u5E73\u6ED1\u8DDF\u5728\u76EE\u6807\u8EAB\u540E\u5E76\u59CB\u7EC8\u6CE8\u89C6\u76EE\u6807",
    setup: [
      '\u521B\u5EFA kind:"camera" \u8282\u70B9\uFF0C\u521D\u59CB\u4F4D\u7F6E\u653E\u5728\u76EE\u6807\u540E\u4E0A\u65B9\u5373\u53EF\uFF08\u811A\u672C\u4F1A\u63A5\u7BA1\u4F4D\u7F6E\u4E0E\u671D\u5411\uFF09\u3002',
      "script__attach \u5230\u76F8\u673A\u8282\u70B9\uFF0Cparams.target \u4F20\u88AB\u8DDF\u968F\u7684\u8282\u70B9\u3002"
    ],
    files: [{ scriptId: "FollowCamera", attachTo: "\u76F8\u673A\u8282\u70B9", source: FOLLOW_CAMERA }],
    verify: "viewport__capture({ playSeconds: 0.8 })\uFF1A\u786E\u8BA4\u76EE\u6807\u4F4D\u4E8E\u753B\u9762\u4E2D\u4E0B\u90E8\u4E14\u6CA1\u6709\u88AB\u5730\u9762\u6216\u5899\u4F53\u906E\u6321\u3002",
    pitfalls: ["\u76F8\u673A\u671D\u5411\u4E00\u5F8B\u7528 self.lookAt\uFF0C\u4E0D\u8981\u624B\u7B97\u6B27\u62C9\u89D2\u3002"]
  },
  {
    id: "enemy-wave",
    title: "\u6CE2\u6B21\u5237\u602A + \u8FFD\u51FB\u654C\u4EBA\uFF08\u5BF9\u8C61\u6C60\uFF09",
    summary: "\u4ECE\u4E00\u4E2A\u9690\u85CF\u6A21\u677F\u8282\u70B9\u6C60\u5316\u751F\u6210\u654C\u4EBA\uFF0C\u654C\u4EBA\u8FFD\u51FB\u5E76\u653B\u51FB\u73A9\u5BB6\uFF0C\u53EF\u88AB hit \u6D88\u606F\u51FB\u6740",
    setup: [
      "\u654C\u4EBA\u6A21\u677F\uFF1A\u521B\u5EFA\u4E00\u4E2A\u654C\u4EBA\u8282\u70B9\uFF08\u6A21\u578B\u6216\u57FA\u7840\u51E0\u4F55\u4F53\uFF09\uFF0C\u6302 ChaseEnemy\uFF0C\u7136\u540E\u628A\u6A21\u677F\u7684 visible \u8BBE\u4E3A false \u5E76\u653E\u5728\u573A\u666F\u5916\u4FA7\u3002",
      '\u5237\u602A\u70B9\uFF1A\u521B\u5EFA kind:"empty" \u8282\u70B9\u653E\u5728\u6218\u573A\u4E2D\u5FC3\uFF0C\u6302 WaveSpawner\uFF0Cparams.template \u4F20\u654C\u4EBA\u6A21\u677F\u8282\u70B9\u3002',
      '\u73A9\u5BB6\u8282\u70B9\u9700\u8981\u5E26 "player" \u6807\u7B7E\uFF08third-person-controller \u4E0E health-score-hud \u8303\u4F8B\u90FD\u4F1A\u5728 onStart \u81EA\u52A8\u6253\uFF09\u3002'
    ],
    files: [
      { scriptId: "ChaseEnemy", attachTo: "\u654C\u4EBA\u6A21\u677F\u8282\u70B9\uFF08\u9690\u85CF\uFF09", source: CHASE_ENEMY },
      { scriptId: "WaveSpawner", attachTo: "\u6218\u573A\u4E2D\u5FC3\u7684\u7A7A\u8282\u70B9", source: WAVE_SPAWNER }
    ],
    verify: 'playtest__run_smoke\uFF1Astep 3 \u79D2\u540E assert uiVarEquals {name:"wave",value:1}\uFF0C\u5E76\u7528 nodeCountAtLeast \u65AD\u8A00\u8282\u70B9\u6570\u6BD4\u7F16\u8F91\u6001\u591A\uFF08\u5DF2\u751F\u6210\u654C\u4EBA\uFF09\u3002',
    pitfalls: [
      "\u9690\u85CF\u7684\u6A21\u677F\u8282\u70B9\u81EA\u8EAB\u4E5F\u4F1A\u6267\u884C\u811A\u672C\uFF0C\u6240\u4EE5\u811A\u672C\u91CC\u8981\u7528 if (!self.visible) return \u8DF3\u8FC7\uFF0C\u4E14\u53EA\u5728\u53EF\u89C1\u5B9E\u4F8B\u4E0A\u6253\u6807\u7B7E\u3002",
      "\u6C60\u5316\u5BF9\u8C61\u7528 self.node.destroy() \u5373\u53EF\u81EA\u52A8\u56DE\u6C60\uFF0C\u4E0D\u8981\u624B\u5EFA\u4E00\u5806\u8282\u70B9\u5145\u5F53\u5BF9\u8C61\u6C60\u3002"
    ]
  },
  {
    id: "shooting",
    title: "\u5C04\u51FB\uFF08\u73A9\u5BB6\u5F00\u706B + \u6C60\u5316\u5B50\u5F39\uFF09",
    summary: '\u6309\u4F4F\u653B\u51FB\u952E\u6CBF\u89D2\u8272\u671D\u5411\u53D1\u5C04\u5B50\u5F39\uFF0C\u5B50\u5F39\u547D\u4E2D\u5E26 "enemy" \u6807\u7B7E\u7684\u8282\u70B9\u540E\u53D1\u9001 hit \u6D88\u606F',
    setup: [
      "\u5B50\u5F39\u6A21\u677F\uFF1A\u521B\u5EFA\u4E00\u4E2A\u5C0F\u7403/\u5C0F\u80F6\u56CA\u8282\u70B9\uFF0C\u6302 Bullet\uFF0Cvisible \u8BBE\u4E3A false\u3002",
      "script__attach PlayerShooter \u5230\u73A9\u5BB6\u8282\u70B9\uFF0Cparams.bullet \u4F20\u5B50\u5F39\u6A21\u677F\u8282\u70B9\u3002",
      '\u88AB\u51FB\u4E2D\u7684\u5BF9\u8C61\u9700\u8981\u5E26 "enemy" \u6807\u7B7E\u5E76\u5728 onMessage \u91CC\u5904\u7406 "hit"\uFF08\u89C1 enemy-wave \u8303\u4F8B\u7684 ChaseEnemy\uFF09\u3002'
    ],
    files: [
      { scriptId: "Bullet", attachTo: "\u5B50\u5F39\u6A21\u677F\u8282\u70B9\uFF08\u9690\u85CF\uFF09", source: BULLET },
      { scriptId: "PlayerShooter", attachTo: "\u73A9\u5BB6\u8282\u70B9", source: PLAYER_SHOOTER }
    ],
    verify: 'playtest__run_smoke\uFF1Ainput \u6CE8\u5165 {type:"actionDown",action:"Attack"}\uFF0Cstep 0.5 \u79D2\uFF0C\u7528 nodeCountAtLeast \u65AD\u8A00\u8282\u70B9\u6570\u589E\u52A0\uFF08\u5DF2\u751F\u6210\u5B50\u5F39\uFF09\u3002'
  },
  {
    id: "health-score-hud",
    title: "\u751F\u547D\u503C + \u5F97\u5206 + HUD / \u7ED3\u7B97\u754C\u9762",
    summary: "\u73A9\u5BB6\u53D7\u51FB\u6263\u8840\u3001\u51FB\u6740\u4E0E\u62FE\u53D6\u52A0\u5206\uFF0C\u6570\u636E\u9A71\u52A8 HUD\uFF0C\u6B7B\u4EA1\u6216\u8FBE\u6807\u65F6\u5F39\u51FA\u7ED3\u7B97\u754C\u9762",
    setup: [
      'HUD\uFF1Aui__createFromTemplate({ template:"hud", varKey:"hp", scoreVarKey:"score" })\u3002',
      '\u7ED3\u7B97\uFF1Aui__createFromTemplate({ template:"result", name:"\u7ED3\u7B97\u754C\u9762", scoreVarKey:"score" })\uFF0C\u6807\u9898\u6587\u672C\u53EF\u7528 ui__patchNode \u7ED1\u5B9A\u5230\u53D8\u91CF resultTitle\u3002',
      "script__attach PlayerHealth \u5230\u73A9\u5BB6\u8282\u70B9\uFF1B\u521B\u5EFA\u4E00\u4E2A\u7A7A\u8282\u70B9 GameManager \u5E76\u6302 GameManager \u811A\u672C\uFF08resultScreen \u4F20\u7ED3\u7B97\u754C\u9762\u5C4F\u5E55\u8282\u70B9\u7684\u540D\u79F0\uFF09\u3002"
    ],
    files: [
      { scriptId: "PlayerHealth", attachTo: "\u73A9\u5BB6\u8282\u70B9", source: PLAYER_HEALTH },
      { scriptId: "GameManager", attachTo: "\u7A7A\u8282\u70B9 GameManager", source: GAME_MANAGER }
    ],
    verify: 'playtest__run_smoke\uFF1Astep 0.5 \u79D2\u540E assert uiVarEquals {name:"hp",value:1} \u4E0E {name:"score",value:0}\u3002',
    pitfalls: [
      "HUD \u6A21\u677F\u7684\u8FDB\u5EA6\u6761\u91CF\u7A0B\u662F 0~1\uFF0C\u5199\u5165\u754C\u9762\u53D8\u91CF\u65F6\u8981\u9664\u4EE5\u6700\u5927\u503C\u3002",
      "\u8DE8\u8282\u70B9\u901A\u4FE1\u7528 self.broadcast / node.sendMessage + onMessage\uFF0C\u4E0D\u8981\u4E92\u76F8\u76F4\u63A5\u6539\u5BF9\u65B9\u7684 state\u3002"
    ]
  },
  {
    id: "collectible",
    title: "\u53EF\u62FE\u53D6\u7269\uFF08\u91D1\u5E01 / \u9053\u5177\uFF09",
    summary: "\u65CB\u8F6C\u6D6E\u52A8\u7684\u62FE\u53D6\u7269\uFF0C\u73A9\u5BB6\u9760\u8FD1\u540E\u52A0\u5206\u5E76\u6D88\u5931",
    setup: [
      "\u521B\u5EFA\u62FE\u53D6\u7269\u8282\u70B9\uFF08\u7403\u4F53/\u5706\u67F1\u6216\u6A21\u578B\uFF09\uFF0C\u6302 Collectible\uFF1B\u9700\u8981\u591A\u4E2A\u65F6\u76F4\u63A5\u590D\u5236\u8282\u70B9\u6216\u505A\u6210\u9884\u5236\u4F53\u3002",
      "\u914D\u5408 health-score-hud \u8303\u4F8B\u7684 GameManager \u7EDF\u8BA1\u5F97\u5206\uFF08\u5B83\u4F1A\u5904\u7406 collected \u6D88\u606F\uFF09\u3002"
    ],
    files: [{ scriptId: "Collectible", attachTo: "\u62FE\u53D6\u7269\u8282\u70B9", source: COLLECTIBLE }],
    verify: "playtest__run_smoke\uFF1A\u628A\u73A9\u5BB6\u653E\u5728\u62FE\u53D6\u7269\u65C1\uFF0C\u6CE8\u5165\u671D\u5411\u62FE\u53D6\u7269\u7684 Move \u8F93\u5165\u5E76 step 1.5 \u79D2\uFF0Cassert nodeMissing\uFF08\u62FE\u53D6\u7269\u540D\u79F0\uFF09\u4E0E uiVarEquals score\u3002"
  }
];
function findRecipe(id) {
  const key = id.trim().toLowerCase();
  if (!key) return null;
  return RECIPES.find((r) => r.id === key) ?? RECIPES.find((r) => r.files.some((f) => f.scriptId.toLowerCase() === key)) ?? null;
}
function formatRecipeIndexForPrompt() {
  return RECIPES.map((r) => `   - ${r.id}\uFF1A${r.summary}`).join("\n");
}

// tests/ai-knowledge.test.ts
function makeNode(id, name, patch = {}) {
  return {
    id,
    name,
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
    gameplay: {},
    ...patch
  };
}
function withScripts(scripts) {
  return { gameplay: { packs: { __project__: scripts } } };
}
function createHeadlessWorld(initial) {
  let nodes = Object.fromEntries(initial.map((n) => [n.id, n]));
  const objects = /* @__PURE__ */ new Map();
  const errors = [];
  const world3 = {
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next;
    },
    updateNode: (id, patch) => {
      if (nodes[id]) nodes = { ...nodes, [id]: { ...nodes[id], ...patch } };
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
    log: (level, message) => {
      if (level === "error") errors.push(message);
    }
  };
  const host = {
    ready: true,
    resolveObject: (id) => {
      const node = nodes[id];
      if (!node) return null;
      let obj = objects.get(id);
      if (!obj) {
        obj = new Group();
        obj.position.set(node.position[0], node.position[1], node.position[2]);
        obj.rotation.set(
          node.rotation[0] * Math.PI / 180,
          node.rotation[1] * Math.PI / 180,
          node.rotation[2] * Math.PI / 180
        );
        obj.visible = node.visible;
        objects.set(id, obj);
      }
      return obj;
    },
    updateAnimations: () => {
    }
  };
  setRuntimeWorld(world3);
  return {
    host,
    errors,
    nodes: () => nodes,
    positionOf: (id) => {
      const obj = host.resolveObject(id);
      return obj ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : null;
    },
    run: (seconds) => {
      const steps = Math.round(seconds * 60);
      for (let i = 0; i < steps; i += 1) stepSceneRuntime(1 / 60, host);
    }
  };
}
function registerRecipeScripts(recipeIds) {
  for (const recipeId of recipeIds) {
    const recipe = findRecipe(recipeId);
    assert.ok(recipe, `\u8303\u4F8B ${recipeId} \u4E0D\u5B58\u5728`);
    for (const file of recipe.files) {
      const res = compileAndRegisterScript(file.scriptId, `Assets/Scripts/${file.scriptId}.ts`, file.source);
      assert.equal(res.ok, true, `${file.scriptId} \u7F16\u8BD1\u5931\u8D25: ${JSON.stringify(res.diagnostics)}`);
    }
  }
}
test("\u8303\u4F8B\u5E93\uFF1A\u6BCF\u4EFD\u811A\u672C\u90FD\u80FD\u901A\u8FC7\u771F\u5B9E\u7F16\u8BD1\u4E0E\u9759\u6001\u53CD\u6A21\u5F0F\u68C0\u67E5", () => {
  clearScriptRuntimeState();
  const seenRecipeIds = /* @__PURE__ */ new Set();
  const seenScriptIds = /* @__PURE__ */ new Set();
  for (const recipe of RECIPES) {
    assert.ok(!seenRecipeIds.has(recipe.id), `\u8303\u4F8B ID \u91CD\u590D: ${recipe.id}`);
    seenRecipeIds.add(recipe.id);
    assert.ok(recipe.files.length > 0, `${recipe.id} \u6CA1\u6709\u811A\u672C`);
    assert.ok(recipe.setup.length > 0 && recipe.verify, `${recipe.id} \u7F3A\u5C11\u642D\u5EFA\u6216\u9A8C\u6536\u8BF4\u660E`);
    for (const file of recipe.files) {
      assert.ok(!seenScriptIds.has(file.scriptId), `\u811A\u672C ID \u91CD\u590D: ${file.scriptId}`);
      seenScriptIds.add(file.scriptId);
      const res = compileAndRegisterScript(file.scriptId, `Assets/Scripts/${file.scriptId}.ts`, file.source);
      assert.equal(res.ok, true, `${file.scriptId} \u7F16\u8BD1\u5931\u8D25: ${JSON.stringify(res.diagnostics)}`);
      const lintErrors = lintScriptSource(file.source).filter((d) => d.severity === "error");
      assert.deepEqual(lintErrors, [], `${file.scriptId} \u5B58\u5728\u9759\u6001\u53CD\u6A21\u5F0F`);
    }
  }
  for (const recipe of RECIPES) {
    assert.ok(formatRecipeIndexForPrompt().includes(recipe.id));
  }
  clearScriptRuntimeState();
});
test("\u8303\u4F8B\u5E93\uFF1A\u7B2C\u4E09\u4EBA\u79F0\u63A7\u5236\u5668\u6309\u8F93\u5165\u79FB\u52A8\u5E76\u5728\u843D\u5730\u540E\u505C\u5728\u5730\u9762", () => {
  clearScriptRuntimeState();
  clearAllVirtualInput();
  registerRecipeScripts(["third-person-controller"]);
  const sim = createHeadlessWorld([
    makeNode("cam", "Camera", { kind: "camera", position: [0, 3, -6] }),
    makeNode("player", "Player", {
      position: [0, 2, 0],
      ...withScripts({ ThirdPersonController: {} })
    })
  ]);
  sim.host.yaw = () => Math.PI;
  injectVirtualInput({ type: "axis", action: "Move", x: 0, y: 1 });
  sim.run(1.5);
  const pos = sim.positionOf("player");
  assert.deepEqual(sim.errors, []);
  assert.ok(pos && pos.z > 3, `\u89D2\u8272\u5E94\u5411\u524D\u79FB\u52A8\uFF0C\u5B9E\u9645 z=${pos?.z}`);
  assert.ok(pos && Math.abs(pos.x) < 0.01, `\u89D2\u8272\u4E0D\u5E94\u6A2A\u79FB\uFF0C\u5B9E\u9645 x=${pos?.x}`);
  assert.ok(pos && Math.abs(pos.y) < 1e-6, `\u89D2\u8272\u5E94\u843D\u5230\u5730\u9762\uFF0C\u5B9E\u9645 y=${pos?.y}`);
  clearAllVirtualInput();
  clearScriptRuntimeState();
});
test("\u8303\u4F8B\u5E93\uFF1A\u5C04\u51FB + \u654C\u4EBA + \u5BF9\u5C40\u7BA1\u7406\u8054\u52A8\uFF08\u5B50\u5F39\u51FB\u6740\u654C\u4EBA\u540E\u52A0\u5206\uFF09", () => {
  clearScriptRuntimeState();
  clearAllVirtualInput();
  registerRecipeScripts(["shooting", "enemy-wave", "health-score-hud"]);
  const sim = createHeadlessWorld([
    makeNode("bulletTpl", "BulletTemplate", {
      visible: false,
      position: [0, -50, 0],
      ...withScripts({ Bullet: {} })
    }),
    makeNode("player", "Player", {
      ...withScripts({ PlayerShooter: { bullet: "bulletTpl" }, PlayerHealth: {} })
    }),
    // 直接摆在玩家正前方（+Z）的敌人：1 点血，站着不动
    makeNode("enemy", "Enemy", {
      position: [0, 1.1, 6],
      ...withScripts({ ChaseEnemy: { maxHp: 1, speed: 0, score: 7, targetTag: "nobody" } })
    }),
    makeNode("gm", "GameManager", { kind: "empty", ...withScripts({ GameManager: {} }) })
  ]);
  sim.run(0.1);
  assert.equal(uiValues().variables.score, 0);
  assert.equal(uiValues().variables.hp, 1);
  injectVirtualInput({ type: "actionDown", action: "Attack" });
  sim.run(1.5);
  assert.deepEqual(sim.errors, []);
  assert.equal(uiValues().variables.score, 7, "\u51FB\u6740\u540E\u5E94\u52A0\u4E0A\u654C\u4EBA\u7684\u5206\u503C");
  clearAllVirtualInput();
  clearScriptRuntimeState();
});
test("\u8303\u4F8B\u5E93\uFF1A\u73A9\u5BB6\u53D7\u51FB\u6263\u8840\u5E76\u5728\u6B7B\u4EA1\u65F6\u5E7F\u64AD", () => {
  clearScriptRuntimeState();
  clearAllVirtualInput();
  registerRecipeScripts(["enemy-wave", "health-score-hud"]);
  const sim = createHeadlessWorld([
    makeNode("player", "Player", { ...withScripts({ PlayerHealth: { maxHp: 20, invincibleTime: 0 } }) }),
    makeNode("enemy", "Enemy", {
      position: [0, 0, 0.5],
      ...withScripts({ ChaseEnemy: { damage: 10, attackInterval: 0.2 } })
    }),
    makeNode("gm", "GameManager", { kind: "empty", ...withScripts({ GameManager: {} }) })
  ]);
  sim.run(1.5);
  assert.deepEqual(sim.errors, []);
  assert.equal(uiValues().variables.hp, 0);
  assert.equal(uiValues().variables.resultTitle, "\u5931\u8D25");
  clearAllVirtualInput();
  clearScriptRuntimeState();
});
