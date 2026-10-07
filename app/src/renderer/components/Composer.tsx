import { useState } from 'react'
import type { KeyboardEvent } from 'react'

export function Composer({
  onSend,
  disabled,
  placeholder,
}: {
  onSend: (prompt: string) => void
  disabled: boolean
  placeholder: string
}) {
  const [value, setValue] = useState('')

  function send() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') send()
  }

  return (
    <div className="composer-wrap">
      <div className="slashes">
        <span className="slash mono">/review</span>
        <span className="slash mono">/new-skill</span>
        <span className="slash mono">/undo</span>
      </div>
      <div className="composer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth={1.8}>
          <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" />
        </svg>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          data-testid="composer-input"
        />
        <button className="send" onClick={send} disabled={disabled} data-testid="composer-send" aria-label="Send">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
            <path d="M4 12 L20 12 M13 5 L20 12 L13 19" />
          </svg>
        </button>
      </div>
    </div>
  )
}
