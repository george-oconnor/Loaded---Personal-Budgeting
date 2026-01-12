import { getCycleStartDate, getNextCycleStartDate, getPreviousCycleStartDate } from "@/lib/budgetCycle";
import type { Transaction } from "@/types/type";
import * as Haptics from "expo-haptics";
import { useMemo, useRef, useState } from "react";
import { Dimensions, GestureResponderEvent, Text, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";

interface SpendingOverTimeChartProps {
  transactions: Transaction[];
  cycleType?: "first_working_day" | "last_working_day" | "specific_date" | "last_friday";
  cycleDay?: number;
  currency?: string;
  monthlyBudget?: number;
  onDraggingChange?: (isDragging: boolean) => void;
  onDateSelected?: (date: string | null) => void;
}

export default function SpendingOverTimeChart({
  transactions,
  cycleType = "first_working_day",
  cycleDay,
  currency = "USD",
  monthlyBudget = 0,
  onDraggingChange,
  onDateSelected,
}: SpendingOverTimeChartProps) {
  const screenWidth = Dimensions.get("window").width - 40; // Account for padding
  const chartHeight = 220;
  const padding = { top: 20, right: 50, bottom: 40, left: 10 };
  const chartWidth = screenWidth - padding.left - padding.right;
  const chartInnerHeight = chartHeight - padding.top - padding.bottom;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastVibrationDate, setLastVibrationDate] = useState<string | null>(null);
  const svgRef = useRef(null);

  // Helper to extract date string consistently
  const getDateKey = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const updateSelectedDateFromX = (touchX: number) => {
    if (chartData.points.length === 0) return;

    // Calculate which point is closest to the touch
    const relativeX = touchX - padding.left;
    const normalizedX = Math.max(0, Math.min(1, relativeX / chartWidth));
    const pointIndex = Math.round(normalizedX * (chartData.points.length - 1));
    
    if (pointIndex >= 0 && pointIndex < chartData.points.length) {
      const newDate = chartData.points[pointIndex].date;
      if (newDate !== lastVibrationDate) {
        Haptics.selectionAsync();
        setLastVibrationDate(newDate);
      }
      setSelectedDate(newDate);
      onDateSelected?.(newDate);
    }
  };

  const chartData = useMemo(() => {
    const cycleStart = getCycleStartDate(cycleType, cycleDay);
    const now = new Date();
    now.setHours(23, 59, 59, 999); // End of today to include all transactions today
    
    // Use getNextCycleStartDate to get actual cycle end
    const cycleEnd = getNextCycleStartDate(cycleType, cycleDay);
    cycleEnd.setDate(cycleEnd.getDate() - 1); // Day before next cycle starts

    // Calculate previous cycle dates using the correct function
    const prevCycleStart = getPreviousCycleStartDate(cycleType, cycleDay);
    const prevCycleEnd = new Date(cycleStart);
    prevCycleEnd.setDate(prevCycleEnd.getDate() - 1);

    // Filter expenses in current cycle and sort by date
    const cycleExpenses = transactions
      .filter((t) => {
        const d = new Date(t.date);
        return t.kind === "expense" && !t.excludeFromAnalytics && d >= cycleStart && d <= now;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Filter expenses in previous cycle
    const prevCycleExpenses = transactions
      .filter((t) => {
        const d = new Date(t.date);
        return t.kind === "expense" && !t.excludeFromAnalytics && d >= prevCycleStart && d <= prevCycleEnd;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Create daily cumulative spending for current cycle
    const dailySpending: { [key: string]: number } = {};
    let cumulative = 0;

    cycleExpenses.forEach((t) => {
      const date = new Date(t.date);
      const dateKey = getDateKey(date);
      if (!dailySpending[dateKey]) {
        dailySpending[dateKey] = 0;
      }
      dailySpending[dateKey] += Math.abs(t.amount);
    });

    // Create daily cumulative spending for previous cycle
    const prevDailySpending: { [key: string]: number } = {};
    let prevCumulative = 0;

    prevCycleExpenses.forEach((t) => {
      const date = new Date(t.date);
      const dateKey = getDateKey(date);
      if (!prevDailySpending[dateKey]) {
        prevDailySpending[dateKey] = 0;
      }
      prevDailySpending[dateKey] += Math.abs(t.amount);
    });

    // Generate all days from cycle start to end of cycle (for full axis)
    const days: string[] = [];
    const cumulativeAmounts: number[] = [];
    const prevCumulativeAmounts: number[] = [];
    const currentDate = new Date(cycleStart);
    let axisEndIndex = 0;
    const cycleDayCount = Math.floor((prevCycleEnd.getTime() - prevCycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Calculate the total length of current cycle for normalization
    const currentCycleDays = Math.floor((cycleEnd.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Track which previous cycle days we've already accumulated to avoid double-counting
    const prevDaysAccumulated = new Set<string>();

    while (currentDate <= cycleEnd) {
      const dateKey = getDateKey(currentDate);
      days.push(dateKey);
      
      // Only accumulate spending up to today
      if (currentDate <= now) {
        if (dailySpending[dateKey]) {
          cumulative += dailySpending[dateKey];
        }
        cumulativeAmounts.push(cumulative);
        axisEndIndex = days.length - 1;
      } else {
        // After today, keep the last cumulative amount flat (no extrapolation)
        cumulativeAmounts.push(cumulative);
      }
      
      // Get equivalent date from previous cycle based on percentage through cycle
      const dayOffsetFromCycleStart = Math.floor((currentDate.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24));
      const percentThroughCycle = dayOffsetFromCycleStart / currentCycleDays;
      const prevCycleDayOffset = Math.floor(percentThroughCycle * cycleDayCount);
      
      if (prevCycleDayOffset < cycleDayCount) {
        const prevCycleDate = new Date(prevCycleStart);
        prevCycleDate.setDate(prevCycleDate.getDate() + prevCycleDayOffset);
        const prevDateKey = getDateKey(prevCycleDate);
        
        // Only add this day's spending if we haven't already accumulated it
        if (!prevDaysAccumulated.has(prevDateKey)) {
          if (prevDailySpending[prevDateKey]) {
            prevCumulative += prevDailySpending[prevDateKey];
          }
          prevDaysAccumulated.add(prevDateKey);
        }
        prevCumulativeAmounts.push(prevCumulative);
      } else {
        prevCumulativeAmounts.push(prevCumulative);
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const maxAmount = Math.max(...cumulativeAmounts, ...prevCumulativeAmounts, monthlyBudget, 0);

    // Generate points for the line chart - only up to today
    const points = days.slice(0, axisEndIndex + 1).map((day, index) => {
      const x = (index / Math.max(days.length - 1, 1)) * chartWidth;
      const y = chartInnerHeight - (cumulativeAmounts[index] / (maxAmount || 1)) * chartInnerHeight;
      return { x, y, amount: cumulativeAmounts[index], date: day };
    });

    // Generate previous cycle points - show entire normalized previous cycle
    const prevPoints = days.map((day, index) => {
      const x = (index / Math.max(days.length - 1, 1)) * chartWidth;
      const y = chartInnerHeight - (prevCumulativeAmounts[index] / (maxAmount || 1)) * chartInnerHeight;
      return { x, y, amount: prevCumulativeAmounts[index], date: day };
    });

    return { points, prevPoints, maxAmount, days, cumulativeAmounts, prevCumulativeAmounts, axisEndIndex };
  }, [transactions, cycleType, cycleDay]);

  // Only show "no data" message if both current and previous cycle have no data
  if (chartData.points.length === 0 && chartData.prevPoints.length === 0) {
    return (
      <View className="bg-white rounded-3xl p-5 shadow-sm">
        <Text className="text-lg font-semibold text-dark-100 mb-4">Spending Over Time</Text>
        <View className="items-center justify-center py-12">
          <Text className="text-gray-400">No spending data in this cycle</Text>
        </View>
      </View>
    );
  }

  const { points, prevPoints, maxAmount } = chartData;

  // Calculate Y position for budget line
  const budgetY = monthlyBudget > 0 
    ? padding.top + chartInnerHeight - (monthlyBudget / (maxAmount || 1)) * chartInnerHeight
    : null;

  // Create path for line
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${padding.left + p.x} ${padding.top + p.y}`)
    .join(" ");

  // Create path for previous cycle line
  const prevLinePath = prevPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${padding.left + p.x} ${padding.top + p.y}`)
    .join(" ");

  // Create path for area under the line
  const areaPath = points.length > 0
    ? `${linePath} L ${padding.left + points[points.length - 1].x} ${padding.top + chartInnerHeight} L ${padding.left} ${padding.top + chartInnerHeight} Z`
    : "";

  // Format currency for labels
  const formatAmount = (amount: number) => {
    const value = amount / 100;
    const currencySymbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
    if (value >= 1000) {
      return `${currencySymbol}${Math.round(value).toLocaleString()}`;
    }
    return `${currencySymbol}${Math.round(value)}`;
  };

  // Handle chart tap
  const handleChartPress = (event: GestureResponderEvent) => {
    const touchX = event.nativeEvent.locationX;
    
    if (touchX === undefined || chartData.points.length === 0) return;

    setIsDragging(true);
    onDraggingChange?.(true);
    updateSelectedDateFromX(touchX);
  };

  const handleChartMove = (event: GestureResponderEvent) => {
    if (!isDragging) return;
    
    const touchX = event.nativeEvent.locationX;
    if (touchX === undefined) return;

    updateSelectedDateFromX(touchX);
  };

  const handleChartRelease = () => {
    setIsDragging(false);
    onDraggingChange?.(false);
  };

  const selectedPoint = selectedDate 
    ? chartData.points.find((p) => p.date === selectedDate)
    : null;

  // Determine color based on current vs previous cycle spending at today
  const todayCurrentSpend = chartData.points[chartData.points.length - 1]?.amount ?? 0;
  const todayPrevSpend = chartData.prevPoints[chartData.prevPoints.length - 1]?.amount ?? 0;
  const isUnderBudget = todayCurrentSpend <= todayPrevSpend;
  const lineColor = isUnderBudget ? "#10b981" : "#ef4444";
  const gradientStartColor = isUnderBudget ? "#10b981" : "#ef4444";

  // Y-axis labels - show current, previous cycle values, and budget
  const yLabels = [
    {
      value: todayCurrentSpend,
      y: padding.top + chartInnerHeight - (todayCurrentSpend / (maxAmount || 1)) * chartInnerHeight,
      label: formatAmount(todayCurrentSpend),
    },
    {
      value: todayPrevSpend,
      y: padding.top + chartInnerHeight - (todayPrevSpend / (maxAmount || 1)) * chartInnerHeight,
      label: formatAmount(todayPrevSpend),
    },
    {
      value: monthlyBudget,
      y: padding.top + chartInnerHeight - (monthlyBudget / (maxAmount || 1)) * chartInnerHeight,
      label: formatAmount(monthlyBudget),
    },
  ];

  return (
    <View className="bg-white py-6">
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => isDragging}
        onResponderGrant={handleChartPress}
        onResponderMove={handleChartMove}
        onResponderRelease={handleChartRelease}
        className="items-center px-5"
      >
        <Svg ref={svgRef} height={chartHeight} width={screenWidth}>
          <Defs>
            <LinearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor={gradientStartColor} stopOpacity="0.3" />
              <Stop offset="100%" stopColor={gradientStartColor} stopOpacity="0" />
            </LinearGradient>
          </Defs>

          {/* Grid lines */}
          {/* Grid lines removed */}

          {/* Area under line */}
          <Path
            d={areaPath}
            fill="url(#areaGradient)"
          />

          {/* Line */}
          <Path
            d={linePath}
            stroke={lineColor}
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Budget line */}
          {budgetY !== null && (
            <Line
              x1={padding.left}
              y1={budgetY}
              x2={padding.left + chartWidth}
              y2={budgetY}
              stroke="#EF4444"
              strokeWidth="2"
              strokeDasharray="4,4"
              opacity={0.6}
            />
          )}

          {/* Previous cycle line */}
          <Path
            d={prevLinePath}
            stroke="#9CA3AF"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.4}
          />

          {/* Data points */}
          {selectedPoint && (
            <Circle
              key={`selected-point`}
              cx={padding.left + selectedPoint.x}
              cy={padding.top + selectedPoint.y}
              r="6"
              fill={lineColor}
              stroke="#fff"
              strokeWidth="3"
            />
          )}

          {/* Vertical line at selected point */}
          {selectedPoint && (
            <>
              <Line
                x1={padding.left + selectedPoint.x}
                y1={padding.top}
                x2={padding.left + selectedPoint.x}
                y2={padding.top + chartInnerHeight}
                stroke={lineColor}
                strokeWidth="2"
                strokeDasharray="4,4"
                opacity={0.5}
              />
              
              {/* Popover box using SVG elements */}
              {(() => {
                const popoverWidth = 130;
                const popoverHeight = 80;
                const popoverX = Math.min(
                  padding.left + selectedPoint.x + 15,
                  screenWidth - popoverWidth - 10
                );
                // Adjust popoverY to ensure it doesn't get cut off at the bottom
                let popoverY = Math.max(10, padding.top + selectedPoint.y - 40);
                if (popoverY + popoverHeight > chartHeight - 30) {
                  popoverY = chartHeight - popoverHeight - 30;
                }
                const prevAmount = prevPoints.find((p) => p.date === selectedPoint.date)?.amount ?? 0;
                const diff = selectedPoint.amount - prevAmount;
                const isZeroDiff = diff === 0;
                const isNegativeDiff = diff < 0;
                const diffColor = isZeroDiff ? '#F59E0B' : isNegativeDiff ? '#10B981' : '#EF4444';
                
                // Calculate previous cycle equivalent date using percentage normalization
                const cycleStart = getCycleStartDate(cycleType, cycleDay);
                const now = new Date();
                now.setHours(23, 59, 59, 999);
                const cycleEnd = getNextCycleStartDate(cycleType, cycleDay);
                cycleEnd.setDate(cycleEnd.getDate() - 1);
                const selectedDate = new Date(selectedPoint.date);
                const dayOffset = Math.floor((selectedDate.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24));
                const currentCycleDays = Math.floor((cycleEnd.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                const percentThroughCycle = dayOffset / currentCycleDays;
                
                const prevCycleStart = getPreviousCycleStartDate(cycleType, cycleDay);
                const prevCycleEnd = new Date(cycleStart);
                prevCycleEnd.setDate(prevCycleEnd.getDate() - 1);
                const prevCycleDays = Math.floor((prevCycleEnd.getTime() - prevCycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                const prevCycleDayOffset = Math.floor(percentThroughCycle * prevCycleDays);
                
                const prevEquivalentDate = new Date(prevCycleStart);
                prevEquivalentDate.setDate(prevEquivalentDate.getDate() + prevCycleDayOffset);
                
                console.log('=== CHART POPOVER CALCULATION ===');
                console.log('Selected date:', selectedPoint.date);
                console.log('Current cycle start:', cycleStart.toISOString());
                console.log('Current cycle end:', cycleEnd.toISOString());
                console.log('Day offset:', dayOffset);
                console.log('Current cycle days:', currentCycleDays);
                console.log('Percent through cycle:', percentThroughCycle);
                console.log('Current amount:', selectedPoint.amount / 100);
                console.log('Previous cycle start:', prevCycleStart.toISOString());
                console.log('Previous cycle end:', prevCycleEnd.toISOString());
                console.log('Previous cycle days:', prevCycleDays);
                console.log('Previous cycle day offset:', prevCycleDayOffset);
                console.log('Previous equivalent date:', prevEquivalentDate.toISOString());
                console.log('Previous amount:', prevAmount / 100);
                console.log('Difference:', diff / 100);
                console.log('=== END CHART POPOVER CALCULATION ===');
                
                return (
                  <>
                    {/* Shadow */}
                    <Rect
                      x={popoverX + 2}
                      y={popoverY + 2}
                      width={popoverWidth}
                      height={popoverHeight}
                      rx={8}
                      fill="#000000"
                      opacity={0.1}
                    />
                    
                    {/* Background */}
                    <Rect
                      x={popoverX}
                      y={popoverY}
                      width={popoverWidth}
                      height={popoverHeight}
                      rx={8}
                      fill="#FFFFFF"
                      opacity={1}
                      stroke="#E5E7EB"
                      strokeWidth={1}
                    />
                    
                    {/* "difference:" label */}
                    <SvgText
                      x={popoverX + 8}
                      y={popoverY + 16}
                      fontSize="10"
                      fill="#6B7280"
                    >
                      difference:
                    </SvgText>
                    
                    {/* Difference amount (no sign) */}
                    <SvgText
                      x={popoverX + popoverWidth - 20}
                      y={popoverY + 16}
                      fontSize="14"
                      fill={diffColor}
                      fontWeight="bold"
                      textAnchor="end"
                    >
                      {formatAmount(Math.abs(diff))}
                    </SvgText>
                    
                    {/* Direction indicator next to value */}
                    <Path
                      d={(isNegativeDiff || isZeroDiff)
                        ? `M ${popoverX + popoverWidth - 16} ${popoverY + 11} L ${popoverX + popoverWidth - 11} ${popoverY + 16} L ${popoverX + popoverWidth - 6} ${popoverY + 11} Z`
                        : `M ${popoverX + popoverWidth - 16} ${popoverY + 16} L ${popoverX + popoverWidth - 11} ${popoverY + 11} L ${popoverX + popoverWidth - 6} ${popoverY + 16} Z`
                      }
                      fill={diffColor}
                    />
                    
                    {/* Divider line */}
                    <Line
                      x1={popoverX + 8}
                      y1={popoverY + 26}
                      x2={popoverX + popoverWidth - 8}
                      y2={popoverY + 26}
                      stroke="#E5E7EB"
                      strokeWidth={1}
                    />
                    
                    {/* Current date (left) */}
                    <SvgText
                      x={popoverX + 8}
                      y={popoverY + 42}
                      fontSize="9"
                      fill="#6B7280"
                    >
                      {new Date(selectedPoint.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </SvgText>
                    
                    {/* Current amount (right) */}
                    <SvgText
                      x={popoverX + popoverWidth - 8}
                      y={popoverY + 42}
                      fontSize="10"
                      fill="#6B7280"
                      textAnchor="end"
                    >
                      {formatAmount(selectedPoint.amount)}
                    </SvgText>
                    
                    {/* Previous cycle date (left) */}
                    <SvgText
                      x={popoverX + 8}
                      y={popoverY + 60}
                      fontSize="9"
                      fill="#9CA3AF"
                    >
                      {prevEquivalentDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </SvgText>
                    
                    {/* Previous cycle amount (right) */}
                    <SvgText
                      x={popoverX + popoverWidth - 8}
                      y={popoverY + 60}
                      fontSize="10"
                      fill="#6B7280"
                      textAnchor="end"
                    >
                      {formatAmount(prevAmount)}
                    </SvgText>
                  </>
                );
              })()}
            </>
          )}

          {/* Y-axis labels */}
          {yLabels.map((label, i) => {
            const isHiddenByPopover = selectedPoint && (() => {
              const popoverWidth = 130;
              const popoverHeight = 80;
              const popoverX = Math.min(
                padding.left + selectedPoint.x + 15,
                screenWidth - popoverWidth - 10
              );
              const popoverY = Math.max(10, padding.top + selectedPoint.y - 40);
              const labelX = padding.left + chartWidth + 10;
              const labelY = label.y;
              
              return (
                labelX >= popoverX - 20 &&
                labelX <= popoverX + popoverWidth + 20 &&
                labelY >= popoverY - 10 &&
                labelY <= popoverY + popoverHeight + 10
              );
            })();
            
            if (isHiddenByPopover) return null;
            
            return (
              <SvgText
                key={`y-label-${i}`}
                x={padding.left + chartWidth + 10}
                y={label.y + 4}
                fontSize="10"
                fill="#9CA3AF"
                textAnchor="start"
              >
                {label.label}
              </SvgText>
            );
          })}

          {/* X-axis labels (start and end date) - use prevPoints if current cycle has no data */}
          {(points.length > 0 || prevPoints.length > 0) && (() => {
            // Use days array for accurate start/end dates (full cycle range)
            const startDate = chartData.days[0];
            const endDate = chartData.days[chartData.days.length - 1];
            const startLabelX = padding.left;
            const endLabelX = padding.left + chartWidth;
            const labelY = chartHeight - 10;
            
            const isStartHidden = selectedPoint && (() => {
              const popoverWidth = 130;
              const popoverHeight = 80;
              const popoverX = Math.min(
                padding.left + selectedPoint.x + 15,
                screenWidth - popoverWidth - 10
              );
              const popoverY = Math.max(10, padding.top + selectedPoint.y - 40);
              
              return (
                startLabelX >= popoverX - 50 &&
                startLabelX <= popoverX + popoverWidth + 20 &&
                labelY >= popoverY - 10 &&
                labelY <= popoverY + popoverHeight + 10
              );
            })();
            
            const isEndHidden = selectedPoint && (() => {
              const popoverWidth = 130;
              const popoverHeight = 80;
              const popoverX = Math.min(
                padding.left + selectedPoint.x + 15,
                screenWidth - popoverWidth - 10
              );
              const popoverY = Math.max(10, padding.top + selectedPoint.y - 40);
              
              return (
                endLabelX >= popoverX - 50 &&
                endLabelX <= popoverX + popoverWidth + 20 &&
                labelY >= popoverY - 10 &&
                labelY <= popoverY + popoverHeight + 10
              );
            })();
            
            return (
              <>
                {!isStartHidden && (
                  <SvgText
                    x={startLabelX}
                    y={labelY}
                    fontSize="10"
                    fill="#9CA3AF"
                    textAnchor="start"
                  >
                    {new Date(startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </SvgText>
                )}
                {!isEndHidden && (
                  <SvgText
                    x={endLabelX}
                    y={labelY}
                    fontSize="10"
                    fill="#9CA3AF"
                    textAnchor="end"
                  >
                    {new Date(endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </SvgText>
                )}
              </>
            );
          })()}
        </Svg>
        </View>
    </View>
  );
}
