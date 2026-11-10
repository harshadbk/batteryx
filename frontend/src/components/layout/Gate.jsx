import { FolderOpen, PlusCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

import { blankDesign } from '../../lib/design'
import { useActiveDesign, useProject } from '../../store/project'
import { EmptyState, LoadingBlock } from '../ui/core'

/** Renders children only when a project and an active design exist; otherwise a helpful empty state. */
export default function RequireDesign({ children }) {
  const { project, design } = useActiveDesign()
  const loading = useProject((s) => s.loading)
  const addDesign = useProject((s) => s.addDesign)
  if (loading) return <LoadingBlock label="Opening project…" />
  if (!project)
    return (
      <EmptyState icon={FolderOpen} title="No project open" action={<Link className="btn-primary" to="/app/projects">Open or create a project</Link>}>
        Designs, results and reports live inside a project, which is saved in the backend database.
      </EmptyState>
    )
  if (!design)
    return (
      <EmptyState icon={PlusCircle} title="This project has no designs yet"
        action={<div className="flex flex-wrap justify-center gap-2">
          <Link className="btn-primary" to="/app/wizard" onClick={() => addDesign(blankDesign('Baseline'))}>Create a design</Link>
          <Link className="btn-secondary" to="/app/projects">Load stage-1 examples</Link>
        </div>}>
        Start with the configuration wizard, or load the illustrative A/B/C designs from the projects page.
      </EmptyState>
    )
  return children
}
