// 3D module view built from backend mechanical results (grid rows/cols, envelope) and cell geometry.
import { Html, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'

const S = 0.01 // scene units per mm

function tempColor(t, tMin, tMax) {
  if (t == null) return '#7aa7c7'
  const x = Math.min(1, Math.max(0, (t - tMin) / Math.max(tMax - tMin, 1e-6)))
  return new THREE.Color().setHSL((1 - x) * 0.55, 0.65, 0.5).getStyle()
}
const GROUP_COLORS = ['#0e8c99', '#5b6b8c']

function Cell({ pos, fx, fy, h, cylindrical, color, polarityUp }) {
  const tH = Math.max(h * 0.06, 2 * S)
  const tR = Math.min(fx, fy) * 0.12
  return (
    <group position={pos}>
      <mesh castShadow position={[0, h / 2, 0]}>
        {cylindrical ? <cylinderGeometry args={[fx / 2, fx / 2, h, 28]} /> : <boxGeometry args={[fx * 0.98, h, fy * 0.98]} />}
        <meshStandardMaterial color={color} metalness={0.25} roughness={0.55} />
      </mesh>
      <mesh position={[0, h + tH / 2, cylindrical ? 0 : -fy * 0.28]}>
        <cylinderGeometry args={[tR, tR, tH, 16]} />
        <meshStandardMaterial color={polarityUp ? '#c0392b' : '#1f2937'} />
      </mesh>
      {!cylindrical && (
        <mesh position={[0, h + tH / 2, fy * 0.28]}>
          <cylinderGeometry args={[tR, tR, tH, 16]} />
          <meshStandardMaterial color={polarityUp ? '#1f2937' : '#c0392b'} />
        </mesh>
      )}
    </group>
  )
}

export default function PackView3D({ rows, cols, cellCount, cell, gapMm = 0, wallMm = 0, colorMode = 'group', temp, tempRange, showBusbars, envelope }) {
  const dims = cell?.dimensions
  const cylindrical = cell?.form_factor === 'cylindrical'
  const schematic = !(dims && ((cylindrical && dims.diameter_mm && dims.height_mm) || (dims.length_mm && dims.width_mm && dims.height_mm)))
  // footprint convention matches the backend: x = width (or diameter), z = length (or diameter)
  const fxMm = schematic ? 30 : cylindrical ? dims.diameter_mm : dims.width_mm
  const fyMm = schematic ? 60 : cylindrical ? dims.diameter_mm : dims.length_mm
  const hMm = schematic ? 80 : dims.height_mm
  const fx = fxMm * S, fy = fyMm * S, h = hMm * S, gap = (gapMm || 0) * S, wall = (wallMm || 0) * S
  const width = cols * fx + (cols - 1) * gap
  const depth = rows * fy + (rows - 1) * gap
  const size = Math.max(width, depth, h)

  const cells = useMemo(() => {
    const out = []
    for (let i = 0; i < cellCount; i++) {
      const r = Math.floor(i / cols), c = i % cols
      out.push({ i, r, c, pos: [c * (fx + gap) - width / 2 + fx / 2, 0, r * (fy + gap) - depth / 2 + fy / 2] })
    }
    return out
  }, [cellCount, cols, fx, fy, gap, width, depth])

  const color = (cellInfo) => (colorMode === 'temp' ? tempColor(temp, tempRange?.[0], tempRange?.[1]) : GROUP_COLORS[cellInfo.r % 2])

  return (
    <Canvas shadows camera={{ position: [size * 1.3, size * 1.1, size * 1.5], fov: 40, near: 0.01, far: 100 }} style={{ background: 'linear-gradient(#0b1220, #1b263b)' }}>
      <ambientLight intensity={0.55} />
      <directionalLight position={[size * 2, size * 3, size]} intensity={1.1} castShadow />
      <directionalLight position={[-size * 2, size, -size]} intensity={0.35} />
      {cells.map((c) => (
        <Cell key={c.i} pos={c.pos} fx={fx} fy={fy} h={h} cylindrical={cylindrical} color={color(c)} polarityUp={c.r % 2 === 0} />
      ))}
      {showBusbars && rows > 1 && Array.from({ length: rows - 1 }, (_, r) => {
        const z = (r + 1) * (fy + gap) - depth / 2 - gap / 2
        const x = r % 2 === 0 ? width / 2 - fx / 2 : -width / 2 + fx / 2
        return (
          <mesh key={r} position={[cols > 1 ? 0 : x, h + 0.012, z]}>
            <boxGeometry args={[cols > 1 ? width * 0.96 : fx * 0.6, 0.012, Math.max(fy * 0.35 + gap, 0.05)]} />
            <meshStandardMaterial color="#b87333" metalness={0.8} roughness={0.3} />
          </mesh>
        )
      })}
      {wall > 0 && (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[width + 2 * wall, h + 2 * wall, depth + 2 * wall]} />
          <meshStandardMaterial color="#94a3b8" transparent opacity={0.08} />
        </mesh>
      )}
      <gridHelper args={[size * 4, 20, '#334155', '#1e293b']} position={[0, -0.001, 0]} />
      {envelope && (
        <Html position={[0, h * 1.35 + 0.05, -depth / 2]} center>
          <div className="whitespace-nowrap rounded bg-ink-950/80 px-2 py-1 font-mono text-[11px] text-slate-100">{envelope}</div>
        </Html>
      )}
      <OrbitControls makeDefault enableDamping target={[0, h / 2, 0]} />
    </Canvas>
  )
}
