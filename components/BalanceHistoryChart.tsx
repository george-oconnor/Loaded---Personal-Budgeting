import { getBalanceHistoryForChart, type ChartPoint } from "@/lib/balanceHistory";
import { convertCurrency, formatCurrency, getExchangeRates, getPrimaryCurrency } from "@/lib/currencyFunctions";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, GestureResponderEvent, Pressable, Text, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";

type RangeKey = "1M" | "3M" | "6M" | "1Y" | "ALL";

interface RangeOption {
  key: RangeKey;
  label: string;
  days?: number; // omit for ALL
}

const RANGES: RangeOption[] = [
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "6M", label: "6M", days: 180 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All" },
];

interface BalanceHistoryChartProps {
  /** Optional: limit to a subset of accountKeys */
  accountKeys?: string[];
  /** Refresh trigger to refetch */
  refreshTrigger?: number;
}

function toDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function formatShortDate(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatLongDate(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function BalanceHistoryChart({ accountKeys, refreshTrigger }: BalanceHistoryChartProps) {
  const { user } = useSessionStore();
  const [range, setRange] = useState<RangeKey>("3M");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [accountMeta, setAccountMeta] = useState<Record<string, { accountName?: string; currency?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [displayCurrency, setDisplayCurrency] = useState("EUR");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const svgRef = useRef(null);

  const screenWidth = Dimensions.get("window").width - 40; // matches container padding
  const chartHeight = 180;
  const padding = { top: 16, right: 12, bottom: 28, left: 12 };
  const chartWidth = screenWidth - padding.left - padding.right;
  const chartInnerHeight = chartHeight - padding.top - padding.bottom;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.id) {
        setLoading(false);
        setPoints([]);
        return;
      }
      setLoading(true);

      const today = new Date();
      const endDate = toDateKey(today);
      const opt = RANGES.find((r) => r.key === range);
      let startDate: string | undefined;
      if (opt?.days) {
        const start = new Date(today);
        start.setUTCDate(start.getUTCDate() - opt.days);
        startDate = toDateKey(start);
      }

      try {
        const result = await getBalanceHistoryForChart(user.id, {
          startDate,
          endDate,
          accountKeys,
        });
        if (cancelled) return;
        setPoints(result.points);
        setAccountMeta(result.accountMeta);

        // Pick primary currency + fetch rates if mixed
        const currencies = Object.values(result.accountMeta)
          .map((m) => m.currency)
          .filter((c): c is string => Boolean(c));
        if (currencies.length > 0) {
          const primary = getPrimaryCurrency(currencies);
          setDisplayCurrency(primary);
          if (new Set(currencies).size > 1) {
            const { rates } = await getExchangeRates(primary);
            if (!cancelled) setExchangeRates(rates);
          } else {
            setExchangeRates({});
          }
        }
      } catch (err) {
        console.error("Failed to load balance history:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id, range, refreshTrigger, accountKeys?.join("|")]);

  // Convert each point's per-account balances to display currency, then sum
  const displayPoints = useMemo(() => {
    return points.map((p) => {
      let total = 0;
      for (const [accKey, bal] of Object.entries(p.byAccount)) {
        const cur = accountMeta[accKey]?.currency || displayCurrency;
        if (cur === displayCurrency || Object.keys(exchangeRates).length === 0) {
          total += bal;
        } else {
          total += convertCurrency(bal, cur, displayCurrency, exchangeRates);
        }
      }
      return { date: p.date, total };
    });
  }, [points, accountMeta, displayCurrency, exchangeRates]);

  const stats = useMemo(() => {
    if (displayPoints.length === 0) {
      return { min: 0, max: 0, first: 0, last: 0, change: 0, changePct: 0 };
    }
    let min = displayPoints[0].total;
    let max = displayPoints[0].total;
    for (const p of displayPoints) {
      if (p.total < min) min = p.total;
      if (p.total > max) max = p.total;
    }
    const first = displayPoints[0].total;
    const last = displayPoints[displayPoints.length - 1].total;
    const change = last - first;
    const changePct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;
    return { min, max, first, last, change, changePct };
  }, [displayPoints]);

  const path = useMemo(() => {
    if (displayPoints.length < 2) return { line: "", area: "" };
    const yRange = stats.max - stats.min || 1;
    const xStep = chartWidth / (displayPoints.length - 1);

    let line = "";
    displayPoints.forEach((p, i) => {
      const x = padding.left + i * xStep;
      const y = padding.top + chartInnerHeight - ((p.total - stats.min) / yRange) * chartInnerHeight;
      line += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    const area = `${line} L ${padding.left + (displayPoints.length - 1) * xStep} ${
      padding.top + chartInnerHeight
    } L ${padding.left} ${padding.top + chartInnerHeight} Z`;

    return { line, area };
  }, [displayPoints, stats.min, stats.max, chartWidth, chartInnerHeight, padding.left, padding.top]);

  const handleTouch = (e: GestureResponderEvent) => {
    if (displayPoints.length < 2) return;
    const x = e.nativeEvent.locationX;
    const xStep = chartWidth / (displayPoints.length - 1);
    const idx = Math.max(0, Math.min(displayPoints.length - 1, Math.round((x - padding.left) / xStep)));
    if (idx !== selectedIndex) {
      Haptics.selectionAsync();
      setSelectedIndex(idx);
    }
  };

  const clearSelection = () => setSelectedIndex(null);

  // Empty state — no balance history yet for this account / range.
  if (!loading && displayPoints.length === 0) {
    return (
      <View className="mt-4 mx-5 rounded-3xl bg-white px-4 py-8 border border-gray-100 items-center">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-indigo-50 mb-3">
          <Feather name="trending-up" size={24} color="#6366F1" />
        </View>
        <Text className="text-base font-semibold text-dark-100">No balance history yet</Text>
        <Text className="text-sm text-gray-500 mt-1 text-center px-6">
          Import transactions for this account to start building a balance history chart.
        </Text>
      </View>
    );
  }

  const lineColor = stats.change >= 0 ? "#10B981" : "#EF4444";
  const gradientColor = stats.change >= 0 ? "#10B981" : "#EF4444";

  const selected = selectedIndex !== null ? displayPoints[selectedIndex] : null;

  return (
    <View className="mt-4 mx-5 rounded-3xl bg-white px-4 py-4 border border-gray-100">
      {/* Header */}
      <View className="flex-row items-start justify-between mb-1">
        <View>
          <Text className="text-gray-500 text-xs font-medium">
            {selected ? formatLongDate(selected.date) : "Balance over time"}
          </Text>
          <Text className={`text-2xl font-bold mt-0.5 ${(selected ? selected.total : stats.last) < 0 ? "text-red-500" : "text-gray-900"}`}>
            {formatCurrency((selected ? selected.total : stats.last) / 100, displayCurrency)}
          </Text>
        </View>
        {!selected && displayPoints.length > 1 && (
          <View className="items-end">
            <Text className={`text-sm font-semibold ${stats.change >= 0 ? "text-green-600" : "text-red-500"}`}>
              {stats.change >= 0 ? "+" : ""}
              {formatCurrency(stats.change / 100, displayCurrency)}
            </Text>
            <Text className="text-gray-400 text-xs mt-0.5">
              {stats.change >= 0 ? "+" : ""}
              {stats.changePct.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>

      {/* Chart */}
      <View
        className="mt-2"
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleTouch}
        onResponderMove={handleTouch}
        onResponderRelease={clearSelection}
        onResponderTerminate={clearSelection}
      >
        {loading ? (
          <View style={{ height: chartHeight }} className="items-center justify-center">
            <ActivityIndicator size="small" color="#7C3AED" />
          </View>
        ) : (
          <Svg ref={svgRef} width={screenWidth} height={chartHeight}>
            <Defs>
              <LinearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={gradientColor} stopOpacity="0.25" />
                <Stop offset="100%" stopColor={gradientColor} stopOpacity="0.02" />
              </LinearGradient>
            </Defs>

            {/* Subtle baseline */}
            <Line
              x1={padding.left}
              y1={padding.top + chartInnerHeight}
              x2={padding.left + chartWidth}
              y2={padding.top + chartInnerHeight}
              stroke="#F3F4F6"
              strokeWidth={1}
            />

            {/* Area */}
            {path.area ? <Path d={path.area} fill="url(#balanceFill)" /> : null}
            {/* Line */}
            {path.line ? (
              <Path d={path.line} stroke={lineColor} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            ) : null}

            {/* Selected indicator */}
            {selected && selectedIndex !== null && displayPoints.length > 1 && (() => {
              const xStep = chartWidth / (displayPoints.length - 1);
              const yRange = stats.max - stats.min || 1;
              const x = padding.left + selectedIndex * xStep;
              const y =
                padding.top + chartInnerHeight - ((selected.total - stats.min) / yRange) * chartInnerHeight;
              return (
                <>
                  <Line x1={x} y1={padding.top} x2={x} y2={padding.top + chartInnerHeight} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="3 3" />
                  <Circle cx={x} cy={y} r={5} fill="#fff" stroke={lineColor} strokeWidth={2} />
                </>
              );
            })()}

            {/* X-axis labels (start & end) */}
            {displayPoints.length > 1 && (
              <>
                <SvgText
                  x={padding.left}
                  y={chartHeight - 8}
                  fontSize={10}
                  fill="#9CA3AF"
                  textAnchor="start"
                >
                  {formatShortDate(displayPoints[0].date)}
                </SvgText>
                <SvgText
                  x={padding.left + chartWidth}
                  y={chartHeight - 8}
                  fontSize={10}
                  fill="#9CA3AF"
                  textAnchor="end"
                >
                  {formatShortDate(displayPoints[displayPoints.length - 1].date)}
                </SvgText>
              </>
            )}
          </Svg>
        )}
      </View>

      {/* Range selector */}
      <View className="flex-row justify-around mt-2">
        {RANGES.map((r) => {
          const active = r.key === range;
          return (
            <Pressable
              key={r.key}
              onPress={() => {
                setRange(r.key);
                setSelectedIndex(null);
              }}
              className="flex-1 mx-0.5"
            >
              <View
                className={`py-1.5 rounded-full items-center ${active ? "bg-primary" : "bg-gray-100"}`}
              >
                <Text className={`text-xs font-semibold ${active ? "text-white" : "text-gray-500"}`}>
                  {r.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
