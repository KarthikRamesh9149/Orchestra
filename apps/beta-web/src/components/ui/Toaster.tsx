import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, X } from "lucide-react";
import { create } from "zustand";

type ToastType = "success" | "info" | "error" | "subtle";
type Toast = { id: string; message: string; type: ToastType };

type ToastStore = {
  toasts: Toast[];
  add: (message: string, type?: ToastType) => void;
  remove: (id: string) => void;
};

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (message, type = "success") => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    if (type !== "error") setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const TOAST_STYLES: Record<ToastType, { border: string; icon: React.ReactNode }> = {
  success: { border: "#2A9D8F", icon: <Check size={13} strokeWidth={2.2} className="text-[#2A9D8F]" /> },
  info: { border: "#C84A1F", icon: <Info size={13} strokeWidth={1.8} className="text-[#C84A1F]" /> },
  error: { border: "#C84A4A", icon: <X size={13} strokeWidth={2} className="text-[#C84A4A]" /> },
  subtle: { border: "#E8E0D3", icon: <Check size={12} strokeWidth={2} className="text-[#8A8378]" /> },
};

export function Toaster() {
  const { toasts, remove } = useToastStore();

  return (
    <div className="fixed right-5 top-5 z-[700] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type];
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ type: "spring", stiffness: 340, damping: 28 }}
              role={toast.type === "error" ? "alert" : "status"}
              className="flex items-center gap-2.5 rounded-full border-l-4 bg-[var(--bg-card)] text-[var(--text-default)] py-2.5 pl-3 pr-5 shadow-[0_4px_16px_rgba(0,0,0,0.1)]"
              style={{ borderLeftColor: style.border }}
            >
              {style.icon}
              <span className="font-sans text-[12px] font-medium text-[var(--text-default)]">{toast.message}</span>
              <button type="button" aria-label="Dismiss notification" onClick={() => remove(toast.id)}><X size={14} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
