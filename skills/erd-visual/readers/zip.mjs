/* 최소 ZIP 리더 — Node 에 zip 이 내장돼 있지 않아서 직접 만든다.
 * xlsx 는 XML 을 담은 zip 이다. 외부 의존성을 붙이지 않기 위한 것이므로
 * 필요한 만큼만 읽는다: 저장(0)과 deflate(8) 두 방식.
 */

import zlib from 'zlib';

const EOCD = 0x06054b50;
const EOCD64_LOC = 0x07064b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

/** 끝에서부터 EOCD 를 찾는다 (주석이 붙어 있을 수 있다) */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 66 * 1024);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  return -1;
}

export function unzip(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('ZIP 이 아닙니다 (EOCD 없음)');

  let count = buf.readUInt16LE(eocd + 10);
  let cdOff = buf.readUInt32LE(eocd + 16);

  // ZIP64 — 항목이 65535 를 넘거나 4GB 를 넘으면 여기로 온다
  if (count === 0xffff || cdOff === 0xffffffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === EOCD64_LOC) {
        const z64 = Number(buf.readBigUInt64LE(i + 8));
        count = Number(buf.readBigUInt64LE(z64 + 32));
        cdOff = Number(buf.readBigUInt64LE(z64 + 48));
        break;
      }
    }
  }

  const files = new Map();
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files.set(name, { method, csize, lho });
    p += 46 + nameLen + extraLen + cmtLen;
  }

  return {
    names: () => [...files.keys()],
    has: n => files.has(n),
    read(name) {
      const e = files.get(name);
      if (!e) throw new Error('zip 안에 없는 항목: ' + name);
      // 로컬 헤더의 길이는 중앙 디렉터리와 다를 수 있다. 반드시 로컬을 읽는다.
      if (buf.readUInt32LE(e.lho) !== LOC) throw new Error('손상된 로컬 헤더: ' + name);
      const nl = buf.readUInt16LE(e.lho + 26);
      const el = buf.readUInt16LE(e.lho + 28);
      const start = e.lho + 30 + nl + el;
      const raw = buf.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) return zlib.inflateRawSync(raw);
      throw new Error('지원하지 않는 압축 방식 ' + e.method + ': ' + name);
    },
    text(name) { return this.read(name).toString('utf8'); },
  };
}
