import { useCallback, useRef } from 'react'
import { selectNodeForGroup, unfixedProxy } from 'tauri-plugin-mihomo-api'

import {
  useForgetSelection,
  useRecordSelection,
} from '@/hooks/use-record-selection'
import { useVerge } from '@/hooks/use-verge'
import {
  closeNodeConnectionsWhenIdle,
  syncTrayProxySelection,
} from '@/services/cmds'
import { debugLog } from '@/utils/debug'

// Connections still moving data (an AI answer, a download) finish on the old node first.
const cleanupConnections = async (previousProxy: string) => {
  try {
    await closeNodeConnectionsWhenIdle(previousProxy)
  } catch (error) {
    console.warn('[ProxySelection] 连接清理失败:', error)
  }
}

interface ProxySelectionOptions {
  onSuccess?: () => void
  onError?: (error: any) => void
  enableConnectionCleanup?: boolean
}

interface ProxyChangeRequest {
  groupName: string
  proxyName: string
  previousProxy?: string
  fixed?: string
}

// 代理选择 Hook
export const useProxySelection = (options: ProxySelectionOptions = {}) => {
  const recordSelection = useRecordSelection()
  const forgetSelection = useForgetSelection()
  const { verge } = useVerge()
  const pendingRequestRef = useRef<ProxyChangeRequest | null>(null)
  const isProcessingRef = useRef(false)

  const { onSuccess, onError, enableConnectionCleanup = true } = options

  const autoCloseConnection = verge?.auto_close_connection ?? true

  // 切换节点
  const syncTraySelection = useCallback(() => {
    syncTrayProxySelection().catch((error) => {
      console.error('[ProxySelection] 托盘状态同步失败:', error)
    })
  }, [])

  const executeChange = useCallback(
    async (request: ProxyChangeRequest) => {
      const { groupName, proxyName, previousProxy, fixed } = request
      const isFixedProxy = fixed === proxyName
      if (isFixedProxy) {
        debugLog(`[ProxySelection] 代理取消固定: ${groupName} -> ${proxyName}`)
      } else {
        debugLog(`[ProxySelection] 代理切换: ${groupName} -> ${proxyName}`)
      }

      try {
        if (isFixedProxy) {
          await unfixedProxy(groupName)
        } else {
          await selectNodeForGroup(groupName, proxyName)
        }
        onSuccess?.()
        syncTraySelection()
        if (isFixedProxy) {
          await forgetSelection(groupName)
          debugLog(`[ProxySelection] 代理和状态同步完成: ${groupName}`)
        } else {
          await recordSelection(groupName, proxyName)
          debugLog(
            `[ProxySelection] 代理和状态同步完成: ${groupName} -> ${proxyName}`,
          )
        }

        if (enableConnectionCleanup && autoCloseConnection && previousProxy) {
          void cleanupConnections(previousProxy)
        }
      } catch (error) {
        console.error(
          `[ProxySelection] 代理切换失败: ${groupName} -> ${proxyName}`,
          error,
        )
        onError?.(error)
      }
    },
    [
      autoCloseConnection,
      forgetSelection,
      enableConnectionCleanup,
      onError,
      onSuccess,
      recordSelection,
      syncTraySelection,
    ],
  )

  const flushChangeQueue = useCallback(async () => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true

    try {
      while (pendingRequestRef.current) {
        const request = pendingRequestRef.current
        pendingRequestRef.current = null
        await executeChange(request)
      }
    } finally {
      isProcessingRef.current = false
      if (pendingRequestRef.current) {
        void flushChangeQueue()
      }
    }
  }, [executeChange])

  const changeProxy = useCallback(
    (
      groupName: string,
      proxyName: string,
      previousProxy?: string,
      fixed?: string,
    ) => {
      pendingRequestRef.current = {
        groupName,
        proxyName,
        previousProxy,
        fixed,
      }
      void flushChangeQueue()
    },
    [flushChangeQueue],
  )

  const handleSelectChange = useCallback(
    (groupName: string, previousProxy?: string, fixed?: string) =>
      (event: { target: { value: string } }) => {
        changeProxy(groupName, event.target.value, previousProxy, fixed)
      },
    [changeProxy],
  )

  const handleProxyGroupChange = useCallback(
    (
      group: { name: string; now?: string; fixed?: string },
      proxy: { name: string },
    ) => {
      changeProxy(group.name, proxy.name, group.now, group.fixed)
    },
    [changeProxy],
  )

  return {
    changeProxy,
    handleSelectChange,
    handleProxyGroupChange,
  }
}
