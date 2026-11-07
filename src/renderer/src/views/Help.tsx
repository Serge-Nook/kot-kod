import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../i18n'
import { Markdown } from '../components/ui'

export default function Help() {
  const t = useT()
  const lang = useStore((s) => s.settings?.language ?? 'ru')
  const shortcuts = useStore((s) => s.settings?.shortcuts ?? {})
  const [text, setText] = useState('')
  useEffect(() => {
    api.app.readHelp(lang).then(setText).catch(() => setText(''))
  }, [lang])
  return (
    <div className="page">
      <div className="section">
        <h3>{t('help.shortcuts')}</h3>
        <div className="grid2">
          {Object.entries(shortcuts).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <span>{t(`shortcut.${k}`)}</span>
              <span>
                <span className="kbd">{v}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <Markdown text={text || t('help.missing')} />
      </div>
      <div className="row">
        <button onClick={() => api.app.reportProblem()}>{t('help.report')}</button>
        <button onClick={() => api.app.openExternal('https://nookbat.ru')}>nookbat.ru</button>
      </div>
    </div>
  )
}
