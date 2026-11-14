export interface DecodedTgaImage {
  width: number
  height: number
  rgba: Uint8Array
}

export function decodeTgaToRgba(bytes: Uint8Array): DecodedTgaImage {
  if (bytes.length < 18) throw new Error('TGA header is truncated.')
  const idLength = bytes[0]!
  const colorMapType = bytes[1]!
  const imageType = bytes[2]!
  const colorMapFirst = readU16(bytes, 3)
  const colorMapLength = readU16(bytes, 5)
  const colorMapDepth = bytes[7]!
  const width = readU16(bytes, 12)
  const height = readU16(bytes, 14)
  const pixelDepth = bytes[16]!
  const descriptor = bytes[17]!
  if (width <= 0 || height <= 0) throw new Error('TGA dimensions are invalid.')

  const hasColorMap = colorMapType === 1
  const supportedType = imageType === 1 || imageType === 2 || imageType === 3 || imageType === 9 || imageType === 10 || imageType === 11
  if (!supportedType) throw new Error(`Unsupported TGA image type ${imageType}.`)
  if (colorMapType !== 0 && !hasColorMap) throw new Error(`Unsupported TGA color map type ${colorMapType}.`)
  if (!hasColorMap && ![8, 24, 32].includes(pixelDepth)) throw new Error(`Unsupported TGA pixel depth ${pixelDepth}.`)
  if (hasColorMap && ![8, 15, 16, 24, 32].includes(colorMapDepth)) throw new Error(`Unsupported TGA color map depth ${colorMapDepth}.`)

  let offset = 18 + idLength
  const palette: Uint8Array[] = []
  if (hasColorMap) {
    const entryBytes = Math.ceil(colorMapDepth / 8)
    for (let i = 0; i < colorMapLength; i += 1) {
      palette[colorMapFirst + i] = readTgaColor(bytes, offset, colorMapDepth)
      offset += entryBytes
    }
  }

  const rgba = new Uint8Array(width * height * 4)
  const originTop = (descriptor & 0x20) !== 0
  const originRight = (descriptor & 0x10) !== 0
  const totalPixels = width * height
  let pixelIndex = 0

  const readPixel = (): Uint8Array => {
    if (hasColorMap) {
      const indexBytes = Math.ceil(pixelDepth / 8)
      if (offset + indexBytes > bytes.length) throw new Error('TGA pixel data is truncated.')
      const index = indexBytes === 1 ? bytes[offset]! : readU16(bytes, offset)
      offset += indexBytes
      return palette[index] ?? new Uint8Array([0, 0, 0, 0])
    }
    const color = readTgaColor(bytes, offset, pixelDepth)
    offset += Math.ceil(pixelDepth / 8)
    return color
  }

  const writePixel = (color: Uint8Array) => {
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)
    const destX = originRight ? width - 1 - x : x
    const destY = originTop ? y : height - 1 - y
    const dest = (destY * width + destX) * 4
    rgba[dest] = color[0]!
    rgba[dest + 1] = color[1]!
    rgba[dest + 2] = color[2]!
    rgba[dest + 3] = color[3]!
    pixelIndex += 1
  }

  if (imageType === 9 || imageType === 10 || imageType === 11) {
    while (pixelIndex < totalPixels) {
      if (offset >= bytes.length) throw new Error('TGA RLE packet is truncated.')
      const packet = bytes[offset++]!
      const count = (packet & 0x7f) + 1
      if ((packet & 0x80) !== 0) {
        const color = readPixel()
        for (let i = 0; i < count && pixelIndex < totalPixels; i += 1) writePixel(color)
      } else {
        for (let i = 0; i < count && pixelIndex < totalPixels; i += 1) writePixel(readPixel())
      }
    }
  } else {
    while (pixelIndex < totalPixels) writePixel(readPixel())
  }

  return { width, height, rgba }
}

export function encodeRgbaToPng(image: DecodedTgaImage): Uint8Array {
  const stride = image.width * 4
  const scanlines = new Uint8Array((stride + 1) * image.height)
  for (let y = 0; y < image.height; y += 1) {
    const src = y * stride
    const dest = y * (stride + 1)
    scanlines[dest] = 0
    scanlines.set(image.rgba.subarray(src, src + stride), dest + 1)
  }

  const chunks = [
    pngChunk('IHDR', ihdrBytes(image.width, image.height)),
    pngChunk('IDAT', zlibStore(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ]
  return concatBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks)
}

function readTgaColor(bytes: Uint8Array, offset: number, depth: number): Uint8Array {
  if (offset + Math.ceil(depth / 8) > bytes.length) throw new Error('TGA pixel data is truncated.')
  if (depth === 8) {
    const gray = bytes[offset]!
    return new Uint8Array([gray, gray, gray, 255])
  }
  if (depth === 15 || depth === 16) {
    const value = readU16(bytes, offset)
    const r = Math.round(((value >> 10) & 0x1f) * 255 / 31)
    const g = Math.round(((value >> 5) & 0x1f) * 255 / 31)
    const b = Math.round((value & 0x1f) * 255 / 31)
    return new Uint8Array([r, g, b, 255])
  }
  if (depth === 24 || depth === 32) {
    const b = bytes[offset]!
    const g = bytes[offset + 1]!
    const r = bytes[offset + 2]!
    const a = depth === 32 ? bytes[offset + 3]! : 255
    return new Uint8Array([r, g, b, a])
  }
  throw new Error(`Unsupported TGA color depth ${depth}.`)
}

function ihdrBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13)
  writeU32(bytes, 0, width)
  writeU32(bytes, 4, height)
  bytes[8] = 8
  bytes[9] = 6
  bytes[10] = 0
  bytes[11] = 0
  bytes[12] = 0
  return bytes
}

function zlibStore(input: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
  for (let offset = 0; offset < input.length;) {
    const length = Math.min(0xffff, input.length - offset)
    const final = offset + length >= input.length ? 1 : 0
    const header = new Uint8Array(5)
    header[0] = final
    header[1] = length & 0xff
    header[2] = (length >> 8) & 0xff
    const nlen = (~length) & 0xffff
    header[3] = nlen & 0xff
    header[4] = (nlen >> 8) & 0xff
    blocks.push(header, input.subarray(offset, offset + length))
    offset += length
  }
  const adler = new Uint8Array(4)
  writeU32(adler, 0, adler32(input))
  blocks.push(adler)
  return concatBytes(...blocks)
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(12 + data.length)
  writeU32(out, 0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  writeU32(out, 8 + data.length, crc32(concatBytes(typeBytes, data)))
  return out
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}
