import type { KnownAnalog, Meta, TargetsFile, ValidationFile } from './types';

export interface Dataset {
  meta: Meta;
  targets: TargetsFile;
  analogs: KnownAnalog[];
  validation: ValidationFile | null;
  features: ArrayBuffer;
  cells: ArrayBuffer;
  countries: ArrayBuffer;
}

const BASE = `${import.meta.env.BASE_URL}data/`;

type Progress = (loaded: number, total: number, label: string) => void;

async function fetchBytes(url: string, onBytes: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Gunzip if the payload still starts with the gzip magic (servers may or may not have decoded it). */
async function maybeGunzip(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function headSize(url: string): Promise<number> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return Number(r.headers.get('content-length') || 0);
  } catch {
    return 0;
  }
}

export async function loadDataset(onProgress: Progress): Promise<Dataset> {
  const getJson = async <T>(name: string): Promise<T> => {
    const r = await fetch(BASE + name);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return (await r.json()) as T;
  };
  onProgress(0, 1, 'metadata');
  const [meta, targets, analogsFile, validation] = await Promise.all([
    getJson<Meta>('meta.json'),
    getJson<TargetsFile>('targets.json'),
    getJson<{ analogs: KnownAnalog[] }>('known_analogs.json'),
    getJson<ValidationFile>('validation.json').catch(() => null),
  ]);
  // The .gz files are served with a one-year immutable cache (web/vercel.json); the version query makes a
  // new pipeline run (new meta.generated) fetch fresh copies.
  const v = `?v=${encodeURIComponent(meta.generated)}`;
  const files = [meta.files.features, meta.files.cells, meta.files.countries].map((f) => f + v);
  const sizes = await Promise.all(files.map((f) => headSize(BASE + f)));
  const fallbackSizes = [meta.n_cells * meta.n_features * 0.6, meta.n_cells * 1.4, meta.n_cells * 0.02];
  const total = sizes.reduce((a, s, i) => a + (s || fallbackSizes[i]), 0);
  let loaded = 0;
  const bump = (n: number) => {
    loaded += n;
    onProgress(Math.min(loaded, total), total, 'grid data');
  };
  const raw = await Promise.all(files.map((f) => fetchBytes(BASE + f, bump)));
  onProgress(total, total, 'decompressing');
  const [features, cells, countries] = await Promise.all(raw.map(maybeGunzip));
  if (features.byteLength !== meta.n_cells * meta.n_features) {
    throw new Error(`features.bin size ${features.byteLength} != ${meta.n_cells} x ${meta.n_features}`);
  }
  return { meta, targets, analogs: analogsFile.analogs, validation, features, cells, countries };
}
