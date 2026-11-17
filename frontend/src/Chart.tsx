import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts'

export type ChartSpec = { type: 'bar' | 'line' | 'pie' | 'scatter'; x: string; y: string[]; title: string }

// Series colors live in index.css (--series-1..8, validated as a set on the chart surface).
const MAX_SERIES = 8 // ponytail: never cycle hues; series past 8 stay in the table only
const series = (i: number) => `var(--series-${i + 1})`

const fmt = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : String(v))
const compact = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 })
const fmtAxis = (v: unknown) => (typeof v === 'number' ? compact.format(v) : String(v))

// Motion: lines draw, bars grow from the baseline, the ring sweeps; series follow each other 80ms apart.
// Read once: under reduced motion the chart stands finished.
const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const draw = (i: number, ms = 900) => ({
  isAnimationActive: !still,
  animationBegin: 120 + i * 80,
  animationDuration: ms,
  animationEasing: 'ease-out' as const,
})

const axis = {
  stroke: 'var(--axis)',
  tick: { fill: 'var(--muted)', fontSize: 12 },
  tickLine: false,
} as const
const legendText = (v: string) => <span style={{ color: 'var(--muted)' }}>{v}</span>
const legend = <Legend itemSorter={null} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, paddingTop: 8 }} formatter={legendText} />
const grid = <CartesianGrid stroke="var(--gridline)" vertical={false} />
// Markers carry a 2px ring in the surface color so they stay legible where they cross a line.
const dot = (i: number) => ({ r: 4, fill: series(i), stroke: 'var(--surface)', strokeWidth: 2 })

export function Chart({ spec, columns, rows }: { spec: ChartSpec; columns: string[]; rows: unknown[][] }) {
  const ys = spec.y.slice(0, MAX_SERIES)
  const data = rows.map((r) => {
    const o: Record<string, unknown> = Object.fromEntries(columns.map((c, i) => [c, r[i]]))
    for (const y of ys) o[y] = o[y] == null ? null : Number(o[y]) // a missing period is a gap, not a zero
    if (spec.type === 'scatter') o[spec.x] = Number(o[spec.x])
    return o
  })
  const tooltip = (
    <Tooltip
      formatter={(v) => fmt(v)}
      cursor={spec.type === 'bar' ? { fill: 'var(--hover)' } : { stroke: 'var(--axis)' }}
      animationDuration={150}
      contentStyle={{ background: 'var(--raise)', border: '1px solid var(--line-strong)', borderRadius: 8, fontSize: 14 }}
      labelStyle={{ color: 'var(--ink)', fontWeight: 500 }}
      itemStyle={{ color: 'var(--ink)' }}
    />
  )
  const multi = ys.length > 1 ? legend : null // a single series needs no legend: the title names it

  let chart
  if (spec.type === 'pie') {
    const [y] = ys
    const sorted = [...data].sort((a, b) => (b[y] as number) - (a[y] as number))
    const slices = sorted.length > MAX_SERIES
      ? [...sorted.slice(0, MAX_SERIES - 1), { [spec.x]: 'Altro', [y]: sorted.slice(MAX_SERIES - 1).reduce((s, d) => s + (d[y] as number), 0) }]
      : sorted
    chart = (
      <PieChart>
        {/* 2px surface-colored stroke = the gap between slices */}
        <Pie data={slices} dataKey={y} nameKey={spec.x} innerRadius="55%" outerRadius="82%" startAngle={90} endAngle={-270} stroke="var(--surface)" strokeWidth={2} {...draw(0, 1000)}>
          {slices.map((_, i) => <Cell key={i} fill={series(i)} />)}
        </Pie>
        {tooltip}
        {legend}
      </PieChart>
    )
  } else if (spec.type === 'line') {
    chart = (
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        {grid}
        <XAxis dataKey={spec.x} {...axis} />
        <YAxis {...axis} axisLine={false} tickFormatter={fmtAxis} width={64} />
        {tooltip}
        {multi}
        {ys.map((y, i) => (
          <Line
            key={y}
            dataKey={y}
            stroke={series(i)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={data.length <= 40 ? dot(i) : false}
            activeDot={{ ...dot(i), r: 5 }}
            {...draw(i, 1100)}
          />
        ))}
      </LineChart>
    )
  } else if (spec.type === 'scatter') {
    chart = (
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--gridline)" />
        <XAxis dataKey={spec.x} type="number" name={spec.x} {...axis} tickFormatter={fmtAxis} />
        <YAxis dataKey={ys[0]} type="number" name={ys[0]} {...axis} axisLine={false} tickFormatter={fmtAxis} width={64} />
        {tooltip}
        <Scatter data={data} fill={series(0)} stroke="var(--surface)" strokeWidth={2} {...draw(0, 700)} />
      </ScatterChart>
    )
  } else {
    chart = (
      <BarChart data={data} barGap={2} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        {grid}
        <XAxis dataKey={spec.x} {...axis} />
        <YAxis {...axis} axisLine={false} tickFormatter={fmtAxis} width={64} />
        {tooltip}
        {multi}
        {ys.map((y, i) => (
          <Bar key={y} dataKey={y} fill={series(i)} radius={[4, 4, 0, 0]} maxBarSize={24} {...draw(i, 700)} />
        ))}
      </BarChart>
    )
  }

  return (
    <figure className="card chart">
      {spec.title && <figcaption>{spec.title}</figcaption>}
      <ResponsiveContainer width="100%" height={360}>{chart}</ResponsiveContainer>
    </figure>
  )
}
