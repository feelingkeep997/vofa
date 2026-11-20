export type RailId = 'connect' | 'wave' | 'text' | 'send' | 'sim' | 'settings'

interface Props {
  active: RailId
  side: RailId | 'channel' | null
  onPick: (id: RailId) => void
}

const ICONS: Record<RailId, JSX.Element> = {
  connect: (
    <g>
      <path d="M9 7V4M15 7V4" />
      <rect x="6" y="7" width="12" height="7" rx="2" />
      <path d="M12 14v3a3 3 0 0 0 3 3h1" />
      <circle cx="18" cy="20" r="1.6" />
    </g>
  ),
  send: (
    <g>
      <path d="M4 20l16-8L4 4v6l10 2-10 2v6z" />
    </g>
  ),
  wave: (
    <g>
      <path d="M3 15l3.5-6 3 9 3.5-12 3 8 2.5-3.5L21 15" />
    </g>
  ),
  text: (
    <g>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l2.5 3L7 15M12 15h5" />
    </g>
  ),
  sim: (
    <g>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M6.2 6.2l3.6 3.6M17.8 6.2l-3.6 3.6M6.2 17.8l3.6-3.6M17.8 17.8l-3.6-3.6" />
      <circle cx="4.8" cy="4.8" r="1.9" />
      <circle cx="19.2" cy="4.8" r="1.9" />
      <circle cx="4.8" cy="19.2" r="1.9" />
      <circle cx="19.2" cy="19.2" r="1.9" />
    </g>
  ),
  settings: (
    <g>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
    </g>
  ),
}

const TITLES: Record<RailId, string> = {
  connect: '协议与连接',
  wave: '波形图',
  text: '文本区',
  send: '发送台',
  sim: '姿态仿真',
  settings: '设置与主题',
}

export default function Rail({ active, side, onPick }: Props) {
  return (
    <nav className="rail">
      <div className="rail-logo" title="VOFA+ Web">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
          <path
            d="M2 15l3-7 3 11 3.5-14L15 18l2.5-6L22 15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {(Object.keys(ICONS) as RailId[]).map((id) => (
        <button
          key={id}
          className={`rail-btn${active === id || side === id ? ' on' : ''}`}
          title={TITLES[id]}
          onClick={() => onPick(id)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[id]}
          </svg>
          <span>{TITLES[id].slice(0, 2)}</span>
        </button>
      ))}
      <div className="rail-spacer" />
      <div className="rail-ver">v0.1</div>
    </nav>
  )
}
