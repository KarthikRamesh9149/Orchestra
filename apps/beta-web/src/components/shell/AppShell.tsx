import { motion, useReducedMotion } from "framer-motion";
import { Outlet, useLocation } from "react-router-dom";
import { NavRail } from "./NavRail";

export function AppShell() {
  const { pathname } = useLocation();
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-page)] text-[var(--text-default)]" style={window.orchestraShared?{height:'calc(100dvh - 2.25rem)'}:undefined}>
      <NavRail />

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--bg-page)]">
        <motion.div
          key={pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.15 }}
          className="h-full"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
