"use client";

import { useEffect, useState } from "react";

import { chipClass } from "./ui";

type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("troupe-theme", theme);
  } catch {
    // Storage unavailable (private mode) — the in-page choice still applies.
  }
}

// Settings owns the preference; the control is a
// two-option radio group, not an icon riddle.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  if (theme === null) {
    return <div className="h-9 w-44 animate-pulse rounded-full bg-fg/[0.06]" aria-hidden />;
  }

  return (
    <fieldset className="flex items-center gap-2" aria-label="Theme">
      <legend className="sr-only">Theme</legend>
      {(["dark", "light"] as const).map((option) => (
        <label key={option} className={chipClass(theme === option, "min-w-20")}>
          <input
            type="radio"
            name="theme"
            value={option}
            checked={theme === option}
            onChange={() => {
              setTheme(option);
              applyTheme(option);
            }}
            className="sr-only"
          />
          {option === "dark" ? "Dark" : "Light"}
        </label>
      ))}
    </fieldset>
  );
}
