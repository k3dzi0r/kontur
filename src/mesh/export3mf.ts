import { strToU8, zipSync } from 'fflate';
import type { MeshData } from '../types';

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (v: number) => {
  const r = Math.round(v * 1e5) / 1e5;
  return Object.is(r, -0) ? '0' : String(r);
};

export interface Named3mfObject {
  name: string;
  mesh: MeshData;
}

/** Treść pliku 3D/3dmodel.model (3MF Core, jednostka: milimetr). Każda część = osobny obiekt. */
export function build3mfModelXml(objects: Named3mfObject[], title: string): string {
  const parts: string[] = [];
  parts.push(
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<model unit="millimeter" xml:lang="pl-PL" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
    `<metadata name="Title">${esc(title)}</metadata>\n`,
    '<metadata name="Application">Wycinanka 3D</metadata>\n',
    '<resources>\n',
  );
  objects.forEach(({ name, mesh }, k) => {
    const { positions: p, indices } = mesh;
    parts.push(`<object id="${k + 1}" type="model" name="${esc(name)}">\n<mesh>\n<vertices>\n`);
    for (let i = 0; i < p.length; i += 3) {
      parts.push(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>\n`);
    }
    parts.push('</vertices>\n<triangles>\n');
    for (let t = 0; t < indices.length; t += 3) {
      parts.push(`<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>\n`);
    }
    parts.push('</triangles>\n</mesh>\n</object>\n');
  });
  parts.push('</resources>\n<build>\n');
  objects.forEach((_, k) => parts.push(`<item objectid="${k + 1}"/>\n`));
  parts.push('</build>\n</model>\n');
  return parts.join('');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** Paczka 3MF (ZIP). `mesh` może być jedną siatką albo listą nazwanych obiektów. */
export function export3mf(mesh: MeshData | Named3mfObject[], name = 'wycinanka'): Uint8Array {
  const objects = Array.isArray(mesh) ? mesh : [{ name, mesh }];
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      _rels: { '.rels': strToU8(RELS) },
      '3D': { '3dmodel.model': strToU8(build3mfModelXml(objects, name)) },
    },
    { level: 6 },
  );
}
