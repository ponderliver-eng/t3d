// 测试桩：让 electron/services/* 在纯 Node 环境下可被导入
export const net: { fetch?: typeof fetch } = {}
