import { Loader2 } from "lucide-react";

export function SplashScreen() {
  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center gap-5 bg-bg-primary">
      <img
        src="./assets/neeko-icon.png"
        alt="Neeko"
        className="w-14 h-14 rounded-2xl animate-pulse"
      />
      <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
    </div>
  );
}