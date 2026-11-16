import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import './KeyField.css'

/** 点击后捕获下一次按键，写入 KeyboardEvent.code（如 KeyG）。 */
export function KeyField({
  label,
  value,
  disabled,
  onChange,
}: {
  label?: string
  value: string
  disabled?: boolean
  onChange: (code: string) => void
}) {
  const { t } = useI18n()
  const [armed, setArmed] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!armed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.key === 'Tab') return
      event.preventDefault()
      event.stopPropagation()
      if (event.key !== 'Escape') onChangeRef.current(event.code)
      setArmed(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [armed])

  const input = (
    <input
      className={`key-capture${armed ? ' key-capture--armed' : ''}`}
      readOnly
      disabled={disabled}
      value={armed ? t('key.listening') : value}
      placeholder={t('key.hint')}
      title={t('key.hint')}
      onFocus={() => { if (!disabled) setArmed(true) }}
      onClick={() => { if (!disabled) setArmed(true) }}
      onBlur={() => setArmed(false)}
    />
  )
  if (!label) return input
  return (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  )
}
