"use client";

import { Drawer } from "@heroui/react/drawer";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import { ChatPanel } from "./chat-panel";

// The chat below the large breakpoint: a bottom drawer (HeroUI, on React
// Aria) that is a modal dialog. It traps focus, closes with Escape, a tap
// outside, a swipe down or Close, and gives focus back to the Chat button.
export function ChatDrawer(props: Omit<ComponentProps<typeof ChatPanel>, "heading" | "closeButton" | "onLaunched">) {
  const [open, setOpen] = useState(false);
  return (
    <Drawer isOpen={open} onOpenChange={setOpen}>
      <Drawer.Trigger className="rounded-lg border border-muted/30 px-3 py-1 text-sm text-fg transition-colors duration-150 hover:border-muted/60 data-[focus-visible]:outline-2 data-[focus-visible]:outline-primary">
        Chat
      </Drawer.Trigger>
      <Drawer.Backdrop className="bg-black/50">
        <Drawer.Content placement="bottom">
          <Drawer.Dialog className="flex h-[88dvh] flex-col rounded-t-[14px] border-t border-muted/25 bg-bg px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-fg shadow-[0_8px_30px_rgba(0,0,0,0.16)]">
            <Drawer.Handle />
            <MarkModal />
            <ChatPanel
              {...props}
              heading={(title) => <Drawer.Heading className="text-base font-semibold">{title}</Drawer.Heading>}
              closeButton={
                <button type="button" slot="close" onClick={() => setOpen(false)} className="-mr-2 min-h-11 rounded-lg px-3 text-sm text-muted hover:text-fg">
                  Close
                </button>
              }
              onLaunched={() => setOpen(false)}
            />
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

// React Aria hides the rest of the page from assistive technology while the
// drawer is open but leaves aria-modal off its dialog (and drops the prop).
// Said here as well, for screen readers that rely on it.
function MarkModal() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.closest('[role="dialog"]')?.setAttribute("aria-modal", "true");
  }, []);
  return <span ref={ref} hidden />;
}
