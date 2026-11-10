import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CellDetail, CellForm, CellList } from '../components/cells/CellComponents'
import { EmptyState, ErrorBox, LoadingBlock, PageHeader, Panel } from '../components/ui/core'
import { api } from '../lib/api'
import { useActiveDesign, useProject } from '../store/project'

/** Cell picker used by the Cells page and the wizard. */
export function CellPicker({ showAdd = true }) {
  const { design } = useActiveDesign()
  const { cells, cellsLoaded, cellsError, loadCells, updateActive } = useProject()
  const [selected, setSelected] = useState(design?.cell_id || design?.cell?.id || null)
  const [adding, setAdding] = useState(false)
  const [delErr, setDelErr] = useState(null)
  useEffect(() => { if (!selected && cells.length) setSelected(cells[0].id) }, [cells, selected])
  const cell = cells.find((c) => c.id === selected)
  const use = () => { updateActive('cell_id', cell.id); updateActive('cell', null) }
  const remove = async () => {
    if (!window.confirm(`Delete cell ${cell.id} from the database?`)) return
    try { await api.cells.remove(cell.id); setSelected(null); loadCells() } catch (e) { setDelErr(e) }
  }
  if (!cellsLoaded) return <LoadingBlock label="Loading cell database…" />
  if (cellsError) return <ErrorBox error={cellsError} onRetry={loadCells} />
  if (adding) return <CellForm onCancel={() => setAdding(false)} onCreated={(c) => { setAdding(false); setSelected(c.id) }} />
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="space-y-2">
        <CellList cells={cells} selectedId={selected} onSelect={setSelected} activeCellId={design?.cell_id} />
        {showAdd && <button className="btn-secondary w-full" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add cell from datasheet</button>}
      </div>
      <div className="min-w-0">
        {cell ? <CellDetail cell={cell} onUse={design ? use : null} isActive={design?.cell_id === cell.id} onDelete={remove} />
          : <EmptyState title="No cell selected">Pick a cell on the left, or add one from its datasheet.</EmptyState>}
        <ErrorBox error={delErr} className="mt-3" />
      </div>
    </div>
  )
}

export default function Cells() {
  return (
    <div>
      <PageHeader kicker="Design" title="Cell selection"
        description="The cell database records every value with its provenance. Values the datasheet does not give are left empty; the platform never fills them in." />
      <Panel><CellPicker /></Panel>
    </div>
  )
}
