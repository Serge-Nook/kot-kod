import type { DiffFile, DiffHunk } from './types'

function quotePath(p: string): string {
  return /[\s"\\\t\n]/.test(p) || /[^\x20-\x7e]/.test(p) ? JSON.stringify(p) : p
}

/**
 * Builds a patch for `git apply` containing only the selected lines.
 * `selected` maps hunk index -> set of line indexes inside that hunk.
 * When `reverse` is true the patch is meant for `git apply -R`.
 */
export function buildPartialPatch(
  file: DiffFile,
  selected: Map<number, Set<number>>,
  reverse: boolean
): string | null {
  const oldPath = file.isNew ? '/dev/null' : `a/${file.oldPath ?? file.path}`
  const newPath = file.isDeleted ? '/dev/null' : `b/${file.path}`
  const out: string[] = [
    `diff --git a/${quotePath(file.oldPath ?? file.path)} b/${quotePath(file.path)}`,
    `--- ${oldPath === '/dev/null' ? oldPath : quotePath(oldPath)}`,
    `+++ ${newPath === '/dev/null' ? newPath : quotePath(newPath)}`
  ]
  let any = false
  let offset = 0
  file.hunks.forEach((hunk, hi) => {
    const sel = selected.get(hi)
    if (!sel || sel.size === 0) return
    const body = buildHunkBody(hunk, sel, reverse)
    if (!body) return
    any = true
    const newStart = hunk.oldStart + offset
    out.push(
      `@@ -${hunk.oldStart},${body.oldCount} +${newStart},${body.newCount} @@`
    )
    out.push(...body.lines)
    offset += body.newCount - body.oldCount
  })
  if (!any) return null
  return out.join('\n') + '\n'
}

function buildHunkBody(
  hunk: DiffHunk,
  sel: Set<number>,
  reverse: boolean
): { lines: string[]; oldCount: number; newCount: number } | null {
  const lines: string[] = []
  let oldCount = 0
  let newCount = 0
  let changed = false
  let lastKept: 'ctx' | 'add' | 'del' | null = null
  hunk.lines.forEach((l, li) => {
    if (l.type === 'nonl') {
      if (lastKept !== null) lines.push(l.text)
      return
    }
    if (l.type === 'ctx') {
      lines.push(' ' + l.text)
      oldCount++
      newCount++
      lastKept = 'ctx'
      return
    }
    const isSel = sel.has(li)
    if (isSel) {
      changed = true
      if (l.type === 'add') {
        lines.push('+' + l.text)
        newCount++
      } else {
        lines.push('-' + l.text)
        oldCount++
      }
      lastKept = l.type
      return
    }
    // unselected change line
    const keepAsContext = reverse ? l.type === 'add' : l.type === 'del'
    if (keepAsContext) {
      lines.push(' ' + l.text)
      oldCount++
      newCount++
      lastKept = 'ctx'
    } else {
      lastKept = null
    }
  })
  if (!changed) return null
  return { lines, oldCount, newCount }
}

export function allLinesSelection(file: DiffFile): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>()
  file.hunks.forEach((h, hi) => {
    const s = new Set<number>()
    h.lines.forEach((l, li) => {
      if (l.type === 'add' || l.type === 'del') s.add(li)
    })
    m.set(hi, s)
  })
  return m
}
