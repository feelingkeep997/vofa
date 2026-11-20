import { useEffect, useRef, useState } from 'react'
import { parseHexAuto, toHex } from '../lib/xcom'
import { parseSendText } from '../lib/protocol'

export interface MultiItem {
  text: string
  checked: boolean
}

export interface MultiPage {
  id: string
  name: string
  items: MultiItem[] // 固定 10 条，对应数字键 0-9
}

const PER_PAGE = 10

function emptyPage(n: number): MultiPage {
  return {
    id: Math.random().toString(36).slice(2, 9),
    name: `指令页 ${n}`,
    items: Array.from({ length: PER_PAGE }, () => ({ text: '', checked: false })),
  }
}

export function defaultPages(): MultiPage[] {
  const p = emptyPage(1)
  p.items[0] = { text: 'AT\\r\\n', checked: false }
  p.items[1] = { text: '01 03 00 00 00 0A C5 CD', checked: false }
  return [p]
}

interface Props {
  pages: MultiPage[]
  onChange: (pages: MultiPage[]) => void
  hex: boolean
  newLine: boolean
  onHex: (v: boolean) => void
  onNewLine: (v: boolean) => void
  connected: boolean
  onSendBytes: (bytes: Uint8Array, label: string) => Promise<boolean>
  notify: (m: string) => void
}

/** XCOM 的「多条发送」页：分页 / 勾选循环 / 数字键盘关联 / CSV 导入导出 */
export default function MultiSendPanel({
  pages,
  onChange,
  hex,
  newLine,
  onHex,
  onNewLine,
  connected,
  onSendBytes,
  notify,
}: Props) {
  const [pageIdx, setPageIdx] = useState(0)
  const [jump, setJump] = useState('')
  const [loop, setLoop] = useState(false)
  const [loopMs, setLoopMs] = useState(1000)
  const [relateKey, setRelateKey] = useState(false)
  const [loopCursor, setLoopCursor] = useState(0)

  const stateRef = useRef({ pages, pageIdx, hex, newLine, loop })
  stateRef.current = { pages, pageIdx, hex, newLine, loop }

  const page = pages[Math.min(pageIdx, pages.length - 1)]

  const encode = (text: string): Uint8Array | null => {
    const raw = hex ? parseHexAuto(text) : parseSendText(text, false)
    if (!raw) return null
    if (!newLine) return raw
    const out = new Uint8Array(raw.length + 2)
    out.set(raw, 0)
    out[raw.length] = 0x0d
    out[raw.length + 1] = 0x0a
    return out
  }

  const sendAt = (pi: number, ii: number) => {
    const p = pages[pi]
    const it = p?.items[ii]
    if (!it || !it.text.trim()) {
      notify('这一条是空的')
      return
    }
    const b = encode(it.text)
    if (!b) {
      notify('HEX 里有非法字符，发不出去')
      return
    }
    void onSendBytes(b, hex ? toHex(b, ' ') : it.text)
  }

  /* 自动循环：只发勾选的，按顺序轮转 */
  useEffect(() => {
    if (!loop || !connected) return
    const t = window.setInterval(() => {
      const s = stateRef.current
      const p = s.pages[s.pageIdx]
      if (!p) return
      const checked = p.items.map((it, i) => ({ it, i })).filter((x) => x.it.checked && x.it.text.trim())
      if (checked.length === 0) return
      const pick = checked[loopCursor % checked.length]
      setLoopCursor((c) => c + 1)
      const raw = s.hex ? parseHexAuto(pick.it.text) : parseSendText(pick.it.text, false)
      if (!raw) return
      let out = raw
      if (s.newLine) {
        out = new Uint8Array(raw.length + 2)
        out.set(raw, 0)
        out[raw.length] = 0x0d
        out[raw.length + 1] = 0x0a
      }
      void onSendBytes(out, s.hex ? toHex(out, ' ') : pick.it.text)
    }, Math.max(10, loopMs))
    return () => window.clearInterval(t)
  }, [loop, connected, loopMs, loopCursor, onSendBytes])

  /* 关联数字键盘：0-9 发当前页对应条目 */
  useEffect(() => {
    if (!relateKey) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (!/^[0-9]$/.test(e.key)) return
      e.preventDefault()
      sendAt(pageIdx, Number(e.key))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relateKey, pageIdx, pages, hex, newLine])

  const patchItem = (ii: number, patch: Partial<MultiItem>) => {
    const next = pages.map((p, pi) =>
      pi === pageIdx ? { ...p, items: p.items.map((it, k) => (k === ii ? { ...it, ...patch } : it)) } : p,
    )
    onChange(next)
  }

  const addPage = () => {
    const next = [...pages, emptyPage(pages.length + 1)]
    onChange(next)
    setPageIdx(next.length - 1)
  }

  const removePage = () => {
    if (pages.length <= 1) {
      notify('至少保留一页')
      return
    }
    const next = pages.filter((_, i) => i !== pageIdx)
    onChange(next)
    setPageIdx(Math.max(0, Math.min(pageIdx, next.length - 1)))
  }

  const exportCsv = () => {
    const lines = ['内容,勾选,页']
    pages.forEach((p, pi) =>
      p.items.forEach((it) => {
        const cell = `"${it.text.replace(/"/g, '""')}"`
        lines.push(`${cell},${it.checked ? 1 : 0},${pi + 1}`)
      }),
    )
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `多条发送_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    notify('已导出 CSV')
  }

  const importCsv = async (f: File | null) => {
    if (!f) return
    const text = await f.text()
    const rows = text.split(/\r?\n/).filter((l) => l.trim())
    const byPage = new Map<number, MultiItem[]>()
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i]
      if (i === 0 && /^"?内容"?\s*,/.test(line)) continue // 跳过表头
      // 拆列：内容(带引号) , 勾选 , 页
      const m = line.match(/^"((?:[^"]|"")*)"\s*,\s*([01]?)\s*(?:,\s*(\d+))?$/)
      let content: string
      let checked = false
      let pageNo = 1
      if (m) {
        content = m[1].replace(/""/g, '"')
        checked = m[2] === '1'
        pageNo = m[3] ? Number(m[3]) : 1
      } else {
        const parts = line.split(',')
        content = parts[0]?.trim() ?? ''
        checked = parts[1]?.trim() === '1'
        pageNo = parts[2] ? Number(parts[2]) : 1
      }
      const arr = byPage.get(pageNo) ?? []
      if (arr.length < PER_PAGE) arr.push({ text: content, checked })
      byPage.set(pageNo, arr)
    }
    const next: MultiPage[] = []
    for (const [no, items] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      const p = emptyPage(no)
      items.forEach((it, k) => {
        p.items[k] = it
      })
      next.push(p)
    }
    if (next.length === 0) {
      notify('CSV 里没读到有效条目')
      return
    }
    onChange(next)
    setPageIdx(0)
    notify(`已导入 ${next.length} 页 / ${next.reduce((n, p) => n + p.items.filter((x) => x.text).length, 0)} 条`)
  }

  return (
    <div className="xcom-page">
      <div className="toolbar">
        <button className={`mini${hex ? ' on' : ''}`} onClick={() => onHex(!hex)}>
          HEX
        </button>
        <button className={`mini${newLine ? ' on' : ''}`} onClick={() => onNewLine(!newLine)}>
          发送新行
        </button>
        <button className={`mini${loop ? ' on' : ''}`} onClick={() => setLoop(!loop)} title="只发送已勾选的条目">
          自动循环
        </button>
        <label className="inline">
          周期
          <input
            type="number"
            min={10}
            step={50}
            value={loopMs}
            onChange={(e) => setLoopMs(Math.max(10, Number(e.target.value) || 1000))}
          />
          ms
        </label>
        <button
          className={`mini${relateKey ? ' on' : ''}`}
          onClick={() => setRelateKey(!relateKey)}
          title="勾选后，在主键盘按 0-9 发送当前页对应条目"
        >
          关联数字键盘
        </button>
        <span className="tb-gap" />
        <span className="hint">每页 10 条 · 页数不限</span>
      </div>

      <div className="multi-grid">
        {page.items.map((it, i) => (
          <div className="multi-row" key={i}>
            <input
              type="checkbox"
              checked={it.checked}
              onChange={(e) => patchItem(i, { checked: e.target.checked })}
              title="勾选后参与自动循环"
            />
            <span className="multi-key">{i}</span>
            <input
              className="multi-input"
              value={it.text}
              placeholder={i === 0 ? '第一条指令' : `第 ${i} 条`}
              onChange={(e) => patchItem(i, { text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  sendAt(pageIdx, i)
                }
              }}
            />
            <button className="mini" onClick={() => sendAt(pageIdx, i)}>
              发送
            </button>
          </div>
        ))}
      </div>

      <div className="toolbar multi-pager">
        <button className="mini" disabled={pageIdx === 0} onClick={() => setPageIdx(0)}>
          首页
        </button>
        <button className="mini" disabled={pageIdx === 0} onClick={() => setPageIdx(pageIdx - 1)}>
          上一页
        </button>
        <span className="hint">
          {pageIdx + 1} / {pages.length}
        </span>
        <button className="mini" disabled={pageIdx >= pages.length - 1} onClick={() => setPageIdx(pageIdx + 1)}>
          下一页
        </button>
        <button className="mini" disabled={pageIdx >= pages.length - 1} onClick={() => setPageIdx(pages.length - 1)}>
          尾页
        </button>
        <label className="inline">
          跳转
          <input
            style={{ width: 56 }}
            value={jump}
            placeholder="页码"
            onChange={(e) => setJump(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const n = Number(jump)
              if (!Number.isFinite(n) || n < 1 || n > pages.length) {
                notify(`页码要在 1-${pages.length} 之间`)
                return
              }
              setPageIdx(n - 1)
              setJump('')
            }}
          />
        </label>
        <span className="tb-gap" />
        <button className="mini" onClick={addPage}>
          添加页
        </button>
        <button className="mini" onClick={removePage}>
          删除页
        </button>
        <span className="tb-gap" />
        <button className="mini" onClick={exportCsv}>
          导出 CSV
        </button>
        <label className="mini file-label">
          导入 CSV
          <input
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => void importCsv(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
    </div>
  )
}
