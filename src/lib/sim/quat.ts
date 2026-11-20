/**
 * 四元数 / 向量数学 —— 与 CF-Drone `Middlewares/quaternion.h` + `vector.h` 同约定
 *
 * 约定（照抄固件，别自己发挥）：
 *   - 四元数 q 描述 **机体坐标系 → 世界坐标系** 的旋转；
 *   - fromEuler 用 ZYX 内旋（yaw-pitch-roll），与 toEuler 互逆；
 *   - rotateVector(v, q) = q⁻¹·v·q  = **世界系 → 机体系**；
 *   - conjugate(v)       = q·v·q⁻¹  = **机体系 → 世界系**；
 *   - 姿态增量用右乘：q ← q ⊗ fromRotationVector(ω·dt)（机体系角速率）。
 *
 * 坐标轴：X 前、Y 右、Z 上。roll 绕 X（+ = 右侧抬起），pitch 绕 Y（+ = 机头下压），
 * yaw 绕 Z（+ = 逆时针俯视）。
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Quat {
  w: number
  x: number
  y: number
  z: number
}

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const quat = (w = 1, x = 0, y = 0, z = 0): Quat => ({ w, x, y, z })

export const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const vScale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const vCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export const vNorm = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
export const vLen2 = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z
export const vUnit = (a: Vec3): Vec3 => {
  const n = vNorm(a)
  return n > 1e-12 ? vScale(a, 1 / n) : vec(0, 0, 1)
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const wrapAngle = (a: number): number => {
  // 归到 (-π, π]，与固件 cf_math.h 的 wrapAngle 语义一致
  while (a > Math.PI) a -= 2 * Math.PI
  while (a <= -Math.PI) a += 2 * Math.PI
  return a
}

/* ---------------- 四元数 ---------------- */

export const qNorm = (q: Quat): number => Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z)

export function qNormalize(q: Quat): Quat {
  const n = qNorm(q)
  if (!(n > 1e-12)) return quat()
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n }
}

export const qMul = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y + a.y * b.w + a.z * b.x - a.x * b.z,
  z: a.w * b.z + a.z * b.w + a.x * b.y - a.y * b.x,
})

export const qInverse = (q: Quat): Quat => {
  const n2 = q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z
  const inv = n2 > 1e-12 ? 1 / n2 : 0
  return { w: q.w * inv, x: -q.x * inv, y: -q.y * inv, z: -q.z * inv }
}

/** 由欧拉角 (roll, pitch, yaw) 构造，ZYX 内旋 —— 逐项对应固件 fromEuler */
export function qFromEuler(roll: number, pitch: number, yaw: number): Quat {
  const cx = Math.cos(roll / 2)
  const cy = Math.cos(pitch / 2)
  const cz = Math.cos(yaw / 2)
  const sx = Math.sin(roll / 2)
  const sy = Math.sin(pitch / 2)
  const sz = Math.sin(yaw / 2)
  return {
    w: cx * cy * cz + sx * sy * sz,
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
  }
}

/** → [roll, pitch, yaw]，rad。俯仰接近 ±90° 时走奇异分支（roll 置 0），与固件一致 */
export function qToEuler(q: Quat): Vec3 {
  const sqx = q.x * q.x
  const sqy = q.y * q.y
  const sqz = q.z * q.z
  const sqw = q.w * q.w
  const sarg = (-2 * (q.x * q.z - q.w * q.y)) / (sqx + sqy + sqz + sqw)
  if (sarg <= -0.99999) return vec(0, -Math.PI / 2, -2 * Math.atan2(q.y, q.x))
  if (sarg >= 0.99999) return vec(0, Math.PI / 2, 2 * Math.atan2(q.y, q.x))
  return vec(
    Math.atan2(2 * (q.y * q.z + q.w * q.x), sqw - sqx - sqy + sqz),
    Math.asin(clamp(sarg, -1, 1)),
    Math.atan2(2 * (q.x * q.y + q.w * q.z), sqw + sqx - sqy - sqz),
  )
}

/** 由旋转矢量（方向=轴，模长=角 rad）构造；零矢量安全返回恒等 */
export function qFromRotationVector(r: Vec3): Quat {
  const angle = vNorm(r)
  if (angle < 1e-9) return quat()
  const half = angle / 2
  const s = Math.sin(half) / angle
  return { w: Math.cos(half), x: r.x * s, y: r.y * s, z: r.z * s }
}

/** 机体系 → 世界系：q·v·q⁻¹ */
export function qConjugate(q: Quat, v: Vec3): Vec3 {
  const r = qMul(qMul(q, quat(0, v.x, v.y, v.z)), qInverse(q))
  return vec(r.x, r.y, r.z)
}

/** 世界系 → 机体系：q⁻¹·v·q（固件里的 rotateVector） */
export function qRotateVector(q: Quat, v: Vec3): Vec3 {
  const r = qMul(qMul(qInverse(q), quat(0, v.x, v.y, v.z)), q)
  return vec(r.x, r.y, r.z)
}

/** 把 a 转到 b 所需的最小旋转矢量（axis·angle）—— 姿态误差控制的核心 */
export function rotationVectorBetween(a: Vec3, b: Vec3): Vec3 {
  const an = vNorm(a)
  const bn = vNorm(b)
  if (!(an > 1e-9) || !(bn > 1e-9)) return vec()
  const u = vScale(a, 1 / an)
  const v = vScale(b, 1 / bn)
  const dot = clamp(vDot(u, v), -1, 1)
  let axis = vCross(u, v)
  const axisNorm = vNorm(axis)
  if (axisNorm < 1e-9) {
    // 平行或反向：平行返回 0，反向取任意垂直轴转 π
    if (dot > 0) return vec()
    const ref = Math.abs(u.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0)
    axis = vUnit(vCross(u, ref))
    return vScale(axis, Math.PI)
  }
  const angle = Math.atan2(axisNorm, dot)
  return vScale(vScale(axis, 1 / axisNorm), angle)
}

/** 右乘机体系增量旋转：q ← q ⊗ Δ */
export const qRotate = (q: Quat, delta: Quat): Quat => qNormalize(qMul(q, delta))
