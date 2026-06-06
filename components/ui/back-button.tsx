import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function BackButton() {
  return (
    <Button className="group relative overflow-hidden" dir="rtl">
      <span className="w-20 translate-x-2 transition-opacity duration-500 group-hover:opacity-0">
        חזרה
      </span>
      <i className="absolute inset-0 z-10 grid w-1/4 place-items-center bg-primary-foreground/15 transition-all duration-500 group-hover:w-full">
        <ArrowRight
          className="opacity-60"
          size={16}
          strokeWidth={2}
          aria-hidden="true"
        />
      </i>
    </Button>
  );
}
