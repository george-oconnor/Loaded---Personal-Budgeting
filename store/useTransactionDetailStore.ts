import { create } from "zustand";

interface TransactionDetailStore {
  selectedTransactionId: string | null;
  setSelectedTransactionId: (id: string | null) => void;
}

export const useTransactionDetailStore = create<TransactionDetailStore>((set) => ({
  selectedTransactionId: null,
  setSelectedTransactionId: (id) => set({ selectedTransactionId: id }),
}));
