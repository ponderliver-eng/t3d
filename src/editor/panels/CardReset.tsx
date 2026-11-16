import { RotateCcw } from 'lucide-react'
import { useI18n } from '../i18n'

export function CardReset({ disabled, onReset }: { disabled?: boolean, onReset: () => void }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className="iv2-card__reset"
      title={t('component.reset')}
      aria-label={t('component.reset')}
      disabled={disabled}
      onClick={onReset}
    >
      <RotateCcw size={12} />
    </button>
  )
}
