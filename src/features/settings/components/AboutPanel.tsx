import React from 'react';

import neekoIcon from '@/assets/neeko-icon.png';
import { useAppInfo } from '@/features/settings/hooks/useAppInfo';

/** About 页键值行（value 为独立文本节点，便于测试与样式控制）。 */
const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-start justify-between py-2.5 border-b border-white/[0.04] gap-6">
    <span className="text-[0.86em] text-text-muted shrink-0 w-28">{label}</span>
    <span className="text-[0.86em] text-text-primary text-right break-all">{value}</span>
  </div>
);

function AboutPanel() {
  const { state, retry } = useAppInfo();

  return (
    <div className="flex flex-col">
      <h3 className="text-base font-semibold text-text-primary mb-4">About</h3>

      {state.status === 'loading' && <div className="text-sm text-text-muted">Loading…</div>}

      {state.status === 'error' && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-text-muted">Failed to load app information.</div>
          <button
            className="w-fit px-3 h-8 bg-bg-tertiary border border-border rounded-md text-[0.86em] text-text-primary cursor-pointer transition-colors duration-150 hover:bg-bg-hover"
            onClick={() => retry()}
          >
            Retry
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div className="flex items-center gap-4 pb-5 border-b border-white/[0.04] mb-3">
            <img src={neekoIcon} className="w-14 h-14 object-contain" alt={state.info.name} />
            <div>
              <div className="text-lg font-semibold text-text-primary">{state.info.name}</div>
              <div className="text-[0.85em] text-text-muted mt-0.5">{state.info.description}</div>
            </div>
          </div>

          <InfoRow label="Version" value={state.info.version} />
          <InfoRow label="Identifier" value={state.info.identifier} />
          <InfoRow label="Tauri" value={state.info.tauriVersion} />
          <InfoRow label="OS" value={state.info.os} />
          <InfoRow label="Architecture" value={state.info.arch} />
          <InfoRow label="License" value={state.info.license} />
          {state.info.authors && <InfoRow label="Authors" value={state.info.authors} />}
          {state.info.copyright && <InfoRow label="Copyright" value={state.info.copyright} />}
        </>
      )}
    </div>
  );
}

export default React.memo(AboutPanel);
