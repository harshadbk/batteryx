import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../lib/api'
import { designKey, designReady, payloadFor } from '../lib/design'
import { useActiveDesign, useProject } from '../store/project'

/** Fetch once on mount (and on demand). */
export function useFetch(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      setState({ data: await fnRef.current(), loading: false, error: null })
    } catch (e) {
      setState({ data: null, loading: false, error: e })
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, deps)
  return { ...state, reload }
}

/**
 * Runs backend calls for the active design and caches the result per design + module.
 * `runner(payload)` defaults to POST /api/v1/<module>. `stale` is true when inputs changed since the last run.
 */
export function useDesignRun(module, runner, { auto = false, debounceMs = 350 } = {}) {
  const { project, design, activeName } = useActiveDesign()
  const setResult = useProject((s) => s.setResult)
  const cached = useProject((s) => s.results[activeName]?.[module])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const key = design ? designKey(design, project) : null
  const ready = designReady(design)
  const runnerRef = useRef(runner)
  runnerRef.current = runner

  const run = useCallback(async () => {
    if (!design || !ready.ok) return null
    setLoading(true)
    setError(null)
    try {
      const payload = payloadFor(design, project)
      const data = runnerRef.current ? await runnerRef.current(payload) : await api.module(module, payload)
      setResult(activeName, module, key, data)
      return data
    } catch (e) {
      setError(e)
      return null
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, activeName, module, ready.ok])

  useEffect(() => {
    if (!auto || !ready.ok || (cached && cached.key === key)) return undefined
    const t = setTimeout(run, debounceMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, key, ready.ok])

  return { data: cached?.data ?? null, at: cached?.at, stale: !!cached && cached.key !== key, loading, error, run, ready }
}
