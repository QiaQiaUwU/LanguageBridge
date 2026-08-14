declare module '3d-force-graph' {
  import type * as THREE from 'three'

  export interface ForceGraph3DInstance {
    (element: HTMLElement): ForceGraph3DInstance

    graphData(data?: { nodes: any[]; links: any[] }): ForceGraph3DInstance
    backgroundColor(color: string): ForceGraph3DInstance
    showNavInfo(show: boolean): ForceGraph3DInstance
    width(w: number): ForceGraph3DInstance
    height(h: number): ForceGraph3DInstance

    nodeRelSize(size: number): ForceGraph3DInstance
    nodeAutoColorBy(accessor: string | null): ForceGraph3DInstance
    nodeColor(accessor: string | ((node: any) => string)): ForceGraph3DInstance
    nodeOpacity(opacity: number): ForceGraph3DInstance
    nodeVal(accessor: string | ((node: any) => number)): ForceGraph3DInstance
    nodeLabel(accessor: string | ((node: any) => string)): ForceGraph3DInstance
    nodeThreeObject(accessor: null | ((node: any) => THREE.Object3D | THREE.Sprite | false)): ForceGraph3DInstance
    nodeThreeObjectExtend(extend: boolean | ((node: any) => boolean)): ForceGraph3DInstance

    linkWidth(accessor: number | ((link: any) => number)): ForceGraph3DInstance
    linkOpacity(opacity: number): ForceGraph3DInstance
    linkColor(accessor: string | ((link: any) => string)): ForceGraph3DInstance
    linkCurvature(accessor: number | ((link: any) => number)): ForceGraph3DInstance
    linkLabel(accessor: string | ((link: any) => string)): ForceGraph3DInstance
    linkDirectionalParticles(accessor: number | ((link: any) => number)): ForceGraph3DInstance
    linkDirectionalParticleSpeed(accessor: number | ((link: any) => number)): ForceGraph3DInstance
    linkDirectionalParticleWidth(accessor: number | ((link: any) => number)): ForceGraph3DInstance

    enableNodeDrag(enable: boolean): ForceGraph3DInstance
    enableNavigationControls(enable: boolean): ForceGraph3DInstance
    onNodeClick(callback: (node: any, event?: MouseEvent) => void): ForceGraph3DInstance
    onNodeHover(callback: (node: any | null, prev: any | null) => void): ForceGraph3DInstance

    cameraPosition(
      position: { x?: number; y?: number; z?: number },
      lookAt?: { x: number; y: number; z: number } | any,
      transitionMs?: number
    ): ForceGraph3DInstance
    zoomToFit(durationMs?: number, padding?: number): ForceGraph3DInstance
    warmupTicks(ticks: number): ForceGraph3DInstance
    cooldownTicks(ticks: number): ForceGraph3DInstance

    _destructor?(): void
  }

  const ForceGraph3D: () => ForceGraph3DInstance
  export default ForceGraph3D
}
