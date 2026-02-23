import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    return (
      localStorage.getItem("theme") === "dark" ||
      (!localStorage.getItem("theme") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => setDark(!dark)}
      title="Toggle theme"
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </Button>
  );
}
