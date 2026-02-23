import { useMemo } from "react";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

interface SparklineProps {
  /** Array of numeric values to plot */
  data: number[];
  /** Width of the sparkline SVG */
  width?: number;
  /** Height of the sparkline SVG */
  height?: number;
  /** Stroke color for the line */
  strokeColor?: string;
  /** Fill gradient start color (top) */
  fillColorStart?: string;
  /** Fill gradient end color (bottom, usually transparent) */
  fillColorEnd?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Display variant: "line" for smooth area chart, "bar" for histogram bars */
  variant?: "line" | "bar";
}

export default function Sparkline({
  data,
  width = 80,
  height = 40,
  strokeColor = "rgba(255,255,255,0.6)",
  fillColorStart = "rgba(255,255,255,0.2)",
  fillColorEnd = "rgba(255,255,255,0)",
  strokeWidth = 1.5,
  variant = "line",
}: SparklineProps) {

  // Bar chart variant
  const bars = useMemo(() => {
    if (variant !== "bar" || !data || data.length < 2) return null;

    // Only include non-zero values so empty days don't take up space
    const nonZero = data
      .map((val, i) => ({ val, i }))
      .filter(d => d.val > 0);

    if (nonZero.length === 0) return null;

    const padding = 1;
    const chartW = width - padding * 2;
    const chartH = height - padding;
    const max = Math.max(...nonZero.map(d => d.val));
    if (max === 0) return null;

    const gap = 1.5;
    const barW = Math.max(1.5, (chartW - gap * (nonZero.length - 1)) / nonZero.length);

    return nonZero.map((d, i) => {
      // Square root scale so smaller values are still visible
      const barH = Math.max(2, Math.sqrt(d.val / max) * chartH);
      return {
        x: padding + i * (barW + gap),
        y: height - barH,
        w: barW,
        h: barH,
      };
    });
  }, [data, width, height, variant]);

  // Line chart variant
  const { linePath, areaPath } = useMemo(() => {
    if (variant !== "line" || !data || data.length < 2) {
      return { linePath: "", areaPath: "" };
    }

    const padding = 2;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((val, i) => ({
      x: padding + (i / (data.length - 1)) * chartW,
      y: padding + chartH - ((val - min) / range) * chartH,
    }));

    const smoothLine = buildSmoothPath(points);
    const smoothArea = `${smoothLine} L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;

    return { linePath: smoothLine, areaPath: smoothArea };
  }, [data, width, height, variant]);

  if (!data || data.length < 2) return null;

  const gradientId = `sparkGrad-${width}-${height}`;

  if (variant === "bar" && bars) {
    return (
      <Svg width={width} height={height}>
        {bars.map((bar, i) => (
          <Rect
            key={i}
            x={bar.x}
            y={bar.y}
            width={bar.w}
            height={Math.max(0, bar.h)}
            rx={0.5}
            fill={strokeColor}
          />
        ))}
      </Svg>
    );
  }

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={fillColorStart} stopOpacity="1" />
          <Stop offset="1" stopColor={fillColorEnd} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Path d={areaPath} fill={`url(#${gradientId})`} />
      <Path d={linePath} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Build a smooth SVG path that never overshoots (monotone cubic interpolation) */
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom tangents (higher divisor = tighter/sharper curves)
    const tension = 10;
    let cp1x = p1.x + (p2.x - p0.x) / tension;
    let cp1y = p1.y + (p2.y - p0.y) / tension;
    let cp2x = p2.x - (p3.x - p1.x) / tension;
    let cp2y = p2.y - (p3.y - p1.y) / tension;

    // Clamp control points to prevent overshoot beyond the segment's y range
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    cp1y = Math.max(minY, Math.min(maxY, cp1y));
    cp2y = Math.max(minY, Math.min(maxY, cp2y));

    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return path;
}
