// Global workspace state: open project (persisted in the backend), active design, cached API results.
import { create } from 'zustand'

import { api } from '../lib/api'
import { blankDesign, setPath, uniqueName } from '../lib/design'

const LS_KEY = 'batteryx.lastProject'
const lsGet = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* storage unavailable */ } }

let saveTimer = null
const scheduleSave = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => useProject.getState().save(), 800)
}

const projectBody = (p) => ({ name: p.name, description: p.description, application: p.application, designs: p.designs, requirements: p.requirements })

export const useProject = create((set, get) => ({
  project: null,
  activeName: null,
  loading: false,
  loadError: null,
  saveState: 'idle', // idle | dirty | saving | saved | error
  saveError: null,
  rev: 0,
  results: {}, // results[designName][module] = { key, data, at }
  comparison: null, // { key, data, at }
  aiReport: null, // last copilot report-mode turn, offered to the report page
  cells: [],
  cellsLoaded: false,
  cellsError: null,

  async loadCells() {
    try {
      set({ cells: await api.cells.list(), cellsLoaded: true, cellsError: null })
    } catch (e) {
      set({ cellsLoaded: true, cellsError: e })
    }
  },

  async openProject(id) {
    set({ loading: true, loadError: null })
    try {
      const p = await api.projects.get(id)
      set({ project: p, activeName: p.designs[0]?.name ?? null, loading: false, results: {}, comparison: null, saveState: 'saved', rev: 0 })
      lsSet(LS_KEY, id)
    } catch (e) {
      set({ loading: false, loadError: e })
      if (e.status === 404) lsSet(LS_KEY, null)
    }
  },

  restoreLast() {
    const id = lsGet(LS_KEY)
    if (id && !get().project && !get().loading) get().openProject(id)
  },

  async createProject(meta) {
    const p = await api.projects.create({ ...meta, designs: [], requirements: [] })
    set({ project: p, activeName: null, results: {}, comparison: null, saveState: 'saved', rev: 0 })
    lsSet(LS_KEY, p.id)
    return p
  },

  closeProject() {
    clearTimeout(saveTimer)
    set({ project: null, activeName: null, results: {}, comparison: null, saveState: 'idle' })
    lsSet(LS_KEY, null)
  },

  _mutate(fn) {
    const p = get().project
    if (!p) return
    set({ project: fn(p), saveState: 'dirty', rev: get().rev + 1 })
    scheduleSave()
  },

  async save() {
    const { project, rev } = get()
    if (!project) return
    if (!project.name?.trim()) {
      set({ saveState: 'error', saveError: new Error('Project name cannot be empty. Enter a name to resume saving.') })
      return
    }
    set({ saveState: 'saving', saveError: null })
    try {
      const saved = await api.projects.update(project.id, projectBody(project))
      const now = get()
      if (now.project?.id !== saved.id) return
      set({ project: { ...now.project, updated_at: saved.updated_at }, saveState: now.rev === rev ? 'saved' : 'dirty' })
      if (now.rev !== rev) scheduleSave()
    } catch (e) {
      set({ saveState: 'error', saveError: e })
    }
  },

  updateMeta(patch) {
    get()._mutate((p) => ({ ...p, ...patch }))
  },
  setRequirements(reqs) {
    get()._mutate((p) => ({ ...p, requirements: reqs }))
  },
  setActive(name) {
    set({ activeName: name })
  },
  updateDesign(name, path, value) {
    get()._mutate((p) => ({ ...p, designs: p.designs.map((d) => (d.name === name ? setPath(d, path, value) : d)) }))
  },
  updateActive(path, value) {
    const n = get().activeName
    if (n) get().updateDesign(n, path, value)
  },
  addDesign(design = blankDesign()) {
    const p = get().project
    if (!p) return null
    const name = uniqueName(design.name || 'New design', p.designs.map((d) => d.name))
    const role = p.designs.length === 0 ? 'baseline' : design.role === 'baseline' && p.designs.some((d) => d.role === 'baseline') ? 'alternative' : design.role || 'alternative'
    get()._mutate((q) => ({ ...q, designs: [...q.designs, { ...design, name, role }] }))
    set({ activeName: name })
    return name
  },
  duplicateDesign(name) {
    const d = get().project?.designs.find((x) => x.name === name)
    if (d) get().addDesign({ ...structuredClone(d), name: `${name} (copy)`, role: 'alternative' })
  },
  removeDesign(name) {
    get()._mutate((p) => ({ ...p, designs: p.designs.filter((d) => d.name !== name) }))
    const { project, activeName, results } = get()
    const { [name]: _, ...rest } = results
    set({ results: rest, comparison: null, activeName: activeName === name ? project.designs[0]?.name ?? null : activeName })
  },
  renameDesign(oldName, newName) {
    const n = newName.trim()
    const p = get().project
    if (!n || n === oldName) return 'unchanged'
    if (p.designs.some((d) => d.name === n)) return 'A design with this name already exists.'
    get()._mutate((q) => ({ ...q, designs: q.designs.map((d) => (d.name === oldName ? { ...d, name: n } : d)) }))
    const { results, activeName } = get()
    const { [oldName]: moved, ...rest } = results
    set({ results: moved ? { ...rest, [n]: moved } : rest, activeName: activeName === oldName ? n : activeName, comparison: null })
    return null
  },
  setBaseline(name) {
    get()._mutate((p) => ({ ...p, designs: p.designs.map((d) => ({ ...d, role: d.name === name ? 'baseline' : 'alternative' })) }))
  },

  setResult(name, module, key, data) {
    set((s) => ({ results: { ...s.results, [name]: { ...(s.results[name] || {}), [module]: { key, data, at: Date.now() } } } }))
  },
  setAiReport(turn) {
    set({ aiReport: turn })
  },
  setComparison(c) {
    set({ comparison: c ? { ...c, at: Date.now() } : null })
  },
}))

export function useActiveDesign() {
  const project = useProject((s) => s.project)
  const activeName = useProject((s) => s.activeName)
  const cells = useProject((s) => s.cells)
  const design = project?.designs.find((d) => d.name === activeName) ?? null
  const cell = design ? design.cell ?? cells.find((c) => c.id === design.cell_id) ?? null : null
  return { project, design, cell, activeName }
}
