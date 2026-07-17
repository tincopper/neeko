import React from "react";

interface AheadChipProps {
  ahead: number;
}

const AheadChip: React.FC<AheadChipProps> = ({ ahead }) => {
  if (ahead <= 0) return null;
  return (
    <span
      className="text-[0.92em] font-mono font-semibold text-[#3fb950]"
      title={`${ahead} commit(s) ahead of upstream`}
    >
      ↑{ahead}
    </span>
  );
};

interface ChangesChipProps {
  add: number;
  del: number;
}

const ChangesChip: React.FC<ChangesChipProps> = ({ add, del }) => {
  if (add <= 0 && del <= 0) return null;
  return (
    <span className="flex flex-col items-start text-[0.92em] font-mono leading-tight">
      {add > 0 && <span className="text-[#3fb950]">+{add}</span>}
      {del > 0 && <span className="text-[#f85149]">-{del}</span>}
    </span>
  );
};

interface KbdChipProps {
  children: React.ReactNode;
}

const KbdChip: React.FC<KbdChipProps> = ({ children }) => (
  <span className="text-[0.85em] font-mono text-text-muted px-1 py-0.5 tracking-tight">
    {children}
  </span>
);

export const SessionChips = {
  Ahead: React.memo(AheadChip),
  Changes: React.memo(ChangesChip),
  Kbd: React.memo(KbdChip),
};

export default SessionChips;
