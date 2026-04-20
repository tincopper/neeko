import React, { useMemo } from "react";
import type { CommitInfo } from "../../types";

interface CommitGraphProps {
  commits: CommitInfo[];
  currentHash: string;
}

// Deterministic color assignment for branch lanes
const LANE_COLORS = [
  "#61afef", // blue
  "#e06c75", // red
  "#98c379", // green
  "#c678dd", // purple
  "#e5c07b", // yellow
  "#56b6c2", // cyan
  "#d19a66", // orange
  "#be5046", // dark red
];

/**
 * Compute graph lanes for a list of commits.
 * Each commit gets a vertical position (lane index) and horizontal connections
 * to its parents, producing a topology similar to `git log --graph`.
 */
function computeGraph(commits: CommitInfo[]): { lanes: number[]; connections: Map<string, { parentHash: string; fromLane: number; toLane: number; color: string }[]> } {
  const hashToIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashToIndex.set(commits[i].hash, i);
  }

  const lanes: number[] = new Array(commits.length).fill(-1);
  const activeLanes: (string | null)[] = []; // hash occupying each lane
  const connections: Map<string, { parentHash: string; fromLane: number; toLane: number; color: string }[]> = new Map();

  let colorIdx = 0;
  const hashColor = new Map<string, string>();

  function getColor(hash: string): string {
    if (!hashColor.has(hash)) {
      hashColor.set(hash, LANE_COLORS[colorIdx % LANE_COLORS.length]);
      colorIdx++;
    }
    return hashColor.get(hash)!;
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];

    // Find lane for this commit
    let lane = activeLanes.indexOf(commit.hash);
    if (lane === -1) {
      // Assign a new lane
      lane = activeLanes.indexOf(null);
      if (lane === -1) {
        lane = activeLanes.length;
        activeLanes.push(null);
      }
    }

    lanes[i] = lane;
    activeLanes[lane] = null;

    // Process parents
    const commitConnections: { parentHash: string; fromLane: number; toLane: number; color: string }[] = [];

    for (let pi = 0; pi < commit.parent_hashes.length; pi++) {
      const parentHash = commit.parent_hashes[pi];
      const parentIdx = hashToIndex.get(parentHash);

      if (parentIdx !== undefined) {
        // Parent is visible in the list
        let parentLane: number;
        const existingLane = activeLanes.indexOf(parentHash);
        if (existingLane !== -1) {
          parentLane = existingLane;
        } else if (pi === 0) {
          // First parent continues in the same lane
          parentLane = lane;
          activeLanes[lane] = parentHash;
        } else {
          // Merge parent gets a new lane
          parentLane = activeLanes.indexOf(null);
          if (parentLane === -1) {
            parentLane = activeLanes.length;
            activeLanes.push(null);
          }
          activeLanes[parentLane] = parentHash;
        }

        commitConnections.push({
          parentHash,
          fromLane: lane,
          toLane: parentLane,
          color: getColor(parentHash),
        });
      }
    }

    if (commitConnections.length > 0) {
      connections.set(commit.hash, commitConnections);
    }

    // If first parent not yet assigned, put it in the same lane
    if (commit.parent_hashes.length > 0) {
      const firstParent = commit.parent_hashes[0];
      if (activeLanes.indexOf(firstParent) === -1) {
        activeLanes[lane] = firstParent;
      }
    }
  }

  return { lanes, connections };
}

const DOT_SIZE = 10;
const LANE_WIDTH = 16;

function CommitGraph({ commits, currentHash }: CommitGraphProps) {
  const { lanes, connections } = useMemo(() => computeGraph(commits), [commits]);

  const maxLane = useMemo(() => {
    let max = 0;
    for (const l of lanes) {
      if (l > max) max = l;
    }
    return max;
  }, [lanes]);

  const svgWidth = (maxLane + 1) * LANE_WIDTH + 4;

  return (
    <div className="shrink-0" style={{ width: svgWidth }}>
      {commits.map((commit, i) => {
        const lane = lanes[i];
        const conns = connections.get(commit.hash);
        const cx = lane * LANE_WIDTH + LANE_WIDTH / 2 + 2;
        const isSelected = commit.hash === currentHash;
        const dotColor = LANE_COLORS[lane % LANE_COLORS.length];

        return (
          <div key={commit.hash} className="h-[calc(var(--font-size)*3.2)] flex items-start relative">
            <svg
              width={svgWidth}
              height="100%"
              className="absolute inset-0"
              style={{ overflow: "visible" }}
            >
              {/* Connection lines to parents */}
              {conns && conns.map((conn, ci) => {
                const parentCx = conn.toLane * LANE_WIDTH + LANE_WIDTH / 2 + 2;
                const isMerge = conn.fromLane !== conn.toLane;

                if (!isMerge) {
                  // Straight line down
                  return (
                    <line
                      key={ci}
                      x1={cx}
                      y1={DOT_SIZE / 2 + 2}
                      x2={cx}
                      y2="100%"
                      stroke={conn.color}
                      strokeWidth={1.5}
                      opacity={0.6}
                    />
                  );
                }

                // Merge line: curve from current lane to parent lane
                const midY = DOT_SIZE / 2 + 8;
                return (
                  <path
                    key={ci}
                    d={`M ${cx} ${DOT_SIZE / 2 + 2} C ${cx} ${midY}, ${parentCx} ${midY}, ${parentCx} 100%`}
                    fill="none"
                    stroke={conn.color}
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                );
              })}

              {/* Vertical passthrough lines for other active lanes */}
              {Array.from({ length: maxLane + 1 }, (_, li) => {
                if (li === lane) return null;
                const lx = li * LANE_WIDTH + LANE_WIDTH / 2 + 2;
                return (
                  <line
                    key={`pass-${li}`}
                    x1={lx}
                    y1="0"
                    x2={lx}
                    y2="100%"
                    stroke={LANE_COLORS[li % LANE_COLORS.length]}
                    strokeWidth={1}
                    opacity={0.2}
                  />
                );
              })}

              {/* Commit dot */}
              <circle
                cx={cx}
                cy={DOT_SIZE / 2 + 2}
                r={isSelected ? DOT_SIZE / 2 + 1 : DOT_SIZE / 2 - 1}
                fill={isSelected ? dotColor : "var(--bg-secondary)"}
                stroke={dotColor}
                strokeWidth={isSelected ? 2.5 : 1.5}
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(CommitGraph);
