export const CORE_ES_LIB_DTS = `
declare type PropertyKey = string | number | symbol;
declare type Partial<T> = { [P in keyof T]?: T[P] };
declare type Required<T> = { [P in keyof T]-?: T[P] };
declare type Readonly<T> = { readonly [P in keyof T]: T[P] };
declare type Pick<T, K extends keyof T> = { [P in K]: T[P] };
declare type Record<K extends keyof any, T> = { [P in K]: T };
declare type Exclude<T, U> = T extends U ? never : T;
declare type Extract<T, U> = T extends U ? T : never;
declare type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
declare type NonNullable<T> = T & {};
declare type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;
declare type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
declare type Awaited<T> = T extends null | undefined ? T : T extends object & { then(onfulfilled: infer F, ...args: any): any } ? F extends (value: infer V, ...args: any) => any ? Awaited<V> : never : T;

interface Symbol { readonly description: string | undefined; toString(): string }
interface SymbolConstructor { readonly iterator: unique symbol; readonly toStringTag: unique symbol }
declare var Symbol: SymbolConstructor;

interface IteratorResult<T, TReturn = any> { done?: boolean; value: T }
interface Iterator<T, TReturn = any, TNext = undefined> { next(...args: [] | [TNext]): IteratorResult<T, TReturn> }
interface Iterable<T> { [Symbol.iterator](): Iterator<T> }
interface IterableIterator<T> extends Iterable<T>, Iterator<T> {}

interface Function { apply(this: Function, thisArg: any, argArray?: any): any; call(this: Function, thisArg: any, ...argArray: any[]): any; bind(this: Function, thisArg: any, ...argArray: any[]): any; readonly length: number; readonly name: string }
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { [index: number]: any; length: number }

interface Object { constructor: Function; toString(): string; valueOf(): Object; hasOwnProperty(v: PropertyKey): boolean }
interface ObjectConstructor {
  keys(o: object): string[];
  values<T>(o: { [s: string]: T } | ArrayLike<T>): T[];
  values(o: {}): any[];
  entries<T>(o: { [s: string]: T } | ArrayLike<T>): [string, T][];
  entries(o: {}): [string, any][];
  assign<T extends {}, U>(target: T, source: U): T & U;
  assign<T extends {}, U, V>(target: T, source1: U, source2: V): T & U & V;
  assign(target: object, ...sources: any[]): any;
  fromEntries<T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T };
  freeze<T>(o: T): Readonly<T>;
  is(value1: unknown, value2: unknown): boolean;
}
declare var Object: ObjectConstructor;

interface ArrayLike<T> { readonly length: number; readonly [n: number]: T }

interface ReadonlyArray<T> {
  readonly length: number;
  readonly [n: number]: T;
  [Symbol.iterator](): IterableIterator<T>;
  concat(...items: (T | ConcatArray<T>)[]): T[];
  join(separator?: string): string;
  slice(start?: number, end?: number): T[];
  indexOf(searchElement: T, fromIndex?: number): number;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  every(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: any): boolean;
  some(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: any): boolean;
  forEach(callbackfn: (value: T, index: number, array: readonly T[]) => void, thisArg?: any): void;
  map<U>(callbackfn: (value: T, index: number, array: readonly T[]) => U, thisArg?: any): U[];
  filter<S extends T>(predicate: (value: T, index: number, array: readonly T[]) => value is S, thisArg?: any): S[];
  filter(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: any): T[];
  reduce<U = T>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: readonly T[]) => U, initialValue?: U): U;
  find<S extends T>(predicate: (value: T, index: number, obj: readonly T[]) => value is S, thisArg?: any): S | undefined;
  find(predicate: (value: T, index: number, obj: readonly T[]) => unknown, thisArg?: any): T | undefined;
  findIndex(predicate: (value: T, index: number, obj: readonly T[]) => unknown, thisArg?: any): number;
  includes(searchElement: T, fromIndex?: number): boolean;
  flat<D extends number = 1>(depth?: D): any[];
  flatMap<U>(callback: (value: T, index: number, array: readonly T[]) => U | readonly U[]): U[];
  at(index: number): T | undefined;
}
interface ConcatArray<T> { readonly length: number; readonly [n: number]: T; join(separator?: string): string; slice(start?: number, end?: number): T[] }

interface Array<T> {
  length: number;
  [n: number]: T;
  [Symbol.iterator](): IterableIterator<T>;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  slice(start?: number, end?: number): T[];
  concat(...items: (T | ConcatArray<T>)[]): T[];
  join(separator?: string): string;
  reverse(): T[];
  sort(compareFn?: (a: T, b: T) => number): this;
  indexOf(searchElement: T, fromIndex?: number): number;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  every(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean;
  some(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean;
  forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[];
  filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[];
  filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[];
  reduce<U = T>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue?: U): U;
  find<S extends T>(predicate: (value: T, index: number, obj: T[]) => value is S, thisArg?: any): S | undefined;
  find(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): T | undefined;
  findIndex(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): number;
  includes(searchElement: T, fromIndex?: number): boolean;
  fill(value: T, start?: number, end?: number): this;
  flat<D extends number = 1>(depth?: D): any[];
  flatMap<U>(callback: (value: T, index: number, array: T[]) => U | readonly U[]): U[];
  at(index: number): T | undefined;
}
interface ArrayConstructor {
  new <T>(...items: T[]): T[];
  from<T>(iterable: Iterable<T> | ArrayLike<T>): T[];
  from<T, U>(iterable: Iterable<T> | ArrayLike<T>, mapfn: (v: T, k: number) => U): U[];
  isArray(arg: any): arg is any[];
}
declare var Array: ArrayConstructor;

interface String {
  readonly length: number;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  concat(...strings: string[]): string;
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  localeCompare(that: string): number;
  match(regexp: string | RegExp): RegExpMatchArray | null;
  replace(searchValue: string | RegExp, replaceValue: string | ((substring: string, ...args: any[]) => string)): string;
  replaceAll(searchValue: string | RegExp, replaceValue: string | ((substring: string, ...args: any[]) => string)): string;
  search(regexp: string | RegExp): number;
  slice(start?: number, end?: number): string;
  split(separator: string | RegExp, limit?: number): string[];
  substring(start: number, end?: number): string;
  toLowerCase(): string;
  toUpperCase(): string;
  trim(): string;
  trimStart(): string;
  trimEnd(): string;
  padStart(maxLength: number, fillString?: string): string;
  padEnd(maxLength: number, fillString?: string): string;
  startsWith(searchString: string, position?: number): boolean;
  endsWith(searchString: string, endPosition?: number): boolean;
  includes(searchString: string, position?: number): boolean;
  repeat(count: number): string;
}
interface StringConstructor { (value?: any): string; fromCharCode(...codes: number[]): string }
declare var String: StringConstructor;

interface Number { toFixed(fractionDigits?: number): string; toString(radix?: number): string; valueOf(): number }
interface NumberConstructor { (value?: any): number; isFinite(number: unknown): boolean; isNaN(number: unknown): boolean; isInteger(number: unknown): boolean; parseFloat(string: string): number; parseInt(string: string, radix?: number): number; readonly MAX_VALUE: number; readonly MIN_VALUE: number; readonly NaN: number }
declare var Number: NumberConstructor;

interface Boolean { valueOf(): boolean }
interface BooleanConstructor { <T>(value?: T): boolean }
declare var Boolean: BooleanConstructor;

interface RegExpMatchArray extends Array<string> { index?: number; input?: string }
interface RegExpExecArray extends Array<string> { index: number; input: string }
interface RegExp { test(string: string): boolean; exec(string: string): RegExpExecArray | null; readonly source: string; readonly flags: string }
interface RegExpConstructor { new (pattern: RegExp | string, flags?: string): RegExp; (pattern: RegExp | string, flags?: string): RegExp }
declare var RegExp: RegExpConstructor;

interface Error { name: string; message: string; stack?: string }
interface ErrorConstructor { new (message?: string): Error; (message?: string): Error }
declare var Error: ErrorConstructor;

interface Date { getTime(): number; toISOString(): string; valueOf(): number }
interface DateConstructor { new (): Date; new (value: number | string): Date; now(): number }
declare var Date: DateConstructor;

interface Map<K, V> {
  clear(): void; delete(key: K): boolean; forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void;
  get(key: K): V | undefined; has(key: K): boolean; set(key: K, value: V): this; readonly size: number;
  entries(): IterableIterator<[K, V]>; keys(): IterableIterator<K>; values(): IterableIterator<V>; [Symbol.iterator](): IterableIterator<[K, V]>;
}
interface MapConstructor { new <K = any, V = any>(entries?: readonly (readonly [K, V])[] | null): Map<K, V> }
declare var Map: MapConstructor;

interface Set<T> {
  add(value: T): this; clear(): void; delete(value: T): boolean; forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void): void;
  has(value: T): boolean; readonly size: number;
  entries(): IterableIterator<[T, T]>; keys(): IterableIterator<T>; values(): IterableIterator<T>; [Symbol.iterator](): IterableIterator<T>;
}
interface SetConstructor { new <T = any>(values?: readonly T[] | null): Set<T> }
declare var Set: SetConstructor;

interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2>;
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<T | TResult>;
  finally(onfinally?: (() => void) | null): Promise<T>;
}
interface PromiseLike<T> { then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> }
interface PromiseConstructor { new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>; resolve<T>(value: T | PromiseLike<T>): Promise<T>; reject<T = never>(reason?: any): Promise<T>; all<T extends readonly unknown[]>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> }
declare var Promise: PromiseConstructor;

interface Math {
  readonly E: number; readonly LN10: number; readonly LN2: number; readonly LOG2E: number; readonly LOG10E: number; readonly PI: number; readonly SQRT1_2: number; readonly SQRT2: number;
  abs(x: number): number; acos(x: number): number; asin(x: number): number; atan(x: number): number; atan2(y: number, x: number): number;
  ceil(x: number): number; cos(x: number): number; exp(x: number): number; floor(x: number): number; hypot(...values: number[]): number;
  log(x: number): number; max(...values: number[]): number; min(...values: number[]): number; pow(x: number, y: number): number;
  random(): number; round(x: number): number; sign(x: number): number; sin(x: number): number; sqrt(x: number): number; tan(x: number): number; trunc(x: number): number;
}
declare var Math: Math;

interface JSON { parse(text: string): any; stringify(value: any, replacer?: any, space?: string | number): string }
declare var JSON: JSON;

declare var console: { log(...data: any[]): void; warn(...data: any[]): void; error(...data: any[]): void; info(...data: any[]): void };
declare var performance: { now(): number };
declare function parseInt(string: string, radix?: number): number;
declare function parseFloat(string: string): number;
declare function isNaN(number: number): boolean;
declare function isFinite(number: number): boolean;
declare function structuredClone<T>(value: T): T;
declare var undefined: undefined;
declare var NaN: number;
declare var Infinity: number;
`

export const RUNTIME_DTS_SUMMARY = `export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Vec4 { x: number; y: number; z: number; w: number }
export type ScriptParamSchema =
  | { type: 'number'; default: number; min?: number; max?: number; step?: number; label: string; description?: string }
  | { type: 'boolean'; default: boolean; label: string; description?: string }
  | { type: 'string'; default: string; label: string; description?: string }
  | { type: 'color'; default: string; label: string; description?: string }
  | { type: 'vec2'; default: readonly [number, number]; label: string; description?: string }
  | { type: 'vec3'; default: readonly [number, number, number]; label: string; description?: string }
  | { type: 'enum'; options: ReadonlyArray<{ value: string; label: string }>; default: string; label: string; description?: string }
  | { type: 'texture'; default?: string | null; label: string; description?: string }
  | { type: 'ref'; target: 'node' | 'asset' | 'clip' | 'tableRow'; kinds?: readonly string[]; tableId?: string; default?: string | null; label: string; description?: string }
  | Record<string, unknown>
export type ScriptParamMap = Record<string, ScriptParamSchema>
export interface NodeHandle {
  readonly id: string; readonly name: string; readonly tags: readonly string[]; readonly parent: NodeHandle | null
  position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean
  hasTag(tag: string): boolean
  addTag(tag: string): void
  removeTag(tag: string): void
  getChildren(): readonly NodeHandle[]
  sendMessage(name: string, payload?: unknown): void
  getBehavior<T = Record<string, (...args: unknown[]) => unknown>>(behavior: unknown): T | null
  destroy(): void
}
export interface ScriptContext<P = Record<string, unknown>, S = Record<string, unknown>> {
  readonly node: NodeHandle; readonly params: P; readonly state: S; readonly elapsedTime: number
  position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean
  readonly forward: Vec3; readonly right: Vec3
  distanceTo(target: Vec3 | NodeHandle): number
  hasTag(tag: string): boolean
  addTag(tag: string): void
  removeTag(tag: string): void
  directionTo(target: Vec3 | NodeHandle, options?: { planeXZ?: boolean }): Vec3
  translate(delta: Vec3, space?: 'local' | 'world'): void
  rotateY(radians: number): void
  moveToward(target: Vec3 | NodeHandle, maxDistance: number, options?: { faceTarget?: boolean; planeXZ?: boolean }): boolean
  lookAt(target: Vec3 | NodeHandle, options?: { yOnly?: boolean }): void
  sendMessage(name: string, payload?: unknown): void
  broadcast(name: string, payload?: unknown): void
  getBehavior<T = Record<string, (...args: unknown[]) => unknown>>(behavior: unknown): T | null
  findNodeById(id: string): NodeHandle | null
  findNodesByTag(tag: string): readonly NodeHandle[]
  findNodesInRadius(center: Vec3, radius: number, tag?: string): readonly NodeHandle[]
  cloneNode(templateOrName: string | NodeHandle, options?: { position?: Vec3; rotation?: Vec3; scale?: Vec3; parent?: NodeHandle | string | null; visible?: boolean; name?: string; initMessage?: string; initPayload?: unknown }): NodeHandle | null
  spawnPrefab(prefabId: string, options?: { position?: Vec3; rotation?: Vec3; name?: string }): NodeHandle | null
  destroyNode(node: NodeHandle): void
  readonly pool: {
    preload(templateOrPrefab: string | NodeHandle, count: number): void
    acquire(templateOrPrefab: string | NodeHandle, options?: { position?: Vec3; rotation?: Vec3; scale?: Vec3; payload?: unknown }): NodeHandle | null
    release(node: NodeHandle): void
    stats(templateOrPrefab?: string | NodeHandle): { active: number; pooled: number; total: number }
  }
  after(seconds: number, callback: () => void): number
  every(seconds: number, callback: () => void): number
  cancelTimer(timerId: number): void
  readonly physics: {
    raycast(origin: Vec3, dir: Vec3, maxDistance: number): { node: NodeHandle; point: Vec3; normal: Vec3; distance: number } | null
    sphereCast(center: Vec3, radius: number, options?: { tag?: string }): readonly NodeHandle[]
    applyImpulse(impulse: Vec3): void
    applyForce(force: Vec3): void
  }
  readonly nav: {
    moveTo(target: Vec3, speed?: number): boolean
    stop(): void
    readonly isMoving: boolean
  }
  readonly spline: {
    create(pointsOrParent: string | NodeHandle | ReadonlyArray<Vec3 | NodeHandle>, options?: { closed?: boolean; tension?: number }): {
      readonly length: number; readonly closed: boolean; readonly points: readonly Vec3[]
      pointAt(t: number): Vec3; tangentAt(t: number): Vec3
      pointAtDistance(distance: number): Vec3; tangentAtDistance(distance: number): Vec3
    }
    follow(pointsOrParent: string | NodeHandle | ReadonlyArray<Vec3 | NodeHandle>, options?: {
      speed?: number; closed?: boolean; tension?: number; loop?: boolean; pingPong?: boolean
      faceDirection?: boolean; planeXZ?: boolean; startProgress?: number; onArrive?: () => void
    }): boolean
    stop(): void
    readonly isFollowing: boolean
    readonly progress: number
  }
  readonly tween: {
    to(target: NodeHandle | { position?: Vec3; rotation?: Vec3; scale?: Vec3 }, props: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }, duration: number, options?: { ease?: string; delay?: number; repeat?: number; yoyo?: boolean; onUpdate?: (p: number) => void; onComplete?: () => void }): number
    value(from: number, to: number, duration: number, onUpdate: (val: number) => void, options?: { ease?: string; delay?: number; repeat?: number; yoyo?: boolean; onComplete?: () => void }): number
    punchScale(strength?: number, duration?: number): number
    shakePosition(intensity?: number, duration?: number): number
    cancel(tweenId: number): void
    cancelAll(): void
  }
  readonly curve: {
    create(keys: ReadonlyArray<readonly [number, number] | { t: number; v: number; mode?: 'linear' | 'smooth' | 'step' }>, options?: { wrap?: 'clamp' | 'loop' | 'pingPong' }): { eval(t: number): number }
    eval(keys: ReadonlyArray<readonly [number, number] | { t: number; v: number; mode?: 'linear' | 'smooth' | 'step' }>, t: number, options?: { wrap?: 'clamp' | 'loop' | 'pingPong' }): number
    ease(name: string, t: number): number
    parabola(t: number, height?: number): number
    pulse(t: number): number
  }
  readonly crowd: {
    moveTo(target: Vec3 | readonly [number, number, number], options?: { speed?: number; arriveDist?: number; onArrive?: () => void }): void
    stop(): void
    readonly isMoving: boolean
    formation(units: ReadonlyArray<string | NodeHandle>, center: Vec3 | readonly [number, number, number], options?: { formation?: string; spacing?: number; facingYaw?: number; speed?: number; arriveDist?: number }): void
    stats(): { active: number; total: number }
  }
  readonly projectile: {
    launch(options?: {
      direction?: Vec3 | readonly [number, number, number]
      target?: string | NodeHandle | null
      owner?: string | NodeHandle | null
      mode?: 'linear' | 'ballistic' | 'homing'
      speed?: number; gravity?: number; turnRate?: number; maxLifetime?: number
      hitRadius?: number; targetTag?: string; damage?: number; destroyOnHit?: boolean
      onHit?: (hitNode: NodeHandle | null, pos: Vec3) => void
    }): void
    reset(): void
  }
  readonly anim: {
    playBody(clipName: string, opts?: { loop?: boolean; fade?: number; speed?: number }): void
    playUpper(clipName: string, opts?: { loop?: boolean; fade?: number; speed?: number }): void
    stopUpper(fade?: number): void
  }
  readonly character: {
    setModifiers(patch: { moveSpeedMul?: number; gravityMul?: number; inputLock?: boolean }): void
    getModifiers(): { moveSpeedMul?: number; gravityMul?: number; inputLock?: boolean }
    clearModifiers(): void
  }
  readonly input: {
    isPressed(a: string): boolean
    justPressed(a: string): boolean
    isKeyPressed(code: string): boolean
    axis2D(a: string): Vec2
    /** 相对当前相机的世界水平移动方向（y=0，长度为输入强度 0~1） */
    moveDirection(a?: string): Vec3
    pointerDelta(): Vec2
    pointerPosition(): Vec2
    wheelDelta(): number
    isMouseButtonPressed(button: 0 | 1 | 2): boolean
    justPressedMouseButton(button: 0 | 1 | 2): boolean
    justReleasedMouseButton(button: 0 | 1 | 2): boolean
  }
  readonly audio: {
    playSfx(id: string, opts?: { volume?: number; pitch?: number }): void
    playBgm(id: string, opts?: { volume?: number; loop?: boolean }): void
    stopBgm(): void
  }
  readonly fx: {
    spawn(effectId: string, position: Vec3, options?: { scale?: number; autoDestroySec?: number }): NodeHandle | null
  }
  readonly ui: {
    getVar(k: string): unknown
    setVar(k: string, v: unknown): void
    onEvent(eventName: string, handler: (payload?: unknown) => void): () => void
    showScreen(screenIdOrName: string): void
    hideScreen(screenIdOrName: string): void
    toggleScreen(screenIdOrName: string): void
    isScreenVisible(screenIdOrName: string): boolean
    worldToScreen(position: Vec3 | NodeHandle): { x: number; y: number; ndcX: number; ndcY: number; visible: boolean } | null
  }
  readonly scene: {
    currentId(): string
    load(sceneId: string, options?: { spawnPoint?: string }): void
  }
  readonly global: {
    get(key: string): unknown
    set(key: string, value: unknown): void
    remove(key: string): void
  }
  readonly storage: {
    get(key: string): unknown
    set(key: string, value: unknown): void
    remove(key: string): void
  }
  readonly tables: {
    getRow(tableId: string, rowId: string): Record<string, unknown> | null
  }
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
}
export interface GizmosApi {
  readonly isSelected: boolean
  line(from: Vec3 | NodeHandle, to: Vec3 | NodeHandle, opts?: { color?: string }): void
  arrow(from: Vec3 | NodeHandle, dir: Vec3, length?: number, opts?: { color?: string }): void
  wireSphere(center: Vec3 | NodeHandle, radius: number, opts?: { color?: string }): void
  wireBox(center: Vec3 | NodeHandle, size: Vec3, opts?: { color?: string }): void
  disc(center: Vec3 | NodeHandle, radius: number, opts?: { normal?: Vec3; color?: string }): void
  radiusHandle(paramKey: string, opts?: { center?: Vec3 | NodeHandle; axis?: 'x' | 'y' | 'z'; color?: string }): void
  positionHandle(paramKey: string, opts?: { color?: string }): void
}
export function defineBehavior<P extends ScriptParamMap, S extends Record<string, unknown>>(def: {
  name: string; description?: string; params?: P; state?: () => S
  methods?: Record<string, (self: ScriptContext<Record<string, any>, S>, ...args: any[]) => unknown>
  onStart?: (self: ScriptContext<Record<string, any>, S>) => void
  onSpawn?: (self: ScriptContext<Record<string, any>, S>, payload?: unknown) => void
  onUpdate?: (self: ScriptContext<Record<string, any>, S>, dt: number) => void
  onDestroy?: (self: ScriptContext<Record<string, any>, S>) => void
  onMessage?: (self: ScriptContext<Record<string, any>, S>, msg: { name: string; payload?: unknown; sender?: NodeHandle }) => void
  onDrawGizmos?: (self: ScriptContext<Record<string, any>, S>, gizmos: GizmosApi) => void
}): unknown
export function defineSystem<S extends Record<string, unknown>>(def: {
  name: string; description?: string; stage?: 'prePhysics' | 'postPhysics' | 'postAnimation' | 'preRender'; order?: number
  state?: () => S; createState?: () => S
  onMount?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S) => void
  onInit?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S) => void
  onStep?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S, dt: number) => void
  onUpdate?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S, dt: number) => void
  onDispose?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S) => void
  onDestroy?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S) => void
}): unknown
`

export const SHADER_DTS_SUMMARY = `export interface ShaderNode {
  add(other: unknown): ShaderNode; sub(other: unknown): ShaderNode; mul(other: unknown): ShaderNode; div(other: unknown): ShaderNode
  min(other: unknown): ShaderNode; max(other: unknown): ShaderNode; pow(other: unknown): ShaderNode; mod(other: unknown): ShaderNode
  clamp(min?: unknown, max?: unknown): ShaderNode; abs(): ShaderNode; fract(): ShaderNode; floor(): ShaderNode; ceil(): ShaderNode
  sin(): ShaderNode; cos(): ShaderNode; sqrt(): ShaderNode; negate(): ShaderNode; oneMinus(): ShaderNode; saturate(): ShaderNode; normalize(): ShaderNode; length(): ShaderNode
  dot(other: unknown): ShaderNode; cross(other: unknown): ShaderNode
  readonly x: ShaderNode; readonly y: ShaderNode; readonly z: ShaderNode; readonly w: ShaderNode
  readonly r: ShaderNode; readonly g: ShaderNode; readonly b: ShaderNode; readonly a: ShaderNode
  readonly xy: ShaderNode; readonly xyz: ShaderNode; readonly rgb: ShaderNode
}
export function defineShader(def: {
  name: string; description?: string; mode?: 'lit' | 'unlit'; transparent?: boolean; doubleSided?: boolean
  params?: Record<string, unknown>
  surface: (params: Record<string, any>) => {
    baseColor?: unknown; normal?: unknown; roughness?: unknown; metalness?: unknown
    emissive?: unknown; opacity?: unknown; vertexOffset?: unknown
  }
}): unknown
export function float(x?: number): ShaderNode
export function vec2(x?: number, y?: number): ShaderNode
export function vec3(x?: number, y?: number, z?: number): ShaderNode
export function vec4(x?: number, y?: number, z?: number, w?: number): ShaderNode
export function color(hexOrR: string | number, g?: number, b?: number): ShaderNode
export function mix(a: unknown, b: unknown, t: unknown): ShaderNode
export function clamp(x: unknown, min?: unknown, max?: unknown): ShaderNode
export function smoothstep(edge0: unknown, edge1: unknown, x: unknown): ShaderNode
export function step(edge: unknown, x: unknown): ShaderNode
export function sin(x: unknown): ShaderNode
export function cos(x: unknown): ShaderNode
export function tan(x: unknown): ShaderNode
export function abs(x: unknown): ShaderNode
export function sign(x: unknown): ShaderNode
export function floor(x: unknown): ShaderNode
export function ceil(x: unknown): ShaderNode
export function fract(x: unknown): ShaderNode
export function pow(x: unknown, y: unknown): ShaderNode
export function sqrt(x: unknown): ShaderNode
export function exp(x: unknown): ShaderNode
export function log(x: unknown): ShaderNode
export function saturate(x: unknown): ShaderNode
export function min(a: unknown, b: unknown): ShaderNode
export function max(a: unknown, b: unknown): ShaderNode
export function dot(a: unknown, b: unknown): ShaderNode
export function cross(a: unknown, b: unknown): ShaderNode
export function normalize(v: unknown): ShaderNode
export function length(v: unknown): ShaderNode
export function distance(a: unknown, b: unknown): ShaderNode
export function reflect(incident: unknown, normal: unknown): ShaderNode
export function fwidth(x: unknown): ShaderNode
export function fresnel(normal: unknown, viewDir: unknown, power?: unknown): ShaderNode
export function texture(texRef: unknown, uv?: unknown): ShaderNode
export function uv(index?: number): ShaderNode
export const time: ShaderNode
export const deltaTime: ShaderNode
export const normalView: ShaderNode
export const normalWorld: ShaderNode
export const normalLocal: ShaderNode
export const positionWorld: ShaderNode
export const positionLocal: ShaderNode
export const viewDirection: ShaderNode
export const cameraPosition: ShaderNode
export const screenUV: ShaderNode
export function vertexColor(): ShaderNode
`
