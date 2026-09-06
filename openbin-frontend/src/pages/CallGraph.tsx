import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { useApi } from '@shared/api/client'

// =========================================================================
// Types — kept narrow on purpose so the page only depends on the fields it
// actually renders. Mirrors the shape ProjectView consumes.
// =========================================================================

type DisasmLine = { addr: string; text: string }
type Xrefs = { callers: string[]; callees: string[] }
type BinaryFunction = {
  name: string
  address: string
  size: number
  signature: string
  decompiled: string | null
  disassembly: DisasmLine[] | null
  xrefs: Xrefs
  external: boolean
  thunk: boolean
}
type BinaryAnalysis = {
  functions: BinaryFunction[]
  strings: string[]
  imports: string[]
  metadata: Record<string, string | number>
}
type ProjectSummary = {
  id: string
  name: string
  kind: 'APK' | 'BIN'
  arch: string | null
  executableFormat: string | null
}
type Deobfuscation = { originalName: string }

// =========================================================================
// Layout — dagre takes our nodes + edges + node-size info and assigns each
// node an (x, y). We then hand the positioned nodes to ReactFlow which
// owns rendering / panning / zooming / mini-map.
// =========================================================================

const NODE_WIDTH = 200
const NODE_HEIGHT = 64

type LayoutDirection = 'TB' | 'LR'

function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection,
): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 30, ranksep: 60 })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }
  dagre.layout(g)

  return nodes.map((node) => {
    const positioned = g.node(node.id)
    return {
      ...node,
      position: {
        x: positioned.x - NODE_WIDTH / 2,
        y: positioned.y - NODE_HEIGHT / 2,
      },
      // For top-to-bottom layouts, edges enter via top and leave via bottom.
      // For left-to-right, swap to left/right. Setting these on the node
      // controls where the Handle endpoints anchor in the custom node.
      sourcePosition: direction === 'LR' ? Position.Right : Position.Bottom,
      targetPosition: direction === 'LR' ? Position.Left : Position.Top,
    }
  })
}

// =========================================================================
// Graph build — BFS outward from a root function. Two passes (callees
// downward, optionally callers upward) so the tree shows what the function
// reaches AND who reaches it. Dedupe across the whole graph so a function
// reachable from multiple paths only appears once (matches the openbin
// chain-panel rendering rule).
// =========================================================================

type GraphData = { nodes: Node[]; edges: Edge[]; truncated: boolean }

const MAX_NODES = 250 // hard cap so a single huge function doesn't lock up the renderer
const FANOUT_PER_NODE = 12 // edges expanded from any one node; matches CHAIN_MAX_FANOUT

function buildGraph(
  rootName: string,
  fnByName: Map<string, BinaryFunction>,
  opts: {
    calleeDepth: number
    callerDepth: number
    includeExternals: boolean
    includeThunks: boolean
    renames: Set<string>
    deobfs: Set<string>
  },
  selectedName: string | null,
): GraphData {
  const rootFn = fnByName.get(rootName)
  if (!rootFn) return { nodes: [], edges: [], truncated: false }

  const nodes = new Map<string, Node>()
  const edges: Edge[] = []
  let truncated = false

  function addNode(fn: BinaryFunction | null, name: string, kind: 'root' | 'callee' | 'caller') {
    if (nodes.has(name)) return
    if (nodes.size >= MAX_NODES) {
      truncated = true
      return
    }
    if (fn) {
      if (!opts.includeExternals && fn.external) return
      if (!opts.includeThunks && fn.thunk) return
    }
    nodes.set(name, {
      id: name,
      type: 'fn',
      position: { x: 0, y: 0 }, // dagre fills this in
      data: {
        name,
        fn,
        kind,
        renamed: opts.renames.has(name),
        deobf: opts.deobfs.has(name),
        selected: name === selectedName,
      },
    })
  }

  function addEdge(source: string, target: string) {
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: { stroke: 'var(--color-zinc-600)', strokeWidth: 1.25 },
    })
  }

  // BFS downward (callees)
  addNode(rootFn, rootName, 'root')
  const downQueue: { name: string; depth: number }[] = [{ name: rootName, depth: 0 }]
  const visitedDown = new Set<string>([rootName])
  while (downQueue.length > 0) {
    const { name, depth } = downQueue.shift()!
    if (depth >= opts.calleeDepth) continue
    const fn = fnByName.get(name)
    if (!fn) continue
    const ns = fn.xrefs.callees
    let added = 0
    for (const c of ns) {
      if (added >= FANOUT_PER_NODE) { truncated = true; break }
      const cf = fnByName.get(c) ?? null
      addNode(cf, c, 'callee')
      // The addNode call above may have rejected this entry (external/thunk
      // filter, MAX_NODES); only draw the edge when the destination made
      // it in. Otherwise the graph paints orphan arrows pointing nowhere.
      if (!nodes.has(c)) continue
      addEdge(name, c)
      added++
      if (!visitedDown.has(c) && cf && !cf.external && !cf.thunk) {
        visitedDown.add(c)
        downQueue.push({ name: c, depth: depth + 1 })
      }
    }
  }

  // BFS upward (callers) — only from the root, not transitively from
  // every callee node. We don't want a function in the middle of the
  // callees tree to suddenly grow its own caller branch; that's confusing
  // visually. Just show "who calls the root".
  if (opts.callerDepth > 0 && nodes.size < MAX_NODES) {
    const upQueue: { name: string; depth: number }[] = [{ name: rootName, depth: 0 }]
    const visitedUp = new Set<string>([rootName])
    while (upQueue.length > 0) {
      const { name, depth } = upQueue.shift()!
      if (depth >= opts.callerDepth) continue
      const fn = fnByName.get(name)
      if (!fn) continue
      const ns = fn.xrefs.callers
      let added = 0
      for (const c of ns) {
        if (added >= FANOUT_PER_NODE) { truncated = true; break }
        const cf = fnByName.get(c) ?? null
        addNode(cf, c, 'caller')
        if (!nodes.has(c)) continue
        addEdge(c, name)
        added++
        if (!visitedUp.has(c) && cf && !cf.external && !cf.thunk) {
          visitedUp.add(c)
          upQueue.push({ name: c, depth: depth + 1 })
        }
      }
    }
  }

  return { nodes: Array.from(nodes.values()), edges, truncated }
}

// =========================================================================
// Custom node — bubble/card with the function name, address, and badges
// for the things the user cares about at a glance: entry vs callee vs
// caller, external/thunk, has renames, has deobf cache.
// =========================================================================

type FnNodeData = {
  name: string
  fn: BinaryFunction | null
  kind: 'root' | 'callee' | 'caller'
  renamed: boolean
  deobf: boolean
  selected: boolean
}

function FunctionNode({ data }: NodeProps) {
  const d = data as unknown as FnNodeData
  const fn = d.fn
  const isExternal = fn?.external ?? false
  const isThunk = fn?.thunk ?? false
  const missing = fn === null // referenced but not in fnByName

  // Color stack: root > selected > external/thunk > renamed > default.
  // Border carries the strongest signal so it's visible at zoomed-out
  // levels where the node text becomes a blur.
  let borderClass = 'border-zinc-700'
  let bgClass = 'bg-zinc-900'
  let textClass = 'text-zinc-100'
  if (d.kind === 'root') {
    borderClass = 'border-purple-400'
    bgClass = 'bg-purple-950/40'
  } else if (d.selected) {
    borderClass = 'border-sky-400'
    bgClass = 'bg-sky-950/40'
  } else if (isExternal) {
    borderClass = 'border-amber-600/60'
    bgClass = 'bg-amber-950/20'
    textClass = 'text-amber-200'
  } else if (isThunk) {
    borderClass = 'border-zinc-600'
    bgClass = 'bg-zinc-900/60'
    textClass = 'text-zinc-400'
  } else if (missing) {
    borderClass = 'border-zinc-700 border-dashed'
    bgClass = 'bg-zinc-900/40'
    textClass = 'text-zinc-500'
  } else if (d.renamed) {
    borderClass = 'border-emerald-700/60'
  }

  return (
    <div
      className={`relative w-[200px] rounded-md border-2 ${borderClass} ${bgClass} px-2 py-1.5 shadow-sm transition-shadow hover:shadow-md`}
      title={fn ? `${d.name}\n${fn.signature || ''}\n${fn.size} bytes` : `${d.name} (not in functions list)`}
    >
      <Handle type="target" position={Position.Top} style={{ background: 'var(--color-zinc-600)', width: 6, height: 6 }} />
      <div className={`truncate text-[12px] font-mono ${textClass}`}>
        {d.name}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1 text-[9px] text-zinc-500">
        <span className="font-mono">{fn ? fn.address : '—'}</span>
        <div className="flex items-center gap-0.5">
          {d.kind === 'root' && (
            <span className="rounded bg-purple-900/60 px-1 text-[9px] text-purple-200">ROOT</span>
          )}
          {isExternal && (
            <span className="rounded bg-amber-900/60 px-1 text-[9px] text-amber-200">ext</span>
          )}
          {isThunk && (
            <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-300">thunk</span>
          )}
          {d.renamed && !isExternal && !isThunk && (
            <span className="rounded bg-emerald-900/60 px-1 text-[9px] text-emerald-200">✎</span>
          )}
          {d.deobf && (
            <span className="rounded bg-emerald-900/60 px-1 text-[9px] text-emerald-200">✨</span>
          )}
          {missing && (
            <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-400">?</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--color-zinc-600)', width: 6, height: 6 }} />
    </div>
  )
}

const nodeTypes = { fn: FunctionNode }

// =========================================================================
// Root-selection heuristic — pick the most likely "entry point" function
// when the user lands on /graph without specifying one. Order mirrors the
// ProjectView default function pick.
// =========================================================================

const ENTRY_CANDIDATES = ['entry', '_start', 'main', '_main', 'start']

function defaultRoot(functions: BinaryFunction[]): string | null {
  for (const candidate of ENTRY_CANDIDATES) {
    const match = functions.find((f) => f.name === candidate)
    if (match) return match.name
  }
  const concrete = functions.find((f) => !f.external && !f.thunk)
  return concrete?.name ?? functions[0]?.name ?? null
}

// =========================================================================
// Page
// =========================================================================

export function CallGraph() {
  const { id = '' } = useParams<{ id: string }>()
  const api = useApi()

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [analysis, setAnalysis] = useState<BinaryAnalysis | null>(null)
  const [deobfNames, setDeobfNames] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initial root can be passed in via ?root= from the project header link
  // so the graph opens centered on whatever the user was looking at.
  const [searchParams] = useSearchParams()
  const initialRoot = searchParams.get('root')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [p, a, d] = await Promise.all([
          api<ProjectSummary>(`/api/projects/${id}`),
          api<BinaryAnalysis>(`/api/projects/${id}/binary-analysis`),
          api<Deobfuscation[]>(`/api/projects/${id}/deobfuscations`).catch(() => [] as Deobfuscation[]),
        ])
        if (cancelled) return
        setProject(p)
        setAnalysis(a)
        setDeobfNames(new Set(d.map((x) => x.originalName)))
        setError(null)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [api, id])

  if (loading) {
    return <CenteredMessage>Loading call graph…</CenteredMessage>
  }
  if (error) {
    return (
      <CenteredMessage>
        <div className="text-red-400">{error}</div>
        <Link to={`/projects/${id}`} className="mt-4 inline-block text-xs text-purple-400 hover:underline">
          ← Back to project
        </Link>
      </CenteredMessage>
    )
  }
  if (!project || !analysis) {
    return <CenteredMessage>No data.</CenteredMessage>
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <Header project={project} projectId={id} />
      <ReactFlowProvider>
        <GraphCanvas
          projectId={id}
          analysis={analysis}
          deobfNames={deobfNames}
          initialRoot={initialRoot}
        />
      </ReactFlowProvider>
    </div>
  )
}

function Header({ project, projectId }: { project: ProjectSummary; projectId: string }) {
  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5 text-sm">
      <Link to={`/projects/${projectId}`} className="text-zinc-500 hover:text-zinc-300">
        ← Code
      </Link>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-zinc-100">
          {project.name} <span className="text-zinc-500">— call graph</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">
          {project.executableFormat ?? '—'} · {project.arch ?? 'arch unknown'}
        </div>
      </div>
    </header>
  )
}

function GraphCanvas({
  projectId,
  analysis,
  deobfNames,
  initialRoot,
}: {
  projectId: string
  analysis: BinaryAnalysis
  deobfNames: Set<string>
  initialRoot: string | null
}) {
  const fnByName = useMemo(
    () => new Map(analysis.functions.map((f) => [f.name, f])),
    [analysis],
  )

  const fnNames = useMemo(
    () => analysis.functions.map((f) => f.name).sort(),
    [analysis],
  )

  // Rename set — every function name in fnByName that has been renamed
  // applies a green outline in the node. The frontend always sees the
  // POST-rename name in the analysis JSON, so the trick to detect a
  // rename is: was this name on the suggested side of any APPLIED rename?
  // We don't fetch renames here for v1; just leave the rename badge off.
  // (Could re-fetch /renames if the visual signal turns out to matter.)
  const renames = useMemo(() => new Set<string>(), [])

  const [root, setRoot] = useState<string>(
    () => (initialRoot && fnByName.has(initialRoot) ? initialRoot : defaultRoot(analysis.functions) ?? ''),
  )
  const [calleeDepth, setCalleeDepth] = useState(3)
  const [callerDepth, setCallerDepth] = useState(1)
  const [includeExternals, setIncludeExternals] = useState(false)
  const [includeThunks, setIncludeThunks] = useState(false)
  const [direction, setDirection] = useState<LayoutDirection>('TB')

  // Selected = clicked node in the canvas. Different from `root` (which
  // is the seed of the BFS); selecting a node highlights it and surfaces
  // its metadata in the right rail, without re-laying-out the graph.
  const [selected, setSelected] = useState<string | null>(null)

  // Filter applied to the root search dropdown.
  const [filter, setFilter] = useState('')
  const filteredNames = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return fnNames.slice(0, 200) // cap to keep the dropdown tractable
    return fnNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 200)
  }, [fnNames, filter])

  const graph = useMemo(
    () =>
      buildGraph(
        root,
        fnByName,
        {
          calleeDepth,
          callerDepth,
          includeExternals,
          includeThunks,
          renames,
          deobfs: deobfNames,
        },
        selected,
      ),
    [root, fnByName, calleeDepth, callerDepth, includeExternals, includeThunks, renames, deobfNames, selected],
  )

  const laidOut = useMemo(
    () => ({ nodes: layoutGraph(graph.nodes, graph.edges, direction), edges: graph.edges }),
    [graph, direction],
  )

  const { fitView } = useReactFlow()
  // Re-fit the view whenever the graph topology changes (new root, new
  // depth, filter toggles). Without this the camera stays at the previous
  // viewport and the user has to manually pan to find the new content.
  useEffect(() => {
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }))
  }, [root, calleeDepth, callerDepth, includeExternals, includeThunks, direction, fitView])

  const onNodeClick = useCallback((_e: unknown, node: Node) => {
    setSelected(node.id)
  }, [])

  const onNodeDoubleClick = useCallback((_e: unknown, node: Node) => {
    // Double-click recenters — anchors the BFS at this node and re-lays
    // out. Most natural way to "drill into" a function from the graph.
    setRoot(node.id)
    setSelected(node.id)
  }, [])

  const selectedFn = selected ? fnByName.get(selected) ?? null : null

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px]">
      {/* Left controls */}
      <aside className="flex min-h-0 flex-col border-r border-zinc-800 p-3 text-xs">
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Root</div>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${fnNames.length} functions…`}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
            />
            <ul className="mt-1 max-h-64 overflow-y-auto rounded border border-zinc-800">
              {filteredNames.map((n) => (
                <li key={n}>
                  <button
                    onClick={() => setRoot(n)}
                    className={`block w-full truncate px-2 py-1 text-left font-mono text-[11px] ${
                      n === root
                        ? 'bg-purple-950/60 text-purple-200'
                        : 'text-zinc-300 hover:bg-zinc-900'
                    }`}
                  >
                    {n}
                  </button>
                </li>
              ))}
              {filteredNames.length === 0 && (
                <li className="px-2 py-1 text-zinc-500">No matches.</li>
              )}
            </ul>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Shape</div>
            <label className="flex items-center justify-between">
              <span className="text-zinc-400">Callee depth</span>
              <input
                type="number"
                min={1}
                max={6}
                value={calleeDepth}
                onChange={(e) => setCalleeDepth(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                className="w-12 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-zinc-400">Caller depth</span>
              <input
                type="number"
                min={0}
                max={4}
                value={callerDepth}
                onChange={(e) => setCallerDepth(Math.max(0, Math.min(4, Number(e.target.value) || 0)))}
                className="w-12 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200"
              />
            </label>
            <label className="flex items-center gap-2 text-zinc-400">
              <input
                type="checkbox"
                checked={includeExternals}
                onChange={(e) => setIncludeExternals(e.target.checked)}
                className="h-3 w-3"
              />
              <span>Show externals</span>
            </label>
            <label className="flex items-center gap-2 text-zinc-400">
              <input
                type="checkbox"
                checked={includeThunks}
                onChange={(e) => setIncludeThunks(e.target.checked)}
                className="h-3 w-3"
              />
              <span>Show thunks</span>
            </label>
            <label className="flex items-center justify-between">
              <span className="text-zinc-400">Direction</span>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as LayoutDirection)}
                className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200"
              >
                <option value="TB">Top → Bottom</option>
                <option value="LR">Left → Right</option>
              </select>
            </label>
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] text-zinc-500">
            <div className="mb-1 uppercase tracking-wider text-zinc-600">Stats</div>
            <div>{graph.nodes.length} nodes · {graph.edges.length} edges</div>
            {graph.truncated && (
              <div className="mt-1 text-amber-400/80">
                Truncated — increase fan-out cap or narrow scope to see more.
              </div>
            )}
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] text-zinc-500">
            <div className="mb-1 uppercase tracking-wider text-zinc-600">Legend</div>
            <div className="space-y-0.5">
              <div><span className="mr-1 inline-block h-2 w-2 rounded-sm border-2 border-purple-400" />Root</div>
              <div><span className="mr-1 inline-block h-2 w-2 rounded-sm border-2 border-sky-400" />Selected</div>
              <div><span className="mr-1 inline-block h-2 w-2 rounded-sm border-2 border-amber-600/60" />External</div>
              <div><span className="mr-1 inline-block h-2 w-2 rounded-sm border-2 border-zinc-600" />Thunk</div>
              <div><span className="mr-1 inline-block h-2 w-2 rounded-sm border-2 border-emerald-700/60" />Renamed / has deobf</div>
            </div>
            <div className="mt-2 text-zinc-600">
              Click: select · Double-click: recenter
            </div>
          </div>
        </div>
      </aside>

      {/* Canvas */}
      <div className="relative min-h-0">
        <ReactFlow
          nodes={laidOut.nodes}
          edges={laidOut.edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          fitView
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          style={{ backgroundColor: 'var(--color-zinc-950)' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-zinc-800)" />
          <Controls
            showInteractive={false}
            position="bottom-right"
            className="!border !border-zinc-800 !bg-zinc-900 !text-zinc-100"
          />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={2}
            position="bottom-left"
            className="!border !border-zinc-800 !bg-zinc-900"
            nodeColor={(n) => {
              const data = n.data as unknown as FnNodeData
              if (data.kind === 'root') return '#a855f7'
              if (data.selected) return '#38bdf8'
              if (data.fn?.external) return '#d97706'
              if (data.fn?.thunk) return '#52525b'
              return '#a1a1aa'
            }}
            maskColor="rgba(11, 13, 18, 0.6)"
          />
        </ReactFlow>
      </div>

      {/* Right rail — function detail for the selected node */}
      <aside className="flex min-h-0 flex-col border-l border-zinc-800 p-3 text-xs">
        {!selected || !selectedFn ? (
          <div className="text-zinc-500">
            Click a node to inspect it. Double-click any node to recenter
            the graph on that function.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Function</div>
              <div className="truncate font-mono text-sm text-zinc-100" title={selectedFn.name}>
                {selectedFn.name}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                {selectedFn.signature}
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-600">
                @ {selectedFn.address} · {selectedFn.size} bytes
                {selectedFn.external && <span className="ml-2 text-amber-400">external</span>}
                {selectedFn.thunk && <span className="ml-2 text-zinc-500">thunk</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setRoot(selectedFn.name)}
                disabled={selectedFn.name === root}
                className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                Recenter here
              </button>
              <Link
                to={`/projects/${projectId}?fn=${encodeURIComponent(selectedFn.name)}`}
                className="block rounded bg-purple-600 px-2 py-1 text-center font-medium text-white hover:bg-purple-500"
              >
                Open in code ↗
              </Link>
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                Calls ({selectedFn.xrefs.callees.length})
              </div>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded border border-zinc-800 p-1">
                {selectedFn.xrefs.callees.length === 0 && (
                  <li className="px-1 text-zinc-600">No outgoing calls.</li>
                )}
                {selectedFn.xrefs.callees.map((c) => (
                  <li key={c}>
                    <button
                      onClick={() => setSelected(c)}
                      className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[10px] text-zinc-300 hover:bg-zinc-800 hover:text-purple-300"
                    >
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                Called by ({selectedFn.xrefs.callers.length})
              </div>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded border border-zinc-800 p-1">
                {selectedFn.xrefs.callers.length === 0 && (
                  <li className="px-1 text-zinc-600">No incoming calls.</li>
                )}
                {selectedFn.xrefs.callers.map((c) => (
                  <li key={c}>
                    <button
                      onClick={() => setSelected(c)}
                      className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[10px] text-zinc-300 hover:bg-zinc-800 hover:text-purple-300"
                    >
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">
      <div className="text-center">{children}</div>
    </div>
  )
}
