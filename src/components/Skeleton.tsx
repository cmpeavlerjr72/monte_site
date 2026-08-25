// src/components/Skeleton.tsx
//
// Async placeholders that reserve the panel's FINAL height, so data landing
// never shifts the layout. Every panel previously printed a one-line sentence
// ("Loading simulated distribution…") that was ~18px tall and then jumped to
// ~300px when the chart mounted.

export function Skeleton({
  height, width = "100%", radius = 8, style,
}: {
  height: number | string;
  width?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return <div className="skel" style={{ height, width, borderRadius: radius, ...style }} />;
}

/** Stacked text lines of decreasing width, for list-ish content. */
export function SkeletonLines({ rows = 3, height = 12, gap = 8 }: {
  rows?: number; height?: number; gap?: number;
}) {
  return (
    <div style={{ display: "grid", gap }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} width={`${100 - i * 12}%`} radius={6} />
      ))}
    </div>
  );
}

/** Controls row + chart body — the shape every distribution panel resolves to. */
export function SkeletonChart({ height = 220 }: { height?: number }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[86, 64, 110, 110].map((w, i) => <Skeleton key={i} height={30} width={w} />)}
      </div>
      <Skeleton height={height} />
    </div>
  );
}

/** Two-column roster shape, for the box score. */
export function SkeletonBoxScore() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Skeleton height={26} width="55%" />
        <Skeleton height={26} width="55%" style={{ justifySelf: "end" }} />
      </div>
      <Skeleton height={78} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        {[0, 1].map((c) => (
          <div key={c} style={{ display: "grid", gap: 10 }}>
            {[0, 1, 2].map((t) => (
              <div key={t} style={{ display: "grid", gap: 6 }}>
                <Skeleton height={22} radius={6} />
                <SkeletonLines rows={3} height={14} gap={6} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder card used while a week's slate is still loading. */
export function SkeletonCard() {
  return (
    <div
      className="card"
      style={{
        padding: 12, borderRadius: 12, border: "1px solid var(--border)",
        background: "var(--card)", display: "grid", gap: 10, alignContent: "start",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Skeleton height={12} width={60} radius={6} />
        <Skeleton height={12} width={90} radius={6} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px 90px", gap: 8, alignItems: "center" }}>
        <Skeleton height={24} /><Skeleton height={24} /><Skeleton height={24} />
        <Skeleton height={24} /><Skeleton height={24} /><Skeleton height={24} />
      </div>
      <Skeleton height={10} radius={999} />
      <div style={{ display: "flex", gap: 8 }}>
        <Skeleton height={28} width={110} /><Skeleton height={28} width={92} />
      </div>
    </div>
  );
}
