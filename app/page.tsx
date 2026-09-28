'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { icon } from '@fortawesome/fontawesome-svg-core';
import type { IconDefinition as FontAwesomeIconDefinition } from '@fortawesome/fontawesome-common-types';
import * as brandIcons from '@fortawesome/free-brands-svg-icons';
import * as regularIcons from '@fortawesome/free-regular-svg-icons';
import * as solidIcons from '@fortawesome/free-solid-svg-icons';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import type { FontData } from 'three/examples/jsm/loaders/FontLoader.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import helvetikerRegular from 'three/examples/fonts/helvetiker_regular.typeface.json';
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import optimerRegular from 'three/examples/fonts/optimer_regular.typeface.json';
import droidSansMono from 'three/examples/fonts/droid/droid_sans_mono_regular.typeface.json';

type IconDefinition = FontAwesomeIconDefinition;
type IconStyle = 'brands' | 'solid' | 'regular';
type InputMode = 'icon' | 'svg' | 'text';
type FontChoice = 'helvetiker' | 'helvetiker-bold' | 'optimer' | 'droid-mono';

function buildIconMap(m: Record<string, unknown>) {
  return Object.values(m).reduce<Record<string, IconDefinition>>((r, c) => {
    if (c && typeof c === 'object' && 'iconName' in c && 'icon' in c) {
      const d = c as IconDefinition;
      r[d.iconName] = d;
    }
    return r;
  }, {});
}

const iconMaps: Record<IconStyle, Record<string, IconDefinition>> = {
  brands: buildIconMap(brandIcons),
  solid: buildIconMap(solidIcons),
  regular: buildIconMap(regularIcons),
};

const examples = [
  { label: 'USB', value: '<i class="fa-brands fa-usb"></i>' },
  { label: 'Bolt', value: '<i class="fa-solid fa-bolt"></i>' },
  { label: 'Cube', value: '<i class="fa-solid fa-cube"></i>' },
];

const fonts: { value: FontChoice; label: string; data: FontData; preview: string }[] = [
  { value: 'helvetiker', label: 'Helvetiker Regular', data: helvetikerRegular, preview: 'Arial, sans-serif' },
  { value: 'helvetiker-bold', label: 'Helvetiker Bold', data: helvetikerBold, preview: 'Arial, sans-serif' },
  { value: 'optimer', label: 'Optimer Regular', data: optimerRegular, preview: 'Georgia, serif' },
  { value: 'droid-mono', label: 'Droid Sans Mono', data: droidSansMono, preview: 'monospace' },
];

function parseIconTag(v: string) {
  const cs = v.match(/class\s*=\s*["']([^"']+)["']/i)?.[1].split(/\s+/) ?? v.trim().split(/\s+/);
  const n = cs.find((x) => x.startsWith('fa-') && !['fa-brands', 'fa-solid', 'fa-regular', 'fa-light', 'fa-thin', 'fa-duotone'].includes(x));
  const s = cs.find((x) => ['fa-brands', 'fa-solid', 'fa-regular'].includes(x));
  return { name: n?.replace(/^fa-/, '') ?? '', style: s === 'fa-brands' ? 'brands' as const : s === 'fa-regular' ? 'regular' as const : 'solid' as const };
}

function getIconDefinition(n: string, s: IconStyle) {
  return iconMaps[s][n] ?? iconMaps.solid[n] ?? iconMaps.regular[n] ?? iconMaps.brands[n];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildPrintableGroup(g: THREE.ExtrudeGeometry, w: number, h: number, withBackingPlate: boolean, plateDepth: number): THREE.Group {
  g.computeBoundingBox();
  if (!g.boundingBox) throw new Error('Could not measure design geometry.');

  const gw = g.boundingBox.max.x - g.boundingBox.min.x;
  const gh = g.boundingBox.max.y - g.boundingBox.min.y;
  if (!gw || !gh) throw new Error('Design geometry has no measurable area.');

  const plateMargin = 0.8;
  const scale = Math.min((w - (withBackingPlate ? plateMargin * 2 : 0)) / gw, (h - (withBackingPlate ? plateMargin * 2 : 0)) / gh);
  g.scale(scale, scale, 1);
  g.computeBoundingBox();
  if (!g.boundingBox) throw new Error('Could not measure scaled design geometry.');
  if (g.getAttribute('position').count / 3 > 120000) throw new Error('That design is too detailed for a lightweight STL export.');

  const designMesh = new THREE.Mesh(g);
  const group = new THREE.Group();
  group.add(designMesh);

  if (withBackingPlate) {
    const b = g.boundingBox;
    const plateShape = new THREE.Shape();
    plateShape.moveTo(b.min.x - plateMargin, b.min.y - plateMargin);
    plateShape.lineTo(b.max.x + plateMargin, b.min.y - plateMargin);
    plateShape.lineTo(b.max.x + plateMargin, b.max.y + plateMargin);
    plateShape.lineTo(b.min.x - plateMargin, b.max.y + plateMargin);
    plateShape.closePath();

    const plate = new THREE.ExtrudeGeometry(plateShape, { depth: plateDepth, bevelEnabled: false, curveSegments: 1, steps: 1 });
    const overlap = Math.min(0.05, plateDepth * 0.25);
    designMesh.position.z = plateDepth - overlap;
    group.add(new THREE.Mesh(plate));
  }

  const bounds = new THREE.Box3().setFromObject(group);
  group.position.set(-(bounds.min.x + bounds.max.x) / 2, -(bounds.min.y + bounds.max.y) / 2, -bounds.min.z);
  group.updateMatrixWorld(true);
  return group;
}

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : '#FFFFFF';
}

function meshTo3mfObject(mesh: THREE.Mesh, id: number, materialIndex: number, name: string) {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const positions = geometry.getAttribute('position');
  const vertices: string[] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    vertices.push(`<vertex x="${point.x.toFixed(5)}" y="${point.y.toFixed(5)}" z="${point.z.toFixed(5)}"/>`);
  }

  const triangles: string[] = [];
  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) triangles.push(`<triangle v1="${index.getX(i)}" v2="${index.getX(i + 1)}" v3="${index.getX(i + 2)}"/>`);
  } else {
    for (let i = 0; i < positions.count; i += 3) triangles.push(`<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`);
  }

  return `<object id="${id}" type="model" name="${xmlEscape(name)}" pid="1" pindex="${materialIndex}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const entries: { name: Uint8Array; data: Uint8Array; crc: number; offset: number }[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0, true); view.setUint16(8, 0, true);
    view.setUint16(10, 0, true); view.setUint16(12, 0, true); view.setUint32(14, crc, true); view.setUint32(18, file.data.length, true); view.setUint32(22, file.data.length, true); view.setUint16(26, name.length, true); view.setUint16(28, 0, true);
    header.set(name, 30);
    localParts.push(header, file.data);
    entries.push({ name, data: file.data, crc, offset });
    offset += header.length + file.data.length;
  }

  let centralOffset = offset;
  for (const entry of entries) {
    const header = new Uint8Array(46 + entry.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint16(8, 0, true); view.setUint16(10, 0, true);
    view.setUint16(12, 0, true); view.setUint16(14, 0, true); view.setUint32(16, entry.crc, true); view.setUint32(20, entry.data.length, true); view.setUint32(24, entry.data.length, true); view.setUint16(28, entry.name.length, true); view.setUint16(30, 0, true); view.setUint16(32, 0, true); view.setUint16(34, 0, true); view.setUint16(36, 0, true); view.setUint32(38, 0, true); view.setUint32(42, entry.offset, true);
    header.set(entry.name, 46);
    centralParts.push(header);
    centralOffset += header.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true); endView.setUint32(12, centralOffset - offset, true); endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + (centralOffset - offset) + end.length);
  let cursor = 0;
  for (const part of localParts) { output.set(part, cursor); cursor += part.length; }
  for (const part of centralParts) { output.set(part, cursor); cursor += part.length; }
  output.set(end, cursor);
  return output.buffer;
}

function makePrintable3mf(group: THREE.Group, designColor: string, plateColor: string) {
  group.updateMatrixWorld(true);
  const meshes = group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  const objects = meshes.map((mesh, index) => meshTo3mfObject(mesh, index + 1, index === 0 ? 0 : 1, index === 0 ? 'Design' : 'Backing Plate'));
  const items = meshes.map((_, index) => `<item objectid="${index + 1}"/>`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="1"><base name="Design" displaycolor="${safeColor(designColor)}"/><base name="Backing Plate" displaycolor="${safeColor(plateColor)}"/></basematerials>${objects.join('')}</resources><build>${items}</build></model>`;
  const types = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const relationships = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  const encoder = new TextEncoder();
  return makeZip([
    { name: '[Content_Types].xml', data: encoder.encode(types) },
    { name: '_rels/.rels', data: encoder.encode(relationships) },
    { name: '3D/3dmodel.model', data: encoder.encode(model) },
  ]);
}

function make3mfFromSvg(markup: string, w: number, h: number, d: number, withBackingPlate: boolean, plateDepth: number, designColor: string, plateColor: string): ArrayBuffer {
  const data = new SVGLoader().parse(markup);
  const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
  if (!shapes.length) throw new Error('Could not read SVG geometry. Use SVG paths or filled shapes.');
  const g = new THREE.ExtrudeGeometry(shapes, { depth: d, bevelEnabled: false, curveSegments: 2, steps: 1 });
  const group = buildPrintableGroup(g, w, h, withBackingPlate, plateDepth);
  const out = makePrintable3mf(group, designColor, plateColor);
  group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  return out;
}

function make3mfFromText(text: string, fontChoice: FontChoice, w: number, h: number, d: number, withBackingPlate: boolean, plateDepth: number, designColor: string, plateColor: string): ArrayBuffer {
  const fontData = fonts.find((font) => font.value === fontChoice)?.data;
  if (!fontData) throw new Error('That font is not available.');
  const font = new FontLoader().parse(fontData);
  const shapes = font.generateShapes(text, 100);
  if (!shapes.length) throw new Error('Enter some text to create a printable design.');
  const g = new THREE.ExtrudeGeometry(shapes, { depth: d, bevelEnabled: false, curveSegments: 3, steps: 1 });
  const group = buildPrintableGroup(g, w, h, withBackingPlate, plateDepth);
  const out = makePrintable3mf(group, designColor, plateColor);
  group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  return out;
}

function download3mf(data: ArrayBuffer, name: string) {
  const u = URL.createObjectURL(new Blob([data], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = `${name || 'design'}.3mf`;
  a.click();
  URL.revokeObjectURL(u);
}

export default function Home() {
  const [mode, setMode] = useState<InputMode>('icon');
  const [input, setInput] = useState(examples[0].value);
  const [svg, setSvg] = useState('');
  const [text, setText] = useState('MAKE');
  const [fontChoice, setFontChoice] = useState<FontChoice>('helvetiker-bold');
  const [fileName, setFileName] = useState('');
  const [width, setWidth] = useState(40);
  const [height, setHeight] = useState(40);
  const [depth, setDepth] = useState(3);
  const [backingPlate, setBackingPlate] = useState(true);
  const [plateThickness, setPlateThickness] = useState(0.6);
  const [designColor, setDesignColor] = useState('#C1F264');
  const [plateColor, setPlateColor] = useState('#40513A');
  const [active, setActive] = useState('USB');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const parsed = useMemo(() => parseIconTag(input), [input]);
  const def = getIconDefinition(parsed.name, parsed.style);
  const iconSvg = def ? icon(def).html.join('') : '';
  const preview = mode === 'svg' ? svg : mode === 'icon' ? iconSvg : '';
  const selectedFont = fonts.find((font) => font.value === fontChoice) ?? fonts[0];
  const detectedLabel = mode === 'svg' ? 'FILE' : mode === 'text' ? 'TEXT' : 'ICON';
  const detectedValue = mode === 'svg' ? (fileName || 'CUSTOM SVG') : mode === 'text' ? (text || 'UNTITLED TEXT') : (parsed.name ? `fa-${parsed.name}` : '—');

  useEffect(() => {
    if (!canvas.current) return;
    const c = canvas.current;
    const x = c.getContext('2d');
    if (!x) return;
    x.clearRect(0, 0, c.width, c.height);
    if (mode === 'text') {
      const lines = text.split(/\r?\n/).slice(0, 3);
      const longest = Math.max(...lines.map((line) => line.length), 1);
      const size = Math.min(74, Math.max(24, 330 / longest));
      x.fillStyle = designColor;
      x.font = `700 ${size}px ${selectedFont.preview}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      lines.forEach((line, index) => x.fillText(line || ' ', c.width / 2, c.height / 2 + (index - (lines.length - 1) / 2) * size * 1.15));
      return;
    }
    if (!preview) return;
    const im = new Image();
    im.onload = () => {
      const inset = 46;
      const r = Math.min((c.width - inset * 2) / im.width, (c.height - inset * 2) / im.height);
      x.drawImage(im, (c.width - im.width * r) / 2, (c.height - im.height * r) / 2, im.width * r, im.height * r);
      URL.revokeObjectURL(im.src);
    };
    const previewSvg = preview.replace(/<svg\b/i, `<svg fill="${designColor}" style="color:${designColor}"`).replace(/\sfill=(["'])[^"']*\1/gi, ` fill="${designColor}"`);
    im.src = URL.createObjectURL(new Blob([previewSvg], { type: 'image/svg+xml' }));
  }, [preview, mode, text, selectedFont, designColor]);

  const loadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setSvg(await f.text());
      setFileName(f.name);
      setMode('svg');
      setError('');
    } catch {
      setError('That SVG file could not be read.');
    }
    e.target.value = '';
  };

  const exportStl = () => {
    if (mode === 'icon' && !def) {
      setError('That icon is not in the starter library.');
      return;
    }
    if (mode === 'svg' && !svg.trim()) {
      setError('Paste SVG markup or choose an SVG file first.');
      return;
    }
    if (mode === 'text' && !text.trim()) {
      setError('Enter some text to create a printable design.');
      return;
    }
    try {
      setBusy(true);
      setError('');
      const data = mode === 'text'
        ? make3mfFromText(text, fontChoice, width, height, depth, backingPlate, plateThickness, designColor, plateColor)
        : make3mfFromSvg(mode === 'svg' ? svg : icon(def!).html.join(''), width, height, depth, backingPlate, plateThickness, designColor, plateColor);
      const name = mode === 'text' ? text.trim().split(/\s+/).slice(0, 3).join('-').replace(/[^a-z0-9-_]/gi, '') : mode === 'svg' ? fileName.replace(/\.svg$/i, '') : parsed.name;
      download3mf(data, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This design could not be converted.');
    } finally {
      window.setTimeout(() => setBusy(false), 400);
    }
  };

  return <main className="shell">
    <nav className="nav"><div className="brand"><span className="brand-mark">&#10022;</span><span>ICONFORGE</span></div><div className="nav-meta"><span className="status-dot"/> STL EXPORT LAB <span className="nav-divider"/> v1.0</div></nav>
    <section className="hero"><div className="eyebrow"><span className="eyebrow-line"/> VECTOR &#8594; 3D PRINT</div><h1>Turn a design into<br/><em>something real.</em></h1><p>Paste a Font Awesome icon, type text, or upload an SVG, dial in the dimensions, and download a print-ready STL in seconds.</p></section>
    <section className="workspace">
      <div className="input-panel panel"><div className="panel-heading"><div><span className="step">01</span><h2>Input your design</h2></div><span className="heading-note">SOURCE</span></div><div className="mode-row"><button className={mode === 'icon' ? 'mode active' : 'mode'} onClick={() => setMode('icon')}>FONT AWESOME</button><button className={mode === 'text' ? 'mode active' : 'mode'} onClick={() => setMode('text')}>TEXT</button><button className={mode === 'svg' ? 'mode active' : 'mode'} onClick={() => setMode('svg')}>SVG</button></div>{mode === 'icon' ? <><label htmlFor="icon-input">FONT AWESOME MARKUP</label><div className="code-input"><span className="code-caret">&gt;</span><textarea id="icon-input" value={input} onChange={e => { setInput(e.target.value); setActive(''); setError(''); }} spellCheck={false}/><span className="code-end">_</span></div><div className="quick-row"><span>TRY AN EXAMPLE</span>{examples.map(ex => <button key={ex.label} className={active === ex.label ? 'quick active' : 'quick'} onClick={() => { setInput(ex.value); setActive(ex.label); setError(''); }}>{ex.label}</button>)}</div></> : mode === 'text' ? <><label htmlFor="text-input">TEXT TO EXTRUDE</label><div className="code-input text-input"><span className="code-caret">&gt;</span><textarea id="text-input" placeholder="Type a word or short phrase" value={text} onChange={e => { setText(e.target.value); setError(''); }} spellCheck={false}/><span className="code-end">_</span></div><div className="font-select"><label htmlFor="font-choice">FONT</label><select id="font-choice" value={fontChoice} onChange={e => setFontChoice(e.target.value as FontChoice)}>{fonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></div></> : <><label htmlFor="svg-input">SVG MARKUP</label><div className="code-input"><span className="code-caret">&gt;</span><textarea id="svg-input" placeholder="Paste an &lt;svg&gt;...&lt;/svg&gt; here" value={svg} onChange={e => { setSvg(e.target.value); setFileName(''); setError(''); }} spellCheck={false}/><span className="code-end">_</span></div><div className="svg-upload"><label className="file-button">CHOOSE SVG FILE<input type="file" accept=".svg,image/svg+xml" onChange={loadFile}/></label><span>{fileName || 'or paste SVG markup above'}</span></div></>}</div>
      <div className="preview-panel panel"><div className="panel-heading"><div><span className="step">02</span><h2>Preview</h2></div><span className="heading-note live"><span className="live-dot"/> LIVE</span></div><div className="preview-stage"><div className="grid-floor"/><canvas ref={canvas} width={500} height={330} aria-label="Design preview"/>{!preview && mode !== 'text' && <div className="preview-empty">?</div>}<div className="dimension-tag">{width} &times; {height} &times; {depth + (backingPlate ? plateThickness : 0)} mm</div></div><div className="preview-footer"><div><span className="mini-label">DETECTED {detectedLabel}</span><strong>{detectedValue}</strong></div><div className="style-pill">{mode === 'svg' ? 'svg' : mode === 'text' ? selectedFont.label : parsed.style}</div></div></div>
    </section>
    <section className="controls panel"><div className="panel-heading"><div><span className="step">03</span><h2>Set your dimensions</h2></div><span className="heading-note">MILLIMETERS</span></div><div className="control-grid"><Dimension label="WIDTH" value={width} setValue={setWidth} min={10} max={100}/><Dimension label="HEIGHT" value={height} setValue={setHeight} min={10} max={100}/><Dimension label="EXTRUSION" value={depth} setValue={setDepth} min={1} max={15}/></div><div className="plate-settings"><label className="plate-toggle"><input type="checkbox" checked={backingPlate} onChange={e => setBackingPlate(e.target.checked)}/><span className="plate-checkbox" aria-hidden="true"/><span><strong>ADD BACKING PLATE</strong><small>Connects separate icon pieces or letters into one print</small></span></label>{backingPlate && <div className="plate-thickness"><div className="dimension-top"><label htmlFor="plate-thickness">PLATE THICKNESS</label><div className="number-input"><input id="plate-thickness" type="number" min="0.2" max="2" step="0.1" value={plateThickness} onChange={e => setPlateThickness(clamp(Number(e.target.value) || 0.2, 0.2, 2))}/><span>mm</span></div></div><input className="range" type="range" min="0.2" max="2" step="0.1" value={plateThickness} onChange={e => setPlateThickness(Number(e.target.value))}/></div>}</div><div className="color-settings"><ColorControl label="DESIGN COLOR" value={designColor} setValue={setDesignColor}/>{backingPlate && <ColorControl label="BACKING COLOR" value={plateColor} setValue={setPlateColor}/>}</div><div className="controls-bottom"><div className="print-note"><strong>PRINT TIP</strong> 3MF stores the design and backing plate as separate color-assigned parts.</div><button className="export-button" onClick={exportStl} disabled={busy}>{busy ? 'BUILDING 3MF...' : <>EXPORT 3MF <span>&#8594;</span></>}</button></div>{error && <div className="error">{error}</div>}</section>
    <footer><span>MADE FOR MAKERS</span><span className="footer-center">ICONFORGE / 2025</span><span>NO ACCOUNT &middot; NO FUSS</span></footer>
  </main>;
}

function Dimension({ label, value, setValue, min, max }: { label: string; value: number; setValue: (v: number) => void; min: number; max: number }) {
  return <div className="dimension"><div className="dimension-top"><label>{label}</label><div className="number-input"><input type="number" min={min} max={max} value={value} onChange={e => setValue(Math.max(min, Math.min(max, Number(e.target.value) || min)))}/><span>mm</span></div></div><input className="range" type="range" min={min} max={max} value={value} onChange={e => setValue(Number(e.target.value))}/></div>;
}

function ColorControl({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return <label className="color-control"><span>{label}</span><input type="color" value={value} onChange={e => setValue(e.target.value.toUpperCase())}/><code>{value}</code></label>;
}
