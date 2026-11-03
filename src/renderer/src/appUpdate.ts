import { useEffect, useState } from 'react'
import type { AppUpdateStatus } from '../../shared/types'

export function useAppUpdate(): AppUpdateStatus {
  const [status, setStatus] = useState<AppUpdateStatus>({ state: 'idle', currentVersion: '' })

  useEffect(() => {
    void window.api.getUpdateStatus().then(setStatus)
    return window.api.onUpdateStatus(setStatus)
  }, [])

  return status
}
