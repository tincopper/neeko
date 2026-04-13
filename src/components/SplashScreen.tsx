import { Loader2 } from "lucide-react";

export function SplashScreen() {
  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-[var(--bg-primary)]">
      <img
        src="./assets/neeko-icon.png"
        alt="Neeko"
        className="w-16 h-16 mb-4 animate-pulse"
      />
      <Loader2 className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
    </div>
  );
}