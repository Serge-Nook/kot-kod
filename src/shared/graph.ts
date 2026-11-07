import type { Commit } from './types'

export interface GraphEdge {
  from: number
  to: number
  color: number
}

export interface GraphRow {
  lane: number
  color: number
  /** edges in the upper half of the row (from previous row boundary to node level) */
  top: GraphEdge[]
  /** edges in the lower half of the row (from node level to next row boundary) */
  bottom: GraphEdge[]
  width: number
}

interface Lane {
  hash: string
  color: number
}

/** Lays out a commit graph for commits in topological (child-before-parent) order. */
export function layoutGraph(commits: Commit[]): GraphRow[] {
  const rows: GraphRow[] = []
  let lanes: (Lane | null)[] = []
  let nextColor = 0
  for (const c of commits) {
    let lane = lanes.findIndex((l) => l?.hash === c.hash)
    const top: GraphEdge[] = []
    let color: number
    if (lane === -1) {
      lane = lanes.findIndex((l) => l === null)
      if (lane === -1) lane = lanes.length
      color = nextColor++
      lanes[lane] = { hash: c.hash, color }
    } else {
      color = lanes[lane]!.color
    }
    // all lanes waiting for this commit converge into `lane`
    lanes.forEach((l, i) => {
      if (!l) return
      if (l.hash === c.hash) top.push({ from: i, to: lane, color: l.color })
      else top.push({ from: i, to: i, color: l.color })
    })
    lanes = lanes.map((l) => (l && l.hash === c.hash ? null : l))
    // assign parents
    const bottom: GraphEdge[] = []
    c.parents.forEach((p, pi) => {
      const existing = lanes.findIndex((l) => l?.hash === p)
      if (existing !== -1) {
        if (pi === 0 && existing > lane && lanes[lane] == null) {
          const moved = lanes[existing]!
          lanes[lane] = moved
          lanes[existing] = null
          bottom.push({ from: lane, to: lane, color: moved.color })
          bottom.push({ from: existing, to: lane, color: moved.color })
          return
        }
        bottom.push({ from: lane, to: existing, color: lanes[existing]!.color })
        return
      }
      let target: number
      let pColor: number
      if (pi === 0 && lanes[lane] == null) {
        target = lane
        pColor = color
      } else {
        target = lanes.findIndex((l) => l === null)
        if (target === -1) target = lanes.length
        pColor = nextColor++
      }
      lanes[target] = { hash: p, color: pColor }
      bottom.push({ from: lane, to: target, color: pColor })
    })
    lanes.forEach((l, i) => {
      if (!l) return
      if (bottom.some((e) => e.to === i)) return
      bottom.push({ from: i, to: i, color: l.color })
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const width =
      Math.max(
        lane,
        ...top.map((e) => Math.max(e.from, e.to)),
        ...bottom.map((e) => Math.max(e.from, e.to))
      ) + 1
    rows.push({ lane, color, top, bottom, width })
  }
  return rows
}
