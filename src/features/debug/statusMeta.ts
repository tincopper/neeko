/** Map session status (+ error presence) to header badge label and dot color. */
export function statusMeta(status: string | undefined, hasError: boolean) {
  if (status === 'stopped') {
    return { label: 'Paused', dot: 'bg-accent-yellow' };
  }
  if (status === 'running' || status === 'starting') {
    return {
      label: status === 'starting' ? 'Starting' : 'Running',
      dot: 'bg-accent-green animate-pulse',
    };
  }
  if (status === 'terminated' || status === 'ended' || hasError) {
    return {
      label: hasError && status !== 'terminated' ? 'Failed' : 'Ended',
      dot: 'bg-text-muted',
    };
  }
  return { label: 'Idle', dot: 'bg-text-muted/60' };
}
