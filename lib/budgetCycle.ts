import type { Transaction } from "@/types/type";

/**
 * Calculate the start date of the current budget cycle
 */
export function getCycleStartDate(
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number
): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Normalize to start of day
  const year = now.getFullYear();
  const month = now.getMonth();

  let cycleStart: Date;

  switch (cycleType) {
    case "first_working_day": {
      // Start from first working day of current month
      cycleStart = new Date(year, month, 1, 0, 0, 0);
      // Move to first working day (skip weekends)
      while (cycleStart.getDay() === 0 || cycleStart.getDay() === 6) {
        cycleStart.setDate(cycleStart.getDate() + 1);
      }
      // If we haven't reached the first working day yet, use previous month's first working day
      if (cycleStart > now) {
        cycleStart = new Date(year, month - 1, 1, 0, 0, 0);
        while (cycleStart.getDay() === 0 || cycleStart.getDay() === 6) {
          cycleStart.setDate(cycleStart.getDate() + 1);
        }
      }
      break;
    }

    case "last_working_day": {
      // Find the last working day of the previous month
      cycleStart = new Date(year, month, 0, 0, 0, 0); // Last day of previous month
      while (cycleStart.getDay() === 0 || cycleStart.getDay() === 6) {
        cycleStart.setDate(cycleStart.getDate() - 1);
      }
      
      // If we haven't passed this date yet this cycle, use the month before
      const currentMonthLastWorking = new Date(year, month + 1, 0, 0, 0, 0);
      while (currentMonthLastWorking.getDay() === 0 || currentMonthLastWorking.getDay() === 6) {
        currentMonthLastWorking.setDate(currentMonthLastWorking.getDate() - 1);
      }
      
      if (now >= currentMonthLastWorking) {
        cycleStart = currentMonthLastWorking;
      }
      break;
    }

    case "specific_date": {
      const cycleDay_ = cycleDay ?? 1;
      // Start from the cycle day of current month
      cycleStart = new Date(year, month, cycleDay_, 0, 0, 0);
      
      // If we haven't reached this day yet, use previous month
      if (cycleStart > now) {
        cycleStart = new Date(year, month - 1, cycleDay_, 0, 0, 0);
      }
      break;
    }

    case "last_friday": {
      // Find the last Friday of the current month
      const lastDayOfMonth = new Date(year, month + 1, 0, 0, 0, 0);
      let lastFriday = new Date(lastDayOfMonth);
      
      // Go back to last Friday (5 = Friday)
      while (lastFriday.getDay() !== 5) {
        lastFriday.setDate(lastFriday.getDate() - 1);
      }
      
      // If we haven't reached the last Friday of current month yet, use previous month's last Friday
      if (lastFriday > now) {
        const prevMonthLastDay = new Date(year, month, 0, 0, 0, 0);
        cycleStart = new Date(prevMonthLastDay);
        while (cycleStart.getDay() !== 5) {
          cycleStart.setDate(cycleStart.getDate() - 1);
        }
      } else {
        cycleStart = lastFriday;
      }
      break;
    }

    default:
      cycleStart = new Date(year, month, 1, 0, 0, 0);
  }

  return cycleStart;
}

/**
 * Calculate the start date of the previous budget cycle
 */
export function getPreviousCycleStartDate(
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number
): Date {
  const currentCycleStart = getCycleStartDate(cycleType, cycleDay);
  const year = currentCycleStart.getFullYear();
  const month = currentCycleStart.getMonth();

  let prevCycleStart: Date;

  switch (cycleType) {
    case "first_working_day": {
      // Previous cycle starts on first working day of previous month
      prevCycleStart = new Date(year, month - 1, 1, 0, 0, 0);
      while (prevCycleStart.getDay() === 0 || prevCycleStart.getDay() === 6) {
        prevCycleStart.setDate(prevCycleStart.getDate() + 1);
      }
      break;
    }

    case "last_working_day": {
      // Previous cycle starts on last working day of the month before the current cycle
      prevCycleStart = new Date(year, month, 0, 0, 0, 0); // Last day of previous month
      while (prevCycleStart.getDay() === 0 || prevCycleStart.getDay() === 6) {
        prevCycleStart.setDate(prevCycleStart.getDate() - 1);
      }
      break;
    }

    case "specific_date": {
      const cycleDay_ = cycleDay ?? 1;
      prevCycleStart = new Date(year, month - 1, cycleDay_, 0, 0, 0);
      break;
    }

    case "last_friday": {
      // Find the last Friday of the month before the current cycle start
      const prevMonthLastDay = new Date(year, month, 0, 0, 0, 0);
      prevCycleStart = new Date(prevMonthLastDay);
      while (prevCycleStart.getDay() !== 5) {
        prevCycleStart.setDate(prevCycleStart.getDate() - 1);
      }
      break;
    }

    default:
      prevCycleStart = new Date(year, month - 1, 1, 0, 0, 0);
  }

  return prevCycleStart;
}

/**
 * Calculate the end date of the current budget cycle (end of current day)
 */
export function getCycleEndDate(): Date {
  const now = new Date();
  now.setHours(23, 59, 59, 999); // End of today
  return now;
}

/**
 * Calculate when the next budget cycle starts (the actual end date of the current cycle)
 */
export function getNextCycleStartDate(
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number
): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Normalize to start of day
  const year = now.getFullYear();
  const month = now.getMonth();

  let nextCycleStart: Date;

  switch (cycleType) {
    case "first_working_day": {
      // Next cycle starts on first working day of next month
      nextCycleStart = new Date(year, month + 1, 1, 0, 0, 0);
      while (nextCycleStart.getDay() === 0 || nextCycleStart.getDay() === 6) {
        nextCycleStart.setDate(nextCycleStart.getDate() + 1);
      }
      break;
    }

    case "last_working_day": {
      // Next cycle starts on last working day of current month
      nextCycleStart = new Date(year, month + 1, 0, 0, 0, 0); // Last day of current month
      while (nextCycleStart.getDay() === 0 || nextCycleStart.getDay() === 6) {
        nextCycleStart.setDate(nextCycleStart.getDate() - 1);
      }
      // If we've already passed this date, use next month
      if (now >= nextCycleStart) {
        nextCycleStart = new Date(year, month + 2, 0, 0, 0, 0);
        while (nextCycleStart.getDay() === 0 || nextCycleStart.getDay() === 6) {
          nextCycleStart.setDate(nextCycleStart.getDate() - 1);
        }
      }
      break;
    }

    case "specific_date": {
      const day = cycleDay ?? 1;
      nextCycleStart = new Date(year, month, day, 0, 0, 0);
      // If this date has passed, use next month
      if (now >= nextCycleStart) {
        nextCycleStart = new Date(year, month + 1, day, 0, 0, 0);
      }
      break;
    }

    case "last_friday": {
      // Find next last Friday
      let lastDay = new Date(year, month + 1, 0, 0, 0, 0);
      while (lastDay.getDay() !== 5) {
        lastDay.setDate(lastDay.getDate() - 1);
      }
      nextCycleStart = lastDay;
      // If we've passed this Friday, get next month's last Friday
      if (now >= nextCycleStart) {
        lastDay = new Date(year, month + 2, 0, 0, 0, 0);
        while (lastDay.getDay() !== 5) {
          lastDay.setDate(lastDay.getDate() - 1);
        }
        nextCycleStart = lastDay;
      }
      break;
    }

    default:
      throw new Error(`Unknown cycle type: ${cycleType}`);
  }

  return nextCycleStart;
}

/**
 * Calculate the number of days remaining in the current budget cycle
 */
export function getDaysRemainingInCycle(
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number
): number {
  const now = new Date();
  const nextCycleStart = getNextCycleStartDate(cycleType, cycleDay);
  const diffMs = nextCycleStart.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Filter transactions that fall within the current budget cycle
 * @param transactions - Array of all transactions
 * @param cycleType - The type of budget cycle
 * @param cycleDay - Optional day of month for specific_date cycle type
 * @returns Filtered array of transactions within the current cycle
 */
export function getTransactionsInCurrentCycle(
  transactions: Transaction[],
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number
): Transaction[] {
  const cycleStart = getCycleStartDate(cycleType, cycleDay);
  const cycleEnd = getCycleEndDate();

  return transactions.filter((transaction) => {
    const transactionDate = new Date(transaction.date);
    return transactionDate >= cycleStart && transactionDate <= cycleEnd;
  });
}

/**
 * Calculate total expenses within the current budget cycle
 * @param transactions - Array of all transactions
 * @param cycleType - The type of budget cycle
 * @param cycleDay - Optional day of month for specific_date cycle type
 * @returns Total expenses in cents/smallest currency unit
 */
export function getCycleExpenses(
  transactions: Transaction[],
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number
): number {
  const cycleTransactions = getTransactionsInCurrentCycle(transactions, cycleType, cycleDay);
  
  return cycleTransactions
    .filter((t) => t.kind === "expense" && !t.excludeFromAnalytics)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

/**
 * Calculate total income within the current budget cycle
 * @param transactions - Array of all transactions
 * @param cycleType - The type of budget cycle
 * @param cycleDay - Optional day of month for specific_date cycle type
 * @returns Total income in cents/smallest currency unit
 */
export function getCycleIncome(
  transactions: Transaction[],
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number
): number {
  const cycleTransactions = getTransactionsInCurrentCycle(transactions, cycleType, cycleDay);
  
  return cycleTransactions
    .filter((t) => t.kind === "income" && !t.excludeFromAnalytics)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

/**
 * Calculate budget statistics for the current cycle
 * @param transactions - Array of all transactions
 * @param budget - Monthly budget in cents/smallest currency unit
 * @param cycleType - The type of budget cycle
 * @param cycleDay - Optional day of month for specific_date cycle type
 * @returns Object containing budget statistics
 */
export function getCycleBudgetStats(
  transactions: Transaction[],
  budget: number,
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number
) {
  const expenses = getCycleExpenses(transactions, cycleType, cycleDay);
  const remaining = budget - expenses;
  const isOverspent = remaining < 0;
  const progress = budget > 0 ? Math.min(1, expenses / budget) : 0;

  return {
    expenses,
    remaining,
    isOverspent,
    progress,
    cycleStart: getCycleStartDate(cycleType, cycleDay),
    cycleEnd: getCycleEndDate(),
  };
}
