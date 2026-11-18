// Monthly allocation estimate: USD per requested vCPU-hour and GiB-hour.
export function planCost(plan: unknown): number {
  const deployments = new Map<string, any>();
  function visit(value: any): void {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'kubernetes:apps/v1:Deployment' && value.inputs?.spec) {
      deployments.set(
        value.urn ??
          value.inputs.metadata?.name ??
          JSON.stringify(value.inputs),
        value.inputs.spec,
      );
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(plan);
  if (!deployments.size) throw new Error('No priced Deployments in plan');
  let total = 0;
  for (const spec of deployments.values()) {
    for (const c of spec.template.spec.containers) {
      const cpuText = String(c.resources?.requests?.cpu ?? '');
      const memText = String(c.resources?.requests?.memory ?? '');
      if (!/^[\d.]+m?$/.test(cpuText) || !/^[\d.]+(Mi|Gi)$/.test(memText))
        throw new Error('Unknown resource quantity');
      const cpu = parseFloat(cpuText) / (cpuText.endsWith('m') ? 1000 : 1);
      const gib = parseFloat(memText) / (memText.endsWith('Mi') ? 1024 : 1);
      total += (spec.replicas ?? 1) * 730 * (cpu * 0.04048 + gib * 0.004445);
    }
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error('Invalid cost');
  return total;
}
