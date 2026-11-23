import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Layers, Minus, Plus, RotateCcw } from 'lucide-react';
import type { HeatmapData, IterationRecord, ThemeMode } from '../types/api';
import './SwarmHeatmapCanvas.css';

interface SwarmHeatmapCanvasProps {
  heatmap: HeatmapData | null;
  history: IterationRecord[];
  currentStep: number;
  selectedParticleId: number | null;
  onSelectParticle: (particleId: number | null) => void;
  theme: ThemeMode;
}

type ViewMode = '2d' | '3d';
type Mat3 = [number, number, number, number, number, number, number, number, number];

interface TrailPoint {
  x: number;
  y: number;
  vis?: number;
}

interface GlSurfaceRenderer {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  posBuf: WebGLBuffer;
  normBuf: WebGLBuffer;
  metaBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  indexCount: number;
  aPos: number;
  aNormal: number;
  aMeta: number;
  uRow0: WebGLUniformLocation | null;
  uRow1: WebGLUniformLocation | null;
  uRow2: WebGLUniformLocation | null;
  uScaleX: WebGLUniformLocation | null;
  uScaleY: WebGLUniformLocation | null;
  uOffsetY: WebGLUniformLocation | null;
  uStop0: WebGLUniformLocation | null;
  uStop1: WebGLUniformLocation | null;
  uStop2: WebGLUniformLocation | null;
  uStop3: WebGLUniformLocation | null;
  uStop4: WebGLUniformLocation | null;
  uShowContours: WebGLUniformLocation | null;
  uIsDark: WebGLUniformLocation | null;
}

interface Mesh3DData {
  positions: Float32Array;
  normals: Float32Array;
  meta: Float32Array;
  indices: Uint16Array;
}

const TEX_SIZE = 512;
const MESH_3D = 180; // 181x181 вершин = 64 800 треугольников
const MIN_ZOOM_2D = 1;
const MAX_ZOOM_2D = 12;
const MIN_ZOOM_3D = 0.55;
const MAX_ZOOM_3D = 3.5;

const VERTEX_SHADER_SRC = `
  attribute vec3 aPos;
  attribute vec3 aNormal;
  attribute vec2 aMeta;

  uniform vec3 uRow0;
  uniform vec3 uRow1;
  uniform vec3 uRow2;
  uniform float uScaleX;
  uniform float uScaleY;
  uniform float uOffsetY;

  varying vec3 vNormal;
  varying float vNorm;
  varying float vGrad;

  void main() {
    vec3 vPos = vec3(dot(uRow0, aPos), dot(uRow1, aPos), dot(uRow2, aPos));
    vNormal = vec3(dot(uRow0, aNormal), dot(uRow1, aNormal), dot(uRow2, aNormal));
    vNorm = aMeta.x;
    vGrad = aMeta.y;

    float w = max(1.2, 4.4 - vPos.z);
    float clipX = vPos.x * uScaleX;
    float clipY = uOffsetY * w + vPos.y * uScaleY;
    float clipZ = -vPos.z * 0.5;
    gl_Position = vec4(clipX, clipY, clipZ, w);
  }
`;

const FRAGMENT_SHADER_SRC = `
  precision highp float;

  uniform vec3 uStop0;
  uniform vec3 uStop1;
  uniform vec3 uStop2;
  uniform vec3 uStop3;
  uniform vec3 uStop4;
  uniform float uShowContours;
  uniform float uIsDark;

  varying vec3 vNormal;
  varying float vNorm;
  varying float vGrad;

  vec3 samplePalette(float t) {
    float c = clamp(t, 0.0, 1.0) * 4.0;
    if (c < 1.0) return mix(uStop0, uStop1, c);
    if (c < 2.0) return mix(uStop1, uStop2, c - 1.0);
    if (c < 3.0) return mix(uStop2, uStop3, c - 2.0);
    return mix(uStop3, uStop4, c - 3.0);
  }

  void main() {
    vec3 N = normalize(vNormal);
    if (N.z < 0.0) N = -N;

    vec3 baseColor = samplePalette(vNorm);

    vec3 L1 = normalize(vec3(-0.36, 0.44, 0.82));
    vec3 L2 = normalize(vec3(0.54, -0.32, 0.62));
    vec3 V = vec3(0.0, 0.0, 1.0);

    float diff1 = max(dot(N, L1), 0.0);
    float diff2 = max(dot(N, L2), 0.0);
    vec3 H = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), 44.0) * (uIsDark > 0.5 ? 0.18 : 0.12);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.08;

    float shade = 0.60 + diff1 * 0.34 + diff2 * 0.14;
    vec3 col = baseColor * shade + vec3(1.0, 0.95, 0.82) * (spec + fresnel);

    if (uShowContours > 0.5) {
      float levels = 12.0;
      float scaled = vNorm * levels;
      float dist = abs(fract(scaled + 0.5) - 0.5);
      float width = clamp(vGrad * 0.075, 0.014, 0.22);
      float line = 1.0 - smoothstep(0.0, width, dist);
      vec3 target = uIsDark > 0.5 ? vec3(1.0, 0.98, 0.92) : vec3(0.18, 0.09, 0.03);
      col = mix(col, target, line * (uIsDark > 0.5 ? 0.14 : 0.12));
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createGlRenderer(): GlSurfaceRenderer | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    antialias: true,
    alpha: true,
    depth: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  const posBuf = gl.createBuffer();
  const normBuf = gl.createBuffer();
  const metaBuf = gl.createBuffer();
  const idxBuf = gl.createBuffer();
  if (!posBuf || !normBuf || !metaBuf || !idxBuf) return null;

  return {
    canvas,
    gl,
    program,
    posBuf,
    normBuf,
    metaBuf,
    idxBuf,
    indexCount: 0,
    aPos: gl.getAttribLocation(program, 'aPos'),
    aNormal: gl.getAttribLocation(program, 'aNormal'),
    aMeta: gl.getAttribLocation(program, 'aMeta'),
    uRow0: gl.getUniformLocation(program, 'uRow0'),
    uRow1: gl.getUniformLocation(program, 'uRow1'),
    uRow2: gl.getUniformLocation(program, 'uRow2'),
    uScaleX: gl.getUniformLocation(program, 'uScaleX'),
    uScaleY: gl.getUniformLocation(program, 'uScaleY'),
    uOffsetY: gl.getUniformLocation(program, 'uOffsetY'),
    uStop0: gl.getUniformLocation(program, 'uStop0'),
    uStop1: gl.getUniformLocation(program, 'uStop1'),
    uStop2: gl.getUniformLocation(program, 'uStop2'),
    uStop3: gl.getUniformLocation(program, 'uStop3'),
    uStop4: gl.getUniformLocation(program, 'uStop4'),
    uShowContours: gl.getUniformLocation(program, 'uShowContours'),
    uIsDark: gl.getUniformLocation(program, 'uIsDark'),
  };
}

function getColorStops(theme: ThemeMode): Array<[number, number, number]> {
  return theme === 'dark'
    ? [
        [92, 39, 12],
        [146, 64, 14],
        [194, 96, 12],
        [232, 144, 24],
        [252, 211, 77],
      ]
    : [
        [92, 39, 12],
        [166, 74, 12],
        [217, 119, 6],
        [245, 180, 65],
        [254, 243, 199],
      ];
}

function interpolateHeatmapColor(t: number, theme: ThemeMode): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const stops = getColorStops(theme);
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = stops[idx];
  const c1 = stops[idx + 1];
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

function normalizeFitness(val: number, minVal: number, maxVal: number): number {
  const logMax = Math.log1p(Math.max(1e-9, maxVal - minVal));
  return Math.max(0, Math.min(1, Math.log1p(Math.max(0, val - minVal)) / logMax));
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function sampleNormBicubic(normGrid: number[][], u: number, v: number): number {
  const rows = normGrid.length;
  const cols = rows > 0 ? normGrid[0].length : 0;
  if (rows === 0 || cols === 0) return 0;

  const cu = Math.max(0, Math.min(1, u)) * (cols - 1);
  const rv = Math.max(0, Math.min(1, v)) * (rows - 1);
  const c1 = Math.floor(cu);
  const r1 = Math.floor(rv);
  const fc = cu - c1;
  const fr = rv - r1;

  const clampR = (r: number) => Math.max(0, Math.min(rows - 1, r));
  const clampC = (c: number) => Math.max(0, Math.min(cols - 1, c));

  const c0 = clampC(c1 - 1);
  const c2 = clampC(c1 + 1);
  const c3 = clampC(c1 + 2);

  const rowVals = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const row = normGrid[clampR(r1 - 1 + i)];
    rowVals[i] = catmullRom(row[c0], row[c1], row[c2], row[c3], fc);
  }

  return Math.max(0, Math.min(1, catmullRom(rowVals[0], rowVals[1], rowVals[2], rowVals[3], fr)));
}

/** Быстрая билинейная выборка высоты поверхности для проверки перекрытия лучом */
function sampleNormBilinear(normGrid: number[][], u: number, v: number): number {
  const rows = normGrid.length;
  const cols = rows > 0 ? normGrid[0].length : 0;
  if (rows === 0 || cols === 0) return 0;

  const cu = Math.max(0, Math.min(1, u)) * (cols - 1);
  const rv = Math.max(0, Math.min(1, v)) * (rows - 1);
  const c0 = Math.floor(cu);
  const r0 = Math.floor(rv);
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const fc = cu - c0;
  const fr = rv - r0;

  const v00 = normGrid[r0][c0];
  const v01 = normGrid[r0][c1];
  const v10 = normGrid[r1][c0];
  const v11 = normGrid[r1][c1];

  return (v00 * (1 - fc) + v01 * fc) * (1 - fr) + (v10 * (1 - fc) + v11 * fc) * fr;
}

function formatCompactNum(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs < 0.001 || abs >= 10000) return v.toExponential(1);
  if (abs < 1) return v.toFixed(3);
  if (abs < 100) return v.toFixed(1);
  return v.toFixed(0);
}

// --- Матрицы для свободного вращения 3D на 360° ---
function createInitialRotMatrix(): Mat3 {
  const azim = -0.68;
  const elev = 0.56;
  const cA = Math.cos(azim);
  const sA = Math.sin(azim);
  const cE = Math.cos(elev);
  const sE = Math.sin(elev);
  return [cA, -sA, 0, sA * sE, cA * sE, cE, -sA * cE, -cA * cE, sE];
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function orthonormalizeMat3(m: Mat3): Mat3 {
  let r0x = m[0],
    r0y = m[1],
    r0z = m[2];
  const l0 = Math.hypot(r0x, r0y, r0z) || 1;
  r0x /= l0;
  r0y /= l0;
  r0z /= l0;

  let r1x = m[3],
    r1y = m[4],
    r1z = m[5];
  const dot01 = r0x * r1x + r0y * r1y + r0z * r1z;
  r1x -= dot01 * r0x;
  r1y -= dot01 * r0y;
  r1z -= dot01 * r0z;
  const l1 = Math.hypot(r1x, r1y, r1z) || 1;
  r1x /= l1;
  r1y /= l1;
  r1z /= l1;

  const r2x = r0y * r1z - r0z * r1y;
  const r2y = r0z * r1x - r0x * r1z;
  const r2z = r0x * r1y - r0y * r1x;

  return [r0x, r0y, r0z, r1x, r1y, r1z, r2x, r2y, r2z];
}

function rotateTrackball(mat: Mat3, dx: number, dy: number): Mat3 {
  const ay = dx * 0.0085;
  const ax = dy * 0.0085;
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);

  const rotY: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rotX: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  return orthonormalizeMat3(multiplyMat3(rotX, multiplyMat3(rotY, mat)));
}

function drawHexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawBee(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale: number,
  isSelected: boolean,
  wingPhase: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  ctx.shadowColor = isSelected ? '#fef08a' : 'rgba(251, 191, 36, 0.72)';
  ctx.shadowBlur = isSelected ? 14 : 7;

  const flap = Math.sin(wingPhase) * 0.25;
  ctx.fillStyle = 'rgba(255, 251, 235, 0.8)';
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
  ctx.lineWidth = 0.7;

  ctx.save();
  ctx.translate(-1, -4.5);
  ctx.rotate(-0.45 + flap);
  ctx.beginPath();
  ctx.ellipse(0, -3, 3.2, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(-1, 4.5);
  ctx.rotate(0.45 - flap);
  ctx.beginPath();
  ctx.ellipse(0, 3, 3.2, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.8, 4.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = isSelected ? '#fef08a' : '#fbbf24';
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#2b1608';
  ctx.fillRect(-4.2, -5, 1.8, 10);
  ctx.fillRect(-0.8, -5, 1.9, 10);
  ctx.beginPath();
  ctx.arc(5.4, 0, 2.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.ellipse(0, 0, 6.8, 4.4, 0, 0, Math.PI * 2);
  ctx.strokeStyle = isSelected ? '#ffffff' : '#451a03';
  ctx.lineWidth = isSelected ? 1.4 : 0.9;
  ctx.stroke();
  ctx.restore();
}

function drawCometTail(
  ctx: CanvasRenderingContext2D,
  rawPoints: TrailPoint[],
  isSelected: boolean,
  scaleFactor = 1
) {
  if (rawPoints.length < 2) return;

  const pts: Array<{ x: number; y: number; vis: number }> = [
    { x: rawPoints[0].x, y: rawPoints[0].y, vis: rawPoints[0].vis ?? 1 },
  ];
  for (let i = 1; i < rawPoints.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.hypot(rawPoints[i].x - prev.x, rawPoints[i].y - prev.y) > 0.6) {
      pts.push({ x: rawPoints[i].x, y: rawPoints[i].y, vis: rawPoints[i].vis ?? 1 });
    }
  }
  if (pts.length < 2) return;

  const smooth: Array<{ x: number; y: number; vis: number }> = [pts[0]];
  const subdivs = 5;
  if (pts.length === 2) {
    for (let s = 1; s <= subdivs; s++) {
      const t = s / subdivs;
      smooth.push({
        x: pts[0].x + (pts[1].x - pts[0].x) * t,
        y: pts[0].y + (pts[1].y - pts[0].y) * t,
        vis: pts[0].vis + (pts[1].vis - pts[0].vis) * t,
      });
    }
  } else {
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 =
        i === 0
          ? pts[0]
          : {
              x: (pts[i - 1].x + pts[i].x) / 2,
              y: (pts[i - 1].y + pts[i].y) / 2,
              vis: (pts[i - 1].vis + pts[i].vis) / 2,
            };
      const ctrl = pts[i];
      const p2 =
        i === pts.length - 2
          ? pts[pts.length - 1]
          : {
              x: (pts[i].x + pts[i + 1].x) / 2,
              y: (pts[i].y + pts[i + 1].y) / 2,
              vis: (pts[i].vis + pts[i + 1].vis) / 2,
            };

      for (let s = 1; s <= subdivs; s++) {
        const t = s / subdivs;
        const inv = 1 - t;
        smooth.push({
          x: inv * inv * p0.x + 2 * inv * t * ctrl.x + t * t * p2.x,
          y: inv * inv * p0.y + 2 * inv * t * ctrl.y + t * t * p2.y,
          vis: p0.vis + (p2.vis - p0.vis) * t,
        });
      }
    }
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const total = smooth.length - 1;
  for (let i = 1; i <= total; i++) {
    const t = i / total;
    const vis = smooth[i].vis;
    const glowAlpha = Math.pow(t, 2.0) * (isSelected ? 0.34 : 0.22) * vis;
    const glowWidth = (1.6 + Math.pow(t, 1.5) * (isSelected ? 8.5 : 5.8)) * scaleFactor;
    ctx.beginPath();
    ctx.moveTo(smooth[i - 1].x, smooth[i - 1].y);
    ctx.lineTo(smooth[i].x, smooth[i].y);
    ctx.strokeStyle = isSelected
      ? `rgba(254, 240, 138, ${glowAlpha.toFixed(3)})`
      : `rgba(245, 158, 11, ${glowAlpha.toFixed(3)})`;
    ctx.lineWidth = glowWidth;
    ctx.stroke();
  }

  for (let i = 1; i <= total; i++) {
    const t = i / total;
    const vis = smooth[i].vis;
    const alpha = Math.pow(t, 1.65) * (isSelected ? 0.96 : 0.8) * vis;
    const width = (0.35 + Math.pow(t, 1.6) * (isSelected ? 4.2 : 2.9)) * scaleFactor;
    const r = Math.round(245 + (255 - 245) * t);
    const g = Math.round(162 + (248 - 162) * t);
    const b = Math.round(28 + (214 - 28) * t);

    ctx.beginPath();
    ctx.moveTo(smooth[i - 1].x, smooth[i - 1].y);
    ctx.lineTo(smooth[i].x, smooth[i].y);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  ctx.restore();
}

function clampCenter(cx: number, cy: number, zoom: number): { cx: number; cy: number } {
  const half = 0.5 / zoom;
  return {
    cx: Math.max(half, Math.min(1 - half, cx)),
    cy: Math.max(half, Math.min(1 - half, cy)),
  };
}

export function SwarmHeatmapCanvas({
  heatmap,
  history,
  currentStep,
  selectedParticleId,
  onSelectParticle,
  theme,
}: SwarmHeatmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layersMenuRef = useRef<HTMLDivElement | null>(null);
  const glRendererRef = useRef<GlSurfaceRenderer | null>(null);

  const [size, setSize] = useState<{ width: number; height: number }>({ width: 520, height: 520 });
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [layersOpen, setLayersOpen] = useState(false);

  const [showTrails, setShowTrails] = useState(true);
  const [showVelocities, setShowVelocities] = useState(false);
  const [showPBest, setShowPBest] = useState(false);
  const [showContours, setShowContours] = useState(true);
  const [useBees, setUseBees] = useState(true);

  const [zoom2D, setZoom2D] = useState(1);
  const [center2D, setCenter2D] = useState<{ cx: number; cy: number }>({ cx: 0.5, cy: 0.5 });

  const [camera3D, setCamera3D] = useState<{ rot: Mat3; zoom: number }>(() => ({
    rot: createInitialRotMatrix(),
    zoom: 1.0,
  }));
  const [isDragging, setIsDragging] = useState(false);

  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
  });

  const projectedParticlesRef = useRef<
    Array<{ id: number; x: number; y: number; occluded: boolean }>
  >([]);

  const currentRecord = history[currentStep] ?? null;
  const bestFitness = currentRecord?.global_best_fitness;

  useEffect(() => {
    return () => {
      const r = glRendererRef.current;
      if (!r) return;
      const { gl } = r;
      gl.deleteBuffer(r.posBuf);
      gl.deleteBuffer(r.normBuf);
      gl.deleteBuffer(r.metaBuf);
      gl.deleteBuffer(r.idxBuf);
      gl.deleteProgram(r.program);
      glRendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    setZoom2D(1);
    setCenter2D({ cx: 0.5, cy: 0.5 });
  }, [heatmap]);

  useEffect(() => {
    if (!layersOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (layersMenuRef.current && !layersMenuRef.current.contains(e.target as Node)) {
        setLayersOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [layersOpen]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(240, Math.floor(entry.contentRect.width));
        const h = Math.max(240, Math.floor(entry.contentRect.height));
        setSize({ width: w, height: h });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const normGrid = useMemo(() => {
    if (!heatmap || heatmap.values.length === 0 || heatmap.values[0].length === 0) return null;
    return heatmap.values.map((row) =>
      row.map((val) => normalizeFitness(val, heatmap.min_value, heatmap.max_value))
    );
  }, [heatmap]);

  // Ультраплавная 2D-текстура 512×512
  const smoothTexture = useMemo(() => {
    if (!normGrid) return null;

    const offscreen = document.createElement('canvas');
    offscreen.width = TEX_SIZE;
    offscreen.height = TEX_SIZE;
    const octx = offscreen.getContext('2d');
    if (!octx) return null;

    const norms = new Float32Array(TEX_SIZE * TEX_SIZE);
    for (let py = 0; py < TEX_SIZE; py++) {
      const v = 1 - py / (TEX_SIZE - 1);
      for (let px = 0; px < TEX_SIZE; px++) {
        const u = px / (TEX_SIZE - 1);
        norms[py * TEX_SIZE + px] = sampleNormBicubic(normGrid, u, v);
      }
    }

    const img = octx.createImageData(TEX_SIZE, TEX_SIZE);
    const data = img.data;
    const contourLevels = 12;

    for (let py = 0; py < TEX_SIZE; py++) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const idx = py * TEX_SIZE + px;
        const norm = norms[idx];
        let [r, g, b] = interpolateHeatmapColor(norm, theme);

        if (showContours && px > 0 && px < TEX_SIZE - 1 && py > 0 && py < TEX_SIZE - 1) {
          const dx = (norms[idx + 1] - norms[idx - 1]) * 0.5;
          const dy = (norms[idx + TEX_SIZE] - norms[idx - TEX_SIZE]) * 0.5;
          const grad = Math.hypot(dx, dy);
          const scaled = norm * contourLevels;
          const dist = Math.abs(scaled - Math.round(scaled)) / Math.max(grad * contourLevels, 1e-4);
          if (dist < 1.15) {
            const smoothT = 1 - dist / 1.15;
            const blend = smoothT * smoothT * (3 - 2 * smoothT) * (theme === 'dark' ? 0.14 : 0.12);
            const target = theme === 'dark' ? 255 : 48;
            r = Math.round(r + (target - r) * blend);
            g = Math.round(g + (target - g) * blend);
            b = Math.round(b + (target - b) * blend);
          }
        }

        const p = idx * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }

    octx.putImageData(img, 0, 0);
    return offscreen;
  }, [normGrid, theme, showContours]);

  // Высокодетализированная 3D-геометрия 180×180 (64 800 треугольников) для GPU
  const mesh3DData = useMemo<Mesh3DData | null>(() => {
    if (!normGrid) return null;

    const vertsPerSide = MESH_3D + 1;
    const vertCount = vertsPerSide * vertsPerSide;
    const norms = new Float32Array(vertCount);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const meta = new Float32Array(vertCount * 2);

    for (let r = 0; r <= MESH_3D; r++) {
      const v = r / MESH_3D;
      const ny = v * 2 - 1;
      for (let c = 0; c <= MESH_3D; c++) {
        const u = c / MESH_3D;
        const nx = u * 2 - 1;
        const norm = sampleNormBicubic(normGrid, u, v);
        const nz = -0.45 + norm * 1.15;
        const idx = r * vertsPerSide + c;
        norms[idx] = norm;
        positions[idx * 3] = nx;
        positions[idx * 3 + 1] = ny;
        positions[idx * 3 + 2] = nz;
      }
    }

    const step = 2 / MESH_3D;
    for (let r = 0; r <= MESH_3D; r++) {
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(MESH_3D, r + 1);
      const dR = (rNext - rPrev) * step;

      for (let c = 0; c <= MESH_3D; c++) {
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(MESH_3D, c + 1);
        const dC = (cNext - cPrev) * step;

        const iL = r * vertsPerSide + cPrev;
        const iR = r * vertsPerSide + cNext;
        const iD = rPrev * vertsPerSide + c;
        const iU = rNext * vertsPerSide + c;
        const idx = r * vertsPerSide + c;

        const dNormDx = (norms[iR] - norms[iL]) / Math.max(1e-6, dC);
        const dNormDy = (norms[iU] - norms[iD]) / Math.max(1e-6, dR);

        const dzdx = dNormDx * 1.15;
        const dzdy = dNormDy * 1.15;
        let vnx = -dzdx;
        let vny = -dzdy;
        let vnz = 1;
        const len = Math.hypot(vnx, vny, vnz) || 1;
        vnx /= len;
        vny /= len;
        vnz /= len;

        normals[idx * 3] = vnx;
        normals[idx * 3 + 1] = vny;
        normals[idx * 3 + 2] = vnz;

        meta[idx * 2] = norms[idx];
        meta[idx * 2 + 1] = Math.hypot(dNormDx, dNormDy);
      }
    }

    const indices = new Uint16Array(MESH_3D * MESH_3D * 6);
    let ptr = 0;
    for (let r = 0; r < MESH_3D; r++) {
      for (let c = 0; c < MESH_3D; c++) {
        const i00 = r * vertsPerSide + c;
        const i01 = i00 + 1;
        const i10 = i00 + vertsPerSide;
        const i11 = i10 + 1;
        indices[ptr++] = i00;
        indices[ptr++] = i01;
        indices[ptr++] = i11;
        indices[ptr++] = i00;
        indices[ptr++] = i11;
        indices[ptr++] = i10;
      }
    }

    return { positions, normals, meta, indices };
  }, [normGrid]);

  useEffect(() => {
    if (!mesh3DData) return;
    if (!glRendererRef.current) {
      glRendererRef.current = createGlRenderer();
    }
    const r = glRendererRef.current;
    if (!r) return;

    const { gl } = r;
    gl.bindBuffer(gl.ARRAY_BUFFER, r.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh3DData.positions, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, r.normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh3DData.normals, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, r.metaBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh3DData.meta, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh3DData.indices, gl.STATIC_DRAW);

    r.indexCount = mesh3DData.indices.length;
  }, [mesh3DData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmap) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;

      if (viewMode === '2d') {
        const rect = canvas.getBoundingClientRect();
        const pad = 34;
        const plotW = Math.max(40, size.width - pad * 2);
        const plotH = Math.max(40, size.height - pad * 2);
        const fx = Math.max(0, Math.min(1, (e.clientX - rect.left - pad) / plotW));
        const fy = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top - pad) / plotH));

        setZoom2D((prevZoom) => {
          const nextZoom = Math.max(MIN_ZOOM_2D, Math.min(MAX_ZOOM_2D, prevZoom * factor));
          if (Math.abs(nextZoom - prevZoom) < 1e-4) return prevZoom;

          setCenter2D((prevCenter) => {
            const oldSpan = 1 / prevZoom;
            const uCur = prevCenter.cx - oldSpan / 2 + fx * oldSpan;
            const vCur = prevCenter.cy - oldSpan / 2 + fy * oldSpan;
            const newSpan = 1 / nextZoom;
            const newCx = uCur - fx * newSpan + newSpan / 2;
            const newCy = vCur - fy * newSpan + newSpan / 2;
            return clampCenter(newCx, newCy, nextZoom);
          });
          return nextZoom;
        });
      } else {
        setCamera3D((prev) => ({
          ...prev,
          zoom: Math.max(MIN_ZOOM_3D, Math.min(MAX_ZOOM_3D, prev.zoom * factor)),
        }));
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [heatmap, viewMode, size]);

  // Главный рендер (2D и 3D с честным перекрытием и точками контакта)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmap || !currentRecord || !normGrid) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bgColor = theme === 'dark' ? '#0b1222' : '#faf4e8';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    const ax = heatmap.axis_x;
    const ay = heatmap.axis_y;
    const xSpan = Math.max(1e-9, heatmap.x_max - heatmap.x_min);
    const ySpan = Math.max(1e-9, heatmap.y_max - heatmap.y_min);
    const projectedList: Array<{ id: number; x: number; y: number; occluded: boolean }> = [];

    if (viewMode === '2d') {
      const pad = 34;
      const plotW = Math.max(40, width - pad * 2);
      const plotH = Math.max(40, height - pad * 2);

      const half = 0.5 / zoom2D;
      const uMin = center2D.cx - half;
      const uMax = center2D.cx + half;
      const vMin = center2D.cy - half;
      const vMax = center2D.cy + half;

      const visXMin = heatmap.x_min + uMin * xSpan;
      const visXMax = heatmap.x_min + uMax * xSpan;
      const visYMin = heatmap.y_min + vMin * ySpan;
      const visYMax = heatmap.y_min + vMax * ySpan;

      const toCanvasX = (wx: number) =>
        pad + (((wx - heatmap.x_min) / xSpan - uMin) / (uMax - uMin)) * plotW;
      const toCanvasY = (wy: number) =>
        pad + (1 - ((wy - heatmap.y_min) / ySpan - vMin) / (vMax - vMin)) * plotH;

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad, pad, plotW, plotH);
      ctx.clip();

      if (smoothTexture) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const sx = uMin * TEX_SIZE;
        const sy = (1 - vMax) * TEX_SIZE;
        const sw = (uMax - uMin) * TEX_SIZE;
        const sh = (vMax - vMin) * TEX_SIZE;
        ctx.drawImage(smoothTexture, sx, sy, sw, sh, pad, pad, plotW, plotH);
      }

      if (heatmap.optimum_point) {
        const ox = toCanvasX(heatmap.optimum_point[0]);
        const oy = toCanvasY(heatmap.optimum_point[1]);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ox - 7, oy);
        ctx.lineTo(ox + 7, oy);
        ctx.moveTo(ox, oy - 7);
        ctx.lineTo(ox, oy + 7);
        ctx.stroke();
      }

      if (showTrails && currentStep > 0) {
        const trailLen = 14;
        const startStep = Math.max(0, currentStep - trailLen);
        for (const p of currentRecord.particles) {
          const isSelected = p.id === selectedParticleId;
          const points: TrailPoint[] = [];
          for (let s = startStep; s <= currentStep; s++) {
            const hp = history[s]?.particles.find((item) => item.id === p.id);
            if (!hp) continue;
            points.push({ x: toCanvasX(hp.position[ax] ?? 0), y: toCanvasY(hp.position[ay] ?? 0) });
          }
          drawCometTail(ctx, points, isSelected, 1);
        }
      }

      if (showPBest) {
        for (const p of currentRecord.particles) {
          const bx = toCanvasX(p.best_position[ax] ?? 0);
          const by = toCanvasY(p.best_position[ay] ?? 0);
          ctx.fillStyle = 'rgba(251, 146, 60, 0.88)';
          ctx.fillRect(bx - 2.5, by - 2.5, 5, 5);
        }
      }

      for (const p of currentRecord.particles) {
        const px = toCanvasX(p.position[ax] ?? 0);
        const py = toCanvasY(p.position[ay] ?? 0);
        projectedList.push({ id: p.id, x: px, y: py, occluded: false });

        const isSelected = p.id === selectedParticleId;
        const vx = p.velocity[ax] ?? 0;
        const vy = p.velocity[ay] ?? 0;
        const endX = toCanvasX((p.position[ax] ?? 0) + vx * 0.65);
        const endY = toCanvasY((p.position[ay] ?? 0) + vy * 0.65);

        if (showVelocities) {
          ctx.strokeStyle = isSelected ? '#fef08a' : 'rgba(255, 251, 235, 0.72)';
          ctx.lineWidth = isSelected ? 2 : 1.15;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(endX, endY);
          ctx.stroke();
        }

        if (useBees) {
          const dx = endX - px;
          const dy = endY - py;
          const angle = Math.hypot(dx, dy) > 0.5 ? Math.atan2(dy, dx) : 0;
          const beeScale = isSelected ? 1.35 : 0.96;
          drawBee(ctx, px, py, angle, beeScale, isSelected, currentStep * 1.4 + p.id);
        } else {
          ctx.save();
          ctx.shadowColor = isSelected ? '#fef08a' : '#f59e0b';
          ctx.shadowBlur = isSelected ? 12 : 6;
          ctx.beginPath();
          ctx.arc(px, py, isSelected ? 6.5 : 4.2, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#fef08a' : '#fbbf24';
          ctx.fill();
          ctx.strokeStyle = '#2b1608';
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.restore();
        }
      }

      if (currentRecord.global_best_position.length > Math.max(ax, ay)) {
        const gx = toCanvasX(currentRecord.global_best_position[ax]);
        const gy = toCanvasY(currentRecord.global_best_position[ay]);
        ctx.save();
        for (const r of [14, 21]) {
          ctx.beginPath();
          ctx.arc(gx, gy, r, 0, Math.PI * 2);
          ctx.strokeStyle =
            r === 14 ? 'rgba(252, 211, 77, 0.58)' : 'rgba(245, 158, 11, 0.28)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 16;
        drawHexagon(ctx, gx, gy, 9.5);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fffbeb';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();

      ctx.strokeStyle = theme === 'dark' ? 'rgba(251, 191, 36, 0.35)' : 'rgba(180, 83, 9, 0.32)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pad, pad, plotW, plotH);

      ctx.fillStyle = theme === 'dark' ? '#a8b3c7' : '#6b4f35';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `x${ax + 1} [${visXMin.toFixed(2)}, ${visXMax.toFixed(2)}]`,
        pad + plotW / 2,
        height - 10
      );

      ctx.save();
      ctx.translate(13, pad + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`x${ay + 1} [${visYMin.toFixed(2)}, ${visYMax.toFixed(2)}]`, 0, 0);
      ctx.restore();
    } else {
      // ================== 3D-РЕЖИМ (WEBGL + ПРОВЕРКА ПЕРЕКРЫТИЯ + ТОЧКИ КОНТАКТА) ==================
      const { rot, zoom } = camera3D;
      const scale3D = Math.min(width, height) * 0.34 * zoom;
      const cx0 = width * 0.5;
      const cy0 = height * 0.52;

      // Позиция камеры в пространстве модели (rot^T * [0, 0, 4.4])
      const eyeX = rot[6] * 4.4;
      const eyeY = rot[7] * 4.4;
      const eyeZ = rot[8] * 4.4;

      const project3D = (nx: number, ny: number, nz: number) => {
        const vx = rot[0] * nx + rot[1] * ny + rot[2] * nz;
        const vy = rot[3] * nx + rot[4] * ny + rot[5] * nz;
        const vz = rot[6] * nx + rot[7] * ny + rot[8] * nz;
        const persp = 4.4 / Math.max(1.2, 4.4 - vz);
        return {
          sx: cx0 + vx * scale3D * persp,
          sy: cy0 - vy * scale3D * persp,
          depth: vz,
          persp,
        };
      };

      // Луч от 3D-точки к камере: проверяем, пересекает ли он холм по пути
      const isOccluded3D = (nx: number, ny: number, nz: number): boolean => {
        const dx = eyeX - nx;
        const dy = eyeY - ny;
        const dz = eyeZ - nz;

        let tMax = 1.0;
        if (dx > 1e-6) tMax = Math.min(tMax, (1 - nx) / dx);
        else if (dx < -1e-6) tMax = Math.min(tMax, (-1 - nx) / dx);
        if (dy > 1e-6) tMax = Math.min(tMax, (1 - ny) / dy);
        else if (dy < -1e-6) tMax = Math.min(tMax, (-1 - ny) / dy);

        if (tMax <= 1e-4) return false;

        const xyDist = Math.hypot(dx * tMax, dy * tMax);
        const steps = Math.max(12, Math.min(72, Math.ceil(xyDist * 52)));

        for (let i = 1; i <= steps; i++) {
          const t = (i / steps) * tMax;
          const rx = nx + dx * t;
          const ry = ny + dy * t;
          const rz = nz + dz * t;
          const sNorm = sampleNormBilinear(normGrid, (rx + 1) * 0.5, (ry + 1) * 0.5);
          const surfZ = -0.45 + sNorm * 1.15;
          if (rz < surfZ - 0.014) {
            return true;
          }
        }
        return false;
      };

      const worldTo3D = (wx: number, wy: number, lift = 0.045) => {
        const u = Math.max(0, Math.min(1, (wx - heatmap.x_min) / xSpan));
        const v = Math.max(0, Math.min(1, (wy - heatmap.y_min) / ySpan));
        const norm = sampleNormBicubic(normGrid, u, v);
        const nx = u * 2 - 1;
        const ny = v * 2 - 1;
        const nz = -0.45 + norm * 1.15 + lift;
        const pr = project3D(nx, ny, nz);
        return { ...pr, nx, ny, nz };
      };

      // Нижняя опорная рамка координат
      const baseZ = -0.52;
      const corners = [
        project3D(-1, -1, baseZ),
        project3D(1, -1, baseZ),
        project3D(1, 1, baseZ),
        project3D(-1, 1, baseZ),
      ];
      ctx.strokeStyle = theme === 'dark' ? 'rgba(251, 191, 36, 0.24)' : 'rgba(180, 83, 9, 0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(corners[0].sx, corners[0].sy);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
      ctx.closePath();
      ctx.stroke();

      const axisTop = project3D(-1, -1, 0.78);
      ctx.beginPath();
      ctx.moveTo(corners[0].sx, corners[0].sy);
      ctx.lineTo(axisTop.sx, axisTop.sy);
      ctx.stroke();

      // Рендерим гладкую 3D-поверхность на GPU через WebGL
      const glR = glRendererRef.current;
      if (glR && glR.indexCount > 0) {
        const { gl } = glR;
        const glW = Math.floor(width * dpr);
        const glH = Math.floor(height * dpr);
        if (glR.canvas.width !== glW || glR.canvas.height !== glH) {
          glR.canvas.width = glW;
          glR.canvas.height = glH;
        }

        gl.viewport(0, 0, glW, glH);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(glR.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, glR.posBuf);
        gl.enableVertexAttribArray(glR.aPos);
        gl.vertexAttribPointer(glR.aPos, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, glR.normBuf);
        gl.enableVertexAttribArray(glR.aNormal);
        gl.vertexAttribPointer(glR.aNormal, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, glR.metaBuf);
        gl.enableVertexAttribArray(glR.aMeta);
        gl.vertexAttribPointer(glR.aMeta, 2, gl.FLOAT, false, 0, 0);

        gl.uniform3f(glR.uRow0, rot[0], rot[1], rot[2]);
        gl.uniform3f(glR.uRow1, rot[3], rot[4], rot[5]);
        gl.uniform3f(glR.uRow2, rot[6], rot[7], rot[8]);
        gl.uniform1f(glR.uScaleX, (scale3D * 4.4 * 2.0) / width);
        gl.uniform1f(glR.uScaleY, (scale3D * 4.4 * 2.0) / height);
        gl.uniform1f(glR.uOffsetY, 1.0 - (2.0 * cy0) / height);

        const stops = getColorStops(theme);
        gl.uniform3f(glR.uStop0, stops[0][0] / 255, stops[0][1] / 255, stops[0][2] / 255);
        gl.uniform3f(glR.uStop1, stops[1][0] / 255, stops[1][1] / 255, stops[1][2] / 255);
        gl.uniform3f(glR.uStop2, stops[2][0] / 255, stops[2][1] / 255, stops[2][2] / 255);
        gl.uniform3f(glR.uStop3, stops[3][0] / 255, stops[3][1] / 255, stops[3][2] / 255);
        gl.uniform3f(glR.uStop4, stops[4][0] / 255, stops[4][1] / 255, stops[4][2] / 255);
        gl.uniform1f(glR.uShowContours, showContours ? 1.0 : 0.0);
        gl.uniform1f(glR.uIsDark, theme === 'dark' ? 1.0 : 0.0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glR.idxBuf);
        gl.drawElements(gl.TRIANGLES, glR.indexCount, gl.UNSIGNED_SHORT, 0);

        ctx.drawImage(glR.canvas, 0, 0, width, height);
      }

      // Подписи 3D-осей
      ctx.fillStyle = theme === 'dark' ? '#cbd5e1' : '#5c4028';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      const labelX = project3D(0, -1.18, baseZ);
      const labelY = project3D(1.18, 0, baseZ);
      ctx.fillText(`x${ax + 1}`, labelX.sx, labelX.sy);
      ctx.fillText(`x${ay + 1}`, labelY.sx, labelY.sy);
      ctx.fillText('f(x)', axisTop.sx, axisTop.sy - 8);

      // Истинный оптимум X* в 3D
      if (heatmap.optimum_point) {
        const optSurf = worldTo3D(heatmap.optimum_point[0], heatmap.optimum_point[1], 0.008);
        const optTop = worldTo3D(heatmap.optimum_point[0], heatmap.optimum_point[1], 0.16);
        const optOccluded = isOccluded3D(optTop.nx, optTop.ny, optTop.nz);

        ctx.save();
        ctx.globalAlpha = optOccluded ? 0.3 : 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(optSurf.sx, optSurf.sy);
        ctx.lineTo(optTop.sx, optTop.sy);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(optTop.sx - 6, optTop.sy);
        ctx.lineTo(optTop.sx + 6, optTop.sy);
        ctx.moveTo(optTop.sx, optTop.sy - 6);
        ctx.lineTo(optTop.sx, optTop.sy + 6);
        ctx.stroke();
        ctx.restore();
      }

      // Хвосты-кометы в 3D (приглушаются там, где скрыты за холмом)
      if (showTrails && currentStep > 0) {
        const trailLen = 14;
        const startStep = Math.max(0, currentStep - trailLen);
        for (const p of currentRecord.particles) {
          const isSelected = p.id === selectedParticleId;
          const points: TrailPoint[] = [];
          for (let s = startStep; s <= currentStep; s++) {
            const hp = history[s]?.particles.find((item) => item.id === p.id);
            if (!hp) continue;
            const pr = worldTo3D(hp.position[ax] ?? 0, hp.position[ay] ?? 0, 0.048);
            const occ = isOccluded3D(pr.nx, pr.ny, pr.nz);
            points.push({ x: pr.sx, y: pr.sy, vis: occ ? 0.16 : 1.0 });
          }
          drawCometTail(ctx, points, isSelected, 0.9);
        }
      }

      // Личные рекорды P_best в 3D
      if (showPBest) {
        for (const p of currentRecord.particles) {
          const bp = worldTo3D(p.best_position[ax] ?? 0, p.best_position[ay] ?? 0, 0.025);
          const occ = isOccluded3D(bp.nx, bp.ny, bp.nz);
          ctx.save();
          ctx.globalAlpha = occ ? 0.2 : 0.9;
          ctx.fillStyle = '#fb923c';
          ctx.fillRect(bp.sx - 2.5, bp.sy - 2.5, 5, 5);
          ctx.restore();
        }
      }

      // Частицы / пчёлки в 3D (сначала скрытые за рельефом, потом видимые по глубине)
      const particles3D = currentRecord.particles
        .map((p) => {
          const wx = p.position[ax] ?? 0;
          const wy = p.position[ay] ?? 0;
          const surfPr = worldTo3D(wx, wy, 0.004);
          const pr = worldTo3D(wx, wy, 0.048);
          const nextPr = worldTo3D(
            wx + (p.velocity[ax] ?? 0) * 0.4,
            wy + (p.velocity[ay] ?? 0) * 0.4,
            0.048
          );
          const occluded = isOccluded3D(pr.nx, pr.ny, pr.nz);
          return { p, surfPr, pr, nextPr, occluded };
        })
        .sort((a, b) => {
          if (a.occluded !== b.occluded) return a.occluded ? -1 : 1;
          return a.pr.depth - b.pr.depth;
        });

      for (const { p, surfPr, pr, nextPr, occluded } of particles3D) {
        projectedList.push({ id: p.id, x: pr.sx, y: pr.sy, occluded });
        const isSelected = p.id === selectedParticleId;

        ctx.save();
        if (occluded) {
          ctx.globalAlpha = isSelected ? 0.42 : 0.2;
        }

        // Точка контакта на поверхности и тонкая ножка — привязывают пчёлку к склону
        if (!occluded) {
          ctx.beginPath();
          ctx.arc(surfPr.sx, surfPr.sy, Math.max(1.8, 2.5 * pr.persp), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(18, 10, 4, 0.58)';
          ctx.fill();
          ctx.strokeStyle = isSelected ? 'rgba(254, 240, 138, 0.85)' : 'rgba(251, 191, 36, 0.55)';
          ctx.lineWidth = 0.9;
          ctx.stroke();

          ctx.strokeStyle = isSelected ? 'rgba(254, 240, 138, 0.72)' : 'rgba(255, 251, 235, 0.36)';
          ctx.lineWidth = isSelected ? 1.3 : 0.85;
          ctx.beginPath();
          ctx.moveTo(surfPr.sx, surfPr.sy);
          ctx.lineTo(pr.sx, pr.sy);
          ctx.stroke();
        }

        if (showVelocities) {
          ctx.strokeStyle = isSelected ? '#fef08a' : 'rgba(255, 251, 235, 0.65)';
          ctx.lineWidth = isSelected ? 1.8 : 1;
          ctx.beginPath();
          ctx.moveTo(pr.sx, pr.sy);
          ctx.lineTo(nextPr.sx, nextPr.sy);
          ctx.stroke();
        }

        const depthScale = Math.max(0.62, Math.min(1.32, pr.persp * 0.9));
        if (useBees) {
          const dx = nextPr.sx - pr.sx;
          const dy = nextPr.sy - pr.sy;
          const angle = Math.hypot(dx, dy) > 0.4 ? Math.atan2(dy, dx) : 0;
          const beeScale = (isSelected ? 1.26 : 0.86) * depthScale;
          drawBee(ctx, pr.sx, pr.sy, angle, beeScale, isSelected, currentStep * 1.4 + p.id);
        } else {
          ctx.beginPath();
          ctx.arc(pr.sx, pr.sy, (isSelected ? 6 : 3.8) * depthScale, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#fef08a' : '#fbbf24';
          ctx.fill();
          ctx.strokeStyle = '#2b1608';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        ctx.restore();
      }

      // Лидер G_best в 3D
      if (currentRecord.global_best_position.length > Math.max(ax, ay)) {
        const gxW = currentRecord.global_best_position[ax];
        const gyW = currentRecord.global_best_position[ay];
        const gSurf = worldTo3D(gxW, gyW, 0.005);
        const gBeacon = worldTo3D(gxW, gyW, 0.13);
        const gOccluded = isOccluded3D(gBeacon.nx, gBeacon.ny, gBeacon.nz);

        ctx.save();
        if (gOccluded) ctx.globalAlpha = 0.36;

        // Кольцо привязки на поверхности
        ctx.beginPath();
        ctx.arc(gSurf.sx, gSurf.sy, Math.max(3, 4 * gSurf.persp), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 251, 235, 0.8)';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(252, 211, 77, 0.78)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(gSurf.sx, gSurf.sy);
        ctx.lineTo(gBeacon.sx, gBeacon.sy);
        ctx.stroke();

        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = gOccluded ? 6 : 16;
        drawHexagon(ctx, gBeacon.sx, gBeacon.sy, 8.5);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fffbeb';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    projectedParticlesRef.current = projectedList;
  }, [
    heatmap,
    normGrid,
    mesh3DData,
    history,
    currentStep,
    currentRecord,
    selectedParticleId,
    size,
    viewMode,
    smoothTexture,
    zoom2D,
    center2D,
    camera3D,
    showVelocities,
    showTrails,
    showPBest,
    showContours,
    useBees,
    theme,
  ]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;

    if (Math.hypot(e.clientX - dragRef.current.startX, e.clientY - dragRef.current.startY) > 4) {
      dragRef.current.moved = true;
    }

    if (viewMode === '2d') {
      if (zoom2D <= 1.001) return;
      const plotW = Math.max(40, size.width - 68);
      const plotH = Math.max(40, size.height - 68);
      setCenter2D((prev) =>
        clampCenter(prev.cx - dx / (plotW * zoom2D), prev.cy + dy / (plotH * zoom2D), zoom2D)
      );
    } else {
      setCamera3D((prev) => ({
        ...prev,
        rot: rotateTrackball(prev.rot, dx, dy),
      }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setIsDragging(false);

    if (!dragRef.current.moved && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      let nearestVisibleId: number | null = null;
      let nearestVisibleDist = 18;
      let nearestHiddenId: number | null = null;
      let nearestHiddenDist = 18;

      for (const item of projectedParticlesRef.current) {
        const dist = Math.hypot(item.x - clickX, item.y - clickY);
        if (!item.occluded) {
          if (dist < nearestVisibleDist) {
            nearestVisibleDist = dist;
            nearestVisibleId = item.id;
          }
        } else if (dist < nearestHiddenDist) {
          nearestHiddenDist = dist;
          nearestHiddenId = item.id;
        }
      }
      onSelectParticle(nearestVisibleId ?? nearestHiddenId);
    }
  };

  const handleZoomStep = (direction: 1 | -1) => {
    const factor = direction === 1 ? 1.35 : 1 / 1.35;
    if (viewMode === '2d') {
      setZoom2D((prev) => {
        const next = Math.max(MIN_ZOOM_2D, Math.min(MAX_ZOOM_2D, prev * factor));
        setCenter2D((c) => clampCenter(c.cx, c.cy, next));
        return next;
      });
    } else {
      setCamera3D((prev) => ({
        ...prev,
        zoom: Math.max(MIN_ZOOM_3D, Math.min(MAX_ZOOM_3D, prev.zoom * factor)),
      }));
    }
  };

  const handleResetView = () => {
    if (viewMode === '2d') {
      setZoom2D(1);
      setCenter2D({ cx: 0.5, cy: 0.5 });
    } else {
      setCamera3D({ rot: createInitialRotMatrix(), zoom: 1.0 });
    }
  };

  const handleExportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `pso-swarm-${viewMode}-iter-${currentRecord?.iteration ?? 0}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const colorbarGradient = useMemo(() => {
    const stops = getColorStops(theme).map((rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [theme]);

  const zoomPercent = Math.round((viewMode === '2d' ? zoom2D : camera3D.zoom) * 100);
  const midHeatmapValue = heatmap
    ? heatmap.min_value +
      Math.expm1(Math.log1p(Math.max(0, heatmap.max_value - heatmap.min_value)) * 0.5)
    : 0;

  return (
    <section className="card heatmap-card">
      <div className="heatmap-header">
        <h2 className="card-title" style={{ marginBottom: 0 }}>
          {viewMode === '2d' ? '2D-тепловая карта и движение роя' : '3D-рельеф функции и рой'}
        </h2>

        <div className="heatmap-toolbar">
          <div className="view-mode-switch" role="group" aria-label="Режим отображения">
            <button
              type="button"
              className={`view-mode-btn${viewMode === '2d' ? ' active' : ''}`}
              onClick={() => setViewMode('2d')}
            >
              2D
            </button>
            <button
              type="button"
              className={`view-mode-btn${viewMode === '3d' ? ' active' : ''}`}
              onClick={() => setViewMode('3d')}
            >
              3D
            </button>
          </div>

          <div className="layers-menu-wrap" ref={layersMenuRef}>
            <button
              type="button"
              className={`layers-trigger${layersOpen ? ' open' : ''}`}
              onClick={() => setLayersOpen((o) => !o)}
              aria-expanded={layersOpen}
            >
              <Layers size={14} />
              <span>Слои</span>
            </button>

            {layersOpen && (
              <div className="layers-popover">
                <label className="layers-option">
                  <span>Хвосты-кометы</span>
                  <input
                    type="checkbox"
                    checked={showTrails}
                    onChange={(e) => setShowTrails(e.target.checked)}
                  />
                </label>
                <label className="layers-option">
                  <span>Пчёлки вместо точек</span>
                  <input
                    type="checkbox"
                    checked={useBees}
                    onChange={(e) => setUseBees(e.target.checked)}
                  />
                </label>
                <label className="layers-option">
                  <span>Векторы скоростей V</span>
                  <input
                    type="checkbox"
                    checked={showVelocities}
                    onChange={(e) => setShowVelocities(e.target.checked)}
                  />
                </label>
                <label className="layers-option">
                  <span>Личные рекорды P_best</span>
                  <input
                    type="checkbox"
                    checked={showPBest}
                    onChange={(e) => setShowPBest(e.target.checked)}
                  />
                </label>
                <label className="layers-option">
                  <span>Изолинии рельефа</span>
                  <input
                    type="checkbox"
                    checked={showContours}
                    onChange={(e) => setShowContours(e.target.checked)}
                  />
                </label>
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={handleExportPng}
            disabled={!heatmap}
            title="Сохранить снимок холста в PNG"
          >
            <Download size={13} />
            <span>PNG</span>
          </button>
        </div>
      </div>

      <div ref={containerRef} className="heatmap-stage">
        {heatmap && currentRecord ? (
          <>
            <canvas
              ref={canvasRef}
              className={`heatmap-canvas${isDragging ? ' dragging' : ''}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />

            <div className="heatmap-hud">
              <div className="heatmap-hud-row">
                <span className="heatmap-hud-label">Итерация</span>
                <span className="heatmap-hud-val mono">
                  {currentRecord.iteration} / {Math.max(0, history.length - 1)}
                </span>
              </div>
              {typeof bestFitness === 'number' && (
                <div className="heatmap-hud-row">
                  <span className="heatmap-hud-label">f(g_best)</span>
                  <span className="heatmap-hud-val mono">
                    {Math.abs(bestFitness) < 0.001 && bestFitness !== 0
                      ? bestFitness.toExponential(2)
                      : bestFitness.toFixed(5)}
                  </span>
                </div>
              )}
              <div className="heatmap-hud-row">
                <span className="heatmap-hud-label">{useBees ? 'Пчёл в рое' : 'Частиц'}</span>
                <span className="heatmap-hud-val mono">{currentRecord.particles.length}</span>
              </div>
            </div>

            <div className="heatmap-zoom-pill" role="group" aria-label="Масштаб обзора">
              <button
                type="button"
                className="zoom-pill-btn"
                onClick={() => handleZoomStep(-1)}
                title="Отдалить"
                aria-label="Отдалить"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="zoom-pill-btn mono"
                onClick={handleResetView}
                title="Сбросить масштаб и положение"
              >
                {zoomPercent}%
              </button>
              <button
                type="button"
                className="zoom-pill-btn"
                onClick={() => handleZoomStep(1)}
                title="Приблизить"
                aria-label="Приблизить"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                className="zoom-pill-btn"
                onClick={handleResetView}
                title="Сбросить вид"
                aria-label="Сбросить вид"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </>
        ) : (
          <div className="heatmap-empty">
            Нажмите «Запустить оптимизацию», чтобы построить плавную тепловую карту и увидеть полёт роя.
          </div>
        )}
      </div>

      {/* Легенда цветов тепловой карты (для 2D и 3D) */}
      {heatmap && (
        <div className="heatmap-colorbar">
          <div className="heatmap-colorbar-top">
            <span className="heatmap-colorbar-title">Шкала значений f(x)</span>
          </div>
          <div className="heatmap-colorbar-bar" style={{ background: colorbarGradient }} />
          <div className="heatmap-colorbar-ticks mono">
            <span>min: {formatCompactNum(heatmap.min_value)}</span>
            <span>~ {formatCompactNum(midHeatmapValue)}</span>
            <span>max: {formatCompactNum(heatmap.max_value)}</span>
          </div>
        </div>
      )}

      <div className="heatmap-legend">
        <div className="legend-items">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#fbbf24' }} />
            {useBees ? 'Пчёлка' : 'Частица'}
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#f59e0b' }} />
            Сота G_best
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#fef08a' }} />
            Выбранная
          </span>
          {showPBest && (
            <span className="legend-item">
              <span className="legend-dot" style={{ background: '#fb923c' }} />
              P_best
            </span>
          )}
          <span className="legend-item">
            <span className="mono">+</span> Оптимум X*
          </span>
        </div>
        <span className="mono"> </span>
      </div>
    </section>
  );
}