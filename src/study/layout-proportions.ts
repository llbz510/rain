import { useEffect, useRef, useState } from 'react'
import { getDb } from '@/models/db-singleton'
import { getSetting, setSetting } from '@/models/database'

interface StudyProportions {
  columns: [number, number, number]
  follow: number
  mapExpand: number
}

const defaults: StudyProportions = { columns: [1 / 11, 7 / 11, 3 / 11], follow: 0.6, mapExpand: 0.6 }
const settingKey = 'study_layout_proportions'
let pendingSave: Promise<void> = Promise.resolve()

export function useStudyProportions() {
  const [proportions, setProportions] = useState(defaults)
  const current = useRef(proportions)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const saveId = useRef(0)
  useEffect(() => {
    let mounted = true
    void (async () => {
      await pendingSave
      const raw = await getSetting(await getDb(), settingKey)
      const saved: StudyProportions = raw ? JSON.parse(raw) : defaults
      if (mounted) { current.current = saved; setProportions(saved); setReady(true) }
    })().catch(() => { if (mounted) setError('无法恢复布局比例，请重新打开学习页。') })
    return () => { mounted = false }
  }, [])

  function change(next: StudyProportions) {
    current.current = next
    setProportions(next)
  }
  function save() {
    const id = ++saveId.current
    setSaving(true)
    const value = JSON.stringify(current.current)
    const write = pendingSave.then(async () => setSetting(await getDb(), settingKey, value))
    pendingSave = write.catch(() => {})
    void write.then(() => setError(null), () => setError('布局比例保存失败，请再次调整重试。')).finally(() => {
      if (id === saveId.current) setSaving(false)
    })
  }
  return { proportions, ready, saving, error, change, save }
}
