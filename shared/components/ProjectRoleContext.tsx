import { createContext, useContext, type ReactNode } from 'react'
import { canEdit, isOwner, type ProjectRole } from '@shared/api/collaborators'

/**
 * Tree-wide access role for the currently-viewed project. ProjectView wraps
 * its tree in {@link ProjectRoleProvider}; any descendant (RenamesPanel,
 * CryptoPanel, deobf buttons, etc.) calls {@link useCanEdit} or
 * {@link useIsOwner} to disable write affordances for VIEWERs without
 * threading the role through every component prop.
 *
 * <p>{@code null} matches the back-compat convention used elsewhere: an
 * absent role is treated as full owner access (older API responses, or
 * caller-is-owner paths that didn't bother computing a role).
 */
const ProjectRoleContext = createContext<ProjectRole | null | undefined>(undefined)

export function ProjectRoleProvider({
  role,
  children,
}: {
  role: ProjectRole | null
  children: ReactNode
}) {
  return <ProjectRoleContext.Provider value={role}>{children}</ProjectRoleContext.Provider>
}

export function useProjectRole(): ProjectRole | null {
  const role = useContext(ProjectRoleContext)
  if (role === undefined) {
    // No provider in tree — default to OWNER so legacy panels that haven't
    // been wrapped don't accidentally disable themselves.
    return 'OWNER'
  }
  return role
}

export function useCanEdit(): boolean {
  return canEdit(useProjectRole())
}

export function useIsOwner(): boolean {
  return isOwner(useProjectRole())
}
