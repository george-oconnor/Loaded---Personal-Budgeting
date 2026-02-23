import { useMemo } from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

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
}

export default function Sparkline({
  data,
  width = 80,
  height = 40,
  strokeColor = "rgba(255,255,255,0.6)",
  fillColorStart = "rgba(255,255,255,0.2)",
  fillColorEnd = "rgba(255,255,255,0)",
  strokeWidth = 1.5,
}: SparklineProps) {
  const { linePath, areaPath } = useMemo(() => {
    if (!data || data.length < 2) {
      return { linePath: "", areaPath: "" };
    }

    const padding = 2;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1; // avoid division by zero

    // Map data to coordinates
    const points = data.map((val, i) => ({
      x: padding + (i / (data.length - 1)) * chartW,
      y: padding + chartH - ((val - min) / range) * chartH,
    }));

    // Build smooth cubic bezier path using Catmull-Rom to Bezier conversion
    const smoothLine = buildSmoothPath(points);
    const smoothArea = `${smoothLine} L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;

    return { linePath: smoothLine, areaPath: smoothArea };
  }, [data, width, height]);

  if (!data || data.length < 2) return null;

  const gradientId = `sparkGrad-${width}-${height}`;

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

/** Build a smooth SVG path through the given points using monotone cubic interpolation */
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

    // Catmull-Rom to cubic bezier control points
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return path;
}
